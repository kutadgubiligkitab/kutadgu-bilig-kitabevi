"use strict";

const fs = require("fs");
const path = require("path");

const ASSERTION = /\b(?:expect|assert)\b|\.to(?:HaveAttribute|Contain|Equal|Be|HaveCount)\b/;
const HISTORICAL = /\b(?:fetch|route|fulfill|cached|force-cache)\b|\bnot\.to(?:Contain|Match|Have)|doesNotMatch|toBeGreaterThan|transferSize/;
const SCRIPT_ASSETS = ["shop.js", "admin.css", "admin.js", "admin-volume-groups.js"];

function readText(root, file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function htmlFiles(root) {
  return fs.readdirSync(root).filter((name) => name.endsWith(".html")).sort();
}

function versionsIn(text, asset) {
  const re = new RegExp(asset.replace(/\./g, "\\.") + "\\?v=(\\d+)", "g");
  return [...new Set([...text.matchAll(re)].map((match) => match[1]))];
}

function versionsInFile(root, file, asset) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return [];
  return versionsIn(readText(root, file), asset);
}

function versionsAcrossHtml(root, asset) {
  const found = new Set();
  for (const file of htmlFiles(root)) {
    for (const version of versionsInFile(root, file, asset)) found.add(version);
  }
  return [...found];
}

function accept(pins, problems, asset, versions, root) {
  if (versions.length !== 1 || !/^[1-9]\d*$/.test(versions[0])) {
    problems.push(versions.length
      ? `${asset} pin is not one positive integer (${versions.join(", ")})`
      : `missing current pin for ${asset}`);
    return;
  }
  if (!fs.existsSync(path.join(root, asset))) problems.push(`missing asset file ${asset}`);
  pins.set(asset, versions[0]);
}

function canonicalPins(root) {
  const pins = new Map();
  const problems = [];
  accept(pins, problems, "shop.js", versionsAcrossHtml(root, "shop.js"), root);
  for (const asset of ["admin.css", "admin.js", "admin-volume-groups.js"]) {
    accept(pins, problems, asset, versionsInFile(root, "admin.html", asset), root);
  }
  const optional = {
    "member.js": versionsAcrossHtml(root, "member.js"),
    "account.js": versionsInFile(root, "account.html", "account.js"),
    "feedback.js": versionsInFile(root, "feedback.html", "feedback.js"),
    "premium-ux.js": versionsInFile(root, "shop.js", "premium-ux.js"),
    "mobile.css": versionsAcrossHtml(root, "mobile.css"),
    "public-header.js": versionsAcrossHtml(root, "public-header.js"),
    "public-header.css": versionsInFile(root, "public-header.js", "public-header.css"),
    "supabase-config.js": versionsAcrossHtml(root, "supabase-config.js"),
    "header-diag.js": versionsInFile(root, "index.html", "header-diag.js"),
    "kutadgu-book-poster-gate.js": versionsAcrossHtml(root, "kutadgu-book-poster-gate.js")
  };
  for (const [asset, versions] of Object.entries(optional)) {
    if (!versions.length) continue;
    accept(pins, problems, asset, versions, root);
  }
  return { pins, problems };
}

function assetPin(asset, root = path.join(__dirname, "..")) {
  const { pins, problems } = canonicalPins(root);
  if (problems.length) throw new Error(problems.join("\n"));
  const pin = pins.get(asset);
  if (!pin) throw new Error(`missing current pin for ${asset}`);
  return pin;
}

function assetQuery(asset, root) {
  return asset + "?v=" + assetPin(asset, root);
}

function assetPattern(asset, root) {
  return new RegExp(asset.replace(/\./g, "\\.") + "\\?v=" + assetPin(asset, root));
}

function literalCurrent(line, asset, pin) {
  const escaped = asset.replace(/\./g, "\\.");
  return line.includes(`${asset}?v=${pin}`) || line.includes(`${escaped}\\?v=${pin}`);
}

function pinLiterals(line) {
  const found = [];
  const re = /([A-Za-z0-9_-]+(?:\\)?\.(?:js|css))\\?\?v=(\d+)/g;
  for (const match of line.matchAll(re)) {
    found.push({ asset: match[1].replace(/\\/g, ""), version: match[2] });
  }
  return found;
}

function explicitHistoricalLine(line) {
  return HISTORICAL.test(line)
    || /\b(?:fetch|route|fulfill)\s*\(/.test(line)
    || /\.toBe\(\s*false\s*\)/.test(line)
    || /(?:^|[^A-Za-z0-9_])(?:cached|old|released|warm|previous)/i.test(line);
}

function functionStart(lines, index) {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    if (/^\s*(?:async\s+)?(?:test|function)\b/.test(lines[cursor]) || /^\s*test\(/.test(lines[cursor])) return cursor;
  }
  return 0;
}

function injectedFixtureCovers(lines, index, asset, version) {
  const plain = `${asset}?v=${version}`;
  const escaped = `${asset.replace(/\./g, "\\.")}\\?v=${version}`;
  const start = functionStart(lines, index);
  for (let cursor = start; cursor < index; cursor += 1) {
    const line = lines[cursor];
    if (ASSERTION.test(line)) continue;
    if (!line.includes(plain) && !line.includes(escaped)) continue;
    if (/\.href\s*=|script src=|link href=/.test(line)) return true;
  }
  return false;
}

function walkJs(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "fixtures" || entry.name === "node_modules") continue;
      walkJs(full, out);
    } else if (entry.name.endsWith(".js")) out.push(full);
  }
}

function hardcodedCurrentPins(root) {
  const { pins, problems } = canonicalPins(root);
  const hits = [];
  if (problems.length) return { problems, hits };
  const files = [];
  walkJs(path.join(root, "tests", "e2e"), files);
  walkJs(path.join(root, "scripts"), files);
  for (const file of files) {
    const relative = path.relative(root, file).replace(/\\/g, "/");
    if (relative === "scripts/ci-asset-pins.js" || relative.startsWith("scripts/ci-asset-pin-preflight")) continue;
    const scriptScoped = relative.startsWith("scripts/");
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      const forced = line.match(/currentPin\)\.toBe\(\s*["'](\d+)["']\s*\)/);
      if (forced && !scriptScoped) {
        const expected = pins.get("admin.css");
        if (forced[1] === expected) hits.push(`${relative}:${index + 1} hard-codes current admin.css pin ${forced[1]}`);
        else hits.push(`${relative}:${index + 1} stale current admin.css pin ${forced[1]}; HTML pin is ${expected}`);
      }
      if (!ASSERTION.test(line) || explicitHistoricalLine(line)) return;
      for (const [asset, pin] of pins) {
        if (scriptScoped && !SCRIPT_ASSETS.includes(asset)) continue;
        if (!literalCurrent(line, asset, pin)) continue;
        hits.push(`${relative}:${index + 1} hard-codes current ${asset}?v=${pin}`);
      }
      if (!scriptScoped) {
        for (const literal of pinLiterals(line)) {
          const expected = pins.get(literal.asset);
          if (!expected || literal.version === expected) continue;
          if (injectedFixtureCovers(lines, index, literal.asset, literal.version)) continue;
          hits.push(`${relative}:${index + 1} stale current ${literal.asset}?v=${literal.version}; HTML pin is ${expected}`);
        }
      }
    });
  }
  return { problems, hits };
}

function checkAssetPins(root) {
  const { problems, hits } = hardcodedCurrentPins(root);
  return { ok: problems.length === 0 && hits.length === 0, problems: problems.concat(hits) };
}

module.exports = {
  assetPattern,
  assetPin,
  assetQuery,
  canonicalPins,
  checkAssetPins
};
