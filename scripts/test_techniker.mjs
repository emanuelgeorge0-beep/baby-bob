// scripts/test_techniker.mjs
// Automated tests for /api/techniker against a deployment.
//   node scripts/test_techniker.mjs [baseUrl]
// Default baseUrl: https://baby-bob.vercel.app

const BASE = process.argv[2] || 'https://baby-bob.vercel.app';
let pass = 0, fail = 0;
const ok = (n) => { console.log(`  ✓ ${n}`); pass++; };
const no = (n, d) => { console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); fail++; };

async function get(path) {
  const r = await fetch(BASE + path);
  let body; try { body = await r.json(); } catch { body = null; }
  return { status: r.status, body };
}

console.log(`Testing /api/techniker @ ${BASE}\n`);

// 1. Happy path: returns available technicians
const list = await get('/api/techniker');
list.status === 200 ? ok('GET 200') : no('GET 200', 'got ' + list.status);
const techs = list.body?.techniker;
Array.isArray(techs) ? ok('returns techniker array') : no('returns techniker array');
techs?.length >= 3 ? ok(`>=3 technicians (${techs.length})`) : no('>=3 technicians', techs?.length);

// 2. Shape validation
const t = techs?.[0] || {};
['id', 'name', 'qualification', 'specialization', 'rating', 'years_experience', 'photo_emoji', 'availability']
  .forEach((k) => (k in t ? ok(`field "${k}" present`) : no(`field "${k}" present`)));
Array.isArray(t.specialization) ? ok('specialization is array') : no('specialization is array');
typeof t.rating === 'number' ? ok('rating is number') : no('rating is number', typeof t.rating);

// 3. Privacy: no contact info leaked
const leaked = techs?.some((x) => 'email' in x || 'telefon' in x || 'phone' in x);
!leaked ? ok('no email/telefon leaked') : no('no email/telefon leaked');

// 4. Only available technicians
const allAvail = techs?.every((x) => x.availability === true);
allAvail ? ok('all availability=true') : no('all availability=true');

// 5. bereich sorting — Heizung specialist should rank first
const heiz = await get('/api/techniker?bereich=Heizung');
const first = heiz.body?.techniker?.[0];
first?.specialization?.some((s) => s.toLowerCase() === 'heizung')
  ? ok('?bereich=Heizung ranks a Heizung specialist first')
  : no('?bereich=Heizung ranks a Heizung specialist first', first?.name);

// 6. Sorted by rating (no bereich)
const ratings = (techs || []).map((x) => x.rating ?? 0);
const sorted = ratings.every((v, i) => i === 0 || ratings[i - 1] >= v);
sorted ? ok('default sort by rating desc') : no('default sort by rating desc', ratings.join(','));

// 7. Edge: wrong method
const post = await fetch(BASE + '/api/techniker', { method: 'POST' });
post.status === 405 ? ok('POST → 405') : no('POST → 405', 'got ' + post.status);

// 8. Edge: unknown bereich still returns list
const unknown = await get('/api/techniker?bereich=ZZZ_nope');
unknown.status === 200 && Array.isArray(unknown.body?.techniker)
  ? ok('unknown bereich still returns 200 list')
  : no('unknown bereich still returns 200 list');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
