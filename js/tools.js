'use strict';
/* Tool di kanvas. Tiap tool: down/move/up(p, e), overlay(g), activate/deactivate. */

const TOOL_LIST = [
  ['move', 'Move (V)', 'v'], ['rect', 'Marquee kotak (M)', 'm'], ['ellipse', 'Marquee elips (M)', 'm'],
  ['lasso', 'Lasso (L)', 'l'], ['quick', 'Quick Selection (W)', 'w'], ['wand', 'Magic Wand (W)', 'w'],
  ['crop', 'Crop (C)', 'c'], ['transform', 'Free Transform (F)', 'f'],
  ['brush', 'Brush (B)', 'b'], ['eraser', 'Eraser (E)', 'e'], ['gradient', 'Gradient (G)', 'g'],
  ['clone', 'Clone Stamp (S)', 's'], ['heal', 'Healing Brush (J)', 'j'], ['spot', 'Spot Healing / Remove (J)', 'j'],
  ['text', 'Teks (T)', 't'], ['pen', 'Pen (P)', 'p'], ['eyedropper', 'Pipet warna (I)', 'i'],
  ['hand', 'Hand (H, atau tahan Spasi)', 'h'], ['zoom', 'Zoom (Z)', 'z'],
];
const TOOLS = {};

function setTool(id) {
  const prev = TOOLS[S.tool];
  if (prev && prev.deactivate && S.tool !== id) prev.deactivate();
  S.tool = id;
  const t = TOOLS[id];
  if (D && t.activate) t.activate();
  renderToolbar(); renderOptions(); updateCursor(); requestView();
}
function updateCursor() {
  $('#view').style.cursor = { hand: 'grab', move: 'move', text: 'text', zoom: 'zoom-in' }[S.tool] || 'crosshair';
}

/* helper geometri */
const dist = (p, q) => Math.hypot(p.x - q[0], p.y - q[1]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const centroid = q => [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4];
function inPoly(p, q) {
  let c = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    if ((q[i][1] > p.y) !== (q[j][1] > p.y) && p.x < (q[j][0] - q[i][0]) * (p.y - q[i][1]) / (q[j][1] - q[i][1]) + q[i][0]) c = !c;
  }
  return c;
}
function rectOf(a, b) { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }; }
function antsStroke(g) {
  g.lineWidth = 1;
  g.setLineDash([]); g.strokeStyle = '#000'; g.stroke();
  g.setLineDash([4, 4]); g.strokeStyle = '#fff'; g.stroke();
  g.setLineDash([]);
}

/* ---------- Move ---------- */
TOOLS.move = {
  down(p) {
    const l = AL();
    this.l = null;
    if (!l || l.type === 'adjust') return;
    this.l = l; this.p0 = p;
    pushH('Move');
    if (l.type === 'text') this.o = { x: l.text.x, y: l.text.y };
    else if (l.type === 'smart') this.o = dcopy(l.smart.quad);
    else { this.o = l.canvas; this.om = l.mask; }
  },
  move(p) {
    const l = this.l;
    if (!l) return;
    const dx = Math.round(p.x - this.p0.x), dy = Math.round(p.y - this.p0.y);
    nudgeLayer(l, this.o, this.om, dx, dy);
  },
  up() { if (this.l) refreshLayers(); this.l = null; },
};
function nudgeLayer(l, o, om, dx, dy) {
  if (l.type === 'text') { l.text.x = o.x + dx; l.text.y = o.y + dy; }
  else if (l.type === 'smart') l.smart.quad = o.map(q => [q[0] + dx, q[1] + dy]);
  else { l.canvas = shifted(o, dx, dy); if (om) l.mask = shifted(om, dx, dy); }
  touch(l);
}

/* ---------- Seleksi: marquee & lasso ---------- */
function marquee(shape) {
  return {
    down(p, e) { this.mode = selModeFrom(e); this.a = p; this.b = p; },
    move(p) { this.b = p; },
    up() {
      const r = rectOf(this.a, this.b);
      this.a = null;
      if (r.w < 2 && r.h < 2) { if (this.mode === 'new') deselect(); return; }
      const [c, g] = newSelCanvas();
      if (shape === 'ellipse') { g.beginPath(); g.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); g.fill(); }
      else g.fillRect(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h));
      commitSel(c, this.mode);
    },
    overlay(g) {
      if (!this.a) return;
      const r = rectOf(this.a, this.b), [x, y] = sp(r.x, r.y), w = r.w * S.zoom, h = r.h * S.zoom;
      g.beginPath();
      if (shape === 'ellipse') g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); else g.rect(x + 0.5, y + 0.5, w, h);
      antsStroke(g);
    },
  };
}
TOOLS.rect = marquee('rect');
TOOLS.ellipse = marquee('ellipse');

