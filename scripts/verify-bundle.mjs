/**
 * verify-bundle.mjs — S2's acceptance check: prove no secret reaches the client
 * by grepping the **built bundle**, not the source.
 *
 *   npm run verify:bundle              # export, then scan
 *   npm run verify:bundle -- --reuse   # scan the last export (fast, for iteration)
 *
 * Why the build and not the source: `app/lib/supabase.ts` reading only
 * `EXPO_PUBLIC_*` is an argument about what *should* happen. Metro inlining an
 * env var, a transitive dependency embedding a token, or a stale `app/.env` from
 * before `sync-app-env.mjs` existed are all things source inspection cannot see.
 * Brief criterion 3 says "no API key present in the client" — the client is the
 * artifact, so the artifact is what gets read.
 *
 * Exit 1 on any finding. Findings name the variable, never its value.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envLiterals, scanText, SERVER_ONLY } from '../lib/secrets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'app');
const OUT = join(APP, 'dist');
const reuse = process.argv.includes('--reuse');

/** Text formats a secret could survive in. Binaries and fonts are skipped. */
const READABLE = /\.(js|mjs|cjs|jsx|ts|tsx|html|htm|css|json|map|txt|xml|svg)$/i;

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (READABLE.test(entry)) acc.push(full);
  }
  return acc;
}

if (!reuse) {
  if (!existsSync(join(APP, 'node_modules'))) {
    console.error('app/node_modules absent — run `npm --prefix app install` first.');
    process.exit(1);
  }
  // A stale export would let a fixed leak keep passing, or a fixed bundle keep
  // failing. Neither is a result worth having.
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });

  console.log('Exporting the web bundle (expo export --platform web)…');
  // npx.cmd rather than `shell: true` — passing args through a shell triggers
  // DEP0190 and concatenates them unescaped, which is a poor trade for a path.
  const build = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['expo', 'export', '--platform', 'web', '--output-dir', 'dist'],
    { cwd: APP, stdio: 'inherit' });
  if (build.status !== 0) {
    console.error('\nExport failed — nothing to scan. Fix the build first.');
    process.exit(1);
  }
}

if (!existsSync(OUT)) {
  console.error(`No bundle at ${relative(ROOT, OUT)} — run without --reuse.`);
  process.exit(1);
}

const { forbidden, allowed } = envLiterals();
const files = walk(OUT);
const findings = [];

for (const file of files) {
  const hits = scanText(readFileSync(file, 'utf8'), { forbidden, allowed, names: SERVER_ONLY });
  for (const hit of hits) findings.push({ file: relative(ROOT, file), ...hit });
}

// A scan that read no JavaScript read no bundle, and "found nothing" would be a
// statement about the walk, not about the app. Fail loudly rather than pass.
const jsBundles = files.filter((f) => /\.js$/i.test(f));
if (!jsBundles.length) {
  console.error(`\n✖ No JavaScript found under ${relative(ROOT, OUT)} — the export produced no`);
  console.error('  bundle to scan, so this check proves nothing. Not reporting a pass.');
  process.exit(1);
}

console.log(`\nScanned ${files.length} file(s) in ${relative(ROOT, OUT)}`);
console.log(`  JS bundles: ${jsBundles.map((f) => relative(OUT, f)).join(', ')}`);
console.log(`  literal values checked: ${forbidden.map((l) => l.name).join(', ') || '(none set in .env)'}`);
console.log(`  client-safe exemptions: ${allowed.map((l) => l.name).join(', ') || '(none)'}`);

if (!forbidden.length) {
  // Reported, never silent: with no real values in .env the literal half of this
  // check proves nothing, and a green run would overstate what was verified.
  console.log('\n  NOTE: no server-side key has a real value in .env, so only the');
  console.log('        shape and reference rules ran. Re-run once H2 is cleared.');
}

if (findings.length) {
  console.error(`\n✖ ${findings.length} finding(s) — a secret is reachable from the client:\n`);
  for (const f of findings) console.error(`  ${f.kind.padEnd(9)} ${f.name}  →  ${f.file}`);
  console.error('\nThe value itself is deliberately not printed. Rotate the key before anything else.');
  process.exit(1);
}

console.log('\n✔ No server-side key, key-shaped string, or server-only variable name');
console.log('  appears anywhere in the built client bundle.');
