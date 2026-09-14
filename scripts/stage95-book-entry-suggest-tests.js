#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const S = require("../kutadgu-book-entry-suggest.js");

let failed = 0;
const pending = [];
function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      pending.push(result.then(() => console.log("PASS", name)).catch((err) => {
        failed += 1;
        console.error("FAIL", name, err && err.message);
      }));
      return;
    }
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, err && err.message);
  }
}
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const rows = [
  { id: 1, title: "ئىسلام تارىخى", author: "ئابدۇللا ھاجى روزى", translator: "ئەلى تەرجىمان", publisher: "شىنجاڭ خەلق نەشرىياتى", isbn: "9781111111111" },
  { id: 2, title: "بالىلار ھېكايىسى", author: " ئابدۇللا ھاجى روزى ", translator: "  ", publisher: "شىنجاڭ خەلق نەشرىياتى", isbn: "9782222222222" },
  { id: 3, title: "يېڭى نام", author: "", translator: null, publisher: null, isbn: "" },
  { id: 4, title: "ھاجىلار يولى", author: "باشقا ئاپتور", translator: "ئەلى تەرجىمان", publisher: "مىللەتلەر نەشرىياتى", isbn: "9783333333333" }
];

const adminJs = read("admin.js");
const adminHtml = read("admin.html");
const staffJs = read("book-staff.js");
const staffHtml = read("book-staff.html");
const suggestJs = read("kutadgu-book-entry-suggest.js");
const quality = read("admin-book-quality.js");
const isolation = read("scripts/auth-session-isolation-tests.js");
const stage94 = read("scripts/stage94-pending-book-edit-tests.js");
const sqlFiles = fs.readdirSync(root).filter((name) => name.endsWith(".sql"));

test("author contains-match is not prefix-only and ignores empties while deduping", () => {
  const authors = S.uniqueValuesFromRows(rows, "author");
  assert.deepStrictEqual(authors, ["ئابدۇللا ھاجى روزى", "باشقا ئاپتور"]);
  const hits = S.filterContains(authors, "ھاجى", 8);
  assert.deepStrictEqual(hits, ["ئابدۇللا ھاجى روزى"]);
  assert.strictEqual(S.filterContains(authors, "xyz", 8).length, 0);
  assert.ok(S.filterContains(["Aaa", "baa", "cab", "da", "ea", "fa", "ga", "ha", "ia"], "a", 8).length <= 8);
});

test("translator and publisher unique contains filters work", () => {
  assert.deepStrictEqual(S.uniqueValuesFromRows(rows, "translator"), ["ئەلى تەرجىمان"]);
  assert.deepStrictEqual(S.uniqueValuesFromRows(rows, "publisher"), ["شىنجاڭ خەلق نەشرىياتى", "مىللەتلەر نەشرىياتى"]);
  assert.deepStrictEqual(S.filterContains(S.uniqueValuesFromRows(rows, "translator"), "تەرجى", 8), ["ئەلى تەرجىمان"]);
  assert.deepStrictEqual(S.filterContains(S.uniqueValuesFromRows(rows, "publisher"), "خەلق", 8), ["شىنجاڭ خەلق نەشرىياتى"]);
});

test("empty/null values never appear and free-text remains allowed", () => {
  const authors = S.uniqueValuesFromRows(rows, "author");
  assert.ok(authors.every((value) => String(value).trim() !== ""));
  assert.strictEqual(authors.includes(""), false);
  const typed = "يېڭى ئاپتور";
  assert.strictEqual(S.filterContains(authors, typed, 8).length, 0);
  assert.strictEqual(S.normalizeText(typed), typed);
});

