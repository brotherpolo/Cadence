/* Email PDF (Formwright → a record → Email PDF): an administrator sends a record's PDF.
 *
 * The app makes the PDF (the same one Export PDF downloads) and sends it here with the
 * addresses, subject and message. This checks who's asking and what's being sent, sends it
 * through Gmail (GMAIL_USER, with the app password in Secret Manager as GMAIL_APP_PASSWORD),
 * and notes it on the record in records/{id}/emails.
 *
 *   sendRecordEmail(db, send, callerUid, data, opts)
 *     data: { recordId, to: [email], cc: [email], copyMe, subject, message, pdf (base64), fileName, attach }
 *       attach: false sends the message without the PDF (no pdf needed)
 *     send(mail) → { messageId }: nodemailer's sendMail in production, a stand-in in tests
 *     opts: { from, fromName, now }
 *
 * Limits: administrators only; 10 addresses per email; 8 MB PDF; 100 emails per person per day,
 * so a stolen account can't be used to send spam. Errors are { code, message }. */
const MAX_TO = 10, MAX_PDF = 8 * 1024 * 1024, PER_DAY = 100;
const EMAIL = /^[^\s@<>(),;:"\[\]\\]+@[^\s@<>(),;:"\[\]\\]+\.[^\s@<>(),;:"\[\]\\]{2,}$/;

function fail(code, message) { const e = new Error(message); e.code = code; throw e; }

const cleanList = (v) => (Array.isArray(v) ? v : []).map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
const oneLine = (s, max) => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
function safeFileName(s) {
  const base = String(s || 'Record.pdf').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Record.pdf';
  return /\.pdf$/i.test(base) ? base : base + '.pdf';
}
const dayKey = (ms, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

async function sendRecordEmail(db, send, callerUid, data, opts = {}) {
  const now = opts.now || Date.now();
  if (!callerUid) fail('unauthenticated', 'Sign in first.');
  const me = await db.collection('users').doc(callerUid).get();
  if (!me.exists || me.get('role') !== 'admin') fail('permission-denied', 'Only administrators can email records.');
  if (!opts.from || !opts.ready) fail('failed-precondition', 'Email isn’t set up yet. See the install steps (Gmail app password).');

  const recordId = data && typeof data.recordId === 'string' ? data.recordId : '';
  if (!recordId) fail('invalid-argument', 'Say which record.');
  const to = [...new Set(cleanList(data.to))];
  const cc = [...new Set(cleanList(data.cc))].filter((x) => !to.includes(x));
  if (!to.length) fail('invalid-argument', 'Add at least one address to send to.');
  if (to.length + cc.length > MAX_TO) fail('invalid-argument', `Send to ${MAX_TO} addresses at most.`);
  const bad = [...to, ...cc].find((x) => !EMAIL.test(x));
  if (bad) fail('invalid-argument', `“${bad}” isn’t an email address.`);
  const subject = oneLine(data.subject, 200);
  if (!subject) fail('invalid-argument', 'Add a subject.');
  const message = String(data.message || '').replace(/\r\n?/g, '\n').slice(0, 10000);
  const attach = data.attach !== false;
  const pdf = attach ? Buffer.from(String(data.pdf || ''), 'base64') : Buffer.alloc(0);
  if (attach && (!pdf.length || pdf.subarray(0, 5).toString('latin1') !== '%PDF-')) fail('invalid-argument', 'The PDF is missing or damaged. Try again.');
  if (pdf.length > MAX_PDF) fail('invalid-argument', 'The PDF is over 8 MB, too big to email. Try a record with fewer or smaller photos.');
  const fileName = attach ? safeFileName(data.fileName) : null;

  const recRef = db.collection('records').doc(recordId);
  const rec = await recRef.get();
  if (!rec.exists) fail('not-found', 'That record no longer exists.');

  // daily limit per person
  const day = dayKey(now, opts.tz || 'America/Toronto');
  const limRef = db.collection('emailLimits').doc(callerUid);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(limRef);
    const cur = s.exists && s.get('day') === day ? s.get('n') || 0 : 0;
    if (cur >= PER_DAY) fail('resource-exhausted', `You've sent ${PER_DAY} emails today, the daily limit. Try again tomorrow.`);
    tx.set(limRef, { day, n: cur + 1 });
  });

  const myEmail = String(me.get('email') || '').toLowerCase();
  const myName = String(me.get('displayName') || '').trim();
  const mail = {
    from: { name: opts.fromName || myName || opts.from, address: opts.from },
    to, cc: cc.length ? cc : undefined,
    bcc: data.copyMe && myEmail && !to.includes(myEmail) && !cc.includes(myEmail) ? [myEmail] : undefined,
    replyTo: myEmail && EMAIL.test(myEmail) ? (myName ? { name: myName, address: myEmail } : myEmail) : undefined,
    subject,
    text: message,
    attachments: attach ? [{ filename: fileName, content: pdf, contentType: 'application/pdf' }] : [],
  };
  let info;
  try {
    info = await send(mail);
  } catch (e) {
    const auth = /535|auth|credentials|Username and Password/i.test(String(e && (e.responseCode || e.message)));
    fail(auth ? 'failed-precondition' : 'unavailable', auth ? 'Gmail refused the app password. Make a new one and store it again (see the install steps).' : 'Gmail didn’t accept the email just now. Try again in a minute.');
  }
  const logRef = recRef.collection('emails').doc();
  let pdfPath = null;
  if (opts.save && attach) {
    const path = `sentEmails/${recordId}/${logRef.id}.pdf`;
    try { await opts.save(path, pdf, fileName); pdfPath = path; } catch (e) { if (opts.onSaveError) opts.onSaveError(e); }
  }
  const log = { to, cc, copyMe: !!mail.bcc, subject, message, fileName, bytes: pdf.length, pdfPath, by: callerUid, byName: myName || myEmail, at: now, messageId: (info && info.messageId) || null };
  await logRef.set(log);
  return { sent: to.length + cc.length, to, cc, id: logRef.id };
}

