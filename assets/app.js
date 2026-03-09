/* ============================================================
   UCLA Major Difficulty Analysis — Application Logic
   ============================================================ */

// DATA is injected by the Python script as a global variable
// in a <script> tag before this file is loaded.

// ─── Ability Adjustment ─────────────────────────────────────

let abilityAdjusted = false;
const ADJ = DATA.ability_adjustment || null;

// Build dept label → ability_proxy lookup from subject nodes
const deptAbilityProxy = {};
DATA.nodes.forEach(n => {
    if (n.type === 'subject' && n.ability_proxy != null) {
        deptAbilityProxy[n.label] = n.ability_proxy;
    }
});

if (ADJ) {
    document.getElementById('ability-toggle-bar').style.display = 'flex';
}

function adjustGpa(rawGpa, abilityProxy) {
    if (!abilityAdjusted || !ADJ || abilityProxy == null) return rawGpa;
    return rawGpa - ADJ.k * (abilityProxy - ADJ.mean_ability);
}

function toggleAbilityAdjustment(on) {
    abilityAdjusted = on;
    const bar = document.getElementById('ability-toggle-bar');
    bar.classList.toggle('active', on);
    renderRankings();
    renderDeptRankings();
    renderProfessorRankings();
    renderCourseTable();
    if (graphInitialized) drawGraph();
}

// ─── Tab switching ───────────────────────────────────────────

function switchTab(name) {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('panel-' + name).classList.add('active');
    event.target.classList.add('active');
    if (name === 'graph') setTimeout(drawGraph, 100);
}

// ─── GPA color scale (blue-to-gold) ─────────────────────────
// Lower GPA → UCLA Dark Blue (hard), Higher GPA → UCLA Gold (easy)

function gpaColor(gpa) {
    const t = Math.max(0, Math.min(1, (gpa - 2.0) / 2.0));
    // HSL interpolation: Red (0°) → Green (120°), keeping saturation high
    const h = t * 120;
    const s = 75 + 10 * Math.sin(t * Math.PI); // boost saturation in the middle
    const l = 42 + 5 * Math.sin(t * Math.PI);  // slightly brighter in the middle
    return `hsl(${h}, ${s}%, ${l}%)`;
}

// ─── Graph node color: reuse the same red→green HSL scale ───

function majorNodeColor(gpa) {
    // Same red→green scale for majors and departments (harder = red, easier = green)
    if (gpa == null || Number.isNaN(gpa)) gpa = 3.2;
    const t = Math.max(0, Math.min(1, (gpa - 2.8) / 1.2));
    const h = t * 120;
    const s = 70 + 15 * Math.sin(t * Math.PI);
    const l = 40 + 8 * Math.sin(t * Math.PI);
    return `hsl(${h}, ${s}%, ${l}%)`;
}

// ─── Populate hero stats ─────────────────────────────────────

document.getElementById('stat-majors').textContent = DATA.rankings.length;
document.getElementById('stat-courses').textContent = DATA.nodes
    .filter(n => n.type === 'subject')
    .reduce((s, n) => s + (n.num_courses || 0), 0)
    .toLocaleString();
document.getElementById('stat-grades').textContent = DATA.total_student_grades.toLocaleString();

// ─── Rankings (with filter modes) ────────────────────────────

let currentFilter = 'all';
let majorSort = { key: 'gpa', dir: 'asc' };

function setFilter(mode) {
    currentFilter = mode;
    document.querySelectorAll('.filter-bar button').forEach(b => b.classList.remove('active-filter'));
    document.getElementById('filter-' + mode.replace('_', '-')).classList.add('active-filter');
    renderRankings();
}

function setMajorSort(key) {
    if (majorSort.key === key) {
        majorSort.dir = majorSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        majorSort.key = key;
        majorSort.dir = (key === 'major') ? 'asc' : 'asc';
    }
    updateSortIndicators();
    renderRankings();
}

