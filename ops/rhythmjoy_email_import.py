#!/usr/bin/env python3
import argparse
import email
import hashlib
import html
import imaplib
import json
import logging
import os
import re
import smtplib
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from email.header import decode_header
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import parsedate_to_datetime
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

APP_ROOT = Path(os.environ.get('RHYTHMJOY_APP_ROOT', '/home/clown313python/myapp'))
OPS_ROOT = Path(os.environ.get('RHYTHMJOY_OPS_ROOT', '/home/clown313python/rhythmjoy_ops'))
ENV_FILE = Path(os.environ.get('RHYTHMJOY_ENV_FILE', APP_ROOT / '.env'))
LOG_DIR = Path(os.environ.get('RHYTHMJOY_EMAIL_LOG_DIR', APP_ROOT / 'static' / 'email_log'))
LOG_FILE = LOG_DIR / 'email_service.log'
RESTART_COUNT_FILE = LOG_DIR / 'restart_count.txt'
TIME_ZONE = 'Asia/Seoul'
KST = timezone(timedelta(hours=9))
EVENT_ORDER_SOURCE_CLOCK_MAX_SKEW_MS = 24 * 60 * 60 * 1000
# Architecture invariant: never replace PEEK with RFC822/BODY[]; see the runbook.
IMAP_FETCH_QUERY = '(INTERNALDATE BODY.PEEK[])'

ROOM_MAILBOXES = {
    'Aroom': 'Aroom',
    'Broom': 'Broom',
    'Ahall': 'Ahall',
    'Bhall': 'Bhall',
    'Chall': 'Chall',
    'Dhall': 'Dhall',
    'Ehall': 'Ehall',
}

MAILBOXES = {
    **ROOM_MAILBOXES,
    'Cancellation': 'Cancellation',
    'Cancelhall': 'Cancelhall',
}

SPACECLOUD_MAILBOXES = {
    '&wqTTmMd0wqTQdLd8xrC03A-': 'SpaceCloud',
}

SPACECLOUD_ROOM_KEYS = {
    'Ahall': 'a',
    'Bhall': 'b',
    'Chall': 'c',
    'Dhall': 'd',
    'Ehall': 'e',
}


class ConfigError(RuntimeError):
    pass


def require_handoff(enabled, value, message):
    if enabled and not value:
        raise ConfigError(message)
    return value


def reservation_waits_for_payment(event_data):
    payment_status = str((event_data or {}).get('payment_status') or '').strip()
    return bool(payment_status and payment_status != '결제완료')


def load_env_file(path):
    try:
        lines = path.read_text(encoding='utf-8').splitlines()
    except FileNotFoundError:
        return

    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def get_required_env(name):
    value = os.environ.get(name)
    if not value:
        raise ConfigError(f'Missing required environment variable: {name}')
    return value


def env_flag(name, default='0'):
    return os.environ.get(name, default).strip().lower() in ('1', 'true', 'yes', 'on')


def configured_mailboxes(config):
    mailboxes = dict(MAILBOXES)
    if config.get('spacecloud_email_enabled'):
        mailboxes.update(SPACECLOUD_MAILBOXES)
    return mailboxes


def setup_logging():
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger('rhythmjoy_email_import')
    logger.setLevel(logging.INFO)
    logger.handlers.clear()

    formatter = logging.Formatter('%(asctime)s %(levelname)s:%(message)s')
    file_handler = TimedRotatingFileHandler(
        str(LOG_FILE),
        when='midnight',
        backupCount=30,
        encoding='utf-8',
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    logger.addHandler(stream_handler)
    return logger


def read_restart_count():
    try:
        return int(RESTART_COUNT_FILE.read_text(encoding='utf-8').strip() or '0')
    except FileNotFoundError:
        return 0
    except ValueError:
        return 0


def increment_restart_count():
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    count = read_restart_count() + 1
    RESTART_COUNT_FILE.write_text(str(count), encoding='utf-8')
    return count


def decode_header_value(value):
    if not value:
        return ''
    decoded_parts = []
    for part, encoding in decode_header(value):
        if isinstance(part, bytes):
            decoded_parts.append(part.decode(encoding or 'utf-8', errors='replace'))
        else:
            decoded_parts.append(part)
    return ''.join(decoded_parts)


def decode_payload(payload, charset):
    if payload is None:
        return ''
    encodings = [charset, 'utf-8', 'cp949', 'euc-kr']
    for encoding in [item for item in encodings if item]:
        try:
            return payload.decode(encoding)
        except UnicodeDecodeError:
            continue
    return payload.decode('utf-8', errors='replace')


def get_text_body(message):
    if message.is_multipart():
        html_fallback = ''
        for part in message.walk():
            content_type = part.get_content_type()
            disposition = part.get_content_disposition()
            if disposition == 'attachment':
                continue
            payload = part.get_payload(decode=True)
            if content_type == 'text/plain':
                return decode_payload(payload, part.get_content_charset())
            if content_type == 'text/html' and not html_fallback:
                html_fallback = decode_payload(payload, part.get_content_charset())
        return re.sub(r'<[^>]+>', ' ', html_fallback)

    return decode_payload(message.get_payload(decode=True), message.get_content_charset())


def convert_to_24_hour(am_pm, time_text):
    hour, minute = map(int, time_text.split(':'))
    if am_pm == '오후' and hour != 12:
        hour += 12
    elif am_pm == '오전' and hour == 12:
        hour = 0
    return f'{hour:02d}:{minute:02d}'


def normalize_date(date_text):
    return date_text.strip().rstrip('.').replace('.', '-').replace('/', '-')


def normalize_booking_time(time_text):
    hour, minute = map(int, time_text.split(':')[:2])
    if minute == 59:
        hour += 1
        minute = 0
    return hour, minute


def normalize_time_text(time_text):
    hour, minute = normalize_booking_time(time_text)
    return f'{hour:02d}:{minute:02d}'


def normalize_event_datetime_fields(event_data):
    normalized = dict(event_data or {})
    if normalized.get('date'):
        normalized['date'] = normalize_date(str(normalized['date']))
    for key in ('start_time', 'end_time'):
        if normalized.get(key):
            normalized[key] = normalize_time_text(str(normalized[key]))
    return normalized


def is_spacecloud_origin_event(event_data):
    source = str((event_data or {}).get('source') or '').strip().lower()
    return source.startswith('spacecloud-')


def parse_datetime(date_text, time_text):
    date_value = datetime.strptime(normalize_date(date_text), '%Y-%m-%d')
    hour, minute = normalize_booking_time(time_text)
    if hour == 24 and minute == 0:
        return date_value + timedelta(days=1)
    return date_value.replace(hour=hour, minute=minute)


def booking_interval_datetimes(date_text, start_time, end_time):
    if not date_text or not start_time or not end_time:
        return None, None
    start_at = parse_datetime(date_text, start_time)
    end_at = parse_datetime(date_text, end_time)
    if end_at <= start_at:
        end_at += timedelta(days=1)
    return start_at, end_at


def mask_name(name):
    clean = re.sub(r'(?:님)+$', '', str(name or '').strip()).strip()
    if len(clean) >= 3:
        return clean[0] + '*' * (len(clean) - 2) + clean[-1]
    if len(clean) == 2:
        return clean[0] + '*'
    return clean


def normalize_reserver_name_for_match(name):
    clean = re.sub(r'\s+', '', str(name or '').strip())
    while clean.endswith('님'):
        clean = clean[:-1]
    return clean


def calendar_to_spacecloud_room_key(calendar_key):
    return SPACECLOUD_ROOM_KEYS.get(calendar_key or '', '')


def clean_date_or_none(value):
    if not value:
        return None
    try:
        return normalize_date(str(value))
    except Exception:
        return None


def clean_time_or_none(value):
    if value is None or value == '':
        return None
    if isinstance(value, timedelta):
        total_seconds = int(value.total_seconds())
        if total_seconds < 0 or total_seconds >= 24 * 60 * 60:
            return None
        hours, remainder = divmod(total_seconds, 60 * 60)
        minutes, seconds = divmod(remainder, 60)
        return f'{hours:02d}:{minutes:02d}:{seconds:02d}'
    match = re.match(
        r'^(\d{1,2}):(\d{2})(?::(\d{2}))?$',
        str(value).strip(),
    )
    if match:
        hours, minutes, seconds = (
            int(match.group(1)),
            int(match.group(2)),
            int(match.group(3) or 0),
        )
        if hours < 24 and minutes < 60 and seconds < 60:
            return f'{hours:02d}:{minutes:02d}:{seconds:02d}'
    return None


def spacecloud_room_key_from_calendar(calendar_key):
    room_key = calendar_to_spacecloud_room_key(calendar_key)
    if room_key:
        return room_key
    if calendar_key == 'Aroom':
        return 'a'
    if calendar_key == 'Broom':
        return 'b'
    return ''


def db_datetime_or_none(value):
    if not value:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=KST)
    return value.astimezone(KST).replace(tzinfo=None).strftime('%Y-%m-%d %H:%M:%S')


def parse_internaldate_from_fetch_metadata(metadata):
    if not metadata:
        return None
    if isinstance(metadata, bytes):
        metadata = metadata.decode('utf-8', errors='replace')
    match = re.search(r'INTERNALDATE "([^"]+)"', metadata)
    if not match:
        return None
    try:
        return datetime.strptime(match.group(1), '%d-%b-%Y %H:%M:%S %z')
    except ValueError:
        return None


def parse_message_date_header(message):
    try:
        header_value = message.get('Date', '')
        if not header_value:
            return None
        parsed = parsedate_to_datetime(header_value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=KST)
        return parsed
    except Exception:
        return None


def get_email_received_at(message, fetch_metadata):
    return db_datetime_or_none(parse_internaldate_from_fetch_metadata(fetch_metadata) or parse_message_date_header(message))


def message_id_epoch_ms(message_id):
    """Return Naver's millisecond source clock from the Message-ID prefix."""
    match = re.match(r'^\s*<?(\d{13})(?=\D|$)', str(message_id or ''))
    if not match:
        return None
    try:
        return int(match.group(1))
    except (TypeError, ValueError):
        return None


def received_at_epoch_ms(email_received_at):
    """Convert the DB's KST wall-clock value to a timezone-stable epoch-ms key."""
    if not email_received_at:
        return None
    try:
        if isinstance(email_received_at, datetime):
            parsed = email_received_at
        else:
            parsed = datetime.fromisoformat(str(email_received_at).strip())
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=KST)
        return int(parsed.timestamp() * 1000)
    except (TypeError, ValueError, OverflowError):
        return None


def normalized_event_order_key(message_id, email_received_at):
    """Use a plausible source clock, otherwise fall back to received-at seconds."""
    source_ms = message_id_epoch_ms(message_id)
    received_ms = received_at_epoch_ms(email_received_at)
    if received_ms is None:
        return None
    if (
            source_ms is not None
            and abs(source_ms - received_ms) <= EVENT_ORDER_SOURCE_CLOCK_MAX_SKEW_MS
    ):
        return source_ms
    return received_ms


def event_order_source_is_trusted(message_id, email_received_at):
    """Only a source-ms clock corroborated by received-at may authorize effects."""
    source_ms = message_id_epoch_ms(message_id)
    received_ms = received_at_epoch_ms(email_received_at)
    return int(
        source_ms is not None
        and received_ms is not None
        and abs(source_ms - received_ms) <= EVENT_ORDER_SOURCE_CLOCK_MAX_SKEW_MS
    )


def extract_fetch_payload(message_data):
    fetch_metadata = ''
    raw_message = None
    for item in message_data:
        if not isinstance(item, tuple):
            continue
        metadata, payload = item
        if metadata and not fetch_metadata:
            fetch_metadata = metadata.decode('utf-8', errors='replace') if isinstance(metadata, bytes) else str(metadata)
        if payload and raw_message is None:
            raw_message = payload
    return fetch_metadata, raw_message


def unseen_message_sort_key(email_id, fetch_metadata, raw_message):
    try:
        message = email.message_from_bytes(raw_message)
        parsed_received_at = get_email_received_at(message, fetch_metadata)
        received_at = parsed_received_at or '9999-12-31 23:59:59'
        message_id = decode_header_value(message.get('Message-ID', '')).strip()
        event_order_key = normalized_event_order_key(message_id, parsed_received_at)
    except Exception:
        received_at = '9999-12-31 23:59:59'
        message_id = ''
        event_order_key = None
    try:
        sequence = int(email_id)
    except (TypeError, ValueError):
        sequence = 0
    return event_order_key is None, event_order_key or 0, received_at, message_id, sequence


def collected_message_sort_key(mailbox, email_id, fetch_metadata, raw_message):
    base_key = unseen_message_sort_key(email_id, fetch_metadata, raw_message)
    return (*base_key[:-1], str(mailbox or ''), base_key[-1])


def message_identity(mailbox, decoded_id, message, raw_message):
    message_id = decode_header_value(message.get('Message-ID', '')).strip()
    source_value = message_id or hashlib.sha256(raw_message).hexdigest() or decoded_id
    digest = hashlib.sha256(f'{mailbox}|{source_value}'.encode('utf-8')).hexdigest()[:32]
    return f'{mailbox}:{digest}', message_id


def truncate_text(value, limit):
    if not value:
        return ''
    text = str(value)
    return text[:limit]


def parse_amount_value(value):
    if value is None:
        return 0
    match = re.search(r'\d[\d,]*', str(value))
    if not match:
        return 0
    digits = match.group(0).replace(',', '')
    return int(digits) if digits else 0


def event_amount_fields(source_platform, event_data):
    gross_amount = parse_amount_value(event_data.get('gross_amount') or event_data.get('price'))
    fee_amount = parse_amount_value(event_data.get('fee_amount'))
    net_amount = parse_amount_value(event_data.get('net_amount'))
    source_mode = event_data.get('source_mode') or ''
    if event_data.get('amount_source'):
        amount_source = str(event_data.get('amount_source'))
    elif source_mode:
        amount_source = source_mode
    elif source_platform:
        amount_source = f'{source_platform}_email'
    else:
        amount_source = ''
    return {
        'gross_amount': gross_amount if gross_amount > 0 else None,
        'fee_amount': fee_amount if fee_amount > 0 else None,
        'net_amount': net_amount if net_amount > 0 else None,
        'amount_source': truncate_text(amount_source, 64),
        'payment_method': truncate_text(event_data.get('payment_method'), 64),
    }


def compact_json(value):
    if not value:
        return ''
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def build_email_record_base(config, mail_key, mailbox, decoded_id, message_id, email_received_at, subject, body, event_type, parsed_payload):
    return {
        'mail_key': mail_key,
        'mailbox': truncate_text(mailbox, 64),
        'imap_id': truncate_text(decoded_id, 64),
        'message_id': truncate_text(message_id, 255),
        'email_received_at': email_received_at,
        'event_order_key': normalized_event_order_key(message_id, email_received_at),
        'event_order_trusted': event_order_source_is_trusted(message_id, email_received_at),
        'subject': truncate_text(subject, 500),
        'event_type': event_type,
        'parse_status': 'parsed' if parsed_payload else 'unparsed',
        'processing_status': 'received' if parsed_payload else 'parse_failed',
        'target_calendar': '',
        'spacecloud_room_key': '',
        'reservation_number': '',
        'reserver_name': '',
        'product': '',
        'reservation_date': None,
        'start_time': None,
        'end_time': None,
        'payment_status': '',
        'price': '',
        'raw_body': body if config.get('store_raw_email_body') else None,
        'parsed_json': compact_json(parsed_payload),
    }


def build_reservation_email_record(config, mail_key, mailbox, decoded_id, message_id, email_received_at, subject, body, target_calendar, event_data):
    record = build_email_record_base(
        config,
        mail_key,
        mailbox,
        decoded_id,
        message_id,
        email_received_at,
        subject,
        body,
        'reservation',
        event_data,
    )
    record['target_calendar'] = target_calendar or ''
    record['spacecloud_room_key'] = calendar_to_spacecloud_room_key(target_calendar)
    if event_data:
        record.update({
            'reservation_number': truncate_text(event_data.get('reservation_number'), 64),
            'reserver_name': truncate_text(event_data.get('name'), 128),
            'product': truncate_text(event_data.get('product'), 255),
            'reservation_date': clean_date_or_none(event_data.get('date')),
            'start_time': clean_time_or_none(event_data.get('start_time')),
            'end_time': clean_time_or_none(event_data.get('end_time')),
            'payment_status': truncate_text(event_data.get('payment_status'), 64),
            'price': truncate_text(event_data.get('price'), 64),
        })
    return record


def build_cancellation_email_record(config, mail_key, mailbox, decoded_id, message_id, email_received_at, subject, body, deletion, calendar_key):
    record = build_email_record_base(
        config,
        mail_key,
        mailbox,
        decoded_id,
        message_id,
        email_received_at,
        subject,
        body,
        'cancellation',
        deletion,
    )
    record['target_calendar'] = calendar_key or ''
    record['spacecloud_room_key'] = calendar_to_spacecloud_room_key(calendar_key)
    if deletion:
        record.update({
            'reservation_number': truncate_text(deletion.get('reservation_number'), 64),
            'reserver_name': truncate_text(deletion.get('name'), 128),
            'product': truncate_text(deletion.get('product'), 255),
            'reservation_date': clean_date_or_none(deletion.get('date')),
            'start_time': clean_time_or_none(deletion.get('start_time')),
            'end_time': clean_time_or_none(deletion.get('end_time')),
        })
    return record


def build_spacecloud_email_record(config, mail_key, mailbox, decoded_id, message_id, email_received_at, subject, body, event_data, calendar_key):
    record = build_email_record_base(
        config,
        mail_key,
        mailbox,
        decoded_id,
        message_id,
        email_received_at,
        subject,
        body,
        'spacecloud_reservation',
        event_data,
    )
    record['target_calendar'] = calendar_key or ''
    record['spacecloud_room_key'] = spacecloud_room_key_from_calendar(calendar_key)
    if event_data:
        record.update({
            'reservation_number': truncate_text(event_data.get('reservation_number'), 64),
            'reserver_name': truncate_text(event_data.get('name'), 128),
            'product': truncate_text(event_data.get('product'), 255),
            'reservation_date': clean_date_or_none(event_data.get('date')),
            'start_time': clean_time_or_none(event_data.get('start_time')),
            'end_time': clean_time_or_none(event_data.get('end_time')),
            'payment_status': truncate_text(event_data.get('payment_status'), 64),
            'price': truncate_text(event_data.get('price'), 64),
        })
    return record


def build_spacecloud_cancellation_email_record(config, mail_key, mailbox, decoded_id, message_id, email_received_at, subject, body, event_data, calendar_key):
    record = build_email_record_base(
        config,
        mail_key,
        mailbox,
        decoded_id,
        message_id,
        email_received_at,
        subject,
        body,
        'spacecloud_cancellation',
        event_data,
    )
    record['target_calendar'] = calendar_key or ''
    record['spacecloud_room_key'] = spacecloud_room_key_from_calendar(calendar_key)
    if event_data:
        record.update({
            'reservation_number': truncate_text(event_data.get('reservation_number'), 64),
            'reserver_name': truncate_text(event_data.get('name'), 128),
            'product': truncate_text(event_data.get('product'), 255),
            'reservation_date': clean_date_or_none(event_data.get('date')),
            'start_time': clean_time_or_none(event_data.get('start_time')),
            'end_time': clean_time_or_none(event_data.get('end_time')),
            'payment_status': truncate_text(event_data.get('payment_status'), 64),
            'price': truncate_text(event_data.get('price'), 64),
        })
    return record


def build_ignored_email_record(config, mail_key, mailbox, decoded_id, message_id, email_received_at, subject, body, reason):
    record = build_email_record_base(
        config,
        mail_key,
        mailbox,
        decoded_id,
        message_id,
        email_received_at,
        subject,
        body,
        'spacecloud_ignored',
        {'reason': reason, 'subject': subject},
    )
    record['processing_status'] = 'ignored'
    return record


def db_connect(config, autocommit=True):
    if not config['db_enabled']:
        return None
    try:
        import pymysql
    except ImportError as error:
        raise ConfigError('PyMySQL is required for Rhythmjoy email DB logging') from error

    return pymysql.connect(
        host=config['db_server'],
        port=config['db_port'],
        user=config['db_username'],
        password=config['db_password'],
        database=config['db_name'],
        charset='utf8mb4',
        autocommit=autocommit,
        cursorclass=pymysql.cursors.DictCursor,
    )


@contextmanager
def db_transaction(config, logger, label):
    """Run related DB mutations as one unit; see docs/transactional-inbox-outbox-runbook.md."""
    if not config['db_enabled']:
        raise ConfigError(f'DB transaction required but DB is disabled: {label}')

    conn = db_connect(config, autocommit=False)
    try:
        conn.begin()
        yield conn
        conn.commit()
        logger.info('DB transaction committed label=%s', label)
    except Exception:
        conn.rollback()
        logger.exception('DB transaction rolled back label=%s', label)
        raise
    finally:
        conn.close()


def lock_inbox_event(config, logger, conn, email_event_id):
    """Serialize processing of one durable inbox row inside its handoff transaction."""
    if not email_event_id:
        raise ConfigError('Inbox event is required before transactional handoff')
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                'SELECT * FROM rhythmjoy_naver_email_events WHERE id=%s FOR UPDATE',
                (email_event_id,),
            )
            row = cursor.fetchone()
        if not row:
            raise ConfigError(f'Inbox event disappeared before handoff id={email_event_id}')
        return row
    except Exception:
        logger.exception('Inbox event lock failed id=%s', email_event_id)
        raise


def disable_db_logging(config, logger, message, error=None):
    if config['db_required']:
        raise ConfigError(message) from error
    if error:
        logger.exception('%s; falling back to calendar-only processing', message)
    else:
        logger.warning('%s; falling back to calendar-only processing', message)
    config['db_enabled'] = False


def ensure_db_column(cursor, table_name, column_name, ddl_fragment):
    cursor.execute(
        """
        SELECT COUNT(*) AS count
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND COLUMN_NAME = %s
        """,
        (table_name, column_name),
    )
    if cursor.fetchone()['count']:
        return
    cursor.execute(f'ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl_fragment}')


def ensure_db_index(cursor, table_name, index_name, columns):
    cursor.execute(
        """
        SELECT COUNT(*) AS count
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND INDEX_NAME = %s
        """,
        (table_name, index_name),
    )
    if cursor.fetchone()['count']:
        return
    cursor.execute(
        f'ALTER TABLE {table_name} ADD KEY {index_name} ({", ".join(columns)})'
    )


def ensure_db_empty_token_column(cursor, table_name, column_name, ddl_fragment):
    """Normalize a partially-deployed nullable token column without touching task state."""
    cursor.execute(
        f"UPDATE {table_name} SET {column_name}='' WHERE {column_name} IS NULL"
    )
    cursor.execute(
        """
        SELECT IS_NULLABLE, COLUMN_DEFAULT
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND COLUMN_NAME = %s
        """,
        (table_name, column_name),
    )
    column = cursor.fetchone() or {}
    if (
            column.get('IS_NULLABLE') == 'NO'
            and column.get('COLUMN_DEFAULT') in ('', "''")
    ):
        return
    cursor.execute(
        f'ALTER TABLE {table_name} MODIFY COLUMN {column_name} {ddl_fragment}'
    )


def backfill_safe_spacecloud_task_state(cursor):
    """Link only legacy work with durable proof that it has never been claimed."""
    counts = {}
    for task_type, ledger_event_column, ledger_status in (
            ('upload', 'confirmed_email_event_id', 'confirmed'),
            ('delete', 'canceled_email_event_id', 'canceled')):
        cursor.execute(
            f"""
            UPDATE rhythmjoy_spacecloud_tasks AS task
            INNER JOIN rhythmjoy_booking_ledger AS ledger
                    ON ledger.source_platform='naver'
                   AND ledger.{ledger_event_column}=task.email_event_id
                   AND ledger.current_status=%s
                   AND ledger.room_key=task.room_key
                   AND ledger.reservation_number=task.reservation_number
                   AND ledger.reservation_date <=> task.reservation_date
                   AND ledger.start_time <=> task.start_time
                   AND ledger.end_time <=> task.end_time
            INNER JOIN rhythmjoy_naver_email_events AS event_row
                    ON event_row.id=task.email_event_id
                   AND event_row.event_order_trusted=1
            SET task.booking_ledger_id=ledger.id,
                task.side_effect_state='ready',
                task.side_effect_token='',
                task.updated_at=NOW()
            WHERE task.task_type=%s
              AND task.status='pending'
              AND task.attempts=0
              AND task.side_effect_state IS NULL
              AND task.email_event_id IS NOT NULL
              AND task.reservation_number<>''
              AND (task.booking_ledger_id IS NULL OR task.booking_ledger_id=ledger.id)
            """,
            (ledger_status, task_type),
        )
        counts[task_type] = cursor.rowcount
    return counts


def backfill_email_event_order_keys(cursor):
    """Derive a stable, plausibility-checked source clock on MariaDB 5.5."""
    received_ms_sql = """CAST(
        TIMESTAMPDIFF(
            SECOND,
            '1970-01-01 09:00:00',
            email_received_at
        ) * 1000
        AS UNSIGNED
    )"""
    bare_source_is_trusted_sql = f"""(
        LEFT(message_id, 13) REGEXP '^[0-9]{{13}}$'
        AND SUBSTRING(message_id, 14, 1) NOT REGEXP '^[0-9]$'
        AND email_received_at IS NOT NULL
        AND ABS(
            CAST(LEFT(message_id, 13) AS SIGNED)
            - {received_ms_sql}
        ) <= 86400000
    )"""
    bracketed_source_is_trusted_sql = f"""(
        LEFT(message_id, 1)='<'
        AND SUBSTRING(message_id, 2, 13) REGEXP '^[0-9]{{13}}$'
        AND SUBSTRING(message_id, 15, 1) NOT REGEXP '^[0-9]$'
        AND email_received_at IS NOT NULL
        AND ABS(
            CAST(SUBSTRING(message_id, 2, 13) AS SIGNED)
            - {received_ms_sql}
        ) <= 86400000
    )"""
    expected_order_key_sql = f"""CASE
        WHEN {bare_source_is_trusted_sql}
            THEN CAST(LEFT(message_id, 13) AS UNSIGNED)
        WHEN {bracketed_source_is_trusted_sql}
            THEN CAST(SUBSTRING(message_id, 2, 13) AS UNSIGNED)
        WHEN email_received_at IS NOT NULL
            THEN {received_ms_sql}
        ELSE NULL
    END"""
    expected_trust_sql = f"""CASE
        WHEN {bare_source_is_trusted_sql}
          OR {bracketed_source_is_trusted_sql}
            THEN 1
        ELSE 0
    END"""
    cursor.execute(
        f"""
        UPDATE rhythmjoy_naver_email_events
        SET event_order_key={expected_order_key_sql}
        WHERE NOT (event_order_key <=> {expected_order_key_sql})
        """
    )
    changed_count = cursor.rowcount
    cursor.execute(
        f"""
        UPDATE rhythmjoy_naver_email_events
        SET event_order_trusted={expected_trust_sql}
        WHERE event_order_trusted<>{expected_trust_sql}
        """
    )
    return changed_count + cursor.rowcount


