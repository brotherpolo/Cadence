/* Auto numbers for Formwright (the "Auto number" field type).
 *
 * A record's numbers live in records/{id}.nums = { fieldId: 'INV-2026-0042' }, which only these
 * functions write (firestore.rules refuse it from the apps). Each field keeps a counter in
 * counters/{formId}__{fieldId} = { next, years: { '2026': next } }, handed out one at a time in
 * a transaction, so two saves at once, offline saves syncing later and imports all get
 * different numbers. Numbers are never reused.
 *
 *   assignOnCreate(db, recordId)            a new record: number every auto-number field
 *   fillNumbers(db, callerUid, {formId, fieldId})
 *                                           admins: give existing records a number, keeping
 *                                           numbers already typed into the field (converting a
 *                                           text or number field), oldest first
 *   setNumber(db, callerUid, {recordId, fieldId, value})
 *                                           admins: change one number (must stay unique);
 *                                           noted in records/{id}.autoLog
 *
 * Field settings: prefix (text in front), start (first number), digits (at least this many,
 * zero-padded), year (put the year in, and start again at `start` each January).
 * db is firebase-admin's Firestore (or a fake in tests/unit). Errors are { code, message }. */
const TZ = process.env.FORMWRIGHT_TZ || 'America/Toronto';
const PAGE = 400;

function fail(code, message) { const e = new Error(message); e.code = code; throw e; }

/** The year a moment falls in, in the business's time zone. */
function yearOf(ms, tz = TZ) {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric' }).format(new Date(ms || Date.now())));
}

const clampInt = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
function settings(f) {
  return {
    prefix: String(f.prefix || '').slice(0, 20),
    start: clampInt(f.start, 0, 1e9, 1),
    digits: clampInt(f.digits, 1, 9, 1),
    year: !!f.year,
  };
}

/** 42 → 'INV-2026-0042' for prefix 'INV-', digits 4, year on. */
function formatNumber(f, n, year) {
  const s = settings(f);
  return s.prefix + (s.year ? year + '-' : '') + String(n).padStart(s.digits, '0');
}

/** The number at the end of a typed value ('INV-0057' → 57, 12 → 12), or null. */
function lastNumber(v) {
  const m = /(\d+)\D*$/.exec(String(v ?? ''));
  return m ? Number(m[1]) : null;
}

const counterId = (formId, fieldId) => `${formId}__${fieldId}`;
const autoFields = (form) => (form && Array.isArray(form.fields) ? form.fields.filter((f) => f && f.type === 'autonumber' && f.id) : []);
const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);

/** The next number for a field (and year) from a counter document's data. */
function nextFrom(counter, f, year) {
  const s = settings(f);
  const c = counter || {};
  const cur = s.year ? (c.years || {})[String(year)] : c.next;
  return Math.max(s.start, Number.isFinite(cur) ? cur : s.start);
}
function counterAfter(counter, f, year, next) {
  const c = { ...(counter || {}) };
  if (settings(f).year) c.years = { ...(c.years || {}), [String(year)]: next };
  else c.next = next;
  return c;
}

async function isAdminUid(db, uid) {
  if (!uid) return false;
  const s = await db.collection('users').doc(uid).get();
  return s.exists && s.get('role') === 'admin';
}

/** A new record: give each auto-number field its number (skips fields that already have one). */
async function assignOnCreate(db, recordId) {
  const recRef = db.collection('records').doc(recordId);
  const first = await recRef.get();
  if (!first.exists) return null;
  const formSnap = await db.collection('forms').doc(first.get('formId')).get();
  const fields = autoFields(formSnap.exists ? formSnap.data() : null);
  if (!fields.length) return null;
  return db.runTransaction(async (tx) => {
    const r = await tx.get(recRef);
    if (!r.exists) return null;
    const rec = r.data();
    const nums = rec.nums || {};
    const todo = fields.filter((f) => empty(nums[f.id]));
    if (!todo.length) return null;
    const year = yearOf(rec.createdAt);
    const refs = todo.map((f) => db.collection('counters').doc(counterId(rec.formId, f.id)));
    const snaps = [];
    for (const ref of refs) snaps.push(await tx.get(ref)); // every read before any write
    const patch = {};
    todo.forEach((f, i) => {
      const counter = snaps[i].exists ? snaps[i].data() : null;
      const n = nextFrom(counter, f, year);
      patch['nums.' + f.id] = formatNumber(f, n, year);
      tx.set(refs[i], counterAfter(counter, f, year, n + 1));
    });
    tx.update(recRef, patch);
    return patch;
  });
}

