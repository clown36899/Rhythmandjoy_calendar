#!/usr/bin/env python3
"""Offline pricing research from the verified archive; no operational writes.

Reuses interval union and the earlier longterm/overall-recheck band definitions.
Adds the approved fixed cohorts, ambiguity sensitivity and recorded-price cohorts.
"""
import collections
import json
import re
from datetime import date, datetime, time, timedelta
from pathlib import Path
from unittest.mock import patch

import rhythmjoy_market_dataset as m

OUT = m.STORE / 'analysis'
H = {}
BANDS = {
    'all24': (0, 24, 'all'), 'core10_24': (10, 24, 'all'),
    'dawn': (0, 6, 'all'), 'weekday06_10': (6, 10, 'week'),
    'day': (10, 16, 'week'), 'weekday06_16': (6, 16, 'week'),
    'shoulder16_20': (16, 20, 'week'), 'peak20_22': (20, 22, 'week'),
    'late22_24': (22, 24, 'week'), 'evening16_24': (16, 24, 'week'),
    'off06_24': (6, 24, 'off'), 'off10_22': (10, 22, 'off'),
    'satsun10_22': (10, 22, 'satsun'), 'holiday10_22': (10, 22, 'holiday'),
    'off10_18': (10, 18, 'off'), 'off18_22': (18, 22, 'off'),
}
PERIODS = {f'{y}-{mo:02}': (date(y, mo, 1), date(y+int(mo==12), mo%12+1, 1))
           for y in [2025, 2026] for mo in range(1, 13 if y==2025 else 10)}
for y in [2025, 2026]:
    for lo, hi in [('01','09'), ('02','09'), ('05','09'), ('08','09')]:
        PERIODS[f'{y}-{lo}_{hi}'] = (date(y, int(lo), 1), date(y, int(hi)+1, 1))
    PERIODS[f'{y}-pre_july'] = (date(y, 5, 1), date(y, 7, 16))
    PERIODS[f'{y}-post_july'] = (date(y, 7, 16), date(y, 10, 1))


def dates(a, b):
    while a < b:
        yield a
        a += timedelta(days=1)


def in_mode(d, mode):
    work = d.weekday() < 5 and d not in H
    return {'all': True, 'week': work, 'off': not work,
            'satsun': d.weekday() >= 5, 'holiday': d.weekday() < 5 and d in H}[mode]


def measure(grid, ds, band):
    lo, hi, mode = BANDS[band]
    ds = [d for d in ds if in_mode(d, mode)]
    supply = len(ds)*(hi-lo)
    hrs = sum(sum(grid[d][lo:hi]) for d in ds)
    return {'hours': round(hrs, 4), 'supply': supply,
            'pct': round(100*hrs/supply, 4) if supply else None}


def own_money(events, ds, room=None):
    selected = [e for e in events if e['studio']=='리듬앤조이' and date.fromisoformat(e['start'][:10]) in ds
                and (room is None or e['room']==room)]
    paid = [e for e in selected if e['amount_evidence']=='platform_ledger']
    paid_hours = sum((datetime.fromisoformat(e['end'])-datetime.fromisoformat(e['start'])).total_seconds()/3600 for e in paid)
    gross = sum(e['actual_gross'] for e in paid)
    return {'recorded_gross': gross, 'paid_records': len(paid), 'paid_record_hours': paid_hours,
            'effective_gross_per_paid_record_hour': gross/paid_hours if paid_hours else None,
            'estimated_or_missing_records': len(selected)-len(paid)}


def current_rates(studio, room):
    key = room[0]
    if studio=='리듬앤조이':
        return {'A':(10000,20000,20000),'B':(8000,12000,12000),'C':(4000,6000,6000),
                'D':(3000,5000,5000),'E':(8000,12000,12000)}[key]
    if studio=='에이블':
        return (10000,13000,13000) if key=='D' else (4000,7000,7000) if key=='E' else (5000,8000,8000)
    if studio=='디앤에스' and key!='S':
        return (10000,12000,12000) if key in 'BG' else (6000,8000,8000) if key=='C' else (5000,7000,7000)


