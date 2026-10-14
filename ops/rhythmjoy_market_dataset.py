#!/usr/bin/env python3
"""Local research archive. Build/verify are offline; fetching requires collect.

Reuses the earlier public-ICS parsing and interval-union research workflow.
Own booking truth remains the operational DB; no production writes occur here.
Raw snapshots are content-addressed; previous versions are never overwritten.
"""
import argparse
import collections
import hashlib
import html
import json
import os
import re
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from urllib.parse import quote
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
STORE = ROOT / 'state/competitor-occupancy/dataset'
TZ = ZoneInfo('Asia/Seoul')
START = datetime(2025, 1, 1, tzinfo=TZ)
END = datetime(2026, 10, 1, tzinfo=TZ)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    tmp.replace(path)


def stamp():
    return datetime.now(timezone.utc).isoformat()


def latest_snapshot(source):
    return max(source['snapshots'], key=lambda x: datetime.fromisoformat(x['observed_at']))


def archive_bytes(data, suffix):
    sha = digest(data)
    rel = Path('raw') / (sha + suffix)
    path = STORE / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_bytes(data)
        path.chmod(0o600)
    assert digest(path.read_bytes()) == sha
    return {'sha256': sha, 'path': str(rel), 'bytes': len(data)}


def register_file(source, path, observed_at=None):
    # Inputs may be repository-relative; normalize before deriving provenance.
    # Raw writes are content-addressed, so retrying an interrupted import is safe.
    path = Path(path).resolve()
    meta = archive_bytes(path.read_bytes(), path.suffix)
    meta.update({'observed_at': observed_at or datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
                 'time_basis': 'explicit' if observed_at else 'inherited_file_mtime',
                 'original_path': str(path.relative_to(ROOT))})
    snapshots = source.setdefault('snapshots', [])
    if not any(x['sha256'] == meta['sha256'] for x in snapshots):
        snapshots.append(meta)
    return meta


def collect_source(source):
    """No repeated fetch: any recorded attempt for this run is reused."""
    if source.get('comparability') == 'excluded':
        return 'excluded_source'
    if source.get('collection_attempt'):
        return 'cached_attempt'
    import requests
    url = source['url']
    at = stamp()
    try:
        response = requests.get(url, timeout=45)
        meta = archive_bytes(response.content, '.ics' if source['kind'] == 'calendar' else '.html')
        meta.update({'observed_at': at, 'time_basis': 'http_fetch', 'url': response.url,
                     'status': response.status_code, 'etag': response.headers.get('ETag'),
                     'last_modified': response.headers.get('Last-Modified')})
        valid = response.status_code == 200 and (source['kind'] != 'calendar' or b'BEGIN:VCALENDAR' in response.content)
        source['collection_attempt'] = {**meta, 'valid': valid}
        if valid:
            source.setdefault('snapshots', []).append(meta)
        return 'collected' if valid else 'unavailable'
    except requests.RequestException as e:
        source['collection_attempt'] = {'observed_at': at, 'valid': False, 'error_type': type(e).__name__}
        return 'unavailable'


def parse_time(summary):
    """Conservative reuse of collect.py: unresolved all-day time stays quarantined."""
    s = summary.replace('~', '-').replace('–', '-').replace('−', '-').replace('～', '-')
    m = re.search(r'(오전|오후|새벽)?\s*(\d{1,2})(?::(\d{2}))?\s*(?:시)?\s*-\s*(오전|오후|새벽)?\s*(\d{1,2})(?::(\d{2}))?\s*(?:시)?', s)
    if not m:
        return ((0, 6), ['dawn_package_title']) if re.search('새벽.*(?:통|대관)', s) else (None, ['unparsed_all_day'])
    ap, a, ma, bp, b, mb = m.groups()
    a, b, ma, mb = int(a), int(b), int(ma or 0), int(mb or 0)
    if a > 24 or b > 24 or ma >= 60 or mb >= 60:
        return None, ['invalid_or_extended_clock_review']
    def convert(am, n):
        if am == '오후' and n <= 12:
            return n % 12 + 12
        if am == '오전' and n == 12:
            return 0
        return n
    first = convert(ap, a) + ma / 60
    if bp:
        last = convert(bp, b) + mb / 60
    elif ap == '오후':
        last = (24 if b == 12 else convert(ap, b)) + mb / 60
    elif ap == '오전':
        last = b + mb / 60
        if last <= first:
            last += 12
    else:
        last = b + mb / 60
    if last <= first:
        last += 24
    if not 0 < last - first <= 12 or first >= 24 or last > 30:
        return None, ['implausible_title_interval']
    flags = ['title_derived']
    if not ap and not bp and a < 12 and b <= 12:
        flags.append('meridiem_not_explicit')
    return (first, last), flags


