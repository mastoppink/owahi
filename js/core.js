'use strict';
/* Dokumen, layer, history (undo), compositing, dan tampilan kanvas. */

let D = null;       // dokumen aktif: { w, h, layers: [], active }
let UID = 1;
const SELC = '#3b82f6'; // warna isi kanvas seleksi (yang penting alpha-nya)

const S = {
  tool: 'brush', zoom: 1, panX: 0, panY: 0,
  fg: '#000000', bg: '#ffffff',
  sel: null, selEdge: null, selOut: null, selLive: null, selPreview: null,
  editMask: false, comp: null, compData: null, hover: null, spaceDown: false,
  cloneSrc: null, cloneOff: null, pen: [], fileName: 'gambar',
  opt: {
    size: 40, hard: 0.7, opacity: 1, flow: 1, pressure: true,
    tol: 32, contig: true, selMode: 'new', ratio: 'free', distort: false, sampleAll: false,
    font: 'system-ui, sans-serif',
  },
};

const BLENDS = [
  ['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'],
  ['soft-light', 'Soft Light'], ['hard-light', 'Hard Light'], ['darken', 'Darken'], ['lighten', 'Lighten'],
  ['color-dodge', 'Color Dodge'], ['color-burn', 'Color Burn'], ['difference', 'Difference'],
  ['exclusion', 'Exclusion'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity'],
];

function defStyles() {
  return {
    shadow: { on: false, color: '#000000', opacity: 0.6, blur: 12, dist: 10, angle: 135 },
    stroke: { on: false, color: '#ffffff', size: 4 },
    glow: { on: false, color: '#ffd54a', opacity: 0.8, blur: 20 },
    overlay: { on: false, color: '#ff3366', opacity: 1 },
  };
}
function newLayer(type, name, extra = {}) {
  return Object.assign({
    id: UID++, type, name, visible: true, opacity: 1, blend: 'source-over',
    canvas: null, mask: null, styles: defStyles(), ver: 1,
  }, extra);
}
function AL() { return D ? D.layers[D.active] : null; }
function touch(l) { if (l) l.ver++; requestRender(); scheduleAutosave(); }
function insertLayer(l) { D.layers.splice(D.active + 1, 0, l); D.active++; S.editMask = false; }

function newDoc(w, h, fill, name = 'Latar') {
  D = { w, h, layers: [], active: 0, paths: [], meta: newMeta() };
  PS.active = -1; PS.sel = null; PS.drawing = null;
  const l = newLayer('pixel', name);
  l.canvas = mk(w, h);
  if (fill) { const g = cx(l.canvas); g.fillStyle = fill; g.fillRect(0, 0, w, h); }
  D.layers.push(l);
  S.sel = null; S.cloneSrc = null; S.cloneOff = null; T = null;
  H.past = []; H.future = [];
  selChanged(); fitView(); setTool(S.tool); refreshAll(); scheduleAutosave();
}

/* ---------- History ----------
   Kanvas diperlakukan immutable: operasi selalu membuat kanvas baru,
   jadi snapshot cukup menyimpan referensi (hemat memori). */
const H = { past: [], future: [], key: null, t: 0 };
function dcopy(v) {
  if (v instanceof HTMLCanvasElement) return v;
  if (Array.isArray(v)) return v.map(dcopy);
  if (v && typeof v === 'object') { const o = {}; for (const k in v) if (k[0] !== '_') o[k] = dcopy(v[k]); return o; }
  return v;
}
function snap() { return { w: D.w, h: D.h, active: D.active, sel: S.sel, layers: D.layers.map(dcopy), paths: dcopy(D.paths || []), pathActive: PS.active }; }
function pushH(label, key) {
  if (!D) return;
  const t = performance.now();
  if (key && key === H.key && t - H.t < 1200) { H.t = t; return; } // gabungkan geseran slider beruntun
  H.key = key || null; H.t = t;
  H.past.push({ label, s: snap() });
  markAI(label);
  if (H.past.length > 40) H.past.shift();
  H.future = [];
  updateUndoBtns();
  scheduleAutosave();
}
function restore(s) {
  D.w = s.w; D.h = s.h; S.sel = s.sel;
  D.layers = s.layers.map(dcopy);
  D.paths = dcopy(s.paths || []);
  PS.active = Math.min(s.pathActive ?? -1, D.paths.length - 1); PS.sel = null; PS.drawing = null;
  D.active = Math.min(s.active, D.layers.length - 1);
  T = null;
  if (S.tool === 'crop') TOOLS.crop.activate();
  selChanged(); refreshAll();
}
function undo() {
  if (!D) return;
  if (T) { cancelTransform(); return; }
  if (!H.past.length) return;
  const e = H.past.pop();
  H.future.push({ label: e.label, s: snap() });
  restore(e.s); H.key = null;
  toast('Undo: ' + e.label);
}
function redo() {
  if (!D || !H.future.length) return;
  const e = H.future.pop();
  H.past.push({ label: e.label, s: snap() });
  restore(e.s); H.key = null;
  toast('Redo: ' + e.label);
}

/* ---------- Konten layer ---------- */
function fontStr(t) { return `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${t.size}px ${t.font}`; }
function renderText(l) {
  const t = l.text, c = mk(D.w, D.h), g = cx(c);
  g.font = fontStr(t); g.fillStyle = t.color; g.textBaseline = 'top'; g.textAlign = t.align;
  if ('letterSpacing' in g) g.letterSpacing = (t.spacing || 0) + 'px';
  const lines = t.value.split('\n'), lh = t.size * t.lh;
  let mw = 0;
  lines.forEach((s, i) => { g.fillText(s, t.x, t.y + i * lh); mw = Math.max(mw, g.measureText(s).width); });
  const x0 = t.align === 'center' ? t.x - mw / 2 : t.align === 'right' ? t.x - mw : t.x;
  l._bb = { x: x0, y: t.y, w: mw, h: lines.length * lh };
  l.canvas = c;
}
function renderSmart(l) {
  const s = l.smart, key = JSON.stringify(s.filters);
  if (l._fk !== key || !l._fc) { l._fc = applyFilters(s.src, s.filters); l._fk = key; }
  const c = mk(D.w, D.h);
  drawQuad(cx(c), l._fc, s.quad);
  l.canvas = c;
}
function layerContent(l) {
  if (l.type === 'text') {
    if (l._tv !== l.ver || !l.canvas || l.canvas.width !== D.w || l.canvas.height !== D.h) { renderText(l); l._tv = l.ver; }
  } else if (l.type === 'smart') {
    if (l._sv !== l.ver || !l.canvas) { renderSmart(l); l._sv = l.ver; }
  }
  return l.canvas;
}
function styledLayer(l) {
  const c = layerContent(l);
  if (!c) return null;
  const st = l.styles;
  const any = st.shadow.on || st.stroke.on || st.glow.on || st.overlay.on;
  if (!l.mask && !any) return c;
  if (l._st && l._st.v === l.ver && l._st.c0 === c && l._st.m === l.mask) return l._st.out;
  let base = c;
  if (l.mask) { base = cloneCanvas(c); maskInto(base, l.mask); }
  let out = base;
  if (any) {
    out = mk(D.w, D.h);
    const g = cx(out);
    if (st.glow.on) {
      const s = blurCanvas(silhouette(base, st.glow.color), st.glow.blur);
      g.globalAlpha = st.glow.opacity; g.drawImage(s, 0, 0); g.globalAlpha = 1;
    }
    if (st.shadow.on) {
      const s = blurCanvas(silhouette(base, st.shadow.color), st.shadow.blur);
      const an = st.shadow.angle * Math.PI / 180;
      g.globalAlpha = st.shadow.opacity;
      g.drawImage(s, -Math.cos(an) * st.shadow.dist, Math.sin(an) * st.shadow.dist);
      g.globalAlpha = 1;
    }
    if (st.stroke.on && st.stroke.size > 0) {
      const s = silhouette(base, st.stroke.color), sz = st.stroke.size;
      for (const r of [sz, sz * 0.66, sz * 0.33]) {
        const n = Math.max(8, Math.ceil(r * 2.5));
        for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; g.drawImage(s, Math.cos(a) * r, Math.sin(a) * r); }
      }
    }
    let top = base;
    if (st.overlay.on) {
      top = cloneCanvas(base);
      const tg = cx(top);
      tg.globalCompositeOperation = 'source-atop'; tg.globalAlpha = st.overlay.opacity;
      tg.fillStyle = st.overlay.color; tg.fillRect(0, 0, D.w, D.h);
    }
    g.drawImage(top, 0, 0);
  }
  l._st = { v: l.ver, c0: c, m: l.mask, out };
  return out;
}

