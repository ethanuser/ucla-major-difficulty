#!/usr/bin/env python3
"""
UCLA Hardest Major Analysis
============================
Reads scraped major requirements (from scrape_ucla_catalog.py) and
parsed grade data (from parse_grades.py) to:
1. Build a bipartite graph (majors ↔ courses)
2. Score each major by difficulty
3. Generate an interactive HTML visualization

Inputs:
    - ucla_major_requirements.json (from scrape_ucla_catalog.py)
    - course_grade_stats.csv (from parse_grades.py)

Outputs:
    - major_difficulty_rankings.csv
    - graph_data.json
    - ucla_hardest_major.html

Usage:
    python3 analyze_hardest_major.py               # Full analysis
    python3 analyze_hardest_major.py --no-html      # Skip HTML generation
    python3 analyze_hardest_major.py --top 30       # Show top N results
"""

import pandas as pd
import numpy as np
import json
import os
import sys
import argparse
from collections import defaultdict

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)  # Project root (one level up from scripts/)
PROCESSED_DIR = os.path.join(BASE_DIR, 'data', 'processed')
REQUIREMENTS_FILE = os.path.join(PROCESSED_DIR, 'ucla_major_requirements.json')
GRADE_STATS_FILE = os.path.join(PROCESSED_DIR, 'course_grade_stats.csv')
RANKINGS_FILE = os.path.join(PROCESSED_DIR, 'major_difficulty_rankings.csv')
GRAPH_DATA_FILE = os.path.join(PROCESSED_DIR, 'graph_data.json')
HTML_FILE = os.path.join(BASE_DIR, 'index.html')


import re

# ═══════════════════════════════════════════════════════════════════
# STEP 1: Load data
# ═══════════════════════════════════════════════════════════════════

def get_course_number(course_id):
    """Extract numeric portion of a course ID to determine division."""
    parts = course_id.rsplit(' ', 1)
    if len(parts) == 2:
        match = re.match(r'(\d+)', parts[1])
        if match:
            return int(match.group(1))
    return 0

def is_upper_division(course_id):
    """Check if a course is upper division (number >= 100)."""
    return get_course_number(course_id) >= 100


def load_major_requirements(path):
    """Load scraped major requirements JSON."""
    with open(path, 'r') as f:
        data = json.load(f)
    
    majors = {}
    for m in data['majors']:
        if m['num_courses'] > 0:
            clean_name = re.sub(r'^[A-Z0-9]+\s+', '', m['major_name']).strip()
            
            # Build set of required course IDs for tagging
            required_ids = {c['course_id'] for c in m['courses']}
            
            majors[clean_name] = {
                'courses': [c['course_id'] for c in m['courses']],
                'subject_areas': m['subject_areas'],
                'all_courses': m['courses'],
                'catalog_url': m.get('url', ''),
                'required_ids': required_ids,
            }
    
    print(f"  Loaded {len(majors)} majors with course requirements")
    print(f"  (Skipped {len(data['majors']) - len(majors)} majors with no courses)")
    return majors, data.get('metadata', {})


def load_grade_stats(path):
    """Load parsed course grade statistics."""
    df = pd.read_csv(path)
    print(f"  Loaded {len(df)} courses with grade statistics")
    return df


# ═══════════════════════════════════════════════════════════════════
# STEP 2: Match courses and compute difficulty
# ═══════════════════════════════════════════════════════════════════

def normalize_course_id(cid):
    """Normalize a course_id for matching (handle spacing differences)."""
    # Remove extra whitespace, standardize
    return ' '.join(cid.upper().split())


