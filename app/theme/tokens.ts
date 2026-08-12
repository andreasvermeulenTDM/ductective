/**
 * tokens.ts — the single source of colour, type, and spacing for the app.
 *
 * E6.8. Names are taken verbatim from `brand/README.txt` so a value can be traced
 * back to the logo pack without a translation step. No hardcoded hex anywhere else
 * in the app — that rule is greppable and it is meant to be grepped.
 *
 * Deliberately free of React Native imports. The Phase 3 marketing site (E14)
 * needs the same tokens, and this file should be liftable into a shared package
 * without a rewrite.
 */

/** Straight from brand/README.txt PALETTE. Do not recolour the cyan accent. */
export const palette = {
  ink: '#0C1826',
  steel900: '#16283D',
  ductBlue: '#1354BE',
  signalBlue: '#2F93F2',
  cyanRead: '#5CD0F5',
  steel400: '#7D93AB',
  steel200: '#C6D3E0',
  mist: '#EFF4F9',
  white: '#FFFFFF',

  /**
   * Not in the logo pack. Specified by Ductective-Plan-v3.md §1 and
   * .pipeline/00-brief-run-c.md as the safety-refusal colour. Recorded here with
   * its provenance so nobody assumes it came off the brand board.
   */
  alertRed: '#C0453C',
} as const;

/**
 * Alert red lightened until it clears 4.5:1 as *text*.
 *
 * `alertRed` itself is a fill-and-border colour, not a text colour. Measured on
 * the three surfaces it lands on, #C0453C runs 3.23:1 on the refusal card, 3.14:1
 * in the offline chip, and 2.96:1 as an icon on Steel900 — all under the E6.7
 * floor, and E5.2 explicitly requires refusal contrast to pass on dark. The most
 * safety-critical label in the app was the one failing.
 *
 * ST-F17 raised it again, and the reason is not cosmetic. #D1746D measured
 * **3.88:1 on `surfaceRaised`** — the pressed state of a history row, i.e. while
 * a gloved finger is on the row containing a "refused" chip. That failed the
 * floor on the *shipped* palette, before this run lifted anything
 * (`.pipeline/05-test-report.md`, ST-F16 AC 5), and lifting the surfaces one rung
 * would have made it worse. It is fixed here by moving the colour, never by
 * relaxing the check.
 *
 * Provenance unchanged: hue 4° and saturation 0.52 of #C0453C held exactly, with
 * lightness raised to the lowest value clearing **4.7:1 on the new
 * `surfaceRaised`** — the lightest backdrop this colour ever lands on, and the
 * one that binds. 4.7 rather than 4.5 so the safety label keeps a margin rather
 * than sitting on the line. Measured: 4.71 on surfaceRaised, 5.28 on the accent
 * wash, 5.57 on surface, 6.57 on background, 7.60 on the refusal card. Every one
 * of those is higher than it was before this change.
 */
const alertRedText = '#DE9B96';

/**
 * Steel400 lifted, for the same reason and by the same method.
 *
 * `textSecondary` was `palette.steel400` (#7D93AB), which measured **4.00:1 on
 * `surfaceRaised`** on the shipped palette — the second of the two pairings the
 * rebuilt contrast matrix found failing (ST-F16 AC 5). Steel400 was already thin
 * at 4.72 on the old `surface`, so it could not survive the surfaces moving up a
 * rung: it is the binding constraint on any lightening
 * (`.pipeline/02-user-stories-fixes.md` §1g), and the stories called for a
 * derived mid-tone rather than a palette swap. Steel200 (#C6D3E0) is too close to
 * `textPrimary` and collapses the hierarchy.
 *
 * So: hue 211° and saturation 0.215 of Steel400 held exactly, lightness raised
 * from 0.58 to 0.669 — the lowest value clearing 4.7:1 on the new
 * `surfaceRaised`. Measured: 4.72 on surfaceRaised, 5.28 on the accent wash,
 * 5.57 on surface, 6.58 on background. `palette.steel400` itself is untouched and
 * still carries `borderStrong`.
 */
const steelText = '#9DAEC0';

/**
 * Semantic roles. Screens use these, not `palette` directly.
 *
 * **ST-F17 — the one-step lift.** The owner's report was "the color scheme is
 * showing a little too dark", and the decision recorded against OQ-F4 was Option
 * 1: move up one rung, not invert to light. The rungs are the ones this file
 * already had — the shipped ladder steps by a consistent ~1.19 in relative
 * luminance (ink → steel900 → #1D3450 → #24405E), so "one step lighter" is
 * exactly "every surface takes the next rung", and the values below are mostly
 * values that were already here, one role further up.
 *
 *   background        ink       → steel900   (surface's old value)
 *   surface           steel900  → #1D3450    (surfaceRaised's old value)
 *   surfaceRaised     #1D3450   → #233F62    (one rung on, derived)
 *   border            #24405E   → #2A4B6F    (one rung on, so a hairline on the
 *                                             new surfaceRaised is still visible)
 *   backgroundSunken  #050B12   → ink
 *   backgroundRail    #0A1421   → ink
 *
 * `palette` is untouched — it is the brand pack verbatim — and `accent` is still
 * `palette.cyanRead`, which `brand/README.txt:31` forbids recolouring and which
 * still carries text at 8.40:1 on the new background. Only the semantic roles
 * moved. Every pairing the app actually draws is measured in
 * `tests/lib/contrastMatrix.mjs`; all 30 text pairings clear 4.5:1 after this
 * change, and the two that did not clear it before now do.
 */
