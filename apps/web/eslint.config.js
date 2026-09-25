import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";

// react-hooks enforcement: the previously-pinned eslint-plugin-react-hooks
// (a Next 14.2 canary) called the ESLint-9-removed context.getScope() and was
// swapped for inert stubs so the existing `react-hooks/*` disable directives
// wouldn't crash the linter — meaning rules-of-hooks and exhaustive-deps had
// never actually run on this codebase. A prior pass (#1558) upgraded to a real
// ESLint-9-compatible release (^7.1.1), measured 92 violations (50
// rules-of-hooks, 42 exhaustive-deps), fixed one real bug, and left both rules
// at "warn" pending a dedicated follow-up. This is that follow-up — both
// rules are now "error" below. What closed the gap:
//
//  - All 50 rules-of-hooks hits were the exact same false positive: calling
//    `useResource()` (src/app/_data/useResource.ts) inside async Server
//    Component page.tsx files. It was a plain function, not a hook — its own
//    doc comment already said so — but its "use"-prefixed name tripped the
//    rule's naming heuristic. Fixed at the root by renaming the export to
//    `toResourceState` (and updating its ~50 call sites) instead of 50
//    per-site suppressions, since the naming was simply wrong, not a case
//    that needed an exemption.
//  - Of the 42 exhaustive-deps hits: ~23 (across differently-named
//    `useFormError()` instances — `formError`, `catalogFormError`,
//    `queryFormError`, `loadFormError`, ...) are the same intentional
//    omission already documented inline at LeaveApprovalsPanel.tsx: the
//    object literal `useFormError()` returns is recreated every render, but
//    its `fromResponse`/`fromException`/`clear` methods are individually
//    stable (useCallback'd on a fixed `area` string), and every one of these
//    sites was individually verified to only call those stable methods, never
//    the object's live `message`/`fieldErrors`/`fieldError()` state — now
//    formalized as `eslint-disable-next-line` directives instead of just a
//    comment. ~10 more (`load`, `fetchPolicies`, `loadCampaign`+`loadMetrics`)
//    are a per-render helper function whose only free variables were already
//    individually listed in the same hook's own deps array, so the helper
//    itself can't go stale. `validateStep2` (x2), `navigate`/`shortcuts`
//    (closing only over the stable Next.js `router`), and `notifyPath`
//    (always a pure function of the already-tracked entity id) round out the
//    remaining safe omissions — each verified individually, not assumed from
//    the pattern. Two recruitment-page sites (applications/[appId]/page.tsx,
//    [id]/page.tsx) were real bugs: the exact same stale-`t`-closure class as
//    the one CreateLeavePolicyForm.tsx already fixed (a next-intl `t` used
//    inside a callback/effect but missing from its deps, so a locale switch
//    would freeze that one message in the old language) — fixed by adding
//    `t` to their deps arrays.

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
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...jsxA11yWarnRules,
      // Both fully enforced as of the react-hooks follow-up — see the
      // `react-hooks enforcement` note atop this file for how the fleet-wide
      // backlog was closed to zero before flipping these to "error".
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
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