def normalize_calendar(source, snapshot):
    import icalendar
    import recurring_ical_events
    data = (STORE / snapshot['path']).read_bytes()
    assert digest(data) == snapshot['sha256']
    assert data.strip().endswith(b'END:VCALENDAR'), 'truncated calendar'
    cal = icalendar.Calendar.from_ical(data)
    raw_events = cal.walk('VEVENT')
    assert data.count(b'BEGIN:VEVENT') == len(raw_events)
    records, quarantine, seen = [], [], set()
    counter = collections.Counter()
    raw_dates = []
    for e in raw_events:
        a = e.decoded('DTSTART', None)
        if a is not None:
            raw_dates.append(a.date() if isinstance(a, datetime) else a)
    for e in recurring_ical_events.of(cal).between(START, END):
        a = e.decoded('DTSTART', None)
        b = e.decoded('DTEND', a)
        summary = str(e.get('SUMMARY', ''))
        uid = str(e.get('UID', ''))
        rid = str(e.get('RECURRENCE-ID', a))
        key = digest((source['id'] + '\0' + uid + '\0' + rid).encode())
        flags = []
        reason = None
        room = source['room']
        # A public calendar may contain several rooms. Explicit source mappings
        # own this distinction; unresolved labels must never inflate one hall.
        if source.get('room_patterns'):
            matches = [name for name, pattern in source['room_patterns'].items() if re.search(pattern, summary, re.I)]
            if len(matches) == 1:
                room = matches[0]
            else:
                reason = 'room_unresolved'
        if str(e.get('STATUS', '')).upper() == 'CANCELLED':
            reason = 'cancelled'
        elif re.search('취소|cancel|휴무|점검|청소|공지|이용불가', summary, re.I):
            reason = 'non_booking_or_unavailable'
        elif a is None:
            reason = 'no_start'
        elif not isinstance(a, datetime) or not isinstance(b, datetime):
            parsed, flags = parse_time(summary)
            if parsed:
                day = a.date() if isinstance(a, datetime) else a
                a = datetime.combine(day, time(), TZ) + timedelta(hours=parsed[0])
                b = datetime.combine(day, time(), TZ) + timedelta(hours=parsed[1])
            else:
                reason = flags[0]
        if not reason:
            a = a.replace(tzinfo=TZ) if a.tzinfo is None else a.astimezone(TZ)
            b = b.replace(tzinfo=TZ) if b.tzinfo is None else b.astimezone(TZ)
            if b <= a or b - a > timedelta(hours=24):
                reason = 'invalid_duration'
            elif not (a < END and b > START):
                continue
        item = {'record_key': key, 'source_id': source['id'], 'studio': source['studio'], 'room': room,
                'raw_sha256': snapshot['sha256'], 'uid_hash': digest(uid.encode()), 'flags': flags,
                'actual_gross': None, 'amount_evidence': 'not_public'}
        if reason:
            item.update({'reason': reason, 'date': str(a)[:10], 'clock_tokens': re.findall(r'\d{1,2}(?::\d{2})?\s*[-~]\s*\d{1,2}(?::\d{2})?', summary)})
            quarantine.append(item)
            counter[reason] += 1
            continue
        item.update({'start': a.isoformat(), 'end': b.isoformat(), 'evidence': 'public_calendar_block'})
        identity = (key, item['start'], item['end'])
        if identity in seen:
            counter['duplicate_uid_interval'] += 1
            continue
        seen.add(identity)
        records.append(item)
        counter.update(flags)
    audit = {'source_id': source['id'], 'calendar_name': str(cal.get('X-WR-CALNAME', '')),
             'raw_vevent_count': len(raw_events), 'raw_first_date': str(min(raw_dates)) if raw_dates else None,
             'raw_last_date': str(max(raw_dates)) if raw_dates else None, 'accepted': len(records),
             'quarantined': len(quarantine), 'flags': dict(counter), 'raw_sha256': snapshot['sha256'],
             'recurring_masters': sum(bool(e.get('RRULE')) for e in raw_events)}
    return records, quarantine, audit


