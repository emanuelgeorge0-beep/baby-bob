# NACHT_STATUS_3 — Sprach-Fix · Quellen-Tracking · Lead-Mails (Fundament vor Werbestart)

Datum: 2026-06-08 · Branch: main · Live: baby-bob.vercel.app

Vollautonom umgesetzt: **1) Sprach-Bug-Fix + Umschalter**, **2) UTM-/Quellen-Tracking**,
**3) Lead-Alarm-Mail an GS**, **4) Auto-Bestätigung an den Kunden**.
Zusätzlich: **systematisches Bug-Audit** (Punkte 1–8) → siehe **BUG_REPORT.md**.

> ⚠️ Namens-Klarstellung: Der Auftrag nannte die Tabelle `gs_kundenanfragen`.
> Die **reale** Lead-Tabelle heisst `gs_anfragen` (Kunden in `gs_kunden`). Alles wurde
> gegen das **Live-Schema** gebaut, nicht gegen den Tabellennamen aus dem Auftrag.

---

## ✅ Was erledigt ist (Code steht, getestet wo automatisierbar)

### 1. Sprach-Bug-Fix + Umschalter (DE/EN/ES)
- **Ursache gefunden:** `lib/regions.js → detectRegion()` hat per `navigator.language`
  bzw. Zeitzone die Region erzwungen (z.B. spanischer Browser/VPN → Region `ES` → `bobLang='es'`).
  Die Sprache hing fest an der erkannten Region.
- **Fix:**
  - `detectRegion()` gibt jetzt **immer `CH`** zurück — **kein** navigator/Geo/VPN-Auto-Detect mehr.
  - Sprache von der Region **entkoppelt**: neue Schicht `bbGetLang()/bbSetLang()` mit
    **Standard IMMER Deutsch**, persistiert in `localStorage["bb_lang"]`.
  - **Sichtbarer Umschalter DE/EN/ES** eingebaut (Klasse `.lang-switch`, GS-Branding dunkel/blau/gold):
    - ersetzt das alte statische „🇨🇭 Schweiz"-Label auf der GS-Landing-Kachel,
    - zusätzlich im **GS-Home-Header** (man kann jederzeit zurückwechseln).
  - Die 5-Markt-Flaggen (BOB-Seite) bleiben erhalten und wechseln bei **manuellem** Klick
    bewusst auch die Sprache (wie im Disclaimer versprochen) — aber nie automatisch.
- **Automatisch verifiziert:** alle **53** `data-i18n`-Keys sind in **DE/ES/EN vollständig**,
  keine deutschen Reste (Skript-Check gegen `lib/regions.js`).

### 2. UTM-/Quellen-Tracking
- Beim Laden werden `utm_source/medium/campaign/term/content` + `document.referrer`
  ausgelesen und in `localStorage["bb_utm"]` gehalten (`bbCaptureUTM()`), bis die Anfrage raus ist.
- `gsSubmit()` schickt das Objekt als `tracking` an `/api/gs`.
- Server (`api/gs.js`) leitet **`quelle`** ab: `utm_source` → sonst Referrer (google/meta/bing/…) → sonst `direkt`.
- Persistiert in `gs_anfragen` (Spalten via Migration, s.u.).
- **Robust:** Falls die Migration noch nicht lief, schreibt der Insert **automatisch ohne**
  Tracking-Spalten weiter (Fallback) — ein Lead geht **nie** verloren.
- **Dashboard:** Quelle-Badge pro Lead (Google/Meta/Bing/Direkt/BOB), farbcodiert.
  `api/dashboard.js` liest `quelle` mit Fallback (kein Crash vor Migration).

### 3. Lead-Alarm-Mail an GS
- Bei neuer Anfrage sofort Mail an **beide** Adressen (Konstanten oben in `api/gs.js`):
  `info@george-solutions.ch` **und** `emanuelgeorge0@gmail.com`.
- Betreff: `🔔 Neuer GS-Lead: [Name] – [Telefon] ([Quelle])`.
- Inhalt zum Sofort-Handeln: **Telefon als `tel:`-Link**, **E-Mail als `mailto:`-Link**,
  „Jetzt anrufen"-Button, plus Name/Firma/Ort/Anliegen/Quelle/Zeitstempel, GS-Header (Logo+Farben).
- `reply_to` = Kundenmail (direktes Antworten möglich).

