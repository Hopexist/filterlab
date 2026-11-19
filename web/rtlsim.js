/* In-browser interpreter for the SystemVerilog subset that dsp/rtl.py and web/rtl.js emit (logic of tests/rtl_eval.py).
 * It parses the generated TEXT, never the design parameters, and runs it one clock edge at a time.
 *
 * Subset: `module name (ports);` with `input|output logic [signed] [N:0] name` ports; `logic [signed] [N:0] a, b;`;
 * `assign w = expr;`; one `always_ff @(posedge clk)` whose statements are begin/end, if/else and `reg <= expr;`.
 * Expressions: identifiers, sized literals N'sdV / N'dV / N'bB, unsized decimals, '0, unary + -, binary * + - <<< >>> < >,
 * parentheses and ?:. Anything else throws "unsupported construct". Values are BigInt (exact at any width).
 *
 * Width and sign rules (IEEE 1800-2017 11.6, 11.8): an expression is signed only if all its context-determined operands
 * are signed; context width = max(LHS width, operand widths); operands are converted to that type, then extended (sign-
 * extended only when the type is signed); every operation wraps to the context width; shift amounts and ?: / if
 * conditions are self-determined; < > compare at max(operand widths) and give a 1-bit unsigned result. Assignment
 * truncates to the LHS width. X is modelled conservatively: a register is X until assigned, and any X operand makes
 * the result X (no 4-state bit merging).
 */
