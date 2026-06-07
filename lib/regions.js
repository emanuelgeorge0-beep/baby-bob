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
    },
  };
  function t(key, lang) { var L = STR[lang] || STR.de; return (key in L) ? L[key] : (STR.de[key] || key); }

  window.BB_REGIONS = REGIONS;
  window.BB_REGION_ORDER = ORDER;
  window.bbFormatPrice = formatPrice;
  window.bbDetectRegion = detectRegion;
  window.bbT = t;
})();
