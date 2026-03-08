#!/usr/bin/env python3
"""
Resolve Bruinwalk professor URLs
================================
Checks bruinwalk.com to determine the correct URL slug for each professor.
Bruinwalk sometimes uses "firstname-lastname" and sometimes "firstname-middle-lastname".
This script fetches each candidate URL and saves the one that returns 200.

Input:  data/processed/graph_data.json (must exist; run analyze_hardest_major.py first)
Output: data/processed/bruinwalk_slugs.json  { "LASTNAME, FIRSTNAME MIDDLE": "resolved-slug" }

Usage:
    python3 scripts/resolve_bruinwalk_links.py              # Resolve all professors
    python3 scripts/resolve_bruinwalk_links.py --limit 50    # Resolve first 50 (for testing)
    python3 scripts/resolve_bruinwalk_links.py --workers 40 # 40 concurrent (default 20)
"""

import json
import os
import re
import sys
import time
import argparse
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)
GRAPH_DATA_FILE = os.path.join(BASE_DIR, 'data', 'processed', 'graph_data.json')
OUTPUT_FILE = os.path.join(BASE_DIR, 'data', 'processed', 'bruinwalk_slugs.json')
BASE_URL = 'https://bruinwalk.com/professors/'

# Global rate limiter: min seconds between any two requests (avoids Bruinwalk rate limiting)
_rate_lock = threading.Lock()
_rate_last = 0.0
RATE_MIN_INTERVAL = 0.25  # ~4 requests/sec max across all workers


def _rate_limit():
    """Enforce minimum interval between requests."""
    global _rate_last
    with _rate_lock:
        now = time.time()
        wait = RATE_MIN_INTERVAL - (now - _rate_last)
        if wait > 0:
            time.sleep(wait)
        _rate_last = time.time()


def slugify(s):
    """Convert string to URL-safe slug: lowercase, alphanumeric and hyphens only."""
    s = s.lower().replace(' ', '-')
    s = re.sub(r'[^a-z0-9-]', '', s)
    s = re.sub(r'-+', '-', s).strip('-')
    return s


def candidate_slugs(name):
    """
    Generate candidate Bruinwalk slugs for "LASTNAME, FIRSTNAME [MIDDLE]".
    Returns list of slugs to try, in order of likelihood.
    """
    name = (name or '').strip()
    parts = [p.strip() for p in name.split(',', 1)]
    if len(parts) < 2:
        return [slugify(name)] if name else []
    last, first_full = parts[0], parts[1]
    first_words = first_full.split()
    if not first_words:
        return [slugify(last)]
    # Candidate 1: first name only + last (most common)
    first_only = first_words[0]
    candidates = [slugify(f"{first_only}-{last}")]
    if len(first_words) > 1:
        # Candidate 2: first + middle initial(s) + last (e.g. robert-t-clubb)
        middle_initials = '-'.join(w[0] for w in first_words[1:])
        with_mi = slugify(f"{first_only}-{middle_initials}-{last}")
        if with_mi not in candidates:
            candidates.append(with_mi)
        # Candidate 3: first + full middle + last (e.g. robert-thompson-clubb)
        full_first = '-'.join(first_words)
        with_middle = slugify(f"{full_first}-{last}")
        if with_middle not in candidates:
            candidates.append(with_middle)
    return candidates


