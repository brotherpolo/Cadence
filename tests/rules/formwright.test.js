// Formwright security rules tests (forms, records, groups, accounts, uploads).
// Run from the tests folder:  npm test   (starts the emulators; needs Java 11+).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { before, after, beforeEach, describe, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { ref, uploadString, getMetadata } from 'firebase/storage';

const OWN = { view: 'own', edit: 'own' };
const ALL = { view: 'all', edit: 'all' };
const READ = { view: 'all', edit: 'none' };
const NONE = { view: 'none', edit: 'none' };

const people = {
  admin: { role: 'admin', access: {} },
  alice: { role: 'member', access: { '*': OWN } }, // field staff: mine only
  bob: { role: 'member', access: { '*': OWN } },
  olivia: { role: 'member', access: { '*': ALL } }, // office: everything
  vera: { role: 'member', access: { '*': READ } }, // viewer: read only
  ned: { role: 'member', access: { '*': NONE } }, // no access
  mixed: { role: 'member', access: { '*': NONE, f_jobs: { view: 'all', edit: 'own' } } },
};

const record = (ownerId, extra = {}) => ({
  formId: 'f_jobs',
  values: { title: 'Job' },
  parentId: null,
  parentFormId: null,
  ownerId,
  createdBy: ownerId,
  createdAt: 1,
  updatedAt: 1,
  updatedBy: ownerId,
  ...extra,
});

const rulesFile = (name) => readFileSync(fileURLToPath(new URL(`../../${name}`, import.meta.url)), 'utf8');

