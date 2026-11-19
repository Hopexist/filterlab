// web/rtlsim.js (in-browser SystemVerilog interpreter) against the bit-true models and the Python evaluator.
// Run tests/export_reference.py first. Usage: node tests/rtlsim_check.js
const D = require('../web/dsp.js'), RTL = require('../web/rtl.js'), S = require('../web/rtlsim.js'), ref = require('./reference.json');
let fails = 0, count = 0;
function check(name, ok, detail = '') { count++; if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, detail); }
const firstDiff = (a, b) => { if (a.length !== b.length) return `length ${a.length} vs ${b.length}`; const i = a.findIndex((v, k) => v !== b[k]); return i < 0 ? '' : `first mismatch at sample ${i}: ${a[i]} vs ${b[i]}`; };
const same = (name, a, b) => { const d = firstDiff(a, b); check(name, d === '', d); };

// JS bit-true model for a design from the export list (integers in, integers out)
function model(r, x) {
  const cf = D.qFormat(...r.coef), sf = D.qFormat(...r.sig), xs = x.map(v => v * sf.lsb);
  const y = r.kind === 'fir' ? D.firFixedSim(r.h.map(v => v * cf.lsb), xs, cf, sf, 'nearest', { overflow: r.overflow }).y
    : D.sosFixedSim(r.sos.map(q => [q[0], q[1], q[2], 1, q[3], q[4]].map((v, i) => i === 3 ? 1 : v * cf.lsb)), xs, cf, sf, 'nearest', { overflow: r.overflow, headroomBits: r.headroom, errorFeedback: r.ef }).y;
  return Array.from(y, v => Math.round(v / sf.lsb));
}
const jsText = r => {
  const cf = D.qFormat(...r.coef), sf = D.qFormat(...r.sig);
  return r.kind === 'fir' ? RTL.genFirSv(r.h, cf, sf, { overflow: r.overflow, form: r.form, moduleName: r.name })
    : RTL.genSosSv(r.sos, cf, sf, { overflow: r.overflow, headroomBits: r.headroom, errorFeedback: r.ef, moduleName: r.name });
};

// 1. every exported design (both FIR forms, saturate and wrap, headroom, error feedback, an overflowing cascade),
//    on impulse, full-scale step, full-scale square and seeded random input (512 samples)
const designs = ref.rtl.designs, byName = Object.fromEntries(ref.rtlsim.map(s => [s.name, s]));
check('at least 8 designs exported', designs.length >= 8, `(${designs.length})`);
for (const r of designs) {
  const s = byName[r.name], out = S.run(r.text, s.x);
  check(`${r.name}: out_valid high every cycle`, out.valid.every(Boolean));
  same(`${r.name}: interpreter = Python evaluator`, out.y, s.evaluator);
  same(`${r.name}: interpreter = Python bit-true model`, out.y, s.model);
  same(`${r.name}: interpreter = JS bit-true model`, out.y, model(r, s.x));
  same(`${r.name}: JS-generated text runs the same`, S.run(jsText(r), s.x).y, out.y);
}
const kinds = new Set(designs.map(r => `${r.kind}/${r.form || ''}/${r.overflow}`));
check('coverage: direct and transposed FIR, saturate and wrap, headroom, error feedback, overflow',
  ['fir/direct/saturate', 'fir/transposed/wrap', 'sos//saturate', 'sos//wrap'].every(k => kinds.has(k)) && designs.some(r => r.headroom > 0) && designs.some(r => r.ef)
  && byName.sos_overflow_saturate.model.some(v => Math.abs(v) >= 32767));

