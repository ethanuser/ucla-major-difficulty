/* ============================================================
   UCLA Major Difficulty Analysis — Application Logic
   ============================================================ */

// DATA is injected by the Python script as a global variable
// in a <script> tag before this file is loaded.

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const fmt = n => (n ?? 0).toLocaleString();
const median = values => {
    const v = values.filter(x => x != null).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

// ─── Saved preferences (this browser only) ──────────────────

const STORE_KEY = 'ucla-major-difficulty';

function loadStore() {
    try {
        return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch {
        return {};
    }
}

function saveStore(patch) {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify({ ...loadStore(), ...patch }));
    } catch {
        // Private windows can block storage; the page works without it
    }
}

// ─── App state ──────────────────────────────────────────────

const MAX_COMPARE = 4;

const state = {
    view: 'majors',                 // majors | departments | professors | graph | courses | about
    search: {},                     // one query per view
    scope: { majors: 'all', departments: 'all', courses: 'all' },
    dept: { professors: 'all', courses: 'all' },
    ge: 'none',                     // 'none' | 'any' | GE category name
    adjusted: false,
    sort: {
        majors: { key: 'gpa', dir: 'asc' },
        departments: { key: 'gpa', dir: 'asc' },
        professors: { key: 'gpa', dir: 'asc' },
        courses: { key: 'gpa', dir: 'asc' },
    },
    sel: null,                      // { type: major|dept|prof|course|compare, id }
    trail: [],                      // earlier selections, for the dock's back button
    compare: (loadStore().compare || []).slice(0, MAX_COMPARE),
};

// ─── Ability Adjustment ─────────────────────────────────────

const ADJ = DATA.ability_adjustment || null;

// Build dept label → ability_proxy lookup from subject nodes
const deptAbilityProxy = {};
DATA.nodes.forEach(n => {
    if (n.type === 'subject' && n.ability_proxy != null) {
        deptAbilityProxy[n.label] = n.ability_proxy;
    }
});

function adjustGpa(rawGpa, abilityProxy) {
    if (!state.adjusted || !ADJ || abilityProxy == null) return rawGpa;
    return rawGpa - ADJ.k * (abilityProxy - ADJ.mean_ability);
}

function toggleAbilityAdjustment(on) {
    state.adjusted = on;
    commit();
    render();
    freshBars();
}

// ─── Lookups ────────────────────────────────────────────────

const subjects = DATA.nodes.filter(n => n.type === 'subject');
const deptsWithCourses = subjects.filter(n => (n.num_courses || 0) > 0);
const allCourses = DATA.all_courses_sorted;
const allProfessors = Object.keys(DATA.professor_rankings || {}).sort().flatMap(dept =>
    DATA.professor_rankings[dept].map(p => ({ ...p, dept, id: `${dept}|${p.name}` })));

const majorById = new Map(DATA.rankings.map(r => [r.major, r]));
const deptById = new Map(subjects.map(n => [n.label, n]));
const courseById = new Map(allCourses.map(c => [c.course_id, c]));
const profById = new Map(allProfessors.map(p => [p.id, p]));

const deptsOfMajor = {};
const majorsOfDept = {};
DATA.edges.forEach(e => {
    const major = e.source.replace(/^major_/, '');
    const dept = e.target.replace(/^subj_/, '');
    (deptsOfMajor[major] = deptsOfMajor[major] || []).push(dept);
    (majorsOfDept[dept] = majorsOfDept[dept] || []).push(major);
});

// ─── GPA color scale (red-to-green) ─────────────────────────
// One scale for bars and graph nodes: lower GPA → red (harder), higher GPA → green (easier).
// Text never uses this color; values stay in ink so they remain readable.

function gpaColor(gpa) {
    if (gpa == null || Number.isNaN(gpa)) gpa = 3.2;
    const t = Math.max(0, Math.min(1, (gpa - 2.8) / 1.2));
    const h = t * 120;
    const s = 70 + 15 * Math.sin(t * Math.PI);
    const l = 40 + 8 * Math.sin(t * Math.PI);
    return `hsl(${h}, ${s}%, ${l}%)`;
}

// ─── Small render helpers ───────────────────────────────────

const BAR_MIN = 2.4, BAR_MAX = 4.0;
const barPct = gpa => Math.max(0, Math.min(100, (gpa - BAR_MIN) / (BAR_MAX - BAR_MIN) * 100)).toFixed(1);

function gpaBar(gpa, medianGpa) {
    const tick = medianGpa != null ? `<i class="bar__tick" style="left:${barPct(medianGpa)}%"></i>` : '';
    return `<span class="bar"><i class="bar__fill" style="width:${barPct(gpa)}%;background:${gpaColor(gpa)}"></i>${tick}</span>`;
}

const gpaCell = (gpa, medianGpa) => `<span class="gpa">${gpaBar(gpa, medianGpa)}<b>${gpa.toFixed(2)}</b></span>`;
const rowName = name => `<button type="button" class="rowlink">${esc(name)}</button>`;
const rankCell = r => `<span class="rank">${r.rank}</span>`;
const pctCell = v => (v == null ? '—' : `${v.toFixed(1)}%`);
const SORT_ARROWS = '<svg class="sort" viewBox="0 0 10 16" aria-hidden="true"><path class="sort__up" d="M5 1l4.5 5.5h-9z"/><path class="sort__down" d="M5 15L.5 9.5h9z"/></svg>';

function withRanks(rows) {
    [...rows].sort((a, b) => a.gpa - b.gpa).forEach((r, i) => { r.rank = i + 1; });
    return rows;
}

// Matches substrings, words typed partly ("comp sci") and codes without spaces ("math31a")
function matchesQuery(text, query) {
    const hay = text.toLowerCase();
    const q = query.trim().toLowerCase();
    if (!q || hay.includes(q)) return true;
    if (hay.replace(/\s+/g, '').includes(q.replace(/\s+/g, ''))) return true;
    const words = hay.split(/[^a-z0-9]+/);
    return q.split(/\s+/).every(t => words.some(w => w.startsWith(t)));
}

// ─── Scopes and filters ─────────────────────────────────────

const MAJOR_SCOPES = {
    all: { label: 'All', long: 'All courses', gpa: 'avg_gpa', pct: 'pct_A', students: 'total_students', courses: 'num_courses' },
    ld_all: { label: 'Lower', long: 'Lower-div', tip: 'Numbered below 100', gpa: 'ld_all_gpa', pct: 'ld_all_pctA', students: 'ld_all_students', courses: 'num_lower_exact' },
    ud_all: { label: 'Upper', long: 'Upper-div', tip: 'Numbered 100 to 199', gpa: 'ud_all_gpa', pct: 'ud_all_pctA', students: 'ud_all_students', courses: 'num_upper_exact' },
    ud_req: { label: 'Required', long: 'Upper-div required', tip: 'Upper-div courses the major requires', gpa: 'ud_req_gpa', pct: 'ud_req_pctA', students: 'ud_req_students', courses: 'num_upper_req' },
    ud_elec: { label: 'Electives', long: 'Upper-div electives', tip: 'Other upper-div courses in its departments', gpa: 'ud_elec_gpa', pct: 'ud_elec_pctA', students: 'ud_elec_students', courses: 'num_upper_elec' },
};

const DEPT_SCOPES = {
    all: { label: 'All', long: 'All courses', gpa: 'avg_gpa', pct: 'pct_A', students: 'total_students', courses: 'num_courses' },
    ld: { label: 'Lower', long: 'Lower-div', tip: 'Numbered below 100', gpa: 'ld_gpa', pct: 'ld_pctA', students: 'ld_total_students', courses: 'ld_num_courses' },
    ud: { label: 'Upper', long: 'Upper-div', tip: 'Numbered 100 to 199', gpa: 'ud_gpa', pct: 'ud_pctA', students: 'ud_total_students', courses: 'ud_num_courses' },
};

const COURSE_LEVELS = {
    all: { label: 'All' },
    ld: { label: 'Lower', tip: 'Numbered below 100' },
    ud: { label: 'Upper', tip: 'Numbered 100 to 199' },
    grad: { label: 'Grad', tip: 'Numbered 200 and up' },
};

// GE categories for filter dropdown (foundation > category order)
const GE_CATEGORIES = [
    'Literary and Cultural Analysis',
    'Philosophical and Linguistic Analysis',
    'Visual and Performance Arts Analysis and Practice',
    'Historical Analysis',
    'Social Analysis',
    'Life Sciences',
    'Physical Sciences',
];

function getCourseNumberFromId(courseId) {
    if (!courseId) return 0;
    const parts = String(courseId).split(' ');
    const m = parts[parts.length - 1].match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
}

function courseLevel(courseId) {
    const n = getCourseNumberFromId(courseId);
    return n >= 200 ? 'grad' : n >= 100 ? 'ud' : 'ld';
}

// ─── Rows ───────────────────────────────────────────────────

