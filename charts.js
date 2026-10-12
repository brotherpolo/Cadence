/* Cadence — Chart builder + Board: drag fields onto X axis / Values / Split by and pick a chart type.
   Works with mouse, pen and touch. On touch you can also tap a field, then tap where it goes.
   Saved charts live on a board in this browser (localStorage), not in the cloud. */
(function () {
  const C = window.Cadence;
  const { D, esc, icon } = C;
  const S = () => C.store;
  const LS_DRAFT = 'cadence.chart.draft', LS_BOARD = 'cadence.chart.board';
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
    ['scatter', 'Scatter', '<circle cx="7" cy="16" r="1.6"/><circle cx="10" cy="10" r="1.6"/><circle cx="14.5" cy="13" r="1.6"/><circle cx="17" cy="7" r="1.6"/><circle cx="18.5" cy="15.5" r="1.6"/><path d="M3.5 3.5v17h17"/>']
  ];
  const typeSvg = (p) => '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';

  const PRESETS = [
    { name: 'Open tasks by type', cfg: { type: 'donut', x: 'type', y: 'count', series: null, status: 'open' } },
    { name: 'Completed per week', cfg: { type: 'column', x: 'completed', y: 'count', series: null, status: 'done', range: '12w' } },
    { name: 'Status by importance', cfg: { type: 'bar', x: 'level', y: 'count', series: 'status', stack: true } },
    { name: 'On-time rate by type', cfg: { type: 'column', x: 'type', y: 'onTime', status: 'done' } },
    { name: 'Effort vs. speed', cfg: { type: 'scatter', x: 'steps', y: 'toDone', series: 'type', status: 'done' } }
  ];
  const BLANK = { type: 'column', x: null, y: 'count', agg: 'count', series: null, stack: true, status: 'all', range: 'all', grain: 'auto', title: '' };

  /* ---------- state ---------- */
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } };
  let cfg = Object.assign({}, BLANK, load(LS_DRAFT, { x: 'type', series: 'status' }));
  let board = load(LS_BOARD, []);
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
  function rows() {
    const tk = D.todayKey(), now = Date.now();
    const ctx = { tk, now };
    let list = S().state.tasks.filter((t) => !t.sample);
    if (cfg.status === 'open') list = list.filter((t) => !t.done);
    else if (cfg.status === 'done') list = list.filter((t) => t.done);
    if (cfg.range !== 'all') {
      const days = { '4w': 28, '12w': 84, '6m': 183, '1y': 365 }[cfg.range] || 0;
      const from = now - days * DAY;
      list = list.filter((t) => (t.doneAt && t.doneAt >= from) || (t.createdAt && t.createdAt >= from) || (t.due && t.due >= D.key(new Date(from)) && t.due <= tk));
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
    if (xd.time) {
      if (grain === 'auto') {
        const ks = raw.map((r) => r.x).sort();
        grain = ks.length && D.diff(ks[ks.length - 1], ks[0]) > 120 ? 'month' : 'week';
      }
      raw.forEach((r) => (r.x = timeBucket(r.x, grain)));
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
    return { cats, series, grain, n: list.length, colorByCat: !sd && !xd.time && !!xd.color, raw };
  }
  function orderKeys(d, keys) {
    if (!d.order) return keys.sort((a, b) => String(a).localeCompare(String(b)));
    const o = d.order();
    return keys.sort((a, b) => (o.indexOf(a) < 0 ? 99 : o.indexOf(a)) - (o.indexOf(b) < 0 ? 99 : o.indexOf(b)) || String(a).localeCompare(String(b)));
  }
  function colorFor(d, k, i) { return (d && d.color && d.color(k)) || PALETTE[i % PALETTE.length]; }

  /* ---------- validity & titles ---------- */
  function problem() {
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
    const pie = cfg.type === 'pie' || cfg.type === 'donut';
    return yl + ' by ' + (DIMS[cfg.x].words || DIMS[cfg.x].label.toLowerCase()) + (cfg.series && !pie ? ' and ' + (DIMS[cfg.series].words || DIMS[cfg.series].label.toLowerCase()) : '');
  }
  const fmt = (v, unit) => (v == null ? '—' : (unit === '%' ? Math.round(v) + '%' : (Math.abs(v) >= 10 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)) + (unit === 'd' ? 'd' : '')));

  /* ---------- page ---------- */
  function render() {
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
      zone('x', cfg.type === 'scatter' ? 'X axis (number)' : pie ? 'Slices' : 'X axis') +
      zone('y', cfg.type === 'scatter' ? 'Y axis (number)' : 'Values') +
      (y && y.aggs.length > 1 && cfg.type !== 'scatter' ? '<div class="cb-agg"><span class="muted">Summarize as</span><div class="seg mini">' + y.aggs.map((a) => '<button type="button" class="seg-btn' + (cfg.agg === a ? ' on' : '') + '" data-agg="' + a + '">' + (a === 'sum' ? 'Total' : 'Average') + '</button>').join('') + '</div></div>' : '') +
      zone('series', cfg.type === 'scatter' ? 'Color by' : pie ? 'Split by (not used in pies)' : 'Split by', pie) +
      '</div>' +
      '<div class="st-sec cb-fields"><header><h2>Fields</h2><p class="muted">Categories</p></header><div class="cb-tray">' +
      Object.keys(DIMS).map((id) => chip(id, 'tray')).join('') + '</div>' +
      '<p class="muted cb-sub">Numbers</p><div class="cb-tray">' + Object.keys(NUMS).map((id) => chip(id, 'tray')).join('') + '</div></div>' +
      '</aside>' +
      // right: chart
      '<div class="cb-main">' +
      '<div class="cb-types" role="radiogroup" aria-label="Chart type">' + TYPES.map(([id, label, p]) => '<button type="button" role="radio" class="cb-type' + (cfg.type === id ? ' on' : '') + '" data-ctype="' + id + '" aria-checked="' + (cfg.type === id) + '">' + typeSvg(p) + '<span>' + label + '</span></button>').join('') + '</div>' +
      '<section class="st-sec cb-canvas' + (ui.picked ? ' picking' : '') + '">' +
      '<div class="cb-head"><textarea class="cb-title" id="cb-title" rows="' + (matchMedia('(max-width: 640px)').matches && (cfg.title || autoTitle()).length > 24 ? 2 : 1) + '" placeholder="' + esc(autoTitle()) + '" aria-label="Chart title" spellcheck="false">' + esc(cfg.title) + '</textarea></div>' +
      '<div class="cb-filters">' +
      sel('status', [['all', 'All tasks'], ['open', 'Open only'], ['done', 'Done only']]) +
      sel('range', [['all', 'All time'], ['4w', 'Last 4 weeks'], ['12w', 'Last 12 weeks'], ['6m', 'Last 6 months'], ['1y', 'Last year']]) +
      (cfg.x && DIMS[cfg.x] && DIMS[cfg.x].time && cfg.type !== 'scatter' ? sel('grain', [['auto', 'Auto'], ['week', 'By week'], ['month', 'By month']]) : '') +
      (cfg.series && !pie && cfg.type !== 'scatter' && cfg.type !== 'line' ? '<label class="cb-check"><input type="checkbox" data-stack' + (cfg.stack ? ' checked' : '') + '> Stacked</label>' : '') +
      '</div>' +
      '<div class="cb-plot">' + plot(false) + '</div>' +
      '<div class="ins-legend cb-legend">' + legendHtml() + '<span class="ins-cap" aria-live="polite"></span></div>' +
      '<div class="cb-actions">' +
      '<button type="button" class="btn primary sm" data-save' + (problem() ? ' disabled' : '') + '>' + icon(editing ? 'check' : 'plus') + '<span>' + (editing ? 'Update chart' : 'Save to board') + '</span></button>' +
      (editing ? '<button type="button" class="btn sm" data-save-new' + (problem() ? ' disabled' : '') + '>Save as new</button>' : '') +
      '<button type="button" class="btn sm ghost" data-reset>Start over</button></div>' +
      '</section>' +
      '<div class="cb-presets"><span class="muted">Try one:</span>' + PRESETS.map((p, i) => '<button type="button" class="chip" data-preset="' + i + '">' + esc(p.name) + '</button>').join('') + '</div>' +
      '</div></div>' +
      '<a href="#board" class="cb-boardlink st-sec">' + icon('board') + '<span><b>Your board</b><span class="muted">' + (board.length ? board.length + ' saved chart' + (board.length === 1 ? '' : 's') + ' · tap a bar or slice there to see its tasks' : 'Charts you save show up on your board.') + '</span></span>' + icon('chevR') + '</a>';
    if (ui.flash) { const z = root.querySelector('[data-zone="' + ui.flashZone + '"]'); if (z) z.classList.add('nope'); }
  }

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
      (id ? chip(id, z) : '<span class="cb-zone-empty">' + (ui.picked ? 'Tap to place here' : 'Drop a field here') + '</span>') +
      (ui.flash && ui.flashZone === z ? '<span class="cb-zone-msg" role="alert">' + esc(ui.flash) + '</span>' : '') + '</div>';
  }
  function sel(key, opts) {
    return '<label class="cb-select"><span class="sr">' + key + '</span><select data-cfg="' + key + '">' + opts.map(([v, l]) => '<option value="' + v + '"' + (cfg[key] === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' + icon('chevD') + '</label>';
  }
  function legendHtml() {
    if (problem()) return '';
    const b = build();
    if (cfg.type === 'scatter') return cfg.series ? b.keys.map((k) => '<span><i class="lg-bar" style="--c:' + b.colors[k] + '"></i>' + esc(k) + '</span>').join('') : '';
    if (cfg.type === 'pie' || cfg.type === 'donut' || b.colorByCat) return b.cats.slice(0, 12).map((c) => '<span><i class="lg-bar" style="--c:' + c.color + '"></i>' + esc(c.label) + '</span>').join('');
    return b.series.length > 1 ? b.series.map((s) => '<span><i class="lg-bar" style="--c:' + s.color + '"></i>' + esc(s.label) + '</span>').join('') : '';
  }
  /* ---------- drawing ---------- */
  const tip = (s) => ' data-tip="' + esc(s) + '"';
  function plot(mini, size) {
    const p = problem();
    if (p) return '<div class="cb-empty">' + typeSvg(TYPES.find((t) => t[0] === cfg.type)[2]) + '<p>' + esc(p) + '</p></div>';
    const b = build();
    if (!b.n) return '<div class="cb-empty"><p>No tasks match these filters.</p></div>';
    const narrow = !mini && matchMedia('(max-width: 640px)').matches;
    const W = size ? size.W : mini ? 420 : narrow ? 360 : 680, H = size ? size.H : mini ? 240 : narrow ? 280 : 360;
    if (cfg.type === 'scatter') return scatter(b, W, H, mini);
    if (!b.cats.length) return '<div class="cb-empty"><p>No values to show with these fields and filters.</p></div>';
    if (cfg.type === 'pie' || cfg.type === 'donut') return pie(b, W, H, mini);
    if (cfg.type === 'bar') return barH(b, W, H, mini);
    return xy(b, W, H, mini);
  }
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
    return { lo: lo < 0 ? -niceMax(-lo) : 0, hi: niceMax(hi) };
  }
  function gridY(L, R, W, y, lo, hi, unit, steps) {
    let g = '';
    for (let i = 0; i <= steps; i++) {
      const v = lo + ((hi - lo) / steps) * i;
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="grid' + (v === 0 && lo < 0 ? ' zero' : '') + '"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" class="ax" text-anchor="end">' + fmt(v, unit) + '</text>';
    }
    return g;
  }
  const valTip = (cat, s, v, multi) => cat + (multi ? ' · ' + s : '') + ': ' + fmt(v, NUMS[cfg.y].unit) + (cfg.y === 'count' ? (v === 1 ? ' task' : ' tasks') : '');

  // a full-height hit area per category, so thin bars are still easy to tap (opens every task in that category)
  const catTotal = (b, i) => { const n = b.raw.filter((r) => r.x === b.cats[i].key).length; return b.cats[i].label + ': ' + n + (n === 1 ? ' task' : ' tasks'); };
  /* columns, lines, areas */
  function xy(b, W, H, mini) {
    const unit = NUMS[cfg.y].unit, multi = b.series.length > 1;
    const stacked = multi && cfg.stack && cfg.type !== 'line';
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
    if (cfg.type === 'column') {
      const groupW = Math.min(cw * 0.78, multi && !stacked ? 18 * b.series.length + 10 : 48);
      b.cats.forEach((c, i) => {
        const x0 = L + cw * i + (cw - groupW) / 2;
        s += '<rect class="hit" x="' + (L + cw * i).toFixed(1) + '" y="' + T + '" width="' + cw.toFixed(1) + '" height="' + (H - T - B) + '" data-seg="' + i + ':*"' + tip(catTotal(b, i)) + '/>';
        let pos = 0, neg = 0;
        b.series.forEach((ser, j) => {
          const v = ser.values[i]; if (v == null || v === 0) return;
          const col = b.colorByCat ? c.color : ser.color;
          let top, bot, x, w;
          if (stacked) { if (v >= 0) { bot = pos; pos += v; top = pos; } else { top = neg; neg += v; bot = neg; } x = x0; w = groupW; }
          else { top = Math.max(v, 0); bot = Math.min(v, 0); w = groupW / b.series.length; x = x0 + w * j; w = Math.max(2, w - (multi ? 2 : 0)); }
          s += '<rect class="cb-bar" x="' + x.toFixed(1) + '" y="' + y(top).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, y(bot) - y(top)).toFixed(1) + '" rx="' + Math.min(4, w / 4) + '" style="--c:' + col + '" tabindex="0" data-seg="' + i + ':' + j + '"' + tip(valTip(c.label, ser.label, v, multi)) + '/>';
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
      (cfg.type === 'area' ? layers.slice().reverse() : layers).forEach(({ ser, pts }) => {
        const segs = []; let cur = [];
        pts.forEach((p) => { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } });
        if (cur.length) segs.push(cur);
        segs.forEach((sg) => {
          const line = sg.map((p) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
          if (cfg.type === 'area') {
            const back = sg.slice().reverse().map((p) => p.x.toFixed(1) + ',' + (stacked ? p.y0 : y(Math.max(lo, 0))).toFixed(1)).join(' ');
            s += '<polygon points="' + line + ' ' + back + '" class="cb-area" style="--c:' + ser.color + '"/>';
          }
          s += '<polyline points="' + line + '" class="cb-line" style="--c:' + ser.color + '"/>';
        });
      });
      layers.forEach(({ ser, pts }, j) => pts.forEach((p) => {
        if (!p) return;
        s += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (n > 30 ? 2.5 : 4) + '" class="cb-dot" style="--c:' + ser.color + '" tabindex="0" data-seg="' + p.i + ':' + j + '"' + tip(valTip(b.cats[p.i].label, ser.label, ser.values[p.i], multi)) + '/>';
      }));
    }
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
      let pos = 0, neg = 0, total = 0;
      b.series.forEach((ser, j) => {
        const v = ser.values[i]; if (v == null || v === 0) return;
        total += v;
        const col = b.colorByCat ? c.color : ser.color;
        let a, z, yy2 = yy, h = bh;
        if (stacked) { if (v >= 0) { a = pos; pos += v; z = pos; } else { z = neg; neg += v; a = neg; } }
        else { a = Math.min(v, 0); z = Math.max(v, 0); h = bh / b.series.length; yy2 = yy + h * j; h = Math.max(2, h - (multi ? 1.5 : 0)); }
        s += '<rect class="cb-bar" y="' + yy2.toFixed(1) + '" x="' + x(a).toFixed(1) + '" height="' + h.toFixed(1) + '" width="' + Math.max(1, x(z) - x(a)).toFixed(1) + '" rx="' + Math.min(4, h / 4) + '" style="--c:' + col + '" tabindex="0" data-seg="' + i + ':' + j + '"' + tip(valTip(c.label, ser.label, v, multi)) + '/>';
      });
      if (!multi || stacked) { const v = stacked ? total : b.series[0].values[i]; if (v != null) s += '<text x="' + (x(Math.max(stacked ? pos : v, 0)) + 5) + '" y="' + (yy + bh / 2 + 4) + '" class="ax val">' + fmt(v, unit) + '</text>'; }
    });
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
    if (z === 'x' && isNum(fid) && cfg.type !== 'scatter') { patch.type = 'scatter'; if (cfg.y === 'count') patch.y = null; C.toast('Switched to a scatter plot to show ' + field(fid).label + ' as numbers.'); }
    if (z === 'x' && !isNum(fid) && cfg.type === 'scatter') patch.type = 'column';
    if (z === 'y' && NUMS[fid]) patch.agg = NUMS[fid].aggs[0];
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
      if (type !== 'scatter' && cfg.type === 'scatter') { patch.x = cfg.series || 'type'; patch.series = null; }
      return C.withTransition(() => setCfg(patch));
    }
    const ag = t.closest('[data-agg]'); if (ag) return setCfg({ agg: ag.dataset.agg });
    const pr = t.closest('[data-preset]');
    if (pr) { const p = PRESETS[+pr.dataset.preset]; ui.picked = null; return C.withTransition(() => setCfg(Object.assign({}, BLANK, p.cfg, { title: '', id: null }))); }
    if (t.closest('[data-reset]')) { ui.picked = null; return setCfg(Object.assign({}, BLANK, { id: null })); }
    if (t.closest('[data-save]') || t.closest('[data-save-new]')) {
      const asNew = !!t.closest('[data-save-new]') || !cfg.id || !board.some((b) => b.id === cfg.id);
      const titleIn = el.querySelector('#cb-title');
      const item = Object.assign({}, cfg, { title: titleIn ? titleIn.value.trim() : cfg.title });
      if (asNew) { item.id = C.uid('ch'); board.push(item); } else board = board.map((b) => (b.id === item.id ? item : b));
      keep(LS_BOARD, board);
      setCfg({ id: item.id, title: item.title });
      C.toast(asNew ? 'Saved to your board' : 'Chart updated', { action: 'View board', onAction: () => C.go('board') });
      return;
    }
    // tapping anywhere else cancels a picked field
    if (ui.picked && !t.closest('.cb-fields')) { ui.picked = null; render(); }
  }
  /* ================= Board page ================= */
  let elB = null;
  const withCfg = (item, fn) => { const saved = cfg; cfg = Object.assign({}, BLANK, item); try { return fn(); } finally { cfg = saved; } };

  const boardView = C.views.board = {
    title: 'Board',
    mount(root) {
      elB = root;
      board = load(LS_BOARD, []);
      root.innerHTML = '<section class="page bd-page"><header class="page-head"><p class="eyebrow"><a href="#insights" class="cb-back">' + icon('chevL') + 'Insights</a></p>' +
        '<div class="bd-title"><h1 class="display">Board</h1><a href="#charts" class="btn primary sm">' + icon('plus') + '<span>New chart</span></a></div>' +
        '<p class="muted cb-lede">Tap any bar, slice, point or dot to see the tasks behind it.</p></header><div id="bd-root"></div></section>';
      root.addEventListener('click', onBoardClick);
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
    if (!board.length) {
      root.innerHTML = '<div class="st-sec bd-empty">' + icon('board') + '<h2>Your board is empty</h2><p class="muted">Build a chart in the Chart builder and choose <b>Save to board</b>. It will show up here.</p><a href="#charts" class="btn primary">' + icon('pie') + '<span>Open Chart builder</span></a></div>';
      return;
    }
    const narrow = matchMedia('(max-width: 640px)').matches;
    const size = narrow ? { W: 360, H: 260 } : { W: 560, H: 320 };
    root.innerHTML = '<div class="bd-grid">' + board.map((item) => withCfg(item, () =>
      '<article class="st-sec bd-card" data-card="' + item.id + '">' +
      '<header class="cb-card-head"><h2>' + esc(item.title || autoTitle()) + '</h2>' +
      '<div class="cb-card-btns"><button type="button" class="icon-btn sm" data-edit="' + item.id + '" aria-label="Edit chart" title="Edit in Chart builder">' + icon('settings') + '</button>' +
      '<button type="button" class="icon-btn sm" data-del="' + item.id + '" aria-label="Remove chart" title="Remove">' + icon('trash') + '</button></div></header>' +
      '<p class="bd-filters muted">' + esc(filterText()) + '</p>' +
      '<div class="cb-plot bd-plot">' + plot(false, size) + '</div>' +
      '<div class="ins-legend cb-legend">' + legendHtml() + '<span class="ins-cap" aria-live="polite"></span></div>' +
      '</article>')).join('') + '</div>';
  }
  function filterText() {
    const st = { all: 'All tasks', open: 'Open tasks', done: 'Done tasks' }[cfg.status] || 'All tasks';
    const rg = { all: 'all time', '4w': 'last 4 weeks', '12w': 'last 12 weeks', '6m': 'last 6 months', '1y': 'last year' }[cfg.range] || 'all time';
    return st + ' · ' + rg;
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
      const [gone] = board.splice(idx, 1); keep(LS_BOARD, board);
      if (cfg.id === gone.id) { cfg.id = null; keep(LS_DRAFT, cfg); }
      renderBoard();
      C.toast('Removed “' + (gone.title || 'chart') + '”', { action: 'Undo', onAction: () => { board.splice(idx, 0, gone); keep(LS_BOARD, board); renderBoard(); } });
    }
  }

  /* ---------- records modal ---------- */
  let modal = null;
  function recordsFor(item, seg) {
    return withCfg(item, () => {
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
    if (t.hasAttribute('data-stack')) return setCfg({ stack: t.checked });
    if (t.id === 'cb-title') { cfg.title = t.value.trim(); keep(LS_DRAFT, cfg); }
  }
})();
