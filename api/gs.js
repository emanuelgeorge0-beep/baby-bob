// api/gs.js – George Solutions Submission Handler (Server-Side)
//
// Speichert GS-Leads (gs_kunden + gs_anfragen), inkl. Quellen-/UTM-Tracking,
// und verschickt zwei Mails: (1) Lead-Alarm an GS, (2) Bestätigung an Kunden.
// Mailfehler dürfen die Lead-Speicherung NIEMALS blockieren (nur loggen).

import { sendResendEmail } from '../lib/mail.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;

// ── Mail-Konfiguration (leicht änderbar) ──
const GS_LEAD_RECIPIENTS = ['info@george-solutions.ch', 'emanuelgeorge0@gmail.com'];
const GS_LOGO_URL = 'https://baby-bob.vercel.app/lib/logo-gs.png';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('GS: Supabase env vars missing');
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    const { kunden, anfrage, action, anfrage_id, tracking, team, source } = req.body || {};
    const isLanding = source === 'landing';   // Landing-Lead: kurzes Formular, Adresse optional (max. Leads)

    const headers0 = {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    };

    // Lead-Sicherung: Erstgespräch nachträglich anfordern (vom Success-Screen).
    if (action === 'erstgespraech') {
      if (!anfrage_id) return res.status(400).json({ error: 'anfrage_id fehlt' });
      const getR = await fetch(`${SUPABASE_URL}/rest/v1/gs_anfragen?id=eq.${anfrage_id}&select=notiz`, { headers: headers0 });
      const cur = (await getR.json().catch(() => []))?.[0] || {};
      const note = '🔔 ERSTGESPRÄCH ANGEFORDERT (Rückruf <2h, werktags). ' + (cur.notiz || '');
      const upd = await fetch(`${SUPABASE_URL}/rest/v1/gs_anfragen?id=eq.${anfrage_id}`, {
        method: 'PATCH', headers: { ...headers0, Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'Erstgespräch angefordert', notiz: note }),
      });
      if (!upd.ok) return res.status(500).json({ error: 'Update fehlgeschlagen' });
      return res.status(200).json({ success: true });
    }

    if (!kunden?.email) {
      return res.status(400).json({ error: 'E-Mail ist ein Pflichtfeld' });
    }
    if (isLanding) {
      // Landing: nur Name + E-Mail Pflicht (max. Leads, Adresse optional).
      if (!kunden?.name && !kunden?.vorname) {
        return res.status(400).json({ error: 'Name ist ein Pflichtfeld' });
      }
    } else {
      if (!kunden?.vorname || !kunden?.nachname) {
        return res.status(400).json({ error: 'Vorname und Nachname sind Pflichtfelder' });
      }
      if (!kunden?.strasse || !kunden?.plz || !kunden?.ort) {
        return res.status(400).json({ error: 'Adresse (Strasse, PLZ, Ort) ist ein Pflichtfeld' });
      }
    }

    const headers = {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    };

    // ── 1. Kunden speichern ──
    let kundeId = null;
    const fullName = (`${kunden.vorname || ''} ${kunden.nachname || ''}`.trim()) || kunden.name || 'Lead';
    try {
      const kundenPayload = {
        firma: kunden.firma || fullName || 'Privatkunde',  // NOT NULL in DB
        kontaktperson: fullName,
        telefon: kunden.telefon || null,
        email: kunden.email,
        adresse: kunden.strasse || null,
        plz: kunden.plz || null,
        ort: kunden.ort || null,
      };

      const kundenRes = await fetch(
        `${SUPABASE_URL}/rest/v1/gs_kunden`,
        {
          method: 'POST',
          headers: { ...headers, Prefer: 'return=representation' },
          body: JSON.stringify(kundenPayload),
        }
      );

      if (kundenRes.ok) {
        const rows = await kundenRes.json();
        kundeId = Array.isArray(rows) && rows[0] ? rows[0].id : null;
      } else {
        const errText = await kundenRes.text();
        console.error('gs_kunden insert error:', kundenRes.status, errText);
      }
    } catch (kundeErr) {
      console.error('gs_kunden exception:', kundeErr.message);
    }

    // ── 2. Quelle ableiten (UTM > Referrer > direkt) ──
    const t = tracking && typeof tracking === 'object' ? tracking : {};
    const quelle = deriveQuelle(t);
    const trackingCols = {
      utm_source: t.utm_source || null,
      utm_medium: t.utm_medium || null,
      utm_campaign: t.utm_campaign || null,
      utm_term: t.utm_term || null,
      utm_content: t.utm_content || null,
      referrer: t.referrer || null,
      quelle: quelle,
    };

    // ── 3. Anfrage speichern ──
    const baseAnfrage = {
      kunde_id: kundeId,
      projekt_name: anfrage?.projekt_name || null,
      bereich: anfrage?.bereich || null,
      objekttyp: anfrage?.objekttyp || null,
      beschreibung: anfrage?.beschreibung || null,
      dringlichkeit: anfrage?.dringlichkeit || 'Normal',
      tarif: anfrage?.tarif || null,
      tarif_preis: anfrage?.tarif_preis || null,
      geschaetzte_stunden: anfrage?.geschaetzte_stunden || null,
      umfang: anfrage?.umfang || null,
      gewuenschter_start: anfrage?.gewuenschter_start || null,
      notiz: (anfrage?.erstgespraech ? '🔔 ERSTGESPRÄCH ANGEFORDERT (Rückruf <2h, werktags). ' : '') + (anfrage?.notiz || ''),
      status: anfrage?.erstgespraech ? 'Erstgespräch angefordert' : 'neu',
    };

    // Erst MIT Tracking-Spalten versuchen; falls Migration (utm_tracking_migration.sql)
    // noch nicht gelaufen ist, ohne Tracking-Spalten erneut versuchen → Lead geht NIE verloren.
    let anfrageId = await insertAnfrage(headers, { ...baseAnfrage, ...trackingCols });
    if (anfrageId === false) {
      console.warn('gs_anfragen: Tracking-Spalten fehlen evtl. – Fallback ohne UTM (bitte utm_tracking_migration.sql ausführen)');
      anfrageId = await insertAnfrage(headers, baseAnfrage);
      if (anfrageId === false) {
        throw new Error('gs_anfragen Insert fehlgeschlagen');
      }
    }

    // ── 4. Mails verschicken (non-blocking: Fehler werden nur geloggt) ──
    try {
      await sendLeadEmails({
        name: fullName,
        firma: kunden.firma || null,
        telefon: kunden.telefon || null,
        email: kunden.email,
        ort: [kunden.plz, kunden.ort].filter(Boolean).join(' '),
        bereich: anfrage?.bereich || anfrage?.objekttyp || null,
        projekt: anfrage?.projekt_name || null,
        nachricht: anfrage?.beschreibung || anfrage?.notiz || null,   // freie Kundennachricht (Landing)
        erstgespraech: !!anfrage?.erstgespraech,
        quelle,
        team: team && typeof team === 'object' ? team : null,
        tarif: anfrage?.tarif || (team && team.tarif) || null,
        tarif_preis: anfrage?.tarif_preis || null,
      });
    } catch (mailErr) {
      console.error('GS Mailversand (nicht-blockierend) fehlgeschlagen:', mailErr.message);
    }

    return res.status(200).json({ success: true, kunde_id: kundeId, anfrage_id: anfrageId, quelle });

  } catch (err) {
    console.error('GS Submit Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// Liefert die neue anfrage_id (String|null) bei Erfolg, oder `false` bei Spalten-/Schema-Fehler.
async function insertAnfrage(headers, payload) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/gs_anfragen`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    // Unbekannte Spalte / Schema-Cache → Fallback signalisieren (Migration fehlt noch).
    if (/PGRST204|42703|column .* does not exist|could not find/i.test(errText) || r.status === 400) {
      console.error('gs_anfragen insert (Schema?):', r.status, errText);
      return false;
    }
    throw new Error(`gs_anfragen ${r.status}: ${errText}`);
  }
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? rows[0].id : null;
}

function deriveQuelle(t) {
  if (t.utm_source) return String(t.utm_source).toLowerCase().slice(0, 60);
  const ref = String(t.referrer || '').toLowerCase();
  if (!ref) return 'direkt';
  if (/google\./.test(ref)) return 'google';
  if (/(facebook|instagram|fb\.com|fbclid|meta\.)/.test(ref)) return 'meta';
  if (/bing\./.test(ref)) return 'bing';
  if (/duckduckgo\./.test(ref)) return 'duckduckgo';
  if (/baby-bob|george-solutions/.test(ref)) return 'direkt';
  return 'direkt';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function gsMailShell(innerHtml) {
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

async function sendLeadEmails(d) {
  const telDigits = (d.telefon || '').replace(/[^\d+]/g, '');
  const quelleLabel = ({ google: 'Google', meta: 'Meta', bing: 'Bing', direkt: 'Direkt', bob: 'BOB' }[d.quelle] || d.quelle || 'Direkt');
  const ts = new Date().toLocaleString('de-CH', { timeZone: 'Europe/Zurich' });

  // (1) Lead-Alarm an GS – zum Sofort-Handeln (Telefon/Mail klickbar).
  const row = (label, value) => value ? `<tr><td style="padding:6px 10px 6px 0;color:rgba(232,237,245,0.55);white-space:nowrap;vertical-align:top;">${esc(label)}</td><td style="padding:6px 0;color:#fff;font-weight:600;">${value}</td></tr>` : '';
  const telCell = telDigits
    ? `<a href="tel:${esc(telDigits)}" style="color:#4A9EFF;font-weight:800;text-decoration:none;">📞 ${esc(d.telefon)}</a>`
    : '<span style="color:rgba(232,237,245,0.4);">—</span>';
  const mailCell = d.email
    ? `<a href="mailto:${esc(d.email)}" style="color:#4A9EFF;font-weight:700;text-decoration:none;">${esc(d.email)}</a>`
    : '<span style="color:rgba(232,237,245,0.4);">—</span>';

  // Team / Personen (Block 7) – für Account-Einrichtung + Vorbereitung.
  const t = d.team || {};
  const teamMembers = Array.isArray(t.members) ? t.members.filter(Boolean) : [];
  const teamLabel = t.mode === 'single'
    ? 'Einzel-Techniker'
    : ('2er-Team' + (t.name ? ' · ' + t.name : ''));
  const teamValue = [teamLabel, teamMembers.length ? '👥 ' + teamMembers.join(' & ') : ''].filter(Boolean).map(esc).join(' — ');
  const tarifValue = [d.tarif, d.tarif_preis, (t.stundensatz ? 'CHF ' + t.stundensatz + '/h' : '')].filter(Boolean).map(esc).join(' · ');

  const leadInner = `
    <div style="display:inline-block;background:#FFD24A;color:#0a1628;font-weight:800;font-size:12px;padding:4px 12px;border-radius:50px;margin-bottom:14px;">🔔 NEUER GS-LEAD · ${esc(quelleLabel)}</div>
    <h2 style="margin:0 0 4px;font-size:20px;color:#fff;">${esc(d.name)}</h2>
    ${d.erstgespraech ? '<p style="margin:0 0 16px;color:#FFD24A;font-weight:700;">⏱ Erstgespräch gewünscht – Rückruf &lt;2h (werktags)</p>' : '<p style="margin:0 0 16px;color:rgba(232,237,245,0.55);">Neue Anfrage eingegangen.</p>'}
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      ${row('Telefon', telCell)}
      ${row('E-Mail', mailCell)}
      ${row('Firma', d.firma ? esc(d.firma) : '')}
      ${row('Ort', d.ort ? esc(d.ort) : '')}
      ${row('Anliegen', [d.bereich, d.projekt].filter(Boolean).map(esc).join(' · '))}
      ${row('Team / Personen', teamValue)}
      ${row('Tarif', tarifValue)}
      ${row('Quelle', esc(quelleLabel))}
      ${row('Eingegangen', esc(ts))}
    </table>
    ${d.nachricht ? `<div style="margin-top:14px;padding:13px 15px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:11px;"><div style="color:rgba(232,237,245,0.5);font-size:12px;margin-bottom:5px;">Nachricht des Kunden</div><div style="color:#fff;white-space:pre-wrap;word-break:break-word;">${esc(d.nachricht)}</div></div>` : ''}
    ${telDigits ? `<a href="tel:${esc(telDigits)}" style="display:inline-block;margin-top:20px;background:linear-gradient(135deg,#4A9EFF,#2d7fe0);color:#fff;font-weight:800;text-decoration:none;padding:13px 26px;border-radius:50px;">📞 Jetzt anrufen</a>` : ''}
  `;
  const subject = `🔔 Neuer GS-Lead: ${d.name} – ${d.telefon || 'keine Nr.'} (${quelleLabel})`;
  await sendResendEmail({
    to: GS_LEAD_RECIPIENTS,
    from: 'George Solutions <info@george-solutions.ch>',   // Absender fix info@ (Lead-Alarm an GS)
    subject,
    html: gsMailShell(leadInner),
    replyTo: isPlausibleEmail(d.email) ? d.email : undefined,   // "Antworten" geht direkt an den Kunden
  });

  // (2) Bestätigung an den Kunden – nur bei plausibler E-Mail.
  if (isPlausibleEmail(d.email)) {
    const vorname = (d.name || '').split(' ')[0] || '';
    // Gewähltes Team in der Kundenbestätigung anzeigen (Personen, kein Equipment).
    const confRow = (label, value) => value ? `<tr><td style="padding:5px 12px 5px 0;color:rgba(232,237,245,0.55);white-space:nowrap;vertical-align:top;">${esc(label)}</td><td style="padding:5px 0;color:#fff;font-weight:600;">${esc(value)}</td></tr>` : '';
    const confTarif = [d.tarif, d.tarif_preis].filter(Boolean).join(' · ');
    // Team nur zeigen, wenn im GS-Flow tatsächlich eine Auswahl getroffen wurde
    // (Landing-Leads haben keine Team-Auswahl → kein irreführendes "2er-Team").
    const hasTeamSel = !!(d.team && (d.team.mode || teamMembers.length));
    const confTeamBox = (hasTeamSel || confTarif || d.projekt || d.bereich)
      ? `<div style="margin:16px 0;padding:14px 16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,210,74,0.22);border-radius:12px;">
          <div style="color:#FFD24A;font-weight:700;font-size:13px;margin-bottom:8px;">Ihre Auswahl</div>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            ${confRow('Projekt', [d.projekt, d.bereich].filter(Boolean).join(' · '))}
            ${confRow('Tarif', confTarif)}
            ${hasTeamSel ? confRow('Team', teamLabel) : ''}
            ${hasTeamSel && teamMembers.length ? confRow('Ihr Team', teamMembers.join(' & ')) : ''}
          </table>
        </div>`
      : '';
    const confInner = `
      <h2 style="margin:0 0 14px;font-size:20px;color:#fff;">Vielen Dank für Ihre Anfrage</h2>
      <p style="margin:0 0 14px;">Guten Tag${vorname ? ' ' + esc(vorname) : ''},</p>
      <p style="margin:0 0 14px;">vielen Dank für Ihre Anfrage bei <strong>George Solutions</strong>. Wir haben sie erhalten und melden uns innerhalb von <strong>2 Stunden (werktags)</strong> persönlich bei Ihnen.</p>
      ${confTeamBox}
      <p style="margin:0 0 14px;">Für Rückfragen erreichen Sie uns jederzeit unter <a href="mailto:info@george-solutions.ch" style="color:#4A9EFF;font-weight:700;text-decoration:none;">info@george-solutions.ch</a> — gerne vereinbaren wir auch ein telefonisches Erstgespräch.</p>
      <p style="margin:18px 0 0;color:rgba(232,237,245,0.7);">Freundliche Grüsse<br><strong style="color:#fff;">George Solutions</strong></p>
    `;
    await sendResendEmail({
      to: d.email,
      subject: 'Ihre Anfrage bei George Solutions – wir melden uns',
      html: gsMailShell(confInner),
      replyTo: GS_LEAD_RECIPIENTS[0],
    });
  }
}

function isPlausibleEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());
}
