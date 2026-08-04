/**
 * net.ts — telling "no signal" apart from "something broke".
 *
 * E6.6 treats offline as its own state, not a flavour of error, and it is right
 * to: on a commercial roof, losing signal is the normal case. An error card that
 * says "couldn't load history" sends a technician looking for a bug. One that
 * says "you're offline" tells them to walk ten feet.
 *
 * There is no netinfo dependency here on purpose (see the note in Chrome.tsx).
 * This classifies the failure that actually happened, which is a real signal
 * rather than a decorative status pill.
 */

const OFFLINE_PATTERNS =
  /network|fetch|offline|timeout|ECONN|ENOTFOUND|EAI_AGAIN|Failed to fetch|Load failed|NetworkError/i;

export function looksOffline(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return OFFLINE_PATTERNS.test(message);
}
