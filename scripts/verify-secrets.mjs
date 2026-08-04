/**
 * verify-secrets.mjs — S2's repo-side check: no key in a tracked file, and none
 * anywhere in git history.
 *
 *   npm run verify:secrets
 *
 * The history half is the part that is easy to skip and impossible to fix later.
 * A key deleted in a later commit is still in the pack file, still in every clone,
 * and still on GitHub — removing it needs a history rewrite and a rotated key, so
 * the only useful time to find out is now.
 *
 * Note the exemption in `lib/secrets.mjs` does NOT apply here. The anon key is
 * safe to *ship in a bundle*; it is not safe to *commit*. Bundle rules and repo
 * rules are different rules, and this script deliberately runs the strict one.
 *
 * Exit 1 on any finding. Findings name the variable and the commit, never the value.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  envLiterals,
  scanText,
  SECRET_PATTERNS,
  SHAPE_EXEMPT_PATHS,
  isShapeExempt,
} from '../lib/secrets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MB = 1024 * 1024;

const git = (...args) =>
  spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * MB });

/** Binary and vendored paths a text scan would only produce noise on. */
const SKIP = /\.(png|jpe?g|gif|ico|zip|pdf|ttf|otf|woff2?|p8|p12|jks)$/i;

const { forbidden: serverSide, allowed } = envLiterals();
// Strict repo rule: every real key value is forbidden here, the anon key included.
const forbidden = [...serverSide, ...allowed];

const findings = [];

// ---------------------------------------------------------------------------
// 1. Tracked files, as they stand now.
// ---------------------------------------------------------------------------
const tracked = git('ls-files').stdout.split('\n').map((s) => s.trim()).filter(Boolean);
let scanned = 0;

for (const rel of tracked) {
  if (SKIP.test(rel)) continue;
  const full = join(ROOT, rel);
  if (!existsSync(full)) continue;
  scanned++;
  for (const hit of scanText(readFileSync(full, 'utf8'), {
    forbidden,
    skipShape: isShapeExempt(rel),
  })) {
    findings.push({ where: `tracked: ${rel}`, ...hit });
  }
}

// ---------------------------------------------------------------------------
// 2. Every commit on every ref. Attribution matters — "somewhere in history" is
//    not actionable, and the fix differs depending on how deep it is.
// ---------------------------------------------------------------------------
const commits = git('rev-list', '--all').stdout.split('\n').map((s) => s.trim()).filter(Boolean);

/**
 * Split a patch into per-file sections so the shape exemption can be applied to
 * the fixture file alone. Scanning the whole patch as one blob would mean a commit
 * that merely touches `lib/secrets.test.mjs` re-fires every shape rule — the same
 * permanent-red problem the exemption exists to fix, moved into history.
 *
 * Anything before the first `diff --git` (the commit header and message) is kept
 * and scanned normally: a key pasted into a commit message is still a leak.
 */
function sections(patch) {
  const parts = patch.split(/^diff --git /m);
  const out = [{ path: '', text: parts[0] }];
  for (const part of parts.slice(1)) {
    // `a/path b/path` — take the b-side, which is the post-change path.
    const path = (part.match(/^a\/\S+ b\/(\S+)/) || [, ''])[1] || '';
    out.push({ path, text: part });
  }
  return out;
}

for (const sha of commits) {
  const patch = git('show', '--no-color', '--format=%H %s', sha).stdout;
  if (!patch) continue;
  for (const { path, text } of sections(patch)) {
    for (const hit of scanText(text, { forbidden, skipShape: isShapeExempt(path) })) {
      findings.push({ where: `commit ${sha.slice(0, 8)}`, ...hit });
    }
  }
}

console.log(`Scanned ${scanned} tracked file(s) and ${commits.length} commit(s).`);
console.log(`  literal values checked: ${forbidden.map((l) => l.name).join(', ') || '(none set in .env)'}`);
console.log(`  shape rules: ${SECRET_PATTERNS.map((p) => p.name).join(', ')}`);
console.log(`  shape-exempt (literal rules still apply): ${SHAPE_EXEMPT_PATHS.join(', ')}`);

if (!forbidden.length) {
  console.log('\n  NOTE: .env holds no real values, so only the shape rules ran.');
}

if (findings.length) {
  const unique = [...new Map(findings.map((f) => [`${f.where}|${f.name}`, f])).values()];
  console.error(`\n✖ ${unique.length} finding(s):\n`);
  for (const f of unique) console.error(`  ${f.kind.padEnd(9)} ${f.name}  →  ${f.where}`);
  console.error('\nA key in history is not fixed by deleting it in a new commit.');
  console.error('Rotate the key first, then decide whether a history rewrite is warranted.');
  process.exit(1);
}

console.log('\n✔ No key value and no key-shaped string in any tracked file or any commit.');
