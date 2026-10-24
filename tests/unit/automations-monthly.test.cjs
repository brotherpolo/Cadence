// Automations on a schedule (monthly), end to end in index.js, with stand-ins for Firestore,
// Gmail and Firebase. Covers: the heads-up the day before, the run (email, then Status → Sent),
// a missing address or a Gmail failure stopping the steps after it, approve first, and Preview.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

// ---- a small in-memory Firestore
const DEL = { del: true };
function makeDb() {
  const m = new Map(); let n = 0;
  const snap = (p) => ({ id: p.split('/').pop(), exists: m.has(p), data: () => (m.has(p) ? JSON.parse(JSON.stringify(m.get(p))) : undefined), get: (k) => (m.get(p) || {})[k], ref: ref(p) });
  function setPath(o, key, v) { const ks = key.split('.'); let x = o; ks.slice(0, -1).forEach((k) => { x[k] = x[k] && typeof x[k] === 'object' ? { ...x[k] } : {}; x = x[k]; }); if (v === DEL) delete x[ks[ks.length - 1]]; else x[ks[ks.length - 1]] = v; }
  function ref(p) {
    return {
      id: p.split('/').pop(), path: p,
      get: async () => snap(p),
      set: async (d) => { m.set(p, JSON.parse(JSON.stringify(d))); },
      update: async (d) => { const cur = JSON.parse(JSON.stringify(m.get(p) || {})); Object.entries(d).forEach(([k, v]) => { if (k.includes('.')) { const [top, ...rest] = k.split('.'); cur[top] = { ...(cur[top] || {}) }; setPath(cur[top], rest.join('.'), v); } else cur[k] = v === DEL ? undefined : JSON.parse(JSON.stringify(v)); }); m.set(p, cur); },
      delete: async () => { m.delete(p); },
      collection: (c) => col(p + '/' + c),
    };
  }
  function col(p, filters = []) {
    const list = () => [...m.keys()].filter((k) => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/')).filter((k) => filters.every(([f, op, v]) => (op === 'array-contains' ? ((m.get(k) || {})[f] || []).includes(v) : (m.get(k) || {})[f] === v)));
    return {
      doc: (id) => ref(p + '/' + (id || 'auto' + ++n)),
      add: async (d) => { const r = ref(p + '/auto' + ++n); await r.set(d); return r; },
      where: (f, op, v) => col(p, [...filters, [f, op, v]]),
      get: async () => ({ docs: list().map(snap), size: list().length }),
    };
  }
  return { m, collection: (c) => col(c), getAll: async (...refs) => Promise.all(refs.map((r) => r.get())), runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, d) => r.set(d), update: (r, d) => r.update(d) }) };
}
const db = makeDb();
const sent = [];
let gmailDown = false;
const kept = [];
const handlers = {};
const stubs = {
  'firebase-functions/v2/firestore': {
    onDocumentWritten: (o, f) => f, onDocumentCreated: (o, f) => f,
    onDocumentWrittenWithAuthContext: (o, f) => { handlers[(o.document || o)] = handlers[(o.document || o)] || []; handlers[(o.document || o)].push(f); return f; },
  },
  'firebase-functions/v2/scheduler': { onSchedule: (o, f) => f },
  'firebase-functions/v2': { setGlobalOptions: () => {}, logger: { error: (...a) => process.env.DBG && console.error(...a), info: () => {}, warn: () => {} } },
  'firebase-functions/v2/https': { onCall: (o, f) => f, HttpsError: class extends Error { constructor(c, msg) { super(msg); this.code = c; } } },
  'firebase-functions/params': { defineSecret: () => ({ value: () => 'app pass word' }) },
  'firebase-admin': { initializeApp: () => {}, firestore: () => db, storage: () => ({ bucket: () => ({ file: (p) => ({ download: async () => [Buffer.alloc(0)], save: async (b) => { kept.push([p, b]); } }) }) }), messaging: () => ({}), auth: () => ({}) },
  'firebase-admin/firestore': { FieldValue: { delete: () => DEL } },
  nodemailer: { createTransport: () => ({ sendMail: async (mail) => { if (gmailDown) { const e = new Error('Invalid login: 535-5.7.8 Username and Password not accepted'); e.code = 'EAUTH'; throw e; } sent.push(mail); return { messageId: '<m' + sent.length + '>' }; } }) },
};
const orig = Module._load;
Module._load = function (req, parent, isMain) { return stubs[req] || orig.call(this, req, parent, isMain); };
process.env.GMAIL_USER = 'sender@gmail.com';
const fns = require(path.join(__dirname, '../../functions/index.js'));
// (the stand-ins stay in place: nodemailer is loaded on first use)


