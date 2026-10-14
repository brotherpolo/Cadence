// Cadence security rules tests: tasks, sharing, record links, the people directory,
// private items and push settings.
// Run from the tests folder:  npm test   (starts the emulators; needs Java 11+).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { before, after, beforeEach, describe, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs } from 'firebase/firestore';

const rulesFile = (name) => readFileSync(fileURLToPath(new URL(`../../${name}`, import.meta.url)), 'utf8');

const NONE = { view: 'none', edit: 'none' };
const READ = { view: 'all', edit: 'none' };
const OWN = { view: 'own', edit: 'own' };

// Cadence people. owen owns tasks; bob is his assignee; nora uses Cadence but has no Formwright access.
// In Formwright: owen can see every Clients record and nothing else; bob has no access;
// mia sees only Clients records she created; admin sees everything.
// Cadence is by approval (cadence: true): stan signed up but isn't approved yet.
const accounts = {
  admin: { role: 'admin', access: {} },
  owen: { role: 'member', access: { '*': NONE, f_clients: READ }, cadence: true },
  bob: { role: 'member', access: { '*': NONE }, cadence: true },
  mia: { role: 'member', access: { '*': NONE, f_clients: OWN }, cadence: true },
  nora: { role: 'member', access: {}, cadence: true },
  stan: { role: 'member', access: {} },
};

const email = (uid) => `${uid}@example.com`;

let env;
const as = (uid) => env.authenticatedContext(uid, { email: email(uid), email_verified: true });
const db = (uid) => as(uid).firestore();

const task = (id, owner, extra = {}) => ({
  id,
  title: 'Call the client',
  done: false,
  ownerId: owner,
  ownerName: owner,
  ownerEmail: email(owner),
  members: [owner],
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

const assignedTo = (assignee) => ({
  assigneeId: assignee,
  assigneeName: assignee,
  assigneeEmail: email(assignee),
});

const link = (recordId, formId = 'f_clients', title = 'Acme Corp') => ({
  recordId,
  formId,
  recordSnap: { title, form: 'Clients', color: 'blue' },
});

const record = (formId, ownerId) => ({
  formId,
  values: { name: 'Acme Corp' },
  parentId: null,
  parentFormId: null,
  ownerId,
  createdBy: ownerId,
  createdAt: 1,
  updatedAt: 1,
  updatedBy: ownerId,
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-cadence',
    firestore: { rules: rulesFile('firestore.rules'), host: '127.0.0.1', port: 8080 },
  });
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    for (const [uid, a] of Object.entries(accounts)) {
      await setDoc(doc(d, 'users', uid), { email: email(uid), displayName: uid, groups: [], createdAt: 1, ...a });
    }
    for (const uid of ['owen', 'bob', 'nora']) {
      await setDoc(doc(d, 'people', email(uid)), { uid, name: uid });
    }
    await setDoc(doc(d, 'forms', 'f_clients'), { name: 'Clients', fields: [] });
    await setDoc(doc(d, 'forms', 'f_hr'), { name: 'HR', fields: [] });
    await setDoc(doc(d, 'records', 'r_acme'), record('f_clients', 'admin'));
    await setDoc(doc(d, 'records', 'r_globex'), record('f_clients', 'admin'));
    await setDoc(doc(d, 'records', 'r_secret'), record('f_hr', 'admin'));
    await setDoc(doc(d, 'records', 'r_mia'), record('f_clients', 'mia'));
    // an existing task of owen's, assigned to bob, linked to Acme
    await setDoc(doc(d, 'tasks', 't_shared'), task('t_shared', 'owen', {
      ...assignedTo('bob'), members: ['owen', 'bob'], repeat: 'weekly', due: '2026-10-12', ...link('r_acme'),
    }));
  });
});

