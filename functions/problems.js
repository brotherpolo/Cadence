/* Problems (Formwright → Settings → Problems): things that went wrong, for administrators.
 * People's browsers report their own (Formwright and Cadence write problems/{id}, checked by
 * the rules); the server reports its own here (a failed email, automation or nightly backup).
 * Each morning, administrators who asked for it get one email listing what's new, and reports
 * older than 30 days are cleared away.
 *
 *   serverEntry(where, args, now)   console-style arguments → a problems/{id} document
 *   groupKey(p)                     reports of the same thing share a key
 *   digestEmail(list, link, tz)     → { subject, text, html } for what's new
 *   Limiter                         at most a few server reports per place per 10 minutes */
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const KEEP_DAYS = 30;
const cut = (s, n) => { const t = String(s == null ? '' : s); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

/** A server problem from what was passed to logger.error: the first argument says where. */
function serverEntry(where, args, now = Date.now()) {
  const err = (args || []).find((a) => a instanceof Error || (a && typeof a === 'object' && (a.message || a.code)));
  const extra = (args || []).filter((a) => a !== err && a != null).map((a) => (typeof a === 'object' ? (() => { try { return JSON.stringify(a); } catch (e) { return ''; } })() : String(a))).filter(Boolean).join(' ');
  const message = err ? String(err.message || err.code || 'Error') : String(extra || where || 'Something went wrong');
  return {
    at: now, app: 'server', uid: 'server', name: 'Server',
    where: cut(where || 'Server job', 200), message: cut(message, 500),
    code: cut(err && err.code != null ? err.code : '', 100),
    detail: cut([extra, err && err.stack ? String(err.stack).split('\n').slice(0, 8).join('\n') : ''].filter(Boolean).join('\n'), 4000),
  };
}

/** Same app, same place, same message (numbers and IDs blurred): one line in the list. */
function groupKey(p) {
  const blur = (s) => String(s || '').replace(/[0-9a-f]{8,}|\d+/gi, '#');
  return [p.app || '', blur(p.where), blur(p.message)].join('|');
}

/** One email of what's new since the last one: grouped, most frequent first. */
function digestEmail(list, link, tz = 'America/Toronto') {
  const groups = new Map();
  (list || []).forEach((p) => { const k = groupKey(p); const g = groups.get(k) || { p, n: 0, people: new Set(), last: 0 }; g.n++; if (p.name && p.app !== 'server') g.people.add(p.name); g.last = Math.max(g.last, p.at || 0); groups.set(k, g); });
  const rows = [...groups.values()].sort((a, b) => b.n - a.n || b.last - a.last);
  const total = (list || []).length;
  const when = (ms) => new Date(ms).toLocaleString('en-CA', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const app = (a) => ({ formwright: 'Formwright', cadence: 'Cadence', server: 'Server' })[a] || a;
  const subject = `${total} new problem${total === 1 ? '' : 's'} in Formwright and Cadence`;
  const line = (g) => `${app(g.p.app)} · ${g.p.where || 'somewhere'}: ${g.p.message}${g.n > 1 ? ` (${g.n} times)` : ''}${g.people.size ? ` · ${[...g.people].slice(0, 3).join(', ')}${g.people.size > 3 ? ` and ${g.people.size - 3} more` : ''}` : ''} · last ${when(g.last)}`;
  const text = [`${total} new since the last email:`, '', ...rows.slice(0, 30).map((g) => '• ' + line(g)), rows.length > 30 ? `…and ${rows.length - 30} more.` : '', '', link ? `See them all: ${link}` : 'See them in Formwright → Settings → Problems.', '', 'You’re getting this because you asked for it in Settings → Problems.'].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
  const html = `<p><b>${total} new</b> since the last email:</p><ul>${rows.slice(0, 30).map((g) => `<li><b>${escHtml(app(g.p.app))} · ${escHtml(g.p.where || 'somewhere')}</b>: ${escHtml(g.p.message)}${g.n > 1 ? ` <b>(${g.n} times)</b>` : ''}${g.people.size ? ` · ${escHtml([...g.people].slice(0, 3).join(', '))}${g.people.size > 3 ? ` and ${g.people.size - 3} more` : ''}` : ''} <span style="color:#5a6174">· last ${escHtml(when(g.last))}</span></li>`).join('')}</ul>${rows.length > 30 ? `<p>…and ${rows.length - 30} more.</p>` : ''}`
    + (link ? `<p><a href="${escHtml(link)}">See them all in Formwright</a></p>` : '<p>See them in Formwright → Settings → Problems.</p>')
    + '<p style="color:#5a6174">You’re getting this because you asked for it in Settings → Problems.</p>';
  return { subject, text, html };
}

/** At most `max` reports from one place in `windowMs` (a failing job can't flood the list). */
class Limiter {
  constructor(max = 5, windowMs = 10 * 60e3) { this.max = max; this.windowMs = windowMs; this.seen = new Map(); }
  ok(key, now = Date.now()) {
    const l = (this.seen.get(key) || []).filter((t) => now - t < this.windowMs);
    if (l.length >= this.max) { this.seen.set(key, l); return false; }
    l.push(now); this.seen.set(key, l); return true;
  }
}

module.exports = { serverEntry, groupKey, digestEmail, Limiter, KEEP_DAYS };
