// Cross-check the JS port against the Python reference (run export_reference.py first).
const D = require('../web/dsp.js'), ref = require('./reference.json'); let fails = 0;
const maxd = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const check = (name, v, tol) => { const ok = v <= tol; if (!ok) fails++; console.log((ok ? 'ok  ' : 'FAIL'), name.padEnd(34), v.toExponential(2), '<=', tol); };
for (const r of ref.remez) check(`remez N=${r.N}`, maxd(D.remez(r.N, r.bands, r.des, r.w, 1.0).h, r.h), 1e-9);
for (const r of ref.window) check(`window ${r.win} ${r.kind}`, maxd(D.firWindow(r.N, r.edges, r.kind, r.win, 1.0, r.beta || 8.6), r.h), 1e-12);
for (const r of ref.iir) {
  const d = D.designIIR(r.kind, r.btype, r.order, r.edges, 1.0, 1.0, 40.0);
  check(`iir ${r.kind} ${r.btype} b`, maxd(d.b, r.b), 1e-9); check(`iir ${r.kind} ${r.btype} a`, maxd(d.a, r.a), 1e-9);
  check(`iir ${r.kind} ${r.btype} sos`, maxd(d.sos.flat(), r.sos.flat()), 1e-9);
}
const q = ref.quant, x = Float64Array.from(q.x);
const fq = D.quantizeFir(q.fir_h, 10); check('fir quant fmt', Math.abs(fq.fmt.intBits - q.fmt10[0]) + Math.abs(fq.fmt.fracBits - q.fmt10[1]), 0); check('fir quant coeffs', maxd(fq.hq, q.hq10), 1e-15);
check('fir fixed sim', maxd(D.firFixedSim(q.fir_h, x, D.qFormat(0, 15), D.qFormat(0, 13)).y, q.fir_y), 1e-12);
check('sos fixed sim', maxd(D.sosFixedSim(q.sos, x, D.qFormat(2, 22), D.qFormat(0, 15)).y, q.sos_y), 1e-12);
const sq = D.quantizeSos(q.sos2, 12); check('sos scaled+quantized coeffs', maxd(sq.sq.flat(), q.sos_q12.flat()), 1e-12); check('sos output gain (rel)', Math.abs(sq.gain / q.gain12 - 1), 1e-9);
const sc = D.scaleSos(q.sos2); check('scale_sos sections', maxd(sc.sos.flat(), q.scaled.flat()), 1e-9);
const dq = D.quantizeDirect(...[(() => { const t = D.designIIR('butter', 'lowpass', 8, [0.03], 1.0, 1, 40); return [t.b, t.a]; })()].flat(), 14);
check('direct-form quantized b', maxd(dq.bq, q.dq_bq), 1e-12); check('direct-form quantized a', maxd(dq.aq, q.dq_aq), 1e-12); check('direct-form stability flag', dq.stable === q.dq_stable ? 0 : 1, 0);
check('fir noise theory (rel)', Math.abs(D.firNoiseTheory(q.fir_h, D.qFormat(0, 13)) / q.theory_fir - 1), 1e-12);
check('sos noise theory (rel)', Math.abs(D.sosNoiseTheory(q.sos, D.qFormat(0, 15)) / q.theory_sos - 1), 1e-3);
// root finder: P(z)=sum h_k z^(n-k) must vanish at every returned root (incl. a degenerate end-coefficient design)
for (const idx of [0, 1]) {
  const h = ref.remez[idx].h, zr = D.polyRoots(h), n = h.length - 1; let worst = 0;
  for (const z of zr) { let re = 0, im = 0; for (let k = 0; k <= n; k++) { const nr = re * z.re - im * z.im + h[k]; im = re * z.im + im * z.re; re = nr; } let sc = 0; for (let k = 0; k <= n; k++) sc += Math.abs(h[k]) * Math.pow(Math.max(Math.hypot(z.re, z.im), 1), n - k); worst = Math.max(worst, Math.hypot(re, im) / sc); }
  check(`polyRoots rel. residual (${h.length} taps, ${zr.length} roots)`, worst, 1e-9);
}
console.log(fails ? `\n${fails} FAILED` : '\nall cross-checks passed'); process.exit(fails ? 1 : 0);
