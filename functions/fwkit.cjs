// Generated from Formwright src/server (scripts/build-fwkit.mjs). Do not edit by hand.
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/server/entry.js
var entry_exports = {};
__export(entry_exports, {
  ACTION_LABEL: () => ACTION_LABEL,
  COLORS: () => COLORS,
  assigneeFor: () => assigneeFor,
  autoScheduleText: () => scheduleText2,
  dashEmail: () => dashEmail,
  dayKey: () => dayKey,
  dayText: () => dayText,
  daysOverdue: () => daysOverdue,
  drawPdf: () => drawPdf,
  dueSlot: () => dueSlot,
  fileName: () => fileName,
  fillTemplate: () => fillTemplate,
  firstStage: () => firstStage,
  hourText: () => hourText2,
  itemName: () => itemName,
  makeKit: () => makeKit,
  nextRun: () => nextRun,
  nextRuns: () => nextRuns,
  normalizeCal: () => normalizeCal,
  normalizeSchedule: () => normalize,
  opOf: () => opOf,
  overdueStep: () => overdueStep,
  partsIn: () => partsIn,
  recipients: () => recipients,
  ruleFires: () => ruleFires,
  scheduleNow: () => scheduleNow,
  scheduleText: () => scheduleText,
  setCalendar: () => setCalendar,
  stageDue: () => stageDue,
  testCond: () => testCond,
  wfOn: () => wfOn
});
module.exports = __toCommonJS(entry_exports);

// src/util.js
var isEmpty = (v) => v == null || v === "" || Array.isArray(v) && !v.length || typeof v === "object" && !Array.isArray(v) && !Object.values(v).some((x) => x != null && x !== "");

// src/formulas.js
var FX = (() => {
  const E2 = (m) => {
    const e = new Error(m);
    e.fx = true;
    return e;
  };
  const FN = {
    SUM: (a) => flat(a).reduce((s, x) => s + num(x), 0),
    AVG: (a) => {
      const v = flat(a);
      return v.length ? v.reduce((s, x) => s + num(x), 0) / v.length : 0;
    },
    AVERAGE: (a) => FN.AVG(a),
    MIN: (a) => {
      const v = flat(a).map(num);
      return v.length ? Math.min(...v) : 0;
    },
    MAX: (a) => {
      const v = flat(a).map(num);
      return v.length ? Math.max(...v) : 0;
    },
    COUNT: (a) => flat(a).filter((x) => !isEmpty(x)).length,
    ROUND: (a) => scaled(Math.round, num(a[0]), num(a[1])),
    ROUNDUP: (a) => scaled(Math.ceil, num(a[0]), num(a[1])),
    ROUNDDOWN: (a) => scaled(Math.floor, num(a[0]), num(a[1])),
    FLOOR: (a) => Math.floor(num(a[0])),
    CEIL: (a) => Math.ceil(num(a[0])),
    ABS: (a) => Math.abs(num(a[0])),
    SQRT: (a) => {
      const x = num(a[0]);
      if (x < 0) throw E2("SQRT needs a number that is 0 or more.");
      return Math.sqrt(x);
    },
    POW: (a) => Math.pow(num(a[0]), num(a[1])),
    MOD: (a) => {
      if (num(a[1]) === 0) throw E2("MOD cannot divide by zero.");
      return num(a[0]) % num(a[1]);
    },
    AND: (a) => a.every(truthy),
    OR: (a) => a.some(truthy),
    NOT: (a) => !truthy(a[0]),
    DAYS: (a) => {
      const x = toTime(a[0]), y = toTime(a[1]);
      if (x == null || y == null) return null;
      return Math.round((x - y) / 864e5);
    },
    HOURS: (a) => {
      const x = toTime(a[0]), y = toTime(a[1]);
      if (x == null || y == null) return null;
      return Math.round((x - y) / 36e5 * 100) / 100;
    },
    TODAY: () => {
      const d = /* @__PURE__ */ new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    },
    NOW: () => Date.now(),
    LEN: (a) => String(a[0] ?? "").length,
    TEXT: (a) => String(a[0] ?? "")
  };
  const CHILD = /* @__PURE__ */ new Set(["CHILDSUM", "CHILDCOUNT", "CHILDAVG", "CHILDMIN", "CHILDMAX", "PARENT"]);
  function scaled(fn, x, d) {
    const m = Math.pow(10, d);
    return fn(Number((x * m).toPrecision(15))) / m;
  }
  function flat(a) {
    return a.flatMap((x) => Array.isArray(x) ? x : [x]);
  }
  function num(v) {
    if (typeof v === "number") return isFinite(v) ? v : 0;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (Array.isArray(v)) return v.length;
    if (typeof v === "string") {
      const n = Number(v.trim());
      return v.trim() === "" || isNaN(n) ? 0 : n;
    }
    return 0;
  }
  function truthy(v) {
    return typeof v === "string" ? v !== "" : Array.isArray(v) ? v.length > 0 : !!num(v);
  }
  function toTime(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return v;
    const s = String(v);
    if (/^\d{1,2}:\d{2}/.test(s)) return (/* @__PURE__ */ new Date("1970-01-01T" + s.padStart(5, "0"))).getTime();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return (/* @__PURE__ */ new Date(s + "T00:00")).getTime();
    const t = new Date(s).getTime();
    return isNaN(t) ? null : t;
  }
  function tokenize(s) {
    const t = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      if (/[0-9.]/.test(c)) {
        let j = i;
        while (j < s.length && /[0-9.]/.test(s[j])) j++;
        const n = Number(s.slice(i, j));
        if (isNaN(n)) throw E2(`"${s.slice(i, j)}" is not a number.`);
        t.push({ k: "num", v: n });
        i = j;
        continue;
      }
      if (c === "{") {
        const j = s.indexOf("}", i);
        if (j < 0) throw E2("A { is missing its closing }.");
        t.push({ k: "ref", v: s.slice(i + 1, j).trim() });
        i = j + 1;
        continue;
      }
      if (c === '"' || c === "'") {
        const j = s.indexOf(c, i + 1);
        if (j < 0) throw E2("A quote is missing its closing quote.");
        t.push({ k: "str", v: s.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i;
        while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
        t.push({ k: "id", v: s.slice(i, j).toUpperCase() });
        i = j;
        continue;
      }
      const two = s.slice(i, i + 2);
      if (["<=", ">=", "!=", "<>", "=="].includes(two)) {
        t.push({ k: "op", v: two === "<>" ? "!=" : two === "==" ? "=" : two });
        i += 2;
        continue;
      }
      if ("+-*/%^(),<>=&".includes(c)) {
        t.push({ k: "op", v: c });
        i++;
        continue;
      }
      throw E2(`\u201C${c}\u201D can\u2019t be used in a formula.`);
    }
    return t;
  }
  const cache2 = /* @__PURE__ */ new Map();
  function parse(src) {
    if (cache2.has(src)) return cache2.get(src);
    const t = tokenize(src);
    let p = 0;
    if (!t.length) throw E2("Write a formula, for example {Price} * {Quantity}.");
    const is = (v) => t[p] && t[p].k === "op" && t[p].v === v, eat = (v) => is(v) ? (p++, true) : false;
    const take = (ops) => t[p] && t[p].k === "op" && ops.includes(t[p].v) ? t[p++].v : null;
    function cmp() {
      let l = cat(), o;
      while (o = take(["=", "!=", "<", ">", "<=", ">="])) l = { op: o, l, r: cat() };
      return l;
    }
    function cat() {
      let l = add();
      while (eat("&")) l = { op: "&", l, r: add() };
      return l;
    }
    function add() {
      let l = mul(), o;
      while (o = take(["+", "-"])) l = { op: o, l, r: mul() };
      return l;
    }
    function mul() {
      let l = pw(), o;
      while (o = take(["*", "/", "%"])) l = { op: o, l, r: pw() };
      return l;
    }
    function pw() {
      const b = un();
      return eat("^") ? { op: "^", l: b, r: pw() } : b;
    }
    function un() {
      if (eat("-")) return { op: "neg", l: un() };
      if (eat("+")) return un();
      return prim();
    }
    function prim() {
      const k = t[p++];
      if (!k) throw E2("The formula ends too early.");
      if (k.k === "num") return { num: k.v };
      if (k.k === "str") return { str: k.v };
      if (k.k === "ref") {
        if (!k.v) throw E2("{ } needs a field name inside.");
        return { ref: k.v };
      }
      if (k.k === "id") {
        if (k.v === "TRUE") return { num: 1 };
        if (k.v === "FALSE") return { num: 0 };
        if (!FN[k.v] && !CHILD.has(k.v) && k.v !== "IF") throw E2(`There is no function called ${k.v}.`);
        if (!eat("(")) throw E2(`${k.v} needs brackets, like ${k.v}( ).`);
        const args = [];
        if (!eat(")")) {
          do
            args.push(cmp());
          while (eat(","));
          if (!eat(")")) throw E2(`${k.v}( is missing its closing ).`);
        }
        return { fn: k.v, args };
      }
      if (k.v === "(") {
        const e = cmp();
        if (!eat(")")) throw E2("A ( is missing its closing ).");
        return e;
      }
      throw E2(`Unexpected \u201C${k.v}\u201D.`);
    }
    const ast = cmp();
    if (p < t.length) throw E2(`Unexpected \u201C${t[p].v}\u201D. Check for a missing operator like + or *.`);
    cache2.set(src, ast);
    if (cache2.size > 500) cache2.clear();
    return ast;
  }
  function ev(n, c) {
    if ("num" in n) return n.num;
    if ("str" in n) return n.str;
    if ("ref" in n) return c.ref(n.ref);
    if (n.fn) {
      if (n.fn === "IF") {
        if (n.args.length < 2) throw E2("IF needs a test and a value, like IF({Qty} > 10, 5, 0).");
        return truthy(ev(n.args[0], c)) ? ev(n.args[1], c) : n.args[2] ? ev(n.args[2], c) : 0;
      }
      const a2 = n.args.map((x) => ev(x, c));
      if (CHILD.has(n.fn)) return c.family(n.fn, a2);
      return FN[n.fn](a2);
    }
    const a = ev(n.l, c);
    if (n.op === "neg") return -num(a);
    const b = ev(n.r, c);
    switch (n.op) {
      case "+":
        return num(a) + num(b);
      case "-": {
        if (typeof a === "string" && typeof b === "string" && toTime(a) != null && toTime(b) != null && /\d{4}-\d{2}-\d{2}|:\d{2}/.test(a)) return Math.round((toTime(a) - toTime(b)) / 864e5);
        return num(a) - num(b);
      }
      case "*":
        return num(a) * num(b);
      case "/":
        if (num(b) === 0) {
          if (c.check) return 0;
          throw E2("Can\u2019t divide by zero yet. Fill in the fields this uses.");
        }
        return num(a) / num(b);
      case "%":
        if (num(b) === 0) {
          if (c.check) return 0;
          throw E2("Can\u2019t divide by zero.");
        }
        return num(a) % num(b);
      case "^":
        return Math.pow(num(a), num(b));
      case "&":
        return String(a ?? "") + String(b ?? "");
      default: {
        const bothNum = !(typeof a === "string" && isNaN(Number(a))) && !(typeof b === "string" && isNaN(Number(b)));
        const x = bothNum ? num(a) : String(a ?? "").toLowerCase(), y = bothNum ? num(b) : String(b ?? "").toLowerCase();
        return n.op === "=" ? x === y : n.op === "!=" ? x !== y : n.op === "<" ? x < y : n.op === ">" ? x > y : n.op === "<=" ? x <= y : x >= y;
      }
    }
  }
  return { parse, ev, num, E: E2, FN: Object.keys(FN) };
})();

// src/pdfdoc.js
function fieldKind(type) {
  if (type === "heading") return "heading";
  if (type === "textarea") return "long";
  if (type === "image") return "image";
  if (type === "signature") return "signature";
  if (type === "file") return "file";
  if (type === "attachments") return "long";
  if (type === "rating") return "rating";
  if (type === "color") return "color";
  return "text";
}
var fsize = (n) => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(0) + " KB" : (n / 1048576).toFixed(1) + " MB";
function fieldItem(f, v, text, rich = null) {
  const kind = fieldKind(f.type);
  const width = f.width === "half" && kind !== "long" ? "half" : "full";
  const empty = v == null || v === "" || Array.isArray(v) && !v.length;
  if (kind === "heading") return { kind, label: f.label || "", help: f.help || "" };
  const base = { kind, label: f.label || "", width, text: text || "" };
  if (empty && f.type !== "checkbox" && f.type !== "formula") return { ...base, kind: kind === "long" ? "long" : "text", text: "" };
  switch (kind) {
    case "image": {
      const src = v && (v.path || v.url) ? { path: v.path || "", url: v.url || "" } : v?.data || "";
      return { ...base, src, name: v?.name || "Photo", text: v?.name || "Photo" };
    }
    case "signature":
      return { ...base, src: typeof v === "string" && v.startsWith("data:image/") ? v : "", text: "Signed" };
    case "file":
      return { ...base, text: [v?.name || "File", v?.size ? fsize(v.size) : ""].filter(Boolean).join(" \xB7 ") };
    case "rating":
      return { ...base, n: Math.max(0, Math.round(Number(v) || 0)), max: Math.max(1, Number(f.max) || 5), text: `${v} of ${f.max || 5}` };
    case "color":
      return { ...base, hex: /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : "", text: String(v) };
    default:
      return kind === "long" && rich && rich.length ? { ...base, rich } : base;
  }
}
function fieldRows(items) {
  const out = [];
  let pending = null;
  const flush = () => {
    if (pending) {
      out.push({ cells: [pending] });
      pending = null;
    }
  };
  items.forEach((it) => {
    if (it.kind === "heading") {
      flush();
      out.push({ heading: it });
      return;
    }
    if (it.width === "half") {
      if (pending) {
        out.push({ cells: [pending, it] });
        pending = null;
      } else pending = it;
      return;
    }
    flush();
    out.push({ cells: [it] });
  });
  flush();
  return out;
}
var SWAP = {
  "\u2192": "->",
  "\u2190": "<-",
  "\u2194": "<->",
  "\u2265": ">=",
  "\u2264": "<=",
  "\u2260": "!=",
  "\u2605": "*",
  "\u2606": "-",
  "\u2713": "v",
  "\u2714": "v",
  "\u2717": "x",
  "\u2718": "x",
  "\u2715": "x",
  "\xA0": " ",
  "\u202F": " ",
  "\u2009": " ",
  "\u2002": " ",
  "\u2003": " ",
  "\u200B": "",
  "\uFEFF": "",
  "\u2012": "-",
  "\u2015": "-",
  "\u2212": "-",
  "\u2033": '"',
  "\u2032": "'",
  "\u2010": "-",
  "\u2011": "-",
  "\u25B2": "^",
  "\u25BC": "v",
  "\u25CF": "\u2022",
  "\u25E6": "\u2022",
  "\u2219": "\u2022"
};
function safeText(s, has) {
  let out = "";
  for (const ch of String(s ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/\t/g, "    ")) {
    if (ch === "\n") {
      out += ch;
      continue;
    }
    const cp = ch.codePointAt(0);
    if (has(cp)) {
      out += ch;
      continue;
    }
    if (SWAP[ch] != null) {
      out += [...SWAP[ch]].every((c) => has(c.codePointAt(0))) ? SWAP[ch] : "?";
      continue;
    }
    const plain = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    out += plain && plain !== ch && [...plain].every((c) => has(c.codePointAt(0))) ? plain : "?";
  }
  return out;
}
function wrapText(text, width, measure) {
  const lines = [];
  String(text ?? "").split("\n").forEach((para) => {
    const words = para.split(/ +/);
    let line = "";
    words.forEach((w) => {
      const tryLine = line ? line + " " + w : w;
      if (measure(tryLine) <= width) {
        line = tryLine;
        return;
      }
      if (line) lines.push(line);
      line = "";
      let rest = w;
      while (measure(rest) > width && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && measure(rest.slice(0, n)) > width) n--;
        if (rest.length - n < 3 && rest.length > 3) n = Math.min(n, rest.length - 3);
        if (n < 3 && rest.length >= 6) n = 3;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    });
    lines.push(line);
  });
  return lines;
}
function colWidths(cols, rows, measure, avail, { min = 36, cap = 220, pad: pad3 = 10 } = {}) {
  const n = cols.length;
  if (!n) return [];
  const want = cols.map((c, i) => {
    let w2 = Math.max(...String(c.label || "").split(/\s+/).map((s) => measure(s, true)), 0);
    rows.forEach((r) => {
      w2 = Math.max(w2, Math.min(cap, measure(String(r[i] ?? ""))));
    });
    return Math.max(min, Math.min(cap, w2) + pad3);
  });
  const total = want.reduce((a, b) => a + b, 0);
  if (total <= avail) {
    const extra = (avail - total) / n;
    return want.map((w2) => w2 + extra);
  }
  const floor = Math.min(min, avail / n);
  let w = want.slice();
  for (let guard = 0; guard < 20; guard++) {
    const over = w.reduce((a, b) => a + b, 0) - avail;
    if (over <= 0.01) break;
    const big = w.map((x, i) => x > floor ? i : -1).filter((i) => i >= 0);
    if (!big.length) break;
    const room = big.reduce((a, i) => a + (w[i] - floor), 0);
    w = w.map((x, i) => big.includes(i) ? x - over * ((x - floor) / room) : x);
  }
  return w;
}
function fileName(formName, title) {
  const clean = (s) => String(s || "").normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  const base = [clean(formName), clean(title)].filter(Boolean).join(" - ").slice(0, 120).trim() || "Record";
  return base.replace(/[. ]+$/, "") + ".pdf";
}
function fitBox(w, h, maxW, maxH, scaleMax = 1) {
  if (!(w > 0 && h > 0)) return { w: 0, h: 0 };
  const s = Math.min(maxW / w, maxH / h, scaleMax);
  return { w: w * s, h: h * s };
}
function planTable(cols, rows, measure, { spaces, sizes = [9.5, 8.5, 7.5, 7], pad: pad3 = 10, cap = 230, maxWord = 0.4, short = 20 } = {}) {
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const tryFit = (sp2, size2, strict, roomy) => {
    const mF = measure(size2, false), mB = measure(size2, true);
    const minW = [], want = [];
    cols.forEach((c, i) => {
      const head = Math.max(0, ...String(c.label || "").split(/\s+/).map((w) => mB(w)));
      let longest = 0, full = 0, whole = 0;
      rows.forEach((r) => {
        const t = String(r[i] ?? "");
        const w = mF(t);
        full = Math.max(full, w);
        if (t.length <= short) whole = Math.max(whole, w);
        t.split(/\s+/).forEach((x) => {
          longest = Math.max(longest, mF(x));
        });
      });
      let keep = c.num ? full : Math.max(strict ? whole : 0, Math.min(longest, sp2.avail * maxWord));
      if (roomy && !c.num) keep = Math.max(keep, Math.min(full, sp2.avail * 0.22));
      minW[i] = Math.max(head, keep) + pad3 + 0.5;
      want[i] = Math.max(minW[i], Math.min(cap, full) + pad3 + 0.5);
    });
    if (sum(minW) > sp2.avail + 0.01) return null;
    const total = sum(want);
    if (total <= sp2.avail) return want.map((w) => w + (sp2.avail - total) * (w / total));
    const flex = sum(want.map((w, i) => w - minW[i])) || 1, over = total - sp2.avail;
    return want.map((w, i) => w - (w - minW[i]) * (over / flex));
  };
  for (const [strict, roomy, sz] of [[true, true, sizes.slice(0, 2)], [true, false, sizes.slice(0, 3)], [false, false, sizes]]) {
    for (const sp2 of spaces) {
      for (const size2 of sz) {
        const widths2 = tryFit(sp2, size2, strict, roomy);
        if (widths2) return { size: size2, widths: widths2, landscape: !!sp2.landscape, broken: false };
      }
    }
  }
  const sp = spaces[spaces.length - 1], size = sizes[sizes.length - 1];
  const widths = colWidths(cols.map((c) => ({ label: c.label })), rows, (t, b) => measure(size, b)(t), sp.avail, { min: 30, cap, pad: pad3 });
  return { size, widths, landscape: !!sp.landscape, broken: true };
}
function layoutRich(blocks, width, measure, { size = 10.5, lh = 14 } = {}) {
  const STY = { p: { size, lh, b: false, gap: 4 }, h3: { size: size * 1.3, lh: lh * 1.3, b: true, gap: 4, before: 4 }, h4: { size: size * 1.08, lh: lh * 1.08, b: true, gap: 3, before: 2 }, quote: { size, lh, b: false, gap: 4, indent: 11, mute: true }, li: { size, lh, b: false, gap: 2, indent: 15 } };
  const out = [];
  (blocks || []).forEach((bk, bi) => {
    const st = STY[bk.t] || STY.p;
    const indent = st.indent || 0, avail = Math.max(20, width - indent);
    const next = blocks[bi + 1];
    const gap = !next ? 0 : bk.t === "li" && next.t === "li" ? st.gap : (STY[bk.t] || STY.p).gap + 1;
    const lines = [];
    let line = { items: [], w: 0 };
    const push = () => {
      lines.push(line);
      line = { items: [], w: 0 };
    };
    const fk = (r) => (r.b || st.b) && r.i ? "bi" : r.b || st.b ? "b" : r.i ? "i" : "r";
    const put = (s, r) => {
      const font = fk(r), w = measure(font, st.size, s);
      const last = line.items[line.items.length - 1];
      const same = last && last.font === font && last.c === r.c && last.hl === r.h && !!last.u === !!(r.u || r.a) && !!last.st === !!r.x && last.a === r.a;
      if (same) {
        last.s += s;
        last.w += w;
      } else line.items.push({ s, x: indent + line.w, w, font, size: st.size, c: r.c || "", hl: r.h || "", u: !!(r.u || r.a), st: !!r.x, a: r.a || "", mute: !!st.mute });
      line.w += w;
    };
    bk.runs.forEach((r) => {
      String(r.s).split(/(\n| +)/).forEach((tok) => {
        if (!tok) return;
        if (tok === "\n") {
          push();
          return;
        }
        if (/^ +$/.test(tok)) {
          if (line.items.length) put(tok, r);
          return;
        }
        let w = measure(fk(r), st.size, tok);
        if (line.w + w > avail && line.items.length) {
          const l = line.items[line.items.length - 1];
          const t = l.s.replace(/ +$/, "");
          if (t !== l.s) {
            const cut = measure(l.font, st.size, l.s) - measure(l.font, st.size, t);
            l.s = t;
            l.w -= cut;
            line.w -= cut;
            if (!l.s) line.items.pop();
          }
          push();
        }
        let rest = tok;
        while (w > avail && rest.length > 1) {
          let n = rest.length - 1;
          while (n > 1 && measure(fk(r), st.size, rest.slice(0, n)) > avail - line.w) n--;
          put(rest.slice(0, n), r);
          push();
          rest = rest.slice(n);
          w = measure(fk(r), st.size, rest);
        }
        put(rest, r);
      });
    });
    push();
    lines.forEach((l, i) => {
      const first = i === 0, lastL = i === lines.length - 1;
      const top = first && bi > 0 ? st.before || 0 : 0;
      out.push({
        h: st.lh + top + (lastL ? gap : 0),
        base: top + st.size * 0.82 + (st.lh - st.size) / 2,
        items: l.items,
        bar: bk.t === "quote",
        barH: st.lh,
        prefix: first && bk.t === "li" ? { s: bk.list === "ol" ? `${bk.n || 1}.` : "\u2022", size: st.size } : null
      });
    });
  });
  return out;
}

// src/filelist.js
function asFiles(v) {
  if (Array.isArray(v)) return v.filter((x) => x && typeof x === "object");
  if (v && typeof v === "object" && (v.name || v.url || v.path)) return [v];
  return [];
}
function filesText(v) {
  const n = asFiles(v).length;
  return n ? `${n} file${n === 1 ? "" : "s"}` : "";
}
var fileNames = (v) => asFiles(v).map((x) => String(x.name || "File"));
var fsize2 = (n) => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(0) + " KB" : (n / 1048576).toFixed(1) + " MB";
var sizeText = (n) => n ? fsize2(n) : "";
var fileLines = (v) => asFiles(v).map((x) => [x.name || "File", sizeText(x.size)].filter(Boolean).join(" \xB7 ")).join("\n");

// src/fixedlogic.js
var LAYOUT = /* @__PURE__ */ new Set(["heading", "instructions"]);
var isLayout = (f) => !!f && LAYOUT.has(f.type);
var DEFAULT_TYPES = /* @__PURE__ */ new Set(["text", "textarea", "email", "phone", "url", "number", "decimal", "currency", "percent", "rating", "range", "date", "time", "datetime", "checkbox", "select", "radio", "multiselect", "color"]);
var canDefault = (f) => !!f && DEFAULT_TYPES.has(f.type);
var NUMS = /* @__PURE__ */ new Set(["number", "decimal", "currency", "percent", "rating", "range"]);
var blank = (v) => v == null || v === "" || Array.isArray(v) && !v.length;
var hasDefault = (f) => canDefault(f) && !blank(f.defaultValue);
var isFixed = (f) => !!f && !!f.readOnly && hasDefault(f);
var pad = (n) => String(n).padStart(2, "0");
function clock(now = /* @__PURE__ */ new Date(), timeZone) {
  if (timeZone) {
    try {
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]));
      return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
    } catch (e) {
    }
  }
  return { day: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, time: `${pad(now.getHours())}:${pad(now.getMinutes())}` };
}
function defaultFor(f, now = /* @__PURE__ */ new Date(), timeZone) {
  if (!hasDefault(f)) return null;
  const v = f.defaultValue;
  const c = () => clock(now, timeZone);
  switch (f.type) {
    case "date":
      return v === "today" ? c().day : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null;
    case "time":
      return v === "now" ? c().time : /^\d{2}:\d{2}/.test(String(v)) ? String(v).slice(0, 5) : null;
    case "datetime": {
      if (v === "now") {
        const k = c();
        return k.day + "T" + k.time;
      }
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(v)) ? String(v).slice(0, 16) : null;
    }
    case "checkbox":
      return v === true || v === "yes" ? true : v === false || v === "no" ? false : null;
    case "select":
    case "radio":
      return (f.options || []).includes(v) ? v : null;
    case "multiselect": {
      const o = f.options || [];
      const l = (Array.isArray(v) ? v : [v]).filter((x) => o.includes(x));
      return l.length ? l : null;
    }
    default:
      if (NUMS.has(f.type)) {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      }
      return String(v);
  }
}
function withFixed(rec, form, now = /* @__PURE__ */ new Date(), timeZone) {
  const fx = (form?.fields || []).filter(isFixed);
  if (!rec || !fx.length) return rec;
  const values = { ...rec.values || {} };
  let changed = false;
  fx.forEach((f) => {
    const d = defaultFor(f, now, timeZone);
    if (JSON.stringify(values[f.id] ?? null) !== JSON.stringify(d)) {
      values[f.id] = d;
      changed = true;
    }
  });
  return changed ? { ...rec, values } : rec;
}

