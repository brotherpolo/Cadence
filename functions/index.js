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
 *   emailRecord   Formwright → Email PDF: an administrator emails a record's PDF (email.js);
 *                 a copy of the PDF is kept in Storage at sentEmails/{recordId}/{emailId}.pdf
 *   deleteSentEmails  Formwright → Sent emails → Delete / Delete all (administrators)
 *   automation*   Formwright → Administration → Automations: run on every record change
 *                 (automationOnWrite), at 7:00 each morning for dates (automationDaily), after
 *                 Email PDF, and as a dry run from the editor (automationTest) (automate.js)
 *   audit*        Formwright → Audit trail: records, forms, groups, accounts and settings as
 *                 they change; restoreRecord brings a deleted record back (audit.js)
 *   commentWritten Formwright record comments: tells the people @mentioned (My work → Mentions,
 *                 an email, and a Cadence task when asked) if they can open the record; tidies
 *                 up and notes it in the audit trail when a comment is removed (comments.js).
 *                 Set FORMWRIGHT_URL in functions/.env to put a link to the record in the email.
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
const { sendRecordEmail, deleteSentEmails, emailLine } = require('./email');
const audit = require('./audit');
const cm = require('./comments');
const automate = require('./automate');
const fw = require('./fwkit.cjs');
const { FieldValue } = require('firebase-admin/firestore');
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
      const passer = before && after.reassignedAt && after.reassignedAt !== before.reassignedAt && after.reassignedBy && after.reassignedBy !== after.ownerId ? await personName(after.reassignedBy) : '';
      jobs.push(sendTo(after.assigneeId, 'assigned', {
        title: passer ? passer + ' passed you a task' : nameOf(after.ownerName, after.ownerEmail) + ' assigned you a task',
        body: title + (after.due ? ' · due ' + when(after.due, tz) + (after.time ? ' at ' + clock(after.time) : '') : ''),
        tag: 'assigned-' + event.params.taskId, task: event.params.taskId
      }, prefs));
    }
  }
  // a record task given to someone else: noted on the record in the audit trail
  if (before && after.recordId && ((before.assigneeId || null) !== (after.assigneeId || null) || (before.assigneeRole || null) !== (after.assigneeRole || null))) {
    try {
      const entry = audit.taskReassignEntry(event.params.taskId, before, after, await who(audit.reassignedBy(before, after)), Date.now());
      if (entry) jobs.push(db.collection('audit').add(entry));
    } catch (e) { logger.error('task reassign audit failed', e); }
  }
  // given to a role (Formwright → Roles): everyone holding it hears about it
  if (after.assigneeRole && (before ? before.assigneeRole !== after.assigneeRole : !after.spawnedFrom)) {
    try {
      const giver = before && after.reassignedAt && after.reassignedAt !== before.reassignedAt && after.reassignedBy ? after.reassignedBy : after.ownerId;
      const giverName = giver === after.ownerId ? nameOf(after.ownerName, after.ownerEmail) : nameOf(await personName(giver));
      const holders = (await db.collection('users').where('roles', 'array-contains', after.assigneeRole).get()).docs.map((d) => d.id).filter((u) => u !== giver).slice(0, 50);
      for (const uid of holders) {
        const prefs = await prefsFor(uid);
        if (!prefs) continue;
        const tz = safeTz(prefs.tz || 'UTC');
        jobs.push(sendTo(uid, 'assigned', {
          title: giverName + ' gave ' + (after.assigneeRoleName || 'your role') + ' a task',
          body: title + (after.due ? ' · due ' + when(after.due, tz) + (after.time ? ' at ' + clock(after.time) : '') : ''),
          tag: 'assigned-' + event.params.taskId, task: event.params.taskId
        }, prefs));
      }
    } catch (e) { logger.error('role task notice failed', e); }
  }
  // a record task ticked off: noted on the record, crediting the role ("Accounts (Farren)")
  if (before && !before.done && after.done && after.recordId && after.doneBy) {
    try {
      const w = await who(after.doneBy);
      if (after.assigneeRole && after.doneBy !== after.ownerId) {
        const u = await db.collection('users').doc(after.doneBy).get();
        if (u.exists && (u.get('roles') || []).includes(after.assigneeRole)) w.byName = `${after.assigneeRoleName || 'Role'} (${w.byName})`;
      }
      const entry = audit.taskDoneEntry(event.params.taskId, before, after, w, Date.now());
      if (entry) jobs.push(db.collection('audit').add(entry));
    } catch (e) { logger.error('task done audit failed', e); }
  }
  // finished by someone in the role it was given to
  if (before && !before.done && after.done && after.assigneeRole && after.doneBy && after.doneBy !== after.ownerId) {
    jobs.push(sendTo(after.ownerId, 'finished', {
      title: (after.doneByName || after.assigneeRoleName || 'Someone') + ' finished a task',
      body: title, tag: 'finished-' + event.params.taskId, task: event.params.taskId
    }));
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
  // tasks given to a role this person holds (Formwright → Roles): theirs to do as well
  let roleTasks = null;
  const byRole = async () => {
    if (roleTasks) return roleTasks;
    const roles = ((await db.collection('users').doc(uid).get()).get('roles') || []).filter((r) => typeof r === 'string').slice(0, 10);
    roleTasks = roles.length ? (await db.collection('tasks').where('assigneeRole', 'in', roles).get()).docs.map((d) => Object.assign({ id: d.id }, d.data())).filter((t) => !t.done && !t.sample && t.due) : [];
    return roleTasks;
  };
  const plus = (list, extra) => { const ids = new Set(list.map((t) => t.id)); return list.concat(extra.filter((t) => !ids.has(t.id))); };
  const inWindow = (at) => at > since && at <= now;
  const morningAt = zoned(today, prefs.morning || '08:00', tz);
  const sends = [];

  if (prefs.due) {
    // timed tasks around today (a lead time can reach into tomorrow's early hours)
    const days = [addDays(today, -1), today, addDays(today, 1)];
    const near = plus(mine(await db.collection('tasks').where('members', 'array-contains', uid).where('due', 'in', days).get()), (await byRole()).filter((t) => days.includes(t.due)));
    near.filter((t) => t.time).forEach((t) => {
      const at = zoned(t.due, t.time, tz) - (+prefs.lead || 0) * 60e3;
      if (inWindow(at)) sends.push(sendTo(uid, 'due', { title: t.title || 'Task due', body: (prefs.lead ? 'Due at ' : 'Due now · ') + clock(t.time), tag: 'due-' + t.id, task: t.id }, prefs));
    });
    if (inWindow(morningAt)) {
      const untimed = near.filter((t) => t.due === today && !t.time);
      let overdue = [];
      if (prefs.digest) overdue = plus(mine(await db.collection('tasks').where('members', 'array-contains', uid).where('due', '<', today).get()), (await byRole()).filter((t) => t.due < today));
      if (untimed.length || overdue.length) sends.push(morning(uid, prefs, untimed, overdue));
    }
  } else if (prefs.digest && inWindow(morningAt)) {
    const overdue = plus(mine(await db.collection('tasks').where('members', 'array-contains', uid).where('due', '<', today).get()), (await byRole()).filter((t) => t.due < today));
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
function gmail() {
  const user = String(process.env.GMAIL_USER || '').trim();
  const pass = String(GMAIL_APP_PASSWORD.value() || '').replace(/\s+/g, '');
  if (user && pass && !mailer) {
    const nodemailer = require('nodemailer');
    mailer = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });
  }
  return { user, pass, ready: !!(user && pass) };
}
/** Keep a sent email's PDF in Storage (sentEmails/{recordId}/{emailId}.pdf), as sent. */
const keepPdf = (path, pdf) => admin.storage().bucket().file(path).save(pdf, {
  resumable: false, contentType: 'application/pdf',
  metadata: { cacheControl: 'private, max-age=0' }, // the app names the download from the email's fileName
});
exports.emailRecord = onCall({ region: 'us-central1', timeoutSeconds: 120, memory: '512MiB', secrets: [GMAIL_APP_PASSWORD] }, async (request) => {
  try {
    const { user, pass } = gmail();
    const brand = await db.collection('settings').doc('exports').get();
    const out = await sendRecordEmail(db, (mail) => mailer.sendMail(mail), request.auth && request.auth.uid, request.data, {
      from: user, ready: !!(user && pass), fromName: (brand.exists && brand.get('companyName')) || '', tz: process.env.FORMWRIGHT_TZ || 'America/Toronto',
      save: keepPdf,
      onSaveError: (e) => logger.error('emailRecord: the PDF copy was not kept', e),
    });
    const rec = (await db.collection('records').doc(request.data.recordId).get()).data() || {};
    const form = await formInfo(rec.formId);
    await logAudit(request.auth.uid, { area: 'record', kind: 'emailed', recordId: request.data.recordId, formId: rec.formId, formName: form.name || '', title: audit.titleOf(rec, form),
      note: `To ${out.to.join(', ')}${out.cc.length ? '; Cc ' + out.cc.join(', ') : ''} · “${String(request.data.subject || '').slice(0, 200)}”${request.data.attach === false ? ' (no PDF)' : ''}` });
    try { await runAutomations('emailed', { recordId: request.data.recordId, actor: request.auth.uid }); } catch (e) { logger.error('automations after email failed', e); }
    return out;
  } catch (e) {
    if (CALLABLE_CODES.includes(e.code)) throw new HttpsError(e.code, e.message);
    logger.error('emailRecord failed', e);
    throw new HttpsError('internal', 'The email didn’t go. Try again.');
  }
});

