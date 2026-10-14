#!/usr/bin/env python3
"""Additional market comparisons, reusing the saved validated analysis only.

Responsibility: existing aggregate and holiday/union code is reused through its
saved outputs. This file owns selection/benchmark and price-scenario comparisons;
it does not collect, normalize or write operational data.
"""
import json
import statistics
from pathlib import Path
from unittest.mock import patch
import rhythmjoy_market_dataset as m
import rhythmjoy_market_analysis as a

BASE = m.STORE
OUT = BASE / 'analysis/deep/market-comparison.json'
BANDS = ['all24','core10_24','dawn','weekday06_10','day','shoulder16_20','peak20_22','late22_24','off06_24','off10_22','satsun10_22']

def run():
    inputs = ['analysis/room-periods.json','analysis/studio-periods.json','analysis/hourly-profile.json','review/price-observations.json']
    rooms, studios, hourly, prices = [json.loads((BASE/p).read_text()) for p in inputs]
    assert len(rooms)==19 and all(r['studio']!='키키' for r in rooms)
    def aggregate(group, period, variant, band):
        rows=[r['stats'][period][variant][band] for r in group]
        hours=sum(r['hours'] for r in rows); supply=sum(r['supply'] for r in rows)
        return {'hours':hours,'supply':supply,'pct':100*hours/supply if supply else None}
    def change(group, period, variant='bands'):
        ans={}
        for band in BANDS:
            p,q=[aggregate(group,f'{y}-{period}',variant,band) for y in [2025,2026]]
            ans[band]={'prior':p,'current':q,'hours_delta':q['hours']-p['hours'],
                       'relative_hours_change_pct':100*(q['hours']/p['hours']-1) if p['hours'] else None,
                       'occupancy_change_pp':q['pct']-p['pct'],
                       'relative_occupancy_change_pct':100*(q['pct']/p['pct']-1) if p['pct'] else None}
        return ans
    room_changes=[]
    for r in rooms:
        for period in ['05_09','08_09']:
            if r['stats']['2025-'+period] is not None:
                room_changes.append({'studio':r['studio'],'room':r['room'],'size':r['size_pyeong_advertised'],
                                     'period':period, 'observed':change([r],period),'unambiguous':change([r],period,'unambiguous')})
    studio_changes=[]
    for s in studios:
        for period in ['05_09','08_09']:
            if s['stats']['2025-'+period] is not None:
                studio_changes.append({'studio':s['studio'],'period':period,'rooms':s['room_count'],
                                       'observed':change([s],period),'unambiguous':change([s],period,'unambiguous')})
    def select(studio=None, keys=None, sizes=None):
        return [r for r in rooms if (not studio or r['studio']==studio) and (not keys or r['room'][0] in keys) and (not sizes or r['size_group']==sizes)]
    own=select('리듬앤조이')
    competitors=[r for r in rooms if r['studio']!='리듬앤조이']
    groups=[('all_common', '08_09',own,competitors),
            ('large_common','08_09',select('리듬앤조이','A'),[r for r in competitors if r['size_group']=='대형 18~25평']),
            ('large_long','05_09',select('리듬앤조이','A'),[r for r in competitors if r['size_group']=='대형 18~25평' and r['studio']!='에이블']),
            ('medium_long','05_09',select('리듬앤조이','BE'),select('디앤에스','C')),
            ('medium_common','08_09',select('리듬앤조이','BE'),select('디앤에스','C')),
            ('small_common','08_09',select('리듬앤조이','CD'),select('에이블','E'))]
    benchmarks=[]
    for label,period,us,peers in groups:
        data={'cohort':label,'period':period,'own_rooms':[r['studio']+' '+r['room'] for r in us],
              'peer_rooms':[r['studio']+' '+r['room'] for r in peers],'variants':{}}
        for variant in ['bands','unambiguous']:
            our=change(us,period,variant); peer=change(peers,period,variant)
            bandrows={}
            for band in BANDS:
                o,p=our[band],peer[band]
                pp=o['occupancy_change_pp']-p['occupancy_change_pp']
                # Two descriptive benchmarks; neither identifies pricing causation.
                proportional_expected=o['prior']['pct']*p['current']['pct']/p['prior']['pct']*o['current']['supply']/100 if p['prior']['pct'] else None
                additive_expected=(o['prior']['pct']+p['occupancy_change_pp'])*o['current']['supply']/100
                by_studio={s:[r for r in peers if r['studio']==s] for s in {r['studio'] for r in peers}}
                equal_studio=statistics.mean(change(g,period,variant)[band]['occupancy_change_pp'] for g in by_studio.values())
                median_room=statistics.median(change([r],period,variant)[band]['occupancy_change_pp'] for r in peers)
                bandrows[band]={'own':o,'peers':p,'relative_change_gap_pp':pp,
                                 'additive_expected_hours':additive_expected,'proportional_expected_hours':proportional_expected,
                                 'actual_less_additive_hours':o['current']['hours']-additive_expected,
                                 'actual_less_proportional_hours':o['current']['hours']-proportional_expected if proportional_expected is not None else None,
                                 'own_minus_equal_studio_change_pp':o['occupancy_change_pp']-equal_studio,
                                 'own_minus_median_peer_room_change_pp':o['occupancy_change_pp']-median_room}
            data['variants'][variant]=bandrows
        benchmarks.append(data)
    # Reconstruct individual hourly booked hours from published four-decimal
    # occupancy. Assert reconstruction within rounding tolerance of saved bands.
    hmap={(h['studio'],h['room'],h['mode']):h for h in hourly}
    def booked(room,mode,hs):
        row=hmap[('리듬앤조이',room,mode)]
        return round(sum(row['percent'][h]*row['supply_days']/100 for h in hs),3)
    for r in own:
        for band,mode,hs in [('day','week',range(10,16)),('shoulder16_20','week',range(16,20)),('peak20_22','week',range(20,22)),('late22_24','week',range(22,24)),('off06_24','off',range(6,24))]:
            assert abs(booked(r['room'],mode,hs)-r['stats']['2026-05_09']['bands'][band]['hours'])<.003
    scenario_specs=[
        ('E_previous_broad_offpeak','E홀','week',[16,17,18,19,22,23],12000,10000),
        ('E_protect_19_20','E홀','week',[16,17,18,22,23],12000,10000),
        ('E_16_19_only','E홀','week',[16,17,18],12000,10000),
        ('E_all_evening','E홀','week',list(range(16,24)),12000,10000),
        ('A_previous_all_offday','A홀','off',list(range(6,24)),20000,18000),
        ('A_weak_offday_10_12_and_20_24','A홀','off',[10,11,20,21,22,23],20000,18000),
        ('A_weak_offday_deeper','A홀','off',[10,11,20,21,22,23],20000,16000),
        ('A_16_19_only','A홀','week',[16,17,18],20000,16000),
        ('A_16_20','A홀','week',[16,17,18,19],20000,16000),
        ('A_day_10_to_8','A홀','week',list(range(10,16)),10000,8000),
        ('E_day_8_to_6','E홀','week',list(range(10,16)),8000,6000),
    ]
    scenarios=[]
    for sid,room,mode,hs,old,new in scenario_specs:
        hours=booked(room,mode,hs); row=hmap[('리듬앤조이',room,mode)];supply=row['supply_days']*len(hs)
        risk=hours*(old-new)
        scenarios.append({'id':sid,'room':room,'mode':mode,'hours_of_day':hs,'old_price':old,'test_price':new,
                          'baseline_booked_hours_5months':hours,'supply_5months':supply,'occupancy_pct':100*hours/supply,
                          'lost_base_price_equivalent_per_month_no_growth':risk/5,
                          'required_truly_incremental_hours_per_month':risk/new/5,
                          'required_incremental_percent':100*(old/new-1),
                          'cannibalization_sensitivity':[{'share_of_added_hours_shifted_from_other_full_price_hours':s,
                                'donor_hour_revenue_assumed':old,'required_added_hours_per_month':risk/(new-s*old)/5 if new>s*old else None}
                                for s in [0,.25,.5]]})
    effective=[]
    def addprice(studio,room,people,day,eve,weekend,size,source,notes):
        effective.append({'studio':studio,'room':room,'people':people,'weekday10_12_per_hour':day[0],
                          'weekday12_16_per_hour':day[1],'weekday16_18_per_hour':eve[0],'weekday18_20_per_hour':eve[1],
                          'weekend12_18_per_hour':weekend,'size':size,'source':source,'notes':notes})
    for p in prices:
        s=p['studio'];k=p['room'][0]
        for people in [2,4,6,8,10,12]:
            if s=='리듬앤조이':
                day,eve,off=a.current_rates(s,p['room']);addprice(s,p['room'],people,[day,day],[eve,eve],[off,off],p['size'],p['source'],'인원 추가금 없음; 수용 가능 여부는 별도')
            elif s=='에이블':
                limit=25 if k=='D' else 4 if k=='E' else 8;extra=max(0,people-limit)*1000
                day,eve,off=a.current_rates(s,p['room']);alt=p['officialEveningWeekend']
                addprice(s,p['room'],people,[day+extra,day+extra],[{'official':alt+extra,'SC':eve+extra}]*2,[alt+extra,off+extra],p['size'],p['source'],'채널 가격 차이. 초과 인원 공식 허용여부 미확인; D 20~22 SC는 +1000원')
            elif s=='디앤에스' and k!='S':
                day,eve,off=a.current_rates(s,p['room']);addprice(s,p['room'],people,[day,day],[eve,eve],[off,off],p['size'],p['source'],'추가 인원비 미확정: 기본가격 하한만 표시, 총액으로 사용 불가')
            elif s=='콘스탄틴':
                limit={'A':8,'B':6,'C':4}[k];ex=max(0,people-limit)*1000
                first,day,eve,off={'A':(6000,7500,8500,8500),'B':(4500,6000,7000,6500),'C':(3500,5000,6000,5500)}[k]
                addprice(s,p['room'],people,[first+ex,day+ex],[day+ex,eve+ex],[off+ex,off+ex],p['size'],p['source'],'저장된 현재 시간대·인원 가산 요금; 과거 점유율 없음; 인원별 수용 여부 미검증')
    result={'purpose':'사당역 저장 자료로 시간대·면적·패널·현재 실효가격을 비교. 가격의 인과효과 또는 경쟁사 실제 매출 추정 아님.',
            'period_note':'2025 vs 2026 동일 달. 공휴일과 요일수 공급 차이는 시간 비율로 보정. 에이블 포함 비교는 8~9월만.',
            'room_changes':room_changes,'studio_changes':studio_changes,'benchmarks':benchmarks,
            'pricing_scope_scenarios':scenarios,'pricing_scope_role':{'purpose':'Independent crosscheck from saved hourly profiles; not the canonical recommendation or experiment owner','canonical_owner':'ops/rhythmjoy_market_deep_scenarios.py and analysis/deep/scenarios.json','movement_definition':'Share of extra target hours moved from outside the discounted target to a slot whose prior revenue is lost and is not resold. Moving within the target does not increase total target hours.'},'headcount_current_price_scenarios':effective,
            'limitations':['공개 캘린더에는 차단·내부 사용이 포함될 수 있고 전체 예약이 공개됐는지 미확인',
                           '면적은 광고값이며 장비·층고·소음·접근성·수용인원·고객 목적을 통제하지 못함',
                           '경쟁사 결제금액과 인원분포 미확인, 현재 표시 요금을 과거에 적용하지 않음',
                           '화이트룸 가격은 미확인. 이용 비교만 가능',
                           '등가격·면적 비교와 시장 기준선은 기술적 비교이며 가격 효과·거래 이전의 인과 추정이 아님',
                           '할인 시나리오는 5개월 관측시간×기본 요금 환산. 실제 원장 매출 또는 순익 전망이 아님'],
            'validation':{'offline':True,'fixed_cohort_rooms':19,'hourly_roundtrip_max_tolerance_hours':.003,'input_sha256':{p:m.digest((BASE/p).read_bytes()) for p in inputs},'code_sha256':m.digest(Path(__file__).read_bytes())}}
    m.save_json(OUT,result)
    print(json.dumps({'output':str(OUT),'room_periods':len(room_changes),'studio_periods':len(studio_changes),'benchmarks':len(benchmarks),'scenarios':len(scenarios),'headcount_prices':len(effective)},ensure_ascii=False))
if __name__=='__main__':
    with patch('socket.socket.connect',side_effect=AssertionError('offline market analysis attempted network')):
        run()
