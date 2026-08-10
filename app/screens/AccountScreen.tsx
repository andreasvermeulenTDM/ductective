/**
 * AccountScreen.tsx — ST-A11 (profile), ST-A10's entry points, ST-A12 (deletion).
 *
 * The hub the reinstated Account tab lands on when somebody is signed in. A guest
 * never reaches it: the shell renders `SignInScreen` for the same tab, so company
 * and deletion surfaces are not merely hidden, they are not mounted (ST-A10 AC 6,
 * ST-A12 AC 10).
 *
 * ---------------------------------------------------------------------------
 * A technician with no company sees no company (brief AC 5, ST-A11 AC 6)
 * ---------------------------------------------------------------------------
 * There is no empty company card, no placeholder, no "set up your company to
 * continue", and nothing on this screen or any other is gated behind
 * `active_company_id`. What a company-less technician sees is a short line saying
 * a company is optional and two actions they may ignore forever.
 *
 * That reading is deliberate and is recorded as an OPEN QUESTION in
 * `.pipeline/04-frontend-accounts.md`: ST-A11 AC 6 says "no company section" and
 * ST-A10 AC 1 requires the create and join screens to exist, while ST-A10 AC 7
 * requires only that nothing routes into them *by force*. Offering two actions
 * with the optionality stated is the reading that satisfies all three. A screen
 * with no route to creating a company would fail ST-A10 outright.
 *
 * ---------------------------------------------------------------------------
 * Deletion asks for a typed word
 * ---------------------------------------------------------------------------
 * ST-A12 AC 9 wants "a typed confirmation or equivalent deliberate act". A second
 * tap is not deliberate — it is the same gesture in the same place, and a gloved
 * thumb produces it by accident. Six typed characters cannot happen by accident.
 *
 * On `sole_owner_of_company` **nothing has been deleted** — the RPC is atomic —
 * and the error carries the company id in `detail`, so the screen offers the two
 * paths the technician can finish alone: promote somebody, or delete the company.
 * Both are on the company screen, and this routes straight to it.
 */

import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { color, type, space, radius, MIN_TOUCH } from '../theme/tokens';
import { Button, Field, Section } from '../components/Form';
import { ErrorState, InlineNotice } from '../components/Chrome';
import { HistorySkeleton } from '../components/Skeleton';
import { ScalePressable } from '../components/Tactile';
import { AccountFailure, deleteMyAccount, setActiveCompany, updateMyProfile } from '../lib/accounts';
import { linkedProviders, signOut } from '../lib/auth';
import { membershipIds, mine, myProfile, readableMemberships, type MembershipRow } from '../lib/accountsAdapter';
import {
  COMPANY_OPTIONAL,
  DELETE_ACCOUNT,
  PRIVATE_RELAY_NOTE,
  copyForError,
  isSilentOutcome,
  type AccountCopy,
} from '../lib/accountCopy';
import { CompanyScreen, CreateCompanyScreen, JoinCompanyScreen } from './CompanyScreen';
import type { Profile } from '../lib/supabase';

function noticeFor(e: unknown): AccountCopy | null {
  const code = e instanceof AccountFailure ? e.code : 'unknown';
  if (isSilentOutcome(code)) return null;
  return copyForError(code);
}

const PROVIDER_LABEL: Record<string, string> = {
  email: 'Email and password',
  apple: 'Apple',
  google: 'Google',
};

type Panel =
  | { name: 'hub' }
  | { name: 'company'; companyId: string }
  | { name: 'create' }
  | { name: 'join' }
  | { name: 'delete' };

