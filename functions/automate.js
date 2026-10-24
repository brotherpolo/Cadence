/* Formwright automations: "When an Invoice changes and Status is Approved, create a Cadence
 * task…". Admins set them up in Formwright (Administration → Automations); they're stored in
 * automations/{id} and run here, so they work whatever changed the record (a phone, an
 * import, Set field, another automation) and on dates when nobody is signed in.
 *
 *   automation = {
 *     name, formId, on,
 *     trigger: { type: 'created' | 'changed' | 'date' | 'emailed',
 *                field?, op?, value?          changed: this field changed (and now "op value")
 *                dateField?, days?, rel?  }   date: N days 'before' | 'after' the date, or 'on' it
 *     join: 'all' | 'any', conds: [...]       only if… (rules.js conditions; the parent's fields too)
 *     acts: [
 *       { do: 'set',   target: 'self' | 'parent', parentForm?, sets: [{ field, mode: 'value'|'today'|'clear'|'copy', value, from }] },
 *       { do: 'task',  title, notes, assign: 'owner'|'actor'|'person', person, dueDays },
 *       { do: 'email', to: { fields: [], parentFields: [], people: [], roles: [], owner, addresses }, subject, message, pdf },
 *       { do: 'child', formId, copy, sets: [...] },
 *     ],
 *   }
 *
 * The parts here are plain functions (unit-tested): what a trigger matches, whether the
 * conditions hold, and the plan of what an automation would do. index.js loads the data,
 * carries the plan out and keeps the run log (automations/{id}/runs) and the audit trail. */
const fw = require('./fwkit.cjs');

