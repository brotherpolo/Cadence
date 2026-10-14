// Dashboard layout rules (dashgrid.js). Run from tests/: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../../dashgrid.js');

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const noOverlaps = (tiles) => tiles.every((a, i) => tiles.every((b, j) => i === j || !overlap(a, b)));

test('the old board becomes one dashboard: sections are headings, KPIs first', () => {
  const charts = [
    { id: 'a', type: 'bar' }, { id: 'k', type: 'kpi' }, { id: 'w', type: 'line', size: 'wide' },
    { id: 's', type: 'pie', size: 'sm', section: 'Weekly' }, { id: 'k2', type: 'kpi', section: 'Weekly' }
  ];
  const d = G.fromBoard(charts);
  assert.equal(d.name, 'My board');
  const t = d.tiles;
  assert.ok(noOverlaps(t));
  const by = (id) => t.find((x) => x.chart === id);
  assert.deepEqual([by('k').x, by('k').y, by('k').w], [0, 0, 6]);
  assert.ok(by('a').y >= by('k').y + by('k').h, 'charts come below the KPIs');
  assert.equal(by('w').w, 24);
  const head = t.find((x) => x.text && x.text.title === 'Weekly');
  assert.ok(head && head.w === 24 && head.h === 2);
  assert.ok(by('k2').y > head.y && by('s').y > by('k2').y);
  assert.equal(by('s').w, 8);
});

test('no saved dashboards: the old board is shown; saved ones win', () => {
  assert.equal(G.dashboardsOf({ charts: [{ id: 'a', type: 'bar' }] })[0].tiles.length, 1);
  const saved = [{ id: 'd1', name: 'Mine', tiles: [] }];
  assert.deepEqual(G.dashboardsOf({ charts: [], dashboards: saved }), saved);
  assert.equal(G.dashboardsOf({}).length, 1);
});

test('moving a tile pushes the ones in the way down, and float closes gaps', () => {
  const tiles = [{ id: 'a', x: 0, y: 0, w: 12, h: 8 }, { id: 'b', x: 12, y: 0, w: 12, h: 8 }];
  const moved = G.resolve([{ ...tiles[0] }, { ...tiles[1], x: 6, y: 2 }], 'b');
  assert.ok(noOverlaps(moved));
  assert.deepEqual(moved.find((t) => t.id === 'b'), { id: 'b', x: 6, y: 2, w: 12, h: 8 });
  assert.equal(moved.find((t) => t.id === 'a').y, 10);
  const up = G.float([{ id: 'a', x: 0, y: 5, w: 6, h: 4 }, { id: 'b', x: 0, y: 20, w: 6, h: 4 }]);
  assert.deepEqual(up.map((t) => t.y), [0, 4]);
});

test('sizes stay on the grid', () => {
  assert.deepEqual(G.clamp({ id: 'a', x: 30, y: -2, w: 1, h: 1 }), { id: 'a', x: 21, y: 0, w: 3, h: 3 });
  assert.equal(G.clamp({ id: 't', text: {}, h: 1 }).h, 2);
  assert.equal(G.clamp({ id: 'a', w: 40 }).w, 24);
});

test('a new chart goes in the first free spot', () => {
  const tiles = [{ id: 'a', x: 0, y: 0, w: 12, h: 9 }];
  const out = G.addChart(tiles, { id: 'c', type: 'bar' }, 't2');
  assert.deepEqual(out[1], { id: 't2', chart: 'c', x: 12, y: 0, w: 12, h: 9 });
  const kpi = G.addChart(out, { id: 'k', type: 'kpi' }, 't3')[2];
  assert.deepEqual([kpi.x, kpi.y, kpi.w, kpi.h], [0, 9, 6, 5]);
});

test('tiles of deleted charts drop off; usedOn finds a chart', () => {
  const ds = [{ id: 'd1', tiles: [{ id: 't', chart: 'gone' }, { id: 'u', chart: 'here' }, { id: 'x', text: { title: 'Hi' } }] }];
  assert.deepEqual(G.liveTiles(ds[0].tiles, [{ id: 'here' }]).map((t) => t.id), ['u', 'x']);
  assert.equal(G.usedOn(ds, 'here').length, 1);
  assert.equal(G.usedOn(ds, 'nope').length, 0);
});
