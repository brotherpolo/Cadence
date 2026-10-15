// Removing a person (functions/remove.js), against a small in-memory stand-in for Firestore.
// Run from tests/: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const { removeAccount } = require('../../functions/remove.js');

function fakeDb(seed) {
  const m = new Map(Object.entries(seed));
  const snap = (path) => ({ id: path.split('/').pop(), exists: m.has(path), ref: ref(path), data: () => m.get(path), get: (k) => (m.get(path) || {})[k] });
  function ref(path) {
    return { path, id: path.split('/').pop(), get: async () => snap(path), collection: (c) => col(path + '/' + c) };
  }
  function col(path) {
    const q = (filters, lim) => ({
      where: (f, op, v) => q(filters.concat([[f, v]]), lim),
      limit: (n) => q(filters, n),
      get: async () => {
        let docs = [...m.keys()].filter((k) => k.startsWith(path + '/') && k.split('/').length === path.split('/').length + 1)
          .filter((k) => filters.every(([f, v]) => (m.get(k) || {})[f] === v)).map(snap);
        if (lim) docs = docs.slice(0, lim);
        return { docs, size: docs.length, empty: !docs.length };
      },
    });
    return Object.assign(q([], 0), { doc: (id) => ref(path + '/' + id) });
  }
  return {
    m,
    collection: col,
    batch() {
      const ops = [];
      return {
        set: (r, d) => ops.push(() => m.set(r.path, { ...d })),
        update: (r, d) => ops.push(() => { if (!m.has(r.path)) throw new Error('no doc ' + r.path); m.set(r.path, { ...m.get(r.path), ...d }); }),
        delete: (r) => ops.push(() => m.delete(r.path)),
        commit: async () => ops.forEach((f) => f()),
      };
    },
  };
}
const fakeAuth = () => { const gone = []; return { gone, deleteUser: async (uid) => { gone.push(uid); } }; };

const seed = () => ({
  'users/boss': { role: 'admin', email: 'boss@x.com' },
  'users/jane': { role: 'member', email: 'jane@x.com', displayName: 'Jane Smith', groups: ['g1'] },
  'users/amy': { role: 'member', email: 'amy@x.com' },
  'users/jane/items/settings': { kind: 'settings' },
  'users/jane/items/board': { kind: 'board' },
  'profiles/jane': { displayName: 'Jane Smith', homeDashboard: 'd1' },
  'people/jane@x.com': { uid: 'jane', name: 'Jane' },
  'notify/jane': { kind: 'notify' },
  'notify/jane/devices/p1': { token: 't' },
  'notifyState/jane': { lastCheck: 1 },
  'records/r1': { formId: 'f', ownerId: 'jane', createdBy: 'jane' },
  'records/r2': { formId: 'f', ownerId: 'jane', createdBy: 'jane' },
  'records/r3': { formId: 'f', ownerId: 'amy', createdBy: 'amy' },
  'tasks/t1': { ownerId: 'jane', members: ['jane'] },
  'tasks/t2': { ownerId: 'boss', assigneeId: 'jane', assigneeName: 'Jane', assigneeEmail: 'jane@x.com', members: ['boss', 'jane'] },
  'reportDefs/rp1': { ownerId: 'jane', shared: false },
  'dashboards/d1': { ownerId: 'jane', shared: true },
  'listViews/v1': { ownerId: 'jane', shared: false },
});

test('an admin removes a person: account gone, name kept, tasks tidied', async () => {
  const db = fakeDb(seed()), auth = fakeAuth();
  const out = await removeAccount(db, auth, 'boss', { uid: 'jane' });
  const m = db.m;
  assert.deepEqual(auth.gone, ['jane']);
  for (const p of ['users/jane', 'users/jane/items/settings', 'users/jane/items/board', 'people/jane@x.com', 'notify/jane', 'notify/jane/devices/p1', 'notifyState/jane', 'tasks/t1', 'reportDefs/rp1', 'listViews/v1']) assert.equal(m.has(p), false, p + ' deleted');
  assert.deepEqual({ ...m.get('profiles/jane'), removedAt: 0 }, { displayName: 'Jane Smith', removed: true, removedAt: 0, removedBy: 'boss' });
  assert.equal(m.get('records/r1').ownerId, 'jane', 'records kept as they were');
  const t2 = m.get('tasks/t2');
  assert.deepEqual([t2.assigneeId, t2.assigneeEmail, t2.members], [null, null, ['boss']], 'assigned task handed back');
  assert.equal(m.get('dashboards/d1').ownerId, 'boss', 'shared dashboard passes to the admin');
  assert.deepEqual([out.tasksDeleted, out.tasksReturned, out.records, out.shared, out.name], [1, 1, 0, 1, 'Jane Smith']);
});

test('records can be given to someone while removing', async () => {
  const db = fakeDb(seed());
  const out = await removeAccount(db, fakeAuth(), 'boss', { uid: 'jane', giveTo: 'amy' });
  assert.equal(out.records, 2);
  assert.equal(db.m.get('records/r1').ownerId, 'amy');
  assert.equal(db.m.get('records/r1').createdBy, 'jane', 'who created it stays as history');
  assert.equal(db.m.get('records/r3').ownerId, 'amy');
});

test('only admins; never yourself; never the last admin; giveTo must exist', async () => {
  const rejects = async (p, code) => { await assert.rejects(p, (e) => e.code === code); };
  await rejects(removeAccount(fakeDb(seed()), fakeAuth(), 'amy', { uid: 'jane' }), 'permission-denied');
  await rejects(removeAccount(fakeDb(seed()), fakeAuth(), 'boss', { uid: 'boss' }), 'failed-precondition');
  const s = seed(); s['users/jane'].role = 'admin';
  const db = fakeDb(s);
  await removeAccount(db, fakeAuth(), 'boss', { uid: 'jane' }); // two admins: fine
  const s2 = seed(); s2['users/boss2'] = { role: 'member' };
  await rejects(removeAccount(fakeDb(s2), fakeAuth(), 'boss2', { uid: 'boss' }), 'permission-denied');
  await rejects(removeAccount(fakeDb(seed()), fakeAuth(), 'boss', { uid: 'jane', giveTo: 'ghost' }), 'not-found');
  await rejects(removeAccount(fakeDb(seed()), fakeAuth(), null, { uid: 'jane' }), 'unauthenticated');
  await rejects(removeAccount(fakeDb(seed()), fakeAuth(), 'boss', {}), 'invalid-argument');
});

test('an admin can remove another admin (there are always two: the caller and them)', async () => {
  const db = fakeDb({ 'users/boss': { role: 'admin' }, 'users/root': { role: 'admin' } });
  await removeAccount(db, fakeAuth(), 'root', { uid: 'boss' });
  assert.equal(db.m.has('users/boss'), false);
  assert.equal(db.m.get('users/root').role, 'admin');
});

test('a sign-in already gone is fine', async () => {
  const db = fakeDb(seed());
  const auth = { deleteUser: async () => { const e = new Error('x'); e.code = 'auth/user-not-found'; throw e; } };
  await removeAccount(db, auth, 'boss', { uid: 'jane' });
  assert.equal(db.m.has('users/jane'), false);
});
