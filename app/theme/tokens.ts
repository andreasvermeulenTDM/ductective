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
 * This keeps the hue (4°) and saturation (0.52) of #C0453C exactly and raises
 * lightness to the lowest value that clears 4.5:1 on refusalSurface, Ink, and
 * Steel900 at once — 5.31 / 5.49 / 4.59. It reads as the same red; it is legible.
 */
const alertRedText = '#D1746D';

/** Semantic roles. Screens use these, not `palette` directly. */
export const color = {
  background: palette.ink,
  surface: palette.steel900,
  surfaceRaised: '#1D3450',

  /**
   * Deeper than `background`, for surfaces that sit *under* the UI rather than
   * behind it: the camera viewfinder and the tablet nav rail. The mockup drew
   * these as #050B12 and #0A1421; both are here so no screen invents its own.
   */
  backgroundSunken: '#050B12',
  backgroundRail: '#0A1421',

  textPrimary: palette.mist,
  textSecondary: palette.steel400,
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

  border: '#24405E',
  borderStrong: palette.steel400,

  /** Fill and border only — never text. Use `refusalText` for words and glyphs. */
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
