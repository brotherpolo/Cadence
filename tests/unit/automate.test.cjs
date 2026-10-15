// Automations (functions/automate.js): triggers, conditions, dates and the plan of what runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../../functions/automate.js');
const fw = require('../../functions/fwkit.cjs');

const form = { id: 'f_inv', name: 'Invoices', itemName: 'Invoice', color: 2, titleField: 'num', children: [{ formId: 'f_task', display: 'records' }], fields: [
  { id: 'num', type: 'text', label: 'Invoice #' }, { id: 'st', type: 'select', label: 'Status', options: ['Draft', 'Approved', 'Sent'] },
  { id: 'amt', type: 'currency', label: 'Total', currency: 'CAD' }, { id: 'due', type: 'date', label: 'Due date' }, { id: 'email', type: 'email', label: 'Billing email' },
  { id: 'sent', type: 'date', label: 'Sent on' }, { id: 'paid', type: 'checkbox', label: 'Paid' }, { id: 'tax', type: 'formula', label: 'Tax', expr: '{Total} * 0.13', format: 'currency' } ] };
const cli = { id: 'f_cli', name: 'Clients', itemName: 'Client', children: [{ formId: 'f_inv' }], fields: [{ id: 'cn', type: 'text', label: 'Name' }, { id: 'tier', type: 'select', label: 'Tier', options: ['Gold', 'Basic'] }, { id: 'ce', type: 'email', label: 'Email' }] };
const child = { id: 'f_task', name: 'Follow-ups', fields: [{ id: 'ft', type: 'text', label: 'Invoice #' }, { id: 'fs', type: 'select', label: 'Status', options: ['Draft', 'Approved'] }, { id: 'note', type: 'text', label: 'Note' }] };
const P = { id: 'c1', formId: 'f_cli', values: { cn: 'Northwind', tier: 'Gold', ce: 'ap@northwind.example' } };
const R = (values, extra = {}) => ({ id: 'i1', formId: 'f_inv', parentId: 'c1', parentFormId: 'f_cli', ownerId: 'amy', values: { num: 'INV-58', amt: 1000, ...values }, ...extra });

test('triggers: created, any change, a field changing, a field becoming a value', () => {
  const a = (trigger) => ({ trigger });
  assert.equal(A.triggerMatches(a({ type: 'created' }), { kind: 'created', after: R({}), form }), true);
  assert.equal(A.triggerMatches(a({ type: 'created' }), { kind: 'changed', before: R({}), after: R({ st: 'Sent' }), form }), false);
  assert.equal(A.triggerMatches(a({ type: 'changed' }), { kind: 'changed', before: R({}), after: R({}, { updatedAt: 9 }), form }), false, 'only a values change counts');
  assert.equal(A.triggerMatches(a({ type: 'changed', field: 'st' }), { kind: 'changed', before: R({ st: 'Draft' }), after: R({ st: 'Approved' }), form }), true);
  assert.equal(A.triggerMatches(a({ type: 'changed', field: 'st' }), { kind: 'changed', before: R({ st: 'Draft' }), after: R({ st: 'Draft', amt: 5 }), form }), false);
  const becomes = a({ type: 'changed', field: 'st', op: 'is', value: 'Approved' });
  assert.equal(A.triggerMatches(becomes, { kind: 'changed', before: R({ st: 'Draft' }), after: R({ st: 'Approved' }), form }), true);
  assert.equal(A.triggerMatches(becomes, { kind: 'changed', before: R({ st: 'Approved' }), after: R({ st: 'Sent' }), form }), false);
});

test('chains: depth, and an automation never reacts to its own change', () => {
  const by = { depth: 1, id: 'a1', at: 5 };
  assert.equal(A.depthOf(R({}), R({}, { auto: by })), 1);
  assert.equal(A.depthOf(R({}, { auto: by }), R({ st: 'Sent' }, { auto: by })), 0, 'a person editing later starts again at 0');
  assert.equal(A.madeBy(R({}), R({}, { auto: by })), 'a1');
  assert.equal(A.madeBy(R({}, { auto: by }), R({}, { auto: by })), null);
  assert.equal(A.MAX_DEPTH, 3);
});

test('only if: none means always; conditions use the parent too', () => {
  const k = fw.makeKit({ forms: [form, cli, child], records: [P, R({})] });
  const rec = R({ st: 'Approved' });
  assert.equal(A.condsHold({ conds: [] }, k.look(form, rec)), true);
  assert.equal(A.condsHold({ join: 'all', conds: [{ src: 'self', field: 'st', op: 'is', value: 'Approved' }, { src: 'f_cli', field: 'tier', op: 'is', value: 'Gold' }] }, k.look(form, rec)), true);
  assert.equal(A.condsHold({ join: 'all', conds: [{ src: 'self', field: 'tax', op: 'gt', value: 200 }] }, k.look(form, rec)), false, 'calculations are worked out (tax 130)');
});

