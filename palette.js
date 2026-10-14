/* Cadence — command palette (⌘K / Ctrl+K) */
(function () {
  const C = window.Cadence;
  const { esc, icon } = C;
  let current = null;

  C.openPalette = function () {
    if (current) return current.close();
    const S = C.store;
    const wrap = document.createElement('div');
    wrap.className = 'pal-wrap';
    wrap.innerHTML = '<div class="sheet-backdrop" data-close></div><div class="pal" role="dialog" aria-modal="true" aria-label="Command menu">' +
      '<div class="pal-input">' + icon('search') + ' <input id="pal-q" placeholder="Search tasks, the map, or type a command…" autocomplete="off" spellcheck="false"><kbd>esc</kbd></div>' +
      '<div class="pal-list" role="listbox" id="pal-list"></div>' +
      '<div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span class="muted">Tip: start a line with “+” to add it as a task</span></div></div>';
    document.getElementById('overlay-root').appendChild(wrap);
    const q = wrap.querySelector('#pal-q');
    const list = wrap.querySelector('#pal-list');
    let items = [], sel = 0;

    const actions = [
      { label: 'New task', hint: 'N', ic: 'plus', run: () => C.openEditor() },
      { label: 'Go to Tasks', hint: '1', ic: 'list', run: () => C.go('list') },
      { label: 'Go to Calendar', hint: '2', ic: 'calendar', run: () => C.go('calendar') },
      { label: 'Go to Canvas', hint: '3', ic: 'canvas', run: () => C.go('canvas') },
      { label: 'Go to Outline', hint: '4', ic: 'outline', run: () => C.go('outline') },
      { label: 'Go to Map table', hint: '5', ic: 'table', run: () => C.go('table') },
      { label: 'Go to Insights', hint: '6', ic: 'chart', run: () => C.go('insights') },
      { label: 'Open Chart builder', ic: 'pie', run: () => C.go('charts') },
      { label: 'Go to Dashboards', ic: 'board', run: () => C.go('board') },
      { label: 'Go to Settings', ic: 'settings', run: () => C.go('settings') },
      { label: 'Add a node to the map', ic: 'node', run: () => C.map.newNode() },
      { label: 'New cluster on the map', ic: 'cluster', run: () => C.map.newCluster() },
      { label: 'Fit the map to the screen', ic: 'fit', run: () => { C.map.ui.focusReq = { ids: C.map.nodes().map((n) => n.id), fit: true, maxZoom: 1.1 }; if (C.currentRoute() === 'canvas') C.views.canvas.consumeFocus(); else C.go('canvas'); } },
      { label: 'Fold every map branch', ic: 'fold', run: () => C.map.setAllCollapsed(true) },
      { label: 'Unfold every map branch', ic: 'fold', run: () => C.map.setAllCollapsed(false) },
      { label: 'Export canvas as PNG', ic: 'image', run: () => C.views.canvas.exportPNG() },
      { label: 'Export outline as PDF', ic: 'file', run: () => { C.go('outline'); setTimeout(() => C.views.outline.exportPDF(), 120); } },
      { label: 'Undo the last map change', ic: 'undo', run: () => C.map.undo() },
      { label: 'Toggle dark mode', hint: 'D', ic: 'moon', run: () => C.cycleTheme() },
      { label: 'Show completed tasks', ic: 'check', run: () => { S.setPrefs({ showDone: !S.state.prefs.showDone }); C.go('list'); } },
      { label: 'Switch list to table view', ic: 'table', run: () => { S.setPrefs({ listMode: S.state.prefs.listMode === 'table' ? 'agenda' : 'table' }); C.go('list'); } }
    ];

    function build() {
      const v = q.value.trim();
      const lv = v.toLowerCase();
      items = [];
      if (v.startsWith('+') && v.length > 1) {
        const p = C.parseQuick(v.slice(1), S.state.types, S.state.levels, S.state.prefs.weekStart, C.map ? C.map.nodeIndex() : null, C.records ? C.records.index() : null);
        items.push({ group: 'Actions', label: 'Add “' + p.title + '”', sub: p.tokens.map((t) => t.label).join(' · '), ic: 'plus', run: () => { const t = S.addTask(C.fromParse(p)); C.toast('Added “' + t.title + '”'); } });
      }
      const acts = actions.filter((a) => !lv || a.label.toLowerCase().includes(lv));
      (lv ? acts : acts.slice(0, 10)).forEach((a) => items.push(Object.assign({ group: 'Actions' }, a)));
      if (lv && C.map) {
        const m = C.map;
        m.nodes().map((n) => ({ n, t: m.title(n), i: m.title(n).toLowerCase().indexOf(lv) })).filter((x) => x.i >= 0)
          .sort((a, b) => a.i - b.i || a.t.length - b.t.length).slice(0, 8)
          .forEach(({ n, t }) => items.push({ group: 'Map', label: t, sub: m.nodeMeta(n), ic: 'node', color: m.colorHex(n.color), run: () => m.focusNode(n.id) }));
      }
      const tasks = S.state.tasks
        .filter((t) => !lv || t.title.toLowerCase().includes(lv) || (t.notes || '').toLowerCase().includes(lv))
        .sort((a, b) => (a.done - b.done) || ((a.due || '9') < (b.due || '9') ? -1 : 1))
        .slice(0, lv ? 12 : 6);
      tasks.forEach((t) => {
        const ty = S.typeOf(t);
        items.push({ group: 'Tasks', label: t.title, sub: [C.relDate(t.due), ty && ty.name, S.isAssignedToMe(t) && 'From ' + C.firstName(t.ownerName, t.ownerEmail), t.done && 'Done'].filter(Boolean).join(' · '), ic: ty ? ty.glyph : 'inbox', color: ty && ty.color, task: true, run: () => C.openEditor(t.id) });
      });
      sel = Math.min(sel, Math.max(0, items.length - 1));
      list.innerHTML = items.length ? items.map((it, i) =>
        (i === 0 || it.group !== items[i - 1].group ? '<div class="pal-group">' + esc(it.group || 'Actions') + '</div>' : '') +
        '<button type="button" role="option" class="pal-item' + (i === sel ? ' on' : '') + '" data-i="' + i + '" aria-selected="' + (i === sel) + '"' + (it.color ? ' style="--c:' + it.color + '"' : '') + '>' +
        '<span class="pal-ic' + (it.color ? ' tinted' : '') + '">' + icon(it.ic) + '</span><span class="pal-text"><span class="pal-label' + (it.task && S.get && /Done$/.test(it.sub || '') ? ' struck' : '') + '">' + esc(it.label) + '</span>' +
        (it.sub ? '<span class="pal-sub">' + esc(it.sub) + '</span>' : '') + '</span>' +
        (it.hint ? '<kbd>' + it.hint + '</kbd>' : '') + '</button>').join('') : '<div class="pal-empty">Nothing matches “' + esc(v) + '”. Start with “+” to add it as a task.</div>';
      const on = list.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    }
    function run(i) { const it = items[i]; if (!it) return; close(); it.run(); }
    q.addEventListener('input', () => { sel = 0; build(); });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % items.length; build(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; build(); }
      else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) return close();
      const b = e.target.closest('.pal-item'); if (b) run(+b.dataset.i);
    });
    build();
    q.focus();
    requestAnimationFrame(() => { wrap.classList.add('in'); q.focus(); });
    function close() { wrap.classList.remove('in'); setTimeout(() => wrap.remove(), 160); current = null; }
    current = { close };
  };
})();
