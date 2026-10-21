const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const CLOSED = "http://127.0.0.1:9";
const CATALOG_RPC = `${CLOSED}/rest/v1/rpc/query_public_book_catalog`;
const DISCOVERY_RPC = `${CLOSED}/rest/v1/rpc/list_public_book_volume_discovery_unit_ids`;

function watchRpcFailures(page) {
  const failed = [];
  page.on("requestfailed", (req) => {
    const url = req.url();
    if (/\/rpc\/(?:query_public_book_catalog|list_public_book_volume_discovery_unit_ids)(?:\?|$)/.test(url)) {
      failed.push(url);
    }
  });
  return failed;
}

async function postRpc(page, url, body) {
  return page.evaluate(async ({ url: target, body: payload }) => {
    try {
      const response = await fetch(target, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          apikey: "fixture-key",
          authorization: "Bearer fixture-key"
        },
        body: JSON.stringify(payload)
      });
      return { status: response.status, body: await response.text() };
    } catch (err) {
      return { error: String(err && err.message ? err.message : err) };
    }
  }, { url, body });
}

test.describe("catalog RPC fixture isolation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("about:blank");
  });

  test("a missing books fixture fails the catalog RPC and does not send it", async ({ page }) => {
    const failed = watchRpcFailures(page);
    const catalog = await postRpc(page, CATALOG_RPC, { p_query: { offset: 0, limit: 24, category: "romanlar" } });
    const discovery = await postRpc(page, DISCOVERY_RPC, { p_offset: 0, p_limit: 50 });
    expect(catalog.error).toBeUndefined();
    expect(catalog.status).toBe(599);
    expect(catalog.body).toContain("unmocked_catalog_bridge");
    expect(discovery.error).toBeUndefined();
    expect(discovery.status).toBe(599);
    expect(discovery.body).toContain("unmocked_catalog_bridge");
    expect(failed).toEqual([]);
  });

  test("an aborted books read stays an error and does not send the catalog RPC", async ({ page }) => {
    const failed = watchRpcFailures(page);
    await page.route("**/rest/v1/books**", (route) => route.abort("failed"));
    const catalog = await postRpc(page, CATALOG_RPC, { p_query: { offset: 0, limit: 24 } });
    const discovery = await postRpc(page, DISCOVERY_RPC, { p_offset: 0, p_limit: 50 });
    expect(catalog.error).toBeUndefined();
    expect(catalog.status).toBe(599);
    expect(catalog.body).toContain("catalog_bridge_failed");
    expect(discovery.error).toBeUndefined();
    expect(discovery.status).toBe(599);
    expect(discovery.body).toContain("catalog_bridge_failed");
    expect(failed).toEqual([]);
  });

  test("a books HTTP error stays that error for both catalog RPCs", async ({ page }) => {
    const failed = watchRpcFailures(page);
    await page.route("**/rest/v1/books**", (route) => route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "injected_catalog_down", code: "injected_catalog_down" })
    }));
    const catalog = await postRpc(page, CATALOG_RPC, { p_query: { offset: 0, limit: 24 } });
    const discovery = await postRpc(page, DISCOVERY_RPC, { p_offset: 0, p_limit: 50 });
    expect(catalog.status).toBe(503);
    expect(catalog.body).toContain("injected_catalog_down");
    expect(discovery.status).toBe(503);
    expect(discovery.body).toContain("injected_catalog_down");
    expect(failed).toEqual([]);
  });

  test("valid book fixtures answer both RPCs and keep the original request local", async ({ page }) => {
    const failed = watchRpcFailures(page);
    const booksUrls = [];
    await page.route("**/rest/v1/books**", async (route) => {
      booksUrls.push(route.request().url());
      const discovery = route.request().url().includes("select=id%2Cis_active") || route.request().url().includes("select=id,is_active");
      const rows = discovery
        ? [
          { id: 91021, is_active: true, kind: "group", group_id: 91020 },
          { id: 91001, is_active: true, kind: "book" },
          { id: 91003, is_active: false, kind: "book" }
        ]
        : [
          {
            id: 91021,
            title: "سوغۇق يۈرۈشلۈك",
            is_active: true,
            price: 370,
            kind: "group",
            group_id: 91020,
            group_slug: "soghuq-yurushluk",
            member_book_ids: [91021, 91022],
            member_prices: [370, 399]
          },
          { id: 91001, title: "سوغۇق يۈكلەش رومانى", is_active: true, price: 88, kind: "book" }
        ];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": `0-${rows.length - 1}/${rows.length}` },
        body: JSON.stringify(rows)
      });
    });

    const catalog = await postRpc(page, CATALOG_RPC, {
      p_query: { offset: 0, limit: 24, category: "romanlar", sort: "title" }
    });
    const discovery = await postRpc(page, DISCOVERY_RPC, { p_offset: 0, p_limit: 50 });
    expect(catalog.status).toBe(200);
    const catalogBody = JSON.parse(catalog.body);
    expect(catalogBody.items.map((item) => item.unit_key)).toEqual(["group:91020", "book:91001"]);
    expect(catalogBody.items[0].group_slug).toBe("soghuq-yurushluk");
    expect(catalogBody.items[0].member_prices).toEqual([370, 399]);
    expect(catalogBody.total).toBe(2);
    expect(catalogBody.has_more).toBe(false);
    const discoveryBody = JSON.parse(discovery.body);
    expect(discoveryBody).toEqual(["group:91020", "book:91001"]);
    const decoded = booksUrls.map((url) => decodeURIComponent(url));
    expect(decoded.some((url) => url.includes("category=eq.romanlar") && url.includes("order=title.asc"))).toBe(true);
    expect(decoded.some((url) => url.includes("select=id,is_active") && url.includes("order=id.asc"))).toBe(true);
    expect(failed).toEqual([]);
  });

  test("an explicit live opt-in still uses a fulfilling books fixture", async ({ page }) => {
    const failed = watchRpcFailures(page);
    H.allowLiveCatalogReads(page);
    await page.route("**/rest/v1/books**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/1" },
      body: JSON.stringify([{ id: 42, title: "فىكسچۇر", is_active: true, kind: "book" }])
    }));
    const catalog = await postRpc(page, CATALOG_RPC, { p_query: { offset: 0, limit: 24 } });
    expect(catalog.status).toBe(200);
    expect(JSON.parse(catalog.body).items.map((item) => item.unit_key)).toEqual(["book:42"]);
    expect(failed).toEqual([]);
  });

  test("an explicit live catalog read sends the original RPC when no books fixture answers", async ({ page }) => {
    const failed = watchRpcFailures(page);
    H.allowLiveCatalogReads(page);
    const catalog = await postRpc(page, CATALOG_RPC, { p_query: { offset: 0, limit: 1 } });
    const discovery = await postRpc(page, DISCOVERY_RPC, { p_offset: 0, p_limit: 1 });
    expect(catalog.status).toBeUndefined();
    expect(catalog.error).toBeTruthy();
    expect(discovery.status).toBeUndefined();
    expect(discovery.error).toBeTruthy();
    await expect.poll(() => failed.slice().sort()).toEqual([CATALOG_RPC, DISCOVERY_RPC].sort());
  });

  test("an explicit live catalog read still keeps an injected books failure", async ({ page }) => {
    const failed = watchRpcFailures(page);
    H.allowLiveCatalogReads(page);
    await page.route("**/rest/v1/books**", (route) => route.abort("failed"));
    const catalog = await postRpc(page, CATALOG_RPC, { p_query: { offset: 0, limit: 1 } });
    const discovery = await postRpc(page, DISCOVERY_RPC, { p_offset: 0, p_limit: 1 });
    expect(catalog.status).toBe(599);
    expect(catalog.body).toContain("catalog_bridge_failed");
    expect(discovery.status).toBe(599);
    expect(discovery.body).toContain("catalog_bridge_failed");
    expect(failed).toEqual([]);
  });
});
