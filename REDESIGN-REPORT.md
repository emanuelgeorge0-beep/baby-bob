# Redesign-Report — GS-Landingpage Schwarz-Gold

Branch: `redesign/schwarz-gold` · **nicht** auf `main` gemergt.

## Wichtigste Annahme: Stack ≠ Next.js/Tailwind

Der Auftrag war für einen **Next.js/Tailwind-Stack** formuliert (`tailwind.config.ts`,
`globals.css`, `next/image`, `/public`). Dieses Repo ist aber **statisches HTML** — es gibt
**kein** `package.json`, `next.config`, `tailwind.config`, `globals.css`, keine
`src/app/components`. Die GS-Landingpage ist die einzelne Datei **`landing.html`**.

→ Gemäss Regel „bei Unsicherheit nicht raten, bestehende Struktur behalten, nur umfärben +
ergänzen" wurde die vorhandene `landing.html` umgebaut, mit stilgetreuer Mechanik-Abbildung:

| Auftrag (Next/Tailwind) | Umsetzung (statisch) |
|---|---|
| `theme.extend.colors.gs` in `tailwind.config.ts` | **CSS-Variablen** in `:root` (`--gs-bg`, `--gs-gold`, …) |
| `next/image priority/sizes` | `<img>` mit `width/height`, `alt`, `loading`, `fetchpriority`, `aspect-ratio` (kein CLS) |
| `npm run build` | **kein Build** (statisches HTML, kein npm). Stattdessen validiert: Inline-JS parst fehlerfrei, Tag-Balance ok, verbotene Begriffe geprüft, vollständiger Headless-Chrome-Render (Desktop + Mobile 375px). |

## Geänderte / neue Dateien

- `landing.html` — komplett auf Schwarz-Gold umgebaut + alle Sektionen (Phasen 1–6).
- `public/old/` — **neu**, lokal geladene Assets der alten Seite (Phase 0/3).
- `REDESIGN-REPORT.md` — dieser Report (Phase 7).
- `api/gs.js` — *(bereits vor diesem Redesign)* Landing-Lead-Pfad (Adresse optional, „Nachricht"-Zeile, Absender `info@`, `reply_to` = Kunde). Das Formular nutzt diesen Pfad unverändert.

## Geladene / fehlgeschlagene Bilder

Alle aus `https://www.george-solutions.ch/wp-content/uploads/2026/06/`, lokal nach `public/old/`:

| Datei | Status | Verwendung |
|---|---|---|
| `1.png`–`4.png` → `partner-1..4.png` | ✅ geladen | Trust-Logostreifen (grau → Hover farbig) |
| `As1.webp` | ✅ geladen | **Hero**-Bild (SW: Helm/Baupläne) |
| `As4.webp` | ✅ geladen | **„Ihr Ansprechpartner"** (Emanuel, Markenkleidung) |
| `As2.webp` | ✅ geladen | vorhanden, **nicht eingebaut** (Handschlag-Stockfoto, anderer Mann als Emanuel — kein passender Slot) |
| `iphone-mockup-.webp` | ✅ geladen | **bewusst NICHT eingebaut** — zeigt sichtbar „SHK PRO TEAM", „AI SCANVER" und verzerrten KI-Text → verstösst gegen die HKLS-/Wording-Regel |

Keine 404. **Kein Hotlinking** — alle Bilder liegen lokal im Repo.

Die im Auftrag genannten `emanuel-hero.jpg` / `emanuel-about.jpg` existierten **nicht** (kein
`/public`). Ersetzt durch die real verfügbaren Fotos: `As1.webp` (Hero), `As4.webp` (Emanuel).

## Phasen-Mapping (alle erledigt)

- **0** Branch `redesign/schwarz-gold`, Dateien lokalisiert, kein Tailwind/Next/globals.
- **1** Design-System: CSS-Var-Tokens exakt nach Vorgabe; Gold nur Akzent (Buttons/Zahlen/Icons/Linien/Badges), **kein Neon/Glow** (alte Gradient-Blobs + farbige Glow-Shadows entfernt). Primär `bg-gold text-bg` (Hover `goldHi`), Sekundär transparent `border-gold`. H1 mit **genau 1 Gold-Wort**. Logo bleibt.
- **2** Fotos: As1 im Hero (rechts, gerundet, Border + dezenter Goldring), As4 in neuer Sektion „Ihr Ansprechpartner" + Zitat + ~10 Jahre HKLS.
- **3** Sektionsreihenfolge 1–12 wie gefordert (Hero, Trust-Logos, Problem, Leistungen, Warum GS ×6, VS-Tabelle, Ansprechpartner, Baby BOB nach der B2B-Story, Preise, FAQ ×5, Anfrage, Footer).
- **4** Preise gestaffelt pro Rolle (kein Punktesystem): Pilot Leitung 65 + Monteur 60 / Einzel 65; Regulär Leitung 70 + Monteur 65 / Einzel 70; Leitung als grosse Gold-Zahl, Hook + „inkl. Spesen".
- **5** Footer: Logo + Claim, Kontakt (+41 76 482 94 28 · info@george-solutions.ch · Zürich), Spalten, schlichte Gold-Headings (kein Glow), © 2026.
- **6** Mobile (375px): Hero-Foto begrenzt (max 300px), Stats 2×2, VS-Tabelle horizontal scrollbar, Goldtext ≥16px, alle Bilder mit `width/height`+`alt` (kein Layout-Shift).
- **7** dieser Report. Commits pro Phase (Assets / Phasen 1–6 / Report).

## Wording / Qualität

Durchgängig **HKLS** (kein „SHK", kein „AI SCANVER"). Kein Jahres-/Quartalsvertrag (nur in
der Verneinung „kein Jahresvertrag"). Saubere deutsche Rechtschreibung.

## Build / Test

- Kein npm/Build-System → `npm run build` nicht anwendbar (statisches HTML).
- Inline-JS: parst fehlerfrei. Tag-Balance: `section` 10/10, `div` 152/152.
- Render lokal (Headless Chrome) verifiziert: Hero, Trust, VS-Tabelle, Ansprechpartner, Preise, Baby BOB, Mobile — alle Bilder + QR laden.
- Lead-Formular nutzt `POST /api/gs` mit `source:'landing'` (vorab live getestet: `success:true`, Mail an `info@`, `reply_to` = Kundenadresse, Punycode/Fallback).

## Offen (nicht Teil dieses Branches)

- **Deploy/Domain:** Branch nicht auf main. Damit `george-solutions.ch` diese Seite zeigt: Domain auf das Vercel-Projekt + Host-Rewrite → `/landing.html`.
- **Pfad `/public/old/`:** Auf diesem statischen Vercel-Setup werden Repo-Dateien 1:1 per Pfad ausgeliefert (wie `/lib/…`), also resolved `/public/old/…`. Bei einer späteren Framework-Migration (Next), die `public/` speziell behandelt, müssten die Pfade den Präfix verlieren.
- **Social-Links:** bewusst weggelassen (keine echten Instagram/LinkedIn-URLs auffindbar → keine toten Links). Auf Zuruf ergänzbar.
- **As2.webp:** verfügbar, aktuell ungenutzt.
