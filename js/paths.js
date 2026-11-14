'use strict';
/* Path (vektor Bézier) untuk seleksi presisi.
   Struktur: D.paths = [{ id, name, subs: [{ closed, pts: [{ x, y, ix, iy, ox, oy, corner }] }] }]
   ix/iy = handle masuk, ox/oy = handle keluar (koordinat dokumen). */

let PUID = 1;
const PS = { active: -1, sel: null }; // sel = { s: index sub, p: index titik }

function curPath() { return D && D.paths && PS.active >= 0 ? D.paths[PS.active] : null; }
function mkPt(x, y) { return { x, y, ix: x, iy: y, ox: x, oy: y, corner: false }; }
function ensurePath() {
  if (!D.paths) D.paths = [];
  let p = curPath();
  if (!p) {
    p = { id: PUID++, name: 'Path ' + (D.paths.length + 1), subs: [] };
    D.paths.push(p);
    PS.active = D.paths.length - 1;
    refreshPaths();
  }
  return p;
}

/* ---------- Geometri ---------- */
function traceSub(g, sub, map = (x, y) => [x, y]) {
  const P = sub.pts;
  if (!P.length) return;
  g.moveTo(...map(P[0].x, P[0].y));
  const seg = (a, b) => { const [c1x, c1y] = map(a.ox, a.oy), [c2x, c2y] = map(b.ix, b.iy), [x, y] = map(b.x, b.y); g.bezierCurveTo(c1x, c1y, c2x, c2y, x, y); };
  for (let i = 1; i < P.length; i++) seg(P[i - 1], P[i]);
  if (sub.closed && P.length > 1) { seg(P[P.length - 1], P[0]); g.closePath(); }
}
function tracePath(g, path, map) { g.beginPath(); for (const s of path.subs) traceSub(g, s, map); }
function bez(a, b, t) {
  const u = 1 - t;
  const p = (A, B, C, E) => u * u * u * A + 3 * u * u * t * B + 3 * u * t * t * C + t * t * t * E;
  return [p(a.x, a.ox, b.ix, b.x), p(a.y, a.oy, b.iy, b.y)];
}
/* Titik terdekat pada segmen manapun → { s, i (segmen i→i+1), t, d } */
function nearestSeg(path, x, y) {
  let best = null;
  path.subs.forEach((sub, s) => {
    const P = sub.pts, n = sub.closed ? P.length : P.length - 1;
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      for (let k = 0; k <= 24; k++) {
        const t = k / 24, [px, py] = bez(a, b, t), d = Math.hypot(px - x, py - y);
        if (!best || d < best.d) best = { s, i, t, d };
      }
    }
  });
  return best;
}
/* Sisipkan titik pada segmen tanpa mengubah bentuk kurva (de Casteljau). */
function splitSeg(sub, i, t) {
  const P = sub.pts, a = P[i], b = P[(i + 1) % P.length];
  const L = (p, q) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const p0 = [a.x, a.y], p1 = [a.ox, a.oy], p2 = [b.ix, b.iy], p3 = [b.x, b.y];
  const q0 = L(p0, p1), q1 = L(p1, p2), q2 = L(p2, p3), r0 = L(q0, q1), r1 = L(q1, q2), m = L(r0, r1);
  a.ox = q0[0]; a.oy = q0[1]; b.ix = q2[0]; b.iy = q2[1];
  const np = { x: m[0], y: m[1], ix: r0[0], iy: r0[1], ox: r1[0], oy: r1[1], corner: false };
  P.splice(i + 1, 0, np);
  return i + 1;
}
function pathMap(f) {
  if (!D || !D.paths) return;
  for (const p of D.paths) for (const s of p.subs) for (const q of s.pts) {
    [q.x, q.y] = f(q.x, q.y); [q.ix, q.iy] = f(q.ix, q.iy); [q.ox, q.oy] = f(q.ox, q.oy);
  }
}
function transformPaths(m) { pathMap((x, y) => { const p = m.transformPoint(new DOMPoint(x, y)); return [p.x, p.y]; }); }

