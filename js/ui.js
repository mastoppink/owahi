'use strict';
/* Antarmuka: toolbar, opsi tool, panel properti, panel layer, menu, modal. */

const ICONS = {
  move: '<path d="M12 3v18M3 12h18M12 3 9.5 5.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>',
  rect: '<rect x="4" y="5" width="16" height="14" stroke-dasharray="3 2.5"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5" stroke-dasharray="3 2.5"/>',
  lasso: '<path d="M7.5 16.5C4 15 3 11 6 8.5s9.5-3 12 .5-1.5 7-6.5 7.5"/><path d="M8.5 16.5c-.5 2-1.5 3.5-3.5 4.5"/>',
  quick: '<path d="M4 20l6.5-6.5"/><circle cx="15" cy="9" r="5" stroke-dasharray="3 2.5"/>',
  wand: '<path d="M4 20 14.5 9.5"/><path d="M18 3v3M18 10v2M14 6.5h-2M22 6.5h-2M15 3.5l1.2 1.2M20.8 9.3l-1.2-1.2"/>',
  crop: '<path d="M6 2v16h16M2 6h16v16"/>',
  transform: '<rect x="5" y="5" width="14" height="14"/><rect x="3" y="3" width="4" height="4" fill="currentColor"/><rect x="17" y="3" width="4" height="4" fill="currentColor"/><rect x="3" y="17" width="4" height="4" fill="currentColor"/><rect x="17" y="17" width="4" height="4" fill="currentColor"/>',
  brush: '<path d="M18.5 3 21 5.5l-9 9L9.5 12z"/><path d="M9 13c-3 0-4 2-4 4s-1 3-2 4c3 0 7-.5 8-3.5"/>',
  eraser: '<path d="M8 20h12M4.5 15.5l9.5-9.5 5 5-9.5 9.5H8.5z"/><path d="m9 11 5 5"/>',
  gradient: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16M12 4v16M16 4v16" opacity=".45"/>',
  clone: '<path d="M9 3h6v5l3 3v3H6v-3l3-3z"/><path d="M5 17h14v4H5z"/>',
  heal: '<rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="M11 11h2M11 13h2"/>',
  spot: '<path d="M4 20 14 10"/><path d="M17 3l1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1z"/><circle cx="7.5" cy="7.5" r="2"/>',
  text: '<path d="M5 5h14M12 5v15M9 20h6"/>',
  pen: '<path d="M12 3l6 8-6 10-6-10z"/><circle cx="12" cy="12" r="1.5"/>',
  eyedropper: '<path d="m14 4 6 6M17 7 7 17l-3.5 1 1-3.5L14.5 4.5"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14c0 4-3 7-6 7-2.5 0-4.5-1.5-6-4l-1.5-2.5A1.5 1.5 0 0 1 6 13l2 1.5"/>',
  zoom: '<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6M10 7v6M7 10h6"/>',
};
const svg = inner => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

function renderToolbar() {
  const t = $('#tools');
  t.innerHTML = '';
  for (const [id, label] of TOOL_LIST) {
    t.append(el('button', { class: 'tool' + (S.tool === id ? ' on' : ''), title: label, 'aria-label': label, onclick: () => setTool(id), html: svg(ICONS[id]) }));
  }
  t.append(el('div', { class: 'colors' },
    el('input', { type: 'color', id: 'fgc', value: S.fg, title: 'Warna depan', 'aria-label': 'Warna depan', oninput: e => { S.fg = e.target.value; } }),
    el('input', { type: 'color', id: 'bgc', value: S.bg, title: 'Warna belakang', 'aria-label': 'Warna belakang', oninput: e => { S.bg = e.target.value; } }),
    el('button', { class: 'swap', title: 'Tukar warna (X)', 'aria-label': 'Tukar warna', onclick: swapColors }, '⇄')));
}
function swapColors() { [S.fg, S.bg] = [S.bg, S.fg]; updateColorUI(); }
function updateColorUI() { const f = $('#fgc'), b = $('#bgc'); if (f) f.value = S.fg; if (b) b.value = S.bg; }
function updateUndoBtns() { $('#undoBtn').disabled = !H.past.length; $('#redoBtn').disabled = !H.future.length; }

