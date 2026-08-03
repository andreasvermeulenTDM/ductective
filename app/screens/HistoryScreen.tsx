import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, SectionList, StyleSheet, RefreshControl } from 'react-native';
import { color, type, space, radius, MIN_TOUCH } from '../theme/tokens';
import { Loading, ErrorState, EmptyState } from '../components/Chrome';
import { listSessions } from '../lib/store';
import { isConfigured, CONFIG_HINT, type Session } from '../lib/supabase';

/**
 * History, mockup s10.
 *
 * Rows carry the unit and what came of the job — a citation count, or a refusal
 * marker — so a session is identifiable by the work rather than by the first
 * sentence a tech happened to type. Both are derived in `listSessions`; when that
 * read falls back, the badges are simply absent rather than showing a false zero.
 */
export function HistoryScreen({ onOpen }: { onOpen: (id: string) => void }) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setSessions(await listSessions());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { if (isConfigured) load(); }, [load]);

  if (!isConfigured) return <ErrorState title="Not connected" detail={CONFIG_HINT} />;
  if (error) return <ErrorState title="Couldn't load history" detail={error} onRetry={load} />;
  if (!sessions) return <Loading label="Loading past jobs…" />;

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
        <Pressable
          onPress={() => onOpen(item.id)}
          style={({ pressed }) => [s.row, item.refused && s.rowRefused, pressed && s.rowPressed]}
          accessibilityRole="button"
          accessibilityLabel={describe(item)}
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
          </View>
        </Pressable>
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

  meta: { flexDirection: 'row', gap: space.sm, alignItems: 'center', flexWrap: 'wrap' },
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
