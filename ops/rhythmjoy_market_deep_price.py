#!/usr/bin/env python3
"""Offline control and window sensitivity for the already aggregated July cohort.

This owns comparison adjustment only. Occupancy, calendar policy, interval union,
and paid cohort membership are reused from rhythmjoy_market_analysis outputs.
"""
import json
from pathlib import Path
from unittest.mock import patch

import rhythmjoy_market_dataset as m

ROOT = m.STORE / 'analysis'
OUT = ROOT / 'deep' / 'price-effect.json'


def run():
    inputs = [ROOT / n for n in ['room-periods.json', 'pure-day-ledger.json', 'validation.json']]
    rooms = json.loads(inputs[0].read_text())
    paid = json.loads(inputs[1].read_text())
    upstream = json.loads(inputs[2].read_text())
    for rel, sha in upstream['input_sha256'].items():
        assert m.digest((m.STORE / rel).read_bytes()) == sha
    index = {(r['studio'], r['room']): r for r in rooms}
    own = lambda names: [('리듬앤조이', x + '홀') for x in names]
    dns = lambda names: [('디앤에스', x + '홀') for x in names]
    groups = {
        'own_B': own('B'), 'own_E': own('E'), 'own_BE': own('BE'),
        'own_A': own('A'), 'own_C': own('C'), 'own_D': own('D'),
        'own_CD': own('CD'), 'own_ACD': own('ACD'), 'own_all': own('ABCDE'),
        'dns_C_13p': dns('C'), 'dns_10p_ADEF': dns('ADEF'),
        'dns_known_size7': dns('ABCDEFG'), 'dns_fixed8': dns('ABCDEFGS'),
        'white_20p': [('화이트룸', '단독홀')],
        'able_10p_ABC': [('에이블', x + '홀 (B1)') for x in 'ABC'],
        'able_all': [(r['studio'], r['room']) for r in rooms if r['studio'] == '에이블'],
    }
    controls = ['own_A', 'own_C', 'own_D', 'own_CD', 'own_ACD', 'dns_C_13p',
                'dns_10p_ADEF', 'dns_known_size7', 'dns_fixed8', 'white_20p']
    windows = {
        'exact_july16': (['pre_july'], ['post_july']),
        'may_jun_to_aug_sep': (['05', '06'], ['08', '09']),
        'apr_jun_to_aug_sep': (['04', '05', '06'], ['08', '09']),
        'jun_to_aug': (['06'], ['08']),
        'jun_to_sep': (['06'], ['09']),
        'may_jun_to_sep': (['05', '06'], ['09']),
        'placebo_may_to_jun': (['05'], ['06']),
        'placebo_feb_mar_to_may_jun': (['02', '03'], ['05', '06']),
    }

    def measure(group, year, labels, variant='bands'):
        rows = [index[key]['stats'][f'{year}-{label}'] for key in groups[group] for label in labels]
        if any(r is None for r in rows):
            return None
        hours = sum(r[variant]['day']['hours'] for r in rows)
        supply = sum(r[variant]['day']['supply'] for r in rows)
        return {'hours': hours, 'supply': supply, 'pct': 100 * hours / supply}

    def change(group, before, after, variant):
        levels = {str(y): {'pre': measure(group, y, before, variant),
                           'post': measure(group, y, after, variant)} for y in [2025, 2026]}
        if any(v is None for yy in levels.values() for v in yy.values()):
            return None
        delta = {y: levels[y]['post']['pct'] - levels[y]['pre']['pct'] for y in levels}
        return {'levels': levels, 'before_after_pp': delta,
                'season_adjusted_pp': delta['2026'] - delta['2025']}

    comparisons = []
    for name, (before, after) in windows.items():
        for variant in ['bands', 'unambiguous']:
            for target in ['own_B', 'own_E', 'own_BE']:
                tx = change(target, before, after, variant)
                crows = []
                for control in controls:
                    cx = change(control, before, after, variant)
                    if cx is None:
                        continue
                    adjusted = tx['season_adjusted_pp'] - cx['season_adjusted_pp']
                    crows.append({'control': control, **cx,
                                  'same_year_control_adjusted_pp': tx['before_after_pp']['2026'] - cx['before_after_pp']['2026'],
                                  'season_and_control_adjusted_pp': adjusted})
                comparisons.append({'window': name, 'variant': variant, 'target': target,
                                    'before_labels': before, 'after_labels': after, **tx,
                                    'control_sensitivity': crows})

    monthly = []
    for group in groups:
        for month in range(1, 10):
            levels = {str(y): measure(group, y, [f'{month:02}']) for y in [2025, 2026]}
            monthly.append({'group': group, 'month': month, 'levels': levels,
                            'yoy_pp': (levels['2026']['pct'] - levels['2025']['pct'])
                            if all(levels.values()) else None})

    pretrend = []
    for target in ['own_B', 'own_E', 'own_BE']:
        for control in controls:
            deltas = []
            for mo in range(1, 7):
                ts = [measure(target, y, [f'{mo:02}']) for y in [2025, 2026]]
                cs = [measure(control, y, [f'{mo:02}']) for y in [2025, 2026]]
                if any(r is None for r in ts + cs):
                    continue
                deltas.append({'month': mo, 'relative_yoy_gap_pp':
                               (ts[1]['pct'] - ts[0]['pct']) - (cs[1]['pct'] - cs[0]['pct'])})
            values = [r['relative_yoy_gap_pp'] for r in deltas]
            pretrend.append({'target': target, 'control': control, 'monthly_relative_yoy_gaps': deltas,
                             'preperiod_range_pp': max(values) - min(values),
                             'comment': 'Descriptive instability diagnostic; not proof of parallel trends or a statistical test.'})

    # Public calendar interpretation is varied only for competitors. The own DB
    # results must remain identical; ambiguity removal is not a confidence bound.
    own_checks = 0
    partition_checks = 0
    for r in rooms:
        for y in [2025, 2026]:
            a, b, whole = [r['stats'][f'{y}-{x}'] for x in ['pre_july', 'post_july', '05_09']]
            if any(z is None for z in [a, b, whole]):
                continue
            for variant in ['bands', 'unambiguous']:
                for key in ['hours', 'supply']:
                    assert abs(a[variant]['day'][key] + b[variant]['day'][key] - whole[variant]['day'][key]) < 1e-6
                    partition_checks += 1
        if r['studio'] == '리듬앤조이':
            for v in r['stats'].values():
                if v is not None:
                    assert v['bands']['day'] == v['unambiguous']['day']
                    own_checks += 1
    paid_index = {(r['room'], r['period']): r for r in paid}
    paid_checks = 0
    ledger_rows = []
    for room in 'ABCDE':
        for y in [2025, 2026]:
            a, b, total = [paid_index[(room + '홀', f'{y}-{p}')] for p in ['pre_july', 'post_july', '05_09']]
            for key in ['records', 'hours', 'recorded_gross']:
                assert a[key] + b[key] == total[key]
                paid_checks += 1
            if room not in 'BE':
                continue
            # Pure weekday 06-16 paid bookings are a deliberately narrower cash
            # cohort than union occupancy at 10-16. Do not divide one by the other.
            out = {'room': room + '홀', 'year': y, 'before': a, 'after': b}
            before_days = measure('own_' + room, y, ['pre_july'])['supply'] / 6
            after_days = measure('own_' + room, y, ['post_july'])['supply'] / 6
            out['before_gross_per_weekday'] = a['recorded_gross'] / before_days
            out['after_gross_per_weekday'] = b['recorded_gross'] / after_days
            out['gross_per_weekday_change_pct'] = 100 * (out['after_gross_per_weekday'] / out['before_gross_per_weekday'] - 1)
            ledger_rows.append(out)

    group_moves = {g: change(g, ['pre_july'], ['post_july'], 'bands')
                   for g in ['own_BE', 'own_ACD', 'own_all']}
    for year in ['2025', '2026']:
        for phase in ['pre', 'post']:
            assert group_moves['own_BE']['levels'][year][phase]['hours'] + group_moves['own_ACD']['levels'][year][phase]['hours'] == group_moves['own_all']['levels'][year][phase]['hours']

    able_readonly = {g: {'pre_2026': measure(g, 2026, ['pre_july']),
                         'post_2026': measure(g, 2026, ['post_july']),
                         'reason_not_full_control': '2025 January-July missing. Same-year changes cannot subtract normal summer seasonality.'}
                     for g in ['able_10p_ABC', 'able_all']}
    for r in able_readonly.values():
        r['same_year_change_pp'] = r['post_2026']['pct'] - r['pre_2026']['pct']

    robustness = []
    for target in ['own_B', 'own_E', 'own_BE']:
        for control in ['dns_C_13p', 'dns_fixed8', 'own_CD']:
            values = [{'window': r['window'], 'adjusted_pp': c['season_and_control_adjusted_pp']}
                      for r in comparisons if r['target'] == target and r['variant'] == 'bands'
                      and not r['window'].startswith('placebo_')
                      for c in r['control_sensitivity'] if c['control'] == control]
            seq = [r['adjusted_pp'] for r in values]
            robustness.append({'target': target, 'control': control, 'windows': values,
                               'min_pp': min(seq), 'max_pp': max(seq),
                               'sign_changes_across_windows': min(seq) < 0 < max(seq),
                               'interpretation': 'Window sensitivity only; extrema are not confidence limits.'})

    results = {
        'scope': '2025-2026 saved panel; weekday nonholiday 10-16 utilization; July16 service-date split',
        'ownership': 'Only control adjustment and sensitivity added; interval union, policy, membership and money classification reused.',
        'groups': {k: [{'studio': x, 'room': y} for x, y in v] for k, v in groups.items()},
        'formulas': {
            'occupancy': '100 * union booked hours / available room hours',
            'before_after': '2026 post minus 2026 pre, percentage points',
            'season_adjusted': '(2026 post-pre) - (2025 post-pre)',
            'season_and_control_adjusted': 'target season-adjusted change minus control season-adjusted change; descriptive triple difference only',
        },
        'comparisons': comparisons, 'monthly_panel': monthly, 'pretrend_diagnostics': pretrend,
        'window_robustness': robustness,
        'pure_day_ledger': ledger_rows, 'whole_facility_spillover_check': group_moves,
        'able_partial_context': able_readonly,
        'break_even_growth': [{'old_price': old, 'new_price': new, 'needed_hours_increase_pct': 100 * (old / new - 1)}
                             for old, new in [(10000, 8000), (8000, 7000), (8000, 6000), (10000, 6000)]],
        'limitations': [
            'Control groups are sensitivity choices, not randomly assigned controls. Parallel trends are not established; no causal estimate or optimal price follows.',
            'DNS C at 13p is the closest recorded size to own B16p/E15p, but room quality, access, awareness and customer mix differ.',
            'Own C/D are smaller and can receive or lose customers to B/E. Subtracting their slowdown may inflate apparent treatment gains.',
            'Own A also changed its new-booking price on September30, the final day in the post window; it is an auxiliary comparison, not a pristine untreated control.',
            'Competitor prices are observed snapshots without verified effective dates. Their calendar trends are controls for observed blocks, not proven untreated demand.',
            'July16 is a service-date window boundary, not confirmed homogeneous booking-acquisition exposure. Existing bookings may keep old rates; received_at coverage varies and created_at often records bulk import.',
            'Pure paid cohort is entirely weekday 06-16 bookings; occupancy cohort includes parts of mixed bookings at 10-16. Never label their money-per-occupancy-hour as realized price.',
            '2026 B pre pure-paid cohort has only 2 bookings/4 hours; percentage gains have a tiny denominator.',
            'E pure-paid rate was already 8000 in 2025, 10000 in 2026 pre, and 8000 in 2026 post. Same-rate last-year comparison is informative but is still confounded.',
            'Repeated customers, marketing, room substitution and competing supply changes are unobserved; no reliable elasticity or price needed to match a competitor can be estimated.',
            'Public calendar completeness is unverified. Unambiguous scenario removes flagged morning clocks and is an evidence subset, not a confidence interval.',
        ],
        'validation': {'offline': True, 'input_sha256': {str(p.relative_to(m.STORE)): m.digest(p.read_bytes()) for p in inputs},
                       'upstream_hashes_checked': len(upstream['input_sha256']),
                       'period_partition_checks': partition_checks, 'pure_paid_partition_checks': paid_checks,
                       'own_ambiguity_invariance_checks': own_checks, 'whole_facility_additivity_checks': 4,
                       'code_sha256': m.digest(Path(__file__).read_bytes())},
    }
    m.save_json(OUT, results)
    print(json.dumps({'path': str(OUT), 'validation': results['validation']}, ensure_ascii=False))


if __name__ == '__main__':
    with patch('socket.socket.connect', side_effect=AssertionError('offline analysis attempted network')):
        run()