/* ---------- Kontrol kecil ---------- */
const fmtN = v => (Number.isInteger(v) || Math.abs(v) >= 10 ? String(Math.round(v)) : v.toFixed(2));
function row(label, ...kids) { return el('div', { class: 'row' }, el('span', { class: 'lbl' }, label), ...kids); }
function slider(label, val, min, max, step, on, unit = '') {
  const out = el('span', { class: 'val' }, fmtN(val) + unit);
  const r = el('input', { type: 'range', min, max, step, value: val, 'aria-label': label });
  r.addEventListener('input', () => { const v = +r.value; out.textContent = fmtN(v) + unit; on(v); });
  return el('label', { class: 'row slider' }, el('span', { class: 'lbl' }, label), r, out);
}
function colorIn(val, on) { return el('input', { type: 'color', value: val, oninput: e => on(e.target.value) }); }
function oSlider(label, key, min, max, step, { mul = 1, unit = '' } = {}) {
  const v = S.opt[key] * mul;
  const out = el('span', { class: 'val' }, fmtN(v) + unit);
  const r = el('input', { type: 'range', min, max, step, value: v, 'aria-label': label });
  r.oninput = () => { S.opt[key] = +r.value / mul; out.textContent = fmtN(+r.value) + unit; requestView(); };
  S.optEls[key] = { r, out, mul, unit };
  return el('label', { class: 'opt' }, el('span', {}, label), r, out);
}
function syncOpt(key) {
  const o = S.optEls && S.optEls[key];
  if (o) { o.r.value = S.opt[key] * o.mul; o.out.textContent = fmtN(S.opt[key] * o.mul) + o.unit; }
}
function oCheck(label, key) {
  return el('label', { class: 'opt chk' }, el('input', { type: 'checkbox', checked: !!S.opt[key], onchange: e => { S.opt[key] = e.target.checked; } }), label);
}
function oSelect(label, key, opts, on) {
  const s = el('select', { onchange: e => { S.opt[key] = e.target.value; on && on(); } }, ...opts.map(([v, t]) => el('option', { value: v, selected: S.opt[key] === v }, t)));
  return el('label', { class: 'opt' }, el('span', {}, label), s);
}
const oBtn = (label, fn, cls = '') => el('button', { class: 'btn ' + cls, onclick: fn }, label);
const hint = t => el('span', { class: 'hint' }, t);
function selModes() {
  return el('div', { class: 'seg', role: 'group', 'aria-label': 'Mode seleksi' },
    ...[['new', 'Baru'], ['add', 'Tambah'], ['sub', 'Kurangi'], ['int', 'Irisan']].map(([v, t]) =>
      el('button', { class: S.opt.selMode === v ? 'on' : '', onclick: () => { S.opt.selMode = v; renderOptions(); } }, t)));
}

/* ---------- Bar opsi tool ---------- */
const FONTS = [['system-ui, sans-serif', 'Sistem'], ['Arial, Helvetica, sans-serif', 'Arial'], ['Georgia, serif', 'Georgia'], ['"Times New Roman", serif', 'Times'], ['"Trebuchet MS", sans-serif', 'Trebuchet'], ['Verdana, sans-serif', 'Verdana'], ['Impact, sans-serif', 'Impact'], ['"Courier New", monospace', 'Courier'], ['"Comic Sans MS", cursive', 'Comic']];
function renderOptions() {
  const o = $('#options');
  o.innerHTML = '';
  S.optEls = {};
  const t = S.tool, def = TOOL_LIST.find(x => x[0] === t);
  o.append(el('strong', { class: 'tname' }, def[1].replace(/\s*\(.*\)/, '')));
  const add = (...k) => o.append(...k);
  const brushOpts = () => add(
    oSlider('Ukuran', 'size', 1, 500, 1, { unit: 'px' }), oSlider('Hardness', 'hard', 0, 100, 1, { mul: 100, unit: '%' }),
    oSlider('Opacity', 'opacity', 1, 100, 1, { mul: 100, unit: '%' }), oSlider('Flow', 'flow', 1, 100, 1, { mul: 100, unit: '%' }),
    oCheck('Tekanan pena', 'pressure'));
  const l = AL();
  switch (t) {
    case 'brush': case 'eraser':
      brushOpts();
      add(hint(S.editMask && l && l.mask ? 'Melukis di MASK: putih = tampil, hitam = sembunyi' : 'Melukis di layer aktif'));
      break;
    case 'clone': case 'heal':
      brushOpts(); add(oCheck('Sampel semua layer', 'sampleAll'), hint('Alt+klik untuk set titik sumber'));
      break;
    case 'spot':
      add(oSlider('Ukuran', 'size', 1, 500, 1, { unit: 'px' }), hint('Sapukan di atas noda/objek, lalu lepas'), oBtn('Content-Aware Fill seleksi', contentAwareFill));
      break;
    case 'rect': case 'ellipse': case 'lasso':
      add(selModes(), hint('Shift = tambah, Alt = kurangi'), oBtn('Select and Mask…', selectAndMask));
      break;
    case 'wand':
      add(selModes(), oSlider('Toleransi', 'tol', 0, 255, 1), oCheck('Bersambung', 'contig'), oBtn('Select Subject (AI)', selectSubject));
      break;
    case 'quick':
      add(oSlider('Ukuran', 'size', 1, 500, 1, { unit: 'px' }), oSlider('Toleransi', 'tol', 0, 255, 1),
        oBtn('Select Subject (AI)', selectSubject), oBtn('Select and Mask…', selectAndMask), hint('Alt = kurangi'));
      break;
    case 'crop': {
      add(oSelect('Rasio', 'ratio', [['free', 'Bebas'], ['orig', 'Asli'], ['1:1', '1:1'], ['4:5', '4:5'], ['3:2', '3:2'], ['16:9', '16:9'], ['9:16', '9:16']], () => TOOLS.crop.fitRatio()),
        oBtn('Terapkan (Enter)', () => TOOLS.crop.apply(), 'primary'), oBtn('Reset', () => { TOOLS.crop.activate(); requestView(); }));
      const inp = el('input', { type: 'number', value: 0, step: 0.1, min: -45, max: 45, class: 'num', 'aria-label': 'Sudut luruskan' });
      add(el('label', { class: 'opt' }, el('span', {}, 'Luruskan °'), inp), oBtn('Putar', () => straighten(+inp.value)),
        oBtn('⟲ 90°', () => docRotate(-90)), oBtn('⟳ 90°', () => docRotate(90)), oBtn('Flip H', () => docFlip(true)), oBtn('Flip V', () => docFlip(false)));
      break;
    }
    case 'transform':
      add(oCheck('Distort / perspektif', 'distort'),
        oBtn('Flip H', () => tfQuad(q => [q[1], q[0], q[3], q[2]])), oBtn('Flip V', () => tfQuad(q => [q[3], q[2], q[1], q[0]])), oBtn('Putar 90°', tfRotate90),
        oBtn('Terapkan (Enter)', commitTransform, 'primary'), oBtn('Batal (Esc)', cancelTransform),
        hint('Sudut = skala, sisi = regang, di luar = putar (Shift = 15°), Ctrl+sudut = distort'));
      break;
    case 'gradient':
      add(oSlider('Opacity', 'opacity', 1, 100, 1, { mul: 100, unit: '%' }), hint('Seret: warna depan → belakang. Di mask: tampil → sembunyi'));
      break;
    case 'text':
      add(oSelect('Font baru', 'font', FONTS), hint('Klik kanvas untuk teks baru, klik teks yang ada untuk mengedit'));
      break;
    case 'pen':
      add(oBtn('→ Seleksi (Enter)', pathToSelDialog, 'primary'), oBtn('Seleksi → Path', selToPathDialog), oBtn('Isi', pathFill), oBtn('Stroke', pathStroke), oBtn('+ Path baru', newPath),
        el('span', { class: 'hint', title: 'Klik = titik lurus · Seret = kurva · Klik titik awal = tutup path · Seret titik/handle = edit · Alt+seret handle = sudut tajam · Alt+klik titik = reset jadi sudut · Klik garis = tambah titik · Del = hapus titik terpilih · Ctrl+seret garis = pindahkan bagian path · Esc = selesai menggambar' },
          'Klik/seret = titik/kurva · seret titik = edit · Alt = sudut · Del = hapus titik · ⓘ'));
      break;
    case 'move': add(hint('Seret untuk menggeser layer aktif. Panah = 1 px, Shift+panah = 10 px')); break;
    case 'eyedropper': add(hint('Klik = warna depan, Alt+klik = warna belakang')); break;
    case 'hand': add(hint('Seret untuk menggeser tampilan. Scroll = geser, Ctrl+scroll / pinch = zoom'), oBtn('Pas layar', fitView), oBtn('100%', zoom100)); break;
    case 'zoom': add(hint('Klik = perbesar, Alt+klik = perkecil'), oBtn('Pas layar', fitView), oBtn('100%', zoom100)); break;
  }
}

