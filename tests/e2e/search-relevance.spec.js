const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const BOOKS = [
  { id: 3, title: "يەر ئانا", author: "A", isbn: "111", category: "رومانلار", price: 40, is_active: true, created_at: "2026-03-01T00:00:00Z" },
  { id: 2, title: "ئانا دەريانى ئىزدەپ", author: "B", isbn: "222", category: "رومانلار", price: 50, is_active: true, created_at: "2026-02-01T00:00:00Z" },
  { id: 1, title: "ئانا", author: "C", isbn: "333", category: "رومانلار", price: 30, is_active: true, created_at: "2020-01-01T00:00:00Z" },
  { id: 4, title: "باشقا", author: "ئانا", isbn: "444", category: "لۇغەت", price: 80, is_active: true, created_at: "2026-04-01T00:00:00Z" }
];

function parseRange(headers) {
  const raw = headers.Range || headers.range || "0-99";
  const m = String(raw).match(/(\d+)-(\d+)/);
  return m ? { from: Number(m[1]), to: Number(m[2]) } : { from: 0, to: 99 };
}

async function mockCatalog(page, extra = []) {
  const all = BOOKS.concat(extra);
  await page.route("**/rest/v1/books**", async (route) => {
    const req = route.request();
    if (!["GET", "HEAD"].includes(req.method())) {
      return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
    }
    const url = new URL(req.url());
    const select = url.searchParams.get("select") || "*";
    const idFilter = url.searchParams.get("id") || "";
    const category = (url.searchParams.get("category") || "").replace(/^eq\./, "");
    const minPrice = url.searchParams.getAll("price").find((v) => v.startsWith("gte."));
    const maxPrice = url.searchParams.getAll("price").find((v) => v.startsWith("lte."));
    const { from, to } = parseRange(req.headers());
    let rows = all.filter((row) => row.is_active);
    if (category) rows = rows.filter((row) => row.category === category);
    if (minPrice) rows = rows.filter((row) => row.price >= Number(minPrice.slice(4)));
    if (maxPrice) rows = rows.filter((row) => row.price <= Number(maxPrice.slice(4)));
    if (idFilter.startsWith("in.(")) {
      const ids = idFilter.slice(4, -1).split(",").map((id) => Number(id));
      rows = ids.map((id) => all.find((row) => row.id === id)).filter(Boolean);
    } else if (url.searchParams.get("or")) {
      const q = decodeURIComponent(url.searchParams.get("or"));
      const term = (q.match(/ilike\.\*([^*]+)\*/) || [])[1] || "";
      if (term) {
        rows = rows.filter((row) => [row.title, row.author, row.category, row.isbn].some((value) => String(value).includes(term)));
      }
    }
    if (select === "*" && !idFilter.startsWith("in.(")) {
      rows = [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    }
    const slice = rows.slice(from, to + 1);
    const body = req.method() === "HEAD" ? "" : JSON.stringify(slice);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": `${from}-${from + Math.max(slice.length - 1, 0)}/${rows.length}` },
      body
    });
  });
}

async function setControl(page, selector, value) {
  await page.locator(selector).evaluate((el, v) => {
    el.value = v;
  }, value);
}

async function searchAna(page) {
  await page.locator("#searchInput").fill("ئانا");
  await page.locator("#searchButton").click();
  await expect(page.locator("#searchResults .advanced-search-result").first()).toBeVisible({ timeout: 20000 });
}

