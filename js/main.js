'use strict';
/* Event: pointer, keyboard, wheel, drag & drop, paste. */

const view = $('#view');
let dragTool = null;

function evPt(e) {
  const r = view.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
  return { sx, sy, x: (sx - S.panX) / S.zoom, y: (sy - S.panY) / S.zoom, pr: e.pointerType === 'mouse' ? 1 : (e.pressure || 0.5) };
}
/* Sentuh: dua jari = geser + pinch zoom (goresan satu jari yang baru dimulai dibatalkan). */
const touches = new Map();
let pinch = null;
function pinchState() {
  const [a, b] = [...touches.values()], r = view.getBoundingClientRect();
  return { cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
}
view.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'touch' || !D) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) {
    if (dragTool) { // jari pertama ternyata awal gestur: akhiri alatnya, dan batalkan goresannya bila baru saja dimulai
      if (dragTool.up) dragTool.up(evPt(e), e);
      dragTool = null;
      if (view._hAdded && pinchUndoable()) undo();
    }
    pinch = pinchState();
  }
}, true);
view.addEventListener('pointermove', e => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && touches.size >= 2) {
    const p = pinchState();
    S.panX += p.cx - pinch.cx; S.panY += p.cy - pinch.cy;
    zoomAt(p.cx, p.cy, p.d / pinch.d);
    pinch = p; e.stopImmediatePropagation();
  }
}, true);
const touchEnd = e => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; };
view.addEventListener('pointerup', touchEnd, true);
view.addEventListener('pointercancel', touchEnd, true);
let downAt = 0;
function pinchUndoable() { return performance.now() - downAt < 400; } // hanya bila goresan baru saja dimulai

view.addEventListener('pointerdown', e => {
  if (!D) return;
  e.preventDefault();
  if (pinch) return; // jari kedua: gestur, bukan alat
  downAt = performance.now();
  const hBefore = H.past.length;
  if (S.pick && e.button === 0) { pickWB(evPt(e)); return; }
  view.setPointerCapture(e.pointerId);
  dragTool = S.spaceDown || e.button === 1 ? TOOLS.hand : e.button === 0 ? TOOLS[S.tool] : null;
  if (dragTool && dragTool.down) dragTool.down(evPt(e), e);
  view._hAdded = H.past.length > hBefore;
  requestView();
});
view.addEventListener('pointermove', e => {
  if (!D) return;
  const p = evPt(e);
  S.hover = p;
  if (dragTool && dragTool.move) {
    if (dragTool.ring && e.getCoalescedEvents) {
      const evs = e.getCoalescedEvents();
      for (const ce of evs.length ? evs : [e]) dragTool.move(evPt(ce), e);
    } else dragTool.move(p, e);
  }
  requestView();
});
const endDrag = e => {
  if (dragTool && dragTool.up) dragTool.up(evPt(e), e);
  dragTool = null;
  requestView();
};
view.addEventListener('pointerup', endDrag);
view.addEventListener('pointercancel', endDrag);
view.addEventListener('pointerleave', () => { S.hover = null; requestView(); });
view.addEventListener('contextmenu', e => e.preventDefault());
view.addEventListener('wheel', e => {
  if (!D) return;
  e.preventDefault();
  const p = evPt(e);
  if (e.ctrlKey || e.metaKey) zoomAt(p.sx, p.sy, Math.exp(-e.deltaY * 0.01));
  else { S.panX -= e.deltaX; S.panY -= e.deltaY; requestView(); }
}, { passive: false });

/* ---------- Keyboard ---------- */
const KEY_TOOLS = {};
for (const [id, , k] of TOOL_LIST) (KEY_TOOLS[k] = KEY_TOOLS[k] || []).push(id);

