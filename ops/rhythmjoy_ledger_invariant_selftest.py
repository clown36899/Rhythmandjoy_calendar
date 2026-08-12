#!/usr/bin/env python3
"""Regression guard for booking-ledger event ordering.

This test captures the SQL emitted by the importer without touching a database.
Every mutable booking projection must be conditional on the incoming event time,
so a delayed older email cannot rewrite a newer confirmed/canceled row.
"""

import argparse
import logging
import os
import re
from pathlib import Path
from unittest import mock

import rhythmjoy_email_import as importer


PROJECTION_FIELDS = (
    'source_mode',
    'current_status',
    'target_calendar',
    'room_key',
    'reservation_number',
    'reserver_name',
    'reserver_name_key',
    'product',
    'reservation_date',
    'start_time',
    'end_time',
    'payment_status',
    'price',
    'gross_amount',
    'fee_amount',
    'net_amount',
    'amount_source',
    'payment_method',
)


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


def capture_upsert(function):
    connection = CaptureConnection()
    row = {
        'ledger_key': 'test:1',
        'source_platform': 'naver',
        'source_mode': 'naver_email',
        'event_at': '2026-08-12 10:00:00',
        'payload_json': '{}',
        'reservation_number': '1',
    }
    with mock.patch.object(importer, 'booking_ledger_row', return_value=row):
        function(
            {'db_enabled': True},
            logging.getLogger('ledger-invariant-selftest'),
            1,
            {'event': True},
            'a',
            row['event_at'],
            'naver',
            conn=connection,
        )
    return next(query for query in connection.capture.queries if 'ON DUPLICATE KEY UPDATE' in query)


def live_row(ledger_key, event_at, marker):
    return {
        'ledger_key': ledger_key,
        'source_platform': 'selftest',
        'source_mode': 'event-order-selftest',
        'target_calendar': 'a',
        'room_key': 'a',
        'reservation_number': f'test-{ledger_key}',
        'reserver_name': marker,
        'reserver_name_key': marker,
        'product': marker,
        'reservation_date': '2099-01-01',
        'start_time': '10:00:00',
        'end_time': '11:00:00',
        'payment_status': marker,
        'price': marker,
        'gross_amount': 100,
        'fee_amount': 10,
        'net_amount': 90,
        'amount_source': 'selftest',
        'payment_method': marker,
        'email_event_id': 1,
        'event_at': event_at,
        'payload_json': f'{{"marker":"{marker}"}}',
    }


def call_live_upsert(function, config, connection, row):
    with mock.patch.object(importer, 'booking_ledger_row', return_value=row):
        return function(
            config,
            logging.getLogger('ledger-invariant-live-selftest'),
            row['email_event_id'],
            {'event': True},
            'a',
            row['event_at'],
            'selftest',
            conn=connection,
        )


