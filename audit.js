/* Audit trail (Formwright → Administration → Audit trail).
 *
 * Every change an administrator might need to look back on, in one collection, audit/{id},
 * written only here (firestore.rules: admins read, nobody writes from the apps). Kept forever.
 *
 *   recordEntry(before, after, form, who)   a record created, changed, moved, given to someone
 *                                           else, or deleted (with a copy, so it can be restored)
 *   formEntry / groupEntry / userEntry / settingsEntry
 *                                           form designs, security groups, accounts (role,
 *                                           groups, Cadence), PDF export settings
 *   restoreRecord(db, callerUid, { auditId })
 *                                           admins: bring back a deleted record (within 90 days)
 *
 * Entry: { at, by, byName, area, kind, formId, formName, recordId, title, targetId, targetName,
 *          changes: [{ key, label, type, from, to }], note, snapshot }
 * Values are kept raw (the app shows them the way it shows fields); long text is shortened,
 * a signature is noted as signed, and a file or photo by its name. */
const RESTORE_DAYS = 90;
const MAX_TEXT = 1000;

function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null) || (empty(a) && empty(b));

/** A value as the audit keeps it. */
function auditValue(v, type) {
  if (empty(v)) return null;
  if (type === 'signature') return 'signed';
  if ((type === 'file' || type === 'image') && typeof v === 'object') return { name: String(v.name || 'File').slice(0, 200) };
  if (typeof v === 'string') return v.length > MAX_TEXT ? v.slice(0, MAX_TEXT) + '…' : v;
  if (typeof v === 'object') { const s = JSON.stringify(v); return s.length > MAX_TEXT ? JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'string' && x.length > 200 ? x.slice(0, 200) + '…' : x))) : v; }
  return v;
}

/** The record's title, roughly as the app shows it. */
function titleOf(rec, form) {
  if (!rec) return '';
  const fs = ((form && form.fields) || []).filter((f) => f && f.type !== 'heading');
  const tf = fs.find((f) => f.id === (form && form.titleField)) || fs.find((f) => ['text', 'email', 'phone', 'url'].includes(f.type)) || fs[0];
  if (!tf) return '';
  const v = (rec.nums || {})[tf.id] ?? (rec.values || {})[tf.id];
  if (empty(v)) return '';
  if (typeof v === 'object') return String(v.address || v.name || '').slice(0, 200);
  return String(v).slice(0, 200);
}

const formName = (form) => (form && form.name) || '';

/**
 * A record write → an audit entry (or null when nothing worth noting changed).
 * who: { by, byName }. before/after: the documents' data (null when created / deleted).
 */
function recordEntry(recordId, before, after, form, who, now) {
  const base = { at: now, by: who.by, byName: who.byName, area: 'record', recordId, formId: (after || before).formId, formName: formName(form) };
  if (!before && after) return { ...base, kind: 'created', title: titleOf(after, form), changes: fieldChanges({}, after, form).filter((c) => c.to != null) };
  if (before && !after) {
    let snapshot = { ...before };
    if (JSON.stringify(snapshot).length > 800000) { // keep under Firestore's 1 MB: drop signatures and long text from the copy
      const values = { ...(snapshot.values || {}) };
      ((form && form.fields) || []).forEach((f) => { if (f.type === 'signature' || f.type === 'textarea') delete values[f.id]; });
      snapshot = { ...snapshot, values, trimmed: true };
    }
    return { ...base, kind: 'deleted', title: titleOf(before, form), snapshot };
  }
  const changes = fieldChanges(before, after, form);
  const extra = [];
  if ((before.parentId || null) !== (after.parentId || null)) extra.push({ key: 'parent', label: 'Belongs to', type: 'parent', from: before.parentId || null, to: after.parentId || null, fromForm: before.parentFormId || null, toForm: after.parentFormId || null });
  if (before.ownerId !== after.ownerId) extra.push({ key: 'owner', label: 'Owner', type: 'person', from: before.ownerId || null, to: after.ownerId || null });
  const all = changes.concat(extra);
  if (!all.length) return null;
  const kind = changes.length ? 'changed' : extra[0].key === 'parent' ? 'moved' : 'owner';
  return { ...base, kind, title: titleOf(after, form), changes: all };
}