function renderRankings() {
    const items = DATA.rankings.map(r => {
        let gpa, pctA, students, courses;
        if (currentFilter === 'ud_all') {
            gpa = r.ud_all_gpa; pctA = r.ud_all_pctA;
            students = r.ud_all_students; courses = r.num_upper_exact;
        } else if (currentFilter === 'ud_req') {
            gpa = r.ud_req_gpa; pctA = r.ud_req_pctA;
            students = r.ud_req_students; courses = r.num_upper_req;
        } else {
            gpa = r.avg_gpa; pctA = r.pct_A;
            students = r.total_students; courses = r.num_courses;
        }
        if (gpa != null) gpa = adjustGpa(gpa, r.ability_proxy);
        return { ...r, _gpa: gpa, _pctA: pctA, _students: students, _courses: courses };
    }).filter(r => r._gpa != null);

    const dirMul = majorSort.dir === 'asc' ? 1 : -1;
    items.sort((a, b) => {
        if (majorSort.key === 'major') return dirMul * String(a.major).localeCompare(String(b.major));
        if (majorSort.key === 'pctA') return dirMul * ((a._pctA ?? 0) - (b._pctA ?? 0));
        if (majorSort.key === 'courses') return dirMul * ((a._courses ?? 0) - (b._courses ?? 0));
        if (majorSort.key === 'students') return dirMul * ((a._students ?? 0) - (b._students ?? 0));
        return dirMul * ((a._gpa ?? 0) - (b._gpa ?? 0));
    });

    const tbody = document.getElementById('rankings-body');
    let html = '';
    items.forEach((r, idx) => {
        const rank = idx + 1;
        const badgeClass = 'rank-default';
        const gpaPct = ((r._gpa / 4.0) * 100).toFixed(0);
        const color = gpaColor(r._gpa);
        const majorHtml = r.catalog_url
            ? `<a class="major-link major-name" href="${r.catalog_url}" target="_blank">${r.major}</a>`
            : `<span class="major-name">${r.major}</span>`;
        html += `
        <tr>
            <td><div class="rank-badge ${badgeClass}">${rank}</div></td>
            <td>${majorHtml}</td>
            <td><div class="gpa-bar-container"><div class="gpa-bar"><div class="gpa-bar-fill" style="width:${gpaPct}%; background:${color}"></div></div><div class="gpa-value" style="color:${color}">${r._gpa.toFixed(3)}</div></div></td>
            <td class="pct-a" style="color:${color}">${r._pctA.toFixed(1)}%</td>
            <td class="stat-small">${r._courses}</td>
            <td class="stat-small">${r._students.toLocaleString()}</td>
        </tr>`;
    });
    tbody.innerHTML = html;
}

renderRankings();

// ─── Department Rankings (with course filter: all / upper / lower div) ───

let currentDeptFilter = 'all';
let deptSort = { key: 'gpa', dir: 'asc' };

function setDeptFilter(mode) {
    currentDeptFilter = mode;
    document.querySelectorAll('#panel-dept-rankings .filter-bar button').forEach(b => b.classList.remove('active-filter'));
    const id = mode === 'ud' ? 'dept-filter-ud' : mode === 'ld' ? 'dept-filter-ld' : 'dept-filter-all';
    const btn = document.getElementById(id);
    if (btn) btn.classList.add('active-filter');
    renderDeptRankings();
}

function setDeptSort(key) {
    if (deptSort.key === key) {
        deptSort.dir = deptSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        deptSort.key = key;
        deptSort.dir = (key === 'dept') ? 'asc' : 'asc';
    }
    updateSortIndicators();
    renderDeptRankings();
}