const sentWhen = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.FORMWRIGHT_TZ || 'America/Toronto', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
// Sent emails → Delete (one) or Delete all: the log entries and their kept PDFs. Noted in the audit trail.
exports.deleteSentEmails = onCall({ region: 'us-central1' }, async (request) => {
  try {
    const uid = request.auth && request.auth.uid;
    const out = await deleteSentEmails(db, (path) => admin.storage().bucket().file(path).delete({ ignoreNotFound: true }), uid, request.data || {});
    const rec = (await db.collection('records').doc(request.data.recordId).get()).data() || {};
    const form = await formInfo(rec.formId);
    const n = out.deleted.length;
    await logAudit(uid, { area: 'record', kind: 'emaildeleted', recordId: request.data.recordId, formId: rec.formId || null, formName: form.name || '', title: rec.formId ? audit.titleOf(rec, form) : '',
      changes: out.deleted.slice(0, 100).map((e) => ({ key: 'email:' + e.id, label: 'Sent email', type: 'text', from: emailLine(e) + (e.at ? ' · ' + sentWhen(e.at) : '') + (e.byName ? ' by ' + e.byName : ''), to: null })),
      note: request.data.all === true ? `Deleted all ${n} sent email${n === 1 ? '' : 's'}` : `Deleted ${n === 1 ? 'a sent email' : n + ' sent emails'}` });
    return { deleted: n };
  } catch (e) {
    if (CALLABLE_CODES.includes(e.code)) throw new HttpsError(e.code, e.message);
    logger.error('deleteSentEmails failed', e);
    throw new HttpsError('internal', 'The emails weren’t deleted. Try again.');
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
  const w = await who(uid);
  if (before && after && before.assigneeRole && (before.stage || null) !== (after.stage || null) && uid) { // moved on for a role: "Accounts (Farren)"
    try {
      const [u, r] = await Promise.all([db.collection('users').doc(uid).get(), db.collection('roles').doc(before.assigneeRole).get()]);
      w.byName = audit.creditName(before, after, w.byName, (u.exists && u.get('roles')) || [], r.exists ? r.get('name') : '');
    } catch (e) { /* the plain name will do */ }
  }
  const entry = audit.recordEntry(event.params.recordId, before, after, await formInfo((after || before).formId), w, Date.now());
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
// Roles renamed in Formwright: tasks given to the role show the new name
exports.roleRenamed = onDocumentWritten('roles/{roleId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  if (!before || !after || (before.name || '') === (after.name || '')) return;
  const snap = await db.collection('tasks').where('assigneeRole', '==', event.params.roleId).get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const b = db.batch();
    snap.docs.slice(i, i + 400).forEach((d) => b.update(d.ref, { assigneeRoleName: String(after.name || '').slice(0, 80) }));
    await b.commit();
  }
});
exports.auditUser = onDocumentWrittenWithAuthContext('users/{userId}', async (event) => {
  if (bySystem(event)) return;
  const [before, after] = docs(event);
  if (before && after && (before.role || 'member') === (after.role || 'member') && !!before.cadence === !!after.cadence
    && JSON.stringify([...(before.groups || [])].sort()) === JSON.stringify([...(after.groups || [])].sort())
    && JSON.stringify([...(before.roles || [])].sort()) === JSON.stringify([...(after.roles || [])].sort())) return; // only access worked out again
  const [groups, roles] = await Promise.all([db.collection('groups').get(), db.collection('roles').get()]);
  const entry = audit.userEntry(event.params.userId, before, after, await who(uidOf(event)), Date.now(),
    new Map(groups.docs.map((d) => [d.id, d.get('name')])), new Map([[event.params.userId, await personName(event.params.userId)]]), new Map(roles.docs.map((d) => [d.id, d.get('name')])));
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


/* ---------- Formwright → Automations ---------- */
const TZ = process.env.FORMWRIGHT_TZ || 'America/Toronto';
const cache = { autos: new Map(), forms: { at: 0, list: [] }, people: { at: 0, map: new Map() } };
const FRESH = 60e3;
async function automationsFor(formId) {
  const c = cache.autos.get(formId);
  if (c && Date.now() - c.at < FRESH) return c.list;
  const s = await db.collection('automations').where('formId', '==', formId).get();
  const list = s.docs.map((d) => ({ ...d.data(), id: d.id })).filter((a) => a.on);
  cache.autos.set(formId, { at: Date.now(), list });
  return list;
}
async function allForms() {
  if (Date.now() - cache.forms.at < FRESH) return cache.forms.list;
  const s = await db.collection('forms').get();
  cache.forms = { at: Date.now(), list: s.docs.map((d) => ({ ...d.data(), id: d.id })) };
  return cache.forms.list;
}
async function allPeople() {
  if (Date.now() - cache.people.at < FRESH) return cache.people.map;
  const [u, p] = await Promise.all([db.collection('users').get(), db.collection('profiles').get()]);
  const map = new Map();
  u.docs.forEach((d) => map.set(d.id, { email: String(d.get('email') || '').toLowerCase(), name: d.get('displayName') || '', roles: Array.isArray(d.get('roles')) ? d.get('roles') : [] }));
  p.docs.forEach((d) => { const x = map.get(d.id) || { email: '', name: '' }; if (d.get('displayName')) x.name = d.get('displayName'); if (!x.email && d.get('email')) x.email = String(d.get('email')).toLowerCase(); map.set(d.id, x); });
  cache.people = { at: Date.now(), map };
  return map;
}
const recData = (d) => (d.exists ? { ...d.data(), id: d.id } : null);
/** A record with what's needed to read it like the app: its parent, children and linked records. */
async function recordContext(recordId) {
  const rec = recData(await db.collection('records').doc(recordId).get());
  if (!rec) return null;
  const forms = await allForms();
  const parent = rec.parentId ? recData(await db.collection('records').doc(rec.parentId).get()) : null;
  const kids = (await db.collection('records').where('parentId', '==', rec.id).get()).docs.map(recData);
  const pk = parent ? (await db.collection('records').where('parentId', '==', parent.id).get()).docs.map(recData) : [];
  const have = new Map([rec, parent, ...kids, ...pk].filter(Boolean).map((r) => [r.id, r]));
  const fmap = new Map(forms.map((f) => [f.id, f]));
  const links = new Set();
  have.forEach((r) => (fmap.get(r.formId)?.fields || []).forEach((f) => { if (f.type === 'relation' && r.values?.[f.id] && !have.has(r.values[f.id])) links.add(r.values[f.id]); }));
  const linked = links.size ? (await db.getAll(...[...links].slice(0, 200).map((id) => db.collection('records').doc(id)))).map(recData).filter(Boolean) : [];
  linked.forEach((r) => have.set(r.id, r));
  const k = fw.makeKit({ forms, records: [...have.values()], timeZone: TZ });
  const form = fmap.get(rec.formId), pform = parent ? fmap.get(parent.formId) : null;
  return { k, forms, form, rec, parent, pform };
}
/** The record's PDF, made here (the same layout as Export PDF, with the form's default columns). */
async function serverPdf(c, people) {
  const L = require('./vendor/pdf-lib.min.js');
  const brand = (await db.collection('settings').doc('exports').get()).data() || {};
  const model = c.k.pdfModel(c.form, c.rec, { stamp: 'Sent ' + new Date().toLocaleString('en-CA', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ }), userName: (id) => people.get(id)?.name || '' });
  const imgs = new Map();
  const kind = (b) => (b[0] === 0x89 && b[1] === 0x50 ? 'png' : b[0] === 0xff && b[1] === 0xd8 ? 'jpg' : null);
  const dataUrl = (u) => { const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(String(u || '')); return m ? Buffer.from(m[2], 'base64') : null; };
  const logo = dataUrl(brand.logo);
  if (logo && kind(logo)) imgs.set('logo', { bytes: logo, type: kind(logo) });
  model.brand = { name: brand.companyName || '', logoKey: imgs.has('logo') ? 'logo' : '' };
  let missing = 0;
  await Promise.all(model.items.map(async (it, i) => {
    if ((it.kind !== 'image' && it.kind !== 'signature') || !it.src) return;
    try {
      const b = typeof it.src === 'string' ? dataUrl(it.src) : it.src.path ? (await admin.storage().bucket().file(it.src.path).download())[0] : null;
      if (!b || !kind(b) || b.length > 12e6) throw new Error('not a JPEG or PNG');
      imgs.set('i' + i, { bytes: b, type: kind(b) }); it.imgKey = 'i' + i;
    } catch (e) { missing++; }
  }));
  const bytes = Buffer.from(await fw.drawPdf(L, model, imgs));
  return { bytes, name: fw.fileName(model.formName, model.title), missing, company: brand.companyName || '' };
}

/** Carry out one automation on one record, log the run, and note changes in the audit trail. */
async function runOne(a, c, { kind, actor, depth, test = false }) {
  const people = await allPeople();
  const brand = (await db.collection('settings').doc('exports').get()).data() || {};
  const now = Date.now();
  const steps = automate.plan(a, { k: c.k, form: c.form, rec: c.rec, parent: c.parent, pform: c.pform, people, owner: a.createdBy, actor, now, tz: TZ, company: brand.companyName || '', formById: (id) => c.forms.find((f) => f.id === id) });
  if (test) return steps;
  const by = 'auto:' + a.id, byName = 'Automation: ' + (a.name || 'Untitled');
  const stamp = { depth: depth + 1, id: a.id, at: now, actor: actor || null };
  const did = [], errors = [];
  const title = c.k.recTitle(c.rec, c.form);
  for (const st of steps) {
    try {
      if (st.kind === 'skip') { did.push(st.text); continue; }
      if (st.kind === 'set') {
        const up = { updatedAt: now, updatedBy: by, auto: stamp };
        Object.entries(st.set).forEach(([fid, v]) => { up['values.' + fid] = v; });
        st.clear.forEach((fid) => { up['values.' + fid] = FieldValue.delete(); });
        await db.collection('records').doc(st.recordId).update(up);
        const tf = c.forms.find((f) => f.id === st.formId), tr = st.target === 'parent' ? c.parent : c.rec;
        const changes = [...Object.keys(st.set), ...st.clear].map((fid) => { const f = (tf.fields || []).find((x) => x.id === fid); return { key: fid, label: f?.label || fid, type: f?.type || 'text', from: audit.auditValue(tr.values?.[fid], f?.type), to: st.clear.includes(fid) ? null : audit.auditValue(st.set[fid], f?.type) }; });
        await db.collection('audit').add({ at: now, by, byName, area: 'record', kind: 'changed', recordId: st.recordId, formId: st.formId, formName: tf.name || '', title: c.k.recTitle(tr, tf), changes, note: `${byName}${kind === 'date' ? ' (date)' : ''}` });
      } else if (st.kind === 'task') {
        const owner = a.createdBy, op = people.get(owner) || {}, ap = st.assignee && st.assignee !== owner ? people.get(st.assignee) || {} : null;
        const ref = db.collection('tasks').doc();
        const t = {
          id: ref.id, title: st.title, notes: st.notes || '', due: st.due || null, time: null, done: false, doneAt: null, createdAt: now, updatedAt: now,
          subtasks: [], repeat: 'none', ownerId: owner, ownerName: op.name || null, ownerEmail: op.email || null,
          assigneeId: ap ? st.assignee : null, assigneeName: ap ? ap.name || null : null, assigneeEmail: ap ? ap.email || null : null,
          members: ap ? [owner, st.assignee] : [owner],
          recordId: c.rec.id, formId: c.form.id, recordSnap: { title, form: c.form.name || '', color: fw.COLORS[(c.form.color ?? 0) % fw.COLORS.length] },
        };
        await ref.set(t);
      } else if (st.kind === 'email') {
        const g = gmail();
        if (!g.ready) throw new Error('Email isn’t set up (Gmail app password)');
        let att = [], pdfName = null, bytes = 0, note = '', pdfBytes = null;
        if (st.pdf) {
          const p = await serverPdf(c, people);
          if (p.bytes.length > 8 * 1024 * 1024) throw new Error('The PDF is over 8 MB');
          att = [{ filename: p.name, content: p.bytes, contentType: 'application/pdf' }]; pdfName = p.name; bytes = p.bytes.length; pdfBytes = p.bytes;
          if (p.missing) note = ` (${p.missing} picture${p.missing === 1 ? '' : 's'} left out)`;
        }
        const info = await mailer.sendMail({ from: { name: brand.companyName || g.user, address: g.user }, to: st.to, subject: st.subject, text: st.message, attachments: att });
        const logRef = db.collection('records').doc(c.rec.id).collection('emails').doc();
        let pdfPath = null; // kept like Email PDF's, so the Sent emails pop-up can open it
        if (pdfBytes) { const path = `sentEmails/${c.rec.id}/${logRef.id}.pdf`; try { await keepPdf(path, pdfBytes); pdfPath = path; } catch (e) { logger.error('automation email: the PDF copy was not kept', e); } }
        await logRef.set({ to: st.to, cc: [], copyMe: false, subject: st.subject, message: st.message || '', fileName: pdfName, bytes, pdfPath, by, byName, at: now, messageId: (info && info.messageId) || null });
        await db.collection('audit').add({ at: now, by, byName, area: 'record', kind: 'emailed', recordId: c.rec.id, formId: c.form.id, formName: c.form.name || '', title, note: `To ${st.to.join(', ')} · “${st.subject}”${st.pdf ? '' : ' (no PDF)'}` });
        st.text += note;
      } else if (st.kind === 'child') {
        const ref = db.collection('records').doc();
        await ref.set({ formId: st.formId, values: st.values, parentId: c.rec.id, parentFormId: c.form.id, ownerId: c.rec.ownerId, createdBy: by, createdAt: now, updatedAt: now, updatedBy: by, auto: stamp });
        const cf = c.forms.find((f) => f.id === st.formId) || {};
        await db.collection('audit').add({ at: now, by, byName, area: 'record', kind: 'created', recordId: ref.id, formId: st.formId, formName: cf.name || '', title: st.text.replace(/^Create [^“]*“|”.*$/g, ''), note: `${byName}, under ${title}` });
      }
      did.push(st.text);
    } catch (e) {
      logger.error('automation step failed', a.id, st.kind, e);
      errors.push(`${st.text}: ${e.message || 'failed'}`);
    }
  }
  await db.collection('automations').doc(a.id).collection('runs').add({ at: now, recordId: c.rec.id, title, kind, depth, ok: !errors.length, did, errors, actor: actor || null });
  return steps;
}

/** Run the automations of a record's form that match this event. */
async function runAutomations(kind, { recordId, before = null, after = null, actor = null, depth = 0, only = null }) {
  const formId = (after || (await db.collection('records').doc(recordId).get()).data() || {}).formId;
  if (!formId) return;
  const list = (only ? [only] : await automationsFor(formId)).filter((a) => a.formId === formId);
  if (!list.length) return;
  let c = null;
  for (const a of list) {
    if (kind === 'changed' || kind === 'created') {
      if (automate.madeBy(before, after) === a.id) continue; // its own change
      if (!c) { const forms = await allForms(); c = { formOnly: forms.find((f) => f.id === formId) }; }
      if (!automate.triggerMatches(a, { kind, before, after, form: c.formOnly || {} })) continue;
    } else if ((a.trigger || {}).type !== kind) continue;
    if (depth >= automate.MAX_DEPTH) {
      await db.collection('automations').doc(a.id).collection('runs').add({ at: Date.now(), recordId, title: '', kind, depth, ok: false, did: [], errors: [`Stopped: automations had already changed this record ${depth} times in a row`] });
      continue;
    }
    if (!c || !c.k) c = await recordContext(recordId);
    if (!c) return;
    if (!automate.condsHold(a, c.k.look(c.form, c.rec))) continue;
    await runOne(a, c, { kind, actor, depth });
    c = null; // the record may have changed: read it again for the next automation
  }
}

/** Workflows: a new record (from the app, an import, an automation, Duplicate…) starts at the first stage. */
async function autoStart(recordId, after) {
  const form = (await allForms()).find((f) => f.id === after.formId);
  if (!fw.wfOn(form)) return false;
  const st = fw.firstStage(form);
  const ref = db.collection('records').doc(recordId);
  const now = Date.now();
  return db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    if (!cur.exists || cur.get('stage')) return false; // gone, or started already
    const rec = cur.data();
    const next = fw.assigneeFor(st, rec, rec.createdBy || null);
    tx.update(ref, { stage: st.id, assignee: next.assignee || null, assigneeGroup: next.assigneeGroup || null, assigneeRole: next.assigneeRole || null, stageAt: now });
    tx.set(ref.collection('stages').doc(), { at: now, by: rec.createdBy || null, from: null, fromName: null, to: st.id, toName: st.name || '', label: 'Started', comment: '', assignee: next.assignee || null, assigneeGroup: next.assigneeGroup || null, assigneeRole: next.assigneeRole || null });
    return true;
  });
}

