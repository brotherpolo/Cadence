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
  ned: { role: 'member', access: { '*': NONE }, roles: ['r_acc'] }, // no access (but holds the Accounts role)
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
      // everyone except ned (a brand-new account) is in a group
      await setDoc(doc(d, 'users', uid), { email: `${uid}@example.com`, displayName: uid, groups: uid === 'ned' || uid === 'admin' ? [] : ['g_staff'], createdAt: 1, ...p });
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

  test('administrators give a record to another real account', async () => {
    await assertSucceeds(updateDoc(doc(db('admin'), 'records', 'r_bob'), { ownerId: 'alice', updatedBy: 'admin' }));
    await assertFails(updateDoc(doc(db('admin'), 'records', 'r_alice'), { ownerId: 'nobody_here', updatedBy: 'admin' }));
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
    // a Google account photo: https only
    await assertSucceeds(setDoc(doc(db('alice'), 'profiles', 'alice'), { displayName: 'Alice', photoURL: 'https://lh3.googleusercontent.com/a/x=s96-c' }));
    await assertFails(setDoc(doc(db('alice'), 'profiles', 'alice'), { displayName: 'Alice', photoURL: 'javascript:alert(1)' }));
    await assertFails(setDoc(doc(db('alice'), 'profiles', 'alice'), { displayName: 'Alice', photoURL: 42 }));
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

describe('automations', () => {
  const auto = (by, extra = {}) => ({ name: 'Chase invoices', formId: 'f_jobs', on: true, trigger: { type: 'changed' }, join: 'all', conds: [], acts: [{ do: 'task', title: 'x' }], createdBy: by, createdAt: 1, updatedAt: 1, updatedBy: by, ...extra });
  test('admins only; created as themselves; runs are written by the server', async () => {
    await assertSucceeds(setDoc(doc(db('admin'), 'automations', 'a1'), auto('admin')));
    await assertFails(setDoc(doc(db('admin'), 'automations', 'a2'), auto('alice')));
    await assertFails(setDoc(doc(db('olivia'), 'automations', 'a3'), auto('olivia')));
    await assertFails(getDoc(doc(db('olivia'), 'automations', 'a1')));
    await assertFails(setDoc(doc(db('admin'), 'automations', 'a4'), auto('admin', { trigger: { type: 'whenever' } })));
    await assertFails(setDoc(doc(db('admin'), 'automations', 'a1', 'runs', 'r1'), { at: 1 }));
  });
  test('records: the automation marker is the server’s', async () => {
    await assertFails(setDoc(doc(db('alice'), 'records', 'r_auto'), record('alice', { auto: { depth: 1 } })));
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'records', 'r_alice'), record('alice', { auto: { depth: 1, id: 'a1' } })); });
    await assertSucceeds(updateDoc(doc(db('alice'), 'records', 'r_alice'), { values: { title: 'Edited' }, updatedBy: 'alice' }));
    await assertFails(updateDoc(doc(db('alice'), 'records', 'r_alice'), { auto: null, updatedBy: 'alice' }));
  });
});

