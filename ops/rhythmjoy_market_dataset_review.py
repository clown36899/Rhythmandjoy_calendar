#!/usr/bin/env python3
"""Offline coverage, cohort and validation report for the saved market archive.

Run after rhythmjoy_market_dataset.py build. This file never fetches sources.
"""
import collections
import html
import json
import re
from datetime import datetime
from pathlib import Path

import rhythmjoy_market_dataset as m


def reference(catalog, source_id):
    source = next(s for s in catalog['sources'] if s['id'] == source_id)
    snap = m.latest_snapshot(source)
    raw = (m.STORE / snap['path']).read_bytes()
    assert m.digest(raw) == snap['sha256']
    return json.loads(raw), snap


def review():
    catalog = json.loads((m.STORE / 'catalog.json').read_text())
    verification = m.verify(catalog)
    events = [json.loads(x) for x in (m.STORE / 'normalized/events.jsonl').open()]
    quarantined = [json.loads(x) for x in (m.STORE / 'normalized/quarantine.jsonl').open()]
    months = json.loads((m.STORE / 'normalized/coverage-months.json').read_text())
    audits = json.loads((m.STORE / 'normalized/source-audit.json').read_text())
    audit_by_id = {x['source_id']: x for x in audits}
    baseline, baseline_snap = reference(catalog, 'baseline-months')
    diagnosis, diagnosis_snap = reference(catalog, 'baseline-diagnosis')
    prior, prior_snap = reference(catalog, 'verification-prior')
    price_data, price_snap = reference(catalog, 'price-current')
    july_prices, july_snap = reference(catalog, 'price-july2026')
    by_month = {(r['studio'], r['room'], r['month']): r for r in months}
    crosscheck = []
    for room in baseline['rooms']:
        for month, value in room['stats'].items():
            if not re.fullmatch(r'\d{4}-\d{2}', month) or value is None:
                continue
            current = by_month[(room['studio'], room['room'], month)]['observed_hours']
            old = value['all24']['hours']
            crosscheck.append({'studio': room['studio'], 'room': room['room'], 'month': month,
                               'prior_hours': old, 'new_hours': current, 'match': abs(old-current) < 1e-3})
    assert all(x['match'] for x in crosscheck)
    money_checks = []
    for month, previous in diagnosis['revenue']['months'].items():
        if not re.fullmatch(r'\d{4}-\d{2}', month):
            continue
        rows = [e for e in events if e['studio'] == '리듬앤조이' and e['start'].startswith(month)]
        current = sum(e['actual_gross'] or 0 for e in rows)
        money_checks.append({'month': month, 'prior': previous['recordedGross'], 'current': current,
                             'match': abs(previous['recordedGross']-current) < 1e-6})
    assert all(x['match'] for x in money_checks)

    # Price observations preserve date seen separately from date effective.
    # No competitor historical effective date has been established.
    prices = []
    for row in price_data['rooms']:
        prices.append({**row, 'observed_on': price_data['checkedDate'], 'effective_from': None,
                       'historical_application_allowed': False, 'evidence_sha256': price_snap['sha256']})
    cohorts = []
    for source in catalog['sources']:
        if source.get('comparability') == 'excluded':
            continue
        if source['kind'] not in ('calendar', 'db') or source['id'] == 'rhythmjoy-db-gap':
            continue
        sid = source['id']
        room_names = sorted({e['room'] for e in events if e['source_id'] == sid})
        room_names = room_names or list(source.get('room_patterns', {})) or [source['room']]
        for room in room_names:
            rows = [e for e in events if e['source_id'] == sid and e['room'] == room]
            monthly = [x for x in months if x['source_id'] == sid and x['room'] == room]
            p = next((p for p in prices if p['studio'] == source['studio'] and p['room'] == room.split(' (')[0]), {})
            status, start, end = 'excluded', None, None
            reason = '대상 기간 기록 없음 또는 공개 자료 접근 불가'
            geography = '사당역 비교군'
            if sid == 'rhythmjoy-db':
                status, start, end, reason = 'own_db', '2025-01', '2026-09', '운영 DB 기준. 307건 추정금액 및 관리자 2건은 원장 매출과 분리'
            elif sid.startswith('able-'):
                status, start, end, reason = 'local_conditional', '2025-08', '2026-09', '2025년 1~7월 부족. 제목 시간 해석 민감도 분석 필요'
            elif sid in ['dns-'+x for x in 'abcdefgs']:
                status, start, end, reason = 'local_conditional', '2025-01', '2026-09', '21개월 연속 관측. 제목 시간 해석 민감도 분석 필요'
            elif sid in ['dns-'+x for x in 'vwxyz']:
                status, start, end, reason = 'historical_only', '2025-01', '2025-09', '2025년 10월 24~25일 이후 기록 중단. 최근 추세 비교 제외'
            elif sid == 'white-main':
                status, start, end, reason = 'local_conditional', '2025-02', '2026-09', '시간 명시 일정. 2025년 1월 미관측. 20평 표기와 실사용 45㎡ 구분, 시간대 요금 미확인'
            elif sid == 'factory-main':
                status, reason = 'hold_sparse', '16개월에 소수 기록만 관측. 실제 운영·기록 완전성 미확인; 낮은 점유율 근거로 사용 금지'
            size = p.get('size')
            if sid == 'white-main':
                size = 20
            size_group = '면적 미확인' if size is None else '대형 18~25평' if size >= 18 else '중형 13~17평' if size >= 13 else '소중형 9~10평' if size >= 9 else '소형 4~7평'
            cohorts.append({'source_id': sid, 'studio': source['studio'], 'room': room,
                            'geography': geography, 'size_pyeong_advertised': size, 'size_group': size_group,
                            'status': status, 'comparison_candidate_start': start, 'comparison_candidate_end': end,
                            'reason': reason, 'record_count': len(rows),
                            'first_observed': min((e['start'] for e in rows), default=None),
                            'last_observed': max((e['start'] for e in rows), default=None),
                            'months_observed': sum(x['record_count'] > 0 for x in monthly),
                            'ambiguous_time_count': sum('meridiem_not_explicit' in e['flags'] for e in rows),
                            'source_url': source.get('discovered_from', source['url']),
                            'calendar_complete_verified': False if source['kind'] == 'calendar' else None,
                            'actual_competitor_revenue_available': False})
    for p in prices:
        if p['studio'] == '콘스탄틴':
            cohorts.append({'source_id': None, 'studio': p['studio'], 'room': p['room'], 'status': 'price_only',
                            'size_pyeong_advertised': p['size'], 'size_group': '가격만 비교', 'record_count': 0,
                            'months_observed': 0, 'reason': '현재 방별 요금 확보; 과거 공개 달력 미확보',
                            'source_url': p['source'], 'comparison_candidate_start': None,
                            'comparison_candidate_end': None, 'ambiguous_time_count': 0})

    own = [e for e in events if e['studio'] == '리듬앤조이']
    checks = {'current_integrity': verification, 'monthly_hours': crosscheck, 'monthly_money': money_checks,
              'baseline_hours_sha256': baseline_snap['sha256'], 'baseline_money_sha256': diagnosis_snap['sha256'],
              'prior_snapshot_check_sha256': prior_snap['sha256'],
              'july_october_aug_sep2025_calendar_stability': prior['historicalAugSep2025JulyVsOctober'],
              'raw_event_end_markers_and_counts': True, 'unique_ids': True,
              'interval_union_vs_independent_minute_grid': len(months),
              'own_amount_evidence_counts': dict(collections.Counter(e['amount_evidence'] for e in own)),
              'own_overlap_room_months': [{k: r[k] for k in ['room', 'month', 'overlap_hours']}
                                        for r in months if r['studio'] == '리듬앤조이' and r['overlap_hours'] > 0],
              'quarantine_reasons': dict(collections.Counter(e['reason'] for e in quarantined)),
              'ambiguous_time_records': sum('meridiem_not_explicit' in e['flags'] for e in events),
              'meaning': '수집 무결성과 계산 일치 검증. 공개 달력의 예약 전체 포함 여부나 실제 수납 검증을 뜻하지 않음'}
    review_dir = m.STORE / 'review'
    price_history = {'verified_effective_date_changes': [], 'historical_observations': [],
                     'checked_on': '2026-10-01', 'search_result': '날짜가 명시된 가격 변경 공지는 확인하지 못함. 추가 추정 없이 보류.',
                     'rule': '관측일과 적용일을 분리. 업체·방·채널·시간대가 다른 두 가격을 인상 이력으로 확정하지 않음.'}
    for room, old in july_prices['priceTables']['able'].items():
        current = next(p for p in prices if p['studio'] == '에이블' and p['room'] == room.split(' (')[0])
        price_history['historical_observations'].append({
            'studio': '에이블', 'room': room, 'observed_on': '2026-07-16', 'effective_from': None,
            'channel': '공식 홈페이지 요금표 이미지', 'weekday_before16': old['before'],
            'weekday_after16': old['after'], 'weekend': old['weekend'], 'dawn_package': old['night'],
            'evidence_sha256': m.latest_snapshot(next(s for s in catalog['sources'] if s['id']=='price-able-july-image'))['sha256'],
            'current_spacecloud_evening': current['evening'],
            'current_official_table_evening': current['officialEveningWeekend'],
            'judgment': '현재 조사에서도 홈페이지 표와 플랫폼 예약가 차이 존재. 관측된 채널 차이를 시점별 인상으로 간주하지 않음.'})
    for room, old in july_prices['priceTables']['dns'].items():
        if room[0] not in 'ABCDEFGS':
            continue
        price_history['historical_observations'].append({
            'studio': '디앤에스', 'room': room, 'observed_on': '2026-07-16', 'effective_from': None,
            'channel': '클럽스페이스 공개 안내', 'displayed_hourly_from': old['before'], 'dawn_package': old['night'],
            'weekday_after16_explicit': 7000 if room == 'A홀' else None,
            'evidence_sha256': m.latest_snapshot(next(s for s in catalog['sources'] if s['id']=='price-dns-july-page'))['sha256'],
            'judgment': '다른 채널의 현재 결제가격과 직접 연결 불가. 기본 표시가를 모든 시간의 과거 가격으로 확장하지 않음.'})
    price_history['derived_july_reference_sha256'] = july_snap['sha256']
    price_history['unavailable_history'] = ['화이트룸', '콘스탄틴', '팩토리']
    m.save_json(review_dir / 'price-history-evidence.json', price_history)
    m.save_json(review_dir / 'crosschecks.json', checks)
    m.save_json(review_dir / 'cohorts.json', cohorts)
    m.save_json(review_dir / 'price-observations.json', prices)
    m.save_json(review_dir / 'data-dictionary.json', {
        'period': ['2025-01-01', '2026-10-01 exclusive'], 'timezone': 'Asia/Seoul',
        'actual_gross': '리듬앤조이 플랫폼 원장 기록금액. 은행 수납·순매출·순이익 아님. 경쟁사는 null.',
        'historical_estimated_gross': '과거 보정 추정액. 실제 원장 매출 합계에서 제외.',
        'observed_hours': '받은 일정 중 해석 가능한 시간의 합집합. 공개 달력에서는 유료 실대관 시간으로 확정 불가.',
        'occupancy_if_full_month_available_pct': '24시간 매일 운영·기록 완전성을 가정한 조건부 수치. 비관측 월은 null.',
        'meridiem_not_explicit': '종일 일정 제목에 1-3처럼 오전/오후 없는 시각. 원해석 보존, 시간대 비교에서 제외/포함 민감도 확인.',
        'coverage_flag': '자료 검토 우선순위. 10건 미만은 검토 대상이며 낮은 수요나 누락이 확정된 것은 아님.',
        'comparison_candidate': '기간 연속성이 있는 비교 후보. 영업일·유료 예약·공간 시설이 동등하다는 확정 아님.',
        'prices': '관측일과 적용일 분리. 인원추가금·패키지·공휴일·채널을 반영해야 현재가격 환산 가능.',
        'reuse': 'collect는 명시적 최초 수집용. build, verify 및 review는 네트워크 없이 저장본만 사용.',
        'protection': '운영 DB·예약·원장금액·기존 예약 가격·큐·사이트를 변경하지 않음. 원본 버전을 SHA256별로 보존.',
        'future_analysis': ['고정 방/기간 표본으로 같은 달 전년 비교', '새벽·낮·저녁20~22·저녁주변·주말 분리',
                            '방 크기와 인원추가금 반영', '가격변경 전후 예약접수일·이용일·실효단가 분리',
                            '현재요금 환산액과 원장매출 분리', '시간 해석 모호성 제외/포함 민감도',
                            '가격 인하율별 매출 유지에 필요한 이용시간 증가율 계산; 인과효과 확정 금지']})

    esc = lambda value: html.escape(str(value))
    rows = ''.join('<tr>' + ''.join(f'<td>{esc(v)}</td>' for v in [r['studio'], r['room'],
        r['size_group'], f"{r['record_count']:,}", f"{r['months_observed']}개월",
        (str(r['comparison_candidate_start'])+'~'+str(r['comparison_candidate_end'])) if r.get('comparison_candidate_start') else '보류',
        r['ambiguous_time_count'], r['reason']]) + '</tr>' for r in cohorts)
    price_rows = ''.join('<tr>' + ''.join(f'<td>{esc(p.get(k,""))}</td>' for k in ['studio','room','weekday','weekend','package','extra']) + '</tr>' for p in prices)
    checks_text = f'원본·오류응답 {verification["snapshot_hashes_verified"]}개 해시 확인 · 월별 시간 {len(crosscheck)}건 일치 · 원장 월별 금액 {len(money_checks)}건 일치 · {len(months)}개 방·월 합집합/분 단위 대조'
    report = f'''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>리듬앤조이 가격 연구 · 수집 검증 자료</title><style>
body{{font:15px/1.65 system-ui,sans-serif;color:#202b3b;background:#f4f6fa;margin:0}}main{{max-width:1440px;margin:auto;padding:36px 28px}}h1{{font-size:30px}}h2{{margin-top:32px;font-size:21px}}p{{max-width:1100px}}.box{{padding:22px;background:white;border:1px solid #dce3ed;border-radius:10px;margin:18px 0}}.numbers{{font-size:21px;color:#173e7a}}.scroll{{overflow-x:auto}}table{{border-collapse:collapse;width:100%;font-size:13px;background:white}}th,td{{padding:10px;text-align:left;border-bottom:1px solid #dde3eb;vertical-align:top}}th{{background:#eaf0f8;white-space:nowrap}}a{{color:#174d9a}}code{{background:#e8edf5;padding:2px 5px}}img{{-webkit-user-drag:none}}@media print{{main{{padding:0}}body{{background:white}}table{{font-size:10px}}}}
</style><main><p>자료 기준일 2026.10.01 · 한국시간 · 수집 및 검증 단계</p>
<h1>2025년부터 저장한 자료로 가격을 비교합니다</h1>
<p>사용자 지정 범위: <b>2025년 1월~2026년 9월, 완료된 21개월</b>. 리듬앤조이는 운영 DB를 기준으로, 비교 연습실은 공개 구글 캘린더와 공식 요금표를 저장했습니다. 원본에는 이전 기록도 보존하되 분석 범위에는 넣지 않습니다.</p>
<div class="box numbers">일정·예약 {len(events):,}건 · 분석에 보류한 일정 {len(quarantined)}건 · 실제 관측된 방 {len(set((e['studio'],e['room']) for e in events))}개</div>
<p><b>{checks_text}</b></p>
<p>위 검증은 수집 내용과 계산이 일치한다는 뜻입니다. 공개 일정이 실제 유료 예약을 모두 담고 있다는 증명은 아닙니다. 리듬앤조이도 원장 기록금액과 과거 추정금액을 분리했습니다.</p>
<h2>비교군과 사용할 수 있는 기간</h2><p>기록 없는 달은 점유율 0%로 간주하지 않습니다. 2025년 10월에 기록이 끊긴 D&S 5개 홀은 최근 비교에서 제외합니다. 키키는 광진구 소재로 사용자 요청에 따라 비교군·일정 집계·가격 비교에서 제외했습니다. 원본만 보관합니다.</p>
<div class="scroll"><table><thead><tr><th>연습실</th><th>방</th><th>규모</th><th>일정 수</th><th>관측 월</th><th>비교 후보 기간</th><th>오전/오후 모호</th><th>판정 근거</th></tr></thead><tbody>{rows}</tbody></table></div>
<h2>현재 요금 관측표</h2><p>아래 금액은 2026년 10월 1일 확인한 현재 안내입니다. 경쟁사 과거 적용일은 미확인으로 저장했습니다. 현재 요금을 과거 일정에 적용하면 ‘현재요금 환산액’이며 과거 실제 매출이 아닙니다. 화이트룸·팩토리는 시간대별 요금 미확인으로 이 표에서 제외했습니다.</p>
<div class="scroll"><table><thead><tr><th>연습실</th><th>방</th><th>평일, 원/시간</th><th>주말·공휴일</th><th>패키지</th><th>추가인원</th></tr></thead><tbody>{price_rows}</tbody></table></div>
<h2>상대 연습실 가격 이력 확인</h2><p>2026년 7월 16일 저장된 에이블 공식 요금표 이미지와 D&S 클럽스페이스 안내를 원본까지 보존했습니다. 과거 가격 관측 {len(price_history['historical_observations'])}건을 저장했지만 적용일이 명시된 변경 이력은 확인하지 못했습니다.</p>
<p>에이블 공식 표의 저녁 가격 A/B/C 7,000원·D 12,000원·E 6,000원과 스페이스클라우드의 현재 예약 가격은 다릅니다. 현재 조사에도 홈페이지 표와 플랫폼 가격 차이가 나타나므로 이것만으로 인상을 확정하면 안 됩니다. D&S 역시 과거 클럽스페이스 기본 표시가와 현재 다른 플랫폼의 시간별 결제가는 구분했습니다. 화이트룸·콘스탄틴·팩토리의 변경일은 미확인으로 두고 넘어갑니다.</p>
<h2>검증에서 분리한 자료</h2><p>보류 사유: {esc(checks['quarantine_reasons'])}. 별도로 오전/오후가 명시되지 않은 제목 {checks['ambiguous_time_records']:,}건에 표식을 남겼습니다. 시간대 비교에서는 이 기록의 제외/포함 결과를 함께 확인해야 합니다.</p>
<p>리듬앤조이 금액 근거: {esc(checks['own_amount_evidence_counts'])}. platform_ledger만 원장 기록 매출로 합산하고 과거 추정금액은 따로 둡니다. 기존 예약은 현재 가격으로 다시 계산하지 않습니다. DB에서 겹친 일정은 7개 방·월, 29시간이며 이용시간에는 한 번만 반영했습니다. 서로 다른 원장 행의 금액은 임의 삭제하지 않아, 매출은 원장 기록액으로 해석해야 합니다.</p>
<h2>다음 분석에서 판단할 내용</h2><p>같은 방·같은 기간의 낮/저녁/새벽/주말을 비교하고, 실제 원장 매출·예약시간·실효단가를 나눕니다. 우리 가격 변경 전후를 비교군 변화와 함께 보되 계절·공간 차이·수집 범위 변화를 먼저 통제합니다. 경쟁사 실제 결제금액과 과거 가격이 없어, 가격 인하의 인과효과나 경쟁사 실제 매출을 확정할 수는 없습니다.</p>
<h2>저장 위치와 재사용</h2><p><code>state/competitor-occupancy/dataset/</code>에 원본·출처·정규화 자료·검증·가격 관측을 보관합니다. <code>raw/</code> 원본은 SHA256 이름으로 버전별 보존하며 이름·연락처는 정규화 분석본에 넣지 않습니다. 원본은 접근 권한을 제한한 로컬 자료입니다.</p>
<p>인터넷 재수집 없이: <code>python ops/rhythmjoy_market_dataset.py build</code> → <code>python ops/rhythmjoy_market_dataset.py verify</code> → <code>python ops/rhythmjoy_market_dataset_review.py</code>. 필요한 패키지는 <code>ops/requirements-market-research.txt</code>에 고정했습니다.</p>
<p><a href="../../../state/competitor-occupancy/dataset/review/cohorts.json">비교군 JSON</a> · <a href="../../../state/competitor-occupancy/dataset/review/crosschecks.json">교차검증 JSON</a> · <a href="../../../state/competitor-occupancy/dataset/review/price-observations.json">가격 관측 JSON</a> · <a href="../../../state/competitor-occupancy/dataset/review/price-history-evidence.json">가격 이력 근거 JSON</a></p>
<p>운영 DB·예약·가격 정책·작업 큐·사이트 배포 변경 없음. 연구 데이터 저장·검증만 수행했습니다.</p></main></html>'''
    output = m.ROOT / 'output/research/market-dataset-2026-10-01'
    output.mkdir(parents=True, exist_ok=True)
    (output / 'report.html').write_text(report)
    manifest = {'period': catalog['requested_period'], 'catalog_sha256': m.digest((m.STORE/'catalog.json').read_bytes()),
                'files': {str(p.relative_to(m.STORE)): m.digest(p.read_bytes()) for p in sorted(review_dir.glob('*.json'))},
                'html_path': str((output/'report.html').relative_to(m.ROOT)), 'html_sha256': m.digest(report.encode()),
                'source_count': len(catalog['sources']), 'record_count': len(events), 'quarantine_count': len(quarantined)}
    manifest['code_sha256'] = {str(p.relative_to(m.ROOT)): m.digest(p.read_bytes()) for p in
                               [Path(__file__), Path(m.__file__), m.ROOT/'ops/rhythmjoy_market_dataset_selftest.py',
                                m.ROOT/'ops/requirements-market-research.txt']}
    m.save_json(m.STORE / 'review-manifest.json', manifest)
    print(json.dumps({'record_count': len(events), 'monthly_hours_matched': len(crosscheck),
                      'monthly_money_matched': len(money_checks), 'report': str(output/'report.html')}, ensure_ascii=False))


if __name__ == '__main__':
    review()