const MAX_DELETE = 500;
async function deleteSentEmails(db, remove, callerUid, data) {
  if (!callerUid) fail('unauthenticated', 'Sign in first.');
  const me = await db.collection('users').doc(callerUid).get();
  if (!me.exists || me.get('role') !== 'admin') fail('permission-denied', 'Only administrators can delete sent emails.');
  const recordId = data && typeof data.recordId === 'string' ? data.recordId : '';
  if (!recordId || recordId.includes('/')) fail('invalid-argument', 'Say which record.');
  const col = db.collection('records').doc(recordId).collection('emails');
  let snaps;
  if (data.all === true) {
    snaps = (await col.limit(MAX_DELETE).get()).docs;
  } else {
    const ids = [...new Set((Array.isArray(data.ids) ? data.ids : []).filter((x) => typeof x === 'string' && x && !x.includes('/')))];
    if (!ids.length) fail('invalid-argument', 'Say which email to delete.');
    if (ids.length > MAX_DELETE) fail('invalid-argument', `Delete ${MAX_DELETE} at most at a time.`);
    snaps = (await Promise.all(ids.map((id) => col.doc(id).get()))).filter((s) => s.exists);
  }
  if (!snaps.length) fail('not-found', 'Those emails were already deleted.');
  const deleted = [];
  const batch = db.batch();
  for (const s of snaps) {
    const d = s.data() || {};
    deleted.push({ id: s.id, subject: d.subject || '', to: d.to || [], cc: d.cc || [], at: d.at || null, byName: d.byName || '', fileName: d.fileName || '' });
    batch.delete(s.ref);
  }
  await batch.commit();
  // the kept PDFs: by their noted path, and by the usual name in case the note is missing
  await Promise.all(snaps.map(async (s) => {
    const paths = new Set([`sentEmails/${recordId}/${s.id}.pdf`]);
    const noted = (s.data() || {}).pdfPath;
    if (typeof noted === 'string' && noted.startsWith(`sentEmails/${recordId}/`)) paths.add(noted);
    for (const p of paths) { try { await remove(p); } catch (e) { /* already gone */ } }
  }));
  return { deleted: deleted.sort((a, b) => (b.at || 0) - (a.at || 0)) };
}

/** One line about a sent email, for the audit trail: “Subject” to a@x.com, b@y.com (Cc c@z.com) */
function emailLine(e) {
  return `“${e.subject || '(no subject)'}” to ${(e.to || []).join(', ') || 'nobody'}${(e.cc || []).length ? ' (Cc ' + e.cc.join(', ') + ')' : ''}`;
}

module.exports = { sendRecordEmail, deleteSentEmails, emailLine, safeFileName, EMAIL, MAX_TO, PER_DAY };