function majorRows(scopeKey = state.scope.majors) {
    const s = MAJOR_SCOPES[scopeKey];
    return withRanks(DATA.rankings.filter(r => r[s.gpa] != null).map(r => ({
        id: r.major,
        name: r.major,
        gpa: adjustGpa(r[s.gpa], r.ability_proxy),
        pctA: r[s.pct],
        courses: r[s.courses],
        students: r[s.students],
    })));
}

function deptRows(scopeKey = state.scope.departments) {
    const s = DEPT_SCOPES[scopeKey];
    return withRanks(deptsWithCourses.filter(n => n[s.gpa] != null).map(n => ({
        id: n.label,
        name: n.label,
        gpa: adjustGpa(n[s.gpa], n.ability_proxy),
        pctA: n[s.pct],
        courses: n[s.courses] || 0,
        students: n[s.students] || 0,
    })));
}

function professorRows() {
    const rows = allProfessors
        .filter(p => state.dept.professors === 'all' || p.dept === state.dept.professors)
        .map(p => ({
            id: p.id,
            name: p.name,
            dept: p.dept,
            gpa: adjustGpa(p.avg_gpa, deptAbilityProxy[p.dept]),
            pctA: p.pct_A,
            min: p.prof_min_gpa ?? p.avg_gpa,
            max: p.prof_max_gpa ?? p.avg_gpa,
            classes: p.num_classes ?? p.num_courses,
            students: p.total_students,
        }));
    // Ranks stay within a department; departments are never mixed
    const byDept = {};
    rows.forEach(r => { (byDept[r.dept] = byDept[r.dept] || []).push(r); });
    Object.values(byDept).forEach(withRanks);
    return rows;
}

function courseRows() {
    const level = state.scope.courses;
    const dept = state.dept.courses;
    const ge = state.ge;
    return withRanks(allCourses.filter(c => {
        const cats = c.ge_categories || [];
        if (ge === 'any' && !cats.length) return false;
        if (ge !== 'any' && ge !== 'none' && !cats.some(g => g.category === ge)) return false;
        if (level !== 'all' && courseLevel(c.course_id) !== level) return false;
        if (dept !== 'all' && c.subject_area !== dept) return false;
        return true;
    }).map(c => ({
        id: c.course_id,
        name: c.course_id,
        title: (c.course_title || '').trim(),
        gpa: adjustGpa(c.avg_gpa, deptAbilityProxy[c.subject_area]),
        pctA: c.pct_A,
        students: c.total_letter_grades || 0,
        dept: c.subject_area || '',
        ge: (c.ge_categories || []).map(g => g.category).filter(Boolean),
    })));
}

// ─── View definitions ───────────────────────────────────────

const pctColumn = tip => ({ key: 'pctA', label: '% A range', cls: 'num hide-sm', tip, value: r => r.pctA ?? 0, cell: r => pctCell(r.pctA), csv: r => r.pctA });
const rankColumn = tip => ({ key: 'rank', label: '#', cls: 'num col-rank', tip, cell: rankCell, csv: r => r.rank });
const gpaColumn = tip => ({
    key: 'gpa', label: 'Avg GPA', cls: 'col-gpa', tip, value: r => r.gpa,
    cell: (r, m) => gpaCell(r.gpa, m), csv: r => r.gpa.toFixed(3),
});

const VIEWS = {
    majors: {
        title: 'Majors', noun: ['major', 'majors'], placeholder: 'Find a major', selType: 'major',
        rows: () => majorRows(),
        hay: r => r.name,
        columns: [
            rankColumn('Rank by GPA. 1 is lowest.'),
            { key: 'major', label: 'Major', cls: 'col-name', value: r => r.name, text: true, cell: r => rowName(r.name), csv: r => r.name },
            gpaColumn('Average grade. The notch marks the median.'),
            pctColumn('Share of grades that were A+, A or A−.'),
            { key: 'courses', label: 'Courses', cls: 'num hide-md', tip: 'Required courses with grade data.', value: r => r.courses ?? 0, cell: r => fmt(r.courses), csv: r => r.courses },
            { key: 'students', label: 'Grades', cls: 'num hide-md', tip: 'Letter grades counted, 2021 to 2025.', value: r => r.students ?? 0, cell: r => fmt(r.students), csv: r => r.students },
            { key: 'pin', label: '', cls: 'col-pin', cell: r => pinButton(r.id) },
        ],
        filters: () => segControl('scope', MAJOR_SCOPES, state.scope.majors),
    },
    departments: {
        title: 'Departments', noun: ['department', 'departments'], placeholder: 'Find a department', selType: 'dept',
        rows: () => deptRows(),
        hay: r => r.name,
        columns: [
            rankColumn('Rank by GPA. 1 is lowest.'),
            { key: 'dept', label: 'Department', cls: 'col-name', value: r => r.name, text: true, cell: r => rowName(r.name), csv: r => r.name },
            gpaColumn('Average grade. The notch marks the median.'),
            pctColumn('Share of grades that were A+, A or A−.'),
            { key: 'courses', label: 'Courses', cls: 'num hide-md', tip: 'Courses with grade data.', value: r => r.courses, cell: r => fmt(r.courses), csv: r => r.courses },
            { key: 'students', label: 'Grades', cls: 'num hide-md', tip: 'Letter grades counted, 2021 to 2025.', value: r => r.students, cell: r => fmt(r.students), csv: r => r.students },
        ],
        filters: () => segControl('scope', DEPT_SCOPES, state.scope.departments),
    },
    professors: {
        title: 'Professors', noun: ['professor', 'professors'], placeholder: 'Find a professor', selType: 'prof',
        rows: () => professorRows(),
        hay: r => `${r.name} ${r.dept}`,
        columns: [
            rankColumn('Rank within the department. 1 is lowest.'),
            { key: 'dept', label: 'Dept', cls: 'col-dept', value: r => r.dept, text: true, cell: r => esc(r.dept), csv: r => r.dept },
            { key: 'name', label: 'Professor', cls: 'col-name', value: r => r.name, text: true, cell: r => rowName(r.name), csv: r => r.name },
            gpaColumn('Average grade. The notch marks the median.'),
            pctColumn('Share of grades that were A+, A or A−.'),
            { key: 'range', label: 'Range', cls: 'num hide-md', tip: 'Lowest to highest section GPA.', value: (r, dir) => (dir === 'desc' ? r.max : r.min), cell: r => `${r.min.toFixed(2)}–${r.max.toFixed(2)}`, csv: r => `${r.min.toFixed(3)}-${r.max.toFixed(3)}` },
            { key: 'classes', label: 'Classes', cls: 'num hide-md', tip: 'Sections taught. 10 is the minimum to appear.', value: r => r.classes ?? 0, cell: r => fmt(r.classes), csv: r => r.classes },
            { key: 'students', label: 'Grades', cls: 'num hide-md', tip: 'Letter grades counted, 2021 to 2025.', value: r => r.students, cell: r => fmt(r.students), csv: r => r.students },
        ],
        filters: () => deptSelect('professors', Object.keys(DATA.professor_rankings || {}).sort()),
    },
    courses: {
        title: 'Courses', noun: ['course', 'courses'], placeholder: 'Find a course', selType: 'course',
        rows: () => courseRows(),
        hay: r => `${r.name} ${r.title}`,
        columns: [
            rankColumn('Rank by GPA. 1 is lowest.'),
            { key: 'course', label: 'Course', cls: 'col-name', value: r => r.name, text: true, cell: r => rowName(r.name), csv: r => r.name },
            { key: 'title', label: 'Title', cls: 'col-title hide-sm', value: r => r.title, text: true, cell: r => `<span class="clip" data-tip="${esc(r.title)}">${esc(r.title)}</span>`, csv: r => r.title },
            gpaColumn('Average grade. The notch marks the median.'),
            pctColumn('Share of grades that were A+, A or A−.'),
            { key: 'students', label: 'Grades', cls: 'num hide-md', tip: 'Letter grades counted, 2021 to 2025.', value: r => r.students, cell: r => fmt(r.students), csv: r => r.students },
            { key: 'dept', label: 'Dept', cls: 'col-dept hide-md', value: r => r.dept, text: true, cell: r => esc(r.dept), csv: r => r.dept },
            { key: 'ge', label: 'GE', cls: 'col-ge hide-lg', tip: 'GE categories this course satisfies.', cell: r => (r.ge.length ? `<span class="clip" data-tip="${esc(r.ge.join(', '))}">${esc(r.ge.join(', '))}</span>` : '—'), csv: r => r.ge.join('; ') },
        ],
        filters: () => `${segControl('scope', COURSE_LEVELS, state.scope.courses)}
            ${deptSelect('courses', Array.from(new Set(allCourses.map(c => c.subject_area).filter(Boolean))).sort())}
            ${geSelect()}`,
    },
    graph: {
        title: 'Graph', noun: ['match', 'matches'], placeholder: 'Find a major or department',
    },
    about: {
        title: 'About',
    },
};

