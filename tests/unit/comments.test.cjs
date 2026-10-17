// Comments and @mentions (functions/comments.js): who gets told, and what they get.
// Run from tests/: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const cm = require('../../functions/comments.js');

const c = (extra = {}) => ({ by: 'adam', byName: 'Adam', at: 1, text: 'Can you check this @Sam Lee?', mentions: [{ uid: 'sam', name: 'Sam Lee' }], parent: null, task: false, ...extra });

test('who to tell: each person once, never yourself, never twice', () => {
  assert.deepEqual(cm.toNotify(c()), [{ uid: 'sam', name: 'Sam Lee' }]);
  assert.deepEqual(cm.toNotify(c({ mentions: [{ uid: 'sam', name: 'Sam' }, { uid: 'sam', name: 'Sam' }, { uid: 'adam', name: 'Adam' }] })), [{ uid: 'sam', name: 'Sam' }]);
  assert.deepEqual(cm.toNotify(c({ notified: { sam: 'sent' } })), [], 'already told');
  assert.deepEqual(cm.toNotify(c({ notified: { sam: 'no-access' } })), [], 'already checked');
  // an edit that adds someone tells only the new person
  assert.deepEqual(cm.toNotify(c({ notified: { sam: 'sent' }, mentions: [{ uid: 'sam', name: 'Sam' }, { uid: 'kim', name: 'Kim' }] })).map((m) => m.uid), ['kim']);
  assert.deepEqual(cm.toNotify(null), []);
  assert.deepEqual(cm.toNotify(c({ mentions: 'nope' })), []);
  assert.deepEqual(cm.toNotify(c({ mentions: [null, { name: 'x' }] })), []);
});

test('who can see the record: the same test as the security rules', () => {
  const rec = { formId: 'f_jobs', ownerId: 'amy', assignee: null, assigneeGroup: null };
  assert.equal(cm.canSee({ role: 'admin' }, rec, 'x'), true);
  assert.equal(cm.canSee({ access: { '*': { view: 'all' } } }, rec, 'x'), true);
  assert.equal(cm.canSee({ access: { '*': { view: 'own' } } }, rec, 'x'), false);
  assert.equal(cm.canSee({ access: { '*': { view: 'own' } } }, rec, 'amy'), true);
  assert.equal(cm.canSee({ access: { '*': { view: 'all' }, f_jobs: { view: 'none' } } }, rec, 'x'), false, 'the form’s own level wins');
  assert.equal(cm.canSee({ access: {} }, rec, 'x'), false);
  assert.equal(cm.canSee({ access: {} }, { ...rec, assignee: 'x' }, 'x'), true, 'the person responsible');
  assert.equal(cm.canSee({ access: {}, groups: ['g1'] }, { ...rec, assigneeGroup: 'g1' }, 'x'), true);
  assert.equal(cm.canSee(null, rec, 'x'), false);
});

test('Cadence tasks only for people with Cadence', () => {
  assert.equal(cm.usesCadence({ role: 'admin' }), true);
  assert.equal(cm.usesCadence({ cadence: true }), true);
  assert.equal(cm.usesCadence({}), false);
  assert.equal(cm.usesCadence(null), false);
});

test('snippets and links', () => {
  assert.equal(cm.snippet('  a\n\n b  '), 'a b');
  assert.equal(cm.snippet('x'.repeat(200), 10), 'x'.repeat(9) + '…');
  assert.equal(cm.recordLink('https://forms.example.com/', 'r 1'), 'https://forms.example.com/#/record/r%201');
  assert.equal(cm.recordLink('https://forms.example.com/#/form/x', 'r1'), 'https://forms.example.com/#/record/r1');
  assert.equal(cm.recordLink('', 'r1'), '');
  assert.equal(cm.recordLink('javascript:alert(1)', 'r1'), '');
});

test('the Mentions entry', () => {
  const m = cm.mentionDoc({ to: 'sam', comment: c(), commentId: 'c1', recordId: 'r1', formId: 'f_jobs', recordTitle: 'Job 12', formName: 'Jobs', now: 5 });
  assert.deepEqual(m, { to: 'sam', by: 'adam', byName: 'Adam', recordId: 'r1', formId: 'f_jobs', recordTitle: 'Job 12', formName: 'Jobs', commentId: 'c1', snippet: 'Can you check this @Sam Lee?', at: 5, read: false });
});

