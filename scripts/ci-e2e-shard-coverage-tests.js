#!/usr/bin/env node
"use strict";
const assert = require("assert");
const C = require("./ci-e2e-shard-coverage.js");

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

test("parseList keeps project, file, line, and title", () => {
  const ids = C.parseList([
    "Listing tests:",
    "  [chromium] › tests\\e2e\\one.spec.js:10:3 › suite › alpha",
    "  [chromium] › tests/e2e/two.spec.js:4:1 › beta",
    "Total: 2 tests in 2 files"
  ].join("\n"));
  assert.deepStrictEqual(ids, [
    "[chromium] › tests/e2e/one.spec.js:10:3 › suite › alpha",
    "[chromium] › tests/e2e/two.spec.js:4:1 › beta"
  ]);
});

test("combined shards must equal the unsharded set", () => {
  const match = C.compareShardIdentities(["a", "b", "c"], [["a", "c"], ["b"]]);
  assert.strictEqual(match.ok, true);
  const omitted = C.compareShardIdentities(["a", "b"], [["a"], []]);
  assert.strictEqual(omitted.ok, false);
  assert.ok(omitted.problems.some((problem) => problem.includes("omitted identity: b")));
  const duplicate = C.compareShardIdentities(["a", "b"], [["a"], ["a", "b"]]);
  assert.strictEqual(duplicate.ok, false);
  assert.ok(duplicate.problems.some((problem) => problem.includes("duplicate across shards")));
  const extra = C.compareShardIdentities(["a"], [[], ["b"]]);
  assert.strictEqual(extra.ok, false);
  assert.ok(extra.problems.some((problem) => problem.includes("unexpected shard identity")));
});

if (failed) process.exit(1);
console.log("ci-e2e-shard-coverage tests passed");
