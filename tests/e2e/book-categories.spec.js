const os = require("os");
const path = require("path");
const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const shotDir = path.join(os.tmpdir(), "kutadgu-book-categories");

const directory = {
  categories: [
    { id: 2, slug: "yeni-tur", source: "yeni-tur.html", label: "يېڭى تۈر", summary: "يېڭى قىسقىچە", icon: "📚", sort_order: 5 },
    { id: 1, slug: "romanlar", source: "romanlar.html", label: "رومانلار يېڭى", summary: "رومان", icon: "📖", sort_order: 10 },
    { id: 9, slug: "universal", source: "universal.html", label: "ئۇنىۋېرسال", summary: "ئومۇمىي", icon: "📚", sort_order: 90 }
  ],
  redirects: [{ slug: "dictionary", source: "dictionary.html", target_slug: "grammar", target_source: "grammar.html" }]
};

const adminRows = [
  { id: 2, slug: "yeni-tur", source: "yeni-tur.html", label: "يېڭى تۈر", summary: "يېڭى قىسقىچە", icon: "📚", sort_order: 5, is_hidden: false, retired: false, revision: 1, book_count: 0, group_count: 0 },
  { id: 1, slug: "romanlar", source: "romanlar.html", label: "رومانلار يېڭى", summary: "رومان", icon: "📖", sort_order: 10, is_hidden: false, retired: false, revision: 2, book_count: 1, group_count: 0 },
  { id: 8, slug: "tibb", source: "tibb.html", label: "تېبابەت ۋە ساغلاملىق", summary: "", icon: "🩺", sort_order: 100, is_hidden: true, retired: false, revision: 4, book_count: 1, group_count: 0 },
  { id: 9, slug: "universal", source: "universal.html", label: "ئۇنىۋېرسال", summary: "", icon: "📚", sort_order: 90, is_hidden: false, retired: false, revision: 1, book_count: 2, group_count: 1 },
  { id: 15, slug: "dictionary", source: "dictionary.html", label: "لۇغەت", summary: "", icon: "📗", sort_order: 150, is_hidden: true, retired: true, redirect_category_id: 16, revision: 3, book_count: 0, group_count: 0 }
];

const live = { publicBody: directory };

function publicBodyFrom(rows) {
  return {
    categories: rows.filter((row) => !row.retired && !row.is_hidden).map((row) => ({
      id: row.id, slug: row.slug, source: row.source, label: row.label, summary: row.summary, icon: row.icon, sort_order: row.sort_order
    })),
    redirects: rows.filter((row) => row.retired).map((row) => ({
      slug: row.slug, source: row.source, target_slug: "grammar", target_source: "grammar.html"
    }))
  };
}