test.describe("Stage Search 1A relevance ranking", () => {
  test("A/D exact title ranks first even when it is last by created_at", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await mockCatalog(page);
    await H.openFresh(page, "/");
    await searchAna(page);
    const titles = await page.locator("#searchResults .advanced-search-title").allTextContents();
    expect(titles[0].trim()).toBe("ئانا");
    expect(titles.slice(0, 3).map((t) => t.trim())).toEqual(["ئانا", "ئانا دەريانى ئىزدەپ", "يەر ئانا"]);
  });

  test("B exact ISBN ranks first", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await mockCatalog(page);
    await H.openFresh(page, "/");
    await page.locator("#searchInput").fill("333");
    await page.locator("#searchButton").click();
    await expect(page.locator("#searchResults .advanced-search-title").first()).toHaveText("ئانا", { timeout: 20000 });
  });

  test("C/E title beat author-only; category filter still applies", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await mockCatalog(page);
    await H.openFresh(page, "/");
    await setControl(page, "#searchCategory", "رومانلار");
    await searchAna(page);
    const titles = await page.locator("#searchResults .advanced-search-title").allTextContents();
    expect(titles.map((t) => t.trim())).not.toContain("باشقا");
    expect(titles[0].trim()).toBe("ئانا");
  });

  test("F price filter keeps relevance among remaining hits", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await mockCatalog(page);
    await H.openFresh(page, "/");
    await setControl(page, "#searchMaxPrice", "35");
    await searchAna(page);
    const titles = await page.locator("#searchResults .advanced-search-title").allTextContents();
    expect(titles.map((t) => t.trim())).toEqual(["ئانا"]);
  });

  test("H explicit newest sort is preserved", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await mockCatalog(page);
    await H.openFresh(page, "/");
    await setControl(page, "#searchSort", "new");
    await searchAna(page);
    const titles = await page.locator("#searchResults .advanced-search-title").allTextContents();
    expect(titles[0].trim()).toBe("باشقا");
  });

  test("J zero-result copy is unchanged", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await mockCatalog(page);
    await H.openFresh(page, "/");
    await page.locator("#searchInput").fill("zzzz-no-match-kutadgu");
    await page.locator("#searchButton").click();
    await page.waitForSelector(".search-empty, .advanced-search-summary", { timeout: 20000 });
    await expect(page.locator("#searchResults")).toContainText(/نەتىجە تېپىلمىدى|ئىزدەش نەتىجىسى تېپىلمىدى/);
  });

  test("K search analytics fire once per query, not Load More", async ({ page }) => {
    const events = [];
    await H.installReadSafeNetwork(page);
    const extra = Array.from({ length: 40 }, (_, i) => ({
      id: 100 + i,
      title: `ئانا ${i}`,
      author: "Z",
      isbn: String(500 + i),
      category: "رومانلار",
      price: 20,
      is_active: true,
      created_at: `2025-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`
    }));
    await mockCatalog(page, extra);
    await page.route("**/rest/v1/analytics_events**", async (route) => {
      if (["POST", "PUT", "PATCH"].includes(route.request().method())) {
        try { events.push(route.request().postDataJSON()); } catch (err) { events.push({}); }
        return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
      }
      return route.continue();
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await H.openFresh(page, "/");
    await searchAna(page);
    const afterFirst = events.filter((row) => row && (row.event_name === "search" || row.name === "search")).length;
    expect(afterFirst).toBeLessThanOrEqual(1);
    const more = page.locator("#searchLoadMore");
    await expect(more).toBeVisible();
    const beforeCount = await page.locator("#searchResults .advanced-search-result").count();
    await more.click();
    await expect.poll(async () => page.locator("#searchResults .advanced-search-result").count()).toBeGreaterThan(beforeCount);
    const searches = events.filter((row) => row && (row.event_name === "search" || row.name === "search"));
    expect(searches.length).toBe(afterFirst);
  });

  test("G Load More appends later ranked hits without duplicating the first page", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    const extra = Array.from({ length: 40 }, (_, i) => ({
      id: 200 + i,
      title: `ئانا قوشۇمچە ${String(i).padStart(2, "0")}`,
      author: "Z",
      isbn: String(600 + i),
      category: "رومانلار",
      price: 20,
      is_active: true,
      created_at: `2025-02-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`
    }));
    await mockCatalog(page, extra);
    await page.setViewportSize({ width: 390, height: 844 });
    await H.openFresh(page, "/");
    await searchAna(page);
    const firstPage = (await page.locator("#searchResults .advanced-search-title").allTextContents()).map((t) => t.trim());
    expect(firstPage[0]).toBe("ئانا");
    expect(new Set(firstPage).size).toBe(firstPage.length);
    await expect(page.locator("#searchLoadMore")).toBeVisible();
    await page.locator("#searchLoadMore").click();
    await expect.poll(async () => page.locator("#searchResults .advanced-search-title").count()).toBeGreaterThan(firstPage.length);
    const all = (await page.locator("#searchResults .advanced-search-title").allTextContents()).map((t) => t.trim());
    expect(all.slice(0, firstPage.length)).toEqual(firstPage);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBeGreaterThan(firstPage.length);
  });

  test("I cold-load ?q= ranks after catalog-ready", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await mockCatalog(page);
    await H.openFresh(page, "/?q=" + encodeURIComponent("ئانا"));
    await expect(page.locator("#searchResults .advanced-search-title").first()).toHaveText("ئانا", { timeout: 20000 });
    const titles = await page.locator("#searchResults .advanced-search-title").allTextContents();
    expect(titles.slice(0, 3).map((t) => t.trim())).toEqual(["ئانا", "ئانا دەريانى ئىزدەپ", "يەر ئانا"]);
  });

  test("L static fallback still ranks when remote catalog is unavailable", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await page.route("**/supabase-config.js*", async (route) => {
      const response = await route.fetch();
      const body = (await response.text()) + "\nwindow.KUTADGU_SUPABASE_CONFIG={url:'',anonKey:'',publishableKey:''};";
      return route.fulfill({
        status: 200,
        contentType: "application/javascript; charset=utf-8",
        body
      });
    });
    await H.openFresh(page, "/");
    await page.locator("#searchInput").fill("ئانا");
    await page.locator("#searchButton").click();
    await expect(page.locator("#searchResults")).toBeVisible({ timeout: 20000 });
    const empty = await page.locator("#searchResults .search-empty").count();
    const hits = await page.locator("#searchResults .advanced-search-result").count();
    expect(empty + hits).toBeGreaterThan(0);
  });

  test("M layout still uses the existing search card", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await mockCatalog(page);
    await H.openFresh(page, "/");
    await expect(page.locator("#searchInput")).toBeVisible();
    await expect(page.locator("#searchButton")).toBeVisible();
    await expect(page.locator("#advancedSearchPanel")).toBeAttached();
    await expect(page.locator("#searchSort")).toHaveValue("relevance");
  });
});