// ---- the clock: Toronto is UTC-4 in October, UTC-5 from November 1
const realNow = Date.now;
const at = (iso) => { const t = Date.parse(iso); Date.now = () => t; };
test.after(() => { Date.now = realNow; });

// ---- data
const set = (p, d) => db.m.set(p, d);
const where = (pre, pred = () => true) => [...db.m.entries()].filter(([k, v]) => k.startsWith(pre) && pred(v, k));
const runsOf = (id) => where(`automations/${id}/runs/`).map(([, v]) => v);
set('users/boss', { email: 'adam@x.example', displayName: 'Adam', role: 'admin' });
set('users/amy', { email: 'amy@x.example', displayName: 'Amy', role: 'member' });
set('settings/exports', { companyName: 'Pollack Inc.' });
const AUTO = ['No', 'End of month'];
set('forms/f_cust', { name: 'Customers', itemName: 'Customer', titleField: 'n', children: [{ formId: 'f_inv', copy: true }], fields: [{ id: 'n', type: 'text', label: 'Name' }, { id: 'be', type: 'email', label: 'Billing email' }, { id: 'ca', type: 'select', label: 'Auto-send', options: AUTO }] });
set('forms/f_inv', { name: 'Invoices', itemName: 'Invoice', titleField: 'num', fields: [{ id: 'num', type: 'text', label: 'Number' }, { id: 'as', type: 'select', label: 'Auto-send', options: AUTO }, { id: 'st', type: 'select', label: 'Status', options: ['Draft', 'Sent', 'Paid'] }, { id: 'tot', type: 'currency', label: 'Invoice Total', currency: 'CAD' }, { id: 'sd', type: 'date', label: 'Sent date' }] });
set('records/oli', { formId: 'f_cust', values: { n: 'Oliver’s', be: 'billing@olivers.example', ca: 'End of month' }, ownerId: 'boss' });
set('records/nom', { formId: 'f_cust', values: { n: 'No Mail Co', ca: 'End of month' }, ownerId: 'boss' });
const inv = (id, parent, values) => set('records/' + id, { formId: 'f_inv', parentId: parent, parentFormId: 'f_cust', values, ownerId: 'boss', createdBy: 'boss', updatedBy: 'boss', createdAt: 1 });
inv('i57', 'oli', { num: '57', as: 'End of month', st: 'Draft', tot: 1225 });
inv('i58', 'oli', { num: '58', as: 'No', st: 'Draft', tot: 300 });
inv('i59', 'nom', { num: '59', as: 'End of month', st: 'Draft', tot: 80 });
inv('i60', 'oli', { num: '60', as: 'End of month', st: 'Paid', tot: 990 });
inv('i61', 'oli', { num: '61', as: 'End of month', st: 'Draft', tot: 0 });
const monthly = (extra = {}) => ({ name: 'Month-end invoices', formId: 'f_inv', on: true, createdBy: 'boss', trigger: { type: 'schedule', every: 'monthEndBiz', hour: 17, headsUp: true, ...extra },
  join: 'all', conds: [{ src: 'self', field: 'as', op: 'is', value: 'End of month' }, { src: 'self', field: 'st', op: 'is', value: 'Draft' }, { src: 'self', field: 'tot', op: 'gt', value: 0 }],
  acts: [
    { do: 'email', to: { parentFields: ['be'] }, subject: 'Invoice {Number} from {Company}', message: 'Total {Invoice Total}', pdf: true },
    { do: 'set', target: 'self', sets: [{ field: 'st', mode: 'value', value: 'Sent' }, { field: 'sd', mode: 'today' }] },
  ] });
