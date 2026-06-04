# Baby BOB / George Solutions — Module Architecture & API Interfaces

This document defines the **module boundaries** and the **API contracts between
them**, so each module (BOB, GS, Techniker, Admin) can run independently and
later be split into separate agents/services.

## Design principle: independent serverless modules

Every backend capability is a **self-contained Vercel serverless function** in
`api/`. None of them import each other — each reads its own env (`SUPABASE_URL`,
`SUPABASE_KEY`) and talks to Supabase directly. This zero-shared-code coupling is
deliberate: each file is already an **agent-ready boundary**. The only shared
substrate is Supabase (Auth + Postgres tables) and the `user_roles` table that
maps a user to one of: `bob_user | gs_partner | techniker | gs_admin`.

```
                     ┌─────────────── Supabase ───────────────┐
 Browser (index.html)│  Auth (GoTrue) · Postgres · Storage     │
   │                 └──────────────▲──────────────────────────┘
   │  fetch(/api/*)                 │ service key / user JWT
   ▼                                │
 ┌──────────┬──────────┬───────────┴──┬───────────┬───────────────┐
 │  BOB     │   GS     │  Techniker   │   Admin   │  Shared/Auth   │
 │ bob.js   │ gs.js    │ rapport.js   │ admin.js  │ auth.js        │
 │          │ techniker│              │ dashboard │ account.js     │
 └──────────┴──────────┴──────────────┴───────────┴───────────────┘
```

---

## Modules

### 1. BOB (B2C scanner) — `agent: bob`
- **Responsibility:** AI problem analysis for consumers; recommend a tradesperson.
- **Endpoints:** `bob.js`
- **Owns data:** `anfragen` (B2C leads, written client-side), `bob_knowledge` (shared KB, read).
- **Auth:** none (anonymous).

### 2. GS (B2B booking) — `agent: gs`
- **Responsibility:** SHK project intake, tariff selection, technician showcase, booking.
- **Endpoints:** `gs.js` (submit), `techniker.js` (available-technician showcase).
- **Owns data:** `gs_kunden`, `gs_anfragen`; reads `gs_techniker`, `bob_knowledge` (GS-filtered).
- **Auth:** booking submit is public; entry gated client-side to `gs_partner`/`gs_admin`.

### 3. Techniker — `agent: techniker`
- **Responsibility:** daily/weekly rapport capture by technicians.
- **Endpoints:** `rapport.js` (GET own rapporte, POST submit).
- **Owns data:** `techniker_rapporte` (⚠️ not yet on live DB — needs `rapport_system_migration.sql`), `gs_techniker` (profile).
- **Auth:** `techniker` or `gs_admin` (Bearer token).

### 4. Admin — `agent: admin`
- **Responsibility:** user lifecycle + cross-pillar lead overview (Emanuel only).
- **Endpoints:** `admin.js` (user management), `dashboard.js` (S1–S4 leads).
- **Owns data:** `user_roles`; reads across `anfragen` (S1) + `gs_anfragen` (S2).
- **Auth:** `gs_admin` only.

### Shared / Auth — `agent: auth` (cross-cutting)
- **Responsibility:** identity, sessions, password lifecycle, profiles. Every other module depends on this for `role` + token verification.
- **Endpoints:** `auth.js` (magic_link/login/verify), `account.js` (me/change_password/complete_profile).
- **Owns data:** Supabase Auth `auth.users` + `user_metadata`, `user_roles`.

---

## API contracts (inter-module interfaces)

All endpoints: `Content-Type: application/json`, CORS `*`, `OPTIONS` preflight ok.
Auth = `Authorization: Bearer <access_token>` unless noted.

### auth.js — `POST /api/auth`
| action | request | response | auth |
|---|---|---|---|
| `magic_link` | `{email}` | `{ok}` / 404 if unknown | none |
| `login` | `{email,password}` | `{access_token,user,role,tech_name,must_change_password,profile_complete}` | none |
| `verify` | `{token}` | `{user,role,tech_name,must_change_password,profile_complete}` | none |

> **Interface note:** `must_change_password` + `profile_complete` drive the frontend onboarding gate (`routeAfterAuth`): pw-change → profile-setup → role dashboard.