describe('tasks: owner and assignee (unchanged from v21)', () => {
  test('owner creates and reads their own task; strangers see nothing', async () => {
    await assertSucceeds(setDoc(doc(db('owen'), 'tasks', 't1'), task('t1', 'owen')));
    await assertSucceeds(getDoc(doc(db('owen'), 'tasks', 't1')));
    await assertFails(getDoc(doc(db('nora'), 'tasks', 't1')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'tasks', 't1')));
  });

  test('owner email must be the owner’s own sign-in email', async () => {
    await assertFails(setDoc(doc(db('owen'), 'tasks', 't1'), task('t1', 'owen', { ownerEmail: email('bob') })));
  });

  test('can assign only to the account that claimed that email', async () => {
    await assertSucceeds(setDoc(doc(db('owen'), 'tasks', 't1'), task('t1', 'owen', { ...assignedTo('bob'), members: ['owen', 'bob'] })));
    await assertFails(setDoc(doc(db('owen'), 'tasks', 't2'), task('t2', 'owen', {
      ...assignedTo('bob'), assigneeId: 'nora', members: ['owen', 'nora'],
    })));
  });

  test('assignee completes and reschedules, but can’t rename', async () => {
    const ref = doc(db('bob'), 'tasks', 't_shared');
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(updateDoc(ref, { done: true, doneAt: 2, doneBy: 'bob', updatedAt: 2 }));
    await assertSucceeds(updateDoc(ref, { due: '2026-10-20', moved: 1, pushed: 8, updatedAt: 3 }));
    await assertFails(updateDoc(ref, { title: 'Renamed', updatedAt: 4 }));
  });

  test('assignee can hand the task back', async () => {
    await assertSucceeds(updateDoc(doc(db('bob'), 'tasks', 't_shared'), {
      assigneeId: null, assigneeName: null, assigneeEmail: null, members: ['owen'], updatedAt: 2,
    }));
  });

  test('only the owner deletes', async () => {
    await assertFails(deleteDoc(doc(db('bob'), 'tasks', 't_shared')));
    await assertSucceeds(deleteDoc(doc(db('owen'), 'tasks', 't_shared')));
  });

  test('unknown task fields are rejected', async () => {
    await assertFails(setDoc(doc(db('owen'), 'tasks', 't1'), task('t1', 'owen', { secret: true })));
  });
});

describe('record links: setting them', () => {
  test('owner links a new task to a record they can see', async () => {
    await assertSucceeds(setDoc(doc(db('owen'), 'tasks', 't1'), task('t1', 'owen', link('r_acme'))));
  });

  test('owner adds, changes and clears a link on an existing task', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'tasks', 't1'), task('t1', 'owen')));
    const ref = doc(db('owen'), 'tasks', 't1');
    await assertSucceeds(updateDoc(ref, link('r_acme')));
    await assertSucceeds(updateDoc(ref, link('r_globex', 'f_clients', 'Globex')));
    await assertSucceeds(updateDoc(ref, { recordId: null, formId: null, recordSnap: null }));
  });

  test('can’t link to a record in a form they can’t see', async () => {
    await assertFails(setDoc(doc(db('owen'), 'tasks', 't1'), task('t1', 'owen', link('r_secret', 'f_hr', 'Salaries'))));
  });

  test('"own" access: only records you created', async () => {
    await assertSucceeds(setDoc(doc(db('mia'), 'tasks', 't1'), task('t1', 'mia', link('r_mia'))));
    await assertFails(setDoc(doc(db('mia'), 'tasks', 't2'), task('t2', 'mia', link('r_acme'))));
  });

  test('someone who never opened Formwright can’t link records', async () => {
    await assertFails(setDoc(doc(db('nora'), 'tasks', 't1'), task('t1', 'nora', link('r_acme'))));
  });

  test('admins can link any record', async () => {
    await assertSucceeds(setDoc(doc(db('admin'), 'tasks', 't1'), task('t1', 'admin', link('r_secret', 'f_hr', 'Salaries'))));
  });

  test('the form must match the record’s form', async () => {
    await assertFails(setDoc(doc(db('owen'), 'tasks', 't1'), task('t1', 'owen', link('r_acme', 'f_hr'))));
  });

  test('a missing record can’t be linked', async () => {
    await assertFails(setDoc(doc(db('owen'), 'tasks', 't1'), task('t1', 'owen', link('r_gone'))));
  });

  test('link fields come together, in the right shape', async () => {
    await assertFails(setDoc(doc(db('owen'), 'tasks', 't1'), task('t1', 'owen', { recordId: 'r_acme' })));
    await assertFails(setDoc(doc(db('owen'), 'tasks', 't2'), task('t2', 'owen', { formId: 'f_clients' })));
    await assertFails(setDoc(doc(db('owen'), 'tasks', 't3'), task('t3', 'owen', {
      ...link('r_acme'), recordSnap: { title: 'Acme', form: 'Clients', color: 'blue', extra: 1 },
    })));
    await assertFails(setDoc(doc(db('owen'), 'tasks', 't4'), task('t4', 'owen', {
      recordSnap: { title: 'Acme', form: 'Clients', color: 'blue' },
    })));
  });

  test('owner can refresh the copied title without re-checking access', async () => {
    await assertSucceeds(updateDoc(doc(db('owen'), 'tasks', 't_shared'), {
      recordSnap: { title: 'Acme Corporation', form: 'Clients', color: 'blue' }, updatedAt: 2,
    }));
  });
});

