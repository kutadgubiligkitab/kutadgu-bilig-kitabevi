#!/usr/bin/env node
"use strict";
const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
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

test("workflow_dispatch keeps an explicit preview or base URL and refuses a missing target", () => {
  const preview = "https://kutadgu-bilig-kitab-abc-kutadgu-bilig-kitabhanisi.vercel.app";
  const withPreview = T.decideTarget({
    eventName: "workflow_dispatch",
    previewOptIn: "1",
    previewUrl: preview,
    baseUrl: "https://example.test"
  });
  assert.strictEqual(withPreview.ok, true);
  assert.strictEqual(withPreview.url, preview);
  assert.strictEqual(withPreview.source, "env-preview");
  const withBase = T.decideTarget({
    eventName: "workflow_dispatch",
    previewOptIn: "1",
    previewUrl: "",
    baseUrl: "https://example.test"
  });
  assert.strictEqual(withBase.ok, true);
  assert.strictEqual(withBase.url, "https://example.test");
  assert.strictEqual(withBase.source, "env-base");
  for (const productionUrl of [T.PRODUCTION, "https://kutadgubilik.com", "https://www.kutadgubilik.com/book/1"]) {
    const explicitProduction = T.decideTarget({
      eventName: "workflow_dispatch",
      previewUrl: productionUrl,
      baseUrl: "https://example.test"
    });
    assert.strictEqual(explicitProduction.ok, false, productionUrl);
    assert.strictEqual(explicitProduction.url, "");
    assert.strictEqual(explicitProduction.source, "rejected-manual-production");
    assert.match(explicitProduction.note, /www\.kutadgubilik\.com/);
    assert.match(explicitProduction.note, /kutadgubilik\.com/);
  }
  const missing = T.decideTarget({
    eventName: "workflow_dispatch",
    previewOptIn: "1",
    previewUrl: "",
    baseUrl: ""
  });
  assert.strictEqual(missing.ok, false);
  assert.strictEqual(missing.url, "");
  assert.strictEqual(missing.source, "missing-manual-target");
  assert.notStrictEqual(missing.url, T.PRODUCTION);
  assert.match(missing.note, /non-production KUTADGU_PREVIEW_URL or KUTADGU_BASE_URL/);
  assert.match(missing.note, /will not use production/);
  const localDefault = T.decideTarget({ eventName: "", previewUrl: "", baseUrl: "" });
  assert.strictEqual(localDefault.ok, true);
  assert.strictEqual(localDefault.url, T.LOCAL_ORIGIN);
  assert.strictEqual(localDefault.source, "local-default");
  assert.strictEqual(T.isProductionOrigin(localDefault.url), false);
  const localProduction = T.decideTarget({
    eventName: "",
    previewUrl: "",
    baseUrl: "https://kutadgubilik.com/"
  });
  assert.strictEqual(localProduction.ok, false);
  assert.strictEqual(localProduction.url, "");
  assert.strictEqual(localProduction.source, "rejected-production");
});

function runResolver(env) {
  const clean = Object.assign({}, process.env);
  delete clean.GITHUB_ENV;
  delete clean.KUTADGU_PREVIEW_URL;
  delete clean.KUTADGU_BASE_URL;
  delete clean.KUTADGU_E2E_PREVIEW;
  delete clean.PR_HEAD_SHA;
  delete clean.GH_TOKEN;
  delete clean.GITHUB_TOKEN;
  delete clean.VERCEL_AUTOMATION_BYPASS_SECRET;
  return spawnSync(process.execPath, [path.join(__dirname, "ci-resolve-e2e-target.js")], {
    env: Object.assign(clean, env),
    encoding: "utf8"
  });
}

test("a manual resolver run without a target exits before selecting production", () => {
  const envFile = path.join(os.tmpdir(), "kutadgu-f05-missing-env.txt");
  fs.writeFileSync(envFile, "");
  const result = runResolver({
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_ENV: envFile,
    KUTADGU_PREVIEW_URL: "",
    KUTADGU_BASE_URL: "   "
  });
  const output = String(result.stdout || "") + String(result.stderr || "");
  assert.notStrictEqual(result.status, 0);
  assert.match(output, /stopped:/);
  assert.match(output, /explicit non-production KUTADGU_PREVIEW_URL or KUTADGU_BASE_URL/);
  assert.match(output, /source=missing-manual-target/);
  assert.doesNotMatch(output, /origin=https:\/\/www\.kutadgubilik\.com/);
  assert.doesNotMatch(output, /source=production-default/);
  assert.strictEqual(fs.readFileSync(envFile, "utf8"), "");
  fs.unlinkSync(envFile);
});

