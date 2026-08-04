# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

## Why SDK 54 and not the latest

SDK 57 is the current release and this project was on it. It was moved back to 54
deliberately, so the build runs in the Expo Go on the test iPhone — that copy tops
out at SDK 54 and the App Store offers it no update, and Expo Go supports only the
SDK it ships with.

This is a pin to a test device, not a considered platform choice. It costs three
SDK releases of React Native (0.86 → 0.81), React (19.2 → 19.1), and TypeScript
(6.0 → 5.9). Revisit it as soon as that phone can run a current Expo Go or a
development build, since a dev build is compiled against the project's own SDK and
removes the constraint entirely.
