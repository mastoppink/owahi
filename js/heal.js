'use strict';
/* Mesin goresan (brush, eraser, clone, healing, spot healing) dan content-aware fill. */

let ST = null; // goresan yang sedang berjalan

function makeStamp(size, hard, color) {
  const d = Math.max(2, Math.ceil(size)), c = mk(d, d), g = cx(c), r = d / 2;
  const [R, G, B] = hex2rgb(color);
  const gr = g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, `rgba(${R},${G},${B},1)`);
  gr.addColorStop(clamp(hard, 0, 0.99), `rgba(${R},${G},${B},1)`);
  gr.addColorStop(1, `rgba(${R},${G},${B},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, d, d);
  return c;
}

function strokeTarget(kind) {
  const l = AL();
  if (!l) return null;
  if (kind === 'spot' || kind === 'clone' || kind === 'heal') {
    if (S.editMask) { toast('Matikan mode edit mask dulu (klik thumbnail layer).'); return null; }
    if (l.type !== 'pixel') { toast('Pilih layer piksel (Layer → Rasterize dulu).'); return null; }
    return { l, key: 'canvas', mask: false };
  }
  if (S.editMask && l.mask) return { l, key: 'mask', mask: true };
  if (l.type !== 'pixel') {
    toast(l.type === 'adjust' ? 'Ini adjustment layer: lukis di mask-nya (klik thumbnail mask).' : 'Rasterize layer ini dulu, atau tambahkan mask lalu lukis di mask.');
    return null;
  }
  return { l, key: 'canvas', mask: false };
}

function beginStroke(kind, p) {
  const t = strokeTarget(kind);
  if (!t) return false;
  if ((kind === 'clone' || kind === 'heal') && !S.cloneSrc) { toast('Alt+klik dulu untuk menentukan titik sumber.'); return false; }
  pushH({ brush: 'Brush', eraser: 'Eraser', clone: 'Clone Stamp', heal: 'Healing Brush', spot: 'Spot Healing' }[kind]);
  const st = { kind, ...t, orig: t.l[t.key], work: mk(D.w, D.h), stroke: mk(D.w, D.h), last: { x: p.x, y: p.y }, size: S.opt.size };
  if (kind === 'brush') { st.color = t.mask ? '#ffffff' : S.fg; st.erase = t.mask && lum(S.fg) < 128; }
  else if (kind === 'eraser') { st.color = '#000000'; st.erase = true; }
  else if (kind === 'spot') { st.color = '#ff3b30'; }
  else {
    st.color = '#ffffff';
    if (!S.cloneOff) S.cloneOff = { x: S.cloneSrc.x - p.x, y: S.cloneSrc.y - p.y };
    st.off = { ...S.cloneOff };
    st.src = S.opt.sampleAll ? composite() : st.orig;
  }
  st.stamp = makeStamp(st.size, kind === 'spot' ? 0.9 : S.opt.hard, st.color);
  if (kind !== 'spot') t.l[t.key] = st.work;
  ST = st;
  dab(p.x, p.y, p.pr);
  renderStroke(st);
  return true;
}

function dab(x, y, pr) {
  const st = ST;
  const s = Math.max(1, st.size * (S.opt.pressure && st.kind !== 'spot' ? clamp(pr, 0.05, 1) : 1));
  const g = cx(st.stroke);
  if (st.kind === 'clone' || st.kind === 'heal') {
    const d = Math.ceil(s);
    if (!st.tmp || st.tmp.width !== d) st.tmp = mk(d, d);
    const tg = cx(st.tmp);
    tg.globalCompositeOperation = 'copy';
    tg.drawImage(st.src, -(x + st.off.x - d / 2), -(y + st.off.y - d / 2));
    tg.globalCompositeOperation = 'destination-in';
    tg.drawImage(st.stamp, 0, 0, d, d);
    g.globalAlpha = S.opt.flow;
    g.drawImage(st.tmp, x - d / 2, y - d / 2);
  } else {
    g.globalAlpha = st.kind === 'spot' ? 1 : S.opt.flow;
    g.drawImage(st.stamp, x - s / 2, y - s / 2, s, s);
  }
  g.globalAlpha = 1;
}

function strokeTo(p) {
  const st = ST;
  if (!st) return;
  const sp = Math.max(1, st.size * 0.12);
  const dx = p.x - st.last.x, dy = p.y - st.last.y, dist = Math.hypot(dx, dy);
  if (dist < sp) return;
  const n = Math.floor(dist / sp);
  for (let i = 1; i <= n; i++) { const t = i * sp / dist; dab(st.last.x + dx * t, st.last.y + dy * t, p.pr); }
  st.last = { x: st.last.x + dx * n * sp / dist, y: st.last.y + dy * n * sp / dist };
  renderStroke(st);
}

function renderStroke(st) {
  if (st.kind === 'spot') { requestView(); return; }
  let s = st.stroke;
  if (S.sel) {
    if (!st.clip) st.clip = mk(D.w, D.h);
    const cg = cx(st.clip);
    cg.globalCompositeOperation = 'copy'; cg.drawImage(s, 0, 0);
    cg.globalCompositeOperation = 'destination-in'; cg.drawImage(S.sel, 0, 0);
    s = st.clip;
  }
  const g = cx(st.work);
  g.globalCompositeOperation = 'copy'; g.globalAlpha = 1;
  g.drawImage(st.orig, 0, 0);
  g.globalAlpha = S.opt.opacity;
  g.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over';
  g.drawImage(s, 0, 0);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  touch(st.l);
}

async function endStroke() {
  const st = ST;
  ST = null;
  if (!st) return;
  if (st.kind === 'heal') { healCorrect(st); renderStroke(st); }
  if (st.kind === 'spot') {
    let hole = st.stroke;
    if (S.sel) { hole = cloneCanvas(hole); maskInto(hole, S.sel); }
    await busy('Menghapus…', async () => { st.l.canvas = inpaintCanvas(st.orig, hole); });
    touch(st.l);
  }
  refreshLayers();
}

/* Healing: tekstur dari sumber, warna & cahaya (frekuensi rendah) dari sekitar area tujuan. */
function healCorrect(st) {
  const b = canvasBounds(st.stroke);
  if (!b) return;
  const pad = Math.ceil(st.size);
  const R = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad) };
  R.w = Math.min(D.w, b.x + b.w + pad) - R.x; R.h = Math.min(D.h, b.y + b.h + pad) - R.y;
  const srcC = mk(R.w, R.h), sg = cx(srcC);
  sg.drawImage(st.src, -(R.x + st.off.x), -(R.y + st.off.y));
  const sd = sg.getImageData(0, 0, R.w, R.h);
  const dd = cx(st.orig).getImageData(R.x, R.y, R.w, R.h).data;
  const md = cropCanvas(st.stroke, R);
  const ma = cx(md).getImageData(0, 0, R.w, R.h).data;
  const n = R.w * R.h, rad = Math.max(3, st.size * 0.6);
  const wgt = new Float32Array(n);
  for (let i = 0; i < n; i++) wgt[i] = 1 - ma[i * 4 + 3] / 255;
  const bw = gaussBlur(wgt, R.w, R.h, rad);
  for (let c = 0; c < 3; c++) {
    const A = new Float32Array(n), B = new Float32Array(n);
    for (let i = 0; i < n; i++) { A[i] = sd.data[i * 4 + c]; B[i] = dd[i * 4 + c] * wgt[i]; }
    const bA = gaussBlur(A, R.w, R.h, rad), bB = gaussBlur(B, R.w, R.h, rad);
    for (let i = 0; i < n; i++) {
      const dest = bw[i] > 0.02 ? bB[i] / bw[i] : bA[i];
      sd.data[i * 4 + c] = A[i] + dest - bA[i];
    }
  }
  sg.putImageData(sd, 0, 0);
  sg.globalCompositeOperation = 'destination-in';
  sg.drawImage(md, 0, 0);
  const g = cx(st.stroke);
  g.clearRect(0, 0, D.w, D.h);
  g.drawImage(srcC, R.x, R.y);
}

/* ---------- Content-aware fill (inpainting berbasis patch) ----------
   Mengisi lubang dari tepi ke dalam; tiap piksel mencari patch paling mirip
   (kandidat acak + propagasi dari tetangga agar tekstur menyambung).
   Multi-skala (kasar → halus): struktur besar diisi di resolusi kecil, lalu tiap level
   ×2 memperhalus peta patch (PatchMatch) sampai resolusi tinggi, jadi tekstur tetap tajam. */
const INP_BASE = 40000, INP_MAX = 1.2e6;
function holeAt(dil, w, h) {
  const hc = mk(w, h), hg = cx(hc);
  hg.drawImage(dil, 0, 0, w, h);
  const hd = hg.getImageData(0, 0, w, h).data, hole = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) hole[i] = hd[i * 4 + 3] > 10 ? 1 : 0;
  return hole;
}
function inpaintCanvas(src, holeC) {
  const b = canvasBounds(holeC, 10);
  if (!b) return src;
  const pad = Math.round(Math.max(30, Math.max(b.w, b.h) * 0.9));
  const R = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad) };
  R.w = Math.min(D.w, b.x + b.w + pad) - R.x; R.h = Math.min(D.h, b.y + b.h + pad) - R.y;
  const dil = dilateCanvas(cropCanvas(holeC, R), 2);

  const fs = Math.min(1, Math.sqrt(INP_MAX / (R.w * R.h)));
  let w = Math.max(8, Math.round(R.w * fs)), h = Math.max(8, Math.round(R.h * fs));
  const sizes = [[w, h]];
  while (w * h > INP_BASE) { w = Math.max(8, Math.round(w / 2)); h = Math.max(8, Math.round(h / 2)); sizes.unshift([w, h]); }

  let prev = null;
  sizes.forEach(([w, h], li) => {
    const ic = mk(w, h), ig = cx(ic);
    ig.imageSmoothingQuality = 'high';
    ig.drawImage(src, R.x, R.y, R.w, R.h, 0, 0, w, h);
    const id = ig.getImageData(0, 0, w, h), d = id.data, hole = holeAt(dil, w, h);
    let off;
    if (!prev) off = inpaintCore(d, hole, w, h);
    else {
      const up = mk(w, h), ug = cx(up);
      ug.imageSmoothingQuality = 'high'; ug.drawImage(prev.c, 0, 0, w, h);
      const ud = ug.getImageData(0, 0, w, h).data;
      for (let i = 0; i < w * h; i++) if (hole[i]) { const j = i * 4; d[j] = ud[j]; d[j + 1] = ud[j + 1]; d[j + 2] = ud[j + 2]; d[j + 3] = ud[j + 3]; }
      off = inpaintRefine(d, hole, w, h, prev, li === sizes.length - 1 ? 1 : 2);
    }
    ig.putImageData(id, 0, 0);
    prev = { c: ic, off, w, h };
  });

  const fill = mk(R.w, R.h), fg = cx(fill);
  fg.imageSmoothingQuality = 'high';
  fg.drawImage(prev.c, 0, 0, R.w, R.h);
  maskInto(fill, blurCanvas(dil, 1.5));
  const out = cloneCanvas(src);
  cx(out).drawImage(fill, R.x, R.y);
  return out;
}

/* Patch sumber valid = seluruh patch (2P+1)² berada di luar lubang */
function srcChecker(hole, w, h, P) {
  const W1 = w + 1, ii = new Int32Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += hole[y * w + x]; ii[(y + 1) * W1 + x + 1] = ii[y * W1 + x + 1] + row; } }
  return (x, y) => {
    if (x < P || y < P || x >= w - P || y >= h - P) return false;
    const x0 = x - P, y0 = y - P, x1 = x + P + 1, y1 = y + P + 1;
    return ii[y1 * W1 + x1] - ii[y0 * W1 + x1] - ii[y1 * W1 + x0] + ii[y0 * W1 + x0] === 0;
  };
}

/* Satu level halus: inisialisasi peta patch dari level kasar (koordinat ×skala), lalu
   iterasi PatchMatch (propagasi tetangga + pencarian acak yang radiusnya menyusut). */
function inpaintRefine(d, hole, w, h, prev, iters) {
  const P = 3, n = w * h, okSrc = srcChecker(hole, w, h, P);
  const off = new Int32Array(n).fill(-1), holes = [];
  for (let i = 0; i < n; i++) if (hole[i]) holes.push(i);
  if (!holes.length) return off;
  const srcList = [];
  for (let y = P; y < h - P; y += 2) for (let x = P; x < w - P; x += 2) if (okSrc(x, y)) srcList.push(y * w + x);
  if (!srcList.length) return off;
  const score = (px, py, c, lim) => {
    const sx = c % w, sy = (c / w) | 0;
    let s = 0;
    for (let dy = -P; dy <= P; dy++) {
      const yy = py + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -P; dx <= P; dx++) {
        const xx = px + dx;
        if (xx < 0 || xx >= w) continue;
        const a = (yy * w + xx) * 4, b = ((sy + dy) * w + sx + dx) * 4;
        const e0 = d[a] - d[b], e1 = d[a + 1] - d[b + 1], e2 = d[a + 2] - d[b + 2];
        s += e0 * e0 + e1 * e1 + e2 * e2;
      }
      if (s >= lim) return s;
    }
    return s;
  };
  const kx = w / prev.w, ky = h / prev.h;
  const best = new Float64Array(n);
  for (const p of holes) {
    const x = p % w, y = (p / w) | 0;
    let c = -1;
    if (prev.off) {
      const qx = Math.min(prev.w - 1, Math.floor(x / kx)), qy = Math.min(prev.h - 1, Math.floor(y / ky)), o = prev.off[qy * prev.w + qx];
      if (o >= 0) {
        const sx = Math.round((o % prev.w) * kx + (x - qx * kx)), sy = Math.round(((o / prev.w) | 0) * ky + (y - qy * ky));
        if (okSrc(sx, sy)) c = sy * w + sx;
      }
    }
    if (c < 0) c = srcList[(Math.random() * srcList.length) | 0];
    off[p] = c; best[p] = score(x, y, c, Infinity);
  }
  const R0 = Math.max(w, h) / 4;
  for (let it = 0; it < iters; it++) {
    const fwd = it % 2 === 0, st = fwd ? -1 : 1;
    for (let k = 0; k < holes.length; k++) {
      const p = holes[fwd ? k : holes.length - 1 - k], x = p % w, y = (p / w) | 0;
      let bc = off[p], bs = best[p];
      const tryC = (sx, sy) => {
        if (!okSrc(sx, sy)) return;
        const c = sy * w + sx;
        if (c === bc) return;
        const s = score(x, y, c, bs);
        if (s < bs) { bs = s; bc = c; }
      };
      // propagasi: tetangga yang sudah diproses menyarankan pergeseran yang sama
      const qx = x + st, qy = y + st;
      if (qx >= 0 && qx < w && off[y * w + qx] >= 0) { const o = off[y * w + qx]; tryC(o % w - st, (o / w) | 0); }
      if (qy >= 0 && qy < h && off[qy * w + x] >= 0) { const o = off[qy * w + x]; tryC(o % w, ((o / w) | 0) - st); }
      for (let r = R0; r >= 1; r /= 2) tryC(((bc % w) + (Math.random() * 2 - 1) * r) | 0, (((bc / w) | 0) + (Math.random() * 2 - 1) * r) | 0);
      off[p] = bc; best[p] = bs;
      const a = p * 4, b2 = bc * 4;
      d[a] = d[b2]; d[a + 1] = d[b2 + 1]; d[a + 2] = d[b2 + 2]; d[a + 3] = d[b2 + 3];
    }
  }
  return off;
}

function inpaintCore(d, hole, w, h) {
  const P = 3, n = w * h, W1 = w + 1;
  const known = new Uint8Array(n);
  for (let i = 0; i < n; i++) known[i] = hole[i] ? 0 : 1;
  const ii = new Int32Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += hole[y * w + x]; ii[(y + 1) * W1 + x + 1] = ii[y * W1 + x + 1] + row; } }
  const okSrc = (x, y) => {
    if (x < P || y < P || x >= w - P || y >= h - P) return false;
    const x0 = x - P, y0 = y - P, x1 = x + P + 1, y1 = y + P + 1;
    return ii[y1 * W1 + x1] - ii[y0 * W1 + x1] - ii[y1 * W1 + x0] + ii[y0 * W1 + x0] === 0;
  };
  const srcList = [];
  for (let y = P; y < h - P; y++) for (let x = P; x < w - P; x++) if (okSrc(x, y)) srcList.push(y * w + x);
  if (!srcList.length) return null;

  const off = new Int32Array(n).fill(-1);
  const DX = [-1, 1, 0, 0, -1, 1, -1, 1], DY = [0, 0, -1, 1, -1, -1, 1, 1];
  const score = (px, py, c) => {
    const cxx = c % w, cyy = (c / w) | 0;
    let s = 0, cnt = 0;
    for (let dy = -P; dy <= P; dy++) {
      const yy = py + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -P; dx <= P; dx++) {
        const xx = px + dx;
        if (xx < 0 || xx >= w) continue;
        const q = yy * w + xx;
        if (!known[q]) continue;
        const a = q * 4, b = ((cyy + dy) * w + cxx + dx) * 4;
        const e0 = d[a] - d[b], e1 = d[a + 1] - d[b + 1], e2 = d[a + 2] - d[b + 2];
        s += e0 * e0 + e1 * e1 + e2 * e2; cnt++;
      }
    }
    return cnt ? s / cnt : 1e12;
  };

  const queued = new Uint8Array(n);
  let front = [];
  for (let i = 0; i < n; i++) {
    if (!hole[i]) continue;
    const x = i % w, y = (i / w) | 0;
    if ((x > 0 && known[i - 1]) || (x < w - 1 && known[i + 1]) || (y > 0 && known[i - w]) || (y < h - 1 && known[i + w])) { front.push(i); queued[i] = 1; }
  }
  const LOCAL = Math.max(20, Math.round(Math.max(w, h) * 0.25));
  while (front.length) {
    for (const p of front) {
      const px = p % w, py = (p / w) | 0;
      let best = -1, bs = Infinity;
      const tryC = (x, y) => {
        if (!okSrc(x, y)) return;
        const c = y * w + x, s = score(px, py, c);
        if (s < bs) { bs = s; best = c; }
      };
      for (let k = 0; k < 8; k++) {
        const qx = px + DX[k], qy = py + DY[k];
        if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
        const o = off[qy * w + qx];
        if (o >= 0) tryC((o % w) - DX[k], ((o / w) | 0) - DY[k]);
      }
      for (let k = 0; k < 14; k++) tryC(px + ((Math.random() * 2 - 1) * LOCAL) | 0, py + ((Math.random() * 2 - 1) * LOCAL) | 0);
      for (let k = 0; k < 10; k++) { const c = srcList[(Math.random() * srcList.length) | 0]; tryC(c % w, (c / w) | 0); }
      if (best >= 0) {
        const a = p * 4, b2 = best * 4;
        d[a] = d[b2]; d[a + 1] = d[b2 + 1]; d[a + 2] = d[b2 + 2]; d[a + 3] = d[b2 + 3];
        off[p] = best;
      }
    }
    for (const p of front) known[p] = 1;
    const next = [];
    for (const p of front) {
      const x = p % w, y = (p / w) | 0;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) if (q >= 0 && hole[q] && !known[q] && !queued[q]) { queued[q] = 1; next.push(q); }
    }
    front = next;
  }
  return off;
}

function contentAwareFill() {
  const l = AL();
  if (!l) return;
  if (!S.sel) { toast('Seleksi dulu objek yang mau dihapus.'); return; }
  if (l.type !== 'pixel') { toast('Pilih layer piksel (rasterize dulu).'); return; }
  busy('Content-Aware Fill…', async () => {
    pushH('Content-Aware Fill');
    l.canvas = inpaintCanvas(l.canvas, S.sel);
    touch(l); refreshLayers();
  });
}