// src/fieldnames.js
var lc = (s) => String(s ?? "").trim().toLowerCase();
var sysOf = (f) => String(f?.sysName || "").trim() || String(f?.label || "").trim();
function fieldByName(form, name) {
  const n = lc(name);
  const fs = (form?.fields || []).filter((f) => f.type !== "heading" && f.type !== "instructions");
  return fs.find((f) => lc(sysOf(f)) === n) || fs.find((f) => f.id === name) || (() => {
    const c = fs.filter((f) => lc(f.label) === n);
    return c.length === 1 ? c[0] : void 0;
  })();
}
function sharedCaptions(fields) {
  const n = /* @__PURE__ */ new Map();
  (fields || []).forEach((f) => {
    if (f.type !== "heading" && f.type !== "instructions") n.set(lc(f.label), (n.get(lc(f.label)) || 0) + 1);
  });
  return new Set([...n].filter(([, c]) => c > 1).map(([k]) => k));
}
function shownName(form, f) {
  const label = String(f?.label || "Untitled field");
  if (!sharedCaptions(form?.fields).has(lc(label))) return label;
  let h = null;
  for (const x of form.fields || []) {
    if (x.type === "heading") h = x;
    if (x.id === f.id) break;
  }
  const sys = sysOf(f);
  const why = lc(sys) !== lc(label) ? sys : h ? h.label : "";
  return why ? `${label} (${why})` : label;
}

// src/foldlogic.js
function headingOf(fields) {
  const m = {};
  let h = null;
  for (const f of fields || []) {
    if (f.type === "heading") {
      h = f.id;
      continue;
    }
    m[f.id] = h;
  }
  return m;
}

// src/rules.js
var ACTIONS = [
  { key: "hide", label: "Hide" },
  { key: "show", label: "Show" },
  { key: "require", label: "Set required" },
  { key: "optional", label: "Set not required" },
  { key: "clear", label: "Clear value" }
];
var ACTION_LABEL = Object.fromEntries(ACTIONS.map((a) => [a.key, a.label]));
var NO_VALUE = /* @__PURE__ */ new Set(["heading", "instructions", "formula", "autonumber"]);
var holdsValue = (f) => !!f && !NO_VALUE.has(f.type);
function kindOf(f) {
  if (!f) return "other";
  switch (f.type) {
    case "select":
    case "radio":
      return "choice";
    case "multiselect":
      return "multi";
    case "checkbox":
      return "bool";
    case "number":
    case "decimal":
    case "currency":
    case "percent":
    case "rating":
    case "range":
      return "num";
    case "formula":
      return f.format === "date" ? "date" : f.format === "text" ? "text" : "num";
    case "date":
    case "datetime":
      return "date";
    case "time":
      return "time";
    case "text":
    case "textarea":
    case "email":
    case "phone":
    case "url":
    case "autonumber":
      return "text";
    case "relation":
      return "link";
    default:
      return "other";
  }
}
var E = [{ key: "empty", label: "is empty", value: "" }, { key: "filled", label: "is not empty", value: "" }];
var OPS = {
  choice: [{ key: "is", label: "is", value: "one" }, { key: "not", label: "is not", value: "one" }, { key: "anyof", label: "is any of", value: "many" }, { key: "noneof", label: "is none of", value: "many" }, ...E],
  multi: [{ key: "has", label: "includes", value: "one" }, { key: "hasnot", label: "doesn\u2019t include", value: "one" }, { key: "hasany", label: "includes any of", value: "many" }, ...E],
  bool: [{ key: "yes", label: "is Yes", value: "" }, { key: "no", label: "is No", value: "" }],
  num: [{ key: "eq", label: "=", value: "num" }, { key: "ne", label: "\u2260", value: "num" }, { key: "gt", label: "more than", value: "num" }, { key: "ge", label: "at least", value: "num" }, { key: "lt", label: "less than", value: "num" }, { key: "le", label: "at most", value: "num" }, ...E],
  date: [{ key: "on", label: "is on", value: "date" }, { key: "before", label: "is before", value: "date" }, { key: "after", label: "is after", value: "date" }, { key: "onbefore", label: "is on or before", value: "date" }, { key: "onafter", label: "is on or after", value: "date" }, ...E],
  time: [{ key: "on", label: "is", value: "time" }, { key: "before", label: "is before", value: "time" }, { key: "after", label: "is after", value: "time" }, ...E],
  text: [{ key: "is", label: "is", value: "text" }, { key: "not", label: "is not", value: "text" }, { key: "contains", label: "contains", value: "text" }, { key: "notcontains", label: "doesn\u2019t contain", value: "text" }, ...E],
  link: [{ key: "is", label: "is", value: "record" }, { key: "not", label: "is not", value: "record" }, ...E],
  other: [...E]
};
var opsFor = (f) => OPS[kindOf(f)];
var opOf = (f, op) => opsFor(f).find((o) => o.key === op) || null;
function isBlank(v) {
  if (v == null || v === "" || v === false) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "number") return Number.isNaN(v);
  if (typeof v === "object") return Object.values(v).every((x) => x == null || x === "");
  return false;
}
var low = (s) => String(s ?? "").trim().toLowerCase();
var list = (v) => Array.isArray(v) ? v : v == null || v === "" ? [] : [v];
var day = (v, n) => String(v ?? "").slice(0, n);
function testCond(cond, v, f) {
  const o = f && opOf(f, cond.op);
  if (!o) return false;
  if (cond.op === "empty") return isBlank(v);
  if (cond.op === "filled") return !isBlank(v);
  const want = cond.value;
  if (o.value && o.value !== "" && (want == null || want === "" || Array.isArray(want) && !want.length)) return false;
  switch (kindOf(f)) {
    case "choice":
      if (cond.op === "is") return v === want;
      if (cond.op === "not") return v !== want;
      if (cond.op === "anyof") return list(want).includes(v);
      if (cond.op === "noneof") return !list(want).includes(v);
      return false;
    case "multi": {
      const have = list(v);
      if (cond.op === "has") return have.includes(want);
      if (cond.op === "hasnot") return !have.includes(want);
      if (cond.op === "hasany") return list(want).some((x) => have.includes(x));
      return false;
    }
    case "bool":
      return cond.op === "yes" ? v === true : v !== true;
    case "num": {
      if (typeof v !== "number" || !Number.isFinite(v)) return cond.op === "ne";
      const w = Number(want);
      if (!Number.isFinite(w)) return false;
      return { eq: v === w, ne: v !== w, gt: v > w, ge: v >= w, lt: v < w, le: v <= w }[cond.op] ?? false;
    }
    case "date":
    case "time": {
      if (isBlank(v)) return false;
      const n = kindOf(f) === "date" ? 10 : 5;
      const a = day(v, n), b = day(want, n);
      return { on: a === b, before: a < b, after: a > b, onbefore: a <= b, onafter: a >= b }[cond.op] ?? false;
    }
    case "text":
      if (cond.op === "is") return low(v) === low(want);
      if (cond.op === "not") return low(v) !== low(want);
      if (cond.op === "contains") return low(v).includes(low(want));
      if (cond.op === "notcontains") return !low(v).includes(low(want));
      return false;
    case "link":
      if (cond.op === "is") return v === want;
      if (cond.op === "not") return v !== want;
      return false;
    default:
      return false;
  }
}
function ruleFires(rule, look) {
  const one = (c) => {
    const x = look(c);
    return !!x && testCond(c, x.v, x.f);
  };
  const group = (g) => {
    const cs = (g.conds || []).filter((c) => c && c.field);
    if (!cs.length) return null;
    return g.join === "any" ? cs.some(one) : cs.every(one);
  };
  const parts = (rule.conds || []).map((c) => c && c.group ? group(c) : c && c.field ? one(c) : null).filter((x) => x !== null);
  if (!parts.length) return false;
  return rule.join === "any" ? parts.some(Boolean) : parts.every(Boolean);
}
var actPairs = (rule) => (rule.acts || []).flatMap((a) => (a.targets || []).map((k) => [a.do, k]));
function evaluate(form, get) {
  const fields = form?.fields || [];
  const rules = (form?.rules || []).filter((r) => r && !r.off);
  const byId = new Map(fields.map((f) => [f.id, f]));
  const under = headingOf(fields);
  let blank2 = /* @__PURE__ */ new Set();
  let st = null;
  for (let pass = 0; pass < 6; pass++) {
    const look = (c) => {
      if (!c.src || c.src === "self") {
        const f = byId.get(c.field);
        if (!f) return null;
        return { f, v: blank2.has(f.id) ? null : get("self", c.field)?.v };
      }
      return get(c.src, c.field);
    };
    st = once(rules, fields, byId, under, look);
    if (sameSet(st.blank, blank2)) break;
    blank2 = st.blank;
  }
  return st;
}
function once(rules, fields, byId, under, look) {
  const show = /* @__PURE__ */ new Map(), hide = /* @__PURE__ */ new Set(), req = /* @__PURE__ */ new Map(), opt = /* @__PURE__ */ new Set(), clear = /* @__PURE__ */ new Set(), fired = /* @__PURE__ */ new Map();
  rules.forEach((r) => {
    const on = ruleFires(r, look);
    fired.set(r.id, on);
    actPairs(r).forEach(([d, k]) => {
      if (d === "show") {
        if (!show.has(k)) show.set(k, false);
        if (on) show.set(k, true);
      }
      if (!on) {
        if (d === "require" && !req.has(k)) req.set(k, false);
        return;
      }
      if (d === "hide") hide.add(k);
      if (d === "require") req.set(k, true);
      if (d === "optional") opt.add(k);
      if (d === "clear") clear.add(k);
    });
  });
  const hidden = new Set(hide);
  show.forEach((any, k) => {
    if (!any) hidden.add(k);
  });
  const hiddenFields = /* @__PURE__ */ new Set();
  fields.forEach((f) => {
    if (hidden.has("f:" + f.id) || under[f.id] && hidden.has("f:" + under[f.id])) hiddenFields.add(f.id);
  });
  fields.forEach((f) => {
    if (hiddenFields.has(f.id)) hidden.add("f:" + f.id);
  });
  const cleared = /* @__PURE__ */ new Set();
  clear.forEach((k) => {
    const f = byId.get(k.slice(2));
    if (k.startsWith("f:") && holdsValue(f) && !hiddenFields.has(f.id)) cleared.add(f.id);
  });
  const blank2 = new Set([...hiddenFields, ...cleared].filter((id) => holdsValue(byId.get(id))));
  const required = (f) => {
    if (!f || !holdsValue(f) || hiddenFields.has(f.id) || cleared.has(f.id)) return false;
    const k = "f:" + f.id;
    if (req.get(k) === true) return true;
    if (opt.has(k)) return false;
    if (req.has(k)) return false;
    return !!f.required;
  };
  return { hidden, hiddenFields, cleared, required, fired, blank: blank2 };
}
var sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
var NO_RULES = { hidden: /* @__PURE__ */ new Set(), hiddenFields: /* @__PURE__ */ new Set(), cleared: /* @__PURE__ */ new Set(), required: (f) => !!(f && f.required && holdsValue(f)), fired: /* @__PURE__ */ new Map(), blank: /* @__PURE__ */ new Set() };

