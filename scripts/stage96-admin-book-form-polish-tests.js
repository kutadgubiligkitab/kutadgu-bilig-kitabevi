#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
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

const adminHtml = read("admin.html");
const adminCss = read("admin.css");
const adminJs = read("admin.js");
const form = adminHtml.slice(adminHtml.indexOf('id="bookForm"'), adminHtml.indexOf('id="quickEditModal"'));
const isolation = read("scripts/auth-session-isolation-tests.js");
const stage94 = read("scripts/stage94-pending-book-edit-tests.js");
const stage95 = read("scripts/stage95-book-entry-suggest-tests.js");
const sqlFiles = fs.readdirSync(root).filter((name) => name.endsWith(".sql"));

const REQUIRED_IDS = [
  "bookModal", "bookModalTitle", "pendingEditHelp", "bookForm", "bookId",
  "bookTitle", "bookTitleSimilarWarning", "bookAuthor", "bookEntrySuggestHint",
  "bookIsbn", "bookPrice", "bookOriginalPriceStatus", "bookOriginalPriceCorrectBtn",
  "bookOriginalPriceResetBtn", "bookPriceHistoryBtn", "bookOriginalPriceNote",
  "bookStock", "bookStockDerivedStatus", "bookStockStatus", "bookSalesCount",
  "bookSource", "bookPages", "bookTranslator", "bookLanguage", "bookPublishDate",
  "bookPublishYear", "bookPublisher", "bookCoverType", "bookSize",
  "pendingOriginalPrice", "pendingDimensions", "pendingColorPrint",
  "bookInteriorPrintType", "bookDescriptionLabel", "bookDescription",
  "bookCover", "bookCoverPickBtn", "bookCoverPickStatus", "bookCoverPreview",
  "bookCoverText", "clearCoverPick", "bookGalleryHeading", "bookGallery",
  "bookGalleryPickBtn", "bookGalleryPickStatus", "bookGalleryStatus",
  "bookGalleryList", "bookIsActive", "bookIsNew", "bookIsRecommended",
  "createDuplicateWarning", "createDuplicateMessage", "createDuplicateMatches",
  "createDuplicateConfirm", "bookSaveBtn", "cancelBookEdit", "bookSaveDiag"
];

test("Admin book form keeps existing control IDs and data attributes", () => {
  REQUIRED_IDS.forEach((id) => {
    assert.match(adminHtml, new RegExp('id="' + id + '"'));
  });
  assert.match(form, /data-book-col="isbn"/);
  assert.match(form, /data-book-col="gallery_images"/);
  assert.match(form, /data-pending-hide="1"/);
  assert.match(form, /data-pending-only="1"/);
  assert.match(form, /data-save-mode="create"/);
});

test("five Uyghur section headings group the Full Admin book modal", () => {
  [
    "ئاساسىي ئۇچۇرلار",
    "باھا ۋە ئامبار",
    "نەشر ئۇچۇرلىرى",
    "رەسىملەر",
    "كۆرۈنۈش تەڭشەكلىرى"
  ].forEach((title) => {
    assert.match(form, new RegExp("admin-book-section-title\">" + title));
  });
  assert.doesNotMatch(form, /role="tablist"|data-book-step|Save and Approve|ساقلاش ۋە تەستىقلاش/);
});

test("help text is short and technical strings are not in the book form markup", () => {
  assert.match(form, />ئىختىيارىي\.</);
  assert.match(form, /0 = تۈگەپ كەتتى\./);
  assert.match(form, /تەرجىمە كىتابلارغىلا\./);
  assert.match(form, /مىلادىيە يىلى\./);
  assert.match(form, /قىسقىچە چۈشەندۈرۈش\./);
  assert.match(form, /تاللانمىسا ھازىرقى رەسىم ساقلىنىدۇ\./);
  assert.match(form, /ئەڭ كۆپ 4 پارچە\./);
  assert.match(form, /بۇرۇنقى ئۇچۇرلاردىن تاللىسىڭىز بولىدۇ\./);
  assert.match(adminHtml, /تۈزىتىپ ساقلىسىڭىز، كىتاب يەنىلا تەستىق كۈتۈپ تۇرىدۇ\./);
  assert.match(form, /خەلقئارا كىتاب نومۇرى \(ISBN\)/);
  assert.doesNotMatch(form, /\bNULL\b/);
  assert.doesNotMatch(form, /Completed sales only/);
  assert.doesNotMatch(form, />[^<]*image_url/);
  assert.doesNotMatch(form, /sample-book-cover\.png/);
  assert.doesNotMatch(form, /gallery رەسىم/);
});

test("sticky save bar is inside the book modal and save IDs are unchanged", () => {
  assert.match(form, /class="admin-book-form-footer"/);
  assert.match(form, /id="bookSaveBtn"/);
  assert.match(form, /id="cancelBookEdit"/);
  assert.match(adminCss, /#bookModal \.admin-book-form-footer/);
  assert.match(adminCss, /flex-shrink:\s*0/);
  assert.match(adminCss, /#bookForm\.admin-book-form/);
  assert.match(adminJs, /id="bookSaveBtn"|#bookSaveBtn/);
  assert.match(adminJs, /pendingEditMode\?"ئۆزگەرتىشلەرنى ساقلاش":"💾 ساقلاش"/);
  assert.doesNotMatch(adminJs, /Save and Approve|ساقلاش ۋە تەستىقلاش/);
});

test("cache pin is admin.css v=45; admin.js pin stays v=77", () => {
  assert.match(adminHtml, /admin\.css\?v=45/);
  assert.match(adminHtml, /admin\.js\?v=77/);
  assert.doesNotMatch(adminHtml, /admin\.css\?v=43/);
});

test("no backend, SQL, RLS, or suggestion data-logic rewrite", () => {
  assert.deepStrictEqual(sqlFiles.filter((name) => /STAGE96|BOOK_FORM_POLISH/i.test(name)), []);
  assert.doesNotMatch(adminJs, /CREATE POLICY|DROP POLICY|ALTER TABLE|service_role/);
  assert.match(adminJs, /rpc\("update_pending_staff_book_submission"/);
  assert.match(adminJs, /function bindBookEntrySuggestions/);
  assert.match(adminJs, /findCreateConflicts/);
  assert.match(isolation, /kutadgu-admin-auth-v1/);
  assert.match(stage94, /update_pending_staff_book_submission/);
  assert.match(stage95, /filterTitleMatches/);
});

if (failed) {
  console.error("\n" + failed + " stage96 admin book form polish test(s) failed");
  process.exit(1);
}
console.log("stage96-admin-book-form-polish-tests ok");
