'use strict';
/* AI Upscale bertile, sepenuhnya lokal: model ESRGAN via TensorFlow.js di GPU browser.
   Gambar dipotong jadi tile + overlap, tiap tile diperbesar AI lalu dirangkai ulang tanpa sambungan.
   Tidak ada gambar yang dikirim ke server mana pun. */

const UP_TARGETS = [
  ['4k', '4K UHD (sisi panjang 3840 px)'], ['4kd', '4K DCI (sisi panjang 4096 px)'], ['2k', 'QHD (sisi panjang 2560 px)'],
  ['x2', '2× ukuran sekarang'], ['x4', '4× ukuran sekarang'],
  ['enh', 'Perjelas · ukuran tetap (detail lebih tajam)'],
  ['deblur', 'Hilangkan blur · ukuran tetap (MAXIM, ~88 MB, lambat)'],
];
const UP_MAX_SIDE = 8192, UP_MAX_PX = 40e6, UP_MAX_PX_MOBILE = 12e6; // HP: batas memori kanvas (terutama Safari iOS)
let upCancel = false;

function upTarget(t, w, h) {
  if (t === 'enh' || t === 'deblur') return { f: 1, w, h, enh: true, deblur: t === 'deblur' };
  const long = Math.max(w, h);
  const goal = { '4k': 3840, '4kd': 4096, '2k': 2560 }[t];
  let f = goal ? goal / long : t === 'x2' ? 2 : 4;
  const want = f, maxPx = upDev && upDev.tier === 'mobile' ? UP_MAX_PX_MOBILE : UP_MAX_PX;
  f = Math.min(f, UP_MAX_SIDE / long, Math.sqrt(maxPx / (w * h)));
  return { f, w: Math.round(w * f), h: Math.round(h * f), capped: f < want - 1e-6 && maxPx === UP_MAX_PX_MOBILE };
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
  // native: diproses realesrgan-ncnn-vulkan lewat server.js (jauh lebih cepat); muncul hanya bila server & binary tersedia
  nx4: { name: 'Native GPU · Real-ESRGAN x4plus (tercepat, foto)', native: 'x4plus', scales: [4], hidden: true },
  nanime: { name: 'Native GPU · Real-ESRGAN anime/ilustrasi', native: 'anime', scales: [4], hidden: true },
  nvid: { name: 'Native GPU · Real-ESR general 2×/3×/4× (ringan)', native: 'video', scales: [2, 3, 4], hidden: true },
  // Real-ESRGAN x4plus di browser (ONNX Runtime Web + WebGPU), dikonversi dari bobot resmi; tidak perlu server.js
  rx4: { heavy: true, name: 'Real-ESRGAN x4plus · di browser (~34 MB, terbaik untuk foto)', onnx: 'models/realesrgan-x4plus-fp16.onnx', size: '~34 MB', scales: [4], ov: 16 },
  // versi kompak resmi (SRVGGNetCompact, ~13× lebih ringan): cocok untuk laptop tanpa GPU kuat
  rxl: { name: 'Real-ESR general · di browser (~2,4 MB, ringan & cepat)', onnx: 'models/realesr-general-x4v3-fp16.onnx', size: '~2,4 MB', scales: [4], ov: 12 },
  thick: { heavy: true, name: 'Kualitas terbaik · ESRGAN thick (~28 MB)', pkg: '@upscalerjs/esrgan-thick@1.0.0', scales: [2, 3, 4, 8], rrdn: true, path: s => `models/x${s}/model.json` },
  gans: { name: 'Tekstur tajam · ESRGAN GAN (~4 MB)', pkg: '@upscalerjs/esrgan-legacy@1.0.0', scales: [4], rrdn: true, path: () => 'models/gans/model.json' },
  medium: { name: 'Sedang · ESRGAN medium (~5 MB)', pkg: '@upscalerjs/esrgan-medium@1.0.0', scales: [2, 3, 4, 8], rrdn: false, path: s => `models/x${s}/model.json` },
  slim: { name: 'Cepat · ESRGAN slim (~1 MB)', pkg: '@upscalerjs/esrgan-slim@1.0.0', scales: [2, 3, 4, 8], rrdn: false, path: s => `models/x${s}/model.json` },
  // MAXIM deblur (dataset GoPro): graph model 1×, input/output 0..1, sisi harus kelipatan 64
  maxim: { heavy: true, name: 'Deblur · MAXIM (~88 MB)', pkg: '@upscalerjs/maxim-deblurring@0.1.0', scales: [1], rrdn: true, graph: true, div: 64, ov: 32, hidden: true, path: () => 'models/model.json' },
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
    // WebGPU jauh lebih cepat dari WebGL bila tersedia; fallback ke WebGL lalu CPU
    if (navigator.gpu) {
      try {
        if (!tf.findBackend('webgpu')) await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-webgpu@4.22.0/dist/tf-backend-webgpu.min.js');
        if (!(await tf.setBackend('webgpu'))) throw 0;
      } catch { /* lanjut ke WebGL */ }
    }
    if (tf.getBackend() !== 'webgpu') {
      try { if (!(await tf.setBackend('webgl'))) throw 0; } catch { await tf.setBackend('cpu'); }
    }
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
  const url = `https://cdn.jsdelivr.net/npm/${m.pkg}/${m.path(scale)}`;
  if (m.graph && !upCache.maximOps) {
    // op kustom MAXIM (sama seperti di paket UpscalerJS)
    tf.registerOp('ScaleAndTranslate', ({ inputs }) => tf.tidy(() => {
      const [hh, ww] = Array.from(inputs[1].dataSync());
      return tf.image.resizeNearestNeighbor(inputs[0], [hh, ww]);
    }));
    upCache.maximOps = true;
  }
  if (!upCache[key]) upCache[key] = await (m.graph ? tf.loadGraphModel(url) : tf.loadLayersModel(url));
  return upCache[key];
}

