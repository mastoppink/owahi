'use strict';
/* AI Upscale bertile, sepenuhnya lokal: model ESRGAN via TensorFlow.js di GPU browser.
   Gambar dipotong jadi tile + overlap, tiap tile diperbesar AI lalu dirangkai ulang tanpa sambungan.
   Tidak ada gambar yang dikirim ke server mana pun. */

const UP_TARGETS = [
  ['4k', '4K UHD (sisi panjang 3840 px)'], ['4kd', '4K DCI (sisi panjang 4096 px)'], ['2k', 'QHD (sisi panjang 2560 px)'],
  ['x2', '2× ukuran sekarang'], ['x4', '4× ukuran sekarang'],
];
const UP_MAX_SIDE = 8192, UP_MAX_PX = 40e6;
let upCancel = false;

function upTarget(t, w, h) {
  const long = Math.max(w, h);
  const goal = { '4k': 3840, '4kd': 4096, '2k': 2560 }[t];
  let f = goal ? goal / long : t === 'x2' ? 2 : 4;
  f = Math.min(f, UP_MAX_SIDE / long, Math.sqrt(UP_MAX_PX / (w * h)));
  return { f, w: Math.round(w * f), h: Math.round(h * f) };
}

/* Perkecil bertahap (maks 2× per langkah) agar hasil tetap tajam. */
function resizeSharp(c, w, h) {
  let cur = c;
  while (cur.width / 2 >= w && cur.height / 2 >= h) {
    const n = mk(Math.round(cur.width / 2), Math.round(cur.height / 2)), g = cx(n);
    g.imageSmoothingQuality = 'high'; g.drawImage(cur, 0, 0, n.width, n.height); cur = n;
  }
  if (cur.width === w && cur.height === h) return cur;
  const n = mk(w, h), g = cx(n);
  g.imageSmoothingQuality = 'high'; g.drawImage(cur, 0, 0, w, h);
  return n;
}
function hasAlpha(c) {
  const d = cx(c).getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  return false;
}

/* ================= ESRGAN lokal (TensorFlow.js) =================
   Model dimuat dari CDN saat pertama dipakai lalu di-cache browser.
   rrdn = arsitektur besar (butuh custom layer), input/output 0..1; rdn = kecil, 0..255. */
const UP_MODELS = {
  thick: { name: 'Kualitas terbaik · ESRGAN thick (~28 MB)', pkg: '@upscalerjs/esrgan-thick@1.0.0', scales: [2, 3, 4, 8], rrdn: true, path: s => `models/x${s}/model.json` },
  gans: { name: 'Tekstur tajam · ESRGAN GAN (~4 MB)', pkg: '@upscalerjs/esrgan-legacy@1.0.0', scales: [4], rrdn: true, path: () => 'models/gans/model.json' },
  medium: { name: 'Sedang · ESRGAN medium (~5 MB)', pkg: '@upscalerjs/esrgan-medium@1.0.0', scales: [2, 3, 4, 8], rrdn: false, path: s => `models/x${s}/model.json` },
  slim: { name: 'Cepat · ESRGAN slim (~1 MB)', pkg: '@upscalerjs/esrgan-slim@1.0.0', scales: [2, 3, 4, 8], rrdn: false, path: s => `models/x${s}/model.json` },
};
const upCache = {};
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = el('script', { src, crossorigin: 'anonymous' });
    s.onload = res; s.onerror = () => rej(new Error('Gagal memuat ' + src));
    document.head.append(s);
  });
}
async function loadTf() {
  if (!window.tf) await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');
  if (!upCache.backend) {
    try { await tf.setBackend('webgl'); } catch { await tf.setBackend('cpu'); }
    await tf.ready();
    upCache.backend = tf.getBackend();
  }
  if (!upCache.reg) {
    const first = x => (Array.isArray(x) ? x[0] : x);
    class MultiplyBeta extends tf.layers.Layer {
      constructor() { super({}); this.beta = 0.2; }
      call(x) { return tf.mul(first(x), this.beta); }
      static get className() { return 'MultiplyBeta'; }
    }
    tf.serialization.registerClass(MultiplyBeta);
    for (const s of [2, 3, 4, 8]) {
      class PS extends tf.layers.Layer {
        constructor() { super({}); this.scale = s; }
        computeOutputShape(sh) { return [sh[0], sh[1], sh[2], 3]; }
        call(x) { return tf.depthToSpace(first(x), this.scale, 'NHWC'); }
        static get className() { return `PixelShuffle${s}x`; }
      }
      tf.serialization.registerClass(PS);
    }
    upCache.reg = true;
  }
}
async function loadUpModel(kind, scale) {
  const m = UP_MODELS[kind], key = kind + scale;
  if (!upCache[key]) upCache[key] = await tf.loadLayersModel(`https://cdn.jsdelivr.net/npm/${m.pkg}/${m.path(scale)}`);
  return upCache[key];
}