/** Workflows: a record reached a stage. Close the last stage's tasks and tell its person responsible. */
async function stageNotify(recordId, before, after) {
  const form = (await allForms()).find((f) => f.id === after.formId);
  const arr = automate.stageArrival(form, before, after);
  if (!arr) return;
  const people = await allPeople();
  const now = Date.now();
  // the previous stage's workflow tasks for this record are done
  const open = await db.collection('tasks').where('recordId', '==', recordId).get();
  for (const d of open.docs) {
    const t = d.data();
    if (!t.done && String(t.notes || '').startsWith('Workflow:')) await d.ref.update({ done: true, doneAt: now, updatedAt: now });
  }
  const st = arr.stage, notify = st.notify || {};
  if (!notify.task && !notify.email) return;
  const mover = String(after.updatedBy || '').startsWith('auto:') ? null : after.updatedBy || null;
  let who = arr.assignee ? [arr.assignee] : [];
  if (!who.length && arr.assigneeGroup) who = [...(await db.collection('users').where('groups', 'array-contains', arr.assigneeGroup).get()).docs.map((d) => d.id)].slice(0, 10);
  if (!who.length && arr.assigneeRole) who = [...(await db.collection('users').where('roles', 'array-contains', arr.assigneeRole).get()).docs.map((d) => d.id)].slice(0, 10);
  if (!who.length) return;
  let roleName = '';
  if (!arr.assignee && !arr.assigneeGroup && arr.assigneeRole) { try { roleName = (await db.collection('roles').doc(arr.assigneeRole).get()).get('name') || ''; } catch (e) { /* plain wording */ } }
  const k = fw.makeKit({ forms: await allForms(), records: [{ ...after, id: recordId }] });
  const title = k.recTitle({ ...after, id: recordId }, form);
  const owner = mover || who[0];
  const op = people.get(owner) || {};
  const due = fw.stageDue(st, fw.dayKey(after.stageAt || now, process.env.FORMWRIGHT_TZ || 'America/Toronto')) || null; // working days, Monday to Friday
  for (const uid of who) {
    const ap = uid !== owner ? people.get(uid) || {} : null;
    if (notify.task) {
      const ref = db.collection('tasks').doc();
      await ref.set({
        id: ref.id, title: `${st.name}: ${title}`.slice(0, 500), notes: `Workflow: ${roleName ? `your role ${roleName} is` : 'you’re the person'} responsible for this ${fw.itemName(form).toLowerCase()} at ${st.name}.${due ? ` Due ${due}.` : ''}`, due, time: null, done: false, doneAt: null, createdAt: now, updatedAt: now,
        subtasks: [], repeat: 'none', ownerId: owner, ownerName: op.name || null, ownerEmail: op.email || null,
        assigneeId: ap ? uid : null, assigneeName: ap ? ap.name || null : null, assigneeEmail: ap ? ap.email || null : null, members: ap ? [owner, uid] : [owner],
        recordId, formId: form.id, recordSnap: { title, form: form.name || '', color: fw.COLORS[(form.color ?? 0) % fw.COLORS.length] },
      });
    }
    if (notify.email && people.get(uid)?.email) {
      const g = gmail();
      if (!g.ready) continue;
      const brand = (await db.collection('settings').doc('exports').get()).data() || {};
      try {
        await mailer.sendMail({ from: { name: brand.companyName || g.user, address: g.user }, to: people.get(uid).email, subject: `${fw.itemName(form)} ${title}: you’re the person responsible (${st.name})`, text: `${people.get(mover)?.name || 'Someone'} moved ${fw.itemName(form).toLowerCase()} “${title}” to ${st.name}. You’re the person responsible for it now.${due ? `\n\nIt’s due ${due}.` : ''}\n\nOpen Formwright and look in My work.` });
      } catch (e) { logger.error('workflow email failed', e); }
    }
  }
}