test("a manual resolver run with an explicit test URL resolves that URL", () => {
  const envFile = path.join(os.tmpdir(), "kutadgu-f05-explicit-env.txt");
  fs.writeFileSync(envFile, "");
  const result = runResolver({
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_ENV: envFile,
    KUTADGU_PREVIEW_URL: "",
    KUTADGU_BASE_URL: "https://example.test/"
  });
  const output = String(result.stdout || "") + String(result.stderr || "");
  assert.strictEqual(result.status, 0, output);
  assert.match(output, /source=env-base/);
  assert.match(output, /origin=https:\/\/example\.test/);
  assert.match(output, /production=no/);
  const written = fs.readFileSync(envFile, "utf8");
  assert.match(written, /KUTADGU_BASE_URL=https:\/\/example\.test\n/);
  assert.doesNotMatch(written, /kutadgubilik\.com/);
  fs.unlinkSync(envFile);
});

test("a manual resolver run with an explicit production URL stops", () => {
  const envFile = path.join(os.tmpdir(), "kutadgu-f05-production-env.txt");
  fs.writeFileSync(envFile, "");
  const result = runResolver({
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_ENV: envFile,
    KUTADGU_PREVIEW_URL: "https://www.kutadgubilik.com",
    KUTADGU_BASE_URL: "https://example.test"
  });
  const output = String(result.stdout || "") + String(result.stderr || "");
  assert.notStrictEqual(result.status, 0);
  assert.match(output, /source=rejected-manual-production/);
  assert.match(output, /refuses https:\/\/www\.kutadgubilik\.com and https:\/\/kutadgubilik\.com/);
  assert.doesNotMatch(output, /origin=https:\/\/www\.kutadgubilik\.com/);
  assert.doesNotMatch(output, /origin=https:\/\/example\.test/);
  assert.strictEqual(fs.readFileSync(envFile, "utf8"), "");
  fs.unlinkSync(envFile);
});

test("a local resolver run without a URL uses the local checkout", () => {
  const envFile = path.join(os.tmpdir(), "kutadgu-f05-local-env.txt");
  fs.writeFileSync(envFile, "");
  const result = runResolver({
    GITHUB_EVENT_NAME: "",
    GITHUB_ENV: envFile,
    KUTADGU_PREVIEW_URL: "",
    KUTADGU_BASE_URL: ""
  });
  const output = String(result.stdout || "") + String(result.stderr || "");
  assert.strictEqual(result.status, 0, output);
  assert.match(output, /source=local-default/);
  assert.match(output, /origin=http:\/\/127\.0\.0\.1:4173/);
  assert.match(output, /production=no/);
  const written = fs.readFileSync(envFile, "utf8");
  assert.match(written, /KUTADGU_BASE_URL=http:\/\/127\.0\.0\.1:4173\n/);
  assert.doesNotMatch(written, /kutadgubilik\.com/);
  fs.unlinkSync(envFile);
});

test("a local resolver run explicitly targeting production stops", () => {
  const envFile = path.join(os.tmpdir(), "kutadgu-f05-local-production-env.txt");
  fs.writeFileSync(envFile, "");
  const result = runResolver({
    GITHUB_EVENT_NAME: "",
    GITHUB_ENV: envFile,
    KUTADGU_PREVIEW_URL: "",
    KUTADGU_BASE_URL: "https://kutadgubilik.com"
  });
  const output = String(result.stdout || "") + String(result.stderr || "");
  assert.notStrictEqual(result.status, 0);
  assert.match(output, /source=rejected-production/);
  assert.match(output, /refusing production target/);
  assert.strictEqual(fs.readFileSync(envFile, "utf8"), "");
  fs.unlinkSync(envFile);
});