// ─── Toolbar controls ───────────────────────────────────────

function segControl(name, options, current) {
    const buttons = Object.entries(options).map(([key, o]) =>
        `<button type="button" class="seg__opt" data-seg="${name}" data-value="${key}" aria-pressed="${key === current}"${o.tip ? ` data-tip="${esc(o.tip)}"` : ''}>${esc(o.label)}</button>`
    ).join('');
    return `<div class="seg" role="group" aria-label="Course filter"><span class="seg__thumb"></span>${buttons}</div>`;
}

function deptSelect(view, depts) {
    const options = depts.map(d => `<option value="${esc(d)}"${d === state.dept[view] ? ' selected' : ''}>${esc(d)}</option>`).join('');
    return `<select class="select" data-filter="dept" aria-label="Department"><option value="all">All depts</option>${options}</select>`;
}

function geSelect() {
    const options = [['none', 'No GE filter'], ['any', 'Any GE'], ...GE_CATEGORIES.map(c => [c, c])]
        .map(([v, t]) => `<option value="${esc(v)}"${v === state.ge ? ' selected' : ''}>${esc(t)}</option>`).join('');
    return `<select class="select select--ge" data-filter="ge" aria-label="GE category">${options}</select>
        <button type="button" class="info" aria-label="About GE data" data-tip="From the Registrar's GE list, March 2026. Some courses may be missing.">${icon('info')}</button>`;
}

function placeSegThumb() {
    const seg = document.querySelector('#filters .seg');
    if (!seg) return;
    const active = seg.querySelector('[aria-pressed="true"]');
    const thumb = seg.querySelector('.seg__thumb');
    thumb.style.width = active.offsetWidth + 'px';
    thumb.style.transform = `translateX(${active.offsetLeft}px)`;
}

// ─── Table ──────────────────────────────────────────────────

const CHUNK = 120;
let tableRows = [];
let tableShown = 0;
let tableMedian = null;

function sortRows(view, rows) {
    const { key, dir } = state.sort[view];
    const col = VIEWS[view].columns.find(c => c.key === key);
    const mul = dir === 'asc' ? 1 : -1;
    const cmp = col.text
        ? (a, b) => mul * String(col.value(a)).localeCompare(String(col.value(b)))
        : (a, b) => mul * (col.value(a, dir) - col.value(b, dir));
    if (view !== 'professors') return rows.sort(cmp);
    // Sort within department (never mixes departments)
    const deptMul = key === 'dept' ? mul : 1;
    return rows.sort((a, b) => deptMul * a.dept.localeCompare(b.dept) || (key === 'dept' ? a.gpa - b.gpa : cmp(a, b)));
}

function renderHead(view) {
    const { key, dir } = state.sort[view];
    const tipAttr = c => (c.tip ? ` data-tip="${esc(c.tip)}"` : '');
    $('table-head').innerHTML = `<tr>${VIEWS[view].columns.map(c => {
        if (c.key === 'pin') return `<th class="${c.cls}"><span class="sr">Compare</span></th>`;
        if (c.key === 'rank' || c.key === 'ge') return `<th class="${c.cls}"><span class="th"${tipAttr(c)}>${c.label}</span></th>`;
        const active = c.key === key;
        // The up arrow lights up when highest values are at the top, the down arrow when lowest are
        return `<th class="${c.cls}${active ? ' is-sorted' : ''}" aria-sort="${active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
            <button type="button" class="th" data-sort="${c.key}"${tipAttr(c)}>${c.label}${SORT_ARROWS}</button></th>`;
    }).join('')}</tr>`;
}

function rowHtml(r, i) {
    const v = VIEWS[state.view];
    const sel = state.sel && state.sel.type === v.selType && state.sel.id === r.id;
    let band = '';
    if (state.view === 'professors') {
        const prev = tableRows[i - 1];
        r.band = prev ? (prev.dept === r.dept ? prev.band : !prev.band) : false;
        band = r.band ? ' is-band' : '';
    }
    return `<tr data-id="${esc(r.id)}" class="${sel ? 'is-selected' : ''}${band}">${
        v.columns.map(c => `<td class="${c.cls}">${c.cell(r, tableMedian)}</td>`).join('')}</tr>`;
}

function appendRows(count = CHUNK) {
    const end = Math.min(tableShown + count, tableRows.length);
    let html = '';
    for (let i = tableShown; i < end; i++) html += rowHtml(tableRows[i], i);
    $('table-body').insertAdjacentHTML('beforeend', html);
    tableShown = end;
}

function renderTable({ keepScroll = false } = {}) {
    const view = state.view;
    const v = VIEWS[view];
    const q = state.search[view] || '';
    const base = v.rows();
    tableMedian = median(base.map(r => r.gpa));
    tableRows = sortRows(view, q ? base.filter(r => matchesQuery(v.hay(r), q)) : base);
    renderHead(view);
    $('table-body').innerHTML = '';
    tableShown = 0;
    appendRows();
    if (!keepScroll) $('table-wrap').scrollTop = 0;

    const empty = !tableRows.length;
    $('table-empty').hidden = !empty;
    $('table').hidden = empty;
    if (empty) {
        $('table-empty-text').textContent = q
            ? `No ${v.noun[1]} match “${q.trim()}”.`
            : `No ${v.noun[1]} match these filters.`;
    }
    const n = tableRows.length;
    setCount(`${fmt(n)} ${v.noun[n === 1 ? 0 : 1]}${tableMedian != null && !q ? `, median ${tableMedian.toFixed(2)}` : ''}`);
}

// Bars grow in when the numbers are new: a new view, a filter, the adjustment
let freshTimer = 0;

function freshBars() {
    const body = $('table-body');
    body.classList.add('is-fresh');
    clearTimeout(freshTimer);
    freshTimer = setTimeout(() => body.classList.remove('is-fresh'), 500);
}

function setCount(text) {
    document.querySelectorAll('[data-count]').forEach(el => { el.textContent = text; });
}

function revealSelectedRow() {
    const v = VIEWS[state.view];
    if (!state.sel || !v.columns || state.sel.type !== v.selType) return;
    const idx = tableRows.findIndex(r => r.id === state.sel.id);
    if (idx < 0) return;
    if (idx >= tableShown) appendRows(idx - tableShown + 20);
    const row = $('table-body').children[idx];
    if (row) row.scrollIntoView({ block: 'nearest' });
}

function markSelectedRow() {
    const v = VIEWS[state.view];
    document.querySelectorAll('#table-body tr.is-selected').forEach(tr => tr.classList.remove('is-selected'));
    if (!state.sel || state.sel.type !== v.selType) return;
    const idx = tableRows.findIndex(r => r.id === state.sel.id);
    const row = idx >= 0 ? $('table-body').children[idx] : null;
    if (row) row.classList.add('is-selected');
}

// ─── Compare ────────────────────────────────────────────────

function pinButton(id) {
    const on = state.compare.includes(id);
    return `<button type="button" class="pin" data-pin="${esc(id)}" aria-pressed="${on}" aria-label="${on ? 'Remove from' : 'Add to'} compare" data-tip="${on ? 'Remove from compare' : 'Add to compare'}">${icon(on ? 'check' : 'plus')}</button>`;
}

function togglePin(id) {
    if (state.compare.includes(id)) {
        state.compare = state.compare.filter(x => x !== id);
    } else if (state.compare.length >= MAX_COMPARE) {
        toast(`You can compare up to ${MAX_COMPARE} majors. Remove one first.`);
        replayClass($('tray'), 'is-shake');
        return;
    } else {
        state.compare = [...state.compare, id];
    }
    const added = state.compare.includes(id);
    saveStore({ compare: state.compare });
    document.querySelectorAll('.pin[data-pin]').forEach(btn => {
        if (btn.dataset.pin === id) btn.outerHTML = pinButton(id);
    });
    if (added) {
        document.querySelectorAll('.pin[data-pin]').forEach(btn => {
            if (btn.dataset.pin === id) btn.classList.add('is-pop');
        });
    }
    if (state.sel && state.sel.type === 'compare' && state.compare.length === 0) state.sel = null;
    renderTray(added ? id : null);
    renderDock();
    commit();
}

function renderTray(addedId = null) {
    const tray = $('tray');
    const wasHidden = tray.hidden;
    tray.hidden = !state.compare.length || state.view === 'about';
    if (tray.hidden) return;
    tray.innerHTML = `<span class="tray__label">Compare</span>
        <span class="tray__chips">${state.compare.map(id =>
            `<span class="chip${id === addedId ? ' is-new' : ''}"><span class="chip__text">${esc(id)}</span><button type="button" class="chip__x" data-pin="${esc(id)}" aria-label="Remove ${esc(id)}">${icon('close')}</button></span>`
        ).join('')}</span>
        <button type="button" class="btn btn--primary" data-go="compare:all">Compare ${state.compare.length}</button>`;
    if (wasHidden && addedId) replayClass(tray, 'is-rising');
    else if (addedId) replayClass(tray.querySelector('.btn--primary'), 'is-bump');
}

