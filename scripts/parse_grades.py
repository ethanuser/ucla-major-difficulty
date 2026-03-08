#!/usr/bin/env python3
"""
UCLA Grade Data Parser
======================
Parses the UCLA grade distribution CSV files (2021-2025), normalizes
schemas, computes per-course grade metrics, and outputs a unified dataset.

Outputs: course_grade_stats.csv

Usage:
    python3 parse_grades.py                  # Parse all grade files
    python3 parse_grades.py --min-students 50  # Set minimum student threshold
"""

import pandas as pd
import numpy as np
import os
import argparse

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)  # Project root (one level up from scripts/)
RAW_DATA_DIR = os.path.join(BASE_DIR, 'data', 'raw')
PROCESSED_DIR = os.path.join(BASE_DIR, 'data', 'processed')
OUTPUT_FILE = os.path.join(PROCESSED_DIR, 'course_grade_stats.csv')

# Grade definitions
A_GRADES = {'A+', 'A', 'A-'}
B_GRADES = {'B+', 'B', 'B-'}
C_GRADES = {'C+', 'C', 'C-'}
D_GRADES = {'D+', 'D', 'D-'}
F_GRADES = {'F'}
LETTER_GRADES = A_GRADES | B_GRADES | C_GRADES | D_GRADES | F_GRADES
DFW_GRADES = D_GRADES | F_GRADES | {'DR', 'NC', 'NP'}  # D, F, Dropped, No Credit, No Pass

GPA_MAP = {
    'A+': 4.0, 'A': 4.0, 'A-': 3.7,
    'B+': 3.3, 'B': 3.0, 'B-': 2.7,
    'C+': 2.3, 'C': 2.0, 'C-': 1.7,
    'D+': 1.3, 'D': 1.0, 'D-': 0.7,
    'F': 0.0
}

# ═══════════════════════════════════════════════════════════════════
# Parsing Functions
# ═══════════════════════════════════════════════════════════════════

def load_grades_standard(path, year_label):
    """Parse 21-22 and 22-23 format."""
    print(f"  📄 Loading {os.path.basename(path)} ({year_label})...")
    df = pd.read_csv(path, dtype=str)
    df.columns = df.columns.str.strip()
    
    df = df.rename(columns={
        'SUBJECT AREA': 'subject_area',
        'CATLG NBR': 'catalog_number',
        'GRD OFF': 'grade',
        'GRD COUNT': 'grade_count',
        'ENRL TOT': 'enrollment',
        'LONG CRSE TITLE': 'course_title',
    })
    
    df['grade'] = df['grade'].str.strip()
    df['grade_count'] = pd.to_numeric(df['grade_count'], errors='coerce').fillna(0).astype(int)
    df['enrollment'] = pd.to_numeric(df['enrollment'], errors='coerce').fillna(0).astype(int)
    df['subject_area'] = df['subject_area'].str.strip()
    df['catalog_number'] = df['catalog_number'].str.strip()
    df['course_id'] = df['subject_area'] + ' ' + df['catalog_number']
    df['year'] = year_label
    
    cols = ['subject_area', 'catalog_number', 'course_id', 'grade', 'grade_count', 
            'enrollment', 'course_title', 'year']
    return df[[c for c in cols if c in df.columns]]


def load_grades_2324(path, year_label='2023-2024'):
    """Parse 23-24 format (different schema)."""
    print(f"  📄 Loading {os.path.basename(path)} ({year_label})...")
    df = pd.read_csv(path, dtype=str)
    df.columns = df.columns.str.strip()
    
    df = df.rename(columns={
        'subj_area_name': 'subject_area_full',
        'subj_area_cd': 'subject_area',
        'disp_catlg_no': 'catalog_number',
        'grd_cd': 'grade',
        'num_grd': 'grade_count',
        'enrl_tot': 'enrollment',
        'crs_long_ttl': 'course_title',
    })
    
    df['grade'] = df['grade'].str.strip()
    df['grade_count'] = pd.to_numeric(df['grade_count'], errors='coerce').fillna(0).astype(int)
    df['enrollment'] = pd.to_numeric(df['enrollment'], errors='coerce').fillna(0).astype(int)
    df['subject_area'] = df['subject_area'].str.strip()
    df['catalog_number'] = df['catalog_number'].str.strip()
    df['course_id'] = df['subject_area'] + ' ' + df['catalog_number']
    df['year'] = year_label
    
    cols = ['subject_area', 'catalog_number', 'course_id', 'grade', 'grade_count', 
            'enrollment', 'course_title', 'year']
    return df[[c for c in cols if c in df.columns]]


