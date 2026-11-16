#!/usr/bin/env node
"use strict";
/**
 * Resolve the Stage 10 Playwright origin.
 * pull_request: use the checked-out candidate. KUTADGU_E2E_PREVIEW=1 restores the Vercel wait.
 * A pull_request never silently uses production.
 * workflow_dispatch: use a non-production KUTADGU_PREVIEW_URL or KUTADGU_BASE_URL.
 * A manual run without one, or with either production hostname, stops.
 * A trailing DNS dot does not make a production hostname safe.
 * A remote target that redirects to production is refused before that hop is requested.
 * A local run with no URL uses http://127.0.0.1:4173 and also refuses production.
 */
const fs = require("fs");

const PRODUCTION = "https://www.kutadgubilik.com";
const LOCAL_ORIGIN = "http://127.0.0.1:4173";

function trimUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function hostnameOf(url) {
  try {
    return new URL(trimUrl(url) + "/").hostname.toLowerCase().replace(/\.+$/, "");
  } catch (err) {
    return "";
  }
}

function isProductionOrigin(url) {
  const host = hostnameOf(url);
  if (!host) return false;
  return host === "www.kutadgubilik.com" || host === "kutadgubilik.com";
}

function isLoopbackOrigin(url) {
  const host = hostnameOf(url);
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function resolveRedirect(current, location) {
  try {
    return new URL(String(location || ""), current).href;
  } catch (err) {
    return "";
  }
}

function headerValue(res, name) {
  const headers = res && res.headers;
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  const wanted = String(name || "").toLowerCase();
  const key = Object.keys(headers).find((item) => item.toLowerCase() === wanted);
  return key ? String(headers[key] || "") : "";
}

async function inspectRedirects(url, fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  let current = String(url || "");
  const seen = [];
  for (let hop = 0; hop <= 5; hop += 1) {
    if (isProductionOrigin(current)) {
      return { ok: false, reason: "production-url", url: current, requested: seen.slice() };
    }
    if (seen.indexOf(current) !== -1) {
      return { ok: false, reason: "redirect-loop", url: current, requested: seen.slice() };
    }
    seen.push(current);
    let res;
    try {
      res = await fetchFn(current, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": "kutadgu-stage10-e2e", "Accept": "text/html" }
      });
    } catch (err) {
      return { ok: false, reason: "probe-error", url: current, requested: seen.slice() };
    }
    const status = Number(res && res.status || 0);
    if (status >= 300 && status < 400) {
      const next = resolveRedirect(current, headerValue(res, "location"));
      if (!next) return { ok: false, reason: "missing-location", url: current, requested: seen.slice() };
      if (isProductionOrigin(next)) {
        return { ok: false, reason: "redirect-to-production", url: next, requested: seen.slice() };
      }
      current = next;
      continue;
    }
    return { ok: true, reason: status ? `http-${status}` : "ok", url: current, requested: seen.slice() };
  }
  return { ok: false, reason: "too-many-redirects", url: current, requested: seen.slice() };
}

async function enforceRedirectGuard(decision, fetchImpl) {
  if (!decision || !decision.ok) return decision;
  if (decision.useLocalStatic || isLoopbackOrigin(decision.url)) return decision;
  const check = await inspectRedirects(decision.url, fetchImpl);
  if (check.ok) return decision;
  return {
    ok: false,
    url: "",
    source: "rejected-production-redirect",
    useLocalStatic: false,
    note: `refusing redirect to production (${check.reason}); the production hop was not requested`
  };
}

function isPreviewOrigin(url) {
  const host = hostnameOf(url);
  return /^kutadgu-bilig-kitab-[a-z0-9-]+-kutadgu-bilig-kitabhanisi\.vercel\.app$/.test(host);
}

function pickPreviewFromStatuses(statuses) {
  const rows = Array.isArray(statuses) ? statuses : [];
  const hit = rows.find((row) => {
    const url = trimUrl(row && (row.environment_url || row.target_url));
    return String(row && row.state || "").toLowerCase() === "success" && isPreviewOrigin(url);
  });
  return hit ? trimUrl(hit.environment_url || hit.target_url) : "";
}

function previewRequested(value) {
  return String(value || "").trim() === "1";
}

function shouldWaitForVercelPreview(input) {
  const eventName = String(input && input.eventName || "");
  if (eventName !== "pull_request") return false;
  if (!previewRequested(input && input.previewOptIn)) return false;
  return !!(input && input.repo && input.sha && input.token);
}

