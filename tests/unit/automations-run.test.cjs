// Automations end to end in index.js, with stand-ins for Firestore, Gmail and Firebase.
// Covers: a change firing an automation, its writes, tasks, emails with a PDF, child records,
// the run log, loop protection, the daily date run and the Test run callable.
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
const kept = [];
const handlers = {};
const stubs = {
  'firebase-functions/v2/firestore': {
    onDocumentWritten: (o, f) => f, onDocumentCreated: (o, f) => f,
    onDocumentWrittenWithAuthContext: (o, f) => { handlers[(o.document || o)] = handlers[(o.document || o)] || []; handlers[(o.document || o)].push(f); return f; },
  },
  'firebase-functions/v2/scheduler': { onSchedule: (o, f) => f },
  'firebase-functions/v2': { setGlobalOptions: () => {}, logger: { error: () => {}, info: () => {}, warn: () => {} } },
  'firebase-functions/v2/https': { onCall: (o, f) => f, HttpsError: class extends Error { constructor(c, msg) { super(msg); this.code = c; } } },
  'firebase-functions/params': { defineSecret: () => ({ value: () => 'app pass word' }) },
  'firebase-admin': { initializeApp: () => {}, firestore: () => db, storage: () => ({ bucket: () => ({ file: (p) => ({ download: async () => [Buffer.alloc(0)], save: async (b) => { kept.push([p, b]); } }) }) }), messaging: () => ({}), auth: () => ({}) },
  'firebase-admin/firestore': { FieldValue: { delete: () => DEL } },
  nodemailer: { createTransport: () => ({ sendMail: async (mail) => { sent.push(mail); return { messageId: '<m' + sent.length + '>' }; } }) },
};
const orig = Module._load;
Module._load = function (req, parent, isMain) { return stubs[req] || orig.call(this, req, parent, isMain); };
process.env.GMAIL_USER = 'sender@gmail.com';
const fns = require(path.join(__dirname, '../../functions/index.js'));
// (the stand-ins stay in place: nodemailer is loaded on first use)

