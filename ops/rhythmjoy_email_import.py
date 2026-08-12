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
        return normalize_date(value)
    except Exception:
        return None


def clean_time_or_none(value):
    if not value:
        return None
    if re.match(r'^\d{1,2}:\d{2}$', value):
        return f'{normalize_time_text(value)}:00'
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
        received_at = get_email_received_at(message, fetch_metadata) or '9999-12-31 23:59:59'
    except Exception:
        received_at = '9999-12-31 23:59:59'
    try:
        sequence = int(email_id)
    except (TypeError, ValueError):
        sequence = 0
    return received_at, sequence


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


def ensure_db_tables(config, logger):
    if not config['db_enabled']:
        if config['db_required']:
            raise ConfigError('Email DB logging is required but DB_* env values are incomplete')
        logger.info('Email DB logging disabled: DB_* env values incomplete')
        return

    conn = None
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
                    processed_at DATETIME NULL,
                    result_text TEXT NULL,
                    created_at DATETIME NULL,
                    updated_at DATETIME NULL,
                    PRIMARY KEY (id),
                    UNIQUE KEY uq_dedupe_key (dedupe_key),
                    KEY idx_status_type (status, task_type),
                    KEY idx_room_date (room_key, reservation_date)
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
                    last_event_at DATETIME NULL,
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
            ensure_db_column(cursor, 'rhythmjoy_booking_ledger', 'reserver_name_key', "VARCHAR(128) NOT NULL DEFAULT '' AFTER reserver_name")
            ensure_db_column(cursor, 'rhythmjoy_booking_ledger', 'gross_amount', 'INT UNSIGNED NULL AFTER price')
            ensure_db_column(cursor, 'rhythmjoy_booking_ledger', 'fee_amount', 'INT UNSIGNED NULL AFTER gross_amount')
            ensure_db_column(cursor, 'rhythmjoy_booking_ledger', 'net_amount', 'INT UNSIGNED NULL AFTER fee_amount')
            ensure_db_column(cursor, 'rhythmjoy_booking_ledger', 'amount_source', "VARCHAR(64) NOT NULL DEFAULT '' AFTER net_amount")
            ensure_db_column(cursor, 'rhythmjoy_booking_ledger', 'payment_method', "VARCHAR(64) NOT NULL DEFAULT '' AFTER amount_source")
            ensure_db_column(cursor, 'rhythmjoy_booking_ledger', 'automation_canceled_at', 'DATETIME NULL AFTER canceled_email_received_at')
            ensure_db_column(cursor, 'rhythmjoy_booking_ledger', 'automation_cancel_task_id', 'BIGINT UNSIGNED NULL AFTER automation_canceled_at')
            ensure_db_column(cursor, 'rhythmjoy_booking_ledger', 'automation_cancel_platform', "VARCHAR(32) NOT NULL DEFAULT '' AFTER automation_cancel_task_id")
            ensure_db_column(cursor, 'rhythmjoy_spacecloud_tasks', 'claim_token', "VARCHAR(64) NOT NULL DEFAULT '' AFTER locked_at")
        logger.info('Email DB tables checked')
    except Exception as error:
        disable_db_logging(config, logger, 'Email DB table check failed', error)
    finally:
        if conn is not None:
            conn.close()


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