function renderDeptRankings() {
    const rawDepts = DATA.nodes.filter(n => n.type === 'subject' && (n.num_courses || 0) > 0);

    const depts = rawDepts.map(n => {
        let gpa, pctA, numCourses, totalStudents;
        if (currentDeptFilter === 'ud') {
            if (n.ud_gpa == null) return null;
            gpa = n.ud_gpa; pctA = n.ud_pctA; numCourses = n.ud_num_courses || 0; totalStudents = n.ud_total_students || 0;
        } else if (currentDeptFilter === 'ld') {
            if (n.ld_gpa == null) return null;
            gpa = n.ld_gpa; pctA = n.ld_pctA; numCourses = n.ld_num_courses || 0; totalStudents = n.ld_total_students || 0;
        } else {
            gpa = n.avg_gpa; pctA = n.pct_A; numCourses = n.num_courses || 0; totalStudents = n.total_students || 0;
        }
        const adjGpa = adjustGpa(gpa, n.ability_proxy);
        return {
            label: n.label,
            avg_gpa: adjGpa,
            pct_A: pctA,
            num_courses: numCourses,
            total_students: totalStudents,
        };
    }).filter(Boolean);

    const dirMul = deptSort.dir === 'asc' ? 1 : -1;
    depts.sort((a, b) => {
        if (deptSort.key === 'dept') return dirMul * String(a.label).localeCompare(String(b.label));
        if (deptSort.key === 'pctA') return dirMul * ((a.pct_A ?? 0) - (b.pct_A ?? 0));
        if (deptSort.key === 'courses') return dirMul * ((a.num_courses ?? 0) - (b.num_courses ?? 0));
        if (deptSort.key === 'students') return dirMul * ((a.total_students ?? 0) - (b.total_students ?? 0));
        return dirMul * ((a.avg_gpa ?? 0) - (b.avg_gpa ?? 0));
    });

    const tbody = document.getElementById('dept-rankings-body');
    if (!tbody) return;
    let html = '';
    depts.forEach((d, idx) => {
        const rank = idx + 1;
        const badgeClass = 'rank-default';
        const gpaPct = ((d.avg_gpa / 4.0) * 100).toFixed(0);
        const color = gpaColor(d.avg_gpa);
        const catalogSlug = d.label.replace(/\s+/g, '').replace(/&/g, '');
        const deptUrl = `https://catalog.registrar.ucla.edu/browse/Subject%20Areas/${catalogSlug}?siteYear=2024`;
        html += `
        <tr>
            <td><div class="rank-badge ${badgeClass}">${rank}</div></td>
            <td class="major-name"><a href="${deptUrl}" target="_blank" rel="noopener noreferrer" class="major-link">${d.label}</a></td>
            <td><div class="gpa-bar-container"><div class="gpa-bar"><div class="gpa-bar-fill" style="width:${gpaPct}%; background:${color}"></div></div><div class="gpa-value" style="color:${color}">${d.avg_gpa.toFixed(3)}</div></div></td>
            <td class="pct-a" style="color:${color}">${d.pct_A.toFixed(1)}%</td>
            <td class="stat-small">${d.num_courses}</td>
            <td class="stat-small">${d.total_students.toLocaleString()}</td>
        </tr>`;
    });
    tbody.innerHTML = html;
}

renderDeptRankings();

// ─── Professors (within department, 5+ courses) ───────

