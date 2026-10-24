/* Cadence — state store.
   Always caches to localStorage. When opened as a claude.ai artifact with the
   `db` capability, tasks and settings sync to the viewer's private space
   (data/users/<id>/…) so they follow the person across devices. */
(function () {
  const C = window.Cadence;
  const { D } = C;
  const LS_KEY = 'cadence.v1';

  const DEFAULT_TYPES = [
    { id: 'ty-work', name: 'Work', color: '#3B6FE0', glyph: 'briefcase' },
    { id: 'ty-personal', name: 'Personal', color: '#C2410C', glyph: 'home' },
    { id: 'ty-errand', name: 'Errand', color: '#0E8F7E', glyph: 'cart' },
    { id: 'ty-health', name: 'Health', color: '#D23F6E', glyph: 'heart' },
    { id: 'ty-learning', name: 'Learning', color: '#8A55D6', glyph: 'book' }
  ];
  const DEFAULT_LEVELS = [
    { id: 'lv-critical', name: 'Critical', color: '#E5383B' },
    { id: 'lv-high', name: 'High', color: '#F08A24' },
    { id: 'lv-normal', name: 'Normal', color: '#3B82C4' },
    { id: 'lv-low', name: 'Low', color: '#8C94A6' }
  ];
  const DEFAULT_PREFS = {
    theme: 'system', weekStart: 1, group: 'due', sort: 'smart', showDone: false,
    listMode: 'agenda', calMode: 'month', defaultLevel: 'lv-normal', defaultType: null,
    showStorage: true // the storage meter in the sidebar (per device)
  };

  const state = {
    tasks: [], types: [], levels: [], prefs: { ...DEFAULT_PREFS },
    mode: 'local', // 'local' | 'sync'
    owner: null,   // signed-in uid
    me: null,      // { uid, name, email } when sharing is available
    sharing: false,
    seen: [],      // ids of tasks assigned to me that I've been told about
    map: { nodes: [], edges: [], updatedAt: 0 }, // the mind map (Canvas / Outline / Table)
    mapRev: 0,     // bumps whenever the map changes, locally or from sync
    board: { charts: [], updatedAt: 0 }, // charts saved to the Board page
    sync: { status: 'local', provider: null, lastAt: null, pending: 0, error: null, cloudCount: null },
    ready: false
  };
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => { try { f(state); } catch (e) { console.error(e); } });

  /* ---------- local cache ---------- */
  function readLocal() {
    try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  const writeLocal = C.debounce(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ owner: state.owner || null, me: state.me || null, seen: state.seen, tasks: state.tasks, types: state.types, levels: state.levels, prefs: state.prefs, map: state.map, board: state.board }));
      localStorage.setItem('cadence.theme', state.prefs.theme || 'system'); // read by boot.js before the page is drawn
    } catch (e) { /* storage blocked: in-memory only */ }
  }, 120);

  /* ---------- remote sync (Firebase or claude.ai db) ----------
     state.sync = { status, provider, lastAt, pending, error }
       status: 'local' | 'connecting' | 'synced' | 'saving' | 'offline' | 'error'          */
  let remote = null; // { col, prepare }
  let conn = null;   // the provider result, kept so Retry can re-listen
  let unlisten = null;
  const queues = {};
  const failed = new Set();
  const settingsBody = () => ({ kind: 'settings', types: state.types, levels: state.levels, defaultLevel: state.prefs.defaultLevel, defaultType: state.prefs.defaultType });
  const mapBody = () => ({ kind: 'map', nodes: state.map.nodes, edges: state.map.edges, updatedAt: state.map.updatedAt || Date.now() });
  /* dashboards and home are written only once there are dashboards, so an older board keeps its old shape */
  const boardBody = () => Object.assign({ kind: 'board', charts: state.board.charts, updatedAt: state.board.updatedAt || Date.now() },
    Array.isArray(state.board.dashboards) && state.board.dashboards.length ? { dashboards: state.board.dashboards, home: state.board.home || '' } : {});
  const boardOf = (b) => Object.assign({ charts: Array.isArray(b && b.charts) ? C.clone(b.charts) : [], updatedAt: (b && b.updatedAt) || 0 },
    b && Array.isArray(b.dashboards) && b.dashboards.length ? { dashboards: C.clone(b.dashboards), home: typeof b.home === 'string' ? b.home : '' } : {});
  const PRIVATE = { settings: settingsBody, map: mapBody, board: boardBody }; // private docs (users/{uid}/items/…), everything else is a task
  const LEGACY_BOARD = 'cadence.chart.board'; // before v14, saved charts lived in this browser only
  let boardSeen = false;
  function takeBoard(body) {
    if (!body || body.updatedAt === state.board.updatedAt) return false;
    state.board = boardOf(body);
    return true;
  }
  const emptyMap = () => ({ nodes: [], edges: [], updatedAt: 0 });
  let mapSeen = false;       // the cloud has a map doc
  let mapBusy = false;       // a drag or resize is in progress: hold incoming map changes
  let mapDeferred = null;
  function takeMap(body) {
    if (!body || body.updatedAt === state.map.updatedAt) return false; // our own write echoing back
    state.map = { nodes: Array.isArray(body.nodes) ? C.clone(body.nodes) : [], edges: Array.isArray(body.edges) ? C.clone(body.edges) : [], updatedAt: body.updatedAt || 0 };
    state.mapRev++;
    return true;
  }

  function setSync(patch) {
    Object.assign(state.sync, patch);
    state.mode = remote ? 'sync' : 'local';
    emit();
  }
  const pendingCount = () => Object.values(queues).filter((q) => q.busy || q.dirty).length;
  function refreshStatus() {
    if (!remote) return;
    if (state.sync.status === 'error' && failed.size) return; // keep the error visible until Retry
    const n = pendingCount();
    if (!navigator.onLine) return setSync({ status: 'offline', pending: n });
    if (n) return setSync({ status: 'saving', pending: n });
    setSync({ status: 'synced', pending: 0, lastAt: Date.now(), error: null });
  }

  /** Turn an SDK error into words a person can act on */
  function explain(err, during) {
    const code = (err && err.code) || 'unknown';
    const raw = (err && err.message) || String(err || '');
    const fb = state.sync.provider === 'firebase';
    const m = {
      'permission-denied': ['The database refused ' + (during === 'write' ? 'to save a change' : 'access'),
        fb ? 'Deploy the security rules (firebase deploy --only firestore:rules) and check they appear under Firestore Database → Rules in the console. If the message mentions "API has not been used", enable the Cloud Firestore API for this project.' : 'Your access to this page changed.'],
      'not-found': ['No Firestore database found', 'In the Firebase console open Firestore Database → Create database, then press Retry.'],
      'failed-precondition': ['Firestore isn’t ready', 'Create the Firestore database in the Firebase console (Firestore Database → Create database), then press Retry.'],
      'unauthenticated': ['You’re signed out', 'Reload the page and sign in again.'],
      'unavailable': ['Can’t reach the database', 'Check your connection. Changes stay on this device and are sent when you’re back online. Ad blockers and privacy extensions sometimes block firestore.googleapis.com.'],
      'resource-exhausted': ['Database quota reached', 'Your Firebase project hit a usage limit. Check Usage in the Firebase console.'],
      'invalid-argument': ['A change was rejected', 'One task has data the database won’t accept. Export a backup and send it to whoever maintains the app.'],
      'timeout': ['No answer from the database', 'Nothing came back after 12 seconds. Make sure the Firestore database exists and that an ad blocker isn’t blocking firestore.googleapis.com, then press Retry.'],
      'quota_exceeded': ['Storage is full', 'Delete some completed tasks to keep syncing.'],
      'sdk': ['Couldn’t load sync', raw]
    }[code] || ['Sync stopped', raw || 'Unknown error'];
    return { code, title: m[0], hint: m[1], raw, at: Date.now() };
  }

  function queueWrite(id) {
    if (!remote) return;
    const q = queues[id] || (queues[id] = { busy: false, dirty: false });
    q.dirty = true;
    if (!q.busy) pump(id, q);
  }
  async function pump(id, q) {
    q.busy = true;
    refreshStatus();
    while (q.dirty && remote) {
      q.dirty = false;
      const body = PRIVATE[id] ? PRIVATE[id]() : state.tasks.find((t) => t.id === id);
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const ref = remote.col.doc(id);
          if (body) await ref.set(PRIVATE[id] ? C.clone(body) : decorate(C.clone(body))); else await ref.delete();
          failed.delete(id);
          break;
        } catch (e) {
          const code = e && e.code;
          if (code === 'unavailable' && attempt === 0) { await new Promise((r) => setTimeout(r, 600 + Math.random() * 900)); continue; }
          console.warn('Sync write failed for', id, e);
          failed.add(id);
          if (code === 'revoked' || code === 'not_granted' || code === 'capability_disabled') { goLocal(explain(e, 'write')); }
          else setSync({ status: 'error', error: Object.assign(explain(e, 'write'), { doc: id }) });
          break;
        }
      }
    }
    q.busy = false;
    refreshStatus();
  }
  const pending = (id) => queues[id] && (queues[id].busy || queues[id].dirty);
  let storageCache = null;

  /* Fill in ownership, and give the assignee a copy of the owner's type and importance
     names/colors, since their own settings won't have the owner's ids. */
  function decorate(body) {
    if (remote && remote.prepare) remote.prepare(body);
    if (!state.sharing || body.ownerId !== state.owner) return body;
    if (body.assigneeId || body.assigneeRole) {
      const ty = S.typeById(body.typeId), lv = S.levelById(body.levelId);
      body.typeSnap = ty ? { name: ty.name, color: ty.color, glyph: ty.glyph } : null;
      body.levelSnap = lv ? { name: lv.name, color: lv.color } : null;
    } else { delete body.typeSnap; delete body.levelSnap; }
    return body;
  }

  const personName = (name, email) => (name || email || 'Someone').split(' ')[0];

  /* Tell the person about things other people did: new assignments to them,
     and completions or hand-backs on tasks they assigned. */
  function notice(prev, tasks) {
    if (!state.sharing || !state.owner || !C.toast) return;
    const me = state.owner;
    const seen = new Set(state.seen || []);
    const fresh = tasks.filter((t) => S.isAssignedToMe(t) && !t.done && !seen.has(t.id));
    const present = new Set(tasks.filter((t) => S.isAssignedToMe(t)).map((t) => t.id));
    state.seen = Array.from(new Set([...seen].filter((id) => present.has(id)).concat([...present])));
    const msgs = [];
    tasks.forEach((t) => {
      const p = prev.get(t.id);
      // given to a role: whoever in it ticked it off first
      if (p && p.ownerId === me && p.assigneeRole && !p.done && t.done && t.doneBy && t.doneBy !== me && !pending(t.id)) { msgs.push([(t.doneByName || p.assigneeRoleName || 'Someone') + ' completed “' + t.title + '”', t.id]); return; }
      if (!p || p.ownerId !== me || !p.assigneeId || p.assigneeId === me || pending(t.id)) return;
      const who = personName(p.assigneeName, p.assigneeEmail);
      if (!p.done && t.done && t.assigneeId === p.assigneeId) msgs.push([who + ' completed “' + t.title + '”', t.id]);
      else if (!t.assigneeId) msgs.push([who + ' handed back “' + t.title + '”', t.id]);
    });
    if (fresh.length === 1) {
      const t = fresh[0];
      C.toast(personName(t.ownerName, t.ownerEmail) + (t.assigneeRole ? ' gave ' + (t.assigneeRoleName || 'your role') + ' “' : ' assigned you “') + t.title + '”', { action: 'Open', onAction: () => C.openEditor(t.id), duration: 8000 });
    } else if (fresh.length > 1) {
      C.toast(fresh.length + ' tasks were assigned to you', { action: 'Show', onAction: () => C.showAssignedToMe && C.showAssignedToMe(), duration: 8000 });
    }
    if (msgs.length === 1) C.toast(msgs[0][0], { action: 'Open', onAction: () => C.openEditor(msgs[0][1]), duration: 8000 });
    else if (msgs.length > 1) C.toast(msgs.length + ' updates on tasks you assigned');
  }

  function goLocal(error) {
    remote = null;
    state.sharing = false;
    if (unlisten) { try { unlisten(); } catch (e) { /* already closed */ } unlisten = null; }
    setSync({ status: error ? 'error' : 'local', error: error || null, pending: 0 });
  }

  function applySnapshot(snap) {
    const prev = new Map(state.tasks.map((t) => [t.id, C.clone(t)]));
    const tasks = [];
    const seen = new Set();
    snap.docs.forEach((d) => {
      const body = d.data();
      if (!body) return;
      if (d.id === 'settings') {
        if (!pending('settings')) {
          if (Array.isArray(body.types)) state.types = C.clone(body.types);
          if (Array.isArray(body.levels) && body.levels.length) state.levels = C.clone(body.levels);
          if (body.defaultLevel) state.prefs.defaultLevel = body.defaultLevel;
          if ('defaultType' in body) state.prefs.defaultType = body.defaultType;
        }
        return;
      }
      if (d.id === 'board') {
        boardSeen = true;
        if (!pending('board') && !failed.has('board')) takeBoard(body);
        return;
      }
      if (d.id === 'map') {
        mapSeen = true;
        if (pending('map') || failed.has('map')) return;
        if (mapBusy) { mapDeferred = body; return; }
        takeMap(body);
        return;
      }
      seen.add(d.id);
      if (pending(d.id) || failed.has(d.id)) { const local = state.tasks.find((t) => t.id === d.id); if (local) tasks.push(local); return; }
      tasks.push(C.clone(body));
    });
    // keep local tasks whose create hasn't landed yet (or was refused, so nothing is lost)
    state.tasks.forEach((t) => { if (!seen.has(t.id) && (pending(t.id) || failed.has(t.id))) tasks.push(t); });
    state.tasks = tasks;
    notice(prev, tasks);
    if (snap.metadata && !snap.metadata.fromCache) {
      state.sync.lastAt = Date.now();
      state.sync.cloudCount = snap.docs.filter((d) => !PRIVATE[d.id]).length;
    }
    writeLocal();
    refreshStatus();
    emit();
  }

  function pushAll() {
    queueWrite('settings');
    if (state.map.nodes.length || mapSeen) queueWrite('map');
    if (state.board.charts.length || boardSeen) queueWrite('board');
    state.tasks.forEach((t) => queueWrite(t.id));
  }

  /* A provider resolves { col, uid, label, listen? } or null. Both backends expose the same
     collection shape: doc(id).set/delete and onSnapshot(snap => snap.docs / empty / metadata). */
  async function provider() {
    if (conn) return conn;
    // 1) Firebase (self-hosted, signed-in users) — see firebase-config.js
    if (C.firebaseSync && C.firebaseSync.enabled) {
      setSync({ status: 'connecting', provider: 'firebase' });
      return (conn = await C.firebaseSync.collection());
    }
    // 2) claude.ai artifact db capability
    const cl = window.claude;
    if (!cl || typeof cl.use !== 'function') return null;
    setSync({ status: 'connecting', provider: 'claude' });
    const [db, user] = await Promise.all([cl.use('db'), cl.use('user')]);
    if (!db || !user) { setSync({ status: 'local', provider: null }); return null; }
    const uid = await user.id();
    if (!uid) { setSync({ status: 'local', provider: null }); return null; }
    return (conn = { col: db.collection('data/users/' + uid), uid, label: 'claude' });
  }

  /** Resolves { status: 'remote-empty' | 'remote-data', uid } or null (no sync available) */
  async function connect() {
    let p = null;
    try { p = await provider(); }
    catch (e) { console.warn('Sync unavailable:', e); goLocal(explain({ code: 'sdk', message: e.message }, 'connect')); return null; }
    if (!p) return null;
    setSync({ status: 'connecting', error: null });
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      const timer = setTimeout(() => { if (first) { setSync({ status: 'error', error: explain({ code: 'timeout' }) }); done(null); } }, 12000);
      let first = true;
      const listen = p.listen || ((next, err) => p.col.onSnapshot(next, err));
      if (unlisten) { try { unlisten(); } catch (e) { /* closed */ } }
      unlisten = listen((snap) => {
        if (first) {
          if (snap.metadata && snap.metadata.fromCache && navigator.onLine) return; // wait for server truth
          first = false;
          clearTimeout(timer);
          remote = { col: p.col, prepare: p.prepare };
          state.syncLabel = p.label;
          state.owner = p.uid;
          state.me = p.me || null;
          state.sharing = p.label === 'firebase';
          const wasLate = settled; // answered after the timeout: push what we have
          if (snap.empty) { state.sync.cloudCount = 0; if (wasLate) pushAll(); refreshStatus(); return done({ status: 'remote-empty', uid: p.uid }); }
          applySnapshot(snap);
          if (wasLate) pushAll();
          return done({ status: 'remote-data', uid: p.uid });
        }
        applySnapshot(snap);
      }, (err) => {
        console.warn('Sync stopped:', err);
        clearTimeout(timer);
        goLocal(explain(err, 'read'));
        done(null);
      });
    });
  }

  window.addEventListener('online', () => { if (remote) { failed.forEach(queueWrite); refreshStatus(); } });
  window.addEventListener('offline', () => refreshStatus());

  /* ---------- sample data (clearly marked as examples) ---------- */
  function sampleTasks() {
    const k = (n) => D.key(D.add(D.today(), n));
    const now = Date.now();
    const mk = (title, o) => Object.assign({
      id: C.uid('t'), title, notes: '', typeId: null, levelId: 'lv-normal', due: null, time: null,
      done: false, doneAt: null, createdAt: now, updatedAt: now, subtasks: [], repeat: 'none', sample: true
    }, o);
    const st = (arr) => arr.map(([title, done]) => ({ id: C.uid('s'), title, done: !!done }));
    return [
      mk('Send Q4 roadmap draft to the team', { typeId: 'ty-work', levelId: 'lv-critical', due: k(0), time: '11:00', subtasks: st([['Outline themes', 1], ['Add estimates', 1], ['Review with design', 0]]) }),
      mk('Renew car registration', { typeId: 'ty-errand', levelId: 'lv-high', due: k(-2) }),
      mk('Pick up dry cleaning', { typeId: 'ty-errand', levelId: 'lv-low', due: k(0), time: '17:30' }),
      mk('30-minute run', { typeId: 'ty-health', levelId: 'lv-normal', due: k(1), time: '07:00', repeat: 'weekdays' }),
      mk('Book flights for Thanksgiving', { typeId: 'ty-personal', levelId: 'lv-high', due: k(2), notes: 'Check fares from both airports before Tuesday.' }),
      mk('1:1 prep with Priya', { typeId: 'ty-work', levelId: 'lv-normal', due: k(3), time: '09:30', repeat: 'weekly' }),
      mk('Finish chapter 4 of the TypeScript course', { typeId: 'ty-learning', levelId: 'lv-normal', due: k(4) }),
      mk('Dentist cleaning', { typeId: 'ty-health', levelId: 'lv-high', due: k(6), time: '14:00' }),
      mk('Quarterly expense report', { typeId: 'ty-work', levelId: 'lv-high', due: k(9), subtasks: st([['Export card statements'], ['Match receipts'], ['Submit in portal']]) }),
      mk('Plan weekend hike', { typeId: 'ty-personal', levelId: 'lv-low', due: k(13) }),
      mk('Read “Designing Data-Intensive Applications”', { typeId: 'ty-learning', levelId: 'lv-low' }),
      mk('Clean out the garage', { typeId: 'ty-personal', levelId: 'lv-normal' }),
      mk('Update team wiki onboarding page', { typeId: 'ty-work', levelId: 'lv-low', due: k(-1), done: true, doneAt: now - 3600e3 })
    ];
  }

  /* ---------- public API ---------- */
  const S = {
    state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit,

    async init() {
      const local = readLocal();
      if (!local) { try { const t = localStorage.getItem('cadence.theme'); if (t === 'light' || t === 'dark') state.prefs.theme = t; } catch (e) { /* blocked */ } }
      if (local) {
        state.tasks = local.tasks || [];
        state.types = local.types || C.clone(DEFAULT_TYPES);
        state.levels = (local.levels && local.levels.length) ? local.levels : C.clone(DEFAULT_LEVELS);
        state.prefs = { ...DEFAULT_PREFS, ...(local.prefs || {}) };
        state.owner = local.owner || null;
        state.me = local.me || null;
        state.seen = local.seen || [];
        state.map = local.map && Array.isArray(local.map.nodes) ? local.map : emptyMap();
        state.board = local.board && Array.isArray(local.board.charts) ? boardOf(local.board) : { charts: [], updatedAt: 0 };
        state.mapRev++;
        state.ready = true;
        emit();
      }
      // charts saved in this browser by an older version join the board
      let legacyBoard = null;
      try { legacyBoard = JSON.parse(localStorage.getItem(LEGACY_BOARD)); } catch (e) { /* none */ }
      if (Array.isArray(legacyBoard) && legacyBoard.length && !state.board.charts.length) state.board = { charts: legacyBoard, updatedAt: Date.now() };
      const res = await connect();
      const status = res && res.status;
      // never push one person's cached tasks into a different signed-in account
      const foreign = local && local.owner && res && local.owner !== res.uid;
      if (foreign) { state.seen = []; if (!mapSeen) { state.map = emptyMap(); state.mapRev++; } if (!boardSeen) state.board = { charts: [], updatedAt: 0 }; }
      if (Array.isArray(legacyBoard)) {
        // merge old browser-only charts into an existing cloud board (skip ones already there)
        if (!foreign && boardSeen && legacyBoard.length) {
          const have = new Set(state.board.charts.map((c) => c.id));
          const add = legacyBoard.filter((c) => c && !have.has(c.id));
          if (add.length) { state.board = Object.assign({}, state.board, { charts: state.board.charts.concat(add), updatedAt: Date.now() }); queueWrite('board'); }
        }
        try { localStorage.removeItem(LEGACY_BOARD); } catch (e) { /* blocked */ }
      }
      if (status === 'remote-data' && !boardSeen && !foreign && state.board.charts.length) queueWrite('board');
      // first sign-in on a version with the map: send the map this device already has
      if (status === 'remote-data' && !mapSeen && !foreign && state.map.nodes.length) queueWrite('map');
      if ((!local || foreign) && status !== 'remote-data') {
        state.types = C.clone(DEFAULT_TYPES);
        state.levels = C.clone(DEFAULT_LEVELS);
        state.tasks = sampleTasks();
      }
      if (status === 'remote-empty') pushAll();
      state.ready = true;
      writeLocal();
      emit();
    },

    /** Retry: reconnect if the listener died, then resend everything (writes are idempotent) */
    async retrySync() {
      failed.clear();
      setSync({ status: 'connecting', error: null });
      if (!remote) {
        const res = await connect();
        if (!res) return false;
      }
      pushAll();
      refreshStatus();
      return true;
    },

    typeById(id) { return state.types.find((t) => t.id === id) || null; },
    levelById(id) { return state.levels.find((l) => l.id === id) || null; },
    levelRank(id) { const i = state.levels.findIndex((l) => l.id === id); return i < 0 ? state.levels.length : i; },
    get(id) { return state.tasks.find((t) => t.id === id) || null; },

    /* ---------- sharing ---------- */
    sharing() { return !!(state.sharing && state.owner); },
    me() { return state.me; },
    /** tasks with no owner yet (local, or created before sign-in) belong to this person */
    isOwner(t) { return !!t && (!t.ownerId || t.ownerId === state.owner); },
    isAssignedToMe(t) { return !!(t && t.ownerId !== state.owner && ((t.assigneeId && t.assigneeId === state.owner) || (t.assigneeRole && !t.assigneeId))); },
    /** given to a role I hold (Formwright → Roles): anyone in it can do it; the first to tick it off is credited */
    isMyRoleTask(t) { return !!(t && t.assigneeRole && !t.assigneeId && t.ownerId !== state.owner); },
    /** someone else has it: a person or a role */
    isWithOthers(t) { return !!(t && (t.assigneeId || t.assigneeRole)); },
    canDelete(t) { return S.isOwner(t) || (S.isAssignedToMe(t) && !!t.spawnedFrom && !t.done); },
    /** the type/importance to show: the owner's snapshot when the task came from someone else */
    typeOf(t) { return (!S.isOwner(t) && t.typeSnap) ? t.typeSnap : S.typeById(t.typeId); },
    levelOf(t) { return (!S.isOwner(t) && t.levelSnap) ? t.levelSnap : S.levelById(t.levelId); },
    /** fields that assign a task to person {uid,name,email}, or back to me when null */
    assigneeFields(person) {
      const me = state.me || {}, owner = state.owner;
      const base = { ownerId: owner, ownerName: me.name || null, ownerEmail: me.email || null };
      const noRole = { assigneeRole: null, assigneeRoleName: null };
      if (!person || person.uid === owner) return Object.assign(base, noRole, { assigneeId: null, assigneeName: null, assigneeEmail: null, members: [owner] });
      return Object.assign(base, noRole, { assigneeId: person.uid, assigneeName: person.name || null, assigneeEmail: person.email || null, members: [owner, person.uid] });
    },
    /** assignee gives the task back to its owner */
    returnToOwner(id) {
      const t = S.get(id); if (!t || !S.isAssignedToMe(t) || S.isMyRoleTask(t)) return null;
      return S.updateTask(id, { assigneeId: null, assigneeName: null, assigneeEmail: null, members: [t.ownerId] });
    },
    /** people I've recently worked with, newest first */
    people() {
      const m = new Map(), me = state.owner;
      state.tasks.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).forEach((t) => {
        if (t.ownerId === me && t.assigneeId && !m.has(t.assigneeId)) m.set(t.assigneeId, { uid: t.assigneeId, name: t.assigneeName || '', email: t.assigneeEmail || '' });
        if (t.assigneeId === me && t.ownerId && t.ownerId !== me && !m.has(t.ownerId)) m.set(t.ownerId, { uid: t.ownerId, name: t.ownerName || '', email: t.ownerEmail || '' });
      });
      return Array.from(m.values()).slice(0, 8);
    },
    findPerson(email) {
      const fb = C.firebaseSync;
      return fb && fb.findPerson ? fb.findPerson(email) : Promise.resolve(null);
    },

    addTask(partial) {
      const now = Date.now();
      const t = Object.assign({
        id: C.uid('t'), title: 'Untitled task', notes: '', typeId: state.prefs.defaultType || null,
        levelId: state.prefs.defaultLevel || (state.levels[0] && state.levels[0].id), due: null, time: null,
        done: false, doneAt: null, createdAt: now, updatedAt: now, subtasks: [], repeat: 'none'
      }, partial);
      state.tasks.push(t);
      commit(t.id);
      return t;
    },
    updateTask(id, patch) {
      const t = S.get(id); if (!t) return null;
      // reschedule tracking (from v19): moving a set due date to another date counts once,
      // and days moved later add up. Undo passes the old counts back, so it doesn't count.
      if ('due' in patch && !('moved' in patch) && t.due && patch.due && patch.due !== t.due) {
        patch = Object.assign({}, patch, { moved: (t.moved || 0) + 1, pushed: (t.pushed || 0) + Math.max(0, D.diff(patch.due, t.due)) });
      }
      Object.assign(t, patch, { updatedAt: Date.now() });
      commit(id);
      return t;
    },
    deleteTask(id) {
      const i = state.tasks.findIndex((t) => t.id === id);
      if (i < 0) return null;
      if (!S.canDelete(state.tasks[i])) return null;
      const [t] = state.tasks.splice(i, 1);
      commit(id);
      return t;
    },
    restoreTask(t) { if (!S.get(t.id)) { state.tasks.push(t); commit(t.id); } },

    /** Toggle completion; repeating tasks spawn their next occurrence. Returns {task, spawned} */
    toggleDone(id) {
      const t = S.get(id); if (!t) return {};
      const done = !t.done;
      let spawned = null;
      // doneBy lets the owner be told when the person they assigned finishes it. A task given to a
      // role credits the role and the person: "Accounts (Farren)".
      const credit = t.assigneeRole ? { doneByName: done ? (S.isMyRoleTask(t) ? (t.assigneeRoleName || 'Role') + ' (' + ((state.me && state.me.name) || 'Someone') + ')' : (state.me && state.me.name) || null) : null } : {};
      S.updateTask(id, Object.assign({ done, doneAt: done ? Date.now() : null, doneBy: done && state.owner ? state.owner : null }, credit));
      if (done && t.repeat && t.repeat !== 'none' && !t.spawnedNext) {
        const next = C.clone(t);
        Object.assign(next, { id: C.uid('t'), done: false, doneAt: null, createdAt: Date.now(), due: C.nextDue(t.due, t.repeat), spawnedFrom: t.id });
        next.subtasks = (next.subtasks || []).map((s) => ({ ...s, done: false }));
        delete next.spawnedNext; delete next.moved; delete next.pushed; delete next.doneBy; delete next.doneByName; delete next.snooze; // each occurrence starts fresh (not snoozed)
        spawned = S.addTask(next);
        S.updateTask(id, { spawnedNext: spawned.id });
      } else if (!done && t.spawnedNext) {
        const sp = S.get(t.spawnedNext);
        if (sp && !sp.done && S.canDelete(sp)) S.deleteTask(sp.id);
        S.updateTask(id, { spawnedNext: null });
      }
      return { task: t, spawned };
    },

    /* ---------- map ---------- */
    /** Save after the map module changed state.map.nodes / edges (in place or replaced) */
    commitMap() {
      state.map.updatedAt = Math.max(Date.now(), (state.map.updatedAt || 0) + 1);
      state.mapRev++;
      commit('map');
    },
    setMap(nodes, edges) { state.map.nodes = nodes; state.map.edges = edges; S.commitMap(); },
    /** while true, map changes from other devices wait (so a drag isn't yanked away) */
    setMapBusy(v) {
      mapBusy = !!v;
      if (!mapBusy && mapDeferred) { const b = mapDeferred; mapDeferred = null; if (!pending('map') && takeMap(b)) { writeLocal(); emit(); } }
    },
    /* ---------- board (saved charts) ---------- */
    /** charts: the saved charts; extra: { dashboards, home } when those change (left out, they stay) */
    setBoard(charts, extra) {
      const cur = state.board;
      const next = { charts: charts || cur.charts, updatedAt: Math.max(Date.now(), (cur.updatedAt || 0) + 1) };
      const ds = extra && 'dashboards' in extra ? extra.dashboards : cur.dashboards;
      if (Array.isArray(ds) && ds.length) { next.dashboards = ds; next.home = extra && 'home' in extra ? extra.home || '' : cur.home || ''; }
      state.board = next;
      commit('board');
    },
    mapTooBig() { try { return JSON.stringify(mapBody()).length > 900000; } catch (e) { return false; } },
    /** How full the two single-record items are. A Firestore record holds at most 1 MiB;
        tasks are one record each, so they have no such limit. Cached until the map or board changes. */
    storageUse() {
      if (storageCache && storageCache.m === state.mapRev && storageCache.b === state.board.updatedAt && storageCache.bn === state.board.charts.length) return storageCache.v;
      const size = (o) => { try { return new TextEncoder().encode(JSON.stringify(o)).length; } catch (e) { return 0; } };
      const LIMIT = 1048576, usable = LIMIT - 4096; // leave room for the record's own overhead
      const mb = size(mapBody()), bb = size(boardBody()), n = state.map.nodes.length;
      const v = {
        limit: LIMIT,
        map: { bytes: mb, pct: Math.min(100, (mb / LIMIT) * 100), nodes: n, more: n ? Math.max(0, Math.floor((usable - mb) / (mb / n))) : null },
        board: { bytes: bb, pct: Math.min(100, (bb / LIMIT) * 100), charts: state.board.charts.length }
      };
      storageCache = { m: state.mapRev, b: state.board.updatedAt, bn: state.board.charts.length, v };
      return v;
    },

    setTypes(types) { state.types = types; commit('settings'); },
    setLevels(levels) { state.levels = levels; commit('settings'); },
    setPrefs(patch) {
      const syncKeys = ['defaultLevel', 'defaultType'];
      Object.assign(state.prefs, patch);
      if (Object.keys(patch).some((k) => syncKeys.includes(k))) commit('settings'); else { writeLocal(); emit(); }
    },

    clearCompleted() {
      const gone = state.tasks.filter((t) => t.done && S.isOwner(t));
      gone.forEach((t) => S.deleteTask(t.id));
      return gone;
    },
    clearSamples() {
      const gone = state.tasks.filter((t) => t.sample && S.isOwner(t));
      gone.forEach((t) => S.deleteTask(t.id));
      return gone.length;
    },
    keepSamples() { state.tasks.filter((t) => t.sample).forEach((t) => S.updateTask(t.id, { sample: false })); },
    loadSamples() { sampleTasks().forEach((t) => { state.tasks.push(t); commit(t.id, true); }); emit(); },

    exportJSON() {
      return JSON.stringify({ app: 'cadence', version: 2, exportedAt: new Date().toISOString(), tasks: state.tasks, types: state.types, levels: state.levels, map: { nodes: state.map.nodes, edges: state.map.edges }, board: state.board.charts, dashboards: state.board.dashboards || [], boardHome: state.board.home || '' }, null, 2);
    },
    importJSON(text) {
      const data = JSON.parse(text);
      // a backup from the Workmap app: { nodes, edges, tasks }
      if (data && data.app !== 'cadence' && Array.isArray(data.nodes) && Array.isArray(data.edges) && C.map) {
        const r = C.map.importWorkmap(data);
        return { added: r.tasks, total: r.tasks, nodes: r.nodes, workmap: true };
      }
      if (!data || !Array.isArray(data.tasks)) throw new Error('That file has no "tasks" list. Choose a file exported from Wayholm Plan.');
      if (Array.isArray(data.types)) state.types = data.types;
      if (Array.isArray(data.levels) && data.levels.length) state.levels = data.levels;
      commit('settings', true);
      if (data.map && Array.isArray(data.map.nodes) && Array.isArray(data.map.edges)) {
        state.map.nodes = C.clone(data.map.nodes); state.map.edges = C.clone(data.map.edges);
        state.map.updatedAt = Date.now(); state.mapRev++;
        commit('map', true);
      }
      if (Array.isArray(data.board)) { state.board = boardOf({ charts: data.board, dashboards: data.dashboards, home: data.boardHome, updatedAt: Date.now() }); commit('board', true); }
      let added = 0;
      data.tasks.forEach((t) => {
        if (!t || !t.id || !t.title) return;
        if (t.ownerId && state.owner && t.ownerId !== state.owner) return; // someone else's task
        const ex = S.get(t.id);
        if (ex) Object.assign(ex, t); else { state.tasks.push(t); added++; }
        commit(t.id, true);
      });
      emit();
      return { added, total: data.tasks.length };
    },
    /** Bulk add/update from a spreadsheet. items: [{ id?, patch }].
        A known id I own is updated; anything else becomes a new task. One re-render at the end. */
    importTasks(items, keepIds) {
      let added = 0, updated = 0, skipped = 0;
      const now = Date.now();
      items.forEach((it) => {
        const ex = it.id ? S.get(it.id) : null;
        if (ex) {
          if (!S.isOwner(ex)) { skipped++; return; } // someone else's task: change it in the app
          const patch = Object.assign({}, it.patch);
          if ('done' in patch && patch.done !== !!ex.done) patch.doneAt = patch.done ? now : null;
          Object.assign(ex, patch, { updatedAt: now });
          commit(ex.id, true); updated++;
        } else {
          const t = Object.assign({
            id: keepIds && it.id && /^[\w-]{3,64}$/.test(it.id) ? it.id : C.uid('t'), title: 'Untitled task', notes: '', typeId: state.prefs.defaultType || null,
            levelId: state.prefs.defaultLevel || (state.levels[0] && state.levels[0].id), due: null, time: null,
            done: false, doneAt: null, createdAt: now, updatedAt: now, subtasks: [], repeat: 'none'
          }, it.patch);
          if (t.done && !t.doneAt) t.doneAt = now;
          state.tasks.push(t);
          commit(t.id, true); added++;
        }
      });
      emit();
      return { added, updated, skipped };
    },
    resetAll() {
      // tasks other people assigned to you stay; hand them back to remove them
      const ids = state.tasks.filter((t) => S.isOwner(t)).map((t) => t.id);
      state.tasks = state.tasks.filter((t) => !S.isOwner(t));
      ids.forEach((id) => commit(id, true));
      state.types = C.clone(DEFAULT_TYPES);
      state.levels = C.clone(DEFAULT_LEVELS);
      state.prefs = { ...DEFAULT_PREFS, theme: state.prefs.theme };
      state.map = { nodes: [], edges: [], updatedAt: Date.now() }; state.mapRev++;
      commit('map', true);
      state.board = { charts: [], updatedAt: Date.now() };
      commit('board', true);
      commit('settings');
    }
  };

  function commit(id, silent) {
    writeLocal();
    queueWrite(id);
    if (!silent) emit();
  }

  C.store = S;
})();