// src/richtext.js
var RICH_KEY = "_rich";
var ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\xA0" };
var decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") {
    const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 1114112 ? String.fromCodePoint(n) : "";
  }
  return ENT[e.toLowerCase()] ?? m;
});
function cleanColor(v) {
  const s = String(v || "").trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return "#" + [...m[1]].map((c) => c + c).join("");
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (m) {
    if (m[4] !== void 0 && Number(m[4]) === 0) return "";
    return "#" + [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("");
  }
  return "";
}
function cleanHref(v) {
  const s = String(v || "").trim();
  if (/^(https?:|mailto:|tel:)/i.test(s)) return s.slice(0, 2e3);
  if (/^www\./i.test(s)) return "https://" + s.slice(0, 2e3);
  return "";
}
function attrs(src) {
  const a = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while (m = re.exec(src)) a[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? "");
  return a;
}
function styleOf(css) {
  const o = {};
  String(css || "").split(";").forEach((d) => {
    const i = d.indexOf(":");
    if (i > 0) o[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim().toLowerCase();
  });
  return o;
}
var BLOCKS = /* @__PURE__ */ new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "li", "ul", "ol", "tr", "pre", "section", "article", "header", "footer", "table", "dl", "dt", "dd"]);
var SKIP = /* @__PURE__ */ new Set(["script", "style", "head", "title", "template", "noscript", "iframe", "object", "svg", "math", "xml"]);
var VOID = /* @__PURE__ */ new Set(["br", "img", "hr", "input", "meta", "link", "col", "wbr", "area", "base", "source"]);
function parseRich(html) {
  const blocks = [];
  const ctx = [];
  let cur = null;
  const fmtNow = () => {
    const f = {};
    ctx.forEach((c) => {
      if (c.fmt) Object.assign(f, c.fmt);
    });
    return f;
  };
  const typeNow = () => {
    let li = null, quote = false, head = "";
    ctx.forEach((c) => {
      if (c.tag === "li") li = c;
      if (c.tag === "blockquote") quote = true;
      if (/^h[1-6]$/.test(c.tag)) head = +c.tag[1] <= 3 ? "h3" : "h4";
    });
    if (li) return { t: "li", list: li.list };
    if (head) return { t: head };
    return { t: quote ? "quote" : "p" };
  };
  const flush = () => {
    if (!cur) return;
    const last = cur.runs[cur.runs.length - 1];
    if (last && last.s.endsWith("\n")) {
      last.s = last.s.slice(0, -1);
      if (!last.s) cur.runs.pop();
    }
    if (cur.runs.length) {
      cur.runs[0].s = cur.runs[0].s.replace(/^ +/, "");
      const l = cur.runs[cur.runs.length - 1];
      l.s = l.s.replace(/ +$/, "");
      cur.runs = cur.runs.filter((r) => r.s);
    }
    blocks.push(cur);
    cur = null;
  };
  const start = () => {
    if (!cur) cur = { ...typeNow(), runs: [], _open: true };
  };
  const add = (s) => {
    if (!s) return;
    start();
    const f = fmtNow();
    const prev = cur.runs[cur.runs.length - 1];
    if (prev && sameFmt(prev, f)) prev.s += s;
    else cur.runs.push({ s, ...f });
  };
  const listOf = () => {
    for (let i = ctx.length - 1; i >= 0; i--) if (ctx[i].tag === "ul" || ctx[i].tag === "ol") return ctx[i].tag;
    return "ul";
  };
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>|[^<]+|</g;
  const src = String(html ?? "");
  let m, skip = "";
  while (m = re.exec(src)) {
    const [all, close, rawTag, rest, selfClose] = m;
    if (!rawTag) {
      if (skip || all[0] === "<" && all.length > 1) continue;
      const t = decode(all.replace(/[ \t\r\n\f]+/g, " ")).replace(/ /g, " ");
      if (t === " " && !cur) continue;
      add(t);
      continue;
    }
    const tag = rawTag.toLowerCase();
    if (skip) {
      if (close && tag === skip) skip = "";
      continue;
    }
    if (SKIP.has(tag)) {
      if (!close && !selfClose) skip = tag;
      continue;
    }
    if (close) {
      let i = ctx.length - 1;
      while (i >= 0 && ctx[i].tag !== tag) i--;
      if (i < 0) continue;
      const wasBlock = ctx.slice(i).some((c) => c.block);
      ctx.length = i;
      if (wasBlock) flush();
      continue;
    }
    if (tag === "br") {
      add("\n");
      continue;
    }
    if (tag === "td" || tag === "th") {
      if (cur && cur.runs.length) add(" ");
      continue;
    }
    if (VOID.has(tag)) continue;
    const a = attrs(rest);
    const st = styleOf(a.style);
    const fmt = {};
    if (tag === "b" || tag === "strong") fmt.b = true;
    if (tag === "i" || tag === "em") fmt.i = true;
    if (tag === "u" || tag === "ins") fmt.u = true;
    if (tag === "s" || tag === "strike" || tag === "del") fmt.x = true;
    if (tag === "a") {
      const h = cleanHref(a.href);
      if (h) fmt.a = h;
    }
    if (tag === "font" && a.color) {
      const c = cleanColor(a.color);
      if (c) fmt.c = c;
    }
    if (st["font-weight"] && (st["font-weight"] === "bold" || st["font-weight"] === "bolder" || Number(st["font-weight"]) >= 600)) fmt.b = true;
    if (st["font-weight"] && (st["font-weight"] === "normal" || Number(st["font-weight"]) && Number(st["font-weight"]) < 600)) fmt.b = false;
    if (st["font-style"] === "italic") fmt.i = true;
    if (st["font-style"] === "normal") fmt.i = false;
    const deco = st["text-decoration"] || st["text-decoration-line"] || "";
    if (/underline/.test(deco)) fmt.u = true;
    if (/line-through/.test(deco)) fmt.x = true;
    if (st.color) {
      const c = cleanColor(st.color);
      if (c) fmt.c = c;
    }
    const bg = st["background-color"] || st.background;
    if (bg) {
      const c = cleanColor(bg);
      if (c && c !== "#ffffff") fmt.h = c;
    }
    const block = BLOCKS.has(tag);
    const entry = { tag, fmt: Object.keys(fmt).length ? fmt : null, block };
    if (tag === "li") entry.list = listOf();
    if (block) flush();
    if (!selfClose) ctx.push(entry);
  }
  flush();
  const out = [];
  blocks.forEach((b) => {
    delete b._open;
    b.runs = b.runs.map(tidyRun).filter((r) => r.s);
    if (b.t !== "li") delete b.list;
    const prev = out[out.length - 1];
    if (!b.runs.length && b.t !== "p") b.t = "p";
    if (!b.runs.length && prev && !prev.runs.length) return;
    out.push(b);
  });
  while (out.length && !out[0].runs.length) out.shift();
  while (out.length && !out[out.length - 1].runs.length) out.pop();
  number(out);
  return out;
}
function tidyRun(r) {
  const o = { s: r.s };
  ["b", "i", "u", "x"].forEach((k) => {
    if (r[k]) o[k] = true;
  });
  if (r.a) o.a = r.a;
  if (r.c && r.c !== "#141826" && r.c !== "#000000") o.c = r.c;
  if (r.h) o.h = r.h;
  return o;
}
function sameFmt(a, b) {
  return ["b", "i", "u", "x", "a", "c", "h"].every((k) => (a[k] || false) === (b[k] || false));
}
function number(blocks) {
  let n = 0, prev = null;
  blocks.forEach((b) => {
    if (b.t === "li" && b.list === "ol") {
      n = prev && prev.t === "li" && prev.list === "ol" ? n + 1 : 1;
      b.n = n;
    } else delete b.n;
    prev = b;
  });
}
function toText(blocks) {
  return (blocks || []).map((b) => {
    const s = b.runs.map((r) => r.s).join("");
    if (b.t === "li") return (b.list === "ol" ? `${b.n || 1}. ` : "\u2022 ") + s;
    return s;
  }).join("\n");
}
var norm = (s) => String(s ?? "").replace(/\r\n?/g, "\n").replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").trim();
function richBlocks(values, fid) {
  const html = values?.[RICH_KEY]?.[fid];
  if (!html || typeof html !== "string") return null;
  const b = parseRich(html);
  return norm(toText(b)) === norm(values[fid]) ? b : null;
}