function bruinwalkSlug(name) {
    // Convert "LASTNAME, FIRSTNAME [MIDDLE]" to bruinwalk.com/professors/firstname-lastname/
    // Bruinwalk typically uses first name only (no middle), e.g. john-smith not john-robert-smith
    const parts = String(name || '').split(',').map(s => s.trim());
    if (parts.length >= 2) {
        const firstFull = parts[1], last = parts[0];
        const firstOnly = firstFull.split(/\s+/)[0] || firstFull;  // drop middle name(s)
        return (firstOnly + '-' + last).toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
    }
    return (name || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function renderProfessorRankings() {
    const tbody = document.getElementById('prof-rankings-body');
    if (!tbody) return;
    const profData = DATA.professor_rankings || {};
    const depts = Object.keys(profData).sort();
    const rows = [];
    depts.forEach(dept => {
        (profData[dept] || []).forEach(p => {
            rows.push({ ...p, dept });
        });
    });
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="color:var(--text-muted);padding:24px;text-align:center">No professor data available. Raw grade files must include instructor information (e.g. INSTR NAME).</td></tr>';
        return;
    }
    // Sort within department (never mixes departments)
    if (!window.profSort) {
        window.profSort = { key: 'gpa', dir: 'asc', rangeMode: 'min' }; // rangeMode: 'min' | 'max'
    }
    rows.forEach(p => {
        const proxy = deptAbilityProxy[p.dept];
        p._gpa = adjustGpa(p.avg_gpa, proxy);
        p._range_min = (p.prof_min_gpa ?? p.avg_gpa);
        p._range_max = (p.prof_max_gpa ?? p.avg_gpa);
    });
    const byDept = {};
    rows.forEach(p => {
        if (!byDept[p.dept]) byDept[p.dept] = [];
        byDept[p.dept].push(p);
    });
    rows.length = 0;
    Object.keys(byDept).sort().forEach(dept => {
        const deptRows = byDept[dept];
        const dirMul = window.profSort.dir === 'asc' ? 1 : -1;
        deptRows.sort((a, b) => {
            const key = window.profSort.key;
            if (key === 'name') return dirMul * String(a.name).localeCompare(String(b.name));
            if (key === 'pctA') return dirMul * ((a.pct_A ?? 0) - (b.pct_A ?? 0));
            if (key === 'classes') return dirMul * (((a.num_classes ?? a.num_courses) ?? 0) - (((b.num_classes ?? b.num_courses) ?? 0)));
            if (key === 'students') return dirMul * ((a.total_students ?? 0) - (b.total_students ?? 0));
            if (key === 'range') {
                const av = window.profSort.rangeMode === 'max' ? a._range_max : a._range_min;
                const bv = window.profSort.rangeMode === 'max' ? b._range_max : b._range_min;
                return dirMul * ((av ?? 0) - (bv ?? 0));
            }
            // gpa
            return dirMul * ((a._gpa ?? 0) - (b._gpa ?? 0));
        });
        deptRows.forEach((p, i) => { p._rank = i + 1; });
        rows.push(...deptRows);
    });

    let html = '';
    let lastDept = '';
    let deptGroup = 0;
    rows.forEach(p => {
        if (p.dept !== lastDept) {
            lastDept = p.dept;
            deptGroup++;
        }
        const deptRowClass = deptGroup % 2 === 1 ? 'prof-dept-odd' : 'prof-dept-even';
        const badgeClass = 'rank-default';
        const displayGpa = p._gpa;
        const gpaPct = ((displayGpa / 4.0) * 100).toFixed(0);
        const color = gpaColor(displayGpa);
        const rangeStr = `${(p.prof_min_gpa ?? p.avg_gpa).toFixed(2)}–${(p.prof_max_gpa ?? p.avg_gpa).toFixed(2)}`;
        const slug = p.bruinwalk_slug || bruinwalkSlug(p.name);
        const profCell = slug
            ? `<a href="https://bruinwalk.com/professors/${slug}/" target="_blank" rel="noopener noreferrer" class="major-link">${p.name}</a>`
            : p.name;
        const rank = (p._rank || p.rank);
        html += `
        <tr class="${deptRowClass}">
            <td><div class="rank-badge ${badgeClass}">${rank}</div></td>
            <td class="stat-small">${p.dept}</td>
            <td class="major-name">${profCell}</td>
            <td><div class="gpa-bar-container"><div class="gpa-bar"><div class="gpa-bar-fill" style="width:${gpaPct}%; background:${color}"></div></div><div class="gpa-value" style="color:${color}">${displayGpa.toFixed(3)}</div></div></td>
            <td class="pct-a" style="color:${color}">${p.pct_A.toFixed(1)}%</td>
            <td class="stat-small" style="color:var(--text-muted);font-size:0.8rem">${rangeStr}</td>
            <td class="stat-small">${p.num_classes ?? p.num_courses}</td>
            <td class="stat-small">${p.total_students.toLocaleString()}</td>
        </tr>`;
    });
    tbody.innerHTML = html;
}

renderProfessorRankings();

// ─── Course Deep Dive ────────────────────────────────────────

const allCourses = DATA.all_courses_sorted;
let courseSort = { key: 'gpa', dir: 'asc' };

function setCourseSort(key) {
    if (courseSort.key === key) {
        courseSort.dir = courseSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        courseSort.key = key;
        courseSort.dir = (key === 'course' || key === 'title' || key === 'dept') ? 'asc' : 'asc';
    }
    updateSortIndicators();
    renderCourseTable();
}

function renderCourseTable() {
    const sel = document.getElementById('course-count').value;
    const limit = sel === 'all' ? allCourses.length : parseInt(sel);

    // Build adjusted copies so we can re-sort by adjusted GPA
    const adjusted = allCourses.map(c => {
        const proxy = deptAbilityProxy[c.subject_area];
        const gpa = adjustGpa(c.avg_gpa, proxy);
        return { ...c, _gpa: gpa };
    });
    const dirMul = courseSort.dir === 'asc' ? 1 : -1;
    adjusted.sort((a, b) => {
        if (courseSort.key === 'course') return dirMul * String(a.course_id).localeCompare(String(b.course_id));
        if (courseSort.key === 'title') return dirMul * String(a.course_title || '').localeCompare(String(b.course_title || ''));
        if (courseSort.key === 'pctA') return dirMul * ((a.pct_A ?? 0) - (b.pct_A ?? 0));
        if (courseSort.key === 'students') return dirMul * (((a.total_letter_grades || 0)) - ((b.total_letter_grades || 0)));
        if (courseSort.key === 'dept') return dirMul * String(a.subject_area || '').localeCompare(String(b.subject_area || ''));
        return dirMul * ((a._gpa ?? 0) - (b._gpa ?? 0));
    });

    const sliced = adjusted.slice(0, Math.min(limit, adjusted.length));
    const tbody = document.getElementById('courses-tbody');
    let html = '';
    sliced.forEach((c, i) => {
        const color = gpaColor(c._gpa);
        const hasGradeData = (c.total_letter_grades || 0) > 0;
        const href = hasGradeData && c.uclagrades_url ? c.uclagrades_url : (c.catalog_url || '');
        const cellContent = href
            ? `<a href="${href}" target="_blank" rel="noopener noreferrer" class="course-link">${c.course_id}</a>`
            : c.course_id;
        html += `<tr>
            <td style="color:var(--text-muted);font-weight:700;font-size:0.78rem">${i + 1}</td>
            <td class="course-code-cell">${cellContent}</td>
            <td style="color:var(--text-secondary);max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.course_title || ''}</td>
            <td class="gpa-cell" style="color:${color}">${c._gpa.toFixed(3)}</td>
            <td class="pct-cell" style="color:${color}">${c.pct_A.toFixed(1)}%</td>
            <td class="students-cell">${(c.total_letter_grades || 0).toLocaleString()}</td>
            <td class="dept-cell">${c.subject_area || ''}</td>
        </tr>`;
    });
    tbody.innerHTML = html;
    document.getElementById('course-count-info').textContent =
        `Showing ${sliced.length} of ${allCourses.length} courses`;
}

renderCourseTable();

// ─── Sortable header wiring ──────────────────────────────────

function initSortableHeaders() {
    // Inject icons into headers
    document.querySelectorAll('th.sortable').forEach(th => {
        if (th.querySelector('.sort-icons')) return;
        const wrap = document.createElement('span');
        wrap.className = 'sort-icons';
        const up = document.createElement('span');
        up.className = 'sort-up';
        up.textContent = '▲';
        const down = document.createElement('span');
        down.className = 'sort-down';
        down.textContent = '▼';
        wrap.appendChild(up);
        wrap.appendChild(down);
        th.appendChild(wrap);
    });

    // Majors
    document.querySelectorAll('#panel-rankings th.sortable').forEach(th => {
        th.addEventListener('click', () => setMajorSort(th.dataset.sort));
    });
    // Departments
    document.querySelectorAll('#panel-dept-rankings th.sortable').forEach(th => {
        th.addEventListener('click', () => setDeptSort(th.dataset.sort));
    });
    // Professors
    document.querySelectorAll('#panel-prof-rankings th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            if (!window.profSort) window.profSort = { key: 'gpa', dir: 'asc', rangeMode: 'min' };
            const key = th.dataset.sort;
            if (key === 'range') {
                window.profSort.key = 'range';
                window.profSort.dir = 'asc';
                window.profSort.rangeMode = window.profSort.rangeMode === 'min' ? 'max' : 'min';
            } else if (window.profSort.key === key) {
                window.profSort.dir = window.profSort.dir === 'asc' ? 'desc' : 'asc';
            } else {
                window.profSort.key = key;
                window.profSort.dir = (key === 'name') ? 'asc' : 'asc';
            }
            updateSortIndicators();
            renderProfessorRankings();
        });
    });
    // Courses
    document.querySelectorAll('#panel-courses th.sortable').forEach(th => {
        th.addEventListener('click', () => setCourseSort(th.dataset.sort));
    });
}