def match_courses(major_reqs, course_stats):
    """
    Match scraped course requirements to grade data.
    Uses two strategies:
    1. Exact course_id match
    2. Subject area match (fallback for courses not in grade data)
    """
    grade_index = {}
    for _, row in course_stats.iterrows():
        norm_id = normalize_course_id(row['course_id'])
        grade_index[norm_id] = row
        # Also index by just the number suffix for flexible matching
        parts = norm_id.rsplit(' ', 1)
        if len(parts) == 2:
            grade_index[norm_id.replace(' ', '')] = row
    
    results = {}
    total_exact = 0
    total_subject = 0
    total_missed = 0
    
    for major_name, req in major_reqs.items():
        matched_courses = []
        used_subject_areas = set()
        
        for course_id in req['courses']:
            norm_id = normalize_course_id(course_id)
            
            # Strategy 1: Exact match
            if norm_id in grade_index:
                matched_courses.append(grade_index[norm_id].to_dict())
                used_subject_areas.add(grade_index[norm_id]['subject_area'])
                total_exact += 1
            elif norm_id.replace(' ', '') in grade_index:
                matched_courses.append(grade_index[norm_id.replace(' ', '')].to_dict())
                used_subject_areas.add(grade_index[norm_id.replace(' ', '')]['subject_area'])
                total_exact += 1
            else:
                total_missed += 1
        
        # Strategy 2: Also include ALL courses from the subject areas we've seen
        # This captures electives and alternate courses within the same department
        all_subject_courses = course_stats[
            course_stats['subject_area'].isin(req['subject_areas'])
        ]
        
        subject_course_dicts = all_subject_courses.to_dict('records')
        existing_ids = {c['course_id'] for c in matched_courses}
        for c in subject_course_dicts:
            if c['course_id'] not in existing_ids:
                total_subject += 1
        
        results[major_name] = {
            'exact_matches': matched_courses,
            'subject_areas': req['subject_areas'],
            'all_subject_courses': subject_course_dicts,
            'exact_match_count': len(matched_courses),
            'total_required': len(req['courses']),
            'catalog_url': req.get('catalog_url', ''),
            'required_ids': req.get('required_ids', set()),
        }
    
    print(f"\n  Course matching summary:")
    print(f"    Exact matches:        {total_exact}")
    print(f"    Subject area fills:   {total_subject}")
    print(f"    Unmatched:            {total_missed}")
    
    return results


# ═══════════════════════════════════════════════════════════════════
# STEP 3: Score majors
# ═══════════════════════════════════════════════════════════════════

