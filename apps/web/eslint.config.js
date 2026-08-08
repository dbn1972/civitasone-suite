import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

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
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
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
