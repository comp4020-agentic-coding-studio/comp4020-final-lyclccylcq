import { defineConfig } from "vitest/config";

// Every test in spec/ runs against the running app, which spec/global-setup.ts
// finds. Only spec/ runs: a test anywhere else needs adding to `include`.
export default defineConfig({
  test: {
    include: ["spec/**/*.test.ts"],
    globalSetup: ["./spec/global-setup.ts"],
    // How long a test or hook may take overall, not how fast anything must
    // be: many tests start Chrome or a second copy of the app (startApp waits
    // up to 10 s for it), and on a busy two-core CI runner vitest's 5 s
    // default ran out before they began. Speed promises are their own
    // assertions (a change seen within 1.5 s, say) and are unchanged.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
