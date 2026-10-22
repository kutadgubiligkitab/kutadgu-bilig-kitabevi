const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const TITLE = "سوغۇق يۈكلەش رومانى";
const GROUP = "سوغۇق يۈرۈشلۈك";
const COVER = "/kutadgu-logo.png";
const GALLERY = "/hero-brand-logo.png";
const root = path.join(__dirname, "..", "..");
const shotDir = path.join(root, "scratch-catalog-cover");
const logo = fs.readFileSync(path.join(root, "kutadgu-logo.png"));
const A = "https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/book/111.webp";
const B = "https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/book/222.webp";

function row(overrides) {
  return {
    id: 91001,
    title: TITLE,
    author: "سىناق ئاپتور",
    price: 88,
    source: "romanlar.html",
    category: "رومانلار",
    image_url: COVER,
    gallery_images: [GALLERY],
    is_active: true,
    is_recommended: true,
    is_new: true,
    stock: 4,
    stock_status: "in_stock",
    sales_count: 0,
    submission_status: "approved",
    created_at: "2026-08-02T00:00:00Z",
    ...overrides
  };
}

function catalogItem(book) {
  return {
    kind: "book",
    id: book.id,
    title: book.title,
    author: book.author,
    price: book.price,
    category: book.category,
    source: book.source,
    image_url: book.image_url,
    gallery_images: book.gallery_images || [],
    is_active: book.is_active !== false,
    is_recommended: !!book.is_recommended,
    is_new: !!book.is_new,
    stock: book.stock,
    stock_status: book.stock_status,
    submission_status: book.submission_status || "approved",
    unit_key: "book:" + book.id,
    href: "/book/" + book.id
  };
}

function groupPayload() {
  return {
    id: 77,
    slug: "demo-series",
    title: GROUP,
    author: "سىناق ئاپتور",
    category: "رومانلار",
    source: "romanlar.html",
    description: "",
    complete_set_price: 150,
    effective_set_price: 150,
    representative_book_id: 91001,
    revision: 1,
    quote_revision: "fixture",
    members: [
      { book_id: 91001, position: 1, volume_label: "1", title: TITLE, author: "سىناق ئاپتور", price: 70, image_url: COVER, stock: 4, stock_status: "in_stock", is_active: true },
      { book_id: 91002, position: 2, volume_label: "2", title: TITLE + " 2", author: "سىناق ئاپتور", price: 80, image_url: COVER, stock: 4, stock_status: "in_stock", is_active: true }
    ]
  };
}

function detailHtml(bookId) {
  return fs.readFileSync(path.join(root, "book-shell.html"), "utf8")
    .replace('<div class="book-cover-box"><img src="" alt="" hidden></div>', `<div class="book-cover-box"><img src="${COVER}" alt="مۇقاۋا"></div>`)
    .replace("<h1>كىتاب</h1>", `<h1>${TITLE}</h1>`)
    .replace("<body", `<body data-book-id="${bookId}"`);
}