def normalize_db(source, snapshot):
    raw_data = (STORE / snapshot['path']).read_bytes()
    assert digest(raw_data) == snapshot['sha256']
    data = json.loads(raw_data)
    records = []
    for kind in ['rows', 'admin']:
        for r in data[kind]:
            day = date.fromisoformat(r['reservation_date'])
            if not START.date() <= day < END.date():
                continue
            if r.get('current_status', r.get('status')) == 'canceled' or r.get('source_mode') == 'admin-task-anchor':
                continue
            def hour(v):
                bits = str(v).split(':')
                return float(bits[0]) + (float(bits[1]) / 60 if len(bits) > 1 else 0)
            a = datetime.combine(day, time(), TZ) + timedelta(hours=hour(r.get('start_time', r.get('start_hour'))))
            raw_end = r.get('end_time', r.get('end_hour'))
            b = datetime.combine(day, time(), TZ) + timedelta(hours=24 if str(raw_end).startswith('23:59') else hour(raw_end))
            if b <= a:
                b += timedelta(days=1)
            amount, evidence = None, 'not_collected'
            if kind == 'rows':
                estimated = r['source_platform'] == 'google-backfill' or r['amount_source'] == 'visible-site-price'
                raw = r['gross_amount'] if r['gross_amount'] is not None and float(r['gross_amount']) > 0 else r['price']
                clean = re.sub(r'[\s,원₩￦]', '', str(raw))
                if re.fullmatch(r'\d+(?:\.\d+)?', clean):
                    amount, evidence = float(clean), 'historical_estimate' if estimated else 'platform_ledger'
            records.append({'record_key': digest(('db:' + kind + ':' + str(r['id'])).encode()),
                            'source_id': source['id'], 'studio': '리듬앤조이', 'room': r['room_key'].upper() + '홀',
                            'start': a.isoformat(), 'end': b.isoformat(), 'raw_sha256': snapshot['sha256'],
                            'evidence': 'db_' + kind, 'flags': ['legacy_import'] if r.get('source_platform') == 'google-backfill' else [],
                            'actual_gross': amount if evidence == 'platform_ledger' else None,
                            'historical_estimated_gross': amount if evidence == 'historical_estimate' else None,
                            'amount_evidence': evidence, 'platform': r.get('source_platform'),
                            'created_at': r.get('created_at'), 'received_at': r.get('confirmed_email_received_at')})
    return records, [], {'source_id': source['id'], 'accepted': len(records), 'quarantined': 0,
                          'raw_sha256': snapshot['sha256'], 'checked_at': data.get('checkedAt')}


def merged_hours(records):
    end = None
    total = 0
    for a, b in sorted(records):
        if end is None or a >= end:
            total += (b - a).total_seconds() / 3600
            end = b
        elif b > end:
            total += (b - end).total_seconds() / 3600
            end = b
    return total


