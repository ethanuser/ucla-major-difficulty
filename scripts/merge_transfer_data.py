#!/usr/bin/env python3
"""
Merge UCLA Transfer Admission Profile with Major Difficulty Rankings
====================================================================
Maps transfer major names to difficulty ranking names, then merges
the datasets for ability-proxy analysis.

Input:
    data/raw/ucla_transfer_profile_2025.csv
    data/processed/major_difficulty_rankings.csv
Output:
    data/processed/transfer_major_mapping.csv
    data/processed/transfer_unmatched_review.csv
    data/processed/merged_major_difficulty_with_transfer_proxy.csv

Usage:
    python3 scripts/merge_transfer_data.py
"""

import csv
import os
import re
import sys
from difflib import SequenceMatcher

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)
TRANSFER_FILE = os.path.join(BASE_DIR, 'data', 'raw', 'ucla_transfer_profile_2025.csv')
RANKINGS_FILE = os.path.join(BASE_DIR, 'data', 'processed', 'major_difficulty_rankings.csv')
MAPPING_FILE = os.path.join(BASE_DIR, 'data', 'processed', 'transfer_major_mapping.csv')
UNMATCHED_FILE = os.path.join(BASE_DIR, 'data', 'processed', 'transfer_unmatched_review.csv')
MERGED_FILE = os.path.join(BASE_DIR, 'data', 'processed', 'merged_major_difficulty_with_transfer_proxy.csv')

# Transfer names that map to ranking names in non-obvious ways
MANUAL_OVERRIDES = {
    'Applied Linguistics': 'Applied Linguistics BA',
    'Astrophysics': 'Astrophysics BS',
    'Atmospheric and Oceanic Sciences': 'Atmospheric and Oceanic Sciences BS',
    'Atmospheric and Oceanic Sciences/Mathematics': 'Atmospheric and Oceanic Sciences/Mathematics BS',
    'Biochemistry': 'Biochemistry BS',
    'Biology': 'Biology BS',
    'Biophysics': 'Biophysics BS',
    'Chemistry': 'Chemistry BS',
    'Chemistry/Materials Science': 'Chemistry/Materials Science BS',
    'Communication': 'Communication BA',
    'Computational Biology': 'Computational Biology BS',
    'Engineering Geology': 'Engineering Geology BS',
    'Environmental Science': 'Environmental Science BS',
    'Geology': 'Geology BS',
    'Geophysics': 'Geophysics BS',
    'Linguistics': 'Linguistics BA',
    'Marine Biology': 'Marine Biology BS',
    'Neuroscience': 'Neuroscience BS',
    'Physics': 'Physics BS',
    'Physiological Science': 'Physiological Science BS',
    'Statistics and Data Science': 'Statistics and Data Science BS',
    'Design | Media Arts': 'Design|Media Arts BA',
    'Nursing Prelicensure': 'Nursing BS Prelicensure',
    'Film and Television': 'Film and Television BA',
    'Theater': 'Theater BA',
    'Music Performance': 'Music Performance BM',
    'Music Education': 'Music Education BA',
    'Music Composition': 'Music Composition BA',
    'Music Industry': 'Music Industry BA',
    'Musicology': 'Musicology BA',
    'Ethnomusicology': 'Ethnomusicology BA',
    'Art': 'Art BA',
    'Dance': 'Dance BA',
    'World Arts and Cultures': 'World Arts and Cultures BA',
    'Architectural Studies': 'Architectural Studies BA',
    'Aerospace Engineering': 'Aerospace Engineering BS',
    'Bioengineering': 'Bioengineering BS',
    'Chemical Engineering': 'Chemical Engineering BS',
    'Civil Engineering': 'Civil Engineering BS',
    'Computer Engineering': 'Computer Engineering BS',
    'Computer Science': 'Computer Science BS',
    'Computer Science and Engineering': 'Computer Science and Engineering BS',
    'Electrical Engineering': 'Electrical Engineering BS',
    'Materials Engineering': 'Materials Engineering BS',
    'Mechanical Engineering': 'Mechanical Engineering BS',
    'Ecology, Behavior and Evolution': 'Ecology, Behavior, and Evolution BS',
    'Molecular, Cell, and Developmental Biology': 'Molecular, Cell, and Developmental Biology BS',
    'Microbiology, Immunology and Molecular Genetics, Pre': 'Microbiology, Immunology, and Molecular Genetics BS',
    'European Language and Transcultural Studies': 'European Languages and Transcultural Studies BA',
    'European Language and Transcultural Studies with French and Francophone': 'European Languages and Transcultural Studies with French and Francophone BA',
    'European Language and Transcultural Studies with German': 'European Languages and Transcultural Studies with German BA',
    'European Language and Transcultural Studies with Italian': 'European Languages and Transcultural Studies with Italian BA',
    'European Language and Transcultural Studies with Scandinavian': 'European Languages and Transcultural Studies with Scandinavian BA',
    'Study of Religion': 'Study of Religion BA',
    'Global Jazz Studies': 'Global Jazz Studies BA',
}


def normalize_transfer_name(name):
    """Strip ', Pre' suffix and normalize B.A./B.S. notation."""
    name = re.sub(r',\s*Pre$', '', name).strip()
    name = name.replace('B.A.', 'BA').replace('B.S.', 'BS')
    return name


