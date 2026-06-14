#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// MASTER-PASSWORT SETZEN  ·  George Solutions Cockpit (/gs-intern-7k2x)
// ---------------------------------------------------------------------------
// Setzt EINMALIG (oder erneut) ein Passwort für den Master-Account
//   emanuelgeorge0@gmail.com  (UUID ee46a716-7017-4045-9f67-fe06d05171e7)
// über die Supabase-Admin-API (service_role / sb_secret-Key). Danach ist der
// schnelle Passwort-Login im Cockpit zuverlässig — ohne Magic-Link, ohne E-Mail.
//
// IDEMPOTENT: beliebig oft ausführbar (setzt das Passwort jeweils neu).
// Es wird NICHTS gelöscht; die E-Mail wird zugleich als bestätigt markiert.
//
// AUSFÜHREN (im Projekt-Root):
//   node scripts/set-master-password.mjs 'DeinNeuesPasswort'
// oder ohne das Passwort im Shell-Verlauf zu hinterlassen:
//   MASTER_PASSWORD='DeinNeuesPasswort' node scripts/set-master-password.mjs
//
// Liest SUPABASE_URL + SUPABASE_KEY (oder SUPABASE_SERVICE_KEY) aus .env.local
// (bereits vorhanden) oder aus der Umgebung.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MASTER_UID = 'ee46a716-7017-4045-9f67-fe06d05171e7';
const MASTER_EMAIL = 'emanuelgeorge0@gmail.com';

// ── .env.local laden (ohne Zusatz-Abhängigkeit) ────────────────────────────
function loadEnv() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const f of ['.env.local', '.env']) {
    try {
      const txt = readFileSync(join(root, f), 'utf8');
      for (const line of txt.split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
      }
    } catch { /* Datei optional */ }
  }
}
loadEnv();

const URL = (process.env.SUPABASE_URL || '').trim();
const KEY = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '').trim();
const PASSWORD = process.argv[2] || process.env.MASTER_PASSWORD || '';

function die(msg) { console.error('\n❌ ' + msg + '\n'); process.exit(1); }

if (!URL || !KEY) die('SUPABASE_URL und SUPABASE_KEY (oder SUPABASE_SERVICE_KEY) fehlen (.env.local).');
if (!PASSWORD) die("Kein Passwort angegeben.\n   Aufruf:  node scripts/set-master-password.mjs 'DeinPasswort'");
if (PASSWORD.length < 8) die('Passwort zu kurz — bitte mindestens 8 Zeichen.');

const headers = { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` };

async function main() {
  // 1. Sicherheits-Check: existiert der Account und ist es WIRKLICH der Master?
  const getRes = await fetch(`${URL}/auth/v1/admin/users/${MASTER_UID}`, { headers });
  if (!getRes.ok) {
    const t = await getRes.text();
    die(`Admin-API verweigert (HTTP ${getRes.status}). Ist SUPABASE_KEY der service_role/Secret-Key?\n   ${t.slice(0, 200)}`);
  }
  const user = await getRes.json();
  if ((user.email || '').toLowerCase() !== MASTER_EMAIL) {
    die(`UUID gehört zu '${user.email}', nicht zu ${MASTER_EMAIL}. Abbruch (kein falscher Account).`);
  }

  // 2. Passwort setzen + E-Mail bestätigen (idempotent).
  const putRes = await fetch(`${URL}/auth/v1/admin/users/${MASTER_UID}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ password: PASSWORD, email_confirm: true }),
  });
  if (!putRes.ok) {
    const t = await putRes.text();
    die(`Passwort setzen fehlgeschlagen (HTTP ${putRes.status}).\n   ${t.slice(0, 300)}`);
  }

  console.log('\n✅ Master-Passwort gesetzt für ' + MASTER_EMAIL);
  console.log('   → Jetzt im Cockpit /gs-intern-7k2x mit E-Mail + diesem Passwort einloggen.');
  console.log('   → Login hält die Sitzung (kein erneuter Login nötig, bis du dich abmeldest).\n');
}

main().catch((e) => die(e.message));
