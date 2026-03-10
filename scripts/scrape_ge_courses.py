#!/usr/bin/env python3
"""
Scrape UCLA GE Courses Master List (from saved HTML)
====================================================

Instead of driving the live sa.ucla.edu page with Playwright, this script
parses three saved HTML snapshots of the GE master list:

    data/raw/foundations_of_arts_and_humanities.html
    data/raw/foundations_of_society_and_culture.html
    data/raw/foundations_of_scientific_inquiry.html

Each file contains multiple department sections like:

<div class="ContainerWrapper">
  <h4><span class="Head">Anthropology</span></h4>
</div>
<div class="ContainerWrapper">
  <table> ... <tbody>
    <tr>
      <td>Catalog Number</td>
      <td>Course Title (button text)</td>
      ...
      <td>Foundation Categories</td>
    </tr>
  </tbody>

The last cell lists one or more foundation/category pairs, e.g.:

    Arts and Humanities: Literary and Cultural Analysis
    Society and Culture: Historical Analysis

For each (course, foundation, category) combination we emit one CSV row:

    foundation, category, dept_display_name, catalog_number, course_title

Output: data/raw/ge_courses_master_list.csv

Usage:
    python3 scripts/scrape_ge_courses.py

Requires:
    beautifulsoup4  (pip install beautifulsoup4)
"""

import csv
import os
import sys
from bs4 import BeautifulSoup

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)
RAW_DIR = os.path.join(BASE_DIR, 'data', 'raw')
OUTPUT_CSV = os.path.join(RAW_DIR, 'ge_courses_master_list.csv')

HTML_FILES = [
    os.path.join(RAW_DIR, 'foundations_of_arts_and_humanities.html'),
    os.path.join(RAW_DIR, 'foundations_of_society_and_culture.html'),
    os.path.join(RAW_DIR, 'foundations_of_scientific_inquiry.html'),
]

# Map short prefixes in the "Foundation Categories" cell to canonical foundation names
FOUNDATION_LABEL_MAP = {
    'Arts and Humanities': 'Foundations of Arts and Humanities',
    'Society and Culture': 'Foundations of Society and Culture',
    'Scientific Inquiry': 'Foundations of Scientific Inquiry',
    'Foundations of Arts and Humanities': 'Foundations of Arts and Humanities',
    'Foundations of Society and Culture': 'Foundations of Society and Culture',
    'Foundations of Scientific Inquiry': 'Foundations of Scientific Inquiry',
}


def parse_html_file(path, rows):
    """Parse one saved GE foundation HTML file and append rows."""
    if not os.path.exists(path):
        print(f'  ⚠ Skipping missing file: {path}')
        return

    with open(path, 'r', encoding='utf-8') as f:
        html = f.read()

    soup = BeautifulSoup(html, 'html.parser')

    # Each department is introduced by <h4><span class="Head">Dept Name</span></h4>
    for h4 in soup.find_all('h4'):
        head_span = h4.find('span', class_='Head')
        if not head_span:
            continue
        dept_name = head_span.get_text(strip=True)
        if not dept_name:
            continue

        # Next table after the heading holds this department's courses
        table = h4.find_next('table')
        if not table:
            continue
        tbody = table.find('tbody')
        if not tbody:
            continue

        for tr in tbody.find_all('tr'):
            tds = tr.find_all('td')
            if len(tds) < 2:
                continue

            catalog_number = tds[0].get_text(strip=True)
            # Course title is usually inside a <button>, fall back to cell text
            title_btn = tds[1].find('button')
            course_title = title_btn.get_text(strip=True) if title_btn else tds[1].get_text(strip=True)

            ge_cell = tds[-1]
            # Collect non-empty lines of foundation/category text, ignoring placeholder '---'
            pieces = [t.strip() for t in ge_cell.stripped_strings if t.strip() and t.strip() != '---']
            if not pieces:
                continue

            for piece in pieces:
                # Expect patterns like "Arts and Humanities: Literary and Cultural Analysis"
                if ':' in piece:
                    left, right = piece.split(':', 1)
                    base = left.strip()
                    category = right.strip()
                else:
                    # Fallback: no colon, treat entire piece as category with unknown foundation
                    base = ''
                    category = piece.strip()

                foundation = FOUNDATION_LABEL_MAP.get(base, base)
                if not foundation:
                    continue

                rows.append({
                    'foundation': foundation,
                    'category': category,
                    'dept_display_name': dept_name,
                    'catalog_number': catalog_number,
                    'course_title': course_title,
                })


def scrape_ge_list():
    os.makedirs(RAW_DIR, exist_ok=True)
    rows = []

    for path in HTML_FILES:
        print(f'Parsing {os.path.basename(path)}...')
        parse_html_file(path, rows)

    # Deduplicate identical rows
    seen = set()
    unique = []
    for r in rows:
        key = (r['foundation'], r['category'], r['dept_display_name'], r['catalog_number'], r['course_title'])
        if key not in seen:
            seen.add(key)
            unique.append(r)

    with open(OUTPUT_CSV, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(
            f,
            fieldnames=['foundation', 'category', 'dept_display_name', 'catalog_number', 'course_title'],
        )
        w.writeheader()
        w.writerows(unique)

    print(f'  Wrote {len(unique)} GE course rows to {OUTPUT_CSV}')
    return OUTPUT_CSV


if __name__ == '__main__':
    try:
        scrape_ge_list()
    except ImportError as e:
        print('Missing dependency. Install with: pip install beautifulsoup4')
        sys.exit(1)