/* Rencana pass: utamakan model 4× lalu langsung perkecil ke target (supersampling = lebih tajam).
   Tiap langkah: { s: skala model, out: skala hasil langkah itu }. */
function upPlan(f, kind) {
  const sc = UP_MODELS[kind].scales, steps = [];
  let r = f;
  while (r > 1.001 && steps.length < 3) {
    const s = sc.includes(4) ? 4 : Math.max(...sc);
    steps.push({ s, out: Math.min(s, r) });
    r /= s;
  }
  return steps;
}

/* Satu pass bertile. Tiap tile: (opsional) rata-rata beberapa orientasi (TTA), buang overlap,
   lalu langsung digambar di skala `outF` sehingga tidak perlu kanvas raksasa 4×. */
async function esrganPass(src, model, o, onTile) {
  const { s: scale, out: outF } = o.step, rr = o.rrdn, tile = o.tile, ov = o.overlap;
  const w = src.width, h = src.height, W = Math.round(w * outF), H = Math.round(h * outF);
  const out = mk(W, H), og = cx(out), sd = cx(src);
  og.imageSmoothingEnabled = true; og.imageSmoothingQuality = 'high';
  const cols = Math.ceil(w / tile), rows = Math.ceil(h / tile), n = cols * rows;
  const views = o.tta === 4 ? [[], [2], [1], [1, 2]] : o.tta === 2 ? [[], [2]] : [[]];
  let i = 0;
  for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
    if (upCancel) throw new Error('Dibatalkan');
    const x0 = tx * tile, y0 = ty * tile, x1 = Math.min(w, x0 + tile), y1 = Math.min(h, y0 + tile);
    const px0 = Math.max(0, x0 - ov), py0 = Math.max(0, y0 - ov), px1 = Math.min(w, x1 + ov), py1 = Math.min(h, y1 + ov);
    const pw = px1 - px0, ph = py1 - py0, d = sd.getImageData(px0, py0, pw, ph).data, rgb = new Float32Array(pw * ph * 3);
    const k0 = rr ? 1 / 255 : 1;
    for (let k = 0, j = 0; k < d.length; k += 4) { rgb[j++] = d[k] * k0; rgb[j++] = d[k + 1] * k0; rgb[j++] = d[k + 2] * k0; }
    const y = tf.tidy(() => {
      const x = tf.tensor4d(rgb, [1, ph, pw, 3]);
      const outs = views.map(ax => { const p = model.predict(ax.length ? tf.reverse(x, ax) : x); return ax.length ? tf.reverse(p, ax) : p; });
      let r = outs.length > 1 ? tf.div(tf.addN(outs), outs.length) : outs[0];
      if (rr) r = tf.mul(r, 255);
      return r.clipByValue(0, 255);
    });
    const od0 = await y.data();
    y.dispose();
    const tw = pw * scale, th = ph * scale, id = new ImageData(tw, th), od = id.data;
    for (let k = 0, j = 0; j < od0.length; k += 4, j += 3) { od[k] = od0[j]; od[k + 1] = od0[j + 1]; od[k + 2] = od0[j + 2]; od[k + 3] = 255; }
    if (!upCache.tc || upCache.tc.width < tw || upCache.tc.height < th) upCache.tc = mk(Math.max(tw, upCache.tc ? upCache.tc.width : 0), Math.max(th, upCache.tc ? upCache.tc.height : 0));
    cx(upCache.tc).putImageData(id, 0, 0);
    // sumber (tanpa overlap) di hasil model → tujuan di skala outF; batas dibulatkan sama untuk tile bertetangga agar tak ada celah
    const dx = Math.round(x0 * outF), dy = Math.round(y0 * outF), dw = Math.round(x1 * outF) - dx, dh = Math.round(y1 * outF) - dy;
    og.drawImage(upCache.tc, (x0 - px0) * scale, (y0 - py0) * scale, (x1 - x0) * scale, (y1 - y0) * scale, dx, dy, dw, dh);
    onTile(++i, n);
    await tf.nextFrame();
  }
  return out;
}