def _json_dict_or_none(value):
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value or '{}')
    except (TypeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def legacy_manual_naver_terminal_delete_proof(
        row, allow_later_trusted_events=False):
    """Accept only the exact, fully-observed legacy manual-delete protocol.

    These rows were intentionally created outside IMAP, so their received-at
    timestamp must never be promoted to a trusted Naver source clock.  The
    proof is deliberately stronger than a terminal DB status: producer
    markers, immutable core identity, the verified delete result, and stable
    post-delete absence must all agree.
    """
    event_payload = _json_dict_or_none(row.get('event_parsed_json'))
    task_payload = _json_dict_or_none(row.get('task_payload_json'))
    cancel_payload = _json_dict_or_none(row.get('ledger_cancel_payload_json'))
    result = _json_dict_or_none(row.get('task_result_text'))
    if not all(isinstance(value, dict) for value in (
            event_payload, task_payload, cancel_payload, result)):
        return False

    source_marker = {
        'source': 'manual-user-cancellation',
        'source_mode': 'manual-user-cancellation',
        'manual_confirmed_by_user': True,
        'action': 'cancel-and-remove-reflections',
    }
    if any(event_payload.get(key) != value for key, value in source_marker.items()):
        return False
    if event_payload != task_payload or event_payload != cancel_payload:
        return False

    reservation_number = str(row.get('event_reservation_number') or '').strip()
    room_key = str(row.get('event_room_key') or '').strip().lower()
    reservation_date = clean_date_or_none(row.get('event_reservation_date'))
    start_time = clean_time_or_none(row.get('event_start_time'))
    end_time = clean_time_or_none(row.get('event_end_time'))
    event_name = normalize_reserver_name_for_match(row.get('event_reserver_name'))
    if not all((reservation_number, room_key, reservation_date, start_time, end_time, event_name)):
        return False
    expected_mail_key = '|'.join((
        'manual-cancel',
        'naver',
        reservation_number,
        reservation_date,
        start_time[:5],
        end_time[:5],
    ))
    expected_order_key = normalized_event_order_key(
        '',
        row.get('event_received_at'),
    )
    if (
            str(row.get('event_mail_key') or '') != expected_mail_key
            or str(row.get('event_mailbox') or '') != 'Manual'
            or str(row.get('event_imap_id') or '') != ''
            or str(row.get('event_message_id') or '') != ''
            or str(row.get('event_type') or '') != 'cancellation'
            or str(row.get('event_parse_status') or '') != 'parsed'
            or str(row.get('event_processing_status') or '') != 'calendar_after_delete_done'
            or str(row.get('event_error_text') or '') != ''
            or int(row.get('event_order_trusted') or 0) != 0
            or int(row.get('event_order_key') or 0) != int(expected_order_key or 0)
            or (
                not allow_later_trusted_events
                and int(row.get('later_trusted_event_count') or 0) != 0
            )
    ):
        return False

    core_rows = ('ledger', 'task')
    for prefix in core_rows:
        if (
                str(row.get(f'{prefix}_reservation_number') or '').strip()
                != reservation_number
                or str(row.get(f'{prefix}_room_key') or '').strip().lower()
                != room_key
                or clean_date_or_none(row.get(f'{prefix}_reservation_date'))
                != reservation_date
                or clean_time_or_none(row.get(f'{prefix}_start_time')) != start_time
                or clean_time_or_none(row.get(f'{prefix}_end_time')) != end_time
                or normalize_reserver_name_for_match(row.get(f'{prefix}_reserver_name'))
                != event_name
        ):
            return False

    event_received_at = str(row.get('event_received_at') or '')
    ledger_last_event_id = int(row.get('ledger_last_event_id') or 0)
    ledger_last_event_order_key = row.get('ledger_last_event_order_key')
    if (
            str(row.get('ledger_source_platform') or '') != 'naver'
            or str(row.get('ledger_current_status') or '') != 'canceled'
            or int(row.get('ledger_canceled_email_event_id') or 0)
            != int(row.get('event_id') or 0)
            or str(row.get('ledger_canceled_email_received_at') or '')
            != event_received_at
            or str(row.get('ledger_last_event_at') or '') != event_received_at
            or ledger_last_event_id not in (0, int(row.get('event_id') or 0))
            or (
                ledger_last_event_id
                and int(ledger_last_event_order_key or 0)
                != int(row.get('event_order_key') or 0)
            )
            or (
                not ledger_last_event_id
                and ledger_last_event_order_key is not None
            )
            or row.get('ledger_automation_canceled_order_key') is not None
            or (
                row.get('ledger_automation_canceled_at') is not None
                and str(row.get('ledger_automation_canceled_at')) != event_received_at
            )
            or int(row.get('ledger_automation_cancel_task_id') or 0)
            not in (0, int(row.get('task_id') or 0))
            or str(row.get('ledger_automation_cancel_platform') or '')
            not in ('', 'naver')
    ):
        return False

    verification = result.get('deleteVerification')
    verification_identity = (
        verification.get('identity') if isinstance(verification, dict) else None
    )
    remaining = result.get('remainingSearch')
    google_calendar = result.get('googleCalendar')
    verified_attempts = result.get('deleteCandidateAttempts')
    if (
            int(row.get('task_id') or 0) < 1
            or int(row.get('task_email_event_id') or 0) != int(row.get('event_id') or 0)
            or int(row.get('task_booking_ledger_id') or 0)
            not in (0, int(row.get('ledger_id') or 0))
            or str(row.get('task_type') or '') != 'delete'
            or str(row.get('task_status') or '') != 'done'
            or int(row.get('task_attempts') or 0) < 1
            or row.get('task_processed_at') is None
            or str(row.get('task_claim_token') or '') != ''
            or str(row.get('task_side_effect_state') or '') not in ('', 'finalized')
            or str(row.get('task_side_effect_token') or '') != ''
            or result.get('status') != 'deleted'
            or result.get('spacecloudStatus') != 'deleted'
            or result.get('dbStatus') != 'done'
            or int(result.get('taskId') or 0) != int(row.get('task_id') or 0)
            or str(result.get('reservationNo') or '').strip() != reservation_number
            or str(result.get('roomKey') or '').strip().lower() != room_key
            or clean_date_or_none(result.get('date')) != reservation_date
            or clean_time_or_none(result.get('startTime')) != start_time
            or clean_time_or_none(result.get('endTime')) != end_time
            or normalize_reserver_name_for_match(result.get('reserverName')) != event_name
            or not isinstance(verification, dict)
            or verification.get('ok') is not True
            or not isinstance(verification_identity, dict)
            or verification_identity.get('mode') != 'reservation-number'
            or verification_identity.get('nameMatched') is not True
            or verification_identity.get('reservationNoMatched') is not True
            or str(verification_identity.get('reservationNo') or '').strip()
            != reservation_number
            or not isinstance(remaining, dict)
            or remaining.get('candidates') != []
            or not isinstance(google_calendar, dict)
            or google_calendar.get('status') != 'deleted'
            or not isinstance(verified_attempts, list)
            or not any(
                isinstance(attempt, dict) and attempt.get('status') == 'verified'
                for attempt in verified_attempts
            )
    ):
        return False
    return True


def normalize_legacy_manual_naver_terminal_cancellations(cursor):
    """Seal proven pre-saga manual cancellations without trusting their clock."""
    cursor.execute(
        """
        SELECT ledger.id AS ledger_id,
               ledger.source_platform AS ledger_source_platform,
               ledger.current_status AS ledger_current_status,
               ledger.reservation_number AS ledger_reservation_number,
               ledger.room_key AS ledger_room_key,
               ledger.reserver_name AS ledger_reserver_name,
               ledger.reservation_date AS ledger_reservation_date,
               ledger.start_time AS ledger_start_time,
               ledger.end_time AS ledger_end_time,
               ledger.canceled_email_event_id AS ledger_canceled_email_event_id,
               ledger.canceled_email_received_at AS ledger_canceled_email_received_at,
               ledger.last_event_at AS ledger_last_event_at,
               ledger.last_event_id AS ledger_last_event_id,
               ledger.last_event_order_key AS ledger_last_event_order_key,
               ledger.automation_canceled_at AS ledger_automation_canceled_at,
               ledger.automation_canceled_order_key AS ledger_automation_canceled_order_key,
               ledger.automation_cancel_task_id AS ledger_automation_cancel_task_id,
               ledger.automation_cancel_platform AS ledger_automation_cancel_platform,
               ledger.cancel_payload_json AS ledger_cancel_payload_json,
               event_row.id AS event_id,
               event_row.mail_key AS event_mail_key,
               event_row.mailbox AS event_mailbox,
               event_row.imap_id AS event_imap_id,
               event_row.message_id AS event_message_id,
               event_row.email_received_at AS event_received_at,
               event_row.event_order_key AS event_order_key,
               event_row.event_order_trusted AS event_order_trusted,
               event_row.event_type AS event_type,
               event_row.parse_status AS event_parse_status,
               event_row.processing_status AS event_processing_status,
               event_row.spacecloud_room_key AS event_room_key,
               event_row.reservation_number AS event_reservation_number,
               event_row.reserver_name AS event_reserver_name,
               event_row.reservation_date AS event_reservation_date,
               event_row.start_time AS event_start_time,
               event_row.end_time AS event_end_time,
               event_row.error_text AS event_error_text,
               event_row.parsed_json AS event_parsed_json,
               task.id AS task_id,
               task.email_event_id AS task_email_event_id,
               task.booking_ledger_id AS task_booking_ledger_id,
               task.task_type AS task_type,
               task.status AS task_status,
               task.room_key AS task_room_key,
               task.reservation_number AS task_reservation_number,
               task.reserver_name AS task_reserver_name,
               task.reservation_date AS task_reservation_date,
               task.start_time AS task_start_time,
               task.end_time AS task_end_time,
               task.attempts AS task_attempts,
               task.claim_token AS task_claim_token,
               task.side_effect_state AS task_side_effect_state,
               task.side_effect_token AS task_side_effect_token,
               task.side_effect_finalized_at AS task_side_effect_finalized_at,
               task.processed_at AS task_processed_at,
               task.payload_json AS task_payload_json,
               task.result_text AS task_result_text,
               (
                   SELECT COUNT(*)
                   FROM rhythmjoy_naver_email_events AS later_event
                   WHERE later_event.reservation_number=event_row.reservation_number
                     AND later_event.event_type IN ('reservation','cancellation')
                     AND later_event.parse_status='parsed'
                     AND later_event.event_order_trusted=1
                     AND later_event.event_order_key>=event_row.event_order_key
                     AND COALESCE(later_event.error_text, '') NOT LIKE '%no_side_effects%'
               ) AS later_trusted_event_count
        FROM rhythmjoy_booking_ledger AS ledger
        INNER JOIN rhythmjoy_naver_email_events AS event_row
                ON event_row.id=ledger.canceled_email_event_id
        LEFT JOIN rhythmjoy_spacecloud_tasks AS task
               ON task.email_event_id=event_row.id
              AND task.task_type='delete'
        WHERE ledger.source_platform='naver'
          AND ledger.current_status='canceled'
          AND event_row.mailbox='Manual'
          AND event_row.message_id=''
          AND event_row.event_type='cancellation'
          AND event_row.event_order_trusted=0
          AND (ledger.last_event_id IS NULL OR ledger.last_event_id=event_row.id)
        ORDER BY ledger.id ASC, task.id ASC
        FOR UPDATE
        """
    )
    rows = cursor.fetchall()
    groups = {}
    for row in rows:
        groups.setdefault((row.get('ledger_id'), row.get('event_id')), []).append(row)

    normalized = 0
    for group_rows in groups.values():
        if len(group_rows) != 1:
            raise ConfigError(
                'Legacy manual cancellation has ambiguous delete-task proof '
                f"ledger_id={group_rows[0].get('ledger_id')} "
                f'task_rows={len(group_rows)}'
            )
        row = group_rows[0]
        already_normalized = (
            int(row.get('task_booking_ledger_id') or 0)
            == int(row.get('ledger_id') or 0)
            and str(row.get('task_side_effect_state') or '') == 'finalized'
            and row.get('task_side_effect_finalized_at') is not None
            and str(row.get('ledger_automation_canceled_at') or '')
            == str(row.get('event_received_at') or '')
            and int(row.get('ledger_automation_cancel_task_id') or 0)
            == int(row.get('task_id') or 0)
            and str(row.get('ledger_automation_cancel_platform') or '') == 'naver'
            and int(row.get('ledger_last_event_id') or 0) == 0
            and row.get('ledger_last_event_order_key') is None
        )
        if not legacy_manual_naver_terminal_delete_proof(
                row,
                allow_later_trusted_events=already_normalized,
        ):
            raise ConfigError(
                'Legacy manual cancellation lacks exact terminal proof '
                f"ledger_id={row.get('ledger_id')} event_id={row.get('event_id')}"
            )
        if already_normalized:
            continue
        cursor.execute(
            """
            UPDATE rhythmjoy_spacecloud_tasks
            SET booking_ledger_id=%s,
                side_effect_state='finalized',
                side_effect_token='',
                side_effect_finalized_at=COALESCE(
                    side_effect_finalized_at,
                    processed_at
                ),
                confirmation_sms_required=0,
                updated_at=NOW()
            WHERE id=%s
              AND email_event_id=%s
              AND task_type='delete'
              AND status='done'
              AND attempts>0
              AND processed_at IS NOT NULL
              AND claim_token=''
              AND side_effect_token=''
              AND (side_effect_state IS NULL OR side_effect_state='finalized')
              AND (booking_ledger_id IS NULL OR booking_ledger_id=%s)
              AND reservation_number=%s
              AND room_key=%s
              AND reservation_date <=> %s
              AND start_time <=> %s
              AND end_time <=> %s
              AND payload_json=%s
              AND result_text=%s
            """,
            (
                row.get('ledger_id'),
                row.get('task_id'),
                row.get('event_id'),
                row.get('ledger_id'),
                row.get('event_reservation_number'),
                row.get('event_room_key'),
                row.get('event_reservation_date'),
                row.get('event_start_time'),
                row.get('event_end_time'),
                row.get('task_payload_json'),
                row.get('task_result_text'),
            ),
        )
        if cursor.rowcount != 1:
            raise ConfigError(
                'Legacy manual terminal delete changed during normalization '
                f"task_id={row.get('task_id')}"
            )
        cursor.execute(
            """
            UPDATE rhythmjoy_booking_ledger
            SET automation_canceled_at=COALESCE(
                    automation_canceled_at,
                    %s
                ),
                automation_canceled_order_key=NULL,
                automation_cancel_task_id=%s,
                automation_cancel_platform='naver',
                last_event_id=NULL,
                last_event_order_key=NULL,
                updated_at=NOW()
            WHERE id=%s
              AND source_platform='naver'
              AND current_status='canceled'
              AND canceled_email_event_id=%s
              AND canceled_email_received_at <=> %s
              AND last_event_at <=> %s
              AND (last_event_id IS NULL OR last_event_id=%s)
              AND automation_canceled_order_key IS NULL
              AND (automation_canceled_at IS NULL OR automation_canceled_at <=> %s)
              AND (automation_cancel_task_id IS NULL OR automation_cancel_task_id=%s)
              AND (automation_cancel_platform='' OR automation_cancel_platform='naver')
            """,
            (
                row.get('event_received_at'),
                row.get('task_id'),
                row.get('ledger_id'),
                row.get('event_id'),
                row.get('event_received_at'),
                row.get('event_received_at'),
                row.get('event_id'),
                row.get('event_received_at'),
                row.get('task_id'),
            ),
        )
        if cursor.rowcount != 1:
            raise ConfigError(
                'Legacy manual terminal ledger changed during normalization '
                f"ledger_id={row.get('ledger_id')}"
            )
        normalized += 1
    return normalized


def backfill_booking_ledger_last_event_id(cursor):
    """Attach the event-id half of the legacy last-event ordering tuple safely.

    Legacy rows only stored the timestamp.  When both event kinds share that
    timestamp, retain the event kind represented by the materialized status;
    a replay of a later same-second event can then advance it deterministically.
    Rows whose timestamp cannot be tied to a recorded email event stay NULL.
    """
    cursor.execute(
        """
        UPDATE rhythmjoy_booking_ledger
        SET last_event_id=CASE
                WHEN current_status='confirmed'
                     AND confirmed_email_received_at=last_event_at
                     AND confirmed_email_event_id IS NOT NULL
                    THEN confirmed_email_event_id
                WHEN current_status='canceled'
                     AND canceled_email_received_at=last_event_at
                     AND canceled_email_event_id IS NOT NULL
                    THEN canceled_email_event_id
                WHEN confirmed_email_received_at=last_event_at
                     AND canceled_email_received_at=last_event_at
                    THEN GREATEST(
                        COALESCE(confirmed_email_event_id, 0),
                        COALESCE(canceled_email_event_id, 0)
                    )
                WHEN confirmed_email_received_at=last_event_at
                    THEN confirmed_email_event_id
                WHEN canceled_email_received_at=last_event_at
                    THEN canceled_email_event_id
                ELSE NULL
            END
        WHERE last_event_id IS NULL
          AND last_event_at IS NOT NULL
          AND automation_canceled_at IS NULL
          AND automation_canceled_order_key IS NULL
          AND (
              (confirmed_email_received_at=last_event_at AND confirmed_email_event_id IS NOT NULL)
              OR
              (canceled_email_received_at=last_event_at AND canceled_email_event_id IS NOT NULL)
          )
        """
    )
    return cursor.rowcount


def backfill_booking_ledger_last_event_order_key(cursor):
    """Backfill the ledger ordering clock without reinterpreting its status."""
    expected_key_sql = """COALESCE(
        NULLIF(event_row.event_order_key, 0),
        CASE
            WHEN ledger.last_event_at IS NOT NULL
                THEN CAST(
                    TIMESTAMPDIFF(
                        SECOND,
                        '1970-01-01 09:00:00',
                        ledger.last_event_at
                    ) * 1000
                    AS UNSIGNED
                )
            ELSE NULL
        END
    )"""
    cursor.execute(
        f"""
        UPDATE rhythmjoy_booking_ledger AS ledger
        LEFT JOIN rhythmjoy_naver_email_events AS event_row
               ON event_row.id=ledger.last_event_id
        SET ledger.last_event_order_key={expected_key_sql}
        WHERE NOT (
            ledger.last_event_order_key <=> {expected_key_sql}
        )
          AND ledger.automation_canceled_at IS NULL
          AND ledger.automation_canceled_order_key IS NULL
        """
    )
    return cursor.rowcount


def force_project_latest_trusted_naver_event(
        conn, latest_entry, confirmed_entry, canceled_entry):
    """Repair an equal-tuple partial projection while preserving automation fences."""
    latest_row, latest_data, calendar_key = latest_entry
    projection = booking_ledger_row(
        'naver',
        latest_data,
        calendar_key,
        latest_row.get('id'),
        latest_row.get('email_received_at'),
        latest_row.get('event_order_key'),
    )

    def event_pointer(entry):
        if not entry:
            return None, None, None
        event_row, event_data, event_calendar = entry
        pointer_row = booking_ledger_row(
            'naver',
            event_data,
            event_calendar,
            event_row.get('id'),
            event_row.get('email_received_at'),
            event_row.get('event_order_key'),
        )
        return (
            event_row.get('id'),
            pointer_row.get('event_at'),
            pointer_row.get('payload_json'),
        )

    confirmed_id, confirmed_at, confirmed_payload = event_pointer(confirmed_entry)
    canceled_id, canceled_at, canceled_payload = event_pointer(canceled_entry)
    projection.update({
        'ledger_id': None,
        'current_status': (
            'confirmed'
            if latest_row.get('event_type') == 'reservation'
            else 'canceled'
        ),
        'confirmed_event_id': confirmed_id,
        'confirmed_event_at': confirmed_at,
        'confirmed_payload': confirmed_payload,
        'canceled_event_id': canceled_id,
        'canceled_event_at': canceled_at,
        'canceled_payload': canceled_payload,
    })
    with conn.cursor() as cursor:
        cursor.execute(
            """
            SELECT id
            FROM rhythmjoy_booking_ledger
            WHERE ledger_key=%s
            LIMIT 1
            FOR UPDATE
            """,
            (projection['ledger_key'],),
        )
        ledger = cursor.fetchone()
        if not ledger:
            raise ConfigError(
                f"Trusted Naver ledger disappeared during reproject key={projection['ledger_key']}"
            )
        projection['ledger_id'] = ledger.get('id')
        automation_guard = ""
        automation_clear = ""
        if latest_row.get('event_type') == 'reservation':
            automation_guard = """
              AND (
                  (
                      automation_canceled_order_key IS NOT NULL
                      AND %(event_order_key)s > automation_canceled_order_key
                  )
                  OR (
                      automation_canceled_order_key IS NULL
                      AND %(event_at)s > COALESCE(
                          automation_canceled_at,
                          '1000-01-01 00:00:00'
                      )
                  )
              )
            """
            automation_clear = """
                automation_canceled_at=NULL,
                automation_canceled_order_key=NULL,
                automation_cancel_task_id=NULL,
                automation_cancel_platform='',
            """
        cursor.execute(
            f"""
            UPDATE rhythmjoy_booking_ledger
            SET source_mode=%(source_mode)s,
                current_status=%(current_status)s,
                target_calendar=%(target_calendar)s,
                room_key=%(room_key)s,
                reservation_number=%(reservation_number)s,
                reserver_name=%(reserver_name)s,
                reserver_name_key=%(reserver_name_key)s,
                product=%(product)s,
                reservation_date=%(reservation_date)s,
                start_time=%(start_time)s,
                end_time=%(end_time)s,
                payment_status=IF(%(payment_status)s<>'', %(payment_status)s, payment_status),
                price=IF(
                    amount_source LIKE '%%platform-export',
                    price,
                    IF(%(price)s<>'', %(price)s, price)
                ),
                gross_amount=IF(
                    amount_source LIKE '%%platform-export',
                    gross_amount,
                    COALESCE(%(gross_amount)s, gross_amount)
                ),
                fee_amount=IF(
                    amount_source LIKE '%%platform-export',
                    fee_amount,
                    COALESCE(%(fee_amount)s, fee_amount)
                ),
                net_amount=IF(
                    amount_source LIKE '%%platform-export',
                    net_amount,
                    COALESCE(%(net_amount)s, net_amount)
                ),
                amount_source=IF(
                    amount_source LIKE '%%platform-export',
                    amount_source,
                    IF(%(amount_source)s<>'', %(amount_source)s, amount_source)
                ),
                payment_method=IF(
                    amount_source LIKE '%%platform-export',
                    payment_method,
                    IF(%(payment_method)s<>'', %(payment_method)s, payment_method)
                ),
                confirmed_email_event_id=%(confirmed_event_id)s,
                confirmed_email_received_at=%(confirmed_event_at)s,
                payload_json=%(confirmed_payload)s,
                canceled_email_event_id=%(canceled_event_id)s,
                canceled_email_received_at=%(canceled_event_at)s,
                cancel_payload_json=%(canceled_payload)s,
                {automation_clear}
                last_event_at=%(event_at)s,
                last_event_id=%(email_event_id)s,
                last_event_order_key=%(event_order_key)s,
                updated_at=NOW()
            WHERE id=%(ledger_id)s
            {automation_guard}
            """,
            projection,
        )
        return cursor.rowcount


def reproject_naver_booking_ledgers(config, logger, conn):
    """Replay durable Naver events in source-clock order before task migration."""
    with conn.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, ledger_key, current_status,
                   confirmed_email_event_id, canceled_email_event_id,
                   last_event_id, last_event_order_key
            FROM rhythmjoy_booking_ledger
            WHERE source_platform='naver'
            """
        )
        initial_ledgers = {
            row.get('ledger_key'): row
            for row in cursor.fetchall()
        }
        cursor.execute(
            """
            SELECT id, event_type, email_received_at, event_order_key,
                   event_order_trusted,
                   target_calendar, parsed_json
            FROM rhythmjoy_naver_email_events
            WHERE event_type IN ('reservation', 'cancellation')
              AND parse_status='parsed'
              AND event_order_trusted=1
              AND event_order_key IS NOT NULL
              AND event_order_key>0
              AND COALESCE(error_text, '') NOT LIKE '%no_side_effects%'
            ORDER BY event_order_key ASC, id ASC
            """
        )
        rows = cursor.fetchall()

    processed = 0
    skipped = 0
    quarantined = 0
    rebuild_groups = {}
    for row in rows:
        event_data = load_event_payload(row)
        if not event_data:
            skipped += 1
            continue
        calendar_key = (
            row.get('target_calendar')
            or event_data.get('target_calendar')
            or event_data.get('calendar_key')
            or product_to_calendar_key(event_data.get('product', ''))
        )
        if row.get('event_type') == 'cancellation':
            with conn.cursor() as cursor:
                event_data, calendar_key, prior_proof = (
                    enrich_naver_cancellation_from_prior_event(
                        cursor,
                        event_data,
                        calendar_key,
                        row.get('event_order_key'),
                    )
                )
                persist_enriched_naver_cancellation_event(
                    cursor,
                    row.get('id'),
                    event_data,
                    calendar_key,
                )
                missing_reservation_number = not str(
                    event_data.get('reservation_number') or ''
                ).strip()
                incomplete_identity = (
                    prior_proof.get('status') != 'ok'
                    or not naver_cancellation_identity_complete(
                        event_data,
                        calendar_key,
                    )
                )
                if missing_reservation_number or incomplete_identity:
                    quarantine_reason = (
                        'missing-reservation-number'
                        if missing_reservation_number
                        else (
                            prior_proof.get('status')
                            or 'incomplete-cancellation-identity'
                        )
                    )
                    insert_naver_cancellation_quarantine(
                        cursor,
                        row.get('id'),
                        event_data,
                        calendar_key,
                        quarantine_reason,
                        True,
                    )
                    cursor.execute(
                        """
                        UPDATE rhythmjoy_naver_email_events
                        SET processing_status='needs_review',
                            error_text=%s,
                            updated_at=NOW()
                        WHERE id=%s
                        """,
                        (
                            f"{quarantine_reason.replace('-', '_')}_no_side_effects",
                            row.get('id'),
                        ),
                    )
                    quarantined += 1
                    continue
        if not calendar_key:
            skipped += 1
            logger.warning(
                'Naver ledger deterministic reproject skipped: no calendar row_id=%s type=%s',
                row.get('id'),
                row.get('event_type'),
            )
            continue

        if row.get('event_type') == 'reservation':
            if reservation_waits_for_payment(event_data):
                continue
            entry = (row, event_data, calendar_key)
            ledger_key = booking_ledger_key('naver', event_data, calendar_key)
            group = rebuild_groups.setdefault(ledger_key, {})
            prior_lifecycle = group.get('latest')
            if (
                    prior_lifecycle
                    and prior_lifecycle[0].get('event_type') == 'reservation'
            ):
                ledger = db_select_booking_ledger(config, ledger_key, conn=conn)
                if not ledger:
                    raise ConfigError(
                        'Consecutive trusted confirmation lost its prior ledger '
                        f"event_id={row.get('id')}"
                    )
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        UPDATE rhythmjoy_naver_email_events
                        SET processing_status='awaiting_predecessor',
                            error_text='confirmed_generation_waiting_for_cancellation_no_side_effects',
                            updated_at=NOW()
                        WHERE id=%s
                        """,
                        (row.get('id'),),
                    )
                quarantined += 1
                continue
            group['latest'] = entry
            group['confirmed'] = entry
            upsert_booking_ledger_confirmed(
                config,
                logger,
                row.get('id'),
                event_data,
                calendar_key,
                row.get('email_received_at'),
                'naver',
                conn=conn,
                event_order_key=row.get('event_order_key'),
            )
        else:
            entry = (row, event_data, calendar_key)
            group = rebuild_groups.setdefault(
                booking_ledger_key('naver', event_data, calendar_key),
                {},
            )
            group['latest'] = entry
            group['canceled'] = entry
            upsert_booking_ledger_canceled(
                config,
                logger,
                row.get('id'),
                event_data,
                calendar_key,
                row.get('email_received_at'),
                'naver',
                conn=conn,
                event_order_key=row.get('event_order_key'),
            )
            with conn.cursor() as cursor:
                supersede_waiting_naver_confirmations(
                    cursor,
                    event_data,
                    calendar_key,
                    row.get('event_order_key'),
                )
        processed += 1

    direct_repair_count = 0
    for group in rebuild_groups.values():
        direct_repair_count += force_project_latest_trusted_naver_event(
            conn,
            group['latest'],
            group.get('confirmed'),
            group.get('canceled'),
        )

    if skipped:
        logger.warning(
            'Naver ledger deterministic reproject skipped invalid rows count=%s',
            skipped,
        )
    if quarantined:
        logger.warning(
            'Naver ledger reproject quarantined incomplete cancellations count=%s',
            quarantined,
        )
    if direct_repair_count:
        logger.info(
            'Directly repaired trusted Naver ledger projections count=%s',
            direct_repair_count,
        )
    with conn.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, ledger_key, current_status,
                   confirmed_email_event_id, canceled_email_event_id,
                   last_event_id, last_event_order_key
            FROM rhythmjoy_booking_ledger
            WHERE source_platform='naver'
            """
        )
        final_ledgers = cursor.fetchall()

    generation_fields = (
        'current_status',
        'confirmed_email_event_id',
        'canceled_email_event_id',
        'last_event_id',
        'last_event_order_key',
    )
    changed_ledger_ids = []
    target_ledger_ids = []
    for final_row in final_ledgers:
        if final_row.get('ledger_key') in rebuild_groups:
            target_ledger_ids.append(int(final_row['id']))
        initial_row = initial_ledgers.get(final_row.get('ledger_key'))
        if initial_row is None or any(
                initial_row.get(field) != final_row.get(field)
                for field in generation_fields
        ):
            changed_ledger_ids.append(int(final_row['id']))
    return processed, changed_ledger_ids, target_ledger_ids


def audit_trusted_naver_ledger_pointers(cursor):
    """Fail closed when a projected Naver generation lacks a trusted source clock."""
    cursor.execute(
        """
        SELECT ledger.id, ledger.reservation_number, ledger.last_event_id,
               event_row.event_type, event_row.event_order_trusted
        FROM rhythmjoy_booking_ledger AS ledger
        LEFT JOIN rhythmjoy_naver_email_events AS event_row
               ON event_row.id=ledger.last_event_id
        WHERE ledger.source_platform='naver'
          AND ledger.last_event_id IS NOT NULL
          AND (
              event_row.id IS NULL
              OR event_row.event_type NOT IN ('reservation', 'cancellation')
              OR event_row.event_order_trusted<>1
              OR (
                  event_row.event_type='cancellation'
                  AND event_row.reservation_number=''
              )
          )
        ORDER BY ledger.id ASC
        LIMIT 21
        """
    )
    rows = cursor.fetchall()
    if not rows:
        return
    sample = ','.join(
        f"{row.get('id')}:{row.get('last_event_id') or 'missing'}"
        for row in rows[:20]
    )
    suffix = '+' if len(rows) > 20 else ''
    raise ConfigError(
        'Untrusted Naver ledger generation requires manual audit '
        f'ledger:last_event={sample}{suffix}'
    )


def audit_trusted_naver_event_order_collisions(cursor):
    """Reject opposing lifecycle events sharing one trusted source millisecond."""
    cursor.execute(
        """
        SELECT reservation_number, event_order_key,
               MIN(id) AS first_event_id, MAX(id) AS last_event_id
        FROM rhythmjoy_naver_email_events
        WHERE event_type IN ('reservation', 'cancellation')
          AND parse_status='parsed'
          AND event_order_trusted=1
          AND event_order_key IS NOT NULL
          AND reservation_number<>''
          AND COALESCE(error_text, '') NOT LIKE '%no_side_effects%'
        GROUP BY reservation_number, event_order_key
        HAVING SUM(event_type='reservation')>0
           AND SUM(event_type='cancellation')>0
        ORDER BY reservation_number ASC, event_order_key ASC
        LIMIT 21
        """
    )
    rows = cursor.fetchall()
    if not rows:
        return
    sample = ','.join(
        f"{row.get('reservation_number')}@{row.get('event_order_key')}"
        for row in rows[:20]
    )
    suffix = '+' if len(rows) > 20 else ''
    raise ConfigError(
        'Opposing trusted Naver events share one source millisecond '
        f'collisions={sample}{suffix}'
    )


def audit_naver_ledger_projection_invariants(cursor):
    """Verify the materialized state matches its trusted winning email event."""
    cursor.execute(
        """
        SELECT ledger.id, ledger.last_event_id, ledger.current_status,
               event_row.event_type
        FROM rhythmjoy_booking_ledger AS ledger
        INNER JOIN rhythmjoy_naver_email_events AS event_row
                ON event_row.id=ledger.last_event_id
        WHERE ledger.source_platform='naver'
          AND ledger.automation_canceled_at IS NULL
          AND ledger.automation_canceled_order_key IS NULL
          AND (
              NOT (ledger.last_event_order_key <=> event_row.event_order_key)
              OR (
                  event_row.event_type='reservation'
                  AND (
                      ledger.current_status<>'confirmed'
                      OR NOT (
                          ledger.confirmed_email_event_id
                          <=> ledger.last_event_id
                      )
                  )
              )
              OR (
                  event_row.event_type='cancellation'
                  AND (
                      ledger.current_status<>'canceled'
                      OR NOT (
                          ledger.canceled_email_event_id
                          <=> ledger.last_event_id
                      )
                  )
              )
          )
        ORDER BY ledger.id ASC
        LIMIT 21
        """
    )
    rows = cursor.fetchall()
    if not rows:
        return
    sample = ','.join(
        f"{row.get('id')}:{row.get('last_event_id')}:{row.get('event_type')}"
        for row in rows[:20]
    )
    suffix = '+' if len(rows) > 20 else ''
    raise ConfigError(
        'Naver ledger projection invariant failed '
        f'ledger:last_event:type={sample}{suffix}'
    )


def audit_naver_task_projection_invariants(cursor):
    """Require exact tasks only where durable automation provenance exists."""
    cursor.execute(
        """
        SELECT ledger.id AS ledger_id,
               ledger.confirmed_email_event_id AS event_id,
               COUNT(task.id) AS task_count,
               COALESCE(SUM(
                   task.booking_ledger_id=ledger.id
                   AND task.reservation_number=event_row.reservation_number
                   AND task.room_key=event_row.spacecloud_room_key
                   AND task.reservation_date <=> event_row.reservation_date
                   AND task.start_time <=> event_row.start_time
                   AND task.end_time <=> event_row.end_time
                   AND ledger.reservation_number=event_row.reservation_number
                   AND ledger.room_key=event_row.spacecloud_room_key
                   AND ledger.reservation_date <=> event_row.reservation_date
                   AND ledger.start_time <=> event_row.start_time
                   AND ledger.end_time <=> event_row.end_time
               ), 0) AS exact_task_count
        FROM rhythmjoy_booking_ledger AS ledger
        INNER JOIN rhythmjoy_naver_email_events AS event_row
                ON event_row.id=ledger.confirmed_email_event_id
        LEFT JOIN rhythmjoy_spacecloud_tasks AS task
               ON task.task_type='upload'
              AND task.email_event_id=ledger.confirmed_email_event_id
        WHERE ledger.source_platform='naver'
          AND ledger.current_status='confirmed'
          AND event_row.event_type='reservation'
          AND event_row.parse_status='parsed'
          AND event_row.event_order_trusted=1
          AND (
              event_row.processing_status LIKE 'spacecloud_upload_%'
              OR EXISTS (
                  SELECT 1
                  FROM rhythmjoy_spacecloud_tasks AS provenance_task
                  WHERE provenance_task.task_type='upload'
                    AND provenance_task.email_event_id=event_row.id
              )
          )
        GROUP BY ledger.id, ledger.confirmed_email_event_id
        HAVING task_count<>1 OR exact_task_count<>1
        ORDER BY ledger.id ASC
        LIMIT 21
        """
    )
    rows = cursor.fetchall()
    if rows:
        sample = ','.join(
            f"{row.get('ledger_id')}:{row.get('event_id')}:{row.get('task_count')}"
            for row in rows[:20]
        )
        suffix = '+' if len(rows) > 20 else ''
        raise ConfigError(
            'Current confirmed Naver generation lacks one exact upload task '
            f'ledger:event:tasks={sample}{suffix}'
        )

    cursor.execute(
        """
        SELECT event_row.id AS event_id,
               COUNT(task.id) AS task_count,
               COALESCE(SUM(
                   task.booking_ledger_id IS NOT NULL
                   AND ledger.source_platform='naver'
                   AND ledger.reservation_number=event_row.reservation_number
                   AND task.reservation_number=event_row.reservation_number
                   AND task.room_key=event_row.spacecloud_room_key
                   AND task.reservation_date <=> event_row.reservation_date
                   AND task.start_time <=> event_row.start_time
                   AND task.end_time <=> event_row.end_time
               ), 0) AS exact_task_count
        FROM rhythmjoy_naver_email_events AS event_row
        LEFT JOIN rhythmjoy_spacecloud_tasks AS task
               ON task.task_type='delete'
              AND task.email_event_id=event_row.id
        LEFT JOIN rhythmjoy_booking_ledger AS ledger
               ON ledger.id=task.booking_ledger_id
        WHERE event_row.event_type='cancellation'
          AND event_row.parse_status='parsed'
          AND event_row.event_order_trusted=1
          AND event_row.event_order_key IS NOT NULL
          AND event_row.event_order_key>0
          AND NOT (
              event_row.processing_status='needs_review'
              AND COALESCE(event_row.error_text, '') LIKE '%no_side_effects%'
          )
          AND (
              event_row.processing_status LIKE 'spacecloud_delete_%'
              OR EXISTS (
                  SELECT 1
                  FROM rhythmjoy_spacecloud_tasks AS provenance_task
                  WHERE provenance_task.task_type='delete'
                    AND provenance_task.email_event_id=event_row.id
              )
          )
        GROUP BY event_row.id
        HAVING task_count<>1 OR exact_task_count<>1
        ORDER BY event_row.id ASC
        LIMIT 21
        """
    )
    rows = cursor.fetchall()
    if rows:
        sample = ','.join(
            f"{row.get('event_id')}:{row.get('task_count')}"
            for row in rows[:20]
        )
        suffix = '+' if len(rows) > 20 else ''
        raise ConfigError(
            'Trusted Naver cancellation lacks one exact delete task '
            f'event:tasks={sample}{suffix}'
        )

    cursor.execute(
        """
        SELECT event_row.id AS event_id,
               COUNT(task.id) AS task_count,
               COALESCE(SUM(
                   task.status='needs_review'
                   AND task.side_effect_state IS NULL
               ), 0) AS quarantine_task_count
        FROM rhythmjoy_naver_email_events AS event_row
        LEFT JOIN rhythmjoy_spacecloud_tasks AS task
               ON task.task_type='delete'
              AND task.email_event_id=event_row.id
        WHERE event_row.event_type='cancellation'
          AND event_row.parse_status='parsed'
          AND event_row.event_order_trusted=1
          AND event_row.event_order_key IS NOT NULL
          AND event_row.event_order_key>0
          AND event_row.processing_status='needs_review'
          AND COALESCE(event_row.error_text, '') LIKE '%no_side_effects%'
        GROUP BY event_row.id
        HAVING task_count<>1 OR quarantine_task_count<>1
        ORDER BY event_row.id ASC
        LIMIT 21
        """
    )
    rows = cursor.fetchall()
    if rows:
        sample = ','.join(
            f"{row.get('event_id')}:{row.get('task_count')}"
            for row in rows[:20]
        )
        suffix = '+' if len(rows) > 20 else ''
        raise ConfigError(
            'Quarantined trusted Naver cancellation lacks one inert blocker task '
            f'event:tasks={sample}{suffix}'
        )

    cursor.execute(
        """
        SELECT event_row.id AS event_id,
               COUNT(task.id) AS task_count,
               COALESCE(SUM(
                   task.status='needs_review'
                   AND task.side_effect_state IS NULL
                   AND task.reservation_number=event_row.reservation_number
                   AND task.room_key=event_row.spacecloud_room_key
                   AND task.reservation_date <=> event_row.reservation_date
                   AND task.start_time <=> event_row.start_time
                   AND task.end_time <=> event_row.end_time
                   AND (
                       task.booking_ledger_id IS NULL
                       OR (
                           ledger.source_platform='naver'
                           AND ledger.reservation_number=event_row.reservation_number
                       )
                   )
               ), 0) AS quarantine_task_count
        FROM rhythmjoy_naver_email_events AS event_row
        LEFT JOIN rhythmjoy_spacecloud_tasks AS task
               ON task.task_type='upload'
              AND task.email_event_id=event_row.id
        LEFT JOIN rhythmjoy_booking_ledger AS ledger
               ON ledger.id=task.booking_ledger_id
        WHERE event_row.event_type='reservation'
          AND event_row.parse_status='parsed'
          AND event_row.event_order_trusted=1
          AND event_row.event_order_key IS NOT NULL
          AND event_row.event_order_key>0
          AND event_row.processing_status='needs_review'
          AND COALESCE(event_row.error_text, '') LIKE '%no_side_effects%'
        GROUP BY event_row.id
        HAVING task_count<>1 OR quarantine_task_count<>1
        ORDER BY event_row.id ASC
        LIMIT 21
        """
    )
    rows = cursor.fetchall()
    if rows:
        sample = ','.join(
            f"{row.get('event_id')}:{row.get('task_count')}"
            for row in rows[:20]
        )
        suffix = '+' if len(rows) > 20 else ''
        raise ConfigError(
            'Quarantined trusted Naver reservation lacks one inert blocker task '
            f'event:tasks={sample}{suffix}'
        )


def recover_reprojected_skipped_uploads(config, cursor, target_ledger_ids):
    """Re-arm only normalized never-submitted uploads for a replayed generation."""
    if not config.get('naver_spacecloud_upload_enabled'):
        return {'uploads': 0, 'sms': 0}
    sms_enabled = bool(config.get('confirmation_sms_enabled', True))
    ledger_ids = sorted({int(value) for value in target_ledger_ids if int(value) > 0})
    if not ledger_ids:
        return {'uploads': 0, 'sms': 0}
    placeholders = ','.join(['%s'] * len(ledger_ids))
    cursor.execute(
        f"""
        SELECT task.id, task.booking_ledger_id, task.side_effect_state,
               task.task_type, task.status, task.locked_at, task.claim_token,
               task.side_effect_token, task.side_effect_armed_at,
               task.result_text,
               ledger.id AS exact_ledger_id
        FROM rhythmjoy_booking_ledger AS ledger
        INNER JOIN rhythmjoy_spacecloud_tasks AS task
                ON task.task_type='upload'
               AND task.email_event_id=ledger.confirmed_email_event_id
               AND task.reservation_number=ledger.reservation_number
               AND task.room_key=ledger.room_key
               AND task.reservation_date <=> ledger.reservation_date
               AND task.start_time <=> ledger.start_time
               AND task.end_time <=> ledger.end_time
        WHERE ledger.id IN ({placeholders})
          AND ledger.source_platform='naver'
          AND ledger.current_status='confirmed'
        ORDER BY ledger.id ASC, task.id ASC
        FOR UPDATE
        """,
        ledger_ids,
    )
    candidates = cursor.fetchall()
    ambiguous = [
        row for row in candidates
        if row.get('side_effect_state') is None
        or (
            row.get('side_effect_state') == 'skipped'
            and int(row.get('booking_ledger_id') or 0) != int(row.get('exact_ledger_id') or 0)
        )
    ]
    if ambiguous:
        sample = ','.join(str(row.get('id')) for row in ambiguous[:20])
        suffix = '+' if len(ambiguous) > 20 else ''
        raise ConfigError(
            'Reprojected Naver generation has ambiguous legacy upload tasks '
            f'task_ids={sample}{suffix}'
        )

    recoverable = [
        row for row in candidates
        if row.get('side_effect_state') == 'skipped'
        and int(row.get('booking_ledger_id') or 0) == int(row.get('exact_ledger_id') or 0)
    ]
    if not recoverable:
        return {'uploads': 0, 'sms': 0}

    for row in recoverable:
        try:
            result = json.loads(row.get('result_text') or '{}')
        except (TypeError, ValueError):
            result = {}
        if (
                row.get('status') != 'done'
                or row.get('locked_at') is not None
                or row.get('claim_token')
                or row.get('side_effect_token')
                or row.get('side_effect_armed_at') is not None
                or not isinstance(result, dict)
                or result.get('status') != 'stale-ledger-skip'
                or result.get('submissionAttempted') is not False
                or result.get('mirrorMutationState') != 'not_created'
        ):
            raise ConfigError(
                'Reprojected skipped upload lacks normalized never-submitted proof '
                f"task_id={row.get('id')}"
            )

    if sms_enabled:
        recoverable_task_ids = [int(row['id']) for row in recoverable]
        task_placeholders = ','.join(['%s'] * len(recoverable_task_ids))
        cursor.execute(
            f"""
            SELECT id, source_task_id, status, attempt_count,
                   provider_code, provider_raw, sent_at, last_attempt_at
            FROM rhythmjoy_sms_deliveries
            WHERE source_task_type='upload'
              AND source_task_id IN ({task_placeholders})
            ORDER BY source_task_id ASC, id ASC
            FOR UPDATE
            """,
            recoverable_task_ids,
        )
        deliveries = cursor.fetchall()
        contradictory_deliveries = [
            row for row in deliveries
            if not (
                row.get('status') == 'skipped'
                or (
                    row.get('status') in ('pending', 'failed', 'phone_lookup_failed')
                    and int(row.get('attempt_count') or 0) == 0
                    and not row.get('provider_code')
                    and not row.get('provider_raw')
                    and row.get('sent_at') is None
                    and row.get('last_attempt_at') is None
                )
            )
        ]
        if contradictory_deliveries:
            sample = ','.join(str(row.get('id')) for row in contradictory_deliveries[:20])
            suffix = '+' if len(contradictory_deliveries) > 20 else ''
            raise ConfigError(
                'Reprojected upload SMS proof contradiction '
                f'delivery_ids={sample}{suffix}'
            )

    recovered_task_ids = []
    for row in recoverable:
        cursor.execute(
            """
            UPDATE rhythmjoy_spacecloud_tasks AS task
            INNER JOIN rhythmjoy_booking_ledger AS ledger
                    ON ledger.id=task.booking_ledger_id
            SET task.status='pending',
                task.attempts=0,
                task.locked_at=NULL,
                task.claim_token='',
                task.side_effect_state='ready',
                task.side_effect_token='',
                task.side_effect_armed_at=NULL,
                task.side_effect_finalized_at=NULL,
                task.confirmation_sms_required=%s,
                task.processed_at=NULL,
                task.result_text=NULL,
                task.updated_at=NOW()
            WHERE task.id=%s
              AND task.task_type='upload'
              AND task.booking_ledger_id=%s
              AND task.email_event_id=ledger.confirmed_email_event_id
              AND task.status='done'
              AND task.side_effect_state='skipped'
              AND task.locked_at IS NULL
              AND task.claim_token=''
              AND task.side_effect_token=''
              AND task.side_effect_armed_at IS NULL
              AND task.result_text=%s
              AND ledger.source_platform='naver'
              AND ledger.current_status='confirmed'
              AND task.reservation_number=ledger.reservation_number
              AND task.room_key=ledger.room_key
              AND task.reservation_date <=> ledger.reservation_date
              AND task.start_time <=> ledger.start_time
              AND task.end_time <=> ledger.end_time
            """,
            (
                1 if sms_enabled else 0,
                row.get('id'),
                row.get('exact_ledger_id'),
                row.get('result_text'),
            ),
        )
        if cursor.rowcount != 1:
            raise ConfigError(
                f"Reprojected upload changed during atomic recovery task_id={row.get('id')}"
            )
        recovered_task_ids.append(int(row['id']))

    sms_resumed = 0
    for task_id in recovered_task_ids if sms_enabled else []:
        cursor.execute(
            """
            UPDATE rhythmjoy_sms_deliveries
            SET status='pending',
                error_text=NULL,
                next_retry_at=NULL,
                updated_at=NOW()
            WHERE source_task_type='upload'
              AND source_task_id=%s
              AND (
                  status='skipped'
                  OR (
                      status IN ('pending', 'failed', 'phone_lookup_failed')
                      AND attempt_count=0
                      AND provider_code=''
                      AND provider_raw=''
                      AND sent_at IS NULL
                      AND last_attempt_at IS NULL
                  )
              )
            """,
            (task_id,),
        )
        sms_resumed += cursor.rowcount
        ensure_confirmation_sms_intent(
            cursor,
            {'id': task_id, 'task_type': 'upload', 'status': 'pending'},
            enabled=sms_enabled,
        )

    return {'uploads': len(recovered_task_ids), 'sms': sms_resumed}


def fence_reprojected_canceled_uploads(cursor, target_ledger_ids):
    """Apply the normal ready-to-skipped fence to every replayed cancellation."""
    ledger_ids = sorted({int(value) for value in target_ledger_ids if int(value) > 0})
    if not ledger_ids:
        return 0
    placeholders = ','.join(['%s'] * len(ledger_ids))
    cursor.execute(
        f"""
        SELECT id, canceled_email_event_id
        FROM rhythmjoy_booking_ledger
        WHERE id IN ({placeholders})
          AND source_platform='naver'
          AND current_status='canceled'
          AND canceled_email_event_id IS NOT NULL
        ORDER BY id ASC
        FOR UPDATE
        """,
        ledger_ids,
    )
    canceled_ledgers = cursor.fetchall()
    fenced_count = 0
    for ledger in canceled_ledgers:
        fenced_count += fence_canceled_spacecloud_uploads(
            cursor,
            ledger.get('id'),
            ledger.get('canceled_email_event_id'),
        )
    return fenced_count


def ensure_db_tables(config, logger):
    if not config['db_enabled']:
        if config['db_required']:
            raise ConfigError('Email DB logging is required but DB_* env values are incomplete')
        logger.info('Email DB logging disabled: DB_* env values incomplete')
        return

    conn = None
    migration_conn = None
    try:
        conn = db_connect(config)
        with conn.cursor() as cursor:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS rhythmjoy_naver_email_events (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                    mail_key VARCHAR(128) NOT NULL,
                    mailbox VARCHAR(64) NOT NULL,
                    imap_id VARCHAR(64) NOT NULL DEFAULT '',
                    message_id VARCHAR(255) NOT NULL DEFAULT '',
                    email_received_at DATETIME NULL,
                    event_order_key BIGINT UNSIGNED NULL,
                    event_order_trusted TINYINT(1) NOT NULL DEFAULT 0,
                    subject VARCHAR(500) NOT NULL DEFAULT '',
                    event_type VARCHAR(32) NOT NULL DEFAULT 'unknown',
                    parse_status VARCHAR(32) NOT NULL DEFAULT 'unparsed',
                    processing_status VARCHAR(32) NOT NULL DEFAULT 'received',
                    target_calendar VARCHAR(64) NOT NULL DEFAULT '',
                    spacecloud_room_key VARCHAR(8) NOT NULL DEFAULT '',
                    reservation_number VARCHAR(64) NOT NULL DEFAULT '',
                    reserver_name VARCHAR(128) NOT NULL DEFAULT '',
                    product VARCHAR(255) NOT NULL DEFAULT '',
                    reservation_date DATE NULL,
                    start_time TIME NULL,
                    end_time TIME NULL,
                    payment_status VARCHAR(64) NOT NULL DEFAULT '',
                    price VARCHAR(64) NOT NULL DEFAULT '',
                    google_calendar_event_id VARCHAR(255) NOT NULL DEFAULT '',
                    google_calendar_deleted_count INT NOT NULL DEFAULT 0,
                    error_text TEXT NULL,
                    raw_body MEDIUMTEXT NULL,
                    parsed_json TEXT NULL,
                    created_at DATETIME NULL,
                    updated_at DATETIME NULL,
                    PRIMARY KEY (id),
                    UNIQUE KEY uq_mail_key (mail_key),
                    KEY idx_reservation_number (reservation_number),
                    KEY idx_email_received_at (email_received_at),
                    KEY idx_event_order (event_order_key, id),
                    KEY idx_event_trusted_order (event_order_trusted, event_order_key, id),
                    KEY idx_status (processing_status),
                    KEY idx_event_type (event_type),
                    KEY idx_spacecloud_room_date (spacecloud_room_key, reservation_date)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS rhythmjoy_spacecloud_tasks (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                    dedupe_key VARCHAR(96) NOT NULL,
                    email_event_id BIGINT UNSIGNED NULL,
                    booking_ledger_id BIGINT UNSIGNED NULL,
                    task_type VARCHAR(32) NOT NULL,
                    status VARCHAR(32) NOT NULL DEFAULT 'pending',
                    room_key VARCHAR(8) NOT NULL DEFAULT '',
                    reservation_number VARCHAR(64) NOT NULL DEFAULT '',
                    reserver_name VARCHAR(128) NOT NULL DEFAULT '',
                    reserver_name_key VARCHAR(128) NOT NULL DEFAULT '',
                    product VARCHAR(255) NOT NULL DEFAULT '',
                    reservation_date DATE NULL,
                    start_time TIME NULL,
                    end_time TIME NULL,
                    payload_json TEXT NULL,
                    attempts INT NOT NULL DEFAULT 0,
                    locked_at DATETIME NULL,
                    claim_token VARCHAR(64) NOT NULL DEFAULT '',
                    side_effect_state VARCHAR(24) NULL,
                    side_effect_token VARCHAR(64) NOT NULL DEFAULT '',
                    side_effect_armed_at DATETIME NULL,
                    side_effect_finalized_at DATETIME NULL,
                    confirmation_sms_required TINYINT(1) NOT NULL DEFAULT 0,
                    processed_at DATETIME NULL,
                    result_text TEXT NULL,
                    created_at DATETIME NULL,
                    updated_at DATETIME NULL,
                    PRIMARY KEY (id),
                    UNIQUE KEY uq_dedupe_key (dedupe_key),
                    KEY idx_status_type (status, task_type),
                    KEY idx_room_date (room_key, reservation_date),
                    KEY idx_booking_task (booking_ledger_id, task_type),
                    KEY idx_email_task (email_event_id, task_type)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS rhythmjoy_booking_ledger (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                    ledger_key VARCHAR(96) NOT NULL,
                    source_platform VARCHAR(32) NOT NULL DEFAULT '',
                    source_mode VARCHAR(64) NOT NULL DEFAULT '',
                    current_status VARCHAR(32) NOT NULL DEFAULT 'confirmed',
                    target_calendar VARCHAR(64) NOT NULL DEFAULT '',
                    room_key VARCHAR(8) NOT NULL DEFAULT '',
                    reservation_number VARCHAR(64) NOT NULL DEFAULT '',
                    reserver_name VARCHAR(128) NOT NULL DEFAULT '',
                    product VARCHAR(255) NOT NULL DEFAULT '',
                    reservation_date DATE NULL,
                    start_time TIME NULL,
                    end_time TIME NULL,
                    payment_status VARCHAR(64) NOT NULL DEFAULT '',
                    price VARCHAR(64) NOT NULL DEFAULT '',
                    confirmed_email_event_id BIGINT UNSIGNED NULL,
                    canceled_email_event_id BIGINT UNSIGNED NULL,
                    confirmed_email_received_at DATETIME NULL,
                    canceled_email_received_at DATETIME NULL,
                    automation_canceled_order_key BIGINT UNSIGNED NULL,
                    last_event_at DATETIME NULL,
                    last_event_id BIGINT UNSIGNED NULL,
                    last_event_order_key BIGINT UNSIGNED NULL,
                    payload_json TEXT NULL,
                    cancel_payload_json TEXT NULL,
                    created_at DATETIME NULL,
                    updated_at DATETIME NULL,
                    PRIMARY KEY (id),
                    UNIQUE KEY uq_ledger_key (ledger_key),
                    KEY idx_status_time (current_status, reservation_date, start_time),
                    KEY idx_reservation_number (reservation_number),
                    KEY idx_room_date (room_key, reservation_date)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS rhythmjoy_sms_deliveries (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                    idempotency_key VARCHAR(160) NOT NULL,
                    source_task_type VARCHAR(32) NOT NULL DEFAULT '',
                    source_task_id BIGINT UNSIGNED NULL,
                    template_name VARCHAR(64) NOT NULL DEFAULT '',
                    recipient_phone_hash CHAR(64) NOT NULL DEFAULT '',
                    recipient_phone_last4 VARCHAR(4) NOT NULL DEFAULT '',
                    status VARCHAR(32) NOT NULL DEFAULT 'pending',
                    provider_code VARCHAR(64) NOT NULL DEFAULT '',
                    provider_remaining INT NULL,
                    provider_raw VARCHAR(255) NOT NULL DEFAULT '',
                    error_text TEXT NULL,
                    attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
                    first_failed_at DATETIME NULL,
                    last_attempt_at DATETIME NULL,
                    next_retry_at DATETIME NULL,
                    sent_at DATETIME NULL,
                    created_at DATETIME NULL,
                    updated_at DATETIME NULL,
                    PRIMARY KEY (id),
                    UNIQUE KEY uq_idempotency_key (idempotency_key),
                    KEY idx_status (status),
                    KEY idx_task (source_task_type, source_task_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            ensure_db_column(cursor, 'rhythmjoy_naver_email_events', 'email_received_at', 'DATETIME NULL AFTER message_id')
            ensure_db_column(cursor, 'rhythmjoy_naver_email_events', 'event_order_key', 'BIGINT UNSIGNED NULL AFTER email_received_at')
            ensure_db_column(cursor, 'rhythmjoy_naver_email_events', 'event_order_trusted', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER event_order_key')
            ensure_db_index(
                cursor,
                'rhythmjoy_naver_email_events',
                'idx_event_order',
                ('event_order_key', 'id'),
            )
            ensure_db_index(
                cursor,
                'rhythmjoy_naver_email_events',
                'idx_event_trusted_order',
                ('event_order_trusted', 'event_order_key', 'id'),
            )
            ensure_db_column(cursor, 'rhythmjoy_booking_ledger', 'reserver_name_key', "VARCHAR(128) NOT NULL DEFAULT '' AFTER reserver_name")
            ensure_db_column(cursor, 'rhythmjoy_booking_ledger', 'gross_amount', 'INT UNSIGNED NULL AFTER price')
            ensure_db_column(cursor, 'rhythmjoy_booking_ledger', 'fee_amount', 'INT UNSIGNED NULL AFTER gross_amount')
            ensure_db_column(cursor, 'rhythmjoy_booking_ledger', 'net_amount', 'INT UNSIGNED NULL AFTER fee_amount')
            ensure_db_column(cursor, 'rhythmjoy_booking_ledger', 'amount_source', "VARCHAR(64) NOT NULL DEFAULT '' AFTER net_amount")
            ensure_db_column(cursor, 'rhythmjoy_booking_ledger', 'payment_method', "VARCHAR(64) NOT NULL DEFAULT '' AFTER amount_source")
            ensure_db_column(cursor, 'rhythmjoy_booking_ledger', 'automation_canceled_at', 'DATETIME NULL AFTER canceled_email_received_at')
            ensure_db_column(cursor, 'rhythmjoy_booking_ledger', 'automation_canceled_order_key', 'BIGINT UNSIGNED NULL AFTER automation_canceled_at')
            ensure_db_column(cursor, 'rhythmjoy_booking_ledger', 'automation_cancel_task_id', 'BIGINT UNSIGNED NULL AFTER automation_canceled_order_key')
            ensure_db_column(cursor, 'rhythmjoy_booking_ledger', 'automation_cancel_platform', "VARCHAR(32) NOT NULL DEFAULT '' AFTER automation_cancel_task_id")
            ensure_db_column(cursor, 'rhythmjoy_booking_ledger', 'last_event_id', 'BIGINT UNSIGNED NULL AFTER last_event_at')
            ensure_db_column(cursor, 'rhythmjoy_booking_ledger', 'last_event_order_key', 'BIGINT UNSIGNED NULL AFTER last_event_id')
            ensure_db_column(cursor, 'rhythmjoy_spacecloud_tasks', 'booking_ledger_id', 'BIGINT UNSIGNED NULL AFTER email_event_id')
            ensure_db_column(cursor, 'rhythmjoy_spacecloud_tasks', 'reserver_name_key', "VARCHAR(128) NOT NULL DEFAULT '' AFTER reserver_name")
            ensure_db_column(cursor, 'rhythmjoy_spacecloud_tasks', 'claim_token', "VARCHAR(64) NOT NULL DEFAULT '' AFTER locked_at")
            ensure_db_column(cursor, 'rhythmjoy_spacecloud_tasks', 'side_effect_state', 'VARCHAR(24) NULL AFTER claim_token')
            ensure_db_column(cursor, 'rhythmjoy_spacecloud_tasks', 'side_effect_token', "VARCHAR(64) NOT NULL DEFAULT '' AFTER side_effect_state")
            ensure_db_column(cursor, 'rhythmjoy_spacecloud_tasks', 'side_effect_armed_at', 'DATETIME NULL AFTER side_effect_token')
            ensure_db_column(cursor, 'rhythmjoy_spacecloud_tasks', 'side_effect_finalized_at', 'DATETIME NULL AFTER side_effect_armed_at')
            ensure_db_column(cursor, 'rhythmjoy_spacecloud_tasks', 'confirmation_sms_required', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER side_effect_finalized_at')
            ensure_db_index(
                cursor,
                'rhythmjoy_spacecloud_tasks',
                'idx_booking_task',
                ('booking_ledger_id', 'task_type'),
            )
            ensure_db_index(
                cursor,
                'rhythmjoy_spacecloud_tasks',
                'idx_email_task',
                ('email_event_id', 'task_type'),
            )
            ensure_db_empty_token_column(
                cursor,
                'rhythmjoy_spacecloud_tasks',
                'side_effect_token',
                "VARCHAR(64) NOT NULL DEFAULT ''",
            )
            ensure_db_column(cursor, 'rhythmjoy_sms_deliveries', 'attempt_count', 'INT UNSIGNED NOT NULL DEFAULT 0 AFTER error_text')
            ensure_db_column(cursor, 'rhythmjoy_sms_deliveries', 'first_failed_at', 'DATETIME NULL AFTER attempt_count')
            ensure_db_column(cursor, 'rhythmjoy_sms_deliveries', 'last_attempt_at', 'DATETIME NULL AFTER first_failed_at')
            ensure_db_column(cursor, 'rhythmjoy_sms_deliveries', 'next_retry_at', 'DATETIME NULL AFTER last_attempt_at')

        conn.close()
        conn = None
        migration_conn = db_connect(config, autocommit=False)
        migration_conn.begin()
        try:
            with migration_conn.cursor() as cursor:
                email_event_order_backfill_count = backfill_email_event_order_keys(cursor)
                ledger_event_id_backfill_count = backfill_booking_ledger_last_event_id(cursor)
                ledger_event_order_backfill_count = backfill_booking_ledger_last_event_order_key(cursor)
                legacy_manual_cancellation_normalized_count = (
                    normalize_legacy_manual_naver_terminal_cancellations(cursor)
                )
                audit_trusted_naver_event_order_collisions(cursor)
                audit_trusted_naver_ledger_pointers(cursor)
                # Startup migration is deliberately additive. Historical
                # ledgers and terminal tasks stay untouched; only never-claimed
                # work with exact current-generation proof is backfilled.
                task_backfill_counts = backfill_safe_spacecloud_task_state(cursor)
            migration_conn.commit()
        except Exception:
            migration_conn.rollback()
            raise

        if email_event_order_backfill_count:
            logger.info(
                'Backfilled email event order/trust values count=%s',
                email_event_order_backfill_count,
            )
        if ledger_event_id_backfill_count:
            logger.info(
                'Backfilled booking-ledger last event ids count=%s',
                ledger_event_id_backfill_count,
            )
        if ledger_event_order_backfill_count:
            logger.info(
                'Backfilled booking-ledger last event order keys count=%s',
                ledger_event_order_backfill_count,
            )
        if legacy_manual_cancellation_normalized_count:
            logger.warning(
                'Sealed verified legacy manual Naver cancellation anchors count=%s',
                legacy_manual_cancellation_normalized_count,
            )
        if any(task_backfill_counts.values()):
            logger.info(
                'Backfilled never-claimed trusted SpaceCloud tasks upload=%s delete=%s',
                task_backfill_counts.get('upload', 0),
                task_backfill_counts.get('delete', 0),
            )
        logger.info('Email DB tables checked')
    except Exception as error:
        disable_db_logging(config, logger, 'Email DB table check failed', error)
    finally:
        if conn is not None:
            conn.close()
        if migration_conn is not None:
            migration_conn.close()


def db_select_email_event(config, mail_key, conn=None):
    if not config['db_enabled']:
        return None
    owned_conn = conn is None
    try:
        if owned_conn:
            conn = db_connect(config)
        with conn.cursor() as cursor:
            cursor.execute(
                'SELECT * FROM rhythmjoy_naver_email_events WHERE mail_key=%s LIMIT 1',
                (mail_key,),
            )
            return cursor.fetchone()
    except Exception as error:
        if not owned_conn:
            raise
        disable_db_logging(config, logging.getLogger('rhythmjoy_email_import'), 'Email DB select failed', error)
        return None
    finally:
        if owned_conn and conn is not None:
            conn.close()


def canonical_parsed_identity(value):
    if isinstance(value, dict):
        payload = value
    else:
        try:
            payload = json.loads(value or '{}')
        except (TypeError, ValueError):
            return None
    if not isinstance(payload, dict):
        return None
    return json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(',', ':'),
    )


def parsed_email_replay_identity_matches(existing, incoming):
    """Compare durable parse identity without reinterpreting raw mail with new code."""
    try:
        durable_payload = json.loads(existing.get('parsed_json') or '{}')
        incoming_payload = json.loads(incoming.get('parsed_json') or '{}')
    except (TypeError, ValueError):
        return False
    if not isinstance(durable_payload, dict) or not isinstance(incoming_payload, dict):
        return False
    if str(existing.get('event_type') or '') != 'cancellation':
        return (
            canonical_parsed_identity(durable_payload)
            == canonical_parsed_identity(incoming_payload)
        )

    normalizers = {
        'name': normalize_reserver_name_for_match,
        'date': clean_date_or_none,
        'start_time': clean_time_or_none,
        'end_time': clean_time_or_none,
    }
    for key, incoming_value in incoming_payload.items():
        if key not in durable_payload:
            return False
        normalizer = normalizers.get(key, lambda value: value)
        if normalizer(durable_payload.get(key)) != normalizer(incoming_value):
            return False
    return True


def assert_email_event_replay_identity(existing, incoming):
    """Reject Message-ID/mail-key reuse before mutating durable inbox identity."""
    comparisons = {
        'mailbox': (
            str(existing.get('mailbox') or ''),
            str(incoming.get('mailbox') or ''),
        ),
        'message_id': (
            str(existing.get('message_id') or '').strip(),
            str(incoming.get('message_id') or '').strip(),
        ),
        'email_received_at': (
            str(existing.get('email_received_at') or '').strip(),
            str(incoming.get('email_received_at') or '').strip(),
        ),
        'event_order_key': (
            int(existing.get('event_order_key') or 0),
            int(incoming.get('event_order_key') or 0),
        ),
        'event_order_trusted': (
            int(existing.get('event_order_trusted') or 0),
            int(incoming.get('event_order_trusted') or 0),
        ),
        'event_type': (
            str(existing.get('event_type') or ''),
            str(incoming.get('event_type') or ''),
        ),
        'parse_status': (
            str(existing.get('parse_status') or ''),
            str(incoming.get('parse_status') or ''),
        ),
        'subject': (
            str(existing.get('subject') or ''),
            str(incoming.get('subject') or ''),
        ),
        'raw_body': (
            existing.get('raw_body'),
            incoming.get('raw_body'),
        ),
    }
    mismatches = [
        field for field, values in comparisons.items()
        if values[0] != values[1]
    ]
    if not parsed_email_replay_identity_matches(existing, incoming):
        mismatches.append('parsed_json')
    if mismatches:
        raise ConfigError(
            'Immutable email replay identity mismatch '
            f"event_id={existing.get('id')} mail_key={existing.get('mail_key')} "
            f"fields={','.join(sorted(set(mismatches)))}"
        )


def immutable_email_replay_resumes_handoff(email_row):
    return bool(
        (email_row or {}).get('_immutable_replay')
        and str((email_row or {}).get('processing_status') or '')
        in ('received', 'failed', 'awaiting_predecessor')
    )


def durable_email_replay_payload(email_row, fallback, calendar_key):
    if not immutable_email_replay_resumes_handoff(email_row):
        return fallback, calendar_key
    durable_payload = load_event_payload(email_row)
    durable_calendar = (
        email_row.get('target_calendar')
        or durable_payload.get('target_calendar')
        or durable_payload.get('calendar_key')
        or product_to_calendar_key(durable_payload.get('product', ''))
    )
    return durable_payload or None, durable_calendar


def upsert_email_event(config, logger, record, conn=None):
    if not config['db_enabled']:
        return None

    record.setdefault(
        'event_order_key',
        normalized_event_order_key(
            record.get('message_id'),
            record.get('email_received_at'),
        ),
    )
    record.setdefault(
        'event_order_trusted',
        event_order_source_is_trusted(
            record.get('message_id'),
            record.get('email_received_at'),
        ),
    )

    owned_conn = conn is None
    try:
        if owned_conn:
            conn = db_connect(config, autocommit=False)
            conn.begin()
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT *
                FROM rhythmjoy_naver_email_events
                WHERE mail_key=%s
                LIMIT 1
                FOR UPDATE
                """,
                (record['mail_key'],),
            )
            existing = cursor.fetchone()
            if existing:
                assert_email_event_replay_identity(existing, record)
                row = dict(existing)
                row['_immutable_replay'] = True
            else:
                cursor.execute(
                """
                INSERT INTO rhythmjoy_naver_email_events (
                    mail_key, mailbox, imap_id, message_id, email_received_at,
                    event_order_key, event_order_trusted, subject,
                    event_type, parse_status, processing_status,
                    target_calendar, spacecloud_room_key,
                    reservation_number, reserver_name, product,
                    reservation_date, start_time, end_time,
                    payment_status, price, raw_body, parsed_json,
                    created_at, updated_at
                )
                VALUES (
                    %(mail_key)s, %(mailbox)s, %(imap_id)s, %(message_id)s, %(email_received_at)s,
                    %(event_order_key)s, %(event_order_trusted)s, %(subject)s,
                    %(event_type)s, %(parse_status)s, %(processing_status)s,
                    %(target_calendar)s, %(spacecloud_room_key)s,
                    %(reservation_number)s, %(reserver_name)s, %(product)s,
                    %(reservation_date)s, %(start_time)s, %(end_time)s,
                    %(payment_status)s, %(price)s, %(raw_body)s, %(parsed_json)s,
                    NOW(), NOW()
                )
                """,
                record,
                )
                cursor.execute(
                    """
                    SELECT *
                    FROM rhythmjoy_naver_email_events
                    WHERE mail_key=%s
                    LIMIT 1
                    FOR UPDATE
                    """,
                    (record['mail_key'],),
                )
                row = cursor.fetchone()
        if owned_conn:
            conn.commit()
        logger.info('Email DB event saved id=%s type=%s status=%s', row.get('id') if row else '-', record['event_type'], record['processing_status'])
        return row
    except Exception as error:
        if owned_conn and conn is not None:
            conn.rollback()
        if isinstance(error, ConfigError):
            raise
        if not owned_conn:
            raise
        disable_db_logging(config, logger, 'Email DB event save failed', error)
        return None
    finally:
        if owned_conn and conn is not None:
            conn.close()


