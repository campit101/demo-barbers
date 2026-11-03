import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against a production build using the TEST database from .env.local. Mail is never sent.
const port = Number(process.env.E2E_PORT ?? 3210);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 820, height: 1180 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `npx next build && npx next start -p ${port}`,
    url: `http://localhost:${port}`,
    env: { NEXT_DIST_DIR: ".next-e2e", NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_SITE_URL: `http://localhost:${port}` },
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
