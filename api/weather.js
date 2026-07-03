// api/weather.js — aktuelles Wetter für Zürich, Wien, Barcelona.
// Quelle: open-meteo.com — KOSTENLOS, KEIN API-Key nötig. Ein Batch-Request für
// alle drei Städte. Antwort wird kurz gecacht (warme Lambda-Instanz), Fehler sind
// unkritisch (liefert dann leere Liste, das Cockpit zeigt das Wetter einfach nicht).

const CITIES = [
  { name: 'Zürich',    lat: 47.3769, lon: 8.5417 },
  { name: 'Wien',      lat: 48.2082, lon: 16.3738 },
  { name: 'Barcelona', lat: 41.3874, lon: 2.1686 },
];

// WMO-Wettercode → kurzer deutscher Zustand + Emoji.
function codeInfo(code) {
  const c = Number(code);
  if (c === 0) return { text: 'klar', emoji: '☀️' };
  if (c === 1) return { text: 'überwiegend klar', emoji: '🌤️' };
  if (c === 2) return { text: 'teils bewölkt', emoji: '⛅' };
  if (c === 3) return { text: 'bedeckt', emoji: '☁️' };
  if (c === 45 || c === 48) return { text: 'neblig', emoji: '🌫️' };
  if (c >= 51 && c <= 57) return { text: 'Nieselregen', emoji: '🌦️' };
  if (c >= 61 && c <= 67) return { text: 'Regen', emoji: '🌧️' };
  if (c >= 71 && c <= 77) return { text: 'Schnee', emoji: '🌨️' };
  if (c >= 80 && c <= 82) return { text: 'Regenschauer', emoji: '🌦️' };
  if (c === 85 || c === 86) return { text: 'Schneeschauer', emoji: '🌨️' };
  if (c >= 95) return { text: 'Gewitter', emoji: '⛈️' };
  return { text: 'wechselhaft', emoji: '🌡️' };
}

let _cache = { at: 0, data: null };
const TTL_MS = 10 * 60 * 1000; // 10 Minuten

// Wird auch serverseitig von api/cockpit.js (Bob-Fakten) genutzt.
export async function getWeather() {
  if (_cache.data && Date.now() - _cache.at < TTL_MS) return _cache.data;
  const lat = CITIES.map((c) => c.lat).join(',');
  const lon = CITIES.map((c) => c.lon).join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + '&current=temperature_2m,weather_code&timezone=auto';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('open-meteo ' + r.status);
    const j = await r.json();
    // Bei mehreren Koordinaten liefert open-meteo ein Array (eine Location = Objekt).
    const arr = Array.isArray(j) ? j : [j];
    const cities = CITIES.map((c, i) => {
      const cur = (arr[i] && arr[i].current) || {};
      const info = codeInfo(cur.weather_code);
      const temp = cur.temperature_2m != null ? Math.round(Number(cur.temperature_2m)) : null;
      return { name: c.name, temp, code: cur.weather_code != null ? Number(cur.weather_code) : null, text: info.text, emoji: info.emoji };
    }).filter((c) => c.temp != null);
    const data = { cities, aktualisiert: new Date().toISOString() };
    _cache = { at: Date.now(), data };
    return data;
  } catch (_) {
    // Abgelaufener Cache ist immer noch besser als nichts.
    if (_cache.data) return _cache.data;
    return { cities: [], aktualisiert: null };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const data = await getWeather();
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
  return res.status(200).json(data);
}
