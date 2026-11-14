'use strict';
/* Adjustment layer (Curves, Levels, Hue/Sat, Color Balance, Camera Raw) dan filter. */

const ADJ = {
  curves: { name: 'Curves', def: () => ({ ch: 'rgb', pts: { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] } }) },
  levels: { name: 'Levels', def: () => ({ inB: 0, gamma: 1, inW: 255, outB: 0, outW: 255 }) },
  hsl: { name: 'Hue/Saturation', def: () => ({ hue: 0, sat: 0, light: 0 }) },
  balance: { name: 'Color Balance', def: () => ({ tone: 'mid', shadows: [0, 0, 0], mid: [0, 0, 0], high: [0, 0, 0], preserve: true }) },
  raw: { name: 'Camera Raw', def: () => ({ exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, temp: 0, tint: 0, vibrance: 0, saturation: 0, clarity: 0, dehaze: 0, sharpen: 0, vignette: 0 }) },
};
const RAW_SPEC = [
  ['Cahaya'], ['exposure', 'Exposure', -4, 4, 0.05], ['contrast', 'Contrast', -100, 100, 1],
  ['highlights', 'Highlights', -100, 100, 1], ['shadows', 'Shadows', -100, 100, 1],
  ['whites', 'Whites', -100, 100, 1], ['blacks', 'Blacks', -100, 100, 1],
  ['Warna'], ['temp', 'Temperature', -100, 100, 1], ['tint', 'Tint', -100, 100, 1],
  ['vibrance', 'Vibrance', -100, 100, 1], ['saturation', 'Saturation', -100, 100, 1],
  ['Detail & efek'], ['clarity', 'Clarity', -100, 100, 1], ['dehaze', 'Dehaze', -100, 100, 1],
  ['sharpen', 'Sharpen', 0, 150, 1], ['vignette', 'Vignette', -100, 100, 1],
];
const LEVELS_SPEC = [['inB', 'Input hitam', 0, 254, 1], ['gamma', 'Gamma', 0.1, 3, 0.01], ['inW', 'Input putih', 1, 255, 1], ['outB', 'Output hitam', 0, 255, 1], ['outW', 'Output putih', 0, 255, 1]];
const HSL_SPEC = [['hue', 'Hue', -180, 180, 1], ['sat', 'Saturation', -100, 100, 1], ['light', 'Lightness', -100, 100, 1]];

function applyAdjust(id, a, w, h) {
  const f = { curves: adjCurves, levels: adjLevels, hsl: adjHsl, balance: adjBalance, raw: adjRaw }[a.kind];
  if (f) f(id.data, a, w, h);
}

