/* filterlab DSP engine - port of the tested Python reference (dsp/*.py). No dependencies. */
(function (root) {
'use strict';
const PI = Math.PI;

/* ---------------- complex helpers ---------------- */
const cx = (re, im = 0) => ({ re, im });
const cadd = (a, b) => cx(a.re + b.re, a.im + b.im);
const csub = (a, b) => cx(a.re - b.re, a.im - b.im);
const cmul = (a, b) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const cdiv = (a, b) => { const d = b.re * b.re + b.im * b.im; return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d); };
const cscale = (a, s) => cx(a.re * s, a.im * s);
const cconj = a => cx(a.re, -a.im);
const cabs = a => Math.hypot(a.re, a.im);
const csqrt = a => { const r = cabs(a); const re = Math.sqrt((r + a.re) / 2); const im = Math.sqrt(Math.max((r - a.re) / 2, 0)); return cx(re, a.im < 0 ? -im : im); };
const cexp = a => { const e = Math.exp(a.re); return cx(e * Math.cos(a.im), e * Math.sin(a.im)); };
const csinh = a => cx(Math.sinh(a.re) * Math.cos(a.im), Math.cosh(a.re) * Math.sin(a.im));
const cprod = arr => arr.reduce((p, x) => cmul(p, x), cx(1, 0));

/* ---------------- FIR: windows ---------------- */
function bessI0(x) { let s = 1, t = 1; const q = x * x / 4; for (let k = 1; k < 60; k++) { t *= q / (k * k); s += t; if (t < 1e-18 * s) break; } return s; }

function windowFn(name, N, beta = 8.6) {
  const w = new Float64Array(N); const m = N - 1;
  if (N === 1) { w[0] = 1; return w; }
  for (let n = 0; n < N; n++) {
    switch (name) {
      case 'rect': w[n] = 1; break;
      case 'hann': w[n] = 0.5 - 0.5 * Math.cos(2 * PI * n / m); break;
      case 'hamming': w[n] = 0.54 - 0.46 * Math.cos(2 * PI * n / m); break;
      case 'blackman': w[n] = 0.42 - 0.5 * Math.cos(2 * PI * n / m) + 0.08 * Math.cos(4 * PI * n / m); break;
      case 'kaiser': { const r = 2 * n / m - 1; w[n] = bessI0(beta * Math.sqrt(Math.max(1 - r * r, 0))) / bessI0(beta); break; }
      default: throw new Error('unknown window ' + name);
    }
  }
  return w;
}

function kaiserParams(attenDb, transHz, fs) {
  const A = attenDb;
  const beta = A > 50 ? 0.1102 * (A - 8.7) : (A >= 21 ? 0.5842 * Math.pow(A - 21, 0.4) + 0.07886 * (A - 21) : 0);
  const dw = 2 * PI * transHz / fs;
  let N = Math.ceil((A - 7.95) / (2.285 * dw) + 1);
  return { numtaps: N | 1, beta };
}

const sinc = x => x === 0 ? 1 : Math.sin(PI * x) / (PI * x);

function firWindow(numtaps, edges, kind, win, fs, beta = 8.6) {
  if ((kind === 'highpass' || kind === 'bandstop') && numtaps % 2 === 0) numtaps += 1;
  const M = (numtaps - 1) / 2; const w = edges.map(e => 2 * PI * e / fs);
  const lp = (wc, k) => (wc / PI) * sinc(wc * k / PI);
  const win_ = windowFn(win, numtaps, beta); const h = new Float64Array(numtaps);
  for (let n = 0; n < numtaps; n++) {
    const k = n - M; const d = (numtaps % 2 && n === M) ? 1 : 0; let v;
    if (kind === 'lowpass') v = lp(w[0], k);
    else if (kind === 'highpass') v = d - lp(w[0], k);
    else if (kind === 'bandpass') v = lp(w[1], k) - lp(w[0], k);
    else v = d - (lp(w[1], k) - lp(w[0], k));
    h[n] = v * win_[n];
  }
  return h;
}

/* ---------------- FIR: Parks-McClellan ---------------- */
function bary(xg, xs, C, bs) {
  const A = new Float64Array(xg.length);
  for (let i = 0; i < xg.length; i++) {
    let num = 0, den = 0, hit = -1;
    for (let j = 0; j < xs.length; j++) {
      const d = xg[i] - xs[j];
      if (Math.abs(d) < 1e-13) { hit = j; break; }
      const t = bs[j] / d; num += t * C[j]; den += t;
    }
    A[i] = hit >= 0 ? C[hit] : num / den;
  }
  return A;
}
function bweights(x) {
  const b = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) { let p = 1; for (let j = 0; j < x.length; j++) if (j !== i) p *= (x[i] - x[j]); b[i] = 1 / p; }
  return b;
}

