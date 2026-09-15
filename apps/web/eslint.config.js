import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import jsxA11y from "eslint-plugin-jsx-a11y";

// The pinned eslint-plugin-react-hooks (Next 14.2 canary) is incompatible with
// ESLint 9 (it calls the removed context.getScope). Register inert stubs so the
// existing `react-hooks/*` disable directives resolve without crashing.
// TODO: upgrade eslint-plugin-react-hooks and enable real rules-of-hooks /
// exhaustive-deps enforcement.
const reactHooksStub = {
  rules: {
    "exhaustive-deps": { create: () => ({}) },
    "rules-of-hooks": { create: () => ({}) },
  },
};

// UX-005: jsx-a11y's recommended set is real accessibility coverage (label
// association, redundant/invalid ARIA, keyboard handlers, alt text, ...), but
// this codebase has never run it before, so its *default* "error" severity
// would fail `pnpm turbo lint` outright on every pre-existing violation --
// hundreds of them, going by the tranche-1 audit (see
// scripts/ci/jsx-a11y-ratchet-guard.mjs). That would block every unrelated web
// PR fleet-wide, which is exactly the hard-cutover this repo's other lint/guard
// rollouts (empty-vs-error-guard, raw-status-leak-guard, tenant-index-guard, …)
// deliberately avoid.
//
// So: every recommended rule stays ON (nothing is silently disabled) but at
// "warn", which does not fail `eslint`/`turbo lint` — visibility without a
// build break. The actual gate is a separate ratchet
// (scripts/ci/jsx-a11y-ratchet-guard.mjs + jsx-a11y-baseline.json, wired into
// the Typecheck & Lint CI job): it fails on any NEW (file|rule) violation not
// already in the baseline, and on stale baseline entries (fixed but left
// listed), so the backlog can only shrink from here, one real fix at a time.
const jsxA11yWarnRules = Object.fromEntries(
  Object.entries(jsxA11y.configs.recommended.rules).map(([rule, severity]) => {
    if (Array.isArray(severity)) {
      const [level, ...rest] = severity;
      return [rule, [level === "error" ? "warn" : level, ...rest]];
    }
    return [rule, severity === "error" ? "warn" : severity];
  }),
);

export default [
  {
    // Figma-exported prototype/reference scaffolding — not production code.
    ignores: ["node_modules/**", ".next/**", "dist/**", "src/figma-designs/**"],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooksStub,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...jsxA11yWarnRules,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      // F3 residual consumers intentionally use // @ts-nocheck — … descriptions.
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-nocheck": "allow-with-description", "minimumDescriptionLength": 3 },
      ],
      "no-console": "error",
      // TypeScript's compiler handles undefined variables better than ESLint
      "no-undef": "off",
    },
  },
];