const MAX_DEPTH = 3;
const an = (w) => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const EMAIL = /^[^\s@<>(),;:"\[\]\\]+@[^\s@<>(),;:"\[\]\\]+\.[^\s@<>(),;:"\[\]\\]{2,}$/;

/** "2026-10-15" in a time zone */
const dayKey = (ms, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const addDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const localNow = (ms, tz) => { const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms)); const g = (k) => p.find((x) => x.type === k).value; return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`; };

/** How deep in a chain this write is: 0 when a person (or an import) made it. */
function depthOf(before, after) {
  if (!after || !after.auto) return 0;
  if (before && same(before.auto, after.auto)) return 0;
  return Number(after.auto.depth) || 0;
}
/** The automation that made this write, if one did. */
const madeBy = (before, after) => (after && after.auto && !(before && same(before.auto, after.auto)) ? after.auto.id : null);

/** A record that just arrived at a workflow stage: { stage, assignee, assigneeGroup, assigneeRole } or null. */
function stageArrival(form, before, after) {
  const wf = form && form.workflow;
  if (!wf || !wf.on || !after || !after.stage || (before && before.stage === after.stage)) return null;
  const stage = (wf.stages || []).find((s) => s.id === after.stage);
  return stage ? { stage, assignee: after.assignee || null, assigneeGroup: after.assigneeGroup || null, assigneeRole: after.assigneeRole || null } : null;
}

const fieldVal = (f, rec) => (f.type === 'autonumber' ? rec?.nums?.[f.id] : rec?.values?.[f.id]);

/**
 * Does the trigger match this event? ev = { kind, before, after, form }.
 * "changed" needs the record's values to change; with a field, that field; with "to", the field
 * must now match and not have matched before (Status *becomes* Approved).
 */
function triggerMatches(a, ev) {
  const t = a.trigger || {};
  if (t.type === 'stage') { // a workflow move: the stage changed (to the chosen one)
    if (ev.kind !== 'changed' && ev.kind !== 'created') return false;
    const b = ev.before?.stage || null, n = ev.after?.stage || null;
    return !!n && n !== b && (!t.to || n === t.to);
  }
  if (t.type !== ev.kind) return false;
  if (ev.kind !== 'changed') return true;
  const { before, after, form } = ev;
  if (!before || !after) return false;
  if (!t.field) return !same(before.values, after.values);
  const f = (form.fields || []).find((x) => x.id === t.field);
  if (!f) return false;
  const b = fieldVal(f, before), n = fieldVal(f, after);
  if (same(b, n)) return false;
  if (!t.op) return true;
  const c = { op: t.op, value: t.value };
  return fw.testCond(c, n, f) && !fw.testCond(c, b, f);
}

/** "Only if" conditions (none = always). look: kit.look(form, rec). */
function condsHold(a, look) {
  const has = (a.conds || []).some((c) => (c.group ? (c.conds || []).some((x) => x.field) : c.field));
  return has ? fw.ruleFires({ join: a.join, conds: a.conds }, look) : true;
}

/** Is today the day for a date trigger? (dates are compared as calendar days) */
function dateDue(a, form, rec, todayKey) {
  const t = a.trigger || {};
  const f = (form.fields || []).find((x) => x.id === t.dateField);
  if (!f) return false;
  const v = String(fieldVal(f, rec) || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const n = Math.max(0, Math.round(Number(t.days) || 0));
  const target = t.rel === 'before' ? addDays(v, -n) : t.rel === 'after' ? addDays(v, n) : v;
  return target === todayKey;
}

/** A value for "set" and "child": typed, today, cleared, or copied from another field. */
function valueFor(s, f, rec, srcForm, now, tz) {
  if (s.mode === 'clear') return { clear: true };
  if (s.mode === 'today') return { v: f.type === 'datetime' ? localNow(now, tz) : f.type === 'time' ? localNow(now, tz).slice(11) : dayKey(now, tz) };
  if (s.mode === 'copy') { const g = (srcForm.fields || []).find((x) => x.id === s.from); return { v: g ? fieldVal(g, rec) ?? null : null }; }
  let v = s.value;
  if (f.type === 'checkbox') v = v === true || v === 'true' || v === 'Yes';
  else if (['number', 'decimal', 'currency', 'percent', 'rating', 'range'].includes(f.type)) v = v === '' || v == null ? null : Number(v);
  else if (f.type === 'multiselect') v = Array.isArray(v) ? v : v ? [v] : [];
  return { v };
}

/** {Field} → this record's field; {Client › Name} → the parent's. */
function templater(k, form, rec, parent, pform, extra) {
  return (tpl) => fw.fillTemplate(tpl, {
    field: (n) => {
      const i = n.indexOf('›');
      if (i > 0 && parent && pform) { const pn = n.slice(0, i).trim().toLowerCase(); if (pn === pform.name.toLowerCase() || pn === fw.itemName(pform).toLowerCase()) return k.fieldText(pform, parent, n.slice(i + 1).trim()); }
      return k.fieldText(form, rec, n);
    },
    title: k.recTitle(rec, form), form: form.name, item: fw.itemName(form), company: extra.company || '', sender: extra.sender || '', date: extra.dateText || '',
  });
}

/**
 * What an automation would do to one record: [{ kind, text, ...details }]. Pure: nothing is
 * written. ctx = { k (kit), form, rec, parent, pform, people: Map(uid → {name,email}), owner (the
 * automation's admin), actor (who made the change), now, tz, company }
 */
function plan(a, ctx) {
  const { k, form, rec, parent, pform, people, now, tz } = ctx;
  const out = [];
  const name = (uid) => people.get(uid)?.name || people.get(uid)?.email || 'someone';
  const dateText = new Date(now).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: tz });
  const fill = templater(k, form, rec, parent, pform, { company: ctx.company, sender: name(ctx.owner), dateText });
  (a.acts || []).forEach((act, i) => {
    if (act.do === 'set') {
      const onParent = act.target === 'parent';
      const tf = onParent ? pform : form, tr = onParent ? parent : rec;
      if (!tf || !tr) { out.push({ kind: 'skip', text: 'Set fields on the parent: this record has no parent' }); return; }
      if (onParent && act.parentForm && tf.id !== act.parentForm) { out.push({ kind: 'skip', text: `Set fields on the parent: its parent is ${an(fw.itemName(tf).toLowerCase())}` }); return; }
      const set = {}, clear = [], words = [];
      (act.sets || []).forEach((s) => {
        const f = (tf.fields || []).find((x) => x.id === s.field);
        if (!f || ['heading', 'formula', 'autonumber'].includes(f.type)) return;
        const r = valueFor(s, f, rec, form, now, tz);
        const cur = tr.values?.[f.id];
        if (r.clear) { if (cur != null && cur !== '' && !(Array.isArray(cur) && !cur.length)) { clear.push(f.id); words.push(`clear ${f.label}`); } return; }
        if (same(cur, r.v)) return;
        set[f.id] = r.v; words.push(`${f.label} to ${k.fmt(f, r.v) || 'empty'}`);
      });
      if (!words.length) { out.push({ kind: 'skip', text: `Set fields${onParent ? ' on the parent' : ''}: already as wanted` }); return; }
      out.push({ kind: 'set', target: onParent ? 'parent' : 'self', recordId: tr.id, formId: tf.id, set, clear, text: `Set ${words.join(', ')}${onParent ? ` on ${tf.name}: ${k.recTitle(tr, tf)}` : ''}` });
    } else if (act.do === 'task') {
      const assignee = act.assign === 'person' ? act.person : act.assign === 'actor' ? ctx.actor || rec.ownerId : rec.ownerId;
      const due = act.dueDays === '' || act.dueDays == null ? null : addDays(dayKey(now, tz), Math.max(0, Math.round(Number(act.dueDays) || 0)));
      const title = fill(act.title || 'Follow up {Title}').slice(0, 500).trim() || 'Follow up';
      out.push({ kind: 'task', title, notes: fill(act.notes || '').slice(0, 20000), assignee: assignee || null, due, text: `Create task “${title}” for ${name(assignee)}${due ? `, due ${due}` : ''}` });
    } else if (act.do === 'email') {
      const to = act.to || {}, list = [];
      const addField = (tf, tr, fid) => { const f = (tf?.fields || []).find((x) => x.id === fid); const v = f && tr ? String(fieldVal(f, tr) || '') : ''; v.split(/[,;\s]+/).forEach((x) => list.push(x)); };
      (to.fields || []).forEach((fid) => addField(form, rec, fid));
      (to.parentFields || []).forEach((fid) => addField(pform, parent, fid));
      (to.people || []).forEach((uid) => list.push(people.get(uid)?.email || ''));
      if (to.owner) list.push(people.get(rec.ownerId)?.email || '');
      // everyone who holds one of these roles (Administration → Roles)
      (to.roles || []).forEach((rid) => people.forEach((p) => { if ((p.roles || []).includes(rid)) list.push(p.email || ''); }));
      String(to.addresses || '').split(/[,;\s]+/).forEach((x) => list.push(x));
      const addrs = [...new Set(list.map((x) => x.trim().toLowerCase()).filter((x) => EMAIL.test(x)))].slice(0, 10);
      if (!addrs.length) { out.push({ kind: 'skip', noAddr: true, text: 'Send an email: no email address to send to' }); return; }
      const subject = fill(act.subject || '{Item} {Title}').replace(/[\r\n]+/g, ' ').slice(0, 200).trim() || fw.itemName(form);
      out.push({ kind: 'email', to: addrs, subject, message: fill(act.message || '').slice(0, 10000), pdf: !!act.pdf, text: `Email ${addrs.join(', ')}: “${subject}”${act.pdf ? ' with the PDF' : ''}` });
    } else if (act.do === 'child') {
      const cf = ctx.formById(act.formId);
      if (!cf || !(form.children || []).some((c) => c.formId === cf.id)) { out.push({ kind: 'skip', text: 'Create a child record: that form isn’t a child of this one' }); return; }
      const values = {};
      if (act.copy) (cf.fields || []).forEach((g) => { const f = (form.fields || []).find((x) => x.type === g.type && x.label.trim().toLowerCase() === g.label.trim().toLowerCase() && !['heading', 'formula', 'autonumber', 'signature'].includes(x.type)); const v = f && rec.values?.[f.id]; if (v != null && v !== '') values[g.id] = JSON.parse(JSON.stringify(v)); });
      (act.sets || []).forEach((s) => { const g = (cf.fields || []).find((x) => x.id === s.field); if (!g || ['heading', 'formula', 'autonumber'].includes(g.type)) return; const r = valueFor(s, g, rec, form, now, tz); if (r.clear) delete values[g.id]; else values[g.id] = r.v; });
      const t = k.recTitle({ id: null, formId: cf.id, values }, cf);
      out.push({ kind: 'child', formId: cf.id, values, text: `Create ${fw.itemName(cf).toLowerCase()} “${t}” under this ${fw.itemName(form).toLowerCase()}` });
    }
  });
  return out;
}

/* ---------- on a schedule (monthly) ---------- */

/** One record as a line: "31 Oct 2026 · Oliver's (JJJJ Inc.) · CA$1,225.00" */
function itemLabel(it) {
  return [it.title, it.parent, it.amount].filter(Boolean).join(' · ');
}

/** The email to the automation's owner the day before. items: [{ title, parent, amount, steps: [{ kind, text, noAddr }] }] */
function headsUpEmail({ name, form, items, dayText, hourText, approve }) {
  const plural = (n, w) => `${n} ${w.toLowerCase()}${n === 1 ? '' : 's'}`;
  const it = fw.itemName(form || {}) || 'record';
  const stuck = items.filter((x) => x.steps.some((s) => s.noAddr));
  const ok = items.filter((x) => !stuck.includes(x));
  const subject = `Tomorrow: “${name}” runs for ${plural(ok.length, it)}${approve ? ', ready for your OK' : ''}`.slice(0, 200);
  const lines = [
    `“${name}” runs tomorrow, ${dayText}, at ${hourText}${/\.$/.test(hourText) ? '' : '.'}`,
    approve
      ? `You'll get a task for each of these to OK before anything is sent:`
      : `Unless something changes before then, it will do this:`,
    '',
    ...ok.map((x) => `• ${itemLabel(x)}\n${x.steps.filter((s) => s.kind !== 'skip').map((s) => `    – ${s.text}`).join('\n')}`),
  ];
  if (stuck.length) lines.push('', `Can't be sent (no email address), so you'll get a task instead:`, ...stuck.map((x) => `• ${itemLabel(x)}`));
  lines.push('', `To hold one back, change it so it no longer matches the automation's “Only if” (for example set Auto-send to No).`, '', '— Wayholm Forms');
  return { subject, text: lines.join('\n') };
}