/* ---------- Panel properti ---------- */
function blendSelect(l) {
  return el('select', { onchange: e => { pushH('Blend mode'); l.blend = e.target.value; touch(l); } },
    ...BLENDS.map(([v, t]) => el('option', { value: v, selected: l.blend === v }, t)));
}
function renderProps() {
  const p = $('#props');
  p.innerHTML = '';
  const l = AL();
  if (!l) { p.append(el('p', { class: 'muted' }, 'Buka foto untuk mulai.')); return; }
  p.append(row('Nama', el('input', { type: 'text', value: l.name, oninput: e => { l.name = e.target.value; refreshLayers(); } })));
  p.append(row('Blend', blendSelect(l)));
  p.append(slider('Opacity', Math.round(l.opacity * 100), 0, 100, 1, v => { pushH('Opacity', 'op' + l.id); l.opacity = v / 100; touch(l); }, '%'));
  if (l.mask) {
    p.append(el('div', { class: 'btnrow' },
      oBtn(S.editMask ? '● Edit mask' : '○ Edit mask', () => { S.editMask = !S.editMask; refreshAll(); }, S.editMask ? 'primary' : ''),
      oBtn('Invert', invertMask), oBtn('Terapkan', applyMask), oBtn('Hapus mask', removeMask)));
  }
  if (l.type === 'text') textUI(p, l);
  else if (l.type === 'adjust') adjustUI(p, l);
  else if (l.type === 'smart') smartUI(p, l);
  if (l.type !== 'adjust') stylesUI(p, l);
}
function section(p, title) { p.append(el('h4', {}, title)); }

