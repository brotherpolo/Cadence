/* Cadence — Calendar: month & week views, drag tasks between days, unscheduled tray */
(function () {
  const C = window.Cadence;
  const { D, esc, icon } = C;
  const S = () => C.store;
  const ui = { cursor: D.today(), selected: D.todayKey(), tray: true };
  let el = null;

  const view = (C.views = C.views || {}).calendar = {
    title: 'Calendar',
    mount(root) {
      el = root;
      root.innerHTML = '<section class="page cal-page"><div id="cal-root"></div></section>';
      root.addEventListener('click', onClick);
      root.addEventListener('keydown', (e) => {
        const p = e.target.closest('[data-open]');
        if (p && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); C.openEditor(p.dataset.open); }
      });
      attachSwipe(root);
      view.update();
    },
    update() { if (el) render(); },
    unmount() { el = null; },
    shift(n) { move(n); }
  };

  function tasksByDay() {
    const m = {};
    S().state.tasks.forEach((t) => { if (t.due) (m[t.due] = m[t.due] || []).push(t); });
    Object.values(m).forEach((arr) => arr.sort((a, b) => (a.done - b.done) || ((a.time || '99') < (b.time || '99') ? -1 : (a.time || '99') > (b.time || '99') ? 1 : S().levelRank(a.levelId) - S().levelRank(b.levelId))));
    return m;
  }

  function render() {
    const st = S().state, p = st.prefs;
    const mode = p.calMode;
    const ws = p.weekStart;
    const byDay = tasksByDay();
    const tk = D.todayKey();
    const unscheduled = st.tasks.filter((t) => !t.done && !t.due).sort((a, b) => S().levelRank(a.levelId) - S().levelRank(b.levelId));

    let title, grid;
    if (mode === 'week') {
      const start = D.startOfWeek(ui.cursor, ws);
      const end = D.add(start, 6);
      title = D.sameMonth(start, end) ? C.F.monthYear.format(start) : C.F.short.format(start) + ' – ' + C.F.shortY.format(end);
      grid = weekGrid(start, byDay, tk);
    } else {
      title = C.F.monthYear.format(ui.cursor);
      grid = monthGrid(byDay, tk, ws);
    }
    const [mName, ...rest] = title.split(' ');
    el.querySelector('#cal-root').innerHTML =
      '<header class="cal-head">' +
      '<h1 class="display cal-title"><span>' + esc(mName) + '</span> <span class="cal-year">' + esc(rest.join(' ')) + '</span></h1>' +
      '<div class="cal-tools">' +
      '<div class="seg mini" role="group" aria-label="Calendar range">' +
      '<button type="button" class="seg-btn' + (mode === 'month' ? ' on' : '') + '" data-cmode="month">Month</button>' +
      '<button type="button" class="seg-btn' + (mode === 'week' ? ' on' : '') + '" data-cmode="week">Week</button></div>' +
      '<div class="nav-btns">' +
      '<button type="button" class="icon-btn" data-nav="-1" data-drag-flip aria-label="Previous">' + icon('chevL') + '</button>' +
      '<button type="button" class="btn sm" data-nav="0">Today</button>' +
      '<button type="button" class="icon-btn" data-nav="1" data-drag-flip aria-label="Next">' + icon('chevR') + '</button></div>' +
      '<button type="button" class="toggle' + (ui.tray ? ' on' : '') + '" data-tray aria-pressed="' + ui.tray + '">' + icon('inbox') + '<span>Unscheduled</span><span class="count mono">' + unscheduled.length + '</span></button>' +
      '</div></header>' +
      '<p class="cal-hint muted">' + (matchMedia('(pointer:coarse)').matches ? 'Press and hold a task, then drag it to another day.' : 'Drag tasks between days. Drop on “Unscheduled” to clear a date. Hover the arrows while dragging to change ' + mode + '.') + '</p>' +
      '<div class="cal-layout' + (ui.tray ? ' with-tray' : '') + (mode === 'week' ? ' wk' : '') + '">' +
      '<div class="cal-main">' + grid + (mode === 'month' ? dayPanel(byDay, tk) : '') + '</div>' +
      (ui.tray ? '<aside class="tray" data-drop-day="" aria-label="Unscheduled tasks"><div class="tray-head"><span class="eyebrow">Unscheduled</span><button type="button" class="icon-btn sm" data-new="" aria-label="New unscheduled task">' + icon('plus') + '</button></div>' +
        '<div class="tray-list">' + (unscheduled.length ? unscheduled.map((t) => card(t, true)).join('') : '<p class="muted tray-empty">Every task has a date. Drop one here to unschedule it.</p>') + '</div></aside>' : '') +
      '</div>';
  }

  function monthGrid(byDay, tk, ws) {
    const first = new Date(ui.cursor.getFullYear(), ui.cursor.getMonth(), 1);
    const start = D.startOfWeek(first, ws);
    const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const weeks = Math.ceil((D.diff(D.key(lastDay), D.key(start)) + 1) / 7);
    let h = '<div class="month" style="--weeks:' + weeks + '"><div class="wd-row" aria-hidden="true">';
    for (let i = 0; i < 7; i++) { const d = D.add(start, i); h += '<span class="' + (d.getDay() % 6 === 0 ? 'we' : '') + '">' + C.F.wday.format(d) + '</span>'; }
    h += '</div><div class="month-grid" role="grid">';
    for (let i = 0; i < weeks * 7; i++) {
      const d = D.add(start, i), k = D.key(d);
      const list = byDay[k] || [];
      const out = !D.sameMonth(d, first);
      const open = list.filter((t) => !t.done).length;
      const cls = ['day', out && 'out', k === tk && 'today', k === ui.selected && 'sel', k < tk && 'past', d.getDay() % 6 === 0 && 'we'].filter(Boolean).join(' ');
      h += '<div class="' + cls + '" data-drop-day="' + k + '" data-day="' + k + '" role="gridcell" aria-label="' + esc(C.F.long.format(d)) + ', ' + list.length + ' tasks">' +
        '<div class="day-top"><span class="day-num mono">' + d.getDate() + '</span>' + (open ? '<span class="day-load" style="--n:' + Math.min(open, 5) + '"></span>' : '') + '</div>' +
        '<div class="day-pills">' + list.slice(0, 3).map(pill).join('') + (list.length > 3 ? '<span class="more">+' + (list.length - 3) + ' more</span>' : '') + '</div>' +
        '<div class="day-dots" aria-hidden="true">' + list.slice(0, 4).map((t) => '<i style="--c:' + color(t) + '" class="' + (t.done ? 'd' : '') + '"></i>').join('') + '</div>' +
        '</div>';
    }
    return h + '</div></div>';
  }

  function weekGrid(start, byDay, tk) {
    let h = '<div class="week">';
    for (let i = 0; i < 7; i++) {
      const d = D.add(start, i), k = D.key(d);
      const list = byDay[k] || [];
      h += '<section class="wcol' + (k === tk ? ' today' : '') + (k < tk ? ' past' : '') + '" data-drop-day="' + k + '">' +
        '<header class="wcol-head"><span class="wcol-wd">' + C.F.wday.format(d) + '</span><span class="wcol-num mono">' + d.getDate() + '</span>' +
        '<button type="button" class="icon-btn sm" data-new="' + k + '" aria-label="Add task on ' + esc(C.F.long.format(d)) + '">' + icon('plus') + '</button></header>' +
        '<div class="wcol-list">' + (list.length ? list.map((t) => card(t, true)).join('') : '<p class="wcol-empty">Free</p>') + '</div></section>';
    }
    return h + '</div>';
  }

  function dayPanel(byDay, tk) {
    const k = ui.selected;
    const list = byDay[k] || [];
    const d = D.parse(k);
    return '<section class="daypanel" data-drop-day="' + k + '">' +
      '<header class="dp-head"><div><span class="eyebrow">' + esc(C.relDate(k) === C.F.short.format(d) ? C.F.wdayLong.format(d) : C.relDate(k)) + '</span>' +
      '<h2 class="dp-title">' + esc(C.F.long.format(d)) + '</h2></div>' +
      '<button type="button" class="btn sm primary" data-new="' + k + '">' + icon('plus') + '<span>Add task</span></button></header>' +
      (list.length ? '<div class="dp-list">' + list.map((t) => card(t, true)).join('') + '</div>'
        : '<p class="muted dp-empty">' + (k < tk ? 'Nothing was scheduled here.' : 'Nothing planned. Drag a task here or add one.') + '</p>') +
      '</section>';
  }

  const color = (t) => { const ty = S().typeOf(t); return ty ? ty.color : 'var(--ink-3)'; };
  const lvColor = (t) => { const l = S().levelOf(t); return l ? l.color : 'var(--ink-3)'; };

  function pill(t) {
    return '<div class="pill' + (t.done ? ' done' : '') + '" data-drag-task="' + t.id + '" data-open="' + t.id + '" tabindex="0" role="button" style="--c:' + color(t) + ';--lv:' + lvColor(t) + '" title="' + esc(t.title) + '">' +
      (t.time ? '<span class="pill-t mono">' + esc(C.fmtTime(t.time).replace(/:00| /g, '').toLowerCase()) + '</span>' : '') +
      '<span class="pill-x">' + esc(t.title) + '</span></div>';
  }

  function card(t, handle) {
    const ty = S().typeOf(t), lv = S().levelOf(t);
    return '<div class="ccard' + (t.done ? ' done' : '') + '" data-drag-task="' + t.id + '" data-open="' + t.id + '" tabindex="0" role="button" style="--c:' + color(t) + ';--lv:' + lvColor(t) + '">' +
      (handle ? '<span class="grip" data-drag-handle aria-hidden="true">' + icon('grip') + '</span>' : '') +
      '<button type="button" class="check sm" data-ccheck="' + t.id + '" aria-pressed="' + !!t.done + '" aria-label="Toggle done">' + icon('check') + '</button>' +
      '<div class="ccard-main"><span class="ccard-title">' + esc(t.title) + '</span>' +
      '<span class="ccard-meta">' + C.whoChip(t, true) + (t.time ? '<span class="mono">' + C.fmtTime(t.time) + '</span>' : '') +
      (ty ? '<span class="type-tag" style="--c:' + ty.color + '">' + icon(ty.glyph) + esc(ty.name) + '</span>' : '') +
      (lv ? '<span class="lv-dot" title="' + esc(lv.name) + '"></span>' : '') + '</span></div></div>';
  }

  function move(n) {
    const mode = S().state.prefs.calMode;
    if (n === 0) { ui.cursor = D.today(); ui.selected = D.todayKey(); }
    else if (mode === 'week') ui.cursor = D.add(ui.cursor, 7 * n);
    else ui.cursor = new Date(ui.cursor.getFullYear(), ui.cursor.getMonth() + n, 1);
    C.withTransition(render, n > 0 ? 'fwd' : n < 0 ? 'back' : null);
  }

  function onClick(e) {
    const b = e.target.closest('[data-nav]');
    if (b) return move(+b.dataset.nav);
    const cm = e.target.closest('[data-cmode]');
    if (cm) { if (cm.dataset.cmode === 'week') ui.cursor = D.parse(ui.selected); return C.withTransition(() => S().setPrefs({ calMode: cm.dataset.cmode })); }
    if (e.target.closest('[data-tray]')) { ui.tray = !ui.tray; return render(); }
    const ck = e.target.closest('[data-ccheck]');
    if (ck) return C.completeTask(ck.dataset.ccheck);
    const nw = e.target.closest('[data-new]');
    if (nw) return C.openEditor(nw.dataset.new ? { due: nw.dataset.new } : {});
    const op = e.target.closest('[data-open]');
    if (op && !(op.classList.contains('pill') && matchMedia('(max-width: 640px)').matches)) return C.openEditor(op.dataset.open);
    const day = e.target.closest('[data-day]');
    if (day) {
      const k = day.dataset.day;
      if (ui.selected === k && !op && matchMedia('(pointer:fine)').matches && e.detail === 2) return C.openEditor({ due: k });
      ui.selected = k;
      const d = D.parse(k);
      if (!D.sameMonth(d, ui.cursor)) { ui.cursor = new Date(d.getFullYear(), d.getMonth(), 1); }
      render();
      if (matchMedia('(max-width: 640px)').matches) { const dp = el.querySelector('.daypanel'); if (dp) dp.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    }
  }

  /* swipe left/right on the month grid (phones) */
  function attachSwipe(root) {
    let s = null;
    root.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || !e.target.closest('.month-grid,.week')) return;
      s = { x: e.clientX, y: e.clientY, t: Date.now() };
    }, { passive: true });
    root.addEventListener('pointerup', (e) => {
      if (!s || C.drag.active) { s = null; return; }
      const dx = e.clientX - s.x, dy = e.clientY - s.y, dt = Date.now() - s.t;
      s = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 600) move(dx < 0 ? 1 : -1);
    });
    root.addEventListener('pointercancel', () => { s = null; });
  }
})();