function fieldChanges(before, after, form) {
  const bv = { ...((before && before.values) || {}), ...((before && before.nums) || {}) };
  const av = { ...((after && after.values) || {}), ...((after && after.nums) || {}) };
  const fields = ((form && form.fields) || []).filter((f) => f && f.type !== 'heading' && f.type !== 'formula');
  const known = new Set(fields.map((f) => f.id));
  const out = [];
  const br = bv._rich || {}, ar = av._rich || {};
  fields.forEach((f) => {
    if (!same(bv[f.id], av[f.id])) out.push({ key: f.id, label: f.label || 'Untitled field', type: f.type, from: auditValue(bv[f.id], f.type), to: auditValue(av[f.id], f.type) });
    // formatted long text: the words stayed the same, the formatting changed
    else if (f.type === 'textarea' && (br[f.id] || '') !== (ar[f.id] || '')) out.push({ key: f.id, label: (f.label || 'Untitled field') + ' (formatting)', type: 'text', from: null, to: 'changed' });
  });
  // values for fields no longer on the form (rare): still noted
  new Set([...Object.keys(bv), ...Object.keys(av)]).forEach((k) => {
    if (k === '_rich' || known.has(k) || ((form && form.fields) || []).some((f) => f.id === k)) return;
    if (!same(bv[k], av[k])) out.push({ key: k, label: k, type: 'text', from: auditValue(bv[k]), to: auditValue(av[k]) });
  });
  return out;
}

/** Form designs: created, deleted, renamed; fields added, removed, renamed or retyped; settings. */
function formEntry(formId, before, after, who, now) {
  const base = { at: now, by: who.by, byName: who.byName, area: 'form', formId, formName: (after || before).name || '', targetId: formId, targetName: (after || before).name || '' };
  if (!before) return { ...base, kind: 'created' };
  if (!after) return { ...base, kind: 'deleted' };
  const changes = [];
  if (before.name !== after.name) changes.push({ key: 'name', label: 'Name', type: 'text', from: before.name || '', to: after.name || '' });
  const bf = new Map((before.fields || []).map((f) => [f.id, f])), af = new Map((after.fields || []).map((f) => [f.id, f]));
  af.forEach((f, id) => {
    const o = bf.get(id);
    if (!o) changes.push({ key: 'field:' + id, label: 'Field added', type: 'text', from: null, to: `${f.label || 'Untitled'} (${f.type})` });
    else {
      if (o.label !== f.label) changes.push({ key: 'field:' + id, label: 'Field renamed', type: 'text', from: o.label || '', to: f.label || '' });
      if (o.type !== f.type) changes.push({ key: 'type:' + id, label: `${f.label || 'Field'}: type`, type: 'text', from: o.type, to: f.type });
      const { label: l1, type: t1, ...r1 } = o, { label: l2, type: t2, ...r2 } = f;
      if (o.label === f.label && o.type === f.type && JSON.stringify(r1) !== JSON.stringify(r2)) changes.push({ key: 'set:' + id, label: `${f.label || 'Field'}: settings`, type: 'text', from: null, to: 'changed' });
    }
  });
  bf.forEach((f, id) => { if (!af.has(id)) changes.push({ key: 'field:' + id, label: 'Field removed', type: 'text', from: `${f.label || 'Untitled'} (${f.type})`, to: null }); });
  const bo = (before.fields || []).map((f) => f.id).filter((id) => af.has(id)).join(), ao = (after.fields || []).map((f) => f.id).filter((id) => bf.has(id)).join();
  if (bo !== ao) changes.push({ key: 'order', label: 'Field order', type: 'text', from: null, to: 'changed' });
  const skip = new Set(['name', 'fields', 'updatedAt', 'updatedBy', 'order']);
  [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !skip.has(k)).forEach((k) => {
    if (!same(before[k], after[k])) {
      const short = (v) => (v == null ? null : typeof v === 'object' ? 'changed' : auditValue(v));
      changes.push({ key: 'prop:' + k, label: PROP_LABEL[k] || k, type: 'text', from: typeof before[k] === 'object' ? null : short(before[k]), to: short(after[k]) });
    }
  });
  return changes.length ? { ...base, kind: 'changed', changes } : null;
}
const PROP_LABEL = { itemName: 'One record is called', titleField: 'Record title comes from', description: 'Description', color: 'Color', showInSidebar: 'Show in sidebar', children: 'Sub-forms and child forms', sectionOrder: 'Section order', inheritAccess: 'Rows follow the parent’s access', emailSubject: 'Email subject', emailMessage: 'Email message' };

const LEVEL = { none: 'None', own: 'Own', all: 'All' };
const lvl = (a) => (a ? `view ${LEVEL[a.view] || a.view || '?'}, edit ${LEVEL[a.edit] || a.edit || '?'}` : null);

/** Security groups: created, deleted, renamed, access per form. formNames: Map(id → name). */
function groupEntry(groupId, before, after, who, now, formNames = new Map()) {
  const base = { at: now, by: who.by, byName: who.byName, area: 'group', targetId: groupId, targetName: (after || before).name || '' };
  if (!before) return { ...base, kind: 'created' };
  if (!after) return { ...base, kind: 'deleted' };
  const changes = [];
  if (before.name !== after.name) changes.push({ key: 'name', label: 'Name', type: 'text', from: before.name || '', to: after.name || '' });
  if ((before.description || '') !== (after.description || '')) changes.push({ key: 'description', label: 'Description', type: 'text', from: before.description || '', to: after.description || '' });
  const ba = before.access || {}, aa = after.access || {};
  [...new Set([...Object.keys(ba), ...Object.keys(aa)])].forEach((k) => {
    if (!same(ba[k], aa[k])) changes.push({ key: 'access:' + k, label: k === '*' ? 'Access: every form' : `Access: ${formNames.get(k) || k}`, type: 'text', from: lvl(ba[k]), to: lvl(aa[k]) });
  });
  return changes.length ? { ...base, kind: 'changed', changes } : null;
}

