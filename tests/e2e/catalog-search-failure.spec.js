const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const FOUND_TITLE = "سېھىرلىك باغ";
const FAIL_QUERY = "يېڭىلمىسۈز";
const ZERO_QUERY = "zzzz-no-such-book";
const COVER_PATH = "/missing-search-cover.png";

function bookRow() {
  return {
    id: 88001,
    title: FOUND_TITLE,
    author: "سىناق ئاپتور",
    category: "رومانلار",
    price: 42,
    image_url: COVER_PATH,
    is_active: true,
    stock: 3,
    stock_status: "in_stock",
    submission_status: "approved",
    created_at: "2026-09-01T00:00:00Z",
    source: "romanlar.html"
  };
}

function decodeUrl(url) {
  try { return decodeURIComponent(url); } catch (err) { return url; }
}

function fold(value) {
  return String(value || "").toLocaleLowerCase("ug");
}

function queryInUrl(url, query) {
  const folded = fold(url);
  const text = fold(query).trim();
  if (!text) return false;
  return folded.includes(text) || folded.includes(text.replace(/\s+/g, "*"));
}

function isFeaturedCatalogGet(url) {
  const text = decodeUrl(url);
  return text.includes("/rest/v1/books")
    && text.includes("select=*")
    && text.includes("order=created_at.desc")
    && !text.includes("ilike")
    && !text.includes("id=in.")
    && !text.includes("id=eq.");
}

async function installIsolatedCatalog(page, state) {
  const events = [];
  await page.addInitScript(() => {
    try { sessionStorage.removeItem("kutadgu-catalog-active-count-v1"); } catch (err) {}
    let core;
    Object.defineProperty(window, "KutadguAnalyticsCore", {
      configurable: true,
      enumerable: true,
      get() { return core; },
      set(value) {
        if (value && typeof value.shouldRecordRemote === "function" && !value.__localSearchStateProbe) {
          const original = value.shouldRecordRemote.bind(value);
          value.shouldRecordRemote = function (host, path) {
            const name = String(host || "").toLowerCase().replace(/:\d+$/, "");
            if (name === "127.0.0.1" || name === "localhost" || name === "::1" || name === "[::1]") {
              const clean = String(path || "").split("?")[0].toLowerCase();
              if (/(^|\/)admin\.html$/.test(clean) || /(^|\/)book-staff\.html$/.test(clean)) return false;
              return true;
            }
            return original(host, path);
          };
          value.__localSearchStateProbe = true;
        }
        core = value;
      }
    });
  });
  await H.installReadSafeNetwork(page);
  await page.route("**/missing-search-cover.png", (route) => route.fulfill({
    status: 404,
    contentType: "text/plain",
    body: "missing cover"
  }));
  await page.route("**/api/analytics-event**", (route) => route.abort());
  await page.route("**/rest/v1/analytics_events**", async (route) => {
    if (["POST", "PUT", "PATCH"].includes(route.request().method())) {
      try { events.push(route.request().postDataJSON()); } catch (err) { events.push({}); }
      return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/rest/v1/books**", async (route) => {
    const req = route.request();
    const url = req.url();
    const text = decodeUrl(url);
    if (req.method() === "HEAD") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-0/1" },
        body: ""
      });
    }
    if (req.method() !== "GET") return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    state.gets.push(text);
    if (state.failFeatured && isFeaturedCatalogGet(text)) {
      state.featuredFailures += 1;
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "featured down" }) });
    }
    if (state.holdQuery && text.includes(state.holdQuery)) {
      await new Promise((resolve) => state.release.push(resolve));
    }
    const failing = state.failQuery && queryInUrl(text, state.failQuery);
    if (failing) {
      state.searchFailures += 1;
      if (state.searchFailures <= state.failLimit) {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "search down" }) });
      }
    }
    const hit = state.hitQuery && (queryInUrl(text, state.hitQuery) || text.includes("id=in.(88001)") || text.includes("id=eq.88001"));
    const rows = hit ? [bookRow()] : [];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": hit ? "0-0/1" : "*/0" },
      body: JSON.stringify(rows)
    });
  });
  return events;
}

function catalogState() {
  return {
    gets: [],
    release: [],
    failFeatured: false,
    featuredFailures: 0,
    holdQuery: "",
    failQuery: "",
    failLimit: 2,
    searchFailures: 0,
    hitQuery: ""
  };
}

