#!/usr/bin/env python3
"""Focused checks for the reservation-confirmation SMS outbox invariant."""

import logging
import hashlib
import base64
import contextlib
import io
import json
import os
import re
import sys
import tempfile
import types
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch


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
            "error_text='reservation no longer confirmed"
        )
        self.assertLess(task_clear, delivery_skip)
        self.assertIn(
            "d.status IN ('pending','phone_lookup_failed','failed','uncertain')",
            follow_up_source,
        )
        self.assertIn('provider-result-uncertain-no-auto-resend', watcher)

    def test_admin_generation_guard_and_recipient_boundaries(self):
        watcher = (Path(__file__).resolve().parents[1] / 'tools' / 'spacecloud-watch.mjs').read_text(encoding='utf-8')
        guard_source = watcher.split('def lock_confirmation_generation(cur):', 1)[1].split('\ndb_config = dict(', 1)[0]
        phone = '01012345678'
        phone_hash = hashlib.sha256(phone.encode()).hexdigest()
        reservation = dict(id=71, status='confirmed', not_ended=1, reservation_date='2099-09-18', room_key='A', start_hour=0, end_hour=6, phone_hash=phone_hash)
        payload = dict(source='admin-panel', admin_reservation_id=71, admin_action_generation='admin-reservation:71:registration')
        upload = dict(id=81, task_type='upload', status='done', side_effect_state='finalized', booking_ledger_id=91,
                      ledger_status='confirmed', ledger_mode='admin-task-anchor', room_key='a', reservation_date='2099-09-18',
                      start_time=timedelta(), end_time=timedelta(hours=6), reservation_number='ADMIN-71',
                      payload_json=json.dumps(payload), result_text=json.dumps({'status': 'submitted'}))
        block = dict(upload, id=82, task_type='naver_block', result_text=json.dumps({'status': 'blocked'}))
        delivery = dict(status='pending', recipient_phone=phone, recipient_phone_hash=phone_hash, recipient_phone_last4='5678')

        class GuardCursor:
            def __init__(self, admin, linked, sms):
                self.admin, self.linked, self.sms = admin, linked, sms
                self.row = None

            def execute(self, query, args=None):
                if 'FROM rhythmjoy_admin_reservations' in query:
                    self.row = self.admin
                elif 'FROM rhythmjoy_admin_sync_tasks' in query:
                    self.row = self.linked
                elif 'FROM rhythmjoy_sms_deliveries' in query:
                    self.row = self.sms
                elif 'FROM rhythmjoy_spacecloud_tasks' in query:
                    self.row = upload
                else:
                    raise AssertionError(query)

            def fetchone(self):
                return self.row

            def fetchall(self):
                return self.row

        namespace = dict(task_id=81, task_type='upload', template_name='reservation-confirmed-v1',
                         idempotency_key='reservation-confirmed-v1|upload|81', hashlib=hashlib, re=re,
                         timedelta=timedelta, parse_result=lambda value: json.loads(value or '{}'))
        exec('def lock_confirmation_generation(cur):' + guard_source, namespace)

        def check(admin=None, linked=None, sms=None):
            return namespace['lock_confirmation_generation'](GuardCursor(
                reservation if admin is None else admin,
                [upload, block] if linked is None else linked,
                delivery if sms is None else sms,
            ))

        self.assertEqual(check()['recipientPhone'], phone)
        for status in ('pending', 'needs_review'):
            with self.subTest(status=status):
                result = check(admin=dict(reservation, status=status))
                self.assertFalse(result['approved'])
                self.assertTrue(result['retryable'])
        for status in ('canceling', 'canceled'):
            with self.subTest(status=status):
                self.assertFalse(check(admin=dict(reservation, status=status))['approved'])
        self.assertFalse(check(admin=dict(reservation, not_ended=0))['approved'])
        self.assertFalse(check(linked=[upload])['approved'])
        self.assertTrue(check(linked=[upload, dict(block, status='failed')])['retryable'])
        for changes in ({'reservation_number': 'ADMIN-72'}, {'room_key': 'b'}, {'ledger_status': 'canceled'},
                        {'end_time': timedelta(hours=18)}, {'id': 999},
                        {'payload_json': json.dumps(dict(payload, admin_action_generation='admin-reservation:72:registration'))}):
            with self.subTest(changes=changes):
                self.assertFalse(check(linked=[dict(upload, **changes), block])['approved'])
        for changes in ({'recipient_phone': ''}, {'recipient_phone': '01099999999'}, {'recipient_phone_hash': 'wrong'}):
            with self.subTest(changes=changes):
                self.assertFalse(check(sms=dict(delivery, **changes))['approved'])
        # A previously sent or uncertain row is left to the existing durable
        # claim logic, which must not call the provider again after phone erasure.
        for status in ('sent', 'sending', 'uncertain'):
            self.assertTrue(check(sms=dict(delivery, status=status, recipient_phone=''))['approved'])
        self.assertTrue(check(admin=dict(reservation, end_hour=24), linked=[
            dict(upload, end_time=timedelta(hours=24)), dict(block, end_time=timedelta(hours=24)),
        ])['approved'])

    def test_admin_sender_reuses_durable_claim_and_erases_terminal_recipient(self):
        import aligo_sms
        watcher = (Path(__file__).resolve().parents[1] / 'tools' / 'spacecloud-watch.mjs').read_text(encoding='utf-8')
        sender = watcher.split('async function sendRemoteSms(', 1)[1].split('async function recordRemoteSmsPhoneLookupFailure', 1)[0]
        script = sender.split("<<'PY'\n", 1)[1].rsplit('\nPY\n', 1)[0]
        # The real generation guard is exercised above; isolate provider/claim
        # boundaries here so this test can never reach a database or send SMS.
        script = script.replace('confirmation_guard = lock_confirmation_generation(cur)', 'confirmation_guard = guard_override(cur)')
        phone = '01012345678'

        class Cursor:
            def __init__(self, state):
                self.state, self.rowcount, self.row = state, 0, None

            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def execute(self, query, args=None):
                query = ' '.join(query.split())
                if args is not None:
                    assert query.count('%s') == len(args), (query, args)
                self.rowcount = 0
                if query.startswith('SHOW COLUMNS'):
                    self.row = {'Field': 'present'}
                elif query.startswith('SELECT'):
                    self.row = dict(self.state)
                elif query.startswith('UPDATE rhythmjoy_sms_deliveries SET status=\'sending\''):
                    if self.state['status'] in ('pending', 'failed', 'phone_lookup_failed'):
                        self.state.update(status='sending', attempt_count=self.state['attempt_count'] + 1)
                        self.rowcount = 1
                elif query.startswith('UPDATE rhythmjoy_sms_deliveries SET status=%s'):
                    self.state.update(status=args[0], provider_code=args[2])
                    if args[1] == 'sent':
                        self.state['recipient_phone'] = ''
                elif query.startswith("UPDATE rhythmjoy_sms_deliveries SET status='uncertain'"):
                    self.state.update(status='uncertain', recipient_phone='')
                elif query.startswith(('CREATE TABLE', 'INSERT IGNORE', 'UPDATE rhythmjoy_spacecloud_tasks')):
                    pass
                else:
                    raise AssertionError(query)

            def fetchone(self):
                return self.row

        class Connection:
            def __init__(self, state):
                self.state = state

            def cursor(self):
                return Cursor(self.state)

            def commit(self):
                pass

            def rollback(self):
                pass

            def close(self):
                pass

        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / '.env'
            env_file.write_text('')
            environment = dict(RHYTHMJOY_ENV_FILE=str(env_file), RHYTHMJOY_OPS_ROOT=str(Path(__file__).parent),
                               DB_SERVERNAME='test', DB_USERNAME='test', DB_PASSWORD='test', DB_NAME='test',
                               SMS_PAYLOAD_B64=base64.b64encode(json.dumps(dict(taskId=81, taskType='upload',
                                   templateName='reservation-confirmed-v1', to='', message='test')).encode()).decode())
            for outcome in ('sent', 'failed', 'uncertain'):
                state = dict(id=1, status='pending', attempt_count=0, recipient_phone=phone, provider_code='', next_retry_at=None)
                calls = []

                def provider(to, message, **kwargs):
                    self.assertEqual(to, phone)
                    self.assertTrue(kwargs['real'])
                    calls.append(to)
                    if outcome == 'uncertain':
                        raise TimeoutError('ambiguous provider response')
                    return dict(ok=outcome == 'sent', code='1' if outcome == 'sent' else '-1', raw='test')

                fake_mysql = types.SimpleNamespace(connect=lambda **kwargs: Connection(state), cursors=types.SimpleNamespace(DictCursor=object))
                with patch.dict(os.environ, environment), patch.dict(sys.modules, {'pymysql': fake_mysql}), patch.object(aligo_sms, 'send_sms', provider):
                    for attempt in range(2):
                        namespace = {'guard_override': lambda cur: dict(approved=True, recipientPhone=state['recipient_phone'])}
                        output = io.StringIO()
                        with contextlib.redirect_stdout(output):
                            try:
                                exec(script, namespace)
                            except SystemExit as error:
                                self.assertEqual(error.code, 0)
                        self.assertNotIn(phone, output.getvalue())
                self.assertEqual(len(calls), 2 if outcome == 'failed' else 1)
                self.assertEqual(state['status'], outcome)
                self.assertEqual(state['recipient_phone'], phone if outcome == 'failed' else '')


if __name__ == '__main__':
    unittest.main()
