/**
 * Chrome.tsx — shared shell pieces: the prototype banner, state views, navigation.
 *
 * Two departures from the mockup, both recorded in
 * `.pipeline/04-frontend-design-pass.md`:
 *
 *  - The mockup's third tab (Settings) was omitted. **Reinstated in this run as
 *    "Account" — a deliberate reversal, recorded in ST-A10 AC 8 and in
 *    `.pipeline/04-frontend-accounts.md`.** The original reasoning was sound and
 *    has simply expired: the tab was dropped because "no Epic 6 story defines it
 *    and it has no content; an empty tab is the dead end E6.6 forbids". E9 is
 *    what finally gives it content — sign-in, profile, companies and account
 *    deletion — so the condition that justified dropping it no longer holds.
 *    It carries content in **both** auth states, which is what keeps it from
 *    becoming the dead end again: signed in it is the profile, signed out it is
 *    the sign-in screen, and neither is empty.
 *  - The header's LTE pill is not drawn. Reporting "LTE" without a network API is
 *    a decorative lie, and no netinfo dependency is justified for a design pass.
 *    `ConnectionChip` renders only once a request has actually failed on the
 *    network — the half of the state that matters on a roof (E6.6).
 */

import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ScalePressable } from './Tactile';
import { color, type, space, radius, MIN_TOUCH } from '../theme/tokens';
import { isLive } from '../lib/diagnose';
import { RAIL_WIDTH } from '../theme/layout';
import { GUEST_DISCLOSURE, SAVED_FROM_HERE, type CopyTone } from '../lib/accountCopy';

/**
 * Persistent, non-dismissible. While mockDiagnostics is the answer source, a user
 * must never be able to forget it — including future-you, six weeks from now,
 * demoing this to a technician.
 */
export function PrototypeBanner() {
  // The banner's own rule is "while mockDiagnostics is the answer source" — so
  // when the diagnose server is wired in, the text must follow. Claiming answers
  // are canned over a live refusal is the same defect class as claiming live over
  // a mock: the label lies about provenance. POC honesty: live answers are still
  // unvalidated by a technician, and the banner says so rather than going away.
  //
  // P3: after five seconds it collapses to a cyan hairline — the caveat stays
  // permanently visible as a mark without competing with the status bar all
  // session. Tap re-reads it; it re-collapses on its own. The full text never
  // leaves the accessibility tree. Static two-state styling, deliberately: the
  // JS-driver Animated tween silently no-ops on react-native-web, and a state
  // change that only works on one platform is worse than no tween at all.
  const text = isLive
    ? 'LIVE POC · answers from the knowledge base · not yet technician-validated'
    : 'DESIGN PROTOTYPE · answers are canned, citations unverified';

  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!expanded) return;
    const t = setTimeout(() => setExpanded(false), 5000);
    return () => clearTimeout(t);
  }, [expanded]);

  return (
    <Pressable
      onPress={() => setExpanded(true)}
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityHint={expanded ? undefined : 'Expands the prototype notice'}
    >
      {expanded ? (
        <View style={s.banner}>
          <Text style={s.bannerText} numberOfLines={1}>{text}</Text>
        </View>
      ) : (
        <View style={s.bannerHairline} />
      )}
    </Pressable>
  );
}


/** The unit and symptom this session is about, per mockup s4–s6. */
export function SessionHeader({
  title,
  equipment,
  offline,
}: {
  title: string;
  equipment?: string | null;
  offline?: boolean;
}) {
  return (
    <View style={s.sessionHeader}>
      <View style={s.sessionHeaderText}>
        <Text style={s.sessionUnit} numberOfLines={1}>
          {equipment ?? 'Unit not identified'}
        </Text>
        <Text style={s.sessionSymptom} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {offline && <ConnectionChip />}
    </View>
  );
}