def _fetch(url, method, timeout, ctx):
    import urllib.request
    from urllib.error import URLError, HTTPError
    req = urllib.request.Request(url, method=method)
    req.add_header('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        return 200 <= resp.status < 400


def _fetch_with_retry(url, method, timeout, ctx, max_retries=2):
    """Fetch with retry on 429 (rate limit)."""
    import urllib.request
    from urllib.error import URLError, HTTPError
    req = urllib.request.Request(url, method=method)
    req.add_header('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')
    for attempt in range(max_retries + 1):
        _rate_limit()
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                return 200 <= resp.status < 400
        except HTTPError as e:
            if e.code == 429 and attempt < max_retries:
                time.sleep(5)
                continue
            raise


def resolve_one(name, base_url):
    """Resolve a single professor; returns (name, slug, assumed)."""
    candidates = candidate_slugs(name)
    if not candidates:
        return name, None, False
    with ThreadPoolExecutor(max_workers=len(candidates)) as ex:
        fut_to_cand = {ex.submit(check_url_exists, base_url + c + '/'): c for c in candidates}
        for fut in as_completed(fut_to_cand):
            if fut.result():
                return name, fut_to_cand[fut], False
    return name, candidates[0], True


def check_url_exists(url, timeout=5):
    """Return True if URL returns 200 (tries HEAD first, falls back to GET if 405)."""
    import ssl
    from urllib.error import HTTPError, URLError

    for ctx in (None, ssl._create_unverified_context()):
        try:
            return _fetch_with_retry(url, 'HEAD', timeout, ctx)
        except HTTPError as e:
            if e.code == 405:
                try:
                    return _fetch_with_retry(url, 'GET', timeout, ctx)
                except (HTTPError, URLError, OSError):
                    return False
            return False
        except (URLError, ssl.SSLError, OSError):
            if ctx is None:
                continue
            return False
    return False


def main():
    parser = argparse.ArgumentParser(description='Resolve Bruinwalk professor URLs')
    parser.add_argument('--limit', type=int, default=None, help='Max professors to resolve (for testing)')
    parser.add_argument('--workers', type=int, default=5, help='Concurrent professors (default 5; higher may trigger rate limiting)')
    parser.add_argument('--force', action='store_true', help='Re-check all professors (ignore existing mapping)')
    parser.add_argument('--no-save', action='store_true', help='Do not save results (dry run)')
    args = parser.parse_args()

    if not os.path.exists(GRAPH_DATA_FILE):
        print(f"❌ Missing {GRAPH_DATA_FILE}")
        print("   Run: python3 scripts/analyze_hardest_major.py first")
        sys.exit(1)

    with open(GRAPH_DATA_FILE) as f:
        data = json.load(f)

    prof_rankings = data.get('professor_rankings', {})
    all_names = set()
    for dept_profs in prof_rankings.values():
        for p in dept_profs:
            all_names.add(p['name'])

    names = sorted(all_names)
    if args.limit:
        names = names[:args.limit]
        print(f"  (Limited to first {args.limit} professors)")

    # Load existing mapping
    existing = {}
    if os.path.exists(OUTPUT_FILE):
        with open(OUTPUT_FILE) as f:
            existing = json.load(f)

    if args.force and existing:
        # Verify each cached slug; only re-resolve if it no longer works
        to_verify = [(n, existing[n]) for n in names if n in existing]
        to_resolve = [n for n in names if n not in existing]

        def verify_one(item):
            n, slug = item
            return (n, check_url_exists(BASE_URL + slug + '/'))

        verified_ok = 0
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            for n, ok in ex.map(verify_one, to_verify):
                if ok:
                    verified_ok += 1
                else:
                    to_resolve.append(n)
        print(f"  Loaded {len(existing)} mappings; skipped {verified_ok} verified, {len(to_resolve)} to resolve")
    else:
        to_resolve = [n for n in names if n not in existing]
        if existing:
            print(f"  Loaded {len(existing)} existing mappings (use --force to re-verify)")

    resolved = dict(existing)
    not_found = []
    skipped = len(names) - len(to_resolve)

    print(f"\n🔍 Resolving Bruinwalk URLs for {len(to_resolve)} professors ({skipped} skipped)...")
    print(f"   Workers: {args.workers} concurrent\n")

    lock = threading.Lock()
    save_interval = 25

    last_saved = len(existing)

    def process(name):
        result = resolve_one(name, BASE_URL)
        with lock:
            n, slug, assumed = result
            if slug:
                resolved[n] = slug
                if assumed:
                    not_found.append(n)
                print(f"  {'?' if assumed else '✓'} {n} → {slug}")
            nonlocal last_saved
            if not args.no_save and len(resolved) - last_saved >= save_interval:
                to_write = dict(resolved)
                if os.path.exists(OUTPUT_FILE):
                    try:
                        with open(OUTPUT_FILE) as f:
                            on_disk = json.load(f)
                        to_write = {**on_disk, **resolved}
                    except (json.JSONDecodeError, OSError):
                        pass
                with open(OUTPUT_FILE, 'w') as f:
                    json.dump(to_write, f, indent=2)
                last_saved = len(resolved)
        return result

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        list(ex.map(process, to_resolve))

    if not args.no_save:
        to_write = dict(resolved)
        if os.path.exists(OUTPUT_FILE):
            try:
                with open(OUTPUT_FILE) as f:
                    on_disk = json.load(f)
                to_write = {**on_disk, **resolved}
            except (json.JSONDecodeError, OSError):
                pass
        with open(OUTPUT_FILE, 'w') as f:
            json.dump(to_write, f, indent=2)
        print(f"\n✅ Saved {len(to_write)} mappings to {OUTPUT_FILE}")
    else:
        print(f"\n  (Dry run; not saved)")

    if not_found:
        print(f"  ⚠ {len(not_found)} professors could not be verified (using first candidate)")


if __name__ == '__main__':
    main()
