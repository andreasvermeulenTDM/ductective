/**
 * App.tsx — shell for the Ductective design prototype.
 *
 * Navigation is deliberately a state switch, not a router. Three screens don't
 * need expo-router, and Run C should pick real navigation against its own brief
 * rather than inheriting a decision made in a mockup.
 *
 * Fonts load via `useFonts` rather than the expo-font config plugin. Per the
 * SDK 57 docs the plugin is the more efficient native path, but it requires
 * `expo prebuild`; runtime loading keeps this running in Expo Go and on web,
 * which is what a design prototype needs. Run C should switch to the plugin.
 */

import { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  useFonts,
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from '@expo-google-fonts/outfit';

import { color, type, space } from './theme/tokens';
import { PrototypeBanner, TabBar, type Tab } from './components/Chrome';
import { ChatScreen } from './screens/ChatScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { CaptureScreen } from './screens/CaptureScreen';

export default function App() {
  const [fontsLoaded] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });

  const [tab, setTab] = useState<Tab>('chat');
  const [sessionId, setSessionId] = useState<string | null>(null);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        {/* Gate on fonts. Outfit is a brand requirement, and flashing a system
            font first is the parallel style CLAUDE.md warns against. */}
        {!fontsLoaded ? (
          <View style={s.boot}>
            <ActivityIndicator color={color.accent} />
          </View>
        ) : (
          <>
            <PrototypeBanner />

            <View style={s.header}>
              <Text style={s.wordmark}>
                Ductective<Text style={s.dot}>.</Text>
              </Text>
              {tab === 'chat' && (
                <Text style={s.tagline}>Light-commercial RTU diagnostics</Text>
              )}
            </View>

            <View style={s.body}>
              {tab === 'chat' && <ChatScreen sessionId={sessionId} onSession={setSessionId} />}
              {tab === 'capture' && <CaptureScreen />}
              {tab === 'history' && (
                <HistoryScreen onOpen={(id) => { setSessionId(id); setTab('chat'); }} />
              )}
            </View>

            <TabBar
              active={tab}
              onChange={(t) => {
                // Tapping Diagnose while already there starts a fresh job. Only
                // History reopens an existing one — a tab tap shouldn't silently
                // resurrect the last session.
                if (t === 'chat' && tab === 'chat') setSessionId(null);
                setTab(t);
              }}
            />
          </>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm },
  wordmark: { ...type.title, color: color.textPrimary, letterSpacing: -0.3 },
  dot: { color: color.accent },
  tagline: { ...type.caption, color: color.textSecondary, marginTop: 2 },
  body: { flex: 1 },
});