export function AccountScreen({ userId, email }: { userId: string; email: string | null }) {
  const [panel, setPanel] = useState<Panel>({ name: 'hub' });

  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<MembershipRow[] | null>(null);
  const [allRows, setAllRows] = useState<MembershipRow[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<AccountCopy | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const rows = await readableMemberships();
      setAllRows(rows);
      setMemberships(mine(rows, userId));
      setProfile(await myProfile(userId));
      setProviders(await linkedProviders());
    } catch (e) {
      setLoadError(noticeFor(e));
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  if (loadError) {
    return <ErrorState title={loadError.title} detail={loadError.detail} onRetry={load} />;
  }
  if (!memberships) return <HistorySkeleton rows={3} />;

  if (panel.name === 'create') {
    return (
      <CreateCompanyScreen
        onCancel={() => setPanel({ name: 'hub' })}
        onCreated={async (id) => { await load(); setPanel({ name: 'company', companyId: id }); }}
      />
    );
  }

  if (panel.name === 'join') {
    return (
      <JoinCompanyScreen
        onCancel={() => setPanel({ name: 'hub' })}
        onJoined={async (id) => { await load(); setPanel({ name: 'company', companyId: id }); }}
      />
    );
  }

  if (panel.name === 'company') {
    const row = memberships.find((m) => m.company_id === panel.companyId);
    // The membership can vanish under us — an owner removed you while the screen
    // was open, or you just left. Falling back to the hub is the honest result;
    // an error would imply something broke.
    if (!row) return <Hub />;
    return (
      <CompanyScreen
        company={row.company}
        role={row.role}
        membershipId={row.id}
        membershipIdByUser={membershipIds(allRows, row.company_id)}
        myUserId={userId}
        onBack={() => setPanel({ name: 'hub' })}
        onChanged={load}
      />
    );
  }

  if (panel.name === 'delete') {
    return (
      <DeleteAccountView
        onCancel={() => setPanel({ name: 'hub' })}
        onSoleOwner={(companyId) => setPanel({ name: 'company', companyId })}
        hasCompany={memberships.length > 0}
      />
    );
  }

  return <Hub />;

  function Hub() {
    return (
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View>
          <Text style={s.title}>Your account</Text>
          <Text style={s.lede}>{email ?? 'Signed in'}</Text>
        </View>

        <ProfileSection profile={profile} onSaved={setProfile} />

        <CompaniesSection
          memberships={memberships!}
          activeCompanyId={profile?.active_company_id ?? null}
          onOpen={(companyId) => setPanel({ name: 'company', companyId })}
          onCreate={() => setPanel({ name: 'create' })}
          onJoin={() => setPanel({ name: 'join' })}
          onActive={async (id) => { await setActiveCompany(id); await load(); }}
        />

        <SignInMethodsSection providers={providers} />

        <Section title="SESSION">
          <Button
            label="Sign out"
            variant="secondary"
            icon="log-out-outline"
            onPress={() => {
              Alert.alert(
                'Sign out?',
                'Your jobs stay on your account. Anything you ask after this is not saved until you sign back in.',
                [
                  { text: 'Stay signed in', style: 'cancel' },
                  { text: 'Sign out', style: 'destructive', onPress: () => { void signOut(); } },
                ]
              );
            }}
          />
        </Section>

        <Section title="DANGER">
          <Button
            label={DELETE_ACCOUNT.title}
            variant="danger"
            icon="trash-outline"
            onPress={() => setPanel({ name: 'delete' })}
            hint="Permanently removes your account and every job in it"
          />
        </Section>
      </ScrollView>
    );
  }
}

/* -------------------------------------------------------------------------- */

function ProfileSection({
  profile,
  onSaved,
}: {
  profile: Profile | null;
  onSaved: (p: Profile) => void;
}) {
  const [name, setName] = useState(profile?.display_name ?? '');
  const [role, setRole] = useState(profile?.trade_role ?? '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<AccountCopy | null>(null);
  const [saved, setSaved] = useState(false);

  /**
   * 1–60 characters, checked here **and** by a `check` constraint in `sql/010`
   * (ST-A11 AC 2). This one is a courtesy so the technician is told before a
   * round trip; the constraint is the rule. If they ever disagree, the constraint
   * is right.
   */
  const trimmed = name.trim();
  const nameError =
    trimmed.length > 60 ? 'That is longer than 60 characters.' : null;

  async function save() {
    if (busy || nameError) return;
    setBusy(true);
    setNotice(null);
    setSaved(false);
    try {
      onSaved(await updateMyProfile({
        display_name: trimmed.length ? trimmed : null,
        trade_role: role.trim().length ? role.trim() : null,
      }));
      setSaved(true);
    } catch (e) {
      setNotice(noticeFor(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="YOU">
      {profile === null ? (
        // §3.2: unreachable in principle — the sql/010 trigger provisions the row
        // — so this is an empty state rather than a crash if it ever happens.
        <Text style={s.muted}>
          No profile row came back. Your jobs are unaffected; saving a name below
          will not work until this resolves.
        </Text>
      ) : null}

      {notice && <InlineNotice tone={notice.tone} title={notice.title} detail={notice.detail} />}
      {saved && !notice ? <Text style={s.saved}>Saved.</Text> : null}

      <Field
        label="Display name"
        value={name}
        onChangeText={(t) => { setName(t); setSaved(false); }}
        placeholder="Dave Mitchell"
        hint="What your shop's roster shows instead of a uuid. Up to 60 characters."
        error={nameError}
        autoCapitalize="words"
      />
      <Field
        label="Trade role"
        value={role}
        onChangeText={(t) => { setRole(t); setSaved(false); }}
        placeholder="Service Technician"
        hint="Free text — whatever you actually call the job."
        autoCapitalize="words"
      />
      <Button label="Save" onPress={save} busy={busy} disabled={Boolean(nameError)} />
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

function CompaniesSection({
  memberships,
  activeCompanyId,
  onOpen,
  onCreate,
  onJoin,
  onActive,
}: {
  memberships: MembershipRow[];
  activeCompanyId: string | null;
  onOpen: (companyId: string) => void;
  onCreate: () => void;
  onJoin: () => void;
  onActive: (companyId: string) => void;
}) {
  /**
   * OQ-A5: the data model permits many memberships, the app uses one at a time,
   * and **a technician with one company sees no switcher at all** — the common
   * case pays nothing for the uncommon one.
   */
  const showSwitcher = memberships.length > 1;

  return (
    <Section title="COMPANIES">
      {memberships.length === 0 ? (
        // No card, no placeholder, no prompt. One sentence and two doors.
        <Text style={s.muted}>{COMPANY_OPTIONAL}</Text>
      ) : (
        memberships.map((m) => (
          <View key={m.id} style={s.row}>
            <ScalePressable
              onPress={() => onOpen(m.company_id)}
              style={s.rowMain}
              accessibilityRole="button"
              accessibilityLabel={`Open ${m.company.name}, where you are ${m.role === 'owner' ? 'an owner' : 'a member'}`}
            >
              <Text style={s.rowTitle}>{m.company.name}</Text>
              <Text style={s.rowMeta}>
                {m.role === 'owner' ? 'Owner' : 'Member'}
                {activeCompanyId === m.company_id ? ' · new jobs are stamped with this one' : ''}
              </Text>
            </ScalePressable>
            {showSwitcher && activeCompanyId !== m.company_id && (
              <ScalePressable
                onPress={() => onActive(m.company_id)}
                hitSlop={8}
                style={s.rowAction}
                accessibilityRole="button"
                accessibilityLabel={`Work under ${m.company.name} from now on`}
              >
                <Ionicons name="radio-button-off-outline" size={22} color={color.textSecondary} />
              </ScalePressable>
            )}
            {showSwitcher && activeCompanyId === m.company_id && (
              <View style={s.rowAction} accessibilityRole="text" accessibilityLabel="Currently working under this company">
                <Ionicons name="radio-button-on" size={22} color={color.accent} />
              </View>
            )}
          </View>
        ))
      )}

      <Button label="Create a company" variant="secondary" icon="business-outline" onPress={onCreate} />
      <Button label="Join with a code" variant="secondary" icon="key-outline" onPress={onJoin} />
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

function SignInMethodsSection({ providers }: { providers: string[] }) {
  return (
    <Section title="HOW YOU SIGN IN">
      {providers.length === 0 ? (
        <Text style={s.muted}>Couldn't read your sign-in methods just now.</Text>
      ) : (
        providers.map((p) => (
          <View key={p} style={s.row}>
            <Text style={s.rowTitle}>{PROVIDER_LABEL[p] ?? p}</Text>
          </View>
        ))
      )}

      {/*
        ST-A11 AC 4, honestly. Apple Private Relay means some technicians WILL end
        up with two accounts and nothing the app does can join them, so it says so
        rather than letting somebody hunt for history that is sitting under
        another identity.

        The linking *action* is BLOCKED ON BACKEND and is recorded as such in
        `.pipeline/04-frontend-accounts.md`: `lib/auth.ts` exposes
        `linkedProviders()` to read this list but no function to add one, and
        writing a second OAuth round trip inside a screen would be the parallel
        auth path Stage 3 explicitly told Stage 4 not to build. A button that
        cannot work is worse than an honest sentence, so there is no button.
      */}
      <Text style={s.muted}>{PRIVATE_RELAY_NOTE}</Text>
      <Text style={s.muted}>
        Linking another method to this account is not in this build yet. Until it
        is, signing in with a different method makes a separate account rather than
        joining this one.
      </Text>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

function DeleteAccountView({
  onCancel,
  onSoleOwner,
  hasCompany,
}: {
  onCancel: () => void;
  onSoleOwner: (companyId: string) => void;
  hasCompany: boolean;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<AccountCopy | null>(null);
  const [soleOwnerOf, setSoleOwnerOf] = useState<string | null>(null);

  const armed = typed.trim().toUpperCase() === DELETE_ACCOUNT.confirmWord;

  async function submit() {
    if (!armed || busy) return;
    setBusy(true);
    setNotice(null);
    setSoleOwnerOf(null);
    try {
      await deleteMyAccount();
      // Success ends with the session gone; the shell's auth subscription drops
      // the app back to the guest state on its own. Nothing to navigate here.
    } catch (e) {
      if (e instanceof AccountFailure && e.code === 'sole_owner_of_company') {
        // Atomic: nothing was deleted. `detail` names the company so the two
        // paths the technician can finish alone are one tap away.
        setSoleOwnerOf(e.detail);
      }
      setNotice(noticeFor(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      <ScalePressable
        onPress={onCancel}
        style={s.back}
        accessibilityRole="button"
        accessibilityLabel="Back to your account, without deleting anything"
      >
        <Ionicons name="chevron-back" size={20} color={color.accent} />
        <Text style={s.backText}>Account</Text>
      </ScalePressable>

      <Text style={s.title}>{DELETE_ACCOUNT.title}</Text>

      <View style={s.destructive}>
        <Text style={s.destructiveBody}>{DELETE_ACCOUNT.what}</Text>
        <Text style={s.destructiveStrong}>{DELETE_ACCOUNT.irreversible}</Text>
        {hasCompany ? (
          <Text style={s.destructiveBody}>
            Any company you are only a member of carries on without you. If you are
            its only owner and somebody else is still in it, nothing will be deleted
            and you will be sent back to sort that out first.
          </Text>
        ) : null}
      </View>

      {notice && (
        <InlineNotice
          tone={notice.tone}
          title={notice.title}
          detail={notice.detail}
          action={
            soleOwnerOf
              ? { label: 'Open that company', onPress: () => onSoleOwner(soleOwnerOf) }
              : undefined
          }
        />
      )}

      <Field
        label={DELETE_ACCOUNT.confirmPrompt}
        value={typed}
        onChangeText={setTyped}
        placeholder={DELETE_ACCOUNT.confirmWord}
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
      />

      <Button
        label={DELETE_ACCOUNT.action}
        variant="danger"
        onPress={submit}
        busy={busy}
        disabled={!armed}
        hint={armed ? 'This cannot be undone' : `Type ${DELETE_ACCOUNT.confirmWord} first`}
      />
      <Button label="Keep my account" variant="secondary" onPress={onCancel} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },

  back: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: MIN_TOUCH, alignSelf: 'flex-start' },
  backText: { ...type.bodyStrong, color: color.accent },

  title: { ...type.display, color: color.textPrimary },
  lede: { ...type.body, color: color.textSecondary, marginTop: space.sm },
  muted: { ...type.caption, color: color.textSecondary },
  saved: { ...type.caption, color: color.accent },

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
  rowMain: { flex: 1, gap: space.xs, justifyContent: 'center', minHeight: MIN_TOUCH },
  rowTitle: { ...type.bodyStrong, color: color.textPrimary },
  rowMeta: { ...type.caption, color: color.textSecondary },
  rowAction: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },

  destructive: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.refusalBorder,
    backgroundColor: color.surface,
  },
  destructiveBody: { ...type.body, color: color.textPrimary },
  destructiveStrong: { ...type.bodyStrong, color: color.refusalText },
});
