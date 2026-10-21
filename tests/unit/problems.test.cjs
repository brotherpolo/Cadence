// Problems (functions/problems.js): server reports, grouping, the morning email, the limiter.
const test = require('node:test');
const assert = require('node:assert/strict');
const { serverEntry, groupKey, digestEmail, Limiter } = require('../../functions/problems.js');

test('a server problem from logger.error-style arguments', () => {
  const e = Object.assign(new Error('Invalid login: 535-5.7.8 Username and Password not accepted'), { code: 'EAUTH' });
  const p = serverEntry('dashboard email failed', ['dash1', e], 1000);
  assert.equal(p.app, 'server'); assert.equal(p.uid, 'server'); assert.equal(p.at, 1000);
  assert.equal(p.where, 'dashboard email failed');
  assert.match(p.message, /Username and Password not accepted/);
  assert.equal(p.code, 'EAUTH');
  assert.match(p.detail, /^dash1\nError: Invalid login/);
  const q = serverEntry('reminders failed for a user', [{ uid: 'u1', error: 'quota' }]);
  assert.equal(q.message, '{"uid":"u1","error":"quota"}');
  assert.ok(serverEntry('x', [new Error('y'.repeat(900))]).message.length <= 500, 'kept short');
});

test('the same thing groups together, whatever the numbers and IDs', () => {
  const a = { app: 'formwright', where: 'save-form', message: 'Nested arrays are not supported (record 4fa93b2c11)' };
  const b = { app: 'formwright', where: 'save-form', message: 'Nested arrays are not supported (record 77bb0c9e21)' };
  assert.equal(groupKey(a), groupKey(b));
  assert.notEqual(groupKey(a), groupKey({ ...a, app: 'cadence' }));
});

test('the morning email: grouped, most frequent first, who it happened to', () => {
  const p = (at, name, where, message, app = 'formwright') => ({ at, app, uid: name, name, where, message });
  const m = digestEmail([p(1, 'Amy', 'save-form', 'Nested arrays'), p(2, 'Bo', 'save-form', 'Nested arrays'), p(3, 'Server', 'Nightly backup', 'PERMISSION_DENIED', 'server'), p(4, 'Amy', 'save-form', 'Nested arrays')], 'https://fw.example/#/problems');
  assert.equal(m.subject, '4 new problems in Formwright and Cadence');
  const lines = m.text.split('\n').filter((l) => l.startsWith('• '));
  assert.match(lines[0], /^• Formwright · save-form: Nested arrays \(3 times\) · Amy, Bo · last /);
  assert.match(lines[1], /^• Server · Nightly backup: PERMISSION_DENIED · last /, 'no person for the server');
  assert.match(m.html, /<a href="https:\/\/fw.example\/#\/problems">/);
  assert.doesNotMatch(digestEmail([p(1, '<b>x</b>', 'w', '<script>')], '').html, /<script>|<b>x/, 'escaped');
});

test('a failing job can’t flood the list', () => {
  const l = new Limiter(3, 1000);
  assert.deepEqual([0, 1, 2, 3, 4].map((t) => l.ok('a', t)), [true, true, true, false, false]);
  assert.equal(l.ok('b', 5), true, 'another place is counted separately');
  assert.equal(l.ok('a', 1500), true, 'and it opens up again');
});
