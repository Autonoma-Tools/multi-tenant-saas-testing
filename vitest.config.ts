import { defineConfig } from "vitest/config";

// The API suite talks to a live server; the jobs suite is self-contained.
// The Playwright E2E specs live under tests/e2e and are run by Playwright, not
// Vitest, so they are excluded here.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/api/**/*.test.ts", "tests/jobs/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
