#!/usr/bin/env python3
import sys
import tempfile
import types
from pathlib import Path

try:
    import pymysql  # noqa: F401
except ModuleNotFoundError:
    sys.modules['pymysql'] = types.SimpleNamespace()

import rhythmjoy_calendar_cache as cache


def ledger_row(**changes):
    row = {
        'id': 1,
        'source_platform': 'naver',
        'source_mode': 'naver_email',
        'current_status': 'confirmed',
        'reservation_number': '1317110201',
        'reserver_name': '김*진님',
        'product': 'C홀',
        'room_key': 'c',
        'reservation_date': '2026-08-12',
        'start_time': '13:00:00',
        'end_time': '17:00:00',
        'updated_at': '2026-08-10 10:00:00',
    }
    row.update(changes)
    return row


def main():
    rows = [
        ledger_row(),
        ledger_row(id=2, source_platform='spacecloud', reservation_number=''),
        ledger_row(id=3, current_status='canceled', room_key='b'),
        ledger_row(id=4, room_key='e', start_time='23:00:00', end_time='00:00:00'),
        ledger_row(
            id=5,
            source_platform='google-backfill',
            source_mode='visible-site-year-backfill',
            room_key='d',
            reservation_number='10222302',
        ),
        ledger_row(
            id=6,
            source_platform='google-backfill',
            source_mode='google-calendar-backfill',
            room_key='b',
        ),
    ]
    admin_rows = [{
        'id': 8,
        'reservation_date': '2026-08-13',
        'room_key': 'A',
        'start_hour': 20,
        'end_hour': 24,
        'reserver_name': '관리자',
        'status': 'pending',
        'updated_at': '2026-08-10 11:00:00',
    }]
    events, meta = cache.build_db_calendar_events(rows, admin_rows)
    assert len(events) == 4
    assert meta == {
        'confirmedCount': 4,
        'adminCount': 1,
        'publishedCount': 4,
        'duplicateSlotCount': 1,
        'invalidRowCount': 0,
    }
    assert events[0]['extendedProps']['recordSource'] == 'db-ledger'
    overnight = next(event for event in events if event['className'] == 'e')
    assert overnight['end'] == '2026-08-13T00:00:00+09:00'
    migrated = next(event for event in events if event['id'] == 'ledger:5')
    assert migrated['extendedProps']['sourcePlatform'] == 'google-backfill'
    assert not any(event['id'] == 'ledger:6' for event in events)
    admin = next(event for event in events if event['id'] == 'admin:8')
    assert admin['end'] == '2026-08-14T00:00:00+09:00'
    assert admin['extendedProps']['recordSource'] == 'db-admin'

    original_data_dir = cache.DATA_DIR
    original_events_file = cache.EVENTS_FILE
    original_state_file = cache.STATE_FILE
    original_fetch_ledger = cache.fetch_booking_ledger_rows
    original_fetch_admin = cache.fetch_admin_reservation_rows
    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            cache.DATA_DIR = Path(temp_dir)
            cache.EVENTS_FILE = Path(temp_dir) / 'events.json'
            cache.STATE_FILE = Path(temp_dir) / 'state.json'
            cache.EVENTS_FILE.write_text('{"lastGood":true}', encoding='utf-8')
            cache.fetch_booking_ledger_rows = lambda: (_ for _ in ()).throw(RuntimeError('db unavailable'))
            cache.fetch_admin_reservation_rows = lambda: []
            try:
                cache.sync_once()
                raise AssertionError('DB failure must propagate')
            except RuntimeError as error:
                assert str(error) == 'db unavailable'
            assert cache.EVENTS_FILE.read_text(encoding='utf-8') == '{"lastGood":true}'
    finally:
        cache.DATA_DIR = original_data_dir
        cache.EVENTS_FILE = original_events_file
        cache.STATE_FILE = original_state_file
        cache.fetch_booking_ledger_rows = original_fetch_ledger
        cache.fetch_admin_reservation_rows = original_fetch_admin
    print('calendar DB-ledger cache self-test OK')


if __name__ == '__main__':
    main()