(function (root) {
'use strict';
const KW = new Set(['module', 'endmodule', 'input', 'output', 'logic', 'signed', 'assign', 'always_ff', 'posedge', 'begin', 'end', 'if', 'else']);
const unsupported = (what, line) => { throw new Error(`unsupported construct: ${what} (line ${line}). The interpreter only runs the subset Filterlab generates.`); };

function lex(text) {
  const toks = [], re = /\s+|\/\/[^\n]*|(\d+)'(s?)([dbDB])([0-9a-fA-F_]+)|'0|\d+|[A-Za-z_][A-Za-z0-9_$]*|<<<|>>>|<=|[()[\]:;,?@=+\-*<>]|./gy;
  let m, line = 1;
  while (re.lastIndex < text.length && (m = re.exec(text))) {
    const s = m[0];
    if (/^\s/.test(s) || s.startsWith('//')) { line += (s.match(/\n/g) || []).length; continue; }
    if (m[1] !== undefined) {
      const w = +m[1], base = m[3].toLowerCase(), digits = m[4].replace(/_/g, '');
      if (w < 1 || !(base === 'd' ? /^\d+$/ : /^[01]+$/).test(digits)) unsupported(`literal ${s}`, line);
      toks.push({ t: 'num', v: BigInt(base === 'd' ? digits : '0b' + digits), w, s: m[2] === 's', line, src: s });
    } else if (s === "'0") toks.push({ t: 'num', v: 0n, w: 1, s: false, line, src: s });
    else if (/^\d/.test(s)) toks.push({ t: 'num', v: BigInt(s), w: 32, s: true, line, src: s });
    else if (/^[A-Za-z_]/.test(s)) toks.push({ t: KW.has(s) ? s : 'id', v: s, line, src: s });
    else if (/^(<<<|>>>|<=|[()[\]:;,?@=+\-*<>])$/.test(s)) toks.push({ t: s, line, src: s });
    else unsupported(`character '${s}'`, line);
  }
  toks.push({ t: 'eof', line, src: 'end of text' });
  return toks;
}

function parse(text) {
  const T = lex(text); let i = 0;
  const peek = () => T[i], next = () => T[i++];
  const expect = t => { const k = next(); if (k.t !== t) unsupported(`'${k.src}' where '${t}' was expected`, k.line); return k; };
  const sig = {}, assigns = [], always = [];
  function declare(name, info, line) { if (sig[name]) unsupported(`second declaration of '${name}'`, line); sig[name] = info; }
  function range() {
    if (peek().t !== '[') return 1;
    next(); const hi = expect('num'); expect(':'); const lo = expect('num'); expect(']');
    if (lo.v !== 0n || hi.v < 0n || hi.v > 4095n) unsupported(`range [${hi.src}:${lo.src}] (only [N:0])`, lo.line);
    return Number(hi.v) + 1;
  }
  // expressions, lowest precedence first: ?:  <  >  then <<< >>>  then + -  then *  then unary
  function expr() { const c = cmp(); if (peek().t !== '?') return c; next(); const a = expr(); expect(':'); return { op: '?:', c, a, b: expr() }; }
  function cmp() { let a = shift(); while (peek().t === '<' || peek().t === '>') { const op = next().t; a = { op, a, b: shift() }; } return a; }
  function shift() { let a = add(); while (peek().t === '<<<' || peek().t === '>>>') { const op = next().t; a = { op, a, b: add() }; } return a; }
  function add() { let a = mul(); while (peek().t === '+' || peek().t === '-') { const op = next().t; a = { op, a, b: mul() }; } return a; }
  function mul() { let a = unary(); while (peek().t === '*') { next(); a = { op: '*', a, b: unary() }; } return a; }
  function unary() { if (peek().t === '-' || peek().t === '+') { const op = next().t; return { op: 'u' + op, a: unary() }; } return primary(); }
  function primary() {
    const k = next();
    if (k.t === 'num') return { op: 'lit', v: k.v, w: k.w, s: k.s };
    if (k.t === 'id') { if (!sig[k.v]) unsupported(`undeclared name '${k.v}'`, k.line); return { op: 'id', name: k.v }; }
    if (k.t === '(') { const e = expr(); expect(')'); return e; }
    unsupported(`'${k.src}' in an expression`, k.line);
  }
  function target() { const k = expect('id'); if (!sig[k.v]) unsupported(`undeclared name '${k.v}'`, k.line); return k.v; }
  function stmt() {
    const k = peek();
    if (k.t === 'begin') { next(); const body = []; while (peek().t !== 'end') { if (peek().t === 'eof') unsupported('missing end', k.line); body.push(stmt()); } next(); return { k: 'block', body }; }
    if (k.t === 'if') { next(); expect('('); const c = expr(); expect(')'); const a = stmt(); let b = null; if (peek().t === 'else') { next(); b = stmt(); } return { k: 'if', c, a, b }; }
    if (k.t === 'id') { const lhs = target(); expect('<='); const e = expr(); expect(';'); return { k: 'nba', lhs, e, line: k.line }; }
    unsupported(`statement starting with '${k.src}'`, k.line);
  }

  expect('module'); const name = expect('id').v; expect('(');
  const ports = [];
  for (;;) {
    const dir = next(); if (dir.t !== 'input' && dir.t !== 'output') unsupported(`port '${dir.src}' (only input/output logic)`, dir.line);
    expect('logic'); let s = false; if (peek().t === 'signed') { next(); s = true; }
    const w = range(), n = expect('id');
    declare(n.v, { w, s, kind: dir.t }, n.line); ports.push(n.v);
    if (peek().t === ',') { next(); continue; } expect(')'); break;
  }
  expect(';');
  for (;;) {
    const k = next();
    if (k.t === 'endmodule') break;
    if (k.t === 'logic') {
      let s = false; if (peek().t === 'signed') { next(); s = true; } const w = range();
      for (;;) { const n = expect('id'); declare(n.v, { w, s, kind: 'var' }, n.line); if (peek().t === ',') { next(); continue; } expect(';'); break; }
    } else if (k.t === 'assign') {
      const lhs = target(); expect('='); const e = expr(); expect(';'); assigns.push({ lhs, e, line: k.line });
    } else if (k.t === 'always_ff') {
      expect('@'); expect('('); expect('posedge'); const clk = target(); expect(')');
      if (always.length) unsupported('a second always_ff block', k.line);
      if (sig[clk].kind !== 'input' || sig[clk].w !== 1) unsupported(`clock '${clk}' that is not a 1-bit input`, k.line);
      always.push({ clk, body: stmt() });
    } else unsupported(`'${k.src}' at module level`, k.line);
  }
  if (peek().t !== 'eof') unsupported(`'${peek().src}' after endmodule`, peek().line);
  if (!always.length) unsupported('a module without an always_ff block', 1);

  // drivers: each assign target once, never also a register or an input; registers are always_ff targets
  const driven = {}, regs = new Set();
  for (const a of assigns) {
    if (sig[a.lhs].kind === 'input') unsupported(`assign to input '${a.lhs}'`, a.line);
    if (driven[a.lhs]) unsupported(`second driver of '${a.lhs}'`, a.line);
    driven[a.lhs] = a;
  }
  (function walk(s) {
    if (s.k === 'block') s.body.forEach(walk); else if (s.k === 'if') { walk(s.a); if (s.b) walk(s.b); }
    else { if (driven[s.lhs] || sig[s.lhs].kind === 'input') unsupported(`'${s.lhs}' driven by both assign and always_ff, or an input`, s.line); regs.add(s.lhs); }
  })(always[0].body);
  // continuous assigns in dependency order (the generator writes them in order, but the language does not require it)
  const order = [], state = {};
  const deps = e => e.op === 'id' ? [e.name] : e.op === 'lit' ? [] : [e.a, e.b, e.c].filter(Boolean).flatMap(deps);
  function visit(n, line) {
    if (!driven[n] || state[n] === 2) return;
    if (state[n] === 1) unsupported(`combinational loop through '${n}'`, line);
    state[n] = 1; for (const d of deps(driven[n].e)) visit(d, driven[n].line); state[n] = 2; order.push(driven[n]);
  }
  assigns.forEach(a => visit(a.lhs, a.line));
  return { name, ports, sig, assigns: order, always: always[0], regs: [...regs] };
}

/* ---- evaluation with SystemVerilog sizing ---- */
const norm = (v, w, s) => { const m = 1n << BigInt(w); v = ((v % m) + m) % m; return s && v >= m >> 1n ? v - m : v; };
function size(e, sig) {
  switch (e.op) {
    case 'lit': return { w: e.w, s: e.s };
    case 'id': return { w: sig[e.name].w, s: sig[e.name].s };
    case 'u-': case 'u+': return size(e.a, sig);
    case '<': case '>': return { w: 1, s: false };
    case '<<<': case '>>>': return size(e.a, sig);
    case '?:': { const a = size(e.a, sig), b = size(e.b, sig); return { w: Math.max(a.w, b.w), s: a.s && b.s }; }
    default: { const a = size(e.a, sig), b = size(e.b, sig); return { w: Math.max(a.w, b.w), s: a.s && b.s }; }
  }
}
// value of e converted to width W and signedness S (null = X)
function ev(e, W, S, env, sig) {
  switch (e.op) {
    case 'lit': case 'id': {
      const v = e.op === 'lit' ? e.v : env[e.name]; if (v === null || v === undefined) return null;
      const own = e.op === 'lit' ? e : sig[e.name], bits = norm(v, own.w, false);   // the operand's own bit pattern
      return norm(S ? norm(bits, own.w, true) : bits, W, S);                      // extend per the propagated type
    }
    case 'u-': { const a = ev(e.a, W, S, env, sig); return a === null ? null : norm(-a, W, S); }
    case 'u+': return ev(e.a, W, S, env, sig);
    case '+': case '-': case '*': {
      const a = ev(e.a, W, S, env, sig), b = ev(e.b, W, S, env, sig); if (a === null || b === null) return null;
      return norm(e.op === '+' ? a + b : e.op === '-' ? a - b : a * b, W, S);
    }
    case '<<<': case '>>>': {
      const a = ev(e.a, W, S, env, sig), bs = size(e.b, sig), b = ev(e.b, bs.w, false, env, sig);   // amount is unsigned
      if (a === null || b === null) return null;
      if (e.op === '<<<') return b >= BigInt(W) ? 0n : norm(a << b, W, S);
      return b >= BigInt(W) ? (a < 0n ? -1n : 0n) : a >> b;    // BigInt >> floors: arithmetic for signed, logical for unsigned (a >= 0)
    }
    case '<': case '>': {
      const sa = size(e.a, sig), sb = size(e.b, sig), w = Math.max(sa.w, sb.w), s = sa.s && sb.s;
      const a = ev(e.a, w, s, env, sig), b = ev(e.b, w, s, env, sig); if (a === null || b === null) return null;
      return norm((e.op === '<' ? a < b : a > b) ? 1n : 0n, W, S);
    }
    case '?:': {
      const cs = size(e.c, sig), c = ev(e.c, cs.w, cs.s, env, sig); if (c === null) return null;
      return ev(c !== 0n ? e.a : e.b, W, S, env, sig);
    }
  }
  throw new Error('internal: unknown node ' + e.op);
}
function assignValue(lhs, e, env, sig) {
  const t = sig[lhs], r = size(e, sig), v = ev(e, Math.max(t.w, r.w), r.s, env, sig);
  return v === null ? null : norm(v, t.w, t.s);
}

/* A running instance. step(inputs) = set inputs, settle assigns, apply one posedge. */
function create(text) {
  const m = typeof text === 'string' ? parse(text) : text, sig = m.sig, env = {};
  for (const n in sig) env[n] = null;
  const clk = m.always.clk;
  function settle() { for (const a of m.assigns) env[a.lhs] = assignValue(a.lhs, a.e, env, sig); }
  function step(inputs) {
    for (const n in inputs) {
      if (!sig[n] || sig[n].kind !== 'input' || n === clk) throw new Error(`'${n}' is not a data input of module ${m.name}`);
      env[n] = norm(BigInt(inputs[n]), sig[n].w, sig[n].s);
    }
    settle();
    const before = { ...env }, nba = [];
    (function exec(s) {
      if (s.k === 'block') s.body.forEach(exec);
      else if (s.k === 'if') { const cs = size(s.c, sig), c = ev(s.c, cs.w, cs.s, env, sig); if (c !== null && c !== 0n) exec(s.a); else if (s.b) exec(s.b); }  // if (X) takes else, as in SV
      else nba.push([s.lhs, assignValue(s.lhs, s.e, env, sig)]);
    })(m.always.body);
    for (const [r, v] of nba) env[r] = v;      // non-blocking: every right-hand side was read before any update
    settle();
    return { before, after: { ...env } };
  }
  return { module: m, step, env };
}

/* Reset for one clock, then one sample per clock with in_valid high. Returns out_data after each edge (null = X). */
function run(text, xs, { trace = false } = {}) {
  const sim = create(text), y = [], valid = [], cycles = [];
  sim.step({ rst: 1, in_valid: 0, in_data: 0 });
  for (const x of xs) {
    const c = sim.step({ rst: 0, in_valid: 1, in_data: x });
    y.push(c.after.out_data === null ? null : Number(c.after.out_data)); valid.push(c.after.out_valid === 1n);
    if (trace) cycles.push(c);
  }
  return { y, valid, cycles, module: sim.module };
}

root.RTLSim = { parse, create, run, lex };
if (typeof module !== 'undefined') module.exports = root.RTLSim;
})(typeof window !== 'undefined' ? window : globalThis);