// ---- data
const set = (p, d) => db.m.set(p, d);
set('users/boss', { email: 'adam@x.example', displayName: 'Adam', role: 'admin' });
set('users/amy', { email: 'amy@x.example', displayName: 'Amy', role: 'member' });
set('users/rev1', { email: 'rev1@x.example', displayName: 'Rae', role: 'member', groups: ['g_rev'] });
set('users/rev2', { email: 'rev2@x.example', displayName: 'Rob', role: 'member', groups: ['g_rev', 'g_x'] });
set('forms/f_req', { name: 'Requests', itemName: 'Request', titleField: 't', fields: [{ id: 't', type: 'text', label: 'Title' }], workflow: { on: true, stages: [
  { id: 's1', name: 'Draft', assign: { type: 'owner' }, notify: {} },
  { id: 's2', name: 'Review', assign: { type: 'group', group: 'g_rev' }, notify: { task: true, email: true }, dueDays: 2 },
  { id: 's3', name: 'Approved', assign: { type: 'owner' }, notify: { task: true } },
] } });
set('settings/exports', { companyName: 'Pollack Inc.' });
set('forms/f_cli', { name: 'Clients', itemName: 'Client', children: [{ formId: 'f_job' }], fields: [{ id: 'cn', type: 'text', label: 'Name' }, { id: 'ce', type: 'email', label: 'Email' }] });
set('forms/f_job', { name: 'Jobs', itemName: 'Job', color: 1, titleField: 't', children: [{ formId: 'f_note' }], fields: [{ id: 't', type: 'text', label: 'Title' }, { id: 'st', type: 'select', label: 'Stage', options: ['Open', 'Done'] }, { id: 'amt', type: 'currency', label: 'Budget' }, { id: 'fin', type: 'date', label: 'Finished on' }, { id: 'due', type: 'date', label: 'Due' }] });
set('forms/f_note', { name: 'Notes', itemName: 'Note', fields: [{ id: 't', type: 'text', label: 'Title' }, { id: 'x', type: 'text', label: 'Text' }] });
set('records/c1', { formId: 'f_cli', values: { cn: 'Northwind', ce: 'ap@northwind.example' }, ownerId: 'amy', createdBy: 'amy', updatedBy: 'amy' });
const job = { formId: 'f_job', parentId: 'c1', parentFormId: 'f_cli', values: { t: 'Roof', st: 'Open', amt: 5000, due: '2026-10-20' }, ownerId: 'amy', createdBy: 'amy', updatedBy: 'amy', createdAt: 1 };
set('records/j1', job);
set('automations/a1', { name: 'Finished jobs', formId: 'f_job', on: true, createdBy: 'boss', trigger: { type: 'changed', field: 'st', op: 'is', value: 'Done' }, join: 'all', conds: [{ src: 'self', field: 'amt', op: 'gt', value: 1000 }], acts: [
  { do: 'set', target: 'self', sets: [{ field: 'fin', mode: 'today' }] },
  { do: 'task', title: 'Invoice {Title} for {Client › Name}', assign: 'actor', dueDays: 2 },
  { do: 'email', to: { parentFields: ['ce'], owner: true }, subject: '{Item} {Title} is done', message: 'Budget {Budget}', pdf: true },
  { do: 'child', formId: 'f_note', copy: true, sets: [{ field: 'x', mode: 'value', value: 'Closed by automation' }] },
] });
set('automations/a2', { name: 'Any change', formId: 'f_job', on: true, createdBy: 'boss', trigger: { type: 'changed' }, conds: [], acts: [{ do: 'set', target: 'self', sets: [{ field: 'amt', mode: 'value', value: 5000 }] }] });
set('automations/a3', { name: 'Due soon', formId: 'f_job', on: true, createdBy: 'boss', trigger: { type: 'date', dateField: 'due', rel: 'before', days: 3 }, conds: [], acts: [{ do: 'task', title: 'Due soon: {Title}', assign: 'owner' }] });
const write = async (id, before, after, authId = 'amy') => {
  for (const h of handlers['records/{recordId}']) await h({ params: { recordId: id }, authType: authId.includes('@') ? 'service_account' : 'app_user', authId, data: { before: { exists: !!before, data: () => before }, after: { exists: !!after, data: () => after } } });
};
const runsOf = (id) => [...db.m.entries()].filter(([k]) => k.startsWith(`automations/${id}/runs/`)).map(([, v]) => v);
const where = (pre, pred = () => true) => [...db.m.entries()].filter(([k, v]) => k.startsWith(pre) && pred(v, k));

