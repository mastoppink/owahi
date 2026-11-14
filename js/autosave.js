'use strict';
/* Simpan otomatis ke IndexedDB supaya foto tidak hilang saat halaman di-refresh.
   Kanvas di aplikasi ini immutable (setiap edit membuat kanvas baru), jadi hasil encode
   di-cache per objek kanvas: hanya layer yang benar-benar berubah yang di-encode ulang. */

const AS = { db: null, timer: 0, cache: new WeakMap(), busy: false, ready: false, dirty: false };

function asDB() {
  return AS.db || (AS.db = new Promise((res, rej) => {
    const r = indexedDB.open('lapis', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
async function kvSet(k, v) {
  const db = await asDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(v, k);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function kvGet(k) {
  const db = await asDB();
  return new Promise((res, rej) => {
    const r = db.transaction('kv').objectStore('kv').get(k);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}

function setSaveStat(t, cls = '') {
  const s = $('#saveStat');
  if (s) { s.textContent = t; s.className = 'savestat ' + cls; }
}
function scheduleAutosave() {
  if (!AS.ready) return;
  AS.dirty = true;
  setSaveStat('Belum tersimpan…', 'pending');
  clearTimeout(AS.timer);
  AS.timer = setTimeout(autosave, 1500);
}

async function packCanvas(c) {
  let b = AS.cache.get(c);
  if (!b) { b = await toBlob(c, 'image/png'); AS.cache.set(c, b); }
  return { __b: b };
}
async function pack(v) {
  if (v instanceof HTMLCanvasElement) return packCanvas(v);
  if (Array.isArray(v)) return Promise.all(v.map(pack));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k in v) if (k[0] !== '_') o[k] = await pack(v[k]);
    return o;
  }
  return v;
}
async function unpack(v) {
  if (Array.isArray(v)) return Promise.all(v.map(unpack));
  if (v && typeof v === 'object') {
    if ('__b' in v) {
      if (!v.__b) return null;
      const bmp = await createImageBitmap(v.__b), c = mk(bmp.width, bmp.height);
      cx(c).drawImage(bmp, 0, 0);
      bmp.close && bmp.close();
      AS.cache.set(c, v.__b); // sudah tersimpan, tak perlu encode ulang
      return c;
    }
    const o = {};
    for (const k in v) o[k] = await unpack(v[k]);
    return o;
  }
  return v;
}

async function autosave() {
  AS.timer = 0;
  // tunda selama sedang menggores / transform / menyeret
  if (ST || T || (typeof dragTool !== 'undefined' && dragTool) || AS.busy) { AS.timer = setTimeout(autosave, 800); return; }
  AS.busy = true;
  setSaveStat('Menyimpan…', 'pending');
  try {
    if (!D) { await kvSet('doc', null); }
    else {
      const layers = await Promise.all(D.layers.map(l => pack(l.type === 'text' || l.type === 'smart' ? { ...l, canvas: null } : l)));
      await kvSet('doc', { v: 1, w: D.w, h: D.h, active: D.active, layers, paths: D.paths || [], pathActive: PS.active, name: S.fileName, t: Date.now() });
    }
    if (!AS.timer) { AS.dirty = false; setSaveStat(D ? 'Tersimpan otomatis ✓' : '', 'ok'); }
  } catch (e) {
    console.warn('Autosave gagal', e);
    setSaveStat('Gagal simpan otomatis', 'err');
    toast('Simpan otomatis gagal (penyimpanan browser penuh atau diblokir). Simpan proyek manual lewat File → Simpan proyek.');
  } finally {
    AS.busy = false;
  }
}

async function autoRestore() {
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    const d = await kvGet('doc');
    if (d && d.layers && d.layers.length) {
      setSaveStat('Memulihkan…', 'pending');
      const layers = await unpack(d.layers);
      for (const l of layers) l.styles = Object.assign(defStyles(), l.styles || {});
      D = { w: d.w, h: d.h, layers, active: Math.min(d.active || 0, layers.length - 1), paths: d.paths || [] };
      UID = Math.max(0, ...layers.map(l => l.id || 0)) + 1;
      PUID = Math.max(0, ...D.paths.map(p => p.id || 0)) + 1;
      PS.active = Math.min(d.pathActive ?? -1, D.paths.length - 1); PS.sel = null; PS.drawing = null;
      S.fileName = d.name || 'gambar'; S.sel = null; T = null;
      H.past = []; H.future = [];
      selChanged(); fitView(); setTool(S.tool); refreshAll();
      setSaveStat('Tersimpan otomatis ✓', 'ok');
      const ago = Math.round((Date.now() - (d.t || Date.now())) / 60000);
      toast('Dokumen dipulihkan dari sesi sebelumnya' + (ago > 0 ? ` (${ago} menit lalu)` : '') + '.');
    }
  } catch (e) {
    console.warn('Gagal memulihkan', e);
    toast('Simpanan otomatis tidak bisa dibaca.');
  } finally {
    AS.ready = true;
  }
}

function closeDoc() {
  if (!D) return;
  if (!confirm('Tutup dokumen ini? Simpanan otomatisnya juga akan dihapus. Simpan proyek dulu kalau masih dibutuhkan.')) return;
  D = null; S.sel = null; T = null; H.past = []; H.future = [];
  PS.active = -1; PS.sel = null; PS.drawing = null;
  selChanged(); refreshAll(); drawView();
  clearTimeout(AS.timer); AS.dirty = false;
  kvSet('doc', null).then(() => setSaveStat('', '')).catch(() => {});
}
