/**
 * App.tsx — shell for the Ductective design prototype.
 *
 * Navigation is deliberately a state switch, not a router. Two tabs and an overlay
 * don't need expo-router, and Run C should pick real navigation against its own
 * brief rather than inheriting a decision made in a mockup.
 *
 * Fonts load via `useFonts` rather than the expo-font config plugin. Per the
 * SDK 57 docs the plugin is the more efficient native path, but it requires
 * `expo prebuild`; runtime loading keeps this running in Expo Go and on web,
 * which is what a design prototype needs. Run C should switch to the plugin.
 *
 * Structure follows the Run C mockup: nameplate capture is the composer's action
 * rather than a tab, because the plan treats a data plate as how you *start* a
 * question, not a place you go.
 */

import { useState } from 'react';
import { View, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  useFonts,
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from '@expo-google-fonts/outfit';

import { color, space } from './theme/tokens';
import { useLayout, SESSION_LIST_WIDTH } from './theme/layout';
import { PrototypeBanner, TabBar, NavRail, type Tab } from './components/Chrome';
import { ChatScreen } from './screens/ChatScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { CaptureScreen } from './screens/CaptureScreen';

/**
 * The shipped lockup, not a redrawn mark.
 *
 * `brand/README.txt` picks the file by size: the no-tagline horizontal lockup is
 * specified under ~160px wide, which is where a mobile header sits. Copied into
 * assets/ because Metro's project root is app/; `brand/` stays the source of truth
 * and this is a build-time copy of it.
 */
const LOCKUP = require('./assets/lockup-horizontal-notag-dark.png');
const LOCKUP_WIDTH = 140;
const LOCKUP_ASPECT = 1884 / 416;

export default function App() {
  const [fontsLoaded] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });

  const [tab, setTab] = useState<Tab>('chat');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  /** The unit the next session is about, from the capture flow. */
  const [equipment, setEquipment] = useState<string | null>(null);
  const { isTablet } = useLayout();

  function openSession(id: string) {
    setSessionId(id);
    setTab('chat');
  }

  const chat = (
    <ChatScreen
      sessionId={sessionId}
      onSession={setSessionId}
      onCapture={() => setCapturing(true)}
      equipment={equipment}
    />
  );

  const body = capturing ? (
    <CaptureScreen
      onDone={(unit) => {
        // The confirmed unit labels the next session, which is what makes a
        // history row identifiable by the job rather than by its first sentence.
        if (unit) setEquipment(unit);
        setCapturing(false);
      }}
      onCancel={() => setCapturing(false)}
    />
  ) : isTablet ? (
    // Tablet: the session list keeps its width beside the answer rather than
    // being a screen you leave the conversation to reach (E6.9).
    <View style={s.split}>
      <View style={s.sessionList}>
        <HistoryScreen onOpen={openSession} />
      </View>
      <View style={s.fill}>{chat}</View>
    </View>
  ) : tab === 'chat' ? (
    chat
  ) : (
    <HistoryScreen onOpen={openSession} />
  );

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

            <View style={s.shell}>
              {isTablet && !capturing && (
                <NavRail
                  active={tab}
                  onChange={setTab}
                  onCapture={() => setCapturing(true)}
                />
              )}

              <View style={s.fill}>
                {!isTablet && (
                  <View style={s.header}>
                    <Image
                      source={LOCKUP}
                      style={s.lockup}
                      resizeMode="contain"
                      accessibilityRole="image"
                      accessibilityLabel="Ductective"
                    />
                  </View>
                )}
                {body}
              </View>
            </View>

            {!isTablet && !capturing && (
              <TabBar
                active={tab}
                onChange={(t) => {
                  // Tapping Ask while already there starts a fresh job. Only
                  // History reopens an existing one — a tab tap shouldn't silently
                  // resurrect the last session.
                  if (t === 'chat' && tab === 'chat') { setSessionId(null); setEquipment(null); }
                  setTab(t);
                }}
              />
            )}
          </>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  fill: { flex: 1 },
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  shell: { flex: 1, flexDirection: 'row' },

  header: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  lockup: { width: LOCKUP_WIDTH, height: LOCKUP_WIDTH / LOCKUP_ASPECT },

  split: { flex: 1, flexDirection: 'row' },
  sessionList: {
    width: SESSION_LIST_WIDTH,
    borderRightWidth: 1,
    borderRightColor: color.border,
  },
});