/* Rencana pass: utamakan model 4× lalu langsung perkecil ke target (supersampling = lebih tajam).
   Tiap langkah: { s: skala model, out: skala hasil langkah itu }. */
function upPlan(f, kind, enh) {
  const sc = UP_MODELS[kind].scales, steps = [];
  // mode Perjelas: satu pass model 2× (cukup, karena hasil langsung diperkecil ke ukuran asli)
  if (enh) return [{ s: sc.includes(2) ? 2 : Math.min(...sc), out: 1 }];
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
  const { s: scale, out: outF } = o.step, rr = o.rrdn, div = o.div || 1, tile = o.tile, ov = o.overlap;
  const w = src.width, h = src.height, W = Math.round(w * outF), H = Math.round(h * outF);
  const out = mk(W, H), og = cx(out), sd = cx(src);
  og.imageSmoothingEnabled = true; og.imageSmoothingQuality = 'high';
  const cols = Math.ceil(w / tile), rows = Math.ceil(h / tile), n = cols * rows;
  const views = o.tta === 4 ? [[], [2], [1], [1, 2]] : o.tta === 2 ? [[], [2]] : [[]];
  let i = 0;
  for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
    if (upCancel) throw new Error('Dibatalkan');
    const x0 = tx * tile, y0 = ty * tile, x1 = Math.min(w, x0 + tile), y1 = Math.min(h, y0 + tile);
    // jendela berukuran tetap (digeser ke dalam di tepi) agar shape tensor selalu sama → shader GPU tidak dikompilasi ulang
    const PW = Math.min(w, tile + 2 * ov), PH = Math.min(h, tile + 2 * ov);
    const px0 = Math.max(0, Math.min(x0 - ov, w - PW)), py0 = Math.max(0, Math.min(y0 - ov, h - PH));
    const pw = PW, ph = PH, d = sd.getImageData(px0, py0, pw, ph).data, rgb = new Float32Array(pw * ph * 3);
    const k0 = rr ? 1 / 255 : 1;
    for (let k = 0, j = 0; k < d.length; k += 4) { rgb[j++] = d[k] * k0; rgb[j++] = d[k + 1] * k0; rgb[j++] = d[k + 2] * k0; }
    const y = tf.tidy(() => {
      let x = tf.tensor4d(rgb, [1, ph, pw, 3]);
      // model dengan syarat kelipatan (MAXIM): pad cermin, lalu potong kembali setelah prediksi
      const eh = Math.ceil(ph / div) * div - ph, ew = Math.ceil(pw / div) * div - pw;
      if (eh || ew) { const pd = [[0, 0], [0, eh], [0, ew], [0, 0]]; x = eh <= ph && ew <= pw ? tf.mirrorPad(x, pd, 'symmetric') : tf.pad(x, pd); }
      const run = v => { let p = model.predict(v); if (Array.isArray(p)) p = p[p.length - 1]; return eh || ew ? tf.slice(p, [0, 0, 0, 0], [1, ph * scale, pw * scale, 3]) : p; };
      const outs = views.map(ax => (ax.length ? tf.reverse(run(tf.reverse(x, ax)), ax) : run(x)));
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
    await upYield();
  }
  return out;
}

/* Jalankan semua pass satu model. */
/* ================= Native (server.js + realesrgan-ncnn-vulkan) ================= */
let upNative = null;
async function nativeCheck() {
  if (upNative) return upNative;
  if (!/^https?:$/.test(location.protocol)) return (upNative = { available: false });
  try {
    const r = await fetch('/api/native', { cache: 'no-store' });
    upNative = r.ok ? await r.json() : { available: false };
  } catch { upNative = { available: false }; }
  return upNative;
}
async function nativePass(src, model, step, tta) {
  const blob = await new Promise(ok => src.toBlob(ok, 'image/png'));
  const ac = new AbortController(), iv = setInterval(() => upCancel && ac.abort(), 200);
  try {
    const r = await fetch(`/api/upscale?model=${model}&scale=${step.s}&tta=${tta > 1 ? 1 : 0}`, { method: 'POST', body: blob, signal: ac.signal });
    if (!r.ok) { let e = r.statusText; try { e = (await r.json()).error; } catch {} throw new Error('Upscale native gagal: ' + e); }
    const bmp = await createImageBitmap(await r.blob()), c = mk(bmp.width, bmp.height);
    cx(c).drawImage(bmp, 0, 0); bmp.close();
    return step.out < step.s ? resizeSharp(c, Math.round(src.width * step.out), Math.round(src.height * step.out)) : c;
  } catch (e) {
    if (upCancel) throw new Error('Dibatalkan');
    throw e;
  } finally { clearInterval(iv); }
}

/* Beri jeda ke browser ±tiap 100 ms (progres & tombol Batal tetap hidup di perangkat lambat). */
let upLastYield = 0;
async function upYield() {
  const now = performance.now();
  if (now - upLastYield < 100) return;
  await new Promise(r => setTimeout(r, 0));
  upLastYield = performance.now();
}
/* Progres + perkiraan sisa waktu (setelah beberapa tile). */
function upProgress(t0, i, n) {
  const pct = Math.round(i / n * 100);
  if (i < 3 || i >= n) return `${pct}%`;
  const left = (performance.now() - t0) / i * (n - i) / 1000;
  const eta = left < 60 ? `${Math.ceil(left / 5) * 5} dtk` : `${Math.round(left / 60)} mnt`;
  return `${pct}% · sisa ±${eta}${left > 600 ? ' · terlalu lama? batalkan & pilih model ringan / target lebih kecil' : ''}`;
}
const isOom = e => !upCancel && /memory|OOM|allocat|context.*lost|buffer|out of/i.test(String(e && (e.message || e)));

/* ================= Profil perangkat → model & tile yang paling cocok ================= */
let upDev = null;
async function deviceProfile() {
  if (upDev) return upDev;
  const mem = navigator.deviceMemory || 0, cores = navigator.hardwareConcurrency || 0;
  let webgpu = false, maxBuf = 0, gpuName = '';
  try {
    const ad = navigator.gpu && await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    const info = ad && (ad.info || {});
    if (ad && !ad.isFallbackAdapter && !info.isFallbackAdapter) {
      webgpu = true; maxBuf = ad.limits.maxBufferSize || 0;
      gpuName = [info.vendor, info.architecture || info.device].filter(Boolean).join(' ');
    }
  } catch { /* tanpa WebGPU */ }
  const lowMem = mem && mem < 8, weakCpu = cores && cores < 4, ua = navigator.userAgent || '';
  // HP/tablet: memori kanvas & tab jauh lebih terbatas walau GPU-nya mendukung WebGPU
  const mobile = !!(navigator.userAgentData && navigator.userAgentData.mobile) || /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
    || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) // iPadOS menyamar sebagai Mac
    || (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820);
  // tinggi: WebGPU + RAM cukup + buffer GPU besar; sedang: WebGPU tapi terbatas; rendah: tanpa WebGPU (CPU/WebGL)
  const tier = mobile ? 'mobile' : !webgpu ? 'low' : (lowMem || maxBuf < 1 << 30 || weakCpu) ? 'mid' : 'high';
  return (upDev = { tier, mobile, webgpu, mem, cores, maxBuf, gpuName });
}
function recommend(dev, nat) {
  if (nat.available) return { model: 'nx4', tile: 192, why: 'Native GPU tersedia (server lokal)' };
  if (dev.tier === 'mobile') return { model: 'rxl', tile: dev.webgpu ? 96 : 64, why: 'HP/tablet, hemat memori' };
  if (dev.tier === 'high') return { model: 'rx4', tile: 192, why: 'GPU WebGPU kuat' };
  if (dev.tier === 'mid') return { model: 'rxl', tile: 128, why: 'GPU WebGPU dengan memori terbatas' };
  return { model: 'rxl', tile: 96, why: 'tanpa WebGPU, diproses CPU' };
}

