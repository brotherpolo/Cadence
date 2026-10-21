/* Nightly backups (exports.nightlyBackup in index.js): every night the whole database is
 * exported to gs://<bucket>/nightly/YYYY-MM-DD/, and once that has worked, nightly copies older
 * than 30 days are removed (the newest 7 are always kept, whatever their age). Nothing outside
 * nightly/ is ever touched: manual and before-deploy backups stay as they are.
 *
 *   run({ now, tz, keepDays, exportTo(prefix), listFolders(), deleteFolder(prefix) })
 *     → { folder, removed: [prefix] }      (throws if the export fails; nothing is removed then)
 * The storage and export calls are passed in, so this file is unit-tested with stand-ins. */
const KEEP_DAYS = 30;
const KEEP_MIN = 7;
const FOLDER = /^nightly\/(\d{4}-\d{2}-\d{2})\/$/;

/** 'YYYY-MM-DD' for a moment in a time zone. */
function dayIn(ms, tz) {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
  return `${p.year}-${p.month}-${p.day}`;
}

/** The nightly folders to remove: older than keepDays, never the newest keepMin, never anything else. */
function oldFolders(prefixes, now, tz, keepDays = KEEP_DAYS, keepMin = KEEP_MIN) {
  const cutoff = dayIn(now - keepDays * 864e5, tz);
  const dated = (prefixes || []).map((p) => { const m = FOLDER.exec(String(p)); return m ? { p, d: m[1] } : null; }).filter(Boolean).sort((a, b) => b.d.localeCompare(a.d));
  return dated.slice(keepMin).filter((x) => x.d < cutoff).map((x) => x.p);
}

async function run({ now = Date.now(), tz = 'America/Toronto', keepDays = KEEP_DAYS, exportTo, listFolders, deleteFolder }) {
  const folder = `nightly/${dayIn(now, tz)}`;
  await exportTo(folder); // throws on failure: then nothing is removed
  const removed = [];
  for (const p of oldFolders(await listFolders(), now, tz, keepDays)) {
    await deleteFolder(p);
    removed.push(p);
  }
  return { folder, removed };
}

module.exports = { run, oldFolders, dayIn, KEEP_DAYS, KEEP_MIN };