def compute_course_stats(all_grades, min_students=30):
    """Compute per-course grade metrics from the raw grade data, including DFW rates."""
    print(f"\n📊 Computing per-course statistics (min {min_students} students)...")
    
    # ── Letter grade stats ──
    letter_df = all_grades[all_grades['grade'].isin(LETTER_GRADES)].copy()
    letter_df['gpa_points'] = letter_df['grade'].map(GPA_MAP)
    letter_df['weighted_gpa'] = letter_df['gpa_points'] * letter_df['grade_count']
    letter_df['is_A'] = letter_df['grade'].isin(A_GRADES).astype(int) * letter_df['grade_count']
    letter_df['is_B'] = letter_df['grade'].isin(B_GRADES).astype(int) * letter_df['grade_count']
    letter_df['is_C'] = letter_df['grade'].isin(C_GRADES).astype(int) * letter_df['grade_count']
    letter_df['is_D'] = letter_df['grade'].isin(D_GRADES).astype(int) * letter_df['grade_count']
    letter_df['is_F'] = letter_df['grade'].isin(F_GRADES).astype(int) * letter_df['grade_count']
    
    course_stats = letter_df.groupby('course_id').agg(
        total_letter_grades=('grade_count', 'sum'),
        total_A=('is_A', 'sum'),
        total_B=('is_B', 'sum'),
        total_C=('is_C', 'sum'),
        total_D=('is_D', 'sum'),
        total_F=('is_F', 'sum'),
        weighted_gpa_sum=('weighted_gpa', 'sum'),
        subject_area=('subject_area', 'first'),
        course_title=('course_title', 'first'),
    ).reset_index()
    
    # ── DFW rate (D + F + Dropped/NC/NP, as fraction of ALL graded students) ──
    all_graded = all_grades.copy()
    all_graded['is_dfw'] = all_graded['grade'].isin(DFW_GRADES).astype(int) * all_graded['grade_count']
    dfw_stats = all_graded.groupby('course_id').agg(
        total_all_grades=('grade_count', 'sum'),
        total_dfw=('is_dfw', 'sum'),
    ).reset_index()
    
    course_stats = course_stats.merge(dfw_stats, on='course_id', how='left')
    
    # ── Derived metrics ──
    course_stats['pct_A'] = (course_stats['total_A'] / course_stats['total_letter_grades'] * 100).round(2)
    course_stats['pct_B'] = (course_stats['total_B'] / course_stats['total_letter_grades'] * 100).round(2)
    course_stats['pct_C'] = (course_stats['total_C'] / course_stats['total_letter_grades'] * 100).round(2)
    course_stats['pct_D'] = (course_stats['total_D'] / course_stats['total_letter_grades'] * 100).round(2)
    course_stats['pct_F'] = (course_stats['total_F'] / course_stats['total_letter_grades'] * 100).round(2)
    course_stats['avg_gpa'] = (course_stats['weighted_gpa_sum'] / course_stats['total_letter_grades']).round(3)
    course_stats['dfw_rate'] = (course_stats['total_dfw'] / course_stats['total_all_grades'] * 100).round(2)
    
    # Apply minimum student filter
    before = len(course_stats)
    course_stats = course_stats[course_stats['total_letter_grades'] >= min_students].copy()
    
    print(f"  Total courses (raw):     {before}")
    print(f"  After {min_students}-student filter: {len(course_stats)}")
    print(f"  Total student-grades:    {course_stats['total_letter_grades'].sum():,}")
    print(f"  Avg DFW rate:            {course_stats['dfw_rate'].mean():.1f}%")
    
    return course_stats