test("a pull_request resolver run still uses the local checkout", () => {
  const envFile = path.join(os.tmpdir(), "kutadgu-f05-pr-env.txt");
  fs.writeFileSync(envFile, "");
  const result = runResolver({
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_ENV: envFile,
    KUTADGU_E2E_PREVIEW: "",
    KUTADGU_PREVIEW_URL: T.PRODUCTION,
    KUTADGU_BASE_URL: T.PRODUCTION
  });
  const output = String(result.stdout || "") + String(result.stderr || "");
  assert.strictEqual(result.status, 0, output);
  assert.match(output, /source=pr-checkout-static/);
  assert.match(output, /origin=http:\/\/127\.0\.0\.1:4173/);
  assert.match(output, /production=no/);
  const written = fs.readFileSync(envFile, "utf8");
  assert.match(written, /KUTADGU_BASE_URL=http:\/\/127\.0\.0\.1:4173\n/);
  assert.match(written, /KUTADGU_USE_LOCAL_STATIC=1\n/);
  fs.unlinkSync(envFile);
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
  assert.match(yml, /non-production KUTADGU_PREVIEW_URL or KUTADGU_BASE_URL/);
  assert.match(yml, /www\.kutadgubilik\.com and kutadgubilik\.com are refused/);
  assert.doesNotMatch(yml, /production default/);
  assert.doesNotMatch(yml, /KUTADGU_BASE_URL=https:\/\/kutadgu-bilig-kitab\.vercel\.app/);
  const config = require("fs").readFileSync(require("path").join(__dirname, "..", "playwright.config.js"), "utf8");
  assert.match(config, /PREVIEW \|\| EXPLICIT \|\| LOCAL_ORIGIN/);
  assert.match(config, /refusing production target for/);
  assert.match(config, /refusing production fallback for pull_request/);
  assert.doesNotMatch(config, /PREVIEW \|\| EXPLICIT \|\| PRODUCTION/);
  assert.match(config, /retries: process\.env\.CI \? 1 : 0/);
  assert.match(config, /workers: process\.env\.CI \? 2 : undefined/);
});

function loadPlaywrightConfig(env) {
  const configPath = path.join(__dirname, "..", "playwright.config.js");
  const code = `
    const Module = require("module");
    const orig = Module.prototype.require;
    Module.prototype.require = function(id) {
      if (id === "@playwright/test") return { defineConfig(config) { return config; }, devices: { "Desktop Chrome": {} } };
      return orig.apply(this, arguments);
    };
    try {
      const config = require(${JSON.stringify(configPath)});
      process.stdout.write("\\n__RESULT__" + JSON.stringify({ ok: true, baseURL: config.use && config.use.baseURL }));
    } catch (err) {
      process.stdout.write("\\n__RESULT__" + JSON.stringify({ ok: false, message: String(err && err.message || err) }));
    }
  `;
  const clean = Object.assign({}, process.env);
  delete clean.KUTADGU_PREVIEW_URL;
  delete clean.KUTADGU_BASE_URL;
  delete clean.PLAYWRIGHT_BASE_URL;
  delete clean.GITHUB_EVENT_NAME;
  delete clean.KUTADGU_USE_LOCAL_STATIC;
  return spawnSync(process.execPath, ["-e", code], {
    env: Object.assign(clean, env),
    encoding: "utf8"
  });
}

function playwrightResult(env) {
  const result = loadPlaywrightConfig(env);
  const output = String(result.stdout || "");
  const marker = output.split("__RESULT__").pop();
  let parsed = null;
  try { parsed = JSON.parse(marker); } catch (err) { parsed = null; }
  assert.ok(parsed, output + String(result.stderr || ""));
  return parsed;
}

test("local Playwright without a URL uses the local checkout", () => {
  const parsed = playwrightResult({ GITHUB_EVENT_NAME: "", KUTADGU_PREVIEW_URL: "", KUTADGU_BASE_URL: "", PLAYWRIGHT_BASE_URL: "" });
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.baseURL, "http://127.0.0.1:4173");
});

test("local Playwright refuses an explicit production URL", () => {
  const parsed = playwrightResult({
    GITHUB_EVENT_NAME: "",
    KUTADGU_BASE_URL: "https://www.kutadgubilik.com"
  });
  assert.strictEqual(parsed.ok, false);
  assert.match(parsed.message, /refusing production target for local/);
  assert.match(parsed.message, /www\.kutadgubilik\.com/);
});

test("Playwright keeps an explicit non-production URL and refuses production on a manual run", () => {
  const allowed = playwrightResult({
    GITHUB_EVENT_NAME: "workflow_dispatch",
    KUTADGU_BASE_URL: "https://example.test"
  });
  assert.strictEqual(allowed.ok, true);
  assert.strictEqual(allowed.baseURL, "https://example.test");
  const blocked = playwrightResult({
    GITHUB_EVENT_NAME: "workflow_dispatch",
    KUTADGU_PREVIEW_URL: "https://kutadgubilik.com/"
  });
  assert.strictEqual(blocked.ok, false);
  assert.match(blocked.message, /refusing production target for workflow_dispatch/);
});

test("Playwright still refuses production on pull_request", () => {
  const parsed = playwrightResult({
    GITHUB_EVENT_NAME: "pull_request",
    KUTADGU_BASE_URL: "https://www.kutadgubilik.com"
  });
  assert.strictEqual(parsed.ok, false);
  assert.match(parsed.message, /refusing production fallback for pull_request/);
});

if (failed) process.exit(1);
console.log("ci-resolve-e2e-target tests passed");