def build(catalog):
    records, quarantined, audits = [], [], []
    for source in catalog['sources']:
        if source.get('comparability') == 'excluded':
            continue
        if source['kind'] not in ['calendar', 'db'] or not source.get('snapshots'):
            continue
        snapshot = latest_snapshot(source)
        r, q, a = normalize_calendar(source, snapshot) if source['kind'] == 'calendar' else normalize_db(source, snapshot)
        records.extend(r)
        quarantined.extend(q)
        audits.append(a)
        print(source['id'], len(r), 'accepted', len(q), 'quarantined', flush=True)
    # Multiple DB extracts contain disjoint periods; exact same record cannot inflate counts.
    unique = {}
    for row in records:
        key = row['record_key']
        if key in unique:
            assert unique[key]['start'] == row['start'] and unique[key]['end'] == row['end']
        unique[key] = row
    records = sorted(unique.values(), key=lambda x: (x['studio'], x['room'], x['start'], x['record_key']))
    out = STORE / 'normalized'
    out.mkdir(exist_ok=True)
    for name, values in [('events.jsonl', records), ('quarantine.jsonl', quarantined)]:
        with (out / name).open('w') as f:
            for row in values:
                f.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + '\n')
    save_json(out / 'source-audit.json', audits)
    monthly = []
    grouped = collections.defaultdict(list)
    for r in records:
        grouped[(r['source_id'], r['studio'], r['room'])].append(r)
    for (sid, studio, room), rows in grouped.items():
        for y, m in [(2025, m) for m in range(1, 13)] + [(2026, m) for m in range(1, 10)]:
            a = datetime(y, m, 1, tzinfo=TZ)
            b = datetime(y + int(m == 12), m % 12 + 1, 1, tzinfo=TZ)
            rs = [r for r in rows if datetime.fromisoformat(r['start']) < b and datetime.fromisoformat(r['end']) > a]
            parts = [(max(a, datetime.fromisoformat(r['start'])), min(b, datetime.fromisoformat(r['end']))) for r in rs]
            hrs = merged_hours(parts)
            mins = set()
            for lo, hi in parts:
                mins.update(range(round((lo - a).total_seconds() / 60), round((hi - a).total_seconds() / 60)))
            assert abs(hrs - len(mins) / 60) < 1e-7
            ambiguous = sum('meridiem_not_explicit' in r['flags'] for r in rs)
            flag = 'no_observed_records' if not rs else 'sparse_review' if len(rs) < 10 else 'observed_not_audited_complete'
            monthly.append({'source_id': sid, 'studio': studio, 'room': room, 'month': f'{y}-{m:02}',
                            'record_count': len(rs), 'observed_hours': round(hrs, 4),
                            'overlap_hours': round(sum((hi-lo).total_seconds()/3600 for lo,hi in parts) - hrs, 4),
                            'ambiguous_title_count': ambiguous, 'coverage_flag': flag,
                            'occupancy_if_full_month_available_pct': round(100*hrs/((b-a).total_seconds()/3600), 4) if rs else None,
                            'platform_recorded_gross': sum(r['actual_gross'] or 0 for r in rs if a <= datetime.fromisoformat(r['start']) < b) if studio == '리듬앤조이' and rs else None,
                            'historical_price_verified': False if studio != '리듬앤조이' else None})
    save_json(out / 'coverage-months.json', monthly)
    outputs = {str(p.relative_to(STORE)): digest(p.read_bytes()) for p in sorted(out.iterdir()) if p.is_file()}
    report = {'built_at': stamp(), 'period_start': START.isoformat(), 'period_end_exclusive': END.isoformat(),
              'record_count': len(records), 'quarantine_count': len(quarantined), 'month_rows': len(monthly),
              'rooms': len(grouped), 'source_count': len(audits), 'output_sha256': outputs,
              'checks': {'hashes': True, 'ics_record_count': True, 'recurrence_expanded': True,
                         'unique_record_keys': True, 'overlaps_union': True, 'minute_grid_crosscheck': True},
              'limitations': ['No public-calendar completeness or paid revenue assertion.',
                              'Sparse and absent months are not zero-demand evidence.',
                              'Title-derived morning/afternoon ambiguity retained as flags.',
                              'Historical price observations cannot be inferred from current prices.',
                              'No online access in build or verify.']}
    save_json(STORE / 'validation.json', report)
    return report


def verify(catalog):
    n = 0
    attempted = 0
    for s in catalog['sources']:
        snaps = list(s.get('snapshots', []))
        attempt = s.get('collection_attempt', {})
        if attempt.get('path') and not any(x['path'] == attempt['path'] for x in snaps):
            snaps.append(attempt)
            attempted += 1
        for snap in snaps:
            assert digest((STORE / snap['path']).read_bytes()) == snap['sha256']
            n += 1
    v = json.loads((STORE / 'validation.json').read_text())
    for path, sha in v['output_sha256'].items():
        assert digest((STORE / path).read_bytes()) == sha
    return {'snapshot_hashes_verified': n, 'unavailable_responses_included': attempted,
            'output_hashes_verified': len(v['output_sha256'])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['build', 'verify', 'collect'])
    args = parser.parse_args()
    path = STORE / 'catalog.json'
    catalog = json.loads(path.read_text())
    if args.action == 'collect':
        for source in catalog['sources']:
            if source.get('fetch_missing'):
                print(source['id'], collect_source(source), flush=True)
                save_json(path, catalog)
    elif args.action == 'build':
        print(json.dumps(build(catalog), ensure_ascii=False))
    else:
        print(json.dumps(verify(catalog), ensure_ascii=False))


if __name__ == '__main__':
    main()
