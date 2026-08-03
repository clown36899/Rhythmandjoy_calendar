#!/usr/bin/env python3
import logging
import sys
import types
import unittest
from email.message import EmailMessage
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    import pymysql  # noqa: F401
except ImportError:
    sys.modules['pymysql'] = types.SimpleNamespace()

import rhythmjoy_email_import as email_import
import rhythmjoy_reflection_audit as reflection_audit


class FakeCursor:
    rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, query, args=None):
        if isinstance(args, dict):
            query % {key: "'value'" for key in args}
        return 1

    def fetchone(self):
        return None

    def fetchall(self):
        return []


class FakeConnection:
    def __init__(self):
        self.begin_count = 0
        self.commit_count = 0
        self.rollback_count = 0
        self.close_count = 0

    def cursor(self):
        return FakeCursor()

    def begin(self):
        self.begin_count += 1

    def commit(self):
        self.commit_count += 1

    def rollback(self):
        self.rollback_count += 1

    def close(self):
        self.close_count += 1


class ExplodingCursor(FakeCursor):
    def execute(self, query, args=None):
        raise RuntimeError('injected SQL failure')


class ExplodingConnection(FakeConnection):
    def cursor(self):
        return ExplodingCursor()


class OrderedConnection(FakeConnection):
    def __init__(self, events):
        super().__init__()
        self.events = events

    def begin(self):
        super().begin()
        self.events.append('begin')

    def commit(self):
        super().commit()
        self.events.append('commit')

    def rollback(self):
        super().rollback()
        self.events.append('rollback')

    def close(self):
        super().close()
        self.events.append('close')


class FakeImap:
    def __init__(self, events):
        self.events = events

    def store(self, email_id, operation, flag):
        self.events.append('seen')


