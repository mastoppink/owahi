'use strict';
/* Seleksi: kombinasi, flood fill, Select Subject (AI), Select and Mask. */

function newSelCanvas() { const c = mk(D.w, D.h), g = cx(c); g.fillStyle = SELC; return [c, g]; }
function selModeFrom(e) {
  if (e.shiftKey && e.altKey) return 'int';
  if (e.shiftKey) return 'add';
  if (e.altKey) return 'sub';
  return S.opt.selMode;
}
function commitSel(c, mode) {
  pushH('Seleksi');
  let r;
  if (mode === 'new' || !S.sel) r = (mode === 'sub' || mode === 'int') ? S.sel : c;
  else {
    r = cloneCanvas(S.sel);
    const g = cx(r);
    g.globalCompositeOperation = mode === 'add' ? 'source-over' : mode === 'sub' ? 'destination-out' : 'destination-in';
    g.drawImage(c, 0, 0);
  }
  S.sel = r;
  selChanged();
}
function selectAll() { if (!D) return; const [c, g] = newSelCanvas(); g.fillRect(0, 0, D.w, D.h); commitSel(c, 'new'); }
function deselect() { if (!D || !S.sel) return; pushH('Batal pilih'); S.sel = null; selChanged(); }
function invertSel() {
  if (!D) return;
  pushH('Balik seleksi');
  const [c, g] = newSelCanvas();
  g.fillRect(0, 0, D.w, D.h);
  if (S.sel) { g.globalCompositeOperation = 'destination-out'; g.drawImage(S.sel, 0, 0); }
  S.sel = c;
  selChanged();
}

/* Flood fill berbasis toleransi warna. win = [x0,y0,x1,y1] untuk membatasi area (Quick Selection). */
function flood(id, x0, y0, tol, contig, win) {
  const w = id.width, h = id.height, d = id.data;
  x0 = Math.floor(x0); y0 = Math.floor(y0);
  if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return null;
  const wx = win ? Math.max(0, Math.floor(win[0])) : 0, wy = win ? Math.max(0, Math.floor(win[1])) : 0;
  const wx2 = win ? Math.min(w, Math.ceil(win[2])) : w, wy2 = win ? Math.min(h, Math.ceil(win[3])) : h;
  const ww = wx2 - wx, wh = wy2 - wy;
  if (ww <= 0 || wh <= 0) return null;
  const m = new Uint8Array(ww * wh);
  const k = (y0 * w + x0) * 4, r0 = d[k], g0 = d[k + 1], b0 = d[k + 2], a0 = d[k + 3];
  const ok = (x, y) => {
    const j = (y * w + x) * 4;
    return Math.abs(d[j] - r0) <= tol && Math.abs(d[j + 1] - g0) <= tol && Math.abs(d[j + 2] - b0) <= tol && Math.abs(d[j + 3] - a0) <= tol;
  };
  if (!contig) {
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) if (ok(x + wx, y + wy)) m[y * ww + x] = 1;
  } else {
    const st = [(y0 - wy) * ww + (x0 - wx)];
    m[st[0]] = 1;
    while (st.length) {
      const i = st.pop(), x = i % ww, y = (i / ww) | 0;
      if (x > 0 && !m[i - 1] && ok(x - 1 + wx, y + wy)) { m[i - 1] = 1; st.push(i - 1); }
      if (x < ww - 1 && !m[i + 1] && ok(x + 1 + wx, y + wy)) { m[i + 1] = 1; st.push(i + 1); }
      if (y > 0 && !m[i - ww] && ok(x + wx, y - 1 + wy)) { m[i - ww] = 1; st.push(i - ww); }
      if (y < wh - 1 && !m[i + ww] && ok(x + wx, y + 1 + wy)) { m[i + ww] = 1; st.push(i + ww); }
    }
  }
  const c = mk(ww, wh), g = cx(c), o = g.createImageData(ww, wh);
  for (let i = 0; i < m.length; i++) if (m[i]) { const j = i * 4; o.data[j] = 59; o.data[j + 1] = 130; o.data[j + 2] = 246; o.data[j + 3] = 255; }
  g.putImageData(o, 0, 0);
  return { c, x: wx, y: wy };
}

function selFromAlpha(a, w, h) {
  const t = mk(w, h), g = cx(t), o = g.createImageData(w, h);
  for (let i = 0, j = 0; i < a.length; i++, j += 4) { o.data[j] = 59; o.data[j + 1] = 130; o.data[j + 2] = 246; o.data[j + 3] = a[i] * 255; }
  g.putImageData(o, 0, 0);
  if (w === D.w && h === D.h) return t;
  const c = mk(D.w, D.h), cg = cx(c);
  cg.imageSmoothingQuality = 'high';
  cg.drawImage(t, 0, 0, D.w, D.h);
  return c;
}
function workScale(max = 1600) { return Math.min(1, max / Math.max(D.w, D.h)); }
function workSize(max) { const s = workScale(max); return [s, Math.max(1, Math.round(D.w * s)), Math.max(1, Math.round(D.h * s))]; }

