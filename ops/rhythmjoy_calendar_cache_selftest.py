#!/usr/bin/env python3
import sys
import types

try:
    import pymysql  # noqa: F401
except ModuleNotFoundError:
    sys.modules['pymysql'] = types.SimpleNamespace()

import rhythmjoy_calendar_cache as cache


def ledger_row(**changes):
    row = {
        'id': 1,
        'source_platform': 'naver',
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
    assert len(events) == 3
    assert meta == {
        'confirmedCount': 3,
        'adminCount': 1,
        'publishedCount': 3,
        'duplicateSlotCount': 1,
        'invalidRowCount': 0,
    }
    assert events[0]['extendedProps']['recordSource'] == 'db-ledger'
    overnight = next(event for event in events if event['className'] == 'e')
    assert overnight['end'] == '2026-08-13T00:00:00+09:00'
    admin = next(event for event in events if event['id'] == 'admin:8')
    assert admin['end'] == '2026-08-14T00:00:00+09:00'
    assert admin['extendedProps']['recordSource'] == 'db-admin'
    print('calendar DB-ledger cache self-test OK')


if __name__ == '__main__':
    main()
