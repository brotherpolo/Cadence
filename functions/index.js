/* Cadence — Cloud Functions for push notifications.
 *
 *   taskChanged   a task was written: tell the assignee when it's assigned to
 *                 them, and the owner when the assignee finishes it
 *   reminders     every 5 minutes: due-time reminders, and once a day the
 *                 morning summary (due today without a time, plus overdue)
 *   pushTest      "Send a test" in Settings
 *   removeAccount Formwright → Users → Remove: an administrator removes a person (remove.js)
 *   autoNumberOnCreate, autoNumberFill, autoNumberSet
 *                 Formwright's Auto number fields (autonumber.js)
 *   emailRecord   Formwright → Email PDF: an administrator emails a record's PDF (email.js)
 *   audit*        Formwright → Audit trail: records, forms, groups, accounts and settings as
 *                 they change; restoreRecord brings a deleted record back (audit.js)
 *
 * Each person's choices live in notify/{uid}; their devices' push tokens in
 * notify/{uid}/devices/{deviceId}. Times are worked out in that person's own
 * time zone (saved by the app). Tokens that stop working are deleted.
 * notifyState/{uid} remembers when reminders last ran for each person; only
 * these functions can see it (firestore.rules denies it to everyone else).
 */
const { onDocumentWritten, onDocumentCreated, onDocumentWrittenWithAuthContext } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { removeAccount } = require('./remove');
const autonumber = require('./autonumber');
const { sendRecordEmail } = require('./email');
const audit = require('./audit');
const { defineSecret } = require('firebase-functions/params');
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD');

admin.initializeApp();
const db = admin.firestore();
setGlobalOptions({ region: process.env.CADENCE_REGION || 'us-central1', maxInstances: 5 });

const DEFAULTS = { due: true, assigned: true, finished: true, digest: true, morning: '08:00', lead: 0 };
const EVERY_MIN = 5;          // how often reminders runs
const MAX_CATCHUP = 60 * 60e3; // after downtime, don't replay more than an hour of reminders

