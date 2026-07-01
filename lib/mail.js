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

// Rückgabe: { ok, status, id, error, skipped }. ok===true ⇒ Resend hat 2xx + id geliefert.
// (Aufrufer prüfen .ok; gs.js ignoriert den Rückgabewert – beides bleibt kompatibel.)
export async function sendResendEmail({ to, from, subject, html, replyTo, attachments }) {
  const fromAddr = from || DEFAULT_FROM;
  if (!RESEND_API_KEY) {
    console.warn('[RESEND] RESEND_API_KEY fehlt – Mailversand übersprungen.');
    return { ok: false, skipped: true, error: 'RESEND_API_KEY fehlt' };
  }
  try {
    // Empfänger Punycode-sicher machen; unkonvertierbare bestmöglich behalten.
    const toList = (Array.isArray(to) ? to : [to])
      .map((a) => asciiEmail(a) || (typeof a === 'string' ? a.trim() : a))
      .filter((a) => typeof a === 'string' && a.length > 0);
    if (!toList.length) {
      console.warn('[RESEND] keine gültige Empfängeradresse – abgebrochen.', { to });
      return { ok: false, error: 'keine gültige Empfängeradresse' };
    }
    // reply_to ist optional: nur setzen, wenn sauber ASCII-konvertierbar – sonst weglassen,
    // damit die Mail TROTZDEM rausgeht (Umlaut-Domain darf den Versand nie crashen).
    const asciiReplyTo = replyTo ? asciiEmail(replyTo) : null;
    const hasAtt = Array.isArray(attachments) && attachments.length > 0;
    console.log('[RESEND] → senden', { from: fromAddr, to: toList, subject, reply_to: asciiReplyTo || null, attachments: hasAtt ? attachments.length : 0 });

    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: fromAddr,
        to: toList,
        subject,
        html,
        ...(asciiReplyTo ? { reply_to: asciiReplyTo } : {}),
        ...(hasAtt ? { attachments } : {}),
      }),
      signal: ctrl.signal,
    });
    clearTimeout(tm);
    const bodyText = await r.text().catch(() => '');
    if (!r.ok) {
      console.error('[RESEND] ✗ Fehler', r.status, bodyText);
      return { ok: false, status: r.status, error: bodyText || ('HTTP ' + r.status) };
    }
    let id = null;
    try { id = JSON.parse(bodyText).id || null; } catch {}
    console.log('[RESEND] ✓ akzeptiert', r.status, 'id=' + id);
    return { ok: true, status: r.status, id };
  } catch (e) {
    console.error('[RESEND] ✗ Exception:', e.message);
    return { ok: false, error: e.message };
  }
}

// Materiallisten-Mail: Absender fix + Fallback-Empfänger (GS-Büro).
export const MATERIAL_FROM = 'George Solutions <info@george-solutions.ch>';
export const GS_OFFICE_EMAIL = 'info@george-solutions.ch';

function mailEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Materiallisten-Mail-HTML (geteilt von Erstversand + Archiv-Resend → identische Mail).
export function materialEmailHtml({ projektName, vonName, positionen, notiz, tel, fallbackUsed }) {
  const pos = Array.isArray(positionen) ? positionen : [];
  const posRows = pos.map((p) => {
    const menge = [p && p.menge, p && p.einheit].filter(Boolean).map(mailEsc).join(' ');
    return `<tr><td style="padding:7px 14px 7px 0;color:#fff;border-bottom:1px solid rgba(255,255,255,0.06);">${mailEsc((p && p.position) || '')}</td>`
      + `<td style="padding:7px 0;color:#FFD24A;font-weight:700;white-space:nowrap;border-bottom:1px solid rgba(255,255,255,0.06);">${menge || '—'}</td></tr>`;
  }).join('');
  const n = (notiz || '').toString().trim();
  const t = (tel || '').toString().trim();
  const inner = `
    <div style="display:inline-block;background:#FFD24A;color:#0a1628;font-weight:800;font-size:12px;padding:4px 12px;border-radius:50px;margin-bottom:14px;">📦 MATERIALLISTE</div>
    ${fallbackUsed ? '<p style="margin:0 0 12px;padding:10px 12px;background:rgba(255,210,74,0.12);border:1px solid rgba(255,210,74,0.35);border-radius:8px;color:#FFD24A;font-size:13px;">⚠️ Ohne Empfängeradresse gesendet – bitte intern dem richtigen Projektleiter zuordnen.</p>' : ''}
    <h2 style="margin:0 0 4px;font-size:20px;color:#fff;">${mailEsc(projektName || 'Projekt')}</h2>
    <p style="margin:0 0 16px;color:rgba(232,237,245,0.6);">Erfasst von <strong style="color:#fff;">${mailEsc(vonName || 'Techniker')}</strong></p>
    ${posRows ? `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:12px;"><thead><tr><th style="text-align:left;padding:0 0 6px;color:rgba(232,237,245,0.5);font-weight:600;">Position</th><th style="text-align:left;padding:0 0 6px;color:rgba(232,237,245,0.5);font-weight:600;">Menge</th></tr></thead><tbody>${posRows}</tbody></table>` : '<p style="color:rgba(232,237,245,0.6);">Keine Positionen erfasst.</p>'}
    ${n ? `<div style="margin-top:10px;padding:12px 14px;background:rgba(255,255,255,0.04);border-radius:10px;"><div style="color:rgba(232,237,245,0.5);font-size:12px;margin-bottom:4px;">Notiz</div><div style="color:#fff;">${mailEsc(n)}</div></div>` : ''}
    ${t ? `<p style="margin:14px 0 0;color:rgba(232,237,245,0.7);">Rückfragen: <a href="tel:${mailEsc(t.replace(/[^\d+]/g, ''))}" style="color:#4A9EFF;font-weight:700;text-decoration:none;">${mailEsc(t)}</a></p>` : ''}
  `;
  return mailShell(inner);
}

// Rapport-Zusammenfassungs-Mail-HTML (für Archiv-Resend; Rapporte haben sonst keinen Mailweg).
export function rapportEmailHtml({ projektNr, vonName, datum, stunden, arbeiten, material, besonderheiten, empfaenger }) {
  const list = (a) => (Array.isArray(a) && a.length) ? a.map(mailEsc).join(', ') : '—';
  const row = (label, value) => `<tr><td style="padding:6px 12px 6px 0;color:rgba(232,237,245,0.55);white-space:nowrap;vertical-align:top;">${mailEsc(label)}</td><td style="padding:6px 0;color:#fff;font-weight:600;">${value}</td></tr>`;
  const inner = `
    <div style="display:inline-block;background:#4A9EFF;color:#fff;font-weight:800;font-size:12px;padding:4px 12px;border-radius:50px;margin-bottom:14px;">📋 TAGESRAPPORT</div>
    <h2 style="margin:0 0 4px;font-size:20px;color:#fff;">${mailEsc(projektNr || 'Projekt')}</h2>
    <p style="margin:0 0 16px;color:rgba(232,237,245,0.6);">Erstellt von <strong style="color:#fff;">${mailEsc(vonName || 'Techniker')}</strong></p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      ${row('Datum', mailEsc(datum || '—'))}
      ${row('Stunden', mailEsc((stunden != null ? stunden : '—') + ' h'))}
      ${row('Arbeiten', list(arbeiten))}
      ${row('Material', list(material))}
      ${besonderheiten ? row('Besonderheiten', mailEsc(besonderheiten)) : ''}
      ${row('Empfänger', list(empfaenger))}
    </table>`;
  return mailShell(inner);
}

// Sofort-Benachrichtigung bei neuer/aktualisierter Blockade (an Owner / Bauleiter-Büro).
export function blockadeEmailHtml({ blockade, statusChange }) {
  const b = blockade || {};
  const URG = {
    CRITICAL: { c: '#ff4d4f', bg: 'rgba(255,77,79,0.14)', l: '🔴 KRITISCH' },
    HIGH:     { c: '#ff9838', bg: 'rgba(255,152,56,0.14)', l: '🟠 HOCH' },
    MEDIUM:   { c: '#FFD24A', bg: 'rgba(255,210,74,0.14)', l: '🟡 MITTEL' },
    LOW:      { c: '#6bcb77', bg: 'rgba(107,203,119,0.14)', l: '🟢 NIEDRIG' },
  };
  const u = URG[b.urgency] || URG.MEDIUM;
  const ort = [b.haus, b.einheit, b.zone].filter(Boolean).map(mailEsc).join(' · ') || '–';
  const row = (label, value) => `<tr><td style="padding:6px 12px 6px 0;color:rgba(232,237,245,0.55);white-space:nowrap;vertical-align:top;">${mailEsc(label)}</td><td style="padding:6px 0;color:#fff;font-weight:600;">${value}</td></tr>`;
  const heading = statusChange
    ? `Blockade aktualisiert: ${mailEsc(b.status || '')}`
    : 'Neue Blockade gemeldet';
  const inner = `
    <div style="display:inline-block;background:${u.bg};color:${u.c};font-weight:800;font-size:12px;padding:5px 13px;border-radius:50px;margin-bottom:14px;border:1px solid ${u.c};">🚧 ${u.l}</div>
    <h2 style="margin:0 0 4px;font-size:20px;color:#fff;">${mailEsc(heading)}</h2>
    <p style="margin:0 0 16px;color:rgba(232,237,245,0.6);">Gemeldet von <strong style="color:#fff;">${mailEsc(b.reporter_name || 'Techniker')}</strong>${b.reporter_firma ? ' · ' + mailEsc(b.reporter_firma) : ''}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:14px;">
      ${row('Projekt', mailEsc(b.projekt_name || '–'))}
      ${row('Ort', ort)}
      ${row('Blockierter Step', mailEsc(b.step_ref || '–'))}
      ${row('Blockiert von', mailEsc(b.blockiert_von_rolle || '–'))}
      ${row('Status', mailEsc(b.status || 'offen'))}
    </table>
    <div style="padding:12px 14px;background:rgba(255,255,255,0.04);border-radius:10px;border-left:3px solid ${u.c};">
      <div style="color:rgba(232,237,245,0.5);font-size:12px;margin-bottom:4px;">Beschreibung</div>
      <div style="color:#fff;">${mailEsc(b.beschreibung || '–')}</div>
    </div>
    ${b.resolution ? `<div style="margin-top:10px;padding:12px 14px;background:rgba(107,203,119,0.08);border-radius:10px;"><div style="color:rgba(232,237,245,0.5);font-size:12px;margin-bottom:4px;">Auflösung</div><div style="color:#fff;">${mailEsc(b.resolution)}</div></div>` : ''}
    <p style="margin:16px 0 0;color:rgba(232,237,245,0.6);font-size:13px;">Der betroffene Step erscheint jetzt 🔴 im Status-Dashboard. Details &amp; Freigabe im George-Solutions-Portal.</p>
  `;
  return mailShell(inner);
}

// Wochen-Blockaden-Report-Mail („Was hat uns diese Woche verzögert?").
export function blockadenReportEmailHtml({ kw, jahr, blockaden, projektName }) {
  const list = Array.isArray(blockaden) ? blockaden : [];
  const offen = list.filter((b) => b.status !== 'freigegeben').length;
  const eskaliert = list.filter((b) => b.eskaliert || b.status === 'eskaliert').length;
  const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const rows = list.slice().sort((a, b) => (rank[a.urgency] ?? 9) - (rank[b.urgency] ?? 9)).slice(0, 20).map((b) => {
    const ort = [b.projekt_name, b.haus, b.zone].filter(Boolean).map(mailEsc).join(' · ');
    return `<tr>
      <td style="padding:7px 10px 7px 0;color:#fff;border-bottom:1px solid rgba(255,255,255,0.06);vertical-align:top;"><strong>${mailEsc(b.step_ref || 'Step')}</strong><br><span style="color:rgba(232,237,245,0.55);font-size:12px;">${ort || '–'}</span></td>
      <td style="padding:7px 0;color:#FFD24A;font-weight:700;white-space:nowrap;border-bottom:1px solid rgba(255,255,255,0.06);vertical-align:top;">${mailEsc(b.urgency || 'MEDIUM')}<br><span style="color:rgba(232,237,245,0.55);font-size:12px;">${mailEsc(b.status || 'offen')}</span></td>
    </tr>`;
  }).join('');
  const inner = `
    <div style="display:inline-block;background:#FFD24A;color:#0a1628;font-weight:800;font-size:12px;padding:4px 12px;border-radius:50px;margin-bottom:14px;">🚧 BLOCKADEN-WOCHENREPORT</div>
    <h2 style="margin:0 0 4px;font-size:20px;color:#fff;">Was hat uns diese Woche verzögert?</h2>
    <p style="margin:0 0 16px;color:rgba(232,237,245,0.6);">KW ${mailEsc(String(kw || '–'))}/${mailEsc(String(jahr || '–'))}${projektName ? ' · ' + mailEsc(projektName) : ' · alle Projekte'}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:14px;">
      <tr>
        <td style="padding:10px;background:rgba(255,255,255,0.04);border-radius:8px;text-align:center;"><div style="font-size:22px;font-weight:800;color:#fff;">${list.length}</div><div style="font-size:11px;color:rgba(232,237,245,0.5);">gesamt</div></td>
        <td style="width:8px;"></td>
        <td style="padding:10px;background:rgba(255,210,74,0.1);border-radius:8px;text-align:center;"><div style="font-size:22px;font-weight:800;color:#FFD24A;">${offen}</div><div style="font-size:11px;color:rgba(232,237,245,0.5);">offen</div></td>
        <td style="width:8px;"></td>
        <td style="padding:10px;background:rgba(255,77,79,0.1);border-radius:8px;text-align:center;"><div style="font-size:22px;font-weight:800;color:#ff4d4f;">${eskaliert}</div><div style="font-size:11px;color:rgba(232,237,245,0.5);">eskaliert</div></td>
      </tr>
    </table>
    ${rows ? `<table style="width:100%;border-collapse:collapse;font-size:14px;"><thead><tr><th style="text-align:left;padding:0 0 6px;color:rgba(232,237,245,0.5);font-weight:600;">Blockade / Ort</th><th style="text-align:left;padding:0 0 6px;color:rgba(232,237,245,0.5);font-weight:600;">Dringlichkeit</th></tr></thead><tbody>${rows}</tbody></table>` : '<p style="color:rgba(232,237,245,0.6);">Keine Blockaden in dieser Kalenderwoche – reibungsloser Ablauf. 🎉</p>'}
    <p style="margin:16px 0 0;color:rgba(232,237,245,0.6);font-size:13px;">Vollständiger Report als PDF im Anhang.</p>
  `;
  return mailShell(inner);
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
