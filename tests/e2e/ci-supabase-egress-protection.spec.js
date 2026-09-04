const { test, expect } = require("./playwright-test");
const crypto = require("crypto");
const H = require("./helpers");

const STORAGE_COVER = "https://abcdefghijklmnopqrstuvwxyz.supabase.co/storage/v1/object/public/book-covers/book/example.webp";
const OTHER_BUCKET = "https://abcdefghijklmnopqrstuvwxyz.supabase.co/storage/v1/object/public/other-bucket/keep-me.txt";
const OTHER_BODY = "not-a-book-cover";

test.describe("CI Supabase book-covers egress protection", () => {
  test("installReadSafeNetwork fulfills public book-covers from the local stub", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    const got = await page.evaluate(async (url) => {
      const res = await fetch(url);
      const buf = new Uint8Array(await res.arrayBuffer());
      let hex = "";
      for (let i = 0; i < Math.min(buf.length, 8); i += 1) hex += buf[i].toString(16).padStart(2, "0");
      return {
        status: res.status,
        type: res.headers.get("content-type") || "",
        len: buf.length,
        hex,
        ok: res.ok
      };
    }, STORAGE_COVER);
    expect(got.status).toBe(200);
    expect(got.ok).toBeTruthy();
    expect(got.type).toMatch(/image\/png/i);
    expect(got.len).toBe(H.BOOK_COVER_STUB.length);
    expect(got.hex).toBe("89504e470d0a1a0a");
    expect(crypto.createHash("sha256").update(H.BOOK_COVER_STUB).digest("hex")).toHaveLength(64);
    expect(H.mockedBookCoverRequests(page)).toBeGreaterThanOrEqual(1);

    const head = await page.evaluate(async (url) => {
      const res = await fetch(url, { method: "HEAD" });
      return { status: res.status, type: res.headers.get("content-type") || "", len: Number(res.headers.get("content-length") || 0) };
    }, STORAGE_COVER);
    expect(head.status).toBe(200);
    expect(head.type).toMatch(/image\/png/i);
    expect(head.len).toBe(H.BOOK_COVER_STUB.length);

    await page.evaluate((url) => {
      const img = document.createElement("img");
      img.id = "ci-cover-stub";
      img.src = url;
      document.body.appendChild(img);
    }, STORAGE_COVER);
    await expect.poll(async () => {
      return page.locator("#ci-cover-stub").evaluate((img) => img && img.naturalWidth > 0).catch(() => false);
    }, { timeout: 5_000 }).toBe(true);
  });

  test("non-Storage GETs and other buckets are not broadly intercepted", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await page.route("**/storage/v1/object/public/other-bucket/**", async (route) => {
      return route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: OTHER_BODY
      });
    });
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    const logo = await page.evaluate(async () => {
      const res = await fetch("/kutadgu-logo.png");
      const buf = new Uint8Array(await res.arrayBuffer());
      return { status: res.status, len: buf.length, type: res.headers.get("content-type") || "" };
    });
    expect(logo.status).toBe(200);
    expect(logo.len).toBeGreaterThan(H.BOOK_COVER_STUB.length);

    const other = await page.evaluate(async (url) => {
      const res = await fetch(url);
      return { status: res.status, body: await res.text(), type: res.headers.get("content-type") || "" };
    }, OTHER_BUCKET);
    expect(other.status).toBe(200);
    expect(other.body).toBe(OTHER_BODY);
    expect(other.type).toMatch(/text\/plain/);
  });

  test("cover retry probe routes still control their own responses", async ({ page }) => {
    const hits = { n: 0 };
    await H.installReadSafeNetwork(page);
    await page.route("**/cover-retry-probe.png", async (route) => {
      hits.n += 1;
      if (hits.n === 1) return route.abort();
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: H.BOOK_COVER_STUB
      });
    });
    await page.goto("/romanlar.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await page.evaluate(() => {
      const img = document.createElement("img");
      img.id = "probe-img";
      img.src = "/cover-retry-probe.png";
      img.onerror = () => window.kutadguHandleCoverError && window.kutadguHandleCoverError(img);
      img.onload = () => window.kutadguHandleCoverLoad && window.kutadguHandleCoverLoad(img);
      img.setAttribute("data-cover-src", "/cover-retry-probe.png");
      document.body.appendChild(img);
    });
    await expect.poll(() => hits.n, { timeout: 6_000 }).toBeGreaterThanOrEqual(2);
    expect(H.isSupabaseBookCoverStorageUrl("http://127.0.0.1:4173/cover-retry-probe.png")).toBeFalsy();
    expect(H.isSupabaseBookCoverStorageUrl("/cover-retry-a.png")).toBeFalsy();
  });
});