test('a person changing Stage to Done runs the automation: fields, task, email with PDF, child, log, audit', async () => {
  const after = { ...job, values: { ...job.values, st: 'Done' }, updatedBy: 'amy' };
  set('records/j1', after);
  await write('j1', job, after);
  const j = db.m.get('records/j1');
  assert.match(j.values.fin, /^\d{4}-\d{2}-\d{2}$/, 'Finished on set to today');
  assert.equal(j.updatedBy, 'auto:a1'); assert.equal(j.auto.depth, 1); assert.equal(j.auto.actor, 'amy');
  const tasks = where('tasks/').map(([, v]) => v);
  assert.equal(tasks.length, 1);
  const t = tasks[0];
  assert.equal(t.title, 'Invoice Roof for Northwind');
  assert.deepEqual([t.ownerId, t.assigneeId, t.members, t.recordId, t.formId, t.recordSnap.title], ['boss', 'amy', ['boss', 'amy'], 'j1', 'f_job', 'Roof']);
  assert.equal(sent.length, 1, JSON.stringify(runsOf("a1")));
  assert.deepEqual(sent[0].to, ['ap@northwind.example', 'amy@x.example']);
  assert.equal(sent[0].subject, 'Job Roof is done');
  assert.match(sent[0].text, /^Budget \$5,000\.00$/);
  assert.equal(sent[0].attachments[0].filename, 'Jobs - Roof.pdf');
  assert.equal(sent[0].attachments[0].content.subarray(0, 5).toString(), '%PDF-');
  assert.equal(where('records/j1/emails/').length, 1, 'listed under Sent emails');
  const log = where('records/j1/emails/')[0];
  assert.equal(log[1].message, 'Budget $5,000.00', 'the message is kept for the pop-up');
  assert.equal(log[1].pdfPath, `sentEmails/j1/${log[0].split('/').pop()}.pdf`, 'its PDF is kept, like Email PDF');
  assert.ok(kept.some(([p, b]) => p === log[1].pdfPath && b.subarray(0, 5).toString() === '%PDF-'));
  const kids = where('records/', (v) => v.formId === 'f_note').map(([, v]) => v);
  assert.deepEqual([kids.length, kids[0].values.t, kids[0].values.x, kids[0].parentId, kids[0].ownerId], [1, 'Roof', 'Closed by automation', 'j1', 'amy'], 'child copies Title');
  const runs = runsOf('a1');
  assert.equal(runs.length, 1); assert.equal(runs[0].ok, true); assert.equal(runs[0].did.length, 4);
  const aud = where('audit/').map(([, v]) => v);
  assert.ok(aud.some((e) => e.byName === 'Automation: Finished jobs' && e.kind === 'changed' && e.changes[0].label === 'Finished on'));
  assert.ok(aud.some((e) => e.kind === 'emailed') && aud.some((e) => e.kind === 'created'));
  assert.equal(runsOf('a2').length, 1, '“any change” ran too (Budget already 5000: nothing to write)');
});

test('loop protection: its own change doesn’t trigger it again; chains stop at 3', async () => {
  const before = db.m.get('records/j1');
  // the automation's own write arrives as a change: a1 must not run again, a2 runs (depth 1)
  const n1 = runsOf('a1').length, n2 = runsOf('a2').length;
  await write('j1', { ...job, values: { ...job.values, st: 'Done' } }, before, 'service@x.gserviceaccount.com');
  assert.equal(runsOf('a1').length, n1, 'a1 ignores its own change');
  assert.equal(runsOf('a2').length, n2 + 1);
  const deep = { ...before, values: { ...before.values, amt: 1 }, auto: { depth: 3, id: 'zz', at: 9 } };
  set('records/j1', deep);
  await write('j1', before, deep, 'service@x.gserviceaccount.com');
  const last = runsOf('a2').pop();
  assert.equal(last.ok, false); assert.match(last.errors[0], /Stopped/);
});

test('every morning: date automations run once per record per day', async () => {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, mo, d] = day.split('-').map(Number);
  const in3 = new Date(Date.UTC(y, mo - 1, d + 3)).toISOString().slice(0, 10);
  const r = db.m.get('records/j1'); set('records/j1', { ...r, values: { ...r.values, due: in3 } });
  const before = where('tasks/').length;
  await fns.automationDaily();
  await fns.automationDaily();
  const tasks = where('tasks/').map(([, v]) => v);
  assert.equal(tasks.length, before + 1, 'once, not twice');
  assert.equal(tasks.find((t) => /Due soon/.test(t.title)).members[0], 'boss');
});

test('Test run: admins only, nothing written', async () => {
  const before = db.m.size;
  const out = await fns.automationTest({ auth: { uid: 'boss' }, data: { automation: db.m.get('automations/a1') && { ...db.m.get('automations/a1'), id: 'a1' }, recordId: 'j1' } });
  assert.equal(out.title, 'Roof');
  assert.ok(out.steps.length === 4 && out.steps.some((s) => /Create task/.test(s.text)));
  assert.equal(db.m.size, before);
  await assert.rejects(fns.automationTest({ auth: { uid: 'amy' }, data: { automation: {}, recordId: 'j1' } }), (e) => e.code === 'permission-denied');
});

