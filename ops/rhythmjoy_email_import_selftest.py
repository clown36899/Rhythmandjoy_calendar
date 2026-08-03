#!/usr/bin/env python3
import logging
import sys
import types
import unittest
from email.message import EmailMessage
from pathlib import Path

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
    def cursor(self):
        return FakeCursor()

    def close(self):
        return None


class EmailPipelineSelfTest(unittest.TestCase):
    def test_named_sql_patterns_are_valid_for_pymysql(self):
        original_connect = email_import.db_connect
        original_select = email_import.db_select_booking_ledger
        email_import.db_connect = lambda _config: FakeConnection()
        email_import.db_select_booking_ledger = lambda _config, _key: {
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