def run():
    global H
    catalog = json.loads((m.STORE/'catalog.json').read_text())
    m.verify(catalog)
    calendar_source = next(s for s in catalog['sources'] if s['id']=='kr-public-holidays-2025-2026')
    calendar_path = m.STORE/m.latest_snapshot(calendar_source)['path']
    calendar_policy = json.loads(calendar_path.read_text())
    H = {date.fromisoformat(r['date']):r['label'] for r in calendar_policy['holidays']}
    # Verify the policy boundary without altering any booking or ledger amount.
    for d in ['2026-05-01','2026-07-17']:
        assert in_mode(date.fromisoformat(d),'off')
    for d in ['2025-05-01','2025-07-17','2026-05-04']:
        assert in_mode(date.fromisoformat(d),'week')
    all_events = [json.loads(line) for line in (m.STORE/'normalized/events.jsonl').open()]
    assert not any(e['studio']=='키키' for e in all_events)
    cohorts = [r for r in json.loads((m.STORE/'review/cohorts.json').read_text())
               if r['status'] in ('own_db','local_conditional')]
    monthly_input = {(r['studio'],r['room'],r['month']):r for r in json.loads((m.STORE/'normalized/coverage-months.json').read_text())}
    all_days = list(dates(m.START.date(),m.END.date()))
    results, hourly_rows = [], []
    grids = {}
    month_checks = 0
    for room in cohorts:
        sid, studio, name = room['source_id'], room['studio'], room['room']
        events = [e for e in all_events if e['source_id']==sid and e['room']==name]
        byday = collections.defaultdict(list)
        for e in events:
            a,b = datetime.fromisoformat(e['start']),datetime.fromisoformat(e['end'])
            # 00:xx is explicit midnight in the stored 24-hour clock. Preserve
            # original flags, but sensitivity removal targets 01~11 ambiguity.
            ambiguous = 'meridiem_not_explicit' in e['flags'] and a.hour != 0
            for d in dates(max(a.date(),m.START.date()), min(b.date()+timedelta(days=1),m.END.date())):
                byday[d].append((a,b,ambiguous))
        grids[(studio,name)] = {}
        for sensitivity in ['observed','unambiguous']:
            grid = {}
            for d in all_days:
                daystart = datetime.combine(d,time(),m.TZ)
                spans = [(a,b) for a,b,amb in byday[d] if sensitivity=='observed' or not amb]
                hour_values=[]
                for h in range(24):
                    lo,hi=daystart+timedelta(hours=h),daystart+timedelta(hours=h+1)
                    parts=[(max(lo,a),min(hi,b)) for a,b in spans if a<hi and b>lo]
                    value=m.merged_hours(parts)
                    minutes=set()
                    for a,b in parts:minutes.update(range(round((a-lo).total_seconds()/60),round((b-lo).total_seconds()/60)))
                    assert abs(value-len(minutes)/60)<1e-7
                    hour_values.append(value)
                grid[d]=hour_values
            grids[(studio,name)][sensitivity]=grid
        stats={}
        for label,(a,b) in PERIODS.items():
            first=room['comparison_candidate_start'];last=room['comparison_candidate_end']
            if a.strftime('%Y-%m')<first or (b-timedelta(days=1)).strftime('%Y-%m')>last:
                stats[label]=None;continue
            ds=list(dates(a,b))
            band_stats={k:measure(grids[(studio,name)]['observed'],ds,k) for k in BANDS}
            strict={k:measure(grids[(studio,name)]['unambiguous'],ds,k) for k in BANDS}
            assert abs(sum(band_stats[k]['hours'] for k in ['dawn','weekday06_10','day','shoulder16_20','peak20_22','late22_24','off06_24'])-band_stats['all24']['hours'])<1e-5
            stats[label]={'bands':band_stats,'unambiguous':strict}
            if len(label)==7:
                assert abs(band_stats['all24']['hours']-monthly_input[(studio,name,label)]['observed_hours'])<.001
                month_checks+=1
            rates=current_rates(studio,name)
            if rates:
                dayprice,eveprice,offprice=rates
                amount=dayprice*band_stats['day']['hours']+eveprice*band_stats['evening16_24']['hours']
                offhours=sum(sum(grids[(studio,name)]['observed'][d][10:24]) for d in ds if in_mode(d,'off'))
                amount+=offprice*offhours
                if studio=='에이블' and name.startswith('D'):
                    amount+=1000*band_stats['peak20_22']['hours']
                stats[label]['current_rate_equivalent_10_24']=round(amount)
            if studio=='리듬앤조이':stats[label]['ledger']=own_money(all_events,set(ds),name)
        ds=list(dates(date(2026,5,1),date(2026,10,1)))
        for mode in ['week','off']:
            days=[d for d in ds if in_mode(d,mode)]
            hourly_rows.append({'studio':studio,'room':name,'mode':mode,
                                'percent':[round(sum(grids[(studio,name)]['observed'][d][h] for d in days)/len(days)*100,4) for h in range(24)],
                                'supply_days':len(days)})
        results.append({**room,'stats':stats})

    aggregates=[]
    for studio in sorted({r['studio'] for r in results}):
        group=[r for r in results if r['studio']==studio];stats={}
        for label,(a,b) in PERIODS.items():
            if any(r['stats'][label] is None for r in group):stats[label]=None;continue
            stats[label]={}
            for variant in ['bands','unambiguous']:
                stats[label][variant]={}
                for band in BANDS:
                    h=sum(r['stats'][label][variant][band]['hours'] for r in group)
                    sup=sum(r['stats'][label][variant][band]['supply'] for r in group)
                    stats[label][variant][band]={'hours':h,'supply':sup,'pct':100*h/sup if sup else None}
            if studio=='리듬앤조이':stats[label]['ledger']=own_money(all_events,set(dates(a,b)))
        aggregates.append({'studio':studio,'room_count':len(group),'stats':stats})

    own_totals = next(r for r in aggregates if r['studio']=='리듬앤조이')['stats']
    money_checks = json.loads((m.STORE/'review/crosschecks.json').read_text())['monthly_money']
    for row in money_checks:
        assert own_totals[row['month']]['ledger']['recorded_gross']==row['current']==row['prior']

    pure_day=[]
    for room in 'ABCDE':
        for label,(lo,hi) in PERIODS.items():
            if label not in [f'{y}-{phase}_july' for y in [2025,2026] for phase in ['pre','post']]+['2025-05_09','2026-05_09','2025-01_09','2026-01_09','2026-08_09']:
                continue
            selected=[]
            for e in all_events:
                if e['studio']!='리듬앤조이' or e['room']!=room+'홀' or e['amount_evidence']!='platform_ledger':continue
                a,b=datetime.fromisoformat(e['start']),datetime.fromisoformat(e['end'])
                if not lo<=a.date()<hi or not in_mode(a.date(),'week'):continue
                if a.date()!=b.date() or a.hour<6 or b.hour>16 or (b.hour==16 and b.minute):continue
                hrs=(b-a).total_seconds()/3600
                selected.append((e,hrs,e['actual_gross']/hrs))
            hrs=sum(x[1] for x in selected);gross=sum(x[0]['actual_gross'] for x in selected)
            bins=collections.Counter(round(x[2]) for x in selected)
            # received_at may be missing or an import marker; never use created_at
            # (bulk-import time) as booking acquisition time.
            valid_receipt=sum(bool(re.match(r'^202[56]-\d\d-\d\d',e.get('received_at') or '')) and (e.get('received_at') or '')[:10]<=e['start'][:10] for e,_,_ in selected)
            pure_day.append({'room':room+'홀','period':label,'records':len(selected),'hours':hrs,'recorded_gross':gross,
                             'effective_rate':gross/hrs if hrs else None,'rate_counts':dict(bins),
                             'valid_receipt_date_records':valid_receipt})

    m.save_json(OUT/'room-periods.json',results)
    m.save_json(OUT/'studio-periods.json',aggregates)
    m.save_json(OUT/'hourly-profile.json',hourly_rows)
    # Reuse the already verified hourly unions for contiguous availability and
    # simultaneous-room analysis. Missing coverage months remain absent, not 0.
    m.save_json(OUT/'daily-hours.json',[
        {'studio':r['studio'],'room':r['room'],'date':d.isoformat(),
         'observed':grids[(r['studio'],r['room'])]['observed'][d],
         'unambiguous':grids[(r['studio'],r['room'])]['unambiguous'][d]}
        for r in results for d in all_days
        if r['comparison_candidate_start']<=d.strftime('%Y-%m')<=r['comparison_candidate_end']])
    m.save_json(OUT/'pure-day-ledger.json',pure_day)
    m.save_json(OUT/'calendar-days.json',[{'date':d.isoformat(),'holiday':H.get(d),'weekend':d.weekday()>=5} for d in all_days])
    validation={'source':'saved validated dataset only; network disabled during run','room_count':len(results),
                'monthly_hours_crosschecks':month_checks,'hourly_union_minute_crosscheck':True,'disjoint_partition_check':True,
                'monthly_ledger_crosschecks':len(money_checks),'calendar_policy_boundary_checks':5,
                'calendar_source':calendar_policy['official_correction'],
                'kiki_excluded':True,'historic_only_dns_rooms_and_factory_excluded':True,
                'sensitivity':'Remove flagged 01~11 title clocks; explicit 00:xx retained. This is a conservative evidence subset, not a statistical confidence interval.',
                'money':'Own platform ledger gross only. No competitor actual revenue. 10~24 current-rate-equivalent excludes dawn, headcount fees, packages, discounts, net fees.',
                'booking_date':'created_at is often bulk import time; do not interpret it as acquisition time. received_at missingness retained.',
                'input_sha256':{str(p.relative_to(m.STORE)):m.digest(p.read_bytes()) for p in [m.STORE/'normalized/events.jsonl',m.STORE/'review/cohorts.json',m.STORE/'review/price-observations.json',calendar_path]},
                'code_sha256':m.digest(Path(__file__).read_bytes())}
    m.save_json(OUT/'validation.json',validation)
    print(json.dumps(validation,ensure_ascii=False))


if __name__=='__main__':
    with patch('socket.socket.connect',side_effect=AssertionError('offline analysis attempted network')):
        run()
