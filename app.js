/* Cadence — app shell: navigation, theme, shortcuts, shared task actions */
(function () {
  const C = window.Cadence;
  const { D, esc, icon } = C;
  const S = C.store;
  const ROUTES = ['list', 'calendar', 'canvas', 'outline', 'table', 'insights', 'charts', 'board', 'settings'];
  const KEY_ROUTES = ['list', 'calendar', 'canvas', 'outline', 'table', 'insights']; // number keys 1–6
  const NAV = [
    { group: 'Plan', items: [{ id: 'list', label: 'Tasks', ic: 'list' }, { id: 'calendar', label: 'Calendar', ic: 'calendar' }] },
    { group: 'Map', items: [{ id: 'canvas', label: 'Canvas', ic: 'canvas' }, { id: 'outline', label: 'Outline', ic: 'outline' }, { id: 'table', label: 'Table', ic: 'table' }] },
    { group: 'Review', items: [{ id: 'insights', label: 'Insights', ic: 'chart' }, { id: 'charts', label: 'Chart builder', ic: 'pie' }, { id: 'board', label: 'Dashboards', ic: 'board' }] },
    { items: [{ id: 'settings', label: 'Settings', ic: 'settings' }] }
  ];
  const isMap = (r) => r === 'canvas' || r === 'outline' || r === 'table';
  const root = document.documentElement;
  const early = root.hasAttribute('data-theme-early'); // boot.js already applied your saved Light or Dark
  root.removeAttribute('data-theme-early');
  const hostTheme = early ? null : root.getAttribute('data-theme'); // the viewer may set one; "system" falls back to it
  let current = null;
  C.currentRoute = () => current;

  const LOGO = '<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="9" class="logo-bg"/>' +
    '<rect x="8.5" y="16" width="3.6" height="8" rx="1.8" class="logo-bar"/><rect x="14.2" y="11" width="3.6" height="13" rx="1.8" class="logo-bar"/><rect x="19.9" y="7.5" width="3.6" height="16.5" rx="1.8" class="logo-bar hi"/></svg>';

  /* ---------- helpers exposed to views ---------- */
  C.fromParse = (p) => ({
    title: p.title,
    due: p.due || (p.time ? D.todayKey() : null), // a time without a date means today
    time: p.time || null,
    typeId: p.typeId || S.state.prefs.defaultType || null,
    levelId: p.levelId || S.state.prefs.defaultLevel,
    repeat: p.repeat,
    nodeId: p.nodeId || null,
    ...(p.recordId && C.records ? C.records.linkFor(p.recordId) : {})
  });

  C.withTransition = function (fn, dir) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduce) return fn();
    root.dataset.dir = dir || 'none';
    try { document.startViewTransition(fn); } catch (e) { fn(); }
  };

  C.go = function (r) { if (location.hash.slice(1) !== r) location.hash = r; else route(); };

  C.completeTask = function (id, rowEl) {
    const t = S.get(id); if (!t) return;
    const wasDone = t.done;
    const tk = D.todayKey();
    if (!wasDone && rowEl) {
      const chk = rowEl.querySelector('[data-check]');
      if (chk) burst(chk, 10);
      rowEl.classList.add('completing');
      setTimeout(() => finish(), 260);
    } else finish();
    function finish() {
      const { spawned } = S.toggleDone(id);
      if (wasDone) return C.toast('Reopened “' + t.title + '”');
      const left = S.state.tasks.filter((x) => !x.done && x.due && x.due <= tk).length;
      const dueTodayCount = S.state.tasks.filter((x) => x.due === tk).length;
      if (left === 0 && dueTodayCount > 0 && (t.due || '') <= tk) {
        bigBurst();
        C.toast('Today’s list is clear. Nice work.', { action: 'Undo', onAction: () => S.toggleDone(id) });
      } else {
        C.toast(spawned ? 'Done. Next one is set for ' + C.relDate(spawned.due) : 'Completed “' + t.title + '”', { action: 'Undo', onAction: () => S.toggleDone(id) });
      }
    }
  };

  C.deleteWithUndo = function (id) {
    const cur = S.get(id);
    if (cur && !S.canDelete(cur)) {
      return C.toast('Only ' + C.firstName(cur.ownerName, cur.ownerEmail) + ' can delete this. Hand it back if it isn’t yours to do.', { action: 'Hand back', onAction: () => C.handBack(id) });
    }
    const t = S.deleteTask(id);
    if (t) C.toast('Deleted “' + t.title + '”', { action: 'Undo', onAction: () => S.restoreTask(t) });
  };

  /* ---------- people ---------- */
  C.firstName = (name, email) => (name || (email || '').split('@')[0] || 'Someone').split(' ')[0];
  C.avatar = function (p) {
    const label = p.name || p.email || '?';
    const parts = label.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
    const ini = ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    let h = 0; String(p.uid || label).split('').forEach((c) => { h = (h * 31 + c.charCodeAt(0)) % 360; });
    const src = C.photoOf(p.uid);
    return '<span class="av" style="--h:' + h + '" title="' + esc(p.name || p.email || '') + '" aria-hidden="true">' + esc(ini) +
      (src ? '<img class="av-pic" src="' + esc(src) + '" alt="" loading="lazy" referrerpolicy="no-referrer" draggable="false">' : '') + '</span>';
  };
  /* Google account photos (profiles/{uid}.photoURL, saved when someone signs in with Google) over the initials;
     one that won't load is removed, leaving the initials underneath. */
  C.photos = C.photos || {};
  const badPhotos = new Set();
  C.photoOf = function (uid) {
    const u = String((uid && C.photos[uid]) || '').trim();
    if (!/^https:\/\/[^\s"'<>]+$/i.test(u) || u.length > 1000) return '';
    const src = /googleusercontent\.com\//.test(u) ? u.replace(/=s\d+(-c)?$/, '=s96-c') : u;
    return badPhotos.has(src) ? '' : src;
  };
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.classList && t.classList.contains('av-pic')) { badPhotos.add(t.getAttribute('src')); t.remove(); }
  }, true);
  /** "From Sam" on tasks assigned to me, "For Priya" on tasks I assigned */
  C.whoChip = function (t, compact) {
    if (!S.isWithOthers(t) || !S.sharing()) return '';
    let p, label;
    // given to a role (Formwright → Roles)
    if (t.assigneeRole && !t.assigneeId) {
      p = { uid: 'role:' + t.assigneeRole, name: t.assigneeRoleName || 'Role', email: '' };
      label = S.isOwner(t) ? 'For ' + (t.assigneeRoleName || 'a role') : (t.assigneeRoleName || 'Your role') + ' · from ' + C.firstName(t.ownerName, t.ownerEmail);
      if (t.done && t.doneByName) label += ' · done by ' + t.doneByName;
    }
    else if (S.isAssignedToMe(t)) { p = { uid: t.ownerId, name: t.ownerName, email: t.ownerEmail }; label = 'From ' + C.firstName(p.name, p.email); }
    else if (S.isOwner(t)) { p = { uid: t.assigneeId, name: t.assigneeName, email: t.assigneeEmail }; label = 'For ' + C.firstName(p.name, p.email); }
    else return '';
    return '<span class="who' + (compact ? ' compact' : '') + '" title="' + esc(label) + '">' + C.avatar(p) + (compact ? '<span class="sr">' + esc(label) + '</span>' : '<span>' + esc(label) + '</span>') + '</span>';
  };
  C.handBack = function (id) {
    const t = S.get(id); if (!t) return;
    S.returnToOwner(id);
    C.toast('Handed “' + t.title + '” back to ' + C.firstName(t.ownerName, t.ownerEmail));
  };

  /* ---------- theme ---------- */
  C.applyTheme = function () {
    const pref = S.state.prefs.theme;
    if (pref === 'light' || pref === 'dark') root.setAttribute('data-theme', pref);
    else if (hostTheme) root.setAttribute('data-theme', hostTheme);
    else root.removeAttribute('data-theme');
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = getComputedStyle(document.body).backgroundColor;
  };
  const isDark = () => { const a = root.getAttribute('data-theme'); return a ? a === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
  C.cycleTheme = function () {
    C.withTransition(() => { S.setPrefs({ theme: isDark() ? 'light' : 'dark' }); C.applyTheme(); renderChrome(); });
  };

  /* ---------- chrome ---------- */
  function counts() {
    const tk = D.todayKey();
    const open = S.state.tasks.filter((t) => !t.done);
    return { list: open.filter((t) => t.due && t.due <= tk).length, open: open.length };
  }
  function renderChrome() {
    const c = counts();
    const r = current;
    const st = S.state;
    const onMap = isMap(r);
    const compact = !!st.prefs.sideCompact;
    const mod = (C.map && C.map.IS_MAC) ? '⌘K' : 'Ctrl K';
    root.classList.toggle('side-compact', compact);
    const side = document.getElementById('sidebar');
    const scroll = side.querySelector('.side-scroll');
    const keep = scroll ? scroll.scrollTop : 0;
    side.innerHTML =
      '<div class="brand">' + LOGO + '<span class="brand-name">Cadence</span>' +
      '<button type="button" class="icon-btn sm side-collapse" data-side-compact aria-label="' + (compact ? 'Expand the sidebar' : 'Collapse the sidebar') + '" title="' + (compact ? 'Expand the sidebar' : 'Collapse the sidebar') + '">' + icon('sidebar') + '</button></div>' +
      (onMap
        ? '<button type="button" class="btn primary block" data-new-node title="New node (N)">' + icon('plus') + '<span>New node</span><kbd>N</kbd></button>'
        : '<button type="button" class="btn primary block" data-new title="New task (N)">' + icon('plus') + '<span>New task</span><kbd>N</kbd></button>') +
      '<button type="button" class="search-trigger" data-pal title="Search (' + mod + ')">' + icon('search') + '<span>Search or jump to…</span><kbd>' + mod + '</kbd></button>' +
      '<div class="side-scroll">' +
      '<nav class="side-nav" aria-label="Primary">' + NAV.map((g) =>
        '<div class="side-group' + (g.group === 'Map' && onMap ? ' here' : '') + '">' + (g.group ? '<span class="side-group-label eyebrow">' + g.group + '</span>' : '<span class="side-group-rule"></span>') +
        g.items.map((n) => '<a href="#' + n.id + '" class="side-link' + (r === n.id ? ' on' : '') + '"' + (r === n.id ? ' aria-current="page"' : '') + ' title="' + n.label + '">' + icon(n.ic) + '<span>' + n.label + '</span>' +
          (n.id === 'list' && c.list ? '<span class="count mono" title="Due today or overdue">' + c.list + '</span>' : '') +
          (n.id === 'canvas' && C.map && C.map.nodes().length ? '<span class="count mono quiet" title="Nodes on the map">' + C.map.nodes().length + '</span>' : '') + '</a>').join('') + '</div>').join('') + '</nav>' +
      (onMap ? sideClusters() : (['insights', 'charts', 'board'].includes(r) ? sideDashes() : '') + sideTypes(st) + sideLevels(st)) +
      '</div>' +
      storageMeter(st) +
      '<div class="side-foot">' +
      C.syncPill() +
      '<button type="button" class="icon-btn" data-theme-toggle aria-label="Toggle dark mode">' + icon(isDark() ? 'sun' : 'moon') + '</button></div>';
    const sc = side.querySelector('.side-scroll'); if (sc) sc.scrollTop = keep;

    document.getElementById('topbar').innerHTML =
      '<div class="brand">' + LOGO + '<span class="brand-name">Cadence</span></div><span class="spacer"></span>' + C.syncPill(true) +
      '<button type="button" class="icon-btn" data-pal aria-label="Search">' + icon('search') + '</button>' +
      '<button type="button" class="icon-btn" data-theme-toggle aria-label="Toggle dark mode">' + icon(isDark() ? 'sun' : 'moon') + '</button>' +
      '<a href="#settings" class="icon-btn' + (r === 'settings' ? ' on' : '') + '" aria-label="Settings"' + (r === 'settings' ? ' aria-current="page"' : '') + '>' + icon('settings') + '</a>';

    document.getElementById('tabbar').innerHTML =
      tab('list', 'Tasks', 'list', c.list) + tab('calendar', 'Calendar', 'calendar') +
      (onMap ? '<button type="button" class="fab" data-new-node aria-label="New node">' + icon('plus') + '</button>'
        : '<button type="button" class="fab" data-new aria-label="New task">' + icon('plus') + '</button>') +
      tab(C.map ? C.map.ui.lastRoute : 'canvas', 'Map', 'canvas') +
      tab('insights', 'Insights', 'chart');
  }
  C.renderChrome = () => { if (current) renderChrome(); };
  /* on Insights pages the sidebar lists your dashboards */
  function sideDashes() {
    const b = C.views.board; if (!b || !b.list) return '';
    const list = b.list();
    return '<div class="side-sec"><div class="side-sec-head"><span class="eyebrow">Dashboards</span><span class="mono muted side-n">' + list.length + '</span></div>' +
      '<ul class="side-types">' + list.map((d) => '<li><button type="button" class="side-type side-dash' + (d.on ? ' on' : '') + '" data-side-dash="' + esc(d.id) + '"' + (d.on ? ' aria-current="page"' : '') + '>' + icon(d.home ? 'star' : 'board') + '<span>' + esc(d.name) + '</span>' + (d.home ? '<span class="mono muted">home</span>' : '') + '</button></li>').join('') + '</ul></div>';
  }
  /* on map pages the sidebar lists clusters: click to select (Canvas) or filter (Outline, Table) */
  function sideClusters() {
    const m = C.map;
    if (!m) return '';
    const cl = m.clusters().sort((a, b) => b.count - a.count);
    const verb = current === 'canvas' ? 'Select' : 'Show only';
    const any = cl.some((c) => m.clusterActive(c.color));
    return '<div class="side-sec"><div class="side-sec-head"><span class="eyebrow">Clusters</span>' +
      (any && current !== 'canvas' ? '<button type="button" class="side-clear" data-side-cluster-clear>Show all</button>' : '<span class="mono muted side-n">' + m.nodes().length + '</span>') + '</div>' +
      (cl.length ? '<ul class="side-types">' + cl.map((c) => {
        const on = m.clusterActive(c.color), hid = m.ui.hiddenClusters.has(c.color);
        return '<li class="side-cl' + (hid ? ' is-hidden' : '') + '"><button type="button" class="side-type' + (on ? ' on' : '') + '" data-side-cluster="' + esc(c.color) + '" aria-pressed="' + on + '" title="' + verb + ' ' + esc(c.name) + ' · right-click to recolor" style="--c:' + c.hex + '">' +
          '<i class="dot side-dot"></i><span>' + esc(c.name) + '</span><span class="mono muted">' + c.count + '</span></button>' +
          '<button type="button" class="side-eye" data-side-eye="' + esc(c.color) + '" aria-label="' + (hid ? 'Show' : 'Hide') + ' ' + esc(c.name) + ' on the canvas" title="' + (hid ? 'Show on the canvas' : 'Hide on the canvas') + '">' + icon(hid ? 'eyeOff' : 'eye') + '</button></li>';
      }).join('') + '</ul>' : '<p class="fine side-empty">Clusters appear here when your map has nodes. A cluster is every node that shares a color.</p>') +
      '</div>' +
      (current === 'canvas' && cl.length ? '<div class="side-sec side-keys"><span class="eyebrow">Shortcuts</span><dl>' +
        [['Tab', 'Child'], ['↵', 'Sibling'], ['F', 'Focus'], ['.', 'Fold'], ['C', 'Connect'], ['A', 'Flow']].map(([k, v]) => '<div><dt><kbd>' + k + '</kbd></dt><dd>' + v + '</dd></div>').join('') + '</dl></div>' : '');
  }
  function sideTypes(st) {
    const active = C.views.list.activeTypes();
    return '<div class="side-sec"><div class="side-sec-head"><span class="eyebrow">Types</span>' +
      (active.size ? '<button type="button" class="side-clear" data-side-clear>Show all</button>' : '') + '</div>' +
      '<ul class="side-types">' + st.types.map((t) => {
        const n = st.tasks.filter((x) => !x.done && x.typeId === t.id).length;
        const on = active.has(t.id);
        return '<li><button type="button" class="side-type' + (on ? ' on' : '') + '" data-side-type="' + t.id + '" aria-pressed="' + on + '" title="' + (on ? 'Show all types' : 'Show only ' + esc(t.name)) + '" style="--c:' + t.color + '">' +
          icon(t.glyph) + '<span>' + esc(t.name) + '</span><span class="mono muted">' + n + '</span></button></li>';
      }).join('') + '</ul></div>';
  }
  function sideLevels(st) {
    const active = C.views.list.activeLevels();
    return '<div class="side-sec"><div class="side-sec-head"><span class="eyebrow">Importance</span>' +
      (active.size ? '<button type="button" class="side-clear" data-side-clear-level>Show all</button>' : '') + '</div>' +
      '<ul class="side-types">' + st.levels.map((l) => {
        const n = st.tasks.filter((x) => !x.done && x.levelId === l.id).length;
        const on = active.has(l.id);
        return '<li><button type="button" class="side-type' + (on ? ' on' : '') + '" data-side-level="' + l.id + '" aria-pressed="' + on + '" title="' + (on ? 'Show all importance levels' : 'Show only ' + esc(l.name)) + '" style="--c:' + l.color + '">' +
          '<i class="dot side-dot"></i><span>' + esc(l.name) + '</span><span class="mono muted">' + n + '</span></button></li>';
      }).join('') + '</ul></div>';
  }
  C.refreshChrome = () => renderChrome();

  /* ---------- storage meter (sidebar) ---------- */
  // The map and the board are each saved as one record, which holds at most 1 MB.
  C.storageLevel = (pct) => (pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok');
  C.storageWord = (pct) => (pct >= 90 ? Math.round(pct) + '% · almost full' : pct >= 70 ? Math.round(pct) + '% · getting full' : pct < 1 ? 'Under 1% used' : Math.round(pct) + '% used');
  function storageMeter(st) {
    if (!st.prefs.showStorage || st.sync.provider !== 'firebase' || !S.storageUse) return '';
    const u = S.storageUse(), m = u.map;
    const lvl = C.storageLevel(Math.max(m.pct, u.board.pct));
    const pctText = m.pct < 1 ? '<1%' : Math.round(m.pct) + '%';
    const sub = m.pct >= 90 ? 'Sync may stop soon. See Settings → Map.'
      : m.nodes ? 'Room for about ' + C.fmtCount(m.more) + ' more nodes' : 'Your map is empty';
    return '<div class="store-meter lvl-' + lvl + '">' +
      '<button type="button" class="sm-link" data-storage-open title="Open storage details in Settings">' +
      '<span class="sm-top"><span class="sm-l">Map storage</span><span class="sm-v mono">' + pctText + '</span></span>' +
      '<span class="sm-bar" role="progressbar" aria-label="Map storage used" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(m.pct) + '"><i style="width:' + Math.max(1, m.pct).toFixed(1) + '%"></i></span>' +
      '<span class="sm-sub">' + sub + '</span>' +
      (u.board.pct >= 50 ? '<span class="sm-sub">Board: ' + Math.round(u.board.pct) + '% used</span>' : '') +
      '</button>' +
      '<button type="button" class="icon-btn sm sm-x" data-storage-hide aria-label="Hide the storage meter" title="Hide. Bring it back in Settings → Map.">' + icon('x') + '</button>' +
      '</div>';
  }
  C.fmtCount = (n) => (n == null ? '–' : n >= 10000 ? Math.round(n / 1000).toLocaleString() + 'k' : n.toLocaleString());

  /* ---------- sync status pill ---------- */
  const SYNC = {
    local: ['device', 'On this device', 'Tasks are saved in this browser only.'],
    connecting: ['cloud', 'Connecting…', 'Connecting to your account…'],
    synced: ['cloud', 'Synced', 'All changes are saved to your account.'],
    saving: ['cloud', 'Saving…', 'Sending changes to your account…'],
    offline: ['cloud', 'Offline', 'You’re offline. Changes are kept here and sent when you reconnect.'],
    error: ['cloud', 'Sync error', 'Sync stopped. Tap for details.']
  };
  C.ago = function (t) {
    if (!t) return 'never';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 10) return 'just now';
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    return C.F.time.format(new Date(t));
  };
  C.syncPill = function (compact) {
    const sy = S.state.sync;
    const [ic, label, tip] = SYNC[sy.status] || SYNC.local;
    const title = sy.status === 'error' && sy.error ? sy.error.title + '. ' + 'Tap for details.'
      : sy.status === 'synced' ? tip + ' Last synced ' + C.ago(sy.lastAt) + '.' : tip;
    return '<button type="button" class="sync-pill s-' + sy.status + (compact ? ' compact' : '') + '" data-sync-pill title="' + esc(title) + '" aria-label="Sync status: ' + esc(label) + '. Open sync details">' +
      '<span class="sync-dot" aria-hidden="true"></span>' + icon(ic) + '<span class="sync-label">' + label + '</span></button>';
  };
  // keep "last synced" tooltips fresh
  setInterval(() => document.querySelectorAll('[data-sync-pill]').forEach((b) => { b.outerHTML = C.syncPill(b.classList.contains('compact')); }), 30000);

  function tab(id, label, ic, n) {
    const on = current === id || (id === 'insights' && (current === 'charts' || current === 'board')) || (label === 'Map' && isMap(current)); // builder and board live under Insights on phones
    return '<a href="#' + id + '" class="tab' + (on ? ' on' : '') + '"' + (on ? ' aria-current="page"' : '') + '>' +
      '<span class="tab-ic">' + icon(ic) + (n ? '<span class="tab-badge mono">' + n + '</span>' : '') + '</span><span>' + label + '</span></a>';
  }

  /* ---------- routing ---------- */
  function route() {
    const r = ROUTES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'list';
    if (r === current) return;
    const prevIdx = ROUTES.indexOf(current);
    C.withTransition(() => {
      if (current && C.views[current].unmount) C.views[current].unmount();
      current = r;
      root.dataset.route = r;
      if (C.map) C.map.closePop();
      const v = document.getElementById('view');
      v.innerHTML = '';
      const fresh = v.cloneNode(false); v.replaceWith(fresh); // drop old listeners
      C.views[r].mount(fresh);
      document.title = C.views[r].title + ' · Cadence';
      renderChrome();
      window.scrollTo(0, 0);
    }, prevIdx < 0 ? null : ROUTES.indexOf(r) > prevIdx ? 'fwd' : 'back');
  }

  /* ---------- global events ---------- */
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-new]') && !e.target.closest('#view')) { e.preventDefault(); C.openEditor(); }
    else if (e.target.closest('[data-new-node]')) { e.preventDefault(); C.map.newNode(); }
    else if (e.target.closest('[data-side-compact]')) { S.setPrefs({ sideCompact: !S.state.prefs.sideCompact }); setTimeout(() => window.dispatchEvent(new Event('resize')), 260); }
    else if (e.target.closest('[data-side-eye]')) C.map.toggleClusterHidden(e.target.closest('[data-side-eye]').dataset.sideEye);
    else if (e.target.closest('[data-side-cluster]')) C.map.clusterClick(e.target.closest('[data-side-cluster]').dataset.sideCluster);
    else if (e.target.closest('[data-side-cluster-clear]')) { C.map.ui.outlineFilter = ''; C.map.ui.table.cluster = ''; C.map.refresh(); }
    else if (e.target.closest('[data-pal]')) C.openPalette();
    else if (e.target.closest('[data-side-dash]')) C.views.board.open(e.target.closest('[data-side-dash]').dataset.sideDash);
    else if (e.target.closest('[data-sync-pill]')) {
      const reveal = () => { const c = document.getElementById('st-sync'); if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); c.classList.add('flash-card'); setTimeout(() => c.classList.remove('flash-card'), 1200); } };
      if (current !== 'settings') { C.go('settings'); setTimeout(reveal, 350); } else reveal();
    }
    else if (e.target.closest('[data-side-type]')) {
      C.views.list.filterType(e.target.closest('[data-side-type]').dataset.sideType);
      if (current !== 'list') C.go('list'); else window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    else if (e.target.closest('[data-side-clear]')) { C.views.list.clearTypes(); if (current !== 'list') C.go('list'); }
    else if (e.target.closest('[data-side-level]')) {
      C.views.list.filterLevel(e.target.closest('[data-side-level]').dataset.sideLevel);
      if (current !== 'list') C.go('list'); else window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    else if (e.target.closest('[data-side-clear-level]')) { C.views.list.clearLevels(); if (current !== 'list') C.go('list'); }
    else if (e.target.closest('[data-theme-toggle]')) C.cycleTheme();
    else if (e.target.closest('[data-storage-hide]')) { S.setPrefs({ showStorage: false }); C.toast('Storage meter hidden. Bring it back in Settings → Map.'); }
    else if (e.target.closest('[data-storage-open]')) {
      const reveal = () => { const c = document.getElementById('st-storage'); if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); c.classList.add('flash-card'); setTimeout(() => c.classList.remove('flash-card'), 1600); } };
      if (current !== 'settings') { C.go('settings'); setTimeout(reveal, 350); } else reveal();
    }
  });

  document.addEventListener('contextmenu', (e) => {
    const b = e.target.closest('[data-side-cluster]');
    if (!b) return;
    e.preventDefault();
    const from = b.dataset.sideCluster;
    C.map.colorPop({ x: Math.min(innerWidth - 200, e.clientX + 10), y: e.clientY, current: from }, (to) => C.map.recolorCluster(from, to));
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return C.openPalette(); }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if (document.querySelector('.sheet-wrap,.pal-wrap,.rec-wrap,.popover')) return;
    if (isMap(current)) {
      const mod = e.metaKey || e.ctrlKey, kk = e.key.toLowerCase();
      if (mod && kk === 'z' && !e.shiftKey) { e.preventDefault(); return C.map.undo(); }
      if (mod && (kk === 'y' || (kk === 'z' && e.shiftKey))) { e.preventDefault(); return C.map.redo(); }
      const v = C.views[current];
      if (v && v.key && v.key(e)) return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === 'n' || k === 'N') { e.preventDefault(); if (isMap(current)) C.map.newNode(); else C.openEditor(); }
    else if (k === '/') { e.preventDefault(); if (isMap(current)) C.openPalette(); else if (current !== 'list') { C.go('list'); setTimeout(() => C.views.list.focusSearch(), 60); } else C.views.list.focusSearch(); }
    else if (/^[1-6]$/.test(k)) C.go(KEY_ROUTES[Number(k) - 1]);
    else if (k === 'd' || k === 'D') C.cycleTheme();
    else if ((k === 't' || k === 'T') && current === 'calendar') C.views.calendar.shift(0);
    else if (k === 'ArrowLeft' && current === 'calendar') C.views.calendar.shift(-1);
    else if (k === 'ArrowRight' && current === 'calendar') C.views.calendar.shift(1);
  });

  window.addEventListener('hashchange', route);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { C.applyTheme(); renderChrome(); });

  /* calendar drops */
  C.drag.init((id, day) => {
    const t = S.get(id); if (!t) return;
    const prev = { due: t.due, time: t.time, moved: t.moved || 0, pushed: t.pushed || 0 };
    if ((t.due || null) === (day || null)) return;
    S.updateTask(id, day ? { due: day } : { due: null, time: null });
    C.toast(day ? 'Moved to ' + C.F.long.format(D.parse(day)) : 'Unscheduled “' + t.title + '”', { action: 'Undo', onAction: () => S.updateTask(id, prev) });
  });

  /* ---------- delight: completion bursts ---------- */
  function burst(anchor, n) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = anchor.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const colors = S.state.types.map((t) => t.color).concat(S.state.levels.map((l) => l.color));
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i');
      s.className = 'spark';
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.4, dist = 18 + Math.random() * 22;
      s.style.cssText = 'left:' + cx + 'px;top:' + cy + 'px;--dx:' + Math.cos(a) * dist + 'px;--dy:' + Math.sin(a) * dist + 'px;--c:' + colors[i % colors.length];
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 700);
    }
  }
  function bigBurst() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const colors = S.state.types.map((t) => t.color).concat(S.state.levels.map((l) => l.color));
    for (let i = 0; i < 48; i++) {
      const s = document.createElement('i');
      s.className = 'confetti';
      s.style.cssText = 'left:' + (Math.random() * 100) + 'vw;--c:' + colors[i % colors.length] + ';--r:' + (Math.random() * 720 - 360) + 'deg;--d:' + (900 + Math.random() * 900) + 'ms;--x:' + (Math.random() * 80 - 40) + 'px;animation-delay:' + (Math.random() * 200) + 'ms';
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 2200);
    }
  }

  /* ---------- boot ---------- */
  let raf = 0;
  /** Draw again (e.g. when people's photos arrive). */
  C.repaint = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (!current) return; renderChrome(); C.views[current].update(); }); };
  S.subscribe(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!current) return;
      renderChrome();
      C.views[current].update();
    });
  });
  // refresh "today" when the date rolls over while the app is open
  let lastDay = D.todayKey();
  setInterval(() => { if (D.todayKey() !== lastDay) { lastDay = D.todayKey(); const r = current; current = null; location.hash = r; route(); } }, 60000);

  if (!early) C.applyTheme(); // with boot.js's choice in place, wait for your saved settings before changing anything
  route();
  S.init().then(() => { C.applyTheme(); });
})();