describe('workflows', () => {
  const move = (uid, id, patch, entry = {}) => { const d = db(uid); const b = writeBatch(d); b.update(doc(d, 'records', id), { ...patch, updatedBy: uid, updatedAt: 2 }); b.set(doc(collection(d, 'records', id, 'stages')), { at: 2, by: uid, from: 's1', to: 's2', label: 'Next', comment: '', ...entry }); return b.commit(); };
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'records', 'r_wf'), record('alice', { stage: 's1', assignee: 'bob', assigneeGroup: null, stageAt: 1 }));
      await setDoc(doc(ctx.firestore(), 'records', 'r_grp'), record('alice', { stage: 's1', assignee: null, assigneeGroup: 'g_staff', stageAt: 1 }));
      await setDoc(doc(ctx.firestore(), 'records', 'r_role'), record('alice', { stage: 's1', assignee: null, assigneeGroup: null, assigneeRole: 'r_acc', stageAt: 1 }));
    });
  });
  test('roles: anyone holding the role can see and move it, credited as the role; others can’t claim it', async () => {
    await assertSucceeds(getDoc(doc(db('ned'), 'records', 'r_role')));
    await assertSucceeds(getDocs(query(collection(db('ned'), 'records'), where('assigneeRole', '==', 'r_acc'))));
    await assertFails(updateDoc(doc(db('olivia'), 'records', 'r_role'), { values: { title: 'x' }, updatedBy: 'olivia' }));
    await assertFails(move('olivia', 'r_wf', { stage: 's3', assignee: 'alice', stageAt: 2 }, { asRole: 'r_acc', asRoleName: 'Accounts' }));
    await assertSucceeds(move('ned', 'r_role', { stage: 's2', assignee: null, assigneeRole: 'r_acc', stageAt: 2 }, { asRole: 'r_acc', asRoleName: 'Accounts', assigneeRole: 'r_acc', assigneeRoleName: 'Accounts' }));
  });
  test('roles: everyone reads them; only administrators manage them', async () => {
    await assertSucceeds(setDoc(doc(db('admin'), 'roles', 'r_acc'), { name: 'Accounts', description: '', createdAt: 1, updatedAt: 1 }));
    await assertFails(setDoc(doc(db('admin'), 'roles', 'r_bad'), { name: '', createdAt: 1 }));
    await assertFails(setDoc(doc(db('olivia'), 'roles', 'r_x'), { name: 'Mine', createdAt: 1 }));
    await assertSucceeds(getDocs(collection(db('olivia'), 'roles')));
    await assertFails(updateDoc(doc(db('olivia'), 'users', 'olivia'), { roles: ['r_acc'] }));
    await assertSucceeds(updateDoc(doc(db('admin'), 'users', 'olivia'), { roles: ['r_acc'] }));
    await assertSucceeds(deleteDoc(doc(db('admin'), 'roles', 'r_acc')));
  });
  test('the assignee can see and move it, even with “mine only” access; the owner can’t change it now', async () => {
    await assertSucceeds(getDoc(doc(db('bob'), 'records', 'r_wf')));
    await assertSucceeds(getDocs(query(collection(db('bob'), 'records'), where('assignee', '==', 'bob'))));
    await assertFails(updateDoc(doc(db('alice'), 'records', 'r_wf'), { values: { title: 'Mine' }, updatedBy: 'alice' }));
    await assertFails(updateDoc(doc(db('olivia'), 'records', 'r_wf'), { values: { title: 'Office' }, updatedBy: 'olivia' }));
    await assertSucceeds(move('bob', 'r_wf', { stage: 's2', assignee: 'alice', stageAt: 2 }));
    await assertSucceeds(updateDoc(doc(db('alice'), 'records', 'r_wf'), { values: { title: 'Now mine' }, updatedBy: 'alice' }));
  });
  test('a group’s members can work on it; admins always', async () => {
    await assertSucceeds(updateDoc(doc(db('olivia'), 'records', 'r_grp'), { values: { title: 'x' }, updatedBy: 'olivia' }));
    await assertFails(updateDoc(doc(db('ned'), 'records', 'r_grp'), { values: { title: 'x' }, updatedBy: 'ned' }));
    await assertSucceeds(move('admin', 'r_wf', { stage: 's3', assignee: 'alice', stageAt: 2 }));
  });
  test('history: written as yourself, never changed', async () => {
    await assertFails(move('bob', 'r_wf', { stage: 's2' }, { by: 'alice' }));
    await assertFails(move('bob', 'r_wf', { stage: 's2' }, { extra: 1 }));
    await assertSucceeds(getDocs(collection(db('bob'), 'records', 'r_wf', 'stages')));
  });
  test('stage triggers are allowed in automations', async () => {
    await assertSucceeds(setDoc(doc(db('admin'), 'automations', 'a_s'), { name: 'On approve', formId: 'f_jobs', on: true, trigger: { type: 'stage', to: 's2' }, join: 'all', conds: [], acts: [{ do: 'task', title: 'x' }], createdBy: 'admin', createdAt: 1, updatedAt: 1, updatedBy: 'admin' }));
  });
  test('scheduled (monthly) automations; their waiting-for-OK list is read-only and admins only', async () => {
    await assertSucceeds(setDoc(doc(db('admin'), 'automations', 'a_m'), { name: 'Month end', formId: 'f_jobs', on: true, trigger: { type: 'schedule', every: 'monthEndBiz', hour: 17, headsUp: true, approve: true }, join: 'all', conds: [], acts: [{ do: 'task', title: 'x' }], createdBy: 'admin', createdAt: 1, updatedAt: 1, updatedBy: 'admin' }));
    await assertFails(setDoc(doc(db('admin'), 'automations', 'a_m', 'sched', 'run'), { month: '2026-10' }));
    await assertFails(setDoc(doc(db('admin'), 'pendingSends', 'a_m_r1'), { automationId: 'a_m' }));
    await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), 'pendingSends', 'a_m_r1'), { automationId: 'a_m', recordId: 'r1' }); });
    await assertSucceeds(getDoc(doc(db('admin'), 'pendingSends', 'a_m_r1')));
    await assertFails(getDoc(doc(db('alice'), 'pendingSends', 'a_m_r1')));
    await assertFails(deleteDoc(doc(db('admin'), 'pendingSends', 'a_m_r1')));
  });
});

describe('form version history', () => {
  const v = (by, extra = {}) => ({ n: 1, at: 1, by, kind: 'saved', summary: [], form: { name: 'Jobs', fields: [] }, ...extra });
  test('admins keep versions, as themselves; nobody changes or deletes them; members can’t read them', async () => {
    await assertSucceeds(setDoc(doc(db('admin'), 'forms', 'f_jobs', 'versions', 'v1'), v('admin')));
    await assertFails(setDoc(doc(db('admin'), 'forms', 'f_jobs', 'versions', 'v2'), v('alice')));
    await assertFails(setDoc(doc(db('admin'), 'forms', 'f_jobs', 'versions', 'v3'), v('admin', { kind: 'whatever' })));
    await assertFails(setDoc(doc(db('olivia'), 'forms', 'f_jobs', 'versions', 'v4'), v('olivia')));
    await assertFails(updateDoc(doc(db('admin'), 'forms', 'f_jobs', 'versions', 'v1'), { kind: 'draft' }));
    await assertFails(deleteDoc(doc(db('admin'), 'forms', 'f_jobs', 'versions', 'v1')));
    await assertSucceeds(getDoc(doc(db('admin'), 'forms', 'f_jobs', 'versions', 'v1')));
    await assertFails(getDoc(doc(db('olivia'), 'forms', 'f_jobs', 'versions', 'v1')));
  });
});

