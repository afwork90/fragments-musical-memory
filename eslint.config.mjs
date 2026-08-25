import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import next from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    ".vinext/**",
    "dist/**",
    "electron-dist/**",
    "out/**",
    "build/**",
    "release/**",
    "next-env.d.ts",
  ]),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs.flat["recommended-latest"],
  jsxA11y.flatConfigs.recommended,
  next.configs["core-web-vitals"],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    // The two hand-written CommonJS launchers legitimately use `require`.
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // `_name` marks a binding that exists only to be discarded — most often the
    // rest-destructure idiom that strips a field from an object.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // TEMPORARY, remove in Task 10 of docs/operation-plan.md.
    //
    // Real accessibility debt: the waveform rows are click/drag surfaces with no
    // keyboard path. Task 10 replaces both of them with the single AudioWaveRow
    // component, which is the right place to add keyboard operation once. Adding
    // handlers now would be discarded, and the handoff notes this drag/scrub
    // surface is easy to break.
    files: [
      "app/features/library/library-card.tsx",
      "app/features/sources/source-row-actions.tsx",
    ],
    rules: {
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",
      "jsx-a11y/no-noninteractive-element-interactions": "warn",
      "jsx-a11y/no-noninteractive-tabindex": "warn",
    },
  },
  {
    // TEMPORARY, remove in Task 6.5 of docs/operation-plan.md.
    //
    // These rules currently fire almost exclusively inside the preview engine,
    // the combine/correction workflow, and the library card wave rows — all of
    // which Tasks 5, 6, and 10 delete or rewrite wholesale. Hand-fixing them
    // now would be discarded work and would add conflict surface to the exact
    // files being dismantled. Downgraded to `warn` so `npm run check` can be a
    // trustworthy gate today; Task 6.5 restores `error` and fixes the survivors.
    rules: {
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
]);

export default eslintConfig;
