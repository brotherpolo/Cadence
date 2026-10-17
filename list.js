/* Cadence — Tasks page: quick add, inventory summary, filters, agenda + table views */
(function () {
  const C = window.Cadence;
  const { D, esc, icon } = C;
  const S = () => C.store;
  const ui = { scope: 'all', types: new Set(), levels: new Set(), node: null, record: null, recordLabel: '', forms: new Set(), q: '', tableSort: { key: 'due', dir: 1 }, flash: null, collapsed: new Set() };
  let el = null;

  const view = (C.views = C.views || {}).list = {
    title: 'Tasks',
    mount(root) {
      el = root;
      const now = new Date();
      root.innerHTML =
        '<section class="page list-page">' +
        '<header class="hero">' +
        '<div class="hero-text"><p class="eyebrow">' + C.F.wdayLong.format(now) + '</p>' +
        '<h1 class="display">' + esc(new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' }).format(now)) + '</h1>' +
        '<p class="summary" id="ls-summary"></p></div>' +
        '<div class="ring" id="ls-ring"></div></header>' +
        '<div id="ls-banner"></div>' +
        '<form class="quick" id="quick" autocomplete="off">' +
        '<span class="quick-ic">' + icon('plus') + '</span>' +
        '<label class="sr" for="qa-input">Quick add a task</label>' +
        '<input id="qa-input" placeholder="Add a task… try “Call mom fri 6pm #personal !high”, or @node to put it on the map" enterkeyhint="done">' +
        '<button class="btn primary sm" type="submit">Add</button>' +
        '<div class="qa-tokens" id="qa-tokens" aria-live="polite"></div>' +
        '</form>' +
        '<section class="stats" id="ls-stats" aria-label="Task inventory"></section>' +
        '<div class="toolbar">' +
        '<label class="input-wrap search">' + icon('search') + '<span class="sr">Search tasks</span><input id="ls-search" type="search" placeholder="Search tasks" value="' + esc(ui.q) + '"></label>' +
        '<div class="tool-group">' +
        '<label class="select-wrap"><span class="sr">Group by</span><select id="ls-group">' +
        [['due', 'Group: Due date'], ['type', 'Group: Type'], ['level', 'Group: Importance'], ['cluster', 'Group: Map cluster']].concat(canLink() ? [['form', 'Group: Form']] : []).concat([['none', 'No grouping']]).map(([v, l]) => '<option value="' + v + '">' + l + '</option>').join('') + '</select></label>' +
        '<label class="select-wrap"><span class="sr">Sort</span><select id="ls-sort">' +
        [['smart', 'Sort: Smart'], ['level', 'Sort: Importance'], ['created', 'Sort: Newest'], ['title', 'Sort: A–Z']].map(([v, l]) => '<option value="' + v + '">' + l + '</option>').join('') + '</select></label>' +
        '<button type="button" class="toggle" id="ls-done" aria-pressed="false">' + icon('check') + '<span>Completed</span></button>' +
        '<div class="seg mini" role="group" aria-label="Layout">' +
        '<button type="button" class="seg-btn" data-mode="agenda" aria-label="Agenda layout" title="Agenda">' + icon('rows') + '</button>' +
        '<button type="button" class="seg-btn" data-mode="table" aria-label="Table layout" title="Table">' + icon('table') + '</button></div>' +
        '</div></div>' +
        '<div class="filters" id="ls-filters"></div>' +
        '<div id="ls-body"></div>' +
        '</section>';

      const qa = root.querySelector('#qa-input');
      qa.addEventListener('input', renderTokens);
      root.querySelector('#quick').addEventListener('submit', (e) => {
        e.preventDefault();
        const v = qa.value.trim(); if (!v) return qa.focus();
        const st = S().state;
        const p = C.parseQuick(v, st.types, st.levels, st.prefs.weekStart, nodeList(), recordList());
        const t = S().addTask(Object.assign(C.fromParse(p), ui.node && !p.nodeId && C.map && C.map.getNode(ui.node) ? { nodeId: ui.node } : {},
          ui.record && !p.recordId && C.records && C.records.get(ui.record) ? C.records.linkFor(ui.record) : {}));
        ui.flash = t.id;
        qa.value = ''; renderTokens();
        C.toast('Added “' + t.title + '”' + (t.due ? ' · ' + C.relDate(t.due) : ''), { action: 'Edit', onAction: () => C.openEditor(t.id) });
      });
      root.querySelector('#ls-search').addEventListener('input', (e) => { ui.q = e.target.value; renderBody(); });
      root.querySelector('#ls-group').addEventListener('change', (e) => S().setPrefs({ group: e.target.value }));
      root.querySelector('#ls-sort').addEventListener('change', (e) => S().setPrefs({ sort: e.target.value }));
      root.querySelector('#ls-done').addEventListener('click', () => S().setPrefs({ showDone: !S().state.prefs.showDone }));
      root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => C.withTransition(() => S().setPrefs({ listMode: b.dataset.mode }))));
      root.querySelector('#ls-filters').addEventListener('click', onFilter);
      root.querySelector('#ls-banner').addEventListener('click', onBanner);
      const body = root.querySelector('#ls-body');
      body.addEventListener('click', onBodyClick);
      body.addEventListener('keydown', (e) => {
        const row = e.target.closest('[data-row]');
        if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); C.openEditor(row.dataset.row); }
        if (row && e.target === row && (e.key === 'x' || e.key === 'X')) { e.preventDefault(); C.completeTask(row.dataset.row); }
      });
      attachSwipe(body);
      view.update();
    },
    update() {
      if (!el) return;
      const p = S().state.prefs;
      el.querySelector('#ls-group').value = p.group;
      el.querySelector('#ls-sort').value = p.sort;
      const dn = el.querySelector('#ls-done'); dn.setAttribute('aria-pressed', String(!!p.showDone)); dn.classList.toggle('on', !!p.showDone);
      el.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === p.listMode));
      renderSummary(); renderBanner(); renderStats(); renderFilters(); renderBody(); renderTokens();
    },
    focusQuick() { const q = el && el.querySelector('#qa-input'); if (q) q.focus(); },
    focusSearch() { const q = el && el.querySelector('#ls-search'); if (q) q.focus(); },
    unmount() { el = null; },
    /* sidebar hooks: show only one type (click again to show all) */
    activeTypes() { return ui.types; },
    filterType(id) {
      if (ui.types.size === 1 && ui.types.has(id)) ui.types.clear();
      else { ui.types.clear(); ui.types.add(id); }
      filtersChanged();
    },
    clearTypes() { ui.types.clear(); filtersChanged(); },
    activeLevels() { return ui.levels; },
    filterLevel(id) {
      if (ui.levels.size === 1 && ui.levels.has(id)) ui.levels.clear();
      else { ui.levels.clear(); ui.levels.add(id); }
      filtersChanged();
    },
    clearLevels() { ui.levels.clear(); filtersChanged(); },
    /* map hooks: show only the tasks on one node */
    filterNode(id) { ui.node = id || null; filtersChanged(); },
    /* Formwright records: show only the tasks linked to one record */
    filterRecord(id, label) { ui.record = id || null; ui.recordLabel = label || ''; filtersChanged(); }
  };
  const canLink = () => !!(C.firebaseSync && C.firebaseSync.enabled && C.records);
  const recordList = () => (C.records ? C.records.index() : null);
  const recordTitle = (t) => { const l = t.recordId && C.records ? C.records.label(t) : null; return l ? l.title : ''; };
  const nodeList = () => (C.map ? C.map.nodeIndex() : null);
  const nodeTitle = (id) => (C.map && id ? C.map.title(C.map.getNode(id)) : '');
  /* toast hook: "N tasks were assigned to you" → Show */
  C.showAssignedToMe = function () { ui.scope = 'tome'; C.go('list'); filtersChanged(); };
  const SCOPES = [
    ['all', 'Everything', () => true],
    ['mine', 'Mine to do', (t) => (S().isOwner(t) && !S().isWithOthers(t)) || S().isAssignedToMe(t)],
    ['tome', 'Assigned to me', (t) => S().isAssignedToMe(t)],
    ['byme', 'Assigned to others', (t) => S().isOwner(t) && S().isWithOthers(t)]
  ];
  const inScope = (t) => !S().sharing() || (SCOPES.find((x) => x[0] === ui.scope) || SCOPES[0])[2](t);

  function filtersChanged() {
    if (el) { renderFilters(); renderBody(); }
    if (C.refreshChrome) C.refreshChrome();
  }

  /* ---------- pieces ---------- */
  function renderTokens() {
    if (!el) return;
    const v = el.querySelector('#qa-input').value;
    const box = el.querySelector('#qa-tokens');
    if (!v.trim()) { box.innerHTML = '<span class="qa-hint">Type naturally. Dates, times, <b>#type</b>, <b>!importance</b>, <b>@node</b>' + (canLink() ? ', <b>&amp;record</b>' : '') + ' and “every week” are picked up as you type.</span>'; return; }
    const st = S().state;
    const p = C.parseQuick(v, st.types, st.levels, st.prefs.weekStart, nodeList(), recordList());
    box.innerHTML = p.tokens.length
      ? p.tokens.map((t) => '<span class="tok tok-' + t.kind + '"' + (t.color ? ' style="--c:' + t.color + '"' : '') + '>' + icon({ date: 'calendar', time: 'clock', repeat: 'repeat', type: 'flag', level: 'bolt', node: 'canvas', record: 'file' }[t.kind]) + esc(t.label) + '</span>').join('') + '<span class="tok-title">→ ' + esc(p.title) + '</span>'
      : '<span class="qa-hint">Press Enter to add “' + esc(p.title) + '”</span>';
  }

  function stats() {
    const tk = D.todayKey();
    const ts = S().state.tasks;
    const open = ts.filter((t) => !t.done);
    const weekAgo = Date.now() - 7 * 864e5;
    const dueToday = ts.filter((t) => t.due === tk);
    return {
      open: open.length,
      overdue: open.filter((t) => t.due && t.due < tk).length,
      today: open.filter((t) => t.due === tk).length,
      todayTotal: dueToday.length,
      todayDone: dueToday.filter((t) => t.done).length,
      doneWeek: ts.filter((t) => t.done && t.doneAt && t.doneAt > weekAgo).length,
      unscheduled: open.filter((t) => !t.due).length,
      openList: open
    };
  }

  function renderSummary() {
    const s = stats();
    const parts = [];
    if (s.todayTotal) parts.push('<b>' + s.todayDone + ' of ' + s.todayTotal + '</b> done today');
    else parts.push('Nothing due today');
    if (s.overdue) parts.push('<span class="warn-text">' + s.overdue + ' overdue</span>');
    parts.push(s.open + ' open');
    el.querySelector('#ls-summary').innerHTML = parts.join('<span class="sep">·</span>');
    const pct = s.todayTotal ? s.todayDone / s.todayTotal : (s.open ? 0 : 1);
    const R = 26, L = 2 * Math.PI * R;
    el.querySelector('#ls-ring').innerHTML =
      '<svg viewBox="0 0 64 64" role="img" aria-label="' + Math.round(pct * 100) + '% of today’s tasks done"><circle cx="32" cy="32" r="' + R + '" class="ring-track"/>' +
      '<circle cx="32" cy="32" r="' + R + '" class="ring-fill" stroke-dasharray="' + L + '" stroke-dashoffset="' + (L * (1 - pct)) + '"/></svg>' +
      '<span class="ring-num">' + Math.round(pct * 100) + '<small>%</small></span><span class="ring-cap">today</span>';
  }

  function renderBanner() {
    const n = S().state.tasks.filter((t) => t.sample).length;
    el.querySelector('#ls-banner').innerHTML = n ? '<div class="banner">' + icon('sparkle') +
      '<p><b>These are example tasks</b> so you can try things out. Drag them around the calendar, complete them, edit them.</p>' +
      '<div class="banner-acts"><button class="btn sm" data-banner="keep">Keep them</button><button class="btn sm primary" data-banner="clear">Clear examples</button></div></div>' : '';
  }
  function onBanner(e) {
    const b = e.target.closest('[data-banner]'); if (!b) return;
    if (b.dataset.banner === 'clear') { const n = S().clearSamples(); C.toast('Cleared ' + n + ' example tasks. Your list is all yours.'); }
    else S().keepSamples();
  }

  function renderStats() {
    const s = stats();
    const types = S().state.types;
    const byType = types.map((t) => ({ t, n: s.openList.filter((x) => x.typeId === t.id).length })).filter((x) => x.n);
    const none = s.openList.filter((x) => !S().typeById(x.typeId)).length;
    const total = s.open || 1;
    el.querySelector('#ls-stats').innerHTML =
      '<div class="stat-tiles">' +
      tile('Open', s.open, '') + tile('Due today', s.today, s.today ? 'accent' : '') +
      tile('Overdue', s.overdue, s.overdue ? 'danger' : '') + tile('Done · 7 days', s.doneWeek, s.doneWeek ? 'ok' : '') +
      '</div>' +
      (s.open ? '<div class="mix"><div class="mix-bar" role="img" aria-label="Open tasks by type">' +
        byType.map((x) => '<span style="--c:' + x.t.color + ';flex:' + x.n + '" title="' + esc(x.t.name) + ': ' + x.n + '"></span>').join('') +
        (none ? '<span class="mix-none" style="flex:' + none + '" title="No type: ' + none + '"></span>' : '') + '</div>' +
        '<div class="mix-legend">' + byType.map((x) => '<button type="button" class="mix-key" data-filter-type="' + x.t.id + '" style="--c:' + x.t.color + '"><i></i>' + esc(x.t.name) + ' <span class="mono">' + x.n + '</span><span class="mix-pct mono">' + Math.round(x.n / total * 100) + '%</span></button>').join('') +
        (none ? '<span class="mix-key"><i class="none"></i>No type <span class="mono">' + none + '</span></span>' : '') + '</div></div>' : '');
    el.querySelectorAll('#ls-stats [data-filter-type]').forEach((b) => b.onclick = () => { toggleSet(ui.types, b.dataset.filterType); filtersChanged(); });
  }
  const tile = (label, n, tone) => '<div class="tile ' + tone + '"><span class="tile-n mono">' + n + '</span><span class="tile-l">' + label + '</span></div>';

  function renderFilters() {
    const st = S().state;
    const any = ui.types.size || ui.levels.size || ui.scope !== 'all' || ui.node || ui.record || ui.forms.size;
    // forms that open tasks are linked to, for the form chips
    const linked = new Map();
    st.tasks.forEach((t) => {
      if (!t.formId || linked.has(t.formId)) return;
      const R = C.records, snap = t.recordSnap || {};
      linked.set(t.formId, { name: (R && R.formName(t.formId)) || snap.form || 'Form', color: (R && R.formColor(t.formId)) || snap.color || 'var(--ink-3)' });
    });
    ui.forms.forEach((id) => { if (!linked.has(id)) ui.forms.delete(id); });
    const nd = ui.node && C.map ? C.map.getNode(ui.node) : null;
    if (ui.node && !nd) ui.node = null;
    const open = st.tasks.filter((t) => !t.done);
    el.querySelector('#ls-filters').innerHTML =
      '<div class="chips scroll-x">' +
      (nd ? '<button type="button" class="chip on node-filter" data-fnode style="--c:' + C.map.colorHex(nd.color) + '" title="Show all tasks"><i class="dot"></i>On “' + esc(C.map.title(nd)) + '”' + icon('x') + '</button><span class="chip-sep" aria-hidden="true"></span>' : '') +
      (ui.record ? '<button type="button" class="chip on node-filter rec-filter" data-frecord style="--c:' + esc(recFilterColor()) + '" title="Show all tasks"><i class="rdot"></i>On “' + esc(recFilterLabel()) + '”' + icon('x') + '</button><span class="chip-sep" aria-hidden="true"></span>' : '') +
      (S().sharing() && st.tasks.some((t) => S().isWithOthers(t)) ?
        SCOPES.map(([id, label, fn]) => {
          const n = id === 'all' ? 0 : open.filter(fn).length;
          return '<button type="button" class="chip scope' + (ui.scope === id ? ' on' : '') + '" data-fscope="' + id + '" aria-pressed="' + (ui.scope === id) + '">' + label + (n ? ' <span class="mono muted">' + n + '</span>' : '') + '</button>';
        }).join('') + '<span class="chip-sep" aria-hidden="true"></span>' : '') +
      st.types.map((t) => '<button type="button" class="chip' + (ui.types.has(t.id) ? ' on' : '') + '" data-ft="' + t.id + '" aria-pressed="' + ui.types.has(t.id) + '" style="--c:' + t.color + '">' + icon(t.glyph) + esc(t.name) + '</button>').join('') +
      '<span class="chip-sep" aria-hidden="true"></span>' +
      st.levels.map((l) => '<button type="button" class="chip' + (ui.levels.has(l.id) ? ' on' : '') + '" data-fl="' + l.id + '" aria-pressed="' + ui.levels.has(l.id) + '" style="--c:' + l.color + '"><i class="dot"></i>' + esc(l.name) + '</button>').join('') +
      (linked.size ? '<span class="chip-sep" aria-hidden="true"></span>' + [...linked].map(([id, f]) => '<button type="button" class="chip' + (ui.forms.has(id) ? ' on' : '') + '" data-fform="' + esc(id) + '" aria-pressed="' + ui.forms.has(id) + '" style="--c:' + esc(f.color) + '" title="Tasks linked to ' + esc(f.name) + ' records"><i class="rdot"></i>' + esc(f.name) + '</button>').join('') : '') +
      (any ? '<button type="button" class="chip clear" data-fclear>' + icon('x') + 'Clear filters</button>' : '') +
      '</div>';
  }
  function onFilter(e) {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.fscope) ui.scope = b.dataset.fscope;
    else if (b.dataset.ft) toggleSet(ui.types, b.dataset.ft);
    else if (b.dataset.fl) toggleSet(ui.levels, b.dataset.fl);
    else if (b.hasAttribute('data-fnode')) ui.node = null;
    else if (b.hasAttribute('data-frecord')) ui.record = null;
    else if (b.dataset.fform) toggleSet(ui.forms, b.dataset.fform);
    else if (b.hasAttribute('data-fclear')) { ui.types.clear(); ui.levels.clear(); ui.scope = 'all'; ui.node = null; ui.record = null; ui.forms.clear(); }
    filtersChanged();
  }
  const toggleSet = (set, v) => (set.has(v) ? set.delete(v) : set.add(v));
  function recFilterLabel() {
    const R = C.records, rec = R && R.get(ui.record);
    if (rec) return R.title(rec);
    const t = S().state.tasks.find((x) => x.recordId === ui.record);
    return (t && recordTitle(t)) || ui.recordLabel || 'Record';
  }
  function recFilterColor() {
    const R = C.records, rec = R && R.get(ui.record);
    if (rec) return R.formColor(rec.formId) || 'var(--accent)';
    const t = S().state.tasks.find((x) => x.recordId === ui.record);
    return (t && t.recordSnap && t.recordSnap.color) || 'var(--accent)';
  }

  /* ---------- filtering, sorting, grouping ---------- */
  function visibleTasks(includeDone) {
    const q = ui.q.trim().toLowerCase();
    return S().state.tasks.filter((t) =>
      (includeDone || !t.done) &&
      inScope(t) &&
      (!ui.types.size || ui.types.has(t.typeId)) &&
      (!ui.levels.size || ui.levels.has(t.levelId)) &&
      (!ui.node || t.nodeId === ui.node) &&
      (!ui.record || t.recordId === ui.record) &&
      (!ui.forms.size || ui.forms.has(t.formId)) &&
      (!q || t.title.toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q) || (t.subtasks || []).some((x) => x.title.toLowerCase().includes(q)) || nodeTitle(t.nodeId).toLowerCase().includes(q) || recordTitle(t).toLowerCase().includes(q)));
  }
  function sorter(mode) {
    const r = (t) => S().levelRank(t.levelId);
    const due = (t) => (t.due || '9999-99-99') + (t.time || '99:99');
    return {
      smart: (a, b) => (due(a) < due(b) ? -1 : due(a) > due(b) ? 1 : r(a) - r(b)),
      level: (a, b) => r(a) - r(b) || (due(a) < due(b) ? -1 : 1),
      created: (a, b) => b.createdAt - a.createdAt,
      title: (a, b) => a.title.localeCompare(b.title)
    }[mode] || ((a, b) => 0);
  }
  function groups(tasks) {
    const st = S().state, p = st.prefs;
    const open = tasks.filter((t) => !t.done).sort(sorter(p.sort));
    const done = tasks.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    let out = [];
    if (p.group === 'due') {
      const tk = D.todayKey(), wk = D.addKey(tk, 7);
      const g = { overdue: [], today: [], tomorrow: [], week: [], later: [], none: [] };
      open.forEach((t) => {
        if (!t.due) g.none.push(t);
        else if (t.due < tk) g.overdue.push(t);
        else if (t.due === tk) g.today.push(t);
        else if (t.due === D.addKey(tk, 1)) g.tomorrow.push(t);
        else if (t.due <= wk) g.week.push(t);
        else g.later.push(t);
      });
      out = [
        { id: 'overdue', label: 'Overdue', tone: 'danger', items: g.overdue },
        { id: 'today', label: 'Today', tone: 'accent', items: g.today, add: { due: tk } },
        { id: 'tomorrow', label: 'Tomorrow', items: g.tomorrow, add: { due: D.addKey(tk, 1) } },
        { id: 'week', label: 'Next 7 days', items: g.week },
        { id: 'later', label: 'Later', items: g.later },
        { id: 'none', label: 'Someday', sub: 'No date', items: g.none, add: {} }
      ];
    } else if (p.group === 'type') {
      out = st.types.map((t) => ({ id: t.id, label: t.name, color: t.color, glyph: t.glyph, items: open.filter((x) => x.typeId === t.id), add: { typeId: t.id } }));
      out.push({ id: 'notype', label: 'No type', items: open.filter((x) => !S().typeById(x.typeId)) });
    } else if (p.group === 'level') {
      out = st.levels.map((l) => ({ id: l.id, label: l.name, color: l.color, items: open.filter((x) => x.levelId === l.id), add: { levelId: l.id } }));
      const orphan = open.filter((x) => !S().levelById(x.levelId));
      if (orphan.length) out.push({ id: 'nolevel', label: 'Unrated', items: orphan });
    } else if (p.group === 'cluster' && C.map) {
      const m = C.map, by = new Map();
      open.forEach((t) => { const k = S().isOwner(t) ? m.clusterOf(t.nodeId) : null; const key = k || '~'; if (!by.has(key)) by.set(key, []); by.get(key).push(t); });
      const names = new Map(m.clusters().map((c) => [c.color, c.name]));
      out = [...by.keys()].filter((k) => k !== '~').sort((a, b) => by.get(b).length - by.get(a).length)
        .map((k) => ({ id: 'cl-' + k, label: names.get(k) || m.colorName(k), color: m.colorHex(k), items: by.get(k) }));
      if (by.has('~')) out.push({ id: 'cl-none', label: 'Not on the map', items: by.get('~') });
    } else if (p.group === 'form') {
      const by = new Map(), info = new Map();
      open.forEach((t) => {
        const key = t.formId || '~';
        if (!by.has(key)) by.set(key, []);
        by.get(key).push(t);
        if (t.formId && !info.has(key)) {
          const R = C.records, snap = t.recordSnap || {};
          info.set(key, { name: (R && R.formName(key)) || snap.form || 'Form', color: (R && R.formColor(key)) || snap.color || null });
        }
      });
      out = [...by.keys()].filter((k) => k !== '~').sort((a, b) => info.get(a).name.localeCompare(info.get(b).name))
        .map((k) => ({ id: 'fm-' + k, label: info.get(k).name, color: info.get(k).color, items: by.get(k) }));
      if (by.has('~')) out.push({ id: 'fm-none', label: 'Not linked to a record', items: by.get('~') });
    } else {
      out = [{ id: 'all', label: 'All open tasks', items: open }];
    }
    out = out.filter((g) => g.items.length || g.id === 'today');
    if (p.showDone && done.length) out.push({ id: 'done', label: 'Completed', tone: 'muted', items: done });
    return out;
  }

  function renderBody() {
    if (!el) return;
    const body = el.querySelector('#ls-body');
    const p = S().state.prefs;
    const tasks = visibleTasks(p.showDone || p.listMode === 'table');
    if (!S().state.ready) { body.innerHTML = '<div class="skeleton">' + '<i></i>'.repeat(4) + '</div>'; return; }
    if (p.listMode === 'table') { body.innerHTML = renderTable(tasks.filter((t) => p.showDone || !t.done)); return flash(body); }
    const gs = groups(tasks);
    const filtered = ui.q || ui.types.size || ui.levels.size || ui.scope !== 'all' || ui.node || ui.record || ui.forms.size;
    if (!gs.some((g) => g.items.length)) {
      body.innerHTML = '<div class="empty">' + icon(filtered ? 'search' : 'check', 'empty-ic') +
        '<h3>' + (filtered ? 'No tasks match' : 'All clear') + '</h3><p>' +
        (filtered ? 'Try a different search or clear the filters.' : 'Nothing open right now. Add a task above, or press <kbd>N</kbd>.') + '</p></div>';
      return;
    }
    body.innerHTML = gs.map((g) => {
      const col = ui.collapsed.has(g.id);
      return '<section class="group' + (g.tone ? ' tone-' + g.tone : '') + (col ? ' collapsed' : '') + '"' + (g.color ? ' style="--c:' + g.color + '"' : '') + '>' +
        '<header class="group-head"><button type="button" class="group-toggle" data-collapse="' + g.id + '" aria-expanded="' + !col + '">' + icon('chevD', 'chev') +
        (g.glyph ? '<span class="group-glyph">' + icon(g.glyph) + '</span>' : g.color ? '<i class="dot"></i>' : '') +
        '<span class="group-label">' + esc(g.label) + '</span>' + (g.sub ? '<span class="muted">' + g.sub + '</span>' : '') +
        '<span class="count mono">' + g.items.length + '</span></button>' +
        (g.add ? '<button type="button" class="icon-btn sm" data-add=\'' + esc(JSON.stringify(g.add)) + '\' aria-label="Add to ' + esc(g.label) + '">' + icon('plus') + '</button>' : '') +
        '</header>' +
        '<div class="group-items">' + (g.items.length ? g.items.map(row).join('') : '<p class="group-empty">Nothing due today. Enjoy the breathing room.</p>') + '</div></section>';
    }).join('');
    flash(body);
  }
  function flash(body) {
    if (!ui.flash) return;
    const r = body.querySelector('[data-row="' + ui.flash + '"]');
    if (r) { r.classList.add('flash'); r.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    ui.flash = null;
  }

  function row(t) {
    const S_ = S();
    const ty = S_.typeOf(t), lv = S_.levelOf(t);
    const tk = D.todayKey();
    const overdue = !t.done && t.due && t.due < tk;
    const subs = t.subtasks || [];
    const sd = subs.filter((x) => x.done).length;
    const meta = [];
    const who = C.whoChip(t);
    if (who) meta.push(who);
    if (t.due) meta.push('<span class="meta-due' + (overdue ? ' overdue' : t.due === tk ? ' today' : '') + '">' + icon('calendar') + C.relDate(t.due) + (overdue ? ' · ' + (-D.diff(t.due, tk)) + 'd late' : '') + (t.time ? ' · ' + C.fmtTime(t.time) : '') + '</span>');
    if (ty) meta.push('<span class="type-tag" style="--c:' + ty.color + '">' + icon(ty.glyph) + esc(ty.name) + '</span>');
    if (t.nodeId && C.map && S_.isOwner(t)) meta.push(C.map.chip(t.nodeId));
    if (t.recordId && C.records) meta.push(C.records.chip(t));
    if (subs.length) meta.push('<span class="meta-sub" title="' + sd + ' of ' + subs.length + ' steps"><span class="mini-bar"><i style="width:' + (sd / subs.length * 100) + '%"></i></span><span class="mono">' + sd + '/' + subs.length + '</span></span>');
    if (t.repeat && t.repeat !== 'none') meta.push('<span class="meta-ic" title="' + esc((C.REPEATS.find((r) => r.id === t.repeat) || {}).label) + '">' + icon('repeat') + '</span>');
    if (t.notes) meta.push('<span class="meta-ic" title="Has notes">' + icon('note') + '</span>');
    return '<div class="task' + (t.done ? ' done' : '') + (overdue ? ' is-overdue' : '') + '" data-row="' + t.id + '" tabindex="0" role="button" aria-label="' + esc(t.title) + '" style="--lv:' + (lv ? lv.color : 'var(--ink-3)') + '">' +
      '<div class="swipe-bg"><span class="sw-done">' + icon('check') + (t.done ? 'Reopen' : 'Done') + '</span><span class="sw-del">Delete' + icon('trash') + '</span></div>' +
      '<div class="task-inner">' +
      '<button type="button" class="check" data-check aria-pressed="' + !!t.done + '" aria-label="' + (t.done ? 'Mark as not done' : 'Mark as done') + '">' + icon('check') + '</button>' +
      '<div class="task-main"><div class="task-title">' + esc(t.title) + '</div>' + (meta.length ? '<div class="task-meta">' + meta.join('') + '</div>' : '') + '</div>' +
      (lv ? '<span class="lv-tag" title="Importance: ' + esc(lv.name) + '">' + esc(lv.name) + '</span>' : '') +
      '<div class="task-acts">' +
      (!t.done ? '<button type="button" class="icon-btn sm" data-snooze title="Move to tomorrow" aria-label="Move to tomorrow">' + icon('chevR') + '</button>' : '') +
      (S_.canDelete(t) ? '<button type="button" class="icon-btn sm" data-del title="Delete" aria-label="Delete">' + icon('trash') + '</button>' : '') + '</div>' +
      '</div></div>';
  }

  function renderTable(tasks) {
    const st = S().state;
    const { key, dir } = ui.tableSort;
    const val = {
      title: (t) => t.title.toLowerCase(),
      type: (t) => (S().typeOf(t) || { name: '~' }).name.toLowerCase(),
      level: (t) => S().levelRank(t.levelId),
      due: (t) => (t.due || '9999') + (t.time || ''),
      status: (t) => (t.done ? 1 : 0),
      created: (t) => t.createdAt
    }[key];
    tasks = tasks.slice().sort((a, b) => (val(a) < val(b) ? -dir : val(a) > val(b) ? dir : 0));
    const th = (k, l) => '<th scope="col"><button type="button" data-tsort="' + k + '" class="' + (key === k ? 'on' : '') + '">' + l + (key === k ? icon(dir > 0 ? 'up' : 'down') : '') + '</button></th>';
    if (!tasks.length) return '<div class="empty">' + icon('search', 'empty-ic') + '<h3>No tasks match</h3><p>Try a different search or clear the filters.</p></div>';
    const tk = D.todayKey();
    return '<div class="table-wrap"><table class="tbl"><thead><tr><th class="c-check"><span class="sr">Done</span></th>' + th('title', 'Task') + th('type', 'Type') + th('level', 'Importance') + th('due', 'Due') + th('status', 'Status') + th('created', 'Created') + '</tr></thead><tbody>' +
      tasks.map((t) => {
        const ty = S().typeOf(t), lv = S().levelOf(t);
        const overdue = !t.done && t.due && t.due < tk;
        const subs = t.subtasks || [];
        return '<tr data-row="' + t.id + '" class="' + (t.done ? 'done' : '') + '" tabindex="0" style="--lv:' + (lv ? lv.color : 'var(--ink-3)') + '">' +
          '<td class="c-check"><button type="button" class="check sm" data-check aria-pressed="' + !!t.done + '" aria-label="Toggle done">' + icon('check') + '</button></td>' +
          '<td class="c-title"><span class="task-title">' + esc(t.title) + '</span>' + C.whoChip(t, true) + (t.nodeId && C.map && S().isOwner(t) ? ' ' + C.map.chip(t.nodeId, true) : '') + (t.recordId && C.records ? ' ' + C.records.chip(t, true) : '') + (subs.length ? ' <span class="muted mono">' + subs.filter((x) => x.done).length + '/' + subs.length + '</span>' : '') + '</td>' +
          '<td>' + (ty ? '<span class="type-tag" style="--c:' + ty.color + '">' + icon(ty.glyph) + esc(ty.name) + '</span>' : '<span class="muted">—</span>') + '</td>' +
          '<td>' + (lv ? '<span class="lv-tag">' + esc(lv.name) + '</span>' : '<span class="muted">—</span>') + '</td>' +
          '<td class="mono' + (overdue ? ' overdue' : '') + '">' + (t.due ? esc(C.relDate(t.due)) + (t.time ? ' ' + C.fmtTime(t.time) : '') : '<span class="muted">—</span>') + '</td>' +
          '<td>' + (t.done ? '<span class="status ok">Done</span>' : overdue ? '<span class="status danger">Overdue</span>' : '<span class="status">Open</span>') + '</td>' +
          '<td class="mono muted">' + C.F.short.format(new Date(t.createdAt)) + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="table-foot muted">' + tasks.length + ' task' + (tasks.length === 1 ? '' : 's') + ' · ' + st.tasks.filter((t) => t.done).length + ' completed overall</p>';
  }

  function onBodyClick(e) {
    const ts = e.target.closest('[data-tsort]');
    if (ts) { const k = ts.dataset.tsort; ui.tableSort = { key: k, dir: ui.tableSort.key === k ? -ui.tableSort.dir : 1 }; return renderBody(); }
    const col = e.target.closest('[data-collapse]');
    if (col) { toggleSet(ui.collapsed, col.dataset.collapse); return renderBody(); }
    const nl = e.target.closest('[data-node-link]');
    if (nl) return C.map.focusNode(nl.dataset.nodeLink);
    const add = e.target.closest('[data-add]');
    if (add) return C.openEditor(JSON.parse(add.dataset.add));
    const r = e.target.closest('[data-row]'); if (!r) return;
    const id = r.dataset.row;
    if (e.target.closest('[data-check]')) return C.completeTask(id, r);
    if (e.target.closest('[data-snooze]')) {
      const t = S().get(id); const prev = t.due, was = { moved: t.moved || 0, pushed: t.pushed || 0 };
      S().updateTask(id, { due: D.addKey(D.todayKey(), 1) });
      return C.toast('Moved to tomorrow', { action: 'Undo', onAction: () => S().updateTask(id, { due: prev, moved: was.moved, pushed: was.pushed }) });
    }
    if (e.target.closest('[data-del]')) return C.deleteWithUndo(id);
    C.openEditor(id);
  }

  /* ---------- swipe gestures (touch) ---------- */
  function attachSwipe(body) {
    let s = null;
    body.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      const r = e.target.closest('.task'); if (!r || e.target.closest('button')) return;
      s = { r, inner: r.querySelector('.task-inner'), x0: e.clientX, y0: e.clientY, dx: 0, locked: null, pid: e.pointerId };
    }, { passive: true });
    body.addEventListener('pointermove', (e) => {
      if (!s || e.pointerId !== s.pid) return;
      const dx = e.clientX - s.x0, dy = e.clientY - s.y0;
      if (s.locked == null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) s.locked = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'x' : 'y';
      if (s.locked !== 'x') return;
      s.dx = dx;
      s.r.classList.add('swiping');
      s.r.classList.toggle('sw-right', dx > 0); s.r.classList.toggle('sw-left', dx < 0);
      s.r.classList.toggle('sw-armed', Math.abs(dx) > 90);
      s.inner.style.transform = 'translateX(' + dx + 'px)';
    }, { passive: true });
    const end = () => {
      if (!s) return;
      const { r, inner, dx, locked } = s; s = null;
      if (locked !== 'x') return;
      const id = r.dataset.row;
      const stopClick = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', stopClick, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', stopClick, { capture: true }), 60);
      inner.style.transition = 'transform .22s var(--ease)';
      if (Math.abs(dx) > 90) {
        inner.style.transform = 'translateX(' + (dx > 0 ? '110%' : '-110%') + ')';
        setTimeout(() => { if (dx > 0) C.completeTask(id); else C.deleteWithUndo(id); }, 180);
      } else {
        inner.style.transform = '';
        setTimeout(() => { r.classList.remove('swiping', 'sw-left', 'sw-right', 'sw-armed'); inner.style.transition = ''; }, 230);
      }
    };
    body.addEventListener('pointerup', end);
    body.addEventListener('pointercancel', end);
  }
})();
