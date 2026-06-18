import { defineConfig, devices } from "playwright/test";

// real-browser e2e harness. the test runner ships inside the `playwright`
// dependency (imported via `playwright/test`), so no extra package is needed.
// not wired into ci.yml (vitest only there) - runs via `npm run test:e2e`
// locally and in the verify stage. requires `npx playwright install chromium`.
const BASE_URL = "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 5173",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
