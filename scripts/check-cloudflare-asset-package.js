#!/usr/bin/env node
"use strict";

// Confirms the files Wrangler would upload match the Git blobs.
// Windows CRLF checkouts otherwise look like hundreds of asset edits.
// --normalize rewrites a file only when removing CR leaves the Git blob.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const normalize = process.argv.includes("--normalize");
const patterns = fs.readFileSync(path.join(root, ".assetsignore"), "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

function globToReg(pattern) {
  let expression = "";
  for (const char of pattern) {
    if (char === "*") expression += "[^/]*";
    else if (char === "?") expression += "[^/]";
    else if ("\\.^$+?()[]{}|".includes(char)) expression += "\\" + char;
    else expression += char;
  }
  return new RegExp("^" + expression + "$");
}

const rules = patterns.map((pattern) => globToReg(pattern));

function ignored(rel) {
  const parts = rel.split("\\").join("/").split("/");
  for (let index = 0; index < parts.length; index += 1) {
    const name = parts[index];
    const fromHere = parts.slice(index).join("/");
    if (rules.some((rule) => rule.test(name) || rule.test(fromHere))) return true;
  }
  return false;
}

function gitHash(args, input) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    input: input,
    maxBuffer: 8 * 1024 * 1024
  }).trim();
}

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const mismatches = [];
let normalized = 0;
let assets = 0;

for (const rel of tracked) {
  if (ignored(rel)) continue;
  assets += 1;
  const full = path.join(root, rel);
  const headHash = gitHash(["rev-parse", "HEAD:" + rel.split("\\").join("/")]);
  const rawHash = gitHash(["hash-object", "--no-filters", "--", rel]);
  if (rawHash === headHash) continue;
  const raw = fs.readFileSync(full);
  if (!raw.includes(0)) {
    const lf = Buffer.from(raw.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
    const lfHash = gitHash(["hash-object", "--no-filters", "--stdin"], lf);
    if (lfHash === headHash) {
      if (normalize) {
        fs.writeFileSync(full, lf);
        normalized += 1;
        continue;
      }
      mismatches.push(rel + " line-ending");
      continue;
    }
  }
  mismatches.push(rel + " content");
}

function walk(dir, base) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const rel = base ? base + "/" + entry.name : entry.name;
    if (ignored(rel)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full, rel));
    else if (entry.isFile()) found.push(rel);
  }
  return found;
}

const trackedSet = new Set(tracked.map((rel) => rel.split("\\").join("/")));
const untracked = walk(root, "").filter((rel) => !trackedSet.has(rel));
if (normalized) console.log("normalized " + normalized + " files to LF");
console.log("deployable tracked assets " + assets);
if (untracked.length || mismatches.length) {
  untracked.forEach((rel) => console.error("untracked asset " + rel));
  mismatches.forEach((rel) => console.error("differs from Git " + rel));
  process.exit(1);
}
console.log("asset bytes match Git");