async function installDirectory(page) {
  const writes = [];
  live.publicBody = directory;
  await H.installReadSafeNetwork(page);
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) && !request.url().includes("list_public_book_categories") && !request.url().includes("127.0.0.1")) {
      writes.push(request.method() + " " + request.url().split("?")[0]);
    }
  });
  page._categoryWrites = writes;
  await page.exposeBinding("__syncCategoryState", ({}, rows) => {
    live.publicBody = publicBodyFrom(rows);
  });
  await page.route("**/rpc/list_public_book_categories**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(live.publicBody)
  }));
  await page.addInitScript((rows) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguSkipSuggestFetch = true;
    const saved = window.sessionStorage.getItem("kutadgu-category-test-rows");
    window.__categoryRows = saved ? JSON.parse(saved) : rows.map((row) => Object.assign({}, row));
    window.__categoryCalls = [];
    window.__moveIds = [];
    window.__categoryRanges = [];
    function remember() {
      window.sessionStorage.setItem("kutadgu-category-test-rows", JSON.stringify(window.__categoryRows));
      if (window.__syncCategoryState) window.__syncCategoryState(window.__categoryRows);
    }
    function rowById(id) {
      return window.__categoryRows.find((row) => Number(row.id) === Number(id));
    }
    window.__kutadguAnalyticsDb = {
      async rpc(name, args) {
        window.__categoryCalls.push({ name, args });
        if (name === "list_public_book_categories") {
          const visible = window.__categoryRows.filter((row) => !row.retired && !row.is_hidden);
          return { data: {
            categories: visible.map((row) => ({ id: row.id, slug: row.slug, source: row.source, label: row.label, summary: row.summary, icon: row.icon, sort_order: row.sort_order })),
            direct: window.__categoryRows.filter((row) => !row.retired).map((row) => ({ id: row.id, slug: row.slug, source: row.source, label: row.label, summary: row.summary, is_hidden: !!row.is_hidden })),
            redirects: window.__categoryRows.filter((row) => row.retired).map((row) => ({ slug: row.slug, source: row.source, target_slug: "grammar", target_source: "grammar.html" }))
          } };
        }
        if (name === "admin_list_book_categories") {
          return { data: window.__categoryRows.slice().sort((a, b) => a.sort_order - b.sort_order || a.id - b.id) };
        }
        if (name === "admin_create_book_category") {
          window.__categoryRows.unshift({ id: 44, slug: args.p_slug, source: args.p_slug + ".html", label: args.p_label, summary: args.p_summary, icon: "📚", sort_order: 1, is_hidden: false, retired: false, revision: 1, book_count: 0, group_count: 0 });
          remember();
          return { data: { id: 44, slug: args.p_slug, source: args.p_slug + ".html", label: args.p_label, revision: 1 } };
        }
        if (name === "admin_rename_book_category") {
          const row = rowById(args.p_id);
          row.label = args.p_label;
          row.revision = args.p_expected_revision + 1;
          remember();
          return { data: { id: row.id, label: row.label, revision: row.revision } };
        }
        if (name === "admin_move_book_category_order") {
          const ordered = window.__categoryRows.filter((row) => !row.retired).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
          const index = ordered.findIndex((row) => Number(row.id) === Number(args.p_id));
          const swap = ordered[args.p_direction === "up" ? index - 1 : index + 1];
          const row = ordered[index];
          if (swap) {
            const order = row.sort_order;
            row.sort_order = swap.sort_order;
            swap.sort_order = order;
          }
          row.revision = args.p_expected_revision + 1;
          remember();
          return { data: { id: row.id, moved: true, revision: row.revision } };
        }
        if (name === "admin_set_book_category_hidden") {
          const row = rowById(args.p_id);
          row.is_hidden = args.p_hidden;
          row.revision = args.p_expected_revision + 1;
          remember();
          return { data: { id: row.id, is_hidden: row.is_hidden, revision: row.revision } };
        }
        if (name === "admin_retire_book_category") {
          if (window.__categoryRows.some((row) => row.id === args.p_id && (row.book_count > 0 || row.group_count > 0))) {
            return { error: { message: "category_not_empty" } };
          }
          const row = rowById(args.p_id);
          row.retired = true;
          row.is_hidden = true;
          row.revision = args.p_expected_revision + 1;
          remember();
          return { data: { id: args.p_id, redirect_slug: "grammar", revision: row.revision } };
        }
        if (name === "admin_preview_book_category_move") {
          if (window.__delayPreview) await window.__delayPreview;
          const destination = rowById(args.p_destination_id);
          return { data: { source: { label: "ئۇنىۋېرسال", source: "universal.html" }, origins: [{ source: "universal.html", label: "ئۇنىۋېرسال", book_count: 2 }], destination: { id: args.p_destination_id, label: destination ? destination.label : "يېڭى تۈر", source: destination ? destination.source : "yeni-tur.html" }, selected_book_count: 1, added_book_count: 1, book_count: 2, group_count: 1, book_ids: [1, 4], added_books: [{ id: 4, title: "قوشۇمچە", category: "ئۇنىۋېرسال" }], groups: [{ id: 9, title: "يۈرۈشلۈك", category: "ئۇنىۋېرسال", expanded: true }] } };
        }
        if (name === "admin_move_books_to_category") {
          window.__moveIds.push(args.p_request_id);
          if (window.__failMoveOnce) {
            window.__failMoveOnce = false;
            throw new Error("network");
          }
          return { data: { applied_books: 2, applied_groups: 1 } };
        }
        return { data: [] };
      },
      from() {
        const chain = {
          filters: {},
          bounds: null,
          select() { return chain; },
          eq(column, value) { chain.filters[column] = value; return chain; },
          order() { return chain; },
          range(from, to) { chain.bounds = [from, to]; window.__categoryRanges.push([from, to]); return chain; },
          then(resolve) {
            if (window.__categoryBookError) {
              resolve({ data: null, error: { message: "read failed" } });
              return;
            }
            if (!chain.filters.source) {
              resolve({ data: [], error: null });
              return;
            }
            const rows = window.__categoryBooks || [{ id: 1, title: "ساقلانغان كىتاب", source: chain.filters.source, category: "ئۇنىۋېرسال", is_active: false, submission_status: "pending" }];
            const slice = chain.bounds ? rows.filter((row) => row.source === chain.filters.source).slice(chain.bounds[0], chain.bounds[1] + 1) : rows;
            resolve({ data: slice, error: null });
          }
        };
        return chain;
      }
    };
  }, adminRows);
}