initSortableHeaders();

function updateSortIndicators() {
    // Clear all
    document.querySelectorAll('th.sortable').forEach(th => {
        th.classList.remove('th-sort-active', 'th-sort-asc', 'th-sort-desc');
    });

    // Helper: mark one header active with dir
    const mark = (panelSel, key, dir) => {
        const th = document.querySelector(`${panelSel} th.sortable[data-sort="${key}"]`);
        if (!th) return;
        th.classList.add('th-sort-active');
        th.classList.add(dir === 'desc' ? 'th-sort-desc' : 'th-sort-asc');
    };

    mark('#panel-rankings', majorSort.key, majorSort.dir);
    mark('#panel-dept-rankings', deptSort.key, deptSort.dir);

    if (window.profSort) {
        // range toggles min/max; treat it as asc/desc for indicator:
        // - rangeMode=min => lowest-min at top (asc)
        // - rangeMode=max => highest-max at top (desc)
        if (window.profSort.key === 'range') {
            mark('#panel-prof-rankings', 'range', window.profSort.rangeMode === 'max' ? 'desc' : 'asc');
        } else {
            mark('#panel-prof-rankings', window.profSort.key, window.profSort.dir);
        }
    } else {
        mark('#panel-prof-rankings', 'gpa', 'asc');
    }

    mark('#panel-courses', courseSort.key, courseSort.dir);
}