/* ---------- Path → seleksi / isi / stroke ---------- */
function pathToSel(mode = 'new', feather = 0, aa = true) {
  const p = curPath();
  if (!p || !p.subs.some(s => s.pts.length > 2)) { toast('Buat path dengan minimal 3 titik dulu.'); return; }
  const [c, g] = newSelCanvas();
  g.imageSmoothingEnabled = aa;
  tracePath(g, p);
  g.fill(p.subs.length > 1 ? 'evenodd' : 'nonzero');
  let sel = c;
  if (!aa) { // tepi keras: ambang alpha 50%
    const id = g.getImageData(0, 0, D.w, D.h), d = id.data;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 128 ? 255 : 0;
    g.putImageData(id, 0, 0);
  }
  if (feather > 0) {
    const [s, w, h] = workSize(2000);
    sel = selFromAlpha(gaussBlur(alphaArray(c, w, h), w, h, feather * s), w, h);
  }
  commitSel(sel, mode);
  toast('Path dijadikan seleksi.');
}
function pathToSelDialog() {
  if (!curPath()) { toast('Belum ada path.'); return; }
  let mode = 'new', feather = 0;
  const aa = el('input', { type: 'checkbox', checked: true });
  const seg = el('div', { class: 'seg' }, ...[['new', 'Baru'], ['add', 'Tambah'], ['sub', 'Kurangi'], ['int', 'Irisan']].map(([v, t]) => {
    const b = el('button', { class: v === mode ? 'on' : '', onclick: () => { mode = v; [...seg.children].forEach(x => x.classList.toggle('on', x === b)); } }, t);
    return b;
  }));
  modal('Path → Seleksi', el('div', {}, row('Mode', seg), slider('Feather', feather, 0, 100, 1, v => { feather = v; }, 'px'), el('label', { class: 'chk' }, aa, 'Anti-alias (tepi halus)')),
    () => pathToSel(S.sel ? mode : 'new', feather, aa.checked), 'Buat seleksi');
}
function pathFill() {
  const p = curPath(), l = AL();
  if (!p) { toast('Belum ada path.'); return; }
  if (!l || l.type !== 'pixel') { toast('Pilih layer piksel.'); return; }
  pushH('Isi path');
  const c = cloneCanvas(l.canvas), g = cx(c);
  g.fillStyle = S.fg; tracePath(g, p); g.fill(p.subs.length > 1 ? 'evenodd' : 'nonzero');
  l.canvas = c; touch(l); refreshLayers();
}
function pathStroke() {
  const p = curPath(), l = AL();
  if (!p) { toast('Belum ada path.'); return; }
  if (!l || l.type !== 'pixel') { toast('Pilih layer piksel.'); return; }
  pushH('Stroke path');
  const c = cloneCanvas(l.canvas), g = cx(c);
  g.strokeStyle = S.fg; g.lineWidth = Math.max(1, S.opt.size / 4); g.lineCap = g.lineJoin = 'round';
  g.globalAlpha = S.opt.opacity;
  tracePath(g, p); g.stroke();
  l.canvas = c; touch(l); refreshLayers();
}