/* Jalankan semua pass satu model. */
async function esrganRun(src, kind, t, opts, label, msg) {
  const m = UP_MODELS[kind], steps = upPlan(t.f, kind);
  let cur = src;
  for (let k = 0; k < steps.length; k++) {
    msg.textContent = `Memuat model ${m.name.split(' · ')[1] || kind} ${steps[k].s}×… (pertama kali agak lama)`;
    const model = await loadUpModel(kind, steps[k].s);
    cur = await esrganPass(cur, model, { ...opts, step: steps[k], rrdn: m.rrdn }, (i, n) => {
      msg.textContent = `${label}pass ${k + 1}/${steps.length} · tile ${i}/${n} · ${Math.round(i / n * 100)}% · ${upCache.backend === 'webgl' ? 'GPU' : 'CPU (lambat)'}${opts.tta > 1 ? ' · TTA ' + opts.tta + '×' : ''}`;
    });
  }
  return resizeSharp(cur, t.w, t.h);
}

/* ================= Dialog & alur utama ================= */
function upscaleDialog() {
  if (!D) return;
  const tSel = el('select', {}, ...UP_TARGETS.map(([v, t]) => el('option', { value: v }, t)));
  const keepCb = el('input', { type: 'checkbox', checked: true });
  const lModel = el('select', {}, ...Object.entries(UP_MODELS).map(([k, m]) => el('option', { value: k }, m.name)));
  const lTta = el('select', {}, el('option', { value: 1 }, 'Normal'), el('option', { value: 2, selected: true }, 'Tinggi · rata-rata 2 orientasi (2× lebih lama)'), el('option', { value: 4 }, 'Maksimal · 4 orientasi (4× lebih lama)'));
  const lTile = el('select', {}, el('option', { value: 64 }, '64 px (GPU lemah / HP)'), el('option', { value: 96, selected: true }, '96 px'), el('option', { value: 128 }, '128 px'), el('option', { value: 192 }, '192 px (GPU kuat)'));
  let gan = 0, sharpen = 0;
  const info = el('p', { class: 'muted small' });
  const upd = () => {
    const t = upTarget(tSel.value, D.w, D.h);
    ganRow.hidden = lModel.value === 'gans';
    if (t.f <= 1.001) { info.textContent = `Gambar (${D.w}×${D.h}) sudah sebesar atau lebih besar dari target.`; return; }
    info.textContent = `${D.w}×${D.h} → ${t.w}×${t.h} px. Model ${upPlan(t.f, lModel.value).map(s => s.s + '×').join(' lalu ')} lalu diperkecil ke target (supersampling)${gan && lModel.value !== 'gans' ? ' + campuran GAN ' + gan + '%' : ''}. Diproses di perangkat ini, tidak dikirim ke mana pun.`;
  };
  const ganRow = slider('Campur tekstur GAN', gan, 0, 100, 5, v => { gan = v; upd(); }, '%');
  [tSel, lModel].forEach(s => s.addEventListener('change', upd));
  upd();
  const body = el('div', {}, row('Target', tSel), row('Model', lModel), ganRow, row('Kualitas', lTta), row('Ukuran tile', lTile),
    slider('Tajamkan akhir', sharpen, 0, 100, 1, v => { sharpen = v; }, '%'),
    el('label', { class: 'chk' }, keepCb, 'Simpan foto asli sebagai layer pembanding (tersembunyi)'), info,
    el('p', { class: 'muted small' }, 'Campur tekstur GAN: model GAN ikut dijalankan lalu hasilnya dipadukan, untuk tekstur lebih tajam (waktu ~2×). Semua layer digabung lalu diperbesar. Bisa di-undo.'));
  modal('AI Upscale', body, () => {
    const t = upTarget(tSel.value, D.w, D.h);
    if (t.f <= 1.001) { toast('Pilih target yang lebih besar dari gambar sekarang.'); return false; }
    const opts = { t, sharpen, keep: keepCb.checked, model: lModel.value, tile: +lTile.value, tta: +lTta.value, gan: lModel.value === 'gans' ? 0 : gan };
    setTimeout(() => runUpscale(opts), 0);
  }, 'Upscale');
}

