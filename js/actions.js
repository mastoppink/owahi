'use strict';
/* Perintah: file, dokumen, layer, seleksi, filter, AI. */

/* ---------- File ---------- */
function openFile(asLayer) {
  const inp = $('#fileIn');
  inp.value = '';
  inp.onchange = () => { const f = inp.files[0]; if (f) handleImageFile(f, asLayer && !!D); };
  inp.click();
}
async function handleImageFile(f, asLayer) {
  if (/\.lapis$|\.json$/i.test(f.name)) { loadProjectFile(f); return; }
  await busy('Membuka…', async () => {
    const img = await fileToImg(f);
    const name = f.name.replace(/\.[^.]+$/, '');
    if (asLayer && D) addImageLayer(img, name); else openImageAsDoc(img, name);
  });
}
function openImageAsDoc(img, name = 'gambar') {
  let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const MAX = 40e6;
  if (w * h > MAX) { const s = Math.sqrt(MAX / (w * h)); w = Math.round(w * s); h = Math.round(h * s); toast('Foto sangat besar, diperkecil ke ' + w + '×' + h + ' agar lancar.'); }
  newDoc(w, h, null, name);
  cx(D.layers[0].canvas).drawImage(img, 0, 0, w, h);
  S.fileName = name;
  touch(D.layers[0]); refreshAll();
}
function addImageLayer(img, name = 'Gambar') {
  pushH('Tambah gambar');
  const l = newLayer('pixel', name);
  l.canvas = mk(D.w, D.h);
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.min(1, D.w / iw, D.h / ih), w = iw * s, h = ih * s;
  cx(l.canvas).drawImage(img, (D.w - w) / 2, (D.h - h) / 2, w, h);
  insertLayer(l); refreshAll();
}

function ser(v) {
  if (v instanceof HTMLCanvasElement) return { __c: v.toDataURL('image/png') };
  if (Array.isArray(v)) return v.map(ser);
  if (v && typeof v === 'object') { const o = {}; for (const k in v) if (k[0] !== '_') o[k] = ser(v[k]); return o; }
  return v;
}
async function deser(v) {
  if (Array.isArray(v)) return Promise.all(v.map(deser));
  if (v && typeof v === 'object') {
    if (v.__c) { const i = await loadImg(v.__c); const c = mk(i.naturalWidth, i.naturalHeight); cx(c).drawImage(i, 0, 0); return c; }
    const o = {};
    for (const k in v) o[k] = await deser(v[k]);
    return o;
  }
  return v;
}
function saveProject() {
  if (!D) return;
  busy('Menyimpan proyek…', async () => {
    const layers = D.layers.map(l => ser(l.type === 'text' || l.type === 'smart' ? { ...l, canvas: null } : l));
    const data = { app: 'lapis', v: 1, w: D.w, h: D.h, active: D.active, layers, paths: D.paths || [] };
    download(new Blob([JSON.stringify(data)], { type: 'application/json' }), (S.fileName || 'proyek') + '.lapis');
  });
}
function openProject() {
  const inp = $('#projIn');
  inp.value = '';
  inp.onchange = () => { if (inp.files[0]) loadProjectFile(inp.files[0]); };
  inp.click();
}
function loadProjectFile(f) {
  busy('Membuka proyek…', async () => {
    const data = JSON.parse(await f.text());
    if (data.app !== 'lapis') throw new Error('Bukan file proyek Lapis');
    const layers = await deser(data.layers);
    for (const l of layers) l.styles = Object.assign(defStyles(), l.styles || {});
    D = { w: data.w, h: data.h, layers, active: Math.min(data.active || 0, layers.length - 1), paths: data.paths || [] };
    PUID = Math.max(0, ...D.paths.map(p => p.id || 0)) + 1;
    PS.active = D.paths.length - 1; PS.sel = null; PS.drawing = null;
    UID = Math.max(0, ...layers.map(l => l.id || 0)) + 1;
    S.sel = null; T = null; H.past = []; H.future = [];
    S.fileName = f.name.replace(/\.[^.]+$/, '');
    selChanged(); fitView(); setTool(S.tool); refreshAll();
  });
}