def update_email_processing(config, email_event_id, status, logger, conn=None, **fields):
    if not config['db_enabled'] or not email_event_id:
        return

    allowed = {
        'google_calendar_event_id',
        'google_calendar_deleted_count',
        'error_text',
    }
    assignments = ['processing_status=%s', 'updated_at=NOW()']
    values = [status]
    for key, value in fields.items():
        if key in allowed:
            assignments.append(f'{key}=%s')
            values.append(value)
    values.append(email_event_id)

    owned_conn = conn is None
    try:
        if owned_conn:
            conn = db_connect(config)
        with conn.cursor() as cursor:
            cursor.execute(
                f"UPDATE rhythmjoy_naver_email_events SET {', '.join(assignments)} WHERE id=%s",
                values,
            )
        logger.info('Email DB event updated id=%s status=%s', email_event_id, status)
    except Exception as error:
        if not owned_conn:
            raise
        disable_db_logging(config, logger, 'Email DB event update failed', error)
    finally:
        if owned_conn and conn is not None:
            conn.close()


def booking_event_at(email_received_at):
    return email_received_at or datetime.now(KST).replace(tzinfo=None).strftime('%Y-%m-%d %H:%M:%S')


def booking_room_key_from_calendar(calendar_key):
    return spacecloud_room_key_from_calendar(calendar_key) or calendar_to_spacecloud_room_key(calendar_key)


def booking_ledger_key(source_platform, event_data, calendar_key):
    reservation_number = event_data.get('reservation_number') or ''
    if source_platform != 'spacecloud' and reservation_number:
        raw_key = f'{source_platform}|reservation|{reservation_number}'
    else:
        raw_key = '|'.join([
            source_platform or '',
            calendar_key or '',
            normalize_date(event_data.get('date', '')) if event_data.get('date') else '',
            event_data.get('start_time', ''),
            event_data.get('end_time', ''),
            normalize_reserver_name_for_match(event_data.get('name')),
        ])
    digest = hashlib.sha256(raw_key.encode('utf-8')).hexdigest()
    return f'{source_platform}|{digest}'


def booking_ledger_row(
        source_platform, event_data, calendar_key, email_event_id,
        email_received_at, event_order_key=None):
    event_at = booking_event_at(email_received_at)
    reservation_number = '' if source_platform == 'spacecloud' else event_data.get('reservation_number') or ''
    row = {
        'ledger_key': booking_ledger_key(source_platform, event_data, calendar_key),
        'source_platform': source_platform or '',
        'source_mode': event_data.get('source_mode') or '',
        'target_calendar': calendar_key or '',
        'room_key': booking_room_key_from_calendar(calendar_key),
        'reservation_number': reservation_number,
        'reserver_name': event_data.get('name') or '',
        'reserver_name_key': normalize_reserver_name_for_match(event_data.get('name')),
        'product': event_data.get('product') or '',
        'reservation_date': clean_date_or_none(event_data.get('date')),
        'start_time': clean_time_or_none(event_data.get('start_time')),
        'end_time': clean_time_or_none(event_data.get('end_time')),
        'payment_status': event_data.get('payment_status') or '',
        'price': event_data.get('price') or '',
        'email_event_id': email_event_id,
        'event_at': event_at,
        'event_order_key': event_order_key or normalized_event_order_key('', event_at),
        'payload_json': json.dumps(event_data, ensure_ascii=False, separators=(',', ':')),
    }
    row.update(event_amount_fields(source_platform, event_data))
    return row


def db_select_booking_ledger(config, ledger_key, conn=None):
    if not config['db_enabled']:
        return None
    owned_conn = conn is None
    try:
        if owned_conn:
            conn = db_connect(config)
        with conn.cursor() as cursor:
            cursor.execute(
                'SELECT * FROM rhythmjoy_booking_ledger WHERE ledger_key=%s LIMIT 1',
                (ledger_key,),
            )
            return cursor.fetchone()
    except Exception as error:
        if not owned_conn:
            raise
        disable_db_logging(config, logging.getLogger('rhythmjoy_email_import'), 'Booking ledger select failed', error)
        return None
    finally:
        if owned_conn and conn is not None:
            conn.close()


