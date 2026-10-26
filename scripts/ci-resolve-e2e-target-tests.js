#!/usr/bin/env node
"use strict";
const assert = require("assert");
const T = require("./ci-resolve-e2e-target.js");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, err.message);
  }
}

test("failed CI scenario: empty env on pull_request does not select production", () => {
  const decision = T.decideTarget({
    eventName: "pull_request",
    previewUrl: "",
    baseUrl: "",
    vercelPreviewUrl: "",
    vercelReachable: false
  });
  assert.strictEqual(decision.ok, true);
  assert.strictEqual(decision.url, T.LOCAL_ORIGIN);
  assert.strictEqual(decision.source, "pr-checkout-static");
  assert.strictEqual(decision.useLocalStatic, true);
  assert.strictEqual(T.isProductionOrigin(decision.url), false);
});

test("pull_request ignores a reachable Vercel preview unless preview testing is requested", () => {
  const preview = "https://kutadgu-bilig-kitab-abc-kutadgu-bilig-kitabhanisi.vercel.app";
  const decision = T.decideTarget({
    eventName: "pull_request",
    previewOptIn: "",
    previewUrl: preview,
    baseUrl: "https://kutadgu-bilig-kitab.vercel.app",
    vercelPreviewUrl: preview,
    vercelReachable: true
  });
  assert.strictEqual(decision.url, T.LOCAL_ORIGIN);
  assert.strictEqual(decision.source, "pr-checkout-static");
  assert.strictEqual(decision.useLocalStatic, true);
  assert.strictEqual(T.isProductionOrigin(decision.url), false);
});

test("opt-in reachable Vercel preview wins on pull_request", () => {
  const preview = "https://kutadgu-bilig-kitab-abc-kutadgu-bilig-kitabhanisi.vercel.app";
  const decision = T.decideTarget({
    eventName: "pull_request",
    previewOptIn: "1",
    previewUrl: "",
    baseUrl: "https://kutadgu-bilig-kitab.vercel.app",
    vercelPreviewUrl: preview,
    vercelReachable: true
  });
  assert.strictEqual(decision.url, preview);
  assert.strictEqual(decision.source, "vercel-preview");
  assert.strictEqual(decision.useLocalStatic, false);
});

test("opt-in pull_request still refuses a production origin", () => {
  const decision = T.decideTarget({
    eventName: "pull_request",
    previewOptIn: "1",
    previewUrl: T.PRODUCTION,
    baseUrl: T.PRODUCTION,
    vercelPreviewUrl: "https://www.kutadgubilik.com",
    vercelReachable: true
  });
  assert.strictEqual(decision.url, T.LOCAL_ORIGIN);
  assert.strictEqual(decision.source, "pr-checkout-static");
  assert.strictEqual(T.pullRequestRefusesProduction("pull_request", decision), false);
  assert.strictEqual(T.pullRequestRefusesProduction("pull_request", { url: T.PRODUCTION }), true);
});

test("a normal pull_request does not wait for Vercel", () => {
  assert.strictEqual(T.shouldWaitForVercelPreview({
    eventName: "pull_request",
    previewOptIn: "",
    repo: "kutadgubiligkitab/kutadgu-bilig-kitabevi",
    sha: "abc",
    token: "token"
  }), false);
  assert.strictEqual(T.shouldWaitForVercelPreview({
    eventName: "pull_request",
    previewOptIn: "1",
    repo: "kutadgubiligkitab/kutadgu-bilig-kitabevi",
    sha: "abc",
    token: "token"
  }), true);
  assert.strictEqual(T.shouldWaitForVercelPreview({
    eventName: "pull_request",
    previewOptIn: "1",
    repo: "",
    sha: "abc",
    token: "token"
  }), false);
  assert.strictEqual(T.shouldWaitForVercelPreview({
    eventName: "workflow_dispatch",
    previewOptIn: "1",
    repo: "kutadgubiligkitab/kutadgu-bilig-kitabevi",
    sha: "abc",
    token: "token"
  }), false);
});

test("SSO/unreachability does not fall back to production", () => {
  const preview = "https://kutadgu-bilig-kitab-abc-kutadgu-bilig-kitabhanisi.vercel.app";
  const decision = T.decideTarget({
    eventName: "pull_request",
    previewOptIn: "1",
    previewUrl: preview,
    baseUrl: "https://kutadgu-bilig-kitab.vercel.app",
    vercelPreviewUrl: preview,
    vercelReachable: false
  });
  assert.strictEqual(decision.url, T.LOCAL_ORIGIN);
  assert.strictEqual(decision.source, "pr-checkout-static");
  assert.match(decision.note, /refusing production fallback/);
});