def run_live_rollback_test(env_file):
    importer.load_env_file(Path(env_file))
    config = {
        'db_enabled': True,
        'db_server': os.environ['DB_SERVERNAME'],
        'db_port': int(os.environ.get('DB_PORT', '3306')),
        'db_username': os.environ['DB_USERNAME'],
        'db_password': os.environ['DB_PASSWORD'],
        'db_name': os.environ['DB_NAME'],
    }
    if not re.fullmatch(r'[A-Za-z0-9_]+', config['db_name']):
        raise AssertionError('unsafe DB name for temporary-table self-test')
    connection = importer.db_connect(config, autocommit=False)
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                f'CREATE TEMPORARY TABLE rhythmjoy_booking_ledger '
                f'LIKE `{config["db_name"]}`.`rhythmjoy_booking_ledger`'
            )

        call_live_upsert(
            importer.upsert_booking_ledger_confirmed,
            config,
            connection,
            live_row('selftest:cancel-wins', '2098-01-01 10:00:00', 'initial-confirm'),
        )
        call_live_upsert(
            importer.upsert_booking_ledger_canceled,
            config,
            connection,
            live_row('selftest:cancel-wins', '2098-01-01 12:00:00', 'newer-cancel'),
        )
        call_live_upsert(
            importer.upsert_booking_ledger_confirmed,
            config,
            connection,
            live_row('selftest:cancel-wins', '2098-01-01 11:00:00', 'late-confirm'),
        )
        call_live_upsert(
            importer.upsert_booking_ledger_confirmed,
            config,
            connection,
            live_row('selftest:cancel-wins', '2098-01-01 12:00:00', 'same-second-confirm'),
        )
        with connection.cursor() as cursor:
            cursor.execute(
                'SELECT current_status, product, reserver_name, last_event_at '
                'FROM rhythmjoy_booking_ledger WHERE ledger_key=%s',
                ('selftest:cancel-wins',),
            )
            cancel_winner = cursor.fetchone()
        assert cancel_winner['current_status'] == 'canceled'
        assert cancel_winner['product'] == 'newer-cancel'
        assert cancel_winner['reserver_name'] == 'newer-cancel'
        assert str(cancel_winner['last_event_at']) == '2098-01-01 12:00:00'

        call_live_upsert(
            importer.upsert_booking_ledger_confirmed,
            config,
            connection,
            live_row('selftest:new-confirm-wins', '2098-02-01 10:00:00', 'old-confirm'),
        )
        call_live_upsert(
            importer.upsert_booking_ledger_confirmed,
            config,
            connection,
            live_row('selftest:new-confirm-wins', '2098-02-01 12:00:00', 'new-confirm'),
        )
        call_live_upsert(
            importer.upsert_booking_ledger_canceled,
            config,
            connection,
            live_row('selftest:new-confirm-wins', '2098-02-01 11:00:00', 'late-cancel'),
        )
        with connection.cursor() as cursor:
            cursor.execute(
                'SELECT current_status, product, reserver_name, last_event_at '
                'FROM rhythmjoy_booking_ledger WHERE ledger_key=%s',
                ('selftest:new-confirm-wins',),
            )
            confirm_winner = cursor.fetchone()
        assert confirm_winner['current_status'] == 'confirmed'
        assert confirm_winner['product'] == 'new-confirm'
        assert confirm_winner['reserver_name'] == 'new-confirm'
        assert str(confirm_winner['last_event_at']) == '2098-02-01 12:00:00'
    finally:
        connection.rollback()
        connection.close()
    print('booking ledger live temporary-table ordering self-test OK')


def assert_projection_is_event_guarded(query, event_column, comparison):
    update_sql = query.split('ON DUPLICATE KEY UPDATE', 1)[1]
    for field in PROJECTION_FIELDS:
        assert re.search(rf'\b{field}\s*=\s*IF\s*\(', update_sql), (
            f'{field} is not protected by the {event_column} ordering guard'
        )
    assert update_sql.count(f'VALUES({event_column}) {comparison} COALESCE(last_event_at') >= len(PROJECTION_FIELDS)
    assert re.search(r'\bupdated_at\s*=\s*IF\s*\(', update_sql)
    assert update_sql.rfind('last_event_at=IF') > update_sql.rfind('updated_at=IF'), (
        'last_event_at must be assigned last because MySQL evaluates assignments left-to-right'
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--live-env-file')
    args = parser.parse_args()
    confirmed_sql = capture_upsert(importer.upsert_booking_ledger_confirmed)
    assert_projection_is_event_guarded(confirmed_sql, 'confirmed_email_received_at', '>')
    assert re.search(r'\bpayload_json\s*=\s*IF\s*\(', confirmed_sql)
    assert confirmed_sql.count('VALUES(confirmed_email_received_at) > COALESCE(automation_canceled_at') >= 1

    canceled_sql = capture_upsert(importer.upsert_booking_ledger_canceled)
    assert_projection_is_event_guarded(canceled_sql, 'canceled_email_received_at', '>=')
    assert re.search(r'\bcancel_payload_json\s*=\s*IF\s*\(', canceled_sql)
    print('booking ledger event-order invariant self-test OK')
    if args.live_env_file:
        run_live_rollback_test(args.live_env_file)


if __name__ == '__main__':
    main()
