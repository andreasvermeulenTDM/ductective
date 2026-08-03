/**
 * layout.ts — form-factor decisions in one place.
 *
 * E6.9 requires the tablet to be a correct layout rather than a phone stretched
 * to width. That is a structural decision (does the session list stay on screen
 * beside the answer?) and it belongs next to the tokens rather than inside a
 * screen, so every screen answers it the same way.
 *
 * 768dp is the standard tablet threshold and matches the mockup's 1024x768
 * landscape frame. Below it, one pane and a bottom tab bar. At or above it, a
 * side rail plus a persistent session list.
 */

import { useWindowDimensions } from 'react-native';

export const TABLET_MIN_WIDTH = 768;

/** Widths of the two fixed columns in the tablet layout, from the mockup. */
export const RAIL_WIDTH = 96;
export const SESSION_LIST_WIDTH = 296;

export type Layout = {
  /** True at >= 768dp wide: side rail, persistent session list, side-by-side source. */
  isTablet: boolean;
  /**
   * True when the cited passage can open *beside* the claim instead of over it.
   * On a phone the source is a bottom sheet; there is no room for anything else.
   */
  canShowSourceBeside: boolean;
  width: number;
};

export function useLayout(): Layout {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_MIN_WIDTH;
  return { isTablet, canShowSourceBeside: isTablet, width };
}
