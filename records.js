/* Cadence — Formwright records (v22).
   Formwright, the form builder, shares this Firebase project. This module loads the
   forms and the records this person may see in Formwright, works out each record's
   title the way Formwright does, and lets a task link to one record:
     task.recordId    the record
     task.formId      its form
     task.recordSnap  { title, form, color }: a copy, so an assignee who can't see
                      that form still sees what the task is about
   Only the task's owner can set or change the link (firestore.rules checks it).
   Links from Formwright: ?addTaskFor=<recordId> opens a new task already linked,
   ?record=<recordId> shows that record's tasks.                                  */
(function () {
  const C = window.Cadence;
  const { esc, icon } = C;
  const S = () => C.store;
  const FB = () => C.firebaseSync;

  // Formwright's form colors (its ui.js COLORS); a form stores an index into this list
  const COLORS = ['#3346c8', '#0f7b6c', '#b4531a', '#8a3fb8', '#b42367', '#3d6b1f', '#56607a', '#0b6aa2'];
  const LEVELS = ['none', 'own', 'all'];
  const rank = (l) => Math.max(0, LEVELS.indexOf(l));

  const st = {
    status: 'off',        // off | loading | ready | no-account | error
    me: null,             // users/{uid}: { role, access }
    gotMe: false, gotForms: false,
    forms: [],
    byForm: new Map(),    // formId → [record]
    loaded: new Set(),    // formIds whose records have arrived at least once
    byId: new Map(),
    subs: new Map()       // formId → { key, unsub }
  };
  let started = false, uid = null, db = null, baseUnsubs = [];

  /* ---------- access (mirrors Formwright's access.js) ---------- */
  const isAdmin = () => !!(st.me && st.me.role === 'admin');
  function level(formId) {
    if (isAdmin()) return { view: 'all', edit: 'all' };
    const acc = (st.me && st.me.access) || {};
    const l = acc[formId] || acc['*'] || { view: 'none', edit: 'none' };
    return { view: LEVELS[Math.max(rank(l.view), rank(l.edit))], edit: LEVELS[rank(l.edit)] };
  }
  const canView = (formId) => level(formId).view !== 'none';

  /* ---------- titles (mirrors Formwright's recTitle) ---------- */
  const formById = (id) => st.forms.find((f) => f.id === id) || null;
  // a form's icon, drawn from plain shapes only (the same rules as Formwright's icons.js)
  const ICON_TAGS = { path: 1, circle: 1, rect: 1, line: 1, polyline: 1, polygon: 1, ellipse: 1 };
  const ICON_ATTRS = { d: 1, cx: 1, cy: 1, r: 1, rx: 1, ry: 1, x: 1, y: 1, width: 1, height: 1, x1: 1, y1: 1, x2: 1, y2: 1, points: 1 };
  function iconSvg(icon) {
    const shapes = (Array.isArray(icon.shapes) ? icon.shapes : []).filter((x) => Array.isArray(x) && ICON_TAGS[x[0]] && x[1] && typeof x[1] === 'object').slice(0, 40);
    if (!shapes.length) return '';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" focusable="false">' +
      shapes.map(([tag, a]) => '<' + tag + Object.keys(a).filter((k) => ICON_ATTRS[k] && a[k] != null && String(a[k]).length <= 4000).map((k) => ' ' + k + '="' + String(a[k]).replace(/[^0-9a-zA-Z .,\-+]/g, '') + '"').join('') + '/>').join('') + '</svg>';
  }
  const colorOf = (f) => COLORS[((f && f.color) || 0) % COLORS.length];
  const itemName = (f) => ((f && f.itemName) || '').trim() || ((f && f.name) || 'Record').replace(/s$/i, '') || 'Record';
  const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
  function titleFieldOf(form) {
    const fs = form.fields || [];
    return fs.find((f) => f.id === form.titleField) || fs.find((f) => ['text', 'email', 'phone', 'url'].includes(f.type)) || fs.find((f) => f.type !== 'heading');
  }
  function fmt(f, v, depth) {
    if (isEmpty(v)) return '';
    try {
      switch (f.type) {
        case 'checkbox': return v ? 'Yes' : 'No';
        case 'decimal': return Number(v).toLocaleString(undefined, { minimumFractionDigits: f.decimals ?? 2, maximumFractionDigits: f.decimals ?? 2 });
        case 'number': return Number(v).toLocaleString();
        case 'currency': return new Intl.NumberFormat(undefined, { style: 'currency', currency: (f.currency || 'USD').toUpperCase() }).format(v);
        case 'percent': return v + '%';
        case 'range': return v + (f.suffix || '');
        case 'rating': return '★'.repeat(v) + '☆'.repeat(Math.max(0, (f.max || 5) - v));
        case 'multiselect': return v.join(', ');
        case 'location': return v.address || (v.lat != null ? v.lat + ', ' + v.lng : '');
        case 'file': case 'image': return v.name || 'File';
        case 'signature': return 'Signed';
        case 'relation': { const r = st.byId.get(v); return r && depth < 2 ? titleOf(r, depth + 1) : ''; }
        case 'date': return new Date(v + 'T00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        case 'datetime': return new Date(v).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        case 'formula': return typeof v === 'object' ? '' : String(v); // Formwright saves the result on the record
        default: return typeof v === 'object' ? '' : String(v);
      }
    } catch (e) { return String(v); }
  }
  function titleOf(rec, depth) {
    const form = formById(rec.formId);
    if (!form) return 'Untitled';
    const f = titleFieldOf(form);
    const t = f ? fmt(f, (rec.values || {})[f.id], depth || 0) : '';
    return (t || 'Untitled ' + itemName(form).toLowerCase()).slice(0, 500);
  }

  /* ---------- loading ---------- */
  const listeners = new Set();
  const emit = C.debounce(() => {
    listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
    if (S()) S().emit(); // views re-render on store changes
  }, 80);

  function setStatus() {
    if (st.status === 'error') return;
    st.status = !st.gotMe || !st.gotForms ? 'loading' : !st.me ? 'no-account' : 'ready';
  }
  function reindex() {
    st.byId = new Map();
    st.byForm.forEach((list) => list.forEach((r) => st.byId.set(r.id, r)));
  }
  function syncRecordSubs() {
    const want = new Map();
    if (st.me) st.forms.forEach((f) => { const v = level(f.id).view; if (v !== 'none') want.set(f.id, v); });
    st.subs.forEach((s, formId) => {
      if (want.get(formId) && s.key === want.get(formId)) return;
      s.unsub(); st.subs.delete(formId); st.byForm.delete(formId); st.loaded.delete(formId);
    });
    want.forEach((v, formId) => {
      if (st.subs.has(formId)) return;
      // Formwright's rules only allow a list that filters to what you may see
      let q = db.collection('records').where('formId', '==', formId);
      if (v === 'own') q = q.where('ownerId', '==', uid);
      const unsub = q.onSnapshot((snap) => {
        st.byForm.set(formId, snap.docs.map((d) => Object.assign({}, d.data(), { id: d.id })));
        st.loaded.add(formId);
        reindex(); emit();
      }, (e) => { console.warn('Could not load ' + formId + ' records:', e); st.loaded.add(formId); emit(); });
      st.subs.set(formId, { key: v, unsub });
    });
    reindex();
  }
  function start() {
    const fb = FB();
    if (started || !fb || !fb.db || !fb.user) return;
    started = true; db = fb.db; uid = fb.user.uid;
    st.status = 'loading';
    const fail = (what) => (e) => { console.warn('Could not load Formwright ' + what + ':', e); st.status = 'error'; st.error = (e && (e.code || e.message)) || 'unknown'; emit(); };
    baseUnsubs.push(db.collection('users').doc(uid).onSnapshot((s) => {
      st.me = s.exists ? s.data() : null; st.gotMe = true;
      setStatus(); syncRecordSubs(); emit();
    }, fail('account')));
    baseUnsubs.push(db.collection('forms').onSnapshot((s) => {
      st.forms = s.docs.map((d) => Object.assign({}, d.data(), { id: d.id }));
      st.gotForms = true;
      setStatus(); syncRecordSubs(); emit();
    }, fail('forms')));
  }

  /* ---------- public API ---------- */
  const R = {
    /** linking is possible: signed in to Firebase and the records have started loading */
    enabled() { return started && st.status !== 'off'; },
    status() { return st.status; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** forms this person can see, in Formwright's sidebar order */
    forms() {
      return st.forms.filter((f) => canView(f.id))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name || '').localeCompare(String(b.name || '')));
    },
    form: formById,
    /** a form's mark beside its records: its icon (Formwright → Form designer → Badge), else a coloured square */
    mark(id, removed) {
      const f = !removed && formById(id);
      const svg = f && f.badge === 'icon' && f.icon ? iconSvg(f.icon) : '';
      return svg ? '<i class="ricon" aria-hidden="true">' + svg + '</i>' : '<i class="rdot"></i>';
    },
    formName(id) { const f = formById(id); return f ? f.name || 'Untitled form' : ''; },
    formColor(id) { const f = formById(id); return f ? colorOf(f) : null; },
    records(formId) { return (st.byForm.get(formId) || []).slice(); },
    get(id) { return st.byId.get(id) || null; },
    title(rec) { return titleOf(rec, 0); },
    /** the copy saved on a task */
    snapFor(rec) {
      const f = formById(rec.formId);
      return { title: titleOf(rec, 0), form: f ? String(f.name || 'Untitled form').slice(0, 200) : '', color: f ? colorOf(f) : COLORS[0] };
    },
    /** fields that link a task to record id (or unlink, when id is null) */
    linkFor(id) {
      const rec = id && st.byId.get(id);
      if (!rec) return { recordId: null, formId: null, recordSnap: null };
      return { recordId: rec.id, formId: rec.formId, recordSnap: R.snapFor(rec) };
    },
    /** what to show for a task's link: live title for my own tasks, else the saved copy */
    label(t) {
      if (!t || !t.recordId) return null;
      const snap = t.recordSnap || {};
      const rec = st.byId.get(t.recordId);
      const mine = !S() || S().isOwner(t);
      if (rec && mine) { const s = R.snapFor(rec); return { title: s.title, form: s.form, color: s.color, removed: false }; }
      return { title: snap.title || 'Linked record', form: snap.form || R.formName(t.formId), color: snap.color || R.formColor(t.formId) || COLORS[0], removed: mine && R.isRemoved(t) };
    },
    /** true only when we can be sure: the form is gone, or it's fully loaded with "all" access and the record isn't there */
    isRemoved(t) {
      if (st.status !== 'ready' || !t.recordId) return false;
      if (st.byId.has(t.recordId)) return false;
      const f = formById(t.formId);
      if (!f) return true;
      return level(f.id).view === 'all' && st.loaded.has(f.id);
    },
    /** Formwright's address for a record, or null when CADENCE_FORMS_URL isn't set */
    url(id) {
      const base = String(window.CADENCE_FORMS_URL || '').trim();
      if (!base) return null;
      return base.replace(/#.*$/, '').replace(/\/?$/, '/') + '#/record/' + encodeURIComponent(id);
    },
    open(id) {
      const u = R.url(id);
      if (!u) return C.toast('Add CADENCE_FORMS_URL to firebase-config.js to open records in Formwright.');
      window.open(u, 'formwright');
    },
    /** chip for task rows and tables */
    chip(t, compact) {
      const l = R.label(t);
      if (!l) return '';
      return '<button type="button" class="record-tag' + (compact ? ' compact' : '') + (l.removed ? ' removed' : '') + '" data-record-link="' + esc(t.recordId) + '"' +
        ' title="' + esc(l.removed ? 'This record was deleted in Formwright' : (l.form ? l.form + ': ' : '') + l.title) + '" style="--c:' + esc(l.color) + '">' +
        R.mark(t.formId, l.removed) + '<span>' + esc(l.removed ? 'Record removed' : l.title) + '</span></button>';
    },
    /** [{ id, title, color }] for "&record" in quick add */
    index() {
      if (!R.enabled()) return null;
      const out = [];
      R.forms().forEach((f) => R.records(f.id).forEach((r) => out.push({ id: r.id, title: titleOf(r, 0), color: colorOf(f) })));
      return out;
    },
    /** Searchable record picker, grouped by form. onPick(id|null) */
    pick(o) {
      const M = C.map;
      const ui = { idx: 0, items: [] };
      const el = M.openPop('<label class="input-wrap sm">' + icon('search') + '<input class="pk-q" placeholder="Search records" autocomplete="off" aria-label="Search records"></label><div class="pk-list" role="listbox"></div>',
        Object.assign({ cls: 'picker rec-picker', matchWidth: true }, o, {
          onKey(e) {
            if (e.key === 'ArrowDown') { e.preventDefault(); ui.idx = Math.min(ui.items.length - 1, ui.idx + 1); draw(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); ui.idx = Math.max(0, ui.idx - 1); draw(); }
            else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); choose(ui.idx); }
          }
        }));
      const q = el.querySelector('.pk-q'), list = el.querySelector('.pk-list');
      function draw() {
        const v = q.value.toLowerCase().trim();
        const items = [];
        if (o.allowNone && (!v || 'no record'.includes(v))) items.push({ id: null, t: 'No record' });
        R.forms().forEach((f) => {
          const fname = f.name || 'Untitled form';
          const recs = R.records(f.id).map((r) => ({ id: r.id, t: titleOf(r, 0), hex: colorOf(f) }))
            .filter((r) => !v || r.t.toLowerCase().includes(v) || fname.toLowerCase().includes(v))
            .sort((a, b) => a.t.localeCompare(b.t));
          if (!recs.length) return;
          items.push({ head: fname, hex: colorOf(f), fid: f.id });
          recs.forEach((r) => items.push(r));
        });
        ui.items = items.filter((it) => !it.head).slice(0, 300);
        ui.idx = Math.min(Math.max(0, ui.idx), Math.max(0, ui.items.length - 1));
        let n = -1;
        const status = st.status;
        list.innerHTML = ui.items.length ? items.map((it) => {
          if (it.head) return '<div class="pk-head" style="--c:' + it.hex + '">' + R.mark(it.fid) + esc(it.head) + '</div>';
          n++;
          if (n >= 300) return '';
          return '<button type="button" class="pk-item' + (n === ui.idx ? ' on' : '') + (it.id === o.current ? ' current' : '') + '" data-i="' + n + '" role="option">' +
            (it.id === null ? '<i class="dot none"></i>' : '<i class="rdot" style="--c:' + it.hex + '"></i>') +
            '<span class="pk-t">' + esc(it.t) + '</span>' + (it.id === o.current ? icon('check') : '') + '</button>';
        }).join('') : '<p class="pk-empty">' + (
          status === 'loading' ? 'Loading records…' :
          status === 'no-account' ? 'Open Formwright once to set up your account, then ask an admin for access to its forms.' :
          status === 'error' ? 'Couldn’t load records (' + esc(st.error || '') + ').' :
          v ? 'No matching records' : 'No records you can see yet.') + '</p>';
        const on = list.querySelector('.pk-item.on');
        if (on) { const lt = list.scrollTop, lb = lt + list.clientHeight; if (on.offsetTop < lt) list.scrollTop = on.offsetTop - 28; else if (on.offsetTop + on.offsetHeight > lb) list.scrollTop = on.offsetTop + on.offsetHeight - list.clientHeight; }
      }
      function choose(i) { const it = ui.items[i]; if (!it) return; M.closePop(); o.onPick(it.id); }
      q.addEventListener('input', () => { ui.idx = 0; draw(); });
      list.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) choose(+b.dataset.i); });
      const off = R.subscribe(() => { if (el.isConnected) draw(); else off(); }); // records still arriving
      draw();
      if (!matchMedia('(pointer: coarse)').matches) q.focus();
    },
    /** menu for a record chip: open it in Formwright, or list its tasks */
    chipMenu(anchor, id) {
      const items = [];
      if (R.url(id)) items.push({ label: 'Open in Formwright', ic: 'external', run: () => R.open(id) });
      items.push({ label: 'Show its tasks', ic: 'list', run: () => R.showTasks(id) });
      C.map.menu(items, { anchor });
    },
    showTasks(id) {
      const t = S().state.tasks.find((x) => x.recordId === id);
      const lbl = R.get(id) ? R.title(R.get(id)) : (t && t.recordSnap && t.recordSnap.title) || 'this record';
      C.go('list');
      setTimeout(() => { if (C.views && C.views.list && C.views.list.filterRecord) C.views.list.filterRecord(id, lbl); }, 0);
    },
    /** keep the saved copy current when the owner opens a task (no write if nothing changed) */
    refreshSnap(t) {
      if (!t || !t.recordId || !S().isOwner(t)) return;
      const rec = st.byId.get(t.recordId);
      if (!rec) return;
      const s = R.snapFor(rec), o = t.recordSnap || {};
      if (s.title !== o.title || s.form !== o.form || s.color !== o.color) S().updateTask(t.id, { recordSnap: s });
    }
  };
  C.records = R;

  // record chips anywhere (task rows, tables, the editor) open a small menu
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-record-link]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    R.chipMenu(b, b.dataset.recordLink);
  }, true);

  /* ---------- start, and links from Formwright ---------- */
  function openFromLink() {
    const q = new URLSearchParams(location.search);
    const add = q.get('addTaskFor'), show = q.get('record');
    if (!add && !show) return;
    q.delete('addTaskFor'); q.delete('record');
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
    let tries = 0;
    const tick = () => {
      const ready = S() && S().state.ready && st.status !== 'loading' && st.status !== 'off';
      const id = add || show;
      if (ready && (st.byId.has(id) || st.status !== 'ready' || tries > 24)) {
        if (add) {
          if (st.byId.has(add)) C.openEditor(R.linkFor(add));
          else C.toast('That record isn’t one you can see, so the new task can’t be linked to it.');
        } else R.showTasks(show);
        return;
      }
      if (++tries < 60) setTimeout(tick, 250);
    };
    tick();
  }

  window.addEventListener('load', () => {
    const fb = FB();
    if (!fb || !fb.enabled) return;
    fb.collection().then(() => { start(); openFromLink(); }).catch(() => { /* sync shows the error */ });
  });
})();
