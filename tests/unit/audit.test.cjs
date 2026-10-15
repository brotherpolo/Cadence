// Audit trail (functions/audit.js): what each change notes, and restoring a deleted record.
// Run from tests/: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const { recordEntry, formEntry, groupEntry, userEntry, settingsEntry, restoreRecord, auditValue, titleOf } = require('../../functions/audit.js');

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
    m, collection: (c) => ({ doc: (id) => ref(c + '/' + id) }),
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
