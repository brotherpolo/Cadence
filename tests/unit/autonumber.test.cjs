// Auto numbers (functions/autonumber.js) against a small in-memory stand-in for Firestore.
// Run from tests/: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const { assignOnCreate, fillNumbers, setNumber, formatNumber, lastNumber, yearOf } = require('../../functions/autonumber.js');

const getPath = (o, path) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
function applyPatch(obj, patch) {
  const out = JSON.parse(JSON.stringify(obj));
  Object.entries(patch).forEach(([k, v]) => {
    const parts = k.split('.');
    let o = out;
    parts.slice(0, -1).forEach((p) => { o[p] = o[p] && typeof o[p] === 'object' ? o[p] : {}; o = o[p]; });
    o[parts[parts.length - 1]] = v;
  });
  return out;
}
function fakeDb(seed) {
  const m = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
  const snap = (path) => ({ id: path.split('/').pop(), exists: m.has(path), ref: ref(path), data: () => m.get(path), get: (k) => getPath(m.get(path) || {}, k) });
  function ref(path) { return { path, id: path.split('/').pop(), get: async () => snap(path) }; }
  function col(path) {
    const q = (filters) => ({
      where: (f, op, v) => q(filters.concat([[f, v]])),
      get: async () => {
        const docs = [...m.keys()].filter((k) => k.startsWith(path + '/') && k.split('/').length === path.split('/').length + 1)
          .filter((k) => filters.every(([f, v]) => getPath(m.get(k), f) === v)).map(snap);
        return { docs, size: docs.length, empty: !docs.length };
      },
    });
    return Object.assign(q([]), { doc: (id) => ref(path + '/' + id) });
  }
  const writer = (ops) => ({
    set: (r, d) => ops.push(() => m.set(r.path, JSON.parse(JSON.stringify(d)))),
    update: (r, d) => ops.push(() => { if (!m.has(r.path)) throw new Error('no doc ' + r.path); m.set(r.path, applyPatch(m.get(r.path), d)); }),
  });
  return {
    m,
    collection: col,
    batch() { const ops = []; return { ...writer(ops), commit: async () => ops.forEach((f) => f()) }; },
    async runTransaction(fn) {
      const ops = [];
      const tx = { get: async (r) => snap(r.path), ...writer(ops) };
      const out = await fn(tx);
      ops.forEach((f) => f());
      return out;
    },
  };
}

const T2026 = Date.UTC(2026, 5, 1), T2025 = Date.UTC(2025, 5, 1);
const inv = { id: 'num', type: 'autonumber', label: 'Invoice #', prefix: 'INV-', start: 1001, digits: 4 };
const base = (fields = [inv]) => ({
  'users/boss': { role: 'admin' },
  'users/amy': { role: 'member' },
  'forms/f_inv': { name: 'Invoices', fields: [{ id: 'title', type: 'text' }, ...fields] },
  'forms/f_other': { name: 'Other', fields: [{ id: 'title', type: 'text' }] },
});
const rec = (formId, extra = {}) => ({ formId, values: {}, ownerId: 'amy', createdBy: 'amy', createdAt: T2026, ...extra });

test('format and reading numbers back', () => {
  assert.equal(formatNumber(inv, 1001, 2026), 'INV-1001');
  assert.equal(formatNumber({ ...inv, digits: 6 }, 42, 2026), 'INV-000042');
  assert.equal(formatNumber({ ...inv, year: true, digits: 3 }, 7, 2026), 'INV-2026-007');
  assert.equal(formatNumber({ type: 'autonumber' }, 5, 2026), '5', 'no settings: plain numbers from 1');
  assert.equal(lastNumber('INV-2026-0057'), 57);
  assert.equal(lastNumber(12), 12);
  assert.equal(lastNumber('none'), null);
  assert.equal(yearOf(Date.UTC(2027, 0, 1, 3), 'America/Toronto'), 2026, 'New Year’s Eve evening in Toronto is still 2026');
});

test('new records get the next number, one at a time; other forms are left alone', async () => {
  const db = fakeDb({ ...base(), 'records/a': rec('f_inv'), 'records/b': rec('f_inv'), 'records/o': rec('f_other') });
  await assignOnCreate(db, 'a');
  await assignOnCreate(db, 'b');
  await assignOnCreate(db, 'o');
  assert.equal(db.m.get('records/a').nums.num, 'INV-1001');
  assert.equal(db.m.get('records/b').nums.num, 'INV-1002');
  assert.equal(db.m.get('records/o').nums, undefined);
  assert.equal(db.m.get('counters/f_inv__num').next, 1003);
  await assignOnCreate(db, 'a'); // runs twice (a retry): keeps its number
  assert.equal(db.m.get('records/a').nums.num, 'INV-1001');
  assert.equal(db.m.get('counters/f_inv__num').next, 1003);
});

test('with the year, numbering starts again each year', async () => {
  const f = { ...inv, year: true, start: 1, digits: 3 };
  const db = fakeDb({ ...base([f]), 'records/a': rec('f_inv', { createdAt: T2025 }), 'records/b': rec('f_inv'), 'records/c': rec('f_inv') });
  for (const id of ['a', 'b', 'c']) await assignOnCreate(db, id);
  assert.deepEqual(['a', 'b', 'c'].map((id) => db.m.get('records/' + id).nums.num), ['INV-2025-001', 'INV-2026-001', 'INV-2026-002']);
});