function textUI(p, l) {
  const t = l.text;
  const chg = (f, key = 'tx') => { pushH('Edit teks', key + l.id); f(); touch(l); };
  section(p, 'Teks');
  p.append(el('textarea', { id: 'textEdit', rows: 3, 'aria-label': 'Isi teks', oninput: e => chg(() => { t.value = e.target.value; l.name = t.value.split('\n')[0].slice(0, 24) || 'Teks'; refreshLayers(); }) }, t.value));
  p.append(row('Font', el('select', { onchange: e => chg(() => { t.font = e.target.value; }, 'tf') }, ...FONTS.map(([v, n]) => el('option', { value: v, selected: t.font === v }, n)))));
  p.append(slider('Ukuran', t.size, 6, 600, 1, v => chg(() => { t.size = v; }, 'ts'), 'px'));
  p.append(row('Warna', colorIn(t.color, v => chg(() => { t.color = v; }, 'tc')),
    el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: t.bold, onchange: e => chg(() => { t.bold = e.target.checked; }, 'tb') }), 'Tebal'),
    el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: t.italic, onchange: e => chg(() => { t.italic = e.target.checked; }, 'ti') }), 'Miring')));
  p.append(row('Rata', el('select', { onchange: e => chg(() => { t.align = e.target.value; }, 'ta') },
    ...[['left', 'Kiri'], ['center', 'Tengah'], ['right', 'Kanan']].map(([v, n]) => el('option', { value: v, selected: t.align === v }, n)))));
  p.append(slider('Jarak baris', t.lh, 0.6, 3, 0.05, v => chg(() => { t.lh = v; }, 'tl')));
  p.append(slider('Jarak huruf', t.spacing || 0, -10, 50, 0.5, v => chg(() => { t.spacing = v; }, 'tsp'), 'px'));
}