describe('record links: assignees and repeats', () => {
  test('assignee sees the link but can’t change or remove it', async () => {
    const ref = doc(db('bob'), 'tasks', 't_shared');
    const snap = await assertSucceeds(getDoc(ref));
    if (snap.data().recordSnap.title !== 'Acme Corp') throw new Error('assignee should see the copied title');
    await assertFails(updateDoc(ref, link('r_globex', 'f_clients', 'Globex')));
    await assertFails(updateDoc(ref, { recordId: null, formId: null, recordSnap: null }));
    await assertFails(updateDoc(ref, { recordSnap: { title: 'Changed', form: 'Clients', color: 'blue' } }));
  });

  test('assignee’s next occurrence keeps the same link', async () => {
    const next = task('t_next', 'owen', {
      ...assignedTo('bob'), members: ['owen', 'bob'], repeat: 'weekly', due: '2026-10-19',
      spawnedFrom: 't_shared', ...link('r_acme'),
    });
    await assertSucceeds(setDoc(doc(db('bob'), 'tasks', 't_next'), next));
  });

  test('assignee’s next occurrence can’t carry a different link', async () => {
    const next = task('t_next', 'owen', {
      ...assignedTo('bob'), members: ['owen', 'bob'], repeat: 'weekly', due: '2026-10-19',
      spawnedFrom: 't_shared', ...link('r_secret', 'f_hr', 'Salaries'),
    });
    await assertFails(setDoc(doc(db('bob'), 'tasks', 't_next'), next));
  });

  test('owner’s next occurrence saves even after the record was deleted', async () => {
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), 'records', 'r_acme')));
    const next = task('t_next', 'owen', {
      ...assignedTo('bob'), members: ['owen', 'bob'], repeat: 'weekly', due: '2026-10-19',
      spawnedFrom: 't_shared', ...link('r_acme'),
    });
    await assertSucceeds(setDoc(doc(db('owen'), 'tasks', 't_next'), next));
  });

  test('after a record is deleted, its tasks stay editable but can’t be relinked to it', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'tasks', 't1'), task('t1', 'owen', link('r_globex', 'f_clients', 'Globex')));
      await deleteDoc(doc(ctx.firestore(), 'records', 'r_acme'));
    });
    await assertSucceeds(updateDoc(doc(db('owen'), 'tasks', 't_shared'), { title: 'Still here', updatedAt: 2 }));
    await assertSucceeds(updateDoc(doc(db('bob'), 'tasks', 't_shared'), { done: true, doneAt: 2, doneBy: 'bob', updatedAt: 2 }));
    await assertFails(updateDoc(doc(db('owen'), 'tasks', 't1'), link('r_acme')));
  });
});

describe('record links: the Tasks panel query', () => {
  test('lists tasks you’re in for one record, and nobody else’s', async () => {
    const q = (uid) => query(collection(db(uid), 'tasks'), where('members', 'array-contains', uid), where('recordId', '==', 'r_acme'));
    const owen = await assertSucceeds(getDocs(q('owen')));
    const bob = await assertSucceeds(getDocs(q('bob')));
    if (owen.size !== 1 || bob.size !== 1) throw new Error('owner and assignee should each see the linked task');
    const nora = await assertSucceeds(getDocs(q('nora')));
    if (nora.size !== 0) throw new Error('nora is not on the task');
    await assertFails(getDocs(query(collection(db('nora'), 'tasks'), where('recordId', '==', 'r_acme'))));
  });
});

describe('people directory', () => {
  test('look up one email, never list', async () => {
    await assertSucceeds(getDoc(doc(db('owen'), 'people', email('bob'))));
    await assertFails(getDocs(collection(db('owen'), 'people')));
  });

  test('claim only your own verified email', async () => {
    await assertSucceeds(setDoc(doc(db('owen'), 'people', email('owen')), { uid: 'owen', name: 'Owen' }));
    await assertFails(setDoc(doc(db('owen'), 'people', email('bob')), { uid: 'owen', name: 'Not Bob' }));
    const unverified = env.authenticatedContext('zed', { email: email('zed'), email_verified: false }).firestore();
    await assertFails(setDoc(doc(unverified, 'people', email('zed')), { uid: 'zed', name: 'Zed' }));
  });
});