/* ---------- Seleksi → path (lacak kontur + penyederhanaan + kurva halus) ---------- */
function contours(a, w, h) {
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && a[y * w + x] >= 0.5;
  const adj = new Map(), key = (x, y) => x * 2 + ',' + y * 2;
  const link = (p, q) => {
    const kp = key(...p), kq = key(...q);
    if (!adj.has(kp)) adj.set(kp, { p, n: [] });
    if (!adj.has(kq)) adj.set(kq, { p: q, n: [] });
    adj.get(kp).n.push(kq); adj.get(kq).n.push(kp);
  };
  for (let y = -1; y < h; y++) for (let x = -1; x < w; x++) {
    const tl = on(x, y), tr = on(x + 1, y), br = on(x + 1, y + 1), bl = on(x, y + 1);
    const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
    if (c === 0 || c === 15) continue;
    const T = [x + 1, y + 0.5], R = [x + 1.5, y + 1], B = [x + 1, y + 1.5], Lf = [x + 0.5, y + 1];
    const segs = {
      1: [[Lf, B]], 2: [[B, R]], 3: [[Lf, R]], 4: [[T, R]], 5: [[Lf, T], [B, R]], 6: [[T, B]], 7: [[Lf, T]],
      8: [[Lf, T]], 9: [[T, B]], 10: [[T, R], [Lf, B]], 11: [[T, R]], 12: [[Lf, R]], 13: [[B, R]], 14: [[Lf, B]],
    }[c];
    for (const [p, q] of segs) link(p, q);
  }
  const loops = [], seen = new Set();
  for (const [k0] of adj) {
    if (seen.has(k0)) continue;
    const loop = [];
    let prev = null, cur = k0;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const node = adj.get(cur);
      loop.push([node.p[0] - 0.5, node.p[1] - 0.5]);
      const nx = node.n.find(k => k !== prev && !seen.has(k));
      prev = cur; cur = nx;
    }
    if (loop.length > 3) loops.push(loop);
  }
  return loops;
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1], L = Math.hypot(bx - ax, by - ay) || 1;
  let md = -1, mi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((by - ay) * pts[i][0] - (bx - ax) * pts[i][1] + bx * ay - by * ax) / L;
    if (d > md) { md = d; mi = i; }
  }
  if (md <= eps) return [pts[0], pts[pts.length - 1]];
  return rdp(pts.slice(0, mi + 1), eps).slice(0, -1).concat(rdp(pts.slice(mi), eps));
}
function simplifyLoop(loop, eps) {
  // buka loop di titik terjauh dari titik awal agar RDP stabil
  let far = 0, fd = -1;
  for (let i = 0; i < loop.length; i++) { const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]); if (d > fd) { fd = d; far = i; } }
  const a = rdp(loop.slice(0, far + 1), eps), b = rdp(loop.slice(far).concat([loop[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}
function smoothSub(pts, cornerDeg) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const v1 = [p[0] - a[0], p[1] - a[1]], v2 = [b[0] - p[0], b[1] - p[1]];
    const ang = Math.abs(Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1])) * 180 / Math.PI;
    const q = mkPt(p[0], p[1]);
    if (ang < cornerDeg) {
      const tx = (b[0] - a[0]) / 6, ty = (b[1] - a[1]) / 6;
      const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2), tl = Math.hypot(tx, ty) || 1;
      q.ix = p[0] - tx / tl * Math.min(tl, l1 / 3); q.iy = p[1] - ty / tl * Math.min(tl, l1 / 3);
      q.ox = p[0] + tx / tl * Math.min(tl, l2 / 3); q.oy = p[1] + ty / tl * Math.min(tl, l2 / 3);
    } else q.corner = true;
    out.push(q);
  }
  return out;
}
function selToPath(tol = 2) {
  if (!S.sel) { toast('Buat seleksi dulu.'); return; }
  const [s, w, h] = workSize(1200), a = alphaArray(S.sel, w, h);
  const loops = contours(a, w, h);
  const subs = [];
  for (const lp of loops) {
    const simp = simplifyLoop(lp, Math.max(0.4, tol * s));
    if (simp.length < 3) continue;
    let area = 0;
    for (let i = 0; i < simp.length; i++) { const p = simp[i], q = simp[(i + 1) % simp.length]; area += p[0] * q[1] - q[0] * p[1]; }
    if (Math.abs(area / 2) < 6) continue;
    subs.push({ closed: true, pts: smoothSub(simp.map(([x, y]) => [x / s, y / s]), 55) });
  }
  if (!subs.length) { toast('Seleksi terlalu kecil untuk dijadikan path.'); return; }
  pushH('Seleksi → Path');
  if (!D.paths) D.paths = [];
  D.paths.push({ id: PUID++, name: 'Dari seleksi ' + (D.paths.length + 1), subs });
  PS.active = D.paths.length - 1; PS.sel = null;
  refreshPaths(); requestView();
  toast(`Path dibuat: ${subs.length} bagian, ${subs.reduce((n, x) => n + x.pts.length, 0)} titik. Edit dengan tool Pen.`);
}
function selToPathDialog() {
  if (!S.sel) { toast('Buat seleksi dulu.'); return; }
  let tol = 2;
  modal('Seleksi → Path', el('div', {}, slider('Toleransi', tol, 0.5, 10, 0.5, v => { tol = v; }, 'px'),
    el('p', { class: 'muted small' }, 'Kecil = mengikuti tepi lebih rapat (titik lebih banyak). Besar = path lebih sederhana dan halus.')),
  () => selToPath(tol), 'Buat path');
}

