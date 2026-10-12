/* Cadence — Chart builder + Board: drag fields onto X axis / Values / Split by and pick a chart type.
   Works with mouse, pen and touch. On touch you can also tap a field, then tap where it goes.
   Saved charts live on the board, which syncs with the account (state.board in the store).
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
    { name: 'Weekly completions vs. goal', cfg: { type: 'column', x: 'completed', y: 'count', series: null, status: 'done', range: '12w', goal: 5, goalDir: 'atLeast' } }
  ];
  const BLANK = { type: 'column', x: null, y: 'count', agg: 'count', series: null, stack: true, status: 'all', range: 'all', grain: 'auto', title: '', goal: null, goalDir: 'atLeast', kpiPeriod: 'all', compare: false, trend: 'none', f: null };
  const FLOW_TYPES = ['burnup', 'cfd'];
  const RANGE_DAYS = { '4w': 28, '12w': 84, '6m': 183, '1y': 365 };
  const RANGE_WORDS = { '4w': '4 weeks', '12w': '12 weeks', '6m': '6 months', '1y': 'year' };
  let rangeOverride = null; // the Board's "same dates for every chart"
  const curRange = () => rangeOverride || cfg.range;
  const flt = () => cfg.f || {};
  const canCompare = () => ['column', 'bar', 'line', 'area'].includes(cfg.type) && !!RANGE_DAYS[curRange()] && !cfg.series;
  const canTrend = () => ['column', 'line', 'area'].includes(cfg.type) && cfg.x && DIMS[cfg.x] && DIMS[cfg.x].time && !cfg.series;
  const GOAL_TYPES = ['column', 'bar', 'line', 'area', 'kpi'];
  const LOWER_IS_BETTER = ['late', 'age', 'toDone'];
  const hasGoal = () => GOAL_TYPES.includes(cfg.type) && cfg.goal != null && cfg.goal !== '' && isFinite(cfg.goal);
  const meets = (v) => (cfg.goalDir === 'atMost' ? v <= +cfg.goal : v >= +cfg.goal);

  /* ---------- state ---------- */
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } };
  let cfg = Object.assign({}, BLANK, load(LS_DRAFT, { x: 'type', series: 'status' }));
  let board = [];
  const syncBoard = () => { board = S().state.board.charts; };
  const saveBoard = () => S().setBoard(board.slice());
  const ui = { picked: null, flash: null, flashZone: null };
  let el = null;

  const view = (C.views = C.views || {}).charts = {
    title: 'Chart builder',
    mount(root) {
      el = root;
      root.innerHTML = '<section class="page cb-page"><header class="page-head"><p class="eyebrow"><a href="#insights" class="cb-back">' + icon('chevL') + 'Insights</a></p><h1 class="display">Chart builder</h1>' +
        '<p class="muted cb-lede">Drag fields onto the chart, or tap a field and then tap where it goes. Pick any chart type and save the ones you like to your board.</p></header><div id="cb-root"></div></section>';
      root.addEventListener('click', onClick);
      root.addEventListener('change', onChange);
      root.addEventListener('pointerdown', onDown);
      root.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') showTip(e.target); });
      root.addEventListener('focusin', (e) => showTip(e.target));
      root.addEventListener('keydown', (e) => {
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

  function setCfg(patch) {
    Object.assign(cfg, patch);
    // keep the summary (count / sum / average) valid for the value field
    const y = NUMS[cfg.y];
    if (y && !y.aggs.includes(cfg.agg)) cfg.agg = y.aggs[0];
    keep(LS_DRAFT, cfg);
    render();
  }

  /* ---------- data ---------- */
  function rows(opts) {
    const tk = D.todayKey(), now = Date.now();
    const ctx = { tk, now, map: mapCtx() };
    let list = S().state.tasks.filter((t) => !t.sample);
    const f = flt();
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
    if (FLOW_TYPES.includes(cfg.type)) return flowBuild();
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
      return { points: pts, keys, colors, n: list.length };
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
    return { cats, series, grain, n: list.length, colorByCat: !sd && !xd.time && !!xd.color, raw, prev, trend, total: aggregate(raw.map((r) => r.v), cfg.agg) };
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

  /* ---------- validity & titles ---------- */
  function problem() {
    if (cfg.type === 'sunburst') {
      if (!C.map || !C.map.nodes().length) return 'A sunburst follows your map. Add nodes on the Canvas and link tasks to them first.';
      if (!cfg.y) return 'Drag a number field onto Values. Tasks counts them.';
      return null;
    }
    if (FLOW_TYPES.includes(cfg.type)) return null;
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
    if (cfg.type === 'sunburst') return (cfg.y === 'count' ? (st ? st + 'tasks' : 'Tasks') : yl) + ' across the map';
    if (cfg.type === 'kpi') return (cfg.y === 'count' ? (st ? st + 'tasks' : 'All tasks') : yl) + (cfg.kpiPeriod === 'week' ? ' this week' : '');
    const pie = cfg.type === 'pie' || cfg.type === 'donut';
    return yl + ' by ' + (DIMS[cfg.x].words || DIMS[cfg.x].label.toLowerCase()) + (cfg.series && !pie ? ' and ' + (DIMS[cfg.series].words || DIMS[cfg.series].label.toLowerCase()) : '');
  }
  const fmt = (v, unit) => (v == null ? '—' : (unit === '%' ? Math.round(v) + '%' : (Math.abs(v) >= 10 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)) + (unit === 'd' ? 'd' : '')));

  /* ---------- page ---------- */
  function render() {
    syncBoard();
    const root = el && el.querySelector('#cb-root');
    if (!root) return;
    const editing = cfg.id && board.find((b) => b.id === cfg.id);
    const y = NUMS[cfg.y];
    const pie = cfg.type === 'pie' || cfg.type === 'donut';
    root.innerHTML =
      '<div class="cb-layout">' +
      // left: fields + zones
      '<aside class="cb-side">' +
      '<div class="st-sec cb-zones">' +
      zone('x', cfg.type === 'scatter' ? 'X axis (number)' : pie ? 'Slices' : cfg.type === 'sunburst' ? 'X axis · rings follow the map' : cfg.type === 'kpi' ? 'Trend over (a date)' : FLOW_TYPES.includes(cfg.type) ? 'X axis · time' : 'X axis', cfg.type === 'sunburst' || FLOW_TYPES.includes(cfg.type)) +
      zone('y', cfg.type === 'scatter' ? 'Y axis (number)' : FLOW_TYPES.includes(cfg.type) ? 'Values · tasks' : 'Values', FLOW_TYPES.includes(cfg.type)) +
      (y && y.aggs.length > 1 && cfg.type !== 'scatter' ? '<div class="cb-agg"><span class="muted">Summarize as</span><div class="seg mini">' + y.aggs.map((a) => '<button type="button" class="seg-btn' + (cfg.agg === a ? ' on' : '') + '" data-agg="' + a + '">' + (a === 'sum' ? 'Total' : 'Average') + '</button>').join('') + '</div></div>' : '') +
      zone('series', cfg.type === 'scatter' ? 'Color by' : 'Split by', pie || cfg.type === 'sunburst' || cfg.type === 'kpi' || FLOW_TYPES.includes(cfg.type)) +
      '</div>' +
      '<div class="st-sec cb-fields"><header><h2>Fields</h2><p class="muted">Categories</p></header><div class="cb-tray">' +
      Object.keys(DIMS).filter((id) => !DIMS[id].map).map((id) => chip(id, 'tray')).join('') + '</div>' +
      (C.map && C.map.nodes().length ? '<p class="muted cb-sub">The map</p><div class="cb-tray">' + Object.keys(DIMS).filter((id) => DIMS[id].map).map((id) => chip(id, 'tray')).join('') + '</div>' : '') +
      '<p class="muted cb-sub">Numbers</p><div class="cb-tray">' + Object.keys(NUMS).map((id) => chip(id, 'tray')).join('') + '</div></div>' +
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
      (cfg.series && !pie && !['scatter', 'line', 'sunburst', 'kpi'].includes(cfg.type) ? '<label class="cb-check"><input type="checkbox" data-stack' + (cfg.stack ? ' checked' : '') + '> Stacked</label>' : '') +
      (cfg.type === 'kpi' ? sel('kpiPeriod', [['all', 'Number: all matching'], ['week', 'Number: this week']]) : '') +
      (GOAL_TYPES.includes(cfg.type) ? '<span class="cb-goal-ctl"><label class="cb-select"><span class="sr">Goal direction</span><select data-cfg="goalDir"><option value="atLeast"' + (cfg.goalDir !== 'atMost' ? ' selected' : '') + '>Goal: at least</option><option value="atMost"' + (cfg.goalDir === 'atMost' ? ' selected' : '') + '>Goal: at most</option></select>' + icon('chevD') + '</label>' +
        '<input type="number" class="cb-goal-in" data-goal inputmode="decimal" step="any" min="0" placeholder="none" aria-label="Goal value" value="' + (cfg.goal == null ? '' : esc(cfg.goal)) + '">' + (NUMS[cfg.y] && NUMS[cfg.y].unit ? '<span class="muted cb-goal-unit">' + (NUMS[cfg.y].unit === 'd' ? 'days' : '%') + '</span>' : '') + '</span>' : '') +
      '</div>' +
      extrasHtml() +
      '<div class="cb-plot">' + plot(false) + '</div>' +
      '<div class="ins-legend cb-legend">' + legendHtml() + '<span class="ins-cap" aria-live="polite"></span></div>' +
      summaryHtml() +
      '<div class="cb-actions">' +
      '<button type="button" class="btn primary sm" data-save' + (problem() ? ' disabled' : '') + '>' + icon(editing ? 'check' : 'plus') + '<span>' + (editing ? 'Update chart' : 'Save to board') + '</span></button>' +
      (editing ? '<button type="button" class="btn sm" data-save-new' + (problem() ? ' disabled' : '') + '>Save as new</button>' : '') +
      '<button type="button" class="btn sm ghost" data-reset>Start over</button></div>' +
      '</section>' +
      (cfg.type === 'sunburst' && !problem() ? '<div class="cb-heatlink"><button type="button" class="btn sm" data-heat>' + icon('canvas') + '<span>Color the canvas by this</span></button><span class="muted">Tints each node on the canvas by the same numbers.</span></div>' : '') +
      '<div class="cb-presets"><span class="muted">Try one:</span>' + PRESETS.map((p, i) => p.map && !(C.map && C.map.nodes().length) ? '' : '<button type="button" class="chip" data-preset="' + i + '">' + esc(p.name) + '</button>').join('') + '</div>' +
      '</div></div>' +
      '<a href="#board" class="cb-boardlink st-sec">' + icon('board') + '<span><b>Your board</b><span class="muted">' + (board.length ? board.length + ' saved chart' + (board.length === 1 ? '' : 's') + ' · tap a bar or slice there to see its tasks' : 'Charts you save show up on your board.') + '</span></span>' + icon('chevR') + '</a>';
    if (ui.flash) { const z = root.querySelector('[data-zone="' + ui.flashZone + '"]'); if (z) z.classList.add('nope'); }
  }

  /* compare, trend and the extra filters, under the main filter row */
  const FILTERS = [
    { key: 'type', label: 'Type', opts: () => S().state.types.map((x) => x.name) },
    { key: 'level', label: 'Importance', opts: () => S().state.levels.map((x) => x.name) },
    { key: 'cluster', label: 'Cluster', map: true, opts: () => { const c = mapCtx(); return c ? c.order.cluster : []; } },
    { key: 'branch', label: 'Branch', map: true, opts: () => { const c = mapCtx(); return c ? c.order.branch : []; } },
    { key: 'who', label: 'Person', opts: () => { const set = new Set(['Me']); S().state.tasks.forEach((t) => set.add(doer(t))); return [...set]; } }
  ];
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
        return '<label class="cb-select"><span class="sr">' + x.label + '</span><select data-filter="' + x.key + '"><option value="">Any ' + x.label.toLowerCase() + '</option>' +
          (cur && !o.includes(cur) ? '<option selected>' + esc(cur) + '</option>' : '') + o.map((v) => '<option' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>').join('') + '</select>' + icon('chevD') + '</label>';
      }).join('') + (n ? '<button type="button" class="btn sm ghost" data-filters-clear>Clear filters</button>' : '') + '</div>';
    }
    return h;
  }

  /* ---------- the one-sentence summary under each chart ---------- */
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  function summaryText() {
    if (problem()) return '';
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
    const f = field(id);
    const picked = where === 'tray' && ui.picked === id;
    return '<button type="button" class="cb-chip ' + (isNum(id) ? 'num' : 'dim') + (picked ? ' picked' : '') + '" data-field="' + id + '" data-from="' + where + '" aria-pressed="' + picked + '">' +
      icon(f.ic) + '<span>' + esc(f.label) + '</span>' + (where !== 'tray' ? '<span class="cb-x" data-clear="' + where + '" aria-label="Remove ' + esc(f.label) + '">' + icon('x') + '</span>' : '') + '</button>';
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
    if (cfg.type === 'kpi') return '';
    if (cfg.type === 'sunburst') { const sb = sunData(); return sb ? sb.legend.map((c) => '<span><i class="lg-bar" style="--c:' + c.hex + '"></i>' + esc(c.name) + '</span>').join('') + (sb.off ? '<span class="muted">' + sb.off + ' not on the map</span>' : '') : ''; }
    const b = build();
    if (cfg.type === 'scatter') return cfg.series ? b.keys.map((k) => '<span><i class="lg-bar" style="--c:' + b.colors[k] + '"></i>' + esc(k) + '</span>').join('') : '';
    if (cfg.type === 'pie' || cfg.type === 'donut' || b.colorByCat) return b.cats.slice(0, 12).map((c) => '<span><i class="lg-bar" style="--c:' + c.color + '"></i>' + esc(c.label) + '</span>').join('');
    return (b.series.length > 1 ? b.series.map((s) => '<span><i class="lg-bar" style="--c:' + s.color + '"></i>' + esc(s.label) + '</span>').join('') : '') +
      (b.prev ? '<span><i class="lg-ghost"></i>Previous ' + RANGE_WORDS[curRange()] + '</span>' : '') +
      (b.trend ? '<span><i class="lg-trend"></i>' + (cfg.trend === 'avg' ? 'Rolling average' : 'Trend') + '</span>' : '') + goalNote(b);
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
    const b = build();
    if (!b.n) return '<div class="cb-empty"><p>' + noneMsg() + '</p></div>';
    if (cfg.type === 'burnup') return xy(b, W, H, mini, { as: 'line', stacked: false });
    if (cfg.type === 'cfd') return xy(b, W, H, mini, { as: 'area', stacked: true });
    if (cfg.type === 'scatter') return scatter(b, W, H, mini);
    if (!b.cats.length) return '<div class="cb-empty"><p>No values to show with these fields and filters.</p></div>';
    if (cfg.type === 'pie' || cfg.type === 'donut') return pie(b, W, H, mini);
    if (cfg.type === 'bar') return barH(b, W, H, mini);
    return xy(b, W, H, mini);
  }
  const noneMsg = () => (S().state.tasks.length && S().state.tasks.every((t) => t.sample) ? 'Charts leave out the example tasks. Add your own tasks, or choose “Keep them” on the Tasks page to count the examples.' : 'No tasks match these filters.');
  const svgOpen = (W, H, label) => '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="' + esc(label) + '">';
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
  function gridY(L, R, W, y, lo, hi, unit, steps) {
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
    let s = svgOpen(W, H, autoTitle()) + gridY(L, R, W, y, lo, hi, unit, mini ? 2 : 4);
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
          s += '<rect class="cb-bar' + missCls(v, i) + '" x="' + x.toFixed(1) + '" y="' + y(top).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, y(bot) - y(top)).toFixed(1) + '" rx="' + Math.min(4, w / 4) + '" style="--c:' + col + '" tabindex="0" data-seg="' + i + ':' + j + '"' + tip(valTip(c.label, ser.label, v, multi)) + '/>';
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
    for (let i = 0; i <= 4; i++) { const v = lo + ((hi - lo) / 4) * i; s += '<line y1="' + T + '" y2="' + (H - B) + '" x1="' + x(v) + '" x2="' + x(v) + '" class="grid"/><text y="' + (H - 8) + '" x="' + x(v) + '" class="ax" text-anchor="middle">' + fmt(v, unit) + '</text>'; }
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
        s += '<rect class="cb-bar' + (hasGoal() ? ((stacked ? meets(b.series.reduce((q, s2) => q + (s2.values[i] || 0), 0)) : meets(v)) ? ' hit-goal' : ' miss') : '') + '" y="' + yy2.toFixed(1) + '" x="' + x(a).toFixed(1) + '" height="' + h.toFixed(1) + '" width="' + Math.max(1, x(z) - x(a)).toFixed(1) + '" rx="' + Math.min(4, h / 4) + '" style="--c:' + col + '" tabindex="0" data-seg="' + i + ':' + j + '"' + tip(valTip(c.label, ser.label, v, multi)) + '/>';
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
      s += '<path d="' + d + '" class="cb-slice" fill-rule="evenodd" style="--c:' + c.color + '" tabindex="0" data-seg="' + i + ':0"' + tip(label) + '/>';
      if (frac > 0.07 && !mini) {
        const mid = (a0 + a1) / 2, lr = ir ? (r + ir) / 2 : r * 0.62;
        s += '<text x="' + (cx + lr * Math.cos(mid)) + '" y="' + (cy + lr * Math.sin(mid) + 4) + '" class="cb-slice-lab" text-anchor="middle">' + Math.round(frac * 100) + '%</text>';
      }
      a0 = a1;
    });
    if (ir) s += '<text x="' + cx + '" y="' + (cy - 2) + '" class="cb-donut-num" text-anchor="middle">' + fmt(total, NUMS[cfg.y].unit === '%' ? '' : NUMS[cfg.y].unit) + '</text><text x="' + cx + '" y="' + (cy + 18) + '" class="ax" text-anchor="middle">' + (cfg.y === 'count' ? 'tasks' : 'total') + '</text>';
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
    if (!z) { if (from && from !== 'tray') setCfg({ [from]: null }); return; }
    if (z === 'y' && !isNum(fid)) return nope(z, 'Values need a number field, like Tasks or Days late.');
    if (z === 'series' && isNum(fid)) return nope(z, 'Split by needs a category field, like Status or Type.');
    const patch = { [z]: fid };
    if (from && from !== 'tray' && from !== z) {
      patch[from] = cfg[z] && (from === 'y' ? isNum(cfg[z]) : !isNum(cfg[z])) ? cfg[z] : null; // swap when it fits, otherwise clear
      if (from === 'y' && !patch.y) patch.y = 'count';
    }
    if (z === 'x' && isNum(fid) && cfg.type !== 'scatter' && cfg.type !== 'kpi') { patch.type = 'scatter'; if (cfg.y === 'count') patch.y = null; C.toast('Switched to a scatter plot to show ' + field(fid).label + ' as numbers.'); }
    if (z === 'x' && !isNum(fid) && cfg.type === 'scatter') patch.type = 'column';
    if (z === 'y' && NUMS[fid]) { patch.agg = NUMS[fid].aggs[0]; if (cfg.goal == null) patch.goalDir = LOWER_IS_BETTER.includes(fid) ? 'atMost' : 'atLeast'; }
    if (z === 'x' && cfg.type === 'kpi' && !(DIMS[fid] && DIMS[fid].time)) return nope(z, 'A KPI trend needs a date field, like Completed or Created.');
    if (FLOW_TYPES.includes(cfg.type) && z !== 'y') return nope(z, 'This chart always runs over time and splits tasks by status, so it doesn’t use this.');
    if (FLOW_TYPES.includes(cfg.type) && z === 'y') return nope(z, 'This chart counts tasks.');
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
    if (!c || e.target.closest('[data-clear]')) return;
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
    if (swallowClick) { e.preventDefault(); e.stopPropagation(); return; }
    const t = e.target;
    const clr = t.closest('[data-clear]');
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
      if (FLOW_TYPES.includes(type)) patch.y = 'count';
      if ((cfg.type === 'kpi' || cfg.type === 'sunburst' || FLOW_TYPES.includes(cfg.type)) && type !== 'kpi' && type !== 'sunburst' && !FLOW_TYPES.includes(type) && type !== 'scatter' && !cfg.x) patch.x = 'type';
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
      if (asNew) { item.id = C.uid('ch'); board = board.concat([item]); } else board = board.map((b) => (b.id === item.id ? item : b));
      saveBoard();
      setCfg({ id: item.id, title: item.title });
      C.toast(asNew ? 'Saved to your board' : 'Chart updated', { action: 'View board', onAction: () => C.go('board') });
      return;
    }
    // tapping anywhere else cancels a picked field
    if (ui.picked && !t.closest('.cb-fields')) { ui.picked = null; render(); }
  }
  /* ================= Board page ================= */
  let elB = null;
  const withCfg = (item, fn) => { const saved = cfg, ro = rangeOverride; cfg = Object.assign({}, BLANK, item); rangeOverride = boardRange(); try { return fn(); } finally { cfg = saved; rangeOverride = ro; } };
  const BOARD_RANGE = 'cadence.board.range';
  const boardRange = () => { const v = load(BOARD_RANGE, ''); return v && v !== 'own' ? v : null; };

  const boardView = C.views.board = {
    title: 'Board',
    mount(root) {
      elB = root;
      syncBoard();
      root.innerHTML = '<section class="page bd-page"><header class="page-head"><p class="eyebrow"><a href="#insights" class="cb-back">' + icon('chevL') + 'Insights</a></p>' +
        '<div class="bd-title"><h1 class="display">Board</h1><div class="bd-acts"><label class="cb-select"><span class="sr">Dates for every chart</span><select id="bd-range">' +
        [['own', 'Dates: each chart’s own'], ['4w', 'Every chart: last 4 weeks'], ['12w', 'Every chart: last 12 weeks'], ['6m', 'Every chart: last 6 months'], ['1y', 'Every chart: last year'], ['all', 'Every chart: all time']].map(([v, l]) => '<option value="' + v + '"' + ((boardRange() || 'own') === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' + icon('chevD') + '</label>' +
        '<a href="#charts" class="btn primary sm">' + icon('plus') + '<span>New chart</span></a></div></div>' +
        '<p class="muted cb-lede">Tap any bar, slice, point or dot to see the tasks behind it.</p></header><div id="bd-root"></div></section>';
      root.addEventListener('click', onBoardClick);
      root.addEventListener('change', (e) => { if (e.target.id === 'bd-range') { keep(BOARD_RANGE, e.target.value); renderBoard(); } });
      root.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') boardTip(e.target); });
      root.addEventListener('focusin', (e) => boardTip(e.target));
      root.addEventListener('keydown', (e) => { const n = e.target.closest('[data-seg]'); if (n && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); n.dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
      renderBoard();
    },
    update() { if (elB) renderBoard(); },
    unmount() { elB = null; closeRecords(); }
  };

  function renderBoard() {
    const root = elB && elB.querySelector('#bd-root');
    if (!root) return;
    syncBoard();
    if (!board.length) {
      root.innerHTML = '<div class="st-sec bd-empty">' + icon('board') + '<h2>Your board is empty</h2><p class="muted">Build a chart in the Chart builder and choose <b>Save to board</b>. It will show up here.</p><a href="#charts" class="btn primary">' + icon('pie') + '<span>Open Chart builder</span></a></div>';
      return;
    }
    const narrow = matchMedia('(max-width: 640px)').matches;
    const size = narrow ? { W: 360, H: 260 } : { W: 560, H: 320 };
    const kpis = board.filter((it) => it.type === 'kpi'), charts = board.filter((it) => it.type !== 'kpi');
    const btns = (item) => '<div class="cb-card-btns"><button type="button" class="icon-btn sm" data-edit="' + item.id + '" aria-label="Edit chart" title="Edit in Chart builder">' + icon('settings') + '</button>' +
      '<button type="button" class="icon-btn sm" data-del="' + item.id + '" aria-label="Remove chart" title="Remove">' + icon('trash') + '</button></div>';
    root.innerHTML = (kpis.length ? '<div class="bd-kpis">' + kpis.map((item) => withCfg(item, () =>
      '<article class="st-sec bd-card bd-kpi" data-card="' + item.id + '"><header class="cb-card-head"><h2>' + esc(item.title || autoTitle()) + '</h2>' + btns(item) + '</header>' + plot(false, { W: 240, H: 120, kpi: true }) + '</article>')).join('') + '</div>' : '') +
      (charts.length ? '<div class="bd-grid">' + charts.map((item) => withCfg(item, () =>
      '<article class="st-sec bd-card" data-card="' + item.id + '">' +
      '<header class="cb-card-head"><h2>' + esc(item.title || autoTitle()) + '</h2>' +
      '<div class="cb-card-btns"><button type="button" class="icon-btn sm" data-edit="' + item.id + '" aria-label="Edit chart" title="Edit in Chart builder">' + icon('settings') + '</button>' +
      '<button type="button" class="icon-btn sm" data-del="' + item.id + '" aria-label="Remove chart" title="Remove">' + icon('trash') + '</button></div></header>' +
      '<p class="bd-filters muted">' + esc(filterText()) + '</p>' +
      '<div class="cb-plot bd-plot">' + plot(false, size) + '</div>' +
      '<div class="ins-legend cb-legend">' + legendHtml() + '<span class="ins-cap" aria-live="polite"></span></div>' +
      summaryHtml() +
      '</article>')).join('') + '</div>' : '');
  }
  function filterText() {
    const st = { all: 'All tasks', open: 'Open tasks', overdue: 'Overdue tasks', done: 'Done tasks' }[cfg.status] || 'All tasks';
    const rg = { all: 'all time', '4w': 'last 4 weeks', '12w': 'last 12 weeks', '6m': 'last 6 months', '1y': 'last year' }[curRange()] || 'all time';
    const f = flt(), extra = FILTERS.filter((x) => f[x.key]).map((x) => x.label + ': ' + f[x.key]);
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
    const t = e.target;
    syncBoard();
    const seg = t.closest('[data-seg]');
    if (seg) { const card = seg.closest('[data-card]'); return openRecords(card.dataset.card, seg.dataset.seg, seg.dataset.tip); }
    const ed = t.closest('[data-edit]');
    if (ed) {
      const item = board.find((b) => b.id === ed.dataset.edit);
      if (item) { Object.assign(cfg, BLANK, item); keep(LS_DRAFT, cfg); C.go('charts'); }
      return;
    }
    const del = t.closest('[data-del]');
    if (del) {
      const idx = board.findIndex((b) => b.id === del.dataset.del); if (idx < 0) return;
      const gone = board[idx];
      board = board.filter((b) => b.id !== gone.id); saveBoard();
      if (cfg.id === gone.id) { cfg.id = null; keep(LS_DRAFT, cfg); }
      renderBoard();
      C.toast('Removed “' + (gone.title || 'chart') + '”', { action: 'Undo', onAction: () => { syncBoard(); if (!board.some((b) => b.id === gone.id)) { board = board.slice(); board.splice(Math.min(idx, board.length), 0, gone); saveBoard(); } } });
    }
  }

  /* ---------- records modal ---------- */
  let modal = null;
  function recordsFor(item, seg) {
    return withCfg(item, () => {
      if (seg === 'all' && cfg.type === 'kpi') { const k = kpiData(); return { title: item.title || autoTitle(), label: fmt(k.value, k.unit) + ' · ' + (item.title || autoTitle()), color: 'var(--accent)', tasks: k.tasks }; }
      if (seg[0] === 'n' && cfg.type === 'sunburst') {
        const sb = sunData(); if (!sb) return null;
        const nd = seg === 'nall' ? sb.center : sb.find(seg.slice(1));
        if (!nd) return null;
        return { title: item.title || autoTitle(), label: seg === 'nall' ? 'Whole map' : nd.title, color: nd.hex, tasks: nd.all };
      }
      const b = build();
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
    const tasks = r.tasks.slice().sort((a, b) => (a.done - b.done) || ((a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : S().levelRank(a.levelId) - S().levelRank(b.levelId)));
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
    if (t.dataset.cfg) return setCfg({ [t.dataset.cfg]: t.value });
    if (t.hasAttribute('data-compare')) return setCfg({ compare: t.checked });
    if (t.dataset.filter) { const f = Object.assign({}, flt(), { [t.dataset.filter]: t.value || null }); Object.keys(f).forEach((k) => { if (!f[k]) delete f[k]; }); return setCfg({ f: Object.keys(f).length ? f : null }); }
    if (t.hasAttribute('data-goal')) { const v = t.value.trim(); return setCfg({ goal: v === '' || !isFinite(+v) ? null : +v }); }
    if (t.hasAttribute('data-stack')) return setCfg({ stack: t.checked });
    if (t.id === 'cb-title') { cfg.title = t.value.trim(); keep(LS_DRAFT, cfg); }
  }
})();