/* ---------- time zones ---------- */
function offsetAt(ts, tz) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ts));
  const g = (k) => +p.find((x) => x.type === k).value;
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - ts;
}
/** "2026-10-12" + "08:00" in tz → epoch ms */
function zoned(dateKey, hm, tz) {
  const [y, m, d] = dateKey.split('-').map(Number), [h, mi] = hm.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let t = wall - offsetAt(wall, tz);
  const again = wall - offsetAt(t, tz); // daylight-saving edges
  if (again !== t) t = again;
  return t;
}
const dayKey = (ts, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
const addDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const clock = (hm) => { const [h, m] = hm.split(':').map(Number); return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM'); };
/** "today", "tomorrow", "Wednesday" (this week) or "Tue, Oct 13", in the person's own calendar */
function when(dateKey, tz, now = Date.now()) {
  const today = dayKey(now, tz);
  if (dateKey === today) return 'today';
  if (dateKey === addDays(today, 1)) return 'tomorrow';
  if (dateKey === addDays(today, -1)) return 'yesterday';
  const [y, m, d] = dateKey.split('-').map(Number), dt = new Date(Date.UTC(y, m - 1, d, 12));
  const ahead = (Date.UTC(y, m - 1, d) - Date.parse(today + 'T00:00:00Z')) / 864e5;
  if (ahead > 1 && ahead < 7) return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(dt);
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(dt);
}
const safeTz = (tz) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch (e) { return 'UTC'; } };

/* ---------- people & tasks ---------- */
const shared = (t) => !!(t.assigneeId && t.assigneeId !== t.ownerId);
const doerOf = (t) => (shared(t) ? t.assigneeId : t.ownerId);
const nameOf = (n, e) => (n ? String(n).split(/\s+/)[0] : e ? String(e).split('@')[0] : 'Someone');
const list = (titles, max = 3) => (titles.length <= max ? titles : titles.slice(0, max).concat(['and ' + (titles.length - max) + ' more'])).join(', ');
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

/* ---------- sending ---------- */
async function prefsFor(uid) {
  const snap = await db.collection('notify').doc(uid).get();
  return snap.exists ? Object.assign({}, DEFAULTS, snap.data()) : null;
}
/** send one notification to every device this person turned on; force skips their choices (for tests) */
async function sendTo(uid, kind, msg, prefs, force) {
  prefs = prefs || await prefsFor(uid);
  if (!prefs || (!force && !prefs[kind])) return 0;
  const devs = await db.collection('notify').doc(uid).collection('devices').get();
  const tokens = devs.docs.map((d) => ({ ref: d.ref, token: d.get('token') })).filter((x) => x.token);
  if (!tokens.length) return 0;
  const url = prefs.origin || '';
  const data = { title: msg.title, body: msg.body || '', tag: msg.tag || kind, task: msg.task || '', url };
  // data-only, so the service worker controls how it looks and what a tap opens
  const res = await admin.messaging().sendEachForMulticast({
    tokens: tokens.map((x) => x.token),
    data,
    webpush: { headers: { Urgency: 'high', TTL: String(msg.ttl || 6 * 3600) } }
  });
  const dead = [];
  res.responses.forEach((r, i) => {
    if (r.success) return;
    const code = r.error && r.error.code;
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token' || code === 'messaging/invalid-argument') dead.push(tokens[i].ref.delete());
    else logger.warn('push failed', { uid, code, message: r.error && r.error.message });
  });
  await Promise.all(dead);
  return res.successCount;
}

/* ---------- assigned to you / your task was finished ---------- */
exports.taskChanged = onDocumentWritten('tasks/{taskId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  if (!after || after.sample) return;
  const title = after.title || 'A task';
  const jobs = [];
  // newly assigned to someone else (not a repeat's next occurrence)
  if (shared(after) && (before ? before.assigneeId !== after.assigneeId : !after.spawnedFrom)) {
    const prefs = await prefsFor(after.assigneeId);
    if (prefs) {
      const tz = safeTz(prefs.tz || 'UTC');
      jobs.push(sendTo(after.assigneeId, 'assigned', {
        title: nameOf(after.ownerName, after.ownerEmail) + ' assigned you a task',
        body: title + (after.due ? ' · due ' + when(after.due, tz) + (after.time ? ' at ' + clock(after.time) : '') : ''),
        tag: 'assigned-' + event.params.taskId, task: event.params.taskId
      }, prefs));
    }
  }
  // finished by the person it was given to
  if (before && !before.done && after.done && shared(after) && after.doneBy && after.doneBy !== after.ownerId) {
    jobs.push(sendTo(after.ownerId, 'finished', {
      title: nameOf(after.assigneeName, after.assigneeEmail) + ' finished a task',
      body: title, tag: 'finished-' + event.params.taskId, task: event.params.taskId
    }));
  }
  await Promise.all(jobs);
});

/* ---------- reminders and the morning summary ---------- */
exports.reminders = onSchedule({ schedule: 'every ' + EVERY_MIN + ' minutes', timeoutSeconds: 120, retryCount: 0 }, async () => {
  const now = Date.now();
  const [people, states] = await Promise.all([db.collection('notify').get(), db.collection('notifyState').get()]);
  const last = new Map(states.docs.map((d) => [d.id, d.get('lastCheck') || 0]));
  for (const p of people.docs) {
    try { await remindOne(p.id, Object.assign({}, DEFAULTS, p.data()), now, last.get(p.id)); }
    catch (e) { logger.error('reminders failed for a user', { uid: p.id, error: e.message }); }
  }
});

