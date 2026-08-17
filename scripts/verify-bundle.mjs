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
/** Expo's own CLI entry — see the spawn below for why this is not `npx`. */
const EXPO_CLI = join(APP, 'node_modules', 'expo', 'bin', 'cli');
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

  // Run the Expo CLI's own entry under this Node, rather than going through
  // `npx`. Two failed approaches are recorded so neither is tried again:
  //
  //   `shell: true`   — triggers DEP0190 and concatenates args unescaped.
  //   `npx.cmd`       — since Node 18.20.2 / 20.12.2 (the CVE-2024-27980 fix)
  //                     spawning a `.cmd` without a shell throws **EINVAL**.
  //                     `spawnSync` then returns `status: null`, which the old
  //                     `status !== 0` test read as a failed build. On Windows
  //                     this check could therefore never run at all: it reported
  //                     "fix the build first" against a bundle that exports
  //                     cleanly, and it never once scanned a byte.
  //
  // `expo/bin/cli` is plain JS with a `#!/usr/bin/env node` shebang, so invoking
  // it with `process.execPath` is the same program without the shell, the `.cmd`
  // shim, or a platform branch.
  if (!existsSync(EXPO_CLI)) {
    console.error(`Expo CLI absent at ${relative(ROOT, EXPO_CLI)} — run \`npm --prefix app install\`.`);
    process.exit(1);
  }

  console.log('Exporting the web bundle (expo export --platform web)…');
  const build = spawnSync(process.execPath,
    [EXPO_CLI, 'export', '--platform', 'web', '--output-dir', 'dist'],
    { cwd: APP, stdio: 'inherit' });

  // A spawn that never started is not a failed build, and saying so sent the
  // last reader to debug the app instead of this file.
  if (build.error) {
    console.error(`\nCould not start the Expo CLI: ${build.error.code ?? ''} ${build.error.message}`);
    console.error('This is a harness failure, not a bundle failure — the app build was never attempted.');
    process.exit(1);
  }
  if (build.status !== 0) {
    console.error(`\nExport failed (exit ${build.status}) — nothing to scan. Fix the build first.`);
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
