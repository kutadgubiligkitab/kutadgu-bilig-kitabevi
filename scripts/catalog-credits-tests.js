#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
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
  assert.ok(admin.includes("loadCreditEditor"));
  assert.ok(!/function loadEditorCredits[\s\S]{0,180}creditSaveMode="ready"/.test(admin));
  assert.ok(staff.includes('rpc("set_own_pending_book_credits"'));
  assert.ok(staff.includes("values.author=creditPlan.legacy.author"));
  assert.ok(staff.includes('outcome.panel!=="success"'));
  const sql = fs.readFileSync(path.join(root, "STAGE106_CATALOG_CREDITS.sql"), "utf8");
  assert.ok(sql.includes("does not split"));
  assert.ok(sql.includes("enable row level security"));
  assert.ok(sql.includes("is_kutadgu_admin()"));
  assert.ok(sql.includes("is_kutadgu_book_staff()"));
  assert.ok(!/split_part\s*\(/i.test(sql));
  assert.ok(sql.includes("catalog_credit_legacy_ambiguous"));
  const corrections = fs.readFileSync(path.join(root, "STAGE106_CATALOG_CREDIT_CORRECTIONS.sql"), "utf8");
  assert.ok(corrections.includes("Reading public.catalog_credit_review does not separate"));
  assert.ok(!/split_part\s*\(/i.test(corrections));
  assert.ok(!/regexp_split_to_array\s*\(/i.test(corrections));
  assert.ok(corrections.includes("ئەنۋەر جاپپار، پەرھات جىلانوۋ، قادىر قاۋۇز"));
  assert.ok(corrections.includes("شەھىدە، خەدىچە"));
  assert.ok(corrections.includes("شىنجاڭ خەلق نەشرىياتى، قەشقەر ئۇيغۇر نەشرىياتى"));
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("save while the credits query is delayed does not write contributors", async () => {
  const editor = C.createCreditEditor();
  const token = editor.openBook(11);
  const query = deferred();
  const pending = C.loadCreditEditor(editor, token, 11, () => query.promise);
  assert.strictEqual(editor.snapshot().mode, "loading");
  const plan = C.planCreditSave({
    loading: true,
    authors: ["ئەھمەد", "باتۇر"],
    translators: [],
    publisher: ""
  });
  assert.strictEqual(plan.ok, false);
  assert.strictEqual(plan.error, "loading");
  assert.strictEqual(plan.writeCredits, false);
  assert.strictEqual(C.legacyColumnsForBookWrite(plan), null);
  let bookWrites = 0;
  let creditWrites = 0;
  const outcome = await C.commitAdminContributorWrite({
    plan,
    writeBook: async () => {
      bookWrites += 1;
      return { error: null };
    },
    writeCredits: async () => {
      creditWrites += 1;
      return { error: null };
    },
    writeLegacyText: async () => ({ error: null })
  });
  assert.strictEqual(outcome.status, "blocked");
  assert.strictEqual(bookWrites, 0);
  assert.strictEqual(creditWrites, 0);
  query.resolve({ ok: true, rows: [{ role: "author", position: 0 }] });
  const settled = await pending;
  assert.strictEqual(settled.applied, true);
  assert.strictEqual(editor.snapshot().mode, "ready");
});

test("book A response is ignored after book B is opened", async () => {
  const editor = C.createCreditEditor();
  const tokenA = editor.openBook(1);
  const queryA = deferred();
  const loadA = C.loadCreditEditor(editor, tokenA, 1, () => queryA.promise);
  const tokenB = editor.openBook(2);
  const queryB = deferred();
  const loadB = C.loadCreditEditor(editor, tokenB, 2, () => queryB.promise);
  queryA.resolve({ ok: true, rows: [{ role: "author", display_name: "A" }] });
  const settledA = await loadA;
  assert.strictEqual(settledA.ignored, true);
  assert.strictEqual(settledA.applied, false);
  assert.strictEqual(editor.snapshot().bookId, "2");
  assert.strictEqual(editor.snapshot().mode, "loading");
  queryB.resolve({ ok: true, rows: [{ role: "author", display_name: "B" }] });
  const settledB = await loadB;
  assert.strictEqual(settledB.applied, true);
  assert.deepStrictEqual(settledB.rows, [{ role: "author", display_name: "B" }]);
});

test("closing or resetting the editor drops a late credit response", async () => {
  const editor = C.createCreditEditor();
  const token = editor.openBook(4);
  const query = deferred();
  const pending = C.loadCreditEditor(editor, token, 4, () => query.promise);
  editor.openCreate();
  query.resolve({ ok: true, rows: [{ role: "author", display_name: "كېچىككەن" }] });
  const settled = await pending;
  assert.strictEqual(settled.ignored, true);
  assert.strictEqual(settled.applied, false);
  assert.strictEqual(editor.snapshot().mode, "create");
  editor.markDirty();
  const again = editor.openBook(4);
  editor.markDirty();
  const kept = C.settleCreditLoad(editor, again, 4, { ok: true, rows: [{ role: "author" }] });
  assert.strictEqual(kept.applied, false);
  assert.strictEqual(kept.keptInput, true);
  assert.deepStrictEqual(kept.applyRoles, []);
});

test("a failed load stays blocked when a contributor field is already dirty", () => {
  ["publisher", "author", "translator"].forEach((role) => {
    const editor = C.createCreditEditor();
    const token = editor.openBook(9);
    editor.markDirty(role);
    const settled = C.settleCreditLoad(editor, token, 9, { ok: false, error: new Error("down") });
    assert.strictEqual(settled.mode, "blocked");
    assert.notStrictEqual(settled.mode, "ready");
    assert.strictEqual(settled.applied, false);
    assert.deepStrictEqual(settled.applyRoles, []);
  });
});

test("a successful load hydrates only the roles that were not edited", () => {
  const rows = [{ role: "author", display_name: "Alice" }, { role: "translator", display_name: "Carol" }];
  ["publisher", "author", "translator"].forEach((role) => {
    const editor = C.createCreditEditor();
    const token = editor.openBook(9);
    editor.markDirty(role);
    const settled = C.settleCreditLoad(editor, token, 9, { ok: true, rows });
    assert.strictEqual(settled.mode, "ready");
    assert.strictEqual(settled.applied, false);
    assert.strictEqual(settled.keptInput, true);
    assert.deepStrictEqual(settled.rows, rows);
    assert.deepStrictEqual(settled.applyRoles, ["author", "translator", "publisher"].filter((item) => item !== role));
  });
});

test("a failed credit load keeps contributors out of an unrelated edit", async () => {
  const editor = C.createCreditEditor();
  const token = editor.openBook(9);
  const settled = await C.loadCreditEditor(editor, token, 9, async () => {
    throw new Error("network down");
  });
  assert.strictEqual(settled.applied, false);
  assert.strictEqual(settled.mode, "blocked");
  const plan = C.planCreditSave({
    blocked: true,
    authors: ["يېڭى ئىسىم"],
    translators: ["تەرجىمان"],
    publisher: "نەشرىيات"
  });
  assert.strictEqual(plan.writeCredits, false);
  assert.strictEqual(plan.omitLegacy, true);
  const state = { title: "كونا", author: "ئەسلى ئاپتور", credits: ["ئەسلى ئاپتور"] };
  const outcome = await C.commitAdminContributorWrite({
    plan,
    writeBook: async (columns) => {
      assert.strictEqual(columns, null);
      state.title = "يېڭى ماۋزۇ";
      return { error: null };
    },
    writeCredits: async () => {
      throw new Error("credits must not be called");
    },
    writeLegacyText: async () => {
      throw new Error("legacy text must not be called");
    }
  });
  assert.strictEqual(outcome.status, "book-saved");
  assert.strictEqual(outcome.creditsCalled, false);
  assert.strictEqual(state.author, "ئەسلى ئاپتور");
  assert.deepStrictEqual(state.credits, ["ئەسلى ئاپتور"]);
  assert.strictEqual(state.title, "يېڭى ماۋزۇ");
});

test("a rejected credit RPC does not replace contributors or report success", async () => {
  const plan = C.planCreditSave({
    authors: ["ئەھمەد", "باتۇر"],
    translators: ["تەرجىمان"],
    publisher: "نەشر"
  });
  assert.strictEqual(C.legacyColumnsForBookWrite(plan), null);
  const state = { author: "ئەھمەد، باتۇر", credits: ["ئەھمەد", "باتۇر"] };
  let legacyCalls = 0;
  const outcome = await C.commitAdminContributorWrite({
    plan,
    writeBook: async (columns) => {
      assert.strictEqual(columns, null);
      return { error: null, id: 15 };
    },
    writeCredits: async () => ({ error: { code: "42501", message: "Admin permission required" } }),
    writeLegacyText: async () => {
      legacyCalls += 1;
      state.author = plan.legacy.author;
      state.credits = ["ئەھمەد، باتۇر"];
      return { error: null };
    }
  });
  assert.strictEqual(outcome.status, "credit-failed");
  assert.strictEqual(outcome.legacyWritten, false);
  assert.strictEqual(legacyCalls, 0);
  assert.deepStrictEqual(state.credits, ["ئەھمەد", "باتۇر"]);
  assert.strictEqual(state.author, "ئەھمەد، باتۇر");
});

test("a network failure leaves contributors unchanged and a retry writes once", async () => {
  const plan = C.planCreditSave({ authors: ["ئەھمەد", "باتۇر"], translators: [], publisher: "" });
  const state = { author: "كونا", credits: ["كونا"] };
  let attempts = 0;
  async function writeCredits() {
    attempts += 1;
    if (attempts === 1) throw new Error("Failed to fetch");
    state.author = plan.legacy.author;
    state.credits = plan.authors.slice();
    return { error: null };
  }
  const first = await C.commitAdminContributorWrite({
    plan,
    writeBook: async () => ({ error: null }),
    writeCredits,
    writeLegacyText: async () => {
      throw new Error("legacy fallback is not a network retry");
    }
  });
  assert.strictEqual(first.status, "credit-failed");
  assert.strictEqual(first.legacyWritten, false);
  assert.deepStrictEqual(state.credits, ["كونا"]);
  const second = await C.commitAdminContributorWrite({
    plan,
    writeBook: async () => ({ error: null }),
    writeCredits,
    writeLegacyText: async () => ({ error: null })
  });
  assert.strictEqual(second.status, "saved");
  assert.strictEqual(attempts, 2);
  assert.deepStrictEqual(state.credits, ["ئەھمەد", "باتۇر"]);
  assert.strictEqual(state.author, "ئەھمەد، باتۇر");
});

test("pending submission failure does not call the credit RPC", async () => {
  const plan = C.planCreditSave({ authors: ["ئەھمەد", "باتۇر"], translators: [], publisher: "" });
  let creditCalls = 0;
  const outcome = await C.commitPendingSubmissionCredits({
    plan,
    submit: async () => ({ error: { code: "42501", message: "pending update rejected" } }),
    writeCredits: async () => {
      creditCalls += 1;
      return { error: null };
    },
    writeLegacyText: async () => ({ error: null })
  });
  assert.strictEqual(outcome.status, "submission-failed");
  assert.strictEqual(outcome.creditsCalled, false);
  assert.strictEqual(creditCalls, 0);
});

test("staff credit rejection, network loss, and retry do not show success", async () => {
  const plan = C.planCreditSave({ authors: ["شەھىدە", "خەدىچە"], translators: [], publisher: "" });
  let submits = 0;
  let credits = 0;
  const rejected = await C.saveStaffCreditsAfterInsert(
    async () => {
      submits += 1;
      return { id: 40 };
    },
    async () => {
      credits += 1;
      return { error: { code: "42501", message: "Pending book permission required" } };
    },
    plan
  );
  assert.strictEqual(rejected.panel, "incomplete");
  assert.strictEqual(rejected.retry, true);
  assert.notStrictEqual(rejected.panel, "success");
  const lost = await C.applyStaffCredits(async () => {
    throw new Error("Failed to fetch");
  }, 40, plan);
  assert.strictEqual(lost.status, "failed");
  assert.strictEqual(lost.panel, "incomplete");
  const missing = await C.saveStaffCreditsAfterInsert(
    async () => ({ error: { message: "submit_book_for_approval failed" } }),
    async () => {
      credits += 1;
      return { error: null };
    },
    plan
  );
  assert.strictEqual(missing.status, "submission-failed");
  assert.strictEqual(missing.creditsCalled, false);
  assert.strictEqual(credits, 1);
  let retry = 0;
  const first = await C.applyStaffCredits(async () => {
    retry += 1;
    return { error: { message: "network down" } };
  }, 40, plan);
  assert.strictEqual(first.panel, "incomplete");
  const second = await C.applyStaffCredits(async () => {
    retry += 1;
    return { error: null };
  }, 40, plan);
  assert.strictEqual(second.panel, "success");
  assert.strictEqual(second.status, "saved");
  assert.strictEqual(submits, 1);
  assert.strictEqual(retry, 2);
});

const CREDIT_IDS = {
  Alice: "11111111-1111-4111-8111-111111111111",
  Bob: "22222222-2222-4222-8222-222222222222",
  Carol: "33333333-3333-4333-8333-333333333333",
  Dave: "44444444-4444-4444-8444-444444444444",
  Press: "55555555-5555-4555-8555-555555555555"
};

function structuredCreditRows() {
  return [
    ["author", 0, "Alice", CREDIT_IDS.Alice],
    ["author", 1, "Bob", CREDIT_IDS.Bob],
    ["translator", 0, "Carol", CREDIT_IDS.Carol],
    ["translator", 1, "Dave", CREDIT_IDS.Dave],
    ["publisher", 0, "Structured Press", CREDIT_IDS.Press]
  ].map(([role, position, name, id]) => ({
    role,
    position,
    identity_id: id,
    catalog_identities: { id, display_name: name }
  }));
}

function startStaticServer() {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".woff2": "font/woff2"
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = path.resolve(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(file, (error, body) => {
      if (error) {
        res.writeHead(404);
        res.end("missing");
        return;
      }
      res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

let formHarness;
async function formHarnessOnce() {
  if (formHarness) return formHarness;
  const { chromium } = require("@playwright/test");
  const server = await startStaticServer();
  const browser = await chromium.launch({ headless: true });
  formHarness = { server, browser, origin: "http://127.0.0.1:" + server.address().port };
  return formHarness;
}

async function adminPage() {
  const harness = await formHarnessOnce();
  const context = await harness.browser.newContext();
  await context.addInitScript(() => {
    window.__alerts = [];
    window.__writes = [];
    window.__creditStarted = false;
    window.alert = (message) => { window.__alerts.push(String(message)); };
    let releaseCredits;
    window.__creditHold = new Promise((resolve) => { releaseCredits = resolve; });
    window.__releaseCredits = (value) => releaseCredits(value);
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguCreditFormTest = true;
    window.__kutadguAdminFetchBook = () => window.__creditBook;
    window.__kutadguAdminPersistBook = async (payload) => {
      window.__writes.push({ kind: "book", payload });
      return { error: null, data: [{ id: 7 }] };
    };
    function chain(result) {
      const self = {
        select() { return self; },
        eq() { return self; },
        neq() { return self; },
        or() { return self; },
        in() { return self; },
        order() { return self; },
        not() { return self; },
        limit() { return self; },
        range() { return self; },
        maybeSingle() { return self; },
        update(payload) { window.__writes.push({ kind: "update", payload }); return self; },
        insert(payload) { window.__writes.push({ kind: "insert", payload }); return self; },
        delete() { return self; },
        then(ok, fail) { return Promise.resolve(result).then(ok, fail); }
      };
      return self;
    }
    window.__kutadguAnalyticsDb = {
      from(table) {
        if (table === "book_credits") {
          window.__creditStarted = true;
          if (window.__creditRows) return chain(Promise.resolve(window.__creditRows));
          return chain(window.__creditHold);
        }
        return chain({ data: [], error: null });
      },
      rpc(name, args) {
        window.__writes.push({ kind: "rpc", name, args });
        return Promise.resolve(window.__rpcResult || { data: null, error: null });
      },
      auth: {
        onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
        getSession() {
          return Promise.resolve({ data: { session: { access_token: "isolated-admin-access-token" } }, error: null });
        }
      }
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  page.on("dialog", (dialog) => dialog.accept());
  return page;
}

async function openCreditBook(page) {
  const harness = await formHarnessOnce();
  await page.goto(harness.origin + "/admin.html", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForFunction(() => window.__kutadguAdminTest && document.querySelector("#bookAuthor"), null, { timeout: 8000 });
  const source = await page.$eval("#bookSource", (el) => (el.options[1] && el.options[1].value) || "");
  await page.evaluate((nextSource) => {
    window.__creditBook = {
      id: 7,
      title: "Held book",
      author: "Alice، Bob",
      translator: "Carol، Dave",
      publisher: "Old Press",
      source: nextSource,
      price: 12,
      stock: 4,
      image_url: "https://cdn.example/cover.webp",
      is_active: true,
      language: "",
      description: "",
      sales_count: 0
    };
  }, source);
  await page.evaluate(() => {
    window.__opening = window.__kutadguAdminTest.openEdit(7);
  });
  await page.waitForFunction(() => window.__creditStarted === true, null, { timeout: 8000 });
}

async function finishCreditOpen(page) {
  return page.evaluate(() => window.__opening);
}

async function readAdminCredits(page) {
  return page.evaluate(() => ({
    authors: window.__kutadguAdminTest.creditFieldValues("bookAuthor", "bookAuthorExtras").map((value) => String(value).trim()).filter(Boolean),
    translators: window.__kutadguAdminTest.creditFieldValues("bookTranslator", "bookTranslatorExtras").map((value) => String(value).trim()).filter(Boolean),
    publisher: document.querySelector("#bookPublisher").value,
    plan: window.__kutadguAdminTest.currentCreditPlan(),
    writes: window.__writes,
    alerts: window.__alerts
  }));
}

const DIRTY_DURING_LOAD = [
  { role: "publisher", selector: "#bookPublisher", value: "Edited Press" },
  { role: "author", selector: "#bookAuthor", value: "Only Alice" },
  { role: "translator", selector: "#bookTranslator", value: "Only Carol" }
];

DIRTY_DURING_LOAD.forEach((item) => {
  test("admin form keeps structured " + item.role + " siblings after a successful load", async () => {
    const page = await adminPage();
    await openCreditBook(page);
    await page.locator(item.selector).fill(item.value);
    await page.evaluate((rows) => window.__releaseCredits({ data: rows, error: null }), structuredCreditRows());
    await finishCreditOpen(page);
    const seen = await readAdminCredits(page);
    if (item.role === "publisher") {
      assert.deepStrictEqual(seen.authors, ["Alice", "Bob"]);
      assert.deepStrictEqual(seen.translators, ["Carol", "Dave"]);
      assert.strictEqual(seen.publisher, "Edited Press");
    } else if (item.role === "author") {
      assert.deepStrictEqual(seen.authors, ["Only Alice"]);
      assert.deepStrictEqual(seen.translators, ["Carol", "Dave"]);
      assert.strictEqual(seen.publisher, "Structured Press");
    } else {
      assert.deepStrictEqual(seen.authors, ["Alice", "Bob"]);
      assert.deepStrictEqual(seen.translators, ["Only Carol"]);
      assert.strictEqual(seen.publisher, "Structured Press");
    }
    assert.strictEqual(seen.plan.writeCredits, true);
    assert.deepStrictEqual(seen.plan.authors, seen.authors);
    assert.deepStrictEqual(seen.plan.translators, seen.translators);
    await page.evaluate(() => { window.__writes = []; window.__alerts = []; });
    await page.locator("#bookForm button[type=submit]").click();
    await page.waitForFunction(() => window.__writes.some((entry) => entry.kind === "rpc") || window.__alerts.length, null, { timeout: 20000 });
    const saved = await readAdminCredits(page);
    const rpc = saved.writes.find((entry) => entry.kind === "rpc" && entry.name === "set_book_credits");
    assert.ok(rpc, JSON.stringify({ alerts: saved.alerts, writes: saved.writes }));
    assert.deepStrictEqual(rpc.args.p_authors, seen.authors);
    assert.deepStrictEqual(rpc.args.p_translators, seen.translators);
    assert.strictEqual(rpc.args.p_publisher, seen.publisher);
    const bookWrite = saved.writes.find((entry) => entry.kind === "book");
    assert.ok(bookWrite);
    assert.ok(!Object.prototype.hasOwnProperty.call(bookWrite.payload, "author"));
    assert.ok(!Object.prototype.hasOwnProperty.call(bookWrite.payload, "translator"));
    await page.context().close();
  });

  test("admin form does not save combined names when " + item.role + " changes during a failed load", async () => {
    const page = await adminPage();
    await openCreditBook(page);
    await page.locator(item.selector).fill(item.value);
    await page.evaluate(() => window.__releaseCredits({ data: null, error: { message: "credit query failed", code: "57014" } }));
    await finishCreditOpen(page);
    const seen = await readAdminCredits(page);
    assert.strictEqual(seen.plan.writeCredits, false);
    assert.strictEqual(seen.plan.omitLegacy, true);
    assert.deepStrictEqual(seen.plan.authors, []);
    assert.notStrictEqual(seen.plan.ok, false);
    if (item.role === "publisher") {
      assert.deepStrictEqual(seen.authors, ["Alice، Bob"]);
      assert.deepStrictEqual(seen.translators, ["Carol، Dave"]);
      assert.strictEqual(seen.publisher, "Edited Press");
    } else if (item.role === "author") {
      assert.deepStrictEqual(seen.authors, ["Only Alice"]);
      assert.deepStrictEqual(seen.translators, ["Carol، Dave"]);
      assert.strictEqual(seen.publisher, "Old Press");
    } else {
      assert.deepStrictEqual(seen.authors, ["Alice، Bob"]);
      assert.deepStrictEqual(seen.translators, ["Only Carol"]);
      assert.strictEqual(seen.publisher, "Old Press");
    }
    await page.evaluate(() => { window.__writes = []; });
    await page.locator("#bookForm button[type=submit]").click();
    await page.waitForFunction(() => window.__writes.some((entry) => entry.kind === "book") || window.__alerts.length > 1, null, { timeout: 20000 });
    const saved = await readAdminCredits(page);
    assert.ok(!saved.writes.some((entry) => entry.kind === "rpc"));
    const bookWrite = saved.writes.find((entry) => entry.kind === "book");
    assert.ok(bookWrite, JSON.stringify({ alerts: saved.alerts, writes: saved.writes }));
    assert.ok(!Object.prototype.hasOwnProperty.call(bookWrite.payload, "author"));
    assert.ok(!Object.prototype.hasOwnProperty.call(bookWrite.payload, "translator"));
    assert.ok(!Object.prototype.hasOwnProperty.call(bookWrite.payload, "publisher"));
    await page.context().close();
  });
});

function rowsForNames(authors, translators, publisher) {
  const rows = [];
  authors.forEach((name, position) => {
    const id = CREDIT_IDS[name];
    rows.push({ role: "author", position, identity_id: id, catalog_identities: { id, display_name: name } });
  });
  translators.forEach((name, position) => {
    const id = CREDIT_IDS[name];
    rows.push({ role: "translator", position, identity_id: id, catalog_identities: { id, display_name: name } });
  });
  if (publisher) {
    const id = CREDIT_IDS.Press;
    rows.push({ role: "publisher", position: 0, identity_id: id, catalog_identities: { id, display_name: publisher } });
  }
  return rows;
}

test("admin create with a cover saves one book and restores the individual names", async () => {
  const png = path.join(os.tmpdir(), "kutadgu-credit-cover.png");
  fs.writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  const page = await adminPage();
  const harness = await formHarnessOnce();
  await page.goto(harness.origin + "/admin.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__kutadguAdminTest && document.querySelector("#bookTitle"));
  await page.evaluate(() => window.__kutadguAdminTest.openNew());
  const source = await page.$eval("#bookSource", (el) => (el.options[1] && el.options[1].value) || "");
  await page.fill("#bookTitle", "يېڭى كىتاب");
  await page.fill("#bookAuthor", "Alice");
  await page.click("#bookAuthorAdd");
  await page.locator("#bookAuthorExtras input").fill("Bob");
  await page.fill("#bookTranslator", "Carol");
  await page.click("#bookTranslatorAdd");
  await page.locator("#bookTranslatorExtras input").fill("Dave");
  await page.fill("#bookPublisher", "Structured Press");
  await page.selectOption("#bookSource", source);
  await page.fill("#bookPrice", "15");
  const stock = page.locator("#bookStock");
  if (await stock.count() && await stock.isVisible()) await stock.fill("2");
  await page.setInputFiles("#bookCover", png);
  await page.route("**/api/r2-cover-upload", async (route) => {
    const key = route.request().headers()["x-kutadgu-object-key"];
    const url = "https://www.kutadgubilik.com/__r2/" + String(key || "").split("/").map((part) => encodeURIComponent(part)).join("/");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, url, key })
    });
  });
  await page.evaluate(() => {
    window.__writes = [];
    window.__alerts = [];
    window.__bookInserts = 0;
    window.__kutadguAdminPersistBook = async (payload, op) => {
      window.__writes.push({ kind: "book", payload, op });
      if (op === "INSERT") window.__bookInserts += 1;
      return { error: null, data: [{ id: 81 }] };
    };
  });
  await page.locator("#bookForm button[type=submit]").click();
  await page.waitForFunction(() => window.__writes.some((entry) => entry.kind === "rpc" && entry.name === "set_book_credits") || window.__alerts.length, null, { timeout: 30000 });
  const created = await readAdminCredits(page);
  assert.deepStrictEqual(created.alerts, [], JSON.stringify(created.alerts));
  assert.strictEqual(await page.evaluate(() => window.__bookInserts), 1);
  const createdRpc = created.writes.filter((entry) => entry.kind === "rpc" && entry.name === "set_book_credits");
  assert.strictEqual(createdRpc.length, 1);
  assert.strictEqual(createdRpc[0].args.p_book_id, 81);
  assert.deepStrictEqual(createdRpc[0].args.p_authors, ["Alice", "Bob"]);
  assert.deepStrictEqual(createdRpc[0].args.p_translators, ["Carol", "Dave"]);
  assert.strictEqual(createdRpc[0].args.p_publisher, "Structured Press");
  const inserted = created.writes.find((entry) => entry.kind === "book");
  assert.strictEqual(inserted.op, "INSERT");
  assert.ok(!Object.prototype.hasOwnProperty.call(inserted.payload, "author"));
  assert.ok(!Object.prototype.hasOwnProperty.call(inserted.payload, "translator"));
  assert.ok(!Object.prototype.hasOwnProperty.call(inserted.payload, "publisher"));
  await page.evaluate((rows) => {
    window.__creditRows = { data: rows, error: null };
    window.__creditBook = {
      id: 81,
      title: "يېڭى كىتاب",
      author: "Alice، Bob",
      translator: "Carol، Dave",
      publisher: "Structured Press",
      price: 15,
      stock: 2,
      image_url: "https://cdn.example/admin-preview-covers/saved.webp",
      is_active: true,
      language: "",
      description: "",
      sales_count: 0,
      source: document.querySelector("#bookSource").value
    };
  }, rowsForNames(["Alice", "Bob"], ["Carol", "Dave"], "Structured Press"));
  await page.evaluate(() => window.__kutadguAdminTest.openEdit(81));
  await page.waitForFunction(() => {
    const authorExtra = document.querySelector("#bookAuthorExtras input");
    const translatorExtra = document.querySelector("#bookTranslatorExtras input");
    return authorExtra && authorExtra.value === "Bob" && translatorExtra && translatorExtra.value === "Dave";
  });
  const restored = await page.evaluate(() => window.__kutadguAdminTest.currentCreditPlan());
  assert.deepStrictEqual(restored.authors, ["Alice", "Bob"]);
  assert.deepStrictEqual(restored.translators, ["Carol", "Dave"]);
  assert.strictEqual(restored.publisher, "Structured Press");
  await page.fill("#bookDescription", "باشقا ئىزاھ");
  await page.evaluate(() => { window.__writes = []; window.__alerts = []; });
  await page.locator("#bookForm button[type=submit]").click();
  await page.waitForFunction(() => window.__writes.some((entry) => entry.kind === "rpc" && entry.name === "set_book_credits") || window.__alerts.length, null, { timeout: 30000 });
  const kept = await readAdminCredits(page);
  assert.deepStrictEqual(kept.alerts, [], JSON.stringify(kept.alerts));
  assert.strictEqual(await page.evaluate(() => window.__bookInserts), 1);
  const keptRpc = kept.writes.filter((entry) => entry.kind === "rpc" && entry.name === "set_book_credits");
  assert.strictEqual(keptRpc.length, 1);
  assert.strictEqual(keptRpc[0].args.p_book_id, 81);
  assert.deepStrictEqual(keptRpc[0].args.p_authors, ["Alice", "Bob"]);
  assert.deepStrictEqual(keptRpc[0].args.p_translators, ["Carol", "Dave"]);
  assert.strictEqual(keptRpc[0].args.p_publisher, "Structured Press");
  const updated = kept.writes.find((entry) => entry.kind === "book");
  assert.strictEqual(updated.op, "UPDATE");
  assert.strictEqual(updated.payload.description, "باشقا ئىزاھ");
  await page.evaluate(() => window.__kutadguAdminTest.openEdit(81));
  await page.waitForFunction(() => {
    const translatorExtra = document.querySelector("#bookTranslatorExtras input");
    const modal = document.querySelector("#bookModal");
    return translatorExtra && translatorExtra.value === "Dave" && modal && !modal.hidden;
  });
  await page.fill("#bookTranslator", "");
  await page.locator("#bookTranslatorExtras input").fill("");
  await page.fill("#bookPublisher", "");
  await page.evaluate((rows) => {
    window.__writes = [];
    window.__alerts = [];
    window.__creditRows = { data: rows, error: null };
  }, rowsForNames(["Alice", "Bob"], [], ""));
  await page.locator("#bookForm button[type=submit]").click();
  await page.waitForFunction(() => window.__writes.some((entry) => entry.kind === "rpc" && entry.name === "set_book_credits") || window.__alerts.length, null, { timeout: 30000 });
  const cleared = await readAdminCredits(page);
  assert.deepStrictEqual(cleared.alerts, [], JSON.stringify(cleared.alerts));
  assert.strictEqual(await page.evaluate(() => window.__bookInserts), 1);
  const clearedRpc = cleared.writes.filter((entry) => entry.kind === "rpc" && entry.name === "set_book_credits");
  assert.strictEqual(clearedRpc.length, 1);
  assert.strictEqual(clearedRpc[0].args.p_book_id, 81);
  assert.deepStrictEqual(clearedRpc[0].args.p_authors, ["Alice", "Bob"]);
  assert.deepStrictEqual(clearedRpc[0].args.p_translators, []);
  assert.strictEqual(clearedRpc[0].args.p_publisher, null);
  await page.evaluate(() => {
    window.__creditBook = Object.assign({}, window.__creditBook, {
      author: "Alice، Bob",
      translator: null,
      publisher: null
    });
  });
  await page.evaluate(() => window.__kutadguAdminTest.openEdit(81));
  await page.waitForFunction(() => {
    const authorExtra = document.querySelector("#bookAuthorExtras input");
    const translatorExtra = document.querySelector("#bookTranslatorExtras input");
    return authorExtra && authorExtra.value === "Bob" && !translatorExtra && document.querySelector("#bookTranslator").value === "" && document.querySelector("#bookPublisher").value === "";
  });
  const emptyOptional = await page.evaluate(() => window.__kutadguAdminTest.currentCreditPlan());
  assert.deepStrictEqual(emptyOptional.authors, ["Alice", "Bob"]);
  assert.deepStrictEqual(emptyOptional.translators, []);
  assert.strictEqual(emptyOptional.publisher, null);
  await page.context().close();
});

test("admin create form keeps typed contributors and does not write before a cover exists", async () => {
  const page = await adminPage();
  const harness = await formHarnessOnce();
  await page.goto(harness.origin + "/admin.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__kutadguAdminTest && document.querySelector("#bookTitle"));
  await page.evaluate(() => window.__kutadguAdminTest.openNew());
  const source = await page.$eval("#bookSource", (el) => (el.options[1] && el.options[1].value) || "");
  await page.fill("#bookTitle", "يېڭى كىتاب");
  await page.fill("#bookAuthor", "يېڭى ئاپتور");
  await page.fill("#bookTranslator", "يېڭى تەرجىمان");
  await page.fill("#bookPublisher", "يېڭى نەشر");
  await page.selectOption("#bookSource", source);
  await page.fill("#bookPrice", "15");
  const stock = page.locator("#bookStock");
  if (await stock.count() && await stock.isVisible()) await stock.fill("2");
  const plan = await page.evaluate(() => window.__kutadguAdminTest.currentCreditPlan());
  assert.strictEqual(plan.writeCredits, true);
  assert.deepStrictEqual(plan.authors, ["يېڭى ئاپتور"]);
  assert.deepStrictEqual(plan.translators, ["يېڭى تەرجىمان"]);
  assert.strictEqual(plan.publisher, "يېڭى نەشر");
  await page.evaluate(() => { window.__writes = []; window.__alerts = []; });
  await page.locator("#bookForm button[type=submit]").click();
  await page.waitForFunction(() => window.__alerts.length > 0 || window.__writes.length > 0);
  const saved = await readAdminCredits(page);
  assert.ok(saved.alerts.some((message) => message.includes("مۇقاۋا")), JSON.stringify(saved.alerts));
  assert.ok(!saved.writes.some((entry) => entry.kind === "rpc" || entry.kind === "book"));
  await page.context().close();
});

test("staff submit shows retry after a failed credit write and retry does not create another book", async () => {
  const harness = await formHarnessOnce();
  const context = await harness.browser.newContext();
  await context.addInitScript(() => { window.__kutadguSkipStaffRoute = true; });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(harness.origin + "/book-staff.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#staffTitle") && window.KutadguBookStaff);
  const source = await page.$eval("#staffSource", (el) => (el.options[1] && el.options[1].value) || "");
  await page.evaluate(() => {
    window.__staffCalls = [];
    window.__staffCreditFails = 1;
    window.KutadguMember = {
      getUser: () => ({ id: "11111111-1111-4111-8111-111111111111", email: "staff@example.com" }),
      getClient: () => ({
        rpc(name, args) {
          window.__staffCalls.push({ name, args });
          if (name === "is_kutadgu_book_staff") return Promise.resolve({ data: true, error: null });
          if (name === "submit_book_for_approval") return Promise.resolve({ data: 55, error: null });
          if (name === "set_own_pending_book_credits") {
            return new Promise((resolve) => {
              setTimeout(() => {
                if (window.__staffCreditFails > 0) {
                  window.__staffCreditFails -= 1;
                  resolve({ data: null, error: { message: "credit write failed", code: "P0001" } });
                  return;
                }
                resolve({ data: null, error: null });
              }, 250);
            });
          }
          return Promise.resolve({ data: null, error: null });
        }
      }),
      ready: Promise.resolve()
    };
    window.KutadguAdminMfa = {
      ensurePrimarySessionReady: async () => ({ ok: true }),
      inspectAccess: async () => ({ assurance: { currentLevel: "aal2" } }),
      normalizeLevel: (level) => level || ""
    };
  });
  await page.fill("#staffTitle", "خادىم كىتابى");
  await page.fill("#staffAuthor", "خادىم ئاپتور");
  await page.click("#staffAuthorAdd");
  await page.locator("#staffAuthorExtras input").fill("خادىم شېرىك");
  await page.fill("#staffTranslator", "خادىم تەرجىمان");
  await page.click("#staffTranslatorAdd");
  await page.locator("#staffTranslatorExtras input").fill("خادىم شېرىك تەرجىمان");
  await page.selectOption("#staffSource", source);
  await page.fill("#staffPrice", "9");
  await page.click("#staffSubmitBtn");
  await page.waitForFunction(() => {
    const retry = document.querySelector("#staffCreditRetry");
    return retry && !retry.hidden;
  });
  const afterFail = await page.evaluate(() => ({
    successHidden: document.querySelector("#staffSuccess").hidden,
    calls: window.__staffCalls.map((call) => call.name)
  }));
  assert.strictEqual(afterFail.successHidden, true);
  assert.deepStrictEqual(afterFail.calls, ["is_kutadgu_book_staff", "submit_book_for_approval", "set_own_pending_book_credits"]);
  await page.click("#staffCreditRetryBtn");
  await page.waitForFunction(() => {
    const success = document.querySelector("#staffSuccess");
    return success && !success.hidden;
  });
  const afterRetry = await page.evaluate(() => window.__staffCalls);
  assert.deepStrictEqual(afterRetry.map((call) => call.name), [
    "is_kutadgu_book_staff",
    "submit_book_for_approval",
    "set_own_pending_book_credits",
    "set_own_pending_book_credits"
  ]);
  const creditCalls = afterRetry.filter((call) => call.name === "set_own_pending_book_credits");
  assert.deepStrictEqual(creditCalls.map((call) => call.args.p_book_id), [55, 55]);
  assert.deepStrictEqual(creditCalls[0].args.p_authors, ["خادىم ئاپتور", "خادىم شېرىك"]);
  assert.deepStrictEqual(creditCalls[0].args.p_translators, ["خادىم تەرجىمان", "خادىم شېرىك تەرجىمان"]);
  assert.deepStrictEqual(creditCalls[1].args.p_authors, creditCalls[0].args.p_authors);
  assert.deepStrictEqual(creditCalls[1].args.p_translators, creditCalls[0].args.p_translators);
  assert.strictEqual(afterRetry.filter((call) => call.name === "submit_book_for_approval").length, 1);
  await context.close();
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
  if (formHarness) {
    await formHarness.browser.close();
    await new Promise((resolve) => formHarness.server.close(resolve));
  }
  if (failed) {
    console.error("\n" + failed + " catalog credit test(s) failed");
    process.exit(1);
  }
  console.log("catalog-credits-tests ok");
})();
