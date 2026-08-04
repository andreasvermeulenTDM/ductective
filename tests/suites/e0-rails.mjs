/**
 * Epic 0 — Repo & rails foundation. Run A.
 * Stories E0.1, E0.2, E0.6, E0.7 · brief AC 1, 4, 9.
 *
 * E0.3 and E0.5 are device-manual and live in suites/human-only.mjs — they are
 * never asserted here, because a criterion this process did not execute may not
 * be reported as PASS no matter how confident the inference.
 */

import { defineSuite, pass, fail, blocked } from '../harness.mjs';

/*
 * Key shapes come from lib/secrets.mjs rather than being restated here. Two
 * definitions of "what a secret looks like" drift, and the half that drifts is
 * always the one nobody is running.
 */
import {
  SECRET_PATTERNS,
  SERVER_ONLY,
  SHAPE_EXEMPT_PATHS,
  isShapeExempt,
} from '../../lib/secrets.mjs';

/** §5 layout from Ductective-Plan-v3.md, as E0.1 enumerates it. */
const LAYOUT = [
  'CLAUDE.md',
  '.claude/agents',
  '.pipeline',
  'brand',
  'data/manifest.csv',
  'docs',
  'SETUP-BLOCKERS.md',
  'Ductective-Plan-v3.md',
];

