'use strict';
/* Adjustment layer (Curves, Levels, Hue/Sat, Color Balance, Camera Raw) dan filter.

   Adjustment dihitung per piksel dalam float (0..255, tidak dibulatkan) dan adjustment
   yang bertumpuk dijalankan berurutan tanpa pembulatan di antaranya; pembulatan ke 8-bit
   hanya sekali di akhir, dengan dither, supaya gradasi (langit, kulit) tidak berpita. */

const HSL_BANDS = [['red', 'Merah', 0], ['yellow', 'Kuning', 60], ['green', 'Hijau', 120], ['cyan', 'Cyan', 180], ['blue', 'Biru', 240], ['magenta', 'Magenta', 300]];
const ADJ = {
  curves: { name: 'Curves', def: () => ({ ch: 'rgb', pts: { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] } }) },
  levels: { name: 'Levels', def: () => ({ inB: 0, gamma: 1, inW: 255, outB: 0, outW: 255 }) },
  hsl: { name: 'Hue/Saturation', def: () => ({ hue: 0, sat: 0, light: 0, band: 'all', bands: {} }) },
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

/* ---------- Ruang warna: sRGB ↔ linear (LUT + interpolasi, di luar 0..1 pakai rumus) ---------- */
const LUTN = 1024, TO_LIN = new Float32Array(LUTN + 1), TO_SRGB = new Float32Array(LUTN + 1);
for (let i = 0; i <= LUTN; i++) {
  const v = i / LUTN;
  TO_LIN[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  TO_SRGB[i] = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}
function toLin(v) {
  if (v <= 0) return v / 12.92;
  if (v >= 1) return Math.pow((v + 0.055) / 1.055, 2.4);
  const x = v * LUTN, i = x | 0; return TO_LIN[i] + (TO_LIN[i + 1] - TO_LIN[i]) * (x - i);
}
function toSrgb(v) {
  if (v <= 0) return v * 12.92;
  if (v >= 1) return 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  const x = v * LUTN, i = x | 0; return TO_SRGB[i] + (TO_SRGB[i + 1] - TO_SRGB[i]) * (x - i);
}
/* Baca LUT 256 entri di posisi float (interpolasi linear) */
function lutF(t, v) {
  if (v <= 0) return t[0];
  if (v >= 255) return t[255];
  const i = v | 0; return t[i] + (t[i + 1] - t[i]) * (v - i);
}

/* Dither acak ±0.5 LSB: nilai bulat tidak berubah, nilai pecahan dibulatkan secara acak
   sehingga rata-ratanya tetap tepat dan banding hilang. */
const DITH = new Float32Array(65536);
for (let i = 0; i < DITH.length; i++) DITH[i] = Math.random() - 0.5;

/* ---------- Kompilasi adjustment jadi fungsi per piksel ----------
   Tiap stage: { needL, init(L0), px(c, i) }; c = Float32Array(3) RGB 0..255, i = indeks piksel.
   needL: stage butuh luminans input-nya sendiri (untuk clarity/sharpen). null = tidak berefek. */
function curveLUT(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0]), n = p.length, lut = new Float32Array(256);
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
    lut[x] = clamp(y, 0, 255);
  }
  return lut;
}
const isIdent = lut => lut.every((v, i) => v === i);