/** bands: flat edge list in Hz; desired/weight per band. Odd numtaps only. */
function remez(numtaps, bands, desired, weight, fs, opts = {}) {
  const gridDensity = opts.gridDensity || 20, maxiter = opts.maxiter || 80, tol = opts.tol || 1e-9, kind = opts.kind || 'bandpass';
  if (!['bandpass', 'hilbert', 'differentiator'].includes(kind)) throw new Error(`kind must be 'bandpass', 'hilbert' or 'differentiator', not '${kind}'`);
  const odd = numtaps % 2 === 1, anti = kind !== 'bandpass';
  const edges = bands.map(b => b / (fs / 2) * PI); const nb = edges.length / 2;
  weight = weight || new Array(nb).fill(1);
  for (let b = 0; b < nb; b++) if (!odd && !anti && Math.abs(edges[2 * b + 1] - PI) < 1e-12 && desired[b] !== 0)
    throw new Error('even numtaps gives a type II filter, which has a forced zero at fs/2; a band ending at fs/2 must have desired gain 0, or use an odd numtaps');
  const Lt = Math.floor(numtaps / 2) + (odd && !anti ? 1 : 0); // terms in P
  const Qf = odd && !anti ? (() => 1) : !anti ? (w => Math.cos(w / 2)) : odd ? (w => Math.sin(w)) : (w => Math.sin(w / 2));
  const M = Lt - 1, R = M + 2;
  const delf = PI / (gridDensity * Lt); // keep the grid off the forced zeros of Qf, as scipy does
  if (anti && edges[0] < delf) edges[0] = delf;
  if (anti === odd && edges[edges.length - 1] > PI - delf) edges[edges.length - 1] = PI - delf;
  const widths = []; let wsum = 0;
  for (let b = 0; b < nb; b++) { widths.push(edges[2 * b + 1] - edges[2 * b]); wsum += widths[b]; }
  const total = gridDensity * (M + 1);
  const wl = [], Dl = [], Wl = [], starts = []; let pos = 0;
  for (let b = 0; b < nb; b++) {
    const n = Math.max(Math.round(total * widths[b] / wsum), 8);
    for (let i = 0; i < n; i++) {
      const wv = edges[2 * b] + (edges[2 * b + 1] - edges[2 * b]) * i / (n - 1), f = wv / (2 * PI), q = Qf(wv);
      const dv = kind === 'differentiator' ? desired[b] * f : desired[b], wt = kind === 'differentiator' && desired[b] >= 1e-4 ? weight[b] / f : weight[b];
      wl.push(wv); Dl.push(dv / q); Wl.push(wt * q);
    }
    starts.push([pos, pos + n]); pos += n;
  }
  const L = wl.length, w = Float64Array.from(wl), D = Float64Array.from(Dl), W = Float64Array.from(Wl);
  const xg = w.map(Math.cos);
  let ext = []; for (let i = 0; i < R; i++) ext.push(Math.round(i * (L - 1) / (R - 1)));
  ext = Array.from(new Set(ext));
  while (ext.length < R) { const r = Math.floor(Math.random() * L); if (!ext.includes(r)) ext.push(r); ext.sort((a, b) => a - b); }
  let delta = 0, it = 0;
  const solve = ex => {
    const x = Float64Array.from(ex.map(i => xg[i])), b = bweights(x);
    let n1 = 0, d1 = 0; for (let i = 0; i < R; i++) { const s = i % 2 ? -1 : 1; n1 += b[i] * D[ex[i]]; d1 += b[i] * s / W[ex[i]]; }
    const dl = n1 / d1; const C = new Float64Array(R);
    for (let i = 0; i < R; i++) C[i] = D[ex[i]] - (i % 2 ? -1 : 1) * dl / W[ex[i]];
    const xs = x.slice(0, R - 1), Cs = C.slice(0, R - 1);
    return { dl, xs, Cs, bs: bweights(xs) };
  };
  for (it = 0; it < maxiter; it++) {
    const sol = solve(ext); delta = sol.dl;
    const A = bary(xg, sol.xs, sol.Cs, sol.bs); const E = new Float64Array(L); let Q = 0;
    for (let i = 0; i < L; i++) { E[i] = W[i] * (D[i] - A[i]); Q = Math.max(Q, Math.abs(E[i])); }
    const cand = [];
    for (const [s, t] of starts) {
      const last = t - s - 1;
      for (let i = 0; i <= last; i++) {
        const e = Math.abs(E[s + i]), sg = Math.sign(E[s + i]);
        const left = i === 0 || e >= Math.abs(E[s + i - 1]) || sg !== Math.sign(E[s + i - 1]);
        const right = i === last || e >= Math.abs(E[s + i + 1]) || sg !== Math.sign(E[s + i + 1]);
        if (left && right) cand.push(s + i);
      }
    }
    const keep = [];
    for (const i of cand) {
      if (keep.length && Math.sign(E[i]) === Math.sign(E[keep[keep.length - 1]])) { if (Math.abs(E[i]) > Math.abs(E[keep[keep.length - 1]])) keep[keep.length - 1] = i; }
      else keep.push(i);
    }
    while (keep.length > R) { if (Math.abs(E[keep[0]]) < Math.abs(E[keep[keep.length - 1]])) keep.shift(); else keep.pop(); }
    if (keep.length < R) break;
    const same = keep.every((v, i) => v === ext[i]);
    ext = keep;
    if (same || (Q - Math.abs(delta)) / Q < tol) break;
  }
  const sol = solve(ext); delta = sol.dl;
  const h = new Float64Array(numtaps);
  if (odd && !anti) { // type I: closed form
    const Ak = bary(Float64Array.from({ length: M + 1 }, (_, k) => Math.cos(2 * PI * k / numtaps)), sol.xs, sol.Cs, sol.bs);
    for (let n = 0; n < numtaps; n++) {
      let s = Ak[0]; for (let k = 1; k <= M; k++) s += 2 * Ak[k] * Math.cos(2 * PI * k / numtaps * (n - M));
      h[n] = s / numtaps;
    }
  } else { // inverse DFT of the amplitude at the N DFT frequencies (Qf carries the sign past pi)
    const wk = Float64Array.from({ length: numtaps }, (_, k) => 2 * PI * k / numtaps);
    const P = bary(wk.map(Math.cos), sol.xs, sol.Cs, sol.bs), al = (numtaps - 1) / 2;
    for (let n = 0; n < numtaps; n++) {
      let s = 0; for (let k = 0; k < numtaps; k++) { const a = Qf(wk[k]) * P[k], t = wk[k] * (n - al); s += anti ? -a * Math.sin(t) : a * Math.cos(t); }
      h[n] = s / numtaps;
    }
  }
  return { h, delta: Math.abs(delta), iterations: it + 1 };
}

