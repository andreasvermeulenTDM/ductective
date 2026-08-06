/**
 * Flat ESLint config — the `lint` half of S1 (.pipeline/02-user-stories.md).
 *
 *   npm run lint
 *
 * Scope note: this lints the JS/TS surface only. `tsc --noEmit` (npm run build)
 * is the type gate and is not duplicated here — type-aware linting needs a
 * project service, which is slower and adds a second way for the same error to
 * be reported. Two commands, two jobs.
 *
 * Rules that are style rather than defect are set to `warn`, not `error`, so the
 * baseline warning count in `.pipeline/03-backend.md` means something: a later
 * stage that adds one has a number to compare against, and a clean clone still
 * exits 0.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    // Never linted: vendored, generated, binary, or not ours.
    ignores: [
      '**/node_modules/**',
      'app/.expo/**',
      'app/dist/**',
      'brand/**',
      'Mockups/**',
      'HVAC Data/**',
      'ingest/sources/**',
    ],
  },

  // ---------------------------------------------------------------------------
  // Root tooling: scripts/, lib/, tests/ — plain ESM under Node.
  // ---------------------------------------------------------------------------
  {
    files: ['**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // ---------------------------------------------------------------------------
  // The Expo app: TypeScript and TSX.
  // ---------------------------------------------------------------------------
  {
    files: ['app/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      // React Native exposes the browser timer/fetch/console surface.
      globals: { ...globals.browser, ...globals.es2021 },
    },
    rules: {
      // An unused arg prefixed `_` is deliberate, not an oversight.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      /*
       * `require()` for a static asset is Metro's own mechanism, not a lapse —
       * it is how the bundler discovers an image at build time. Banning it here
       * would mean rewriting working Frontend code to satisfy a rule written for
       * server-side TypeScript.
       */
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
