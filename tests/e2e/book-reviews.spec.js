const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const BOOK_ID = 252;
const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
const RAW = '<img src=x onerror="alert(1)"> & <script>alert(1)</script>';

function bookRow() {
  return {
    id: BOOK_ID,
    title: "تارىخىمىزدىكى خاقانلار",
    author: "ئەنۋەر جاپپار",
    price: 40,
    category: "تارىخ",
    source: "tarih.html",
    image_url: "",
    is_active: true,
    stock: 3,
    created_at: "2026-01-02T00:00:00Z"
  };
}

async function installStorefront(page, state) {
  await H.stubNumericBookDocuments(page, [BOOK_ID]);
  await page.route("**/rest/v1/book_credits**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        role: "author",
        position: 0,
        identity_id: "ae013912-6f81-4549-9a57-638b8d3b6efb",
        catalog_identities: { id: "ae013912-6f81-4549-9a57-638b8d3b6efb", display_name: "ئەنۋەر جاپپار" }
      }])
    });
  });
  await page.route("**/rest/v1/books**", async (route) => {
    const req = route.request();
    if (req.method() === "HEAD") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-0/1" },
        body: ""
      });
    }
    const url = new URL(req.url());
    const idFilter = String(url.searchParams.get("id") || "");
    if (idFilter && !idFilter.includes(String(BOOK_ID))) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/1" },
      body: JSON.stringify([bookRow()])
    });
  });
  await page.route("**/rest/v1/book_reviews**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "POST") {
      state.inserts.push(req.postDataJSON());
      return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
    }
    const status = String(url.searchParams.get("status") || "");
    if (status.indexOf("approved") !== -1) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.approved) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.own) });
  });
  await page.route("**://fxlojnqwyojqjskfggmh.supabase.co/**", async (route) => {
    const req = route.request();
    if (req.url().includes("/rest/v1/books") || req.url().includes("/rest/v1/book_reviews") || req.url().includes("/rest/v1/book_credits")) {
      return route.fallback();
    }
    if (req.method() === "HEAD") return route.fulfill({ status: 200, body: "" });
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

async function openBook(page) {
  await page.goto("/book/" + BOOK_ID, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".book-detail-info h1")).toHaveText("تارىخىمىزدىكى خاقانلار");
  await expect(page.locator(".detail-main-cart")).toBeVisible();
  await expect(page.locator(".favorite-button")).toBeVisible();
  await expect(page.locator('a.book-credit-name[href="/author/ae013912-6f81-4549-9a57-638b8d3b6efb"]').first()).toBeVisible();
}

test("signed-out readers see approved text and a compact invitation", async ({ page }) => {
  const state = { approved: [], own: [], inserts: [] };
  await installStorefront(page, state);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openBook(page);
  const invite = page.locator(".book-reviews-invite");
  await expect(invite).toBeVisible();
  await expect(invite).toContainText("كىرىپ تۇنجى باھانى يېزىڭ");
  await expect(page.locator(".book-reviews-form")).toHaveCount(0);
  const box = await invite.boundingBox();
  expect(box.height).toBeLessThan(80);
  state.approved = [{ id: "r1", display_name: "ئەزا ئىسمى", body: RAW, created_at: "2026-10-01T00:00:00Z" }];
  await openBook(page);
  const body = page.locator(".book-reviews-body");
  await expect(body).toHaveText(RAW);
  await expect(page.locator(".book-reviews-item img")).toHaveCount(0);
  await expect(page.locator(".book-reviews-item script")).toHaveCount(0);
  await expect(page.locator(".book-reviews-invite a")).toHaveAttribute("href", "/account.html");
  await page.evaluate(() => document.body.classList.add("dark-mode"));
  const color = await body.evaluate((node) => getComputedStyle(node).color);
  expect(color).not.toBe("rgb(68, 53, 45)");
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(body).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

test("a signed-in submission stays pending and ignores a repeated click", async ({ page }) => {
  const state = { approved: [], own: [], inserts: [] };
  await installStorefront(page, state);
  await page.setViewportSize({ width: 390, height: 800 });
  await openBook(page);
  await page.evaluate((memberId) => {
    const calls = [];
    window.__reviewInserts = calls;
    const db = {
      from() {
        const query = {
          select() { return query; },
          eq() { return query; },
          in() { return query; },
          order() { return query; },
          limit() { return query; },
          insert(payload) {
            calls.push(payload);
            return Promise.resolve({ data: null, error: null });
          },
          then(resolve, reject) {
            return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          }
        };
        return query;
      }
    };
    const api = window.KutadguMember;
    api.getUser = () => ({ id: memberId });
    api.getClient = () => db;
    document.dispatchEvent(new CustomEvent("kutadgu-member-change"));
  }, MEMBER_ID);
  await page.locator(".book-reviews-invite button").click();
  const area = page.locator(".book-reviews-form textarea");
  await expect(area).toBeVisible();
  await area.fill("بۇ كىتاب بەك ياخشى");
  await page.evaluate(() => {
    const form = document.querySelector(".book-reviews-form");
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(page.locator(".book-reviews-pending")).toHaveText("باھايىڭىز تەستىقنى ساقلاۋاتىدۇ. تەستىقلانغاندىن كېيىن بۇ كىتاب بېتىدە كۆرۈنىدۇ.");
  const inserts = await page.evaluate(() => window.__reviewInserts);
  expect(inserts).toEqual([{ book_id: BOOK_ID, body: "بۇ كىتاب بەك ياخشى" }]);
  await expect(page.locator(".detail-main-cart")).toBeVisible();
  await expect(page.locator(".favorite-button")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

test("admin approval stays behind AAL2", async ({ page }) => {
  await page.addInitScript(() => {
    const payload = btoa(JSON.stringify({ aal: "aal2" })).replace(/=+$/g, "");
    const token = "e30." + payload + ".sig";
    const calls = [];
    window.__reviewDecisions = calls;
    let rows = [{
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      book_id: 252,
      display_name: "ئەزا ئىسمى",
      body: '<script>alert(1)</script>',
      status: "pending",
      created_at: "2026-10-01T00:00:00Z"
    }];
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguBookReviewAdminClient = {
      auth: { getSession: async () => ({ data: { session: { access_token: token } }, error: null }) },
      from() {
        const query = {
          select() { return query; },
          eq() { return query; },
          order() { return query; },
          limit() { return query; },
          then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); }
        };
        return query;
      },
      rpc(name, args) {
        calls.push({ name: name, args: args });
        rows = [];
        return Promise.resolve({ data: null, error: null });
      }
    };
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin.html#reviews", { waitUntil: "domcontentloaded" });
  const item = page.locator(".admin-review-item");
  await expect(item).toBeVisible();
  await expect(item.locator(".admin-review-body")).toHaveText('<script>alert(1)</script>');
  await expect(item.locator("script")).toHaveCount(0);
  await item.getByRole("button", { name: "تەستىقلاش" }).click();
  await item.getByRole("button", { name: "تەستىقلاش" }).click({ timeout: 1000 }).catch(() => {});
  await expect(page.locator("#bookReviewModerationStatus")).toContainText("تەستىق ساقلاۋاتقان باھا يوق");
  const decisions = await page.evaluate(() => window.__reviewDecisions);
  expect(decisions).toEqual([{
    name: "moderate_book_review",
    args: { review_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", decision: "approved" }
  }]);
});

test("admin below AAL2 cannot send a moderation request", async ({ page }) => {
  await page.addInitScript(() => {
    const payload = btoa(JSON.stringify({ aal: "aal1" })).replace(/=+$/g, "");
    window.__kutadguSkipAdminAuth = true;
    window.__reviewDecisions = [];
    window.__kutadguBookReviewAdminClient = {
      auth: { getSession: async () => ({ data: { session: { access_token: "e30." + payload + ".sig" } }, error: null }) },
      from() { throw new Error("pending query should not run"); },
      rpc() { window.__reviewDecisions.push("rpc"); return Promise.resolve({ error: null }); }
    };
  });
  await page.goto("/admin.html#reviews", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#bookReviewModerationStatus")).toContainText("AAL2");
  expect(await page.evaluate(() => window.__reviewDecisions)).toEqual([]);
});