async function remindOne(uid, prefs, now, lastCheck) {
  const since = Math.max(lastCheck || now - EVERY_MIN * 60e3, now - MAX_CATCHUP);
  const tz = safeTz(prefs.tz || 'UTC'), today = dayKey(now, tz);
  const ref = db.collection('notify').doc(uid), state = db.collection('notifyState').doc(uid);
  const done = () => state.set({ lastCheck: now });
  if (!prefs.due && !prefs.digest) return done();
  const hasDevice = !(await ref.collection('devices').limit(1).get()).empty;
  if (!hasDevice) return done();

  const mine = (snap) => snap.docs.map((d) => Object.assign({ id: d.id }, d.data())).filter((t) => !t.done && !t.sample && doerOf(t) === uid);
  const inWindow = (at) => at > since && at <= now;
  const morningAt = zoned(today, prefs.morning || '08:00', tz);
  const sends = [];

  if (prefs.due) {
    // timed tasks around today (a lead time can reach into tomorrow's early hours)
    const near = mine(await db.collection('tasks').where('members', 'array-contains', uid).where('due', 'in', [addDays(today, -1), today, addDays(today, 1)]).get());
    near.filter((t) => t.time).forEach((t) => {
      const at = zoned(t.due, t.time, tz) - (+prefs.lead || 0) * 60e3;
      if (inWindow(at)) sends.push(sendTo(uid, 'due', { title: t.title || 'Task due', body: (prefs.lead ? 'Due at ' : 'Due now · ') + clock(t.time), tag: 'due-' + t.id, task: t.id }, prefs));
    });
    if (inWindow(morningAt)) {
      const untimed = near.filter((t) => t.due === today && !t.time);
      let overdue = [];
      if (prefs.digest) overdue = mine(await db.collection('tasks').where('members', 'array-contains', uid).where('due', '<', today).get());
      if (untimed.length || overdue.length) sends.push(morning(uid, prefs, untimed, overdue));
    }
  } else if (prefs.digest && inWindow(morningAt)) {
    const overdue = mine(await db.collection('tasks').where('members', 'array-contains', uid).where('due', '<', today).get());
    if (overdue.length) sends.push(morning(uid, prefs, [], overdue));
  }
  await Promise.all(sends);
  await done();
}

function morning(uid, prefs, today, overdue) {
  const head = [today.length ? plural(today.length, 'task') + ' due today' : null, overdue.length ? overdue.length + ' overdue' : null].filter(Boolean).join(' · ');
  const lines = [];
  if (today.length) lines.push('Today: ' + list(today.map((t) => t.title)));
  if (overdue.length) lines.push('Overdue: ' + list(overdue.sort((a, b) => (a.due < b.due ? -1 : 1)).map((t) => t.title)));
  return sendTo(uid, prefs.due ? 'due' : 'digest', { title: 'Good morning · ' + head, body: lines.join('\n'), tag: 'morning', ttl: 12 * 3600 }, prefs, true);
}

/* ---------- Settings → Send a test ---------- */
exports.pushTest = onDocumentWritten('notify/{uid}', async (event) => {
  const b = (event.data.before.exists && event.data.before.data()) || {}, a = (event.data.after.exists && event.data.after.data()) || {};
  if (!a.testAt || a.testAt === b.testAt) return;
  const n = await sendTo(event.params.uid, 'test', { title: 'Cadence notifications are on', body: 'This is a test. Reminders and updates will look like this.', tag: 'test' }, Object.assign({}, DEFAULTS, a), true);
  logger.info('test push', { uid: event.params.uid, delivered: n });
});

/* ---------- Formwright → Users → Remove ---------- */
exports.removeAccount = onCall({ region: 'us-central1', timeoutSeconds: 300 }, async (request) => {
  try {
    const out = await removeAccount(db, admin.auth(), request.auth && request.auth.uid, request.data);
    logger.info('removed account', { by: request.auth.uid, uid: request.data.uid, giveTo: request.data.giveTo || null, out });
    await logAudit(request.auth.uid, { area: 'user', kind: 'removed', targetId: request.data.uid, targetName: out.name || '',
      note: [out.records ? `${out.records} record${out.records === 1 ? '' : 's'} given to someone else` : 'records kept under their name', out.tasksDeleted ? `${out.tasksDeleted} task${out.tasksDeleted === 1 ? '' : 's'} deleted` : '', out.tasksReturned ? `${out.tasksReturned} handed back` : ''].filter(Boolean).join('; ') });
    return out;
  } catch (e) {
    const known = ['unauthenticated', 'invalid-argument', 'failed-precondition', 'permission-denied', 'not-found'];
    if (known.includes(e.code)) throw new HttpsError(e.code, e.message);
    logger.error('removeAccount failed', e);
    throw new HttpsError('internal', 'The removal didn’t finish. Try again; nothing already removed comes back.');
  }
});

/* ---------- Formwright → Auto number fields ---------- */
const CALLABLE_CODES = ['unauthenticated', 'invalid-argument', 'failed-precondition', 'permission-denied', 'not-found', 'already-exists', 'resource-exhausted', 'unavailable'];
const callable = (name, fn) => onCall({ region: 'us-central1', timeoutSeconds: 300 }, async (request) => {
  try {
    return await fn(db, request.auth && request.auth.uid, request.data);
  } catch (e) {
    if (CALLABLE_CODES.includes(e.code)) throw new HttpsError(e.code, e.message);
    logger.error(name + ' failed', e);
    throw new HttpsError('internal', 'That didn’t finish. Try again.');
  }
});

