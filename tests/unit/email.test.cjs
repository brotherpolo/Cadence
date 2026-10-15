// Email PDF (functions/email.js) with a stand-in Firestore and a stand-in for Gmail.
// Run from tests/: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const { sendRecordEmail, safeFileName } = require('../../functions/email.js');

function fakeDb(seed) {
  const m = new Map(Object.entries(seed));
  const snap = (path) => ({ id: path.split('/').pop(), exists: m.has(path), data: () => m.get(path), get: (k) => (m.get(path) || {})[k] });
  let n = 0;
  function ref(path) { return { path, get: async () => snap(path), set: async (d) => m.set(path, d), collection: (c) => col(path + '/' + c) }; }
  function col(path) { return { doc: (id) => ref(path + '/' + (id || 'auto' + ++n)) }; }
  return {
    m, collection: col,
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
  assert.deepEqual(out, { sent: 1, to: ['sam@client.com'], cc: [] });
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