# ═══════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description='Parse UCLA grade distribution data')
    parser.add_argument('--min-students', type=int, default=30,
                        help='Minimum total letter grades per course (default: 30)')
    parser.add_argument('--output', type=str, default=OUTPUT_FILE,
                        help='Output CSV file path')
    args = parser.parse_args()
    
    print("=" * 60)
    print("  UCLA Grade Data Parser")
    print("=" * 60)
    
    # Discover grade files
    grade_files = []
    if os.path.isdir(RAW_DATA_DIR):
        for fname in sorted(os.listdir(RAW_DATA_DIR)):
            fpath = os.path.join(RAW_DATA_DIR, fname)
            if fname.endswith('.csv') and 'ucla_grades' in fname.lower():
                grade_files.append(fpath)
    
    if not grade_files:
        print("❌ No grade CSV files found! Expected files like 'ucla_grades_21_22.csv'")
        return
    
    print(f"\n📂 Found {len(grade_files)} grade file(s):")
    for f in grade_files:
        print(f"   {os.path.basename(f)}")
    
    # Load all grade data
    print(f"\n📥 Loading grade data...")
    dfs = []
    for fpath in grade_files:
        fname = os.path.basename(fpath)
        # Extract year label from filename
        year_parts = fname.replace('.csv', '').split('_')[-2:]
        year_label = '-'.join(year_parts) if year_parts else 'unknown'
        
        # Auto-detect format by sniffing the header
        with open(fpath, 'r') as peek:
            header = peek.readline().strip().lower()
        
        if 'subj_area_cd' in header or 'grd_cd' in header:
            # 23-24 / 24-25 format
            dfs.append(load_grades_2324(fpath, year_label))
        elif 'subject area' in header or 'grd off' in header:
            # 21-22 / 22-23 format
            dfs.append(load_grades_standard(fpath, year_label))
        else:
            print(f"  ⚠ Unknown format for {fname}, trying standard parser...")
            dfs.append(load_grades_standard(fpath, year_label))
    
    all_grades = pd.concat(dfs, ignore_index=True)
    print(f"\n  Total grade records:   {len(all_grades):,}")
    print(f"  Unique subject areas:  {all_grades['subject_area'].nunique()}")
    print(f"  Unique courses:        {all_grades['course_id'].nunique()}")
    
    # Compute course stats
    course_stats = compute_course_stats(all_grades, args.min_students)
    
    # Save output
    output_cols = ['course_id', 'subject_area', 'course_title', 'avg_gpa', 'pct_A', 
                   'pct_B', 'pct_C', 'pct_D', 'pct_F', 'dfw_rate',
                   'total_letter_grades', 'total_all_grades', 'total_dfw',
                   'total_A', 'total_B', 'total_C', 'total_D', 'total_F']
    course_stats[output_cols].to_csv(args.output, index=False)
    
    print(f"\n✅ Saved: {args.output}")
    print(f"   {len(course_stats)} courses with grade statistics")
    
    # Quick summary
    print(f"\n{'='*60}")
    print(f"  GRADE OVERVIEW")
    print(f"{'='*60}")
    print(f"  Overall avg GPA:  {course_stats['avg_gpa'].mean():.3f}")
    print(f"  Median avg GPA:   {course_stats['avg_gpa'].median():.3f}")
    print(f"  Hardest course:   {course_stats.loc[course_stats['avg_gpa'].idxmin(), 'course_id']} "
          f"(GPA: {course_stats['avg_gpa'].min():.3f})")
    print(f"  Highest GPA course:   {course_stats.loc[course_stats['avg_gpa'].idxmax(), 'course_id']} "
          f"(GPA: {course_stats['avg_gpa'].max():.3f})")
    
    return course_stats


if __name__ == '__main__':
    main()
