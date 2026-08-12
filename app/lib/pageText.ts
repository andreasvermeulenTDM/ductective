/**
 * pageText.ts — the whole page a cited passage came from.
 *
 * ST-F13 / F4. The owner asked to "see a preview of the manual page that had the
 * result". `.pipeline/02-user-stories-fixes.md` §2.3 priced both routes and the
 * owner chose:
 *
 *   Route A — page rasters in Supabase Storage. **Declined.** There is no PDF
 *     rasteriser in this tree in either language, the source PDFs exist only on
 *     the owner's machine, ~10,000 pages at 150 DPI is 1.5–3 GB against a 1 GB
 *     free tier, and serving OEM pages from our own bucket is a redistribution
 *     question no engineering stage here is authorised to answer. In backlog.md
 *     with both blockers named.
 *   Route B — the page's **extracted text**, from chunks that already exist,
 *     with the cited block marked in place, plus a link to the manufacturer's own
 *     copy where one exists. **Chosen.** No migration, no new storage, no new
 *     dependency, no new licence position.
 *
 * What this module does, in two cheap queries:
 *
 *   1. `chunk_id` → the chunk's `document_id` and `page_number`.
 *   2. every chunk with that `(document_id, page_number)`, ordered by
 *      `chunk_index` — which is the reading order of the page.
 *
 * plus one more for `documents.source_url`.
 *
 * **Anon key only.** `chunks` and `documents` are both readable by `anon`
 * (sql/003:167,170), so this needs nothing the bundle does not already carry, and
 * brief hard constraint 4 — no privileged key client-side — is untouched. Unlike
 * the `/suggest-units` route this does not go through `serve.mjs`, so it works
 * whether or not the diagnose server is running.
 *
 * **It never throws into a render path.** Every failure — no `chunk_id` on a
 * pre-sql/006 citation, a query error, an empty page — resolves to `null`. The
 * UI's job is to say nothing rather than to render an error card for something a
 * technician on a roof cannot act on. Same precedent as `requestResolveUnit`.
 */

import type { Citation } from './supabase';

/** One extracted block of the page, in reading order. */
export type PageBlock = {
  chunkId: string;
  chunkIndex: number;
  text: string;
  /** True for the block the citation's snippet was taken from. */
  cited: boolean;
};

export type PageText = {
  documentId: string;
  page: number;
  blocks: PageBlock[];
  /**
   * `documents.source_url`, and **only when it is a real http(s) URL**.
   *
   * Owner decision, 10 Aug 2026: link to the manufacturer's own PDF where one
   * exists. Owner-supplied documents carry a `local:///` pseudo-URL that resolves
   * to nothing on a phone, and a link that goes nowhere is worse than no link —
   * so those rows get the page text and no affordance at all. Never fabricated,
   * never guessed from the document name.
   */
  sourceUrl: string | null;
};

/**
 * The minimum surface of the Supabase client this module uses.
 *
 * Written as a structural type rather than importing `SupabaseClient` so the unit
 * tests can hand in a stub and assert the exact queries, which is what ST-F13
 * AC 3 asks for. `store.ts` uses `__setClientForTests` for the same reason.
 */
type QueryResult<T> = { data: T | null; error: { message: string } | null };

/** The filter/terminator chain, as far as this module walks it. */
type Filterable = {
  eq: (column: string, value: unknown) => Filterable;
  order: (column: string, opts: { ascending: boolean }) => Promise<QueryResult<PageChunkRow[]>>;
  maybeSingle: () => Promise<QueryResult<Record<string, unknown>>>;
};

type Selectable = {
  from: (table: string) => { select: (columns: string) => Filterable };
};

type PageChunkRow = { id: string; chunk_index: number; text: string };

let clientOverride: Selectable | null = null;

/** Test hook, mirroring `store.ts`'s. This repo has no mocking framework. */
export function __setClientForTests(client: Selectable | null): void {
  clientOverride = client;
}