describe('kept PDFs of sent emails', () => {
  const pdf = (rec) => `sentEmails/${rec}/e1.pdf`;
  test('anyone who can see the record can open it; nobody writes it from the app', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadString(ref(ctx.storage(), pdf('r_bob')), '%PDF-1.7');
    });
    await assertSucceeds(getMetadata(ref(as('bob').storage(), pdf('r_bob'))));   // own record
    await assertSucceeds(getMetadata(ref(as('vera').storage(), pdf('r_bob'))));  // views all
    await assertSucceeds(getMetadata(ref(as('admin').storage(), pdf('r_bob'))));
    await assertFails(getMetadata(ref(as('alice').storage(), pdf('r_bob'))));    // views own only
    await assertFails(getMetadata(ref(as('ned').storage(), pdf('r_bob'))));      // no access yet
    await assertFails(uploadString(ref(as('admin').storage(), pdf('r_bob')), '%PDF-1.7'));
    await assertFails(uploadString(ref(as('bob').storage(), pdf('r_bob')), '%PDF-1.7'));
  });
});

describe('default home dashboard', () => {
  test('admins choose it; everyone let in reads it', async () => {
    const ok = (by) => ({ dashboardId: 'd1', updatedAt: 1, updatedBy: by });
    await assertSucceeds(setDoc(doc(db('admin'), 'settings', 'home'), ok('admin')));
    await assertFails(setDoc(doc(db('admin'), 'settings', 'home'), ok('alice')));
    await assertFails(setDoc(doc(db('admin'), 'settings', 'home'), { ...ok('admin'), extra: 1 }));
    await assertFails(setDoc(doc(db('olivia'), 'settings', 'home'), ok('olivia')));
    await assertSucceeds(getDoc(doc(db('vera'), 'settings', 'home')));
    await assertFails(getDoc(doc(db('ned'), 'settings', 'home')));
  });
});

describe('company calendar (Settings → Dates and time)', () => {
  test('admins set it; everyone let in reads it; only sensible values', async () => {
    const ok = (by, o = {}) => ({ timeZone: 'America/Toronto', weekStart: 1, fyStart: 4, updatedAt: 1, updatedBy: by, ...o });
    await assertSucceeds(setDoc(doc(db('admin'), 'settings', 'calendar'), ok('admin')));
    await assertSucceeds(setDoc(doc(db('admin'), 'settings', 'calendar'), ok('admin', { weekStart: 0, fyStart: 1 })));
    await assertFails(setDoc(doc(db('admin'), 'settings', 'calendar'), ok('admin', { weekStart: 3 })));
    await assertFails(setDoc(doc(db('admin'), 'settings', 'calendar'), ok('admin', { fyStart: 13 })));
    await assertFails(setDoc(doc(db('admin'), 'settings', 'calendar'), ok('admin', { timeZone: '' })));
    await assertFails(setDoc(doc(db('admin'), 'settings', 'calendar'), { ...ok('admin'), extra: 1 }));
    await assertFails(setDoc(doc(db('admin'), 'settings', 'calendar'), ok('alice')));
    await assertFails(setDoc(doc(db('olivia'), 'settings', 'calendar'), ok('olivia')));
    await assertSucceeds(getDoc(doc(db('vera'), 'settings', 'calendar')));
    await assertFails(getDoc(doc(db('ned'), 'settings', 'calendar')));
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
    // a Board or Timeline view keeps its layout
    await assertSucceeds(setDoc(doc(db('bob'), 'listViews', 'v_board'), lv('bob', { layout: { kind: 'board', by: '_stage', sum: 'budget', start: 'start', end: 'due', color: '_stage', zoom: 'month' } })));
    await assertFails(setDoc(doc(db('bob'), 'listViews', 'v_bad1'), lv('bob', { layout: { kind: 'pie' } })));
    await assertFails(setDoc(doc(db('bob'), 'listViews', 'v_bad2'), lv('bob', { layout: { kind: 'board', extra: 1 } })));
    await assertFails(setDoc(doc(db('bob'), 'listViews', 'v_bad3'), lv('bob', { layout: { kind: 'timeline', zoom: 'year' } })));
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
    await assertSucceeds(getDocs(query(collection(db('vera'), 'listViews'), where('shared', '==', true))));
    await assertFails(getDocs(query(collection(db('ned'), 'listViews'), where('shared', '==', true))));
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
    await assertSucceeds(getDoc(doc(db('vera'), 'dashboards', 'db_team')));
    await assertFails(getDoc(doc(db('ned'), 'dashboards', 'db_team')));
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
    // your own sign-in email, so others can give you tasks from Formwright; never someone else's
    await assertSucceeds(setDoc(doc(db('bob'), 'profiles', 'bob'), { email: 'bob@example.com' }, { merge: true }));
    await assertFails(setDoc(doc(db('bob'), 'profiles', 'bob'), { email: 'alice@example.com' }, { merge: true }));
  });
});