function featherSel(px) {
  if (!S.sel) return;
  const [s, w, h] = workSize(2000);
  const a = gaussBlur(alphaArray(S.sel, w, h), w, h, px * s);
  pushH('Feather');
  S.sel = selFromAlpha(a, w, h);
  selChanged();
}
function growSel(px) {
  if (!S.sel || !px) return;
  const [s, w, h] = workSize(2000);
  const b = gaussBlur(alphaArray(S.sel, w, h), w, h, Math.abs(px) * s);
  const a = px > 0 ? b.map(v => sstep(0.02, 0.12, v)) : b.map(v => sstep(0.88, 0.98, v));
  pushH(px > 0 ? 'Perluas seleksi' : 'Persempit seleksi');
  S.sel = selFromAlpha(a, w, h);
  selChanged();
}

/* Select Subject: model segmentasi dimuat saat pertama dipakai (butuh internet). */
async function selectSubject() {
  if (!D) return;
  await busy('Memuat model AI & mendeteksi subjek… (pertama kali bisa 10–60 detik)', async () => {
    const mod = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.4.5/+esm');
    const blob = await toBlob(composite());
    const out = await mod.removeBackground(blob);
    const bmp = await createImageBitmap(out);
    const [c, g] = newSelCanvas();
    g.drawImage(bmp, 0, 0, D.w, D.h);
    g.globalCompositeOperation = 'source-in';
    g.fillRect(0, 0, D.w, D.h);
    commitSel(c, 'new');
    toast('Subjek terpilih. Haluskan dengan Select and Mask bila perlu.');
  });
}

/* Guided filter: menyesuaikan tepi seleksi mengikuti detail gambar (rambut, bulu). */
function guided(I, p, w, h, r, eps) {
  const n = I.length, II = new Float32Array(n), IP = new Float32Array(n);
  for (let i = 0; i < n; i++) { II[i] = I[i] * I[i]; IP[i] = I[i] * p[i]; }
  const mI = boxMean(I, w, h, r), mP = boxMean(p, w, h, r), mII = boxMean(II, w, h, r), mIP = boxMean(IP, w, h, r);
  const A = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = mII[i] - mI[i] * mI[i], c = mIP[i] - mI[i] * mP[i];
    A[i] = c / (v + eps); B[i] = mP[i] - A[i] * mI[i];
  }
  const mA = boxMean(A, w, h, r), mB = boxMean(B, w, h, r), q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = clamp(mA[i] * I[i] + mB[i], 0, 1);
  return q;
}

function selectAndMask() {
  if (!D) return;
  if (!S.sel) { toast('Buat seleksi dulu (mis. Quick Selection atau Select Subject).'); return; }
  const p = { radius: 0, smooth: 0, feather: 0, contrast: 0, shift: 0, out: 'sel' };
  const [s, w, h] = workSize(1600);
  const A0 = alphaArray(S.sel, w, h), I = grayArray(composite(), w, h);
  let res = null, tm = 0;
  const compute = () => {
    let a = A0;
    if (p.radius > 0) a = guided(I, a, w, h, Math.max(1, Math.round(p.radius * s)), 1e-3);
    if (p.smooth > 0) a = gaussBlur(a, w, h, p.smooth * s).map(v => sstep(0.35, 0.65, v));
    if (p.shift) { const k = p.shift / 200; a = a.map(v => clamp(v + k, 0, 1)); }
    if (p.contrast) { const k = 1 + p.contrast / 10; a = a.map(v => clamp((v - 0.5) * k + 0.5, 0, 1)); }
    if (p.feather > 0) a = gaussBlur(a, w, h, p.feather * s);
    res = selFromAlpha(a, w, h);
    const out = mk(D.w, D.h), g = cx(out);
    g.fillStyle = '#000'; g.fillRect(0, 0, D.w, D.h);
    g.globalCompositeOperation = 'destination-out'; g.drawImage(res, 0, 0);
    S.selPreview = out;
    requestView();
  };
  const sched = () => { clearTimeout(tm); tm = setTimeout(compute, 120); };
  const sl = (k, label, min, max) => slider(label, p[k], min, max, 1, v => { p[k] = v; sched(); });
  const outSel = el('select', { onchange: e => { p.out = e.target.value; } },
    el('option', { value: 'sel' }, 'Seleksi'), el('option', { value: 'mask' }, 'Mask di layer aktif'), el('option', { value: 'layer' }, 'Layer baru dengan mask'));
  const body = el('div', {},
    el('p', { class: 'muted small' }, 'Area gelap = tidak terpilih. Naikkan "Deteksi tepi" untuk rambut/bulu.'),
    sl('radius', 'Deteksi tepi', 0, 60), sl('smooth', 'Halus', 0, 30), sl('feather', 'Feather', 0, 60),
    sl('contrast', 'Kontras', 0, 100), sl('shift', 'Geser tepi', -100, 100), row('Output', outSel));
  compute();
  modal('Select and Mask', body, () => {
    clearTimeout(tm); compute();
    const l = AL();
    if (p.out === 'sel') commitSel(res, 'new');
    else if (p.out === 'mask') { pushH('Mask dari Select and Mask'); l.mask = res; touch(l); S.editMask = true; refreshAll(); }
    else {
      if (l.type === 'adjust') { toast('Pilih layer gambar.'); return false; }
      pushH('Layer dengan mask');
      const n = dcopy(l); n.id = UID++; n.name = l.name + ' (mask)'; n.mask = res;
      l.visible = false;
      insertLayer(n); refreshAll();
    }
  }, 'Terapkan').then(() => { S.selPreview = null; requestView(); });
}
