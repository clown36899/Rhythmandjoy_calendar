#!/usr/bin/env python3
import argparse
import email
import imaplib
import logging
import os
import re
import smtplib
import time
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


def build_calendar_service(config):
    credentials = service_account.Credentials.from_service_account_file(
        config['google_service_account_file'],
        scopes=['https://www.googleapis.com/auth/calendar'],
    )
    return build('calendar', 'v3', credentials=credentials, cache_discovery=False)


def create_calendar_event(service, event_data, logger):
    target_calendar = event_data['target_calendar']
    calendar_id = CALENDAR_IDS[target_calendar]
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


def process_message(service, imap_connection, mailbox, target_calendar, email_id, raw_message, logger):
    message = email.message_from_bytes(raw_message)
    subject = decode_header_value(message.get('Subject', ''))
    body = get_text_body(message)
    decoded_id = email_id.decode('utf-8', errors='replace')
    logger.info('Processing mailbox=%s email_id=%s subject=%s', mailbox, decoded_id, subject)

    try:
        if mailbox in ROOM_MAILBOXES:
            event_data = parse_reservation(body, target_calendar)
            if event_data:
                create_calendar_event(service, event_data, logger)
            else:
                logger.warning('Reservation email did not match parser mailbox=%s email_id=%s', mailbox, decoded_id)
            mark_seen(imap_connection, email_id, logger)
            return

        if mailbox in ('Cancellation', 'Cancelhall'):
            deletion = parse_cancellation(body)
            if deletion:
                delete_events_by_reservation(service, deletion, logger)
            else:
                logger.warning('Cancellation email did not match parser mailbox=%s email_id=%s', mailbox, decoded_id)
            mark_seen(imap_connection, email_id, logger)
            return

        logger.warning('Unknown mailbox configured: %s', mailbox)
        mark_seen(imap_connection, email_id, logger)
    except Exception:
        logger.exception('Failed to process email mailbox=%s email_id=%s', mailbox, decoded_id)
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
                process_message(service, imap_connection, mailbox, target_calendar, email_id, message_data[0][1], logger)
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
    }


def check_config(config):
    if not Path(config['google_service_account_file']).is_file():
        raise ConfigError(f"Missing Google service account file: {config['google_service_account_file']}")
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    if not os.access(str(LOG_DIR), os.W_OK):
        raise ConfigError(f'Email log directory is not writable: {LOG_DIR}')


def main():
    parser = argparse.ArgumentParser(description='Import Rhythmjoy Naver booking email into Google Calendar.')
    parser.add_argument('--once', action='store_true', help='run one polling cycle and exit')
    parser.add_argument('--check-config', action='store_true', help='validate config and exit')
    args = parser.parse_args()

    logger = setup_logging()
    config = build_config()
    check_config(config)

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