describe('imports', () => {
  const imp = (owner, extra = {}) => ({ formId: 'f_jobs', formName: 'Jobs', fileName: 'Jobs.xlsx', ownerId: owner, createdAt: 10, stamp: 10, status: 'running', added: ['r_new'], updated: ['r_alice'], counts: { added: 1, updated: 1, same: 0, skipped: 0 }, ...extra });
  const before = { values: { title: 'Job' }, parentId: null, parentFormId: null, updatedAt: 1, updatedBy: 'alice' };

  test('an admin imports: the import, the record as it was, and the change in one batch', async () => {
    const d = db('admin');
    await assertSucceeds(setDoc(doc(d, 'imports', 'imp1'), imp('admin')));
    const b = writeBatch(d);
    b.set(doc(d, 'records', 'r_new'), record('admin', { createdAt: 10, updatedAt: 10 }));
    b.set(doc(d, 'imports', 'imp1', 'before', 'r_alice'), before);
    b.set(doc(d, 'records', 'r_alice'), record('alice', { values: { title: 'Imported' }, updatedAt: 10, updatedBy: 'admin' }));
    await assertSucceeds(b.commit());
    await assertSucceeds(updateDoc(doc(d, 'imports', 'imp1'), { status: 'done', finishedAt: 11 }));
    await assertSucceeds(getDocs(collection(d, 'imports')));
    await assertSucceeds(getDocs(collection(d, 'imports', 'imp1', 'before')));
  });

  test('undo: put the record back, remove the added one, mark the import undone', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const x = ctx.firestore();
      await setDoc(doc(x, 'imports', 'imp1'), imp('admin', { status: 'done' }));
      await setDoc(doc(x, 'imports', 'imp1', 'before', 'r_alice'), before);
      await setDoc(doc(x, 'records', 'r_new'), record('admin'));
    });
    const d = db('admin');
    const b = writeBatch(d);
    b.delete(doc(d, 'records', 'r_new'));
    b.set(doc(d, 'records', 'r_alice'), record('alice', { updatedAt: 12, updatedBy: 'admin' }));
    b.delete(doc(d, 'imports', 'imp1', 'before', 'r_alice'));
    await assertSucceeds(b.commit());
    await assertSucceeds(updateDoc(doc(d, 'imports', 'imp1'), { status: 'undone', undoneAt: 12, undoneBy: 'admin', undo: { removed: 1, under: 0, restored: 1, kept: [], gone: 0 } }));
  });

  test('members can’t see, start or change imports', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'imports', 'imp1'), imp('admin'));
      await setDoc(doc(ctx.firestore(), 'imports', 'imp1', 'before', 'r_alice'), before);
    });
    for (const who of ['olivia', 'alice', 'ned']) {
      const d = db(who);
      await assertFails(getDoc(doc(d, 'imports', 'imp1')));
      await assertFails(getDocs(collection(d, 'imports')));
      await assertFails(getDoc(doc(d, 'imports', 'imp1', 'before', 'r_alice')));
      await assertFails(setDoc(doc(d, 'imports', 'imp_' + who), imp(who)));
      await assertFails(updateDoc(doc(d, 'imports', 'imp1'), { status: 'undone' }));
      await assertFails(setDoc(doc(d, 'imports', 'imp1', 'before', 'r_bob'), before));
    }
  });

  test('an import’s record is shape-checked and its list of records never changes', async () => {
    const d = db('admin');
    await assertFails(setDoc(doc(d, 'imports', 'x1'), imp('olivia')));
    await assertFails(setDoc(doc(d, 'imports', 'x2'), imp('admin', { status: 'maybe' })));
    await assertFails(setDoc(doc(d, 'imports', 'x3'), imp('admin', { extra: 1 })));
    await assertFails(setDoc(doc(d, 'imports', 'x4'), imp('admin', { added: 'r_new' })));
    await assertFails(setDoc(doc(d, 'imports', 'x5'), imp('admin', { fileName: 'x'.repeat(201) })));
    await assertSucceeds(setDoc(doc(d, 'imports', 'ok'), imp('admin')));
    await assertFails(updateDoc(doc(d, 'imports', 'ok'), { added: ['r_alice', 'r_bob'] }));
    await assertFails(updateDoc(doc(d, 'imports', 'ok'), { ownerId: 'olivia' }));
    await assertFails(setDoc(doc(d, 'imports', 'ok', 'before', 'r_bob'), { ...before, extra: true }));
  });
});

