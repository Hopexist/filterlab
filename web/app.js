/* filterlab UI. Depends on window.DSP (dsp.js). */
(() => {
'use strict';
const D = window.DSP;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ================= state ================= */
const METHODS = {
  remez: { name: 'Equiripple FIR', note: 'Parks–McClellan: smallest filter for a given spec', kind: 'fir' },
  window: { name: 'Windowed FIR', note: 'Ideal response times a window', kind: 'fir' },
  butter: { name: 'Butterworth', note: 'IIR, flat passband, gentle roll-off', kind: 'iir' },
  cheby1: { name: 'Chebyshev I', note: 'IIR, ripple in the passband', kind: 'iir' },
  cheby2: { name: 'Chebyshev II', note: 'IIR, ripple in the stopband', kind: 'iir' },
  ellip: { name: 'Elliptic', note: 'IIR, ripple in both bands, steepest roll-off', kind: 'iir' },
};
const BTYPES = { lowpass: 'Low-pass', highpass: 'High-pass', bandpass: 'Band-pass', bandstop: 'Band-stop' };
const LABELS = {
  lowpass: ['Passband ends', 'Stopband starts'], highpass: ['Stopband ends', 'Passband starts'],
  bandpass: ['Lower stopband ends', 'Passband starts', 'Passband ends', 'Upper stopband starts'],
  bandstop: ['Lower passband ends', 'Stopband starts', 'Stopband ends', 'Upper passband starts'],
};
const ROLES = { lowpass: 'PS', highpass: 'SP', bandpass: 'SPPS', bandstop: 'PSSP' };
const WINDOWS = { kaiser: 'Kaiser (set by attenuation)', blackman: 'Blackman', hamming: 'Hamming', hann: 'Hann', rect: 'Rectangular' };
const WIN_FACTOR = { rect: 0.9, hann: 3.1, hamming: 3.3, blackman: 5.5 };
const WIN_CAP = { rect: 21, hann: 44, hamming: 53, blackman: 74 };
const defaultEdges = (bt, fs) => ({ lowpass: [0.125, 0.1875], highpass: [0.125, 0.1875], bandpass: [0.0625, 0.125, 0.25, 0.3125], bandstop: [0.0625, 0.125, 0.25, 0.3125] }[bt].map(r => Math.round(r * fs)));

const state = {
  method: 'remez', btype: 'lowpass', fs: 8000, edges: defaultEdges('lowpass', 8000), rp: 1, rs: 60, win: 'kaiser',
  orderMode: 'auto', order: 41, tab: 'response', zoom: 'full', phase: 'phase',
  q: { coef: 12, sig: 16, round: 'nearest', struct: 'sos', overflow: 'saturate', headroom: 0, ef: false },
};
let pinB = null;
const sig = { source: 'tones', wav: null, name: '', error: '', vol: 0 };   // Signal tab: source, loaded WAV, volume (starts muted)
let audio = { ctx: null, src: null }, sigMemo = { key: '', out: null };   // compare mode: a snapshot of the magnitude response of a pinned design
let drawn = false, current = null, focusKey = null, renderQueued = false, fastMode = false;

/* ================= spec helpers ================= */
function bandsOf(bt, e, nyq) {
  const B = (lo, hi, type) => ({ lo, hi, type });
  if (bt === 'lowpass') return [B(0, e[0], 'pass'), B(e[1], nyq, 'stop')];
  if (bt === 'highpass') return [B(0, e[0], 'stop'), B(e[1], nyq, 'pass')];
  if (bt === 'bandpass') return [B(0, e[0], 'stop'), B(e[1], e[2], 'pass'), B(e[3], nyq, 'stop')];
  return [B(0, e[0], 'pass'), B(e[1], e[2], 'stop'), B(e[3], nyq, 'pass')];
}
function splitEdges(bt, e) {
  if (bt === 'lowpass') return { pass: [e[0]], stop: [e[1]] };
  if (bt === 'highpass') return { stop: [e[0]], pass: [e[1]] };
  if (bt === 'bandpass') return { stop: [e[0], e[3]], pass: [e[1], e[2]] };
  return { pass: [e[0], e[3]], stop: [e[1], e[2]] };
}
const transWidth = (bt, e) => bt === 'lowpass' || bt === 'highpass' ? e[1] - e[0] : Math.min(e[1] - e[0], e[3] - e[2]);

/* ================= design ================= */
const memo = new Map();
function designFilter(st, fast) {
  const key = JSON.stringify([st.method, st.btype, st.fs, st.edges, st.rp, st.rs, st.win, st.orderMode, st.orderMode === 'manual' ? st.order : 0, fast]);
  if (memo.has(key)) return memo.get(key);
  const out = buildDesign(st, fast);
  memo.set(key, out); if (memo.size > 40) memo.delete(memo.keys().next().value);
  return out;
}
function buildDesign(st, fast) {
  const nyq = st.fs / 2, e = st.edges, bands = bandsOf(st.btype, e, nyq), M = METHODS[st.method], notes = [];
  const dp = (Math.pow(10, st.rp / 20) - 1) / (Math.pow(10, st.rp / 20) + 1), ds = Math.pow(10, -st.rs / 20);
  const sp = splitEdges(st.btype, e), df = transWidth(st.btype, e) / st.fs;
  const out = { method: st.method, kind: M.kind, bands, notes, nyq };
  if (st.method === 'remez') {
    const flat = [0, ...e, nyq];
    let desired, wts;
    if (st.btype === 'lowpass') { desired = [1, 0]; wts = [1 / dp, 1 / ds]; }
    else if (st.btype === 'highpass') { desired = [0, 1]; wts = [1 / ds, 1 / dp]; }
    else if (st.btype === 'bandpass') { desired = [0, 1, 0]; wts = [1 / ds, 1 / dp, 1 / ds]; }
    else { desired = [1, 0, 1]; wts = [1 / dp, 1 / ds, 1 / dp]; }
    const run = n => { const r = D.remez(n, flat, desired, wts, st.fs); const resp = D.freqz(r.h, null, 2048, st.fs); return { r, resp, m: D.measure(resp, bands) }; };
    const ok = m => m.ripple <= st.rp * 1.0005 + 1e-6 && m.atten >= st.rs - 0.01;
    let est = Math.ceil((-10 * Math.log10(dp * ds) - 13) / (14.6 * df)) + 1; est = clamp(est | 1, 7, 801);
    let n, res;
    const evenOk = st.btype === 'lowpass' || st.btype === 'bandpass';   // type II has a forced zero at fs/2
    if (st.orderMode === 'manual') {
      n = clamp(Math.round(st.order), 4, 801);
      if (n % 2 === 0 && !evenOk) { n += 1; notes.push(`An even-length linear-phase FIR always has zero gain at fs/2, so a ${BTYPES[st.btype].toLowerCase()} needs an odd length. Using ${n} taps.`); }
      res = run(n);
    }
    else if (fast) { n = est; res = run(n); }
    else {
      n = est; res = run(n);
      if (ok(res.m)) { for (let i = 0; i < 12 && n > 7; i++) { const t = run(n - 2); if (ok(t.m)) { n -= 2; res = t; } else break; } }
      else { for (let i = 0; i < 70 && n < 801; i++) { n += 2; res = run(n); if (ok(res.m)) break; } if (!ok(res.m)) notes.push('No filter up to 801 taps meets this spec. Widen the transition band or relax the targets.'); }
      if (evenOk && ok(res.m)) { const t = run(n - 1); if (ok(t.m)) { n -= 1; res = t; } }   // one tap fewer as type II, if it still meets spec
    }
    Object.assign(out, { h: Array.from(res.r.h), taps: n, resp: res.resp, title: `Equiripple FIR, ${n} taps`, size: `${n} taps` });
  } else if (st.method === 'window') {
    const cuts = st.btype === 'lowpass' || st.btype === 'highpass' ? [(e[0] + e[1]) / 2] : [(e[0] + e[1]) / 2, (e[2] + e[3]) / 2];
    let n, beta = 8.6; const tw = transWidth(st.btype, e);
    if (st.win === 'kaiser') { const kp = D.kaiserParams(st.rs, tw, st.fs); n = kp.numtaps; beta = kp.beta; } else n = Math.ceil(WIN_FACTOR[st.win] * st.fs / tw) | 1;
    n = clamp(st.orderMode === 'manual' ? st.order : n, 5, 1201);
    const build = nn => { const hh = D.firWindow(nn, cuts, st.btype, st.win, st.fs, beta); const rr = D.freqz(hh, null, 2048, st.fs); return { hh, rr, mm: D.measure(rr, bands) }; };
    const meets = mm => mm.ripple <= st.rp * 1.0005 + 1e-6 && mm.atten >= st.rs - 0.01;
    let t = build(n);
    // Kaiser's formula is an estimate: in auto mode, add taps until the measured response meets the spec
    const reachable = st.win === 'kaiser' || st.rs <= WIN_CAP[st.win];
    if (st.orderMode === 'auto' && !fast && reachable) for (let i = 0; i < 40 && !meets(t.mm); i++) { n += 2; t = build(n); }
    const h = t.hh, nn = h.length, resp = t.rr;
    Object.assign(out, { h: Array.from(h), taps: nn, resp, beta, title: `${WINDOWS[st.win].split(' (')[0]} window FIR, ${nn} taps`, size: `${nn} taps` });
    if (st.win !== 'kaiser' && st.rs > WIN_CAP[st.win]) notes.push(`A ${WINDOWS[st.win]} window can't give more than about ${WIN_CAP[st.win]} dB of stopband attenuation, however many taps you use. Choose Kaiser or Blackman for ${st.rs} dB.`);
  } else {
    const pe = sp.pass, se = sp.stop; let n;
    if (st.orderMode === 'manual') n = clamp(st.order, 1, 24);
    else { n = D.minOrder(st.method, st.btype, pe, se, st.rp, st.rs, st.fs); if (n > 24) { notes.push(`Minimum order is ${n}; capped at 24. Widen the transition band for a practical IIR.`); n = 24; } }
    const edges = st.method === 'cheby2' ? se : pe;
    const scale = st.method === 'butter' ? Math.pow(Math.pow(10, st.rp / 10) - 1, -1 / (2 * n)) : 1;
    const d = D.designIIR(st.method, st.btype, n, edges, st.fs, st.rp, st.rs, scale);
    const resp = D.sosFreqz(d.sos, 2048, st.fs);
    Object.assign(out, { sos: d.sos, b: d.b, a: d.a, zeros: d.z, poles: d.p, order: n, resp, title: `${M.name}, order ${d.a.length - 1}`, size: `order ${d.a.length - 1}, ${d.sos.length} biquad${d.sos.length > 1 ? 's' : ''}` });
  }
  if (out.kind === 'fir') {
    out.zeros = D.polyRoots(out.h); out.poleOrigin = out.h.length - 1; out.poles = [];
    out.gd = D.groupDelay(out.h, null, 1024, st.fs);
  } else {
    out.poleOrigin = 0; out.gd = D.sosGroupDelay(out.sos, 1024, st.fs);
  }
  out.m = D.measure(out.resp, bands);
  out.passRipple = out.m.ripple <= st.rp * 1.0005 + 1e-6; out.stopOk = out.m.atten >= st.rs - 0.01;
  return out;
}

/* ================= charts ================= */
function niceTicks(lo, hi, target) {
  const raw = (hi - lo) / target, mag = Math.pow(10, Math.floor(Math.log10(raw))), nn = raw / mag;
  const step = (nn < 1.5 ? 1 : nn < 3 ? 2 : nn < 7 ? 5 : 10) * mag, t = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) t.push(+v.toFixed(10));
  return t;
}
const fmtHz = f => Math.abs(f) >= 1000 ? (f / 1000).toFixed(Math.abs(f) % 1000 === 0 ? 0 : 2).replace(/0$/, '') + 'k' : String(Math.round(f * 10) / 10);
const fmtN = (v, d = 2) => Number.isFinite(v) ? (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toString() : '—';
let uid = 0;
const SERIES_COLORS = ['var(--s1)', 'var(--s2)', 'var(--ink-3)'];

function lineChart(el, cfg) {
  const W = Math.max(el.clientWidth || 520, 240), H = cfg.height || 260;
  const m = { l: cfg.ml || 62, r: 14, t: 22, b: cfg.xLabel ? 40 : 24 };
  const [x0, x1] = cfg.xd, [y0, y1] = cfg.yd, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const sx = x => m.l + (x - x0) / (x1 - x0) * iw, sy = y => m.t + (1 - (y - y0) / (y1 - y0)) * ih, id = 'c' + (++uid);
  const xt = cfg.xticks || niceTicks(x0, x1, Math.max(3, Math.floor(iw / 80))), yt = niceTicks(y0, y1, Math.max(3, Math.floor(ih / 44)));
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(cfg.label)}"><defs><clipPath id="${id}"><rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}"/></clipPath></defs>`;
  s += '<g class="grid">' + yt.map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(v)}" y2="${sy(v)}"/>`).join('') + xt.map(v => `<line y1="${m.t}" y2="${H - m.b}" x1="${sx(v)}" x2="${sx(v)}"/>`).join('') + '</g>';
  s += `<g clip-path="url(#${id})">`;
  for (const sh of cfg.shades || []) { const ya = sy(clamp(sh.y0, y0, y1)), yb = sy(clamp(sh.y1, y0, y1)); s += `<rect class="shade" x="${sx(sh.x0)}" y="${Math.min(ya, yb)}" width="${Math.max(sx(sh.x1) - sx(sh.x0), 0)}" height="${Math.abs(yb - ya)}"/><line class="shade-edge" x1="${sx(sh.x0)}" x2="${sx(sh.x1)}" y1="${sy(sh.edge)}" y2="${sy(sh.edge)}"/>`; }
  for (const hl of cfg.hlines || []) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(hl.y)}" y2="${sy(hl.y)}" stroke="var(--ink-3)" stroke-dasharray="2 4"/>`;
  cfg.series.forEach((se, k) => {
    const col = se.color || SERIES_COLORS[k];
    if (se.type === 'stem') {
      s += se.x.map((xv, i) => `<line x1="${sx(xv)}" x2="${sx(xv)}" y1="${sy(0)}" y2="${sy(se.y[i])}" stroke="${col}" stroke-width="1.5"/>`).join('');
      if (se.x.length <= 140) s += se.x.map((xv, i) => `<circle cx="${sx(xv)}" cy="${sy(se.y[i])}" r="3" fill="${col}" stroke="var(--panel)" stroke-width="1.5"/>`).join('');
    } else {
      let d = '', pen = false;
      for (let i = 0; i < se.x.length; i++) { const yv = se.y[i]; if (!Number.isFinite(yv)) { pen = false; continue; } d += (pen ? 'L' : 'M') + sx(se.x[i]).toFixed(1) + ' ' + sy(yv).toFixed(1); pen = true; }
      s += `<path class="trace${se.draw && !drawn ? ' draw' : ''}" d="${d}" stroke="${col}" ${se.dash ? 'stroke-dasharray="6 4"' : ''}/>`;
    }
  });
  s += '</g>';
  s += `<rect class="frame" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}"/>`;
  s += yt.map(v => `<text x="${m.l - 8}" y="${sy(v) + 4}" text-anchor="end">${(cfg.fy || fmtN)(v)}</text>`).join('') + xt.map(v => `<text x="${sx(v)}" y="${H - m.b + 15}" text-anchor="middle">${(cfg.fx || fmtHz)(v)}</text>`).join('');
  if (cfg.xLabel) s += `<text class="axis-title" x="${m.l + iw / 2}" y="${H - 4}" text-anchor="middle">${esc(cfg.xLabel)}</text>`;
  if (cfg.yLabel) s += `<text class="axis-title" transform="translate(12 ${m.t + ih / 2}) rotate(-90)" text-anchor="middle">${esc(cfg.yLabel)}</text>`;
  for (const hd of cfg.handles || []) {
    const x = sx(hd.x), w = 22;
    s += `<g class="handle${focusKey === hd.key ? ' active' : ''}" data-key="${hd.key}" tabindex="0" role="slider" aria-label="${esc(hd.title)}" aria-valuenow="${Math.round(hd.x)}" aria-valuemin="0" aria-valuemax="${Math.round(x1)}"><line class="edge" x1="${x}" x2="${x}" y1="${m.t}" y2="${H - m.b}"/><rect x="${x - 22}" y="${m.t - 20}" width="44" height="${ih + 20}" fill="transparent"/><rect class="tab" x="${x - w / 2}" y="${m.t - 18}" width="${w}" height="16" rx="4"/><text class="tabtxt" x="${x}" y="${m.t - 6}" text-anchor="middle">${hd.label}</text><title>${esc(hd.title)}</title></g>`;
  }
  s += `<g class="hover" visibility="hidden"><line class="xh" y1="${m.t}" y2="${H - m.b}" stroke="var(--ink-3)"/>${cfg.series.map((se, k) => `<circle r="4" fill="${se.color || SERIES_COLORS[k]}" stroke="var(--panel)" stroke-width="2"/>`).join('')}</g>`;
  s += `<rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" style="pointer-events:${cfg.handles ? 'none' : 'all'}"/></svg><div class="tip" hidden></div>`;
  el.innerHTML = s;
  const svg = el.firstElementChild, tip = el.lastElementChild, hover = $('.hover', el), hit = $('.hit', el);
  const move = ev => {
    const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * (W / r.width), xv = x0 + (px - m.l) / iw * (x1 - x0);
    if (xv < x0 || xv > x1) return leave();
    const s0 = cfg.series[0]; let lo = 0, hi = s0.x.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s0.x[mid] < xv) lo = mid; else hi = mid; }
    const i = Math.abs(s0.x[lo] - xv) <= Math.abs(s0.x[hi] - xv) ? lo : hi;
    hover.setAttribute('visibility', 'visible'); const xs = sx(s0.x[i]);
    $('.xh', el).setAttribute('x1', xs); $('.xh', el).setAttribute('x2', xs);
    $$('circle', hover).forEach((c, k) => { const yv = cfg.series[k].y[i]; c.setAttribute('cx', sx(cfg.series[k].x[i] ?? s0.x[i])); c.setAttribute('cy', Number.isFinite(yv) ? sy(clamp(yv, y0, y1)) : -99); });
    tip.innerHTML = cfg.tip(i); tip.hidden = false;
    const tw = tip.offsetWidth; tip.style.left = clamp(xs * (r.width / W) + 12, 0, r.width - tw) + 'px'; tip.style.top = (m.t + 4) + 'px';
  };
  const leave = () => { hover.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  const area = cfg.handles ? svg : hit; area.addEventListener('pointermove', ev => { if (!ev.target.closest('.handle')) move(ev); else leave(); }); area.addEventListener('pointerleave', leave);
  if (cfg.handles) {
    const toX = ev => { const live = document.getElementById(el.id) || el, r = $('svg', live).getBoundingClientRect(); return x0 + ((ev.clientX - r.left) * (W / r.width) - m.l) / iw * (x1 - x0); };
    $$('.handle', el).forEach(g => {
      const key = +g.dataset.key;
      g.addEventListener('pointerdown', ev => {
        ev.preventDefault(); focusKey = key; g.classList.add('active');
        const mv = e2 => cfg.onDrag(key, toX(e2), false), up = e2 => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); cfg.onDrag(key, toX(e2), true); };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      });
      g.addEventListener('keydown', ev => {
        const k = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[ev.key]; if (!k) return;
        ev.preventDefault(); focusKey = key; const hd = cfg.handles.find(h => h.key === key); cfg.onDrag(key, hd.x + k * (ev.shiftKey ? 10 : 1) * (x1 - x0) / 400, true);
      });
    });
    if (focusKey !== null) { const g = $(`.handle[data-key="${focusKey}"]`, el); if (g && document.activeElement !== g && el.dataset.keepfocus) g.focus({ preventScroll: true }); }
  }
  const dp = $('.trace.draw', el); if (dp) dp.style.setProperty('--len', Math.ceil(dp.getTotalLength()));
}

