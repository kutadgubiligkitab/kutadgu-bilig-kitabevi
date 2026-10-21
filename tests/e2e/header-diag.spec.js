const { test, expect } = require("./playwright-test");

async function blockWrites(page) {
  const posts = [];
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() !== "GET" && request.method() !== "HEAD") {
      if (/\/rest\/v1\/rpc\/(?:query_public_book_catalog|list_public_book_volume_discovery_unit_ids)(?:\?|$)/.test(url)) {
        return route.fallback();
      }
      posts.push(request.method() + " " + url);
      return route.abort();
    }
    if (/analytics-event|cdn-cgi\/rum|member-visit|posthog|supabase\.co/.test(url)) return route.abort();
    return route.continue();
  });
  return posts;
}

async function readReport(page) {
  return page.locator("#kutadguHeaderDiag textarea").inputValue().then((text) => JSON.parse(text));
}

test.describe("opt-in header diagnostic", () => {
  test("ordinary homepage does not open the diagnostic", async ({ page }) => {
    const posts = await blockWrites(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.locator("header.is-mobile-enhanced")).toBeVisible();
    await expect(page.locator("#kutadguHeaderDiag")).toHaveCount(0);
    await expect(page.locator("script[src='header-diag.js?v=2']")).toHaveCount(1);
    expect(posts).toEqual([]);
  });

  test("the diagnostic records load, reload, resize, and scroll without moving the header", async ({ page }) => {
    const posts = await blockWrites(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?kutadguHeaderDiag=1");
    const panel = page.locator("#kutadguHeaderDiag");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("ئۇزۇن بېسىپ كۆچۈرۈپ");
    await expect.poll(async () => (await readReport(page)).snapshots.map((row) => row.label)).toContain("load");

    const cold = await readReport(page);
    const coldHeader = cold.snapshots.find((row) => row.label === "load").header;
    expect(cold.path).toBe("/?kutadguHeaderDiag=1");
    expect(coldHeader.position).toBe("fixed");
    expect(coldHeader.top).toBe(0);
    expect(coldHeader.backdrop).toBe("none");
    expect(cold.snapshots.some((row) => /mobile\.css\?v=27/.test(row.mobileHref))).toBe(true);
    expect(cold.snapshots.some((row) => row.links.some((link) => /mobile\.css\?v=27/.test(link)))).toBe(true);
    expect(cold.snapshots.some((row) => row.assets.some((asset) => asset.path === "/header-diag.js?v=2"))).toBe(true);
    const loaded = cold.snapshots.find((row) => row.label === "load");
    expect(loaded.ancestors.length).toBeGreaterThan(1);
    expect(loaded.rules.some((rule) => String(rule.backdrop || "").includes("none"))).toBe(true);

    const beforeScroll = await page.evaluate(() => window.scrollY);
    await page.locator("#about").scrollIntoViewIfNeeded();
    await expect.poll(async () => (await readReport(page)).snapshots.some((row) => row.label === "scroll" && row.scrollY > 100)).toBe(true);
    const scrolled = await readReport(page);
    const scrollRow = scrolled.snapshots.filter((row) => row.label === "scroll").pop();
    expect(scrollRow.header.top).toBe(0);
    expect(scrollRow.scrollY).toBeGreaterThan(beforeScroll);

    // Synthetic PageTransitionEvent. This does not restore the document from the browser back-forward cache.
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false })));
    await expect.poll(async () => (await readReport(page)).snapshots.some((row) => row.label === "pageshow")).toBe(true);

    await page.setViewportSize({ width: 700, height: 390 });
    await expect.poll(async () => (await readReport(page)).snapshots.some((row) => row.label === "resize" || row.label === "viewport")).toBe(true);
    const resized = (await readReport(page)).snapshots.filter((row) => row.label === "resize" || row.label === "viewport").pop();
    expect(resized.header.position).toBe("fixed");
    expect(Math.abs(resized.header.top)).toBeLessThan(1);

    await page.getByRole("button", { name: "ھازىر خاتىرىلە" }).click();
    await expect.poll(async () => (await readReport(page)).snapshots.some((row) => row.label === "manual")).toBe(true);
    expect(posts).toEqual([]);
  });

  test("desktop layout stays sticky when the diagnostic is open", async ({ page }) => {
    await blockWrites(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/?kutadguHeaderDiag=1");
    await expect(page.locator("#kutadguHeaderDiag")).toBeVisible();
    await expect.poll(async () => (await readReport(page)).snapshots.some((row) => row.label === "load")).toBe(true);
    const row = (await readReport(page)).snapshots.find((item) => item.label === "load");
    expect(row.header.position).toBe("sticky");
    expect(row.header.backdrop).toContain("blur");
    expect(row.header.top).toBe(0);
    await expect(page.locator(".mobile-bottom-nav")).toBeHidden();
  });

  test("copied report keeps the diagnostic flag and drops other query values", async ({ page }) => {
    await blockWrites(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?kutadguHeaderDiag=1&private_token=LOCAL_DIAGNOSTIC_SENTINEL#fragment");
    await expect.poll(async () => (await readReport(page)).snapshots.some((row) => row.label === "load")).toBe(true);
    await page.evaluate(() => {
      const poisoned = document.createElement("link");
      poisoned.rel = "stylesheet";
      poisoned.href = "/mobile.css?v=26&private_token=LOCAL_DIAGNOSTIC_SENTINEL#secret";
      document.head.appendChild(poisoned);
      const blank = document.createElement("link");
      blank.rel = "stylesheet";
      document.head.appendChild(blank);
    });
    await page.getByRole("button", { name: "ھازىر خاتىرىلە" }).click();
    const report = await readReport(page);
    const text = JSON.stringify(report);
    expect(text).not.toContain("LOCAL_DIAGNOSTIC_SENTINEL");
    expect(text).not.toContain("fragment");
    expect(text).not.toContain("private_token");
    expect(report.path).toBe("/?kutadguHeaderDiag=1");
    const manual = report.snapshots.filter((row) => row.label === "manual").pop();
    expect(manual.links).toContain("/mobile.css?v=26");
    expect(manual.mobileHref).toBe("/mobile.css?v=26");
    expect(manual.rules.every((rule) => !rule.href || /^\/(?:mobile|index|theme|shop|public-header)\.css(?:\?v=\d{1,4})?$/.test(rule.href) || /^\/(?:public-header|mobile|header-diag)\.js(?:\?v=\d{1,4})?$/.test(rule.href))).toBe(true);
  });

  test("synthetic pageshow stays after the snapshot cap fills", async ({ page }) => {
    await blockWrites(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?kutadguHeaderDiag=1");
    await expect.poll(async () => (await readReport(page)).snapshots.some((row) => row.label === "load")).toBe(true);
    for (let count = 0; count < 20; count += 1) {
      await page.getByRole("button", { name: "ھازىر خاتىرىلە" }).click();
    }
    const packed = await readReport(page);
    expect(packed.snapshots.length).toBeLessThanOrEqual(16);
    expect(packed.snapshots[0].label === "domcontentloaded" || packed.snapshots[0].label === "load").toBe(true);
    // Synthetic event only. A real back-forward cache restoration is not launched here.
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    const after = await readReport(page);
    expect(after.snapshots.length).toBeLessThanOrEqual(16);
    expect(after.snapshots.some((row) => row.label === "pageshow" && row.persisted === true)).toBe(true);
    expect(after.snapshots.some((row) => row.label === "domcontentloaded" || row.label === "load")).toBe(true);
  });
});