/* ---------------- IIR ---------------- */
function buttap(N) { const p = []; for (let m = -N + 1; m < N; m += 2) p.push(cscale(cexp(cx(0, PI * m / (2 * N))), -1)); return { z: [], p, k: 1 }; }
function cheb1ap(N, rp) {
  const eps = Math.sqrt(Math.pow(10, rp / 10) - 1), mu = Math.asinh(1 / eps) / N; const p = [];
  for (let m = -N + 1; m < N; m += 2) p.push(cscale(csinh(cx(mu, PI * m / (2 * N))), -1));
  let k = cprod(p.map(x => cscale(x, -1))).re; if (N % 2 === 0) k /= Math.sqrt(1 + eps * eps);
  return { z: [], p, k };
}
function cheb2ap(N, rs) {
  const de = 1 / Math.sqrt(Math.pow(10, rs / 10) - 1), mu = Math.asinh(1 / de) / N; const z = [], p = [];
  for (let m = -N + 1; m < N; m += 2) {
    if (m !== 0) { const s = Math.sin(m * PI / (2 * N)); z.push(cscale(cconj(cdiv(cx(0, 1), cx(s, 0))), -1)); }
    const q = cscale(cexp(cx(0, PI * m / (2 * N))), -1);
    p.push(cdiv(cx(1, 0), cx(Math.sinh(mu) * q.re, Math.cosh(mu) * q.im)));
  }
  const k = cdiv(cprod(p.map(x => cscale(x, -1))), cprod(z.map(x => cscale(x, -1)))).re;
  return { z, p, k };
}
// elliptic: complete integrals and Jacobi functions by the AGM (python: dsp/iir.py)
function agm(a, b) { for (let i = 0; i < 64 && Math.abs(a - b) > 1e-16 * a; i++) { const t = (a + b) / 2; b = Math.sqrt(a * b); a = t; } return a; }
const ellipk = m => PI / (2 * agm(1, Math.sqrt(1 - m))), ellipkm1 = p => PI / (2 * agm(1, Math.sqrt(p)));
function ellipj(u, m) { // sn, cn, dn for real u, 0 <= m < 1
  if (m < 1e-12) return [Math.sin(u), Math.cos(u), 1];
  const a = [1], c = [Math.sqrt(m)]; let b = Math.sqrt(1 - m);
  while (Math.abs(c[c.length - 1]) > 1e-16 && a.length < 64) { const a_ = a[a.length - 1], b_ = b; a.push((a_ + b_) / 2); c.push((a_ - b_) / 2); b = Math.sqrt(a_ * b_); }
  const n = a.length - 1; let phi = Math.pow(2, n) * a[n] * u, prev = phi;
  for (let i = n; i > 0; i--) { prev = phi; phi = (phi + Math.asin(c[i] / a[i] * Math.sin(phi))) / 2; }
  return [Math.sin(phi), Math.cos(phi), Math.cos(phi) / Math.cos(prev - phi)];
}
function ellipdeg(n, m1) {
  const q = Math.pow(Math.exp(-PI * ellipkm1(m1) / ellipk(m1)), 1 / n); let num = 0, den = 1;
  for (let j = 0; j < 8; j++) { num += Math.pow(q, j * (j + 1)); den += 2 * Math.pow(q, (j + 1) * (j + 1)); }
  return 16 * q * Math.pow(num / den, 4);
}
function arcJacSc1(w, m) { // real v with sc(v, 1 - m) = w; descending Landen (the iterate stays on the imaginary axis)
  const comp = x => Math.sqrt((1 - x) * (1 + x)), ks = [Math.sqrt(m)];
  while (ks[ks.length - 1] !== 0 && ks.length < 20) { const kp = comp(ks[ks.length - 1]); ks.push((1 - kp) / (1 + kp)); }
  let K = PI / 2; for (let i = 1; i < ks.length; i++) K *= 1 + ks[i];
  let v = w; for (let i = 0; i + 1 < ks.length; i++) v = 2 * v / ((1 + ks[i + 1]) * (1 + Math.sqrt(1 + ks[i] * ks[i] * v * v)));
  return K * 2 / PI * Math.asinh(v);
}
function ellipap(N, rp, rs) {
  const eps2 = Math.pow(10, rp / 10) - 1;
  if (N === 1) { const p = -Math.sqrt(1 / eps2); return { z: [], p: [cx(p)], k: -p }; }
  const m1 = eps2 / (Math.pow(10, rs / 10) - 1), m = ellipdeg(N, m1), K = ellipk(m);
  const S = [], C = [], Dn = [];
  for (let j = 1 - N % 2; j < N; j += 2) { const [s, c, d] = ellipj(j * K / N, m); S.push(s); C.push(c); Dn.push(d); }
  const zs = S.filter(s => Math.abs(s) > 1e-14).map(s => cx(0, 1 / (Math.sqrt(m) * s)));
  const z = zs.concat(zs.map(cconj));
  const v0 = K * arcJacSc1(1 / Math.sqrt(eps2), m1) / (N * ellipk(m1));
  const [sv, cv, dv] = ellipj(v0, 1 - m);
  let p = S.map((s, i) => { const den = 1 - Math.pow(Dn[i] * sv, 2); return cx(-(C[i] * Dn[i] * sv * cv) / den, -(s * dv) / den); });
  if (N % 2) { const nrm = Math.sqrt(p.reduce((a, x) => a + x.re * x.re + x.im * x.im, 0)); p = p.concat(p.filter(x => Math.abs(x.im) > 1e-14 * nrm).map(cconj)); }
  else p = p.concat(p.map(cconj));
  let k = cdiv(cprod(p.map(x => cscale(x, -1))), cprod(z.map(x => cscale(x, -1)))).re;
  if (N % 2 === 0) k /= Math.sqrt(1 + eps2);
  return { z, p, k };
}
const deg = (z, p) => p.length - z.length;
function lp2lp({ z, p, k }, wo) { return { z: z.map(x => cscale(x, wo)), p: p.map(x => cscale(x, wo)), k: k * Math.pow(wo, deg(z, p)) }; }
function lp2hp({ z, p, k }, wo) {
  const d = deg(z, p), kn = k * cdiv(cprod(z.map(x => cscale(x, -1))), cprod(p.map(x => cscale(x, -1)))).re;
  return { z: z.map(x => cdiv(cx(wo), x)).concat(Array.from({ length: d }, () => cx(0))), p: p.map(x => cdiv(cx(wo), x)), k: kn };
}
function bandSplit(arr, wo) { const a = [], b = []; for (const x of arr) { const r = csqrt(csub(cmul(x, x), cx(wo * wo))); a.push(cadd(x, r)); b.push(csub(x, r)); } return a.concat(b); }
function lp2bp({ z, p, k }, wo, bw) {
  const d = deg(z, p), zl = z.map(x => cscale(x, bw / 2)), pl = p.map(x => cscale(x, bw / 2));
  return { z: bandSplit(zl, wo).concat(Array.from({ length: d }, () => cx(0))), p: bandSplit(pl, wo), k: k * Math.pow(bw, d) };
}
function lp2bs({ z, p, k }, wo, bw) {
  const d = deg(z, p), kn = k * cdiv(cprod(z.map(x => cscale(x, -1))), cprod(p.map(x => cscale(x, -1)))).re;
  const zh = z.map(x => cdiv(cx(bw / 2), x)), ph = p.map(x => cdiv(cx(bw / 2), x));
  let zz = bandSplit(zh, wo);
  for (let i = 0; i < d; i++) zz.push(cx(0, wo), cx(0, -wo));
  return { z: zz, p: bandSplit(ph, wo), k: kn };
}
function bilinear({ z, p, k }, fs) {
  const f2 = 2 * fs, d = deg(z, p), F = cx(f2);
  const zz = z.map(x => cdiv(cadd(F, x), csub(F, x))).concat(Array.from({ length: d }, () => cx(-1)));
  const pz = p.map(x => cdiv(cadd(F, x), csub(F, x)));
  const g = cdiv(cprod(z.map(x => csub(F, x))), cprod(p.map(x => csub(F, x)))).re;
  return { z: zz, p: pz, k: k * g };
}
const prewarp = (f, fs) => 2 * fs * Math.tan(PI * f / fs);