/** Only ever rendered offline — see the note at the top of this file. */
export function ConnectionChip() {
  return (
    <View style={s.offlineChip} accessibilityRole="text" accessibilityLabel="No signal">
      <View style={s.offlineDot} />
      <Text style={s.offlineChipText}>NO SIGNAL</Text>
    </View>
  );
}

/** Offline banner, mockup s9. Says what survives and what happens next. */
export function OfflineNotice() {
  return (
    <View style={s.offlineNotice}>
      <Text style={s.offlineNoticeText}>
        <Text style={s.offlineNoticeStrong}>You're offline. </Text>
        Everything already answered stays here. Ask again when you have signal.
      </Text>
    </View>
  );
}

/**
 * A transport failure — deliberately unlike a refusal.
 *
 * Steel surface, one red glyph, and an action. A refusal is red all over and has
 * no action. E5.2 requires the two to be tellable apart at a glance, and this is
 * the other half of that pair.
 */
export function ErrorState({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail: string;
  onRetry?: () => void;
}) {
  return (
    <View style={s.center}>
      <View style={s.errorCard}>
        <View style={s.errorHead}>
          <Ionicons name="alert-circle-outline" size={26} color={color.refusalText} />
          <Text style={s.errorTitle}>{title}</Text>
        </View>
        <Text style={s.centerText}>{detail}</Text>
        {onRetry && (
          <Pressable
            onPress={onRetry}
            style={({ pressed }) => [s.button, pressed && s.buttonPressed]}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={s.buttonText}>Try again</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/**
 * `action` is optional but is the difference between an empty state and a dead
 * end. The guest History tab (ST-A06 AC 7) is exactly the case the parameter was
 * added for: an explanation with a way forward, not a locked door.
 */
export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={s.center}>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.centerText}>{detail}</Text>
      {action && (
        <Pressable
          onPress={action.onPress}
          style={({ pressed }) => [s.button, pressed && s.buttonPressed]}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Text style={s.buttonText}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * The inline sibling of `ErrorState` — same family, same steel card, but it sits
 * in the flow of a form instead of taking the whole screen.
 *
 * ST-A04 AC 5 asks sign-in failures to render "an `ErrorState`-family component",
 * and a full-screen centred card is the wrong shape under a password field.
 *
 * **Two tones, and neither of them is a refusal.** `error` takes the red glyph;
 * `notice` takes cyan, because "that email already has an account" is a routing
 * signal and painting it red teaches a technician to fear a message that is
 * simply telling them which button to press. A refusal — red all over, two-pixel
 * alert border, no action at all — is `Message.tsx`'s and only `Message.tsx`'s.
 * E5.2 depends on the two being unmistakable at arm's length.
 */
export function InlineNotice({
  tone,
  title,
  detail,
  action,
  secondary,
}: {
  tone: CopyTone;
  title: string;
  detail: string;
  action?: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
}) {
  const isError = tone === 'error';
  return (
    <View
      style={[s.notice, isError ? s.noticeError : s.noticeInfo]}
      accessibilityRole={isError ? 'alert' : 'text'}
      accessibilityLabel={`${title}. ${detail}`}
    >
      <View style={s.errorHead}>
        <Ionicons
          name={isError ? 'alert-circle-outline' : 'information-circle-outline'}
          size={22}
          color={isError ? color.refusalText : color.accent}
        />
        <Text style={s.noticeTitle}>{title}</Text>
      </View>
      <Text style={s.noticeDetail}>{detail}</Text>
      {action && (
        <Pressable
          onPress={action.onPress}
          style={({ pressed }) => [s.button, pressed && s.buttonPressed]}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Text style={s.buttonText}>{action.label}</Text>
        </Pressable>
      )}
      {secondary && (
        <Pressable
          onPress={secondary.onPress}
          style={({ pressed }) => [s.secondaryButton, pressed && s.tabPressed]}
          accessibilityRole="button"
          accessibilityLabel={secondary.label}
        >
          <Text style={s.secondaryButtonText}>{secondary.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * ST-A06 AC 6 — the guest disclosure, shown **before the first answer**.
 *
 * It lives above the composer rather than inside the empty state, for one
 * reason: an empty state is gone the moment the first question is sent, and this
 * has to still be true on the second question and the tenth. A technician who
 * scrolls past it once should not be able to forget the mode they are in.
 *
 * Alert-red border and glyph, deliberately — this is the app's other honest
 * warning, and it borrows the same colour the refusal uses for the same reason
 * (this is the thing that will cost you something). It is **not** the refusal
 * card: it has an action, it is not red all over, and it carries no safety claim.
 *
 * The wording is in `accountCopy.ts` so the "what is lost, not what is offered"
 * rule lives beside the reasoning for it rather than buried in JSX.
 */
export function GuestNotice({ onSignIn }: { onSignIn: () => void }) {
  return (
    <View style={s.guest}>
      <View style={s.guestHead}>
        <Ionicons name="cloud-offline-outline" size={18} color={color.refusalText} />
        <Text style={s.guestLabel}>{GUEST_DISCLOSURE.label}</Text>
      </View>
      <Text style={s.guestBody}>{GUEST_DISCLOSURE.body}</Text>
      <Pressable
        onPress={onSignIn}
        style={({ pressed }) => [s.secondaryButton, pressed && s.tabPressed]}
        accessibilityRole="button"
        accessibilityLabel={GUEST_DISCLOSURE.action}
      >
        <Text style={s.secondaryButtonText}>{GUEST_DISCLOSURE.action}</Text>
      </Pressable>
    </View>
  );
}

/**
 * ST-A06 AC 9 — the point in a transcript where signing in happened.
 *
 * OQ-A4 sub-decision 2 keeps the guest turns on screen and does not back-fill
 * them. That split is invisible without this: a technician would scroll up
 * tomorrow, find half the job missing, and have no way to know why. One rule and
 * one line, drawn once.
 */
export function SavedFromHere() {
  return (
    <View style={s.boundary} accessibilityRole="text" accessibilityLabel={`${SAVED_FROM_HERE.label}. ${SAVED_FROM_HERE.detail}`}>
      <View style={s.boundaryRule} />
      <Text style={s.boundaryLabel}>{SAVED_FROM_HERE.label}</Text>
      <Text style={s.boundaryDetail}>{SAVED_FROM_HERE.detail}</Text>
    </View>
  );
}

/**
 * Full-screen offline state, for camera and history — E6.6.
 *
 * Distinct from `ErrorState` on purpose. "You're offline" and "something broke"
 * send a technician to two different places, and on a roof the first is the
 * common case. It carries a retry because signal comes back.
 */
export function OfflineState({
  title,
  detail,
  onRetry,
  action,
}: {
  title: string;
  detail: string;
  onRetry?: () => void;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={s.center}>
      <View style={s.offlineCard}>
        <View style={s.errorHead}>
          <Ionicons name="cloud-offline-outline" size={26} color={color.refusalText} />
          <Text style={s.errorTitle}>{title}</Text>
        </View>
        <Text style={s.centerText}>{detail}</Text>
        {onRetry && (
          <Pressable
            onPress={onRetry}
            style={({ pressed }) => [s.button, pressed && s.buttonPressed]}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={s.buttonText}>Try again</Text>
          </Pressable>
        )}
        {action && (
          <Pressable
            onPress={action.onPress}
            style={({ pressed }) => [s.secondaryButton, pressed && s.tabPressed]}
            accessibilityRole="button"
            accessibilityLabel={action.label}
          >
            <Text style={s.secondaryButtonText}>{action.label}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/**
 * Camera permission denied — E6.3 and E6.6.
 *
 * The story's requirement is that a denied permission "routes to manual model
 * entry rather than a dead end", so the escape is the primary action here, not a
 * footnote under an apology. Opening Settings is offered second: a tech standing
 * on a roof wants to get on with the job, not fix an OS setting.
 */
export function PermissionDenied({
  onManualEntry,
  onOpenSettings,
}: {
  onManualEntry: () => void;
  onOpenSettings?: () => void;
}) {
  return (
    <View style={s.center}>
      <View style={s.errorCard}>
        <View style={s.errorHead}>
          <Ionicons name="ban-outline" size={26} color={color.refusalText} />
          <Text style={s.errorTitle}>No camera access</Text>
        </View>
        <Text style={s.centerText}>
          Ductective can't open the camera, so it can't read a data plate. You can
          still tell me the model and carry on.
        </Text>
        <Pressable
          onPress={onManualEntry}
          style={({ pressed }) => [s.button, pressed && s.buttonPressed]}
          accessibilityRole="button"
          accessibilityLabel="Type the model instead"
        >
          <Text style={s.buttonText}>Type the model instead</Text>
        </Pressable>
        {onOpenSettings && (
          <Pressable
            onPress={onOpenSettings}
            style={({ pressed }) => [s.secondaryButton, pressed && s.tabPressed]}
            accessibilityRole="button"
            accessibilityLabel="Open system settings to grant camera access"
          >
            <Text style={s.secondaryButtonText}>Grant access in Settings</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export type Tab = 'chat' | 'history' | 'account';

/**
 * Static, and it stays static.
 *
 * OQ-A4 sub-decision 1 is explicit that the History tab stays visible for a
 * guest, because hiding a tab makes the shape of the app depend on auth state —
 * a bigger change for a worse result, and one that reads as "something was taken
 * away" the moment you sign out. The Account tab follows the same rule: it is
 * there for a guest and it is there signed in, and what changes is only what is
 * inside it.
 */
const TABS: { id: Tab; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { id: 'chat', label: 'Ask', icon: 'chatbubble-ellipses-outline' as const },
  { id: 'history', label: 'History', icon: 'time-outline' as const },
  { id: 'account', label: 'Account', icon: 'person-circle-outline' as const },
];

export function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <View style={s.tabBar}>
      {TABS.map((t) => {
        const on = t.id === active;
        return (
          <ScalePressable
            key={t.id}
            onPress={() => onChange(t.id)}
            style={({ pressed }) => [s.tab, pressed && s.tabPressed]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.label}
          >
            <View style={s.tabInner}>
              <Ionicons name={t.icon} size={22} color={on ? color.accent : color.textSecondary} />
              <Text style={[s.tabText, on && s.tabOn]}>{t.label}</Text>
            </View>
          </ScalePressable>
        );
      })}
    </View>
  );
}

/** Tablet navigation: a side rail, so the session list keeps the width (E6.9). */
export function NavRail({
  active,
  onChange,
  onCapture,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
  onCapture: () => void;
}) {
  return (
    <View style={s.rail}>
      {TABS.map((t) => {
        const on = t.id === active;
        return (
          <ScalePressable
            key={t.id}
            onPress={() => onChange(t.id)}
            style={({ pressed }) => [s.railItem, on && s.railItemOn, pressed && s.tabPressed]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.label}
          >
            <View style={s.tabInner}>
              <Ionicons name={t.icon} size={22} color={on ? color.accent : color.textSecondary} />
              <Text style={[s.tabText, on && s.tabOn]}>{t.label}</Text>
            </View>
          </ScalePressable>
        );
      })}

      <ScalePressable
        onPress={onCapture}
        haptic="tap"
        style={({ pressed }) => [s.railCapture, pressed && s.buttonPressed]}
        accessibilityRole="button"
        accessibilityLabel="Photograph the nameplate"
      >
        <Ionicons name="camera-outline" size={26} color={color.textOnInteractive} />
      </ScalePressable>
    </View>
  );
}

const s = StyleSheet.create({
  bannerHairline: {
    height: 3,
    backgroundColor: color.accent,
  },
  banner: {
    backgroundColor: color.surfaceRaised,
    borderBottomWidth: 1,
    borderBottomColor: color.accent,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
  },
  bannerText: { ...type.caption, color: color.accent, textAlign: 'center', letterSpacing: 0.4 },

  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  sessionHeaderText: { flex: 1, minWidth: 0 },
  sessionUnit: { ...type.bodyStrong, color: color.textPrimary },
  sessionSymptom: { ...type.caption, color: color.textSecondary },

  offlineChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.refusalBorder,
    backgroundColor: color.refusalSurface,
  },
  offlineDot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: color.statusOffline },
  offlineChipText: { ...type.chip, color: color.statusOffline },

  offlineNotice: {
    margin: space.lg,
    marginBottom: 0,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.refusalBorder,
    backgroundColor: color.refusalSurface,
  },
  offlineNoticeText: { ...type.caption, color: color.textPrimary },
  offlineNoticeStrong: { fontFamily: type.bodyStrong.fontFamily },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  centerText: { ...type.body, color: color.textSecondary, textAlign: 'center' },
  emptyTitle: { ...type.title, color: color.textPrimary, textAlign: 'center' },

  errorCard: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  errorHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  errorGlyph: { ...type.title, color: color.refusalText },
  errorTitle: { ...type.heading, color: color.textPrimary, flex: 1 },

  offlineCard: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.refusalBorder,
    backgroundColor: color.surface,
  },
  offlineGlyph: { ...type.title, color: color.refusalText },

  /* InlineNotice — the in-flow sibling of ErrorState. Steel, never all-red. */
  notice: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    backgroundColor: color.surface,
  },
  noticeError: { borderColor: color.refusalBorder },
  noticeInfo: { borderColor: color.accentBorder },
  noticeTitle: { ...type.bodyStrong, color: color.textPrimary, flex: 1 },
  noticeDetail: { ...type.caption, color: color.textSecondary },

  /* GuestNotice — the "nothing is being saved" disclosure.
     No outer margin: it sits inside a padded ScrollView on the unit gate and
     outside one above the chat composer, so spacing belongs to the caller. */
  guest: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.refusalBorder,
    backgroundColor: color.refusalSurface,
  },
  guestHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  guestLabel: { ...type.overline, color: color.refusalText, flex: 1 },
  guestBody: { ...type.caption, color: color.textPrimary },

  /* SavedFromHere — the mid-transcript boundary marker. */
  boundary: { gap: space.xs, marginBottom: space.xl },
  boundaryRule: { height: 1, backgroundColor: color.accentBorder, marginBottom: space.sm },
  boundaryLabel: { ...type.overline, color: color.accent },
  boundaryDetail: { ...type.caption, color: color.textSecondary },

  secondaryButton: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.borderStrong,
  },
  secondaryButtonText: { ...type.bodyStrong, color: color.textPrimary },

  button: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    borderRadius: radius.lg,
    backgroundColor: color.interactiveFill,
  },
  buttonPressed: { backgroundColor: color.pressed },
  buttonText: { ...type.bodyStrong, color: color.textOnInteractive },

  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.surface,
  },
  tab: {
    flex: 1,
    minHeight: MIN_TOUCH + 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  tabPressed: { backgroundColor: color.surfaceRaised },
  tabGlyph: { ...type.heading, color: color.textSecondary },
  tabInner: { alignItems: 'center', gap: 2 },
  tabText: { ...type.chip, color: color.textSecondary },
  tabOn: { color: color.accent },

  rail: {
    width: RAIL_WIDTH,
    backgroundColor: color.backgroundRail,
    borderRightWidth: 1,
    borderRightColor: color.border,
    paddingVertical: space.xl,
    gap: space.lg,
    alignItems: 'center',
  },
  railItem: {
    width: '100%',
    minHeight: MIN_TOUCH + 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  railItemOn: {
    backgroundColor: color.accentSurface,
    borderRightWidth: 2,
    borderRightColor: color.accent,
  },
  railCapture: {
    marginTop: 'auto',
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.interactiveFill,
  },
  railCaptureGlyph: { ...type.title, color: color.textOnInteractive },
});