// every new record: number its Auto number fields (runs in the database's region)
exports.autoNumberOnCreate = onDocumentCreated('records/{recordId}', async (event) => {
  try {
    await autonumber.assignOnCreate(db, event.params.recordId);
  } catch (e) {
    logger.error('auto number failed', { recordId: event.params.recordId, error: String(e && e.message) });
    throw e; // retried by Firestore triggers when retries are on; otherwise "Number existing records" fixes it
  }
});
exports.autoNumberFill = callable('autoNumberFill', async (d, uid, data) => {
  const out = await autonumber.fillNumbers(d, uid, data);
  const form = await formInfo(data.formId);
  const f = (form.fields || []).find((x) => x.id === data.fieldId);
  await logAudit(uid, { area: 'form', kind: 'numbered', formId: data.formId, formName: form.name || '', targetId: data.formId, targetName: form.name || '',
    note: `${f ? f.label + ': ' : ''}numbered ${out.numbered}${out.numbered ? ` (${out.first}${out.numbered > 1 ? ' to ' + out.last : ''})` : ''}; kept ${out.kept} typed in${out.duplicates.length ? '; duplicates: ' + out.duplicates.join(', ') : ''}` });
  return out;
});
exports.autoNumberSet = callable('autoNumberSet', async (d, uid, data) => {
  const out = await autonumber.setNumber(d, uid, data);
  const rec = (await db.collection('records').doc(data.recordId).get()).data() || {};
  const form = await formInfo(rec.formId);
  const f = (form.fields || []).find((x) => x.id === data.fieldId);
  await logAudit(uid, { area: 'record', kind: 'changed', recordId: data.recordId, formId: rec.formId, formName: form.name || '', title: audit.titleOf(rec, form),
    changes: [{ key: data.fieldId, label: (f && f.label) || 'Number', type: 'autonumber', from: out.from, to: out.to }], note: 'Number changed by an administrator' });
  return out;
});

/* ---------- Formwright → Email PDF ---------- */
// Sends through Gmail as GMAIL_USER (functions/.env) with the app password from Secret Manager.
let mailer = null;
exports.emailRecord = onCall({ region: 'us-central1', timeoutSeconds: 120, memory: '512MiB', secrets: [GMAIL_APP_PASSWORD] }, async (request) => {
  try {
    const user = String(process.env.GMAIL_USER || '').trim();
    const pass = String(GMAIL_APP_PASSWORD.value() || '').replace(/\s+/g, '');
    if (user && pass && !mailer) {
      const nodemailer = require('nodemailer');
      mailer = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });
    }
    const brand = await db.collection('settings').doc('exports').get();
    const out = await sendRecordEmail(db, (mail) => mailer.sendMail(mail), request.auth && request.auth.uid, request.data, {
      from: user, ready: !!(user && pass), fromName: (brand.exists && brand.get('companyName')) || '', tz: process.env.FORMWRIGHT_TZ || 'America/Toronto',
    });
    const rec = (await db.collection('records').doc(request.data.recordId).get()).data() || {};
    const form = await formInfo(rec.formId);
    await logAudit(request.auth.uid, { area: 'record', kind: 'emailed', recordId: request.data.recordId, formId: rec.formId, formName: form.name || '', title: audit.titleOf(rec, form),
      note: `To ${out.to.join(', ')}${out.cc.length ? '; Cc ' + out.cc.join(', ') : ''} · “${String(request.data.subject || '').slice(0, 200)}”` });
    return out;
  } catch (e) {
    if (CALLABLE_CODES.includes(e.code)) throw new HttpsError(e.code, e.message);
    logger.error('emailRecord failed', e);
    throw new HttpsError('internal', 'The email didn’t go. Try again.');
  }
});

