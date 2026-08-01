import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { color, type, space, radius, MIN_TOUCH } from '../theme/tokens';
import { Loading, ErrorState, EmptyState } from '../components/Chrome';
import { listSessions } from '../lib/store';
import { isConfigured, CONFIG_HINT, type Session } from '../lib/supabase';

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
    <FlatList
      data={sessions}
      keyExtractor={(x) => x.id}
      contentContainerStyle={s.list}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={color.accent}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
        />
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => onOpen(item.id)}
          style={({ pressed }) => [s.row, pressed && s.rowPressed]}
          accessibilityRole="button"
          accessibilityLabel={`Open job: ${item.title}`}
        >
          <Text style={s.title} numberOfLines={2}>{item.title}</Text>
          <View style={s.meta}>
            {item.equipment && <Text style={s.equipment}>{item.equipment}</Text>}
            <Text style={s.when}>{when(item.updated_at)}</Text>
          </View>
        </Pressable>
      )}
    />
  );
}

function when(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return new Date(iso).toLocaleDateString();
}

const s = StyleSheet.create({
  list: { padding: space.lg, gap: space.md },
  row: {
    minHeight: MIN_TOUCH + 20,
    justifyContent: 'center',
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  rowPressed: { backgroundColor: color.surfaceRaised },
  title: { ...type.bodyStrong, color: color.textPrimary },
  meta: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  equipment: { ...type.caption, color: color.accent },
  when: { ...type.caption, color: color.textSecondary },
});