set('automations/m1', monthly());
const val = (id, f) => db.m.get('records/' + id).values[f];

test('the day before at 5 p.m.: one heads-up email to the owner, nothing sent to customers', async () => {
  at('2026-10-29T20:00:00Z'); // 4 p.m. Thursday: not yet
  await fns.automationMonthly();
  assert.equal(sent.length, 0);
  at('2026-10-29T21:05:00Z'); // 5:05 p.m.
  await fns.automationMonthly();
  await fns.automationMonthly();
  assert.equal(sent.length, 1, 'once');
  const m = sent[0];
  assert.equal(m.to, 'adam@x.example');
  assert.equal(m.subject, 'Tomorrow: “Month-end invoices” runs for 1 invoice');
  assert.match(m.text, /runs tomorrow, Friday, October 30, 2026, at 5:00 p\.m\./);
  assert.match(m.text, /• 57 · Oliver’s · \$1,225\.00\n    – Email billing@olivers\.example: “Invoice 57 from Pollack Inc\.” with the PDF\n    – Set Status to Sent, Sent date to Oct 29, 2026/);
  assert.match(m.text, /Can't be sent \(no email address\)[^]*• 59 · No Mail Co · \$80\.00/);
  assert.doesNotMatch(m.text, /58|60|61/, 'only the ones that match “Only if”');
  assert.equal(val('i57', 'st'), 'Draft');
});

test('on the last business day at 5 p.m.: emails the PDF, then marks it Sent; no address stops the steps and makes a task', async () => {
  sent.length = 0;
  at('2026-10-30T20:59:00Z'); // 4:59 p.m.
  await fns.automationMonthly();
  assert.equal(sent.length, 0);
  at('2026-10-30T21:00:00Z');
  await fns.automationMonthly();
  assert.equal(sent.length, 1, JSON.stringify(runsOf('m1')));
  assert.deepEqual(sent[0].to, ['billing@olivers.example']);
  assert.equal(sent[0].subject, 'Invoice 57 from Pollack Inc.');
  assert.equal(sent[0].attachments[0].content.subarray(0, 5).toString(), '%PDF-');
  assert.equal(val('i57', 'st'), 'Sent'); assert.equal(val('i57', 'sd'), '2026-10-30');
  assert.equal(where('records/i57/emails/').length, 1, 'under Sent emails');
  assert.equal(val('i59', 'st'), 'Draft', 'not marked Sent when it wasn’t');
  const t = where('tasks/', (v) => v.recordId === 'i59').map(([, v]) => v);
  assert.equal(t.length, 1);
  assert.equal(t[0].title, 'Couldn’t send Invoice 59 · No Mail Co · $80.00');
  assert.match(t[0].notes, /no email address/);
  assert.deepEqual([t[0].ownerId, t[0].members], ['boss', ['boss']]);
  assert.ok(['i58', 'i60', 'i61'].every((id) => !where(`records/${id}/emails/`).length));
  const bad = runsOf('m1').find((r) => r.recordId === 'i59');
  assert.equal(bad.ok, false); assert.match(bad.errors[0], /no email address.*Stopped here/);
  await fns.automationMonthly();
  at('2026-10-30T23:00:00Z');
  await fns.automationMonthly();
  assert.equal(sent.length, 1, 'once a month');
  assert.equal(where('tasks/', (v) => v.recordId === 'i59').length, 1);
});

test('Gmail refusing the password stops the steps (not marked Sent) and says why in a task', async () => {
  sent.length = 0;
  db.m.get('records/i57').values.st = 'Draft';
  gmailDown = true;
  at('2026-11-30T22:00:00Z'); // Monday Nov 30, 5 p.m. (UTC-5)
  await fns.automationMonthly();
  gmailDown = false;
  assert.equal(val('i57', 'st'), 'Draft');
  const t = where('tasks/', (v) => v.recordId === 'i57').map(([, v]) => v);
  assert.equal(t.length, 1);
  assert.match(t[0].notes, /Gmail didn’t accept Wayholm’s app password/);
  const r = runsOf('m1').filter((x) => x.recordId === 'i57').pop();
  assert.match(r.errors.join(' '), /Gmail didn’t accept[^]*Stopped here/);
});

test('approve first: a task and a waiting entry instead; Send now sends it, Don’t send drops it', async () => {
  sent.length = 0;
  set('automations/m1', { ...monthly(), on: false });
  set('automations/m2', monthly({ approve: true, every: 'monthEnd' }));
  inv('i62', 'oli', { num: '62', as: 'End of month', st: 'Draft', tot: 50 });
  at('2026-12-31T22:30:00Z'); // Thursday Dec 31, 5:30 p.m.
  await fns.automationMonthly();
  assert.equal(sent.length, 0, 'nothing goes to customers');
  const p57 = db.m.get('pendingSends/m2_i57'), p62 = db.m.get('pendingSends/m2_i62');
  assert.ok(p57 && p62, JSON.stringify([...db.m.keys()].filter((k) => k.startsWith('pending'))));
  assert.equal(p57.title, '57 · Oliver’s · $1,225.00');
  assert.match(p57.steps[0], /^Email billing@olivers\.example/);
  const task = db.m.get('tasks/' + p57.taskId);
  assert.equal(task.title, 'Review and send: Invoice 57 · Oliver’s · $1,225.00');
  assert.match(task.notes, /waiting for your OK[^]*Send now/);
  assert.equal(db.m.get('pendingSends/m2_i59'), undefined, 'no address: a problem task instead');
  assert.ok(where('tasks/', (v) => v.recordId === 'i59' && /Couldn’t send/.test(v.title)).length >= 2);

  await assert.rejects(fns.automationSend({ auth: { uid: 'amy' }, data: { id: 'm2_i57', send: true } }), (e) => e.code === 'permission-denied');
  const out = await fns.automationSend({ auth: { uid: 'boss' }, data: { id: 'm2_i57', send: true } });
  assert.equal(out.ok, true);
  assert.equal(sent.length, 1); assert.deepEqual(sent[0].to, ['billing@olivers.example']);
  assert.equal(val('i57', 'st'), 'Sent');
  assert.equal(db.m.get('pendingSends/m2_i57'), undefined);
  assert.equal(db.m.get('tasks/' + p57.taskId).done, true, 'its task is ticked off');
  await assert.rejects(fns.automationSend({ auth: { uid: 'boss' }, data: { id: 'm2_i57', send: true } }), (e) => e.code === 'not-found');

  // it changed since: refused, nothing sent
  db.m.get('records/i62').values.as = 'No';
  await assert.rejects(fns.automationSend({ auth: { uid: 'boss' }, data: { id: 'm2_i62', send: true } }), (e) => e.code === 'failed-precondition' && /no longer matches/.test(e.message));
  assert.equal(sent.length, 1);
  const no = await fns.automationSend({ auth: { uid: 'boss' }, data: { id: 'm2_i62', send: false } });
  assert.deepEqual([no.ok, no.sent], [true, false]);
  assert.equal(db.m.get('pendingSends/m2_i62'), undefined);
  assert.equal(db.m.get('tasks/' + p62.taskId).done, true);
  assert.ok(runsOf('m2').some((r) => r.recordId === 'i62' && /Don’t send/.test(r.did[0])));
});

test('Preview: which ones it would send now, and when it next runs; admins only, nothing written', async () => {
  db.m.get('records/i57').values.st = 'Draft';
  at('2027-01-10T15:00:00Z');
  const before = db.m.size;
  const out = await fns.automationPreview({ auth: { uid: 'boss' }, data: { automation: monthly() } });
  assert.equal(out.next, '2027-01-29');
  assert.equal(out.nextText, 'Friday, January 29, 2027 at 5:00 p.m.');
  assert.deepEqual(out.items.map((x) => x.title).sort(), ['57 · Oliver’s · $1,225.00', '59 · No Mail Co · $80.00']);
  assert.ok(out.items.find((x) => x.recordId === 'i59').steps.some((s) => s.noAddr));
  assert.equal(out.checked, 6);
  assert.equal(db.m.size, before);
  await assert.rejects(fns.automationPreview({ auth: { uid: 'amy' }, data: { automation: monthly() } }), (e) => e.code === 'permission-denied');
});

test('an Invoice Total that adds up its line items (a formula) works in “Only if”', async () => {
  set('forms/f_bill', { name: 'Bills', itemName: 'Bill', titleField: 'num', children: [{ formId: 'f_line' }], fields: [{ id: 'num', type: 'text', label: 'Number' }, { id: 'tot', type: 'formula', label: 'Invoice Total', expr: 'CHILDSUM("Lines", "Amount")', format: 'currency', currency: 'CAD' }] });
  set('forms/f_line', { name: 'Lines', itemName: 'Line', titleField: 'd', fields: [{ id: 'd', type: 'text', label: 'Description' }, { id: 'amt', type: 'currency', label: 'Amount' }] });
  set('records/b1', { formId: 'f_bill', values: { num: 'B1' }, ownerId: 'boss' });
  set('records/b2', { formId: 'f_bill', values: { num: 'B2' }, ownerId: 'boss' });
  set('records/l1', { formId: 'f_line', parentId: 'b1', parentFormId: 'f_bill', values: { d: 'Work', amt: 400 }, ownerId: 'boss' });
  set('records/l2', { formId: 'f_line', parentId: 'b1', parentFormId: 'f_bill', values: { d: 'More', amt: 250 }, ownerId: 'boss' });
  at('2027-01-12T15:00:00Z'); // past the server's one-minute cache of forms
  const a = { name: 'Bills', formId: 'f_bill', on: true, trigger: { type: 'schedule', every: 'monthEnd', hour: 17 }, conds: [{ src: 'self', field: 'tot', op: 'gt', value: 0 }], acts: [{ do: 'task', title: 'x {Invoice Total}', assign: 'owner' }] };
  const out = await fns.automationPreview({ auth: { uid: 'boss' }, data: { automation: a } });
  assert.deepEqual(out.items.map((x) => x.title), ['B1 · $650.00'], 'B2 has no lines, so a total of 0 is left out');
});

test('any frequency: every 2 weeks on Wednesday runs on those Wednesdays only, with the heads-up on Tuesday', async () => {
  set('automations/m2', { ...db.m.get('automations/m2'), on: false });
  set('automations/w1', { name: 'Fortnightly check', formId: 'f_inv', on: true, createdBy: 'boss', trigger: { type: 'schedule', freq: 'week', n: 2, days: [3], start: '2027-02-01', hour: 9, headsUp: true },
    conds: [{ src: 'self', field: 'num', op: 'is', value: '58' }], acts: [{ do: 'task', title: 'Check {Number}', assign: 'owner' }] });
  const tasks = () => where('tasks/', (v) => v.title === 'Check 58').length;
  sent.length = 0;
  at('2027-02-02T14:30:00Z'); // Tue Feb 2, 9:30 a.m.: the heads-up for Wednesday
  await fns.automationMonthly();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, 'Tomorrow: “Fortnightly check” runs for 1 invoice');
  assert.match(sent[0].text, /runs tomorrow, Wednesday, February 3, 2027, at 9:00 a\.m\./);
  at('2027-02-03T14:30:00Z'); await fns.automationMonthly(); await fns.automationMonthly();
  assert.equal(tasks(), 1, 'Wed Feb 3 (week one), once');
  at('2027-02-10T14:30:00Z'); await fns.automationMonthly();
  assert.equal(tasks(), 1, 'not Wed Feb 10 (the off week)');
  at('2027-02-17T13:30:00Z'); await fns.automationMonthly();
  assert.equal(tasks(), 1, 'not before 9 a.m.');
  at('2027-02-17T14:00:00Z'); await fns.automationMonthly();
  assert.equal(tasks(), 2, 'Wed Feb 17');
  const out = await fns.automationPreview({ auth: { uid: 'boss' }, data: { automation: db.m.get('automations/w1') } });
  assert.equal(out.schedule, 'Every 2 weeks on Wednesday at 9:00 a.m., starting February 1, 2027');
  assert.equal(out.next, '2027-03-03');
});
