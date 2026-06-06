# Baby BOB / George Solutions

PWA (single-page `index.html`) + Vercel serverless API (`/api/*`) + Supabase + Claude API.
- **BOB** (B2C): KI-Scanner findet Handwerker.
- **George Solutions** (B2B): SHK-Buchungsportal, Techniker-Rapporte, Admin.

## Setup / Environment

### Vercel env vars (Project Settings → Environment Variables)
| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API (BOB diagnosis, chat, daily-learning) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_KEY` | Supabase **service** secret (`sb_secret_…`) — server only |
| `CRON_SECRET` | (optional) guards `/api/bob-learn` cron |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` | (Task 2) Stripe — test keys first |
| `GOOGLE_MAPS_API_KEY` | (Task 6) Google Maps JS API |

Client (`index.html`) uses the Supabase **publishable** key (insert-only).

## Magic Link — make it work for ALL emails (required for launch)
The code (`api/auth.js`) already sends OTP for **any** email (`create_user:true`, no whitelist) — verified. The only limit is Supabase's **built-in mailer** (≈1 email/min, testing-only), which is why it "only worked for Emanuel."

**Fix (Supabase Dashboard, ~5 min):**
1. **Project Settings → Authentication → SMTP Settings → Enable Custom SMTP.**
   - Provider: Resend / SendGrid / Postmark / your hoster's SMTP.
   - Host, port (587), username, password; sender = your domain.
   - Verify the sending domain (SPF + DKIM) — otherwise mails land in spam.
2. **Authentication → Rate Limits → Email** → raise (e.g. 30–100/h).
3. **Authentication → URL Configuration** → Site URL + Redirect = `https://baby-bob.vercel.app`.

After this, magic link works for unlimited partner/tester emails. **No code change needed.**

> Reliable fallback that already works for everyone **today** (no email): admin creates the user in **User-Verwaltung**, gets an 8-char temp password (shown once), partner logs in → forced password change. See `docs/AUTH_SETUP.md`.

## Database migrations (run once in Supabase SQL Editor)
DDL can't run via the data API — paste these when prompted:
- `scripts/rapport_system_migration.sql` — projekte / tagesrapporte / rechnungen (DONE)
- `scripts/bob_learning_migration.sql` — bob_scans / bob_unbekannt (DONE)
- `scripts/nachrichten_migration.sql` — gs_nachrichten (DONE, FK→gs_anfragen)

## Tests
```
node scripts/test_all.mjs            # full regression (~1000 assertions)
node scripts/test_<feature>.mjs      # per-feature suites
```

## Cron
`vercel.json` schedules `/api/bob-learn` daily at 01:00 UTC (~03:00 Zürich):
BOB reviews the last 24h of feedback and grows `bob_knowledge`.