/* ---------- Formwright → Audit trail ---------- */
// audit/{id}: written only here; administrators read it in Formwright. Kept forever.
const names = new Map(); // uid → display name, for this instance
async function personName(uid) {
  if (!uid || uid === 'system' || uid === 'unknown') return uid === 'system' ? 'System' : 'Someone';
  if (names.has(uid)) return names.get(uid);
  let n = '';
  try {
    const p = await db.collection('profiles').doc(uid).get();
    n = (p.exists && p.get('displayName')) || '';
    if (!n) { const u = await db.collection('users').doc(uid).get(); n = (u.exists && (u.get('displayName') || String(u.get('email') || '').split('@')[0])) || ''; }
  } catch (e) { /* a missing name isn't worth failing over */ }
  names.set(uid, n || 'Someone');
  return n || 'Someone';
}
async function formInfo(formId) {
  if (!formId) return {};
  const f = await db.collection('forms').doc(formId).get();
  return f.exists ? f.data() : {};
}
async function logAudit(uid, entry) {
  try {
    await db.collection('audit').add({ at: Date.now(), by: uid || 'unknown', byName: await personName(uid), ...entry });
  } catch (e) { logger.error('audit write failed', e); }
}
// writes the server makes itself (numbers, removals, restores) log their own, clearer entry
const bySystem = (event) => event.authType === 'service_account' || event.authType === 'system' || /gserviceaccount\.com$/.test(String(event.authId || ''));
const uidOf = (event) => { const id = String(event.authId || ''); return id && !id.includes('@') ? id : ''; };
const docs = (event) => [event.data.before.exists ? event.data.before.data() : null, event.data.after.exists ? event.data.after.data() : null];
const who = async (uid) => ({ by: uid || 'unknown', byName: await personName(uid) });

exports.auditRecord = onDocumentWrittenWithAuthContext('records/{recordId}', async (event) => {
  if (bySystem(event)) return;
  const [before, after] = docs(event);
  if (!before && !after) return;
  const uid = (after && after.updatedBy) || uidOf(event);
  const entry = audit.recordEntry(event.params.recordId, before, after, await formInfo((after || before).formId), await who(uid), Date.now());
  if (entry) await db.collection('audit').add(entry);
});
exports.auditForm = onDocumentWrittenWithAuthContext('forms/{formId}', async (event) => {
  if (bySystem(event)) return;
  const [before, after] = docs(event);
  const entry = audit.formEntry(event.params.formId, before, after, await who(uidOf(event)), Date.now());
  if (entry) await db.collection('audit').add(entry);
});
exports.auditGroup = onDocumentWrittenWithAuthContext('groups/{groupId}', async (event) => {
  if (bySystem(event)) return;
  const [before, after] = docs(event);
  const forms = await db.collection('forms').get();
  const entry = audit.groupEntry(event.params.groupId, before, after, await who(uidOf(event)), Date.now(), new Map(forms.docs.map((d) => [d.id, d.get('name')])));
  if (entry) await db.collection('audit').add(entry);
});
exports.auditUser = onDocumentWrittenWithAuthContext('users/{userId}', async (event) => {
  if (bySystem(event)) return;
  const [before, after] = docs(event);
  if (before && after && (before.role || 'member') === (after.role || 'member') && !!before.cadence === !!after.cadence
    && JSON.stringify([...(before.groups || [])].sort()) === JSON.stringify([...(after.groups || [])].sort())) return; // only access worked out again
  const groups = await db.collection('groups').get();
  const entry = audit.userEntry(event.params.userId, before, after, await who(uidOf(event)), Date.now(),
    new Map(groups.docs.map((d) => [d.id, d.get('name')])), new Map([[event.params.userId, await personName(event.params.userId)]]));
  if (entry) await db.collection('audit').add(entry);
});
exports.auditSettings = onDocumentWrittenWithAuthContext('settings/{settingsId}', async (event) => {
  if (bySystem(event)) return;
  const [before, after] = docs(event);
  const entry = audit.settingsEntry(event.params.settingsId, before, after, await who((after && after.updatedBy) || uidOf(event)), Date.now());
  if (entry) await db.collection('audit').add(entry);
});
exports.restoreRecord = callable('restoreRecord', async (d, uid, data) => {
  const out = await audit.restoreRecord(d, uid, data);
  const rec = (await db.collection('records').doc(out.recordId).get()).data() || {};
  const form = await formInfo(out.formId);
  await logAudit(uid, { area: 'record', kind: 'restored', recordId: out.recordId, formId: out.formId, formName: form.name || '', title: audit.titleOf(rec, form),
    note: [out.parentGone ? 'its parent is gone, so it was restored on its own' : '', out.trimmed ? 'signatures and long text weren’t kept for this one' : ''].filter(Boolean).join('; ') });
  return out;
});
