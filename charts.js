/* Cadence — Chart builder + Board: drag fields onto X axis / Values / Split by and pick a chart type.
   Works with mouse, pen and touch. On touch you can also tap a field, then tap where it goes.
   Saved charts are laid out on dashboards, which sync with the account (state.board in the store).
   The chart you're building (the draft) stays in this browser. */
(function () {
  const C = window.Cadence;
  const { D, esc, icon } = C;
  const S = () => C.store;
  const LS_DRAFT = 'cadence.chart.draft';
  const DAY = 864e5;

  /* ---------- fields ---------- */
  const PALETTE = ['var(--accent)', '#E8743B', '#19A979', '#945ECF', '#ED4A7B', '#13A4B4', '#C9A100', '#6C8893', '#2F6497', '#BF399E'];
  const statusOf = (t, tk) => (t.done ? 'Done' : t.due && t.due < tk ? 'Overdue' : 'Open');
  const doneKey = (t) => (t.done && t.doneAt ? D.key(new Date(t.doneAt)) : null);
  // people: "Me" is whoever is signed in; tasks without an owner are yours (made before sign-in)
  const isMe = (uid) => !uid || uid === S().state.owner;
  const owner = (t) => (isMe(t.ownerId) ? 'Me' : C.firstName(t.ownerName, t.ownerEmail));
  const shared = (t) => !!(t.assigneeId && t.assigneeId !== t.ownerId);
  const doer = (t) => (shared(t) ? (isMe(t.assigneeId) ? 'Me' : C.firstName(t.assigneeName, t.assigneeEmail)) : owner(t));
  const meFirst = () => ['Me'];
  const personColor = (v) => (v === 'Me' ? 'var(--accent)' : null);
  C.handoffLabel = (t) => (shared(t) ? owner(t) + ' → ' + doer(t) : '');

  const seen = {};
  const DIMS = {
    // tasks from other people carry the owner's type/importance; colors for names you don't have come from those
    type: { label: 'Type', ic: 'briefcase', get: (t) => { const ty = S().typeOf(t); if (ty) seen[ty.name] = ty.color; return ty ? ty.name : 'No type'; },
      order: () => S().state.types.map((x) => x.name).concat('No type'), color: (v) => { const ty = S().state.types.find((x) => x.name === v); return ty ? ty.color : seen[v] || 'var(--ink-3)'; } },
    level: { label: 'Importance', ic: 'flag', get: (t) => { const l = S().levelOf(t); if (l) seen['lv:' + l.name] = l.color; return l ? l.name : 'None'; },
      order: () => S().state.levels.map((x) => x.name).concat('None'), color: (v) => { const l = S().state.levels.find((x) => x.name === v); return l ? l.color : seen['lv:' + v] || 'var(--ink-3)'; } },
    status: { label: 'Status', ic: 'check', get: (t, c) => statusOf(t, c.tk), order: () => ['Open', 'Overdue', 'Done'],
      color: (v) => ({ Open: 'var(--accent)', Overdue: 'var(--danger)', Done: 'var(--ok)' }[v]) },
    due: { label: 'Due date', words: 'due date', ic: 'calendar', time: true, get: (t) => t.due || null },
    created: { label: 'Created', words: 'date added', ic: 'plus', time: true, get: (t) => (t.createdAt ? D.key(new Date(t.createdAt)) : null) },
    completed: { label: 'Completed', words: 'completion date', ic: 'check', time: true, get: (t) => doneKey(t) },
    weekday: { label: 'Due weekday', ic: 'calendar', get: (t) => (t.due ? C.F.wday.format(D.parse(t.due)) : null),
      order: () => { const s = D.startOfWeek(D.today(), S().state.prefs.weekStart); return [0, 1, 2, 3, 4, 5, 6].map((i) => C.F.wday.format(D.add(s, i))); } },
    tod: { label: 'Time of day', ic: 'clock', get: (t) => { if (!t.time) return 'No time'; const h = +t.time.slice(0, 2); return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'; },
      order: () => ['Morning', 'Afternoon', 'Evening', 'No time'] },
    who: { label: 'Assigned to', words: 'assignee', ic: 'heart', get: (t) => doer(t), order: meFirst, color: personColor },
    by: { label: 'Assigned by', words: 'who assigned it', ic: 'upload', get: (t) => owner(t), order: meFirst, color: personColor },
    handoff: { label: 'Handoff', words: 'handoff', ic: 'repeat', get: (t) => (shared(t) ? owner(t) + ' → ' + doer(t) : 'Not shared'), order: () => ['Not shared'], color: (v) => (v === 'Not shared' ? 'var(--ink-3)' : null) },
    moves: { label: 'Rescheduled', words: 'how often it was rescheduled', ic: 'repeat', get: (t) => { const m = t.moved || 0; return !t.due && !m ? null : m === 0 ? 'Never' : m === 1 ? 'Once' : m <= 3 ? '2–3 times' : '4+ times'; },
      order: () => ['Never', 'Once', '2–3 times', '4+ times'], color: (v) => ({ Never: 'var(--ok)', Once: 'var(--accent)', '2–3 times': '#E8743B', '4+ times': 'var(--danger)' }[v]) },
    repeat: { label: 'Repeat', ic: 'repeat', get: (t) => (C.REPEATS.find((r) => r.id === (t.repeat || 'none')) || C.REPEATS[0]).label, order: () => C.REPEATS.map((r) => r.label) }
  };
  /* map fields: only my own tasks link to my map */
  const OFF_MAP = 'Not on the map';
  const nodeInfo = (t, c) => (t.nodeId && c && c.map && S().isOwner(t) ? c.map.get(t.nodeId) || null : null);
  const mapOrder = (key) => () => { const c = mapCtx(); return c ? c.order[key].concat(OFF_MAP) : [OFF_MAP]; };
  const mapColor = (key) => (v) => { const c = mapCtx(); return v === OFF_MAP ? 'var(--line-strong)' : (c && c.colors[key][v]) || null; };
  Object.assign(DIMS, {
    cluster: { label: 'Map cluster', words: 'map cluster', ic: 'cluster', map: true, get: (t, c) => { const i = nodeInfo(t, c); return i ? i.cluster : OFF_MAP; }, order: mapOrder('cluster'), color: mapColor('cluster') },
    branch: { label: 'Map branch', words: 'map branch', ic: 'outline', map: true, get: (t, c) => { const i = nodeInfo(t, c); return i ? i.branch : OFF_MAP; }, order: mapOrder('branch'), color: mapColor('branch') },
    node: { label: 'Map node', words: 'map node', ic: 'node', map: true, get: (t, c) => { const i = nodeInfo(t, c); return i ? i.title : OFF_MAP; }, order: mapOrder('node'), color: mapColor('node') },
    depth: { label: 'Map depth', words: 'depth on the map', ic: 'fold', map: true, get: (t, c) => { const i = nodeInfo(t, c); return i ? i.depthLabel : OFF_MAP; }, order: mapOrder('depth') }
  });
  /* per-render facts about every node: display title (made unique), cluster, branch, depth */
  let mapCache = null;
  function mapCtx() {
    const m = C.map;
    if (!m || !m.nodes().length) return null;
    const rev = m.rev();
    if (mapCache && mapCache.rev === rev) return mapCache;
    const root = m.primaryRoot();
    const clusters = m.clusters().sort((a, b) => b.count - a.count);
    const clName = new Map(clusters.map((c) => [c.color, c.name]));
    const count = {};
    m.nodes().forEach((n) => { const t = m.title(n) || 'Untitled'; count[t] = (count[t] || 0) + 1; });
    const label = (n) => { const t = m.title(n) || 'Untitled'; if (count[t] < 2) return t; const p = m.getNode(m.parentId(n.id)); return t + ' · ' + (p ? m.title(p) : 'top level'); };
    const info = new Map(), order = { cluster: [], branch: [], node: [], depth: [] }, colors = { cluster: {}, branch: {}, node: {} };
    m.nodes().forEach((n) => {
      const path = [n.id]; const seen = new Set([n.id]);
      let p = m.parentId(n.id);
      while (p && !seen.has(p)) { path.push(p); seen.add(p); p = m.parentId(p); }
      const top = path[path.length - 1];
      let depth, branchId;
      if (root && top === root.id) { depth = path.length - 1; branchId = path.length >= 2 ? path[path.length - 2] : root.id; }
      else { depth = path.length; branchId = top; }
      const bn = m.getNode(branchId);
      const i = { title: label(n), cluster: clName.get(n.color || 'gray') || m.colorName(n.color), branch: label(bn), depth, depthLabel: depth === 0 ? 'Root' : 'Level ' + depth, hex: m.colorHex(n.color) };
      info.set(n.id, i);
      colors.cluster[i.cluster] = m.colorHex(n.color); colors.branch[i.branch] = m.colorHex(bn.color); colors.node[i.title] = i.hex;
    });
    order.cluster = clusters.map((c) => c.name);
    const bOrder = []; const add = (id) => { const i = info.get(id); if (i && !bOrder.includes(i.branch)) bOrder.push(i.branch); };
    if (root) { add(root.id); m.childIds(root.id).forEach(add); }
    m.nodes().forEach((n) => add(n.id));
    order.branch = bOrder;
    order.node = m.nodes().map((n) => info.get(n.id).title);
    order.depth = ['Root'].concat([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => 'Level ' + d));
    mapCache = { rev, get: (id) => info.get(id), order, colors, root };
    return mapCache;
  }

  const NUMS = {
    count: { label: 'Tasks', ic: 'list', get: () => 1, aggs: ['count'], unit: '' },
    steps: { label: 'Checklist steps', ic: 'rows', get: (t) => (t.subtasks || []).length, aggs: ['sum', 'avg'], unit: '' },
    toDone: { label: 'Days to complete', ic: 'clock', get: (t) => (t.done && t.doneAt && t.createdAt ? Math.max(0, (t.doneAt - t.createdAt) / DAY) : null), aggs: ['avg', 'sum'], unit: 'd' },
    late: { label: 'Days late', ic: 'flag', get: (t, c) => { if (!t.due) return null; const k = t.done ? doneKey(t) : (t.due < c.tk ? c.tk : null); return k ? D.diff(k, t.due) : null; }, aggs: ['avg', 'sum'], unit: 'd' },
    age: { label: 'Age (days)', ic: 'sparkle', get: (t, c) => (t.createdAt ? Math.max(0, (c.now - t.createdAt) / DAY) : null), aggs: ['avg', 'sum'], unit: 'd' },
    // counted from v19 on: each move of a set due date, and the days it moved later
    moved: { label: 'Times rescheduled', ic: 'repeat', get: (t) => (t.due || t.moved ? t.moved || 0 : null), aggs: ['sum', 'avg'], unit: '' },
    pushed: { label: 'Days pushed back', ic: 'calendar', get: (t) => (t.due || t.pushed ? t.pushed || 0 : null), aggs: ['sum', 'avg'], unit: 'd' },
    onTime: { label: '% on time', ic: 'star', get: (t) => { const k = doneKey(t); return k && t.due ? (k <= t.due ? 100 : 0) : null; }, aggs: ['avg'], unit: '%' }
  };
  const field = (id) => DIMS[id] || NUMS[id];
  const isNum = (id) => !!NUMS[id];

  const TYPES = [
    ['column', 'Column', '<rect x="4" y="11" width="4" height="9" rx="1"/><rect x="10" y="6" width="4" height="14" rx="1"/><rect x="16" y="9" width="4" height="11" rx="1"/>'],
    ['bar', 'Bar', '<rect x="4" y="4" width="10" height="4" rx="1"/><rect x="4" y="10" width="16" height="4" rx="1"/><rect x="4" y="16" width="7" height="4" rx="1"/>'],
    ['line', 'Line', '<path d="M3.5 17 9 11l4 3.5L20.5 6"/>'],
    ['area', 'Area', '<path d="M3.5 19.5V15L9 10l4 3 7.5-6.5v13z" fill="currentColor" fill-opacity=".3"/><path d="M3.5 15 9 10l4 3 7.5-6.5"/>'],
    ['pie', 'Pie', '<circle cx="12" cy="12" r="8"/><path d="M12 4v8l6.5 4.6"/>'],
    ['donut', 'Donut', '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 4v4.5"/>'],
    ['burnup', 'Burn-up', '<path d="M3.5 19 9 14l4 2 7.5-9"/><path d="M3.5 19 9 16.5l4 .5 7.5-4" stroke-dasharray="2 2.5"/>'],
    ['cfd', 'Flow', '<path d="M3.5 20.5V14c4-1 6-3 9-3s5 1 8-2v11.5z" fill="currentColor" fill-opacity=".18"/><path d="M3.5 20.5V17c4-.5 6-1.5 9-1.5s5 .5 8-1.5v6.5z" fill="currentColor" fill-opacity=".38"/>'],
    ['table', 'Table', '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9h17M3.5 13.5h17M9.5 9v10.5"/>'],
    ['treemap', 'Treemap', '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M11 4.5v15M11 12.5h9.5M16 12.5v7"/>'],
    ['handoff', 'Handoffs', '<path d="M3.5 6.5h3c5.5 0 5.5 11 11 11h3M3.5 17.5h3c5.5 0 5.5-11 11-11h3"/>'],
    ['sunburst', 'Sunburst', '<circle cx="12" cy="12" r="3"/><path d="M12 4.5a7.5 7.5 0 0 1 7.5 7.5M19.5 12a7.5 7.5 0 0 1-11 6.6M8.5 18.6A7.5 7.5 0 0 1 12 4.5"/><path d="M12 1.5v3M22.5 12h-3"/>'],
    ['kpi', 'KPI', '<rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="M7 15l3-3 2.5 2L17 9.5"/>'],
    ['scatter', 'Scatter', '<circle cx="7" cy="16" r="1.6"/><circle cx="10" cy="10" r="1.6"/><circle cx="14.5" cy="13" r="1.6"/><circle cx="17" cy="7" r="1.6"/><circle cx="18.5" cy="15.5" r="1.6"/><path d="M3.5 3.5v17h17"/>']
  ];
  const typeSvg = (p) => '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';

  const PRESETS = [
    { name: 'Open tasks by type', cfg: { type: 'donut', x: 'type', y: 'count', series: null, status: 'open' } },
    { name: 'Completed per week', cfg: { type: 'column', x: 'completed', y: 'count', series: null, status: 'done', range: '12w' } },
    { name: 'Status by importance', cfg: { type: 'bar', x: 'level', y: 'count', series: 'status', stack: true } },
    { name: 'On-time rate by type', cfg: { type: 'column', x: 'type', y: 'onTime', status: 'done' } },
    { name: 'Effort vs. speed', cfg: { type: 'scatter', x: 'steps', y: 'toDone', series: 'type', status: 'done' } },
    { name: 'Open tasks across the map', map: true, cfg: { type: 'sunburst', x: null, y: 'count', series: null, status: 'open' } },
    { name: 'Overdue by map branch', map: true, cfg: { type: 'bar', x: 'branch', y: 'late', agg: 'avg', series: null, status: 'open' } },
    { name: 'Done this week vs. goal', cfg: { type: 'kpi', x: 'completed', y: 'count', series: null, status: 'done', goal: 10, goalDir: 'atLeast', kpiPeriod: 'week' } },
    { name: 'Overdue right now', cfg: { type: 'kpi', x: null, y: 'count', series: null, status: 'overdue', goal: 0, goalDir: 'atMost', kpiPeriod: 'all' } },
    { name: 'Is my list growing?', cfg: { type: 'burnup', x: null, y: 'count', series: null, range: '12w' } },
    { name: 'Open vs. overdue over time', cfg: { type: 'cfd', x: null, y: 'count', series: null, range: '12w' } },
    { name: 'This month vs. last', cfg: { type: 'column', x: 'type', y: 'count', series: null, status: 'done', range: '4w', compare: true } },
    { name: 'Weekly completions vs. goal', cfg: { type: 'column', x: 'completed', y: 'count', series: null, status: 'done', range: '12w', goal: 5, goalDir: 'atLeast' } },
    { name: 'List: overdue tasks', cfg: { type: 'table', x: null, status: 'overdue', cols: ['due', 'late', 'type', 'level', 'who'], sort: { k: 'late', d: -1 } } },
    { name: 'List: due in the next 7 days', cfg: { type: 'table', x: 'type', status: 'open', f: { due: 'week' }, cols: ['due', 'level', 'branch', 'steps'], sort: { k: 'due', d: 1 } } },
    { name: 'List: most rescheduled', cfg: { type: 'table', x: null, status: 'open', cols: ['moved', 'pushed', 'due', 'type'], sort: { k: 'moved', d: -1 }, limit: '10' } },
    { name: 'How often open tasks get moved', cfg: { type: 'column', x: 'moves', y: 'count', series: null, status: 'open' } },
    { name: 'What I keep pushing back', cfg: { type: 'bar', x: 'type', y: 'pushed', agg: 'avg', series: null, status: 'open' } },
    { name: 'Does rescheduling make tasks late?', cfg: { type: 'scatter', x: 'moved', y: 'late', series: 'type', status: 'all' } },
    { name: 'Where my open work sits', cfg: { type: 'treemap', x: 'type', y: 'count', series: 'level', status: 'open' } },
    { name: 'Who hands work to whom', cfg: { type: 'handoff', x: null, y: 'count', series: null, status: 'all', selfToo: false } }
  ];
  const BLANK = { type: 'column', x: null, y: 'count', agg: 'count', series: null, stack: true, status: 'all', range: 'all', grain: 'auto', title: '', goal: null, goalDir: 'atLeast', kpiPeriod: 'all', compare: false, trend: 'none', f: null, cols: null, sort: null, limit: '25' };
  const FLOW_TYPES = ['burnup', 'cfd'];
  const FIXED_TYPES = ['burnup', 'cfd', 'handoff']; // these always count tasks and need no fields
  /* table: one row per task. Title always comes first; these can be added as columns */
  const DEFAULT_COLS = ['due', 'type', 'level', 'status'];
  const EXTRA_COLS = { time: { label: 'Time', ic: 'clock' }, notes: { label: 'Notes', ic: 'note' } };
  const colField = (id) => EXTRA_COLS[id] || DIMS[id] || NUMS[id];
  const tCols = () => (Array.isArray(cfg.cols) ? cfg.cols.filter((c) => colField(c) && c !== 'count') : DEFAULT_COLS);
  const RANGE_DAYS = { '4w': 28, '12w': 84, '6m': 183, '1y': 365 };
  const RANGE_WORDS = { '4w': '4 weeks', '12w': '12 weeks', '6m': '6 months', '1y': 'year' };
  let rangeOverride = null; // the Board's "same dates for every chart"
  const curRange = () => rangeOverride || cfg.range;
  const flt = () => cfg.f || {};
  const canCompare = () => ['column', 'bar', 'line', 'area'].includes(cfg.type) && !!RANGE_DAYS[curRange()] && !cfg.series;
  const canTrend = () => ['column', 'line', 'area'].includes(cfg.type) && cfg.x && DIMS[cfg.x] && DIMS[cfg.x].time && !cfg.series;
  const GOAL_TYPES = ['column', 'bar', 'line', 'area', 'kpi'];
  const LOWER_IS_BETTER = ['late', 'age', 'toDone', 'moved', 'pushed'];
  const hasGoal = () => GOAL_TYPES.includes(cfg.type) && cfg.goal != null && cfg.goal !== '' && isFinite(cfg.goal);
  const meets = (v) => (cfg.goalDir === 'atMost' ? v <= +cfg.goal : v >= +cfg.goal);

  /* ---------- state ---------- */
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } };
  let cfg = Object.assign({}, BLANK, load(LS_DRAFT, { x: 'type', series: 'status' }));
  let board = [];
  const syncBoard = () => { board = S().state.board.charts; };
  const saveBoard = () => S().setBoard(board.slice());
  const ui = { picked: null, flash: null, flashZone: null, solo: null, zoom: null };
  /* what's being looked at right now: one legend entry on its own, and a zoomed date range.
     These are views, not settings, so they aren't saved with the chart. */
  let solo = null, zoom = null;
  const cardUi = {}; // the same per Board card, by chart id
  const cardView = (id) => (cardUi[id] = cardUi[id] || { solo: null, zoom: null });
  let el = null;

  const view = (C.views = C.views || {}).charts = {
    title: 'Chart builder',
    mount(root) {
      el = root;
      root.innerHTML = '<section class="page cb-page"><header class="page-head"><p class="eyebrow"><a href="#insights" class="cb-back">' + icon('chevL') + 'Insights</a></p><h1 class="display">Chart builder</h1>' +
        '<p class="muted cb-lede">Drag fields onto the chart, or tap a field and then tap where it goes. Pick any chart type and save the ones you like to your board.</p></header><div id="cb-root"></div></section>';
      root.addEventListener('click', onClick);
      root.addEventListener('change', onChange);
      root.addEventListener('submit', (e) => { if (e.target.closest('[data-ask]')) { e.preventDefault(); const i = el.querySelector('#cb-ask'); runAsk(i && i.value); } });
      root.addEventListener('input', (e) => { if (e.target.id === 'cb-ask') { ui.askText = e.target.value; if (ui.askNote && !e.target.value) { ui.askNote = null; } } });
      root.addEventListener('pointerdown', onDown);
      root.addEventListener('pointerdown', (e) => zoomDown(e, (i0, i1) => { solo = ui.solo; zoom = ui.zoom; const k = zoomKeys(i0, i1); if (k) { ui.zoom = k; render(); } }));
      root.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') showTip(e.target); });
      root.addEventListener('focusin', (e) => showTip(e.target));
      root.addEventListener('keydown', (e) => {
        if (e.target.matches && e.target.matches('[data-trow]') && e.key === 'Enter') { e.preventDefault(); return C.openEditor(e.target.dataset.trow); }
        if (e.target.matches && e.target.matches('[data-clear]') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); return e.target.click(); }
        const z = e.target.closest('[data-zone]');
        if (z && (e.key === 'Enter' || e.key === ' ') && e.target === z) { e.preventDefault(); z.click(); }
        if (e.key === 'Escape' && ui.picked) { ui.picked = null; render(); }
        if (e.target.id === 'cb-title' && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
      });
      render();
    },
    update() { if (el && !drag) render(); },
    unmount() { el = null; ui.picked = null; }
  };

  const VIEW_KEYS = ['type', 'x', 'series', 'y', 'agg', 'status', 'range', 'grain', 'f', 'selfToo'];
  function setCfg(patch) {
    if (VIEW_KEYS.some((k) => k in patch && patch[k] !== cfg[k])) { ui.solo = null; ui.zoom = null; }
    ui.askNote = null;
    Object.assign(cfg, patch);
    // keep the summary (count / sum / average) valid for the value field
    const y = NUMS[cfg.y];
    if (y && !y.aggs.includes(cfg.agg)) cfg.agg = y.aggs[0];
    keep(LS_DRAFT, cfg);
    render();
  }

  /* ---------- data ---------- */
  const DUE_WINDOWS = [['overdue', 'Due: overdue'], ['today', 'Due: today'], ['week', 'Due: next 7 days'], ['month', 'Due: next 30 days'], ['dated', 'Due: has a date'], ['none', 'Due: no date']];
  function dueOk(t, w, tk) {
    if (w === 'none') return !t.due;
    if (!t.due) return false;
    if (w === 'dated') return true;
    if (w === 'overdue') return !t.done && t.due < tk;
    if (w === 'today') return t.due === tk;
    return t.due >= tk && t.due <= D.addKey(tk, w === 'week' ? 6 : 29);
  }
  function rows(opts) {
    const tk = D.todayKey(), now = Date.now();
    const ctx = { tk, now, map: mapCtx() };
    let list = S().state.tasks.filter((t) => !t.sample);
    const f = flt();
    if (f.text) { const q = String(f.text).toLowerCase(); list = list.filter((t) => (t.title || '').toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q)); }
    if (f.due) list = list.filter((t) => dueOk(t, f.due, tk));
    if (f.type) list = list.filter((t) => (S().typeOf(t) || {}).name === f.type);
    if (f.level) list = list.filter((t) => (S().levelOf(t) || {}).name === f.level);
    if (f.cluster) list = list.filter((t) => DIMS.cluster.get(t, ctx) === f.cluster);
    if (f.branch) list = list.filter((t) => DIMS.branch.get(t, ctx) === f.branch);
    if (f.who) list = list.filter((t) => doer(t) === f.who);
    if (opts && opts.all) return { list, ctx };
    if (cfg.status === 'open') list = list.filter((t) => !t.done);
    else if (cfg.status === 'done') list = list.filter((t) => t.done);
    else if (cfg.status === 'overdue') list = list.filter((t) => !t.done && t.due && t.due < tk);
    const days = RANGE_DAYS[curRange()];
    if (days) {
      // the previous period is the same length, just before this one
      const to = opts && opts.prev ? now - days * DAY : now + DAY, from = (opts && opts.prev ? now - 2 * days * DAY : now - days * DAY);
      const fk = D.key(new Date(from)), tkk = D.key(new Date(to));
      list = list.filter((t) => (t.doneAt && t.doneAt >= from && t.doneAt < to) || (t.createdAt && t.createdAt >= from && t.createdAt < to) || (t.due && t.due >= fk && t.due < tkk && t.due <= tk));
      ctx.shift = opts && opts.prev ? days : 0;
    }
    return { list, ctx };
  }

  function timeBucket(k, grain) {
    const d = D.parse(k);
    if (grain === 'month') return D.key(new Date(d.getFullYear(), d.getMonth(), 1));
    return D.key(D.startOfWeek(d, S().state.prefs.weekStart));
  }
  function timeLabel(k, grain) {
    const d = D.parse(k);
    return grain === 'month' ? new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' }).format(d) : C.F.short.format(d);
  }

  function aggregate(vals, agg) {
    if (agg === 'count') return vals.length;
    if (!vals.length) return null;
    const sum = vals.reduce((a, b) => a + b, 0);
    return agg === 'sum' ? sum : sum / vals.length;
  }

  /** returns { cats:[{key,label,color}], series:[{key,label,color,values:[]}] } or { points } for scatter */
  function build() {
    if (FLOW_TYPES.includes(cfg.type)) return applyView(flowBuild());
    const { list, ctx } = rows();
    if (cfg.type === 'scatter') {
      const X = NUMS[cfg.x], Y = NUMS[cfg.y];
      const sd = cfg.series && DIMS[cfg.series];
      const pts = [];
      list.forEach((t) => {
        const x = X.get(t, ctx), y = Y.get(t, ctx);
        if (x == null || y == null) return;
        pts.push({ x, y, s: sd ? sd.get(t, ctx) || '—' : 'Tasks', t });
      });
      const keys = sd ? orderKeys(sd, [...new Set(pts.map((p) => p.s))]) : ['Tasks'];
      const colors = {}; keys.forEach((k, i) => (colors[k] = colorFor(sd, k, i)));
      const only = solo && keys.length > 1 && keys.includes(solo) ? solo : null;
      return { points: only ? pts.filter((p) => p.s === only) : pts, keys, colors, n: list.length, solo: only };
    }
    const xd = DIMS[cfg.x], sd = cfg.type === 'pie' || cfg.type === 'donut' ? null : cfg.series && DIMS[cfg.series];
    const Y = NUMS[cfg.y] || NUMS.count;
    let grain = cfg.grain;
    const raw = list.map((t) => ({ t, x: xd.get(t, ctx), s: sd ? sd.get(t, ctx) : '_', v: Y.get(t, ctx) })).filter((r) => r.x != null && r.s != null && r.v != null);
    let praw = null;
    if (cfg.compare && canCompare()) {
      const pr = rows({ prev: true });
      praw = pr.list.map((t) => ({ t, x: xd.get(t, pr.ctx), v: Y.get(t, pr.ctx) })).filter((r) => r.x != null && r.v != null);
      if (xd.time) praw.forEach((r) => (r.x = D.addKey(r.x, pr.ctx.shift))); // line last period up with this one
    }
    if (xd.time) {
      if (grain === 'auto') {
        const ks = raw.map((r) => r.x).sort();
        grain = ks.length && D.diff(ks[ks.length - 1], ks[0]) > 120 ? 'month' : 'week';
      }
      raw.forEach((r) => (r.x = timeBucket(r.x, grain)));
      if (praw) praw.forEach((r) => (r.x = timeBucket(r.x, grain)));
    }
    let xKeys = [...new Set(raw.map((r) => r.x))];
    if (xd.time) {
      xKeys.sort();
      // fill gaps so the timeline is continuous (cap at 60 buckets)
      if (xKeys.length > 1) {
        const out = []; let k = xKeys[0];
        while (k <= xKeys[xKeys.length - 1] && out.length < 60) {
          out.push(k);
          const d = D.parse(k);
          k = grain === 'month' ? D.key(new Date(d.getFullYear(), d.getMonth() + 1, 1)) : D.addKey(k, 7);
        }
        xKeys = out;
      }
    } else xKeys = orderKeys(xd, xKeys);
    const sKeys = sd ? orderKeys(sd, [...new Set(raw.map((r) => r.s))]) : ['_'];
    const cats = xKeys.map((k, i) => ({ key: k, label: xd.time ? timeLabel(k, grain) : k, color: colorFor(xd, k, i) }));
    const series = sKeys.map((sk, i) => ({
      key: sk, label: sd ? sk : Y.label, color: sd ? colorFor(sd, sk, i) : 'var(--accent)',
      values: xKeys.map((xk) => aggregate(raw.filter((r) => r.x === xk && r.s === sk).map((r) => r.v), cfg.agg))
    }));
    const prev = praw ? { values: xKeys.map((xk) => aggregate(praw.filter((r) => r.x === xk).map((r) => r.v), cfg.agg)), total: aggregate(praw.map((r) => r.v), cfg.agg), n: praw.length } : null;
    const trend = cfg.trend !== 'none' && canTrend() ? trendLine(series[0].values, cfg.trend) : null;
    return applyView({ cats, series, grain, n: list.length, colorByCat: !sd && !xd.time && !!xd.color, raw, prev, trend, total: aggregate(raw.map((r) => r.v), cfg.agg) });
  }
  /* time charts can be zoomed by dragging across them */
  const ZOOM_TYPES = ['column', 'line', 'area', 'burnup', 'cfd'];
  const zoomable = () => ZOOM_TYPES.includes(cfg.type) && (FLOW_TYPES.includes(cfg.type) || !!(cfg.x && DIMS[cfg.x] && DIMS[cfg.x].time));
  /** apply the legend pick (one series on its own, or one category highlighted) and the zoom */
  function applyView(b) {
    if (solo) {
      if (b.series.length > 1 && b.series.some((x) => x.key === solo)) { b.allSeries = b.series; b.series = b.series.filter((x) => x.key === solo); b.solo = solo; }
      else if (b.cats.some((c) => c.key === solo)) b.soloCat = solo;
    }
    if (zoom && zoomable() && b.cats.length > 2) {
      const i0 = b.cats.findIndex((c) => c.key === zoom.a), i1 = b.cats.findIndex((c) => c.key === zoom.b);
      if (i0 >= 0 && i1 > i0) {
        const cut = (arr) => (arr ? arr.slice(i0, i1 + 1) : arr);
        b.fullCats = b.cats.length;
        b.cats = cut(b.cats);
        b.series = b.series.map((x) => Object.assign({}, x, { values: cut(x.values) }));
        if (b.allSeries) b.allSeries = b.allSeries.map((x) => Object.assign({}, x, { values: cut(x.values) }));
        if (b.prev) b.prev = Object.assign({}, b.prev, { values: cut(b.prev.values), total: null });
        b.trend = cut(b.trend);
        b.total = null;
        b.zoomed = { from: b.cats[0].label, to: b.cats[b.cats.length - 1].label };
      }
    }
    return b;
  }
  /** rolling 3-period average, or a least-squares straight line */
  function trendLine(vals, mode) {
    const idx = vals.map((v, i) => (v == null ? null : i)).filter((i) => i != null);
    if (idx.length < 2) return null;
    if (mode === 'avg') return vals.map((v, i) => { const w = [vals[i - 2], vals[i - 1], v].filter((x) => x != null); return v == null || !w.length ? null : w.reduce((a, b) => a + b, 0) / w.length; });
    const n = idx.length, mx = idx.reduce((a, b) => a + b, 0) / n, my = idx.reduce((a, i) => a + vals[i], 0) / n;
    const sxx = idx.reduce((a, i) => a + (i - mx) * (i - mx), 0) || 1, sxy = idx.reduce((a, i) => a + (i - mx) * (vals[i] - my), 0);
    const k = sxy / sxx;
    return vals.map((_, i) => my + k * (i - mx));
  }

  /* ---------- burn-up and cumulative flow: what was open at the end of each period ---------- */
  function flowBuild() {
    const { list, ctx } = rows({ all: true });
    const now = ctx.now, days = RANGE_DAYS[curRange()];
    let start;
    if (days) start = now - days * DAY;
    else { const c = list.map((t) => t.createdAt || now).sort((a, b) => a - b); start = Math.max(c.length ? c[0] : now - 84 * DAY, now - 365 * DAY); }
    const grain = (now - start) / DAY <= 35 ? 'day' : 'week';
    const step = grain === 'day' ? DAY : 7 * DAY;
    const ends = [];
    const t0 = grain === 'day' ? D.add(new Date(start), 1).getTime() : D.add(D.startOfWeek(new Date(start), S().state.prefs.weekStart), 7).getTime();
    for (let e = t0; e < now + step && ends.length < 60; e += step) ends.push(Math.min(e, now));
    if (!ends.length || ends[ends.length - 1] < now) ends.push(now);
    const label = (e) => C.F.short.format(new Date(e - (e === now ? 0 : 1)));
    const cats = ends.map((e, i) => ({ key: 'f' + i, label: e === now && grain !== 'day' ? 'Now' : label(e) }));
    const raw = [];
    const sers = cfg.type === 'burnup'
      ? [{ key: 'added', label: 'Added (total)', color: 'var(--ink-3)' }, { key: 'done', label: 'Done (total)', color: 'var(--ok)' }, { key: 'open', label: 'Open', color: 'var(--accent)' }]
      : [{ key: 'done', label: 'Done', color: 'var(--ok)' }, { key: 'open', label: 'Open, on time', color: 'var(--accent)' }, { key: 'over', label: 'Overdue', color: 'var(--danger)' }];
    const values = sers.map(() => []);
    ends.forEach((e, i) => {
      const ek = D.key(new Date(e));
      const counts = { added: 0, done: 0, open: 0, over: 0 };
      list.forEach((t) => {
        if (!t.createdAt || t.createdAt > e) return;
        counts.added++;
        const isDone = t.done && t.doneAt && t.doneAt <= e;
        let k;
        if (isDone) { counts.done++; k = 'done'; }
        else if (t.due && t.due < ek) { counts.over++; counts.open++; k = 'over'; }
        else { counts.open++; k = 'open'; }
        if (cfg.type === 'burnup') { raw.push({ t, x: 'f' + i, s: 'added' }); if (isDone) raw.push({ t, x: 'f' + i, s: 'done' }); else raw.push({ t, x: 'f' + i, s: 'open' }); }
        else raw.push({ t, x: 'f' + i, s: k });
      });
      sers.forEach((sr, j) => values[j].push(sr.key === 'open' && cfg.type === 'cfd' ? counts.open - counts.over : counts[sr.key]));
    });
    const series = sers.map((sr, j) => Object.assign({}, sr, { values: values[j] }));
    return { cats, series, grain, n: list.length, raw, flow: true, colorByCat: false };
  }
  function orderKeys(d, keys) {
    if (!d.order) return keys.sort((a, b) => String(a).localeCompare(String(b)));
    const o = d.order();
    return keys.sort((a, b) => (o.indexOf(a) < 0 ? 99 : o.indexOf(a)) - (o.indexOf(b) < 0 ? 99 : o.indexOf(b)) || String(a).localeCompare(String(b)));
  }
  function colorFor(d, k, i) { return (d && d.color && d.color(k)) || PALETTE[i % PALETTE.length]; }

  /* ---------- "type a question": plain words → a chart, the way quick add reads a task ---------- */
  // phrases are matched longest first; each one is used up so it can't count twice
  const ASK_DIMS = [
    ['how often it was rescheduled', 'moves'], ['times moved', 'moves'], ['assigned by', 'by'], ['who assigned', 'by'], ['assigned to', 'who'], ['day of the week', 'weekday'], ['day of week', 'weekday'],
    ['time of day', 'tod'], ['completion date', 'completed'], ['date completed', 'completed'], ['date added', 'created'], ['created date', 'created'], ['due date', 'due'], ['due day', 'weekday'],
    ['map cluster', 'cluster'], ['map branch', 'branch'], ['map node', 'node'], ['map depth', 'depth'],
    ['importance', 'level'], ['priority', 'level'], ['priorities', 'level'], ['levels', 'level'], ['level', 'level'], ['types', 'type'], ['type', 'type'], ['kind', 'type'], ['category', 'type'], ['categories', 'type'],
    ['status', 'status'], ['assignee', 'who'], ['person', 'who'], ['people', 'who'], ['who', 'who'], ['owner', 'by'], ['handoffs', 'handoff'], ['handoff', 'handoff'], ['repeat', 'repeat'],
    ['clusters', 'cluster'], ['cluster', 'cluster'], ['branches', 'branch'], ['branch', 'branch'], ['nodes', 'node'], ['node', 'node'], ['depth', 'depth'], ['weekday', 'weekday'],
    ['due', 'due'], ['created', 'created'], ['added', 'created'], ['completed', 'completed'], ['finished', 'completed'], ['done', 'completed'],
    ['week', '@week'], ['weeks', '@week'], ['month', '@month'], ['months', '@month'], ['day', '@week']
  ];
  const ASK_NUMS = [
    ['days pushed back', 'pushed'], ['pushing back', 'pushed'], ['push back', 'pushed'], ['putting off', 'pushed'], ['put off', 'pushed'], ['keep moving', 'moved'], ['days pushed', 'pushed'], ['pushed back', 'pushed'], ['times rescheduled', 'moved'], ['rescheduled', 'moved'], ['rescheduling', 'moved'], ['reschedules', 'moved'], ['postponed', 'moved'], ['moved', 'moved'],
    ['days late', 'late'], ['how late', 'late'], ['lateness', 'late'], ['days to complete', 'toDone'], ['days to finish', 'toDone'], ['time to complete', 'toDone'], ['time to finish', 'toDone'], ['how long', 'toDone'],
    ['on-time rate', 'onTime'], ['on time rate', 'onTime'], ['on-time', 'onTime'], ['on time', 'onTime'], ['how old', 'age'], ['age', 'age'], ['oldest', 'age'],
    ['checklist steps', 'steps'], ['checklist', 'steps'], ['subtasks', 'steps'], ['steps', 'steps']
  ];
  const ASK_TYPES = [['sunburst', 'sunburst'], ['treemap', 'treemap'], ['tree map', 'treemap'], ['burn-up', 'burnup'], ['burn up', 'burnup'], ['burnup', 'burnup'], ['cumulative flow', 'cfd'], ['flow', 'cfd'],
    ['scatter', 'scatter'], ['donut', 'donut'], ['doughnut', 'donut'], ['pie', 'pie'], ['horizontal bar', 'bar'], ['bars', 'column'], ['bar', 'column'], ['columns', 'column'], ['column', 'column'], ['histogram', 'column'],
    ['line', 'line'], ['area', 'area'], ['kpi', 'kpi'], ['tile', 'kpi'], ['number', 'kpi'], ['table', 'table'], ['list of', 'table'], ['list', 'table'], ['spreadsheet', 'table']];
  const reEsc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
  /** a whole-word phrase; pre/post are raw regex pieces around it */
  const RX = (w, post, pre) => new RegExp('(^|\\s)' + (pre || '') + reEsc(w) + (post || '') + '(?=\\s|$)', 'i');
  function parseAsk(text) {
    let t = ' ' + text.toLowerCase().replace(/[’']s\b/g, '').replace(/[^\p{L}\p{N}%.\-\s]/gu, ' ').replace(/\s+/g, ' ').trim() + ' ';
    const out = Object.assign({}, BLANK, { type: null, x: null, series: null, title: '', id: null });
    const hit = { n: 0 };
    const take = (re) => { const m = t.match(re); if (!m) return null; t = t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length); hit.n++; return m; };
    const has = (re) => re.test(t);
    // a table's columns: "… with due date, importance and days late"
    let askCols = null;
    const cm = t.match(/\s(with|showing|including|columns?)\s+(.*?)(?=\s(sorted|sort|ordered|order|ranked|grouped|by|per|this|last|for|from|in the)\s|$)/);
    if (cm) {
      let seg = ' ' + cm[2] + ' '; const got = [];
      const words = ASK_NUMS.map(([w, id]) => [w, id]).concat(ASK_DIMS.filter(([, id]) => !id.startsWith('@')), [['notes', 'notes'], ['note', 'notes'], ['time', 'time'], ['title', 'title'], ['name', 'title']]).sort((a, b) => b[0].length - a[0].length);
      words.forEach(([w, id]) => { const r = RX(w); let mm; while ((mm = seg.match(r))) { got.push({ id, at: mm.index }); seg = seg.slice(0, mm.index) + ' '.repeat(mm[0].length) + seg.slice(mm.index + mm[0].length); } });
      const ids = [...new Set(got.sort((a, b) => a.at - b.at).map((g) => g.id))].filter((id) => id !== 'title' && id !== 'count');
      if (ids.length) { askCols = ids; t = t.slice(0, cm.index) + ' ' + t.slice(cm.index + cm[0].length); hit.n++; }
    }
    // "sorted by days late", "oldest first"
    let askSort = null;
    const sm = t.match(/\b(?:sorted|sort|ordered|order|ranked|rank)\s+by\s+/);
    if (sm) {
      const rest = t.slice(sm.index + sm[0].length);
      let k = null, len = 0;
      for (const [w, id] of ASK_NUMS) { const mm = rest.match(new RegExp('^' + reEsc(w) + '(?=\\s|$)')); if (mm) { k = id; len = mm[0].length; break; } }
      if (!k) for (const [w, id] of ASK_DIMS) { if (id.startsWith('@')) continue; const mm = rest.match(new RegExp('^(the\\s+)?' + reEsc(w) + '(?=\\s|$)')); if (mm) { k = id; len = mm[0].length; break; } }
      if (!k && /^(name|title)\b/.test(rest)) { k = 'title'; len = rest.match(/^(name|title)/)[0].length; }
      if (k) { t = t.slice(0, sm.index) + ' ' + t.slice(sm.index + sm[0].length + len); askSort = nextSort(null, k); hit.n++; }
      if (askSort && take(/\b(ascending|lowest first|smallest first|earliest first|soonest first)\b/)) askSort.d = 1;
      else if (askSort && take(/\b(descending|highest first|biggest first|latest first|most first)\b/)) askSort.d = -1;
    }
    if (take(/\boldest first\b/)) askSort = askSort ? Object.assign(askSort, { d: 1 }) : { k: 'created', d: 1 };
    else if (take(/\b(newest|most recent) first\b/)) askSort = askSort ? Object.assign(askSort, { d: -1 }) : { k: 'created', d: -1 };
    else if (take(/\b(soonest|earliest) first\b/)) askSort = { k: 'due', d: 1 };
    else if (take(/\bmost (rescheduled|moved|postponed)\b/)) { askSort = { k: 'moved', d: -1 }; askCols = askCols || null; out.type = out.type || 'table'; if (!askCols) askCols = ['moved', 'pushed', 'due', 'type']; }
    else if (take(/\b(latest|most overdue|furthest behind)\b/)) askSort = { k: 'late', d: -1 };
    // when it's due (a filter, not a date range)
    let askDue = null;
    if (take(/\bdue (this week|in the next (7|seven) days|within (a|one) week|next 7 days|soon|this coming week)\b/)) askDue = 'week';
    else if (take(/\bdue (today|now)\b/)) askDue = 'today';
    else if (take(/\bdue (this month|in the next (30|thirty) days|within (a|one) month)\b/)) askDue = 'month';
    else if (take(/\b(with no (due )?date|no due date|without a (due )?date|undated|unscheduled)\b/)) askDue = 'none';
    // dates
    const RANGES = [[/\b(all time|ever|always|of all time)\b/, 'all'], [/\b(this|last|past|previous|the)?\s*(year|12 months|365 days)\b/, '1y'], [/\b((this|last|past|previous|the)\s+)?(6 months|six months|half a year|half year)\b/, '6m'],
      [/\b((this|last|past|previous|the)\s+)?(12 weeks|twelve weeks|3 months|three months|quarter|90 days)\b/, '12w'], [/\b(this|last|past)\s+(month|4 weeks|four weeks|30 days)\b|\b(4 weeks|30 days|a month)\b/, '4w'], [/\b(this|last|past)\s+(week|7 days|seven days)\b/, '4w']];
    const weekly = has(/\bthis week\b/);
    for (const [re, v] of RANGES) if (take(re)) { out.range = v; break; }
    take(/\b(over|in|during|for|from)\s*(the)?\s*$/);
    if (take(/\b(compared? (with|to)|vs\.? (the )?(last|previous)( period)?|versus (the )?(last|previous)|than (the )?(last|previous)( one)?|previous period)\b/)) out.compare = true;
    // goals
    let m;
    if ((m = take(/\b(?:goal|target)\s*(?:of|is|=|:)?\s*(\d+(?:\.\d+)?)/))) out.goal = +m[1];
    if ((m = take(/\b(?:at least|min(?:imum)?(?: of)?)\s*(\d+(?:\.\d+)?)/))) { out.goal = +m[1]; out.goalDir = 'atLeast'; }
    if ((m = take(/\b(?:at most|no more than|max(?:imum)?(?: of)?|under|below|fewer than|less than)\s*(\d+(?:\.\d+)?)/))) { out.goal = +m[1]; out.goalDir = 'atMost'; }
    if (take(/\b(rolling|moving) average\b/)) out.trend = 'avg'; else if (take(/\b(with (a )?)?trend ?line\b|\bwith (a )?trend\b/)) out.trend = 'linear';
    if (take(/\b(who (assigns|gives|hands|sends)( out)?( (work|tasks|things))?( to (whom|who))?|hands? off|handed off|handoffs?( (between|from))?|delegat\w*)\b/)) out.type = 'handoff';
    if (take(/\b(is my (list|backlog) growing|growing|burn ?down|added vs\.? done|added versus done)\b/)) out.type = 'burnup';
    if (take(/\bacross the map\b/) && !out.type) out.type = 'sunburst';
    // summary words
    if (take(/\b(average|avg|mean|typical)\b/)) out.agg = 'avg'; else if (take(/\b(total|sum of|sum)\b/)) out.agg = 'sum';
    // "by X", "per X", "split by Y", "and Y"
    const dimAt = (str) => { for (const [w, id] of ASK_DIMS) { const mm = str.match(new RegExp('^(the\\s+)?' + w.replace(/ /g, '\\s+') + '(?=\\s|$)')); if (mm) return { id, len: mm[0].length }; } return null; };
    let grain = null;
    const byRe = /\b(split by|broken down by|grouped by|colou?red by|coloured by|by|per|each|across|for each|over)\s+/g;
    let found = [], mm2;
    while ((mm2 = byRe.exec(t))) {
      const rest = t.slice(mm2.index + mm2[0].length), d = dimAt(rest);
      if (d) found.push({ start: mm2.index, end: mm2.index + mm2[0].length + d.len, id: d.id, split: /split|broken|colou?red/.test(mm2[1]) });
      else if (mm2[1] === 'over' && /^time\b/.test(rest)) found.push({ start: mm2.index, end: mm2.index + mm2[0].length + 4, id: '@time' });
    }
    // "by type and importance"
    found.slice().forEach((f) => { const rest = t.slice(f.end).match(/^\s*(and|then|&|,)\s+/); if (rest) { const d = dimAt(t.slice(f.end + rest[0].length)); if (d && !d.id.startsWith('@')) found.push({ start: f.end, end: f.end + rest[0].length + d.len, id: d.id, split: true }); } });
    found.sort((a, b) => b.start - a.start).forEach((f) => { t = t.slice(0, f.start) + ' ' + t.slice(f.end); hit.n++; });
    found.sort((a, b) => a.start - b.start);
    if (/\b(weekly|every week)\b/.test(t)) { take(/\b(weekly|every week)\b/); found.push({ id: '@week' }); }
    if (/\b(monthly|every month)\b/.test(t)) { take(/\b(monthly|every month)\b/); found.push({ id: '@month' }); }
    let timeAsked = false;
    found.forEach((f) => {
      if (f.id === '@week' || f.id === '@month' || f.id === '@time') { timeAsked = true; if (f.id !== '@time') grain = f.id.slice(1); return; }
      if (DIMS[f.id] && DIMS[f.id].map && !(C.map && C.map.nodes().length)) return;
      if (!out.x && !f.split) out.x = f.id; else if (!out.series && f.id !== out.x) out.series = f.id; else if (!out.x) out.x = f.id;
    });
    // numbers: "steps vs days to complete" makes a scatter
    const nums = [];
    for (const [w, id] of ASK_NUMS) { let mm; while ((mm = t.match(RX(w)))) { nums.push({ id, at: mm.index }); t = t.slice(0, mm.index) + ' ' + t.slice(mm.index + mm[0].length); hit.n++; } }
    nums.sort((a, b) => a.at - b.at);
    const uniq = [...new Set(nums.map((n) => n.id))];
    if (uniq.length >= 2 && (has(/\b(vs\.?|versus|against|and)\b/) || out.type === 'scatter')) { out.type = 'scatter'; out.x = uniq[0]; out.y = uniq[1]; take(/\b(vs\.?|versus|against)\b/); }
    else if (uniq.length) out.y = uniq[0];
    // "how often tasks get moved" → group tasks by how many times they moved
    if (/\bhow often\b/.test(text.toLowerCase()) && out.y === 'moved' && !out.x && out.type !== 'scatter') { out.x = 'moves'; out.y = 'count'; out.agg = 'count'; }
    // chart type words
    if (!out.type || out.type === 'scatter') for (const [w, id] of ASK_TYPES) { if (take(RX(w, '(\\s+(chart|graph|plot|tile))?'))) { if (!out.type) out.type = id; break; } }
    if (take(/\b(how many|count of|number of)\b/)) hit.n += 0;
    if (take(/\b(trend|trending|over time|timeline)\b/)) timeAsked = true;
    // status
    if (take(/\b(overdue|late|past due|behind)\b/)) out.status = 'overdue';
    else if (take(/\b(open|pending|remaining|outstanding|unfinished|to-?do|left|not done)\b/)) out.status = 'open';
    else if (take(/\b(done|completed|complete|finished|finish|closed)\b/)) out.status = 'done';
    // filters: names of your types, levels, people and map branches/clusters
    const f = {};
    const nameHit = (name) => name && name.length > 1 && RX(name.toLowerCase()).test(t);
    const takeName = (name) => take(RX(name.toLowerCase(), '(\\s+tasks?)?'));
    S().state.types.slice().sort((a, b) => b.name.length - a.name.length).forEach((x) => { if (!f.type && nameHit(x.name)) { takeName(x.name); f.type = x.name; } });
    S().state.levels.slice().sort((a, b) => b.name.length - a.name.length).forEach((x) => { if (!f.level && nameHit(x.name)) { takeName(x.name); f.level = x.name; } });
    const mc = mapCtx();
    if (mc) {
      mc.order.branch.slice().sort((a, b) => b.length - a.length).forEach((b) => { if (!f.branch && b.length > 2 && nameHit(b)) { takeName(b); f.branch = b; } });
      mc.order.cluster.slice().sort((a, b) => b.length - a.length).forEach((c) => { if (!f.cluster && !f.branch && c.length > 2 && nameHit(c)) { takeName(c); f.cluster = c; } });
    }
    const people = new Set(); S().state.tasks.forEach((x) => { const d = doer(x); if (d !== 'Me') people.add(d); });
    [...people].forEach((p) => { if (!f.who && nameHit(p)) { take(RX(p.toLowerCase(), '', '((for|by|assigned to|from)\\s+)?')); f.who = p; } });
    if (take(/\b(assigned to me|my tasks|for me)\b/)) f.who = 'Me';
    if (askDue) f.due = askDue;
    if (Object.keys(f).length) out.f = f;
    // fill in what wasn't said
    const timeX = () => (out.status === 'done' || ['toDone', 'onTime'].includes(out.y) ? 'completed' : out.status === 'overdue' || out.y === 'late' ? 'due' : 'created');
    if (!out.type && (askCols || askSort || /\b(which tasks|show me (the |my )?tasks)\b/.test(text.toLowerCase()))) out.type = 'table';
    if (out.type === 'table') {
      if (out.x && (isNum(out.x) || !DIMS[out.x])) out.x = null;
      out.series = null;
      const extraNums = uniq.filter((id) => !(askCols || []).includes(id));
      out.cols = askCols || DEFAULT_COLS.concat(extraNums.filter((id) => !DEFAULT_COLS.includes(id)));
      out.sort = askSort || (out.y && out.y !== 'count' ? nextSort(null, out.y) : out.status === 'overdue' ? { k: 'late', d: -1 } : { k: 'due', d: 1 });
      if (out.sort.k !== 'title' && out.sort.k !== 'due' && !out.cols.includes(out.sort.k)) out.cols = out.cols.concat(out.sort.k);
      if (out.status === 'overdue' && !askCols && !out.cols.includes('late')) out.cols = ['due', 'late'].concat(out.cols.filter((c) => c !== 'due' && c !== 'status'));
      if (out.status !== 'all' && !askCols) out.cols = out.cols.filter((c) => c !== 'status'); // every row has the same status
      out.y = 'count'; out.agg = 'count';
    } else if (out.type === 'handoff' || FLOW_TYPES.includes(out.type)) { out.x = null; out.series = null; out.y = 'count'; out.agg = 'count'; if (out.type !== 'handoff' && out.range === 'all') out.range = '12w'; }
    else if (out.type === 'sunburst') { out.x = null; out.series = null; }
    else if (out.type !== 'scatter') {
      if (timeAsked && !(out.x && DIMS[out.x] && DIMS[out.x].time)) { if (out.x && !out.series) out.series = out.x; out.x = timeX(); }
      if (grain) out.grain = grain;
      if (!out.type) out.type = out.x && DIMS[out.x].time ? (timeAsked && !grain ? 'line' : 'column') : out.x ? (out.series ? 'bar' : 'column') : 'kpi';
      if (out.type === 'kpi') { if (out.x && !DIMS[out.x].time) out.x = null; if (weekly) { out.kpiPeriod = 'week'; out.range = 'all'; } }
      if (['pie', 'donut', 'treemap'].includes(out.type) && !out.x) out.x = 'type';
      if (['pie', 'donut'].includes(out.type)) out.series = null;
      if (['column', 'bar', 'line', 'area'].includes(out.type) && !out.x) out.x = timeAsked ? timeX() : 'type';
      if (out.x && DIMS[out.x] && DIMS[out.x].time && out.range === 'all' && (grain === 'week' || !grain)) out.range = '12w';
    }
    if (!out.y) out.y = 'count';
    if (askSort && out.type !== 'table') askSort = null;
    const Y = NUMS[out.y];
    if (!Y.aggs.includes(out.agg)) out.agg = out.y === 'count' ? 'count' : ['late', 'toDone', 'age', 'onTime'].includes(out.y) ? 'avg' : Y.aggs[0];
    if (out.type === 'treemap' && out.agg === 'avg') { if (Y.aggs.includes('sum')) out.agg = 'sum'; else { out.y = 'count'; out.agg = 'count'; } }
    if (out.goal != null && out.goalDir === 'atLeast' && !/at least|min/.test(text.toLowerCase()) && LOWER_IS_BETTER.includes(out.y)) out.goalDir = 'atMost';
    if (out.status === 'overdue' && out.goal == null && out.type === 'kpi') { out.goal = 0; out.goalDir = 'atMost'; }
    if (out.compare && !(['column', 'bar', 'line', 'area'].includes(out.type) && RANGE_DAYS[out.range] && !out.series)) { if (!RANGE_DAYS[out.range] && ['column', 'bar', 'line', 'area'].includes(out.type) && !out.series) out.range = '4w'; else out.compare = false; }
    if (out.trend !== 'none' && !(['column', 'line', 'area'].includes(out.type) && out.x && DIMS[out.x] && DIMS[out.x].time && !out.series)) out.trend = 'none';
    const left = t.replace(/\b(show|me|my|the|a|an|of|tasks?|chart|graph|plot|please|for|in|with|what|which|how|is|are|do|does|i|did|to|on|and|at|it|get|got|have|has|many|much|so|far|by|per|all|this|that|there|were|was|keep|kept|as|often|get|gets|being)\b/g, ' ').replace(/\s+/g, ' ').trim();
    return { cfg: out, understood: hit.n > 0 || !!out.status && out.status !== 'all' || Object.keys(f).length > 0, leftover: left };
  }
  function askHtml() {
    const n = ui.askNote;
    return '<form class="cb-ask" data-ask role="search"><label class="cb-ask-box">' + icon('sparkle') + '<span class="sr">Describe a chart</span>' +
      '<input id="cb-ask" type="text" autocomplete="off" spellcheck="false" enterkeyhint="go" value="' + esc(ui.askText || '') + '" placeholder="Ask for a chart: “overdue tasks by branch this month”"></label>' +
      '<button type="submit" class="btn primary sm">Build</button></form>' +
      (n ? '<p class="cb-asknote' + (n.bad ? ' bad' : '') + '" role="status">' + (n.bad ? icon('flag') : icon('check')) + '<span>' + n.html + '</span></p>'
        : '<p class="cb-asknote tips"><span class="muted">Try</span>' + ASK_EXAMPLES.slice(0, matchMedia('(max-width: 640px)').matches ? 2 : 4).map((x) => '<button type="button" class="cb-askex" data-askex="' + esc(x) + '">' + esc(x) + '</button>').join('') + '</p>');
  }
  function runAsk(text) {
    text = (text || '').trim();
    ui.askText = text;
    if (!text) return;
    const r = parseAsk(text);
    if (!r.understood) {
      ui.askNote = { bad: true, html: 'I couldn’t turn that into a chart. Try naming what to count and how to group it, like <b>open tasks by type</b> or <b>days late per month</b>.' };
      return render();
    }
    ui.picked = null; ui.flash = null;
    C.withTransition(() => {
      setCfg(r.cfg);
      const bits = [esc(autoTitle())];
      if (RANGE_DAYS[curRange()]) bits.push('last ' + RANGE_WORDS[curRange()]);
      const f = flt(); FILTERS.forEach((x) => { if (f[x.key]) bits.push(esc(x.label + ': ' + filterWord(x, f[x.key]))); }); if (f.text) bits.push(esc('“' + f.text + '”'));
      if (cfg.status !== 'all' && !FIXED_TYPES.includes(cfg.type) && !/^(open|overdue|done)\b/i.test(autoTitle())) bits.push({ open: 'open tasks only', overdue: 'overdue only', done: 'done only' }[cfg.status]);
      if (r.leftover && r.leftover.length > 1) bits.push('skipped “' + esc(r.leftover) + '”');
      ui.askNote = { html: 'Built <b>' + bits[0] + '</b>' + (bits.length > 1 ? ' · ' + bits.slice(1).join(' · ') : '') + (problem() ? '. ' + esc(problem()) : '. Adjust the fields below, or save it.') };
      render();
      if (matchMedia('(max-width: 900px)').matches) { const inp = el.querySelector('#cb-ask'); if (inp) inp.blur(); const cv = el.querySelector('.cb-canvas'); if (cv) setTimeout(() => cv.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); }
    });
  }
  const ASK_EXAMPLES = ['list overdue work tasks sorted by days late', 'overdue tasks by branch this month', 'average days late per month', 'done per week with a goal of 5', 'open tasks by type and importance as a treemap', 'what I keep pushing back by type', 'how many tasks did I finish this week'];

  /* ---------- validity & titles ---------- */
  function problem() {
    if (cfg.type === 'sunburst') {
      if (!C.map || !C.map.nodes().length) return 'A sunburst follows your map. Add nodes on the Canvas and link tasks to them first.';
      if (!cfg.y) return 'Drag a number field onto Values. Tasks counts them.';
      return null;
    }
    if (FIXED_TYPES.includes(cfg.type) || cfg.type === 'table') return null;
    if (cfg.type === 'treemap') {
      if (!cfg.x) return 'Drag a category onto Boxes, for example Type or Map branch.';
      if (isNum(cfg.x)) return 'Boxes need a category field, like Type or Importance.';
      if (!cfg.y) return 'Drag a number field onto Values. Tasks counts them.';
      if (cfg.agg === 'avg') return 'A treemap sizes boxes by totals, so averages don’t fit. Choose Total under Summarize as, or put Tasks on Values.';
      return null;
    }
    if (cfg.type === 'kpi') {
      if (!cfg.y) return 'Drag a number field onto Values. Tasks counts them.';
      if (cfg.x && !(DIMS[cfg.x] && DIMS[cfg.x].time)) return 'A KPI tile’s trend runs over time. Put a date field (Due date, Created or Completed) on Trend over, or leave it empty.';
      return null;
    }
    if (cfg.type === 'scatter') {
      if (!cfg.x || !isNum(cfg.x) || cfg.x === 'count') return 'Scatter plots need a number field on the X axis, like Checklist steps or Age (days).';
      if (!cfg.y || cfg.y === 'count') return 'Scatter plots need a number field for Values, like Days to complete or Days late.';
      return null;
    }
    if (!cfg.x) return 'Drag a field onto the X axis to start, for example Type or Completed.';
    if (isNum(cfg.x)) return 'Number fields go on the X axis only in a scatter plot. Choose Scatter, or drag a category like Type onto the X axis.';
    if (!cfg.y) return 'Drag a number field onto Values. Tasks counts them.';
    return null;
  }
  const AGG_WORD = { count: 'Number of', sum: 'Total', avg: 'Average' };
  function autoTitle() {
    if (problem()) return 'Untitled chart';
    if (cfg.type === 'scatter') return NUMS[cfg.y].label + ' vs. ' + NUMS[cfg.x].label;
    const y = NUMS[cfg.y];
    const yl = cfg.y === 'count' ? 'Tasks' : cfg.y === 'onTime' ? 'On-time rate' : AGG_WORD[cfg.agg] + ' ' + y.label.toLowerCase();
    const st = { open: 'Open ', overdue: 'Overdue ', done: 'Done ' }[cfg.status] || '';
    if (cfg.type === 'burnup') return 'Tasks added vs. done over time';
    if (cfg.type === 'cfd') return 'Done, open and overdue over time';
    if (cfg.type === 'handoff') return (st ? st + 'handoffs' : 'Handoffs') + ': who assigns work to whom';
    if (cfg.type === 'table') { const f = flt(); return (st ? st + 'tasks' : 'Tasks') + (f.due ? ' ' + filterWord(FILTERS.find((x) => x.key === 'due'), f.due).replace(/^next/, 'due in the next').replace(/^today$/, 'due today').replace(/^overdue$/, '(overdue)').replace(/^has a date$/, 'with a date').replace(/^no date$/, 'with no date') : '') + (cfg.x && DIMS[cfg.x] ? ' by ' + (DIMS[cfg.x].words || DIMS[cfg.x].label.toLowerCase()) : ''); }
    if (cfg.type === 'sunburst') return (cfg.y === 'count' ? (st ? st + 'tasks' : 'Tasks') : yl) + ' across the map';
    if (cfg.type === 'kpi') return (cfg.y === 'count' ? (st ? st + 'tasks' : 'All tasks') : yl) + (cfg.kpiPeriod === 'week' ? ' this week' : '');
    const pie = cfg.type === 'pie' || cfg.type === 'donut';
    return yl + ' by ' + (DIMS[cfg.x].words || DIMS[cfg.x].label.toLowerCase()) + (cfg.series && !pie ? ' and ' + (DIMS[cfg.series].words || DIMS[cfg.series].label.toLowerCase()) : '');
  }
  const fmt = (v, unit) => (v == null ? '—' : (unit === '%' ? Math.round(v) + '%' : (Math.abs(v) >= 10 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)) + (unit === 'd' ? 'd' : '')));

  /* ---------- page ---------- */
  function render() {
    syncBoard();
    solo = ui.solo; zoom = ui.zoom;
    const root = el && el.querySelector('#cb-root');
    if (!root) return;
    const editing = cfg.id && board.find((b) => b.id === cfg.id);
    const y = NUMS[cfg.y];
    const pie = cfg.type === 'pie' || cfg.type === 'donut';
    root.innerHTML = '<div class="cb-askwrap">' + askHtml() + '</div>' +
      '<div class="cb-layout">' +
      // left: fields + zones
      '<aside class="cb-side">' +
      '<div class="st-sec cb-zones">' +
      (cfg.type === 'table' ? colsZone() : '') +
      zone('x', cfg.type === 'scatter' ? 'X axis (number)' : pie ? 'Slices' : cfg.type === 'table' ? 'Group rows by (optional)' : cfg.type === 'treemap' ? 'Boxes' : cfg.type === 'handoff' ? 'From “Assigned by” to “Assigned to”' : cfg.type === 'sunburst' ? 'X axis · rings follow the map' : cfg.type === 'kpi' ? 'Trend over (a date)' : FLOW_TYPES.includes(cfg.type) ? 'X axis · time' : 'X axis', cfg.type === 'sunburst' || FIXED_TYPES.includes(cfg.type)) +
      (cfg.type === 'table' ? '' : zone('y', cfg.type === 'scatter' ? 'Y axis (number)' : FIXED_TYPES.includes(cfg.type) ? 'Values · tasks' : 'Values', FIXED_TYPES.includes(cfg.type))) +
      (y && y.aggs.length > 1 && cfg.type !== 'scatter' && cfg.type !== 'table' ? '<div class="cb-agg"><span class="muted">Summarize as</span><div class="seg mini">' + y.aggs.map((a) => '<button type="button" class="seg-btn' + (cfg.agg === a ? ' on' : '') + '" data-agg="' + a + '">' + (a === 'sum' ? 'Total' : 'Average') + '</button>').join('') + '</div></div>' : '') +
      (cfg.type === 'table' ? '' : zone('series', cfg.type === 'scatter' ? 'Color by' : cfg.type === 'treemap' ? 'Smaller boxes inside' : 'Split by', pie || cfg.type === 'sunburst' || cfg.type === 'kpi' || FIXED_TYPES.includes(cfg.type))) +
      '</div>' +
      '<div class="st-sec cb-fields"><header><h2>Fields</h2><p class="muted">Categories</p></header><div class="cb-tray">' +
      Object.keys(DIMS).filter((id) => !DIMS[id].map).map((id) => chip(id, 'tray')).join('') + '</div>' +
      (C.map && C.map.nodes().length ? '<p class="muted cb-sub">The map</p><div class="cb-tray">' + Object.keys(DIMS).filter((id) => DIMS[id].map).map((id) => chip(id, 'tray')).join('') + '</div>' : '') +
      '<p class="muted cb-sub">Numbers</p><div class="cb-tray">' + Object.keys(NUMS).map((id) => chip(id, 'tray')).join('') + '</div>' +
      (cfg.type === 'table' ? '<p class="muted cb-sub">Table only</p><div class="cb-tray">' + Object.keys(EXTRA_COLS).map((id) => chip(id, 'tray')).join('') + '</div>' : '') + '</div>' +
      '</aside>' +
      // right: chart
      '<div class="cb-main">' +
      '<div class="cb-types" role="radiogroup" aria-label="Chart type">' + TYPES.map(([id, label, p]) => '<button type="button" role="radio" class="cb-type' + (cfg.type === id ? ' on' : '') + '" data-ctype="' + id + '" aria-checked="' + (cfg.type === id) + '">' + typeSvg(p) + '<span>' + label + '</span></button>').join('') + '</div>' +
      '<section class="st-sec cb-canvas' + (ui.picked ? ' picking' : '') + '">' +
      '<div class="cb-head"><textarea class="cb-title" id="cb-title" rows="' + (matchMedia('(max-width: 640px)').matches && (cfg.title || autoTitle()).length > 24 ? 2 : 1) + '" placeholder="' + esc(autoTitle()) + '" aria-label="Chart title" spellcheck="false">' + esc(cfg.title) + '</textarea></div>' +
      '<div class="cb-filters">' +
      (FLOW_TYPES.includes(cfg.type) ? '' : sel('status', [['all', 'All tasks'], ['open', 'Open only'], ['overdue', 'Overdue only'], ['done', 'Done only']])) +
      sel('range', [['all', 'All time'], ['4w', 'Last 4 weeks'], ['12w', 'Last 12 weeks'], ['6m', 'Last 6 months'], ['1y', 'Last year']]) +
      (cfg.x && DIMS[cfg.x] && DIMS[cfg.x].time && cfg.type !== 'scatter' ? sel('grain', [['auto', 'Auto'], ['week', 'By week'], ['month', 'By month']]) : '') +
      (cfg.series && !pie && !['scatter', 'line', 'sunburst', 'kpi', 'treemap', 'handoff'].includes(cfg.type) ? '<label class="cb-check"><input type="checkbox" data-stack' + (cfg.stack ? ' checked' : '') + '> Stacked</label>' : '') +
      (cfg.type === 'table' ? sel('limit', [['10', 'Show 10 rows'], ['25', 'Show 25 rows'], ['50', 'Show 50 rows'], ['100', 'Show 100 rows'], ['all', 'Show every row']]) : '') +
      (cfg.type === 'handoff' ? '<label class="cb-check"><input type="checkbox" data-self' + (cfg.selfToo ? ' checked' : '') + '> Include tasks I keep for myself</label>' : '') +
      (cfg.type === 'kpi' ? sel('kpiPeriod', [['all', 'Number: all matching'], ['week', 'Number: this week']]) : '') +
      (GOAL_TYPES.includes(cfg.type) ? '<span class="cb-goal-ctl"><label class="cb-select"><span class="sr">Goal direction</span><select data-cfg="goalDir"><option value="atLeast"' + (cfg.goalDir !== 'atMost' ? ' selected' : '') + '>Goal: at least</option><option value="atMost"' + (cfg.goalDir === 'atMost' ? ' selected' : '') + '>Goal: at most</option></select>' + icon('chevD') + '</label>' +
        '<input type="number" class="cb-goal-in" data-goal inputmode="decimal" step="any" min="0" placeholder="none" aria-label="Goal value" value="' + (cfg.goal == null ? '' : esc(cfg.goal)) + '">' + (NUMS[cfg.y] && NUMS[cfg.y].unit ? '<span class="muted cb-goal-unit">' + (NUMS[cfg.y].unit === 'd' ? 'days' : '%') + '</span>' : '') + '</span>' : '') +
      '</div>' +
      extrasHtml() +
      '<div class="cb-plot">' + plot(false) + '</div>' + zoomHtml(true) +
      (cfg.type === 'table' ? '' : '<div class="ins-legend cb-legend">' + legendHtml() + '<span class="ins-cap" aria-live="polite"></span></div>') +
      summaryHtml() +
      '<div class="cb-actions">' +
      '<button type="button" class="btn primary sm" data-save' + (problem() ? ' disabled' : '') + '>' + icon(editing ? 'check' : 'plus') + '<span>' + (editing ? 'Update chart' : 'Save to board') + '</span></button>' +
      (editing ? '<button type="button" class="btn sm" data-save-new' + (problem() ? ' disabled' : '') + '>Save as new</button>' : '') +
      '<button type="button" class="btn sm ghost" data-reset>Start over</button>' +
      '<span class="cb-export"><button type="button" class="btn sm ghost" data-export="png"' + (problem() ? ' disabled' : '') + '>' + icon('image') + '<span>PNG</span></button>' +
      '<button type="button" class="btn sm ghost" data-export="csv"' + (problem() ? ' disabled' : '') + '>' + icon('download') + '<span>CSV</span></button></span></div>' +
      '</section>' +
      (cfg.type === 'sunburst' && !problem() ? '<div class="cb-heatlink"><button type="button" class="btn sm" data-heat>' + icon('canvas') + '<span>Color the canvas by this</span></button><span class="muted">Tints each node on the canvas by the same numbers.</span></div>' : '') +
      '<div class="cb-presets"><span class="muted">Try one:</span>' + PRESETS.map((p, i) => p.map && !(C.map && C.map.nodes().length) ? '' : '<button type="button" class="chip" data-preset="' + i + '">' + esc(p.name) + '</button>').join('') + '</div>' +
      '</div></div>' +
      '<a href="#board" class="cb-boardlink st-sec">' + icon('board') + '<span><b>Your dashboards</b><span class="muted">' + (board.length ? board.length + ' saved chart' + (board.length === 1 ? '' : 's') + ' · new ones go on the dashboard you last opened' : 'Charts you save show up on your dashboard.') + '</span></span>' + icon('chevR') + '</a>';
    if (ui.flash) { const z = root.querySelector('[data-zone="' + ui.flashZone + '"]'); if (z) z.classList.add('nope'); }
  }

  /* compare, trend and the extra filters, under the main filter row */
  const FILTERS = [
    { key: 'type', label: 'Type', opts: () => S().state.types.map((x) => x.name) },
    { key: 'level', label: 'Importance', opts: () => S().state.levels.map((x) => x.name) },
    { key: 'cluster', label: 'Cluster', map: true, opts: () => { const c = mapCtx(); return c ? c.order.cluster : []; } },
    { key: 'branch', label: 'Branch', map: true, opts: () => { const c = mapCtx(); return c ? c.order.branch : []; } },
    { key: 'who', label: 'Person', opts: () => { const set = new Set(['Me']); S().state.tasks.forEach((t) => set.add(doer(t))); return [...set]; } },
    { key: 'due', label: 'Due', opts: () => DUE_WINDOWS.map((x) => x[0]), word: (v) => (DUE_WINDOWS.find((x) => x[0] === v) || [, v])[1].replace('Due: ', '') }
  ];
  const filterWord = (x, v) => (x.word ? x.word(v) : v);
  function extrasHtml() {
    const f = flt(), n = Object.keys(f).filter((k) => f[k]).length;
    const hasMap = C.map && C.map.nodes().length;
    let h = '<div class="cb-extras">';
    if (canCompare()) h += '<label class="cb-check"><input type="checkbox" data-compare' + (cfg.compare ? ' checked' : '') + '> Compare with the previous ' + RANGE_WORDS[curRange()] + '</label>';
    if (canTrend()) h += sel('trend', [['none', 'No trend line'], ['avg', 'Trend: rolling average'], ['linear', 'Trend: straight line']]);
    h += '<button type="button" class="toggle sm' + (ui.filters || n ? ' on' : '') + '" data-filters aria-expanded="' + !!ui.filters + '">' + icon('settings') + '<span>Filters' + (n ? ' · ' + n : '') + '</span></button>';
    h += '</div>';
    if (ui.filters || n) {
      h += '<div class="cb-fbar">' + FILTERS.filter((x) => !x.map || hasMap).map((x) => {
        const o = x.opts(), cur = f[x.key] || '';
        return '<label class="cb-select"><span class="sr">' + x.label + '</span><select data-filter="' + x.key + '"><option value="">' + (x.key === 'due' ? 'Any due date' : 'Any ' + x.label.toLowerCase()) + '</option>' +
          (cur && !o.includes(cur) ? '<option selected value="' + esc(cur) + '">' + esc(filterWord(x, cur)) + '</option>' : '') + o.map((v) => '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(x.key === 'due' ? (DUE_WINDOWS.find((w) => w[0] === v) || [, v])[1] : filterWord(x, v)) + '</option>').join('') + '</select>' + icon('chevD') + '</label>';
      }).join('') +
        '<label class="input-wrap sm cb-ftext">' + icon('search') + '<span class="sr">Title or notes contain</span><input data-ftext type="search" placeholder="Title or notes contain…" value="' + esc(f.text || '') + '"></label>' + (n ? '<button type="button" class="btn sm ghost" data-filters-clear>Clear filters</button>' : '') + '</div>';
    }
    return h;
  }

  /* ---------- the one-sentence summary under each chart ---------- */
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  function summaryText() {
    if (problem()) return '';
    const usesMoves = ['moved', 'pushed'].includes(cfg.y) || ['moves', 'moved', 'pushed'].includes(cfg.x);
    if (usesMoves && !S().state.tasks.some((t) => !t.sample && t.moved)) return 'Nothing has been rescheduled yet. Cadence counts due-date changes from version 19 on, so this fills in as you move tasks to new dates.';
    const unit = (NUMS[cfg.y] || NUMS.count).unit, isCount = cfg.y === 'count';
    const amt = (v) => fmt(v, unit) + (isCount ? (Math.round(v) === 1 ? ' task' : ' tasks') : '');
    if (cfg.type === 'kpi') {
      const k = kpiData(); if (k.value == null) return '';
      return autoTitle() + ': ' + amt(k.value) + '.' + (hasGoal() ? (meets(k.value) ? ' That meets your goal.' : ' That misses your goal of ' + (cfg.goalDir === 'atMost' ? 'at most ' : 'at least ') + fmt(+cfg.goal, unit) + '.') : '');
    }
    if (cfg.type === 'sunburst') {
      const sb = sunData(); if (!sb || !sb.center.all.length) return '';
      const big = sb.center.kids.slice().sort((a, b) => b.all.length - a.all.length)[0];
      return big ? big.title + ' holds the most: ' + big.all.length + ' of ' + sb.center.all.length + ' tasks (' + pct(big.all.length, sb.center.all.length) + '%)' + (sb.off ? '. ' + sb.off + ' more aren’t on the map.' : '.') : '';
    }
    if (cfg.type === 'table') {
      const tb = tableRows(); if (!tb.n) return '';
      const tk = tb.ctx.tk, over = tb.list.filter((x) => !x.done && x.due && x.due < tk).length, soon = tb.list.filter((x) => !x.done && x.due && x.due >= tk && x.due <= D.addKey(tk, 6)).length, done = tb.list.filter((x) => x.done).length;
      const sf = tb.sort.k === 'title' ? 'task name' : (colField(tb.sort.k).words || colField(tb.sort.k).label.toLowerCase());
      return tb.n + (tb.n === 1 ? ' task' : ' tasks') + (over ? ', ' + over + ' overdue' : '') + (soon ? ', ' + soon + ' due in the next 7 days' : '') + (done ? ', ' + done + ' done' : '') + '. Sorted by ' + sf + (tb.sort.d > 0 ? (['due', 'created', 'completed'].includes(tb.sort.k) ? ', earliest first' : '') : (NUMS[tb.sort.k] ? ', highest first' : ['due', 'created', 'completed'].includes(tb.sort.k) ? ', latest first' : ', reversed')) + '.';
    }
    if (cfg.type === 'handoff') {
      const h = handoffData(); if (!h.pairs.length) return '';
      const big = h.links.slice().sort((a, c) => c.tasks.length - a.tasks.length)[0];
      const fromMe = h.pairs.filter((q) => q.a === 'Me' && q.b !== 'Me').length, toMe = h.pairs.filter((q) => q.b === 'Me' && q.a !== 'Me').length;
      const late = h.pairs.filter((q) => !q.t.done && q.t.due && q.t.due < D.todayKey()).length;
      const who = (x) => (x === 'Me' ? 'you' : x);
      return 'The biggest flow is ' + (big.a === big.b ? 'tasks ' + who(big.a) + ' kept' : who(big.a) + ' → ' + who(big.b)) + ' (' + big.tasks.length + ' of ' + h.pairs.length + '). You handed out ' + fromMe + ' and were given ' + toMe + '.' + (late ? ' ' + late + ' of these ' + (late === 1 ? 'is' : 'are') + ' overdue.' : '');
    }
    const b = build();
    if (!b.n) return '';
    if (cfg.type === 'scatter') {
      const ps = b.points; if (ps.length < 3) return '';
      const mx = ps.reduce((a, p) => a + p.x, 0) / ps.length, my = ps.reduce((a, p) => a + p.y, 0) / ps.length;
      const sxy = ps.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0), sxx = ps.reduce((a, p) => a + (p.x - mx) ** 2, 0), syy = ps.reduce((a, p) => a + (p.y - my) ** 2, 0);
      const r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
      const X = NUMS[cfg.x].label.toLowerCase(), Y = NUMS[cfg.y].label.toLowerCase();
      return Math.abs(r) < 0.2 ? 'No clear link between ' + X + ' and ' + Y + ' across ' + ps.length + ' tasks.' : 'Tasks with more ' + X + ' tend to have ' + (r > 0 ? 'more' : 'fewer') + ' ' + Y + ' (' + (Math.abs(r) > 0.6 ? 'strong' : 'moderate') + ' pattern, ' + ps.length + ' tasks).';
    }
    if (b.flow) {
      const v = (key) => (b.series.find((x) => x.key === key) || { values: [] }).values;
      const last = b.cats.length - 1;
      if (cfg.type === 'burnup') {
        const open = v('open'), added = v('added')[last] - v('added')[0], done = v('done')[last] - v('done')[0];
        const d = open[last] - open[0];
        return 'Over this period you added ' + added + ' and finished ' + done + '. Your open list ' + (d > 0 ? 'grew by ' + d : d < 0 ? 'shrank by ' + -d : 'held steady') + ', to ' + open[last] + '.';
      }
      const over = v('over'), o0 = over[0], o1 = over[last];
      return o1 + ' task' + (o1 === 1 ? ' is' : 's are') + ' overdue now' + (o1 === o0 ? ', the same as at the start.' : ', ' + (o1 > o0 ? 'up' : 'down') + ' from ' + o0 + ' at the start.');
    }
    if (!b.cats.length) return '';
    const parts = [];
    if (b.solo) { const one = b.series[0]; parts.push('Showing ' + one.label + ' only.'); }
    else if (b.soloCat) { const c = b.cats.find((x) => x.key === b.soloCat), i = b.cats.indexOf(c), tt = b.series.reduce((a, x) => a + (x.values[i] || 0), 0), all = b.cats.reduce((a, x, k) => a + b.series.reduce((q, y) => q + (y.values[k] || 0), 0), 0); return c.label + ': ' + amt(tt) + (isCount && all ? ', ' + pct(tt, all) + '% of ' + all + '.' : '.'); }
    const xd = DIMS[cfg.x];
    const tot = b.cats.map((c, i) => b.series.reduce((a, sr) => a + (sr.values[i] || 0), 0));
    if (xd.time && b.cats.length > 1 && b.series.length === 1) {
      const vals = b.series[0].values, idx = vals.map((x, i) => (x == null ? -1 : i)).filter((i) => i >= 0);
      if (idx.length > 1) {
        const peak = idx.reduce((a, i) => (vals[i] > vals[a] ? i : a), idx[0]);
        const half = Math.floor(idx.length / 2), avg = (arr) => arr.reduce((a, i) => a + vals[i], 0) / arr.length;
        const a1 = avg(idx.slice(0, half)), a2 = avg(idx.slice(half));
        parts.push('Peak: ' + b.cats[peak].label + ' (' + amt(vals[peak]) + ').');
        if (a1 || a2) parts.push('The recent half averages ' + fmt(a2, unit) + ' vs ' + fmt(a1, unit) + ' before' + (Math.abs(a2 - a1) < 0.05 * Math.max(a1, a2, 1) ? ', about the same.' : a2 > a1 ? ', higher.' : ', lower.'));
      }
    } else {
      const order = tot.map((v, i) => i).sort((a, c) => tot[c] - tot[a]);
      const top = order[0], all = tot.reduce((a, c) => a + c, 0);
      if (tot[top] != null) {
        parts.push(b.cats[top].label + ' leads with ' + amt(tot[top]) + (isCount && all && b.cats.length > 1 ? ' (' + pct(tot[top], all) + '% of ' + all + ')' : '') + '.');
        if (b.series.length > 1) {
          const j = b.series.reduce((a, sr, k) => ((sr.values[top] || 0) > (b.series[a].values[top] || 0) ? k : a), 0);
          parts.push('Most of it is ' + b.series[j].label + '.');
        } else if (b.cats.length > 2 && tot[order[order.length - 1]] != null) parts.push('Lowest: ' + b.cats[order[order.length - 1]].label + ' (' + fmt(tot[order[order.length - 1]], unit) + ').');
      }
    }
    if (b.prev && b.prev.total != null && b.total != null) {
      const d = b.total - b.prev.total;
      parts.push((isCount ? 'In total ' : 'Overall ') + fmt(b.total, unit) + ' vs ' + fmt(b.prev.total, unit) + ' in the previous ' + RANGE_WORDS[curRange()] + (b.prev.total >= 5 ? ' (' + (d >= 0 ? '+' : '') + Math.round((d / b.prev.total) * 100) + '%).' : '.'));
    }
    if (hasGoal()) {
      const vals = b.cats.map((c, i) => (b.series.length === 1 ? b.series[0].values[i] : cfg.stack ? tot[i] : null)).filter((x) => x != null);
      if (vals.length) parts.push('Goal met in ' + vals.filter(meets).length + ' of ' + vals.length + '.');
    }
    return parts.join(' ');
  }
  function summaryHtml() { const t = summaryText(); return t ? '<p class="cb-summary">' + icon('sparkle') + '<span>' + esc(t) + '</span></p>' : ''; }

  function chip(id, where) {
    const f = colField(id);
    const picked = where === 'tray' && ui.picked === id;
    return '<button type="button" class="cb-chip ' + (isNum(id) ? 'num' : 'dim') + (picked ? ' picked' : '') + '" data-field="' + id + '" data-from="' + where + '" aria-pressed="' + picked + '">' +
      icon(f.ic) + '<span>' + esc(f.label) + '</span>' + (where !== 'tray' ? '<span class="cb-x" data-clear="' + where + '" aria-label="Remove ' + esc(f.label) + '">' + icon('x') + '</span>' : '') + '</button>';
  }
  function colsZone() {
    const cols = tCols();
    const chipC = (c, i) => { const f = colField(c); return '<span class="cb-chip col ' + (NUMS[c] ? 'num' : 'dim') + '" data-field="' + c + '" data-from="colsz">' + icon(f.ic) + '<span>' + esc(f.label) + '</span>' +
      '<span class="cb-colmv">' + (i > 0 ? '<button type="button" data-colmove="' + c + ':-1" aria-label="Move ' + esc(f.label) + ' left">' + icon('chevL') + '</button>' : '') + (i < cols.length - 1 ? '<button type="button" data-colmove="' + c + ':1" aria-label="Move ' + esc(f.label) + ' right">' + icon('chevR') + '</button>' : '') + '</span>' +
      '<span class="cb-x" data-clear="cols:' + c + '" role="button" tabindex="0" aria-label="Remove ' + esc(f.label) + ' column">' + icon('x') + '</span></span>'; };
    return '<div class="cb-zone cb-colzone' + (ui.picked ? ' ready' : '') + '" data-zone="cols" tabindex="0" role="button" aria-label="Columns">' +
      '<span class="cb-zone-label">Columns</span><div class="cb-colchips"><span class="cb-chip fixed">' + icon('list') + '<span>Task</span></span>' + cols.map(chipC).join('') + '</div>' +
      '<span class="cb-zone-empty">' + (ui.picked ? 'Tap here to add it as a column' : 'Drag a field here, or tap a field and then tap here') + '</span>' +
      '<div class="cb-addcol"><label class="cb-select"><span class="sr">Add a column</span><select data-addcol><option value="">+ Add a column</option>' +
      Object.keys(DIMS).filter((k) => !cols.includes(k) && (!DIMS[k].map || (C.map && C.map.nodes().length))).map((k) => '<option value="' + k + '">' + esc(DIMS[k].label) + '</option>').join('') +
      Object.keys(NUMS).filter((k) => k !== 'count' && !cols.includes(k)).map((k) => '<option value="' + k + '">' + esc(NUMS[k].label) + '</option>').join('') +
      Object.keys(EXTRA_COLS).filter((k) => !cols.includes(k)).map((k) => '<option value="' + k + '">' + esc(EXTRA_COLS[k].label) + '</option>').join('') +
      '</select>' + icon('chevD') + '</label></div>' +
      (ui.flash && ui.flashZone === 'cols' ? '<span class="cb-zone-msg" role="alert">' + esc(ui.flash) + '</span>' : '') + '</div>';
  }
  function zone(z, label, off) {
    const id = cfg[z];
    return '<div class="cb-zone' + (off ? ' off' : '') + (ui.picked ? ' ready' : '') + '" data-zone="' + z + '" tabindex="0" role="button" aria-label="' + esc(label) + (id ? ': ' + esc(field(id).label) : ', empty') + '">' +
      '<span class="cb-zone-label">' + esc(label) + '</span>' +
      (off ? '<span class="cb-zone-empty">Not used by this chart</span>' : id ? chip(id, z) : '<span class="cb-zone-empty">' + (ui.picked ? 'Tap to place here' : (z === 'x' && cfg.type === 'kpi' ? 'Optional: Completed, Created or Due date' : 'Drop a field here')) + '</span>') +
      (ui.flash && ui.flashZone === z ? '<span class="cb-zone-msg" role="alert">' + esc(ui.flash) + '</span>' : '') + '</div>';
  }
  function sel(key, opts) {
    return '<label class="cb-select"><span class="sr">' + key + '</span><select data-cfg="' + key + '">' + opts.map(([v, l]) => '<option value="' + v + '"' + (cfg[key] === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' + icon('chevD') + '</label>';
  }
  function goalNote(b) {
    if (!hasGoal() || !b.cats) return '';
    const vals = b.cats.map((c, i) => (cfg.series && cfg.stack && cfg.type !== 'line' ? b.series.reduce((a, s) => a + (s.values[i] || 0), 0) : b.series.length === 1 ? b.series[0].values[i] : null)).filter((v) => v != null);
    const met = vals.filter(meets).length;
    return '<span class="cb-goal-key"><i class="lg-goal"></i>Goal ' + (cfg.goalDir === 'atMost' ? '≤ ' : '≥ ') + fmt(+cfg.goal, NUMS[cfg.y].unit) + (vals.length ? ' · met in ' + met + ' of ' + vals.length : '') + '</span>';
  }
  function legendHtml() {
    if (problem()) return '';
    if (cfg.type === 'kpi' || cfg.type === 'table') return '';
    if (cfg.type === 'sunburst') { const sb = sunData(); return sb ? sb.legend.map((c) => '<span><i class="lg-bar" style="--c:' + c.hex + '"></i>' + esc(c.name) + '</span>').join('') + (sb.off ? '<span class="muted">' + sb.off + ' not on the map</span>' : '') : ''; }
    if (cfg.type === 'handoff') { const h = handoffData(); return h.people.length > 1 ? lgItems(h.people.map((p) => [p, h.colors[p], p]), h.people.includes(solo) ? solo : null) : ''; }
    const b = build();
    if (cfg.type === 'scatter') return cfg.series ? lgItems(b.keys.map((k) => [k, b.colors[k], k]), b.solo) : '';
    const all = b.allSeries || b.series;
    if (cfg.type === 'pie' || cfg.type === 'donut' || b.colorByCat || (cfg.type === 'treemap' && all.length < 2)) return lgItems(b.cats.slice(0, 12).map((c) => [c.key, c.color, c.label]), b.soloCat);
    return (all.length > 1 ? lgItems(all.map((x) => [x.key, x.color, x.label]), b.solo) : '') +
      (b.prev ? '<span><i class="lg-ghost"></i>Previous ' + RANGE_WORDS[curRange()] + '</span>' : '') +
      (b.trend ? '<span><i class="lg-trend"></i>' + (cfg.trend === 'avg' ? 'Rolling average' : 'Trend') + '</span>' : '') + goalNote(b);
  }
  /** legend entries you can click: the first click shows only that one, the next shows all again */
  function lgItems(items, on) {
    return items.map(([key, color, label]) => '<button type="button" class="lg-item' + (on ? (on === key ? ' on' : ' off') : '') + '" data-legend="' + esc(key) + '" aria-pressed="' + (on === key) + '" title="' + (on === key ? 'Show all' : 'Show only ' + esc(label)) + '"><i class="lg-bar" style="--c:' + color + '"></i>' + esc(label) + '</button>').join('') +
      (on ? '<button type="button" class="lg-all" data-legend="">Show all</button>' : '');
  }
  /** under a time chart: the zoomed range with a way back, or (in the builder) how to zoom */
  function zoomHtml(hint) {
    if (problem() || !zoomable()) return '';
    const b = build();
    if (b.zoomed) return '<div class="cb-zoombar">' + icon('search') + '<span>Zoomed to <b>' + esc(b.zoomed.from) + ' – ' + esc(b.zoomed.to) + '</b></span><button type="button" class="btn sm ghost" data-unzoom>Show all dates</button></div>';
    return hint && b.cats && b.cats.length > 3 ? '<p class="cb-zoomhint muted">Drag across the chart to zoom into a stretch of dates.</p>' : '';
  }
  /* ---------- drawing ---------- */
  const tip = (s) => ' data-tip="' + esc(s) + '"';
  function plot(mini, size) {
    const p = problem();
    if (p) return '<div class="cb-empty">' + typeSvg(TYPES.find((t) => t[0] === cfg.type)[2]) + '<p>' + esc(p) + '</p></div>';
    const narrow = !mini && matchMedia('(max-width: 640px)').matches;
    const W = size ? size.W : mini ? 420 : narrow ? 360 : 680, H = size ? size.H : mini ? 240 : narrow ? 280 : 360;
    if (cfg.type === 'kpi') return kpi(size && size.kpi);
    if (cfg.type === 'sunburst') return sunburst(W, H);
    if (cfg.type === 'handoff') return handoff(W, H, mini);
    if (cfg.type === 'table') return table(!!size);
    const b = build();
    if (!b.n) return '<div class="cb-empty"><p>' + noneMsg() + '</p></div>';
    if (cfg.type === 'burnup') return xy(b, W, H, mini, { as: 'line', stacked: false });
    if (cfg.type === 'cfd') return xy(b, W, H, mini, { as: 'area', stacked: true });
    if (cfg.type === 'scatter') return scatter(b, W, H, mini);
    if (!b.cats.length) return '<div class="cb-empty"><p>No values to show with these fields and filters.</p></div>';
    if (cfg.type === 'pie' || cfg.type === 'donut') return pie(b, W, H, mini);
    if (cfg.type === 'treemap') return treemap(b, W, H, mini);
    if (cfg.type === 'bar') return barH(b, W, H, mini);
    return xy(b, W, H, mini);
  }
  const noneMsg = () => (S().state.tasks.length && S().state.tasks.every((t) => t.sample) ? 'Charts leave out the example tasks. Add your own tasks, or choose “Keep them” on the Tasks page to count the examples.' : 'No tasks match these filters.');
  const svgOpen = (W, H, label, extra) => '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="' + esc(label) + '"' + (extra || '') + '>';
  const fadeCls = (b, key) => (b.soloCat && key !== b.soloCat ? ' faded' : '');
  function niceMax(v) {
    if (v <= 0) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(v))), m = v / e;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e;
  }
  function yRange(b, stacked) {
    let lo = 0, hi = 0;
    b.cats.forEach((c, i) => {
      if (stacked) { let pos = 0, neg = 0; b.series.forEach((s) => { const v = s.values[i] || 0; if (v >= 0) pos += v; else neg += v; }); hi = Math.max(hi, pos); lo = Math.min(lo, neg); }
      else b.series.forEach((s) => { const v = s.values[i]; if (v != null) { hi = Math.max(hi, v); lo = Math.min(lo, v); } });
    });
    if (cfg.y === 'onTime') hi = 100;
    if (b.prev) b.prev.values.forEach((v) => { if (v != null) hi = Math.max(hi, v); });
    if (b.trend) b.trend.forEach((v) => { if (v != null) { hi = Math.max(hi, v); lo = Math.min(lo, v); } });
    if (hasGoal()) hi = Math.max(hi, +cfg.goal * 1.08);
    const counts = cfg.y === 'count' || FLOW_TYPES.includes(cfg.type);
    return { lo: lo < 0 ? -niceMax(-lo) : 0, hi: cfg.y === 'onTime' ? Math.max(100, niceMax(hi)) : counts && hi <= 4 ? 4 : niceMax(hi) };
  }
  /** whole-number scales get whole-number ticks (0, 1, 2… not 1.3, 2.5) */
  function tickSteps(lo, hi, unit, steps) {
    const span = hi - lo;
    if (unit === '%' || !Number.isInteger(span) || span % steps === 0) return steps;
    return [4, 5, 3, 2, 1].find((k) => span % k === 0 && k <= steps + 1) || steps;
  }
  function gridY(L, R, W, y, lo, hi, unit, steps) {
    steps = tickSteps(lo, hi, unit, steps);
    let g = '';
    for (let i = 0; i <= steps; i++) {
      const v = lo + ((hi - lo) / steps) * i;
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="grid' + (v === 0 && lo < 0 ? ' zero' : '') + '"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" class="ax" text-anchor="end">' + fmt(v, unit) + '</text>';
    }
    return g;
  }
  const valTip = (cat, s, v, multi) => { const y = FLOW_TYPES.includes(cfg.type) ? 'count' : cfg.y; return cat + (multi ? ' · ' + s : '') + ': ' + fmt(v, NUMS[y].unit) + (y === 'count' ? (v === 1 ? ' task' : ' tasks') : ''); };

  // a full-height hit area per category, so thin bars are still easy to tap (opens every task in that category)
  const catTotal = (b, i) => { const n = b.raw.filter((r) => r.x === b.cats[i].key).length; return b.cats[i].label + ': ' + n + (n === 1 ? ' task' : ' tasks'); };
  /* columns, lines, areas */
  function xy(b, W, H, mini, o) {
    const as = (o && o.as) || cfg.type;
    const unit = b.flow ? '' : NUMS[cfg.y].unit, multi = b.series.length > 1;
    const stacked = o ? !!o.stacked : multi && cfg.stack && cfg.type !== 'line';
    const L = 40, R = 8, T = 12, B = 30;
    const { lo, hi } = yRange(b, stacked);
    const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    const n = b.cats.length, cw = (W - L - R) / n;
    const zAttr = !mini && zoomable() && n > 2 ? ' data-zoom="' + [L, R, n, W, T, H - B].join(',') + '"' : '';
    let s = svgOpen(W, H, autoTitle(), zAttr) + gridY(L, R, W, y, lo, hi, unit, mini ? 2 : 4);
    const maxLabels = Math.floor((W - L - R) / (mini ? 52 : 64));
    const every = Math.max(1, Math.ceil(n / maxLabels));
    b.cats.forEach((c, i) => {
      if ((n - 1 - i) % every === 0) {
        const lab = c.label.length > 12 ? c.label.slice(0, 11) + '…' : c.label;
        s += '<text x="' + (L + cw * i + cw / 2) + '" y="' + (H - 9) + '" class="ax" text-anchor="middle">' + esc(lab) + '</text>';
      }
    });
    const goalOn = hasGoal(), catTot = (i) => b.series.reduce((a, s2) => a + (s2.values[i] || 0), 0);
    const missCls = (v, i) => (!goalOn ? '' : (stacked ? meets(catTot(i)) : meets(v)) ? ' hit-goal' : ' miss');
    if (as === 'column') {
      const groupW = Math.min(cw * 0.78, multi && !stacked ? 18 * b.series.length + 10 : 48);
      b.cats.forEach((c, i) => {
        const x0 = L + cw * i + (cw - groupW) / 2;
        s += '<rect class="hit" x="' + (L + cw * i).toFixed(1) + '" y="' + T + '" width="' + cw.toFixed(1) + '" height="' + (H - T - B) + '" data-seg="' + i + ':*"' + tip(catTotal(b, i)) + '/>';
        if (b.prev && b.prev.values[i] != null && b.prev.values[i] > 0) { const pv = b.prev.values[i], gw = Math.min(cw * 0.9, groupW + 12); s += '<rect class="cb-ghost" x="' + (L + cw * i + (cw - gw) / 2).toFixed(1) + '" y="' + y(pv).toFixed(1) + '" width="' + gw.toFixed(1) + '" height="' + Math.max(1, y(0) - y(pv)).toFixed(1) + '" rx="4"/>'; }
        let pos = 0, neg = 0;
        b.series.forEach((ser, j) => {
          const v = ser.values[i]; if (v == null || v === 0) return;
          const col = b.colorByCat ? c.color : ser.color;
          let top, bot, x, w;
          if (stacked) { if (v >= 0) { bot = pos; pos += v; top = pos; } else { top = neg; neg += v; bot = neg; } x = x0; w = groupW; }
          else { top = Math.max(v, 0); bot = Math.min(v, 0); w = groupW / b.series.length; x = x0 + w * j; w = Math.max(2, w - (multi ? 2 : 0)); }
          s += '<rect class="cb-bar' + missCls(v, i) + fadeCls(b, c.key) + '" x="' + x.toFixed(1) + '" y="' + y(top).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, y(bot) - y(top)).toFixed(1) + '" rx="' + Math.min(4, w / 4) + '" style="--c:' + col + '" tabindex="0" data-seg="' + i + ':' + j + '"' + tip(valTip(c.label, ser.label, v, multi)) + '/>';
        });
      });
    } else {
      const cum = b.cats.map(() => 0);
      const layers = b.series.map((ser) => {
        const pts = ser.values.map((v, i) => {
          const base = stacked ? cum[i] : 0;
          const val = v == null ? (stacked ? 0 : null) : v;
          if (stacked && val != null) cum[i] += val;
          return val == null ? null : { x: L + cw * i + cw / 2, y: y(base + val), y0: y(base), v: val, i };
        });
        return { ser, pts };
      });
      if (b.prev) { const gp = b.prev.values.map((v, i) => (v == null ? null : (L + cw * i + cw / 2).toFixed(1) + ',' + y(v).toFixed(1))).filter(Boolean); if (gp.length > 1) s += '<polyline class="cb-ghost-line" points="' + gp.join(' ') + '"/>'; }
      (as === 'area' ? layers.slice().reverse() : layers).forEach(({ ser, pts }) => {
        const segs = []; let cur = [];
        pts.forEach((p) => { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } });
        if (cur.length) segs.push(cur);
        segs.forEach((sg) => {
          const line = sg.map((p) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
          if (as === 'area') {
            const back = sg.slice().reverse().map((p) => p.x.toFixed(1) + ',' + (stacked ? p.y0 : y(Math.max(lo, 0))).toFixed(1)).join(' ');
            s += '<polygon points="' + line + ' ' + back + '" class="cb-area" style="--c:' + ser.color + '"/>';
          }
          s += '<polyline points="' + line + '" class="cb-line" style="--c:' + ser.color + '"/>';
        });
      });
      layers.forEach(({ ser, pts }, j) => pts.forEach((p) => {
        if (!p) return;
        s += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (n > 30 ? 2.5 : 4) + '" class="cb-dot' + missCls(ser.values[p.i], p.i) + '" style="--c:' + ser.color + '" tabindex="0" data-seg="' + p.i + ':' + j + '"' + tip(valTip(b.cats[p.i].label, ser.label, ser.values[p.i], multi)) + '/>';
      }));
    }
    if (b.trend) { const tp = b.trend.map((v, i) => (v == null ? null : (L + cw * i + cw / 2).toFixed(1) + ',' + y(v).toFixed(1))).filter(Boolean); if (tp.length > 1) s += '<polyline class="cb-trendline" points="' + tp.join(' ') + '"/>'; }
    if (goalOn) { const gy = y(+cfg.goal); s += '<line class="cb-goal" x1="' + L + '" x2="' + (W - R) + '" y1="' + gy.toFixed(1) + '" y2="' + gy.toFixed(1) + '"/><text class="cb-goal-lab" x="' + (W - R - 2) + '" y="' + (gy - 5).toFixed(1) + '" text-anchor="end">Goal ' + fmt(+cfg.goal, unit) + '</text>'; }
    return s + '</svg>';
  }

  /* horizontal bars */
  function barH(b, W, H, mini) {
    const unit = NUMS[cfg.y].unit, multi = b.series.length > 1, stacked = multi && cfg.stack;
    const n = b.cats.length;
    const rowH = Math.max(mini ? 16 : 22, Math.min(46, ((H - 30) / n)));
    H = Math.max(H, n * rowH + 34);
    const L = Math.min(W * 0.32, 130), R = 34, T = 6, B = 24;
    const { lo, hi } = yRange(b, stacked);
    const x = (v) => L + (W - L - R) * ((v - lo) / (hi - lo));
    let s = svgOpen(W, H, autoTitle());
    const xs = tickSteps(lo, hi, unit, 4);
    for (let i = 0; i <= xs; i++) { const v = lo + ((hi - lo) / xs) * i; s += '<line y1="' + T + '" y2="' + (H - B) + '" x1="' + x(v) + '" x2="' + x(v) + '" class="grid"/><text y="' + (H - 8) + '" x="' + x(v) + '" class="ax" text-anchor="middle">' + fmt(v, unit) + '</text>'; }
    const rh = (H - T - B) / n;
    b.cats.forEach((c, i) => {
      const y0 = T + rh * i, bh = Math.min(rh * 0.7, multi && !stacked ? 9 * b.series.length + 4 : 26), yy = y0 + (rh - bh) / 2;
      s += '<rect class="hit" x="0" y="' + y0.toFixed(1) + '" width="' + W + '" height="' + rh.toFixed(1) + '" data-seg="' + i + ':*"' + tip(catTotal(b, i)) + '/>';
      const lab = c.label.length > 16 ? c.label.slice(0, 15) + '…' : c.label;
      s += '<text x="' + (L - 8) + '" y="' + (y0 + rh / 2 + 4) + '" class="ax lab" text-anchor="end">' + esc(lab) + '</text>';
      if (b.prev && b.prev.values[i] != null && b.prev.values[i] > 0) s += '<rect class="cb-ghost" y="' + (yy - 3).toFixed(1) + '" x="' + x(0).toFixed(1) + '" height="' + (bh + 6).toFixed(1) + '" width="' + Math.max(1, x(b.prev.values[i]) - x(0)).toFixed(1) + '" rx="4"/>';
      let pos = 0, neg = 0, total = 0;
      b.series.forEach((ser, j) => {
        const v = ser.values[i]; if (v == null || v === 0) return;
        total += v;
        const col = b.colorByCat ? c.color : ser.color;
        let a, z, yy2 = yy, h = bh;
        if (stacked) { if (v >= 0) { a = pos; pos += v; z = pos; } else { z = neg; neg += v; a = neg; } }
        else { a = Math.min(v, 0); z = Math.max(v, 0); h = bh / b.series.length; yy2 = yy + h * j; h = Math.max(2, h - (multi ? 1.5 : 0)); }
        s += '<rect class="cb-bar' + fadeCls(b, c.key) + (hasGoal() ? ((stacked ? meets(b.series.reduce((q, s2) => q + (s2.values[i] || 0), 0)) : meets(v)) ? ' hit-goal' : ' miss') : '') + '" y="' + yy2.toFixed(1) + '" x="' + x(a).toFixed(1) + '" height="' + h.toFixed(1) + '" width="' + Math.max(1, x(z) - x(a)).toFixed(1) + '" rx="' + Math.min(4, h / 4) + '" style="--c:' + col + '" tabindex="0" data-seg="' + i + ':' + j + '"' + tip(valTip(c.label, ser.label, v, multi)) + '/>';
      });
      if (!multi || stacked) { const v = stacked ? total : b.series[0].values[i]; if (v != null) s += '<text x="' + (x(Math.max(stacked ? pos : v, 0)) + 5) + '" y="' + (yy + bh / 2 + 4) + '" class="ax val">' + fmt(v, unit) + '</text>'; }
    });
    if (hasGoal()) { const gx = x(+cfg.goal); s += '<line class="cb-goal" y1="' + T + '" y2="' + (H - B) + '" x1="' + gx.toFixed(1) + '" x2="' + gx.toFixed(1) + '"/><text class="cb-goal-lab" x="' + (gx + 4).toFixed(1) + '" y="' + (T + 10) + '">Goal ' + fmt(+cfg.goal, unit) + '</text>'; }
    return s + '</svg>';
  }

  /* pies & donuts */
  function pie(b, W, H, mini) {
    const vals = b.cats.map((c, i) => ({ c, i, v: Math.max(0, b.series[0].values[i] || 0) })).filter((x) => x.v > 0);
    const total = vals.reduce((a, x) => a + x.v, 0);
    if (!total) return '<div class="cb-empty"><p>Nothing to slice: every value is zero.</p></div>';
    const r = Math.min(W, H) / 2 - 12, cx = W / 2, cy = H / 2, ir = cfg.type === 'donut' ? r * 0.58 : 0;
    let a0 = -Math.PI / 2, s = svgOpen(W, H, autoTitle());
    const pt = (a, rr) => (cx + rr * Math.cos(a)).toFixed(2) + ' ' + (cy + rr * Math.sin(a)).toFixed(2);
    vals.forEach(({ c, v, i }) => {
      const frac = v / total, a1 = a0 + frac * Math.PI * 2, big = frac > 0.5 ? 1 : 0;
      const label = c.label + ': ' + fmt(v, NUMS[cfg.y].unit) + ' (' + Math.round(frac * 100) + '%)';
      let d;
      if (frac >= 0.9999) d = ir ? 'M' + pt(0, r) + 'A' + r + ' ' + r + ' 0 1 1 ' + pt(Math.PI, r) + 'A' + r + ' ' + r + ' 0 1 1 ' + pt(0, r) + 'M' + pt(0, ir) + 'A' + ir + ' ' + ir + ' 0 1 0 ' + pt(Math.PI, ir) + 'A' + ir + ' ' + ir + ' 0 1 0 ' + pt(0, ir) + 'Z'
        : 'M' + pt(0, r) + 'A' + r + ' ' + r + ' 0 1 1 ' + pt(Math.PI, r) + 'A' + r + ' ' + r + ' 0 1 1 ' + pt(0, r) + 'Z';
      else d = 'M' + pt(a0, r) + 'A' + r + ' ' + r + ' 0 ' + big + ' 1 ' + pt(a1, r) + (ir ? 'L' + pt(a1, ir) + 'A' + ir + ' ' + ir + ' 0 ' + big + ' 0 ' + pt(a0, ir) : 'L' + cx + ' ' + cy) + 'Z';
      s += '<path d="' + d + '" class="cb-slice' + fadeCls(b, c.key) + '" fill-rule="evenodd" style="--c:' + c.color + '" tabindex="0" data-seg="' + i + ':0"' + tip(label) + '/>';
      if (frac > 0.07 && !mini) {
        const mid = (a0 + a1) / 2, lr = ir ? (r + ir) / 2 : r * 0.62;
        s += '<text x="' + (cx + lr * Math.cos(mid)) + '" y="' + (cy + lr * Math.sin(mid) + 4) + '" class="cb-slice-lab" text-anchor="middle">' + Math.round(frac * 100) + '%</text>';
      }
      a0 = a1;
    });
    const one = b.soloCat && vals.find((x) => x.c.key === b.soloCat);
    if (ir && one) s += '<text x="' + cx + '" y="' + (cy - 2) + '" class="cb-donut-num" text-anchor="middle">' + Math.round((one.v / total) * 100) + '%</text><text x="' + cx + '" y="' + (cy + 18) + '" class="ax" text-anchor="middle">' + esc(clip(one.c.label, ir * 1.6)) + '</text>';
    else if (ir) s += '<text x="' + cx + '" y="' + (cy - 2) + '" class="cb-donut-num" text-anchor="middle">' + fmt(total, NUMS[cfg.y].unit === '%' ? '' : NUMS[cfg.y].unit) + '</text><text x="' + cx + '" y="' + (cy + 18) + '" class="ax" text-anchor="middle">' + (cfg.y === 'count' ? 'tasks' : 'total') + '</text>';
    return s + '</svg>';
  }

  /* scatter */
  function scatter(b, W, H, mini) {
    if (!b.points.length) return '<div class="cb-empty"><p>No tasks have both of these values yet. Days to complete only exists for finished tasks, and Days late needs a due date.</p></div>';
    const X = NUMS[cfg.x], Y = NUMS[cfg.y];
    const L = 40, R = 12, T = 12, B = 40;
    const xs = b.points.map((p) => p.x), ys = b.points.map((p) => p.y);
    const xlo = Math.min(0, ...xs) < 0 ? -niceMax(-Math.min(...xs)) : 0, xhi = niceMax(Math.max(...xs, 4));
    const ylo = Math.min(0, ...ys) < 0 ? -niceMax(-Math.min(...ys)) : 0, yhi = niceMax(Math.max(...ys, 4));
    const x = (v) => L + (W - L - R) * ((v - xlo) / (xhi - xlo)), y = (v) => T + (H - T - B) * (1 - (v - ylo) / (yhi - ylo));
    let s = svgOpen(W, H, autoTitle()) + gridY(L, R, W, y, ylo, yhi, Y.unit, 4);
    for (let i = 0; i <= 4; i++) { const v = xlo + ((xhi - xlo) / 4) * i; s += '<text x="' + x(v) + '" y="' + (H - 22) + '" class="ax" text-anchor="middle">' + fmt(v, X.unit) + '</text>'; }
    s += '<text x="' + (L + (W - L - R) / 2) + '" y="' + (H - 4) + '" class="ax lab" text-anchor="middle">' + esc(X.label) + ' →</text>';
    // a little jitter so tasks with identical values don't hide each other
    let seed = 1; const jit = () => { seed = (seed * 9301 + 49297) % 233280; return (seed / 233280 - 0.5) * 6; };
    b.points.forEach((p, k) => {
      s += '<circle cx="' + (x(p.x) + jit()).toFixed(1) + '" cy="' + (y(p.y) + jit()).toFixed(1) + '" r="' + (mini ? 3.5 : 5) + '" class="cb-pt" style="--c:' + b.colors[p.s] + '" tabindex="0" data-seg="p' + k + '"' +
        tip(p.t.title + ' · ' + X.label + ' ' + fmt(p.x, X.unit) + ', ' + Y.label + ' ' + fmt(p.y, Y.unit) + (cfg.series ? ' · ' + p.s : '')) + '/>';
    });
    return s + '</svg>';
  }

  /* ---------- table: one row per task, with the columns you choose ---------- */
  const shortDate = (k) => (k ? C.F.short.format(D.parse(k)) : '');
  /** one cell: v sorts, h is the HTML, txt is for CSV and pictures */
  function cellOf(t, id, ctx) {
    const blank = { v: null, h: '<span class="muted">—</span>', txt: '' };
    if (id === 'title') return { v: (t.title || '').toLowerCase(), h: '<span class="cb-tt">' + esc(t.title || 'Untitled') + '</span>', txt: t.title || '' };
    if (id === 'time') return t.time ? { v: t.time, h: esc(C.fmtTime(t.time)), txt: C.fmtTime(t.time) } : blank;
    if (id === 'notes') { const n = (t.notes || '').replace(/\s+/g, ' ').trim(); return n ? { v: n.toLowerCase(), h: '<span class="cb-tnote">' + esc(n.length > 90 ? n.slice(0, 89) + '…' : n) + '</span>', txt: n } : blank; }
    if (id === 'type') { const ty = S().typeOf(t); return ty ? { v: S().state.types.indexOf(ty), h: '<span class="type-tag" style="--c:' + ty.color + '">' + icon(ty.glyph) + esc(ty.name) + '</span>', txt: ty.name } : blank; }
    if (id === 'level') { const l = S().levelOf(t); return l ? { v: S().levelRank(t.levelId), h: '<span class="cb-tlv" style="--c:' + l.color + '"><i class="dot"></i>' + esc(l.name) + '</span>', txt: l.name } : blank; }
    if (id === 'status') { const st = statusOf(t, ctx.tk); return { v: ['Overdue', 'Open', 'Done'].indexOf(st), h: '<span class="cb-tst ' + st.toLowerCase() + '">' + st + '</span>', txt: st }; }
    if (id === 'due') return t.due ? { v: t.due, h: '<span class="' + (!t.done && t.due < ctx.tk ? 'cb-tlate' : '') + '">' + esc(C.relDate(t.due)) + '</span>', txt: t.due } : blank;
    if (id === 'created' || id === 'completed') { const k = DIMS[id].get(t, ctx); return k ? { v: k, h: esc(shortDate(k)), txt: k } : blank; }
    if (id === 'steps') { const n = (t.subtasks || []).length; return n ? { v: n, h: (t.subtasks.filter((x) => x.done).length) + '/' + n, txt: t.subtasks.filter((x) => x.done).length + '/' + n } : blank; }
    if (id === 'onTime') { const v = NUMS.onTime.get(t, ctx); return v == null ? blank : { v, h: v ? '<span class="cb-tst done">On time</span>' : '<span class="cb-tst overdue">Late</span>', txt: v ? 'On time' : 'Late' }; }
    if (NUMS[id]) { const v = NUMS[id].get(t, ctx); return v == null || (['moved', 'pushed'].includes(id) && !v) ? (v === 0 ? { v: 0, h: '<span class="muted">0</span>', txt: '0' } : blank) : { v, h: '<span class="cb-tnum' + (id === 'late' && v > 0 ? ' cb-tlate' : '') + (id === 'moved' && v >= 3 ? ' cb-tlate' : '') + '">' + esc(fmt(v, NUMS[id].unit)) + '</span>', txt: fmt(v, NUMS[id].unit) }; }
    if (DIMS[id]) {
      const v = DIMS[id].get(t, ctx); if (v == null) return blank;
      const c = DIMS[id].color && DIMS[id].color(v);
      return { v: DIMS[id].order ? (DIMS[id].order().indexOf(v) + 1 || 999) + ':' + v : String(v).toLowerCase(), h: c && DIMS[id].map ? '<span class="cb-tlv" style="--c:' + c + '"><i class="dot"></i>' + esc(v) + '</span>' : esc(v), txt: String(v) };
    }
    return blank;
  }
  /** every matching task in table order, grouped when "Group rows by" is set */
  function tableRows() {
    const { list, ctx } = rows();
    const cols = ['title'].concat(tCols());
    const sort = cfg.sort && (cfg.sort.k === 'title' || colField(cfg.sort.k)) ? cfg.sort : { k: 'due', d: 1 };
    const key = (t) => cellOf(t, sort.k, ctx).v;
    const cmp = (a, b) => {
      const x = key(a), y = key(b);
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; // blanks last either way
      return (x < y ? -1 : x > y ? 1 : 0) * sort.d || (a.done - b.done) || String(a.due || '9999').localeCompare(String(b.due || '9999'));
    };
    const sorted = list.slice().sort(cmp);
    const gd = cfg.x && DIMS[cfg.x] && !DIMS[cfg.x].time ? DIMS[cfg.x] : cfg.x && DIMS[cfg.x] ? DIMS[cfg.x] : null;
    let groups = null;
    if (gd) {
      const m = new Map();
      sorted.forEach((t) => { const g = gd.get(t, ctx); const k = g == null ? '—' : gd.time ? timeLabel(timeBucket(g, 'month'), 'month') : g; if (!m.has(k)) m.set(k, []); m.get(k).push(t); });
      const keys = gd.time ? [...m.keys()] : orderKeys(gd, [...m.keys()]);
      groups = keys.map((k, i) => ({ key: k, color: gd.time ? null : colorFor(gd, k, i), tasks: m.get(k) }));
    }
    return { list: sorted, ctx, cols, sort, groups, n: list.length };
  }
  /** clicking a column header: sort by it; click again to flip. Numbers start biggest first */
  function nextSort(cur, k) {
    if (cur && cur.k === k) return { k, d: -cur.d };
    return { k, d: NUMS[k] || ['created', 'completed'].includes(k) ? -1 : 1 };
  }
  const LIMITS = { '10': 10, '25': 25, '50': 50, '100': 100, all: Infinity };
  function table(board) {
    const tb = tableRows();
    if (!tb.n) return '<div class="cb-empty"><p>' + noneMsg() + '</p></div>';
    const lim = typeof cfg.limit === 'number' ? cfg.limit : LIMITS[cfg.limit] || 25;
    const head = '<thead><tr><th class="cb-tchk"><span class="sr">Done</span></th>' + tb.cols.map((c) => {
      const on = tb.sort.k === c, f = c === 'title' ? { label: 'Task' } : colField(c);
      return '<th scope="col" class="' + (c === 'title' ? 'cb-ttitle' : '') + (NUMS[c] ? ' num' : '') + '" aria-sort="' + (on ? (tb.sort.d > 0 ? 'ascending' : 'descending') : 'none') + '"><button type="button" class="cb-tsort' + (on ? ' on' : '') + '" data-tsort="' + c + '">' + esc(f.label) + (on ? icon(tb.sort.d > 0 ? 'up' : 'down') : '') + '</button></th>';
    }).join('') + '</tr></thead>';
    let shown = 0;
    const rowHtml = (t) => { shown++; return '<tr class="cb-trow' + (t.done ? ' done' : '') + '" data-trow="' + t.id + '" tabindex="0"><td class="cb-tchk"><button type="button" class="check sm" data-tcheck="' + t.id + '" aria-pressed="' + !!t.done + '" aria-label="' + (t.done ? 'Reopen ' : 'Complete ') + esc(t.title) + '">' + icon('check') + '</button></td>' +
      tb.cols.map((c) => '<td class="' + (c === 'title' ? 'cb-ttitle' : '') + (NUMS[c] ? ' num' : '') + '">' + cellOf(t, c, tb.ctx).h + '</td>').join('') + '</tr>'; };
    let body = '';
    const span = tb.cols.length + 1;
    if (tb.groups) tb.groups.forEach((g) => {
      if (shown >= lim) return;
      body += '<tr class="cb-tgroup"><th colspan="' + span + '" scope="rowgroup">' + (g.color ? '<i class="dot" style="--c:' + g.color + '"></i>' : '') + esc(g.key) + ' <span class="muted">' + g.tasks.length + '</span></th></tr>';
      g.tasks.forEach((t) => { if (shown < lim) body += rowHtml(t); });
    });
    else tb.list.forEach((t) => { if (shown < lim) body += rowHtml(t); });
    const more = tb.n - shown;
    return '<div class="cb-twrap"><table class="cb-tbl' + (board ? ' board' : '') + '"><caption class="sr">' + esc(autoTitle()) + '</caption>' + head + '<tbody>' + body + '</tbody></table></div>' +
      (more > 0 ? '<button type="button" class="btn sm ghost cb-tmore" data-tmore>' + icon('list') + '<span>' + (board ? 'See all ' + tb.n + ' tasks' : 'Show all ' + tb.n + ' rows') + '</span></button>' : '');
  }

  /* ---------- treemap: boxes sized by value, optionally split into smaller boxes ---------- */
  /** squarified layout: items [{v}] → the same items with x, y, w, h filled in */
  function squarify(items, x, y, w, h) {
    const list = items.filter((q) => q.v > 0).sort((a, b) => b.v - a.v);
    const total = list.reduce((a, q) => a + q.v, 0);
    if (!total || w <= 0 || h <= 0) return [];
    const k = (w * h) / total;
    list.forEach((q) => (q.a = q.v * k));
    const out = [];
    let i = 0;
    while (i < list.length) {
      const side = Math.min(w, h);
      const worst = (row) => { const sm = row.reduce((a, q) => a + q.a, 0), mx = row[0].a, mn = row[row.length - 1].a; return Math.max((side * side * mx) / (sm * sm), (sm * sm) / (side * side * mn)); };
      const row = [list[i++]];
      while (i < list.length && worst(row.concat(list[i])) <= worst(row)) row.push(list[i++]);
      const sm = row.reduce((a, q) => a + q.a, 0);
      if (w >= h) { const cw = sm / h; let yy = y; row.forEach((q) => { const hh = q.a / cw; out.push(Object.assign(q, { x, y: yy, w: cw, h: hh })); yy += hh; }); x += cw; w -= cw; }
      else { const ch = sm / w; let xx = x; row.forEach((q) => { const ww = q.a / ch; out.push(Object.assign(q, { x: xx, y, w: ww, h: ch })); xx += ww; }); y += ch; h -= ch; }
    }
    return out;
  }
  const clip = (t, px) => { const max = Math.max(0, Math.floor(px / 6.6)); return t.length <= max ? t : max < 3 ? '' : t.slice(0, max - 1) + '…'; };
  function treemap(b, W, H, mini) {
    const unit = NUMS[cfg.y].unit, split = !!cfg.series;
    const groups = b.cats.map((c, i) => {
      const kids = b.series.map((ser, j) => ({ j, ser, v: Math.max(0, ser.values[i] || 0) })).filter((q) => q.v > 0);
      return { i, c, kids, v: kids.reduce((a, q) => a + q.v, 0) };
    });
    const boxes = squarify(groups, 0, 0, W, H);
    if (!boxes.length) return '<div class="cb-empty"><p>Nothing to show: every value is zero.</p></div>';
    const total = boxes.reduce((a, g) => a + g.v, 0);
    let s = svgOpen(W, H, autoTitle()), labs = '';
    const label = (x, y, w, h, t, v, big) => {
      if (w < 38 || h < (big ? 34 : 28)) return '';
      const t1 = clip(t, w - 12); if (!t1) return '';
      return '<text x="' + (x + 7).toFixed(1) + '" y="' + (y + 17).toFixed(1) + '" class="cb-tm-lab' + (big ? ' big' : '') + '">' + esc(t1) + '</text>' +
        (h >= 44 ? '<text x="' + (x + 7).toFixed(1) + '" y="' + (y + 32).toFixed(1) + '" class="cb-tm-lab sub">' + esc(fmt(v, unit)) + '</text>' : '');
    };
    boxes.forEach((g) => {
      const pctTxt = ' (' + Math.round((g.v / total) * 100) + '%)';
      const fade = b.soloCat && g.c.key !== b.soloCat ? ' faded' : '';
      if (!split) {
        s += '<rect class="cb-tm' + fade + '" x="' + (g.x + 1).toFixed(1) + '" y="' + (g.y + 1).toFixed(1) + '" width="' + Math.max(1, g.w - 2).toFixed(1) + '" height="' + Math.max(1, g.h - 2).toFixed(1) + '" rx="5" style="--c:' + g.c.color + '" tabindex="0" data-seg="' + g.i + ':0"' + tip(valTip(g.c.label, '', g.v, false) + pctTxt) + '/>';
        labs += label(g.x, g.y, g.w, g.h, g.c.label, g.v, !mini);
        return;
      }
      // a group: a header strip you can tap for all of it, with its pieces inside
      const head = g.h > 48 && g.w > 64 ? 22 : 0;
      s += '<rect class="cb-tm-group" x="' + (g.x + 1).toFixed(1) + '" y="' + (g.y + 1).toFixed(1) + '" width="' + Math.max(1, g.w - 2).toFixed(1) + '" height="' + Math.max(1, g.h - 2).toFixed(1) + '" rx="6" style="--c:' + g.c.color + '" data-seg="' + g.i + ':*"' + tip(catTotal(b, g.i) + pctTxt) + '/>';
      if (head) { const t = clip(g.c.label + ' · ' + fmt(g.v, unit), g.w - 14); if (t) labs += '<text x="' + (g.x + 8).toFixed(1) + '" y="' + (g.y + 16).toFixed(1) + '" class="cb-tm-head">' + esc(t) + '</text>'; }
      squarify(g.kids, g.x + 3, g.y + 3 + head, g.w - 6, g.h - 6 - head).forEach((q) => {
        s += '<rect class="cb-tm" x="' + (q.x + 1).toFixed(1) + '" y="' + (q.y + 1).toFixed(1) + '" width="' + Math.max(1, q.w - 2).toFixed(1) + '" height="' + Math.max(1, q.h - 2).toFixed(1) + '" rx="4" style="--c:' + q.ser.color + '" tabindex="0" data-seg="' + g.i + ':' + q.j + '"' + tip(valTip(g.c.label, q.ser.label, q.v, true)) + '/>';
        labs += label(q.x, q.y, q.w, q.h, q.ser.label, q.v, false);
      });
    });
    return s + labs + '</svg>';
  }

  /* ---------- handoffs: bands from who assigned a task to who's doing it ---------- */
  function handoffData() {
    const { list } = rows();
    const pairs = list.filter((t) => cfg.selfToo || shared(t)).map((t) => ({ t, a: owner(t), b: doer(t) }));
    const people = orderKeys(DIMS.by, [...new Set(pairs.map((p) => p.a).concat(pairs.map((p) => p.b)))]);
    const colors = {}; let n = 0;
    people.forEach((p) => (colors[p] = p === 'Me' ? 'var(--accent)' : PALETTE[1 + (n++ % (PALETTE.length - 1))]));
    const left = orderKeys(DIMS.by, [...new Set(pairs.map((p) => p.a))]), right = orderKeys(DIMS.who, [...new Set(pairs.map((p) => p.b))]);
    const links = [];
    left.forEach((a, li) => right.forEach((bb, ri) => { const tasks = pairs.filter((p) => p.a === a && p.b === bb).map((p) => p.t); if (tasks.length) links.push({ a, b: bb, li, ri, tasks }); }));
    return { pairs, people, colors, left, right, links, n: list.length, sharedN: list.filter(shared).length };
  }
  function handoff(W, H, mini) {
    const h = handoffData();
    if (!h.pairs.length) return '<div class="cb-empty">' + typeSvg(TYPES.find((t) => t[0] === 'handoff')[2]) + '<p>' + (h.n ? 'None of these tasks are shared. Assign a task to someone, or tick “Include tasks I keep for myself”.' : noneMsg()) + '</p></div>';
    const total = h.pairs.length, gap = 10, T = 24, B = 8, bw = 12;
    const lw = Math.min(130, W * 0.26), x1 = lw, x2 = W - lw - bw;
    const avail = (side) => H - T - B - gap * (side.length - 1);
    const k = Math.min(avail(h.left), avail(h.right)) / total;
    const stack = (side, count) => { let y = T; return side.map((p) => { const hh = Math.max(2, count(p) * k); const o = { p, y, h: hh, used: 0 }; y += hh + gap; return o; }); };
    const L = stack(h.left, (p) => h.pairs.filter((q) => q.a === p).length), R = stack(h.right, (p) => h.pairs.filter((q) => q.b === p).length);
    // centre each column
    [L, R].forEach((col) => { const end = col[col.length - 1]; const off = (H - B - (end.y + end.h)) / 2; col.forEach((o) => (o.y += off)); });
    const lit = (p) => !solo || !h.people.includes(solo) || p === solo;
    let s = svgOpen(W, H, autoTitle()), bands = '';
    const mx = (x1 + bw + x2) / 2;
    // bands: leave each source in target order and enter each target in source order, so they don't twist
    const byTarget = h.links.slice().sort((a, b) => a.ri - b.ri || a.li - b.li);
    const yIn = new Map(); byTarget.forEach((l) => { const r = R[l.ri]; yIn.set(l, r.y + r.used); r.used += l.tasks.length * k; });
    h.links.forEach((l) => {
      const src = L[l.li], th = l.tasks.length * k, y0 = src.y + src.used, y1 = yIn.get(l);
      src.used += th;
      const d = 'M' + (x1 + bw) + ' ' + y0.toFixed(1) + 'C' + mx + ' ' + y0.toFixed(1) + ' ' + mx + ' ' + y1.toFixed(1) + ' ' + x2 + ' ' + y1.toFixed(1) +
        'L' + x2 + ' ' + (y1 + th).toFixed(1) + 'C' + mx + ' ' + (y1 + th).toFixed(1) + ' ' + mx + ' ' + (y0 + th).toFixed(1) + ' ' + (x1 + bw) + ' ' + (y0 + th).toFixed(1) + 'Z';
      const on = lit(l.a) || lit(l.b);
      bands += '<path d="' + d + '" class="cb-band' + (on ? '' : ' faded') + '" style="--c:' + h.colors[l.a] + '" tabindex="0" data-seg="h' + l.li + ':' + l.ri + '"' + tip(l.a + ' → ' + l.b + ': ' + l.tasks.length + (l.tasks.length === 1 ? ' task' : ' tasks')) + '/>';
    });
    s += bands;
    const node = (o, x, side, li) => {
      const cnt = Math.round(o.h / k), name = o.p;
      const lab = clip(name, lw - 30) || name.slice(0, 2);
      return '<rect class="cb-hnode' + (lit(name) ? '' : ' faded') + '" x="' + x + '" y="' + o.y.toFixed(1) + '" width="' + bw + '" height="' + o.h.toFixed(1) + '" rx="3" style="--c:' + h.colors[name] + '" tabindex="0" data-seg="h' + side + li + '"' +
        tip((side === 'l' ? name + ' assigned ' : name + ' is doing ') + cnt + (cnt === 1 ? ' task' : ' tasks')) + '/>' +
        '<text x="' + (side === 'l' ? x - 8 : x + bw + 8) + '" y="' + (o.y + o.h / 2 + 4).toFixed(1) + '" class="ax lab" text-anchor="' + (side === 'l' ? 'end' : 'start') + '">' + esc(lab) + ' <tspan class="cb-hcount">' + cnt + '</tspan></text>';
    };
    L.forEach((o, i) => (s += node(o, x1, 'l', i)));
    R.forEach((o, i) => (s += node(o, x2, 'r', i)));
    s += '<text x="' + (x1 + bw) + '" y="12" class="ax cb-hhead" text-anchor="end">Assigned by</text><text x="' + x2 + '" y="12" class="ax cb-hhead">Assigned to</text>';
    return s + '</svg>';
  }

  /* ---------- sunburst: the map's tree, sized by tasks ---------- */
  const MAX_RINGS = 4;
  function sunData() {
    const m = C.map;
    const { list, ctx } = rows();
    const mi = ctx.map;
    if (!m || !mi) return null;
    const Y = NUMS[cfg.y] || NUMS.count;
    const byNode = new Map(); let off = 0;
    list.forEach((t) => { const i = nodeInfo(t, ctx); if (!i) { off++; return; } if (!byNode.has(t.nodeId)) byNode.set(t.nodeId, []); byNode.get(t.nodeId).push(t); });
    const seen = new Set();
    const make = (id, depth) => {
      seen.add(id);
      const n = m.getNode(id), node = { id, title: mi.get(id).title, hex: m.colorHex(n.color), depth, own: (byNode.get(id) || []).slice(), kids: [] };
      m.childIds(id).forEach((c) => {
        if (seen.has(c)) return;
        const k = make(c, depth + 1);
        if (depth + 1 > MAX_RINGS) node.own.push(...k.all); else if (k.all.length) node.kids.push(k);
      });
      node.all = node.own.concat(...node.kids.map((k) => k.all));
      return node;
    };
    const root = mi.root;
    const center = root ? make(root.id, 0) : { id: null, title: 'Map', hex: 'var(--ink)', depth: 0, own: [], kids: [], all: [] };
    m.nodes().forEach((n) => { if (!seen.has(n.id) && !m.parentId(n.id)) { const k = make(n.id, 1); if (k.all.length) center.kids.push(k); } });
    center.all = center.own.concat(...center.kids.map((k) => k.all));
    const value = (tasks) => aggregate(tasks.map((t) => Y.get(t, ctx)).filter((v) => v != null), cfg.agg);
    let rings = 0; const walk = (nd) => { rings = Math.max(rings, nd.depth); nd.kids.forEach(walk); }; walk(center);
    const legend = []; const lseen = new Set();
    center.kids.forEach((k) => { const n = m.getNode(k.id), c = mi.get(k.id).cluster; if (!lseen.has(c)) { lseen.add(c); legend.push({ name: c, hex: m.colorHex(n.color) }); } });
    return { center, value, rings: Math.max(1, rings), off, legend, find: (id) => { let hit = null; const f = (nd) => { if (nd.id === id) hit = nd; else nd.kids.forEach(f); }; f(center); return hit; } };
  }
  function sunburst(W, H) {
    const sb = sunData();
    if (!sb || !sb.center.all.length) return '<div class="cb-empty"><p>' + (!sb || (!sb.off && S().state.tasks.every((t) => t.sample)) ? noneMsg() : sb && sb.off ? 'None of these tasks are linked to map nodes yet. Link a task to a node in the task editor, or type @node in quick add.' : 'No tasks match these filters.') + '</p></div>';
    const unit = NUMS[cfg.y].unit;
    const R = Math.min(W, H) / 2 - 8, cx = W / 2, cy = H / 2, r0 = R * 0.26, ring = (R - r0) / sb.rings;
    const pt = (a, r) => (cx + r * Math.cos(a)).toFixed(2) + ' ' + (cy + r * Math.sin(a)).toFixed(2);
    const arc = (a0, a1, ri, ro) => {
      if (a1 - a0 >= Math.PI * 2 - 1e-4) return 'M' + pt(0, ro) + 'A' + ro + ' ' + ro + ' 0 1 1 ' + pt(Math.PI, ro) + 'A' + ro + ' ' + ro + ' 0 1 1 ' + pt(0, ro) + 'M' + pt(0, ri) + 'A' + ri + ' ' + ri + ' 0 1 0 ' + pt(Math.PI, ri) + 'A' + ri + ' ' + ri + ' 0 1 0 ' + pt(0, ri) + 'Z';
      const big = a1 - a0 > Math.PI ? 1 : 0;
      return 'M' + pt(a0, ro) + 'A' + ro + ' ' + ro + ' 0 ' + big + ' 1 ' + pt(a1, ro) + 'L' + pt(a1, ri) + 'A' + ri + ' ' + ri + ' 0 ' + big + ' 0 ' + pt(a0, ri) + 'Z';
    };
    const total = sb.center.all.length;
    let s = svgOpen(W, H, autoTitle()), labels = '';
    const draw = (nd, a0, a1) => {
      if (nd.depth > 0) {
        const ri = r0 + (nd.depth - 1) * ring + 1, ro = ri + ring - 2;
        const v = sb.value(nd.all);
        const tipText = nd.title + ': ' + fmt(v, unit) + (cfg.y === 'count' ? (v === 1 ? ' task' : ' tasks') : ' · ' + nd.all.length + ' task' + (nd.all.length === 1 ? '' : 's'));
        s += '<path d="' + arc(a0, a1, ri, ro) + '" class="cb-slice cb-sun" fill-rule="evenodd" style="--c:' + nd.hex + ';fill-opacity:' + (1 - (nd.depth - 1) * 0.17).toFixed(2) + '" tabindex="0" data-seg="n' + esc(nd.id) + '"' + tip(tipText) + '/>';
        const mid = (a0 + a1) / 2, mr = (ri + ro) / 2, len = (a1 - a0) * mr;
        if (len > 34 && ring > 16) {
          const max = Math.max(3, Math.floor(Math.min(len, ring * 2.4) / 6.5));
          const t = nd.title.length > max ? nd.title.slice(0, max - 1) + '…' : nd.title;
          labels += '<text x="' + (cx + mr * Math.cos(mid)).toFixed(1) + '" y="' + (cy + mr * Math.sin(mid) + 4).toFixed(1) + '" class="cb-sun-lab" text-anchor="middle">' + esc(t) + '</text>';
        }
      }
      let a = a0;
      nd.kids.forEach((k) => { const span = (a1 - a0) * (k.all.length / nd.all.length); draw(k, a, a + span); a += span; });
    };
    draw(sb.center, -Math.PI / 2, Math.PI * 1.5);
    const cv = sb.value(sb.center.all);
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r0 - 3).toFixed(1) + '" class="cb-sun-core" tabindex="0" data-seg="nall"' + tip('Whole map: ' + fmt(cv, unit) + (cfg.y === 'count' ? ' tasks' : ' · ' + total + ' tasks')) + '/>';
    const ct = sb.center.title.length > 14 ? sb.center.title.slice(0, 13) + '…' : sb.center.title;
    s += labels + '<text x="' + cx + '" y="' + (cy + 2) + '" class="cb-donut-num cb-sun-num" text-anchor="middle">' + fmt(cv, unit === '%' ? '%' : unit) + '</text><text x="' + cx + '" y="' + (cy + 19) + '" class="ax" text-anchor="middle" pointer-events="none">' + esc(ct) + '</text>';
    return s + '</svg>';
  }

  /* ---------- KPI tile: one number, a weekly trend, and the goal ---------- */
  function kpiData() {
    const { list, ctx } = rows();
    const Y = NUMS[cfg.y] || NUMS.count;
    const pairs = list.map((t) => ({ t, v: Y.get(t, ctx) })).filter((p) => p.v != null);
    const value = aggregate(pairs.map((p) => p.v), cfg.agg);
    const tf = cfg.x && DIMS[cfg.x] && DIMS[cfg.x].time ? cfg.x : cfg.status === 'done' ? 'completed' : cfg.status === 'overdue' ? 'due' : 'created';
    const TF = DIMS[tf], weeks = 8, ws = S().state.prefs.weekStart;
    const start = D.startOfWeek(D.today(), ws);
    const keys = []; for (let i = weeks - 1; i >= 0; i--) keys.push(D.key(D.add(start, -7 * i)));
    const spark = keys.map((k) => { const end = D.addKey(k, 7); return aggregate(pairs.filter((p) => { const d = TF.get(p.t, ctx); return d && d >= k && d < end; }).map((p) => p.v), cfg.agg); });
    if (cfg.kpiPeriod === 'week') {
      const k0 = keys[keys.length - 1], end = D.addKey(k0, 7);
      const wk = pairs.filter((p) => { const d = TF.get(p.t, ctx); return d && d >= k0 && d < end; });
      return { value: aggregate(wk.map((p) => p.v), cfg.agg), n: wk.length, tasks: wk.map((p) => p.t), spark, keys, tf, unit: Y.unit, week: true };
    }
    return { value, n: pairs.length, tasks: pairs.map((p) => p.t), spark, keys, tf, unit: Y.unit };
  }
  function kpi(compact) {
    const k = kpiData();
    const cur = k.spark[k.spark.length - 1], prev = k.spark[k.spark.length - 2];
    const lowerBetter = LOWER_IS_BETTER.includes(cfg.y) || (cfg.goalDir === 'atMost' && hasGoal());
    let delta = '';
    if (cur != null && prev != null) {
      const d = cur - prev, good = d === 0 ? null : lowerBetter ? d < 0 : d > 0;
      delta = '<span class="kpi-delta' + (good == null ? '' : good ? ' up' : ' down') + '">' + (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '') + fmt(Math.abs(d), k.unit) + ' vs last week</span>';
    }
    const goal = hasGoal() ? (k.value != null && meets(k.value)) : null;
    // sparkline
    const W = 240, H = 54, vals = k.spark.map((v) => (v == null ? null : v));
    const nums = vals.filter((v) => v != null);
    let spark = '';
    if (nums.length) {
      const goalOnSpark = hasGoal() && k.week;
      const hi = Math.max(...nums, goalOnSpark ? +cfg.goal : 0, 1), lo = Math.min(0, ...nums);
      const xs = (i) => 4 + (W - 8) * (i / (vals.length - 1)), ys = (v) => H - 6 - (H - 12) * ((v - lo) / (hi - lo || 1));
      const ptsArr = vals.map((v, i) => (v == null ? null : [xs(i), ys(v)])).filter(Boolean);
      const line = ptsArr.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
      spark = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="kpi-spark" preserveAspectRatio="none" aria-hidden="true">' +
        (ptsArr.length > 1 ? '<polygon class="kpi-area" points="' + line + ' ' + ptsArr[ptsArr.length - 1][0].toFixed(1) + ',' + H + ' ' + ptsArr[0][0].toFixed(1) + ',' + H + '"/>' : '') +
 (goalOnSpark ? '<line class="kpi-goal" x1="0" x2="' + W + '" y1="' + ys(+cfg.goal).toFixed(1) + '" y2="' + ys(+cfg.goal).toFixed(1) + '"/>' : '') +
        '<polyline class="kpi-line" points="' + line + '"/>' + (ptsArr.length ? '<circle class="kpi-dot" r="3" cx="' + ptsArr[ptsArr.length - 1][0].toFixed(1) + '" cy="' + ptsArr[ptsArr.length - 1][1].toFixed(1) + '"/>' : '') + '</svg>';
    }
    const tfWords = (DIMS[k.tf].words || DIMS[k.tf].label.toLowerCase());
    return '<button type="button" class="kpi' + (compact ? ' compact' : '') + (goal === true ? ' met' : goal === false ? ' missed' : '') + '" data-seg="all"' + tip(autoTitle() + ': ' + fmt(k.value, k.unit)) + '>' +
      '<span class="kpi-num">' + fmt(k.value, k.unit) + '</span>' +
      '<span class="kpi-sub">' + (k.week ? 'This week · ' + (k.n === 1 ? '1 task' : k.n + ' tasks') + ' by ' + esc(DIMS[k.tf].words || DIMS[k.tf].label.toLowerCase()) : (k.n === 1 ? '1 task' : k.n + ' tasks') + ' · ' + esc(filterText().replace(' · all time', ''))) + '</span>' +
      '<span class="kpi-row">' + delta + (hasGoal() ? '<span class="kpi-goalpill">' + (goal ? icon('check') + 'Goal met' : icon('flag') + 'Goal') + ' ' + (cfg.goalDir === 'atMost' ? '≤ ' : '≥ ') + fmt(+cfg.goal, k.unit) + '</span>' : '') + '</span>' +
      spark + '<span class="kpi-cap muted">Last 8 weeks, by ' + esc(tfWords) + '</span></button>';
  }

  /* ---------- tooltips ---------- */
  function showTip(t) {
    const node = t && t.closest && t.closest('[data-tip]');
    if (!node || !el || !el.contains(node)) return;
    const canvas = node.closest('.cb-canvas');
    if (!canvas) return; // board thumbnails are for glancing; edit one to explore it
    canvas.querySelectorAll('.tipped').forEach((x) => x.classList.remove('tipped'));
    node.classList.add('tipped');
    const cap = canvas.querySelector('.ins-cap'); if (cap) cap.textContent = node.dataset.tip;
  }

  /* ---------- placing fields ---------- */
  function place(fid, z, from) {
    ui.flash = null;
    if (z === 'cols' || (from === 'colsz' && !z)) {
      const cols = tCols().slice();
      if (!z) return setCfg({ cols: cols.filter((c) => c !== fid) }); // dragged off the table
      if (from === 'colsz') return;
      if (fid === 'count') return nope(z, 'Every row is one task, so Tasks isn’t a column. Try Checklist steps or Days late.');
      if (cols.includes(fid)) return nope(z, colField(fid).label + ' is already a column.');
      ui.picked = null;
      return setCfg({ cols: cols.concat(fid) });
    }
    if (EXTRA_COLS[fid]) return nope(z, colField(fid).label + ' only works as a table column.');
    if (cfg.type === 'table' && z === 'x' && isNum(fid)) return nope(z, 'Rows can be grouped by a category, like Type or Map branch. Numbers go on Columns.');
    if (from === 'colsz') return place(fid, z, 'tray');
    if (!z) { if (from && from !== 'tray') setCfg({ [from]: null }); return; }
    if (z === 'y' && !isNum(fid)) return nope(z, 'Values need a number field, like Tasks or Days late.');
    if (z === 'series' && isNum(fid)) return nope(z, 'Split by needs a category field, like Status or Type.');
    const patch = { [z]: fid };
    if (from && from !== 'tray' && from !== z) {
      patch[from] = cfg[z] && (from === 'y' ? isNum(cfg[z]) : !isNum(cfg[z])) ? cfg[z] : null; // swap when it fits, otherwise clear
      if (from === 'y' && !patch.y) patch.y = 'count';
    }
    if (z === 'x' && isNum(fid) && cfg.type !== 'scatter' && cfg.type !== 'kpi' && cfg.type !== 'table') { patch.type = 'scatter'; if (cfg.y === 'count') patch.y = null; C.toast('Switched to a scatter plot to show ' + field(fid).label + ' as numbers.'); }
    if (z === 'x' && !isNum(fid) && cfg.type === 'scatter') patch.type = 'column';
    if (z === 'y' && NUMS[fid]) { patch.agg = NUMS[fid].aggs[0]; if (cfg.goal == null) patch.goalDir = LOWER_IS_BETTER.includes(fid) ? 'atMost' : 'atLeast'; }
    if (z === 'x' && cfg.type === 'kpi' && !(DIMS[fid] && DIMS[fid].time)) return nope(z, 'A KPI trend needs a date field, like Completed or Created.');
    if (FLOW_TYPES.includes(cfg.type) && z !== 'y') return nope(z, 'This chart always runs over time and splits tasks by status, so it doesn’t use this.');
    if (cfg.type === 'handoff' && z !== 'y') return nope(z, 'This chart always runs from who assigned each task to who’s doing it.');
    if (FIXED_TYPES.includes(cfg.type) && z === 'y') return nope(z, 'This chart counts tasks.');
    if (cfg.type === 'treemap' && z === 'y' && NUMS[fid] && !NUMS[fid].aggs.includes('sum') && fid !== 'count') return nope(z, 'A treemap adds values up, and ' + NUMS[fid].label + ' only makes sense as an average.');
    if (z === 'x' && cfg.type === 'sunburst') return nope(z, 'A sunburst follows your map, so it doesn’t use the X axis.');
    ui.picked = null;
    setCfg(patch);
  }
  function nope(z, msg) {
    ui.flash = msg; ui.flashZone = z; ui.picked = null; render();
    clearTimeout(nope.t); nope.t = setTimeout(() => { ui.flash = null; render(); }, 3200);
  }

  let drag = null, swallowClick = false;
  function onDown(e) {
    if (e.button) return;
    const c = e.target.closest('.cb-chip');
    if (!c || c.classList.contains('fixed') || e.target.closest('[data-clear]') || e.target.closest('[data-colmove]')) return;
    drag = { c, fid: c.dataset.field, from: c.dataset.from, x0: e.clientX, y0: e.clientY, pid: e.pointerId, on: false, over: null };
    window.addEventListener('pointermove', dMove, { passive: false });
    window.addEventListener('pointerup', dUp);
    window.addEventListener('pointercancel', dEnd);
  }
  function dMove(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    if (!drag.on) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
      drag.on = true;
      const r = drag.c.getBoundingClientRect();
      const g = drag.c.cloneNode(true); g.classList.add('cb-ghost'); g.querySelectorAll('.cb-x').forEach((x) => x.remove());
      document.body.appendChild(g);
      drag.g = g; drag.ox = drag.x0 - r.left; drag.oy = drag.y0 - r.top;
      drag.c.classList.add('dragging');
      el.querySelector('.cb-layout').classList.add('is-drag', isNum(drag.fid) ? 'drag-num' : 'drag-dim');
      if (navigator.vibrate) try { navigator.vibrate(6); } catch (err) { /* not allowed */ }
    }
    e.preventDefault();
    drag.g.style.transform = 'translate(' + (e.clientX - drag.ox) + 'px,' + (e.clientY - drag.oy) + 'px) rotate(-2deg)';
    drag.g.hidden = true;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    drag.g.hidden = false;
    const z = under && under.closest('[data-zone]');
    if (z !== drag.over) { if (drag.over) drag.over.classList.remove('over'); drag.over = z; if (z) z.classList.add('over'); }
    const m = 60; if (e.clientY < m) window.scrollBy(0, -10); else if (e.clientY > innerHeight - m) window.scrollBy(0, 10);
  }
  function dUp(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag; dEnd();
    if (!d.on) return; // a plain tap: the click handler takes it
    swallowClick = true; setTimeout(() => (swallowClick = false), 60);
    place(d.fid, d.over ? d.over.dataset.zone : null, d.from);
  }
  function dEnd() {
    if (!drag) return;
    if (drag.g) drag.g.remove();
    if (drag.over) drag.over.classList.remove('over');
    drag.c.classList.remove('dragging');
    const lay = el && el.querySelector('.cb-layout'); if (lay) lay.classList.remove('is-drag', 'drag-num', 'drag-dim');
    window.removeEventListener('pointermove', dMove);
    window.removeEventListener('pointerup', dUp);
    window.removeEventListener('pointercancel', dEnd);
    drag = null;
  }

  C.charts = { NUMS, aggregate, fmt };

  /* ---------- clicks & inputs ---------- */
  function onClick(e) {
    if (swallowClick || swallowZoomClick) { e.preventDefault(); e.stopPropagation(); return; }
    const t = e.target;
    const ax = t.closest('[data-askex]');
    if (ax) return runAsk(ax.dataset.askex);
    const lg = t.closest('[data-legend]');
    if (lg) { const k = lg.dataset.legend; ui.solo = k && ui.solo !== k ? k : null; return render(); }
    if (t.closest('[data-unzoom]')) { ui.zoom = null; return render(); }
    const ex = t.closest('[data-export]');
    if (ex) { const ti = el.querySelector('#cb-title'); const title = (ti && ti.value.trim()) || autoTitle(); solo = ui.solo; zoom = ui.zoom; return ex.dataset.export === 'csv' ? exportCsv(title) : exportPng(el.querySelector('.cb-canvas'), title); }
    const clr = t.closest('[data-clear]');
    if (clr && clr.dataset.clear.startsWith('cols:')) { const id = clr.dataset.clear.slice(5); return setCfg({ cols: tCols().filter((c) => c !== id) }); }
    const cm = t.closest('[data-colmove]');
    if (cm) { const [id, d] = cm.dataset.colmove.split(':'), cols = tCols().slice(), i = cols.indexOf(id), j = i + +d; if (i < 0 || j < 0 || j >= cols.length) return; [cols[i], cols[j]] = [cols[j], cols[i]]; return setCfg({ cols }); }
    const ts = t.closest('[data-tsort]'); if (ts) return setCfg({ sort: nextSort(cfg.sort, ts.dataset.tsort) });
    const tc = t.closest('[data-tcheck]'); if (tc) return C.completeTask(tc.dataset.tcheck);
    if (t.closest('[data-tmore]')) return setCfg({ limit: 'all' });
    const tr = t.closest('[data-trow]'); if (tr) return C.openEditor(tr.dataset.trow);
    if (clr) { const z = clr.dataset.clear; return setCfg({ [z]: z === 'y' ? 'count' : null, agg: z === 'y' ? 'count' : cfg.agg }); }
    const c = t.closest('.cb-chip');
    if (c && c.dataset.from === 'tray') { ui.picked = ui.picked === c.dataset.field ? null : c.dataset.field; ui.flash = null; return render(); }
    const z = t.closest('[data-zone]');
    if (z && ui.picked) return place(ui.picked, z.dataset.zone, 'tray');
    const ct = t.closest('[data-ctype]');
    if (ct) {
      const type = ct.dataset.ctype, patch = { type };
      if (type === 'scatter' && (!isNum(cfg.x) || cfg.x === 'count')) { patch.x = 'age'; patch.y = cfg.y && cfg.y !== 'count' ? cfg.y : 'late'; patch.series = cfg.series || (cfg.x && !isNum(cfg.x) ? cfg.x : null); }
      if (type !== 'scatter' && cfg.type === 'scatter') { patch.x = cfg.series || 'type'; patch.series = null; if (type === 'kpi' || type === 'sunburst') patch.x = null; if (NUMS[cfg.y] && cfg.y !== 'count' && type !== 'scatter') patch.y = cfg.y; }
      if (type === 'kpi' && cfg.x && !(DIMS[cfg.x] && DIMS[cfg.x].time)) patch.x = null;
      if (FIXED_TYPES.includes(type)) patch.y = 'count';
      if (type === 'table') { patch.x = null; patch.series = null; }
      if ((cfg.type === 'kpi' || cfg.type === 'sunburst' || cfg.type === 'table' || FIXED_TYPES.includes(cfg.type)) && type !== 'kpi' && type !== 'sunburst' && !FIXED_TYPES.includes(type) && type !== 'scatter' && !cfg.x) patch.x = 'type';
      if (type === 'treemap') {
        const yy = patch.y || cfg.y;
        if (NUMS[yy] && yy !== 'count' && !NUMS[yy].aggs.includes('sum')) patch.y = 'count';
        else if (cfg.agg === 'avg') patch.agg = 'sum';
        if (!patch.x && !cfg.x) patch.x = 'type';
      }
      return C.withTransition(() => setCfg(patch));
    }
    const ag = t.closest('[data-agg]'); if (ag) return setCfg({ agg: ag.dataset.agg });
    if (t.closest('[data-filters-clear]')) { ui.filters = false; return setCfg({ f: null }); }
    if (t.closest('[data-filters]')) { ui.filters = !ui.filters; return render(); }
    if (t.closest('[data-heat]')) {
      const metric = { late: 'late', age: 'age', onTime: 'onTime' }[cfg.y] || (cfg.status === 'done' ? 'recent' : cfg.status === 'open' && cfg.y === 'count' ? 'open' : 'open');
      C.map.ui.heat = { metric, rollup: true }; C.map.saveUi();
      return C.go('canvas');
    }
    const pr = t.closest('[data-preset]');
    if (pr) { const p = PRESETS[+pr.dataset.preset]; ui.picked = null; return C.withTransition(() => setCfg(Object.assign({}, BLANK, p.cfg, { title: '', id: null }))); }
    if (t.closest('[data-reset]')) { ui.picked = null; return setCfg(Object.assign({}, BLANK, { id: null })); }
    if (t.closest('[data-save]') || t.closest('[data-save-new]')) {
      const asNew = !!t.closest('[data-save-new]') || !cfg.id || !board.some((b) => b.id === cfg.id);
      const titleIn = el.querySelector('#cb-title');
      const item = Object.assign({}, cfg, { title: titleIn ? titleIn.value.trim() : cfg.title });
      syncBoard();
      if (item.type === 'table' && !item.size && asNew) item.size = 'wide';
      if (asNew) { item.id = C.uid('ch'); board = board.concat([item]); } else board = board.map((b) => (b.id === item.id ? item : b));
      saveBoard();
      const where = asNew ? placeNewChart(item) : null;
      setCfg({ id: item.id, title: item.title });
      C.toast(asNew ? 'Saved to “' + where + '”' : 'Chart updated', { action: 'View', onAction: () => C.go('board') });
      return;
    }
    // tapping anywhere else cancels a picked field
    if (ui.picked && !t.closest('.cb-fields')) { ui.picked = null; render(); }
  }
  /* ================= export: the chart's numbers as CSV, or a picture as PNG ================= */
  const slug = (t) => (t || 'chart').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'chart';
  /** the numbers behind the current chart, as a header row and data rows */
  function tableData() {
    const unit = (NUMS[cfg.y] || NUMS.count).unit, num = (v) => (v == null ? '' : unit === '%' ? Math.round(v) : Math.round(v * 100) / 100);
    const yLabel = cfg.y === 'count' ? 'Tasks' : (cfg.agg === 'avg' ? 'Average ' : cfg.agg === 'sum' ? 'Total ' : '') + (NUMS[cfg.y] || NUMS.count).label.toLowerCase();
    if (cfg.type === 'kpi') {
      const k = kpiData();
      return { head: ['Week starting', yLabel], rows: k.keys.map((key, i) => [key, num(k.spark[i])]).concat([[k.week ? 'This week' : 'All matching', num(k.value)]]) };
    }
    if (cfg.type === 'sunburst') {
      const sb = sunData(); if (!sb) return null;
      const out = []; const walk = (nd, path) => { nd.kids.forEach((k) => { const p2 = path.concat(k.title); out.push([p2.join(' / '), k.depth, k.all.length, num(sb.value(k.all))]); walk(k, p2); }); };
      walk(sb.center, []);
      return { head: ['Node', 'Depth', 'Tasks', yLabel], rows: [['Whole map', 0, sb.center.all.length, num(sb.value(sb.center.all))]].concat(out) };
    }
    if (cfg.type === 'table') {
      const tb = tableRows(), gd = cfg.x && DIMS[cfg.x];
      const list = tb.groups ? tb.groups.flatMap((g) => g.tasks.map((t) => [g.key, t])) : tb.list.map((t) => [null, t]);
      return { head: (gd ? [gd.label] : []).concat(tb.cols.map((c) => (c === 'title' ? 'Task' : colField(c).label)), ['Done']),
        rows: list.map(([g, t]) => (gd ? [g] : []).concat(tb.cols.map((c) => cellOf(t, c, tb.ctx).txt), [t.done ? 'Yes' : ''])) };
    }
    if (cfg.type === 'handoff') { const h = handoffData(); return { head: ['Assigned by', 'Assigned to', 'Tasks'], rows: h.links.map((l) => [l.a, l.b, l.tasks.length]) }; }
    const b = build();
    if (cfg.type === 'scatter') return { head: ['Task', NUMS[cfg.x].label, NUMS[cfg.y].label].concat(cfg.series ? [DIMS[cfg.series].label] : []), rows: b.points.map((p) => [p.t.title, num(p.x), num(p.y)].concat(cfg.series ? [p.s] : [])) };
    const xLabel = b.flow ? 'Up to' : DIMS[cfg.x].label;
    const head = [xLabel].concat(b.series.map((x) => (b.series.length > 1 || cfg.series ? x.label : yLabel)));
    if (b.prev) head.push('Previous ' + RANGE_WORDS[curRange()]);
    if (b.trend) head.push(cfg.trend === 'avg' ? 'Rolling average' : 'Trend');
    return { head, rows: b.cats.map((c, i) => [c.label].concat(b.series.map((x) => num(x.values[i])), b.prev ? [num(b.prev.values[i])] : [], b.trend ? [num(b.trend[i])] : [])) };
  }
  const csvCell = (v) => { let t = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(t) && isNaN(+t)) t = "'" + t; return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  function exportCsv(title) {
    const t = tableData();
    if (!t || !t.rows.length) return C.toast('Nothing to export yet');
    const csv = '﻿' + [t.head].concat(t.rows).map((r) => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    C.map.download(url, slug(title) + '.csv');
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    C.toast('Downloaded ' + slug(title) + '.csv');
  }
  /* SVG → PNG: copy the computed look onto each element so the picture matches the screen */
  const STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'paint-order', 'display', 'visibility'];
  function svgImage(svg, W, H) {
    const clone = svg.cloneNode(true);
    const src = [svg, ...svg.querySelectorAll('*')], dst = [clone, ...clone.querySelectorAll('*')];
    src.forEach((n, i) => { const cs = getComputedStyle(n); dst[i].setAttribute('style', STYLE_PROPS.map((p) => p + ':' + cs.getPropertyValue(p)).join(';')); dst[i].removeAttribute('class'); dst[i].removeAttribute('tabindex'); dst[i].removeAttribute('data-tip'); dst[i].removeAttribute('data-seg'); });
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', W); clone.setAttribute('height', H);
    const xml = new XMLSerializer().serializeToString(clone);
    return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('Couldn’t draw this chart')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml); });
  }
  function wrapLines(ctx, text, max) {
    const words = text.split(/\s+/), lines = []; let cur = '';
    words.forEach((w) => { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > max && cur) { lines.push(cur); cur = w; } else cur = t; });
    if (cur) lines.push(cur);
    return lines;
  }
  /** card: the element holding the chart (builder canvas or a Board card) */
  async function exportPng(card, title) {
    card.querySelectorAll('.tipped').forEach((x) => x.classList.remove('tipped'));
    const tblEl = card.querySelector('.cb-tbl');
    if (tblEl) return exportTablePng(card, tblEl, title);
    const svg = card.querySelector('.cb-plot svg.chart, .kpi');
    if (!svg) return C.toast('Nothing to export yet');
    const cs = getComputedStyle(card), body = getComputedStyle(document.body);
    const bg = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : body.backgroundColor || '#fff';
    const ink = body.color || '#111', muted = getComputedStyle(card.querySelector('.muted') || card).color;
    const font = body.fontFamily || 'system-ui, sans-serif', dfont = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim() || font;
    const scale = 2, pad = 28;
    try {
      let W, H, img = null, kpiBox = null;
      if (svg.tagName.toLowerCase() === 'svg') { const vb = svg.viewBox.baseVal; W = vb.width; H = vb.height; img = await svgImage(svg, W, H); }
      else { kpiBox = svg; W = 480; H = 212; const sp = svg.querySelector('.kpi-spark'); if (sp) img = await svgImage(sp, 240, 54); }
      const width = Math.max(W, 480) + pad * 2;
      const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
      // measure first: title and summary wrap to the picture's width
      ctx.font = '700 22px ' + dfont;
      const tl = wrapLines(ctx, title, width - pad * 2);
      const legend = [...card.querySelectorAll('.cb-legend .lg-item, .cb-legend > span:not(.ins-cap)')].map((n) => { const i = n.querySelector('i'), ic = i && getComputedStyle(i); return { label: n.textContent.trim(), bg: ic ? ic.backgroundColor : null, line: ic ? ic.borderTopColor : null, lineStyle: ic ? ic.borderTopStyle : 'none', off: n.classList.contains('off') }; }).filter((x) => x.label);
      const summary = (card.querySelector('.cb-summary') || {}).textContent || '';
      ctx.font = '13px ' + font;
      const sl = summary ? wrapLines(ctx, summary.trim(), width - pad * 2) : [];
      // lay out the legend in rows
      const lrows = []; let row = [], rx = 0;
      legend.forEach((it) => { const w = 22 + ctx.measureText(it.label).width + 18; if (rx + w > width - pad * 2 && row.length) { lrows.push(row); row = []; rx = 0; } row.push(Object.assign(it, { w })); rx += w; });
      if (row.length) lrows.push(row);
      const height = pad + tl.length * 28 + 12 + H + (lrows.length ? 14 + lrows.length * 22 : 0) + (sl.length ? 14 + sl.length * 19 : 0) + pad;
      cv.width = width * scale; cv.height = height * scale; ctx.scale(scale, scale);
      ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
      let y = pad;
      ctx.fillStyle = ink; ctx.font = '700 22px ' + dfont; ctx.textBaseline = 'top';
      tl.forEach((l) => { ctx.fillText(l, pad, y); y += 28; });
      y += 12;
      if (kpiBox) {
        const num = kpiBox.querySelector('.kpi-num'), sub = kpiBox.querySelector('.kpi-sub'), rowEl = kpiBox.querySelector('.kpi-row');
        ctx.fillStyle = getComputedStyle(num).color; ctx.font = '750 64px ' + dfont; ctx.fillText(num.textContent, pad, y);
        ctx.fillStyle = muted; ctx.font = '13px ' + font; const bits = [sub ? sub.textContent.trim() : ''].concat(rowEl ? [...rowEl.children].map((c) => c.textContent.trim()) : []).filter(Boolean);
        ctx.fillText(bits.join('  ·  '), pad, y + 76);
        if (img) ctx.drawImage(img, pad, y + 104, 440, 99);
      } else ctx.drawImage(img, (width - W) / 2, y, W, H);
      y += H;
      if (lrows.length) {
        y += 14; ctx.font = '13px ' + font;
        lrows.forEach((r) => { let x = pad; r.forEach((it) => {
          ctx.globalAlpha = it.off ? 0.45 : 1;
          if (it.bg && it.bg !== 'rgba(0, 0, 0, 0)') { ctx.fillStyle = it.bg; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y + 3, 11, 11, 3); else ctx.rect(x, y + 3, 11, 11); ctx.fill(); }
          else if (it.line && it.lineStyle !== 'none') { ctx.strokeStyle = it.line; ctx.lineWidth = 2; ctx.setLineDash(it.lineStyle === 'dotted' ? [2, 3] : [5, 3]); ctx.beginPath(); ctx.moveTo(x, y + 9); ctx.lineTo(x + 16, y + 9); ctx.stroke(); ctx.setLineDash([]); }
          ctx.fillStyle = ink; ctx.fillText(it.label, x + 20, y + 2); x += it.w; ctx.globalAlpha = 1;
        }); y += 22; });
      }
      if (sl.length) { y += 14; ctx.fillStyle = muted; ctx.font = '13px ' + font; sl.forEach((l) => { ctx.fillText(l, pad, y); y += 19; }); }
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      if (!blob) throw new Error('Couldn’t make the picture');
      const url = URL.createObjectURL(blob);
      C.map.download(url, slug(title) + '.png');
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      C.toast('Downloaded ' + slug(title) + '.png');
    } catch (err) { C.toast(err.message || 'Couldn’t export the chart'); }
  }

  /** a table as a picture: the visible rows, laid out on a canvas */
  async function exportTablePng(card, tbl, title) {
    const body = getComputedStyle(document.body), cs = getComputedStyle(card);
    const bg = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : body.backgroundColor || '#fff';
    const ink = body.color || '#111', font = body.fontFamily || 'system-ui, sans-serif', dfont = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim() || font;
    const line = getComputedStyle(tbl.querySelector('td, th')).borderBottomColor || '#ddd', muted = getComputedStyle(card.querySelector('.muted') || card).color;
    const head = [...tbl.querySelectorAll('thead th')].slice(1).map((th) => th.textContent.trim());
    const rowsOut = [...tbl.querySelectorAll('tbody tr')].map((tr) => tr.classList.contains('cb-tgroup') ? { group: tr.textContent.trim().replace(/\s+(\d+)$/, ' · $1') } : { cells: [...tr.children].slice(1).map((td) => td.textContent.trim()), done: tr.classList.contains('done'), late: [...tr.children].slice(1).map((td) => !!td.querySelector('.cb-tlate')) });
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d'), scale = 2, pad = 28, rowH = 30, gap = 18;
    ctx.font = '13px ' + font;
    const widths = head.map((h, i) => { ctx.font = '650 12px ' + font; const hw = ctx.measureText(h.toUpperCase()).width + 4; ctx.font = (i === 0 ? '600 ' : '') + '13px ' + font; return Math.min(i === 0 ? 340 : 220, Math.max(hw, ...rowsOut.filter((r) => r.cells).map((r) => ctx.measureText(r.cells[i] || '').width))) + gap; });
    const width = Math.max(520, widths.reduce((a, b) => a + b, 0) + pad * 2);
    ctx.font = '700 22px ' + dfont;
    const tl = wrapLines(ctx, title, width - pad * 2);
    const summary = ((card.querySelector('.cb-summary') || {}).textContent || '').trim();
    ctx.font = '13px ' + font; const sl = summary ? wrapLines(ctx, summary, width - pad * 2) : [];
    const height = pad + tl.length * 28 + 14 + rowH * (rowsOut.length + 1) + (sl.length ? 16 + sl.length * 19 : 0) + pad;
    cv.width = width * scale; cv.height = height * scale; ctx.scale(scale, scale);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height); ctx.textBaseline = 'middle';
    let y = pad; ctx.fillStyle = ink; ctx.font = '700 22px ' + dfont; ctx.textBaseline = 'top'; tl.forEach((l) => { ctx.fillText(l, pad, y); y += 28; }); y += 14; ctx.textBaseline = 'middle';
    const fit = (txt, w) => { if (ctx.measureText(txt).width <= w) return txt; let t = txt; while (t.length > 1 && ctx.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…'; };
    const hline = (yy) => { ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad, yy + 0.5); ctx.lineTo(width - pad, yy + 0.5); ctx.stroke(); };
    ctx.font = '650 12px ' + font; ctx.fillStyle = muted; let x = pad;
    head.forEach((h, i) => { ctx.fillText(fit(h.toUpperCase(), widths[i] - gap), x, y + rowH / 2); x += widths[i]; });
    y += rowH; hline(y);
    const danger = getComputedStyle(document.documentElement).getPropertyValue('--danger').trim() || '#d33';
    rowsOut.forEach((r) => {
      if (r.group) { ctx.font = '650 13px ' + font; ctx.fillStyle = ink; ctx.fillText(fit(r.group, width - pad * 2), pad, y + rowH / 2); }
      else { x = pad; r.cells.forEach((c, i) => { ctx.font = (i === 0 ? '600 ' : '') + '13px ' + font; ctx.fillStyle = r.late[i] ? danger : r.done ? muted : ink; ctx.fillText(fit(c, widths[i] - gap), x, y + rowH / 2); x += widths[i]; }); }
      y += rowH; hline(y);
    });
    if (sl.length) { y += 16; ctx.fillStyle = muted; ctx.font = '13px ' + font; ctx.textBaseline = 'top'; sl.forEach((l) => { ctx.fillText(l, pad, y); y += 19; }); }
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    if (!blob) return C.toast('Couldn’t make the picture');
    const url = URL.createObjectURL(blob); C.map.download(url, slug(title) + '.png'); setTimeout(() => URL.revokeObjectURL(url), 4000);
    C.toast('Downloaded ' + slug(title) + '.png');
  }

  /* ================= drag across a time chart to zoom ================= */
  let zd = null, swallowZoomClick = false;
  /** onDone(i0, i1) gets the first and last category index the drag covered */
  function zoomDown(e, onDone) {
    if (e.button) return;
    if (zd) zEnd(); // a drag that never got its pointerup
    const svg = e.target.closest && e.target.closest('svg[data-zoom]');
    if (!svg) return;
    const [L, R, n, W, T, Bt] = svg.dataset.zoom.split(',').map(Number);
    const r = svg.getBoundingClientRect();
    const toV = (cx) => Math.max(L, Math.min(W - R, ((cx - r.left) / r.width) * W));
    zd = { svg, L, R, n, W, T, Bt, toV, x0: toV(e.clientX), cx0: e.clientX, cy0: e.clientY, pid: e.pointerId, on: false, onDone, sel: null };
    window.addEventListener('pointermove', zMove, { passive: false });
    window.addEventListener('pointerup', zUp);
    window.addEventListener('pointercancel', zEnd);
  }
  function zMove(e) {
    if (!zd || e.pointerId !== zd.pid) return;
    const dx = e.clientX - zd.cx0, dy = e.clientY - zd.cy0;
    if (!zd.on) {
      if (Math.abs(dx) < 8) { if (Math.abs(dy) > 10) zEnd(); return; }
      if (Math.abs(dy) > Math.abs(dx)) return zEnd(); // scrolling, not zooming
      zd.on = true;
      zd.sel = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      zd.sel.setAttribute('class', 'cb-zoomsel');
      zd.sel.setAttribute('y', zd.T); zd.sel.setAttribute('height', zd.Bt - zd.T); zd.sel.setAttribute('rx', 4);
      zd.svg.appendChild(zd.sel);
      zd.svg.classList.add('zooming');
    }
    e.preventDefault();
    const x = zd.toV(e.clientX), a = Math.min(x, zd.x0), b = Math.max(x, zd.x0);
    zd.sel.setAttribute('x', a.toFixed(1)); zd.sel.setAttribute('width', (b - a).toFixed(1));
    zd.x1 = x;
  }
  function zUp(e) {
    if (!zd || e.pointerId !== zd.pid) return;
    const d = zd; zEnd();
    if (!d.on) return;
    swallowZoomClick = true; setTimeout(() => (swallowZoomClick = false), 80);
    const cw = (d.W - d.L - d.R) / d.n, idx = (x) => Math.max(0, Math.min(d.n - 1, Math.floor((x - d.L) / cw)));
    const i0 = idx(Math.min(d.x0, d.x1)), i1 = idx(Math.max(d.x0, d.x1));
    if (i1 > i0) d.onDone(i0, i1);
    else C.toast('Drag across at least two ' + (FLOW_TYPES.includes(cfg.type) ? 'points' : 'bars or points') + ' to zoom');
  }
  function zEnd() {
    if (!zd) return;
    if (zd.sel) zd.sel.remove();
    zd.svg.classList.remove('zooming');
    window.removeEventListener('pointermove', zMove);
    window.removeEventListener('pointerup', zUp);
    window.removeEventListener('pointercancel', zEnd);
    zd = null;
  }
  const zoomKeys = (i0, i1) => { const b = build(); return b.cats[i0] && b.cats[i1] ? { a: b.cats[i0].key, b: b.cats[i1].key } : null; };

  /* ================= Dashboards (the Board page) =================
     Saved charts are one list (state.board.charts). Dashboards lay them out on a grid
     24 squares across (state.board.dashboards; positions decided by dashgrid.js). The same
     chart can sit on several dashboards; editing it changes it everywhere.
     Until the first change, the old board is shown as one dashboard, "My board". */
  const G = () => C.dashgrid;
  let elB = null;
  const DB_CUR = 'cadence.board.cur';
  const DB = { cur: load(DB_CUR, ''), edit: null, picker: false, confirm: null };
  const withCfg = (item, fn, over) => {
    const saved = cfg, ro = rangeOverride, so = solo, zo = zoom, v = cardView(item.id);
    cfg = Object.assign({}, BLANK, item, over || null); rangeOverride = boardRange(); solo = v.solo; zoom = v.zoom;
    try { return fn(); } finally { cfg = saved; rangeOverride = ro; solo = so; zoom = zo; }
  };
  const BOARD_RANGE = 'cadence.board.range';
  const boardRange = () => { const v = load(BOARD_RANGE, ''); return v && v !== 'own' ? v : null; };
  const phone = () => matchMedia('(max-width: 640px)').matches;

  /** every dashboard, as saved (or the old board as one) */
  const allDashes = () => G().dashboardsOf(S().state.board);
  const homeId = () => { const h = S().state.board.home, ds = allDashes(); return ds.some((d) => d.id === h) ? h : ds[0].id; };
  const curDash = () => { const ds = allDashes(); return ds.find((d) => d.id === DB.cur) || ds.find((d) => d.id === homeId()) || ds[0]; };
  const chartById = (id) => board.find((b) => b.id === id);
  /** write the dashboards (and the charts, when given) */
  function saveDashes(dashes, charts, home) {
    syncBoard();
    S().setBoard(charts || board.slice(), { dashboards: dashes, home: home != null ? home : homeId() });
    syncBoard();
  }
  /** the dashboard being shown: the working copy while editing */
  const shown = () => (DB.edit || curDash());

  const boardView = C.views.board = {
    title: 'Dashboards',
    mount(root) {
      elB = root;
      syncBoard();
      root.innerHTML = '<section class="page bd-page" id="bd-page"></section>';
      root.addEventListener('click', onBoardClick);
      root.addEventListener('change', onBoardChange);
      root.addEventListener('input', onBoardInput);
      root.addEventListener('pointerdown', (e) => {
        if (DB.edit) return;
        zoomDown(e, (i0, i1) => {
          const card = e.target.closest('[data-card]'), item = card && chartById(card.dataset.card);
          if (!item) return;
          const k = withCfg(item, () => zoomKeys(i0, i1)); if (k) { cardView(item.id).zoom = k; renderBoard(); }
        });
      });
      root.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') boardTip(e.target); });
      root.addEventListener('focusin', (e) => boardTip(e.target));
      root.addEventListener('keydown', onBoardKey);
      renderBoard();
    },
    update() { if (elB && !tileDrag && !typingInBoard()) renderBoard(); },
    unmount() { elB = null; closeRecords(); endHold(); },
    /** open one dashboard (from the sidebar) */
    open(id) {
      if (DB.edit && DB.edit.dirty && DB.edit.id !== id) { C.toast('Save or cancel your changes first'); return; }
      if (DB.edit && DB.edit.id !== id) DB.edit = null;
      DB.cur = id; keep(DB_CUR, id);
      if (C.currentRoute && C.currentRoute() === 'board') { renderBoard(); window.scrollTo(0, 0); } else C.go('board');
    },
    list: () => { syncBoard(); return allDashes().map((d) => ({ id: d.id, name: d.name, home: d.id === homeId(), on: C.currentRoute && C.currentRoute() === 'board' && d.id === shown().id })); }
  };
  const typingInBoard = () => { const a = document.activeElement; return !!(elB && a && elB.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== 'checkbox'); };

  function renderBoard() {
    const page = elB && elB.querySelector('#bd-page');
    if (!page) return;
    syncBoard();
    const d = shown(), edit = !!DB.edit, ds = allDashes();
    if (!edit) { DB.cur = d.id; }
    const tiles = edit ? G().resolve(d.tiles, null, false) : G().liveTiles(d.tiles, board).map(G().clamp);
    const isHome = d.id === homeId();
    const rangeSel = '<label class="cb-select"><span class="sr">Dates for every chart</span><select id="bd-range">' +
      [['own', 'Dates: each chart’s own'], ['4w', 'Every chart: last 4 weeks'], ['12w', 'Every chart: last 12 weeks'], ['6m', 'Every chart: last 6 months'], ['1y', 'Every chart: last year'], ['all', 'Every chart: all time']].map(([v, l]) => '<option value="' + v + '"' + ((boardRange() || 'own') === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' + icon('chevD') + '</label>';
    const acts = edit
      ? '<button type="button" class="btn sm" data-bd="picker" aria-expanded="' + DB.picker + '">' + icon('plus') + '<span>Add chart</span></button>' +
        '<button type="button" class="btn sm" data-bd="addtext">' + icon('note') + '<span>Text</span></button>' +
        '<button type="button" class="btn sm" data-bd="float" title="Slide everything up to close gaps">' + icon('up') + '<span>Float items up</span></button>' +
        (ds.length > 1 && !DB.edit.isNew ? (DB.confirm === 'del' ? '<button type="button" class="btn sm danger armed" data-bd="deldash">Tap again to delete</button>' : '<button type="button" class="btn sm ghost danger" data-bd="deldash">' + icon('trash') + '<span>Delete</span></button>') : '') +
        '<button type="button" class="btn sm ghost" data-bd="cancel">Cancel</button>' +
        '<button type="button" class="btn primary sm" data-bd="save">' + icon('check') + '<span>Save dashboard</span></button>'
      : rangeSel +
        (isHome ? '<span class="bd-homepill">' + icon('star') + 'Home</span>' : '<button type="button" class="btn sm ghost" data-bd="home" title="Open this dashboard first">' + icon('star') + '<span>Set as home</span></button>') +
        '<button type="button" class="btn sm" data-bd="edit">' + icon('settings') + '<span>Edit dashboard</span></button>' +
        '<a href="#charts" class="btn primary sm">' + icon('plus') + '<span>New chart</span></a>';
    const tabs = '<nav class="bd-tabs" aria-label="Dashboards">' + ds.map((x) => '<button type="button" class="bd-tab' + (x.id === d.id ? ' on' : '') + '" data-bd="open" data-id="' + esc(x.id) + '"' + (x.id === d.id ? ' aria-current="page"' : '') + (edit && x.id !== d.id ? ' disabled' : '') + '>' + (x.id === homeId() ? icon('star') : '') + '<span>' + esc(x.name) + '</span></button>').join('') +
      (edit && DB.edit.isNew ? '<span class="bd-tab on">' + esc(d.name) + '</span>' : '') +
      (edit ? '' : '<button type="button" class="bd-tab bd-newtab" data-bd="new">' + icon('plus') + '<span>New dashboard</span></button>') + '</nav>';
    const title = edit ? '<label class="bd-name"><span class="sr">Dashboard name</span><input id="bd-name" maxlength="60" value="' + esc(d.name) + '" autocomplete="off"></label>' : '<h1 class="display">' + esc(d.name) + '</h1>';
    const rows = Math.max(1, G().height(tiles) + (edit ? 6 : 0));
    const body = tiles.length
      ? '<div class="bd-cv' + (edit ? ' edit' : ' can-drill') + '" id="bd-cv" style="--rows:' + rows + '"><div class="bd-ghost" id="bd-ghost" hidden></div>' + G().readingOrder(tiles).map((t) => tileHtml(t, edit)).join('') + '</div>'
      : '<div class="st-sec bd-empty">' + icon('board') + '<h2>' + (board.length ? 'Nothing on this dashboard yet' : 'No saved charts yet') + '</h2><p class="muted">' +
        (board.length ? (edit ? 'Use <b>Add chart</b> to place your saved charts, then drag them where you want them.' : 'Choose <b>Edit dashboard</b> to place your saved charts on it.') : 'Build a chart in the Chart builder and choose <b>Save to board</b>. It will show up here.') + '</p>' +
        (board.length ? (edit ? '' : '<button type="button" class="btn primary" data-bd="edit">' + icon('settings') + '<span>Edit dashboard</span></button>') : '<a href="#charts" class="btn primary">' + icon('pie') + '<span>Open Chart builder</span></a>') + '</div>';
    page.innerHTML = '<header class="page-head"><p class="eyebrow"><a href="#insights" class="cb-back">' + icon('chevL') + 'Insights</a> · Dashboards</p>' +
      '<div class="bd-title">' + title + '<div class="bd-acts">' + acts + '</div></div>' + tabs +
      (edit ? '<p class="muted cb-lede bd-help">Drag a chart by its handle to move it, or drag its bottom-right corner to resize it. Each dot is one square; 24 across. Charts in the way move down. With a handle focused, arrow keys move it and Shift + arrow keys resize it.</p>'
        : '<p class="muted cb-lede">' + (phone() ? 'Tap a chart to see its tasks. Press and hold for the numbers.' : 'Click any bar, slice, point or dot to see the tasks behind it.') + '</p>') +
      '</header>' + (edit && DB.picker ? pickerHtml(d) : '') + body;
    fillPlots();
    if (C.renderChrome) C.renderChrome();
  }

  function tileHtml(t, edit) {
    const pos = 'style="--x:' + t.x + ';--y:' + t.y + ';--w:' + t.w + ';--h:' + t.h + '"';
    const label = t.text ? (t.text.title || 'Text block') : ((chartById(t.chart) || {}).title || 'chart');
    const grip = edit ? '<button type="button" class="bd-grip" data-cv="move" data-v="' + esc(t.id) + '" aria-label="Move ' + esc(label) + '. Arrow keys move it; Shift and arrow keys resize it." title="Drag to move">' + icon('grip') + '</button>' : '';
    const del = edit ? '<button type="button" class="icon-btn sm" data-bd="tdel" data-v="' + esc(t.id) + '" aria-label="Remove ' + esc(label) + ' from this dashboard" title="Remove from this dashboard">' + icon('x') + '</button>' : '';
    const rz = edit ? '<button type="button" class="bd-rz" data-cv="rz" data-v="' + esc(t.id) + '" aria-label="Resize ' + esc(label) + ', now ' + t.w + ' by ' + t.h + ' squares" title="Drag to resize"></button><span class="bd-badge" hidden></span>' : '';
    if (t.text) {
      const inner = edit
        ? '<input class="bd-ttl" data-tt="title" data-v="' + esc(t.id) + '" value="' + esc(t.text.title || '') + '" placeholder="Heading" aria-label="Heading" maxlength="80"><textarea class="bd-tbody" data-tt="body" data-v="' + esc(t.id) + '" placeholder="Notes (optional)" aria-label="Text" rows="2" maxlength="600">' + esc(t.text.body || '') + '</textarea>'
        : (t.text.title ? '<h2>' + esc(t.text.title) + '</h2>' : '') + (t.text.body ? '<p>' + esc(t.text.body) + '</p>' : '');
      return '<article class="bd-tile bd-text' + (edit ? '' : ' plain') + '" data-tile="' + esc(t.id) + '" ' + pos + '>' + (edit ? '<header class="bd-th">' + grip + '<span class="bd-cap muted">Text</span>' + del + '</header>' : '') + '<div class="bd-tx">' + inner + '</div>' + rz + '</article>';
    }
    const item = chartById(t.chart);
    if (!item) return '';
    return withCfg(item, () => {
      const kp = item.type === 'kpi';
      const legend = kp || item.type === 'table' ? '' : legendHtml();
      return '<article class="st-sec bd-tile bd-card' + (kp ? ' bd-kpi' : '') + (item.type === 'table' ? ' bd-tbl' : '') + '" data-tile="' + esc(t.id) + '" data-card="' + esc(item.id) + '" ' + pos + '>' +
        '<header class="bd-th">' + grip + '<div class="bd-tt"><h2>' + esc(item.title || autoTitle()) + '</h2>' + (kp ? '' : '<p class="bd-filters muted">' + esc(filterText()) + '</p>') + '</div>' +
        (edit ? del : '<div class="cb-card-btns"><button type="button" class="icon-btn sm" data-edit="' + item.id + '" aria-label="Edit chart" title="Edit in Chart builder">' + icon('settings') + '</button>' +
          '<button type="button" class="icon-btn sm" data-cmenu="' + item.id + '" aria-label="More for this chart" aria-haspopup="menu" title="Download, remove">' + icon('more') + '</button></div>') + '</header>' +
        '<div class="cb-plot bd-plot" data-fill="' + esc(item.id) + '"></div>' + (edit ? '' : zoomHtml(false)) +
        (legend ? '<div class="ins-legend cb-legend bd-legend">' + legend + '<span class="ins-cap" aria-live="polite"></span></div>' : '') + rz + '</article>';
    });
  }

  /** draw each chart at the size its tile has now (after the tiles are on the page) */
  function fillPlots() {
    if (!elB) return;
    const ph = phone();
    elB.querySelectorAll('[data-fill]').forEach((slot) => {
      const item = chartById(slot.dataset.fill); if (!item) return;
      const W = Math.max(160, Math.round(slot.clientWidth)), H = Math.max(90, Math.round(slot.clientHeight));
      const size = ph ? { W, H: item.type === 'table' ? 0 : 200, kpi: true } : { W, H, kpi: true };
      slot.innerHTML = withCfg(item, () => plot(ph, size), ph && item.type === 'table' ? { limit: 3 } : null);
    });
  }
  let fitT = null;
  window.addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(() => { if (elB && !tileDrag) renderBoard(); }, 150); });

  function pickerHtml(d) {
    const on = new Set(d.tiles.filter((t) => t.chart).map((t) => t.chart));
    const ds = allDashes();
    return '<section class="st-sec bd-picker" aria-label="Your saved charts"><header class="bd-ph"><h2>Your saved charts</h2><span class="muted">' + board.length + '</span><a href="#charts" class="btn sm ghost">' + icon('plus') + '<span>New chart</span></a><button type="button" class="icon-btn sm" data-bd="picker" aria-label="Close">' + icon('x') + '</button></header>' +
      (board.length ? '<ul class="bd-plist">' + board.map((c) => {
        const elsewhere = ds.filter((x) => x.id !== d.id && (x.tiles || []).some((t) => t.chart === c.id)).map((x) => x.name);
        const typeName = (TYPES.find((x) => x[0] === c.type) || [0, 'Chart'])[1];
        return '<li><div class="bd-pt"><b>' + esc(c.title || withCfg(c, autoTitle)) + '</b><span class="muted">' + esc(typeName) + (on.has(c.id) ? ' · on this dashboard' : elsewhere.length ? ' · also on ' + esc(elsewhere.join(', ')) : ' · not on any dashboard') + '</span></div>' +
          '<button type="button" class="btn sm' + (on.has(c.id) ? ' ghost' : '') + '" data-bd="add" data-v="' + esc(c.id) + '">' + icon('plus') + '<span>' + (on.has(c.id) ? 'Add again' : 'Add') + '</span></button></li>';
      }).join('') + '</ul>' : '<p class="muted">No saved charts yet. Build one in the Chart builder and choose Save to board.</p>') + '</section>';
  }

  /* ---------- editing ---------- */
  function startEdit(dash, isNew) {
    DB.edit = { id: dash.id, name: dash.name, tiles: G().resolve(G().liveTiles(dash.tiles, board), null, false), dirty: !!isNew, isNew: !!isNew };
    DB.picker = !DB.edit.tiles.length; DB.confirm = null;
    renderBoard();
  }
  function editTiles(fn) { if (!DB.edit) return; DB.edit.tiles = fn(DB.edit.tiles.map((t) => Object.assign({}, t))); DB.edit.dirty = true; renderBoard(); }
  function saveEdit() {
    const e = DB.edit; if (!e) return;
    const ds = allDashes().map((x) => Object.assign({}, x));
    const out = { id: e.id, name: (e.name || '').trim().slice(0, 60) || 'Dashboard', tiles: G().resolve(e.tiles, null, false).map((t) => (t.text ? { id: t.id, text: { title: t.text.title || '', body: t.text.body || '' }, x: t.x, y: t.y, w: t.w, h: t.h } : { id: t.id, chart: t.chart, x: t.x, y: t.y, w: t.w, h: t.h })) };
    const i = ds.findIndex((x) => x.id === e.id);
    if (i >= 0) ds[i] = out; else ds.push(out);
    DB.edit = null; DB.picker = false; DB.confirm = null; DB.cur = out.id; keep(DB_CUR, out.id);
    saveDashes(ds);
    C.toast('Dashboard saved');
    renderBoard();
  }
  function onBoardChange(e) {
    const t = e.target;
    if (t.id === 'bd-range') { keep(BOARD_RANGE, t.value); Object.values(cardUi).forEach((v) => (v.zoom = null)); renderBoard(); }
  }
  function onBoardInput(e) {
    const t = e.target;
    if (!DB.edit) return;
    if (t.id === 'bd-name') { DB.edit.name = t.value; DB.edit.dirty = true; return; }
    if (t.dataset.tt) { const tile = DB.edit.tiles.find((x) => x.id === t.dataset.v); if (tile) { tile.text = Object.assign({}, tile.text, { [t.dataset.tt]: t.value }); DB.edit.dirty = true; } }
  }

  /* ---------- dragging and resizing ----------
     While the pointer moves nothing is redrawn: the tile follows the pointer, a dashed outline
     shows the squares it will land on, and the other tiles slide to where they would go. */
  let tileDrag = null;
  const setBox = (n, t) => { n.style.setProperty('--x', t.x); n.style.setProperty('--y', t.y); n.style.setProperty('--w', t.w); n.style.setProperty('--h', t.h); };
  document.addEventListener('pointerdown', (e) => {
    const h = e.target.closest && e.target.closest('#bd-cv [data-cv]');
    if (!h || !DB.edit || (e.button != null && e.button !== 0)) return;
    const cv = document.getElementById('bd-cv'), n = h.closest('[data-tile]');
    if (!cv || !n) return;
    e.preventDefault();
    const tiles = G().resolve(DB.edit.tiles, null, false);
    const t0 = tiles.find((t) => t.id === h.dataset.v); if (!t0) return;
    tileDrag = { id: t0.id, mode: h.dataset.cv === 'rz' ? 'resize' : 'move', sx: e.clientX, sy: e.clientY, colW: cv.getBoundingClientRect().width / G().COLS, tiles, t0, n, cv, rect: n.getBoundingClientRect(), result: tiles, pid: e.pointerId, moved: false };
    try { h.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
    n.classList.add('dragging');
  });
  window.addEventListener('pointermove', (e) => {
    const d = tileDrag; if (!d || e.pointerId !== d.pid) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    const t = Object.assign({}, d.t0), MW = G().MIN_W, mh = G().minH(t), COLS = G().COLS;
    if (d.mode === 'move') {
      t.x = Math.max(0, Math.min(COLS - t.w, Math.round(d.t0.x + dx / d.colW)));
      t.y = Math.max(0, Math.round(d.t0.y + dy / d.colW));
      d.n.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    } else {
      t.w = Math.max(MW, Math.min(COLS - t.x, Math.round(d.t0.w + dx / d.colW)));
      t.h = Math.max(mh, Math.round(d.t0.h + dy / d.colW));
      d.n.style.width = Math.max(d.colW * MW - 10, d.rect.width + dx) + 'px';
      d.n.style.height = Math.max(d.colW * mh - 10, d.rect.height + dy) + 'px';
      const b = d.n.querySelector('.bd-badge'); if (b) { b.hidden = false; b.textContent = t.w + ' × ' + t.h; }
    }
    d.result = G().resolve(d.tiles.map((x) => (x.id === d.id ? t : x)), d.id, false);
    d.result.forEach((x) => { if (x.id === d.id) return; const o = d.cv.querySelector('[data-tile="' + CSS.escape(x.id) + '"]'); if (o) setBox(o, x); });
    const g = document.getElementById('bd-ghost'), mine = d.result.find((x) => x.id === d.id);
    if (g && mine) { g.hidden = false; setBox(g, mine); }
    d.cv.style.setProperty('--rows', G().height(d.result) + 6);
  });
  function endTileDrag(e) {
    const d = tileDrag; if (!d || (e && e.pointerId !== d.pid)) return;
    tileDrag = null;
    if (DB.edit && d.moved) { DB.edit.tiles = d.result; DB.edit.dirty = true; }
    renderBoard();
    const h = elB && elB.querySelector('#bd-cv [data-cv="' + (d.mode === 'move' ? 'move' : 'rz') + '"][data-v="' + CSS.escape(d.id) + '"]');
    if (h) h.focus({ preventScroll: true });
  }
  window.addEventListener('pointerup', endTileDrag);
  window.addEventListener('pointercancel', endTileDrag);

  function onBoardKey(e) {
    if (e.target.matches && e.target.matches('[data-trow]') && e.key === 'Enter') { e.preventDefault(); return C.openEditor(e.target.dataset.trow); }
    const n = e.target.closest('[data-seg]'); if (n && !DB.edit && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); n.dispatchEvent(new MouseEvent('click', { bubbles: true })); return; }
    if (e.key === 'Enter' && e.target.id === 'bd-name') { e.preventDefault(); e.target.blur(); return; }
    const h = e.target.closest && e.target.closest('#bd-cv [data-cv="move"]');
    if (!h || !DB.edit || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const tiles = G().resolve(DB.edit.tiles, null, false), t = tiles.find((x) => x.id === h.dataset.v); if (!t) return;
    const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    const COLS = G().COLS;
    const nt = e.shiftKey ? Object.assign({}, t, { w: Math.max(G().MIN_W, Math.min(COLS - t.x, t.w + dx)), h: Math.max(G().minH(t), t.h + dy) }) : Object.assign({}, t, { x: Math.max(0, Math.min(COLS - t.w, t.x + dx)), y: Math.max(0, t.y + dy) });
    DB.edit.tiles = G().resolve(tiles.map((x) => (x.id === t.id ? nt : x)), t.id, false); DB.edit.dirty = true;
    const id = t.id; renderBoard();
    const again = elB.querySelector('#bd-cv [data-cv="move"][data-v="' + CSS.escape(id) + '"]'); if (again) again.focus({ preventScroll: true });
  }

  /* ---------- chart menu (viewing) ---------- */
  function cardMenu(btn, id) {
    syncBoard();
    const it = chartById(id); if (!it) return;
    const d = shown();
    const others = G().usedOn(allDashes(), id).filter((x) => x.id !== d.id);
    const items = [
      { label: 'Download PNG', ic: 'image', run: () => { const card = elB.querySelector('[data-card="' + id + '"]'); withCfg(it, () => exportPng(card, it.title || autoTitle())); } },
      { label: 'Download CSV', ic: 'download', run: () => withCfg(it, () => exportCsv(it.title || autoTitle())) },
      'sep',
      { label: 'Remove from this dashboard', ic: 'x', run: () => removeFromDash(id) },
      { label: others.length ? 'Delete chart (also on ' + others.map((x) => x.name).join(', ') + ')' : 'Delete chart', ic: 'trash', danger: true, run: () => deleteChart(id) }
    ];
    C.map.menu(items, { anchor: btn, cls: 'menu bd-menu' });
  }
  function removeFromDash(chartId) {
    const d = curDash(), before = allDashes();
    const ds = before.map((x) => (x.id === d.id ? Object.assign({}, x, { tiles: x.tiles.filter((t) => t.chart !== chartId) }) : x));
    saveDashes(ds); renderBoard();
    C.toast('Removed from “' + d.name + '”. The chart is still saved.', { action: 'Undo', onAction: () => { saveDashes(before); renderBoard(); } });
  }
  function deleteChart(id) {
    syncBoard();
    const idx = board.findIndex((b) => b.id === id); if (idx < 0) return;
    const gone = board[idx], beforeCharts = board.slice(), beforeDash = allDashes();
    const ds = beforeDash.map((x) => Object.assign({}, x, { tiles: (x.tiles || []).filter((t) => t.chart !== id) }));
    saveDashes(ds, board.filter((b) => b.id !== id));
    if (cfg.id === gone.id) { cfg.id = null; keep(LS_DRAFT, cfg); }
    renderBoard();
    C.toast('Deleted “' + (gone.title || 'chart') + '”', { action: 'Undo', onAction: () => { saveDashes(beforeDash, beforeCharts); renderBoard(); } });
  }
  /** a chart just saved in the builder goes on the dashboard you last looked at */
  function placeNewChart(item) {
    syncBoard();
    if (!Array.isArray(S().state.board.dashboards) || !S().state.board.dashboards.length) return curDash().name; // the old board shows every chart anyway
    const d = curDash();
    const ds = allDashes().map((x) => (x.id === d.id ? Object.assign({}, x, { tiles: G().addChart(x.tiles, item, C.uid('tl')) }) : x));
    saveDashes(ds);
    return d.name;
  }

  function filterText() {
    const st = { all: 'All tasks', open: 'Open tasks', overdue: 'Overdue tasks', done: 'Done tasks' }[cfg.status] || 'All tasks';
    const rg = { all: 'all time', '4w': 'last 4 weeks', '12w': 'last 12 weeks', '6m': 'last 6 months', '1y': 'last year' }[curRange()] || 'all time';
    const f = flt(), extra = FILTERS.filter((x) => f[x.key]).map((x) => x.label + ': ' + filterWord(x, f[x.key])).concat(f.text ? ['“' + f.text + '”'] : []);
    return (FLOW_TYPES.includes(cfg.type) ? 'All tasks' : st) + ' · ' + rg + (extra.length ? ' · ' + extra.join(', ') : '');
  }
  function boardTip(t) {
    const node = t && t.closest && t.closest('[data-tip]');
    if (!node || !elB || !elB.contains(node)) return;
    const card = node.closest('.bd-card'); if (!card) return;
    card.querySelectorAll('.tipped').forEach((x) => x.classList.remove('tipped'));
    node.classList.add('tipped');
    const cap = card.querySelector('.ins-cap'); if (cap) cap.textContent = node.dataset.tip + ' · click to see tasks';
  }

  function onBoardClick(e) {
    if (swallowZoomClick) { e.preventDefault(); return; }
    const t = e.target;
    syncBoard();
    const b = t.closest('[data-bd]');
    if (b) {
      const a = b.dataset.bd, v = b.dataset.v;
      if (a !== 'deldash') DB.confirm = null;
      switch (a) {
        case 'open': return boardView.open(b.dataset.id);
        case 'edit': return startEdit(curDash());
        case 'new': return startEdit({ id: C.uid('db'), name: 'New dashboard', tiles: [] }, true);
        case 'home': saveDashes(allDashes(), null, curDash().id); C.toast('“' + curDash().name + '” opens first now'); return renderBoard();
        case 'cancel': DB.edit = null; DB.picker = false; return renderBoard();
        case 'save': return saveEdit();
        case 'picker': DB.picker = !DB.picker; return renderBoard();
        case 'float': return editTiles((tl) => G().float(tl));
        case 'addtext': return editTiles((tl) => { const p = G().place(tl, 24, 2); return tl.concat([{ id: C.uid('tl'), text: { title: '', body: '' }, x: p.x, y: p.y, w: 24, h: 2 }]); });
        case 'add': { const c = chartById(v); if (!c) return; editTiles((tl) => G().addChart(tl, c, C.uid('tl'))); C.toast('Added “' + (c.title || 'chart') + '”'); return; }
        case 'tdel': return editTiles((tl) => tl.filter((x) => x.id !== v));
        case 'deldash': {
          if (DB.confirm !== 'del') { DB.confirm = 'del'; return renderBoard(); }
          const id = DB.edit.id, name = DB.edit.name, before = allDashes();
          const ds = before.filter((x) => x.id !== id);
          DB.edit = null; DB.confirm = null; DB.cur = ds[0].id; keep(DB_CUR, DB.cur);
          saveDashes(ds, null, homeId() === id ? ds[0].id : homeId());
          C.toast('Deleted “' + name + '”. Its charts are still saved.', { action: 'Undo', onAction: () => { saveDashes(before); renderBoard(); } });
          return renderBoard();
        }
      }
      return;
    }
    if (DB.edit) return; // arranging, not reading
    const card = t.closest('[data-card]');
    const lg = t.closest('[data-legend]');
    if (lg && card) { const vw = cardView(card.dataset.card), k = lg.dataset.legend; vw.solo = k && vw.solo !== k ? k : null; return renderBoard(); }
    if (t.closest('[data-unzoom]') && card) { cardView(card.dataset.card).zoom = null; return renderBoard(); }
    if (card) {
      const tc = t.closest('[data-tcheck]'); if (tc) return C.completeTask(tc.dataset.tcheck);
      const ts = t.closest('[data-tsort]');
      if (ts) { const it = chartById(card.dataset.card); if (it) { board = board.map((x) => (x.id === it.id ? Object.assign({}, x, { sort: nextSort(it.sort, ts.dataset.tsort) }) : x)); saveBoard(); renderBoard(); } return; }
      if (t.closest('[data-tmore]')) return openRecords(card.dataset.card, 'all', '');
      const tr = t.closest('[data-trow]'); if (tr) return C.openEditor(tr.dataset.trow);
    }
    const seg = t.closest('[data-seg]');
    if (seg && card) return openRecords(card.dataset.card, seg.dataset.seg, seg.dataset.tip);
    const ed = t.closest('[data-edit]');
    if (ed) {
      const item = chartById(ed.dataset.edit);
      if (item) { Object.assign(cfg, BLANK, item); keep(LS_DRAFT, cfg); const vw = cardView(item.id); ui.solo = vw.solo; ui.zoom = vw.zoom; C.go('charts'); }
      return;
    }
    const cm = t.closest('[data-cmenu]'); if (cm) return cardMenu(cm, cm.dataset.cmenu);
    // phones: a tap on a card's empty space shows all of its tasks
    if (card && phone() && !t.closest('button, a, input, select, textarea')) return openRecords(card.dataset.card, 'all', '');
  }

  /* ---------- phones: press and hold a chart for its numbers ---------- */
  const HOLD_MS = 450, HOLD_SLOP = 10;
  let hold = null, eatClick = false;
  function holdFacts(e, card) {
    const node = e.target.closest && e.target.closest('[data-tip]');
    const item = chartById(card.dataset.card); if (!item) return null;
    if (node && card.contains(node)) {
      const tip = node.dataset.tip, i = tip.indexOf(':');
      return { title: i > 0 ? tip.slice(0, i) : (item.title || 'Chart'), lines: [i > 0 ? tip.slice(i + 1).trim() : tip, 'Tap to see the tasks'] };
    }
    const r = recordsFor(item, 'all');
    return { title: item.title || withCfg(item, autoTitle), lines: [r ? r.tasks.length + ' task' + (r.tasks.length === 1 ? '' : 's') : '', 'Tap to see them'].filter(Boolean) };
  }
  function showHold(f, x, y) {
    let b = document.getElementById('bd-hold');
    if (!b) { b = document.createElement('div'); b.id = 'bd-hold'; b.className = 'bd-hold'; b.setAttribute('role', 'status'); document.body.appendChild(b); }
    b.innerHTML = '<b>' + esc(f.title) + '</b>' + f.lines.map((s) => '<span>' + esc(s) + '</span>').join('');
    b.hidden = false;
    const r = b.getBoundingClientRect(), vw = document.documentElement.clientWidth;
    b.style.left = Math.max(8, Math.min(vw - r.width - 8, x - r.width / 2)) + 'px';
    b.style.top = (y - r.height - 28 >= 8 ? y - r.height - 28 : y + 28) + 'px';
  }
  function endHold() {
    if (!hold) return;
    clearTimeout(hold.timer);
    if (hold.shown) { const b = document.getElementById('bd-hold'); if (b) b.hidden = true; eatClick = true; setTimeout(() => { eatClick = false; }, 600); }
    hold = null;
  }
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || DB.edit) return;
    const card = e.target.closest && e.target.closest('#bd-cv.can-drill .bd-card');
    if (!card) return;
    endHold();
    hold = { x: e.clientX, y: e.clientY, shown: false, pid: e.pointerId };
    hold.timer = setTimeout(() => {
      if (!hold) return;
      const f = holdFacts(e, card); if (!f) { hold = null; return; }
      hold.shown = true; showHold(f, hold.x, hold.y);
    }, HOLD_MS);
  });
  window.addEventListener('pointermove', (e) => { if (hold && e.pointerId === hold.pid && !hold.shown && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > HOLD_SLOP) { clearTimeout(hold.timer); hold = null; } });
  window.addEventListener('pointerup', endHold);
  window.addEventListener('pointercancel', endHold);
  window.addEventListener('scroll', () => { if (hold && !hold.shown) { clearTimeout(hold.timer); hold = null; } }, true);
  document.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('#bd-cv.can-drill .bd-card') && (hold || eatClick)) e.preventDefault(); });
  document.addEventListener('click', (e) => { if (eatClick && e.target.closest && e.target.closest('#bd-cv')) { eatClick = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);

  /* ---------- records modal ---------- */
  let modal = null;
  function recordsFor(item, seg) {
    return withCfg(item, () => {
      if (seg === 'all' && cfg.type === 'table') return { title: item.title || autoTitle(), label: 'All ' + tableRows().n + ' tasks', color: 'var(--accent)', tasks: tableRows().list };
      if (seg === 'all' && cfg.type === 'kpi') { const k = kpiData(); return { title: item.title || autoTitle(), label: fmt(k.value, k.unit) + ' · ' + (item.title || autoTitle()), color: 'var(--accent)', tasks: k.tasks }; }
      if (seg[0] === 'n' && cfg.type === 'sunburst') {
        const sb = sunData(); if (!sb) return null;
        const nd = seg === 'nall' ? sb.center : sb.find(seg.slice(1));
        if (!nd) return null;
        return { title: item.title || autoTitle(), label: seg === 'nall' ? 'Whole map' : nd.title, color: nd.hex, tasks: nd.all };
      }
      if (seg[0] === 'h' && cfg.type === 'handoff') {
        const h = handoffData();
        if (seg[1] === 'l' || seg[1] === 'r') {
          const side = seg[1], p = (side === 'l' ? h.left : h.right)[+seg.slice(2)]; if (p == null) return null;
          return { title: item.title || autoTitle(), label: side === 'l' ? 'Assigned by ' + p : 'Assigned to ' + p, color: h.colors[p], tasks: h.pairs.filter((q) => (side === 'l' ? q.a : q.b) === p).map((q) => q.t) };
        }
        const [li, ri] = seg.slice(1).split(':').map(Number), l = h.links.find((x) => x.li === li && x.ri === ri);
        return l ? { title: item.title || autoTitle(), label: l.a + ' → ' + l.b, color: h.colors[l.a], tasks: l.tasks } : null;
      }
      if (seg === 'all' && cfg.type === 'sunburst') { const sb = sunData(); return sb ? { title: item.title || autoTitle(), label: 'Whole map', color: 'var(--accent)', tasks: sb.center.all } : null; }
      if (seg === 'all' && cfg.type === 'handoff') { const h = handoffData(); return { title: item.title || autoTitle(), label: 'Every handoff', color: 'var(--accent)', tasks: h.pairs.map((q) => q.t) }; }
      const b = build();
      if (seg === 'all') {
        const seen = new Set(), tasks = [];
        (b.points ? b.points.map((p) => p.t) : (b.raw || []).map((r) => r.t)).forEach((t) => { if (t && !seen.has(t.id)) { seen.add(t.id); tasks.push(t); } });
        return { title: item.title || autoTitle(), label: 'All ' + tasks.length + ' task' + (tasks.length === 1 ? '' : 's'), color: 'var(--accent)', tasks };
      }
      if (seg[0] === 'p') {
        const p = b.points[+seg.slice(1)];
        if (!p) return null;
        const same = b.points.filter((q) => Math.abs(q.x - p.x) < 0.05 && Math.abs(q.y - p.y) < 0.05);
        return { title: item.title || autoTitle(), label: NUMS[cfg.x].label + ' ' + fmt(p.x, NUMS[cfg.x].unit) + ' · ' + NUMS[cfg.y].label + ' ' + fmt(p.y, NUMS[cfg.y].unit), color: b.colors[p.s], tasks: same.map((q) => q.t) };
      }
      const [cs, ss] = seg.split(':'), ci = +cs, all = ss === '*';
      const cat = b.cats[ci], ser = all ? { key: '_', label: '', color: 'var(--accent)' } : b.series[+ss];
      if (!cat || !ser) return null;
      const sKey = ser.key;
      const tasks = b.raw.filter((r) => r.x === cat.key && (sKey === '_' || r.s === sKey)).map((r) => r.t);
      const label = cat.label + (sKey !== '_' ? ' · ' + ser.label : '');
      return { title: item.title || autoTitle(), label, color: all || b.colorByCat || cfg.type === 'pie' || cfg.type === 'donut' ? (b.colorByCat || cfg.type === 'pie' || cfg.type === 'donut' ? cat.color : 'var(--accent)') : ser.color, tasks };
    });
  }

  function openRecords(itemId, seg, tipText) {
    syncBoard();
    const item = board.find((b) => b.id === itemId);
    if (!item) return;
    const r = recordsFor(item, seg);
    if (!r) return;
    closeRecords(true);
    const tk = D.todayKey();
    const byMoves = ['moved', 'pushed'].includes(item.y) || item.x === 'moves' || item.x === 'moved';
    const tasks = r.tasks.slice().sort((a, b) => (byMoves ? (b.moved || 0) - (a.moved || 0) || (b.pushed || 0) - (a.pushed || 0) : 0) || (a.done - b.done) || ((a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : S().levelRank(a.levelId) - S().levelRank(b.levelId)));
    const open = tasks.filter((t) => !t.done).length;
    const wrap = document.createElement('div');
    wrap.className = 'rec-wrap';
    wrap.innerHTML = '<div class="sheet-backdrop" data-rclose></div>' +
      '<div class="rec" role="dialog" aria-modal="true" aria-labelledby="rec-title" style="--c:' + r.color + '">' +
      '<header class="rec-head"><span class="rec-swatch" aria-hidden="true"></span><div class="rec-titles"><span class="eyebrow">' + esc(r.title) + '</span>' +
      '<h2 id="rec-title">' + esc(r.label) + '</h2>' +
      '<p class="muted">' + (tipText && tipText.indexOf(':') > -1 && !/task/.test(tipText.slice(tipText.indexOf(':'))) ? esc(tipText.slice(tipText.indexOf(':') + 1).trim()) + ' · ' : '') + tasks.length + ' task' + (tasks.length === 1 ? '' : 's') + (tasks.length && open !== tasks.length ? ' · ' + open + ' open' : '') + '</p></div>' +
      '<button type="button" class="icon-btn" data-rclose aria-label="Close">' + icon('x') + '</button></header>' +
      '<div class="rec-list">' + (tasks.length ? tasks.map((t) => recRow(t, tk)).join('') : '<p class="muted rec-none">No tasks here.</p>') + '</div>' +
      '</div>';
    document.getElementById('overlay-root').appendChild(wrap);
    const prevFocus = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRecords(); }
      else if (e.key === 'Tab') { // keep focus inside the dialog
        const f = wrap.querySelectorAll('button'); if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-rclose]')) return closeRecords();
      const ck = e.target.closest('[data-rcheck]');
      if (ck) {
        const id = ck.dataset.rcheck; C.completeTask(id);
        const t = S().get(id); const row = ck.closest('.rec-row');
        if (t && row) { row.classList.toggle('done', !t.done); ck.setAttribute('aria-pressed', String(!t.done)); }
        return;
      }
      const row = e.target.closest('[data-rec]');
      if (row) { const id = row.dataset.rec; closeRecords(); C.openEditor(id); }
    });
    modal = { wrap, onKey, prevFocus };
    requestAnimationFrame(() => { wrap.classList.add('in'); const c = wrap.querySelector('.rec-head .icon-btn'); if (c) c.focus(); });
  }
  function recRow(t, tk) {
    const ty = S().typeOf(t), lv = S().levelOf(t);
    const late = !t.done && t.due && t.due < tk;
    return '<div class="rec-row' + (t.done ? ' done' : '') + '" style="--lv:' + (lv ? lv.color : 'var(--ink-3)') + '">' +
      '<button type="button" class="check sm" data-rcheck="' + t.id + '" aria-pressed="' + !!t.done + '" aria-label="' + (t.done ? 'Reopen' : 'Complete') + ' ' + esc(t.title) + '">' + icon('check') + '</button>' +
      '<button type="button" class="rec-main" data-rec="' + t.id + '"><span class="rec-body"><span class="rec-t">' + esc(t.title) + '</span>' +
      '<span class="rec-meta">' + (t.due ? '<span class="' + (late ? 'late' : '') + '">' + icon('calendar') + esc(C.relDate(t.due)) + (t.time ? ' ' + esc(C.fmtTime(t.time)) : '') + '</span>' : '') +
      (ty ? '<span class="type-tag" style="--c:' + ty.color + '">' + icon(ty.glyph) + esc(ty.name) + '</span>' : '') +
      (lv ? '<span class="rec-lv"><i></i>' + esc(lv.name) + '</span>' : '') +
      ((t.subtasks || []).length ? '<span>' + icon('rows') + (t.subtasks.filter((x) => x.done).length) + '/' + t.subtasks.length + '</span>' : '') +
      (t.moved ? '<span class="rec-moved' + (t.moved >= 3 ? ' lots' : '') + '" title="Times rescheduled">' + icon('repeat') + 'Moved ' + t.moved + '×</span>' : '') +
      (C.handoffLabel(t) ? '<span class="rec-who">' + icon('heart') + esc(C.handoffLabel(t)) + '</span>' : '') +
      '</span></span>' + icon('chevR') + '</button></div>';
  }
  function closeRecords(instant) {
    if (!modal) return;
    const { wrap, onKey, prevFocus } = modal; modal = null;
    document.removeEventListener('keydown', onKey, true);
    if (instant) wrap.remove(); else { wrap.classList.remove('in'); setTimeout(() => wrap.remove(), 180); }
    if (prevFocus && prevFocus.focus && document.contains(prevFocus)) try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* gone */ }
  }

  function onChange(e) {
    const t = e.target;
    if (t.hasAttribute('data-addcol')) { if (t.value) return setCfg({ cols: tCols().concat(t.value) }); return; }
    if (t.hasAttribute('data-ftext')) { const f = Object.assign({}, flt(), { text: t.value.trim() || null }); Object.keys(f).forEach((k) => { if (!f[k]) delete f[k]; }); return setCfg({ f: Object.keys(f).length ? f : null }); }
    if (t.dataset.cfg) return setCfg({ [t.dataset.cfg]: t.value });
    if (t.hasAttribute('data-compare')) return setCfg({ compare: t.checked });
    if (t.dataset.filter) { const f = Object.assign({}, flt(), { [t.dataset.filter]: t.value || null }); Object.keys(f).forEach((k) => { if (!f[k]) delete f[k]; }); return setCfg({ f: Object.keys(f).length ? f : null }); }
    if (t.hasAttribute('data-goal')) { const v = t.value.trim(); return setCfg({ goal: v === '' || !isFinite(+v) ? null : +v }); }
    if (t.hasAttribute('data-stack')) return setCfg({ stack: t.checked });
    if (t.hasAttribute('data-self')) return setCfg({ selfToo: t.checked });
    if (t.id === 'cb-title') { cfg.title = t.value.trim(); keep(LS_DRAFT, cfg); }
  }
})();
