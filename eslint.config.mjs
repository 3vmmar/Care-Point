import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored agent tooling, not project source. These ship as CommonJS
    // scripts and fail `no-require-imports` under this project's TypeScript
    // rules; linting somebody else's toolchain to our conventions turns CI red
    // for files we do not author and would not change.
    ".claude/**",
  ]),
]);

export default eslintConfig;