/** kind: butter|cheby1|cheby2|ellip; btype lp|hp|bp|bs; edges [f] or [f1,f2] Hz.
 *  protoScale: optional analog prototype cutoff scale (used to put Butterworth -Rp dB at the passband edge). */
function designIIR(kind, btype, order, edges, fs, rp = 1, rs = 40, protoScale = 1) {
  let proto = kind === 'butter' ? buttap(order) : kind === 'cheby1' ? cheb1ap(order, rp) : kind === 'ellip' ? ellipap(order, rp, rs) : cheb2ap(order, rs);
  if (protoScale !== 1) proto = lp2lp(proto, protoScale);
  const wa = edges.map(e => prewarp(e, fs)); let t;
  if (btype === 'lowpass') t = lp2lp(proto, wa[0]);
  else if (btype === 'highpass') t = lp2hp(proto, wa[0]);
  else if (btype === 'bandpass') t = lp2bp(proto, Math.sqrt(wa[0] * wa[1]), wa[1] - wa[0]);
  else t = lp2bs(proto, Math.sqrt(wa[0] * wa[1]), wa[1] - wa[0]);
  const d = bilinear(t, fs); const sos = zpk2sos(d.z, d.p, d.k); const tf = sos2tf(sos);
  return { z: d.z, p: d.p, k: d.k, sos, b: tf.b, a: tf.a };
}

function minOrder(kind, btype, passband, stopband, gp_db, gs_db, fs) {
  const wp = passband.map(f => prewarp(f, fs)), ws = stopband.map(f => prewarp(f, fs)); let nat;
  if (btype === 'lowpass') nat = ws[0] / wp[0];
  else if (btype === 'highpass') nat = wp[0] / ws[0];
  else if (btype === 'bandpass') nat = Math.min(...ws.map(s => Math.abs((s * s - wp[0] * wp[1]) / (s * (wp[1] - wp[0])))));
  else { nat = Math.min(...ws.map(s => Math.abs(s * (wp[1] - wp[0]) / (s * s - wp[0] * wp[1])))); if (nat < 1) nat = 1 / nat; }
  const gp = Math.pow(10, gp_db / 10) - 1, gs = Math.pow(10, gs_db / 10) - 1;
  const n = kind === 'butter' ? Math.log10(gs / gp) / (2 * Math.log10(nat))
    : kind === 'ellip' ? ellipk(1 / (nat * nat)) * ellipkm1(gp / gs) / (ellipkm1(1 / (nat * nat)) * ellipk(gp / gs))
    : Math.acosh(Math.sqrt(gs / gp)) / Math.acosh(nat);
  return Math.max(1, Math.ceil(n - 1e-12));
}

function pairRoots(r, tol = 1e-9) {
  const cplx = r.filter(x => x.im > tol), real = r.filter(x => Math.abs(x.im) <= tol).map(x => x.re).sort((a, b) => a - b);
  const groups = cplx.map(c => [c, cconj(c)]);
  while (real.length >= 2) groups.push([cx(real.shift()), cx(real.shift())]);
  if (real.length) groups.push([cx(real.pop())]);
  return groups;
}
function polyFromRoots(g) { // real polynomial 1 + c1 z^-1 + c2 z^-2 from a group of <=2 roots
  if (g.length === 2) return [1, -(g[0].re + g[1].re), g[0].re * g[1].re - g[0].im * g[1].im];
  if (g.length === 1) return [1, -g[0].re, 0];
  return [1, 0, 0];
}
function zpk2sos(z, p, k) {
  const pg = pairRoots(p).sort((x, y) => Math.max(...x.map(cabs)) - Math.max(...y.map(cabs)));
  const zg = pairRoots(z); const sos = [];
  for (const g of pg) {
    let zz = [];
    if (zg.length) {
      const c = g.length === 2 ? cscale(cadd(g[0], g[1]), 0.5) : g[0];
      let best = 0, bd = Infinity;
      zg.forEach((q, j) => { const d = Math.min(...q.map(x => cabs(csub(x, c)))); if (d < bd) { bd = d; best = j; } });
      zz = zg.splice(best, 1)[0];
    }
    sos.push(polyFromRoots(zz).concat(polyFromRoots(g)));
  }
  for (let i = 0; i < 3; i++) sos[0][i] *= k;
  return sos;
}
function conv(a, b) { const o = new Array(a.length + b.length - 1).fill(0); for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) o[i + j] += a[i] * b[j]; return o; }
function sos2tf(sos) { let b = [1], a = [1]; for (const s of sos) { b = conv(b, s.slice(0, 3)); a = conv(a, s.slice(3)); } return { b, a }; }