async function db(): Promise<Selectable | null> {
  if (clientOverride) return clientOverride;
  // Dynamic, for the same reason `store.ts` does it: `supabase.ts` constructs a
  // client with an AsyncStorage adapter, so a static import would make this
  // module unloadable under `node --test`.
  const { supabase, isConfigured } = await import('./supabase');
  if (!isConfigured || !supabase) return null;
  return supabase as unknown as Selectable;
}

/** Only a real, followable web address. `local:///…` and anything else → null. */
export function usableSourceUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  return /^https?:\/\/\S+$/i.test(url.trim()) ? url.trim() : null;
}

/**
 * Best-effort deep link to a page inside the OEM's own PDF.
 *
 * `#page=N` is the PDF Open Parameters convention. Most desktop viewers honour
 * it; several mobile ones ignore it and open at page 1. The copy beside this link
 * must therefore **not promise** it lands on the page — it says which document it
 * opens and that the page number is the technician's to navigate to. A citation
 * that overstates itself is the defect class this project cares most about.
 */
export function withPageAnchor(url: string, page: number): string {
  if (!Number.isInteger(page) || page < 1) return url;
  return url.includes('#') ? url : `${url}#page=${page}`;
}

/**
 * The whole page behind a citation, or `null` when there is not one to show.
 *
 * `null` is returned — never thrown, never an error object — for: a citation with
 * no `chunk_id` (persisted before sql/006), a client that is not configured, any
 * query error, a chunk row that does not exist, and a page whose sibling lookup
 * comes back empty.
 */
export async function fetchPageText(citation: Citation): Promise<PageText | null> {
  const chunkId = citation.chunk_id;
  if (!chunkId) return null;

  try {
    const client = await db();
    if (!client) return null;

    // 1. Which document and page is this chunk on?
    const anchor = await client
      .from('chunks')
      .select('document_id, page_number')
      .eq('id', chunkId)
      .maybeSingle();
    if (anchor?.error || !anchor?.data) return null;

    // Narrowed rather than asserted: these come off an untyped row, and a `page`
    // that is not an integer is exactly the kind of value that would render as
    // `p.undefined` further down. A bad row is "no page to show", not a cast.
    const documentId = anchor.data.document_id;
    const page = anchor.data.page_number;
    if (typeof documentId !== 'string' || !documentId) return null;
    if (typeof page !== 'number' || !Number.isInteger(page)) return null;

    // 2. Every block on that page, in reading order. `chunk_index` is the order
    //    the extractor produced them in, and `unique (document_id, page_number,
    //    chunk_index)` (sql/003) is what makes that ordering total.
    const siblings = await client
      .from('chunks')
      .select('id, chunk_index, text')
      .eq('document_id', documentId)
      .eq('page_number', page)
      .order('chunk_index', { ascending: true });
    if (siblings?.error || !Array.isArray(siblings?.data) || siblings.data.length === 0) return null;

    const blocks: PageBlock[] = siblings.data.map((row: { id: string; chunk_index: number; text: string }) => ({
      chunkId: row.id,
      chunkIndex: row.chunk_index,
      text: row.text ?? '',
      // The whole gain of this route over the stored snippet: the technician can
      // see *where on the page* the claim came from, not just what it said.
      cited: row.id === chunkId,
    }));

    // 3. The manufacturer's own copy, if this document has a real one. A failure
    //    here is not a failure of the page text, so it degrades to `null` rather
    //    than losing the blocks we already have.
    let sourceUrl: string | null = null;
    try {
      const doc = await client
        .from('documents')
        .select('source_url')
        .eq('id', documentId)
        .maybeSingle();
      if (!doc?.error) sourceUrl = usableSourceUrl(doc?.data?.source_url);
    } catch {
      sourceUrl = null;
    }

    return { documentId, page, blocks, sourceUrl };
  } catch {
    // Never into a render path. A source sheet that crashes takes the answer with
    // it, and the answer is the thing the technician is standing on a roof for.
    return null;
  }
}