function pzChart(el, cfg) {
  const Wd = Math.min(Math.max(el.clientWidth || 300, 220), 420), H = Wd;
  let R = 1.4; for (const z of [...cfg.zeros, ...cfg.poles, ...(cfg.qZeros || []), ...(cfg.qPoles || [])]) R = Math.max(R, Math.min(D.cabs(z) * 1.1, 6));
  R = R > 1.5 ? Math.ceil(R * 2) / 2 : 1.4; const c = Wd / 2, k = (Wd / 2 - 24) / R, X = x => c + x * k, Y = y => c - y * k;
  let s = `<svg viewBox="0 0 ${Wd} ${H}" width="${Wd}" height="${H}" role="img" aria-label="Pole-zero plot"><g class="grid">`;
  [0.5, 1.5].filter(r => r < R).forEach(r => { s += `<circle cx="${c}" cy="${c}" r="${r * k}" fill="none" stroke="var(--grid)"/>`; });
  s += `<line x1="${24}" x2="${Wd - 24}" y1="${c}" y2="${c}"/><line y1="${24}" y2="${H - 24}" x1="${c}" x2="${c}"/></g><circle cx="${c}" cy="${c}" r="${k}" fill="none" stroke="var(--ink-3)" stroke-width="1.5"/>`;
  s += `<text x="${X(1) + 4}" y="${c + 14}">1</text><text x="${X(-1) - 4}" y="${c + 14}" text-anchor="end">−1</text><text x="${c + 5}" y="${Y(1) - 4}">j</text><text x="${Wd - 8}" y="${c - 6}" text-anchor="end">Re</text><text x="${c + 6}" y="30">Im</text>`;
  const groups = (arr, extraOrigin) => {
    const g = new Map(); arr.forEach(z => { const kk = Math.round(z.re * 1e4) + ',' + Math.round(z.im * 1e4); const e = g.get(kk) || { z, n: 0 }; e.n++; g.set(kk, e); });
    if (extraOrigin) { const e = g.get('0,0') || { z: { re: 0, im: 0 }, n: 0 }; e.n += extraOrigin; g.set('0,0', e); }
    return [...g.values()];
  };
  const marks = [];
  const draw = (items, type, col, ghost) => items.forEach(({ z, n }) => {
    const x = X(z.re), y = Y(z.im); marks.push({ x, y, z, n, type, ghost });
    const out = ghost && D.cabs(z) >= 1 && type === 'pole';
    if (out) s += `<circle cx="${x}" cy="${y}" r="10" fill="none" stroke="var(--bad)" stroke-width="2"/>`;
    if (type === 'zero') s += `<circle cx="${x}" cy="${y}" r="${ghost ? 4 : 5}" fill="${ghost ? 'none' : 'var(--panel)'}" stroke="${col}" stroke-width="2"/>`;
    else s += `<path d="M${x - 5} ${y - 5}L${x + 5} ${y + 5}M${x + 5} ${y - 5}L${x - 5} ${y + 5}" stroke="${col}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    if (n > 1) s += `<text x="${x + 8}" y="${y - 7}" style="fill:var(--ink);font-weight:600">${n}</text>`;
  });
  draw(groups(cfg.zeros, 0), 'zero', 'var(--s1)', false); draw(groups(cfg.poles, cfg.poleOrigin || 0), 'pole', 'var(--s1)', false);
  if (cfg.qZeros) { draw(groups(cfg.qZeros, 0), 'zero', 'var(--s2)', true); draw(groups(cfg.qPoles, cfg.qPoleOrigin || 0), 'pole', 'var(--s2)', true); }
  s += `</svg><div class="tip" hidden></div>`; el.innerHTML = s;
  const svg = el.firstElementChild, tip = el.lastElementChild;
  svg.addEventListener('pointermove', ev => {
    const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * (Wd / r.width), py = (ev.clientY - r.top) * (H / r.height);
    let best = null, bd = 14; marks.forEach(mk => { const d = Math.hypot(mk.x - px, mk.y - py); if (d < bd) { bd = d; best = mk; } });
    if (!best) { tip.hidden = true; return; }
    const z = best.z, ang = Math.atan2(z.im, z.re) / (2 * Math.PI) * cfg.fs;
    tip.innerHTML = `<b>${best.ghost ? 'Quantized ' : ''}${best.type}${best.n > 1 ? ' ×' + best.n : ''}</b><br>${fmtN(z.re, 4)} ${z.im < 0 ? '−' : '+'} ${fmtN(Math.abs(z.im), 4)}j<br>radius ${fmtN(D.cabs(z), 4)} · angle ${fmtN(Math.abs(ang), 0)} Hz`;
    tip.hidden = false; tip.style.left = clamp(px * (r.width / Wd) + 12, 0, r.width - tip.offsetWidth) + 'px'; tip.style.top = clamp(py * (r.height / H) + 12, 0, r.height - 60) + 'px';
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; });
}

const legend = items => `<div class="legend">${items.map(i => `<span><i class="${i.dash ? 'dash' : ''}" style="border-color:${i.color}"></i>${esc(i.label)}</span>`).join('')}</div>`;
function tableDetails(headers, rows, label = 'Show data table') {
  return `<details class="data"><summary>${label}</summary><div class="scroll"><table class="t"><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}

/* ================= views ================= */
function magShades(st, d) {
  const nyq = st.fs / 2, fir = d.kind === 'fir', up = fir ? st.rp / 2 : 0, lo = fir ? -st.rp / 2 : -st.rp, sh = [];
  for (const b of d.bands) {
    if (b.type === 'stop') sh.push({ x0: b.lo, x1: b.hi, y0: -st.rs, y1: 100, edge: -st.rs });
    else { sh.push({ x0: b.lo, x1: b.hi, y0: -400, y1: lo, edge: lo }); if (fir) sh.push({ x0: b.lo, x1: b.hi, y0: up, y1: 400, edge: up }); }
  }
  return sh;
}
function yDomain(st) { return state.zoom === 'pass' ? [-Math.max(st.rp * 2.4, 0.6), Math.max(st.rp * 1.4, 0.4)] : [-Math.ceil((st.rs + 30) / 10) * 10, 5]; }
const edgeHandles = (st, d) => st.edges.map((f, i) => ({ key: i, x: f, label: ROLES[st.btype][i], title: `${LABELS[st.btype][i]}: ${Math.round(f)} Hz` }));
function onEdgeDrag(i, x, final) {
  const gap = Math.max(state.fs / 800, 1), nyq = state.fs / 2, e = state.edges.slice();
  e[i] = clamp(Math.round(x), (e[i - 1] ?? 0) + gap, (e[i + 1] ?? nyq) - gap); state.edges = e; syncControls(); fastMode = !final; scheduleRender();
}

function renderResponse(d) {
  const st = state, v = $('#view');
  const tools = (name, opts, cur) => `<div class="seg" role="group" aria-label="${name}">${opts.map(([k, l]) => `<button data-k="${name}" data-v="${k}" aria-pressed="${cur === k}">${l}</button>`).join('')}</div>`;
  v.innerHTML = `<div class="grid2"><div class="col">
    <div class="panel card"><div class="card-head"><h2>Magnitude</h2><div class="tools"><span class="drag-hint">Drag the edge tabs to reshape the filter</span> ${tools('zoom', [['full', 'Full range'], ['pass', 'Passband']], st.zoom)}
        <button class="btn" id="pinB" aria-pressed="${!!pinB}">${pinB ? 'Clear B' : 'Pin as B'}</button></div></div>
      ${legend([{ label: pinB ? 'A: current design' : 'Response', color: 'var(--s1)' }, ...(pinB ? [{ label: 'B: ' + pinB.title, color: 'var(--cmp)', dash: true }] : []), { label: 'Spec limit (shaded = outside spec)', color: 'var(--shade-line)' }])}
      <div class="chart" id="cMag" data-keepfocus="1"></div><div id="tMag"></div></div>
    <div class="panel card"><div class="card-head"><h2>${st.phase === 'phase' ? 'Phase' : 'Group delay'}</h2><div class="tools">${tools('phase', [['phase', 'Phase'], ['gd', 'Group delay']], st.phase)}</div></div>
      <div class="chart" id="cPh"></div></div></div>
    <div class="col"><div class="panel card"><div class="card-head"><h2>Poles and zeros</h2></div><div class="legend"><span>○ Zero</span><span>× Pole</span></div><div class="chart" id="cPZ"></div><p class="hint">${d.kind === 'fir' ? `FIR: ${d.poleOrigin} poles sit at the origin, so it is always stable.` : 'All poles inside the unit circle means a stable filter.'}</p></div>
    <div class="panel card"><div class="card-head"><h2>Spec check</h2></div>${scoreHtml(d)}</div></div></div>`;
  $$('[data-k]', v).forEach(b => b.addEventListener('click', () => { state[b.dataset.k] = b.dataset.v; renderResponse(current); }));
  $('#pinB').addEventListener('click', () => { pinB = pinB ? null : { title: d.title, f: Array.from(d.resp.f), db: Array.from(d.resp.db), fs: st.fs }; renderResponse(current); $('#pinB').focus(); });
  const nyq = st.fs / 2, r = d.resp, fr = Array.from(r.f), bSame = pinB && pinB.fs === st.fs;
  const series = [{ x: fr, y: Array.from(r.db), draw: true }]; if (pinB) series.push({ x: pinB.f, y: pinB.db, color: 'var(--cmp)', dash: true });
  lineChart($('#cMag'), { label: pinB ? 'Magnitude response in decibels, current design A and pinned design B' : 'Magnitude response in decibels', height: 300, xd: [0, nyq], yd: yDomain(st), yLabel: 'Gain (dB)', xLabel: 'Frequency (Hz)', series,
    shades: magShades(st, d), handles: edgeHandles(st, d), onDrag: onEdgeDrag,
    tip: i => `<b>${fmtN(r.f[i], 1)} Hz</b><br>${pinB ? '<span class="sw" style="background:var(--s1)"></span>A ' : ''}${fmtN(r.db[i], 2)} dB` + (bSame ? `<br><span class="sw dash" style="background:var(--cmp)"></span>B ${fmtN(pinB.db[i], 2)} dB` : '') });
  const phaseChart = () => {
    if (st.phase === 'phase') { const y = Array.from(r.phase, p => p * 180 / Math.PI); lineChart($('#cPh'), { label: 'Phase response', height: 200, xd: [0, nyq], yd: padRange(y), yLabel: 'Phase (°)', xLabel: 'Frequency (Hz)', series: [{ x: fr, y }], tip: i => `<b>${fmtN(r.f[i], 1)} Hz</b><br>${fmtN(y[i], 1)}°` }); }
    else { const g = Array.from(d.gd.gd), fg = Array.from(d.gd.f), fin = g.filter(Number.isFinite).sort((a, b) => a - b); const lo = fin[Math.floor(fin.length * 0.02)], hi = fin[Math.floor(fin.length * 0.98)]; lineChart($('#cPh'), { label: 'Group delay', height: 200, xd: [0, nyq], yd: padRange([lo, hi, 0]), yLabel: 'Delay (samples)', xLabel: 'Frequency (Hz)', series: [{ x: fg, y: g }], tip: i => `<b>${fmtN(fg[i], 1)} Hz</b><br>${fmtN(g[i], 2)} samples (${fmtN(g[i] / st.fs * 1000, 3)} ms)` }); }
  };
  phaseChart();
  pzChart($('#cPZ'), { zeros: d.zeros, poles: d.poles, poleOrigin: d.poleOrigin, fs: st.fs });
  const step = Math.max(1, Math.floor(fr.length / 32)); const rows = []; for (let i = 0; i < fr.length; i += step) rows.push([fmtN(r.f[i], 1), fmtN(r.db[i], 2), fmtN(r.phase[i] * 180 / Math.PI, 1), ...(bSame ? [fmtN(pinB.db[i], 2)] : [])]);
  $('#tMag').innerHTML = tableDetails(['Frequency (Hz)', pinB ? 'A gain (dB)' : 'Gain (dB)', 'Phase (°)', ...(bSame ? ['B gain (dB)'] : [])], rows) + (pinB && !bSame ? '<p class="hint">B was pinned at a different sample rate, so the table and hover readout leave it out.</p>' : '');
}
function padRange(a) { const f = a.filter(Number.isFinite); let lo = Math.min(...f), hi = Math.max(...f); if (hi - lo < 1e-9) { lo -= 1; hi += 1; } const p = (hi - lo) * 0.08; return [lo - p, hi + p]; }

function scoreHtml(d) {
  const st = state, row = (ok, lab, val, sub) => `<div class="row"><span class="ic ${ok ? 'ok' : 'no'}" aria-hidden="true">${ok ? '✓' : '✕'}</span><span class="lab">${lab}</span><span class="val num">${val}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</div>`;
  const gdPass = (() => { const f = Array.from(d.gd.f), g = Array.from(d.gd.gd); let mn = Infinity, mx = -Infinity; d.bands.filter(b => b.type === 'pass').forEach(b => f.forEach((ff, i) => { if (ff >= b.lo && ff <= b.hi && Number.isFinite(g[i])) { mn = Math.min(mn, g[i]); mx = Math.max(mx, g[i]); } })); return [mn, mx]; })();
  const gdTxt = d.kind === 'fir' ? `Constant delay of ${fmtN((d.taps - 1) / 2, 1)} samples (${fmtN((d.taps - 1) / 2 / st.fs * 1000, 2)} ms): linear phase.` : `Delay varies ${fmtN(gdPass[0], 1)} to ${fmtN(gdPass[1], 1)} samples across the passband.`;
  return `<div class="score">
    ${row(d.passRipple, 'Passband ripple', fmtN(d.m.ripple, 3) + ' dB', `Target ${st.rp} dB or less${d.passRipple ? '' : '. Over by ' + fmtN(d.m.ripple - st.rp, 3) + ' dB'}`)}
    ${row(d.stopOk, 'Stopband attenuation', fmtN(d.m.atten, 1) + ' dB', `Target ${st.rs} dB or more${d.stopOk ? '' : '. Short by ' + fmtN(st.rs - d.m.atten, 1) + ' dB'}`)}
    ${row(true, 'Size', d.size, gdTxt)}
    ${d.notes.map(n => `<div class="banner">${esc(n)}</div>`).join('')}</div>`;
}

function listings(d) {
  if (d.kind === 'fir') return { rows: d.h.map((v, n) => [n, v.toPrecision(10)]), head: ['n', 'h[n]'] };
  return { rows: d.sos.map((s, k) => [k + 1, ...s.map(v => v.toFixed(10))]), head: ['Section', 'b0', 'b1', 'b2', 'a0', 'a1', 'a2'] };
}
function impulse(d, n) {
  if (d.kind === 'fir') return Array.from({ length: Math.min(n, d.h.length) }, (_, i) => d.h[i]);
  let x = new Array(n).fill(0); x[0] = 1;
  for (const s of d.sos) { let x1 = 0, x2 = 0, y1 = 0, y2 = 0; x = x.map(v => { const y = s[0] * v + s[1] * x1 + s[2] * x2 - s[4] * y1 - s[5] * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; return y; }); }
  return x;
}
function renderTime(d) {
  const st = state, v = $('#view'), n = d.kind === 'fir' ? Math.min(d.h.length, 400) : 200;
  const h = impulse(d, n), idx = h.map((_, i) => i), stepR = []; h.reduce((a, b, i) => (stepR[i] = a + b), 0);
  const L = listings(d);
  v.innerHTML = `<div class="grid2"><div class="col">
    <div class="panel card"><div class="card-head"><h2>Impulse response</h2></div><div class="chart" id="cImp"></div></div>
    <div class="panel card"><div class="card-head"><h2>Step response</h2></div><div class="chart" id="cStep"></div></div></div>
    <div class="col"><div class="panel card"><div class="card-head"><h2>Coefficients</h2><div class="tools"><button class="btn" id="cpPy">Python</button><button class="btn" id="cpC">C, floating</button><button class="btn" id="cpQ">C, fixed-point</button></div></div>
      <div class="scroll"><table class="t mono"><thead><tr>${L.head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${L.rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="hint">Fixed-point export uses the word length chosen on the Quantization tab (${st.q.coef} bits).</p></div></div></div>`;
  lineChart($('#cImp'), { label: 'Impulse response', height: 240, xd: [-0.5, n - 0.5], yd: padRange([...h, 0]), xticks: undefined, fx: v => Math.round(v), fy: v => fmtN(v, 3), xLabel: 'Sample n', series: [{ type: 'stem', x: idx, y: h }], tip: i => `<b>n = ${i}</b><br>${h[i].toPrecision(6)}` });
  const stp = stepR; lineChart($('#cStep'), { label: 'Step response', height: 220, xd: [0, n - 1], yd: padRange([...stp, 0]), fx: v => Math.round(v), fy: v => fmtN(v, 2), xLabel: 'Sample n', series: [{ x: idx, y: stp }], tip: i => `<b>n = ${i}</b><br>${stp[i].toPrecision(6)}` });
  $('#cpPy').onclick = () => copy(pythonSnippet(d)); $('#cpC').onclick = () => copy(cSnippet(d, false)); $('#cpQ').onclick = () => copy(cSnippet(d, true));
}

/* ---------- quantization ---------- */
function quantAnalysis(d, st) {
  const q = st.q, nyq = st.fs / 2, out = {}, sigFmt = D.qFormat(0, q.sig - 1), x = D.testSignal(8192, 0.22);
  const respOf = (b, a) => D.freqz(b, a, 2048, st.fs);
  const sweepWords = Array.from({ length: 21 }, (_, i) => i + 4);
  const atten = r => { const m = D.measure(r, d.bands); return m.passMax > -20 ? m.atten : NaN; };   // NaN = filter lost its passband
  if (d.kind === 'fir') {
    const qf = D.quantizeFir(d.h, q.coef, q.round), resp = respOf(qf.hq, null);
    Object.assign(out, { fmt: qf.fmt, maxErr: qf.maxErr, resp, m: D.measure(resp, d.bands), zeros: D.polyRoots(qf.hq), poles: [], poleOrigin: d.h.length - 1, stable: true });
    if (qf.fmt.fracBits >= 0) {
      const sim = D.firFixedSim(d.h, x, qf.fmt, sigFmt, q.round, { overflow: q.overflow }), skip = d.h.length;
      out.noise = D.variance(sim.y, sim.yq, skip); out.theory = D.firNoiseTheory(d.h, sigFmt, false);
      out.sqnr = 10 * Math.log10(D.power(sim.yIdeal, skip) / D.variance(sim.y, sim.yIdeal, skip));
    }
    out.sweep = [{ name: 'Quantized coefficients', color: 'var(--s2)', y: sweepWords.map(w => atten(D.freqz(D.quantizeFir(d.h, w, q.round).hq, null, 1024, st.fs))) }];
  } else {
    const qs = D.quantizeSos(d.sos, q.coef, q.round), qd = D.quantizeDirect(d.b, d.a, q.coef, q.round);
    const poleOf = sos => sos.flatMap(s => D.polyRoots(s.slice(3))), zeroOf = sos => sos.flatMap(s => D.polyRoots(s.slice(0, 3)));
    const sosPoles = poleOf(qs.sq), sosStable = sosPoles.every(p => D.cabs(p) < 1);
    out.sos = { fmt: qs.fmt, maxErr: qs.maxErr, resp: D.sosFreqz(qs.sq, 2048, st.fs, qs.gain), zeros: zeroOf(qs.sq), poles: sosPoles, stable: sosStable, maxR: Math.max(...sosPoles.map(D.cabs)) };
    out.direct = { fmt: qd.fmt, maxErr: qd.maxErr, resp: D.freqz(qd.bq, qd.aq, 2048, st.fs, qd.gain), zeros: D.polyRoots(qd.bq), poles: qd.poles, stable: qd.stable, maxR: qd.maxRadius };
    const act = q.struct === 'sos' ? out.sos : out.direct; Object.assign(out, { fmt: act.fmt, maxErr: act.maxErr, resp: act.resp, zeros: act.zeros, poles: act.poles, stable: act.stable, m: D.measure(act.resp, d.bands), maxR: act.maxR, poleOrigin: 0 });
    if (out.sos.stable && qs.fmt.fracBits >= 0) {
      const sim = D.sosFixedSim(qs.scaled, x, qs.fmt, sigFmt, q.round, { overflow: q.overflow, headroomBits: q.headroom, errorFeedback: q.ef }), skip = 600; out.sosSim = true;
      const up = Math.pow(4, q.headroom);   // noise referred back to the output scale (the output is multiplied by 2^h)
      out.noise = D.variance(sim.y, sim.yq, skip) * up; out.theory = D.sosNoiseTheory(qs.sq, sigFmt, false, { errorFeedback: q.ef }) * up;
      out.sqnr = 10 * Math.log10(D.power(sim.yIdeal, skip) / D.variance(sim.y, sim.yIdeal, skip));
    }
    out.sweep = [
      { name: 'Biquad cascade', color: 'var(--s2)', y: sweepWords.map(w => { const t = D.quantizeSos(d.sos, w, q.round); return t.sq.every(s => D.polyRoots(s.slice(3)).every(p => D.cabs(p) < 1)) ? atten(D.sosFreqz(t.sq, 1024, st.fs, t.gain)) : NaN; }) },
      { name: 'Single direct form', color: 'var(--ink-3)', dash: true, y: sweepWords.map(w => { const t = D.quantizeDirect(d.b, d.a, w, q.round); return t.stable ? atten(D.freqz(t.bq, t.aq, 1024, st.fs, t.gain)) : NaN; }) },
    ];
  }
  out.alive = out.stable && out.m.passMax > -20;
  out.sweepWords = sweepWords; out.floatAtten = d.m.atten;
  return out;
}

/** Signal-flow diagram of one direct-form-I biquad with its single rounding point (and the error-feedback path). */
function dfDiagram(ef) {
  const box = (x, y, t) => `<rect class="df-box" x="${x}" y="${y}" width="32" height="20" rx="4"/><text class="df-mono" x="${x + 16}" y="${y + 14}" text-anchor="middle">z⁻¹</text>`;
  const lab = (x, y, t, w = 28) => `<rect class="df-mask" x="${x - w / 2}" y="${y - 19}" width="${w}" height="14"/><text class="df-mono" x="${x}" y="${y - 8}" text-anchor="middle">${t}</text>`;
  const ln = (d, cls = 'df-line', arrow = true) => `<path class="${cls}" d="${d}"${arrow ? ' marker-end="url(#dfArr)"' : ''}/>`;
  return `<div class="df-wrap"><svg class="df" viewBox="0 0 520 220" role="img" aria-labelledby="df-title df-desc"><title id="df-title">Direct-form-I biquad with one rounding point</title>
  <desc id="df-desc">Input x[n] and its two delayed copies are weighted by b0, b1, b2; the two delayed outputs are weighted by minus a1 and minus a2; all five products add in one wide accumulator, which is rounded once at Q to give y[n].${ef ? ' A dashed error-feedback path takes the rounding error back into the accumulator through minus round(a1) and minus round(a2).' : ''}</desc>
  <defs><marker id="dfArr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" class="df-head"/></marker>
  <marker id="dfArrQ" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" class="df-head-q"/></marker></defs>
  <g transform="translate(0 20)">
  ${ln('M44 40H218')}${ln('M70 40V62', 'df-line', false)}${ln('M70 82V122', 'df-line', false)}${ln('M70 102H218')}${ln('M70 142V162H218')}
  ${ln('M264 40H294')}${ln('M352 40H500')}${ln('M440 40V62', 'df-line', false)}${ln('M440 82V122', 'df-line', false)}${ln('M440 102H266')}${ln('M440 142V162H266')}
  ${ef ? `<path class="df-ef" d="M324 26V4H242V22" marker-end="url(#dfArrQ)"/>` : ''}
  <text class="df-name" x="8" y="44">x[n]</text><text class="df-name" x="504" y="30" text-anchor="end">y[n]</text>
  ${box(54, 62)}${box(54, 122)}${box(424, 62)}${box(424, 122)}
  ${lab(150, 40, 'b₀')}${lab(150, 102, 'b₁')}${lab(150, 162, 'b₂')}${lab(360, 102, '−a₁')}${lab(360, 162, '−a₂')}
  <rect class="df-box" x="218" y="24" width="46" height="156" rx="6"/><text class="df-name" x="241" y="100" text-anchor="middle">Σ</text><text class="df-mono" x="241" y="116" text-anchor="middle">ACC</text>
  <rect class="df-q" x="294" y="26" width="58" height="28" rx="6"/><text class="df-name df-qt" x="323" y="45" text-anchor="middle">Q</text>
  <text class="df-mono" x="323" y="72" text-anchor="middle">ROUND ONCE</text>
  ${ef ? `${lab(283, 4, 'ERROR FEEDBACK', 104)}` : ''}
  </g></svg></div>`;
}
/* ---------- signal (time-domain demo) ---------- */
function stopAudio() { if (audio.src) { try { audio.src.stop(); } catch (e) { /* already stopped */ } audio.src = null; } }
function play(y, fs) {
  stopAudio();
  if (!(sig.vol > 0)) { toast('Volume is at zero. Raise it to hear the signal.'); return; }
  try {
    audio.ctx = audio.ctx || new (window.AudioContext || window.webkitAudioContext)();
    const b = audio.ctx.createBuffer(1, y.length, fs), ch = b.getChannelData(0);
    for (let i = 0; i < y.length; i++) ch[i] = clamp(y[i], -1, 1);
    const src = audio.ctx.createBufferSource(), g = audio.ctx.createGain();
    g.gain.value = clamp(sig.vol / 100, 0, 1) * 0.5;   // never louder than half scale
    src.buffer = b; src.connect(g).connect(audio.ctx.destination); src.onended = () => { if (audio.src === src) audio.src = null; };
    src.start(); audio.src = src;
  } catch (e) { toast(`Playback failed: ${e.message}`); }
}
function signalRun(d, st) {
  const q = st.q, wav = sig.source === 'wav' && sig.wav;
  const key = JSON.stringify([d.title, d.size, st.fs, st.edges, st.rp, st.rs, q, sig.source, sig.name, wav ? wav.x.length : 0]);
  if (sigMemo.key === key) return sigMemo.out;
  const fs = st.fs, x = wav ? wav.x : D.toneSignal(16384, fs, [[0.03 * fs, 0.25], [0.11 * fs, 0.25], [0.3 * fs, 0.25]], 0.02, 7);
  const sigFmt = D.qFormat(0, q.sig - 1), out = { x, fs, notes: [] };
  if (d.kind === 'fir') {
    const qf = D.quantizeFir(d.h, q.coef, q.round), sim = D.firFixedSim(d.h, x, qf.fmt, sigFmt, q.round, { overflow: q.overflow });
    out.yF = sim.yIdeal; out.yQ = sim.y;
  } else {
    const qs = D.quantizeSos(d.sos, q.coef, q.round);
    if (q.struct === 'direct') out.notes.push('The fixed-point output uses the biquad cascade (direct form is only analysed for coefficient sensitivity).');
    if (!qs.sq.every(s => D.polyRoots(s.slice(3)).every(p => D.cabs(p) < 1))) { out.notes.push(`At ${q.coef} bits a biquad pole leaves the unit circle, so there is no fixed-point output. Use more bits.`); }
    const sim = D.sosFixedSim(qs.scaled, x, qs.fmt, sigFmt, q.round, { overflow: q.overflow, headroomBits: q.headroom, errorFeedback: q.ef }), g = qs.gain * Math.pow(2, q.headroom);
    out.yF = sim.yIdeal.map(v => v * g); out.yQ = out.notes.length && /no fixed-point/.test(out.notes.join()) ? null : sim.y.map(v => v * g);
  }
  const skip = Math.min(1000, Math.floor(x.length / 10));
  out.snr = out.yQ ? 10 * Math.log10(D.power(out.yF, skip) / D.variance(out.yQ, out.yF, skip)) : NaN;
  const nfft = x.length >= 8192 ? 4096 : 1024;
  out.sx = D.powerSpectrumDb(x, fs, nfft); out.sF = D.powerSpectrumDb(out.yF, fs, nfft); out.sQ = out.yQ ? D.powerSpectrumDb(out.yQ, fs, nfft) : null;
  sigMemo = { key, out }; return out;
}
function renderSignal(d) {
  const st = state, v = $('#view'), r = signalRun(d, st), fs = st.fs, nyq = fs / 2;
  const wav = sig.source === 'wav' && sig.wav, srcTxt = wav ? `${esc(sig.name)}: ${sig.wav.format}, ${sig.wav.channels === 2 ? 'stereo mixed to mono' : 'mono'}, ${fmtN(sig.wav.seconds, 2)} s at ${sig.wav.fs} Hz.`
    : `Three tones at ${fmtN(0.03 * fs, 0)}, ${fmtN(0.11 * fs, 0)} and ${fmtN(0.3 * fs, 0)} Hz (amplitude 0.25 each) plus white noise (rms 0.02), ${fmtN(16384 / fs, 2)} s.`;
  const segBtn = (k, l) => `<button data-src="${k}" aria-pressed="${sig.source === k}">${l}</button>`;
  v.innerHTML = `<div class="panel card"><div class="sigctl">
      <div><div class="seg" role="group" aria-label="Signal source">${segBtn('tones', 'Test tones')}${segBtn('wav', 'WAV file')}</div>
        <label class="file btn">Choose a WAV file<input type="file" id="wavIn" accept=".wav,audio/wav,audio/x-wav" class="vh"></label>
        <p class="hint" id="srcInfo">${sig.source === 'wav' && !sig.wav ? 'No file loaded yet. PCM 16- or 24-bit, or 32-bit float; mono or stereo; up to 10 s.' : srcTxt}</p>
        ${sig.error ? `<div class="banner" role="alert">${esc(sig.error)}</div>` : ''}
        ${wav && sig.wav.fs !== fs ? `<div class="banner info">The file was recorded at ${sig.wav.fs} Hz but the design is at ${fs} Hz, so every frequency below is scaled by ${fmtN(fs / sig.wav.fs, 3)}. Set the sample rate to ${sig.wav.fs} to hear it as recorded.</div>` : ''}
        ${r.notes.map(n => `<div class="banner info">${esc(n)}</div>`).join('')}</div>
      <div><div class="slider"><label for="vol">Volume <small class="unit">starts muted, capped at half scale</small></label><span class="big num">${sig.vol}%</span><input type="range" id="vol" min="0" max="100" value="${sig.vol}"></div>
        <div class="tools play"><button class="btn" data-play="x">Play input</button><button class="btn" data-play="f">Play floating point</button><button class="btn" data-play="q"${r.yQ ? '' : ' disabled'}>Play fixed point</button><button class="btn" id="stopA">Stop</button></div></div>
    </div></div>
    <div class="grid2"><div class="col">
      <div class="panel card"><div class="card-head"><h2>Output spectrum</h2></div>${legend([{ label: 'Floating point', color: 'var(--s1)' }, { label: `Fixed point, ${st.q.coef}-bit coefficients, ${st.q.sig}-bit signal`, color: 'var(--s2)' }])}<div class="chart" id="sOut"></div>
        <p class="caption">The same input through your filter twice: once in floating point, once bit-true in fixed point with the Quantization tab's settings. Where the orange floor sits above the blue, you are seeing round-off noise and coefficient error. ${Number.isFinite(r.snr) ? `Fixed point against floating point: <b class="num">${fmtN(r.snr, 1)} dB</b> signal-to-noise.` : ''}</p><div id="sOutT"></div></div>
      <div class="panel card"><div class="card-head"><h2>Input spectrum</h2></div><div class="chart" id="sIn"></div><p class="caption">Averaged power spectrum (Welch, Hann window). A full-scale sine reads 0 dB.</p></div></div>
    <div class="col"><div class="panel card"><div class="card-head"><h2>First samples</h2></div>${legend([{ label: 'Input', color: 'var(--ink-3)', dash: true }, { label: 'Floating point', color: 'var(--s1)' }, { label: 'Fixed point', color: 'var(--s2)' }])}<div class="chart" id="sTime"></div>
      <p class="caption">The first ${Math.min(400, r.x.length)} samples. The filter delays and reshapes the input; the two outputs should lie on top of each other unless the arithmetic overflowed.</p></div></div></div>`;
  $$('[data-src]', v).forEach(b => b.addEventListener('click', () => { sig.source = b.dataset.src; sig.error = ''; renderSignal(current); }));
  $('#wavIn').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    sig.error = '';
    if (f.size > 64 * 1024 * 1024) sig.error = 'That file is larger than 64 MB. A 10 s WAV is far smaller; trim it and try again.';
    else try {
      const w = D.parseWav(await f.arrayBuffer());
      sig.wav = w; sig.name = f.name; sig.source = 'wav';
      if (w.fs !== state.fs) { const k = w.fs / state.fs; state.edges = state.edges.map(x => Math.round(x * k)); state.fs = w.fs; syncControls(); }
    } catch (err) { sig.error = `Could not read ${f.name}. ${err.message}`; }
    render();
  });
  $('#vol').addEventListener('input', e => { sig.vol = +e.target.value; $('.slider .big', v).textContent = sig.vol + '%'; if (audio.src) stopAudio(); });
  $$('[data-play]', v).forEach(b => b.addEventListener('click', () => play(b.dataset.play === 'x' ? r.x : b.dataset.play === 'f' ? r.yF : r.yQ, fs)));
  $('#stopA').addEventListener('click', stopAudio);
  const all = [r.sx, r.sF, r.sQ].filter(Boolean).flatMap(s => Array.from(s.db)), top = Math.ceil((Math.max(...all) + 6) / 10) * 10, yd = [top - 140, top];
  const fr = Array.from(r.sF.f), dbF = Array.from(r.sF.db), dbQ = r.sQ ? Array.from(r.sQ.db) : null;
  lineChart($('#sOut'), { label: 'Output power spectrum, floating point and fixed point', height: 280, xd: [0, nyq], yd, yLabel: 'Power (dB)', xLabel: 'Frequency (Hz)',
    series: [{ x: fr, y: dbF }, ...(dbQ ? [{ x: fr, y: dbQ }] : [])], tip: i => `<b>${fmtN(fr[i], 1)} Hz</b><br><span class="sw" style="background:var(--s1)"></span>${fmtN(dbF[i], 1)} dB` + (dbQ ? `<br><span class="sw" style="background:var(--s2)"></span>${fmtN(dbQ[i], 1)} dB` : '') });
  const step = Math.max(1, Math.floor(fr.length / 32)), rows = []; for (let i = 0; i < fr.length; i += step) rows.push([fmtN(fr[i], 1), fmtN(dbF[i], 1), dbQ ? fmtN(dbQ[i], 1) : 'n/a']);
  $('#sOutT').innerHTML = tableDetails(['Frequency (Hz)', 'Floating point (dB)', 'Fixed point (dB)'], rows);
  const dbx = Array.from(r.sx.db);
  lineChart($('#sIn'), { label: 'Input power spectrum', height: 200, xd: [0, nyq], yd, yLabel: 'Power (dB)', xLabel: 'Frequency (Hz)', series: [{ x: fr, y: dbx, color: 'var(--ink-2)' }], tip: i => `<b>${fmtN(fr[i], 1)} Hz</b><br>${fmtN(dbx[i], 1)} dB` });
  const n = Math.min(400, r.x.length), idx = Array.from({ length: n }, (_, i) => i), xi = Array.from(r.x.slice(0, n)), yf = Array.from(r.yF.slice(0, n)), yq = r.yQ ? Array.from(r.yQ.slice(0, n)) : null;
  lineChart($('#sTime'), { label: 'First samples of the input and both outputs', height: 280, xd: [0, n - 1], yd: padRange([...xi, ...yf, ...(yq || [])]), fx: v => Math.round(v), fy: v => fmtN(v, 2), xLabel: 'Sample n',
    series: [{ x: idx, y: xi, color: 'var(--ink-3)', dash: true }, { x: idx, y: yf, color: 'var(--s1)' }, ...(yq ? [{ x: idx, y: yq, color: 'var(--s2)' }] : [])],   // input drawn first, underneath
    tip: i => `<b>n = ${i}</b><br>Input ${fmtN(xi[i], 4)}<br><span class="sw" style="background:var(--s1)"></span>${fmtN(yf[i], 4)}` + (yq ? `<br><span class="sw" style="background:var(--s2)"></span>${fmtN(yq[i], 4)}` : '') });
}
function renderQuant(d) {
  const st = state, q = st.q, v = $('#view'), qa = quantAnalysis(d, st), nyq = st.fs / 2, iir = d.kind === 'iir';
  const sliderBlock = (id, label, min, max, val, big) => `<div class="slider"><label for="${id}">${label}</label><span class="big num">${big}</span><input type="range" id="${id}" min="${min}" max="${max}" value="${val}"></div>`;
  const fmtS = f => f.fracBits >= 0 ? `Q${f.intBits}.${f.fracBits}` : `step ${Math.pow(2, -f.fracBits)}`;
  const deadMsg = qa.stable && !qa.alive ? `<div class="banner"><b>Passband lost.</b> At ${q.coef} bits the rounded coefficients are too coarse to pass the signal. Use more bits${iir && q.struct === 'direct' ? ' or switch to a biquad cascade' : ''}.</div>` : '';
  const unstableMsg = deadMsg || (!qa.stable ? `<div class="banner"><b>Unstable.</b> After rounding to ${q.coef} bits, ${iir ? (q.struct === 'direct' ? 'a pole of the single high-order polynomial moved to radius ' + fmtN(qa.maxR, 3) + ', outside the unit circle.' : 'a biquad pole moved outside the unit circle.') : ''} Use more bits${iir && q.struct === 'direct' ? ' or switch to a biquad cascade' : ''}.</div>` : '');
  const sweepNote = iir ? 'Gaps mean the filter went unstable or lost its passband at that word length.' : '';
  v.innerHTML = `<div class="panel card"><div class="qctl">
      ${sliderBlock('qCoef', 'Coefficient word length', 4, 24, q.coef, `${q.coef} bits <small class="unit">${fmtS(qa.fmt)}</small>`)}
      ${sliderBlock('qSig', 'Signal word length', 8, 20, q.sig, `${q.sig} bits <small class="unit">Q0.${q.sig - 1}</small>`)}
      <div><div class="field" style="grid-template-columns:1fr 130px;margin-top:0"><label for="qRound">Coefficient rounding</label><select id="qRound"><option value="nearest">Nearest</option><option value="floor">Floor (truncate)</option></select></div>
      ${iir ? `<div class="field" style="grid-template-columns:1fr 130px"><label for="qStruct">Structure</label><select id="qStruct"><option value="sos">Biquad cascade</option><option value="direct">Single direct form</option></select></div>` : ''}
      <div class="field" style="grid-template-columns:1fr 130px"><label for="qOver">On overflow</label><select id="qOver"><option value="saturate">Saturate</option><option value="wrap">Wrap around</option></select></div></div>
      ${iir ? `<div>${sliderBlock('qHead', 'Input headroom', 0, 6, q.headroom, `${q.headroom} bit${q.headroom === 1 ? '' : 's'} <small class="unit">${q.headroom ? '−' + fmtN(6.02 * q.headroom, 1) + ' dB SNR' : 'none'}</small>`)}
      <label class="check"><input type="checkbox" id="qEF"${q.ef ? ' checked' : ''}> Error feedback <small class="unit">feeds each rounding error back through round(a₁), round(a₂)</small></label></div>` : ''}</div></div>
    <div class="grid2"><div class="col">
      <div class="panel card"><div class="card-head"><h2>Response, before and after rounding</h2></div>${legend([{ label: 'Floating point', color: 'var(--s1)' }, { label: `Quantized, ${q.coef}-bit coefficients`, color: 'var(--s2)' }])}<div class="chart" id="qMag"></div><p class="caption">Blue is the filter you designed. Orange is the same filter after every coefficient is rounded to ${q.coef} bits, which is what fixed-point hardware actually computes. Where orange crosses into the shaded area, rounding alone broke the spec.</p>${unstableMsg}</div>
      <div class="panel card"><div class="card-head"><h2>Stopband attenuation against word length</h2></div>${legend([{ label: 'Floating point', color: 'var(--s1)', dash: true }, ...qa.sweep.map(s => ({ label: s.name, color: s.color, dash: s.dash }))])}<div class="chart" id="qSweep"></div><p class="caption">Each point rounds the same design to that many bits; nothing is redesigned. Fewer bits mean coarser steps and usually less stopband attenuation. ${sweepNote} The dotted marker is your current setting.</p><div id="qSweepT"></div></div></div>
    <div class="col"><div class="panel card"><div class="card-head"><h2>Poles and zeros</h2></div>${legend([{ label: 'Floating point', color: 'var(--s1)' }, { label: 'Quantized', color: 'var(--s2)' }])}<div class="chart" id="qPZ"></div><p class="caption">Rounding moves poles and zeros. ${iir ? 'A pole that reaches the unit circle makes the filter ring forever or blow up; high-order direct form is far more sensitive than a cascade of biquads.' : 'An FIR filter has no poles to move, so it stays stable at any word length; only its zeros, and so its stopband, shift.'}</p></div>
      ${iir && q.struct === 'sos' ? `<div class="panel card"><div class="card-head"><h2>Inside one biquad</h2></div>${dfDiagram(q.ef)}<p class="caption">Each section of the cascade rounds once, at Q. That rounding error (variance q²/12, with q one step of the ${q.sig}-bit signal) feeds back through −a₁ and −a₂, so the section's own poles amplify it before the later sections filter it.${q.ef ? ' Error feedback (dashed) subtracts round(a₁)·r[n−1] + round(a₂)·r[n−2] before rounding, which cancels most of that amplification when the poles sit near z = 1.' : ''}</p></div>` : ''}
      <div class="panel card"><div class="card-head"><h2>Rounding effects</h2></div>${quantScore(d, qa)}<p class="caption">Coefficient rounding changes which filter you get. Round-off noise is separate: it is the error added every time the arithmetic rounds a result, measured here on a test signal and compared with theory.</p></div></div></div>`;
  $('#qRound').value = q.round; if (iir) $('#qStruct').value = q.struct;
  const upd = () => renderQuant(current);
  $('#qCoef').oninput = e => { q.coef = +e.target.value; upd(); focusRestore('qCoef'); }; $('#qSig').oninput = e => { q.sig = +e.target.value; upd(); focusRestore('qSig'); };
  $('#qRound').onchange = e => { q.round = e.target.value; upd(); }; if (iir) $('#qStruct').onchange = e => { q.struct = e.target.value; upd(); };
  $('#qOver').value = q.overflow; $('#qOver').onchange = e => { q.overflow = e.target.value; upd(); };
  if (iir) { $('#qHead').oninput = e => { q.headroom = +e.target.value; upd(); focusRestore('qHead'); }; $('#qEF').onchange = e => { q.ef = e.target.checked; upd(); focusRestore('qEF'); }; }
  const fr = Array.from(d.resp.f), y = Array.from(qa.resp.db);
  lineChart($('#qMag'), { label: 'Magnitude before and after quantization', height: 290, xd: [0, nyq], yd: yDomain(st), yLabel: 'Gain (dB)', xLabel: 'Frequency (Hz)', shades: magShades(st, d), series: [{ x: fr, y: Array.from(d.resp.db) }, { x: fr, y }],
    tip: i => `<b>${fmtN(d.resp.f[i], 1)} Hz</b><br><span class="sw" style="background:var(--s1)"></span>${fmtN(d.resp.db[i], 2)} dB<br><span class="sw" style="background:var(--s2)"></span>${fmtN(y[i], 2)} dB` });
  const wd = qa.sweepWords, series = [{ x: wd, y: wd.map(() => qa.floatAtten), color: 'var(--s1)', dash: true }, ...qa.sweep.map(s => ({ x: wd, y: s.y, color: s.color, dash: s.dash }))];
  const all = series.flatMap(s => s.y).filter(Number.isFinite), hi = Math.max(...all, st.rs) + 6;
  lineChart($('#qSweep'), { label: 'Stopband attenuation against coefficient word length', height: 250, xd: [4, 24], yd: [0, Math.ceil(hi / 10) * 10], xticks: [4, 8, 12, 16, 20, 24], fx: v => v, fy: v => v, xLabel: 'Coefficient word length (bits)', yLabel: 'Attenuation (dB)', series, hlines: [{ y: st.rs }],
    tip: i => `<b>${wd[i]} bits</b><br>Float: ${fmtN(qa.floatAtten, 1)} dB` + qa.sweep.map(s => `<br><span class="sw" style="background:${s.color}"></span>${s.name}: ${Number.isFinite(s.y[i]) ? fmtN(s.y[i], 1) + ' dB' : 'unstable or no passband'}`).join('') });
  const cur = $('#qSweep svg'); if (cur) { /* current-setting marker */ const W = cur.viewBox.baseVal.width, m = { l: 62, r: 14 }; const xv = m.l + (q.coef - 4) / 20 * (W - m.l - m.r); cur.insertAdjacentHTML('beforeend', `<line x1="${xv}" x2="${xv}" y1="22" y2="${250 - 24}" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="1 3" pointer-events="none"/>`); }
  $('#qSweepT').innerHTML = tableDetails(['Bits', ...qa.sweep.map(s => s.name)], wd.map((w, i) => [w, ...qa.sweep.map(s => Number.isFinite(s.y[i]) ? fmtN(s.y[i], 1) + ' dB' : 'unstable or no passband')]));
  pzChart($('#qPZ'), { zeros: d.zeros, poles: d.poles, poleOrigin: d.poleOrigin, qZeros: qa.zeros, qPoles: qa.poles, qPoleOrigin: qa.poleOrigin || 0, fs: st.fs });
}
function focusRestore(id) { const el = document.getElementById(id); if (el) el.focus(); }
function quantScore(d, qa) {
  const st = state, lsb = Math.pow(2, -qa.fmt.fracBits), row = (ok, lab, val, sub) => `<div class="row"><span class="ic ${ok ? 'ok' : 'no'}" aria-hidden="true">${ok ? '✓' : '✕'}</span><span class="lab">${lab}</span><span class="val num">${val}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</div>`;
  const stopOk = qa.alive && qa.m.atten >= st.rs - 0.01, ripOk = qa.alive && qa.m.ripple <= st.rp * 1.0005 + 1e-6;
  let h = '<div class="score">';
  h += row(qa.stable, 'Stability', qa.stable ? 'Stable' : 'Unstable', d.kind === 'fir' ? 'FIR filters cannot go unstable.' : `Largest pole radius ${fmtN(qa.maxR, 4)}`);
  h += row(stopOk, 'Stopband attenuation', qa.alive ? fmtN(qa.m.atten, 1) + ' dB' : 'n/a', `Floating point gives ${fmtN(d.m.atten, 1)} dB. Spec ${st.rs} dB.`);
  h += row(ripOk, 'Passband ripple', qa.alive ? fmtN(qa.m.ripple, 3) + ' dB' : 'n/a', `Floating point gives ${fmtN(d.m.ripple, 3)} dB. Spec ${st.rp} dB.`);
  h += row(qa.maxErr <= lsb / 2 + 1e-15, 'Largest coefficient error', qa.maxErr.toExponential(1), `Rounding limit is half a step, ${(lsb / 2).toExponential(1)}. Format ${qa.fmt.fracBits >= 0 ? 'Q' + qa.fmt.intBits + '.' + qa.fmt.fracBits : 'coarser than 1 (step ' + Math.pow(2, -qa.fmt.fracBits) + ')'}.`);
  if (qa.sqnr !== undefined && (d.kind === 'fir' || st.q.struct === 'sos')) {
    const gap = 10 * Math.log10(qa.noise / qa.theory);
    h += row(Math.abs(gap) < 3, 'Round-off noise', fmtN(10 * Math.log10(qa.noise), 1) + ' dB', `Theory predicts ${fmtN(10 * Math.log10(qa.theory), 1)} dB (${gap >= 0 ? '+' : ''}${fmtN(gap, 1)} dB off). ${d.kind === 'iir' ? `Inside the cascade, before the output gain${st.q.headroom ? `, scaled back by 2^${st.q.headroom}` : ''}${st.q.ef ? ', with error feedback' : ''}. ` : ''}Relative to a 1.0 full scale.${Math.abs(gap) >= 3 && st.q.overflow === 'wrap' ? ' Large gaps with wrap-around usually mean the signal overflowed.' : ''}`);
    h += row(true, 'Signal-to-noise ratio', fmtN(qa.sqnr, 1) + ' dB', `Fixed-point output against the ideal floating-point filter, so coefficient rounding counts too. ${st.q.sig}-bit signal.`);
  } else if (d.kind === 'iir' && st.q.struct === 'direct') h += '<div class="banner info">Round-off noise is simulated for the biquad cascade only. Direct form is shown for its coefficient sensitivity: switch Structure to see the noise figures.</div>';
  else if (!qa.stable) h += '<div class="banner info">Noise simulation skipped because the quantized filter is unstable.</div>';
  return h + '</div>';
}

/* ================= export ================= */
function pythonSnippet(d) {
  const st = state, nyq = st.fs / 2, e = st.edges, f = v => String(Math.round(v * 1e6) / 1e6);
  const dp = (Math.pow(10, st.rp / 20) - 1) / (Math.pow(10, st.rp / 20) + 1), ds = Math.pow(10, -st.rs / 20);
  const des = { lowpass: '[1, 0]', highpass: '[0, 1]', bandpass: '[0, 1, 0]', bandstop: '[1, 0, 1]' }[st.btype];
  const w = { lowpass: [1 / dp, 1 / ds], highpass: [1 / ds, 1 / dp], bandpass: [1 / ds, 1 / dp, 1 / ds], bandstop: [1 / dp, 1 / ds, 1 / dp] }[st.btype].map(x => +x.toPrecision(5));
  if (st.method === 'remez') return `from dsp import remez\nh = remez(${d.taps}, [0, ${e.map(f).join(', ')}, ${f(nyq)}], ${des},\n          weight=[${w.join(', ')}], fs=${st.fs})`;
  if (st.method === 'window') { const cuts = st.btype === 'lowpass' || st.btype === 'highpass' ? [(e[0] + e[1]) / 2] : [(e[0] + e[1]) / 2, (e[2] + e[3]) / 2]; return `from dsp import fir_window\nh = fir_window(${d.taps}, ${cuts.length > 1 ? '[' + cuts.map(f).join(', ') + ']' : f(cuts[0])}, "${st.btype}", "${st.win}", fs=${st.fs}${st.win === 'kaiser' ? ', beta=' + fmtN(d.beta, 4) : ''})`; }
  const sp = splitEdges(st.btype, e), ed = (st.method === 'cheby2' ? sp.stop : sp.pass), edTxt = ed.length > 1 ? '[' + ed.map(f).join(', ') + ']' : f(ed[0]);
  return `from dsp import design_iir\nd = design_iir("${st.method}", "${st.btype}", ${d.order}, ${edTxt}, fs=${st.fs}, rp=${st.rp}, rs=${st.rs}${st.method === 'butter' ? ',\n               butter_edge_rp=' + st.rp : ''})\nsos = d["sos"]   # biquad cascade; d["b"], d["a"] hold the single polynomial form`;
}
function cSnippet(d, fixed) {
  const st = state, q = st.q;
  if (d.kind === 'fir') {
    if (!fixed) return `// ${d.title}, fs = ${st.fs} Hz\nstatic const float h[${d.h.length}] = {\n  ${d.h.map(v => v.toExponential(9) + 'f').join(',\n  ')}\n};`;
    const fm = D.autoFormat(Math.max(...d.h.map(Math.abs)), q.coef); const T = q.coef <= 16 ? 'int16_t' : 'int32_t';
    return `// ${d.title}, fs = ${st.fs} Hz. Q${fm.intBits}.${fm.fracBits} coefficients (value = integer / 2^${fm.fracBits})\n#define H_FRAC_BITS ${fm.fracBits}\nstatic const ${T} h[${d.h.length}] = {\n  ${d.h.map(v => D.toInt(v, fm, q.round)).join(', ')}\n};`;
  }
  if (!fixed) return `// ${d.title}, fs = ${st.fs} Hz. Each row: b0 b1 b2 a1 a2 (a0 = 1)\nstatic const float sos[${d.sos.length}][5] = {\n${d.sos.map(s => '  { ' + [0, 1, 2, 4, 5].map(i => s[i].toExponential(9) + 'f').join(', ') + ' }').join(',\n')}\n};`;
  const qs = D.quantizeSos(d.sos, q.coef, q.round), T = q.coef <= 16 ? 'int16_t' : 'int32_t';
  return `// ${d.title}, fs = ${st.fs} Hz. Q${qs.fmt.intBits}.${qs.fmt.fracBits} coefficients. Each row: b0 b1 b2 a1 a2 (a0 = 1)\n#define SOS_FRAC_BITS ${qs.fmt.fracBits}\nstatic const ${T} sos[${d.sos.length}][5] = {\n${d.sos.map(s => '  { ' + [0, 1, 2, 4, 5].map(i => D.toInt(s[i], qs.fmt, q.round)).join(', ') + ' }').join(',\n')}\n};`;
}
function copy(text) {
  const done = () => toast('Copied to clipboard');
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  function fallback() { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed. Select the text manually.'); } t.remove(); }
}
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 1800); }

