# Feature: projectflow — Projekt-Workflow (Fernwärmezentrale)

Autarke, framework-freie Komponente für den vollständigen Ablauf:
**Projekt anlegen → Techniker zuweisen → Pläne hochladen → Materialliste (mit Rabatt) → Rapport mit Unterschrift (PDF) → Material an Techniker bestellen (Mail) → Sprachmemo.**

Es wird **nichts neu gebaut**, was schon existiert – die Komponente ruft bestehende Endpunkte auf.

## Dateien
| Datei | Zweck |
|---|---|
| `ProjectWorkspace.js` | Hauptkomponente (`mountProjectWorkspace(container, props)`) |
| `api.js` | Datenschicht: Wrapper um bestehende `/api/*`-Endpunkte |
| `material.js` | Materialliste + **Materialrabatt** (Netto = Brutto × (1−rabatt/100)), CSV, Mail-Mapping |
| `signaturePad.js` | Unterschrift auf `<canvas>` → PNG-DataURL |
| `voiceMemo.js` | **Sprachmemo** via `/api/voice` (ElevenLabs) mit Browser-Fallback |
| `styles.css` | GS-Look, alles unter `.pfw` gescopt |
| `demo.html` | Standalone-Testharness (Handy) |

## Integration in die Shell
Die Komponente ist entkoppelt – **alle Rechte/Daten kommen über Props**, keine Shell-Imports:

```js
import { mountProjectWorkspace } from '/src/features/projectflow/ProjectWorkspace.js';
// <link rel="stylesheet" href="/src/features/projectflow/styles.css">

mountProjectWorkspace(document.getElementById('slot'), {
  companyId,        // Mandant (informativ)
  canRapport,       // true → Reiter "Rapport"
  canOrder,         // true → "Material bestellen → Mail an Techniker"
  token,            // Supabase Access-Token (Bearer) — z. B. localStorage 'bob_auth_token'
  currentUser,      // { id, name, email } (Anzeige/Absendername)
  baseUrl,          // Standard '' (gleiche Origin)
});
```

## Wiederverwendete Endpunkte
- `POST /api/projekte` — `create` / `get` / `list` / `assign` (Projekte, Techniker-Zuweisung). *Anlegen/Zuweisen erfordert `gs_admin`-Token (bestehende Backend-Regel).*
- `POST /api/projectflow` — **dünn/neu**: `technicians` (inkl. E-Mail), `plan_upload` / `plan_list` / `plan_delete` (Bucket `plans`).
- `POST /api/tagesrapport` — `save` (Unterschrift→`rapport-signatures`, bei Einreichung `buildRapportPdf`→`rapport-pdfs`), `get` (signierte PDF-URL), `list`.
- `POST /api/nachrichten` — `send` mit `typ:'materialliste'` → Resend-Mail (Absender `info@george-solutions.ch`) + Materiallisten-PDF an den Techniker.
- `POST /api/voice` — `stt` (Sprache→Text).

## Einmalige Einrichtung
`scripts/projectflow.sql` im Supabase-SQL-Editor ausführen (legt Bucket `plans` an, optionale `rapporte`-Tabelle, `gs_projekte.notiz`).

## Grenzen / Hinweise
- Plan-Upload: base64 über JSON, max. 8 MB pro Datei.
- „Kunde" wird best-effort in `gs_projekte.notiz` als `Kunde: …` abgelegt.
- Der Rapport wird serverseitig dem eingeloggten Nutzer zugeordnet; der gewählte Techniker-Name erscheint als „Team" im PDF.