function stageCurves(a) {
  const M = curveLUT(a.pts.rgb), R = curveLUT(a.pts.r), G = curveLUT(a.pts.g), B = curveLUT(a.pts.b);
  if (isIdent(M) && isIdent(R) && isIdent(G) && isIdent(B)) return null;
  return { px(c) { c[0] = lutF(M, lutF(R, c[0])); c[1] = lutF(M, lutF(G, c[1])); c[2] = lutF(M, lutF(B, c[2])); } };
}
function stageLevels(a) {
  const lut = new Float32Array(256), span = Math.max(1, a.inW - a.inB);
  for (let x = 0; x < 256; x++) lut[x] = a.outB + Math.pow(clamp((x - a.inB) / span, 0, 1), 1 / a.gamma) * (a.outW - a.outB);
  if (isIdent(lut)) return null;
  return { px(c) { c[0] = lutF(lut, c[0]); c[1] = lutF(lut, c[1]); c[2] = lutF(lut, c[2]); } };
}
function hue2(p, q, t) {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function stageHsl(a) {
  const hs = a.hue / 360, sat = a.sat / 100, li = a.light / 100;
  // rentang warna aktif: [pusat hue (derajat), Δhue, Δsat, Δlight]
  const bands = HSL_BANDS.map(([k, , c]) => { const b = a.bands && a.bands[k]; return b && (b.hue || b.sat || b.light) ? [c, b.hue / 360, b.sat / 100, b.light / 100] : null; }).filter(Boolean);
  if (!hs && !sat && !li && !bands.length) return null;
  return {
    px(c) {
      let r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dd = mx - mn;
      let h = 0, s = 0, l = (mx + mn) / 2;
      if (dd) {
        s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
        h = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
        h /= 6;
      }
      let dh = hs, sf = 1 + sat, bl = 0;
      if (bands.length && s > 0.02) {
        const hd = h * 360, sw = sstep(0.02, 0.15, s); // warna yang hampir abu-abu tidak ikut berubah
        for (const [cen, bh, bs, bli] of bands) {
          const dist = Math.abs(((hd - cen + 540) % 360) - 180);
          const w = (1 - sstep(15, 45, dist)) * sw;
          if (w <= 0) continue;
          dh += bh * w; sf *= 1 + bs * w; bl += bli * w;
        }
      }
      h = (h + dh) % 1; if (h < 0) h += 1;
      s = clamp(s * sf, 0, 1);
      l = li > 0 ? l + (1 - l) * li : l * (1 + li);
      if (bl) l = bl > 0 ? l + (1 - l) * bl * 0.6 : l * (1 + bl * 0.6);
      if (s === 0) r = g = b = l;
      else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; r = hue2(p, q, h + 1 / 3); g = hue2(p, q, h); b = hue2(p, q, h - 1 / 3); }
      c[0] = r * 255; c[1] = g * 255; c[2] = b * 255;
    },
  };
}
function stageBalance(a) {
  const S0 = a.shadows, M = a.mid, Hh = a.high;
  if (![...S0, ...M, ...Hh].some(v => v)) return null;
  return {
    px(c) {
      const r = c[0], g = c[1], b = c[2];
      const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const ws = (1 - L) * (1 - L), wh = L * L, wm = 2 * L * (1 - L);
      let nr = r + (ws * S0[0] + wm * M[0] + wh * Hh[0]) * 0.9;
      let ng = g + (ws * S0[1] + wm * M[1] + wh * Hh[1]) * 0.9;
      let nb = b + (ws * S0[2] + wm * M[2] + wh * Hh[2]) * 0.9;
      if (a.preserve) { const dl = L * 255 - (0.299 * nr + 0.587 * ng + 0.114 * nb); nr += dl; ng += dl; nb += dl; }
      c[0] = nr; c[1] = ng; c[2] = nb;
    },
  };
}
/* Camera Raw: exposure & white balance dihitung di cahaya linear (seperti kamera:
   +1 EV = cahaya 2×), sisanya (tonal, kontras, warna) di ruang sRGB perseptual. */
function stageRaw(a, w, h) {
  if (!Object.keys(a).some(k => k !== 'kind' && a[k])) return null;
  const k = Math.pow(2, a.exposure), lin = a.exposure || a.temp || a.tint;
  const tr = 1 + a.temp / 250, tb = 1 - a.temp / 250, tg = 1 - a.tint / 250;
  const con = 1 + a.contrast / 100, sat = 1 + a.saturation / 100, vib = a.vibrance / 100, dh = a.dehaze / 100;
  const cxw = w / 2, cyh = h / 2, maxd = Math.hypot(cxw, cyh);
  let L0 = null, blurL = null, blurS = null;
  return {
    needL: !!(a.clarity || a.sharpen),
    init(L) {
      L0 = L;
      if (a.clarity) blurL = gaussBlur(L, w, h, Math.max(w, h) / 60);
      if (a.sharpen) blurS = gaussBlur(L, w, h, 1.2);
    },
    px(c, i) {
      let r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
      if (lin) { r = toSrgb(toLin(r) * k * tr); g = toSrgb(toLin(g) * k * tg); b = toSrgb(toLin(b) * k * tb); }
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
      c[0] = r * 255; c[1] = g * 255; c[2] = b * 255;
    },
  };
}
function compileAdj(a, w, h) {
  const f = { curves: stageCurves, levels: stageLevels, hsl: stageHsl, balance: stageBalance, raw: stageRaw }[a.kind];
  return f ? f(a, w, h) : null;
}

