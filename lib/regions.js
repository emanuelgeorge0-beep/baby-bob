// lib/regions.js — central region/i18n config (browser global, loaded via <script src>).
// 5 markets: CH | AT | DE | ES | GB. Swiss branding stays; output adapts to country.
(function () {
  var REGIONS = {
    CH: { code: 'CH', flag: '🇨🇭', name: 'Schweiz',        locale: 'de-CH', currency: 'CHF', currencySymbol: 'CHF', currencyPosition: 'before-space', language: 'de', plzLabel: 'PLZ',            plzRegex: /^\d{4}$/,                               phonePrefix: '+41' },
    AT: { code: 'AT', flag: '🇦🇹', name: 'Österreich',     locale: 'de-AT', currency: 'EUR', currencySymbol: '€',   currencyPosition: 'before-space', language: 'de', plzLabel: 'PLZ',            plzRegex: /^\d{4}$/,                               phonePrefix: '+43' },
    DE: { code: 'DE', flag: '🇩🇪', name: 'Deutschland',    locale: 'de-DE', currency: 'EUR', currencySymbol: '€',   currencyPosition: 'before-space', language: 'de', plzLabel: 'PLZ',            plzRegex: /^\d{5}$/,                               phonePrefix: '+49' },
    ES: { code: 'ES', flag: '🇪🇸', name: 'España',         locale: 'es-ES', currency: 'EUR', currencySymbol: '€',   currencyPosition: 'after-space',  language: 'es', plzLabel: 'Código Postal',  plzRegex: /^\d{5}$/,                               phonePrefix: '+34' },
    GB: { code: 'GB', flag: '🇬🇧', name: 'United Kingdom', locale: 'en-GB', currency: 'GBP', currencySymbol: '£',   currencyPosition: 'before',       language: 'en', plzLabel: 'Postcode',       plzRegex: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i,   phonePrefix: '+44' },
  };
  var ORDER = ['CH', 'AT', 'DE', 'ES', 'GB'];

  // Same number everywhere; only symbol + position change.
  function formatPrice(amount, region) {
    var r = (typeof region === 'string' ? REGIONS[region] : region) || REGIONS.CH;
    var n = String(amount);
    if (r.currencyPosition === 'after-space') return n + ' ' + r.currencySymbol; // 49 €
    if (r.currencyPosition === 'before') return r.currencySymbol + n;            // £49
    return r.currencySymbol + ' ' + n;                                           // CHF 49 / € 49
  }

  // First-visit detection: navigator.language → timezone fallback → CH. (Saved choice wins, handled by caller.)
  function detectRegion() {
    var lang = (navigator.language || navigator.userLanguage || '').toLowerCase();
    if (lang.indexOf('de-ch') === 0) return 'CH';
    if (lang.indexOf('de-at') === 0) return 'AT';
    if (lang.indexOf('de-de') === 0) return 'DE';
    if (lang.indexOf('es') === 0) return 'ES';
    if (lang.indexOf('en-gb') === 0 || lang.indexOf('en') === 0) return 'GB';
    try {
      var tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '');
      if (/Vienna/i.test(tz)) return 'AT';
      if (/Madrid/i.test(tz)) return 'ES';
      if (/London/i.test(tz)) return 'GB';
      if (/Zurich/i.test(tz)) return 'CH';
      if (/Berlin/i.test(tz)) return 'DE';
    } catch (e) {}
    if (lang.indexOf('de') === 0) return 'CH'; // generic German → CH (Swiss brand)
    return 'CH';
  }

  // ── i18n (DE/ES/EN) — key B2C strings. Internal GS/admin stay German. ──
  var STR = {
    de: {
      hero_title: 'Dein smarter', hero_sub2: 'Allround-Finder',
      hero_p: 'Foto machen oder Problem beschreiben – BOB findet dir den richtigen Fachmann in deiner Nähe mit dem besten Preis-Leistungs-Verhältnis.',
      scan_btn: 'Problem scannen', mic_btn: 'Mit BOB sprechen', premium_btn: 'BOB Premium & Reports',
      sound_on: '🔊 Ton aktivieren', greeting: 'Hey, mein Name ist Bob! Ich helfe dir bei jedem Problem – egal ob Handwerk oder Beauty. Wie kann ich dir helfen?',
      intro: 'Guten Tag. Ich bin BOB, Ihr digitaler Fachassistent.',
      premium_title: 'BOB Premium', reports_grp: 'Detail-Reports (einmalig)', abos_grp: 'Abos',
      free: 'Free', pro: 'Pro', mute: 'Vorlesen stummschalten', unmute: 'Vorlesen aktivieren',
      region_label: 'Region wählen', pay_secure: 'Sichere Zahlung via Stripe · Testmodus',
      disclaimer: 'Demo-Version zum Testen. Wähle dein Land 🇨🇭🇦🇹🇩🇪🇪🇸🇬🇧 oben – Sprache, Währung und Region passen sich an. Die finale App erscheint nächstes Jahr.',
      disclaimer_ok: 'Verstanden',
      // Landing
      gs_badge:'SHK-Profi-Team', gs_title:'Profi-Team auf Abruf',
      gs_sub:'Heizung, Sanitär, Lüftung & Klima – buchen Sie ein voll ausgestattetes SHK-Profi-Team mit fairen Stundensätzen und 24h-Antwort.',
      gs_cta:'SHK-Dienstleistung buchen →',
      bob_badge:'KI-Scanner', bob_title:'Problem scannen & Fachmann finden',
      bob_sub:'Foto machen oder Problem beschreiben – die KI erkennt sofort, welcher Handwerker oder Dienstleister zu dir passt.',
      bob_cta:'Jetzt scannen →', landing_or:'oder',
      landing_foot:'George Solutions · Schweizer SHK-Dienstleistung & KI-Fachmann-Finder',
      // Home
      cat_handwerk:'Handwerk', cat_handwerk_sub:'Sanitär · Elektro · Garten · Reinigung · uvm.',
      cat_beauty:'Beauty', cat_beauty_sub:'Friseur · Nägel · Massage · Barber · uvm.',
      nav_home:'Home', nav_scan:'Scannen', nav_about:'Über BOB',
      // Scan
      scan_title:'Problem scannen', scan_voice:'Sprachmemo aufnehmen',
      scan_ph:"Oder Problem tippen... z.B. 'Wasserhahn tropft' oder 'Haare schneiden'",
      ask_btn:'BOB fragen',
      // Result
      res_title:'BOBs Diagnose', res_lbl:'Diagnose abgeschlossen',
      meta_kat:'Kategorie', meta_dring:'Dringlichkeit', meta_kost:'Kosten ca.', meta_zeit:'Zeitraum',
      tips_title:'BOBs Tipps', act_title:'Was möchtest du als nächstes?',
      act_find_a:'Handwerker finden', act_find_a_sub:'BOB sucht den richtigen Fachmann für dich',
      act_find_b:'Fachmann / Anbieter finden', act_find_b_sub:'BOB findet den passenden Anbieter in deiner Nähe',
      price_free:'Gratis', price_on_order:'bei Auftragserteilung', price_once:'einmalig',
      act_angebot:'Professionelles Angebot', act_angebot_sub:'Verbindliches Angebot vom Fachmann in 24h',
      act_finder:'Anbieter in deiner Nähe finden', act_finder_sub:'Wir schicken dir die nächsten passenden Anbieter (z.B. Barbershops, Nagelstudios) per E-Mail.',
      act_pro:'BOBs Profi-Rat', act_pro_sub:'Detaillierte Experteneinschätzung', act_pro_basic:'basic',
      new_scan:'🔄 Neuen Scan starten', chat_title:'💬 Noch Fragen? Frag BOB!', chat_ph:'Frag BOB etwas…',
      fb_q:'War diese Antwort hilfreich?', fb_yes:'Ja', fb_no:'Nein', fb_correct:'Korrigieren',
      maps_title:'Fachmann in deiner Nähe', maps_sub:'Google Maps Integration kommt bald',
      richt_prefix:'💡 In deiner Region', richt_mid:'kostet das üblicherweise', richt_var:'je nach Anbieter unterschiedlich',
    },
    es: {
      hero_title: 'Tu buscador', hero_sub2: 'todoterreno',
      hero_p: 'Haz una foto o describe tu problema – BOB te encuentra al profesional adecuado cerca de ti con la mejor relación calidad-precio.',
      scan_btn: 'Escanear problema', mic_btn: 'Hablar con BOB', premium_btn: 'BOB Premium e Informes',
      sound_on: '🔊 Activar sonido', greeting: '¡Hola, me llamo Bob! Te ayudo con cualquier problema, ya sea de oficios o belleza. ¿En qué puedo ayudarte?',
      intro: 'Buenos días. Soy BOB, su asistente técnico digital.',
      premium_title: 'BOB Premium', reports_grp: 'Informes detallados (único pago)', abos_grp: 'Suscripciones',
      free: 'Free', pro: 'Pro', mute: 'Silenciar lectura', unmute: 'Activar lectura',
      region_label: 'Elegir región', pay_secure: 'Pago seguro con Stripe · Modo de prueba',
      disclaimer: 'Versión de demostración para pruebas. Elige tu país 🇨🇭🇦🇹🇩🇪🇪🇸🇬🇧 arriba – el idioma, la moneda y la región se adaptan. La app final llegará el próximo año.',
      disclaimer_ok: 'Entendido',
      // Landing
      gs_badge:'Equipo SHK Pro', gs_title:'Equipo profesional a demanda',
      gs_sub:'Calefacción, fontanería, ventilación y climatización – reserve un equipo profesional SHK totalmente equipado, con tarifas justas y respuesta en 24h.',
      gs_cta:'Reservar servicio SHK →',
      bob_badge:'Escáner IA', bob_title:'Escanea tu problema y encuentra al profesional',
      bob_sub:'Haz una foto o describe tu problema – la IA reconoce al instante qué profesional o proveedor te conviene.',
      bob_cta:'Escanear ahora →', landing_or:'o',
      landing_foot:'George Solutions · Servicio SHK suizo y buscador de profesionales con IA',
      // Home
      cat_handwerk:'Oficios', cat_handwerk_sub:'Fontanería · Electricidad · Jardín · Limpieza · y más',
      cat_beauty:'Belleza', cat_beauty_sub:'Peluquería · Uñas · Masaje · Barbería · y más',
      nav_home:'Inicio', nav_scan:'Escanear', nav_about:'Sobre BOB',
      // Scan
      scan_title:'Escanear problema', scan_voice:'Grabar nota de voz',
      scan_ph:"O escribe tu problema... p. ej. 'gotea el grifo' o 'cortar el pelo'",
      ask_btn:'Preguntar a BOB',
      // Result
      res_title:'Diagnóstico de BOB', res_lbl:'Diagnóstico completado',
      meta_kat:'Categoría', meta_dring:'Urgencia', meta_kost:'Coste aprox.', meta_zeit:'Plazo',
      tips_title:'Consejos de BOB', act_title:'¿Qué quieres hacer ahora?',
      act_find_a:'Encontrar profesional', act_find_a_sub:'BOB busca al profesional adecuado para ti',
      act_find_b:'Encontrar proveedor', act_find_b_sub:'BOB encuentra el proveedor adecuado cerca de ti',
      price_free:'Gratis', price_on_order:'al contratar', price_once:'pago único',
      act_angebot:'Presupuesto profesional', act_angebot_sub:'Presupuesto vinculante del profesional en 24h',
      act_finder:'Encontrar proveedores cerca de ti', act_finder_sub:'Te enviamos por correo los proveedores adecuados más cercanos (p. ej. barberías, salones de uñas).',
      act_pro:'Consejo Pro de BOB', act_pro_sub:'Evaluación experta detallada', act_pro_basic:'básico',
      new_scan:'🔄 Nuevo escaneo', chat_title:'💬 ¿Más preguntas? ¡Pregunta a BOB!', chat_ph:'Pregunta algo a BOB…',
      fb_q:'¿Te ha sido útil esta respuesta?', fb_yes:'Sí', fb_no:'No', fb_correct:'Corregir',
      maps_title:'Profesional cerca de ti', maps_sub:'Integración con Google Maps muy pronto',
      richt_prefix:'💡 En tu región', richt_mid:'esto suele costar', richt_var:'varía según el proveedor',
    },
    en: {
      hero_title: 'Your smart', hero_sub2: 'all-round finder',
      hero_p: 'Take a photo or describe your problem – BOB finds you the right professional nearby with the best value for money.',
      scan_btn: 'Scan problem', mic_btn: 'Talk to BOB', premium_btn: 'BOB Premium & Reports',
      sound_on: '🔊 Enable sound', greeting: "Hey, my name is Bob! I help you with any problem – trades or beauty. How can I help you?",
      intro: 'Good day. I am BOB, your digital expert assistant.',
      premium_title: 'BOB Premium', reports_grp: 'Detailed reports (one-time)', abos_grp: 'Subscriptions',
      free: 'Free', pro: 'Pro', mute: 'Mute read-aloud', unmute: 'Enable read-aloud',
      region_label: 'Choose region', pay_secure: 'Secure payment via Stripe · Test mode',
      disclaimer: 'Demo version for testing. Choose your country 🇨🇭🇦🇹🇩🇪🇪🇸🇬🇧 above – language, currency and region adapt. The final app launches next year.',
      disclaimer_ok: 'Got it',
      // Landing
      gs_badge:'SHK Pro Team', gs_title:'Pro team on demand',
      gs_sub:'Heating, plumbing, ventilation & air conditioning – book a fully equipped SHK pro team with fair hourly rates and a 24h response.',
      gs_cta:'Book SHK service →',
      bob_badge:'AI Scanner', bob_title:'Scan your problem & find a professional',
      bob_sub:'Take a photo or describe your problem – the AI instantly recognises which tradesperson or provider fits you.',
      bob_cta:'Scan now →', landing_or:'or',
      landing_foot:'George Solutions · Swiss SHK service & AI professional finder',
      // Home
      cat_handwerk:'Trades', cat_handwerk_sub:'Plumbing · Electrical · Garden · Cleaning · & more',
      cat_beauty:'Beauty', cat_beauty_sub:'Hairdresser · Nails · Massage · Barber · & more',
      nav_home:'Home', nav_scan:'Scan', nav_about:'About BOB',
      // Scan
      scan_title:'Scan problem', scan_voice:'Record voice memo',
      scan_ph:"Or type your problem... e.g. 'tap is dripping' or 'haircut'",
      ask_btn:'Ask BOB',
      // Result
      res_title:"BOB's diagnosis", res_lbl:'Diagnosis complete',
      meta_kat:'Category', meta_dring:'Urgency', meta_kost:'Cost approx.', meta_zeit:'Timeframe',
      tips_title:"BOB's tips", act_title:'What would you like to do next?',
      act_find_a:'Find a tradesperson', act_find_a_sub:'BOB finds the right professional for you',
      act_find_b:'Find a provider', act_find_b_sub:'BOB finds the right provider near you',
      price_free:'Free', price_on_order:'on booking', price_once:'one-time',
      act_angebot:'Professional quote', act_angebot_sub:'Binding quote from the professional within 24h',
      act_finder:'Find providers near you', act_finder_sub:'We email you the nearest matching providers (e.g. barbershops, nail salons).',
      act_pro:"BOB's Pro advice", act_pro_sub:'Detailed expert assessment', act_pro_basic:'basic',
      new_scan:'🔄 Start a new scan', chat_title:'💬 More questions? Ask BOB!', chat_ph:'Ask BOB something…',
      fb_q:'Was this answer helpful?', fb_yes:'Yes', fb_no:'No', fb_correct:'Correct',
      maps_title:'Professional near you', maps_sub:'Google Maps integration coming soon',
      richt_prefix:'💡 In your region', richt_mid:'this usually costs', richt_var:'varies by provider',
    },
  };
  function t(key, lang) { var L = STR[lang] || STR.de; return (key in L) ? L[key] : (STR.de[key] || key); }

  window.BB_REGIONS = REGIONS;
  window.BB_REGION_ORDER = ORDER;
  window.bbFormatPrice = formatPrice;
  window.bbDetectRegion = detectRegion;
  window.bbT = t;
})();
