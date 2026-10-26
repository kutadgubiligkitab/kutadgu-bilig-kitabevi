#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { checkAssetPins } = require("./ci-asset-pins");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, err.message);
  }
}

function write(root, file, text) {
  const full = path.join(root, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kutadgu-pin-"));
  write(root, "index.html", "<script src=\"shop.js?v=9\"></script>");
  write(root, "books.html", "<script src=\"shop.js?v=9\"></script>");
  write(root, "admin.html", "<link href=\"admin.css?v=4\"><script src=\"admin.js?v=8\"></script><script src=\"admin-volume-groups.js?v=2\"></script>");
  write(root, "shop.js", "/* shop */");
  write(root, "admin.css", "/* admin */");
  write(root, "admin.js", "/* admin */");
  write(root, "admin-volume-groups.js", "/* groups */");
  return root;
}

test("a consistent tree passes", () => {
  const root = fixture();
  const result = checkAssetPins(root);
  assert.strictEqual(result.ok, true, result.problems.join("\n"));
});

test("a missing current asset fails before any browser install", () => {
  const root = fixture();
  fs.unlinkSync(path.join(root, "admin.css"));
  const result = checkAssetPins(root);
  assert.strictEqual(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes("missing asset file admin.css")));
});

test("disagreeing shop.js pins fail", () => {
  const root = fixture();
  write(root, "cart.html", "<script src=\"shop.js?v=3\"></script>");
  const result = checkAssetPins(root);
  assert.strictEqual(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes("shop.js pin is not one positive integer")));
});

test("a hard-coded current pin fails and a historical pin stays", () => {
  const root = fixture();
  write(root, "tests/e2e/current.spec.js", "expect(src).toContain(\"shop.js?v=9\");\nexpect(cached).toContain(\"shop.js?v=4\");\n");
  const stale = checkAssetPins(root);
  assert.strictEqual(stale.ok, false);
  assert.ok(stale.problems.some((problem) => problem.includes("hard-codes current shop.js?v=9")));
  assert.ok(!stale.problems.some((problem) => problem.includes("v=4")));
  write(root, "tests/e2e/current.spec.js", "const cached = await fetch(\"/shop.js?v=9\");\nexpect(cached).toContain(\"shop.js?v=4\");\n");
  const historical = checkAssetPins(root);
  assert.strictEqual(historical.ok, true, historical.problems.join("\n"));
});

test("an HTML pin bump rejects an unchanged stale current assertion", () => {
  const root = fixture();
  write(root, "tests/e2e/current.spec.js", "expect(src).toContain(\"shop.js?v=9\");\n");
  write(root, "index.html", "<script src=\"shop.js?v=10\"></script>");
  write(root, "books.html", "<script src=\"shop.js?v=10\"></script>");
  const stale = checkAssetPins(root);
  assert.strictEqual(stale.ok, false);
  assert.ok(stale.problems.some((problem) => problem.includes("stale current shop.js?v=9")));
  assert.ok(stale.problems.some((problem) => problem.includes("HTML pin is 10")));
  write(root, "tests/e2e/current.spec.js", "await fetch(\"/shop.js?v=9\");\nexpect(cached).toContain(\"shop.js?v=9\");\n");
  const historical = checkAssetPins(root);
  assert.strictEqual(historical.ok, true, historical.problems.join("\n"));
});

test("the repository preflight command passes", () => {
  const ran = spawnSync(process.execPath, [path.join(__dirname, "ci-asset-pin-preflight.js")], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8"
  });
  assert.strictEqual(ran.status, 0, ran.stdout + ran.stderr);
  assert.match(ran.stdout, /asset pin preflight passed/);
});

if (failed) process.exit(1);
console.log("ci-asset-pin-preflight tests passed");