test('raising the start number moves numbering on; lowering it never reuses numbers', async () => {
  const db = fakeDb({ ...base(), 'counters/f_inv__num': { next: 1005 }, 'records/a': rec('f_inv') });
  db.m.get('forms/f_inv').fields[1].start = 5000;
  await assignOnCreate(db, 'a');
  assert.equal(db.m.get('records/a').nums.num, 'INV-5000');
  db.m.get('forms/f_inv').fields[1].start = 1;
  db.m.set('records/b', rec('f_inv'));
  await assignOnCreate(db, 'b');
  assert.equal(db.m.get('records/b').nums.num, 'INV-5001');
});

test('numbering existing records keeps typed numbers and carries on past the highest', async () => {
  const f = { id: 'num', type: 'autonumber', start: 1, digits: 1 };
  const db = fakeDb({
    ...base([f]),
    'records/r1': rec('f_inv', { values: { num: '1' }, createdAt: 1 }),
    'records/r2': rec('f_inv', { values: { num: 57 }, createdAt: 2 }),
    'records/r3': rec('f_inv', { values: {}, createdAt: 5 }),
    'records/r4': rec('f_inv', { values: { num: '' }, createdAt: 3 }),
    'records/r5': rec('f_inv', { values: { num: '1' }, createdAt: 4 }), // typed twice by mistake
    'records/x': rec('f_other', { values: { num: '999' } }),
  });
  const out = await fillNumbers(db, 'boss', { formId: 'f_inv', fieldId: 'num' });
  assert.deepEqual(['r1', 'r2', 'r3', 'r4', 'r5'].map((id) => db.m.get('records/' + id).nums.num), ['1', '57', '59', '58', '1'], 'blanks numbered oldest first after 57');
  assert.deepEqual([out.kept, out.numbered, out.first, out.last], [3, 2, '58', '59']);
  assert.deepEqual(out.duplicates, ['1'], 'clashing typed numbers are reported');
  assert.equal(db.m.get('records/x').nums, undefined);
  db.m.set('records/new', rec('f_inv'));
  await assignOnCreate(db, 'new');
  assert.equal(db.m.get('records/new').nums.num, '60', 'new records carry on');
  const again = await fillNumbers(db, 'boss', { formId: 'f_inv', fieldId: 'num' });
  assert.deepEqual([again.kept, again.numbered], [0, 0], 'running it again changes nothing');
});

test('only admins number existing records, and only for an Auto number field', async () => {
  const db = fakeDb({ ...base(), 'records/r1': rec('f_inv') });
  const rejects = (p, code) => assert.rejects(p, (e) => e.code === code);
  await rejects(fillNumbers(db, 'amy', { formId: 'f_inv', fieldId: 'num' }), 'permission-denied');
  await rejects(fillNumbers(db, null, { formId: 'f_inv', fieldId: 'num' }), 'unauthenticated');
  await rejects(fillNumbers(db, 'boss', { formId: 'f_inv', fieldId: 'title' }), 'failed-precondition');
  await rejects(fillNumbers(db, 'boss', {}), 'invalid-argument');
});

test('admins can change a number: unique, logged, and the counter moves past it', async () => {
  const db = fakeDb({ ...base(), 'counters/f_inv__num': { next: 1003 },
    'records/a': rec('f_inv', { nums: { num: 'INV-1001' } }), 'records/b': rec('f_inv', { nums: { num: 'INV-1002' } }), 'records/o': rec('f_other', { nums: { num: 'INV-2000' } }) });
  const rejects = (p, code) => assert.rejects(p, (e) => e.code === code);
  await rejects(setNumber(db, 'boss', { recordId: 'a', fieldId: 'num', value: 'INV-1002' }), 'already-exists');
  await rejects(setNumber(db, 'amy', { recordId: 'a', fieldId: 'num', value: 'INV-1500' }), 'permission-denied');
  await rejects(setNumber(db, 'boss', { recordId: 'a', fieldId: 'num', value: '  ' }), 'invalid-argument');
  await rejects(setNumber(db, 'boss', { recordId: 'gone', fieldId: 'num', value: 'X' }), 'not-found');
  const out = await setNumber(db, 'boss', { recordId: 'a', fieldId: 'num', value: 'INV-2000' }); // used on another form: fine
  assert.deepEqual(out, { from: 'INV-1001', to: 'INV-2000' });
  const a = db.m.get('records/a');
  assert.equal(a.nums.num, 'INV-2000');
  assert.deepEqual([a.autoLog.length, a.autoLog[0].from, a.autoLog[0].to, a.autoLog[0].by], [1, 'INV-1001', 'INV-2000', 'boss']);
  assert.equal(db.m.get('counters/f_inv__num').next, 2001, 'never handed out again');
  await setNumber(db, 'boss', { recordId: 'b', fieldId: 'num', value: 'INV-1500' });
  assert.equal(db.m.get('counters/f_inv__num').next, 2001, 'a lower number leaves the counter alone');
});
