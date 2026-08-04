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