// 2. mutation: flip the lowest bit of one non-zero coefficient literal in the text; the outputs must change
function mutate(text) {
  let done = false;
  return text.replace(/\((-?)(\d+)'sd(\d+)\) \*/g, (m, sg, w, v) => done || v === '0' ? m : (done = true, `(${sg}${w}'sd${BigInt(v) ^ 1n}) *`));
}
for (const nm of ['fir_direct_saturate', 'fir_transposed_wrap', 'sos_ef_h2']) {
  const r = designs.find(d => d.name === nm), s = byName[nm], mt = mutate(r.text);
  check(`mutation ${nm}: text changed by one literal`, mt !== r.text && mt.split('\n').filter((l, i) => l !== r.text.split('\n')[i]).length === 1);
  check(`mutation ${nm}: a one-bit coefficient change is detected`, firstDiff(S.run(mt, s.x).y, s.model) !== '');
}

// 3. outside the subset: a clear "unsupported construct" error, never a guess
const base = designs.find(d => d.name === 'fir_sh0').text;
for (const [what, txt] of [
  ['division', base.replace('assign yr = acc;', 'assign yr = acc / 2;')],
  ['concatenation', base.replace('assign yr = acc;', 'assign yr = {acc};')],
  ['system task', base.replace('endmodule', '  initial $display("x");\nendmodule')],
  ['plain always', base.replace('always_ff @(posedge clk)', 'always @(posedge clk)')],
  ['wire keyword', base.replace(/\n  logic signed \[/, '\n  wire signed [')],
  ['undeclared name', base.replace('assign yr = acc;', 'assign yr = acc2;')],
  ['two drivers', base.replace('assign yr = acc;', 'assign yr = acc;\n  assign yr = acc;')],
  ['bit select', base.replace('assign yr = acc;', 'assign yr = acc[3];')],
  ['equality', base.replace('assign yr = acc;', 'assign yr = (acc == 3) ? acc : acc;')],
  ['combinational loop', base.replace('assign yr = acc;', 'assign yr = acc + yr;')],
]) {
  let msg = ''; try { S.run(txt, [1, 2, 3]); } catch (e) { msg = e.message; }
  check(`rejects ${what}`, /^unsupported construct: /.test(msg), msg ? `-> ${msg.slice(0, 80)}` : '-> no error');
}

// 4. SystemVerilog sizing rules on hand-made modules (expected values worked out from IEEE 1800-2017 11.6-11.8)
const mod = (decls, body) => `module t (input logic clk, input logic rst, input logic in_valid, input logic signed [7:0] in_data, output logic out_valid, output logic signed [15:0] out_data);
${decls}
  always_ff @(posedge clk) begin out_valid <= in_valid; ${body} end
endmodule`;
const one = (decls, body, x = 0) => S.run(mod(decls, body), [x]).y[0];
check('unsigned operand makes the sum unsigned (zero-extended)', one(`logic [3:0] u; logic signed [3:0] s; logic [15:0] o;\n assign u = 4'b1111; assign s = -4'sd1; assign o = u + s;`, 'out_data <= o;') === 30);
check('all-signed sum sign-extends', one(`logic signed [3:0] a, b; logic signed [15:0] o;\n assign a = -4'sd1; assign b = -4'sd1; assign o = a + b;`, 'out_data <= o;') === -2);
check('>>> is arithmetic on signed', one('logic signed [15:0] o;\n assign o = in_data >>> 2;', 'out_data <= o;', -8) === -2);
check('>>> is logical on unsigned', one("logic [7:0] u; logic signed [15:0] o;\n assign u = 8'b11111000; assign o = u >>> 2;", 'out_data <= o;') === 62);
check('assignment truncates (wrap)', one("logic signed [3:0] n;\n assign n = 5'sd9;", 'out_data <= n;') === -7);
check('context width: 8-bit operands in a 16-bit sum do not overflow', one('logic signed [15:0] o;\n assign o = in_data + in_data;', 'out_data <= o;', 127) === 254);
check('compare result is 1-bit unsigned', one("logic signed [15:0] o;\n assign o = (in_data > 8'sd3) + 16'sd0;", 'out_data <= o;', 5) === 1);
check('register is X until assigned', S.run(mod('', 'if (rst) out_valid <= 1\'b0;'), [1]).y[0] === null);

// 5. BigInt: widths beyond 53 bits stay exact (40 fraction bits on the coefficients, 60-bit accumulator)
{
  const h = [549755813887, -274877906943, 137438953473], cf = D.qFormat(0, 40), sf = D.qFormat(0, 15);
  const txt = RTL.genFirSv(h, cf, sf, { overflow: 'wrap', moduleName: 'wide' }), x = [32767, -32768, 12345, -1, 0, 0];
  const H = h.map(BigInt), exp = x.map((_, n) => { let a = 0n; for (let k = 0; k < 3; k++) if (n - k >= 0) a += H[k] * BigInt(x[n - k]);
    let y = (a + (1n << 39n)) >> 40n; y = ((y + 32768n) % 65536n + 65536n) % 65536n - 32768n; return Number(y); });
  check('accumulator wider than 53 bits', RTL.accWidthFir(h, cf, sf) > 53, `(${RTL.accWidthFir(h, cf, sf)} bits)`);
  same('60-bit datapath is exact (BigInt reference)', S.run(txt, x).y, exp);
}

// 6. the app's path: JS generator + every UI stimulus shape, on one FIR and one IIR design
{
  const d = D.designIIR('cheby1', 'lowpass', 4, [0.1], 1, 1), qs = D.quantizeSos(d.sos, 16, 'nearest'), sf = D.qFormat(0, 15);
  const rows = qs.sq.map(s => [0, 1, 2, 4, 5].map(i => D.toInt(s[i], qs.fmt, 'nearest')));
  const r = { kind: 'sos', sos: rows, coef: [qs.fmt.intBits, qs.fmt.fracBits], sig: [0, 15], overflow: 'saturate', headroom: 1, ef: true, name: 'app_sos' };
  const n = 200, xs = { sine: Array.from({ length: n }, (_, i) => Math.round(29490 * Math.sin(2 * Math.PI * i / 25))), noise: Array.from({ length: n }, (_, i) => ((i * 7919) % 65536) - 32768) };
  for (const [k, x] of Object.entries(xs)) same(`app path ${k}: interpreter = JS model (IIR, headroom 1, error feedback)`, S.run(jsText(r), x).y, model(r, x));
}

console.log(`\n${count - fails}/${count} interpreter checks passed`);
process.exit(fails ? 1 : 0);
