// Formwright workflows: overdue stages. Each working-day morning (index.js, stageOverdue) every record
// waiting past its stage's due date gets, if the stage asks for it, one reminder to whoever has it, and
// later one email to someone else (administrators, a role or a person). Pure functions: index.js reads
// and writes. What was sent is kept in stageOverdue/{recordId} for that arrival at the stage.

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const longDate = (key) => { const [y, m, d] = String(key).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); };
const days = (n) => (n === 1 ? '1 working day' : `${n} working days`);

/** What's been sent for this arrival at the stage ({} when it moved since, or nothing was sent). */
function sentFor(mark, rec) {
  if (!mark || mark.stage !== rec.stage || (mark.stageAt || 0) !== (rec.stageAt || 0)) return {};
  return { remind: !!mark.remindedAt, escalate: !!mark.escalatedAt };
}

/** Who has it, in words: "Bea", "Accounts", "Reviewers". */
function holderText({ person, roleName, groupName }) { return person || roleName || groupName || 'nobody'; }

/** The reminder to whoever has it. */
function reminderEmail({ item, title, stage, due, late, link }) {
  const what = `${item} ${title}`.trim();
  const subject = `Overdue: ${what} (${stage})`.slice(0, 200);
  const lines = [`${what} has been waiting on you at ${stage}, and it was due ${longDate(due)} (${days(late)} ago).`, '', link ? `Open it: ${link}` : 'Open Formwright and look in My work.'];
  const html = `<p><b>${escHtml(what)}</b> has been waiting on you at <b>${escHtml(stage)}</b>, and it was due ${escHtml(longDate(due))} (${escHtml(days(late))} ago).</p>`
    + (link ? `<p><a href="${escHtml(link)}">Open ${escHtml(what)} in Formwright</a></p>` : '<p>Open Formwright and look in My work.</p>');
  return { subject, text: lines.join('\n'), html };
}

/** The email to someone else when it's still overdue. */
function escalationEmail({ item, title, stage, due, late, holder, link }) {
  const what = `${item} ${title}`.trim();
  const subject = `Still overdue: ${what} (${stage}, with ${holder})`.slice(0, 200);
  const lines = [`${what} is still at ${stage}, waiting on ${holder}. It was due ${longDate(due)}: ${days(late)} overdue.`, 'You’re getting this because the workflow says to tell you when it’s this late.', '', link ? `Open it: ${link}` : 'Open Formwright to look at it.'];
  const html = `<p><b>${escHtml(what)}</b> is still at <b>${escHtml(stage)}</b>, waiting on <b>${escHtml(holder)}</b>. It was due ${escHtml(longDate(due))}: ${escHtml(days(late))} overdue.</p>`
    + '<p style="color:#5a6174">You’re getting this because the workflow says to tell you when it’s this late.</p>'
    + (link ? `<p><a href="${escHtml(link)}">Open ${escHtml(what)} in Formwright</a></p>` : '');
  return { subject, text: lines.join('\n'), html };
}

/** The audit trail entry: who was emailed about an overdue record. */
function auditEntry({ recordId, rec, formName, title, stage, kind, to, now }) {
  return {
    at: now, by: 'system', byName: 'Formwright', area: 'record', kind: 'overdue', recordId, formId: rec.formId || null, formName: formName || '', title: title || '',
    note: `${kind === 'escalate' ? 'Still overdue at' : 'Overdue at'} ${stage}: emailed ${to.length ? to.slice(0, 10).join(', ') : 'nobody (no email address found)'}`,
  };
}

module.exports = { sentFor, holderText, reminderEmail, escalationEmail, auditEntry, longDate };
