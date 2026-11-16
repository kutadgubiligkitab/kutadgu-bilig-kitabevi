#!/usr/bin/env node
"use strict";
const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const T = require("./ci-resolve-e2e-target.js");

let failed = 0;
const pending = [];
function test(name, fn) {
  let result;
  try {
    result = fn();
  } catch (err) {
    failed++;
    console.error("FAIL", name, err.message);
    return;
  }
  if (result && typeof result.then === "function") {
    pending.push(result.then(
      () => console.log("PASS", name),
      (err) => {
        failed++;
        console.error("FAIL", name, err && err.message ? err.message : err);
      }
    ));
    return;
  }
  console.log("PASS", name);
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
  const preload = path.join(os.tmpdir(), "kutadgu-f05-fetch-preload.js");
  const logFile = path.join(os.tmpdir(), "kutadgu-f05-fetch-log.json");
  fs.writeFileSync(logFile, "[]");
  fs.writeFileSync(preload, `
    const fs = require("fs");
    const logFile = ${JSON.stringify(logFile)};
    global.fetch = async (url) => {
      const target = String(url);
      const calls = JSON.parse(fs.readFileSync(logFile, "utf8"));
      calls.push(target);
      fs.writeFileSync(logFile, JSON.stringify(calls));
      let host = "";
      try { host = new URL(target).hostname.toLowerCase().replace(/\\.+$/, ""); } catch (err) {}
      if (host === "kutadgubilik.com" || host === "www.kutadgubilik.com") {
        throw new Error("refusing to request production: " + target);
      }
      const mode = process.env.KUTADGU_TEST_FETCH_MODE || "ok";
      const headers = { get(name) { return ""; } };
      if (mode === "redirect-production") {
        return { status: 302, headers: { get(name) { return String(name).toLowerCase() === "location" ? "https://www.kutadgubilik.com./" : ""; } } };
      }
      if (mode === "redirect-chain" && host === "example.test") {
        return { status: 302, headers: { get(name) { return String(name).toLowerCase() === "location" ? "https://staging.example.test/next" : ""; } } };
      }
      if (mode === "redirect-chain") {
        return { status: 302, headers: { get(name) { return String(name).toLowerCase() === "location" ? "https://kutadgubilik.com./home" : ""; } } };
      }
      return { status: 200, headers };
    };
  `);
  const clean = Object.assign({}, process.env);
  delete clean.GITHUB_ENV;
  delete clean.KUTADGU_PREVIEW_URL;
  delete clean.KUTADGU_BASE_URL;
  delete clean.KUTADGU_E2E_PREVIEW;
  delete clean.PR_HEAD_SHA;
  delete clean.GH_TOKEN;
  delete clean.GITHUB_TOKEN;
  delete clean.VERCEL_AUTOMATION_BYPASS_SECRET;
  delete clean.NODE_OPTIONS;
  delete clean.KUTADGU_TEST_FETCH_MODE;
  const result = spawnSync(process.execPath, [path.join(__dirname, "ci-resolve-e2e-target.js")], {
    env: Object.assign(clean, env, { NODE_OPTIONS: "--require " + preload }),
    encoding: "utf8"
  });
  result.fetchLog = JSON.parse(fs.readFileSync(logFile, "utf8"));
  return result;
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
  assert.deepStrictEqual(result.fetchLog, ["https://example.test"]);
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
  assert.deepStrictEqual(result.fetchLog, []);
  fs.unlinkSync(envFile);
});

test("a trailing-dot production hostname is refused before any request", () => {
  const envFile = path.join(os.tmpdir(), "kutadgu-f05-dot-env.txt");
  fs.writeFileSync(envFile, "");
  const result = runResolver({
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_ENV: envFile,
    KUTADGU_PREVIEW_URL: "",
    KUTADGU_BASE_URL: "https://kutadgubilik.com./"
  });
  const output = String(result.stdout || "") + String(result.stderr || "");
  assert.notStrictEqual(result.status, 0);
  assert.match(output, /source=rejected-manual-production/);
  assert.deepStrictEqual(result.fetchLog, []);
  assert.strictEqual(fs.readFileSync(envFile, "utf8"), "");
  fs.unlinkSync(envFile);
});