def find_best_match(transfer_name, ranking_names, threshold=0.75):
    """Find best fuzzy match for a transfer name among ranking names."""
    normalized = normalize_transfer_name(transfer_name)

    # Try exact match first
    if normalized in ranking_names:
        return normalized, 'exact', 1.0

    # Try with common degree suffixes
    for suffix in ['BA', 'BS', 'BM', 'BFA']:
        candidate = f"{normalized} {suffix}"
        if candidate in ranking_names:
            return candidate, 'suffix_match', 1.0

    # Fuzzy match
    best_score = 0
    best_match = None
    for rn in ranking_names:
        score = SequenceMatcher(None, normalized.lower(), rn.lower()).ratio()
        if score > best_score:
            best_score = score
            best_match = rn

    if best_score >= threshold:
        return best_match, 'fuzzy', best_score

    return None, 'unmatched', best_score


def main():
    for f in (TRANSFER_FILE, RANKINGS_FILE):
        if not os.path.exists(f):
            print(f"Missing: {f}")
            sys.exit(1)

    with open(TRANSFER_FILE) as f:
        transfer_rows = list(csv.DictReader(f))
    with open(RANKINGS_FILE) as f:
        ranking_rows = list(csv.DictReader(f))

    ranking_names = {r['major'] for r in ranking_rows}
    ranking_by_name = {r['major']: r for r in ranking_rows}

    mapping = []
    unmatched = []
    matched_count = 0

    for tr in transfer_rows:
        raw_name = tr['major_name_raw']

        if raw_name in MANUAL_OVERRIDES:
            rankings_name = MANUAL_OVERRIDES[raw_name]
            if rankings_name in ranking_names:
                match_type = 'manual'
                score = 1.0
            else:
                match_type = 'manual_missing'
                score = 0.0
                rankings_name = None
        else:
            rankings_name, match_type, score = find_best_match(raw_name, ranking_names)

        mapping.append({
            'transfer_name': raw_name,
            'rankings_name': rankings_name or '',
            'match_type': match_type,
            'match_score': round(score, 3),
        })

        if match_type in ('unmatched', 'manual_missing'):
            unmatched.append(mapping[-1])
        elif match_type == 'fuzzy' and score < 0.85:
            unmatched.append(mapping[-1])
        else:
            matched_count += 1

    # Save mapping
    with open(MAPPING_FILE, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['transfer_name', 'rankings_name', 'match_type', 'match_score'])
        writer.writeheader()
        writer.writerows(mapping)
    print(f"Saved mapping: {MAPPING_FILE}")

    # Save unmatched for review
    with open(UNMATCHED_FILE, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['transfer_name', 'rankings_name', 'match_type', 'match_score'])
        writer.writeheader()
        writer.writerows(unmatched)
    print(f"Saved unmatched review: {UNMATCHED_FILE} ({len(unmatched)} entries)")

    # Merge
    transfer_by_raw = {r['major_name_raw']: r for r in transfer_rows}
    mapping_dict = {m['transfer_name']: m['rankings_name'] for m in mapping if m['rankings_name']}

    merged = []
    matched_rankings = set()
    for tr_name, rk_name in mapping_dict.items():
        if rk_name not in ranking_by_name:
            continue
        rk = ranking_by_name[rk_name]
        tr = transfer_by_raw[tr_name]
        row = dict(rk)
        row['transfer_name'] = tr_name
        row['transfer_applicants'] = tr['applicants']
        row['transfer_admit_rate'] = tr['admit_rate']
        row['transfer_gpa_25'] = tr['gpa_25']
        row['transfer_gpa_75'] = tr['gpa_75']
        row['ability_proxy_mid'] = tr['ability_proxy_mid']
        merged.append(row)
        matched_rankings.add(rk_name)

    # Add unmatched rankings (no transfer data)
    for rk in ranking_rows:
        if rk['major'] not in matched_rankings:
            row = dict(rk)
            row['transfer_name'] = ''
            row['transfer_applicants'] = ''
            row['transfer_admit_rate'] = ''
            row['transfer_gpa_25'] = ''
            row['transfer_gpa_75'] = ''
            row['ability_proxy_mid'] = ''
            merged.append(row)

    merged.sort(key=lambda r: int(r['rank']))

    fieldnames = list(ranking_rows[0].keys()) + [
        'transfer_name', 'transfer_applicants', 'transfer_admit_rate',
        'transfer_gpa_25', 'transfer_gpa_75', 'ability_proxy_mid'
    ]
    with open(MERGED_FILE, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(merged)

    print(f"\nSaved merged: {MERGED_FILE}")
    print(f"  Rankings majors: {len(ranking_rows)}")
    print(f"  Transfer majors: {len(transfer_rows)}")
    print(f"  Matched: {matched_count}")
    print(f"  Unmatched/review: {len(unmatched)}")
    with_proxy = sum(1 for r in merged if r['ability_proxy_mid'])
    print(f"  Rankings with ability proxy: {with_proxy}/{len(ranking_rows)} ({100*with_proxy/len(ranking_rows):.0f}%)")

    if unmatched:
        print(f"\nUnmatched/ambiguous ({len(unmatched)}):")
        for u in unmatched:
            print(f"  {u['match_type']:>15}  {u['transfer_name']:<55} -> {u['rankings_name'] or '(none)'}")


if __name__ == '__main__':
    main()
