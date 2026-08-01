# CLAUDE.md – Arbeitsweise George Solutions (baby-bob)
## Eiserne Regeln (NIEMALS brechen)
1. vercel.json "outputDirectory":"." NIEMALS ändern/entfernen.
2. "Bob" im Code NICHT umbenennen (Felix = nur Marke außen).
3. Keine Secrets im Code – nur aus Vercel-Env.
4. Struktur nicht umbauen, nur erweitern. Erst lesen, dann ändern.
5. EIN Agent pro Ordner. Merges nur ohne laufenden Agenten.
6. Dokumente/Downloads (Wochenbericht, Rechnung, Serviceauftrag, Rapport-PDF,
   alles was die Software als Dokument erzeugt oder zum Download anbietet)
   sind IMMER hell: weisser Hintergrund, schwarze Schrift, druckbar. Logo oben,
   dünne goldene Trennlinie (#C9A961) unter dem Kopf, sonst neutral. Der dunkle
   Command-Center-Stil (schwarz/gold, #0A0A0B/#C9A961) gilt ausschliesslich für
   die Oberfläche (Cockpits, Wochenblatt) – NIE für ein Dokument.
## Arbeitsweise (Token-sparend)
- Erst relevanten Code lesen, in 2-3 Sätzen zusammenfassen, DANN ändern.
- Keine Rückfragen, wenn Antwort im Code oder hier steht. Nur bei echten Weggabelungen fragen.
- Kleinschrittig: eine Aufgabe, testen, committen, nächste.
- Am Ende: kurz was geändert wurde + wie testen. Kein Roman.
## Stack
Repo baby-bob · Vercel (Auto-Deploy main) · Supabase · ElevenLabs (Tap-to-Talk ok, Wake-Word buggy) · Anthropic.
## 4 Säulen = ein Gedächtnis
S1 KI-Scanner (Laie) · S2 Marketplace (Lead nur 1x) · S3 Bob PM (Herzstück) · S4 Facility (Verwaltungen).
