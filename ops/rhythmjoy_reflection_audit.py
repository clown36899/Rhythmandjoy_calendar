#!/usr/bin/env python3
import argparse
import json
import logging
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import pymysql

DEFAULT_STATE_PATH = '/home/clown313python/rhythmjoy_ops/runtime/reflection-audit-state.json'
DEFAULT_LOG_PATH = '/home/clown313python/rhythmjoy_ops/logs/reflection-audit.log'
DEFAULT_GOOGLE_CACHE_URL = (
    'https://xn--xy1b23ggrmm5bfb82ees967e.com/'
    'calendar_set/calendar_v10/data/events.json'
)


def load_env_file(path):
    if not path:
        return
    source = Path(path)
    if not source.is_file():
        return
    for raw in source.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def setup_logger(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger('rhythmjoy_reflection_audit')
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    formatter = logging.Formatter('%(asctime)s %(levelname)s %(message)s')
    file_handler = logging.FileHandler(path)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    return logger


def db_connect():
    return pymysql.connect(
        host=os.environ['DB_SERVERNAME'],
        port=int(os.environ.get('DB_PORT', '3306')),
        user=os.environ['DB_USERNAME'],
        password=os.environ['DB_PASSWORD'],
        database=os.environ['DB_NAME'],
        charset='utf8mb4',
        autocommit=False,
        cursorclass=pymysql.cursors.DictCursor,
    )


def ensure_schema(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS rhythmjoy_reflection_audits (
            audit_key VARCHAR(180) NOT NULL,
            ledger_id BIGINT UNSIGNED NULL,
            source_platform VARCHAR(32) NOT NULL DEFAULT '',
            target_platform VARCHAR(32) NOT NULL DEFAULT '',
            expected_task_type VARCHAR(32) NOT NULL DEFAULT '',
            current_status VARCHAR(32) NOT NULL DEFAULT '',
            audit_status VARCHAR(32) NOT NULL DEFAULT 'issue',
            severity VARCHAR(16) NOT NULL DEFAULT 'warning',
            reason VARCHAR(255) NOT NULL DEFAULT '',
            task_id BIGINT UNSIGNED NULL,
            task_status VARCHAR(32) NOT NULL DEFAULT '',
            reservation_date DATE NULL,
            room_key VARCHAR(8) NOT NULL DEFAULT '',
            start_time TIME NULL,
            end_time TIME NULL,
            reserver_name VARCHAR(128) NOT NULL DEFAULT '',
            reservation_number VARCHAR(64) NOT NULL DEFAULT '',
            checked_at DATETIME NOT NULL,
            first_seen_at DATETIME NOT NULL,
            resolved_at DATETIME NULL,
            detail_json TEXT NULL,
            PRIMARY KEY (audit_key),
            KEY idx_status (audit_status, severity),
            KEY idx_checked (checked_at),
            KEY idx_ledger (ledger_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)


def short_time(value):
    text = str(value or '')
    return text[:5] if len(text) >= 5 else ''


def display_end(start, end):
    if end in ('00:00', '23:59') and start and start != '00:00':
        return '24:00'
    return end or '-'


def normalize_room(value):
    text = str(value or '').strip().lower()
    return text if text in ('a', 'b', 'c', 'd', 'e') else ''


def reservation_number_from_event(event):
    props = event.get('extendedProps') or {}
    private = props.get('private') or {}
    candidates = [
        private.get('reservationNumber'),
        event.get('description'),
        props.get('description'),
    ]
    for candidate in candidates:
        text = str(candidate or '')
        match = re.search(r'예약번호\s*[:：]?\s*(\d{7,})', text)
        if match:
            return match.group(1)
        if re.fullmatch(r'\d{7,}', text.strip()):
            return text.strip()
    return ''


def event_room(event):
    props = event.get('extendedProps') or {}
    room = normalize_room(props.get('roomKey'))
    if room:
        return room
    class_name = event.get('className')
    if isinstance(class_name, list):
        class_name = class_name[0] if class_name else ''
    return normalize_room(class_name)


def event_date_time(value):
    text = str(value or '')
    if 'T' not in text:
        return text[:10], '00:00'
    return text[:10], text.split('T', 1)[1][:5]


def fetch_google_cache(url, timeout=20):
    request = urllib.request.Request(
        url,
        headers={'Accept': 'application/json', 'User-Agent': 'RhythmjoyReflectionAudit/1.0'},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode('utf-8'))
    events = []
    for event in payload.get('events') or []:
        reservation_number = reservation_number_from_event(event)
        date_text, start = event_date_time(event.get('start'))
        end_date, end = event_date_time(event.get('end'))
        if end in ('00:00', '23:59') and (
            end == '23:59' or (end_date and end_date != date_text)
        ):
            end = '24:00'
        props = event.get('extendedProps') or {}
        events.append({
            'id': props.get('googleEventId') or event.get('id') or '',
            'reservation_number': reservation_number,
            'reservation_date': date_text,
            'room_key': event_room(event),
            'start_time': start,
            'end_time': end,
            'title': event.get('title') or event.get('summary') or '',
        })
    return events


def ledger_slot(row):
    start = short_time(row.get('start_time'))
    end = short_time(row.get('end_time'))
    return (
        str(row.get('reservation_date') or ''),
        normalize_room(row.get('room_key')),
        start,
        display_end(start, end),
    )


def google_slot(event):
    return (
        str(event.get('reservation_date') or ''),
        normalize_room(event.get('room_key')),
        str(event.get('start_time') or ''),
        str(event.get('end_time') or ''),
    )


def mask_name(name):
    text = str(name or '').strip()
    if not text:
        return ''
    if len(text) <= 2:
        return text[0] + '*'
    return text[0] + ('*' * max(1, len(text) - 2)) + text[-1]


def platform_label(value):
    return {'naver': '네이버', 'spacecloud': '스페이스클라우드', 'ledger': '원장'}.get(value or '', value or '-')


def expected_task(row):
    source = row.get('source_platform') or ''
    status = row.get('current_status') or ''
    if status == 'confirmed' and source == 'naver' and row.get('confirmed_email_event_id'):
        return {'task_type': 'upload', 'target_platform': 'spacecloud', 'event_id': row.get('confirmed_email_event_id')}
    if status == 'confirmed' and source == 'spacecloud' and row.get('confirmed_email_event_id'):
        return {'task_type': 'naver_block', 'target_platform': 'naver', 'event_id': row.get('confirmed_email_event_id')}
    return None


def latest_task(cur, event_id, task_type, row):
    if event_id:
        cur.execute("""
            SELECT id, status, attempts,
                   CAST(created_at AS CHAR) AS created_at,
                   CAST(updated_at AS CHAR) AS updated_at,
                   CAST(processed_at AS CHAR) AS processed_at,
                   TIMESTAMPDIFF(MINUTE, COALESCE(created_at, updated_at, NOW()), NOW()) AS age_minutes,
                   result_text
            FROM rhythmjoy_spacecloud_tasks
            WHERE email_event_id=%s AND task_type=%s
            ORDER BY CASE WHEN status IN ('done', 'google_pending') THEN 0 ELSE 1 END, id DESC
            LIMIT 1
        """, (event_id, task_type))
        found = cur.fetchone()
        if found:
            return found
    cur.execute("""
        SELECT id, status, attempts,
               CAST(created_at AS CHAR) AS created_at,
               CAST(updated_at AS CHAR) AS updated_at,
               CAST(processed_at AS CHAR) AS processed_at,
               TIMESTAMPDIFF(MINUTE, COALESCE(created_at, updated_at, NOW()), NOW()) AS age_minutes,
               result_text
        FROM rhythmjoy_spacecloud_tasks
        WHERE task_type=%s
          AND room_key=%s
          AND reservation_date=%s
          AND start_time=%s
          AND end_time=%s
          AND (
              reservation_number=%s
              OR reserver_name=%s
          )
        ORDER BY CASE WHEN status IN ('done', 'google_pending') THEN 0 ELSE 1 END, id DESC
        LIMIT 1
    """, (
        task_type,
        row.get('room_key') or '',
        row.get('reservation_date'),
        row.get('start_time'),
        row.get('end_time'),
        row.get('reservation_number') or '',
        row.get('reserver_name') or '',
    ))
    return cur.fetchone()


def classify_task(task, row, expected, grace_minutes):
    task_type = expected['task_type']
    if not task:
        age = int(row.get('ledger_age_minutes') or 0)
        if age <= grace_minutes:
            return 'waiting', 'info', '원장 생성 직후라 반영 작업 생성 대기'
        return 'issue', 'critical', '반대 플랫폼 반영 작업이 없음'
    status = task.get('status') or ''
    if status in ('done', 'google_pending'):
        return 'ok', 'info', '반대 플랫폼 반영 완료'
    if status in ('pending', 'running', 'claimed'):
        age = int(task.get('age_minutes') or 0)
        if age <= grace_minutes:
            return 'waiting', 'info', '반영 작업 진행 대기'
        return 'issue', 'warning', f'반영 작업이 {age}분째 {status}'
    if status in ('failed', 'needs_review', 'needs-review'):
        return 'issue', 'critical', f'반영 작업 {status}'
    return 'issue', 'warning', f'알 수 없는 작업 상태 {status}'


def upsert_item(cur, item):
    cur.execute("""
        INSERT INTO rhythmjoy_reflection_audits (
            audit_key, ledger_id, source_platform, target_platform, expected_task_type,
            current_status, audit_status, severity, reason, task_id, task_status,
            reservation_date, room_key, start_time, end_time, reserver_name, reservation_number,
            checked_at, first_seen_at, resolved_at, detail_json
        ) VALUES (
            %(audit_key)s, %(ledger_id)s, %(source_platform)s, %(target_platform)s, %(expected_task_type)s,
            %(current_status)s, %(audit_status)s, %(severity)s, %(reason)s, %(task_id)s, %(task_status)s,
            %(reservation_date)s, %(room_key)s, %(start_time)s, %(end_time)s, %(reserver_name)s, %(reservation_number)s,
            NOW(), NOW(), NULL, %(detail_json)s
        )
        ON DUPLICATE KEY UPDATE
            ledger_id=VALUES(ledger_id),
            source_platform=VALUES(source_platform),
            target_platform=VALUES(target_platform),
            expected_task_type=VALUES(expected_task_type),
            current_status=VALUES(current_status),
            first_seen_at=IF(VALUES(audit_status)='ok', first_seen_at, IF(audit_status=VALUES(audit_status), first_seen_at, NOW())),
            audit_status=VALUES(audit_status),
            severity=VALUES(severity),
            reason=VALUES(reason),
            task_id=VALUES(task_id),
            task_status=VALUES(task_status),
            reservation_date=VALUES(reservation_date),
            room_key=VALUES(room_key),
            start_time=VALUES(start_time),
            end_time=VALUES(end_time),
            reserver_name=VALUES(reserver_name),
            reservation_number=VALUES(reservation_number),
            checked_at=NOW(),
            resolved_at=IF(VALUES(audit_status)='ok', NOW(), NULL),
            detail_json=VALUES(detail_json)
    """, item)


def run_audit(grace_minutes, past_days, future_days, google_cache_url=DEFAULT_GOOGLE_CACHE_URL):
    conn = db_connect()
    seen_audit_keys = []
    out = {
        'ok': True,
        'checked': 0,
        'okCount': 0,
        'waitingCount': 0,
        'issueCount': 0,
        'duplicateCount': 0,
        'calendarMismatchCount': 0,
        'latestIssues': [],
        'latestWaiting': [],
    }
    google_events = []
    google_error = ''
    try:
        google_events = fetch_google_cache(google_cache_url)
    except Exception as error:
        google_error = str(error)
    try:
        with conn.cursor() as cur:
            ensure_schema(cur)
            cur.execute("""
                SELECT id, source_platform, source_mode, current_status, target_calendar, room_key,
                       reservation_number, reserver_name, product,
                       DATE_FORMAT(reservation_date, '%%Y-%%m-%%d') AS reservation_date,
                       TIME_FORMAT(start_time, '%%H:%%i:%%s') AS start_time,
                       TIME_FORMAT(end_time, '%%H:%%i:%%s') AS end_time,
                       confirmed_email_event_id, canceled_email_event_id,
                       CAST(last_event_at AS CHAR) AS last_event_at,
                       TIMESTAMPDIFF(MINUTE, COALESCE(last_event_at, created_at, updated_at, NOW()), NOW()) AS ledger_age_minutes
                FROM rhythmjoy_booking_ledger
                WHERE source_platform IN ('naver', 'spacecloud')
                  AND current_status='confirmed'
                  AND confirmed_email_event_id IS NOT NULL
                  AND (
                        (source_platform='naver' AND COALESCE(source_mode, '')='')
                     OR (source_platform='spacecloud' AND COALESCE(source_mode, '')='spacecloud_email')
                  )
                  AND reservation_date BETWEEN DATE_SUB(CURDATE(), INTERVAL %s DAY)
                                          AND DATE_ADD(CURDATE(), INTERVAL %s DAY)
                ORDER BY COALESCE(last_event_at, created_at, updated_at) DESC, id DESC
            """, (past_days, future_days))
            rows = cur.fetchall()

            for row in rows:
                expected = expected_task(row)
                if not expected:
                    continue
                task = latest_task(cur, expected.get('event_id'), expected['task_type'], row)
                audit_status, severity, reason = classify_task(task, row, expected, grace_minutes)
                out['checked'] += 1
                if audit_status == 'ok':
                    out['okCount'] += 1
                elif audit_status == 'waiting':
                    out['waitingCount'] += 1
                else:
                    out['issueCount'] += 1

                start = short_time(row.get('start_time'))
                end = short_time(row.get('end_time'))
                item = {
                    'audit_key': f"ledger:{row.get('id')}:{expected['task_type']}",
                    'ledger_id': row.get('id'),
                    'source_platform': row.get('source_platform') or '',
                    'target_platform': expected['target_platform'],
                    'expected_task_type': expected['task_type'],
                    'current_status': row.get('current_status') or '',
                    'audit_status': audit_status,
                    'severity': severity,
                    'reason': reason[:255],
                    'task_id': task.get('id') if task else None,
                    'task_status': task.get('status') if task else '',
                    'reservation_date': row.get('reservation_date'),
                    'room_key': row.get('room_key') or '',
                    'start_time': row.get('start_time'),
                    'end_time': row.get('end_time'),
                    'reserver_name': row.get('reserver_name') or '',
                    'reservation_number': row.get('reservation_number') or '',
                    'detail_json': json.dumps({
                        'ledgerId': row.get('id'),
                        'source': row.get('source_platform'),
                        'target': expected['target_platform'],
                        'expectedTaskType': expected['task_type'],
                        'emailEventId': expected.get('event_id'),
                        'task': task,
                    }, ensure_ascii=False, default=str),
                }
                seen_audit_keys.append(item['audit_key'])
                upsert_item(cur, item)

                view = {
                    'ledgerId': row.get('id'),
                    'sourcePlatform': row.get('source_platform') or '',
                    'sourceLabel': platform_label(row.get('source_platform')),
                    'targetPlatform': expected['target_platform'],
                    'targetLabel': platform_label(expected['target_platform']),
                    'taskType': expected['task_type'],
                    'status': audit_status,
                    'severity': severity,
                    'reason': reason,
                    'taskId': task.get('id') if task else None,
                    'taskStatus': task.get('status') if task else '',
                    'date': row.get('reservation_date'),
                    'roomKey': (row.get('room_key') or '').upper(),
                    'startTime': start,
                    'endTime': display_end(start, end),
                    'reserverNameMasked': mask_name(row.get('reserver_name')),
                    'reservationNumber': row.get('reservation_number') or '',
                }
                if audit_status == 'issue' and len(out['latestIssues']) < 8:
                    out['latestIssues'].append(view)
                elif audit_status == 'waiting' and len(out['latestWaiting']) < 5:
                    out['latestWaiting'].append(view)

            cur.execute("""
                SELECT DATE_FORMAT(reservation_date, '%%Y-%%m-%%d') AS reservation_date, room_key,
                       TIME_FORMAT(start_time, '%%H:%%i:%%s') AS start_time,
                       TIME_FORMAT(end_time, '%%H:%%i:%%s') AS end_time,
                       COUNT(*) AS cnt,
                       GROUP_CONCAT(CONCAT(id, ':', source_platform, ':', COALESCE(reservation_number, ''), ':', COALESCE(reserver_name, '')) ORDER BY COALESCE(last_event_at, created_at, updated_at), id SEPARATOR ' | ') AS rows_text
                FROM rhythmjoy_booking_ledger
                WHERE current_status='confirmed'
                  AND confirmed_email_event_id IS NOT NULL
                  AND (
                        (source_platform='naver' AND COALESCE(source_mode, '')='')
                     OR (source_platform='spacecloud' AND COALESCE(source_mode, '')='spacecloud_email')
                  )
                  AND reservation_date BETWEEN DATE_SUB(CURDATE(), INTERVAL %s DAY)
                                          AND DATE_ADD(CURDATE(), INTERVAL %s DAY)
                GROUP BY reservation_date, room_key, start_time, end_time
                HAVING COUNT(*) > 1
                ORDER BY reservation_date ASC, start_time ASC, room_key ASC
                LIMIT 30
            """, (past_days, future_days))
            duplicates = cur.fetchall()
            out['duplicateCount'] = len(duplicates)
            for duplicate in duplicates:
                start = short_time(duplicate.get('start_time'))
                end = short_time(duplicate.get('end_time'))
                item = {
                    'audit_key': f"duplicate:{duplicate.get('reservation_date')}:{duplicate.get('room_key')}:{start}:{end}",
                    'ledger_id': None,
                    'source_platform': 'ledger',
                    'target_platform': 'ledger',
                    'expected_task_type': 'dedupe',
                    'current_status': 'confirmed',
                    'audit_status': 'issue',
                    'severity': 'critical',
                    'reason': f"원장 확정 예약 중복 {duplicate.get('cnt')}건"[:255],
                    'task_id': None,
                    'task_status': '',
                    'reservation_date': duplicate.get('reservation_date'),
                    'room_key': duplicate.get('room_key') or '',
                    'start_time': duplicate.get('start_time'),
                    'end_time': duplicate.get('end_time'),
                    'reserver_name': '',
                    'reservation_number': '',
                    'detail_json': json.dumps(duplicate, ensure_ascii=False, default=str),
                }
                seen_audit_keys.append(item['audit_key'])
                upsert_item(cur, item)
                if len(out['latestIssues']) < 8:
                    out['latestIssues'].append({
                        'sourceLabel': '원장',
                        'targetLabel': '원장',
                        'taskType': 'dedupe',
                        'status': 'issue',
                        'severity': 'critical',
                        'reason': item['reason'],
                        'date': duplicate.get('reservation_date'),
                        'roomKey': (duplicate.get('room_key') or '').upper(),
                        'startTime': start,
                        'endTime': display_end(start, end),
                        'reserverNameMasked': '',
                        'reservationNumber': '',
                    })

            cur.execute("""
                SELECT id, source_platform, source_mode, current_status, room_key,
                       reservation_number, reserver_name,
                       DATE_FORMAT(reservation_date, '%%Y-%%m-%%d') AS reservation_date,
                       TIME_FORMAT(start_time, '%%H:%%i:%%s') AS start_time,
                       TIME_FORMAT(end_time, '%%H:%%i:%%s') AS end_time
                FROM rhythmjoy_booking_ledger
                WHERE current_status='confirmed'
                  AND confirmed_email_event_id IS NOT NULL
                  AND source_platform IN ('naver', 'spacecloud')
                  AND source_mode NOT LIKE '%%backfill%%'
                  AND reservation_date BETWEEN DATE_SUB(CURDATE(), INTERVAL %s DAY)
                                          AND DATE_ADD(CURDATE(), INTERVAL %s DAY)
                ORDER BY reservation_date, start_time, room_key, id
            """, (past_days, future_days))
            final_rows = cur.fetchall()

            google_by_number = {}
            for event in google_events:
                if event['reservation_number']:
                    google_by_number.setdefault(event['reservation_number'], []).append(event)

            if google_error:
                item = {
                    'audit_key': 'google-cache:unavailable',
                    'ledger_id': None,
                    'source_platform': 'ledger',
                    'target_platform': 'google',
                    'expected_task_type': 'calendar_verify',
                    'current_status': '',
                    'audit_status': 'issue',
                    'severity': 'warning',
                    'reason': ('구글 최종 일정 조회 실패: ' + google_error)[:255],
                    'task_id': None,
                    'task_status': '',
                    'reservation_date': None,
                    'room_key': '',
                    'start_time': None,
                    'end_time': None,
                    'reserver_name': '',
                    'reservation_number': '',
                    'detail_json': json.dumps({'error': google_error}, ensure_ascii=False),
                }
                seen_audit_keys.append(item['audit_key'])
                upsert_item(cur, item)
                out['issueCount'] += 1
                out['calendarMismatchCount'] += 1
            else:
                for row in final_rows:
                    reservation_number = str(row.get('reservation_number') or '')
                    source_platform = str(row.get('source_platform') or '').lower()
                    candidates = (
                        google_by_number.get(reservation_number) or []
                        if source_platform == 'naver'
                        else google_events
                    )
                    if any(google_slot(event) == ledger_slot(row) for event in candidates):
                        continue
                    reason = (
                        '구글 최종 일정에 예약번호가 없음'
                        if source_platform == 'naver' and not candidates
                        else '구글 최종 일정에 날짜·방·시간이 없음'
                        if not candidates
                        else '예약번호는 같지만 구글 최종 일정의 날짜·방·시간이 다름'
                        if source_platform == 'naver'
                        else '구글 최종 일정의 날짜·방·시간이 다름'
                    )
                    item = {
                        'audit_key': f"calendar:ledger:{row.get('id')}",
                        'ledger_id': row.get('id'),
                        'source_platform': row.get('source_platform') or '',
                        'target_platform': 'google',
                        'expected_task_type': 'calendar_verify',
                        'current_status': row.get('current_status') or '',
                        'audit_status': 'issue',
                        'severity': 'warning',
                        'reason': reason,
                        'task_id': None,
                        'task_status': '',
                        'reservation_date': row.get('reservation_date'),
                        'room_key': row.get('room_key') or '',
                        'start_time': row.get('start_time'),
                        'end_time': row.get('end_time'),
                        'reserver_name': row.get('reserver_name') or '',
                        'reservation_number': reservation_number,
                        'detail_json': json.dumps({
                            'ledgerSlot': ledger_slot(row),
                            'googleCandidates': candidates,
                        }, ensure_ascii=False, default=str),
                    }
                    seen_audit_keys.append(item['audit_key'])
                    upsert_item(cur, item)
                    out['issueCount'] += 1
                    out['calendarMismatchCount'] += 1
                    if len(out['latestIssues']) < 8:
                        start = short_time(row.get('start_time'))
                        end = short_time(row.get('end_time'))
                        out['latestIssues'].append({
                            'ledgerId': row.get('id'),
                            'sourcePlatform': row.get('source_platform') or '',
                            'sourceLabel': platform_label(row.get('source_platform')),
                            'targetPlatform': 'google',
                            'targetLabel': '구글',
                            'taskType': 'calendar_verify',
                            'status': 'issue',
                            'severity': 'warning',
                            'reason': reason,
                            'date': row.get('reservation_date'),
                            'roomKey': (row.get('room_key') or '').upper(),
                            'startTime': start,
                            'endTime': display_end(start, end),
                            'reserverNameMasked': mask_name(row.get('reserver_name')),
                            'reservationNumber': reservation_number,
                        })

            if seen_audit_keys:
                placeholders = ','.join(['%s'] * len(seen_audit_keys))
                cur.execute(f"""
                    UPDATE rhythmjoy_reflection_audits
                    SET audit_status='ok',
                        severity='info',
                        reason='이번 검사 대상 아님',
                        checked_at=NOW(),
                        resolved_at=NOW()
                    WHERE audit_status <> 'ok'
                      AND audit_key NOT IN ({placeholders})
                """, seen_audit_keys)
            else:
                cur.execute("""
                    UPDATE rhythmjoy_reflection_audits
                    SET audit_status='ok',
                        severity='info',
                        reason='이번 검사 대상 아님',
                        checked_at=NOW(),
                        resolved_at=NOW()
                    WHERE audit_status <> 'ok'
                """)

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return out


def compact_text(text, limit=1200):
    text = str(text or '').strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 20)].rstrip() + '\n...\n관리패널에서 확인'


def audit_line(row, index):
    source = row.get('sourceLabel') or row.get('sourcePlatform') or '-'
    target = row.get('targetLabel') or row.get('targetPlatform') or '-'
    room = f"{row.get('roomKey')}홀" if row.get('roomKey') else '-'
    name = f" / {row.get('reserverNameMasked')}" if row.get('reserverNameMasked') else ''
    reservation_no = f" / {row.get('reservationNumber')}" if row.get('reservationNumber') else ''
    task = f" / 작업 #{row.get('taskId')}" if row.get('taskId') else ''
    return (
        f"{index + 1}. {source}→{target} {row.get('date') or '-'} "
        f"{room} {row.get('startTime') or '-'}-{row.get('endTime') or '-'}"
        f"{name}{reservation_no}{task}\n   {str(row.get('reason') or '-')[:120]}"
    )


def audit_message(result):
    issues = result.get('latestIssues') or []
    waiting = result.get('latestWaiting') or []
    parts = [
        '⚠️ 반영 정규검사 확인 필요',
        time.strftime('%Y-%m-%d %H:%M:%S'),
        f"최종 상태 점검 {int(result.get('checked') or 0)}건 / 문제 {int(result.get('issueCount') or 0)}건 / 대기 {int(result.get('waitingCount') or 0)}건",
        f"구글 일정 불일치 {int(result.get('calendarMismatchCount') or 0)}건 / 확정 중복 {int(result.get('duplicateCount') or 0)}건",
        '\n'.join(audit_line(row, index) for index, row in enumerate(issues)) if issues else '문제 상세 없음',
    ]
    if waiting:
        parts.append('\n대기 중\n' + '\n'.join(audit_line(row, index) for index, row in enumerate(waiting)))
    parts.append('기준: 이메일 최종 원장 → 반대 플랫폼 작업 완료 → 구글 최종 일정 일치')
    return compact_text('\n'.join(parts))


def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except Exception:
        return {}


def write_json(path, data):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')


def send_telegram(text, timeout=12):
    token = os.environ.get('TELEGRAM_BOT_TOKEN', '')
    chat_id = os.environ.get('TELEGRAM_CHAT_ID', '')
    if not token or not chat_id:
        return {'sent': False, 'reason': 'missing_telegram_env'}
    payload = json.dumps({'chat_id': chat_id, 'text': text}, ensure_ascii=False).encode('utf-8')
    request = urllib.request.Request(
        f'https://api.telegram.org/bot{token}/sendMessage',
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read().decode('utf-8', errors='replace')
    data = json.loads(body)
    if not data.get('ok'):
        return {'sent': False, 'reason': body[:200]}
    return {'sent': True, 'messageId': data.get('result', {}).get('message_id')}


def notify_if_needed(result, state_path, logger):
    issue_count = int(result.get('issueCount') or 0)
    duplicate_count = int(result.get('duplicateCount') or 0)
    state = read_json(state_path)
    issue_key = '||'.join([
        str(issue_count),
        str(duplicate_count),
        *[
            '|'.join(str(row.get(key) or '') for key in (
                'sourcePlatform', 'targetPlatform', 'date', 'roomKey', 'startTime', 'endTime', 'taskType', 'taskId', 'reason'
            ))
            for row in (result.get('latestIssues') or [])
        ],
    ])
    next_state = {
        'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
        'issueKey': issue_key,
        'summary': {
            'checked': int(result.get('checked') or 0),
            'okCount': int(result.get('okCount') or 0),
            'waitingCount': int(result.get('waitingCount') or 0),
            'issueCount': issue_count,
            'duplicateCount': duplicate_count,
            'calendarMismatchCount': int(result.get('calendarMismatchCount') or 0),
        },
    }
    if issue_count <= 0 and duplicate_count <= 0:
        write_json(state_path, next_state)
        return {'sent': False, 'reason': 'no_issues'}

    cooldown = int(os.environ.get('RHYTHMJOY_REFLECTION_AUDIT_NOTIFY_COOLDOWN_SECONDS', '3600'))
    last_sent = float(state.get('lastSentAtEpoch') or 0)
    if state.get('issueKey') == issue_key and time.time() - last_sent < cooldown:
        write_json(state_path, next_state)
        return {'sent': False, 'reason': 'cooldown'}

    try:
        result = send_telegram(audit_message(result), timeout=int(os.environ.get('TELEGRAM_SEND_TIMEOUT', '12')))
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        logger.exception('telegram send failed')
        result = {'sent': False, 'reason': str(error)}
    if result.get('sent'):
        next_state['lastSentAtEpoch'] = time.time()
    next_state['lastNotification'] = result
    write_json(state_path, next_state)
    return result


def main():
    parser = argparse.ArgumentParser(description='Audit Rhythmjoy trusted email ledger reflection.')
    parser.add_argument('--env-file', default=os.environ.get('RHYTHMJOY_ENV_FILE', '/home/clown313python/myapp/.env'))
    parser.add_argument('--state-path', default=os.environ.get('RHYTHMJOY_REFLECTION_AUDIT_STATE', DEFAULT_STATE_PATH))
    parser.add_argument('--log-path', default=os.environ.get('RHYTHMJOY_REFLECTION_AUDIT_LOG', DEFAULT_LOG_PATH))
    parser.add_argument('--grace-minutes', type=int, default=int(os.environ.get('RHYTHMJOY_REFLECTION_AUDIT_GRACE_MINUTES', '10')))
    parser.add_argument('--past-days', type=int, default=int(os.environ.get('RHYTHMJOY_REFLECTION_AUDIT_PAST_DAYS', '3')))
    parser.add_argument('--future-days', type=int, default=int(os.environ.get('RHYTHMJOY_REFLECTION_AUDIT_FUTURE_DAYS', '120')))
    parser.add_argument('--notify', action='store_true')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()

    load_env_file(args.env_file)
    logger = setup_logger(args.log_path)
    result = run_audit(
        args.grace_minutes,
        args.past_days,
        args.future_days,
        os.environ.get('RHYTHMJOY_GOOGLE_CACHE_URL', DEFAULT_GOOGLE_CACHE_URL),
    )
    logger.info(
        'reflection audit checked=%s ok=%s waiting=%s issue=%s duplicate=%s calendar_mismatch=%s',
        result.get('checked'),
        result.get('okCount'),
        result.get('waitingCount'),
        result.get('issueCount'),
        result.get('duplicateCount'),
        result.get('calendarMismatchCount'),
    )
    if args.notify:
        notify = notify_if_needed(result, args.state_path, logger)
        logger.info('reflection audit notify=%s', notify)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