def score_majors(matched_data, course_stats):
    """
    Compute difficulty scores for each major.
    
    Uses a HYBRID approach with three dimensions:
    1. GPA-based difficulty (blended exact + department avg)
    2. DFW rate (D/F/Withdrawn rate — ability-independent difficulty signal)
    3. Shared vs. major-specific course decomposition
    
    Per Rojstaczer & Healy (gradeinflation.com), SAT scores explain only ~0.1 GPA
    per 100 points and <14% of GPA variance. Grading standards across departments
    are the dominant driver of GPA differences, not student ability — validating
    GPA as a genuine difficulty measure.
    """
    # ── First pass: identify shared vs. major-specific courses ──
    # Count how many majors require each course
    course_major_count = {}
    for major_name, data in matched_data.items():
        for c in data['exact_matches']:
            cid = c['course_id']
            if cid not in course_major_count:
                course_major_count[cid] = set()
            course_major_count[cid].add(major_name)
    
    # A "gateway" course is required by 3+ majors (e.g., MATH 31A, CHEM 14A)
    GATEWAY_THRESHOLD = 3
    gateway_courses = {cid for cid, majors in course_major_count.items() 
                       if len(majors) >= GATEWAY_THRESHOLD}
    
    num_gateway = len(gateway_courses)
    print(f"\n  Shared-course analysis:")
    print(f"    Gateway courses (required by {GATEWAY_THRESHOLD}+ majors): {num_gateway}")
    if gateway_courses:
        # Show top shared courses
        top_shared = sorted(course_major_count.items(), key=lambda x: len(x[1]), reverse=True)[:5]
        for cid, majors in top_shared:
            print(f"      {cid}: shared by {len(majors)} majors")
    
    # ── Helper to compute weighted GPA/pctA from a course list ──
    def _compute_blend(exact_list, subj_list):
        """Compute blended GPA and pctA from exact matches + dept courses."""
        e_gpa = e_pctA = e_total = None
        s_gpa = s_pctA = s_total = None
        if exact_list:
            edf = pd.DataFrame(exact_list)
            e_total = edf['total_letter_grades'].sum()
            if e_total > 0:
                e_gpa = (edf['avg_gpa'] * edf['total_letter_grades']).sum() / e_total
                e_pctA = (edf['pct_A'] * edf['total_letter_grades']).sum() / e_total
        if subj_list:
            sdf = pd.DataFrame(subj_list)
            s_total = sdf['total_letter_grades'].sum()
            if s_total > 0:
                s_gpa = (sdf['avg_gpa'] * sdf['total_letter_grades']).sum() / s_total
                s_pctA = (sdf['pct_A'] * sdf['total_letter_grades']).sum() / s_total
        if e_gpa is not None and s_gpa is not None:
            return 0.6 * e_gpa + 0.4 * s_gpa, 0.6 * e_pctA + 0.4 * s_pctA, e_total
        elif e_gpa is not None:
            return e_gpa, e_pctA, e_total
        elif s_gpa is not None:
            return s_gpa, s_pctA, s_total
        return None, None, None

    # ── Second pass: compute scores ──
    major_scores = []
    
    for major_name, data in matched_data.items():
        exact = data['exact_matches']
        all_subj = data['all_subject_courses']
        required_ids = data.get('required_ids', set())
        catalog_url = data.get('catalog_url', '')
        
        # === MODE 1: All courses (blended) ===
        blend_gpa, blend_pctA, total_students = _compute_blend(exact, all_subj)
        if blend_gpa is None:
            continue
        
        # === MODE 2: Upper-div all (required + dept electives, number >= 100) ===
        upper_exact = [c for c in exact if is_upper_division(c['course_id'])]
        upper_subj = [c for c in all_subj if is_upper_division(c['course_id'])]
        ud_all_gpa, ud_all_pctA, ud_all_students = _compute_blend(upper_exact, upper_subj)
        
        # === MODE 3: Upper-div required only (only exact matches that are upper-div) ===
        upper_req = [c for c in exact if is_upper_division(c['course_id']) and c['course_id'] in required_ids]
        if upper_req:
            udf = pd.DataFrame(upper_req)
            ut = udf['total_letter_grades'].sum()
            if ut > 0:
                ud_req_gpa = (udf['avg_gpa'] * udf['total_letter_grades']).sum() / ut
                ud_req_pctA = (udf['pct_A'] * udf['total_letter_grades']).sum() / ut
                ud_req_students = ut
            else:
                ud_req_gpa = ud_req_pctA = ud_req_students = None
        else:
            ud_req_gpa = ud_req_pctA = ud_req_students = None
        
        # ── DFW Rate ──
        all_courses = exact + [c for c in all_subj if c['course_id'] not in {e['course_id'] for e in exact}]
        if all_courses:
            ac_df = pd.DataFrame(all_courses)
            if 'dfw_rate' in ac_df.columns and 'total_all_grades' in ac_df.columns:
                total_all = ac_df['total_all_grades'].sum()
                if total_all > 0 and 'total_dfw' in ac_df.columns:
                    major_dfw = ac_df['total_dfw'].sum() / total_all * 100
                else:
                    major_dfw = ac_df['dfw_rate'].mean() if not ac_df['dfw_rate'].isna().all() else 0
            else:
                major_dfw = 0
        else:
            major_dfw = 0
            ac_df = pd.DataFrame()
        
        # ── Shared vs. Major-Specific Decomposition ──
        gateway_gpa = None
        specific_gpa = None
        if exact:
            exact_df = pd.DataFrame(exact)
            gateway_mask = exact_df['course_id'].isin(gateway_courses)
            gateway_df = exact_df[gateway_mask]
            specific_df = exact_df[~gateway_mask]
            if len(gateway_df) > 0 and gateway_df['total_letter_grades'].sum() > 0:
                gateway_gpa = (gateway_df['avg_gpa'] * gateway_df['total_letter_grades']).sum() / gateway_df['total_letter_grades'].sum()
            if len(specific_df) > 0 and specific_df['total_letter_grades'].sum() > 0:
                specific_gpa = (specific_df['avg_gpa'] * specific_df['total_letter_grades']).sum() / specific_df['total_letter_grades'].sum()
        
        # Hardest/easiest courses
        if len(ac_df) > 0:
            hardest = ac_df.nsmallest(3, 'avg_gpa')[['course_id', 'course_title', 'avg_gpa', 'pct_A']].to_dict('records')
            easiest = ac_df.nlargest(3, 'avg_gpa')[['course_id', 'course_title', 'avg_gpa', 'pct_A']].to_dict('records')
        else:
            hardest = easiest = []
        
        major_scores.append({
            'major': major_name,
            'catalog_url': catalog_url,
            'avg_gpa': round(blend_gpa, 3),
            'pct_A': round(blend_pctA, 1),
            'ud_all_gpa': round(ud_all_gpa, 3) if ud_all_gpa else None,
            'ud_all_pctA': round(ud_all_pctA, 1) if ud_all_pctA else None,
            'ud_all_students': int(ud_all_students) if ud_all_students else None,
            'ud_req_gpa': round(ud_req_gpa, 3) if ud_req_gpa else None,
            'ud_req_pctA': round(ud_req_pctA, 1) if ud_req_pctA else None,
            'ud_req_students': int(ud_req_students) if ud_req_students else None,
            'num_upper_exact': len(upper_exact),
            'num_upper_req': len(upper_req),
            'exact_gpa': round(blend_gpa, 3),  # keep for csv compat
            'dept_gpa': None,
            'dfw_rate': round(major_dfw, 1),
            'gateway_gpa': round(gateway_gpa, 3) if gateway_gpa else None,
            'specific_gpa': round(specific_gpa, 3) if specific_gpa else None,
            'num_gateway_courses': int(sum(1 for c in data['exact_matches'] if c['course_id'] in gateway_courses)) if exact else 0,
            'num_specific_courses': int(sum(1 for c in data['exact_matches'] if c['course_id'] not in gateway_courses)) if exact else 0,
            'num_exact_courses': data['exact_match_count'],
            'num_required_courses': data['total_required'],
            'num_dept_courses': len(all_subj),
            'total_students': total_students,
            'subject_areas': data['subject_areas'],
            'hardest_courses': hardest,
            'easiest_courses': easiest,
        })
    
    major_df = pd.DataFrame(major_scores)
    major_df = major_df.sort_values('avg_gpa', ascending=True).reset_index(drop=True)
    major_df['rank'] = range(1, len(major_df) + 1)
    
    return major_df


