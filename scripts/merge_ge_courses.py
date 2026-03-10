#!/usr/bin/env python3
"""
Merge scraped GE course list with our course IDs.
Reads data/raw/ge_courses_master_list.csv and data/processed/course_grade_stats.csv,
uses data/raw/ge_dept_name_to_code.json to map department display names to subject_area codes,
and outputs data/processed/course_ge_mapping.json for use in the dashboard.

Output format: { "course_id": [ {"foundation": "...", "category": "..."}, ... ], ... }
One course can satisfy multiple GE categories.

Run after: python3 scripts/scrape_ge_courses.py
"""

import csv
import json
import os
import re

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)
RAW_DIR = os.path.join(BASE_DIR, 'data', 'raw')
PROCESSED_DIR = os.path.join(BASE_DIR, 'data', 'processed')
GE_CSV = os.path.join(RAW_DIR, 'ge_courses_master_list.csv')
DEPT_MAP = os.path.join(RAW_DIR, 'ge_dept_name_to_code.json')
COURSE_STATS = os.path.join(PROCESSED_DIR, 'course_grade_stats.csv')
OUTPUT_JSON = os.path.join(PROCESSED_DIR, 'course_ge_mapping.json')


def normalize_catalog_number(num):
    """Ensure catalog number format matches (e.g. 31 vs 31A)."""
    if not num:
        return ''
    return str(num).strip().upper()


def main():
    if not os.path.exists(GE_CSV):
        print(f'Missing {GE_CSV}. Run: python3 scripts/scrape_ge_courses.py')
        return
    if not os.path.exists(COURSE_STATS):
        print(f'Missing {COURSE_STATS}. Run the pipeline (parse_grades, then analyze).')
        return

    with open(DEPT_MAP, 'r') as f:
        dept_to_code = json.load(f)

    # Build set of our course_ids from course_grade_stats
    our_courses = set()
    with open(COURSE_STATS, 'r') as f:
        r = csv.DictReader(f)
        for row in r:
            cid = (row.get('course_id') or '').strip()
            if cid:
                our_courses.add(cid)

    # Load GE list and build course_id -> list of (foundation, category)
    ge_by_course = {}
    unmatched = []
    with open(GE_CSV, 'r', encoding='utf-8') as f:
        r = csv.DictReader(f)
        for row in r:
            dept_display = (row.get('dept_display_name') or '').strip()
            catalog_number = normalize_catalog_number(row.get('catalog_number'))
            foundation = (row.get('foundation') or '').strip()
            category = (row.get('category') or '').strip()

            code = dept_to_code.get(dept_display)
            if not code:
                # Try stripping common suffixes
                for suffix in [' Department', ' (SoE)', ' (L&S)']:
                    code = dept_to_code.get(dept_display.replace(suffix, '').strip())
                    if code:
                        break
            if not code:
                unmatched.append(dept_display)
                continue

            course_id = f"{code} {catalog_number}".strip()
            if not course_id:
                continue

            # Exact match to our course_id
            if course_id not in our_courses:
                unmatched.append(f"{dept_display} {catalog_number}")
                continue

            entry = {'foundation': foundation, 'category': category}
            if course_id not in ge_by_course:
                ge_by_course[course_id] = []
            if entry not in ge_by_course[course_id]:
                ge_by_course[course_id].append(entry)

    os.makedirs(PROCESSED_DIR, exist_ok=True)
    with open(OUTPUT_JSON, 'w') as f:
        json.dump(ge_by_course, f, indent=2)

    print(f'Wrote {len(ge_by_course)} courses with GE data to {OUTPUT_JSON}')
    if unmatched:
        uniq = list(dict.fromkeys(unmatched))[:20]
        print(f'  Sample unmatched GE rows (add to ge_dept_name_to_code.json if needed): {uniq}')


if __name__ == '__main__':
    main()