addEventListener('keydown', e => {
  if (!$('#modal').hidden) return;
  const inField = !!(e.target.matches && e.target.matches('input, textarea, select'));
  if (inField && e.key !== 'Escape') return;
  const c = e.ctrlKey || e.metaKey;
  const k = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.code.startsWith('Digit') ? e.code.slice(5) : e.key.toLowerCase();
  const run = f => { e.preventDefault(); f(); };

  if (e.code === 'Space' && !c) { S.spaceDown = true; e.preventDefault(); return; }
  if (c) {
    if (k === 'o') return run(() => openFile(false));
    if (k === 'n' && e.altKey) return run(newDocDialog);
    if (!D) return;
    switch (k) {
      case 'z': return run(e.shiftKey ? redo : undo);
      case 'y': return run(redo);
      case 's': return run(saveProject);
      case 'a': return run(e.shiftKey ? () => addAdjust('raw') : selectAll);
      case 'd': return run(deselect);
      case 'i': if (e.shiftKey) return run(invertSel); break;
      case 'j': return run(duplicateLayer);
      case 'e': return run(e.shiftKey ? exportDialog : mergeDown);
      case 'm': return run(() => addAdjust('curves'));
      case 'l': return run(() => addAdjust('levels'));
      case 'u': return run(e.altKey ? upscaleDialog : () => addAdjust('hsl'));
      case 'b': return run(() => addAdjust('balance'));
      case 'r': if (e.altKey) return run(selectAndMask); break;
      case '0': return run(fitView);
      case '1': return run(zoom100);
      case '=': case '+': case 'equal': return run(() => zoomCenter(1.25));
      case '-': case 'minus': return run(() => zoomCenter(0.8));
    }
    return;
  }
  if (!D) return;
  if (k === 'n' && e.altKey && e.shiftKey) return run(addEmptyLayer);
  if (e.key === 'Enter') {
    if (S.tool === 'crop') return run(() => TOOLS.crop.apply());
    if (T) return run(commitTransform);
    if (S.tool === 'pen' && curPath()) return run(() => pathToSel('new'));
  }
  if (e.key === 'Escape') {
    if (inField) { e.target.blur(); return; }
    if (S.pick) return run(() => { endWBPick(); renderProps(); });
    if (T) return run(cancelTransform);
    if (S.tool === 'pen') return run(finishSub);
    if (S.tool === 'crop') return run(() => { TOOLS.crop.activate(); requestView(); });
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (S.tool === 'pen' && PS.sel && !e.shiftKey && !e.altKey) return run(deleteAnchor);
    if (e.shiftKey) return run(contentAwareFill);
    if (!S.sel && !e.altKey) return run(deleteLayer);
    return run(e.altKey ? fillSel : clearSel);
  }
  if (S.tool === 'move' && e.key.startsWith('Arrow')) {
    const l = AL();
    if (!l || l.type === 'adjust') return;
    const st = e.shiftKey ? 10 : 1, dx = e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, dy = e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0;
    pushH('Geser', 'nudge' + l.id);
    const o = l.type === 'text' ? { x: l.text.x, y: l.text.y } : l.type === 'smart' ? l.smart.quad : l.canvas;
    return run(() => nudgeLayer(l, o, l.mask, dx, dy));
  }
  if (e.key === '[' || e.key === ']') {
    const f = e.key === ']' ? 1.15 : 1 / 1.15;
    S.opt.size = clamp(Math.round(S.opt.size * f + (f > 1 ? 1 : -1)), 1, 500);
    syncOpt('size'); requestView();
    return;
  }
  if (k === 'x') return run(swapColors);
  if (k === 'd') return run(() => { S.fg = '#000000'; S.bg = '#ffffff'; updateColorUI(); });
  if (!e.altKey && KEY_TOOLS[k]) {
    const ids = KEY_TOOLS[k], cur = ids.indexOf(S.tool);
    return run(() => setTool(ids[cur < 0 ? 0 : (cur + 1) % ids.length]));
  }
});
addEventListener('keyup', e => { if (e.code === 'Space') S.spaceDown = false; });

/* ---------- Drag & drop, paste ---------- */
const stage = $('#stage');
stage.addEventListener('dragover', e => { e.preventDefault(); stage.classList.add('drop'); });
stage.addEventListener('dragleave', () => stage.classList.remove('drop'));
stage.addEventListener('drop', e => {
  e.preventDefault();
  stage.classList.remove('drop');
  const f = [...e.dataTransfer.files][0];
  if (f) handleImageFile(f, !!D);
});
addEventListener('paste', e => {
  if (e.target.matches && e.target.matches('input, textarea')) return;
  const it = [...(e.clipboardData ? e.clipboardData.items : [])].find(i => i.type.startsWith('image/'));
  if (!it) return;
  e.preventDefault();
  const f = it.getAsFile();
  if (f) handleImageFile(new File([f], 'tempelan.png', { type: f.type }), !!D);
});
addEventListener('beforeunload', e => { if (D && (AS.dirty || AS.busy)) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- Mulai ---------- */
new ResizeObserver(() => drawView()).observe(stage);
$('#undoBtn').onclick = undo;
$('#redoBtn').onclick = redo;
$('#sideToggle').onclick = () => document.body.classList.toggle('side-open');
$('#emptyOpen').onclick = () => openFile(false);
$('#emptyNew').onclick = newDocDialog;
renderMenus();
renderToolbar();
renderLayerBtns();
renderPathBtns();
setTool('brush');
refreshAll();
autoRestore();