/* ---------- Compositing ---------- */
function drawLayer(o, l) {
  const w = D.w, h = D.h;
  if (l.type === 'adjust') {
    const id = o.getImageData(0, 0, w, h);
    if (l.blend === 'source-over') { applyAdjustRun(id, [l], w, h); o.putImageData(id, 0, 0); return; }
    applyAdjust(id, l.adj, w, h);
    const t = mk(w, h);
    cx(t).putImageData(id, 0, 0);
    if (l.mask) maskInto(t, l.mask);
    o.globalAlpha = l.opacity; o.globalCompositeOperation = l.blend;
    o.drawImage(t, 0, 0);
  } else {
    const c = styledLayer(l);
    if (!c) return;
    o.globalAlpha = l.opacity; o.globalCompositeOperation = l.blend;
    o.drawImage(c, 0, 0);
  }
  o.globalAlpha = 1; o.globalCompositeOperation = 'source-over';
}
/* upto = jumlah layer dari bawah yang ikut (default semua).
   Adjustment layer Normal yang berurutan dihitung sekaligus dalam float (lihat applyAdjustRun). */
function composite(upto = D.layers.length) {
  const out = mk(D.w, D.h), o = cx(out), L = D.layers;
  const runnable = l => l.type === 'adjust' && l.blend === 'source-over';
  for (let i = 0; i < upto; i++) {
    const l = L[i];
    if (!l.visible) continue;
    if (runnable(l)) {
      const run = [];
      let j = i;
      for (; j < upto && (!L[j].visible || runnable(L[j])); j++) if (L[j].visible) run.push(L[j]);
      const id = o.getImageData(0, 0, D.w, D.h);
      applyAdjustRun(id, run, D.w, D.h);
      o.putImageData(id, 0, 0);
      i = j - 1;
      continue;
    }
    drawLayer(o, l);
  }
  return out;
}
function freshComp() { S.comp = composite(); S.compData = null; S.clipC = null; if (S.hists && S.hists.length) updateHists(); return S.comp; }