describe('Cadence is by approval', () => {
  test('an account that isn’t approved can’t use any Cadence data', async () => {
    await assertFails(setDoc(doc(db('stan'), 'tasks', 'ts'), task('ts', 'stan')));
    await assertFails(getDocs(query(collection(db('stan'), 'tasks'), where('members', 'array-contains', 'stan'))));
    await assertFails(getDoc(doc(db('stan'), 'people', email('owen'))));
    await assertFails(setDoc(doc(db('stan'), 'people', email('stan')), { uid: 'stan', name: 'Stan' }));
    await assertFails(setDoc(doc(db('stan'), 'users', 'stan', 'items', 'settings'), { kind: 'settings', types: [], levels: [{ id: 'l1' }] }));
    await assertFails(setDoc(doc(db('stan'), 'notify', 'stan'), { kind: 'notify', due: true }));
  });

  test('no account record at all: no Cadence', async () => {
    await assertFails(setDoc(doc(db('ghost'), 'tasks', 'tg'), task('tg', 'ghost')));
    await assertFails(getDoc(doc(db('ghost'), 'people', email('owen'))));
  });

  test('nobody approves themselves', async () => {
    await assertFails(updateDoc(doc(db('stan'), 'users', 'stan'), { cadence: true }));
    await assertFails(setDoc(doc(db('newbie'), 'users', 'newbie'), { email: email('newbie'), displayName: 'N', role: 'member', groups: [], access: {}, createdAt: 1, cadence: true }));
    // the plain starting record Cadence makes on first sign-in is allowed
    await assertSucceeds(setDoc(doc(db('newbie'), 'users', 'newbie'), { email: email('newbie'), displayName: 'N', role: 'member', groups: [], access: {}, createdAt: 1 }));
  });

  test('an admin approves, and the account can then use Cadence', async () => {
    await assertSucceeds(updateDoc(doc(db('admin'), 'users', 'stan'), { cadence: true }));
    await assertSucceeds(setDoc(doc(db('stan'), 'tasks', 'ts'), task('ts', 'stan')));
    await assertSucceeds(getDoc(doc(db('stan'), 'tasks', 'ts')));
  });

  test('admins can always use Cadence', async () => {
    await assertSucceeds(setDoc(doc(db('admin'), 'tasks', 'ta'), task('ta', 'admin')));
  });

  test('taking approval away stops reading, even your own tasks', async () => {
    await assertSucceeds(updateDoc(doc(db('admin'), 'users', 'owen'), { cadence: false }));
    await assertFails(getDoc(doc(db('owen'), 'tasks', 't_shared')));
  });
});

describe('private items and push settings', () => {
  const settings = { kind: 'settings', types: [], levels: [{ id: 'l1' }] };

  test('settings, map and board are private to their owner', async () => {
    await assertSucceeds(setDoc(doc(db('owen'), 'users', 'owen', 'items', 'settings'), settings));
    await assertSucceeds(setDoc(doc(db('owen'), 'users', 'owen', 'items', 'map'), { kind: 'map', nodes: [], edges: [] }));
    await assertSucceeds(setDoc(doc(db('owen'), 'users', 'owen', 'items', 'board'), { kind: 'board', charts: [] }));
    await assertFails(getDoc(doc(db('bob'), 'users', 'owen', 'items', 'settings')));
    await assertFails(getDoc(doc(db('admin'), 'users', 'owen', 'items', 'map')));
    await assertFails(setDoc(doc(db('owen'), 'users', 'owen', 'items', 'other'), { kind: 'other' }));
  });

  test('the board can hold dashboards and a home dashboard, nothing else', async () => {
    const ref = doc(db('owen'), 'users', 'owen', 'items', 'board');
    const dash = { id: 'd1', name: 'My week', tiles: [{ id: 't1', chart: 'ch1', x: 0, y: 0, w: 12, h: 9 }, { id: 't2', text: { title: 'Notes', body: '' }, x: 12, y: 0, w: 12, h: 2 }] };
    await assertSucceeds(setDoc(ref, { kind: 'board', charts: [{ id: 'ch1', type: 'bar' }], dashboards: [dash], home: 'd1', updatedAt: 2 }));
    await assertFails(setDoc(ref, { kind: 'board', charts: [], dashboards: 'not a list' }));
    await assertFails(setDoc(ref, { kind: 'board', charts: [], home: 5 }));
    await assertFails(setDoc(ref, { kind: 'board', charts: [], dashboards: [], secret: true }));
    await assertFails(setDoc(ref, { kind: 'board', charts: [], dashboards: Array.from({ length: 101 }, (_, i) => ({ id: 'd' + i })) }));
  });

  test('Formwright admins can read accounts but not Cadence’s private items', async () => {
    await assertSucceeds(getDoc(doc(db('admin'), 'users', 'owen')));
    await assertFails(getDoc(doc(db('admin'), 'users', 'owen', 'items', 'board')));
  });

  test('push settings and devices are private', async () => {
    await assertSucceeds(setDoc(doc(db('owen'), 'notify', 'owen'), { kind: 'notify', due: true, tz: 'America/Toronto' }));
    await assertSucceeds(setDoc(doc(db('owen'), 'notify', 'owen', 'devices', 'd1'), { token: 'abc', label: 'Phone', createdAt: 1 }));
    await assertFails(getDoc(doc(db('bob'), 'notify', 'owen')));
    await assertFails(getDoc(doc(db('bob'), 'notify', 'owen', 'devices', 'd1')));
  });

  test('every other path is closed', async () => {
    await assertFails(setDoc(doc(db('owen'), 'anything', 'x'), { a: 1 }));
    await assertFails(getDoc(doc(db('admin'), 'anything', 'x')));
  });
});