exports.automationOnWrite = onDocumentWrittenWithAuthContext({ document: 'records/{recordId}', secrets: [GMAIL_APP_PASSWORD], memory: '512MiB', timeoutSeconds: 120 }, async (event) => {
  const [before, after] = docs(event);
  if (!after) return;
  if (!before && !after.stage) { try { await autoStart(event.params.recordId, after); } catch (e) { logger.error('workflow start failed', e); } } // its own write comes back here as the arrival
  try { await stageNotify(event.params.recordId, before, after); } catch (e) { logger.error('workflow notice failed', e); }
  const depth = automate.depthOf(before, after);
  const actor = depth ? (after.auto && after.auto.actor) || null : (String(after.updatedBy || '').startsWith('auto:') ? null : after.updatedBy || uidOf(event) || null);
  await runAutomations(before ? 'changed' : 'created', { recordId: event.params.recordId, before, after, actor, depth });
});

/* ---------- Formwright → Comments and @mentions ---------- */
// Someone mentioned in a comment gets a My work → Mentions entry, an email from the company
// Gmail, and (when the commenter ticked it) a Cadence task. Only people who can open the record
// are told; the comment's "notified" says what happened for each, so the app can show
// "Sam can't see this record and wasn't notified". Removing a comment removes its replies and
// mentions, and notes the removal in the audit trail.
exports.commentWritten = onDocumentWrittenWithAuthContext({ document: 'records/{recordId}/comments/{commentId}', secrets: [GMAIL_APP_PASSWORD], timeoutSeconds: 120 }, async (event) => {
  const { recordId, commentId } = event.params;
  const [before, after] = docs(event);
  if (!after) {
    if (!before) return;
    try { await commentRemoved(event, recordId, commentId, before); } catch (e) { logger.error('comment removal tidy-up failed', e); }
    return;
  }
  if (!cm.toNotify(after).length) return;
  try { await commentNotify(recordId, commentId); } catch (e) { logger.error('comment mention failed', e); }
});

