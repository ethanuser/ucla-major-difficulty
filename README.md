# UCLA Major Difficulty Analysis

**Determining the hardest UCLA undergraduate major using grade distribution data and scraped course catalog requirements.**

This project combines 4 years of official UCLA grade data (2021–2025) with web-scraped major requirements from the UCLA General Catalog to rank all 137 undergraduate majors by academic difficulty. The result is an interactive HTML dashboard with rankings, a bipartite graph visualization, and per-course deep dives.

🔗 **[View the live dashboard](https://ethanuser.github.io/ucla-major-difficulty/)**

---

## Quick Start

```bash
# 1. Install dependencies
pip install pandas numpy playwright
python -m playwright install chromium

# 2. Run the full pipeline (scrape → parse → analyze)
python scripts/run_pipeline.py

# 3. Open the interactive dashboard
open index.html
```

Or run individual steps:

```bash
python scripts/run_pipeline.py scrape        # Only scrape UCLA catalog
python scripts/run_pipeline.py parse         # Only parse grade CSVs
python scripts/run_pipeline.py analyze       # Only run analysis (needs scrape + parse outputs)
python scripts/run_pipeline.py parse analyze # Re-parse grades and re-analyze
```

---

## Key Results

| Rank | Hardest Majors | Avg GPA | % A-range |
|------|---------------|---------|-----------|
| 1 | Economics BA | 3.168 | 31.6% |
| 2 | Business Economics BA | 3.181 | 33.0% |
| 3 | Mathematics/Economics BS | 3.241 | 39.0% |
| 4 | Linguistics & Computer Science BA | 3.254 | 41.1% |
| 5 | Financial Actuarial Mathematics BS | 3.270 | 39.8% |

| Rank | Highest GPA Majors | Avg GPA | % A-range |
|------|---------------|---------|-----------|
| 137 | Dance BA | 3.914 | 89.6% |
| 136 | Art BA | 3.897 | 84.0% |
| 135 | World Arts & Cultures BA | 3.887 | 87.3% |
| 134 | Music Performance BM | 3.882 | 87.1% |
| 133 | Music BA | 3.880 | 86.8% |

**GPA spread:** 0.75 GPA points between hardest (3.168) and easiest (3.914).

---

## Project Structure

```
UCLA Grades/
├── index.html                          # Interactive dashboard (GitHub Pages entry point)
├── README.md                           # This file
├── methodology.md                      # Full data science methodology
├── .gitignore
├── data/
│   ├── raw/                            # Original grade CSVs from uclagrades.com
│   │   ├── ucla_grades_21_22.csv
│   │   ├── ucla_grades_22_23.csv
│   │   ├── ucla_grades_23_24.csv
│   │   └── ucla_grades_24_25.csv
│   └── processed/                      # Generated intermediate data
│       ├── course_grade_stats.csv      # Per-course grade metrics
│       ├── ucla_major_requirements.json # Scraped major→course mappings
│       ├── major_difficulty_rankings.csv # Final ranked output
│       └── graph_data.json             # Bipartite graph data
└── scripts/
    ├── run_pipeline.py                 # Pipeline orchestrator
    ├── scrape_ucla_catalog.py          # Scrapes major requirements from UCLA catalog
    ├── parse_grades.py                 # Parses grade distribution CSVs
    └── analyze_hardest_major.py        # Matches courses, scores majors, generates dashboard
```

### Scripts

| Script | Description | Key Flags |
|--------|-------------|-----------|
| `scripts/scrape_ucla_catalog.py` | Scrapes major requirements from UCLA catalog using Playwright | `--resume`, `--use-fallback`, `--max-majors N` |
| `scripts/parse_grades.py` | Parses grade distribution CSVs, auto-detects schema | `--min-students N`, `--output PATH` |
| `scripts/analyze_hardest_major.py` | Matches courses, scores majors, generates dashboard | `--no-html`, `--top N` |
| `scripts/run_pipeline.py` | Orchestrates all three steps | `scrape`, `parse`, `analyze` |

---

## Data Sources

### Grade Data
Downloaded from [uclagrades.com](https://uclagrades.com). Each CSV contains per-section grade distributions including:
- Subject area + catalog number
- Grade code + count (A+ through F, plus P/NP, etc.)
- Total enrollment
- Instructor name
- Course title

**Two CSV schemas exist** — the parser auto-detects format by sniffing the header row:
- 2021–23: `SUBJECT AREA`, `CATLG NBR`, `GRD OFF`, `GRD COUNT`
- 2023–25: `subj_area_cd`, `disp_catlg_no`, `grd_cd`, `num_grd`

### Catalog Data
Scraped from `catalog.registrar.ucla.edu` using Playwright (headless Chromium). Each major's requirements page is loaded, and all `<a href="/course/...">` links are extracted to identify required courses and their departments.

---

## How It Works

See [methodology.md](methodology.md) for the complete data science methodology, including:
- Preprocessing pipeline
- Hybrid scoring function (GPA + DFW rate + shared-course decomposition)
- Student ability and peer competition analysis (with research citations)
- Assumptions and limitations
- Possible extensions

### Summary

1. **Scrape** 141 major pages from the UCLA catalog → extract 9,625 course references
2. **Parse** 4 years of grade data (176K records) → compute per-course GPA and DFW rate metrics for 4,573 courses
3. **Match** scraped requirements to grade data using exact course ID matching (6,031 matches) with department-level fallback
4. **Score** each major using a 60/40 blend of exact-match GPA and department-average GPA, weighted by enrollment
5. **Visualize** results in an interactive HTML dashboard with bipartite graph

---

## GitHub Pages Deployment

This repo is configured for GitHub Pages deployment from the root directory:

1. Push to GitHub
2. Go to **Settings → Pages → Source** → select `main` branch, `/ (root)` directory
3. The dashboard will be live at `https://YOUR_USERNAME.github.io/REPO_NAME/`

The `index.html` is a fully self-contained single-file app — no build step needed.

---

## Dependencies

- Python 3.10+
- `pandas` — data manipulation
- `numpy` — numerical operations
- `playwright` — headless browser for scraping JS-rendered catalog pages

---

## Adding New Grade Data

1. Download the new year's CSV from [uclagrades.com](https://uclagrades.com)
2. Save it as `ucla_grades_XX_YY.csv` in the `data/raw/` directory
3. Run `python scripts/run_pipeline.py parse analyze` to re-parse and re-analyze

The parser auto-detects the CSV schema, so no code changes are needed.