describe('brand-new accounts', () => {
  test('see nothing until an admin adds them to a group', async () => {
    await assertFails(getDoc(doc(db('ned'), 'forms', 'f_jobs')));
    await assertFails(getDocs(collection(db('ned'), 'forms')));
    await assertFails(getDocs(collection(db('ned'), 'profiles')));
    await assertFails(getDocs(query(collection(db('ned'), 'reports'), where('shared', '==', true))));
    await assertFails(getDocs(query(collection(db('ned'), 'reportDefs'), where('shared', '==', true))));
    await assertFails(getDocs(query(collection(db('ned'), 'dashboards'), where('shared', '==', true))));
  });

  test('can still set up their own profile and see their own things', async () => {
    await assertSucceeds(setDoc(doc(db('ned'), 'profiles', 'ned'), { displayName: 'Ned' }));
    await assertSucceeds(getDoc(doc(db('ned'), 'profiles', 'ned')));
    await assertSucceeds(getDoc(doc(db('ned'), 'users', 'ned')));
    await assertSucceeds(getDocs(query(collection(db('ned'), 'dashboards'), where('ownerId', '==', 'ned'))));
  });

  test('members and admins read forms and names', async () => {
    await assertSucceeds(getDocs(collection(db('vera'), 'forms')));
    await assertSucceeds(getDocs(collection(db('alice'), 'profiles')));
    await assertSucceeds(getDocs(collection(db('admin'), 'forms')));
  });
});

describe('auto numbers', () => {
  const FIELDS = ['formId', 'values', 'parentId', 'parentFormId', 'ownerId', 'createdBy', 'createdAt', 'updatedAt', 'updatedBy'];
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'records', 'r_num'), record('olivia', { nums: { n1: 'INV-1001' } }));
      await setDoc(doc(ctx.firestore(), 'counters', 'f_jobs__n1'), { next: 1002 });
    });
  });

  test('the app can’t make up a number when creating a record', async () => {
    await assertFails(setDoc(doc(db('olivia'), 'records', 'r_new'), record('olivia', { nums: { n1: 'INV-1' } })));
    await assertFails(setDoc(doc(db('olivia'), 'records', 'r_new'), record('olivia', { autoLog: [] })));
    await assertSucceeds(setDoc(doc(db('olivia'), 'records', 'r_new'), record('olivia')));
  });

  test('saving a numbered record keeps its number; changing it is refused, even for admins', async () => {
    await assertSucceeds(setDoc(doc(db('olivia'), 'records', 'r_num'), record('olivia', { values: { title: 'Changed' } }), { mergeFields: FIELDS }));
    await assertSucceeds(updateDoc(doc(db('olivia'), 'records', 'r_num'), { 'values.title': 'Again', updatedBy: 'olivia' }));
    await assertFails(updateDoc(doc(db('olivia'), 'records', 'r_num'), { 'nums.n1': 'INV-9', updatedBy: 'olivia' }));
    await assertFails(updateDoc(doc(db('admin'), 'records', 'r_num'), { 'nums.n1': 'INV-9', updatedBy: 'admin' }));
    await assertFails(setDoc(doc(db('olivia'), 'records', 'r_num'), record('olivia')), 'a full overwrite would drop the number');
    await assertFails(updateDoc(doc(db('olivia'), 'records', 'r_num'), { autoLog: [], updatedBy: 'olivia' }));
  });

  test('counters: admins may read them; nobody writes them from the app', async () => {
    await assertSucceeds(getDoc(doc(db('admin'), 'counters', 'f_jobs__n1')));
    await assertFails(getDoc(doc(db('olivia'), 'counters', 'f_jobs__n1')));
    await assertFails(setDoc(doc(db('admin'), 'counters', 'f_jobs__n1'), { next: 1 }));
  });
});

describe('emails sent from a record', () => {
  test('readable by whoever can see the record; written only by the server', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'records', 'r_alice', 'emails', 'e1'), { to: ['x@y.com'], subject: 'Hi', by: 'admin', at: 1 }));
    await assertSucceeds(getDoc(doc(db('alice'), 'records', 'r_alice', 'emails', 'e1')));
    await assertSucceeds(getDocs(collection(db('olivia'), 'records', 'r_alice', 'emails')));
    await assertFails(getDoc(doc(db('bob'), 'records', 'r_alice', 'emails', 'e1')), 'bob sees only his own records');
    await assertFails(setDoc(doc(db('admin'), 'records', 'r_alice', 'emails', 'e2'), { to: [], subject: 'fake' }));
    await assertFails(getDoc(doc(db('admin'), 'emailLimits', 'admin')));
  });
});

describe('audit trail', () => {
  test('administrators read it; nobody writes it from the app', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'audit', 'a1'), { at: 1, by: 'alice', area: 'record', kind: 'changed' }));
    await assertSucceeds(getDoc(doc(db('admin'), 'audit', 'a1')));
    await assertSucceeds(getDocs(query(collection(db('admin'), 'audit'), where('by', '==', 'alice'))));
    await assertFails(getDoc(doc(db('olivia'), 'audit', 'a1')));
    await assertFails(getDoc(doc(db('alice'), 'audit', 'a1')));
    await assertFails(setDoc(doc(db('admin'), 'audit', 'a2'), { at: 1 }));
    await assertFails(deleteDoc(doc(db('admin'), 'audit', 'a1')));
  });
});