# ═══════════════════════════════════════════════════════════════════
# STEP 4: Build graph data
# ═══════════════════════════════════════════════════════════════════

def build_graph_data(major_df, course_stats):
    """Build bipartite graph data structure for visualization."""
    nodes = []
    edges = []
    node_set = set()
    
    for _, row in major_df.iterrows():
        major_id = f"major_{row['major']}"
        if major_id not in node_set:
            nodes.append({
                'id': major_id,
                'label': row['major'],
                'type': 'major',
                'avg_gpa': row['avg_gpa'],
                'pct_A': row['pct_A'],
                'rank': int(row['rank']),
                'num_courses': int(row['num_exact_courses']),
                'total_students': int(row['total_students']),
            })
            node_set.add(major_id)
        
        for subj in row['subject_areas']:
            subj_id = f"subj_{subj}"
            if subj_id not in node_set:
                subj_courses = course_stats[course_stats['subject_area'] == subj]
                if len(subj_courses) > 0:
                    s_gpa = (subj_courses['avg_gpa'] * subj_courses['total_letter_grades']).sum() / subj_courses['total_letter_grades'].sum()
                    s_pct = (subj_courses['pct_A'] * subj_courses['total_letter_grades']).sum() / subj_courses['total_letter_grades'].sum()
                else:
                    s_gpa = s_pct = 0
                nodes.append({
                    'id': subj_id,
                    'label': subj,
                    'type': 'subject',
                    'avg_gpa': round(s_gpa, 3),
                    'pct_A': round(s_pct, 1),
                    'num_courses': int(len(subj_courses)),
                })
                node_set.add(subj_id)
            
            edges.append({
                'source': major_id,
                'target': subj_id,
            })
    
    # Build rankings list with multi-mode data
    def _safe(val):
        """Convert NaN/None to None for clean JSON serialization."""
        if val is None or (isinstance(val, float) and np.isnan(val)):
            return None
        return val
    
    rankings = []
    for _, row in major_df.iterrows():
        rankings.append({
            'rank': int(row['rank']),
            'major': row['major'],
            'catalog_url': row.get('catalog_url', '') or '',
            'avg_gpa': row['avg_gpa'],
            'pct_A': row['pct_A'],
            'num_courses': int(row['num_exact_courses']),
            'num_dept_courses': int(row['num_dept_courses']),
            'total_students': int(row['total_students']),
            'ud_all_gpa': _safe(row.get('ud_all_gpa')),
            'ud_all_pctA': _safe(row.get('ud_all_pctA')),
            'ud_all_students': _safe(row.get('ud_all_students')),
            'ud_req_gpa': _safe(row.get('ud_req_gpa')),
            'ud_req_pctA': _safe(row.get('ud_req_pctA')),
            'ud_req_students': _safe(row.get('ud_req_students')),
            'num_upper_exact': int(row.get('num_upper_exact', 0)),
            'num_upper_req': int(row.get('num_upper_req', 0)),
        })
    
    # All courses sorted by GPA ascending (hardest first)
    all_courses_sorted = course_stats.sort_values('avg_gpa', ascending=True)[
        ['course_id', 'course_title', 'avg_gpa', 'pct_A', 'total_letter_grades', 'subject_area']
    ].to_dict('records')
    
    # Major details
    major_details = {}
    for _, row in major_df.iterrows():
        major_details[row['major']] = {
            'hardest_courses': row['hardest_courses'],
            'easiest_courses': row['easiest_courses'],
        }
    
    graph_data = {
        'nodes': nodes,
        'edges': edges,
        'rankings': rankings,
        'hardest_major': major_df.iloc[0]['major'],
        'easiest_major': major_df.iloc[-1]['major'],
        'all_courses_sorted': all_courses_sorted,
        'major_details': major_details,
        'total_student_grades': int(course_stats['total_letter_grades'].sum()),
    }
    
    return graph_data


