// @ts-check
const { defineConfig, devices } = require("@playwright/test");

const PREVIEW = String(process.env.KUTADGU_PREVIEW_URL || "").trim();
const EXPLICIT = String(process.env.KUTADGU_BASE_URL || process.env.PLAYWRIGHT_BASE_URL || "").trim();
const PRODUCTION = "https://kutadgu-bilig-kitab.vercel.app";
const baseURL = PREVIEW || EXPLICIT || PRODUCTION;
const EVENT = String(process.env.GITHUB_EVENT_NAME || "").trim();
const BYPASS = String(process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "").trim();

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch (err) {
    return "";
  }
}

function isProductionOrigin(url) {
  const host = hostnameOf(url).replace(/^www\./, "");
  return host === "kutadgu-bilig-kitab.vercel.app" || host === "kutadgubilik.com";
}

if (EVENT === "pull_request" && isProductionOrigin(baseURL)) {
  throw new Error(`[e2e] refusing production fallback for pull_request (host=${hostnameOf(baseURL)}). Stage 10 must test this PR, not live production.`);
}

console.log(`[e2e-target] event=${EVENT || "local"} origin=${baseURL} host=${hostnameOf(baseURL) || "(none)"} production=${isProductionOrigin(baseURL) ? "yes" : "no"}`);

const extraHTTPHeaders = { "Accept-Language": "ug,en;q=0.8" };
if (BYPASS) {
  extraHTTPHeaders["x-vercel-protection-bypass"] = BYPASS;
  extraHTTPHeaders["x-vercel-set-bypass-cookie"] = "true";
}

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
    extraHTTPHeaders
  },
  webServer: process.env.KUTADGU_USE_LOCAL_STATIC === "1" ? {
    command: "node scripts/static-preview-server.js",
    url: "http://127.0.0.1:4173/",
    reuseExistingServer: true,
    timeout: 30_000
  } : undefined,
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