updateSortIndicators();

// ─── Bipartite Graph ─────────────────────────────────────────

let graphNodes = [], graphEdges = [], graphScale = 1, graphOffsetX = 0, graphOffsetY = 0;
let isDragging = false, dragNode = null, lastMouse = { x: 0, y: 0 };
let graphInitialized = false;
let graphLastDims = null;
let hoverNode = null;
function drawGraph() {
    const canvas = document.getElementById('graph-canvas');
    const rect = canvas.parentElement.getBoundingClientRect();
    let W = rect.width, H = rect.height;

    // Retry if container has no dimensions yet (e.g. panel was hidden)
    if (W < 50 || H < 50) {
        requestAnimationFrame(drawGraph);
        return;
    }

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const majors = DATA.nodes.filter(n => n.type === 'major').sort((a, b) => a.rank - b.rank);
    const subjects = DATA.nodes.filter(n => n.type === 'subject');

    const layoutH = H;
    const dimsKey = W + 'x' + layoutH;
    if (graphInitialized && (typeof graphLastDims !== 'undefined' && graphLastDims !== dimsKey)) {
        graphInitialized = false;
    }
    graphLastDims = dimsKey;

    const PAD_Y = 25;
    const CTRL_RIGHT = 52;
    const BOUND_L = 16;
    const BOUND_R = W - CTRL_RIGHT;
    const contentW = BOUND_R - BOUND_L;
    const MAJOR_X = BOUND_L + contentW * 0.2;
    const SUBJ_X = BOUND_L + contentW * 0.8;

    if (!graphInitialized) {
        graphNodes = [];
        const nodeMap = {};
        const spread = 30;
        const nodeRadius = 6;

        majors.forEach((n, i) => {
            const yPos = PAD_Y + (i / Math.max(1, majors.length - 1)) * (layoutH - PAD_Y * 2);
            const node = {
                ...n,
                x: MAJOR_X + (Math.random() - 0.5) * spread,
                y: yPos,
                vx: 0, vy: 0,
                radius: nodeRadius
            };
            graphNodes.push(node); nodeMap[n.id] = node;
        });

        subjects.forEach((n, i) => {
            const yPos = PAD_Y + (i / Math.max(1, subjects.length - 1)) * (layoutH - PAD_Y * 2);
            const node = {
                ...n,
                x: SUBJ_X + (Math.random() - 0.5) * spread,
                y: yPos,
                vx: 0, vy: 0,
                radius: Math.max(3, Math.min(8, (n.num_courses || 1) / 10))
            };
            graphNodes.push(node); nodeMap[n.id] = node;
        });

        graphEdges = DATA.edges.map(e => ({
            source: nodeMap[e.source],
            target: nodeMap[e.target]
        })).filter(e => e.source && e.target);

        graphInitialized = true;
    }

    const BOUND_T = PAD_Y, BOUND_B = layoutH - PAD_Y;

    function tick() {
        // Repulsion between nearby nodes
        for (let i = 0; i < graphNodes.length; i++) {
            for (let j = i + 1; j < graphNodes.length; j++) {
                const a = graphNodes[i], b = graphNodes[j];
                let dx = b.x - a.x, dy = b.y - a.y;
                const dist = Math.max(0.5, Math.sqrt(dx * dx + dy * dy));
                const minSep = a.radius + b.radius + 6;
                if (dist < minSep * 5) {
                    const force = 500 / (dist * dist);
                    const fx = dx / dist * force, fy = dy / dist * force;
                    a.vx -= fx; a.vy -= fy;
                    b.vx += fx; b.vy += fy;
                }
            }
        }

        // Spring attraction along edges (weaker to keep columns apart)
        graphEdges.forEach(e => {
            const dx = e.target.x - e.source.x, dy = e.target.y - e.source.y;
            const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            const idealLen = W * 0.35;
            const force = (dist - idealLen) * 0.0005;
            e.source.vx += dx / dist * force;
            e.source.vy += dy / dist * force;
            e.target.vx -= dx / dist * force;
            e.target.vy -= dy / dist * force;
        });

        // Horizontal anchoring to maintain bipartite structure
        graphNodes.forEach(n => {
            const anchorX = n.type === 'major' ? MAJOR_X : SUBJ_X;
            n.vx += (anchorX - n.x) * 0.02;
        });

        // Apply velocity with damping
        graphNodes.forEach(n => {
            if (n === dragNode) return;
            n.vx *= 0.8; n.vy *= 0.8;
            n.x += n.vx * 0.4;
            n.y += n.vy * 0.4;
            n.x = Math.max(BOUND_L, Math.min(BOUND_R, n.x));
            n.y = Math.max(BOUND_T, Math.min(BOUND_B, n.y));
        });
    }

    function render() {
        ctx.fillStyle = '#FAFBFC';
        ctx.fillRect(0, 0, W, H);
        ctx.save();
        ctx.translate(graphOffsetX, graphOffsetY);
        ctx.scale(graphScale, graphScale);

        // Column labels
        ctx.font = '600 11px Inter, sans-serif';
        ctx.fillStyle = '#8899AA';
        ctx.textAlign = 'center';
        ctx.fillText('MAJORS', MAJOR_X, 14);
        ctx.fillText('DEPARTMENTS', SUBJ_X, 14);

        // Draw edges - highlight connected edges on hover
        graphEdges.forEach(e => {
            const isHighlighted = hoverNode && (e.source === hoverNode || e.target === hoverNode);
            ctx.beginPath();
            const midX = (e.source.x + e.target.x) / 2;
            ctx.moveTo(e.source.x, e.source.y);
            ctx.bezierCurveTo(midX, e.source.y, midX, e.target.y, e.target.x, e.target.y);
            if (isHighlighted) {
                ctx.strokeStyle = 'rgba(39,116,174,0.45)';
                ctx.lineWidth = 1.5;
            } else {
                ctx.strokeStyle = 'rgba(39,116,174,0.06)';
                ctx.lineWidth = 0.5;
            }
            ctx.stroke();
        });

        // Draw nodes
        graphNodes.forEach(n => {
            const isHovered = n === hoverNode;
            const isConnected = hoverNode && graphEdges.some(e =>
                (e.source === hoverNode && e.target === n) ||
                (e.target === hoverNode && e.source === n)
            );

            ctx.beginPath();
            ctx.arc(n.x, n.y, isHovered ? n.radius + 2 : n.radius, 0, Math.PI * 2);

            const adjGpa = adjustGpa(n.avg_gpa, n.ability_proxy);
            const fillColor = (n.type === 'subject' && (n.num_courses || 0) === 0)
                ? '#9CA3AF'
                : majorNodeColor(adjGpa);
            ctx.fillStyle = fillColor;
            ctx.fill();

            // Outline
            if (isHovered) {
                ctx.strokeStyle = '#003B5C';
                ctx.lineWidth = 2;
            } else if (isConnected) {
                ctx.strokeStyle = 'rgba(0,59,92,0.5)';
                ctx.lineWidth = 1.5;
            } else {
                ctx.strokeStyle = 'rgba(255,255,255,0.6)';
                ctx.lineWidth = 0.8;
            }
            ctx.stroke();
        });

        // Draw labels ONLY for hovered node and its neighbors
        if (hoverNode) {
            const connectedNodes = new Set([hoverNode]);
            graphEdges.forEach(e => {
                if (e.source === hoverNode) connectedNodes.add(e.target);
                if (e.target === hoverNode) connectedNodes.add(e.source);
            });

            connectedNodes.forEach(n => {
                if (n === hoverNode) return; // tooltip already shows this
                const fontSize = 8;
                const fontWeight = '500';
                ctx.font = `${fontWeight} ${fontSize}px Inter, sans-serif`;

                const label = n.label;
                const textWidth = ctx.measureText(label).width;
                const pillPadX = 4, pillPadY = 3;
                const pillH = fontSize + pillPadY * 2;

                let textX, pillX;
                if (n.type === 'major') {
                    textX = n.x - n.radius - 8;
                    pillX = textX - textWidth - pillPadX;
                    ctx.textAlign = 'right';
                } else {
                    textX = n.x + n.radius + 8;
                    pillX = textX - pillPadX;
                    ctx.textAlign = 'left';
                }
                const pillY = n.y - fontSize / 2 - pillPadY;

                // Background pill
                ctx.fillStyle = 'rgba(255,255,255,0.88)';
                const pillRadius = 3;
                const pw = textWidth + pillPadX * 2;
                ctx.beginPath();
                ctx.roundRect(pillX, pillY, pw, pillH, pillRadius);
                ctx.fill();

                // Text
                ctx.fillStyle = '#4A5A6A';
                ctx.fillText(label, textX, n.y + fontSize * 0.35);
            });
        }

        // Instruction text when nothing is hovered
        if (!hoverNode) {
            ctx.font = '400 11px Inter, sans-serif';
            ctx.fillStyle = '#AAB5C0';
            ctx.textAlign = 'center';
            ctx.fillText('Hover over a node to see details and connections', W / 2, H - 8);
        }

        ctx.restore();
    }

    let fc = 0;
    function animate() {
        if (fc < 400) { tick(); fc++; }
        render();
        requestAnimationFrame(animate);
    }
    animate();

    // ─── Mouse interactions ──────────────────────────────────
    canvas.onmousedown = (e) => {
        const r = canvas.getBoundingClientRect();
        const mx = (e.clientX - r.left - graphOffsetX) / graphScale;
        const my = (e.clientY - r.top - graphOffsetY) / graphScale;
        dragNode = graphNodes.find(n => Math.hypot(n.x - mx, n.y - my) < n.radius + 5);
        isDragging = true;
        if (!dragNode) lastMouse = { x: e.clientX, y: e.clientY };
    };
    canvas.onmousemove = (e) => {
        const r = canvas.getBoundingClientRect();
        if (dragNode) {
            dragNode.x = (e.clientX - r.left - graphOffsetX) / graphScale;
            dragNode.y = (e.clientY - r.top - graphOffsetY) / graphScale;
        } else if (isDragging) {
            graphOffsetX += e.clientX - lastMouse.x;
            graphOffsetY += e.clientY - lastMouse.y;
            lastMouse = { x: e.clientX, y: e.clientY };
        }
        const mx = (e.clientX - r.left - graphOffsetX) / graphScale;
        const my = (e.clientY - r.top - graphOffsetY) / graphScale;
        const hover = graphNodes.find(n => Math.hypot(n.x - mx, n.y - my) < n.radius + 5);
        hoverNode = hover || null;
        const tooltip = document.getElementById('tooltip');
        if (hover) {
            const hGpa = adjustGpa(hover.avg_gpa, hover.ability_proxy);
            const adjLabel = abilityAdjusted ? ' (adj)' : '';
            let html = `<div style="font-weight:700;font-size:1rem;margin-bottom:6px;color:var(--ucla-dark-blue)">${hover.label}</div>`;
            html += hover.type === 'major'
                ? `<div style="color:${gpaColor(hGpa)}">GPA: ${hGpa.toFixed(3)}${adjLabel} | ${hover.pct_A.toFixed(1)}% A/A+</div><div style="color:var(--text-muted);margin-top:4px">#${hover.rank} | ${hover.num_courses} courses</div>`
                : `<div style="color:var(--ucla-blue)">Dept GPA: ${hGpa.toFixed(3)}${adjLabel} | ${hover.num_courses} courses</div>`;
            tooltip.innerHTML = html; tooltip.style.display = 'block';
            tooltip.style.left = (e.clientX + 16) + 'px'; tooltip.style.top = (e.clientY - 10) + 'px';
        } else { tooltip.style.display = 'none'; }
    };
    canvas.onmouseup = () => { isDragging = false; dragNode = null; };
    canvas.onmouseleave = () => { isDragging = false; dragNode = null; hoverNode = null; document.getElementById('tooltip').style.display = 'none'; };

    canvas.onwheel = (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        const factor = e.deltaY > 0 ? 0.95 : 1.05;
        const oldScale = graphScale;
        const newScale = graphScale * factor;
        const gx = (e.clientX - r.left - graphOffsetX) / oldScale;
        const gy = (e.clientY - r.top - graphOffsetY) / oldScale;
        graphOffsetX = e.clientX - r.left - gx * newScale;
        graphOffsetY = e.clientY - r.top - gy * newScale;
        graphScale = newScale;
    };
}

function zoomGraph(f) { graphScale *= f; }
function resetGraph() { graphScale = 1; graphOffsetX = 0; graphOffsetY = 0; graphInitialized = false; drawGraph(); }