test("workflow_dispatch keeps preview, base URL, then production", () => {
  const preview = "https://kutadgu-bilig-kitab-abc-kutadgu-bilig-kitabhanisi.vercel.app";
  const withPreview = T.decideTarget({
    eventName: "workflow_dispatch",
    previewOptIn: "1",
    previewUrl: preview,
    baseUrl: "https://example.test"
  });
  assert.strictEqual(withPreview.url, preview);
  assert.strictEqual(withPreview.source, "env-preview");
  const withBase = T.decideTarget({
    eventName: "workflow_dispatch",
    previewOptIn: "1",
    previewUrl: "",
    baseUrl: "https://example.test"
  });
  assert.strictEqual(withBase.url, "https://example.test");
  assert.strictEqual(withBase.source, "env-base");
  const production = T.decideTarget({
    eventName: "workflow_dispatch",
    previewOptIn: "1",
    previewUrl: "",
    baseUrl: ""
  });
  assert.strictEqual(production.url, T.PRODUCTION);
  assert.strictEqual(production.source, "production-default");
});

test("pickPreviewFromStatuses ignores production and dashboard URLs", () => {
  const url = T.pickPreviewFromStatuses([
    { state: "success", target_url: "https://vercel.com/kutadgu-bilig-kitabhanisi/kutadgu-bilig-kitab/xyz" },
    { state: "success", environment_url: "https://kutadgu-bilig-kitab.vercel.app" },
    { state: "success", environment_url: "https://kutadgu-bilig-kitab-k9s2f3i99-kutadgu-bilig-kitabhanisi.vercel.app" }
  ]);
  assert.strictEqual(url, "https://kutadgu-bilig-kitab-k9s2f3i99-kutadgu-bilig-kitabhanisi.vercel.app");
});

test("logTarget prints origin/host without secrets", () => {
  const text = T.logTarget(
    { url: "http://127.0.0.1:4173", source: "pr-checkout-static" },
    { eventName: "pull_request", commit: "ffe56789b1a59e1cc87a80a6cb4d46c32bb180c7", vercelPreviewHost: "kutadgu-bilig-kitab-k9s2f3i99-kutadgu-bilig-kitabhanisi.vercel.app", vercelPreviewReachable: false, vercelPreviewReason: "sso-protection" }
  );
  assert.match(text, /event=pull_request/);
  assert.match(text, /host=127\.0\.0\.1/);
  assert.match(text, /origin=http:\/\/127\.0\.0\.1:4173/);
  assert.match(text, /production=no/);
  assert.match(text, /vercel_preview_reason=sso-protection/);
  assert.doesNotMatch(text, /Bearer /);
  assert.doesNotMatch(text, /ghp_/);
});

test("workflow no longer silently assigns production on pull_request", () => {
  const yml = require("fs").readFileSync(require("path").join(__dirname, "..", ".github/workflows/stage10-regression.yml"), "utf8");
  assert.match(yml, /ci-resolve-e2e-target\.js/);
  assert.match(yml, /KUTADGU_E2E_PREVIEW/);
  assert.match(yml, /fail-fast:\s*true/);
  assert.doesNotMatch(yml, /fail-fast:\s*false/);
  assert.match(yml, /cancel-in-progress:\s*true/);
  assert.match(yml, /stage10-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/);
  const preflight = yml.slice(yml.indexOf("\n  preflight:"), yml.indexOf("\n  e2e-shard:"));
  assert.match(preflight, /ci-asset-pin-preflight\.js/);
  assert.match(preflight, /node-version:\s*"22"/);
  assert.doesNotMatch(preflight, /playwright|npm ci/);
  assert.match(yml, /needs: preflight\r?\n/);
  assert.match(yml, /--shard=\$\{\{ matrix\.shard \}\}\/2/);
  assert.match(yml, /playwright-report-shard-/);
  assert.match(yml, /ci-e2e-gate\.js check/);
  assert.match(yml, /name: e2e\r?\n/);
  assert.match(yml, /needs: e2e-shard\r?\n\s+if: always\(\)/);
  assert.doesNotMatch(yml, /runs-on: (ubuntu-22\.04-4core|ubuntu-latest-4core|ubuntu-24\.04-4core|windows-|macos-)/);
  assert.doesNotMatch(yml, /npx playwright test(?! --shard=)/);
  assert.doesNotMatch(yml, /Using production \(read-safe Playwright routes block catalog writes\)/);
  assert.doesNotMatch(yml, /KUTADGU_BASE_URL=https:\/\/kutadgu-bilig-kitab\.vercel\.app/);
  const config = require("fs").readFileSync(require("path").join(__dirname, "..", "playwright.config.js"), "utf8");
  assert.match(config, /retries: process\.env\.CI \? 1 : 0/);
  assert.match(config, /workers: process\.env\.CI \? 2 : undefined/);
});

if (failed) process.exit(1);
console.log("ci-resolve-e2e-target tests passed");
