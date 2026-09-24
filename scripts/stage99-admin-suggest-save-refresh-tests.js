#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const S = require("../kutadgu-book-entry-suggest.js");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, err && err.message);
  }
}
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const adminJs = read("admin.js");
const staffJs = read("book-staff.js");
const staffHtml = read("book-staff.html");
const adminHtml = read("admin.html");
const sqlFiles = fs.readdirSync(root).filter((name) => name.endsWith(".sql"));
const saveFn = adminJs.slice(adminJs.indexOf("async function saveBook(e){"), adminJs.indexOf("async function toggleActive("));
const pendingReturn = saveFn.slice(saveFn.indexOf("if(pendingSave){"), saveFn.indexOf("let payload=writeBookRow"));
const successTail = saveFn.slice(saveFn.indexOf("if(error)throw error;"), saveFn.indexOf("}catch(err){"));
const catchBlock = saveFn.slice(saveFn.indexOf("}catch(err){"), saveFn.indexOf("}finally{"));

const seed = [
  { id: 1, title: "كونا نام", author: "كونا ئاپتور", translator: "كونا تەرجىمان", publisher: "كونا نەشرىيات", isbn: "111" }
];

test("1 existing Admin suggestion load still memoizes by uid/promise", () => {
  assert.match(adminJs, /function loadAdminSuggestionRows\(/);
  assert.match(adminJs, /adminSuggestLoadUid===uid&&adminSuggestLoadPromise/);
  assert.match(adminJs, /S\.loadSuggestionRows\(db,\s*\{cacheKey:"admin"\}/);
  assert.match(adminJs, /openAuthorizedDashboard/);
});

test("2-7 upsert after successful save adds author/translator/publisher/title", () => {
  const created = S.upsertSuggestionRow(seed, {
    title: "يېڭى نام",
    author: "ئابدۇقادىر مەمەت",
    translator: "يېڭى تەرجىمان",
    publisher: "يېڭى نەشرىيات",
    isbn: "9789999999999"
  }, 88);
  assert.strictEqual(created.length, 2);
  assert.strictEqual(created[1].id, 88);
  assert.ok(S.uniqueValuesFromRows(created, "author").includes("ئابدۇقادىر مەمەت"));
  assert.ok(S.filterContains(S.uniqueValuesFromRows(created, "author"), "ئابدۇ", 8).includes("ئابدۇقادىر مەمەت"));
  assert.ok(S.uniqueValuesFromRows(created, "translator").includes("يېڭى تەرجىمان"));
  assert.ok(S.uniqueValuesFromRows(created, "publisher").includes("يېڭى نەشرىيات"));
  const titles = S.filterTitleMatches(created, "يېڭى نام");
  assert.ok(titles.some((row) => row.title === "يېڭى نام" && String(row.id) === "88"));
});

test("8 successful edit replaces the prior suggestion row by id", () => {
  const edited = S.upsertSuggestionRow(seed, {
    title: "يېڭىلانغان نام",
    author: "يېڭىلانغان ئاپتور",
    translator: "يېڭىلانغان تەرجىمان",
    publisher: "يېڭىلانغان نەشرىيات",
    isbn: "222"
  }, 1);
  assert.strictEqual(edited.length, 1);
  assert.strictEqual(edited[0].id, 1);
  assert.strictEqual(edited[0].title, "يېڭىلانغان نام");
  assert.strictEqual(edited[0].author, "يېڭىلانغان ئاپتور");
  assert.ok(!S.uniqueValuesFromRows(edited, "author").includes("كونا ئاپتور"));
});

test("9 failed save does not mutate suggestion state", () => {
  assert.doesNotMatch(catchBlock, /rememberAdminSuggestionRow/);
  assert.match(catchBlock, /ساقلاش مەغلۇپ بولدى/);
  assert.doesNotMatch(pendingReturn, /rememberAdminSuggestionRow/);
});

test("10 no duplicate row when the same saved id is processed again", () => {
  const once = S.upsertSuggestionRow(seed, { title: "A", author: "B" }, 1);
  const twice = S.upsertSuggestionRow(once, { title: "A2", author: "B2" }, "1");
  assert.strictEqual(twice.length, 1);
  assert.strictEqual(twice[0].title, "A2");
  assert.strictEqual(twice[0].author, "B2");
});

test("11-13 logout still clears; signed-out never loads; re-login still authorized", () => {
  const logout = adminJs.slice(adminJs.indexOf("async function logout("), adminJs.indexOf("function openImport("));
  assert.match(logout, /clearAdminSuggestionState\(\)/);
  const route = adminJs.slice(adminJs.indexOf("async function routeSession("), adminJs.indexOf("async function openAuthorizedDashboard("));
  assert.match(route, /clearAdminSuggestionState\(\)/);
  const gate = route.slice(route.indexOf("if(inspect.decision&&inspect.decision.gate)"), route.indexOf("await detectOptionalGalleryColumn"));
  assert.doesNotMatch(gate, /loadAdminSuggestionRows/);
  const dash = adminJs.slice(adminJs.indexOf("async function openAuthorizedDashboard("), adminJs.indexOf("function columnList("));
  assert.match(dash, /loadAdminSuggestionRows\(\)/);
});

test("14 Book Staff visibility/security behavior is unchanged", () => {
  assert.match(staffJs, /S\.loadSuggestionRows\(client,\s*\{cacheKey:"staff"\}/);
  assert.doesNotMatch(staffJs, /rememberAdminSuggestionRow|replaceSuggestionCache\("admin"/);
  assert.doesNotMatch(staffJs, /cacheKey:"admin"/);
  assert.doesNotMatch(staffJs, /kutadgu-admin-auth-v1|is_kutadgu_admin/);
  assert.match(staffJs, /rpc\("submit_book_for_approval"/);
});

test("15 no SQL/RLS/auth changes", () => {
  const newSql = sqlFiles.filter((name) => /SUGGEST_SAVE|SUGGESTION_REFRESH|STAGE99_ADMIN/i.test(name));
  assert.deepStrictEqual(newSql, []);
  assert.doesNotMatch(read("kutadgu-book-entry-suggest.js"), /CREATE POLICY|DROP POLICY|ALTER TABLE|service_role/);
  assert.doesNotMatch(saveFn, /CREATE POLICY|service_role/);
});

test("save path upserts only after confirmed persistBookRow success", () => {
  assert.match(successTail, /rememberAdminSuggestionRow/);
  assert.match(successTail, /persistSavedId\(persistResult,isEdit\?editingBookId:""\)/);
  assert.match(adminJs, /function rememberAdminSuggestionRow\(/);
  assert.match(adminJs, /function persistSavedId\(/);
  assert.match(adminJs, /S\.replaceSuggestionCache\("admin",next\)/);
  assert.match(adminJs, /adminSuggestLoadPromise=Promise\.resolve\(next\)/);
  assert.match(adminJs, /async function runPersist\(/);
  assert.doesNotMatch(pendingReturn, /persistBookRow/);
});

test("pins and Search 1A files stay out of this hotfix", () => {
  assert.match(adminHtml, /kutadgu-book-entry-suggest\.js\?v=2/);
  assert.match(adminHtml, /admin\.js\?v=79/);
  assert.match(staffHtml, /kutadgu-book-entry-suggest\.js\?v=2/);
  assert.doesNotMatch(adminJs, /kutadgu-search-rank|loadSearchRankIndex/);
});

if (failed) {
  console.error("\n" + failed + " stage99 admin suggest save refresh test(s) failed");
  process.exit(1);
}
console.log("stage99-admin-suggest-save-refresh-tests ok");