describe('PDF export settings', () => {
  const ok = (uid, extra = {}) => ({ companyName: 'Pollack Renovations', logo: 'data:image/png;base64,iVBORw0KGgo=', updatedAt: 1, updatedBy: uid, ...extra });

  test('admins save the company name and logo', async () => {
    await assertSucceeds(setDoc(doc(db('admin'), 'settings', 'exports'), ok('admin')));
    await assertSucceeds(setDoc(doc(db('admin'), 'settings', 'exports'), ok('admin', { logo: null })));
    await assertSucceeds(setDoc(doc(db('admin'), 'settings', 'exports'), ok('admin', { logo: 'data:image/jpeg;base64,/9j/4AAQ' })));
  });

  test('everyone let in reads them; brand-new accounts don’t', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'settings', 'exports'), ok('admin')));
    await assertSucceeds(getDoc(doc(db('vera'), 'settings', 'exports')));
    await assertSucceeds(getDoc(doc(db('alice'), 'settings', 'exports')));
    await assertFails(getDoc(doc(db('ned'), 'settings', 'exports')));
  });

  test('members can’t change them', async () => {
    await assertFails(setDoc(doc(db('olivia'), 'settings', 'exports'), ok('olivia')));
  });

  test('only pictures, only that document, nothing extra', async () => {
    const a = db('admin');
    await assertFails(setDoc(doc(a, 'settings', 'exports'), ok('admin', { logo: 'data:text/html;base64,PHNjcmlwdD4=' })));
    await assertFails(setDoc(doc(a, 'settings', 'exports'), ok('admin', { logo: 'data:image/png;base64,' + 'A'.repeat(600001) })));
    await assertFails(setDoc(doc(a, 'settings', 'exports'), ok('admin', { other: 1 })));
    await assertFails(setDoc(doc(a, 'settings', 'exports'), ok('admin', { updatedBy: 'alice' })));
    await assertFails(setDoc(doc(a, 'settings', 'other'), ok('admin')));
  });
});

describe('upload file types', () => {
  const path = (formId, uid, name) => `uploads/${formId}/${uid}/${name}`;
  test('documents and photos are fine; web pages and scripts are refused', async () => {
    const st = as('alice').storage();
    await assertSucceeds(uploadString(ref(st, path('f_jobs', 'alice', 'a.pdf')), 'pdf', 'raw', { contentType: 'application/pdf' }));
    await assertSucceeds(uploadString(ref(st, path('f_jobs', 'alice', 'a.jpg')), 'jpg', 'raw', { contentType: 'image/jpeg' }));
    await assertFails(uploadString(ref(st, path('f_jobs', 'alice', 'a.html')), '<p>x</p>', 'raw', { contentType: 'text/html' }));
    await assertFails(uploadString(ref(st, path('f_jobs', 'alice', 'a.svg')), '<svg/>', 'raw', { contentType: 'image/svg+xml' }));
    await assertFails(uploadString(ref(st, path('f_jobs', 'alice', 'a.js')), 'x', 'raw', { contentType: 'text/javascript; charset=utf-8' }));
  });
});

describe('comments and @mentions', () => {
  const c = (by, extra = {}) => ({ by, byName: by, at: 1, text: 'Looks good @olivia', mentions: [{ uid: 'olivia', name: 'olivia' }], parent: null, task: false, ...extra });
  const path = (d, rid, id) => doc(d, 'records', rid, 'comments', id);

  test('anyone who can see the record can comment, view-only included', async () => {
    await assertSucceeds(setDoc(path(db('alice'), 'r_alice', 'c1'), c('alice')));
    await assertSucceeds(setDoc(path(db('vera'), 'r_alice', 'c2'), c('vera')));
    await assertSucceeds(getDocs(collection(db('vera'), 'records', 'r_alice', 'comments')));
    await assertFails(setDoc(path(db('bob'), 'r_alice', 'c3'), c('bob')), 'bob cannot see the record');
    await assertFails(getDocs(collection(db('bob'), 'records', 'r_alice', 'comments')));
    await assertFails(setDoc(path(db('alice'), 'r_alice', 'c4'), c('olivia')), 'must be written as yourself');
    await assertFails(setDoc(path(db('alice'), 'r_alice', 'c5'), c('alice', { notified: { olivia: 'sent' } })), 'notified is the server’s');
    await assertFails(setDoc(path(db('alice'), 'r_alice', 'c6'), c('alice', { text: '' })));
    await assertFails(setDoc(path(db('alice'), 'r_alice', 'c7'), c('alice', { text: 'x'.repeat(5001) })));
  });

  test('replies are one level deep', async () => {
    await assertSucceeds(setDoc(path(db('alice'), 'r_alice', 'c1'), c('alice')));
    await assertSucceeds(setDoc(path(db('olivia'), 'r_alice', 'r1'), c('olivia', { parent: 'c1' })));
    await assertFails(setDoc(path(db('olivia'), 'r_alice', 'r2'), c('olivia', { parent: 'r1' })));
  });

  test('you can edit and remove your own; admins can remove any', async () => {
    await assertSucceeds(setDoc(path(db('alice'), 'r_alice', 'c1'), c('alice')));
    await assertSucceeds(updateDoc(path(db('alice'), 'r_alice', 'c1'), { text: 'Changed', mentions: [], editedAt: 2 }));
    await assertFails(updateDoc(path(db('alice'), 'r_alice', 'c1'), { at: 5 }));
    await assertFails(updateDoc(path(db('olivia'), 'r_alice', 'c1'), { text: 'Mine now', editedAt: 3 }));
    await assertFails(deleteDoc(path(db('olivia'), 'r_alice', 'c1')));
    await assertSucceeds(deleteDoc(path(db('admin'), 'r_alice', 'c1')));
    await assertSucceeds(setDoc(path(db('alice'), 'r_alice', 'c2'), c('alice')));
    await assertSucceeds(deleteDoc(path(db('alice'), 'r_alice', 'c2')));
  });

  test('mentions belong to the person mentioned', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'mentions', 'm1'), { to: 'olivia', by: 'alice', recordId: 'r_alice', read: false, at: 1 }));
    await assertSucceeds(getDoc(doc(db('olivia'), 'mentions', 'm1')));
    await assertSucceeds(getDocs(query(collection(db('olivia'), 'mentions'), where('to', '==', 'olivia'))));
    await assertSucceeds(updateDoc(doc(db('olivia'), 'mentions', 'm1'), { read: true }));
    await assertFails(updateDoc(doc(db('olivia'), 'mentions', 'm1'), { to: 'alice' }));
    await assertFails(getDoc(doc(db('alice'), 'mentions', 'm1')));
    await assertSucceeds(getDoc(doc(db('admin'), 'mentions', 'm1'))); // administrators see everyone's (All mentions)
    await assertFails(setDoc(doc(db('alice'), 'mentions', 'm2'), { to: 'olivia', by: 'alice', read: false }));
    await assertSucceeds(deleteDoc(doc(db('olivia'), 'mentions', 'm1')));
  });
});