/* ---------- Kelola path ---------- */
function newPath() { if (!D) return; pushH('Path baru'); if (!D.paths) D.paths = []; D.paths.push({ id: PUID++, name: 'Path ' + (D.paths.length + 1), subs: [] }); PS.active = D.paths.length - 1; PS.sel = null; setTool('pen'); refreshPaths(); }
function deletePath() {
  const p = curPath();
  if (!p) return;
  pushH('Hapus path');
  D.paths.splice(PS.active, 1);
  PS.active = D.paths.length ? Math.min(PS.active, D.paths.length - 1) : -1; PS.sel = null;
  refreshPaths(); requestView();
}
function deleteAnchor() {
  const p = curPath(), s = PS.sel;
  if (!p || !s || !p.subs[s.s] || !p.subs[s.s].pts[s.p]) return false;
  pushH('Hapus titik');
  const sub = p.subs[s.s];
  if (!sub || !sub.pts[s.p]) { PS.sel = null; return false; }
  sub.pts.splice(s.p, 1);
  if (sub.pts.length < 2) p.subs.splice(s.s, 1);
  else if (sub.pts.length < 3) sub.closed = false;
  PS.sel = null; requestView();
  return true;
}
function finishSub() { PS.sel = null; PS.drawing = null; requestView(); }

function refreshPaths() {
  if (D) scheduleAutosave();
  const box = $('#paths');
  if (!box) return;
  box.innerHTML = '';
  if (!D) return;
  if (!D.paths || !D.paths.length) { box.append(el('p', { class: 'muted small pad' }, 'Belum ada path. Pakai tool Pen (P), atau ubah seleksi jadi path.')); return; }
  D.paths.forEach((p, i) => {
    const n = p.subs.reduce((k, s) => k + s.pts.length, 0);
    const r = el('div', { class: 'layer pathrow' + (i === PS.active ? ' active' : ''), role: 'button', tabindex: '0', 'aria-label': 'Path ' + p.name },
      el('span', { class: 'pico', 'aria-hidden': 'true' }, '✎'), el('span', { class: 'lname' }, p.name), el('span', { class: 'badge' }, n + ' titik'));
    const pick = () => { PS.active = i; PS.sel = null; refreshPaths(); requestView(); };
    r.addEventListener('click', pick);
    r.addEventListener('keydown', e => { if (e.key === 'Enter') pick(); });
    r.addEventListener('dblclick', () => { const nm = prompt('Nama path', p.name); if (nm) { p.name = nm; refreshPaths(); } });
    box.append(r);
  });
}
function renderPathBtns() {
  const b = $('#pathBtns');
  b.innerHTML = '';
  b.append(
    el('button', { class: 'btn', title: 'Path baru', onclick: newPath }, '+ Path'),
    el('button', { class: 'btn primary', title: 'Jadikan seleksi (Enter)', onclick: pathToSelDialog }, '→ Seleksi'),
    el('button', { class: 'btn', title: 'Ubah seleksi jadi path', onclick: selToPathDialog }, 'Seleksi → Path'),
    el('button', { class: 'btn', title: 'Isi path dengan warna depan', onclick: pathFill }, 'Isi'),
    el('button', { class: 'btn', title: 'Stroke path dengan warna depan', onclick: pathStroke }, 'Stroke'),
    el('button', { class: 'btn danger', title: 'Hapus path', onclick: deletePath }, 'Hapus'));
}

