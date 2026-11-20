'use strict';
/* Metadata export ala Photoshop: XMP (xmpMM DocumentID/InstanceID/History, dc, photoshop, tiff, exif),
   EXIF (TIFF IFD), dan profil warna sRGB. ID dokumen unik per proyek; aplikasi tetap tercatat jujur sebagai Lapis. */

const LAPIS_AGENT = 'Lapis 1.0';
const IPTC_AI = 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia';
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
const nowIso = () => { const d = new Date(), z = -d.getTimezoneOffset(), p = n => String(Math.floor(Math.abs(n))).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + (z >= 0 ? '+' : '-') + p(z / 60) + ':' + p(z % 60); };
const isoToExif = s => s.slice(0, 19).replace(/-/g, ':').replace('T', ' ');

/* ---------- Data per proyek ---------- */
function newMeta() {
  const id = uuid(), when = nowIso();
  return {
    docId: 'xmp.did:' + id, origId: 'xmp.did:' + id, created: when,
    history: [{ action: 'created', instanceID: 'xmp.iid:' + id, when, softwareAgent: LAPIS_AGENT }],
    creator: null, rights: null, title: null, // isian per proyek (null = pakai sumber lain)
    src: null, ai: false,
  };
}
function ensureMeta() { if (D && !D.meta) D.meta = newMeta(); return D && D.meta; }
function markAI(label) { if (D && /^AI |Generative Fill/.test(label || '')) ensureMeta().ai = true; }

/* ---------- Pengaturan global (disimpan di browser) ---------- */
function metaCfg() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem('lapis.meta')) || {}; } catch { /* kosong */ }
  return { name: c.name || '', tpl: c.tpl || '© {tahun} {nama}', ai: c.ai !== false };
}
function metaSettings() {
  const c = metaCfg();
  const name = el('input', { type: 'text', value: c.name, placeholder: 'mis. Nama Anda / studio' });
  const tpl = el('input', { type: 'text', value: c.tpl });
  const ai = el('input', { type: 'checkbox', checked: c.ai });
  modal('Metadata & hak cipta', el('div', {},
    el('p', { class: 'muted small' }, 'Dipakai otomatis saat export bila proyek tidak punya isian sendiri dan foto asli tidak membawa nama pembuat. Disimpan hanya di browser ini.'),
    row('Nama pembuat', name), row('Hak cipta', tpl),
    el('p', { class: 'muted small' }, '{tahun} dan {nama} diganti otomatis, mis. "© {tahun} {nama}. All rights reserved."'),
    el('label', { class: 'chk' }, ai, 'Tandai gambar yang diproses AI (IPTC DigitalSourceType)')), () => {
    try { localStorage.setItem('lapis.meta', JSON.stringify({ name: name.value.trim(), tpl: tpl.value.trim() || '© {tahun} {nama}', ai: ai.checked })); } catch { toast('Tidak bisa menyimpan di browser ini.'); }
  }, 'Simpan');
}
/* Prioritas: isian proyek → metadata foto asli → pengaturan global → kosong. */
function metaDefaults() {
  const m = ensureMeta(), c = metaCfg(), src = m.src || {};
  const creator = m.creator ?? (src.artist || c.name || '');
  const fromTpl = creator && c.tpl ? c.tpl.replace(/\{tahun\}/g, new Date().getFullYear()).replace(/\{nama\}/g, creator) : '';
  const rights = m.rights ?? (src.copyright || fromTpl);
  return { creator, rights, title: m.title ?? (src.title || ''), ai: m.ai && c.ai };
}

