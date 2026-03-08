#!/usr/bin/env python3
"""
Ability Proxy Analysis: Transfer-Admit GPA as Robustness Check
==============================================================
Uses UCLA transfer admission 25th/75th percentile GPAs as a rough
proxy for student preparedness, then residualizes major difficulty
rankings to produce an ability-adjusted ranking.

THIS IS A ROUGH ROBUSTNESS CHECK, NOT A CAUSAL ESTIMATE.
Transfer-admit GPA is an imperfect proxy for enrolled student ability.
See methodology.md for full limitations.

Input:  data/processed/merged_major_difficulty_with_transfer_proxy.csv
Output: data/processed/ability_adjusted_rankings.csv

Usage:
    python3 scripts/analyze_ability_proxy.py
"""

import csv
import math
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)
MERGED_FILE = os.path.join(BASE_DIR, 'data', 'processed', 'merged_major_difficulty_with_transfer_proxy.csv')
OUTPUT_FILE = os.path.join(BASE_DIR, 'data', 'processed', 'ability_adjusted_rankings.csv')


def load_data():
    with open(MERGED_FILE) as f:
        rows = list(csv.DictReader(f))
    data = []
    for r in rows:
        if not r.get('ability_proxy_mid') or not r.get('avg_gpa'):
            continue
        try:
            data.append({
                'rank': int(r['rank']),
                'major': r['major'],
                'avg_gpa': float(r['avg_gpa']),
                'pct_A': float(r['pct_A']),
                'dfw_rate': float(r['dfw_rate']) if r.get('dfw_rate') else None,
                'ability_proxy_mid': float(r['ability_proxy_mid']),
                'transfer_gpa_25': float(r['transfer_gpa_25']) if r.get('transfer_gpa_25') else None,
                'transfer_gpa_75': float(r['transfer_gpa_75']) if r.get('transfer_gpa_75') else None,
                'transfer_admit_rate': float(r['transfer_admit_rate']) if r.get('transfer_admit_rate') else None,
                'transfer_applicants': int(r['transfer_applicants']) if r.get('transfer_applicants') else None,
            })
        except (ValueError, TypeError):
            continue
    return data


def pearson_r(xs, ys):
    n = len(xs)
    if n < 3:
        return 0, 1
    mx = sum(xs) / n
    my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    if sxx == 0 or syy == 0:
        return 0, 1
    r = sxy / math.sqrt(sxx * syy)
    # t-test for significance
    t = r * math.sqrt((n - 2) / (1 - r ** 2 + 1e-15))
    # Approximate p-value using normal for large n
    p = 2 * (1 - _norm_cdf(abs(t))) if n > 30 else None
    return r, p


def spearman_r(xs, ys):
    def rank_data(vals):
        indexed = sorted(enumerate(vals), key=lambda x: x[1])
        ranks = [0.0] * len(vals)
        i = 0
        while i < len(indexed):
            j = i
            while j < len(indexed) - 1 and indexed[j + 1][1] == indexed[j][1]:
                j += 1
            avg_rank = (i + j) / 2 + 1
            for k in range(i, j + 1):
                ranks[indexed[k][0]] = avg_rank
            i = j + 1
        return ranks
    return pearson_r(rank_data(xs), rank_data(ys))


def _norm_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def ols_regression(xs, ys):
    """Simple OLS: y = a + b*x. Returns (a, b, r_squared, residuals)."""
    n = len(xs)
    mx = sum(xs) / n
    my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    b = sxy / sxx if sxx != 0 else 0
    a = my - b * mx
    predicted = [a + b * x for x in xs]
    residuals = [y - p for y, p in zip(ys, predicted)]
    ss_res = sum(r ** 2 for r in residuals)
    ss_tot = sum((y - my) ** 2 for y in ys)
    r_sq = 1 - ss_res / ss_tot if ss_tot != 0 else 0
    return a, b, r_sq, residuals


