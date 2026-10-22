// Audit trail (functions/audit.js): what each change notes, and restoring a deleted record.
// Run from tests/: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const { recordEntry, creditName, formEntry, groupEntry, userEntry, settingsEntry, restoreRecord, auditValue, titleOf } = require('../../functions/audit.js');

const who = { by: 'boss', byName: 'Adam' };
const form = { name: 'Invoices', titleField: 'num', fields: [
  { id: 'num', type: 'autonumber', label: 'Invoice #' }, { id: 'st', type: 'select', label: 'Status' }, { id: 'amt', type: 'currency', label: 'Total' },
  { id: 'h', type: 'heading', label: 'Section' }, { id: 'calc', type: 'formula', label: 'Tax' }, { id: 'sig', type: 'signature', label: 'Signed' }, { id: 'pic', type: 'image', label: 'Photo' },
] };
const rec = (values, extra = {}) => ({ formId: 'f_inv', values, nums: { num: 'INV-0058' }, parentId: 'c1', parentFormId: 'f_cli', ownerId: 'amy', createdBy: 'amy', updatedBy: 'boss', ...extra });

test('values kept for the audit', () => {
  assert.equal(auditValue('data:image/png;base64,xxxx', 'signature'), 'signed');
  assert.deepEqual(auditValue({ name: 'roof.jpg', url: 'https://…', size: 3 }, 'image'), { name: 'roof.jpg' });
  assert.equal(auditValue('x'.repeat(1500)).length, 1001);
  assert.equal(auditValue(''), null);
  assert.equal(titleOf(rec({}), form), 'INV-0058', 'an auto number can be the title');
});

test('a changed record lists each field that changed, from → to', () => {
  const e = recordEntry('r1', rec({ st: 'Draft', amt: 100, calc: 13 }), rec({ st: 'Sent', amt: 100, calc: 99, sig: 'data:image/png;base64,AAA' }), form, who, 5);
  assert.deepEqual([e.area, e.kind, e.title, e.by, e.byName, e.at, e.formName], ['record', 'changed', 'INV-0058', 'boss', 'Adam', 5, 'Invoices']);
  assert.deepEqual(e.changes.map((c) => [c.label, c.from, c.to]), [['Status', 'Draft', 'Sent'], ['Signed', null, 'signed']], 'calculations and headings are left out');
});

test('saving without changes notes nothing; moving and giving away are noted', () => {
  assert.equal(recordEntry('r1', rec({ st: 'A' }), rec({ st: 'A', extra: '' }, { updatedAt: 9 }), form, who, 1), null);
  const moved = recordEntry('r1', rec({}), rec({}, { parentId: 'c2' }), form, who, 1);
  assert.deepEqual([moved.kind, moved.changes[0].label, moved.changes[0].from, moved.changes[0].to], ['moved', 'Belongs to', 'c1', 'c2']);
  const given = recordEntry('r1', rec({}), rec({}, { ownerId: 'bo' }), form, who, 1);
  assert.deepEqual([given.kind, given.changes[0].from, given.changes[0].to], ['owner', 'amy', 'bo']);
});

test('created and deleted (deleted keeps a copy to restore)', () => {
  const c = recordEntry('r1', null, rec({ st: 'Draft', amt: '' }), form, who, 1);
  assert.deepEqual([c.kind, c.changes.map((x) => x.label)], ['created', ['Invoice #', 'Status']]);
  const d = recordEntry('r1', rec({ st: 'Draft' }), null, form, who, 1);
  assert.deepEqual([d.kind, d.snapshot.values.st, d.snapshot.nums.num, d.snapshot.parentId], ['deleted', 'Draft', 'INV-0058', 'c1']);
  const huge = recordEntry('r1', rec({ st: 'x', sig: 'data:' + 'A'.repeat(900000) }), null, form, who, 1);
  assert.ok(huge.snapshot.trimmed && !huge.snapshot.values.sig && huge.snapshot.values.st === 'x', 'a copy too big for the database drops signatures');
});

test('form designs', () => {
  const b = { name: 'Invoices', fields: [{ id: 'a', type: 'text', label: 'Name' }, { id: 'b', type: 'number', label: 'Qty' }], color: 1 };
  const a = { name: 'Invoice', fields: [{ id: 'a', type: 'text', label: 'Client name' }, { id: 'c', type: 'date', label: 'Due' }], color: 2, updatedAt: 9 };
  const e = formEntry('f', b, a, who, 1);
  assert.deepEqual(e.changes.map((c) => c.label), ['Name', 'Field renamed', 'Field added', 'Field removed', 'Color']);
  assert.equal(formEntry('f', b, { ...b, updatedAt: 5 }, who, 1), null);
  assert.equal(formEntry('f', null, a, who, 1).kind, 'created');
  assert.equal(formEntry('f', b, null, who, 1).kind, 'deleted');
});

