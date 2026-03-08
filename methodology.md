# Methodology: UCLA Major Difficulty Analysis

> **Note:** Much of this document was written with generative AI assistance. It remains under review and should be read as exploratory documentation rather than a finalized scholarly treatment.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Data Acquisition](#2-data-acquisition)
3. [Data Preprocessing](#3-data-preprocessing)
4. [Web Scraping](#4-web-scraping)
5. [Course Matching](#5-course-matching)
6. [Difficulty Scoring](#6-difficulty-scoring)
7. [Graph Construction & Professor Comparison](#7-graph-construction--professor-comparison)
8. [Key Results](#8-key-results)
9. [Assumptions & Limitations](#9-assumptions--limitations)
10. [Possible Extensions](#10-possible-extensions)

---

## 1. Problem Statement

**Goal:** Rank all UCLA undergraduate majors by observed grading difficulty.

A major is "harder" if its required courses yield lower average GPAs, fewer A-range grades, and higher failure/withdrawal rates. We measure:
- **Blended average GPA** (60% exact course matches, 40% department averages)
- **% A-range** (fraction of letter grades that are A+/A/A-)
- **DFW rate** (D/F/Withdrawn percentage)
- **Shared vs. major-specific course decomposition**

This captures *observed* difficulty — how grades actually distribute rather than an abstract measure of rigor. A rough ability adjustment using transfer-admit GPA data is available (see [Section 9.2.1](#921-transfer-admit-gpa-robustness-check)), but the primary view does not adjust for student preparedness, curved grading, or workload. See [Section 9](#9-assumptions--limitations) for a full discussion.

---

## 2. Data Acquisition

### 2.1 Grade Distribution Data

**Source:** [uclagrades.com](https://uclagrades.com)

| File | Year | Rows | Schema |
|------|------|------|--------|
| `ucla_grades_21_22.csv` | 2021-22 | ~40K | Standard |
| `ucla_grades_22_23.csv` | 2022-23 | ~38K | Standard |
| `ucla_grades_23_24.csv` | 2023-24 | ~48K | New |
| `ucla_grades_24_25.csv` | 2024-25 | ~50K | New |

Each row is one (course section, grade) observation. The two schemas differ in column names; the parser auto-detects format.

### 2.2 Major Requirements Data

**Source:** [UCLA General Catalog](https://catalog.registrar.ucla.edu) (2025-26)

The catalog is JS-rendered; we use Playwright (headless Chromium) to load each major's page and extract course links. 137 of 141 majors returned data.

---

## 3. Data Preprocessing

**Script:** `parse_grades.py`

Both CSV schemas are normalized to a common format (`subject_area`, `course_id`, `grade`, `grade_count`, etc.). Only letter grades (A+ through F, standard 4.0 scale) are used for GPA. P/NP, Incomplete, and Withdrawal are excluded from GPA but D/F/DR/NC/NP count toward the DFW rate.

Courses with fewer than **30 letter grades** across all years are excluded.

**Result:** 4,573 qualifying courses, 1,454,501 student-grade records. Average DFW rate: 1.3% (individual courses range from 0% to 15%+).

---

## 4. Web Scraping

**Script:** `scrape_ucla_catalog.py`

For each of 141 major URLs, Playwright loads the page, waits for rendering, and extracts `<a href="/course/...">` links. Cross-listed prefixes (M, C, CM) are handled via regex. Progress checkpoints allow resuming interrupted scrapes.

**Result:** 9,625 course references across 137 majors, ~100 subject areas.

---

## 5. Course Matching

**Script:** `analyze_hardest_major.py`

| Strategy | Count |
|----------|-------|
| Exact course ID match | 6,031 |
| Department-level fallback (all courses in linked subject areas) | 52,499 |
| Unmatched (not in grade data) | 3,594 |

Unmatched courses are typically cross-listed naming differences, courses not offered 2021-25, or graduate courses in undergrad requirements.

---

## 6. Difficulty Scoring

### 6.1 Blended GPA (Primary Signal)

```
DifficultyScore(m) = 0.6 × GPA_exact + 0.4 × GPA_dept
```

- **GPA_exact:** Enrollment-weighted average GPA across exact-match required courses
- **GPA_dept:** Enrollment-weighted average GPA across all courses in the major's subject areas

**Why 60/40:** Exact matches are the most direct signal; the department component compensates for unmatched courses and captures broader grading culture.

**Why enrollment weighting:** A 500-student gateway course should count more than a 5-student seminar.

### 6.2 DFW Rate

The DFW rate (D/F/Dropped/NC/NP as a percentage of all graded students) captures a different dimension from GPA. A course with all B+'s has 0% DFW; a course where half fail has high DFW regardless of the average GPA.

### 6.3 Shared vs. Major-Specific Decomposition

Courses required by 3+ majors are classified as **gateway courses** (698 total; e.g., MATH 31A is shared by 51 majors). Each major's GPA is decomposed into gateway and major-specific components, revealing department-specific grading difficulty independent of shared prerequisites.

---

## 7. Graph Construction & Professor Comparison

### 7.1 Bipartite Graph

A bipartite graph connects 137 major nodes to ~100 subject area nodes (916 edges). Rendered as an interactive force-directed canvas layout with purple-spectrum major nodes (harder = brighter) and cyan subject nodes.

### 7.2 Department GPA

Each department's enrollment-weighted average GPA and % A-range is used for graph tooltips, the Departments tab, and the 40% department component of major scoring.

### 7.3 Professor Comparison (Exploratory)

The Professor tab compares instructors within each department by average GPA of courses taught. **This is exploratory context, not a measure of teaching quality.**

- Each (instructor, course, term) = one class section; 10+ sections required to appear
- Average GPA and % A-range are enrollment-weighted; rank is within department only
- Links to Bruinwalk provide student reviews as a separate signal

**Why this is not a teaching quality metric:** Average GPA reflects course assignment (weed-out vs. elective), student population, and department norms. Instructors who teach gateway courses will have lower GPAs regardless of teaching effectiveness. The comparison does not control for course mix, class size, or student preparedness. Use for exploratory context only.

---

## 8. Key Results

### Top 15 Hardest Majors

| Rank | Major | GPA | % A | DFW | Matched/Total |
|------|-------|-----|-----|-----|---------------|
| 1 | Economics BA | 3.168 | 45.1% | 4.0% | 19/21 |
| 2 | Business Economics BA | 3.181 | 46.5% | 3.8% | 16/18 |
| 3 | Mathematics/Economics BS | 3.241 | 51.7% | 4.3% | 37/41 |
| 4 | Linguistics & Computer Science BA | 3.254 | 53.6% | 4.9% | 28/33 |
| 5 | Financial Actuarial Mathematics BS | 3.270 | 53.4% | 3.8% | 33/36 |
| 6 | Atmospheric & Oceanic Sci/Math BS | 3.313 | 56.3% | 3.9% | 40/47 |
| 7 | Mathematics for Teaching BS | 3.334 | 57.3% | 3.8% | 44/47 |
| 8 | Applied Mathematics BS | 3.336 | 57.6% | 3.8% | 40/41 |
| 9 | Mathematics of Computation BS | 3.337 | 57.5% | 3.8% | 31/31 |
| 10 | Chemistry BS | 3.340 | 57.5% | 3.9% | 43/56 |
| 11 | Chemistry/Materials Science BS | 3.343 | 57.5% | 3.9% | 51/68 |
| 12 | Linguistics & Philosophy BA | 3.343 | 58.9% | 4.6% | 32/40 |
| 13 | Physics BS | 3.347 | 58.5% | 3.9% | 45/52 |
| 14 | Physics BA | 3.348 | 58.6% | 3.9% | 29/29 |
| 15 | Astrophysics BS | 3.351 | 58.7% | 3.9% | 44/51 |

### Top 10 Easiest Majors

| Rank | Major | GPA | % A | DFW | Matched/Total |
|------|-------|-----|-----|-----|---------------|
| 137 | Dance BA | 3.914 | 94.7% | 0.7% | 34/59 |
| 136 | Art BA | 3.897 | 93.0% | 0.3% | 19/27 |
| 135 | World Arts & Cultures BA | 3.887 | 92.6% | 0.7% | 10/13 |
| 134 | Music Performance BM | 3.882 | 92.1% | 0.5% | 30/113 |
| 133 | Music BA | 3.880 | 91.8% | 0.5% | 18/24 |
| 132 | Music History & Industry BA | 3.869 | 91.8% | 1.0% | 35/45 |
| 131 | Musicology BA | 3.867 | 91.6% | 1.0% | 33/44 |
| 130 | Design Media Arts BA | 3.855 | 91.2% | 1.0% | 14/33 |
| 129 | Education & Social Transformation BA | 3.851 | 90.3% | 0.5% | 15/25 |
| 128 | Gender Studies BA | 3.842 | 90.3% | 1.1% | 5/11 |

### Key Observations

- **Economics BA** ranks #1 (lowest GPA, highest DFW among top majors). This is somewhat puzzling given Econ's less selective admission than CS or Math; the interpretation remains unresolved (see 9.2).
- **DFW rates correlate with GPA**: hard-GPA majors have 3.5-5.0% DFW rates vs. 0.3-1.1% for easy majors.
- **Linguistics & CS BA** (#4) has the highest DFW of any major (4.9%).
- **Math/Econ BS** is harder than pure Math BS (3.241 vs 3.355), combining the hardest courses from both departments.
- GPA spread: 0.75 points (3.17 to 3.91). DFW spread: ~4 percentage points.

---

## 9. Assumptions & Limitations

### 9.1 Selection Bias
Students who struggle often drop courses or elect P/NP, so remaining grades may overstate how easy a course is. DFW partially compensates by capturing dropped/failed students.

### 9.2 Student Preparedness and Curved Grading

Student preparedness varies between majors, and we cannot fully adjust for it. No public dataset links UCLA grades to individual student ability (FERPA protects transcripts). Available proxies (admission rates, SAT/ACT) are too noisy or unavailable at the major level.

The literature suggests grading standards matter more than student ability: Rojstaczer & Healy found SAT/ACT explain <14% of cross-department GPA variance; Valen Johnson (Duke, 2003) found departments with higher-ability students grade *more* strictly; Baucks et al. (2025) confirmed STEM > humanities difficulty persists after ability adjustment.

**The Economics puzzle:** Economics (#1) is open declaration while CS has ~4% acceptance. Econ's low GPA could partly reflect a less selective student pool rather than strict grading alone. We treat this as unresolved.

**Curved grading:** In curved STEM classes with high-performing students, competition for limited A's makes experienced difficulty higher than GPA alone suggests. The 45% A-range in STEM vs. 90%+ in humanities is too large to explain by curving alone.

#### 9.2.1 Transfer-Admit GPA Robustness Check

To partially address the ability confound, we use UCLA's [Transfer Admission Profile (Fall 2025)](https://admission.ucla.edu/apply/transfer/transfer-profile/2025/major). For each major, the midpoint of 25th/75th percentile admit GPAs serves as a rough ability proxy (118 of 137 ranked majors covered).

**Key stats:** Pearson r = −0.35 (p < 0.001), OLS slope = −0.46, R² = 0.12. Higher-ability-admit majors tend to have lower course GPAs.

**Site toggle method:** `adjusted_gpa = raw_gpa - 0.46 * (ability_proxy - mean)`. This penalizes majors with higher-GPA admits, reflecting that low course GPAs are more notable when admit GPAs are high. CS rises from #16 to #6; engineering majors rise similarly. Economics stays #1. A separate residual-based analysis is in `data/processed/ability_adjusted_rankings.csv`.

**Limitations:** Transfer-admit GPA reflects community college performance, not enrolled student ability. It conflates student ability with pre-transfer course difficulty (a 4.0 in pre-CS coursework is harder to earn than a 3.95 in pre-Econ). Many majors hit a ceiling near 4.00, compressing variance. R² = 0.12 means the proxy explains little of the GPA variation. This is a rough robustness check, not a causal estimate.

### 9.3 Temporal Aggregation
Grades from 2021-2025 are aggregated, which smooths yearly variation but may mask trends (e.g., post-COVID grade inflation).

### 9.4 Course and Unit Weighting
Courses are weighted by enrollment, not unit count. A 1-unit lab and 5-unit lecture count the same per student.

### 9.5 Elective Pools
All courses linked from the catalog page are included. Majors with broad elective pools may appear easier/harder depending on which electives are listed.

### 9.6 Incomplete Data
4 of 141 majors returned no data. ~37% of scraped course references had no exact match in grade data (department-level fallback compensates). Cross-listed courses may be counted under one department but listed under another.

### 9.7 No Workload Measure
The analysis does not account for study hours or total units. Engineering majors typically require more units and lab hours than humanities majors.

---

## 10. Possible Extensions

1. **Unit-weighted scoring** — weight courses by unit count
2. **Required vs. elective separation** — distinguish required from elective pools
3. **Grade inflation trends** — year-over-year GPA comparison per department
4. **Network centrality** — identify which departments are most "load-bearing" across majors
5. **Controlled regression** — regress GPA on instructor, time-of-day, class size, year
6. **Cross-listed course resolution** — canonical course ID lookup table
7. **Student pathway analysis** — if transcript data were available
8. **Confidence intervals** — bootstrap intervals on difficulty scores

---

## Pipeline Architecture

```
  ┌──────────────────────┐     ┌──────────────────────┐
  │   uclagrades.com     │     │  catalog.registrar.  │
  │  (download CSVs)     │     │  ucla.edu (scrape)   │
  └──────────┬───────────┘     └──────────┬───────────┘
             │                            │
             ▼                            ▼
  ┌──────────────────────┐     ┌──────────────────────┐
  │   parse_grades.py    │     │scrape_ucla_catalog.py│
  └──────────┬───────────┘     └──────────┬───────────┘
             │                            │
             ▼                            ▼
     course_grade_stats.csv   ucla_major_requirements.json
             │                            │
             └────────────┬───────────────┘
                          ▼
              ┌──────────────────────┐
              │ analyze_hardest_     │
              │ major.py             │
              └──────────┬───────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
  major_difficulty  graph_data    index.html
  _rankings.csv     .json

  ┌──────────────────────┐
  │  admission.ucla.edu  │
  │  (transfer profile)  │
  └──────────┬───────────┘
             ▼
  ┌──────────────────────┐
  │scrape_transfer_      │
  │profile.py            │
  └──────────┬───────────┘
             ▼
  ucla_transfer_profile_2025.csv
             │
             ▼
  ┌──────────────────────┐
  │merge_transfer_data.py│◄── major_difficulty_rankings.csv
  └──────────┬───────────┘
             ▼
  merged_...with_transfer_proxy.csv
             │
             ▼
  ┌──────────────────────┐
  │analyze_ability_      │
  │proxy.py              │
  └──────────┬───────────┘
             ▼
  ability_adjusted_rankings.csv
```

## Technical Stack

| Component | Technology |
|-----------|-----------|
| Web scraping | Python + Playwright (headless Chromium) |
| Data processing | pandas, numpy |
| Visualization | Vanilla HTML/CSS/JS with canvas-based force layout |
| Output formats | CSV, JSON, HTML |
| Orchestration | `run_pipeline.py` with subprocess chaining |