// Restarts a one-shot CSS animation
function replayClass(el, name) {
    el.classList.remove(name);
    void el.offsetWidth;
    el.classList.add(name);
    el.addEventListener('animationend', () => el.classList.remove(name), { once: true });
}

// ─── Detail dock ────────────────────────────────────────────

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

const externalLink = (href, label) =>
    `<a class="btn" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}${icon('external')}</a>`;

const gpaLabel = () => `average GPA${state.adjusted ? '<span class="badge">Adjusted</span>' : ''}`;
const fact = (label, value) => `<div class="fact"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;

function compareToMedian(gpa, med, noun) {
    if (med == null) return '';
    const diff = gpa - med;
    if (Math.abs(diff) < 0.005) return `about the same as the median ${noun}`;
    return `${Math.abs(diff).toFixed(2)} ${diff < 0 ? 'below' : 'above'} the median ${noun}`;
}

function breakdown(rows) {
    return `<div class="brk">${rows.map(r => `
        <div class="brk__row${r.current ? ' is-current' : ''}">
            <span class="brk__label">${esc(r.label)}</span>
            ${r.gpa == null ? '<span class="brk__none">No data</span>' : `${gpaBar(r.gpa, r.median)}<b>${r.gpa.toFixed(2)}</b>`}
        </div>`).join('')}</div>`;
}

function dockHead(eyebrow, title) {
    const prev = state.trail[state.trail.length - 1];
    const back = prev
        ? `<button type="button" class="dock__back" data-act="back">${icon('back')}<span>${esc(prev.id === 'all' ? 'Compare' : prev.id.split('|').pop())}</span></button>`
        : '';
    return `${back}<header class="dock__head">
        <div>${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}<h2>${esc(title)}</h2></div>
        <button type="button" class="iconbtn" data-act="close" aria-label="Close" data-tip="Close" data-key="Esc">${icon('close')}</button>
    </header>`;
}

function courseList(heading, courses) {
    const list = (courses || []).filter(c => courseLevel(c.course_id) !== 'grad' && courseById.has(c.course_id));
    if (!list.length) return '';
    return `<h3>${esc(heading)}</h3><ul class="linklist">${list.map(c => `
        <li><button type="button" data-go="course:${esc(c.course_id)}">
            <span><b>${esc(c.course_id)}</b> ${esc((c.course_title || '').trim())}</span>
            <span class="linklist__num">${c.avg_gpa.toFixed(2)}</span>
        </button></li>`).join('')}</ul>`;
}

function chipLinks(type, ids, limit = 18) {
    const shown = ids.slice(0, limit);
    const more = ids.length - shown.length;
    return `<div class="chips">${shown.map(id =>
        `<button type="button" class="chip chip--link" data-go="${type}:${esc(id)}"><span class="chip__text">${esc(id)}</span></button>`
    ).join('')}${more > 0 ? `<span class="chips__more">and ${more} more</span>` : ''}</div>`;
}

function majorDetail(id) {
    const r = majorById.get(id);
    if (!r) return null;
    const rows = majorRows('all');
    const me = rows.find(x => x.id === id);
    const med = median(rows.map(x => x.gpa));
    const degree = (id.match(/\b(BA|BS|BM)\b/) || [])[1];
    const pinned = state.compare.includes(id);
    const scopes = Object.entries(MAJOR_SCOPES).map(([key, s]) => {
        const scoped = majorRows(key);
        const row = scoped.find(x => x.id === id);
        return { label: s.long, gpa: row ? row.gpa : null, median: median(scoped.map(x => x.gpa)), current: key === state.scope.majors };
    });
    const adjustedFacts = state.adjusted && ADJ
        ? (r.ability_proxy != null
            ? fact('Raw GPA', r.avg_gpa.toFixed(3))
            : fact('Adjustment', 'None, no transfer data'))
        : '';
    return `${dockHead(degree ? `Major, ${degree}` : 'Major', id)}
        <div class="headline">
            <span class="headline__num">${me.gpa.toFixed(3)}</span>
            <span class="headline__label">${gpaLabel()}</span>
        </div>
        <p class="lede">Rank <b>${me.rank}</b> of ${rows.length}, where 1 is the lowest average GPA. That is ${compareToMedian(me.gpa, med, 'major')}.</p>
        <div class="dock__actions">
            <button type="button" class="btn${pinned ? '' : ' btn--primary'}" data-pin="${esc(id)}">${icon(pinned ? 'check' : 'plus')}${pinned ? 'In compare' : 'Compare'}</button>
            ${r.catalog_url ? externalLink(r.catalog_url, 'UCLA catalog') : ''}
        </div>
        <h3>By course type</h3>
        ${breakdown(scopes)}
        <p class="caption">The notch marks the median major for that row.</p>
        <dl class="facts">
            ${fact('A-range grades', pctCell(r.pct_A))}
            ${fact('Courses matched', fmt(r.num_courses))}
            ${fact('Letter grades', fmt(r.total_students))}
            ${fact('Transfer admit GPA', r.ability_proxy != null ? r.ability_proxy.toFixed(2) : 'No data')}
            ${adjustedFacts}
        </dl>
        ${courseList('Lowest-GPA linked courses', (DATA.major_details[id] || {}).hardest_courses)}
        ${courseList('Highest-GPA linked courses', (DATA.major_details[id] || {}).easiest_courses)}
        ${(DATA.major_details[id] || {}).hardest_courses ? '<p class="caption">Undergraduate courses linked from the catalog page. These may be options or prerequisites, not all required.</p>' : ''}
        ${(deptsOfMajor[id] || []).length ? `<h3>Departments it draws on</h3>${chipLinks('dept', deptsOfMajor[id])}` : ''}`;
}

function deptDetail(id) {
    const n = deptById.get(id);
    if (!n) return null;
    if (!(n.num_courses > 0)) {
        return `${dockHead('Department', id)}<p class="lede">No grade data for this department's courses in 2021 to 2025.</p>
            ${(majorsOfDept[id] || []).length ? `<h3>Majors that draw on it</h3>${chipLinks('major', majorsOfDept[id])}` : ''}`;
    }
    const rows = deptRows('all');
    const me = rows.find(x => x.id === id);
    const scopes = Object.entries(DEPT_SCOPES).map(([key, s]) => {
        const scoped = deptRows(key);
        const row = scoped.find(x => x.id === id);
        return { label: s.long, gpa: row ? row.gpa : null, median: median(scoped.map(x => x.gpa)), current: key === state.scope.departments };
    });
    const catalogSlug = id.replace(/\s+/g, '').replace(/&/g, '');
    const hasProfs = !!(DATA.professor_rankings || {})[id];
    return `${dockHead('Department', id)}
        <div class="headline">
            <span class="headline__num">${me.gpa.toFixed(3)}</span>
            <span class="headline__label">${gpaLabel()}</span>
        </div>
        <p class="lede">Rank <b>${me.rank}</b> of ${rows.length} departments, where 1 is the lowest average GPA. That is ${compareToMedian(me.gpa, median(rows.map(x => x.gpa)), 'department')}.</p>
        <div class="dock__actions">
            <button type="button" class="btn btn--primary" data-jump="courses" data-dept="${esc(id)}">See courses</button>
            ${hasProfs ? `<button type="button" class="btn" data-jump="professors" data-dept="${esc(id)}">See professors</button>` : ''}
            ${externalLink(`https://catalog.registrar.ucla.edu/browse/Subject%20Areas/${catalogSlug}?siteYear=2024`, 'UCLA catalog')}
        </div>
        <h3>By course level</h3>
        ${breakdown(scopes)}
        <p class="caption">The notch marks the median department for that row.</p>
        <dl class="facts">
            ${fact('A-range grades', pctCell(n.pct_A))}
            ${fact('Courses', fmt(n.num_courses))}
            ${fact('Letter grades', fmt(n.total_students))}
        </dl>
        ${(majorsOfDept[id] || []).length ? `<h3>Majors that draw on it</h3>${chipLinks('major', majorsOfDept[id])}` : ''}`;
}

function profDetail(id) {
    const p = profById.get(id);
    if (!p) return null;
    const rows = allProfessors.filter(x => x.dept === p.dept).map(x => adjustGpa(x.avg_gpa, deptAbilityProxy[x.dept]));
    const gpa = adjustGpa(p.avg_gpa, deptAbilityProxy[p.dept]);
    const slug = p.bruinwalk_slug || bruinwalkSlug(p.name);
    return `${dockHead(`Professor, ${p.dept}`, p.name)}
        <div class="headline">
            <span class="headline__num">${gpa.toFixed(3)}</span>
            <span class="headline__label">${gpaLabel()}</span>
        </div>
        <p class="lede">That is ${compareToMedian(gpa, median(rows), `listed professor in ${p.dept}`)}.</p>
        <p class="caption">This reflects grades in the courses they taught, not teaching quality.</p>
        <div class="dock__actions">
            ${slug ? externalLink(`https://bruinwalk.com/professors/${slug}/`, 'Bruinwalk') : ''}
            <button type="button" class="btn" data-jump="courses" data-dept="${esc(p.dept)}">${esc(p.dept)} courses</button>
        </div>
        <dl class="facts">
            ${fact('A-range grades', pctCell(p.pct_A))}
            ${fact('Section GPA range', `${(p.prof_min_gpa ?? p.avg_gpa).toFixed(2)}–${(p.prof_max_gpa ?? p.avg_gpa).toFixed(2)}`)}
            ${fact('Classes', fmt(p.num_classes ?? p.num_courses))}
            ${fact('Letter grades', fmt(p.total_students))}
        </dl>`;
}

function courseDetail(id) {
    const c = courseById.get(id);
    if (!c) return null;
    const proxy = deptAbilityProxy[c.subject_area];
    const gpa = adjustGpa(c.avg_gpa, proxy);
    const dept = deptById.get(c.subject_area);
    const deptGpa = dept && dept.avg_gpa != null ? adjustGpa(dept.avg_gpa, dept.ability_proxy) : null;
    const hasGrades = (c.total_letter_grades || 0) > 0;
    const ge = (c.ge_categories || []).map(g => g.category).filter(Boolean);
    return `${dockHead('', id)}
        ${c.course_title ? `<p class="lede lede--title">${esc(c.course_title.trim())}</p>` : ''}
        <div class="headline">
            <span class="headline__num">${gpa.toFixed(3)}</span>
            <span class="headline__label">${gpaLabel()}</span>
        </div>
        ${deptGpa != null ? `<p class="lede">${compareToMedianLine(gpa, deptGpa, c.subject_area)}</p>` : ''}
        <div class="dock__actions">
            ${hasGrades && c.uclagrades_url ? externalLink(c.uclagrades_url, 'Grade distribution') : ''}
            ${c.catalog_url ? externalLink(c.catalog_url, 'UCLA catalog') : ''}
        </div>
        <dl class="facts">
            ${fact('A-range grades', pctCell(c.pct_A))}
            ${fact('Letter grades', fmt(c.total_letter_grades))}
            ${fact('Department', dept ? `<button type="button" class="textlink" data-go="dept:${esc(c.subject_area)}">${esc(c.subject_area)}</button>` : esc(c.subject_area))}
        </dl>
        ${ge.length ? `<h3>Satisfies GE</h3><ul class="plainlist">${ge.map(g => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}`;
}

