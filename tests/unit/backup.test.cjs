// Nightly backups (functions/backup.js) with stand-ins for the export and the bucket.
const test = require('node:test');
const assert = require('node:assert/strict');
const { run, oldFolders, dayIn } = require('../../functions/backup.js');

const NOW = Date.UTC(2026, 9, 22, 6, 30); // Oct 22, 2:30 a.m. in Toronto
const TZ = 'America/Toronto';
const days = (n) => Array.from({ length: n }, (_, i) => `nightly/${dayIn(NOW - (i + 1) * 864e5, TZ)}/`);

test('the folder is the night’s date in the company’s time zone', () => {
  assert.equal(dayIn(NOW, TZ), '2026-10-22');
  assert.equal(dayIn(Date.UTC(2026, 9, 22, 3), TZ), '2026-10-21', '11 p.m. the night before');
});

test('exports first, then removes nightly copies older than 30 days, keeping the newest 7', async () => {
  const done = [], gone = [];
  const have = [...days(40), 'before-deploy/', 'nightly/', 'nightly/notes/', '2026-10-01-1200/'];
  const out = await run({ now: NOW, tz: TZ, exportTo: async (p) => done.push(p), listFolders: async () => have, deleteFolder: async (p) => gone.push(p) });
  assert.deepEqual(done, ['nightly/2026-10-22']);
  assert.equal(out.folder, 'nightly/2026-10-22');
  assert.equal(gone.length, 10, 'days 31 to 40');
  assert.ok(gone.every((p) => /^nightly\/\d{4}-\d{2}-\d{2}\/$/.test(p) && p < 'nightly/2026-09-22/'), gone.join(' '));
  assert.deepEqual(out.removed, gone);
});

test('a failed export removes nothing', async () => {
  const gone = [];
  await assert.rejects(run({ now: NOW, tz: TZ, exportTo: async () => { throw new Error('PERMISSION_DENIED'); }, listFolders: async () => days(60), deleteFolder: async (p) => gone.push(p) }), /PERMISSION_DENIED/);
  assert.equal(gone.length, 0);
});

test('never fewer than 7 nightly copies, however old', () => {
  const ancient = ['nightly/2025-01-01/', 'nightly/2025-01-02/', 'nightly/2025-01-03/', 'nightly/2025-01-04/', 'nightly/2025-01-05/', 'nightly/2025-01-06/', 'nightly/2025-01-07/', 'nightly/2025-01-08/'];
  assert.deepEqual(oldFolders(ancient, NOW, TZ), ['nightly/2025-01-01/']);
  assert.deepEqual(oldFolders(['manual/2020-01-01/', 'nightly/../x/', 'nightly/2020-1-1/'], NOW, TZ), [], 'only nightly/<date>/ folders');
});