class EmailPipelineSelfTest(unittest.TestCase):
    def test_imap_fetch_does_not_mark_email_seen(self):
        self.assertIn('BODY.PEEK[]', email_import.IMAP_FETCH_QUERY)
        self.assertNotIn('RFC822', email_import.IMAP_FETCH_QUERY)

    def test_named_sql_patterns_are_valid_for_pymysql(self):
        original_connect = email_import.db_connect
        original_select = email_import.db_select_booking_ledger
        email_import.db_connect = lambda _config: FakeConnection()
        email_import.db_select_booking_ledger = lambda _config, _key, conn=None: {
            'id': 1,
            'current_status': 'confirmed',
        }
        try:
            config = {'db_enabled': True, 'db_required': True}
            event = {
                'reservation_number': '1311550497',
                'name': '테*트님',
                'product': 'B홀',
                'date': '2026-10-23',
                'start_time': '20:00',
                'end_time': '22:00',
                'payment_status': '결제완료',
                'price': '24,000원',
            }
            email_import.upsert_booking_ledger_confirmed(
                config, logging.getLogger(__name__), 1, event,
                'Bhall', '2026-08-03 14:18:09', 'naver'
            )
            email_import.upsert_booking_ledger_canceled(
                config, logging.getLogger(__name__), 2, event,
                'Bhall', '2026-08-03 14:19:09', 'naver'
            )
        finally:
            email_import.db_connect = original_connect
            email_import.db_select_booking_ledger = original_select

    def test_db_transaction_commits_once(self):
        connection = FakeConnection()
        original_connect = email_import.db_connect
        email_import.db_connect = lambda _config, autocommit=True: connection
        try:
            with email_import.db_transaction(
                {'db_enabled': True}, logging.getLogger(__name__), 'commit-test'
            ) as shared:
                self.assertIs(shared, connection)
            self.assertEqual(connection.begin_count, 1)
            self.assertEqual(connection.commit_count, 1)
            self.assertEqual(connection.rollback_count, 0)
            self.assertEqual(connection.close_count, 1)
        finally:
            email_import.db_connect = original_connect

    def test_db_transaction_rolls_back_on_handoff_failure(self):
        connection = FakeConnection()
        original_connect = email_import.db_connect
        email_import.db_connect = lambda _config, autocommit=True: connection
        try:
            with self.assertRaisesRegex(RuntimeError, 'outbox unavailable'):
                with email_import.db_transaction(
                    {'db_enabled': True}, logging.getLogger(__name__), 'rollback-test'
                ):
                    raise RuntimeError('outbox unavailable')
            self.assertEqual(connection.begin_count, 1)
            self.assertEqual(connection.commit_count, 0)
            self.assertEqual(connection.rollback_count, 1)
            self.assertEqual(connection.close_count, 1)
        finally:
            email_import.db_connect = original_connect

    def test_shared_connection_failure_propagates_without_closing(self):
        connection = ExplodingConnection()
        config = {
            'db_enabled': True,
            'db_required': False,
            'naver_spacecloud_upload_enabled': True,
        }
        event = {
            'reservation_number': 'tx-test',
            'name': '테*트님',
            'product': 'A홀',
            'date': '2026-08-10',
            'start_time': '10:00',
            'end_time': '11:00',
            'payment_status': '결제완료',
        }
        with self.assertRaisesRegex(RuntimeError, 'injected SQL failure'):
            email_import.upsert_spacecloud_upload_task(
                config,
                logging.getLogger(__name__),
                1,
                event,
                'Ahall',
                conn=connection,
            )
        self.assertTrue(config['db_enabled'])
        self.assertEqual(connection.close_count, 0)

    def test_message_is_marked_seen_only_after_atomic_handoff_commit(self):
        events = []
        connection = OrderedConnection(events)
        imap = FakeImap(events)
        event_data = {
            'reservation_number': 'tx-message',
            'name': '테*트님',
            'product': 'A홀',
            'date': '2026-08-10',
            'start_time': '10:00',
            'end_time': '11:00',
            'payment_status': '결제완료',
        }
        shared_connections = []

        def record_lock(_config, _logger, conn, _email_event_id):
            shared_connections.append(conn)
            return {'id': 7, 'processing_status': 'received'}

        def record_ledger(*args, **kwargs):
            shared_connections.append(kwargs.get('conn'))
            return {'id': 8, 'current_status': 'confirmed'}

        def record_task(*args, **kwargs):
            shared_connections.append(kwargs.get('conn'))
            return {'id': 9, 'status': 'pending'}

        def record_status(*args, **kwargs):
            shared_connections.append(kwargs.get('conn'))

        message = EmailMessage()
        message['Subject'] = '예약 테스트'
        message.set_content('body')
        config = {'db_enabled': True, 'naver_spacecloud_upload_enabled': True}
        with mock.patch.object(email_import, 'parse_reservation', return_value=event_data), \
                mock.patch.object(email_import, 'build_reservation_email_record', return_value={}), \
                mock.patch.object(email_import, 'upsert_email_event', return_value={'id': 7}), \
                mock.patch.object(email_import, 'db_connect', return_value=connection), \
                mock.patch.object(email_import, 'lock_inbox_event', side_effect=record_lock), \
                mock.patch.object(email_import, 'upsert_booking_ledger_confirmed', side_effect=record_ledger), \
                mock.patch.object(email_import, 'upsert_spacecloud_upload_task', side_effect=record_task), \
                mock.patch.object(email_import, 'update_email_processing', side_effect=record_status):
            email_import.process_message(
                config,
                lambda: None,
                imap,
                'Ahall',
                'Ahall',
                b'77',
                message.as_bytes(),
                '',
                logging.getLogger(__name__),
            )

        self.assertEqual(events, ['begin', 'commit', 'close', 'seen'])
        self.assertEqual(shared_connections, [connection] * 4)

    def test_outbox_failure_rolls_back_and_leaves_message_unseen(self):
        events = []
        connection = OrderedConnection(events)
        imap = FakeImap(events)
        event_data = {
            'reservation_number': 'tx-failure',
            'name': '테*트님',
            'product': 'A홀',
            'date': '2026-08-10',
            'start_time': '10:00',
            'end_time': '11:00',
            'payment_status': '결제완료',
        }
        status_updates = []

        def record_status(_config, _event_id, status, _logger, conn=None, **_fields):
            status_updates.append((status, conn))

        message = EmailMessage()
        message['Subject'] = '예약 실패 테스트'
        message.set_content('body')
        config = {'db_enabled': True, 'naver_spacecloud_upload_enabled': True}
        with mock.patch.object(email_import, 'parse_reservation', return_value=event_data), \
                mock.patch.object(email_import, 'build_reservation_email_record', return_value={}), \
                mock.patch.object(email_import, 'upsert_email_event', return_value={'id': 7}), \
                mock.patch.object(email_import, 'db_connect', return_value=connection), \
                mock.patch.object(email_import, 'lock_inbox_event', return_value={'id': 7}), \
                mock.patch.object(email_import, 'upsert_booking_ledger_confirmed', return_value={'id': 8}), \
                mock.patch.object(email_import, 'upsert_spacecloud_upload_task', side_effect=RuntimeError('outbox down')), \
                mock.patch.object(email_import, 'update_email_processing', side_effect=record_status):
            with self.assertRaisesRegex(RuntimeError, 'outbox down'):
                email_import.process_message(
                    config,
                    lambda: None,
                    imap,
                    'Ahall',
                    'Ahall',
                    b'78',
                    message.as_bytes(),
                    '',
                    logging.getLogger(__name__),
                )

        self.assertEqual(events, ['begin', 'rollback', 'close'])
        self.assertEqual(status_updates, [('failed', None)])

    def test_unseen_messages_sort_by_received_time_oldest_first(self):
        newer = EmailMessage()
        newer['Date'] = 'Mon, 03 Aug 2026 14:18:09 +0900'
        newer.set_content('newer')
        older = EmailMessage()
        older['Date'] = 'Mon, 03 Aug 2026 14:13:05 +0900'
        older.set_content('older')
        rows = [
            (b'1000', '', newer.as_bytes()),
            (b'993', '', older.as_bytes()),
        ]
        rows.sort(key=lambda item: email_import.unseen_message_sort_key(*item))
        self.assertEqual([row[0] for row in rows], [b'993', b'1000'])

    def test_required_handoff_fails_closed(self):
        with self.assertRaises(email_import.ConfigError):
            email_import.require_handoff(True, None, 'missing')
        self.assertIsNone(email_import.require_handoff(False, None, 'legacy mode'))

    def test_ingestion_audit_detects_front_of_pipeline_failures(self):
        base = {
            'event_type': 'reservation',
            'parse_status': 'parsed',
            'processing_status': 'calendar_after_upload_created',
            'ledger_status': 'confirmed',
            'task_status': 'done',
            'age_minutes': 60,
        }
        self.assertEqual(
            reflection_audit.ingestion_gap_reason(base, True, True, 10),
            '',
        )
        failed = dict(base, processing_status='failed', error_text='db failure')
        self.assertIn(
            '수집 단계 실패',
            reflection_audit.ingestion_gap_reason(failed, True, True, 10),
        )
        missing_ledger = dict(base, ledger_status=None)
        self.assertIn(
            'DB 원장',
            reflection_audit.ingestion_gap_reason(missing_ledger, True, True, 10),
        )
        missing_task = dict(base, task_status='')
        self.assertIn(
            '필수 상대 플랫폼 작업',
            reflection_audit.ingestion_gap_reason(missing_task, True, True, 10),
        )


if __name__ == '__main__':
    unittest.main(verbosity=2)
