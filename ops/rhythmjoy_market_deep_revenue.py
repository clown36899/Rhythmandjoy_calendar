#!/usr/bin/env python3
"""Offline revenue identity / composition analysis, reusing saved DB evidence.

Own-money and calendar-band ownership stays in rhythmjoy_market_analysis.
This file only adds aggregate decomposition; it never alters booking evidence.
"""
import collections
import itertools
import json
import math
import statistics
from datetime import date, datetime, time, timedelta
from pathlib import Path
from unittest.mock import patch

import rhythmjoy_market_analysis as a
import rhythmjoy_market_dataset as m

OUT = m.STORE / 'analysis/deep/revenue-decomposition.json'
CALC_CHECKS = collections.Counter()
LABELS = {'all': 'All records', 'lt2': '<2h', '2_4': '2–<4h',
          '4_6': '4–<6h', '6_10': '6–<10h', 'ge10': '10h+',
          'long4': '4h+', 'short4': '<4h'}


def duration(e):
    return (datetime.fromisoformat(e['end'])-datetime.fromisoformat(e['start'])).total_seconds()/3600


def length_band(e):
    h = duration(e)
    return 'lt2' if h < 2 else '2_4' if h < 4 else '4_6' if h < 6 else '6_10' if h < 10 else 'ge10'


def inside_band(e, band):
    start, end = datetime.fromisoformat(e['start']), datetime.fromisoformat(e['end'])
    lo, hi, mode = a.BANDS[band]
    base = datetime.combine(start.date(), time(), m.TZ)
    return a.in_mode(start.date(), mode) and base+timedelta(hours=lo) <= start and end <= base+timedelta(hours=hi)


def pure_band(e):
    bands = ['dawn', 'weekday06_10', 'day', 'shoulder16_20', 'peak20_22', 'late22_24', 'off06_24']
    matches = [b for b in bands if inside_band(e, b)]
    assert len(matches) <= 1
    return matches[0] if matches else 'mixed'


def summarize(events):
    ds = {date.fromisoformat(e['start'][:10]) for e in events}
    row = a.own_money(events, ds)
    paid = [e for e in events if e['amount_evidence']=='platform_ledger']
    count, hours = row['paid_records'], row['paid_record_hours']
    row.update(all_records=len(events), all_record_hours=sum(duration(e) for e in events),
               average_paid_record_hours=hours/count if count else None,
               evidence_records=dict(collections.Counter(e['amount_evidence'] for e in events)),
               evidence_hours={k:sum(duration(e) for e in events if e['amount_evidence']==k)
                               for k in sorted({e['amount_evidence'] for e in events})},
               platform_records=dict(collections.Counter(e['platform'] for e in paid)),
               paid_hour_coverage=hours/sum(duration(e) for e in events) if events else None)
    if count:
        assert math.isclose(count*row['average_paid_record_hours']*row['effective_gross_per_paid_record_hour'], row['recorded_gross'], abs_tol=1e-7)
    return row


def decompose(old, new):
    keys = ['paid_records', 'average_paid_record_hours', 'effective_gross_per_paid_record_hour']
    labels = ['record_count', 'average_duration', 'effective_recorded_rate']
    if not all(old[k] and new[k] for k in keys):
        return {'delta_gross':new['recorded_gross']-old['recorded_gross'], 'shapley':None,
                'reason':'Empty paid cohort in at least one period; attribution undefined.'}
    f0, f1 = [old[k] for k in keys], [new[k] for k in keys]
    effects = [0.0]*3
    for order in itertools.permutations(range(3)):
        values = f0.copy()
        for i in order:
            before = math.prod(values)
            values[i] = f1[i]
            effects[i] += (math.prod(values)-before)/6
    delta = new['recorded_gross']-old['recorded_gross']
    assert math.isclose(sum(effects), delta, abs_tol=1e-6)
    CALC_CHECKS['shapley_identity'] += 1
    return {'delta_gross':delta,
            'changes_pct':{name:100*(f1[i]/f0[i]-1) for i,name in enumerate(labels)},
            'shapley':dict(zip(labels,effects)),
            'identity_residual':sum(effects)-delta}


