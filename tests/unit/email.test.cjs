// Email PDF (functions/email.js) with a stand-in Firestore and a stand-in for Gmail.
// Run from tests/: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const { sendRecordEmail, deleteSentEmails, emailLine, safeFileName } = require('../../functions/email.js');

function fakeDb(seed) {
  const m = new Map(Object.entries(seed));
  const snap = (path) => ({ id: path.split('/').pop(), exists: m.has(path), data: () => m.get(path), get: (k) => (m.get(path) || {})[k], get ref() { return ref(path); } });
  let n = 0;
  function ref(path) { return { path, id: path.split('/').pop(), get: async () => snap(path), set: async (d) => m.set(path, d), collection: (c) => col(path + '/' + c) }; }
  const under = (path) => [...m.keys()].filter((k) => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/'));
  function col(path) {
    return { doc: (id) => ref(path + '/' + (id || 'auto' + ++n)),
      limit: (k) => ({ get: async () => ({ docs: under(path).slice(0, k).map((p) => ({ ...snap(p), ref: ref(p) })) }) }) };
  }
  return {
    m, collection: col,
    batch() { const ops = []; return { delete: (r) => ops.push(() => m.delete(r.path)), commit: async () => ops.forEach((f) => f()) }; },
    async runTransaction(fn) { const ops = []; const out = await fn({ get: async (r) => snap(r.path), set: (r, d) => ops.push(() => m.set(r.path, d)) }); ops.forEach((f) => f()); return out; },
  };
}
const PDF = Buffer.from('%PDF-1.7\n...').toString('base64');
const seed = () => ({
  'users/boss': { role: 'admin', email: 'Boss@Example.com', displayName: 'Adam' },
  'users/amy': { role: 'member', email: 'amy@example.com' },
  'records/r1': { formId: 'f_inv', values: {} },
});
const ok = (extra = {}) => ({ recordId: 'r1', to: ['Sam@Client.com'], cc: [], copyMe: true, subject: 'Invoice 58', message: 'Hello\r\nThanks', pdf: PDF, fileName: 'Invoices - 58.pdf', ...extra });
const OPTS = { from: 'sender@gmail.com', ready: true, fromName: 'Pollack Renovations Inc.', now: Date.UTC(2026, 9, 15, 2) };
const gmail = () => { const sent = []; const send = async (mail) => { sent.push(mail); return { messageId: '<id' + sent.length + '>' }; }; send.sent = sent; return send; };

test('an admin sends: from the company, replies to the sender, PDF attached, logged on the record', async () => {
  const db = fakeDb(seed()), send = gmail();
  const out = await sendRecordEmail(db, send, 'boss', ok(), OPTS);
  assert.deepEqual({ ...out, id: undefined }, { sent: 1, to: ['sam@client.com'], cc: [], id: undefined });
  const mail = send.sent[0];
  assert.deepEqual(mail.from, { name: 'Pollack Renovations Inc.', address: 'sender@gmail.com' });
  assert.deepEqual(mail.replyTo, { name: 'Adam', address: 'boss@example.com' });
  assert.deepEqual(mail.bcc, ['boss@example.com'], 'Send me a copy');
  assert.equal(mail.text, 'Hello\nThanks');
  assert.equal(mail.attachments[0].filename, 'Invoices - 58.pdf');
  assert.equal(mail.attachments[0].content.subarray(0, 5).toString(), '%PDF-');
  const log = [...db.m].find(([k]) => k.startsWith('records/r1/emails/'))[1];
  assert.deepEqual([log.to, log.subject, log.by, log.byName, log.messageId], [['sam@client.com'], 'Invoice 58', 'boss', 'Adam', '<id1>']);
});

test('checks before anything is sent', async () => {
  const rejects = async (p, code) => assert.rejects(p, (e) => e.code === code);
  const send = gmail();
  await rejects(sendRecordEmail(fakeDb(seed()), send, 'amy', ok(), OPTS), 'permission-denied');
  await rejects(sendRecordEmail(fakeDb(seed()), send, null, ok(), OPTS), 'unauthenticated');
  await rejects(sendRecordEmail(fakeDb(seed()), send, 'boss', ok(), { ...OPTS, ready: false }), 'failed-precondition');
  await rejects(sendRecordEmail(fakeDb(seed()), send, 'boss', ok({ to: [] }), OPTS), 'invalid-argument');
  await rejects(sendRecordEmail(fakeDb(seed()), send, 'boss', ok({ to: ['not an email'] }), OPTS), 'invalid-argument');
  await rejects(sendRecordEmail(fakeDb(seed()), send, 'boss', ok({ to: Array.from({ length: 11 }, (_, i) => `p${i}@x.com`) }), OPTS), 'invalid-argument');
  await rejects(sendRecordEmail(fakeDb(seed()), send, 'boss', ok({ subject: '  ' }), OPTS), 'invalid-argument');
  await rejects(sendRecordEmail(fakeDb(seed()), send, 'boss', ok({ pdf: Buffer.from('<html>').toString('base64') }), OPTS), 'invalid-argument');
  await rejects(sendRecordEmail(fakeDb(seed()), send, 'boss', ok({ recordId: 'gone' }), OPTS), 'not-found');
  assert.equal(send.sent.length, 0);
});

test('a subject can’t carry extra lines; file names are made safe', async () => {
  const send = gmail();
  await sendRecordEmail(fakeDb(seed()), send, 'boss', ok({ subject: 'Hi\r\nBcc: evil@x.com', cc: ['sam@client.com', 'b@c.com'], copyMe: false, fileName: '../x' }), OPTS);
  assert.equal(send.sent[0].subject, 'Hi Bcc: evil@x.com');
  assert.deepEqual(send.sent[0].cc, ['b@c.com'], 'an address already in To isn’t repeated in Cc');
  assert.equal(send.sent[0].bcc, undefined);
  assert.equal(safeFileName('../x'), '.. x.pdf');
  assert.equal(safeFileName(''), 'Record.pdf');
});

test('100 emails per person per day', async () => {
  const db = fakeDb({ ...seed(), 'emailLimits/boss': { day: '2026-10-14', n: 100 } });
  await assert.rejects(sendRecordEmail(db, gmail(), 'boss', ok(), OPTS), (e) => e.code === 'resource-exhausted');
  db.m.set('emailLimits/boss', { day: '2026-10-13', n: 100 });
  await sendRecordEmail(db, gmail(), 'boss', ok(), OPTS);
  assert.deepEqual(db.m.get('emailLimits/boss'), { day: '2026-10-14', n: 1 }, 'a new day starts again (Toronto time)');
});

test('Gmail refusing the password says what to fix', async () => {
  const send = async () => { const e = new Error('Invalid login: 535-5.7.8 Username and Password not accepted'); e.responseCode = 535; throw e; };
  await assert.rejects(sendRecordEmail(fakeDb(seed()), send, 'boss', ok(), OPTS), (e) => e.code === 'failed-precondition' && /app password/.test(e.message));
});

test('Gmail refusing the password: in words, with where to make a new one (EAUTH too); a hiccup just says try again', async () => {
  const eauth = async () => { const e = new Error('Invalid login'); e.code = 'EAUTH'; throw e; };
  await assert.rejects(sendRecordEmail(fakeDb(seed()), eauth, 'boss', ok(), OPTS), (e) => e.code === 'failed-precondition' && /didn’t accept the app password, so nothing was sent/.test(e.message) && /myaccount\.google\.com\/apppasswords/.test(e.message));
  const hiccup = async () => { const e = new Error('Connection timeout'); e.code = 'ETIMEDOUT'; throw e; };
  await assert.rejects(sendRecordEmail(fakeDb(seed()), hiccup, 'boss', ok(), OPTS), (e) => e.code === 'unavailable' && /Try again in a minute/.test(e.message));
  await assert.rejects(sendRecordEmail(fakeDb(seed()), eauth, 'boss', ok(), { ...OPTS, ready: false }), (e) => e.code === 'failed-precondition' && /isn’t set up yet/.test(e.message));
});

test('the PDF is kept with the message, so it can be opened from Sent emails', async () => {
  const db = fakeDb(seed()), kept = [];
  const out = await sendRecordEmail(db, gmail(), 'boss', ok(), { ...OPTS, save: async (path, pdf, name) => kept.push([path, pdf.subarray(0, 5).toString(), name]) });
  assert.deepEqual(kept, [[`sentEmails/r1/${out.id}.pdf`, '%PDF-', 'Invoices - 58.pdf']]);
  const log = db.m.get(`records/r1/emails/${out.id}`);
  assert.deepEqual([log.pdfPath, log.message, log.fileName], [`sentEmails/r1/${out.id}.pdf`, 'Hello\nThanks', 'Invoices - 58.pdf']);
  // keeping it fails: the email still went, and the log says there's no copy
  const db2 = fakeDb(seed()), errs = [];
  const out2 = await sendRecordEmail(db2, gmail(), 'boss', ok(), { ...OPTS, save: async () => { throw new Error('storage down'); }, onSaveError: (e) => errs.push(e.message) });
  assert.equal(db2.m.get(`records/r1/emails/${out2.id}`).pdfPath, null);
  assert.deepEqual(errs, ['storage down']);
});

test('without the PDF: nothing is kept, and the log says so', async () => {
  const db = fakeDb(seed()), kept = [];
  const { pdf, fileName, ...rest } = ok();
  const out = await sendRecordEmail(db, gmail(), 'boss', { ...rest, attach: false }, { ...OPTS, save: async (path) => kept.push(path) });
  assert.deepEqual(kept, []);
  const log = db.m.get(`records/r1/emails/${out.id}`);
  assert.deepEqual([log.pdfPath, log.fileName, log.bytes], [null, null, 0]);
});

test('deleting sent emails: admins only; one, or all; their PDFs go too', async () => {
  const s = seed();
  s['records/r1/emails/e1'] = { subject: 'Invoice 58', to: ['sam@client.com'], cc: [], at: 1, byName: 'Adam', pdfPath: 'sentEmails/r1/e1.pdf' };
  s['records/r1/emails/e2'] = { subject: 'Invoice 58 again', to: ['sam@client.com'], cc: ['b@c.com'], at: 2, byName: 'Adam' };
  s['records/r1/emails/e3'] = { subject: 'Reminder', to: ['sam@client.com'], cc: [], at: 3, byName: 'Adam', pdfPath: 'sentEmails/r1/e3.pdf' };
  s['records/r2/emails/x1'] = { subject: 'Other record', to: ['z@z.com'], at: 4 };
  const db = fakeDb(s), removed = [];
  const remove = async (p) => removed.push(p);
  const rejects = (p, code) => assert.rejects(p, (e) => e.code === code);
  await rejects(deleteSentEmails(db, remove, 'amy', { recordId: 'r1', ids: ['e1'] }), 'permission-denied');
  await rejects(deleteSentEmails(db, remove, null, { recordId: 'r1', ids: ['e1'] }), 'unauthenticated');
  await rejects(deleteSentEmails(db, remove, 'boss', { recordId: 'r1', ids: [] }), 'invalid-argument');
  await rejects(deleteSentEmails(db, remove, 'boss', { recordId: 'r1/emails', ids: ['e1'] }), 'invalid-argument');
  await rejects(deleteSentEmails(db, remove, 'boss', { recordId: 'r1', ids: ['nope'] }), 'not-found');

  const one = await deleteSentEmails(db, remove, 'boss', { recordId: 'r1', ids: ['e1'] });
  assert.deepEqual(one.deleted.map((e) => [e.id, e.subject]), [['e1', 'Invoice 58']]);
  assert.ok(!db.m.has('records/r1/emails/e1') && db.m.has('records/r1/emails/e2'));
  assert.deepEqual(removed, ['sentEmails/r1/e1.pdf']);

  removed.length = 0;
  const all = await deleteSentEmails(db, remove, 'boss', { recordId: 'r1', all: true });
  assert.deepEqual(all.deleted.map((e) => e.id), ['e3', 'e2'], 'newest first');
  assert.ok(!db.m.has('records/r1/emails/e2') && !db.m.has('records/r1/emails/e3'));
  assert.ok(db.m.has('records/r2/emails/x1'), 'other records keep theirs');
  assert.deepEqual(removed.sort(), ['sentEmails/r1/e2.pdf', 'sentEmails/r1/e3.pdf']);
  await rejects(deleteSentEmails(db, remove, 'boss', { recordId: 'r1', all: true }), 'not-found');
  assert.equal(emailLine(all.deleted[1]), '“Invoice 58 again” to sam@client.com (Cc b@c.com)');
});