/* ================= controls ================= */
const miniIcon = bt => {
  const p = { lowpass: 'M2 4H14Q18 4 20 8T26 12H32', highpass: 'M2 12H8Q14 12 16 8T22 4H32', bandpass: 'M2 12H9Q13 12 15 6T19 6T23 12H32', bandstop: 'M2 4H9Q13 4 15 10T19 10T23 4H32' }[bt];
  return `<svg viewBox="0 0 34 16" aria-hidden="true"><path d="${p}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
};
function buildControls() {
  $('#controls').innerHTML = `
  <details class="grp" id="gMethod"><summary><h3>Method</h3><span class="sum" id="sumMethod"></span></summary><div class="method" role="radiogroup" aria-label="Design method">${Object.entries(METHODS).map(([k, m]) => `<label><input type="radio" name="method" value="${k}"><b>${m.name}</b><small>${m.note}</small></label>`).join('')}</div></details>
  <details class="grp" open><summary><h3>Response type</h3><span class="sum" id="sumBtype"></span></summary><div class="seg" id="btype" role="group" aria-label="Response type">${Object.entries(BTYPES).map(([k, l]) => `<button data-v="${k}" aria-pressed="false">${miniIcon(k)}${l}</button>`).join('')}</div></details>
  <details class="grp" open><summary><h3>Spec</h3><span class="sum"></span></summary>
    <div class="field"><label for="fs">Sample rate</label><span><input id="fs" type="number" min="100" step="100"></span></div>
    <div id="edgeFields"></div>
    <div class="field"><label for="rp">Passband ripple</label><span><input id="rp" type="number" min="0.01" max="6" step="any"></span></div>
    <div class="field"><label for="rs">Stopband attenuation</label><span><input id="rs" type="number" min="10" max="140" step="any"></span></div>
    <p class="hint">Frequencies in Hz, ripple and attenuation in dB.</p></details>
  <details class="grp" id="gSize"><summary><h3>Size</h3><span class="sum" id="sumSize"></span></summary>
    <div class="field hidden" id="winRow"><label for="win">Window</label><select id="win">${Object.entries(WINDOWS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
    <div class="seg" id="omode" role="group" aria-label="Order selection"><button data-v="auto" aria-pressed="true">Pick for me</button><button data-v="manual" aria-pressed="false">Set it</button></div>
    <div class="field"><label for="ord" id="ordLab">Taps</label><span><input id="ord" type="number" min="1" step="1"></span></div>
    <p class="hint" id="ordHint"></p></details>`;
  $$('input[name=method]').forEach(r => r.addEventListener('change', () => { state.method = r.value; if (METHODS[r.value].kind === 'iir' && state.orderMode === 'manual') state.order = clamp(current?.order || 4, 1, 24); syncControls(); scheduleRender(); }));
  $$('#btype button').forEach(b => b.addEventListener('click', () => { state.btype = b.dataset.v; state.edges = defaultEdges(state.btype, state.fs); syncControls(); scheduleRender(); }));
  $('#fs').addEventListener('input', e => { const nf = +e.target.value; if (nf >= 100) { const r = nf / state.fs; state.edges = state.edges.map(x => Math.round(x * r)); state.fs = nf; syncControls(true); scheduleRender(); } });
  $('#rp').addEventListener('input', e => { if (+e.target.value > 0) { state.rp = +e.target.value; scheduleRender(); } });
  $('#rs').addEventListener('input', e => { if (+e.target.value > 0) { state.rs = +e.target.value; scheduleRender(); } });
  $('#win').addEventListener('change', e => { state.win = e.target.value; scheduleRender(); });
  $$('#omode button').forEach(b => b.addEventListener('click', () => { state.orderMode = b.dataset.v; if (b.dataset.v === 'manual' && current) state.order = current.kind === 'fir' ? current.taps : current.order; syncControls(); scheduleRender(); }));
  $('#ord').addEventListener('input', e => { const n = Math.round(+e.target.value); if (n >= 1) { state.order = n; scheduleRender(); } });
}
function syncControls(skipFs) {
  const st = state, M = METHODS[st.method];
  $$('input[name=method]').forEach(r => { r.checked = r.value === st.method; });
  $('#sumMethod').textContent = M.name; $('#sumBtype').textContent = BTYPES[st.btype];
  $$('#btype button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === st.btype)));
  if (!skipFs && document.activeElement !== $('#fs')) $('#fs').value = st.fs;
  if (document.activeElement !== $('#rp')) $('#rp').value = st.rp; if (document.activeElement !== $('#rs')) $('#rs').value = st.rs;
  const host = $('#edgeFields'), n = st.edges.length;
  if (host.dataset.sig !== st.btype) {
    host.dataset.sig = st.btype;
    host.innerHTML = LABELS[st.btype].map((l, i) => `<div class="field"><label for="e${i}">${l}</label><span><input id="e${i}" type="number" step="any" data-i="${i}"></span></div>`).join('');
    $$('#edgeFields input').forEach(inp => inp.addEventListener('input', () => {
      const i = +inp.dataset.i, v = +inp.value; if (!(v > 0)) return; const gap = Math.max(st.fs / 800, 1), e = st.edges.slice();
      e[i] = clamp(v, (e[i - 1] ?? 0) + gap, (e[i + 1] ?? st.fs / 2) - gap); st.edges = e; scheduleRender();
    }));
    $$('#edgeFields input').forEach(inp => inp.addEventListener('change', () => syncControls()));
  }
  $$('#edgeFields input').forEach((inp, i) => { if (document.activeElement !== inp) inp.value = Math.round(st.edges[i]); });
  $('#winRow').classList.toggle('hidden', st.method !== 'window'); $('#win').value = st.win;
  $$('#omode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === st.orderMode)));
  const ord = $('#ord'); ord.disabled = st.orderMode === 'auto'; $('#ordLab').textContent = M.kind === 'fir' ? 'Taps' : (st.btype === 'bandpass' || st.btype === 'bandstop' ? 'Prototype order' : 'Order'); ord.max = M.kind === 'fir' ? 1201 : 24;
  if (document.activeElement !== ord) ord.value = st.orderMode === 'manual' ? st.order : (current ? (current.kind === 'fir' ? current.taps : current.order) : '');
  $('#ordHint').textContent = st.orderMode === 'auto' ? (st.method === 'remez' ? 'Searches for the fewest taps that meet the spec.' : st.method === 'window' ? 'From the transition width and window.' : (st.btype === 'bandpass' || st.btype === 'bandstop' ? 'Lowest order that meets the spec. Band filters end up twice the prototype order.' : 'Lowest order that meets the spec.')) : 'Manual size. The spec check shows what you get.';
}

/* ================= render loop ================= */
function scheduleRender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render(); }); }
function render() {
  const st = state; let d;
  try { d = designFilter(st, fastMode); } catch (err) { $('#view').innerHTML = `<div class="banner">Could not design this filter: ${esc(err.message)}. Check that the edges increase and stay below half the sample rate.</div>`; console.error(err); return; }
  current = d;
  if (st.orderMode === 'auto' && document.activeElement !== $('#ord')) $('#ord').value = d.kind === 'fir' ? d.taps : d.order;
  $$('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === st.tab)));
  if (st.tab !== 'signal') stopAudio();
  if (st.tab === 'response') renderResponse(d); else if (st.tab === 'time') renderTime(d); else if (st.tab === 'signal') renderSignal(d); else renderQuant(d);
  if (st.tab === 'response') drawn = true;
  $('#subtitle').textContent = d.title;
  $('#sumSize').textContent = `${d.size}${st.orderMode === 'auto' ? ', picked for you' : ''}`;
  $('#sumMethod').textContent = METHODS[st.method].name; $('#sumBtype').textContent = BTYPES[st.btype];
  if (fastMode) { clearTimeout(render.t); render.t = setTimeout(() => { fastMode = false; scheduleRender(); }, 160); }
}

function init() {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches; document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('#theme').textContent = dark ? 'Light theme' : 'Dark theme';
  $('#theme').addEventListener('click', () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; $('#theme').textContent = t === 'dark' ? 'Light theme' : 'Dark theme'; render(); });
  $('#copyPy').addEventListener('click', () => current && copy(pythonSnippet(current)));
  $$('.tabs button').forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.tab; render(); }));
  buildControls(); syncControls();
  let rt; new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => current && render(), 120); }).observe($('#view'));
  render(); window.__filterlab = { state, designFilter, sig, get current() { return current; } };
}
document.addEventListener('DOMContentLoaded', init);
})();
