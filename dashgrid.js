/* Cadence — dashboard grid: where charts sit on a dashboard.
   A dashboard is a grid 24 squares across; rows are as tall as a square is wide.
   Each tile is { id, chart: chartId } or { id, text: { title, body } }, with x, y, w, h in squares.
   Pure functions, no DOM: charts.js draws, these decide positions. Tested in tests/unit. */
(function (root) {
  const COLS = 24, MIN_W = 3;
  const minH = (t) => (t && t.text ? 2 : 3);
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  /** a tile kept to the grid's size rules */
  function clamp(t) {
    const w = Math.max(MIN_W, Math.min(COLS, Math.round(t.w == null ? 12 : t.w)));
    return Object.assign({}, t, {
      w, h: Math.max(minH(t), Math.min(80, Math.round(t.h == null ? 8 : t.h))),
      x: Math.max(0, Math.min(COLS - w, Math.round(t.x || 0))), y: Math.max(0, Math.round(t.y || 0))
    });
  }

  /** keep `movedId` where it is, push overlapped tiles down; optionally float everything up */
  function resolve(tiles, movedId, floatUp) {
    const all = (tiles || []).map(clamp);
    const moved = all.find((t) => t.id === movedId);
    const placed = moved ? [moved] : [];
    all.filter((t) => t !== moved).sort((a, b) => a.y - b.y || a.x - b.x).forEach((t0) => {
      const t = Object.assign({}, t0);
      for (let guard = 0; guard < 500; guard++) { const o = placed.find((p) => overlaps(p, t)); if (!o) break; t.y = o.y + o.h; }
      placed.push(t);
    });
    return floatUp ? float(placed) : placed;
  }

  /** slide every tile up as far as it goes, top to bottom */
  function float(tiles) {
    const done = [];
    (tiles || []).map(clamp).sort((a, b) => a.y - b.y || a.x - b.x).forEach((t0) => {
      const t = Object.assign({}, t0);
      while (t.y > 0 && !done.some((p) => overlaps(p, Object.assign({}, t, { y: t.y - 1 })))) t.y--;
      done.push(t);
    });
    return done;
  }

  /** where a new w × h tile goes: the first spot from the top left where it fits, else below everything */
  function place(tiles, w, h) {
    const list = (tiles || []).map(clamp);
    const bottom = height(list);
    for (let y = 0; y <= bottom; y++) {
      for (let x = 0; x + w <= COLS; x++) {
        const t = { x, y, w, h };
        if (!list.some((p) => overlaps(p, t))) return { x, y };
      }
    }
    return { x: 0, y: bottom };
  }

  const height = (tiles) => (tiles || []).reduce((m, t) => Math.max(m, (t.y || 0) + (t.h || 0)), 0);
  const readingOrder = (tiles) => (tiles || []).slice().sort((a, b) => a.y - b.y || a.x - b.x);

  /** the size a chart starts at on a dashboard */
  function sizeFor(chart) {
    const type = chart && chart.type;
    if (type === 'kpi') return { w: 6, h: 5 };
    if (type === 'table') return { w: 24, h: 10 };
    if (chart && chart.size === 'sm') return { w: 8, h: 8 };
    if (chart && chart.size === 'wide') return { w: 24, h: 9 };
    return { w: 12, h: 9 };
  }

  /** append a chart to a dashboard's tiles in the first free spot */
  function addChart(tiles, chart, id) {
    const s = sizeFor(chart), p = place(tiles, s.w, s.h);
    return (tiles || []).concat([{ id, chart: chart.id, x: p.x, y: p.y, w: s.w, h: s.h }]);
  }

  /** The old Board (sections, small / medium / wide cards) as one dashboard.
      Each named section becomes a heading; inside it KPIs come first in a row, then charts
      fill rows left to right (small 8, medium 12, wide 24 squares across). */
  function fromBoard(charts) {
    const list = (charts || []).filter((c) => c && c.id);
    const secs = [''];
    list.forEach((c) => { const s = c.section || ''; if (!secs.includes(s)) secs.push(s); });
    const tiles = [];
    let y = 0, n = 0;
    const id = () => 'tl-' + (++n);
    secs.forEach((name) => {
      const items = list.filter((c) => (c.section || '') === name);
      if (!items.length) return;
      if (name) { tiles.push({ id: id(), text: { title: name, body: '' }, x: 0, y, w: 24, h: 2 }); y += 2; }
      let x = 0, rowH = 0;
      const put = (c) => {
        const s = sizeFor(c);
        if (x + s.w > COLS) { y += rowH; x = 0; rowH = 0; }
        tiles.push({ id: id(), chart: c.id, x, y, w: s.w, h: s.h });
        x += s.w; rowH = Math.max(rowH, s.h);
      };
      items.filter((c) => c.type === 'kpi').forEach(put);
      if (x) { y += rowH; x = 0; rowH = 0; }
      items.filter((c) => c.type !== 'kpi').forEach(put);
      if (x) { y += rowH; x = 0; rowH = 0; }
    });
    return { id: 'db-main', name: 'My board', tiles };
  }

  /** the dashboards to show: saved ones, or the old board turned into one (not saved until changed) */
  function dashboardsOf(board) {
    const ds = board && Array.isArray(board.dashboards) ? board.dashboards.filter((d) => d && d.id) : [];
    if (ds.length) return ds;
    return [fromBoard(board && board.charts)];
  }

  /** tiles whose chart still exists (a chart deleted elsewhere just drops off) */
  function liveTiles(tiles, charts) {
    const have = new Set((charts || []).map((c) => c.id));
    return (tiles || []).filter((t) => t.text || have.has(t.chart));
  }

  /** dashboards that show a chart */
  function usedOn(dashboards, chartId) {
    return (dashboards || []).filter((d) => (d.tiles || []).some((t) => t.chart === chartId));
  }

  const api = { COLS, MIN_W, minH, clamp, resolve, float, place, height, readingOrder, sizeFor, addChart, fromBoard, dashboardsOf, liveTiles, usedOn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.Cadence = root.Cadence || {}).dashgrid = api;
})(typeof window !== 'undefined' ? window : globalThis);
