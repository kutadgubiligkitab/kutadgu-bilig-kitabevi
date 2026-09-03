const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const H = require("./helpers");

const REAL_TITLE = "سوغۇق يۈكلەش رومانى";
const PROBE = "/cover-retry-probe.png";
const LOGO = fs.readFileSync(path.join(__dirname, "..", "..", "kutadgu-logo.png"));

function bookRow(overrides) {
  return {
    id: 91001,
    title: REAL_TITLE,
    author: "سىناق ئاپتور",
    price: 88,
    source: "romanlar.html",
    category: "رومانلار",
    image_url: PROBE,
    is_active: true,
    is_recommended: true,
    is_new: true,
    stock: 5,
    stock_status: "in_stock",
    sales_count: 3,
    created_at: "2026-08-01T00:00:00Z",
    ...overrides
  };
}

async function mockBooks(page, books) {
  await page.route("**/rest/v1/books**", async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (url.includes("is_active=eq.false")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "*/0" },
        body: "[]"
      });
    }
    const parsed = new URL(url);
    let filtered = books.slice();
    const source = parsed.searchParams.get("source");
    if (source && source.startsWith("eq.")) {
      filtered = filtered.filter((row) => row.source === source.slice(3));
    }
    if (method === "HEAD") {
      return route.fulfill({
        status: 206,
        contentType: "application/json",
        headers: { "content-range": `0-0/${filtered.length}` },
        body: ""
      });
    }
    const range = String(req.headers()["range"] || "0-23");
    const [from, to] = range.split("-").map(Number);
    const slice = filtered.slice(from || 0, (to || 23) + 1);
    return route.fulfill({
      status: 206,
      contentType: "application/json",
      headers: { "content-range": `${from || 0}-${(from || 0) + Math.max(slice.length - 1, 0)}/${filtered.length}` },
      body: JSON.stringify(slice)
    });
  });
}

async function mockProbe(page, mode) {
  const hits = { n: 0 };
  await page.route("**/cover-retry-probe.png", async (route) => {
    hits.n += 1;
    if (mode === "always-fail") return route.abort();
    if (mode === "fail-first" && hits.n === 1) return route.abort();
    return route.fulfill({ status: 200, contentType: "image/png", body: LOGO });
  });
  return hits;
}

