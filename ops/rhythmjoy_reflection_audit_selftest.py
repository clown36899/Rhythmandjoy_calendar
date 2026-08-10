#!/usr/bin/env python3
import json
import logging
import sys
import tempfile
import types
import urllib.parse
from pathlib import Path
from unittest import mock

try:
    import pymysql  # noqa: F401
except ModuleNotFoundError:
    sys.modules['pymysql'] = types.SimpleNamespace()

import rhythmjoy_reflection_audit as audit


def sample_result(issues):
    return {
        'checked': 3,
        'okCount': 2,
        'waitingCount': 0,
        'issueCount': len(issues),
        'duplicateCount': 0,
        'calendarMismatchCount': 0,
        'ingestionCheckedCount': 3,
        'ingestionGapCount': 0,
        'latestIssues': issues,
        'latestWaiting': [],
    }


def main():
    cache_payload = {
        'source': 'db-booking-ledger',
        'coverageStart': '2026-04-12',
        'failures': {},
        'events': [{
            'id': 'ledger:513',
            'start': '2026-08-12T19:00:00+09:00',
            'end': '2026-08-12T20:00:00+09:00',
            'className': 'c',
            'extendedProps': {
                'roomKey': 'c',
                'ledgerId': 513,
                'reservationNumber': '1310000000',
            },
        }],
    }
    data_url = 'data:application/json,' + urllib.parse.quote(
        json.dumps(cache_payload)
    )
    cache_events, coverage_start, cache_source = audit.fetch_google_cache(data_url)
    assert cache_source == 'db-booking-ledger'
    assert coverage_start == '2026-04-12'
    assert cache_events[0]['ledger_id'] == 513

    platform_issue = {
        'ledgerId': 513,
        'sourcePlatform': 'spacecloud',
        'sourceLabel': '스페이스클라우드',
        'targetPlatform': 'naver',
        'date': '2026-08-12',
        'roomKey': 'C',
        'startTime': '19:00',
        'endTime': '20:00',
        'taskId': 513,
        'reason': '작업 상태 확인 필요',
    }
    google_copy_issue = {
        **platform_issue,
        'targetPlatform': 'google',
        'reason': 'Google copy mismatch',
    }
    groups = audit.actionable_issue_groups([platform_issue, google_copy_issue])
    assert len(groups) == 1
    assert groups[0]['targets'] == {'naver'}
    message = audit.audit_message(sample_result([platform_issue, google_copy_issue]))
    assert '실제 플랫폼 누락 확정 아님' in message
    assert '같은 상태는 다시 알리지 않습니다' in message

    sent_messages = []

    def fake_send(text, timeout=12):
        sent_messages.append(text)
        return {'sent': True, 'messageId': len(sent_messages)}

    with tempfile.TemporaryDirectory() as temp_dir, mock.patch.object(audit, 'send_telegram', fake_send):
        state_path = str(Path(temp_dir) / 'state.json')
        logger = logging.getLogger('reflection-audit-selftest')
        first = audit.notify_if_needed(sample_result([platform_issue]), state_path, logger)
        second = audit.notify_if_needed(sample_result([platform_issue]), state_path, logger)
        resolved = audit.notify_if_needed(sample_result([]), state_path, logger)
        quiet = audit.notify_if_needed(sample_result([]), state_path, logger)

    assert first['sent'] is True
    assert second == {'sent': False, 'reason': 'state_unchanged'}
    assert resolved['sent'] is True
    assert quiet == {'sent': False, 'reason': 'no_issues'}
    assert len(sent_messages) == 2
    assert sent_messages[1].startswith('✅ 자동검사 경고 해제')
    print('reflection audit notification self-test OK')


if __name__ == '__main__':
    main()