function decideTarget(input) {
  const eventName = String(input && input.eventName || "");
  const explicitPreview = trimUrl(input && input.previewUrl);
  const explicitBase = trimUrl(input && input.baseUrl);
  const vercelPreviewUrl = trimUrl(input && input.vercelPreviewUrl);
  const vercelReachable = !!(input && input.vercelReachable);
  const localOrigin = trimUrl(input && input.localOrigin) || LOCAL_ORIGIN;
  const previewOptIn = previewRequested(input && input.previewOptIn);

  if (eventName === "pull_request") {
    if (previewOptIn && vercelPreviewUrl && vercelReachable && !isProductionOrigin(vercelPreviewUrl)) {
      return { ok: true, url: vercelPreviewUrl, source: "vercel-preview", useLocalStatic: false };
    }
    if (previewOptIn && explicitPreview && vercelReachable && !isProductionOrigin(explicitPreview)) {
      return { ok: true, url: explicitPreview, source: "env-preview", useLocalStatic: false };
    }
    return {
      ok: true,
      url: localOrigin,
      source: "pr-checkout-static",
      useLocalStatic: true,
      note: previewOptIn
        ? "Vercel Preview missing or not publicly reachable; refusing production fallback"
        : "pull_request uses the checked-out candidate; set KUTADGU_E2E_PREVIEW=1 to test a Vercel preview"
    };
  }

  const manual = eventName === "workflow_dispatch";
  const chosen = explicitPreview
    ? { url: explicitPreview, source: "env-preview" }
    : explicitBase
      ? { url: explicitBase, source: "env-base" }
      : null;
  if (chosen && isProductionOrigin(chosen.url)) {
    return {
      ok: false,
      url: "",
      source: manual ? "rejected-manual-production" : "rejected-production",
      useLocalStatic: false,
      note: manual
        ? "workflow_dispatch refuses https://www.kutadgubilik.com and https://kutadgubilik.com, including KUTADGU_PREVIEW_URL or KUTADGU_BASE_URL"
        : "refusing production target; use http://127.0.0.1:4173 or another non-production URL"
    };
  }
  if (chosen) {
    return { ok: true, url: chosen.url, source: chosen.source, useLocalStatic: false };
  }
  if (manual) {
    return {
      ok: false,
      url: "",
      source: "missing-manual-target",
      useLocalStatic: false,
      note: "workflow_dispatch requires an explicit non-production KUTADGU_PREVIEW_URL or KUTADGU_BASE_URL and will not use production"
    };
  }
  if (!eventName) {
    return {
      ok: true,
      url: localOrigin,
      source: "local-default",
      useLocalStatic: true,
      note: "no test URL was provided; using http://127.0.0.1:4173"
    };
  }
  return {
    ok: false,
    url: "",
    source: "missing-target",
    useLocalStatic: false,
    note: "refusing production fallback because no explicit non-production test URL was provided"
  };
}

function logTarget(decision, extra) {
  const url = decision.url || "";
  const host = hostnameOf(url) || "(none)";
  const origin = url ? (trimUrl(url).match(/^https?:\/\/[^/]+/i) || [url])[0] : "(none)";
  const lines = [
    `[e2e-target] event=${extra.eventName || "local"}`,
    `[e2e-target] commit=${String(extra.commit || "").slice(0, 12) || "(none)"}`,
    `[e2e-target] source=${decision.source}`,
    `[e2e-target] origin=${origin}`,
    `[e2e-target] host=${host}`,
    `[e2e-target] production=${isProductionOrigin(url) ? "yes" : "no"}`
  ];
  if (extra.vercelPreviewHost) lines.push(`[e2e-target] vercel_preview_host=${extra.vercelPreviewHost}`);
  if (extra.vercelPreviewReachable != null) {
    lines.push(`[e2e-target] vercel_preview_reachable=${extra.vercelPreviewReachable ? "yes" : "no"}`);
  }
  if (extra.vercelPreviewReason) lines.push(`[e2e-target] vercel_preview_reason=${extra.vercelPreviewReason}`);
  if (decision.note) lines.push(`[e2e-target] note=${decision.note}`);
  return lines.join("\n");
}

async function githubJson(url, token) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "kutadgu-stage10-e2e"
    }
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (err) { body = null; }
  if (!res.ok) {
    const message = body && body.message ? body.message : `HTTP ${res.status}`;
    throw new Error(`GitHub API ${res.status} ${message}`);
  }
  return body;
}

async function waitForVercelPreview({ repo, sha, token, timeoutMs, intervalMs, sleepFn, githubJsonFn }) {
  const sleep = sleepFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const api = githubJsonFn || githubJson;
  const deadline = Date.now() + (timeoutMs || 180000);
  const step = intervalMs || 5000;
  let lastError = "";
  while (Date.now() <= deadline) {
    try {
      const deployments = await api(`https://api.github.com/repos/${repo}/deployments?sha=${encodeURIComponent(sha)}&per_page=10`, token);
      const list = Array.isArray(deployments) ? deployments : [];
      for (const deployment of list) {
        const statuses = await api(`https://api.github.com/repos/${repo}/deployments/${deployment.id}/statuses`, token);
        const url = pickPreviewFromStatuses(statuses);
        if (url) return { url, error: "" };
      }
      lastError = list.length ? "preview-deployment-not-ready" : "no-deployment-for-sha";
    } catch (err) {
      lastError = String(err && err.message || err);
      if (/HTTP 401|HTTP 403|Resource not accessible/i.test(lastError)) {
        return { url: "", error: lastError };
      }
    }
    if (Date.now() + step > deadline) break;
    await sleep(step);
  }
  return { url: "", error: lastError || "preview-timeout" };
}

