// src/features/projectflow/ProjectWorkspace.js
// Vollständiger Projekt-Workflow als autarke, framework-freie Komponente.
// Rechte & Kontext kommen NUR über Props – keine Imports aus Shell-/Access-Dateien:
//
//   mountProjectWorkspace(container, {
//     companyId,        // Mandant/Firma (informativ, Auth läuft über Token+Rolle)
//     canRapport,       // true → Reiter "Rapport" (erstellen, unterschreiben, PDF)
//     canOrder,         // true → "Material bestellen → Mail an Techniker"
//     token,            // Supabase Access-Token (Bearer) für die bestehenden /api-Endpunkte
//     currentUser,      // { id, name, email } – für Anzeige/Absendername (optional)
//     baseUrl,          // API-Basis (Standard: gleiche Origin '')
//   })
//
// Wiederverwendet: /api/projekte, /api/projectflow, /api/tagesrapport, /api/nachrichten, /api/voice.

import { createApi } from './api.js';
import * as Mat from './material.js';
import { createSignaturePad } from './signaturePad.js';
import { createVoiceMemo } from './voiceMemo.js';

const DEMO_TECHS = ['Emanuel George', 'Patrick Notter'];
const STATUS = { offen: 'Offen', aktiv: 'Aktiv', abgeschlossen: 'Abgeschlossen' };

export function mountProjectWorkspace(container, props) {
  const w = new ProjectWorkspace(props);
  w.mount(container);
  return w;
}

export class ProjectWorkspace {
  constructor(props = {}) {
    this.props = { companyId: null, canRapport: false, canOrder: false, token: null, baseUrl: '', currentUser: null, ...props };
    this.api = createApi({ token: this.props.token, baseUrl: this.props.baseUrl });
    this.s = {
      tab: 'overview',
      projects: [], technicians: [], current: null,
      plans: [], material: [], rapporte: [],
      assigned: new Set(),        // gewählte Techniker-user_ids (Zuweisung)
      showNew: false, busy: false, lastPdf: null,
    };
    this.sig = null; this.voice = null;
  }

  async mount(root) {
    this.root = root;
    root.classList.add('pfw');
    root.innerHTML = `<div class="pfw-wrap">
      <div class="pfw-head">
        <div class="pfw-title">Projekt-Workflow<small>George Solutions${this.props.companyId ? ' · ' + esc(this.props.companyId) : ''}</small></div>
        <span id="pfw-status" class="pfw-badge status-offen" hidden></span>
      </div>
      <div id="pfw-proj"></div>
      <div id="pfw-tabs"></div>
      <div id="pfw-view"></div>
    </div>
    <div id="pfw-toast" class="pfw-toast"></div>`;

    // Delegierte Handler (einmalig)
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('input', (e) => this.onInput(e));
    root.addEventListener('change', (e) => this.onChange(e));

    await this.loadInitial();
  }

  destroy() { this.sig?.destroy(); this.voice?.destroy(); }

  // ── Laden ──
  async loadInitial() {
    this.setBusy(true);
    try {
      const [pj, tc] = await Promise.allSettled([this.api.listProjects(), this.api.technicians()]);
      this.s.projects = pj.status === 'fulfilled' ? (pj.value.projekte || []) : [];
      const techs = tc.status === 'fulfilled' ? (tc.value.technicians || []) : [];
      this.s.technicians = mergeDemoTechs(techs);
      if (this.s.projects.length) await this.openProject(this.s.projects[0].id, false);
    } catch (e) {
      this.toast(e.message || 'Laden fehlgeschlagen', 'err');
    } finally {
      this.setBusy(false);
      this.renderProjectBar(); this.renderTabs(); this.renderView();
    }
  }

  async openProject(id, notify = true) {
    try {
      const { projekt } = await this.api.getProject(id);
      this.s.current = projekt;
      this.s.assigned = new Set((projekt.techniker || []).map((t) => t.user_id).filter(Boolean));
      this.s.material = []; this.s.lastPdf = null;
      await Promise.allSettled([this.loadPlans(), this.loadRapporte()]);
      if (notify) { this.renderProjectBar(); this.renderView(); }
      this.renderStatusBadge();
    } catch (e) { this.toast(e.message || 'Projekt konnte nicht geöffnet werden', 'err'); }
  }

