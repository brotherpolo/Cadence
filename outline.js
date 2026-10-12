/* Cadence — Outline page: the map as an indented, keyboard-editable list. */
(function () {
  const C = window.Cadence;
  const { esc, icon } = C;
  const M = () => C.map;
  let el = null, lastSig = '';

  const view = (C.views = C.views || {}).outline = {
    title: 'Outline',
    mount(root) {
      el = root;
      M().ui.lastRoute = 'outline'; M().saveUi();
      const mod = M().IS_MAC ? '⌘' : 'Ctrl';
      root.innerHTML = '<section class="page map-page ol-page">' + M().subnav('outline') +
        '<header class="map-head"><div class="map-head-text"><p class="eyebrow">Map</p><h1 class="display">Outline</h1>' +
        '<p class="map-lede muted" id="ol-sub"></p></div>' +
        '<div class="btn-row map-head-acts">' +
        '<button type="button" class="icon-btn" data-ol="undo" title="Undo (' + mod + ' Z)" aria-label="Undo">' + icon('undo') + '</button>' +
        '<button type="button" class="icon-btn" data-ol="redo" title="Redo" aria-label="Redo">' + icon('redo') + '</button>' +
        '<button type="button" class="btn" data-ol="fold">' + icon('fold') + '<span>Fold all</span></button>' +
        '<button type="button" class="btn" data-ol="unfold"><span>Unfold all</span></button>' +
        '<button type="button" class="btn" data-ol="pdf">' + icon('download') + '<span>Export PDF</span></button></div></header>' +
        '<div class="chips scroll-x" id="ol-filters" role="group" aria-label="Filter by cluster"></div>' +
        '<div class="ol-card" id="ol-tree" role="tree" aria-label="Outline"></div>' +
        '<div class="hint-row">' +
        '<span><kbd>↵</kbd> Rename · new sibling</span><span><kbd>Tab</kbd><kbd>⇧Tab</kbd> Indent · outdent</span>' +
        '<span><kbd>Alt ↑</kbd><kbd>Alt ↓</kbd> Move</span><span><kbd>←</kbd><kbd>→</kbd> Fold</span><span><kbd>' + mod + ' ↵</kbd> Show on canvas</span></div>' +
        '</section>';
      wire();
      lastSig = '';
      view.render();
      setTimeout(() => focusRow(M().ui.outlineFocus), 0);
    },
    unmount() { if (M().ui.outlineEditing) finishEdit(true); el = null; },
    update() { if (el && sig() !== lastSig) view.render(); else if (el) head(); },
    render,
    newNode() { const f = M().ui.outlineFocus; newSibling(f && M().getNode(f) ? f : null); },
    key() { return false; },
    exportPDF
  };
  const sig = () => M().rev() + '#' + M().tasksSig() + '#' + M().ui.outlineFilter;

  /* ---------------------------------------------------------------- structure */
  function structure() {
    const g = M().graph(), main = M().primaryRoot(), visited = new Set();
    const walk = (id) => { if (visited.has(id)) return; visited.add(id); M().childIds(id).forEach(walk); };
    if (main) walk(main.id);
    const others = [];
    M().nodes().forEach((n) => { if (visited.has(n.id)) return; if (!g.parent.has(n.id) || !g.nodeMap.has(g.parent.get(n.id))) { others.push(n.id); walk(n.id); } });
    M().nodes().forEach((n) => { if (!visited.has(n.id)) { others.push(n.id); walk(n.id); } }); // cycles
    return { main, others };
  }
  function filterSet() {
    const f = M().ui.outlineFilter;
    if (!f) return null;
    const keep = new Set();
    M().nodes().forEach((n) => {
      if ((n.color || 'gray') !== f) return;
      keep.add(n.id);
      let p = M().parentId(n.id); const guard = new Set();
      while (p && !guard.has(p)) { guard.add(p); keep.add(p); p = M().parentId(p); }
    });
    return keep;
  }
  function rowOrder(ignoreFold) {
    const { main, others } = structure(), keep = filterSet(), rows = [], seen = new Set(), ui = M().ui;
    const walk = (id, depth, parent) => {
      if (seen.has(id)) return;
      seen.add(id);
      if (keep && !keep.has(id)) return;
      rows.push({ id, depth, parent });
      if (!ignoreFold && ui.outlineCollapsed.has(id)) { M().descendantIds(id).forEach((d) => seen.add(d)); return; }
      M().childIds(id).forEach((c) => walk(c, depth + 1, id));
    };
    if (main) walk(main.id, 0, null);
    const mainCount = rows.length;
    others.forEach((id) => walk(id, 0, null));
    return { rows, mainCount };
  }
  function siblingsOf(id) {
    const pid = M().parentId(id);
    if (pid) return M().childIds(pid);
    const { main, others } = structure();
    return [...(main ? [main.id] : []), ...others];
  }

  /* ---------------------------------------------------------------- render */
  function head() {
    if (!el) return;
    const n = M().nodes().length;
    el.querySelector('#ol-sub').textContent = n ? n + ' node' + (n === 1 ? '' : 's') + ' · the same map as the canvas, as a list. Edits show up there right away.' : 'The same map as the canvas, as a list.';
    el.querySelector('[data-ol="undo"]').disabled = !M().canUndo();
    el.querySelector('[data-ol="redo"]').disabled = !M().canRedo();
  }
  function render() {
    if (!el) return;
    lastSig = sig();
    head();
    const box = el.querySelector('#ol-tree'), ui = M().ui, m = M();
    const editInput = box.querySelector('.oedit');
    const draft = editInput && document.activeElement === editInput ? { id: editInput.closest('.orow').dataset.id, value: editInput.value, s: editInput.selectionStart, e: editInput.selectionEnd } : null;
    // filters
    const cl = m.clusters().sort((a, b) => b.count - a.count);
    el.querySelector('#ol-filters').innerHTML = m.nodes().length ? '<button type="button" class="chip' + (!ui.outlineFilter ? ' on' : '') + '" data-filter="">All <span class="mono muted">' + m.nodes().length + '</span></button>' +
      cl.map((c) => '<button type="button" class="chip' + (ui.outlineFilter === c.color ? ' on' : '') + '" data-filter="' + esc(c.color) + '" style="--c:' + c.hex + '"><i class="dot"></i>' + esc(c.name) + '</button>').join('') : '';
    if (!m.nodes().length) {
      box.innerHTML = '<div class="empty ol-empty">' + icon('outline', 'empty-ic') + '<h3>No map yet</h3><p>Add a first item here, or start on the canvas. Both show the same map.</p>' +
        '<div class="btn-row"><button type="button" class="btn primary" data-oact="add-root">' + icon('plus') + '<span>Add an item</span></button><a class="btn" href="#canvas">Open the canvas</a></div></div>';
      return;
    }
    const g = m.graph(), { rows, mainCount } = rowOrder();
    if (!ui.outlineFocus || !g.nodeMap.has(ui.outlineFocus)) ui.outlineFocus = rows.length ? rows[0].id : null;
    const idx = m.taskIndex();
    let html = '';
    rows.forEach((r, i) => {
      if (i === mainCount && mainCount > 0) html += '<div class="osection eyebrow">Not connected to ' + esc(m.title(m.primaryRoot())) + '</div>';
      const n = g.nodeMap.get(r.id), kids = m.childIds(r.id), closed = ui.outlineCollapsed.has(r.id);
      const tc = m.taskCounts(r.id, idx);
      const flows = m.edges().filter((e) => e.directed && e.source === r.id).map((e) => g.nodeMap.get(e.target)).filter(Boolean);
      const editing = ui.outlineEditing === r.id, isRoot = i === 0 && mainCount > 0;
      html += '<div class="orow' + (isRoot ? ' lvl0' : '') + (kids.length && !isRoot ? ' hubbish' : '') + '" data-id="' + esc(r.id) + '" role="treeitem" aria-level="' + (r.depth + 1) + '"' + (kids.length ? ' aria-expanded="' + !closed + '"' : '') + ' tabindex="' + (r.id === ui.outlineFocus ? 0 : -1) + '" style="--d:' + r.depth + '">' +
        (kids.length ? '<button type="button" class="otoggle' + (closed ? ' closed' : '') + '" data-oact="toggle" tabindex="-1" aria-label="' + (closed ? 'Unfold' : 'Fold') + '">' + icon('chevD') + '</button>' : '<span class="oleaf"></span>') +
        (isRoot ? '<span class="oroot-dot"></span>' : '<i class="dot" style="--c:' + m.colorHex(n.color) + '"></i>') +
        (editing ? '<input class="oedit" value="' + esc(m.plainLabel(n.label).replace(/\n/g, ' ⏎ ')) + '" aria-label="Edit label">' : '<span class="olabel" title="Double-click to rename">' + esc(m.title(n) || 'Untitled') + '</span>') +
        (kids.length ? '<span class="ocount mono">' + (closed ? '+' + m.descendantIds(r.id).length : kids.length) + '</span>' : '') +
        (tc.open ? '<button type="button" class="otasks' + (tc.overdue ? ' late' : '') + '" data-oact="tasks" tabindex="-1" title="Show these tasks">' + icon('check') + tc.open + '</button>' : '') +
        flows.slice(0, 1).map((f) => '<span class="otag-flow">⇢ ' + esc(m.title(f)) + '</span>').join('') +
        '<span class="oactions">' +
        '<button type="button" data-oact="add" tabindex="-1" title="Add child">' + icon('plus') + '<span>Add</span></button>' +
        '<button type="button" data-oact="task" tabindex="-1" title="Add task">' + icon('check') + '<span>Task</span></button>' +
        '<button type="button" data-oact="locate" tabindex="-1" title="Show on canvas (' + (m.IS_MAC ? '⌘' : 'Ctrl') + '+Enter)">' + icon('target') + '<span>Locate</span></button>' +
        '<button type="button" data-oact="delete" class="danger" tabindex="-1" title="Delete (Del)" aria-label="Delete">' + icon('trash') + '</button></span></div>';
    });
    html += '<button type="button" class="oadd" data-oact="add-root">' + icon('plus') + '<span>Add item</span></button>';
    if (!rows.length && ui.outlineFilter) html = '<p class="group-empty">No nodes in this cluster.</p>' + html;
    box.innerHTML = html;
    if (ui.outlineEditing) {
      const inp = box.querySelector('.oedit');
      if (inp) {
        const same = draft && draft.id === ui.outlineEditing;
        if (same) inp.value = draft.value;
        inp.focus({ preventScroll: true });
        if (same) inp.setSelectionRange(draft.s, draft.e); else inp.select();
        inp.closest('.orow').scrollIntoView({ block: 'nearest' });
      } else ui.outlineEditing = null;
    } else if (box.contains(document.activeElement) || document.activeElement === document.body) focusRow(ui.outlineFocus, false);
  }
  function focusRow(id, scroll) {
    if (!id || !el) return;
    M().ui.outlineFocus = id;
    const box = el.querySelector('#ol-tree');
    box.querySelectorAll('.orow').forEach((r) => { r.tabIndex = r.dataset.id === id ? 0 : -1; });
    const row = box.querySelector('.orow[data-id="' + CSS.escape(id) + '"]');
    if (row) { row.focus({ preventScroll: true }); if (scroll !== false) row.scrollIntoView({ block: 'nearest' }); }
  }

  /* ---------------------------------------------------------------- editing */
  function startEdit(id) { M().ui.outlineEditing = id; M().ui.outlineFocus = id; render(); }
  function readEdit() { const inp = el && el.querySelector('#ol-tree .oedit'); return inp ? inp.value.replace(/\s*⏎\s*/g, '\n').trim() : null; }
  /** apply a pending rename as its own undo step, without saving yet */
  function flushEdit() {
    const id = M().ui.outlineEditing;
    if (!id) return false;
    const v = readEdit(), n = M().getNode(id);
    if (!n || !v || v === M().plainLabel(n.label)) return false;
    M().pushHistory();
    n.label = v;
    return true;
  }
  function finishEdit(quiet) {
    const changed = flushEdit();
    M().ui.outlineEditing = null;
    if (changed) M().commit(true); else if (!quiet) render();
  }
  function newSibling(afterId) {
    const m = M();
    flushEdit();
    const pid = afterId ? m.parentId(afterId) : null, ref = afterId ? m.getNode(afterId) : null;
    const node = m.addNode({ parentId: pid, afterId, label: 'New item', styleFrom: ref, pos: pid ? null : ref ? { x: ref.x + 220, y: ref.y + 60 } : null });
    m.ui.outlineEditing = node.id; m.ui.outlineFocus = node.id;
    render();
  }
  function addChild(pid) {
    const m = M();
    flushEdit();
    const node = m.addNode({ parentId: pid, label: 'New item' });
    m.ui.outlineCollapsed.delete(pid);
    m.ui.outlineEditing = node.id; m.ui.outlineFocus = node.id;
    render();
  }
  function indent(id) {
    const sibs = siblingsOf(id), i = sibs.indexOf(id);
    if (i <= 0) return C.toast('Nothing above to indent under', { duration: 2000 });
    const np = sibs[i - 1], m = M();
    flushEdit();
    m.pushHistory();
    if (!m.setParent(id, np)) { m.dropHistory(); return; }
    m.ui.outlineCollapsed.delete(np);
    m.commit(true);
  }
  function outdent(id) {
    const m = M(), pid = m.parentId(id);
    if (!pid) return C.toast('Already at the top level', { duration: 2000 });
    const gp = m.parentId(pid);
    flushEdit();
    m.pushHistory();
    C.store.state.map.edges = m.edges().filter((e) => !(!e.directed && e.target === id));
    if (gp) {
      const edge = { id: C.uid('e'), source: gp, target: id, directed: false };
      const i = m.edges().findIndex((e) => !e.directed && e.source === gp && e.target === pid);
      if (i >= 0) m.edges().splice(i + 1, 0, edge); else m.edges().push(edge);
    }
    m.commit(true);
  }
  function move(id, dir) {
    const m = M(), pid = m.parentId(id), sibs = siblingsOf(id), i = sibs.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= sibs.length) return;
    const other = sibs[j];
    flushEdit();
    m.pushHistory();
    if (pid) {
      const a = m.edges().findIndex((e) => !e.directed && e.source === pid && e.target === id), b = m.edges().findIndex((e) => !e.directed && e.source === pid && e.target === other);
      if (a < 0 || b < 0) { m.dropHistory(); return; }
      const es = m.edges(); [es[a], es[b]] = [es[b], es[a]];
    } else {
      const ns = m.nodes(), a = ns.findIndex((n) => n.id === id), b = ns.findIndex((n) => n.id === other);
      [ns[a], ns[b]] = [ns[b], ns[a]];
    }
    m.commit(true);
  }
  function neighbour(id) {
    const { rows } = rowOrder(), i = rows.findIndex((r) => r.id === id), desc = new Set(M().descendantIds(id));
    for (let j = i + 1; j < rows.length; j++) if (!desc.has(rows[j].id)) return rows[j].id;
    return i > 0 ? rows[i - 1].id : null;
  }
  function showTasks(id) { if (C.views.list.filterNode) { C.views.list.filterNode(id); C.go('list'); } }

  function wire() {
    const box = el.querySelector('#ol-tree'), ui = M().ui;
    el.querySelector('.map-head-acts').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ol]'); if (!b) return;
      const a = b.dataset.ol;
      if (a === 'undo') M().undo();
      else if (a === 'redo') M().redo();
      else if (a === 'fold') { M().nodes().forEach((n) => { if (M().childIds(n.id).length) ui.outlineCollapsed.add(n.id); }); const r = M().primaryRoot(); if (r) ui.outlineCollapsed.delete(r.id); render(); }
      else if (a === 'unfold') { ui.outlineCollapsed.clear(); render(); }
      else if (a === 'pdf') exportPDF();
    });
    el.querySelector('#ol-filters').addEventListener('click', (e) => { const b = e.target.closest('[data-filter]'); if (!b) return; ui.outlineFilter = b.dataset.filter; render(); if (C.refreshChrome) C.refreshChrome(); });
    box.addEventListener('click', (e) => {
      const row = e.target.closest('.orow'), act = e.target.closest('[data-oact]');
      if (act && act.dataset.oact === 'add-root') { newSibling(null); return; }
      if (!row) return;
      const id = row.dataset.id;
      if (act) {
        e.stopPropagation();
        const a = act.dataset.oact;
        if (a === 'toggle') { ui.outlineCollapsed.has(id) ? ui.outlineCollapsed.delete(id) : ui.outlineCollapsed.add(id); ui.outlineFocus = id; render(); }
        else if (a === 'add') addChild(id);
        else if (a === 'task') C.openEditor({ nodeId: id });
        else if (a === 'tasks') showTasks(id);
        else if (a === 'locate') M().focusNode(id);
        else if (a === 'delete') { ui.outlineFocus = neighbour(id); M().deleteNodes([id]); }
        return;
      }
      if (ui.outlineEditing && ui.outlineEditing !== id) finishEdit();
      if (!e.target.closest('.oedit')) focusRow(id);
    });
    box.addEventListener('dblclick', (e) => { const row = e.target.closest('.orow'); if (row && !e.target.closest('[data-oact]')) startEdit(row.dataset.id); });
    box.addEventListener('focusout', (e) => {
      if (e.target.classList.contains('oedit')) setTimeout(() => { if (el && ui.outlineEditing && !box.contains(document.activeElement)) finishEdit(); }, 0);
    });
    box.addEventListener('keydown', (e) => {
      const row = e.target.closest('.orow'); if (!row) return;
      const id = row.dataset.id, editing = e.target.classList.contains('oedit'), mod = e.ctrlKey || e.metaKey;
      if (editing) {
        if (e.key === 'Enter' && mod) { e.preventDefault(); finishEdit(); M().focusNode(id); }
        else if (e.key === 'Enter') { e.preventDefault(); newSibling(id); }
        else if (e.key === 'Tab') { e.preventDefault(); e.shiftKey ? outdent(id) : indent(id); }
        else if (e.key === 'Escape') { e.preventDefault(); ui.outlineEditing = null; render(); focusRow(id); }
        else if (e.key === 'ArrowUp' && e.altKey) { e.preventDefault(); move(id, -1); }
        else if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); move(id, 1); }
        e.stopPropagation();
        return;
      }
      if (e.target !== row) return;
      const { rows } = rowOrder(), i = rows.findIndex((r) => r.id === id);
      if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); move(id, 1); }
      else if (e.key === 'ArrowUp' && e.altKey) { e.preventDefault(); move(id, -1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (rows[i + 1]) focusRow(rows[i + 1].id); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (rows[i - 1]) focusRow(rows[i - 1].id); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (ui.outlineCollapsed.has(id)) { ui.outlineCollapsed.delete(id); render(); } else if (rows[i + 1] && rows[i + 1].parent === id) focusRow(rows[i + 1].id); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); if (M().childIds(id).length && !ui.outlineCollapsed.has(id)) { ui.outlineCollapsed.add(id); render(); } else if (rows[i] && rows[i].parent) focusRow(rows[i].parent); }
      else if (e.key === 'Enter' && mod) { e.preventDefault(); M().focusNode(id); }
      else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(id); }
      else if (e.key === 'Tab') { e.preventDefault(); e.shiftKey ? outdent(id) : indent(id); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); ui.outlineFocus = neighbour(id); M().deleteNodes([id]); }
      else return;
      e.stopPropagation();
    });
  }

  /* ---------------------------------------------------------------- PDF */
  function exportPDF() {
    const m = M();
    if (!m.nodes().length) return C.toast('Nothing to export yet');
    C.toast('Preparing the PDF…', { duration: 3000 });
    m.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js').then(() => {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
      const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), mg = 48;
      const clean = (s) => String(s).replace(/[^\x20-\x7E -ÿ‘’“”–—•…]/g, '');
      let y = mg;
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(22); pdf.setTextColor(18, 23, 38);
      pdf.text('Outline', mg, y + 8); y += 26;
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(122, 131, 153);
      const f = m.ui.outlineFilter;
      pdf.text(clean(C.F.long.format(new Date()) + ' · ' + m.nodes().length + ' nodes' + (f ? ' · ' + (m.clusters().find((c) => c.color === f) || {}).name + ' cluster' : '')), mg, y); y += 22;
      const { rows, mainCount } = rowOrder();
      const idx = m.taskIndex();
      rows.forEach((r, i) => {
        if (i === mainCount && mainCount > 0) {
          y += 8; if (y > H - mg) { pdf.addPage(); y = mg; }
          pdf.setDrawColor(220, 225, 236); pdf.line(mg, y, W - mg, y); y += 16;
          pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(122, 131, 153); pdf.text('NOT CONNECTED', mg, y); y += 14;
        }
        const n = m.getNode(r.id), root = i === 0 && mainCount > 0, kids = m.childIds(r.id).length;
        const x = mg + r.depth * 18, size = root ? 13 : 11;
        pdf.setFont('helvetica', root || kids ? 'bold' : 'normal'); pdf.setFontSize(size);
        const tc = m.taskCounts(r.id, idx);
        const tail = (tc.open ? tc.open + ' open task' + (tc.open === 1 ? '' : 's') : '') + (m.ui.outlineCollapsed.has(r.id) && kids ? (tc.open ? ' · ' : '') + '+' + m.descendantIds(r.id).length + ' folded' : '');
        const lines = pdf.splitTextToSize(clean(m.title(n) || 'Untitled'), W - mg - (x + 12) - (tail ? 90 : 0));
        const lh = size * 1.35;
        if (y + lines.length * lh > H - mg) { pdf.addPage(); y = mg; }
        const hex = root ? '#121726' : m.colorHex(n.color);
        pdf.setFillColor(parseInt(hex.substr(1, 2), 16), parseInt(hex.substr(3, 2), 16), parseInt(hex.substr(5, 2), 16));
        pdf.circle(x + 3, y - size * 0.32, root ? 4 : 3, 'F');
        pdf.setTextColor(18, 23, 38);
        pdf.text(lines, x + 12, y);
        if (tail) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(tc.overdue ? 209 : 122, tc.overdue ? 52 : 131, tc.overdue ? 56 : 153); pdf.text(tail, W - mg, y, { align: 'right' }); }
        y += lines.length * lh + 4;
      });
      pdf.save('Cadence outline ' + C.D.todayKey() + '.pdf');
      C.toast('Saved the outline as a PDF');
    }).catch((err) => C.toast('Couldn’t export the PDF. ' + (err.message || '')));
  }
})();