// src/workflow.js
var STAGE_FIELD = "_stage";
var wfOn = (form) => !!(form?.workflow?.on && (form.workflow.stages || []).length);
var stagesOf = (form) => wfOn(form) ? form.workflow.stages : [];
var stageById = (form, id) => stagesOf(form).find((s) => s.id === id) || null;
var firstStage = (form) => stagesOf(form)[0] || null;
function withStageField(form) {
  if (!wfOn(form)) return form;
  return { ...form, fields: [...form.fields || [], { id: STAGE_FIELD, type: "select", label: "Stage", options: stagesOf(form).map((s) => s.name), pseudo: true }] };
}
var stageName = (form, rec) => stageById(form, rec?.stage)?.name || "";
function stageView(form, stageId) {
  const st = stageById(form, stageId);
  const out = { hide: /* @__PURE__ */ new Set(), view: /* @__PURE__ */ new Set(), req: /* @__PURE__ */ new Set(), keys: /* @__PURE__ */ new Set() };
  if (!st) return out;
  const fields = form.fields || [];
  const under = headingOf(fields);
  const mode = (id) => (st.fields || {})[id] || "edit";
  fields.forEach((f) => {
    const m = mode(f.id), hm = under[f.id] ? mode(under[f.id]) : "edit";
    if (f.type === "heading") {
      if (m === "hide") out.keys.add("f:" + f.id);
      return;
    }
    if (f.type === "instructions") {
      if (m === "hide" || hm === "hide") out.hide.add(f.id);
      return;
    }
    if (m === "hide" || hm === "hide") out.hide.add(f.id);
    else if (m === "view" || hm === "view") out.view.add(f.id);
    else if (m === "req" && !["formula", "autonumber"].includes(f.type)) out.req.add(f.id);
  });
  Object.entries(st.sections || {}).forEach(([k, v]) => {
    if (v === "hide") out.keys.add(k);
  });
  return out;
}
function assigneeFor(stage, rec, moverId) {
  const a = stage?.assign || { type: "owner" };
  const one = (assignee, assigneeGroup = null, assigneeRole = null) => ({ assignee, assigneeGroup, assigneeRole });
  if (a.type === "person" && a.person) return one(a.person);
  if (a.type === "group" && a.group) return one(null, a.group);
  if (a.type === "role" && a.role) return one(null, null, a.role);
  if (a.type === "mover") return one(moverId || rec?.ownerId || null);
  if (a.type === "keep" && rec && (rec.assignee || rec.assigneeGroup || rec.assigneeRole)) return one(rec.assignee || null, rec.assigneeGroup || null, rec.assigneeRole || null);
  return one(rec?.ownerId || moverId || null);
}
var DAY = 864e5;
var keyOf = (d) => d.toISOString().slice(0, 10);
var fromKey = (k) => /* @__PURE__ */ new Date(k + "T00:00:00Z");
function addWorkdays(dateKey, n) {
  let d = fromKey(dateKey);
  while ([0, 6].includes(d.getUTCDay())) d = new Date(+d + DAY);
  let left = Math.max(0, Math.round(Number(n) || 0));
  while (left > 0) {
    d = new Date(+d + DAY);
    if (![0, 6].includes(d.getUTCDay())) left--;
  }
  return keyOf(d);
}
function stageDue(stage, arrivedKey) {
  const n = stage?.dueDays;
  if (n == null || n === "" || !arrivedKey) return "";
  return addWorkdays(arrivedKey, n);
}
function dayKey(ms, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
function overdueStep(stage, arrivedKey, todayKey, sent = {}) {
  const od = stage && stage.overdue;
  const due = stageDue(stage, arrivedKey);
  if (!od || !due || todayKey <= due) return { remind: false, escalate: false, due };
  const escalateOn = od.escalateDays != null && od.escalateDays !== "" ? addWorkdays(addWorkdays(due, 1), Math.max(0, Math.round(+od.escalateDays) || 0)) : "";
  return {
    remind: !!od.remind && !sent.remind,
    escalate: !!escalateOn && todayKey >= escalateOn && !sent.escalate,
    due,
    escalateOn
  };
}
function daysOverdue(dueKey, todayKey) {
  if (!dueKey || todayKey <= dueKey) return 0;
  let n = 0, k = dueKey;
  while (n < 400) {
    k = addWorkdays(k, 1);
    if (k > todayKey) break;
    n++;
  }
  return n;
}

// src/server/recordkit.js
var POPUP = /* @__PURE__ */ new Set(["textarea", "file", "image", "signature", "location", "multiselect", "attachments"]);
var COLORS = ["#3346c8", "#0f7b6c", "#b4531a", "#8a3fb8", "#b42367", "#3d6b1f", "#56607a", "#0b6aa2"];
var isEmpty2 = (v) => v == null || v === "" || Array.isArray(v) && !v.length || typeof v === "object" && !Array.isArray(v) && !Object.values(v).some((x) => x != null && x !== "");
var lc2 = (s) => String(s || "").trim().toLowerCase();
var itemName = (f) => (f?.itemName || "").trim() || (f?.name || "Record").replace(/s$/i, "");
function makeKit({ forms = [], records: stored = [], locale = "en-CA", timeZone = "America/Toronto" } = {}) {
  const formMap = new Map(forms.map((f) => [f.id, f]));
  const records = stored.map((r) => withFixed(r, formMap.get(r.formId), /* @__PURE__ */ new Date(), timeZone));
  const recMap = new Map(records.map((r) => [r.id, r]));
  const kids = /* @__PURE__ */ new Map();
  records.forEach((r) => {
    if (r.parentId) {
      if (!kids.has(r.parentId)) kids.set(r.parentId, []);
      kids.get(r.parentId).push(r);
    }
  });
  const formById = (id) => formMap.get(id);
  const recById = (id) => recMap.get(id);
  const childrenOf = (id, formId) => (kids.get(id) || []).filter((r) => !formId || r.formId === formId);
  const titleFieldOf2 = (form) => {
    const fs = form?.fields || [];
    return fs.find((f) => f.id === form.titleField) || fs.find((f) => ["text", "email", "phone", "url"].includes(f.type)) || fs.find((f) => !isLayout(f));
  };
  const num = (v, o) => Number(v).toLocaleString(locale, o);
  function fmtCalc(f, v) {
    if (v == null || v === "") return "";
    if (typeof v === "boolean") return v ? "Yes" : "No";
    if (typeof v !== "number" || f.format === "text") return String(v);
    const d = f.decimals ?? 2;
    try {
      switch (f.format) {
        case "number":
          return num(v, { maximumFractionDigits: d });
        case "currency":
          return new Intl.NumberFormat(locale, { style: "currency", currency: (f.currency || "CAD").toUpperCase() }).format(v);
        case "percent":
          return num(v, { maximumFractionDigits: d }) + "%";
        case "days":
          return num(v) + (Math.abs(v) === 1 ? " day" : " days");
        default:
          return num(v, { minimumFractionDigits: d, maximumFractionDigits: d });
      }
    } catch (e) {
      return String(v);
    }
  }
  function fmt(f, v) {
    if (f.type !== "formula" && isEmpty2(v)) return "";
    try {
      switch (f.type) {
        case "formula":
          return fmtCalc(f, v);
        case "checkbox":
          return v ? "Yes" : "No";
        case "decimal":
          return num(v, { minimumFractionDigits: f.decimals ?? 2, maximumFractionDigits: f.decimals ?? 2 });
        case "number":
          return num(v);
        case "currency":
          return new Intl.NumberFormat(locale, { style: "currency", currency: (f.currency || "CAD").toUpperCase() }).format(v);
        case "percent":
          return v + "%";
        case "range":
          return v + (f.suffix || "");
        case "rating":
          return `${v} of ${f.max || 5}`;
        case "multiselect":
          return v.join(", ");
        case "location":
          return v.address || (v.lat != null ? `${v.lat}, ${v.lng}` : "");
        case "file":
        case "image":
          return v.name || "File";
        case "attachments":
          return filesText(v);
        case "signature":
          return "Signed";
        case "autonumber":
          return String(v);
        case "relation": {
          const r = recById(v);
          return r ? recTitle(r) : "(removed)";
        }
        case "date":
          return (/* @__PURE__ */ new Date(v + "T00:00:00Z")).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
        case "datetime":
          return new Date(v).toLocaleString(locale, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone });
        default:
          return String(v);
      }
    } catch (e) {
      return String(v);
    }
  }
  function rawFor(f, rec, form, depth) {
    if (f.type === "formula") return evalFormula(form, f, rec, depth + 1);
    const v = f.type === "autonumber" ? rec.nums?.[f.id] : rec.values?.[f.id];
    if (f.type === "relation") {
      const r = v && recById(v);
      return r ? recTitle(r) : "";
    }
    if (f.type === "location") return v?.address || "";
    if (f.type === "file" || f.type === "image") return v?.name || "";
    if (f.type === "attachments") return fileNames(v).join(", ");
    return v ?? null;
  }
  function evalFormula(form, f, rec, depth = 0) {
    if (depth > 20) throw FX.E("loop");
    const ast = FX.parse(f.expr || "");
    return FX.ev(ast, {
      check: false,
      ref: (name) => {
        const g = fieldByName(form, name);
        if (!g || g.id === f.id) throw FX.E("bad field");
        return rawFor(g, rec, form, depth);
      },
      family: (fn, a) => {
        if (fn === "PARENT") {
          const p = rec.parentId && recById(rec.parentId);
          if (!p) return null;
          const pf = formById(p.formId);
          const pg = fieldByName(pf, a[0]);
          if (!pg) throw FX.E("bad parent field");
          return rawFor(pg, p, pf, depth);
        }
        const cf = forms.find((x) => lc2(x.name) === lc2(a[0]));
        if (!cf) throw FX.E("bad form");
        const ks = rec.id ? childrenOf(rec.id, cf.id) : [];
        if (fn === "CHILDCOUNT") return ks.length;
        const g = fieldByName(cf, a[1]);
        if (!g) throw FX.E("bad child field");
        const vals = ks.map((k) => FX.num(rawFor(g, k, cf, depth)));
        if (fn === "CHILDSUM") return vals.reduce((s, x) => s + x, 0);
        if (fn === "CHILDAVG") return vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : 0;
        if (fn === "CHILDMIN") return vals.length ? Math.min(...vals) : 0;
        return vals.length ? Math.max(...vals) : 0;
      }
    });
  }
  function valOf(f, rec, form) {
    if (f.id === STAGE_FIELD) return stageName(form || formById(rec.formId), rec);
    if (f.type === "autonumber") return rec.nums?.[f.id] ?? null;
    if (isFixed(f)) return defaultFor(f, /* @__PURE__ */ new Date(), timeZone);
    if (f.type !== "formula") return rec.values?.[f.id];
    form = form || formById(rec.formId);
    try {
      const v = evalFormula(form, f, rec);
      return typeof v === "number" && !isFinite(v) ? null : v;
    } catch (e) {
      return null;
    }
  }
  function recTitle(rec, form) {
    form = form || formById(rec.formId);
    if (!form) return "Untitled";
    const f = titleFieldOf2(form);
    const t = f ? fmt(f, valOf(f, rec, form)) : "";
    return t || "Untitled " + itemName(form).toLowerCase();
  }
  const text = (form, rec, f) => isLayout(f) ? "" : f.type === "textarea" ? String(valOf(f, rec, form) ?? "") : fmt(f, valOf(f, rec, form));
  const fieldText = (form, rec, label) => {
    const f = fieldByName(form, label);
    return f ? text(form, rec, f) : void 0;
  };
  function getter(form, rec, parent) {
    const byId = new Map((withStageField(form).fields || []).map((f) => [f.id, f]));
    const p = parent !== void 0 ? parent : rec.parentId ? recById(rec.parentId) : null;
    return (src, fid) => {
      if (src === "self") {
        const f2 = byId.get(fid);
        return f2 ? { f: f2, v: valOf(f2, rec, form) } : null;
      }
      if (!p || p.formId !== src) return null;
      const pf = formById(src);
      const f = withStageField(pf)?.fields?.find((x) => x.id === fid);
      return f ? { f, v: valOf(f, p, pf) } : null;
    };
  }
  const rulesFor = (form, rec) => form?.rules?.length ? evaluate(withStageField(form), getter(form, rec)) : NO_RULES;
  function look(form, rec) {
    const g = getter(form, rec);
    return (c) => {
      if (!c.src || c.src === "self") {
        const f = (withStageField(form).fields || []).find((x) => x.id === c.field);
        return f ? { f, v: valOf(f, rec, form) } : null;
      }
      return g(c.src, c.field);
    };
  }
  function pdfModel(form, rec, { stamp = "", userName = (id) => "" } = {}) {
    const rs = rulesFor(form, rec), sv = stageView(form, rec.stage);
    const items = (form.fields || []).filter((f) => f.type !== "instructions" && !rs.hiddenFields.has(f.id) && !rs.hidden.has("f:" + f.id) && !sv.hide.has(f.id) && !sv.keys.has("f:" + f.id)).map((f) => {
      const v = f.type === "heading" || rs.cleared.has(f.id) ? null : valOf(f, rec, form);
      const it = fieldItem(f, v, f.type === "heading" ? "" : f.type === "rating" ? isEmpty2(v) ? "" : `${v} of ${f.max || 5}` : f.type === "attachments" ? fileLines(v) : text(form, { ...rec, values: { ...rec.values, [f.id]: v } }, f), f.type === "textarea" && v != null && !f.plain ? richBlocks(rec.values, f.id) : null);
      return it;
    });
    const sections = [];
    const order = Array.isArray(form.sectionOrder) && form.sectionOrder.length ? form.sectionOrder : (form.children || []).map((c) => c.formId);
    const seen = /* @__PURE__ */ new Set();
    [...order, ...(form.children || []).map((c) => c.formId)].forEach((k) => {
      if (seen.has(k)) return;
      seen.add(k);
      const rel = (form.children || []).find((c) => c.formId === k);
      const cf = rel && formById(k);
      if (!cf || cf.id === form.id) return;
      const isGrid = rel.display === "grid";
      if (rs.hidden.has((isGrid ? "g:" : "c:") + cf.id) || sv.keys.has((isGrid ? "g:" : "c:") + cf.id)) return;
      const rows = childrenOf(rec.id, cf.id).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      const usable = (cf.fields || []).filter((f) => !isLayout(f));
      const num2 = (f) => ["number", "decimal", "currency", "percent", "range"].includes(f.type) || f.type === "formula";
      if (isGrid) {
        const picked = Array.isArray(rel.cols) && rel.cols.length ? rel.cols.map((id) => usable.find((f) => f.id === id)).filter(Boolean) : usable.filter((f) => !POPUP.has(f.type)).slice(0, 8);
        const cols = picked.length ? picked : usable.slice(0, 1);
        const totals = cols.map((f) => {
          if (!num2(f) || f.type === "rating") return null;
          let s = 0, n = 0;
          rows.forEach((r) => {
            const v = valOf(f, r, cf);
            if (typeof v === "number" && isFinite(v)) {
              s += v;
              n++;
            }
          });
          return n ? s : null;
        });
        sections.push({
          title: cf.name,
          count: rows.length,
          cols: cols.map((f) => ({ label: f.label, num: num2(f) })),
          rows: rows.map((r) => {
            const st = rulesFor(cf, r);
            return cols.map((f) => st.blank.has(f.id) ? "" : text(cf, r, f));
          }),
          total: rows.length > 1 && totals.some((t) => t != null) ? cols.map((f, i) => totals[i] == null ? i === 0 ? "Total" : "" : fmt(f, totals[i])) : null,
          empty: `No ${cf.name.toLowerCase()}.`
        });
      } else {
        const tf = titleFieldOf2(cf);
        const cols = usable.filter((f) => f.inList && f.id !== tf?.id && !POPUP.has(f.type)).slice(0, 4);
        sections.push({
          title: cf.name,
          count: rows.length,
          cols: [{ label: tf?.label || itemName(cf) }, ...cols.map((f) => ({ label: f.label, num: num2(f) }))],
          rows: rows.map((r) => [recTitle(r, cf), ...cols.map((f) => text(cf, r, f))]),
          total: null,
          empty: `No ${cf.name.toLowerCase()} for this ${itemName(form).toLowerCase()}.`
        });
      }
    });
    const parent = rec.parentId ? recById(rec.parentId) : null, pform = parent ? formById(parent.formId) : null;
    const day2 = (t) => new Date(t).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric", timeZone });
    const meta = [
      rec.createdAt ? `Created ${day2(rec.createdAt)}${userName(rec.createdBy || rec.ownerId) ? " by " + userName(rec.createdBy || rec.ownerId) : ""}` : "",
      rec.updatedAt && rec.updatedAt !== rec.createdAt ? `Last updated ${day2(rec.updatedAt)}` : "",
      userName(rec.ownerId) ? `Owner ${userName(rec.ownerId)}` : ""
    ].filter(Boolean);
    return { accent: COLORS[(form.color ?? 0) % COLORS.length], formName: form.name, title: recTitle(rec, form), meta, parent: parent && pform ? `${pform.name}: ${recTitle(parent, pform)}` : null, items, sections, stamp };
  }
  return { formById, recById, childrenOf, titleFieldOf: titleFieldOf2, fmt, fmtCalc, valOf, recTitle, text, fieldText, getter, rulesFor, look, pdfModel };
}

