import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // We intentionally seed local form state from server data / props in effects (dialogs, settings forms).
      "react-hooks/set-state-in-effect": "off",
      // Full-page navigations to /login on logout / expired session are deliberate (they reset all client state).
      "@next/next/no-location-assign-relative-destination": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "screenshots/**",
  ]),
]);

export default eslintConfig;
