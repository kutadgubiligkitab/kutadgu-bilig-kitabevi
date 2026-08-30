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

test("reachable Vercel preview wins on pull_request", () => {
  const preview = "https://kutadgu-bilig-kitab-abc-kutadgu-bilig-kitabhanisi.vercel.app";
  const decision = T.decideTarget({
    eventName: "pull_request",
    previewUrl: "",
    baseUrl: "https://kutadgu-bilig-kitab.vercel.app",
    vercelPreviewUrl: preview,
    vercelReachable: true
  });
  assert.strictEqual(decision.url, preview);
  assert.strictEqual(decision.source, "vercel-preview");
  assert.strictEqual(decision.useLocalStatic, false);
});

test("SSO/unreachability does not fall back to production", () => {
  const preview = "https://kutadgu-bilig-kitab-abc-kutadgu-bilig-kitabhanisi.vercel.app";
  const decision = T.decideTarget({
    eventName: "pull_request",
    previewUrl: preview,
    baseUrl: "https://kutadgu-bilig-kitab.vercel.app",
    vercelPreviewUrl: preview,
    vercelReachable: false
  });
  assert.strictEqual(decision.url, T.LOCAL_ORIGIN);
  assert.strictEqual(decision.source, "pr-checkout-static");
});

test("workflow_dispatch keeps production default", () => {
  const decision = T.decideTarget({
    eventName: "workflow_dispatch",
    previewUrl: "",
    baseUrl: ""
  });
  assert.strictEqual(decision.url, T.PRODUCTION);
  assert.strictEqual(decision.source, "production-default");
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
  assert.doesNotMatch(yml, /Using production \(read-safe Playwright routes block catalog writes\)/);
  assert.doesNotMatch(yml, /KUTADGU_BASE_URL=https:\/\/kutadgu-bilig-kitab\.vercel\.app/);
});

if (failed) process.exit(1);
console.log("ci-resolve-e2e-target tests passed");