// src/pdfdraw.js
var M = 54;
var BOTTOM = M + 30;
var GUTTER = 24;
var PORTRAIT = [612, 792];
var LANDSCAPE = [792, 612];
var CW_PORTRAIT = PORTRAIT[0] - 2 * M;
var CW_LANDSCAPE = LANDSCAPE[0] - 2 * M;
var W;
var H;
var TOP;
var CW;
var shape = (landscape) => {
  [W, H] = landscape ? LANDSCAPE : PORTRAIT;
  TOP = H - M;
  CW = W - 2 * M;
};
var hexRgb = (rgb, hex, fallback) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255);
};
async function drawPdf(L, model, imgs = /* @__PURE__ */ new Map()) {
  const { PDFDocument, StandardFonts, rgb } = L;
  shape(false);
  const pdf = await PDFDocument.create();
  const F = await pdf.embedFont(StandardFonts.Helvetica);
  const B = await pdf.embedFont(StandardFonts.HelveticaBold);
  const I = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const BI = await pdf.embedFont(StandardFonts.HelveticaBoldOblique);
  const FONT = { r: F, b: B, i: I, bi: BI };
  const chars = new Set(F.getCharacterSet());
  const T = (s) => safeText(s, (cp) => chars.has(cp));
  const INK2 = rgb(0.1, 0.11, 0.14), MUTE = rgb(0.4, 0.43, 0.49), RULE = rgb(0.84, 0.85, 0.88);
  const FAINT = rgb(0.955, 0.96, 0.968), ACC = hexRgb(rgb, model.accent, rgb(0.2, 0.27, 0.78));
  const title = T(model.title || "Untitled");
  const brandName = T(model.brand?.name || "");
  pdf.setTitle([T(model.formName), title].filter(Boolean).join(" - "));
  if (brandName) pdf.setAuthor(brandName);
  pdf.setCreator("Formwright");
  pdf.setProducer("Formwright");
  const pics = /* @__PURE__ */ new Map();
  for (const [key, im] of imgs) {
    try {
      pics.set(key, im.type === "png" ? await pdf.embedPng(im.bytes) : await pdf.embedJpg(im.bytes));
    } catch (e) {
    }
  }
  let page = null, y = 0;
  const widthOf = (font, size) => (s) => font.widthOfTextAtSize(s, size);
  const one = (s, font, size, w) => {
    s = T(s);
    if (font.widthOfTextAtSize(s, size) <= w) return s;
    while (s.length > 1 && font.widthOfTextAtSize(s + "\u2026", size) > w) s = s.slice(0, -1);
    return s.trimEnd() + "\u2026";
  };
  const text = (s, x, yy, font, size, color = INK2) => {
    if (s) page.drawText(s, { x, y: yy, font, size, color });
  };
  const rule = (yy, color = RULE, x = M, w = CW, t = 0.6) => page.drawLine({ start: { x, y: yy }, end: { x: x + w, y: yy }, thickness: t, color });
  function newPage() {
    page = pdf.addPage([W, H]);
    y = TOP;
    if (pdf.getPageCount() > 1) {
      const left = brandName || T(model.formName);
      text(one(left, B, 8, CW / 2 - 8), M, TOP - 8, B, 8, MUTE);
      const right = one(title, F, 8, CW / 2 - 8);
      text(right, M + CW - F.widthOfTextAtSize(right, 8), TOP - 8, F, 8, MUTE);
      rule(TOP - 15);
      y = TOP - 34;
    }
  }
  const room = () => y - BOTTOM;
  const ensure = (h) => {
    if (h > room() && y < TOP - 40) newPage();
  };
  newPage();
  const logo = model.brand?.logoKey ? pics.get(model.brand.logoKey) : null;
  if (logo || brandName) {
    let lh = 0, lw = 0;
    if (logo) {
      const s = fitBox(logo.width, logo.height, 170, 52, 0.75);
      lw = s.w;
      lh = s.h;
      page.drawImage(logo, { x: M, y: TOP - lh, width: lw, height: lh });
    }
    if (brandName) {
      const size = logo ? 13 : 15;
      const x = logo ? M + lw + 14 : M;
      const nm = one(brandName, B, size, CW - (x - M));
      const mid = logo ? TOP - lh / 2 - size * 0.35 : TOP - size;
      text(nm, x, mid, B, size, INK2);
      lh = Math.max(lh, logo ? 0 : size + 2);
    }
    y = TOP - lh - 14;
    rule(y, RULE, M, CW, 0.8);
    y -= 28;
  }
  const fname = T(String(model.formName || "").toUpperCase());
  if (fname) {
    text(one(fname, B, 8.5, CW), M, y, B, 8.5, ACC);
    y -= 26;
  }
  wrapText(title, CW, widthOf(B, 20)).forEach((ln, i) => {
    if (i) y -= 24;
    text(ln, M, y, B, 20, INK2);
  });
  y -= 18;
  const meta = T((model.meta || []).filter(Boolean).join("   \xB7   "));
  if (meta) wrapText(meta, CW, widthOf(F, 9)).forEach((ln) => {
    text(ln, M, y, F, 9, MUTE);
    y -= 13;
  });
  if (model.parent) {
    const p = T(model.parent);
    const lab = "Belongs to  ";
    text(lab, M, y, F, 9, MUTE);
    text(one(p, B, 9, CW - F.widthOfTextAtSize(lab, 9)), M + F.widthOfTextAtSize(lab, 9), y, B, 9, INK2);
    y -= 13;
  }
  y -= 14;
  const SEC = 12.5;
  function heading(label, extra, help) {
    ensure(SEC + 70);
    if (y < TOP - 40) y -= 10;
    const lab = one(label, B, SEC, CW - 60);
    text(lab, M, y, B, SEC, INK2);
    if (extra) text(T(extra), M + B.widthOfTextAtSize(lab, SEC) + 8, y, F, 10, MUTE);
    y -= 8;
    page.drawRectangle({ x: M, y: y - 0.4, width: 26, height: 1.6, color: ACC });
    rule(y, RULE, M + 26, CW - 26);
    y -= 18;
    if (help) {
      wrapText(T(help), CW, widthOf(I, 9)).forEach((ln) => {
        ensure(12);
        text(ln, M, y, I, 9, MUTE);
        y -= 12;
      });
      y -= 6;
    }
  }
  const LAB = 8.5, LABH = 13, VAL = 10.5, VALH = 14, ROWGAP = 12;
  function star(cx, cy, r, filled) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
      pts.push(`${(Math.cos(a) * rr).toFixed(2)} ${(Math.sin(a) * rr).toFixed(2)}`);
    }
    const path = "M " + pts.join(" L ") + " Z";
    page.drawSvgPath(path, { x: cx, y: cy, color: filled ? ACC : void 0, borderColor: filled ? ACC : MUTE, borderWidth: 0.7 });
  }
  function cell(it, w) {
    const lab = wrapText(T(it.label), w, widthOf(F, LAB));
    const labH = lab.length * 11 + 2;
    const drawLab = (x, top) => lab.forEach((ln, i) => text(ln, x, top - LAB - i * 11, F, LAB, MUTE));
    const pic = (it.kind === "image" || it.kind === "signature") && it.imgKey ? pics.get(it.imgKey) : null;
    if (pic && it.kind === "image") {
      const s = fitBox(pic.width, pic.height, w, 230, 0.75);
      return { h: labH + 4 + s.h, draw: (x, top) => {
        drawLab(x, top);
        page.drawImage(pic, { x, y: top - labH - 4 - s.h, width: s.w, height: s.h });
      } };
    }
    if (pic && it.kind === "signature") {
      const s = fitBox(pic.width, pic.height, Math.min(w, 230), 62, 0.5);
      const lw = Math.max(160, Math.min(w, s.w + 20));
      return { h: labH + 4 + s.h + 6, draw: (x, top) => {
        drawLab(x, top);
        const yy = top - labH - 4 - s.h;
        page.drawImage(pic, { x, y: yy, width: s.w, height: s.h });
        rule(yy - 3, MUTE, x, lw, 0.6);
      } };
    }
    if (it.kind === "rating" && it.max) {
      return { h: labH + VALH, draw: (x, top) => {
        drawLab(x, top);
        for (let i = 0; i < Math.min(it.max, 10); i++) star(x + 6 + i * 14, top - labH - 7, 5.6, i < it.n);
      } };
    }
    if (it.kind === "color" && it.hex) {
      return { h: labH + VALH, draw: (x, top) => {
        drawLab(x, top);
        page.drawRectangle({ x, y: top - labH - 11, width: 11, height: 11, color: hexRgb(rgb, it.hex, MUTE), borderColor: RULE, borderWidth: 0.5 });
        text(T(it.text), x + 16, top - labH - 10, F, VAL, INK2);
      } };
    }
    if (it.kind === "long" && it.rich) {
      const blocks = it.rich.map((b) => ({ ...b, runs: b.runs.map((r) => ({ ...r, s: T(r.s) })) }));
      const rl = layoutRich(blocks, w, (k, size, s) => FONT[k].widthOfTextAtSize(s, size), { size: VAL, lh: VALH });
      const LINK = rgb(0.2, 0.27, 0.78);
      const drawLine = (ln, x, top) => {
        const bl = top - ln.base;
        if (ln.bar) page.drawRectangle({ x: x + 1, y: top - ln.barH, width: 2, height: ln.barH, color: RULE });
        if (ln.prefix) text(ln.prefix.s, x + 2, bl, F, ln.prefix.size, INK2);
        ln.items.forEach((t) => {
          const f = FONT[t.font], tw = f.widthOfTextAtSize(t.s, t.size);
          const col = t.c ? hexRgb(rgb, t.c, INK2) : t.a ? LINK : t.mute ? MUTE : INK2;
          if (t.hl) page.drawRectangle({ x: x + t.x, y: bl - t.size * 0.24, width: tw, height: t.size * 1.12, color: hexRgb(rgb, t.hl, FAINT) });
          text(t.s, x + t.x, bl, f, t.size, col);
          if (t.u) page.drawLine({ start: { x: x + t.x, y: bl - 1.3 }, end: { x: x + t.x + tw, y: bl - 1.3 }, thickness: 0.6, color: col });
          if (t.st) page.drawLine({ start: { x: x + t.x, y: bl + t.size * 0.3 }, end: { x: x + t.x + tw, y: bl + t.size * 0.3 }, thickness: 0.6, color: col });
        });
      };
      const h = rl.reduce((a, l) => a + l.h, 0);
      return { h: labH + h, rich: rl, drawLine, labH, drawLab, draw: (x, top) => {
        drawLab(x, top);
        let yy = top - labH;
        rl.forEach((ln) => {
          drawLine(ln, x, yy);
          yy -= ln.h;
        });
      } };
    }
    let val = T(it.text);
    let font = F;
    if ((it.kind === "image" || it.kind === "signature") && !pic && it.text) {
      val = it.kind === "signature" ? "Signed (the signature couldn\u2019t be included)" : T(it.text) + " (the photo couldn\u2019t be included)";
      font = I;
    }
    const lines = val ? wrapText(val, w, widthOf(font, VAL)) : [""];
    return { h: labH + lines.length * VALH, lines, labH, font, drawLab, draw: (x, top) => {
      drawLab(x, top);
      lines.forEach((ln, i) => text(ln, x, top - labH - VAL - i * VALH + 1, font, VAL, INK2));
    } };
  }
  const halfW = (CW - GUTTER) / 2;
  fieldRows(model.items || []).forEach((row) => {
    if (row.heading) {
      heading(row.heading.label, "", row.heading.help);
      return;
    }
    const w = row.cells.length === 2 || row.cells[0].width === "half" ? halfW : CW;
    const cs = row.cells.map((it) => cell(it, w));
    const h = Math.max(...cs.map((c) => c.h));
    if (cs.length === 1 && cs[0].rich && h > room()) {
      const c = cs[0];
      ensure(c.labH + VALH * 2);
      c.drawLab(M, y);
      y -= c.labH;
      c.rich.forEach((ln) => {
        if (ln.h > room()) newPage();
        c.drawLine(ln, M, y);
        y -= ln.h;
      });
      y -= ROWGAP;
      return;
    }
    if (cs.length === 1 && cs[0].lines && h > room()) {
      const c = cs[0];
      ensure(c.labH + VALH * 2);
      c.drawLab(M, y);
      y -= c.labH;
      c.lines.forEach((ln) => {
        if (VALH > room()) newPage();
        text(ln, M, y - VAL + 1, c.font, VAL, INK2);
        y -= VALH;
      });
      y -= ROWGAP;
      return;
    }
    ensure(h);
    cs.forEach((c, i) => c.draw(M + i * (halfW + GUTTER), y));
    y -= h + ROWGAP;
  });
  let backToPortrait = false;
  (model.sections || []).forEach((s) => {
    const cols = s.cols || [];
    const rows = s.rows || [];
    const PX = 5, PY = 4.5;
    const all = rows.concat(s.total ? [s.total] : []).map((r) => r.map((c) => T(c)));
    const plan = planTable(
      cols.map((c) => ({ label: T(c.label), num: !!c.num })),
      all,
      (sz, bold) => widthOf(bold ? B : F, sz),
      { spaces: [{ avail: CW_PORTRAIT }, { avail: CW_LANDSCAPE, landscape: true }], pad: PX * 2 }
    );
    const { size, widths } = plan;
    const lh = size * 1.32;
    if (plan.landscape && rows.length) {
      shape(true);
      newPage();
      backToPortrait = true;
    } else if (backToPortrait) {
      shape(false);
      newPage();
      backToPortrait = false;
    }
    const wrapRow = (r, font) => r.map((c, i) => wrapText(c, Math.max(8, widths[i] - PX * 2), widthOf(font, size)));
    const head = wrapRow(cols.map((c) => T(c.label)), B);
    const headH = Math.max(...head.map((l) => l.length)) * lh + PY * 2;
    const drawRowCells = (lines, font, top, color = INK2) => {
      let x = M;
      lines.forEach((ls, i) => {
        ls.forEach((ln, j) => {
          const tw = font.widthOfTextAtSize(ln, size);
          const tx = cols[i]?.num ? x + widths[i] - PX - tw : x + PX;
          text(ln, tx, top - PY - size * 0.8 - j * lh, font, size, color);
        });
        x += widths[i];
      });
    };
    const drawHead = () => {
      page.drawRectangle({ x: M, y: y - headH, width: CW, height: headH, color: FAINT });
      drawRowCells(head, B, y, MUTE);
      y -= headH;
      rule(y, MUTE, M, CW, 0.6);
    };
    const body = rows.map((r) => wrapRow(r.map((c) => T(c)), F));
    const firstH = body.length ? Math.max(...body[0].map((l) => l.length)) * lh + PY * 2 : 0;
    ensure(SEC + 70 + headH + firstH);
    heading(s.title, s.count != null ? String(s.count) : "", "");
    if (!rows.length) {
      ensure(14);
      text(T(s.empty || "None."), M, y, I, 9.5, MUTE);
      y -= 22;
      return;
    }
    y += 6;
    drawHead();
    const maxLines = Math.floor((TOP - 34 - BOTTOM - headH - PY * 2) / lh);
    const totLines = s.total ? wrapRow(s.total.map((c) => T(c)), B) : null;
    const totH = totLines ? Math.max(...totLines.map((l) => l.length)) * lh + PY * 2 : 0;
    body.forEach((lines, bi) => {
      lines = lines.map((ls) => ls.length > maxLines ? ls.slice(0, maxLines - 1).concat(["\u2026"]) : ls);
      const h = Math.max(...lines.map((l) => l.length)) * lh + PY * 2;
      if (h + (bi === body.length - 1 ? totH : 0) > room()) {
        newPage();
        text(one(T(s.title) + " (continued)", B, 9, CW), M, y, B, 9, MUTE);
        y -= 10;
        drawHead();
      }
      drawRowCells(lines, F, y);
      y -= h;
      rule(y);
    });
    if (totLines) {
      rule(y, MUTE, M, CW, 0.8);
      drawRowCells(totLines, B, y);
      y -= totH;
    }
    y -= 20;
  });
  const pages = pdf.getPages(), n = pages.length;
  pages.forEach((p, i) => {
    page = p;
    shape(p.getWidth() > p.getHeight());
    rule(M + 14, RULE);
    const stamp = one(model.stamp || "", F, 8, CW - 80);
    text(stamp, M, M + 2, F, 8, MUTE);
    const pn = `Page ${i + 1} of ${n}`;
    text(pn, M + CW - F.widthOfTextAtSize(pn, 8), M + 2, F, 8, MUTE);
  });
  return pdf.save();
}

// src/emaillogic.js
function fillTemplate(tpl, ctx) {
  const special = {
    title: ctx.title,
    form: ctx.form,
    company: ctx.company,
    sender: ctx.sender,
    date: ctx.date
  };
  return String(tpl ?? "").replace(/\{([^{}\n]{1,80})\}/g, (m, name) => {
    const n = name.trim();
    if (n === "Item") return ctx.item || "";
    if (n === "item") return String(ctx.item || "").toLowerCase();
    const f = ctx.field ? ctx.field(n) : void 0;
    if (f !== void 0) return f;
    const k = n.toLowerCase();
    if (k in special) return special[k] ?? "";
    return m;
  }).replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ");
}

// src/cal.js
var DEFAULT_CAL = Object.freeze({ timeZone: "America/Toronto", weekStart: 1, fyStart: 1 });
var CAL = { ...DEFAULT_CAL };
var okZone = (z) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return true;
  } catch (e) {
    return false;
  }
};
function normalizeCal(c) {
  const x = c || {};
  return {
    timeZone: typeof x.timeZone === "string" && x.timeZone && okZone(x.timeZone) ? x.timeZone : DEFAULT_CAL.timeZone,
    weekStart: x.weekStart === 0 || x.weekStart === "0" ? 0 : 1,
    fyStart: Number.isInteger(+x.fyStart) && +x.fyStart >= 1 && +x.fyStart <= 12 ? +x.fyStart : 1
  };
}
function setCalendar(c) {
  CAL = normalizeCal(c);
  cache.clear();
  return CAL;
}
var fmts = /* @__PURE__ */ new Map();
function fmtFor(tz) {
  if (!fmts.has(tz)) fmts.set(tz, new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }));
  return fmts.get(tz);
}
var cache = /* @__PURE__ */ new Map();
function wall(t) {
  const key = Math.floor(t / 1e3);
  const hit = cache.get(key);
  if (hit) return hit;
  const p = {};
  fmtFor(CAL.timeZone).formatToParts(new Date(key * 1e3)).forEach((x) => {
    if (x.type !== "literal") p[x.type] = +x.value;
  });
  const out = { y: p.year, m: p.month - 1, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
  out.dow = new Date(Date.UTC(out.y, out.m, out.d)).getUTCDay();
  if (cache.size > 2e4) cache.clear();
  cache.set(key, out);
  return out;
}
var offsetAt = (t) => {
  const w = wall(t);
  return Date.UTC(w.y, w.m, w.d, w.h, w.mi, w.s) - Math.floor(t / 1e3) * 1e3;
};
function at(y, m, d = 1, h = 0, mi = 0) {
  const guess = Date.UTC(y, m, d, h, mi);
  const o1 = offsetAt(guess - 0);
  let t = guess - o1;
  const o2 = offsetAt(t);
  if (o2 !== o1) {
    const t2 = guess - o2;
    if (offsetAt(t2) === o2) t = t2;
  }
  return t;
}
function parseLocal(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(s || ""));
  if (!m) return null;
  return at(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0) + (m[6] ? +m[6] * 1e3 : 0);
}
var fyM0 = () => CAL.fyStart - 1;
var qBack = (m) => ((m - fyM0()) % 3 + 3) % 3;
var yBack = (m) => ((m - fyM0()) % 12 + 12) % 12;
function startOf(t, iv) {
  const w = wall(t);
  if (iv === "day") return at(w.y, w.m, w.d);
  if (iv === "week") return at(w.y, w.m, w.d - (w.dow - CAL.weekStart + 7) % 7);
  if (iv === "quarter") return at(w.y, w.m - qBack(w.m), 1);
  if (iv === "year") return at(w.y, w.m - yBack(w.m), 1);
  return at(w.y, w.m, 1);
}
function nextOf(s, iv, k = 1) {
  const w = wall(s);
  if (iv === "day") return at(w.y, w.m, w.d + k);
  if (iv === "week") return at(w.y, w.m, w.d + 7 * k);
  if (iv === "quarter") return at(w.y, w.m + 3 * k, 1);
  if (iv === "year") return at(w.y, w.m + 12 * k, 1);
  return at(w.y, w.m + k, 1);
}
var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var fiscal = () => CAL.fyStart !== 1;
function fyOf(t) {
  const w = wall(t);
  const sm = w.m - yBack(w.m);
  return fiscal() ? sm < 0 ? w.y : w.y + 1 : w.y;
}
function quarterOf(t) {
  const w = wall(t);
  return Math.floor(yBack(w.m) / 3) + 1;
}
function dayName(t, { weekday = false, year = true } = {}) {
  const w = wall(t);
  return `${weekday ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][w.dow] + ", " : ""}${MON[w.m]} ${w.d}${year ? ", " + w.y : ""}`;
}
function bucketName(s, iv) {
  const w = wall(s);
  if (iv === "day") return dayName(s);
  if (iv === "week") return "Week of " + dayName(s);
  if (iv === "quarter") return `Q${quarterOf(s)} ${fiscal() ? "FY" + fyOf(s) : w.y}`;
  if (iv === "year") return fiscal() ? "FY" + fyOf(s) : String(w.y);
  return `${MON[w.m]} ${w.y}`;
}
function spanName(from, to) {
  const a = wall(from), b = wall(to - 1);
  if (a.y === b.y && a.m === b.m && a.d === b.d) return dayName(from);
  if (a.y !== b.y) return `${dayName(from)} \u2013 ${dayName(to - 1)}`;
  if (a.m === b.m) return `${MON[a.m]} ${a.d} \u2013 ${b.d}, ${a.y}`;
  return `${MON[a.m]} ${a.d} \u2013 ${MON[b.m]} ${b.d}, ${a.y}`;
}

