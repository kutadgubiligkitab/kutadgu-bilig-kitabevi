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
    if (!state.reviewGets) state.reviewGets = [];
    state.reviewGets.push(url.search);
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
  const state = {
    approved: [],
    own: [{ id: "hidden", display_name: "باشقا", body: "يوشۇرۇن باھا", status: "pending", created_at: "2026-10-01T00:00:00Z" }],
    inserts: [],
    reviewGets: []
  };
  await installStorefront(page, state);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openBook(page);
  const invite = page.locator(".book-reviews-invite");
  await expect(invite).toBeVisible();
  await expect(invite).toContainText("كىرىپ تۇنجى باھانى يېزىڭ");
  await expect(page.locator(".book-reviews-form")).toHaveCount(0);
  await expect(page.locator(".book-reviews")).not.toContainText("يوشۇرۇن باھا");
  expect(state.reviewGets.length).toBeGreaterThan(0);
  state.reviewGets.forEach((search) => {
    expect(search).toContain("status=eq.approved");
    expect(search).not.toContain("pending");
    expect(search).not.toContain("rejected");
  });
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
      },
      rpc() {
        return Promise.resolve({ data: null, error: null });
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

async function useReviewMember(page, memberId) {
  await page.evaluate((id) => {
    const control = {
      approvedMode: "ok",
      statusMode: "ok",
      statusValue: null,
      insertMode: "ok",
      approvedRows: [],
      inserts: [],
      selects: [],
      rpcs: []
    };
    window.__reviewControl = control;
    const db = {
      from() {
        const query = {
          columns: "",
          select(columns) {
            query.columns = String(columns || "");
            control.selects.push(query.columns);
            return query;
          },
          eq() { return query; },
          in() { return query; },
          order() { return query; },
          limit() { return query; },
          insert(payload) {
            control.inserts.push(payload);
            if (control.insertMode === "reject") return Promise.reject(new Error("insert rejected"));
            if (control.insertMode === "error") return Promise.resolve({ data: null, error: { message: "insert failed" } });
            if (control.insertMode === "fail-refresh") {
              control.approvedMode = "error";
              control.statusMode = "error";
            }
            return Promise.resolve({ data: null, error: null });
          },
          then(resolve, reject) {
            const unscopedStatus = query.columns.indexOf("body") === -1;
            if (unscopedStatus) {
              return Promise.resolve({
                data: [{ id: "other-pending", status: "pending" }, { id: "other-rejected", status: "rejected" }],
                error: null
              }).then(resolve, reject);
            }
            if (control.approvedMode === "reject") return Promise.reject(new Error("approved rejected")).then(resolve, reject);
            if (control.approvedMode === "error") return Promise.resolve({ data: null, error: { message: "approved failed" } }).then(resolve, reject);
            return Promise.resolve({ data: control.approvedRows.slice(), error: null }).then(resolve, reject);
          }
        };
        return query;
      },
      rpc(name, args) {
        control.rpcs.push({ name: name, args: args });
        if (control.statusMode === "reject") return Promise.reject(new Error("status rejected"));
        if (control.statusMode === "error") return Promise.resolve({ data: null, error: { message: "status failed" } });
        return Promise.resolve({ data: control.statusValue, error: null });
      }
    };
    const api = window.KutadguMember;
    api.getUser = () => ({ id: id });
    api.getClient = () => db;
  }, memberId);
}

test("failed review reads show an error and retry without reloading", async ({ page }) => {
  const state = { approved: [], own: [], inserts: [], reviewGets: [] };
  await installStorefront(page, state);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openBook(page);
  const navigations = () => page.evaluate(() => performance.getEntriesByType("navigation").length);
  expect(await navigations()).toBe(1);
  await useReviewMember(page, MEMBER_ID);
  await page.evaluate(() => {
    window.__reviewControl.approvedMode = "error";
    window.__reviewControl.statusMode = "error";
  });
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("kutadgu-member-change")));
  const error = page.locator(".book-reviews-note", { hasText: "باھالار يۈكلەنمىدى." });
  await expect(error).toBeVisible();
  await expect(page.locator(".book-reviews-invite")).toHaveCount(0);
  await expect(page.locator(".book-reviews-pending")).toHaveCount(0);
  await page.evaluate(() => {
    window.__reviewControl.approvedMode = "reject";
    window.__reviewControl.statusMode = "reject";
  });
  await page.getByRole("button", { name: "قايتا سىناش" }).click();
  await expect(error).toBeVisible();
  await expect(page.locator(".book-reviews-invite")).toHaveCount(0);
  await expect(page.locator(".book-reviews-pending")).toHaveCount(0);
  expect(await navigations()).toBe(1);
  await page.evaluate(() => {
    const control = window.__reviewControl;
    control.approvedMode = "ok";
    control.statusMode = "ok";
    control.statusValue = null;
    control.approvedRows = [{ id: "r1", display_name: "ئەزا ئىسمى", body: "ساقلانغان باھا", created_at: "2026-10-01T00:00:00Z" }];
  });
  await page.getByRole("button", { name: "قايتا سىناش" }).click();
  await expect(page.locator(".book-reviews-body")).toHaveText("ساقلانغان باھا");
  await expect(error).toHaveCount(0);
  await page.getByRole("button", { name: "باھا يېزىش" }).click();
  await page.locator(".book-reviews-form textarea").fill("قوليازما");
  await page.evaluate(() => {
    const area = document.querySelector(".book-reviews-form textarea");
    if (area) area.blur();
    window.__reviewControl.approvedMode = "error";
    window.__reviewControl.statusMode = "reject";
    document.dispatchEvent(new CustomEvent("kutadgu-member-change"));
  });
  await expect(page.locator(".book-reviews-body")).toHaveText("ساقلانغان باھا");
  await expect(page.locator(".book-reviews-form textarea")).toHaveValue("قوليازما");
  await expect(error).toBeVisible();
  await expect(page.locator(".book-reviews-pending")).toHaveCount(0);
  await page.evaluate(() => {
    window.__reviewControl.approvedMode = "ok";
    window.__reviewControl.statusMode = "ok";
    window.__reviewControl.statusValue = "pending";
  });
  await page.getByRole("button", { name: "قايتا سىناش" }).click();
  await expect(page.locator(".book-reviews-pending")).toBeVisible();
  await expect(page.locator(".book-reviews-form")).toHaveCount(0);
  await page.evaluate(() => {
    window.__reviewControl.approvedMode = "error";
    window.__reviewControl.statusMode = "reject";
    document.dispatchEvent(new CustomEvent("kutadgu-member-change"));
  });
  await expect(page.getByRole("button", { name: "قايتا سىناش" })).toBeVisible();
  await expect(page.locator(".book-reviews-body")).toHaveText("ساقلانغان باھا");
  await expect(page.locator(".book-reviews-pending")).toBeVisible();
  await expect(error).toBeVisible();
  await expect(page.locator(".book-reviews-form")).toHaveCount(0);
  await page.evaluate(() => {
    window.__reviewControl.approvedMode = "ok";
    window.__reviewControl.statusMode = "ok";
    window.__reviewControl.statusValue = "pending";
  });
  await page.getByRole("button", { name: "قايتا سىناش" }).click();
  await expect(error).toHaveCount(0);
  await expect(page.locator(".book-reviews-pending")).toBeVisible();
  await expect(page.locator(".book-reviews-form")).toHaveCount(0);
  expect(await navigations()).toBe(1);
  expect(await page.evaluate(() => window.__reviewControl.inserts)).toEqual([]);
});

