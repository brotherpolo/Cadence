// Workflows: overdue emails (functions/overdue.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const od = require('../../functions/overdue.js');

test('what was sent belongs to this arrival at the stage', () => {
  const rec = { stage: 's2', stageAt: 100 };
  assert.deepEqual(od.sentFor({ stage: 's2', stageAt: 100, remindedAt: 5, escalatedAt: null }, rec), { remind: true, escalate: false });
  assert.deepEqual(od.sentFor({ stage: 's2', stageAt: 50, remindedAt: 5 }, rec), {}, 'it left and came back: start again');
  assert.deepEqual(od.sentFor(null, rec), {});
});

test('the emails and the audit note', () => {
  const r = od.reminderEmail({ item: 'Invoice', title: '58', stage: 'Approve', due: '2026-10-14', late: 1, link: 'https://fw.example/#/record/r1' });
  assert.equal(r.subject, 'Overdue: Invoice 58 (Approve)');
  assert.match(r.text, /due Wed, Oct 14 \(1 working day ago\)/);
  assert.match(r.html, /href="https:\/\/fw.example\/#\/record\/r1"/);
  const e = od.escalationEmail({ item: 'Invoice', title: '58', stage: 'Approve', due: '2026-10-14', late: 3, holder: 'Accounts' });
  assert.equal(e.subject, 'Still overdue: Invoice 58 (Approve, with Accounts)');
  assert.match(e.text, /3 working days overdue/);
  const a = od.auditEntry({ recordId: 'r1', rec: { formId: 'f' }, formName: 'Invoices', title: '58', stage: 'Approve', kind: 'escalate', to: ['a@x'], now: 1 });
  assert.deepEqual([a.kind, a.byName, a.note], ['overdue', 'Formwright', 'Still overdue at Approve: emailed a@x']);
});