def comparison(old_events, new_events):
    old, new = summarize(old_events), summarize(new_events)
    return {'2025':old, '2026':new, **decompose(old,new)}


def rate_evidence(events):
    """Only distribution of observed ratios: never infer a tariff effective date."""
    bins=collections.defaultdict(lambda:{'records':0,'hours':0,'recorded_gross':0})
    for e in events:
        if e['amount_evidence']!='platform_ledger':continue
        rate=round(e['actual_gross']/duration(e),2)
        bins[rate]['records']+=1
        bins[rate]['hours']+=duration(e)
        bins[rate]['recorded_gross']+=e['actual_gross']
    return [{'observed_gross_per_hour':rate,**values} for rate,values in sorted(bins.items())]


def monthly_rate_evidence(events):
    rows=[]
    months=sorted({e['start'][:7] for e in events})
    for room in ['A홀','B홀','C홀','D홀','E홀']:
        for platform in ['naver','spacecloud']:
            for month in months:
                selected=[e for e in events if e['amount_evidence']=='platform_ledger' and e['room']==room
                          and e['platform']==platform and e['start'][:7]==month]
                for band in ['day','shoulder16_20','peak20_22','late22_24','evening16_24','off06_24']:
                    for fixed_length in [None,2]:
                        cohort=[e for e in selected if inside_band(e,band) and (fixed_length is None or duration(e)==fixed_length)]
                        if not cohort:continue
                        ratios=[e['actual_gross']/duration(e) for e in cohort]
                        hist=rate_evidence(cohort)
                        modes=[r['observed_gross_per_hour'] for r in hist if r['records']==max(r['records'] for r in hist)]
                        assert sum(r['records'] for r in hist)==len(cohort)
                        rows.append({'room':room,'platform':platform,'service_month':month,'pure_band':band,
                                     'fixed_duration_hours':fixed_length,'paid_records':len(cohort),
                                     'paid_record_hours':sum(duration(e) for e in cohort),
                                     'median_observed_gross_per_hour':statistics.median(ratios),
                                     'modal_observed_gross_per_hour':modes,
                                     'modal_record_share':max(r['records'] for r in hist)/len(cohort),
                                     'observed_rate_distribution':hist})
    return {'warning':'Observed gross/hour by service month, not a verified tariff or price-change effective date. Fixed platform and optional two-hour duration control record mix; empty cohorts omitted.',
            'rows':rows}


def composition(old_events, new_events, key):
    """Symmetric within-cell / hours-share attribution on common paid cells."""
    groups=[]
    for events in [old_events,new_events]:
        d=collections.defaultdict(list)
        for e in events:
            if e['amount_evidence']=='platform_ledger':d[key(e)].append(e)
        groups.append({k:summarize(es) for k,es in d.items()})
    common=set(groups[0]) & set(groups[1])
    common_hours=[sum(g[k]['paid_record_hours'] for k in common) for g in groups]
    common_gross=[sum(g[k]['recorded_gross'] for k in common) for g in groups]
    within, mix=0,0
    for k in common:
        h0,h1=[g[k]['paid_record_hours'] for g in groups]
        p0,p1=[g[k]['effective_gross_per_paid_record_hour'] for g in groups]
        s0,s1=h0/common_hours[0],h1/common_hours[1]
        within+=(s0+s1)/2*(p1-p0)
        mix+=(p0+p1)/2*(s1-s0)
    rates=[g/h for g,h in zip(common_gross,common_hours)]
    assert math.isclose(within+mix,rates[1]-rates[0],abs_tol=1e-7)
    CALC_CHECKS['composition_identity'] += 1
    return {'cell_count_common':len(common),'cell_counts':[len(g) for g in groups],
            'common_paid_hour_coverage':[common_hours[i]/sum(r['paid_record_hours'] for r in g.values()) for i,g in enumerate(groups)],
            'common_paid_gross_coverage':[common_gross[i]/sum(r['recorded_gross'] for r in g.values()) for i,g in enumerate(groups)],
            'common_effective_rates':rates,'within_cell_rate_effect_won_per_hour':within,
            'hours_composition_effect_won_per_hour':mix,
            'warning':'Descriptive composition decomposition, not causal price effect. Residual within-cell mix remains.'}


