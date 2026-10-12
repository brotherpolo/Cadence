/* Cadence — Insights: completion trends, on-time rate, activity heatmap, breakdowns.
   Charts are plain inline SVG drawn from the task list, so they follow the theme and
   need no chart library. Tap or hover a bar or square to see its numbers. */
(function () {
  const C = window.Cadence;
  const { D, esc, icon } = C;
  const S = () => C.store;
  const RANGES = [[4, '4 weeks'], [12, '12 weeks'], [26, '6 months']];
  const ui = { weeks: 12 };
  let el = null;

  const view = (C.views = C.views || {}).insights = {
    title: 'Insights',
    mount(root) {
      el = root;
      root.innerHTML = '<section class="page ins-page"><header class="page-head"><p class="eyebrow">How it’s going</p><h1 class="display">Insights</h1><div class="ins-links"><a href="#charts" class="btn sm">' + icon('pie') + '<span>Build your own chart</span></a><a href="#board" class="btn sm">' + icon('board') + '<span>Your board</span></a></div></header><div id="ins-root"></div></section>';
      root.addEventListener('click', onClick);
      root.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') showTip(e.target); });
      root.addEventListener('focusin', (e) => showTip(e.target));
      view.update();
    },
    update() { if (el) render(); },
    unmount() { el = null; }
  };

  /* ---------- data ---------- */
  const doneKey = (t) => (t.done && t.doneAt ? D.key(new Date(t.doneAt)) : null);
  const createdKey = (t) => (t.createdAt ? D.key(new Date(t.createdAt)) : null);
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  function compute() {
    const st = S().state, ws = st.prefs.weekStart, tk = D.todayKey();
    const tasks = st.tasks.filter((t) => !t.sample);
    const thisWeek = D.startOfWeek(D.today(), ws);
    const firstWeek = D.add(thisWeek, -7 * (ui.weeks - 1));
    const fromKey = D.key(firstWeek);

    // weekly buckets
    const weeks = [];
    for (let i = 0; i < ui.weeks; i++) { const s = D.add(firstWeek, 7 * i); weeks.push({ start: s, key: D.key(s), done: 0, added: 0, onTime: 0, withDue: 0 }); }
    const weekIdx = (k) => { if (!k || k < fromKey || k > tk) return -1; return Math.floor(D.diff(k, fromKey) / 7); };

    let doneInRange = 0, onTime = 0, withDue = 0, open = 0, overdue = 0;
    const ages = [0, 0, 0, 0]; // 1–3, 4–7, 8–14, 15+ days late
    const byDay = {};
    tasks.forEach((t) => {
      const dk = doneKey(t);
      if (dk) byDay[dk] = (byDay[dk] || 0) + 1;
      const wi = weekIdx(dk);
      if (wi >= 0) {
        weeks[wi].done++; doneInRange++;
        if (t.due) { withDue++; weeks[wi].withDue++; if (dk <= t.due) { onTime++; weeks[wi].onTime++; } }
      }
      const ci = weekIdx(createdKey(t));
      if (ci >= 0) weeks[ci].added++;
      if (!t.done) {
        open++;
        if (t.due && t.due < tk) {
          overdue++;
          const late = D.diff(tk, t.due);
          ages[late <= 3 ? 0 : late <= 7 ? 1 : late <= 14 ? 2 : 3]++;
        }
      }
    });

    // streak: consecutive days with at least one completion, ending today (or yesterday if nothing yet today)
    let streak = 0, k = byDay[tk] ? tk : D.addKey(tk, -1);
    while (byDay[k]) { streak++; k = D.addKey(k, -1); }

    // by type: open now vs completed in range
    // every task counts, including ones someone else assigned to you: their type is matched to yours by
    // name, and types you don't have get their own row in the owner's color
    const typeRows = st.types.map((ty) => ({ name: ty.name, color: ty.color, open: 0, done: 0 }));
    const none = { name: 'No type', color: 'var(--ink-3)', open: 0, done: 0 };
    tasks.forEach((t) => {
      const ty = S().typeOf(t);
      let row = ty ? typeRows.find((r) => r.name.toLowerCase() === String(ty.name).toLowerCase()) : none;
      if (!row) { row = { name: ty.name, color: ty.color || 'var(--ink-3)', open: 0, done: 0 }; typeRows.push(row); }
      if (!t.done) row.open++; else if (weekIdx(doneKey(t)) >= 0) row.done++;
    });
    typeRows.push(none);

    // open by importance
    const levelRows = st.levels.map((l) => ({ name: l.name, color: l.color, n: 0 }));
    tasks.forEach((t) => {
      if (t.done) return;
      const lv = S().levelOf(t); if (!lv) return;
      let r = levelRows.find((x) => x.name.toLowerCase() === String(lv.name).toLowerCase());
      if (!r) { r = { name: lv.name, color: lv.color || 'var(--ink-3)', n: 0 }; levelRows.push(r); }
      r.n++;
    });

    // sharing: one row per handoff (who assigned → who's doing it), in either direction
    const people = new Map();
    const me = st.owner;
    tasks.forEach((t) => {
      if (!t.assigneeId || t.assigneeId === t.ownerId) return;
      const fromMe = !t.ownerId || t.ownerId === me, toMe = t.assigneeId === me;
      const from = { uid: t.ownerId || me, name: fromMe ? 'You' : C.firstName(t.ownerName, t.ownerEmail), email: t.ownerEmail };
      const to = { uid: t.assigneeId, name: toMe ? 'You' : C.firstName(t.assigneeName, t.assigneeEmail), email: t.assigneeEmail };
      const key = from.uid + '>' + to.uid;
      const p = people.get(key) || { from, to, avatar: fromMe ? to : from, toMe, open: 0, done: 0, overdue: 0, days: [] };
      if (t.done) { p.done++; if (t.doneAt && t.createdAt) p.days.push((t.doneAt - t.createdAt) / 864e5); }
      else { p.open++; if (t.due && t.due < tk) p.overdue++; }
      people.set(key, p);
    });

    return { tasks, weeks, byDay, doneInRange, onTime, withDue, open, overdue, ages, streak, typeRows: typeRows.filter((r) => r.open || r.done), levelRows: levelRows.filter((r, i) => i < st.levels.length || r.n), people: [...people.values()], ws, tk };
  }

  /* ---------- render ---------- */
  function render() {
    const d = compute();
    const root = el.querySelector('#ins-root');
    if (!d.tasks.length) {
      const samples = S().state.tasks.some((t) => t.sample);
      root.innerHTML = '<div class="ins-empty st-sec"><p>Charts appear here once you have some tasks. Add a few, finish a few, and come back.' + (samples ? ' Example tasks aren’t counted.' : '') + '</p></div>';
      return;
    }
    const rate = d.withDue ? Math.round((d.onTime / d.withDue) * 100) : null;
    const avg = d.doneInRange / ui.weeks;

    root.innerHTML =
      '<div class="ins-bar"><div class="seg mini" role="group" aria-label="Time range">' +
      RANGES.map(([w, label]) => '<button type="button" class="seg-btn' + (ui.weeks === w ? ' on' : '') + '" data-range="' + w + '" aria-pressed="' + (ui.weeks === w) + '">' + label + '</button>').join('') +
      '</div></div>' +

      '<div class="ins-stats">' +
      stat('Completed', d.doneInRange, (avg >= 1 ? Math.round(avg) : avg.toFixed(1)) + ' a week on average', 'var(--ok)') +
      stat('On time', rate == null ? '—' : rate + '%', rate == null ? 'No dated tasks finished yet' : d.onTime + ' of ' + plural(d.withDue, 'dated task'), rate == null ? null : rate >= 80 ? 'var(--ok)' : rate >= 50 ? 'var(--warn)' : 'var(--danger)') +
      stat('Open', d.open, d.overdue ? d.overdue + ' overdue' : 'Nothing overdue', d.overdue ? 'var(--danger)' : null) +
      stat('Streak', plural(d.streak, 'day'), d.streak ? 'Finished something every day' : 'Finish a task today to start one', d.streak ? 'var(--accent)' : null) +
      '</div>' +

      '<div class="ins-grid">' +
      card('Completed vs. added', 'Bars are tasks you finished each week; the line is tasks you added. Bars above the line mean you’re catching up.',
        weekChart(d), legend([['var(--accent)', 'Completed', 'bar'], ['var(--ink-2)', 'Added', 'line']]), 'wide') +
      card('Activity', 'Tasks completed per day over the last 6 months.', heatmap(d), heatLegend(), 'wide') +
      card('By type', 'Open tasks now, and tasks completed in the selected range.', typeChart(d), legend([['var(--ink-2)', 'Open', 'solid'], ['var(--ink-2)', 'Completed', 'soft']])) +
      card('Overdue', d.overdue ? 'Open tasks past their due date, by how late they are.' : 'Nothing is past due. Nice.', agingChart(d)) +
      card('Open by importance', 'What’s still on your plate, from most to least important.', levelChart(d)) +
      (d.people.length ? card('Shared tasks', 'Who assigned what to whom, and how it’s going.', sharedTable(d)) : '') +
      '</div>';
    // show the most recent weeks of the heatmap first on narrow screens
    const hm = root.querySelector('.hm-scroll'); if (hm) hm.scrollLeft = hm.scrollWidth;
  }

  function stat(label, value, sub, color) {
    return '<div class="ins-stat"' + (color ? ' style="--c:' + color + '"' : '') + '><span class="eyebrow">' + label + '</span>' +
      '<span class="ins-num">' + esc(String(value)) + '</span><span class="ins-sub muted">' + esc(sub) + '</span></div>';
  }
  function card(title, sub, body, foot, cls) {
    return '<section class="st-sec ins-card' + (cls ? ' ' + cls : '') + '"><header><h2>' + title + '</h2><p class="muted">' + sub + '</p></header>' +
      '<div class="ins-chart">' + body + '</div>' + (foot || '') + '</section>';
  }
  function legend(items) {
    return '<div class="ins-legend">' + items.map(([c, l, kind]) => '<span><i class="lg-' + kind + '" style="--c:' + c + '"></i>' + l + '</span>').join('') +
      '<span class="ins-cap" aria-live="polite"></span></div>';
  }
  const tip = (s) => ' data-tip="' + esc(s) + '" tabindex="0"';

  /* weekly bars + added line */
  function weekChart(d) {
    const narrow = matchMedia('(max-width: 640px)').matches; // smaller canvas on phones keeps labels readable
    const W = narrow ? 360 : 640, H = narrow ? 200 : 220, L = 26, R = 6, T = 12, B = 26;
    const n = d.weeks.length, max = Math.max(4, ...d.weeks.map((w) => Math.max(w.done, w.added)));
    const top = niceMax(max), cw = (W - L - R) / n, bw = Math.max(4, Math.min(34, cw * 0.62));
    const y = (v) => T + (H - T - B) * (1 - v / top);
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const v = (top / 4) * i;
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="grid"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" class="ax" text-anchor="end">' + v + '</text>';
    }
    const every = narrow ? (n > 14 ? 6 : n > 6 ? 3 : 1) : (n > 14 ? 4 : n > 6 ? 2 : 1);
    let bars = '', pts = [];
    d.weeks.forEach((w, i) => {
      const cx = L + cw * i + cw / 2;
      const label = 'Week of ' + C.F.short.format(w.start) + ': ' + plural(w.done, 'completed') + ', ' + w.added + ' added' + (w.withDue ? ', ' + Math.round((w.onTime / w.withDue) * 100) + '% on time' : '');
      bars += '<rect class="hit" x="' + (L + cw * i) + '" y="' + T + '" width="' + cw + '" height="' + (H - T - B) + '"' + tip(label) + '/>';
      bars += '<rect class="bar" x="' + (cx - bw / 2) + '" y="' + y(w.done) + '" width="' + bw + '" height="' + Math.max(0, H - B - y(w.done)) + '" rx="' + Math.min(5, bw / 3) + '"/>';
      pts.push(cx.toFixed(1) + ',' + y(w.added).toFixed(1));
      if (i % every === (n - 1) % every) bars += '<text x="' + cx + '" y="' + (H - 8) + '" class="ax" text-anchor="middle">' + esc(C.F.short.format(w.start)) + '</text>';
    });
    const line = '<polyline points="' + pts.join(' ') + '" class="trend"/>' + pts.map((p) => '<circle cx="' + p.split(',')[0] + '" cy="' + p.split(',')[1] + '" r="3" class="trend-dot"/>').join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="Tasks completed and added per week">' + g + bars + line + '</svg>';
  }

  /* GitHub-style daily heatmap, 26 weeks */
  function heatmap(d) {
    const weeks = 26, c = 13, gap = 3, L = 26, T = 18;
    const start = D.add(D.startOfWeek(D.today(), d.ws), -7 * (weeks - 1));
    const max = Math.max(1, ...Object.values(d.byDay));
    let s = '', lastMonth = -1;
    for (let w = 0; w < weeks; w++) {
      const col = D.add(start, 7 * w);
      if (col.getMonth() !== lastMonth) { lastMonth = col.getMonth(); if (w < weeks - 2) s += '<text x="' + (L + w * (c + gap)) + '" y="11" class="ax">' + esc(new Intl.DateTimeFormat(undefined, { month: 'short' }).format(col)) + '</text>'; }
      for (let i = 0; i < 7; i++) {
        const day = D.add(col, i), k = D.key(day);
        if (k > d.tk) continue;
        const n = d.byDay[k] || 0;
        const lvl = n ? Math.min(4, Math.ceil((n / max) * 4)) : 0;
        s += '<rect x="' + (L + w * (c + gap)) + '" y="' + (T + i * (c + gap)) + '" width="' + c + '" height="' + c + '" rx="3" class="hm l' + lvl + (k === d.tk ? ' today' : '') + '"' + tip(C.F.long.format(day) + ': ' + plural(n, 'task') + ' completed') + '/>';
      }
    }
    [1, 3, 5].forEach((i) => { s += '<text x="0" y="' + (T + i * (c + gap) + 10) + '" class="ax">' + esc(C.F.wday.format(D.add(start, i))).slice(0, 3) + '</text>'; });
    const W = L + weeks * (c + gap), H = T + 7 * (c + gap);
    return '<div class="hm-scroll"><svg viewBox="0 0 ' + W + ' ' + H + '" class="chart heat" role="img" aria-label="Tasks completed per day">' + s + '</svg></div>';
  }
  function heatLegend() {
    return '<div class="ins-legend"><span class="hm-key">Less' + [0, 1, 2, 3, 4].map((l) => '<svg viewBox="0 0 12 12"><rect width="12" height="12" rx="3" class="hm l' + l + '"/></svg>').join('') + 'More</span><span class="ins-cap" aria-live="polite"></span></div>';
  }

  /* horizontal bars */
  function hbars(rows, max) {
    if (!rows.length) return '<p class="muted ins-none">Nothing to show yet.</p>';
    return '<div class="hbars">' + rows.map((r) =>
      '<div class="hb" style="--c:' + r.color + '"' + tip(r.tip) + '><span class="hb-label">' + esc(r.name) + '</span>' +
      '<span class="hb-track">' + r.segs.map((s) => '<i class="' + s.cls + '" style="width:' + (max ? (s.v / max) * 100 : 0) + '%"></i>').join('') + '</span>' +
      '<span class="hb-val mono">' + esc(r.val) + '</span></div>').join('') + '</div>';
  }
  function typeChart(d) {
    const max = Math.max(1, ...d.typeRows.map((r) => r.open + r.done));
    return hbars(d.typeRows.map((r) => ({ name: r.name, color: r.color, val: r.open + ' / ' + r.done, tip: r.name + ': ' + r.open + ' open, ' + r.done + ' completed', segs: [{ cls: 'solid', v: r.open }, { cls: 'soft', v: r.done }] })), max);
  }
  function agingChart(d) {
    if (!d.overdue) return '<div class="ins-ok">' + icon('check') + '<span>All caught up</span></div>';
    const labels = ['1–3 days', '4–7 days', '8–14 days', '15+ days'];
    const colors = ['var(--warn)', 'color-mix(in oklab, var(--warn) 50%, var(--danger))', 'var(--danger)', 'color-mix(in oklab, var(--danger) 75%, var(--ink))'];
    const max = Math.max(1, ...d.ages);
    return hbars(labels.map((l, i) => ({ name: l + ' late', color: colors[i], val: String(d.ages[i]), tip: plural(d.ages[i], 'task') + ' ' + l + ' late', segs: [{ cls: 'solid', v: d.ages[i] }] })), max);
  }
  function levelChart(d) {
    const max = Math.max(1, ...d.levelRows.map((r) => r.n));
    return hbars(d.levelRows.map((r) => ({ name: r.name, color: r.color, val: String(r.n), tip: r.name + ': ' + plural(r.n, 'open task'), segs: [{ cls: 'solid', v: r.n }] })), max);
  }
  function sharedTable(d) {
    // tasks assigned to you first, then the ones you handed out
    const rows = d.people.sort((a, b) => (b.toMe - a.toMe) || ((b.open + b.done) - (a.open + a.done))).map((p) => {
      const avg = p.days.length ? p.days.reduce((a, b) => a + b, 0) / p.days.length : null;
      const total = p.open + p.done;
      return '<div class="sh-row">' + C.avatar(p.avatar) + '<div class="sh-main"><span class="sh-name">' + esc(p.from.name) + ' <span class="sh-arrow">→</span> ' + esc(p.to.name) + '</span>' +
        '<span class="sh-track"><i style="width:' + (total ? (p.done / total) * 100 : 0) + '%"></i></span>' +
        '<span class="sh-meta muted">' + p.done + ' done · ' + p.open + ' open' + (p.overdue ? ' · <b class="late">' + p.overdue + ' overdue</b>' : '') +
        (avg != null ? ' · avg ' + (avg < 1 ? '<1' : Math.round(avg)) + (Math.round(avg) === 1 || avg < 1 ? ' day' : ' days') : '') + '</span></div></div>';
    }).join('');
    return rows || '<p class="muted ins-none">No shared tasks yet.</p>';
  }
  function niceMax(v) { const steps = [4, 8, 12, 20, 40, 60, 80, 100, 160, 200, 400, 800, 1000]; return steps.find((s) => s >= v) || Math.ceil(v / 1000) * 1000; }

  /* ---------- interaction ---------- */
  function showTip(t) {
    const node = t && t.closest && t.closest('[data-tip]');
    if (!node || !el.contains(node)) return;
    const cardEl = node.closest('.ins-card');
    const cap = cardEl && cardEl.querySelector('.ins-cap');
    cardEl && cardEl.querySelectorAll('.tipped').forEach((x) => x.classList.remove('tipped'));
    node.classList.add('tipped');
    if (cap) cap.textContent = node.dataset.tip;
    else if (cardEl) { // cards without a legend: show the caption under the chart
      let c = cardEl.querySelector('.ins-cap.solo');
      if (!c) { c = document.createElement('p'); c.className = 'ins-cap solo'; c.setAttribute('aria-live', 'polite'); cardEl.appendChild(c); }
      c.textContent = node.dataset.tip;
    }
  }
  function onClick(e) {
    const r = e.target.closest('[data-range]');
    if (r) { ui.weeks = +r.dataset.range; return C.withTransition(render); }
    showTip(e.target);
  }
})();
