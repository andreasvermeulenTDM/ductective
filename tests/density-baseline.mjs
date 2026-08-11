/**
 * density-baseline.mjs — the rerunnable number ST-F19 has to beat.
 *
 *   node tests/density-baseline.mjs
 *   node tests/density-baseline.mjs --json
 *
 * ST-F18. Prints D1–D4 per scene with the per-fragment breakdown, plus the fenced
 * copy inventory ST-F19 may not shorten.
 *
 * **It counts rendered-in-branch, not visible-without-scrolling.** That sentence
 * is printed with every run on purpose. Whether the technician can see any of this
 * without scrolling is ST-F20 AC 7 and no agent may claim it.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { measureScene } from './lib/density.mjs';
import { SCENES, FENCED_COPY } from './lib/densityScenes.mjs';
import { resolveCopy, fencedInventory } from './lib/copyInventory.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return null; }
};

const copy = resolveCopy(read);
const scenes = SCENES.map((s) => measureScene(s, read, copy));
const fenced = fencedInventory(FENCED_COPY, read);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ scenes, fenced }, null, 2));
} else {
  console.log('\nDuctective — unit-entry density baseline (ST-F18)\n');
  console.log('Counts rendered-in-branch. NOT visible-without-scrolling — that half is');
  console.log('human-only and is ST-F20 AC 7.\n');

  console.log('| scene | D1 controls | D2 text blocks | D3 words | D4 containers |');
  console.log('|---|---|---|---|---|');
  for (const s of scenes) {
    const t = s.totals;
    console.log(`| ${s.name} | ${t.D1} | ${t.D2} | ${t.D3} | ${t.D4} |`);
  }

  for (const s of scenes) {
    console.log(`\n${s.name} — ${s.note}`);
    for (const p of s.parts) {
      console.log(`  ${p.label.padEnd(30)} D1=${String(p.D1).padStart(2)} D2=${String(p.D2).padStart(2)} D3=${String(p.D3).padStart(3)} D4=${String(p.D4).padStart(2)}   ${p.why}`);
    }
  }

  console.log('\nFenced copy — ST-F18 AC 5. Shortening any of these is a failure, not a win.\n');
  console.log('| constant | source | words |');
  console.log('|---|---|---|');
  for (const f of fenced) {
    console.log(`| ${f.name} | \`${f.file}\` | ${f.words === null ? 'NOT FOUND' : f.words} |`);
  }

  const missing = fenced.filter((f) => f.words === null);
  if (missing.length) {
    console.log(`\n⚠ ${missing.length} fenced constant(s) could not be resolved: ${missing.map((f) => f.name).join(', ')}`);
    process.exitCode = 1;
  }
}
