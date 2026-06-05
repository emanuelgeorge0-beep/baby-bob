# Auth & Onboarding Setup (Partner / Techniker)

## TL;DR for partner onboarding (works TODAY, no email needed)
The **reliable** production path does NOT depend on email:
1. Emanuel (admin) → User-Verwaltung → **+ Neuer User** (Name, E-Mail, Firma, Rolle).
2. System generates an **8-char temp password**, shown **once** → send it to the partner (WhatsApp/SMS/call).
3. Partner logs in with E-Mail + temp password → **forced password change** → profile → portal.

This flow is tested (39/39) and works for **every** email address immediately.

## Magic Link status
- Code: `api/auth.js` uses `create_user:true` → OTP is accepted for **ANY** email (proven: a fresh Gmail returned `{"ok":true}` and received the link). No whitelist.
- **Limitation:** Supabase's *built-in* email service is heavily rate-limited (≈1/minute, a few/hour) and meant for testing only. That's why "only Emanuel worked" — not a code issue.

### Required for magic link at scale (Emanuel, ~5 min in dashboard)
Supabase Dashboard → **Project Settings → Authentication → SMTP Settings** → enable **Custom SMTP**:
- Use any provider (Resend, SendGrid, Postmark, Gmail SMTP, your hoster's SMTP).
- Set sender, host, port, user, pass; verify your sending domain (SPF/DKIM).
- Also raise **Auth → Rate Limits → Email** once custom SMTP is set.
- Auth → URL Configuration: Site URL + Redirect = `https://baby-bob.vercel.app`.

After custom SMTP is configured, magic link works reliably for unlimited partner emails — no code change needed.