  async loadPlans() {
    if (!this.s.current) return;
    try { const { plans } = await this.api.listPlans(this.s.current.id); this.s.plans = plans || []; }
    catch { this.s.plans = []; }
  }
  async loadRapporte() {
    if (!this.s.current) return;
    try { const { rapporte } = await this.api.listRapporte(this.s.current.id); this.s.rapporte = rapporte || []; }
    catch { this.s.rapporte = []; }
  }

  // ── Rendering: Kopf/Projektwahl ──
  renderProjectBar() {
    const el = this.$('#pfw-proj');
    const opts = this.s.projects.map((p) => `<option value="${esc(p.id)}"${this.s.current && p.id === this.s.current.id ? ' selected' : ''}>${esc(p.name)}${p.projektnummer ? ' · ' + esc(p.projektnummer) : ''}</option>`).join('');
    el.innerHTML = `
      <div class="pfw-row" style="align-items:flex-end">
        <div style="flex:1 1 200px">
          <label class="pfw-label">Projekt</label>
          <select class="pfw-input" data-action="pick-project">
            ${this.s.projects.length ? opts : '<option value="">— noch kein Projekt —</option>'}
          </select>
        </div>
        <button class="pfw-btn pfw-btn-ghost" style="flex:0 0 auto" data-action="toggle-new">＋ Neues Projekt</button>
      </div>
      ${this.s.showNew ? this.newProjectForm() : ''}`;
  }
  newProjectForm() {
    return `<div class="pfw-card" style="margin-top:10px">
      <h3>🏗️ Neues Projekt anlegen</h3>
      <div class="pfw-field"><label class="pfw-label">Titel *</label><input class="pfw-input" id="np-name" placeholder="z. B. Fernwärmezentrale" autocomplete="off"></div>
      <div class="pfw-row">
        <div class="pfw-field"><label class="pfw-label">Kunde</label><input class="pfw-input" id="np-kunde" placeholder="Auftraggeber" autocomplete="off"></div>
        <div class="pfw-field"><label class="pfw-label">Standort</label><input class="pfw-input" id="np-standort" placeholder="Ort" autocomplete="off"></div>
      </div>
      <div class="pfw-field"><label class="pfw-label">Status</label>
        <select class="pfw-input" id="np-status">${Object.entries(STATUS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      </div>
      <button class="pfw-btn pfw-btn-primary pfw-btn-block" data-action="create-project">Projekt anlegen</button>
    </div>`;
  }
  renderStatusBadge() {
    const b = this.$('#pfw-status'); if (!b) return;
    const st = this.s.current?.status || 'offen';
    b.hidden = !this.s.current;
    b.className = 'pfw-badge status-' + (STATUS[st] ? st : 'offen');
    b.textContent = STATUS[st] || st;
  }

  // ── Rendering: Tabs ──
  renderTabs() {
    const tabs = [
      { k: 'overview', l: 'Übersicht' },
      { k: 'plans', l: 'Pläne' },
      { k: 'material', l: 'Material' },
    ];
    if (this.props.canRapport) tabs.push({ k: 'rapport', l: 'Rapport' });
    const dis = !this.s.current;
    this.$('#pfw-tabs').innerHTML = `<div class="pfw-tabs">${tabs.map((t) => {
      const off = dis && t.k !== 'overview';
      return `<button class="pfw-tab${this.s.tab === t.k ? ' active' : ''}" data-action="tab" data-tab="${t.k}"${off ? ' disabled' : ''}>${t.l}</button>`;
    }).join('')}</div>`;
  }

  // ── Rendering: aktive Ansicht ──
  renderView() {
    const v = this.$('#pfw-view');
    this.sig?.destroy(); this.sig = null;
    this.voice?.destroy(); this.voice = null;
    if (!this.s.current && this.s.tab !== 'overview') this.s.tab = 'overview';
    if (this.s.tab === 'overview') v.innerHTML = this.viewOverview();
    else if (this.s.tab === 'plans') v.innerHTML = this.viewPlans();
    else if (this.s.tab === 'material') v.innerHTML = this.viewMaterial();
    else if (this.s.tab === 'rapport') { v.innerHTML = this.viewRapport(); this.initSignature(); }
    this.renderStatusBadge();
  }

