import { useCallback, useEffect, useState } from 'react';
import { View, Text, SectionList, StyleSheet, RefreshControl, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color, type, space, radius, MIN_TOUCH } from '../theme/tokens';
import { ErrorState, EmptyState, OfflineState } from '../components/Chrome';
import { HistorySkeleton } from '../components/Skeleton';
import { ScalePressable } from '../components/Tactile';
import { looksOffline } from '../lib/net';
import { listSessions, deleteSession } from '../lib/store';
import { GUEST_HISTORY } from '../lib/accountCopy';
import { isConfigured, CONFIG_HINT, type Session } from '../lib/supabase';

/**
 * History, mockup s10.
 *
 * Rows carry the unit and what came of the job — a citation count, or a refusal
 * marker — so a session is identifiable by the work rather than by the first
 * sentence a tech happened to type. Both are derived in `listSessions`; when that
 * read falls back, the badges are simply absent rather than showing a false zero.
 *
 * **The tab stays visible for a guest** (OQ-A4 sub-decision 1). Hiding it would
 * make the shape of the app depend on auth state, which is a bigger change for a
 * worse result. What a guest gets instead is a dedicated empty state that
 * explains why there is nothing here and offers a way forward — an explanation,
 * not a locked door, which is the distinction `Chrome.tsx`'s own reasoning and
 * E6.6 both turn on.
 */
