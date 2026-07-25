#!/usr/bin/env python3
import argparse
import json
import sys

import rhythmjoy_email_import as importer


AMOUNT_SQL = """
COALESCE(
    NULLIF(gross_amount, 0),
    CAST(REPLACE(REPLACE(REPLACE(COALESCE(price, '0'), ',', ''), '원', ''), '￦', '') AS UNSIGNED),
    0
)
"""

LEDGER_AMOUNT_SQL = """
COALESCE(
    NULLIF(ledger.gross_amount, 0),
    CAST(REPLACE(REPLACE(REPLACE(COALESCE(ledger.price, '0'), ',', ''), '원', ''), '￦', '') AS UNSIGNED),
    0
)
"""


def fetch_all(cursor, query, params=()):
    cursor.execute(query, params)
    return cursor.fetchall()


def fetch_one(cursor, query, params=()):
    rows = fetch_all(cursor, query, params)
    return rows[0] if rows else {}


def check(name, passed, summary, details=None):
    return {
        'name': name,
        'passed': bool(passed),
        'summary': summary,
        'details': details or [],
    }


def run_audit():
    config = importer.build_config()
    connection = importer.db_connect(config)
    checks = []
    try:
        with connection.cursor() as cursor:
            invalid = fetch_one(
                cursor,
                """
                SELECT COUNT(*) AS total,
                       SUM(COALESCE(gross_amount, 0) < 0) AS negative_gross,
                       SUM(COALESCE(fee_amount, 0) < 0) AS negative_fee,
                       SUM(COALESCE(net_amount, 0) < 0) AS negative_net
                FROM rhythmjoy_booking_ledger
                """,
            )
            invalid_count = sum(int(invalid.get(key) or 0) for key in ('negative_gross', 'negative_fee', 'negative_net'))
            checks.append(check(
                '01_non_negative_amounts',
                invalid_count == 0,
                f"음수 금액 {invalid_count}건",
                [invalid],
            ))

            mismatches = fetch_all(
                cursor,
                """
                SELECT id, source_platform, reservation_number, reservation_date,
                       price, gross_amount, amount_source
                FROM rhythmjoy_booking_ledger
                WHERE COALESCE(gross_amount, 0) > 0
                  AND CAST(REPLACE(REPLACE(REPLACE(COALESCE(price, '0'), ',', ''), '원', ''), '￦', '') AS UNSIGNED) > 0
                  AND gross_amount <> CAST(REPLACE(REPLACE(REPLACE(price, ',', ''), '원', ''), '￦', '') AS UNSIGNED)
                ORDER BY reservation_date DESC, id DESC
                LIMIT 100
                """,
            )
            checks.append(check(
                '02_price_and_gross_agree',
                len(mismatches) == 0,
                f"price/gross 불일치 {len(mismatches)}건",
                mismatches,
            ))

            missing = fetch_all(
                cursor,
                f"""
                SELECT source_platform, amount_source, COUNT(*) AS count,
                       MIN(reservation_date) AS first_date, MAX(reservation_date) AS last_date
                FROM rhythmjoy_booking_ledger
                WHERE current_status <> 'canceled'
                  AND COALESCE(source_mode, '') <> 'admin-task-anchor'
                  AND {AMOUNT_SQL} = 0
                GROUP BY source_platform, amount_source
                ORDER BY source_platform, amount_source
                """,
            )
            missing_count = sum(int(row.get('count') or 0) for row in missing)
            checks.append(check(
                '03_active_amount_complete',
                missing_count == 0,
                f"확정 원장 금액 미수집 {missing_count}건",
                missing,
            ))

            future_missing = fetch_all(
                cursor,
                f"""
                SELECT id, source_platform, reservation_number, reservation_date,
                       room_key, start_time, end_time, amount_source
                FROM rhythmjoy_booking_ledger
                WHERE current_status <> 'canceled'
                  AND reservation_date >= CURDATE()
                  AND COALESCE(source_mode, '') <> 'admin-task-anchor'
                  AND {AMOUNT_SQL} = 0
                ORDER BY reservation_date, room_key, start_time
                """,
            )
            checks.append(check(
                '04_future_amount_complete',
                len(future_missing) == 0,
                f"미래 확정 예약 금액 미수집 {len(future_missing)}건",
                future_missing,
            ))

            naver_duplicates = fetch_all(
                cursor,
                """
                SELECT reservation_number, COUNT(*) AS count
                FROM rhythmjoy_booking_ledger
                WHERE source_platform = 'naver'
                  AND current_status <> 'canceled'
                  AND reservation_number <> ''
                GROUP BY reservation_number
                HAVING COUNT(*) > 1
                """,
            )
            checks.append(check(
                '05_naver_active_reservation_unique',
                len(naver_duplicates) == 0,
                f"활성 네이버 예약번호 중복 {len(naver_duplicates)}건",
                naver_duplicates,
            ))

            spacecloud_duplicates = fetch_all(
                cursor,
                """
                SELECT room_key, reservation_date, start_time, end_time,
                       reserver_name_key, COUNT(*) AS count
                FROM rhythmjoy_booking_ledger
                WHERE source_platform = 'spacecloud'
                  AND current_status <> 'canceled'
                GROUP BY room_key, reservation_date, start_time, end_time, reserver_name_key
                HAVING COUNT(*) > 1
                """,
            )
            checks.append(check(
                '06_spacecloud_active_composite_unique',
                len(spacecloud_duplicates) == 0,
                f"활성 스페이스클라우드 복합키 중복 {len(spacecloud_duplicates)}건",
                spacecloud_duplicates,
            ))

            active_times = fetch_all(
                cursor,
                """
                SELECT id, source_platform, reservation_number, reservation_date,
                       room_key, start_time, end_time
                FROM rhythmjoy_booking_ledger
                WHERE current_status <> 'canceled'
                ORDER BY reservation_date DESC, id DESC
                """,
            )
            bad_times = []
            for row in active_times:
                start = row.get('start_time')
                end = row.get('end_time')
                if not row.get('reservation_date') or start is None or end is None:
                    bad_times.append(row)
                    continue
                start_seconds = start.seconds
                end_seconds = end.seconds
                if end_seconds <= start_seconds:
                    end_seconds += 24 * 60 * 60
                duration = end_seconds - start_seconds
                if duration <= 0 or duration > 24 * 60 * 60:
                    row['duration_seconds'] = duration
                    bad_times.append(row)
            checks.append(check(
                '07_valid_booking_times',
                len(bad_times) == 0,
                f"유효하지 않은 활성 예약시간 {len(bad_times)}건",
                bad_times,
            ))

            email_mismatch = fetch_all(
                cursor,
                f"""
                SELECT ledger.id, ledger.source_platform, ledger.reservation_number,
                       ledger.reservation_date, ledger.price AS ledger_price,
                       ledger.gross_amount, email.price AS email_price,
                       ledger.amount_source
                FROM rhythmjoy_booking_ledger AS ledger
                JOIN rhythmjoy_naver_email_events AS email
                  ON email.id = ledger.confirmed_email_event_id
                WHERE ledger.current_status <> 'canceled'
                  AND COALESCE(email.price, '') <> ''
                  AND CAST(REPLACE(REPLACE(REPLACE(email.price, ',', ''), '원', ''), '￦', '') AS UNSIGNED) <> {LEDGER_AMOUNT_SQL}
                ORDER BY ledger.reservation_date DESC, ledger.id DESC
                """,
            )
            checks.append(check(
                '08_latest_email_matches_ledger',
                len(email_mismatch) == 0,
                f"최신 확정 이메일/원장 금액 불일치 {len(email_mismatch)}건",
                email_mismatch,
            ))

            impossible_breakdowns = fetch_all(
                cursor,
                """
                SELECT id, source_platform, reservation_number, reservation_date,
                       gross_amount, fee_amount, net_amount, amount_source
                FROM rhythmjoy_booking_ledger
                WHERE current_status <> 'canceled'
                  AND gross_amount > 0
                  AND (
                      COALESCE(fee_amount, 0) > gross_amount
                      OR COALESCE(net_amount, 0) > gross_amount
                      OR (
                          COALESCE(fee_amount, 0) > 0
                          AND COALESCE(net_amount, 0) > 0
                          AND ABS(gross_amount - fee_amount - net_amount) > 1
                      )
                  )
                ORDER BY reservation_date DESC, id DESC
                """,
            )
            checks.append(check(
                '09_fee_net_breakdown_valid',
                len(impossible_breakdowns) == 0,
                f"총액/수수료/정산액 산술 불일치 {len(impossible_breakdowns)}건",
                impossible_breakdowns,
            ))

            totals = fetch_all(
                cursor,
                f"""
                SELECT YEAR(reservation_date) AS year,
                       source_platform,
                       COUNT(*) AS active_count,
                       SUM({AMOUNT_SQL}) AS gross_total,
                       SUM(COALESCE(net_amount, 0)) AS net_total,
                       SUM(COALESCE(fee_amount, 0)) AS fee_total
                FROM rhythmjoy_booking_ledger
                WHERE reservation_date BETWEEN '2025-01-01' AND '2026-12-31'
                  AND current_status <> 'canceled'
                  AND COALESCE(source_mode, '') <> 'admin-task-anchor'
                GROUP BY YEAR(reservation_date), source_platform
                ORDER BY year, source_platform
                """,
            )
            source_rows = fetch_all(
                cursor,
                """
                SELECT source_platform, amount_source, COUNT(*) AS count,
                       SUM(current_status <> 'canceled') AS active_count
                FROM rhythmjoy_booking_ledger
                GROUP BY source_platform, amount_source
                ORDER BY source_platform, count DESC
                """,
            )
            checks.append(check(
                '10_independent_totals_and_sources',
                bool(totals) and all(int(row.get('gross_total') or 0) > 0 for row in totals),
                f"독립 연도·플랫폼 합계 {len(totals)}개 그룹",
                {'totals': totals, 'sources': source_rows},
            ))
    finally:
        connection.close()

    return {
        'ok': all(item['passed'] for item in checks),
        'passed': sum(1 for item in checks if item['passed']),
        'failed': sum(1 for item in checks if not item['passed']),
        'checks': checks,
    }


def main():
    parser = argparse.ArgumentParser(description='Audit Rhythmjoy booking amount integrity.')
    parser.add_argument('--compact', action='store_true')
    args = parser.parse_args()
    result = run_audit()
    print(json.dumps(result, ensure_ascii=False, default=str, indent=None if args.compact else 2))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