test('the email', () => {
  const e = cm.mentionEmail({ byName: 'Adam', item: 'Job', title: '12 <b>', text: 'Line one\nLine <two>', link: 'https://f.example.com/#/record/r1' });
  assert.equal(e.subject, 'Adam mentioned you on Job 12 <b>');
  assert.match(e.text, /> Line one\n> Line <two>/);
  assert.match(e.text, /Open it: https:\/\/f\.example\.com/);
  assert.match(e.html, /12 &lt;b&gt;/);
  assert.match(e.html, /Line &lt;two&gt;/);
  assert.ok(!/<two>/.test(e.html));
  const r = cm.mentionEmail({ byName: '', item: 'Job', title: '12', text: 'x', link: '', reply: true });
  assert.match(r.text, /^Someone mentioned you in a reply on Job 12/);
  assert.match(r.text, /My work → Mentions/);
});

test('the Cadence task', () => {
  const t = cm.mentionTask({ id: 't1', owner: { uid: 'adam', name: 'Adam', email: 'a@x.com' }, assignee: { uid: 'sam', name: 'Sam', email: 's@x.com' }, comment: c(), recordId: 'r1', formId: 'f_jobs', recordTitle: 'Job 12', formName: 'Jobs', item: 'Job', color: '#123', now: 9 });
  assert.equal(t.title, 'Re Job Job 12: Can you check this @Sam Lee?');
  assert.deepEqual(t.members, ['adam', 'sam']);
  assert.equal(t.assigneeId, 'sam');
  assert.equal(t.ownerId, 'adam');
  assert.equal(t.recordId, 'r1');
  assert.deepEqual(t.recordSnap, { title: 'Job 12', form: 'Jobs', color: '#123' });
  assert.equal(t.done, false);
  assert.match(t.notes, /^Comment: Adam mentioned you/);
});

test('the audit entry for a removed comment', () => {
  const e = cm.deletedEntry({ recordId: 'r1', rec: { formId: 'f_jobs' }, form: { name: 'Jobs' }, title: 'Job 12', comment: c(), commentId: 'c1', who: { by: 'boss', byName: 'Boss' }, replies: 2, now: 3 });
  assert.equal(e.kind, 'commentdeleted');
  assert.equal(e.area, 'record');
  assert.equal(e.note, 'Removed a comment and its 2 replies');
  assert.equal(e.changes[0].label, 'Comment by Adam');
  assert.equal(e.changes[0].from, 'Can you check this @Sam Lee?');
  assert.equal(cm.deletedEntry({ recordId: 'r1', rec: {}, form: {}, comment: c({ parent: 'c0' }), commentId: 'c2', who: { by: 'a', byName: 'A' }, now: 1 }).note, 'Removed a reply');
});

test('roles: mentioning a role reaches each holder once; a role task goes to the role', () => {
  const c = { by: 'amy', text: 'Please pay @Accounts', mentions: [{ uid: 'role:r_acc', name: 'Accounts' }, { uid: 'bo', name: 'Bo' }], notified: { cy: 'sent' } };
  const todo = cm.toNotify(c);
  assert.deepEqual(todo.map((m) => m.uid), ['role:r_acc', 'bo']);
  const holders = new Map([['r_acc', [{ uid: 'amy' }, { uid: 'bo' }, { uid: 'cy' }, { uid: 'far', user: { role: 'member' } }]]]);
  const r = cm.roleRecipients(todo, holders, c);
  assert.deepEqual(r.map((m) => [m.uid, m.role]), [['far', 'Accounts']], 'not the commenter, not someone told already or named too');
  assert.equal(cm.mentionDoc({ to: 'far', comment: c, commentId: 'c1', recordId: 'r1', now: 1, role: 'Accounts' }).role, 'Accounts');
  assert.match(cm.mentionEmail({ byName: 'Amy', item: 'Invoice', title: '58', text: 'x', role: 'Accounts' }).subject, /mentioned Accounts \(your role\) on Invoice 58/);
  const t = cm.mentionTask({ id: 't1', owner: { uid: 'amy', name: 'Amy' }, role: { id: 'r_acc', name: 'Accounts' }, comment: c, recordId: 'r1', formId: 'f', recordTitle: '58', item: 'Invoice', now: 1 });
  assert.deepEqual([t.assigneeId, t.assigneeRole, t.assigneeRoleName, t.members], [null, 'r_acc', 'Accounts', ['amy']]);
});
