#!/usr/bin/env python3
"""
UCLA Major Difficulty Analysis - Pipeline Runner
==============================================
Runs the full pipeline or individual steps:

Usage:
    python3 scripts/run_pipeline.py              # Run everything
    python3 scripts/run_pipeline.py scrape       # Only scrape catalog
    python3 scripts/run_pipeline.py parse        # Only parse grades
    python3 scripts/run_pipeline.py analyze      # Only run analysis (requires scrape + parse outputs)
    python3 scripts/run_pipeline.py parse analyze # Run parse then analyze
"""

import subprocess
import sys
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)  # Project root

STEPS = {
    'scrape': {
        'script': os.path.join(SCRIPT_DIR, 'scrape_ucla_catalog.py'),
        'description': 'Scrape UCLA catalog for major requirements',
        'output': os.path.join(BASE_DIR, 'data', 'processed', 'ucla_major_requirements.json'),
    },
    'parse': {
        'script': os.path.join(SCRIPT_DIR, 'parse_grades.py'),
        'description': 'Parse grade distribution CSVs',
        'output': os.path.join(BASE_DIR, 'data', 'processed', 'course_grade_stats.csv'),
    },
    'analyze': {
        'script': os.path.join(SCRIPT_DIR, 'analyze_hardest_major.py'),
        'description': 'Analyze difficulty & generate visualization',
        'output': os.path.join(BASE_DIR, 'index.html'),
    },
}

def run_step(name):
    step = STEPS[name]
    print(f"\n{'='*60}")
    print(f"  Step: {step['description']}")
    print(f"  Script: {os.path.basename(step['script'])}")
    print(f"{'='*60}\n")
    
    cmd = [sys.executable, step['script']]
    result = subprocess.run(cmd, cwd=BASE_DIR)
    
    if result.returncode != 0:
        print(f"\n❌ Step '{name}' failed with exit code {result.returncode}")
        sys.exit(result.returncode)
    
    output_path = step['output']
    if os.path.exists(output_path):
        size = os.path.getsize(output_path)
        print(f"\n✅ Output: {os.path.relpath(output_path, BASE_DIR)} ({size:,} bytes)")
    else:
        print(f"\n⚠ Expected output not found: {os.path.relpath(output_path, BASE_DIR)}")


def main():
    if len(sys.argv) > 1:
        steps = sys.argv[1:]
    else:
        steps = ['scrape', 'parse', 'analyze']
    
    # Validate step names
    for step in steps:
        if step not in STEPS:
            print(f"❌ Unknown step: {step}")
            print(f"   Available: {', '.join(STEPS.keys())}")
            sys.exit(1)
    
    print("🚀 UCLA Major Difficulty Analysis Pipeline")
    print(f"   Steps: {' → '.join(steps)}")
    
    for step in steps:
        run_step(step)
    
    print(f"\n{'='*60}")
    print(f"  🎉 PIPELINE COMPLETE!")
    print(f"{'='*60}")
    
    if 'analyze' in steps:
        html_path = STEPS['analyze']['output']
        if os.path.exists(html_path):
            print(f"\n  Open in browser: file://{html_path}")


if __name__ == '__main__':
    main()
