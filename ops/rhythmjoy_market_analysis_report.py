#!/usr/bin/env python3
"""Render pricing findings from saved analysis. No fetching or production changes."""
import html
import json
from pathlib import Path
from unittest.mock import patch

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager

import rhythmjoy_market_dataset as m

P=m.STORE/'analysis'
O=m.ROOT/'output/research/market-analysis-2026-10-01'
O.mkdir(parents=True,exist_ok=True)


def load(name):return json.loads((P/name).read_text())
def pct(x):return f'{x:.1f}%'
def won(x):return f'{x/10000:,.1f}만 원'
def table(headers,rows):
    return '<div class="scroll"><table><thead><tr>'+''.join('<th>'+html.escape(str(x))+'</th>' for x in headers)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+html.escape(str(x))+'</td>' for x in row)+'</tr>' for row in rows)+'</tbody></table></div>'


def run():
    rooms=load('room-periods.json');studios=load('studio-periods.json');hourly=load('hourly-profile.json');pure=load('pure-day-ledger.json')
    prices=json.loads((m.STORE/'review/price-observations.json').read_text())
    own=[r for r in rooms if r['studio']=='리듬앤조이']
    own.sort(key=lambda r:r['room'])
    total=next(r for r in studios if r['studio']=='리듬앤조이')
    before,after=total['stats']['2025-05_09'],total['stats']['2026-05_09']
    gross_loss=before['ledger']['recorded_gross']-after['ledger']['recorded_gross']
    band_labels={'dawn':'새벽 00–06','weekday06_10':'평일 06–10','day':'평일 낮 10–16',
                 'shoulder16_20':'평일 16–20','peak20_22':'평일 20–22','late22_24':'평일 22–24','off06_24':'주말·공휴일 06–24'}
    deltas={k:after['bands'][k]['hours']-before['bands'][k]['hours'] for k in band_labels}
    assert sum(deltas.values())==after['bands']['all24']['hours']-before['bands']['all24']['hours']
    losses=[{'room':r['room'],'old_gross':r['stats']['2025-05_09']['ledger']['recorded_gross'],
             'new_gross':r['stats']['2026-05_09']['ledger']['recorded_gross']} for r in own]
    for r in losses:
        r['loss']=r['old_gross']-r['new_gross'];r['share_of_total_loss']=r['loss']/gross_loss*100
    e_share=next(x['share_of_total_loss'] for x in losses if x['room']=='E홀')
    lost_hours=before['bands']['all24']['hours']-after['bands']['all24']['hours']
    day_loss_share=-deltas['day']/lost_hours*100
    own_by={r['room']:r for r in own}
    a_now=own_by['A홀']['stats']['2026-05_09']
    e_old,e_now=[own_by['E홀']['stats'][p] for p in ['2025-05_09','2026-05_09']]

    plt.rcParams.update({'font.family':'Apple SD Gothic Neo','axes.unicode_minus':False,'font.size':11,
                         'axes.spines.top':False,'axes.spines.right':False,'svg.fonttype':'none'})
    if not any(f.name=='Apple SD Gothic Neo' for f in font_manager.fontManager.ttflist):plt.rcParams['font.family']='DejaVu Sans'
    fig,(ax1,ax2)=plt.subplots(1,2,figsize=(13.2,4.6),gridspec_kw={'width_ratios':[.9,1.3]})
    ls=sorted(losses,key=lambda x:x['loss'],reverse=True)
    ax1.barh([x['room'] for x in ls],[x['loss']/10000 for x in ls],color=['#b94749']+['#8093a9']*4)
    ax1.invert_yaxis();ax1.set_xlim(0,285);ax1.set_xlabel('원장 기록 매출 감소액 (만 원)');ax1.set_title(f'매출 감소의 {e_share:.0f}%가 E홀',loc='left',fontweight='bold',pad=15)
    for i,x in enumerate(ls):ax1.text(x['loss']/10000+3,i,f"{x['loss']/10000:.1f}",va='center')
    ks=list(band_labels);vals=[deltas[k] for k in ks]
    ax2.barh([band_labels[k] for k in ks],vals,color=['#21867c' if x>=0 else '#b94749' for x in vals])
    ax2.invert_yaxis();ax2.axvline(0,color='#aab2bc',lw=.8);ax2.set_xlim(-430,90);ax2.set_xlabel('전년 대비 이용시간 변화 (시간)');ax2.set_title(f'감소한 시간 중 평일 낮은 {day_loss_share:.0f}%',loc='left',fontweight='bold',pad=15)
    for i,v in enumerate(vals):ax2.text(v-8 if v<0 else v+6,i,f'{v:+.0f}',ha='right' if v<0 else 'left',va='center')
    fig.suptitle('2025년 5–9월 ↔ 2026년 5–9월 · 리듬앤조이 DB',x=.04,ha='left',fontsize=14,y=1.02)
    fig.tight_layout(w_pad=3);fig.savefig(O/'loss-decomposition.png',dpi=170,bbox_inches='tight');plt.close(fig)

    fig,axs=plt.subplots(2,1,figsize=(13.2,6.2),layout='constrained')
    for ax,mode,title in zip(axs,['week','off'],['평일 (공휴일 제외)','주말·공휴일']):
        data=[next(x for x in hourly if x['studio']=='리듬앤조이' and x['room']==r['room'] and x['mode']==mode)['percent'][10:24] for r in own]
        im=ax.imshow(data,cmap='YlGnBu',vmin=0,vmax=100,aspect='auto')
        ax.set_yticks(range(5),[r['room'] for r in own]);ax.set_xticks(range(14),[f'{h}–{h+1}' for h in range(10,24)])
        ax.set_title(title,loc='left',fontweight='bold',pad=10)
        for i,row in enumerate(data):
            for j,v in enumerate(row):ax.text(j,i,f'{v:.0f}',ha='center',va='center',color='white' if v>=58 else '#213449',fontsize=10)
    fig.suptitle('시간대별 이용률 (%) · 2026년 5–9월 · 시간 겹침 제거',x=.035,ha='left',fontsize=14)
    fig.colorbar(im,ax=axs,label='이용률 (%)',shrink=.85,pad=.02)
    fig.savefig(O/'hourly-occupancy.png',dpi=170,bbox_inches='tight');plt.close(fig)

    trials=[]
    for name,bands,old,new,label in [('E홀',['shoulder16_20','late22_24'],12000,10000,'평일 16–20시·22–24시'),
                                      ('A홀',['off06_24'],20000,18000,'주말·공휴일 06–24시')]:
        r=next(r for r in own if r['room']==name);hrs=sum(r['stats']['2026-05_09']['bands'][b]['hours'] for b in bands)/5
        trials.append({'room':name,'band':label,'current_price':old,'trial_price':new,
                       'observed_hours_per_month':hrs,'required_hour_increase_pct':(old/new-1)*100,
                       'required_additional_hours_per_month':hrs*(old/new-1),
                       'same_hours_revenue_loss_per_month':hrs*(old-new),
                       'meaning':'앞으로 같은 시간량을 신규 단가에 판매하는 조건부 산술. 실현 매출/수요 예측/비용 포함 손익분기 아님.'})
    cuts=[]
    for name in ['B홀','E홀']:
        r=next(r for r in own if r['room']==name)
        row={'room':name}
        for year in ['2025','2026']:
            a,b=[r['stats'][year+'-'+phase+'_july']['bands']['day']['pct'] for phase in ['pre','post']]
            row[year]={'before_pct':a,'after_pct':b,'change_pp':b-a}
        row['season_adjusted_change_pp']=row['2026']['change_pp']-row['2025']['change_pp']
        row['pure_day_before']=next(x for x in pure if x['room']==name and x['period']=='2026-pre_july')
        row['pure_day_after']=next(x for x in pure if x['room']==name and x['period']=='2026-post_july')
        cuts.append(row)
    decisions={'recorded_gross_change_pct':(after['ledger']['recorded_gross']/before['ledger']['recorded_gross']-1)*100,
               'lost_hours_by_band':deltas,'room_revenue_losses':losses,'july_price_cut':cuts,'trial_scenarios':trials,
               'recommended_day_prices':{'A':10000,'B':8000,'C':4000,'D':3000,'E':8000},
               'recommendation':'추가 낮 일괄 인하를 보류. E 비핵심 저녁 10,000원, A 주말·공휴일 18,000원을 순차 시험. 평일 20~22시 유지.',
               'causality':'관찰 자료. 여름 계절성·이용자 이동·노출 변화·시설 차이와 가격 효과를 완전히 분리할 수 없음.',
               'prices_changed':False}
    if (P/'deep/decision-protocol.json').exists():
        decisions['recommendation_status']='initial_screening; refined by saved deep analysis'
        decisions['followup_analysis']='analysis/deep/decision-protocol.json'
    m.save_json(P/'pricing-decisions.json',decisions)

    own_rows=[]
    for r in own:
        s=r['stats']['2026-05_09'];old=r['stats']['2025-05_09'];p=next(p for p in prices if p['studio']==r['studio'] and p['room']==r['room'])
        own_rows.append([r['room'],f"{r['size_pyeong_advertised']}평",f"{decisions['recommended_day_prices'][r['room'][0]]:,}원",pct(s['bands']['day']['pct']),pct(s['bands']['peak20_22']['pct']),pct(s['bands']['satsun10_22']['pct']),won(s['ledger']['recorded_gross']/5),f"{(s['ledger']['recorded_gross']/old['ledger']['recorded_gross']-1)*100:+.1f}%"])
    market_rows=[]
    for s in studios:
        row=[s['studio'],s['room_count']]
        for per in ['05_09','08_09']:
            a,b=s['stats']['2025-'+per],s['stats']['2026-'+per]
            row.append(f"{(b['bands']['all24']['hours']/a['bands']['all24']['hours']-1)*100:+.1f}%" if a and b else '기록 부족으로 제외')
        a,b=s['stats']['2025-08_09'],s['stats']['2026-08_09']
        row+=[pct(a['bands']['day']['pct'])+' → '+pct(b['bands']['day']['pct'])]
        market_rows.append(row)

    def comparison(title,keys):
        rows=[]
        for studio,name in keys:
            r=next((r for r in rooms if r['studio']==studio and r['room'].split(' (')[0]==name),None)
            p=next((p for p in prices if p['studio']==studio and p['room']==name),{})
            if r:
                s=r['stats']['2026-05_09'];day=pct(s['bands']['day']['pct']);strict=s['unambiguous']['day']['pct']
                if abs(strict-s['bands']['day']['pct'])>.01:day+=f' / 엄격 {strict:.1f}%'
                rows.append([studio+' '+name,str(r['size_pyeong_advertised'])+'평',p.get('weekday','시간대 요금 미확인'),day,pct(s['bands']['peak20_22']['pct']),pct(s['bands']['satsun10_22']['pct'])])
            else:rows.append([studio+' '+name,str(p.get('size'))+'평',p.get('weekday','미확인'),'공개 이력 미확보','미확인','미확인'])
        return '<h3>'+title+'</h3>'+table(['공간','표시 면적','현재 평일 요금, 원/시간','평일 낮 10–16','평일 20–22','토·일 10–22'],rows)
    comp=comparison('대형 · A홀 비교',[('리듬앤조이','A홀'),('에이블','D홀'),('디앤에스','B홀'),('디앤에스','G홀'),('화이트룸','단독홀')])
    comp+=comparison('중형 · B/E홀 비교',[('리듬앤조이','B홀'),('리듬앤조이','E홀'),('디앤에스','C홀'),('콘스탄틴','A룸')])
    comp+=comparison('소형 · C/D홀 비교',[('리듬앤조이','C홀'),('리듬앤조이','D홀'),('에이블','E홀'),('콘스탄틴','C룸')])
    comp+=comparison('소중형 참고군 · 같은 10평·낮 5천 원',[('에이블',x+'홀') for x in 'ABC']+[('디앤에스',x+'홀') for x in 'ADEF'])
    cut_rows=[]
    for c in cuts:
        a,b=c['pure_day_before'],c['pure_day_after']
        cut_rows.append([c['room'],f"{c['2026']['before_pct']:.1f}% → {c['2026']['after_pct']:.1f}%",f"{a['records']}건 → {b['records']}건",won(a['recorded_gross'])+' → '+won(b['recorded_gross']),f"{c['season_adjusted_change_pp']:+.1f}%p"])
    equivalents=[]
    for st,rm in [('리듬앤조이','A홀'),('에이블','D홀 (B2)'),('디앤에스','B홀'),('디앤에스','G홀'),('리듬앤조이','B홀'),('리듬앤조이','E홀'),('디앤에스','C홀')]:
        r=next(r for r in rooms if r['studio']==st and r['room']==rm)
        equivalents.append([st+' '+rm,won(r['stats']['2026-05_09']['current_rate_equivalent_10_24']/5)])
    trial_rows=[[t['room'],t['band'],f"{t['current_price']:,} → {t['trial_price']:,}원",f"+{t['required_hour_increase_pct']:.1f}%",f"월 +{t['required_additional_hours_per_month']:.1f}시간",won(t['same_hours_revenue_loss_per_month'])] for t in trials]
    final_prices=table(['방','평일 낮 권고','다른 시간대 권고','근거'],[
        ['A','10,000원 유지','주말·공휴일 20,000→18,000원 시험 / 평일 20–22시 유지','낮 1만 원은 9/30 신규 접수부터여서 효과 판단 시기상조. 주말 감소가 큼.'],
        ['B','8,000원 유지','현재 저녁·주말 12,000원 유지','7월 인하 이후 낮 개선 신호. 7천 원 추가 인하의 필요성부터 확인.'],
        ['C','4,000원 유지','현재 저녁·주말 6,000원 유지','가격 유지 중 낮 이용 증가. 에이블 E와 낮 이용률도 비슷.'],
        ['D','3,000원 유지','현재 저녁·주말 5,000원 유지','가장 싼 총액, 우리 방 중 가장 높은 낮 이용률.'],
        ['E','8,000원 우선 유지','평일 16–20시·22–24시 12,000→10,000원 시험 / 20–22시 12,000원 유지','전체 감소 매출의 54%. 낮보다 비핵심 저녁에서 줄어든 시간이 큼.']])
    body=f'''<header><p>2026.10.01 · 저장 자료 분석 · 운영 가격 변경 없음</p><h1>낮을 더 내리기보다<br>E홀 비핵심 저녁과 A홀 주말부터</h1><p>2025년 1월~2026년 9월 저장본 중, 비교 가능한 19개 방을 분석했습니다. 키키·기록이 중단된 D&S 5개 홀·검증이 부족한 팩토리는 분석에서 제외했습니다.</p></header>
<section><h2>현재 판단</h2><p><b>낮 가격은 A 10,000 / B 8,000 / C 4,000 / D 3,000 / E 8,000원을 우선 유지할 것을 권합니다.</b> 가격 시험의 우선 대상은 E홀 평일 16–20시·22–24시(12,000→10,000원), A홀 주말·공휴일(20,000→18,000원)입니다. 데이터가 증명한 최적가격이 아니라, 현재 가격 격차와 빈 시간·매출 감소를 근거로 정한 시험안입니다.</p>
<div class="metrics"><div><b>{won(after['ledger']['recorded_gross'])}</b><span>최근 5개월 원장 매출<br>전년 대비 {decisions['recorded_gross_change_pct']:.1f}%</span></div><div><b>{e_share:.1f}%</b><span>전체 매출 감소액 중<br>E홀의 비중</span></div><div><b>{day_loss_share:.1f}%</b><span>줄어든 {lost_hours:,.0f}시간 중<br>평일 낮 10–16시 비중</span></div></div>
<p>최근 5개월은 2026년 5~9월이며, 전년 비교도 2025년 같은 달입니다. 1~9월 누적 원장 매출도 6,248.9만→5,804.5만 원(-7.1%)으로 감소해 5개월만 고른 결과는 아닙니다.</p></section>
<section><h2>1. 우리 방별로 어디가 약한가</h2>{table(['방','면적','현재 낮 요금','낮 이용률','20–22시 이용률','토·일 이용률','월평균 원장 매출','매출 전년비'],own_rows)}
<p><b>이용률 = 해당 구간에 예약이 차지한 시간 ÷ 그 구간의 판매 가능 시간.</b> 낮은 공휴일을 뺀 평일 10–16시, 저녁 핵심은 평일 20–22시, 토·일은 10–22시입니다. 예를 들어 A홀 낮 {a_now['bands']['day']['pct']:.1f}%는 최근 5개월의 평일 10–16시 {a_now['bands']['day']['supply']}시간 중 {a_now['bands']['day']['hours']:.0f}시간이 찼다는 뜻입니다. 24시간 전체를 분모로 삼아 저녁이 비었다고 해석하지 않았습니다. 전 구간 영업 가능을 가정한 관측 이용률이며 공개 달력에 빠진 예약·휴업 정보는 확인할 수 없습니다.</p>
<p>A/B/E의 20–22시는 83~87%로 유지됩니다. 반면 E의 16–20시는 {e_old['bands']['shoulder16_20']['pct']:.1f}→{e_now['bands']['shoulder16_20']['pct']:.1f}%, 22–24시는 {e_old['bands']['late22_24']['pct']:.1f}→{e_now['bands']['late22_24']['pct']:.1f}%로 하락했습니다. A의 토·일 10–22시는 72.9→47.9%로 떨어졌습니다.</p>
<img src="hourly-occupancy.png" alt="리듬앤조이 방별 시간대 이용률" draggable="false"></section>
<section><h2>2. 낮만 싸게 해서는 감소분을 메우기 어렵다</h2><img src="loss-decomposition.png" alt="방별 매출 감소 및 시간대별 이용시간 변화" draggable="false">
<p>전체 이용시간은 4,775→3,700시간(-22.5%), 원장 매출은 3,845.4→3,399.6만 원(-11.6%)입니다. 시간당 기록금액과 상품 구성 변화가 이용 감소를 일부 상쇄했습니다. 시간 감소와 매출 감소를 같은 비율로 보지 않습니다.</p>
<p>시간 감소는 주말·공휴일 {-deltas['off06_24']:.0f}시간, 평일 16–20시 {-deltas['shoulder16_20']:.0f}시간, 22–24시 {-deltas['late22_24']:.0f}시간, 20–22시 {-deltas['peak20_22']:.0f}시간, 새벽 {-deltas['dawn']:.0f}시간입니다. 평일 낮 감소는 {-deltas['day']:.0f}시간이며 이른 오전은 {deltas['weekday06_10']:.0f}시간 늘었습니다. 이 구간들은 서로 겹치지 않고 합계가 전체 감소 {lost_hours:,.0f}시간과 일치합니다.</p></section>
<section><h2>3. 경쟁사도 모두 나빠졌나</h2>{table(['연습실','고정 방 수','5~9월 이용시간 전년비','8~9월 이용시간 전년비','8~9월 낮 이용률 전년→올해'],market_rows)}
<p>공통 8~9월에 우리 -24.0%, D&S -16.9%, 에이블 -5.1%, 화이트룸 +11.7%로 방향과 크기가 다릅니다. <b>이 표본에서는 시장 전체가 똑같이 무너졌다는 설명이 맞지 않습니다.</b> 다만 공개 일정은 유료 예약·내부 사용·차단 시간을 완전히 구분하지 못하며, 몇 업체만으로 경기 전체를 확정할 수 없습니다.</p>
<p>D&S의 모호한 오전/오후 제목을 제외해도 5~9월 감소가 -11.7%에서 -9.0%, 8~9월은 -16.9%에서 -12.7%로 남습니다. 방향은 유지됩니다. 에이블의 2025년 1~7월 부족분을 공실로 채우거나, 중단된 D&S 홀을 최근 비교에 넣지 않았습니다.</p></section>
<section><h2>4. 크기가 비슷한 방의 가격과 이용률</h2><p>이용률은 2026년 5~9월, 가격은 2026년 10월 1일 저장한 관측값입니다. 이 가격이 5개월 내내 적용됐다고 가정하지 않습니다. ‘엄격’ 수치는 오전/오후가 불명확한 제목을 제외한 보수적 관측값이며 통계적 신뢰구간은 아닙니다.</p>{comp}
<p>같은 10평·낮 5천 원도 에이블 A/B/C의 낮 이용률은 32~39%, D&S A/D/E/F는 9~31%입니다. 가격 하나만으로 이용률이 결정되지 않는다는 근거입니다. B/E를 7천 원으로 바꾸면 에이블처럼 찬다는 계산은 이 자료에서 만들 수 없습니다.</p>
<p>우리 방은 인원 추가금이 없고, 에이블 A/B/C는 8명, D는 25명, E는 4명 초과 시 1인·시간당 1천 원이 붙습니다. 콘스탄틴 A/B/C는 8/6/4명 초과 기준입니다. 실제 허용 정원과 단체 규모를 확인해야 하며, 예약 인원 분포는 이번 자료에 없어 가정으로 매출에 더하지 않았습니다. 화이트룸은 표시 20평과 실사용 바닥 45㎡가 달라 면적 해석에 주의합니다.</p></section>
<section><h2>5. 경쟁사 매출과 비교할 수 있는 범위</h2><p><b>경쟁사의 실제 수납 매출은 확보하지 못했습니다.</b> 아래는 같은 방식으로 ‘기록된 10–24시 시간 × 현재 기본요금’을 적용한 월평균 환산액입니다. 경쟁사 실제 매출로 읽으면 안 됩니다. 새벽·추가인원·할인·패키지·플랫폼 수수료는 제외했습니다.</p>{table(['방','현재 요금 기준 10–24시 월평균 환산액'],equivalents)}
<p>A홀은 낮 이용률이 에이블 D보다 낮지만, 이 단순 환산액은 둘 다 약 226만 원입니다. 높은 단가가 낮은 이용량을 상쇄하는 구조를 보여 줍니다. <b>점유율을 맞추려고 A홀 모든 시간을 한꺼번에 싸게 만드는 것은 매출 목표와 맞지 않을 수 있습니다.</b></p>
<p>에이블은 현재도 공식 홈페이지 표와 스페이스클라우드 요금이 다릅니다. 예를 들어 D홀은 공식 표 저녁 12,000원, 플랫폼 관측 13,000~14,000원입니다. 위 환산에는 플랫폼 시간별 요금을 일관되게 썼습니다. 7월 저장표와 차이가 나더라도 채널 차이를 제거할 수 없어 가격 인상 이력으로 확정하지 않았습니다.</p></section>
<section><h2>6. 7월 B/E 낮 인하는 어떻게 나타났나</h2>{table(['방','낮 이용률 인하 전→후','낮 전용 유료 예약 수','낮 전용 원장 매출','작년 계절 변화를 뺀 이용률 변화'],cut_rows)}
<p>전 기간은 5/1~7/15, 후 기간은 7/16~9/30입니다. 평일 공급일수 차이를 반영한 이용률입니다. 원장 매출 열은 평일 06–16시에 온전히 들어가는 유료 예약만 합쳤으며, 경계를 넘는 예약은 금액을 임의 안분하지 않고 제외했습니다. 따라서 이 열은 전체 낮 매출이 아닙니다.</p>
<p>B는 {cuts[0]['pure_day_before']['records']}건→{cuts[0]['pure_day_after']['records']}건으로 개선 신호가 있지만 인하 전 표본이 작습니다. E는 인하 후 매출이 늘었어도 작년 여름 상승폭보다 작았습니다. 가격 변경 없는 C/D도 같은 5개월 전년 비교에서 낮 이용이 늘었습니다. 계절·방 간 이동·노출 변화와 가격만의 효과를 완전히 분리할 수 없어 가격 탄력성이나 최적가를 추정하지 않았습니다. DB created_at은 대량 이관 시간이 섞여 있어 예약 접수일로 사용하지 않았습니다.</p>
<p>A홀 1만 원은 9/30 신규 접수부터 적용된 정책입니다. 9월의 낮 이용률로 이 가격의 성패를 평가할 수 없습니다. 실제 외부 채널 노출 이후의 신규 예약 금액을 보고 판단해야 합니다.</p></section>
<section><h2>7. 권고 가격과 매출 유지 조건</h2>{final_prices}
<h3>두 시험의 최소 목표</h3>{table(['방','시험 시간','가격','매출 유지에 필요한 이용 증가','현재량 기준 추가 시간','이용량 그대로면 월 감소액'],trial_rows)}
<p>최근 5개월 이용시간이 앞으로도 비슷하고, 해당 시간 전체를 신규 단가로 판매한다고 가정한 계산입니다. E는 월 약 {trials[0]['required_additional_hours_per_month']:.1f}시간, A는 약 {trials[1]['required_additional_hours_per_month']:.1f}시간을 더 팔아야 현재 기본가 환산 매출을 유지합니다. 이용량이 늘지 않으면 두 시험 합계 약 {sum(t['same_hours_revenue_loss_per_month'] for t in trials)/10000:.1f}만 원/월이 줄어듭니다. 수요 증가 예측이나 비용을 포함한 손익분기점은 아닙니다.</p>
<p>인하폭을 작게 시작하는 이유도 있습니다. A를 2만→1만8천 원으로 내리면 이용시간이 11.1% 더 필요하지만, 1만6천 원까지 내리면 25%가 필요합니다. E를 1만2천→1만 원으로 내리면 20%, 8천 원까지 내리면 50%가 더 필요합니다. 해당 시간 수요가 그만큼 늘어난다는 근거가 아직 없어 큰 폭의 할인은 권하지 않습니다.</p>
<p><b>실행 순서 제안:</b> E 비핵심 저녁부터, 다음으로 A 주말을 순차 시험합니다. 6~8주 동안 해당 구간의 실제 원장 매출과 연습실 전체 매출을 함께 봅니다. 다른 방이나 기존 시간에서 이동한 예약은 순증으로 계산하지 않습니다. 월평균 환산 기준으로 E는 최소 +5시간, A는 최소 +7시간이 첫 매출 유지 목표이며, 계절·공휴일 수가 다르면 공급시간으로 보정합니다. 기존 접수 예약의 금액은 유지하고 신규 접수만 새 정책으로 구분해야 합니다.</p>
<p>이번 작업은 분석과 권고만 수행했습니다. 운영 가격·예약·원장·플랫폼을 변경하지 않았습니다.</p></section>
<section><h2>검증과 파일</h2><p>저장본만 사용해 네트워크를 차단한 상태에서 계산했습니다. 363개 방·월 이용시간이 수집 검증본과 일치했고, 각 시간의 겹침 제거를 분 단위로 다시 대조했습니다. 우리 21개월 원장 합계는 기존 검증 결과와 일치합니다. 시간 합계와 개별 구간의 분해도 일치합니다. 원장 추정금액·관리자 금액 미수집 건은 실제 원장 매출에 섞지 않았습니다.</p>
<p>5~9월 금액 근거가 있는 예약은 2025년 2,127건, 2026년 1,781건입니다. 각각 92건·45건은 추정 또는 금액 미수집으로 매출 합계에서 제외했습니다. 따라서 본문의 매출은 전체 수납을 감사한 확정 매출이 아니라 비교 가능한 원장 기록액입니다. 이용시간은 금액 근거와 별개로 저장된 일정의 겹침을 제거해 계산했습니다.</p>
<p>원본 보호와 중복 방지는 기존 데이터셋 구조를 재사용했습니다. 가격 변경 시험이나 운영 회귀시험은 수행하지 않았으며, 운영을 바꾸지 않은 분석이므로 배포도 하지 않았습니다.</p>
<p>날짜 분류 검증에서 사용 라이브러리의 2026년 공휴일 변경 누락을 발견했습니다. <a href="https://www.mpm.go.kr/mpm/comm/newsPress/newsPressRelease/?cntId=4250&amp;mode=view">인사혁신처 공식 발표</a>를 원본으로 저장하고 5월 1일·7월 17일을 모든 방에 동일하게 공휴일로 분류했습니다. 기존 공휴일 판정 구조와 원본 보관 기능을 재사용했으며, 예약·금액을 바꾸는 예외는 넣지 않았습니다. 2025년 해당 날짜·2026년 일반 평일·추가 공휴일 경계, 전체 시간과 원장 금액 보존을 확인했습니다. 보정 전 안내한 낮 감소 비중 6.2%는 최종 {day_loss_share:.1f}%로 정정합니다.</p>
<p><a href="../../../state/competitor-occupancy/dataset/analysis/pricing-decisions.json">권고 및 조건부 계산 JSON</a> · <a href="../../../state/competitor-occupancy/dataset/analysis/room-periods.json">방별·기간별 집계 JSON</a> · <a href="../../../state/competitor-occupancy/dataset/analysis/pure-day-ledger.json">가격 인하 전후 원장 집계</a> · <a href="../../../state/competitor-occupancy/dataset/analysis/validation.json">분석 검증</a> · <a href="../market-dataset-2026-10-01/report.html">수집 검증 보고서</a></p>
<p>공개 가격 출처: <a href="https://www.spacecloud.kr/space/53353">에이블</a> · <a href="https://www.spacecloud.kr/space/30144">D&S 1호점</a> · <a href="https://www.spacecloud.kr/space/48504">D&S 2호점</a> · <a href="https://www.spacecloud.kr/space/35203">콘스탄틴</a> · <a href="https://www.spacecloud.kr/space/26324">화이트룸</a>. 이번 분석에서는 저장한 출처를 재사용했습니다.</p></section>'''
    style='''body{margin:0;background:#f3f5f8;color:#203247;font:16px/1.75 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif}main{max-width:1260px;margin:auto;padding:28px}header{background:#17344e;color:white;padding:35px;border-radius:16px}header p{color:#d5e4f2}h1{font-size:34px;line-height:1.35}h2{font-size:24px}h3{font-size:19px;margin-top:28px}section{background:white;border:1px solid #dce4ec;border-radius:12px;padding:28px;margin-top:20px}.metrics{display:flex;flex-wrap:wrap;gap:16px;margin:25px 0}.metrics>div{flex:1;background:#edf3f8;padding:20px;min-width:170px}.metrics b{font-size:28px;color:#174d70}.metrics span{display:block;font-size:14px}.scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #e1e8ef}th{background:#edf3f8;white-space:nowrap}td:first-child{font-weight:600;white-space:nowrap}a{color:#007586}img{display:block;max-width:100%;height:auto;margin:18px auto;-webkit-user-drag:none;user-select:none}@media(max-width:700px){main{padding:12px}section,header{padding:18px}h1{font-size:28px}table{min-width:700px}}@media print{main{padding:0}body{background:white}header{background:#edf3f8;color:#203247}header p{color:#203247}.scroll{overflow:visible}table{font-size:10px}td,th{padding:5px}section{break-inside:auto}}'''
    if (P/'deep/decision-protocol.json').exists():
        body=body.replace('</header>','</header><section><b>후속 심층 분석이 있습니다.</b> 채널·계절·자사 예약 이동을 추가 검토해 할인 범위를 좁혔습니다. 최신 가격 시험 제안은 <a href="deep-report.html">심층 보고서</a>를 보세요. 아래는 최초 비교 결과입니다.</section>',1)
    (O/'report.html').write_text('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>리듬앤조이 매출과 가격 분석</title><style>'+style+'</style><main>'+body+'</main></html>')
    manifest={'inputs':load('validation.json')['input_sha256'],
              'analysis_files':{str(p.relative_to(m.STORE)):m.digest(p.read_bytes()) for p in sorted(P.glob('*.json')) if p.name!='manifest.json'},
              'artifacts':{str(p.relative_to(m.ROOT)):m.digest(p.read_bytes()) for p in [O/n for n in ['report.html','hourly-occupancy.png','loss-decomposition.png']]},
              'code':{str(p.relative_to(m.ROOT)):m.digest(p.read_bytes()) for p in [Path(__file__),m.ROOT/'ops/rhythmjoy_market_analysis.py']}}
    m.save_json(P/'manifest.json',manifest)
    print(json.dumps({'report':str(O/'report.html'),'trials':trials,'gross_loss':gross_loss,'e_share':e_share},ensure_ascii=False))


if __name__=='__main__':
    with patch('socket.socket.connect',side_effect=AssertionError('offline report attempted network')):run()
