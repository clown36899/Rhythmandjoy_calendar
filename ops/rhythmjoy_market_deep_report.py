#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Present verified saved-data deep analyses; no network or operating changes."""
import json
from pathlib import Path
from unittest.mock import patch

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

import rhythmjoy_market_dataset as m
from rhythmjoy_market_analysis_report import table, won

P=m.STORE/'analysis/deep'
O=m.ROOT/'output/research/market-analysis-2026-10-01'


def run():
    files=['revenue-decomposition.json','price-effect.json','market-comparison.json','scenarios.json']
    revenue,price,market,scenario=[json.loads((P/name).read_text()) for name in files]
    main=next(x for x in revenue['comparisons'] if x['period']=='05_09')
    channels=[x for x in main['platforms'] if x['platform'] in ['naver','spacecloud']]
    exact=[x for x in price['comparisons'] if x['window']=='exact_july16' and x['variant']=='bands']
    bench=next(x for x in market['benchmarks'] if x['cohort']=='all_common' and x['period']=='08_09')['variants']['bands']
    chosen=[next(x for x in scenario['scenarios'] if x['id']==key and x['new_price']==new)
            for key,new in [('E_protect_19_20',10000),('A_weekday_shoulder',16000),('A_weekend_edges',18000),('A_weekend_all',18000)]]
    plt.rcParams.update({'font.family':'Apple SD Gothic Neo','axes.unicode_minus':False,'font.size':11,
                         'axes.spines.top':False,'axes.spines.right':False})
    fig,axs=plt.subplots(1,2,figsize=(13.2,4.5))
    vals=[main['shapley'][k]/10000 for k in ['record_count','average_duration','effective_recorded_rate']]+[main['delta_gross']/10000]
    axs[0].barh(['예약 건수 변화','평균 길이 변화','실효 기록단가 변화','합계'],vals,color=['#b94c50','#b94c50','#268377','#435d79'])
    axs[0].invert_yaxis();axs[0].axvline(0,color='#aeb9c4',lw=.7);axs[0].set_xlim(-790,490)
    axs[0].set_title('매출 변화의 수학적 분해 · 인과효과 아님',loc='left',pad=15)
    axs[0].set_xlabel('만 원, 2025→2026년 5~9월')
    for i,v in enumerate(vals):axs[0].text(v-12 if v<0 else v+12,i,f'{v:+.1f}',ha='right' if v<0 else 'left',va='center')
    ms=[x for x in revenue['comparisons'] if len(x['period'])==2]
    for j,(channel,label,color) in enumerate([('naver','네이버','#507ba6'),('spacecloud','스페이스클라우드','#d49341')]):
        ys=[next(p for p in x['platforms'] if p['platform']==channel)['delta_gross']/10000 for x in ms]
        axs[1].bar(np.arange(len(ms))+(j-.5)*.35,ys,width=.35,label=label,color=color)
    axs[1].set_xticks(range(len(ms)),[str(int(x['period']))+'월' for x in ms]);axs[1].axhline(0,color='#aeb9c4',lw=.7)
    axs[1].set_title('채널별 원장 매출 전년 대비 변화',loc='left',pad=15);axs[1].set_ylabel('만 원');axs[1].legend(frameon=False)
    fig.tight_layout(w_pad=3);fig.savefig(O/'deep-revenue.png',dpi=170,bbox_inches='tight');plt.close(fig)

    fig,ax=plt.subplots(figsize=(12.5,4.5))
    labels=['낮 10–16','16–20','20–22','토·일 10–22']
    bands=['day','shoulder16_20','peak20_22','satsun10_22']
    for j,(key,label,color) in enumerate([('own','리듬앤조이','#b94c50'),('peers','경쟁 14개 방','#35857b')]):
        vals=[bench[b][key]['occupancy_change_pp'] for b in bands]
        bars=ax.bar(np.arange(4)+(j-.5)*.32,vals,.32,label=label,color=color)
        for b,v in zip(bars,vals):ax.text(b.get_x()+b.get_width()/2,v+(.6 if v>=0 else -.6),f'{v:+.1f}',ha='center',va='bottom' if v>=0 else 'top')
    ax.set_xticks(range(4),labels);ax.axhline(0,color='#8798a6',lw=.7);ax.set_ylim(-17,8);ax.set_ylabel('이용률 변화 (%p)')
    ax.set_title('같은 8~9월의 시간대별 전년 변화 · 공급시간 보정',loc='left',pad=18);ax.legend(frameon=False)
    fig.tight_layout();fig.savefig(O/'deep-market.png',dpi=170,bbox_inches='tight');plt.close(fig)

    fig,axs=plt.subplots(1,2,figsize=(13.2,4.6))
    xx=np.arange(0,31)
    for ax,s,title in zip(axs,chosen[:2],['E홀 16–19·22–24시 1만 원','A홀 평일 16–20시 1만6천 원']):
        for c,label in [(0,'이동 0%'),(.25,'이동 25%'),(.5,'이동 50%')]:
            yy=(-s['existing_hour_discount_loss_per_month']+xx*(s['new_price']-c*s['old_price']))/10000
            ax.plot(xx,yy,label=label,lw=2)
        ax.axhline(0,color='#65768a',lw=.8);ax.set_title(title,loc='left',pad=12);ax.set_xlabel('할인 대상의 월 추가 판매시간');ax.set_ylabel('시설 전체 기본요금 환산 증감 (만 원)');ax.legend(frameon=False)
    fig.suptitle('추가 판매가 기존 자사 예약의 이동이면 효과가 줄어듭니다',x=.04,ha='left',fontsize=14)
    fig.tight_layout();fig.savefig(O/'deep-scenarios.png',dpi=170,bbox_inches='tight');plt.close(fig)

    roomrows=[]
    for r in main['rooms']:
        roomrows.append([r['room'],f"{r['2025']['paid_records']}→{r['2026']['paid_records']}",
                         f"{r['changes_pct']['record_count']:+.1f}%",f"{r['2025']['average_paid_record_hours']:.2f}→{r['2026']['average_paid_record_hours']:.2f}시간",
                         f"{r['changes_pct']['effective_recorded_rate']:+.1f}%",won(r['delta_gross'])])
    chanrows=[[{'naver':'네이버','spacecloud':'스페이스클라우드'}[r['platform']],f"{r['2025']['paid_records']}→{r['2026']['paid_records']}",won(r['2025']['recorded_gross']),won(r['2026']['recorded_gross']),won(r['delta_gross'])] for r in channels]
    marketrows=[]
    for r in market['studio_changes']:
        if r['period']=='08_09':marketrows.append([r['studio'],f"{r['observed']['all24']['relative_hours_change_pct']:+.1f}%",f"{r['observed']['core10_24']['relative_hours_change_pct']:+.1f}%",f"{r['observed']['dawn']['hours_delta']:+.0f}시간"])
    cutrows=[]
    for r in exact:
        c=next(x for x in r['control_sensitivity'] if x['control']=='dns_C_13p')
        cutrows.append([{'own_B':'B','own_E':'E','own_BE':'B+E'}[r['target']],f"{r['before_after_pp']['2026']:+.2f}%p",f"{r['season_adjusted_pp']:+.2f}%p",f"{c['season_and_control_adjusted_pp']:+.2f}%p"])
    trials=[]
    for r,label in zip(chosen,['E 평일 16–19·22–24','A 평일 16–20','A 주말 10–12·20–24','A 주말 전체 06–24']):
        trials.append([label,f"{r['old_price']:,}→{r['new_price']:,}",f"{r['after']['occupancy_pct']:.1f}%",won(r['existing_hour_discount_loss_per_month']),f"+{r['extra_hours_per_month_no_movement']:.2f}시간",f"+{r['cannibalization'][2]['additional_observed_hours_per_month_to_break_even']:.2f}시간"])
    blocks=[r for r in scenario['contiguous_two_hour_blocks'] if r['year']==2026 and (r['room']=='E홀' or r['mode']=='week')]
    blockrows=[[r['room'],f"{r['start_hour']}–{r['start_hour']+2}시",f"{r['both_hours_free']}/{r['days']}일",f"{r['both_hours_occupied']}/{r['days']}일"] for r in blocks]
    peakrows=[[r['room'],f"{r['occupancy_pct']:.1f}%",f"{r['old_price']:,}→{r['trial_price']:,}",f"{r['required_occupancy_pct']:.1f}%",won(r['monthly_max_change_even_at_full_capacity'])] for r in scenario['peak_capacity_limits']]
    e_room=next(r for r in json.loads((m.STORE/'analysis/room-periods.json').read_text()) if r['studio']=='리듬앤조이' and r['room']=='E홀')
    erows=[]
    for band,label in [('shoulder16_20','16~20시'),('peak20_22','20~22시'),('late22_24','22~24시')]:
        old,new=[e_room['stats'][y+'-05_09']['bands'][band] for y in ['2025','2026']]
        erows.append([label,f"{old['hours']:.0f}→{new['hours']:.0f}시간",f"{old['pct']:.1f}→{new['pct']:.1f}%",f"{100*(new['hours']/old['hours']-1):+.1f}%"])
    protocol={
        'status':'proposal_only_no_prices_changed',
        'day_prices_hold':{'A':10000,'B':8000,'C':4000,'D':3000,'E':8000},
        'first_trial':{'room':'E','hours':'weekday 16-19 and 22-24','old':12000,'new':10000},
        'second_trial':{'room':'A','hours':'weekday 16-20','old':20000,'new':16000},
        'later_trial':'A weekend edges at 18000, before any all-weekend reduction; assess central weekend demand separately.',
        'protected':'Existing receipts and 20-22 peak prices unchanged; new-receipt cohort only if approved later.',
        'success_metric':'Real recorded gross for target AND whole facility, adjusted for sellable hours and channel. Occupancy alone is insufficient.',
        'receipt_cohort':'Compare reservations received after activation; separate service date, paid price, platform, hours, refund/cancellation and booking amendment.',
        'review_window':'Operational review at 4 and 8 weeks; low sample is inconclusive, not evidence of no effect. No optimal price claim.',
        'rollback':'If target gross falls without a facility-level compensating increase, or gains are primarily unreplaced movement from other own slots, restore new-receipt price; do not reprice confirmed bookings.',
        'next_missing_evidence':'Naver impressions-to-pageviews-to-reservation conversion, cancellations, consented aggregate new/repeat customer labels, actual variable costs.'}
    m.save_json(P/'decision-protocol.json',protocol)
    body=f'''<header><p>저장 데이터 심층 분석 · 2026.10.01 · 가격 변경 없음</p><h1>얼마나 싸게 할까보다 먼저<br>어떤 예약과 매출이 사라졌는가</h1><p>2025년 1월~2026년 9월 자료를 재사용했습니다. 핵심 비교는 같은 5~9월, 경쟁 공통기간은 8~9월입니다. 우리 DB·경쟁 공개 캘린더·현재 요금의 증거 수준을 구분합니다.</p></header>
<section><h2>판단을 세 가지로 좁혔습니다</h2><p><b>① 낮 전면 추가 인하를 뒷받침하는 증거는 부족합니다. ② 감소는 A/E 예약 건수와 네이버 원장에 집중됩니다. ③ 할인은 피크를 보호하고 빈 시간에 좁게 적용해야 합니다.</b> 앞선 A 주말 전체 할인안보다 E의 19~20시를 보호하는 시험, A 평일 16~20시 시험을 먼저 검토할 것을 권합니다. A 주말 하락도 실제 문제이므로 다음 단계에서 별도로 평가합니다.</p><p>기본 이용률은 예약 시간의 합집합/판매 가능 시간입니다. 매출 분해는 금액이 확인된 예약행의 수·길이·기록금액으로 계산합니다. 두 계산의 시간 분모가 달라 섞지 않았습니다.</p></section>
<section><h2>1. 가격 인하보다 예약 건수 감소가 큰 문제입니다</h2><p>5개월 원장 매출은 3,845.4만→3,399.6만 원입니다. 유료예약행 <b>2,127→1,781건(−16.3%)</b>, 평균 길이 <b>2.10→2.00시간(−4.7%)</b>, 실효 기록단가는 <b>8,603→9,528원/시간(+10.8%)</b>입니다.</p><img src="deep-revenue.png" draggable="false" alt="매출 건수 길이 단가 분해와 채널별 월별 변화">
<p>매출=건수×평균길이×실효단가를 변경 순서 여섯 가지로 대칭 분해하면 건수 −643.5만, 길이 −173.7만, 실효단가 +371.3만 원으로 합계 −445.8만 원입니다. <b>단가 요인이 수요 감소를 일부 상쇄했습니다.</b> 이는 회계적 분해이며 요금 인상이 수요 감소를 일으켰다는 인과 증명은 아닙니다.</p>{table(['방','유료예약행','건수 변화','평균 예약 길이','실효 단가 변화','원장 매출 변화'],roomrows)}
<p>A/E는 예약행 감소가 큽니다. D는 건수가 늘어도 예약 길이가 짧아져 매출이 줄었습니다. 따라서 모든 방에 동일한 할인 처방을 적용할 이유가 없습니다. 2~3시간 예약의 매출 감소는 368.1만 원으로 전체 감소의82.6%이고, 4시간 이상 감소는66.6만 원입니다. 장시간 대관만 회복해서 해결되는 구조도 아닙니다.</p><p>방·순수 시간대·길이를 같은 집단으로 나눠도 평균단가 상승은 남습니다. 공통84개 집단에서 단가 변화는 +1,493원/시간, 이용구성 변화는 −586원/시간입니다. 해당 공통집단이 유료시간의97.4%/99.2%를 포함합니다. 개별 집단 안에서도 할인·상품구성은 남으므로 이것을 순수 가격효과로 읽지 않습니다.</p></section>
<section><h2>실제 단가 변화: E홀은 시간대별 결과가 다릅니다</h2><p>같은 네이버 채널에서 온전히 평일 16~24시에 들어가는 정확히 2시간 예약만 비교해도, 2025년 12월 26건은 모두 시간당 1만 원, 2026년 1월 19건은 모두 1만2천 원입니다. 넓힌 저녁 표본에서도 같은 전환이 관측됩니다. 이는 <b>2026년 1월 이용분부터 실효단가 상승이 관측된다는 근거</b>이며 정책 적용일 자체를 확인한 것은 아닙니다.</p>{table(['E홀 평일 구간','5개월 이용시간 전년→올해','이용률 전년→올해','시간 변화'],erows)}<p>단가 상승 20%에 비해 피크 이용 감소는 11.2%이지만, 16~20시는 60.6%, 22~24시는 81.6% 감소했습니다. 피크와 주변 시간에 동일한 가격 정책이 적합한지 구분해서 시험할 이유입니다. 인상 단가가 관측된 2026년 1월에는 E 원장매출이 오히려 전년보다 23.3만 원 늘어, 인상 직후 모든 수요가 무너졌다는 설명은 맞지 않습니다.</p><p>순수 20~22시 예약의 원장매출은 증가했지만 경계를 넘는 예약이 줄면서 순수 예약 비중이 바뀔 수 있습니다. 위 표는 이를 피하려고 경계 예약까지 포함한 합집합 시간으로 다시 대조했습니다. 1만 원 시험안은 과거 관측단가를 참고한 가설이며 가격을 되돌리면 수요도 돌아온다는 보장은 없습니다.</p></section>
<section><h2>2. 네이버 예약 감소를 먼저 진단해야 합니다</h2>{table(['원장 채널','유료예약행','작년 5개월 매출','올해 5개월 매출','변화'],chanrows)}
<p><b>네이버 −559만 원, 스페이스클라우드 +113.2만 원</b>입니다. E는 네이버만 −241.1만 원이고 스페이스클라우드는 사실상 유지(+0.32만 원)했습니다. 전체 5개월 감소의89.5%가 7~9월에 집중됩니다.</p><p>우선 볼 것은 네이버의 노출·상세페이지 방문·예약 전환·취소 중 어느 단계가 줄었는지입니다. 현재 저장 원장에는 이 유입 지표가 없어 원인을 확정할 수 없습니다. ‘네이버 표기 예약 감소’는 확인됐지만 검색 노출 하락, 고객 이탈, 다른 채널 이동 중 하나로 단정하지 않습니다. 예약행을 고객 수로 해석하지도 않습니다.</p></section>
<section><h2>3. 시장 침체를 빼고도 우리 약화가 남습니다</h2>{table(['연습실','8~9월 전체 시간 전년비','같은 기간 10~24시 전년비','새벽 시간 변화'],marketrows)}
<p>앞선 화이트룸 +12% 설명은 시간구성 보완이 필요합니다. 증가한44시간보다 새벽 증가80시간이 더 큽니다. 10~24시는 −7.3%입니다. 에이블은 전체 −5.1%이지만 10~24시는 +2.1%입니다. <b>우리 10~24시 −26.9%는 경쟁14개 방 합산 −5.5%보다 훨씬 큽니다.</b></p><img src="deep-market.png" draggable="false" alt="우리와 경쟁 14개 방 시간대별 전년 이용률 변화">
<p>공급시간을 맞춘 비교에서 우리 추가 하락은 낮 −7.7%p, 16~20시 −16.9%p, 토·일 −8.9%p입니다. 피크20~22시는 오히려 경쟁군 대비 +1.7%p입니다. 업체마다 같은 가중치를 주거나 방별 중앙값, 모호한 제목을 제외해도 낮·16~20·주말 약화 방향이 유지됩니다. 이는 차이를 설명하는 비교 기준이며 경쟁군 변화가 우리에게 그대로 발생했을 것이라는 증명은 아닙니다.</p><p>A와 크기가 비슷한 대형 비교군으로 좁혀도 8~9월 토·일 이용률은 A76.9→44.9%, 경쟁4개 평균58.9→61.2%입니다. A 주말 문제를 지역 전체의 불황만으로 설명하기 어렵습니다. 시설 품질·접근성·고객 목적 차이는 아직 통제하지 못했습니다.</p></section>
<section><h2>4. B/E 낮 할인 효과는 계절과 분리하면 약해집니다</h2>{table(['대상','올해 단순 전후','작년 계절 변화 제거','D&S C 변화도 제거'],cutrows)}
<p>5/1~7/15 대비7/16~9/30, 평일10~16시 기준입니다. B/E 합산은 올해 +9.35%p이지만 작년 같은 계절에도 +9.00%p여서 차이는 <b>+0.35%p</b>입니다. 시설5방 전체는 계절 대비 −4.61%p입니다. 할인으로 전체 수요가 늘었다고 확인되지 않았습니다.</p><p>B는 개선 신호가 있으나 인하 전 순수낮 원장은 단2건·4시간입니다. 비교창을4~6월→8~9월로 바꾸고 D&S C를 대조하면 +9.15%p가 −7.18%p로 바뀝니다. E도 내부 C/D를 비교군으로 고르면 부호가 바뀝니다. <b>8개 기간창·10개 비교군에서 결과가 가정에 민감해 가격 탄력성이나 최적가를 추정하지 않았습니다.</b></p><p>E는 작년 같은 후기간에도 순수 낮 유료예약의 실효단가가8천 원이었습니다. 같은8천 원인데45건·90시간·72만 원에서25건·51시간·40.8만 원으로 줄었습니다. 평일 수를 보정한 하루 원장매출도40% 감소했습니다. 가격 이외의 수요 약화를 함께 봐야 합니다. 전후 비교는 이용일 기준이며 신규접수일부터 적용되는 정책 효과와 정확히 일치하지 않습니다.</p></section>
<section><h2>5. ‘싼 경쟁사’는 인원수에 따라 달라집니다</h2>{table(['비교','8명','10명','12명','해석'],[
 ['우리 B/E 낮','8,000','8,000','8,000','15~16평, 인원 추가금 없음'],
 ['에이블 A/B/C 낮','5,000','7,000','9,000','10평, 8명 초과 추가금 산술'],
 ['콘스탄틴 A 12~16시','7,500','9,500','11,500','17평, 8명 초과 추가금 산술'],
 ['우리 B/E 저녁','12,000','12,000','12,000','현재 기본요금'],
 ['콘스탄틴 A 18~24시','8,500','10,500','12,500','12명이면 우리 기본요금이 더 낮음']])}<p>단위는 원/시간, 실제 허용 정원과 예약 인원 분포는 미확인입니다. 저인원 고객에게는 총액이 비싸고 큰 단체에게는 인원추가금 없음이 장점일 수 있습니다. 인원수가 없는 상태에서 전체 고객에게 같은 할인을 주면 이미 경쟁력 있는 단체의 매출까지 깎습니다.</p><p>A 주말2만 원은 에이블 D22평의 공식1만2천/플랫폼1만3천 원보다 높습니다. 에이블 D는25명까지 기본이어서 일반적인 인원 가산으로 차이가 없어지지 않습니다. A를1만8천 원으로 내려도 여전히38~50% 높습니다. 따라서1만8천 원은 경쟁가격 일치안이 아니라 작은 폭의 반응 시험안입니다. D&S 추가인원 조건은 미확정으로 기본가만 비교했습니다.</p></section>
<section><h2>6. 빈 시간은 실제로 연속해서 남아 있습니다</h2>{table(['방','평일 2시간 구간','두 시간 모두 빈 날','두 시간 모두 찬 날'],blockrows)}
<p>2026년5~9월 공휴일 제외101일 기준입니다. E16~18은85일,17~19는76일,22~24는88일 모두 비었습니다. 1시간씩 쪼개진 공실 때문에 못 파는 것만은 아닙니다. 대체 구간은 겹치므로 위 행을 합쳐 총공실로 계산하지 않습니다.</p><p>E의20~22가 모두 찬83일 중22~23이 빈 날은71일입니다. A도 핵심시간이 찬76일 중19~20이 빈 날이64일입니다. 핵심시간 요금은 지키면서 앞뒤 연장 수요를 시험할 후보가 있습니다. 다만 같은 고객의 연속예약인지와 연장 의사는 일정만으로 알 수 없습니다.</p>{table(['방','현재 20~22 이용률','가정한 가격 인하','매출 유지에 필요한 이용률','완판해도 월 최대 증감'],peakrows)}<p>B/E를1만 원으로 내리면103~104%가 필요합니다. 피크구간 자체 매출은 완판해도 기존 기본요금 환산액에 못 미칩니다. 다른 시간의 추가 매출과 비용은 별도입니다.</p></section>
<section><h2>7. 할인 범위를 줄이면 손실을 통제할 수 있습니다</h2>{table(['시험 범위','시간당 가격','현재 이용률','수요 그대로면 월 감소','이동 없는 추가시간','추가분50%가 자사 이동이면'],trials)}
<p><b>수정 제안:</b> E16~19·22~24를1만 원으로 먼저 시험하고19~20·20~22를 보호합니다. 다음 후보는 A평일16~20을1만6천 원으로 시험하는 것입니다. A주말은 전체할인에 앞서10~12·20~24 한정안을 비교합니다. 낮A1만/B8천/C4천/D3천/E8천 원은 우선 유지합니다.</p><p>좁히는 선택에도 단점이 있습니다. E18~20 두 시간 총액은 통할인2만 원 대신2만2천 원이 되어 매력도가 약해질 수 있습니다. A주말 중앙12~20에서도306→227시간으로 줄었으므로 끝시간 할인만으로 중앙 수요가 돌아오지는 않습니다. 낮은 손익분기만으로 최적상품이라 판단하지 않습니다.</p><img src="deep-scenarios.png" draggable="false" alt="자사 예약 이동 비중에 따른 가격 시험 매출 시나리오">
<p>추가 판매 중 일부가 다른 자사 방·시간에서 옮겨오고 원래 자리가 다시 팔리지 않으면 효과가 작아집니다. E는 이동 없을 때월2.32시간, 절반이이동이면5.8시간이 필요합니다. A평일은1.5시간과4.0시간입니다. 같은 할인대상 안의 시간 이동은 순증에 포함하지 않아 이중 차감하지 않습니다. 그래프 이동비중은 관측 결과가 아닌 가정입니다.</p><p>두 시험에서 각각월10시간을 더 팔아도 이동이 없다는 조건의 환산 개선은 <b>월21.28만 원</b>입니다. 현재 원장 감소 월89.16만 원의 약24% 규모입니다. 절반이자사 이동이면월5.28만 원으로 줄어듭니다. 현재요금 환산과 과거 원장 차이를 비교한 규모 예시이며 실현매출 예측은 아닙니다. <b>가격 조정만으로 감소분 전체를 회복한다고 약속할 수 없습니다.</b></p></section>
<section><h2>8. 실행한다면 판단 기준부터 고정해야 합니다</h2><p>시험은 순차적으로 시작합니다. 신규접수일부터 적용하고 기존예약 금액은 유지합니다. 4주·8주에 해당 구간과 시설전체 원장매출을 같이 보며 판매 가능시간·채널·취소를 분리합니다. 예약이 적으면8주도 결론을 내리기 부족할 수 있습니다. 표본이 적다는 이유를 할인 실패 또는 성공으로 바꾸지 않습니다.</p><p>대상구간 매출이 줄고 다른 구간 증가도 없다면 신규예약 할인은 복원 후보입니다. 대상 이용이 늘어도 시설매출이 늘지 않고 다른 방 감소와 겹치면 이전 수요일 수 있어 확대하지 않습니다. 피크가격은 유지합니다. 가격 변경과 함께 노출·사진·광고를 동시에 바꾸면 원인 분리가 어려우므로 변경 시점도 따로 기록해야 합니다.</p><p>다음에 필요한 자료는 네이버 노출→방문→예약 전환과 취소율, 개인정보를 노출하지 않는 신규/재방문 집계, 실제 변동비입니다. 지금 자료로는 순이익 최적화·재방문 고객 이탈·가격의 인과효과를 확정할 수 없습니다.</p></section>
<section><h2>검증·재사용·한계</h2><p>이번에도 예약/경쟁 캘린더를 재수집하지 않았습니다. 기존 시간 합집합·공휴일·원장 구분을 재사용했고, 새 분석은 매출 분해·비교군 민감도·빈자리·조건부 가격 시나리오에만 한정했습니다. 입력 해시, 시간·매출 분할 합계, 원장 재대조, 시나리오 산식과 최대 공급 제약을 검증했습니다. 기존예약 불변·금액 임의안분 금지·키키제외를 유지했습니다.</p><p>원장 금액이 없는5개월 예약은2025년92건,2026년45건을 제외했습니다. 유료행시간 커버리지는93.5%→96.4%입니다. 매출은 감사한 현금수납·순이익이 아닙니다. 경쟁 캘린더는 차단·내부사용이 섞일 수 있고 가격이력 적용일은 미확인입니다. 운영 변경이 없어 배포/운영 회귀시험은 하지 않았습니다.</p><p><a href="report.html">기본 방별 비교 보고서</a> · <a href="../../../state/competitor-occupancy/dataset/analysis/deep/revenue-decomposition.json">매출 분해</a> · <a href="../../../state/competitor-occupancy/dataset/analysis/deep/price-effect.json">가격 전후 민감도</a> · <a href="../../../state/competitor-occupancy/dataset/analysis/deep/market-comparison.json">시장·인원별 비교</a> · <a href="../../../state/competitor-occupancy/dataset/analysis/deep/scenarios.json">시나리오</a> · <a href="../../../state/competitor-occupancy/dataset/analysis/deep/decision-protocol.json">제안 의사결정 기준</a></p></section>'''
    style='''body{margin:0;background:#f2f5f8;color:#21344b;font:16px/1.8 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif}main{max-width:1240px;margin:auto;padding:28px}header{background:#153951;color:#fff;padding:36px;border-radius:15px}header p{color:#d2e3ee}h1{font-size:35px;line-height:1.4}h2{font-size:24px;color:#164d69}section{background:#fff;border:1px solid #dce4eb;border-radius:12px;padding:28px;margin-top:20px}.scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:11px;border-bottom:1px solid #e0e8ed;vertical-align:top;text-align:left}th{background:#edf4f8;white-space:nowrap}td:first-child{font-weight:600;white-space:nowrap}img{max-width:100%;height:auto;display:block;margin:24px auto;-webkit-user-drag:none;user-select:none}a{color:#007e7b}b{color:#125571}@media(max-width:700px){main{padding:12px}header,section{padding:18px}h1{font-size:27px}table{min-width:690px}}'''
    output=O/'deep-report.html'
    output.write_text('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>리듬앤조이 가격 심층 분석</title><style>'+style+'</style><main>'+body+'</main></html>')
    m.save_json(P/'manifest.json',{'input_hashes':{n:m.digest((P/n).read_bytes()) for n in files},
             'decision_protocol_sha256':m.digest((P/'decision-protocol.json').read_bytes()),
             'report_hashes':{str(f.relative_to(m.ROOT)):m.digest(f.read_bytes()) for f in [output,*sorted(O.glob('deep-*.png'))]},
             'code_sha256':m.digest(Path(__file__).read_bytes()),'network_disabled':True,'operations_changed':False})
    print(json.dumps({'report':str(output),'inputs':len(files),'charts':3},ensure_ascii=False))


if __name__=='__main__':
    with patch('socket.socket.connect',side_effect=AssertionError('offline deep report attempted network')):run()