test('workflow: arriving at a stage closes the old workflow tasks, tasks/emails the new assignees, runs stage automations', async () => {
  set('automations/a9', { name: 'Approved note', formId: 'f_req', on: true, createdBy: 'boss', trigger: { type: 'stage', to: 's3' }, conds: [], acts: [{ do: 'task', title: 'File {Title}', assign: 'owner' }] });
  const r0 = { formId: 'f_req', values: { t: 'New laptop' }, ownerId: 'amy', createdBy: 'amy', updatedBy: 'amy', stage: 's1', assignee: 'amy', assigneeGroup: null };
  set('records/q1', r0);
  const t0 = where('tasks/').length, m0 = sent.length;
  await write('q1', null, r0);
  assert.equal(where('tasks/').length, t0, 'Draft has no notices');
  const r1 = { ...r0, stage: 's2', assignee: null, assigneeGroup: 'g_rev', stageAt: 2 };
  set('records/q1', r1);
  await write('q1', r0, r1);
  const wt = () => where('tasks/', (v) => v.recordId === 'q1').map(([, v]) => v);
  assert.deepEqual(wt().map((t) => [t.title, t.assigneeId, t.ownerId, t.done]).sort(), [['Review: New laptop', 'rev1', 'amy', false], ['Review: New laptop', 'rev2', 'amy', false]], JSON.stringify(wt()));
  const mails = sent.slice(m0);
  assert.deepEqual(mails.map((m) => m.to).sort(), ['rev1@x.example', 'rev2@x.example']);
  assert.match(mails[0].subject, /^Request New laptop: you’re the person responsible \(Review\)$/);
  const fw = require('../../functions/fwkit.cjs');
  const due = fw.stageDue({ dueDays: 2 }, fw.dayKey(2, 'America/Toronto'));
  assert.ok(wt().every((t) => t.due === due) && /^\d{4}-\d{2}-\d{2}$/.test(due), 'Review tasks are due in 2 working days: ' + due);
  assert.match(mails[0].text, new RegExp('due ' + due));
  const r2 = { ...r1, stage: 's3', assignee: 'amy', assigneeGroup: null, updatedBy: 'rev1' };
  set('records/q1', r2);
  await write('q1', r1, r2, 'rev1');
  const all = wt();
  assert.ok(all.filter((t) => t.title.startsWith('Review')).every((t) => t.done), 'Review tasks closed');
  assert.ok(all.some((t) => t.title === 'Approved: New laptop' && !t.done), 'Approved task');
  assert.ok(all.some((t) => t.title === 'File New laptop'), 'the stage automation ran');
  const n = all.length;
  await write('q1', r2, { ...r2, values: { t: 'New laptop!' } }, 'amy');
  assert.equal(wt().length, n, 'an ordinary edit sends no notices');
});

test('workflow: a new record without a stage (import, automation, Duplicate) starts at the first stage, once', async () => {
  const r = { formId: 'f_req', values: { t: 'Imported chair' }, ownerId: 'amy', createdBy: 'boss', updatedBy: 'boss' };
  set('records/q2', r);
  await write('q2', null, r, 'boss');
  const now = db.m.get('records/q2');
  assert.deepEqual([now.stage, now.assignee, now.assigneeGroup, typeof now.stageAt], ['s1', 'amy', null, 'number'], 'Draft goes to the owner');
  const hist = where('records/q2/stages/').map(([, v]) => v);
  assert.deepEqual(hist.map((h) => [h.to, h.label, h.by]), [['s1', 'Started', 'boss']]);
  await write('q2', null, r, 'boss'); // a repeat of the same event: already started, nothing more
  assert.equal(where('records/q2/stages/').length, 1);
  const plain = { formId: 'f_job', values: { t: 'No workflow' }, ownerId: 'amy', createdBy: 'amy', updatedBy: 'amy' };
  set('records/q3', plain); await write('q3', null, plain);
  assert.equal(db.m.get('records/q3').stage, undefined, 'forms without a workflow are left alone');
});
