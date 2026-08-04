/**
 * answerFormat.ts — reading structure out of a prose answer.
 *
 * The mockup renders a diagnostic as a lead paragraph, numbered checks, and the
 * reading to take. Run B does not emit that structure yet — it emits prose — so
 * this recovers it. Presentation only: it reformats text the answer already
 * contains and invents nothing.
 *
 * Lives in `lib/` rather than inside `Message.tsx` so it can be tested without a
 * renderer. It is the half of E6.10 that does not need a component test harness,
 * and the half most likely to break silently when Run B's phrasing changes.
 *
 * Recorded as a CONTRACT MISMATCH in `.pipeline/04-frontend-design-pass.md`:
 * Run B should emit the structure rather than have the UI infer it.
 */

export type ParsedStep = {
  /** The bolded opening clause, when the step has a short label. */
  headline: string | null;
  rest: string;
};

export type ParsedAnswer = {
  lead: string;
  steps: ParsedStep[];
  /** Trailing prose after the last numbered step — typically the reading to take. */
  reading: string;
};

/** `1. `, `2) `, indented or not. */
const STEP = /^\s*\d+[.)]\s+/;

/**
 * Longest a first clause can be and still read as a label rather than a whole
 * sentence. Past this the step renders unbolded, which is the safer default:
 * emphasising half a sentence is worse than emphasising none of it.
 */
const MAX_HEADLINE = 42;

export function parseAnswer(body: string): ParsedAnswer {
  const lines = body.split('\n');
  const isStep = (l: string) => STEP.test(l);

  const first = lines.findIndex(isStep);
  if (first === -1) return { lead: body.trim(), steps: [], reading: '' };

  let last = first;
  for (let i = first; i < lines.length; i++) if (isStep(lines[i])) last = i;

  const lead = lines.slice(0, first).join('\n').trim();
  const reading = lines.slice(last + 1).join('\n').trim();

  const steps: ParsedStep[] = [];
  for (let i = first; i <= last; i++) {
    const line = lines[i];
    if (!isStep(line)) {
      // A wrapped continuation line belongs to the step above it.
      if (steps.length && line.trim()) steps[steps.length - 1].rest += ' ' + line.trim();
      continue;
    }
    const text = line.replace(STEP, '').trim();
    const dot = text.indexOf('.');
    if (dot > 0 && dot <= MAX_HEADLINE) {
      steps.push({ headline: text.slice(0, dot + 1), rest: text.slice(dot + 1).trim() });
    } else {
      steps.push({ headline: null, rest: text });
    }
  }

  return { lead, steps, reading };
}