test('dates: on, before, after; Toronto calendar day', () => {
  const a = (rel, days) => ({ trigger: { type: 'date', dateField: 'due', rel, days } });
  const rec = R({ due: '2026-10-20' });
  assert.equal(A.dateDue(a('on'), form, rec, '2026-10-20'), true);
  assert.equal(A.dateDue(a('before', 3), form, rec, '2026-10-17'), true);
  assert.equal(A.dateDue(a('after', 2), form, rec, '2026-10-22'), true);
  assert.equal(A.dateDue(a('before', 3), form, rec, '2026-10-18'), false);
  assert.equal(A.dateDue(a('on'), form, R({}), '2026-10-20'), false);
  assert.equal(A.dayKey(Date.UTC(2026, 9, 16, 3), 'America/Toronto'), '2026-10-15', '11 p.m. in Toronto is still the 15th');
});

test('the plan: set fields, a task, an email, a child record', () => {
  const k = fw.makeKit({ forms: [form, cli, child], records: [P, R({ st: 'Approved', email: 'Billing@Client.example' })] });
  const rec = R({ st: 'Approved', email: 'Billing@Client.example' });
  const people = new Map([['boss', { name: 'Adam', email: 'adam@x.example' }], ['amy', { name: 'Amy', email: 'amy@x.example' }]]);
  const now = Date.UTC(2026, 9, 15, 16);
  const a = { acts: [
    { do: 'set', target: 'self', sets: [{ field: 'st', mode: 'value', value: 'Sent' }, { field: 'sent', mode: 'today' }, { field: 'amt', mode: 'value', value: 1000 }] },
    { do: 'set', target: 'parent', sets: [{ field: 'tier', mode: 'clear' }] },
    { do: 'task', title: 'Chase {Invoice #} for {Clients › Name}', assign: 'owner', dueDays: 7 },
    { do: 'email', to: { fields: ['email'], parentFields: ['ce'], people: ['boss'], addresses: 'bad, x@y.example' }, subject: '{Item} {Title} from {Company}', message: 'Total {Total}, tax {Tax}', pdf: true },
    { do: 'child', formId: 'f_task', copy: true, sets: [{ field: 'note', mode: 'value', value: 'Auto' }] },
    { do: 'email', to: {}, subject: 'x' },
  ] };
  const steps = A.plan(a, { k, form, rec, parent: P, pform: cli, people, owner: 'boss', actor: 'amy', now, tz: 'America/Toronto', company: 'Pollack Inc.', formById: (id) => [form, cli, child].find((f) => f.id === id) });
  assert.deepEqual(steps.map((s) => s.kind), ['set', 'set', 'task', 'email', 'child', 'skip']);
  assert.deepEqual([steps[0].set, steps[0].text], [{ st: 'Sent', sent: '2026-10-15' }, 'Set Status to Sent, Sent on to Oct 15, 2026'], 'Total unchanged is left out');
  assert.deepEqual([steps[1].recordId, steps[1].clear], ['c1', ['tier']]);
  assert.equal(steps[2].title, 'Chase INV-58 for Northwind');
  assert.deepEqual([steps[2].assignee, steps[2].due], ['amy', '2026-10-22']);
  assert.deepEqual(steps[3].to, ['billing@client.example', 'ap@northwind.example', 'adam@x.example', 'x@y.example']);
  assert.equal(steps[3].subject, 'Invoice INV-58 from Pollack Inc.');
  assert.match(steps[3].message, /^Total \$1,000.00, tax \$130.00$/);
  assert.deepEqual(steps[4].values, { ft: 'INV-58', fs: 'Approved', note: 'Auto' }, 'matching fields copied, then set');
  assert.match(steps[5].text, /no email address/);
  const again = A.plan({ acts: [{ do: 'set', target: 'self', sets: [{ field: 'st', mode: 'value', value: 'Approved' }] }] }, { k, form, rec, parent: P, pform: cli, people, now, tz: 'America/Toronto', formById: () => null });
  assert.equal(again[0].kind, 'skip', 'already as wanted: nothing to write (stops loops)');
});

test('workflow stage trigger and arrival', () => {
  const A = require('../../functions/automate.js');
  const a = { trigger: { type: 'stage', to: 's2' } }, any = { trigger: { type: 'stage' } };
  assert.equal(A.triggerMatches(a, { kind: 'changed', before: { stage: 's1' }, after: { stage: 's2' } }), true);
  assert.equal(A.triggerMatches(a, { kind: 'changed', before: { stage: 's2' }, after: { stage: 's2' } }), false, 'no move');
  assert.equal(A.triggerMatches(a, { kind: 'changed', before: { stage: 's1' }, after: { stage: 's3' } }), false, 'other stage');
  assert.equal(A.triggerMatches(any, { kind: 'created', before: null, after: { stage: 's1' } }), true);
  assert.equal(A.triggerMatches(any, { kind: 'date', after: { stage: 's1' } }), false);
  const form = { workflow: { on: true, stages: [{ id: 's1', name: 'Draft' }, { id: 's2', name: 'Review' }] } };
  assert.equal(A.stageArrival(form, { stage: 's1' }, { stage: 's2', assigneeGroup: 'g' }).stage.name, 'Review');
  assert.equal(A.stageArrival(form, { stage: 's2' }, { stage: 's2' }), null);
  assert.equal(A.stageArrival({ workflow: { on: false, stages: form.workflow.stages } }, null, { stage: 's1' }), null);
  assert.equal(A.stageArrival(form, null, { stage: 'gone' }), null);
});
