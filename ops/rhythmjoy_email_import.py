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
from datetime import datetime, timedelta, timezone
from email.header import decode_header
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import parsedate_to_datetime
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build


APP_ROOT = Path(os.environ.get('RHYTHMJOY_APP_ROOT', '/home/clown313python/myapp'))
OPS_ROOT = Path(os.environ.get('RHYTHMJOY_OPS_ROOT', '/home/clown313python/rhythmjoy_ops'))
ENV_FILE = Path(os.environ.get('RHYTHMJOY_ENV_FILE', APP_ROOT / '.env'))
LOG_DIR = Path(os.environ.get('RHYTHMJOY_EMAIL_LOG_DIR', APP_ROOT / 'static' / 'email_log'))
LOG_FILE = LOG_DIR / 'email_service.log'
RESTART_COUNT_FILE = LOG_DIR / 'restart_count.txt'
DEFAULT_GOOGLE_SERVICE_ACCOUNT = APP_ROOT / 'static' / 'rhythmjoycalendar-ce0594fe594b.json'
TIME_ZONE = 'Asia/Seoul'
KST = timezone(timedelta(hours=9))

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

CALENDAR_IDS = {
    'Aroom': 'lj8j85q4020jm556rmaa181r00@group.calendar.google.com',
    'Broom': 'amp3i5i4vcv4hbrqu937lufuss@group.calendar.google.com',
    'Ahall': '752f7ab834fd5978e9fc356c0b436e01bd530868ab5e46534c82820086c5a3d3@group.calendar.google.com',
    'Bhall': '22dd1532ca7404714f0c24348825f131f3c559acf6361031fe71e80977e4a817@group.calendar.google.com',
    'Chall': 'b0cfe52771ffe5f8b8bb55b8f7855b6ea640fcb09060fd6708e9b8830428e0c8@group.calendar.google.com',
    'Dhall': '60da4147f8d838daa72ecea4f59c69106faedd48e8d4aea61a9d299d96b3f90e@group.calendar.google.com',
    'Ehall': 'aaf61e2a8c25b5dc6cdebfee3a4b2ba3def3dd1b964a9e5dc71dc91afc2e14d6@group.calendar.google.com',
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


def parse_datetime(date_text, time_text):
    date_value = datetime.strptime(normalize_date(date_text), '%Y-%m-%d')
    hour, minute = normalize_booking_time(time_text)
    if hour == 24 and minute == 0:
        return date_value + timedelta(days=1)
    return date_value.replace(hour=hour, minute=minute)


def mask_name(name):
    clean = name.strip()
    if clean.endswith('님'):
        clean = clean[:-1]
    if len(clean) > 1:
        return clean[0] + '*' * (len(clean) - 1)
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


def build_calendar_service(config):
    credentials = service_account.Credentials.from_service_account_file(
        config['google_service_account_file'],
        scopes=['https://www.googleapis.com/auth/calendar'],
    )
    return build('calendar', 'v3', credentials=credentials, cache_discovery=False)


def db_connect(config):
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
        autocommit=True,
        cursorclass=pymysql.cursors.DictCursor,
    )


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
            ensure_db_column(cursor, 'rhythmjoy_naver_email_events', 'email_received_at', 'DATETIME NULL AFTER message_id')
            ensure_db_column(cursor, 'rhythmjoy_booking_ledger', 'reserver_name_key', "VARCHAR(128) NOT NULL DEFAULT '' AFTER reserver_name")
            ensure_db_column(cursor, 'rhythmjoy_spacecloud_tasks', 'claim_token', "VARCHAR(64) NOT NULL DEFAULT '' AFTER locked_at")
        logger.info('Email DB tables checked')
    except Exception as error:
        disable_db_logging(config, logger, 'Email DB table check failed', error)
    finally:
        if conn is not None:
            conn.close()


def db_select_email_event(config, mail_key):
    if not config['db_enabled']:
        return None
    conn = None
    try:
        conn = db_connect(config)
        with conn.cursor() as cursor:
            cursor.execute(
                'SELECT * FROM rhythmjoy_naver_email_events WHERE mail_key=%s LIMIT 1',
                (mail_key,),
            )
            return cursor.fetchone()
    except Exception as error:
        disable_db_logging(config, logging.getLogger('rhythmjoy_email_import'), 'Email DB select failed', error)
        return None
    finally:
        if conn is not None:
            conn.close()


def upsert_email_event(config, logger, record):
    if not config['db_enabled']:
        return None

    conn = None
    try:
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
        row = db_select_email_event(config, record['mail_key'])
        logger.info('Email DB event saved id=%s type=%s status=%s', row.get('id') if row else '-', record['event_type'], record['processing_status'])
        return row
    except Exception as error:
        disable_db_logging(config, logger, 'Email DB event save failed', error)
        return None
    finally:
        if conn is not None:
            conn.close()