/* ---------------- roots of a polynomial in z^-1 (zeros in the z-plane) ---------------- */
function polyRoots(c) {
  // Zeros of P(z) = sum_k c_k z^(n-k). Leading ~0 coefficients are roots at infinity (dropped);
  // trailing ~0 coefficients are roots at the origin (kept).
  c = Array.from(c); const tol = 1e-12 * Math.max(...c.map(Math.abs), 1e-300);
  while (c.length > 1 && Math.abs(c[0]) <= tol) c.shift();
  let atOrigin = 0; while (c.length > 1 && Math.abs(c[c.length - 1]) <= tol) { c.pop(); atOrigin++; }
  const n = c.length - 1; const roots = [];
  if (n >= 1) {
    const a0 = c[0], P = z => { let r = cx(c[0] / a0); for (let i = 1; i <= n; i++) r = cadd(cmul(r, z), cx(c[i] / a0)); return r; };
    const dP = z => { let r = cx(n * 1), t = cx(1); // derivative via Horner on coefficients
      let acc = cx(0); for (let i = 0; i < n; i++) acc = cadd(cmul(acc, z), cx((n - i) * c[i] / a0)); return acc; };
    const rad = Math.max(0.5, Math.pow(Math.abs(c[n] / a0), 1 / n));
    const z = Array.from({ length: n }, (_, k) => cx(rad * Math.cos(2 * PI * k / n + 0.4), rad * Math.sin(2 * PI * k / n + 0.4)));
    for (let it = 0; it < 300; it++) {
      let maxStep = 0;
      for (let k = 0; k < n; k++) {
        const ratio = cdiv(P(z[k]), dP(z[k])); let s = cx(0);
        for (let j = 0; j < n; j++) if (j !== k) s = cadd(s, cdiv(cx(1), csub(z[k], z[j])));
        const step = cdiv(ratio, csub(cx(1), cmul(ratio, s)));
        if (isFinite(step.re) && isFinite(step.im)) { z[k] = csub(z[k], step); maxStep = Math.max(maxStep, cabs(step) / Math.max(cabs(z[k]), 1)); }
      }
      if (maxStep < 1e-14) break;
    }
    for (const r of z) roots.push(Math.abs(r.im) < 1e-9 ? cx(r.re, 0) : r);
  }
  for (let i = 0; i < atOrigin; i++) roots.push(cx(0, 0));
  return roots;
}

/* ---------------- analysis ---------------- */
function evalPoly(c, cw, sw) { // sum c_k e^{-jwk} by Horner; returns [re, im]
  let re = 0, im = 0;
  for (let k = c.length - 1; k >= 0; k--) { const nr = re * cw + im * sw + c[k]; const ni = im * cw - re * sw; re = nr; im = ni; }
  return [re, im];
}
function freqz(b, a, n, fs, gain = 1) {
  const f = new Float64Array(n), re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = PI * i / (n - 1), cw = Math.cos(w), sw = Math.sin(w);
    const N = evalPoly(b, cw, sw), D = a ? evalPoly(a, cw, sw) : [1, 0]; const d = D[0] * D[0] + D[1] * D[1];
    f[i] = w / PI * fs / 2; re[i] = gain * (N[0] * D[0] + N[1] * D[1]) / d; im[i] = gain * (N[1] * D[0] - N[0] * D[1]) / d;
  }
  return mkResp(f, re, im);
}
function sosFreqz(sos, n, fs, gain = 1) {
  const f = new Float64Array(n), re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = PI * i / (n - 1), cw = Math.cos(w), sw = Math.sin(w); let hr = 1, hi = 0;
    for (const s of sos) {
      const N = evalPoly(s.slice(0, 3), cw, sw), D = evalPoly(s.slice(3), cw, sw); const d = D[0] * D[0] + D[1] * D[1];
      const qr = (N[0] * D[0] + N[1] * D[1]) / d, qi = (N[1] * D[0] - N[0] * D[1]) / d;
      const tr = hr * qr - hi * qi; hi = hr * qi + hi * qr; hr = tr;
    }
    f[i] = w / PI * fs / 2; re[i] = gain * hr; im[i] = gain * hi;
  }
  return mkResp(f, re, im);
}
function mkResp(f, re, im) {
  const n = f.length, mag = new Float64Array(n), db = new Float64Array(n), ph = new Float64Array(n);
  for (let i = 0; i < n; i++) { mag[i] = Math.hypot(re[i], im[i]); db[i] = 20 * Math.log10(Math.max(mag[i], 1e-12)); ph[i] = Math.atan2(im[i], re[i]); }
  const un = new Float64Array(n); let off = 0; un[0] = ph[0];
  for (let i = 1; i < n; i++) { let d = ph[i] - ph[i - 1]; if (d > PI) off -= 2 * PI * Math.round(d / (2 * PI)); else if (d < -PI) off -= 2 * PI * Math.round(d / (2 * PI)); un[i] = ph[i] + off; }
  return { f, re, im, mag, db, phase: un };
}
function groupDelay(b, a, n, fs) {
  const f = new Float64Array(n), g = new Float64Array(n);
  const tau = (c, cw, sw) => { const kc = c.map((v, k) => v * k); const N = evalPoly(kc, cw, sw), D = evalPoly(c, cw, sw); const d = D[0] * D[0] + D[1] * D[1]; return d < 1e-20 ? NaN : (N[0] * D[0] + N[1] * D[1]) / d; };
  for (let i = 0; i < n; i++) { const w = PI * i / (n - 1), cw = Math.cos(w), sw = Math.sin(w); f[i] = w / PI * fs / 2; g[i] = tau(b, cw, sw) - (a ? tau(a, cw, sw) : 0); }
  return { f, gd: g };
}
function sosGroupDelay(sos, n, fs) {
  const f = new Float64Array(n), g = new Float64Array(n);
  const tau = (c, cw, sw) => { const kc = c.map((v, k) => v * k); const N = evalPoly(kc, cw, sw), D = evalPoly(c, cw, sw); const d = D[0] * D[0] + D[1] * D[1]; return d < 1e-20 ? NaN : (N[0] * D[0] + N[1] * D[1]) / d; };
  for (let i = 0; i < n; i++) { const w = PI * i / (n - 1), cw = Math.cos(w), sw = Math.sin(w); let s = 0; for (const q of sos) s += tau(q.slice(0, 3), cw, sw) - tau(q.slice(3), cw, sw); f[i] = w / PI * fs / 2; g[i] = s; }
  return { f, gd: g };
}

