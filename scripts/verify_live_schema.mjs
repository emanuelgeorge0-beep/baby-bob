// scripts/verify_live_schema.mjs — read-only Schema-Check gegen Live-Supabase.
// node --env-file=.env.local scripts/verify_live_schema.mjs
const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_KEY;
const SB = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// Existiert eine Tabelle/Spalte? Wir fragen PostgREST mit limit=0 ab (200 = existiert).
async function tableOk(t, cols) {
  const sel = cols ? `select=${cols}` : 'select=*';
  const r = await fetch(`${URL}/rest/v1/${t}?${sel}&limit=1`, { headers: SB });
  return { ok: r.ok, status: r.status, detail: r.ok ? '' : (await r.text()).slice(0, 120) };
}

const checks = [
  ['gs_service_auftrag',  'id,objekt,beschreibung,quelle,status,ablehn_grund,angenommen_am,erledigt_am,partner_user_id'],
  ['gs_service_techniker','id,service_auftrag_id,techniker_id'],
  ['gs_projekt_stockwerk','id,projekt_id,name,reihenfolge,quelle'],
  ['gs_projekt_medien',   'id,projekt_id,service_auftrag_id,medientyp,bucket,path,dauer_sekunden,thumbnail_path,stockwerk,stockwerk_id,wohnung,raum,bauabschnitt,hochgeladen_von'],
  ['gs_projekt_techniker','id,projekt_id,techniker_id,taetigkeit,seit,stundensatz'],
  ['gs_tagesrapporte',    'id,projekt_id,service_auftrag_id,erfasst_von,rueckwirkend,datum'],
];

let fail = 0;
for (const [t, cols] of checks) {
  const r = await tableOk(t, cols);
  console.log(`${r.ok ? '✓' : '✗'} ${t}(${cols.split(',').length} Spalten) → ${r.status}${r.detail ? '  ' + r.detail : ''}`);
  if (!r.ok) fail++;
}
console.log(fail ? `\n❌ ${fail} Schema-Checks fehlgeschlagen` : '\n✅ Schema live vollständig (alle Tabellen + Spalten vorhanden)');
process.exit(fail ? 1 : 0);
