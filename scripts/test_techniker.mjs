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

// 4. Network: all 12 returned, counts correct, available-first ordering
techs?.length >= 12 ? ok(`network has >=12 (${techs.length})`) : no('network has >=12', techs?.length);
list.body?.total === techs?.length ? ok('total matches list length') : no('total matches list length', list.body?.total);
list.body?.available === 4 ? ok('available count = 4') : no('available count = 4', list.body?.available);
const firstBookedIdx = techs.findIndex((x) => x.availability === false);
const lastAvailIdx = techs.map((x) => x.availability).lastIndexOf(true);
firstBookedIdx === -1 || lastAvailIdx < firstBookedIdx ? ok('available listed before booked') : no('available listed before booked');
// booked profiles carry booked_until
const booked = techs.filter((x) => !x.availability);
booked.every((x) => !!x.booked_until) ? ok('booked have booked_until') : no('booked have booked_until');
techs.filter((x) => x.availability).every((x) => !x.booked_until) ? ok('available have no booked_until') : no('available have no booked_until');

// 5. bereich sorting — within available, a Heizung specialist first
const heiz = await get('/api/techniker?bereich=Heizung');
const first = heiz.body?.techniker?.[0];
first?.availability === true && first?.specialization?.some((s) => s.toLowerCase() === 'heizung')
  ? ok('?bereich=Heizung ranks an available Heizung specialist first')
  : no('?bereich=Heizung ranks available Heizung first', first?.name);

// 6. Within each availability group, sorted by rating desc
const avail = techs.filter((x) => x.availability).map((x) => x.rating ?? 0);
avail.every((v, i) => i === 0 || avail[i - 1] >= v) ? ok('available sorted by rating desc') : no('available sorted by rating desc', avail.join(','));

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