/* Peringatan clipping: merah = highlight terpotong (≥254), biru = shadow terpotong (≤1) */
function clipOverlay() {
  if (S.clipC) return S.clipC;
  const d = compData().data, o = new ImageData(D.w, D.h), od = o.data;
  for (let j = 0; j < d.length; j += 4) {
    if (d[j + 3] < 8) continue;
    const mx = Math.max(d[j], d[j + 1], d[j + 2]), mn = Math.min(d[j], d[j + 1], d[j + 2]);
    if (mx >= 254) { od[j] = 255; od[j + 1] = 30; od[j + 2] = 60; od[j + 3] = 255; }
    else if (mn <= 1 && mx <= 3) { od[j] = 30; od[j + 1] = 120; od[j + 2] = 255; od[j + 3] = 255; }
  }
  S.clipC = mk(D.w, D.h); cx(S.clipC).putImageData(o, 0, 0);
  return S.clipC;
}
function compData() { return S.compData || (S.compData = cx(S.comp).getImageData(0, 0, D.w, D.h)); }

let rq = 0, vq = 0;
function requestRender() {
  if (!rq) rq = requestAnimationFrame(() => { rq = 0; if (D) freshComp(); drawView(); });
}
function requestView() {
  if (!vq) vq = requestAnimationFrame(() => { vq = 0; drawView(); });
}

/* ---------- Seleksi (tampilan) ---------- */
function selChanged() {
  S.selEdge = S.selOut = null;
  if (!S.sel || !D) { requestView(); return; }
  const w = D.w, h = D.h, a = cx(S.sel).getImageData(0, 0, w, h).data;
  const e = new ImageData(w, h), ed = e.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (a[i * 4 + 3] < 128) continue;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
      a[(i - 1) * 4 + 3] < 128 || a[(i + 1) * 4 + 3] < 128 || a[(i - w) * 4 + 3] < 128 || a[(i + w) * 4 + 3] < 128) {
      const j = i * 4; ed[j] = ed[j + 1] = ed[j + 2] = ed[j + 3] = 255;
    }
  }
  S.selEdge = mk(w, h); cx(S.selEdge).putImageData(e, 0, 0);
  S.selOut = mk(w, h);
  const g = cx(S.selOut);
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-out'; g.drawImage(S.sel, 0, 0);
  requestView();
}

