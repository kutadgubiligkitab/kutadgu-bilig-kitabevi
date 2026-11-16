// @ts-check
const { defineConfig, devices } = require("@playwright/test");
const target = require("./scripts/ci-resolve-e2e-target");

const PREVIEW = String(process.env.KUTADGU_PREVIEW_URL || "").trim();
const EXPLICIT = String(process.env.KUTADGU_BASE_URL || process.env.PLAYWRIGHT_BASE_URL || "").trim();
const PRODUCTION = "https://www.kutadgubilik.com";
const LOCAL_ORIGIN = "http://127.0.0.1:4173";
const baseURL = PREVIEW || EXPLICIT || LOCAL_ORIGIN;
const EVENT = String(process.env.GITHUB_EVENT_NAME || "").trim();
const BYPASS = String(process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "").trim();

if (EVENT === "pull_request" && target.isProductionOrigin(baseURL)) {
  throw new Error(`[e2e] refusing production fallback for pull_request (host=${target.hostnameOf(baseURL)}). Stage 10 must test this PR, not live production.`);
}

if (EVENT !== "pull_request" && target.isProductionOrigin(baseURL)) {
  throw new Error(`[e2e] refusing production target for ${EVENT || "local"} (host=${target.hostnameOf(baseURL)}). Refusing to use https://www.kutadgubilik.com or https://kutadgubilik.com.`);
}

if (!target.isLoopbackOrigin(baseURL)) {
  const { spawnSync } = require("child_process");
  const probe = spawnSync(process.execPath, ["-e", `
    const target = require(${JSON.stringify(require("path").join(__dirname, "scripts/ci-resolve-e2e-target.js"))});
    target.enforceRedirectGuard({ ok: true, url: process.argv[1], useLocalStatic: false, source: "playwright-config" }).then((decision) => {
      if (!decision.ok) {
        process.stderr.write(decision.note || decision.source || "rejected");
        process.exit(2);
      }
    }).catch((err) => {
      process.stderr.write(String(err && err.message || err));
      process.exit(2);
    });
  `, baseURL], { encoding: "utf8" });
  if (probe.status !== 0) {
    throw new Error(`[e2e] refusing Playwright navigation because this target redirects toward production (host=${target.hostnameOf(baseURL)}). ${String(probe.stderr || "").trim()}`);
  }
}

console.log(`[e2e-target] event=${EVENT || "local"} origin=${baseURL} host=${target.hostnameOf(baseURL) || "(none)"} production=${target.isProductionOrigin(baseURL) ? "yes" : "no"}`);

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
