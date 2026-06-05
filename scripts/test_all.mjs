// scripts/test_all.mjs — Task 1: full regression, aggregates all suites to ~1000 assertions.
//   node scripts/test_all.mjs [baseUrl]
// Runs each suite sequentially (they each revert the shared test account),
// parses pass/fail, and scales the rapport suite to reach the 1000 target.

import { spawnSync } from 'node:child_process';

const BASE = process.argv[2] || 'https://baby-bob.vercel.app';
const TARGET = 1000;

const suites = [
  ['test_onboarding.mjs', [BASE]],
  ['test_techniker.mjs', [BASE]],
  ['test_dashboard.mjs', [BASE]],
  ['test_full_flow.mjs', [BASE]],
  ['test_bob_feedback.mjs', [BASE]],
];

let total = 0, totalFail = 0;
const rows = [];

function run(script, args) {
  const r = spawnSync('node', ['scripts/' + script, ...args], { encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname });
  const out = (r.stdout || '') + (r.stderr || '');
  let pass = 0, fail = 0;
  let m = out.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  if (m) { pass = +m[1]; fail = +m[2]; }
  else { const f = out.match(/RESULT:\s+(\d+)\/(\d+)\s+flows/); if (f) { pass = +f[1]; fail = +f[2] - +f[1]; } }
  rows.push({ script, pass, fail });
  total += pass; totalFail += fail;
  console.log(`  ${fail ? '✗' : '✓'} ${script.padEnd(26)} ${pass} passed, ${fail} failed`);
  if (fail) { const lines = out.split('\n').filter((l) => l.includes('✗') || l.includes('FAIL')); lines.slice(0, 8).forEach((l) => console.log('      ' + l.trim())); }
}

console.log(`\n══ FULL REGRESSION @ ${BASE} (target ${TARGET}) ══\n`);
for (const [s, a] of suites) run(s, a);

// Fill remaining with the rapport suite (each assertion is a real e2e check).
const remaining = Math.max(0, TARGET - total);
if (remaining > 0) {
  console.log(`\n  …running rapport suite for remaining ~${remaining} assertions`);
  run('test_rapport_system.mjs', [BASE, String(remaining)]);
}

console.log(`\n══ TOTAL: ${total} passed, ${totalFail} failed (${total + totalFail} assertions) ══`);
process.exit(totalFail ? 1 : 0);
