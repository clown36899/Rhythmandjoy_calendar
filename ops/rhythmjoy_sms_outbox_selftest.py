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
        # The producer first checks whether this email event already owns a
        # task, then reads the row written by the INSERT.  Model both reads so
        # the immutable-replay guard is exercised against a real pre-existing
        # row only, not against the row that this test expects to be inserted.
        self.fetchone_responses = (
            [None, selected_task] if selected_task is not None else []
        )
        self.statements = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, query, args=None):
        self.statements.append((' '.join(str(query).split()), args))
        return 1

    def fetchone(self):
        if self.fetchone_responses:
            return self.fetchone_responses.pop(0)
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
        task_writes = [
            statement for statement in sql
            if 'INSERT INTO rhythmjoy_spacecloud_tasks' in statement
        ]
        self.assertEqual(len(task_writes), 1)
        self.assertIn('confirmation_sms_required', task_writes[0])
        self.assertIn('INSERT IGNORE INTO rhythmjoy_sms_deliveries', sql[-1])

    def test_watcher_contains_independent_outbox_reconciliation(self):
        watcher = (Path(__file__).resolve().parents[1] / 'tools' / 'spacecloud-watch.mjs').read_text(encoding='utf-8')
        function_start = watcher.index('async function fetchRemoteSmsPhoneLookupFollowUps')
        function_end = watcher.index('async function runSmsPhoneLookupFollowUps', function_start)
        follow_up_source = watcher[function_start:function_end]
        reconciliation_start = follow_up_source.index('# Double-check the transactional outbox invariant')
        reconciliation_end = follow_up_source.index('conn.commit()', reconciliation_start)
        reconciliation_source = follow_up_source[reconciliation_start:reconciliation_end]

        self.assertIn("WHERE t.confirmation_sms_required=1", reconciliation_source)
        self.assertIn("CONCAT('reservation-confirmed-v1|', t.task_type, '|', t.id)", reconciliation_source)
        self.assertIn('missing_sms_intents = cur.fetchall()', reconciliation_source)
        self.assertIn('for task in missing_sms_intents:', reconciliation_source)
        self.assertLess(
            reconciliation_source.index('SELECT t.id AS taskId'),
            reconciliation_source.index('INSERT IGNORE INTO rhythmjoy_sms_deliveries'),
        )
        self.assertIn(
            "VALUES (%s,%s,%s,'reservation-confirmed-v1'",
            reconciliation_source,
        )
        self.assertNotIn(
            "SELECT\n              CONCAT('reservation-confirmed-v1|'",
            reconciliation_source,
        )
        task_clear = follow_up_source.index(
            "UPDATE rhythmjoy_spacecloud_tasks SET confirmation_sms_required=0"
        )
        delivery_skip = follow_up_source.index(
            "SET status='skipped', error_text='reservation no longer confirmed"
        )
        self.assertLess(task_clear, delivery_skip)
        self.assertIn(
            "d.status IN ('pending','phone_lookup_failed','failed','uncertain')",
            follow_up_source,
        )
        self.assertIn('provider-result-uncertain-no-auto-resend', watcher)


if __name__ == '__main__':
    unittest.main()