def update_email_processing(config, email_event_id, status, logger, **fields):
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

    conn = None
    try:
        conn = db_connect(config)
        with conn.cursor() as cursor:
            cursor.execute(
                f"UPDATE rhythmjoy_naver_email_events SET {', '.join(assignments)} WHERE id=%s",
                values,
            )
        logger.info('Email DB event updated id=%s status=%s', email_event_id, status)
    except Exception as error:
        disable_db_logging(config, logger, 'Email DB event update failed', error)
    finally:
        if conn is not None:
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
    return {
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


def db_select_booking_ledger(config, ledger_key):
    if not config['db_enabled']:
        return None
    conn = None
    try:
        conn = db_connect(config)
        with conn.cursor() as cursor:
            cursor.execute(
                'SELECT * FROM rhythmjoy_booking_ledger WHERE ledger_key=%s LIMIT 1',
                (ledger_key,),
            )
            return cursor.fetchone()
    except Exception as error:
        disable_db_logging(config, logging.getLogger('rhythmjoy_email_import'), 'Booking ledger select failed', error)
        return None
    finally:
        if conn is not None:
            conn.close()


def upsert_booking_ledger_confirmed(config, logger, email_event_id, event_data, calendar_key, email_received_at, source_platform):
    if not config['db_enabled'] or not event_data:
        return None

    row = booking_ledger_row(source_platform, event_data, calendar_key, email_event_id, email_received_at)
    conn = None
    try:
        conn = db_connect(config)
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO rhythmjoy_booking_ledger (
                    ledger_key, source_platform, source_mode, current_status,
                    target_calendar, room_key, reservation_number, reserver_name, reserver_name_key, product,
                    reservation_date, start_time, end_time,
                    payment_status, price,
                    confirmed_email_event_id, confirmed_email_received_at, last_event_at,
                    payload_json, created_at, updated_at
                )
                VALUES (
                    %(ledger_key)s, %(source_platform)s, %(source_mode)s, 'confirmed',
                    %(target_calendar)s, %(room_key)s, %(reservation_number)s, %(reserver_name)s, %(reserver_name_key)s, %(product)s,
                    %(reservation_date)s, %(start_time)s, %(end_time)s,
                    %(payment_status)s, %(price)s,
                    %(email_event_id)s, %(event_at)s, %(event_at)s,
                    %(payload_json)s, NOW(), NOW()
                )
                ON DUPLICATE KEY UPDATE
                    source_mode=VALUES(source_mode),
                    current_status=IF(VALUES(confirmed_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), 'confirmed', current_status),
                    target_calendar=VALUES(target_calendar),
                    room_key=VALUES(room_key),
                    reservation_number=VALUES(reservation_number),
                    reserver_name=VALUES(reserver_name),
                    reserver_name_key=VALUES(reserver_name_key),
                    product=VALUES(product),
                    reservation_date=VALUES(reservation_date),
                    start_time=VALUES(start_time),
                    end_time=VALUES(end_time),
                    payment_status=VALUES(payment_status),
                    price=VALUES(price),
                    confirmed_email_event_id=VALUES(confirmed_email_event_id),
                    confirmed_email_received_at=VALUES(confirmed_email_received_at),
                    last_event_at=IF(VALUES(confirmed_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), VALUES(confirmed_email_received_at), last_event_at),
                    payload_json=VALUES(payload_json),
                    updated_at=NOW()
                """,
                row,
            )
        ledger = db_select_booking_ledger(config, row['ledger_key'])
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
        disable_db_logging(config, logger, 'Booking ledger confirmed upsert failed', error)
        return None
    finally:
        if conn is not None:
            conn.close()


def upsert_booking_ledger_canceled(config, logger, email_event_id, event_data, calendar_key, email_received_at, source_platform):
    if not config['db_enabled'] or not event_data:
        return None

    row = booking_ledger_row(source_platform, event_data, calendar_key, email_event_id, email_received_at)
    conn = None
    try:
        conn = db_connect(config)
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO rhythmjoy_booking_ledger (
                    ledger_key, source_platform, source_mode, current_status,
                    target_calendar, room_key, reservation_number, reserver_name, reserver_name_key, product,
                    reservation_date, start_time, end_time,
                    payment_status, price,
                    canceled_email_event_id, canceled_email_received_at, last_event_at,
                    cancel_payload_json, created_at, updated_at
                )
                VALUES (
                    %(ledger_key)s, %(source_platform)s, %(source_mode)s, 'canceled',
                    %(target_calendar)s, %(room_key)s, %(reservation_number)s, %(reserver_name)s, %(reserver_name_key)s, %(product)s,
                    %(reservation_date)s, %(start_time)s, %(end_time)s,
                    %(payment_status)s, %(price)s,
                    %(email_event_id)s, %(event_at)s, %(event_at)s,
                    %(payload_json)s, NOW(), NOW()
                )
                ON DUPLICATE KEY UPDATE
                    source_mode=VALUES(source_mode),
                    current_status=IF(VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), 'canceled', current_status),
                    target_calendar=VALUES(target_calendar),
                    room_key=VALUES(room_key),
                    reservation_number=IF(VALUES(reservation_number) <> '', VALUES(reservation_number), reservation_number),
                    reserver_name=VALUES(reserver_name),
                    reserver_name_key=VALUES(reserver_name_key),
                    product=VALUES(product),
                    reservation_date=VALUES(reservation_date),
                    start_time=VALUES(start_time),
                    end_time=VALUES(end_time),
                    payment_status=VALUES(payment_status),
                    price=IF(VALUES(price) <> '', VALUES(price), price),
                    canceled_email_event_id=VALUES(canceled_email_event_id),
                    canceled_email_received_at=VALUES(canceled_email_received_at),
                    last_event_at=IF(VALUES(canceled_email_received_at) >= COALESCE(last_event_at, '1000-01-01 00:00:00'), VALUES(canceled_email_received_at), last_event_at),
                    cancel_payload_json=VALUES(cancel_payload_json),
                    updated_at=NOW()
                """,
                row,
            )
        ledger = db_select_booking_ledger(config, row['ledger_key'])
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
        disable_db_logging(config, logger, 'Booking ledger canceled upsert failed', error)
        return None
    finally:
        if conn is not None:
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


