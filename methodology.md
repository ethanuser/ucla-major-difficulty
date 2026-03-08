# Methodology: UCLA Hardest Major Analysis

A detailed account of every step in the analysis pipeline — from raw data acquisition to the final difficulty rankings.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Data Acquisition](#2-data-acquisition)
3. [Data Preprocessing](#3-data-preprocessing)
4. [Web Scraping](#4-web-scraping)
5. [Course Matching](#5-course-matching)
6. [Difficulty Scoring](#6-difficulty-scoring)
7. [Graph Construction](#7-graph-construction) — includes [Department GPA & % A](#73-department-subject-area-gpa-and--a) — includes [Department GPA & % A](#73-department-subject-area-gpa-and--a) (incl. [Department GPA](#73-department-subject-area-gpa-and--a)) (includes [Department GPA](#73-department-subject-area-gpa-and--a))
8. [Key Results](#8-key-results)
9. [Assumptions & Limitations](#9-assumptions--limitations)
10. [Possible Extensions](#10-possible-extensions)

---

## 1. Problem Statement

**Goal:** Rank all UCLA undergraduate majors by academic difficulty.

**Operational definition:** A major is "harder" if the courses it requires yield lower average GPAs, a lower percentage of A-range grades (A+, A, A−), and higher failure/withdrawal rates. This is measured by:
- A **blended average GPA** that combines exact course-level data with department-level averages
- A **% A-range** metric indicating what fraction of letter grades fall in the A+/A/A− bucket
- A **DFW rate** (D/F/Withdrawn) capturing courses where students genuinely fail — an ability-independent difficulty signal
- A **shared vs. major-specific course decomposition** distinguishing universal gateway difficulty from department-specific grading

This approach captures *observed grading difficulty* — it reflects how grades actually distribute in each major's required coursework, not an abstract measure of intellectual rigor.

### Why GPA Genuinely Reflects Course Difficulty

A natural objection is: "Aren't CS students just smarter, inflating their own GPAs?" The academic literature strongly suggests otherwise.

**Stuart Rojstaczer & Christopher Healy** ([gradeinflation.com](https://gradeinflation.com)), who compiled grade data from 160+ universities covering 2+ million students, found:

- **SAT scores explain only ~0.1 GPA per 100 points** across institutions
- SAT/ACT scores account for **less than 14% of the variance** in GPA (per UC system data)
- The humanities–STEM grading gap **persists almost unchanged** after controlling for student academic aptitude
- Their conclusion: **departmental grading standards are the dominant driver** of GPA differences, not student ability

Additionally, the **McSpirit & Jones (1999)** study at an open-admissions university found grade inflation persisted even after controlling for ACT scores, gender, and college major. Lower-ability students experienced the *highest* rate of grade increase.

This means the GPA differences we observe between, say, Economics (3.17) and Art (3.90) are largely **real differences in grading strictness**, not artifacts of who's enrolled. Student self-selection exists, but it accounts for a small fraction of the 0.73-point GPA gap.

> **Bottom line:** Admission rates and standardized test scores are noisy proxies for student ability, and even the best studies show they explain a minority of GPA variance. Grading standards within departments are the primary signal — which is exactly what our data measures.

---

## 2. Data Acquisition

### 2.1 Grade Distribution Data

**Source:** [uclagrades.com](https://uclagrades.com)

Four CSV files were downloaded, each containing official per-section grade counts for one academic year:

| File | Year | Rows | Schema |
|------|------|------|--------|
| `ucla_grades_21_22.csv` (5.7 MB) | 2021–2022 | ~40K | Standard |
| `ucla_grades_22_23.csv` (4.9 MB) | 2022–2023 | ~38K | Standard |
| `ucla_grades_23_24.csv` (5.9 MB) | 2023–2024 | ~48K | New |
| `ucla_grades_24_25.csv` (6.1 MB) | 2024–2025 | ~50K | New |

Each row represents a single (course section, grade) observation:

**Standard schema (2021–23):**
```
SUBJECT AREA | CATLG NBR | GRD OFF | GRD COUNT | ENRL TOT | LONG CRSE TITLE
COM SCI      | 31        | A       | 85        | 250      | INTRO CS I
```

**New schema (2023–25):**
```
subj_area_cd | disp_catlg_no | grd_cd | num_grd | enrl_tot | crs_long_ttl
COM SCI      | 31            | A      | 85      | 250      | Intro CS I
```

### 2.2 Major Requirements Data

**Source:** [UCLA General Catalog](https://catalog.registrar.ucla.edu) (2025–26 academic year)

The catalog is a JavaScript-rendered React application — standard HTTP requests return only an empty shell. We use **Playwright** (headless Chromium) to:

1. Load each major's requirements page (e.g., `.../major/2025/ComputerScienceBS`)
2. Wait for JS rendering to complete
3. Extract all `<a href="/course/...">` links, which contain the required course IDs

A fallback list of 141 major URL slugs is maintained in `scrape_ucla_catalog.py`. Of these, **137 successfully returned course data** and 4 had invalid slugs or no listed requirements.

---

## 3. Data Preprocessing

**Script:** `parse_grades.py`

### 3.1 Schema Auto-Detection

Rather than hardcoding which parser to use per file, the script reads the first line of each CSV and checks for known column names:
- Header contains `subj_area_cd` or `grd_cd` → new schema parser
- Header contains `SUBJECT AREA` or `GRD OFF` → standard schema parser

This makes the pipeline forward-compatible: dropping a new `ucla_grades_25_26.csv` into the directory will just work.

### 3.2 Normalization

Both schemas are mapped to a common format:

| Normalized Column | Description |
|-------------------|------------|
| `subject_area` | Department code (e.g., `COM SCI`) |
| `catalog_number` | Course number (e.g., `31`) |
| `course_id` | Combined key: `COM SCI 31` |
| `grade` | Letter grade (A+ through F) |
| `grade_count` | Number of students receiving this grade |
| `enrollment` | Total section enrollment |
| `course_title` | Full course name |
| `year` | Academic year label |

### 3.3 Grade Filtering

Only **letter grades** are retained for GPA computation:

| Grade | GPA Points |
|-------|-----------|
| A+ | 4.0 |
| A | 4.0 |
| A− | 3.7 |
| B+ | 3.3 |
| B | 3.0 |
| B− | 2.7 |
| C+ | 2.3 |
| C | 2.0 |
| C− | 1.7 |
| D+ | 1.3 |
| D | 1.0 |
| D− | 0.7 |
| F | 0.0 |

Pass/No Pass (P/NP), Incomplete (I), Withdrawal (W), and other non-letter grades are excluded.

### 3.4 Minimum Sample Threshold

Courses with fewer than **30 total letter grades** across all four years are excluded. This filters out rarely-offered seminars and independent study courses that would add noise.

**Result:** 6,837 unique courses → **4,573 qualifying courses** with 1,454,501 total student-grade records.

### 3.5 Per-Course Metrics

For each qualifying course:
- **Average GPA:** Enrollment-weighted mean of GPA points
- **% A-range:** Fraction of letter grades that are A+, A, or A−
- **% B/C/D/F:** Similar breakdowns for other grade tiers
- **DFW rate:** Percentage of *all* graded students (including non-letter grades) who received D, F, DR (dropped), NC (no credit), or NP (no pass). This captures students who effectively failed or withdrew — an ability-independent difficulty signal since it reflects courses that "break" students regardless of cohort quality.
- **Total letter grades:** Count of students with letter grades (sum across all years)

**Average DFW rate across all courses:** 1.3% (low because most students pass, but individual courses vary from 0% to 15%+)

**Output:** `course_grade_stats.csv`

---

## 4. Web Scraping

**Script:** `scrape_ucla_catalog.py`

### 4.1 URL Discovery

A comprehensive list of UCLA undergraduate major URLs was compiled using:
1. Browser-based exploration of the catalog's search system (filtering by "Undergraduate" degree level)
2. Manual addition of known majors
3. Correction of URL slugs via catalog search for majors that returned no data on first pass

**Catalog URL pattern:** `https://catalog.registrar.ucla.edu/major/2025/{MajorSlug}`

Examples of slug naming conventions discovered:
- `ComputerScienceBS` (straightforward)
- `EuropeanLanguagesandTransculturalStudieswithFrenchandFrancophoneBA` (long concatenation)
- `AstrophysicsBS` (catalog name differs from common name "Astronomy and Astrophysics")
- `NursingBSPrelicensure` (includes program qualifier)

### 4.2 Page Scraping

For each major URL:
1. Navigate with Playwright (`wait_until='networkidle'`)
2. Wait 3 seconds for JS rendering
3. Extract all `<a href="/course/...">` links via `eval_on_selector_all`
4. Parse each link's text: `"COM SCI 31 - Introduction to Computer Science I"` →
   - `course_id`: `COM SCI 31` (split on ` - `, strip trailing dashes)
   - `subject_area`: `COM SCI` (regex to separate dept from course number, handling cross-listed prefixes like `C`, `M`, `CM`)
   - `title`: `Introduction to Computer Science I`

### 4.3 Cross-Listed Course Handling

UCLA uses prefixes for cross-listed courses:
- `M` = cross-listed (e.g., `COM SCI M51A`)
- `C` = cross-listed (e.g., `BIOENGR C101`)
- `CM` = cross-listed (e.g., `EC ENGR CM16`)

The subject area extractor uses regex `^([A-Z][A-Z &]+?)(?:\s+(?:CM?\d|M?\d))` to correctly separate `BIOENGR` from `C101`.

### 4.4 Checkpoint System

Progress is saved to `.scrape_checkpoint.json` every 10 majors. The `--resume` flag allows interrupted scrapes to continue from the last checkpoint, avoiding redundant network requests.

### 4.5 Scraping Results

| Metric | Count |
|--------|-------|
| Total major URLs attempted | 141 |
| Majors with course data | 137 |
| Majors with no data (wrong slug) | 4 |
| Total course references extracted | 9,625 |
| Unique subject areas found | ~100 |

**Output:** `ucla_major_requirements.json`

---

## 5. Course Matching

**Script:** `analyze_hardest_major.py`

Matching scraped course requirements to grade data uses two strategies:

### Strategy 1: Exact Course ID Match

The course ID from the catalog (e.g., `COM SCI 31`) is normalized (uppercased, whitespace-collapsed) and looked up directly in the grade data index.

**Result:** 6,031 exact matches across all majors.

### Strategy 2: Department-Level Fallback

For each major, ALL courses in its associated subject areas are also collected. This captures:
- Elective courses listed on the major page
- Alternate/cross-listed course variants
- Other courses within the same departments

**Result:** 52,499 additional course records via department-level matching.

### Matching Summary

| Category | Count |
|----------|-------|
| Exact matches | 6,031 |
| Department-level fills | 52,499 |
| Unmatched (not in grade data) | 3,594 |

**Unmatched courses** are typically due to:
- Cross-listed naming differences between catalog and grade data
- Courses not offered during 2021–2025
- Graduate-level courses referenced in undergrad requirements

---

## 6. Difficulty Scoring

### 6.1 Three Difficulty Dimensions

Each major is scored across three orthogonal, data-driven dimensions:

#### Dimension 1: Blended GPA (primary ranking signal)

**Signal 1 — Exact-Match GPA (weight: 60%):** The enrollment-weighted average GPA across courses that are both (a) required by the major per the catalog and (b) found in the grade dataset.

```
GPA_exact(m) = Σ(AvgGPA(c) × n_c) / Σ(n_c)    for c ∈ exact matches
```

**Signal 2 — Department GPA (weight: 40%):** The enrollment-weighted average GPA across ALL courses in the subject areas linked to the major. (See [Section 7.3](#73-department-subject-area-gpa-and--a) for the full formula and how department-level metrics are computed.)

```
GPA_dept(m) = Σ(AvgGPA(c) × n_c) / Σ(n_c)      for c ∈ department courses
```

**Blended score:**
```
DifficultyScore(m) = 0.6 × GPA_exact + 0.4 × GPA_dept
```

#### Dimension 2: DFW Rate (ability-independent signal)

The **DFW rate** (percentage of students earning D, F, DR, NC, or NP) captures a fundamentally different aspect of difficulty from GPA:

- A course where everyone gets B+ has a mediocre GPA but 0% DFW — it's hard to get an A but nobody fails
- A course where half get A's and half fail has a decent average GPA but extremely high DFW — it's genuinely brutal

DFW rates for each major are computed as the enrollment-weighted average across all matched courses. This is the **single best ability-independent difficulty metric** because:
- If 20% of students fail a course, that course is objectively hard regardless of who's in the seat
- Unlike GPA, DFW rate isn't affected by whether the grading scale is "shifted" up or down
- Per Rojstaczer's research, grading *standards* (not student quality) drive GPA — DFW rate confirms this from a different angle

#### Dimension 3: Shared vs. Major-Specific Course Decomposition

Many courses are **shared gateway courses** required by numerous majors. For example:

| Course | Shared by N majors |
|--------|-------------------|
| MATH 31A | 51 majors |
| MATH 31B | 50 majors |
| PHYSICS 1A | 44 majors |
| MATH 32A | 43 majors |
| CHEM 20A | 41 majors |

A course required by 3+ majors is classified as a **gateway course** (698 total). We decompose each major's exact-match GPA into:

```
Gateway GPA:  GPA across shared courses (same for all majors)
Specific GPA: GPA across courses unique to this major
```

This decomposition serves as a **natural experiment**: if Major A and Major B both require MATH 31A, that course's difficulty is a constant. The difference in their scores must come from the *other* courses — which reveals department-specific grading difficulty independent of shared prerequisites.

### 6.2 Why 60/40 Blending?

- **60% exact matches**: These are the actual courses students must take — the most direct signal of difficulty.
- **40% department average**: Compensates for unmatched courses, captures the broader grading culture of a department, and accounts for elective courses students may take.

### 6.3 Why Enrollment Weighting?

Without enrollment weighting, a 5-student seminar with a 2.0 GPA would carry as much influence as a 500-student gateway course. Weighting by enrollment ensures that courses affecting the most students contribute proportionally — gateway courses like ECON 1 or MATH 31A dominate the signal for their respective majors, which reflects the typical student experience.

### 6.4 On Student Ability and the Confounding Problem

**Can't we just control for student ability?** We investigated this thoroughly. The options and their problems:

| Proxy | Problem |
|-------|--------|
| **Admission rates** | Noisy — CS gets flooded with unqualified applicants, lowering the admit rate without proportionally raising student quality. Many L&S majors admit to the *college* not the *major*. |
| **SAT/ACT scores** | UCLA only publishes by school/division, not per-major. UC system dropped SAT/ACT requirements. Even when available, explains <14% of GPA variance (Rojstaczer). |
| **Student-level transcripts** | The gold standard (Additive Grade Models could jointly estimate student ability and course difficulty), but UCLA doesn't publish individual transcript data. |
| **Cross-course comparison** | Comparing how different majors' students perform in the same shared course — promising but our data doesn't tag which major each student belongs to. |

**Our approach instead:**
1. Use GPA as the primary metric, validated by Rojstaczer's finding that grading standards dominate
2. Add DFW rate as an ability-independent check (courses where students literally fail)
3. Add shared-course decomposition to separate universal difficulty from department-specific grading
4. Be transparent that this measures *observed* difficulty, not ability-adjusted difficulty

---

## 7. Graph Construction

### 7.1 Bipartite Graph

A bipartite graph G = (M ∪ S, E) is constructed:
- **M** = 137 major nodes
- **S** = ~100 subject area (department) nodes
- **E** = 916 edges
- An edge (m, s) exists if major m requires courses from subject area s

### 7.2 Visualization

The graph is rendered as an interactive HTML canvas with a force-directed layout:
- **Major nodes**: Purple spectrum (bright magenta = harder, muted lavender = easier)
- **Subject nodes**: Cyan
- **Edges**: Tinted with the source major's purple hue
- **Interactions**: Drag nodes, zoom/pan, hover for tooltips

The force simulation uses:
- Repulsive force between all nodes (prevents overlap)
- Spring force along edges (pulls connected nodes toward ~250px distance)
- Velocity damping (0.85) for smooth settling

### 7.3 Department (Subject Area) GPA and % A

Each subject area (department) is assigned an **enrollment-weighted average GPA** and **% A-range** across all courses in that department with grade data. This same computation is used for:

- **Bipartite graph subject nodes** — the color and tooltip for each department node
- **Department Rankings tab** — the standalone ranking of departments by GPA
- **Blended major scoring** (Section 6.1) — the 40% department component when exact course matches are unavailable

**Formula:**

For each subject area *s*, let *C_s* be the set of all courses in the grade dataset where `subject_area = s`. Then:

```
GPA_dept(s) = Σ(AvgGPA(c) × n_c) / Σ(n_c)    for c ∈ C_s
PctA_dept(s) = Σ(PctA(c) × n_c) / Σ(n_c)     for c ∈ C_s
```

where *n_c* = `total_letter_grades` for course *c* (the number of letter-grade observations).

**Interpretation:** Courses with more students contribute more to the department average. A 500-student gateway course like ECON 1 has proportionally more influence than a 20-student seminar. Departments with zero courses in the grade dataset (e.g., some scraped but never-graded subject areas) are excluded from the Department Rankings and appear gray in the graph.

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

- **Economics BA** is the hardest UCLA major — the lowest GPA (3.168) AND the highest DFW rate (4.0%) among top majors, confirming difficulty from two independent signals.
- **DFW rates correlate with GPA rankings**: hard-GPA majors consistently have 3.5–5.0% DFW rates, while easy majors have 0.3–1.1%. This cross-validation strengthens confidence that GPA differences reflect genuine difficulty, not just grading culture.
- **Linguistics & Computer Science BA** (#4) has the highest DFW of any major (4.9%) — even higher than pure CS (#16), suggesting the combination of computational and theoretical linguistics courses creates unique difficulty.
- **Math/Econ BS** is harder than pure Math BS (3.241 vs 3.355), because it combines the hardest courses from both departments.
- The GPA spread is **0.75 points** (3.168 to 3.914), with DFW spread of **~4 percentage points** (0.3% to 4.9%).

---

## 9. Assumptions & Limitations

### 9.1 Selection Bias
Grade distributions reflect a self-selected population. Students who struggle often drop courses — the remaining grades may overstate how easy a course is. P/NP elections also remove observations. The DFW rate partially compensates for this by capturing dropped/failed students.

### 9.2 Student Ability and Peer Competition (Addressed In Depth)

**The core question:** Student ability varies between majors. UCLA CS has a ~4% acceptance rate vs. ~16% for Economics. Don't stronger students in selective majors face stiffer peer competition, making our GPA metric undercount difficulty?

**Yes — but the bias is conservative (it makes our ranking *under*estimate the difficulty gap).**

#### 9.2.1 Ability Differences Exist but Are a Minority Factor

Per Rojstaczer & Healy's research across 160+ universities, SAT/ACT scores explain **less than 14% of GPA variance** across departments. Grading standards are the dominant driver. The DFW rate provides ability-independent confirmation: if 4% of students fail/withdraw from Econ courses vs. 0.3% from Art courses, that's genuine difficulty regardless of cohort quality.

#### 9.2.2 Curved Grading Creates a Hidden Difficulty Layer

Many UCLA courses grade on a curve (e.g., top 20% get A's). This creates an important subtlety:

- In a curved STEM class full of strong students, the GPA is pinned by the curve — but the *experienced difficulty* is higher because each student competes against stronger peers for limited A slots
- In a curved humanities class with average students, the same curve yields the same GPA distribution, but competition is less fierce

Our GPA metric **cannot detect this hidden peer-competition effect**. However, the massive differences we observe (45% A-range in STEM vs. 90%+ in humanities) cannot be explained by uniform curving — departments clearly set fundamentally different grading standards.

#### 9.2.3 The Bias Direction: Why Our Ranking Is Conservative

Two biases compound to make our ranking a **lower bound** on the true difficulty gap:

1. **Ability sorting** → Stronger students cluster in harder majors → Should pull their GPAs *up* → Makes hard majors look *easier* than they are
2. **Competitive curving** → Those strong students compete against each other → Curve suppresses what would otherwise be higher GPAs → *Also* makes hard majors look easier

Both effects push in the same direction: we **undercount** STEM/quantitative difficulty relative to humanities. If we could control for student ability, the gap between Economics (3.17) and Dance (3.91) would likely get *wider*, not narrower.

#### 9.2.4 What the Published Research Shows

The gold standard is **jointly estimating student ability and course difficulty** from individual transcript data. Several studies have done this:

| Study | Institution | Key Finding |
|-------|------------|-------------|
| **Valen Johnson** — *Grade Inflation: A Crisis in College Education* (2003) | Duke University | Departments attracting more capable students graded *more stringently*. Ability bias and grading strictness reinforce each other — controlling for ability makes the STEM-humanities gap **wider**. |
| **Young (1993)** — IRT-adjusted GPAs | Carnegie Mellon | IRT-adjusted GPAs correlated more strongly with SAT scores and HS GPA than raw GPAs, confirming the adjustment captures real signal. |
| **Baucks, Schmucker & Wiskott** — "The Course Difficulty Analysis Cookbook" (arXiv, 2025) | Ruhr-Universität Bochum | Comprehensive tutorial comparing Additive Grade Models, IRT, and centering methods. Finds broad departmental difficulty patterns (STEM > humanities) persist after ability adjustment. |

**No public dataset exists** with ability-adjusted major rankings for any university. The barriers:

- **FERPA**: Student-level transcript data is federally protected
- **Institutional reluctance**: Universities don't want departments publicly ranked this way
- **No standard format**: Each study uses different methods on different institutional data

#### 9.2.5 Net Assessment

Our ranking measures **observed grading difficulty** — the grades a student will actually receive in each major. This is arguably the most relevant metric for a student choosing a major. The published research consistently shows that controlling for student ability would make hard majors look *harder* and easy majors look *easier*, meaning our ranking order is correct and the magnitude is a conservative lower bound.

### 9.3 Temporal Aggregation
Grades from 2021–2025 are aggregated together. This smooths out yearly variation but may mask trends (e.g., post-COVID grade inflation returning to pre-COVID norms).

### 9.4 Equal Course Weighting
All courses are weighted by enrollment, not by unit count. A 1-unit lab and a 5-unit lecture are treated the same per student. Unit-weighted scoring would better reflect time investment. Unit counts are available on individual catalog course pages and could be scraped in a future iteration.

### 9.5 Elective Pools
Many majors list large pools of elective courses. Since we include all courses linked from the catalog page, majors with broad elective options may appear easier/harder depending on which electives happen to be listed.

### 9.6 Incomplete Scraping
4 of 141 majors returned no data (wrong URL slugs or no listed requirements). Additionally, ~37% of scraped course references (3,594 / 9,625) had no exact match in the grade data — though the department-level fallback compensates.

### 9.7 Cross-Listed Course Ambiguity
Cross-listed courses (e.g., `COM SCI M51A` = `EC ENGR M16`) may be counted under one department's grade data but listed under another in the catalog. The normalizer handles most cases but some mismatches persist.

### 9.8 No Time-Per-Unit Measure
The analysis does not account for hours spent studying or total workload. Engineering majors typically require more total units and more laboratory hours than humanities majors. Without survey data (like NSSE or CIRP), time investment cannot be quantified from grade data alone.

---

## 10. Possible Extensions

1. **Unit-weighted scoring** — Weight each course by unit count (scrapable from catalog) instead of treating all courses equally.

2. **Required vs. elective separation** — Parse the catalog page structure to distinguish "Preparation for the Major" and "Required Upper Division" from "Elective" pools. Weight required courses more heavily.

3. **Grade inflation trend analysis** — Compare GPA distributions year-over-year to quantify temporal grade inflation per department.

4. **Network centrality analysis** — Use betweenness centrality on the bipartite graph to identify which departments are most "load-bearing" across many majors.

5. **Controlled regression** — Regress course GPA on instructor, time-of-day, class size, and year to isolate intrinsic course difficulty from confounders.

6. **Cross-listed course resolution** — Build a lookup table mapping all cross-listed variants to a canonical course ID.

7. **Student pathway analysis** — If student-level data were available, track difficulty experienced per major by following individual students' grade trajectories.

8. **Confidence intervals** — Report bootstrap confidence intervals on difficulty scores, especially for majors with few matched courses.

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
  │   (auto-detect       │     │(Playwright headless  │
  │    CSV schema)       │     │ browser, checkpoints)│
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
              │ (match, score, viz)  │
              └──────────┬───────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
  major_difficulty  graph_data    ucla_hardest_
  _rankings.csv     .json         major.html
```

---

## Technical Stack

| Component | Technology |
|-----------|-----------|
| Web scraping | Python + Playwright (headless Chromium) |
| Data processing | pandas, numpy |
| Visualization | Vanilla HTML/CSS/JS with canvas-based force layout |
| Output formats | CSV, JSON, HTML |
| Orchestration | `run_pipeline.py` with subprocess chaining |
