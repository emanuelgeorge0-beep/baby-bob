// src/features/projectflow/api.js
// Dünne Datenschicht des Projekt-Workflows. Ruft AUSSCHLIESSLICH bestehende Endpunkte auf –
// nichts wird hier neu erfunden. Auth-Token & Basis-URL kommen über Props (keine Shell-Imports).
//
//   /api/projekte      → Projekte anlegen/öffnen/zuweisen  (bestehend)
//   /api/projectflow   → Plan-Upload nach Bucket 'plans' + Techniker inkl. E-Mail (dünn, neu)
//   /api/tagesrapport  → Rapport speichern (Unterschrift→Storage, PDF)  (bestehend)
//   /api/nachrichten   → Materialliste per Resend-Mail + PDF an Techniker (bestehend)
//   /api/voice         → Sprachmemo Speech-to-Text (ElevenLabs, Browser-Fallback) (bestehend)

export function createApi({ token, baseUrl = '' } = {}) {
  async function post(path, body) {
    const r = await fetch(baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body || {}),
    });
    let data = {};
    try { data = await r.json(); } catch { /* leerer Body */ }
    if (!r.ok) { const e = new Error(data.error || `HTTP ${r.status}`); e.status = r.status; e.data = data; throw e; }
    return data;
  }

  return {
    post, // für Sonderfälle/Debug

    // ── Projekte (bestehend: /api/projekte) ──
    listProjects:      ()             => post('/api/projekte', { action: 'list' }),
    getProject:        (id)           => post('/api/projekte', { action: 'get', id }),
    createProject:     (p)            => post('/api/projekte', { action: 'create', ...p }),
    updateProject:     (p)            => post('/api/projekte', { action: 'update', ...p }),
    assignTechnicians: (projekt_id, techniker_user_ids) => post('/api/projekte', { action: 'assign', projekt_id, techniker_user_ids }),

    // ── Techniker inkl. E-Mail + Pläne (dünn: /api/projectflow) ──
    technicians:  ()                                   => post('/api/projectflow', { action: 'technicians' }),
    uploadPlan:   (projekt_id, filename, data, contentType) => post('/api/projectflow', { action: 'plan_upload', projekt_id, filename, data, contentType }),
    listPlans:    (projekt_id)                         => post('/api/projectflow', { action: 'plan_list', projekt_id }),
    deletePlan:   (projekt_id, path)                   => post('/api/projectflow', { action: 'plan_delete', projekt_id, path }),

    // ── Rapport + Unterschrift + PDF (bestehend: /api/tagesrapport) ──
    saveRapport:  (r)      => post('/api/tagesrapport', { action: 'save', ...r }),
    getRapport:   (id)     => post('/api/tagesrapport', { action: 'get', id }),
    listRapporte: (projekt_id) => post('/api/tagesrapport', { action: 'list', projekt_id }),

    // ── Material bestellen → Mail an Techniker (bestehend: /api/nachrichten) ──
    orderMaterial: (payload) => post('/api/nachrichten', { action: 'send', typ: 'materialliste', ...payload }),

    // ── Sprachmemo (bestehend: /api/voice) ──
    stt: (audio, mime) => post('/api/voice', { action: 'stt', audio, mime }),
  };
}