/* Monotone cubic (Fritsch–Carlson): kurva halus tanpa overshoot */
function curveLUT(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0]), n = p.length, lut = new Uint8ClampedArray(256);
  if (n < 2) { for (let i = 0; i < 256; i++) lut[i] = i; return lut; }
  const xs = p.map(q => q[0]), ys = p.map(q => q[1]), d = [], m = [];
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / ((xs[i + 1] - xs[i]) || 1);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  let k = 0;
  for (let x = 0; x < 256; x++) {
    let y;
    if (x <= xs[0]) y = ys[0];
    else if (x >= xs[n - 1]) y = ys[n - 1];
    else {
      while (k < n - 2 && x >= xs[k + 1]) k++;
      const hh = xs[k + 1] - xs[k], t = (x - xs[k]) / hh, t2 = t * t, t3 = t2 * t;
      y = (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * hh * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * hh * m[k + 1];
    }
    lut[x] = y;
  }
  return lut;
}
function adjCurves(d, a) {
  const M = curveLUT(a.pts.rgb), R = curveLUT(a.pts.r), G = curveLUT(a.pts.g), B = curveLUT(a.pts.b);
  for (let j = 0; j < d.length; j += 4) { d[j] = M[R[d[j]]]; d[j + 1] = M[G[d[j + 1]]]; d[j + 2] = M[B[d[j + 2]]]; }
}
function adjLevels(d, a) {
  const lut = new Uint8ClampedArray(256), span = Math.max(1, a.inW - a.inB);
  for (let x = 0; x < 256; x++) {
    const v = Math.pow(clamp((x - a.inB) / span, 0, 1), 1 / a.gamma);
    lut[x] = a.outB + v * (a.outW - a.outB);
  }
  for (let j = 0; j < d.length; j += 4) { d[j] = lut[d[j]]; d[j + 1] = lut[d[j + 1]]; d[j + 2] = lut[d[j + 2]]; }
}
function hue2(p, q, t) {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function adjHsl(d, a) {
  const hs = a.hue / 360, sat = a.sat / 100, li = a.light / 100;
  if (!hs && !sat && !li) return;
  for (let j = 0; j < d.length; j += 4) {
    let r = d[j] / 255, g = d[j + 1] / 255, b = d[j + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dd = mx - mn;
    let h = 0, s = 0, l = (mx + mn) / 2;
    if (dd) {
      s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
      h = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
      h /= 6;
    }
    h = (h + hs) % 1; if (h < 0) h += 1;
    s = clamp(s * (1 + sat), 0, 1);
    l = li > 0 ? l + (1 - l) * li : l * (1 + li);
    if (s === 0) r = g = b = l;
    else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; r = hue2(p, q, h + 1 / 3); g = hue2(p, q, h); b = hue2(p, q, h - 1 / 3); }
    d[j] = r * 255; d[j + 1] = g * 255; d[j + 2] = b * 255;
  }
}
function adjBalance(d, a) {
  const S0 = a.shadows, M = a.mid, Hh = a.high;
  for (let j = 0; j < d.length; j += 4) {
    const r = d[j], g = d[j + 1], b = d[j + 2];
    const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const ws = (1 - L) * (1 - L), wh = L * L, wm = 2 * L * (1 - L);
    let nr = r + (ws * S0[0] + wm * M[0] + wh * Hh[0]) * 0.9;
    let ng = g + (ws * S0[1] + wm * M[1] + wh * Hh[1]) * 0.9;
    let nb = b + (ws * S0[2] + wm * M[2] + wh * Hh[2]) * 0.9;
    if (a.preserve) { const dl = L * 255 - (0.299 * nr + 0.587 * ng + 0.114 * nb); nr += dl; ng += dl; nb += dl; }
    d[j] = nr; d[j + 1] = ng; d[j + 2] = nb;
  }
}
function adjRaw(d, a, w, h) {
  const n = w * h, k = Math.pow(2, a.exposure);
  let L0 = null, blurL = null, blurS = null;
  if (a.clarity || a.sharpen) {
    L0 = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) L0[i] = (0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2]) / 255;
    if (a.clarity) blurL = gaussBlur(L0, w, h, Math.max(w, h) / 60);
    if (a.sharpen) blurS = gaussBlur(L0, w, h, 1.2);
  }
  const tr = 1 + a.temp / 250, tb = 1 - a.temp / 250, tg = 1 - a.tint / 250;
  const con = 1 + a.contrast / 100, sat = 1 + a.saturation / 100, vib = a.vibrance / 100, dh = a.dehaze / 100;
  const cxw = w / 2, cyh = h / 2, maxd = Math.hypot(cxw, cyh);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    let r = d[j] / 255 * k * tr, g = d[j + 1] / 255 * k * tg, b = d[j + 2] / 255 * k * tb;
    let L = 0.2126 * r + 0.7152 * g + 0.0722 * b, dl = 0;
    if (a.highlights) dl += a.highlights / 100 * 0.4 * sstep(0.45, 1, L);
    if (a.shadows) dl += a.shadows / 100 * 0.4 * (1 - sstep(0, 0.55, L));
    if (a.whites) dl += a.whites / 100 * 0.3 * sstep(0.7, 1.05, L);
    if (a.blacks) dl += a.blacks / 100 * 0.25 * (1 - sstep(0, 0.3, L));
    if (blurL) dl += a.clarity / 100 * (L0[i] - blurL[i]) * 1.6 * (1 - Math.abs(2 * L - 1) * 0.5);
    if (blurS) dl += a.sharpen / 100 * (L0[i] - blurS[i]) * 3;
    r += dl; g += dl; b += dl;
    if (dh > 0) { const s = dh * 0.25; r = (r - s) / (1 - s); g = (g - s) / (1 - s); b = (b - s) / (1 - s); }
    else if (dh < 0) { const s = -dh * 0.3; r = r * (1 - s) + s * 0.6; g = g * (1 - s) + s * 0.6; b = b * (1 - s) + s * 0.6; }
    if (con !== 1) { r = (r - 0.5) * con + 0.5; g = (g - 0.5) * con + 0.5; b = (b - 0.5) * con + 0.5; }
    L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let sf = sat;
    if (dh > 0) sf *= 1 + dh * 0.3;
    if (vib) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); sf *= 1 + vib * (1 - Math.min(1, (mx - mn) * 1.5)); }
    if (sf !== 1) { r = L + (r - L) * sf; g = L + (g - L) * sf; b = L + (b - L) * sf; }
    if (a.vignette) {
      const x = i % w, y = (i / w) | 0;
      const f = 1 + a.vignette / 100 * sstep(0.35, 1, Math.hypot(x - cxw, y - cyh) / maxd);
      r *= f; g *= f; b *= f;
    }
    d[j] = r * 255; d[j + 1] = g * 255; d[j + 2] = b * 255;
  }
}

