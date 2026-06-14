# DEMO-READY — George Solutions / baby-bob

Stand: laufender Lauf auf Branch `fix/kritische-bugs`. Diese Datei dokumentiert pro Schritt
Befund, Fix, getestete Punkte und die manuellen Schritte, die Emanuel noch selbst machen muss.

---

## SCHRITT 0 — Datenkette Techniker-Rapport → Projekt ✅

**Befund (Live-Prüfung gegen Supabase `bmdmoehjwadvdlbrmpuq` + Production-API):**

- Die Tabelle heisst **`gs_tagesrapporte`** (nicht `gs_rapporte`). Sie hat eine Spalte
  `projekt_id` → das ist die Verknüpfung Rapport → Projekt. Zusätzlich verknüpft
  `gs_projekt_techniker` (projekt_id ↔ techniker_user_id) die Zuteilung.
- Material steckt direkt im Rapport als Array-Spalte **`material`** (`text[]`), zusätzlich
  optional als Positionen in `gs_rapport_positionen` (mehrere Projekte pro Tag).
- Materiallisten, die ein Techniker separat verschickt, landen in **`gs_nachrichten`**
  (`typ='materialliste'`, Inhalt mit `positionen` im `inhalt`-JSON).

**End-to-End-Test (Production):** Login als Techniker `techniker.test@georgesolutions.ch`
→ `tagesrapport save` mit `projekt_id` des Projekts „Tannenrauchstrasse 35" →
Rapport landet mit korrektem `projekt_id` und `material:["Kupferrohr 18mm x5"]` →
`tagesrapport list` liefert ihn zurück. **Kette funktioniert, keine Reparatur nötig.**
(Der Test-Rapport wurde danach wieder gelöscht, DB bleibt sauber.)

**Status DB aktuell:** 1 Projekt (P-2026-0001 Tannenrauchstrasse 35), 1 Techniker
zugeteilt (730172f2…), 0 echte Rapporte/Materiallisten — wird im echten Einsatz befüllt.

---

## SCHRITT 1 — Zurück-zum-Admin-Button überall ✅

**Befund:** Es gab bereits einen globalen Floating-Button `#admin-return-btn`
(„← Zurück zum Admin", links oben fixiert). Seine Sichtbarkeit war aber an ein Flag
`adminReturnArmed` gekoppelt, das nur gesetzt wurde, wenn man GS/BOB **über die
Admin-Hub-Karte** betrat → an anderen Wegen fehlte der Button.

**Fix:** `updateAdminReturnBtn()` zeigt den Button jetzt **immer**, sobald ein Admin
(`master`/`gs_admin`, kein Demo) sich ausserhalb der Admin-Screens befindet — GS-Modus,
Baby-BOB-Scanner, Login, Partner-/Techniker-Ansichten, alle Unterscreens. Alle
Navigations-Funktionen (`go`, `showScreen`, `setMode`, `enterAdminMode`) rufen die
Update-Funktion bereits auf. Klick → `adminReturnHome()` → `admin-home`.
Kein Leak: Für Nicht-Admins/Demo bleibt er aus (`isMasterContext()`).

## SCHRITT 2 — Voice aus GS-Modus ✅ (verifiziert, keine Änderung nötig)

`bobVoiceAllowed()` blockiert jede aktive `.gs-screen`/`.admin-screen`/`.tech-screen`/
`.login-screen` sowie alles mit `appMode!=='bob'` und respektiert `bobIsGsSilent()`.
Damit ist der GS-Modus tonlos; nur der Baby-BOB-Scanner (`.screen.active` in BOB-Mode)
spricht. Bereits in Commit `e2cf882` umgesetzt — hier nur bestätigt.

## SCHRITT 3 — PM-Detailansicht ☐

## SCHRITT 4 — Materialliste per E-Mail ☐

## SCHRITT 5 — WhatsApp-Button ☐

---

## Manuelle Schritte für Emanuel (wird im Lauf ergänzt)

- _folgt_

## WhatsApp-Nummer eintragen

- _folgt_