async function commentNotify(recordId, commentId) {
  const ref = db.collection('records').doc(recordId).collection('comments').doc(commentId);
  const rec = recData(await db.collection('records').doc(recordId).get());
  if (!rec) return;
  const now = Date.now();
  // claim the new mentions in one step, so an edit made at the same moment can't send twice
  const plan = await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    if (!cur.exists) return null;
    const c = cur.data();
    const todo = cm.toNotify(c);
    if (!todo.length) return null;
    const persons = todo.filter((m) => !cm.isRole(m.uid)), roleMs = todo.filter((m) => cm.isRole(m.uid));
    // roles mentioned (Formwright → Roles): everyone holding them
    const holders = new Map();
    for (const m of roleMs) {
      const q = await tx.get(db.collection('users').where('roles', 'array-contains', cm.roleIdOf(m.uid)).limit(50));
      holders.set(cm.roleIdOf(m.uid), q.docs.map((d) => ({ uid: d.id, user: d.data() })));
    }
    const users = persons.length ? await tx.getAll(...persons.map((m) => db.collection('users').doc(m.uid))) : [];
    const out = persons.map((m, i) => {
      const u = users[i].exists ? users[i].data() : null;
      return { ...m, user: u, state: !u ? 'gone' : cm.canSee(u, rec, m.uid) ? 'sent' : 'no-access' };
    }).concat(cm.roleRecipients(todo, holders, c).map((m) => ({ ...m, state: cm.canSee(m.user, rec, m.uid) ? 'sent' : 'no-access' })));
    const args = [];
    out.forEach((m) => args.push(new admin.firestore.FieldPath('notified', m.uid), m.state));
    roleMs.forEach((m) => args.push(new admin.firestore.FieldPath('notified', m.uid), (holders.get(cm.roleIdOf(m.uid)) || []).length ? 'sent' : 'nobody'));
    tx.update(ref, ...args);
    return { c, out, roles: roleMs };
  });
  if (!plan) return;
  const { c, out, roles } = plan;
  const forms = await allForms();
  const form = forms.find((f) => f.id === rec.formId) || {};
  const k = fw.makeKit({ forms, records: [rec] });
  const title = k.recTitle(rec, form);
  const item = fw.itemName(form);
  const people = await allPeople();
  const owner = { uid: c.by, name: c.byName || people.get(c.by)?.name || '', email: people.get(c.by)?.email || '' };
  const link = cm.recordLink(process.env.FORMWRIGHT_URL, recordId);
  const g = gmail();
  const brand = g.ready ? (await db.collection('settings').doc('exports').get()).data() || {} : {};
  // a role mentioned with "also give a task": one task for the role; the first to tick it off does it
  if (c.task && owner.uid) {
    for (const m of roles || []) {
      const r = await db.collection('roles').doc(cm.roleIdOf(m.uid)).get();
      if (!r.exists) continue;
      const tref = db.collection('tasks').doc();
      await tref.set(cm.mentionTask({ id: tref.id, owner, role: { id: r.id, name: r.get('name') || m.name }, comment: c, recordId, formId: rec.formId, recordTitle: title, formName: form.name || '', item, color: fw.COLORS[(form.color ?? 0) % fw.COLORS.length], now }));
    }
  }
  for (const m of out.filter((x) => x.state === 'sent')) {
    const p = people.get(m.uid) || {};
    await db.collection('mentions').add(cm.mentionDoc({ to: m.uid, comment: c, commentId, recordId, formId: rec.formId, recordTitle: title, formName: form.name || '', now, role: m.role }));
    if (c.task && !m.role && cm.usesCadence(m.user) && owner.uid) {
      const tref = db.collection('tasks').doc();
      await tref.set(cm.mentionTask({ id: tref.id, owner, assignee: { uid: m.uid, name: p.name || m.name, email: p.email || m.user.email || '' }, comment: c, recordId, formId: rec.formId, recordTitle: title, formName: form.name || '', item, color: fw.COLORS[(form.color ?? 0) % fw.COLORS.length], now }));
    }
    const to = p.email || String(m.user.email || '').toLowerCase();
    if (g.ready && to) {
      const mail = cm.mentionEmail({ byName: owner.name, item, title, text: c.text, link, reply: !!c.parent, role: m.role });
      try {
        await mailer.sendMail({ from: { name: brand.companyName || g.user, address: g.user }, replyTo: owner.email || undefined, to, subject: mail.subject, text: mail.text, html: mail.html });
      } catch (e) { logger.error('mention email failed', e); }
    }
  }
}

