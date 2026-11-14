'use strict';
/* Helper umum: DOM, kanvas, warna, blur. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
function cx(c) { return c.getContext('2d'); }
function cloneCanvas(c) { const n = mk(c.width, c.height); cx(n).drawImage(c, 0, 0); return n; }
function cropCanvas(c, r) { const n = mk(r.w, r.h); cx(n).drawImage(c, -r.x, -r.y); return n; }
function shifted(c, dx, dy) { const n = mk(c.width, c.height); cx(n).drawImage(c, dx, dy); return n; }

function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgb2hex(r, g, b) { return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1); }
function lum(hex) { const [r, g, b] = hex2rgb(hex); return 0.299 * r + 0.587 * g + 0.114 * b; }

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
}

let toastT;
function toast(m) {
  const t = $('#toast');
  t.textContent = m;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2800);
}

async function busy(msg, fn) {
  const b = $('#busy');
  b.querySelector('span').textContent = msg;
  b.hidden = false;
  await new Promise(r => setTimeout(r, 40));
  try { return await fn(); }
  catch (e) { console.error(e); toast('Gagal: ' + (e.message || e)); }
  finally { b.hidden = true; }
}

/* ---------- Blur (box blur 3x ≈ gaussian) ---------- */
function boxPass(s, d, w, h, r) {
  const iw = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let acc = s[o] * (r + 1);
    for (let x = 1; x <= r; x++) acc += s[o + Math.min(x, w - 1)];
    for (let x = 0; x < w; x++) {
      d[o + x] = acc * iw;
      acc += s[o + Math.min(x + r + 1, w - 1)] - s[o + Math.max(x - r, 0)];
    }
  }
}
function boxPassV(s, d, w, h, r) {
  const iw = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let acc = s[x] * (r + 1);
    for (let y = 1; y <= r; y++) acc += s[Math.min(y, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      d[y * w + x] = acc * iw;
      acc += s[Math.min(y + r + 1, h - 1) * w + x] - s[Math.max(y - r, 0) * w + x];
    }
  }
}
function boxMean(a, w, h, r) {
  const t = new Float32Array(a.length), o = new Float32Array(a.length);
  boxPass(a, t, w, h, r); boxPassV(t, o, w, h, r);
  return o;
}
function gaussBlur(a, w, h, radius) {
  if (radius < 0.5) return Float32Array.from(a);
  const r = Math.max(1, Math.round(radius / 1.7));
  return boxMean(boxMean(boxMean(a, w, h, r), w, h, r), w, h, r);
}

function blurCanvas(c, radius) {
  const w = c.width, h = c.height;
  if (radius < 0.5) return cloneCanvas(c);
  const d = cx(c).getImageData(0, 0, w, h).data, n = w * h;
  const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = d[j + 3] / 255;
    ch[0][i] = d[j] * a; ch[1][i] = d[j + 1] * a; ch[2][i] = d[j + 2] * a; ch[3][i] = d[j + 3];
  }
  const b = ch.map(x => gaussBlur(x, w, h, radius));
  const o = new ImageData(w, h), od = o.data;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const A = b[3][i];
    od[j + 3] = A;
    if (A > 0) { const s = 255 / A; od[j] = b[0][i] * s; od[j + 1] = b[1][i] * s; od[j + 2] = b[2][i] * s; }
  }
  const out = mk(w, h);
  cx(out).putImageData(o, 0, 0);
  return out;
}

function silhouette(c, color) {
  const n = cloneCanvas(c), g = cx(n);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, n.width, n.height);
  return n;
}
function maskInto(c, m) {
  const g = cx(c);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(m, 0, 0);
  g.globalCompositeOperation = 'source-over';
}
function dilateCanvas(c, px) {
  const n = mk(c.width, c.height), g = cx(n);
  g.drawImage(c, 0, 0);
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; g.drawImage(c, Math.cos(a) * px, Math.sin(a) * px); }
  return n;
}
function canvasBounds(c, th = 0) {
  const w = c.width, h = c.height, d = cx(c).getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const o = y * w * 4;
    for (let x = 0; x < w; x++) if (d[o + x * 4 + 3] > th) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* Baca alpha / gray di resolusi kerja (w,h) sebagai Float32 0..1 */
function alphaArray(c, w, h) {
  const t = mk(w, h), g = cx(t);
  g.drawImage(c, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, a = new Float32Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
  return a;
}
function grayArray(c, w, h) {
  const t = mk(w, h), g = cx(t);
  g.drawImage(c, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, a = new Float32Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  return a;
}

function toBlob(c, type = 'image/png', q) { return new Promise(r => c.toBlob(r, type, q)); }
function download(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function loadImg(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    if (/^https?:/.test(src)) i.crossOrigin = 'anonymous';
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Gambar tidak bisa dibaca'));
    i.src = src;
  });
}
async function fileToImg(f) {
  const u = URL.createObjectURL(f);
  try { return await loadImg(u); } finally { setTimeout(() => URL.revokeObjectURL(u), 2000); }
}