export const color = {
  background: palette.steel900,
  surface: '#1D3450',
  surfaceRaised: '#233F62',

  /**
   * Deeper than `background`, for surfaces that sit *under* the UI rather than
   * behind it: the camera viewfinder and the tablet nav rail. The mockup drew
   * these as #050B12 and #0A1421 against an Ink background; with the background
   * itself now Steel900, Ink is the rung below it and is what both become.
   */
  backgroundSunken: palette.ink,
  backgroundRail: palette.ink,

  textPrimary: palette.mist,
  textSecondary: steelText,
  /** On the cyan accent — cyan is light, so this is ink. */
  textOnAccent: palette.ink,
  /** On signalBlue / ductBlue fills, which are dark enough for white. */
  textOnInteractive: palette.white,

  accent: palette.cyanRead,
  accentSurface: 'rgba(92, 208, 245, 0.10)',
  accentBorder: 'rgba(92, 208, 245, 0.30)',

  /**
   * SignalBlue is the *link* colour, not a button fill. White on #2F93F2 measures
   * 3.19:1 — fine for a 24px+ label, under the floor for the 17px button text this
   * app actually uses. Filled controls take DuctBlue (white on it is 6.91:1),
   * which also matches brand/README.txt's own roles: DuctBlue is emphasis,
   * SignalBlue is interactive/links.
   */
  interactive: palette.signalBlue,
  interactiveFill: palette.ductBlue,
  /** Darkened DuctBlue, so the pressed state stays above the contrast floor too. */
  pressed: '#0E409A',

  border: '#2A4B6F',
  borderStrong: palette.steel400,

  /**
   * Fill and border only — never text. Use `refusalText` for words and glyphs.
   *
   * These three deliberately did **not** move with the lift. The refusal card is
   * the one surface in the app whose job is to be unmistakable rather than to sit
   * in the ladder, and its identity is the 2dp alert border against a deep red
   * fill: lifting `refusalSurface` a rung tested at 2.89:1 for `refusal` on it and
   * 1.83:1 for `refusalBorder`, down from 3.42 and 2.17. Weakening the refusal
   * card to keep a surface ladder tidy is not a trade this project makes. Left
   * where it is, the card now reads a shade deeper than the page instead of a
   * shade above it, and `refusalText` on it *improved* from 5.29 to 7.60.
   */
  refusal: palette.alertRed,
  refusalText: alertRedText,
  refusalSurface: '#2A1512',
  refusalBorder: '#8E3229',

  /** Connection state in the session header. Offline borrows the refusal red. */
  statusOnline: palette.cyanRead,
  statusOffline: alertRedText,

  /** Modal scrim. Ink at 60%, so what's behind stays legible as context. */
  scrim: 'rgba(12, 24, 38, 0.6)',
} as const;

/**
 * Outfit, per brand/README.txt. Note that plan v3 §1 and .pipeline/00-brief.md
 * both still say Inter — they are stale, and CLAUDE.md makes the shipped brand
 * assets source of truth over anything inferred.
 */
export const font = {
  regular: 'Outfit_400Regular',
  medium: 'Outfit_500Medium',
  semibold: 'Outfit_600SemiBold',
  bold: 'Outfit_700Bold',
} as const;

/**
 * Read on a rooftop, in sunlight, through safety glasses. The floor is larger
 * than a typical mobile scale — 16pt is the smallest size allowed for body copy,
 * and nothing below 13 exists at all.
 */
export const type = {
  display: { fontFamily: font.bold, fontSize: 30, lineHeight: 36 },
  title: { fontFamily: font.semibold, fontSize: 22, lineHeight: 28 },
  heading: { fontFamily: font.semibold, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: font.regular, fontSize: 17, lineHeight: 26 },
  bodyStrong: { fontFamily: font.medium, fontSize: 17, lineHeight: 26 },
  label: { fontFamily: font.medium, fontSize: 15, lineHeight: 20 },
  caption: { fontFamily: font.regular, fontSize: 13, lineHeight: 18 },

  /**
   * The mockup's tracked uppercase section labels — COVERED RIGHT NOW, CHECK IN
   * THIS ORDER, WHAT I CAN STILL DO. Drawn at 12px there; held at the 13px floor
   * here. See the OPEN QUESTION in `.pipeline/04-frontend-design-pass.md`.
   */
  overline: { fontFamily: font.semibold, fontSize: 13, lineHeight: 16, letterSpacing: 1.3 },

  /** Citation chips and unit badges. Drawn at 12px; held at 13. */
  chip: { fontFamily: font.semibold, fontSize: 13, lineHeight: 16 },
} as const;

/** 4pt base. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = { sm: 6, md: 10, lg: 14, pill: 999 } as const;

/**
 * 48dp, per E6.7. This is a floor, not a target — gloved hands on a vibrating
 * rooftop miss small targets, and a mis-tap during a diagnostic is worse than a
 * slightly cramped layout.
 */
export const MIN_TOUCH = 48;

/**
 * Grow a small control's *touch* target to MIN_TOUCH without growing its ink.
 *
 * The mockup's citation chip is ~22dp tall and is the single most-tapped control
 * in the app (E6.4 makes it the verification path). Making the chip itself 48dp
 * would wreck the inline rhythm; padding the touch area instead satisfies E6.7's
 * floor, which is measured on the target rather than on the pixels.
 *
 * Pass the chip's rendered height; get back the symmetric hitSlop that reaches 48.
 */
export function touchSlop(visualHeight: number, visualWidth = visualHeight) {
  const v = Math.max(0, (MIN_TOUCH - visualHeight) / 2);
  const h = Math.max(0, (MIN_TOUCH - visualWidth) / 2);
  return { top: v, bottom: v, left: h, right: h };
}