function lumHist() {
  if (!S.comp || !D) return null;
  const d = compData().data, h = new Uint32Array(256), step = Math.max(1, Math.floor(d.length / 4 / 200000)) * 4;
  for (let i = 0; i < d.length; i += step) h[(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0]++;
  return h;
}
/* Histogram RGB + persentase clipping; ikut diperbarui setiap kali gambar dirender ulang. */
function drawHist(c, info) {
  const g = c.getContext('2d'), W = 256, Hh = 80;
  g.globalCompositeOperation = 'source-over'; g.fillStyle = '#17181b'; g.fillRect(0, 0, W, Hh);
  if (!S.comp || !D) return;
  const d = compData().data, hs = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const step = Math.max(1, Math.floor(d.length / 4 / 200000)) * 4;
  let n = 0, lo = 0, hi = 0;
  for (let i = 0; i < d.length; i += step) {
    if (d[i + 3] < 8) continue;
    hs[0][d[i]]++; hs[1][d[i + 1]]++; hs[2][d[i + 2]]++; n++;
    const mx = Math.max(d[i], d[i + 1], d[i + 2]);
    if (mx >= 254) hi++; else if (mx <= 3 && Math.min(d[i], d[i + 1], d[i + 2]) <= 1) lo++;
  }
  // skala akar supaya puncak tunggal tidak meratakan sisanya
  let mx = 1; for (const h of hs) for (let i = 1; i < 255; i++) mx = Math.max(mx, h[i]);
  const sm = Math.sqrt(mx);
  g.globalCompositeOperation = 'lighter';
  ['rgba(255,70,70,.75)', 'rgba(70,220,100,.75)', 'rgba(80,140,255,.8)'].forEach((col, k) => {
    g.fillStyle = col;
    for (let i = 0; i < 256; i++) { const v = Math.min(Hh, Math.sqrt(hs[k][i]) / sm * (Hh - 2)); g.fillRect(i, Hh - v, 1, v); }
  });
  g.globalCompositeOperation = 'source-over';
  const pl = n ? lo / n * 100 : 0, ph = n ? hi / n * 100 : 0;
  g.fillStyle = pl > 0.5 ? '#60a5fa' : '#3a3d44'; g.fillRect(0, 0, 8, 8);
  g.fillStyle = ph > 0.5 ? '#ff4a5e' : '#3a3d44'; g.fillRect(W - 8, 0, 8, 8);
  if (info) info.textContent = `Shadow terpotong ${pl.toFixed(1)}% · Highlight terpotong ${ph.toFixed(1)}%`;
}
let histT = 0;
function updateHists() {
  S.hists = S.hists.filter(h => h.c.isConnected);
  clearTimeout(histT);
  histT = setTimeout(() => S.hists.forEach(h => drawHist(h.c, h.info)), 60);
}
function histCanvas() {
  const c = el('canvas', { width: 256, height: 80, class: 'hist', 'aria-label': 'Histogram RGB' });
  const info = el('p', { class: 'muted small' });
  (S.hists = S.hists || []).push({ c, info });
  drawHist(c, info);
  const clip = el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: !!S.clip, onchange: e => { S.clip = e.target.checked; requestView(); } }), 'Tampilkan clipping di kanvas');
  return el('div', {}, c, info, clip);
}
function specSliders(p, l, spec, obj = l.adj, key = '') {
  for (const s of spec) {
    if (s.length === 1) { section(p, s[0]); continue; }
    const [k, label, min, max, step] = s;
    p.append(slider(label, obj[k], min, max, step, v => { pushH(label, 'adj' + key + k + l.id); obj[k] = v; touch(l); }));
  }
}
function hslUI(p, l) {
  const a = l.adj;
  a.bands = a.bands || {}; a.band = a.band || 'all';
  const sel = el('select', { 'aria-label': 'Rentang warna', onchange: e => { a.band = e.target.value; renderProps(); } },
    el('option', { value: 'all', selected: a.band === 'all' }, 'Semua warna'),
    ...HSL_BANDS.map(([k, n]) => el('option', { value: k, selected: a.band === k }, n + (a.bands[k] && (a.bands[k].hue || a.bands[k].sat || a.bands[k].light) ? ' •' : ''))));
  p.append(row('Rentang', sel));
  if (a.band === 'all') specSliders(p, l, HSL_SPEC);
  else specSliders(p, l, HSL_SPEC, a.bands[a.band] = a.bands[a.band] || { hue: 0, sat: 0, light: 0 }, a.band);
  if (a.band !== 'all') p.append(el('p', { class: 'muted small' }, 'Hanya warna ' + HSL_BANDS.find(b => b[0] === a.band)[1].toLowerCase() + ' yang berubah; transisi ke warna tetangga dibuat halus.'));
}
function adjustUI(p, l) {
  const a = l.adj;
  section(p, ADJ[a.kind].name);
  if (a.kind === 'curves') curvesUI(p, l);
  else if (a.kind === 'levels') {
    p.append(histCanvas(), el('div', { class: 'btnrow' }, oBtn('Auto', () => autoAdjust(l))));
    specSliders(p, l, LEVELS_SPEC);
  }
  else if (a.kind === 'hsl') hslUI(p, l);
  else if (a.kind === 'raw') {
    p.append(histCanvas(), el('div', { class: 'btnrow' }, oBtn('Auto', () => autoAdjust(l)), oBtn(S.pick ? 'Klik di kanvas…' : 'Pipet white balance', () => startWBPick(l))));
    specSliders(p, l, RAW_SPEC);
  }
  else if (a.kind === 'balance') {
    p.append(el('div', { class: 'seg' }, ...[['shadows', 'Shadows'], ['mid', 'Midtones'], ['high', 'Highlights']].map(([v, t]) =>
      el('button', { class: a.tone === v ? 'on' : '', onclick: () => { a.tone = v; renderProps(); } }, t))));
    const arr = a[a.tone];
    [['Cyan ↔ Merah', 0], ['Magenta ↔ Hijau', 1], ['Kuning ↔ Biru', 2]].forEach(([label, i]) =>
      p.append(slider(label, arr[i], -100, 100, 1, v => { pushH('Color Balance', 'cb' + a.tone + i + l.id); arr[i] = v; touch(l); })));
    p.append(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: a.preserve, onchange: e => { pushH('Color Balance'); a.preserve = e.target.checked; touch(l); } }), 'Pertahankan luminositas'));
  }
  p.append(el('div', { class: 'btnrow' }, oBtn('Reset', () => { pushH('Reset adjustment'); l.adj = Object.assign({ kind: a.kind }, ADJ[a.kind].def()); touch(l); renderProps(); }),
    oBtn(l.mask ? 'Mask dari seleksi' : 'Tambah mask', l.mask ? maskFromSel : addMask)));
  p.append(el('p', { class: 'muted small' }, 'Tips: lukis mask (hitam/putih) atau pakai Gradient di mask untuk efek lokal.'));
}
function curvesUI(p, l) {
  const a = l.adj, hist = lumHist();
  const col = { rgb: '#e6e7ea', r: '#ff6b6b', g: '#4ade80', b: '#60a5fa' };
  const chSel = el('select', {}, ...[['rgb', 'RGB'], ['r', 'Merah'], ['g', 'Hijau'], ['b', 'Biru']].map(([v, t]) => el('option', { value: v, selected: a.ch === v }, t)));
  const cv = el('canvas', { width: 256, height: 256, class: 'curve', 'aria-label': 'Editor kurva' }), g = cv.getContext('2d');
  function draw() {
    g.fillStyle = '#17181b'; g.fillRect(0, 0, 256, 256);
    if (hist) { const mx = Math.max(...hist) || 1; g.fillStyle = 'rgba(255,255,255,.1)'; for (let i = 0; i < 256; i++) { const v = hist[i] / mx * 240; g.fillRect(i, 256 - v, 1, v); } }
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1; g.beginPath();
    for (let i = 64; i < 256; i += 64) { g.moveTo(i + 0.5, 0); g.lineTo(i + 0.5, 256); g.moveTo(0, i + 0.5); g.lineTo(256, i + 0.5); }
    g.moveTo(0, 256); g.lineTo(256, 0); g.stroke();
    const lut = curveLUT(a.pts[a.ch]);
    g.strokeStyle = col[a.ch]; g.lineWidth = 2; g.beginPath();
    for (let x = 0; x < 256; x++) { const y = 255 - lut[x]; x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    g.fillStyle = col[a.ch];
    for (const [x, y] of a.pts[a.ch]) { g.beginPath(); g.arc(x, 255 - y, 4.5, 0, Math.PI * 2); g.fill(); }
  }
  chSel.onchange = () => { a.ch = chSel.value; draw(); };
  const pos = e => { const r = cv.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width * 256, y = 255 - (e.clientY - r.top) / r.height * 256; return [clamp(x, 0, 255), clamp(y, 0, 255), y]; };
  let di = -1;
  cv.onpointerdown = e => {
    cv.setPointerCapture(e.pointerId);
    const [x, y] = pos(e), pts = a.pts[a.ch];
    pushH('Curves');
    di = pts.findIndex(q => Math.hypot(q[0] - x, q[1] - y) < 12);
    if (di < 0) {
      const np = [Math.round(x), Math.round(y)];
      pts.push(np); pts.sort((q, r) => q[0] - r[0]); di = pts.indexOf(np);
    }
    touch(l); draw();
  };
  cv.onpointermove = e => {
    if (di < 0) return;
    const pts = a.pts[a.ch], [x, y, ry] = pos(e);
    const inner = di > 0 && di < pts.length - 1;
    if (inner && (ry < -24 || ry > 280)) { pts.splice(di, 1); di = -1; }
    else {
      const lo = di > 0 ? pts[di - 1][0] + 1 : 0, hi = di < pts.length - 1 ? pts[di + 1][0] - 1 : 255;
      pts[di] = [clamp(Math.round(x), lo, hi), Math.round(y)];
    }
    touch(l); draw();
  };
  cv.onpointerup = () => { di = -1; };
  draw();
  p.append(row('Channel', chSel), cv, el('p', { class: 'muted small' }, 'Klik untuk menambah titik. Seret titik keluar kotak untuk menghapus.'));
}
function smartUI(p, l) {
  const s = l.smart;
  section(p, 'Smart Filter');
  if (!s.filters.length) p.append(el('p', { class: 'muted small' }, 'Belum ada filter. Filter di sini bisa diubah atau dihapus kapan saja.'));
  s.filters.forEach((f, i) => {
    const F = FILTERS[f.kind];
    const box = el('div', { class: 'filter' },
      el('div', { class: 'frow' },
        el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: f.on !== false, onchange: e => { pushH('Smart filter'); f.on = e.target.checked; touch(l); } }), F.name),
        el('button', { class: 'icon-btn small', title: 'Hapus filter', 'aria-label': 'Hapus filter', onclick: () => { pushH('Hapus filter'); s.filters.splice(i, 1); touch(l); renderProps(); } }, '✕')));
    if (F.max) box.append(slider(F.params ? 'Amount' : 'Nilai', f.amount, F.min, F.max, 1, v => { pushH('Smart filter', 'sf' + i + l.id); f.amount = v; touch(l); }, F.unit));
    for (const [k, label, mn, mx, stp, def, unit] of F.params || [])
      box.append(slider(label, f[k] ?? def, mn, mx, stp, v => { pushH('Smart filter', 'sf' + k + i + l.id); f[k] = v; touch(l); }, unit));
    p.append(box);
  });
  p.append(row('Tambah', el('select', { onchange: e => { if (!e.target.value) return; filterCmd(e.target.value); e.target.value = ''; } },
    el('option', { value: '' }, 'Pilih filter…'), ...Object.entries(FILTERS).map(([k, F]) => el('option', { value: k }, F.name)))));
}
function stylesUI(p, l) {
  const st = l.styles;
  const chg = (f, key) => { pushH('Layer style', 'st' + key + l.id); f(); touch(l); };
  section(p, 'Layer Style');
  const sec = (key, title, build) => {
    const s = st[key];
    const cb = el('input', { type: 'checkbox', checked: s.on, 'aria-label': title, onclick: e => e.stopPropagation(), onchange: e => chg(() => { s.on = e.target.checked; }, key + 'on') });
    const d = el('details', { class: 'style', open: s.on || null }, el('summary', {}, cb, ' ' + title));
    build(d, s, key);
    p.append(d);
  };
  sec('shadow', 'Drop Shadow', (d, s, k) => d.append(
    row('Warna', colorIn(s.color, v => chg(() => { s.color = v; }, k + 'c'))),
    slider('Opacity', Math.round(s.opacity * 100), 0, 100, 1, v => chg(() => { s.opacity = v / 100; }, k + 'o'), '%'),
    slider('Jarak', s.dist, 0, 200, 1, v => chg(() => { s.dist = v; }, k + 'd'), 'px'),
    slider('Sudut', s.angle, 0, 360, 1, v => chg(() => { s.angle = v; }, k + 'a'), '°'),
    slider('Blur', s.blur, 0, 100, 1, v => chg(() => { s.blur = v; }, k + 'b'), 'px')));
  sec('stroke', 'Stroke', (d, s, k) => d.append(
    row('Warna', colorIn(s.color, v => chg(() => { s.color = v; }, k + 'c'))),
    slider('Tebal', s.size, 1, 50, 1, v => chg(() => { s.size = v; }, k + 's'), 'px')));
  sec('glow', 'Outer Glow', (d, s, k) => d.append(
    row('Warna', colorIn(s.color, v => chg(() => { s.color = v; }, k + 'c'))),
    slider('Opacity', Math.round(s.opacity * 100), 0, 100, 1, v => chg(() => { s.opacity = v / 100; }, k + 'o'), '%'),
    slider('Ukuran', s.blur, 1, 100, 1, v => chg(() => { s.blur = v; }, k + 'b'), 'px')));
  sec('overlay', 'Color Overlay', (d, s, k) => d.append(
    row('Warna', colorIn(s.color, v => chg(() => { s.color = v; }, k + 'c'))),
    slider('Opacity', Math.round(s.opacity * 100), 0, 100, 1, v => chg(() => { s.opacity = v / 100; }, k + 'o'), '%')));
}

