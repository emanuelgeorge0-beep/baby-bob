// scripts/devserver.mjs — lokaler Dev-Server, NUR fuer Tests auf diesem Rechner.
//
// Serviert das Repo-Root wie Vercel (outputDirectory ".") und routet /api/* auf
// die echten Handler in api/*.js. Bindet ausschliesslich an 127.0.0.1: der
// Server spricht mit dem Service-Key gegen die Live-Supabase und darf deshalb
// nie im Netz erreichbar sein.
//
//   node --env-file=.env.local scripts/devserver.mjs
//   MAIL_ATTRAPPE=1 RESEND_API_KEY=x node --env-file=.env.local scripts/devserver.mjs
//
// MAIL_ATTRAPPE=1 faengt Aufrufe an api.resend.com ab, damit der echte
// Versandpfad bis zum Ende laeuft, ohne dass eine Mail den Rechner verlaesst.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 4321);
const REWRITES = { '/gs-intern-7k2x': '/gs-intern.html', '/app': '/app.html', '/': '/index.html' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

// MAIL-ATTRAPPE (nur lokal, nur mit MAIL_ATTRAPPE=1): faengt Aufrufe an
// api.resend.com ab, damit der ECHTE Versandpfad bis zum Ende laeuft, ohne dass
// eine Mail den Rechner verlaesst. Die abgefangenen Mails landen in mails.json.
const MAILS = [];
if (process.env.MAIL_ATTRAPPE === '1') {
  const echt = globalThis.fetch;
  globalThis.fetch = async (u, o) => {
    if (String(u).startsWith('https://api.resend.com')) {
      const body = JSON.parse((o && o.body) || '{}');
      MAILS.push({ to: body.to, subject: body.subject, anhaenge: (body.attachments || []).map((a) => ({ filename: a.filename, bytes: Buffer.from(a.content, 'base64').length })), html_len: (body.html || '').length });
      // Nur schreiben, wenn ausdruecklich ein Ziel genannt wurde — nichts nach /tmp streuen.
      if (process.env.MAIL_OUT) fs.writeFileSync(path.join(process.env.MAIL_OUT, 'mails.json'), JSON.stringify(MAILS, null, 1));
      console.log('[mail-attrappe] abgefangen →', JSON.stringify(body.to), '|', body.subject);
      return new Response(JSON.stringify({ id: 'attrappe-' + MAILS.length }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return echt(u, o);
  };
}

const handlers = new Map();
async function getHandler(name) {
  if (handlers.has(name)) return handlers.get(name);
  const file = path.join(ROOT, 'api', `${name}.js`);
  if (!fs.existsSync(file)) return null;
  const mod = await import(pathToFileURL(file).href);
  handlers.set(name, mod.default);
  return mod.default;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let p = url.pathname;

  if (p.startsWith('/api/')) {
    const name = p.slice(5).split('/')[0];
    const fn = await getHandler(name);
    if (!fn) { res.writeHead(404).end('no handler ' + name); return; }
    let raw = '';
    for await (const c of req) raw += c;
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
    // Minimaler Express-Shim, genau die Methoden, die die Handler benutzen.
    const shim = {
      _code: 200, _headers: {},
      setHeader(k, v) { this._headers[k] = v; return this; },
      status(c) { this._code = c; return this; },
      json(o) { res.writeHead(this._code, { ...this._headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); return this; },
      send(t) { res.writeHead(this._code, this._headers); res.end(String(t)); return this; },
      end(t) { res.writeHead(this._code, this._headers); res.end(t || ''); return this; },
    };
    try { await fn({ method: req.method, headers: req.headers, body, query: Object.fromEntries(url.searchParams) }, shim); }
    catch (e) { console.error('[api ' + name + ']', e.message); if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); } }
    return;
  }

  if (REWRITES[p]) p = REWRITES[p];
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(file));
}).listen(PORT, '127.0.0.1', () => console.log(`dev server (nur 127.0.0.1): http://localhost:${PORT}/gs-intern-7k2x`));
