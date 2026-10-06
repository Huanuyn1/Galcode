import { defineConfig } from "vitest/config";

// The repo's own tests live under test/. The vendored WebGAL engine
// (gitignored, present on disk after install) must never be scanned.
export default defineConfig({
  test: {
    include: ["test/**/*.test.mjs"],
    testTimeout: 60000,
    hookTimeout: 60000
  }
});