test.describe("catalog search failure stays distinct from an empty result", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a failed search keeps the query and filters, then a manual retry can succeed", async ({ page }) => {
    const state = catalogState();
    state.failQuery = FAIL_QUERY;
    state.hitQuery = FAIL_QUERY;
    const events = await installIsolatedCatalog(page, state);
    await H.openFresh(page, "/");
    const category = page.locator("#searchCategory");
    await expect(category.locator("option")).not.toHaveCount(0);
    const categoryValue = await category.locator("option").nth(1).getAttribute("value");
    expect(categoryValue).toBeTruthy();
    await page.locator("#searchInput").evaluate((el, value) => { el.value = value; }, FAIL_QUERY);
    await category.evaluate((el, value) => { el.value = value; }, categoryValue);
    await page.locator("#searchButton").click();
    const results = page.locator("#searchResults");
    await expect(results).toHaveAttribute("data-search-state", "failed");
    await expect(results.locator(".search-failed")).toContainText("ئىزدەش ۋاقىتلىق ئىشلىمىدى");
    await expect(results.locator(".search-empty")).toHaveCount(0);
    await expect(results).not.toContainText("ئىزدەش نەتىجىسى تېپىلمىدى");
    await expect(page.locator("#searchInput")).toHaveValue(FAIL_QUERY);
    await expect(category).toHaveValue(categoryValue);
    expect(state.searchFailures).toBe(2);
    expect(events.some((row) => row && row.search_query === FAIL_QUERY)).toBeFalsy();
    const retried = state.gets.filter((url) => queryInUrl(url, FAIL_QUERY) && url.includes("category=eq."));
    expect(retried.length).toBeGreaterThanOrEqual(2);

    await results.locator("[data-search-retry]").click();
    await expect(results).toHaveAttribute("data-search-state", "results");
    await expect(results.locator(".advanced-search-title")).toContainText(FOUND_TITLE);
    await expect(page.locator("#searchInput")).toHaveValue(FAIL_QUERY);
    await expect(category).toHaveValue(categoryValue);
    await expect.poll(() => events.filter((row) => row && row.search_query === FAIL_QUERY && row.event_name === "search").length).toBe(1);
  });

  test("loading stays visible until a genuine empty response, which can be enhanced", async ({ page }) => {
    const state = catalogState();
    state.holdQuery = ZERO_QUERY;
    const events = await installIsolatedCatalog(page, state);
    await H.openFresh(page, "/");
    await page.locator("#searchInput").fill(ZERO_QUERY);
    await page.locator("#searchButton").click();
    const results = page.locator("#searchResults");
    await expect(results).toHaveAttribute("data-search-state", "loading");
    await expect(results.locator(".catalog-loading-state")).toBeVisible();
    await expect(results.locator(".search-empty")).toHaveCount(0);
    await expect(results.locator(".search-failed")).toHaveCount(0);
    expect(events.some((row) => row && row.search_query === ZERO_QUERY)).toBeFalsy();
    state.release.splice(0).forEach((release) => release());
    await expect(results).toHaveAttribute("data-search-state", "empty");
    await expect(results.locator(".search-empty h2")).toHaveText("ئىزدەش نەتىجىسى تېپىلمىدى");
    await expect(results.locator(".smart-empty-actions")).toBeVisible();
    await expect(results.locator(".search-failed")).toHaveCount(0);
    await expect.poll(() => events.filter((row) => row && row.search_query === ZERO_QUERY).map((row) => row.event_name).sort()).toEqual(["search", "zero_result_search"]);
  });

  test("mobile cold load can fail the featured catalog while a later named search returns a book", async ({ page }) => {
    const state = catalogState();
    state.failFeatured = true;
    state.hitQuery = FOUND_TITLE;
    await installIsolatedCatalog(page, state);
    await H.openFresh(page, "/");
    const featured = page.locator("#homeFeaturedBooks");
    await expect(featured).toHaveAttribute("data-catalog-state", "failed");
    await expect(featured.locator(".catalog-error-state")).toContainText("يېقىندا قوشۇلغان كىتابلارنى يۈكلەش ۋاقىتلىق مۇمكىن بولمىدى");
    await expect(featured).not.toContainText("كىتابلار تېخى قوشۇلمىغان");
    await expect(page.locator("#searchResults")).not.toContainText("ئىزدەش نەتىجىسى تېپىلمىدى");
    expect(state.featuredFailures).toBeGreaterThan(0);

    await page.locator("#searchInput").fill(FOUND_TITLE);
    await page.locator("#searchButton").click();
    const results = page.locator("#searchResults");
    await expect(results).toHaveAttribute("data-search-state", "results");
    await expect(results.locator(".advanced-search-title")).toContainText(FOUND_TITLE);
    await expect(results.locator(".catalog-error-state")).toHaveCount(0);
    await expect(results.locator(".search-failed")).toHaveCount(0);
    await expect(featured).toHaveAttribute("data-catalog-state", "failed");
    const card = results.locator(".advanced-search-result", { hasText: FOUND_TITLE });
    await expect(card.locator(".book-cover-unavailable")).toBeVisible({ timeout: 10000 });
    await expect(card.locator(".advanced-search-title")).toHaveText(FOUND_TITLE);
  });
});
