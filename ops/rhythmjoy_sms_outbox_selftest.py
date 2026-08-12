#!/usr/bin/env python3
"""Focused checks for the reservation-confirmation SMS outbox invariant."""

import logging
import sys
import types
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import pymysql  # noqa: F401
except ImportError:
    sys.modules['pymysql'] = types.SimpleNamespace()

import rhythmjoy_email_import as email_import


class RecordingCursor:
    def __init__(self, selected_task=None):
        self.selected_task = selected_task
        self.statements = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, query, args=None):
        self.statements.append((' '.join(str(query).split()), args))
        return 1

    def fetchone(self):
        return self.selected_task


class RecordingConnection:
    def __init__(self, selected_task):
        self.cursor_instance = RecordingCursor(selected_task)

    def cursor(self):
        return self.cursor_instance


class SmsOutboxInvariantTests(unittest.TestCase):
    def test_pending_upload_writes_durable_intent(self):
        cursor = RecordingCursor()
        key = email_import.ensure_confirmation_sms_intent(
            cursor,
            {'id': 41, 'task_type': 'upload', 'status': 'pending'},
        )
        self.assertEqual(key, 'reservation-confirmed-v1|upload|41')
        self.assertEqual(len(cursor.statements), 1)
        self.assertIn('INSERT IGNORE INTO rhythmjoy_sms_deliveries', cursor.statements[0][0])
        self.assertEqual(cursor.statements[0][1], (key, 'upload', 41))

    def test_intent_is_not_created_for_delete_completed_or_disabled_task(self):
        cursor = RecordingCursor()
        self.assertIsNone(email_import.ensure_confirmation_sms_intent(
            cursor, {'id': 1, 'task_type': 'delete', 'status': 'pending'}
        ))
        self.assertIsNone(email_import.ensure_confirmation_sms_intent(
            cursor, {'id': 2, 'task_type': 'upload', 'status': 'done'}
        ))
        self.assertIsNone(email_import.ensure_confirmation_sms_intent(
            cursor, {'id': 3, 'task_type': 'naver_block', 'status': 'pending'}, enabled=False
        ))
        self.assertEqual(cursor.statements, [])

    def test_upload_task_and_intent_use_the_same_connection(self):
        task = {'id': 77, 'task_type': 'upload', 'status': 'pending'}
        conn = RecordingConnection(task)
        config = {
            'db_enabled': True,
            'naver_spacecloud_upload_enabled': True,
            'confirmation_sms_enabled': True,
        }
        result = email_import.upsert_spacecloud_upload_task(
            config,
            logging.getLogger('sms-outbox-selftest'),
            1001,
            {
                'reservation_number': 'R-1001',
                'name': '테스트',
                'product': 'C홀',
                'date': '2026-09-01',
                'start_time': '10:00',
                'end_time': '12:00',
                'payment_status': '결제완료',
            },
            'Chall',
            conn=conn,
        )
        self.assertEqual(result, task)
        sql = [statement for statement, _ in conn.cursor_instance.statements]
        self.assertIn('confirmation_sms_required', sql[0])
        self.assertIn('INSERT IGNORE INTO rhythmjoy_sms_deliveries', sql[-1])

    def test_watcher_contains_independent_outbox_reconciliation(self):
        watcher = (Path(__file__).resolve().parents[1] / 'tools' / 'spacecloud-watch.mjs').read_text(encoding='utf-8')
        self.assertIn("WHERE t.confirmation_sms_required=1", watcher)
        self.assertIn("CONCAT('reservation-confirmed-v1|', t.task_type, '|', t.id)", watcher)
        self.assertIn("d.status IN ('pending','phone_lookup_failed','failed')", watcher)


if __name__ == '__main__':
    unittest.main()
