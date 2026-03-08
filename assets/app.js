/* ============================================================
   UCLA Major Difficulty Analysis — Application Logic
   ============================================================ */

// DATA is injected by the Python script as a global variable
// in a <script> tag before this file is loaded.

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

// ─── Winner banner ───────────────────────────────────────────

const winner = DATA.rankings[0];
document.getElementById('winner-name').textContent = winner.major;
document.getElementById('winner-detail').textContent =
    `Avg GPA: ${winner.avg_gpa.toFixed(3)}  |  ${winner.pct_A.toFixed(1)}% A/A+ grades  |  Based on ${winner.num_courses} required courses and ${winner.total_students.toLocaleString()} grade records in this dataset`;

// ─── Rankings (with filter modes) ────────────────────────────

let currentFilter = 'all';

function setFilter(mode) {
    currentFilter = mode;
    document.querySelectorAll('.filter-bar button').forEach(b => b.classList.remove('active-filter'));
    document.getElementById('filter-' + mode.replace('_', '-')).classList.add('active-filter');
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
        return { ...r, _gpa: gpa, _pctA: pctA, _students: students, _courses: courses };
    }).filter(r => r._gpa != null);

    items.sort((a, b) => a._gpa - b._gpa);

    const tbody = document.getElementById('rankings-body');
    let html = '';
    items.forEach((r, idx) => {
        const rank = idx + 1;
        const badgeClass = rank <= 3 ? `rank-${rank}` : 'rank-default';
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

// ─── Course Deep Dive ────────────────────────────────────────

let courseSortDir = 'asc';
const allCourses = DATA.all_courses_sorted;

function setSortDir(dir) {
    courseSortDir = dir;
    document.getElementById('sort-hard').classList.toggle('active-sort', dir === 'asc');
    document.getElementById('sort-easy').classList.toggle('active-sort', dir === 'desc');
    renderCourseTable();
}

function renderCourseTable() {
    const sel = document.getElementById('course-count').value;
    const limit = sel === 'all' ? allCourses.length : parseInt(sel);
    const sorted = courseSortDir === 'asc' ? allCourses : [...allCourses].reverse();
    const sliced = sorted.slice(0, Math.min(limit, sorted.length));
    const tbody = document.getElementById('courses-tbody');
    let html = '';
    sliced.forEach((c, i) => {
        const color = gpaColor(c.avg_gpa);
        const hasGradeData = (c.total_letter_grades || 0) > 0;
        const href = hasGradeData && c.uclagrades_url ? c.uclagrades_url : (c.catalog_url || '');
        const cellContent = href
            ? `<a href="${href}" target="_blank" rel="noopener noreferrer" class="course-link">${c.course_id}</a>`
            : c.course_id;
        html += `<tr>
            <td style="color:var(--text-muted);font-weight:700;font-size:0.78rem">${i + 1}</td>
            <td class="course-code-cell">${cellContent}</td>
            <td style="color:var(--text-secondary);max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.course_title || ''}</td>
            <td class="gpa-cell" style="color:${color}">${c.avg_gpa.toFixed(3)}</td>
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

            const fillColor = (n.type === 'subject' && (n.num_courses || 0) === 0)
                ? '#9CA3AF'
                : majorNodeColor(n.avg_gpa);
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
            let html = `<div style="font-weight:700;font-size:1rem;margin-bottom:6px;color:var(--ucla-dark-blue)">${hover.label}</div>`;
            html += hover.type === 'major'
                ? `<div style="color:${gpaColor(hover.avg_gpa)}">GPA: ${hover.avg_gpa.toFixed(3)} | ${hover.pct_A.toFixed(1)}% A/A+</div><div style="color:var(--text-muted);margin-top:4px">Rank #${hover.rank} | ${hover.num_courses} courses</div>`
                : `<div style="color:var(--ucla-blue)">Dept GPA: ${hover.avg_gpa.toFixed(3)} | ${hover.num_courses} courses</div>`;
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