async function probePreview(url, bypassSecret) {
  const target = trimUrl(url) + "/";
  const headers = { "User-Agent": "kutadgu-stage10-e2e", "Accept": "text/html" };
  if (bypassSecret) {
    headers["x-vercel-protection-bypass"] = bypassSecret;
    headers["x-vercel-set-bypass-cookie"] = "true";
  }
  try {
    const res = await fetch(target, { method: "GET", headers, redirect: "manual" });
    const location = String(res.headers.get("location") || "");
    if (res.status >= 300 && res.status < 400 && isProductionOrigin(resolveRedirect(target, location))) {
      return { reachable: false, reason: "redirect-to-production", status: res.status };
    }
    if (/vercel\.com\/sso-api/i.test(location)) {
      return { reachable: false, reason: "sso-protection", status: res.status };
    }
    if (res.status >= 200 && res.status < 400 && !isProductionOrigin(res.url || target)) {
      if (res.status === 401 || res.status === 403) {
        return { reachable: false, reason: `http-${res.status}`, status: res.status };
      }
      return { reachable: true, reason: `http-${res.status}`, status: res.status };
    }
    if (res.status === 401 || res.status === 403) {
      return { reachable: false, reason: `http-${res.status}`, status: res.status };
    }
    return { reachable: false, reason: `http-${res.status}`, status: res.status };
  } catch (err) {
    return { reachable: false, reason: "probe-error", status: 0 };
  }
}

function pullRequestRefusesProduction(eventName, decision) {
  return String(eventName || "") === "pull_request" && isProductionOrigin(decision && decision.url);
}

function writeEnv(decision) {
  const githubEnv = process.env.GITHUB_ENV;
  if (!githubEnv) return;
  const lines = [
    `KUTADGU_BASE_URL=${decision.url}`,
    `KUTADGU_PREVIEW_URL=${decision.source === "pr-checkout-static" ? "" : decision.url}`,
    `KUTADGU_USE_LOCAL_STATIC=${decision.useLocalStatic ? "1" : "0"}`,
    `KUTADGU_E2E_SOURCE=${decision.source}`
  ];
  fs.appendFileSync(githubEnv, lines.join("\n") + "\n");
}

async function main() {
  const eventName = process.env.GITHUB_EVENT_NAME || "";
  const repo = process.env.GITHUB_REPOSITORY || "";
  const sha = process.env.PR_HEAD_SHA || process.env.GITHUB_SHA || "";
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "";
  const previewOptIn = String(process.env.KUTADGU_E2E_PREVIEW || "").trim();
  const extra = { eventName, commit: sha, vercelPreviewHost: "", vercelPreviewReachable: null, vercelPreviewReason: "" };

  let vercelPreviewUrl = "";
  if (shouldWaitForVercelPreview({ eventName, previewOptIn, repo, sha, token })) {
    const found = await waitForVercelPreview({ repo, sha, token });
    vercelPreviewUrl = found.url;
    extra.vercelPreviewReason = vercelPreviewUrl ? "found" : (found.error || "not-found");
  } else if (eventName === "pull_request" && previewRequested(previewOptIn)) {
    extra.vercelPreviewReason = "missing-repo-sha-or-token";
  } else if (eventName === "pull_request") {
    extra.vercelPreviewReason = "preview-not-requested";
  }

  let vercelReachable = false;
  if (vercelPreviewUrl) {
    extra.vercelPreviewHost = hostnameOf(vercelPreviewUrl);
    const probe = await probePreview(vercelPreviewUrl, bypass);
    vercelReachable = probe.reachable;
    extra.vercelPreviewReachable = probe.reachable;
    extra.vercelPreviewReason = probe.reason;
  }

  const decision = decideTarget({
    eventName,
    previewOptIn,
    previewUrl: process.env.KUTADGU_PREVIEW_URL,
    baseUrl: process.env.KUTADGU_BASE_URL,
    vercelPreviewUrl,
    vercelReachable,
    localOrigin: LOCAL_ORIGIN
  });

  const guarded = await enforceRedirectGuard(decision, fetch);
  if (!guarded.ok) {
    console.error(logTarget(guarded, extra));
    console.error("[e2e-target] stopped: " + (guarded.note || "no explicit test target"));
    process.exit(1);
  }

  if (pullRequestRefusesProduction(eventName, decision)) {
    console.error(logTarget(decision, extra));
    console.error("[e2e-target] refusing to test production on pull_request");
    process.exit(1);
  }

  console.log(logTarget(guarded, extra));
  writeEnv(guarded);
}

module.exports = {
  PRODUCTION,
  LOCAL_ORIGIN,
  hostnameOf,
  isProductionOrigin,
  isLoopbackOrigin,
  isPreviewOrigin,
  inspectRedirects,
  enforceRedirectGuard,
  pickPreviewFromStatuses,
  decideTarget,
  logTarget,
  previewRequested,
  shouldWaitForVercelPreview,
  pullRequestRefusesProduction,
  waitForVercelPreview,
  probePreview
};

if (require.main === module) {
  main().catch((err) => {
    console.error("[e2e-target] failed:", err && err.message ? err.message : err);
    process.exit(1);
  });
}