TOOLS.lasso = {
  down(p, e) { this.mode = selModeFrom(e); this.pts = [p]; },
  move(p) { if (this.pts) this.pts.push(p); },
  up() {
    const pts = this.pts;
    this.pts = null;
    if (!pts || pts.length < 3) return;
    const [c, g] = newSelCanvas();
    g.beginPath();
    pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
    g.closePath(); g.fill();
    commitSel(c, this.mode);
  },
  overlay(g) {
    if (!this.pts) return;
    g.beginPath();
    this.pts.forEach((q, i) => { const [x, y] = sp(q.x, q.y); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    antsStroke(g);
  },
};

/* ---------- Magic Wand & Quick Selection ---------- */
TOOLS.wand = {
  down(p, e) {
    const id = cx(freshComp()).getImageData(0, 0, D.w, D.h);
    const r = flood(id, p.x, p.y, S.opt.tol, S.opt.contig);
    if (!r) return;
    const [c, g] = newSelCanvas();
    g.drawImage(r.c, r.x, r.y);
    commitSel(c, selModeFrom(e));
  },
};
TOOLS.quick = {
  ring: true,
  down(p, e) {
    this.mode = e.altKey ? 'sub' : (S.sel && S.opt.selMode === 'new' && !e.shiftKey ? 'add' : selModeFrom(e));
    this.id = cx(freshComp()).getImageData(0, 0, D.w, D.h);
    this.work = mk(D.w, D.h); this.last = p;
    this.dab(p);
    S.selLive = this.work;
  },
  dab(p) {
    const r = S.opt.size / 2;
    const res = flood(this.id, p.x, p.y, S.opt.tol, true, [p.x - r * 2.5, p.y - r * 2.5, p.x + r * 2.5, p.y + r * 2.5]);
    const g = cx(this.work);
    if (res) g.drawImage(res.c, res.x, res.y);
    g.fillStyle = SELC; g.beginPath(); g.arc(p.x, p.y, Math.max(1, r * 0.25), 0, Math.PI * 2); g.fill();
  },
  move(p) {
    if (!this.work) return;
    const d = Math.hypot(p.x - this.last.x, p.y - this.last.y), sp2 = Math.max(2, S.opt.size / 4);
    if (d < sp2) return;
    const n = Math.floor(d / sp2);
    for (let i = 1; i <= n; i++) this.dab({ x: this.last.x + (p.x - this.last.x) * i / n, y: this.last.y + (p.y - this.last.y) * i / n });
    this.last = p;
  },
  up() {
    if (!this.work) return;
    S.selLive = null;
    commitSel(this.work, this.mode);
    this.work = null; this.id = null;
  },
};

/* ---------- Crop ---------- */
function cropRatio() {
  const v = S.opt.ratio;
  if (v === 'free') return 0;
  if (v === 'orig') return D.w / D.h;
  const [a, b] = v.split(':').map(Number);
  return a / b;
}
TOOLS.crop = {
  activate() { this.r = D ? { x: 0, y: 0, w: D.w, h: D.h } : null; this.fitRatio(); },
  fitRatio() {
    const r = this.r, ra = D && cropRatio();
    if (!r || !ra) return;
    let w = r.w, h = r.w / ra;
    if (h > r.h) { h = r.h; w = h * ra; }
    this.r = { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
    requestView();
  },
  hit(p) {
    const r = this.r, t = 12 / S.zoom, near = (x, y) => Math.abs(p.x - x) < t && Math.abs(p.y - y) < t;
    if (near(r.x, r.y)) return 'nw';
    if (near(r.x + r.w, r.y)) return 'ne';
    if (near(r.x, r.y + r.h)) return 'sw';
    if (near(r.x + r.w, r.y + r.h)) return 'se';
    const full = r.x === 0 && r.y === 0 && r.w === D.w && r.h === D.h;
    if (!full && p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) return 'in';
    return 'new';
  },
  down(p) { if (!this.r) this.activate(); this.mode = this.hit(p); this.r0 = { ...this.r }; this.p0 = p; },
  move(p) {
    const r0 = this.r0;
    if (this.mode === 'in') { this.r = { ...r0, x: r0.x + p.x - this.p0.x, y: r0.y + p.y - this.p0.y }; return; }
    let ax, ay;
    if (this.mode === 'new') { ax = this.p0.x; ay = this.p0.y; }
    else { ax = this.mode[1] === 'w' ? r0.x + r0.w : r0.x; ay = this.mode[0] === 'n' ? r0.y + r0.h : r0.y; }
    let w = Math.abs(p.x - ax), h = Math.abs(p.y - ay);
    const ra = cropRatio();
    if (ra) { if (w / (h || 1e-9) > ra) h = w / ra; else w = h * ra; }
    this.r = { x: p.x < ax ? ax - w : ax, y: p.y < ay ? ay - h : ay, w, h };
  },
  up() { if (this.r.w < 3 || this.r.h < 3) this.activate(); },
  apply() {
    const r = this.r;
    if (!r) return;
    const x = Math.round(r.x), y = Math.round(r.y), w = Math.round(r.w), h = Math.round(r.h);
    if (w < 1 || h < 1) return;
    if (x === 0 && y === 0 && w === D.w && h === D.h) { toast('Seret kotak crop dulu.'); return; }
    docApply(w, h, new DOMMatrix().translate(-x, -y), 'Crop');
    this.activate();
  },
  overlay(g) {
    const r = this.r;
    if (!r) return;
    const [x, y] = sp(r.x, r.y), w = r.w * S.zoom, h = r.h * S.zoom;
    g.save();
    g.fillStyle = 'rgba(0,0,0,.55)';
    g.beginPath(); g.rect(-1e5, -1e5, 3e5, 3e5); g.rect(x, y, w, h); g.fill('evenodd');
    g.strokeStyle = '#fff'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w, h);
    g.strokeStyle = 'rgba(255,255,255,.45)';
    g.beginPath();
    for (let i = 1; i < 3; i++) { g.moveTo(x + w * i / 3, y); g.lineTo(x + w * i / 3, y + h); g.moveTo(x, y + h * i / 3); g.lineTo(x + w, y + h * i / 3); }
    g.stroke();
    g.fillStyle = '#fff';
    for (const [a, b] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) g.fillRect(a - 5, b - 5, 10, 10);
    g.font = '12px system-ui'; g.fillText(Math.round(r.w) + ' × ' + Math.round(r.h), x + 6, y > 20 ? y - 8 : y + 18);
    g.restore();
  },
};

/* ---------- Free Transform (skala, putar, regang, distort/perspektif) ---------- */
let T = null;
function startTransform() {
  const l = AL();
  if (!l || !D) return;
  if (l.type === 'adjust') { toast('Adjustment layer tidak bisa di-transform.'); return; }
  if (l.type === 'text') { toast('Teks: jadikan Smart Object dulu (Layer → Jadikan Smart Object), atau ubah ukuran font.'); return; }
  if (l.type === 'smart') { pushH('Transform'); T = { l, kind: 'smart', quad: dcopy(l.smart.quad) }; requestView(); return; }
  let part = l.canvas, rest = null;
  if (S.sel) {
    part = cloneCanvas(l.canvas); maskInto(part, S.sel);
    rest = cloneCanvas(l.canvas);
    const rg = cx(rest); rg.globalCompositeOperation = 'destination-out'; rg.drawImage(S.sel, 0, 0);
  }
  const b = canvasBounds(part);
  if (!b) { toast(S.sel ? 'Tidak ada piksel di dalam seleksi.' : 'Layer kosong.'); return; }
  pushH('Transform');
  T = { l, kind: 'pixel', src: cropCanvas(part, b), rest, quad: [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]] };
  if (rest) { l.canvas = rest; previewTransform(); }
  requestView();
}
function previewTransform() {
  if (!T) return;
  if (T.kind === 'smart') T.l.smart.quad = T.quad;
  else { const c = T.rest ? cloneCanvas(T.rest) : mk(D.w, D.h); drawQuad(cx(c), T.src, T.quad); T.l.canvas = c; }
  touch(T.l);
}
function commitTransform() {
  if (!T) return;
  T = null;
  refreshLayers(); requestView();
  if (S.tool === 'transform') setTool('move');
}
function cancelTransform() {
  if (!T) return;
  T = null;
  const e = H.past.pop();
  if (e) restore(e.s);
  if (S.tool === 'transform') setTool('move');
}
function tfQuad(f) { if (!T) return; T.quad = f(T.quad); previewTransform(); requestView(); }
function tfRotate90() { tfQuad(q => { const c = centroid(q); return q.map(v => [c[0] - (v[1] - c[1]), c[1] + (v[0] - c[0])]); }); }

TOOLS.transform = {
  activate() { if (!T) startTransform(); },
  deactivate() { if (T) { T = null; refreshLayers(); } },
  down(p) {
    if (!T) { startTransform(); if (!T) return; }
    const q = T.quad, t = 12 / S.zoom;
    this.q0 = dcopy(q); this.p0 = p; this.mode = null;
    for (let i = 0; i < 4 && !this.mode; i++) if (dist(p, q[i]) < t) this.mode = { c: i };
    for (let i = 0; i < 4 && !this.mode; i++) if (dist(p, mid(q[i], q[(i + 1) % 4])) < t) this.mode = { e: i };
    if (!this.mode) this.mode = inPoly(p, q) ? { mv: 1 } : { rot: 1 };
  },
  move(p, e) {
    const q0 = this.q0, m = this.mode;
    if (!m || !T) return;
    const dx = p.x - this.p0.x, dy = p.y - this.p0.y;
    let q;
    if (m.mv) q = q0.map(a => [a[0] + dx, a[1] + dy]);
    else if (m.c !== undefined) {
      const i = m.c;
      if (S.opt.distort || e.ctrlKey || e.metaKey) { q = dcopy(q0); q[i] = [q0[i][0] + dx, q0[i][1] + dy]; }
      else {
        const o = e.altKey ? centroid(q0) : q0[(i + 2) % 4];
        const vx = q0[i][0] - o[0], vy = q0[i][1] - o[1];
        const f = ((p.x - o[0]) * vx + (p.y - o[1]) * vy) / (vx * vx + vy * vy || 1);
        q = q0.map(a => [o[0] + (a[0] - o[0]) * f, o[1] + (a[1] - o[1]) * f]);
      }
    } else if (m.e !== undefined) {
      const i = m.e, j = (i + 1) % 4, nx = -(q0[j][1] - q0[i][1]), ny = q0[j][0] - q0[i][0];
      const s = (dx * nx + dy * ny) / (nx * nx + ny * ny || 1);
      q = dcopy(q0);
      q[i] = [q0[i][0] + nx * s, q0[i][1] + ny * s];
      q[j] = [q0[j][0] + nx * s, q0[j][1] + ny * s];
    } else {
      const c = centroid(q0);
      let a = Math.atan2(p.y - c[1], p.x - c[0]) - Math.atan2(this.p0.y - c[1], this.p0.x - c[0]);
      if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      const co = Math.cos(a), si = Math.sin(a);
      q = q0.map(v => { const x = v[0] - c[0], y = v[1] - c[1]; return [c[0] + x * co - y * si, c[1] + x * si + y * co]; });
    }
    T.quad = q;
    previewTransform();
  },
  up() {},
  overlay(g) {
    if (!T) return;
    const q = T.quad.map(v => sp(v[0], v[1]));
    g.beginPath();
    q.forEach((v, i) => (i ? g.lineTo(v[0], v[1]) : g.moveTo(v[0], v[1])));
    g.closePath();
    g.strokeStyle = '#4f8cff'; g.lineWidth = 1.5; g.stroke();
    const hs = [...q, ...q.map((v, i) => mid(v, q[(i + 1) % 4]))];
    for (const [x, y] of hs) { g.fillStyle = '#fff'; g.fillRect(x - 5, y - 5, 10, 10); g.strokeStyle = '#4f8cff'; g.strokeRect(x - 5, y - 5, 10, 10); }
  },
};

/* ---------- Brush & kawan-kawan ---------- */
function strokeTool(kind) {
  return {
    ring: true,
    down(p, e) {
      if ((kind === 'clone' || kind === 'heal') && e.altKey) { S.cloneSrc = { x: p.x, y: p.y }; S.cloneOff = null; toast('Titik sumber diset.'); return; }
      this.on = beginStroke(kind, p);
    },
    move(p) { if (this.on) strokeTo(p); },
    up() { if (this.on) { this.on = false; endStroke(); } },
    overlay(g) {
      if (kind === 'spot' && ST && ST.kind === 'spot') { g.globalAlpha = 0.5; g.drawImage(ST.stroke, S.panX, S.panY, D.w * S.zoom, D.h * S.zoom); g.globalAlpha = 1; }
      if ((kind === 'clone' || kind === 'heal') && S.hover) {
        let pt = null;
        if (ST && ST.off) pt = { x: S.hover.x + ST.off.x, y: S.hover.y + ST.off.y };
        else if (S.cloneOff) pt = { x: S.hover.x + S.cloneOff.x, y: S.hover.y + S.cloneOff.y };
        else if (S.cloneSrc) pt = S.cloneSrc;
        if (pt) {
          const [x, y] = sp(pt.x, pt.y);
          g.beginPath(); g.moveTo(x - 8, y); g.lineTo(x + 8, y); g.moveTo(x, y - 8); g.lineTo(x, y + 8);
          g.strokeStyle = '#000'; g.lineWidth = 3; g.stroke(); g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke();
        }
      }
    },
  };
}
for (const k of ['brush', 'eraser', 'clone', 'heal', 'spot']) TOOLS[k] = strokeTool(k);

/* ---------- Gradient ---------- */
TOOLS.gradient = {
  down(p) { this.a = p; this.b = p; },
  move(p) { this.b = p; },
  up() {
    const a = this.a, b = this.b;
    this.a = null;
    if (!a || Math.hypot(b.x - a.x, b.y - a.y) < 2) return;
    const l = AL();
    if (!l) return;
    const onMask = S.editMask && l.mask;
    if (!onMask && l.type !== 'pixel') { toast('Pilih layer piksel, atau edit mask (klik thumbnail mask).'); return; }
    pushH('Gradient');
    const t = mk(D.w, D.h), g = cx(t), gr = g.createLinearGradient(a.x, a.y, b.x, b.y);
    if (onMask) { gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); }
    else { gr.addColorStop(0, S.fg); gr.addColorStop(1, S.bg); }
    g.fillStyle = gr; g.fillRect(0, 0, D.w, D.h);
    if (onMask) {
      if (S.sel) {
        maskInto(t, S.sel);
        const keep = cloneCanvas(l.mask), kg = cx(keep);
        kg.globalCompositeOperation = 'destination-out'; kg.drawImage(S.sel, 0, 0);
        g.drawImage(keep, 0, 0);
      }
      l.mask = t;
    } else {
      if (S.sel) maskInto(t, S.sel);
      const c = cloneCanvas(l.canvas), cg = cx(c);
      cg.globalAlpha = S.opt.opacity; cg.drawImage(t, 0, 0);
      l.canvas = c;
    }
    touch(l); refreshLayers();
  },
  overlay(g) {
    if (!this.a) return;
    const [x1, y1] = sp(this.a.x, this.a.y), [x2, y2] = sp(this.b.x, this.b.y);
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2);
    g.strokeStyle = '#000'; g.lineWidth = 3; g.stroke(); g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke();
    for (const [x, y] of [[x1, y1], [x2, y2]]) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); }
  },
};

