// src/features/projectflow/voiceMemo.js
// Sprachmemo – exakt wie im bestehenden Cockpit: MediaRecorder nimmt auf, Audio → base64 →
// POST /api/voice {action:'stt'} (ElevenLabs scribe). Schlägt das fehl (Key/Permission) oder
// fehlt MediaRecorder, wird auf die Browser-Spracherkennung (webkitSpeechRecognition, de-DE)
// zurückgefallen – identisch zur bestehenden Tap-to-Talk-Logik.
//
// createVoiceMemo({ stt })  →  { supported, start(), stop(), toggle(), recording }
//   Callbacks über opts: onStart, onText(text), onError(msg), onState(recording)

export function createVoiceMemo({ stt, onStart, onText, onError, onState } = {}) {
  let mediaRecorder = null, chunks = [], recording = false, stream = null;
  let recog = null;

  const hasMR = typeof window !== 'undefined' && 'MediaRecorder' in window && navigator.mediaDevices?.getUserMedia;
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const supported = !!(hasMR || SR);

  function setRec(v) { recording = v; onState && onState(v); }

  function pickMime() {
    const cands = ['audio/webm', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/ogg'];
    for (const m of cands) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {} }
    return '';
  }

  async function startMR() {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = pickMime();
    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stopStream();
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      setRec(false);
      if (!blob.size) return;
      try {
        const b64 = await blobToBase64(blob);
        const mimeClean = (mediaRecorder.mimeType || 'audio/webm').split(';')[0];
        const res = await stt(b64, mimeClean);
        const text = (res && res.text || '').trim();
        if (text) onText && onText(text);
        else fallbackOrError('Keine Sprache erkannt.');
      } catch (e) {
        // ElevenLabs nicht verfügbar → Browser-Spracherkennung versuchen.
        if (SR) startSR(); else fallbackOrError(e.message || 'Sprache konnte nicht verarbeitet werden.');
      }
    };
    mediaRecorder.start();
    setRec(true); onStart && onStart();
  }

  function startSR() {
    try {
      recog = new SR();
      recog.lang = 'de-DE'; recog.interimResults = false; recog.maxAlternatives = 1;
      recog.onresult = (ev) => { const t = ev.results?.[0]?.[0]?.transcript?.trim(); if (t) onText && onText(t); };
      recog.onerror = (ev) => fallbackOrError('Spracherkennung: ' + (ev.error || 'Fehler'));
      recog.onend = () => setRec(false);
      recog.start();
      setRec(true); onStart && onStart();
    } catch (e) { fallbackOrError(e.message || 'Spracherkennung nicht verfügbar.'); }
  }

  function fallbackOrError(msg) { setRec(false); onError && onError(msg); }
  function stopStream() { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } }

  async function start() {
    if (recording) return;
    try {
      if (hasMR) await startMR();
      else if (SR) startSR();
      else onError && onError('Sprachaufnahme wird von diesem Gerät nicht unterstützt.');
    } catch (e) {
      // getUserMedia verweigert → wenn möglich Browser-SR, sonst Fehler.
      if (SR) startSR(); else onError && onError('Mikrofon nicht verfügbar: ' + (e.message || e.name));
    }
  }

  function stop() {
    if (!recording) return;
    if (mediaRecorder && mediaRecorder.state !== 'inactive') { try { mediaRecorder.stop(); } catch {} }
    else if (recog) { try { recog.stop(); } catch {} }
    else setRec(false);
  }

  return {
    supported,
    get recording() { return recording; },
    start, stop,
    toggle() { recording ? stop() : start(); },
    destroy() { try { stop(); } catch {} stopStream(); },
  };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}
