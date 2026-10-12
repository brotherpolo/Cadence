/* Cadence — task editor (bottom sheet on phones, side panel on desktop) */
(function () {
  const C = window.Cadence;
  const { D, esc, icon } = C;
  let open = null;
  // People shown as one-tap pills under "Assigned to" (emails in lowercase)
  const QUICK_ASSIGN = [
    { name: 'Adam', email: 'adampollack@gmail.com' },
    { name: 'Farren', email: 'farrenapplebaum@gmail.com' }
  ];

  C.openEditor = function (idOrPreset) {
    const S = C.store;
    const existing = typeof idOrPreset === 'string' ? S.get(idOrPreset) : null;
    const draft = existing ? C.clone(existing) : Object.assign({
      title: '', notes: '', typeId: S.state.prefs.defaultType || null, levelId: S.state.prefs.defaultLevel || (S.state.levels[0] || {}).id,
      due: null, time: null, subtasks: [], repeat: 'none', done: false, nodeId: null
    }, idOrPreset || {});
    // "Add a task to each" from the map: one draft, one task per node on save
    const bulk = !existing && Array.isArray(draft.nodeIds) && draft.nodeIds.length > 1 ? draft.nodeIds.slice() : null;
    if (!existing && Array.isArray(draft.nodeIds)) { if (!bulk) draft.nodeId = draft.nodeIds[0] || null; delete draft.nodeIds; }
    if (open) open.close(true);
    // the assignee of someone else's task can do the work and move the date, nothing more
    const ro = !!existing && !S.isOwner(existing);
    const sharing = S.sharing();
    let assignee = existing && existing.assigneeId && !ro ? { uid: existing.assigneeId, name: existing.assigneeName || '', email: existing.assigneeEmail || '' } : null;
    const assigneeBefore = assignee && assignee.uid;
    let assignQuery = '', assignMsg = '', assignBusy = false, confirmBack = false;

    const root = document.getElementById('overlay-root');
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = '<div class="sheet-backdrop" data-close></div>' +
      '<form class="sheet" role="dialog" aria-modal="true" aria-label="' + (existing ? 'Edit task' : bulk ? 'New task for ' + bulk.length + ' nodes' : 'New task') + '" novalidate>' +
      '<div class="sheet-grab" aria-hidden="true"></div>' +
      '<div class="sheet-head"><span class="eyebrow">' + (existing ? (existing.done ? 'Completed task' : 'Edit task') : bulk ? 'New task · ' + bulk.length + ' nodes' : 'New task') + '</span>' +
      '<button type="button" class="icon-btn" data-close aria-label="Close">' + icon('x') + '</button></div>' +
      '<div class="sheet-body"></div>' +
      '<div class="sheet-foot">' +
      (existing && !ro ? '<button type="button" class="btn ghost danger" data-act="delete">' + icon('trash') + '<span>Delete</span></button>' : '') +
      (ro ? '<button type="button" class="btn ghost" data-act="handback">' + icon('upload') + '<span>Hand back</span></button>' : '') +
      '<span class="spacer"></span>' +
      '<button type="button" class="btn ghost" data-close>Cancel</button>' +
      '<button type="submit" class="btn primary">' + (existing ? 'Save' : bulk ? 'Add ' + bulk.length + ' tasks' : 'Add task') + '</button>' +
      '</div></form>';
    root.appendChild(wrap);
    const form = wrap.querySelector('form');
    const body = wrap.querySelector('.sheet-body');

    function render() {
      const types = S.state.types, levels = S.state.levels;
      const tk = D.todayKey();
      const quick = [['Today', tk], ['Tomorrow', D.addKey(tk, 1)], ['Next week', D.key(D.add(D.startOfWeek(D.today(), S.state.prefs.weekStart), 7))], ['No date', '']];
      const sub = draft.subtasks || [];
      body.innerHTML =
        '<label class="sr" for="ed-title">Title</label>' +
        '<div class="ed-title-row">' +
        (existing ? '<button type="button" class="check lg' + (draft.done ? ' on' : '') + '" data-act="done" aria-pressed="' + draft.done + '" aria-label="Mark complete" style="--lv:' + lvColor(draft.levelId) + '">' + icon('check') + '</button>' : '') +
        '<textarea id="ed-title" class="ed-title" rows="1" placeholder="What needs doing?" required' + (ro ? ' readonly' : '') + '>' + esc(draft.title) + '</textarea></div>' +
        (ro ? fromNote() : '') +
        (sharing && !ro ? assignField() : '') +
        (!ro && C.map ? nodeField() : '') +

        (ro ? roField('Importance', S.levelOf(existing), false) :
        '<div class="field"><span class="field-label">Importance</span><div class="seg" role="radiogroup">' +
        levels.map((l) => '<button type="button" role="radio" class="seg-btn' + (draft.levelId === l.id ? ' on' : '') + '" data-level="' + l.id + '" aria-checked="' + (draft.levelId === l.id) + '" style="--c:' + l.color + '"><i class="dot"></i>' + esc(l.name) + '</button>').join('') +
        '</div></div>') +

        (ro ? roField('Type', S.typeOf(existing), true) :
        '<div class="field"><span class="field-label">Type</span><div class="chips">' +
        '<button type="button" class="chip' + (!draft.typeId ? ' on' : '') + '" data-type="">None</button>' +
        types.map((t) => '<button type="button" class="chip' + (draft.typeId === t.id ? ' on' : '') + '" data-type="' + t.id + '" style="--c:' + t.color + '">' + icon(t.glyph) + esc(t.name) + '</button>').join('') +
        '</div></div>') +

        '<div class="field"><span class="field-label">When</span>' +
        '<div class="chips">' + quick.map(([lbl, k]) => '<button type="button" class="chip' + ((draft.due || '') === k ? ' on' : '') + '" data-due="' + k + '">' + lbl + '</button>').join('') + '</div>' +
        '<div class="row2"><label class="input-wrap"><span class="sr">Date</span>' + icon('calendar') + '<input id="ed-date" type="date" value="' + (draft.due || '') + '"></label>' +
        '<label class="input-wrap"><span class="sr">Time</span>' + icon('clock') + '<input id="ed-time" type="time" value="' + (draft.time || '') + '"></label></div>' +
        '<label class="input-wrap"><span class="sr">Repeat</span>' + icon('repeat') + '<select id="ed-repeat"' + (ro ? ' disabled' : '') + '>' +
        C.REPEATS.map((r) => '<option value="' + r.id + '"' + (draft.repeat === r.id ? ' selected' : '') + '>' + r.label + '</option>').join('') + '</select></label>' +
        (existing && existing.moved ? '<p class="fine ed-moved">' + icon('repeat') + 'Rescheduled ' + (existing.moved === 1 ? 'once' : existing.moved + ' times') + (existing.pushed ? ' · pushed back ' + existing.pushed + ' day' + (existing.pushed === 1 ? '' : 's') + ' in all' : '') + '</p>' : '') +
        '</div>' +

        '<div class="field"><span class="field-label">Checklist <span class="muted mono">' + (sub.length ? sub.filter((x) => x.done).length + '/' + sub.length : '') + '</span></span>' +
        '<ul class="subs">' + sub.map((x, i) => '<li class="sub"><button type="button" class="check sm' + (x.done ? ' on' : '') + '" data-sub-toggle="' + i + '" aria-label="Toggle step">' + icon('check') + '</button>' +
          '<input id="ed-sub-' + x.id + '" class="sub-input' + (x.done ? ' done' : '') + '" value="' + esc(x.title) + '" data-sub-edit="' + i + '" aria-label="Step" enterkeyhint="enter" autocomplete="off">' +
          '<button type="button" class="icon-btn sm" data-sub-del="' + i + '" aria-label="Remove step">' + icon('x') + '</button></li>').join('') +
        '<li class="sub add"><span class="sub-plus">' + icon('plus') + '</span><input id="ed-sub-new" class="sub-input" placeholder="Add a step" enterkeyhint="enter" autocomplete="off" aria-label="New step">' +
          '<button type="button" class="btn sm sub-add-btn" data-act="sub-add">Add</button></li></ul>' +
          '<p class="sub-tip muted">Paste a list to add every line as its own step.</p></div>' +

        '<div class="field"><label class="field-label" for="ed-notes">Notes</label><textarea id="ed-notes" rows="3" placeholder="Links, details, context…">' + esc(draft.notes || '') + '</textarea></div>';
      autoGrow(body.querySelector('#ed-title'));
      const aq = body.querySelector('#ed-assign');
      if (aq && document.activeElement !== aq) aq.value = assignQuery;
    }
    function nodeField() {
      const m = C.map;
      if (bulk) {
        return '<div class="field"><span class="field-label">On the map</span><div class="chips">' +
          bulk.slice(0, 6).map((id) => { const n = m.getNode(id); return n ? '<span class="chip static" style="--c:' + m.colorHex(n.color) + '"><i class="dot"></i>' + esc(m.title(n)) + '</span>' : ''; }).join('') +
          (bulk.length > 6 ? '<span class="chip static">+' + (bulk.length - 6) + ' more</span>' : '') + '</div><p class="field-msg muted">Saving adds one copy of this task to each node.</p></div>';
      }
      if (!m.nodes().length && !draft.nodeId) return '';
      const n = m.getNode(draft.nodeId);
      return '<div class="field"><span class="field-label">On the map</span><div class="ed-node">' +
        '<button type="button" class="chip ed-node-pick' + (n ? ' on' : '') + '" data-act="node"' + (n ? ' style="--c:' + m.colorHex(n.color) + '"' : '') + ' aria-haspopup="listbox">' +
        (n ? '<i class="dot"></i><span>' + esc(m.title(n)) + '</span>' : icon('canvas') + '<span>' + (draft.nodeId ? 'Its node was deleted' : 'Link to a node') + '</span>') + icon('chevD') + '</button>' +
        (n ? '<button type="button" class="icon-btn sm" data-act="node-clear" aria-label="Unlink from the map" title="Unlink">' + icon('x') + '</button>' +
          '<button type="button" class="btn sm ghost" data-act="node-go">' + icon('target') + '<span>Show on canvas</span></button>' : '') +
        '</div></div>';
    }
    function fromNote() {
      const o = { uid: existing.ownerId, name: existing.ownerName, email: existing.ownerEmail };
      const first = C.firstName(o.name, o.email);
      return '<div class="ed-from">' + C.avatar(o) + '<p><b>' + esc(o.name || o.email || 'Someone') + '</b> assigned this to you. You can change the date, checklist and notes. Ask ' + esc(first) + ' to change anything else.</p></div>';
    }
    function roField(label, v, glyph) {
      return '<div class="field"><span class="field-label">' + label + '</span><div class="chips">' +
        (v ? '<span class="chip on static" style="--c:' + v.color + '">' + (glyph && v.glyph ? icon(v.glyph) : '<i class="dot"></i>') + esc(v.name) + '</span>' : '<span class="chip static">None</span>') +
        '</div></div>';
    }
    function assignField() {
      const me = S.me() || {};
      const recent = S.people();
      // quick-assign pills, minus whoever is signed in (they already have "Me")
      const favs = QUICK_ASSIGN.filter((f) => f.email !== me.email).map((f) => {
        const known = recent.find((p) => (p.email || '').toLowerCase() === f.email);
        return { uid: known ? known.uid : '', name: f.name, email: f.email };
      });
      const isFav = (p) => favs.some((f) => (p.email && p.email.toLowerCase() === f.email) || (f.uid && p.uid === f.uid));
      const people = recent.filter((p) => p.uid !== S.state.owner && !isFav(p));
      if (assignee && !isFav(assignee) && !people.some((p) => p.uid === assignee.uid)) people.unshift(assignee);
      const favOn = (f) => !!(assignee && (((assignee.email || '').toLowerCase() === f.email) || (f.uid && assignee.uid === f.uid)));
      return '<div class="field"><span class="field-label">Assigned to</span>' +
        '<div class="chips">' +
        '<button type="button" class="chip' + (!assignee ? ' on' : '') + '" data-assign="" aria-pressed="' + !assignee + '">' + C.avatar({ uid: S.state.owner, name: me.name, email: me.email }) + 'Me</button>' +
        favs.map((f) => '<button type="button" class="chip' + (favOn(f) ? ' on' : '') + '" data-assign-email="' + esc(f.email) + '" aria-pressed="' + favOn(f) + '" title="' + esc(f.email) + '"' + (assignBusy ? ' disabled' : '') + '>' + C.avatar(f) + esc(f.name) + '</button>').join('') +
        people.map((p) => '<button type="button" class="chip' + (assignee && assignee.uid === p.uid ? ' on' : '') + '" data-assign="' + esc(p.uid) + '" aria-pressed="' + !!(assignee && assignee.uid === p.uid) + '" title="' + esc(p.email || '') + '">' + C.avatar(p) + esc(p.name || p.email) + '</button>').join('') +
        '</div>' +
        '<div class="assign-find"><label class="input-wrap">' + icon('search') + '<span class="sr">Assign by email</span><input id="ed-assign" type="email" inputmode="email" autocomplete="off" placeholder="Assign by email"></label>' +
        '<button type="button" class="btn sm" data-act="find"' + (assignBusy ? ' disabled' : '') + '>' + (assignBusy ? 'Looking up…' : 'Assign') + '</button></div>' +
        (assignMsg ? '<p class="field-msg" role="status">' + esc(assignMsg) + '</p>' : '') +
        '</div>';
    }
    async function findAssignee(fromPill) {
      const email = fromPill || (body.querySelector('#ed-assign') || {}).value || '';
      if (!fromPill) assignQuery = email;
      const e = email.trim().toLowerCase();
      if (!e) { assignMsg = 'Type the email address they sign in with.'; sync(); return render(); }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { assignMsg = 'That email address doesn’t look right.'; sync(); return render(); }
      const me = S.me() || {};
      if (e === me.email) { assignee = null; assignQuery = ''; assignMsg = ''; sync(); return render(); }
      sync(); assignBusy = true; assignMsg = ''; render();
      try {
        const p = await S.findPerson(e);
        if (!wrap.isConnected) return;
        if (p && p.uid) {
          const fav = QUICK_ASSIGN.find((f) => f.email === e);
          assignee = Object.assign({}, p, { name: p.name || (fav && fav.name) || '' });
          if (!fromPill) assignQuery = '';
          assignMsg = '';
        }
        else assignMsg = 'No one has signed in to Cadence with ' + e + ' yet. Ask them to sign in once with Google, then try again.';
      } catch (err) {
        assignMsg = 'Couldn’t look that up: ' + ((err && (err.code || err.message)) || 'unknown error') + '.';
      }
      assignBusy = false; sync(); render();
    }
    function lvColor(id) { const l = S.levelById(id); return l ? l.color : 'var(--ink-3)'; }
    function autoGrow(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
    function sync() {
      draft.title = body.querySelector('#ed-title').value;
      draft.notes = body.querySelector('#ed-notes').value;
      draft.due = body.querySelector('#ed-date').value || null;
      draft.time = body.querySelector('#ed-time').value || null;
      draft.repeat = body.querySelector('#ed-repeat').value;
    }
    /* ---------- checklist helpers ---------- */
    // "- milk", "• eggs", "1. bread", "[ ] jam" → "milk", "eggs", "bread", "jam"
    function cleanStep(line) { return line.replace(/^\s*(?:[-*•–—]|\d+[.)]|\[[ xX]?\])\s*/, '').trim(); }
    function insertSteps(titles, at) {
      draft.subtasks = draft.subtasks || [];
      const items = titles.map((t) => ({ id: C.uid('s'), title: t, done: false }));
      draft.subtasks.splice(at == null ? draft.subtasks.length : at, 0, ...items);
      return items.length ? items[items.length - 1].id : null;
    }
    // id = a step to focus (caret at the end); null = the "Add a step" field
    function focusStep(id) {
      const el = body.querySelector(id ? '#ed-sub-' + id : '#ed-sub-new');
      if (!el) return;
      el.focus();
      try { el.setSelectionRange(el.value.length, el.value.length); } catch (err) { /* not supported */ }
      el.scrollIntoView({ block: 'nearest' });
    }
    function addFromNewInput() {
      const inp = body.querySelector('#ed-sub-new');
      const v = inp ? inp.value.trim() : '';
      if (!v) { if (inp) inp.focus(); return; }
      sync(); insertSteps([v]); render(); focusStep(null);
    }

    render();

    // pasting several lines adds one step per line
    body.addEventListener('paste', (e) => {
      const t = e.target;
      if (t.id !== 'ed-sub-new' && t.dataset.subEdit == null) return;
      const text = (e.clipboardData || window.clipboardData).getData('text') || '';
      const lines = text.split(/\r?\n/).map(cleanStep).filter(Boolean);
      if (lines.length < 2) return; // a single line pastes normally
      e.preventDefault(); sync();
      if (t.id === 'ed-sub-new') {
        const pre = t.value.trim();
        if (pre) lines[0] = pre + ' ' + lines[0];
        insertSteps(lines); render(); focusStep(null);
      } else {
        const i = +t.dataset.subEdit, cur = draft.subtasks[i];
        if (!cur.title.trim()) cur.title = lines.shift(); // fill an empty step first
        const id = insertSteps(lines, i + 1) || cur.id;
        render(); focusStep(id);
      }
    });
    // keep the keyboard open when tapping Add
    wrap.addEventListener('mousedown', (e) => { if (e.target.closest('[data-act="sub-add"]')) e.preventDefault(); });

    body.addEventListener('input', (e) => {
      if (e.target.id === 'ed-assign') assignQuery = e.target.value;
      if (e.target.id === 'ed-title') autoGrow(e.target);
      if (e.target.dataset.subEdit != null) draft.subtasks[+e.target.dataset.subEdit].title = e.target.value;
    });
    body.addEventListener('change', (e) => {
      if (e.target.id === 'ed-date' || e.target.id === 'ed-time') { sync(); render(); }
    });
    body.addEventListener('keydown', (e) => {
      if (e.target.id === 'ed-assign' && e.key === 'Enter') { e.preventDefault(); findAssignee(); return; }
      const isEnter = (e.key === 'Enter' || e.keyCode === 13) && !e.isComposing;
      if (e.target.id === 'ed-sub-new' && isEnter) { e.preventDefault(); addFromNewInput(); return; }
      if (e.target.dataset.subEdit != null) {
        const i = +e.target.dataset.subEdit;
        // Enter in a step starts a new step right below it, like a notes app
        if (isEnter) { e.preventDefault(); sync(); const id = insertSteps([''], i + 1); render(); focusStep(id); return; }
        // Backspace in an empty step removes it and moves up
        if (e.key === 'Backspace' && !e.target.value) {
          e.preventDefault(); sync();
          draft.subtasks.splice(i, 1);
          const prev = draft.subtasks[i - 1];
          render(); focusStep(prev ? prev.id : null);
          return;
        }
      }
      if (e.target.id === 'ed-title' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    });
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('button,[data-close]');
      if (!b) return;
      if (b.hasAttribute('data-close')) return close();
      if (b.dataset.act !== 'handback' && confirmBack) { confirmBack = false; resetBack(); }
      if (b.dataset.assign != null) { sync(); const uid = b.dataset.assign; assignee = uid ? (S.people().concat(assignee ? [assignee] : []).find((p) => p.uid === uid) || null) : null; assignMsg = ''; render(); return; }
      if (b.dataset.assignEmail != null) {
        sync();
        const em = b.dataset.assignEmail;
        const known = S.people().concat(assignee ? [assignee] : []).find((p) => p.uid && (p.email || '').toLowerCase() === em);
        if (known) { assignee = known; assignMsg = ''; render(); } else findAssignee(em);
        return;
      }
      if (b.dataset.act === 'find') { findAssignee(); return; }
      if (b.dataset.act === 'node') { sync(); C.map.pickNode({ anchor: b, current: draft.nodeId, allowNone: !!draft.nodeId, noneLabel: 'Not on the map', onPick: (id) => { draft.nodeId = id; render(); } }); return; }
      if (b.dataset.act === 'node-clear') { sync(); draft.nodeId = null; render(); return; }
      if (b.dataset.act === 'node-go') { const id = draft.nodeId; close(); C.map.focusNode(id); return; }
      if (b.dataset.act === 'sub-add') { addFromNewInput(); return; }
      if (b.dataset.act === 'handback') {
        if (!confirmBack) { confirmBack = true; b.querySelector('span').textContent = 'Hand back to ' + C.firstName(existing.ownerName, existing.ownerEmail) + '?'; b.classList.add('danger'); return; }
        close(true); C.handBack(existing.id); return;
      }
      if (b.dataset.level) { sync(); draft.levelId = b.dataset.level; render(); }
      else if (b.dataset.type != null) { sync(); draft.typeId = b.dataset.type || null; render(); }
      else if (b.dataset.due != null) { sync(); draft.due = b.dataset.due || null; if (!draft.due) draft.time = null; render(); }
      else if (b.dataset.subToggle != null) { sync(); const x = draft.subtasks[+b.dataset.subToggle]; x.done = !x.done; render(); }
      else if (b.dataset.subDel != null) { sync(); draft.subtasks.splice(+b.dataset.subDel, 1); render(); }
      else if (b.dataset.act === 'done') { sync(); draft.done = !draft.done; render(); }
      else if (b.dataset.act === 'delete') {
        const t = S.deleteTask(existing.id);
        close(true);
        C.toast('Deleted “' + t.title + '”', { action: 'Undo', onAction: () => S.restoreTask(t) });
      }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      sync();
      const title = draft.title.trim();
      if (!title) { body.querySelector('#ed-title').focus(); body.querySelector('#ed-title').classList.add('shake'); setTimeout(() => body.querySelector('#ed-title') && body.querySelector('#ed-title').classList.remove('shake'), 400); return; }
      draft.title = title;
      draft.subtasks = (draft.subtasks || []).filter((x) => x.title.trim());
      const pendingSub = body.querySelector('#ed-sub-new').value.trim();
      if (pendingSub) draft.subtasks.push({ id: C.uid('s'), title: pendingSub, done: false });
      const who = sharing && !ro ? S.assigneeFields(assignee) : {};
      const forName = assignee ? C.firstName(assignee.name, assignee.email) : '';
      if (existing) {
        const wasDone = existing.done;
        const patch = ro
          ? { notes: draft.notes, due: draft.due, time: draft.due ? draft.time : null, subtasks: draft.subtasks }
          : Object.assign({ title: draft.title, notes: draft.notes, typeId: draft.typeId, levelId: draft.levelId, due: draft.due, time: draft.due ? draft.time : null, repeat: draft.repeat, subtasks: draft.subtasks, nodeId: draft.nodeId || null }, who);
        S.updateTask(existing.id, patch);
        if (draft.done !== wasDone) C.completeTask(existing.id);
        close(true);
        if (sharing && !ro && (assignee && assignee.uid) !== assigneeBefore) C.toast(assignee ? 'Assigned “' + draft.title + '” to ' + forName : 'You’re doing “' + draft.title + '” yourself now');
      } else if (bulk) {
        const made = bulk.map((nodeId) => S.addTask(Object.assign({ title: draft.title, notes: draft.notes, typeId: draft.typeId, levelId: draft.levelId, due: draft.due, time: draft.due ? draft.time : null, repeat: draft.repeat, subtasks: C.clone(draft.subtasks).map((x) => Object.assign(x, { id: C.uid('s') })), nodeId }, who)));
        close(true);
        C.toast('Added “' + draft.title + '” to ' + made.length + ' nodes', { action: 'Undo', onAction: () => made.forEach((t) => S.deleteTask(t.id)) });
      } else {
        const t = S.addTask(Object.assign({ title: draft.title, notes: draft.notes, typeId: draft.typeId, levelId: draft.levelId, due: draft.due, time: draft.due ? draft.time : null, repeat: draft.repeat, subtasks: draft.subtasks }, draft.nodeId ? { nodeId: draft.nodeId } : {}, who));
        close(true);
        C.toast('Added “' + t.title + '”' + (assignee ? ' for ' + forName : '') + (t.due ? ' · ' + C.relDate(t.due) : ''));
      }
    });
    function resetBack() {
      const hb = wrap.querySelector('[data-act="handback"]');
      if (hb) { hb.querySelector('span').textContent = 'Hand back'; hb.classList.remove('danger'); }
    }
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); }
    };
    document.addEventListener('keydown', onKey, true);

    // drag-down to dismiss on phones
    const grab = wrap.querySelector('.sheet-grab');
    let y0 = null;
    grab.addEventListener('pointerdown', (e) => { y0 = e.clientY; grab.setPointerCapture(e.pointerId); });
    grab.addEventListener('pointermove', (e) => { if (y0 != null) form.style.transform = 'translateY(' + Math.max(0, e.clientY - y0) + 'px)'; });
    grab.addEventListener('pointerup', (e) => { const dy = e.clientY - y0; y0 = null; form.style.transform = ''; if (dy > 90) close(); });

    const prevFocus = document.activeElement;
    requestAnimationFrame(() => {
      wrap.classList.add('in');
      const ti = body.querySelector('#ed-title');
      if (!existing || window.matchMedia('(pointer:fine)').matches) { ti.focus(); ti.setSelectionRange(ti.value.length, ti.value.length); }
    });
    document.documentElement.classList.add('sheet-open');

    function close(immediate) {
      document.removeEventListener('keydown', onKey, true);
      document.documentElement.classList.remove('sheet-open');
      wrap.classList.remove('in');
      setTimeout(() => wrap.remove(), immediate ? 0 : 220);
      if (prevFocus && prevFocus.focus) try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* gone */ }
      open = null;
    }
    open = { close };
  };
})();