def run():
    CALC_CHECKS.clear()
    inputs = [m.STORE/'normalized/events.jsonl',m.STORE/'analysis/room-periods.json',
              m.STORE/'analysis/studio-periods.json',m.STORE/'analysis/calendar-days.json',
              m.STORE/'analysis/pure-day-ledger.json']
    data=[json.loads(l) for l in inputs[0].open()]
    prior_validation=json.loads((m.STORE/'analysis/validation.json').read_text())
    assert m.digest(inputs[0].read_bytes())==prior_validation['input_sha256']['normalized/events.jsonl']
    events=[e for e in data if e['studio']=='리듬앤조이']
    assert len({e['record_key'] for e in events})==len(events)
    assert all(duration(e)>0 for e in events)
    a.H={date.fromisoformat(r['date']):r['holiday'] for r in json.loads(inputs[3].read_text()) if r['holiday']}
    room_existing=json.loads(inputs[1].read_text())
    studio_existing=next(r for r in json.loads(inputs[2].read_text()) if r['studio']=='리듬앤조이')['stats']
    existing_pure=json.loads(inputs[4].read_text())
    checks=collections.Counter()
    periods={k:((date(2025,lo,1),date(2025,hi+1,1)),(date(2026,lo,1),date(2026,hi+1,1)))
             for k,lo,hi in [('05_09',5,9),('01_09',1,9),('08_09',8,9)]}
    periods.update({f'{mo:02}':((date(2025,mo,1),date(2025,mo+1,1)),(date(2026,mo,1),date(2026,mo+1,1))) for mo in range(1,10)})
    output=[]
    for label,bounds in periods.items():
        selected=[[e for e in events if lo <= date.fromisoformat(e['start'][:10]) < hi] for lo,hi in bounds]
        base=comparison(*selected)
        for idx,y in enumerate([2025,2026]):
            assert base[str(y)]['recorded_gross']==studio_existing[f'{y}-{label}']['ledger']['recorded_gross']
            checks['prior_studio_gross']+=1
        rooms=[]
        for room in ['A홀','B홀','C홀','D홀','E홀']:
            subset=[[e for e in es if e['room']==room] for es in selected]
            row={'room':room,**comparison(*subset)}
            prior=next(r for r in room_existing if r['studio']=='리듬앤조이' and r['room']==room)['stats']
            for y in [2025,2026]:
                assert row[str(y)]['recorded_gross']==prior[f'{y}-{label}']['ledger']['recorded_gross']
                checks['prior_room_gross']+=1
            if label in ['05_09','01_09','08_09']:
                row['length_groups']=[{'group':band,**comparison(*[[e for e in es if length_band(e)==band] for es in subset])} for band in ['lt2','2_4','4_6','6_10','ge10']]
                row['pure_time_groups']=[{'group':band,**comparison(*[[e for e in es if pure_band(e)==band] for es in subset])} for band in ['dawn','weekday06_10','day','shoulder16_20','peak20_22','late22_24','off06_24','mixed']]
                row['pure_weekday06_16']=comparison(*[[e for e in es if inside_band(e,'weekday06_16')] for es in subset])
                row['platforms']=[{'platform':p,**comparison(*[[e for e in es if e['platform']==p] for es in subset])}
                                  for p in ['naver','spacecloud','google-backfill',None]]
                if label=='05_09':
                    for group in row['pure_time_groups']:
                        group['observed_rate_distribution']={str(y):rate_evidence([e for e in subset[i] if pure_band(e)==group['group']])
                                                              for i,y in enumerate([2025,2026])}
                for y in [2025,2026]:
                    match=next((r for r in existing_pure if r['room']==room and r['period']==f'{y}-{label}'),None)
                    if match:
                        assert row['pure_weekday06_16'][str(y)]['recorded_gross']==match['recorded_gross']
                        checks['prior_pure_day_gross']+=1
            rooms.append(row)
        length_groups=[{'group':band,**comparison(*[[e for e in es if length_band(e)==band] for es in selected])} for band in ['lt2','2_4','4_6','6_10','ge10']]
        pure_groups=[{'group':band,**comparison(*[[e for e in es if pure_band(e)==band] for es in selected])} for band in ['dawn','weekday06_10','day','shoulder16_20','peak20_22','late22_24','off06_24','mixed']]
        for group in [rooms,length_groups,pure_groups]:
            for y in [2025,2026]:
                assert sum(r[str(y)]['recorded_gross'] for r in group)==base[str(y)]['recorded_gross']
                assert sum(r[str(y)]['all_records'] for r in group)==base[str(y)]['all_records']
                checks['partition_gross_and_count']+=1
        platform=[{'platform':p,**comparison(*[[e for e in es if e['platform']==p] for es in selected])} for p in ['naver','spacecloud','google-backfill',None]]
        output.append({'period':label,**base,'rooms':rooms,'length_groups':length_groups,
                       'long4':comparison(*[[e for e in es if duration(e)>=4] for es in selected]),
                       'pure_time_groups':pure_groups,'platforms':platform,
                       'effective_rate_composition':{
                           'room':composition(*selected,lambda e:e['room']),
                           'room_puretime_length':composition(*selected,lambda e:(e['room'],pure_band(e),length_band(e)))}})
    result={'description':'Saved own DB only: paid-record identity and symmetric Shapley decomposition; no network or operation writes.',
            'method':{'gross_identity':'Paid records × average paid-record duration × gross / paid-record hours',
                      'decomposition':'Average marginal contribution across all six orders (three-factor Shapley). Accounting identity, not causality.',
                      'time':'Whole record assigned only when fully inside one disjoint existing band; otherwise mixed. No amount proration.',
                      'hours':'Booking-record hours; overlaps retained to match ledger amounts. Do not equate these hours to occupied union hours.',
                      'period_basis':'Service-start date; includes full record amount/time; not receipt date or audited net cash.',
                      'evidence':'platform_ledger only for gross. Estimated/missing records retained as separate count/hour coverage.',
                      'limitations':['No individual customer identifiers: cannot distinguish unique customers, repeat rate, acquisition, or cannibalization.',
                                     'Recorded effective rate combines tariffs, booking mix, packages, adjustments, and platform practices.',
                                     'Paid-only subcohorts can suffer changing evidence coverage; inspect all-record and missing hour totals.',
                                     'Pure time cohorts exclude boundary-crossing bookings; not complete time-band revenue.']},
            'comparisons':output,'monthly_observed_rates':monthly_rate_evidence(events),
            'validation':{**dict(checks),**dict(CALC_CHECKS),'normalized_matches_prior_validation':True},
            'input_sha256':{str(p.relative_to(m.STORE)):m.digest(p.read_bytes()) for p in inputs},
            'reused_code_sha256':{str(p.relative_to(m.ROOT)):m.digest(p.read_bytes()) for p in [Path(a.__file__),Path(m.__file__)]},
            'code_sha256':m.digest(Path(__file__).read_bytes())}
    m.save_json(OUT,result)
    print(json.dumps({'output':str(OUT),'validation':dict(checks),'main':{k:output[0][k] for k in ['2025','2026','delta_gross','shapley','effective_rate_composition']}},ensure_ascii=False))


if __name__=='__main__':
    with patch('socket.socket.connect',side_effect=AssertionError('offline deep analysis attempted network')):
        run()
