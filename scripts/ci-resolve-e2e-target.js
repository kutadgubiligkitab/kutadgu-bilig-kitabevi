#!/usr/bin/env node
"use strict";
/**
 * Resolve the Stage 10 Playwright origin.
 * pull_request: never silently use production.
 * workflow_dispatch / local: keep the previous production default.
 */
const fs = require("fs");

const PRODUCTION = "https://kutadgu-bilig-kitab.vercel.app";
const LOCAL_ORIGIN = "http://127.0.0.1:4173";

function trimUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function hostnameOf(url) {
  try {
    return new URL(trimUrl(url) + "/").hostname.toLowerCase();
  } catch (err) {
    return "";
  }
}

function isProductionOrigin(url) {
  const host = hostnameOf(url);
  if (!host) return false;
  return host === "kutadgu-bilig-kitab.vercel.app"
    || host === "www.kutadgubilig.com"
    || host === "kutadgubilig.com";
}

function isPreviewOrigin(url) {
  const host = hostnameOf(url);
  return host.endsWith(".vercel.app") && !isProductionOrigin(url);
}

function pickPreviewFromStatuses(statuses) {
  const rows = Array.isArray(statuses) ? statuses : [];
  const hit = rows.find((row) => {
    const url = trimUrl(row && (row.environment_url || row.target_url));
    return String(row && row.state || "").toLowerCase() === "success" && isPreviewOrigin(url);
  });
  return hit ? trimUrl(hit.environment_url || hit.target_url) : "";
}

function decideTarget(input) {
  const eventName = String(input && input.eventName || "");
  const explicitPreview = trimUrl(input && input.previewUrl);
  const explicitBase = trimUrl(input && input.baseUrl);
  const vercelPreviewUrl = trimUrl(input && input.vercelPreviewUrl);
  const vercelReachable = !!(input && input.vercelReachable);
  const localOrigin = trimUrl(input && input.localOrigin) || LOCAL_ORIGIN;

  if (eventName === "pull_request") {
    if (vercelPreviewUrl && vercelReachable && !isProductionOrigin(vercelPreviewUrl)) {
      return { ok: true, url: vercelPreviewUrl, source: "vercel-preview", useLocalStatic: false };
    }
    if (explicitPreview && vercelReachable && !isProductionOrigin(explicitPreview)) {
      return { ok: true, url: explicitPreview, source: "env-preview", useLocalStatic: false };
    }
    return {
      ok: true,
      url: localOrigin,
      source: "pr-checkout-static",
      useLocalStatic: true,
      note: "Vercel Preview missing or not publicly reachable; refusing production fallback"
    };
  }

  if (explicitPreview) {
    return { ok: true, url: explicitPreview, source: "env-preview", useLocalStatic: false };
  }
  if (explicitBase) {
    return { ok: true, url: explicitBase, source: "env-base", useLocalStatic: false };
  }
  return { ok: true, url: PRODUCTION, source: "production-default", useLocalStatic: false };
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
  const extra = { eventName, commit: sha, vercelPreviewHost: "", vercelPreviewReachable: null, vercelPreviewReason: "" };

  let vercelPreviewUrl = "";
  if (eventName === "pull_request" && repo && sha && token) {
    const found = await waitForVercelPreview({ repo, sha, token });
    vercelPreviewUrl = found.url;
    extra.vercelPreviewReason = vercelPreviewUrl ? "found" : (found.error || "not-found");
  } else if (eventName === "pull_request") {
    extra.vercelPreviewReason = "missing-repo-sha-or-token";
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
    previewUrl: process.env.KUTADGU_PREVIEW_URL,
    baseUrl: process.env.KUTADGU_BASE_URL,
    vercelPreviewUrl,
    vercelReachable,
    localOrigin: LOCAL_ORIGIN
  });

  if (eventName === "pull_request" && isProductionOrigin(decision.url)) {
    console.error(logTarget(decision, extra));
    console.error("[e2e-target] refusing to test production on pull_request");
    process.exit(1);
  }

  console.log(logTarget(decision, extra));
  writeEnv(decision);
}

module.exports = {
  PRODUCTION,
  LOCAL_ORIGIN,
  isProductionOrigin,
  isPreviewOrigin,
  pickPreviewFromStatuses,
  decideTarget,
  logTarget,
  waitForVercelPreview,
  probePreview
};

if (require.main === module) {
  main().catch((err) => {
    console.error("[e2e-target] failed:", err && err.message ? err.message : err);
    process.exit(1);
  });
}