def upsert_booking_ledger_confirmed(
        config, logger, email_event_id, event_data, calendar_key,
        email_received_at, source_platform, conn=None, event_order_key=None):
    if not config['db_enabled'] or not event_data:
        return None

    row = booking_ledger_row(
        source_platform,
        event_data,
        calendar_key,
        email_event_id,
        email_received_at,
        event_order_key,
    )
    row.setdefault('event_order_key', normalized_event_order_key('', row.get('event_at')))
    confirmed_event_guard = """(
        (
            VALUES(last_event_order_key) IS NOT NULL
            AND last_event_order_key IS NOT NULL
            AND (
                VALUES(last_event_order_key) > last_event_order_key
                OR (
                    VALUES(last_event_order_key) = last_event_order_key
                    AND VALUES(confirmed_email_event_id) > COALESCE(last_event_id, 0)
                )
            )
        )
        OR (
            (VALUES(last_event_order_key) IS NULL OR last_event_order_key IS NULL)
            AND (
                VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00')
                OR (
                    VALUES(confirmed_email_received_at) = COALESCE(last_event_at, '1000-01-01 00:00:00')
                    AND VALUES(confirmed_email_event_id) > COALESCE(last_event_id, 0)
                )
            )
        )
    )"""
    confirmed_automation_guard = """(
        (
            automation_canceled_order_key IS NOT NULL
            AND VALUES(last_event_order_key) IS NOT NULL
            AND VALUES(last_event_order_key) > automation_canceled_order_key
        )
        OR (
            automation_canceled_order_key IS NULL
            AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00')
        )
    )"""
    confirmed_projection_guard = f"""(
        {confirmed_event_guard}
        AND {confirmed_automation_guard}
    )"""
    owned_conn = conn is None
    try:
        if owned_conn:
            conn = db_connect(config)
        with conn.cursor() as cursor:
            cursor.execute(
                f"""
                INSERT INTO rhythmjoy_booking_ledger (
                    ledger_key, source_platform, source_mode, current_status,
                    target_calendar, room_key, reservation_number, reserver_name, reserver_name_key, product,
                    reservation_date, start_time, end_time,
                    payment_status, price,
                    gross_amount, fee_amount, net_amount, amount_source, payment_method,
                    confirmed_email_event_id, confirmed_email_received_at,
                    last_event_at, last_event_id, last_event_order_key,
                    payload_json, created_at, updated_at
                )
                VALUES (
                    %(ledger_key)s, %(source_platform)s, %(source_mode)s, 'confirmed',
                    %(target_calendar)s, %(room_key)s, %(reservation_number)s, %(reserver_name)s, %(reserver_name_key)s, %(product)s,
                    %(reservation_date)s, %(start_time)s, %(end_time)s,
                    %(payment_status)s, %(price)s,
                    %(gross_amount)s, %(fee_amount)s, %(net_amount)s, %(amount_source)s, %(payment_method)s,
                    %(email_event_id)s, %(event_at)s,
                    %(event_at)s, %(email_event_id)s, %(event_order_key)s,
                    %(payload_json)s, NOW(), NOW()
                )
                ON DUPLICATE KEY UPDATE
                    source_mode=IF({confirmed_projection_guard}, IF(VALUES(source_mode) <> '', VALUES(source_mode), source_mode), source_mode),
                    current_status=IF({confirmed_projection_guard}, 'confirmed', current_status),
                    target_calendar=IF({confirmed_projection_guard}, VALUES(target_calendar), target_calendar),
                    room_key=IF({confirmed_projection_guard}, VALUES(room_key), room_key),
                    reservation_number=IF({confirmed_projection_guard}, VALUES(reservation_number), reservation_number),
                    reserver_name=IF({confirmed_projection_guard}, VALUES(reserver_name), reserver_name),
                    reserver_name_key=IF({confirmed_projection_guard}, VALUES(reserver_name_key), reserver_name_key),
                    product=IF({confirmed_projection_guard}, VALUES(product), product),
                    reservation_date=IF({confirmed_projection_guard}, VALUES(reservation_date), reservation_date),
                    start_time=IF({confirmed_projection_guard}, VALUES(start_time), start_time),
                    end_time=IF({confirmed_projection_guard}, VALUES(end_time), end_time),
                    payment_status=IF({confirmed_projection_guard}, IF(VALUES(payment_status) <> '', VALUES(payment_status), payment_status), payment_status),
                    price=IF({confirmed_projection_guard}, IF(amount_source LIKE '%%platform-export', price, IF(VALUES(price) <> '', VALUES(price), price)), price),
                    gross_amount=IF({confirmed_projection_guard}, IF(amount_source LIKE '%%platform-export', gross_amount, COALESCE(VALUES(gross_amount), gross_amount)), gross_amount),
                    fee_amount=IF({confirmed_projection_guard}, IF(amount_source LIKE '%%platform-export', fee_amount, COALESCE(VALUES(fee_amount), fee_amount)), fee_amount),
                    net_amount=IF({confirmed_projection_guard}, IF(amount_source LIKE '%%platform-export', net_amount, COALESCE(VALUES(net_amount), net_amount)), net_amount),
                    amount_source=IF({confirmed_projection_guard}, IF(amount_source LIKE '%%platform-export', amount_source, IF(VALUES(amount_source) <> '', VALUES(amount_source), amount_source)), amount_source),
                    payment_method=IF({confirmed_projection_guard}, IF(amount_source LIKE '%%platform-export', payment_method, IF(VALUES(payment_method) <> '', VALUES(payment_method), payment_method)), payment_method),
                    confirmed_email_event_id=IF({confirmed_projection_guard}, VALUES(confirmed_email_event_id), confirmed_email_event_id),
                    confirmed_email_received_at=IF({confirmed_projection_guard}, VALUES(confirmed_email_received_at), confirmed_email_received_at),
                    payload_json=IF({confirmed_projection_guard}, IF(amount_source LIKE '%%platform-export', payload_json, VALUES(payload_json)), payload_json),
                    automation_cancel_task_id=IF({confirmed_projection_guard}, NULL, automation_cancel_task_id),
                    automation_cancel_platform=IF({confirmed_projection_guard}, '', automation_cancel_platform),
                    automation_canceled_at=IF({confirmed_projection_guard}, NULL, automation_canceled_at),
                    automation_canceled_order_key=IF({confirmed_projection_guard}, NULL, automation_canceled_order_key),
                    updated_at=IF({confirmed_projection_guard}, NOW(), updated_at),
                    last_event_id=IF({confirmed_projection_guard}, VALUES(confirmed_email_event_id), last_event_id),
                    last_event_order_key=IF(
                        (
                            (
                                VALUES(last_event_order_key) IS NOT NULL
                                AND last_event_order_key IS NOT NULL
                                AND (
                                    VALUES(last_event_order_key) > last_event_order_key
                                    OR (
                                        VALUES(last_event_order_key) = last_event_order_key
                                        AND VALUES(confirmed_email_event_id) = last_event_id
                                    )
                                )
                            )
                            OR (
                                (VALUES(last_event_order_key) IS NULL OR last_event_order_key IS NULL)
                                AND (
                                    VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00')
                                    OR (
                                        VALUES(confirmed_email_received_at) = COALESCE(last_event_at, '1000-01-01 00:00:00')
                                        AND VALUES(confirmed_email_event_id) = last_event_id
                                    )
                                )
                            )
                        )
                        AND {confirmed_automation_guard},
                        VALUES(last_event_order_key),
                        last_event_order_key
                    ),
                    last_event_at=IF(
                        (VALUES(last_event_order_key) <=> last_event_order_key)
                        AND VALUES(confirmed_email_event_id) = last_event_id
                        AND {confirmed_automation_guard},
                        VALUES(confirmed_email_received_at),
                        last_event_at
                    )
                """,
                row,
            )
        ledger = db_select_booking_ledger(config, row['ledger_key'], conn=conn)
        logger.info(
            'Booking ledger confirmed ledger=%s id=%s platform=%s reservation=%s status=%s',
            row['ledger_key'],
            ledger.get('id') if ledger else '-',
            source_platform,
            row['reservation_number'],
            ledger.get('current_status') if ledger else '-',
        )
        return ledger
    except Exception as error:
        if not owned_conn:
            raise
        disable_db_logging(config, logger, 'Booking ledger confirmed upsert failed', error)
        return None
    finally:
        if owned_conn and conn is not None:
            conn.close()


def upsert_booking_ledger_canceled(
        config, logger, email_event_id, event_data, calendar_key,
        email_received_at, source_platform, conn=None, event_order_key=None):
    if not config['db_enabled'] or not event_data:
        return None

    row = booking_ledger_row(
        source_platform,
        event_data,
        calendar_key,
        email_event_id,
        email_received_at,
        event_order_key,
    )
    row.setdefault('event_order_key', normalized_event_order_key('', row.get('event_at')))
    canceled_event_guard = """(
        (
            VALUES(last_event_order_key) IS NOT NULL
            AND last_event_order_key IS NOT NULL
            AND (
                VALUES(last_event_order_key) > last_event_order_key
                OR (
                    VALUES(last_event_order_key) = last_event_order_key
                    AND VALUES(canceled_email_event_id) > COALESCE(last_event_id, 0)
                )
            )
        )
        OR (
            (VALUES(last_event_order_key) IS NULL OR last_event_order_key IS NULL)
            AND VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00')
            AND (
                VALUES(canceled_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00')
                OR (
                    VALUES(canceled_email_received_at) = COALESCE(last_event_at, '1000-01-01 00:00:00')
                    AND VALUES(canceled_email_event_id) > COALESCE(last_event_id, 0)
                )
            )
        )
    )"""
    owned_conn = conn is None
    try:
        if owned_conn:
            conn = db_connect(config)
        with conn.cursor() as cursor:
            cursor.execute(
                f"""
                INSERT INTO rhythmjoy_booking_ledger (
                    ledger_key, source_platform, source_mode, current_status,
                    target_calendar, room_key, reservation_number, reserver_name, reserver_name_key, product,
                    reservation_date, start_time, end_time,
                    payment_status, price,
                    gross_amount, fee_amount, net_amount, amount_source, payment_method,
                    canceled_email_event_id, canceled_email_received_at,
                    last_event_at, last_event_id, last_event_order_key,
                    cancel_payload_json, created_at, updated_at
                )
                VALUES (
                    %(ledger_key)s, %(source_platform)s, %(source_mode)s, 'canceled',
                    %(target_calendar)s, %(room_key)s, %(reservation_number)s, %(reserver_name)s, %(reserver_name_key)s, %(product)s,
                    %(reservation_date)s, %(start_time)s, %(end_time)s,
                    %(payment_status)s, %(price)s,
                    %(gross_amount)s, %(fee_amount)s, %(net_amount)s, %(amount_source)s, %(payment_method)s,
                    %(email_event_id)s, %(event_at)s,
                    %(event_at)s, %(email_event_id)s, %(event_order_key)s,
                    %(payload_json)s, NOW(), NOW()
                )
                ON DUPLICATE KEY UPDATE
                    source_mode=IF({canceled_event_guard}, IF(VALUES(source_mode) <> '', VALUES(source_mode), source_mode), source_mode),
                    current_status=IF({canceled_event_guard}, 'canceled', current_status),
                    target_calendar=IF({canceled_event_guard}, IF(VALUES(target_calendar) <> '', VALUES(target_calendar), target_calendar), target_calendar),
                    room_key=IF({canceled_event_guard}, IF(VALUES(room_key) <> '', VALUES(room_key), room_key), room_key),
                    reservation_number=IF({canceled_event_guard}, IF(VALUES(reservation_number) <> '', VALUES(reservation_number), reservation_number), reservation_number),
                    reserver_name=IF({canceled_event_guard}, IF(VALUES(reserver_name) <> '', VALUES(reserver_name), reserver_name), reserver_name),
                    reserver_name_key=IF({canceled_event_guard}, IF(VALUES(reserver_name_key) <> '', VALUES(reserver_name_key), reserver_name_key), reserver_name_key),
                    product=IF({canceled_event_guard}, IF(VALUES(product) <> '', VALUES(product), product), product),
                    reservation_date=IF({canceled_event_guard}, COALESCE(VALUES(reservation_date), reservation_date), reservation_date),
                    start_time=IF({canceled_event_guard}, COALESCE(VALUES(start_time), start_time), start_time),
                    end_time=IF({canceled_event_guard}, COALESCE(VALUES(end_time), end_time), end_time),
                    payment_status=IF({canceled_event_guard}, IF(VALUES(payment_status) <> '', VALUES(payment_status), payment_status), payment_status),
                    price=IF({canceled_event_guard}, IF(amount_source LIKE '%%platform-export', price, IF(VALUES(price) <> '', VALUES(price), price)), price),
                    gross_amount=IF({canceled_event_guard}, IF(amount_source LIKE '%%platform-export', gross_amount, COALESCE(VALUES(gross_amount), gross_amount)), gross_amount),
                    fee_amount=IF({canceled_event_guard}, IF(amount_source LIKE '%%platform-export', fee_amount, COALESCE(VALUES(fee_amount), fee_amount)), fee_amount),
                    net_amount=IF({canceled_event_guard}, IF(amount_source LIKE '%%platform-export', net_amount, COALESCE(VALUES(net_amount), net_amount)), net_amount),
                    amount_source=IF({canceled_event_guard}, IF(amount_source LIKE '%%platform-export', amount_source, IF(VALUES(amount_source) <> '', VALUES(amount_source), amount_source)), amount_source),
                    payment_method=IF({canceled_event_guard}, IF(amount_source LIKE '%%platform-export', payment_method, IF(VALUES(payment_method) <> '', VALUES(payment_method), payment_method)), payment_method),
                    canceled_email_event_id=IF({canceled_event_guard}, VALUES(canceled_email_event_id), canceled_email_event_id),
                    canceled_email_received_at=IF({canceled_event_guard}, VALUES(canceled_email_received_at), canceled_email_received_at),
                    cancel_payload_json=IF({canceled_event_guard}, VALUES(cancel_payload_json), cancel_payload_json),
                    updated_at=IF({canceled_event_guard}, NOW(), updated_at),
                    last_event_id=IF({canceled_event_guard}, VALUES(canceled_email_event_id), last_event_id),
                    last_event_order_key=IF(
                        (
                            (
                                VALUES(last_event_order_key) IS NOT NULL
                                AND last_event_order_key IS NOT NULL
                                AND (
                                    VALUES(last_event_order_key) > last_event_order_key
                                    OR (
                                        VALUES(last_event_order_key) = last_event_order_key
                                        AND VALUES(canceled_email_event_id) = last_event_id
                                    )
                                )
                            )
                            OR (
                                (VALUES(last_event_order_key) IS NULL OR last_event_order_key IS NULL)
                                AND VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00')
                                AND (
                                    VALUES(canceled_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00')
                                    OR (
                                        VALUES(canceled_email_received_at) = COALESCE(last_event_at, '1000-01-01 00:00:00')
                                        AND VALUES(canceled_email_event_id) = last_event_id
                                    )
                                )
                            )
                        ),
                        VALUES(last_event_order_key),
                        last_event_order_key
                    ),
                    last_event_at=IF(
                        (VALUES(last_event_order_key) <=> last_event_order_key)
                        AND VALUES(canceled_email_event_id) = last_event_id,
                        VALUES(canceled_email_received_at),
                        last_event_at
                    )
                """,
                row,
            )
            if source_platform == 'spacecloud':
                matched_ids = []
                matched_id = event_data.get('matched_booking_ledger_id')
                try:
                    if matched_id:
                        matched_ids.append(int(matched_id))
                except (TypeError, ValueError):
                    matched_ids = []

                if matched_ids:
                    cursor.execute(
                        f"""
                        UPDATE rhythmjoy_booking_ledger
                        SET current_status='canceled',
                            canceled_email_event_id=%s,
                            canceled_email_received_at=%s,
                            last_event_id=%s,
                            last_event_order_key=%s,
                            last_event_at=%s,
                            cancel_payload_json=%s,
                            updated_at=NOW()
                        WHERE id IN ({','.join(['%s'] * len(matched_ids))})
                          AND source_platform <> 'naver'
                          AND (
                              %s > COALESCE(last_event_order_key, 0)
                              OR (
                                  %s = COALESCE(last_event_order_key, 0)
                                  AND %s > COALESCE(last_event_id, 0)
                              )
                          )
                        """,
                        [
                            email_event_id,
                            row['event_at'],
                            email_event_id,
                            row['event_order_key'],
                            row['event_at'],
                            row['payload_json'],
                            *matched_ids,
                            row['event_order_key'],
                            row['event_order_key'],
                            email_event_id,
                        ],
                    )
                    logger.info('SpaceCloud cancellation marked matched ledger rows canceled ids=%s', matched_ids)

                cursor.execute(
                    """
                    UPDATE rhythmjoy_booking_ledger
                    SET current_status='canceled',
                        canceled_email_event_id=%s,
                        canceled_email_received_at=%s,
                        last_event_id=%s,
                        last_event_order_key=%s,
                        last_event_at=%s,
                        cancel_payload_json=%s,
                        updated_at=NOW()
                    WHERE current_status='confirmed'
                      AND source_platform <> 'naver'
                      AND id <> LAST_INSERT_ID()
                      AND target_calendar=%s
                      AND room_key=%s
                      AND reservation_date=%s
                      AND start_time=%s
                      AND end_time=%s
                      AND reserver_name_key=%s
                      AND (
                          %s > COALESCE(last_event_order_key, 0)
                          OR (
                              %s = COALESCE(last_event_order_key, 0)
                              AND %s > COALESCE(last_event_id, 0)
                          )
                      )
                    """,
                    (
                        email_event_id,
                        row['event_at'],
                        email_event_id,
                        row['event_order_key'],
                        row['event_at'],
                        row['payload_json'],
                        row['target_calendar'],
                        row['room_key'],
                        row['reservation_date'],
                        row['start_time'],
                        row['end_time'],
                        row['reserver_name_key'],
                        row['event_order_key'],
                        row['event_order_key'],
                        email_event_id,
                    ),
                )
                if cursor.rowcount:
                    logger.info(
                        'SpaceCloud cancellation marked matching non-Naver ledger rows canceled count=%s calendar=%s date=%s time=%s-%s name_key=%s',
                        cursor.rowcount,
                        row['target_calendar'],
                        row['reservation_date'],
                        row['start_time'],
                        row['end_time'],
                        row['reserver_name_key'],
                    )
            elif source_platform == 'naver' and row['reservation_number']:
                cursor.execute(
                    """
                    UPDATE rhythmjoy_booking_ledger
                    SET current_status='canceled',
                        canceled_email_event_id=%s,
                        canceled_email_received_at=%s,
                        last_event_id=%s,
                        last_event_order_key=%s,
                        last_event_at=%s,
                        cancel_payload_json=%s,
                        updated_at=NOW()
                    WHERE current_status='confirmed'
                      AND source_platform IN ('naver', 'google-backfill')
                      AND reservation_number=%s
                      AND (
                          %s > COALESCE(last_event_order_key, 0)
                          OR (
                              %s = COALESCE(last_event_order_key, 0)
                              AND %s > COALESCE(last_event_id, 0)
                          )
                      )
                    """,
                    (
                        email_event_id,
                        row['event_at'],
                        email_event_id,
                        row['event_order_key'],
                        row['event_at'],
                        row['payload_json'],
                        row['reservation_number'],
                        row['event_order_key'],
                        row['event_order_key'],
                        email_event_id,
                    ),
                )
                if cursor.rowcount:
                    logger.info(
                        'Naver cancellation marked every matching legacy ledger row canceled count=%s reservation=%s',
                        cursor.rowcount,
                        row['reservation_number'],
                    )
        ledger = db_select_booking_ledger(config, row['ledger_key'], conn=conn)
        logger.info(
            'Booking ledger canceled ledger=%s id=%s platform=%s reservation=%s status=%s',
            row['ledger_key'],
            ledger.get('id') if ledger else '-',
            source_platform,
            row['reservation_number'],
            ledger.get('current_status') if ledger else '-',
        )
        return ledger
    except Exception as error:
        if not owned_conn:
            raise
        disable_db_logging(config, logger, 'Booking ledger canceled upsert failed', error)
        return None
    finally:
        if owned_conn and conn is not None:
            conn.close()


