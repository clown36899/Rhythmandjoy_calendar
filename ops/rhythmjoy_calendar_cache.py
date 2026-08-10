#!/usr/bin/env python3
import argparse
import hashlib
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pymysql


APP_ROOT = Path('/home/clown313python/myapp')
DATA_DIR = APP_ROOT / 'calendar_set' / 'calendar_v10' / 'data'
EVENTS_FILE = DATA_DIR / 'events.json'
STATE_FILE = DATA_DIR / 'calendar_cache_state.json'
TIME_ZONE = 'Asia/Seoul'
FULL_SYNC_PAST_DAYS = 120
ENV_FILE = APP_ROOT / '.env'

ROOMS = {
    'a': {
        'name': 'A홀',
        'color': '#F6BF26',
    },
    'b': {
        'name': 'B홀',
        'color': 'rgb(87, 150, 200)',
    },
    'c': {
        'name': 'C홀',
        'color': 'rgb(129, 180, 186)',
    },
    'd': {
        'name': 'D홀',
        'color': 'rgb(125, 157, 106)',
    },
    'e': {
        'name': 'E홀',
        'color': '#4c4c4c',
    },
}


def utc_now():
    return datetime.now(timezone.utc)


def iso_utc_timestamp(value):
    return value.isoformat().replace('+00:00', 'Z')


def load_env_file(path=ENV_FILE):
    source = Path(path)
    if not source.is_file():
        return
    for raw in source.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def db_connect():
    load_env_file()
    return pymysql.connect(
        host=os.environ['DB_SERVERNAME'],
        port=int(os.environ.get('DB_PORT', '3306')),
        user=os.environ['DB_USERNAME'],
        password=os.environ['DB_PASSWORD'],
        database=os.environ['DB_NAME'],
        charset='utf8mb4',
        autocommit=True,
        cursorclass=pymysql.cursors.DictCursor,
    )


def fetch_booking_ledger_rows():
    conn = db_connect()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, source_platform, source_mode, current_status,
                       reservation_number, reserver_name, product, room_key,
                       CAST(reservation_date AS CHAR) AS reservation_date,
                       TIME_FORMAT(start_time, '%%H:%%i:%%s') AS start_time,
                       TIME_FORMAT(end_time, '%%H:%%i:%%s') AS end_time,
                       CAST(updated_at AS CHAR) AS updated_at
                FROM rhythmjoy_booking_ledger
                WHERE source_platform IN ('naver', 'spacecloud')
                  AND current_status = 'confirmed'
                  AND COALESCE(source_mode, '') <> 'admin-task-anchor'
                  AND reservation_date >= DATE_SUB(CURDATE(), INTERVAL %s DAY)
                ORDER BY reservation_date, start_time, room_key, id
            """, (FULL_SYNC_PAST_DAYS,))
            return cur.fetchall()
    finally:
        conn.close()


def fetch_admin_reservation_rows():
    conn = db_connect()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, reservation_key, reservation_date, room_key,
                       start_hour, end_hour, reserver_name, memo, source, status,
                       CAST(updated_at AS CHAR) AS updated_at
                FROM rhythmjoy_admin_reservations
                WHERE status <> 'canceled'
                  AND reservation_date >= DATE_SUB(CURDATE(), INTERVAL %s DAY)
                ORDER BY reservation_date, start_hour, room_key, id
            """, (FULL_SYNC_PAST_DAYS,))
            return cur.fetchall()
    finally:
        conn.close()


def short_clock(value):
    text = str(value or '')
    return text[:5] if len(text) >= 5 else ''


def ledger_slot(row):
    start = short_clock(row.get('start_time'))
    end = short_clock(row.get('end_time'))
    if end == '23:59':
        end = '24:00'
    return (
        str(row.get('reservation_date') or '')[:10],
        str(row.get('room_key') or '').lower(),
        start,
        end,
    )


