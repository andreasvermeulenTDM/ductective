/**
 * ST-F13 — the whole cited page, fetched with the key already in the bundle.
 *
 *   npm test
 *
 * Driven against a stub client rather than a live instance, because what these
 * criteria are about is the *shape* of the queries and the *absence* of throwing:
 * that the page is fetched by `(document_id, page_number)` in `chunk_index`
 * order, that the cited block is identifiable, and that every failure resolves to
 * `null` instead of taking a source sheet — and the answer behind it — down with
 * it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  fetchPageText,
  usableSourceUrl,
  withPageAnchor,
  __setClientForTests,
} from './pageText.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

const CITATION = {
  id: 'cit-1',
  source_document: 'RT-SVX23R-EN — Precedent Rooftop IOM',
  page: 84,
  claim: 'Check condenser coil loading first.',
  ordinal: 1,
  snippet: 'the second block',
  chunk_id: 'chunk-b',
  verified: 'exact',
};

const PAGE_ROWS = [
  { id: 'chunk-a', chunk_index: 0, text: 'the first block' },
  { id: 'chunk-b', chunk_index: 1, text: 'the second block' },
  { id: 'chunk-c', chunk_index: 2, text: 'the third block' },
];

/**
 * A recording stub. Every `from(...).select(...).eq(...)` is captured so the test
 * can assert what was asked for, not only what came back.
 */