/* ---------- Membaca metadata foto asli ---------- */
function readTiff(b, base) {
  const dv = new DataView(b.buffer, b.byteOffset + base), le = dv.getUint16(0) === 0x4949, u16 = o => dv.getUint16(o, le), u32 = o => dv.getUint32(o, le);
  const out = {};
  const str = (cnt, off) => { const s = new Uint8Array(dv.buffer, dv.byteOffset + (cnt > 4 ? u32(off) : off), cnt); let t; try { t = new TextDecoder('utf-8', { fatal: true }).decode(s); } catch { t = new TextDecoder('latin1').decode(s); } return t.replace(/\0+$/, '').trim(); };
  const ifd = (o, want) => {
    if (!o || o + 2 > dv.byteLength) return;
    const n = u16(o);
    for (let i = 0; i < n; i++) {
      const e = o + 2 + i * 12, tag = u16(e), type = u16(e + 2), cnt = u32(e + 4);
      if (type === 2 && want[tag]) out[want[tag]] = str(cnt, e + 8);
      if (tag === 0x8769) ifd(u32(e + 8), { 0x9003: 'dateOriginal' });
    }
  };
  ifd(u32(4), { 0x013B: 'artist', 0x8298: 'copyright', 0x010F: 'make', 0x0110: 'model', 0x010E: 'description' });
  return out;
}
async function readSrcMeta(f) {
  try {
    const b = new Uint8Array(await f.slice(0, 1 << 20).arrayBuffer()), out = {};
    let tiff = -1;
    if (b[0] === 0xFF && b[1] === 0xD8) { // JPEG: cari APP1 "Exif\0\0"
      for (let o = 2; o + 4 < b.length && b[o] === 0xFF;) {
        const mk = b[o + 1], len = b[o + 2] << 8 | b[o + 3];
        if (mk === 0xE1 && b[o + 4] === 0x45 && b[o + 5] === 0x78 && b[o + 6] === 0x69 && b[o + 7] === 0x66) { tiff = o + 10; break; }
        if (mk === 0xDA) break;
        o += 2 + len;
      }
    } else if (b[0] === 0x89 && b[1] === 0x50) { // PNG: chunk eXIf
      for (let o = 8; o + 8 < b.length;) {
        const len = (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0, ty = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
        if (ty === 'eXIf') { tiff = o + 8; break; }
        if (ty === 'IDAT') break;
        o += 12 + len;
      }
    } else if (String.fromCharCode(...b.slice(8, 12)) === 'WEBP') { // WebP: chunk EXIF
      for (let o = 12; o + 8 < b.length;) {
        const ty = String.fromCharCode(...b.slice(o, o + 4)), len = b[o + 4] | b[o + 5] << 8 | b[o + 6] << 16 | b[o + 7] << 24;
        if (ty === 'EXIF') { tiff = o + 8 + (b[o + 8] === 0x45 ? 6 : 0); break; }
        o += 8 + len + (len & 1);
      }
    }
    if (tiff >= 0) Object.assign(out, readTiff(b, tiff));
    // XMP (teks biasa di semua format): ambil pembuat, hak cipta, judul, dan ID dokumen asal
    const t = new TextDecoder().decode(b), x = t.indexOf('<x:xmpmeta');
    if (x >= 0) {
      const xmp = t.slice(x, t.indexOf('</x:xmpmeta>', x) + 12);
      const li = tag => { const m = xmp.match(new RegExp('<' + tag + '>[\\s\\S]*?<rdf:li[^>]*>([\\s\\S]*?)</rdf:li>')); return m ? unxml(m[1].trim()) : ''; };
      const at = name => { const m = xmp.match(new RegExp(name + '="([^"]*)"')) || xmp.match(new RegExp('<' + name + '>([^<]*)<')); return m ? unxml(m[1]) : ''; };
      out.artist = out.artist || li('dc:creator');
      out.copyright = out.copyright || li('dc:rights');
      out.title = li('dc:title');
      out.origId = at('xmpMM:OriginalDocumentID') || at('xmpMM:DocumentID');
    }
    for (const k in out) if (!out[k]) delete out[k];
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/* ---------- XMP ---------- */
function buildXMP(m, v) {
  const a = (k, val) => (val !== undefined && val !== null && val !== '' ? `\n   ${k}="${xml(val)}"` : '');
  const hist = m.history.slice(-60).map(h => `\n     <rdf:li${a('stEvt:action', h.action)}${a('stEvt:instanceID', h.instanceID)}${a('stEvt:when', h.when)}${a('stEvt:softwareAgent', h.softwareAgent)}${a('stEvt:changed', h.changed)}${a('stEvt:parameters', h.parameters)}/>`).join('');
  const alt = (tag, val) => (val ? `\n   <${tag}>\n    <rdf:Alt>\n     <rdf:li xml:lang="x-default">${xml(val)}</rdf:li>\n    </rdf:Alt>\n   </${tag}>` : '');
  const body = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="${LAPIS_AGENT}">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
   xmlns:xmp="http://ns.adobe.com/xap/1.0/"
   xmlns:dc="http://purl.org/dc/elements/1.1/"
   xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
   xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
   xmlns:stEvt="http://ns.adobe.com/xap/1.0/sType/ResourceEvent#"
   xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
   xmlns:tiff="http://ns.adobe.com/tiff/1.0/"
   xmlns:exif="http://ns.adobe.com/exif/1.0/"
   xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"${a('xmp:CreatorTool', LAPIS_AGENT)}${a('xmp:CreateDate', m.created)}${a('xmp:ModifyDate', v.when)}${a('xmp:MetadataDate', v.when)}${a('dc:format', v.mime)}${a('photoshop:ColorMode', 3)}${a('photoshop:ICCProfile', 'sRGB IEC61966-2.1')}${a('photoshop:DateCreated', v.dateOriginal)}${a('xmpMM:DocumentID', m.docId)}${a('xmpMM:InstanceID', v.iid)}${a('xmpMM:OriginalDocumentID', m.origId)}${a('xmpRights:Marked', v.rights ? 'True' : '')}${a('tiff:ImageWidth', v.w)}${a('tiff:ImageLength', v.h)}${a('tiff:Orientation', 1)}${a('tiff:XResolution', '720000/10000')}${a('tiff:YResolution', '720000/10000')}${a('tiff:ResolutionUnit', 2)}${a('tiff:Make', v.make)}${a('tiff:Model', v.model)}${a('exif:ColorSpace', 1)}${a('exif:PixelXDimension', v.w)}${a('exif:PixelYDimension', v.h)}${a('Iptc4xmpExt:DigitalSourceType', v.ai ? IPTC_AI : '')}>${v.creator ? `\n   <dc:creator>\n    <rdf:Seq>\n     <rdf:li>${xml(v.creator)}</rdf:li>\n    </rdf:Seq>\n   </dc:creator>` : ''}${alt('dc:rights', v.rights)}${alt('dc:title', v.title)}
   <xmpMM:History>
    <rdf:Seq>${hist}
    </rdf:Seq>
   </xmpMM:History>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;
  // padding seperti Photoshop agar metadata bisa diedit di tempat oleh software lain
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n${body}\n${(' '.repeat(99) + '\n').repeat(20)}<?xpacket end="w"?>`;
}

/* ---------- EXIF (TIFF little-endian) ---------- */
function buildExif(v) {
  // EXIF ASCII dibaca Latin-1 oleh kebanyakan software (exiftool, Windows): pakai Latin-1 bila cukup, selain itu UTF-8
  const enc = s => { const u = [...s].every(ch => ch.charCodeAt(0) < 256) ? Uint8Array.from(s, ch => ch.charCodeAt(0)) : new TextEncoder().encode(s); const r = new Uint8Array(u.length + 1); r.set(u); return r; };
  const ifd0 = [[0x010E, 2, v.title && enc(v.title)], [0x010F, 2, v.make && enc(v.make)], [0x0110, 2, v.model && enc(v.model)], [0x0112, 3, 1], [0x011A, 5, [72, 1]], [0x011B, 5, [72, 1]], [0x0128, 3, 2],
    [0x0131, 2, enc(LAPIS_AGENT)], [0x0132, 2, enc(isoToExif(v.when))], [0x013B, 2, v.creator && enc(v.creator)], [0x8298, 2, v.rights && enc(v.rights)], [0x8769, 4, 0]].filter(e => e[2] !== '' && e[2] !== null && e[2] !== undefined);
  const exif = [[0x9000, 7, new TextEncoder().encode('0232')], [0x9003, 2, enc(v.dateOriginal ? isoToExif(v.dateOriginal) : isoToExif(v.created))], [0x9004, 2, enc(isoToExif(v.created))], [0xA001, 3, 1], [0xA002, 4, v.w], [0xA003, 4, v.h]];
  const size = e => (e[1] === 5 ? 8 : e[1] === 2 || e[1] === 7 ? e[2].length : 4);
  const ifdLen = list => 2 + list.length * 12 + 4, extra = list => list.reduce((s, e) => s + (size(e) > 4 ? size(e) + (size(e) & 1) : 0), 0);
  const o0 = 8, oE = o0 + ifdLen(ifd0) + extra(ifd0), total = oE + ifdLen(exif) + extra(exif);
  ifd0.find(e => e[0] === 0x8769)[2] = oE;
  const buf = new Uint8Array(total), dv = new DataView(buf.buffer);
  buf.set([0x49, 0x49, 0x2A, 0x00]); dv.setUint32(4, o0, true);
  const write = (list, at) => {
    list.sort((a, b) => a[0] - b[0]);
    dv.setUint16(at, list.length, true);
    let data = at + ifdLen(list);
    list.forEach((e, i) => {
      const p = at + 2 + i * 12, [tag, type, val] = e, n = size(e);
      dv.setUint16(p, tag, true); dv.setUint16(p + 2, type, true);
      dv.setUint32(p + 4, type === 5 ? 1 : type === 2 || type === 7 ? val.length : 1, true);
      const put = q => { if (type === 3) dv.setUint16(q, val, true); else if (type === 4) dv.setUint32(q, val, true); else if (type === 5) { dv.setUint32(q, val[0], true); dv.setUint32(q + 4, val[1], true); } else buf.set(val, q); };
      if (n <= 4) put(p + 8); else { dv.setUint32(p + 8, data, true); put(data); data += n + (n & 1); }
    });
    dv.setUint32(at + 2 + list.length * 12, 0, true);
  };
  write(ifd0, o0); write(exif, oE);
  return buf;
}

/* ---------- Profil ICC sRGB (v4, kurva parametrik) ---------- */
let sRGBicc = null;
function buildSRGB() {
  if (sRGBicc) return sRGBicc;
  const s15 = x => Math.round(x * 65536);
  const mluc = txt => { const u = []; for (const ch of txt) { const c = ch.charCodeAt(0); u.push(c >> 8, c & 255); } return [...'mluc'].map(c => c.charCodeAt(0)).concat([0, 0, 0, 0], be32(1), be32(12), [101, 110, 85, 83], be32(u.length), be32(28), u); };
  const be32 = n => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255];
  const xyz = (x, y, z) => [...'XYZ '].map(c => c.charCodeAt(0)).concat([0, 0, 0, 0], be32(s15(x)), be32(s15(y)), be32(s15(z)));
  const para = [...'para'].map(c => c.charCodeAt(0)).concat([0, 0, 0, 0], [0, 3, 0, 0], ...[2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045].map(v => be32(s15(v))));
  const chad = [...'sf32'].map(c => c.charCodeAt(0)).concat([0, 0, 0, 0], ...[1.047882, 0.022918, -0.050217, 0.029586, 0.990478, -0.017075, -0.009233, 0.015050, 0.751678].map(v => be32(s15(v) >>> 0)));
  const tags = [['desc', mluc('sRGB IEC61966-2.1')], ['cprt', mluc('No copyright, use freely')], ['wtpt', xyz(0.9642, 1, 0.82491)], ['chad', chad],
    ['rXYZ', xyz(0.436066, 0.222488, 0.013916)], ['gXYZ', xyz(0.385147, 0.716873, 0.097076)], ['bXYZ', xyz(0.143066, 0.060608, 0.714096)], ['rTRC', para], ['gTRC', para], ['bTRC', para]];
  const head = 128, table = 4 + tags.length * 12, blobs = [], entries = [];
  let off = head + table;
  for (const [sig, data] of tags) {
    const same = blobs.findIndex(b => b.data === data);
    if (same >= 0) { entries.push([sig, blobs[same].off, data.length]); continue; }
    entries.push([sig, off, data.length]); blobs.push({ data, off });
    off += data.length + ((4 - data.length % 4) % 4);
  }
  const out = new Uint8Array(off), d = new Date();
  const put = (at, arr) => out.set(arr, at), str = (at, s) => put(at, [...s].map(c => c.charCodeAt(0)));
  put(0, be32(off)); put(8, [4, 0x30, 0, 0]); str(12, 'mntr'); str(16, 'RGB '); str(20, 'XYZ ');
  put(24, [d.getUTCFullYear() >> 8, d.getUTCFullYear() & 255, 0, d.getUTCMonth() + 1, 0, d.getUTCDate(), 0, 0, 0, 0, 0, 0]);
  str(36, 'acsp'); put(68, be32(s15(0.9642))); put(72, be32(s15(1))); put(76, be32(s15(0.82491)));
  put(128, be32(tags.length));
  entries.forEach(([sig, o, n], i) => { str(132 + i * 12, sig); put(136 + i * 12, be32(o)); put(140 + i * 12, be32(n)); });
  for (const b of blobs) put(b.off, b.data);
  return (sRGBicc = out);
}

/* ---------- Menyisipkan ke file ---------- */
const ascii = s => new TextEncoder().encode(s);
const cat = (...parts) => { const n = parts.reduce((s, p) => s + p.length, 0), r = new Uint8Array(n); let o = 0; for (const p of parts) { r.set(p, o); o += p.length; } return r; };
let crcT = null;
function crc32(b) {
  if (!crcT) { crcT = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; } }
  let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function jpegWithMeta(b, exif, xmp, icc) {
  const seg = (marker, payload) => { const r = new Uint8Array(4 + payload.length); r[0] = 0xFF; r[1] = marker; r[2] = (payload.length + 2) >> 8; r[3] = (payload.length + 2) & 255; r.set(payload, 4); return r; };
  let at = 2;
  if (b[2] === 0xFF && b[3] === 0xE0) at = 4 + (b[4] << 8 | b[5]); // setelah APP0 JFIF
  const parts = [seg(0xE1, cat(ascii('Exif\0\0'), exif))];
  const xb = cat(ascii('http://ns.adobe.com/xap/1.0/\0'), ascii(xmp));
  if (xb.length < 65533) parts.push(seg(0xE1, xb));
  parts.push(seg(0xE2, cat(ascii('ICC_PROFILE\0'), new Uint8Array([1, 1]), icc)));
  return cat(b.subarray(0, at), ...parts, b.subarray(at));
}
function pngWithMeta(b, exif, xmp) {
  const chunk = (type, data) => { const t = ascii(type), r = new Uint8Array(12 + data.length), dv = new DataView(r.buffer); dv.setUint32(0, data.length); r.set(t, 4); r.set(data, 8); dv.setUint32(8 + data.length, crc32(cat(t, data))); return r; };
  const has = ty => { for (let o = 8; o + 8 <= b.length;) { const n = new DataView(b.buffer, b.byteOffset).getUint32(o), t = String.fromCharCode(...b.subarray(o + 4, o + 8)); if (t === ty) return true; if (t === 'IDAT') return false; o += 12 + n; } return false; };
  const ihdrEnd = 8 + 12 + new DataView(b.buffer, b.byteOffset).getUint32(8);
  const add = [];
  if (!has('sRGB') && !has('iCCP')) add.push(chunk('sRGB', new Uint8Array([0])));
  add.push(chunk('eXIf', exif));
  add.push(chunk('iTXt', cat(ascii('XML:com.adobe.xmp\0'), new Uint8Array([0, 0, 0, 0]), ascii(xmp))));
  return cat(b.subarray(0, ihdrEnd), ...add, b.subarray(ihdrEnd));
}
function webpWithMeta(b, exif, xmp, icc, w, h) {
  const chunks = [];
  for (let o = 12; o + 8 <= b.length;) {
    const ty = String.fromCharCode(...b.subarray(o, o + 4)), n = b[o + 4] | b[o + 5] << 8 | b[o + 6] << 16 | b[o + 7] << 24;
    chunks.push({ ty, data: b.subarray(o + 8, o + 8 + n) });
    o += 8 + n + (n & 1);
  }
  const mkc = (ty, data) => { const pad = data.length & 1, r = new Uint8Array(8 + data.length + pad), dv = new DataView(r.buffer); r.set(ascii(ty)); dv.setUint32(4, data.length, true); r.set(data, 8); return r; };
  let vp8x = chunks.find(c => c.ty === 'VP8X');
  const alpha = chunks.some(c => c.ty === 'ALPH') || (vp8x && vp8x.data[0] & 0x10) || chunks.some(c => c.ty === 'VP8L' && (c.data[4] >> 4) & 1);
  const x = new Uint8Array(10);
  x[0] = 0x20 | 0x08 | 0x04 | (alpha ? 0x10 : 0); // ICC, EXIF, XMP (+alpha)
  x[4] = (w - 1) & 255; x[5] = (w - 1) >> 8 & 255; x[6] = (w - 1) >> 16 & 255;
  x[7] = (h - 1) & 255; x[8] = (h - 1) >> 8 & 255; x[9] = (h - 1) >> 16 & 255;
  const img = chunks.filter(c => !['VP8X', 'ICCP', 'EXIF', 'XMP '].includes(c.ty));
  const body = cat(ascii('WEBP'), mkc('VP8X', x), mkc('ICCP', icc), ...img.map(c => mkc(c.ty, c.data)), mkc('EXIF', exif), mkc('XMP ', ascii(xmp)));
  const head = new Uint8Array(8); head.set(ascii('RIFF')); new DataView(head.buffer).setUint32(4, body.length, true);
  return cat(head, body);
}

/* Tambahkan metadata ke blob hasil canvas. Mencatat event export di riwayat proyek (instanceID baru). */
async function embedMeta(blob, mime, w, h, v) {
  const m = ensureMeta(), when = nowIso(), iid = 'xmp.iid:' + uuid();
  m.history.push({ action: 'converted', parameters: 'from application/vnd.lapis to ' + mime });
  m.history.push({ action: 'saved', instanceID: iid, when, softwareAgent: LAPIS_AGENT, changed: '/' });
  if (m.history.length > 60) m.history = m.history.slice(-60);
  const src = m.src || {};
  const info = { ...v, when, iid, mime, w, h, created: m.created, dateOriginal: src.dateOriginal ? src.dateOriginal.replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T') : '', make: src.make || '', model: src.model || '' };
  const b = new Uint8Array(await blob.arrayBuffer()), xmp = buildXMP(m, info), exif = buildExif(info);
  let out = b;
  if (mime === 'image/jpeg') out = jpegWithMeta(b, exif, xmp, buildSRGB());
  else if (mime === 'image/png') out = pngWithMeta(b, exif, xmp);
  else if (mime === 'image/webp') out = webpWithMeta(b, exif, xmp, buildSRGB(), w, h);
  scheduleAutosave();
  return new Blob([out], { type: mime });
}