/** Evaluate a filter spec against a magnitude response (dB). bands: [{lo,hi,type:'pass'|'stop'}] in Hz */
function measure(resp, bands) {
  let rip = 0, att = Infinity, hasP = false, hasS = false, pmax = -Infinity;
  for (const bd of bands) {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < resp.f.length; i++) if (resp.f[i] >= bd.lo - 1e-9 && resp.f[i] <= bd.hi + 1e-9) { mn = Math.min(mn, resp.db[i]); mx = Math.max(mx, resp.db[i]); }
    if (!isFinite(mn)) continue;
    if (bd.type === 'pass') { hasP = true; rip = Math.max(rip, mx - mn); pmax = Math.max(pmax, mx); } else { hasS = true; att = Math.min(att, -mx); }
  }
  return { ripple: hasP ? rip : NaN, atten: hasS ? att : NaN, passMax: hasP ? pmax : NaN };
}

/* ---------------- fixed-point quantization ---------------- */
function qFormat(intBits, fracBits) { return { intBits, fracBits, word: 1 + intBits + fracBits, lsb: Math.pow(2, -fracBits) }; }
function autoFormat(maxAbs, word) { const m = maxAbs < 1 ? 0 : Math.floor(Math.log2(maxAbs)) + 1; return qFormat(m, word - 1 - m); }
function limit(v, lo, hi, overflow) { // clamp, or two's-complement wrap (python: _limit)
  if (overflow === 'wrap') { const R = hi - lo + 1; return (((v - lo) % R) + R) % R + lo; }
  return Math.min(hi, Math.max(lo, v));
}
function checkOverflow(o) { if (o !== 'saturate' && o !== 'wrap') throw new Error(`overflow must be 'saturate' or 'wrap', not '${o}'`); }
function toInt(x, fmt, rounding = 'nearest', overflow = 'saturate') {
  const s = x * Math.pow(2, fmt.fracBits), lo = -Math.pow(2, fmt.word - 1), hi = Math.pow(2, fmt.word - 1) - 1;
  const q = rounding === 'nearest' ? Math.floor(s + 0.5) : rounding === 'floor' ? Math.floor(s) : Math.trunc(s);
  return limit(q, lo, hi, overflow);
}
const quantize = (x, fmt, rounding) => toInt(x, fmt, rounding) * fmt.lsb;
const maxAbs = a => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

function quantizeFir(h, word, rounding) {
  const fmt = autoFormat(maxAbs(Array.from(h)), word); const hq = Array.from(h, v => quantize(v, fmt, rounding));
  let err = 0; h.forEach((v, i) => { err = Math.max(err, Math.abs(hq[i] - v)); });
  return { fmt, hq, maxErr: err };
}
/** Peak-scale a biquad cascade (python: scale_sos). H = gain * prod(H_scaled). */
function scaleSos(sos, n = 1024) {
  const k = sos[0][0]; let gain = k; const out = [];
  sos.forEach((s0, i) => {
    const s = s0.slice(); if (i === 0) { s[0] /= k; s[1] /= k; s[2] /= k; }
    let pk = 0;
    for (let q = 0; q < n; q++) { const w = PI * q / (n - 1), cw = Math.cos(w), sw = Math.sin(w); const N = evalPoly(s.slice(0, 3), cw, sw), Dd = evalPoly(s.slice(3), cw, sw); pk = Math.max(pk, Math.hypot(N[0], N[1]) / Math.hypot(Dd[0], Dd[1])); }
    gain *= pk; out.push([s[0] / pk, s[1] / pk, s[2] / pk, s[3], s[4], s[5]]);
  });
  return { sos: out, gain };
}
function quantizeSos(sos, word, rounding) {
  const sc = scaleSos(sos), idx = [0, 1, 2, 4, 5]; const fmt = autoFormat(Math.max(...sc.sos.flatMap(s => idx.map(i => Math.abs(s[i])))), word);
  const sq = sc.sos.map(s => { const r = s.slice(); idx.forEach(i => { r[i] = quantize(s[i], fmt, rounding); }); return r; });
  let err = 0; sc.sos.forEach((s, k) => idx.forEach(i => { err = Math.max(err, Math.abs(sq[k][i] - s[i])); }));
  return { fmt, sq, scaled: sc.sos, gain: sc.gain, maxErr: err };
}
function quantizeDirect(b, a, word, rounding) {
  const gain = maxAbs(b), bs = b.map(v => v / gain), fmt = autoFormat(Math.max(maxAbs(bs), maxAbs(a)), word);
  const bq = bs.map(v => quantize(v, fmt, rounding)), aq = a.map(v => quantize(v, fmt, rounding)); aq[0] = 1;
  const poles = polyRoots(aq); const rad = poles.length ? Math.max(...poles.map(cabs)) : 0;
  let err = 0; bs.forEach((v, i) => { err = Math.max(err, Math.abs(bq[i] - v)); }); a.forEach((v, i) => { err = Math.max(err, Math.abs(aq[i] - v)); });
  return { fmt, bq, aq, gain, poles, maxRadius: rad, stable: rad < 1, maxErr: err };
}

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function testSignal(n, sigma, seed = 7) {
  const r = mulberry32(seed), x = new Float64Array(n);
  for (let i = 0; i < n; i += 2) { const u = Math.max(r(), 1e-12), v = r(); const m = Math.sqrt(-2 * Math.log(u)) * sigma; x[i] = Math.max(-0.99, Math.min(0.99, m * Math.cos(2 * PI * v))); if (i + 1 < n) x[i + 1] = Math.max(-0.99, Math.min(0.99, m * Math.sin(2 * PI * v))); }
  return x;
}
function firFixedSim(h, x, coefFmt, sigFmt, rounding, { overflow = 'saturate' } = {}) {
  checkOverflow(overflow);
  const hi = Array.from(h, v => toInt(v, coefFmt, rounding)), xi = Array.from(x, v => toInt(v, sigFmt, 'nearest'));
  const sh = coefFmt.fracBits, lo = -Math.pow(2, sigFmt.word - 1), hiV = Math.pow(2, sigFmt.word - 1) - 1, den = Math.pow(2, sh);
  const n = x.length, y = new Float64Array(n), yq = new Float64Array(n), yi = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0, accF = 0, accI = 0;
    for (let k = 0; k < hi.length && k <= i; k++) { acc += hi[k] * xi[i - k]; accF += h[k] * x[i - k]; }
    const r = limit(Math.floor(acc / den + 0.5), lo, hiV, overflow);
    y[i] = r * sigFmt.lsb; yq[i] = acc / den * sigFmt.lsb; yi[i] = accF;
  }
  return { y, yq, yIdeal: yi };
}
/** opts: overflow 'saturate'|'wrap'; headroomBits: input scaled by 2^-h before quantization (all three outputs
 *  are in that scale; multiply by 2^h to undo); errorFeedback: c = round(a), acc' = acc - c1 r1 - c2 r2, r = acc' - y 2^sh. */
