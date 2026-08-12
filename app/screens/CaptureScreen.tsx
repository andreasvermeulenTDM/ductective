import { useEffect, useRef, useState } from 'react';
import {
  Animated, View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, Linking,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { launchImageLibraryAsync } from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { color, type, space, radius, MIN_TOUCH } from '../theme/tokens';
import { fireHaptic } from '../components/Tactile';
import { OfflineState, PermissionDenied } from '../components/Chrome';
import { looksOffline } from '../lib/net';
import {
  DiagnoseError, isLive, requestIdentifyUnit, requestResolveUnit, requestSuggestUnits,
} from '../lib/diagnose';
import { SUGGEST_DEBOUNCE_MS, worthSuggesting, type UnitSuggestion } from '../lib/suggest';
import {
  base64Bytes,
  confirmedUnitFrom,
  MAX_UPLOAD_BYTES,
  resizeTarget,
  splitUnitText,
  type ConfirmedUnit,
  type IdentifyResult,
  type UnitDocument,
} from '../lib/identify';

/**
 * Nameplate capture — the real thing. Mockup s2 (viewfinder) and s3
 * (confirmation), now wired to the camera and `POST /identify-unit`
 * (03-backend.md, ST-05). The owner's escalation was explicit: "I want to use
 * my camera for capturing the nameplate — not simulated."
 *
 * Module choice, per the SDK 54 docs: **expo-camera** for the capture path and
 * **expo-image-picker** for the library path. The picker alone could do both,
 * but its camera is a full-screen system modal — which would throw away the
 * corner-bracketed viewfinder this screen is designed around. `CameraView`
 * renders *inside* the frame, so the design language survives contact with the
 * hardware. The library path matters on its own: a plate photographed earlier,
 * from the ground, before climbing.
 *
 * The photo is resized on-device (expo-image-manipulator) before upload — the
 * server re-downscales to the same 1536px cap regardless (`lib/vision.mjs`),
 * so shipping a 4 MB capture over rooftop LTE buys nothing but wait.
 *
 * The design point worth keeping is the correction path. E6.3 requires that
 * *every* identification be correctable in ≤ 2 taps — including the ones that
 * were right — because a tech who can't override a wrong read gets sent down
 * the wrong unit's diagnostics. Manual entry is reachable from every state, so
 * a denied permission, a dead network, a provider block, and an unreadable
 * plate all end somewhere useful.
 *
 * Departure from the mockup, kept from the design pass: confidence renders as
 * the class word ("High confidence"), never the raw score. The wire agrees —
 * the contract sends `high | medium | low` and no decimal exists to leak.
 *
 * Response handling follows the contract's own taxonomy, and the distinctions
 * are load-bearing:
 *  - `identified: true`  → the confirmation card, with the coverage verdict.
 *  - `identified: false` → an honest "couldn't read it" *answer* (retake +
 *    manual entry), not an error — the server said so deliberately.
 *  - provider block / transport → an **error with a retry**, never rendered
 *    as an identification. A filter artifact must not read as a verdict about
 *    the technician's actual unit.
 */
type CaptureState =
  | 'idle'      // viewfinder — live camera in the frame
  | 'reading'   // loading — photo uploading / model reading
  | 'read'      // success — identified, confirmation card
  | 'failed'    // the plate came back unreadable (a deliberate answer)
  | 'offline'   // no signal to reach the vision endpoint
  | 'error'     // provider block or transport failure — retryable
  | 'manual';   // the escape hatch every failure routes to

/**
 * Re-encode quality for the upload. Nameplate text is high-contrast print;
 * 0.7 keeps stamped characters legible at roughly a third of the bytes of a
 * full-quality JPEG. The server re-encodes at its own q80 anyway
 * (`lib/vision.mjs` JPEG_QUALITY) — this knob only buys upload time.
 */
const JPEG_COMPRESS = 0.7;

const CONFIDENCE_WORD = { high: 'High', medium: 'Medium', low: 'Low' } as const;

/**
 * A way out, on every state.
 *
 * Without this the capture flow was a trap: the tab bar is hidden while
 * capturing, iOS has no hardware back, and the only exit was completing a
 * capture. A technician who tapped the camera by accident could not get back to
 * their conversation at all.
 */
/**
 * The identification's entrance — the app's one earned "magic" moment (polish
 * P2). A single spring translate+fade on mount; deliberately used nowhere else,
 * because a diagnostic tool for a roof should otherwise be calm.
 */
function ConfirmEntrance({ children }: { children: React.ReactNode }) {
  const y = useRef(new Animated.Value(24)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.spring(y, { toValue: 0, stiffness: 120, damping: 16, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [y, opacity]);
  return (
    <Animated.View style={{ transform: [{ translateY: y }], opacity }}>{children}</Animated.View>
  );
}

/**
 * The type-ahead list under the manual-entry field (ST-F11 / F3).
 *
 * Three states, and the quiet one is the point:
 *
 *  - **rows** — what the live corpus can answer on for what has been typed. Each
 *    row renders `label` exactly as the server sent it. Nothing is composed from
 *    `manufacturer` and `family` here, because a display string assembled in the
 *    app is a second place the corpus gets described and the two drift.
 *  - **in flight, nothing to show yet** — one muted line. It says a lookup is
 *    happening; it does not say a match is coming, because often there is none.
 *    Once rows are on screen they stay put through the next lookup rather than
 *    blinking out, so a list does not flicker under a finger about to tap it.
 *  - **nothing** — and this is the honest half of the story. No suggestions, an
 *    unreachable server, no server at all: all three render *nothing*. Not an
 *    error, not a retry, not "no matches found". A suggestion is a promise the
 *    corpus can answer, so the absence of one is not a failure the technician can
 *    act on — and free typing, which never needed this route, still works.
 */
function SuggestionList({
  suggestions,
  loading,
  onChoose,
}: {
  suggestions: UnitSuggestion[];
  loading: boolean;
  onChoose: (s: UnitSuggestion) => void;
}) {
  if (suggestions.length === 0) {
    return loading ? <Text style={s.suggestHint}>Looking for units I hold manuals for…</Text> : null;
  }

  return (
    <View style={s.suggestList}>
      {/* Same voice as the confirmation screen's I'LL ANSWER FROM, and the same
          claim: these rows exist because the documents behind them do. */}
      <Text style={s.overline}>I HAVE MANUALS FOR</Text>
      {suggestions.map((suggestion) => (
        <Pressable
          key={`${suggestion.manufacturer}|${suggestion.family}`}
          onPress={() => onChoose(suggestion)}
          style={({ pressed }) => [s.suggestion, pressed && s.suggestionPressed]}
          accessibilityRole="button"
          accessibilityLabel={`Use ${suggestion.manufacturer} ${suggestion.family}`}
        >
          <Text style={s.suggestionText}>{suggestion.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function CancelBar({ onCancel }: { onCancel: () => void }) {
  return (
    <View style={s.cancelBar}>
      <Pressable
        onPress={onCancel}
        style={({ pressed }) => [s.cancelButton, pressed && s.cancelPressed]}
        accessibilityRole="button"
        accessibilityLabel="Cancel and go back to the conversation"
      >
        <View style={s.cancelRow}>
          <Ionicons name="chevron-back" size={18} color={color.textSecondary} />
          <Text style={s.cancelText}>Back</Text>
        </View>
      </Pressable>
    </View>
  );
}

export function CaptureScreen({
  onDone,
  onCancel,
  initialMode = 'camera',
}: {
  /** Called with the confirmed unit — its label and its retrieval scope. */
  onDone: (unit?: ConfirmedUnit | null) => void;
  onCancel: () => void;
  /**
   * U2 — manual entry is a front door, not a fallback.
   *
   * Opening straight into the form matters for the case the story is about: a
   * plate painted over, or a camera the technician has permanently denied.
   * Routing them through a viewfinder first implies the camera is the real path
   * and typing is the consolation prize.
   */
  initialMode?: 'camera' | 'manual';
}) {
  const [state, setState] = useState<CaptureState>(initialMode === 'manual' ? 'manual' : 'idle');
  const [model, setModel] = useState('');
  /** The last wire result — the 'read' and 'failed' states render from it. */
  const [result, setResult] = useState<IdentifyResult | null>(null);
  /** The last failure — the 'error' state renders from it. */
  const [failure, setFailure] = useState<{ message: string; providerBlocked: boolean } | null>(null);

  /** True while a typed unit's coverage is being looked up. */
  const [resolving, setResolving] = useState(false);

  /**
   * Confirm a typed unit, resolving its coverage first (U4).
   *
   * The camera path gets a verdict inside `/identify-unit`; typing one used to hand
   * back `documentIds: null`, which left the session ungrounded *and* left the app
   * unable to say whether it held documentation. Resolving here fixes both, and the
   * whole model string goes to the server as both fields — `resolveUnit` matches
   * manufacturer and model independently, so "Trane YSC072E3" resolves whichever
   * half the technician happened to type first.
   *
   * A failed lookup never blocks: it falls back to exactly the old behaviour.
   */
  async function confirmTyped() {
    const typed = model.trim();
    if (!typed || resolving) return;
    setResolving(true);
    try {
      const { manufacturer, model: modelPart } = splitUnitText(typed);
      const verdict = await requestResolveUnit(manufacturer, modelPart);
      onDone({
        equipment: typed,
        documentIds: verdict?.documentIds ?? null,
        status: verdict?.status ?? null,
        coverage: (verdict?.documents ?? []).map((d: UnitDocument) => d.coverage).filter(Boolean),
      });
    } finally {
      setResolving(false);
    }
  }

  /* ---------------------------------------------------------------------- *
   * Type-ahead (ST-F11 / F3)
   * ---------------------------------------------------------------------- */

  /** The live corpus's answer for what is typed so far. `[]` means show nothing. */
  const [suggestions, setSuggestions] = useState<UnitSuggestion[]>([]);
  /** A lookup is in flight. Never an error state — see the effect below. */
  const [suggesting, setSuggesting] = useState(false);

  /**
   * Ask `/suggest-units` what the corpus has, debounced, aborting the previous ask.
   *
   * Three rules from the story shape this, and none of them is optional:
   *
   *  1. **A suggestion is a coverage claim.** So the list comes from the server,
   *     which derives it from the live `documents` table — never from a literal
   *     here, which would go stale the day a manual is added or withdrawn.
   *  2. **A failure renders nothing.** `requestSuggestUnits` resolves to `[]` for
   *     every failure there is — no server configured, unreachable, non-200,
   *     malformed, timed out, or aborted by the next keystroke — and there is
   *     deliberately no way to tell those from "nothing matched"
   *     (03-backend-fixes.md §2.4). A dead server therefore degrades to plain
   *     typing, which is what this field always was.
   *  3. **The constants are the module's**, not new literals here: the 3-character
   *     floor is `worthSuggesting`, mirroring `units.mjs`'s MIN_PREFIX, and the
   *     debounce is `SUGGEST_DEBOUNCE_MS`.
   *
   * The abort is the pattern already used for `/identify-unit` above. Because an
   * abort resolves `[]` rather than throwing, the only thing the cleanup has to
   * prevent is a stale response overwriting a newer one — hence the signal check
   * before either setState, which also covers the unmount case.
   */
  useEffect(() => {
    if (state !== 'manual') return;
    const query = model.trim();
    if (!worthSuggesting(query)) {
      setSuggestions([]);
      setSuggesting(false);
      return;
    }
    setSuggesting(true);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void requestSuggestUnits(query, controller.signal).then((rows) => {
        if (controller.signal.aborted) return;
        setSuggestions(rows);
        setSuggesting(false);
      });
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [model, state]);

  /**
   * Take a suggestion as the unit — with the server's own scope, unaltered.
   *
   * `documentIds` goes through verbatim. Re-running `/resolve-unit` on the label
   * would be a *second* derivation of "what this unit is covered by", and two
   * derivations are two answers waiting to disagree; the backend already returns
   * `classifyUnit`'s own array, so tapping a row and typing the same text by hand
   * scope retrieval identically.
   *
   * `status: 'covered'` is not a client-side coverage claim. A row only exists
   * because `suggestUnits` found the corpus can answer on it — ST-F10 AC 2 asserts
   * exactly that over the whole live manifest — so the alternative, leaving it
   * null, would make the next screen say "coverage not checked" about a unit the
   * app had just offered as covered. `coverage` is the family string as sent, for
   * the same reason: it is the manifest's own words, not a sentence composed here.
   */
  function chooseSuggestion(suggestion: UnitSuggestion) {
    if (resolving) return;
    setModel(suggestion.label);
    setSuggestions([]);
    onDone({
      equipment: suggestion.label,
      documentIds: suggestion.documentIds,
      status: 'covered',
      coverage: [suggestion.family],
    });
  }

  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const abort = useRef<AbortController | null>(null);
  /** Synchronous re-entry guard — same double-fire lesson as ChatScreen's. */
  const busy = useRef(false);

  /**
   * Ask for the camera once, on arrival. Asking again after a "deny" is the
   * OS's nag pattern, not ours — after that the in-frame button (canAskAgain)
   * or Settings (permanently denied) are the explicit paths.
   */
  const asked = useRef(false);
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain && !asked.current) {
      asked.current = true;
      requestPermission();
    }
  }, [permission, requestPermission]);

  /** The preview unmounts whenever we leave the viewfinder; its readiness must not outlive it. */
  useEffect(() => {
    if (state !== 'idle') setCameraReady(false);
  }, [state]);

  /** Classify a failure into the state that tells the technician the truth. */
  function fail(e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (err.name === 'DiagnoseCancelled') { setState('idle'); return; }
    if (looksOffline(err)) { setState('offline'); return; }
    const providerBlocked = err instanceof DiagnoseError && err.providerBlocked;
    setFailure({
      providerBlocked,
      // The DiagnoseError copy for a provider block talks about rephrasing a
      // symptom — wrong organ for a photo. Say what actually happened: the
      // provider's filter fired. It is not a reading of the plate.
      message: providerBlocked
        ? "The vision service's own filter blocked that photo. That's a filter artifact, not a reading of your plate — try again, or type the model instead."
        : err instanceof DiagnoseError ? err.userMessage : err.message,
    });
    setState('error');
  }

  /** Resize on-device, upload, and route the response to its state. */
  async function identify(uri: string, width: number, height: number) {
    if (busy.current) return;
    busy.current = true;
    setState('reading');
    const controller = new AbortController();
    abort.current = controller;
    try {
      if (!isLive) {
        // No simulated fallback, by design: pretending a model read the plate
        // is exactly what this screen just stopped doing.
        throw new DiagnoseError(
          0,
          'No diagnostic server is configured, and reading a plate needs one. Typing the model still works.'
        );
      }

      const target = resizeTarget(width, height);
      let context = ImageManipulator.manipulate(uri);
      if (target.resize) context = context.resize({ width: target.width });
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({
        format: SaveFormat.JPEG,
        compress: JPEG_COMPRESS,
        base64: true,
      });
      if (!saved.base64) throw new DiagnoseError(0, "Couldn't encode the photo for upload.");
      if (base64Bytes(saved.base64) > MAX_UPLOAD_BYTES) {
        // Post-resize this is ~50× under the cap; hitting it means something
        // upstream misbehaved. Fail here rather than burn LTE on a 413.
        throw new DiagnoseError(413, 'That photo is too large to send even after resizing.');
      }

      const res = await requestIdentifyUnit(saved.base64, controller.signal);
      setResult(res);
      // identified:false is a deliberate answer (the honest retake path), not
      // an error — the two must not share a rendering.
      if (res.identified && res.unit) void fireHaptic('success');
      setState(res.identified && res.unit ? 'read' : 'failed');
    } catch (e) {
      fail(e);
    } finally {
      abort.current = null;
      busy.current = false;
    }
  }

  async function capture() {
    const cam = cameraRef.current;
    if (!cam || !cameraReady || busy.current) return;
    try {
      void fireHaptic('shutter');
      const photo = await cam.takePictureAsync({ quality: 1 });
      await identify(photo.uri, photo.width ?? 0, photo.height ?? 0);
    } catch (e) {
      fail(e);
    }
  }

  /** The library path: a plate photographed from the ground, before climbing. */
  async function pickFromLibrary() {
    if (busy.current) return;
    try {
      const picked = await launchImageLibraryAsync({ mediaTypes: 'images', quality: 1 });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      await identify(asset.uri, asset.width ?? 0, asset.height ?? 0);
    } catch (e) {
      fail(e);
    }
  }

  if (state === 'reading') {
    return (
      <View style={s.center}>
        <ActivityIndicator color={color.accent} />
        <Text style={s.hint}>Reading the nameplate…</Text>
        <CancelBar onCancel={() => { abort.current?.abort(); onCancel(); }} />
      </View>
    );
  }

  if (state === 'offline') {
    return (
      <View style={s.fill}>
        <View style={s.cancelInset}><CancelBar onCancel={onCancel} /></View>
        <OfflineState
          title="No signal to read the plate"
          detail="Identifying a unit from a photo needs a connection. You can type the model instead and carry on — that works offline."
          onRetry={() => setState('idle')}
          action={{ label: 'Type the model instead', onPress: () => setState('manual') }}
        />
      </View>
    );
  }

  // Provider block or transport failure — an error with a retry, never an
  // identification. Distinct from 'failed', which is the server's deliberate
  // "couldn't read it" answer.
  if (state === 'error') {
    return (
      <View style={s.center}>
        <View style={s.cancelInsetCentred}><CancelBar onCancel={onCancel} /></View>
        <View style={s.errorCard}>
          <View style={s.errorHead}>
            <Text style={s.errorGlyph}>!</Text>
            <Text style={s.errorTitle}>
              {failure?.providerBlocked ? "That photo didn't get read" : "Couldn't identify the unit"}
            </Text>
          </View>
          <Text style={s.errorBody}>{failure?.message ?? 'Something went wrong on the way to the vision service.'}</Text>
          <Pressable
            onPress={() => setState('idle')}
            style={({ pressed }) => [s.primary, pressed && s.primaryPressed]}
            accessibilityRole="button"
            accessibilityLabel="Try the photo again"
          >
            <Text style={s.primaryText}>Try again</Text>
          </Pressable>
          <Pressable
            onPress={() => setState('manual')}
            style={({ pressed }) => [s.secondary, pressed && s.secondaryPressed]}
            accessibilityRole="button"
            accessibilityLabel="Type the model instead"
          >
            <Text style={s.secondaryText}>Type the model instead</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (state === 'failed') {
    return (
      <View style={s.center}>
        <View style={s.cancelInsetCentred}><CancelBar onCancel={onCancel} /></View>
        <View style={s.errorCard}>
          <View style={s.errorHead}>
            <Text style={s.errorGlyph}>!</Text>
            <Text style={s.errorTitle}>Couldn't read that plate</Text>
          </View>
          {/* The server's own re-take copy — a deliberate answer, verbatim. */}
          <Text style={s.errorBody}>
            {result?.message ??
              "The model line didn't come through clearly enough to be sure, and a guess here sends you down the wrong unit's diagnostics."}
          </Text>
          {/* A partial read surfaces honestly, but never resolves a unit. */}
          {result && (result.manufacturer || result.model) && (
            <Text style={s.partialRead}>
              Made out so far: {[result.manufacturer, result.model].filter(Boolean).join(' ')}
            </Text>
          )}
          <Pressable
            onPress={() => setState('idle')}
            style={({ pressed }) => [s.primary, pressed && s.primaryPressed]}
            accessibilityRole="button"
            accessibilityLabel="Retake the photo"
          >
            <Text style={s.primaryText}>Retake</Text>
          </Pressable>
          <Pressable
            onPress={() => setState('manual')}
            style={({ pressed }) => [s.secondary, pressed && s.secondaryPressed]}
            accessibilityRole="button"
            accessibilityLabel="Type the model instead"
          >
            <Text style={s.secondaryText}>Type the model instead</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (state === 'manual') {
    // `keyboardShouldPersistTaps` is what makes a suggestion tappable on the first
    // tap: without it the tap is consumed dismissing the keyboard, and a technician
    // in gloves reads that as the list not working.
    return (
      <ScrollView style={s.fill} contentContainerStyle={s.confirm} keyboardShouldPersistTaps="handled">
        <CancelBar onCancel={onCancel} />
        <Text style={s.overline}>TYPE THE MODEL</Text>
        <Text style={s.hint}>
          Off the data plate — manufacturer and model number. Partial is fine, I'll
          tell you if it isn't something I cover.
        </Text>

        <TextInput
          value={model}
          onChangeText={setModel}
          placeholder="e.g. Trane YSC072E3 or Carrier 50HC"
          placeholderTextColor={color.textSecondary}
          style={s.input}
          autoCapitalize="characters"
          autoCorrect={false}
          accessibilityLabel="Unit model number"
        />

        <SuggestionList
          suggestions={suggestions}
          loading={suggesting}
          onChoose={chooseSuggestion}
        />

        <View style={s.actions}>
          <Pressable
            onPress={confirmTyped}
            disabled={!model.trim() || resolving}
            style={({ pressed }) => [
              s.primary,
              pressed && s.primaryPressed,
              (!model.trim() || resolving) && s.primaryDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Use this model and continue"
            accessibilityState={{ disabled: !model.trim() || resolving }}
          >
            <Text style={s.primaryText}>{resolving ? 'Checking coverage…' : 'Use this unit'}</Text>
          </Pressable>
          <Pressable
            onPress={() => setState('idle')}
            style={({ pressed }) => [s.secondary, pressed && s.secondaryPressed]}
            accessibilityRole="button"
            accessibilityLabel="Go back to the camera"
          >
            <Text style={s.secondaryText}>Use the camera instead</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  if (state === 'read' && result?.identified && result.unit) {
    const unit = result.unit;
    return (
      <ScrollView style={s.fill} contentContainerStyle={s.confirm}>
        <CancelBar onCancel={onCancel} />
        <ConfirmEntrance>
        <Text style={s.overline}>READ FROM THE PLATE</Text>

        <View style={s.card}>
          <Text style={s.maker}>{result.manufacturer}</Text>
          <Text style={s.model}>{result.model}</Text>
          <View style={s.cardFoot}>
            <Text style={result.confidence === 'high' ? s.confidence : s.confidenceGuarded}>
              {CONFIDENCE_WORD[result.confidence]} confidence
            </Text>
            <Text style={s.docCount}>
              {unit.documents.length === 1 ? '1 document' : `${unit.documents.length} documents`}
            </Text>
          </View>
        </View>

        {unit.status === 'covered' && unit.documents.length > 0 ? (
          <>
            <Text style={s.overline}>I'LL ANSWER FROM</Text>
            <View style={s.docList}>
              {unit.documents.map((d) => (
                <View key={d.id} style={s.doc}>
                  <Text style={s.docId} numberOfLines={1}>{d.id}</Text>
                  <Text style={s.docCoverage} numberOfLines={1}>{d.coverage}</Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          // The coverage verdict, in the server's own ready-to-render words.
          // Confirming a non-covered unit is still allowed: its empty
          // documentIds scope means every question gets the honest
          // "no documentation" answer rather than another manufacturer's manual.
          <View style={s.coverageNote} accessibilityRole="alert">
            <Text style={s.coverageNoteText}>{unit.message}</Text>
          </View>
        )}

        <View style={s.actions}>
          <Pressable
            onPress={() => { const confirmed = confirmedUnitFrom(result); if (confirmed) onDone(confirmed); }}
            style={({ pressed }) => [s.primary, pressed && s.primaryPressed]}
            accessibilityRole="button"
            accessibilityLabel="Confirm this unit and continue"
          >
            <Text style={s.primaryText}>That's the unit</Text>
          </Pressable>

          {/* One tap to reach correction, from either outcome. E6.3. The read
              is prefilled so a near-miss is an edit, not a retype. */}
          <Pressable
            onPress={() => {
              setModel([result.manufacturer, result.model].filter(Boolean).join(' '));
              setState('manual');
            }}
            style={({ pressed }) => [s.secondary, pressed && s.secondaryPressed]}
            accessibilityRole="button"
            accessibilityLabel="Wrong unit, pick it myself"
          >
            <Text style={s.secondaryText}>Wrong unit, let me pick</Text>
          </Pressable>
        </View>
      </ConfirmEntrance>
      </ScrollView>
    );
  }

  // idle — the viewfinder. Permission gates what renders inside the frame; a
  // permanent denial swaps the whole screen for the manual-entry escape.
  if (permission && !permission.granted && !permission.canAskAgain) {
    return (
      <View style={s.fill}>
        <View style={s.cancelInset}><CancelBar onCancel={onCancel} /></View>
        <PermissionDenied
          onManualEntry={() => setState('manual')}
          onOpenSettings={() => Linking.openSettings()}
        />
      </View>
    );
  }

  return (
    <ScrollView style={s.sunken} contentContainerStyle={s.viewfinder}>
      <CancelBar onCancel={onCancel} />
      <View style={s.frame}>
        {permission?.granted ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            onCameraReady={() => setCameraReady(true)}
            accessibilityLabel="Camera preview — point at the unit's data plate"
          />
        ) : (
          <View style={s.permissionPrompt}>
            <Text style={s.hint}>Ductective needs the camera to read a data plate.</Text>
            <Pressable
              onPress={requestPermission}
              style={({ pressed }) => [s.secondary, pressed && s.secondaryPressed]}
              accessibilityRole="button"
              accessibilityLabel="Allow camera access"
            >
              <Text style={s.secondaryText}>Allow camera access</Text>
            </Pressable>
          </View>
        )}
        <View pointerEvents="none" style={[s.corner, s.cornerTL]} />
        <View pointerEvents="none" style={[s.corner, s.cornerTR]} />
        <View pointerEvents="none" style={[s.corner, s.cornerBL]} />
        <View pointerEvents="none" style={[s.corner, s.cornerBR]} />
        {!permission?.granted && <Text style={s.frameHint}>RTU DATA PLATE</Text>}
      </View>

      <Text style={s.hint}>Fill the frame with the plate. Glare is fine, I'll ask if I can't read it.</Text>

      <View style={s.actions}>
        <Pressable
          onPress={capture}
          disabled={!permission?.granted || !cameraReady}
          style={({ pressed }) => [
            s.primary,
            pressed && s.primaryPressed,
            (!permission?.granted || !cameraReady) && s.primaryDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Take the photo of the nameplate"
          accessibilityState={{ disabled: !permission?.granted || !cameraReady }}
        >
          <Text style={s.primaryText}>Capture the plate</Text>
        </Pressable>

        {/* A plate already in the camera roll — shot from the ground, or by
            whoever was up there last. */}
        <Pressable
          onPress={pickFromLibrary}
          style={({ pressed }) => [s.secondary, pressed && s.secondaryPressed]}
          accessibilityRole="button"
          accessibilityLabel="Choose a photo of the plate from your library"
        >
          <Text style={s.secondaryText}>Choose from photos</Text>
        </Pressable>

        {/* Always present, so a denied camera permission is never a dead end. */}
        <Pressable
          onPress={() => setState('manual')}
          style={({ pressed }) => [s.secondary, pressed && s.secondaryPressed]}
          accessibilityRole="button"
          accessibilityLabel="Enter the model number manually instead"
        >
          <Text style={s.secondaryText}>Type the model instead</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const CORNER = 42;

const s = StyleSheet.create({
  cancelBar: { alignSelf: 'flex-start', marginBottom: space.md },
  cancelInset: { paddingHorizontal: space.lg, paddingTop: space.lg },
  cancelInsetCentred: { alignSelf: 'stretch', paddingHorizontal: space.lg },
  cancelButton: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
  },
  cancelPressed: { backgroundColor: color.surface },
  cancelRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  cancelText: { ...type.label, color: color.textPrimary },

  fill: { flex: 1 },
  sunken: { flex: 1, backgroundColor: color.backgroundSunken },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: space.xl, gap: space.md },

  /**
   * These are `contentContainerStyle` on a ScrollView, not a View.
   *
   * The confirmation renders 713dp of content, which fits a 812dp phone and is
   * silently cut off on a 667dp one — the warning line just wasn't there. Without
   * a scroll container the overflow is unreachable rather than merely below the
   * fold. `flexGrow` keeps the vertical centring when content is short.
   *
   * This is also what E6.7's 200% font-size requirement needs: at that scale
   * every one of these screens overflows on every device.
   */
  viewfinder: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: space.xl,
    gap: space.lg,
  },

  frame: {
    aspectRatio: 4 / 3,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
    // Clips the live preview to the frame's radius; the brackets sit above it.
    overflow: 'hidden',
  },
  permissionPrompt: { gap: space.md, padding: space.lg, alignItems: 'center' },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: color.accent },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: radius.sm },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: radius.sm },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: radius.sm },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: radius.sm },
  frameHint: { ...type.overline, color: color.textSecondary },

  hint: { ...type.body, color: color.textPrimary, textAlign: 'center' },

  confirm: { flexGrow: 1, padding: space.lg, paddingBottom: space.xxl, gap: space.md },
  overline: { ...type.overline, color: color.textSecondary },

  card: {
    gap: space.md,
    padding: space.lg,
    borderRadius: space.xl,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  maker: { ...type.label, color: color.textSecondary },
  model: { ...type.display, color: color.textPrimary },
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  confidence: { ...type.label, color: color.accent, flex: 1 },
  /** Medium/low reads — same word treatment, without the accent's endorsement. */
  confidenceGuarded: { ...type.label, color: color.textSecondary, flex: 1 },
  docCount: { ...type.label, color: color.textSecondary },

  docList: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    overflow: 'hidden',
  },
  doc: {
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  docId: { ...type.label, color: color.textPrimary },
  docCoverage: { ...type.caption, color: color.textSecondary },

  /** The verdict for a unit that identified but isn't covered — U4's honesty. */
  coverageNote: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.accentBorder,
    backgroundColor: color.accentSurface,
  },
  coverageNoteText: { ...type.body, color: color.textPrimary },

  input: {
    minHeight: MIN_TOUCH + 8,
    ...type.body,
    color: color.textPrimary,
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    paddingHorizontal: space.lg,
  },

  /**
   * The type-ahead. Rows are `MIN_TOUCH` tall with a hairline between them rather
   * than a card each: eight cards under the field would out-weigh the field, and
   * the list is scanned, not read. Colour roles are `surface`, `border`,
   * `textPrimary` and `textSecondary` — all four already measured in
   * `tests/lib/contrastMatrix.mjs`, so no new pairing is introduced.
   */
  suggestList: {
    gap: space.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  suggestion: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
  },
  suggestionPressed: { backgroundColor: color.surfaceRaised },
  suggestionText: { ...type.bodyStrong, color: color.textPrimary },
  suggestHint: { ...type.caption, color: color.textSecondary },

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
  errorBody: { ...type.body, color: color.textSecondary },
  partialRead: { ...type.caption, color: color.textSecondary },

  actions: { gap: space.sm, marginTop: space.lg },
  primary: {
    minHeight: MIN_TOUCH + 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: color.interactiveFill,
  },
  primaryPressed: { backgroundColor: color.pressed },
  primaryDisabled: { backgroundColor: color.border },
  primaryText: { ...type.bodyStrong, color: color.textOnInteractive },
  secondary: {
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.borderStrong,
  },
  secondaryPressed: { backgroundColor: color.surface },
  secondaryText: { ...type.bodyStrong, color: color.textPrimary },
});