export default defineSuite({
  epic: 'E0',
  title: 'Repo & rails foundation',
  run: 'A',
  checks: [
    {
      story: 'E0.1',
      ac: 'brief AC 1',
      what: 'git log returns at least one commit from the repo root',
      async run(c) {
        const r = await c.git('log', '--oneline', '-1');
        return r.exitCode === 0 && r.stdout.trim() ? pass(r) : fail(r, 'no commits found');
      },
    },

    {
      story: 'E0.1',
      ac: 'brief AC 1',
      what: 'tree matches the §5 layout',
      async run(c) {
        const missing = LAYOUT.filter((p) => !c.exists(p));
        const ev = c.fromCheck(
          'existsSync over the §5 layout list',
          LAYOUT.map((p) => `${c.exists(p) ? 'ok  ' : 'MISS'}  ${p}`).join('\n')
        );
        return missing.length === 0 ? pass(ev) : fail(ev, `absent: ${missing.join(', ')}`);
      },
    },

    {
      story: 'E0.1',
      ac: 'brief AC 1',
      what: '.gitignore excludes HVAC Data/ and .env',
      async run(c) {
        const gi = c.read('.gitignore') ?? '';
        const hasCorpus = /^HVAC Data\/$/m.test(gi);
        const hasEnv = /^\.env$/m.test(gi);
        const ev = c.fromFile('.gitignore', `HVAC Data/: ${hasCorpus}\n.env: ${hasEnv}`);
        return hasCorpus && hasEnv
          ? pass(ev)
          : fail(ev, 'one of the two required ignore rules is absent');
      },
    },

    {
      story: 'E0.1',
      ac: 'brief AC 1',
      what: 'no PDF and no .env has ever entered git history',
      async run(c) {
        // The brief calls this out as a hard constraint: 215 MB of PDFs must
        // never be in history. History is not fixable after the fact without a
        // rewrite, so this is checked across --all, not just HEAD.
        const r = await c.git('log', '--all', '--name-only', '--pretty=format:');
        const offenders = [...new Set(
          r.stdout
            .split('\n')
            .map((s) => s.trim())
            .filter((p) => p && (p.startsWith('HVAC Data/') || p === '.env' || p.endsWith('.pdf')))
        )];
        const ev = c.fromCheck(
          'git log --all --name-only, filtered to HVAC Data/, .env, *.pdf',
          offenders.length ? offenders.join('\n') : '(no matching path in any commit)'
        );
        return offenders.length === 0
          ? pass(ev)
          : fail(ev, `${offenders.length} forbidden path(s) in history — needs a history rewrite`);
      },
    },

    {
      story: 'E0.1',
      what: 'remote andreasvermeulenTDM/ductective is set',
      async run(c) {
        const r = await c.git('remote', 'get-url', 'origin');
        return /ductective/i.test(r.stdout)
          ? pass(r)
          : fail(r, 'origin is not the expected ductective remote');
      },
    },

    {
      story: 'E0.2',
      ac: 'brief AC 3',
      what: '.env.example lists every required variable with no real values',
      async run(c) {
        const src = c.read('.env.example');
        if (!src) return fail(c.fromFile('.env.example', 'file absent'), '.env.example missing');

        const required = [
          'EXPO_PUBLIC_SUPABASE_URL',
          'EXPO_PUBLIC_SUPABASE_ANON_KEY',
          'SUPABASE_SERVICE_ROLE_KEY',
          'GEMINI_API_KEY',
          'VOYAGE_API_KEY',
        ];
        const declared = [...src.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]);
        const missing = required.filter((k) => !declared.includes(k));
        const leaked = SECRET_PATTERNS.filter((p) => p.re.test(src)).map((p) => p.name);

        const ev = c.fromFile(
          '.env.example',
          `declared: ${declared.join(', ')}\nmissing: ${missing.join(', ') || '(none)'}\n` +
            `secret-shaped values: ${leaked.join(', ') || '(none)'}`
        );
        if (leaked.length) return fail(ev, `a real-looking secret is in the tracked template: ${leaked.join(', ')}`);
        return missing.length === 0 ? pass(ev) : fail(ev, `undeclared: ${missing.join(', ')}`);
      },
    },

    {
      story: 'E0.2',
      ac: 'brief AC 3',
      what: 'no API key appears in any tracked file',
      async run(c) {
        const files = await c.tracked();
        const hits = [];

        let exempted = 0;
        for (const f of files) {
          if (/\.(png|jpg|jpeg|zip|pdf|p8|p12|jks)$/i.test(f)) continue;
          const body = c.read(f);
          if (!body) continue;
          // The scanner's own fixtures must look like keys. Suppressing the
          // heuristics there is the whole point of SHAPE_EXEMPT_PATHS — and this
          // check has to honour it too, or the permanent red simply moves here.
          // Literal values are covered by `npm run verify:secrets`, which runs the
          // strict rule over both tracked files and all history.
          if (isShapeExempt(f)) { exempted++; continue; }
          for (const p of SECRET_PATTERNS) {
            if (p.re.test(body)) hits.push(`${f} — ${p.name}`);
          }
        }

        const ev = c.fromCheck(
          `scanned ${files.length} tracked files for key prefixes ` +
            `(${exempted} shape-exempt: ${SHAPE_EXEMPT_PATHS.join(', ')})`,
          hits.length ? hits.join('\n') : '(no key-shaped string in any tracked file)'
        );
        return hits.length === 0 ? pass(ev) : fail(ev, `${hits.length} tracked file(s) contain a key-shaped string`);
      },
    },

    {
      story: 'E0.2',
      ac: 'brief AC 3',
      what: '.env is untracked, and the app bundle reads no server-side key',
      async run(c) {
        const tracked = await c.git('ls-files', '.env');
        const envTracked = tracked.stdout.trim().length > 0;

        // Expo inlines only EXPO_PUBLIC_*. Any other key read from app/ would
        // ship to the device, which is exactly what brief AC 3 forbids.
        //
        // Imported, not restated. This file's own header says key shapes come from
        // lib/secrets.mjs "because two definitions of what a secret looks like
        // drift, and the half that drifts is always the one nobody is running" —
        // and this list had already drifted, missing GEMINI_API_KEY.
        const serverOnly = SERVER_ONLY;
        const appFiles = [];
        const walk = (dir) => {
          for (const entry of c.list(dir)) {
            if (entry === 'node_modules' || entry.startsWith('.')) continue;
            const rel = `${dir}/${entry}`;
            if (/\.(ts|tsx|js|jsx|json)$/.test(entry)) appFiles.push(rel);
            else if (!entry.includes('.')) walk(rel);
          }
        };
        walk('app');

        const leaks = appFiles.flatMap((f) => {
          const body = c.read(f) ?? '';
          return serverOnly.filter((k) => body.includes(k)).map((k) => `${f} references ${k}`);
        });

        const ev = c.fromCheck(
          `git ls-files .env; scanned ${appFiles.length} app source files for server-only key names`,
          `.env tracked: ${envTracked}\n${leaks.join('\n') || '(no server-only key referenced in app/)'}`
        );
        if (envTracked) return fail(ev, '.env is tracked by git');
        return leaks.length === 0 ? pass(ev) : fail(ev, `${leaks.length} client-side reference(s) to a server-only key`);
      },
    },

    {
      story: 'E0.6',
      ac: 'brief AC 4',
      what: 'Supabase has pgvector enabled',
      needsEnv: ['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
      async run(c) {
        const { supabaseAdmin } = await import('../../lib/clients.mjs');
        const { data, error } = await supabaseAdmin().rpc('ductective_health');
        if (error) {
          return blocked(
            `ductective_health RPC failed: ${error.message} — run sql/001_bootstrap.sql`,
            c.fromCheck('supabase.rpc(ductective_health)', error.message)
          );
        }
        const ev = c.fromCheck('supabase.rpc(ductective_health)', JSON.stringify(data, null, 2));
        return data.pgvector ? pass(ev, `pgvector ${data.pgvector}`) : fail(ev, 'vector extension not installed');
      },
    },

    {
      story: 'E0.6',
      ac: 'brief AC 4',
      what: 'chunks table carries full provenance per chunk',
      requires: 'knowledge',
      needsEnv: ['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
      async run(c) {
        const { supabaseAdmin } = await import('../../lib/clients.mjs');
        const required = [
          'source_document', 'page_number', 'manufacturer',
          'model_coverage', 'doc_type', 'license_status',
        ];
        const { data, error } = await supabaseAdmin().from('chunks').select('*').limit(1);
        if (error) {
          return fail(
            c.fromCheck('select * from chunks limit 1', error.message),
            `chunks table not queryable: ${error.message}`
          );
        }
        const cols = Object.keys(data?.[0] ?? {});
        const missing = required.filter((k) => !cols.includes(k));
        const ev = c.fromCheck('select * from chunks limit 1', `columns: ${cols.join(', ')}`);
        if (!data?.length) return blocked('chunks table is empty — nothing ingested yet', ev);
        return missing.length === 0 ? pass(ev) : fail(ev, `missing provenance columns: ${missing.join(', ')}`);
      },
    },

    {
      story: 'E0.6',
      ac: 'brief AC 4',
      what: 'a page-less chunk is rejected at write time, not tolerated',
      requires: 'knowledge',
      needsEnv: ['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
      async run(c) {
        // E0.6 is explicit that page_number and source_document are NOT NULL.
        // The only honest way to check a constraint is to violate it, so this
        // attempts the bad insert and expects the database to refuse.
        const { supabaseAdmin } = await import('../../lib/clients.mjs');
        const { error } = await supabaseAdmin()
          .from('chunks')
          .insert({ chunk_text: 'stage-5 constraint probe', page_number: null, source_document: null });

        const ev = c.fromCheck(
          'insert into chunks (page_number: null, source_document: null)',
          error ? `rejected: ${error.code} ${error.message}` : 'INSERT SUCCEEDED — constraint absent'
        );
        return error
          ? pass(ev, 'null provenance rejected by the database')
          : fail(ev, 'a chunk that cannot name its page was accepted — citation integrity is not enforced');
      },
    },

    {
      story: 'E0.7',
      ac: 'brief AC 9',
      what: 'lint, build, and test commands exist and are documented',
      async run(c) {
        const pkg = JSON.parse(c.read('package.json') ?? '{}');
        const appPkg = JSON.parse(c.read('app/package.json') ?? '{}');
        const scripts = { ...(pkg.scripts ?? {}), ...(appPkg.scripts ?? {}) };
        const wanted = ['lint', 'build', 'test'];
        const missing = wanted.filter((k) => !scripts[k]);

        const ev = c.fromCheck(
          'package.json + app/package.json scripts',
          `root: ${Object.keys(pkg.scripts ?? {}).join(', ')}\n` +
            `app:  ${Object.keys(appPkg.scripts ?? {}).join(', ')}\n` +
            `missing: ${missing.join(', ') || '(none)'}`
        );
        return missing.length === 0
          ? pass(ev)
          : fail(ev, `no ${missing.join('/')} script — E0.7 has not been implemented, so no stage can report a baseline`);
      },
    },

    {
      story: 'E0.7',
      ac: 'brief AC 9',
      what: 'TypeScript compiles clean (the only build gate that exists today)',
      async run(c) {
        if (!c.exists('app/node_modules')) {
          return blocked('app/node_modules absent — run `npm --prefix app install` first');
        }
        // Run from app/ rather than passing --project from the root: tsconfig
        // paths resolve relative to the config file, and the root has no
        // TypeScript install of its own.
        const r = await c.sh('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], { cwd: 'app' });
        return r.exitCode === 0
          ? pass(r, 'tsc --noEmit clean')
          : fail(r, 'tsc reported errors');
      },
    },
  ],
});
