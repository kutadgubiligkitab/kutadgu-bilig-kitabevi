#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const G = require("./ci-e2e-gate.js");

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

function records(pairs) {
  return pairs.map(([shard, outcome]) => ({ shard, total: 2, outcome }));
}

test("both successful shards pass the gate", () => {
  const result = G.evaluateGate({
    needsResult: "success",
    records: records([[1, "success"], [2, "success"]])
  });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.problems, []);
});

test("a missing shard fails the gate", () => {
  const result = G.evaluateGate({
    needsResult: "success",
    records: records([[1, "success"]])
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes("missing shard 2")));
});

test("a failed shard fails the gate", () => {
  const result = G.evaluateGate({
    needsResult: "failure",
    records: records([[1, "success"], [2, "failure"]])
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes("shard 2 outcome is failure")));
  assert.ok(result.problems.some((problem) => problem.includes("shard job result is failure")));
});

test("a cancelled shard fails the gate", () => {
  const result = G.evaluateGate({
    needsResult: "cancelled",
    records: records([[1, "cancelled"], [2, "success"]])
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes("shard 1 outcome is cancelled")));
  assert.ok(result.problems.some((problem) => problem.includes("shard job result is cancelled")));
});

test("a skipped shard fails the gate", () => {
  const result = G.evaluateGate({
    needsResult: "skipped",
    records: records([[1, "skipped"], [2, "success"]])
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes("shard 1 outcome is skipped")));
});

test("success files do not hide a failed shard job", () => {
  const result = G.evaluateGate({
    needsResult: "failure",
    records: records([[1, "success"], [2, "success"]])
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes("shard job result is failure")));
});

test("an empty result set fails the gate", () => {
  const result = G.evaluateGate({ needsResult: "success", records: [] });
  assert.strictEqual(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes("missing shard 1")));
  assert.ok(result.problems.some((problem) => problem.includes("missing shard 2")));
});

test("duplicate or unexpected shard records fail the gate", () => {
  const duplicate = G.evaluateGate({
    needsResult: "success",
    records: records([[1, "success"], [1, "success"], [2, "success"]])
  });
  assert.strictEqual(duplicate.ok, false);
  assert.ok(duplicate.problems.some((problem) => problem.includes("duplicate shard 1")));
  const extra = G.evaluateGate({
    needsResult: "success",
    records: records([[1, "success"], [2, "success"], [3, "success"]])
  });
  assert.strictEqual(extra.ok, false);
  assert.ok(extra.problems.some((problem) => problem.includes("unexpected shard 3")));
});

test("a shard that reports the wrong total fails the gate", () => {
  const result = G.evaluateGate({
    needsResult: "success",
    records: [{ shard: 1, total: 1, outcome: "success" }, { shard: 2, total: 2, outcome: "success" }]
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes("shard 1 total is 1")));
});

test("command line record and check fail closed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kutadgu-e2e-gate-"));
  const script = path.join(__dirname, "ci-e2e-gate.js");
  const first = path.join(dir, "e2e-shard-1-result", G.RESULT_NAME);
  fs.mkdirSync(path.dirname(first), { recursive: true });
  const recorded = spawnSync(process.execPath, [
    script, "record", "--shard", "1", "--total", "2", "--outcome", "failure", "--file", first
  ], { encoding: "utf8" });
  assert.strictEqual(recorded.status, 0, recorded.stderr);
  const missing = spawnSync(process.execPath, [
    script, "check", "--dir", dir, "--needs", "success"
  ], { encoding: "utf8" });
  assert.notStrictEqual(missing.status, 0);
  assert.match(missing.stderr, /missing shard 2/);
  assert.match(missing.stderr, /shard 1 outcome is failure/);
  const secondDir = path.join(dir, "e2e-shard-2-result");
  fs.mkdirSync(secondDir);
  fs.writeFileSync(path.join(secondDir, G.RESULT_NAME), JSON.stringify({ shard: 2, total: 2, outcome: "success" }));
  fs.writeFileSync(first, JSON.stringify({ shard: 1, total: 2, outcome: "success" }));
  const passed = spawnSync(process.execPath, [
    script, "check", "--dir", dir, "--needs", "success"
  ], { encoding: "utf8" });
  assert.strictEqual(passed.status, 0, passed.stderr);
  const cancelled = spawnSync(process.execPath, [
    script, "check", "--dir", dir, "--needs", "cancelled"
  ], { encoding: "utf8" });
  assert.notStrictEqual(cancelled.status, 0);
  assert.match(cancelled.stderr, /shard job result is cancelled/);
});

if (failed) process.exit(1);
console.log("ci-e2e-gate tests passed");