test('security groups, accounts and settings', () => {
  const g = groupEntry('g1', { name: 'Office', access: { '*': { view: 'all', edit: 'own' } } }, { name: 'Office', access: { '*': { view: 'all', edit: 'all' }, f1: { view: 'none', edit: 'none' } } }, who, 1, new Map([['f1', 'Invoices']]));
  assert.deepEqual(g.changes.map((c) => [c.label, c.from, c.to]), [['Access: every form', 'view All, edit Own', 'view All, edit All'], ['Access: Invoices', null, 'view None, edit None']]);
  const u = userEntry('u1', { role: 'member', groups: ['g1'], access: {} }, { role: 'admin', groups: ['g1', 'g2'], cadence: true, access: { x: 1 } }, who, 1, new Map([['g1', 'Office'], ['g2', 'Field']]), new Map([['u1', 'Jane']]));
  assert.deepEqual(u.changes.map((c) => [c.label, c.from, c.to]), [['Role', 'member', 'admin'], ['Security groups', ['Office'], ['Field', 'Office']], ['Can use Cadence', false, true]]);
  assert.equal(u.targetName, 'Jane');
  assert.equal(userEntry('u1', { role: 'member', access: {} }, { role: 'member', access: { f: 1 } }, who, 1), null, 'access worked out again is not noted');
  assert.equal(userEntry('u1', null, { email: 'jane@x.com' }, who, 1).note, 'First sign-in (jane@x.com)');
  const s = settingsEntry('exports', { companyName: 'A' }, { companyName: 'B', logo: 'data:…' }, who, 1);
  assert.deepEqual(s.changes.map((c) => c.label), ['Company name', 'Logo']);
});

function fakeDb(seed) {
  const m = new Map(Object.entries(seed));
  const snap = (path) => ({ id: path.split('/').pop(), exists: m.has(path), data: () => m.get(path), get: (k) => (m.get(path) || {})[k] });
  const ref = (path) => ({ path, get: async () => snap(path) });
  return {
    m, collection: (c) => ({ doc: (id) => ref(c + '/' + id),
      where: (f, op, v) => ({ get: async () => ({ docs: [...m.keys()].filter((k) => k.startsWith(c + '/') && (m.get(k) || {})[f] === v).map((k) => ({ ...snap(k), ref: ref(k) })) }) }) }),
    async runTransaction(fn) { const ops = []; const out = await fn({ get: async (r) => snap(r.path), set: (r, d) => ops.push(() => m.set(r.path, d)), update: (r, d) => ops.push(() => m.set(r.path, { ...m.get(r.path), ...d })) }); ops.forEach((f) => f()); return out; },
  };
}

test('restoring a deleted record: same ID, admins only, once, within 90 days', async () => {
  const day = 864e5, now = 100 * day;
  const deleted = recordEntry('r1', rec({ st: 'Draft' }), null, form, who, now - 2 * day);
  const db = fakeDb({ 'users/boss': { role: 'admin' }, 'users/amy': { role: 'member' }, 'forms/f_inv': form, 'records/c1': { formId: 'f_cli' }, 'audit/a1': deleted,
    'audit/old': { ...deleted, at: now - 91 * day }, 'audit/chg': { ...deleted, kind: 'changed' } });
  const rejects = (p, code) => assert.rejects(p, (e) => e.code === code);
  await rejects(restoreRecord(db, 'amy', { auditId: 'a1' }, now), 'permission-denied');
  await rejects(restoreRecord(db, 'boss', { auditId: 'old' }, now), 'failed-precondition');
  await rejects(restoreRecord(db, 'boss', { auditId: 'chg' }, now), 'not-found');
  const out = await restoreRecord(db, 'boss', { auditId: 'a1' }, now);
  assert.deepEqual([out.recordId, out.parentGone], ['r1', false]);
  const r = db.m.get('records/r1');
  assert.deepEqual([r.values.st, r.nums.num, r.parentId, r.ownerId, r.createdBy, r.updatedBy], ['Draft', 'INV-0058', 'c1', 'amy', 'amy', 'boss']);
  assert.equal(db.m.get('audit/a1').restoredBy, 'boss');
  await rejects(restoreRecord(db, 'boss', { auditId: 'a1' }, now), 'failed-precondition');
  // its parent was deleted too: comes back on its own
  db.m.delete('records/c1'); db.m.delete('records/r1');
  db.m.set('audit/a2', deleted);
  assert.equal((await restoreRecord(db, 'boss', { auditId: 'a2' }, now)).parentGone, true);
  assert.equal(db.m.get('records/r1').parentId, null);
});