  viewOverview() {
    if (!this.s.current) return `<div class="pfw-card"><div class="pfw-empty">Lege links ein Projekt an oder wähle eines aus.</div></div>`;
    const p = this.s.current;
    const chips = this.s.technicians.map((t) => {
      const on = t.user_id && this.s.assigned.has(t.user_id);
      return `<button class="pfw-chip${on ? ' on' : ''}${t.demo ? ' demo' : ''}" data-action="toggle-tech" data-uid="${esc(t.user_id || '')}" data-name="${esc(t.name)}"${t.user_id ? '' : ' title="Demo-Techniker (kein Konto verknüpft)"'}><span class="dot"></span>${esc(t.name)}</button>`;
    }).join('');
    return `
      <div class="pfw-card">
        <h3>📋 ${esc(p.name)}</h3>
        <div class="pfw-hint" style="margin-bottom:10px">${esc(p.projektnummer || '')}${p.standort ? ' · ' + esc(p.standort) : ''}${kundeFrom(p) ? ' · Kunde: ' + esc(kundeFrom(p)) : ''}</div>
        <label class="pfw-label">Status</label>
        <select class="pfw-input" data-action="set-status">${Object.entries(STATUS).map(([v, l]) => `<option value="${v}"${(p.status || 'offen') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      <div class="pfw-card">
        <h3>👷 Techniker zuweisen</h3>
        <div class="pfw-chips">${chips || '<span class="pfw-hint">Keine Techniker gefunden.</span>'}</div>
        <button class="pfw-btn pfw-btn-primary pfw-btn-block" style="margin-top:12px" data-action="save-assign">Zuweisung speichern</button>
      </div>`;
  }

  viewPlans() {
    const items = this.s.plans.map((pl) => `
      <div class="pfw-item">
        <div class="ic">${planIcon(pl.contentType, pl.name)}</div>
        <div class="meta"><div class="nm">${esc(pl.name)}</div><div class="sub">${pl.size ? fmtSize(pl.size) : ''}${pl.created_at ? ' · ' + fmtDate(pl.created_at) : ''}</div></div>
        ${pl.url ? `<a class="open" href="${esc(pl.url)}" target="_blank" rel="noopener">öffnen ↗</a>` : ''}
        <button class="pfw-btn pfw-btn-danger pfw-btn-sm" data-action="del-plan" data-path="${esc(pl.path)}">✕</button>
      </div>`).join('');
    return `
      <div class="pfw-card">
        <h3>📐 Pläne hochladen</h3>
        <p class="pfw-hint" style="margin-bottom:10px">PDF, Bilder oder Pläne – werden am Projekt gespeichert (Bucket 'plans').</p>
        <input type="file" id="pfw-plan-file" multiple accept=".pdf,image/*,.dwg,.dxf" style="display:none" data-action="plan-file">
        <button class="pfw-btn pfw-btn-primary pfw-btn-block" data-action="pick-plan">＋ Datei(en) auswählen</button>
      </div>
      <div class="pfw-card">
        <h3>Angehängte Pläne (${this.s.plans.length})</h3>
        ${this.s.plans.length ? `<div class="pfw-list">${items}</div>` : '<div class="pfw-empty">Noch keine Pläne hochgeladen.</div>'}
      </div>`;
  }

  viewMaterial() {
    const rows = this.s.material.map((p) => this.matRow(p)).join('');
    const t = Mat.totals(this.s.material);
    const assignedTechs = this.assignedTechList();
    const recipientOpts = assignedTechs.map((tt) => `<option value="${esc(tt.user_id || tt.name)}"${tt.email ? '' : ' data-noemail="1"'}>${esc(tt.name)}${tt.email ? ' · ' + esc(tt.email) : ' (keine E-Mail)'}</option>`).join('');
    return `
      <div class="pfw-card">
        <h3>🧾 Materialliste</h3>
        <div class="pfw-mat" id="pfw-mat">${rows || '<div class="pfw-empty">Noch keine Positionen.</div>'}</div>
        <div class="pfw-row" style="margin-top:10px">
          <button class="pfw-btn pfw-btn-ghost" data-action="add-mat">＋ Position</button>
          <button class="pfw-btn pfw-btn-ghost" data-action="export-mat"${this.s.material.length ? '' : ' disabled'}>⭳ CSV-Export</button>
        </div>
      </div>
      <div class="pfw-card" id="pfw-sums-card">
        ${this.sumsHtml(t)}
      </div>
      ${this.props.canOrder ? `
      <div class="pfw-card">
        <h3>📦 Material bestellen → an Techniker</h3>
        <div class="pfw-field"><label class="pfw-label">Empfänger (zugewiesener Techniker)</label>
          <select class="pfw-input" id="pfw-order-to">${recipientOpts || '<option value="">— erst Techniker zuweisen —</option>'}</select>
        </div>
        <div class="pfw-field"><label class="pfw-label">Alternative E-Mail (optional)</label>
          <div class="pfw-row" style="align-items:center">
            <input class="pfw-input" id="pfw-order-email" placeholder="techniker@..." autocomplete="off" style="flex:1">
            <button class="pfw-mic" data-action="mic" data-target="pfw-order-note" title="Notiz diktieren">🎙️</button>
          </div>
        </div>
        <div class="pfw-field"><label class="pfw-label">Notiz</label><textarea class="pfw-textarea" id="pfw-order-note" placeholder="z. B. dringend, Lieferung Baustelle"></textarea></div>
        <button class="pfw-btn pfw-btn-primary pfw-btn-block" data-action="order-mat"${this.s.material.length ? '' : ' disabled'}>Bestellung senden</button>
        <p class="pfw-hint" style="margin-top:8px">Versand über George Solutions (info@george-solutions.ch) inkl. Materiallisten-PDF.</p>
      </div>` : ''}`;
  }
  matRow(p) {
    return `<div class="pfw-mat-row" data-id="${esc(p.id)}">
      <div class="top">
        <input class="pfw-input" data-mat="bezeichnung" data-id="${esc(p.id)}" value="${esc(p.bezeichnung)}" placeholder="Bezeichnung" autocomplete="off">
        <button class="pfw-mic" data-action="mic" data-mat-id="${esc(p.id)}" title="Bezeichnung diktieren">🎙️</button>
        <button class="pfw-btn pfw-btn-danger pfw-btn-sm" data-action="del-mat" data-id="${esc(p.id)}">✕</button>
      </div>
      <div class="grid">
        <div><label class="pfw-label">Menge</label><input class="pfw-input" data-mat="menge" data-id="${esc(p.id)}" value="${esc(p.menge)}" inputmode="decimal"></div>
        <div><label class="pfw-label">Einheit</label>
          <select class="pfw-input" data-mat="einheit" data-id="${esc(p.id)}">${Mat.EINHEITEN.map((u) => `<option${u === p.einheit ? ' selected' : ''}>${u}</option>`).join('')}</select>
        </div>
        <div><label class="pfw-label">Preis CHF</label><input class="pfw-input" data-mat="einzelpreis" data-id="${esc(p.id)}" value="${esc(p.einzelpreis)}" inputmode="decimal"></div>
        <div><label class="pfw-label">Rabatt %</label><input class="pfw-input" data-mat="rabatt" data-id="${esc(p.id)}" value="${esc(p.rabatt)}" inputmode="decimal"></div>
      </div>
      <div class="pfw-line-net" data-net="${esc(p.id)}">Netto: <b>CHF ${Mat.chf(Mat.lineNetto(p))}</b></div>
    </div>`;
  }
  sumsHtml(t) {
    return `<div class="pfw-sums">
      <div class="s"><div class="v">CHF ${Mat.chf(t.brutto)}</div><div class="l">Brutto</div></div>
      <div class="s"><div class="v">− ${Mat.chf(t.rabatt)}</div><div class="l">Rabatt ${Mat.fmtMenge(t.rabattPct)}%</div></div>
      <div class="s net"><div class="v">CHF ${Mat.chf(t.netto)}</div><div class="l">Netto</div></div>
    </div>`;
  }

  viewRapport() {
    const today = new Date().toISOString().slice(0, 10);
    const techOpts = this.assignedTechList().map((t) => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('');
    const doneRows = this.s.rapporte.slice(0, 5).map((r) => `
      <div class="pfw-item">
        <div class="ic">📋</div>
        <div class="meta"><div class="nm">${esc(r.datum)} · ${esc(r.gesamtstunden ?? '–')} h</div><div class="sub">${esc(r.status || '')}${r.techniker_name ? ' · ' + esc(r.techniker_name) : ''}</div></div>
        ${r.pdf_url ? `<button class="pfw-btn pfw-btn-ghost pfw-btn-sm" data-action="open-rapport-pdf" data-id="${esc(r.id)}">PDF</button>` : ''}
      </div>`).join('');
    return `
      <div class="pfw-card">
        <h3>✍️ Rapport erstellen</h3>
        <div class="pfw-row">
          <div class="pfw-field"><label class="pfw-label">Datum</label><input class="pfw-input" id="rp-datum" type="date" value="${today}"></div>
          <div class="pfw-field"><label class="pfw-label">Techniker</label><select class="pfw-input" id="rp-tech">${techOpts || '<option value="">— zuweisen —</option>'}</select></div>
        </div>
        <div class="pfw-field"><label class="pfw-label">Leistungen</label>
          <div class="pfw-row" style="align-items:flex-start">
            <textarea class="pfw-textarea" id="rp-leistungen" placeholder="Eine Leistung pro Zeile" style="flex:1"></textarea>
            <button class="pfw-mic" data-action="mic" data-target="rp-leistungen" data-append="1" title="Leistung diktieren">🎙️</button>
          </div>
        </div>
        <div class="pfw-row">
          <div class="pfw-field"><label class="pfw-label">Stunden</label><input class="pfw-input" id="rp-stunden" inputmode="decimal" placeholder="0" value="0"></div>
          <div class="pfw-field"><label class="pfw-label">Besonderheiten</label><input class="pfw-input" id="rp-notiz" placeholder="optional" autocomplete="off"></div>
        </div>
        <label class="pfw-label">Unterschrift</label>
        <div class="pfw-sig-wrap">
          <canvas id="pfw-sig" class="pfw-sig"></canvas>
          <span class="pfw-sig-hint" id="pfw-sig-hint">Hier unterschreiben</span>
        </div>
        <div class="pfw-row" style="margin-top:10px">
          <button class="pfw-btn pfw-btn-ghost" style="flex:0 0 auto" data-action="clear-sig">Löschen</button>
          <button class="pfw-btn pfw-btn-primary" style="flex:1" data-action="save-rapport">Speichern &amp; PDF erstellen</button>
        </div>
        ${this.s.lastPdf ? `<a class="pfw-btn pfw-btn-blue pfw-btn-block" style="margin-top:10px" href="${esc(this.s.lastPdf)}" target="_blank" rel="noopener">📄 Rapport-PDF öffnen</a>` : ''}
      </div>
      <div class="pfw-card">
        <h3>Letzte Rapporte (${this.s.rapporte.length})</h3>
        ${this.s.rapporte.length ? `<div class="pfw-list">${doneRows}</div>` : '<div class="pfw-empty">Noch keine Rapporte.</div>'}
      </div>`;
  }

  initSignature() {
    const c = this.$('#pfw-sig'); if (!c) return;
    this.sig = createSignaturePad(c);
    const hint = this.$('#pfw-sig-hint');
    const hide = () => { if (hint) hint.style.display = 'none'; };
    c.addEventListener('pointerdown', hide, { once: true });
    c.addEventListener('touchstart', hide, { once: true });
  }

  // ── Events ──
  onClick(e) {
    const t = e.target.closest('[data-action]'); if (!t) return;
    const a = t.dataset.action;
    const map = {
      'toggle-new': () => { this.s.showNew = !this.s.showNew; this.renderProjectBar(); },
      'create-project': () => this.createProject(),
      'toggle-tech': () => this.toggleTech(t),
      'save-assign': () => this.saveAssign(),
      'tab': () => { if (t.disabled) return; this.s.tab = t.dataset.tab; this.renderTabs(); this.renderView(); },
      'pick-plan': () => this.$('#pfw-plan-file')?.click(),
      'del-plan': () => this.deletePlan(t.dataset.path),
      'add-mat': () => this.addMat(),
      'del-mat': () => this.delMat(t.dataset.id),
      'export-mat': () => this.exportMat(),
      'order-mat': () => this.orderMat(),
      'mic': () => this.toggleMic(t),
      'clear-sig': () => { this.sig?.clear(); const h = this.$('#pfw-sig-hint'); if (h) h.style.display = ''; },
      'save-rapport': () => this.saveRapport(),
      'open-rapport-pdf': () => this.openRapportPdf(t.dataset.id),
    };
    if (map[a]) { e.preventDefault(); map[a](); }
  }
  onChange(e) {
    const t = e.target;
    if (t.dataset.action === 'pick-project' && t.value) this.openProject(t.value);
    else if (t.dataset.action === 'set-status') this.setStatus(t.value);
    else if (t.dataset.action === 'plan-file') this.uploadPlans(t.files);
    else if (t.dataset.mat) this.updateMat(t.dataset.id, t.dataset.mat, t.value, true);
  }
  onInput(e) {
    const t = e.target;
    if (t.dataset.mat) this.updateMat(t.dataset.id, t.dataset.mat, t.value, false);
  }

  // ── Aktionen: Projekt ──
  async createProject() {
    const name = this.$('#np-name')?.value.trim();
    if (!name) { this.toast('Titel erforderlich', 'err'); return; }
    const kunde = this.$('#np-kunde')?.value.trim();
    const standort = this.$('#np-standort')?.value.trim();
    const status = this.$('#np-status')?.value || 'offen';
    this.setBusy(true);
    try {
      const { projekt } = await this.api.createProject({ name, standort: standort || null });
      // Kunde + Status best-effort nachtragen (notiz-Spalte fällt serverseitig sauber zurück).
      const patch = { id: projekt.id, status };
      if (kunde) patch.notiz = 'Kunde: ' + kunde;
      try { await this.api.updateProject(patch); } catch {}
      this.s.showNew = false;
      await this.reloadProjects(projekt.id);
      this.toast('Projekt angelegt ✓', 'ok');
    } catch (e) { this.toast(e.message || 'Anlegen fehlgeschlagen', 'err'); }
    finally { this.setBusy(false); }
  }
  async reloadProjects(selectId) {
    try { const { projekte } = await this.api.listProjects(); this.s.projects = projekte || []; } catch {}
    this.renderProjectBar(); this.renderTabs();
    if (selectId) await this.openProject(selectId); else this.renderView();
  }
  async setStatus(status) {
    if (!this.s.current) return;
    try {
      await this.api.updateProject({ id: this.s.current.id, status });
      this.s.current.status = status; this.renderStatusBadge();
      this.toast('Status: ' + (STATUS[status] || status), 'ok');
    } catch (e) { this.toast(e.message || 'Status nicht gespeichert', 'err'); }
  }
  toggleTech(btn) {
    const uid = btn.dataset.uid;
    if (!uid) { this.toast('Demo-Techniker ohne Konto – nicht zuweisbar, aber als Empfänger nutzbar.', 'err'); return; }
    if (this.s.assigned.has(uid)) this.s.assigned.delete(uid); else this.s.assigned.add(uid);
    btn.classList.toggle('on');
  }
  async saveAssign() {
    if (!this.s.current) return;
    this.setBusy(true);
    try {
      await this.api.assignTechnicians(this.s.current.id, [...this.s.assigned]);
      await this.openProject(this.s.current.id, true);
      this.toast('Zuweisung gespeichert ✓', 'ok');
    } catch (e) { this.toast(e.message || 'Zuweisung fehlgeschlagen', 'err'); }
    finally { this.setBusy(false); }
  }

  // ── Aktionen: Pläne ──
  async uploadPlans(files) {
    if (!this.s.current || !files || !files.length) return;
    this.setBusy(true);
    let ok = 0;
    try {
      for (const f of files) {
        try {
          const data = await fileToDataURL(f);
          await this.api.uploadPlan(this.s.current.id, f.name, data, f.type || undefined);
          ok++;
        } catch (e) { this.toast(`"${f.name}": ${e.message}`, 'err'); }
      }
      await this.loadPlans();
      this.renderView();
      if (ok) this.toast(`${ok} Plan${ok > 1 ? '/Pläne' : ''} hochgeladen ✓`, 'ok');
    } finally { this.setBusy(false); const inp = this.$('#pfw-plan-file'); if (inp) inp.value = ''; }
  }
  async deletePlan(path) {
    if (!this.s.current || !path) return;
    try { await this.api.deletePlan(this.s.current.id, path); await this.loadPlans(); this.renderView(); this.toast('Plan gelöscht', 'ok'); }
    catch (e) { this.toast(e.message || 'Löschen fehlgeschlagen', 'err'); }
  }

  // ── Aktionen: Material ──
  addMat() { this.s.material.push(Mat.newPosition()); this.renderView(); }
  delMat(id) { this.s.material = this.s.material.filter((p) => p.id !== id); this.renderView(); }
  updateMat(id, field, value, refreshRow) {
    const p = this.s.material.find((x) => x.id === id); if (!p) return;
    p[field] = value;
    // Live-Update Netto + Summen, ohne Neuaufbau (Fokus bleibt).
    const net = this.root.querySelector(`[data-net="${cssEsc(id)}"]`);
    if (net) net.innerHTML = `Netto: <b>CHF ${Mat.chf(Mat.lineNetto(p))}</b>`;
    const sc = this.$('#pfw-sums-card');
    if (sc) sc.innerHTML = this.sumsHtml(Mat.totals(this.s.material));
  }
  exportMat() {
    const csv = Mat.toCsv(this.s.material);
    const name = `Materialliste-${(this.s.current?.name || 'Projekt').replace(/[^\w.\-]+/g, '_')}.csv`;
    downloadText(name, csv);
    this.toast('CSV exportiert', 'ok');
  }
  async orderMat() {
    if (!this.s.current) return;
    const positionen = this.s.material.filter((p) => (p.bezeichnung || '').trim());
    if (!positionen.length) { this.toast('Keine Positionen', 'err'); return; }
    const manual = this.$('#pfw-order-email')?.value.trim();
    let email = manual;
    let tel = '';
    if (!email) {
      const sel = this.$('#pfw-order-to');
      const val = sel?.value;
      const tech = this.assignedTechList().find((t) => (t.user_id || t.name) === val);
      email = tech?.email || '';
      tel = tech?.telefon || '';
    }
    const note = this.$('#pfw-order-note')?.value || '';
    this.setBusy(true);
    try {
      const res = await this.api.orderMaterial({
        projekt_id: this.s.current.id,
        projekt_name: this.s.current.name,
        empfaenger_email: email || undefined,
        empfaenger_tel: tel || undefined,
        inhalt: {
          positionen: Mat.toEmailPositionen(positionen),
          notiz: Mat.pricingNote(positionen, note),
          von_name: this.props.currentUser?.name || this.props.currentUser?.email || 'George Solutions',
          projekt_name: this.s.current.name,
          projektnummer: this.s.current.projektnummer || '',
        },
      });
      if (res.mail_sent) this.toast(email ? 'Bestellung an Techniker gesendet ✓' : 'Bestellung ans GS-Büro gesendet (kein Empfänger) ✓', 'ok');
      else this.toast('Bestellung verarbeitet ✓', 'ok');
    } catch (e) { this.toast(e.message || 'Versand fehlgeschlagen', 'err'); }
    finally { this.setBusy(false); }
  }

  // ── Aktionen: Rapport ──
  async saveRapport() {
    if (!this.s.current) return;
    const datum = this.$('#rp-datum')?.value;
    if (!datum) { this.toast('Datum erforderlich', 'err'); return; }
    const stunden = parseFloat((this.$('#rp-stunden')?.value || '').replace(',', '.')) || 0;
    if (!(stunden > 0)) { this.toast('Stunden erforderlich (> 0)', 'err'); return; }
    const arbeiten = (this.$('#rp-leistungen')?.value || '').split('\n').map((x) => x.trim()).filter(Boolean);
    const techName = this.$('#rp-tech')?.value || '';
    const besonderheiten = this.$('#rp-notiz')?.value || '';
    const unterschrift = this.sig?.toDataURL();
    if (!unterschrift) { this.toast('Bitte unterschreiben', 'err'); return; }

    this.setBusy(true);
    try {
      const { rapport } = await this.api.saveRapport({
        projekt_id: this.s.current.id, datum,
        gesamtstunden: stunden, arbeiten,
        team: techName ? [techName] : [],
        besonderheiten, unterschrift, status: 'eingereicht',
      });
      // Signierte PDF-URL holen (buildRapportPdf wurde serverseitig erstellt).
      let pdf = null;
      try { const g = await this.api.getRapport(rapport.id); pdf = g.rapport?.pdf_signed || null; } catch {}
      this.s.lastPdf = pdf;
      await this.loadRapporte();
      this.renderView();
      this.toast(pdf ? 'Rapport gespeichert – PDF bereit ✓' : 'Rapport gespeichert ✓', 'ok');
    } catch (e) { this.toast(e.message || 'Rapport konnte nicht gespeichert werden', 'err'); }
    finally { this.setBusy(false); }
  }
  async openRapportPdf(id) {
    try {
      const g = await this.api.getRapport(id);
      const url = g.rapport?.pdf_signed;
      if (url) window.open(url, '_blank', 'noopener'); else this.toast('Kein PDF vorhanden', 'err');
    } catch (e) { this.toast(e.message || 'PDF konnte nicht geladen werden', 'err'); }
  }

  // ── Sprachmemo ──
  toggleMic(btn) {
    // Ein aktiver Recorder zurzeit; erneuter Klick stoppt.
    if (this.voice && this.voice.recording) { this.voice.stop(); return; }
    this.voice?.destroy();
    const target = btn.dataset.target;
    const matId = btn.dataset.matId;
    const append = btn.dataset.append === '1';
    this.voice = createVoiceMemo({
      stt: (audio, mime) => this.api.stt(audio, mime),
      onStart: () => { btn.classList.add('rec'); btn.textContent = '⏹'; this.toast('Aufnahme … erneut tippen zum Stoppen', 'ok'); },
      onState: (rec) => { if (!rec) { btn.classList.remove('rec'); btn.textContent = '🎙️'; } },
      onError: (m) => { btn.classList.remove('rec'); btn.textContent = '🎙️'; this.toast(m, 'err'); },
      onText: (text) => {
        if (matId) {
          const p = this.s.material.find((x) => x.id === matId);
          if (p) { p.bezeichnung = (p.bezeichnung ? p.bezeichnung + ' ' : '') + text; const inp = this.root.querySelector(`input[data-mat="bezeichnung"][data-id="${cssEsc(matId)}"]`); if (inp) inp.value = p.bezeichnung; }
        } else if (target) {
          const inp = this.$('#' + target);
          if (inp) inp.value = append && inp.value ? inp.value + '\n' + text : (inp.value ? inp.value + ' ' + text : text);
        }
        this.toast('Erkannt ✓', 'ok');
      },
    });
    if (!this.voice.supported) { this.toast('Sprachaufnahme nicht unterstützt', 'err'); return; }
    this.voice.start();
  }

  // ── Helpers ──
  assignedTechList() {
    // Techniker-Objekte der aktuell zugewiesenen + (Demo) evtl. gewählte.
    const byId = new Map(this.s.technicians.map((t) => [t.user_id, t]));
    const list = [...this.s.assigned].map((id) => byId.get(id)).filter(Boolean);
    return list.length ? list : this.s.technicians.filter((t) => t.user_id);
  }
  setBusy(v) { this.s.busy = v; /* dezent: Cursor */ if (this.root) this.root.style.cursor = v ? 'progress' : ''; }
  toast(msg, kind) {
    const el = this.$('#pfw-toast'); if (!el) return;
    el.textContent = msg;
    el.className = 'pfw-toast show ' + (kind || '');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => { el.className = 'pfw-toast ' + (kind || ''); }, 3200);
  }
  $(sel) { return this.root ? this.root.querySelector(sel) : null; }
}

// ── modul-lokale Utils ──
function mergeDemoTechs(techs) {
  const out = [...techs];
  for (const name of DEMO_TECHS) {
    if (!out.some((t) => (t.name || '').toLowerCase() === name.toLowerCase())) out.push({ user_id: null, name, email: null, telefon: null, demo: true });
  }
  return out;
}
function kundeFrom(p) { const m = /Kunde:\s*(.+)/.exec(p?.notiz || ''); return m ? m[1].trim() : ''; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }
function fileToDataURL(f) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); }); }
function downloadText(name, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
}
function planIcon(ct, name) {
  const s = (ct || '') + ' ' + (name || '');
  if (/pdf/i.test(s)) return '📄';
  if (/image|png|jpe?g|webp/i.test(s)) return '🖼️';
  if (/dwg|dxf/i.test(s)) return '📐';
  return '📎';
}
function fmtSize(b) { b = Number(b) || 0; return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
function fmtDate(s) { try { return new Date(s).toLocaleDateString('de-CH'); } catch { return ''; } }