/* ================= ONNX Runtime Web (Real-ESRGAN x4plus) ================= */
const ORT_VER = '1.20.1';
async function loadOrtModel(m, msg) {
  if (upCache[m.onnx]) return upCache[m.onnx];
  if (!window.ort) await loadScript(`https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/ort.webgpu.min.js`);
  ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/`;
  msg.textContent = `Mengunduh model ${m.name.split(' · ')[0]} (${m.size}, sekali saja)…`;
  const buf = await (await fetch(m.onnx)).arrayBuffer();
  let sess = null, ep = 'webgpu';
  if (navigator.gpu) { try { sess = await ort.InferenceSession.create(buf, { executionProviders: ['webgpu'] }); } catch { sess = null; } }
  if (!sess) { ep = 'wasm'; sess = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] }); }
  return (upCache[m.onnx] = { sess, ep });
}
/* Sama seperti esrganPass (tile berukuran tetap + overlap, langsung digambar di skala outF), tapi lewat ONNX (NCHW, 0..1). */
async function onnxPass(src, mdl, o, onTile) {
  const { s: scale, out: outF } = o.step, tile = o.tile, ov = o.overlap, { sess } = mdl;
  const w = src.width, h = src.height, W = Math.round(w * outF), H = Math.round(h * outF);
  const out = mk(W, H), og = cx(out), sd = cx(src);
  og.imageSmoothingEnabled = true; og.imageSmoothingQuality = 'high';
  const cols = Math.ceil(w / tile), rows = Math.ceil(h / tile), n = cols * rows;
  const PW = Math.min(w, tile + 2 * ov), PH = Math.min(h, tile + 2 * ov), N = PW * PH;
  const inp = new Float32Array(3 * N), tw = PW * scale, th = PH * scale, tc = mk(tw, th), tg = cx(tc), id = new ImageData(tw, th), od = id.data;
  let i = 0;
  for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
    if (upCancel) throw new Error('Dibatalkan');
    const x0 = tx * tile, y0 = ty * tile, x1 = Math.min(w, x0 + tile), y1 = Math.min(h, y0 + tile);
    const px0 = Math.max(0, Math.min(x0 - ov, w - PW)), py0 = Math.max(0, Math.min(y0 - ov, h - PH));
    const d = sd.getImageData(px0, py0, PW, PH).data;
    for (let k = 0, j = 0; j < N; k += 4, j++) { inp[j] = d[k] / 255; inp[N + j] = d[k + 1] / 255; inp[2 * N + j] = d[k + 2] / 255; }
    const res = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', inp, [1, 3, PH, PW]) });
    const ot = res[sess.outputNames[0]], y = ot.data, M = tw * th;
    for (let j = 0, k = 0; j < M; j++, k += 4) { od[k] = y[j] * 255; od[k + 1] = y[M + j] * 255; od[k + 2] = y[2 * M + j] * 255; od[k + 3] = 255; }
    ot.dispose?.();
    tg.putImageData(id, 0, 0);
    const dx = Math.round(x0 * outF), dy = Math.round(y0 * outF), dw = Math.round(x1 * outF) - dx, dh = Math.round(y1 * outF) - dy;
    og.drawImage(tc, (x0 - px0) * scale, (y0 - py0) * scale, (x1 - x0) * scale, (y1 - y0) * scale, dx, dy, dw, dh);
    onTile(++i, n);
    await upYield();
  }
  return out;
}

async function esrganRun(src, kind, t, opts, label, msg) {
  const m = UP_MODELS[kind], steps = upPlan(t.f, kind, t.enh);
  let cur = src;
  for (let k = 0; k < steps.length; k++) {
    for (;;) {
      try { cur = await esrganStep(cur, kind, m, steps, k, opts, label, msg); break; }
      catch (e) {
        // memori GPU/RAM kurang: ulangi pass ini dengan tile setengahnya
        if (m.native || !isOom(e) || opts.tile <= 48) throw e;
        opts.tile = Math.max(48, Math.floor(opts.tile / 2));
        msg.textContent = `Memori kurang, mengulang dengan tile ${opts.tile} px…`;
        await new Promise(r => setTimeout(r, 300));
      }
    }
  }
  return resizeSharp(cur, t.w, t.h);
}
async function esrganStep(cur, kind, m, steps, k, opts, label, msg) {
  if (m.native) {
    msg.textContent = `${label}pass ${k + 1}/${steps.length} · Real-ESRGAN ${steps[k].s}× di GPU native…`;
    return nativePass(cur, m.native, steps[k], opts.tta);
  }
  if (m.onnx) {
    const mdl = await loadOrtModel(m, msg), t1 = performance.now();
    return onnxPass(cur, mdl, { ...opts, step: steps[k], overlap: m.ov }, (i, n) => {
      msg.textContent = `${label}pass ${k + 1}/${steps.length} · tile ${i}/${n} · ${upProgress(t1, i, n)} · ${mdl.ep === 'webgpu' ? 'GPU WebGPU' : 'CPU (lambat)'}`;
    });
  }
  msg.textContent = `Memuat model ${m.name.split(' · ')[1] || kind} ${steps[k].s}×… (pertama kali agak lama)`;
  const model = await loadUpModel(kind, steps[k].s), t1 = performance.now();
  return esrganPass(cur, model, { ...opts, step: steps[k], rrdn: m.rrdn, div: m.div, overlap: m.ov ?? opts.overlap }, (i, n) => {
    msg.textContent = `${label}pass ${k + 1}/${steps.length} · tile ${i}/${n} · ${upProgress(t1, i, n)} · ${upCache.backend === 'cpu' ? 'CPU (lambat)' : 'GPU ' + upCache.backend}${opts.tta > 1 ? ' · TTA ' + opts.tta + '×' : ''}`;
  });
}

/* ================= Dialog & alur utama ================= */
async function upscaleDialog() {
  if (!D) return;
  const [nat, dev] = await Promise.all([nativeCheck(), deviceProfile()]);
  const rec = recommend(dev, nat);
  const tSel = el('select', {}, ...UP_TARGETS.map(([v, t]) => el('option', { value: v }, t)));
  const keepCb = el('input', { type: 'checkbox' });
  // Perjelas/Deblur bisa diterapkan ke layer piksel aktif saja (ukuran tetap, layer lain tak tersentuh)
  const al = AL(), canLayer = !!(al && al.type === 'pixel' && al.canvas);
  const scopeSel = el('select', {}, el('option', { value: 'all' }, 'Gambar gabungan (semua layer dilebur)'),
    el('option', { value: 'layer', disabled: !canLayer, selected: canLayer }, canLayer ? `Layer aktif saja · ${al.name}` : 'Layer aktif saja (pilih layer piksel dulu)'));
  const lModel = el('select', {}, ...Object.entries(UP_MODELS).filter(([, m]) => (m.native ? nat.available : !m.hidden)).map(([k, m]) => el('option', { value: k, selected: k === rec.model }, m.name + (k === rec.model ? ' ★ disarankan' : ''))));
  const lTta = el('select', {}, el('option', { value: 1, selected: true }, 'Normal (tercepat)'), el('option', { value: 2 }, 'Tinggi · rata-rata 2 orientasi (2× lebih lama)'), el('option', { value: 4 }, 'Maksimal · 4 orientasi (4× lebih lama)'));
  const lTile = el('select', {}, ...[[64, '64 px (GPU lemah / HP)'], [96, '96 px'], [128, '128 px'], [192, '192 px'], [256, '256 px (GPU kuat, tercepat)']].map(([v, l]) => el('option', { value: v, selected: v === rec.tile }, l + (v === rec.tile ? ' ★' : ''))));
  const devInfo = el('p', { class: 'muted small' }, `Perangkat: ${dev.webgpu ? 'WebGPU' + (dev.gpuName ? ' (' + dev.gpuName + ')' : '') : 'tanpa WebGPU'}${dev.mem ? ' · RAM ' + (dev.mem >= 8 ? '≥8' : dev.mem) + ' GB' : ''}${dev.cores ? ' · ' + dev.cores + ' inti CPU' : ''}. ★ = pilihan otomatis: ${rec.why}.${dev.tier === 'low' ? ' Model berat (x4plus, thick, MAXIM) akan sangat lambat di perangkat ini.' : ''}${dev.tier === 'mobile' ? ` Mode HP: hasil dibatasi ±${UP_MAX_PX_MOBILE / 1e6} MP dan dokumen disimpan otomatis sebelum proses.` : ''}`);
  let gan = 0, sharpen = 0, strength = 100, detail = 80;
  const info = el('p', { class: 'muted small' });
  const upd = () => {
    upd0();
    const t = upTarget(tSel.value, D.w, D.h), m = UP_MODELS[t.deblur ? 'maxim' : lModel.value];
    if (t.capped) info.textContent += ` Dibatasi ke ${t.w}×${t.h} (±${UP_MAX_PX_MOBILE / 1e6} MP) karena memori HP terbatas.`;
    if (dev.mobile && m.heavy) info.textContent += ' ⚠ Model ini berat untuk HP: berisiko membuat tab tertutup/ter-reload. Disarankan Real-ESR general.';
  };
  const upd0 = () => {
    const t = upTarget(tSel.value, D.w, D.h);
    modelRow.hidden = t.deblur;
    const isNat = !t.deblur && !!UP_MODELS[lModel.value].native;
    ganRow.hidden = lModel.value === 'gans' || t.deblur || isNat || !!UP_MODELS[lModel.value].onnx; // Real-ESRGAN sudah model GAN
    tileRow.hidden = isNat; // ncnn mengatur tile sendiri
    strRow.hidden = detRow.hidden = scopeRow.hidden = !t.enh;
    if (t.deblur) {
      info.textContent = `${D.w}×${D.h} px tetap. Model MAXIM menghilangkan blur goyang/gerak (dilatih pada dataset GoPro). Model ~88 MB diunduh sekali lalu di-cache; prosesnya jauh lebih berat dari ESRGAN, pakai tile kecil bila GPU lemah${strength < 100 ? `. Dicampur ${100 - strength}% foto asli` : ''}. Diproses di perangkat ini.`;
      return;
    }
    if (t.enh) {
      info.textContent = `${D.w}×${D.h} px tetap. Model ${upPlan(1, lModel.value, true)[0].s}× lalu diperkecil kembali ke ukuran asli: tepi lebih bersih, noise/artefak JPEG berkurang${gan && lModel.value !== 'gans' ? ' + campuran GAN ' + gan + '%' : ''}${strength < 100 ? `, dicampur ${100 - strength}% foto asli` : ''}. Diproses di perangkat ini.`;
      return;
    }
    if (t.f <= 1.001) { info.textContent = `Gambar (${D.w}×${D.h}) sudah sebesar atau lebih besar dari target.`; return; }
    info.textContent = `${D.w}×${D.h} → ${t.w}×${t.h} px. Model ${upPlan(t.f, lModel.value).map(s => s.s + '×').join(' lalu ')} lalu diperkecil ke target (supersampling)${gan && lModel.value !== 'gans' ? ' + campuran GAN ' + gan + '%' : ''}. Diproses di perangkat ini, tidak dikirim ke mana pun.`;
  };
  const modelRow = row('Model', lModel), scopeRow = row('Terapkan ke', scopeSel);
  const tileRow = row('Ukuran tile', lTile);
  const detRow = slider('Detail', detail, 0, 200, 5, v => { detail = v; }, '%');
  const strRow = slider('Kekuatan', strength, 0, 100, 5, v => { strength = v; upd(); }, '%');
  const ganRow = slider('Campur tekstur GAN', gan, 0, 100, 5, v => { gan = v; upd(); }, '%');
  [tSel, lModel].forEach(s => s.addEventListener('change', upd));
  upd();
  const body = el('div', {}, row('Target', tSel), scopeRow, modelRow, detRow, strRow, ganRow, row('Kualitas', lTta), tileRow,
    slider('Tajamkan akhir', sharpen, 0, 100, 1, v => { sharpen = v; }, '%'),
    el('label', { class: 'chk' }, keepCb, 'Simpan foto asli sebagai layer pembanding (tersembunyi)'), info, devInfo,
    el('p', { class: 'muted small' }, 'Campur tekstur GAN: model GAN ikut dijalankan lalu hasilnya dipadukan, untuk tekstur lebih tajam (waktu ~2×). Semua layer digabung lalu diperbesar. Bisa di-undo.'));
  modal('AI Upscale', body, () => {
    const t = upTarget(tSel.value, D.w, D.h);
    if (!t.enh && t.f <= 1.001) { toast('Pilih target yang lebih besar dari gambar sekarang.'); return false; }
    const opts = { t, layer: t.enh && scopeSel.value === 'layer' ? al : null, sharpen, strength, detail, keep: keepCb.checked, model: t.deblur ? 'maxim' : lModel.value, tile: +lTile.value, tta: +lTta.value, gan: lModel.value === 'gans' || t.deblur || UP_MODELS[lModel.value].native || UP_MODELS[lModel.value].onnx ? 0 : gan };
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
      // HP: simpan dulu, karena tab bisa ditutup sistem saat memori penuh
      if (upDev && upDev.mobile && typeof autosave === 'function') { msg.textContent = 'Menyimpan dokumen dulu…'; try { await autosave(); } catch { /* tetap lanjut */ } }
      const L = o.layer && D.layers.includes(o.layer) ? o.layer : null;
      const src = L ? L.canvas : composite(), alpha = hasAlpha(src);
      if (L) t.w = src.width, t.h = src.height;
      if (!(UP_MODELS[o.model].native || UP_MODELS[o.model].onnx) || o.gan) { msg.textContent = 'Memuat TensorFlow.js…'; await loadTf(); }
      const opts = { tile: o.tile, overlap: UP_MODELS[o.model].rrdn ? 24 : 16, tta: o.tta };
      let out = await esrganRun(src, o.model, t, opts, o.gan ? 'Model utama · ' : '', msg);
      if (o.gan) {
        const g = await esrganRun(src, 'gans', t, opts, 'Tekstur GAN · ', msg);
        const og = cx(out); og.globalAlpha = o.gan / 100; og.drawImage(g, 0, 0); og.globalAlpha = 1;
      }
      if (t.enh && o.strength < 100) {
        // campur dengan foto asli agar hasil tidak terlihat 'plastik'
        const og = cx(out); og.globalAlpha = 1 - o.strength / 100; og.drawImage(src, 0, 0); og.globalAlpha = 1;
      }
      // AI menghaluskan noise; setelah bersih, tepi & tekstur bisa dipertajam tanpa ikut menajamkan noise
      if (t.enh && o.detail > 0) out = applyFilter(out, { kind: 'sharpen', amount: o.detail, radius: 1, threshold: 2 });
      if (o.sharpen > 0) out = applyFilter(out, { kind: 'sharpen', amount: o.sharpen });
      if (alpha) { const a = mk(t.w, t.h), ag = cx(a); ag.imageSmoothingQuality = 'high'; ag.drawImage(src, 0, 0, t.w, t.h); maskInto(out, a); }
      if (L) {
        // hanya layer aktif yang diganti; adjustment, teks, mask & layer lain tetap utuh
        pushH((t.deblur ? 'AI Deblur' : 'AI Perjelas') + ' (layer)');
        if (o.keep) {
          const ref = newLayer('pixel', L.name + ' · asli', { visible: false });
          ref.canvas = cloneCanvas(src);
          D.layers.splice(D.layers.indexOf(L), 0, ref);
        }
        L.canvas = out; D.active = D.layers.indexOf(L); S.editMask = false;
        touch(L); refreshAll();
        toast(`Selesai: layer "${L.name}" dalam ${Math.round((performance.now() - t0) / 1000)} detik.`);
        return;
      }
      pushH(t.deblur ? 'AI Deblur' : t.enh ? 'AI Perjelas' : 'AI Upscale');
      const l = newLayer('pixel', t.deblur ? 'Deblur AI' : t.enh ? 'Perjelas AI' : 'Upscale ' + t.w + '×' + t.h);
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
      upCache.tc = null; // lepas kanvas sementara (bisa puluhan MB)
    }
  });
}
