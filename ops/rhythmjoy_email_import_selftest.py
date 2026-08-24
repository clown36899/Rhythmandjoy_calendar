#!/usr/bin/env python3
import ast
import inspect
import logging
import json
import re
import sys
import tempfile
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
import rhythmjoy_calendar_cache as calendar_cache
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
        elif isinstance(args, (tuple, list)):
            query % tuple("'value'" for _ in args)
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
    def test_platform_ledger_identity_keeps_naver_number_and_splits_spacecloud_generations(self):
        naver = {
            'reservation_number': '1289402981',
            'name': '황*연님',
            'date': '2026-09-04',
            'start_time': '20:00',
            'end_time': '22:00',
        }
        self.assertEqual(
            email_import.booking_ledger_key('naver', naver, 'Bhall'),
            email_import.booking_ledger_key(
                'naver', naver, 'Bhall', email_event_id=901
            ),
        )

        spacecloud_without_id = {
            **naver,
            'reservation_number': '',
            'source_mode': 'spacecloud_email',
        }
        first_generation = email_import.booking_ledger_key(
            'spacecloud', spacecloud_without_id, 'Bhall', email_event_id=901
        )
        second_generation = email_import.booking_ledger_key(
            'spacecloud', spacecloud_without_id, 'Bhall', email_event_id=902
        )
        self.assertNotEqual(first_generation, second_generation)

        with_internal_id = {
            **spacecloud_without_id,
            'spacecloud_reservation_id': 'SC-1289402981',
        }
        self.assertEqual(
            email_import.booking_ledger_key(
                'spacecloud', with_internal_id, 'Bhall', email_event_id=901
            ),
            email_import.booking_ledger_key(
                'spacecloud', with_internal_id, 'Bhall', email_event_id=999
            ),
        )
        self.assertEqual(
            email_import.booking_ledger_key(
                'spacecloud', with_internal_id, 'Bhall', email_event_id=901
            ),
            email_import.booking_ledger_key(
                'spacecloud',
                {**with_internal_id, 'start_time': '21:00', 'end_time': '23:00'},
                'Bhall',
                email_event_id=999,
            ),
        )
        self.assertNotEqual(
            email_import.booking_ledger_key(
                'spacecloud', with_internal_id, 'Bhall', email_event_id=901
            ),
            email_import.booking_ledger_key(
                'spacecloud', {**with_internal_id, 'name': '다른예약자님'},
                'Bhall', email_event_id=901,
            ),
        )
        self.assertNotEqual(
            email_import.booking_ledger_key(
                'spacecloud', with_internal_id, 'Bhall', email_event_id=901
            ),
            email_import.booking_ledger_key(
                'spacecloud', {**with_internal_id, 'date': '2026-09-05'},
                'Bhall', email_event_id=901,
            ),
        )
        self.assertNotEqual(
            email_import.booking_ledger_key(
                'spacecloud', with_internal_id, 'Bhall', email_event_id=901
            ),
            email_import.booking_ledger_key(
                'spacecloud', with_internal_id, 'Ahall', email_event_id=901
            ),
        )
        self.assertEqual(
            email_import.booking_ledger_key(
                'spacecloud', spacecloud_without_id, 'Bhall',
                email_event_id=901,
                preserve_legacy_spacecloud_identity=True,
            ),
            email_import.legacy_spacecloud_ledger_key(
                spacecloud_without_id, 'Bhall'
            ),
        )

    def test_spacecloud_cancellation_uses_only_one_strict_prior_generation(self):
        class MatchCursor:
            def __init__(self, ledger_candidates, prior_events=None):
                self.results = [ledger_candidates, prior_events or []]
                self.queries = []

            def execute(self, query, params=None):
                self.queries.append((' '.join(str(query).split()), params))

            def fetchall(self):
                return self.results.pop(0)

        cancellation = {
            'source_platform': 'spacecloud',
            'source_mode': 'spacecloud_cancel_email',
            'cancellation_status': '취소완료',
            'name': '황*연님',
            'date': '2026-09-04',
            'start_time': '20:00',
            'end_time': '22:00',
        }
        candidate = {
            'id': 77,
            'ledger_key': 'spacecloud|' + ('a' * 64),
            'confirmed_email_event_id': 701,
            'confirmed_event_order_key': 1_000,
            'confirmed_email_received_at': '2026-08-20 10:00:00',
        }
        matched = email_import.match_spacecloud_cancellation_generation(
            MatchCursor([candidate]),
            cancellation,
            'Bhall',
            2_000,
        )
        self.assertEqual(matched['spacecloud_match_status'], 'matched-active-generation')
        self.assertEqual(matched['matched_booking_ledger_id'], 77)
        self.assertEqual(matched['matched_reservation_email_event_id'], 701)

        collision = email_import.match_spacecloud_cancellation_generation(
            MatchCursor([{**candidate, 'confirmed_event_order_key': 2_000}]),
            cancellation,
            'Bhall',
            2_000,
        )
        self.assertEqual(
            collision['spacecloud_match_status'],
            'opposing-event-order-collision',
        )
        self.assertNotIn('matched_booking_ledger_id', collision)

        same_received_second = email_import.received_at_epoch_ms(
            '2026-08-20 10:00:00'
        )
        fallback_collision = email_import.match_spacecloud_cancellation_generation(
            MatchCursor([{
                **candidate,
                'confirmed_event_order_key': None,
                'confirmed_email_received_at': '2026-08-20 10:00:00',
            }]),
            cancellation,
            'Bhall',
            same_received_second,
        )
        self.assertEqual(
            fallback_collision['spacecloud_match_status'],
            'opposing-event-order-collision',
        )

        unverifiable = email_import.match_spacecloud_cancellation_generation(
            MatchCursor([{
                **candidate,
                'confirmed_email_event_id': None,
                'confirmed_event_order_key': None,
            }]),
            cancellation,
            'Bhall',
            2_000,
        )
        self.assertEqual(
            unverifiable['spacecloud_match_status'],
            'candidate-order-unverifiable',
        )
        self.assertNotIn('matched_booking_ledger_id', unverifiable)

        ambiguous = email_import.match_spacecloud_cancellation_generation(
            MatchCursor([
                candidate,
                {
                    **candidate,
                    'id': 78,
                    'ledger_key': 'spacecloud|' + ('b' * 64),
                    'confirmed_email_event_id': 702,
                    'confirmed_event_order_key': 1_500,
                },
            ]),
            cancellation,
            'Bhall',
            2_000,
        )
        self.assertEqual(
            ambiguous['spacecloud_match_status'],
            'ambiguous-prior-generation',
        )
        self.assertNotIn('matched_booking_ledger_id', ambiguous)

    def test_spacecloud_cancellation_without_active_ledger_is_diagnostic_only(self):
        class EventOnlyCursor:
            def __init__(self):
                self.call = 0

            def execute(self, query, params=None):
                self.call += 1

            def fetchall(self):
                if self.call == 1:
                    return []
                return [{
                    'id': 701,
                    'event_order_key': 1_000,
                    'email_received_at': '2026-08-20 10:00:00',
                    'reserver_name': '황*연님',
                }]

        result = email_import.match_spacecloud_cancellation_generation(
            EventOnlyCursor(),
            {
                'name': '황*연님',
                'date': '2026-09-04',
                'start_time': '20:00',
                'end_time': '22:00',
            },
            'Bhall',
            2_000,
        )
        self.assertEqual(
            result['spacecloud_match_status'],
            'prior-event-without-active-ledger',
        )
        self.assertEqual(result['matched_reservation_email_event_id'], 701)
        self.assertNotIn('matched_booking_ledger_id', result)

    def test_spacecloud_cancellation_upsert_has_no_second_broad_identity_update(self):
        source = inspect.getsource(email_import.upsert_booking_ledger_canceled)
        self.assertNotIn('id <> LAST_INSERT_ID()', source)
        self.assertNotIn("AND target_calendar=%s\n                      AND room_key=%s", source)
        self.assertIn("event_data.get('matched_booking_ledger_id')", source)

    def test_spacecloud_cancellation_replay_ignores_only_db_match_evidence(self):
        core = {
            'source_platform': 'spacecloud',
            'source_mode': 'spacecloud_cancel_email',
            'cancellation_status': '취소완료',
            'name': '황*연님',
            'product': 'B홀',
            'date': '2026-09-04',
            'start_time': '20:00',
            'end_time': '22:00',
        }
        existing = {
            'event_type': 'spacecloud_cancellation',
            'parsed_json': json.dumps({
                **core,
                'spacecloud_match_status': 'matched-active-generation',
                'matched_booking_ledger_id': 77,
            }),
        }
        incoming = {
            'parsed_json': json.dumps({
                **core,
                'spacecloud_match_status': 'no-prior-active-generation',
            }),
        }
        self.assertTrue(
            email_import.parsed_email_replay_identity_matches(existing, incoming)
        )
        incoming['parsed_json'] = json.dumps({**core, 'date': '2026-09-05'})
        self.assertFalse(
            email_import.parsed_email_replay_identity_matches(existing, incoming)
        )

    def test_unmatched_spacecloud_restore_is_persisted_for_review_not_execution(self):
        class TaskCursor:
            def __init__(self):
                self.insert = None

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def execute(self, query, params=None):
                if 'INSERT INTO rhythmjoy_spacecloud_tasks' in str(query):
                    self.insert = dict(params)

            def fetchone(self):
                return {
                    'id': 88,
                    'status': self.insert['initial_status'],
                    'booking_ledger_id': self.insert['booking_ledger_id'],
                }

        class TaskConnection:
            def __init__(self):
                self.capture = TaskCursor()

            def cursor(self):
                return self.capture

        connection = TaskConnection()
        task = email_import.upsert_spacecloud_naver_restore_task(
            {
                'db_enabled': True,
                'spacecloud_naver_block_enabled': True,
            },
            logging.getLogger(__name__),
            902,
            {
                'source_mode': 'spacecloud_cancel_email',
                'spacecloud_match_status': 'ambiguous-prior-generation',
                'name': '황*연님',
                'product': 'B홀',
                'date': '2026-09-04',
                'start_time': '20:00',
                'end_time': '22:00',
            },
            'Bhall',
            conn=connection,
            booking_ledger_id=99,
        )
        self.assertEqual(task['status'], 'needs_review')
        self.assertEqual(connection.capture.insert['initial_status'], 'needs_review')
        self.assertIn(
            'spacecloud-cancellation-ambiguous-prior-generation',
            connection.capture.insert['result_text'],
        )

        matched_connection = TaskConnection()
        matched_task = email_import.upsert_spacecloud_naver_restore_task(
            {
                'db_enabled': True,
                'spacecloud_naver_block_enabled': True,
            },
            logging.getLogger(__name__),
            903,
            {
                'source_mode': 'spacecloud_cancel_email',
                'spacecloud_match_status': 'matched-active-generation',
                'matched_booking_ledger_id': 77,
                'name': '황*연님',
                'product': 'B홀',
                'date': '2026-09-04',
                'start_time': '20:00',
                'end_time': '22:00',
            },
            'Bhall',
            conn=matched_connection,
            booking_ledger_id=77,
        )
        self.assertEqual(matched_task['status'], 'pending')
        self.assertEqual(matched_connection.capture.insert['booking_ledger_id'], 77)
        self.assertEqual(matched_connection.capture.insert['result_text'], '')

        matched_key = 'spacecloud|' + ('c' * 64)
        self.assertEqual(
            email_import.booking_ledger_key(
                'spacecloud',
                {
                    'source_mode': 'spacecloud_cancel_email',
                    'matched_booking_ledger_key': matched_key,
                    'name': '황*연님',
                    'date': '2026-09-04',
                    'start_time': '20:00',
                    'end_time': '22:00',
                },
                'Bhall',
                email_event_id=902,
            ),
            matched_key,
        )

    def test_calendar_cache_uses_confirmed_db_ledger_as_source(self):
        confirmed = {
            'id': 9140,
            'source_platform': 'naver',
            'current_status': 'confirmed',
            'reservation_number': '1317110201',
            'reserver_name': '김*진님',
            'room_key': 'c',
            'reservation_date': '2026-08-09',
            'start_time': '13:00:00',
            'end_time': '17:00:00',
            'updated_at': '2026-08-08 19:13:16',
        }
        events, meta = calendar_cache.build_db_calendar_events([confirmed])
        self.assertEqual(meta['confirmedCount'], 1)
        self.assertEqual(meta['publishedCount'], 1)
        self.assertEqual(events[0]['id'], 'ledger:9140')
        self.assertEqual(events[0]['extendedProps']['recordSource'], 'db-ledger')

    def test_calendar_cache_suppresses_google_event_for_canceled_ledger(self):
        canceled = {
            'id': 1,
            'source_platform': 'naver',
            'current_status': 'canceled',
            'reservation_number': '1310000001',
            'room_key': 'b',
            'reservation_date': '2026-08-09',
            'start_time': '14:00:00',
            'end_time': '16:00:00',
        }
        events, meta = calendar_cache.build_db_calendar_events([canceled])
        self.assertEqual(events, [])
        self.assertEqual(meta['publishedCount'], 0)

    def test_reflection_audit_only_sends_when_issue_state_changes(self):
        result = {
            'checked': 10,
            'okCount': 9,
            'waitingCount': 0,
            'issueCount': 1,
            'duplicateCount': 0,
            'calendarMismatchCount': 0,
            'latestIssues': [{
                'sourcePlatform': 'naver',
                'targetPlatform': 'spacecloud',
                'date': '2026-08-10',
                'roomKey': 'E',
                'startTime': '19:00',
                'endTime': '20:00',
                'taskType': 'upload',
                'taskId': 515,
                'reason': '반영 작업 needs_review',
            }],
        }
        logger = logging.getLogger(__name__)

        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = str(Path(temp_dir) / 'reflection-audit-state.json')
            with mock.patch.object(
                reflection_audit, 'send_telegram', return_value={'sent': True, 'messageId': 1}
            ) as send, mock.patch.dict(
                reflection_audit.os.environ,
                {'RHYTHMJOY_REFLECTION_AUDIT_NOTIFY_COOLDOWN_SECONDS': '3600'},
            ):
                with mock.patch.object(reflection_audit.time, 'time', return_value=1000):
                    first = reflection_audit.notify_if_needed(result, state_path, logger)
                with mock.patch.object(reflection_audit.time, 'time', return_value=1300):
                    second = reflection_audit.notify_if_needed(result, state_path, logger)
                with mock.patch.object(reflection_audit.time, 'time', return_value=1600):
                    third = reflection_audit.notify_if_needed(result, state_path, logger)
                with mock.patch.object(reflection_audit.time, 'time', return_value=4601):
                    unchanged_later = reflection_audit.notify_if_needed(result, state_path, logger)

            self.assertTrue(first['sent'])
            self.assertEqual(second, {'sent': False, 'reason': 'state_unchanged'})
            self.assertEqual(third, {'sent': False, 'reason': 'state_unchanged'})
            self.assertEqual(unchanged_later, {'sent': False, 'reason': 'state_unchanged'})
            self.assertEqual(send.call_count, 1)
            state = json.loads(Path(state_path).read_text(encoding='utf-8'))
            self.assertEqual(state['lastSentAtEpoch'], 1000)

    def test_imap_fetch_does_not_mark_email_seen(self):
        self.assertIn('BODY.PEEK[]', email_import.IMAP_FETCH_QUERY)
        self.assertNotIn('RFC822', email_import.IMAP_FETCH_QUERY)

    def test_parameterized_sql_escapes_literal_percent(self):
        source_path = Path(email_import.__file__)
        tree = ast.parse(source_path.read_text(encoding='utf-8'))
        violations = []
        for node in ast.walk(tree):
            if not (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and node.func.attr == 'execute'
                    and len(node.args) >= 2
            ):
                continue
            query_node = node.args[0]
            literal_parts = []
            if isinstance(query_node, ast.Constant) and isinstance(
                    query_node.value, str
            ):
                literal_parts.append(query_node.value)
            elif isinstance(query_node, ast.JoinedStr):
                literal_parts.extend(
                    value.value
                    for value in query_node.values
                    if isinstance(value, ast.Constant)
                    and isinstance(value.value, str)
                )
            if any(
                    re.search(r'(?<!%)%(?!%|s|\()', part)
                    for part in literal_parts
            ):
                violations.append(node.lineno)
        self.assertEqual(violations, [])

    def test_legacy_manual_cancellation_requires_full_terminal_proof(self):
        event_received_at = '2026-08-03 13:15:15'
        event_order_key = email_import.normalized_event_order_key(
            '', event_received_at
        )
        payload = {
            'source': 'manual-user-cancellation',
            'source_mode': 'manual-user-cancellation',
            'manual_confirmed_by_user': True,
            'action': 'cancel-and-remove-reflections',
            'calendarKey': 'Ahall',
            'calendar_key': 'Ahall',
            'target_calendar': 'Ahall',
            'roomKey': 'a',
            'room_key': 'a',
            'reservation_number': '1101011441',
            'name': '테스트',
            'product': 'A홀',
            'date': '2026-08-06',
            'start_time': '20:00',
            'end_time': '22:00',
        }
        result = {
            'taskId': 404,
            'roomKey': 'a',
            'date': '2026-08-06',
            'startTime': '20:00',
            'endTime': '22:00',
            'reserverName': '테스트',
            'reservationNo': '1101011441',
            'deleteCandidateAttempts': [{'status': 'verified'}],
            'deleteVerification': {
                'ok': True,
                'identity': {
                    'mode': 'reservation-number',
                    'nameMatched': True,
                    'reservationNoMatched': True,
                    'reservationNo': '1101011441',
                },
            },
            'remainingSearch': {'candidates': []},
            'googleCalendar': {'status': 'deleted'},
            'status': 'deleted',
            'spacecloudStatus': 'deleted',
            'dbStatus': 'done',
        }
        row = {
            'ledger_id': 123,
            'ledger_source_platform': 'naver',
            'ledger_current_status': 'canceled',
            'ledger_reservation_number': '1101011441',
            'ledger_room_key': 'a',
            'ledger_reserver_name': '테스트',
            'ledger_reservation_date': '2026-08-06',
            'ledger_start_time': '20:00:00',
            'ledger_end_time': '22:00:00',
            'ledger_canceled_email_event_id': 418,
            'ledger_canceled_email_received_at': event_received_at,
            'ledger_last_event_at': event_received_at,
            'ledger_last_event_id': 418,
            'ledger_last_event_order_key': event_order_key,
            'ledger_automation_canceled_at': None,
            'ledger_automation_canceled_order_key': None,
            'ledger_automation_cancel_task_id': None,
            'ledger_automation_cancel_platform': '',
            'ledger_cancel_payload_json': json.dumps(payload),
            'event_id': 418,
            'event_mail_key': (
                'manual-cancel|naver|1101011441|2026-08-06|20:00|22:00'
            ),
            'event_mailbox': 'Manual',
            'event_imap_id': '',
            'event_message_id': '',
            'event_received_at': event_received_at,
            'event_order_key': event_order_key,
            'event_order_trusted': 0,
            'event_type': 'cancellation',
            'event_parse_status': 'parsed',
            'event_processing_status': 'calendar_after_delete_done',
            'event_room_key': 'a',
            'event_reservation_number': '1101011441',
            'event_reserver_name': '테스트',
            'event_reservation_date': '2026-08-06',
            'event_start_time': '20:00:00',
            'event_end_time': '22:00:00',
            'event_error_text': '',
            'event_parsed_json': json.dumps(payload),
            'task_id': 404,
            'task_email_event_id': 418,
            'task_booking_ledger_id': None,
            'task_type': 'delete',
            'task_status': 'done',
            'task_room_key': 'a',
            'task_reservation_number': '1101011441',
            'task_reserver_name': '테스트',
            'task_reservation_date': '2026-08-06',
            'task_start_time': '20:00:00',
            'task_end_time': '22:00:00',
            'task_attempts': 1,
            'task_claim_token': '',
            'task_side_effect_state': None,
            'task_side_effect_token': '',
            'task_processed_at': '2026-08-03 13:15:37',
            'task_payload_json': json.dumps(payload),
            'task_result_text': json.dumps(result),
            'later_trusted_event_count': 0,
        }
        self.assertTrue(
            email_import.legacy_manual_naver_terminal_delete_proof(row)
        )

        unsafe = dict(row)
        unsafe['task_result_text'] = json.dumps({
            **result,
            'remainingSearch': {'candidates': [{'id': 'still-present'}]},
        })
        self.assertFalse(
            email_import.legacy_manual_naver_terminal_delete_proof(unsafe)
        )

        untrusted_identity = dict(row)
        untrusted_identity['task_reservation_number'] = 'different-generation'
        self.assertFalse(
            email_import.legacy_manual_naver_terminal_delete_proof(
                untrusted_identity
            )
        )

        normalized_with_later_event = dict(row)
        normalized_with_later_event.update({
            'task_booking_ledger_id': 123,
            'task_side_effect_state': 'finalized',
            'task_side_effect_finalized_at': '2026-08-03 13:15:37',
            'ledger_automation_canceled_at': event_received_at,
            'ledger_automation_cancel_task_id': 404,
            'ledger_automation_cancel_platform': 'naver',
            'ledger_last_event_id': None,
            'ledger_last_event_order_key': None,
            'later_trusted_event_count': 1,
        })
        self.assertFalse(
            email_import.legacy_manual_naver_terminal_delete_proof(
                normalized_with_later_event
            )
        )
        self.assertTrue(
            email_import.legacy_manual_naver_terminal_delete_proof(
                normalized_with_later_event,
                allow_later_trusted_events=True,
            )
        )

    def test_startup_migration_is_additive_and_does_not_replay_history(self):
        source = inspect.getsource(email_import.ensure_db_tables)
        task_name_key = (
            "ensure_db_column(cursor, 'rhythmjoy_spacecloud_tasks', "
            "'reserver_name_key'"
        )
        self.assertIn(task_name_key, source)
        ordered_steps = (
            task_name_key,
            'backfill_email_event_order_keys(cursor)',
            'backfill_booking_ledger_last_event_id(cursor)',
            'backfill_booking_ledger_last_event_order_key(cursor)',
            'backfill_safe_spacecloud_task_state(cursor)',
        )
        positions = [source.index(step) for step in ordered_steps]
        self.assertEqual(positions, sorted(positions))
        self.assertNotIn('reproject_naver_booking_ledgers(', source)
        self.assertNotIn('recover_reprojected_skipped_uploads(', source)

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

    def test_prior_event_enrichment_positional_sql_is_valid(self):
        enriched, calendar_key, proof = (
            email_import.enrich_naver_cancellation_from_prior_event(
                FakeCursor(),
                {
                    'reservation_number': 'R-SQL-1',
                    'name': '테스트',
                    'product': 'A홀',
                    'date': '2026-08-20',
                    'start_time': '10:00',
                    'end_time': '11:00',
                },
                'Ahall',
                1787000000000,
            )
        )
        self.assertEqual(enriched['reservation_number'], 'R-SQL-1')
        self.assertEqual(calendar_key, 'Ahall')
        self.assertEqual(proof['status'], 'missing-prior-reservation')

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
                mock.patch.object(email_import, 'upsert_email_event', return_value={
                    'id': 7,
                    'event_order_key': 1786856475000,
                    'event_order_trusted': 1,
                }), \
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

    def test_payment_pending_message_is_retained_and_seen_without_handoff(self):
        events = []
        imap = FakeImap(events)
        event_data = {
            'reservation_number': 'tx-payment-pending',
            'name': '테*트님',
            'product': 'C홀',
            'date': '2026-08-05',
            'start_time': '12:00',
            'end_time': '16:00',
            'payment_status': '입금대기',
        }
        saved_records = []

        def save_record(_config, _logger, record):
            saved_records.append(dict(record))
            return {
                'id': 7,
                'event_order_key': 1786856475000,
                'event_order_trusted': 1,
            }

        message = EmailMessage()
        message['Subject'] = '입금대기 예약 테스트'
        message.set_content('body')
        config = {'db_enabled': True, 'naver_spacecloud_upload_enabled': True}
        with mock.patch.object(email_import, 'parse_reservation', return_value=event_data), \
                mock.patch.object(email_import, 'build_reservation_email_record', return_value={
                    'event_type': 'reservation',
                    'processing_status': 'received',
                }), \
                mock.patch.object(email_import, 'upsert_email_event', side_effect=save_record), \
                mock.patch.object(email_import, 'upsert_booking_ledger_confirmed') as ledger_handoff, \
                mock.patch.object(email_import, 'upsert_spacecloud_upload_task') as outbox_handoff:
            email_import.process_message(
                config,
                lambda: None,
                imap,
                'Chall',
                'Chall',
                b'79',
                message.as_bytes(),
                '',
                logging.getLogger(__name__),
            )

        self.assertEqual(events, ['seen'])
        self.assertEqual(saved_records[0]['event_type'], 'reservation_pending')
        self.assertEqual(saved_records[0]['processing_status'], 'payment_pending')
        ledger_handoff.assert_not_called()
        outbox_handoff.assert_not_called()

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
                mock.patch.object(email_import, 'upsert_email_event', return_value={
                    'id': 7,
                    'event_order_key': 1786856475000,
                    'event_order_trusted': 1,
                }), \
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