// src/reportlogic.js
var GRID = 12;
var MAX_ROWS = 4;
var SYSTEM = [
  { id: "_created", label: "Created on", type: "date", system: true },
  { id: "_updated", label: "Last edited", type: "date", system: true },
  { id: "_owner", label: "Created by", type: "owner", system: true }
];
function titleFieldOf(form) {
  const fs = form.fields || [];
  return fs.find((f) => f.id === form.titleField) || fs.find((f) => ["text", "email", "phone", "url"].includes(f.type)) || fs.find((f) => f.type !== "heading" && f.type !== "instructions");
}
var ASSIGNEE = { id: "_assignee", label: "Person responsible", type: "owner", system: true };
function reportFields(form) {
  const own = (form.fields || []).filter((f) => !["heading", "instructions", "signature"].includes(f.type));
  return own.concat(SYSTEM, form.workflow?.on && (form.workflow.stages || []).length ? [ASSIGNEE] : []);
}
function fieldOf(ctx, ref) {
  if (!ref) return null;
  const form = ctx.formById(ref.form);
  if (!form) return null;
  return reportFields(form).find((f) => f.id === ref.id) || null;
}
function kindOf2(f, form) {
  if (!f) return "none";
  if (["number", "decimal", "currency", "percent", "range", "rating"].includes(f.type)) return "num";
  if (f.type === "formula") return f.format === "text" ? "other" : "num";
  if (["date", "datetime"].includes(f.type)) return "date";
  if (form && !f.system) {
    const t = titleFieldOf(form);
    if (t && t.id === f.id) return "key";
  }
  if (["select", "radio", "multiselect", "checkbox", "text", "relation", "owner", "color"].includes(f.type)) return "group";
  return "other";
}
function parentsOf(ctx, formId) {
  return ctx.forms.filter((f) => (f.children || []).some((c) => c.formId === formId)).map((f) => f.id);
}
function chainOf(ctx, formId) {
  const out = [formId];
  for (let i = 0; i < out.length; i++) parentsOf(ctx, out[i]).forEach((p) => {
    if (!out.includes(p)) out.push(p);
  });
  return out;
}
function valueOf(ctx, rec, ref) {
  let r = rec, guard = 0;
  while (r && r.formId !== ref.form && guard++ < 10) r = r.parentId ? ctx.recById(r.parentId) : null;
  if (!r) return void 0;
  if (ref.id === "_created") return r.createdAt;
  if (ref.id === "_updated") return r.updatedAt || r.createdAt;
  if (ref.id === "_owner") return r.ownerId;
  if (ref.id === "_assignee") return r.assignee || null;
  const form = ctx.formById(ref.form);
  const f = form && (form.fields || []).find((x) => x.id === ref.id);
  if (!f) return void 0;
  if (f.type === "formula") {
    const saved = r.values && r.values[f.id];
    if (saved !== void 0 && saved !== null && saved !== "") return saved;
    return ctx.valOf ? ctx.valOf(f, r, form) : void 0;
  }
  return r.values ? r.values[f.id] : void 0;
}
function timeOf(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v);
  const local = parseLocal(s);
  if (local != null) return local;
  const t = new Date(s).getTime();
  return isNaN(t) ? null : t;
}
function isEmptyVal(v) {
  return v == null || v === "" || Array.isArray(v) && !v.length;
}
function textOf(ctx, f, v) {
  if (f.type === "owner") return ctx.profiles && ctx.profiles[v] && ctx.profiles[v].displayName || (v ? "Someone" : "");
  if (f.id === "_created" || f.id === "_updated") return v ? new Date(v).toLocaleDateString(void 0, { year: "numeric", month: "short", day: "numeric" }) : "";
  if (isEmptyVal(v)) return "";
  if (f.type === "checkbox") return v ? "Yes" : "No";
  try {
    return ctx.fmt ? String(ctx.fmt(f, v) ?? "") : String(v);
  } catch (e) {
    return String(v);
  }
}
function measureOf(ctx, w, list3) {
  const m = w.measure || { fn: "count" };
  if (m.fn === "count" || !m.ref) return list3.length;
  const nums = list3.map((r) => Number(valueOf(ctx, r, m.ref))).filter((n) => !isNaN(n) && n !== null);
  const vals = list3.map((r) => valueOf(ctx, r, m.ref)).filter((v) => v !== null && v !== void 0 && v !== "" && !isNaN(Number(v))).map(Number);
  const sum = vals.reduce((a, b) => a + b, 0);
  if (m.fn === "avg") return vals.length ? sum / vals.length : null;
  return nums.length ? sum : 0;
}
var INTERVALS = ["day", "week", "month", "quarter", "year"];
var MAX_BUCKETS = 400;
var MAX_POINTS = 120;
var LAST_N = { day: 30, week: 26, month: 12, quarter: 8, year: 5 };
var lastN = (iv) => LAST_N[iv] || 12;
function periodStart(t, iv) {
  return startOf(t, INTERVALS.includes(iv) ? iv : "month");
}
function periodNext(t, iv, k = 1) {
  return nextOf(t, INTERVALS.includes(iv) ? iv : "month", k);
}
function autoInterval(from, to) {
  const days = (to - from) / 864e5;
  return days <= 45 ? "day" : days <= 190 ? "week" : days <= 3 * 366 ? "month" : days <= 12 * 366 ? "quarter" : "year";
}
function bucketsOf(ctx, w, list3, now, range) {
  const asked = w.interval === "auto" || INTERVALS.includes(w.interval) ? w.interval : "week";
  const times = list3.map((r) => timeOf(valueOf(ctx, r, w.time)));
  const known = times.filter((t) => t != null);
  const lo = known.length ? Math.min(...known) : null, hi = known.length ? Math.max(...known) : null;
  let from = null, to = null;
  if (range) {
    from = range.from > -8e15 ? range.from : lo;
    to = range.to < 8e15 ? Math.min(range.to - 1, Math.max(now, range.from)) : Math.max(hi ?? now, now);
  } else if (w.span === "custom") {
    from = w.from ? timeOf(w.from) : lo;
    to = w.to ? periodNext(timeOf(w.to), "day") - 1 : hi;
  } else if (w.span === "fit") {
    from = lo;
    to = hi;
  }
  let iv = asked === "auto" ? from != null && to != null && from <= to ? autoInterval(from, to) : "month" : asked;
  if (from == null || to == null || from > to) {
    to = now;
    from = periodNext(periodStart(now, iv), iv, -(lastN(iv) - 1));
  }
  const count = (v) => {
    let n = 0;
    for (let s = periodStart(from, v); s <= to && n <= MAX_POINTS; s = periodNext(s, v)) n++;
    return n;
  };
  let stepped = false;
  while (iv !== "year" && count(iv) > MAX_POINTS) {
    iv = INTERVALS[INTERVALS.indexOf(iv) + 1];
    stepped = true;
  }
  const starts = [];
  for (let s = periodStart(from, iv); s <= to && starts.length < 2e4; s = periodNext(s, iv)) starts.push(s);
  const keep = starts.slice(-MAX_BUCKETS);
  const out = keep.map((s) => ({ start: s, end: periodNext(s, iv), date: new Date(s), rows: [] }));
  list3.forEach((r, i) => {
    const t = times[i];
    if (t == null || !out.length || t < out[0].start || t >= out[out.length - 1].end) return;
    let a = 0, b = out.length - 1;
    while (a < b) {
      const mid = a + b + 1 >> 1;
      if (out[mid].start <= t) a = mid;
      else b = mid - 1;
    }
    out[a].rows.push(r);
  });
  const res = out.map(({ rows, ...x }) => ({ ...x, value: measureOf(ctx, w, rows) || 0, partial: x.start <= now && now < x.end }));
  res.iv = iv;
  res.asked = asked;
  res.stepped = stepped;
  return res;
}
function refLabel(ctx, ref, baseForm) {
  const f = fieldOf(ctx, ref);
  if (!f) return "Removed field";
  const form = ctx.formById(ref.form);
  const name = form ? shownName(form, f) : f.label;
  if (ref.form === baseForm) return name;
  return (form ? form.name : "?") + " \u203A " + name;
}
function dims(type) {
  return type === "kpi" ? { cols: 3, rows: 1 } : type === "table" ? { cols: 12, rows: 3 } : { cols: 6, rows: 2 };
}
function defaultColumns(ctx, formId) {
  const form = ctx.formById(formId);
  if (!form) return [];
  const t = titleFieldOf(form);
  const cols = [];
  if (t) cols.push({ form: formId, id: t.id });
  const parent = parentsOf(ctx, formId)[0];
  if (parent) {
    const pt = titleFieldOf(ctx.formById(parent));
    if (pt) cols.push({ form: parent, id: pt.id });
  }
  (form.fields || []).filter((f) => (!t || f.id !== t.id) && ["num", "group", "date"].includes(kindOf2(f, form)) && f.type !== "multiselect").slice(0, 5 - cols.length).forEach((f) => cols.push({ form: formId, id: f.id }));
  return cols;
}
var clampCols = (c) => Math.min(GRID, Math.max(3, Math.round(c || 6)));
var clampRows = (r) => Math.min(MAX_ROWS, Math.max(1, Math.round(r || 1)));
function layout(widgets, pinned) {
  const out = {};
  const rows = [];
  let cur = [], used = 0;
  const close = () => {
    if (cur.length) rows.push(cur);
    cur = [];
    used = 0;
  };
  widgets.forEach((w) => {
    const c = clampCols(w.cols || dims(w.type).cols);
    if (used + c > GRID) close();
    cur.push({ w, c });
    used += c;
  });
  close();
  let r0 = 0;
  rows.forEach((row, ri) => {
    const left = GRID - row.reduce((a, x) => a + x.c, 0);
    if (left > 0) {
      const takers = row.filter((x) => x.w.id !== pinned);
      const pool = takers.length ? takers : row;
      const total = pool.reduce((a, x) => a + x.c, 0);
      const shares = pool.map((x) => ({ x, exact: x.c / total * left }));
      shares.forEach((s) => {
        s.add = Math.floor(s.exact);
      });
      let rest = left - shares.reduce((a, s) => a + s.add, 0);
      shares.slice().sort((a, b) => b.exact - b.add - (a.exact - a.add)).forEach((s) => {
        if (rest > 0) {
          s.add++;
          rest--;
        }
      });
      shares.forEach((s) => {
        s.x.c += s.add;
      });
    }
    const h = Math.max(...row.map((x) => clampRows(x.w.rows || dims(x.w.type).rows)));
    let c0 = 0;
    row.forEach((x) => {
      out[x.w.id] = { c0, c: x.c, r0, h, row: ri };
      c0 += x.c;
    });
    r0 += h;
  });
  out._rows = r0;
  return out;
}