function stub({ anchor, page, doc, throwOn } = {}) {
  const calls = [];
  const result = (rows, single) => {
    const chain = {
      eq(column, value) {
        calls[calls.length - 1].filters.push([column, value]);
        return chain;
      },
      order(column, opts) {
        calls[calls.length - 1].order = [column, opts];
        return Promise.resolve(rows);
      },
      maybeSingle() {
        return Promise.resolve(single ?? rows);
      },
    };
    return chain;
  };

  return {
    calls,
    from(table) {
      if (throwOn === table) throw new Error('boom');
      return {
        select(columns) {
          calls.push({ table, columns, filters: [] });
          if (table === 'documents') return result(doc ?? { data: { source_url: null }, error: null });
          // The first `chunks` read is the anchor; the second is the page.
          const chunkReads = calls.filter((c) => c.table === 'chunks').length;
          return chunkReads === 1
            ? result(anchor ?? { data: { document_id: 'doc-1', page_number: 84 }, error: null })
            : result(page ?? { data: PAGE_ROWS, error: null });
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// AC 3 / AC 7 — the queries, and the cited block
// ---------------------------------------------------------------------------

test('AC 3: it resolves chunk_id → (document_id, page_number), then the page, in chunk_index order', async () => {
  const client = stub();
  __setClientForTests(client);
  const got = await fetchPageText(CITATION);
  __setClientForTests(null);

  assert.ok(got, 'the page did not resolve');
  assert.equal(got.documentId, 'doc-1');
  assert.equal(got.page, 84);
  assert.equal(got.blocks.length, 3);
  assert.deepEqual(got.blocks.map((b) => b.chunkIndex), [0, 1, 2]);

  const [anchor, siblings] = client.calls;
  assert.equal(anchor.table, 'chunks');
  assert.deepEqual(anchor.filters, [['id', 'chunk-b']]);
  assert.equal(siblings.table, 'chunks');
  assert.deepEqual(siblings.filters, [['document_id', 'doc-1'], ['page_number', 84]]);
  assert.deepEqual(siblings.order, ['chunk_index', { ascending: true }]);
});

test('AC 7: exactly the retrieved chunk is flagged, so the UI can mark it in place', async () => {
  __setClientForTests(stub());
  const got = await fetchPageText(CITATION);
  __setClientForTests(null);

  assert.deepEqual(got.blocks.map((b) => b.cited), [false, true, false]);
  assert.equal(got.blocks.filter((b) => b.cited).length, 1);
  assert.equal(got.blocks.find((b) => b.cited).chunkId, CITATION.chunk_id);
});

// ---------------------------------------------------------------------------
// AC 5 / AC 6 — null, never an error, never a throw
// ---------------------------------------------------------------------------

test('AC 5: a citation with no chunk_id resolves to null without touching the client', async () => {
  // Rows persisted before sql/006 carry no chunk_id. They degrade to today's
  // behaviour — the stored snippet and nothing more — and the UI says so.
  const client = stub();
  __setClientForTests(client);
  assert.equal(await fetchPageText({ ...CITATION, chunk_id: null }), null);
  assert.equal(await fetchPageText({ ...CITATION, chunk_id: undefined }), null);
  __setClientForTests(null);
  assert.equal(client.calls.length, 0, 'a citation with no chunk_id must not query at all');
});

test('AC 6: a query error on the anchor read is null, not a throw', async () => {
  __setClientForTests(stub({ anchor: { data: null, error: { message: 'nope' } } }));
  assert.equal(await fetchPageText(CITATION), null);
  __setClientForTests(null);
});

test('AC 6: a query error on the page read is null, not a throw', async () => {
  __setClientForTests(stub({ page: { data: null, error: { message: 'nope' } } }));
  assert.equal(await fetchPageText(CITATION), null);
  __setClientForTests(null);
});

test('AC 6: a page with no blocks is null — an empty expansion is never rendered', async () => {
  __setClientForTests(stub({ page: { data: [], error: null } }));
  assert.equal(await fetchPageText(CITATION), null);
  __setClientForTests(null);
});

test('AC 6: a client that throws outright is still null', async () => {
  __setClientForTests(stub({ throwOn: 'chunks' }));
  assert.equal(await fetchPageText(CITATION), null);
  __setClientForTests(null);
});

test('AC 6: a missing chunk row, or a page number that is not a page, is null', async () => {
  __setClientForTests(stub({ anchor: { data: null, error: null } }));
  assert.equal(await fetchPageText(CITATION), null);
  __setClientForTests(stub({ anchor: { data: { document_id: 'doc-1', page_number: null }, error: null } }));
  assert.equal(await fetchPageText(CITATION), null);
  __setClientForTests(null);
});

// ---------------------------------------------------------------------------
// AC 8 — the manufacturer's own copy, never a fabricated one
// ---------------------------------------------------------------------------

test('AC 8: a real http(s) source_url comes through', async () => {
  __setClientForTests(stub({ doc: { data: { source_url: 'https://shareddocs.example/rt-svx23r.pdf' }, error: null } }));
  const got = await fetchPageText(CITATION);
  __setClientForTests(null);
  assert.equal(got.sourceUrl, 'https://shareddocs.example/rt-svx23r.pdf');
});

test('AC 8: a local:/// pseudo-URL is not a link — it resolves to nothing on a phone', async () => {
  // Owner-supplied documents carry one. A broken affordance is worse than none,
  // so the row shows page text and no link at all.
  __setClientForTests(stub({ doc: { data: { source_url: 'local:///HVAC Data/42_owner.pdf' }, error: null } }));
  const got = await fetchPageText(CITATION);
  __setClientForTests(null);
  assert.equal(got.sourceUrl, null);
  assert.equal(got.blocks.length, 3, 'the page text still renders without a link');
});

test('AC 8: an absent or failed source_url is null, never invented', async () => {
  __setClientForTests(stub({ doc: { data: null, error: { message: 'nope' } } }));
  const a = await fetchPageText(CITATION);
  __setClientForTests(stub({ doc: { data: { source_url: null }, error: null } }));
  const b = await fetchPageText(CITATION);
  __setClientForTests(null);
  assert.equal(a.sourceUrl, null);
  assert.equal(b.sourceUrl, null);
  assert.equal(a.blocks.length, 3, 'a failed document read must not lose the page');
});

test('usableSourceUrl accepts only a followable web address', () => {
  assert.equal(usableSourceUrl('https://example.com/a.pdf'), 'https://example.com/a.pdf');
  assert.equal(usableSourceUrl('  http://example.com/a.pdf  '), 'http://example.com/a.pdf');
  for (const bad of ['local:///x.pdf', 'file:///x.pdf', 'ftp://x/a.pdf', '', '   ', 'example.com', null, undefined, 42]) {
    assert.equal(usableSourceUrl(bad), null, `${String(bad)} was treated as a link`);
  }
});

test('the page anchor is best-effort and never invents a fragment', () => {
  assert.equal(withPageAnchor('https://x/a.pdf', 84), 'https://x/a.pdf#page=84');
  // A URL that already carries a fragment is left alone rather than mangled.
  assert.equal(withPageAnchor('https://x/a.pdf#toc', 84), 'https://x/a.pdf#toc');
  assert.equal(withPageAnchor('https://x/a.pdf', 0), 'https://x/a.pdf');
  assert.equal(withPageAnchor('https://x/a.pdf', 1.5), 'https://x/a.pdf');
});

// ---------------------------------------------------------------------------
// AC 4 / AC 9 — the anon key, and no migration
// ---------------------------------------------------------------------------

test('AC 4: no privileged key is anywhere near this module', () => {
  const src = readFileSync(join(HERE, 'pageText.ts'), 'utf8');
  assert.doesNotMatch(src, /service_role|SERVICE_ROLE|SUPABASE_SERVICE/);
  // It reads only the two tables that are anon-readable by policy (sql/003:167,170).
  const tables = [...src.matchAll(/\.from\('(\w+)'\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tables)].sort(), ['chunks', 'documents']);
});

test('AC 2: the shape the UI consumes is the one the story specified', async () => {
  __setClientForTests(stub());
  const got = await fetchPageText(CITATION);
  __setClientForTests(null);
  assert.deepEqual(Object.keys(got).sort(), ['blocks', 'documentId', 'page', 'sourceUrl']);
  assert.deepEqual(Object.keys(got.blocks[0]).sort(), ['chunkId', 'chunkIndex', 'cited', 'text']);
});