test("a manual resolver run refuses a redirect to production without requesting it", () => {
  const envFile = path.join(os.tmpdir(), "kutadgu-f05-redirect-env.txt");
  fs.writeFileSync(envFile, "");
  const result = runResolver({
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_ENV: envFile,
    KUTADGU_PREVIEW_URL: "",
    KUTADGU_BASE_URL: "https://example.test",
    KUTADGU_TEST_FETCH_MODE: "redirect-chain"
  });
  const output = String(result.stdout || "") + String(result.stderr || "");
  assert.notStrictEqual(result.status, 0);
  assert.match(output, /source=rejected-production-redirect/);
  assert.match(output, /production hop was not requested/);
  assert.deepStrictEqual(result.fetchLog, ["https://example.test", "https://staging.example.test/next"]);
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
  assert.match(config, /ci-resolve-e2e-target/);
  assert.match(config, /PREVIEW \|\| EXPLICIT \|\| LOCAL_ORIGIN/);
  assert.match(config, /refusing production target for/);
  assert.match(config, /refusing production fallback for pull_request/);
  assert.doesNotMatch(config, /PREVIEW \|\| EXPLICIT \|\| PRODUCTION/);
  assert.match(config, /retries: process\.env\.CI \? 1 : 0/);
  assert.match(config, /workers: process\.env\.CI \? 2 : undefined/);
});

function loadPlaywrightConfig(env) {
  const configPath = path.join(__dirname, "..", "playwright.config.js");
  const logFile = env.KUTADGU_TEST_FETCH_LOG || path.join(os.tmpdir(), "kutadgu-f05-playwright-fetch-log.json");
  fs.writeFileSync(logFile, "[]");
  const preload = path.join(os.tmpdir(), "kutadgu-f05-playwright-fetch-preload.js");
  fs.writeFileSync(preload, `
    const fs = require("fs");
    const logFile = ${JSON.stringify(logFile)};
    global.fetch = async (url) => {
      const target = String(url);
      const calls = JSON.parse(fs.readFileSync(logFile, "utf8"));
      calls.push(target);
      fs.writeFileSync(logFile, JSON.stringify(calls));
      let host = "";
      try { host = new URL(target).hostname.toLowerCase().replace(/\\.+$/, ""); } catch (err) {}
      if (host === "kutadgubilik.com" || host === "www.kutadgubilik.com") {
        throw new Error("refusing to request production: " + target);
      }
      const mode = process.env.KUTADGU_TEST_FETCH_MODE || "ok";
      const headers = { get(name) { return ""; } };
      if (mode === "redirect-production") {
        return { status: 302, headers: { get(name) { return String(name).toLowerCase() === "location" ? "https://www.kutadgubilik.com./" : ""; } } };
      }
      if (mode === "redirect-chain" && host === "example.test") {
        return { status: 302, headers: { get(name) { return String(name).toLowerCase() === "location" ? "https://staging.example.test/next" : ""; } } };
      }
      if (mode === "redirect-chain") {
        return { status: 302, headers: { get(name) { return String(name).toLowerCase() === "location" ? "https://kutadgubilik.com./home" : ""; } } };
      }
      return { status: 200, headers };
    };
  `);
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
  delete clean.NODE_OPTIONS;
  delete clean.KUTADGU_TEST_FETCH_MODE;
  const result = spawnSync(process.execPath, ["-e", code], {
    env: Object.assign(clean, env, { NODE_OPTIONS: "--require " + preload }),
    encoding: "utf8"
  });
  result.fetchLog = JSON.parse(fs.readFileSync(logFile, "utf8"));
  return result;
}

function playwrightResultFrom(result) {
  const output = String(result.stdout || "");
  const marker = output.split("__RESULT__").pop();
  let parsed = null;
  try { parsed = JSON.parse(marker); } catch (err) { parsed = null; }
  assert.ok(parsed, output + String(result.stderr || ""));
  return parsed;
}

function playwrightResult(env) {
  return playwrightResultFrom(loadPlaywrightConfig(env));
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
  const allowedRun = loadPlaywrightConfig({
    GITHUB_EVENT_NAME: "workflow_dispatch",
    KUTADGU_BASE_URL: "https://example.test"
  });
  const allowed = playwrightResultFrom(allowedRun);
  assert.strictEqual(allowed.ok, true);
  assert.strictEqual(allowed.baseURL, "https://example.test");
  assert.deepStrictEqual(allowedRun.fetchLog, ["https://example.test"]);
  const blocked = playwrightResult({
    GITHUB_EVENT_NAME: "workflow_dispatch",
    KUTADGU_PREVIEW_URL: "https://kutadgubilik.com/"
  });
  assert.strictEqual(blocked.ok, false);
  assert.match(blocked.message, /refusing production target for workflow_dispatch/);
});