function compareToMedianLine(gpa, deptGpa, dept) {
    const diff = gpa - deptGpa;
    if (Math.abs(diff) < 0.005) return `About the same as the ${esc(dept)} department average.`;
    return `${Math.abs(diff).toFixed(2)} ${diff < 0 ? 'below' : 'above'} the ${esc(dept)} department average.`;
}

function compareDetail() {
    const majors = state.compare.map(id => majorById.get(id)).filter(Boolean);
    if (!majors.length) return null;
    const scoped = Object.values(MAJOR_SCOPES).map(s => ({
        label: s.long,
        cells: majors.map(m => (m[s.gpa] != null ? adjustGpa(m[s.gpa], m.ability_proxy).toFixed(2) : '—')),
    }));
    const row = (label, cells, cls = '') =>
        `<tr class="${cls}"><th scope="row">${esc(label)}</th>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
    const ranks = majorRows('all');
    return `${dockHead('Compare', `${majors.length} ${majors.length === 1 ? 'major' : 'majors'}`)}
        ${majors.length < 2 ? '<p class="lede">Add another major with the + button in the table.</p>' : ''}
        <div class="cmp-wrap"><table class="cmp">
            <thead><tr><td></td>${majors.map(m => `<th scope="col">
                <button type="button" class="cmp__name" data-go="major:${esc(m.major)}">${esc(m.major).replace(/\//g, '/<wbr>')}</button>
                <button type="button" class="cmp__x" data-pin="${esc(m.major)}" aria-label="Remove ${esc(m.major)}" data-tip="Remove">${icon('close')}</button>
            </th>`).join('')}</tr></thead>
            <tbody>
                ${row('Rank', majors.map(m => ranks.find(x => x.id === m.major).rank))}
                ${scoped.map((s, i) => row(s.label, s.cells, i === 0 ? 'is-key' : '')).join('')}
                ${row('A range', majors.map(m => pctCell(m.pct_A)))}
                ${row('Courses', majors.map(m => fmt(m.num_courses)))}
                ${row('Admit GPA', majors.map(m => (m.ability_proxy != null ? m.ability_proxy.toFixed(2) : '—')))}
            </tbody>
        </table></div>
        <p class="caption">Rank 1 is the lowest of ${ranks.length} majors. This list is saved in your browser only.</p>
        <div class="dock__actions"><button type="button" class="btn" data-act="clear-compare">Clear compare</button></div>`;
}

function renderIntro() {
    const el = $('intro');
    const dismissed = !!loadStore().introDismissed;
    $('intro-show').hidden = state.view !== 'majors' || !dismissed;
    el.hidden = state.view !== 'majors' || dismissed;
    if (el.hidden) return;
    const rows = majorRows('all').sort((a, b) => a.gpa - b.gpa);
    const item = r => `<li><button type="button" data-go="major:${esc(r.id)}"><span>${esc(r.name)}</span><span class="linklist__num">${r.gpa.toFixed(2)}</span></button></li>`;
    el.innerHTML = `<div class="intro__lead">
            <h1>What grades do UCLA majors give?</h1>
            <p>Average GPAs from ${(DATA.total_student_grades / 1e6).toFixed(2)} million letter grades, 2021 to 2025. Select a major for its breakdown. A lower GPA can mean stricter grading, but it is not proof a major is harder. <button type="button" class="textlink" data-view="about">How to read this</button></p>
        </div>
        <div class="stats">
            <div><b>${fmt(DATA.rankings.length)}</b><span>majors</span></div>
            <div><b>${fmt(allCourses.length)}</b><span>courses</span></div>
            <div><b>${fmt(allProfessors.length)}</b><span>professors</span></div>
            <div><b>4</b><span>years</span></div>
        </div>
        <div class="intro__list intro__list--low"><h2>Lowest GPA</h2><ul class="linklist">${rows.slice(0, 3).map(item).join('')}</ul></div>
        <div class="intro__list intro__list--high"><h2>Highest GPA</h2><ul class="linklist">${rows.slice(-3).reverse().map(item).join('')}</ul></div>
        <button type="button" class="iconbtn intro__close" data-act="dismiss-intro" aria-label="Hide this introduction" data-tip="Hide">${icon('close')}</button>`;
}

function setIntroOpen(open) {
    saveStore({ introDismissed: !open });
    const el = $('intro');
    if (!open && reducedMotion()) return renderIntro();
    if (open) {
        renderIntro();
        $('table-wrap').scrollTop = 0;
        if (reducedMotion()) return;
    }
    // Fold the band in or out so it is clear where it went
    const cs = getComputedStyle(el);
    const shut = { height: '0px', paddingTop: '0px', paddingBottom: '0px', borderBottomWidth: '0px', opacity: 0 };
    const full = { height: `${el.offsetHeight}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, borderBottomWidth: cs.borderBottomWidth, opacity: 1 };
    el.style.overflow = 'hidden';
    $('intro-show').hidden = open || state.view !== 'majors';
    el.animate(open ? [shut, full] : [full, shut], { duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' }).onfinish = () => {
        el.style.overflow = '';
        if (!open) renderIntro();
    };
}

const DETAIL = { major: majorDetail, dept: deptDetail, prof: profDetail, course: courseDetail, compare: compareDetail };

function renderDock() {
    const dock = $('dock');
    const changed = dock.dataset.key !== selKey(state.sel);
    const keep = changed ? 0 : dock.scrollTop;
    let html = state.sel ? DETAIL[state.sel.type](state.sel.id) : null;
    if (state.sel && html == null) {
        toast('That link points to something that is not in this data.');
        state.sel = null;
    }
    // Closing keeps the old content so the panel does not go blank as it slides away
    if (html != null) {
        dock.innerHTML = `<div class="dock__body${changed ? ' is-entering' : ''}">${html}</div>`;
        dock.classList.toggle('is-wide', state.sel.type === 'compare');
    }
    dock.dataset.key = selKey(state.sel);
    dock.scrollTop = keep;
    const open = !!state.sel;
    dock.classList.toggle('is-open', open);
    $('scrim').classList.toggle('is-open', open);
}

const selKey = sel => (sel ? `${sel.type}:${sel.id}` : '');

function parseSel(text) {
    if (!text) return null;
    const i = text.indexOf(':');
    const type = text.slice(0, i);
    return DETAIL[type] ? { type, id: text.slice(i + 1) } : null;
}

