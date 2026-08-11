/**
 * densityScenes.mjs — the two first-open states, declared rather than inferred.
 *
 * ST-F18 AC 2, narrowed by the owner's 10 Aug decision to **the unit-entry screen
 * only**: `app/screens/UnitGate.tsx` and the empty state in `ChatScreen.tsx` that
 * repeats it. The chat transcript and the global notice strips are out of scope
 * for this round and are not measured here.
 *
 * A scene is an explicit list of fragments because the alternative — walking the
 * component tree automatically — would silently include or exclude a branch and
 * the number would look just as authoritative either way. Every fragment says
 * which file and which render branch it is, and why it is on this screen.
 *
 * A component referenced as a self-closing tag inside another fragment (
 * `<PrototypeBanner />`, `<GuestNotice … />`) contributes nothing where it is
 * referenced and appears here as its own fragment, so nothing is double-counted.
 */

/** Cold start, guest, no unit: App.tsx:249 routes to UnitGate, not ChatScreen. */
const APP_CHROME = (bannerExpanded) => [
  {
    label: 'App shell — lockup header',
    file: 'app/App.tsx',
    fn: 'App',
    anchor: 's.header',
    why: 'the lockup header is above every screen on a phone (App.tsx:288-308)',
    state: {
      fontsLoaded: true,
      'isDetermining(auth)': false,
      isTablet: false,
      capture: false,
      // `body` stays an opaque expression: the screen itself is its own fragment.
    },
  },
  {
    label: 'PrototypeBanner',
    file: 'app/components/Chrome.tsx',
    fn: 'PrototypeBanner',
    why: 'first thing above the header; self-collapses after 5s (Chrome.tsx:56-60)',
    state: { expanded: bannerExpanded },
  },
  {
    label: 'TabBar',
    file: 'app/components/Chrome.tsx',
    fn: 'TabBar',
    why: 'below every screen on a phone (App.tsx:315)',
    state: { 'repeat.TABS': 3 },
  },
];

const GUEST_NOTICE = {
  label: 'GuestNotice',
  file: 'app/components/Chrome.tsx',
  fn: 'GuestNotice',
  why: 'rendered for a signed-out technician before the first answer (ST-A06 AC 6)',
  state: {},
};

export const SCENES = [
  {
    name: '(a) UnitGate · guest · no unit · t=0',
    note: 'cold start; the prototype banner is still expanded',
    fragments: [
      ...APP_CHROME(true),
      {
        label: 'UnitGate',
        file: 'app/screens/UnitGate.tsx',
        fn: 'UnitGate',
        why: 'the first screen a cold start lands on (App.tsx:249)',
        state: { signedIn: false, urgentOpen: false, refusal: false, needsUnit: false, error: false, checking: false },
      },
      GUEST_NOTICE,
    ],
  },
  {
    name: '(a) UnitGate · guest · no unit · t=6s',
    note: 'the prototype banner has collapsed to a hairline (Chrome.tsx:56-60)',
    fragments: [
      ...APP_CHROME(false),
      {
        label: 'UnitGate',
        file: 'app/screens/UnitGate.tsx',
        fn: 'UnitGate',
        why: 'the first screen a cold start lands on (App.tsx:249)',
        state: { signedIn: false, urgentOpen: false, refusal: false, needsUnit: false, error: false, checking: false },
      },
      GUEST_NOTICE,
    ],
  },
  {
    name: '(b) ChatScreen + EmptyAsk · unit chosen · no messages · guest · t=6s',
    note: 'the unit-entry copy repeated on the chat surface; banner collapsed',
    fragments: [
      ...APP_CHROME(false),
      {
        label: 'ChatScreen shell',
        file: 'app/screens/ChatScreen.tsx',
        fn: 'ChatScreen',
        anchor: 's.composer',
        why: 'the composer, the session header and the guest strip around the empty state',
        state: {
          isConfigured: true,
          offline: false,
          equipment: true,
          'messages.length': 0,
          loading: false,
          canShowSourceBeside: false,
          signedIn: false,
          'photos.length': 0,
          busy: false,
          attaching: false,
          input: '',
          citation: false,
          error: false,
          unanswered: false,
          justSignedIn: false,
          boundaryAt: false,
          carriedQuestion: false,
        },
      },
      {
        label: 'EmptyAsk',
        file: 'app/screens/ChatScreen.tsx',
        fn: 'EmptyAsk',
        why: 'the empty state that repeats the unit entry (ChatScreen.tsx:662)',
        state: { equipment: true, 'repeat.suggestions': 4 },
      },
      {
        label: 'CoverageLine',
        file: 'app/screens/ChatScreen.tsx',
        fn: 'CoverageLine',
        why: 'the coverage verdict inside the unit card; measured in the covered branch',
        // CoverageLine early-returns per branch; `anchor` picks the covered one.
        // `n` is `coverage.docs.length` — one manual, the shortest of the three
        // verdict phrasings, so the baseline is not flattered by the longest.
        state: { n: 1 },
        anchor: 's.coverageYes',
      },
      GUEST_NOTICE,
    ],
  },
];

/**
 * Copy that ST-F19 may not shorten — ST-F18 AC 5, and brief hard constraint 1.
 *
 * Each entry names where the words live so a later run can diff them. A density
 * reduction that touches any of these is a failure, not a win: they are the
 * disclosures and the refusal bodies, and shortening a disclosure to make a UI
 * story pass is precisely what no stage is allowed to do.
 */
export const FENCED_COPY = [
  { name: 'GUEST_DISCLOSURE', file: 'app/lib/accountCopy.ts', keys: ['label', 'body', 'action'] },
  { name: 'GUEST_HISTORY', file: 'app/lib/accountCopy.ts', keys: ['title', 'body', 'action'] },
  { name: 'SAVED_FROM_HERE', file: 'app/lib/accountCopy.ts', keys: ['label', 'detail'] },
  { name: 'COMPANY_PRIVACY', file: 'app/lib/accountCopy.ts', keys: null },
  { name: 'NO_DOCUMENTATION', file: 'lib/diagnose.mjs', keys: null },
  { name: 'UNIT_REQUIRED', file: 'lib/diagnose.mjs', keys: null },
  { name: 'refusalBody', file: 'lib/safety.mjs', keys: null },
  { name: 'CoverageLine verdicts', file: 'app/screens/ChatScreen.tsx', keys: null, lines: [762, 772, 781] },
];
