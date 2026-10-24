/* Cadence — Canvas page: the map as a zoomable board of nodes and connections. */
(function () {
  const C = window.Cadence;
  const { esc, icon } = C;
  const S = () => C.store;
  const M = () => C.map;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const POLY = { diamond: '50,1 99,50 50,99 1,50', hexagon: '24,1 76,1 99,50 76,99 24,99 1,50', triangle: '50,1 99,99 1,99' };
  const HINTS = { connect: 'Connect: click two nodes to link them · Esc to finish', 'connect-directed': 'Flow: click the source, then the target · Esc to finish' };

  let root = null, ac = null, R = {}; // R: element refs
  let renderedEdges = [], boardHidden = new Set(), lastSig = '', dragging = false, pendingRender = false;
  let V = { x: 0, y: 0, zoom: 1 };
  const st = { panning: false, spacePan: false, panStart: { x: 0, y: 0 }, marquee: false, mStart: null, mBase: null, dragStart: null, starts: new Map(), pointer: null };
  const insp = { sig: '', applyBranch: false, pushed: false, suppress: false };

  const view = (C.views = C.views || {}).canvas = {
    title: 'Canvas',
    mount(el) {
      root = el;
      ac = new AbortController();
      const ui = M().ui;
      ui.lastRoute = 'canvas'; M().saveUi();
      el.innerHTML =
        '<section class="cv" id="cv" aria-label="Map canvas">' +
        '<div class="cv-vp" id="cv-vp"><div class="cv-world" id="cv-world"><svg class="cv-svg" id="cv-svg" aria-hidden="true"><g id="cv-hull"></g><g id="cv-edges"></g></svg><div class="cv-nodes" id="cv-nodes"></div></div><div class="cv-marquee" id="cv-marquee"></div></div>' +
        '<header class="cv-head">' +
        '<div class="cv-title"><span class="eyebrow">Map</span><h1>Canvas</h1><span class="cv-count mono" id="cv-count"></span></div>' +
        '<div class="cv-head-acts">' +
        '<button type="button" class="icon-btn" id="cv-undo" title="Undo (' + (M().IS_MAC ? '⌘' : 'Ctrl+') + 'Z)" aria-label="Undo">' + icon('undo') + '</button>' +
        '<button type="button" class="icon-btn" id="cv-redo" title="Redo (' + (M().IS_MAC ? '⌘⇧' : 'Ctrl+') + (M().IS_MAC ? 'Z' : 'Y') + ')" aria-label="Redo">' + icon('redo') + '</button>' +
        '<button type="button" class="icon-btn cv-heat-btn" id="cv-heatbtn" title="Color nodes by…" aria-label="Color nodes by a measure" aria-haspopup="menu">' + icon('heat') + '</button>' +
        '<button type="button" class="icon-btn cv-clusters-btn" id="cv-clusters" title="Clusters" aria-label="Clusters">' + icon('cluster') + '</button>' +
        '<button type="button" class="icon-btn" id="cv-more" title="More" aria-label="More canvas actions" aria-haspopup="menu">' + icon('more') + '</button>' +
        '</div></header>' +
        M().subnav('canvas') +
        '<div class="cv-hint" id="cv-hint" hidden></div>' +
        '<div class="cv-quickbar" id="cv-qb" hidden>' +
        '<button type="button" data-qa="child" title="Add child (Tab)" aria-label="Add child">' + icon('plus') + '</button>' +
        '<button type="button" data-qa="task" title="Add task" aria-label="Add task">' + icon('check') + '</button>' +
        '<button type="button" data-qa="collapse" title="Fold or unfold (.)" aria-label="Fold or unfold branch">' + icon('fold') + '</button>' +
        '<button type="button" data-qa="focus" title="Focus branch (F)" aria-label="Focus branch">' + icon('target') + '</button>' +
        '<button type="button" data-qa="delete" class="danger" title="Delete (Del)" aria-label="Delete node">' + icon('trash') + '</button></div>' +
        '<button type="button" class="cv-edgechip" id="cv-edge" hidden>' + icon('x') + 'Remove connection</button>' +
        '<div class="cv-tools" id="cv-tools" role="toolbar" aria-label="Canvas tools">' +
        '<div class="seg mini">' +
        '<button type="button" class="seg-btn" data-mode="select" title="Select & box-select (V)" aria-label="Select">' + icon('cursor') + '</button>' +
        '<button type="button" class="seg-btn" data-mode="pan" title="Pan (H, or hold Space)" aria-label="Pan">' + icon('hand') + '</button>' +
        '<button type="button" class="seg-btn" data-mode="connect" title="Connect two nodes (C)" aria-label="Connect">' + icon('connect') + '</button>' +
        '<button type="button" class="seg-btn" data-mode="connect-directed" title="Dotted flow (A)" aria-label="Flow">' + icon('flow') + '</button></div>' +
        '<span class="cv-sep"></span>' +
        '<button type="button" class="icon-btn" id="cv-focus" title="Focus selected branch (F)" aria-label="Focus">' + icon('target') + '</button>' +
        '<button type="button" class="icon-btn" id="cv-tidy" title="Tidy selected branch" aria-label="Tidy branch">' + icon('tidy') + '</button>' +
        '<button type="button" class="icon-btn" id="cv-all" title="Select all (' + (M().IS_MAC ? '⌘' : 'Ctrl+') + 'A)" aria-label="Select all">' + icon('selectAll') + '</button>' +
        '<span class="cv-sep"></span>' +
        '<button type="button" class="btn primary sm cv-add" id="cv-add" title="Add node (N)">' + icon('plus') + '<span>Add node</span></button></div>' +
        '<div class="cv-minimap" id="cv-mm" title="Minimap: click or drag to move"><canvas id="cv-mm-c" width="336" height="216"></canvas><div class="cv-mm-view" id="cv-mm-v"></div></div>' +
        '<div class="cv-zoom">' +
        '<button type="button" class="icon-btn sm" id="cv-zout" aria-label="Zoom out">' + icon('minus') + '</button>' +
        '<button type="button" class="cv-ztext mono" id="cv-zt" title="Reset to 100%">100%</button>' +
        '<button type="button" class="icon-btn sm" id="cv-zin" aria-label="Zoom in">' + icon('plus') + '</button>' +
        '<button type="button" class="icon-btn sm" id="cv-fit" title="Fit the map" aria-label="Fit the map">' + icon('fit') + '</button></div>' +
        '<div class="cv-heat" id="cv-heat" hidden></div>' +
        '<aside class="cv-insp" id="cv-insp" aria-label="Node details" hidden><div class="cv-insp-body" id="cv-insp-body"></div></aside>' +
        '<div class="cv-empty" id="cv-empty" hidden></div>' +
        '</section>';
      ['cv', 'cv-vp', 'cv-world', 'cv-svg', 'cv-hull', 'cv-edges', 'cv-nodes', 'cv-marquee', 'cv-count', 'cv-undo', 'cv-redo', 'cv-hint', 'cv-qb', 'cv-edge', 'cv-tools', 'cv-mm', 'cv-mm-c', 'cv-mm-v', 'cv-zt', 'cv-insp', 'cv-insp-body', 'cv-empty', 'cv-heat', 'cv-heatbtn']
        .forEach((id) => { R[id.replace('cv-', '').replace(/-(\w)/g, (m, c) => c.toUpperCase())] = el.querySelector('#' + id); });
      V = ui.view || { x: 0, y: 0, zoom: 1 };
      ui.view = V;
      wire();
      wireInspector();
      setMode(ui.mode === 'select' ? 'select' : 'pan', true);
      lastSig = '';
      view.render();
      applyTransform();
      requestAnimationFrame(() => {
        if (!root) return;
        if (ui.focusReq) view.consumeFocus();
        else if (!M().ui._viewSet) { fitDiagram(); M().ui._viewSet = true; }
        drawMinimap();
      });
    },
    unmount() {
      if (ac) ac.abort();
      ac = null; root = null; R = {};
      M().closePop();
      if (dragging) { dragging = false; S().setMapBusy(false); }
    },
    update() {
      if (!root) return;
      if (dragging) { pendingRender = true; return; }
      if (sig() !== lastSig) view.render();
      else { renderHead(); renderInspector(); }
    },
    render() {
      if (!root) return;
      lastSig = sig();
      renderBoard();
      renderHead();
      renderEmpty();
      renderHeat();
      renderInspector();
    },
    centerWorld() { const r = vpRect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2); },
    consumeFocus() {
      const req = M().ui.focusReq;
      if (!req || !root) return;
      M().ui.focusReq = null;
      view.render();
      const list = req.ids.map(M().getNode).filter(Boolean);
      if (!list.length) return;
      if (req.fit) fitNodes(list, { minZoom: req.minZoom || 0.3, maxZoom: req.maxZoom || 1.3 });
      else {
        const n = list[0], r = vpRect(), z = req.zoom || Math.max(V.zoom, 1);
        const insW = !R.insp.hidden && innerWidth >= 900 ? R.insp.offsetWidth + 24 : 0;
        V.zoom = z; V.x = (r.width - insW) / 2 - n.x * z; V.y = r.height / 2 - n.y * z;
        applyTransform();
      }
      M().ui._viewSet = true;
    },
    newNode() { const n = M().addNode({ pos: lastPointerWorld() || undefined }); requestAnimationFrame(() => openEditorFor(n.id, true)); },
    key: onKey,
    exportPNG
  };

  const sig = () => M().rev() + '#' + M().tasksSig() + '#' + JSON.stringify(M().ui.heat) + '#' + document.documentElement.getAttribute('data-theme') + (matchMedia('(prefers-color-scheme: dark)').matches ? 'd' : 'l');

  /* -------------------------------------------------------------- geometry */
  function vpRect() {
    const r = R.vp ? R.vp.getBoundingClientRect() : null;
    if (r && r.width > 0) return r;
    return { left: 0, top: 0, width: innerWidth, height: innerHeight };
  }
  function toWorld(sx, sy) { const r = vpRect(); return { x: (sx - r.left - V.x) / V.zoom, y: (sy - r.top - V.y) / V.zoom }; }
  function toScreen(wx, wy) { const r = vpRect(); return { x: wx * V.zoom + V.x + r.left, y: wy * V.zoom + V.y + r.top }; }
  const toLocal = (wx, wy) => ({ x: wx * V.zoom + V.x, y: wy * V.zoom + V.y });
  let overlayRaf = 0;
  function scheduleOverlay() { cancelAnimationFrame(overlayRaf); overlayRaf = requestAnimationFrame(() => { if (!root) return; positionQuickbar(); positionEdgeChip(); updateMinimapView(); }); }
  function applyTransform() {
    if (!R.world) return;
    R.world.style.transform = 'translate(' + V.x + 'px,' + V.y + 'px) scale(' + V.zoom + ')';
    R.zt.textContent = Math.round(V.zoom * 100) + '%';
    R.vp.style.backgroundSize = (22 * V.zoom) + 'px ' + (22 * V.zoom) + 'px';
    R.vp.style.backgroundPosition = V.x + 'px ' + V.y + 'px';
    scheduleOverlay();
    M().saveUi();
  }
  function fitNodes(list, o) {
    o = o || {};
    if (!list.length) return;
    const r = vpRect(), b = M().boundsOf(list);
    const insW = R.insp && !R.insp.hidden && innerWidth >= 900 ? R.insp.offsetWidth + 24 : 0;
    const w = r.width - insW;
    const spanX = Math.max(160, b.maxX - b.minX + (o.padX || 240)), spanY = Math.max(160, b.maxY - b.minY + (o.padY || 260));
    const z = M().clamp(Math.min(w / spanX, r.height / spanY), o.minZoom || 0.3, o.maxZoom || 1.2);
    V.zoom = z; V.x = w / 2 - ((b.minX + b.maxX) / 2) * z; V.y = r.height / 2 - ((b.minY + b.maxY) / 2) * z;
    applyTransform();
  }
  function fitDiagram() { fitNodes(M().nodes().filter((n) => !boardHidden.has(n.id)), { maxZoom: 1.1 }); }
  function resetZoom() { const r = vpRect(), c = toWorld(r.left + r.width / 2, r.top + r.height / 2); V.zoom = 1; V.x = r.width / 2 - c.x; V.y = r.height / 2 - c.y; applyTransform(); }
  function zoomBy(f, mx, my) {
    const r = vpRect();
    if (mx == null) { mx = r.width / 2; my = r.height / 2; }
    const old = V.zoom, z = M().clamp(old * f, 0.2, 2.5);
    V.x = mx - (mx - V.x) * (z / old); V.y = my - (my - V.y) * (z / old); V.zoom = z;
    applyTransform();
  }
  function lastPointerWorld() {
    if (!st.pointer) return null;
    const r = vpRect(), s = toScreen(st.pointer.x, st.pointer.y);
    if (s.x < r.left || s.y < r.top || s.x > r.left + r.width || s.y > r.top + r.height) return null;
    return st.pointer;
  }
  function curve(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy) || 1, c = Math.min(30, d * 0.12);
    const cx = (x1 + x2) / 2 + (-dy / d) * c, cy = (y1 + y2) / 2 + (dx / d) * c;
    return { d: 'M ' + x1 + ' ' + y1 + ' Q ' + cx + ' ' + cy + ' ' + x2 + ' ' + y2, mx: 0.25 * x1 + 0.5 * cx + 0.25 * x2, my: 0.25 * y1 + 0.5 * cy + 0.25 * y2 };
  }

  /* ------------------------------------------------------------ heat overlay */
  const DAY = 864e5;
  const avgOf = (ts, f) => { const v = ts.map(f).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const HEAT = [
    { id: 'open', label: 'Open tasks', unit: '', calc: (ts) => ts.filter((t) => !t.done).length },
    { id: 'overdue', label: 'Overdue tasks', unit: '', calc: (ts, c) => ts.filter((t) => !t.done && t.due && t.due < c.tk).length },
    { id: 'late', label: 'Average days late', unit: 'd', calc: (ts, c) => avgOf(ts, (t) => C.charts.NUMS.late.get(t, c)) },
    { id: 'age', label: 'Average age of open tasks', unit: 'd', calc: (ts, c) => avgOf(ts.filter((t) => !t.done), (t) => C.charts.NUMS.age.get(t, c)) },
    { id: 'onTime', label: '% done on time', unit: '%', good: true, fixed: 100, calc: (ts) => avgOf(ts, (t) => C.charts.NUMS.onTime.get(t)) },
    { id: 'recent', label: 'Done in the last 4 weeks', unit: '', good: true, calc: (ts, c) => ts.filter((t) => t.done && t.doneAt && t.doneAt > c.now - 28 * DAY).length }
  ];
  const heatDef = () => HEAT.find((h) => h.id === M().ui.heat.metric) || null;
  const hex2rgb = (h) => { h = String(h).trim().replace('#', ''); if (h.length === 3) h = h.split('').map((x) => x + x).join(''); return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16) || 0); };
  const tok = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888888';
  /** Map nodeId → { v, txt } for the chosen measure, plus the scale */
  function heatValues() {
    const h = heatDef();
    if (!h || !C.charts) return null;
    const ctx = { tk: C.D.todayKey(), now: Date.now() }, idx = M().taskIndex(), rollup = !!M().ui.heat.rollup;
    const out = new Map(); let max = 0;
    M().nodes().forEach((n) => {
      let ts = idx.get(n.id) || [];
      if (rollup) M().descendantIds(n.id).forEach((d) => { const x = idx.get(d); if (x) ts = ts.concat(x); });
      if (!ts.length) return;
      const v = h.calc(ts, ctx);
      if (v == null) return;
      out.set(n.id, { v, txt: C.charts.fmt(v, h.unit) });
      max = Math.max(max, v);
    });
    const hi = h.fixed || Math.max(max, 1);
    const surf = hex2rgb(tok('--surface')), hot = hex2rgb(tok(h.good ? '--ok' : '--danger'));
    const mix = (t) => surf.map((c, i) => Math.round(c + (hot[i] - c) * t));
    return { h, out, hi, max, color: (v) => { const t = 0.1 + 0.9 * Math.max(0, Math.min(1, v / hi)); const rgb = mix(t); return { fill: 'rgb(' + rgb.join(', ') + ')', dark: (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 < 0.55 }; }, lo: 'rgb(' + mix(0.1).join(', ') + ')', top: 'rgb(' + mix(1).join(', ') + ')' };
  }
  function renderHeat() {
    const box = R.heat, h = heatDef();
    R.heatbtn.classList.toggle('on', !!h);
    R.cv.classList.toggle('heat-on', !!h);
    if (!h || !M().nodes().length) { box.hidden = true; return; }
    const hv = heatValues();
    box.hidden = false;
    box.innerHTML = '<div class="cv-heat-head"><span class="eyebrow">Color by</span>' +
      '<button type="button" class="cv-heat-pick" data-heat-menu aria-haspopup="menu">' + esc(h.label) + icon('chevD') + '</button>' +
      '<button type="button" class="icon-btn sm" data-heat-off aria-label="Turn off coloring" title="Turn off">' + icon('x') + '</button></div>' +
      '<div class="cv-heat-bar" style="background:linear-gradient(90deg,' + hv.lo + ',' + hv.top + ')"></div>' +
      '<div class="cv-heat-scale mono"><span>' + C.charts.fmt(0, h.unit) + '</span><span>' + C.charts.fmt(hv.hi, h.unit) + (h.fixed ? '' : hv.max ? '' : '') + '</span></div>' +
      '<label class="cv-heat-roll"><input type="checkbox" data-heat-rollup' + (M().ui.heat.rollup ? ' checked' : '') + '>Include each branch below a node</label>' +
      '<p class="fine">' + (hv.out.size ? hv.out.size + ' node' + (hv.out.size === 1 ? '' : 's') + ' measured. Faded nodes have no tasks to measure.' : 'No nodes have tasks to measure yet. Link tasks to nodes to see colors.') + '</p>';
  }
  function heatMenu(anchor) {
    const cur = M().ui.heat.metric;
    M().menu([{ head: 'Color nodes by' }].concat(HEAT.map((h) => ({ label: h.label, ic: cur === h.id ? 'check' : null, dot: cur === h.id ? null : (h.good ? tok('--ok') : tok('--danger')), run: () => setHeat(h.id) })))
      .concat(cur ? ['sep', { label: 'Turn off', ic: 'x', run: () => setHeat(null) }] : []), { anchor });
  }
  function setHeat(metric, rollup) {
    const ui = M().ui;
    ui.heat = { metric, rollup: rollup == null ? ui.heat.rollup : rollup };
    M().saveUi();
    view.render();
  }

  /* -------------------------------------------------------------- rendering */
  function selectedBranch() {
    const ui = M().ui;
    if (ui.selected.size !== 1) return null;
    const id = [...ui.selected][0];
    if (!M().childIds(id).length || ui.collapsed.has(id)) return null;
    const desc = M().descendantIds(id).filter((d) => !boardHidden.has(d));
    return desc.length ? { id, set: new Set(desc) } : null;
  }
  function renderBoard() {
    const g = M().graph(), ui = M().ui;
    boardHidden = M().hiddenSet();
    const branch = selectedBranch();
    R.edges.textContent = '';
    renderedEdges = [];
    const ef = document.createDocumentFragment();
    M().edges().forEach((edge) => {
      const s = g.nodeMap.get(edge.source), t = g.nodeMap.get(edge.target);
      if (!s || !t || boardHidden.has(s.id) || boardHidden.has(t.id)) return;
      const d = curve(s.x, s.y, t.x, t.y).d;
      const grp = document.createElementNS(SVG_NS, 'g'); grp.setAttribute('class', 'edge-g');
      const hit = document.createElementNS(SVG_NS, 'path'); hit.setAttribute('d', d); hit.setAttribute('class', 'edge-hit');
      const line = document.createElementNS(SVG_NS, 'path'); line.setAttribute('d', d);
      let cls = 'edge-line';
      if (edge.directed) cls += ' directed';
      else if (branch && (edge.source === branch.id || branch.set.has(edge.source)) && branch.set.has(edge.target)) cls += ' branch';
      if (ui.selectedEdge === edge.id) cls += ' selected';
      line.setAttribute('class', cls);
      hit.addEventListener('mousedown', (e) => e.stopPropagation());
      hit.addEventListener('click', (e) => { e.stopPropagation(); selectEdge(edge.id); });
      hit.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
      hit.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); selectEdge(edge.id); });
      grp.appendChild(hit); grp.appendChild(line); ef.appendChild(grp);
      renderedEdges.push({ edge, hit, line });
    });
    R.edges.appendChild(ef);
    sizeSvg();
    R.nodes.textContent = '';
    const nf = document.createDocumentFragment();
    const idx = M().taskIndex(), hv = heatValues();
    M().nodes().forEach((n) => { if (!boardHidden.has(n.id)) nf.appendChild(buildNode(n, branch, idx, hv)); });
    R.nodes.appendChild(nf);
    R.hull.textContent = '';
    if (branch) drawHull(branch);
    positionQuickbar(); positionEdgeChip(); drawMinimap();
  }
  function buildNode(node, branch, idx, hv) {
    const ui = M().ui, m = M();
    const el = document.createElement('div');
    el.id = 'node-' + node.id;
    el.dataset.id = node.id;
    const shape = m.SHAPES.some((s) => s.key === node.shape) ? node.shape : 'pill';
    const kids = m.childIds(node.id);
    const cls = ['node', 'node-shape-' + shape];
    if (node.isHub) cls.push('is-root'); else if (kids.length) cls.push('is-hubbish');
    if (ui.selected.has(node.id)) cls.push('selected');
    if (ui.connectSource === node.id) cls.push('connect-source');
    if (branch && branch.set.has(node.id)) cls.push('in-branch');
    el.className = cls.join(' ');
    el.style.left = node.x + 'px'; el.style.top = node.y + 'px';
    const hex = m.colorHex(node.color);
    el.style.setProperty('--nc', hex);
    el.style.setProperty('--border', m.hexToRgba(hex, 0.5));
    el.style.setProperty('--borderHover', m.hexToRgba(hex, 0.95));
    const bg = node.bgColor && m.HEX[node.bgColor];
    let tc = '';
    if (bg) { el.classList.add('has-fill'); el.style.setProperty('--fill', bg); el.style.setProperty('--border', bg); tc = m.hexLuminance(bg) < 0.45 ? '#ffffff' : '#17181c'; }
    if (node.textColor === 'black') tc = '#000000'; else if (node.textColor === 'white') tc = '#ffffff';
    if (tc) el.style.color = tc;
    if (POLY[shape]) {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'node-poly'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none');
      const p = document.createElementNS(SVG_NS, 'polygon'); p.setAttribute('points', POLY[shape]); svg.appendChild(p); el.appendChild(svg);
    }
    const dot = document.createElement('span'); dot.className = 'ndot'; el.appendChild(dot);
    const label = document.createElement('span'); label.className = 'nlabel';
    if (node.fontSize) label.style.fontSize = node.fontSize;
    if (node.isBold) label.style.fontWeight = '700';
    if (node.isItalic) label.style.fontStyle = 'italic';
    if (node.isUnderline) label.style.textDecoration = 'underline';
    const href = m.safeUrl(node.linkUrl);
    if (href) {
      label.innerHTML = '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + m.labelHtml(node.linkCaption || node.label) + icon('external') + '</a>';
      const a = label.firstChild;
      a.addEventListener('mousedown', (e) => e.stopPropagation());
      a.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    } else label.innerHTML = m.labelHtml(node.label) || '&nbsp;';
    el.appendChild(label);
    if (node.width) el.style.width = node.width + 'px';
    if (node.height) el.style.height = node.height + 'px';
    if (node.width || node.height) el.style.maxWidth = 'none';
    const tc2 = m.taskCounts(node.id, idx);
    if (hv) {
      const hx = hv.out.get(node.id);
      if (hx) {
        const c = hv.color(hx.v);
        el.classList.add('heat'); el.classList.remove('has-fill');
        el.style.setProperty('--fill', c.fill);
        el.style.color = c.dark ? '#ffffff' : '#17181c';
        el.title = hv.h.label + ': ' + hx.txt;
        if (hx.v) {
          const b = document.createElement('span');
          b.className = 'node-badge heat-val';
          b.textContent = hx.txt;
          el.appendChild(b);
        }
      } else el.classList.add('heat-none');
    } else if (tc2.open) {
      const b = document.createElement('span');
      b.className = 'node-badge' + (tc2.overdue ? ' late' : '');
      b.textContent = tc2.open;
      b.title = tc2.open + ' open task' + (tc2.open === 1 ? '' : 's') + (tc2.overdue ? ', ' + tc2.overdue + ' overdue' : '');
      el.appendChild(b);
    }
    if (kids.length) {
      const fold = document.createElement('button');
      const col = ui.collapsed.has(node.id);
      fold.type = 'button';
      fold.className = 'fold-btn' + (col ? ' collapsed' : '');
      fold.title = col ? 'Unfold branch (.)' : 'Fold branch (.)';
      fold.setAttribute('aria-label', fold.title);
      fold.textContent = col ? '+' + m.descendantIds(node.id).length : '–';
      ['mousedown', 'touchstart', 'dblclick'].forEach((ev) => fold.addEventListener(ev, (e) => e.stopPropagation(), { passive: true }));
      fold.addEventListener('click', (e) => { e.stopPropagation(); m.toggleCollapse(node.id); });
      el.appendChild(fold);
    }
    const h = document.createElement('div'); h.className = 'resize-handle'; h.title = 'Resize'; el.appendChild(h);
    resizeEvents(h, node, el);
    nodeEvents(el, node);
    return el;
  }
  function sizeSvg() {
    const vis = M().nodes().filter((n) => !boardHidden.has(n.id));
    if (!vis.length) return;
    const b = M().boundsOf(vis), pad = 600;
    const x = Math.floor(b.minX - pad), y = Math.floor(b.minY - pad), w = Math.ceil(b.maxX - b.minX + pad * 2), h = Math.ceil(b.maxY - b.minY + pad * 2);
    Object.assign(R.svg.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    R.svg.setAttribute('width', w); R.svg.setAttribute('height', h); R.svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    [R.edges, R.hull].forEach((gr) => gr.setAttribute('transform', 'translate(' + -x + ' ' + -y + ')'));
  }
  function drawHull(branch) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    [branch.id, ...branch.set].forEach((id) => {
      const n = M().getNode(id), el = R.nodes.querySelector('#node-' + CSS.escape(id));
      if (!n || !el) return;
      const w = el.offsetWidth / 2, h = el.offsetHeight / 2;
      minX = Math.min(minX, n.x - w); maxX = Math.max(maxX, n.x + w); minY = Math.min(minY, n.y - h); maxY = Math.max(maxY, n.y + h);
    });
    if (!isFinite(minX)) return;
    const p = 26;
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('class', 'hull');
    rect.setAttribute('x', minX - p); rect.setAttribute('y', minY - p - 14);
    rect.setAttribute('width', maxX - minX + p * 2); rect.setAttribute('height', maxY - minY + p * 2 + 14); rect.setAttribute('rx', 22);
    R.hull.appendChild(rect);
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('class', 'hull-label'); t.setAttribute('x', minX - p + 16); t.setAttribute('y', minY - p + 4);
    t.textContent = (M().title(M().getNode(branch.id)) + ' · ' + branch.set.size).toUpperCase();
    R.hull.appendChild(t);
  }
  function updateEdges() {
    const g = M().graph();
    renderedEdges.forEach(({ edge, hit, line }) => {
      const s = g.nodeMap.get(edge.source), t = g.nodeMap.get(edge.target);
      if (!s || !t) return;
      const d = curve(s.x, s.y, t.x, t.y).d;
      hit.setAttribute('d', d); line.setAttribute('d', d);
    });
  }
  /** selection-only refresh: classes in place, so a double-click survives */
  function updateSelection() {
    const ui = M().ui, branch = selectedBranch();
    R.nodes.querySelectorAll('.node').forEach((el) => {
      const id = el.dataset.id;
      el.classList.toggle('selected', ui.selected.has(id));
      el.classList.toggle('connect-source', ui.connectSource === id);
      el.classList.toggle('in-branch', !!(branch && branch.set.has(id)));
    });
    renderedEdges.forEach(({ edge, line }) => {
      line.classList.toggle('branch', !edge.directed && !!branch && (edge.source === branch.id || branch.set.has(edge.source)) && branch.set.has(edge.target));
      line.classList.toggle('selected', ui.selectedEdge === edge.id);
    });
    R.hull.textContent = '';
    if (branch) drawHull(branch);
    positionQuickbar(); positionEdgeChip(); renderInspector();
    if (C.refreshChrome) C.refreshChrome();
  }
  function renderHead() {
    const n = M().nodes().length;
    R.count.textContent = n ? n + ' node' + (n === 1 ? '' : 's') + ' · ' + M().clusters().length + ' cluster' + (M().clusters().length === 1 ? '' : 's') : '';
    R.undo.disabled = !M().canUndo(); R.redo.disabled = !M().canRedo();
  }
  function renderEmpty() {
    const empty = !M().nodes().length;
    R.cv.classList.toggle('is-empty', empty);
    R.empty.hidden = !empty;
    if (!empty) return;
    const legacy = M().legacyLocal();
    R.empty.innerHTML = '<div class="cv-empty-card">' + icon('canvas', 'empty-ic') +
      '<h2>Start your map</h2><p class="muted">Lay out projects, people and ideas as connected nodes, then link tasks to them. The Outline and Table show the same map.</p>' +
      '<div class="cv-empty-acts">' +
      '<button type="button" class="btn primary" data-empty="blank">' + icon('plus') + '<span>Add a first node</span></button>' +
      '<button type="button" class="btn" data-empty="example">' + icon('sparkle') + '<span>Use an example map</span></button>' +
      '<label class="btn" for="cv-import">' + icon('upload') + '<span>Import a Workmap backup</span></label><input id="cv-import" type="file" accept="application/json,.json" class="sr">' +
      (legacy ? '<button type="button" class="btn" data-empty="legacy">' + icon('download') + '<span>Bring in Workmap from this browser (' + legacy.nodes.length + ' nodes)</span></button>' : '') +
      '</div></div>';
  }
  function positionQuickbar() {
    const ui = M().ui, qb = R.qb;
    if (!qb) return;
    const show = ui.selected.size === 1 && !dragging && ui.mode !== 'connect' && ui.mode !== 'connect-directed';
    if (!show) { qb.hidden = true; return; }
    const id = [...ui.selected][0], n = M().getNode(id), el = R.nodes.querySelector('#node-' + CSS.escape(id));
    if (!n || !el) { qb.hidden = true; return; }
    const p = toLocal(n.x, n.y - el.offsetHeight / 2);
    qb.hidden = false;
    qb.style.left = p.x + 'px'; qb.style.top = (p.y - 12) + 'px';
    const kids = M().childIds(id).length > 0;
    qb.querySelector('[data-qa="collapse"]').style.display = kids ? '' : 'none';
    qb.querySelector('[data-qa="focus"]').style.display = kids ? '' : 'none';
  }
  function positionEdgeChip() {
    const ui = M().ui, chip = R.edge;
    if (!chip) return;
    const e = ui.selectedEdge && M().edges().find((x) => x.id === ui.selectedEdge);
    const s = e && M().getNode(e.source), t = e && M().getNode(e.target);
    if (!e || !s || !t) { chip.hidden = true; return; }
    const m = curve(s.x, s.y, t.x, t.y), p = toLocal(m.mx, m.my);
    chip.hidden = false; chip.style.left = p.x + 'px'; chip.style.top = (p.y - 26) + 'px';
  }

  /* ---------------------------------------------------------------- minimap */
  let mmX = null;
  function drawMinimap() {
    const cv = R.mmC;
    if (!cv) return;
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const vis = M().nodes().filter((n) => !boardHidden.has(n.id));
    if (!vis.length) { mmX = null; updateMinimapView(); return; }
    const b = M().boundsOf(vis), pad = 120;
    const minX = b.minX - pad, minY = b.minY - pad, maxX = b.maxX + pad, maxY = b.maxY + pad;
    const scale = Math.min(W / (maxX - minX), H / (maxY - minY));
    const ox = (W - (maxX - minX) * scale) / 2, oy = (H - (maxY - minY) * scale) / 2;
    mmX = { minX, minY, scale, ox, oy, W, H };
    const css = getComputedStyle(root);
    ctx.strokeStyle = css.getPropertyValue('--line-strong').trim() || '#bbb';
    ctx.lineWidth = 1.2; ctx.beginPath();
    renderedEdges.forEach(({ edge }) => {
      const s = M().getNode(edge.source), t = M().getNode(edge.target);
      if (!s || !t) return;
      ctx.moveTo(ox + (s.x - minX) * scale, oy + (s.y - minY) * scale);
      ctx.lineTo(ox + (t.x - minX) * scale, oy + (t.y - minY) * scale);
    });
    ctx.stroke();
    const ink = css.getPropertyValue('--ink').trim() || '#000';
    vis.forEach((n) => {
      const x = ox + (n.x - minX) * scale, y = oy + (n.y - minY) * scale;
      ctx.fillStyle = n.isHub ? ink : M().colorHex(n.color);
      const w = n.isHub ? 16 : 11, h = n.isHub ? 9 : 7;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h / 2, w, h, 3); else ctx.rect(x - w / 2, y - h / 2, w, h);
      ctx.fill();
    });
    updateMinimapView();
  }
  function updateMinimapView() {
    const box = R.mmV, mm = R.mm;
    if (!box || !mm) return;
    if (!mmX || !mm.clientWidth) { box.style.display = 'none'; return; }
    const r = vpRect();
    const tl = { x: -V.x / V.zoom, y: -V.y / V.zoom }, br = { x: (r.width - V.x) / V.zoom, y: (r.height - V.y) / V.zoom };
    const { minX, minY, scale, ox, oy, W } = mmX, k = mm.clientWidth / W, cl = M().clamp;
    const x1 = cl((ox + (tl.x - minX) * scale) * k, 0, mm.clientWidth), y1 = cl((oy + (tl.y - minY) * scale) * k, 0, mm.clientHeight);
    const x2 = cl((ox + (br.x - minX) * scale) * k, 0, mm.clientWidth), y2 = cl((oy + (br.y - minY) * scale) * k, 0, mm.clientHeight);
    box.style.display = x2 - x1 < 2 || y2 - y1 < 2 ? 'none' : 'block';
    Object.assign(box.style, { left: x1 + 'px', top: y1 + 'px', width: (x2 - x1) + 'px', height: (y2 - y1) + 'px' });
  }
  function minimapPanTo(cx, cy) {
    if (!mmX) return;
    const rect = R.mm.getBoundingClientRect(), k = mmX.W / R.mm.clientWidth;
    const wx = ((cx - rect.left) * k - mmX.ox) / mmX.scale + mmX.minX, wy = ((cy - rect.top) * k - mmX.oy) / mmX.scale + mmX.minY;
    const r = vpRect();
    V.x = r.width / 2 - wx * V.zoom; V.y = r.height / 2 - wy * V.zoom;
    applyTransform();
  }

  /* -------------------------------------------------------------- selection */
  function selectEdge(id) {
    const ui = M().ui;
    if (ui.mode === 'connect' || ui.mode === 'connect-directed') return;
    ui.selectedEdge = ui.selectedEdge === id ? null : id;
    ui.selected.clear();
    updateSelection();
  }
  function clearSelection() {
    const ui = M().ui;
    if (!ui.selected.size && !ui.selectedEdge && !ui.connectSource) return;
    ui.selected.clear(); ui.selectedEdge = null; ui.connectSource = null;
    updateSelection();
  }
  function selectAll() {
    const vis = M().nodes().filter((n) => !boardHidden.has(n.id));
    M().ui.selected = new Set(vis.map((n) => n.id)); M().ui.selectedEdge = null;
    updateSelection();
    C.toast('Selected all ' + vis.length + ' nodes', { duration: 2000 });
  }
  function setMode(mode, quiet) {
    const ui = M().ui;
    ui.mode = mode; ui.connectSource = null;
    root.querySelectorAll('#cv-tools [data-mode]').forEach((b) => { b.classList.toggle('on', b.dataset.mode === mode); b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); });
    R.vp.classList.toggle('mode-select', mode === 'select');
    R.vp.classList.toggle('mode-connect', mode === 'connect' || mode === 'connect-directed');
    R.hint.textContent = HINTS[mode] || ''; R.hint.hidden = !HINTS[mode];
    if (!quiet) { updateSelection(); positionQuickbar(); }
  }
  const selectedNodes = () => [...M().ui.selected].map(M().getNode).filter(Boolean);

  /* ------------------------------------------------------------ node events */
  function nodeEvents(el, node) {
    let down = false, moved = false, sx = 0, sy = 0, was = false, additive = false, lastTap = 0;
    const ui = M().ui;
    const onDown = (cx, cy, add) => {
      M().closePop();
      if (ui.mode === 'connect' || ui.mode === 'connect-directed') { connectClick(node.id); return false; }
      down = true; moved = false; sx = cx; sy = cy; additive = add;
      was = ui.selected.has(node.id);
      if (add) ui.selected.add(node.id);
      else if (!was) { ui.selected.clear(); ui.selected.add(node.id); }
      ui.selectedEdge = null;
      R.nodes.querySelectorAll('.node').forEach((x) => x.classList.toggle('selected', ui.selected.has(x.dataset.id)));
      st.dragStart = toWorld(cx, cy);
      st.starts.clear();
      ui.selected.forEach((id) => { const n = M().getNode(id); if (n) st.starts.set(id, { x: n.x, y: n.y }); });
      return true;
    };
    const onMove = (cx, cy) => {
      if (!down) return;
      if (!moved && Math.hypot(cx - sx, cy - sy) > 3) {
        moved = true; dragging = true; S().setMapBusy(true);
        M().pushHistory();
        R.qb.hidden = true; R.hull.textContent = '';
      }
      if (!moved) return;
      const w = toWorld(cx, cy), dx = w.x - st.dragStart.x, dy = w.y - st.dragStart.y;
      st.starts.forEach((s0, id) => {
        const n = M().getNode(id); if (!n) return;
        n.x = Math.round(s0.x + dx); n.y = Math.round(s0.y + dy);
        const e = R.nodes.querySelector('#node-' + CSS.escape(id));
        if (e) { e.style.left = n.x + 'px'; e.style.top = n.y + 'px'; }
      });
      updateEdges();
    };
    const onUp = () => {
      if (!down) return;
      down = false;
      if (moved) {
        dragging = false; pendingRender = false;
        M().commit(true); // save first, so a change that arrived mid-drag can't undo the move
        S().setMapBusy(false);
      } else {
        if (additive && was) ui.selected.delete(node.id);
        else if (!additive) ui.selected = new Set([node.id]);
        updateSelection();
      }
    };
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('.resize-handle, .fold-btn, a')) return;
      e.stopPropagation();
      if (!onDown(e.clientX, e.clientY, e.shiftKey || e.ctrlKey || e.metaKey)) return;
      const mm = (ev) => onMove(ev.clientX, ev.clientY);
      const mu = () => { removeEventListener('mousemove', mm); removeEventListener('mouseup', mu); onUp(); };
      addEventListener('mousemove', mm); addEventListener('mouseup', mu);
    });
    el.addEventListener('dblclick', (e) => { if (e.target.closest('.fold-btn, a')) return; e.stopPropagation(); e.preventDefault(); openEditorFor(node.id); });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!ui.selected.has(node.id)) { ui.selected = new Set([node.id]); ui.selectedEdge = null; updateSelection(); }
      nodeMenu(node.id, e.clientX, e.clientY);
    });
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1 || e.target.closest('.resize-handle, .fold-btn, a')) return;
      e.stopPropagation();
      const t = e.touches[0], now = Date.now();
      if (now - lastTap < 300) { e.preventDefault(); lastTap = 0; openEditorFor(node.id); return; }
      lastTap = now;
      if (!onDown(t.clientX, t.clientY, false)) return;
      const tm = (ev) => { if (ev.touches.length === 1) { ev.preventDefault(); onMove(ev.touches[0].clientX, ev.touches[0].clientY); } };
      const te = (ev) => { if (ev.cancelable) ev.preventDefault(); removeEventListener('touchmove', tm); removeEventListener('touchend', te); onUp(); };
      addEventListener('touchmove', tm, { passive: false }); addEventListener('touchend', te, { passive: false });
    }, { passive: false });
  }
  function resizeEvents(h, node, el) {
    let on = false, sx = 0, sy = 0, sw = 0, sh = 0;
    const down = (cx, cy) => { on = true; sx = cx; sy = cy; sw = node.width || el.offsetWidth; sh = node.height || el.offsetHeight; M().pushHistory(); dragging = true; S().setMapBusy(true); };
    const move = (cx, cy) => {
      if (!on) return;
      const n = M().getNode(node.id) || node;
      const w = Math.max(64, Math.round(sw + (cx - sx) / V.zoom)), hh = Math.max(36, Math.round(sh + (cy - sy) / V.zoom));
      n.width = w; n.height = hh;
      el.style.width = w + 'px'; el.style.height = hh + 'px'; el.style.maxWidth = 'none';
      updateEdges();
    };
    const up = () => { if (!on) return; on = false; dragging = false; M().commit(true); S().setMapBusy(false); };
    h.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation(); down(e.clientX, e.clientY);
      const mm = (ev) => move(ev.clientX, ev.clientY);
      const mu = () => { removeEventListener('mousemove', mm); removeEventListener('mouseup', mu); up(); };
      addEventListener('mousemove', mm); addEventListener('mouseup', mu);
    });
    h.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      e.stopPropagation(); down(e.touches[0].clientX, e.touches[0].clientY);
      const tm = (ev) => { if (ev.touches.length === 1) { ev.preventDefault(); move(ev.touches[0].clientX, ev.touches[0].clientY); } };
      const te = () => { removeEventListener('touchmove', tm); removeEventListener('touchend', te); up(); };
      addEventListener('touchmove', tm, { passive: false }); addEventListener('touchend', te);
    }, { passive: false });
  }
  function connectClick(id) {
    const ui = M().ui;
    if (!ui.connectSource) { ui.connectSource = id; updateSelection(); R.hint.textContent = ui.mode === 'connect-directed' ? 'Now click the target node · Esc to stop' : 'Now click the node to connect to · Esc to stop'; R.hint.hidden = false; }
    else if (ui.connectSource === id) { ui.connectSource = null; updateSelection(); }
    else { const src = ui.connectSource; ui.connectSource = null; R.hint.textContent = HINTS[ui.mode] || ''; if (!M().connect(src, id, ui.mode === 'connect-directed')) updateSelection(); }
  }
  function addSibling() {
    const ui = M().ui;
    if (ui.selected.size !== 1) return view.newNode();
    const id = [...ui.selected][0], pid = M().parentId(id), n = M().getNode(id);
    const node = pid ? M().addNode({ parentId: pid, afterId: id }) : M().addNode({ pos: { x: n.x + 200, y: n.y }, styleFrom: n });
    requestAnimationFrame(() => openEditorFor(node.id, true));
  }
  function addChild(id) { const node = M().addNode({ parentId: id }); requestAnimationFrame(() => openEditorFor(node.id, true)); }
  function openEditorFor(id, selectAll) {
    if (!M().getNode(id)) return;
    M().ui.selected = new Set([id]); M().ui.selectedEdge = null;
    updateSelection();
    renderInspector(true);
    const ta = root && root.querySelector('#insp-label');
    if (ta) { ta.focus(); if (selectAll) ta.select(); else ta.setSelectionRange(ta.value.length, ta.value.length); }
  }

  /* -------------------------------------------------------------- menus */
  function nodeMenu(id, x, y) {
    const n = M().getNode(id), ui = M().ui;
    if (!n) return;
    if (ui.selected.size > 1) {
      return M().menu([
        { head: ui.selected.size + ' nodes' },
        { label: 'Change color…', ic: 'palette', run: () => M().colorPop({ x, y }, (c) => { M().pushHistory(); selectedNodes().forEach((s) => { s.color = c; }); M().commit(true); }) },
        { label: 'Add a task to each…', ic: 'check', run: () => C.openEditor({ nodeIds: [...ui.selected] }) },
        { label: 'Zoom to selection', ic: 'fit', run: () => fitNodes(selectedNodes(), { maxZoom: 1.4 }) },
        'sep',
        { label: 'Delete selected', ic: 'trash', kbd: 'Del', danger: true, run: () => M().deleteNodes([...ui.selected]) }
      ], { x, y });
    }
    const kids = M().childIds(id).length;
    M().menu([
      { head: M().title(n) || 'Untitled' },
      { label: 'Add child', ic: 'plus', kbd: 'Tab', run: () => addChild(id) },
      { label: 'Add sibling', ic: 'plus', kbd: '↵', run: () => { ui.selected = new Set([id]); addSibling(); } },
      { label: 'Add task', ic: 'check', run: () => C.openEditor({ nodeId: id }) },
      { label: 'Edit', ic: 'note', kbd: 'F2', run: () => openEditorFor(id) },
      'sep',
      ...(kids ? [
        { label: ui.collapsed.has(id) ? 'Unfold branch' : 'Fold branch', ic: 'fold', kbd: '.', run: () => M().toggleCollapse(id) },
        { label: 'Focus branch', ic: 'target', kbd: 'F', run: () => M().focusBranch(id) },
        { label: 'Tidy branch', ic: 'tidy', run: () => M().tidyBranch(id) }
      ] : []),
      { label: 'Connect from here', ic: 'connect', run: () => { setMode('connect'); ui.connectSource = id; updateSelection(); } },
      { label: 'Change color…', ic: 'palette', run: () => M().colorPop({ x, y, current: n.color }, (c) => { M().pushHistory(); n.color = c; M().commit(true); }) },
      'sep',
      { label: 'Delete', ic: 'trash', kbd: 'Del', danger: true, run: () => M().deleteNodes([id]) }
    ], { x, y });
  }
  function canvasMenu(x, y, pos) {
    M().menu([
      { label: 'Add node here', ic: 'plus', kbd: 'N', run: () => { const n = M().addNode({ pos }); requestAnimationFrame(() => openEditorFor(n.id, true)); } },
      { label: 'New cluster', ic: 'cluster', run: () => M().newCluster() },
      'sep',
      { label: 'Fit the map', ic: 'fit', run: fitDiagram },
      { label: 'Select all', ic: 'selectAll', kbd: (M().IS_MAC ? '⌘' : 'Ctrl ') + 'A', run: selectAll },
      { label: 'Unfold every branch', ic: 'fold', run: () => M().setAllCollapsed(false) }
    ], { x, y });
  }
  function moreMenu(anchor) {
    M().menu([
      { label: 'Export canvas as PNG', ic: 'image', run: exportPNG },
      { label: 'Export outline as PDF', ic: 'file', run: () => { C.go('outline'); setTimeout(() => C.views.outline.exportPDF(), 120); } },
      'sep',
      { label: 'Color nodes by…', ic: 'heat', run: () => heatMenu(anchor) },
      { label: 'New cluster', ic: 'cluster', run: () => M().newCluster() },
      { label: 'Fold every branch', ic: 'fold', run: () => M().setAllCollapsed(true) },
      { label: 'Unfold every branch', ic: 'fold', run: () => M().setAllCollapsed(false) },
      { label: 'Keyboard shortcuts', ic: 'command', run: shortcuts },
      'sep',
      { label: 'Clear the map', ic: 'trash', danger: true, run: () => M().clearMap() }
    ], { anchor });
  }
  function clustersMenu(anchor) {
    const cl = M().clusters(), ui = M().ui;
    if (!cl.length) return C.toast('No clusters yet. Give nodes a color to group them.');
    const el = M().menu([{ head: 'Clusters · tap to select' }].concat(cl.map((c) => ({
      label: c.name, dot: c.hex, run: () => M().selectCluster(c.color),
      after: '<span class="menu-count mono">' + c.count + '</span><span class="menu-eye" data-eye="' + esc(c.color) + '" role="button" aria-label="' + (ui.hiddenClusters.has(c.color) ? 'Show' : 'Hide') + '">' + icon(ui.hiddenClusters.has(c.color) ? 'eyeOff' : 'eye') + '</span>'
    }))), { anchor, cls: 'menu clusters-menu' });
    el.addEventListener('click', (e) => {
      const eye = e.target.closest('[data-eye]');
      if (eye) { e.stopPropagation(); M().toggleClusterHidden(eye.dataset.eye); M().closePop(); clustersMenu(anchor); }
    }, true);
  }
  function shortcuts() {
    const mod = M().IS_MAC ? '⌘' : 'Ctrl';
    M().menu([
      { head: 'Canvas' },
      { label: 'Add child · sibling', kbd: 'Tab · ↵' }, { label: 'Add node at pointer', kbd: 'N' }, { label: 'Edit selected', kbd: 'F2' },
      { label: 'Select · Pan · Connect · Flow', kbd: 'V H C A' }, { label: 'Pan temporarily', kbd: 'Space' },
      { label: 'Focus branch · Fold', kbd: 'F · .' }, { label: 'Nudge selection', kbd: 'Arrows' }, { label: 'Zoom · Reset', kbd: '- = · 0' },
      'sep', { head: 'Everywhere' },
      { label: 'Search & commands', kbd: mod + ' K' }, { label: 'Undo · Redo (map)', kbd: mod + ' Z · ' + mod + ' ⇧Z' }, { label: 'Switch pages', kbd: '1 – 6' }
    ], { x: innerWidth - 340, y: 70, focus: false });
  }

  /* ---------------------------------------------------------------- inspector */
  function renderInspector(force) {
    const panel = R.insp, body = R.inspBody, ui = M().ui;
    if (!panel || insp.suppress) return;
    if (!ui.selected.size) {
      if (!panel.hidden) { panel.hidden = true; insp.sig = ''; R.cv.classList.remove('insp-open'); scheduleOverlay(); }
      return;
    }
    const ids = [...ui.selected];
    const s = ids.join('|') + '#' + M().rev() + '#' + ui.collapsed.size + '#' + M().tasksSig();
    const typing = panel.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (!force && typing && insp.sig.split('#')[0] === ids.join('|')) return;
    if (!force && s === insp.sig && !panel.hidden) return;
    insp.sig = s;
    const was = panel.hidden;
    panel.hidden = false;
    R.cv.classList.add('insp-open');
    body.innerHTML = ids.length === 1 ? oneHTML(M().getNode(ids[0])) : manyHTML(ids.map(M().getNode).filter(Boolean));
    if (was) requestAnimationFrame(() => { if (ids.length === 1) keepVisible(ids[0]); scheduleOverlay(); });
  }
  function swatches(cur, act, none) {
    return '<div class="swatches insp-sw">' + (none ? '<button type="button" class="sw none' + (!cur ? ' on' : '') + '" data-act="' + act + '" data-val="" title="No fill" aria-label="No fill">' + icon('x') + '</button>' : '') +
      M().PALETTE.map((c) => '<button type="button" class="sw' + (cur === c.key ? ' on' : '') + '" data-act="' + act + '" data-val="' + c.key + '" style="--c:' + c.hex + '" title="' + c.name + '" aria-label="' + c.name + (cur === c.key ? ' (selected)' : '') + '"></button>').join('') + '</div>';
  }
  function shapeSeg(cur, mixed) {
    return '<div class="seg insp-shapes" role="radiogroup" aria-label="Shape">' + M().SHAPES.map((s) => '<button type="button" class="seg-btn' + (!mixed && cur === s.key ? ' on' : '') + '" data-act="shape" data-val="' + s.key + '" title="' + s.name + '" aria-label="' + s.name + '">' + s.svg + '</button>').join('') + '</div>';
  }
  const fmtSeg = (b, i, u) => '<div class="seg mini insp-fmt"><button type="button" class="seg-btn fmt-b' + (b ? ' on' : '') + '" data-act="fmt" data-val="isBold" aria-pressed="' + b + '" title="Bold">B</button><button type="button" class="seg-btn fmt-i' + (i ? ' on' : '') + '" data-act="fmt" data-val="isItalic" aria-pressed="' + i + '" title="Italic">I</button><button type="button" class="seg-btn fmt-u' + (u ? ' on' : '') + '" data-act="fmt" data-val="isUnderline" aria-pressed="' + u + '" title="Underline">U</button></div>';
  function oneHTML(n) {
    if (!n) return '';
    const m = M(), ui = m.ui;
    const kids = m.childIds(n.id), desc = kids.length ? m.descendantIds(n.id).length : 0;
    const parent = m.getNode(m.parentId(n.id));
    const tk = C.D.todayKey();
    const tasks = m.tasksFor(n.id).slice().sort((a, b) => (a.done - b.done) || String(a.due || '9').localeCompare(String(b.due || '9')));
    const done = tasks.filter((t) => t.done).length;
    const kicker = n.isHub ? 'Root' : kids.length ? 'Branch · ' + desc + ' below' : 'Node';
    const deg = m.graph().degree.get(n.id) || 0;
    return '<div class="insp-head"><span class="insp-kicker eyebrow"><i class="dot" style="--c:' + m.colorHex(n.color) + '"></i>' + esc(kicker) + (ui.collapsed.has(n.id) ? ' · folded' : '') + '</span>' +
      '<button type="button" class="icon-btn sm" data-act="close" aria-label="Close" title="Close (Esc)">' + icon('x') + '</button></div>' +
      '<div class="insp-scroll">' +
      '<div class="field"><label class="field-label" for="insp-label">Label</label><textarea id="insp-label" class="insp-label" rows="2" placeholder="Node label">' + esc(m.plainLabel(n.label)) + '</textarea></div>' +
      '<div class="field"><span class="field-label">Tasks <span class="muted mono">' + (tasks.length ? done + '/' + tasks.length : '') + '</span></span>' +
      (tasks.length ? '<ul class="insp-tasks">' + tasks.map((t) => {
        const lv = S().levelOf(t), late = !t.done && t.due && t.due < tk;
        return '<li class="itask' + (t.done ? ' done' : '') + '" style="--lv:' + (lv ? lv.color : 'var(--ink-3)') + '"><button type="button" class="check sm" data-check data-act="task-toggle" data-id="' + esc(t.id) + '" aria-pressed="' + !!t.done + '" aria-label="' + (t.done ? 'Mark as not done' : 'Mark as done') + '">' + icon('check') + '</button>' +
          '<button type="button" class="itask-t" data-act="task-open" data-id="' + esc(t.id) + '">' + esc(t.title) + '</button>' +
          (t.due ? '<span class="itask-due mono' + (late ? ' late' : '') + '">' + esc(C.relDate(t.due)) + '</span>' : '') + '</li>';
      }).join('') + '</ul>' : '<p class="fine">No tasks on this node yet.</p>') +
      '<div class="btn-row"><button type="button" class="btn sm" data-act="task-add">' + icon('plus') + '<span>Add task</span></button>' +
      (tasks.length ? '<button type="button" class="btn sm ghost" data-act="task-list">See in Tasks</button>' : '') + '</div></div>' +
      '<div class="field"><span class="field-label">Parent</span><button type="button" class="insp-pick" data-act="parent">' +
      (parent ? '<i class="dot" style="--c:' + m.colorHex(parent.color) + '"></i><span>' + esc(m.title(parent)) + '</span>' : '<span class="muted">None (top level)</span>') + icon('chevD', 'push') + '</button></div>' +
      '<div class="field"><span class="field-label">Color' + (kids.length ? '<label class="insp-branch"><input type="checkbox" id="insp-apply-branch"' + (insp.applyBranch ? ' checked' : '') + '>Whole branch</label>' : '') + '</span>' + swatches(n.color, 'color') + '</div>' +
      '<div class="field"><span class="field-label">Fill</span>' + swatches(n.bgColor, 'fill', true) + '</div>' +
      '<div class="field"><span class="field-label">Shape</span>' + shapeSeg(n.shape) + '</div>' +
      '<div class="field"><span class="field-label">Text</span><div class="insp-row">' + fmtSeg(!!n.isBold, !!n.isItalic, !!n.isUnderline) +
      '<label class="select-wrap"><span class="sr">Font size</span><select data-act="size">' + m.FONT_SIZES.map((f) => '<option value="' + f.value + '"' + ((n.fontSize || '') === f.value ? ' selected' : '') + '>' + f.label + '</option>').join('') + '</select></label></div>' +
      '<div class="seg mini insp-tc" role="radiogroup" aria-label="Text color">' + [['', 'Auto'], ['black', 'Black'], ['white', 'White']].map(([v, l]) => '<button type="button" class="seg-btn' + ((n.textColor || '') === v ? ' on' : '') + '" data-act="textcolor" data-val="' + v + '">' + l + '</button>').join('') + '</div></div>' +
      '<div class="field"><span class="field-label">Link</span><label class="input-wrap">' + icon('link') + '<span class="sr">URL</span><input id="insp-url" placeholder="Paste a URL" value="' + esc(n.linkUrl) + '"></label>' +
      '<label class="input-wrap"><span class="sr">Caption</span><input id="insp-caption" placeholder="Link caption (optional)" value="' + esc(n.linkCaption) + '"></label></div>' +
      '<div class="insp-facts"><span>' + icon('connect') + deg + ' connection' + (deg === 1 ? '' : 's') + '</span><span class="mono">X ' + Math.round(n.x) + ' · Y ' + Math.round(n.y) + '</span>' +
      (n.width || n.height ? '<button type="button" class="side-clear" data-act="reset-size">Reset size</button>' : '') + '</div>' +
      '</div>' +
      '<div class="insp-foot">' + (kids.length ? '<button type="button" class="btn" data-act="focus">' + icon('target') + '<span>Focus branch</span></button>' : '<button type="button" class="btn" data-act="add-child">' + icon('plus') + '<span>Add child</span></button>') +
      '<span class="spacer"></span><button type="button" class="btn ghost danger" data-act="delete" title="Delete (Del)">' + icon('trash') + '<span>Delete</span></button></div>';
  }
  function manyHTML(list) {
    const cs = new Set(list.map((n) => n.color)), ss = new Set(list.map((n) => n.shape || 'pill')), fs = new Set(list.map((n) => n.bgColor || ''));
    return '<div class="insp-head"><span class="insp-kicker eyebrow">' + icon('selectAll') + list.length + ' nodes selected</span><button type="button" class="icon-btn sm" data-act="close" aria-label="Clear selection">' + icon('x') + '</button></div>' +
      '<div class="insp-scroll">' +
      '<div class="field"><span class="field-label">Color</span>' + swatches(cs.size === 1 ? [...cs][0] : null, 'color') + '</div>' +
      '<div class="field"><span class="field-label">Fill</span>' + swatches(fs.size === 1 ? [...fs][0] : null, 'fill', true) + '</div>' +
      '<div class="field"><span class="field-label">Shape</span>' + shapeSeg(ss.size === 1 ? [...ss][0] : '', ss.size !== 1) + '</div>' +
      '<div class="field"><span class="field-label">Text</span>' + fmtSeg(list.every((n) => n.isBold), list.every((n) => n.isItalic), list.every((n) => n.isUnderline)) + '</div>' +
      '<div class="field"><span class="field-label">Arrange</span><div class="btn-row"><button type="button" class="btn sm" data-act="align-row">Align in a row</button><button type="button" class="btn sm" data-act="align-col">Align in a column</button></div></div>' +
      '<div class="field"><span class="field-label">Tasks</span><div class="btn-row"><button type="button" class="btn sm" data-act="task-bulk">' + icon('plus') + '<span>Add a task to each</span></button></div></div>' +
      '<p class="fine">Drag any selected node to move them together. Shift-click to add or remove nodes.</p></div>' +
      '<div class="insp-foot"><button type="button" class="btn" data-act="fit-sel">' + icon('fit') + '<span>Zoom to selection</span></button><span class="spacer"></span><button type="button" class="btn ghost danger" data-act="delete">' + icon('trash') + '<span>Delete</span></button></div>';
  }
  function keepVisible(id) {
    const el = R.nodes.querySelector('#node-' + CSS.escape(id));
    if (!el) return;
    const vr = vpRect();
    let right = vr.left + vr.width, bottom = vr.top + vr.height;
    if (!R.insp.hidden) {
      const pr = R.insp.getBoundingClientRect();
      if (pr.top > vr.top + 40) bottom = Math.min(bottom, pr.top); else if (pr.left < right - 2) right = Math.min(right, pr.left);
    }
    const r = el.getBoundingClientRect(), m = 40;
    let dx = 0, dy = 0;
    if (r.right > right - m - 90) dx = (right - m - 90) - r.right;
    if (r.left + dx < vr.left + m) dx = (vr.left + m) - r.left;
    if (r.bottom > bottom - m) dy = (bottom - m) - r.bottom;
    if (r.top + dy < vr.top + m + 50) dy = (vr.top + m + 50) - r.top;
    if (!dx && !dy) return;
    V.x += dx; V.y += dy; applyTransform();
  }
  function styleTargets() {
    const ns = selectedNodes();
    if (ns.length === 1 && insp.applyBranch) return [ns[0], ...M().descendantIds(ns[0].id).map(M().getNode).filter(Boolean)];
    return ns;
  }
  let labelRaf = 0;
  function wireInspector() {
    const body = R.inspBody, m = M();
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.tagName === 'SELECT' || b.type === 'checkbox') return;
      const act = b.dataset.act, val = b.dataset.val, ns = selectedNodes(), one = ns.length === 1 ? ns[0] : null;
      const style = (fn) => { m.pushHistory(); fn(); m.commit(true); };
      switch (act) {
        case 'close': clearSelection(); break;
        case 'color': style(() => styleTargets().forEach((n) => { n.color = val; })); break;
        case 'fill': style(() => ns.forEach((n) => { n.bgColor = val; })); break;
        case 'shape': style(() => ns.forEach((n) => { n.shape = val; })); break;
        case 'textcolor': style(() => ns.forEach((n) => { n.textColor = val; })); break;
        case 'fmt': { const all = ns.every((n) => n[val]); style(() => ns.forEach((n) => { n[val] = !all; })); break; }
        case 'parent': if (one) m.pickNode({ anchor: b, current: m.parentId(one.id), allowNone: true, noneLabel: 'None (top level)', exclude: new Set([one.id, ...m.descendantIds(one.id)]),
          onPick: (pid) => { m.pushHistory(); if (m.setParent(one.id, pid)) m.commit(true); else m.dropHistory(); } }); break;
        case 'task-add': if (one) C.openEditor({ nodeId: one.id }); break;
        case 'task-bulk': C.openEditor({ nodeIds: ns.map((n) => n.id) }); break;
        case 'task-open': C.openEditor(b.dataset.id); break;
        case 'task-toggle': C.completeTask(b.dataset.id, b.closest('.itask')); break;
        case 'task-list': if (one && C.views.list.filterNode) { C.views.list.filterNode(one.id); C.go('list'); } break;
        case 'focus': if (one) m.focusBranch(one.id); break;
        case 'add-child': if (one) addChild(one.id); break;
        case 'delete': deleteSelected(); break;
        case 'reset-size': if (one) style(() => { one.width = 0; one.height = 0; }); break;
        case 'fit-sel': fitNodes(ns, { maxZoom: 1.4 }); break;
        case 'align-row': case 'align-col': {
          const row = act === 'align-row';
          style(() => {
            const sorted = ns.slice().sort((a, c) => (row ? a.x - c.x : a.y - c.y));
            const avg = sorted.reduce((s, n) => s + (row ? n.y : n.x), 0) / sorted.length, start = row ? sorted[0].x : sorted[0].y, step = row ? 170 : 80;
            sorted.forEach((n, i) => { if (row) { n.y = Math.round(avg); n.x = start + i * step; } else { n.x = Math.round(avg); n.y = start + i * step; } });
          });
          break;
        }
      }
    });
    body.addEventListener('change', (e) => {
      const t = e.target;
      if (t.id === 'insp-apply-branch') { insp.applyBranch = t.checked; return; }
      if (t.dataset.act === 'size') { m.pushHistory(); selectedNodes().forEach((n) => { n.fontSize = t.value; }); m.commit(true); }
    });
    const FIELDS = ['insp-label', 'insp-url', 'insp-caption'];
    body.addEventListener('focusin', (e) => { if (FIELDS.includes(e.target.id)) insp.pushed = false; });
    body.addEventListener('input', (e) => {
      const t = e.target, n = selectedNodes()[0];
      if (!n || M().ui.selected.size !== 1 || !FIELDS.includes(t.id)) return;
      if (!insp.pushed) { m.pushHistory(); insp.pushed = true; }
      if (t.id === 'insp-label') {
        if (!t.value.trim()) return;
        n.label = t.value;
        const el = R.nodes.querySelector('#node-' + CSS.escape(n.id) + ' .nlabel');
        if (el && !m.safeUrl(n.linkUrl)) { el.innerHTML = m.labelHtml(n.label); cancelAnimationFrame(labelRaf); labelRaf = requestAnimationFrame(() => { updateEdges(); scheduleOverlay(); }); }
      } else {
        if (t.id === 'insp-url') n.linkUrl = t.value.trim(); else n.linkCaption = t.value.trim();
        cancelAnimationFrame(labelRaf); labelRaf = requestAnimationFrame(() => { insp.suppress = true; try { renderBoard(); } finally { insp.suppress = false; } });
      }
    });
    body.addEventListener('focusout', (e) => {
      const t = e.target;
      if (!FIELDS.includes(t.id)) return;
      const n = M().getNode(insp.sig.split('#')[0]);
      if (t.id === 'insp-label' && n) { if (!t.value.trim()) t.value = m.plainLabel(n.label); else if (t.value.trim() !== n.label) { if (!insp.pushed) { m.pushHistory(); insp.pushed = true; } n.label = t.value.trim(); } }
      if (insp.pushed) {
        insp.pushed = false;
        insp.suppress = true; // the click that blurred this may be on an inspector button
        try { m.commit(true); } finally { insp.suppress = false; }
      }
    });
    body.addEventListener('keydown', (e) => {
      if (e.target.id === 'insp-label' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.blur(); }
      else if ((e.target.id === 'insp-url' || e.target.id === 'insp-caption') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.target.blur(); }
    });
  }
  function deleteSelected() {
    const ui = M().ui;
    if (ui.selectedEdge) return M().deleteEdge(ui.selectedEdge);
    if (ui.selected.size) return M().deleteNodes([...ui.selected]);
    C.toast('Nothing selected to delete', { duration: 2000 });
  }

  /* ---------------------------------------------------------------- keyboard */
  let nudgeT = null, nudgePushed = false;
  function nudge(k, step) {
    if (!nudgePushed) { M().pushHistory(); nudgePushed = true; S().setMapBusy(true); }
    const dx = k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, dy = k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0;
    selectedNodes().forEach((n) => { n.x += dx; n.y += dy; const el = R.nodes.querySelector('#node-' + CSS.escape(n.id)); if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; } });
    updateEdges(); scheduleOverlay();
    clearTimeout(nudgeT);
    nudgeT = setTimeout(() => { nudgePushed = false; M().commit(true); S().setMapBusy(false); }, 450);
  }
  /** returns true when the canvas handled the key */
  function onKey(e) {
    if (!root) return false;
    const ui = M().ui, mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    const ae = document.activeElement;
    if (ae && R.insp.contains(ae)) return false;
    if (mod && k === 'a') { e.preventDefault(); selectAll(); return true; }
    if (e.key === 'Escape') {
      if (ui.mode === 'connect' || ui.mode === 'connect-directed') { setMode('pan'); return true; }
      if (ui.selected.size || ui.selectedEdge) { clearSelection(); return true; }
      return false;
    }
    if (mod || e.altKey) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return true; }
    const one = ui.selected.size === 1 ? [...ui.selected][0] : null;
    if (ae && (ae.tagName === 'BUTTON' || ae.tagName === 'A') && (e.key === 'Enter' || e.key === ' ')) return false;
    if (e.key === 'Tab' && one) { e.preventDefault(); addChild(one); return true; }
    if (e.key === 'Enter' && one) { e.preventDefault(); addSibling(); return true; }
    if (e.key === 'F2' && one) { e.preventDefault(); openEditorFor(one, true); return true; }
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) { st.spacePan = true; R.vp.classList.add('panning'); } return true; }
    if ((e.key === '+' || e.key === '=') && e.shiftKey && one) { e.preventDefault(); addChild(one); return true; }
    switch (k) {
      case 'v': setMode('select'); return true;
      case 'h': setMode('pan'); return true;
      case 'c': setMode(ui.mode === 'connect' ? 'pan' : 'connect'); return true;
      case 'a': setMode(ui.mode === 'connect-directed' ? 'pan' : 'connect-directed'); return true;
      case 'n': view.newNode(); return true;
      case 'f': if (one) M().focusBranch(one); else if (ui.selected.size) fitNodes(selectedNodes(), { maxZoom: 1.4 }); else fitDiagram(); return true;
      case '.': if (one) M().toggleCollapse(one); return true;
      case '0': resetZoom(); return true;
      case '-': zoomBy(1 / 1.2); return true;
      case '=': zoomBy(1.2); return true;
      case 'arrowleft': case 'arrowright': case 'arrowup': case 'arrowdown':
        if (!ui.selected.size) return false;
        e.preventDefault(); nudge(k, e.shiftKey ? 40 : 8); return true;
    }
    return false;
  }

  /* ------------------------------------------------------------ canvas input */
  function wire() {
    const sig_ = { signal: ac.signal };
    const vp = R.vp, ui = M().ui;
    let panMoved = 0, panOrigin = null;
    vp.addEventListener('scroll', () => { vp.scrollLeft = 0; vp.scrollTop = 0; });
    vp.addEventListener('mousedown', (e) => {
      M().closePop();
      if (document.activeElement && R.insp.contains(document.activeElement)) document.activeElement.blur();
      if (e.button === 2) return;
      if (e.button === 1 || ui.mode === 'pan' || st.spacePan || ui.mode === 'connect' || ui.mode === 'connect-directed') {
        e.preventDefault();
        st.panning = true; panMoved = 0; panOrigin = { x: e.clientX, y: e.clientY };
        st.panStart = { x: e.clientX - V.x, y: e.clientY - V.y };
        vp.classList.add('panning');
        return;
      }
      if (e.button === 0 && ui.mode === 'select') {
        st.marquee = true; st.mStart = { x: e.clientX, y: e.clientY };
        st.mBase = (e.shiftKey || e.ctrlKey || e.metaKey) ? new Set(ui.selected) : new Set();
        const r = vp.getBoundingClientRect();
        Object.assign(R.marquee.style, { left: (e.clientX - r.left) + 'px', top: (e.clientY - r.top) + 'px', width: '0px', height: '0px', display: 'block' });
        if (!st.mBase.size) { ui.selected.clear(); ui.selectedEdge = null; updateSelection(); }
      }
    });
    addEventListener('mousemove', (e) => {
      st.pointer = toWorld(e.clientX, e.clientY);
      if (st.panning) {
        panMoved = Math.max(panMoved, Math.hypot(e.clientX - panOrigin.x, e.clientY - panOrigin.y));
        V.x = e.clientX - st.panStart.x; V.y = e.clientY - st.panStart.y;
        applyTransform();
        return;
      }
      if (st.marquee) {
        const r = vp.getBoundingClientRect(), sx = st.mStart.x, sy = st.mStart.y;
        const minX = Math.min(sx, e.clientX), minY = Math.min(sy, e.clientY), w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
        Object.assign(R.marquee.style, { left: (minX - r.left) + 'px', top: (minY - r.top) + 'px', width: w + 'px', height: h + 'px' });
        const next = new Set(st.mBase);
        M().nodes().forEach((n) => {
          if (boardHidden.has(n.id)) return;
          const px = n.x * V.zoom + V.x + r.left, py = n.y * V.zoom + V.y + r.top;
          if (px >= minX && px <= minX + w && py >= minY && py <= minY + h) next.add(n.id);
        });
        ui.selected = next;
        R.nodes.querySelectorAll('.node').forEach((el) => el.classList.toggle('selected', next.has(el.dataset.id)));
      }
    }, sig_);
    addEventListener('mouseup', () => {
      if (st.panning) {
        st.panning = false;
        if (!st.spacePan) vp.classList.remove('panning');
        if (panMoved < 4 && ui.mode !== 'connect' && ui.mode !== 'connect-directed') clearSelection();
      }
      if (st.marquee) {
        st.marquee = false; R.marquee.style.display = 'none';
        updateSelection();
        if (ui.selected.size > 1) C.toast(ui.selected.size + ' nodes selected. Drag any of them to move the group.', { duration: 2600 });
      }
    }, sig_);
    addEventListener('keyup', (e) => { if (e.code === 'Space' && st.spacePan) { st.spacePan = false; if (!st.panning) vp.classList.remove('panning'); } }, sig_);
    addEventListener('blur', () => { st.spacePan = false; vp.classList.remove('panning'); }, sig_);
    addEventListener('resize', () => { scheduleOverlay(); drawMinimap(); }, sig_);
    vp.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      const f = e.ctrlKey ? Math.exp(-e.deltaY * 0.01) : (e.deltaY < 0 ? 1.1 : 1 / 1.1);
      zoomBy(f, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    vp.addEventListener('contextmenu', (e) => { if (e.target.closest('.node')) return; e.preventDefault(); canvasMenu(e.clientX, e.clientY, toWorld(e.clientX, e.clientY)); });
    vp.addEventListener('dblclick', (e) => { if (e.target.closest('.node')) return; const n = M().addNode({ pos: toWorld(e.clientX, e.clientY) }); requestAnimationFrame(() => openEditorFor(n.id, true)); });

    let pinch = null, tMoved = 0, tOrigin = null;
    vp.addEventListener('touchstart', (e) => {
      M().closePop();
      if (e.touches.length === 1) {
        const t = e.touches[0]; tMoved = 0; tOrigin = { x: t.clientX, y: t.clientY };
        st.panning = true; st.panStart = { x: t.clientX - V.x, y: t.clientY - V.y };
      } else if (e.touches.length === 2) {
        st.panning = false;
        const [a, b] = e.touches;
        pinch = { d: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY), zoom: V.zoom, cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2, vx: V.x, vy: V.y };
      }
    }, { passive: false });
    vp.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && st.panning) {
        e.preventDefault();
        const t = e.touches[0];
        tMoved = Math.max(tMoved, Math.hypot(t.clientX - tOrigin.x, t.clientY - tOrigin.y));
        V.x = t.clientX - st.panStart.x; V.y = t.clientY - st.panStart.y; applyTransform();
      } else if (e.touches.length === 2 && pinch) {
        e.preventDefault();
        const [a, b] = e.touches, d = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
        const cx = (a.clientX + b.clientX) / 2, cy = (a.clientY + b.clientY) / 2, z = M().clamp(pinch.zoom * (d / pinch.d), 0.2, 2.5);
        const r = vp.getBoundingClientRect(), ox = pinch.cx - r.left, oy = pinch.cy - r.top;
        V.x = ox - (ox - pinch.vx) * (z / pinch.zoom) + (cx - pinch.cx); V.y = oy - (oy - pinch.vy) * (z / pinch.zoom) + (cy - pinch.cy); V.zoom = z;
        applyTransform();
      }
    }, { passive: false });
    vp.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) pinch = null;
      if (!e.touches.length) { if (st.panning && tMoved < 6 && ui.mode !== 'connect' && ui.mode !== 'connect-directed') clearSelection(); st.panning = false; }
    });

    root.querySelectorAll('#cv-tools [data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    root.querySelector('#cv-focus').addEventListener('click', () => { const s = ui.selected; if (s.size === 1) M().focusBranch([...s][0]); else if (s.size) fitNodes(selectedNodes(), { maxZoom: 1.4 }); else fitDiagram(); });
    root.querySelector('#cv-tidy').addEventListener('click', () => { if (ui.selected.size === 1) M().tidyBranch([...ui.selected][0]); else C.toast('Select one node with children to tidy its branch'); });
    root.querySelector('#cv-all').addEventListener('click', selectAll);
    root.querySelector('#cv-add').addEventListener('click', () => { if (ui.selected.size === 1) addChild([...ui.selected][0]); else view.newNode(); });
    root.querySelector('#cv-zin').addEventListener('click', () => zoomBy(1.2));
    root.querySelector('#cv-zout').addEventListener('click', () => zoomBy(1 / 1.2));
    R.zt.addEventListener('click', resetZoom);
    root.querySelector('#cv-fit').addEventListener('click', fitDiagram);
    R.undo.addEventListener('click', () => M().undo());
    R.redo.addEventListener('click', () => M().redo());
    root.querySelector('#cv-more').addEventListener('click', (e) => moreMenu(e.currentTarget));
    root.querySelector('#cv-clusters').addEventListener('click', (e) => clustersMenu(e.currentTarget));
    R.heatbtn.addEventListener('click', (e) => heatMenu(e.currentTarget));
    R.heat.addEventListener('click', (e) => {
      if (e.target.closest('[data-heat-off]')) setHeat(null);
      else if (e.target.closest('[data-heat-menu]')) heatMenu(e.target.closest('[data-heat-menu]'));
    });
    R.heat.addEventListener('change', (e) => { if (e.target.hasAttribute('data-heat-rollup')) setHeat(M().ui.heat.metric, e.target.checked); });
    R.edge.addEventListener('click', () => { if (ui.selectedEdge) M().deleteEdge(ui.selectedEdge); });
    R.qb.addEventListener('mousedown', (e) => e.stopPropagation());
    R.qb.addEventListener('click', (e) => {
      const b = e.target.closest('[data-qa]'), id = [...ui.selected][0];
      if (!b || !id) return;
      const a = b.dataset.qa;
      if (a === 'child') addChild(id);
      else if (a === 'task') C.openEditor({ nodeId: id });
      else if (a === 'collapse') M().toggleCollapse(id);
      else if (a === 'focus') M().focusBranch(id);
      else if (a === 'delete') M().deleteNodes([id]);
    });
    let mmDrag = false;
    R.mm.addEventListener('mousedown', (e) => { mmDrag = true; minimapPanTo(e.clientX, e.clientY); e.preventDefault(); });
    addEventListener('mousemove', (e) => { if (mmDrag) minimapPanTo(e.clientX, e.clientY); }, sig_);
    addEventListener('mouseup', () => { mmDrag = false; }, sig_);
    R.empty.addEventListener('click', (e) => {
      const b = e.target.closest('[data-empty]'); if (!b) return;
      const a = b.dataset.empty;
      if (a === 'blank') { const n = M().startBlank(); M().ui._viewSet = false; requestAnimationFrame(() => { fitNodes([n], { maxZoom: 1.2 }); openEditorFor(n.id, true); }); }
      else if (a === 'example') { M().loadExample(); requestAnimationFrame(fitDiagram); C.toast('Loaded an example map. Its example tasks are linked to nodes.', { action: 'Undo', onAction: () => M().undo() }); }
      else if (a === 'legacy') { M().importWorkmap(M().legacyLocal()); requestAnimationFrame(fitDiagram); }
    });
    R.empty.addEventListener('change', (e) => {
      if (e.target.id !== 'cv-import' || !e.target.files[0]) return;
      const f = e.target.files[0]; e.target.value = '';
      M().importFile(f).then(() => requestAnimationFrame(fitDiagram)).catch(() => {});
    });
  }

  /* ---------------------------------------------------------------- PNG export */
  function exportPNG() {
    if (C.currentRoute() !== 'canvas') { C.go('canvas'); return setTimeout(exportPNG, 200); }
    const vis = M().nodes().filter((n) => !boardHidden.has(n.id));
    if (!vis.length) return C.toast('Nothing to export yet');
    C.toast('Preparing the PNG…', { duration: 3000 });
    const prev = Object.assign({}, V), prevSel = new Set(M().ui.selected), prevEdge = M().ui.selectedEdge;
    const b = M().boundsOf(vis), pad = 160;
    const w = Math.ceil(b.maxX - b.minX + pad * 2), h = Math.ceil(b.maxY - b.minY + pad * 2);
    const vp = R.vp;
    let bg = '#ffffff', styles = [];
    const restore = () => {
      document.documentElement.classList.remove('exporting');
      Object.assign(vp.style, { right: '', bottom: '', width: '', height: '' });
      Object.assign(V, prev); M().ui.selected = prevSel; M().ui.selectedEdge = prevEdge;
      applyTransform(); renderBoard();
    };
    M().loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js').then(() => {
      M().ui.selected = new Set(); M().ui.selectedEdge = null;
      document.documentElement.classList.add('exporting');
      renderBoard();
      V.x = -b.minX + pad; V.y = -b.minY + pad; V.zoom = 1;
      R.world.style.transform = 'translate(' + V.x + 'px,' + V.y + 'px) scale(1)';
      Object.assign(vp.style, { right: 'auto', bottom: 'auto', width: w + 'px', height: h + 'px' });
      bg = getComputedStyle(document.body).backgroundColor || '#ffffff';
      styles = renderedEdges.map(({ line }) => { const cs = getComputedStyle(line); return { d: line.getAttribute('d'), stroke: cs.stroke, width: parseFloat(cs.strokeWidth) || 1.6, dash: cs.strokeDasharray }; });
      return new Promise((r) => setTimeout(r, 120)).then(() => window.html2canvas(vp, { scale: 2, useCORS: true, logging: false, width: w, height: h, windowWidth: w, windowHeight: h, backgroundColor: null, ignoreElements: (el) => el.id === 'cv-svg' || el.id === 'cv-marquee' }));
    }).then((nodesCanvas) => {
      const out = document.createElement('canvas');
      out.width = nodesCanvas.width; out.height = nodesCanvas.height;
      const ctx = out.getContext('2d');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, out.width, out.height);
      ctx.setTransform(2, 0, 0, 2, 2 * (-b.minX + pad), 2 * (-b.minY + pad));
      ctx.lineCap = 'round';
      styles.forEach((s) => {
        ctx.strokeStyle = s.stroke; ctx.lineWidth = s.width;
        ctx.setLineDash(s.dash && s.dash !== 'none' ? s.dash.split(/[ ,]+/).map(parseFloat).filter((n) => !isNaN(n)) : []);
        ctx.stroke(new Path2D(s.d));
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(nodesCanvas, 0, 0);
      restore();
      M().download(out.toDataURL('image/png'), 'Wayholm Plan map ' + C.D.todayKey() + '.png');
      C.toast('Saved the canvas as a PNG');
    }).catch((err) => { console.error('PNG export failed', err); restore(); C.toast('Couldn’t export the PNG. ' + (err && err.message ? err.message : '')); });
  }
})();
