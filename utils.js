/* Cadence — helpers: dates, formatting, escaping, natural-language quick add */
(function () {
  const C = (window.Cadence = window.Cadence || {});
  C.VERSION = '13';
  const pad = (n) => String(n).padStart(2, '0');

  const D = {
    key(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); },
    parse(k) { if (!k) return null; const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); },
    today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; },
    todayKey() { return D.key(new Date()); },
    add(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; },
    addKey(k, n) { return D.key(D.add(D.parse(k), n)); },
    addMonths(d, n) {
      const day = d.getDate();
      const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
      const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
      x.setDate(Math.min(day, last));
      return x;
    },
    /** whole days from key b to key a (a - b) */
    diff(a, b) {
      const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
      return Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 864e5);
    },
    startOfWeek(d, ws) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() - ws + 7) % 7)); return x; },
    sameMonth(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth(); }
  };
  C.D = D;

  const fmt = (o) => new Intl.DateTimeFormat(undefined, o);
  const F = {
    long: fmt({ weekday: 'long', month: 'long', day: 'numeric' }),
    short: fmt({ month: 'short', day: 'numeric' }),
    shortY: fmt({ month: 'short', day: 'numeric', year: 'numeric' }),
    wday: fmt({ weekday: 'short' }),
    wdayLong: fmt({ weekday: 'long' }),
    monthYear: fmt({ month: 'long', year: 'numeric' }),
    time: fmt({ hour: 'numeric', minute: '2-digit' })
  };
  C.F = F;

  C.relDate = function (key) {
    if (!key) return 'No date';
    const t = D.todayKey(), n = D.diff(key, t), d = D.parse(key);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n === -1) return 'Yesterday';
    if (n > 1 && n < 7) return F.wdayLong.format(d);
    return d.getFullYear() === new Date().getFullYear() ? F.short.format(d) : F.shortY.format(d);
  };
  C.fmtTime = function (t) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const d = new Date(); d.setHours(h, m, 0, 0);
    return F.time.format(d);
  };

  C.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  C.uid = (p) => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  C.clone = (o) => JSON.parse(JSON.stringify(o));
  C.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  /* ---------- recurrence ---------- */
  C.REPEATS = [
    { id: 'none', label: 'Does not repeat' },
    { id: 'daily', label: 'Every day' },
    { id: 'weekdays', label: 'Every weekday' },
    { id: 'weekly', label: 'Every week' },
    { id: 'monthly', label: 'Every month' }
  ];
  C.nextDue = function (key, repeat) {
    const base = D.parse(key || D.todayKey());
    if (repeat === 'daily') return D.key(D.add(base, 1));
    if (repeat === 'weekly') return D.key(D.add(base, 7));
    if (repeat === 'monthly') return D.key(D.addMonths(base, 1));
    if (repeat === 'weekdays') {
      let x = D.add(base, 1);
      while (x.getDay() === 0 || x.getDay() === 6) x = D.add(x, 1);
      return D.key(x);
    }
    return null;
  };

  /* ---------- natural-language quick add ----------
     "Call dentist tomorrow 3pm #health !high every month"            */
  const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const MO = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const END = '(?=\\s|$|[,.;])';

  const norm = (v) => String(v || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  /** nodes: optional [{ id, title, color }] for "@node" links to the map */
  C.parseQuick = function (text, types, levels, weekStart, nodes) {
    const out = { title: '', due: null, time: null, typeId: null, levelId: null, repeat: 'none', nodeId: null, tokens: [] };
    let s = ' ' + text + ' ';
    const take = (re, fn) => {
      s = s.replace(re, function () {
        const r = fn.apply(null, arguments);
        if (!r) return arguments[0];
        out.tokens.push(r);
        return ' ';
      });
    };
    const today = D.today();

    take(new RegExp('\\s(every\\s+(day|weekday|week|month)|daily|weekly|monthly)' + END, 'i'), (m, all, unit) => {
      if (out.repeat !== 'none') return null;
      const w = (unit || all).toLowerCase();
      out.repeat = /day$|daily/.test(w) ? (w === 'weekday' ? 'weekdays' : 'daily') : /week/.test(w) ? 'weekly' : 'monthly';
      return { kind: 'repeat', label: C.REPEATS.find((r) => r.id === out.repeat).label };
    });

    take(new RegExp('\\s#([\\w-]+)' + END, 'g'), (m, tag) => {
      if (out.typeId) return null;
      const t = types.find((x) => x.name.toLowerCase().startsWith(tag.toLowerCase()));
      if (!t) return null;
      out.typeId = t.id;
      return { kind: 'type', label: t.name, color: t.color };
    });

    if (nodes && nodes.length) {
      take(new RegExp('\\s@([\\p{L}\\p{N}_-]+)' + END, 'gu'), (m, tag) => {
        if (out.nodeId) return null;
        const q = norm(tag);
        if (!q) return null;
        const hits = nodes.filter((n) => norm(n.title).startsWith(q));
        if (!hits.length) return null;
        const n = hits.find((x) => norm(x.title) === q) || hits.sort((a, b) => a.title.length - b.title.length)[0];
        out.nodeId = n.id;
        return { kind: 'node', label: n.title, color: n.color };
      });
    }

    take(new RegExp('\\s!(!|\\d|[a-z]+)' + END, 'gi'), (m, v) => {
      if (out.levelId) return null;
      let l = null;
      if (v === '!') l = levels[0];
      else if (/^\d$/.test(v)) l = levels[Number(v) - 1];
      else l = levels.find((x) => x.name.toLowerCase().startsWith(v.toLowerCase()));
      if (!l) return null;
      out.levelId = l.id;
      return { kind: 'level', label: l.name, color: l.color };
    });

    // times
    take(new RegExp('\\s(?:at\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s?(am|pm)' + END, 'i'), (m, h, mi, ap) => {
      if (out.time) return null;
      h = Number(h) % 12 + (ap.toLowerCase() === 'pm' ? 12 : 0);
      if (h > 23) return null;
      out.time = pad(h) + ':' + (mi || '00');
      return { kind: 'time', label: C.fmtTime(out.time) };
    });
    take(new RegExp('\\s(?:at\\s+)?([01]?\\d|2[0-3]):([0-5]\\d)' + END), (m, h, mi) => {
      if (out.time) return null;
      out.time = pad(Number(h)) + ':' + mi;
      return { kind: 'time', label: C.fmtTime(out.time) };
    });
    take(new RegExp('\\s(?:at\\s+)?(noon|midnight)' + END, 'i'), (m, w) => {
      if (out.time) return null;
      out.time = w.toLowerCase() === 'noon' ? '12:00' : '00:00';
      return { kind: 'time', label: C.fmtTime(out.time) };
    });

    const setDue = (d) => { out.due = D.key(d); return { kind: 'date', label: C.relDate(out.due) }; };

    take(new RegExp('\\s(today|tod|tonight)' + END, 'i'), (m, w) => {
      if (out.due) return null;
      if (w.toLowerCase() === 'tonight' && !out.time) { out.time = '20:00'; }
      return setDue(today);
    });
    take(new RegExp('\\s(tomorrow|tmrw|tmr)' + END, 'i'), () => (out.due ? null : setDue(D.add(today, 1))));
    take(new RegExp('\\s(next\\s+week)' + END, 'i'), () => {
      if (out.due) return null;
      return setDue(D.add(D.startOfWeek(today, weekStart == null ? 1 : weekStart), 7));
    });
    take(new RegExp('\\s(this\\s+)?weekend' + END, 'i'), () => {
      if (out.due) return null;
      let x = today; while (x.getDay() !== 6) x = D.add(x, 1);
      return setDue(x);
    });
    take(new RegExp('\\sin\\s+(\\d+)\\s+(day|days|week|weeks|month|months)' + END, 'i'), (m, n, u) => {
      if (out.due) return null;
      n = Number(n);
      if (/^day/i.test(u)) return setDue(D.add(today, n));
      if (/^week/i.test(u)) return setDue(D.add(today, n * 7));
      return setDue(D.addMonths(today, n));
    });
    take(new RegExp('\\s(next\\s+|on\\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(day|nesday|urday|sday)?' + END, 'i'), (m, nx, w) => {
      if (out.due) return null;
      const target = WD.indexOf(w.toLowerCase().slice(0, 3));
      let x = today;
      while (x.getDay() !== target) x = D.add(x, 1);
      if (nx && /next/i.test(nx)) x = D.add(x, 7);
      return setDue(x);
    });
    const monthDay = (mi, dd) => {
      let x = new Date(today.getFullYear(), mi, dd);
      if (x.getMonth() !== mi) return null;
      if (x < today) x = new Date(today.getFullYear() + 1, mi, dd);
      return setDue(x);
    };
    take(new RegExp('\\s(?:on\\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?' + END, 'i'), (m, mo, dd) => {
      if (out.due) return null;
      return monthDay(MO.indexOf(mo.toLowerCase().slice(0, 3)), Number(dd));
    });
    take(new RegExp('\\s(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*' + END, 'i'), (m, dd, mo) => {
      if (out.due) return null;
      return monthDay(MO.indexOf(mo.toLowerCase().slice(0, 3)), Number(dd));
    });
    take(new RegExp('\\s(?:on\\s+)?(\\d{1,2})/(\\d{1,2})' + END), (m, mo, dd) => {
      if (out.due) return null;
      return monthDay(Number(mo) - 1, Number(dd));
    });

    out.title = s.replace(/\s+/g, ' ').trim() || text.trim();
    // keep tokens in a stable display order
    const order = { date: 0, time: 1, repeat: 2, type: 3, level: 4, node: 5 };
    out.tokens.sort((a, b) => order[a.kind] - order[b.kind]);
    return out;
  };
})();