test('formatted long text: only formatting changed is noted, the formatting itself is not a field', () => {
  const f2 = { ...form, fields: form.fields.concat([{ id: 'nt', type: 'textarea', label: 'Notes' }]) };
  const a = rec({ nt: 'Hi there' }), b = rec({ nt: 'Hi there', _rich: { nt: '<p>Hi <b>there</b></p>' } });
  const e = recordEntry('r1', a, b, f2, who, 1);
  assert.deepEqual(e.changes.map((c) => [c.label, c.to]), [['Notes (formatting)', 'changed']]);
  const e2 = recordEntry('r1', b, rec({ nt: 'Bye', _rich: { nt: '<p><b>Bye</b></p>' } }), f2, who, 1);
  assert.deepEqual(e2.changes.map((c) => [c.label, c.from, c.to]), [['Notes', 'Hi there', 'Bye']]);
});

test('a record task given to someone else', () => {
  const { taskReassignEntry, reassignedBy } = require('../../functions/audit.js');
  const base = { title: 'Order tiles', ownerId: 'adam', ownerName: 'Adam', recordId: 'r1', formId: 'f1', recordSnap: { title: 'Lobby', form: 'Projects' } };
  const before = { ...base, assigneeId: 'sam', assigneeName: 'Sam', members: ['adam', 'sam'] };
  const after = { ...base, assigneeId: 'kim', assigneeName: 'Kim', members: ['adam', 'kim'], reassignedBy: 'sam', reassignedAt: 5 };
  const e = taskReassignEntry('t1', before, after, { by: 'sam', byName: 'Sam' }, 9);
  assert.equal(e.kind, 'reassigned');
  assert.equal(e.recordId, 'r1');
  assert.equal(e.title, 'Lobby');
  assert.deepEqual(e.changes[0], { key: 'task:t1', label: 'Task “Order tiles”', type: 'text', from: 'Sam', to: 'Kim' });
  assert.equal(reassignedBy(before, after), 'sam', 'the Reassign stamp');
  const back = { ...base, assigneeId: null, members: ['adam'] };
  assert.equal(taskReassignEntry('t1', before, back, { by: 'sam', byName: 'Sam' }, 9).changes[0].to, 'Adam (owner)');
  assert.equal(reassignedBy(before, back), 'sam', 'handed back by the assignee');
  assert.equal(reassignedBy(before, { ...after, reassignedAt: undefined, reassignedBy: undefined }), 'adam', 'otherwise the owner');
  assert.equal(taskReassignEntry('t1', before, { ...before }, { by: 'x' }, 1), null, 'no change');
  assert.equal(taskReassignEntry('t1', { ...before, recordId: null }, { ...after, recordId: null }, { by: 'x' }, 1), null, 'not a record task');
});

test('roles: stage moves are noted, and the role gets the credit', () => {
  const wf = { ...form, workflow: { on: true, stages: [{ id: 's1', name: 'Review' }, { id: 's2', name: 'Paid' }] } };
  const b = rec({ st: 'A' }, { stage: 's1', assigneeRole: 'r_acc' }), a = rec({ st: 'A' }, { stage: 's2', assigneeRole: null });
  const e = recordEntry('r1', b, a, wf, who, 5);
  assert.equal(e.kind, 'changed');
  assert.deepEqual(e.changes.find((c) => c.key === 'stage'), { key: 'stage', label: 'Stage', type: 'text', from: 'Review', to: 'Paid' });
  assert.equal(creditName(b, a, 'Farren', ['r_acc'], 'Accounts'), 'Accounts (Farren)');
  assert.equal(creditName(b, a, 'Farren', [], 'Accounts'), 'Farren', 'not in the role: just their name');
  assert.equal(creditName(b, { ...b }, 'Farren', ['r_acc'], 'Accounts'), 'Farren', 'no move: just their name');
  const u = userEntry('u1', { roles: [] }, { roles: ['r_acc'] }, who, 5, new Map(), new Map(), new Map([['r_acc', 'Accounts']]));
  assert.deepEqual(u.changes, [{ key: 'roles', label: 'Roles', type: 'multiselect', from: [], to: ['Accounts'] }]);
});

