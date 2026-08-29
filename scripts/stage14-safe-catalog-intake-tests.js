#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Intake = require("../admin-import-intake.js");

const ROOT = path.join(__dirname, "..");
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, err && err.stack ? err.stack : err);
  }
}

test("queue contains only books from the latest import rows", () => {
  const rows = [
    { insertedId: 10, title: "New", author: "A", image_url: "", coverStatus: "none" },
    { insertedId: 11, title: "Covered", author: "B", image_url: "", coverStatus: "matched" }
  ];
  const q = Intake.buildMissingCoverQueue(rows, { "11": true });
  assert.strictEqual(q.length, 1);
  assert.strictEqual(q[0].id, "10");
  assert.strictEqual(q[0].reason, "none");
});

test("successful cover uploads are not in the queue", () => {
  const rows = [
    { insertedId: 20, title: "Ok", author: "A", image_url: "", coverStatus: "matched" }
  ];
  const q = Intake.buildMissingCoverQueue(rows, { "20": true });
  assert.strictEqual(q.length, 0);
});

test("failed cover uploads are in the queue", () => {
  const rows = [
    { insertedId: 21, title: "Fail", author: "A", image_url: "", coverStatus: "matched" }
  ];
  const q = Intake.buildMissingCoverQueue(rows, {});
  assert.strictEqual(q.length, 1);
  assert.strictEqual(q[0].id, "21");
  assert.strictEqual(q[0].reason, "upload_failed");
});

test("rows with no requested cover: empty csv url queued; csv url not queued", () => {
  const rows = [
    { insertedId: 30, title: "Blank", author: "A", image_url: "", coverStatus: "none" },
    { insertedId: 31, title: "Csv", author: "B", image_url: "https://cdn.example/x.jpg", coverStatus: "none" }
  ];
  const q = Intake.buildMissingCoverQueue(rows, {});
  assert.strictEqual(q.length, 1);
  assert.strictEqual(q[0].id, "30");
  assert.strictEqual(q[0].reason, "none");
});

test("ISBN update without cover request is not queued", () => {
  const rows = [
    { dbMatch: { id: 40 }, title: "Old", author: "A", image_url: "", coverStatus: "none" }
  ];
  const q = Intake.buildMissingCoverQueue(rows, {});
  assert.strictEqual(q.length, 0);
});

test("repair action uses canonical numeric id only", () => {
  assert.strictEqual(Intake.repairLookupValue(102), "102");
  assert.strictEqual(Intake.repairLookupValue("102"), "102");
  assert.strictEqual(Intake.repairLookupValue("book-imp-abc"), "");
  assert.strictEqual(Intake.repairLookupValue(""), "");
});

test("queue replaces on next import and does not mix old runs", () => {
  const first = Intake.buildMissingCoverQueue([
    { insertedId: 1, title: "Old", author: "A", image_url: "", coverStatus: "none" }
  ], {});
  const second = Intake.buildMissingCoverQueue([
    { insertedId: 9, title: "New", author: "B", image_url: "", coverStatus: "matched" }
  ], {});
  const replaced = Intake.replaceLastImportQueue(first, second);
  assert.strictEqual(replaced.length, 1);
  assert.strictEqual(replaced[0].id, "9");
  assert.ok(!replaced.some((x) => x.id === "1"));
});

test("no full-catalog scan; IMPORT_BATCH 80; intake wired", () => {
  const admin = fs.readFileSync(path.join(ROOT, "admin.js"), "utf8");
  const intake = fs.readFileSync(path.join(ROOT, "admin-import-intake.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8");
  assert.ok(/const IMPORT_BATCH=80;/.test(admin));
  assert.ok(/KutadguAdminImportIntake/.test(admin));
  assert.ok(/buildMissingCoverQueue/.test(admin));
  assert.ok(!/from\("books"\)\.select\(/.test(intake));
  assert.ok(!/\.range\(0,\s*9999\)/.test(admin));
  assert.ok(/importBackupNote/.test(html));
  assert.ok(/lastImportCoverQueue/.test(html));
  assert.ok(/admin-import-intake\.js/.test(html));
  assert.ok(!fs.existsSync(path.join(ROOT, "STAGE14_INTAKE.sql")));
});

test("result text includes this-import queue count", () => {
  const line = Intake.appendQueueCount("تاماملاندى: كىرگۈزۈلدى 2", 3);
  assert.ok(/مۇقاۋا نۆۋىتى 3/.test(line));
});

if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
}
console.log("\nAll Stage 14 catalog-intake tests passed");
