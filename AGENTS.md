# AGENTS.md

Diese Datei enthaelt keine Regeln.

**Alleinige Quelle ist [CLAUDE.md](./CLAUDE.md).**

Jeder Agent — Claude Code, Codex, Cursor, was auch immer — liest CLAUDE.md
und nur CLAUDE.md. Hier steht bewusst keine Kopie: zwei Dateien mit demselben
Inhalt driften auseinander, und dann gilt die falsche.

Technisch durchgesetzt wird ein Teil der Regeln von den Hooks in
`.claude/settings.json` (Sperren gegen vercel.json, SQL-Ausfuehrung,
Merge/Push auf main, .env). Was dort blockiert, ist keine Meinung.