let env;
const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@example.com` });
const db = (uid) => as(uid).firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-cadence',
    firestore: { rules: rulesFile('firestore.rules'), host: '127.0.0.1', port: 8080 },
    storage: { rules: rulesFile('storage.rules'), host: '127.0.0.1', port: 9199 },
  });
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    for (const [uid, p] of Object.entries(people)) {
      await setDoc(doc(d, 'users', uid), { email: `${uid}@example.com`, displayName: uid, groups: [], createdAt: 1, ...p });
    }
    await setDoc(doc(d, 'forms', 'f_jobs'), { name: 'Jobs', fields: [] });
    await setDoc(doc(d, 'forms', 'f_other'), { name: 'Other', fields: [] });
    await setDoc(doc(d, 'records', 'r_alice'), record('alice'));
    await setDoc(doc(d, 'records', 'r_bob'), record('bob'));
  });
});

describe('records: view and edit mine only', () => {
  test('reads own record, not someone else’s', async () => {
    await assertSucceeds(getDoc(doc(db('alice'), 'records', 'r_alice')));
    await assertFails(getDoc(doc(db('alice'), 'records', 'r_bob')));
  });

  test('list query must filter to own records', async () => {
    const col = collection(db('alice'), 'records');
    await assertSucceeds(getDocs(query(col, where('formId', '==', 'f_jobs'), where('ownerId', '==', 'alice'))));
    await assertFails(getDocs(query(col, where('formId', '==', 'f_jobs'))));
  });

  test('creates records only as themselves', async () => {
    await assertSucceeds(setDoc(doc(db('alice'), 'records', 'r_new'), record('alice')));
    await assertFails(setDoc(doc(db('alice'), 'records', 'r_fake'), record('bob', { updatedBy: 'alice' })));
  });

  test('edits and deletes only own records', async () => {
    await assertSucceeds(updateDoc(doc(db('alice'), 'records', 'r_alice'), { values: { title: 'Changed' }, updatedBy: 'alice' }));
    await assertFails(updateDoc(doc(db('alice'), 'records', 'r_bob'), { values: { title: 'Hijack' }, updatedBy: 'alice' }));
    await assertFails(deleteDoc(doc(db('alice'), 'records', 'r_bob')));
    await assertSucceeds(deleteDoc(doc(db('alice'), 'records', 'r_alice')));
  });

  test('cannot give a record away or move it to another form', async () => {
    await assertFails(updateDoc(doc(db('alice'), 'records', 'r_alice'), { ownerId: 'bob', updatedBy: 'alice' }));
    await assertFails(updateDoc(doc(db('alice'), 'records', 'r_alice'), { formId: 'f_other', updatedBy: 'alice' }));
  });

  test('must stamp updatedBy with their own id', async () => {
    await assertFails(updateDoc(doc(db('alice'), 'records', 'r_alice'), { values: {}, updatedBy: 'bob' }));
  });
});

describe('records: view and edit all', () => {
  test('reads every record with a form query', async () => {
    await assertSucceeds(getDocs(query(collection(db('olivia'), 'records'), where('formId', '==', 'f_jobs'))));
  });

  test('edits other people’s records but keeps their ownership', async () => {
    await assertSucceeds(updateDoc(doc(db('olivia'), 'records', 'r_bob'), { values: { title: 'Fixed' }, updatedBy: 'olivia' }));
    await assertFails(updateDoc(doc(db('olivia'), 'records', 'r_bob'), { ownerId: 'olivia', updatedBy: 'olivia' }));
  });
});

describe('records: read only, mixed and none', () => {
  test('read-only member can view but not change or create', async () => {
    await assertSucceeds(getDoc(doc(db('vera'), 'records', 'r_bob')));
    await assertFails(updateDoc(doc(db('vera'), 'records', 'r_bob'), { values: {}, updatedBy: 'vera' }));
    await assertFails(setDoc(doc(db('vera'), 'records', 'r_v'), record('vera')));
  });

  test('view all, edit mine', async () => {
    await assertSucceeds(getDoc(doc(db('mixed'), 'records', 'r_bob')));
    await assertFails(updateDoc(doc(db('mixed'), 'records', 'r_bob'), { values: {}, updatedBy: 'mixed' }));
    await assertSucceeds(setDoc(doc(db('mixed'), 'records', 'r_m'), record('mixed')));
  });

  test('member with no access sees nothing', async () => {
    await assertFails(getDoc(doc(db('ned'), 'records', 'r_alice')));
    await assertFails(getDocs(query(collection(db('ned'), 'records'), where('formId', '==', 'f_jobs'))));
    await assertFails(setDoc(doc(db('ned'), 'records', 'r_n'), record('ned')));
  });

  test('records need an existing form', async () => {
    await assertFails(setDoc(doc(db('olivia'), 'records', 'r_x'), record('olivia', { formId: 'f_missing' })));
  });

  test('unknown fields are rejected', async () => {
    await assertFails(setDoc(doc(db('alice'), 'records', 'r_y'), record('alice', { isAdmin: true })));
  });

  test('signed-out visitors see nothing', async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'records', 'r_alice')));
    await assertFails(getDoc(doc(anon, 'forms', 'f_jobs')));
  });
});

describe('administrators', () => {
  test('see and edit everything', async () => {
    await assertSucceeds(getDocs(query(collection(db('admin'), 'records'), where('formId', '==', 'f_jobs'))));
    await assertSucceeds(updateDoc(doc(db('admin'), 'records', 'r_bob'), { values: {}, updatedBy: 'admin' }));
  });

  test('only admins change forms and groups', async () => {
    await assertSucceeds(getDoc(doc(db('alice'), 'forms', 'f_jobs')));
    await assertFails(updateDoc(doc(db('alice'), 'forms', 'f_jobs'), { name: 'Mine now' }));
    await assertSucceeds(updateDoc(doc(db('admin'), 'forms', 'f_jobs'), { name: 'Jobs 2' }));
    await assertFails(setDoc(doc(db('olivia'), 'groups', 'g1'), { name: 'Sneaky', access: {} }));
    await assertSucceeds(setDoc(doc(db('admin'), 'groups', 'g1'), { name: 'Office', access: { '*': ALL } }));
  });

  test('only admins change roles, groups and access', async () => {
    await assertFails(updateDoc(doc(db('alice'), 'users', 'alice'), { role: 'admin' }));
    await assertFails(updateDoc(doc(db('alice'), 'users', 'alice'), { access: { '*': ALL } }));
    await assertFails(updateDoc(doc(db('alice'), 'users', 'alice'), { groups: ['g1'] }));
    await assertSucceeds(updateDoc(doc(db('alice'), 'users', 'alice'), { displayName: 'Alice B' }));
    await assertSucceeds(updateDoc(doc(db('admin'), 'users', 'alice'), { access: { '*': ALL } }));
  });

  test('members cannot read other people’s accounts', async () => {
    await assertFails(getDoc(doc(db('alice'), 'users', 'bob')));
    await assertSucceeds(getDoc(doc(db('alice'), 'users', 'alice')));
    await assertSucceeds(getDoc(doc(db('admin'), 'users', 'bob')));
  });
});

describe('new accounts', () => {
  const fresh = (extra = {}) => ({ email: 'new@example.com', displayName: 'New', role: 'member', groups: [], access: {}, createdAt: 1, ...extra });

  test('start as members with no access', async () => {
    await assertSucceeds(setDoc(doc(db('new'), 'users', 'new'), fresh()));
  });

  test('cannot start as admin, with groups, or with access', async () => {
    await assertFails(setDoc(doc(db('new'), 'users', 'new'), fresh({ role: 'admin' })));
    await assertFails(setDoc(doc(db('new'), 'users', 'new'), fresh({ groups: ['g1'] })));
    await assertFails(setDoc(doc(db('new'), 'users', 'new'), fresh({ access: { '*': ALL } })));
  });

  test('cannot create someone else’s account', async () => {
    await assertFails(setDoc(doc(db('new'), 'users', 'other'), fresh()));
  });

  test('profiles: everyone reads, each person writes their own', async () => {
    await assertSucceeds(setDoc(doc(db('alice'), 'profiles', 'alice'), { displayName: 'Alice' }));
    await assertFails(setDoc(doc(db('alice'), 'profiles', 'bob'), { displayName: 'Not Bob' }));
    await assertSucceeds(getDoc(doc(db('bob'), 'profiles', 'alice')));
  });
});

describe('storage uploads', () => {
  const path = (formId, owner) => `uploads/${formId}/${owner}/file.txt`;

  test('upload only into your own folder, on forms you can edit', async () => {
    await assertSucceeds(uploadString(ref(as('alice').storage(), path('f_jobs', 'alice')), 'hi'));
    await assertFails(uploadString(ref(as('alice').storage(), path('f_jobs', 'bob')), 'hi'));
    await assertFails(uploadString(ref(as('vera').storage(), path('f_jobs', 'vera')), 'hi'));
    await assertFails(uploadString(ref(as('ned').storage(), path('f_jobs', 'ned')), 'hi'));
  });

  test('read follows view access', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadString(ref(ctx.storage(), path('f_jobs', 'bob')), 'hi');
    });
    await assertSucceeds(getMetadata(ref(as('vera').storage(), path('f_jobs', 'bob'))));
    await assertSucceeds(getMetadata(ref(as('bob').storage(), path('f_jobs', 'bob'))));
    await assertFails(getMetadata(ref(as('alice').storage(), path('f_jobs', 'bob'))));
    await assertFails(getMetadata(ref(as('ned').storage(), path('f_jobs', 'bob'))));
  });
});

describe('reports', () => {
  const report = (owner, extra = {}) => ({ name: 'Pipeline', ownerId: owner, shared: false, widgets: [{ id: 'w1', type: 'kpi' }], createdAt: 1, updatedAt: 1, ...extra });
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'reports', 'r_private'), report('alice'));
      await setDoc(doc(ctx.firestore(), 'reports', 'r_shared'), report('alice', { shared: true }));
    });
  });

  test('owner creates, reads, updates and deletes their own report', async () => {
    await assertSucceeds(setDoc(doc(db('bob'), 'reports', 'r_new'), report('bob')));
    await assertSucceeds(getDoc(doc(db('bob'), 'reports', 'r_new')));
    await assertSucceeds(updateDoc(doc(db('bob'), 'reports', 'r_new'), { name: 'Renamed', shared: true, updatedAt: 2 }));
    await assertSucceeds(deleteDoc(doc(db('bob'), 'reports', 'r_new')));
  });

  test('a private report is only for its owner', async () => {
    await assertSucceeds(getDoc(doc(db('alice'), 'reports', 'r_private')));
    await assertFails(getDoc(doc(db('bob'), 'reports', 'r_private')));
    await assertFails(getDocs(query(collection(db('bob'), 'reports'), where('ownerId', '==', 'alice'))));
  });

  test('a shared report is readable by members, never writable', async () => {
    await assertSucceeds(getDoc(doc(db('bob'), 'reports', 'r_shared')));
    await assertSucceeds(getDocs(query(collection(db('bob'), 'reports'), where('shared', '==', true))));
    await assertFails(updateDoc(doc(db('bob'), 'reports', 'r_shared'), { name: 'Mine now', updatedAt: 2 }));
    await assertFails(deleteDoc(doc(db('bob'), 'reports', 'r_shared')));
  });

  test('reports can’t be created for someone else or taken over', async () => {
    await assertFails(setDoc(doc(db('bob'), 'reports', 'r_fake'), report('alice')));
    await assertFails(updateDoc(doc(db('alice'), 'reports', 'r_private'), { ownerId: 'bob' }));
  });

  test('reports are shape-checked', async () => {
    await assertFails(setDoc(doc(db('bob'), 'reports', 'r_bad1'), report('bob', { name: '' })));
    await assertFails(setDoc(doc(db('bob'), 'reports', 'r_bad2'), report('bob', { extra: 1 })));
    await assertFails(setDoc(doc(db('bob'), 'reports', 'r_bad3'), report('bob', { widgets: 'no' })));
  });

  test('admins can read and remove any report; signed-out visitors nothing', async () => {
    await assertSucceeds(getDoc(doc(db('admin'), 'reports', 'r_private')));
    await assertSucceeds(deleteDoc(doc(db('admin'), 'reports', 'r_private')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'reports', 'r_shared')));
  });

  test('someone without a Formwright account sees no reports', async () => {
    await assertFails(getDoc(doc(db('stranger'), 'reports', 'r_shared')));
  });
});

describe('list views', () => {
  const lv = (owner, extra = {}) => ({
    formId: 'f_jobs', name: 'Open jobs', ownerId: owner, shared: false,
    cols: ['f:stage', 'parent'], sort: { key: 'sys:updated', dir: 'desc' }, filters: { stage: ['Open'] }, density: 'cozy',
    createdAt: 1, updatedAt: 1, ...extra,
  });
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'listViews', 'v_alice'), lv('alice'));
      await setDoc(doc(ctx.firestore(), 'listViews', 'v_team'), lv('admin', { shared: true, name: 'Team' }));
    });
  });

  test('members save, change and delete their own private views', async () => {
    await assertSucceeds(setDoc(doc(db('bob'), 'listViews', 'v_new'), lv('bob')));
    await assertSucceeds(updateDoc(doc(db('bob'), 'listViews', 'v_new'), { cols: ['f:stage'], density: 'compact', updatedAt: 2 }));
    await assertSucceeds(getDocs(query(collection(db('bob'), 'listViews'), where('ownerId', '==', 'bob'))));
    await assertSucceeds(deleteDoc(doc(db('bob'), 'listViews', 'v_new')));
  });

  test('members can’t share a view, make a form default, or touch other people’s views', async () => {
    await assertFails(setDoc(doc(db('bob'), 'listViews', 'v_s'), lv('bob', { shared: true })));
    await assertFails(setDoc(doc(db('bob'), 'listViews', 'dflt-f_jobs'), lv('bob')));
    await assertFails(setDoc(doc(db('bob'), 'listViews', 'v_fake'), lv('alice')));
    await assertFails(getDoc(doc(db('bob'), 'listViews', 'v_alice')));
    await assertFails(updateDoc(doc(db('alice'), 'listViews', 'v_alice'), { shared: true }));
    await assertFails(updateDoc(doc(db('alice'), 'listViews', 'v_alice'), { ownerId: 'bob' }));
    await assertFails(updateDoc(doc(db('alice'), 'listViews', 'v_alice'), { formId: 'f_other' }));
    await assertFails(updateDoc(doc(db('bob'), 'listViews', 'v_team'), { name: 'Mine', updatedAt: 2 }));
    await assertFails(deleteDoc(doc(db('bob'), 'listViews', 'v_team')));
  });

  test('shared views are readable by every member; admins manage them', async () => {
    await assertSucceeds(getDoc(doc(db('vera'), 'listViews', 'v_team')));
    await assertSucceeds(getDocs(query(collection(db('ned'), 'listViews'), where('shared', '==', true))));
    await assertSucceeds(setDoc(doc(db('admin'), 'listViews', 'dflt-f_jobs'), lv('admin', { shared: true, name: 'All' })));
    await assertSucceeds(updateDoc(doc(db('admin'), 'listViews', 'v_team'), { cols: [], updatedAt: 3 }));
    await assertSucceeds(deleteDoc(doc(db('admin'), 'listViews', 'v_alice')));
    await assertFails(getDoc(doc(db('stranger'), 'listViews', 'v_team')));
  });

  test('views are shape-checked', async () => {
    await assertFails(setDoc(doc(db('bob'), 'listViews', 'b1'), lv('bob', { name: '' })));
    await assertFails(setDoc(doc(db('bob'), 'listViews', 'b2'), lv('bob', { extra: 1 })));
    await assertFails(setDoc(doc(db('bob'), 'listViews', 'b3'), lv('bob', { cols: 'f:a' })));
    await assertFails(setDoc(doc(db('bob'), 'listViews', 'b4'), lv('bob', { density: 'huge' })));
    await assertFails(setDoc(doc(db('bob'), 'listViews', 'b5'), lv('bob', { sort: { key: 'x', dir: 'asc', more: 1 } })));
  });
});

describe('bulk record changes', () => {
  test('a batch of deletes goes through only when every record may be deleted', async () => {
    const d = db('olivia');
    const ok = writeBatch(d);
    ok.delete(doc(d, 'records', 'r_alice'));
    ok.delete(doc(d, 'records', 'r_bob'));
    await assertSucceeds(ok.commit());
  });

  test('one record you can’t edit fails the whole batch', async () => {
    const d = db('alice');
    const b = writeBatch(d);
    b.delete(doc(d, 'records', 'r_alice'));
    b.delete(doc(d, 'records', 'r_bob'));
    await assertFails(b.commit());
    await assertSucceeds(getDoc(doc(d, 'records', 'r_alice')));
  });

  test('setting one field on many records keeps owner and creator', async () => {
    const d = db('olivia');
    const b = writeBatch(d);
    b.update(doc(d, 'records', 'r_alice'), { 'values.stage': 'Done', updatedAt: 5, updatedBy: 'olivia' });
    b.update(doc(d, 'records', 'r_bob'), { 'values.stage': 'Done', updatedAt: 5, updatedBy: 'olivia' });
    await assertSucceeds(b.commit());
    const v = db('vera');
    await assertFails(updateDoc(doc(v, 'records', 'r_alice'), { 'values.stage': 'Open', updatedAt: 6, updatedBy: 'vera' }));
  });
});

describe('saved reports and dashboards', () => {
  const rdef = (owner, extra = {}) => ({ name: 'Spend by client', ownerId: owner, shared: false, groups: [], def: { form: 'f_jobs', type: 'bar', measure: { fn: 'count' } }, createdAt: 1, updatedAt: 1, ...extra });
  const dash = (owner, extra = {}) => ({ name: 'Operations', ownerId: owner, shared: false, groups: [], tiles: [{ id: 't1', report: 'r1', cols: 6, rows: 2 }], filters: { period: 'all', fields: [] }, createdAt: 1, updatedAt: 1, ...extra });
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const d = ctx.firestore();
      await setDoc(doc(d, 'reportDefs', 'rd_alice'), rdef('alice'));
      await setDoc(doc(d, 'reportDefs', 'rd_team'), rdef('admin', { shared: true }));
      await setDoc(doc(d, 'dashboards', 'db_alice'), dash('alice'));
      await setDoc(doc(d, 'dashboards', 'db_team'), dash('admin', { shared: true, groups: ['g_office'] }));
    });
  });

  test('members build their own reports and dashboards', async () => {
    await assertSucceeds(setDoc(doc(db('bob'), 'reportDefs', 'rd_new'), rdef('bob')));
    await assertSucceeds(updateDoc(doc(db('bob'), 'reportDefs', 'rd_new'), { name: 'Renamed', updatedAt: 2 }));
    await assertSucceeds(setDoc(doc(db('bob'), 'dashboards', 'db_new'), dash('bob')));
    await assertSucceeds(updateDoc(doc(db('bob'), 'dashboards', 'db_new'), { tiles: [], updatedAt: 2 }));
    await assertSucceeds(getDocs(query(collection(db('bob'), 'dashboards'), where('ownerId', '==', 'bob'))));
    await assertSucceeds(deleteDoc(doc(db('bob'), 'reportDefs', 'rd_new')));
    await assertSucceeds(deleteDoc(doc(db('bob'), 'dashboards', 'db_new')));
  });

  test('only admins share; members can’t read or change others’ private ones', async () => {
    await assertFails(setDoc(doc(db('bob'), 'reportDefs', 'rd_s'), rdef('bob', { shared: true })));
    await assertFails(updateDoc(doc(db('alice'), 'dashboards', 'db_alice'), { shared: true }));
    await assertFails(getDoc(doc(db('bob'), 'reportDefs', 'rd_alice')));
    await assertFails(getDoc(doc(db('bob'), 'dashboards', 'db_alice')));
    await assertFails(setDoc(doc(db('bob'), 'dashboards', 'db_fake'), dash('alice')));
    await assertFails(updateDoc(doc(db('alice'), 'reportDefs', 'rd_alice'), { ownerId: 'bob' }));
  });

  test('shared ones are readable by members, managed by admins', async () => {
    await assertSucceeds(getDoc(doc(db('ned'), 'dashboards', 'db_team')));
    await assertSucceeds(getDocs(query(collection(db('vera'), 'reportDefs'), where('shared', '==', true))));
    await assertFails(updateDoc(doc(db('bob'), 'reportDefs', 'rd_team'), { name: 'Mine', updatedAt: 2 }));
    await assertFails(deleteDoc(doc(db('bob'), 'dashboards', 'db_team')));
    await assertSucceeds(setDoc(doc(db('admin'), 'dashboards', 'db_adm'), dash('admin', { shared: true })));
    await assertSucceeds(updateDoc(doc(db('admin'), 'dashboards', 'db_team'), { groups: [], updatedAt: 3 }));
    await assertSucceeds(deleteDoc(doc(db('admin'), 'reportDefs', 'rd_alice')));
    await assertFails(getDoc(doc(db('stranger'), 'dashboards', 'db_team')));
  });

  test('shape checks', async () => {
    await assertFails(setDoc(doc(db('bob'), 'reportDefs', 'b1'), rdef('bob', { def: 'bar' })));
    await assertFails(setDoc(doc(db('bob'), 'reportDefs', 'b2'), rdef('bob', { extra: 1 })));
    await assertFails(setDoc(doc(db('bob'), 'dashboards', 'b3'), dash('bob', { tiles: 'x' })));
    await assertFails(setDoc(doc(db('bob'), 'dashboards', 'b4'), dash('bob', { name: '' })));
  });

  test('home dashboard is kept on your own profile', async () => {
    await assertSucceeds(setDoc(doc(db('bob'), 'profiles', 'bob'), { displayName: 'Bob', homeDashboard: 'db_team' }));
    await assertSucceeds(setDoc(doc(db('bob'), 'profiles', 'bob'), { homeDashboard: '' }, { merge: true }));
    await assertFails(setDoc(doc(db('bob'), 'profiles', 'alice'), { displayName: 'A', homeDashboard: 'x' }));
    await assertFails(setDoc(doc(db('bob'), 'profiles', 'bob'), { displayName: 'Bob', homeDashboard: 'x'.repeat(101) }));
  });
});