def main():
    if not os.path.exists(MERGED_FILE):
        print(f"Missing: {MERGED_FILE}")
        print("Run: python3 scripts/merge_transfer_data.py first")
        sys.exit(1)

    data = load_data()
    n = len(data)

    print("=" * 72)
    print("ABILITY PROXY ANALYSIS: Transfer-Admit GPA as Robustness Check")
    print("=" * 72)
    print(f"\nThis is a ROUGH ROBUSTNESS CHECK, not a causal estimate.")
    print(f"Transfer-admit GPA is an imperfect proxy for enrolled student ability.\n")
    print(f"Majors with transfer GPA data: {n}")
    print(f"Majors without (excluded): {137 - n}")

    xs = [d['ability_proxy_mid'] for d in data]
    ys = [d['avg_gpa'] for d in data]

    # Correlations
    pr, pp = pearson_r(xs, ys)
    sr, sp = spearman_r(xs, ys)

    print(f"\n--- Correlations: avg_gpa vs ability_proxy_mid ---")
    print(f"  Pearson r  = {pr:+.3f}  (p {'< 0.001' if pp and pp < 0.001 else f'= {pp:.3f}' if pp else '~ N/A'})")
    print(f"  Spearman r = {sr:+.3f}  (p {'< 0.001' if sp and sp < 0.001 else f'= {sp:.3f}' if sp else '~ N/A'})")

    # OLS regression
    a, b, r_sq, residuals = ols_regression(xs, ys)

    print(f"\n--- OLS Regression: avg_gpa = a + b * ability_proxy_mid ---")
    print(f"  Intercept (a) = {a:.4f}")
    print(f"  Slope (b)     = {b:+.4f}")
    print(f"  R-squared     = {r_sq:.4f}")
    print(f"  Interpretation: {'positive' if b > 0 else 'negative'} slope means majors with "
          f"{'higher' if b > 0 else 'lower'}-ability transfer admits tend to have "
          f"{'higher' if b > 0 else 'lower'} GPAs.")

    # Build adjusted rankings
    for d, res in zip(data, residuals):
        d['residual'] = res
        d['adjusted_gpa'] = d['avg_gpa'] - res  # predicted value (what GPA "should be" given ability)

    # Rank by residual (most negative = hardest after adjusting for ability)
    data.sort(key=lambda d: d['residual'])
    for i, d in enumerate(data):
        d['adjusted_rank'] = i + 1

    print(f"\n--- Top 15 Hardest (after ability adjustment) ---")
    print(f"{'AdjRank':>7} {'OldRank':>7} {'Change':>7}  {'Major':<50} {'GPA':>5} {'Proxy':>5} {'Resid':>7}")
    for d in data[:15]:
        change = d['rank'] - d['adjusted_rank']
        print(f"{d['adjusted_rank']:>7} {d['rank']:>7} {change:>+7}  {d['major']:<50} {d['avg_gpa']:.3f} {d['ability_proxy_mid']:.2f} {d['residual']:>+7.4f}")

    print(f"\n--- Top 15 Easiest (after ability adjustment) ---")
    for d in data[-15:]:
        change = d['rank'] - d['adjusted_rank']
        print(f"{d['adjusted_rank']:>7} {d['rank']:>7} {change:>+7}  {d['major']:<50} {d['avg_gpa']:.3f} {d['ability_proxy_mid']:.2f} {d['residual']:>+7.4f}")

    # Notable movers
    data_by_change = sorted(data, key=lambda d: d['rank'] - d['adjusted_rank'], reverse=True)
    print(f"\n--- Biggest Rank Changes ---")
    print(f"{'AdjRank':>7} {'OldRank':>7} {'Change':>7}  {'Major':<50}")
    print("  Rose the most (harder than ability predicts):")
    for d in data_by_change[:5]:
        change = d['rank'] - d['adjusted_rank']
        print(f"{d['adjusted_rank']:>7} {d['rank']:>7} {change:>+7}  {d['major']}")
    print("  Dropped the most (easier than ability predicts):")
    for d in data_by_change[-5:]:
        change = d['rank'] - d['adjusted_rank']
        print(f"{d['adjusted_rank']:>7} {d['rank']:>7} {change:>+7}  {d['major']}")

    # Save
    data.sort(key=lambda d: d['adjusted_rank'])
    fieldnames = ['adjusted_rank', 'rank', 'rank_change', 'major', 'avg_gpa', 'pct_A', 'dfw_rate',
                  'ability_proxy_mid', 'transfer_gpa_25', 'transfer_gpa_75',
                  'transfer_admit_rate', 'transfer_applicants', 'residual']
    with open(OUTPUT_FILE, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for d in data:
            writer.writerow({
                'adjusted_rank': d['adjusted_rank'],
                'rank': d['rank'],
                'rank_change': d['rank'] - d['adjusted_rank'],
                'major': d['major'],
                'avg_gpa': round(d['avg_gpa'], 3),
                'pct_A': round(d['pct_A'], 1),
                'dfw_rate': round(d['dfw_rate'], 1) if d['dfw_rate'] is not None else '',
                'ability_proxy_mid': round(d['ability_proxy_mid'], 3),
                'transfer_gpa_25': d['transfer_gpa_25'],
                'transfer_gpa_75': d['transfer_gpa_75'],
                'transfer_admit_rate': d['transfer_admit_rate'],
                'transfer_applicants': d['transfer_applicants'],
                'residual': round(d['residual'], 4),
            })

    print(f"\nSaved ability-adjusted rankings: {OUTPUT_FILE}")
    print(f"\nDisclaimer: This uses transfer-admit GPA as a rough proxy for student")
    print(f"preparedness. It is not individual transcript data and does not control")
    print(f"for many confounders. See methodology.md for full limitations.")


if __name__ == '__main__':
    main()
