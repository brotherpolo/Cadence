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
  dayKey: () => dayKey,
  drawPdf: () => drawPdf,
  fileName: () => fileName,
  fillTemplate: () => fillTemplate,
  firstStage: () => firstStage,
  itemName: () => itemName,
  makeKit: () => makeKit,
  opOf: () => opOf,
  ruleFires: () => ruleFires,
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
  const cache = /* @__PURE__ */ new Map();
  function parse(src) {
    if (cache.has(src)) return cache.get(src);
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
    cache.set(src, ast);
    if (cache.size > 500) cache.clear();
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
  if (type === "rating") return "rating";
  if (type === "color") return "color";
  return "text";
}
var fsize = (n) => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(0) + " KB" : (n / 1048576).toFixed(1) + " MB";
function fieldItem(f, v, text) {
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
      return base;
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
function colWidths(cols, rows, measure, avail, { min = 36, cap = 220, pad = 10 } = {}) {
  const n = cols.length;
  if (!n) return [];
  const want = cols.map((c, i) => {
    let w2 = Math.max(...String(c.label || "").split(/\s+/).map((s) => measure(s, true)), 0);
    rows.forEach((r) => {
      w2 = Math.max(w2, Math.min(cap, measure(String(r[i] ?? ""))));
    });
    return Math.max(min, Math.min(cap, w2) + pad);
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
function planTable(cols, rows, measure, { spaces, sizes = [9.5, 8.5, 7.5, 7], pad = 10, cap = 230, maxWord = 0.4, short = 20 } = {}) {
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
      minW[i] = Math.max(head, keep) + pad + 0.5;
      want[i] = Math.max(minW[i], Math.min(cap, full) + pad + 0.5);
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
  const widths = colWidths(cols.map((c) => ({ label: c.label })), rows, (t, b) => measure(size, b)(t), sp.avail, { min: 30, cap, pad });
  return { size, widths, landscape: !!sp.landscape, broken: true };
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
var NO_VALUE = /* @__PURE__ */ new Set(["heading", "formula", "autonumber"]);
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
  let blank = /* @__PURE__ */ new Set();
  let st = null;
  for (let pass = 0; pass < 6; pass++) {
    const look = (c) => {
      if (!c.src || c.src === "self") {
        const f = byId.get(c.field);
        if (!f) return null;
        return { f, v: blank.has(f.id) ? null : get("self", c.field)?.v };
      }
      return get(c.src, c.field);
    };
    st = once(rules, fields, byId, under, look);
    if (sameSet(st.blank, blank)) break;
    blank = st.blank;
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
  const blank = new Set([...hiddenFields, ...cleared].filter((id) => holdsValue(byId.get(id))));
  const required = (f) => {
    if (!f || !holdsValue(f) || hiddenFields.has(f.id) || cleared.has(f.id)) return false;
    const k = "f:" + f.id;
    if (req.get(k) === true) return true;
    if (opt.has(k)) return false;
    if (req.has(k)) return false;
    return !!f.required;
  };
  return { hidden, hiddenFields, cleared, required, fired, blank };
}
var sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
var NO_RULES = { hidden: /* @__PURE__ */ new Set(), hiddenFields: /* @__PURE__ */ new Set(), cleared: /* @__PURE__ */ new Set(), required: (f) => !!(f && f.required && holdsValue(f)), fired: /* @__PURE__ */ new Map(), blank: /* @__PURE__ */ new Set() };

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
  if (a.type === "person" && a.person) return { assignee: a.person, assigneeGroup: null };
  if (a.type === "group" && a.group) return { assignee: null, assigneeGroup: a.group };
  if (a.type === "mover") return { assignee: moverId || rec?.ownerId || null, assigneeGroup: null };
  if (a.type === "keep" && rec && (rec.assignee || rec.assigneeGroup)) return { assignee: rec.assignee || null, assigneeGroup: rec.assigneeGroup || null };
  return { assignee: rec?.ownerId || moverId || null, assigneeGroup: null };
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

// src/server/recordkit.js
var POPUP = /* @__PURE__ */ new Set(["textarea", "file", "image", "signature", "location", "multiselect"]);
var COLORS = ["#3346c8", "#0f7b6c", "#b4531a", "#8a3fb8", "#b42367", "#3d6b1f", "#56607a", "#0b6aa2"];
var isEmpty2 = (v) => v == null || v === "" || Array.isArray(v) && !v.length || typeof v === "object" && !Array.isArray(v) && !Object.values(v).some((x) => x != null && x !== "");
var lc = (s) => String(s || "").trim().toLowerCase();
var itemName = (f) => (f?.itemName || "").trim() || (f?.name || "Record").replace(/s$/i, "");
function makeKit({ forms = [], records = [], locale = "en-CA", timeZone = "America/Toronto" } = {}) {
  const formMap = new Map(forms.map((f) => [f.id, f]));
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
  const titleFieldOf = (form) => {
    const fs = form?.fields || [];
    return fs.find((f) => f.id === form.titleField) || fs.find((f) => ["text", "email", "phone", "url"].includes(f.type)) || fs.find((f) => f.type !== "heading");
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
  const fieldByName = (form, name) => {
    const n = lc(name);
    return (form?.fields || []).find((f) => f.type !== "heading" && (lc(f.label) === n || f.id === name));
  };
  function rawFor(f, rec, form, depth) {
    if (f.type === "formula") return evalFormula(form, f, rec, depth + 1);
    const v = f.type === "autonumber" ? rec.nums?.[f.id] : rec.values?.[f.id];
    if (f.type === "relation") {
      const r = v && recById(v);
      return r ? recTitle(r) : "";
    }
    if (f.type === "location") return v?.address || "";
    if (f.type === "file" || f.type === "image") return v?.name || "";
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
        const cf = forms.find((x) => lc(x.name) === lc(a[0]));
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
    const f = titleFieldOf(form);
    const t = f ? fmt(f, valOf(f, rec, form)) : "";
    return t || "Untitled " + itemName(form).toLowerCase();
  }
  const text = (form, rec, f) => f.type === "heading" ? "" : f.type === "textarea" ? String(valOf(f, rec, form) ?? "") : fmt(f, valOf(f, rec, form));
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
    const items = (form.fields || []).filter((f) => !rs.hiddenFields.has(f.id) && !rs.hidden.has("f:" + f.id) && !sv.hide.has(f.id) && !sv.keys.has("f:" + f.id)).map((f) => {
      const v = f.type === "heading" || rs.cleared.has(f.id) ? null : valOf(f, rec, form);
      const it = fieldItem(f, v, f.type === "heading" ? "" : f.type === "rating" ? isEmpty2(v) ? "" : `${v} of ${f.max || 5}` : text(form, { ...rec, values: { ...rec.values, [f.id]: v } }, f));
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
      const usable = (cf.fields || []).filter((f) => f.type !== "heading");
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
        const tf = titleFieldOf(cf);
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
  return { formById, recById, childrenOf, titleFieldOf, fmt, fmtCalc, valOf, recTitle, text, fieldText, getter, rulesFor, look, pdfModel };
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
  const chars = new Set(F.getCharacterSet());
  const T = (s) => safeText(s, (cp) => chars.has(cp));
  const INK = rgb(0.1, 0.11, 0.14), MUTE = rgb(0.4, 0.43, 0.49), RULE = rgb(0.84, 0.85, 0.88);
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
  const text = (s, x, yy, font, size, color = INK) => {
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
      text(nm, x, mid, B, size, INK);
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
    text(ln, M, y, B, 20, INK);
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
    text(one(p, B, 9, CW - F.widthOfTextAtSize(lab, 9)), M + F.widthOfTextAtSize(lab, 9), y, B, 9, INK);
    y -= 13;
  }
  y -= 14;
  const SEC = 12.5;
  function heading(label, extra, help) {
    ensure(SEC + 70);
    if (y < TOP - 40) y -= 10;
    const lab = one(label, B, SEC, CW - 60);
    text(lab, M, y, B, SEC, INK);
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
        text(T(it.text), x + 16, top - labH - 10, F, VAL, INK);
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
      lines.forEach((ln, i) => text(ln, x, top - labH - VAL - i * VALH + 1, font, VAL, INK));
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
    if (cs.length === 1 && cs[0].lines && h > room()) {
      const c = cs[0];
      ensure(c.labH + VALH * 2);
      c.drawLab(M, y);
      y -= c.labH;
      c.lines.forEach((ln) => {
        if (VALH > room()) newPage();
        text(ln, M, y - VAL + 1, c.font, VAL, INK);
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
    const drawRowCells = (lines, font, top, color = INK) => {
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ACTION_LABEL,
  COLORS,
  assigneeFor,
  dayKey,
  drawPdf,
  fileName,
  fillTemplate,
  firstStage,
  itemName,
  makeKit,
  opOf,
  ruleFires,
  stageDue,
  testCond,
  wfOn
});