function select(sel, { fromDock = false, push = true } = {}) {
    state.trail = fromDock && state.sel ? [...state.trail, state.sel] : [];
    state.sel = sel;
    renderDock();
    markSelectedRow();
    syncGraphSelection();
    commit(push);
}

function closeDetail() {
    state.trail = [];
    state.sel = null;
    renderDock();
    markSelectedRow();
    syncGraphSelection();
    commit();
}

// ─── Notes ──────────────────────────────────────────────────

function renderNote() {
    const notes = [];
    if (state.view === 'professors') {
        notes.push('<p>Grades in the courses taught, not teaching quality. <button type="button" class="textlink" data-view="about" data-anchor="about-caveats">Caveats</button></p>');
    }
    if (state.adjusted && state.view !== 'about') {
        notes.push('<p class="is-adjusted">Adjusted GPAs: a rough estimate based on transfer-admit GPA. <a href="ability-adjustment.html">How it works</a></p>');
    }
    const note = $('note');
    note.hidden = !notes.length;
    note.innerHTML = notes.join('');
}

// ─── Chrome ─────────────────────────────────────────────────

function renderChrome() {
    const view = state.view;
    const v = VIEWS[view];
    const isTable = !!v.columns;
    document.querySelectorAll('[data-view-tab]').forEach(btn => {
        const on = btn.dataset.viewTab === view;
        btn.classList.toggle('is-active', on);
        if (on) btn.setAttribute('aria-current', 'page');
        else btn.removeAttribute('aria-current');
    });
    $('toolbar').hidden = view === 'about';
    $('table-view').hidden = !isTable;
    $('graph-view').hidden = view !== 'graph';
    $('about-view').hidden = view !== 'about';
    $('dock').hidden = view === 'about';
    document.querySelectorAll('[data-needs-table]').forEach(el => { el.hidden = !isTable; });
    $('search').placeholder = v.placeholder || '';
    $('search').value = state.search[view] || '';
    $('search-clear').hidden = !state.search[view];
    $('ability-toggle').hidden = !ADJ;
    $('ability-check').checked = state.adjusted;
    $('filters').innerHTML = v.filters ? v.filters() : '';
    placeSegThumb();
    document.title = `${v.title} — UCLA Major Difficulty`;
}

function render({ keepScroll = true } = {}) {
    renderChrome();
    renderNote();
    renderTray();
    renderIntro();
    if (VIEWS[state.view].columns) {
        renderTable({ keepScroll });
    } else if (state.view === 'graph') {
        updateGraphSearch();
        startGraph();
    }
    renderDock();
    syncGraphSelection();
}

function setView(view, { anchor } = {}) {
    if (!VIEWS[view]) return;
    if (view !== state.view) {
        state.view = view;
        // Keep the dock in step with what the new view is about
        state.trail = [];
        state.sel = null;
    }
    render({ keepScroll: false });
    freshBars();
    commit(true);
    if (anchor) $(anchor).scrollIntoView();
    else if (view === 'about') $('about-view').scrollTop = 0;
}

// ─── Shareable links ────────────────────────────────────────

function toHash() {
    const p = new URLSearchParams();
    const view = state.view;
    if (state.scope[view] && state.scope[view] !== 'all') p.set('filter', state.scope[view]);
    if (state.dept[view] && state.dept[view] !== 'all') p.set('dept', state.dept[view]);
    if (view === 'courses' && state.ge !== 'none') p.set('ge', state.ge);
    if (state.search[view]) p.set('q', state.search[view]);
    if (state.adjusted) p.set('adjusted', '1');
    if (state.sel) p.set('sel', selKey(state.sel));
    if (state.sel && state.sel.type === 'compare') p.set('compare', state.compare.join('|'));
    const query = p.toString();
    return view === 'majors' && !query ? '' : `#/${view}${query ? '?' + query : ''}`;
}

function commit(push = false) {
    const hash = toHash();
    if (hash === location.hash) return;
    try {
        history[push ? 'pushState' : 'replaceState'](null, '', location.pathname + location.search + hash);
    } catch {
        // Some browsers restrict history on file:// pages; the app still works
    }
}