function sosFixedSim(sos, x, coefFmt, sigFmt, rounding, { overflow = 'saturate', headroomBits = 0, errorFeedback = false } = {}) {
  checkOverflow(overflow);
  const sh = coefFmt.fracBits, den = Math.pow(2, sh), lo = -Math.pow(2, sigFmt.word - 1), hiV = Math.pow(2, sigFmt.word - 1) - 1, hs = Math.pow(2, -headroomBits);
  let cur = Array.from(x, v => toInt(v * hs, sigFmt, 'nearest')); const xq = cur.map(v => v * sigFmt.lsb);
  let ref = Array.from(xq); // float cascade with quantized coefficients and quantized input
  let idealRef = Array.from(x, v => v * hs);
  for (const s of sos) {
    const [b0, b1, b2, a1, a2] = [0, 1, 2, 4, 5].map(i => toInt(s[i], coefFmt, rounding)); const cf = [0, 1, 2, 4, 5].map(i => quantize(s[i], coefFmt, rounding));
    const c1 = errorFeedback ? Math.floor(a1 / den + 0.5) : 0, c2 = errorFeedback ? Math.floor(a2 / den + 0.5) : 0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, r1 = 0, r2 = 0; const out = new Array(cur.length);
    for (let i = 0; i < cur.length; i++) {
      const v = cur[i], acc = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2 - c1 * r1 - c2 * r2;
      const yr = Math.floor(acc / den + 0.5), y = limit(yr, lo, hiV, overflow);
      if (errorFeedback) { r2 = r1; r1 = acc - yr * den; }
      x2 = x1; x1 = v; y2 = y1; y1 = y; out[i] = y;
    }
    cur = out;
    ref = lfilter(cf[0], cf[1], cf[2], cf[3], cf[4], ref);
    idealRef = lfilter(s[0], s[1], s[2], s[4], s[5], idealRef);
  }
  return { y: Float64Array.from(cur, v => v * sigFmt.lsb), yq: Float64Array.from(ref), yIdeal: Float64Array.from(idealRef) };
}
function lfilter(b0, b1, b2, a1, a2, x) { let x1 = 0, x2 = 0, y1 = 0, y2 = 0; return x.map(v => { const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; return y; }); }
const variance = (a, b, skip = 0) => { let s = 0, n = 0; for (let i = skip; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; n++; } return s / n; };
const power = (a, skip = 0) => { let s = 0, n = 0; for (let i = skip; i < a.length; i++) { s += a[i] * a[i]; n++; } return s / n; };

function firNoiseTheory(h, sigFmt, inputQuantized = true) { const d2 = sigFmt.lsb * sigFmt.lsb / 12; let e = 0; for (const v of h) e += v * v; return d2 * (1 + (inputQuantized ? e : 0)); }
function chainEnergy(num, den, n = 1 << 14) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const w = 2 * PI * i / n, cw = Math.cos(w), sw = Math.sin(w); let hr = 1, hi = 0;
    for (const c of num) { const v = evalPoly(c, cw, sw); const t = hr * v[0] - hi * v[1]; hi = hr * v[1] + hi * v[0]; hr = t; }
    for (const c of den) { const v = evalPoly(c, cw, sw); const d = v[0] * v[0] + v[1] * v[1]; const qr = v[0] / d, qi = -v[1] / d; const t = hr * qr - hi * qi; hi = hr * qi + hi * qr; hr = t; }
    s += hr * hr + hi * hi;
  }
  return s / n;
}
function sosNoiseTheory(sos, sigFmt, inputQuantized = true, { errorFeedback = false } = {}) {
  const d2 = sigFmt.lsb * sigFmt.lsb / 12;
  let total = inputQuantized ? d2 * chainEnergy(sos.map(s => s.slice(0, 3)), sos.map(s => s.slice(3))) : 0;
  for (let k = 0; k < sos.length; k++) {
    const rest = sos.slice(k + 1), own = errorFeedback ? [[1, Math.floor(sos[k][4] + 0.5), Math.floor(sos[k][5] + 0.5)]] : [];
    total += d2 * chainEnergy(own.concat(rest.map(s => s.slice(0, 3))), [sos[k].slice(3)].concat(rest.map(s => s.slice(3))));
  }
  return total;
}