# ═══════════════════════════════════════════════════════════════════
# STEP 5: Generate HTML visualization
# ═══════════════════════════════════════════════════════════════════

def generate_html(graph_data, output_path):
    """Generate the interactive HTML dashboard.
    
    HTML structure references external CSS/JS from assets/ folder.
    Data is injected as a JSON variable in an inline <script> tag.
    """
    
    # Read external CSS and JS files
    assets_dir = os.path.join(BASE_DIR, 'assets')
    css_path = os.path.join(assets_dir, 'style.css')
    js_path = os.path.join(assets_dir, 'app.js')
    
    with open(css_path, 'r') as f:
        css_content = f.read()
    with open(js_path, 'r') as f:
        js_content = f.read()
    
    html_content = '''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>UCLA Hardest Major Analysis</title>
    <meta name="description" content="Interactive analysis of UCLA's hardest majors based on grade distribution data from 2021-2024. Rankings, bipartite graph, and course-level breakdowns.">
    <style>
''' + css_content + '''
    </style>
</head>
<body>

    <!-- UCLA-style gold topbar -->
    <div class="ucla-topbar"></div>

    <!-- Site header -->
    <header class="site-header">
        <div class="site-header__brand">
            <a href="https://ethanuser.github.io/ucla-major-difficulty" class="site-header__logo">UCLA Major Difficulty</a>
            <div class="site-header__divider"></div>
            <span class="site-header__subtitle">Grade Distribution Analysis</span>
        </div>
        <nav class="site-header__links">
            <a href="https://catalog.registrar.ucla.edu" target="_blank" class="site-header__link">Course Catalog</a>
            <a href="https://uclagrades.com" target="_blank" class="site-header__link">Grade Data</a>
            <a href="https://ethanuser.github.io/ucla-major-difficulty" target="_blank" class="site-header__link">Methodology</a>
        </nav>
    </header>

    <!-- Hero -->
    <section class="hero">
        <h1 class="hero__title">Hardest Major Analysis</h1>
        <p class="hero__desc">Grade distribution analysis across 2021-2024 | Mapping majors to courses via bipartite graph</p>
        <div class="hero__stats">
            <div>
                <div class="hero__stat-num" id="stat-majors">0</div>
                <div class="hero__stat-label">Majors Analyzed</div>
            </div>
            <div>
                <div class="hero__stat-num" id="stat-courses">0</div>
                <div class="hero__stat-label">Courses</div>
            </div>
            <div>
                <div class="hero__stat-num" id="stat-grades">0</div>
                <div class="hero__stat-label">Grade Records</div>
            </div>
            <div>
                <div class="hero__stat-num" id="stat-years">4</div>
                <div class="hero__stat-label">Academic Years</div>
            </div>
        </div>
    </section>

    <div class="container">

        <!-- Winner banner -->
        <div class="winner-banner" id="winner-banner">
            <div class="winner-banner__icon">#1</div>
            <div>
                <div class="winner-banner__label">Hardest UCLA Major</div>
                <div class="winner-banner__name" id="winner-name">Loading...</div>
                <div class="winner-banner__detail" id="winner-detail"></div>
            </div>
        </div>

        <!-- Tabs -->
        <div class="tabs">
            <button class="tab active" onclick="switchTab('rankings')">Rankings</button>
            <button class="tab" onclick="switchTab('graph')">Bipartite Graph</button>
            <button class="tab" onclick="switchTab('courses')">Course Deep Dive</button>
        </div>

        <!-- Rankings panel -->
        <div class="panel active" id="panel-rankings">
            <div class="filter-bar">
                <label>Course Filter:</label>
                <div class="filter-group">
                    <button id="filter-all" class="active-filter" onclick="setFilter('all')">All Courses</button>
                    <button id="filter-ud-all" onclick="setFilter('ud_all')">Upper-Div (All)</button>
                    <button id="filter-ud-req" onclick="setFilter('ud_req')">Upper-Div (Required)</button>
                </div>
            </div>
            <div class="table-scroll-wrapper">
            <table class="rankings-table">
                <thead><tr>
                    <th data-tip="Difficulty rank based on weighted average GPA (lower GPA = harder). Rank 1 is the hardest major.">Rank</th>
                    <th data-tip="Official UCLA major name. Click to view in the UCLA Course Catalog.">Major</th>
                    <th data-tip="Weighted average GPA across all courses in this major. Blends 60% exact required-course GPAs with 40% department-wide averages. Lower GPA = harder grading.">Avg GPA</th>
                    <th data-tip="Percentage of all letter grades that were A or A+. Lower values indicate tougher grading curves.">% A/A+</th>
                    <th data-tip="Number of required courses matched to grade data.">Courses</th>
                    <th data-tip="Total letter grades recorded across all matched courses from 2021 to 2024. Higher count means more statistical confidence.">Grade Records</th>
                </tr></thead>
                <tbody id="rankings-body"></tbody>
            </table>
            </div>
        </div>

        <!-- Graph panel -->
        <div class="panel" id="panel-graph">
            <div id="graph-container">
                <canvas id="graph-canvas"></canvas>
                <div class="graph-legend">
                    <div class="legend-title">Legend</div>
                    <div class="legend-item"><div class="legend-dot" style="background: hsl(0, 75%, 42%);"></div> Major (red = harder)</div>
                    <div class="legend-item"><div class="legend-dot" style="background: hsl(120, 75%, 42%);"></div> Major (green = easier)</div>
                    <div class="legend-item"><div class="legend-dot" style="background: var(--ucla-blue);"></div> Department</div>
                    <div class="legend-item" style="margin-top:6px;font-style:italic;opacity:0.7">Larger major = lower GPA</div>
                    <div class="legend-item" style="font-style:italic;opacity:0.7">Larger dept = more courses</div>
                    <div class="legend-item" style="font-style:italic;opacity:0.7">Hover to see labels</div>
                </div>
                <div class="graph-controls">
                    <button class="graph-btn" onclick="zoomGraph(1.2)" title="Zoom In">+</button>
                    <button class="graph-btn" onclick="zoomGraph(0.8)" title="Zoom Out">&minus;</button>
                    <button class="graph-btn" onclick="resetGraph()" title="Reset">&#x27F2;</button>
                </div>
            </div>
        </div>

        <!-- Courses panel -->
        <div class="panel" id="panel-courses">
            <div class="section-title">All Courses by GPA</div>
            <div class="courses-controls">
                <label for="course-count">Show:</label>
                <select id="course-count" onchange="renderCourseTable()">
                    <option value="10">10</option>
                    <option value="20">20</option>
                    <option value="50" selected>50</option>
                    <option value="100">100</option>
                    <option value="500">500</option>
                    <option value="1000">1000</option>
                    <option value="all">All</option>
                </select>
                <div class="sort-group">
                    <button id="sort-hard" class="active-sort" onclick="setSortDir('asc')">Hardest First</button>
                    <button id="sort-easy" onclick="setSortDir('desc')">Easiest First</button>
                </div>
                <span class="course-count-info" id="course-count-info"></span>
            </div>
            <div class="table-scroll-wrapper">
            <table class="courses-table">
                <thead><tr>
                    <th data-tip="Row number in the current sort order.">#</th>
                    <th data-tip="Course ID (e.g. MATH 31A). Format is SUBJECT + NUMBER.">Course</th>
                    <th data-tip="Official course title from the UCLA catalog.">Title</th>
                    <th data-tip="Weighted average GPA for this course across all sections (2021-2024).">Avg GPA</th>
                    <th data-tip="Percentage of letter grades that were A or A+.">% A/A+</th>
                    <th data-tip="Total letter grades recorded for this course from 2021 to 2024.">Students</th>
                    <th data-tip="Subject area / department this course belongs to.">Dept</th>
                </tr></thead>
                <tbody id="courses-tbody"></tbody>
            </table>
            </div>
        </div>

    </div>

    <!-- Footer -->
    <footer class="site-footer">
        <div class="footer-links">
            <a href="https://uclagrades.com" target="_blank">Grade Data: uclagrades.com</a>
            <span class="dot">|</span>
            <a href="https://catalog.registrar.ucla.edu" target="_blank">Major Requirements: UCLA Course Catalog</a>
            <span class="dot">|</span>
            <a href="https://ethanuser.github.io/ucla-major-difficulty" target="_blank">Methodology &amp; Source Code</a>
        </div>
        <div>Grade distributions from 2021-2024. Major requirements from the 2025 UCLA General Catalog.</div>
        <div style="margin-top:4px">Difficulty is measured by weighted average GPA - see the <a href="https://ethanuser.github.io/ucla-major-difficulty" target="_blank">methodology page</a> for full details.</div>
        <div style="margin-top:12px;opacity:0.6;font-size:0.76rem">This is an independent student project and is not affiliated with, endorsed by, or officially associated with UCLA or the University of California.</div>
    </footer>

    <div class="tooltip" id="tooltip"></div>

    <!-- Inject data, then load app logic -->
    <script>const DATA = ''' + json.dumps(graph_data) + ''';</script>
    <script>
''' + js_content + '''
    </script>
</body>
</html>'''
    
    with open(output_path, 'w') as f:
        f.write(html_content)
    
    print(f"  Generated: {output_path}")


