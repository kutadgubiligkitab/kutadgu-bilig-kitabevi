// @ts-check
const { defineConfig, devices } = require("@playwright/test");

const PREVIEW = String(process.env.KUTADGU_PREVIEW_URL || "").trim();
const EXPLICIT = String(process.env.KUTADGU_BASE_URL || process.env.PLAYWRIGHT_BASE_URL || "").trim();
const PRODUCTION = "https://kutadgu-bilig-kitab.vercel.app";
const baseURL = PREVIEW || EXPLICIT || PRODUCTION;

module.exports = defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    locale: "ug",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    extraHTTPHeaders: { "Accept-Language": "ug,en;q=0.8" }
  },
  metadata: {
    baseURL,
    preview: PREVIEW || "",
    production: baseURL === PRODUCTION
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
