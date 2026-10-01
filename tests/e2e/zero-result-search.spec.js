const { test, expect } = require("./playwright-test");
const H = require("./helpers");

function searchEvents(events) {
  return events.filter((row) => row && (row.event_name === "search" || row.event_name === "zero_result_search"));
}

async function installSearchMocks(page, events, options = {}) {
  const state = { delayQuery: options.delayQuery || "", failQuery: options.failQuery || "", omitRange: false };
  // Production hosts stay the only live collectors. This probe lets the local
  // static server exercise the same insert, and the route below swallows it.
  await page.addInitScript(() => {
    let core;
    Object.defineProperty(window, "KutadguAnalyticsCore", {
      configurable: true,
      enumerable: true,
      get() { return core; },
      set(value) {
        if (value && typeof value.shouldRecordRemote === "function" && !value.__localZeroSearchProbe) {
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
          value.__localZeroSearchProbe = true;
        }
        core = value;
      }
    });
  });
  await H.installReadSafeNetwork(page);
  await page.route("**/rest/v1/analytics_events**", async (route) => {
    if (["POST", "PUT", "PATCH"].includes(route.request().method())) {
      try { events.push(route.request().postDataJSON()); } catch (err) { events.push({}); }
      return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/rest/v1/books**", async (route) => {
    const req = route.request();
    let url = req.url();
    try { url = decodeURIComponent(url); } catch (err) {}
    if (state.failQuery && req.method() !== "HEAD" && url.includes(state.failQuery)) {
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "catalog down" }) });
    }
    if (req.method() === "HEAD") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-0/1" },
        body: ""
      });
    }
    if (state.delayQuery && url.includes(state.delayQuery)) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    const hit = url.includes("title.ilike.*ئانا*") || url.includes("ilike.*ئانا*");
    const rows = hit ? [{
      id: 1,
      title: "ئانا",
      author: "C",
      isbn: "333",
      category: "رومانلار",
      price: 30,
      is_active: true,
      stock_status: "in_stock",
      stock: 4,
      created_at: "2020-01-01T00:00:00Z"
    }] : [];
    const headers = {};
    if (!state.omitRange || !hit) headers["content-range"] = hit ? "0-0/1" : "*/0";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers,
      body: JSON.stringify(rows)
    });
  });
  return state;
}

async function waitForQuery(events, query) {
  await expect.poll(() => searchEvents(events).filter((row) => row.search_query === query).length).toBeGreaterThan(0);
}

test.describe("zero-result search recording", () => {
  test("records a confirmed empty search once from each entry point and skips unknowns", async ({ page }) => {
    test.setTimeout(120000);
    const events = [];
    const state = await installSearchMocks(page, events);
    await H.openFresh(page, "/");
    await page.locator("#searchInput").fill("zzzz-no-such-book");
    await page.locator("#searchButton").click();
    await expect(page.locator("#searchResults")).toContainText(/نەتىجە تېپىلمىدى|ئىزدەش نەتىجىسى تېپىلمىدى/);
    await waitForQuery(events, "zzzz-no-such-book");
    const zero = searchEvents(events).filter((row) => row.search_query === "zzzz-no-such-book");
    expect(zero.map((row) => row.event_name).sort()).toEqual(["search", "zero_result_search"]);
    expect(zero.every((row) => row.result_count === 0)).toBeTruthy();

    await page.locator("#searchButton").click();
    await expect.poll(() => searchEvents(events).filter((row) => row.search_query === "zzzz-no-such-book" && row.event_name === "search").length).toBe(2);

    const beforeBlank = searchEvents(events).length;
    await page.locator("#searchInput").fill("   ");
    await page.locator("#searchButton").click();
    await page.waitForTimeout(500);
    expect(searchEvents(events).length).toBe(beforeBlank);

    const beforeSensitive = searchEvents(events).length;
    await page.locator("#searchInput").fill("user@example.com");
    await page.locator("#searchButton").click();
    await page.waitForTimeout(500);
    expect(searchEvents(events).length).toBe(beforeSensitive);

    await page.locator("#searchInput").fill("9780306406157");
    await page.locator("#searchButton").click();
    await waitForQuery(events, "9780306406157");
    expect(searchEvents(events).some((row) => row.search_query === "9780306406157" && row.event_name === "zero_result_search")).toBeTruthy();

    await page.locator("#searchInput").fill("ن");
    await page.locator("#searchButton").click();
    await waitForQuery(events, "ن");

    state.omitRange = true;
    await page.locator("#searchSort").evaluate((el) => { el.value = "new"; });
    await page.locator("#searchInput").fill("ئانا");
    await page.locator("#searchButton").click();
    await expect(page.locator("#searchResults .advanced-search-result").first()).toBeVisible();
    await waitForQuery(events, "ئانا");
    const known = searchEvents(events).filter((row) => row.search_query === "ئانا");
    expect(known.every((row) => row.event_name === "search")).toBeTruthy();
    expect(known.every((row) => row.result_count === null)).toBeTruthy();
    state.omitRange = false;

    await page.locator("#kutadguHeaderSearch").fill("header-zero-term");
    await page.locator(".kutadgu-header-search button[type='submit']").click();
    await waitForQuery(events, "header-zero-term");
    expect(searchEvents(events).filter((row) => row.search_query === "header-zero-term").map((row) => row.event_name).sort()).toEqual(["search", "zero_result_search"]);

    state.delayQuery = "stale-zero-term";
    await page.locator("#searchInput").fill("stale-zero-term");
    await page.locator("#searchButton").click();
    await page.locator("#searchInput").fill("fresh-zero-term");
    await page.locator("#searchButton").click();
    await waitForQuery(events, "fresh-zero-term");
    await page.waitForTimeout(1500);
    expect(searchEvents(events).some((row) => row.search_query === "stale-zero-term")).toBeFalsy();

    state.delayQuery = "";
    state.failQuery = "failed-zero-term";
    const beforeFail = searchEvents(events).length;
    await page.locator("#searchInput").fill("failed-zero-term");
    await page.locator("#searchButton").click();
    await page.waitForTimeout(600);
    expect(searchEvents(events).some((row) => row.search_query === "failed-zero-term")).toBeFalsy();
    expect(searchEvents(events).length).toBe(beforeFail);

    await H.openFresh(page, "/books");
    await page.locator("#catalogFilterText").fill("books-zero-term");
    await page.locator("#catalogFilterText").press("Enter");
    await expect(page.locator(".catalog-filter-empty")).toBeVisible();
    await waitForQuery(events, "books-zero-term");
    expect(searchEvents(events).filter((row) => row.search_query === "books-zero-term" && row.event_name === "zero_result_search").length).toBe(1);
    const beforeMore = searchEvents(events).filter((row) => row.search_query === "books-zero-term").length;
    const more = page.locator(".catalog-load-more");
    if (await more.count()) await more.click();
    await page.waitForTimeout(400);
    expect(searchEvents(events).filter((row) => row.search_query === "books-zero-term").length).toBe(beforeMore);

    await H.openFresh(page, "/romanlar.html");
    await page.locator("#catalogFilterText").fill("category-zero-term");
    await page.locator("#catalogFilterText").press("Enter");
    await waitForQuery(events, "category-zero-term");
    expect(searchEvents(events).some((row) => row.search_query === "category-zero-term" && row.result_count === 0)).toBeTruthy();
  });
});