async function commentRemoved(event, recordId, commentId, before) {
  // its mentions go from everyone's My work
  const ms = await db.collection('mentions').where('commentId', '==', commentId).get();
  for (const d of ms.docs) if (d.get('recordId') === recordId) await d.ref.delete();
  // a comment's replies go with it
  let replies = 0;
  if (!before.parent) {
    const rs = await db.collection('records').doc(recordId).collection('comments').where('parent', '==', commentId).get();
    replies = rs.size;
    for (const d of rs.docs) await d.ref.delete();
  }
  if (bySystem(event)) return; // replies removed above, or the record being removed
  const uid = uidOf(event);
  const rec = recData(await db.collection('records').doc(recordId).get());
  if (!rec) return;
  const form = await formInfo(rec.formId);
  await db.collection('audit').add(cm.deletedEntry({ recordId, rec, form, title: audit.titleOf(rec, form), comment: before, commentId, who: await who(uid), replies, now: Date.now() }));
}

// every morning: automations on a date (on it, or days before or after)
exports.automationDaily = onSchedule({ schedule: '0 7 * * *', timeZone: TZ, secrets: [GMAIL_APP_PASSWORD], memory: '512MiB', timeoutSeconds: 540, retryCount: 0 }, async () => {
  const today = automate.dayKey(Date.now(), TZ);
  const s = await db.collection('automations').where('on', '==', true).get();
  for (const d of s.docs) {
    const a = { ...d.data(), id: d.id };
    if ((a.trigger || {}).type !== 'date') continue;
    const form = (await allForms()).find((f) => f.id === a.formId); if (!form) continue;
    const recs = (await db.collection('records').where('formId', '==', a.formId).get()).docs.map(recData);
    for (const r of recs) {
      if (!automate.dateDue(a, form, r, today)) continue;
      const mark = db.collection('automations').doc(a.id).collection('fired').doc(r.id);
      const m = await mark.get();
      if (m.exists && m.get('day') === today) continue;
      await mark.set({ day: today, at: Date.now() });
      try {
        const c = await recordContext(r.id);
        if (c && automate.condsHold(a, c.k.look(c.form, c.rec))) await runOne(a, c, { kind: 'date', actor: r.ownerId, depth: 0 });
      } catch (e) { logger.error('date automation failed', a.id, r.id, e); }
    }
  }
});

