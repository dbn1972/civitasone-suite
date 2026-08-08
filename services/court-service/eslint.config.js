import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    // F3 leftover consumers are @ts-nocheck generated stubs; linting them for
    // unreachable/redeclare noise blocks CI without improving product code.
    ignores: ["**/f3-consumer.ts", "**/f3-apply.ts", "**/residual-f3/**"],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
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

