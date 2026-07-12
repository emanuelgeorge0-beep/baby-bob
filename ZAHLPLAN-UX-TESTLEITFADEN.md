# Testleitfaden – feat/zahlplan-ux (Block 2–5)

SW-Cache ist auf **v11** – nach Deploy einmal App neu laden (ggf. PWA schliessen/öffnen).
**Kein SQL nötig.** `scripts/zahlplan_ux_gesehen.sql` ist nur der Vorschlag für die
spätere Cross-Device-Variante von Block 5 und bleibt liegen (NICHT ausführen).

## Block 2 – Ziehgriff (Master-Cockpit → Sub-Anfragen → Angebot prüfen & abschicken)
1. Sub-Anfrage öffnen → „Angebot prüfen & abschicken".
2. Step am Griff **⠿** ziehen und auf einem anderen Step derselben Kette fallen lassen
   → Step wird VOR den Ziel-Step verschoben, goldene Linie zeigt das Ziel.
3. ▲/▼ funktionieren weiterhin (Fallback, z. B. Touch).
4. Abschicken wie bisher → Reihenfolge kommt beim Partner identisch an.

## Block 3 – %-Motor + Preset-Suche (gleicher Editor)
Grundlage: Zielsumme = **Netto-Positionsbasis** (Positionen mit Häkchen „Plan").
- Beim Öffnen sind bestehende Zahlungs-Steps **fixiert (🔒)** – nichts verschiebt sich von allein.
- Neuen Step über das Suchfeld „＋ Step suchen…" einfügen (tippen → Preset antippen):
  - Zahlung: „Anzahlung" (15 % vorbelegt, editierbar), „Installationstag 1/3/5",
    „Installation abgeschlossen", Meilensteine (Speicher gestellt, Installation komplett, Abnahme).
  - „Installationsfortschritt" → %-Wähler 10–100 (10er-Schritte).
  - Gates (Betrag 0): Materialauszug/-organisation, Installation fertiggestellt,
    Anlage unter Druck, Dichtheit geprüft, Druckprotokoll, Anlage füllen & entlüften,
    Inbetriebnahme, Übergabe + bestehende (Material-Gate, Druckprobe, Fliesenleger, …).
- **Motor testen:** 2–3 Steps über 🔓 entsperren → sie teilen sich den Rest
  (ganze Franken, letzter ungesperrter trägt den Rundungsrest, Summe exakt).
- % und CHF sind live gekoppelt; Eintippen (CHF oder %) fixiert den Step (🔒).
- Betrag **0** eintippen → Step wird Gate (⛔).
- Alles fixiert und Summe ≠ Basis → keine Umverteilung, Rest-Zeile zeigt
  „Rest CHF … (…%)" rot; bei exakt: grün „Voll verteilt · Rest CHF 0 (0%)".
- Automatiktest: `node scripts/test_zahlplan_motor.mjs` (12 Assertions, 5× wiederholt PASS).

## Block 4 – Testprojekt löschen (reine Weste)
1. Master: Sub-Anfragen-Liste → ✕ am Projekt → Bestätigung → weg (Soft-Delete, beide Seiten).
2. Projekt MIT hinterlegtem Escrow-Stub-Geld: ✕ → erster Dialog → es kommt die
   **zweite, explizite Test-Bestätigung** („⚠️ Escrow-Geld … Testprojekt trotzdem löschen?")
   → bestätigen → gelöscht. Abbrechen = alles bleibt.
3. Partner: eigene Entwürfe weiterhin löschbar, abgeschickte nicht (unverändert).
> Vor Stripe-Go-Live (echtes Geld) muss `force` wieder eingeschränkt werden – Kommentar in api/cockpit.js.

## Block 5 – Blink-Hinweis ungelesener Eingang (geräte-lokal, localStorage)
Master (gs-intern):
1. Partner schickt eine Anfrage ab → im Cockpit blinkt der Punkt an der Kachel
   „Sub-Anfragen" und am Listeneintrag (dezentes Pulsieren).
2. Eintrag öffnen → Blinken stoppt (auch nach Reload).
3. Partner nimmt Angebot an / lehnt ab / Termin → Eintrag blinkt wieder; Öffnen stoppt.
Partner (app.html):
4. Master schickt Angebot → beim Partner blinkt der Punkt am Tab „Projekte",
   in der Bottom-Nav und am Projekt in der Liste; Öffnen stoppt das Blinken.
Hinweise: Marker liegt in localStorage (`gs_msub_seen` bzw. `gs_psub_seen_<user>`) →
pro Gerät. Anderes Gerät blinkt nur bei wirklich offenen Aktionen (neue Anfrage bzw.
offenes Angebot). Cross-Device später via scripts/zahlplan_ux_gesehen.sql.

## Regression (kurz)
- Volle Suite nach Deploy: `node scripts/test_all.mjs <baseUrl>` (braucht laufende Instanz).
- Angebot-Versandweg unverändert: 3 Pflicht-Häkchen + Steps==Positionen-Gate.
- Zahlungsplan-Annahme + hinterlegen (Partner) unverändert.
- Gelöschte Projekte tauchen in keiner Liste auf (Master + Partner).