/* ---------- Panel layer ---------- */
function thumb(src, active) {
  const c = el('canvas', { width: 48, height: 36, class: active ? 'sel' : '' }), g = c.getContext('2d');
  if (src && D) { const s = Math.min(48 / D.w, 36 / D.h), w = D.w * s, h = D.h * s; g.drawImage(src, (48 - w) / 2, (36 - h) / 2, w, h); }
  return c;
}
function maskThumb(m, active) {
  const c = el('canvas', { width: 48, height: 36, class: 'mask' + (active ? ' sel' : '') }), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 48, 36);
  const s = Math.min(48 / D.w, 36 / D.h), w = D.w * s, h = D.h * s;
  g.drawImage(silhouette(m, '#fff'), (48 - w) / 2, (36 - h) / 2, w, h);
  return c;
}
let dragIdx = -1;
function refreshLayers() {
  const box = $('#layers');
  box.innerHTML = '';
  if (!D) return;
  for (let i = D.layers.length - 1; i >= 0; i--) {
    const l = D.layers[i], act = i === D.active;
    const r = el('div', { class: 'layer' + (act ? ' active' : ''), draggable: 'true', role: 'button', tabindex: '0', 'aria-label': 'Layer ' + l.name });
    r.append(el('button', { class: 'eye' + (l.visible ? '' : ' off'), title: l.visible ? 'Sembunyikan' : 'Tampilkan', 'aria-label': 'Tampil/sembunyi', onclick: e => { e.stopPropagation(); pushH('Visibilitas'); l.visible = !l.visible; touch(l); refreshLayers(); } }, l.visible ? '👁' : '–'));
    if (l.type === 'adjust') r.append(el('div', { class: 'adj-ico', title: ADJ[l.adj.kind].name }, '◐'));
    else r.append(thumb(layerContent(l), act && !S.editMask));
    if (l.mask) {
      const mt = maskThumb(l.mask, act && S.editMask);
      mt.title = 'Klik untuk mengedit mask';
      mt.addEventListener('click', e => { e.stopPropagation(); if (T) commitTransform(); D.active = i; S.editMask = true; refreshAll(); });
      r.append(mt);
    }
    const badge = { text: 'T', smart: 'SO', adjust: 'ADJ' }[l.type];
    r.append(el('span', { class: 'lname' }, l.name));
    if (badge) r.append(el('span', { class: 'badge' }, badge));
    r.addEventListener('click', () => selectLayer(i));
    r.addEventListener('keydown', e => { if (e.key === 'Enter') selectLayer(i); });
    r.addEventListener('dblclick', () => { const n = prompt('Nama layer', l.name); if (n) { l.name = n; refreshAll(); } });
    r.addEventListener('dragstart', e => { dragIdx = i; e.dataTransfer.effectAllowed = 'move'; });
    r.addEventListener('dragover', e => { e.preventDefault(); r.classList.add('over'); });
    r.addEventListener('dragleave', () => r.classList.remove('over'));
    r.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); r.classList.remove('over'); moveLayer(dragIdx, i); });
    box.append(r);
  }
}
function moveLayer(from, to) {
  if (from < 0 || from === to) return;
  pushH('Urutan layer');
  const [l] = D.layers.splice(from, 1);
  D.layers.splice(to, 0, l);
  D.active = to;
  requestRender(); refreshAll();
}
function renderLayerBtns() {
  const b = $('#layerBtns');
  b.innerHTML = '';
  const adjSel = el('select', { 'aria-label': 'Tambah adjustment', onchange: e => { if (e.target.value) addAdjust(e.target.value); e.target.value = ''; } },
    el('option', { value: '' }, '◐ Adjustment…'), ...Object.entries(ADJ).map(([k, a]) => el('option', { value: k }, a.name)));
  b.append(
    el('button', { class: 'btn', title: 'Layer baru', onclick: addEmptyLayer }, '+ Layer'),
    adjSel,
    el('button', { class: 'btn', title: 'Tambah mask', onclick: addMask }, 'Mask'),
    el('button', { class: 'btn', title: 'Jadikan Smart Object', onclick: toSmart }, 'Smart'),
    el('button', { class: 'btn', title: 'Duplikat (Ctrl+J)', onclick: duplicateLayer }, 'Duplikat'),
    el('button', { class: 'btn danger', title: 'Hapus layer', onclick: deleteLayer }, 'Hapus'));
}
function refreshAll() {
  if (D) scheduleAutosave();
  refreshLayers(); refreshPaths(); renderProps(); renderOptions(); updateUndoBtns(); requestRender();
}