test('roles: tasks given to a role, reassigned and ticked off', () => {
  const { taskReassignEntry, taskDoneEntry } = require('../../functions/audit.js');
  const t = { recordId: 'r1', title: 'Pay', ownerId: 'amy', ownerName: 'Amy', assigneeId: null, assigneeRole: 'r_acc', assigneeRoleName: 'Accounts', recordSnap: { title: '58', form: 'Invoices' }, done: false };
  const e = taskReassignEntry('t1', { ...t, assigneeRole: null, assigneeRoleName: null }, t, who, 5);
  assert.deepEqual([e.changes[0].from, e.changes[0].to], ['Amy (owner)', 'Accounts (role)']);
  const d = taskDoneEntry('t1', t, { ...t, done: true }, { by: 'far', byName: 'Accounts (Farren)' }, 6);
  assert.deepEqual([d.kind, d.byName, d.changes[0].to], ['taskdone', 'Accounts (Farren)', 'Done']);
  assert.equal(taskDoneEntry('t1', { ...t, done: true }, { ...t, done: true }, who, 6), null);
});

test('Undo: whoever deleted it, for 10 minutes, if they can still add to that form', async () => {
  const min = 60e3, now = 1000 * min;
  const del = (by, at) => ({ ...recordEntry('r1', rec({ st: 'Draft' }), null, form, { by, byName: by }, at) });
  const seed = (extra = {}) => fakeDb({ 'users/boss': { role: 'admin' }, 'users/amy': { role: 'member', access: { f_inv: { view: 'own', edit: 'own' } } },
    'users/bo': { role: 'member', access: { '*': { view: 'all', edit: 'none' } } }, 'forms/f_inv': form, 'records/c1': { formId: 'f_cli' }, ...extra });
  const rejects = (p, code, re) => assert.rejects(p, (e) => e.code === code && (!re || re.test(e.message)));
  // found by the record, the latest deletion
  let db = seed({ 'audit/old': { ...del('amy', now - 30 * min), restoredAt: now - 20 * min }, 'audit/a1': del('amy', now - 2 * min) });
  const out = await restoreRecord(db, 'amy', { recordId: 'r1' }, now);
  assert.equal(out.auditId, 'a1');
  assert.equal(db.m.get('records/r1').values.st, 'Draft');
  assert.equal(db.m.get('audit/a1').restoredBy, 'amy');
  await rejects(restoreRecord(db, 'amy', { recordId: 'r1' }, now), 'not-found', /isn’t noted yet/);
  // too late, someone else's, can't add to the form, not noted yet
  await rejects(restoreRecord(seed({ 'audit/a1': del('amy', now - 11 * min) }), 'amy', { recordId: 'r1' }, now), 'failed-precondition', /10 minutes/);
  await rejects(restoreRecord(seed({ 'audit/a1': del('boss', now - min) }), 'amy', { recordId: 'r1' }, now), 'permission-denied', /someone else deleted/);
  await rejects(restoreRecord(seed({ 'audit/a1': del('bo', now - min) }), 'bo', { recordId: 'r1' }, now), 'permission-denied', /can no longer add/);
  await rejects(restoreRecord(seed(), 'amy', { recordId: 'r1' }, now), 'not-found');
  // members still can't restore from the audit trail
  await rejects(restoreRecord(seed({ 'audit/a1': del('amy', now - min) }), 'amy', { auditId: 'a1' }, now), 'permission-denied');
  // admins can undo anyone's, any time in 90 days
  assert.equal((await restoreRecord(seed({ 'audit/a1': del('amy', now - 60 * min) }), 'boss', { recordId: 'r1' }, now)).recordId, 'r1');
});

test('Attachments fields: which files were added and removed, not a whole list', () => {
  const f2 = { ...form, fields: [...form.fields, { id: 'att', type: 'attachments', label: 'Files' }] };
  const A = { name: 'Permit.pdf', path: 'uploads/f/u/1-Permit.pdf', url: 'https://x/a', size: 10 };
  const B = { name: 'Roof.jpg', path: 'uploads/f/u/2-Roof.jpg', url: '', pending: 'up-1', size: 20 };
  const e = recordEntry('r1', rec({ st: 'A', att: [A] }), rec({ st: 'A', att: [B] }), f2, who, 1);
  assert.deepEqual(e.changes, [{ key: 'att', label: 'Files', type: 'attachments', from: null, to: 'Added Roof.jpg · Removed Permit.pdf' }]);
  // an upload finishing later (the link filled in) isn't a change
  assert.equal(recordEntry('r1', rec({ st: 'A', att: [B] }), rec({ st: 'A', att: [{ ...B, url: 'https://x/b', pending: null }] }, { updatedAt: 2 }), f2, who, 2), null);
  const made = recordEntry('r2', null, rec({ att: [A, B] }), f2, who, 3);
  assert.deepEqual(made.changes.find((c) => c.key === 'att').to, 'Added Permit.pdf, Roof.jpg');
});