# ═══════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description='Analyze UCLA major difficulty')
    parser.add_argument('--no-html', action='store_true', help='Skip HTML generation')
    parser.add_argument('--top', type=int, default=20, help='Number of top results to print')
    args = parser.parse_args()
    
    print("=" * 60)
    print("  UCLA Hardest Major Analysis")
    print("=" * 60)
    
    # Check required files exist
    if not os.path.exists(REQUIREMENTS_FILE):
        print(f"\n❌ Missing: {REQUIREMENTS_FILE}")
        print(f"   Run: python3 scrape_ucla_catalog.py")
        sys.exit(1)
    
    if not os.path.exists(GRADE_STATS_FILE):
        print(f"\n❌ Missing: {GRADE_STATS_FILE}")
        print(f"   Run: python3 parse_grades.py")
        sys.exit(1)
    
    # Step 1: Load data
    print(f"\n📥 Loading data...")
    major_reqs, metadata = load_major_requirements(REQUIREMENTS_FILE)
    course_stats = load_grade_stats(GRADE_STATS_FILE)
    
    if metadata:
        print(f"  Catalog year: {metadata.get('catalog_year', 'unknown')}")
        print(f"  Scraped on:   {metadata.get('scrape_date', 'unknown')}")
    
    # Step 2: Match courses
    print(f"\n🔗 Matching courses to grade data...")
    matched = match_courses(major_reqs, course_stats)
    
    # Step 3: Score majors
    print(f"\n📊 Computing difficulty scores...")
    major_df = score_majors(matched, course_stats)
    
    # Print results
    print(f"\n{'='*70}")
    print(f"  UCLA HARDEST MAJORS (by blended GPA, lower = harder)")
    print(f"{'='*70}")
    for _, row in major_df.head(args.top).iterrows():
        dfw_str = f"DFW={row['dfw_rate']:.1f}%" if pd.notna(row.get('dfw_rate')) else ""
        print(f"  #{row['rank']:>3}  {row['major']:<50} GPA={row['avg_gpa']:.3f}  "
              f"%A={row['pct_A']:>5.1f}%  {dfw_str:>10}  ({row['num_exact_courses']}/{row['num_required_courses']} matched)")
    
    print(f"\n{'='*70}")
    print(f"  UCLA EASIEST MAJORS")
    print(f"{'='*70}")
    for _, row in major_df.tail(10).iloc[::-1].iterrows():
        dfw_str = f"DFW={row['dfw_rate']:.1f}%" if pd.notna(row.get('dfw_rate')) else ""
        print(f"  #{row['rank']:>3}  {row['major']:<50} GPA={row['avg_gpa']:.3f}  "
              f"%A={row['pct_A']:>5.1f}%  {dfw_str:>10}  ({row['num_exact_courses']}/{row['num_required_courses']} matched)")
    
    # Step 4: Save rankings CSV (with new dimensions)
    save_cols = ['rank', 'major', 'avg_gpa', 'pct_A', 'dfw_rate', 
                 'exact_gpa', 'dept_gpa', 'gateway_gpa', 'specific_gpa',
                 'num_gateway_courses', 'num_specific_courses',
                 'num_exact_courses', 'num_required_courses', 'num_dept_courses', 'total_students']
    major_df[[c for c in save_cols if c in major_df.columns]].to_csv(RANKINGS_FILE, index=False)
    print(f"\n✅ Saved: {RANKINGS_FILE}")
    
    # Step 5: Build and save graph data
    print(f"\n🕸 Building bipartite graph...")
    graph_data = build_graph_data(major_df, course_stats)
    
    with open(GRAPH_DATA_FILE, 'w') as f:
        json.dump(graph_data, f, indent=2)
    print(f"  Saved: {GRAPH_DATA_FILE}")
    print(f"  Graph: {len(graph_data['nodes'])} nodes, {len(graph_data['edges'])} edges")
    
    # Step 6: Generate HTML
    if not args.no_html:
        print(f"\n🎨 Generating interactive visualization...")
        generate_html(graph_data, HTML_FILE)
    
    print(f"\n{'='*60}")
    print(f"  DONE!")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()