/* Mask layer sebagai alpha 0..1 per piksel (di-cache per versi layer) */
function maskAlpha(l) {
  if (l._ma && l._ma.c === l.mask && l._ma.v === l.ver) return l._ma.a;
  const d = cx(l.mask).getImageData(0, 0, D.w, D.h).data, a = new Float32Array(D.w * D.h);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
  l._ma = { c: l.mask, v: l.ver, a };
  return a;
}

/* Terapkan deretan adjustment layer (blend Normal) ke ImageData sekaligus.
   Opacity & mask tiap layer dibaurkan dalam float; pembulatan + dither sekali di akhir. */
function applyAdjustRun(id, layers, w, h) {
  const d = id.data, n = w * h, c = new Float32Array(3), prev = new Float32Array(3);
  const stages = [];
  const runPx = (i, j) => {
    c[0] = d[j]; c[1] = d[j + 1]; c[2] = d[j + 2];
    for (const s of stages) {
      const wt = s.m ? s.op * s.m[i] : s.op;
      if (wt <= 0) continue;
      if (wt < 1) { prev[0] = c[0]; prev[1] = c[1]; prev[2] = c[2]; }
      s.px(c, i);
      c[0] = clamp(c[0], 0, 255); c[1] = clamp(c[1], 0, 255); c[2] = clamp(c[2], 0, 255);
      if (wt < 1) { c[0] = prev[0] + (c[0] - prev[0]) * wt; c[1] = prev[1] + (c[1] - prev[1]) * wt; c[2] = prev[2] + (c[2] - prev[2]) * wt; }
    }
  };
  for (const l of layers) {
    const s = compileAdj(l.adj, w, h);
    if (!s || l.opacity <= 0) continue;
    if (s.needL) { // luminans input stage ini = hasil semua stage sebelumnya
      const L = new Float32Array(n);
      for (let i = 0, j = 0; i < n; i++, j += 4) { runPx(i, j); L[i] = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }
      s.init(L);
    }
    s.op = l.opacity; s.m = l.mask ? maskAlpha(l) : null;
    stages.push(s);
  }
  if (!stages.length) return;
  let di = 0;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    runPx(i, j);
    d[j] = c[0] + DITH[di]; d[j + 1] = c[1] + DITH[di + 1]; d[j + 2] = c[2] + DITH[di + 2];
    di = di < 65530 ? di + 3 : (i * 7) & 1023;
  }
}
function applyAdjust(id, a, w, h) { applyAdjustRun(id, [{ adj: a, opacity: 1, mask: null }], w, h); }