/** The task that asks the owner to OK one. */
function approvalTask({ name, item, it, steps }) {
  return {
    title: `Review and send: ${it} ${itemLabel(item)}`.slice(0, 500),
    notes: [`“${name}” is waiting for your OK. It will:`, ...steps.filter((s) => s.kind !== 'skip').map((s) => `• ${s.text}`), '', 'Open it in Wayholm Forms and choose Send now (or Don’t send). Nothing goes out until you do.'].join('\n').slice(0, 20000),
  };
}

/** The task when one couldn't be sent. */
function problemTask({ name, item, it, why }) {
  return {
    title: `Couldn’t send ${it} ${itemLabel(item)}`.slice(0, 500),
    notes: `“${name}” didn’t send it: ${why}.\n\nFix that, then send it from the ${it.toLowerCase()} with Email PDF (or wait for the next run).`.slice(0, 20000),
  };
}

/** Gmail's errors in words. */
function mailWhy(e) {
  const m = String((e && e.message) || '');
  if ((e && e.code === 'EAUTH') || /535|BadCredentials|Username and Password not accepted/i.test(m)) return 'Gmail didn’t accept Wayholm’s app password. Make a new app password and set it again (GMAIL_APP_PASSWORD), then redeploy the functions';
  return m || 'the email failed';
}

module.exports = { itemLabel, headsUpEmail, approvalTask, problemTask, mailWhy, stageArrival, MAX_DEPTH, same, dayKey, addDays, localNow, depthOf, madeBy, triggerMatches, condsHold, dateDue, plan, valueFor };
