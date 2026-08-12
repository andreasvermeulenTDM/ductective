/**
 * citations.ts — what makes a citation usable, in one place.
 *
 * E6.4: "A citation that cannot resolve surfaces as an error, never as plain
 * text." That requires a definition of *resolve* that the UI and Stage 5 can both
 * point at, rather than each screen deciding for itself what a broken citation
 * looks like.
 *
 * A citation resolves when a technician could act on it: it names a document and
 * a page they could physically turn to. Anything short of that is a defect to
 * surface — not a chip to draw and hope nobody taps.
 *
 * Deliberately free of React Native imports, like the token module, so the same
 * rule is importable by tests and by any later surface.
 */

import type { Citation } from './supabase';

export type Unresolvable = {
  resolvable: false;
  /** Shown to the user. Says what is wrong, not what the code expected. */
  reason: string;
};

export type Resolution = { resolvable: true } | Unresolvable;

/**
 * Why a page number is validated this hard: a citation reading `p.0` or `p.-1`
 * looks authoritative and sends a tech hunting through a 300-page IOM for a page
 * that was never there. A visible defect costs them nothing; a plausible wrong
 * page costs them the call.
 */
export function resolve(c: Citation): Resolution {
  const doc = (c.source_document ?? '').trim();

  if (!doc) return { resolvable: false, reason: 'No source document was recorded.' };

  if (c.page === null || c.page === undefined) {
    return { resolvable: false, reason: `No page was recorded for ${doc}.` };
  }
  if (!Number.isFinite(c.page) || !Number.isInteger(c.page) || c.page < 1) {
    return { resolvable: false, reason: `Page "${c.page}" is not a page that exists in ${doc}.` };
  }

  return { resolvable: true };
}

export const isResolvable = (c: Citation) => resolve(c).resolvable;

/**
 * Split a message's citations into the ones a tech can follow and the ones that
 * are defects.
 *
 * Callers must treat "some resolvable" and "none resolvable" differently: an
 * answer whose every citation is broken is an uncited claim, and E6.4 forbids
 * rendering one as guidance no matter how well-formed the prose is.
 */
export function partition(citations: Citation[]) {
  const usable: Citation[] = [];
  const broken: { citation: Citation; reason: string }[] = [];

  for (const c of citations) {
    const r = resolve(c);
    if (r.resolvable) usable.push(c);
    else broken.push({ citation: c, reason: r.reason });
  }

  return { usable, broken, hasAnyUsable: usable.length > 0 };
}

/**
 * ST-F14 — the words the whole-page view says about itself.
 *
 * Out of the JSX for the same reason `accountCopy.ts` exists: these sentences are
 * claims about provenance, they are checked by a copy test, and an argument about
 * their wording should not require reading a component.
 *
 * `honesty` is the load-bearing one, and it is why this route is defensible at
 * all. What the app holds is **extracted text**, not a picture of the page. The
 * corpus has documented extraction defects (`.pipeline/D1-parse-word-boundaries.md`),
 * and a wiring diagram or a table of pressures frequently does not survive
 * `pdfplumber` in any readable form. Without this line a technician who expands
 * the page, sees no diagram, and concludes we do not hold one has been misled by
 * omission — which is the same class of defect as a citation that overstates
 * itself. It is not collapsible and it renders above the text, never under it.
 *
 * `linkNote` is the other half of the same rule. The link goes to the **whole
 * document** on the manufacturer's own site, with `#page=N` appended on a
 * best-effort basis that several mobile PDF viewers ignore. So the copy says
 * which document it opens and that it leaves the app; it does not promise to land
 * on the page.
 */
export const PAGE_TEXT_COPY = {
  expand: 'Show the whole page',
  collapse: 'Hide the whole page',
  loading: 'Looking up the rest of this page…',
  /** Rendered when `fetchPageText` returns null. A plain line, never an error card. */
  unavailable:
    'The rest of this page is not available here — the passage above is what was stored with this citation.',
  honesty:
    'This is the extracted text of the page, not a picture of it. Figures, wiring diagrams and tables may not survive extraction, so something missing here may still be on the printed page.',
  cited: 'THE PASSAGE THIS CLAIM CAME FROM',
  link: "Open the manufacturer's copy",
  linkNote:
    'Leaves Ductective and opens the whole document on the manufacturer\'s site. It may not land on this page — the page number is above.',
} as const;
