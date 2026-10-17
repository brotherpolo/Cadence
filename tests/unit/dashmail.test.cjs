// Scheduled dashboard emails, through the server's copy of Formwright (functions/fwkit.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fw = require('../../functions/fwkit.cjs');

test('the server can build a dashboard email and knows when it’s due', () => {
  const form = { id: 'f', name: 'Deals', fields: [{ id: 'n', type: 'text', label: 'Name' }, { id: 'st', type: 'select', label: 'Stage', options: ['Won', 'Lost'] }, { id: 'amt', type: 'currency', label: 'Amount' }] };
  const records = [{ id: 'a', formId: 'f', values: { n: 'Acme', st: 'Won', amt: 100 } }, { id: 'b', formId: 'f', values: { n: 'Beta', st: 'Lost', amt: 50 } }];
  const k = fw.makeKit({ forms: [form], records });
  const c = { forms: [form], records, profiles: {}, formById: k.formById, recById: k.recById, valOf: (f, r, fm) => k.valOf(f, r, fm), fmt: (f, v) => k.fmt(f, v), recTitle: (r) => k.recTitle(r, k.formById(r.formId)) };
  const reports = new Map([['r', { name: 'By stage', def: { form: 'f', type: 'bar', group: { form: 'f', id: 'st' }, measure: { fn: 'sum', ref: { form: 'f', id: 'amt' } } } }]]);
  const m = fw.dashEmail(c, { name: 'Sales', filters: { period: 'all' }, tiles: [{ id: 't', report: 'r', x: 0, y: 0, w: 12, h: 6 }] }, reports, { now: Date.UTC(2026, 9, 19, 12) });
  assert.match(m.text, /By stage: Won: .*100.*; Lost: .*50/);
  assert.equal(fw.dueSlot({ on: true, freq: 'weekdays', hour: 8 }, fw.partsIn(Date.UTC(2026, 9, 19, 12), 'America/Toronto')), '2026-10-19T08');
});