function exportDialog() {
  if (!D) return;
  const fmt = el('select', {}, el('option', { value: 'image/jpeg' }, 'JPG'), el('option', { value: 'image/png' }, 'PNG (transparan)'), el('option', { value: 'image/webp' }, 'WebP'));
  let q = 90, sc = 100;
  const body = el('div', {}, row('Format', fmt),
    slider('Kualitas', q, 10, 100, 1, v => { q = v; }, '%'),
    slider('Skala', sc, 5, 100, 1, v => { sc = v; }, '%'),
    el('p', { class: 'muted small' }, 'Kualitas hanya berlaku untuk JPG dan WebP.'));
  modal('Export gambar', body, async () => {
    await busy('Mengekspor…', async () => {
      const comp = composite(), w = Math.max(1, Math.round(D.w * sc / 100)), h = Math.max(1, Math.round(D.h * sc / 100));
      const c = mk(w, h), g = cx(c);
      if (fmt.value === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
      g.imageSmoothingQuality = 'high';
      g.drawImage(comp, 0, 0, w, h);
      const blob = await toBlob(c, fmt.value, q / 100);
      download(blob, (S.fileName || 'gambar') + '-edit.' + { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[fmt.value]);
    });
  }, 'Export');
}

function newDocDialog() {
  const w = el('input', { type: 'number', value: 1920, min: 1, max: 12000 }), h = el('input', { type: 'number', value: 1080, min: 1, max: 12000 });
  const bg = el('select', {}, el('option', { value: '#ffffff' }, 'Putih'), el('option', { value: '#000000' }, 'Hitam'), el('option', { value: '' }, 'Transparan'));
  modal('Dokumen baru', el('div', {}, row('Lebar (px)', w), row('Tinggi (px)', h), row('Latar', bg)), () => {
    const W = clamp(+w.value | 0, 1, 12000), Hh = clamp(+h.value | 0, 1, 12000);
    S.fileName = 'tanpa-judul';
    newDoc(W, Hh, bg.value || null);
  }, 'Buat');
}

/* ---------- Transformasi dokumen (crop, putar, flip, resize) ---------- */
function docApply(nw, nh, m, label) {
  pushH(label);
  const tc = c => { if (!c) return c; const n = mk(nw, nh), g = cx(n); g.imageSmoothingQuality = 'high'; g.setTransform(m); g.drawImage(c, 0, 0); return n; };
  transformPaths(m);
  const uniform = m.b === 0 && m.c === 0 && m.a > 0 && Math.abs(m.a - m.d) < 1e-9;
  let rasterized = false;
  for (const l of D.layers) {
    if (l.type === 'text') {
      if (uniform) { l.text.x = l.text.x * m.a + m.e; l.text.y = l.text.y * m.d + m.f; l.text.size = Math.max(1, l.text.size * m.a); }
      else { rasterizeLayer(l); rasterized = true; }
    }
    if (l.type === 'pixel') l.canvas = tc(l.canvas);
    if (l.type === 'smart') l.smart.quad = l.smart.quad.map(q => { const p = m.transformPoint(new DOMPoint(q[0], q[1])); return [p.x, p.y]; });
    if (l.mask) l.mask = tc(l.mask);
    l.ver++;
  }
  if (S.sel) S.sel = tc(S.sel);
  D.w = nw; D.h = nh;
  if (rasterized) toast('Layer teks diubah jadi piksel karena diputar/dibalik.');
  selChanged(); fitView(); refreshAll();
}
function docRotate(deg) {
  if (!D) return;
  const w = D.w, h = D.h, nw = Math.abs(deg) === 90 ? h : w, nh = Math.abs(deg) === 90 ? w : h;
  docApply(nw, nh, new DOMMatrix().translate(nw / 2, nh / 2).rotate(deg).translate(-w / 2, -h / 2), 'Putar');
}
function straighten(deg) {
  if (!D || !deg) return;
  const w = D.w, h = D.h, a = Math.abs(deg) * Math.PI / 180;
  // perbesar sedikit agar tidak ada sudut kosong
  const s = Math.cos(a) + Math.max(w / h, h / w) * Math.sin(a);
  docApply(w, h, new DOMMatrix().translate(w / 2, h / 2).rotate(deg).scale(s).translate(-w / 2, -h / 2), 'Luruskan');
}
function docFlip(horiz) {
  if (!D) return;
  const m = horiz ? new DOMMatrix().translate(D.w, 0).scale(-1, 1) : new DOMMatrix().translate(0, D.h).scale(1, -1);
  docApply(D.w, D.h, m, 'Balik');
}
function resizeDialog() {
  if (!D) return;
  const w = el('input', { type: 'number', value: D.w, min: 1, max: 12000 }), h = el('input', { type: 'number', value: D.h, min: 1, max: 12000 });
  const lock = el('input', { type: 'checkbox', checked: true }), ra = D.w / D.h;
  w.oninput = () => { if (lock.checked) h.value = Math.round(+w.value / ra); };
  h.oninput = () => { if (lock.checked) w.value = Math.round(+h.value * ra); };
  modal('Ukuran gambar', el('div', {}, row('Lebar (px)', w), row('Tinggi (px)', h), el('label', { class: 'chk' }, lock, 'Kunci rasio')), () => {
    const W = clamp(+w.value | 0, 1, 12000), Hh = clamp(+h.value | 0, 1, 12000);
    if (W === D.w && Hh === D.h) return;
    docApply(W, Hh, new DOMMatrix().scale(W / D.w, Hh / D.h), 'Ubah ukuran');
  });
}

/* ---------- Layer ---------- */
function selectLayer(i) { if (T) commitTransform(); D.active = i; S.editMask = false; refreshAll(); }
function addEmptyLayer() {
  if (!D) return;
  pushH('Layer baru');
  const l = newLayer('pixel', 'Layer ' + (D.layers.length + 1));
  l.canvas = mk(D.w, D.h);
  insertLayer(l); refreshAll();
}
function duplicateLayer() {
  const l = AL();
  if (!l) return;
  pushH('Duplikat');
  let n;
  if (S.sel && l.type === 'pixel') { n = newLayer('pixel', l.name + ' (seleksi)'); n.canvas = cloneCanvas(l.canvas); maskInto(n.canvas, S.sel); }
  else { n = dcopy(l); n.id = UID++; n.name = l.name + ' salinan'; }
  insertLayer(n); refreshAll();
}
function deleteLayer() {
  if (!D) return;
  if (D.layers.length < 2) { toast('Minimal harus ada satu layer.'); return; }
  pushH('Hapus layer');
  D.layers.splice(D.active, 1);
  D.active = Math.max(0, D.active - 1);
  S.editMask = false; refreshAll();
}
function whiteMask() { const c = mk(D.w, D.h), g = cx(c); g.fillStyle = '#fff'; g.fillRect(0, 0, D.w, D.h); return c; }
function addMask() {
  const l = AL();
  if (!l) return;
  if (l.mask) { S.editMask = true; refreshAll(); return; }
  pushH('Tambah mask');
  l.mask = S.sel ? cloneCanvas(S.sel) : whiteMask();
  S.editMask = true; touch(l); refreshAll();
  toast('Mask aktif: lukis hitam untuk menyembunyikan, putih untuk menampilkan.');
}
function maskFromSel() {
  const l = AL();
  if (!l) return;
  if (!S.sel) { toast('Buat seleksi dulu.'); return; }
  pushH('Mask dari seleksi');
  l.mask = cloneCanvas(S.sel); touch(l); refreshAll();
}
function invertMask() {
  const l = AL();
  if (!l || !l.mask) return;
  pushH('Invert mask');
  const c = whiteMask(), g = cx(c);
  g.globalCompositeOperation = 'destination-out'; g.drawImage(l.mask, 0, 0);
  l.mask = c; touch(l); refreshAll();
}
function applyMask() {
  const l = AL();
  if (!l || !l.mask) return;
  if (l.type !== 'pixel') { toast('Hanya untuk layer piksel (rasterize dulu).'); return; }
  pushH('Terapkan mask');
  const c = cloneCanvas(l.canvas); maskInto(c, l.mask);
  l.canvas = c; l.mask = null; S.editMask = false; touch(l); refreshAll();
}
function removeMask() {
  const l = AL();
  if (!l || !l.mask) return;
  pushH('Hapus mask');
  l.mask = null; S.editMask = false; touch(l); refreshAll();
}
function addAdjust(kind) {
  if (!D) return;
  pushH(ADJ[kind].name);
  const l = newLayer('adjust', ADJ[kind].name, { adj: Object.assign({ kind }, ADJ[kind].def()) });
  if (S.sel) l.mask = cloneCanvas(S.sel);
  insertLayer(l); refreshAll();
  if (innerWidth < 820) document.body.classList.add('side-open');
}
function toSmart() {
  const l = AL();
  if (!l) return;
  if (l.type === 'smart') { toast('Sudah Smart Object.'); return; }
  if (l.type === 'adjust') { toast('Adjustment layer tidak bisa dijadikan Smart Object.'); return; }
  const c = layerContent(l), b = canvasBounds(c);
  if (!b) { toast('Layer kosong.'); return; }
  pushH('Smart Object');
  l.smart = { src: cropCanvas(c, b), quad: [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]], filters: [] };
  delete l.text;
  l.type = 'smart'; l.canvas = null;
  touch(l); refreshAll();
  toast('Smart Object: transform dan filter tidak merusak kualitas asli.');
}
function rasterizeLayer(l) {
  if (l.type === 'pixel' || l.type === 'adjust') return;
  l.canvas = cloneCanvas(layerContent(l));
  delete l.text; delete l.smart;
  l.type = 'pixel';
}
function rasterize() {
  const l = AL();
  if (!l || l.type === 'pixel') return;
  if (l.type === 'adjust') { toast('Pakai "Gabung ke bawah" untuk menerapkan adjustment.'); return; }
  pushH('Rasterize'); rasterizeLayer(l); touch(l); refreshAll();
}
function mergeDown() {
  if (!D || D.active === 0) return;
  const top = D.layers[D.active], bot = D.layers[D.active - 1];
  if (bot.type === 'adjust') { toast('Layer di bawahnya adjustment; tidak bisa digabung.'); return; }
  pushH('Gabung ke bawah');
  const c = mk(D.w, D.h), g = cx(c);
  if (bot.visible) { g.globalAlpha = bot.opacity; g.drawImage(styledLayer(bot), 0, 0); g.globalAlpha = 1; }
  if (top.visible) drawLayer(g, top);
  const n = newLayer('pixel', bot.name);
  n.canvas = c;
  D.layers.splice(D.active - 1, 2, n);
  D.active--; S.editMask = false; refreshAll();
}
function flatten() {
  if (!D) return;
  pushH('Ratakan');
  const n = newLayer('pixel', 'Latar');
  n.canvas = composite();
  D.layers = [n]; D.active = 0; S.editMask = false; refreshAll();
}

/* ---------- Isi / hapus seleksi ---------- */
function editTarget() {
  const l = AL();
  if (!l) return null;
  if (S.editMask && l.mask) return { l, key: 'mask', mask: true };
  if (l.type !== 'pixel') { toast('Pilih layer piksel atau edit mask.'); return null; }
  return { l, key: 'canvas', mask: false };
}
function fillSel() {
  const t = editTarget();
  if (!t) return;
  pushH('Isi');
  const c = cloneCanvas(t.l[t.key]), g = cx(c), f = mk(D.w, D.h), fg = cx(f);
  fg.fillStyle = t.mask ? '#fff' : S.fg; fg.fillRect(0, 0, D.w, D.h);
  if (S.sel) maskInto(f, S.sel);
  if (t.mask && lum(S.fg) < 128) g.globalCompositeOperation = 'destination-out';
  g.drawImage(f, 0, 0);
  t.l[t.key] = c; touch(t.l); refreshLayers();
}
function clearSel() {
  if (!S.sel) { toast('Tidak ada seleksi.'); return; }
  const t = editTarget();
  if (!t) return;
  pushH('Hapus isi');
  const c = cloneCanvas(t.l[t.key]), g = cx(c);
  g.globalCompositeOperation = 'destination-out'; g.drawImage(S.sel, 0, 0);
  t.l[t.key] = c; touch(t.l); refreshLayers();
}

/* ---------- Filter ---------- */
async function filterCmd(kind) {
  const l = AL();
  if (!l) return;
  if (l.type === 'adjust' || l.type === 'text') { toast('Pilih layer piksel atau Smart Object.'); return; }
  const F = FILTERS[kind];
  let amount = F.def || 0;
  if (F.max && !await modal(F.name, slider(F.name, amount, F.min, F.max, 1, v => { amount = v; }, F.unit), null, 'Terapkan')) return;
  if (l.type === 'smart') { pushH('Smart filter'); l.smart.filters.push({ kind, amount, on: true }); touch(l); refreshAll(); return; }
  await busy('Menerapkan ' + F.name + '…', async () => {
    pushH(F.name);
    let f = applyFilter(l.canvas, { kind, amount });
    if (S.sel) {
      const keep = cloneCanvas(l.canvas), k = cx(keep);
      maskInto(f, S.sel);
      k.globalCompositeOperation = 'destination-out'; k.drawImage(S.sel, 0, 0);
      k.globalCompositeOperation = 'source-over'; k.drawImage(f, 0, 0);
      f = keep;
    }
    l.canvas = f; touch(l); refreshLayers();
  });
}
function featherDialog() {
  if (!S.sel) { toast('Buat seleksi dulu.'); return; }
  let r = 10;
  modal('Feather seleksi', slider('Radius', r, 1, 200, 1, v => { r = v; }, 'px'), () => featherSel(r));
}
function growDialog() {
  if (!S.sel) { toast('Buat seleksi dulu.'); return; }
  let r = 5;
  modal('Perluas / persempit', el('div', {}, slider('Piksel', r, -100, 100, 1, v => { r = v; }, 'px'), el('p', { class: 'muted small' }, 'Positif = perluas, negatif = persempit.')), () => growSel(r));
}

/* ---------- AI: Generative Fill (lewat endpoint milik sendiri) ---------- */
function aiCfg() { try { return JSON.parse(localStorage.getItem('lapis.ai')) || {}; } catch { return {}; } }
function aiSettings() {
  const c = aiCfg();
  const url = el('input', { type: 'url', value: c.url || '', placeholder: 'https://server-anda.com/inpaint' });
  const key = el('input', { type: 'password', value: c.key || '', placeholder: 'opsional' });
  modal('Pengaturan AI', el('div', {},
    el('p', { class: 'muted small' }, 'Generative Fill mengirim gambar + mask + prompt ke endpoint ini (format ada di README). Disimpan hanya di browser ini.'),
    row('Endpoint', url), row('API key', key)), () => {
    try { localStorage.setItem('lapis.ai', JSON.stringify({ url: url.value.trim(), key: key.value.trim() })); } catch { toast('Tidak bisa menyimpan di browser ini.'); }
  }, 'Simpan');
}
async function genFillDialog() {
  if (!D) return;
  if (!S.sel) { toast('Seleksi dulu area yang mau diisi.'); return; }
  const cfg = aiCfg();
  if (!cfg.url) { toast('Atur endpoint AI dulu.'); aiSettings(); return; }
  const ta = el('textarea', { rows: 3, placeholder: 'contoh: perahu kayu kecil di atas air' });
  if (!await modal('Generative Fill', el('div', {}, el('p', { class: 'muted small' }, 'Kosongkan prompt untuk mengisi dengan latar sekitar.'), ta), null, 'Buat')) return;
  await busy('Membuat gambar dengan AI…', async () => {
    const m = mk(D.w, D.h), g = cx(m);
    g.fillStyle = '#000'; g.fillRect(0, 0, D.w, D.h);
    g.drawImage(silhouette(S.sel, '#fff'), 0, 0);
    const body = { prompt: ta.value.trim(), image: composite().toDataURL('image/png'), mask: m.toDataURL('image/png'), width: D.w, height: D.h };
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.key) headers.Authorization = 'Bearer ' + cfg.key;
    const r = await fetch(cfg.url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('Server membalas ' + r.status);
    let img;
    if ((r.headers.get('content-type') || '').startsWith('image/')) img = await fileToImg(await r.blob());
    else {
      const j = await r.json(), src = j.image || j.url || (j.images && j.images[0]);
      if (!src) throw new Error('Respons tidak berisi gambar');
      img = await loadImg(src);
    }
    pushH('Generative Fill');
    const l = newLayer('pixel', 'AI: ' + (body.prompt || 'isi').slice(0, 20));
    l.canvas = mk(D.w, D.h);
    cx(l.canvas).drawImage(img, 0, 0, D.w, D.h);
    l.mask = blurCanvas(S.sel, 3);
    insertLayer(l); refreshAll();
    toast('Hasil AI ditambahkan sebagai layer baru dengan mask.');
  });
}
