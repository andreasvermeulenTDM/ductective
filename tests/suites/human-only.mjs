/**
 * The human-only checklist.
 *
 * .claude/agents/test.md, duty 6: surface the steps no agent can complete, as an
 * explicit checklist rather than an implication. And duty 1: a criterion that
 * needs a physical device, an external service, or a human eye is HUMAN-ONLY —
 * never PASS, even where a confident argument could be constructed that it works.
 *
 * The brief is explicit about this too (00-brief.md §Verification): criteria 2
 * and 3 are device-manual, and Stage 5 lists them rather than claiming them.
 *
 * Each entry states the exact steps, so the human doing them is not re-deriving
 * the procedure from the story text.
 */

import { defineSuite, human } from '../harness.mjs';

const step = (story, ac, what, steps) => ({
  story,
  ac,
  what,
  run: async () => human(steps.map((s, i) => `${i + 1}. ${s}`).join('\n')),
});

export default defineSuite({
  epic: 'HUMAN',
  title: 'Human-only verification',
  run: '*',
  checks: [
    step('E0.3', 'brief AC 2', 'the app loads on a physical iOS or Android device', [
      'npm run sync-env && npx expo start from the repo root.',
      'Scan the QR with Expo Go on a physical phone (H7 in SETUP-BLOCKERS.md).',
      'Confirm the app renders past the splash without a red box.',
      'Record: device model, OS version, and whether Outfit rendered (not a system fallback).',
    ]),

    step('E0.3', 'Run C AC 1', 'layout does not break at tablet width', [
      'Open the same build on a tablet, or an iPad/Android tablet simulator.',
      'Confirm the layout is a tablet layout, not the phone layout stretched to width.',
      'Screenshot both form factors side by side.',
    ]),

    step('E0.5', 'brief AC 3', 'hello-world round trip from a real device', [
      'With GEMINI_API_KEY set as a server-side secret (H2), submit text from the device.',
      'Confirm a model response renders on screen.',
      'Open the network log and confirm the call goes device → function → provider, with no direct client-to-provider request.',
      'Confirm no API key appears in the bundle or in any request from the device.',
      'Record the round-trip latency.',
    ]),

    step('E6.1', 'Run C AC 2', 'responses stream, with time-to-first-token measured on device', [
      'On a physical device over normal cellular — not office wifi — submit a diagnostic query.',
      'Confirm the response streams into the list rather than appearing all at once.',
      'Measure time-to-first-token and record the actual number. Target ≤ 3s.',
      'Kill the network mid-stream and confirm a recoverable error state — never a blank screen, and never a half-rendered answer presented as complete.',
    ]),

    step('E6.3', 'Run C AC 3', 'nameplate capture across 10 real photos', [
      'Collect 10 real nameplate photos: Trane Precedent and Carrier 48/50, mixed lighting and angles.',
      'Feed each through both camera capture and photo-library selection.',
      'Tabulate per photo: identified manufacturer, model, and whether it was correct. ≥ 8 of 10 must be correct.',
      'For every one of the 10 — including the correct ones — confirm the value can be corrected in ≤ 2 taps.',
      'This collection is a lead-timed human task. Start it during Run A, not at Run C kickoff.',
    ]),

    step('E6.4', 'Run C AC 4', 'the top-15 walked through the UI with zero uncited claims', [
      'Walk all 15 faults from tests/fixtures/top-15-faults.json through the app UI.',
      'For each answer, confirm every diagnostic claim carries a visible, tappable citation.',
      'Tap each citation and confirm it resolves to a document name and page number.',
      'Record any claim that rendered without a citation — each one is a Critical.',
    ]),

    step('E5.2', 'Run C AC 5', 'all three refusal categories triggered through the UI', [
      'Through the UI, ask for: a gas/combustion procedure, live electrical work, and refrigerant handling.',
      'Confirm 3 of 3 refuse.',
      'Screenshot each refusal.',
      'Confirm the refusal is visually distinct from an answer at a glance, in sunlight if you can get outside.',
      'Confirm there is no way to dismiss, collapse, retry past, or otherwise bypass it.',
    ]),

    step('E6.6', 'Run C AC 6', 'nine states captured across chat, camera, and history', [
      'Reach loading, empty, error, and offline states for each of chat, camera, and history.',
      'Screenshot each one into the stage artifact.',
      'Confirm none is a blank screen or an indefinite spinner.',
      'Offline means airplane mode on a real device, not a mocked flag.',
    ]),

    step('E6.7', 'Run C AC 7', 'text survives OS font size at 200%', [
      'Set the OS font size to maximum (200%) on a physical device.',
      'Walk chat, camera, and history.',
      'Confirm no text clips, truncates, or overlaps.',
    ]),

    step('E6.5', 'Run C AC 8', 'sessions survive a full app restart', [
      'Create a session with at least one cited answer.',
      'Force-quit the app and relaunch it.',
      'Reopen the session from history and confirm the full message and citation state is intact.',
    ]),

    step('E7.4', 'plan P1.5', 'a real commercial tech validates the guidance', [
      'Recruit a working commercial RTU service technician (H-item in SETUP-BLOCKERS.md).',
      'Have them review diagnostic output across the top-15 faults.',
      'Record their verdict per case, including every disagreement — the disagreements are the point.',
      'This is the long pole in the plan. It starts in parallel with Run A, not after it.',
    ]),
  ],
});