/* ---------- Analisis gambar: histogram, Auto, white balance ---------- */
function imageStats(c) {
  const w = c.width, h = c.height, d = cx(c).getImageData(0, 0, w, h).data;
  const lh = new Uint32Array(256), step = Math.max(1, Math.floor(w * h / 300000)) * 4;
  let n = 0;
  for (let i = 0; i < d.length; i += step) { if (d[i + 3] < 8) continue; lh[(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0]++; n++; }
  const pct = p => { let acc = 0; const t = p * n; for (let i = 0; i < 256; i++) { acc += lh[i]; if (acc >= t) return i; } return 255; };
  return { n, pct };
}
/* Komposit semua layer di bawah layer l (input yang dilihat adjustment l) */
function inputOf(l) { return composite(D.layers.indexOf(l)); }

function autoAdjust(l) {
  const a = l.adj, st = imageStats(inputOf(l));
  if (!st.n) return;
  pushH('Auto ' + ADJ[a.kind].name);
  const lo = st.pct(0.002), hi = Math.max(st.pct(0.998), lo + 16), med = st.pct(0.5);
  if (a.kind === 'levels') {
    a.inB = lo; a.inW = hi;
    const m = clamp((med - lo) / (hi - lo), 0.05, 0.95);
    a.gamma = +clamp(Math.log(m) / Math.log(0.5), 0.4, 2.5).toFixed(2);
  } else if (a.kind === 'raw') {
    a.exposure = Math.round(clamp(Math.log2(toLin(0.46) / Math.max(1e-4, toLin(med / 255))) * 0.6, -2, 2) * 20) / 20;
    a.whites = Math.round(clamp((250 - hi) * 1.2, -50, 60));
    a.blacks = Math.round(clamp((6 - lo) * 1.5, -60, 40));
    a.highlights = hi >= 254 ? -30 : 0;
    a.shadows = med < 90 ? 20 : 0;
  }
  touch(l); renderProps();
}

/* Pipet white balance: klik area yang seharusnya netral (abu-abu/putih) → Temp & Tint diisi. */
function startWBPick(l) {
  S.pick = { l, comp: inputOf(l) };
  toast('Klik area yang seharusnya abu-abu atau putih netral. Esc = batal.');
  $('#view').style.cursor = 'crosshair';
}
function endWBPick() { S.pick = null; $('#view').style.cursor = ''; }
function pickWB(p) {
  const { l, comp } = S.pick;
  endWBPick();
  const x0 = clamp(Math.floor(p.x) - 3, 0, D.w - 7), y0 = clamp(Math.floor(p.y) - 3, 0, D.h - 7);
  const d = cx(comp).getImageData(x0, y0, Math.min(7, D.w), Math.min(7, D.h)).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += toLin(d[i] / 255); g += toLin(d[i + 1] / 255); b += toLin(d[i + 2] / 255); }
  if (r + g + b < 1e-3) { toast('Area terlalu gelap untuk white balance.'); return; }
  // tr·r = tb·b dengan tr = 1+t, tb = 1−t  →  t = (b−r)/(r+b); lalu tg·g = tr·r
  const t = clamp((b - r) / (r + b), -0.4, 0.4), tg = (1 + t) * r / Math.max(1e-6, g);
  pushH('White balance');
  l.adj.temp = Math.round(clamp(t * 250, -100, 100));
  l.adj.tint = Math.round(clamp((1 - tg) * 250, -100, 100));
  touch(l); renderProps();
}

/* ---------- Filter (destruktif di layer piksel, atau live di Smart Object) ---------- */
const FILTERS = {
  blur: { name: 'Gaussian Blur', min: 0, max: 100, def: 6, unit: 'px' },
  sharpen: {
    name: 'Unsharp Mask', min: 0, max: 300, def: 80, unit: '%',
    params: [['radius', 'Radius', 0.5, 20, 0.1, 1.2, 'px'], ['threshold', 'Threshold', 0, 40, 1, 3, '']],
  },
  noise: { name: 'Noise', min: 0, max: 100, def: 10, unit: '%' },
  gray: { name: 'Hitam putih' },
  sepia: { name: 'Sepia' },
  invert: { name: 'Invert' },
};
/* Unsharp Mask di luminans saja (tanpa halo berwarna); threshold melindungi area halus
   seperti kulit & langit agar noise tidak ikut ditajamkan. */
function unsharp(d, w, h, amount, radius, threshold) {
  const n = w * h, L = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) L[i] = 0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2];
  const B = gaussBlur(L, w, h, radius), s = amount / 100, th = threshold;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const dl = L[i] - B[i], ad = Math.abs(dl);
    if (ad <= th) continue;
    const k = th ? Math.min(1, (ad - th) / th) * s : s, v = dl * k;
    d[j] += v; d[j + 1] += v; d[j + 2] += v;
  }
}
function applyFilter(c, f) {
  const k = f.kind, a = f.amount || 0;
  if (k === 'blur') return blurCanvas(c, a);
  const n = cloneCanvas(c), g = cx(n), id = g.getImageData(0, 0, n.width, n.height), d = id.data;
  if (k === 'sharpen') {
    unsharp(d, n.width, n.height, a, f.radius ?? 1.2, f.threshold ?? 3);
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
