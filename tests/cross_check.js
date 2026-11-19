// Cross-check the JS port against the Python reference (run export_reference.py first).
// Every numeric check passes when |js - py| <= atol + rtol * |py| element-wise; exact checks use rtol = atol = 0.
const D = require('../web/dsp.js'), ref = require('./reference.json'); let fails = 0, count = 0;
const TOL = { rtol: 1e-9, atol: 1e-12 };

// worst-case ratio |js - py| / (atol + rtol |py|): passes when <= 1
const flat = v => ArrayBuffer.isView(v) ? Array.from(v) : Array.isArray(v) ? v.flatMap(flat) : [v];
function excess(js, py, { rtol, atol }) {
  js = flat(js); py = flat(py);
  if (js.length !== py.length) return Infinity;
  let worst = 0;
  for (let i = 0; i < py.length; i++) {
    const d = Math.abs(js[i] - py[i]), lim = atol + rtol * Math.abs(py[i]);
    const r = lim === 0 ? (d === 0 ? 0 : Infinity) : d / lim;
    if (!(r <= worst)) worst = r; // NaN-safe: NaN makes worst NaN, which fails below
  }
  return worst;
}
function close(name, js, py, tol = TOL) {
  const r = excess(js, py, tol), ok = r <= 1; count++; if (!ok) fails++;
  console.log(ok ? 'ok  ' : 'FAIL', name.padEnd(36), `err/limit ${Number.isFinite(r) ? r.toExponential(2) : r}`, `(rtol ${tol.rtol}, atol ${tol.atol})`);
}
const EXACT = { rtol: 0, atol: 0 };

// roots as multisets: round to 1e-9, sort by (re, im), then compare with the mixed tolerance
const sortRoots = rs => rs.map(([re, im]) => [re, im]).sort((a, b) => {
  const r = x => Math.round(x * 1e9) / 1e9;
  return r(a[0]) - r(b[0]) || r(a[1]) - r(b[1]);
});

