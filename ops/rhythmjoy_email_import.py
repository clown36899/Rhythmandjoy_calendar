#!/usr/bin/env python3
import argparse
import email
import hashlib
import imaplib
import json
import logging
import os
import re
import smtplib
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from email.header import decode_header
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
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


def parse_datetime(date_text, time_text):
    return datetime.strptime(f'{normalize_date(date_text)} {time_text}:00', '%Y-%m-%d %H:%M:%S')


def mask_name(name):
    clean = name.strip()
    if clean.endswith('님'):
        clean = clean[:-1]
    if len(clean) > 1:
        return clean[0] + '*' * (len(clean) - 1)
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
        hour, minute = value.split(':', 1)
        return f'{int(hour):02d}:{minute}:00'
    return None


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


def build_email_record_base(config, mail_key, mailbox, decoded_id, message_id, subject, body, event_type, parsed_payload):
    return {
        'mail_key': mail_key,
        'mailbox': truncate_text(mailbox, 64),
        'imap_id': truncate_text(decoded_id, 64),
        'message_id': truncate_text(message_id, 255),
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


def build_reservation_email_record(config, mail_key, mailbox, decoded_id, message_id, subject, body, target_calendar, event_data):
    record = build_email_record_base(
        config,
        mail_key,
        mailbox,
        decoded_id,
        message_id,
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


def build_cancellation_email_record(config, mail_key, mailbox, decoded_id, message_id, subject, body, deletion, calendar_key):
    record = build_email_record_base(
        config,
        mail_key,
        mailbox,
        decoded_id,
        message_id,
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
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (id),
                    UNIQUE KEY uq_mail_key (mail_key),
                    KEY idx_reservation_number (reservation_number),
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
                    dedupe_key VARCHAR(255) NOT NULL,
                    email_event_id BIGINT UNSIGNED NULL,
                    task_type VARCHAR(32) NOT NULL,
                    status VARCHAR(32) NOT NULL DEFAULT 'pending',
                    room_key VARCHAR(8) NOT NULL DEFAULT '',
                    reservation_number VARCHAR(64) NOT NULL DEFAULT '',
                    reserver_name VARCHAR(128) NOT NULL DEFAULT '',
                    product VARCHAR(255) NOT NULL DEFAULT '',
                    reservation_date DATE NULL,
                    start_time TIME NULL,
                    end_time TIME NULL,
                    payload_json TEXT NULL,
                    attempts INT NOT NULL DEFAULT 0,
                    locked_at DATETIME NULL,
                    processed_at DATETIME NULL,
                    result_text TEXT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (id),
                    UNIQUE KEY uq_dedupe_key (dedupe_key),
                    KEY idx_status_type (status, task_type),
                    KEY idx_room_date (room_key, reservation_date)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
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
                    mail_key, mailbox, imap_id, message_id, subject,
                    event_type, parse_status, processing_status,
                    target_calendar, spacecloud_room_key,
                    reservation_number, reserver_name, product,
                    reservation_date, start_time, end_time,
                    payment_status, price, raw_body, parsed_json
                )
                VALUES (
                    %(mail_key)s, %(mailbox)s, %(imap_id)s, %(message_id)s, %(subject)s,
                    %(event_type)s, %(parse_status)s, %(processing_status)s,
                    %(target_calendar)s, %(spacecloud_room_key)s,
                    %(reservation_number)s, %(reserver_name)s, %(product)s,
                    %(reservation_date)s, %(start_time)s, %(end_time)s,
                    %(payment_status)s, %(price)s, %(raw_body)s, %(parsed_json)s
                )
                ON DUPLICATE KEY UPDATE
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
                    updated_at=CURRENT_TIMESTAMP
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
    assignments = ['processing_status=%s', 'updated_at=CURRENT_TIMESTAMP']
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


def spacecloud_delete_dedupe_key(deletion, room_key):
    reservation_number = deletion.get('reservation_number') or ''
    if reservation_number:
        return f'delete|reservation|{reservation_number}'
    return '|'.join([
        'delete',
        room_key or '',
        normalize_date(deletion.get('date', '')) if deletion.get('date') else '',
        deletion.get('start_time', ''),
        deletion.get('end_time', ''),
        deletion.get('name', ''),
    ])


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
                    reservation_date, start_time, end_time, payload_json
                )
                VALUES (
                    %(dedupe_key)s, %(email_event_id)s, %(task_type)s, 'pending',
                    %(room_key)s, %(reservation_number)s, %(reserver_name)s, %(product)s,
                    %(reservation_date)s, %(start_time)s, %(end_time)s, %(payload_json)s
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
                    status=IF(status='done', status, 'pending'),
                    updated_at=CURRENT_TIMESTAMP
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


def send_telegram_message(config, text, logger):
    token = config.get('telegram_bot_token', '')
    chat_id = config.get('telegram_chat_id', '')
    if not token or not chat_id:
        logger.info('Telegram cancellation alert skipped: token or chat id missing')
        return False

    try:
        payload = json.dumps({'chat_id': chat_id, 'text': text}, ensure_ascii=False).encode('utf-8')
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


def format_cancellation_alert(deletion, calendar_key, deleted, subject):
    time_text = '-'
    if deletion.get('date') and deletion.get('start_time') and deletion.get('end_time'):
        time_text = f"{deletion['date']} {deletion['start_time']}-{deletion['end_time']}"

    calendar_text = calendar_key or '-'
    reservation_number = deletion.get('reservation_number') or '-'
    product = deletion.get('product') or '-'
    name = mask_name(deletion.get('name', '')) or '-'
    delete_status = '삭제완료' if deleted else '매칭없음'

    return (
        '네이버 예약 취소 감지\n'
        f'{datetime.now().strftime("%Y-%m-%d %H:%M:%S")}\n\n'
        f'상품: {product}\n'
        f'일시: {time_text}\n'
        f'예약자: {name}\n'
        f'예약번호: {reservation_number}\n'
        f'구글캘린더: {calendar_text} / {delete_status} {deleted}건\n\n'
        '스페이스클라우드에 이미 등록된 일정이면 삭제 확인 필요\n'
        f'메일제목: {subject or "-"}'
    )


def notify_cancellation(config, deletion, calendar_key, deleted, subject, logger):
    text = format_cancellation_alert(deletion, calendar_key, deleted, subject)
    send_telegram_message(config, text, logger)


def notify_cancellation_parse_failure(config, mailbox, email_id, subject, logger):
    text = (
        '네이버 예약 취소 메일 파싱 실패\n'
        f'{datetime.now().strftime("%Y-%m-%d %H:%M:%S")}\n\n'
        f'메일함: {mailbox}\n'
        f'메일ID: {email_id}\n'
        f'메일제목: {subject or "-"}\n\n'
        '취소 메일 양식이 바뀌었을 수 있으니 확인 필요'
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


def create_calendar_event(service, event_data, logger):
    target_calendar = event_data['target_calendar']
    calendar_id = CALENDAR_IDS[target_calendar]
    existing = find_calendar_event_by_reservation(
        service,
        target_calendar,
        event_data.get('reservation_number', ''),
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
    logger.info('Event created calendar=%s reservation=%s link=%s', target_calendar, event_data.get('reservation_number'), created.get('htmlLink'))
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
        logger.info('Event deleted calendar=%s reservation=%s summary=%s', calendar_key, reservation_number, item.get('summary', ''))
    if not deleted:
        logger.warning('No matching event for cancellation calendar=%s reservation=%s', calendar_key, reservation_number)
    return deleted


def delete_events_by_details(service, calendar_key, deletion, logger):
    date_text = deletion.get('date')
    start_time = deletion.get('start_time')
    end_time = deletion.get('end_time')
    if not date_text or not start_time or not end_time:
        return 0

    calendar_id = CALENDAR_IDS[calendar_key]
    date_value = normalize_date(date_text)
    time_min = f'{date_value}T00:00:00+09:00'
    time_max = f'{date_value}T23:59:59+09:00'
    result = service.events().list(
        calendarId=calendar_id,
        timeMin=time_min,
        timeMax=time_max,
        singleEvents=True,
    ).execute()

    start_dt = parse_datetime(date_text, start_time)
    end_dt = parse_datetime(date_text, end_time)
    if end_dt <= start_dt:
        end_dt += timedelta(days=1)

    deleted = 0
    for item in result.get('items', []):
        summary = item.get('summary', '')
        description = item.get('description', '')
        if deletion.get('product') and deletion['product'] not in summary:
            continue
        if deletion.get('name') and deletion['name'] not in description:
            continue
        event_start = item.get('start', {}).get('dateTime', '')
        event_end = item.get('end', {}).get('dateTime', '')
        if not event_start or not event_end:
            continue
        if event_start[:16] != start_dt.isoformat()[:16] or event_end[:16] != end_dt.isoformat()[:16]:
            continue
        service.events().delete(calendarId=calendar_id, eventId=item['id']).execute()
        deleted += 1
        logger.info('Event deleted by details calendar=%s summary=%s', calendar_key, summary)
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
        'date': datetime_match.group(1).strip(),
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
            'date': datetime_match.group(1).strip(),
            'start_time': convert_to_24_hour(datetime_match.group(2), datetime_match.group(3)),
            'end_time': convert_to_24_hour(datetime_match.group(4), datetime_match.group(5)),
        })
    return deletion


def mark_seen(imap_connection, email_id, logger):
    try:
        imap_connection.store(email_id, '+FLAGS', '\\Seen')
    except Exception:
        logger.exception('Failed to mark email seen id=%s', email_id.decode('utf-8', errors='replace'))


def process_message(config, service, imap_connection, mailbox, target_calendar, email_id, raw_message, logger):
    message = email.message_from_bytes(raw_message)
    subject = decode_header_value(message.get('Subject', ''))
    body = get_text_body(message)
    decoded_id = email_id.decode('utf-8', errors='replace')
    mail_key, message_id = message_identity(mailbox, decoded_id, message, raw_message)
    email_record_id = None
    logger.info('Processing mailbox=%s email_id=%s subject=%s', mailbox, decoded_id, subject)

    try:
        if mailbox in ROOM_MAILBOXES:
            event_data = parse_reservation(body, target_calendar)
            record = build_reservation_email_record(
                config,
                mail_key,
                mailbox,
                decoded_id,
                message_id,
                subject,
                body,
                target_calendar,
                event_data,
            )
            email_row = upsert_email_event(config, logger, record)
            email_record_id = email_row.get('id') if email_row else None
            if event_data:
                if email_row and email_row.get('processing_status') == 'calendar_created':
                    logger.info('Reservation already handled by DB id=%s reservation=%s', email_record_id, event_data.get('reservation_number'))
                else:
                    created = create_calendar_event(service, event_data, logger)
                    update_email_processing(
                        config,
                        email_record_id,
                        'calendar_created',
                        logger,
                        google_calendar_event_id=created.get('id', ''),
                        error_text='',
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
                subject,
                body,
                deletion,
                calendar_key,
            )
            email_row = upsert_email_event(config, logger, record)
            email_record_id = email_row.get('id') if email_row else None
            if deletion:
                upsert_spacecloud_delete_task(config, logger, email_record_id, deletion, calendar_key)
                if email_row and email_row.get('processing_status') in ('calendar_deleted', 'calendar_not_found'):
                    logger.info('Cancellation already handled by DB id=%s reservation=%s', email_record_id, deletion.get('reservation_number'))
                else:
                    deleted = delete_events_by_reservation(service, deletion, logger)
                    update_email_processing(
                        config,
                        email_record_id,
                        'calendar_deleted' if deleted else 'calendar_not_found',
                        logger,
                        google_calendar_deleted_count=deleted,
                        error_text='',
                    )
                    notify_cancellation(config, deletion, calendar_key, deleted, subject, logger)
            else:
                logger.warning('Cancellation email did not match parser mailbox=%s email_id=%s', mailbox, decoded_id)
                update_email_processing(
                    config,
                    email_record_id,
                    'parse_failed',
                    logger,
                    error_text='cancellation_parser_no_match',
                )
                notify_cancellation_parse_failure(config, mailbox, decoded_id, subject, logger)
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


def run_poll_once(config, logger):
    service = build_calendar_service(config)
    processed = 0
    imap_connection = None
    try:
        imap_connection = imaplib.IMAP4_SSL(config['imap_server'], config['imap_port'])
        imap_connection.login(config['naver_mail_username'], config['naver_mail_password'])

        for mailbox, target_calendar in MAILBOXES.items():
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
                result, message_data = imap_connection.fetch(email_id, '(RFC822)')
                if result != 'OK' or not message_data or not message_data[0]:
                    logger.error('Failed to fetch mailbox=%s email_id=%s result=%s', mailbox, email_id, result)
                    continue
                process_message(config, service, imap_connection, mailbox, target_calendar, email_id, message_data[0][1], logger)
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
        'poll_interval': int(os.environ.get('RHYTHMJOY_EMAIL_POLL_INTERVAL_SECONDS', '300')),
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
        'db_required': env_flag('RHYTHMJOY_EMAIL_DB_REQUIRED', '0'),
        'db_server': db_server,
        'db_port': int(os.environ.get('DB_PORT', '3306')),
        'db_username': db_username,
        'db_password': db_password,
        'db_name': db_name,
        'store_raw_email_body': env_flag('RHYTHMJOY_EMAIL_STORE_RAW_BODY', '1'),
    }


def check_config(config, logger):
    if not Path(config['google_service_account_file']).is_file():
        raise ConfigError(f"Missing Google service account file: {config['google_service_account_file']}")
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    if not os.access(str(LOG_DIR), os.W_OK):
        raise ConfigError(f'Email log directory is not writable: {LOG_DIR}')
    ensure_db_tables(config, logger)


def main():
    parser = argparse.ArgumentParser(description='Import Rhythmjoy Naver booking email into Google Calendar.')
    parser.add_argument('--once', action='store_true', help='run one polling cycle and exit')
    parser.add_argument('--check-config', action='store_true', help='validate config and exit')
    args = parser.parse_args()

    logger = setup_logging()
    config = build_config()
    check_config(config, logger)

    restart_count = increment_restart_count()
    logger.info('Rhythmjoy email import started restart_count=%s interval=%s', restart_count, config['poll_interval'])

    if args.check_config:
        logger.info('Configuration check succeeded')
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