def enrich_spacecloud_cancellation_from_db(config, logger, event_data, calendar_key):
    if not config['db_enabled'] or not event_data or not calendar_key:
        return event_data

    reservation_date = clean_date_or_none(event_data.get('date'))
    start_time = clean_time_or_none(event_data.get('start_time'))
    end_time = clean_time_or_none(event_data.get('end_time'))
    if not reservation_date or not start_time or not end_time:
        return event_data
    reserver_name_key = normalize_reserver_name_for_match(event_data.get('name'))

    conn = None
    try:
        conn = db_connect(config)
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, reservation_number
                FROM rhythmjoy_booking_ledger
                WHERE source_platform='spacecloud'
                  AND current_status='confirmed'
                  AND target_calendar=%s
                  AND reservation_date=%s
                  AND start_time=%s
                  AND end_time=%s
                  AND reserver_name_key=%s
                ORDER BY last_event_at DESC, id DESC
                LIMIT 1
                """,
                (
                    calendar_key,
                    reservation_date,
                    start_time,
                    end_time,
                    reserver_name_key,
                ),
            )
            row = cursor.fetchone()
            if row:
                event_data = dict(event_data)
                event_data['matched_booking_ledger_id'] = row.get('id')
                logger.info(
                    'SpaceCloud cancellation enriched from booking ledger id=%s calendar=%s name_key=%s time=%s %s-%s',
                    row.get('id'),
                    calendar_key,
                    reserver_name_key,
                    reservation_date,
                    event_data.get('start_time'),
                    event_data.get('end_time'),
                )
                return event_data

            cursor.execute(
                """
                SELECT id, reservation_number, reserver_name
                FROM rhythmjoy_naver_email_events
                WHERE event_type='spacecloud_reservation'
                  AND target_calendar=%s
                  AND reservation_date=%s
                  AND start_time=%s
                  AND end_time=%s
                ORDER BY email_received_at DESC, id DESC
                """,
                (
                    calendar_key,
                    reservation_date,
                    start_time,
                    end_time,
                ),
            )
            candidates = cursor.fetchall()
            row = next(
                (
                    candidate for candidate in candidates
                    if normalize_reserver_name_for_match(candidate.get('reserver_name')) == reserver_name_key
                ),
                None,
            )
        if row:
            event_data = dict(event_data)
            event_data['matched_reservation_email_event_id'] = row.get('id')
            logger.info(
                'SpaceCloud cancellation enriched from reservation email id=%s calendar=%s name_key=%s time=%s %s-%s',
                row.get('id'),
                calendar_key,
                reserver_name_key,
                reservation_date,
                event_data.get('start_time'),
                event_data.get('end_time'),
            )
        else:
            logger.warning(
                'SpaceCloud cancellation has no matching reservation email calendar=%s name=%s name_key=%s time=%s %s-%s',
                calendar_key,
                event_data.get('name') or '',
                reserver_name_key,
                reservation_date,
                event_data.get('start_time'),
                event_data.get('end_time'),
            )
        return event_data
    except Exception as error:
        disable_db_logging(config, logger, 'SpaceCloud cancellation enrichment failed', error)
        return event_data
    finally:
        if conn is not None:
            conn.close()


def spacecloud_task_event_identity(email_event_id):
    try:
        value = int(email_event_id)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def spacecloud_delete_dedupe_key(deletion, room_key, email_event_id=None):
    reservation_number = deletion.get('reservation_number') or ''
    event_identity = spacecloud_task_event_identity(email_event_id)
    if event_identity:
        raw_key = '|'.join([
            'delete',
            'email_event',
            str(event_identity),
            room_key or '',
            reservation_number,
        ])
    elif reservation_number:
        raw_key = f'delete|reservation|{reservation_number}'
    else:
        raw_key = '|'.join([
            'delete',
            room_key or '',
            normalize_date(deletion.get('date', '')) if deletion.get('date') else '',
            deletion.get('start_time', ''),
            deletion.get('end_time', ''),
            deletion.get('name', ''),
        ])
    digest = hashlib.sha256(raw_key.encode('utf-8')).hexdigest()
    return f'delete|{digest}'


def enrich_naver_cancellation_from_prior_event(
        cursor, deletion, calendar_key, cancellation_event_order_key):
    """Use only the strict-earlier trusted reservation generation as identity proof."""
    enriched = dict(deletion or {})
    reservation_number = str(enriched.get('reservation_number') or '').strip()
    if not reservation_number:
        return enriched, calendar_key, {'status': 'missing-reservation-number'}
    ledger_key = booking_ledger_key('naver', enriched, calendar_key)
    cursor.execute(
        """
        SELECT id
        FROM rhythmjoy_booking_ledger
        WHERE ledger_key=%s
        LIMIT 1
        FOR UPDATE
        """,
        (ledger_key,),
    )
    cursor.fetchone()
    cursor.execute(
        """
        SELECT id, event_type, event_order_key, event_order_trusted,
               target_calendar, reservation_number, reserver_name, product,
               reservation_date, start_time, end_time, payment_status,
               parsed_json
        FROM rhythmjoy_naver_email_events
        WHERE event_type IN ('reservation', 'reservation_pending')
          AND parse_status='parsed'
          AND reservation_number=%s
          AND event_order_key IS NOT NULL
          AND event_order_key<%s
          AND COALESCE(error_text, '') NOT LIKE '%%no_side_effects%%'
        ORDER BY event_order_key DESC, id DESC
        LIMIT 2
        FOR UPDATE
        """,
        (reservation_number, cancellation_event_order_key),
    )
    candidates = cursor.fetchall()
    if not candidates:
        return enriched, calendar_key, {'status': 'missing-prior-reservation'}
    prior = candidates[0]
    if int(prior.get('event_order_trusted') or 0) != 1:
        return enriched, calendar_key, {
            'status': 'untrusted-prior-reservation',
            'event_id': prior.get('id'),
        }
    if (
            len(candidates) > 1
            and candidates[1].get('event_order_key') == prior.get('event_order_key')
    ):
        return enriched, calendar_key, {
            'status': 'ambiguous-prior-reservation',
            'event_id': prior.get('id'),
        }
    prior_payload = load_event_payload(prior) or {}
    if (
            prior.get('event_type') != 'reservation'
            or reservation_waits_for_payment(
                prior_payload or {'payment_status': prior.get('payment_status')}
            )
    ):
        return enriched, calendar_key, {
            'status': 'prior-reservation-not-confirmed',
            'event_id': prior.get('id'),
        }
    source_values = {
        'name': prior_payload.get('name') or prior.get('reserver_name'),
        'product': prior_payload.get('product') or prior.get('product'),
        'date': clean_date_or_none(
            prior_payload.get('date') or prior.get('reservation_date')
        ),
        'start_time': clean_time_or_none(
            prior_payload.get('start_time') or prior.get('start_time')
        ),
        'end_time': clean_time_or_none(
            prior_payload.get('end_time') or prior.get('end_time')
        ),
    }
    prior_calendar = (
        prior.get('target_calendar')
        or prior_payload.get('target_calendar')
        or prior_payload.get('calendar_key')
        or product_to_calendar_key(source_values.get('product') or '')
    )
    comparisons = (
        (
            'name',
            normalize_reserver_name_for_match,
        ),
        ('product', lambda value: re.sub(r'\s+', '', str(value or '')).lower()),
        ('date', clean_date_or_none),
        ('start_time', clean_time_or_none),
        ('end_time', clean_time_or_none),
    )
    for field, normalizer in comparisons:
        current_value = enriched.get(field)
        source_value = source_values.get(field)
        if current_value and source_value and normalizer(current_value) != normalizer(source_value):
            return enriched, calendar_key, {
                'status': f'prior-{field}-mismatch',
                'event_id': prior.get('id'),
            }
    current_room = (
        calendar_to_spacecloud_room_key(calendar_key)
        or booking_room_key_from_calendar(calendar_key)
        or calendar_to_spacecloud_room_key(
            product_to_calendar_key(enriched.get('product', ''))
        )
    )
    prior_room = (
        calendar_to_spacecloud_room_key(prior_calendar)
        or booking_room_key_from_calendar(prior_calendar)
    )
    if current_room and prior_room and current_room != prior_room:
        return enriched, calendar_key, {
            'status': 'prior-room-mismatch',
            'event_id': prior.get('id'),
        }
    for field, value in source_values.items():
        if not str(enriched.get(field) or '').strip() and value is not None:
            enriched[field] = str(value)
    enriched_calendar = (
        calendar_key
        or prior_calendar
        or product_to_calendar_key(enriched.get('product', ''))
    )
    if enriched_calendar:
        enriched['target_calendar'] = enriched_calendar
        enriched['calendar_key'] = enriched_calendar
    return enriched, enriched_calendar, {
        'status': 'ok',
        'event_id': prior.get('id'),
        'event_order_key': prior.get('event_order_key'),
    }


def supersede_waiting_naver_confirmations(
        cursor, deletion, calendar_key, cancellation_event_order_key):
    """Resolve only waiting generations that this later cancellation exactly covers."""
    room_key = booking_room_key_from_calendar(calendar_key)
    cursor.execute(
        """
        UPDATE rhythmjoy_naver_email_events
        SET processing_status='superseded',
            error_text='superseded_by_cancellation_no_side_effects',
            updated_at=NOW()
        WHERE event_type='reservation'
          AND parse_status='parsed'
          AND event_order_trusted=1
          AND processing_status='awaiting_predecessor'
          AND reservation_number=%s
          AND spacecloud_room_key=%s
          AND reservation_date <=> %s
          AND start_time <=> %s
          AND end_time <=> %s
          AND event_order_key IS NOT NULL
          AND event_order_key<%s
        """,
        (
            deletion.get('reservation_number') or '',
            room_key,
            clean_date_or_none(deletion.get('date')),
            clean_time_or_none(deletion.get('start_time')),
            clean_time_or_none(deletion.get('end_time')),
            cancellation_event_order_key,
        ),
    )
    return cursor.rowcount


def naver_cancellation_identity_complete(deletion, calendar_key):
    required_fields = (
        'reservation_number',
        'name',
        'product',
        'date',
        'start_time',
        'end_time',
    )
    return bool(
        deletion
        and all(str(deletion.get(field) or '').strip() for field in required_fields)
        and calendar_key
        and (
            calendar_to_spacecloud_room_key(calendar_key)
            or booking_room_key_from_calendar(calendar_key)
        )
    )


def persist_enriched_naver_cancellation_event(
        cursor, email_event_id, deletion, calendar_key):
    cursor.execute(
        """
        UPDATE rhythmjoy_naver_email_events
        SET target_calendar=%s,
            spacecloud_room_key=%s,
            reservation_number=%s,
            reserver_name=%s,
            product=%s,
            reservation_date=%s,
            start_time=%s,
            end_time=%s,
            parsed_json=%s,
            updated_at=NOW()
        WHERE id=%s
        """,
        (
            calendar_key or '',
            calendar_to_spacecloud_room_key(calendar_key) or '',
            deletion.get('reservation_number') or '',
            deletion.get('name') or '',
            deletion.get('product') or '',
            clean_date_or_none(deletion.get('date')),
            clean_time_or_none(deletion.get('start_time')),
            clean_time_or_none(deletion.get('end_time')),
            json.dumps(deletion, ensure_ascii=False, separators=(',', ':')),
            email_event_id,
        ),
    )


def insert_naver_cancellation_quarantine(
        cursor, email_event_id, deletion, calendar_key,
        reason, event_order_trusted):
    """Lock the matching ledger, then persist a non-runnable delete blocker."""
    event_identity = spacecloud_task_event_identity(email_event_id)
    if not event_identity:
        raise ConfigError('Untrusted cancellation quarantine requires an inbox event id')
    room_key = (
        calendar_to_spacecloud_room_key(calendar_key)
        or booking_room_key_from_calendar(calendar_key)
        or ''
    )
    ledger_key = booking_ledger_key('naver', deletion, calendar_key)
    cursor.execute(
        """
        SELECT id
        FROM rhythmjoy_booking_ledger
        WHERE ledger_key=%s
        LIMIT 1
        FOR UPDATE
        """,
        (ledger_key,),
    )
    ledger = cursor.fetchone() or {}
    ledger_id = spacecloud_task_event_identity(ledger.get('id'))
    payload = {
        'source': 'naver-email-cancellation-quarantine',
        'reason': reason,
        'eventOrderTrusted': bool(event_order_trusted),
        'emailEventId': event_identity,
        'bookingLedgerId': ledger_id,
        'calendarKey': calendar_key,
        'roomKey': room_key,
        **deletion,
    }
    result = {
        'status': 'needs-review',
        'reason': reason,
        'submissionAttempted': False,
        'mirrorMutationState': 'not_created',
        'emailEventId': event_identity,
        'bookingLedgerId': ledger_id,
    }
    row = {
        'dedupe_key': spacecloud_delete_dedupe_key(
            deletion,
            room_key,
            event_identity,
        ),
        'email_event_id': event_identity,
        'booking_ledger_id': ledger_id,
        'room_key': room_key,
        'reservation_number': deletion.get('reservation_number') or '',
        'reserver_name': deletion.get('name') or '',
        'reserver_name_key': normalize_reserver_name_for_match(deletion.get('name')),
        'product': deletion.get('product') or '',
        'reservation_date': clean_date_or_none(deletion.get('date')),
        'start_time': clean_time_or_none(deletion.get('start_time')),
        'end_time': clean_time_or_none(deletion.get('end_time')),
        'payload_json': json.dumps(payload, ensure_ascii=False, separators=(',', ':')),
        'result_text': json.dumps(result, ensure_ascii=False, separators=(',', ':')),
    }
    cursor.execute(
        """
        SELECT *
        FROM rhythmjoy_spacecloud_tasks
        WHERE dedupe_key=%s
        LIMIT 1
        FOR UPDATE
        """,
        (row['dedupe_key'],),
    )
    existing = cursor.fetchone()
    if existing:
        if int(existing.get('email_event_id') or 0) != event_identity:
            raise ConfigError('Untrusted cancellation quarantine dedupe collision')
        if (
                existing.get('status') == 'pending'
                and existing.get('side_effect_state') == 'ready'
                and int(existing.get('attempts') or 0) == 0
                and not existing.get('side_effect_armed_at')
        ):
            cursor.execute(
                """
                UPDATE rhythmjoy_spacecloud_tasks
                SET booking_ledger_id=COALESCE(booking_ledger_id, %s),
                    status='needs_review',
                    side_effect_state=NULL,
                    side_effect_token='',
                    confirmation_sms_required=0,
                    processed_at=NOW(),
                    result_text=%s,
                    updated_at=NOW()
                WHERE id=%s
                  AND status='pending'
                  AND side_effect_state='ready'
                  AND attempts=0
                  AND side_effect_armed_at IS NULL
                """,
                (ledger_id, row['result_text'], existing.get('id')),
            )
            if cursor.rowcount != 1:
                raise ConfigError('Untrusted cancellation task changed during quarantine')
        elif not (
                existing.get('status') == 'needs_review'
                and existing.get('side_effect_state') is None
        ):
            raise ConfigError(
                'Untrusted cancellation already has non-quarantinable task '
                f"task_id={existing.get('id')} status={existing.get('status')} "
                f"state={existing.get('side_effect_state')}"
            )
        elif ledger_id and not existing.get('booking_ledger_id'):
            cursor.execute(
                """
                UPDATE rhythmjoy_spacecloud_tasks
                SET booking_ledger_id=%s, updated_at=NOW()
                WHERE id=%s AND booking_ledger_id IS NULL
                """,
                (ledger_id, existing.get('id')),
            )
    else:
        cursor.execute(
            """
            INSERT INTO rhythmjoy_spacecloud_tasks (
                dedupe_key, email_event_id, booking_ledger_id,
                task_type, status, side_effect_state,
                room_key, reservation_number, reserver_name, reserver_name_key, product,
                reservation_date, start_time, end_time,
                confirmation_sms_required, payload_json, result_text,
                processed_at, created_at, updated_at
            ) VALUES (
                %(dedupe_key)s, %(email_event_id)s, %(booking_ledger_id)s,
                'delete', 'needs_review', NULL,
                %(room_key)s, %(reservation_number)s, %(reserver_name)s, %(reserver_name_key)s, %(product)s,
                %(reservation_date)s, %(start_time)s, %(end_time)s,
                0, %(payload_json)s, %(result_text)s,
                NOW(), NOW(), NOW()
            )
            """,
            row,
        )
    cursor.execute(
        """
        SELECT *
        FROM rhythmjoy_spacecloud_tasks
        WHERE dedupe_key=%s
        LIMIT 1
        FOR UPDATE
        """,
        (row['dedupe_key'],),
    )
    task = cursor.fetchone()
    if not task:
        raise ConfigError('Untrusted cancellation quarantine task was not persisted')
    return task


def lock_naver_confirmed_core_change(
        cursor, email_event_id, event_data, calendar_key, event_order_key):
    """Fence any later confirmation lacking an intervening cancellation."""
    ledger_key = booking_ledger_key('naver', event_data, calendar_key)
    cursor.execute(
        """
        SELECT ledger.id, ledger.current_status, ledger.confirmed_email_event_id,
               ledger.last_event_id, ledger.last_event_order_key,
               ledger.room_key, ledger.reservation_date,
               ledger.start_time, ledger.end_time,
               confirmed_event.event_order_trusted
        FROM rhythmjoy_booking_ledger AS ledger
        LEFT JOIN rhythmjoy_naver_email_events AS confirmed_event
               ON confirmed_event.id=ledger.confirmed_email_event_id
        WHERE ledger.ledger_key=%s
        LIMIT 1
        FOR UPDATE
        """,
        (ledger_key,),
    )
    ledger = cursor.fetchone()
    if (
            not ledger
            or ledger.get('current_status') != 'confirmed'
            or int(ledger.get('confirmed_email_event_id') or 0) == int(email_event_id or 0)
            or int(ledger.get('event_order_trusted') or 0) != 1
    ):
        return None
    previous_order = (
        int(ledger.get('last_event_order_key') or 0),
        int(ledger.get('last_event_id') or 0),
    )
    incoming_order = (int(event_order_key or 0), int(email_event_id or 0))
    if not previous_order[0] or incoming_order <= previous_order:
        return None
    incoming_core = {
        'room_key': booking_room_key_from_calendar(calendar_key),
        'reservation_date': clean_date_or_none(event_data.get('date')),
        'start_time': clean_time_or_none(event_data.get('start_time')),
        'end_time': clean_time_or_none(event_data.get('end_time')),
    }
    existing_core = {
        'room_key': ledger.get('room_key') or '',
        'reservation_date': clean_date_or_none(ledger.get('reservation_date')),
        'start_time': clean_time_or_none(ledger.get('start_time')),
        'end_time': clean_time_or_none(ledger.get('end_time')),
    }
    conflict = dict(ledger)
    conflict['incoming_core'] = incoming_core
    conflict['existing_core'] = existing_core
    conflict['core_changed'] = incoming_core != existing_core
    return conflict


def insert_naver_reservation_quarantine(
        cursor, email_event_id, event_data, calendar_key, ledger_id):
    """Persist an inert upload blocker without relabeling an existing task."""
    room_key = booking_room_key_from_calendar(calendar_key)
    if not ledger_id:
        cursor.execute(
            """
            SELECT id
            FROM rhythmjoy_booking_ledger
            WHERE ledger_key=%s
            LIMIT 1
            FOR UPDATE
            """,
            (booking_ledger_key('naver', event_data, calendar_key),),
        )
        ledger_id = (cursor.fetchone() or {}).get('id')
    row = {
        'dedupe_key': spacecloud_upload_dedupe_key(
            event_data,
            room_key,
            email_event_id,
        ),
        'email_event_id': int(email_event_id),
        'booking_ledger_id': (
            int(ledger_id) if ledger_id else None
        ),
        'room_key': room_key,
        'reservation_number': event_data.get('reservation_number') or '',
        'reserver_name': event_data.get('name') or '',
        'reserver_name_key': normalize_reserver_name_for_match(event_data.get('name')),
        'product': event_data.get('product') or '',
        'reservation_date': clean_date_or_none(event_data.get('date')),
        'start_time': clean_time_or_none(event_data.get('start_time')),
        'end_time': clean_time_or_none(event_data.get('end_time')),
    }
    result = {
        'status': 'needs-review',
        'reason': 'opposing-event-order-collision',
        'submissionAttempted': False,
        'mirrorMutationState': 'not_created',
        'emailEventId': row['email_event_id'],
        'bookingLedgerId': row['booking_ledger_id'],
    }
    payload = {
        'source': 'naver-email-reservation-quarantine',
        'reason': result['reason'],
        'calendarKey': calendar_key,
        'roomKey': room_key,
        **event_data,
    }
    row['payload_json'] = compact_json(payload)
    row['result_text'] = compact_json(result)
    existing = lock_spacecloud_task_for_event(
        cursor,
        'upload',
        row['email_event_id'],
    )
    if existing:
        assert_spacecloud_task_replay_identity(existing, {
            **row,
            'task_type': 'upload',
        })
        if not (
                existing.get('status') == 'needs_review'
                and existing.get('side_effect_state') is None
        ):
            raise ConfigError(
                'Core-change reservation already has a non-quarantined task '
                f"task_id={existing.get('id')}"
            )
        return existing
    cursor.execute(
        """
        INSERT INTO rhythmjoy_spacecloud_tasks (
            dedupe_key, email_event_id, booking_ledger_id,
            task_type, status, side_effect_state,
            room_key, reservation_number, reserver_name, reserver_name_key, product,
            reservation_date, start_time, end_time,
            confirmation_sms_required, payload_json, result_text,
            processed_at, created_at, updated_at
        ) VALUES (
            %(dedupe_key)s, %(email_event_id)s, %(booking_ledger_id)s,
            'upload', 'needs_review', NULL,
            %(room_key)s, %(reservation_number)s, %(reserver_name)s, %(reserver_name_key)s, %(product)s,
            %(reservation_date)s, %(start_time)s, %(end_time)s,
            0, %(payload_json)s, %(result_text)s,
            NOW(), NOW(), NOW()
        )
        """,
        row,
    )
    return lock_spacecloud_task_for_event(
        cursor,
        'upload',
        row['email_event_id'],
    )


def lock_naver_ledger_and_find_opposing_collision(
        cursor, email_event_id, event_data, calendar_key,
        event_type, event_order_key):
    """Serialize one reservation and detect an unknowable same-ms lifecycle tie."""
    ledger_key = booking_ledger_key('naver', event_data, calendar_key)
    cursor.execute(
        """
        SELECT id
        FROM rhythmjoy_booking_ledger
        WHERE ledger_key=%s
        LIMIT 1
        FOR UPDATE
        """,
        (ledger_key,),
    )
    cursor.fetchone()
    opposite_type = 'cancellation' if event_type == 'reservation' else 'reservation'
    cursor.execute(
        """
        SELECT id, event_type, reservation_number, event_order_key
        FROM rhythmjoy_naver_email_events
        WHERE event_type=%s
          AND parse_status='parsed'
          AND event_order_trusted=1
          AND event_order_key=%s
          AND reservation_number=%s
          AND id<>%s
        ORDER BY id ASC
        LIMIT 1
        FOR UPDATE
        """,
        (
            opposite_type,
            event_order_key,
            event_data.get('reservation_number') or '',
            email_event_id,
        ),
    )
    return cursor.fetchone()


def spacecloud_naver_block_dedupe_key(event_data, room_key, email_event_id):
    raw_key = '|'.join([
        'naver_block',
        str(email_event_id or ''),
        room_key or '',
        normalize_date(event_data.get('date', '')) if event_data.get('date') else '',
        event_data.get('start_time', ''),
        event_data.get('end_time', ''),
        normalize_reserver_name_for_match(event_data.get('name')),
    ])
    digest = hashlib.sha256(raw_key.encode('utf-8')).hexdigest()
    return f'naver_block|{digest}'


def spacecloud_naver_restore_dedupe_key(event_data, room_key, email_event_id):
    raw_key = '|'.join([
        'naver_restore',
        str(email_event_id or ''),
        room_key or '',
        normalize_date(event_data.get('date', '')) if event_data.get('date') else '',
        event_data.get('start_time', ''),
        event_data.get('end_time', ''),
        normalize_reserver_name_for_match(event_data.get('name')),
    ])
    digest = hashlib.sha256(raw_key.encode('utf-8')).hexdigest()
    return f'naver_restore|{digest}'


def spacecloud_upload_dedupe_key(event_data, room_key, email_event_id=None):
    reservation_number = event_data.get('reservation_number') or ''
    event_identity = spacecloud_task_event_identity(email_event_id)
    if event_identity:
        raw_key = '|'.join([
            'upload',
            'email_event',
            str(event_identity),
            room_key or '',
            reservation_number,
        ])
    elif reservation_number:
        raw_key = f'upload|reservation|{reservation_number}'
    else:
        raw_key = '|'.join([
            'upload',
            room_key or '',
            normalize_date(event_data.get('date', '')) if event_data.get('date') else '',
            event_data.get('start_time', ''),
            event_data.get('end_time', ''),
            event_data.get('name', ''),
        ])
    digest = hashlib.sha256(raw_key.encode('utf-8')).hexdigest()
    return f'upload|{digest}'


def link_safe_legacy_spacecloud_task(
        cursor, task_type, email_event_id, booking_ledger_id):
    """Upgrade one replayed legacy task only when its exact ledger generation agrees."""
    ledger_event_columns = {
        'upload': 'confirmed_email_event_id',
        'delete': 'canceled_email_event_id',
    }
    ledger_event_column = ledger_event_columns.get(task_type)
    event_identity = spacecloud_task_event_identity(email_event_id)
    ledger_id = spacecloud_task_event_identity(booking_ledger_id)
    if not ledger_event_column or not event_identity or not ledger_id:
        return 0
    cursor.execute(
        f"""
        UPDATE rhythmjoy_spacecloud_tasks AS task
        INNER JOIN rhythmjoy_booking_ledger AS ledger
                ON ledger.id=%s
               AND ledger.source_platform='naver'
               AND ledger.{ledger_event_column}=%s
               AND ledger.room_key=task.room_key
               AND ledger.reservation_number=task.reservation_number
               AND ledger.reservation_date <=> task.reservation_date
               AND ledger.start_time <=> task.start_time
               AND ledger.end_time <=> task.end_time
        SET task.booking_ledger_id=ledger.id,
            task.side_effect_state='ready',
            task.side_effect_token='',
            task.updated_at=NOW()
        WHERE task.task_type=%s
          AND task.email_event_id=%s
          AND task.status='pending'
          AND task.attempts=0
          AND task.side_effect_state IS NULL
          AND task.reservation_number<>''
          AND (task.booking_ledger_id IS NULL OR task.booking_ledger_id=ledger.id)
        """,
        (ledger_id, event_identity, task_type, event_identity),
    )
    return cursor.rowcount


def existing_spacecloud_task_dedupe_key(cursor, task_type, email_event_id):
    event_identity = spacecloud_task_event_identity(email_event_id)
    if not event_identity:
        return None
    cursor.execute(
        """
        SELECT dedupe_key
        FROM rhythmjoy_spacecloud_tasks
        WHERE task_type=%s AND email_event_id=%s
        ORDER BY id ASC
        LIMIT 1
        FOR UPDATE
        """,
        (task_type, event_identity),
    )
    existing = cursor.fetchone() or {}
    return existing.get('dedupe_key')


def lock_spacecloud_task_for_event(cursor, task_type, email_event_id):
    event_identity = spacecloud_task_event_identity(email_event_id)
    if not event_identity:
        return None
    cursor.execute(
        """
        SELECT *
        FROM rhythmjoy_spacecloud_tasks
        WHERE task_type=%s AND email_event_id=%s
        ORDER BY id ASC
        LIMIT 1
        FOR UPDATE
        """,
        (task_type, event_identity),
    )
    return cursor.fetchone()


def assert_spacecloud_task_replay_identity(existing, incoming):
    """Protect attempted/finalized task identity from duplicate producer rewrites."""
    comparisons = {
        'task_type': (
            str(existing.get('task_type') or ''),
            str(incoming.get('task_type') or ''),
        ),
        'email_event_id': (
            int(existing.get('email_event_id') or 0),
            int(incoming.get('email_event_id') or 0),
        ),
        'room_key': (
            str(existing.get('room_key') or ''),
            str(incoming.get('room_key') or ''),
        ),
        'reservation_number': (
            str(existing.get('reservation_number') or ''),
            str(incoming.get('reservation_number') or ''),
        ),
        'reservation_date': (
            clean_date_or_none(existing.get('reservation_date')),
            clean_date_or_none(incoming.get('reservation_date')),
        ),
        'start_time': (
            clean_time_or_none(existing.get('start_time')),
            clean_time_or_none(incoming.get('start_time')),
        ),
        'end_time': (
            clean_time_or_none(existing.get('end_time')),
            clean_time_or_none(incoming.get('end_time')),
        ),
    }
    existing_ledger_id = int(existing.get('booking_ledger_id') or 0)
    incoming_ledger_id = int(incoming.get('booking_ledger_id') or 0)
    if existing_ledger_id and existing_ledger_id != incoming_ledger_id:
        comparisons['booking_ledger_id'] = (existing_ledger_id, incoming_ledger_id)
    mismatches = [
        field for field, values in comparisons.items()
        if values[0] != values[1]
    ]
    if mismatches:
        raise ConfigError(
            'Immutable SpaceCloud task replay identity mismatch '
            f"task_id={existing.get('id')} fields={','.join(sorted(mismatches))}"
        )


def fence_canceled_spacecloud_uploads(cursor, booking_ledger_id, canceled_email_event_id):
    """Atomically prevent any not-yet-armed upload for this cancellation generation."""
    ledger_id = spacecloud_task_event_identity(booking_ledger_id)
    event_identity = spacecloud_task_event_identity(canceled_email_event_id)
    if not ledger_id or not event_identity:
        return 0
    skipped_result = json.dumps({
        'status': 'stale-ledger-skip',
        'reason': 'booking canceled before the SpaceCloud upload was armed',
        'submissionAttempted': False,
        'mirrorMutationState': 'not_created',
        'retryMode': 'safe-retry-before-submit',
        'bookingLedgerId': ledger_id,
        'canceledEmailEventId': event_identity,
    }, ensure_ascii=False, separators=(',', ':'))
    cursor.execute(
        """
        UPDATE rhythmjoy_spacecloud_tasks AS task
        INNER JOIN rhythmjoy_booking_ledger AS ledger
                ON ledger.id=task.booking_ledger_id
        SET task.side_effect_state='skipped',
            task.side_effect_token='',
            task.side_effect_finalized_at=NOW(),
            task.status='done',
            task.locked_at=NULL,
            task.claim_token='',
            task.confirmation_sms_required=0,
            task.processed_at=NOW(),
            task.result_text=%s,
            task.updated_at=NOW()
        WHERE task.task_type='upload'
          AND task.booking_ledger_id=%s
          AND task.side_effect_state='ready'
          AND ledger.current_status='canceled'
          AND ledger.canceled_email_event_id=%s
        """,
        (skipped_result, ledger_id, event_identity),
    )
    fenced_count = cursor.rowcount
    cursor.execute(
        """
        UPDATE rhythmjoy_sms_deliveries AS delivery
        INNER JOIN rhythmjoy_spacecloud_tasks AS task
                ON task.id=delivery.source_task_id
               AND task.task_type=delivery.source_task_type
        INNER JOIN rhythmjoy_booking_ledger AS ledger
                ON ledger.id=task.booking_ledger_id
        SET delivery.status='skipped',
            delivery.error_text='booking canceled before SpaceCloud upload submit',
            delivery.next_retry_at=NULL,
            delivery.updated_at=NOW()
        WHERE task.task_type='upload'
          AND task.booking_ledger_id=%s
          AND task.side_effect_state='skipped'
          AND ledger.current_status='canceled'
          AND ledger.canceled_email_event_id=%s
          AND delivery.status IN ('pending', 'failed', 'phone_lookup_failed')
        """,
        (ledger_id, event_identity),
    )
    return fenced_count


def upload_task_waiting_on_canceled_reservation(task, canceled_reservation_number):
    if not task or task.get('status') != 'needs_review' or not canceled_reservation_number:
        return False
    try:
        result = json.loads(task.get('result_text') or '{}')
    except (TypeError, ValueError):
        return False
    if not isinstance(result, dict):
        return False
    winning = result.get('winningBooking') or {}
    return (
        result.get('status') == 'needs-review'
        and result.get('nextAction') == 'manual-review-no-cancellation'
        and str(winning.get('reservationNumber') or '').strip() == str(canceled_reservation_number).strip()
    )


def ensure_confirmation_sms_intent(cursor, task, enabled=True):
    """Write the durable SMS intent before any browser or provider work starts."""
    if not enabled or not task:
        return None
    task_type = str(task.get('task_type') or '')
    task_id = task.get('id')
    if task_type not in ('upload', 'naver_block') or not task_id:
        return None
    # Do not backfill old completed jobs during a duplicate email replay. New
    # jobs are pending here and become eligible only after platform sync is done.
    if str(task.get('status') or '') not in ('pending', 'running', 'claimed'):
        return None
    idempotency_key = f'reservation-confirmed-v1|{task_type}|{int(task_id)}'
    cursor.execute(
        """
        INSERT IGNORE INTO rhythmjoy_sms_deliveries (
            idempotency_key, source_task_type, source_task_id, template_name,
            recipient_phone_hash, recipient_phone_last4, status,
            attempt_count, created_at, updated_at
        ) VALUES (%s,%s,%s,'reservation-confirmed-v1','','','pending',0,NOW(),NOW())
        """,
        (idempotency_key, task_type, int(task_id)),
    )
    return idempotency_key


def upsert_spacecloud_delete_task(
        config, logger, email_event_id, deletion, calendar_key, conn=None,
        booking_ledger_id=None):
    room_key = calendar_to_spacecloud_room_key(calendar_key)
    if not config['db_enabled'] or not room_key:
        if not room_key:
            logger.info('SpaceCloud delete task skipped: no room mapping for calendar=%s product=%s', calendar_key, deletion.get('product'))
        return None

    email_event_identity = spacecloud_task_event_identity(email_event_id)
    ledger_id = spacecloud_task_event_identity(booking_ledger_id)
    dedupe_key = spacecloud_delete_dedupe_key(
        deletion,
        room_key,
        email_event_identity,
    )
    payload = {
        'source': 'naver-email-cancellation',
        'calendarKey': calendar_key,
        'roomKey': room_key,
        'emailEventId': email_event_identity,
        'bookingLedgerId': ledger_id,
        **deletion,
    }
    row = {
        'dedupe_key': dedupe_key,
        'email_event_id': email_event_identity,
        'booking_ledger_id': ledger_id,
        'task_type': 'delete',
        'room_key': room_key,
        'reservation_number': deletion.get('reservation_number') or '',
        'reserver_name': deletion.get('name') or '',
        'product': deletion.get('product') or '',
        'reservation_date': clean_date_or_none(deletion.get('date')),
        'start_time': clean_time_or_none(deletion.get('start_time')),
        'end_time': clean_time_or_none(deletion.get('end_time')),
        'payload_json': json.dumps(payload, ensure_ascii=False, separators=(',', ':')),
    }
    target_start_at, target_end_at = booking_interval_datetimes(
        row['reservation_date'],
        row['start_time'],
        row['end_time'],
    )

    owned_conn = conn is None
    try:
        if owned_conn:
            conn = db_connect(config)
        with conn.cursor() as cursor:
            fenced_count = fence_canceled_spacecloud_uploads(
                cursor,
                ledger_id,
                email_event_identity,
            )
            if email_event_identity and ledger_id:
                row['dedupe_key'] = existing_spacecloud_task_dedupe_key(
                    cursor,
                    'delete',
                    email_event_identity,
                ) or row['dedupe_key']
            existing_event_task = lock_spacecloud_task_for_event(
                cursor,
                'delete',
                email_event_identity,
            )
            if existing_event_task:
                assert_spacecloud_task_replay_identity(existing_event_task, row)
            cursor.execute(
                """
                INSERT INTO rhythmjoy_spacecloud_tasks (
                    dedupe_key, email_event_id, booking_ledger_id,
                    task_type, status, side_effect_state,
                    room_key, reservation_number, reserver_name, product,
                    reservation_date, start_time, end_time, payload_json,
                    created_at, updated_at
                )
                VALUES (
                    %(dedupe_key)s, %(email_event_id)s, %(booking_ledger_id)s,
                    %(task_type)s, 'pending', 'ready',
                    %(room_key)s, %(reservation_number)s, %(reserver_name)s, %(product)s,
                    %(reservation_date)s, %(start_time)s, %(end_time)s, %(payload_json)s,
                    NOW(), NOW()
                )
                ON DUPLICATE KEY UPDATE
                    email_event_id=IF(VALUES(email_event_id) IS NOT NULL, email_event_id, VALUES(email_event_id)),
                    room_key=IF(VALUES(email_event_id) IS NOT NULL, room_key, VALUES(room_key)),
                    reservation_number=IF(VALUES(email_event_id) IS NOT NULL, reservation_number, VALUES(reservation_number)),
                    reserver_name=IF(VALUES(email_event_id) IS NOT NULL, reserver_name, VALUES(reserver_name)),
                    product=IF(VALUES(email_event_id) IS NOT NULL, product, VALUES(product)),
                    reservation_date=IF(VALUES(email_event_id) IS NOT NULL, reservation_date, VALUES(reservation_date)),
                    start_time=IF(VALUES(email_event_id) IS NOT NULL, start_time, VALUES(start_time)),
                    end_time=IF(VALUES(email_event_id) IS NOT NULL, end_time, VALUES(end_time)),
                    payload_json=IF(VALUES(email_event_id) IS NOT NULL, payload_json, VALUES(payload_json)),
                    status=IF(
                        VALUES(email_event_id) IS NOT NULL,
                        status,
                        IF(status IN ('running', 'done', 'already_gone', 'needs_review', 'google_pending'), status, 'pending')
                    ),
                    updated_at=IF(VALUES(email_event_id) IS NOT NULL, updated_at, NOW())
                """,
                row,
            )
            if email_event_identity:
                link_safe_legacy_spacecloud_task(
                    cursor,
                    'delete',
                    email_event_identity,
                    ledger_id,
                )
                cursor.execute(
                    """
                    SELECT *
                    FROM rhythmjoy_spacecloud_tasks
                    WHERE task_type='delete' AND email_event_id=%s
                    ORDER BY id ASC
                    LIMIT 1
                    FOR UPDATE
                    """,
                    (email_event_identity,),
                )
            else:
                cursor.execute(
                    'SELECT * FROM rhythmjoy_spacecloud_tasks WHERE dedupe_key=%s LIMIT 1',
                    (dedupe_key,),
                )
            task = cursor.fetchone()
            cursor.execute(
                """
                SELECT id, status, result_text
                FROM rhythmjoy_spacecloud_tasks
                WHERE task_type='upload'
                  AND status='needs_review'
                  AND (side_effect_state IS NULL OR side_effect_state='ready')
                  AND room_key=%s
                  AND DATE_ADD(TIMESTAMP(reservation_date, '00:00:00'), INTERVAL TIME_TO_SEC(start_time) SECOND) < %s
                  AND DATE_ADD(
                        TIMESTAMP(reservation_date, '00:00:00'),
                        INTERVAL (TIME_TO_SEC(end_time) + IF(end_time <= start_time, 86400, 0)) SECOND
                      ) > %s
                ORDER BY id
                """,
                (
                    room_key,
                    target_end_at,
                    target_start_at,
                ),
            )
            retry_ids = [
                candidate['id']
                for candidate in cursor.fetchall()
                if upload_task_waiting_on_canceled_reservation(
                    candidate,
                    row['reservation_number'],
                )
            ]
            if retry_ids:
                safe_retry_result = json.dumps({
                    'status': 'canceled-overlap-cleared-requeued',
                    'reason': 'matching earlier cancellation removed the pre-submit overlap',
                    'submissionAttempted': False,
                    'retryMode': 'safe-retry-before-submit',
                    'canceledReservationNumber': row['reservation_number'],
                }, ensure_ascii=False, separators=(',', ':'))
                cursor.execute(
                    f"""
                    UPDATE rhythmjoy_spacecloud_tasks
                    SET status='pending', locked_at=NULL, claim_token='',
                        processed_at=NULL, result_text=%s, updated_at=NOW()
                    WHERE id IN ({','.join(['%s'] * len(retry_ids))})
                    """,
                    [safe_retry_result, *retry_ids],
                )
                logger.info(
                    'Requeued uploads after matching Naver cancellation reservation=%s task_ids=%s',
                    row['reservation_number'],
                    retry_ids,
                )
            if fenced_count:
                logger.info(
                    'Fenced canceled SpaceCloud uploads before submit ledger_id=%s '
                    'canceled_email_event_id=%s count=%s',
                    ledger_id,
                    email_event_identity,
                    fenced_count,
                )
        logger.info('SpaceCloud delete task saved id=%s room=%s reservation=%s status=%s', task.get('id') if task else '-', room_key, row['reservation_number'], task.get('status') if task else '-')
        return task
    except Exception as error:
        if not owned_conn:
            raise
        disable_db_logging(config, logger, 'SpaceCloud delete task save failed', error)
        return None
    finally:
        if owned_conn and conn is not None:
            conn.close()


def upsert_spacecloud_upload_task(
        config, logger, email_event_id, event_data, calendar_key, conn=None,
        booking_ledger_id=None):
    if not config.get('naver_spacecloud_upload_enabled'):
        return None

    room_key = calendar_to_spacecloud_room_key(calendar_key)
    if not config['db_enabled'] or not room_key:
        if not room_key:
            logger.info('SpaceCloud upload task skipped: no room mapping for calendar=%s product=%s', calendar_key, event_data.get('product'))
        return None

    if event_data.get('payment_status') and event_data.get('payment_status') != '결제완료':
        logger.info(
            'SpaceCloud upload task skipped: payment status not allowed reservation=%s status=%s',
            event_data.get('reservation_number'),
            event_data.get('payment_status'),
        )
        return None

    email_event_identity = spacecloud_task_event_identity(email_event_id)
    ledger_id = spacecloud_task_event_identity(booking_ledger_id)
    dedupe_key = spacecloud_upload_dedupe_key(
        event_data,
        room_key,
        email_event_identity,
    )
    payload = {
        'source': 'naver-email-reservation',
        'action': 'upload-spacecloud-direct',
        'calendarKey': calendar_key,
        'roomKey': room_key,
        'emailEventId': email_event_identity,
        'bookingLedgerId': ledger_id,
        **event_data,
    }
    row = {
        'dedupe_key': dedupe_key,
        'email_event_id': email_event_identity,
        'booking_ledger_id': ledger_id,
        'task_type': 'upload',
        'room_key': room_key,
        'reservation_number': event_data.get('reservation_number') or '',
        'reserver_name': event_data.get('name') or '',
        'product': event_data.get('product') or '',
        'reservation_date': clean_date_or_none(event_data.get('date')),
        'start_time': clean_time_or_none(event_data.get('start_time')),
        'end_time': clean_time_or_none(event_data.get('end_time')),
        'confirmation_sms_required': 1 if config.get('confirmation_sms_enabled', True) else 0,
        'payload_json': json.dumps(payload, ensure_ascii=False, separators=(',', ':')),
    }

    owned_conn = conn is None
    try:
        if owned_conn:
            conn = db_connect(config)
        with conn.cursor() as cursor:
            if email_event_identity and ledger_id:
                row['dedupe_key'] = existing_spacecloud_task_dedupe_key(
                    cursor,
                    'upload',
                    email_event_identity,
                ) or row['dedupe_key']
            existing_event_task = lock_spacecloud_task_for_event(
                cursor,
                'upload',
                email_event_identity,
            )
            if existing_event_task:
                assert_spacecloud_task_replay_identity(existing_event_task, row)
            cursor.execute(
                """
                INSERT INTO rhythmjoy_spacecloud_tasks (
                    dedupe_key, email_event_id, booking_ledger_id,
                    task_type, status, side_effect_state,
                    room_key, reservation_number, reserver_name, product,
                    reservation_date, start_time, end_time, confirmation_sms_required, payload_json,
                    created_at, updated_at
                )
                VALUES (
                    %(dedupe_key)s, %(email_event_id)s, %(booking_ledger_id)s,
                    %(task_type)s, 'pending', 'ready',
                    %(room_key)s, %(reservation_number)s, %(reserver_name)s, %(product)s,
                    %(reservation_date)s, %(start_time)s, %(end_time)s, %(confirmation_sms_required)s, %(payload_json)s,
                    NOW(), NOW()
                )
                ON DUPLICATE KEY UPDATE
                    email_event_id=IF(VALUES(email_event_id) IS NOT NULL, email_event_id, VALUES(email_event_id)),
                    room_key=IF(VALUES(email_event_id) IS NOT NULL, room_key, VALUES(room_key)),
                    reservation_number=IF(VALUES(email_event_id) IS NOT NULL, reservation_number, VALUES(reservation_number)),
                    reserver_name=IF(VALUES(email_event_id) IS NOT NULL, reserver_name, VALUES(reserver_name)),
                    product=IF(VALUES(email_event_id) IS NOT NULL, product, VALUES(product)),
                    reservation_date=IF(VALUES(email_event_id) IS NOT NULL, reservation_date, VALUES(reservation_date)),
                    start_time=IF(VALUES(email_event_id) IS NOT NULL, start_time, VALUES(start_time)),
                    end_time=IF(VALUES(email_event_id) IS NOT NULL, end_time, VALUES(end_time)),
                    payload_json=IF(VALUES(email_event_id) IS NOT NULL, payload_json, VALUES(payload_json)),
                    status=IF(
                        VALUES(email_event_id) IS NOT NULL,
                        status,
                        IF(status IN ('running', 'done', 'needs_review', 'google_pending'), status, 'pending')
                    ),
                    updated_at=IF(VALUES(email_event_id) IS NOT NULL, updated_at, NOW())
                """,
                row,
            )
            if email_event_identity:
                link_safe_legacy_spacecloud_task(
                    cursor,
                    'upload',
                    email_event_identity,
                    ledger_id,
                )
                cursor.execute(
                    """
                    SELECT *
                    FROM rhythmjoy_spacecloud_tasks
                    WHERE task_type='upload' AND email_event_id=%s
                    ORDER BY id ASC
                    LIMIT 1
                    FOR UPDATE
                    """,
                    (email_event_identity,),
                )
            else:
                cursor.execute(
                    'SELECT * FROM rhythmjoy_spacecloud_tasks WHERE dedupe_key=%s LIMIT 1',
                    (dedupe_key,),
                )
            task = cursor.fetchone()
            ensure_confirmation_sms_intent(
                cursor,
                task,
                enabled=config.get('confirmation_sms_enabled', True),
            )
        logger.info(
            'SpaceCloud upload task saved id=%s room=%s reservation=%s status=%s',
            task.get('id') if task else '-',
            room_key,
            row['reservation_number'],
            task.get('status') if task else '-',
        )
        return task
    except Exception as error:
        if not owned_conn:
            raise
        disable_db_logging(config, logger, 'SpaceCloud upload task save failed', error)
        return None
    finally:
        if owned_conn and conn is not None:
            conn.close()


def upsert_spacecloud_naver_block_task(config, logger, email_event_id, event_data, calendar_key, conn=None):
    if not config.get('spacecloud_naver_block_enabled'):
        return None

    room_key = spacecloud_room_key_from_calendar(calendar_key)
    if not config['db_enabled'] or not room_key:
        if not room_key:
            logger.info('Naver block task skipped: no room mapping for calendar=%s product=%s', calendar_key, event_data.get('product'))
        return None

    dedupe_key = spacecloud_naver_block_dedupe_key(event_data, room_key, email_event_id)
    payload = {
        'source': 'spacecloud-email-reservation',
        'action': 'block-naver-availability',
        'calendarKey': calendar_key,
        'roomKey': room_key,
        **event_data,
    }
    row = {
        'dedupe_key': dedupe_key,
        'email_event_id': email_event_id,
        'task_type': 'naver_block',
        'room_key': room_key,
        'reservation_number': '',
        'reserver_name': event_data.get('name') or '',
        'product': event_data.get('product') or '',
        'reservation_date': clean_date_or_none(event_data.get('date')),
        'start_time': clean_time_or_none(event_data.get('start_time')),
        'end_time': clean_time_or_none(event_data.get('end_time')),
        'confirmation_sms_required': 1 if config.get('confirmation_sms_enabled', True) else 0,
        'payload_json': json.dumps(payload, ensure_ascii=False, separators=(',', ':')),
    }

    owned_conn = conn is None
    try:
        if owned_conn:
            conn = db_connect(config)
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO rhythmjoy_spacecloud_tasks (
                    dedupe_key, email_event_id, task_type, status,
                    room_key, reservation_number, reserver_name, product,
                    reservation_date, start_time, end_time, confirmation_sms_required, payload_json,
                    created_at, updated_at
                )
                VALUES (
                    %(dedupe_key)s, %(email_event_id)s, %(task_type)s, 'pending',
                    %(room_key)s, %(reservation_number)s, %(reserver_name)s, %(product)s,
                    %(reservation_date)s, %(start_time)s, %(end_time)s, %(confirmation_sms_required)s, %(payload_json)s,
                    NOW(), NOW()
                )
                ON DUPLICATE KEY UPDATE
                    email_event_id=VALUES(email_event_id),
                    room_key=VALUES(room_key),
                    reservation_number=VALUES(reservation_number),
                    reserver_name=VALUES(reserver_name),
                    product=VALUES(product),
                    reservation_date=VALUES(reservation_date),
                    start_time=VALUES(start_time),
                    end_time=VALUES(end_time),
                    payload_json=VALUES(payload_json),
                    status=IF(status IN ('running', 'done', 'needs_review', 'google_pending'), status, 'pending'),
                    updated_at=NOW()
                """,
                row,
            )
            cursor.execute(
                'SELECT * FROM rhythmjoy_spacecloud_tasks WHERE dedupe_key=%s LIMIT 1',
                (dedupe_key,),
            )
            task = cursor.fetchone()
            ensure_confirmation_sms_intent(
                cursor,
                task,
                enabled=config.get('confirmation_sms_enabled', True),
            )
        logger.info(
            'Naver block task saved id=%s room=%s reservation=%s status=%s',
            task.get('id') if task else '-',
            room_key,
            row['reservation_number'],
            task.get('status') if task else '-',
        )
        return task
    except Exception as error:
        if not owned_conn:
            raise
        disable_db_logging(config, logger, 'Naver block task save failed', error)
        return None
    finally:
        if owned_conn and conn is not None:
            conn.close()