// src/dashlogic.js
var PERIODS = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
  ["week", "This week"],
  ["lastweek", "Last week"],
  ["month", "This month"],
  ["lastmonth", "Last month"],
  ["quarter", "This quarter"],
  ["lastquarter", "Last quarter"],
  ["year", "This year"],
  ["lastyear", "Last year"],
  ["all", "All time"],
  ["custom", "Custom range"]
];
var periodName = (key, custom) => key === "custom" && custom && (custom.from || custom.to) ? customName(custom) : (PERIODS.find((p) => p[0] === key) || PERIODS.find((p) => p[0] === "all"))[1];
function customName(cu) {
  const r = periodRange("custom", Date.now(), cu);
  return r ? spanName(r.from, r.to) : "Custom range";
}
var MAX_PIVOT_ROWS = 30;
var MAX_PIVOT_COLS = 12;
function chainFields(ctx, formId) {
  const out = [];
  chainOf(ctx, formId).forEach((fid) => {
    const form = ctx.formById(fid);
    if (form) reportFields(form).forEach((f) => out.push({ ref: { form: fid, id: f.id }, f, form, kind: kindOf2(f, form) }));
  });
  return out;
}
var sameRef = (a, b) => !!a && !!b && a.form === b.form && a.id === b.id;
function keysOf(ctx, f, v) {
  if (f.type === "multiselect") return Array.isArray(v) && v.length ? v.map(String) : ["(blank)"];
  if (f.type === "relation") {
    const t2 = v && ctx.recById(v);
    return [t2 ? ctx.recTitle(t2) : "(blank)"];
  }
  const t = textOf(ctx, f, v);
  return [t || "(blank)"];
}
function condHit(ctx, rec, cond) {
  const f = fieldOf(ctx, cond.ref);
  if (!f) return true;
  const v = valueOf(ctx, rec, cond.ref);
  let hit;
  if (cond.value === "(blank)") hit = isEmptyVal(v);
  else hit = keysOf(ctx, f, v).includes(String(cond.value));
  return cond.op === "not" ? !hit : hit;
}
function dateRefOf(ctx, def) {
  if (["line", "area"].includes(def.type) && def.time && fieldOf(ctx, def.time)) return def.time;
  if (def.dateRef && fieldOf(ctx, def.dateRef)) return def.dateRef;
  if (def.time && fieldOf(ctx, def.time)) return def.time;
  const form = ctx.formById(def.form);
  const d = form && (form.fields || []).find((f) => f.type === "date" || f.type === "datetime");
  return d ? { form: def.form, id: d.id } : { form: def.form, id: "_created" };
}
function filterReaches(ctx, def, ref) {
  return !!ref && chainOf(ctx, def.form).includes(ref.form);
}
function ffReach(ctx, def, ff) {
  return ((ff && ff.refs && ff.refs.length ? ff.refs : [ff && ff.ref]) || []).find((r) => r && fieldOf(ctx, r) && filterReaches(ctx, def, r)) || null;
}
function rowsFor(ctx, def, extra = {}) {
  let list3 = ctx.records.filter((r) => r.formId === def.form);
  const conds = (def.conditions || []).filter((c) => c && c.ref && fieldOf(ctx, c.ref) && c.value !== void 0 && c.value !== "");
  if (conds.length) {
    list3 = list3.filter((r) => def.join === "or" ? conds.some((c) => condHit(ctx, r, c)) : conds.every((c) => condHit(ctx, r, c)));
  }
  (extra.fields || []).forEach((ff) => {
    if (!ff || !(ff.values && ff.values.length || ff.range)) return;
    const ref = ffReach(ctx, def, ff);
    if (!ref) return;
    if (ff.hit) {
      list3 = list3.filter((r) => drillHit(ctx, r, { ...ff.hit, ref }));
      return;
    }
    if (ff.range) {
      list3 = list3.filter((r) => {
        const t = timeOf(valueOf(ctx, r, ref));
        return t != null && t >= ff.range.from && t < ff.range.to;
      });
      return;
    }
    list3 = list3.filter((r) => ff.values.some((v) => condHit(ctx, r, { ref, op: "is", value: v })));
  });
  if (extra.range) {
    const dref = dateRefOf(ctx, def);
    list3 = list3.filter((r) => {
      const t = timeOf(valueOf(ctx, r, dref));
      return t != null && t >= extra.range.from && t < extra.range.to;
    });
  }
  return list3;
}
function periodRange(key, now, custom) {
  const day2 = (k = 0) => nextOf(startOf(now, "day"), "day", k);
  const of = (iv, k, label, prevLabel) => {
    const s = nextOf(startOf(now, iv), iv, k);
    return { from: s, to: nextOf(s, iv), prevFrom: nextOf(s, iv, -1), prevTo: s, label, prevLabel };
  };
  const back = (n, label) => {
    const to = day2(1), from = day2(1 - n);
    return { from, to, prevFrom: day2(1 - 2 * n), prevTo: from, label, prevLabel: `the ${n} days before` };
  };
  switch (key) {
    case "today":
      return of("day", 0, "today", "yesterday");
    case "yesterday":
      return of("day", -1, "yesterday", "the day before");
    case "7d":
      return back(7, "the last 7 days");
    case "30d":
      return back(30, "the last 30 days");
    case "week":
      return of("week", 0, "this week", "last week");
    case "lastweek":
      return of("week", -1, "last week", "the week before");
    case "month":
      return of("month", 0, "this month", "last month");
    case "lastmonth":
      return of("month", -1, "last month", "the month before");
    case "quarter":
      return of("quarter", 0, "this quarter", "last quarter");
    case "lastquarter":
      return of("quarter", -1, "last quarter", "the quarter before");
    case "year":
      return of("year", 0, "this year", "last year");
    case "lastyear":
      return of("year", -1, "last year", "the year before");
    case "custom": {
      const a = custom && parseLocal(custom.from), z = custom && parseLocal(custom.to);
      if (a == null && z == null) return null;
      const from = a ?? -864e13, to = z != null ? nextOf(z, "day") : 864e13;
      if (from >= to) return null;
      if (a == null || z == null) return { from, to, prevFrom: null, prevTo: null, label: a == null ? "up to " + dayName(z) : "since " + dayName(a), prevLabel: "" };
      const days = Math.round((to - from) / 864e5);
      return { from, to, prevFrom: nextOf(from, "day", -days), prevTo: from, label: spanName(from, to), prevLabel: days === 1 ? "the day before" : `the ${days} days before` };
    }
    default:
      return null;
  }
}
function kpiOf(ctx, def, extra, now) {
  const range = extra.range ? periodRange(extra.periodKey, now, extra.custom) : null;
  const cur = rowsFor(ctx, def, extra);
  const value = measureOf(ctx, def, cur);
  if (!def.compare) return { value, n: cur.length };
  const r = range || periodRange("month", now);
  const curRows = range ? cur : rowsFor(ctx, def, { ...extra, range: { from: r.from, to: r.to } });
  if (r.prevFrom == null) return { value: range ? value : measureOf(ctx, def, curRows), n: curRows.length, prev: null, delta: null, noPrev: true, label: r.label, prevLabel: r.prevLabel };
  const prevRows = rowsFor(ctx, def, { ...extra, range: { from: r.prevFrom, to: r.prevTo } });
  const a = measureOf(ctx, def, curRows), b = measureOf(ctx, def, prevRows);
  const delta = b ? (a - b) / Math.abs(b) * 100 : null;
  return { value: range ? value : a, n: curRows.length, prev: b, delta, label: r.label, prevLabel: r.prevLabel };
}
function orderKeys(f, keys, totals) {
  if (f.options && f.options.length) {
    const pos = (k) => {
      const i = f.options.indexOf(k);
      return i < 0 ? 999 : i;
    };
    return keys.sort((a, b) => pos(a) - pos(b) || (totals.get(b) || 0) - (totals.get(a) || 0) || a.localeCompare(b));
  }
  if (f.type === "date" || f.type === "datetime" || f.id === "_created" || f.id === "_updated") return keys.sort();
  return keys.sort((a, b) => (totals.get(b) || 0) - (totals.get(a) || 0) || a.localeCompare(b));
}
var BYS = [["day", "Day"], ["week", "Week"], ["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]];
var BY_IDS = BYS.map((b) => b[0]);
var groupable = (x) => ["group", "key", "num", "date"].includes(x.kind) && x.f.type !== "color";
var isDateField = (f) => kindOf2(f) === "date";
function bucketOf(t, by) {
  const iv = BY_IDS.includes(by) ? by : "month";
  const s = startOf(t, iv);
  return { k: bucketName(s, iv), s };
}
function groupKeys(ctx, f, v, ref) {
  if (isDateField(f)) {
    const t = timeOf(v);
    if (t == null) return [{ k: "(blank)" }];
    if (BY_IDS.includes(ref && ref.by)) return [bucketOf(t, ref.by)];
    return [{ k: textOf(ctx, f, v) || "(blank)", s: t }];
  }
  if (kindOf2(f) === "num") {
    const n = typeof v === "number" ? v : v == null || v === "" ? null : Number(v);
    if (n == null || Number.isNaN(n)) return [{ k: "(blank)" }];
    return [{ k: textOf(ctx, f, n) || String(n), s: n }];
  }
  return keysOf(ctx, f, v).map((k) => ({ k }));
}
function groupLabel(ctx, ref) {
  const f = fieldOf(ctx, ref);
  if (!f) return "";
  const by = isDateField(f) && BYS.find((b) => b[0] === ref.by);
  return f.label + (by ? " by " + by[1].toLowerCase() : "");
}
function groupRows(ctx, def, ref, list3) {
  const f = fieldOf(ctx, ref);
  if (!f) return [];
  const m = /* @__PURE__ */ new Map(), sorts = /* @__PURE__ */ new Map();
  list3.forEach((r) => groupKeys(ctx, f, valueOf(ctx, r, ref), ref).forEach(({ k, s }) => {
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
    if (s != null && !sorts.has(k)) sorts.set(k, s);
  }));
  const totals = new Map([...m.entries()].map(([k, rs]) => [k, measureOf(ctx, def, rs) || 0]));
  const keys = [...m.keys()];
  const ordered = isDateField(f) || kindOf2(f) === "num" ? keys.sort((a, b) => (sorts.has(a) ? 0 : 1) - (sorts.has(b) ? 0 : 1) || (sorts.get(a) ?? 0) - (sorts.get(b) ?? 0) || a.localeCompare(b)) : orderKeys(f, keys, totals);
  return ordered.map((k) => ({ key: k, rows: m.get(k), value: totals.get(k) }));
}
function slicesOf(ctx, def, list3, max = 8) {
  const f = fieldOf(ctx, def.group);
  const ordered = !!f && (kindOf2(f) === "num" || isDateField(f));
  let items = groupRows(ctx, def, def.group, list3).map(({ key, value, rows }) => ({ key, value, rows, keys: [key] }));
  const notOne = (def.conditions || []).filter((c) => c.op === "not" && sameRef(c.ref, def.group)).map((c) => String(c.value));
  if (notOne.length) items = items.filter((x) => !notOne.includes(x.key));
  const lim = def.limit === "all" ? Infinity : [8, 12, 20].includes(+def.limit) ? +def.limit : max;
  const cap = ordered && def.type === "bar" ? Math.max(lim, 60) : lim;
  if (items.length > cap) {
    const rest = items.slice(cap - 1);
    const rows = [...new Set(rest.flatMap((x) => x.rows))];
    items = items.slice(0, cap - 1).concat([{ key: "Other (" + rest.length + ")", value: measureOf(ctx, def, rows) || 0, rows, keys: rest.map((x) => x.key), other: true }]);
  }
  return items.map(({ rows, ...x }) => x);
}
function drillHit(ctx, rec, flt) {
  const f = fieldOf(ctx, flt.ref);
  if (!f) return true;
  const v = valueOf(ctx, rec, flt.ref);
  if (flt.from != null) {
    const t = timeOf(v);
    return t != null && t >= flt.from && t < flt.to;
  }
  return groupKeys(ctx, f, v, flt.ref).some(({ k }) => flt.keys.includes(k));
}
function pivotOf(ctx, def, list3) {
  const rf = fieldOf(ctx, def.group), cf = fieldOf(ctx, def.col);
  if (!rf || !cf) return null;
  const rows = groupRows(ctx, def, def.group, list3);
  const cols = groupRows(ctx, def, def.col, list3);
  const colKeys = cols.slice(0, MAX_PIVOT_COLS).map((c) => c.key);
  const out = rows.slice(0, MAX_PIVOT_ROWS).map((r) => {
    const byCol = new Map(colKeys.map((k) => [k, []]));
    r.rows.forEach((rec) => groupKeys(ctx, cf, valueOf(ctx, rec, def.col), def.col).forEach(({ k }) => {
      if (byCol.has(k)) byCol.get(k).push(rec);
    }));
    return { key: r.key, cells: colKeys.map((k) => byCol.get(k).length ? measureOf(ctx, def, byCol.get(k)) : null), total: r.value };
  });
  return {
    cols: colKeys,
    rows: out,
    colTotals: cols.slice(0, MAX_PIVOT_COLS).map((c) => c.value),
    grand: measureOf(ctx, def, list3),
    moreRows: Math.max(0, rows.length - MAX_PIVOT_ROWS),
    moreCols: Math.max(0, cols.length - MAX_PIVOT_COLS)
  };
}
function sortKey(ctx, rec, ref, depth = 0) {
  const f = fieldOf(ctx, ref);
  const v = valueOf(ctx, rec, ref);
  if (!f) return null;
  if (["date", "datetime"].includes(f.type) || ref.id === "_created" || ref.id === "_updated") return timeOf(v);
  if (typeof v === "number") return v;
  if (f.type === "relation") {
    const t2 = v && ctx.recById(v);
    return t2 ? titleKey(ctx, t2, depth) : null;
  }
  const t = textOf(ctx, f, v);
  return t ? t.toLowerCase() : null;
}
function titleKey(ctx, rec, depth = 0) {
  const form = rec && ctx.formById(rec.formId);
  const tf = form && titleFieldOf(form);
  if (!tf || depth > 4) return rec && ctx.recTitle ? String(ctx.recTitle(rec) || "").toLowerCase() || null : null;
  return sortKey(ctx, rec, { form: form.id, id: tf.id }, depth + 1);
}
var natural = (a, b) => typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), void 0, { numeric: true, sensitivity: "base" });
function sortRecs(ctx, list3, ref, dir) {
  if (!ref) return list3;
  return list3.map((r) => ({ r, k: sortKey(ctx, r, ref) })).sort((a, b) => {
    if (a.k == null || b.k == null) return a.k == null && b.k == null ? 0 : a.k == null ? 1 : -1;
    return natural(a.k, b.k) * (dir < 0 ? -1 : 1);
  }).map((x) => x.r);
}
function normalizeDef(ctx, def0) {
  const def = JSON.parse(JSON.stringify(def0 || {}));
  if (!ctx.formById(def.form)) return def;
  const fields = chainFields(ctx, def.form);
  const pick = (kinds, avoid) => (fields.find((x) => kinds.includes(x.kind) && !x.f.system && !sameRef(x.ref, avoid)) || fields.find((x) => kinds.includes(x.kind) && !sameRef(x.ref, avoid)) || {}).ref || null;
  def.measure = def.measure && (def.measure.fn === "count" || fieldOf(ctx, def.measure.ref)) ? def.measure : { fn: "count" };
  def.conditions = Array.isArray(def.conditions) ? def.conditions : [];
  def.join = def.join === "or" ? "or" : "and";
  const t = def.type || "table";
  const canSplit = (ref) => {
    const x = fields.find((y) => sameRef(y.ref, ref));
    return !!x && groupable(x);
  };
  const withBy = (ref) => {
    if (!ref) return ref;
    const x = fields.find((y) => sameRef(y.ref, ref));
    if (x && x.kind === "date") return { form: ref.form, id: ref.id, by: BY_IDS.includes(ref.by) ? ref.by : "month" };
    return { form: ref.form, id: ref.id };
  };
  if (!(def.limit === "all" || [8, 12, 20].includes(+def.limit))) delete def.limit;
  else if (def.limit !== "all") def.limit = +def.limit;
  if (["bar", "donut", "grouped", "pivot"].includes(t)) {
    if (!canSplit(def.group)) def.group = pick(["group", "key"]);
    def.group = withBy(def.group);
  }
  if (t === "pivot") {
    if (!canSplit(def.col) || sameRef(def.col, def.group) && (def.col.by || "") === (def.group?.by || "")) def.col = pick(["group"], def.group);
    def.col = withBy(def.col);
  }
  if (["line", "area"].includes(t)) {
    if (!fieldOf(ctx, def.time)) {
      const own = fields.find((x) => x.kind === "date" && !x.f.system && x.ref.form === def.form);
      def.time = own ? own.ref : { form: def.form, id: "_created" };
    }
    def.interval = ["auto", "day", "week", "month", "quarter", "year"].includes(def.interval) ? def.interval : "month";
    def.span = ["fit", "last", "custom"].includes(def.span) ? def.span : "fit";
    ["from", "to"].forEach((k) => {
      if (!(typeof def[k] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(def[k]))) delete def[k];
    });
  }
  if (["table", "grouped"].includes(t)) {
    def.columns = (def.columns || []).filter((r) => fieldOf(ctx, r));
    if (!def.columns.length) def.columns = defaultColumns(ctx, def.form);
  }
  return def;
}
var CANVAS_COLS = 24;
var MIN_W = 3;
var minH = (t) => t && (t.text || t.link || t.filter) ? 2 : 3;
var clampTile = (t) => {
  const w = Math.max(MIN_W, Math.min(CANVAS_COLS, Math.round(t.w ?? 12)));
  return { ...t, w, h: Math.max(minH(t), Math.min(80, Math.round(t.h ?? 8))), x: Math.max(0, Math.min(CANVAS_COLS - w, Math.round(t.x || 0))), y: Math.max(0, Math.round(t.y || 0)) };
};
function placedRaw(tiles) {
  const list3 = tiles || [];
  if (list3.every((t) => t.x != null && t.y != null)) return list3.map((t) => ({ ...t }));
  const L = layout(list3.map((t) => ({ ...t, cols: t.cols || t.w || 6, rows: t.rows || 2 })));
  return list3.map((t) => t.x != null && t.y != null ? { ...t } : { ...t, x: L[t.id].c0, y: L[t.id].r0 * 2, w: L[t.id].c, h: L[t.id].h * 2 });
}
var strip = ({ cols, rows, ...rest }) => rest;
function canvasTiles(tiles) {
  return placedRaw(tiles).map(clampTile).map(strip);
}
function readingOrder(tiles) {
  return tiles.slice().sort((a, b) => a.y - b.y || a.x - b.x);
}
function pluralWord(s) {
  if (/s$/i.test(s)) return s;
  if (/[^aeiou]y$/i.test(s)) return s.slice(0, -1) + "ies";
  if (/(x|z|ch|sh)$/i.test(s)) return s + "es";
  return s + "s";
}
function nounOf(form, n) {
  const one = String(form?.itemName || "").trim(), name = String(form?.name || "").trim();
  if (n === 1) return (one || name.replace(/s$/i, "") || "record").toLowerCase();
  if (one && name && name.toLowerCase() !== one.toLowerCase()) return name.toLowerCase();
  return pluralWord(one || name || "record").toLowerCase();
}

// src/dashfmt.js
function measureField(c, def) {
  const m = def.measure || { fn: "count" };
  return m.fn !== "count" && m.ref ? fieldOf(c, m.ref) : null;
}
function fmtMeasure(c, def, v) {
  if (v == null || typeof v === "number" && isNaN(v)) return "\u2013";
  const f = measureField(c, def);
  if (!f) return Math.round(v).toLocaleString();
  if (f.type === "rating") return (Math.round(v * 10) / 10).toLocaleString() + " \u2605";
  const val = def.measure.fn === "avg" ? Math.round(v * 100) / 100 : v;
  if (f.type === "currency" || f.type === "formula" && f.format === "currency") {
    try {
      return new Intl.NumberFormat(void 0, { style: "currency", currency: String(f.currency || "CAD").toUpperCase(), maximumFractionDigits: Math.abs(val) >= 100 ? 0 : 2 }).format(val);
    } catch (e) {
      return String(val);
    }
  }
  if (f.type === "percent" || f.type === "formula" && f.format === "percent") return (Math.round(val * 10) / 10).toLocaleString() + "%";
  if (f.type === "range") return Math.round(val * 10) / 10 + (f.suffix || "");
  return Number(val).toLocaleString(void 0, { maximumFractionDigits: def.measure.fn === "avg" ? 2 : 1 });
}
function measureLabel(c, def) {
  const m = def.measure || { fn: "count" };
  const form = c.formById(def.form);
  if (m.fn === "count" || !m.ref) return "Number of " + (form ? nounOf(form, 2) : "records");
  const f = fieldOf(c, m.ref);
  return (m.fn === "avg" ? "Average " : "Total ") + (f ? f.label.toLowerCase() : "value");
}
function cellText(c, ref, rec) {
  const f = fieldOf(c, ref);
  if (!f) return "";
  const v = valueOf(c, rec, ref);
  if (f.type === "relation") {
    const t = v && c.recById(v);
    return t ? c.recTitle(t) : "";
  }
  return textOf(c, f, v);
}
var isNumRef = (c, r) => {
  const f = fieldOf(c, r);
  return !!f && kindOf2(f) === "num";
};