test("title warning matches exact/similar titles and never auto-fills a title API", () => {
  const exact = S.filterTitleMatches(rows, "ئىسلام تارىخى");
  assert.strictEqual(exact[0].title, "ئىسلام تارىخى");
  assert.strictEqual(exact[0].author, "ئابدۇللا ھاجى روزى");
  assert.strictEqual(exact[0].isbn, "9781111111111");
  const similar = S.filterTitleMatches(rows, "ھاجى");
  assert.ok(similar.some((row) => row.title === "ھاجىلار يولى"));
  const excluded = S.filterTitleMatches(rows, "ئىسلام تارىخى", { excludeId: 1 });
  assert.ok(!excluded.some((row) => String(row.id) === "1"));
  assert.strictEqual(S.filterTitleMatches(rows, "x").length, 0);
  assert.doesNotMatch(suggestJs, /attachCombobox\([^\n]*title/i);
  assert.doesNotMatch(adminJs, /attachCombobox\(\$\("#bookTitle"/);
  assert.doesNotMatch(staffJs, /attachCombobox\(\$\("#staffTitle"/);
});

test("suggestion fetch is narrow, cached, and failure stays empty", async () => {
  S.clearSuggestionCache();
  let selects = 0;
  const client = {
    from(table) {
      assert.strictEqual(table, "books");
      return {
        select(fields) {
          selects += 1;
          assert.strictEqual(fields, S.SUGGEST_FIELDS);
          assert.doesNotMatch(fields, /image_url|description|gallery|price|cover/);
          return {
            range() {
              return Promise.resolve({ data: rows.slice(0, 2), error: null });
            }
          };
        }
      };
    }
  };
  const first = await S.loadSuggestionRows(client, { cacheKey: "unit-ok" });
  const second = await S.loadSuggestionRows(client, { cacheKey: "unit-ok" });
  assert.strictEqual(first.length, 2);
  assert.strictEqual(second, first);
  assert.strictEqual(selects, 1);

  const boom = {
    from() {
      return {
        select() {
          return {
            range() {
              return Promise.resolve({ data: null, error: new Error("permission") });
            }
          };
        }
      };
    }
  };
  const empty = await S.loadSuggestionRows(boom, { cacheKey: "unit-fail" });
  assert.deepStrictEqual(empty, []);
});

test("Admin uses Admin db client; Book Staff uses Member client and current books SELECT", () => {
  assert.match(adminJs, /S\.loadSuggestionRows\(db,\s*\{cacheKey:"admin"\}/);
  assert.match(staffJs, /memberApi\(\)\.getClient/);
  assert.match(staffJs, /S\.loadSuggestionRows\(client,\s*\{cacheKey:"staff"\}/);
  assert.doesNotMatch(staffJs, /kutadguAdminAuthOptions|kutadgu-admin-auth-v1|is_kutadgu_admin/);
  assert.doesNotMatch(staffJs, /update_pending_staff_book_submission|approve_staff_book_submission/);
  assert.doesNotMatch(staffJs, /cacheKey:"admin"/);
  assert.match(staffJs, /rpc\("submit_book_for_approval"/);
  const submitStart = staffJs.indexOf("async function submitBook(");
  const submitEnd = staffJs.indexOf("\nwindow.KutadguBookStaff=");
  const submit = staffJs.slice(submitStart, submitEnd);
  assert.doesNotMatch(submit, /filterTitleMatches|kutadgu-title-warn|similar/);
  assert.match(adminHtml, /kutadgu-book-entry-suggest\.js\?v=1/);
  assert.match(adminHtml, /admin\.js\?v=77/);
  assert.match(staffHtml, /book-staff\.js\?v=7/);
  assert.doesNotMatch(suggestJs, /<datalist|service_role/);
  assert.doesNotMatch(adminJs, /<datalist/);
  assert.doesNotMatch(staffJs, /<datalist/);
  assert.doesNotMatch(adminJs, /attachCombobox\(\$\("#bookSource"/);
  assert.doesNotMatch(staffJs, /attachCombobox\(\$\("#staffSource"/);
});

test("existing Admin title+author/ISBN duplicate protection remains", () => {
  const fn = adminJs.slice(adminJs.indexOf("async function findCreateConflicts"), adminJs.indexOf("function clearForm("));
  assert.match(fn, /\.eq\("title",t\)\.eq\("author",a\)/);
  assert.match(fn, /isbn\.eq/);
  assert.match(adminJs, /Quality\.shouldWarnCreateDuplicates\(plan\.operation,matches\)/);
  assert.match(quality, /function shouldWarnCreateDuplicates/);
  assert.match(adminHtml, /id="createDuplicateWarning"/);
  assert.match(adminHtml, /id="bookTitleSimilarWarning"/);
});

test("Admin suggestion fetch waits for authorized session and clears on logout", () => {
  const bind = adminJs.slice(adminJs.indexOf("function bindBookEntrySuggestions("), adminJs.indexOf("function bindBookListUx("));
  assert.doesNotMatch(bind, /loadSuggestionRows/);
  assert.match(adminJs, /function loadAdminSuggestionRows\(/);
  assert.match(adminJs, /function clearAdminSuggestionState\(/);
  const dash = adminJs.slice(adminJs.indexOf("async function openAuthorizedDashboard("), adminJs.indexOf("function columnList("));
  assert.match(dash, /loadAdminSuggestionRows\(\)/);
  assert.match(dash, /__kutadguSkipAdminAuth/);
  const route = adminJs.slice(adminJs.indexOf("async function routeSession("), adminJs.indexOf("async function openAuthorizedDashboard("));
  assert.match(route, /clearAdminSuggestionState\(\)/);
  assert.match(route, /inspect\.decision&&inspect\.decision\.gate/);
  const gate = route.slice(route.indexOf("if(inspect.decision&&inspect.decision.gate)"), route.indexOf("await detectOptionalGalleryColumn"));
  assert.doesNotMatch(gate, /loadAdminSuggestionRows/);
  const logout = adminJs.slice(adminJs.indexOf("async function logout("), adminJs.indexOf("function openImport("));
  assert.match(logout, /clearAdminSuggestionState\(\)/);
  assert.match(logout, /signOut\(\{scope:"local"\}\)/);
  assert.match(adminJs, /adminSuggestLoadUid===uid&&adminSuggestLoadPromise/);
  assert.doesNotMatch(staffJs, /loadAdminSuggestionRows|clearAdminSuggestionState|cacheKey:"admin"/);
});

test("Pending edit, gallery, isolation, and RLS files stay intact", () => {
  assert.match(adminJs, /rpc\("update_pending_staff_book_submission"/);
  assert.match(adminJs, /submission_status/);
  assert.match(stage94, /Save must remain Pending|pendingSave|submission_status = 'pending'/);
  assert.doesNotMatch(suggestJs, /gallery_images|uploadCover|bookCover/);
  assert.match(isolation, /kutadgu-member-auth-v1/);
  assert.match(isolation, /kutadgu-admin-auth-v1/);
  assert.match(adminJs, /kutadgu-admin-auth-v1/);
  assert.doesNotMatch(staffJs, /kutadgu-admin-auth-v1/);
  const newSql = sqlFiles.filter((name) => /STAGE95|BOOK_ENTRY_SUGGEST|TYPEAHEAD/i.test(name));
  assert.deepStrictEqual(newSql, []);
  assert.doesNotMatch(suggestJs, /CREATE POLICY|DROP POLICY|ALTER TABLE|service_role/);
  assert.doesNotMatch(adminJs.slice(adminJs.indexOf("function bindBookEntrySuggestions")), /CREATE POLICY/);
});

test("visible copy is Uyghur and hides technical jargon", () => {
  assert.match(adminHtml, /بۇرۇنقى ئۇچۇرلاردىن تاللىسىڭىز بولىدۇ/);
  assert.match(staffHtml, /بۇرۇن كىرگۈزۈلگەن ئۇچۇرلاردىن تاللىسىڭىز بولىدۇ/);
  const adminHint = adminHtml.match(/id="bookEntrySuggestHint"[^>]*>[\s\S]*?<\/p>/)[0];
  const staffHint = staffHtml.match(/id="staffEntrySuggestHint"[^>]*>[\s\S]*?<\/p>/)[0];
  const warnJs = suggestJs.match(/kutadgu-title-warn-msg">[^<]+/)[0];
  [adminHint, staffHint, warnJs].forEach((chunk) => {
    assert.doesNotMatch(chunk, /autocomplete|typeahead|query|database|RPC|cache/i);
    assert.match(chunk, /[\u0600-\u06FF]/);
  });
  assert.match(suggestJs, /بۇ نامغا ئوخشايدىغان كىتاب بار، قايتا تەكشۈرۈپ بېقىڭ/);
  assert.match(suggestJs, /role', 'combobox'/);
  assert.match(suggestJs, /role', 'listbox'/);
  assert.match(suggestJs, /aria-activedescendant/);
});

Promise.all(pending).then(() => {
  if (failed) {
    console.error("\n" + failed + " stage95 book entry suggest test(s) failed");
    process.exit(1);
  }
  console.log("stage95-book-entry-suggest-tests ok");
});