/* ---------- Tool Pen ---------- */
TOOLS.pen = {
  hitHandle(p, path, tol) {
    const s = PS.sel;
    if (!s || !path.subs[s.s]) return null;
    const P = path.subs[s.s].pts, cand = [s.p, s.p - 1, s.p + 1];
    for (const i of cand) {
      const q = P[(i + P.length) % P.length];
      if (!q) continue;
      if (Math.hypot(q.ox - p.x, q.oy - p.y) < tol && (q.ox !== q.x || q.oy !== q.y)) return { s: s.s, p: (i + P.length) % P.length, h: 'o' };
      if (Math.hypot(q.ix - p.x, q.iy - p.y) < tol && (q.ix !== q.x || q.iy !== q.y)) return { s: s.s, p: (i + P.length) % P.length, h: 'i' };
    }
    return null;
  },
  hitAnchor(p, path, tol) {
    for (let s = 0; s < path.subs.length; s++) {
      const P = path.subs[s].pts;
      for (let i = 0; i < P.length; i++) if (Math.hypot(P[i].x - p.x, P[i].y - p.y) < tol) return { s, p: i };
    }
    return null;
  },
  down(p, e = {}) {
    pushH('Pen');
    const path = ensurePath(), tol = 9 / S.zoom;
    this.p0 = p; this.mode = null;
    const ctrl = e.ctrlKey || e.metaKey;
    // 1) handle
    const hh = this.hitHandle(p, path, tol);
    if (hh) { this.mode = { handle: hh, brk: e.altKey }; if (e.altKey) path.subs[hh.s].pts[hh.p].corner = true; return; }
    // 2) anchor
    const ha = this.hitAnchor(p, path, tol);
    if (ha) {
      const sub = path.subs[ha.s], q = sub.pts[ha.p];
      const open = PS.drawing === ha.s && !sub.closed;
      if (open && ha.p === 0 && sub.pts.length > 2) { // tutup path
        sub.closed = true; PS.drawing = null; PS.sel = ha;
        this.mode = { pull: ha };
        return;
      }
      PS.sel = ha;
      if (e.altKey) { // ubah jadi sudut, seret untuk menarik kurva baru
        q.ix = q.ox = q.x; q.iy = q.oy = q.y; q.corner = false;
        this.mode = { pull: ha };
        return;
      }
      this.mode = { move: ha, o: dcopy(q) };
      return;
    }
    // 3) Ctrl+seret di garis = pindahkan seluruh sub-path
    const ns = nearestSeg(path, p.x, p.y);
    if (ctrl && ns && ns.d < tol) { this.mode = { moveSub: ns.s, o: dcopy(path.subs[ns.s].pts) }; return; }
    // 4) klik di garis = sisipkan titik
    if (ns && ns.d < tol) {
      const i = splitSeg(path.subs[ns.s], ns.i, ns.t);
      PS.sel = { s: ns.s, p: i };
      this.mode = { move: PS.sel, o: dcopy(path.subs[ns.s].pts[i]) };
      return;
    }
    // 5) titik baru
    let si = PS.drawing;
    if (si == null || !path.subs[si] || path.subs[si].closed) { path.subs.push({ closed: false, pts: [] }); si = path.subs.length - 1; PS.drawing = si; }
    const sub = path.subs[si];
    sub.pts.push(mkPt(p.x, p.y));
    PS.sel = { s: si, p: sub.pts.length - 1 };
    this.mode = { pull: PS.sel };
    refreshPaths();
  },
  move(p, e = {}) {
    const m = this.mode, path = curPath();
    if (!m || !path) return;
    const dx = p.x - this.p0.x, dy = p.y - this.p0.y;
    if (m.pull) { // tarik handle simetris dari anchor
      const q = path.subs[m.pull.s].pts[m.pull.p];
      if (Math.hypot(dx, dy) * S.zoom < 2) return;
      q.ox = p.x; q.oy = p.y; q.ix = 2 * q.x - p.x; q.iy = 2 * q.y - p.y; q.corner = false;
    } else if (m.handle) {
      const q = path.subs[m.handle.s].pts[m.handle.p], o = m.handle.h;
      const ox = o === 'o' ? 'ox' : 'ix', oy = o === 'o' ? 'oy' : 'iy', ax = o === 'o' ? 'ix' : 'ox', ay = o === 'o' ? 'iy' : 'oy';
      q[ox] = p.x; q[oy] = p.y;
      if (!q.corner && !m.brk && !e.altKey) { // jaga handle lawan tetap segaris
        const L = Math.hypot(q[ax] - q.x, q[ay] - q.y), vx = q.x - p.x, vy = q.y - p.y, V = Math.hypot(vx, vy) || 1;
        q[ax] = q.x + vx / V * L; q[ay] = q.y + vy / V * L;
      }
    } else if (m.move) {
      const q = path.subs[m.move.s].pts[m.move.p], o = m.o;
      Object.assign(q, { x: o.x + dx, y: o.y + dy, ix: o.ix + dx, iy: o.iy + dy, ox: o.ox + dx, oy: o.oy + dy });
    } else if (m.moveSub != null) {
      path.subs[m.moveSub].pts = m.o.map(o => ({ ...o, x: o.x + dx, y: o.y + dy, ix: o.ix + dx, iy: o.iy + dy, ox: o.ox + dx, oy: o.oy + dy }));
    }
  },
  up() { this.mode = null; refreshPaths(); },
  overlay(g) {
    const path = curPath();
    if (!path) return;
    const map = (x, y) => sp(x, y);
    tracePath(g, path, map);
    g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 3; g.stroke();
    g.strokeStyle = '#4f8cff'; g.lineWidth = 1.5; g.stroke();
    // garis bantu dari titik terakhir ke kursor saat menggambar
    const ds = PS.drawing != null && path.subs[PS.drawing];
    if (ds && !ds.closed && ds.pts.length && S.hover && !this.mode) {
      const a = ds.pts[ds.pts.length - 1];
      g.beginPath(); g.moveTo(...map(a.x, a.y)); g.bezierCurveTo(...map(a.ox, a.oy), S.hover.sx, S.hover.sy, S.hover.sx, S.hover.sy);
      g.setLineDash([4, 4]); g.strokeStyle = 'rgba(79,140,255,.8)'; g.lineWidth = 1; g.stroke(); g.setLineDash([]);
    }
    const sel = PS.sel;
    path.subs.forEach((sub, s) => sub.pts.forEach((q, i) => {
      const isSel = sel && sel.s === s && sel.p === i;
      const near = sel && sel.s === s && (Math.abs(sel.p - i) === 1 || (sub.closed && Math.abs(sel.p - i) === sub.pts.length - 1));
      if (isSel || near) {
        for (const [hx, hy] of [[q.ix, q.iy], [q.ox, q.oy]]) {
          if (hx === q.x && hy === q.y) continue;
          const [ax, ay] = map(q.x, q.y), [bx, by] = map(hx, hy);
          g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1; g.stroke();
          g.beginPath(); g.arc(bx, by, 3.5, 0, Math.PI * 2); g.fillStyle = '#4f8cff'; g.fill(); g.strokeStyle = '#fff'; g.stroke();
        }
      }
      const [x, y] = map(q.x, q.y);
      g.fillStyle = isSel ? '#4f8cff' : '#fff';
      g.fillRect(x - 3.5, y - 3.5, 7, 7);
      g.strokeStyle = isSel ? '#fff' : '#4f8cff'; g.lineWidth = 1; g.strokeRect(x - 3.5, y - 3.5, 7, 7);
      if (i === 0 && !sub.closed && PS.drawing === s && sub.pts.length > 2 && S.hover && Math.hypot(S.hover.x - q.x, S.hover.y - q.y) < 9 / S.zoom) {
        g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.strokeStyle = '#fff'; g.stroke();
      }
    }));
  },
};