/** Admins: number a form's records that have no number yet, keeping any number already typed. */
async function fillNumbers(db, callerUid, data) {
  const formId = data && typeof data.formId === 'string' ? data.formId : '';
  const fieldId = data && typeof data.fieldId === 'string' ? data.fieldId : '';
  if (!callerUid) fail('unauthenticated', 'Sign in first.');
  if (!formId || !fieldId) fail('invalid-argument', 'Say which form and field.');
  if (!(await isAdminUid(db, callerUid))) fail('permission-denied', 'Only administrators can do this.');
  const formSnap = await db.collection('forms').doc(formId).get();
  const f = autoFields(formSnap.exists ? formSnap.data() : null).find((x) => x.id === fieldId);
  if (!f) fail('failed-precondition', 'Save the form with this field set to Auto number first.');

  const snap = await db.collection('records').where('formId', '==', formId).get();
  const recs = snap.docs.map((d) => ({ ref: d.ref, id: d.id, ...d.data() }));
  const kept = [], todo = [], high = {}; // high: bucket ('all' or year) → highest number in use
  const bucket = (r) => (settings(f).year ? String(yearOf(r.createdAt)) : 'all');
  recs.forEach((r) => {
    const have = (r.nums || {})[fieldId];
    if (!empty(have)) { const n = lastNumber(have); if (n != null) high[bucket(r)] = Math.max(high[bucket(r)] ?? -Infinity, n); return; }
    const typed = (r.values || {})[fieldId];
    if (!empty(typed)) {
      const text = String(typed).slice(0, 60);
      kept.push({ r, text });
      const n = lastNumber(text);
      if (n != null) high[bucket(r)] = Math.max(high[bucket(r)] ?? -Infinity, n);
    } else todo.push(r);
  });
  todo.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.id.localeCompare(b.id));

  // reserve a block of numbers per bucket, past the counter and past every number in use
  const ref = db.collection('counters').doc(counterId(formId, fieldId));
  const need = {};
  todo.forEach((r) => { need[bucket(r)] = (need[bucket(r)] || 0) + 1; });
  const startAt = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    let counter = s.exists ? s.data() : null;
    const out = {};
    const buckets = new Set([...Object.keys(need), ...Object.keys(high)]);
    buckets.forEach((b) => {
      const year = b === 'all' ? null : Number(b);
      const from = Math.max(nextFrom(counter, f, year), Number.isFinite(high[b]) ? high[b] + 1 : -Infinity);
      out[b] = from;
      counter = counterAfter(counter, f, year, from + (need[b] || 0));
    });
    if (buckets.size) tx.set(ref, counter);
    return out;
  });

  const writes = [];
  kept.forEach(({ r, text }) => writes.push([r.ref, { ['nums.' + fieldId]: text }]));
  const next = { ...startAt };
  const numbered = [];
  todo.forEach((r) => {
    const b = bucket(r);
    const text = formatNumber(f, next[b]++, b === 'all' ? yearOf(r.createdAt) : Number(b));
    numbered.push(text);
    writes.push([r.ref, { ['nums.' + fieldId]: text }]);
  });
  for (let i = 0; i < writes.length; i += PAGE) {
    const b = db.batch();
    writes.slice(i, i + PAGE).forEach(([rf, p]) => b.update(rf, p));
    await b.commit();
  }
  // numbers typed by hand that clash
  const seen = new Map();
  recs.forEach((r) => { const v = (r.nums || {})[fieldId]; if (!empty(v)) seen.set(String(v), (seen.get(String(v)) || 0) + 1); });
  kept.forEach(({ text }) => seen.set(text, (seen.get(text) || 0) + 1));
  const duplicates = [...seen].filter(([, n]) => n > 1).map(([v]) => v).slice(0, 20);
  return { kept: kept.length, numbered: numbered.length, first: numbered[0] || null, last: numbered[numbered.length - 1] || null, duplicates };
}

/** Admins: change one record's number. It must not be in use on another record of the form. */
async function setNumber(db, callerUid, data) {
  const recordId = data && typeof data.recordId === 'string' ? data.recordId : '';
  const fieldId = data && typeof data.fieldId === 'string' ? data.fieldId : '';
  const value = data && typeof data.value === 'string' ? data.value.trim() : '';
  if (!callerUid) fail('unauthenticated', 'Sign in first.');
  if (!recordId || !fieldId) fail('invalid-argument', 'Say which record and field.');
  if (!value || value.length > 60) fail('invalid-argument', 'Type a number of up to 60 characters.');
  if (!(await isAdminUid(db, callerUid))) fail('permission-denied', 'Only administrators can change a number.');
  const recRef = db.collection('records').doc(recordId);
  const recSnap = await recRef.get();
  if (!recSnap.exists) fail('not-found', 'That record no longer exists.');
  const rec = recSnap.data();
  const formSnap = await db.collection('forms').doc(rec.formId).get();
  const f = autoFields(formSnap.exists ? formSnap.data() : null).find((x) => x.id === fieldId);
  if (!f) fail('failed-precondition', 'That field isn’t an auto number.');
  const clash = await db.collection('records').where('nums.' + fieldId, '==', value).get();
  if (clash.docs.some((d) => d.id !== recordId && d.get('formId') === rec.formId)) fail('already-exists', `${value} is already used on another record.`);
  const year = yearOf(rec.createdAt);
  const ref = db.collection('counters').doc(counterId(rec.formId, fieldId));
  const n = lastNumber(value);
  return db.runTransaction(async (tx) => {
    const r = await tx.get(recRef);
    const c = await tx.get(ref);
    const cur = r.data();
    const from = (cur.nums || {})[fieldId] ?? null;
    const log = Array.isArray(cur.autoLog) ? cur.autoLog.slice(-49) : [];
    log.push({ fieldId, from, to: value, by: callerUid, at: Date.now() });
    tx.update(recRef, { ['nums.' + fieldId]: value, autoLog: log });
    // a number past the counter moves the counter on, so it's never handed out again
    const counter = c.exists ? c.data() : null;
    if (n != null && n >= nextFrom(counter, f, year)) tx.set(ref, counterAfter(counter, f, year, n + 1));
    return { from, to: value };
  });
}

module.exports = { assignOnCreate, fillNumbers, setNumber, formatNumber, lastNumber, yearOf, nextFrom, settings };
