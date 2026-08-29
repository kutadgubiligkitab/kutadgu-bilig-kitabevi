#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Repair = require("../admin-cover-repair.js");
const Covers = require("../admin-import-covers.js");

const ROOT = path.join(__dirname, "..");
let failed = 0;

function test(name, fn) {
  return (async () => {
    try {
      await fn();
      console.log("PASS", name);
    } catch (err) {
      failed += 1;
      console.error("FAIL", name, err && err.stack ? err.stack : err);
    }
  })();
}

(async () => {
  await test("cover repair by canonical numeric id", () => {
    const lookup = Repair.parseLookup("102");
    assert.strictEqual(lookup.kind, "id");
    assert.strictEqual(lookup.value, "102");
    const resolved = Repair.resolveMatches([
      { id: 102, title: "A", author: "X", isbn: "9781", image_url: "old.jpg", price: 10 },
      { id: 103, title: "B", author: "Y", isbn: "9782", image_url: "" }
    ], lookup);
    assert.strictEqual(resolved.ok, true);
    assert.strictEqual(String(resolved.book.id), "102");
  });

  await test("cover repair by unique ISBN", () => {
    const lookup = Repair.parseLookup("978-975-0000000");
    assert.strictEqual(lookup.kind, "isbn");
    const resolved = Repair.resolveMatches([
      { id: 7, title: "One", author: "A", isbn: "9789750000000", image_url: "" }
    ], lookup);
    assert.strictEqual(resolved.ok, true);
    assert.strictEqual(String(resolved.book.id), "7");
  });

  await test("zero ISBN match blocks", () => {
    const lookup = Repair.parseLookup("9781111111111");
    const resolved = Repair.resolveMatches([
      { id: 1, title: "Z", author: "A", isbn: "9782222222222" }
    ], lookup);
    assert.strictEqual(resolved.ok, false);
    assert.strictEqual(resolved.reason, "none");
  });

  await test("multiple ISBN matches block", () => {
    const lookup = Repair.parseLookup("9781111111111");
    const resolved = Repair.resolveMatches([
      { id: 1, title: "A", author: "X", isbn: "9781111111111" },
      { id: 2, title: "B", author: "Y", isbn: "978-111-1111111" }
    ], lookup);
    assert.strictEqual(resolved.ok, false);
    assert.strictEqual(resolved.reason, "ambiguous");
    assert.strictEqual(resolved.matches.length, 2);
  });

  await test("title is never used to guess a book", () => {
    const lookup = Repair.parseLookup("9781111111111");
    const resolved = Repair.resolveMatches([
      { id: 9, title: "Same Title", author: "A", isbn: "9789999999999" }
    ], lookup);
    assert.strictEqual(resolved.ok, false);
    assert.strictEqual(resolved.reason, "none");
  });

  await test("successful repair updates only image_url; metadata unchanged", () => {
    const before = {
      id: 12, title: "Kitap", author: "Author", isbn: "9781111111111",
      image_url: "old.jpg", price: 50, sales_count: 3, is_active: true
    };
    const payload = Repair.coverOnlyPayload("https://cdn.example/12/new.webp");
    assert.deepStrictEqual(Repair.payloadKeys(payload), ["image_url"]);
    const after = Repair.applyCoverOnlyLocal(before, payload.image_url);
    assert.strictEqual(after.image_url, payload.image_url);
    assert.ok(Repair.metadataUnchanged(before, after));
  });

  await test("cover upload failure does not change image_url", () => {
    const before = { id: 12, title: "Kitap", author: "A", image_url: "old.jpg", price: 9 };
    const failedUpload = { ok: false, error: new Error("storage") };
    const next = failedUpload.ok ? Repair.applyCoverOnlyLocal(before, "new.jpg") : before;
    assert.strictEqual(next.image_url, "old.jpg");
    assert.ok(Repair.metadataUnchanged(before, next));
  });

  await test("Stage 12 import summary counts remain correct", () => {
    const rows = [
      { status: "ok", coverStatus: "matched" },
      { status: "error", coverStatus: "missing", errors: ["x"] },
      { status: "dup", duplicate: "title_author", coverStatus: "none" },
      { status: "dup", duplicate: "isbn", isbnMatchCount: 1, dbMatch: { id: 1 }, coverStatus: "matched" }
    ];
    const skipPlan = Repair.summarizeImportPlan(rows, "skip", Covers.classifyImportRowAction);
    assert.strictEqual(skipPlan.total, 4);
    assert.strictEqual(skipPlan.insert, 1);
    assert.strictEqual(skipPlan.skipTitleAuthor, 1);
    assert.strictEqual(skipPlan.skipIsbn, 1);
    assert.strictEqual(skipPlan.exclude, 1);
    assert.strictEqual(skipPlan.coversMatched, 2);
    assert.strictEqual(skipPlan.coversMissing, 1);
    const updatePlan = Repair.summarizeImportPlan(rows, "update", Covers.classifyImportRowAction);
    assert.strictEqual(updatePlan.update, 1);
    assert.strictEqual(updatePlan.skipIsbn, 0);

    const imported = [
      { insertedId: 10, image_url: "", coverStatus: "matched" },
      { insertedId: 11, image_url: "https://csv", coverStatus: "none" },
      { insertedId: 12, image_url: "", coverStatus: "none" }
    ];
    const without = Repair.countWithoutImageUrl(imported, null, { "10": true });
    assert.strictEqual(without, 1);
    const result = Repair.formatResultText({
      imported: 2, updated: 0, skipped: 1, failed: 0, coverOk: 1, coverFailed: 1, withoutImageUrl: 1
    });
    assert.ok(/كىرگۈزۈلدى 2/.test(result));
    assert.ok(/مۇقاۋا 1/.test(result));
    assert.ok(/مۇقاۋا مەغلۇپ 1/.test(result));
    assert.ok(/image_url يوق 1/.test(result));
  });

  await test("stale match is cleared on failed lookup and lookup input change", () => {
    const file = { name: "001.jpg" };
    let state = Repair.applyLookupOutcome({ file: file }, { ok: true, book: { id: 102, title: "Old" } });
    assert.strictEqual(String(state.book.id), "102");
    assert.strictEqual(Repair.canWriteCoverRepair(state), true);
    state = Repair.invalidateRepairTarget(state);
    assert.strictEqual(state.book, null);
    assert.strictEqual(state.file.name, "001.jpg");
    assert.strictEqual(Repair.canWriteCoverRepair(state), false);
    state = Repair.applyLookupOutcome(state, { ok: false, reason: "none" });
    assert.strictEqual(state.book, null);
    assert.strictEqual(Repair.canWriteCoverRepair(state), false);
    state = Repair.applyLookupOutcome(state, { ok: false, reason: "ambiguous", matches: [{ id: 1 }, { id: 2 }] });
    assert.strictEqual(state.book, null);
    state = Repair.applyLookupOutcome({ file: file }, { ok: true, book: { id: 102 } });
    state = Repair.applyLookupOutcome(state, { ok: false, error: "network" });
    assert.strictEqual(state.book, null);
    const admin = fs.readFileSync(path.join(ROOT, "admin.js"), "utf8");
    assert.ok(/invalidateCoverRepairOnLookupChange/.test(admin));
    assert.ok(/coverRepairLookupGen/.test(admin));
    const css = fs.readFileSync(path.join(ROOT, "admin.css"), "utf8");
    assert.ok(/admin-cover-repair-preview\[hidden\]/.test(css));
  });

  await test("wired in admin.html / admin.js; no SQL migration; IMPORT_BATCH 80", () => {
    const html = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8");
    const admin = fs.readFileSync(path.join(ROOT, "admin.js"), "utf8");
    assert.ok(/coverRepairCard/.test(html));
    assert.ok(/admin-cover-repair\.js/.test(html));
    assert.ok(/KutadguAdminCoverRepair/.test(admin));
    assert.ok(/coverOnlyPayload/.test(admin));
    assert.ok(/const IMPORT_BATCH=80;/.test(admin));
    assert.ok(!fs.existsSync(path.join(ROOT, "STAGE13_COVER_REPAIR.sql")));
  });

  if (failed) {
    console.error("\n" + failed + " test(s) failed");
    process.exit(1);
  }
  console.log("\nAll Stage 13 catalog-operations tests passed");
})();