def iso_korea_datetime(date_text, clock_text, start_clock=''):
    date_value = datetime.strptime(str(date_text)[:10], '%Y-%m-%d')
    clock = short_clock(clock_text)
    if clock in ('24:00', '23:59'):
        date_value += timedelta(days=1)
        clock = '00:00'
    elif start_clock and clock <= short_clock(start_clock):
        date_value += timedelta(days=1)
    return f"{date_value.strftime('%Y-%m-%d')}T{clock}:00+09:00"


def ledger_to_calendar_event(row):
    room_key = str(row.get('room_key') or '').lower()
    room = ROOMS.get(room_key)
    if not room:
        return None
    date_text, _, start, end = ledger_slot(row)
    if not date_text or not start or not end:
        return None
    reservation_number = str(row.get('reservation_number') or '').strip()
    reserver_name = str(row.get('reserver_name') or '').strip()
    description = f'예약번호: {reservation_number}' if reservation_number else '스페이스클라우드 예약'
    return {
        'id': f"ledger:{row.get('id')}",
        'title': reserver_name or str(row.get('product') or '').strip() or '예약',
        'start': iso_korea_datetime(date_text, start),
        'end': iso_korea_datetime(date_text, end, start_clock=start),
        'className': room_key,
        'color': room['color'],
        'textColor': '#000',
        'description': description,
        'location': '',
        'extendedProps': {
            'description': description,
            'location': '',
            'roomKey': room_key,
            'roomName': room['name'],
            'googleEventId': '',
            'ledgerId': row.get('id'),
            'sourcePlatform': row.get('source_platform') or '',
            'reservationNumber': reservation_number,
            'updated': row.get('updated_at'),
            'recordSource': 'db-ledger',
        },
    }


def admin_to_calendar_event(row):
    room_key = str(row.get('room_key') or '').lower()
    room = ROOMS.get(room_key)
    if not room:
        return None
    date_text = str(row.get('reservation_date') or '')[:10]
    try:
        start_hour = int(row.get('start_hour'))
        end_hour = int(row.get('end_hour'))
    except (TypeError, ValueError):
        return None
    if not date_text or not 0 <= start_hour <= 23 or not 1 <= end_hour <= 24 or end_hour <= start_hour:
        return None
    start = f'{start_hour:02d}:00'
    end = '24:00' if end_hour == 24 else f'{end_hour:02d}:00'
    description = '관리자 일정'
    return {
        'id': f"admin:{row.get('id')}",
        'title': str(row.get('reserver_name') or '').strip() or '관리자 일정',
        'start': iso_korea_datetime(date_text, start),
        'end': iso_korea_datetime(date_text, end, start_clock=start),
        'className': room_key,
        'color': room['color'],
        'textColor': '#000',
        'description': description,
        'location': '',
        'extendedProps': {
            'description': description,
            'location': '',
            'roomKey': room_key,
            'roomName': room['name'],
            'googleEventId': '',
            'adminReservationId': row.get('id'),
            'sourcePlatform': 'admin',
            'reservationNumber': '',
            'updated': row.get('updated_at'),
            'recordSource': 'db-admin',
        },
    }


def build_db_calendar_events(ledger_rows, admin_rows=None):
    events = []
    seen_slots = set()
    duplicate_slots = 0
    invalid_rows = 0

    source_order = {'naver': 0, 'spacecloud': 1}
    confirmed_rows = sorted(
        (row for row in ledger_rows if row.get('current_status') == 'confirmed'),
        key=lambda row: (
            source_order.get(str(row.get('source_platform') or ''), 9),
            int(row.get('id') or 0),
        ),
    )
    for row in confirmed_rows:
        slot = ledger_slot(row)
        if slot in seen_slots:
            duplicate_slots += 1
            continue
        event = ledger_to_calendar_event(row)
        if not event:
            invalid_rows += 1
            continue
        seen_slots.add(slot)
        events.append(event)

    admin_count = 0
    for row in admin_rows or []:
        if row.get('status') == 'canceled':
            continue
        event = admin_to_calendar_event(row)
        if not event:
            invalid_rows += 1
            continue
        slot = event_slot(event)
        if slot in seen_slots:
            duplicate_slots += 1
            continue
        seen_slots.add(slot)
        events.append(event)
        admin_count += 1

    events.sort(key=lambda event: (event.get('start') or '', event.get('className') or '', event.get('id') or ''))
    return events, {
        'confirmedCount': len(confirmed_rows),
        'adminCount': admin_count,
        'publishedCount': len(events),
        'duplicateSlotCount': duplicate_slots,
        'invalidRowCount': invalid_rows,
    }


