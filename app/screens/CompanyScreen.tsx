/**
 * CompanyScreen.tsx — ST-A10 (company screens) and ST-A18 (the privacy posture).
 *
 * Three surfaces live here because they share one promise and one error map:
 * create a company, join one with a code, and look at the one you are in.
 *
 * ---------------------------------------------------------------------------
 * Owner-only rendering is COSMETIC. It is not the enforcement.
 * ---------------------------------------------------------------------------
 * ST-A10 AC 2 says this in terms and it is repeated here because it is the
 * single easiest thing in this run to get quietly wrong. Hiding the "Remove"
 * button from a member does not stop a member removing anyone — the anon key
 * ships in the bundle, so anybody can call the same endpoint by hand. What stops
 * them is ST-A08's policies, and ST-A08's negative tests are what prove it.
 *
 * The hiding is here so a member is not offered an action that will fail. **No
 * acceptance criterion on this screen may treat a hidden control as a security
 * control**, and nothing in this file should ever be cited as isolation.
 *
 * ---------------------------------------------------------------------------
 * Zero rows is never "you are not allowed"
 * ---------------------------------------------------------------------------
 * §3.2 of the backend contract: a read refused by RLS and a read that found
 * nothing are indistinguishable, deliberately — a company must not be
 * discoverable by a stranger who guesses its uuid. So `listJoinCodes` returning
 * `[]` for a member is the normal case and renders as "no codes", never as an
 * error and never as "access denied". The UI must not try to tell the two apart,
 * because it cannot.
 */

import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { color, type, space, radius, MIN_TOUCH } from '../theme/tokens';
import { Button, Field, Section } from '../components/Form';
import { ErrorState, InlineNotice } from '../components/Chrome';
import { HistorySkeleton } from '../components/Skeleton';
import { ScalePressable } from '../components/Tactile';
import { AccountFailure, createCompany, createJoinCode, deleteCompany, listJoinCodes, listRoster, redeemJoinCode, removeMembership, revokeJoinCode, setMemberRole } from '../lib/accounts';
import { COMPANY_PRIVACY, copyForError, isSilentOutcome, type AccountCopy } from '../lib/accountCopy';
import type { Company, CompanyRole, JoinCode, RosterEntry } from '../lib/supabase';

/** Turn any thrown thing into copy. Never returns null except for `cancelled`. */
function noticeFor(e: unknown): AccountCopy | null {
  const code = e instanceof AccountFailure ? e.code : 'unknown';
  if (isSilentOutcome(code)) return null;
  return copyForError(code);
}

/**
 * ST-A18 — the promise, made to the person rather than only to the database.
 *
 * Not collapsible, not conditional, and rendered **above** the primary action on
 * every surface that uses it (AC 3). A disclosure below the button it qualifies
 * has been read by nobody.
 */