### account.js — `POST /api/account` (authenticated)
| action | request | response |
|---|---|---|
| `me` | `{}` | `{user,role,must_change_password,profile_complete,profile}` |
| `change_password` | `{new_password}` (≥8) | `{ok,must_change_password:false}` |
| `complete_profile` | `{profile:{vorname,nachname,telefon, …role-specific}}` | `{ok,profile_complete:true,role}` |

> Partner profile requires `firma` + `position∈{CEO,Projektleiter,Bauleiter,Einkauf,Sonstiges}`.
> Techniker requires `qualifikation∈{Meister,Gesellenbrief AF,Monteur,Bauleiter}` + `spezialisierung⊆{Sanitär,Heizung,Lüftung,Klima}`.
> **Interface note:** completing a techniker profile **syncs into `gs_techniker`** (matched by email) — this is the seam the GS showcase reads.

### admin.js — `POST /api/admin` (gs_admin only)
| action | request | response |
|---|---|---|
| `list_users` | `{}` | `{users:[{id,email,name,firma,role,status,active,must_change_password,profile_complete,last_password_change}]}` |
| `create_user` | `{name,email,firma,role∈{gs_partner,techniker}}` | `{ok,user,temp_password}` (temp shown once) |
| `reset_password` | `{user_id}` | `{ok,temp_password}` |
| `set_active` | `{user_id,active:bool}` | `{ok,active}` |

> **Interface note:** `create_user` is the **producer** for the Auth/Account/GS/Techniker modules — it mints `auth.users` + `user_roles` rows they all consume.

### dashboard.js — `GET /api/dashboard` (gs_admin only)
`→ {generated_at, totals:{all,by_status}, sources:{S1,S2,S3,S4}, leads:[{id,source,date,title,detail,status,partner}]}`
> **Interface note:** read-only **consumer** of BOB (`anfragen`=S1) + GS (`gs_anfragen`=S2). S3/S4 reserved.

### techniker.js — `GET /api/techniker[?bereich=]` (public)
`→ {techniker:[{id,name,qualification,specialization[],rating,years_experience,photo_emoji,location,availability}]}`
> Reads `gs_techniker`; rich fields via `notizen` JSON sidecar until columns are migrated. No PII (no email/phone).

### gs.js — `POST /api/gs` (public)
`{kunden:{vorname,nachname,…}, anfrage:{projekt_name,bereich,tarif,…}}` `→ {success,kunde_id}`
> Writes `gs_kunden` + `gs_anfragen`. Preferred technician is embedded in `anfrage.notiz` (`"Wunsch-Techniker: …"`) — the seam `dashboard.js` parses for `partner`.

### rapport.js — `GET|POST /api/rapport` (techniker/gs_admin)
GET `→ [rapporte]` (last 4 weeks). POST `{tage:[{datum,stunden,aktivitaeten[],materialien[],notiz}]}` `→ {ok,saved}`.
> ⚠️ Targets `techniker_rapporte` + `gs_techniker.user_id` — both require `rapport_system_migration.sql` to exist on live.

### bob.js — `POST /api/bob` (public)
`{description?, imageBase64?, category?, mode?}` (`mode:'gs'` → SHK prompt + GS KB) `→ {titel,desc,kategorie,dringlichkeit,kosten,fachmann,tipps[],…}`

---

## Multi-agent readiness

| Concern | Today | To fully separate into agents |
|---|---|---|
| Code coupling | None (independent functions) | ✅ already split per file |
| Shared identity | `auth.js` + `user_roles` | Keep as a **shared Auth agent**; others call it / verify JWT |
| Shared DB | one Supabase project | Per-agent schemas or per-agent Supabase projects; cross-agent reads become API calls |
| Frontend | single `index.html` monolith | Split by module (BOB / GS / Techniker / Admin shells) — biggest refactor; deferred to avoid regressions |
| Contracts | this document | Promote to versioned OpenAPI per agent |

**Boundary rule going forward:** modules communicate only via the HTTP contracts
above or via clearly-owned Supabase tables — never by importing another module's
file. New cross-module needs get a documented endpoint here first.