function applyHash() {
    const m = location.hash.match(/^#\/([a-z]+)(?:\?(.*))?$/);
    const view = m && VIEWS[m[1]] ? m[1] : 'majors';
    const p = new URLSearchParams(m ? m[2] || '' : '');
    state.view = view;
    if (view in state.scope) {
        const options = { majors: MAJOR_SCOPES, departments: DEPT_SCOPES, courses: COURSE_LEVELS }[view];
        state.scope[view] = options[p.get('filter')] ? p.get('filter') : 'all';
    }
    if (view in state.dept) state.dept[view] = p.get('dept') || 'all';
    if (view === 'courses') state.ge = p.get('ge') || 'none';
    state.search[view] = p.get('q') || '';
    state.adjusted = !!ADJ && p.get('adjusted') === '1';
    if (p.get('compare')) {
        state.compare = p.get('compare').split('|').filter(id => majorById.has(id)).slice(0, MAX_COMPARE);
    }
    state.sel = parseSel(p.get('sel'));
    state.trail = [];
}

// ─── Export ─────────────────────────────────────────────────

function downloadCsv() {
    const v = VIEWS[state.view];
    if (!v.columns) return;
    const cols = v.columns.filter(c => c.csv);
    const cell = x => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const lines = [cols.map(c => cell(c.key === 'rank' ? 'Rank' : c.label)).join(',')];
    tableRows.forEach(r => lines.push(cols.map(c => cell(c.csv(r))).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ucla-${state.view}${state.adjusted ? '-adjusted' : ''}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Downloaded ${fmt(tableRows.length)} rows`, true);
}

// Turns an icon button into a check for a moment, then back
function flashDone(btn) {
    const use = btn.querySelector('use');
    const original = btn.dataset.icon || use.getAttribute('href');
    btn.dataset.icon = original;
    use.setAttribute('href', '#i-check');
    btn.classList.add('is-done');
    clearTimeout(btn.doneTimer);
    btn.doneTimer = setTimeout(() => {
        use.setAttribute('href', original);
        btn.classList.remove('is-done');
    }, 1400);
}

async function copyLink(btn) {
    try {
        await navigator.clipboard.writeText(location.href);
        flashDone(btn);
        toast('Link copied', true);
    } catch {
        toast('Could not copy. Copy the address from your browser instead.');
    }
}

// ─── Toast ──────────────────────────────────────────────────

let toastTimer = 0;

function toast(message, ok = false) {
    const el = $('toast');
    el.textContent = message;
    el.classList.toggle('is-ok', ok);
    el.classList.add('is-open');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-open'), 3200);
}

// ─── Tooltips ───────────────────────────────────────────────

const tip = { el: $('tip'), target: null, showTimer: 0, hideTimer: 0, warm: false };

function showTip(target) {
    const text = target.dataset.tip;
    if (!text) return;
    const el = tip.el;
    tip.target = target;
    const key = target.dataset.key ? ` <kbd>${esc(target.dataset.key)}</kbd>` : '';
    el.innerHTML = `${esc(text)}${key}`;
    el.classList.add('is-open');
    const r = target.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const below = r.bottom + 8 + h < innerHeight;
    el.style.left = `${left}px`;
    el.style.top = `${below ? r.bottom + 8 : r.top - h - 8}px`;
    tip.warm = true;
}

function hideTip() {
    tip.el.classList.remove('is-open');
    tip.target = null;
}

document.addEventListener('pointerover', e => {
    if (e.pointerType === 'touch') return;
    const target = e.target.closest('[data-tip]');
    if (!target || target === tip.target) {
        if (target) clearTimeout(tip.hideTimer);
        return;
    }
    clearTimeout(tip.hideTimer);
    clearTimeout(tip.showTimer);
    // A clipped cell only needs a tooltip when its text is actually cut off
    if (target.classList.contains('clip') && target.scrollWidth <= target.clientWidth) return;
    tip.showTimer = setTimeout(() => showTip(target), tip.warm ? 0 : 350);
});

document.addEventListener('pointerout', e => {
    if (e.pointerType === 'touch') return;
    const target = e.target.closest('[data-tip]');
    if (!target || (e.relatedTarget && target.contains(e.relatedTarget))) return;
    clearTimeout(tip.showTimer);
    clearTimeout(tip.hideTimer);
    tip.hideTimer = setTimeout(() => {
        hideTip();
        tip.warm = false;
    }, 180);
});

// ─── Events ─────────────────────────────────────────────────

document.addEventListener('click', e => {
    const info = e.target.closest('.info');
    if (info) {
        if (tip.target === info) hideTip();
        else showTip(info);
        return;
    }
    if (tip.target && tip.target.closest('.info')) hideTip();

    const tab = e.target.closest('[data-view-tab]');
    if (tab) return setView(tab.dataset.viewTab);

    const viewLink = e.target.closest('[data-view]');
    if (viewLink) {
        e.preventDefault();
        // The brand also brings back the introduction if it was hidden
        if (viewLink.classList.contains('brand')) saveStore({ introDismissed: false });
        return setView(viewLink.dataset.view, { anchor: viewLink.dataset.anchor });
    }

    const pin = e.target.closest('[data-pin]');
    if (pin) return togglePin(pin.dataset.pin);

    const go = e.target.closest('[data-go]');
    if (go) return select(parseSel(go.dataset.go), { fromDock: !!go.closest('#dock') });

    const jump = e.target.closest('[data-jump]');
    if (jump) {
        state.view = jump.dataset.jump;
        state.dept[state.view] = jump.dataset.dept;
        state.scope.courses = 'all';
        state.search[state.view] = '';
        state.sel = null;
        state.trail = [];
        render({ keepScroll: false });
        commit(true);
        return;
    }

    const act = e.target.closest('[data-act]');
    if (act) {
        const name = act.dataset.act;
        if (name === 'close') closeDetail();
        if (name === 'back') {
            const prev = state.trail[state.trail.length - 1];
            state.trail = state.trail.slice(0, -1);
            state.sel = prev;
            renderDock();
            markSelectedRow();
            commit();
        }
        if (name === 'clear-compare') {
            state.compare = [];
            saveStore({ compare: [] });
            closeDetail();
            renderTray();
            if (VIEWS[state.view].columns) renderTable({ keepScroll: true });
        }
        if (name === 'clear-search') clearSearch();
        if (name === 'clear-filters') clearFilters();
        if (name === 'dismiss-intro') setIntroOpen(false);
        if (name === 'show-intro') setIntroOpen(true);
        if (name === 'download') {
            downloadCsv();
            flashDone(act);
        }
        if (name === 'copy-link') copyLink(act);
    }
});

function clearSearch() {
    state.search[state.view] = '';
    $('search').value = '';
    $('search-clear').hidden = true;
    onSearchChange();
    $('search').focus();
}

function clearFilters() {
    const view = state.view;
    state.search[view] = '';
    if (view in state.scope) state.scope[view] = 'all';
    if (view in state.dept) state.dept[view] = 'all';
    if (view === 'courses') state.ge = 'none';
    render({ keepScroll: false });
    commit();
}

function onSearchChange() {
    if (VIEWS[state.view].columns) renderTable();
    else if (state.view === 'graph') updateGraphSearch();
    commit();
}

$('search').addEventListener('input', e => {
    state.search[state.view] = e.target.value;
    $('search-clear').hidden = !e.target.value;
    onSearchChange();
});

$('ability-check').addEventListener('change', e => toggleAbilityAdjustment(e.target.checked));

$('filters').addEventListener('click', e => {
    const btn = e.target.closest('[data-seg]');
    if (!btn) return;
    state.scope[state.view] = btn.dataset.value;
    btn.parentElement.querySelectorAll('[data-seg]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
    placeSegThumb();
    renderTable();
    freshBars();
    renderDock();
    commit();
});

$('filters').addEventListener('change', e => {
    const f = e.target.dataset.filter;
    if (f === 'dept') state.dept[state.view] = e.target.value;
    if (f === 'ge') state.ge = e.target.value;
    renderTable();
    freshBars();
    commit();
});

$('table-head').addEventListener('click', e => {
    const btn = e.target.closest('[data-sort]');
    if (!btn) return;
    const view = state.view;
    const sort = state.sort[view];
    const key = btn.dataset.sort;
    if (sort.key === key) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
    else state.sort[view] = { key, dir: 'asc' };
    renderTable();
});

$('table-body').addEventListener('click', e => {
    if (e.target.closest('[data-pin]')) return;
    const tr = e.target.closest('tr');
    if (tr) select({ type: VIEWS[state.view].selType, id: tr.dataset.id });
});

$('table-body').addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const tr = e.target.closest('tr');
    const next = tr && (e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling);
    if (!next) return;
    e.preventDefault();
    next.querySelector('.rowlink').focus();
    if (state.sel) {
        select({ type: VIEWS[state.view].selType, id: next.dataset.id }, { push: false });
    }
});

document.addEventListener('keydown', e => {
    const typing = e.target.matches('input:not([type="checkbox"]), select, textarea');
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !$('toolbar').hidden) {
        e.preventDefault();
        $('search').focus();
        $('search').select();
    }
    if (e.key === 'Escape') {
        hideTip();
        if (e.target === $('search') && e.target.value) clearSearch();
        else if (state.sel) closeDetail();
    }
});

$('scrim').addEventListener('click', closeDetail);

$('table-wrap').addEventListener('scroll', e => {
    const el = e.target;
    if (tableShown < tableRows.length && el.scrollHeight - el.scrollTop - el.clientHeight < 800) appendRows();
}, { passive: true });

window.addEventListener('popstate', () => {
    applyHash();
    render();
});

window.addEventListener('resize', placeSegThumb);

// ─── Bipartite Graph ─────────────────────────────────────────

const GRAPH_PAD_Y = 28;
const GRAPH_FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const INK = '#333333';
const DARK_BLUE = '#003B5C';

let graphNodes = [], graphEdges = [], graphNeighbors = new Map();
let graphScale = 1, graphOffsetX = 0, graphOffsetY = 0;
let graphW = 0, graphH = 0, graphMajorX = 0, graphSubjX = 0;
let graphInitialized = false, graphDirty = true, graphFrame = 0, graphTicks = 0;
let hoverNode = null, selectedNode = null, searchNode = null;
let dragNode = null, panning = false, pointerMoved = false, lastPointer = { x: 0, y: 0 };

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function buildGraph() {
    const majors = DATA.nodes.filter(n => n.type === 'major').sort((a, b) => a.rank - b.rank);
    const nodeMap = {};
    const place = (list, x, radius) => list.map((n, i) => {
        const y = GRAPH_PAD_Y + (i / Math.max(1, list.length - 1)) * (graphH - GRAPH_PAD_Y * 2);
        const node = { ...n, x: x + (Math.random() - 0.5) * 30, y, vx: 0, vy: 0, radius: radius(n) };
        nodeMap[n.id] = node;
        return node;
    });
    graphNodes = [
        ...place(majors, graphMajorX, () => 6),
        ...place(subjects, graphSubjX, n => Math.max(3, Math.min(8, (n.num_courses || 1) / 10))),
    ];
    graphEdges = DATA.edges.map(e => ({ source: nodeMap[e.source], target: nodeMap[e.target] })).filter(e => e.source && e.target);
    graphNeighbors = new Map(graphNodes.map(n => [n, new Set()]));
    graphEdges.forEach(e => {
        graphNeighbors.get(e.source).add(e.target);
        graphNeighbors.get(e.target).add(e.source);
    });
    graphTicks = 0;
    graphInitialized = true;
    // Settle most of the way first, so the graph never opens as a tangle
    const settled = reducedMotion() ? 400 : 160;
    while (graphTicks < settled) { graphTick(); graphTicks++; }
}

function sizeGraph() {
    const canvas = $('graph-canvas');
    const rect = canvas.parentElement.getBoundingClientRect();
    const W = Math.round(rect.width), H = Math.round(rect.height);
    if (W < 50 || H < 50) return false;
    if (W === graphW && H === graphH && graphInitialized) return true;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const scaleX = W / (graphW || W), scaleY = H / (graphH || H);
    graphW = W;
    graphH = H;
    const left = 16, right = W - 52;
    graphMajorX = left + (right - left) * 0.2;
    graphSubjX = left + (right - left) * 0.8;
    if (graphInitialized) {
        graphNodes.forEach(n => { n.x *= scaleX; n.y *= scaleY; });
    } else {
        buildGraph();
    }
    syncGraphSelection();
    updateGraphSearch();
    graphDirty = true;
    return true;
}

function graphTick() {
    const nodes = graphNodes;
    // Repulsion between nearby nodes
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i], b = nodes[j];
            const dx = b.x - a.x, dy = b.y - a.y;
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
        const force = (dist - graphW * 0.35) * 0.0005;
        e.source.vx += dx / dist * force;
        e.source.vy += dy / dist * force;
        e.target.vx -= dx / dist * force;
        e.target.vy -= dy / dist * force;
    });

    // Horizontal anchoring to maintain bipartite structure, then damped velocity
    nodes.forEach(n => {
        n.vx += ((n.type === 'major' ? graphMajorX : graphSubjX) - n.x) * 0.02;
        if (n === dragNode) return;
        n.vx *= 0.8; n.vy *= 0.8;
        n.x = Math.max(16, Math.min(graphW - 52, n.x + n.vx * 0.4));
        n.y = Math.max(GRAPH_PAD_Y, Math.min(graphH - GRAPH_PAD_Y, n.y + n.vy * 0.4));
    });
}

function renderGraph() {
    const canvas = $('graph-canvas');
    const ctx = canvas.getContext('2d');
    const dpr = canvas.width / graphW;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, graphW, graphH);
    ctx.save();
    ctx.translate(graphOffsetX, graphOffsetY);
    ctx.scale(graphScale, graphScale);

    // Column labels
    ctx.font = `700 11px ${GRAPH_FONT}`;
    ctx.fillStyle = '#5F6B76';
    ctx.textAlign = 'center';
    ctx.fillText('MAJORS', graphMajorX, 14);
    ctx.fillText('DEPARTMENTS', graphSubjX, 14);

    // Draw edges - highlight connected edges for the focused node
    const focus = hoverNode || searchNode || selectedNode;
    const near = focus ? graphNeighbors.get(focus) : null;
    const drawEdge = e => {
        const midX = (e.source.x + e.target.x) / 2;
        ctx.beginPath();
        ctx.moveTo(e.source.x, e.source.y);
        ctx.bezierCurveTo(midX, e.source.y, midX, e.target.y, e.target.x, e.target.y);
        ctx.stroke();
    };
    ctx.strokeStyle = focus ? 'rgba(39,116,174,0.05)' : 'rgba(39,116,174,0.12)';
    ctx.lineWidth = 0.5;
    graphEdges.forEach(e => { if (e.source !== focus && e.target !== focus) drawEdge(e); });
    if (focus) {
        ctx.strokeStyle = 'rgba(39,116,174,0.6)';
        ctx.lineWidth = 1.5;
        graphEdges.forEach(e => { if (e.source === focus || e.target === focus) drawEdge(e); });
    }

    // Draw nodes
    graphNodes.forEach(n => {
        const active = n === hoverNode || n === selectedNode || n === searchNode;
        const dim = focus && n !== focus && !near.has(n);
        ctx.globalAlpha = dim ? 0.3 : 1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, active ? n.radius + 3 : n.radius, 0, Math.PI * 2);
        ctx.fillStyle = (n.type === 'subject' && (n.num_courses || 0) === 0)
            ? '#9CA3AF'
            : gpaColor(adjustGpa(n.avg_gpa, n.ability_proxy));
        ctx.fill();
        ctx.strokeStyle = active ? DARK_BLUE : 'rgba(0,59,92,0.35)';
        ctx.lineWidth = active ? 2.5 : 0.75;
        ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // Draw labels only for the focused node and its neighbors
    if (focus) {
        ctx.font = `600 10px ${GRAPH_FONT}`;
        [focus, ...near].forEach(n => {
            const textWidth = ctx.measureText(n.label).width;
            const isMajor = n.type === 'major';
            const textX = isMajor ? n.x - n.radius - 8 : n.x + n.radius + 8;
            ctx.textAlign = isMajor ? 'right' : 'left';
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fillRect(isMajor ? textX - textWidth - 3 : textX - 3, n.y - 8, textWidth + 6, 15);
            ctx.fillStyle = n === focus ? DARK_BLUE : INK;
            ctx.fillText(n.label, textX, n.y + 3.5);
        });
    }
    ctx.restore();
}

function graphLoop() {
    if (state.view !== 'graph') {
        graphFrame = 0;
        return;
    }
    if (graphTicks < 400) {
        graphTick();
        graphTicks++;
        graphDirty = true;
    }
    if (graphDirty) {
        renderGraph();
        graphDirty = false;
    }
    graphFrame = requestAnimationFrame(graphLoop);
}

function startGraph() {
    if (!sizeGraph()) {
        requestAnimationFrame(startGraph);
        return;
    }
    graphDirty = true;
    if (!graphFrame) graphFrame = requestAnimationFrame(graphLoop);
}

function syncGraphSelection() {
    const sel = state.sel;
    const id = sel && sel.type === 'major' ? `major_${sel.id}` : sel && sel.type === 'dept' ? `subj_${sel.id}` : null;
    selectedNode = id ? graphNodes.find(n => n.id === id) || null : null;
    graphDirty = true;
}

function updateGraphSearch() {
    if (state.view !== 'graph') return;
    const q = (state.search.graph || '').trim();
    const hits = q ? graphNodes.filter(n => matchesQuery(n.label, q)) : [];
    searchNode = hits[0] || null;
    setCount(q ? (hits.length === 1 ? '1 match' : `${hits.length} matches`) : `${DATA.rankings.length} majors, ${subjects.length} departments`);
    graphDirty = true;
    showNodeTip(searchNode);
}

function graphPoint(e) {
    const r = $('graph-canvas').getBoundingClientRect();
    return { x: (e.clientX - r.left - graphOffsetX) / graphScale, y: (e.clientY - r.top - graphOffsetY) / graphScale };
}

const nodeAt = p => graphNodes.find(n => Math.hypot(n.x - p.x, n.y - p.y) < n.radius + 5) || null;

function showNodeTip(node, e) {
    const el = $('graph-tip');
    if (!node) {
        el.classList.remove('is-open');
        return;
    }
    const gpa = adjustGpa(node.avg_gpa, node.ability_proxy);
    const noData = node.type === 'subject' && !node.num_courses;
    el.innerHTML = `<b>${esc(node.label)}</b>${noData ? '<span>No grade data</span>' : `<span>GPA ${gpa.toFixed(2)}${state.adjusted ? ' (adjusted)' : ''}, ${fmt(node.num_courses)} courses</span>`}`;
    el.classList.add('is-open');
    const rect = $('graph-canvas').getBoundingClientRect();
    const x = e ? e.clientX : rect.left + node.x * graphScale + graphOffsetX;
    const y = e ? e.clientY : rect.top + node.y * graphScale + graphOffsetY;
    el.style.left = `${Math.min(x + 16, innerWidth - el.offsetWidth - 8)}px`;
    el.style.top = `${Math.max(8, Math.min(y - 10, innerHeight - el.offsetHeight - 8))}px`;
}

function zoomGraph(f) {
    const cx = graphW / 2, cy = graphH / 2;
    graphOffsetX = cx - (cx - graphOffsetX) * f;
    graphOffsetY = cy - (cy - graphOffsetY) * f;
    graphScale *= f;
    graphDirty = true;
}

function resetGraph() {
    graphScale = 1;
    graphOffsetX = 0;
    graphOffsetY = 0;
    buildGraph();
    syncGraphSelection();
    updateGraphSearch();
    graphDirty = true;
}

(function initGraphEvents() {
    const canvas = $('graph-canvas');
    canvas.addEventListener('pointerdown', e => {
        canvas.setPointerCapture(e.pointerId);
        dragNode = nodeAt(graphPoint(e));
        panning = !dragNode;
        pointerMoved = false;
        lastPointer = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointermove', e => {
        if (Math.hypot(e.clientX - lastPointer.x, e.clientY - lastPointer.y) > 3 && (dragNode || panning)) pointerMoved = true;
        if (dragNode) {
            const p = graphPoint(e);
            dragNode.x = p.x;
            dragNode.y = p.y;
            graphDirty = true;
        } else if (panning) {
            graphOffsetX += e.clientX - lastPointer.x;
            graphOffsetY += e.clientY - lastPointer.y;
            lastPointer = { x: e.clientX, y: e.clientY };
            graphDirty = true;
        }
        const hover = dragNode || nodeAt(graphPoint(e));
        if (hover !== hoverNode) graphDirty = true;
        hoverNode = hover;
        canvas.style.cursor = hover ? 'pointer' : 'grab';
        if (hover) showNodeTip(hover, e);
        else showNodeTip(searchNode);
    });
    canvas.addEventListener('pointerup', e => {
        const clicked = !pointerMoved ? nodeAt(graphPoint(e)) : null;
        dragNode = null;
        panning = false;
        if (clicked) {
            if (clicked.type === 'major') select({ type: 'major', id: clicked.label });
            else select({ type: 'dept', id: clicked.label });
        }
    });
    canvas.addEventListener('pointerleave', () => {
        hoverNode = null;
        graphDirty = true;
        showNodeTip(searchNode);
    });
    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        const factor = e.deltaY > 0 ? 0.95 : 1.05;
        const gx = (e.clientX - r.left - graphOffsetX) / graphScale;
        const gy = (e.clientY - r.top - graphOffsetY) / graphScale;
        graphScale *= factor;
        graphOffsetX = e.clientX - r.left - gx * graphScale;
        graphOffsetY = e.clientY - r.top - gy * graphScale;
        graphDirty = true;
        showNodeTip(null);
    }, { passive: false });
    new ResizeObserver(() => { if (state.view === 'graph') startGraph(); }).observe(canvas.parentElement);
    document.querySelector('[data-graph="in"]').addEventListener('click', () => zoomGraph(1.2));
    document.querySelector('[data-graph="out"]').addEventListener('click', () => zoomGraph(0.8));
    document.querySelector('[data-graph="reset"]').addEventListener('click', resetGraph);
})();

// ─── Start ──────────────────────────────────────────────────

applyHash();
// The graph needs a wide screen; send a shared graph link to Majors on phones
if (state.view === 'graph' && matchMedia('(max-width: 768px)').matches) state.view = 'majors';
render({ keepScroll: false });
freshBars();
revealSelectedRow();