export function CompanyPrivacyNotice() {
  return (
    <View style={s.privacy}>
      <View style={s.privacyHead}>
        <Ionicons name="eye-outline" size={18} color={color.accent} />
        <Text style={s.privacyLabel}>{COMPANY_PRIVACY.label}</Text>
      </View>
      <Text style={s.privacyCan}>{COMPANY_PRIVACY.can}</Text>
      <Text style={s.privacyCannot}>{COMPANY_PRIVACY.cannot}</Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Create                                                                      */
/* -------------------------------------------------------------------------- */

export function CreateCompanyScreen({
  onCreated,
  onCancel,
}: {
  onCreated: (companyId: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<AccountCopy | null>(null);

  async function submit() {
    const clean = name.trim();
    if (clean.length < 1 || clean.length > 120) {
      setNotice(copyForError('company_name_invalid'));
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      onCreated(await createCompany(clean));
    } catch (e) {
      setNotice(noticeFor(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>Create a company</Text>
      <Text style={s.lede}>
        You will be its owner, and you can share a join code with your technicians
        afterwards.
      </Text>

      {notice && <InlineNotice tone={notice.tone} title={notice.title} detail={notice.detail} />}

      <Field
        label="Company name"
        value={name}
        onChangeText={setName}
        placeholder="Northside Mechanical"
        hint="1 to 120 characters."
        autoCapitalize="words"
        returnKeyType="go"
        onSubmitEditing={submit}
      />

      {/* Above the action, per ST-A18 AC 3. */}
      <CompanyPrivacyNotice />

      <Button label="Create company" onPress={submit} busy={busy} />
      <Button label="Cancel" variant="secondary" onPress={onCancel} />
    </ScrollView>
  );
}

/* -------------------------------------------------------------------------- */
/* Join                                                                        */
/* -------------------------------------------------------------------------- */

export function JoinCompanyScreen({
  onJoined,
  onCancel,
}: {
  onJoined: (companyId: string) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<AccountCopy | null>(null);

  async function submit() {
    const clean = code.trim();
    if (!clean) {
      setNotice(copyForError('join_code_unknown'));
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      onJoined(await redeemJoinCode(clean));
    } catch (e) {
      setNotice(noticeFor(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>Join a company</Text>
      <Text style={s.lede}>
        Type the code your shop read you. Expiry and use limits are checked on the
        server, so a code that has run out will say so rather than half-working.
      </Text>

      {notice && <InlineNotice tone={notice.tone} title={notice.title} detail={notice.detail} />}

      <Field
        label="Join code"
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        placeholder="XXXXXXXX"
        // Codes are Crockford base32 read aloud down a phone, which is why I, L,
        // O and U are not in the alphabet at all. Autocorrect would "helpfully"
        // put them back.
        hint="Eight characters or more. There is no I, L, O or U in a code."
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="go"
        onSubmitEditing={submit}
      />

      <CompanyPrivacyNotice />

      <Button label="Join company" onPress={submit} busy={busy} />
      <Button label="Cancel" variant="secondary" onPress={onCancel} />
    </ScrollView>
  );
}

/* -------------------------------------------------------------------------- */
/* The company itself                                                          */
/* -------------------------------------------------------------------------- */

export function CompanyScreen({
  company,
  role,
  membershipId,
  membershipIdByUser,
  myUserId,
  onBack,
  onChanged,
}: {
  company: Company;
  /** Your role. Drives what is *rendered*, never what is *permitted*. */
  role: CompanyRole;
  membershipId: string;
  /**
   * `user_id → membership id` for this company, from `accountsAdapter`.
   * CM-3: `public.company_roster` cannot supply it and the mutations are keyed
   * by it. A user missing from this map gets no controls rather than a control
   * that cannot work.
   */
  membershipIdByUser: Record<string, string>;
  myUserId: string;
  onBack: () => void;
  /** Membership changed under us — the hub reloads and may drop this screen. */
  onChanged: () => void;
}) {
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [codes, setCodes] = useState<JoinCode[] | null>(null);
  const [loadError, setLoadError] = useState<AccountCopy | null>(null);
  const [notice, setNotice] = useState<AccountCopy | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const isOwner = role === 'owner';

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setRoster(await listRoster(company.id));
      // Members read zero rows here **by policy**, not by a filter, and that is
      // indistinguishable from a company with no codes. Both render as "none".
      setCodes(await listJoinCodes(company.id));
    } catch (e) {
      setLoadError(noticeFor(e));
    }
  }, [company.id]);

  useEffect(() => { load(); }, [load]);

  /** One wrapper so every mutation has the same busy, error and reload path. */
  async function run(key: string, fn: () => Promise<unknown>, after: 'reload' | 'up' = 'reload') {
    if (busy) return;
    setBusy(key);
    setNotice(null);
    try {
      await fn();
      if (after === 'up') { onChanged(); onBack(); return; }
      await load();
      onChanged();
    } catch (e) {
      setNotice(noticeFor(e));
    } finally {
      setBusy(null);
    }
  }

  function confirmRemove(entry: RosterEntry, entryMembershipId: string) {
    const who = entry.display_name?.trim() || 'this technician';
    Alert.alert(
      `Remove ${who}?`,
      `They come off this company's roster straight away. Every job they have run stays theirs — nothing of their work is touched or deleted.`,
      [
        { text: 'Keep them', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => run(`remove-${entryMembershipId}`, () => removeMembership(entryMembershipId)),
        },
      ]
    );
  }

  function confirmLeave() {
    Alert.alert(
      'Leave this company?',
      'You come off the roster. Every job you have run stays yours and stays exactly where it is.',
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => run('leave', () => removeMembership(membershipId), 'up'),
        },
      ]
    );
  }

  function confirmDeleteCompany() {
    Alert.alert(
      `Delete ${company.name}?`,
      'The company, its roster and its join codes go. Nobody loses a single job — every technician keeps all of their own work. This cannot be undone.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => run('delete-company', () => deleteCompany(company.id), 'up'),
        },
      ]
    );
  }

  if (loadError) {
    return <ErrorState title={loadError.title} detail={loadError.detail} onRetry={load} />;
  }
  if (!roster) return <HistorySkeleton rows={3} />;

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <ScalePressable
        onPress={onBack}
        style={s.back}
        accessibilityRole="button"
        accessibilityLabel="Back to your account"
      >
        <Ionicons name="chevron-back" size={20} color={color.accent} />
        <Text style={s.backText}>Account</Text>
      </ScalePressable>

      <View>
        <Text style={s.title}>{company.name}</Text>
        <Text style={s.lede}>
          {[company.city, company.region].filter(Boolean).join(', ') || 'No location set'}
          {' · '}
          You are {isOwner ? 'an owner' : 'a member'}
        </Text>
      </View>

      {notice && <InlineNotice tone={notice.tone} title={notice.title} detail={notice.detail} />}

      {/* ST-A18 AC 2 — discoverable after joining, not only at the moment of it. */}
      <CompanyPrivacyNotice />

      <Section title={`ROSTER · ${roster.length}`}>
        {roster.length === 0 ? (
          <Text style={s.muted}>Nobody on the roster yet.</Text>
        ) : (
          roster.map((entry) => (
            <RosterRow
              key={entry.user_id}
              entry={entry}
              isMe={entry.user_id === myUserId}
              // Cosmetic only. ST-A08's policies are the enforcement.
              canManage={isOwner && entry.user_id !== myUserId}
              membershipId={membershipIdByUser[entry.user_id] ?? null}
              busy={busy}
              onRemove={(mid) => confirmRemove(entry, mid)}
              onRole={(mid, next) => run(`role-${mid}`, () => setMemberRole(mid, next))}
            />
          ))
        )}
      </Section>

      {isOwner && (
        <Section
          title="JOIN CODES"
          footer={
            <Text style={s.muted}>
              A code lasts 14 days and can be used ten times. Read it down the phone;
              it is never listed anywhere a technician can find it for themselves.
            </Text>
          }
        >
          {codes === null ? (
            <Text style={s.muted}>Loading codes…</Text>
          ) : codes.length === 0 ? (
            <Text style={s.muted}>No codes yet.</Text>
          ) : (
            codes.map((c) => (
              <JoinCodeRow
                key={c.id}
                code={c}
                busy={busy}
                onRevoke={(id) => run(`revoke-${id}`, () => revokeJoinCode(id))}
              />
            ))
          )}
          <Button
            label="Generate a join code"
            variant="secondary"
            icon="key-outline"
            busy={busy === 'new-code'}
            onPress={() => run('new-code', () => createJoinCode(company.id))}
          />
        </Section>
      )}

      <Section title="THIS COMPANY">
        <Button
          label="Leave this company"
          variant="secondary"
          onPress={confirmLeave}
          busy={busy === 'leave'}
          hint="You keep every job you have run"
        />
        {isOwner && (
          <Button
            label="Delete this company"
            variant="danger"
            onPress={confirmDeleteCompany}
            busy={busy === 'delete-company'}
            hint="Nobody loses any of their own work"
          />
        )}
      </Section>
    </ScrollView>
  );
}

function RosterRow({
  entry,
  isMe,
  canManage,
  membershipId,
  busy,
  onRemove,
  onRole,
}: {
  entry: RosterEntry;
  isMe: boolean;
  canManage: boolean;
  /** CM-3 — supplied by `accountsAdapter`, null when it could not be resolved. */
  membershipId: string | null;
  busy: string | null;
  onRemove: (membershipId: string) => void;
  onRole: (membershipId: string, next: CompanyRole) => void;
}) {
  const manageable = canManage && Boolean(membershipId);

  return (
    <View style={s.row}>
      <View style={s.rowText}>
        <Text style={s.rowTitle}>
          {entry.display_name?.trim() || 'Unnamed technician'}
          {isMe ? ' (you)' : ''}
        </Text>
        <Text style={s.rowMeta}>
          {entry.trade_role?.trim() || 'No trade role set'} · {entry.role}
        </Text>
      </View>

      {manageable && membershipId && (
        <View style={s.rowActions}>
          <ScalePressable
            onPress={() => onRole(membershipId, entry.role === 'owner' ? 'member' : 'owner')}
            disabled={Boolean(busy)}
            hitSlop={8}
            style={s.rowAction}
            accessibilityRole="button"
            accessibilityLabel={
              entry.role === 'owner'
                ? `Make ${entry.display_name ?? 'this technician'} a member`
                : `Make ${entry.display_name ?? 'this technician'} an owner`
            }
          >
            <Ionicons name="swap-vertical-outline" size={18} color={color.accent} />
          </ScalePressable>
          <ScalePressable
            onPress={() => onRemove(membershipId)}
            disabled={Boolean(busy)}
            hitSlop={8}
            style={s.rowAction}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${entry.display_name ?? 'this technician'} from the company`}
          >
            <Ionicons name="person-remove-outline" size={18} color={color.refusalText} />
          </ScalePressable>
        </View>
      )}
    </View>
  );
}

function JoinCodeRow({
  code,
  busy,
  onRevoke,
}: {
  code: JoinCode;
  busy: string | null;
  onRevoke: (id: string) => void;
}) {
  const dead =
    Boolean(code.revoked_at) ||
    new Date(code.expires_at).getTime() < Date.now() ||
    code.uses >= code.max_uses;

  return (
    <View style={s.row}>
      <View style={s.rowText}>
        <Text style={[s.code, dead && s.codeDead]} accessibilityLabel={`Join code ${code.code.split('').join(' ')}`}>
          {code.code}
        </Text>
        <Text style={s.rowMeta}>
          {code.revoked_at
            ? 'revoked'
            : `${code.uses} of ${code.max_uses} used · expires ${new Date(code.expires_at).toLocaleDateString()}`}
        </Text>
      </View>
      {!code.revoked_at && (
        <ScalePressable
          onPress={() => onRevoke(code.id)}
          disabled={Boolean(busy)}
          hitSlop={8}
          style={s.rowAction}
          accessibilityRole="button"
          accessibilityLabel={`Revoke join code ${code.code}`}
        >
          <Ionicons name="close-circle-outline" size={20} color={color.refusalText} />
        </ScalePressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },

  back: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: MIN_TOUCH, alignSelf: 'flex-start' },
  backText: { ...type.bodyStrong, color: color.accent },

  title: { ...type.display, color: color.textPrimary },
  lede: { ...type.body, color: color.textSecondary, marginTop: space.sm },
  muted: { ...type.caption, color: color.textSecondary },

  privacy: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.accentBorder,
    backgroundColor: color.accentSurface,
  },
  privacyHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  privacyLabel: { ...type.overline, color: color.accent, flex: 1 },
  privacyCan: { ...type.caption, color: color.textPrimary },
  privacyCannot: { ...type.caption, color: color.textPrimary },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: MIN_TOUCH + 8,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  rowText: { flex: 1, gap: space.xs },
  rowTitle: { ...type.bodyStrong, color: color.textPrimary },
  rowMeta: { ...type.caption, color: color.textSecondary },
  rowActions: { flexDirection: 'row', gap: space.sm },
  rowAction: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },

  code: { ...type.heading, color: color.accent, letterSpacing: 2 },
  codeDead: { color: color.textSecondary, textDecorationLine: 'line-through' },
});
