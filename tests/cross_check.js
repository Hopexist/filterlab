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
// ---- task C: test signal, spectrum (vs Python) and the WAV parser (JS only: synthesized files) ----
const sp = ref.spectrum;
close('tone signal (seeded noise)', D.toneSignal(5000, 8000, [[440, 0.5], [1800, 0.25]], 0.01, 11), sp.x);
close('tone signal, odd length', D.toneSignal(301, 1000, [[50, 1.0]], 0.1, 3), sp.x_short);
const ps = D.powerSpectrumDb(Float64Array.from(sp.x), 8000, 1024); close('power spectrum f', ps.f, sp.f); close('power spectrum dB', ps.db, sp.db);
function wav({ code = 1, bits = 16, ch = 1, fs = 8000, frames = 100, extra = '', badAlign = false, write }) {
  const bps = bits / 8, align = ch * bps, dataBytes = frames * align, junk = extra.length, buf = new ArrayBuffer(12 + 8 + junk + (junk & 1) + 24 + 8 + dataBytes), dv = new DataView(buf);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, buf.byteLength - 8, true); str(8, 'WAVE'); let o = 12;
  if (junk) { str(o, 'LIST'); dv.setUint32(o + 4, junk, true); str(o + 8, extra); o += 8 + junk + (junk & 1); }
  str(o, 'fmt '); dv.setUint32(o + 4, 16, true); dv.setUint16(o + 8, code, true); dv.setUint16(o + 10, ch, true); dv.setUint32(o + 12, fs, true);
  dv.setUint32(o + 16, fs * align, true); dv.setUint16(o + 20, badAlign ? align + 1 : align, true); dv.setUint16(o + 22, bits, true); o += 24;
  str(o, 'data'); dv.setUint32(o + 4, dataBytes, true); o += 8;
  for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) write(dv, o + i * align + c * bps, i, c);
  return buf;
}
const sine = i => 0.5 * Math.sin(2 * PI * i / 20), PI = Math.PI;
const w16 = D.parseWav(wav({ ch: 2, frames: 200, extra: 'odd', write: (dv, o, i, c) => dv.setInt16(o, Math.round(sine(i) * (c ? 0 : 32767)), true) }));
close('wav PCM16 stereo -> mono (+ odd LIST chunk)', Array.from(w16.x.slice(0, 40)), Array.from({ length: 40 }, (_, i) => Math.round(sine(i) * 32767) / 32768 / 2), { rtol: 0, atol: 1e-12 });
const w24 = D.parseWav(wav({ bits: 24, frames: 50, write: (dv, o, i) => { const v = Math.round(sine(i) * 8388607) & 0xFFFFFF; dv.setUint8(o, v & 255); dv.setUint8(o + 1, v >> 8 & 255); dv.setUint8(o + 2, v >> 16 & 255); } }));
close('wav PCM24 (negative samples)', Array.from(w24.x), Array.from({ length: 50 }, (_, i) => Math.round(sine(i) * 8388607) / 8388608), { rtol: 0, atol: 1e-12 });
const w32 = D.parseWav(wav({ code: 3, bits: 32, fs: 48000, frames: 30, write: (dv, o, i) => dv.setFloat32(o, sine(i), true) }));
close('wav float32 + rate', [...Array.from(w32.x), w32.fs], [...Array.from({ length: 30 }, (_, i) => Math.fround(sine(i))), 48000], { rtol: 0, atol: 1e-12 });
const rejects = [
  ['not RIFF', new TextEncoder().encode('hello world, not a wav file').buffer, /not a WAV/],
  ['8-bit', wav({ bits: 8, write: () => {} }), /Unsupported/],
  ['A-law', wav({ code: 6, bits: 8, write: () => {} }), /Unsupported/],
  ['3 channels', wav({ ch: 3, write: () => {} }), /mono or stereo/],
  ['too long', wav({ fs: 1000, frames: 10001, write: () => {} }), /limit is 10 s/],
  ['bad block size', wav({ badAlign: true, write: () => {} }), /inconsistent/],
  ['rate 0', wav({ fs: 0, write: () => {} }), /out of range/],
  ['NaN sample', wav({ code: 3, bits: 32, frames: 3, write: (dv, o) => dv.setFloat32(o, NaN, true) }), /invalid/],
  ['header only', wav({ frames: 0, write: () => {} }), /no samples/],
  ['truncated fmt', wav({ write: () => {} }).slice(0, 30), /damaged|truncated|no format/],
];
for (const [name, buf, re] of rejects) { let msg = ''; try { D.parseWav(buf); } catch (e) { msg = e.message; } close(`wav rejects: ${name}`, re.test(msg) ? 0 : 1, 0, EXACT); if (!re.test(msg)) console.log('   got:', msg || '(no error)'); }
console.log(fails ? `\n${fails} of ${count} FAILED` : `\nall ${count} cross-checks passed`); process.exit(fails ? 1 : 0);