describe('Word templates', () => {
  const t = (by, extra = {}) => ({ formId: 'f_jobs', name: 'Quote', path: `docTemplates/f_jobs/${by}/1-quote.docx`, url: 'https://x', size: 100, by, byName: by, at: 1, updatedAt: 1, tags: 3, problems: 0, ...extra });
  test('anyone who can see the form adds and uses them; the uploader or an admin changes them', async () => {
    await assertSucceeds(setDoc(doc(db('vera'), 'docTemplates', 't1'), t('vera')));
    await assertSucceeds(getDocs(query(collection(db('alice'), 'docTemplates'), where('formId', '==', 'f_jobs'))));
    await assertFails(getDocs(query(collection(db('ned'), 'docTemplates'), where('formId', '==', 'f_jobs'))), 'no access');
    await assertFails(setDoc(doc(db('ned'), 'docTemplates', 't2'), t('ned')));
    await assertFails(setDoc(doc(db('alice'), 'docTemplates', 't3'), t('vera')), 'as yourself');
    await assertFails(setDoc(doc(db('alice'), 'docTemplates', 't4'), t('alice', { path: 'docTemplates/f_other/alice/x.docx' })), 'the file must be in its form’s folder');
    await assertSucceeds(updateDoc(doc(db('vera'), 'docTemplates', 't1'), { name: 'Quote v2' }));
    await assertFails(updateDoc(doc(db('alice'), 'docTemplates', 't1'), { name: 'Mine' }));
    await assertSucceeds(updateDoc(doc(db('admin'), 'docTemplates', 't1'), { name: 'Admin' }));
    await assertFails(deleteDoc(doc(db('alice'), 'docTemplates', 't1')));
    await assertSucceeds(deleteDoc(doc(db('vera'), 'docTemplates', 't1')));
  });
});

describe('Word template files', () => {
  const DOCX = { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  const p = (owner) => `docTemplates/f_jobs/${owner}/1-quote.docx`;
  test('view access is enough to add and read one; only Word files', async () => {
    await assertSucceeds(uploadString(ref(as('vera').storage(), p('vera')), 'x', 'raw', DOCX));
    await assertFails(uploadString(ref(as('vera').storage(), p('alice')), 'x', 'raw', DOCX), 'your own folder');
    await assertFails(uploadString(ref(as('vera').storage(), p('vera') + '.html'), 'x', 'raw', { contentType: 'text/html' }));
    await assertFails(uploadString(ref(as('ned').storage(), p('ned')), 'x', 'raw', DOCX));
    await assertSucceeds(getMetadata(ref(as('alice').storage(), p('vera'))));
    await assertFails(getMetadata(ref(as('ned').storage(), p('vera'))));
  });
});

describe('All mentions', () => {
  test('administrators read everyone’s mentions; only the person mentioned changes them', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'mentions', 'm1'), { to: 'olivia', by: 'alice', recordId: 'r_alice', read: false, at: 1 }));
    await assertSucceeds(getDoc(doc(db('admin'), 'mentions', 'm1')));
    await assertSucceeds(getDocs(collection(db('admin'), 'mentions')));
    await assertFails(updateDoc(doc(db('admin'), 'mentions', 'm1'), { read: true }));
    await assertFails(deleteDoc(doc(db('admin'), 'mentions', 'm1')));
    await assertFails(getDocs(collection(db('olivia'), 'mentions')), 'members only their own');
  });
});

