import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mjs}"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", URL: "readonly" },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["packages/engine/src/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        "Map",
        "Set",
        "WeakMap",
        "WeakSet",
        "window",
        "document",
        "fetch",
        "localStorage",
        "indexedDB",
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[regex]",
          message: "Regular expressions are forbidden in the pure engine.",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(sort|toSorted|map|filter|reduce|reduceRight|find|findIndex|findLast|findLastIndex|some|every|includes|indexOf|lastIndexOf|flat|flatMap|forEach|split|match|matchAll|search|replace|replaceAll|startsWith|endsWith|slice|splice|substring|substr|toLowerCase|toUpperCase|reverse|concat|join)$/]",
          message:
            "Implement engine operations with indexed loops and custom structures.",
        },
      ],
    },
  },
  {
    files: ["backend/supabase/functions/**/*.ts"],
    languageOptions: {
      globals: {
        Deno: "readonly",
        EdgeRuntime: "readonly",
        crypto: "readonly",
        fetch: "readonly",
        Request: "readonly",
        Response: "readonly",
        TextDecoder: "readonly",
        TextEncoder: "readonly",
      },
    },
  },
);
