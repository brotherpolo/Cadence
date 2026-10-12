/* Cadence — Settings: task types, importance levels, preferences, data */
(function () {
  const C = window.Cadence;
  const { esc, icon } = C;
  const S = () => C.store;
  const SWATCHES = ['#E5383B', '#F08A24', '#D9A400', '#4C9A2A', '#0E8F7E', '#1F8FBF', '#3B6FE0', '#5B5BD6', '#8A55D6', '#D23F6E', '#C2410C', '#8C94A6'];
  const ui = { pop: null, confirm: null, reset: false, msg: null };
  let el = null;

  const view = (C.views = C.views || {}).settings = {
    title: 'Settings',
    mount(root) {
      el = root;
      root.innerHTML = '<section class="page settings-page"><header class="page-head"><p class="eyebrow">Make it yours</p><h1 class="display">Settings</h1></header><div id="st-root"></div></section>';
      root.addEventListener('click', onClick);
      root.addEventListener('change', onChange);
      view.update();
    },
    update() {
      if (!el) return;
      const a = document.activeElement;
      if (a && el.contains(a) && a.matches('input[type=text]') && !ui.force) return; // don't clobber typing
      ui.force = false;
      render();
    },
    unmount() { el = null; }
  };

  function count(field, id) { return S().state.tasks.filter((t) => t[field] === id).length; }

  function render() {
    const st = S().state, p = st.prefs;
    const types = st.types, levels = st.levels;
    el.querySelector('#st-root').innerHTML =
      '<div class="st-grid">' +

      section('Task types', 'Group tasks by the kind of work. Colors show on the calendar.',
        '<ul class="st-list">' + types.map((t, i) => itemRow('type', t, i, types.length, count('typeId', t.id))).join('') + '</ul>' +
        '<button type="button" class="btn add-row" data-add="type">' + icon('plus') + '<span>Add type</span></button>') +

      section('Importance levels', 'Ordered from most to least important. Sorting and the calendar follow this order.',
        '<ul class="st-list">' + levels.map((l, i) => itemRow('level', l, i, levels.length, count('levelId', l.id))).join('') + '</ul>' +
        '<button type="button" class="btn add-row" data-add="level">' + icon('plus') + '<span>Add level</span></button>' +
        '<p class="fine">Quick add: type <b>!' + esc((levels[0] || { name: 'high' }).name.toLowerCase()) + '</b>, <b>!1</b> for the top level, or <b>!!</b> as a shortcut for it.</p>') +

      section('Preferences', 'Saved on this device.',
        prefRow('Appearance', seg('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], p.theme)) +
        prefRow('Week starts on', seg('weekStart', [['0', 'Sunday'], ['1', 'Monday']], String(p.weekStart))) +
        // same pills as the task editor, so the default looks like what you'll get
        '<div class="pref pref-stack"><span class="pref-l">New tasks are</span>' +
          '<div class="pref-def"><span class="field-label" id="st-deflevel-l">Importance</span><div class="seg" role="radiogroup" aria-labelledby="st-deflevel-l">' +
          levels.map((l) => { const on = p.defaultLevel === l.id || (!levels.some((x) => x.id === p.defaultLevel) && l === levels[0]); return '<button type="button" role="radio" class="seg-btn' + (on ? ' on' : '') + '" data-defpref="defaultLevel" data-val="' + l.id + '" aria-checked="' + on + '" style="--c:' + l.color + '"><i class="dot"></i>' + esc(l.name) + '</button>'; }).join('') + '</div></div>' +
          '<div class="pref-def"><span class="field-label" id="st-deftype-l">Type</span><div class="chips" role="radiogroup" aria-labelledby="st-deftype-l">' +
          '<button type="button" role="radio" class="chip' + (!p.defaultType ? ' on' : '') + '" data-defpref="defaultType" data-val="" aria-checked="' + !p.defaultType + '">None</button>' +
          types.map((t) => '<button type="button" role="radio" class="chip' + (p.defaultType === t.id ? ' on' : '') + '" data-defpref="defaultType" data-val="' + t.id + '" aria-checked="' + (p.defaultType === t.id) + '" style="--c:' + t.color + '">' + icon(t.glyph) + esc(t.name) + '</button>').join('') + '</div></div>' +
        '</div>') +

      (C.push ? section('Notifications', 'Reminders and updates as push notifications, on any device you turn them on for.', notifyCard()) : '') +

      section('Your data', '',
        syncCard(st) +
        '<div class="btn-row">' +
        '<button type="button" class="btn" data-act="xlsxExport"' + (ui.xlsxBusy ? ' disabled' : '') + '>' + icon('table') + '<span>' + (ui.xlsxBusy === 'export' ? 'Preparing…' : 'Export to Excel') + '</span></button>' +
        '<label class="btn' + (ui.xlsxBusy ? ' disabled' : '') + '" for="st-xlsx">' + icon('upload') + '<span>' + (ui.xlsxBusy === 'import' ? 'Importing…' : 'Import from Excel') + '</span></label><input id="st-xlsx" type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" class="sr"' + (ui.xlsxBusy ? ' disabled' : '') + '>' +
        '</div>' +
        '<p class="fine">The spreadsheet has one row per task. Edit it in Excel, Numbers or Google Sheets, then import it: rows with an ID update that task, rows without one become new tasks.</p>' +
        '<div class="btn-row">' +
        '<button type="button" class="btn" data-act="export">' + icon('download') + '<span>Export backup (JSON)</span></button>' +
        '<label class="btn" for="st-import">' + icon('upload') + '<span>Import backup (JSON)</span></label><input id="st-import" type="file" accept="application/json,.json" class="sr">' +
        '<button type="button" class="btn" data-act="copy">' + icon('note') + '<span>Copy as JSON</span></button>' +
        '</div>' +
        '<div class="btn-row">' +
        '<button type="button" class="btn" data-act="samples">' + icon('sparkle') + '<span>Add example tasks</span></button>' +
        '<button type="button" class="btn" data-act="clearDone">' + icon('check') + '<span>Delete completed (' + st.tasks.filter((t) => t.done).length + ')</span></button>' +
        (ui.reset
          ? '<span class="confirm">Delete every task and the map, and restore default settings? <button type="button" class="btn sm danger-solid" data-act="resetYes">Erase everything</button><button type="button" class="btn sm ghost" data-act="resetNo">Keep my data</button></span>'
          : '<button type="button" class="btn ghost danger" data-act="reset">' + icon('trash') + '<span>Reset everything</span></button>') +
        '</div>' + (ui.msg ? '<p class="fine status-msg">' + esc(ui.msg) + '</p>' : '') +
        '<textarea id="st-json" class="sr" readonly aria-hidden="true" tabindex="-1"></textarea>') +

      mapSection(st) +

      section('Keyboard shortcuts', '',
        '<dl class="keys">' + [['N', 'New task, or node on the map'], ['/', 'Search tasks'], ['⌘K / Ctrl K', 'Command menu'], ['1 – 6', 'Tasks, Calendar, Canvas, Outline, Table, Insights'], ['← →', 'Previous / next on the calendar'], ['T', 'Jump to today'], ['D', 'Cycle light / dark'], ['X', 'Complete the focused task'], ['⌘↵', 'Save in the editor'], ['⌘Z ⌘⇧Z', 'Undo / redo on the map'], ['Tab ↵', 'Canvas: add child / sibling'], ['V H C A', 'Canvas: select, pan, connect, flow']].map(([k, v]) => '<div><dt>' + k.split(' ').map((x) => /^[·/]$/.test(x) && k.length > 2 ? '<span class="muted">' + x + '</span>' : '<kbd>' + x + '</kbd>').join('') + '</dt><dd>' + v + '</dd></div>').join('') + '</dl>') +

      '</div>';
  }

  function mapSection(st) {
    const m = C.map;
    if (!m) return '';
    const n = m.nodes().length, cl = n ? m.clusters().length : 0;
    const linked = st.tasks.filter((t) => t.nodeId && m.getNode(t.nodeId)).length;
    const legacy = m.legacyLocal();
    return section('Map', 'The Canvas, Outline and Table pages share one map. It syncs with your account, privately. Tasks can link to any node.',
      '<dl class="sync-facts map-facts"><div><dt>Nodes</dt><dd class="mono">' + n + '</dd></div><div><dt>Clusters</dt><dd class="mono">' + cl + '</dd></div><div><dt>Linked tasks</dt><dd class="mono">' + linked + '</dd></div></dl>' +
      '<div class="btn-row">' +
      '<label class="btn" for="st-workmap">' + icon('upload') + '<span>Import a Workmap backup</span></label><input id="st-workmap" type="file" accept="application/json,.json" class="sr">' +
      (legacy ? '<button type="button" class="btn" data-act="legacy">' + icon('download') + '<span>Bring in Workmap from this browser (' + legacy.nodes.length + ' nodes)</span></button>' : '') +
      '<a class="btn" href="#canvas">' + icon('canvas') + '<span>Open the canvas</span></a>' +
      (n ? '<button type="button" class="btn ghost danger" data-act="clearMap">' + icon('trash') + '<span>Clear the map</span></button>' : '') +
      '</div>' +
      '<p class="fine">In Workmap, choose <b>Export → Download backup (.json)</b>, then import that file here. It replaces this map, and its tasks are added to your list, linked to their nodes. Importing the same file twice won’t duplicate tasks. The JSON backup above includes the map.</p>');
  }

  function syncCard(st) {
    const sy = st.sync, fb = C.firebaseSync;
    const head = {
      local: fb && fb.enabled ? ['Saved in this browser', 'Not connected to your account. Press Retry to connect.']
        : fb && fb.reason === 'no-config' ? ['Sync is off: Firebase isn’t configured', 'firebase-config.js has an empty apiKey or projectId, so sign-in and sync are turned off. Paste your web app config from Firebase console → Project settings → Your apps into firebase-config.js and upload it.']
        : fb && fb.reason === 'no-file' ? ['Sync is off: firebase-config.js didn’t load', 'The page couldn’t find firebase-config.js next to index.html. Upload it to the same folder.']
        : ['Saved in this browser', 'Tasks stay on this device. Export a backup to move them somewhere else.'],
      connecting: ['Connecting…', 'Reaching your account.'],
      synced: ['Synced to your account', 'Your tasks follow you to every device you sign in on. A task is visible only to you and the person it’s assigned to.'],
      saving: ['Saving changes…', sy.pending + ' change' + (sy.pending === 1 ? '' : 's') + ' on the way.'],
      offline: ['Offline', 'Changes are kept on this device and sent when you’re back online.'],
      error: ['Sync isn’t working', 'Your changes are safe on this device. Fix the problem below, then press Retry.']
    }[sy.status] || ['Saved in this browser', ''];
    const rows = [];
    if (sy.provider) rows.push(['Service', sy.provider === 'firebase' ? 'Firebase' + (fb && fb.projectId ? ' · <span class="mono">' + esc(fb.projectId) + '</span>' : '') : 'Claude account']);
    if (fb && fb.user) {
      const how = { 'google.com': 'Google', password: 'email + password' }[fb.user.method] || fb.user.method;
      rows.push(['Signed in as', '<span class="mono">' + esc(fb.user.email || fb.user.name || 'you') + '</span> <span class="muted">(' + esc(how) + ')</span>']);
      rows.push(['Can receive tasks', fb.user.verified ? 'Yes, others can assign to <span class="mono">' + esc(fb.user.email || '') + '</span>' : '<span class="muted">No. Verify your email address, or sign in with Google, so others can assign you tasks.</span>']);
      rows.push(['Account ID', '<span class="mono">' + esc(fb.user.uid.slice(0, 8)) + '</span> <span class="muted">must match on every device</span>']);
    }
    if (sy.provider) rows.push(['Last synced', esc(C.ago(sy.lastAt))]);
    rows.push(['On this device', '<span class="mono">' + st.tasks.length + '</span> tasks']);
    if (sy.provider) rows.push(['In the cloud', sy.cloudCount == null ? '<span class="muted">not reached yet</span>' : '<span class="mono">' + sy.cloudCount + '</span> tasks']);
    rows.push(['App version', '<span class="mono">' + esc(C.VERSION || '?') + '</span>']);
    const err = sy.status === 'error' && sy.error;
    const off = sy.status === 'local' && fb && (fb.reason === 'no-config' || fb.reason === 'no-file');
    return '<div class="sync-card s-' + sy.status + (off ? ' s-error' : '') + '" id="st-sync">' +
      '<div class="sync-top">' + C.syncPill() + '<span class="spacer"></span>' +
      (sy.provider || (fb && fb.enabled) ? '<button type="button" class="btn sm" data-act="retry"' + (sy.status === 'connecting' ? ' disabled' : '') + '>' + icon('repeat') + '<span>Retry sync</span></button>' : '') +
      (fb && fb.user ? '<button type="button" class="btn sm ghost" data-act="signout">Sign out</button>' : '') + '</div>' +
      '<div><b>' + head[0] + '</b><p>' + head[1] + '</p></div>' +
      (err ? '<div class="sync-err" role="alert"><b>' + esc(err.title) + '</b><p>' + esc(err.hint) + '</p>' +
        '<p class="mono sync-raw">' + esc(err.code) + (err.doc ? ' · ' + esc(err.doc) : '') + (err.raw && err.raw !== err.hint ? ' · ' + esc(err.raw) : '') + '</p></div>' : '') +
      '<dl class="sync-facts">' + rows.map(([k, v]) => '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>').join('') + '</dl>' +
      '</div>';
  }

  /* ---------- push notifications (push.js does the work) ---------- */
  function notifyCard() {
    const P = C.push, st = P.status(), pr = P.prefs;
    const msg = {
      'no-sync': ['Needs sign-in', 'Notifications come from your Firebase account, so turn on sign-in and sync first (README → Turn on sign-in and sync).'],
      'signed-out': ['Needs sign-in', 'Sign in to turn on notifications.'],
      'ios-install': ['Add Cadence to your Home Screen first', 'On iPhone and iPad, web notifications only work in an installed app (iOS 16.4 or later). Tap the Share button, choose “Add to Home Screen”, open Cadence from the new icon, and come back here.'],
      unsupported: ['Not available in this browser', 'This browser can’t receive web push notifications. Chrome, Edge, Firefox and Safari 16 or later can.'],
      'no-vapid': ['One setup step left', 'Add your Web Push key to firebase-config.js as window.CADENCE_VAPID_KEY. README → Push notifications shows where to find it.'],
      blocked: ['Blocked for this site', 'Notifications were turned down in this browser. Allow them in the site settings (the icon left of the address bar), then reload.'],
      off: ['Off on this device', 'Turn them on here, and on every phone or computer you want them on.'],
      on: ['On for this device', P.device ? P.device.label : '']
    }[st];
    const toggle = (key, label, sub) => '<label class="nt-opt"><input type="checkbox" data-np="' + key + '"' + (pr && pr[key] ? ' checked' : '') + (pr ? '' : ' disabled') + '><span><b>' + label + '</b><span class="muted">' + sub + '</span></span></label>';
    const leads = [[0, 'at the due time'], [5, '5 minutes before'], [10, '10 minutes before'], [15, '15 minutes before'], [30, '30 minutes before'], [60, '1 hour before']];
    const signedIn = st !== 'no-sync' && st !== 'signed-out';
    return '<div class="nt-card s-' + st + '">' +
      '<div class="nt-top"><span class="nt-ic">' + icon(st === 'on' ? 'check' : st === 'blocked' || st === 'unsupported' ? 'x' : 'bolt') + '</span><div><b>' + esc(msg[0]) + '</b><p class="muted">' + esc(msg[1]) + '</p></div></div>' +
      (P.error ? '<p class="nt-err" role="alert">' + esc(P.error) + '</p>' : '') +
      '<div class="btn-row">' +
      (st === 'off' ? '<button type="button" class="btn primary sm" data-act="pushOn"' + (P.busy ? ' disabled' : '') + '>' + icon('bolt') + '<span>' + (P.busy ? 'Turning on…' : 'Turn on for this device') + '</span></button>' : '') +
      (st === 'on' ? '<button type="button" class="btn sm" data-act="pushTest">' + icon('sparkle') + '<span>Send a test</span></button><button type="button" class="btn sm ghost" data-act="pushOff"' + (P.busy ? ' disabled' : '') + '>Turn off on this device</button>' : '') +
      '</div>' +
      (signedIn ? '<div class="nt-opts">' +
        toggle('due', 'Due-time reminders', 'For a task with a time: ' + '<select data-np-lead' + (pr ? '' : ' disabled') + '>' + leads.map(([v, l]) => '<option value="' + v + '"' + (pr && +pr.lead === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>. Tasks due that day with no time are listed in the morning summary.') +
        toggle('digest', 'Overdue in the morning summary', 'Adds anything overdue to the morning summary.') +
        '<label class="nt-time"><span>Morning summary at</span><span class="input-wrap sm">' + icon('clock') + '<input type="time" data-np-morning value="' + esc((pr && pr.morning) || '08:00') + '"' + (pr ? '' : ' disabled') + '></span><span class="muted">' + esc((pr && pr.tz) || Intl.DateTimeFormat().resolvedOptions().timeZone || '') + '</span></label>' +
        toggle('assigned', 'Assigned to me', 'When someone gives you a task.') +
        toggle('finished', 'My shared task is done', 'When someone finishes a task you gave them.') +
        '</div>' +
        '<p class="fine">These choices apply to every device you turn notifications on for. Reminders can arrive up to 5 minutes after their time. Task names appear in notifications, including on a locked screen.</p>' : '') +
      '</div>';
  }

  function section(title, sub, inner) {
    return '<section class="st-sec"><header><h2>' + title + '</h2>' + (sub ? '<p class="muted">' + sub + '</p>' : '') + '</header>' + inner + '</section>';
  }
  function prefRow(label, ctl) { return '<div class="pref"><span class="pref-l">' + label + '</span>' + ctl + '</div>'; }
  function seg(key, opts, val) {
    return '<div class="seg mini" role="radiogroup">' + opts.map(([v, l]) => '<button type="button" role="radio" aria-checked="' + (v === val) + '" class="seg-btn' + (v === val ? ' on' : '') + '" data-seg="' + key + '" data-val="' + v + '">' + l + '</button>').join('') + '</div>';
  }

  function itemRow(kind, it, i, n, used) {
    const key = kind + ':' + it.id;
    const isDefault = kind === 'level' && S().state.prefs.defaultLevel === it.id;
    const confirming = ui.confirm === key;
    return '<li class="st-item' + (confirming ? ' confirming' : '') + '" style="--c:' + it.color + '">' +
      '<button type="button" class="swatch" data-pop="' + key + '" aria-label="Change color" aria-expanded="' + (ui.pop === key) + '">' + (kind === 'type' ? icon(it.glyph) : '<i class="dot"></i>') + '</button>' +
      (kind === 'level' ? '<span class="rank mono" title="Rank">' + (i + 1) + '</span>' : '') +
      '<label class="sr" for="st-name-' + it.id + '">Name</label><input type="text" id="st-name-' + it.id + '" class="st-name" value="' + esc(it.name) + '" data-rename="' + key + '" maxlength="24">' +
      (isDefault ? '<span class="badge">Default</span>' : '') +
      '<span class="st-used mono muted" title="Tasks using this">' + used + '</span>' +
      '<div class="st-acts">' +
      '<button type="button" class="icon-btn sm" data-move="' + key + '" data-dir="-1" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>' + icon('up') + '</button>' +
      '<button type="button" class="icon-btn sm" data-move="' + key + '" data-dir="1" aria-label="Move down"' + (i === n - 1 ? ' disabled' : '') + '>' + icon('down') + '</button>' +
      '<button type="button" class="icon-btn sm" data-del="' + key + '" aria-label="Delete"' + (kind === 'level' && n <= 1 ? ' disabled' : '') + '>' + icon('trash') + '</button></div>' +
      (confirming ? '<div class="st-confirm">' + (used ? used + ' task' + (used === 1 ? '' : 's') + (kind === 'type' ? ' will have no type.' : ' will move to “' + esc(fallbackLevel(it.id).name) + '”.') : 'No tasks use this.') +
        ' <button type="button" class="btn sm danger-solid" data-delyes="' + key + '">Delete ' + esc(it.name) + '</button><button type="button" class="btn sm ghost" data-delno>Cancel</button></div>' : '') +
      (ui.pop === key ? '<div class="pop">' +
        '<div class="swatches">' + SWATCHES.map((c) => '<button type="button" class="sw' + (c.toLowerCase() === it.color.toLowerCase() ? ' on' : '') + '" style="--c:' + c + '" data-color="' + key + '" data-val="' + c + '" aria-label="Color ' + c + '"></button>').join('') + '</div>' +
        (kind === 'type' ? '<div class="glyphs">' + C.GLYPHS.map((g) => '<button type="button" class="gl' + (g === it.glyph ? ' on' : '') + '" data-glyph="' + key + '" data-val="' + g + '" aria-label="Icon ' + g + '">' + icon(g) + '</button>').join('') + '</div>' : '') +
        '</div>' : '') +
      '</li>';
  }

  function fallbackLevel(excludeId) {
    const ls = S().state.levels.filter((l) => l.id !== excludeId);
    return ls.find((l) => l.id === S().state.prefs.defaultLevel) || ls[Math.floor(ls.length / 2)] || ls[0];
  }

  function listFor(kind) { return C.clone(kind === 'type' ? S().state.types : S().state.levels); }
  function save(kind, list) { ui.force = true; kind === 'type' ? S().setTypes(list) : S().setLevels(list); }
  function split(key) { const i = key.indexOf(':'); return [key.slice(0, i), key.slice(i + 1)]; }

  async function onClick(e) {
    const b = e.target.closest('button'); if (!b) { if (ui.pop && !e.target.closest('.pop')) { ui.pop = null; render(); } return; }
    const d = b.dataset;
    if (d.pop) { ui.pop = ui.pop === d.pop ? null : d.pop; return render(); }
    if (d.color || d.glyph) {
      const [kind, id] = split(d.color || d.glyph);
      const list = listFor(kind); const it = list.find((x) => x.id === id);
      if (d.color) it.color = d.val; else it.glyph = d.val;
      return save(kind, list);
    }
    if (d.move) {
      const [kind, id] = split(d.move);
      const list = listFor(kind); const i = list.findIndex((x) => x.id === id); const j = i + Number(d.dir);
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      return save(kind, list);
    }
    if (d.del) { ui.confirm = d.del; ui.pop = null; return render(); }
    if (b.hasAttribute('data-delno')) { ui.confirm = null; return render(); }
    if (d.delyes) {
      const [kind, id] = split(d.delyes);
      const list = listFor(kind).filter((x) => x.id !== id);
      if (kind === 'type') {
        S().state.tasks.filter((t) => t.typeId === id).forEach((t) => S().updateTask(t.id, { typeId: null }));
        if (S().state.prefs.defaultType === id) S().setPrefs({ defaultType: null });
      } else {
        const fb = fallbackLevel(id);
        S().state.tasks.filter((t) => t.levelId === id).forEach((t) => S().updateTask(t.id, { levelId: fb.id }));
        if (S().state.prefs.defaultLevel === id) S().setPrefs({ defaultLevel: fb.id });
      }
      ui.confirm = null;
      return save(kind, list);
    }
    if (d.add) {
      const kind = d.add, list = listFor(kind);
      const used = new Set(list.map((x) => x.color));
      const color = SWATCHES.find((c) => !used.has(c)) || SWATCHES[list.length % SWATCHES.length];
      const it = kind === 'type'
        ? { id: C.uid('ty'), name: 'New type', color, glyph: C.GLYPHS[list.length % C.GLYPHS.length] }
        : { id: C.uid('lv'), name: 'New level', color };
      list.push(it);
      save(kind, list);
      const inp = el.querySelector('#st-name-' + it.id); if (inp) { inp.focus(); inp.select(); }
      return;
    }
    if (d.defpref) { ui.force = true; return S().setPrefs({ [d.defpref]: d.val || null }); }
    if (d.seg) {
      const v = d.seg === 'weekStart' ? Number(d.val) : d.val;
      S().setPrefs({ [d.seg]: v });
      if (d.seg === 'theme') C.applyTheme();
      return;
    }
    const act = d.act;
    if (act === 'signout') return C.firebaseSync.signOut();
    if (act === 'retry') { const ok = await S().retrySync(); ui.force = true; render(); return C.toast(ok ? 'Reconnected. Sending your changes now.' : 'Still can’t connect. See the details under Your data.'); }
    if (act === 'pushOn') return C.push.enable();
    if (act === 'pushOff') return C.push.disable();
    if (act === 'pushTest') return C.push.test();
    if (act === 'export') return exportData();
    if (act === 'xlsxExport') return exportXlsx();
    if (act === 'copy') return copyData();
    if (act === 'legacy') { C.map.importWorkmap(C.map.legacyLocal()); ui.force = true; return render(); }
    if (act === 'clearMap') { C.map.clearMap(); ui.force = true; return render(); }
    if (act === 'samples') { S().loadSamples(); return C.toast('Added example tasks. Clear them any time from the Tasks page.'); }
    if (act === 'clearDone') {
      const gone = S().clearCompleted();
      if (!gone.length) return C.toast('No completed tasks to delete.');
      return C.toast('Deleted ' + gone.length + ' completed task' + (gone.length === 1 ? '' : 's'), { action: 'Undo', onAction: () => gone.forEach((t) => S().restoreTask(t)) });
    }
    if (act === 'reset') { ui.reset = true; return render(); }
    if (act === 'resetNo') { ui.reset = false; return render(); }
    if (act === 'resetYes') { ui.reset = false; S().resetAll(); C.applyTheme(); return C.toast('Everything was reset. Types and levels are back to defaults.'); }
  }

  function onChange(e) {
    const t = e.target;
    if (t.dataset.np) return C.push.save({ [t.dataset.np]: t.checked });
    if (t.hasAttribute('data-np-lead')) return C.push.save({ lead: +t.value });
    if (t.hasAttribute('data-np-morning')) { if (/^\d{2}:\d{2}$/.test(t.value)) C.push.save({ morning: t.value }); return; }
    if (t.dataset.rename) {
      const [kind, id] = split(t.dataset.rename);
      const v = t.value.trim();
      const list = listFor(kind); const it = list.find((x) => x.id === id);
      if (!v) { t.value = it.name; return; }
      if (it.name === v) return;
      it.name = v;
      return save(kind, list);
    }
    if (t.dataset.pref) { ui.force = true; return S().setPrefs({ [t.dataset.pref]: t.value || null }); }
    if (t.id === 'st-workmap' && t.files && t.files[0]) { const f = t.files[0]; t.value = ''; return C.map.importFile(f).then(() => { ui.force = true; render(); }).catch(() => {}); }
    if (t.id === 'st-xlsx' && t.files && t.files[0]) { const f = t.files[0]; t.value = ''; return importXlsx(f); }
    if (t.id === 'st-import' && t.files && t.files[0]) {
      const f = t.files[0];
      const r = new FileReader();
      r.onload = () => {
        try {
          const res = S().importJSON(String(r.result));
          ui.msg = res.workmap ? 'Imported the Workmap map (' + res.nodes + ' nodes) and ' + res.added + ' tasks from ' + f.name + '.' : 'Imported ' + res.total + ' tasks (' + res.added + ' new) from ' + f.name + '.';
          ui.force = true; render();
          C.toast('Import complete');
        } catch (err) {
          ui.msg = err instanceof SyntaxError ? f.name + ' is not valid JSON. Choose a backup exported from Cadence.' : err.message;
          ui.force = true; render();
        }
      };
      r.readAsText(f);
      t.value = '';
    }
  }

  async function exportData() {
    const json = S().exportJSON();
    const name = 'cadence-backup-' + C.D.todayKey() + '.json';
    const cl = window.claude;
    if (cl && cl.use) {
      const dl = await cl.use('downloads').catch(() => null);
      if (dl) {
        try { const r = await dl.save({ filename: name, data: json }); if (r && r.status === 'saved') C.toast('Backup saved as ' + name); return; }
        catch (err) { if (err && err.code === 'declined') return; }
      }
      return copyData('Downloads are not available here, so the backup was copied to your clipboard.');
    }
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    C.toast('Backup saved as ' + name);
  }

  /* ---------- Excel import / export (SheetJS, loaded only when used) ---------- */
  const XLSX_SRC = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
  let xlsxLib = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxLib) {
      xlsxLib = new Promise((res, rej) => {
        const sc = document.createElement('script');
        sc.src = XLSX_SRC;
        sc.onload = () => (window.XLSX ? res(window.XLSX) : rej(new Error('The spreadsheet tool didn’t load.')));
        sc.onerror = () => { xlsxLib = null; rej(new Error('Couldn’t load the spreadsheet tool. Check your connection and try again.')); };
        document.head.appendChild(sc);
      });
    }
    return xlsxLib;
  }

  const COLS = ['Title', 'Due date', 'Time', 'Type', 'Importance', 'Repeat', 'Done', 'Checklist', 'Notes', 'Assigned to', 'Times rescheduled', 'ID'];
  // header names people might use instead, all lowercase
  const ALIASES = {
    title: ['title', 'task', 'name', 'task name'],
    due: ['due date', 'due', 'date', 'deadline'],
    time: ['time', 'due time'],
    type: ['type', 'category', 'list', 'project'],
    level: ['importance', 'priority', 'level'],
    repeat: ['repeat', 'repeats', 'recurrence'],
    done: ['done', 'completed', 'complete', 'status'],
    checklist: ['checklist', 'steps', 'subtasks', 'sub-tasks'],
    notes: ['notes', 'note', 'details', 'description'],
    id: ['id', 'task id']
  };
  const EPOCH = Date.UTC(1899, 11, 30);
  const pad2 = (n) => String(n).padStart(2, '0');
  const keyToSerial = (k) => { const [y, m, d] = k.split('-').map(Number); return (Date.UTC(y, m - 1, d) - EPOCH) / 864e5; };
  const serialToKey = (n) => { const d = new Date(EPOCH + Math.floor(n) * 864e5); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); };
  const time12 = (hm) => { const [h, m] = hm.split(':').map(Number); return ((h % 12) || 12) + ':' + pad2(m) + ' ' + (h < 12 ? 'AM' : 'PM'); };

  async function exportXlsx() {
    ui.xlsxBusy = 'export'; ui.force = true; render();
    try {
      const X = await loadXlsx();
      const st = S().state;
      const repLabel = (id) => (C.REPEATS.find((r) => r.id === id) || C.REPEATS[0]).label;
      const tasks = st.tasks.slice().sort((a, b) => (a.done - b.done) || ((a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : (a.time || '99') < (b.time || '99') ? -1 : 1));
      const rows = [COLS];
      tasks.forEach((t) => {
        const ty = S().typeOf(t), lv = S().levelOf(t);
        const who = S().isAssignedToMe(t) ? 'From ' + (t.ownerEmail || t.ownerName || 'someone else') : (t.assigneeId ? (t.assigneeEmail || t.assigneeName || '') : '');
        rows.push([
          t.title || '',
          t.due ? keyToSerial(t.due) : '',
          t.time ? time12(t.time) : '',
          ty ? ty.name : '',
          lv ? lv.name : '',
          t.repeat && t.repeat !== 'none' ? repLabel(t.repeat) : '',
          t.done ? 'Yes' : '',
          (t.subtasks || []).map((x) => (x.done ? '[x] ' : '[ ] ') + x.title).join('\n'),
          t.notes || '',
          who,
          t.moved || 0,
          t.id
        ]);
      });
      const ws = X.utils.aoa_to_sheet(rows);
      for (let r = 1; r < rows.length; r++) { const c = ws[X.utils.encode_cell({ r, c: 1 })]; if (c && c.t === 'n') c.z = 'yyyy-mm-dd'; }
      ws['!cols'] = [{ wch: 40 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 7 }, { wch: 40 }, { wch: 40 }, { wch: 26 }, { wch: 10 }, { wch: 22 }];
      ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 1), c: COLS.length - 1 } }) };

      const help = X.utils.aoa_to_sheet([
        ['How to edit this spreadsheet'],
        [''],
        ['Column', 'What to put in it'],
        ['Title', 'Required. Rows with no title are skipped.'],
        ['Due date', 'A date (2026-10-14, 10/14/2026) or words like “tomorrow” or “fri”. Leave blank for no date.'],
        ['Time', 'For example 3:00 PM, 15:00 or 9am. Ignored when there is no due date.'],
        ['Type', 'One of: ' + st.types.map((x) => x.name).join(', ') + '. Leave blank for none.'],
        ['Importance', 'One of: ' + st.levels.map((x) => x.name).join(', ') + '. Blank uses your default.'],
        ['Repeat', 'Every day, Every weekday, Every week or Every month. Blank means it doesn’t repeat.'],
        ['Done', 'Yes for completed tasks, blank for open ones.'],
        ['Checklist', 'One step per line (Alt+Enter in Excel, Ctrl+Enter in Google Sheets). Start a line with [x] to mark it done.'],
        ['Notes', 'Anything you like.'],
        ['Assigned to', 'For reference only. Change who a task is assigned to in the app.'],
        ['ID', 'Keep it to update that task. Leave it blank (or delete it) to add a new task.'],
        [''],
        ['Deleting a row here does not delete the task in Cadence. Tasks someone else assigned to you are skipped on import.']
      ]);
      help['!cols'] = [{ wch: 14 }, { wch: 100 }];

      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, ws, 'Tasks');
      X.utils.book_append_sheet(wb, help, 'How to edit');
      const name = 'cadence-tasks-' + C.D.todayKey() + '.xlsx';
      const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
      const url = URL.createObjectURL(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      C.toast('Exported ' + tasks.length + ' task' + (tasks.length === 1 ? '' : 's') + ' to ' + name);
    } catch (err) {
      ui.msg = 'Excel export failed: ' + (err && err.message || err);
    }
    ui.xlsxBusy = null; ui.force = true; render();
  }

  async function importXlsx(file) {
    ui.xlsxBusy = 'import'; ui.msg = null; ui.force = true; render();
    try {
      const X = await loadXlsx();
      const buf = await file.arrayBuffer();
      const wb = X.read(buf, { type: 'array' });
      const sheetName = wb.SheetNames.find((n) => n.toLowerCase() === 'tasks') || wb.SheetNames[0];
      const grid = X.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: '' });
      const res = rowsToTasks(grid);
      if (!res.items.length) throw new Error(res.error || 'No tasks found in ' + file.name + '. The first row should be column headings with a “Title” column.');
      const keep = !(C.firebaseSync && C.firebaseSync.enabled);
      const r = S().importTasks(res.items, keep);
      const parts = [];
      if (r.added) parts.push(r.added + ' added');
      if (r.updated) parts.push(r.updated + ' updated');
      if (r.skipped) parts.push(r.skipped + ' assigned to you by someone else, skipped');
      if (res.blank) parts.push(res.blank + ' row' + (res.blank === 1 ? '' : 's') + ' without a title skipped');
      ui.msg = 'Imported ' + file.name + ': ' + (parts.join(', ') || 'nothing changed') + '.' + (res.unknown.length ? ' Not recognized (left blank): ' + res.unknown.slice(0, 6).join(', ') + (res.unknown.length > 6 ? '…' : '') + '.' : '');
      C.toast('Import complete');
    } catch (err) {
      ui.msg = (err && err.message) || 'Couldn’t read that file. Choose an .xlsx or .csv file.';
    }
    ui.xlsxBusy = null; ui.force = true; render();
  }

  function rowsToTasks(grid) {
    const st = S().state;
    // find the header row (first row that has a title-like column)
    let hr = -1, map = {};
    for (let r = 0; r < Math.min(grid.length, 10) && hr < 0; r++) {
      const m = {};
      grid[r].forEach((h, c) => {
        const k = String(h).trim().toLowerCase();
        Object.keys(ALIASES).forEach((f) => { if (m[f] == null && ALIASES[f].includes(k)) m[f] = c; });
      });
      if (m.title != null) { hr = r; map = m; }
    }
    if (hr < 0) return { items: [], error: 'Couldn’t find a “Title” column. The first row should be column headings, like the ones in an exported file.' };

    const unknown = new Set();
    const items = [];
    let blank = 0;
    const has = (f) => map[f] != null;
    const cell = (row, f) => (has(f) ? row[map[f]] : '');
    const str = (v) => (v == null ? '' : String(v)).trim();
    const byName = (list, v) => { const n = str(v).toLowerCase(); return n ? list.find((x) => x.name.toLowerCase() === n) || list.find((x) => x.name.toLowerCase().startsWith(n)) : null; };

    for (let r = hr + 1; r < grid.length; r++) {
      const row = grid[r];
      if (!row || row.every((v) => str(v) === '')) continue;
      const title = str(cell(row, 'title'));
      if (!title) { blank++; continue; }
      const patch = { title };

      if (has('due')) {
        const v = cell(row, 'due');
        let due = null;
        if (typeof v === 'number' && v > 0) due = serialToKey(v);
        else if (str(v)) {
          const t = str(v);
          let m;
          if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) due = m[1] + '-' + pad2(m[2]) + '-' + pad2(m[3]);
          else if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) due = (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + pad2(m[1]) + '-' + pad2(m[2]);
          else { const q = C.parseQuick(t, [], [], st.prefs.weekStart); due = q.due; }
          if (due && C.D.key(C.D.parse(due)) !== due) due = null; // e.g. 2026-02-31
          if (!due) unknown.add('date “' + t + '”');
        }
        patch.due = due;
        if (!due) patch.time = null;
      }
      if (has('time') && patch.due !== null) {
        const v = cell(row, 'time');
        let time = null;
        if (typeof v === 'number' && v >= 0) { const mins = Math.round((v % 1) * 1440) % 1440; time = pad2(Math.floor(mins / 60)) + ':' + pad2(mins % 60); }
        else if (str(v)) {
          const t = str(v);
          const q = C.parseQuick('x ' + t, [], [], st.prefs.weekStart);
          time = q.time || (/^\d{1,2}:\d{2}$/.test(t) ? pad2(t.split(':')[0]) + ':' + t.split(':')[1] : null);
          if (!time) unknown.add('time “' + t + '”');
        }
        patch.time = time;
      }
      if (has('type')) {
        const v = str(cell(row, 'type'));
        const ty = byName(st.types, v);
        if (v && !ty) unknown.add('type “' + v + '”');
        patch.typeId = ty ? ty.id : null;
      }
      if (has('level')) {
        const v = str(cell(row, 'level'));
        const lv = byName(st.levels, v);
        if (v && !lv) unknown.add('importance “' + v + '”');
        if (lv) patch.levelId = lv.id;
      }
      if (has('repeat')) {
        const v = str(cell(row, 'repeat')).toLowerCase();
        patch.repeat = !v || /^(no|none|never|does not repeat)$/.test(v) ? 'none' : /weekday/.test(v) ? 'weekdays' : /day|daily/.test(v) ? 'daily' : /week/.test(v) ? 'weekly' : /month/.test(v) ? 'monthly' : 'none';
        if (v && patch.repeat === 'none' && !/^(no|none|never|does not repeat)$/.test(v)) unknown.add('repeat “' + v + '”');
      }
      if (has('done')) {
        const v = cell(row, 'done');
        patch.done = v === true || /^(y|yes|true|x|✓|✔|1|done|complete|completed)$/i.test(str(v));
      }
      if (has('checklist')) {
        const lines = str(cell(row, 'checklist')).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        patch.subtasks = lines.map((l) => {
          const m = l.match(/^\[\s*([xX✓✔]?)\s*\]\s*(.*)$/);
          const text = (m ? m[2] : l.replace(/^\s*(?:[-*•–—]|\d+[.)])\s*/, '')).trim();
          return { id: C.uid('s'), title: text, done: !!(m && m[1]) };
        }).filter((x) => x.title);
      }
      if (has('notes')) patch.notes = str(cell(row, 'notes'));
      items.push({ id: str(cell(row, 'id')) || null, patch });
    }
    return { items, unknown: Array.from(unknown), blank };
  }

  function copyData(msg) {
    const json = S().exportJSON();
    const fallback = () => {
      const ta = el.querySelector('#st-json'); ta.value = json; ta.classList.remove('sr'); ta.classList.add('json-out'); ta.removeAttribute('aria-hidden'); ta.focus(); ta.select();
      C.toast('Select all and copy the JSON shown below.');
    };
    try {
      navigator.clipboard.writeText(json).then(() => C.toast(typeof msg === 'string' ? msg : 'Copied ' + S().state.tasks.length + ' tasks as JSON'), fallback);
    } catch (err) { fallback(); }
  }
})();