/* ---------- Teks ---------- */
TOOLS.text = {
  down(p) {
    for (let i = D.layers.length - 1; i >= 0; i--) {
      const l = D.layers[i];
      if (l.type !== 'text' || !l.visible) continue;
      layerContent(l);
      const b = l._bb;
      if (b && p.x >= b.x - 4 && p.x <= b.x + b.w + 4 && p.y >= b.y - 4 && p.y <= b.y + b.h + 4) { selectLayer(i); focusText(); return; }
    }
    pushH('Teks');
    const l = newLayer('text', 'Teks', {
      text: { value: 'Teks baru', x: Math.round(p.x), y: Math.round(p.y), size: Math.max(12, Math.round(D.h / 14)), font: S.opt.font, color: S.fg, bold: true, italic: false, align: 'left', lh: 1.2, spacing: 0 },
    });
    insertLayer(l);
    refreshAll();
    focusText(true);
  },
};
function focusText(selectAllText) {
  setTimeout(() => {
    const t = $('#textEdit');
    if (t) { t.focus(); if (selectAllText) t.select(); }
    if (innerWidth < 820) document.body.classList.add('side-open');
  }, 30);
}

/* ---------- Pipet, Hand, Zoom ---------- */
TOOLS.eyedropper = {
  down(p, e) {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= D.w || y >= D.h) return;
    const d = cx(freshComp()).getImageData(x, y, 1, 1).data, hex = rgb2hex(d[0], d[1], d[2]);
    if (e.altKey) S.bg = hex; else S.fg = hex;
    updateColorUI();
  },
};
TOOLS.hand = {
  down(p) { this.s = { x: S.panX, y: S.panY, sx: p.sx, sy: p.sy }; $('#view').style.cursor = 'grabbing'; },
  move(p) { if (!this.s) return; S.panX = this.s.x + p.sx - this.s.sx; S.panY = this.s.y + p.sy - this.s.sy; },
  up() { this.s = null; updateCursor(); },
};
TOOLS.zoom = { down(p, e) { zoomAt(p.sx, p.sy, e.altKey ? 1 / 1.5 : 1.5); } };
