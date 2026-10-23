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

async function installDirectory(page) {
  const writes = [];
  await H.installReadSafeNetwork(page);
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) && !request.url().includes("list_public_book_categories") && !request.url().includes("127.0.0.1")) {
      writes.push(request.method() + " " + request.url().split("?")[0]);
    }
  });
  page._categoryWrites = writes;
  await page.route("**/rpc/list_public_book_categories**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(directory)
  }));
  await page.addInitScript((rows) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguSkipSuggestFetch = true;
    window.__categoryRows = rows;
    window.__categoryCalls = [];
    window.__kutadguAnalyticsDb = {
      async rpc(name, args) {
        window.__categoryCalls.push({ name, args });
        if (name === "admin_list_book_categories") return { data: window.__categoryRows };
        if (name === "admin_create_book_category") {
          window.__categoryRows.unshift({ id: 44, slug: args.p_slug, source: args.p_slug + ".html", label: args.p_label, summary: args.p_summary, icon: "📚", sort_order: 1, is_hidden: false, retired: false, revision: 1, book_count: 0, group_count: 0 });
          return { data: { id: 44, slug: args.p_slug, source: args.p_slug + ".html", label: args.p_label, revision: 1 } };
        }
        if (name === "admin_rename_book_category") return { data: { id: args.p_id, label: args.p_label, revision: args.p_expected_revision + 1 } };
        if (name === "admin_move_book_category_order") return { data: { id: args.p_id, moved: true, revision: args.p_expected_revision + 1 } };
        if (name === "admin_set_book_category_hidden") return { data: { id: args.p_id, is_hidden: args.p_hidden, revision: args.p_expected_revision + 1 } };
        if (name === "admin_retire_book_category") {
          if (window.__categoryRows.some((row) => row.id === args.p_id && row.book_count > 0)) {
            return { error: { message: "category_not_empty" } };
          }
          return { data: { id: args.p_id, redirect_slug: "grammar", revision: args.p_expected_revision + 1 } };
        }
        if (name === "admin_preview_book_category_move") {
          return { data: { source: { label: "ئۇنىۋېرسال", source: "universal.html" }, destination: { id: args.p_destination_id, label: "يېڭى تۈر", source: "yeni-tur.html" }, selected_book_count: 1, book_count: 2, group_count: 1, book_ids: [1, 4] } };
        }
        if (name === "admin_move_books_to_category") {
          if (window.__holdMove) return new Promise(() => {});
          return { data: { applied_books: 2, applied_groups: 1 } };
        }
        return { data: [] };
      },
      from() {
        const chain = {
          select() { return chain; },
          eq() { return chain; },
          then(resolve) {
            resolve({ data: [{ id: 1, title: "ساقلانغان كىتاب", source: "universal.html", is_active: false, submission_status: "pending" }], error: null });
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
  await page.locator("#bookCategoryPreviewMove").click();
  await expect(page.locator("#bookCategoryMovePreview")).toContainText("جەمئىي كىتاب: 2");
  await expect(page.locator("#bookCategoryMovePreview")).toContainText("يۈرۈشلۈك: 1");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: path.join(shotDir, "categories-admin-1280.png"), fullPage: false });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  expect(overflow).toBe(false);
  await page.keyboard.press("Tab");
  expect(page._categoryWrites.filter((entry) => /\/rest\/v1\/books|storage/.test(entry))).toEqual([]);
});