def upsert_email_event(config, logger, record, conn=None):
    if not config['db_enabled']:
        return None

    owned_conn = conn is None
    try:
        if owned_conn:
            conn = db_connect(config)
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO rhythmjoy_naver_email_events (
                    mail_key, mailbox, imap_id, message_id, email_received_at, subject,
                    event_type, parse_status, processing_status,
                    target_calendar, spacecloud_room_key,
                    reservation_number, reserver_name, product,
                    reservation_date, start_time, end_time,
                    payment_status, price, raw_body, parsed_json,
                    created_at, updated_at
                )
                VALUES (
                    %(mail_key)s, %(mailbox)s, %(imap_id)s, %(message_id)s, %(email_received_at)s, %(subject)s,
                    %(event_type)s, %(parse_status)s, %(processing_status)s,
                    %(target_calendar)s, %(spacecloud_room_key)s,
                    %(reservation_number)s, %(reserver_name)s, %(product)s,
                    %(reservation_date)s, %(start_time)s, %(end_time)s,
                    %(payment_status)s, %(price)s, %(raw_body)s, %(parsed_json)s,
                    NOW(), NOW()
                )
                ON DUPLICATE KEY UPDATE
                    email_received_at=VALUES(email_received_at),
                    subject=VALUES(subject),
                    event_type=VALUES(event_type),
                    parse_status=VALUES(parse_status),
                    target_calendar=VALUES(target_calendar),
                    spacecloud_room_key=VALUES(spacecloud_room_key),
                    reservation_number=VALUES(reservation_number),
                    reserver_name=VALUES(reserver_name),
                    product=VALUES(product),
                    reservation_date=VALUES(reservation_date),
                    start_time=VALUES(start_time),
                    end_time=VALUES(end_time),
                    payment_status=VALUES(payment_status),
                    price=VALUES(price),
                    raw_body=VALUES(raw_body),
                    parsed_json=VALUES(parsed_json),
                    updated_at=NOW()
                """,
                record,
            )
        row = db_select_email_event(config, record['mail_key'], conn=conn)
        logger.info('Email DB event saved id=%s type=%s status=%s', row.get('id') if row else '-', record['event_type'], record['processing_status'])
        return row
    except Exception as error:
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


def booking_ledger_row(source_platform, event_data, calendar_key, email_event_id, email_received_at):
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


def upsert_booking_ledger_confirmed(config, logger, email_event_id, event_data, calendar_key, email_received_at, source_platform, conn=None):
    if not config['db_enabled'] or not event_data:
        return None

    row = booking_ledger_row(source_platform, event_data, calendar_key, email_event_id, email_received_at)
    owned_conn = conn is None
    try:
        if owned_conn:
            conn = db_connect(config)
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO rhythmjoy_booking_ledger (
                    ledger_key, source_platform, source_mode, current_status,
                    target_calendar, room_key, reservation_number, reserver_name, reserver_name_key, product,
                    reservation_date, start_time, end_time,
                    payment_status, price,
                    gross_amount, fee_amount, net_amount, amount_source, payment_method,
                    confirmed_email_event_id, confirmed_email_received_at, last_event_at,
                    payload_json, created_at, updated_at
                )
                VALUES (
                    %(ledger_key)s, %(source_platform)s, %(source_mode)s, 'confirmed',
                    %(target_calendar)s, %(room_key)s, %(reservation_number)s, %(reserver_name)s, %(reserver_name_key)s, %(product)s,
                    %(reservation_date)s, %(start_time)s, %(end_time)s,
                    %(payment_status)s, %(price)s,
                    %(gross_amount)s, %(fee_amount)s, %(net_amount)s, %(amount_source)s, %(payment_method)s,
                    %(email_event_id)s, %(event_at)s, %(event_at)s,
                    %(payload_json)s, NOW(), NOW()
                )
                ON DUPLICATE KEY UPDATE
                    source_mode=IF(
                        VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00')
                        AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'),
                        IF(VALUES(source_mode) <> '', VALUES(source_mode), source_mode),
                        source_mode
                    ),
                    current_status=IF(
                        VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00')
                        AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'),
                        'confirmed',
                        current_status
                    ),
                    target_calendar=IF(VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00') AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'), VALUES(target_calendar), target_calendar),
                    room_key=IF(VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00') AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'), VALUES(room_key), room_key),
                    reservation_number=IF(VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00') AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'), VALUES(reservation_number), reservation_number),
                    reserver_name=IF(VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00') AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'), VALUES(reserver_name), reserver_name),
                    reserver_name_key=IF(VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00') AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'), VALUES(reserver_name_key), reserver_name_key),
                    product=IF(VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00') AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'), VALUES(product), product),
                    reservation_date=IF(VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00') AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'), VALUES(reservation_date), reservation_date),
                    start_time=IF(VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00') AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'), VALUES(start_time), start_time),
                    end_time=IF(VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00') AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'), VALUES(end_time), end_time),
                    payment_status=IF(VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00') AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'), IF(VALUES(payment_status) <> '', VALUES(payment_status), payment_status), payment_status),
                    price=IF(VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00') AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'), IF(amount_source LIKE '%%platform-export', price, IF(VALUES(price) <> '', VALUES(price), price)), price),
                    gross_amount=IF(VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00') AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'), IF(amount_source LIKE '%%platform-export', gross_amount, COALESCE(VALUES(gross_amount), gross_amount)), gross_amount),
                    fee_amount=IF(VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00') AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'), IF(amount_source LIKE '%%platform-export', fee_amount, COALESCE(VALUES(fee_amount), fee_amount)), fee_amount),
                    net_amount=IF(VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00') AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'), IF(amount_source LIKE '%%platform-export', net_amount, COALESCE(VALUES(net_amount), net_amount)), net_amount),
                    amount_source=IF(VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00') AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'), IF(amount_source LIKE '%%platform-export', amount_source, IF(VALUES(amount_source) <> '', VALUES(amount_source), amount_source)), amount_source),
                    payment_method=IF(VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00') AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'), IF(amount_source LIKE '%%platform-export', payment_method, IF(VALUES(payment_method) <> '', VALUES(payment_method), payment_method)), payment_method),
                    confirmed_email_event_id=IF(
                        VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00')
                        AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'),
                        VALUES(confirmed_email_event_id),
                        confirmed_email_event_id
                    ),
                    confirmed_email_received_at=IF(
                        VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00')
                        AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'),
                        VALUES(confirmed_email_received_at),
                        confirmed_email_received_at
                    ),
                    payload_json=IF(VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00') AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'), IF(amount_source LIKE '%%platform-export', payload_json, VALUES(payload_json)), payload_json),
                    automation_cancel_task_id=IF(
                        VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00')
                        AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'),
                        NULL,
                        automation_cancel_task_id
                    ),
                    automation_cancel_platform=IF(
                        VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00')
                        AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'),
                        '',
                        automation_cancel_platform
                    ),
                    automation_canceled_at=IF(
                        VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00')
                        AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'),
                        NULL,
                        automation_canceled_at
                    ),
                    updated_at=IF(VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00') AND VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at, '1000-01-01 00:00:00'), NOW(), updated_at),
                    last_event_at=IF(
                        VALUES(confirmed_email_received_at) > COALESCE(last_event_at, '1000-01-01 00:00:00'),
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


def upsert_booking_ledger_canceled(config, logger, email_event_id, event_data, calendar_key, email_received_at, source_platform, conn=None):
    if not config['db_enabled'] or not event_data:
        return None

    row = booking_ledger_row(source_platform, event_data, calendar_key, email_event_id, email_received_at)
    owned_conn = conn is None
    try:
        if owned_conn:
            conn = db_connect(config)
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO rhythmjoy_booking_ledger (
                    ledger_key, source_platform, source_mode, current_status,
                    target_calendar, room_key, reservation_number, reserver_name, reserver_name_key, product,
                    reservation_date, start_time, end_time,
                    payment_status, price,
                    gross_amount, fee_amount, net_amount, amount_source, payment_method,
                    canceled_email_event_id, canceled_email_received_at, last_event_at,
                    cancel_payload_json, created_at, updated_at
                )
                VALUES (
                    %(ledger_key)s, %(source_platform)s, %(source_mode)s, 'canceled',
                    %(target_calendar)s, %(room_key)s, %(reservation_number)s, %(reserver_name)s, %(reserver_name_key)s, %(product)s,
                    %(reservation_date)s, %(start_time)s, %(end_time)s,
                    %(payment_status)s, %(price)s,
                    %(gross_amount)s, %(fee_amount)s, %(net_amount)s, %(amount_source)s, %(payment_method)s,
                    %(email_event_id)s, %(event_at)s, %(event_at)s,
                    %(payload_json)s, NOW(), NOW()
                )
                ON DUPLICATE KEY UPDATE
                    source_mode=IF(VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), IF(VALUES(source_mode) <> '', VALUES(source_mode), source_mode), source_mode),
                    current_status=IF(VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), 'canceled', current_status),
                    target_calendar=IF(VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), VALUES(target_calendar), target_calendar),
                    room_key=IF(VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), VALUES(room_key), room_key),
                    reservation_number=IF(VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), IF(VALUES(reservation_number) <> '', VALUES(reservation_number), reservation_number), reservation_number),
                    reserver_name=IF(VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), VALUES(reserver_name), reserver_name),
                    reserver_name_key=IF(VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), VALUES(reserver_name_key), reserver_name_key),
                    product=IF(VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), VALUES(product), product),
                    reservation_date=IF(VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), VALUES(reservation_date), reservation_date),
                    start_time=IF(VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), VALUES(start_time), start_time),
                    end_time=IF(VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), VALUES(end_time), end_time),
                    payment_status=IF(VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), IF(VALUES(payment_status) <> '', VALUES(payment_status), payment_status), payment_status),
                    price=IF(VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), IF(amount_source LIKE '%%platform-export', price, IF(VALUES(price) <> '', VALUES(price), price)), price),
                    gross_amount=IF(VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), IF(amount_source LIKE '%%platform-export', gross_amount, COALESCE(VALUES(gross_amount), gross_amount)), gross_amount),
                    fee_amount=IF(VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), IF(amount_source LIKE '%%platform-export', fee_amount, COALESCE(VALUES(fee_amount), fee_amount)), fee_amount),
                    net_amount=IF(VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), IF(amount_source LIKE '%%platform-export', net_amount, COALESCE(VALUES(net_amount), net_amount)), net_amount),
                    amount_source=IF(VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), IF(amount_source LIKE '%%platform-export', amount_source, IF(VALUES(amount_source) <> '', VALUES(amount_source), amount_source)), amount_source),
                    payment_method=IF(VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), IF(amount_source LIKE '%%platform-export', payment_method, IF(VALUES(payment_method) <> '', VALUES(payment_method), payment_method)), payment_method),
                    canceled_email_event_id=IF(
                        VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'),
                        VALUES(canceled_email_event_id),
                        canceled_email_event_id
                    ),
                    canceled_email_received_at=IF(
                        VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'),
                        VALUES(canceled_email_received_at),
                        canceled_email_received_at
                    ),
                    cancel_payload_json=IF(VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), VALUES(cancel_payload_json), cancel_payload_json),
                    updated_at=IF(VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), NOW(), updated_at),
                    last_event_at=IF(VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), VALUES(canceled_email_received_at), last_event_at)
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
                        SET current_status=IF(%s >= COALESCE(last_event_at, '1000-01-01 00:00:00'), 'canceled', current_status),
                            canceled_email_event_id=IF(%s >= COALESCE(last_event_at, '1000-01-01 00:00:00'), %s, canceled_email_event_id),
                            canceled_email_received_at=IF(%s >= COALESCE(last_event_at, '1000-01-01 00:00:00'), %s, canceled_email_received_at),
                            last_event_at=IF(%s >= COALESCE(last_event_at, '1000-01-01 00:00:00'), %s, last_event_at),
                            cancel_payload_json=IF(%s >= COALESCE(last_event_at, '1000-01-01 00:00:00'), %s, cancel_payload_json),
                            updated_at=NOW()
                        WHERE id IN ({','.join(['%s'] * len(matched_ids))})
                          AND source_platform <> 'naver'
                        """,
                        [
                            row['event_at'],
                            row['event_at'],
                            email_event_id,
                            row['event_at'],
                            row['event_at'],
                            row['event_at'],
                            row['event_at'],
                            row['event_at'],
                            row['payload_json'],
                            *matched_ids,
                        ],
                    )
                    logger.info('SpaceCloud cancellation marked matched ledger rows canceled ids=%s', matched_ids)

                cursor.execute(
                    """
                    UPDATE rhythmjoy_booking_ledger
                    SET current_status='canceled',
                        canceled_email_event_id=%s,
                        canceled_email_received_at=%s,
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
                      AND %s >= COALESCE(last_event_at, '1000-01-01 00:00:00')
                    """,
                    (
                        email_event_id,
                        row['event_at'],
                        row['event_at'],
                        row['payload_json'],
                        row['target_calendar'],
                        row['room_key'],
                        row['reservation_date'],
                        row['start_time'],
                        row['end_time'],
                        row['reserver_name_key'],
                        row['event_at'],
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
                        last_event_at=%s,
                        cancel_payload_json=%s,
                        updated_at=NOW()
                    WHERE current_status='confirmed'
                      AND source_platform IN ('naver', 'google-backfill')
                      AND reservation_number=%s
                      AND %s >= COALESCE(last_event_at, '1000-01-01 00:00:00')
                    """,
                    (
                        email_event_id,
                        row['event_at'],
                        row['event_at'],
                        row['payload_json'],
                        row['reservation_number'],
                        row['event_at'],
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


def spacecloud_delete_dedupe_key(deletion, room_key):
    reservation_number = deletion.get('reservation_number') or ''
    if reservation_number:
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


def spacecloud_upload_dedupe_key(event_data, room_key):
    reservation_number = event_data.get('reservation_number') or ''
    if reservation_number:
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


def upsert_spacecloud_delete_task(config, logger, email_event_id, deletion, calendar_key, conn=None):
    room_key = calendar_to_spacecloud_room_key(calendar_key)
    if not config['db_enabled'] or not room_key:
        if not room_key:
            logger.info('SpaceCloud delete task skipped: no room mapping for calendar=%s product=%s', calendar_key, deletion.get('product'))
        return None

    dedupe_key = spacecloud_delete_dedupe_key(deletion, room_key)
    payload = {
        'source': 'naver-email-cancellation',
        'calendarKey': calendar_key,
        'roomKey': room_key,
        **deletion,
    }
    row = {
        'dedupe_key': dedupe_key,
        'email_event_id': email_event_id,
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
                    status=IF(status IN ('running', 'done', 'already_gone', 'needs_review', 'google_pending'), status, 'pending'),
                    updated_at=NOW()
                """,
                row,
            )
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
                cursor.execute(
                    f"""
                    UPDATE rhythmjoy_spacecloud_tasks
                    SET status='pending', locked_at=NULL, claim_token='',
                        processed_at=NULL, updated_at=NOW()
                    WHERE id IN ({','.join(['%s'] * len(retry_ids))})
                    """,
                    retry_ids,
                )
                logger.info(
                    'Requeued uploads after matching Naver cancellation reservation=%s task_ids=%s',
                    row['reservation_number'],
                    retry_ids,
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


def upsert_spacecloud_upload_task(config, logger, email_event_id, event_data, calendar_key, conn=None):
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

    dedupe_key = spacecloud_upload_dedupe_key(event_data, room_key)
    payload = {
        'source': 'naver-email-reservation',
        'action': 'upload-spacecloud-direct',
        'calendarKey': calendar_key,
        'roomKey': room_key,
        'emailEventId': email_event_id,
        **event_data,
    }
    row = {
        'dedupe_key': dedupe_key,
        'email_event_id': email_event_id,
        'task_type': 'upload',
        'room_key': room_key,
        'reservation_number': event_data.get('reservation_number') or '',
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


def process_message(config, _unused_service_factory, imap_connection, mailbox, target_calendar, email_id, raw_message, fetch_metadata, logger):
    message = email.message_from_bytes(raw_message)
    subject = decode_header_value(message.get('Subject', ''))
    body = get_text_body(message)
    decoded_id = email_id.decode('utf-8', errors='replace')
    mail_key, message_id = message_identity(mailbox, decoded_id, message, raw_message)
    email_received_at = get_email_received_at(message, fetch_metadata)
    email_record_id = None
    logger.info('Processing mailbox=%s email_id=%s received_at=%s subject=%s', mailbox, decoded_id, email_received_at or '-', subject)

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
            email_record_id = email_row.get('id') if email_row else None
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
                if config.get('naver_spacecloud_upload_enabled'):
                    with db_transaction(config, logger, f'naver-upload:{email_record_id}') as conn:
                        lock_inbox_event(config, logger, conn, email_record_id)
                        ledger = upsert_booking_ledger_confirmed(
                            config, logger, email_record_id, event_data,
                            target_calendar, email_received_at, 'naver', conn=conn
                        )
                        require_handoff(True, ledger, 'Required Naver booking ledger handoff was not created')
                        upload_task = upsert_spacecloud_upload_task(
                            config, logger, email_record_id, event_data, target_calendar, conn=conn
                        )
                        require_handoff(True, upload_task, 'Required SpaceCloud upload task was not created')
                        task_status = upload_task.get('status') or 'pending'
                        processing_status = f"spacecloud_upload_{task_status}"
                        if len(processing_status) > 32:
                            processing_status = 'spacecloud_upload_saved'
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
                        target_calendar, email_received_at, 'naver'
                    )
                    update_email_processing(
                        config,
                        email_record_id,
                        'ledger_only',
                        logger,
                        error_text='platform_sync_disabled',
                    )
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
            email_record_id = email_row.get('id') if email_row else None
            if deletion:
                if config.get('naver_spacecloud_upload_enabled'):
                    with db_transaction(config, logger, f'naver-delete:{email_record_id}') as conn:
                        lock_inbox_event(config, logger, conn, email_record_id)
                        ledger = upsert_booking_ledger_canceled(
                            config, logger, email_record_id, deletion,
                            calendar_key, email_received_at, 'naver', conn=conn
                        )
                        require_handoff(True, ledger, 'Required Naver cancellation ledger handoff was not created')
                        spacecloud_task = upsert_spacecloud_delete_task(
                            config, logger, email_record_id, deletion, calendar_key, conn=conn
                        )
                        require_handoff(True, spacecloud_task, 'Required SpaceCloud delete task was not created')
                        task_status = spacecloud_task.get('status') or 'pending'
                        processing_status = f"spacecloud_delete_{task_status}"
                        if len(processing_status) > 32:
                            processing_status = 'spacecloud_delete_saved'
                        update_email_processing(
                            config,
                            email_record_id,
                            processing_status,
                            logger,
                            conn=conn,
                            error_text='platform_delete_after_spacecloud',
                        )
                else:
                    upsert_booking_ledger_canceled(
                        config, logger, email_record_id, deletion,
                        calendar_key, email_received_at, 'naver'
                    )
                    spacecloud_task = None
                    update_email_processing(
                        config,
                        email_record_id,
                        'ledger_only_canceled',
                        logger,
                        error_text='platform_sync_disabled',
                    )
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
                email_record_id = email_row.get('id') if email_row else None
                if event_data and calendar_key:
                    event_data['calendar_key'] = calendar_key
                    event_data['target_calendar'] = calendar_key
                    if config.get('spacecloud_naver_block_enabled'):
                        with db_transaction(config, logger, f'spacecloud-restore:{email_record_id}') as conn:
                            lock_inbox_event(config, logger, conn, email_record_id)
                            ledger = upsert_booking_ledger_canceled(
                                config, logger, email_record_id, event_data,
                                calendar_key, email_received_at, 'spacecloud', conn=conn
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
                            calendar_key, email_received_at, 'spacecloud'
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
            email_record_id = email_row.get('id') if email_row else None
            if event_data and calendar_key:
                event_data['calendar_key'] = calendar_key
                event_data['target_calendar'] = calendar_key
                event_data['conflict_count'] = 0
                if config.get('spacecloud_naver_block_enabled'):
                    with db_transaction(config, logger, f'spacecloud-block:{email_record_id}') as conn:
                        lock_inbox_event(config, logger, conn, email_record_id)
                        ledger = upsert_booking_ledger_confirmed(
                            config, logger, email_record_id, event_data,
                            calendar_key, email_received_at, 'spacecloud', conn=conn
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
                        calendar_key, email_received_at, 'spacecloud'
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
                SELECT id, event_type, email_received_at, subject, target_calendar, parsed_json, raw_body
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
                ORDER BY email_received_at ASC, id ASC
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
            )
            processed += 1
    logger.info('Booking ledger non-destructive backfill finished processed=%s scanned=%s', processed, len(rows))
    return processed


def verify_transactional_inbox_outbox(config, logger):
    """Fault-inject against the configured InnoDB tables without creating runnable work."""
    if not config['db_enabled']:
        raise ConfigError('Transactional Inbox/Outbox verification requires DB configuration')

    suffix = os.urandom(12).hex()
    mail_key = f'tx-selftest:{suffix}'
    ledger_key = f'tx-selftest:{suffix}'
    dedupe_key = f'tx-selftest:{suffix}'
    email_event_id = None

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
                    'SELECT COUNT(*) AS count FROM rhythmjoy_spacecloud_tasks WHERE dedupe_key=%s',
                    (dedupe_key,),
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
                    cursor.execute(
                        """
                        INSERT INTO rhythmjoy_spacecloud_tasks (
                            dedupe_key, email_event_id, task_type, status, created_at, updated_at
                        ) VALUES (%s, %s, 'transaction_selftest', 'selftest', NOW(), NOW())
                        """,
                        (dedupe_key, email_event_id),
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
                cursor.execute(
                    """
                    INSERT INTO rhythmjoy_spacecloud_tasks (
                        dedupe_key, email_event_id, task_type, status, created_at, updated_at
                    ) VALUES (%s, %s, 'transaction_selftest', 'selftest', NOW(), NOW())
                    """,
                    (dedupe_key, email_event_id),
                )
            update_email_processing(
                config, email_event_id, 'transaction_verified', logger, conn=conn
            )

        inbox, ledger_count, outbox_count = select_counts()
        if not inbox or inbox.get('processing_status') != 'transaction_verified':
            raise ConfigError('Inbox status did not commit with successful handoff')
        if ledger_count != 1 or outbox_count != 1:
            raise ConfigError('Ledger and Outbox did not commit together')
        logger.info('Transactional Inbox/Outbox verification succeeded')
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
                        'DELETE FROM rhythmjoy_booking_ledger WHERE ledger_key=%s',
                        (ledger_key,),
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

            unseen_messages = []
            for email_id in email_data[0].split():
                # BODY.PEEK[] keeps the source email unread until the DB handoff commits.
                result, message_data = imap_connection.fetch(email_id, IMAP_FETCH_QUERY)
                fetch_metadata, raw_message = extract_fetch_payload(message_data or [])
                if result != 'OK' or not raw_message:
                    logger.error('Failed to fetch mailbox=%s email_id=%s result=%s', mailbox, email_id, result)
                    continue
                unseen_messages.append((email_id, fetch_metadata, raw_message))

            unseen_messages.sort(
                key=lambda item: unseen_message_sort_key(item[0], item[1], item[2])
            )
            for email_id, fetch_metadata, raw_message in unseen_messages:
                process_message(config, None, imap_connection, mailbox, target_calendar, email_id, raw_message, fetch_metadata, logger)
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
    parser.add_argument('--transaction-selftest', action='store_true', help='fault-inject and verify Inbox/Outbox transaction rollback and commit')
    args = parser.parse_args()

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
