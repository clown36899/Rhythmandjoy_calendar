#!/usr/bin/env python3
"""Saved-panel capacity, contiguous vacancy and cannibalization scenarios.

The existing market_analysis module remains the sole owner of hourly unions.
This module evaluates hypothetical tariffs, never edits a booking or price.
"""
import collections
import json
from pathlib import Path
from unittest.mock import patch

import rhythmjoy_market_dataset as m

P=m.STORE/'analysis'
OUT=P/'deep/scenarios.json'


def run():
    inputs=[P/'daily-hours.json',P/'calendar-days.json',P/'room-periods.json',P/'pricing-decisions.json']
    daily=json.loads(inputs[0].read_text())
    cal={r['date']:r for r in json.loads(inputs[1].read_text())}
    periods=json.loads(inputs[2].read_text())
    own={(r['room'],r['date']):r['observed'] for r in daily if r['studio']=='리듬앤조이'}
    assert all(x in [0,1] for row in own.values() for x in row)
    def dates(year,mode):
        return [d for d,c in cal.items() if f'{year}-05-01'<=d<f'{year}-10-01'
                and ((not c['weekend'] and not c['holiday']) if mode=='week' else bool(c['weekend'] or c['holiday']))]
    def summary(room,year,mode,hours):
        ds=dates(year,mode);h=sum(sum(own[room,d][i] for i in hours) for d in ds)
        return {'hours':h,'supply':len(ds)*len(hours),'days':len(ds),'occupancy_pct':100*h/(len(ds)*len(hours))}
    definitions=[('A_weekend_all','A홀','off',list(range(6,24)),20000,[19000,18000,16000]),
                 ('A_weekend_edges','A홀','off',[10,11,20,21,22,23],20000,[18000,16000]),
                 ('A_weekend_midday','A홀','off',list(range(12,20)),20000,[18000]),
                 ('A_weekday_shoulder','A홀','week',list(range(16,20)),20000,[16000,14000]),
                 ('E_weekday_offpeak','E홀','week',[16,17,18,19,22,23],12000,[11000,10000,8000]),
                 ('E_protect_19_20','E홀','week',[16,17,18,22,23],12000,[10000]),
                 ('E_weekday_edges','E홀','week',[18,19,22,23],12000,[10000,8000]),
                 ('B_day','B홀','week',list(range(10,16)),8000,[7000,6000]),
                 ('E_day','E홀','week',list(range(10,16)),8000,[7000,6000])]
    scenarios=[]
    for key,room,mode,hrs,price0,prices in definitions:
        a,b=[summary(room,y,mode,hrs) for y in [2025,2026]]
        for price1 in prices:
            h=b['hours']/5;lost=(price0-price1)*h
            cannibal=[]
            for share in [0,.25,.5,.75,1]:
                marginal=price1-share*price0
                required=lost/marginal if marginal>0 else None
                spare=(b['supply']-b['hours'])/5
                cannibal.append({'moved_from_existing_same_rate_share':share,
                                 'net_gain_per_additional_observed_hour':marginal,
                                 'additional_observed_hours_per_month_to_break_even':required,
                                 'remaining_capacity_hours_per_month':spare,
                                 'feasible_with_observed_capacity':required is not None and required<=spare})
            cases=[{'extra_observed_hours_per_month':x,'moved_share':s,
                    'facility_rate_equivalent_change_per_month':-lost+x*(price1-s*price0)}
                   for x in [0,5,10,20] for s in [0,.25,.5]]
            scenarios.append({'id':key,'room':room,'mode':mode,'hours_of_day':hrs,'before':a,'after':b,
                              'old_price':price0,'new_price':price1,'baseline_hours_per_month':h,
                              'existing_hour_discount_loss_per_month':lost,
                              'extra_hours_per_month_no_movement':lost/price1,
                              'required_occupancy_pct_no_movement':b['occupancy_pct']*price0/price1,
                              'cannibalization':cannibal,'gain_cases':cases})
    peak=[]
    for room,old,new in [('A홀',20000,18000),('B홀',12000,10000),('E홀',12000,10000)]:
        s=summary(room,2026,'week',[20,21])
        peak.append({'room':room,**s,'old_price':old,'trial_price':new,
                     'required_occupancy_pct':s['occupancy_pct']*old/new,
                     'revenue_preserving_min_price_at_full_capacity':old*s['hours']/s['supply'],
                     'monthly_max_change_even_at_full_capacity':(new*s['supply']-old*s['hours'])/5})
    blocks=[]
    # Each start is a separate product. Overlapping alternatives are never
    # added together to claim total available hours or bookings.
    for year in [2025,2026]:
        for room,mode,starts in [('E홀','week',[16,17,18,20,22]),('A홀','week',[16,17,18]),('A홀','off',[10,12,14,16,18,20,22])]:
            ds=dates(year,mode)
            for start in starts:
                states=collections.Counter(sum(own[room,d][start:start+2]) for d in ds)
                both_be_empty=sum(sum(own['E홀',d][start:start+2])+sum(own['B홀',d][start:start+2])==0 for d in ds)
                blocks.append({'year':year,'room':room,'mode':mode,'start_hour':start,'days':len(ds),
                               'both_hours_free':states[0],'one_hour_free':states[1],'both_hours_occupied':states[2],
                               'both_B_E_free_days':both_be_empty if room=='E홀' else None})
    extension=[]
    for year in [2025,2026]:
        ds=dates(year,'week')
        for room in ['A홀','B홀','E홀']:
            peak_full=[d for d in ds if sum(own[room,d][20:22])==2]
            extension.append({'year':year,'room':room,'peak_full_days':len(peak_full),
                              'peak_full_and_19_free_days':sum(own[room,d][19]==0 for d in peak_full),
                              'peak_full_and_22_free_days':sum(own[room,d][22]==0 for d in peak_full),
                              'interpretation':'Existing peak occupancy next to a vacant hour; does not establish that one customer occupies both peak hours or wants an extension.'})
    checks=0
    for r in periods:
        if r['studio']!='리듬앤조이':continue
        for year in [2025,2026]:
            for mode,hours,band in [('week',range(10,16),'day'),('week',[20,21],'peak20_22'),('off',range(6,24),'off06_24')]:
                got=summary(r['room'],year,mode,list(hours));expected=r['stats'][f'{year}-05_09']['bands'][band]
                assert got['hours']==expected['hours'] and got['supply']==expected['supply'];checks+=1
    # Algebra boundaries: no cut/no movement needs no added hours; unchanged
    # demand incurs exactly the discount on existing hours; all demand moved
    # from an equal old-price slot never creates positive facility revenue.
    for r in scenarios:
        h=r['extra_hours_per_month_no_movement'];loss=r['existing_hour_discount_loss_per_month']
        assert abs(h*r['new_price']-loss)<1e-8
        assert r['cannibalization'][-1]['net_gain_per_additional_observed_hour']<0
    loss=sum(r['loss'] for r in json.loads(inputs[3].read_text())['room_revenue_losses'])/5
    selected=[next(r for r in scenarios if r['id']==key and r['new_price']==price)
              for key,price in [('A_weekday_shoulder',16000),('E_protect_19_20',10000)]]
    recovery=[]
    for hours_each in [5,10,20,40]:
        for moved in [0,.25,.5]:
            gain=sum(-r['existing_hour_discount_loss_per_month']+hours_each*(r['new_price']-moved*r['old_price']) for r in selected)
            recovery.append({'extra_observed_hours_each_room_per_month':hours_each,'moved_from_outside_target_share':moved,
                             'monthly_gain_equivalent':gain,'share_of_observed_monthly_gross_gap_pct':gain/loss*100})
    payload={'scope':'2025/2026 May-Sep, saved 24-hour room panel, no new collection',
             'scenarios':scenarios,'peak_capacity_limits':peak,'contiguous_two_hour_blocks':blocks,
             'adjacent_extension_opportunities':extension,
             'recovery_of_monthly_gap':{'recorded_gross_gap_per_month':loss,'policies':['A_weekday_shoulder_16000','E_protect_19_20_10000'],
                                      'cases':recovery,'warning':'Trial arithmetic versus observed gross gap is scale illustration; current-tariff equivalents and historic recorded gross are different measures.'},
             'assumptions':['Revenue equivalents under currently observed tariffs, not actual paid revenue or profit.',
                            'All existing target hours receive discount; all incremental hours face new rate.',
                            'Movement share is a sensitivity assumption, not measured customer switching.',
                            'Moved hours come from outside the discounted target, at the same old rate, and vacated donor hours are not resold; movement inside the target is not counted twice.',
                            'No fixed or variable costs available. Capacity assumes all dates are sellable.',
                            'Vacancy cannot establish demand, cause, same-customer occupancy, or customer retention.'],
             'checks':{'panel_aggregate_matches':checks,'scenario_algebra':True,'whole_hour_own_grid':True},
             'input_sha256':{str(p.relative_to(m.STORE)):m.digest(p.read_bytes()) for p in inputs},
             'code_sha256':m.digest(Path(__file__).read_bytes())}
    m.save_json(OUT,payload)
    print(json.dumps({'output':str(OUT),'checks':payload['checks'],'peak':peak},ensure_ascii=False))


if __name__=='__main__':
    with patch('socket.socket.connect',side_effect=AssertionError('offline scenarios attempted network')):run()