// src/dashmail.js
var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var hourText = (h) => {
  const n = (+h % 24 + 24) % 24;
  return `${n % 12 || 12}:00 ${n < 12 ? "AM" : "PM"}`;
};
var ord = (n) => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
function scheduleText(s) {
  if (!s) return "";
  const at2 = " at " + hourText(s.hour ?? 8);
  if (s.freq === "weekly") return "Every " + DAYS[(+s.day || 0) % 7] + at2;
  if (s.freq === "monthly") return "On the " + ord(Math.min(28, Math.max(1, +s.day || 1))) + " of every month" + at2;
  if (s.freq === "daily") return "Every day" + at2;
  return "Every weekday" + at2;
}
function partsIn(ms, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { key: `${p.year}-${p.month}-${p.day}`, hour: +p.hour % 24, dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), dom: +p.day };
}
function dueSlot(s, parts) {
  if (!s || !s.on || parts.hour !== (+s.hour || 0)) return "";
  const ok = s.freq === "daily" ? true : s.freq === "weekly" ? parts.dow === (+s.day || 0) % 7 : s.freq === "monthly" ? parts.dom === Math.min(28, Math.max(1, +s.day || 1)) : parts.dow >= 1 && parts.dow <= 5;
  const slot = `${parts.key}T${String(parts.hour).padStart(2, "0")}`;
  return ok && s.lastSlot !== slot ? slot : "";
}
function recipients(s, people, roleHolders = () => []) {
  const to = s && s.to ? s.to : {};
  const list3 = [];
  (to.people || []).forEach((u) => list3.push(people.get(u)?.email || ""));
  (to.roles || []).forEach((r) => roleHolders(r).forEach((u) => list3.push(people.get(u)?.email || "")));
  String(to.addresses || "").split(/[,;\s]+/).forEach((a) => list3.push(a));
  return [...new Set(list3.map((x) => String(x).trim().toLowerCase()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))].slice(0, 50);
}
var esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
var INK = "#141826";
var MUTED = "#5a6174";
var LINE = "#e3e5ec";
var BAR = "#3346c8";
var SOFT = "#f3f4f7";
var COLORS2 = ["#3346c8", "#0f7b6c", "#c2410c", "#8a55d6", "#d23f6e", "#0e8fa8", "#a16207", "#5a6174"];
var td = (s, x = "") => `<td style="padding:6px 8px;border-bottom:1px solid ${LINE};font-size:13px;color:${INK};${x}">${s}</td>`;
var th = (s, x = "") => `<th style="padding:6px 8px;border-bottom:2px solid ${LINE};font-size:12px;color:${MUTED};text-align:left;font-weight:600;${x}">${s}</th>`;
var table = (rows, head = "") => `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${head}${rows}</table>`;
var barCell = (v, max, color = BAR) => {
  const w = Math.max(1, Math.round((max > 0 ? Math.max(0, v) / max : 0) * 100));
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse"><tr><td style="width:${w}%;height:10px;background:${color};border-radius:3px;font-size:0;line-height:0">&nbsp;</td>${w < 100 ? `<td style="width:${100 - w}%;font-size:0;line-height:0">&nbsp;</td>` : ""}</tr></table>`;
};
var more = (n, what) => n > 0 ? `<p style="margin:6px 0 0;font-size:12px;color:${MUTED}">and ${n} more ${what}</p>` : "";
function reportBlock(c, def, extra, now) {
  const form = c.formById(def.form);
  if (!form) return { html: `<p style="color:${MUTED};font-size:13px">This report\u2019s form isn\u2019t available.</p>`, text: "(form not available)" };
  if (def.type === "kpi") {
    const k = kpiOf(c, def, extra, now);
    const v = fmtMeasure(c, def, k.value);
    const cmp = def.compare && k.delta != null ? `${k.delta >= 0 ? "\u25B2 +" : "\u25BC "}${Math.round(k.delta)}% vs ${esc(k.prevLabel)} (${esc(fmtMeasure(c, def, k.prev))})` : "";
    return { html: `<div style="font-size:30px;font-weight:700;color:${INK};line-height:1.15">${esc(v)}</div><div style="font-size:13px;color:${MUTED};margin-top:4px">${esc(measureLabel(c, def))}${cmp ? " \xB7 " + cmp : ""}</div>`, text: `${measureLabel(c, def)}: ${v}${cmp ? " (" + cmp.replace(/<[^>]+>/g, "") + ")" : ""}` };
  }
  const list3 = rowsFor(c, def, extra);
  if (!list3.length) return { html: `<p style="color:${MUTED};font-size:13px;margin:0">No records match this report.</p>`, text: "No records match." };
  if (def.type === "bar" || def.type === "donut") {
    const items = slicesOf(c, def, list3).filter((x) => def.type === "bar" || x.value > 0);
    const shown2 = items.slice(0, 15);
    const max = Math.max(0, ...shown2.map((x) => x.value)) || 1, total = items.reduce((a, b) => a + b.value, 0) || 1;
    const rows = shown2.map((x, i) => `<tr>${td(esc(x.key), "width:34%")}${td(barCell(x.value, def.type === "donut" ? total : max, def.type === "donut" ? COLORS2[i % COLORS2.length] : BAR), "width:44%")}${td(esc(fmtMeasure(c, def, x.value)) + (def.type === "donut" ? ` <span style="color:${MUTED}">${Math.round(x.value / total * 100)}%</span>` : ""), "text-align:right;white-space:nowrap")}</tr>`).join("");
    return { html: table(rows) + more(items.length - shown2.length, "groups"), text: shown2.map((x) => `${x.key}: ${fmtMeasure(c, def, x.value)}`).join("; ") };
  }
  if (def.type === "line" || def.type === "area") {
    if (!fieldOf(c, def.time)) return { html: "", text: "" };
    let all = bucketsOf(c, def, list3, now, extra.range);
    for (let i = INTERVALS.indexOf(all.iv) + 1; all.length > 14 && i < INTERVALS.length; i++) all = bucketsOf(c, { ...def, interval: INTERVALS[i] }, list3, now, extra.range);
    const iv = all.iv, b = all.slice(-12);
    const max = Math.max(0, ...b.map((x) => x.value)) || 1;
    const rows = b.map((x) => `<tr>${td(esc(bucketName(x.start, iv) + (x.partial ? " (so far)" : "")), "width:34%;white-space:nowrap")}${td(barCell(x.value, max), "width:44%")}${td(esc(fmtMeasure(c, def, x.value)), "text-align:right;white-space:nowrap")}</tr>`).join("");
    return { html: table(rows), text: b.map((x) => `${bucketName(x.start, iv)}${x.partial ? " (so far)" : ""}: ${fmtMeasure(c, def, x.value)}`).join("; ") };
  }
  if (def.type === "pivot") {
    const p = pivotOf(c, def, list3);
    if (!p) return { html: "", text: "" };
    const cols2 = p.cols.slice(0, 8), rows = p.rows.slice(0, 20);
    const head2 = `<tr>${th(esc(groupLabel(c, def.group) || ""))}${cols2.map((k) => th(esc(k), "text-align:right")).join("")}${th("Total", "text-align:right")}</tr>`;
    const body2 = rows.map((r) => `<tr>${td(esc(r.key))}${r.cells.slice(0, 8).map((v) => td(v == null ? "\u2013" : esc(fmtMeasure(c, def, v)), "text-align:right")).join("")}${td("<b>" + esc(fmtMeasure(c, def, r.total)) + "</b>", "text-align:right")}</tr>`).join("");
    const tot = `<tr>${td("<b>Total</b>", `background:${SOFT}`)}${p.colTotals.slice(0, 8).map((v) => td("<b>" + esc(fmtMeasure(c, def, v)) + "</b>", `text-align:right;background:${SOFT}`)).join("")}${td("<b>" + esc(fmtMeasure(c, def, p.grand)) + "</b>", `text-align:right;background:${SOFT}`)}</tr>`;
    return { html: table(body2 + tot, head2) + more(p.rows.length - rows.length + p.moreRows, "rows"), text: `${p.rows.length} rows, total ${fmtMeasure(c, def, p.grand)}` };
  }
  if (def.type === "grouped") {
    const groups = groupRows(c, def, def.group, list3);
    const shown2 = groups.slice(0, 20);
    const rows = shown2.map((g) => `<tr>${td(esc(g.key))}${td(String(g.rows.length), `text-align:right;color:${MUTED}`)}${td(esc(fmtMeasure(c, def, g.value)), "text-align:right")}</tr>`).join("");
    const head2 = `<tr>${th(esc(groupLabel(c, def.group) || "Group"))}${th("Records", "text-align:right")}${th(esc(measureLabel(c, def)), "text-align:right")}</tr>`;
    const tot = `<tr>${td("<b>Total</b>", `background:${SOFT}`)}${td("<b>" + list3.length + "</b>", `text-align:right;background:${SOFT}`)}${td("<b>" + esc(fmtMeasure(c, def, measureOf(c, def, list3))) + "</b>", `text-align:right;background:${SOFT}`)}</tr>`;
    return { html: table(rows + tot, head2) + more(groups.length - shown2.length, "groups"), text: shown2.map((g) => `${g.key}: ${fmtMeasure(c, def, g.value)}`).join("; ") };
  }
  const cols = (def.columns || []).filter((r) => fieldOf(c, r)).slice(0, 6);
  if (!cols.length) return { html: "", text: "" };
  const sref = def.sort && cols[def.sort.i] || cols[0];
  const sorted = sortRecs(c, list3, sref, def.sort?.dir || 1);
  const shown = sorted.slice(0, 15);
  const head = `<tr>${cols.map((r) => th(esc(refLabel(c, r, def.form)), isNumRef(c, r) ? "text-align:right" : "")).join("")}</tr>`;
  const body = shown.map((rec) => `<tr>${cols.map((r) => td(esc(cellText(c, r, rec) || "\u2013"), isNumRef(c, r) ? "text-align:right;white-space:nowrap" : "")).join("")}</tr>`).join("");
  return { html: table(body, head) + more(sorted.length - shown.length, "records"), text: `${sorted.length} records` };
}
function dashEmail(c, dash, reports, { now = Date.now(), link = "", schedule = null, company = "" } = {}) {
  const periodKey = dash.filters?.period || "all";
  const custom = periodKey === "custom" ? { from: dash.filters?.from || "", to: dash.filters?.to || "" } : null;
  const range = periodRange(periodKey, now, custom);
  const extra = { periodKey, custom, range: range ? { from: range.from, to: range.to } : null, fields: [] };
  const date = dayName(now, { weekday: true });
  const pName = periodName(periodKey, custom);
  const parts = [], text = [`${dash.name || "Dashboard"} \xB7 ${pName} \xB7 ${date}`, ""];
  readingOrder(canvasTiles(dash.tiles || []).filter((t) => t.report || t.text)).forEach((t) => {
    if (t.text) {
      parts.push(`<tr><td style="padding:14px 0 6px">${t.text.title ? `<div style="font-size:15px;font-weight:700;color:${INK}">${esc(t.text.title)}</div>` : ""}${String(t.text.body || "").split(/\n{2,}/).filter(Boolean).map((p) => `<p style="margin:6px 0 0;font-size:13px;color:${INK}">${esc(p)}</p>`).join("")}</td></tr>`);
      if (t.text.title || t.text.body) text.push([t.text.title, t.text.body].filter(Boolean).join(": "));
      return;
    }
    const r = reports.get(t.report);
    if (!r || !r.def) return;
    const def = normalizeDef(c, r.def);
    const b = reportBlock(c, def, extra, now);
    parts.push(`<tr><td style="padding:14px 16px;border:1px solid ${LINE};border-radius:10px;background:#ffffff"><div style="font-size:15px;font-weight:700;color:${INK};margin-bottom:8px">${esc(r.name || "Report")}</div>${b.html}</td></tr><tr><td style="height:12px;font-size:0;line-height:0">&nbsp;</td></tr>`);
    text.push(`${r.name || "Report"}: ${b.text}`);
  });
  if (!parts.length) parts.push(`<tr><td style="font-size:13px;color:${MUTED}">This dashboard has no reports yet.</td></tr>`);
  const foot = `${schedule ? esc(scheduleText(schedule)) + ". " : ""}Sent by Formwright${company ? " for " + esc(String(company).replace(/\.$/, "")) : ""}. An administrator can change who gets this on the dashboard (Email schedule).`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:${SOFT}"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:${SOFT}"><tr><td align="center" style="padding:20px 12px">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
      <tr><td style="padding:0 0 14px"><div style="font-size:22px;font-weight:700;color:${INK}">${esc(dash.name || "Dashboard")}</div><div style="font-size:13px;color:${MUTED};margin-top:2px">${esc(pName)} \xB7 ${esc(date)}${link ? ` \xB7 <a href="${esc(link)}" style="color:${BAR}">Open the dashboard</a>` : ""}</div></td></tr>
      ${parts.join("")}
      <tr><td style="padding:10px 0 0;font-size:12px;color:${MUTED}">${foot}</td></tr>
    </table></td></tr></table></body></html>`;
  if (link) text.push("", "Open the dashboard: " + link);
  return { subject: `${dash.name || "Dashboard"} \xB7 ${dayName(now, { year: false })}`.slice(0, 200), html, text: text.join("\n") };
}

// src/autosched.js
var FREQS = [
  { key: "day", one: "day", many: "days", max: 365 },
  { key: "week", one: "week", many: "weeks", max: 52 },
  { key: "month", one: "month", many: "months", max: 24 },
  { key: "quarter", one: "quarter", many: "quarters", max: 8 },
  { key: "year", one: "year", many: "years", max: 10 }
];
var WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var NTHS = [{ v: 1, label: "first" }, { v: 2, label: "second" }, { v: 3, label: "third" }, { v: 4, label: "fourth" }, { v: -1, label: "last" }];
var DEFAULT_HOUR = 17;
var pad2 = (n) => String(n).padStart(2, "0");
var utc = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
var keyOf2 = (dt) => dt.toISOString().slice(0, 10);
var addDays = (key, n) => keyOf2(new Date(utc(key).getTime() + n * 864e5));
var isoDow = (key) => (utc(key).getUTCDay() + 6) % 7 + 1;
var daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
var monthIdx = (key) => {
  const [y, m] = key.split("-").map(Number);
  return y * 12 + (m - 1);
};
var freqOf = (k) => FREQS.find((f) => f.key === k) || FREQS[2];
var hourOf = (t) => {
  const h = Math.round(Number(t?.hour));
  return Number.isFinite(h) && h >= 0 && h <= 23 ? h : DEFAULT_HOUR;
};
function lastDay(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return keyOf2(new Date(Date.UTC(y, m, 0)));
}
function normalize(t0) {
  const t = { ...t0 || {} };
  if (!t.freq) {
    t.freq = "month";
    t.on = t.every === "monthEnd" ? { kind: "date", day: "last" } : { kind: "nth", nth: -1, what: "biz" };
  }
  delete t.every;
  const f = freqOf(t.freq);
  t.freq = f.key;
  t.n = Math.min(f.max, Math.max(1, Math.round(Number(t.n) || 1)));
  t.hour = hourOf(t);
  if (t.freq === "week") t.days = [...new Set((Array.isArray(t.days) ? t.days : []).map(Number).filter((d) => d >= 1 && d <= 7))].sort((a, b) => a - b);
  if (["month", "quarter", "year"].includes(t.freq)) {
    const o = t.on || {};
    t.on = o.kind === "nth" ? { kind: "nth", nth: [1, 2, 3, 4, -1].includes(Number(o.nth)) ? Number(o.nth) : 1, what: o.what === "biz" ? "biz" : Math.min(7, Math.max(1, Number(o.what) || 1)) } : { kind: "date", day: o.day === "last" ? "last" : Math.min(31, Math.max(1, Math.round(Number(o.day) || 1))) };
  }
  if (t.freq === "quarter") t.qmonth = t.qmonth === "last" ? "last" : "first";
  if (t.freq === "year") t.month = Math.min(12, Math.max(1, Math.round(Number(t.month) || 1)));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(t.start || ""))) delete t.start;
  return t;
}
function onMatches(on, key) {
  const last = lastDay(key.slice(0, 7)), dom = Number(key.slice(8, 10));
  if (on.kind === "date") return dom === (on.day === "last" ? Number(last.slice(8)) : Math.min(on.day, Number(last.slice(8))));
  const hits = [];
  for (let d = 1; d <= Number(last.slice(8)); d++) {
    const k = key.slice(0, 8) + pad2(d), w = isoDow(k);
    if (on.what === "biz" ? w <= 5 : w === on.what) hits.push(d);
  }
  return dom === (on.nth === -1 ? hits[hits.length - 1] : hits[on.nth - 1]);
}
function isRunDay(t0, key) {
  const t = normalize(t0);
  if (t.start && key < t.start) return false;
  const start = t.start || key;
  const every = (diff) => diff % t.n === 0;
  switch (t.freq) {
    case "day":
      if (t.weekdaysOnly && isoDow(key) > 5) return false;
      return every(daysBetween(start, key));
    case "week": {
      if (!t.days.includes(isoDow(key))) return false;
      const mon = (k) => addDays(k, 1 - isoDow(k));
      return every(daysBetween(mon(start), mon(key)) / 7);
    }
    case "month":
      return every(monthIdx(key) - monthIdx(start)) && onMatches(t.on, key);
    case "quarter": {
      const m = Number(key.slice(5, 7)), want = t.qmonth === "last" ? [3, 6, 9, 12] : [1, 4, 7, 10];
      if (!want.includes(m)) return false;
      const q = (k) => Math.floor(monthIdx(k) / 3);
      return every(q(key) - q(start)) && onMatches(t.on, key);
    }
    case "year":
      return Number(key.slice(5, 7)) === t.month && every(Number(key.slice(0, 4)) - Number(start.slice(0, 4))) && onMatches(t.on, key);
  }
  return false;
}
function scheduleNow(t0, local) {
  const t = normalize(t0);
  const today = local.slice(0, 10), late = Number(local.slice(11, 13)) >= t.hour, tomorrow = addDays(today, 1);
  return { period: today, run: late && isRunDay(t, today), headsPeriod: tomorrow, headsUp: !!t.headsUp && t.freq !== "day" && late && isRunDay(t, tomorrow) };
}
function nextRuns(t0, local, count = 3) {
  const t = normalize(t0), out = [];
  let k = local.slice(0, 10);
  if (Number(local.slice(11, 13)) >= t.hour) k = addDays(k, 1);
  if (t.start && k < t.start) k = t.start;
  for (let i = 0; i < 12e3 && out.length < count; i++, k = addDays(k, 1)) if (isRunDay(t, k)) out.push(k);
  return out;
}
var nextRun = (t, local) => nextRuns(t, local, 1)[0] || null;
function hourText2(h) {
  const n = hourOf({ hour: h });
  return n === 0 ? "midnight" : n === 12 ? "noon" : `${n % 12}:00 ${n < 12 ? "a.m." : "p.m."}`;
}
var dayText = (key) => utc(key).toLocaleDateString("en-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
var longDate = (key) => utc(key).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
var ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
var list2 = (xs) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
function onText(on) {
  if (on.kind === "date") return on.day === "last" ? "the last day" : `the ${ordinal(on.day)}`;
  return `the ${NTHS.find((x) => x.v === on.nth)?.label || "first"} ${on.what === "biz" ? "business day" : WEEKDAYS[on.what - 1]}`;
}
function scheduleText2(t0) {
  const t = normalize(t0), f = freqOf(t.freq);
  const every = t.n === 1 ? `Every ${f.one}` : `Every ${t.n} ${f.many}`;
  let s;
  if (t.freq === "day") s = t.n === 1 && t.weekdaysOnly ? "Every weekday (Monday to Friday)" : every + (t.weekdaysOnly ? ", weekdays only" : "");
  else if (t.freq === "week") s = `${every} on ${t.days.length ? list2(t.days.map((d) => WEEKDAYS[d - 1])) : "(pick a day)"}`;
  else if (t.freq === "month") s = `${every} on ${onText(t.on)}`;
  else if (t.freq === "quarter") {
    const of = t.qmonth === "last" ? "last" : "first";
    s = `${every} on ${onText(t.on)} of the quarter\u2019s ${of} month`;
  } else s = `${every} on ${t.on.kind === "date" && t.on.day !== "last" ? `${MONTHS[t.month - 1]} ${t.on.day}` : `${onText(t.on)} of ${MONTHS[t.month - 1]}`}`;
  return `${s} at ${hourText2(t.hour)}${t.n > 1 && t.start ? `, starting ${longDate(t.start)}` : ""}`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ACTION_LABEL,
  COLORS,
  assigneeFor,
  autoScheduleText,
  dashEmail,
  dayKey,
  dayText,
  daysOverdue,
  drawPdf,
  dueSlot,
  fileName,
  fillTemplate,
  firstStage,
  hourText,
  itemName,
  makeKit,
  nextRun,
  nextRuns,
  normalizeCal,
  normalizeSchedule,
  opOf,
  overdueStep,
  partsIn,
  recipients,
  ruleFires,
  scheduleNow,
  scheduleText,
  setCalendar,
  stageDue,
  testCond,
  wfOn
});