def upsert_spacecloud_naver_restore_task(config, logger, email_event_id, event_data, calendar_key, conn=None):
    if not config.get('spacecloud_naver_block_enabled'):
        return None

    room_key = spacecloud_room_key_from_calendar(calendar_key)
    if not config['db_enabled'] or not room_key:
        if not room_key:
            logger.info('Naver restore task skipped: no room mapping for calendar=%s product=%s', calendar_key, event_data.get('product'))
        return None

    dedupe_key = spacecloud_naver_restore_dedupe_key(event_data, room_key, email_event_id)
    payload = {
        'source': 'spacecloud-email-cancellation',
        'action': 'restore-naver-availability',
        'calendarKey': calendar_key,
        'roomKey': room_key,
        **event_data,
    }
    row = {
        'dedupe_key': dedupe_key,
        'email_event_id': email_event_id,
        'task_type': 'naver_restore',
        'room_key': room_key,
        'reservation_number': '',
        'reserver_name': event_data.get('name') or '',
        'product': event_data.get('product') or '',
        'reservation_date': clean_date_or_none(event_data.get('date')),
        'start_time': clean_time_or_none(event_data.get('start_time')),
        'end_time': clean_time_or_none(event_data.get('end_time')),
        'payload_json': json.dumps(payload, ensure_ascii=False, separators=(',', ':')),
    }

    owned_conn = conn is None
    try:
        if owned_conn:
            conn = db_connect(config)
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO rhythmjoy_spacecloud_tasks (
                    dedupe_key, email_event_id, task_type, status,
                    room_key, reservation_number, reserver_name, product,
                    reservation_date, start_time, end_time, payload_json,
                    created_at, updated_at
                )
                VALUES (
                    %(dedupe_key)s, %(email_event_id)s, %(task_type)s, 'pending',
                    %(room_key)s, %(reservation_number)s, %(reserver_name)s, %(product)s,
                    %(reservation_date)s, %(start_time)s, %(end_time)s, %(payload_json)s,
                    NOW(), NOW()
                )
                ON DUPLICATE KEY UPDATE
                    email_event_id=VALUES(email_event_id),
                    room_key=VALUES(room_key),
                    reservation_number=VALUES(reservation_number),
                    reserver_name=VALUES(reserver_name),
                    product=VALUES(product),
                    reservation_date=VALUES(reservation_date),
                    start_time=VALUES(start_time),
                    end_time=VALUES(end_time),
                    payload_json=VALUES(payload_json),
                    status=IF(status IN ('running', 'done', 'needs_review', 'google_pending'), status, 'pending'),
                    updated_at=NOW()
                """,
                row,
            )
            cursor.execute(
                'SELECT * FROM rhythmjoy_spacecloud_tasks WHERE dedupe_key=%s LIMIT 1',
                (dedupe_key,),
            )
            task = cursor.fetchone()
        logger.info(
            'Naver restore task saved id=%s room=%s reservation=%s status=%s',
            task.get('id') if task else '-',
            room_key,
            row['reservation_number'],
            task.get('status') if task else '-',
        )
        return task
    except Exception as error:
        if not owned_conn:
            raise
        disable_db_logging(config, logger, 'Naver restore task save failed', error)
        return None
    finally:
        if owned_conn and conn is not None:
            conn.close()


def send_telegram_message(config, text, logger):
    token = config.get('telegram_bot_token', '')
    chat_id = config.get('telegram_chat_id', '')
    if not token or not chat_id:
        logger.info('Telegram cancellation alert skipped: token or chat id missing')
        return False

    try:
        payload = json.dumps({'chat_id': chat_id, 'text': compact_telegram_text(text)}, ensure_ascii=False).encode('utf-8')
        request = urllib.request.Request(
            f'https://api.telegram.org/bot{token}/sendMessage',
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        with urllib.request.urlopen(request, timeout=config['telegram_timeout']) as response:
            response.read()
        logger.info('Telegram cancellation alert sent')
        return True
    except urllib.error.HTTPError as error:
        body = error.read().decode('utf-8', errors='replace')
        logger.exception('Telegram cancellation alert failed http=%s body=%s', error.code, body[:300])
    except Exception:
        logger.exception('Telegram cancellation alert failed')
    return False


def short_alert_text(value, limit=110):
    text = re.sub(r'\s+', ' ', str(value or '')).strip()
    if len(text) <= limit:
        return text or '-'
    return f'{text[:max(0, limit - 3)]}...'


def compact_telegram_text(text, limit=None):
    if limit is None:
        try:
            limit = int(os.environ.get('TELEGRAM_MAX_CHARS', '1200'))
        except ValueError:
            limit = 1200
    limit = max(400, limit)
    normalized = '\n'.join(line.strip() for line in str(text or '').splitlines()).strip()
    normalized = re.sub(r'\n{3,}', '\n\n', normalized)
    if len(normalized) <= limit:
        return normalized
    suffix = f'\n...\n로그: {LOG_FILE}'
    return f'{normalized[:max(0, limit - len(suffix))]}{suffix}'


def alert_time_text():
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def success_alert_title(text):
    return f'✅ 성공: {text}'


def failure_alert_title(text):
    return f'⚠️ 실패: {text}'


def alert_event_line(event_data):
    return short_alert_text(
        f"{event_data.get('product') or '-'} / "
        f"{reservation_time_text(event_data)} / "
        f"{event_data.get('name') or '-'}",
        150,
    )


def alert_mail_line(subject):
    return f"메일: {short_alert_text(subject or '-', 90)}"


def format_spacecloud_delete_status(task, calendar_key):
    if task:
        task_id = task.get('id') or '-'
        status = task.get('status') or 'pending'
        status_text = {
            'pending': '스페이스클라우드 삭제 대기',
            'running': '삭제 처리 중',
            'done': '스페이스클라우드 삭제 완료',
            'already_gone': '스페이스클라우드 이미 없음',
            'needs_review': '스페이스클라우드 삭제 확인 필요',
            'google_pending': '이전 연동 대기 기록',
            'failed': '스페이스클라우드 삭제 실패',
        }.get(status, f'상태 {status}')
        return f'{status_text} (작업 #{task_id})'
    if calendar_to_spacecloud_room_key(calendar_key):
        return '삭제 작업을 만들지 못함(DB/큐 확인 필요)'
    return '대상 아님(스페이스클라우드 방 매핑 없음)'


def format_cancellation_alert(deletion, calendar_key, spacecloud_task, subject, email_received_at):
    title = success_alert_title('네이버 취소 메일 수집')
    if calendar_to_spacecloud_room_key(calendar_key) and not spacecloud_task:
        title = failure_alert_title('네이버 취소 삭제작업 생성')
    spacecloud_delete_status = format_spacecloud_delete_status(spacecloud_task, calendar_key)

    return (
        f'{title}\n'
        f'{alert_time_text()}\n\n'
        f'대상: {alert_event_line(deletion)}\n'
        f"예약번호: {deletion.get('reservation_number') or '-'}\n"
        f'다음작업: 스페이스클라우드에서 같은 예약 삭제\n'
        f'스페이스클라우드: {short_alert_text(spacecloud_delete_status, 100)}\n'
        f'DB 원장: 취소 반영 완료\n'
        f'메일수신: {email_received_at or "-"}\n'
        f'{alert_mail_line(subject)}'
    )


def notify_cancellation(config, deletion, calendar_key, spacecloud_task, subject, email_received_at, logger):
    if spacecloud_task and not config.get('telegram_notify_intake_success'):
        logger.info('Telegram intake alert skipped: final watcher result will be sent task=%s', spacecloud_task.get('id'))
        return False
    text = format_cancellation_alert(deletion, calendar_key, spacecloud_task, subject, email_received_at)
    return send_telegram_message(config, text, logger)


def notify_cancellation_parse_failure(config, mailbox, email_id, subject, email_received_at, logger):
    text = (
        f"{failure_alert_title('네이버 취소 메일 파싱')}\n"
        f'{alert_time_text()}\n\n'
        f'메일: {mailbox} / {email_id}\n'
        f'메일수신: {email_received_at or "-"}\n'
        f'{alert_mail_line(subject)}\n'
        '조치: 취소 메일 양식 확인'
    )
    send_telegram_message(config, text, logger)


def format_naver_block_task_status(config, task):
    if not config.get('spacecloud_naver_block_enabled'):
        return '네이버 예약불가 반영 안 함(report-only)'
    if task:
        return f"네이버 예약불가 반영 대기: 작업 #{task.get('id') or '-'} / {task.get('status') or '-'}"
    return '네이버 예약불가 작업 생성 실패: DB/방 매핑/파싱 확인'


def notify_spacecloud_reservation_report(config, event_data, calendar_key, naver_block_task, subject, email_received_at, logger):
    if naver_block_task and not config.get('telegram_notify_intake_success'):
        logger.info('Telegram intake alert skipped: final watcher result will be sent task=%s', naver_block_task.get('id'))
        return False
    status = '네이버 반영 대기'
    current_step = format_naver_block_task_status(config, naver_block_task)
    title = success_alert_title('스페이스클라우드 예약 메일 수집')
    if config.get('spacecloud_naver_block_enabled') and not naver_block_task:
        title = failure_alert_title('스페이스클라우드 예약 작업 생성')
    text = (
        f'{title}\n'
        f'{alert_time_text()}\n\n'
        f'상태: {status}\n'
        f'대상: {alert_event_line(event_data)}\n'
        f"네이버: {short_alert_text(current_step, 120)}\n"
        f"DB 원장: 예약 반영 완료\n"
        f"메일수신: {email_received_at or '-'}\n"
        f'{alert_mail_line(subject)}'
    )
    return send_telegram_message(config, text, logger)


def notify_spacecloud_parse_failure(config, mailbox, email_id, subject, email_received_at, logger):
    text = (
        f"{failure_alert_title('스페이스클라우드 예약완료 메일 파싱')}\n"
        f'{alert_time_text()}\n\n'
        f'메일: {mailbox} / {email_id}\n'
        f'메일수신: {email_received_at or "-"}\n'
        f'{alert_mail_line(subject)}\n'
        '조치: 예약 메일 양식 확인'
    )
    send_telegram_message(config, text, logger)


def format_naver_restore_task_status(config, task):
    if not config.get('spacecloud_naver_block_enabled'):
        return '네이버 예약가능 복구 안 함(report-only)'
    if task:
        return f"네이버 예약가능 복구 대기: 작업 #{task.get('id') or '-'} / {task.get('status') or '-'}"
    return '네이버 예약가능 복구 작업 생성 실패: DB/방 매핑/파싱 확인'


def notify_spacecloud_cancellation_report(config, event_data, calendar_key, naver_restore_task, subject, email_received_at, logger):
    if naver_restore_task and not config.get('telegram_notify_intake_success'):
        logger.info('Telegram intake alert skipped: final watcher result will be sent task=%s', naver_restore_task.get('id'))
        return False
    current_step = format_naver_restore_task_status(config, naver_restore_task)
    title = success_alert_title('스페이스클라우드 취소 메일 수집')
    if config.get('spacecloud_naver_block_enabled') and not naver_restore_task:
        title = failure_alert_title('스페이스클라우드 취소 복구작업 생성')
    text = (
        f'{title}\n'
        f'{alert_time_text()}\n\n'
        f'대상: {alert_event_line(event_data)}\n'
        f"네이버: {short_alert_text(current_step, 120)}\n"
        f"DB 원장: 취소 반영 완료\n"
        f"메일수신: {email_received_at or '-'}\n"
        f'{alert_mail_line(subject)}'
    )
    return send_telegram_message(config, text, logger)


def notify_spacecloud_cancellation_parse_failure(config, mailbox, email_id, subject, email_received_at, logger):
    text = (
        f"{failure_alert_title('스페이스클라우드 취소완료 메일 파싱')}\n"
        f'{alert_time_text()}\n\n'
        f'메일: {mailbox} / {email_id}\n'
        f'메일수신: {email_received_at or "-"}\n'
        f'{alert_mail_line(subject)}\n'
        '조치: 취소 메일 양식 확인'
    )
    send_telegram_message(config, text, logger)


def product_to_calendar_key(product):
    product = product or ''
    if 'A홀 화이트' in product:
        return 'Aroom'
    if 'B홀 블랙' in product:
        return 'Broom'
    if 'A홀' in product:
        return 'Ahall'
    if 'B홀' in product:
        return 'Bhall'
    if 'C홀' in product:
        return 'Chall'
    if 'D홀' in product:
        return 'Dhall'
    if 'E홀' in product:
        return 'Ehall'
    return None


def clean_spacecloud_body(body):
    text = re.sub(r'(?is)<(script|style).*?</\1>', ' ', body or '')
    text = re.sub(r'(?is)<br\s*/?>', '\n', text)
    text = re.sub(r'(?is)</(td|tr|p|div|li|h\d)>', '\n', text)
    text = re.sub(r'(?is)<[^>]+>', ' ', text)
    text = html.unescape(text)
    text = re.sub(r'[ \t\r\f\v]+', ' ', text)
    text = re.sub(r'\n\s*\n+', '\n', text)
    return text.strip()


def compact_spacecloud_text(body):
    return re.sub(r'\s+', ' ', clean_spacecloud_body(body)).strip()


def extract_spacecloud_field(text, label, following_labels):
    labels = '|'.join(re.escape(item) for item in following_labels)
    pattern = rf'{re.escape(label)}\s+(.+?)(?=\s+(?:{labels})(?:\s+|$)|$)'
    match = re.search(pattern, text, re.DOTALL)
    return match.group(1).strip() if match else ''


def parse_spacecloud_reservation_id(raw_message):
    text = raw_message.decode('utf-8', errors='replace') if isinstance(raw_message, bytes) else str(raw_message or '')
    match = re.search(r'reservation(?:%2F|/)(\d{5,})(?:%2F|/)', text, re.IGNORECASE)
    if match:
        return match.group(1)
    return ''


def normalize_spacecloud_hour(hour_text, minute_text=''):
    hour = int(hour_text)
    minute = int(minute_text or 0)
    if minute == 59:
        hour += 1
        minute = 0
    return f'{hour:02d}:{minute:02d}'


def is_spacecloud_reservation_complete(subject, body):
    return '예약 완료' in (subject or '') or '예약승인완료' in (body or '')


def is_spacecloud_cancellation_complete(subject, body):
    text = f"{subject or ''}\n{body or ''}"
    return any(keyword in text for keyword in ('취소 완료', '예약취소', '예약이 취소되었습니다', '취소된 예약'))


def is_spacecloud_admin_settlement(subject, body):
    text = f"{subject or ''}\n{body or ''}"
    return '정산' in text and not is_spacecloud_reservation_complete(subject, body) and not is_spacecloud_cancellation_complete(subject, body)


def parse_spacecloud_booking_details(body, raw_message, source_mode, payment_status):
    text = compact_spacecloud_text(body)
    product_match = re.search(r'(A홀|B홀|C홀|D홀|E홀)\s*[^\s,]+(?:\s*[^\s,]+)?-?외부신발금지', text)
    if not product_match:
        product_match = re.search(r'(A홀|B홀|C홀|D홀|E홀)[^\n,]*', clean_spacecloud_body(body))
    content_match = re.search(
        r'예약내용\s+(\d{4})[./-](\d{1,2})[./-](\d{1,2})\s+(\d{1,2})(?::(\d{2}))?\s*시\s*-\s*(\d{1,2})(?::(\d{2}))?\s*시',
        text,
    )

    labels = [
        '예약공간',
        '예약내용',
        '예약인원',
        '예약옵션',
        '요청사항',
        '예약자명',
        '결제수단',
        '결제금액',
        '결제예정금액',
        '취소수수료',
        '환불금액',
        '호스트센터로 이동',
    ]
    payment_labels = ['결제수단', '결제금액', '결제예정금액', '취소수수료', '환불금액', '호스트센터로 이동']
    name = extract_spacecloud_field(text, '예약자명', payment_labels)
    price = (
        extract_spacecloud_field(text, '결제금액', ['결제예정금액', '취소수수료', '환불금액', '호스트센터로 이동'])
        or extract_spacecloud_field(text, '결제예정금액', ['취소수수료', '환불금액', '호스트센터로 이동'])
        or extract_spacecloud_field(text, '환불금액', ['호스트센터로 이동'])
    )
    payment_method = extract_spacecloud_field(text, '결제수단', ['결제금액', '호스트센터로 이동'])
    headcount = extract_spacecloud_field(text, '예약인원', labels)
    space_name = extract_spacecloud_field(text, '예약공간', labels)

    if not product_match or not content_match or not name:
        return None

    product = product_match.group(0).strip()
    year, month, day, start_hour, start_minute, end_hour, end_minute = content_match.groups()
    date_text = f'{year}-{int(month):02d}-{int(day):02d}'
    start_time = normalize_spacecloud_hour(start_hour, start_minute)
    end_time = normalize_spacecloud_hour(end_hour, end_minute)

    return {
        'source_platform': 'spacecloud',
        'source_mode': source_mode,
        'spacecloud_reservation_id': parse_spacecloud_reservation_id(raw_message),
        'name': name,
        'reservation_number': '',
        'product': product,
        'space_name': space_name,
        'date': date_text,
        'start_time': start_time,
        'end_time': end_time,
        'headcount': headcount,
        'payment_status': payment_status,
        'payment_method': payment_method,
        'price': price,
    }


def parse_spacecloud_reservation(body, raw_message, subject):
    if not is_spacecloud_reservation_complete(subject, body):
        return None
    return parse_spacecloud_booking_details(body, raw_message, 'spacecloud_email', '예약완료')


def parse_spacecloud_cancellation(body, raw_message, subject):
    if not is_spacecloud_cancellation_complete(subject, body):
        return None
    event_data = parse_spacecloud_booking_details(body, raw_message, 'spacecloud_cancel_email', '취소완료')
    if event_data:
        event_data['cancellation_status'] = '취소완료'
    return event_data


def reservation_time_text(payload):
    if payload.get('date') and payload.get('start_time') and payload.get('end_time'):
        return f"{payload['date']} {payload['start_time']}-{payload['end_time']}"
    return '-'


def parse_reservation(body, target_calendar):
    patterns = {
        'name': re.compile(r'예약자명\s+([가-힣a-zA-Z\*\s]+님)', re.DOTALL),
        'number': re.compile(r'예약번호\s+(\d+)', re.DOTALL),
        'product': re.compile(r'예약상품\s+([\w\s\(\)]+)', re.DOTALL),
        'datetime': re.compile(r'이용일시\s+([\d\.]+)\((\w+)\)\s*(오전|오후)\s*(\d+:\d+)~(오전|오후)\s*(\d+:\d+)', re.DOTALL),
        'status': re.compile(r'결제상태\s+([\w]+)', re.DOTALL),
        'price': re.compile(r'=\s*([\d,]+\s*원)', re.DOTALL),
    }
    matches = {key: pattern.search(body) for key, pattern in patterns.items()}
    required = ['name', 'number', 'product', 'datetime', 'status']
    if any(matches[key] is None for key in required):
        return None

    datetime_match = matches['datetime']
    return {
        'name': matches['name'].group(1).strip(),
        'reservation_number': matches['number'].group(1).strip(),
        'product': matches['product'].group(1).strip(),
        'date': normalize_date(datetime_match.group(1).strip()),
        'start_time': convert_to_24_hour(datetime_match.group(3), datetime_match.group(4)),
        'end_time': convert_to_24_hour(datetime_match.group(5), datetime_match.group(6)),
        'payment_status': matches['status'].group(1).strip(),
        'price': matches['price'].group(1).strip() if matches['price'] else 'N/A',
        'target_calendar': target_calendar,
    }


def parse_cancellation(body):
    if '취소' not in body:
        return None

    datetime_match = re.search(r'이용일시\s+([\d\.]+)\(.*?\)\s*(오전|오후)\s*(\d{1,2}:\d{2})\s*~\s*(오전|오후)\s*(\d{1,2}:\d{2})', body)
    name_match = re.search(r'예약자명\s+(\S+님)', body)
    product_match = re.search(r'예약상품\s+([A-Z가-힣0-9\s]+(?:\(\d+평형\))?)', body)
    number_match = re.search(r'예약번호\s+(\d+)', body)

    if not product_match:
        return None

    deletion = {
        'name': name_match.group(1).strip() if name_match else '',
        'product': product_match.group(1).strip(),
        'reservation_number': number_match.group(1).strip() if number_match else '',
    }
    if datetime_match:
        deletion.update({
            'date': normalize_date(datetime_match.group(1).strip()),
            'start_time': convert_to_24_hour(datetime_match.group(2), datetime_match.group(3)),
            'end_time': convert_to_24_hour(datetime_match.group(4), datetime_match.group(5)),
        })
    return deletion


def mark_seen(imap_connection, email_id, logger):
    try:
        imap_connection.store(email_id, '+FLAGS', '\\Seen')
    except Exception:
        logger.exception('Failed to mark email seen id=%s', email_id.decode('utf-8', errors='replace'))


def untrusted_naver_lifecycle_alert_text(
        email_event_id, mailbox, decoded_id, subject, email_received_at):
    return (
        f"{failure_alert_title('네이버 예약 메일 순서 검증')}\n"
        f'{alert_time_text()}\n\n'
        f'메일: {mailbox} / {decoded_id}\n'
        f'메일수신: {email_received_at or "-"}\n'
        f'{alert_mail_line(subject)}\n'
        f'이벤트 DB: #{email_event_id} / needs_review\n'
        '조치: Message-ID/INTERNALDATE 확인 전 원장·외부 작업 자동 반영 금지'
    )


def quarantine_untrusted_naver_lifecycle(
        config, logger, email_row, event_data, mailbox, decoded_id,
        subject, email_received_at, conn=None, alert=True):
    """Durably stop Naver lifecycle effects when source chronology is untrusted."""
    if not event_data or int((email_row or {}).get('event_order_trusted') or 0) == 1:
        return False
    email_event_id = (email_row or {}).get('id')
    if not email_event_id:
        raise ConfigError('Cannot durably quarantine an untrusted Naver lifecycle email')
    reason = 'untrusted_event_order_no_side_effects'
    update_email_processing(
        config,
        email_event_id,
        'needs_review',
        logger,
        conn=conn,
        error_text=reason,
    )
    logger.error(
        'Quarantined untrusted Naver lifecycle event id=%s mailbox=%s email_id=%s received_at=%s',
        email_event_id,
        mailbox,
        decoded_id,
        email_received_at or '-',
    )
    alert_text = untrusted_naver_lifecycle_alert_text(
        email_event_id,
        mailbox,
        decoded_id,
        subject,
        email_received_at,
    )
    if alert:
        notify_untrusted_naver_lifecycle(config, alert_text, logger)
    return True


def notify_untrusted_naver_lifecycle(config, alert_text, logger):
    send_telegram_message(config, alert_text, logger)
    send_alert(
        config,
        'Rhythmjoy Naver event order needs review',
        alert_text,
        logger,
    )


def process_message(config, _unused_service_factory, imap_connection, mailbox, target_calendar, email_id, raw_message, fetch_metadata, logger):
    message = email.message_from_bytes(raw_message)
    subject = decode_header_value(message.get('Subject', ''))
    body = get_text_body(message)
    decoded_id = email_id.decode('utf-8', errors='replace')
    mail_key, message_id = message_identity(mailbox, decoded_id, message, raw_message)
    email_received_at = get_email_received_at(message, fetch_metadata)
    event_order_key = normalized_event_order_key(message_id, email_received_at)
    email_record_id = None
    logger.info(
        'Processing mailbox=%s email_id=%s received_at=%s event_order_key=%s subject=%s',
        mailbox,
        decoded_id,
        email_received_at or '-',
        event_order_key or '-',
        subject,
    )

    try:
        if mailbox in ROOM_MAILBOXES:
            event_data = parse_reservation(body, target_calendar)
            record = build_reservation_email_record(
                config,
                mail_key,
                mailbox,
                decoded_id,
                message_id,
                email_received_at,
                subject,
                body,
                target_calendar,
                event_data,
            )
            payment_waiting = bool(event_data and reservation_waits_for_payment(event_data))
            if payment_waiting:
                record['event_type'] = 'reservation_pending'
                record['processing_status'] = 'payment_pending'
            email_row = upsert_email_event(config, logger, record)
            if (
                    (email_row or {}).get('_immutable_replay')
                    and not immutable_email_replay_resumes_handoff(email_row)
            ):
                logger.info(
                    'Immutable terminal email replay is an idempotent no-op event_id=%s status=%s',
                    email_row.get('id'),
                    email_row.get('processing_status'),
                )
                mark_seen(imap_connection, email_id, logger)
                return
            event_data, target_calendar = durable_email_replay_payload(
                email_row,
                event_data,
                target_calendar,
            )
            payment_waiting = bool(event_data and reservation_waits_for_payment(event_data))
            email_record_id = email_row.get('id') if email_row else None
            event_order_key = (email_row or {}).get('event_order_key') or event_order_key
            if quarantine_untrusted_naver_lifecycle(
                    config,
                    logger,
                    email_row,
                    event_data,
                    mailbox,
                    decoded_id,
                    subject,
                    email_received_at,
            ):
                mark_seen(imap_connection, email_id, logger)
                return
            if event_data:
                if payment_waiting:
                    logger.info(
                        'Reservation email retained without ledger handoff until payment completes '
                        'reservation=%s status=%s',
                        event_data.get('reservation_number'),
                        event_data.get('payment_status'),
                    )
                    mark_seen(imap_connection, email_id, logger)
                    return
                collision = None
                core_change = None
                core_change_task = None
                with db_transaction(config, logger, f'naver-upload:{email_record_id}') as conn:
                    lock_inbox_event(config, logger, conn, email_record_id)
                    with conn.cursor() as cursor:
                        collision = lock_naver_ledger_and_find_opposing_collision(
                            cursor,
                            email_record_id,
                            event_data,
                            target_calendar,
                            'reservation',
                            event_order_key,
                        )
                        if collision:
                            core_change_task = (
                                insert_naver_reservation_quarantine(
                                    cursor,
                                    email_record_id,
                                    event_data,
                                    target_calendar,
                                    None,
                                )
                            )
                        else:
                            core_change = lock_naver_confirmed_core_change(
                                cursor,
                                email_record_id,
                                event_data,
                                target_calendar,
                                event_order_key,
                            )
                    if collision or core_change:
                        update_email_processing(
                            config,
                            email_record_id,
                            (
                                'needs_review'
                                if collision
                                else 'awaiting_predecessor'
                            ),
                            logger,
                            conn=conn,
                            error_text=(
                                'opposing_event_order_collision_no_side_effects'
                                if collision
                                else 'confirmed_generation_waiting_for_cancellation_no_side_effects'
                            ),
                        )
                    else:
                        ledger = upsert_booking_ledger_confirmed(
                            config, logger, email_record_id, event_data,
                            target_calendar, email_received_at, 'naver', conn=conn,
                            event_order_key=event_order_key,
                        )
                        require_handoff(True, ledger, 'Required Naver booking ledger handoff was not created')
                        if config.get('naver_spacecloud_upload_enabled'):
                            upload_task = upsert_spacecloud_upload_task(
                                config,
                                logger,
                                email_record_id,
                                event_data,
                                target_calendar,
                                conn=conn,
                                booking_ledger_id=ledger.get('id'),
                            )
                            require_handoff(True, upload_task, 'Required SpaceCloud upload task was not created')
                            task_status = upload_task.get('status') or 'pending'
                            processing_status = f"spacecloud_upload_{task_status}"
                            if len(processing_status) > 32:
                                processing_status = 'spacecloud_upload_saved'
                            error_text = ''
                        else:
                            processing_status = 'ledger_only'
                            error_text = 'platform_sync_disabled'
                        update_email_processing(
                            config,
                            email_record_id,
                            processing_status,
                            logger,
                            conn=conn,
                            error_text=error_text,
                        )
                if collision or core_change:
                    alert_text = untrusted_naver_lifecycle_alert_text(
                        email_record_id,
                        mailbox,
                        decoded_id,
                        subject,
                        email_received_at,
                    )
                    if collision:
                        alert_text += (
                            '\n충돌: opposing trusted event '
                            f"#{collision.get('id')} / key={event_order_key} / "
                            f"task=#{core_change_task.get('id') if core_change_task else '-'}"
                        )
                    else:
                        alert_text += (
                            '\n대기: later confirmed generation is waiting for its cancellation '
                            f"ledger=#{core_change.get('id')}"
                        )
                    if collision or not (email_row or {}).get('_immutable_replay'):
                        notify_untrusted_naver_lifecycle(config, alert_text, logger)
                    if collision:
                        mark_seen(imap_connection, email_id, logger)
                    return
            else:
                logger.warning('Reservation email did not match parser mailbox=%s email_id=%s', mailbox, decoded_id)
                update_email_processing(
                    config,
                    email_record_id,
                    'parse_failed',
                    logger,
                    error_text='reservation_parser_no_match',
                )
                return
            mark_seen(imap_connection, email_id, logger)
            return

        if mailbox in ('Cancellation', 'Cancelhall'):
            deletion = parse_cancellation(body)
            calendar_key = product_to_calendar_key(deletion.get('product', '')) if deletion else None
            record = build_cancellation_email_record(
                config,
                mail_key,
                mailbox,
                decoded_id,
                message_id,
                email_received_at,
                subject,
                body,
                deletion,
                calendar_key,
            )
            email_row = upsert_email_event(config, logger, record)
            if (
                    (email_row or {}).get('_immutable_replay')
                    and not immutable_email_replay_resumes_handoff(email_row)
            ):
                logger.info(
                    'Immutable terminal email replay is an idempotent no-op event_id=%s status=%s',
                    email_row.get('id'),
                    email_row.get('processing_status'),
                )
                mark_seen(imap_connection, email_id, logger)
                return
            deletion, calendar_key = durable_email_replay_payload(
                email_row,
                deletion,
                calendar_key,
            )
            email_record_id = email_row.get('id') if email_row else None
            event_order_key = (email_row or {}).get('event_order_key') or event_order_key
            event_order_trusted = int((email_row or {}).get('event_order_trusted') or 0) == 1
            missing_reservation_number = bool(
                deletion and not str(deletion.get('reservation_number') or '').strip()
            )
            if deletion and (not event_order_trusted or missing_reservation_number):
                if not email_record_id:
                    raise ConfigError('Cannot durably quarantine a Naver cancellation')
                quarantine_reason = (
                    'untrusted-event-order'
                    if not event_order_trusted
                    else 'missing-reservation-number'
                )
                with db_transaction(
                        config,
                        logger,
                        f'naver-delete-quarantine:{email_record_id}',
                ) as conn:
                    lock_inbox_event(config, logger, conn, email_record_id)
                    with conn.cursor() as cursor:
                        quarantine_task = insert_naver_cancellation_quarantine(
                            cursor,
                            email_record_id,
                            deletion,
                            calendar_key,
                            quarantine_reason,
                            event_order_trusted,
                        )
                    update_email_processing(
                        config,
                        email_record_id,
                        'needs_review',
                        logger,
                        conn=conn,
                        error_text=f"{quarantine_reason.replace('-', '_')}_no_side_effects",
                    )
                alert_text = untrusted_naver_lifecycle_alert_text(
                    email_record_id,
                    mailbox,
                    decoded_id,
                    subject,
                    email_received_at,
                )
                alert_text += (
                    f"\n격리작업: #{quarantine_task.get('id') or '-'} / {quarantine_reason}"
                )
                notify_untrusted_naver_lifecycle(config, alert_text, logger)
                logger.error(
                    'Quarantined Naver cancellation event=%s task=%s reason=%s without ledger mutation',
                    email_record_id,
                    quarantine_task.get('id') if quarantine_task else '-',
                    quarantine_reason,
                )
                mark_seen(imap_connection, email_id, logger)
                return
            if deletion:
                collision = None
                quarantine_task = None
                spacecloud_task = None
                identity_incomplete = False
                with db_transaction(config, logger, f'naver-delete:{email_record_id}') as conn:
                    lock_inbox_event(config, logger, conn, email_record_id)
                    with conn.cursor() as cursor:
                        deletion, calendar_key, prior_proof = (
                            enrich_naver_cancellation_from_prior_event(
                                cursor,
                                deletion,
                                calendar_key,
                                event_order_key,
                            )
                        )
                        persist_enriched_naver_cancellation_event(
                            cursor,
                            email_record_id,
                            deletion,
                            calendar_key,
                        )
                        identity_incomplete = (
                            prior_proof.get('status') != 'ok'
                            or not naver_cancellation_identity_complete(
                                deletion,
                                calendar_key,
                            )
                        )
                        if identity_incomplete:
                            quarantine_task = insert_naver_cancellation_quarantine(
                                cursor,
                                email_record_id,
                                deletion,
                                calendar_key,
                                (
                                    prior_proof.get('status')
                                    or 'incomplete-cancellation-identity'
                                ),
                                True,
                            )
                        else:
                            collision = lock_naver_ledger_and_find_opposing_collision(
                                cursor,
                                email_record_id,
                                deletion,
                                calendar_key,
                                'cancellation',
                                event_order_key,
                            )
                            if collision:
                                quarantine_task = insert_naver_cancellation_quarantine(
                                    cursor,
                                    email_record_id,
                                    deletion,
                                    calendar_key,
                                    'opposing-event-order-collision',
                                    True,
                                )
                    if identity_incomplete or collision:
                        quarantine_error = (
                            'incomplete_cancellation_identity_no_side_effects'
                            if identity_incomplete
                            else 'opposing_event_order_collision_no_side_effects'
                        )
                        update_email_processing(
                            config,
                            email_record_id,
                            'needs_review',
                            logger,
                            conn=conn,
                            error_text=quarantine_error,
                        )
                    else:
                        ledger = upsert_booking_ledger_canceled(
                            config, logger, email_record_id, deletion,
                            calendar_key, email_received_at, 'naver', conn=conn,
                            event_order_key=event_order_key,
                        )
                        require_handoff(True, ledger, 'Required Naver cancellation ledger handoff was not created')
                        with conn.cursor() as cursor:
                            supersede_waiting_naver_confirmations(
                                cursor,
                                deletion,
                                calendar_key,
                                event_order_key,
                            )
                        if config.get('naver_spacecloud_upload_enabled'):
                            spacecloud_task = upsert_spacecloud_delete_task(
                                config,
                                logger,
                                email_record_id,
                                deletion,
                                calendar_key,
                                conn=conn,
                                booking_ledger_id=ledger.get('id'),
                            )
                            require_handoff(True, spacecloud_task, 'Required SpaceCloud delete task was not created')
                            task_status = spacecloud_task.get('status') or 'pending'
                            processing_status = f"spacecloud_delete_{task_status}"
                            if len(processing_status) > 32:
                                processing_status = 'spacecloud_delete_saved'
                            error_text = 'platform_delete_after_spacecloud'
                        else:
                            processing_status = 'ledger_only_canceled'
                            error_text = 'platform_sync_disabled'
                        update_email_processing(
                            config,
                            email_record_id,
                            processing_status,
                            logger,
                            conn=conn,
                            error_text=error_text,
                        )
                if identity_incomplete or collision:
                    alert_text = untrusted_naver_lifecycle_alert_text(
                        email_record_id,
                        mailbox,
                        decoded_id,
                        subject,
                        email_received_at,
                    )
                    if identity_incomplete:
                        alert_text += (
                            '\n격리: reservation identity incomplete / '
                            f"task=#{quarantine_task.get('id') if quarantine_task else '-'}"
                        )
                    else:
                        alert_text += (
                            '\n충돌: opposing trusted event '
                            f"#{collision.get('id')} / key={event_order_key} / "
                            f"task=#{quarantine_task.get('id') if quarantine_task else '-'}"
                        )
                    notify_untrusted_naver_lifecycle(config, alert_text, logger)
                    mark_seen(imap_connection, email_id, logger)
                    return
                notify_cancellation(config, deletion, calendar_key, spacecloud_task, subject, email_received_at, logger)
            else:
                logger.warning('Cancellation email did not match parser mailbox=%s email_id=%s', mailbox, decoded_id)
                update_email_processing(
                    config,
                    email_record_id,
                    'parse_failed',
                    logger,
                    error_text='cancellation_parser_no_match',
                )
                notify_cancellation_parse_failure(config, mailbox, decoded_id, subject, email_received_at, logger)
                return
            mark_seen(imap_connection, email_id, logger)
            return

        if mailbox in SPACECLOUD_MAILBOXES:
            is_cancellation_complete = is_spacecloud_cancellation_complete(subject, body)
            is_reservation_complete = is_spacecloud_reservation_complete(subject, body)
            is_admin_settlement = is_spacecloud_admin_settlement(subject, body)
            if is_cancellation_complete:
                event_data = parse_spacecloud_cancellation(body, raw_message, subject)
                calendar_key = product_to_calendar_key(event_data.get('product', '')) if event_data else None
                if event_data and calendar_key:
                    event_data = enrich_spacecloud_cancellation_from_db(config, logger, event_data, calendar_key)
                record = build_spacecloud_cancellation_email_record(
                    config,
                    mail_key,
                    mailbox,
                    decoded_id,
                    message_id,
                    email_received_at,
                    subject,
                    body,
                    event_data,
                    calendar_key,
                )
                email_row = upsert_email_event(config, logger, record)
                if (
                        (email_row or {}).get('_immutable_replay')
                        and not immutable_email_replay_resumes_handoff(email_row)
                ):
                    logger.info(
                        'Immutable terminal email replay is an idempotent no-op event_id=%s status=%s',
                        email_row.get('id'),
                        email_row.get('processing_status'),
                    )
                    mark_seen(imap_connection, email_id, logger)
                    return
                event_data, calendar_key = durable_email_replay_payload(
                    email_row,
                    event_data,
                    calendar_key,
                )
                email_record_id = email_row.get('id') if email_row else None
                event_order_key = (email_row or {}).get('event_order_key') or event_order_key
                if event_data and calendar_key:
                    event_data['calendar_key'] = calendar_key
                    event_data['target_calendar'] = calendar_key
                    if config.get('spacecloud_naver_block_enabled'):
                        with db_transaction(config, logger, f'spacecloud-restore:{email_record_id}') as conn:
                            lock_inbox_event(config, logger, conn, email_record_id)
                            ledger = upsert_booking_ledger_canceled(
                                config, logger, email_record_id, event_data,
                                calendar_key, email_received_at, 'spacecloud', conn=conn,
                                event_order_key=event_order_key,
                            )
                            require_handoff(True, ledger, 'Required SpaceCloud cancellation ledger handoff was not created')
                            naver_restore_task = upsert_spacecloud_naver_restore_task(
                                config,
                                logger,
                                email_record_id,
                                event_data,
                                calendar_key,
                                conn=conn,
                            )
                            require_handoff(True, naver_restore_task, 'Required Naver restore task was not created')
                            task_status = naver_restore_task.get('status') or 'pending'
                            processing_status = f"naver_restore_{task_status}"
                            if len(processing_status) > 32:
                                processing_status = 'naver_restore_saved'
                            update_email_processing(
                                config,
                                email_record_id,
                                processing_status,
                                logger,
                                conn=conn,
                                error_text='',
                            )
                    else:
                        upsert_booking_ledger_canceled(
                            config, logger, email_record_id, event_data,
                            calendar_key, email_received_at, 'spacecloud',
                            event_order_key=event_order_key,
                        )
                        naver_restore_task = None
                        processing_status = 'report_only_cancel'
                        update_email_processing(
                            config,
                            email_record_id,
                            processing_status,
                            logger,
                            error_text='',
                        )
                    notify_spacecloud_cancellation_report(
                        config,
                        event_data,
                        calendar_key,
                        naver_restore_task,
                        subject,
                        email_received_at,
                        logger,
                    )
                else:
                    logger.warning('SpaceCloud cancellation email did not match parser mailbox=%s email_id=%s', mailbox, decoded_id)
                    update_email_processing(
                        config,
                        email_record_id,
                        'parse_failed',
                        logger,
                        error_text='spacecloud_cancellation_parser_no_match',
                    )
                    notify_spacecloud_cancellation_parse_failure(config, mailbox, decoded_id, subject, email_received_at, logger)
                    return
                mark_seen(imap_connection, email_id, logger)
                return

            if is_admin_settlement:
                record = build_ignored_email_record(
                    config,
                    mail_key,
                    mailbox,
                    decoded_id,
                    message_id,
                    email_received_at,
                    subject,
                    body,
                    'spacecloud_admin_settlement',
                )
                upsert_email_event(config, logger, record)
                logger.info('SpaceCloud admin settlement email ignored mailbox=%s email_id=%s subject=%s', mailbox, decoded_id, subject)
                mark_seen(imap_connection, email_id, logger)
                return

            if not is_reservation_complete:
                record = build_ignored_email_record(
                    config,
                    mail_key,
                    mailbox,
                    decoded_id,
                    message_id,
                    email_received_at,
                    subject,
                    body,
                    'spacecloud_non_reservation_complete',
                )
                upsert_email_event(config, logger, record)
                logger.info('SpaceCloud email ignored mailbox=%s email_id=%s subject=%s', mailbox, decoded_id, subject)
                mark_seen(imap_connection, email_id, logger)
                return

            event_data = parse_spacecloud_reservation(body, raw_message, subject)
            calendar_key = product_to_calendar_key(event_data.get('product', '')) if event_data else None
            record = build_spacecloud_email_record(
                config,
                mail_key,
                mailbox,
                decoded_id,
                message_id,
                email_received_at,
                subject,
                body,
                event_data,
                calendar_key,
            )
            email_row = upsert_email_event(config, logger, record)
            if (
                    (email_row or {}).get('_immutable_replay')
                    and not immutable_email_replay_resumes_handoff(email_row)
            ):
                logger.info(
                    'Immutable terminal email replay is an idempotent no-op event_id=%s status=%s',
                    email_row.get('id'),
                    email_row.get('processing_status'),
                )
                mark_seen(imap_connection, email_id, logger)
                return
            event_data, calendar_key = durable_email_replay_payload(
                email_row,
                event_data,
                calendar_key,
            )
            email_record_id = email_row.get('id') if email_row else None
            event_order_key = (email_row or {}).get('event_order_key') or event_order_key
            if event_data and calendar_key:
                event_data['calendar_key'] = calendar_key
                event_data['target_calendar'] = calendar_key
                event_data['conflict_count'] = 0
                if config.get('spacecloud_naver_block_enabled'):
                    with db_transaction(config, logger, f'spacecloud-block:{email_record_id}') as conn:
                        lock_inbox_event(config, logger, conn, email_record_id)
                        ledger = upsert_booking_ledger_confirmed(
                            config, logger, email_record_id, event_data,
                            calendar_key, email_received_at, 'spacecloud', conn=conn,
                            event_order_key=event_order_key,
                        )
                        require_handoff(True, ledger, 'Required SpaceCloud booking ledger handoff was not created')
                        naver_block_task = upsert_spacecloud_naver_block_task(
                            config,
                            logger,
                            email_record_id,
                            event_data,
                            calendar_key,
                            conn=conn,
                        )
                        require_handoff(True, naver_block_task, 'Required Naver block task was not created')
                        task_status = naver_block_task.get('status') or 'pending'
                        processing_status = f"naver_block_{task_status}"
                        if len(processing_status) > 32:
                            processing_status = 'naver_block_saved'
                        update_email_processing(
                            config,
                            email_record_id,
                            processing_status,
                            logger,
                            conn=conn,
                            error_text='',
                        )
                else:
                    upsert_booking_ledger_confirmed(
                        config, logger, email_record_id, event_data,
                        calendar_key, email_received_at, 'spacecloud',
                        event_order_key=event_order_key,
                    )
                    naver_block_task = None
                    processing_status = 'report_only_ready'
                    update_email_processing(
                        config,
                        email_record_id,
                        processing_status,
                        logger,
                        error_text='',
                    )
                notify_spacecloud_reservation_report(
                    config,
                    event_data,
                    calendar_key,
                    naver_block_task,
                    subject,
                    email_received_at,
                    logger,
                )
            else:
                logger.warning('SpaceCloud reservation email did not match parser mailbox=%s email_id=%s', mailbox, decoded_id)
                update_email_processing(
                    config,
                    email_record_id,
                    'parse_failed',
                    logger,
                    error_text='spacecloud_reservation_parser_no_match',
                )
                notify_spacecloud_parse_failure(config, mailbox, decoded_id, subject, email_received_at, logger)
                return
            mark_seen(imap_connection, email_id, logger)
            return

        logger.warning('Unknown mailbox configured: %s', mailbox)
        mark_seen(imap_connection, email_id, logger)
    except Exception as error:
        logger.exception('Failed to process email mailbox=%s email_id=%s', mailbox, decoded_id)
        update_email_processing(
            config,
            email_record_id,
            'failed',
            logger,
            error_text=str(error)[:1000],
        )
        raise


def load_event_payload(row):
    try:
        payload = json.loads(row.get('parsed_json') or '{}')
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def backfill_booking_ledger(config, logger):
    if not config['db_enabled']:
        logger.info('Booking ledger backfill skipped: DB disabled')
        return 0

    conn = None
    rows = []
    try:
        conn = db_connect(config)
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, event_type, email_received_at, event_order_key,
                       event_order_trusted,
                       processing_status, error_text,
                       subject, target_calendar, parsed_json, raw_body
                FROM rhythmjoy_naver_email_events
                WHERE (
                    event_type IN ('reservation', 'cancellation', 'spacecloud_reservation', 'spacecloud_cancellation')
                    AND parse_status='parsed'
                  )
                  OR (
                    event_type='spacecloud_ignored'
                    AND subject LIKE '%취소 완료%'
                    AND raw_body IS NOT NULL
                  )
                ORDER BY event_order_key IS NULL ASC, event_order_key ASC, id ASC
                """
            )
            rows = cursor.fetchall()
    except Exception as error:
        disable_db_logging(config, logger, 'Booking ledger backfill select failed', error)
        return 0
    finally:
        if conn is not None:
            conn.close()

    processed = 0
    for row in rows:
        if 'no_side_effects' in str(row.get('error_text') or ''):
            logger.warning(
                'Booking ledger backfill skipped durable lifecycle quarantine row_id=%s',
                row.get('id'),
            )
            continue
        if row.get('event_type') == 'spacecloud_ignored':
            raw_body = row.get('raw_body') or ''
            event_data = parse_spacecloud_cancellation(raw_body, raw_body.encode('utf-8'), row.get('subject') or '')
        else:
            event_data = load_event_payload(row)
        if not event_data:
            continue
        calendar_key = row.get('target_calendar') or event_data.get('target_calendar') or event_data.get('calendar_key') or product_to_calendar_key(event_data.get('product', ''))
        if not calendar_key:
            logger.warning('Booking ledger backfill skipped: no calendar row_id=%s type=%s', row.get('id'), row.get('event_type'))
            continue
        event_type = row.get('event_type')
        source_platform = 'spacecloud' if event_type.startswith('spacecloud_') else 'naver'
        if source_platform == 'naver' and int(row.get('event_order_trusted') or 0) != 1:
            logger.warning(
                'Booking ledger backfill skipped untrusted Naver event row_id=%s type=%s',
                row.get('id'),
                event_type,
            )
            continue
        if event_type in ('reservation', 'spacecloud_reservation'):
            if event_type == 'reservation' and reservation_waits_for_payment(event_data):
                logger.info(
                    'Booking ledger backfill skipped pending Naver payment row_id=%s reservation=%s status=%s',
                    row.get('id'),
                    event_data.get('reservation_number'),
                    event_data.get('payment_status'),
                )
                continue
            upsert_booking_ledger_confirmed(
                config,
                logger,
                row.get('id'),
                event_data,
                calendar_key,
                row.get('email_received_at'),
                source_platform,
                event_order_key=row.get('event_order_key'),
            )
            processed += 1
        elif event_type in ('cancellation', 'spacecloud_cancellation', 'spacecloud_ignored'):
            if source_platform == 'spacecloud':
                event_data = enrich_spacecloud_cancellation_from_db(config, logger, event_data, calendar_key)
            upsert_booking_ledger_canceled(
                config,
                logger,
                row.get('id'),
                event_data,
                calendar_key,
                row.get('email_received_at'),
                source_platform,
                event_order_key=row.get('event_order_key'),
            )
            processed += 1
    logger.info('Booking ledger non-destructive backfill finished processed=%s scanned=%s', processed, len(rows))
    return processed