def event_slot(event):
    start = str(event.get('start') or '')
    end = str(event.get('end') or '')
    date_text = start[:10]
    start_clock = start.split('T', 1)[1][:5] if 'T' in start else '00:00'
    end_date = end[:10]
    end_clock = end.split('T', 1)[1][:5] if 'T' in end else '00:00'
    if end_clock == '00:00' and end_date and end_date != date_text:
        end_clock = '24:00'
    props = event.get('extendedProps') or {}
    room_key = str(props.get('roomKey') or event.get('className') or '').lower()
    return date_text, room_key, start_clock, end_clock


def atomic_write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + '.tmp')
    with tmp_path.open('w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(str(tmp_path), str(path))


def sync_once():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ledger_rows = fetch_booking_ledger_rows()
    admin_rows = fetch_admin_reservation_rows()
    all_events, ledger_meta = build_db_calendar_events(ledger_rows, admin_rows)
    ledger_meta = {'ok': True, **ledger_meta}
    coverage_start = (
        (utc_now() + timedelta(hours=9)).date() - timedelta(days=FULL_SYNC_PAST_DAYS)
    ).isoformat()
    room_meta = {}
    for room_key, room in ROOMS.items():
        room_count = sum(1 for event in all_events if event.get('className') == room_key)
        room_meta[room_key] = {
            'name': room['name'],
            'color': room['color'],
            'count': room_count,
            'mode': 'db-ledger',
            'touched': room_count,
            'ok': True,
            'coverageStart': coverage_start,
        }
        logging.info('%s DB ledger cache: events=%s', room['name'], room_count)

    all_events.sort(key=lambda event: (event.get('start') or '', event.get('id') or ''))
    content_hash = hashlib.sha256(
        json.dumps(all_events, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    ).hexdigest()

    generated_at = iso_utc_timestamp(utc_now())
    payload = {
        'version': 2,
        'source': 'db-booking-ledger',
        'sourceOfTruth': 'rhythmjoy_booking_ledger',
        'generatedAt': generated_at,
        'generatedAtMs': int(time.time() * 1000),
        'contentHash': content_hash,
        'timeZone': TIME_ZONE,
        'coverageStart': coverage_start,
        'rooms': room_meta,
        'ledger': ledger_meta,
        'adminSource': 'rhythmjoy_admin_reservations',
        'googleCalendar': {
            'role': 'disabled',
            'writesEnabled': False,
            'usedForPublicSchedule': False,
        },
        'failures': {},
        'events': all_events,
    }

    atomic_write_json(EVENTS_FILE, payload)
    atomic_write_json(STATE_FILE, {
        'version': 2,
        'source': 'db-booking-ledger',
        'generatedAt': generated_at,
        'contentHash': content_hash,
        'ledger': ledger_meta,
    })

    return payload


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--interval', type=int, default=30)
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format='[%(asctime)s] %(levelname)s %(message)s',
    )

    while True:
        try:
            payload = sync_once()
            logging.info('calendar cache generated: events=%s failures=%s', len(payload['events']), len(payload['failures']))
        except Exception:
            logging.exception('calendar cache pass failed')
            if args.once:
                raise

        if args.once:
            break
        time.sleep(max(args.interval, 5))


if __name__ == '__main__':
    main()