for (const r of ref.remez) close(`remez N=${r.N}`, D.remez(r.N, r.bands, r.des, r.w, 1.0).h, r.h);
for (const r of ref.window) close(`window ${r.win} ${r.kind}`, D.firWindow(r.N, r.edges, r.kind, r.win, 1.0, r.beta || 8.6), r.h);
for (const r of ref.iir) {
  const d = D.designIIR(r.kind, r.btype, r.order, r.edges, 1.0, 1.0, 40.0), tag = `iir ${r.kind} ${r.btype}`;
  close(`${tag} b`, d.b, r.b); close(`${tag} a`, d.a, r.a); close(`${tag} sos`, d.sos, r.sos);
  // analytic zeros/poles from the prototype + band transform, never root-finding b or a (repeated roots are ill-conditioned)
  close(`${tag} zeros`, sortRoots(d.z.map(c => [c.re, c.im])), sortRoots(r.z));
  close(`${tag} poles`, sortRoots(d.p.map(c => [c.re, c.im])), sortRoots(r.p));
  close(`${tag} k`, d.k, r.k);
}
const q = ref.quant, x = Float64Array.from(q.x);
const fq = D.quantizeFir(q.fir_h, 10);
close('fir quant fmt', [fq.fmt.intBits, fq.fmt.fracBits], q.fmt10, EXACT); close('fir quant coeffs', fq.hq, q.hq10);
close('fir fixed sim', D.firFixedSim(q.fir_h, x, D.qFormat(0, 15), D.qFormat(0, 13)).y, q.fir_y);
close('sos fixed sim', D.sosFixedSim(q.sos, x, D.qFormat(2, 22), D.qFormat(0, 15)).y, q.sos_y);
const sq = D.quantizeSos(q.sos2, 12);
close('sos scaled+quantized coeffs', sq.sq, q.sos_q12); close('sos output gain', sq.gain, q.gain12);
close('sos shared format', [sq.fmt.intBits, sq.fmt.fracBits], q.sos_fmt12, EXACT);
const sc = D.scaleSos(q.sos2); close('scale_sos sections', sc.sos, q.scaled);
const t8 = D.designIIR('butter', 'lowpass', 8, [0.03], 1.0, 1, 40), dq = D.quantizeDirect(t8.b, t8.a, 14);
close('direct-form quantized b', dq.bq, q.dq_bq); close('direct-form quantized a', dq.aq, q.dq_aq);
close('direct-form stability flag', +dq.stable, +q.dq_stable, EXACT);
close('fir noise theory', D.firNoiseTheory(q.fir_h, D.qFormat(0, 13), false), q.theory_fir);
// Python integrates |H|^2 on a 2^15 grid with scipy; JS uses its own grid: agreement to 1e-3 relative is the honest bound
close('sos noise theory', D.sosNoiseTheory(q.sos, D.qFormat(0, 15), false), q.theory_sos, { rtol: 1e-3, atol: 0 });
// root finder: P(z)=sum h_k z^(n-k) must vanish at every returned root (incl. a degenerate end-coefficient design)
for (const idx of [0, 1]) {
  const h = ref.remez[idx].h, zr = D.polyRoots(h), n = h.length - 1; let worst = 0;
  for (const z of zr) { let re = 0, im = 0; for (let k = 0; k <= n; k++) { const nr = re * z.re - im * z.im + h[k]; im = re * z.im + im * z.re; re = nr; } let s = 0; for (let k = 0; k <= n; k++) s += Math.abs(h[k]) * Math.pow(Math.max(Math.hypot(z.re, z.im), 1), n - k); worst = Math.max(worst, Math.hypot(re, im) / s); }
  close(`polyRoots residual (${h.length} taps)`, worst, 0, { rtol: 0, atol: 1e-9 });
}
// ---- task B ----
for (const r of ref.remez_b) close(`remez ${r.kind} N=${r.N}`, D.remez(r.N, r.bands, r.des, r.w, 1.0, { kind: r.kind }).h, r.h);
for (const r of ref.min_order) close(`min_order ${r.kind} ${r.bt} ${r.gp}/${r.gs} dB`, D.minOrder(r.kind, r.bt, r.wp, r.ws, r.gp, r.gs, 1.0), r.n, EXACT);
const b = ref.quant_b, s2 = D.qFormat(0, 15), fe = D.qFormat(...b.fe), fw = D.qFormat(...b.fw);
close('sos sim, error feedback', D.sosFixedSim(b.sqe, b.xe, fe, s2, 'nearest', { errorFeedback: true }).y, b.y_ef);
close('sos sim, wrap', D.sosFixedSim(b.sosw, b.xw, fw, s2, 'nearest', { overflow: 'wrap' }).y, b.y_wrap);
close('sos sim, 2 headroom bits', D.sosFixedSim(b.sosw, b.xw, fw, s2, 'nearest', { headroomBits: 2 }).y, b.y_head);
close('sos sim, wrap + headroom + EF', D.sosFixedSim(b.sqe, b.xe, fe, s2, 'nearest', { overflow: 'wrap', headroomBits: 1, errorFeedback: true }).y, b.y_head_ef_wrap);
close('fir sim, wrap', D.firFixedSim(Array(8).fill(0.24), Array(40).fill(0.9), s2, s2, 'nearest', { overflow: 'wrap' }).y, b.fir_wrap);
close('toInt wrap', [1.5, -1.25, 0.99, 3.2].map(v => D.toInt(v, D.qFormat(0, 7), 'nearest', 'wrap')), b.toint_wrap, EXACT);
close('sos noise theory, input quantized', D.sosNoiseTheory(q.sos, s2), b.th_sos_inq, { rtol: 1e-3, atol: 0 });
close('sos noise theory, error feedback', D.sosNoiseTheory(b.sqe, s2, false, { errorFeedback: true }), b.th_sos_ef, { rtol: 1e-3, atol: 0 });
close('fir noise theory, input quantized', D.firNoiseTheory(q.fir_h, D.qFormat(0, 13)), b.th_fir_inq);
console.log(fails ? `\n${fails} of ${count} FAILED` : `\nall ${count} cross-checks passed`); process.exit(fails ? 1 : 0);