async function installGuards(page, state) {
  await page.addInitScript(() => {
    try { sessionStorage.removeItem("kutadgu-catalog-active-count-v1"); } catch (err) {}
  });
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (/visit-count|analytics-event|analytics_events|visit-proof|cdn-cgi\/rum|\/orders|admin_/i.test(url)) {
      state.blocked.push(method + " " + url);
      return route.abort();
    }
    if (method === "HEAD" && /sales_count=gt\.0/.test(url)) {
      return route.fulfill({ status: 200, headers: { "content-range": "*/0" }, body: "" });
    }
    if (method === "HEAD" && /\/rest\/v1\/books\?/.test(url)) {
      state.heads += 1;
      state.events.push({ t: Date.now(), kind: "head" });
      if (state.head === "hang") {
        await state.hold;
      }
      if (state.head === "fail" || state.head === "hang") {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "probe failed" }) });
      }
      return route.fulfill({ status: 200, headers: { "content-range": "0-0/1" }, body: "" });
    }
    if (method === "POST" && /query_public_book_catalog/.test(url)) {
      state.rpcs += 1;
      state.events.push({ t: Date.now(), kind: "catalog" });
      if (state.catalog === "fail") {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "catalog down" }) });
      }
      let query = {};
      try { query = req.postDataJSON().p_query || {}; } catch (err) { query = {}; }
      if (state.catalog === "empty" || query.search === "emptyterm") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], total: 0, has_more: false }) });
      }
      const rows = (state.rows || [row()]).filter((item) => item.is_active !== false);
      const offset = Number(query.offset) || 0;
      if (state.paging && Number(query.limit) < 100) {
        state.offsets = state.offsets || [];
        state.offsets.push(offset);
        if (state.failFromOffset != null && offset >= state.failFromOffset) {
          return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "page down" }) });
        }
        const slice = rows.slice(offset, offset + 1);
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: slice.map(catalogItem), total: rows.length, has_more: offset + slice.length < rows.length })
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: rows.map(catalogItem), total: rows.length, has_more: false })
      });
    }
    if (method === "POST" && /get_public_book_volume_group_storefront/.test(url)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.group || groupPayload()) });
    }
    if (method === "POST" && /resolve_public_book_volume_context|list_public_book_volume_part_prices|map_public_books_to_catalog_units|list_public_book_volume_discovery_unit_ids/.test(url)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
    }
    if (method === "POST" && /quote_book_volume_cart/.test(url)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ total: 0, total_qty: 0, lines: [] }) });
    }
    if ((method === "GET" || method === "HEAD") && /\/rest\/v1\/books\?/.test(url)) {
      state.bookReads += 1;
      state.events.push({ t: Date.now(), kind: "book" });
      if (state.book === "hold") await state.bookHold;
      if (state.book === "fail") {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "book down" }) });
      }
      if (state.book === "empty") {
        return route.fulfill({ status: 200, contentType: "application/json", headers: { "content-range": "*/0" }, body: "[]" });
      }
      const rows = state.rows || [row(), row({ id: 91002, title: TITLE + " 2" })];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` },
        body: JSON.stringify(rows)
      });
    }
    if (/supabase\.co/i.test(url) && (method === "GET" || method === "HEAD")) {
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "content-range": "*/0" }, body: "[]" });
    }
    if (/fixture-cover\.webp/.test(url)) {
      state.coverHits += 1;
      if (!state.coverOk) return route.fulfill({ status: 404, body: "missing" });
      return route.fulfill({ status: 200, contentType: "image/png", body: logo });
    }
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      state.blocked.push(method + " " + url);
      return route.abort();
    }
    return route.continue();
  });
}

function fresh(overrides) {
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  return {
    head: "fail",
    catalog: "ok",
    book: "ok",
    heads: 0,
    rpcs: 0,
    bookReads: 0,
    coverHits: 0,
    coverOk: true,
    events: [],
    blocked: [],
    rows: [row()],
    hold,
    release,
    ...overrides
  };
}

async function shot(page, name) {
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, name + ".png"), fullPage: false });
}

test("a hanging availability HEAD still starts the catalog read", async ({ page }) => {
  const state = fresh({ head: "hang" });
  await installGuards(page, state);
  const started = Date.now();
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect.poll(() => state.rpcs, { timeout: 5000 }).toBeGreaterThan(0);
    const firstRpc = Date.now() - started;
    expect(state.heads).toBeGreaterThan(0);
    const catalogEvent = state.events.find((event) => event.kind === "catalog");
    expect(catalogEvent.t - started).toBeLessThan(5000);
    await expect(page.locator("#homeFeaturedBooks")).toContainText(TITLE, { timeout: 8000 });
    const firstText = Date.now() - started;
    console.log(JSON.stringify({ scenario: "slow-head-homepage", firstRpcMs: firstRpc, firstTextMs: firstText, heads: state.heads }));
    await shot(page, "homepage-during-head");
    expect(state.blocked.join("\n")).not.toMatch(/visit-count|analytics|orders/);
  } finally {
    state.release();
  }
});

test("a failed availability HEAD still reads the detail book and keeps the server cover", async ({ page }) => {
  const state = fresh({ head: "fail", book: "ok" });
  await installGuards(page, state);
  await page.route("**/book/91001**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: detailHtml(91001)
  }));
  const started = Date.now();
  await page.goto("/book/91001", { waitUntil: "domcontentloaded" });
  await expect.poll(() => state.bookReads, { timeout: 5000 }).toBeGreaterThan(0);
  await expect(page.locator("h1")).toContainText(TITLE);
  await expect(page.locator(".book-cover-box img")).toBeVisible();
  const firstText = Date.now() - started;
  console.log(JSON.stringify({ scenario: "failed-head-detail", bookReads: state.bookReads, firstTextMs: firstText }));
  await expect(page.locator(".book-cover-box .book-cover-unavailable")).toHaveCount(0);
});

test("failed metadata refresh keeps a decoded server cover and does not offer purchase", async ({ page }) => {
  const state = fresh({ head: "fail", book: "fail" });
  await installGuards(page, state);
  await page.route("**/book/91001**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: detailHtml(91001)
  }));
  await page.goto("/book/91001", { waitUntil: "domcontentloaded" });
  const img = page.locator(".book-cover-box img");
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((node) => node.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator(".book-cover-unavailable")).toHaveCount(0);
  await expect(page.locator(".add-to-cart, .detail-main-cart")).toHaveCount(0);
  await expect(page.locator("[data-detail-boot]")).toHaveAttribute("data-detail-boot", "unavailable");
  await shot(page, "ssr-cover-kept");
});

test("a replaced hero recovers once and the gallery can change it", async ({ page }) => {
  const state = fresh({ head: "fail", book: "ok", coverOk: false, rows: [row({ image_url: "/fixture-cover.webp", gallery_images: [GALLERY] })] });
  await installGuards(page, state);
  await page.route("**/book/91001**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: detailHtml(91001)
  }));
  await page.goto("/book/91001", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".book-cover-box .book-cover-unavailable")).toBeVisible({ timeout: 8000 });
  state.coverOk = true;
  await expect(page.locator(".book-cover-box img")).toBeVisible({ timeout: 8000 });
  await expect.poll(() => page.locator(".book-cover-box img").evaluate((node) => node.naturalWidth)).toBeGreaterThan(0);
  const thumb = page.locator(".book-gallery-thumb").nth(1);
  await expect(thumb).toBeVisible();
  await thumb.click();
  await expect(page.locator(".book-cover-box img")).toBeVisible();
  await expect.poll(() => page.locator(".book-cover-box img").getAttribute("src")).toContain("hero-brand-logo");
  await shot(page, "hero-recovered");
});

test("selecting gallery B before A's recovery timer fires keeps B", async ({ page }) => {
  const state = fresh({ head: "fail", book: "ok", coverOk: false, rows: [row({ image_url: "/fixture-cover.webp", gallery_images: [GALLERY] })] });
  await installGuards(page, state);
  await page.route("**/book/91001**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: detailHtml(91001)
  }));
  await page.goto("/book/91001", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".book-cover-box .book-cover-unavailable")).toBeVisible({ timeout: 8000 });
  const hitsAtFailure = state.coverHits;
  const thumb = page.locator(".book-gallery-thumb").nth(1);
  await expect(thumb).toBeVisible();
  await thumb.click();
  state.coverOk = true;
  await expect.poll(() => page.locator(".book-cover-box img").getAttribute("src")).toContain("hero-brand-logo");
  await page.waitForTimeout(1800);
  await expect(page.locator(".book-cover-box img")).toHaveAttribute("src", /hero-brand-logo/);
  await expect(page.locator(".book-cover-box img")).not.toHaveAttribute("src", /fixture-cover/);
  expect(state.coverHits).toBe(hitsAtFailure);
  await expect(page.locator(".book-cover-box .book-cover-unavailable")).toHaveCount(0);
});

test("a decoded cover still receives the authoritative title and description", async ({ page }) => {
  let releaseBook = () => {};
  const state = fresh({
    head: "fail",
    book: "hold",
    rows: [row({ title: "يېڭى ماۋزۇ", description: "يېڭى چۈشەندۈرۈش", image_url: "", author: "يېڭى ئاپتور" })]
  });
  state.bookHold = new Promise((resolve) => { releaseBook = resolve; });
  await installGuards(page, state);
  await page.route("**/book/91001**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: detailHtml(91001)
  }));
  await page.goto("/book/91001", { waitUntil: "domcontentloaded" });
  const img = page.locator(".book-cover-box img");
  await expect.poll(() => img.evaluate((node) => node.naturalWidth)).toBeGreaterThan(0);
  releaseBook();
  await expect(page.locator(".book-detail-info h1")).toHaveText("يېڭى ماۋزۇ");
  await expect(page.locator(".dynamic-book-description")).toBeVisible();
  await expect(page.locator(".dynamic-book-description p")).toHaveText("يېڭى چۈشەندۈرۈش");
  await expect(page.locator(".book-author")).toContainText("يېڭى ئاپتور");
  await expect(img).toHaveAttribute("src", /kutadgu-logo\.png/);
  await expect.poll(() => img.evaluate((node) => node.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator(".book-cover-unavailable")).toHaveCount(0);
});

test("a source change does not fall back to the previous cover", async ({ page }) => {
  await page.route("**/origin-fixture.html", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><html><body></body></html>"
  }));
  await page.goto("/origin-fixture.html", { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ path: path.join(root, "kutadgu-image-storage.js") });
  const result = await page.evaluate(({ originA, originB }) => {
    const images = window.KutadguImageStorage;
    const source = {
      r2ReadEnabled: true,
      hostname: "kutadgu-cloudflare-preview.kutadgu-preview.workers.dev",
      origin: "https://kutadgu-cloudflare-preview.kutadgu-preview.workers.dev",
      pathname: "/"
    };
    images.installPreviewCoverBridge(document, source);
    const img = document.createElement("img");
    document.body.appendChild(img);
    img.src = originA;
    const afterA = img.getAttribute("data-kutadgu-cover-origin");
    img.src = originB;
    const afterB = img.getAttribute("data-kutadgu-cover-origin");
    const rewrittenB = img.getAttribute("src");
    img.setAttribute("data-kutadgu-cover-assigned", images.previewImageUrl(originA, source));
    img.dispatchEvent(new Event("error", { bubbles: true }));
    const afterLate = img.getAttribute("src");
    img.setAttribute("data-kutadgu-cover-assigned", rewrittenB);
    img.setAttribute("data-kutadgu-cover-origin", originA);
    img.dispatchEvent(new Event("error", { bubbles: true }));
    return { afterA, afterB, rewrittenB, afterLate, afterStaleOrigin: img.getAttribute("src") };
  }, { originA: A, originB: B });
  expect(result.afterA).toBe(A);
  expect(result.afterB).toBe(B);
  expect(result.rewrittenB).toContain("/222.webp");
  expect(result.afterLate).toBe(result.rewrittenB);
  expect(result.afterStaleOrigin).not.toContain("/111.webp");
});

test("refresh keeps the same results, empty stays empty, and a hidden book stays hidden", async ({ page }) => {
  const state = fresh({ head: "fail" });
  await installGuards(page, state);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#homeFeaturedBooks")).toContainText(TITLE);
  await expect(page.locator("#homeCarouselTrack")).toContainText(TITLE);
  state.catalog = "fail";
  await page.evaluate(() => window.kutadguShop.renderHomeFeaturedBooks({ forceRecovery: true }));
  await expect(page.locator("#homeFeaturedBooks")).toContainText(TITLE);
  await expect(page.locator("#homeFeaturedBooks")).not.toContainText("يۈكلەش ۋاقىتلىق مۇمكىن بولمىدى");
  await expect(page.locator("#homeFeaturedBooks")).toHaveAttribute("data-catalog-state", "ready");

  await page.evaluate(() => {
    const host = document.querySelector("#homeCarouselTrack");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.carouselRetry = "1";
    button.textContent = "قايتا سىناش";
    host.appendChild(button);
    button.click();
  });
  await expect(page.locator("#homeCarouselTrack")).toContainText(TITLE);
  await expect(page.locator("#homeCarouselTrack")).not.toContainText("كىتابلارنى يۈكلەش ۋاقىتلىق مۇمكىن بولمىدى");

  state.catalog = "ok";
  await page.locator("#searchInput").fill(TITLE);
  await page.locator("#searchInput").press("Enter");
  await expect(page.locator("#searchResults")).toContainText(TITLE);
  state.catalog = "fail";
  await page.locator("#searchInput").press("Enter");
  await expect(page.locator("#searchResults")).toContainText(TITLE);
  await expect(page.locator("#searchResults")).toHaveAttribute("data-search-state", "results");
  await expect(page.locator("#searchResults")).not.toContainText("ئىزدەش ۋاقىتلىق ئىشلىمىدى");

  state.catalog = "ok";
  await page.locator("#searchInput").fill("emptyterm");
  await page.locator("#searchInput").press("Enter");
  await expect(page.locator("#searchResults")).toContainText(/نەتىجە تېپىلمىدى|ئىزدەش نەتىجىسى تېپىلمىدى/);
  await expect(page.locator("#searchResults")).toHaveAttribute("data-search-state", "empty");
  state.catalog = "fail";
  await page.locator("#searchInput").press("Enter");
  await expect(page.locator("#searchResults")).toContainText(/نەتىجە تېپىلمىدى|ئىزدەش نەتىجىسى تېپىلمىدى/);
  await expect(page.locator("#searchResults")).toHaveAttribute("data-search-state", "empty");
  await expect(page.locator("#searchResults")).not.toContainText("ئىزدەش ۋاقىتلىق ئىشلىمىدى");

  state.catalog = "fail";
  await page.locator("#searchInput").fill("other-query");
  await page.locator("#searchInput").press("Enter");
  await expect(page.locator("#searchResults")).toContainText("ئىزدەش ۋاقىتلىق ئىشلىمىدى");
  await expect(page.locator("#searchResults")).not.toContainText(TITLE);
});

test("listing and discovery keep a matching result and a real empty shelf", async ({ page }) => {
  const state = fresh({ head: "fail" });
  await installGuards(page, state);
  await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".books-grid")).toContainText(TITLE);
  state.catalog = "fail";
  await page.locator("#catalogFilterText").dispatchEvent("input");
  await page.waitForTimeout(700);
  await expect(page.locator(".books-grid")).toContainText(TITLE);
  await expect(page.locator(".books-grid")).not.toContainText("قايتا سىناڭ");
  await expect(page.locator(".books-grid")).toHaveAttribute("data-catalog-state", "ready");

  state.catalog = "empty";
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#homeFeaturedBooks")).toContainText("كىتابلار تېخى قوشۇلمىغان");
  await expect(page.locator("#homeFeaturedBooks")).toHaveAttribute("data-catalog-state", "empty");
  state.catalog = "fail";
  await page.evaluate(() => window.kutadguShop.renderHomeFeaturedBooks({ forceRecovery: true }));
  await expect(page.locator("#homeFeaturedBooks")).toContainText("كىتابلار تېخى قوشۇلمىغان");
  await expect(page.locator("#homeFeaturedBooks")).toHaveAttribute("data-catalog-state", "empty");

  state.catalog = "ok";
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("[data-premium-group='literature']").click();
  await expect(page.locator("#premiumDiscoveryResults")).toContainText(TITLE);
  state.catalog = "fail";
  await page.locator("[data-premium-group='literature']").click();
  await expect(page.locator("#premiumDiscoveryResults")).toContainText(TITLE);
  await expect(page.locator("#premiumDiscoveryResults")).toHaveAttribute("data-discovery-state", "results");
  await expect(page.locator("#premiumDiscoveryResults")).not.toContainText("ۋاقىتلىق خاتالىق");
});

test("a failed load-more keeps the rows and leaves the next page reachable", async ({ page }) => {
  const second = "ئىككىنچى بەت كىتابى";
  const state = fresh({
    head: "fail",
    paging: true,
    failFromOffset: 1,
    rows: [row(), row({ id: 91002, title: second })]
  });
  await installGuards(page, state);
  await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
  const grid = page.locator(".books-grid");
  await page.locator("#catalogSort").selectOption("new");
  await expect(grid.locator(".book-card")).toHaveCount(1);
  await expect(grid).toContainText(TITLE);
  await expect(grid).not.toContainText(second);
  const more = page.locator(".catalog-load-more");
  await expect(more).toBeVisible();
  await more.click();
  await expect(grid.locator(".book-card")).toHaveCount(1);
  await expect(grid).toContainText(TITLE);
  await expect(grid).not.toContainText(second);
  await expect(more).toBeVisible();
  await expect(more).toBeEnabled();
  expect(state.offsets.filter((offset) => offset >= 1)).toEqual([1]);
  state.failFromOffset = null;
  await more.click();
  await expect(grid.locator(".book-card", { hasText: TITLE })).toHaveCount(1);
  await expect(grid.locator(".book-card", { hasText: second })).toHaveCount(1);
  expect(state.offsets.filter((offset) => offset >= 1)).toEqual([1, 1]);
});

test("confirmed hidden detail removes the cover and does not keep a buy button", async ({ page }) => {
  const state = fresh({ head: "fail", book: "empty" });
  await installGuards(page, state);
  await page.route("**/book/91001**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: detailHtml(91001)
  }));
  await page.goto("/book/91001", { waitUntil: "domcontentloaded" });
  await expect(page.locator("h1")).toHaveText("بۇ كىتاب ھازىرچە تەمىنلەنمەيدۇ.");
  await expect(page.locator(".book-cover-box img")).toHaveCount(0);
  await expect(page.locator(".add-to-cart, .detail-main-cart")).toHaveCount(0);
  await page.waitForTimeout(1600);
  await expect(page.locator(".book-cover-box img")).toHaveCount(0);
  await expect(page.locator(".add-to-cart, .detail-main-cart")).toHaveCount(0);
  await shot(page, "hidden-book");
});

test("cold, warm, back, and resume keep the loaded book", async ({ page }) => {
  const state = fresh({ head: "fail" });
  await installGuards(page, state);
  await page.route("**/book/91001**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: detailHtml(91001)
  }));
  const coldStart = Date.now();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#homeFeaturedBooks")).toContainText(TITLE);
  const coldMs = Date.now() - coldStart;
  const warmStart = Date.now();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#homeFeaturedBooks")).toContainText(TITLE);
  const warmMs = Date.now() - warmStart;
  await page.goto("/book/91001", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".book-cover-box img")).toBeVisible();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.goBack();
  await expect(page.locator("h1")).toContainText(TITLE);
  await expect(page.locator(".book-cover-box img")).toBeVisible();
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect(page.locator(".book-cover-box img")).toBeVisible();
  await page.context().setOffline(false);
  console.log(JSON.stringify({ scenario: "navigation", coldMs, warmMs }));
  await shot(page, "back-detail");
});

test("a failed HEAD still reads an ordinary group detail", async ({ page }) => {
  const state = fresh({ head: "fail", rows: [row(), row({ id: 91002, title: TITLE + " 2" })] });
  await installGuards(page, state);
  await page.route("**/volume-group/demo-series**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: detailHtml(91001)
  }));
  await page.goto("/volume-group/demo-series", { waitUntil: "domcontentloaded" });
  await expect.poll(() => state.bookReads).toBeGreaterThan(0);
  await expect(page.locator("h1")).toContainText(GROUP);
  await expect(page.locator(".book-cover-box img")).toBeVisible();
});

test.describe("customer origin", () => {
  test("read-only homepage and detail on the public site", async ({ page }) => {
    test.skip(!process.env.KUTADGU_LIVE_ORIGIN_CHECK, "local fixtures only");
    test.setTimeout(90000);
    const blocked = [];
    await page.route("**/*", async (route) => {
      const req = route.request();
      const url = req.url();
      const method = req.method();
      if (/visit-count|analytics-event|analytics_events|visit-proof|cdn-cgi\/rum|\/orders|admin_/i.test(url)) {
        blocked.push(method + " " + url);
        return route.abort();
      }
      const publicRead = /query_public_book_catalog|list_public_book_volume_discovery_unit_ids|resolve_public_book_volume_context|get_public_book_volume_group_storefront|map_public_books_to_catalog_units|list_public_book_volume_part_prices|quote_book_volume_cart/;
      if (method === "POST" && publicRead.test(url)) return route.continue();
      if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
        blocked.push(method + " " + url);
        return route.abort();
      }
      return route.continue();
    });
    const started = Date.now();
    const response = await page.goto("https://www.kutadgubilik.com/", { waitUntil: "domcontentloaded" });
    expect(response.ok()).toBeTruthy();
    await expect(page.locator("#homeFeaturedBooks .home-feature-title, #homeCarouselTrack .home-carousel-title").first()).toBeVisible({ timeout: 20000 });
    const homeMs = Date.now() - started;
    await shot(page, "live-home");
    const href = await page.locator("a[href*='/book/']").first().getAttribute("href");
    const detailStart = Date.now();
    await page.goto(new URL(href, "https://www.kutadgubilik.com/").toString(), { waitUntil: "domcontentloaded" });
    await expect(page.locator(".book-cover-box img")).toBeVisible({ timeout: 20000 });
    const detailMs = Date.now() - detailStart;
    await shot(page, "live-detail");
    console.log(JSON.stringify({ scenario: "live-origin", homeMs, detailMs, blocked: blocked.length, href }));
    expect(blocked.join("\n")).not.toMatch(/200/);
  });
});