/* ---------- Transform proyektif (perspektif / distort) ---------- */
function solveH(src, dst) {
  const A = [], B = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [B[c], B[p]] = [B[p], B[c]];
    const piv = A[c][c] || 1e-12;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / piv;
      if (!f) continue;
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      B[r] -= f * B[c];
    }
  }
  const h = B.map((b, i) => b / (A[i][i] || 1e-12));
  h.push(1);
  return h;
}
function hApply(h, x, y) { const w = h[6] * x + h[7] * y + 1; return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]; }
function drawTri(g, img, s0, s1, s2, d0, d1, d2) {
  const mx = (d0[0] + d1[0] + d2[0]) / 3, my = (d0[1] + d1[1] + d2[1]) / 3;
  const ex = p => { const dx = p[0] - mx, dy = p[1] - my, l = Math.hypot(dx, dy) || 1; return [p[0] + dx / l * 0.8, p[1] + dy / l * 0.8]; };
  const x1 = s1[0] - s0[0], y1 = s1[1] - s0[1], x2 = s2[0] - s0[0], y2 = s2[1] - s0[1];
  const det = x1 * y2 - x2 * y1;
  if (!det) return;
  const X1 = d1[0] - d0[0], Y1 = d1[1] - d0[1], X2 = d2[0] - d0[0], Y2 = d2[1] - d0[1];
  const a = (X1 * y2 - X2 * y1) / det, b = (X2 * x1 - X1 * x2) / det;
  const c = (Y1 * y2 - Y2 * y1) / det, d = (Y2 * x1 - Y1 * x2) / det;
  const e = d0[0] - a * s0[0] - b * s0[1], f = d0[1] - c * s0[0] - d * s0[1];
  const e0 = ex(d0), e1 = ex(d1), e2 = ex(d2);
  const sx = Math.max(0, Math.floor(Math.min(s0[0], s1[0], s2[0]) - 2)), sy = Math.max(0, Math.floor(Math.min(s0[1], s1[1], s2[1]) - 2));
  const sw = Math.min(img.width, Math.ceil(Math.max(s0[0], s1[0], s2[0]) + 2)) - sx, sh = Math.min(img.height, Math.ceil(Math.max(s0[1], s1[1], s2[1]) + 2)) - sy;
  if (sw <= 0 || sh <= 0) return;
  g.save();
  g.beginPath(); g.moveTo(e0[0], e0[1]); g.lineTo(e1[0], e1[1]); g.lineTo(e2[0], e2[1]); g.closePath(); g.clip();
  g.setTransform(a, c, b, d, e, f);
  g.drawImage(img, sx, sy, sw, sh, sx, sy, sw, sh);
  g.restore();
}
function drawQuad(g, img, q) {
  const w = img.width, h = img.height;
  g.imageSmoothingQuality = 'high';
  const affine = Math.abs(q[0][0] + q[2][0] - q[1][0] - q[3][0]) < 0.5 && Math.abs(q[0][1] + q[2][1] - q[1][1] - q[3][1]) < 0.5;
  if (affine) {
    g.save();
    g.setTransform((q[1][0] - q[0][0]) / w, (q[1][1] - q[0][1]) / w, (q[3][0] - q[0][0]) / h, (q[3][1] - q[0][1]) / h, q[0][0], q[0][1]);
    g.drawImage(img, 0, 0);
    g.restore();
    return;
  }
  const Hm = solveH([[0, 0], [w, 0], [w, h], [0, h]], q), N = 14;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u0 = i * w / N, u1 = (i + 1) * w / N, v0 = j * h / N, v1 = (j + 1) * h / N;
    const p00 = hApply(Hm, u0, v0), p10 = hApply(Hm, u1, v0), p11 = hApply(Hm, u1, v1), p01 = hApply(Hm, u0, v1);
    drawTri(g, img, [u0, v0], [u1, v0], [u1, v1], p00, p10, p11);
    drawTri(g, img, [u0, v0], [u1, v1], [u0, v1], p00, p11, p01);
  }
}

