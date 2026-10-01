import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { sharedDeep } from "./config/shared-deep";

/**
 * Test config kept separate from vite.config.ts (same shape as client's) so the
 * build never inherits test settings. The `@` alias is duplicated rather than
 * shared between the two files: if it drifts, tests pass against a module the
 * build cannot resolve — which is precisely the failure
 * `client/config/shared-alias.ts` was written to end.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src"), ...sharedDeep(__dirname).alias } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