/* ---------------- test signals, spectra, WAV (python: dsp/spectrum.py; parseWav is browser I/O, JS only) ---------------- */
function toneSignal(n, fs, tones = [], noiseRms = 0, seed = 7) {
  const x = new Float64Array(n);
  for (const [f, amp] of tones) for (let k = 0; k < n; k++) x[k] += amp * Math.sin(2 * PI * f * k / fs);
  if (noiseRms > 0) {
    const r = mulberry32(seed);
    for (let i = 0; i < n; i += 2) { const u = Math.max(r(), 1e-12), v = r(), m = Math.sqrt(-2 * Math.log(u)) * noiseRms; x[i] += m * Math.cos(2 * PI * v); if (i + 1 < n) x[i + 1] += m * Math.sin(2 * PI * v); }
  }
  return x;
}
function fftInPlace(re, im) { // iterative radix-2, length a power of two
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * PI / len, half = len >> 1;
    for (let k = 0; k < half; k++) {
      const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
      for (let i = k; i < n; i += len) { const j = i + half, tr = re[j] * wr - im[j] * wi, ti = re[j] * wi + im[j] * wr; re[j] = re[i] - tr; im[j] = im[i] - ti; re[i] += tr; im[i] += ti; }
    }
  }
}
/** Welch averaged periodogram, periodic Hann, 50 % overlap; a full-scale sine on a bin reads 0 dB. */
function powerSpectrumDb(x, fs, nfft = 4096) {
  if (nfft < 2 || (nfft & (nfft - 1))) throw new Error('nfft must be a power of two');
  let xs = x; if (xs.length < nfft) { xs = new Float64Array(nfft); xs.set(x); }
  const w = Float64Array.from({ length: nfft }, (_, i) => 0.5 - 0.5 * Math.cos(2 * PI * i / nfft)), hop = nfft / 2, nb = nfft / 2 + 1;
  let sw = 0; for (const v of w) sw += v;
  const P = new Float64Array(nb); let segs = 0;
  for (let s0 = 0; s0 + nfft <= xs.length; s0 += hop) {
    const re = new Float64Array(nfft), im = new Float64Array(nfft);
    for (let i = 0; i < nfft; i++) re[i] = xs[s0 + i] * w[i];
    fftInPlace(re, im); for (let k = 0; k < nb; k++) P[k] += re[k] * re[k] + im[k] * im[k]; segs++;
  }
  const f = Float64Array.from({ length: nb }, (_, k) => k * fs / nfft), db = P.map(v => 10 * Math.log10(4 * v / segs / (sw * sw) + 1e-30));
  return { f, db };
}
/** Read a WAV file: PCM 16/24-bit or float 32-bit, mono or stereo (mixed to mono), at most 10 s.
 *  Every header field is checked; anything else throws an Error whose message says what is wrong. */
function parseWav(buf, maxSeconds = 10) {
  const dv = new DataView(buf), len = buf.byteLength, tag = o => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (len < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('This is not a WAV file: it has no RIFF/WAVE header.');
  let fmt = null, data = null;
  for (let o = 12; o + 8 <= len;) {
    const id = tag(o), size = dv.getUint32(o + 4, true), body = o + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + size > len) throw new Error('The WAV format chunk is damaged or truncated.');
      let code = dv.getUint16(body, true);
      if (code === 0xFFFE && size >= 26) code = dv.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE: sub-format GUID starts with the code
      fmt = { code, channels: dv.getUint16(body + 2, true), fs: dv.getUint32(body + 4, true), align: dv.getUint16(body + 12, true), bits: dv.getUint16(body + 14, true) };
    } else if (id === 'data') {
      data = { start: body, bytes: Math.min(size, len - body) }; // streamed files may overstate the size: read what is there
      if (fmt) break;
    }
    o = body + size + (size & 1); // chunks are padded to an even length
  }
  if (!fmt) throw new Error('The WAV file has no format chunk.');
  if (!data) throw new Error('The WAV file has no audio data chunk.');
  const { code, channels, fs, align, bits } = fmt;
  const kind = code === 1 && bits === 16 ? 'PCM 16-bit' : code === 1 && bits === 24 ? 'PCM 24-bit' : code === 3 && bits === 32 ? 'float 32-bit' : null;
  if (!kind) throw new Error(`Unsupported WAV encoding (format ${code}, ${bits}-bit). Use 16- or 24-bit PCM or 32-bit float.`);
  if (channels !== 1 && channels !== 2) throw new Error(`Only mono or stereo files are supported; this one has ${channels} channels.`);
  if (fs < 1000 || fs > 384000) throw new Error(`The sample rate ${fs} Hz is out of range (1 kHz to 384 kHz).`);
  if (align !== channels * bits / 8) throw new Error('The WAV header is inconsistent (block size does not match channels and bit depth).');
  const frames = Math.floor(data.bytes / align), seconds = frames / fs;
  if (frames === 0) throw new Error('The WAV file contains no samples.');
  if (seconds > maxSeconds) throw new Error(`The file is ${seconds.toFixed(1)} s long; the limit is ${maxSeconds} s. Trim it and try again.`);
  const x = new Float64Array(frames), bps = bits / 8;
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) {
      const o = data.start + i * align + c * bps; let v;
      if (bits === 16) v = dv.getInt16(o, true) / 32768;
      else if (bits === 24) { const u = dv.getUint8(o) | dv.getUint8(o + 1) << 8 | dv.getUint8(o + 2) << 16; v = (u & 0x800000 ? u - 0x1000000 : u) / 8388608; }
      else v = dv.getFloat32(o, true);
      if (!Number.isFinite(v)) throw new Error('The WAV file contains invalid (NaN or infinite) samples.');
      acc += v;
    }
    x[i] = acc / channels;
  }
  return { fs, x, channels, seconds, format: kind };
}

root.DSP = { toneSignal, powerSpectrumDb, parseWav, windowFn, kaiserParams, firWindow, remez, designIIR, minOrder, zpk2sos, sos2tf, polyRoots, freqz, sosFreqz, groupDelay, sosGroupDelay, measure,
  qFormat, autoFormat, quantize, toInt, quantizeFir, scaleSos, quantizeSos, quantizeDirect, testSignal, firFixedSim, sosFixedSim, variance, power, firNoiseTheory, sosNoiseTheory, cabs, cx };
if (typeof module !== 'undefined') module.exports = root.DSP;
})(typeof window !== 'undefined' ? window : globalThis);