/* ---------- View ---------- */
let checkerPat = null;
function sp(x, y) { return [x * S.zoom + S.panX, y * S.zoom + S.panY]; }
function drawView() {
  const v = $('#view'), st = $('#stage'), dpr = devicePixelRatio || 1;
  const W = st.clientWidth, Hh = st.clientHeight;
  if (v.width !== Math.round(W * dpr) || v.height !== Math.round(Hh * dpr)) {
    v.width = Math.round(W * dpr); v.height = Math.round(Hh * dpr);
    v.style.width = W + 'px'; v.style.height = Hh + 'px';
  }
  const g = v.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#141518'; g.fillRect(0, 0, W, Hh);
  $('#empty').hidden = !!D;
  updateStatus();
  if (!D) return;
  const z = S.zoom, x = S.panX, y = S.panY, w = D.w * z, h = D.h * z;
  if (!checkerPat) {
    const c = mk(16, 16), cg = cx(c);
    cg.fillStyle = '#d9d9d9'; cg.fillRect(0, 0, 16, 16);
    cg.fillStyle = '#ffffff'; cg.fillRect(0, 0, 8, 8); cg.fillRect(8, 8, 8, 8);
    checkerPat = g.createPattern(c, 'repeat');
  }
  g.fillStyle = checkerPat; g.fillRect(x, y, w, h);
  g.imageSmoothingEnabled = z < 2; g.imageSmoothingQuality = 'high';
  if (S.comp) g.drawImage(S.comp, x, y, w, h);
  if (S.comp && S.clip) g.drawImage(clipOverlay(), x, y, w, h);
  g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 1; g.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);

  if (S.selPreview) {
    g.globalAlpha = 0.78; g.drawImage(S.selPreview, x, y, w, h); g.globalAlpha = 1;
  } else if (S.sel && S.selOut) {
    g.globalAlpha = 0.4; g.drawImage(S.selOut, x, y, w, h); g.globalAlpha = 1;
    g.imageSmoothingEnabled = false;
    g.globalCompositeOperation = 'difference'; g.drawImage(S.selEdge, x, y, w, h);
    g.globalCompositeOperation = 'source-over';
  }
  if (S.selLive) { g.globalAlpha = 0.35; g.drawImage(S.selLive, x, y, w, h); g.globalAlpha = 1; }
  g.imageSmoothingEnabled = true;

  const t = TOOLS[S.tool];
  if (t && t.overlay) t.overlay(g);
  if (S.hover && t && t.ring) {
    const r = Math.max(1, S.opt.size / 2 * z);
    g.beginPath(); g.arc(S.hover.sx, S.hover.sy, r, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 3; g.stroke();
    g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke();
  }
}
function updateStatus() {
  const s = $('#status');
  if (!D) { s.textContent = ''; return; }
  let t = Math.round(S.zoom * 100) + '%  ·  ' + D.w + '×' + D.h + ' px';
  if (S.hover) t += '  ·  ' + Math.floor(S.hover.x) + ', ' + Math.floor(S.hover.y);
  s.textContent = t;
}
function fitView() {
  const st = $('#stage');
  if (!D) return;
  const W = st.clientWidth, Hh = st.clientHeight;
  S.zoom = Math.max(0.02, Math.min((W - 48) / D.w, (Hh - 48) / D.h, 1));
  S.panX = (W - D.w * S.zoom) / 2; S.panY = (Hh - D.h * S.zoom) / 2;
  requestView();
}
function zoomAt(sx, sy, f) {
  const z = clamp(S.zoom * f, 0.02, 32);
  const x = (sx - S.panX) / S.zoom, y = (sy - S.panY) / S.zoom;
  S.zoom = z; S.panX = sx - x * z; S.panY = sy - y * z;
  requestView();
}
function zoomCenter(f) { const st = $('#stage'); zoomAt(st.clientWidth / 2, st.clientHeight / 2, f); }
function zoom100() { const st = $('#stage'); zoomAt(st.clientWidth / 2, st.clientHeight / 2, 1 / S.zoom); }
