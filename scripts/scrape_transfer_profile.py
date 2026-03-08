#!/usr/bin/env python3
"""
Scrape UCLA Transfer Admission Profile by Major
================================================
Fetches the UCLA transfer profile page and extracts per-major admission
statistics including 25th/75th percentile GPA for admitted students.

Source: https://admission.ucla.edu/apply/transfer/transfer-profile/2025/major
Output: data/raw/ucla_transfer_profile_2025.csv

Usage:
    python3 scripts/scrape_transfer_profile.py
"""

import csv
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)
OUTPUT_FILE = os.path.join(BASE_DIR, 'data', 'raw', 'ucla_transfer_profile_2025.csv')
SOURCE_URL = 'https://admission.ucla.edu/apply/transfer/transfer-profile/2025/major'
SOURCE_YEAR = 2025


def fetch_page(url):
    import urllib.request
    import ssl
    req = urllib.request.Request(url)
    req.add_header('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')
    for ctx in (None, ssl._create_unverified_context()):
        try:
            with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
                return resp.read().decode('utf-8')
        except Exception:
            if ctx is not None:
                raise
    return None


def parse_html(html):
    """Parse all <table> rows from the transfer profile HTML."""
    rows = []
    # Match each <tr> that contains <td> cells (skip header rows with <th>)
    tr_pattern = re.compile(r'<tr[^>]*>(.*?)</tr>', re.DOTALL)
    td_pattern = re.compile(r'<td[^>]*>(.*?)</td>', re.DOTALL)
    link_text = re.compile(r'<a[^>]*>(.*?)</a>')
    tag_strip = re.compile(r'<[^>]+>')

    for tr_match in tr_pattern.finditer(html):
        tr_content = tr_match.group(1)
        cells = td_pattern.findall(tr_content)
        if len(cells) < 3:
            continue

        # First cell contains the major name (usually in a link)
        name_cell = cells[0]
        link_m = link_text.search(name_cell)
        major_name = tag_strip.sub('', link_m.group(1)).strip() if link_m else tag_strip.sub('', name_cell).strip()
        major_name = major_name.replace('\xa0', ' ').replace('&nbsp;', ' ').strip()
        if not major_name or major_name.lower().startswith('major'):
            continue

        applicants_raw = tag_strip.sub('', cells[1]).strip().replace(',', '')
        admit_rate_raw = tag_strip.sub('', cells[2]).strip().replace('%', '')

        gpa_25_raw = tag_strip.sub('', cells[3]).strip().replace('\xa0', '').replace('&nbsp;', '') if len(cells) > 3 else ''
        gpa_75_raw = tag_strip.sub('', cells[4]).strip().replace('\xa0', '').replace('&nbsp;', '') if len(cells) > 4 else ''

        def safe_float(s):
            s = s.strip()
            if not s or s == 'N/A':
                return None
            try:
                return float(s)
            except ValueError:
                return None

        applicants = int(applicants_raw) if applicants_raw.isdigit() else None
        admit_rate = safe_float(admit_rate_raw)
        gpa_25 = safe_float(gpa_25_raw)
        gpa_75 = safe_float(gpa_75_raw)

        ability_proxy_mid = round((gpa_25 + gpa_75) / 2, 3) if gpa_25 is not None and gpa_75 is not None else None

        rows.append({
            'major_name_raw': major_name,
            'applicants': applicants,
            'admit_rate': admit_rate,
            'gpa_25': gpa_25,
            'gpa_75': gpa_75,
            'ability_proxy_mid': ability_proxy_mid,
            'source_url': SOURCE_URL,
            'source_year': SOURCE_YEAR,
        })

    return rows


def main():
    print(f"Fetching {SOURCE_URL} ...")
    html = fetch_page(SOURCE_URL)
    if not html:
        print("Failed to fetch page.")
        sys.exit(1)
    print(f"  Page size: {len(html):,} bytes")

    rows = parse_html(html)
    print(f"  Parsed {len(rows)} majors")

    with_gpa = [r for r in rows if r['ability_proxy_mid'] is not None]
    without_gpa = [r for r in rows if r['ability_proxy_mid'] is None]
    print(f"  With GPA data: {len(with_gpa)}")
    print(f"  Without GPA data (N/A): {len(without_gpa)}")
    for r in without_gpa:
        print(f"    - {r['major_name_raw']}")

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    fieldnames = ['major_name_raw', 'applicants', 'admit_rate', 'gpa_25', 'gpa_75',
                  'ability_proxy_mid', 'source_url', 'source_year']
    with open(OUTPUT_FILE, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nSaved to {OUTPUT_FILE}")


if __name__ == '__main__':
    main()