// the editor's "Test run": what it would do to one record, nothing written (admins)
exports.automationTest = callable('automationTest', async (d, uid, data) => {
  if (!uid) throw Object.assign(new Error('Sign in first.'), { code: 'unauthenticated' });
  const me = await d.collection('users').doc(uid).get();
  if (!me.exists || me.get('role') !== 'admin') throw Object.assign(new Error('Only administrators can test automations.'), { code: 'permission-denied' });
  const a = data && data.automation, recordId = data && data.recordId;
  if (!a || typeof recordId !== 'string') throw Object.assign(new Error('Say which automation and record.'), { code: 'invalid-argument' });
  const c = await recordContext(recordId);
  if (!c || c.rec.formId !== a.formId) throw Object.assign(new Error('That record isn’t on this automation’s form.'), { code: 'not-found' });
  const holds = automate.condsHold(a, c.k.look(c.form, c.rec));
  const due = (a.trigger || {}).type === 'date' ? automate.dateDue(a, c.form, c.rec, automate.dayKey(Date.now(), TZ)) : null;
  const steps = await runOne({ ...a, id: 'test', createdBy: uid }, c, { kind: 'test', actor: uid, depth: 0, test: true });
  return { title: c.k.recTitle(c.rec, c.form), holds, due, steps: steps.map((x) => ({ kind: x.kind, text: x.text })) };
});