test.describe("cover load resilience", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("A transient first cover failure recovers without reload", async ({ page }) => {
    await mockBooks(page, [bookRow()]);
    const hits = await mockProbe(page, "fail-first");
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-live-book-id="91001"] .book-title')).toHaveText(REAL_TITLE, { timeout: 20_000 });
    await expect.poll(async () => {
      return page.locator('[data-live-book-id="91001"] img').evaluate((img) => img && img.naturalWidth > 0).catch(() => false);
    }, { timeout: 8_000 }).toBe(true);
    expect(page.url()).toContain("romanlar");
    await expect(page.locator('[data-live-book-id="91001"] .book-cover-unavailable')).toHaveCount(0);
    const html = await page.locator(".books-grid[data-catalog-source]").innerHTML();
    expect(html).not.toMatch(/sample-book-cover\.png/i);
    expect(hits.n).toBeGreaterThanOrEqual(2);
    expect(hits.n).toBeLessThanOrEqual(3);
  });

  test("B permanent cover failure stays bounded then placeholder", async ({ page }) => {
    await mockBooks(page, [bookRow()]);
    const hits = await mockProbe(page, "always-fail");
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-live-book-id="91001"] .book-title')).toHaveText(REAL_TITLE, { timeout: 20_000 });
    await expect(page.locator('[data-live-book-id="91001"] .book-cover-unavailable')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[data-live-book-id="91001"] .book-price')).toBeVisible();
    await expect(page.locator('[data-live-book-id="91001"] [data-cart-id]')).toHaveAttribute("data-cart-id", "91001");
    await expect(page.locator('[data-live-book-id="91001"] [data-fav-id]')).toHaveAttribute("data-fav-id", "91001");
    const after = hits.n;
    await page.waitForTimeout(1500);
    expect(hits.n).toBe(after);
    expect(after).toBeGreaterThanOrEqual(1);
    expect(after).toBeLessThanOrEqual(3);
    const html = await page.locator(".books-grid[data-catalog-source]").innerHTML();
    expect(html).not.toMatch(/sample-book-cover\.png/i);
  });

  test("missing sample and unsafe covers never retry the network", async ({ page }) => {
    const extra = [];
    page.on("request", (req) => {
      const u = req.url();
      if (/sample-book-cover\.png|javascript:/i.test(u) || u.includes("cover-retry-probe.png")) extra.push(u);
    });
    await mockBooks(page, [
      bookRow({ id: 91011, title: "مۇقاۋىسىز", image_url: "" }),
      bookRow({ id: 91012, title: "نامۇنا", image_url: "/sample-book-cover.png" }),
      bookRow({ id: 91013, title: "خەتەرلىك", image_url: "javascript:alert(1)" })
    ]);
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-live-book-id="91011"] .book-cover-unavailable')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-live-book-id="91012"] .book-cover-unavailable')).toBeVisible();
    await expect(page.locator('[data-live-book-id="91013"] .book-cover-unavailable')).toBeVisible();
    await page.waitForTimeout(800);
    expect(extra.filter((u) => /sample-book-cover\.png/i.test(u))).toEqual([]);
    expect(extra.filter((u) => /javascript:/i.test(u))).toEqual([]);
    expect(extra.filter((u) => u.includes("cover-retry-probe.png"))).toEqual([]);
  });

  test("valid cover succeeds on first try without extra retries", async ({ page }) => {
    await mockBooks(page, [bookRow()]);
    const hits = await mockProbe(page, "ok");
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => {
      return page.locator('[data-live-book-id="91001"] img').evaluate((img) => img && img.naturalWidth > 0).catch(() => false);
    }, { timeout: 20_000 }).toBe(true);
    await page.waitForTimeout(800);
    expect(hits.n).toBe(1);
    await expect(page.locator('[data-live-book-id="91001"] .book-cover-unavailable')).toHaveCount(0);
  });

  test("detached image stops retrying", async ({ page }) => {
    await mockBooks(page, [bookRow()]);
    const hits = await mockProbe(page, "always-fail");
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-live-book-id="91001"] img')).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => {
      document.querySelector('[data-live-book-id="91001"] img')?.remove();
    });
    const n = hits.n;
    await page.waitForTimeout(2000);
    expect(hits.n).toBe(n);
  });

  test("multiple simultaneous failures stay bounded", async ({ page }) => {
    const books = Array.from({ length: 6 }, (_, i) => bookRow({
      id: 93000 + i,
      title: `${REAL_TITLE} ${i + 1}`,
      image_url: PROBE
    }));
    await mockBooks(page, books);
    const hits = await mockProbe(page, "always-fail");
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".book-cover-unavailable").first()).toBeVisible({ timeout: 12_000 });
    await page.waitForTimeout(2000);
    const n = hits.n;
    await page.waitForTimeout(1500);
    expect(hits.n).toBe(n);
    expect(n).toBeLessThanOrEqual(18);
  });

  test("cold fresh context recovers a transient cover", async ({ browser }) => {
    const context = await browser.newContext({ locale: "ug" });
    const page = await context.newPage();
    await H.installReadSafeNetwork(page);
    await mockBooks(page, [bookRow()]);
    await mockProbe(page, "fail-first");
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => {
      return page.locator('[data-live-book-id="91001"] img').evaluate((img) => img && img.naturalWidth > 0).catch(() => false);
    }, { timeout: 8_000 }).toBe(true);
    await context.close();
  });

  test("listing cover retry does not overflow at 390/768/1280", async ({ page }) => {
    await mockBooks(page, [bookRow(), bookRow({ id: 91002, title: `${REAL_TITLE} 2` })]);
    await mockProbe(page, "fail-first");
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
      await expect(page.locator(".book-card:not(.is-skeleton)").first()).toBeVisible({ timeout: 20_000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflow, `overflow at ${width}`).toBeFalsy();
    }
  });

  test("C same img URL reassignment does not replay the old cover", async ({ page }) => {
    const hitsA = { n: 0 };
    const hitsB = { n: 0 };
    await page.route("**/cover-retry-a.png", async (route) => {
      hitsA.n += 1;
      return route.abort();
    });
    await page.route("**/cover-retry-b.png", async (route) => {
      hitsB.n += 1;
      return route.fulfill({ status: 200, contentType: "image/png", body: LOGO });
    });
    await mockBooks(page, [bookRow({ image_url: "/kutadgu-logo.png" })]);
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await page.evaluate(() => {
      const img = document.createElement("img");
      img.id = "cover-retry-harness";
      img.width = 80;
      img.height = 120;
      document.body.appendChild(img);
      window.kutadguShop.assignCoverImage(img, "/cover-retry-a.png");
    });
    await expect.poll(async () => {
      return page.locator("#cover-retry-harness").evaluate((img) => img.classList.contains("is-cover-retrying")).catch(() => false);
    }, { timeout: 4_000 }).toBe(true);
    const aAfterEnter = hitsA.n;
    await page.evaluate(() => {
      window.kutadguShop.assignCoverImage(document.getElementById("cover-retry-harness"), "/cover-retry-b.png");
    });
    await expect.poll(async () => {
      return page.locator("#cover-retry-harness").evaluate((img) => {
        const src = img.getAttribute("src") || "";
        return img.naturalWidth > 0 && src.includes("cover-retry-b.png") && !img.classList.contains("is-cover-retrying");
      }).catch(() => false);
    }, { timeout: 6_000 }).toBe(true);
    await page.waitForTimeout(1200);
    expect(hitsA.n).toBe(aAfterEnter);
    expect(hitsB.n).toBe(1);
    await expect(page.locator("#cover-retry-harness")).toBeVisible();
    await expect(page.locator(".book-cover-unavailable")).toHaveCount(0);
    const debug = await page.evaluate(() => window.kutadguShop.getCoverRetryDebug());
    expect(debug.inFlight).toBe(0);
  });

  test("D reassignment resets retry budget for the new URL", async ({ page }) => {
    const hitsA = { n: 0 };
    const hitsB = { n: 0 };
    await page.route("**/cover-retry-a.png", async (route) => {
      hitsA.n += 1;
      return route.abort();
    });
    await page.route("**/cover-retry-b.png", async (route) => {
      hitsB.n += 1;
      if (hitsB.n <= 2) return route.abort();
      return route.fulfill({ status: 200, contentType: "image/png", body: LOGO });
    });
    await mockBooks(page, [bookRow({ image_url: "/kutadgu-logo.png" })]);
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await page.evaluate(() => {
      const img = document.createElement("img");
      img.id = "cover-retry-harness";
      img.width = 80;
      img.height = 120;
      document.body.appendChild(img);
      window.kutadguShop.assignCoverImage(img, "/cover-retry-a.png");
    });
    await expect.poll(() => hitsA.n, { timeout: 4_000 }).toBeGreaterThanOrEqual(2);
    await expect(page.locator("#cover-retry-harness")).toBeVisible();
    await page.evaluate(() => {
      window.kutadguShop.assignCoverImage(document.getElementById("cover-retry-harness"), "/cover-retry-b.png");
    });
    await expect.poll(async () => {
      return page.locator("#cover-retry-harness").evaluate((img) => {
        const src = img.getAttribute("src") || "";
        return img.naturalWidth > 0 && src.includes("cover-retry-b.png");
      }).catch(() => false);
    }, { timeout: 8_000 }).toBe(true);
    expect(hitsB.n).toBeGreaterThanOrEqual(3);
    expect(hitsB.n).toBeLessThanOrEqual(3);
    await expect(page.locator("#cover-retry-harness")).toHaveCount(1);
    await expect(page.locator("body > .book-cover-unavailable")).toHaveCount(0);
  });

  test("E in-flight reassignment does not stall the retry queue", async ({ page }) => {
    const hitsA = { n: 0 };
    const otherHits = {};
    const hangA = { release: null };
    await page.route("**/cover-retry-a.png", async (route) => {
      hitsA.n += 1;
      if (hitsA.n === 1) return route.abort();
      await new Promise((resolve) => {
        hangA.release = resolve;
      });
      try {
        await route.abort();
      } catch (err) {}
    });
    for (let i = 0; i < 4; i += 1) {
      otherHits[i] = { n: 0 };
      const pathName = `/cover-retry-other-${i}.png`;
      await page.route(`**${pathName}`, async (route) => {
        otherHits[i].n += 1;
        if (otherHits[i].n === 1) return route.abort();
        return route.fulfill({ status: 200, contentType: "image/png", body: LOGO });
      });
    }
    await page.route("**/cover-retry-b.png", async (route) => {
      return route.fulfill({ status: 200, contentType: "image/png", body: LOGO });
    });
    await mockBooks(page, [bookRow({ image_url: "/kutadgu-logo.png" })]);
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await page.evaluate(() => {
      const img = document.createElement("img");
      img.id = "cover-retry-harness";
      img.width = 80;
      img.height = 120;
      document.body.appendChild(img);
      window.kutadguShop.assignCoverImage(img, "/cover-retry-a.png");
    });
    await expect.poll(async () => {
      return page.evaluate(() => window.kutadguShop.getCoverRetryDebug().inFlight);
    }, { timeout: 4_000 }).toBeGreaterThanOrEqual(1);
    await page.evaluate(() => {
      window.kutadguShop.assignCoverImage(document.getElementById("cover-retry-harness"), "/cover-retry-b.png");
    });
    await expect.poll(async () => {
      return page.locator("#cover-retry-harness").evaluate((img) => img.naturalWidth > 0).catch(() => false);
    }, { timeout: 6_000 }).toBe(true);
    await page.evaluate(() => {
      for (let i = 0; i < 4; i += 1) {
        const img = document.createElement("img");
        img.id = `cover-retry-other-${i}`;
        img.width = 80;
        img.height = 120;
        document.body.appendChild(img);
        window.kutadguShop.assignCoverImage(img, `/cover-retry-other-${i}.png`);
      }
    });
    for (let i = 0; i < 4; i += 1) {
      await expect.poll(async () => {
        return page.locator(`#cover-retry-other-${i}`).evaluate((img) => img && img.naturalWidth > 0).catch(() => false);
      }, { timeout: 8_000 }).toBe(true);
    }
    await expect.poll(async () => {
      return page.evaluate(() => window.kutadguShop.getCoverRetryDebug().inFlight);
    }, { timeout: 6_000 }).toBe(0);
    const aAfter = hitsA.n;
    await page.waitForTimeout(1500);
    expect(hitsA.n).toBe(aAfter);
    expect(hitsA.n).toBeLessThanOrEqual(2);
    for (let i = 0; i < 4; i += 1) {
      expect(otherHits[i].n).toBe(2);
    }
    if (hangA.release) hangA.release();
  });

  test("lightbox-style rapid src switching keeps the last cover", async ({ page }) => {
    const hits = { a: 0, b: 0, c: 0 };
    await page.route("**/cover-retry-a.png", async (route) => {
      hits.a += 1;
      await page.waitForTimeout(400);
      return route.abort();
    });
    await page.route("**/cover-retry-b.png", async (route) => {
      hits.b += 1;
      await page.waitForTimeout(400);
      return route.abort();
    });
    await page.route("**/cover-retry-c.png", async (route) => {
      hits.c += 1;
      return route.fulfill({ status: 200, contentType: "image/png", body: LOGO });
    });
    await mockBooks(page, [bookRow({ image_url: "/kutadgu-logo.png" })]);
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await page.evaluate(() => {
      const img = document.createElement("img");
      img.id = "cover-retry-harness";
      img.width = 80;
      img.height = 120;
      document.body.appendChild(img);
      const Shop = window.kutadguShop;
      Shop.assignCoverImage(img, "/cover-retry-a.png");
      Shop.assignCoverImage(img, "/cover-retry-b.png");
      Shop.assignCoverImage(img, "/cover-retry-c.png");
    });
    await expect.poll(async () => {
      return page.locator("#cover-retry-harness").evaluate((img) => {
        const src = img.getAttribute("src") || "";
        return img.naturalWidth > 0 && src.includes("cover-retry-c.png");
      }).catch(() => false);
    }, { timeout: 6_000 }).toBe(true);
    await page.waitForTimeout(1200);
    expect(hits.a).toBeLessThanOrEqual(1);
    expect(hits.b).toBeLessThanOrEqual(1);
    expect(hits.c).toBe(1);
    await expect(page.locator("#cover-retry-harness")).toHaveCount(1);
  });
});