### 4. Auto-Bestätigung an den Kunden
- Nur bei plausibler E-Mail (Regex-Check).
- Schweizerisch-höflich, GS-Branding: „…melden uns innerhalb von 2 Stunden (werktags)…",
  Telefon als `tel:`-Link, Grüsse von George Solutions.

### Mailversand-Technik
- **Vorher gab es keinen** transaktionalen Versand — nur Supabase-Auth-Magic-Links.
- Neu: **Resend via REST-API** (`https://api.resend.com/emails`, `fetch`, **keine npm-Dependency**,
  passt zum bestehenden api-Pattern). 8-s-Timeout pro Mail.
- **Mailfehler blockieren das Speichern NIE** — alles in try/catch, nur `console.error`.
  Fehlt `RESEND_API_KEY`, wird der Versand sauber übersprungen (Lead wird trotzdem gespeichert).

---

## 🔧 DU MUSST MANUELL EINTRAGEN / AUSFÜHREN

### A) SQL-Migration ausführen (Supabase → SQL Editor)
Datei: **`scripts/utm_tracking_migration.sql`** (idempotent, mehrfach ausführbar).
Fügt zu **`gs_anfragen`** hinzu: `utm_source, utm_medium, utm_campaign, utm_term, utm_content,
referrer, quelle` + Index + setzt Altzeilen auf `quelle='direkt'`.
> Bis dahin laufen Leads dank Fallback trotzdem (nur ohne Quelle-Spalten).

### B) Vercel Environment Variables (Project → Settings → Environment Variables)
| Key | Wert | Pflicht? |
|-----|------|----------|
| `RESEND_API_KEY` | dein Resend-API-Key (`re_…`) | **Ja** (sonst kein Mailversand) |
| `GS_MAIL_FROM` | z.B. `George Solutions <noreply@george-solutions.ch>` | optional (Default gesetzt) |
| `GS_PHONE` | echte Nummer, z.B. `+41 44 123 45 67` | optional (erscheint in Mails) |

Nach dem Setzen **redeploy** (oder neuer Push) nötig, damit die Env greift.

### C) Resend-Account einrichten
1. Account auf **resend.com**, API-Key erzeugen → als `RESEND_API_KEY` (B).
2. **Domain `george-solutions.ch` verifizieren** (DNS: SPF + DKIM, zeigt Resend an).
   Solange die Domain **nicht** verifiziert ist, kommen Mails von `noreply@george-solutions.ch`
   **nicht** zuverlässig an. Zum schnellen Test kannst du als `GS_MAIL_FROM` vorübergehend
   `onboarding@resend.dev` setzen (nur an deine eigene Adresse zustellbar).

### D) Echte Telefonnummer
- `GS_PHONE` (Env, für Mails) **und** die Konstante `GS_PHONE` in `index.html`
  (für die Telefon-CTAs in der App) auf die echte Nummer setzen.

---

## 🧪 Tests (Status)
- ✅ **Automatisch:** i18n-Key-Abdeckung DE/ES/EN = 100 % (53/53). IBAN-Mod-97 9/9 Fälle.
  Alle Inline-Scripts + geänderte API-Dateien syntaktisch fehlerfrei.
- 🟡 **Du musst manuell prüfen** (nicht automatisierbar hier):
  - App frisch öffnen (auch mit ES-Browser/VPN) → startet **Deutsch**. DE↔ES↔EN wechseln, Reload → bleibt.
  - Anfrage `?utm_source=google&utm_campaign=test` → Quelle in DB + Badge + Lead-Mail an **beide**
    Adressen (Telefon klickbar) + Kundenbestätigung kommt an.
  - Anfrage ohne UTM → `quelle="direkt"`.
  - Mailversand-Fehler (Key falsch) → Lead wird **trotzdem** gespeichert.

---

## 📂 Geänderte Dateien
- `lib/regions.js` — Auto-Detect entfernt (detectRegion → 'CH').
- `index.html` — Sprachschicht + Umschalter-UI/CSS, UTM-Capture, Tracking im Submit, Quelle-Badge.
- `api/gs.js` — Tracking-Persistenz (mit Fallback) + Resend-Mailversand (Lead-Alarm + Kundenbestätigung).
- `api/dashboard.js` — `quelle` je Lead (mit Fallback-Select).
- `scripts/utm_tracking_migration.sql` — **neu** (auszuführen).
- `BUG_REPORT.md` — **neu** (systematisches Audit Punkte 1–8).