def verify_booking_event_total_order():
    """Regression-check same-second ordering without requiring a database."""
    class CaptureCursor:
        def __init__(self):
            self.queries = []
            self.rowcount = 0

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def execute(self, query, params=None):
            self.queries.append(str(query))

        def fetchone(self):
            return {'id': 1, 'current_status': 'confirmed'}

    class CaptureConnection:
        def __init__(self):
            self.capture = CaptureCursor()

        def cursor(self):
            return self.capture

    logger = logging.getLogger('rhythmjoy_email_import.event_order_selftest')
    event_data = {
        'source_mode': 'event-order-selftest',
        'reservation_number': 'event-order-selftest',
        'name': 'selftest',
        'product': 'A홀',
        'date': '2098-01-01',
        'start_time': '10:00:00',
        'end_time': '11:00:00',
    }
    captured_sql = {}
    for event_kind, upsert in (
            ('confirmed', upsert_booking_ledger_confirmed),
            ('canceled', upsert_booking_ledger_canceled)):
        connection = CaptureConnection()
        upsert(
            {'db_enabled': True},
            logger,
            101,
            event_data,
            'a',
            '2098-01-01 12:00:00',
            'selftest',
            conn=connection,
            event_order_key=1786869875219,
        )
        captured_sql[event_kind] = next(
            query for query in connection.capture.queries
            if 'ON DUPLICATE KEY UPDATE' in query
        )

    confirmed_sql = ' '.join(captured_sql['confirmed'].split())
    canceled_sql = ' '.join(captured_sql['canceled'].split())
    required_confirmed_fragments = (
        'last_event_at, last_event_id, last_event_order_key',
        'VALUES(last_event_order_key) > last_event_order_key',
        'VALUES(confirmed_email_received_at) = COALESCE(last_event_at',
        'VALUES(confirmed_email_event_id) > COALESCE(last_event_id, 0)',
        'VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at',
        'automation_canceled_order_key IS NOT NULL',
        'VALUES(last_event_order_key) > automation_canceled_order_key',
        'automation_canceled_order_key=IF(',
        'last_event_id=IF(',
        'last_event_order_key=IF(',
    )
    required_canceled_fragments = (
        'last_event_at, last_event_id, last_event_order_key',
        'VALUES(last_event_order_key) > last_event_order_key',
        'VALUES(canceled_email_received_at) = COALESCE(last_event_at',
        'VALUES(canceled_email_event_id) > COALESCE(last_event_id, 0)',
        'last_event_id=IF(',
        'last_event_order_key=IF(',
    )
    for fragment in required_confirmed_fragments:
        if fragment not in confirmed_sql:
            raise ConfigError(f'Confirmed ledger tuple-order SQL missing: {fragment}')
    for fragment in required_canceled_fragments:
        if fragment not in canceled_sql:
            raise ConfigError(f'Canceled ledger tuple-order SQL missing: {fragment}')

    source_ms = 1786869875219
    if message_id_epoch_ms(f'<{source_ms}.naver@example>') != source_ms:
        raise ConfigError('Naver Message-ID epoch-ms prefix was not normalized')
    fallback_ms = received_at_epoch_ms('2026-08-16 17:44:35')
    if not fallback_ms or normalized_event_order_key('not-a-source-clock', '2026-08-16 17:44:35') != fallback_ms:
        raise ConfigError('Received-at fallback event order key was not normalized')
    if normalized_event_order_key(f'{source_ms}.naver@example', '2026-08-16 17:44:35') != source_ms:
        raise ConfigError('Message-ID source clock did not take precedence over received-at fallback')
    implausible_source_ms = source_ms + EVENT_ORDER_SOURCE_CLOCK_MAX_SKEW_MS + 1
    if normalized_event_order_key(
            f'{implausible_source_ms}.naver@example',
            '2026-08-16 17:44:35',
    ) != fallback_ms:
        raise ConfigError('Implausible Message-ID source clock bypassed received-at fallback')
    if normalized_event_order_key(f'{source_ms}.naver@example', None) is not None:
        raise ConfigError('Source clock without received-at corroboration was trusted')
    if event_order_source_is_trusted(f'{source_ms}.naver@example', '2026-08-16 17:44:35') != 1:
        raise ConfigError('Plausible Naver source clock was not marked trusted')
    if event_order_source_is_trusted(
            f'{implausible_source_ms}.naver@example',
            '2026-08-16 17:44:35',
    ) != 0:
        raise ConfigError('Implausible Naver source clock was marked trusted')

    raw_earlier = (
        f'Message-ID: <{source_ms}.naver@example>\r\n'
        'Date: Sun, 16 Aug 2026 17:44:35 +0900\r\n\r\nearlier'
    ).encode('ascii')
    raw_later = (
        f'Message-ID: <{source_ms + 500}.naver@example>\r\n'
        'Date: Sun, 16 Aug 2026 17:44:35 +0900\r\n\r\nlater'
    ).encode('ascii')
    cross_mailbox_rows = [
        ('Cancellation', b'1', '', raw_later),
        ('Ahall', b'999', '', raw_earlier),
    ]
    cross_mailbox_rows.sort(
        key=lambda item: collected_message_sort_key(item[0], item[1], item[2], item[3])
    )
    if [row[0] for row in cross_mailbox_rows] != ['Ahall', 'Cancellation']:
        raise ConfigError('Cross-mailbox collection did not follow the source millisecond clock')

    def apply_email_event(
            state, event_at, event_order_key, event_id, status,
            automation_canceled_at=None, automation_canceled_order_key=None):
        incoming = (event_order_key, event_id)
        previous = (state.get('last_event_order_key') or 0, state.get('last_event_id') or 0)
        if incoming <= previous:
            return state
        if status == 'confirmed':
            if automation_canceled_order_key is not None:
                if event_order_key <= automation_canceled_order_key:
                    return state
            elif event_at <= (automation_canceled_at or '1000-01-01 00:00:00'):
                return state
        return {
            'current_status': status,
            'last_event_at': event_at,
            'last_event_order_key': event_order_key,
            'last_event_id': event_id,
        }

    same_second = '2098-01-01 12:00:00'
    events = (
        (same_second, source_ms, 303, 'confirmed'),
        (same_second, source_ms + 200, 202, 'canceled'),
        (same_second, source_ms + 700, 101, 'confirmed'),
    )
    state = {}
    for event in events:
        state = apply_email_event(state, *event)
    if state != {
            'current_status': 'confirmed',
            'last_event_at': same_second,
            'last_event_order_key': source_ms + 700,
            'last_event_id': 101}:
        raise ConfigError(f'Same-second confirm/cancel/reconfirm ordering failed: {state}')

    terminal_state = dict(state)
    for event in reversed(events):
        state = apply_email_event(state, *event)
    if state != terminal_state:
        raise ConfigError(f'Reverse replay changed terminal booking state: {state}')

    reverse_first_state = {}
    for event in reversed(events):
        reverse_first_state = apply_email_event(reverse_first_state, *event)
    if reverse_first_state != terminal_state:
        raise ConfigError(
            f'Reverse first delivery did not converge to terminal booking state: {reverse_first_state}'
        )

    same_kind_tie_state = apply_email_event(
        terminal_state,
        same_second,
        source_ms + 700,
        102,
        'confirmed',
    )
    if (
            same_kind_tie_state.get('current_status') != 'confirmed'
            or same_kind_tie_state.get('last_event_id') != 102
    ):
        raise ConfigError(
            f'Event-id did not break a same-kind source-clock tie: {same_kind_tie_state}'
        )
    opposing_same_key_collision = (
        terminal_state.get('last_event_order_key') == source_ms + 700
        and terminal_state.get('current_status') != 'canceled'
    )
    if not opposing_same_key_collision:
        raise ConfigError('Opposing same-ms lifecycle collision was not detected')

    legacy_automation_state = dict(terminal_state)
    legacy_automation_state['current_status'] = 'canceled'
    legacy_automation_state = apply_email_event(
        legacy_automation_state,
        same_second,
        source_ms + 900,
        404,
        'confirmed',
        automation_canceled_at=same_second,
    )
    if legacy_automation_state['current_status'] != 'canceled':
        raise ConfigError('Legacy same-second automation cancellation was not conservatively fenced')

    ordered_automation_state = dict(terminal_state)
    ordered_automation_state['current_status'] = 'canceled'
    ordered_automation_state = apply_email_event(
        ordered_automation_state,
        same_second,
        source_ms + 900,
        405,
        'confirmed',
        automation_canceled_at=same_second,
        automation_canceled_order_key=source_ms + 800,
    )
    if (
            ordered_automation_state.get('current_status') != 'confirmed'
            or ordered_automation_state.get('last_event_order_key') != source_ms + 900
    ):
        raise ConfigError(
            'Source-ms confirmation newer than same-second automation cancellation was blocked'
        )

    class PriorReservationCursor:
        def __init__(self, candidates):
            self.candidates = candidates
            self.queries = []

        def execute(self, query, params=None):
            self.queries.append((' '.join(str(query).split()), params))

        def fetchone(self):
            return {'id': 77}

        def fetchall(self):
            return list(self.candidates)

    prior_payload = {
        'reservation_number': 'prior-proof',
        'name': '홍길동',
        'product': 'A홀',
        'date': '2026-08-16',
        'start_time': '14:00',
        'end_time': '15:00',
        'payment_status': '결제완료',
    }
    prior_candidate = {
        'id': 501,
        'event_type': 'reservation',
        'event_order_key': source_ms - 100,
        'event_order_trusted': 1,
        'target_calendar': 'Ahall',
        'reservation_number': 'prior-proof',
        'reserver_name': '홍길동',
        'product': 'A홀',
        'reservation_date': datetime.strptime('2026-08-16', '%Y-%m-%d').date(),
        'start_time': timedelta(hours=14),
        'end_time': timedelta(hours=15),
        'payment_status': '결제완료',
        'parsed_json': compact_json(prior_payload),
    }
    prior_cursor = PriorReservationCursor([prior_candidate])
    enriched, enriched_calendar, proof = enrich_naver_cancellation_from_prior_event(
        prior_cursor,
        {'reservation_number': 'prior-proof'},
        None,
        source_ms,
    )
    if (
            proof.get('status') != 'ok'
            or proof.get('event_id') != 501
            or enriched_calendar != 'Ahall'
            or enriched.get('name') != '홍길동'
            or enriched.get('product') != 'A홀'
            or enriched.get('date') != '2026-08-16'
            or enriched.get('start_time') != '14:00:00'
            or enriched.get('end_time') != '15:00:00'
            or not naver_cancellation_identity_complete(enriched, enriched_calendar)
            or 'event_order_key<%s' not in prior_cursor.queries[1][0]
            or "COALESCE(error_text, '') NOT LIKE '%%no_side_effects%%'"
            not in prior_cursor.queries[1][0]
            or "processing_status='awaiting_predecessor'"
            in prior_cursor.queries[1][0]
            or prior_cursor.queries[1][1] != ('prior-proof', source_ms)
    ):
        raise ConfigError(
            'Cancellation identity was not sourced from its strict-earlier '
            f'trusted reservation: enriched={enriched} proof={proof}'
        )

    untrusted_prior = dict(
        prior_candidate,
        id=502,
        event_order_key=source_ms - 50,
        event_order_trusted=0,
    )
    _, _, proof = enrich_naver_cancellation_from_prior_event(
        PriorReservationCursor([untrusted_prior, prior_candidate]),
        {'reservation_number': 'prior-proof'},
        None,
        source_ms,
    )
    if proof.get('status') != 'untrusted-prior-reservation':
        raise ConfigError('Cancellation identity skipped an untrusted latest prior generation')

    ambiguous_prior = dict(prior_candidate, id=503)
    _, _, proof = enrich_naver_cancellation_from_prior_event(
        PriorReservationCursor([prior_candidate, ambiguous_prior]),
        {'reservation_number': 'prior-proof'},
        None,
        source_ms,
    )
    if proof.get('status') != 'ambiguous-prior-reservation':
        raise ConfigError('Cancellation identity accepted an ambiguous prior generation')

    _, _, proof = enrich_naver_cancellation_from_prior_event(
        PriorReservationCursor([prior_candidate]),
        {
            'reservation_number': 'prior-proof',
            'product': 'B홀',
        },
        'Bhall',
        source_ms,
    )
    if proof.get('status') != 'prior-product-mismatch':
        raise ConfigError('Cancellation identity accepted conflicting generation evidence')

    class EmptyTaskAuditCursor:
        def __init__(self):
            self.queries = []

        def execute(self, query, params=None):
            self.queries.append(' '.join(str(query).split()))

        def fetchall(self):
            return []

    task_audit_cursor = EmptyTaskAuditCursor()
    audit_naver_task_projection_invariants(task_audit_cursor)
    if (
            len(task_audit_cursor.queries) != 4
            or "task.task_type='upload'" not in task_audit_cursor.queries[0]
            or 'task.booking_ledger_id=ledger.id' not in task_audit_cursor.queries[0]
            or "processing_status LIKE 'spacecloud_upload_%'" not in task_audit_cursor.queries[0]
            or "task.task_type='delete'" not in task_audit_cursor.queries[1]
            or "processing_status LIKE 'spacecloud_delete_%'" not in task_audit_cursor.queries[1]
            or "task.status='needs_review'" not in task_audit_cursor.queries[2]
            or 'task.side_effect_state IS NULL' not in task_audit_cursor.queries[2]
            or "event_row.event_type='reservation'" not in task_audit_cursor.queries[3]
            or "task.task_type='upload'" not in task_audit_cursor.queries[3]
    ):
        raise ConfigError('Naver task projection audit lost an exact-task invariant')

    replay_payload = {
        **event_data,
        'target_calendar': 'Ahall',
    }
    replay_existing = {
        'id': 7001,
        'mail_key': 'immutable-replay',
        'mailbox': 'Ahall',
        'message_id': f'<{source_ms}.naver@example>',
        'email_received_at': '2026-08-16 17:44:35',
        'event_order_key': source_ms,
        'event_order_trusted': 1,
        'event_type': 'reservation',
        'parse_status': 'parsed',
        'processing_status': 'spacecloud_upload_done',
        'subject': 'immutable replay',
        'raw_body': None,
        'target_calendar': 'Ahall',
        'parsed_json': compact_json(replay_payload),
    }
    replay_incoming = {
        **replay_existing,
        'processing_status': 'received',
    }
    replay_incoming.pop('id')
    assert_email_event_replay_identity(replay_existing, replay_incoming)

    class ImmutableReplayCursor:
        def __init__(self, row):
            self.row = row
            self.queries = []

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def execute(self, query, params=None):
            self.queries.append(' '.join(str(query).split()))

        def fetchone(self):
            return dict(self.row)

    class ImmutableReplayConnection:
        def __init__(self, row):
            self.capture = ImmutableReplayCursor(row)

        def cursor(self):
            return self.capture

    immutable_replay_connection = ImmutableReplayConnection(replay_existing)
    replay_row = upsert_email_event(
        {'db_enabled': True},
        logger,
        replay_incoming,
        conn=immutable_replay_connection,
    )
    if (
            not replay_row.get('_immutable_replay')
            or any('INSERT INTO' in query for query in immutable_replay_connection.capture.queries)
    ):
        raise ConfigError('Terminal duplicate mutated its durable inbox row')
    mismatched_replay = dict(replay_incoming, event_order_key=source_ms + 1)
    try:
        assert_email_event_replay_identity(replay_existing, mismatched_replay)
    except ConfigError:
        pass
    else:
        raise ConfigError('Immutable inbox replay accepted an order-key mutation')
    if immutable_email_replay_resumes_handoff({
            **replay_existing,
            '_immutable_replay': True,
    }):
        raise ConfigError('Terminal immutable inbox replay attempted another handoff')
    resumed_payload, resumed_calendar = durable_email_replay_payload(
        {
            **replay_existing,
            '_immutable_replay': True,
            'processing_status': 'failed',
        },
        {'reservation_number': 'wrong-local-parser-value'},
        'Bhall',
    )
    if resumed_payload != replay_payload or resumed_calendar != 'Ahall':
        raise ConfigError('Failed inbox replay did not use its durable stored payload')
    if not immutable_email_replay_resumes_handoff({
            **replay_existing,
            '_immutable_replay': True,
            'processing_status': 'awaiting_predecessor',
    }):
        raise ConfigError('Awaiting predecessor replay could not recheck its durable ledger')

    class ConfirmedGenerationCursor:
        def __init__(self):
            self.queries = []

        def execute(self, query, params=None):
            self.queries.append((' '.join(str(query).split()), params))

        def fetchone(self):
            return {
                'id': 71,
                'current_status': 'confirmed',
                'confirmed_email_event_id': 701,
                'last_event_id': 701,
                'last_event_order_key': source_ms,
                'room_key': 'a',
                'reservation_date': '2026-08-16',
                'start_time': '14:00:00',
                'end_time': '15:00:00',
                'event_order_trusted': 1,
            }

    same_core_generation = lock_naver_confirmed_core_change(
        ConfirmedGenerationCursor(),
        702,
        {
            'reservation_number': 'same-core-generation',
            'date': '2026-08-16',
            'start_time': '14:00',
            'end_time': '15:00',
        },
        'Ahall',
        source_ms + 1,
    )
    if not same_core_generation or same_core_generation.get('core_changed') is not False:
        raise ConfigError('Same-core confirmation generation bypassed predecessor fencing')

    class SupersedeCursor:
        def __init__(self):
            self.query = ''
            self.params = None
            self.rowcount = 1

        def execute(self, query, params=None):
            self.query = ' '.join(str(query).split())
            self.params = params

    supersede_cursor = SupersedeCursor()
    if supersede_waiting_naver_confirmations(
            supersede_cursor,
            {
                'reservation_number': 'same-core-generation',
                'date': '2026-08-16',
                'start_time': '14:00',
                'end_time': '15:00',
            },
            'Ahall',
            source_ms + 2,
    ) != 1 or 'event_order_key<%s' not in supersede_cursor.query:
        raise ConfigError('Later cancellation did not supersede exact waiting confirmations')

    def replay_predecessor_saga(sequence):
        ledger_status = None
        ledger_slot = None
        waiting = []
        quarantined = []
        remote_slots = set()
        for kind, order_key, slot in sequence:
            if kind == 'confirmed':
                if ledger_status == 'confirmed':
                    waiting.append((order_key, slot))
                else:
                    ledger_status = 'confirmed'
                    ledger_slot = slot
                    remote_slots.add(slot)
            elif ledger_status != 'confirmed' or slot != ledger_slot:
                quarantined.append((order_key, slot))
            else:
                ledger_status = 'canceled'
                remote_slots.discard(ledger_slot)
                waiting = [
                    item for item in waiting
                    if not (item[0] < order_key and item[1] == slot)
                ]
        return ledger_status, ledger_slot, waiting, quarantined, remote_slots

    changed_slot_late_cancel = replay_predecessor_saga((
        ('confirmed', 1, 'A'),
        ('confirmed', 2, 'B'),
        ('canceled', 3, 'B'),
        ('confirmed', 4, 'D'),
    ))
    if changed_slot_late_cancel != (
            'confirmed', 'A', [(2, 'B'), (4, 'D')], [(3, 'B')], {'A'}):
        raise ConfigError(
            'A<B<C<D changed-slot sequence did not remain fail-closed on U_A'
        )
    cancel_before_reconfirm = replay_predecessor_saga((
        ('confirmed', 1, 'A'),
        ('canceled', 2, 'A'),
        ('confirmed', 3, 'B'),
    ))
    if cancel_before_reconfirm != ('confirmed', 'B', [], [], {'B'}):
        raise ConfigError(
            'A<C<B ordering did not remove U_A before creating only U_B'
        )

    class EmptyReprojectCursor:
        def __init__(self):
            self.queries = []
            self.rowcount = 0

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def execute(self, query, params=None):
            self.queries.append(' '.join(str(query).split()))

        def fetchall(self):
            return []

    class EmptyReprojectConnection:
        def __init__(self):
            self.capture = EmptyReprojectCursor()

        def cursor(self):
            return self.capture

    empty_reproject_connection = EmptyReprojectConnection()
    if reproject_naver_booking_ledgers(
            {'db_enabled': True},
            logger,
            empty_reproject_connection,
    ) != (0, [], []):
        raise ConfigError('Empty deterministic Naver reproject changed state')
    if not any(
            "COALESCE(error_text, '') NOT LIKE '%no_side_effects%'" in query
            for query in empty_reproject_connection.capture.queries
    ):
        raise ConfigError('Durable lifecycle quarantine could re-enter startup projection')

    enriched_cancel_existing = {
        **replay_existing,
        'event_type': 'cancellation',
        'mailbox': 'Cancellation',
        'parsed_json': compact_json({
            'reservation_number': '123456',
            'name': '홍길동',
            'product': 'A홀',
            'date': '2026-08-16',
            'start_time': '14:00:00',
            'end_time': '15:00:00',
            'target_calendar': 'Ahall',
        }),
    }
    enriched_cancel_incoming = {
        **enriched_cancel_existing,
        'parsed_json': compact_json({
            'reservation_number': '123456',
            'name': '홍길동님',
            'product': 'A홀',
            'date': '2026-08-16',
            'start_time': '14:00',
            'end_time': '15:00',
        }),
    }
    assert_email_event_replay_identity(
        enriched_cancel_existing,
        enriched_cancel_incoming,
    )

    class RecoveryFlagCursor:
        def __init__(self, candidates=None):
            self.candidates = list(candidates or [])
            self.queries = []
            self.rowcount = 0

        def execute(self, query, params=None):
            self.queries.append((' '.join(str(query).split()), params))
            self.rowcount = 1 if str(query).lstrip().startswith('UPDATE') else 0

        def fetchall(self):
            rows, self.candidates = self.candidates, []
            return rows

    disabled_recovery_cursor = RecoveryFlagCursor()
    if recover_reprojected_skipped_uploads(
            {'naver_spacecloud_upload_enabled': False},
            disabled_recovery_cursor,
            [1],
    ) != {'uploads': 0, 'sms': 0} or disabled_recovery_cursor.queries:
        raise ConfigError('Disabled upload feature re-armed a skipped upload')
    stale_skip_result = compact_json({
        'status': 'stale-ledger-skip',
        'submissionAttempted': False,
        'mirrorMutationState': 'not_created',
    })
    sms_disabled_cursor = RecoveryFlagCursor([{
        'id': 8001,
        'booking_ledger_id': 81,
        'exact_ledger_id': 81,
        'side_effect_state': 'skipped',
        'task_type': 'upload',
        'status': 'done',
        'locked_at': None,
        'claim_token': '',
        'side_effect_token': '',
        'side_effect_armed_at': None,
        'result_text': stale_skip_result,
    }])
    if recover_reprojected_skipped_uploads(
            {
                'naver_spacecloud_upload_enabled': True,
                'confirmation_sms_enabled': False,
            },
            sms_disabled_cursor,
            [81],
    ) != {'uploads': 1, 'sms': 0}:
        raise ConfigError('SMS-disabled upload recovery did not recover only the upload')
    if (
            any('rhythmjoy_sms_deliveries' in query for query, _ in sms_disabled_cursor.queries)
            or not any(
                'confirmation_sms_required=%s' in query
                and params
                and params[0] == 0
                for query, params in sms_disabled_cursor.queries
            )
    ):
        raise ConfigError('SMS-disabled recovery created or resumed an SMS intent')

    quarantine_calls = []
    quarantine_task_calls = []
    reservation_quarantine_calls = []
    collision_calls = []
    seen_ids = []
    original_globals = {
        name: globals()[name]
        for name in (
            'upsert_email_event',
            'update_email_processing',
            'send_telegram_message',
            'send_alert',
            'mark_seen',
            'db_transaction',
            'lock_inbox_event',
            'insert_naver_cancellation_quarantine',
            'insert_naver_reservation_quarantine',
            'lock_naver_confirmed_core_change',
            'lock_naver_ledger_and_find_opposing_collision',
            'enrich_naver_cancellation_from_prior_event',
            'upsert_booking_ledger_confirmed',
            'upsert_booking_ledger_canceled',
            'upsert_spacecloud_upload_task',
            'upsert_spacecloud_delete_task',
        )
    }

    def fake_email_upsert(_config, _logger, record, conn=None):
        row = dict(record)
        row['id'] = 9000 + len(quarantine_calls)
        return row

    def fake_processing_update(_config, event_id, status, _logger, conn=None, **fields):
        quarantine_calls.append((event_id, status, fields.get('error_text')))

    def forbidden_mutation(*_args, **_kwargs):
        raise ConfigError('Untrusted Naver lifecycle reached a ledger/task mutation')

    class FakeQuarantineCursor:
        rowcount = 0

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def execute(self, _query, _params=None):
            return None

        def fetchone(self):
            return None

        def fetchall(self):
            return []

    class FakeQuarantineConnection:
        def cursor(self):
            return FakeQuarantineCursor()

    @contextmanager
    def fake_transaction(_config, _logger, _label):
        yield FakeQuarantineConnection()

    def fake_quarantine_task(
            _cursor, event_id, deletion, calendar_key,
            reason, event_order_trusted):
        quarantine_task_calls.append({
            'event_id': event_id,
            'reservation_number': deletion.get('reservation_number'),
            'calendar_key': calendar_key,
            'reason': reason,
            'event_order_trusted': event_order_trusted,
        })
        return {'id': 9100, 'status': 'needs_review', 'side_effect_state': None}

    def fake_collision(
            _cursor, event_id, event_data, _calendar_key,
            event_type, event_order_key):
        collision_calls.append((event_id, event_type, event_order_key))
        return {
            'id': 9200 + len(collision_calls),
            'event_type': (
                'cancellation' if event_type == 'reservation' else 'reservation'
            ),
            'reservation_number': event_data.get('reservation_number'),
            'event_order_key': event_order_key,
        }

    def fake_reservation_quarantine(
            _cursor, event_id, event_data, calendar_key, ledger_id):
        reservation_quarantine_calls.append({
            'event_id': event_id,
            'reservation_number': event_data.get('reservation_number'),
            'calendar_key': calendar_key,
            'ledger_id': ledger_id,
        })
        return {'id': 9150, 'status': 'needs_review', 'side_effect_state': None}

    try:
        globals()['upsert_email_event'] = fake_email_upsert
        globals()['update_email_processing'] = fake_processing_update
        globals()['send_telegram_message'] = lambda *_args, **_kwargs: True
        globals()['send_alert'] = lambda *_args, **_kwargs: None
        globals()['mark_seen'] = lambda _imap, email_id, _logger: seen_ids.append(email_id)
        globals()['db_transaction'] = fake_transaction
        globals()['lock_inbox_event'] = lambda *_args, **_kwargs: {'id': 1}
        globals()['insert_naver_cancellation_quarantine'] = fake_quarantine_task
        globals()['insert_naver_reservation_quarantine'] = (
            fake_reservation_quarantine
        )
        globals()['lock_naver_confirmed_core_change'] = forbidden_mutation
        globals()['lock_naver_ledger_and_find_opposing_collision'] = fake_collision
        globals()['enrich_naver_cancellation_from_prior_event'] = (
            lambda _cursor, deletion, calendar_key, _event_order_key: (
                dict(deletion),
                calendar_key,
                {'status': 'ok', 'event_id': 9199},
            )
        )
        globals()['upsert_booking_ledger_confirmed'] = forbidden_mutation
        globals()['upsert_booking_ledger_canceled'] = forbidden_mutation
        globals()['upsert_spacecloud_upload_task'] = forbidden_mutation
        globals()['upsert_spacecloud_delete_task'] = forbidden_mutation

        reservation_body = (
            '예약자명 홍길동님\n예약번호 123456\n예약상품 A홀\n'
            '이용일시 2026.08.16(일) 오후 2:00~오후 3:00\n'
            '결제상태 결제완료\n= 10,000 원'
        )
        cancellation_body = (
            '취소\n예약자명 홍길동님\n예약상품 A홀\n예약번호 123456\n'
            '이용일시 2026.08.16(일) 오후 2:00 ~ 오후 3:00'
        )
        missing_number_cancellation_body = (
            '취소\n예약자명 홍길동님\n예약상품 A홀\n'
            '이용일시 2026.08.16(일) 오후 2:00 ~ 오후 3:00'
        )
        if (
                not parse_reservation(reservation_body, 'Ahall')
                or not parse_cancellation(cancellation_body)
                or not parse_cancellation(missing_number_cancellation_body)
        ):
            raise ConfigError('Untrusted lifecycle regression fixture did not parse')

        def quarantine_message(message_id, body):
            return (
                f'Message-ID: <{message_id}.naver@example>\r\n'
                'Date: Sun, 16 Aug 2026 17:44:35 +0900\r\n'
                'Subject: event-order-selftest\r\n'
                'Content-Type: text/plain; charset=utf-8\r\n'
                'Content-Transfer-Encoding: 8bit\r\n\r\n'
                f'{body}'
            ).encode('utf-8')

        untrusted_config = {
            'db_enabled': True,
            'naver_spacecloud_upload_enabled': True,
            'store_raw_email_body': False,
        }
        process_message(
            untrusted_config,
            None,
            object(),
            'Ahall',
            'Ahall',
            b'1',
            quarantine_message('9999999999999', reservation_body),
            '',
            logger,
        )
        globals()['upsert_email_event'] = lambda *_args, **_kwargs: {
            'id': 9300,
            'event_order_key': source_ms,
            'event_order_trusted': 1,
            'processing_status': 'spacecloud_upload_done',
            '_immutable_replay': True,
        }
        process_message(
            untrusted_config,
            None,
            object(),
            'Ahall',
            'Ahall',
            b'6',
            quarantine_message(str(source_ms + 900), reservation_body),
            '',
            logger,
        )
        globals()['upsert_email_event'] = fake_email_upsert
        process_message(
            untrusted_config,
            None,
            object(),
            'Ahall',
            'Ahall',
            b'4',
            quarantine_message(str(source_ms), reservation_body),
            '',
            logger,
        )
        process_message(
            untrusted_config,
            None,
            object(),
            'Cancellation',
            'Cancellation',
            b'5',
            quarantine_message(str(source_ms), cancellation_body),
            '',
            logger,
        )
        process_message(
            untrusted_config,
            None,
            object(),
            'Cancellation',
            'Cancellation',
            b'3',
            quarantine_message(str(source_ms), missing_number_cancellation_body),
            '',
            logger,
        )
        process_message(
            untrusted_config,
            None,
            object(),
            'Cancellation',
            'Cancellation',
            b'2',
            quarantine_message('9999999999998', cancellation_body),
            '',
            logger,
        )
    finally:
        globals().update(original_globals)

    if (
            len(quarantine_calls) != 5
            or [call[1:] for call in quarantine_calls] != [
                ('needs_review', 'untrusted_event_order_no_side_effects'),
                ('needs_review', 'opposing_event_order_collision_no_side_effects'),
                ('needs_review', 'opposing_event_order_collision_no_side_effects'),
                ('needs_review', 'missing_reservation_number_no_side_effects'),
                ('needs_review', 'untrusted_event_order_no_side_effects'),
            ]
            or len(quarantine_task_calls) != 3
            or [call.get('reason') for call in quarantine_task_calls] != [
                'opposing-event-order-collision',
                'missing-reservation-number',
                'untrusted-event-order',
            ]
            or [call.get('event_order_trusted') for call in quarantine_task_calls] != [True, True, False]
            or len(reservation_quarantine_calls) != 1
            or reservation_quarantine_calls[0].get('ledger_id') is not None
            or [call[1] for call in collision_calls] != ['reservation', 'cancellation']
            or seen_ids != [b'1', b'6', b'4', b'5', b'3', b'2']
    ):
        raise ConfigError(
            'Untrusted Naver lifecycle was not durably quarantined: '
            f'calls={quarantine_calls} tasks={quarantine_task_calls} seen={seen_ids}'
        )

    print('booking ledger same-second total-order self-test OK')
    return True


