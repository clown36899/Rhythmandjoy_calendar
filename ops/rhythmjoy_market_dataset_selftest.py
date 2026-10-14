#!/usr/bin/env python3
"""Boundary checks for local research extraction; never contacts production."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import rhythmjoy_market_dataset as m


class DatasetBoundaries(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = patch.object(m, 'STORE', Path(self.tmp.name))
        self.store.start()

    def tearDown(self):
        self.store.stop()
        self.tmp.cleanup()

    def test_archive_retry_and_corruption_detection(self):
        one = m.archive_bytes(b'original', '.txt')
        before = (m.STORE / one['path']).stat().st_mtime_ns
        self.assertEqual(one, m.archive_bytes(b'original', '.txt'))
        self.assertEqual(before, (m.STORE / one['path']).stat().st_mtime_ns)
        two = m.archive_bytes(b'revised', '.txt')
        self.assertNotEqual(one['path'], two['path'])
        self.assertEqual((m.STORE / one['path']).read_bytes(), b'original')
        (m.STORE / one['path']).write_bytes(b'corrupt')
        with self.assertRaises(AssertionError):
            m.archive_bytes(b'original', '.txt')

    def test_shared_rooms_recurring_exclusion_overnight_and_no_network(self):
        raw = '''BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Research test//EN
BEGIN:VEVENT
UID:weekly
DTSTART:20250901T100000Z
DTEND:20250901T120000Z
RRULE:FREQ=WEEKLY;COUNT=3
EXDATE:20250908T100000Z
SUMMARY:A룸/19~21:test
END:VEVENT
BEGIN:VEVENT
UID:overnight
DTSTART;VALUE=DATE:20250902
DTEND;VALUE=DATE:20250903
SUMMARY:B룸/23~02:test
END:VEVENT
BEGIN:VEVENT
UID:unknown-room
DTSTART;VALUE=DATE:20250903
DTEND;VALUE=DATE:20250904
SUMMARY:19~21:test
END:VEVENT
BEGIN:VEVENT
UID:bad-clock
DTSTART;VALUE=DATE:20250904
DTEND;VALUE=DATE:20250905
SUMMARY:A룸/20~32:test
END:VEVENT
BEGIN:VEVENT
UID:cancelled
DTSTART:20250905T100000Z
DTEND:20250905T120000Z
STATUS:CANCELLED
SUMMARY:B룸/19~21:test
END:VEVENT
END:VCALENDAR
'''.replace('\n', '\r\n').encode()
        source = {'id': 'mixed', 'studio': 'test', 'room': 'shared',
                  'room_patterns': {'A룸': r'^A룸/', 'B룸': r'^B룸/'}}
        snap = m.archive_bytes(raw, '.ics')
        with patch('socket.socket.connect', side_effect=AssertionError('network forbidden')):
            records, quarantine, audit = m.normalize_calendar(source, snap)
        self.assertEqual(len(records), 3)
        self.assertEqual(sorted(r['room'] for r in records), ['A룸', 'A룸', 'B룸'])
        starts = [r['start'] for r in records if r['room'] == 'A룸']
        self.assertEqual(starts, ['2025-09-01T19:00:00+09:00', '2025-09-15T19:00:00+09:00'])
        overnight = next(r for r in records if r['room'] == 'B룸')
        self.assertEqual(overnight['end'], '2025-09-03T02:00:00+09:00')
        self.assertTrue(all(r['actual_gross'] is None for r in records))
        self.assertTrue({'room_unresolved', 'invalid_or_extended_clock_review'} <= {r['reason'] for r in quarantine})
        self.assertEqual(audit['recurring_masters'], 1)

    def test_cached_failed_attempt_never_retries(self):
        with patch('requests.get', side_effect=AssertionError('network forbidden')):
            self.assertEqual(m.collect_source({'collection_attempt': {'valid': False}}), 'cached_attempt')

    def test_db_money_and_old_booking_are_not_repriced(self):
        base = {'id': 1, 'room_key': 'a', 'reservation_date': '2026-09-30',
                'start_time': '22:00', 'end_time': '23:59', 'current_status': 'confirmed',
                'source_mode': 'automatic', 'source_platform': 'naver', 'price': '40,000원',
                'gross_amount': 40000, 'amount_source': 'booking-detail', 'created_at': '2026-09-15'}
        rows = [base, {**base, 'id': 2, 'current_status': 'canceled'},
                {**base, 'id': 3, 'source_mode': 'admin-task-anchor'},
                {**base, 'id': 4, 'source_platform': 'google-backfill', 'gross_amount': 13000}]
        snap = m.archive_bytes(json.dumps({'rows': rows, 'admin': []}).encode(), '.json')
        records, _, _ = m.normalize_db({'id': 'db'}, snap)
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]['actual_gross'], 40000)
        self.assertEqual(records[0]['end'], '2026-10-01T00:00:00+09:00')
        self.assertIsNone(records[1]['actual_gross'])
        self.assertEqual(records[1]['historical_estimated_gross'], 13000)

    def test_snapshot_order_compares_instants_and_overlap_union(self):
        snapshots = [{'observed_at': '2026-10-01T09:00:00+09:00'},
                     {'observed_at': '2026-10-01T02:00:00+00:00'}]
        self.assertEqual(m.latest_snapshot({'snapshots': snapshots}), snapshots[1])
        from datetime import timedelta
        self.assertEqual(m.merged_hours([(m.START, m.START + timedelta(hours=3)),
                                         (m.START + timedelta(hours=2), m.START + timedelta(hours=4))]), 4)


if __name__ == '__main__':
    unittest.main()