/* ---------- Menu ---------- */
const menuDefs = () => [
  ['File', [
    ['Dokumen baru…', () => newDocDialog(), 'Ctrl+Alt+N'], ['Buka foto…', () => openFile(false), 'Ctrl+O'], ['Tambah foto sebagai layer…', () => openFile(true)], '-',
    ['Buka proyek (.lapis)…', openProject], ['Simpan proyek (.lapis)', saveProject, 'Ctrl+S'], '-', ['Export gambar…', exportDialog, 'Ctrl+Shift+E'], '-', ['Tutup dokumen', closeDoc]]],
  ['Edit', [
    ['Undo', undo, 'Ctrl+Z'], ['Redo', redo, 'Ctrl+Shift+Z'], '-',
    ['Free Transform', () => setTool('transform'), 'F'], ['Isi seleksi dengan warna', fillSel, 'Alt+Del'], ['Hapus isi seleksi', clearSel, 'Del'], '-',
    ['Content-Aware Fill', contentAwareFill, 'Shift+Del'], ['Generative Fill (AI)…', genFillDialog], ['Pengaturan AI…', aiSettings]]],
  ['Gambar', [
    ['AI Upscale (sampai 4K)…', upscaleDialog, 'Ctrl+Alt+U'], '-', ['Ukuran gambar…', resizeDialog], ['Putar 90° kanan', () => docRotate(90)], ['Putar 90° kiri', () => docRotate(-90)],
    ['Balik horizontal', () => docFlip(true)], ['Balik vertikal', () => docFlip(false)]]],
  ['Layer', [
    ['Layer baru', addEmptyLayer, 'Alt+Shift+N'], ['Duplikat / salin seleksi', duplicateLayer, 'Ctrl+J'], ['Hapus layer', deleteLayer], '-',
    ['Tambah mask', addMask], ['Mask dari seleksi', maskFromSel], ['Invert mask', invertMask], ['Terapkan mask', applyMask], ['Hapus mask', removeMask], '-',
    ['Curves', () => addAdjust('curves'), 'Ctrl+M'], ['Levels', () => addAdjust('levels'), 'Ctrl+L'], ['Hue/Saturation', () => addAdjust('hsl'), 'Ctrl+U'],
    ['Color Balance', () => addAdjust('balance'), 'Ctrl+B'], ['Camera Raw', () => addAdjust('raw'), 'Ctrl+Shift+A'], '-',
    ['Jadikan Smart Object', toSmart], ['Rasterize', rasterize], ['Gabung ke bawah', mergeDown, 'Ctrl+E'], ['Ratakan gambar', flatten]]],
  ['Seleksi', [
    ['Pilih semua', selectAll, 'Ctrl+A'], ['Batal pilih', deselect, 'Ctrl+D'], ['Balik seleksi', invertSel, 'Ctrl+Shift+I'], '-',
    ['Path → Seleksi…', pathToSelDialog, 'Enter (Pen)'], ['Seleksi → Path…', selToPathDialog], '-',
    ['Select Subject (AI)', selectSubject], ['Select and Mask…', selectAndMask, 'Ctrl+Alt+R'], ['Feather…', featherDialog], ['Perluas / persempit…', growDialog]]],
  ['Filter', Object.entries(FILTERS).map(([k, F]) => [F.name + (F.max ? '…' : ''), () => filterCmd(k)])],
  ['Tampilan', [['Perbesar', () => zoomCenter(1.25), 'Ctrl+='], ['Perkecil', () => zoomCenter(0.8), 'Ctrl+-'], ['Pas layar', fitView, 'Ctrl+0'], ['100%', zoom100, 'Ctrl+1']]],
];
function renderMenus() {
  const nav = $('#menus');
  nav.innerHTML = '';
  const closeAll = () => $$('.menu.open').forEach(m => m.classList.remove('open'));
  for (const [title, items] of menuDefs()) {
    const dd = el('div', { class: 'dropdown', role: 'menu' });
    for (const it of items) {
      if (it === '-') { dd.append(el('hr')); continue; }
      const [label, fn, key] = it;
      dd.append(el('button', { role: 'menuitem', onclick: () => { closeAll(); if (!D && !/baru|Buka/.test(label)) { toast('Buka foto dulu.'); return; } fn(); } }, el('span', {}, label), key ? el('kbd', {}, key) : null));
    }
    const m = el('div', { class: 'menu' });
    const b = el('button', { 'aria-haspopup': 'true', onclick: e => { e.stopPropagation(); const open = m.classList.contains('open'); closeAll(); if (!open) m.classList.add('open'); } }, title);
    b.addEventListener('pointerenter', () => { if ($('.menu.open') && !m.classList.contains('open')) { closeAll(); m.classList.add('open'); } });
    m.append(b, dd);
    nav.append(m);
  }
  document.addEventListener('click', e => { if (!e.target.closest('.menu')) closeAll(); });
}

/* ---------- Modal ---------- */
function modal(title, body, onOk, okText = 'OK') {
  const m = $('#modal');
  m.querySelector('h2').textContent = title;
  const b = m.querySelector('.body');
  b.innerHTML = ''; b.append(body);
  const ok = m.querySelector('.ok'), ca = m.querySelector('.cancel');
  ok.textContent = okText;
  m.hidden = false;
  setTimeout(() => { const f = b.querySelector('input,textarea,select'); (f || ok).focus(); }, 20);
  return new Promise(res => {
    const close = v => { m.hidden = true; ok.onclick = ca.onclick = null; m.onkeydown = null; res(v); };
    ok.onclick = async () => { const r = onOk ? await onOk() : true; if (r !== false) close(true); };
    ca.onclick = () => close(false);
    m.onkeydown = e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(false); }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); e.stopPropagation(); ok.click(); }
    };
  });
}