test("a new category is available on the homepage, search, and book entry", async ({ page }) => {
  await installDirectory(page);
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("#bookCategories [data-category-source='yeni-tur.html']")).toContainText("يېڭى تۈر");
  await expect(page.locator("#bookCategories [data-category-source='tibb.html']")).toHaveCount(0);
  await expect(page.locator("#searchCategory option[value='يېڭى تۈر']")).toHaveCount(1);
  await expect(page.locator("#searchCategory option[value='تېبابەت ۋە ساغلاملىق']")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(shotDir, "categories-home-390.png"), fullPage: false });
  expect(page._categoryWrites.filter((entry) => /\/rest\/v1\/books|admin_/.test(entry))).toEqual([]);
});

test("admin category controls keep order, hidden assignments, and retired slugs", async ({ page }) => {
  await installDirectory(page);
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  await page.locator("[data-admin-section='categories']").click();
  await expect(page.locator("[data-category-source='yeni-tur.html']")).toBeVisible();
  await page.locator("[data-category-up='2']").focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.__categoryCalls.some((call) => call.name === "admin_move_book_category_order" && call.args.p_direction === "up"))).toBe(true);
  await expect(page.locator("[data-category-source='tibb.html']")).toContainText("يوشۇرۇن");
  await page.locator("#bookCategoryLabel").fill("باشقا تۈر");
  await page.locator("#bookCategorySlug").fill("bashqa-tur");
  await page.locator("#bookCategoryCreate").locator("button[type=submit]").click();
  await expect.poll(() => page.evaluate(() => window.__categoryCalls.some((call) => call.name === "admin_create_book_category" && call.args.p_slug === "bashqa-tur"))).toBe(true);
  await expect.poll(() => page.evaluate(() => !!(window.KutadguBookCategories && window.KutadguBookCategories.authoritative && window.KutadguBookCategories.authoritative()))).toBe(true);
  await page.evaluate(() => {
    window.__kutadguRefreshCategoryOptions({ book: "tibb.html", bookLabel: "تېبابەت ۋە ساغلاملىق" });
  });
  await expect(page.locator("#bookSource option[value='tibb.html']")).toContainText("يوشۇرۇن");
  await expect(page.locator("#bookSource")).toHaveValue("tibb.html");
  await page.locator("[data-category-retire='1']").click();
  await expect(page.locator("#bookCategoryStatus")).toContainText("بۇ تۈردە يەنىلا كىتاب");
  await page.locator("#bookCategoryLoadUniversal").click();
  await page.locator("[data-universal-book]").check();
  await page.evaluate(() => {
    window.__delayPreview = new Promise((resolve) => { window.__releasePreview = resolve; });
  });
  await page.locator("#bookCategoryPreviewMove").click();
  const reviewedDestination = await page.locator("#bookCategoryMoveDestination").inputValue();
  const otherDestination = await page.locator("#bookCategoryMoveDestination option").evaluateAll((options, current) => {
    const match = options.find((option) => option.value !== current);
    return match ? match.value : "";
  }, reviewedDestination);
  await page.locator("#bookCategoryMoveDestination").selectOption(otherDestination);
  await page.evaluate(() => window.__releasePreview());
  await expect(page.locator("#bookCategoryMovePreview")).toBeHidden();
  await expect(page.locator("#bookCategoryConfirmMove")).toBeDisabled();
  await page.locator("#bookCategoryMoveDestination").selectOption(reviewedDestination);
  await page.locator("#bookCategoryPreviewMove").click();
  await expect(page.locator("#bookCategoryMovePreview")).toContainText("جەمئىي كىتاب: 2");
  await expect(page.locator("#bookCategoryMovePreview")).toContainText("يۈرۈشلۈك: 1");
  await expect(page.locator("#bookCategoryMovePreview")).toContainText("قوشۇمچە");
  await page.locator("#bookCategoryMoveDestination").selectOption(otherDestination);
  await expect(page.locator("#bookCategoryConfirmMove")).toBeDisabled();
  await page.locator("#bookCategoryConfirmMove").evaluate((button) => {
    button.disabled = false;
    button.click();
  });
  await expect(page.locator("#bookCategoryStatus")).toContainText("ئالدىن كۆرۈشنى ئېچىڭ");
  await expect.poll(() => page.evaluate(() => window.__moveIds.length)).toBe(0);
  await page.locator("#bookCategoryMoveDestination").selectOption(reviewedDestination);
  await page.locator("#bookCategoryPreviewMove").click();
  await page.evaluate(() => { window.__failMoveOnce = true; });
  await page.locator("#bookCategoryConfirmMove").click();
  await expect.poll(() => page.evaluate(() => window.__moveIds.length)).toBe(1);
  await page.locator("#bookCategoryConfirmMove").click();
  await expect.poll(() => page.evaluate(() => window.__moveIds.length === 2 && window.__moveIds[0] === window.__moveIds[1])).toBe(true);
  await page.locator("[data-category-rename='1']").click();
  await page.locator("#bookCategoryRenameInput").fill("رومانلار باشقا");
  await page.locator("#bookCategoryRename").locator("button[type=submit]").click();
  await expect(page.locator("[data-category-source='romanlar.html']")).toContainText("رومانلار باشقا");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("[data-admin-section='categories']").click();
  await expect(page.locator("[data-category-source='romanlar.html']")).toContainText("رومانلار باشقا");
  await page.locator("[data-category-hide='2']").click();
  await expect(page.locator("[data-category-source='yeni-tur.html']")).toContainText("يوشۇرۇن");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("[data-admin-section='categories']").click();
  await expect(page.locator("[data-category-source='yeni-tur.html']")).toContainText("يوشۇرۇن");
  await page.locator("[data-category-hide='2']").click();
  await expect(page.locator("[data-category-source='yeni-tur.html']")).not.toContainText("يوشۇرۇن");
  await page.evaluate(() => { window.__categoryBookError = true; });
  await page.locator("#bookCategoryLoadUniversal").click();
  await expect(page.locator("#bookCategoryStatus")).toContainText("كىتاب تىزىمى يۈكلەنمىدى");
  await expect(page.locator("#bookCategoryUniversal")).not.toContainText("بۇ تۈردە كىتاب يوق");
  await page.evaluate(() => {
    window.__categoryBookError = false;
    window.__categoryRanges = [];
    window.__categoryBooks = Array.from({ length: 205 }, (_, index) => ({
      id: index + 1, title: "كىتاب " + (index + 1), source: "universal.html", category: "ئۇنىۋېرسال", is_active: true, submission_status: "approved"
    }));
  });
  await page.locator("[data-category-retry-source='universal.html']").click();
  await expect(page.locator("[data-universal-book]")).toHaveCount(205);
  await expect.poll(() => page.evaluate(() => window.__categoryRanges.some((range) => range[0] === 200))).toBe(true);
  await page.evaluate(() => {
    window.__kutadguRefreshCategoryOptions({
      book: "tibb.html",
      bookLabel: "تېبابەت ۋە ساغلاملىق",
      quick: "tibb.html",
      quickLabel: "تېبابەت ۋە ساغلاملىق"
    });
    const action = document.querySelector("#bulkAction");
    if (action) {
      action.value = "category";
      action.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await expect(page.locator("#quickSource option[value='tibb.html']")).toContainText("يوشۇرۇن");
  await expect(page.locator("#bookSource option[value='tibb.html']")).toContainText("يوشۇرۇن");
  await expect(page.locator("#bulkValueSelect option[value='yeni-tur.html']")).toHaveCount(1);
  await expect(page.locator("#bulkValueSelect option[value='tibb.html']")).toHaveCount(0);
  await page.evaluate(() => window.KutadguAdminVolumeGroups.init({ db: window.__kutadguAnalyticsDb }));
  await page.locator("[data-admin-section='volume-groups']").click();
  await page.locator("#newVolumeGroupBtn").click();
  await page.locator("#volumeGroupCategory").fill("يېڭى تۈر");
  await expect(page.locator("#volumeGroupSource")).toHaveValue("yeni-tur.html");
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#bookCategories [data-category-source='bashqa-tur.html']")).toContainText("باشقا تۈر");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: path.join(shotDir, "categories-admin-1280.png"), fullPage: false });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  expect(overflow).toBe(false);
  await page.keyboard.press("Tab");
  expect(page._categoryWrites.filter((entry) => /\/rest\/v1\/books|storage/.test(entry))).toEqual([]);
});

test("a rendered category hydrates, filters, and paginates from its own source", async ({ page }) => {
  const listing = require("../../kutadgu-category-listing.js");
  const html = listing.applyDynamicCategoryDocument(
    require("fs").readFileSync(require("path").join(__dirname, "../../universal.html"), "utf8"),
    { slug: "yengi-tur", source: "yengi-tur.html", label: "يېڭى تۈر", summary: "يېڭى تۈر قىسقىچە" },
    [{ id: "8", title: "باشلانغۇچ", author: "A", source: "yengi-tur.html", price: 12, stock: 2, image_url: "/kutadgu-logo.png" }]
  );
  const catalogRequests = [];
  await installDirectory(page);
  await page.route("**/rest/v1/books**", (route) => {
    const range = route.request().headers().range || "";
    const offset = Number((range.match(/^(\d+)/) || [])[1] || 0);
    catalogRequests.push(route.request().url() + " " + range);
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": offset ? "1-1/2" : "0-0/2" },
      body: JSON.stringify([{ id: offset ? 9 : 8, title: offset ? "ئىككىنچى بەت" : "باشلانغۇچ", author: "A", source: "yengi-tur.html", price: 12, stock: 2, is_active: true, image_url: "/kutadgu-logo.png" }])
    });
  });
  await page.route("**/rpc/query_public_book_catalog**", (route) => {
    catalogRequests.push(route.request().postData() || "");
    const body = JSON.parse(route.request().postData() || "{}");
    const offset = Number(body.p_query && body.p_query.offset || 0);
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [{ kind: "book", id: offset ? 9 : 8, title: offset ? "ئىككىنچى بەت" : "باشلانغۇچ", source: "yengi-tur.html", price: 12, stock: 2, is_active: true }], total: 2, has_more: offset === 0 })
    });
  });
  await page.route("**/yengi-tur", (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
  await page.goto("/yengi-tur", { waitUntil: "domcontentloaded" });
  await expect(page.locator("h1")).toHaveText("يېڭى تۈر");
  await expect(page.locator(".books-grid")).toHaveAttribute("data-catalog-source", "yengi-tur.html");
  await expect(page.locator("link[rel='canonical']")).toHaveAttribute("href", "https://www.kutadgubilik.com/yengi-tur");
  await expect.poll(() => catalogRequests.some((entry) => entry.includes("yengi-tur.html"))).toBe(true);
  await page.locator("#catalogMinPrice").fill("1");
  await expect.poll(() => catalogRequests.filter((entry) => entry.includes("yengi-tur.html")).length).toBeGreaterThan(1);
  await page.locator(".catalog-load-more").click();
  await expect.poll(() => catalogRequests.filter((entry) => entry.includes("yengi-tur.html")).length).toBeGreaterThan(2);
  await expect(page.locator(".books-grid")).toContainText("ئىككىنچى بەت");
  expect(catalogRequests.some((entry) => entry.includes("universal.html"))).toBe(false);
});

test("staff entry uses the visible category directory", async ({ page }) => {
  await installDirectory(page);
  await page.goto("/book-staff.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#staffSource option[value='yeni-tur.html']")).toHaveCount(1);
  await expect(page.locator("#staffSource option[value='tibb.html']")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(shotDir, "categories-staff-390.png"), fullPage: false });
});