def verify_transactional_inbox_outbox(config, logger):
    """Fault-inject against the configured InnoDB tables without creating runnable work."""
    if not config['db_enabled']:
        raise ConfigError('Transactional Inbox/Outbox verification requires DB configuration')

    suffix = os.urandom(12).hex()
    mail_key = f'tx-selftest:{suffix}'
    ledger_key = f'tx-selftest:{suffix}'
    dedupe_key = f'tx-selftest:{suffix}'
    ordering_reservation_number = f'tx-order:{suffix}'
    ordering_event_at = '2098-01-01 12:00:00'
    ordering_event_order_base = 4039374000000
    ordering_ledger_key = booking_ledger_key(
        'naver',
        {'reservation_number': ordering_reservation_number},
        'a',
    )
    email_event_id = None

    def ordering_event(marker):
        return {
            'source_mode': 'transaction-event-order-selftest',
            'reservation_number': ordering_reservation_number,
            'name': marker,
            'product': marker,
            'date': '2098-01-01',
            'start_time': '10:00:00',
            'end_time': '11:00:00',
            'payment_status': '결제완료',
        }

    def select_counts():
        conn = db_connect(config)
        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    'SELECT processing_status FROM rhythmjoy_naver_email_events WHERE mail_key=%s',
                    (mail_key,),
                )
                inbox = cursor.fetchone()
                cursor.execute(
                    'SELECT COUNT(*) AS count FROM rhythmjoy_booking_ledger WHERE ledger_key=%s',
                    (ledger_key,),
                )
                ledger_count = cursor.fetchone()['count']
                cursor.execute(
                    """
                    SELECT COUNT(*) AS count
                    FROM rhythmjoy_spacecloud_tasks AS task
                    INNER JOIN rhythmjoy_booking_ledger AS ledger
                            ON ledger.id=task.booking_ledger_id
                    WHERE task.dedupe_key=%s
                      AND task.side_effect_state='ready'
                      AND ledger.ledger_key=%s
                    """,
                    (dedupe_key, ledger_key),
                )
                outbox_count = cursor.fetchone()['count']
            return inbox, ledger_count, outbox_count
        finally:
            conn.close()

    try:
        capture_conn = db_connect(config)
        try:
            with capture_conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO rhythmjoy_naver_email_events (
                        mail_key, mailbox, imap_id, message_id, event_type,
                        parse_status, processing_status, created_at, updated_at
                    ) VALUES (%s, 'transaction_selftest', '', '', 'selftest',
                              'parsed', 'received', NOW(), NOW())
                    """,
                    (mail_key,),
                )
                email_event_id = cursor.lastrowid
        finally:
            capture_conn.close()

        try:
            with db_transaction(config, logger, f'selftest-rollback:{email_event_id}') as conn:
                lock_inbox_event(config, logger, conn, email_event_id)
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        INSERT INTO rhythmjoy_booking_ledger (
                            ledger_key, source_platform, current_status, created_at, updated_at
                        ) VALUES (%s, 'transaction_selftest', 'confirmed', NOW(), NOW())
                        """,
                        (ledger_key,),
                    )
                    ledger_id = cursor.lastrowid
                    cursor.execute(
                        """
                        INSERT INTO rhythmjoy_spacecloud_tasks (
                            dedupe_key, email_event_id, booking_ledger_id,
                            task_type, status, side_effect_state, created_at, updated_at
                        ) VALUES (%s, %s, %s, 'upload', 'selftest', 'ready', NOW(), NOW())
                        """,
                        (dedupe_key, email_event_id, ledger_id),
                    )
                update_email_processing(
                    config, email_event_id, 'selftest_staged', logger, conn=conn
                )
                raise RuntimeError('intentional transactional rollback')
        except RuntimeError as error:
            if str(error) != 'intentional transactional rollback':
                raise

        inbox, ledger_count, outbox_count = select_counts()
        if not inbox or inbox.get('processing_status') != 'received':
            raise ConfigError('Inbox row did not survive fault injection unchanged')
        if ledger_count or outbox_count:
            raise ConfigError('Ledger or Outbox survived an intentionally rolled-back handoff')

        with db_transaction(config, logger, f'selftest-commit:{email_event_id}') as conn:
            lock_inbox_event(config, logger, conn, email_event_id)
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO rhythmjoy_booking_ledger (
                        ledger_key, source_platform, current_status, created_at, updated_at
                    ) VALUES (%s, 'transaction_selftest', 'confirmed', NOW(), NOW())
                    """,
                    (ledger_key,),
                )
                ledger_id = cursor.lastrowid
                cursor.execute(
                    """
                    INSERT INTO rhythmjoy_spacecloud_tasks (
                        dedupe_key, email_event_id, booking_ledger_id,
                        task_type, status, side_effect_state, created_at, updated_at
                    ) VALUES (%s, %s, %s, 'upload', 'selftest', 'ready', NOW(), NOW())
                    """,
                    (dedupe_key, email_event_id, ledger_id),
                )
            update_email_processing(
                config, email_event_id, 'transaction_verified', logger, conn=conn
            )

        inbox, ledger_count, outbox_count = select_counts()
        if not inbox or inbox.get('processing_status') != 'transaction_verified':
            raise ConfigError('Inbox status did not commit with successful handoff')
        if ledger_count != 1 or outbox_count != 1:
            raise ConfigError('Linked ready Outbox and Ledger did not commit together')

        with db_transaction(config, logger, f'selftest-fence:{email_event_id}') as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id
                    FROM rhythmjoy_booking_ledger
                    WHERE ledger_key=%s
                    FOR UPDATE
                    """,
                    (ledger_key,),
                )
                ledger = cursor.fetchone()
                if not ledger:
                    raise ConfigError('Self-test ledger disappeared before cancellation fence')
                cursor.execute(
                    """
                    UPDATE rhythmjoy_booking_ledger
                    SET current_status='canceled', canceled_email_event_id=%s, updated_at=NOW()
                    WHERE id=%s
                    """,
                    (email_event_id, ledger['id']),
                )
                fenced_count = fence_canceled_spacecloud_uploads(
                    cursor,
                    ledger['id'],
                    email_event_id,
                )
                if fenced_count != 1:
                    raise ConfigError(
                        f'Expected one ready upload to be fenced, got {fenced_count}'
                    )
                cursor.execute(
                    """
                    SELECT side_effect_state, status, claim_token,
                           confirmation_sms_required, processed_at, result_text
                    FROM rhythmjoy_spacecloud_tasks
                    WHERE dedupe_key=%s
                    """,
                    (dedupe_key,),
                )
                fenced_task = cursor.fetchone()
                if not fenced_task or fenced_task.get('side_effect_state') != 'skipped':
                    raise ConfigError('Cancellation fence did not persist skipped state')
                if (
                        fenced_task.get('status') != 'done'
                        or fenced_task.get('claim_token')
                        or fenced_task.get('confirmation_sms_required') != 0
                        or not fenced_task.get('processed_at')
                ):
                    raise ConfigError('Cancellation fence did not close task and SMS obligation')
                fenced_result = load_event_payload({'parsed_json': fenced_task.get('result_text')})
                if (
                        fenced_result.get('submissionAttempted') is not False
                        or fenced_result.get('mirrorMutationState') != 'not_created'
                ):
                    raise ConfigError('Cancellation fence did not persist never-submitted proof')

        with db_transaction(config, logger, f'selftest-event-order:{email_event_id}') as conn:
            ordered_events = (
                (upsert_booking_ledger_confirmed, email_event_id, ordering_event_order_base, 'same-second-confirm'),
                (upsert_booking_ledger_canceled, email_event_id + 1, ordering_event_order_base + 200, 'same-second-cancel'),
                (upsert_booking_ledger_confirmed, email_event_id + 2, ordering_event_order_base + 700, 'same-second-reconfirm'),
            )
            for upsert, ordered_event_id, ordered_event_key, marker in ordered_events:
                upsert(
                    config,
                    logger,
                    ordered_event_id,
                    ordering_event(marker),
                    'a',
                    ordering_event_at,
                    'naver',
                    conn=conn,
                    event_order_key=ordered_event_key,
                )
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT current_status, product, last_event_at, last_event_id,
                           last_event_order_key, automation_canceled_at,
                           automation_canceled_order_key
                    FROM rhythmjoy_booking_ledger
                    WHERE ledger_key=%s
                    FOR UPDATE
                    """,
                    (ordering_ledger_key,),
                )
                ordered_row = cursor.fetchone()
            if (
                    not ordered_row
                    or ordered_row.get('current_status') != 'confirmed'
                    or ordered_row.get('product') != 'same-second-reconfirm'
                    or str(ordered_row.get('last_event_at')) != ordering_event_at
                    or int(ordered_row.get('last_event_id') or 0) != email_event_id + 2
                    or int(ordered_row.get('last_event_order_key') or 0) != ordering_event_order_base + 700
            ):
                raise ConfigError(
                    f'Same-second confirm/cancel/reconfirm did not converge: {ordered_row}'
                )

            for upsert, ordered_event_id, ordered_event_key, marker in reversed(ordered_events):
                upsert(
                    config,
                    logger,
                    ordered_event_id,
                    ordering_event(f'replay-{marker}'),
                    'a',
                    ordering_event_at,
                    'naver',
                    conn=conn,
                    event_order_key=ordered_event_key,
                )
            replayed_row = db_select_booking_ledger(
                config,
                ordering_ledger_key,
                conn=conn,
            )
            if (
                    not replayed_row
                    or replayed_row.get('current_status') != 'confirmed'
                    or replayed_row.get('product') != 'same-second-reconfirm'
                    or int(replayed_row.get('last_event_id') or 0) != email_event_id + 2
                    or int(replayed_row.get('last_event_order_key') or 0) != ordering_event_order_base + 700
            ):
                raise ConfigError(f'Reverse replay changed terminal booking state: {replayed_row}')

            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE rhythmjoy_booking_ledger
                    SET current_status='canceled',
                        automation_canceled_at=%s,
                        automation_cancel_platform='transaction_selftest',
                        updated_at=NOW()
                    WHERE ledger_key=%s
                    """,
                    (ordering_event_at, ordering_ledger_key),
                )
            upsert_booking_ledger_confirmed(
                config,
                logger,
                email_event_id + 3,
                ordering_event('same-second-after-automation-cancel'),
                'a',
                ordering_event_at,
                'naver',
                conn=conn,
                event_order_key=ordering_event_order_base + 900,
            )
            automation_row = db_select_booking_ledger(
                config,
                ordering_ledger_key,
                conn=conn,
            )
            if (
                    not automation_row
                    or automation_row.get('current_status') != 'canceled'
                    or int(automation_row.get('last_event_id') or 0) != email_event_id + 2
                    or not automation_row.get('automation_canceled_at')
            ):
                raise ConfigError(
                    f'Same-second email overrode automation cancellation: {automation_row}'
                )

            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE rhythmjoy_booking_ledger
                    SET automation_canceled_order_key=%s,
                        updated_at=NOW()
                    WHERE ledger_key=%s
                    """,
                    (ordering_event_order_base + 800, ordering_ledger_key),
                )
            upsert_booking_ledger_confirmed(
                config,
                logger,
                email_event_id + 3,
                ordering_event('source-ms-after-automation-cancel'),
                'a',
                ordering_event_at,
                'naver',
                conn=conn,
                event_order_key=ordering_event_order_base + 900,
            )
            source_ordered_automation_row = db_select_booking_ledger(
                config,
                ordering_ledger_key,
                conn=conn,
            )
            if (
                    not source_ordered_automation_row
                    or source_ordered_automation_row.get('current_status') != 'confirmed'
                    or int(source_ordered_automation_row.get('last_event_id') or 0) != email_event_id + 3
                    or int(source_ordered_automation_row.get('last_event_order_key') or 0) != ordering_event_order_base + 900
                    or source_ordered_automation_row.get('automation_canceled_at') is not None
                    or source_ordered_automation_row.get('automation_canceled_order_key') is not None
            ):
                raise ConfigError(
                    'Source-ms event newer than same-second automation cancellation did not recover: '
                    f'{source_ordered_automation_row}'
                )

        logger.info(
            'Transactional linked Outbox, cancellation fence, and same-second event ordering verification succeeded'
        )
        return True
    finally:
        cleanup_conn = db_connect(config, autocommit=False)
        if cleanup_conn is not None:
            try:
                cleanup_conn.begin()
                with cleanup_conn.cursor() as cursor:
                    cursor.execute(
                        'DELETE FROM rhythmjoy_spacecloud_tasks WHERE dedupe_key=%s',
                        (dedupe_key,),
                    )
                    cursor.execute(
                        'DELETE FROM rhythmjoy_booking_ledger WHERE ledger_key IN (%s, %s)',
                        (ledger_key, ordering_ledger_key),
                    )
                    cursor.execute(
                        'DELETE FROM rhythmjoy_naver_email_events WHERE mail_key=%s',
                        (mail_key,),
                    )
                cleanup_conn.commit()
            except Exception:
                cleanup_conn.rollback()
                raise
            finally:
                cleanup_conn.close()


def run_poll_once(config, logger):
    processed = 0
    imap_connection = None
    try:
        imap_connection = imaplib.IMAP4_SSL(config['imap_server'], config['imap_port'])
        imap_connection.login(config['naver_mail_username'], config['naver_mail_password'])

        collected_messages = []
        for mailbox, target_calendar in configured_mailboxes(config).items():
            logger.info("Checking mailbox '%s'", mailbox)
            status, _ = imap_connection.select(mailbox)
            if status != 'OK':
                logger.error("Could not select mailbox '%s': %s", mailbox, status)
                continue

            status, email_data = imap_connection.search(None, 'UNSEEN')
            if status != 'OK' or not email_data or email_data[0] == b'':
                logger.info("Mailbox '%s' has no unseen email", mailbox)
                continue

            for email_id in email_data[0].split():
                # BODY.PEEK[] keeps the source email unread until the DB handoff commits.
                result, message_data = imap_connection.fetch(email_id, IMAP_FETCH_QUERY)
                fetch_metadata, raw_message = extract_fetch_payload(message_data or [])
                if result != 'OK' or not raw_message:
                    logger.error('Failed to fetch mailbox=%s email_id=%s result=%s', mailbox, email_id, result)
                    continue
                collected_messages.append(
                    (mailbox, target_calendar, email_id, fetch_metadata, raw_message)
                )

        collected_messages.sort(
            key=lambda item: collected_message_sort_key(
                item[0], item[2], item[3], item[4]
            )
        )
        for mailbox, target_calendar, email_id, fetch_metadata, raw_message in collected_messages:
            # IMAP sequence numbers are mailbox-local. Re-select the source
            # mailbox before process_message eventually marks this message seen.
            status, _ = imap_connection.select(mailbox)
            if status != 'OK':
                logger.error("Could not re-select mailbox '%s' for ordered processing: %s", mailbox, status)
                continue
            process_message(
                config,
                None,
                imap_connection,
                mailbox,
                target_calendar,
                email_id,
                raw_message,
                fetch_metadata,
                logger,
            )
            processed += 1
    finally:
        if imap_connection is not None:
            try:
                imap_connection.logout()
            except Exception:
                logger.exception('Failed to logout from IMAP')
    return processed


def send_alert(config, subject, body, logger):
    if not config['alert_to']:
        return
    try:
        message = MIMEMultipart()
        message['From'] = config['alert_from']
        message['To'] = config['alert_to']
        message['Subject'] = subject
        message.attach(MIMEText(body, 'plain'))
        with smtplib.SMTP(config['smtp_server'], config['smtp_port'], timeout=config['smtp_timeout']) as smtp:
            smtp.starttls()
            smtp.login(config['smtp_username'], config['smtp_password'])
            smtp.sendmail(config['alert_from'], [config['alert_to']], message.as_string())
    except Exception:
        logger.exception('Failed to send alert email')


def build_config():
    load_env_file(ENV_FILE)
    naver_mail_username = get_required_env('NAVER_MAIL_USERNAME')
    naver_mail_password = get_required_env('NAVER_MAIL_PASSWORD')
    db_server = os.environ.get('DB_SERVERNAME', '')
    db_username = os.environ.get('DB_USERNAME', '')
    db_password = os.environ.get('DB_PASSWORD', '')
    db_name = os.environ.get('DB_NAME', '')
    db_enabled = all([db_server, db_username, db_password, db_name])

    return {
        'naver_mail_username': naver_mail_username,
        'naver_mail_password': naver_mail_password,
        'imap_server': os.environ.get('NAVER_IMAP_SERVER', 'imap.naver.com'),
        'imap_port': int(os.environ.get('NAVER_IMAP_PORT', '993')),
        'poll_interval': int(os.environ.get('RHYTHMJOY_EMAIL_POLL_INTERVAL_SECONDS', '30')),
        'smtp_server': os.environ.get('NAVER_SMTP_SERVER', 'smtp.naver.com'),
        'smtp_port': int(os.environ.get('NAVER_SMTP_PORT', '587')),
        'smtp_username': os.environ.get('NAVER_SMTP_USERNAME', naver_mail_username),
        'smtp_password': os.environ.get('NAVER_SMTP_PASSWORD', naver_mail_password),
        'smtp_timeout': int(os.environ.get('RHYTHMJOY_EMAIL_SMTP_TIMEOUT_SECONDS', '20')),
        'alert_from': os.environ.get('RHYTHMJOY_EMAIL_ALERT_FROM', f'{naver_mail_username}@naver.com'),
        'alert_to': os.environ.get('RHYTHMJOY_EMAIL_ALERT_TO', ''),
        'telegram_bot_token': os.environ.get('TELEGRAM_BOT_TOKEN', ''),
        'telegram_chat_id': os.environ.get('TELEGRAM_CHAT_ID', ''),
        'telegram_timeout': int(os.environ.get('TELEGRAM_SEND_TIMEOUT', '12')),
        'telegram_notify_intake_success': os.environ.get('TELEGRAM_NOTIFY_INTAKE_SUCCESS', '0') == '1',
        'db_enabled': db_enabled,
        'db_required': env_flag('RHYTHMJOY_EMAIL_DB_REQUIRED', '1'),
        'db_server': db_server,
        'db_port': int(os.environ.get('DB_PORT', '3306')),
        'db_username': db_username,
        'db_password': db_password,
        'db_name': db_name,
        'store_raw_email_body': env_flag('RHYTHMJOY_EMAIL_STORE_RAW_BODY', '1'),
        'naver_spacecloud_upload_enabled': env_flag('RHYTHMJOY_NAVER_SPACECLOUD_UPLOAD_ENABLED', '0'),
        'spacecloud_email_enabled': env_flag('RHYTHMJOY_SPACECLOUD_EMAIL_ENABLED', '0'),
        'spacecloud_naver_block_enabled': env_flag('RHYTHMJOY_SPACECLOUD_NAVER_BLOCK_ENABLED', '0'),
        'confirmation_sms_enabled': env_flag('RHYTHMJOY_CONFIRMATION_SMS_ENABLED', '1'),
    }


def check_config(config, logger):
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    if not os.access(str(LOG_DIR), os.W_OK):
        raise ConfigError(f'Email log directory is not writable: {LOG_DIR}')
    ensure_db_tables(config, logger)


def main():
    parser = argparse.ArgumentParser(description='Import Rhythmjoy booking email into the DB ledger and platform sync queue.')
    parser.add_argument('--once', action='store_true', help='run one polling cycle and exit')
    parser.add_argument('--check-config', action='store_true', help='validate config and exit')
    parser.add_argument('--backfill-ledger', action='store_true', help='non-destructively upsert booking ledger rows from stored parsed email events and exit')
    parser.add_argument('--event-order-selftest', action='store_true', help='verify same-second booking email total ordering without a database')
    parser.add_argument('--transaction-selftest', action='store_true', help='fault-inject and verify Inbox/Outbox transaction rollback and commit')
    args = parser.parse_args()

    if args.event_order_selftest:
        verify_booking_event_total_order()
        return

    logger = setup_logging()
    config = build_config()
    check_config(config, logger)

    restart_count = increment_restart_count()
    logger.info('Rhythmjoy email import started restart_count=%s interval=%s', restart_count, config['poll_interval'])

    if args.check_config:
        logger.info('Configuration check succeeded')
        return

    if args.backfill_ledger:
        processed = backfill_booking_ledger(config, logger)
        logger.info('Booking ledger backfill command finished processed=%s', processed)
        return

    if args.transaction_selftest:
        verify_transactional_inbox_outbox(config, logger)
        return

    while True:
        try:
            processed = run_poll_once(config, logger)
            logger.info('Email polling cycle finished processed=%s', processed)
        except Exception as error:
            logger.exception('Email polling cycle failed')
            send_telegram_message(
                config,
                '⚠️ 이메일 예약 수집 실패\n'
                f'{type(error).__name__}: {str(error)[:300]}\n'
                '원본 메일은 읽음 처리하지 않고 다음 주기에 재시도합니다.',
                logger,
            )
            send_alert(config, 'Rhythmjoy email import error', str(error), logger)

        if args.once:
            return
        time.sleep(config['poll_interval'])


if __name__ == '__main__':
    main()
