#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const C = require("../catalog-credits.js");
const preview = require("../cloudflare/preview-dispatch.js");
const publicBook = require("../kutadgu-public-book.js");

const root = path.join(__dirname, "..");
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LONG = "مۇھەممەد ئابدۇللاھ ئابدۇلقادىر ئۇيغۇر تەتقىقاتى";
const AMBIGUOUS = "ئەنۋەر جاپپار، پەرھات جىلانوۋ";

let failed = 0;
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("legacy Arabic-comma names stay one identity", () => {
  const book = { author: AMBIGUOUS, translator: "شەھىدە، خەدىچە", publisher: "شىنجاڭ خەلق نەشرىياتى، قەشقەر ئۇيغۇر نەشرىياتى" };
  ["author", "translator", "publisher"].forEach((role) => {
    const entries = C.roleEntries(book, role);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].id, "");
    assert.ok(entries[0].name.includes("،"));
    assert.ok(!C.renderRoleValue(book, role).includes("<a"));
  });
  assert.strictEqual(C.legacySingleCredit(AMBIGUOUS).name, AMBIGUOUS);
});

test("two authors and two translators get independent links", () => {
  const book = {
    author: `${LONG}، پەرھات جىلانوۋ`,
    translator: "تۇرسۇنگۈل ياسىن، غەربىي ئات",
    credits: [
      { role: "author", position: 0, identity_id: A, catalog_identities: { id: A, display_name: LONG } },
      { role: "author", position: 1, identity_id: B, catalog_identities: { id: B, display_name: "پەرھات جىلانوۋ" } },
      { role: "translator", position: 0, identity_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", catalog_identities: { display_name: "تۇرسۇنگۈل ياسىن" } },
      { role: "translator", position: 1, identity_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", catalog_identities: { display_name: "غەربىي ئات (A&B)" } }
    ]
  };
  const authors = C.roleEntries(book, "author");
  assert.deepStrictEqual(authors.map((item) => item.name), [LONG, "پەرھات جىلانوۋ"]);
  const html = C.renderMetaRow("ئاپتورى", "author", book);
  assert.ok(html.includes(`/author/${A}`));
  assert.ok(html.includes(`/author/${B}`));
  assert.strictEqual(html.split('class="book-credit-all"').length - 1, 2);
  assert.ok(!html.includes(`${A}">${LONG}</a><a class="book-credit-all" href="/author/${B}"`));
  const translators = C.renderMetaRow("تەرجىمە قىلغۇچى", "translator", book);
  assert.ok(translators.includes("/translator/cccccccc-cccc-4ccc-8ccc-cccccccccccc"));
  assert.ok(translators.includes("/translator/dddddddd-dddd-4ddd-8ddd-dddddddddddd"));
  assert.ok(translators.includes("غەربىي ئات (A&amp;B)"));
});

test("the same person is a different link as author and translator", () => {
  assert.strictEqual(C.creditHref("author", A), `/author/${A}`);
  assert.strictEqual(C.creditHref("translator", A.toUpperCase()), `/translator/${A}`);
  assert.notStrictEqual(C.creditHref("author", A), C.creditHref("translator", A));
  const book = {
    credits: [
      { role: "author", position: 0, identity_id: A, catalog_identities: { display_name: "ئابدۇللا" } },
      { role: "translator", position: 0, identity_id: A, catalog_identities: { display_name: "ئابدۇللا" } }
    ]
  };
  assert.strictEqual(C.sameCredit(book, "author", A), true);
  assert.strictEqual(C.sameCredit(book, "publisher", A), false);
});

test("credit paths accept only one uuid and keep Uyghur names intact", () => {
  assert.strictEqual(C.parseCreditPath(`/author/${A}`).valid, true);
  assert.strictEqual(C.parseCreditPath("/author/not-a-uuid").valid, false);
  assert.strictEqual(C.parseCreditPath("/author/%2e%2e").valid, false);
  assert.strictEqual(C.parseCreditPath("/author/..").valid, false);
  assert.strictEqual(C.parseCreditPath("/author/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/extra"), null);
  assert.strictEqual(C.parseCreditPath(`/author/${encodeURIComponent(A)}`).id, A);
  assert.strictEqual(C.displayName("  " + LONG + "  "), LONG);
  assert.strictEqual(C.renderAuthorLine({ author: LONG }), `ئاپتورى: ${LONG}`);
  assert.strictEqual(C.renderMetaRow("تەرجىمە قىلغۇچى", "translator", { translator: "" }), "");
  assert.strictEqual(C.renderMetaRow("نەشرىيات", "publisher", { publisher: "—" }), "");
});

test("credit catalog filter is an exact association, not a search", () => {
  const params = new URLSearchParams("select=*");
  assert.strictEqual(C.applyCreditFilter(params, { creditId: A.toUpperCase(), creditRole: "Author" }), true);
  assert.strictEqual(params.get("book_credits.identity_id"), `eq.${A}`);
  assert.strictEqual(params.get("book_credits.role"), "eq.author");
  assert.strictEqual(params.get("is_active"), "eq.true");
  assert.ok(params.get("select").includes("book_credits!inner(identity_id,role)"));
  assert.ok(!params.toString().includes("ilike"));
  assert.strictEqual(C.applyCreditFilter(new URLSearchParams(), { creditId: "nope", creditRole: "author" }), false);
  assert.deepStrictEqual(C.dedupeCreditRows([{ id: 7 }, { id: "7" }, { id: 8 }, { id: "" }]).map((row) => row.id), [7, 8]);
});

test("save plan keeps order, rejects duplicates, and does not wipe a blocked load", () => {
  const saved = C.planCreditSave({
    authors: [" ئابدۇللا ", "", "پەرھات"],
    translators: ["تۇرسۇن", "ياسىن"],
    publisher: "شىنجاڭ خەلق نەشرىياتى"
  });
  assert.strictEqual(saved.ok, true);
  assert.deepStrictEqual(saved.authors, ["ئابدۇللا", "پەرھات"]);
  assert.strictEqual(saved.legacy.author, "ئابدۇللا، پەرھات");
  assert.strictEqual(saved.legacy.translator, "تۇرسۇن، ياسىن");
  assert.strictEqual(C.planCreditSave({ authors: ["ئابدۇللا"] }).legacy.author, "ئابدۇللا");
  const duplicate = C.planCreditSave({ authors: ["ئابدۇللا", "ئابدۇللا"] });
  assert.strictEqual(duplicate.ok, false);
  assert.strictEqual(duplicate.error, "duplicate");
  assert.ok(duplicate.message.includes("ئاپتور"));
  assert.strictEqual(C.planCreditSave({ authors: ["", "—"] }).error, "required");
  const blocked = C.planCreditSave({ blocked: true, authors: ["يېڭى ئىسىم"], translators: ["باشقا"], publisher: "باشقا نەشر" });
  assert.strictEqual(blocked.ok, true);
  assert.strictEqual(blocked.omitLegacy, true);
  assert.strictEqual(blocked.writeCredits, false);
  assert.deepStrictEqual(blocked.authors, []);
  const legacyOnly = C.planCreditSave({ legacyOnly: true, authors: ["ئابدۇللا", "پەرھات"], translators: [], publisher: "" });
  assert.strictEqual(legacyOnly.writeCredits, false);
  assert.strictEqual(legacyOnly.omitLegacy, false);
  assert.strictEqual(legacyOnly.legacy.author, "ئابدۇللا، پەرھات");
});

test("listing summary and worker rewrite", () => {
  assert.strictEqual(C.summaryText("author", 13), "ئاپتور · جەمئىي 13 كىتاب");
  assert.strictEqual(C.summaryText("translator", 0), "تەرجىمان · جەمئىي 0 كىتاب");
  const route = preview.classifyPath(`/author/${A}`, "");
  assert.strictEqual(route.kind, "rewrite");
  assert.strictEqual(route.file, "/credit-books.html");
  assert.strictEqual(preview.classifyPath("/author/not-a-uuid", "").file, "/credit-books.html");
});

test("server book html links structured credits and ignores a non-credit payload", async () => {
  const shell = `<div class="book-detail-info"><h1>old</h1><div class="book-author">ئاپتورى: —</div></div><div class="book-meta"></div>`;
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (String(url).includes("/book_credits")) {
      return { status: 200, json: async () => [{ id: 101, title: "not credits" }] };
    }
    return {
      status: 200,
      json: async () => [{ id: 101, title: "قۇتادغۇ بىلىك", author: LONG, price: 10, is_active: true }]
    };
  };
  const plain = await publicBook.lookupPublicNumericBook("101", { fetchImpl });
  assert.strictEqual(plain.outcome, "found");
  assert.ok(!plain.book.credits);
  const plainHtml = publicBook.applyFoundPublicBookHead(shell, "101", plain.book);
  assert.ok(plainHtml.includes(`ئاپتورى: ${LONG}`));
  assert.ok(!plainHtml.includes("book-credit-name"));
  const linkedFetch = async (url) => {
    if (String(url).includes("/book_credits")) {
      return {
        status: 200,
        json: async () => [{ role: "author", position: 0, identity_id: A, catalog_identities: { id: A, display_name: LONG } }]
      };
    }
    return { status: 200, json: async () => [{ id: 101, title: "قۇتادغۇ بىلىك", author: LONG, price: 10 }] };
  };
  const linked = await publicBook.lookupPublicNumericBook("101", { fetchImpl: linkedFetch });
  const linkedHtml = publicBook.applyFoundPublicBookHead(shell, "101", linked.book);
  assert.ok(linkedHtml.includes(`/author/${A}`));
  assert.ok(linkedHtml.includes(LONG));
  assert.ok(calls >= 2);
});

test("admin and staff saves cannot drop contributors when the credit load is blocked", () => {
  const admin = fs.readFileSync(path.join(root, "admin.js"), "utf8");
  const staff = fs.readFileSync(path.join(root, "book-staff.js"), "utf8");
  assert.ok(admin.includes("applyCreditColumns(row,creditPlan)"));
  assert.ok(admin.includes("delete pendingPayload.author"));
  assert.ok(admin.includes('rpc("set_book_credits"'));
  assert.ok(staff.includes('rpc("set_own_pending_book_credits"'));
  assert.ok(staff.includes("values.author=creditPlan.legacy.author"));
  const sql = fs.readFileSync(path.join(root, "STAGE106_CATALOG_CREDITS.sql"), "utf8");
  assert.ok(sql.includes("does not split"));
  assert.ok(sql.includes("enable row level security"));
  assert.ok(sql.includes("is_kutadgu_admin()"));
  assert.ok(sql.includes("is_kutadgu_book_staff()"));
  assert.ok(!/split_part\s*\(/i.test(sql));
});

(async () => {
  for (const item of tests) {
    try {
      await item.fn();
      console.log("PASS", item.name);
    } catch (err) {
      failed++;
      console.error("FAIL", item.name, err && err.stack || err);
    }
  }
  if (failed) {
    console.error("\n" + failed + " catalog credit test(s) failed");
    process.exit(1);
  }
  console.log("catalog-credits-tests ok");
})();