export function HistoryScreen({
  onOpen,
  signedIn,
  onSignIn,
}: {
  /** The unit travels with the id — U1 must not re-ask for a session that has one. */
  onOpen: (id: string, equipment: string | null) => void;
  signedIn: boolean;
  onSignIn: () => void;
}) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setSessions(await listSessions());
      setOffline(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOffline(looksOffline(e));
    }
  }, []);

  // A guest's list is always empty by contract (§3.2) and `listSessions` never
  // reaches the database in that state, so there is nothing to load and nothing
  // to spin over. Skipping the call keeps the guest route's "zero Supabase calls"
  // property true from this screen as well as from the store.
  useEffect(() => { if (isConfigured && signedIn) load(); }, [load, signedIn]);

  /**
   * Delete a job, after asking.
   *
   * Deletion is irreversible and cascades to every turn and citation, so it gets a
   * destructive-styled confirm rather than an undo — an undo toast that a technician
   * walks away from is not a safety net. The row disappears optimistically because
   * the alternative is a full reload that loses the scroll position mid-list; a
   * failure puts it straight back and says so.
   */
  function confirmDelete(session: Session) {
    Alert.alert(
      'Delete this job?',
      `"${session.title}" and everything in it. This can't be undone.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const before = sessions;
            setSessions((prev) => (prev ?? []).filter((x) => x.id !== session.id));
            try {
              await deleteSession(session.id);
            } catch (e) {
              setSessions(before);
              setError(e instanceof Error ? e.message : String(e));
            }
          },
        },
      ]
    );
  }

  if (!isConfigured) return <ErrorState title="Not connected" detail={CONFIG_HINT} />;

  /**
   * ST-A06 AC 7 — the guest's History tab.
   *
   * Checked before offline and before error, because for a guest neither is
   * true: nothing was requested, so nothing failed. Reporting "can't reach your
   * history" to somebody who has no history would be a fault the app invented.
   *
   * The copy says what is *lost* rather than what is on offer — same rule as the
   * composer disclosure, same words, from `accountCopy.ts`.
   */
  if (!signedIn) {
    return (
      <EmptyState
        title={GUEST_HISTORY.title}
        detail={GUEST_HISTORY.detail}
        action={{ label: GUEST_HISTORY.action, onPress: onSignIn }}
      />
    );
  }

  // Offline before error: "no signal" and "something broke" send a technician to
  // two different places, and on a roof the first is the ordinary case (E6.6).
  if (offline) {
    return (
      <OfflineState
        title="Can't reach your history"
        detail="Past jobs live on the server, so this list needs a connection. Nothing has been lost — it'll be here when you have signal."
        onRetry={load}
      />
    );
  }
  if (error) return <ErrorState title="Couldn't load history" detail={error} onRetry={load} />;
  if (!sessions) return <HistorySkeleton />;

  if (sessions.length === 0) {
    return (
      <EmptyState
        title="No jobs yet"
        detail="Diagnostics you run will show up here, and stay put after you close the app."
      />
    );
  }

  return (
    <SectionList
      sections={groupByDay(sessions)}
      keyExtractor={(x) => x.id}
      contentContainerStyle={s.list}
      stickySectionHeadersEnabled={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={color.accent}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
        />
      }
      renderSectionHeader={({ section }) => <Text style={s.sectionLabel}>{section.title}</Text>}
      renderItem={({ item }) => (
        <ScalePressable
          onPress={() => onOpen(item.id, item.equipment ?? null)}
          onLongPress={() => confirmDelete(item)}
          delayLongPress={400}
          style={({ pressed }) => [s.row, item.refused && s.rowRefused, pressed && s.rowPressed]}
          accessibilityRole="button"
          accessibilityLabel={describe(item)}
          accessibilityHint="Long press to delete this job"
        >
          <View style={s.rowHead}>
            <Text style={s.title} numberOfLines={2}>{item.title}</Text>
            <Text style={s.when}>{clock(item.updated_at)}</Text>
          </View>

          <View style={s.meta}>
            {item.equipment && (
              <View style={s.unitBadge}>
                <Text style={s.unitBadgeText}>{item.equipment}</Text>
              </View>
            )}
            {item.refused ? (
              <Text style={s.refused}>refused</Text>
            ) : item.citationCount !== undefined && item.citationCount > 0 ? (
              <Text style={s.cited}>{item.citationCount} cited</Text>
            ) : null}

            {/* An explicit control as well as the long press. A gesture nobody is
                told about is not a feature, and gloves make long-press unreliable. */}
            <View style={s.spacer} />
            <ScalePressable
              onPress={() => confirmDelete(item)}
              hitSlop={12}
              scaleTo={0.85}
              style={s.deleteTouch}
              accessibilityRole="button"
              accessibilityLabel={`Delete job: ${item.title}`}
            >
              <Ionicons name="trash-outline" size={18} color={color.textSecondary} />
            </ScalePressable>
          </View>
        </ScalePressable>
      )}
    />
  );
}

/** Screen-reader version of the row's badges, which are visual shorthand. */
function describe(x: Session) {
  const bits = [`Open job: ${x.title}`];
  if (x.equipment) bits.push(x.equipment);
  if (x.refused) bits.push('ended in a safety refusal');
  else if (x.citationCount) bits.push(`${x.citationCount} citations`);
  return bits.join(', ');
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** TODAY / YESTERDAY / a date, per the mockup's grouping. */
function groupByDay(sessions: Session[]) {
  const today = startOfDay(new Date());
  const day = 86_400_000;

  const sections: { title: string; data: Session[] }[] = [];
  for (const x of sessions) {
    const at = startOfDay(new Date(x.updated_at));
    const title =
      at === today ? 'TODAY'
      : at === today - day ? 'YESTERDAY'
      : new Date(x.updated_at).toLocaleDateString(undefined, {
          month: 'short', day: 'numeric',
        }).toUpperCase();

    const last = sections[sections.length - 1];
    if (last && last.title === title) last.data.push(x);
    else sections.push({ title, data: [x] });
  }
  return sections;
}

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

const s = StyleSheet.create({
  list: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl },

  sectionLabel: {
    ...type.overline,
    color: color.textSecondary,
    marginTop: space.lg,
    marginBottom: space.sm,
  },

  row: {
    minHeight: MIN_TOUCH + 20,
    justifyContent: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
    marginBottom: space.sm,
  },
  rowRefused: { borderColor: color.refusalBorder },
  rowPressed: { backgroundColor: color.surfaceRaised },

  rowHead: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  title: { ...type.bodyStrong, color: color.textPrimary, flex: 1 },
  when: { ...type.caption, color: color.textSecondary },

  meta: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  spacer: { flex: 1 },
  deleteTouch: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitBadge: {
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.sm,
    backgroundColor: color.surfaceRaised,
  },
  unitBadgeText: { ...type.chip, color: color.textPrimary },
  cited: { ...type.chip, color: color.accent },
  refused: { ...type.chip, color: color.refusalText },
});