def spacecloud_naver_block_dedupe_key(event_data, room_key):
    raw_key = '|'.join([
        'naver_block',
        room_key or '',
        normalize_date(event_data.get('date', '')) if event_data.get('date') else '',
        event_data.get('start_time', ''),
        event_data.get('end_time', ''),
        normalize_reserver_name_for_match(event_data.get('name')),
    ])
    digest = hashlib.sha256(raw_key.encode('utf-8')).hexdigest()
    return f'naver_block|{digest}'


def spacecloud_naver_restore_dedupe_key(event_data, room_key):
    raw_key = '|'.join([
        'naver_restore',
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


def upsert_spacecloud_delete_task(config, logger, email_event_id, deletion, calendar_key):
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

    conn = None
    try:
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
                    status=IF(status IN ('done', 'already_gone', 'needs_review', 'google_pending'), status, 'pending'),
                    updated_at=NOW()
                """,
                row,
            )
            cursor.execute(
                'SELECT * FROM rhythmjoy_spacecloud_tasks WHERE dedupe_key=%s LIMIT 1',
                (dedupe_key,),
            )
            task = cursor.fetchone()
        logger.info('SpaceCloud delete task saved id=%s room=%s reservation=%s status=%s', task.get('id') if task else '-', room_key, row['reservation_number'], task.get('status') if task else '-')
        return task
    except Exception as error:
        disable_db_logging(config, logger, 'SpaceCloud delete task save failed', error)
        return None
    finally:
        if conn is not None:
            conn.close()


def upsert_spacecloud_upload_task(config, logger, email_event_id, event_data, calendar_key):
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

    conn = None
    try:
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
                    status=IF(status IN ('done', 'needs_review', 'google_pending'), status, 'pending'),
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
        disable_db_logging(config, logger, 'SpaceCloud upload task save failed', error)
        return None
    finally:
        if conn is not None:
            conn.close()


def upsert_spacecloud_naver_block_task(config, logger, email_event_id, event_data, calendar_key, conflicts):
    if not config.get('spacecloud_naver_block_enabled'):
        return None

    room_key = spacecloud_room_key_from_calendar(calendar_key)
    if not config['db_enabled'] or not room_key:
        if not room_key:
            logger.info('Naver block task skipped: no room mapping for calendar=%s product=%s', calendar_key, event_data.get('product'))
        return None

    dedupe_key = spacecloud_naver_block_dedupe_key(event_data, room_key)
    payload = {
        'source': 'spacecloud-email-reservation',
        'action': 'block-naver-availability',
        'calendarKey': calendar_key,
        'roomKey': room_key,
        'conflictCount': len(conflicts),
        'googleConflicts': conflicts[:5],
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

    conn = None
    try:
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
                    status=IF(status IN ('done', 'needs_review', 'google_pending'), status, 'pending'),
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
            'Naver block task saved id=%s room=%s reservation=%s status=%s google_conflicts=%s',
            task.get('id') if task else '-',
            room_key,
            row['reservation_number'],
            task.get('status') if task else '-',
            len(conflicts),
        )
        return task
    except Exception as error:
        disable_db_logging(config, logger, 'Naver block task save failed', error)
        return None
    finally:
        if conn is not None:
            conn.close()


def upsert_spacecloud_naver_restore_task(config, logger, email_event_id, event_data, calendar_key):
    if not config.get('spacecloud_naver_block_enabled'):
        return None

    room_key = spacecloud_room_key_from_calendar(calendar_key)
    if not config['db_enabled'] or not room_key:
        if not room_key:
            logger.info('Naver restore task skipped: no room mapping for calendar=%s product=%s', calendar_key, event_data.get('product'))
        return None

    dedupe_key = spacecloud_naver_restore_dedupe_key(event_data, room_key)
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

    conn = None
    try:
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
                    status=IF(status IN ('done', 'needs_review', 'google_pending'), status, 'pending'),
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
        disable_db_logging(config, logger, 'Naver restore task save failed', error)
        return None
    finally:
        if conn is not None:
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
    suffix = '\n...\n로그: email import log'
    return f'{normalized[:max(0, limit - len(suffix))]}{suffix}'


def alert_time_text():
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


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
        return f'삭제작업 대기(status={status}, task_id={task_id})'
    if calendar_to_spacecloud_room_key(calendar_key):
        return '삭제작업 큐 미등록(DB 비활성/오류 가능)'
    return '대상 아님(스페이스클라우드 방 매핑 없음)'


def format_cancellation_alert(deletion, calendar_key, google_deleted_count, spacecloud_task, subject, email_received_at):
    if google_deleted_count:
        google_delete_status = '자동삭제 완료'
    elif spacecloud_task:
        google_delete_status = '스페이스클라우드 삭제 후 처리대기'
    else:
        google_delete_status = '매칭없음'
    spacecloud_delete_status = format_spacecloud_delete_status(spacecloud_task, calendar_key)

    return (
        '네이버 예약 취소 감지\n'
        f'{alert_time_text()}\n\n'
        f'대상: {alert_event_line(deletion)}\n'
        f"예약번호: {deletion.get('reservation_number') or '-'}\n"
        f'구글: {calendar_key or "-"} / {google_delete_status} {google_deleted_count}건\n'
        f'스페이스클라우드: {short_alert_text(spacecloud_delete_status, 100)}\n'
        f'메일수신: {email_received_at or "-"}\n'
        f'{alert_mail_line(subject)}'
    )


def notify_cancellation(config, deletion, calendar_key, google_deleted_count, spacecloud_task, subject, email_received_at, logger):
    text = format_cancellation_alert(deletion, calendar_key, google_deleted_count, spacecloud_task, subject, email_received_at)
    send_telegram_message(config, text, logger)


def notify_cancellation_parse_failure(config, mailbox, email_id, subject, email_received_at, logger):
    text = (
        '네이버 예약 취소 메일 파싱 실패\n'
        f'{alert_time_text()}\n\n'
        f'메일: {mailbox} / {email_id}\n'
        f'메일수신: {email_received_at or "-"}\n'
        f'{alert_mail_line(subject)}\n'
        '조치: 취소 메일 양식 확인'
    )
    send_telegram_message(config, text, logger)


def format_spacecloud_conflicts(conflicts):
    if not conflicts:
        return '없음'
    lines = []
    for conflict in conflicts[:5]:
        lines.append(
            f"- {conflict.get('start', '-')}~{conflict.get('end', '-')} "
            f"{conflict.get('summary', '-')} "
            f"source={conflict.get('source') or '-'} "
            f"예약번호={conflict.get('reservation_number') or '-'}"
        )
    if len(conflicts) > 5:
        lines.append(f'외 {len(conflicts) - 5}건')
    return '\n'.join(lines)


def format_naver_block_task_status(config, task, conflicts):
    if not config.get('spacecloud_naver_block_enabled'):
        return 'report-only: 네이버 예약불가 변경 안 함'
    if task:
        suffix = f" / 구글 겹침 참고 {len(conflicts)}건" if conflicts else ''
        return f"네이버 예약불가 작업 저장됨: task={task.get('id') or '-'} status={task.get('status') or '-'}{suffix}"
    return '네이버 예약불가 작업 미생성: DB/방 매핑/파싱 상태 확인 필요'


def format_spacecloud_google_status(config, google_event, conflicts):
    if google_event:
        return f"자동생성 완료: event_id={google_event.get('id') or '-'}"
    if config.get('spacecloud_naver_block_enabled'):
        if conflicts:
            return f'후순위 대기: 네이버 예약불가 반영 후 기록, 기존 구글 겹침 {len(conflicts)}건은 검증 참고'
        return '후순위 대기: 네이버 예약불가 반영 후 기록'
    return 'report-only: 자동생성 안 함'


def notify_spacecloud_reservation_report(config, event_data, calendar_key, conflicts, google_event, naver_block_task, subject, email_received_at, logger):
    status = '구글 기록 겹침 참고' if conflicts else '네이버 차단 후보 감지'
    current_step = format_naver_block_task_status(config, naver_block_task, conflicts)
    google_status = format_spacecloud_google_status(config, google_event, conflicts)
    text = (
        '스페이스클라우드 예약 메일 감지\n'
        f'{alert_time_text()}\n\n'
        f'상태: {status}\n'
        f'대상: {alert_event_line(event_data)}\n'
        f"네이버: {short_alert_text(current_step, 120)}\n"
        f"구글: {short_alert_text(google_status, 100)}\n"
        f"메일수신: {email_received_at or '-'}\n"
        f'{alert_mail_line(subject)}'
    )
    send_telegram_message(config, text, logger)


def notify_spacecloud_parse_failure(config, mailbox, email_id, subject, email_received_at, logger):
    text = (
        '스페이스클라우드 예약완료 메일 파싱 실패\n'
        f'{alert_time_text()}\n\n'
        f'메일: {mailbox} / {email_id}\n'
        f'메일수신: {email_received_at or "-"}\n'
        f'{alert_mail_line(subject)}\n'
        '조치: 예약 메일 양식 확인'
    )
    send_telegram_message(config, text, logger)


def format_naver_restore_task_status(config, task):
    if not config.get('spacecloud_naver_block_enabled'):
        return 'report-only: 네이버 예약가능 복구 안 함'
    if task:
        return f"네이버 예약가능 복구 작업 저장됨: task={task.get('id') or '-'} status={task.get('status') or '-'}"
    return '네이버 예약가능 복구 작업 미생성: DB/방 매핑/파싱 상태 확인 필요'


def notify_spacecloud_cancellation_report(config, event_data, calendar_key, naver_restore_task, subject, email_received_at, logger):
    current_step = format_naver_restore_task_status(config, naver_restore_task)
    text = (
        '스페이스클라우드 취소완료 메일 감지\n'
        f'{alert_time_text()}\n\n'
        f'대상: {alert_event_line(event_data)}\n'
        f"네이버: {short_alert_text(current_step, 120)}\n"
        f"구글: 복구 후 삭제 대기\n"
        f"메일수신: {email_received_at or '-'}\n"
        f'{alert_mail_line(subject)}'
    )
    send_telegram_message(config, text, logger)


def notify_spacecloud_cancellation_parse_failure(config, mailbox, email_id, subject, email_received_at, logger):
    text = (
        '스페이스클라우드 취소완료 메일 파싱 실패\n'
        f'{alert_time_text()}\n\n'
        f'메일: {mailbox} / {email_id}\n'
        f'메일수신: {email_received_at or "-"}\n'
        f'{alert_mail_line(subject)}\n'
        '조치: 취소 메일 양식 확인'
    )
    send_telegram_message(config, text, logger)


def find_calendar_event_by_reservation(service, target_calendar, reservation_number, logger):
    if not reservation_number:
        return None

    calendar_id = CALENDAR_IDS[target_calendar]
    result = service.events().list(
        calendarId=calendar_id,
        q=reservation_number,
        singleEvents=True,
        maxResults=10,
    ).execute()
    for item in result.get('items', []):
        private = item.get('extendedProperties', {}).get('private', {})
        description = item.get('description', '')
        if private.get('reservationNumber') == reservation_number or reservation_number in description:
            logger.info('Existing Google Calendar event found calendar=%s reservation=%s event_id=%s', target_calendar, reservation_number, item.get('id'))
            return item
    return None


def compact_calendar_match_text(value):
    return re.sub(r'\s+', '', str(value or '')).lower()


def calendar_event_time_matches(item, target_start, target_end):
    start = parse_google_event_datetime(item.get('start', {}).get('dateTime'))
    end = parse_google_event_datetime(item.get('end', {}).get('dateTime'))
    if not start or not end:
        return False
    return (
        start.replace(second=0, microsecond=0) == target_start.replace(second=0, microsecond=0)
        and end.replace(second=0, microsecond=0) == target_end.replace(second=0, microsecond=0)
    )


def calendar_event_detail_matches(item, event_data, target_start, target_end):
    if not calendar_event_time_matches(item, target_start, target_end):
        return False

    summary = item.get('summary', '')
    description = item.get('description', '')
    searchable = f'{summary}\n{description}'
    compact_searchable = compact_calendar_match_text(searchable)

    product = event_data.get('product') or ''
    if product and compact_calendar_match_text(product) not in compact_searchable:
        return False

    reserver_name = normalize_reserver_name_for_match(
        event_data.get('name') or event_data.get('reserver_name')
    )
    if reserver_name and reserver_name not in normalize_reserver_name_for_match(searchable):
        return False

    return True


def find_calendar_event_by_details(service, target_calendar, event_data, logger):
    if not target_calendar or target_calendar not in CALENDAR_IDS:
        return None

    event_data = normalize_event_datetime_fields(event_data)
    if not event_data.get('date') or not event_data.get('start_time') or not event_data.get('end_time'):
        return None

    target_start = parse_datetime(event_data['date'], event_data['start_time']).replace(tzinfo=KST)
    target_end = parse_datetime(event_data['date'], event_data['end_time']).replace(tzinfo=KST)
    if target_end <= target_start:
        target_end += timedelta(days=1)

    result = service.events().list(
        calendarId=CALENDAR_IDS[target_calendar],
        timeMin=f"{event_data['date']}T00:00:00+09:00",
        timeMax=f"{event_data['date']}T23:59:59+09:00",
        singleEvents=True,
        orderBy='startTime',
    ).execute()
    for item in result.get('items', []):
        if calendar_event_detail_matches(item, event_data, target_start, target_end):
            logger.info(
                'Existing Google Calendar event found by details calendar=%s reserver_name=%s reservation_time=%s event_id=%s',
                target_calendar,
                event_data.get('name') or event_data.get('reserver_name') or '',
                reservation_time_text(event_data),
                item.get('id'),
            )
            return item
    return None


def create_calendar_event(service, event_data, logger, dedupe_google_calendar=False):
    event_data = normalize_event_datetime_fields(event_data)
    target_calendar = event_data['target_calendar']
    calendar_id = CALENDAR_IDS[target_calendar]
    if dedupe_google_calendar:
        existing = find_calendar_event_by_reservation(
            service,
            target_calendar,
            event_data.get('reservation_number', ''),
            logger,
        )
        if existing:
            return existing
        existing = find_calendar_event_by_details(
            service,
            target_calendar,
            event_data,
            logger,
        )
        if existing:
            return existing

    start = parse_datetime(event_data['date'], event_data['start_time'])
    end = parse_datetime(event_data['date'], event_data['end_time'])
    if end <= start:
        end += timedelta(days=1)

    description = (
        f"예약자명: {event_data['name']}\n"
        f"예약상품: {event_data['product']}\n"
        f"사용일자: {event_data['date']}\n"
        f"시작시간: {event_data['start_time']}\n"
        f"종료시간: {event_data['end_time']}\n"
        f"결제상태: {event_data.get('payment_status', 'N/A')}\n"
        f"예약번호: {event_data.get('reservation_number', 'N/A')}\n"
        f"결제금액: {event_data.get('price', 'N/A')}\n"
    )
    event_body = {
        'summary': f"{event_data['product']} {mask_name(event_data['name'])}님",
        'description': description,
        'start': {'dateTime': start.isoformat(), 'timeZone': TIME_ZONE},
        'end': {'dateTime': end.isoformat(), 'timeZone': TIME_ZONE},
        'extendedProperties': {
            'private': {
                'source': 'rhythmjoy_email_import',
                'reservationNumber': event_data.get('reservation_number', ''),
                'targetCalendar': target_calendar,
            }
        },
    }
    created = service.events().insert(calendarId=calendar_id, body=event_body).execute()
    logger.info(
        'Event created calendar=%s reservation=%s reserver_name=%s reservation_time=%s link=%s',
        target_calendar,
        event_data.get('reservation_number'),
        event_data.get('name'),
        reservation_time_text(event_data),
        created.get('htmlLink'),
    )
    return created


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


def parse_google_event_datetime(value):
    if not value:
        return None
    if value.endswith('Z'):
        value = value[:-1] + '+00:00'
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=KST)
    return parsed.astimezone(KST)


def find_calendar_conflicts(service, calendar_key, event_data, logger):
    if not calendar_key or calendar_key not in CALENDAR_IDS:
        return []
    event_data = normalize_event_datetime_fields(event_data)
    if not event_data.get('date') or not event_data.get('start_time') or not event_data.get('end_time'):
        return []

    target_start = parse_datetime(event_data['date'], event_data['start_time']).replace(tzinfo=KST)
    target_end = parse_datetime(event_data['date'], event_data['end_time']).replace(tzinfo=KST)
    if target_end <= target_start:
        target_end += timedelta(days=1)

    day_start = f"{event_data['date']}T00:00:00+09:00"
    day_end = f"{event_data['date']}T23:59:59+09:00"
    events = service.events().list(
        calendarId=CALENDAR_IDS[calendar_key],
        timeMin=day_start,
        timeMax=day_end,
        singleEvents=True,
        orderBy='startTime',
    ).execute().get('items', [])

    conflicts = []
    for item in events:
        start = parse_google_event_datetime(item.get('start', {}).get('dateTime'))
        end = parse_google_event_datetime(item.get('end', {}).get('dateTime'))
        if not start or not end:
            continue
        if target_start < end and target_end > start:
            private = item.get('extendedProperties', {}).get('private', {})
            conflicts.append({
                'calendar_key': calendar_key,
                'summary': item.get('summary', ''),
                'start': start.strftime('%Y-%m-%d %H:%M'),
                'end': end.strftime('%Y-%m-%d %H:%M'),
                'source': private.get('source', ''),
                'reservation_number': private.get('reservationNumber', ''),
                'event_id': item.get('id', ''),
            })
    if conflicts:
        logger.info('SpaceCloud reservation has calendar conflict calendar=%s reservation=%s conflicts=%s', calendar_key, event_data.get('reservation_number'), len(conflicts))
    return conflicts


def reservation_time_text(payload):
    if payload.get('date') and payload.get('start_time') and payload.get('end_time'):
        return f"{payload['date']} {payload['start_time']}-{payload['end_time']}"
    return '-'


def delete_events_by_reservation(service, deletion, logger):
    calendar_key = product_to_calendar_key(deletion.get('product', ''))
    if not calendar_key:
        logger.warning('Cancellation product did not map to a calendar: %s', deletion.get('product'))
        return 0

    reservation_number = deletion.get('reservation_number')
    if not reservation_number:
        logger.warning('Cancellation has no reservation number: %s', deletion)
        return delete_events_by_details(service, calendar_key, deletion, logger)

    calendar_id = CALENDAR_IDS[calendar_key]
    result = service.events().list(
        calendarId=calendar_id,
        q=reservation_number,
        singleEvents=True,
    ).execute()
    deleted = 0
    for item in result.get('items', []):
        service.events().delete(calendarId=calendar_id, eventId=item['id']).execute()
        deleted += 1
        logger.info(
            'Google Calendar event deleted calendar=%s reservation=%s reserver_name=%s reservation_time=%s summary=%s',
            calendar_key,
            reservation_number,
            deletion.get('name', ''),
            reservation_time_text(deletion),
            item.get('summary', ''),
        )
    if not deleted:
        logger.warning(
            'No matching Google Calendar event for cancellation calendar=%s reservation=%s reserver_name=%s reservation_time=%s',
            calendar_key,
            reservation_number,
            deletion.get('name', ''),
            reservation_time_text(deletion),
        )
    return deleted


def delete_events_by_details(service, calendar_key, deletion, logger):
    deletion = normalize_event_datetime_fields(deletion)
    date_text = deletion.get('date')
    start_time = deletion.get('start_time')
    end_time = deletion.get('end_time')
    if not date_text or not start_time or not end_time:
        return 0

    calendar_id = CALENDAR_IDS[calendar_key]
    date_value = deletion['date']
    time_min = f'{date_value}T00:00:00+09:00'
    time_max = f'{date_value}T23:59:59+09:00'
    result = service.events().list(
        calendarId=calendar_id,
        timeMin=time_min,
        timeMax=time_max,
        singleEvents=True,
    ).execute()

    start_dt = parse_datetime(date_text, start_time).replace(tzinfo=KST)
    end_dt = parse_datetime(date_text, end_time).replace(tzinfo=KST)
    if end_dt <= start_dt:
        end_dt += timedelta(days=1)

    deleted = 0
    for item in result.get('items', []):
        summary = item.get('summary', '')
        if not calendar_event_detail_matches(item, deletion, start_dt, end_dt):
            continue
        service.events().delete(calendarId=calendar_id, eventId=item['id']).execute()
        deleted += 1
        logger.info(
            'Google Calendar event deleted by details calendar=%s reserver_name=%s reservation_time=%s summary=%s',
            calendar_key,
            deletion.get('name', ''),
            reservation_time_text(deletion),
            summary,
        )
    return deleted


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


def process_message(config, get_calendar_service, imap_connection, mailbox, target_calendar, email_id, raw_message, fetch_metadata, logger):
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
            email_row = upsert_email_event(config, logger, record)
            email_record_id = email_row.get('id') if email_row else None
            if event_data:
                upsert_booking_ledger_confirmed(config, logger, email_record_id, event_data, target_calendar, email_received_at, 'naver')
                upload_task = upsert_spacecloud_upload_task(config, logger, email_record_id, event_data, target_calendar)
                if upload_task:
                    task_status = upload_task.get('status') or 'pending'
                    processing_status = f"spacecloud_upload_{task_status}"
                    if len(processing_status) > 32:
                        processing_status = 'spacecloud_upload_saved'
                    update_email_processing(
                        config,
                        email_record_id,
                        processing_status,
                        logger,
                        error_text='',
                    )
                else:
                    created = create_calendar_event(
                        get_calendar_service(),
                        event_data,
                        logger,
                        dedupe_google_calendar=config['dedupe_google_calendar'],
                    )
                    update_email_processing(
                        config,
                        email_record_id,
                        'calendar_created',
                        logger,
                        google_calendar_event_id=created.get('id', ''),
                        error_text='legacy_or_upload_task_unavailable',
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
                upsert_booking_ledger_canceled(config, logger, email_record_id, deletion, calendar_key, email_received_at, 'naver')
                spacecloud_task = upsert_spacecloud_delete_task(config, logger, email_record_id, deletion, calendar_key)
                if config.get('naver_spacecloud_upload_enabled') and spacecloud_task:
                    deleted = 0
                    task_status = spacecloud_task.get('status') or 'pending'
                    processing_status = f"spacecloud_delete_{task_status}"
                    if len(processing_status) > 32:
                        processing_status = 'spacecloud_delete_saved'
                    update_email_processing(
                        config,
                        email_record_id,
                        processing_status,
                        logger,
                        google_calendar_deleted_count=0,
                        error_text='google_delete_after_spacecloud',
                    )
                else:
                    deleted = delete_events_by_reservation(get_calendar_service(), deletion, logger)
                    update_email_processing(
                        config,
                        email_record_id,
                        'calendar_deleted' if deleted else 'calendar_not_found',
                        logger,
                        google_calendar_deleted_count=deleted,
                        error_text='',
                    )
                notify_cancellation(config, deletion, calendar_key, deleted, spacecloud_task, subject, email_received_at, logger)
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
                    upsert_booking_ledger_canceled(config, logger, email_record_id, event_data, calendar_key, email_received_at, 'spacecloud')
                    naver_restore_task = upsert_spacecloud_naver_restore_task(
                        config,
                        logger,
                        email_record_id,
                        event_data,
                        calendar_key,
                    )
                    if naver_restore_task:
                        task_status = naver_restore_task.get('status') or 'pending'
                        processing_status = f"naver_restore_{task_status}"
                        if len(processing_status) > 32:
                            processing_status = 'naver_restore_saved'
                    elif config.get('spacecloud_naver_block_enabled'):
                        processing_status = 'naver_restore_skipped'
                    else:
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
                upsert_booking_ledger_confirmed(config, logger, email_record_id, event_data, calendar_key, email_received_at, 'spacecloud')
                conflicts = []
                try:
                    conflicts = find_calendar_conflicts(get_calendar_service(), calendar_key, event_data, logger)
                except Exception:
                    logger.exception(
                        'Google Calendar conflict check skipped for SpaceCloud reservation mailbox=%s email_id=%s',
                        mailbox,
                        decoded_id,
                    )
                event_data['conflict_count'] = len(conflicts)
                google_event = None
                naver_block_task = upsert_spacecloud_naver_block_task(
                    config,
                    logger,
                    email_record_id,
                    event_data,
                    calendar_key,
                    conflicts,
                )
                if naver_block_task:
                    task_status = naver_block_task.get('status') or 'pending'
                    processing_status = f"naver_block_{task_status}"
                    if len(processing_status) > 32:
                        processing_status = 'naver_block_saved'
                elif conflicts:
                    processing_status = 'spacecloud_conflict_reported'
                elif config.get('spacecloud_naver_block_enabled'):
                    processing_status = 'naver_block_skipped'
                else:
                    processing_status = 'report_only_ready'
                update_email_processing(
                    config,
                    email_record_id,
                    processing_status,
                    logger,
                    google_calendar_event_id=google_event.get('id', '') if google_event else '',
                    error_text='',
                )
                notify_spacecloud_reservation_report(
                    config,
                    event_data,
                    calendar_key,
                    conflicts,
                    google_event,
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
            cursor.execute('DELETE FROM rhythmjoy_booking_ledger')
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
    logger.info('Booking ledger backfill finished processed=%s scanned=%s', processed, len(rows))
    return processed


def run_poll_once(config, logger):
    service = None

    def get_calendar_service():
        nonlocal service
        if service is None:
            service = build_calendar_service(config)
        return service

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

            for email_id in email_data[0].split()[::-1]:
                result, message_data = imap_connection.fetch(email_id, '(INTERNALDATE RFC822)')
                fetch_metadata, raw_message = extract_fetch_payload(message_data or [])
                if result != 'OK' or not raw_message:
                    logger.error('Failed to fetch mailbox=%s email_id=%s result=%s', mailbox, email_id, result)
                    continue
                process_message(config, get_calendar_service, imap_connection, mailbox, target_calendar, email_id, raw_message, fetch_metadata, logger)
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
    google_service_account_file = os.environ.get('GOOGLE_SERVICE_ACCOUNT_FILE', str(DEFAULT_GOOGLE_SERVICE_ACCOUNT))
    db_server = os.environ.get('DB_SERVERNAME', '')
    db_username = os.environ.get('DB_USERNAME', '')
    db_password = os.environ.get('DB_PASSWORD', '')
    db_name = os.environ.get('DB_NAME', '')
    db_enabled = all([db_server, db_username, db_password, db_name])

    return {
        'naver_mail_username': naver_mail_username,
        'naver_mail_password': naver_mail_password,
        'google_service_account_file': google_service_account_file,
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
        'db_enabled': db_enabled,
        'db_required': env_flag('RHYTHMJOY_EMAIL_DB_REQUIRED', '1'),
        'db_server': db_server,
        'db_port': int(os.environ.get('DB_PORT', '3306')),
        'db_username': db_username,
        'db_password': db_password,
        'db_name': db_name,
        'store_raw_email_body': env_flag('RHYTHMJOY_EMAIL_STORE_RAW_BODY', '1'),
        'dedupe_google_calendar': env_flag('RHYTHMJOY_EMAIL_DEDUPE_GOOGLE', '0'),
        'naver_spacecloud_upload_enabled': env_flag('RHYTHMJOY_NAVER_SPACECLOUD_UPLOAD_ENABLED', '0'),
        'spacecloud_email_enabled': env_flag('RHYTHMJOY_SPACECLOUD_EMAIL_ENABLED', '0'),
        'spacecloud_naver_block_enabled': env_flag('RHYTHMJOY_SPACECLOUD_NAVER_BLOCK_ENABLED', '0'),
    }


def check_config(config, logger):
    if not Path(config['google_service_account_file']).is_file():
        logger.warning('Missing Google service account file; downstream Google Calendar writes will fail: %s', config['google_service_account_file'])
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    if not os.access(str(LOG_DIR), os.W_OK):
        raise ConfigError(f'Email log directory is not writable: {LOG_DIR}')
    ensure_db_tables(config, logger)


def main():
    parser = argparse.ArgumentParser(description='Import Rhythmjoy Naver booking email into Google Calendar.')
    parser.add_argument('--once', action='store_true', help='run one polling cycle and exit')
    parser.add_argument('--check-config', action='store_true', help='validate config and exit')
    parser.add_argument('--backfill-ledger', action='store_true', help='rebuild booking ledger rows from stored parsed email events and exit')
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

    while True:
        try:
            processed = run_poll_once(config, logger)
            logger.info('Email polling cycle finished processed=%s', processed)
        except Exception as error:
            logger.exception('Email polling cycle failed')
            send_alert(config, 'Rhythmjoy email import error', str(error), logger)

        if args.once:
            return
        time.sleep(config['poll_interval'])


if __name__ == '__main__':
    main()