describe('dashboards emailed on a schedule', () => {
  const sch = (by, x = {}) => ({ dashboardId: 'd1', on: true, freq: 'weekly', day: 1, hour: 8, to: { people: ['admin'], roles: [], addresses: '' }, createdAt: 1, updatedAt: 1, updatedBy: by, ...x });
  test('administrators set them; members can’t see or set them', async () => {
    await assertSucceeds(setDoc(doc(db('admin'), 'dashMails', 'd1'), sch('admin')));
    await assertFails(setDoc(doc(db('admin'), 'dashMails', 'd2'), sch('admin')));
    await assertFails(setDoc(doc(db('admin'), 'dashMails', 'd1'), sch('admin', { freq: 'hourly' })));
    await assertFails(setDoc(doc(db('admin'), 'dashMails', 'd1'), sch('alice')));
    await assertFails(setDoc(doc(db('olivia'), 'dashMails', 'd1'), sch('olivia')));
    await assertFails(getDoc(doc(db('olivia'), 'dashMails', 'd1')));
    await assertSucceeds(deleteDoc(doc(db('admin'), 'dashMails', 'd1')));
  });
  test('overdue markers are the server’s', async () => {
    await assertFails(getDoc(doc(db('admin'), 'stageOverdue', 'r1')));
    await assertFails(setDoc(doc(db('admin'), 'stageOverdue', 'r1'), { stage: 's' }));
  });
});

describe('Problems and backups (Settings → Problems and backups)', () => {
  const prob = (uid, extra = {}) => ({ at: 1, app: 'formwright', uid, name: 'Alice', where: 'Edit form · save-form', message: 'It broke', code: 'invalid-argument', detail: 'Error: It broke', url: '/#/x', agent: 'UA', version: '', ...extra });
  test('anyone signed in reports their own, within the limits; only admins read or clear them', async () => {
    await assertSucceeds(setDoc(doc(db('alice'), 'problems', 'p1'), prob('alice')));
    await assertSucceeds(setDoc(doc(db('ned'), 'problems', 'p2'), prob('ned', { app: 'cadence' })));
    await assertFails(setDoc(doc(db('alice'), 'problems', 'p3'), prob('bob')), 'not as someone else');
    await assertFails(setDoc(doc(db('alice'), 'problems', 'p4'), prob('alice', { app: 'server' })), 'not as the server');
    await assertFails(setDoc(doc(db('alice'), 'problems', 'p5'), prob('alice', { message: 'x'.repeat(501) })));
    await assertFails(setDoc(doc(db('alice'), 'problems', 'p6'), prob('alice', { detail: 'x'.repeat(4001) })));
    await assertFails(setDoc(doc(db('alice'), 'problems', 'p7'), prob('alice', { extra: 1 })));
    await assertFails(setDoc(doc(db('alice'), 'problems', 'p8'), prob('alice', { message: '' })));
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'problems', 'p9'), prob('alice')));
    await assertFails(getDoc(doc(db('alice'), 'problems', 'p1')));
    await assertFails(updateDoc(doc(db('alice'), 'problems', 'p1'), { message: 'changed' }));
    await assertFails(deleteDoc(doc(db('alice'), 'problems', 'p1')));
    await assertSucceeds(getDocs(collection(db('admin'), 'problems')));
    await assertFails(updateDoc(doc(db('admin'), 'problems', 'p1'), { message: 'changed' }));
    await assertSucceeds(deleteDoc(doc(db('admin'), 'problems', 'p1')));
  });
  test('the backup’s status is the server’s; admins read it', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'system', 'backup'), { lastAt: 1, ok: true }));
    await assertSucceeds(getDoc(doc(db('admin'), 'system', 'backup')));
    await assertFails(getDoc(doc(db('olivia'), 'system', 'backup')));
    await assertFails(setDoc(doc(db('admin'), 'system', 'backup'), { lastAt: 2, ok: true }));
  });
  test('who gets the morning email: admins set it', async () => {
    const ok = (uid, extra = {}) => ({ notify: [uid], updatedAt: 1, updatedBy: uid, ...extra });
    await assertSucceeds(setDoc(doc(db('admin'), 'settings', 'problems'), ok('admin')));
    await assertFails(setDoc(doc(db('admin'), 'settings', 'problems'), ok('admin', { notify: Array.from({ length: 21 }, (_, i) => 'u' + i) })));
    await assertFails(setDoc(doc(db('admin'), 'settings', 'problems'), ok('admin', { other: 1 })));
    await assertFails(setDoc(doc(db('olivia'), 'settings', 'problems'), ok('olivia')));
  });
});

describe('Starred records (yours only)', () => {
  test('each person reads and writes only their own stars', async () => {
    await assertSucceeds(setDoc(doc(db('alice'), 'stars', 'alice'), { ids: ['r1', 'r2'], updatedAt: 1 }));
    await assertSucceeds(getDoc(doc(db('alice'), 'stars', 'alice')));
    await assertFails(getDoc(doc(db('admin'), 'stars', 'alice')), 'not even an administrator');
    await assertFails(setDoc(doc(db('bob'), 'stars', 'alice'), { ids: [], updatedAt: 1 }));
    await assertFails(setDoc(doc(db('alice'), 'stars', 'alice'), { ids: Array.from({ length: 101 }, (_, i) => 'r' + i) }));
    await assertFails(setDoc(doc(db('alice'), 'stars', 'alice'), { ids: [], other: 1 }));
  });
});