/* ---------- Filter (destruktif di layer piksel, atau live di Smart Object) ---------- */
const FILTERS = {
  blur: { name: 'Gaussian Blur', min: 0, max: 100, def: 6, unit: 'px' },
  sharpen: { name: 'Sharpen', min: 0, max: 300, def: 80, unit: '%' },
  noise: { name: 'Noise', min: 0, max: 100, def: 10, unit: '%' },
  gray: { name: 'Hitam putih' },
  sepia: { name: 'Sepia' },
  invert: { name: 'Invert' },
};
function applyFilter(c, f) {
  const k = f.kind, a = f.amount || 0;
  if (k === 'blur') return blurCanvas(c, a);
  const n = cloneCanvas(c), g = cx(n), id = g.getImageData(0, 0, n.width, n.height), d = id.data;
  if (k === 'sharpen') {
    const b = cx(blurCanvas(c, 2)).getImageData(0, 0, n.width, n.height).data, s = a / 100 * 1.5;
    for (let i = 0; i < d.length; i += 4) { d[i] += (d[i] - b[i]) * s; d[i + 1] += (d[i + 1] - b[i + 1]) * s; d[i + 2] += (d[i + 2] - b[i + 2]) * s; }
  } else if (k === 'noise') {
    const s = a * 2.55;
    for (let i = 0; i < d.length; i += 4) { const r = (Math.random() - 0.5) * s; d[i] += r; d[i + 1] += r; d[i + 2] += r; }
  } else if (k === 'gray') {
    for (let i = 0; i < d.length; i += 4) { const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = v; }
  } else if (k === 'sepia') {
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g2 = d[i + 1], b = d[i + 2];
      d[i] = 0.393 * r + 0.769 * g2 + 0.189 * b; d[i + 1] = 0.349 * r + 0.686 * g2 + 0.168 * b; d[i + 2] = 0.272 * r + 0.534 * g2 + 0.131 * b;
    }
  } else if (k === 'invert') {
    for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
  }
  g.putImageData(id, 0, 0);
  return n;
}
function applyFilters(src, list) {
  let c = src;
  for (const f of list) if (f.on !== false) c = applyFilter(c, f);
  return c;
}
