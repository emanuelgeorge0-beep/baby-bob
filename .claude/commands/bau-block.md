---
description: Erzeugt das Geruest eines Rundenauftrags (Titel, KONTEXT, ZIEL, WICHTIG, NICHT jetzt, IRON RULES, STOPP) mit den echten Werten aus dem Repo.
argument-hint: <Titel der Runde, z.B. "Bau · Rapport-Erinnerung">
allowed-tools: Bash(git rev-parse:*), Bash(git branch:*), Bash(git log:*), Bash(git status:*), Bash(grep:*), Read, Glob
---

Erzeuge das **Geruest** eines Rundenauftrags fuer die Runde: **$ARGUMENTS**

Wenn kein Titel uebergeben wurde, frag in einer Zeile nach dem Thema der Runde
und mach danach weiter. Sonst nicht nachfragen.

## Werte zuerst holen, nicht raten

Fuell den KONTEXT-Block mit dem, was das Repo wirklich sagt:

- Zweig: `git rev-parse --abbrev-ref HEAD`
- Basis-Commit von main: `git rev-parse --short main`
- Worktree: `git rev-parse --show-toplevel`
- SW-Cache-Stand: `grep -o "v[0-9]\+" cockpit-sw.js | head -1` (bzw. die
  CACHE-Konstante in `cockpit-sw.js`)

Sind Werte nicht ermittelbar, schreib `<unbekannt>` hinein statt etwas zu
erfinden. Ein Auftrag mit einem falschen Basis-Commit ist schlimmer als einer
mit einer Luecke.

## Form

Gib genau diese Struktur aus, als reinen Text im Codeblock, damit Emanuel ihn
kopieren und ausfuellen kann. Deutsche Umlaute umschrieben (ae, oe, ue, ss) —
so sind alle bisherigen Auftraege geschrieben.

```
<Titel: "Neue Runde · Bau · <Thema>">

KONTEXT
Repo: baby-bob (emanuelgeorge0-beep/baby-bob)
Branch: <aktueller Zweig>, abgezweigt von main
Commit main: <kurz-sha>
SW-Cache: <vNN>
Live: baby-bob.vercel.app
Worktree: <pfad>
Stand: <zwei bis vier Zeilen: was heute da ist, was daran nicht stimmt.
       Beschreibend, nicht wertend. Wer das liest, muss die Ausgangslage
       kennen, ohne den Code zu oeffnen.>

ZIEL

1 <Erstes Ziel als Ueberschrift ohne Doppelpunkt>
<Zwei bis vier Zeilen: was gebaut wird und woran man sieht, dass es steht.>
Ausgabe: <was am Ende vorliegen muss — Datei, Definition, Protokoll>

2 <Zweites Ziel>
...

<Nummeriere durch. Jedes Ziel bekommt eine "Ausgabe:"-Zeile. Ein Ziel ohne
benennbare Ausgabe ist kein Ziel, sondern eine Absicht.>

<Letztes Ziel ist bei baubaren Runden immer der Nachweis:>
N Nachweis
<Was wird ausgeloest, um zu zeigen, dass es wirklich greift.
Protokolliere pro Punkt: was versucht wurde, was passiert ist, welche Meldung kam.>

WICHTIG
- <Was gegen die installierte Version / den echten Code geprueft werden muss,
  statt es zu raten.>
- <Was als "nicht gebaut" gilt, wenn es nicht nachweisbar ist.>
- Kleinschrittig: ein Ziel, testen, committen, naechstes.

NICHT jetzt
- Kein Merge, kein Push auf main.
- Kein SQL, keine Migration.
- Keine Aenderung an vercel.json.
- <Was aus dieser Runde ausdruecklich herausgehalten wird und in eine eigene
  Runde gehoert — mit Namen, damit es nicht "aus Versehen" mitgemacht wird.>

IRON RULES
SQL nur in scripts/ und nur manuell in Supabase durch Emanuel. Kein DROP
TABLE. Ein Agent pro Worktree. Kein Merge im Agenten-Terminal.
vercel.json outputDirectory "." bleibt unveraendert. Neue lib/-Dateien im
bestehenden ESM-Stil, import.meta bleibt verboten. Bob wird im Code nie
umbenannt.
<Ergaenze hier die Stellen, die in DIESER Runde in Reichweite kommen und
nicht angefasst werden duerfen — mit Datei und Zeile.>

ABBRUCHKRITERIUM
<Ein Satz, der pruefbar ist. Nicht "funktioniert", sondern woran man es sieht.>
Alles committet auf <Zweig>.

STOPP
```

## Danach

Sag in einem Satz, welche Felder du aus dem Repo gefuellt hast und welche
Emanuel noch selbst ausfuellen muss. Kein Roman.