/** Accounts: new sign-ins, role, security groups, Cadence approval. (Access maps are worked out from groups, so not repeated.) */
function userEntry(userId, before, after, who, now, groupNames = new Map(), names = new Map()) {
  const d = after || before;
  const name = names.get(userId) || d.displayName || String(d.email || '').split('@')[0] || 'Someone';
  const base = { at: now, by: who.by, byName: who.byName, area: 'user', targetId: userId, targetName: name };
  if (!before) return { ...base, kind: 'created', note: 'First sign-in' + (d.email ? ` (${d.email})` : '') };
  if (!after) return { ...base, kind: 'deleted' };
  const changes = [];
  if ((before.role || 'member') !== (after.role || 'member')) changes.push({ key: 'role', label: 'Role', type: 'text', from: before.role || 'member', to: after.role || 'member' });
  const gn = (ids) => (ids || []).map((g) => groupNames.get(g) || g).sort();
  if (!same([...(before.groups || [])].sort(), [...(after.groups || [])].sort())) changes.push({ key: 'groups', label: 'Security groups', type: 'multiselect', from: gn(before.groups), to: gn(after.groups) });
  if (!!before.cadence !== !!after.cadence) changes.push({ key: 'cadence', label: 'Can use Cadence', type: 'checkbox', from: !!before.cadence, to: !!after.cadence });
  return changes.length ? { ...base, kind: 'changed', changes } : null;
}

/** PDF export settings. */
function settingsEntry(id, before, after, who, now) {
  const base = { at: now, by: who.by, byName: who.byName, area: 'settings', targetId: id, targetName: id === 'exports' ? 'PDF exports' : id };
  const b = before || {}, a = after || {};
  const changes = [];
  if ((b.companyName || '') !== (a.companyName || '')) changes.push({ key: 'companyName', label: 'Company name', type: 'text', from: b.companyName || null, to: a.companyName || null });
  if ((b.logo || null) !== (a.logo || null)) changes.push({ key: 'logo', label: 'Logo', type: 'text', from: b.logo ? 'a logo' : null, to: a.logo ? 'a new logo' : null });
  return changes.length ? { ...base, kind: 'changed', changes } : null;
}

/** Admins: bring a deleted record back from its audit entry (same ID, so its rows and links reconnect). */
async function restoreRecord(db, callerUid, data, now = Date.now()) {
  const auditId = data && typeof data.auditId === 'string' ? data.auditId : '';
  if (!callerUid) fail('unauthenticated', 'Sign in first.');
  if (!auditId) fail('invalid-argument', 'Say which deletion to undo.');
  const me = await db.collection('users').doc(callerUid).get();
  if (!me.exists || me.get('role') !== 'admin') fail('permission-denied', 'Only administrators can restore records.');
  const aRef = db.collection('audit').doc(auditId);
  const a = await aRef.get();
  if (!a.exists || a.get('kind') !== 'deleted' || a.get('area') !== 'record' || !a.get('snapshot')) fail('not-found', 'That isn’t a deleted record.');
  if (a.get('restoredAt')) fail('failed-precondition', 'That record has already been restored.');
  if (now - (a.get('at') || 0) > RESTORE_DAYS * 864e5) fail('failed-precondition', `Records can be restored for ${RESTORE_DAYS} days after they’re deleted.`);
  const recordId = a.get('recordId');
  const recRef = db.collection('records').doc(recordId);
  const formSnap = await db.collection('forms').doc(a.get('snapshot').formId).get();
  if (!formSnap.exists) fail('failed-precondition', `Its form (${a.get('formName') || 'deleted'}) no longer exists. Recreate the form first.`);
  const snap = { ...a.get('snapshot') };
  delete snap.trimmed;
  const parentGone = snap.parentId ? !(await db.collection('records').doc(snap.parentId).get()).exists : false;
  if (parentGone) { snap.parentId = null; snap.parentFormId = null; }
  await db.runTransaction(async (tx) => {
    const cur = await tx.get(recRef);
    if (cur.exists) fail('already-exists', 'A record with that ID is back already.');
    tx.set(recRef, { ...snap, updatedAt: now, updatedBy: callerUid });
    tx.update(aRef, { restoredAt: now, restoredBy: callerUid });
  });
  return { recordId, formId: snap.formId, parentGone, trimmed: !!a.get('snapshot').trimmed };
}

module.exports = { recordEntry, formEntry, groupEntry, userEntry, settingsEntry, restoreRecord, auditValue, titleOf, RESTORE_DAYS };
