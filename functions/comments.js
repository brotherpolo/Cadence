// Formwright record comments and @mentions: the decisions the server makes, as pure functions
// (no Firebase). index.js does the reading and writing.
//
//   records/{recordId}/comments/{commentId}
//     { by, byName, at, text, mentions: [{uid, name}], parent, task, editedAt?, notified? }
//   mentions/{id}   (one per person mentioned; only they can read it)
//     { to, by, byName, recordId, formId, recordTitle, formName, commentId, snippet, at, read }

/** The people a comment mentions that haven't been dealt with yet (not yourself, each once). */
function toNotify(comment) {
  if (!comment) return [];
  const done = comment.notified || {};
  const seen = new Set();
  const out = [];
  for (const m of Array.isArray(comment.mentions) ? comment.mentions : []) {
    const uid = m && typeof m.uid === 'string' ? m.uid : '';
    if (!uid || uid === comment.by || done[uid] || seen.has(uid)) continue;
    seen.add(uid);
    out.push({ uid, name: String(m.name || '') });
  }
  return out.slice(0, 20);
}

/** Whether an account can open a record in Formwright (the same test as the security rules). */
function canSee(user, rec, uid) {
  if (!user || !rec) return false;
  if ((user.role || 'member') === 'admin') return true;
  const acc = user.access || {};
  const lv = acc[rec.formId] || acc['*'] || {};
  if (lv.view === 'all') return true;
  if (lv.view === 'own' && rec.ownerId === uid) return true;
  if (rec.assignee && rec.assignee === uid) return true;
  if (rec.assigneeGroup && (user.groups || []).includes(rec.assigneeGroup)) return true;
  return false;
}

/** Whether an account can have Cadence tasks (an admin turns Cadence on for it; admins always can). */
const usesCadence = (user) => !!user && ((user.role || 'member') === 'admin' || user.cadence === true);

/** A short one-line piece of the comment for lists and email subjects. */
function snippet(text, max = 160) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

/** The record's address in Formwright, when FORMWRIGHT_URL is set (functions/.env). */
function recordLink(base, recordId) {
  const b = String(base || '').trim().replace(/#.*$/, '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(b) || !recordId) return '';
  return `${b}/#/record/${encodeURIComponent(recordId)}`;
}

/** The My work → Mentions entry for one person. */
function mentionDoc({ to, comment, commentId, recordId, formId, recordTitle, formName, now }) {
  return {
    to, by: comment.by, byName: comment.byName || '', recordId, formId: formId || null,
    recordTitle: String(recordTitle || '').slice(0, 300), formName: String(formName || '').slice(0, 200),
    commentId, snippet: snippet(comment.text, 300), at: now, read: false,
  };
}

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The email to someone mentioned. item is "Invoice", title "INV-0058". */
function mentionEmail({ byName, item, title, text, link, reply }) {
  const who = byName || 'Someone';
  const what = `${item || 'Record'} ${title || ''}`.trim();
  const subject = `${who} mentioned you on ${what}`.slice(0, 200);
  const body = String(text || '').trim();
  const lines = [
    `${who} mentioned you ${reply ? 'in a reply ' : ''}on ${what}:`,
    '',
    ...body.split('\n').map((l) => '> ' + l),
    '',
    link ? `Open it: ${link}` : 'Open Formwright and look in My work → Mentions.',
  ];
  const html = `<p>${escHtml(who)} mentioned you ${reply ? 'in a reply ' : ''}on <b>${escHtml(what)}</b>:</p>`
    + `<blockquote style="margin:0 0 16px;padding:8px 14px;border-left:3px solid #c7cbd6;color:#333;white-space:pre-wrap">${escHtml(body)}</blockquote>`
    + (link ? `<p><a href="${escHtml(link)}">Open ${escHtml(what)} in Formwright</a></p>` : '<p>Open Formwright and look in My work → Mentions.</p>');
  return { subject, text: lines.join('\n'), html };
}

/** The Cadence task for someone mentioned, when the commenter ticked "Also give … a Cadence task". */
function mentionTask({ id, owner, assignee, comment, recordId, formId, recordTitle, formName, item, color, now }) {
  return {
    id, title: `Re ${item || 'record'} ${recordTitle || ''}: ${snippet(comment.text, 120)}`.replace(/\s+/g, ' ').slice(0, 500),
    notes: `Comment: ${comment.byName || 'Someone'} mentioned you on ${item || 'a record'} ${recordTitle || ''}.\n\n${String(comment.text || '').slice(0, 4000)}`,
    due: null, time: null, done: false, doneAt: null, createdAt: now, updatedAt: now,
    subtasks: [], repeat: 'none',
    ownerId: owner.uid, ownerName: owner.name || null, ownerEmail: owner.email || null,
    assigneeId: assignee.uid, assigneeName: assignee.name || null, assigneeEmail: assignee.email || null,
    members: [owner.uid, assignee.uid],
    recordId, formId: formId || null, recordSnap: { title: String(recordTitle || ''), form: String(formName || ''), color: color || null },
  };
}

/** The audit trail entry for a removed comment (and the replies removed with it). */
function deletedEntry({ recordId, rec, form, title, comment, commentId, who, replies, now }) {
  const n = replies || 0;
  return {
    at: now, by: who.by, byName: who.byName, area: 'record', kind: 'commentdeleted',
    recordId, formId: (rec && rec.formId) || null, formName: (form && form.name) || '', title: title || '',
    changes: [{ key: 'comment:' + commentId, label: `Comment by ${comment.byName || 'someone'}`, type: 'text', from: String(comment.text || '').slice(0, 2000), to: null }],
    note: n ? `Removed a comment and its ${n === 1 ? 'reply' : n + ' replies'}` : (comment.parent ? 'Removed a reply' : 'Removed a comment'),
  };
}

module.exports = { toNotify, canSee, usesCadence, snippet, recordLink, mentionDoc, mentionEmail, mentionTask, deletedEntry };