async function runUpscale(o) {
  const b = $('#busy'), msg = b.querySelector('span');
  const cancel = el('button', { class: 'btn', onclick: () => { upCancel = true; cancel.disabled = true; cancel.textContent = 'Membatalkan…'; } }, 'Batal');
  upCancel = false;
  const t0 = performance.now(), { t } = o;
  await busy('Menyiapkan…', async () => {
    b.append(cancel);
    try {
      const src = composite(), alpha = hasAlpha(src);
      msg.textContent = 'Memuat TensorFlow.js…';
      await loadTf();
      const opts = { tile: o.tile, overlap: UP_MODELS[o.model].rrdn ? 24 : 16, tta: o.tta };
      let out = await esrganRun(src, o.model, t, opts, o.gan ? 'Model utama · ' : '', msg);
      if (o.gan) {
        const g = await esrganRun(src, 'gans', t, opts, 'Tekstur GAN · ', msg);
        const og = cx(out); og.globalAlpha = o.gan / 100; og.drawImage(g, 0, 0); og.globalAlpha = 1;
      }
      if (o.sharpen > 0) out = applyFilter(out, { kind: 'sharpen', amount: o.sharpen });
      if (alpha) { const a = mk(t.w, t.h), ag = cx(a); ag.imageSmoothingQuality = 'high'; ag.drawImage(src, 0, 0, t.w, t.h); maskInto(out, a); }
      pushH('AI Upscale');
      const l = newLayer('pixel', 'Upscale ' + t.w + '×' + t.h);
      l.canvas = out;
      D.layers = [l]; D.active = 0;
      if (o.keep) {
        // pembanding: foto asli diperbesar biasa, disembunyikan; klik ikon mata untuk membandingkan
        const ref = newLayer('pixel', 'Asli (pembanding)', { visible: false });
        ref.canvas = mk(t.w, t.h);
        const rg = cx(ref.canvas); rg.imageSmoothingQuality = 'high'; rg.drawImage(src, 0, 0, t.w, t.h);
        D.layers = [ref, l]; D.active = 1;
      }
      const sx = t.w / D.w, sy = t.h / D.h;
      pathMap((x, y) => [x * sx, y * sy]);
      D.w = t.w; D.h = t.h;
      S.sel = null; S.editMask = false; T = null;
      if (S.tool === 'crop') TOOLS.crop.activate();
      selChanged(); fitView(); refreshAll();
      toast(`Selesai: ${t.w}×${t.h} px dalam ${Math.round((performance.now() - t0) / 1000)} detik.`);
    } finally {
      cancel.remove();
    }
  });
}
