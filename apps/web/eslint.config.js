import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";

// react-hooks re-enablement: the previously-pinned eslint-plugin-react-hooks
// (a Next 14.2 canary) called the ESLint-9-removed context.getScope() and was
// swapped for inert stubs so the existing `react-hooks/*` disable directives
// wouldn't crash the linter — meaning rules-of-hooks and exhaustive-deps had
// never actually run on this codebase. Upgraded to a real ESLint-9-compatible
// release (^7.1.1) and measured before deciding anything: a first fleet-wide
// run found 92 violations (50 rules-of-hooks, 42 exhaustive-deps) — too many
// to responsibly hand-fix in one pass, so both rules stay wired at "warn"
// (visible, non-blocking) below rather than "error", pending a dedicated
// follow-up. Breakdown, so that pass can be scoped instead of starting cold:
//
//  - All 50 rules-of-hooks hits are the exact same false positive: calling
//    `useResource()` (src/app/_data/useResource.ts) inside async Server
//    Component page.tsx files. It's a plain function, not a hook — its own
//    doc comment already says so — but its "use"-prefixed name trips the
//    rule's naming heuristic (rules-of-hooks has no supported way to exempt
//    one name from that check). Real fix is either a per-call-site
//    `eslint-disable-next-line` (50 sites) or renaming the export (also
//    ~50 call sites) — a deliberate choice either way, not something to
//    make unilaterally in a PR scoped to *other* correctness fixes.
//  - Of the 42 exhaustive-deps hits: ~20 are the same intentional omission
//    already documented inline at LeaveApprovalsPanel.tsx (a `formError`
//    object literal from useFormError() is recreated every render even
//    though the functions on it are individually stable) — genuinely
//    correct as-is, just never formalized as a disable directive. ~8 more
//    are a `load`/`fetchX`-named callback missing from a mount effect's
//    deps, which overlaps with the "fetch cancellation on unmount" MEDIUM
//    finding fixed elsewhere in this PR (LeaveApprovalsPanel.tsx,
//    ApplyLeaveForm.tsx) rather than being a separate class of bug. One
//    (CreateLeavePolicyForm.tsx, a stale `t` closure) was a real bug and is
//    fixed in this PR. The rest (~13: validateStep2 x2, navigate,
//    shortcuts, notifyPath, fetchPolicies, loadCampaign+loadMetrics,
//    catalog/queryFormError, loadFormError, two recruitment-page cases
//    entangled with the formError pattern above) each need individual
//    review the way exhaustive-deps always does — some may be real missing
//    deps, some may be further justified omissions.

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
      // MEASURE-FIRST: severity intentionally starts at "warn" (not "error")
      // for the initial fleet-wide run with these rules newly wired to a
      // real implementation, for the same reason as jsx-a11y above — see the
      // `react-hooks` re-enablement note atop this file for the actual
      // violation count/decision this was set from.
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/exhaustive-deps": "warn",
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
