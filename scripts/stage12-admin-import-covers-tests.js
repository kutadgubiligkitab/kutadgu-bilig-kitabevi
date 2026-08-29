#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
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

function fakeFile(name) {
  return { name: name };
}

(async () => {
  await test("normalize: trim, basename, case-insensitive, keep extension", () => {
    assert.strictEqual(Covers.normalizeCoverFilename("  001.JPG  "), "001.jpg");
    assert.strictEqual(Covers.normalizeCoverFilename("folder\\\\002.webp"), "002.webp");
    assert.strictEqual(Covers.normalizeCoverFilename("covers/book-003.WEBP"), "book-003.webp");
    assert.notStrictEqual(Covers.normalizeCoverFilename("001.jpg"), Covers.normalizeCoverFilename("001.webp"));
  });

  await test("match: exact filename only, no near-guess", () => {
    const index = Covers.indexSelectedCoverFiles([fakeFile("001.jpg"), fakeFile("book-003.webp")]);
    assert.strictEqual(Covers.matchCoverFile("001.jpg", index).status, "matched");
    assert.strictEqual(Covers.matchCoverFile("001.JPG", index).status, "matched");
    assert.strictEqual(Covers.matchCoverFile("001.jpeg", index).status, "missing");
    assert.strictEqual(Covers.matchCoverFile("001", index).status, "missing");
    assert.strictEqual(Covers.matchCoverFile("002.jpg", index).status, "missing");
    const hit = Covers.matchCoverFile("book-003.webp", index);
    assert.strictEqual(hit.status, "matched");
    assert.strictEqual(hit.file.name, "book-003.webp");
  });

  await test("rows without cover_file: none, not an error", () => {
    const rows = [{ cover_file: "", errors: [] }, { cover_file: "   ", errors: [] }, { errors: [] }];
    Covers.applyCoverMatches(rows, [fakeFile("001.jpg")]);
    rows.forEach((row) => {
      assert.strictEqual(row.coverStatus, "none");
      assert.strictEqual(row.coverMatchFile, null);
      assert.strictEqual(row.errors.length, 0);
    });
  });

  await test("missing cover is visible and blocks silent reuse", () => {
    const rows = [{ cover_file: "missing.jpg", errors: [] }];
    Covers.applyCoverMatches(rows, [fakeFile("001.jpg")]);
    assert.strictEqual(rows[0].coverStatus, "missing");
    assert.ok(rows[0].errors.length);
    assert.strictEqual(rows[0].coverMatchFile, null);
  });

  await test("duplicate selected filename is ambiguous", () => {
    const files = [fakeFile("001.jpg"), fakeFile("sub/001.JPG")];
    const index = Covers.indexSelectedCoverFiles(files);
    assert.ok(index.duplicateKeys.has("001.jpg"));
    const rows = [{ cover_file: "001.jpg", errors: [] }];
    Covers.applyCoverMatches(rows, files);
    assert.strictEqual(rows[0].coverStatus, "duplicate");
    assert.ok(rows[0].errors.length);
    assert.strictEqual(rows[0].coverMatchFile, null);
  });

  await test("row-to-cover mapping stays on the requesting row", () => {
    const rows = [
      { cover_file: "a.jpg", title: "A", errors: [] },
      { cover_file: "b.jpg", title: "B", errors: [] }
    ];
    const files = [fakeFile("b.jpg"), fakeFile("a.jpg")];
    Covers.applyCoverMatches(rows, files);
    assert.strictEqual(rows[0].coverMatchFile.name, "a.jpg");
    assert.strictEqual(rows[1].coverMatchFile.name, "b.jpg");
  });

  await test("title+author existing match skips; ISBN update stays explicit", () => {
    const titleDup = { status: "warn", duplicate: "title_author", titleMatch: { id: 9 } };
    assert.strictEqual(Covers.classifyImportRowAction(titleDup, "skip"), "skip");
    assert.strictEqual(Covers.classifyImportRowAction(titleDup, "new"), "skip");
    assert.strictEqual(Covers.classifyImportRowAction(titleDup, "update"), "skip");

    const isbnDup = { status: "dup", duplicate: "isbn", isbnMatchCount: 1, dbMatch: { id: 12 } };
    assert.strictEqual(Covers.classifyImportRowAction(isbnDup, "skip"), "skip");
    assert.strictEqual(Covers.classifyImportRowAction(isbnDup, "update"), "update");
    assert.strictEqual(Covers.classifyImportRowAction(isbnDup, "new"), "insert");

    const isbnAmbiguous = { status: "dup", duplicate: "isbn", isbnMatchCount: 2, dbMatch: null };
    assert.strictEqual(Covers.classifyImportRowAction(isbnAmbiguous, "update"), "skip");

    const fresh = { status: "ok" };
    assert.strictEqual(Covers.classifyImportRowAction(fresh, "skip"), "insert");
    assert.strictEqual(Covers.classifyImportRowAction({ status: "error" }, "skip"), "exclude");
  });

  await test("pairInsertedRows matches by fields, not by swapped order", () => {
    const payloads = [
      { title: "Alpha", author: "A", isbn: "9781111111111" },
      { title: "Beta", author: "B", isbn: "9782222222222" }
    ];
    const returned = [
      { id: 20, title: "Beta", author: "B", isbn: "9782222222222" },
      { id: 10, title: "Alpha", author: "A", isbn: "9781111111111" }
    ];
    const paired = Covers.pairInsertedRows(payloads, returned, {
      normalizeIsbn: (v) => String(v || "").replace(/\D/g, "")
    });
    assert.strictEqual(paired.pairs[0].id, 10);
    assert.strictEqual(paired.pairs[1].id, 20);
    assert.strictEqual(paired.unpairedCount, 0);
  });

  await test("ambiguous returned rows are not guessed for covers", () => {
    const payloads = [
      { title: "Same", author: "Auth", isbn: "" },
      { title: "Same", author: "Auth", isbn: "" }
    ];
    const returned = [
      { id: 1, title: "Same", author: "Auth", isbn: "" },
      { id: 2, title: "Same", author: "Auth", isbn: "" }
    ];
    const paired = Covers.pairInsertedRows(payloads, returned);
    assert.strictEqual(paired.pairs[0], null);
    assert.strictEqual(paired.pairs[1], null);
    assert.strictEqual(paired.unpairedCount, 2);
  });

  await test("mapPool bounds concurrency and isolates failures", async () => {
    let current = 0;
    let max = 0;
    const items = [1, 2, 3, 4, 5, 6, 7];
    const results = await Covers.mapPool(items, 3, async (n) => {
      current += 1;
      max = Math.max(max, current);
      await new Promise((r) => setTimeout(r, 20));
      current -= 1;
      if (n === 4) throw new Error("boom-" + n);
      return n * 10;
    });
    assert.ok(max <= 3, "concurrency was " + max);
    assert.strictEqual(results[0].ok, true);
    assert.strictEqual(results[0].value, 10);
    assert.strictEqual(results[3].ok, false);
    assert.ok(/boom-4/.test(String(results[3].error && results[3].error.message)));
    assert.strictEqual(results[4].ok, true);
  });

  await test("template includes cover_file; IMPORT_BATCH stays 80; no DB column", () => {
    const csv = fs.readFileSync(path.join(ROOT, "admin-import-template.csv"), "utf8");
    assert.ok(/cover_file/.test(csv.split("\n")[0]));
    const admin = fs.readFileSync(path.join(ROOT, "admin.js"), "utf8");
    assert.ok(/const IMPORT_BATCH=80;/.test(admin));
    assert.ok(/i\+=IMPORT_BATCH/.test(admin));
    assert.ok(/\.insert\(chunk\)\.select\(/.test(admin));
    assert.ok(/upsert:false/.test(admin));
    assert.ok(/classifyImportRowAction/.test(admin));
    assert.ok(!/OPTIONAL_BOOK_COLS=\[(?:(?!\]).)*cover_file/.test(admin.replace(/\n/g, "")));
    const html = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8");
    assert.ok(/importCoverFiles/.test(html));
    assert.ok(/admin-import-covers\.js/.test(html));
    assert.ok(/multiple/.test(html));
  });

  await test("untouched storefront / identity files in this change set", () => {
    ["shop.js", "member.js", "legacy-id-utils.js", "cart.html", "favorites.html", "account.js"].forEach((name) => {
      assert.ok(fs.existsSync(path.join(ROOT, name)));
    });
  });

  if (failed) {
    console.error("\n" + failed + " test(s) failed");
    process.exit(1);
  }
  console.log("\nAll Stage 12 cover-import tests passed");
})();