test("a rejected insert can be submitted again and a saved review is not inserted twice", async ({ page }) => {
  const state = { approved: [], own: [], inserts: [], reviewGets: [] };
  await installStorefront(page, state);
  await page.setViewportSize({ width: 390, height: 800 });
  await openBook(page);
  await useReviewMember(page, MEMBER_ID);
  await page.evaluate(() => {
    window.__reviewControl.insertMode = "reject";
    document.dispatchEvent(new CustomEvent("kutadgu-member-change"));
  });
  await page.locator(".book-reviews-invite button").click();
  await page.locator(".book-reviews-form textarea").fill("قايتا يوللاش");
  await page.locator(".book-reviews-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator(".book-reviews-form .book-reviews-note")).toHaveText("باھا يوللانمىدى. قايتا سىناڭ.");
  await expect(page.locator(".book-reviews-form button")).toBeEnabled();
  await page.evaluate(() => {
    const area = document.querySelector(".book-reviews-form textarea");
    if (area) area.blur();
    window.__reviewControl.approvedRows = [{ id: "fresh", display_name: "ئەزا", body: "يېڭىلاندى", created_at: "2026-10-02T00:00:00Z" }];
    document.dispatchEvent(new CustomEvent("kutadgu-member-change"));
  });
  await expect(page.locator(".book-reviews-body")).toHaveText("يېڭىلاندى");
  await expect(page.locator(".book-reviews-form textarea")).toBeVisible();
  await page.locator(".book-reviews-form textarea").fill("قايتا يوللاش");
  await page.evaluate(() => {
    window.__reviewControl.insertMode = "ok";
  });
  await page.locator(".book-reviews-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator(".book-reviews-pending")).toBeVisible();
  expect(await page.evaluate(() => window.__reviewControl.inserts)).toEqual([
    { book_id: 252, body: "قايتا يوللاش" },
    { book_id: 252, body: "قايتا يوللاش" }
  ]);
});

test("a saved review stays pending when the following refresh fails", async ({ page }) => {
  const state = { approved: [], own: [], inserts: [], reviewGets: [] };
  await installStorefront(page, state);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openBook(page);
  await useReviewMember(page, MEMBER_ID);
  await page.evaluate(() => {
    window.__reviewControl.insertMode = "fail-refresh";
    document.dispatchEvent(new CustomEvent("kutadgu-member-change"));
  });
  await page.locator(".book-reviews-invite button").click();
  await page.locator(".book-reviews-form textarea").fill("ساقلانغان");
  await page.locator(".book-reviews-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator(".book-reviews-pending")).toBeVisible();
  await expect(page.locator(".book-reviews-note")).toHaveText("باھا ساقلاندى. كۆرۈنۈش يېڭىلانمىدى.");
  await expect(page.locator(".book-reviews-form")).toHaveCount(0);
  await page.getByRole("button", { name: "قايتا سىناش" }).click();
  await expect(page.locator(".book-reviews-pending")).toBeVisible();
  await expect(page.locator(".book-reviews-form")).toHaveCount(0);
  expect(await page.evaluate(() => window.__reviewControl.inserts.length)).toBe(1);
  await page.evaluate(() => {
    window.__reviewControl.approvedMode = "ok";
    window.__reviewControl.statusMode = "ok";
    window.__reviewControl.statusValue = "pending";
  });
  await page.getByRole("button", { name: "قايتا سىناش" }).click();
  await expect(page.locator(".book-reviews-pending")).toBeVisible();
  await expect(page.locator(".book-reviews-note")).toHaveCount(0);
  await expect(page.locator(".book-reviews-form")).toHaveCount(0);
  expect(await page.evaluate(() => window.__reviewControl.inserts)).toEqual([{ book_id: 252, body: "ساقلانغان" }]);
});

test("another member's pending or rejected review is not shown as this member's status", async ({ page }) => {
  const state = { approved: [], own: [], inserts: [], reviewGets: [] };
  await installStorefront(page, state);
  await openBook(page);
  await useReviewMember(page, "33333333-3333-4333-8333-333333333333");
  await page.evaluate(() => {
    window.__reviewControl.statusValue = null;
    document.dispatchEvent(new CustomEvent("kutadgu-member-change"));
  });
  await expect(page.locator(".book-reviews-invite button")).toBeVisible();
  await expect(page.locator(".book-reviews-pending")).toHaveCount(0);
  await expect(page.locator(".book-reviews-note:visible")).toHaveCount(0);
  const calls = await page.evaluate(() => window.__reviewControl.rpcs);
  expect(calls.length).toBeGreaterThan(0);
  calls.forEach((call) => {
    expect(call).toEqual({ name: "my_book_review_status", args: { p_book_id: 252 } });
  });
  await page.evaluate(() => {
    window.__reviewControl.statusValue = "rejected";
    document.dispatchEvent(new CustomEvent("kutadgu-member-change"));
  });
  await expect(page.locator(".book-reviews-note:visible")).toHaveText("ئالدىنقى باھا رەت قىلىندى. يېڭى باھا يازالايسىز.");
  await expect(page.locator(".book-reviews-pending")).toHaveCount(0);
});

test("moderation failure restores both buttons and a later click can succeed", async ({ page }) => {
  await page.addInitScript(() => {
    const payload = btoa(JSON.stringify({ aal: "aal2" })).replace(/=+$/g, "");
    const token = "e30." + payload + ".sig";
    const session = { data: { session: { access_token: token } }, error: null };
    let rows = [{
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      book_id: 252,
      display_name: "ئەزا ئىسمى",
      body: "تەستىق",
      status: "pending",
      created_at: "2026-10-01T00:00:00Z"
    }];
    let release;
    window.__reviewGate = new Promise((resolve) => { release = resolve; });
    window.__releaseReview = () => release();
    window.__reviewSessions = 0;
    window.__reviewDecisions = [];
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguBookReviewAdminClient = {
      auth: {
        getSession() {
          window.__reviewSessions += 1;
          if (window.__reviewSessions === 1) return Promise.resolve(session);
          return window.__reviewGate.then(() => session);
        }
      },
      from() {
        const query = {
          select() { return query; },
          eq() { return query; },
          order() { return query; },
          limit() { return query; },
          then(resolve, reject) { return Promise.resolve({ data: rows.slice(), error: null }).then(resolve, reject); }
        };
        return query;
      },
      rpc(name, args) {
        window.__reviewDecisions.push({ name: name, args: args });
        if (window.__reviewDecisions.length === 1) return Promise.resolve({ data: null, error: { message: "nope", code: "500" } });
        if (window.__reviewDecisions.length === 2) return Promise.reject(new Error("rpc rejected"));
        rows = [];
        return Promise.resolve({ data: null, error: null });
      }
    };
  });
  await page.goto("/admin.html#reviews", { waitUntil: "domcontentloaded" });
  const item = page.locator(".admin-review-item");
  await expect(item).toBeVisible();
  const approve = item.getByRole("button", { name: "تەستىقلاش" });
  const reject = item.getByRole("button", { name: "رەت قىلىش" });
  await page.evaluate(() => {
    const button = document.querySelector(".admin-review-actions .admin-primary");
    const rejectButton = document.querySelector(".admin-review-actions .admin-secondary");
    button.click();
    window.__heldDisabled = button.disabled && rejectButton.disabled;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__reviewSessions)).toBe(2);
  expect(await page.evaluate(() => window.__heldDisabled)).toBe(true);
  expect(await page.evaluate(() => window.__reviewDecisions)).toEqual([]);
  await expect(approve).toBeDisabled();
  await expect(reject).toBeDisabled();
  await page.evaluate(() => window.__releaseReview());
  await expect(approve).toBeEnabled();
  await expect(reject).toBeEnabled();
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("بۇ مەشغۇلاتقا ئىجازەت يوق.");
  expect(await page.evaluate(() => window.__reviewDecisions.length)).toBe(1);
  await approve.click();
  await expect(approve).toBeEnabled();
  await expect(reject).toBeEnabled();
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("بۇ مەشغۇلاتقا ئىجازەت يوق.");
  expect(await page.evaluate(() => window.__reviewDecisions.length)).toBe(2);
  await approve.click();
  await expect(page.locator("#bookReviewModerationStatus")).toContainText("تەستىق ساقلاۋاتقان باھا يوق");
  expect(await page.evaluate(() => window.__reviewDecisions.length)).toBe(3);
  await expect(page.locator(".admin-review-item")).toHaveCount(0);
});
