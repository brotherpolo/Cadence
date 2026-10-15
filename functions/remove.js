/* Remove a person (Formwright → Users → Remove). Runs on the server because only a trusted
 * server may delete someone else's sign-in.
 *
 *   - only an administrator may call it; nobody removes themselves or the last administrator
 *   - their Formwright records stay; with giveTo they're handed to that person
 *   - Cadence: tasks they own are deleted; tasks given to them go back to the owner, unassigned
 *   - their account, private settings, directory entry and push settings are deleted
 *   - private reports, dashboards and list views go; shared ones pass to the admin removing them
 *   - their display name stays on profiles/{uid} with removed: true, so old records still show
 *     whose they were ("Jane Smith (removed)")
 *   - finally their sign-in is deleted
 *
 * removeAccount(db, auth, callerUid, { uid, giveTo }) → counts. db/auth are firebase-admin's
 * (or fakes in tests/unit). Throws { code, message } for the caller to show. */
const PAGE = 400;

function fail(code, message) { const e = new Error(message); e.code = code; throw e; }

/** every doc matching field == value, in pages */
async function each(db, col, field, value, fn) {
  let n = 0;
  for (;;) {
    const snap = await db.collection(col).where(field, '==', value).limit(PAGE).get();
    if (snap.empty) return n;
    const b = db.batch();
    let changed = 0;
    snap.docs.forEach((d) => { if (fn(b, d) !== false) changed++; });
    if (!changed) return n; // nothing left to change (fn skipped them all)
    await b.commit();
    n += changed;
    if (snap.size < PAGE) return n;
  }
}

async function removeAccount(db, auth, callerUid, data) {
  const uid = data && typeof data.uid === 'string' ? data.uid : '';
  const giveTo = data && typeof data.giveTo === 'string' && data.giveTo ? data.giveTo : null;
  if (!callerUid) fail('unauthenticated', 'Sign in first.');
  if (!uid) fail('invalid-argument', 'Say who to remove.');
  if (uid === callerUid) fail('failed-precondition', 'You can’t remove yourself.');
  const callerSnap = await db.collection('users').doc(callerUid).get();
  if (!callerSnap.exists || callerSnap.get('role') !== 'admin') fail('permission-denied', 'Only administrators can remove people.');
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const user = userSnap.exists ? userSnap.data() : null;
  if (user && user.role === 'admin') {
    const admins = await db.collection('users').where('role', '==', 'admin').get();
    if (admins.size <= 1) fail('failed-precondition', 'You can’t remove the last administrator.');
  }
  if (giveTo) {
    if (giveTo === uid) fail('invalid-argument', 'Pick someone else to give the records to.');
    const g = await db.collection('users').doc(giveTo).get();
    if (!g.exists) fail('not-found', 'The person to give the records to wasn’t found.');
  }
  const now = Date.now();
  const out = { records: 0, tasksDeleted: 0, tasksReturned: 0, shared: 0 };

  // Formwright records: hand over when asked (createdBy stays, as history)
  if (giveTo) out.records = await each(db, 'records', 'ownerId', uid, (b, d) => { b.update(d.ref, { ownerId: giveTo, updatedAt: now, updatedBy: callerUid }); });

  // Cadence tasks
  out.tasksDeleted = await each(db, 'tasks', 'ownerId', uid, (b, d) => { b.delete(d.ref); });
  out.tasksReturned = await each(db, 'tasks', 'assigneeId', uid, (b, d) => {
    const t = d.data();
    b.update(d.ref, { assigneeId: null, assigneeName: null, assigneeEmail: null, members: [t.ownerId], updatedAt: now });
  });

  // reports, dashboards and list views: private ones go, shared ones pass to the admin
  for (const col of ['reportDefs', 'dashboards', 'listViews']) {
    await each(db, col, 'ownerId', uid, (b, d) => {
      if (d.get('shared') === true) { b.update(d.ref, { ownerId: callerUid, updatedAt: now }); out.shared++; } else b.delete(d.ref);
    });
  }

  // private Cadence items, push settings and devices, reminder state, directory entry
  const b = db.batch();
  ['settings', 'map', 'board'].forEach((id) => b.delete(userRef.collection('items').doc(id)));
  const devices = await db.collection('notify').doc(uid).collection('devices').get();
  devices.docs.forEach((d) => b.delete(d.ref));
  b.delete(db.collection('notify').doc(uid));
  b.delete(db.collection('notifyState').doc(uid));
  const people = await db.collection('people').where('uid', '==', uid).get();
  people.docs.forEach((d) => b.delete(d.ref));
  // keep the name (records and history still show it), mark as removed
  const prof = await db.collection('profiles').doc(uid).get();
  const name = (prof.exists && prof.get('displayName')) || (user && (user.displayName || String(user.email || '').split('@')[0])) || 'Someone';
  b.set(db.collection('profiles').doc(uid), { displayName: name, removed: true, removedAt: now, removedBy: callerUid });
  b.delete(userRef);
  await b.commit();

  // the sign-in itself
  try { await auth.deleteUser(uid); } catch (e) { if (!(e && e.code === 'auth/user-not-found')) throw e; }
  out.name = name;
  return out;
}

module.exports = { removeAccount };