test("Playwright refuses a redirect to production before navigating", () => {
  const logFile = path.join(os.tmpdir(), "kutadgu-f05-playwright-redirect-log.json");
  const result = loadPlaywrightConfig({
    GITHUB_EVENT_NAME: "workflow_dispatch",
    KUTADGU_BASE_URL: "https://example.test",
    KUTADGU_TEST_FETCH_MODE: "redirect-chain",
    KUTADGU_TEST_FETCH_LOG: logFile
  });
  const parsed = playwrightResultFrom(result);
  assert.strictEqual(parsed.ok, false);
  assert.match(parsed.message, /refusing Playwright navigation because this target redirects toward production/);
  assert.match(parsed.message, /production hop was not requested/);
  assert.deepStrictEqual(result.fetchLog, ["https://example.test", "https://staging.example.test/next"]);
  assert.ok(!result.fetchLog.some((url) => /kutadgubilik\.com/i.test(url)));
});

test("Playwright refuses a trailing-dot production hostname", () => {
  const parsed = playwrightResult({
    GITHUB_EVENT_NAME: "",
    KUTADGU_BASE_URL: "https://www.kutadgubilik.com./"
  });
  assert.strictEqual(parsed.ok, false);
  assert.match(parsed.message, /refusing production target for local/);
  assert.match(parsed.message, /www\.kutadgubilik\.com/);
});

test("Playwright still refuses production on pull_request", () => {
  const parsed = playwrightResult({
    GITHUB_EVENT_NAME: "pull_request",
    KUTADGU_BASE_URL: "https://www.kutadgubilik.com"
  });
  assert.strictEqual(parsed.ok, false);
  assert.match(parsed.message, /refusing production fallback for pull_request/);
});

test("trailing-dot production hosts and redirect chains stay fail-closed", async () => {
  for (const url of ["https://kutadgubilik.com.", "https://www.kutadgubilik.com./", "https://KutadguBilik.com./path"]) {
    assert.strictEqual(T.isProductionOrigin(url), true, url);
    const decision = T.decideTarget({ eventName: "workflow_dispatch", previewUrl: "", baseUrl: url });
    assert.strictEqual(decision.ok, false, url);
    assert.strictEqual(decision.source, "rejected-manual-production");
  }
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(String(url));
    if (T.isProductionOrigin(url)) throw new Error("requested production " + url);
    if (String(url).indexOf("staging.example.test") !== -1) {
      return { status: 302, headers: { location: "https://kutadgubilik.com./home" } };
    }
    return { status: 302, headers: new Map([["location", "https://staging.example.test/next"]]) };
  };
  const allowed = T.decideTarget({ eventName: "workflow_dispatch", previewUrl: "", baseUrl: "https://example.test/start" });
  const guarded = await T.enforceRedirectGuard(allowed, fetchImpl);
  assert.strictEqual(guarded.ok, false);
  assert.strictEqual(guarded.source, "rejected-production-redirect");
  assert.deepStrictEqual(requested, ["https://example.test/start", "https://staging.example.test/next"]);
  const local = T.decideTarget({ eventName: "", previewUrl: "", baseUrl: "" });
  const localGuarded = await T.enforceRedirectGuard(local, fetchImpl);
  assert.strictEqual(localGuarded.ok, true);
  assert.strictEqual(localGuarded.url, T.LOCAL_ORIGIN);
  assert.deepStrictEqual(requested, ["https://example.test/start", "https://staging.example.test/next"]);
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    status: 302,
    headers: { get: () => "https://www.kutadgubilik.com." }
  });
  try {
    const probe = await T.probePreview("https://preview.example.test", "");
    assert.strictEqual(probe.reachable, false);
    assert.strictEqual(probe.reason, "redirect-to-production");
  } finally {
    global.fetch = originalFetch;
  }
});

Promise.all(pending).then(() => {
  if (failed) process.exit(1);
  console.log("ci-resolve-e2e-target tests passed");
});
