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


def sample_result(issues, ingestion_gaps=None):
    ingestion_gaps = ingestion_gaps or []
    return {
        'checked': 3,
        'okCount': 2,
        'waitingCount': 0,
        'issueCount': len(issues) + len(ingestion_gaps),
        'duplicateCount': 0,
        'calendarMismatchCount': 0,
        'ingestionCheckedCount': 3,
        'ingestionGapCount': len(ingestion_gaps),
        'ingestionGapKeys': [
            f"{row.get('emailEventId')}|{row.get('taskId')}|{row.get('taskStatus')}|{row.get('reason')}"
            for row in ingestion_gaps
        ],
        'latestIngestionGaps': ingestion_gaps,
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

    migration_issue = {
        **platform_issue,
        'sourcePlatform': 'google-backfill',
        'sourceLabel': '구글 백필',
        'targetPlatform': 'ledger-migration',
        'targetLabel': 'DB 원장 이관',
        'taskType': 'ledger_migration',
        'reason': '구글 종료 전 예약이 실제 플랫폼 원장으로 승격되지 않음',
    }
    migration_message = audit.audit_message(sample_result([migration_issue]))
    assert 'DB 원장: 구글 종료 전 분류에 멈춤' in migration_message
    assert '실제 플랫폼 승격 필요' in migration_message

    ingestion_gap = {
        'emailEventId': 611,
        'eventType': 'cancellation',
        'processingStatus': 'spacecloud_delete_pending',
        'taskId': 573,
        'taskStatus': 'pending',
        'taskAttempts': 31,
        'date': '2026-09-08',
        'roomKey': 'A',
        'startTime': '20:00',
        'endTime': '23:00',
        'reserverNameMasked': '김*미',
        'reason': '최신 예약 메일 작업이 pending 상태로 지연됨',
    }
    ingestion_message = audit.audit_message(sample_result([], [ingestion_gap]))
    assert '문제 상세 없음' not in ingestion_message
    assert '수집·반영 누락 상세' in ingestion_message
    assert '메일 #611' in ingestion_message
    assert '작업 #573 (pending, 시도 31회)' in ingestion_message
    assert '2026-09-08 A홀 20:00-23:00' in ingestion_message

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

    gap_messages = []

    def fake_gap_send(text, timeout=12):
        gap_messages.append(text)
        return {'sent': True, 'messageId': len(gap_messages)}

    replacement_gap = {**ingestion_gap, 'emailEventId': 612}
    with tempfile.TemporaryDirectory() as temp_dir, mock.patch.object(audit, 'send_telegram', fake_gap_send):
        state_path = str(Path(temp_dir) / 'gap-state.json')
        logger = logging.getLogger('reflection-audit-gap-selftest')
        first_gap = audit.notify_if_needed(sample_result([], [ingestion_gap]), state_path, logger)
        same_gap = audit.notify_if_needed(sample_result([], [ingestion_gap]), state_path, logger)
        changed_gap = audit.notify_if_needed(sample_result([], [replacement_gap]), state_path, logger)

    assert first_gap['sent'] is True
    assert same_gap == {'sent': False, 'reason': 'state_unchanged'}
    assert changed_gap['sent'] is True
    assert len(gap_messages) == 2
    print('reflection audit notification self-test OK')


if __name__ == '__main__':
    main()
