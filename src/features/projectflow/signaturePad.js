// src/features/projectflow/signaturePad.js
// Framework-freies Unterschrift-Feld auf <canvas>. Pointer-Events (Touch + Maus),
// HiDPI-scharf. toDataURL('image/png') → geht 1:1 an /api/tagesrapport (Feld `unterschrift`,
// das dort base64 → Bucket 'rapport-signatures' schreibt). isEmpty() für Pflichtprüfung.

export function createSignaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  let drawing = false, dirty = false, last = null;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // Vorhandene Zeichnung bewahren wäre komplex – bei Resize wird geleert (selten am Handy).
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0a1628';
    dirty = false;
  }

  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  }
  function start(e) { e.preventDefault(); drawing = true; last = pos(e); }
  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p; dirty = true;
  }
  function end() { drawing = false; }

  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  // Safari-Fallback (ältere iOS ohne Pointer-Events zuverlässig)
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);

  const ro = ('ResizeObserver' in window) ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(canvas); else window.addEventListener('resize', resize);
  resize();

  return {
    isEmpty: () => !dirty,
    clear: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; },
    toDataURL: () => (dirty ? canvas.toDataURL('image/png') : null),
    destroy: () => {
      canvas.removeEventListener('pointerdown', start);
      canvas.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      canvas.removeEventListener('touchstart', start);
      canvas.removeEventListener('touchmove', move);
      canvas.removeEventListener('touchend', end);
      if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
    },
  };
}
