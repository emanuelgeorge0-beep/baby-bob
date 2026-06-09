// lib/mail.js – Gemeinsamer Resend-Mailversand (Punycode-/IDN-sicher).
// Wird von api/gs.js (Lead-Mails) und api/nachrichten.js (Materiallisten-Versand) genutzt.
// Wirft NICHT nach aussen – Fehler werden geloggt und als false signalisiert.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DEFAULT_FROM = process.env.GS_MAIL_FROM || 'George Solutions <noreply@george-solutions.ch>';
const GS_LOGO_URL = 'https://baby-bob.vercel.app/lib/logo-gs.png';

// E-Mail-Adresse Punycode-/IDN-sicher machen (Resend lehnt Umlaut-Domains mit 422 ab).
// Kodiert NUR den Domain-Teil in ASCII (z.B. rüttiag.ch → xn--rttiag-3ya.ch).
// Gibt bei leerer/ungültiger Adresse oder Fehler null zurück.
export function asciiEmail(addr) {
  if (typeof addr !== 'string') return null;
  const trimmed = addr.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;
  const localPart = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  try {
    const asciiDomain = new URL('http://' + domain).hostname;
    if (!asciiDomain) return null;
    return localPart + '@' + asciiDomain;
  } catch {
    return null;
  }
}

export async function sendResendEmail({ to, from, subject, html, replyTo, attachments }) {
  if (!RESEND_API_KEY) {
    console.warn('mail: RESEND_API_KEY fehlt – Mailversand übersprungen.');
    return false;
  }
  try {
    // Empfänger Punycode-sicher machen; unkonvertierbare bestmöglich behalten.
    const toList = (Array.isArray(to) ? to : [to])
      .map((a) => asciiEmail(a) || (typeof a === 'string' ? a.trim() : a))
      .filter((a) => typeof a === 'string' && a.length > 0);
    if (!toList.length) {
      console.warn('mail: keine gültige Empfängeradresse.');
      return false;
    }
    // reply_to ist optional: nur setzen, wenn sauber ASCII-konvertierbar – sonst weglassen,
    // damit die Mail TROTZDEM rausgeht (Umlaut-Domain darf den Versand nie crashen).
    const asciiReplyTo = replyTo ? asciiEmail(replyTo) : null;

    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: from || DEFAULT_FROM,
        to: toList,
        subject,
        html,
        ...(asciiReplyTo ? { reply_to: asciiReplyTo } : {}),
        ...(Array.isArray(attachments) && attachments.length ? { attachments } : {}),
      }),
      signal: ctrl.signal,
    });
    clearTimeout(tm);
    if (!r.ok) {
      console.error('Resend Fehler:', r.status, await r.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (e) {
    console.error('Resend Exception:', e.message);
    return false;
  }
}

// GS-gebrandete Mail-Hülle (schwarz/gold), identisch zum Lead-Mail-Look.
export function mailShell(innerHtml) {
  return `<div style="margin:0;padding:24px 0;background:#07111f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#0d1b2e;border:1px solid rgba(74,158,255,0.22);border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#0a1628,#13294a);padding:22px 26px;border-bottom:2px solid #FFD24A;">
        <img src="${GS_LOGO_URL}" alt="George Solutions" width="180" style="max-width:180px;height:auto;display:block;"/>
      </div>
      <div style="padding:26px;color:#e8edf5;font-size:15px;line-height:1.55;">${innerHtml}</div>
      <div style="padding:16px 26px;border-top:1px solid rgba(255,255,255,0.07);color:rgba(232,237,245,0.45);font-size:12px;">
        George Solutions · Schweizer HKLS-Dienstleistung &amp; KI-Fachmann-Finder
      </div>
    </div>
  </div>`;
}
