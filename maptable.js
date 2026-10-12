/* Cadence — Map table page: every node in a sortable, bulk-editable table. */
(function () {
  const C = window.Cadence;
  const { esc, icon } = C;
  const M = () => C.map;
  let el = null, lastSig = '';
  const COLS = [
    { key: 'label', title: 'Node', always: true },
    { key: 'color', title: 'Cluster', always: true },
    { key: 'parent', title: 'Parent' },
    { key: 'tasks', title: 'Tasks' },
    { key: 'connections', title: 'Links' },
    { key: 'shape', title: 'Shape' },
    { key: 'link', title: 'URL' },
    { key: 'position', title: 'Position' }
  ];
  const EDITABLE = ['label', 'color', 'shape', 'link', 'position', 'parent'];

  const view = (C.views = C.views || {}).table = {
    title: 'Table',
    mount(root) {
      el = root;
      const t = M().ui.table;
      M().ui.lastRoute = 'table'; M().saveUi();
      root.innerHTML = '<section class="page map-page tb-page">' + M().subnav('table') +
        '<header class="map-head"><div class="map-head-text"><p class="eyebrow">Map</p><h1 class="display">Table</h1>' +
        '<p class="map-lede muted">Every node on the map. Sort, filter and change many at once. Double-click a cell to edit it.</p></div>' +
        '<div class="btn-row map-head-acts">' +
        '<button type="button" class="icon-btn" data-tb="undo" title="Undo" aria-label="Undo">' + icon('undo') + '</button>' +
        '<button type="button" class="icon-btn" data-tb="redo" title="Redo" aria-label="Redo">' + icon('redo') + '</button>' +
        '<button type="button" class="btn primary" data-tb="add">' + icon('plus') + '<span>Add node</span></button></div></header>' +
        '<div class="toolbar">' +
        '<label class="input-wrap search">' + icon('search') + '<span class="sr">Filter nodes</span><input id="tb-q" type="search" placeholder="Filter nodes" value="' + esc(t.q) + '"></label>' +
        '<div class="tool-group">' +
        '<label class="select-wrap"><span class="sr">Cluster</span><select id="tb-cluster"></select></label>' +
        '<button type="button" class="toggle" id="tb-group" aria-pressed="false">' + icon('cluster') + '<span>Group by cluster</span></button>' +
        '<button type="button" class="toggle" id="tb-cols" aria-haspopup="menu">' + icon('table') + '<span>Columns</span></button>' +
        '</div></div>' +
        '<div class="bulk-bar" id="tb-bulk" hidden></div>' +
        '<div id="tb-body"></div>' +
        '</section>';
      wire();
      lastSig = '';
      view.render();
    },
    unmount() { if (M().ui.table.editing) commitEdit(); el = null; },
    update() { if (el && sig() !== lastSig) view.render(); else if (el) head(); },
    render,
    newNode() {
      const n = M().addNode({ label: 'New node' });
      M().ui.table.editing = { id: n.id, key: 'label' };
      M().ui.table.q = ''; const q = el && el.querySelector('#tb-q'); if (q) q.value = '';
      render();
    },
    key() { return false; }
  };
  const sig = () => M().rev() + '#' + M().tasksSig();

  function sortVal(n, key, idx) {
    const g = M().graph();
    switch (key) {
      case 'label': return M().title(n).toLowerCase();
      case 'color': return n.color || 'gray';
      case 'parent': { const p = g.nodeMap.get(g.parent.get(n.id)); return p ? M().title(p).toLowerCase() : '~'; }
      case 'shape': return n.shape || 'pill';
      case 'connections': return g.degree.get(n.id) || 0;
      case 'tasks': return M().taskCounts(n.id, idx).open;
      case 'link': return (n.linkUrl || '~').toLowerCase();
      case 'position': return n.y * 100000 + n.x;
    }
    return '';
  }
  function rows(idx) {
    const t = M().ui.table, q = t.q.toLowerCase().trim(), g = M().graph();
    const out = M().nodes().filter((n) => {
      if (t.cluster && (n.color || 'gray') !== t.cluster) return false;
      if (!q) return true;
      const p = g.nodeMap.get(g.parent.get(n.id));
      return [M().title(n), n.color, n.shape, n.linkUrl, p ? M().title(p) : ''].some((v) => String(v || '').toLowerCase().includes(q));
    });
    out.sort((a, b) => { const va = sortVal(a, t.sort, idx), vb = sortVal(b, t.sort, idx); return va < vb ? -t.dir : va > vb ? t.dir : 0; });
    return out;
  }
  const visCols = () => COLS.filter((c) => c.always || M().ui.table.columns[c.key]);

  function head() {
    if (!el) return;
    el.querySelector('[data-tb="undo"]').disabled = !M().canUndo();
    el.querySelector('[data-tb="redo"]').disabled = !M().canRedo();
  }
  function render() {
    if (!el) return;
    lastSig = sig();
    head();
    const m = M(), t = m.ui.table, cols = visCols(), idx = m.taskIndex(), list = rows(idx), g = m.graph();
    const cl = m.clusters();
    el.querySelector('#tb-cluster').innerHTML = '<option value="">All clusters</option>' + cl.map((c) => '<option value="' + esc(c.color) + '"' + (t.cluster === c.color ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');
    const gb = el.querySelector('#tb-group'); gb.classList.toggle('on', t.group); gb.setAttribute('aria-pressed', String(t.group));
    const names = new Map(cl.map((c) => [c.color, c.name]));
    const body = el.querySelector('#tb-body');
    if (!m.nodes().length) {
      body.innerHTML = '<div class="empty">' + icon('table', 'empty-ic') + '<h3>No nodes yet</h3><p>Add one here, or start on the canvas.</p><div class="btn-row"><button type="button" class="btn primary" data-tb="add">' + icon('plus') + '<span>Add node</span></button><a class="btn" href="#canvas">Open the canvas</a></div></div>';
      el.querySelector('#tb-bulk').hidden = true;
      return;
    }
    const allSel = list.length > 0 && list.every((n) => t.selected.has(n.id));
    const th = (c) => '<th scope="col"' + (t.sort === c.key ? ' aria-sort="' + (t.dir > 0 ? 'ascending' : 'descending') + '"' : '') + '><button type="button" data-sort="' + c.key + '" class="' + (t.sort === c.key ? 'on' : '') + '">' + c.title + (t.sort === c.key ? icon(t.dir > 0 ? 'up' : 'down') : '') + '</button></th>';
    const cell = (n, key, content, cls) => {
      if (t.editing && t.editing.id === n.id && t.editing.key === key) return '<td class="editing" data-key="' + key + '">' + editor(n, key) + '</td>';
      return '<td class="' + (cls || '') + (EDITABLE.includes(key) ? ' editable' : '') + '" data-key="' + key + '">' + content + '</td>';
    };
    const none = '<span class="muted">—</span>';
    const rowHtml = (n) => {
      const p = g.nodeMap.get(g.parent.get(n.id)), tc = m.taskCounts(n.id, idx), href = m.safeUrl(n.linkUrl), hex = m.colorHex(n.color);
      const tds = cols.map((c) => {
        switch (c.key) {
          case 'label': return cell(n, 'label', '<span class="tb-name' + (m.childIds(n.id).length ? ' hub' : '') + '"><i class="dot" style="--c:' + hex + '"></i><span>' + esc(m.title(n) || 'Untitled') + '</span>' + (n.isHub ? '<span class="badge">Root</span>' : '') + '</span>', 'c-title');
          case 'color': return cell(n, 'color', '<span class="type-tag" style="--c:' + hex + '"><i class="dot"></i>' + esc(m.colorName(n.color)) + '</span>');
          case 'parent': return cell(n, 'parent', p ? esc(m.title(p)) : none);
          case 'shape': return cell(n, 'shape', esc(m.shapeName(n.shape)));
          case 'connections': return '<td class="mono">' + (g.degree.get(n.id) || 0) + '</td>';
          case 'tasks': return '<td>' + (tc.total ? '<button type="button" class="status' + (tc.overdue ? ' danger' : tc.open ? '' : ' ok') + '" data-tact="tasks" title="Show these tasks">' + (tc.open ? tc.open + ' open' + (tc.overdue ? ' · ' + tc.overdue + ' late' : '') : 'All done') + '</button>' : none) + '</td>';
          case 'link': return cell(n, 'link', href ? '<a class="tb-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(n.linkUrl) + '</a>' : none);
          case 'position': return cell(n, 'position', 'X ' + Math.round(n.x) + ', Y ' + Math.round(n.y), 'mono muted');
        }
        return '<td></td>';
      }).join('');
      return '<tr class="r' + (t.selected.has(n.id) ? ' sel' : '') + '" data-id="' + esc(n.id) + '">' +
        '<td class="c-check"><input type="checkbox" class="tb-cb" data-tact="select"' + (t.selected.has(n.id) ? ' checked' : '') + ' aria-label="Select ' + esc(m.title(n)) + '"></td>' + tds +
        '<td class="c-acts"><div class="row-acts"><button type="button" class="btn sm ghost" data-tact="task">' + icon('plus') + '<span>Task</span></button><button type="button" class="btn sm ghost" data-tact="locate">' + icon('target') + '<span>Locate</span></button></div></td></tr>';
    };
    let html = '';
    if (!list.length) html = '<tr><td colspan="' + (cols.length + 2) + '" class="tb-none muted">No nodes match.</td></tr>';
    else if (t.group) {
      const groups = new Map();
      list.forEach((n) => { const k = n.color || 'gray'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); });
      groups.forEach((items, key) => {
        const closed = t.collapsedGroups.has(key);
        html += '<tr class="g" data-group="' + esc(key) + '"><td colspan="' + (cols.length + 2) + '"><span class="tb-group' + (closed ? ' closed' : '') + '" style="--c:' + m.colorHex(key) + '">' + icon('chevD', 'chev') + '<i class="dot"></i>' + esc(names.get(key) || m.colorName(key)) + '<span class="count mono">' + items.length + '</span></span></td></tr>';
        if (!closed) items.forEach((n) => { html += rowHtml(n); });
      });
    } else list.forEach((n) => { html += rowHtml(n); });
    body.innerHTML = '<div class="table-wrap"><table class="tbl map-tbl"><thead><tr><th class="c-check"><input type="checkbox" class="tb-cb" id="tb-all" aria-label="Select all rows"' + (allSel ? ' checked' : '') + '></th>' + cols.map(th).join('') + '<th><span class="sr">Actions</span></th></tr></thead><tbody>' + html + '</tbody></table></div>' +
      '<p class="table-foot muted">' + (list.length === m.nodes().length ? m.nodes().length + ' nodes' : list.length + ' of ' + m.nodes().length + ' nodes') + ' · ' + cl.length + ' cluster' + (cl.length === 1 ? '' : 's') + ' · Double-click a cell to edit, Esc to cancel</p>';
    if (t.editing) {
      const inp = body.querySelector('td.editing .cell-input');
      if (inp) { inp.focus(); if (inp.select && inp.tagName !== 'SELECT') inp.select(); } else t.editing = null;
    }
    const bulk = el.querySelector('#tb-bulk');
    bulk.hidden = !t.selected.size;
    if (t.selected.size) bulk.innerHTML = '<span class="bulk-count">' + t.selected.size + ' selected</span>' +
      '<button type="button" class="btn sm" data-bulk="color">' + icon('palette') + '<span>Color</span></button>' +
      '<button type="button" class="btn sm" data-bulk="move">' + icon('parent') + '<span>Move under…</span></button>' +
      '<button type="button" class="btn sm" data-bulk="task">' + icon('check') + '<span>Add a task to each</span></button>' +
      '<button type="button" class="btn sm" data-bulk="show">' + icon('target') + '<span>Show on canvas</span></button>' +
      '<span class="spacer"></span><button type="button" class="btn sm ghost" data-bulk="clear">Clear</button>' +
      '<button type="button" class="btn sm ghost danger" data-bulk="delete">' + icon('trash') + '<span>Delete</span></button>';
  }
  function editor(n, key) {
    const m = M();
    switch (key) {
      case 'label': return '<input class="cell-input" value="' + esc(m.plainLabel(n.label).replace(/\n/g, ' ')) + '" aria-label="Label">';
      case 'color': return '<select class="cell-input" aria-label="Cluster color">' + m.PALETTE.map((c) => '<option value="' + c.key + '"' + (n.color === c.key ? ' selected' : '') + '>' + c.name + '</option>').join('') + '</select>';
      case 'shape': return '<select class="cell-input" aria-label="Shape">' + m.SHAPES.map((s) => '<option value="' + s.key + '"' + ((n.shape || 'pill') === s.key ? ' selected' : '') + '>' + s.name + '</option>').join('') + '</select>';
      case 'link': return '<input class="cell-input" value="' + esc(n.linkUrl) + '" placeholder="https://…" aria-label="URL">';
      case 'position': return '<input class="cell-input mono" value="' + Math.round(n.x) + ', ' + Math.round(n.y) + '" placeholder="x, y" aria-label="Position">';
    }
    return '';
  }
  function commitEdit(cancel) {
    const t = M().ui.table, ed = t.editing;
    if (!ed) return;
    const inp = el && el.querySelector('#tb-body td.editing .cell-input');
    t.editing = null;
    const n = M().getNode(ed.id);
    if (cancel || !inp || !n) return render();
    const v = inp.value, before = JSON.stringify(n), next = Object.assign({}, n);
    if (ed.key === 'label') { if (!v.trim()) { C.toast('A node needs a label'); return render(); } next.label = v.trim(); }
    else if (ed.key === 'color') next.color = v;
    else if (ed.key === 'shape') next.shape = v;
    else if (ed.key === 'link') next.linkUrl = v.trim();
    else if (ed.key === 'position') {
      const mm = v.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
      if (!mm) { C.toast('Use the format: x, y'); return render(); }
      next.x = Math.round(+mm[1]); next.y = Math.round(+mm[2]);
    }
    if (JSON.stringify(next) === before) return render();
    M().pushHistory();
    Object.assign(n, next);
    M().commit(true);
  }
  function wire() {
    const t = M().ui.table, m = M();
    el.addEventListener('click', (e) => {
      const tb = e.target.closest('[data-tb]');
      if (tb) {
        const a = tb.dataset.tb;
        if (a === 'undo') m.undo(); else if (a === 'redo') m.redo(); else if (a === 'add') view.newNode();
      }
    });
    el.querySelector('#tb-q').addEventListener('input', (e) => { t.q = e.target.value; render(); });
    el.querySelector('#tb-cluster').addEventListener('change', (e) => { t.cluster = e.target.value; render(); if (C.refreshChrome) C.refreshChrome(); });
    el.querySelector('#tb-group').addEventListener('click', () => { t.group = !t.group; m.saveUi(); render(); });
    el.querySelector('#tb-cols').addEventListener('click', (e) => {
      m.menu([{ head: 'Show columns' }].concat(COLS.filter((c) => !c.always).map((c) => ({ label: c.title, check: !!t.columns[c.key], run: (on) => { t.columns[c.key] = on; m.saveUi(); render(); } }))), { anchor: e.currentTarget, focus: false });
    });
    const body = el.querySelector('#tb-body');
    body.addEventListener('click', (e) => {
      if (e.target.id === 'tb-all') {
        const list = rows(m.taskIndex());
        if (e.target.checked) list.forEach((n) => t.selected.add(n.id)); else list.forEach((n) => t.selected.delete(n.id));
        return render();
      }
      const s = e.target.closest('[data-sort]');
      if (s) { const k = s.dataset.sort; if (t.sort === k) t.dir = -t.dir; else { t.sort = k; t.dir = 1; } return render(); }
      const grp = e.target.closest('tr.g');
      if (grp) { const k = grp.dataset.group; t.collapsedGroups.has(k) ? t.collapsedGroups.delete(k) : t.collapsedGroups.add(k); return render(); }
      const tr = e.target.closest('tr.r'); if (!tr) return;
      const id = tr.dataset.id, act = e.target.closest('[data-tact]');
      if (!act) return;
      const a = act.dataset.tact;
      if (a === 'select') { act.checked ? t.selected.add(id) : t.selected.delete(id); render(); }
      else if (a === 'task') C.openEditor({ nodeId: id });
      else if (a === 'locate') m.focusNode(id);
      else if (a === 'tasks') { if (C.views.list.filterNode) { C.views.list.filterNode(id); C.go('list'); } }
    });
    body.addEventListener('dblclick', (e) => {
      const td = e.target.closest('td.editable'), tr = e.target.closest('tr.r');
      if (!td || !tr || e.target.closest('a')) return;
      const key = td.dataset.key, id = tr.dataset.id;
      if (key === 'parent') {
        return m.pickNode({ anchor: td, current: m.parentId(id), allowNone: true, noneLabel: 'None (top level)', exclude: new Set([id, ...m.descendantIds(id)]),
          onPick: (pid) => { m.pushHistory(); if (m.setParent(id, pid)) m.commit(true); else m.dropHistory(); } });
      }
      if (t.editing) commitEdit();
      t.editing = { id, key };
      render();
    });
    body.addEventListener('keydown', (e) => {
      if (!e.target.classList.contains('cell-input')) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commitEdit(true); }
      else if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    });
    body.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT' && e.target.classList.contains('cell-input')) commitEdit(); });
    body.addEventListener('focusout', (e) => { if (e.target.classList.contains('cell-input')) setTimeout(() => { if (el && t.editing && !body.contains(document.activeElement)) commitEdit(); }, 0); });
    el.querySelector('#tb-bulk').addEventListener('click', (e) => {
      const b = e.target.closest('[data-bulk]'); if (!b) return;
      const ids = [...t.selected].filter((id) => m.getNode(id));
      if (!ids.length) return;
      const a = b.dataset.bulk;
      if (a === 'color') m.colorPop({ anchor: b }, (c) => { m.pushHistory(); ids.forEach((id) => { m.getNode(id).color = c; }); m.commit(true); C.toast('Recolored ' + ids.length + ' nodes', { action: 'Undo', onAction: m.undo }); });
      else if (a === 'move') {
        const ex = new Set(); ids.forEach((id) => { ex.add(id); m.descendantIds(id).forEach((d) => ex.add(d)); });
        m.pickNode({ anchor: b, allowNone: true, noneLabel: 'None (top level)', exclude: ex, onPick: (pid) => { m.pushHistory(); ids.forEach((id) => m.setParent(id, pid)); m.commit(true); C.toast('Moved ' + ids.length + ' nodes', { action: 'Undo', onAction: m.undo }); } });
      }
      else if (a === 'task') C.openEditor(ids.length === 1 ? { nodeId: ids[0] } : { nodeIds: ids });
      else if (a === 'show') {
        ids.forEach(m.ensureVisible);
        m.ui.selected = new Set(ids);
        m.ui.focusReq = { ids, fit: true, maxZoom: 1.3 };
        C.go('canvas');
      }
      else if (a === 'clear') { t.selected.clear(); render(); }
      else if (a === 'delete') { m.deleteNodes(ids); t.selected.clear(); render(); }
    });
  }
})();
