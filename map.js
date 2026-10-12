/* Cadence — the map: shared core for the Canvas, Outline and Table pages.
   Nodes and edges live in the store (state.map), sync with the account like
   settings do, and tasks link to a node through task.nodeId.
   Per-device view state (pan/zoom, folded branches, hidden clusters, table
   columns) is kept in localStorage only. */
(function () {
  const C = window.Cadence;
  const { esc, icon } = C;
  const S = () => C.store;

  /* ---------------------------------------------------------------- constants */
  const PALETTE = [
    { key: 'red', name: 'Red', hex: '#ef4444' }, { key: 'orange', name: 'Orange', hex: '#f97316' },
    { key: 'amber', name: 'Amber', hex: '#f59e0b' }, { key: 'yellow', name: 'Yellow', hex: '#eab308' },
    { key: 'lime', name: 'Lime', hex: '#84cc16' }, { key: 'green', name: 'Green', hex: '#22c55e' },
    { key: 'emerald', name: 'Emerald', hex: '#10b981' }, { key: 'teal', name: 'Teal', hex: '#14b8a6' },
    { key: 'cyan', name: 'Cyan', hex: '#06b6d4' }, { key: 'blue', name: 'Blue', hex: '#3b82f6' },
    { key: 'indigo', name: 'Indigo', hex: '#6366f1' }, { key: 'violet', name: 'Violet', hex: '#8b5cf6' },
    { key: 'purple', name: 'Purple', hex: '#a855f7' }, { key: 'pink', name: 'Pink', hex: '#ec4899' },
    { key: 'gray', name: 'Gray', hex: '#64748b' }
  ];
  const HEX = Object.fromEntries(PALETTE.map((c) => [c.key, c.hex]));
  const colorHex = (k) => HEX[k] || HEX.gray;
  const colorName = (k) => (PALETTE.find((c) => c.key === k) || { name: k || 'Gray' }).name;
  const SHAPES = [
    { key: 'pill', name: 'Pill', svg: '<svg width="20" height="12" viewBox="0 0 20 12" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="18" height="10" rx="5"/></svg>' },
    { key: 'roundrect', name: 'Rounded', svg: '<svg width="18" height="12" viewBox="0 0 18 12" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="16" height="10" rx="3"/></svg>' },
    { key: 'rect', name: 'Rectangle', svg: '<svg width="18" height="12" viewBox="0 0 18 12" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="16" height="10" rx=".5"/></svg>' },
    { key: 'square', name: 'Square', svg: '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="11" height="11" rx=".5"/></svg>' },
    { key: 'circle', name: 'Circle', svg: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="6"/></svg>' },
    { key: 'diamond', name: 'Diamond', svg: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M7 1l6 6-6 6-6-6z"/></svg>' },
    { key: 'hexagon', name: 'Hexagon', svg: '<svg width="16" height="14" viewBox="0 0 16 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M4 1h8l3 6-3 6H4L1 7z"/></svg>' },
    { key: 'triangle', name: 'Triangle', svg: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M7 1.5l6 11H1z"/></svg>' }
  ];
  const shapeName = (k) => (SHAPES.find((s) => s.key === k) || SHAPES[0]).name;
  const FONT_SIZES = [{ value: '', label: 'Default' }, { value: '11px', label: 'Small' }, { value: '13.5px', label: 'Normal' }, { value: '16px', label: 'Large' }, { value: '20px', label: 'Heading' }];
  const MAP_ROUTES = ['canvas', 'outline', 'table'];
  const MAX_HISTORY = 40;
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  function hexToRgba(hex, a) {
    const h = hex.replace('#', '');
    return 'rgba(' + parseInt(h.substr(0, 2), 16) + ', ' + parseInt(h.substr(2, 2), 16) + ', ' + parseInt(h.substr(4, 2), 16) + ', ' + a + ')';
  }
  function hexLuminance(hex) {
    const h = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ------------------------------------------------------------ per-device UI */
  const UI_KEY = 'cadence.mapui.v1';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch (e) { saved = {}; }
  const ui = {
    collapsed: new Set(saved.collapsed || []),
    hiddenClusters: new Set(saved.hiddenClusters || []),
    view: saved.view && isFinite(saved.view.zoom) ? saved.view : null,
    lastRoute: MAP_ROUTES.includes(saved.lastRoute) ? saved.lastRoute : 'canvas',
    selected: new Set(), selectedEdge: null, mode: 'pan', connectSource: null,
    focusReq: null, _viewSet: !!(saved.view && isFinite(saved.view.zoom)),
    outlineCollapsed: new Set(), outlineFilter: '', outlineFocus: null, outlineEditing: null,
    table: {
      sort: 'label', dir: 1, q: '', cluster: '', group: saved.tableGroup !== false,
      selected: new Set(), collapsedGroups: new Set(), editing: null,
      columns: Object.assign({ parent: true, shape: false, connections: true, tasks: true, link: true, position: false }, saved.tableColumns || {})
    }
  };
  const saveUi = C.debounce(() => {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({
        collapsed: [...ui.collapsed], hiddenClusters: [...ui.hiddenClusters], view: ui.view, lastRoute: ui.lastRoute,
        tableGroup: ui.table.group, tableColumns: ui.table.columns
      }));
    } catch (e) { /* storage blocked */ }
  }, 300);

  /* --------------------------------------------------------------- data access */
  const nodes = () => S().state.map.nodes;
  const edges = () => S().state.map.edges;

  function normalizeNode(n) {
    return Object.assign({}, n, {
      id: String(n.id), label: n.label == null ? '' : String(n.label),
      x: Math.round(Number(n.x) || 0), y: Math.round(Number(n.y) || 0),
      width: Number(n.width) || 0, height: Number(n.height) || 0,
      color: HEX[n.color] ? n.color : 'gray', shape: SHAPES.some((s) => s.key === n.shape) ? n.shape : 'pill',
      fontSize: n.fontSize || '', bgColor: HEX[n.bgColor] ? n.bgColor : '', textColor: n.textColor || '',
      linkUrl: n.linkUrl || '', linkCaption: n.linkCaption || '',
      isBold: !!n.isBold, isItalic: !!n.isItalic, isUnderline: !!n.isUnderline, isHub: !!n.isHub
    });
  }
  const normalizeEdge = (e) => ({ id: String(e.id || C.uid('e')), source: String(e.source), target: String(e.target), directed: !!e.directed });
  const blankNode = (extra) => normalizeNode(Object.assign({ id: C.uid('n'), label: 'New node', x: 0, y: 0, color: 'gray', shape: 'pill' }, extra));

  function plainLabel(raw) {
    if (!raw) return '';
    return String(raw).replace(/<span style="font-size:\s*[^;]+;">(.*?)<\/span>/gi, '$1').replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/<\/?u>/g, '');
  }
  const labelHtml = (raw) => esc(plainLabel(raw)).replace(/\n/g, '<br>');
  const title = (n) => (n ? plainLabel(n.linkCaption || n.label).replace(/\s*\n\s*/g, ' ').trim() : '');
  function safeUrl(url) {
    const u = String(url || '').trim();
    if (!u) return '';
    if (/^(https?:|mailto:)/i.test(u)) return u;
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return '';
    return 'https://' + u;
  }

  /* ------------------------------------------------------------------ graph */
  let localRev = 0, cache = null;
  const rev = () => S().state.mapRev + ':' + localRev;
  function markDirty() { localRev++; }
  function graph() {
    const r = rev();
    if (cache && cache.rev === r) return cache;
    const nodeMap = new Map();
    nodes().forEach((n) => { if (!nodeMap.has(n.id)) nodeMap.set(n.id, n); });
    const children = new Map(), parent = new Map(), degree = new Map();
    edges().forEach((e) => {
      if (!nodeMap.has(e.source) || !nodeMap.has(e.target)) return;
      degree.set(e.source, (degree.get(e.source) || 0) + 1);
      degree.set(e.target, (degree.get(e.target) || 0) + 1);
      if (e.directed) return;
      if (!children.has(e.source)) children.set(e.source, []);
      const list = children.get(e.source);
      if (!list.includes(e.target)) list.push(e.target);
      if (!parent.has(e.target) && e.target !== e.source) parent.set(e.target, e.source);
    });
    cache = { rev: r, nodeMap, children, parent, degree };
    return cache;
  }
  const getNode = (id) => (id ? graph().nodeMap.get(id) : null) || null;
  const childIds = (id) => graph().children.get(id) || [];
  const parentId = (id) => graph().parent.get(id) || null;
  function descendantIds(id) {
    const out = [], seen = new Set([id]), stack = [...childIds(id)];
    while (stack.length) {
      const cur = stack.shift();
      if (seen.has(cur)) continue;
      seen.add(cur); out.push(cur);
      childIds(cur).forEach((c) => { if (!seen.has(c)) stack.push(c); });
    }
    return out;
  }
  function isAncestor(a, id) {
    let cur = parentId(id); const seen = new Set();
    while (cur && !seen.has(cur)) { if (cur === a) return true; seen.add(cur); cur = parentId(cur); }
    return false;
  }
  function primaryRoot() { const ns = nodes(); return ns.find((n) => n.isHub && !parentId(n.id)) || ns.find((n) => n.isHub) || ns[0] || null; }
  function hiddenSet() {
    const hidden = new Set();
    ui.collapsed.forEach((id) => { if (getNode(id)) descendantIds(id).forEach((d) => hidden.add(d)); });
    if (ui.hiddenClusters.size) nodes().forEach((n) => { if (ui.hiddenClusters.has(n.color || 'gray')) hidden.add(n.id); });
    return hidden;
  }
  function boundsOf(list) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    list.forEach((n) => { minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x); minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y); });
    return { minX, maxX, minY, maxY };
  }

  /* ----------------------------------------------------- tasks linked to nodes */
  // only my own tasks link to my map (someone else's task points at their map)
  function taskIndex() {
    const m = new Map();
    S().state.tasks.forEach((t) => {
      if (!t.nodeId || !S().isOwner(t)) return;
      if (!m.has(t.nodeId)) m.set(t.nodeId, []);
      m.get(t.nodeId).push(t);
    });
    return m;
  }
  const tasksFor = (id) => taskIndex().get(id) || [];
  function tasksSig() {
    let s = '';
    S().state.tasks.forEach((t) => { if (t.nodeId) s += t.id + (t.done ? 1 : 0) + (t.due || '') + t.nodeId + t.title + '|'; });
    return s;
  }
  /** { open, overdue } for a node */
  function taskCounts(id, idx) {
    const tk = C.D.todayKey();
    const list = (idx || taskIndex()).get(id) || [];
    const open = list.filter((t) => !t.done);
    return { total: list.length, open: open.length, done: list.length - open.length, overdue: open.filter((t) => t.due && t.due < tk).length };
  }

  /* ---------------------------------------------------------------- history */
  const undoStack = [], redoStack = [];
  const snapshot = () => JSON.stringify({ nodes: nodes(), edges: edges() });
  function pushHistory() {
    const snap = snapshot();
    if (undoStack.length && undoStack[undoStack.length - 1] === snap) return;
    undoStack.push(snap);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
  }
  function restore(snap) {
    const p = JSON.parse(snap);
    S().state.map.nodes = p.nodes; S().state.map.edges = p.edges;
    const ids = new Set(p.nodes.map((n) => n.id));
    ui.selected.forEach((id) => { if (!ids.has(id)) ui.selected.delete(id); });
    ui.selectedEdge = null;
    commit(true);
  }
  function undo() {
    if (!undoStack.length) return C.toast('Nothing to undo on the map');
    redoStack.push(snapshot());
    restore(undoStack.pop());
    C.toast('Undone', { action: 'Redo', onAction: redo, duration: 3000 });
  }
  function redo() {
    if (!redoStack.length) return C.toast('Nothing to redo');
    undoStack.push(snapshot());
    restore(redoStack.pop());
    C.toast('Redone', { duration: 2000 });
  }

  /* ----------------------------------------------------------------- commit */
  let tooBigWarned = false;
  function commit(skipHistory) {
    if (!skipHistory) pushHistory();
    markDirty();
    S().commitMap();
    if (S().mapTooBig() && !tooBigWarned) { tooBigWarned = true; C.toast('Your map is getting very large. Sync may stop above about 3,000 nodes.', { duration: 8000 }); }
    refresh();
  }
  function refresh() {
    prune();
    const r = C.currentRoute && C.currentRoute();
    if (MAP_ROUTES.includes(r) && C.views[r] && C.views[r].render) C.views[r].render();
    if (C.refreshChrome) C.refreshChrome();
  }
  function prune() {
    const g = graph();
    ui.selected.forEach((id) => { if (!g.nodeMap.has(id)) ui.selected.delete(id); });
    ui.table.selected.forEach((id) => { if (!g.nodeMap.has(id)) ui.table.selected.delete(id); });
    if (ui.selectedEdge && !edges().some((e) => e.id === ui.selectedEdge)) ui.selectedEdge = null;
    if (ui.connectSource && !g.nodeMap.has(ui.connectSource)) ui.connectSource = null;
  }

  /* -------------------------------------------------------------- mutations */
  function inheritStyle(from) {
    if (!from) return { color: 'blue', shape: 'pill' };
    return { color: from.isHub ? 'blue' : from.color || 'gray', shape: from.isHub ? 'pill' : from.shape || 'pill', fontSize: from.isHub ? '' : from.fontSize || '', bgColor: from.isHub ? '' : from.bgColor || '', textColor: from.isHub ? '' : from.textColor || '' };
  }
  function placeChild(parent) {
    const kids = childIds(parent.id).map(getNode).filter(Boolean);
    const gp = getNode(parentId(parent.id));
    const base = gp ? Math.atan2(parent.y - gp.y, parent.x - gp.x) : -Math.PI / 2;
    const used = kids.map((k) => Math.atan2(k.y - parent.y, k.x - parent.x));
    let best = base, bestScore = -1;
    for (let i = 0; i < 24; i++) {
      const a = base + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 12);
      if (gp && Math.abs(Math.atan2(Math.sin(a - base), Math.cos(a - base))) > Math.PI * 0.75) continue;
      const score = used.length ? Math.min(...used.map((u) => Math.abs(Math.atan2(Math.sin(a - u), Math.cos(a - u))))) : Math.PI;
      if (score > bestScore + 0.01) { best = a; bestScore = score; }
    }
    return { x: Math.round(parent.x + Math.cos(best) * 170), y: Math.round(parent.y + Math.sin(best) * 170) };
  }
  function freeSpot() {
    const cv = C.views.canvas;
    if (C.currentRoute && C.currentRoute() === 'canvas' && cv && cv.centerWorld) {
      const c = cv.centerWorld();
      return { x: Math.round(c.x + (Math.random() * 40 - 20)), y: Math.round(c.y + (Math.random() * 40 - 20)) };
    }
    const ns = nodes();
    if (!ns.length) return { x: 0, y: 0 };
    const b = boundsOf(ns);
    return { x: Math.round(b.maxX + 220), y: Math.round((b.minY + b.maxY) / 2) };
  }
  /** Create a node (optionally as a child). Selects it. Returns the node. */
  function addNode(o) {
    o = o || {};
    const parent = o.parentId ? getNode(o.parentId) : null;
    const pos = o.pos || (parent ? placeChild(parent) : freeSpot());
    pushHistory();
    if (parent && ui.collapsed.delete(parent.id)) saveUi();
    const node = blankNode(Object.assign({ label: o.label || 'New node', x: Math.round(pos.x), y: Math.round(pos.y) }, inheritStyle(parent || o.styleFrom), o.extra || {}));
    if (o.afterId) {
      const i = nodes().findIndex((n) => n.id === o.afterId);
      nodes().splice(i >= 0 ? i + 1 : nodes().length, 0, node);
    } else nodes().push(node);
    if (parent) {
      const edge = { id: C.uid('e'), source: parent.id, target: node.id, directed: false };
      const idx = o.afterId ? edges().findIndex((e) => !e.directed && e.source === parent.id && e.target === o.afterId) : -1;
      if (idx >= 0) edges().splice(idx + 1, 0, edge); else edges().push(edge);
    }
    ui.selected = new Set([node.id]);
    ui.selectedEdge = null;
    commit(true);
    return node;
  }
  function deleteNodes(ids) {
    const del = new Set(ids);
    if (!del.size) return;
    const linked = S().state.tasks.filter((t) => t.nodeId && del.has(t.nodeId) && !t.done).length;
    const one = del.size === 1 ? title(getNode(ids[0])) : '';
    pushHistory();
    S().state.map.nodes = nodes().filter((n) => !del.has(n.id));
    S().state.map.edges = edges().filter((e) => !del.has(e.source) && !del.has(e.target));
    del.forEach((id) => { ui.selected.delete(id); ui.collapsed.delete(id); ui.table.selected.delete(id); });
    saveUi();
    commit(true);
    C.toast('Deleted ' + (one ? '“' + one + '”' : del.size + ' nodes') + (linked ? '. Its ' + (linked === 1 ? 'task stays' : linked + ' tasks stay') + ' on your list.' : ''), { action: 'Undo', onAction: undo });
  }
  function setParent(id, pid) {
    if (id === pid) return false;
    if (pid && isAncestor(id, pid)) { C.toast('Can’t move a node under its own branch'); return false; }
    S().state.map.edges = edges().filter((e) => !(!e.directed && e.target === id && e.source !== pid));
    if (pid && !edges().some((e) => !e.directed && e.source === pid && e.target === id)) edges().push({ id: C.uid('e'), source: pid, target: id, directed: false });
    return true;
  }
  function connect(src, tgt, directed) {
    const exists = edges().some((e) => directed ? (e.source === src && e.target === tgt && e.directed)
      : (!e.directed && ((e.source === src && e.target === tgt) || (e.source === tgt && e.target === src))));
    if (exists) { C.toast('Those nodes are already connected'); return false; }
    pushHistory();
    edges().push({ id: C.uid('e'), source: src, target: tgt, directed: !!directed });
    commit(true);
    C.toast(directed ? 'Flow added' : 'Nodes connected', { action: 'Undo', onAction: undo, duration: 3000 });
    return true;
  }
  function deleteEdge(id) {
    if (!edges().some((e) => e.id === id)) return;
    pushHistory();
    S().state.map.edges = edges().filter((e) => e.id !== id);
    if (ui.selectedEdge === id) ui.selectedEdge = null;
    commit(true);
    C.toast('Connection removed', { action: 'Undo', onAction: undo });
  }
  function toggleCollapse(id) {
    if (!childIds(id).length) return C.toast('This node has no branch to fold');
    if (ui.collapsed.has(id)) ui.collapsed.delete(id);
    else {
      ui.collapsed.add(id);
      const h = new Set(descendantIds(id));
      ui.selected.forEach((s) => { if (h.has(s)) ui.selected.delete(s); });
    }
    saveUi(); refresh();
  }
  function setAllCollapsed(on) {
    ui.collapsed.clear();
    if (on) {
      nodes().forEach((n) => { if (!n.isHub && childIds(n.id).length) ui.collapsed.add(n.id); });
      const h = hiddenSet();
      ui.selected.forEach((s) => { if (h.has(s)) ui.selected.delete(s); });
    }
    saveUi(); refresh();
    C.toast(on ? 'Folded every branch' : 'Unfolded every branch', { duration: 2200 });
  }
  function tidyBranch(id) {
    const node = getNode(id);
    if (!node) return;
    const kids = childIds(id).map(getNode).filter(Boolean);
    if (!kids.length) return C.toast('Select a node with children to tidy its branch');
    pushHistory();
    const gp = getNode(parentId(id));
    const n = kids.length, radius = 160 + Math.max(0, n - 5) * 16;
    let angles;
    if (!gp) angles = kids.map((_, i) => -Math.PI / 2 + (i * 2 * Math.PI) / n);
    else {
      const base = Math.atan2(node.y - gp.y, node.x - gp.x);
      const spread = Math.min(Math.PI * 1.25, Math.max(Math.PI / 3, (n - 1) * 0.42));
      angles = kids.map((_, i) => (n === 1 ? base : base - spread / 2 + (spread * i) / (n - 1)));
    }
    kids.forEach((k, i) => {
      const dx = Math.round(node.x + Math.cos(angles[i]) * radius) - k.x, dy = Math.round(node.y + Math.sin(angles[i]) * radius) - k.y;
      [k.id, ...descendantIds(k.id)].forEach((d) => { const x = getNode(d); if (x && d !== id) { x.x += dx; x.y += dy; } });
    });
    commit(true);
    C.toast('Branch tidied', { action: 'Undo', onAction: undo });
  }
  function newCluster() {
    const used = new Set(nodes().map((n) => n.color));
    const pick = (PALETTE.find((c) => c.key !== 'gray' && !used.has(c.key)) || PALETTE[Math.floor(Math.random() * 14)]).key;
    let ox = 0, oy = 0;
    if (nodes().length) { const b = boundsOf(nodes()); ox = Math.round(b.maxX + 420); oy = Math.round((b.minY + b.maxY) / 2); }
    pushHistory();
    const hub = blankNode({ label: 'New\nhub', x: ox, y: oy, color: pick, isHub: false, isBold: true });
    const fresh = [hub];
    [[-160, -130], [160, -130], [-160, 130], [160, 130]].forEach(([dx, dy], i) => {
      const c = blankNode({ label: 'Branch ' + (i + 1), x: ox + dx, y: oy + dy, color: pick });
      fresh.push(c);
      edges().push({ id: C.uid('e'), source: hub.id, target: c.id, directed: false });
    });
    nodes().push(...fresh);
    ui.selected = new Set(fresh.map((n) => n.id));
    ui.focusReq = { ids: fresh.map((n) => n.id), fit: true, maxZoom: 1 };
    commit(true);
    if (C.currentRoute() !== 'canvas') C.go('canvas'); else C.views.canvas.consumeFocus();
    C.toast('Created a new ' + colorName(pick).toLowerCase() + ' cluster', { action: 'Undo', onAction: undo });
  }

  /* ---------------------------------------------------------------- clusters */
  function clusters() {
    const g = graph(), map = new Map();
    nodes().forEach((n) => { const k = n.color || 'gray'; if (!map.has(k)) map.set(k, []); map.get(k).push(n); });
    const out = [];
    map.forEach((list, key) => {
      const ids = new Set(list.map((n) => n.id));
      let name = null;
      if (list.length === 1) name = title(list[0]);
      else {
        const hub = list.find((n) => n.isHub || (g.children.get(n.id) || []).some((t) => ids.has(t)));
        if (hub) name = title(hub);
        if (!name) for (const e of edges()) { if (!e.directed && ids.has(e.target) && !ids.has(e.source)) { const p = g.nodeMap.get(e.source); if (p) { name = title(p); break; } } }
      }
      out.push({ color: key, hex: colorHex(key), name: name || title(list[0]) || colorName(key), count: list.length, nodes: list });
    });
    return out;
  }
  function clusterOf(nodeId) { const n = getNode(nodeId); return n ? n.color || 'gray' : null; }
  function toggleClusterHidden(key) {
    if (ui.hiddenClusters.has(key)) ui.hiddenClusters.delete(key); else ui.hiddenClusters.add(key);
    const h = hiddenSet();
    ui.selected.forEach((id) => { if (h.has(id)) ui.selected.delete(id); });
    saveUi(); refresh();
  }
  function recolorCluster(from, to) {
    const list = nodes().filter((n) => (n.color || 'gray') === from);
    if (!list.length || from === to) return;
    pushHistory();
    list.forEach((n) => { n.color = to; });
    if (ui.hiddenClusters.delete(from)) saveUi();
    commit(true);
    C.toast('Cluster recolored ' + colorName(to).toLowerCase(), { action: 'Undo', onAction: undo });
  }
  /* sidebar: the same cluster list drives each map page */
  function clusterActive(key) {
    const r = C.currentRoute();
    if (r === 'outline') return ui.outlineFilter === key;
    if (r === 'table') return ui.table.cluster === key;
    const list = nodes().filter((n) => (n.color || 'gray') === key);
    return !!list.length && list.every((n) => ui.selected.has(n.id)) && ui.selected.size === list.length;
  }
  function clusterClick(key) {
    const r = C.currentRoute();
    if (r === 'outline') { ui.outlineFilter = ui.outlineFilter === key ? '' : key; return refresh(); }
    if (r === 'table') { ui.table.cluster = ui.table.cluster === key ? '' : key; return refresh(); }
    selectCluster(key);
  }
  function selectCluster(key) {
    const list = nodes().filter((n) => (n.color || 'gray') === key);
    if (!list.length) return;
    if (ui.hiddenClusters.delete(key)) saveUi();
    const h = hiddenSet();
    ui.selected = new Set(list.filter((n) => !h.has(n.id)).map((n) => n.id));
    ui.selectedEdge = null;
    ui.focusReq = { ids: list.map((n) => n.id), fit: true, minZoom: 0.6, maxZoom: 1.3 };
    if (C.currentRoute() !== 'canvas') C.go('canvas'); else { C.views.canvas.consumeFocus(); refresh(); }
  }

  /* ------------------------------------------------------------- navigation */
  function ensureVisible(id) {
    let changed = false, cur = parentId(id); const seen = new Set();
    while (cur && !seen.has(cur)) { seen.add(cur); if (ui.collapsed.delete(cur)) changed = true; cur = parentId(cur); }
    const n = getNode(id);
    if (n && ui.hiddenClusters.delete(n.color || 'gray')) changed = true;
    if (changed) saveUi();
  }
  /** Show one node on the canvas, selected and centered */
  function focusNode(id, opts) {
    if (!getNode(id)) return C.toast('That node isn’t on your map any more');
    ensureVisible(id);
    ui.selected = new Set([id]); ui.selectedEdge = null;
    ui.focusReq = Object.assign({ ids: [id], center: true, zoom: 1.2 }, opts || {});
    if (C.currentRoute() !== 'canvas') C.go('canvas'); else { C.views.canvas.consumeFocus(); refresh(); }
  }
  function focusBranch(id) {
    const n = getNode(id); if (!n) return;
    if (!childIds(id).length) return focusNode(id);
    ensureVisible(id);
    if (ui.collapsed.delete(id)) saveUi();
    ui.selected = new Set([id]);
    ui.focusReq = { ids: [id, ...descendantIds(id)], fit: true, minZoom: 0.4, maxZoom: 1.4 };
    if (C.currentRoute() !== 'canvas') C.go('canvas'); else { C.views.canvas.consumeFocus(); refresh(); }
    C.toast('Focused on ' + title(n), { duration: 2000 });
  }
  /** "New node" from the sidebar, FAB or N key: each map page decides where it goes */
  function newNode() {
    const r = C.currentRoute();
    const v = C.views[r];
    if (MAP_ROUTES.includes(r) && v && v.newNode) return v.newNode();
    C.go('canvas');
    setTimeout(() => C.views.canvas.newNode(), 80);
  }
  const nodeIndex = () => nodes().map((n) => ({ id: n.id, title: title(n), color: colorHex(n.color) })).filter((n) => n.title);

  function subnav(r) {
    return '<nav class="map-subnav seg" aria-label="Map views">' + [['canvas', 'Canvas'], ['outline', 'Outline'], ['table', 'Table']].map(([id, l]) =>
      '<a href="#' + id + '" class="seg-btn' + (r === id ? ' on' : '') + '"' + (r === id ? ' aria-current="page"' : '') + '>' + icon(id === 'table' ? 'table' : id) + '<span>' + l + '</span></a>').join('') + '</nav>';
  }

  /* --------------------------------------------------------------- popovers */
  let pop = null;
  function closePop() {
    if (!pop) return;
    const p = pop; pop = null;
    p.el.remove();
    window.removeEventListener('pointerdown', p.out, true);
    window.removeEventListener('keydown', p.key, true);
    window.removeEventListener('resize', closePop);
    if (p.onClose) p.onClose();
  }
  function place(el, o) {
    let left = o.x || 0, top = o.y || 0;
    if (o.anchor) {
      const r = o.anchor.getBoundingClientRect();
      left = r.left; top = r.bottom + 6;
      if (o.matchWidth && el.offsetWidth < r.width) el.style.width = r.width + 'px';
    }
    const w = el.offsetWidth, h = el.offsetHeight;
    if (left + w > innerWidth - 8) left = innerWidth - w - 8;
    if (top + h > innerHeight - 8) top = Math.max(8, o.anchor ? o.anchor.getBoundingClientRect().top - h - 6 : innerHeight - h - 8);
    el.style.left = Math.max(8, left) + 'px';
    el.style.top = Math.max(8, top) + 'px';
  }
  function openPop(html, o) {
    closePop();
    const el = document.createElement('div');
    el.className = 'popover ' + (o.cls || '');
    el.setAttribute('role', o.role || 'dialog');
    el.innerHTML = html;
    document.body.appendChild(el);
    place(el, o);
    requestAnimationFrame(() => el.classList.add('in'));
    const out = (e) => { if (!el.contains(e.target) && !(o.anchor && o.anchor.contains(e.target))) closePop(); };
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); if (o.anchor && o.anchor.focus) o.anchor.focus({ preventScroll: true }); }
      else if (o.onKey) o.onKey(e);
    };
    setTimeout(() => window.addEventListener('pointerdown', out, true), 0);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', closePop);
    pop = { el, out, key, onClose: o.onClose };
    return el;
  }
  /** items: { label, ic, kbd, run, danger, dot, checked, sub } | 'sep' | { head } */
  function menu(items, o) {
    const html = items.map((it, i) => {
      if (it === 'sep') return '<div class="menu-sep"></div>';
      if (it.head) return '<div class="menu-head">' + esc(it.head) + '</div>';
      if (it.check != null) return '<label class="menu-item"><input type="checkbox" data-i="' + i + '"' + (it.check ? ' checked' : '') + '><span>' + esc(it.label) + '</span></label>';
      return '<button type="button" role="menuitem" class="menu-item' + (it.danger ? ' danger' : '') + '" data-i="' + i + '">' +
        (it.dot ? '<i class="dot" style="--c:' + it.dot + '"></i>' : it.ic ? icon(it.ic) : '') + '<span class="menu-l">' + esc(it.label) + '</span>' +
        (it.kbd ? '<kbd>' + esc(it.kbd) + '</kbd>' : '') + (it.after || '') + '</button>';
    }).join('');
    const el = openPop(html, Object.assign({ cls: 'menu', role: 'menu' }, o, {
      onKey(e) {
        const btns = [...el.querySelectorAll('button.menu-item')];
        const i = btns.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); (btns[i + 1] || btns[0]).focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (btns[i - 1] || btns[btns.length - 1]).focus(); }
      }
    }));
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]'); if (!b) return;
      const it = items[+b.dataset.i];
      if (!it.keepOpen) closePop();
      if (it.run) it.run(b, e);
    });
    el.addEventListener('change', (e) => { const cb = e.target.closest('input[data-i]'); if (cb) { const it = items[+cb.dataset.i]; if (it.run) it.run(cb.checked); } });
    const first = el.querySelector('button.menu-item');
    if (first && o.focus !== false) first.focus({ preventScroll: true });
    return el;
  }
  function colorPop(o, onPick) {
    const el = openPop('<div class="swatch-grid">' + PALETTE.map((c) => '<button type="button" class="sw' + (o.current === c.key ? ' on' : '') + '" data-c="' + c.key + '" style="--c:' + c.hex + '" title="' + c.name + '" aria-label="' + c.name + '"></button>').join('') + '</div>', Object.assign({ cls: 'swatch-pop' }, o));
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) { closePop(); onPick(b.dataset.c); } });
  }
  /** Searchable node picker. onPick(id|null) */
  function pickNode(o) {
    const st = { idx: 0, items: [] };
    const el = openPop('<label class="input-wrap sm">' + icon('search') + '<input class="pk-q" placeholder="Search the map" autocomplete="off" aria-label="Search nodes"></label><div class="pk-list" role="listbox"></div>',
      Object.assign({ cls: 'picker', matchWidth: true }, o, {
        onKey(e) {
          if (e.key === 'ArrowDown') { e.preventDefault(); st.idx = Math.min(st.items.length - 1, st.idx + 1); draw(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); st.idx = Math.max(0, st.idx - 1); draw(); }
          else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); choose(st.idx); }
        }
      }));
    const q = el.querySelector('.pk-q'), list = el.querySelector('.pk-list');
    function draw() {
      const v = q.value.toLowerCase().trim();
      const items = [];
      if (o.allowNone && (!v || (o.noneLabel || 'None').toLowerCase().includes(v))) items.push({ id: null, t: o.noneLabel || 'None' });
      nodes().forEach((n) => {
        if (o.exclude && o.exclude.has(n.id)) return;
        const t = title(n) || 'Untitled';
        if (v && !t.toLowerCase().includes(v)) return;
        const p = getNode(parentId(n.id));
        items.push({ id: n.id, t, hex: colorHex(n.color), meta: p ? title(p) : '' });
      });
      if (v) items.sort((a, b) => (a.id === null ? -1 : b.id === null ? 1 : a.t.toLowerCase().indexOf(v) - b.t.toLowerCase().indexOf(v)));
      st.items = items.slice(0, 200);
      st.idx = clamp(st.idx, 0, Math.max(0, st.items.length - 1));
      list.innerHTML = st.items.length ? st.items.map((it, i) =>
        '<button type="button" class="pk-item' + (i === st.idx ? ' on' : '') + (it.id === o.current ? ' current' : '') + '" data-i="' + i + '" role="option">' +
        (it.id === null ? '<i class="dot none"></i>' : '<i class="dot" style="--c:' + it.hex + '"></i>') +
        '<span class="pk-t">' + esc(it.t) + '</span>' + (it.meta ? '<span class="pk-m">' + esc(it.meta) + '</span>' : '') +
        (it.id === o.current ? icon('check') : '') + '</button>').join('') : '<p class="pk-empty">' + (nodes().length ? 'No matching nodes' : 'Your map is empty. Add nodes on the Canvas.') + '</p>';
      const on = list.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    }
    function choose(i) { const it = st.items[i]; if (!it) return; closePop(); o.onPick(it.id); }
    q.addEventListener('input', () => { st.idx = 0; draw(); });
    list.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) choose(+b.dataset.i); });
    draw();
    q.focus();
  }

  /* ----------------------------------------------------------- import, start */
  const LEGACY_KEY = 'mindmap_whiteboard_state_v3';
  function legacyLocal() {
    try {
      const p = JSON.parse(localStorage.getItem(LEGACY_KEY));
      if (p && Array.isArray(p.nodes) && Array.isArray(p.edges) && p.nodes.length) return p;
    } catch (e) { /* none */ }
    return null;
  }
  function parseLocalDT(v) {
    if (!v) return null;
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0)).getTime();
  }
  /** Replace the map with a Workmap backup ({ nodes, edges, tasks }) and add its tasks. */
  function importWorkmap(data) {
    const ns = (data.nodes || []).filter(Boolean).map(normalizeNode);
    const ids = new Set(ns.map((n) => n.id));
    const es = (data.edges || []).filter((e) => e && ids.has(String(e.source)) && ids.has(String(e.target))).map(normalizeEdge);
    const before = snapshot();
    pushHistory();
    S().state.map.nodes = ns; S().state.map.edges = es;
    ui.collapsed.clear(); ui.hiddenClusters.clear(); ui.view = null; ui.selected.clear(); saveUi();
    markDirty();
    S().commitMap();
    // tasks: skip ones already here (same title, node and date), so importing twice is safe
    const have = new Set(S().state.tasks.map((t) => (t.title + '|' + (t.nodeId || '') + '|' + (t.due || '')).toLowerCase()));
    const items = [];
    (data.tasks || []).forEach((t) => {
      if (!t || !String(t.description || '').trim()) return;
      const lines = String(t.description).trim().split(/\r?\n/);
      const ttl = lines.shift().trim().slice(0, 500);
      const due = /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate || '') ? t.dueDate : null;
      const nodeId = ids.has(String(t.nodeId)) ? String(t.nodeId) : null;
      const k = (ttl + '|' + (nodeId || '') + '|' + (due || '')).toLowerCase();
      if (have.has(k)) return;
      have.add(k);
      const notes = [lines.join('\n').trim(), String(t.completionNotes || '').trim()].filter(Boolean).join('\n\n');
      items.push({ id: null, patch: { title: ttl, notes, due, nodeId, done: !!t.completed, doneAt: t.completed ? parseLocalDT(t.completedAt) || Date.now() : null } });
    });
    const prevIds = new Set(S().state.tasks.map((t) => t.id));
    if (items.length) S().importTasks(items, false);
    const added = S().state.tasks.filter((t) => !prevIds.has(t.id)).map((t) => t.id);
    refresh();
    C.toast('Imported ' + ns.length + ' nodes' + (added.length ? ' and ' + added.length + ' tasks' : ''), {
      action: 'Undo', duration: 9000,
      onAction: () => { added.forEach((id) => S().deleteTask(id)); const p = JSON.parse(before); S().state.map.nodes = p.nodes; S().state.map.edges = p.edges; commit(true); }
    });
    return { nodes: ns.length, tasks: added.length };
  }
  /** a small example map; links the example tasks to it */
  function loadExample() {
    const N = (id, label, x, y, color, extra) => normalizeNode(Object.assign({ id, label, x, y, color }, extra || {}));
    const ns = [
      N('ex-me', 'My map', 0, 0, 'gray', { isHub: true }),
      N('ex-work', 'Work', 250, -130, 'blue', { isBold: true }), N('ex-roadmap', 'Q4 roadmap', 470, -230, 'blue'), N('ex-team', 'Team', 500, -110, 'blue'), N('ex-expenses', 'Expenses', 440, 0, 'blue'),
      N('ex-home', 'Home', -250, -130, 'orange', { isBold: true }), N('ex-car', 'Car', -460, -220, 'orange'), N('ex-garage', 'Garage', -490, -100, 'orange'), N('ex-trips', 'Trips', -430, 10, 'orange'),
      N('ex-health', 'Health', -170, 190, 'pink', { isBold: true }), N('ex-running', 'Running', -320, 320, 'pink'), N('ex-dentist', 'Dentist', -80, 340, 'pink'),
      N('ex-learn', 'Learning', 210, 190, 'violet', { isBold: true }), N('ex-ts', 'TypeScript\ncourse', 400, 300, 'violet'), N('ex-reading', 'Reading list', 170, 350, 'violet')
    ];
    const tree = { 'ex-me': ['ex-work', 'ex-home', 'ex-health', 'ex-learn'], 'ex-work': ['ex-roadmap', 'ex-team', 'ex-expenses'], 'ex-home': ['ex-car', 'ex-garage', 'ex-trips'], 'ex-health': ['ex-running', 'ex-dentist'], 'ex-learn': ['ex-ts', 'ex-reading'] };
    const es = [];
    Object.keys(tree).forEach((p) => tree[p].forEach((c) => es.push({ id: C.uid('e'), source: p, target: c, directed: false })));
    es.push({ id: C.uid('e'), source: 'ex-roadmap', target: 'ex-team', directed: true });
    pushHistory();
    S().state.map.nodes = ns; S().state.map.edges = es;
    ui.view = null; ui.selected.clear(); saveUi();
    commit(true);
    const links = [[/roadmap/i, 'ex-roadmap'], [/1:1|priya/i, 'ex-team'], [/expense/i, 'ex-expenses'], [/car reg/i, 'ex-car'], [/garage/i, 'ex-garage'], [/flight|thanksgiving/i, 'ex-trips'], [/run/i, 'ex-running'], [/dentist/i, 'ex-dentist'], [/typescript/i, 'ex-ts'], [/read/i, 'ex-reading'], [/hike/i, 'ex-trips']];
    S().state.tasks.forEach((t) => {
      if (!t.sample || t.nodeId || !S().isOwner(t)) return;
      const l = links.find(([re]) => re.test(t.title));
      if (l) S().updateTask(t.id, { nodeId: l[1] });
    });
  }
  /** first node on an empty map */
  function startBlank() {
    const me = S().me && S().me();
    const name = me && me.name ? me.name.split(' ')[0] : '';
    return addNode({ pos: { x: 0, y: 0 }, label: name ? name + '’s map' : 'My map', extra: { isHub: true, color: 'gray' } });
  }
  function clearMap() {
    if (!nodes().length) return;
    pushHistory();
    S().state.map.nodes = []; S().state.map.edges = [];
    ui.selected.clear(); ui.collapsed.clear(); ui.hiddenClusters.clear(); ui.view = null; saveUi();
    commit(true);
    C.toast('Cleared the map. Your tasks are untouched.', { action: 'Undo', onAction: undo, duration: 8000 });
  }

  /** a .json file: a Workmap backup or a Cadence backup */
  function importFile(file) {
    return file.text().then((text) => {
      let data;
      try { data = JSON.parse(text); } catch (e) { throw new Error(file.name + ' isn’t valid JSON. Choose a backup file.'); }
      if (data && data.app !== 'cadence' && Array.isArray(data.nodes) && Array.isArray(data.edges)) return importWorkmap(data);
      if (data && Array.isArray(data.tasks)) { const r = S().importJSON(text); refresh(); C.toast('Imported ' + r.total + ' tasks' + (data.map ? ' and the map' : '')); return r; }
      throw new Error(file.name + ' has no map in it. Export a backup from Workmap (Export → Download backup) and choose that file.');
    }).catch((err) => { C.toast(err.message || 'Couldn’t read that file', { duration: 8000 }); throw err; });
  }

  /* ----------------------------------------------------------- shared utils */
  const scriptLoads = {};
  function loadScript(src) {
    if (!scriptLoads[src]) {
      scriptLoads[src] = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src; s.onload = res;
        s.onerror = () => { delete scriptLoads[src]; rej(new Error('Couldn’t load ' + src.split('/').pop() + '. Check your connection.')); };
        document.head.appendChild(s);
      });
    }
    return scriptLoads[src];
  }
  function download(href, filename) {
    const a = document.createElement('a'); a.href = href; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function nodeMeta(n) {
    const kids = childIds(n.id).length;
    const p = getNode(parentId(n.id));
    return kids ? 'Branch · ' + descendantIds(n.id).length + ' below' : p ? 'in ' + title(p) : 'Top level';
  }
  /** a node chip for task rows: dot + title, links to the canvas */
  function chip(nodeId, compact) {
    const n = getNode(nodeId);
    if (!n) return '';
    return '<button type="button" class="node-tag' + (compact ? ' compact' : '') + '" data-node-link="' + esc(n.id) + '" title="Show “' + esc(title(n)) + '” on the canvas" style="--c:' + colorHex(n.color) + '"><i class="dot"></i><span>' + esc(title(n) || 'Untitled') + '</span></button>';
  }

  C.map = {
    PALETTE, HEX, SHAPES, FONT_SIZES, MAP_ROUTES, IS_MAC, colorHex, colorName, shapeName, hexToRgba, hexLuminance, clamp,
    ui, saveUi, nodes, edges, normalizeNode, normalizeEdge, blankNode, plainLabel, labelHtml, title, safeUrl,
    graph, getNode, childIds, parentId, descendantIds, isAncestor, primaryRoot, hiddenSet, boundsOf, markDirty, rev,
    taskIndex, tasksFor, tasksSig, taskCounts,
    pushHistory, undo, redo, canUndo: () => undoStack.length > 0, canRedo: () => redoStack.length > 0, dropHistory: () => undoStack.pop(),
    commit, refresh, addNode, deleteNodes, setParent, connect, deleteEdge, toggleCollapse, setAllCollapsed, tidyBranch, newCluster,
    placeChild, inheritStyle, clusters, clusterOf, toggleClusterHidden, recolorCluster, clusterActive, clusterClick, selectCluster,
    ensureVisible, focusNode, focusBranch, newNode, nodeIndex, subnav, nodeMeta, chip,
    openPop, closePop, menu, colorPop, pickNode,
    legacyLocal, importWorkmap, importFile, loadExample, startBlank, clearMap, loadScript, download,
    isMapRoute: (r) => MAP_ROUTES.includes(r)
  };
})();
