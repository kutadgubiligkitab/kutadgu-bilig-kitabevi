const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const BOOK_ID = 252;
const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_B = "22222222-2222-4222-8222-222222222222";
const PRIVATE_DRAFT = "مەخپىي خەت";
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
    if (url.pathname.indexOf("book_review_replies") !== -1) return route.fallback();
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
  await page.route("**/rest/v1/book_review_replies**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      if (!state.replyInserts) state.replyInserts = [];
      state.replyInserts.push(req.postDataJSON());
      return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(state.replies || [])
    });
  });
  await page.route("**://fxlojnqwyojqjskfggmh.supabase.co/**", async (route) => {
    const req = route.request();
    if (req.url().includes("/rest/v1/book_review_replies")) {
      if (req.method() === "POST") {
        if (!state.replyInserts) state.replyInserts = [];
        state.replyInserts.push(req.postDataJSON());
        return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(state.replies || [])
      });
    }
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
  await expect(invite).toContainText("ئەزا بولغاندىن كېيىن كىتاب ھەققىدە ئىنكاس يېزىڭ");
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
  await expect(page.locator(".book-reviews-pending")).toHaveText("ئىنكاسىڭىز تەستىقنى ساقلاۋاتىدۇ. تەستىقلانغاندىن كېيىن بۇ كىتاب بېتىدە كۆرۈنىدۇ.");
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
        if (name === "admin_list_book_reviews") {
          return Promise.resolve({ data: rows.slice(), error: null });
        }
        if (name === "admin_list_book_review_replies" || name === "admin_approval_counts") {
          return Promise.resolve({ data: name === "admin_approval_counts" ? { submissions: 0, reviews: rows.length, replies: 0 } : [], error: null });
        }
        if (name === "admin_book_review_exists") {
          return Promise.resolve({ data: rows.some((row) => row.id === args.p_review_id), error: null });
        }
        if (name === "admin_book_review_reply_exists") {
          return Promise.resolve({ data: false, error: null });
        }
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
  await expect(page.locator("#bookReviewModerationStatus")).toContainText("بۇ ھالەتتە ئىنكاس يوق");
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
      from(table) {
        const query = {
          table: table,
          columns: "",
          select(columns) {
            query.columns = String(columns || "");
            control.selects.push(query.table + ":" + query.columns);
            return query;
          },
          eq() { return query; },
          in() { return query; },
          order() { return query; },
          limit() { return query; },
          insert(payload) {
            control.inserts.push(Object.assign({ table: query.table }, payload));
            if (control.insertMode === "reject") return Promise.reject(new Error("insert rejected"));
            if (control.insertMode === "error") return Promise.resolve({ data: null, error: { message: "insert failed" } });
            if (control.insertMode === "fail-refresh") {
              control.approvedMode = "error";
              control.statusMode = "error";
            }
            return Promise.resolve({ data: null, error: null });
          },
          then(resolve, reject) {
            if (query.table === "book_review_replies") {
              if (control.replyMode === "error") return Promise.resolve({ data: null, error: { message: "replies failed" } }).then(resolve, reject);
              return Promise.resolve({ data: (control.replyRows || []).slice(), error: null }).then(resolve, reject);
            }
            if (query.table !== "book_reviews") {
              return Promise.resolve({ data: [], error: null }).then(resolve, reject);
            }
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
        if (name === "book_review_heart_summary") {
          if (control.heartMode === "error") return Promise.resolve({ data: null, error: { message: "hearts failed" } });
          return Promise.resolve({ data: control.heartRows || [], error: null });
        }
        if (name === "my_book_review_replies") {
          if (control.ownReplyMode === "error") return Promise.resolve({ data: null, error: { message: "own replies failed" } });
          return Promise.resolve({ data: control.ownReplyRows || [], error: null });
        }
        if (name === "add_book_review_heart" || name === "remove_book_review_heart") {
          if (!control.heartCalls) control.heartCalls = [];
          control.heartCalls.push({ name: name, args: args });
          if (control.heartWrite === "error") return Promise.resolve({ data: null, error: { message: "heart failed" } });
          if (control.heartWrite === "delay") {
            return new Promise((resolve) => {
              control.releaseHeart = () => resolve({ data: null, error: null });
            });
          }
          return Promise.resolve({ data: null, error: null });
        }
        if (name === "my_book_review_notifications") {
          if (control.noticeMode === "error") return Promise.resolve({ data: null, error: { message: "notices failed" } });
          if (control.noticeMode === "delay") {
            return new Promise((resolve) => {
              control.releaseNotices = () => resolve({ data: control.noticeRows || [], error: null });
            });
          }
          return Promise.resolve({ data: control.noticeRows || [], error: null });
        }
        if (name === "mark_book_review_notification_read") {
          if (!control.noticeMarks) control.noticeMarks = [];
          control.noticeMarks.push(args);
          if (Array.isArray(control.noticeRows)) {
            control.noticeRows = control.noticeRows.map((row) => row && row.id === args.p_id ? Object.assign({}, row, { read_at: row.read_at || "read" }) : row);
          }
          return Promise.resolve({ data: null, error: null });
        }
        if (name !== "my_book_review_status") return Promise.resolve({ data: null, error: null });
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
  const error = page.locator(".book-reviews-note", { hasText: "ئىنكاسلار يۈكلەنمىدى." });
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
  await page.getByRole("button", { name: "كىتاب ھەققىدە ئىنكاس يېزىڭ" }).click();
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
  await expect(page.locator(".book-reviews-form .book-reviews-note")).toHaveText("ئىنكاس يوللانمىدى. قايتا سىناڭ.");
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
    { table: "book_reviews", book_id: 252, body: "قايتا يوللاش" },
    { table: "book_reviews", book_id: 252, body: "قايتا يوللاش" }
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
  await expect(page.locator(".book-reviews-note")).toHaveText("ئىنكاس ساقلاندى. كۆرۈنۈش يېڭىلانمىدى.");
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
  expect(await page.evaluate(() => window.__reviewControl.inserts)).toEqual([{ table: "book_reviews", book_id: 252, body: "ساقلانغان" }]);
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
  const statusCalls = calls.filter((call) => call.name === "my_book_review_status");
  expect(statusCalls.length).toBeGreaterThan(0);
  statusCalls.forEach((call) => {
    expect(call).toEqual({ name: "my_book_review_status", args: { p_book_id: 252 } });
  });
  expect(calls.some((call) => call.args && call.args.user_id)).toBe(false);
  await page.evaluate(() => {
    window.__reviewControl.statusValue = "rejected";
    document.dispatchEvent(new CustomEvent("kutadgu-member-change"));
  });
  await expect(page.locator(".book-reviews-note:visible")).toHaveText("ئالدىنقى ئىنكاس رەت قىلىندى. يېڭى ئىنكاس يازالايسىز.");
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
          if (window.__reviewHoldSession) return window.__reviewGate.then(() => session);
          return Promise.resolve(session);
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
        if (name === "admin_list_book_reviews") {
          return Promise.resolve({ data: rows.slice(), error: null });
        }
        if (name === "admin_list_book_review_replies" || name === "admin_approval_counts") {
          return Promise.resolve({ data: name === "admin_approval_counts" ? { submissions: 0, reviews: rows.length, replies: 0 } : [], error: null });
        }
        if (name === "admin_book_review_exists") {
          return Promise.resolve({ data: rows.some((row) => row.id === args.p_review_id), error: null });
        }
        if (name === "admin_book_review_reply_exists") {
          return Promise.resolve({ data: false, error: null });
        }
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
  const sessionsBefore = await page.evaluate(() => window.__reviewSessions);
  await page.evaluate(() => {
    window.__reviewHoldSession = true;
    const button = document.querySelector(".admin-review-actions .admin-primary");
    const rejectButton = document.querySelector(".admin-review-actions .admin-secondary");
    button.click();
    window.__heldDisabled = button.disabled && rejectButton.disabled;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__reviewSessions)).toBe(sessionsBefore + 1);
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
  await expect(page.locator("#bookReviewModerationStatus")).toContainText("بۇ ھالەتتە ئىنكاس يوق");
  expect(await page.evaluate(() => window.__reviewDecisions.length)).toBe(3);
  await expect(page.locator(".admin-review-item")).toHaveCount(0);
});

async function useSwitchableMember(page, options) {
  await page.evaluate((setup) => {
    const control = {
      memberId: setup.memberId,
      approvedRows: setup.approvedRows,
      statusValue: null,
      statusMode: "ok",
      holdStatus: !!setup.holdStatus,
      statusHeld: false,
      insertMode: "ok",
      inserts: [],
      rpcs: [],
      releaseStatus: null,
      releaseInsert: null
    };
    window.__reviewControl = control;
    const db = {
      from(table) {
        const query = {
          table: table,
          select() { return query; },
          eq() { return query; },
          in() { return query; },
          order() { return query; },
          limit() { return query; },
          insert(payload) {
            control.inserts.push(Object.assign({ table: query.table }, payload));
            if (control.insertMode === "delay") {
              return new Promise((resolve) => {
                control.releaseInsert = () => resolve({ data: null, error: null });
              });
            }
            return Promise.resolve({ data: null, error: null });
          },
          then(resolve, reject) {
            if (query.table !== "book_reviews") {
              return Promise.resolve({ data: (control.replyRows || []).slice(), error: null }).then(resolve, reject);
            }
            return Promise.resolve({ data: control.approvedRows.slice(), error: null }).then(resolve, reject);
          }
        };
        return query;
      },
      rpc(name, args) {
        control.rpcs.push({ name: name, args: args, memberId: control.memberId });
        if (name === "book_review_heart_summary") {
          if (control.heartWrite === "delay" && !control.heartHeld) {
            control.heartHeld = true;
            return new Promise((resolve) => {
              control.releaseHeart = () => resolve({ data: control.heartRows || [], error: null });
            });
          }
          return Promise.resolve({ data: control.heartRows || [], error: null });
        }
        if (name === "my_book_review_replies") return Promise.resolve({ data: control.ownReplyRows || [], error: null });
        if (name === "add_book_review_heart" || name === "remove_book_review_heart") {
          if (!control.heartCalls) control.heartCalls = [];
          control.heartCalls.push({ name: name, args: args, memberId: control.memberId });
          if (control.heartWrite === "delay") {
            return new Promise((resolve) => {
              control.releaseHeartWrite = () => resolve({ data: null, error: null });
            });
          }
          return Promise.resolve({ data: null, error: null });
        }
        if (name === "my_book_review_notifications") {
          if (control.noticeMode === "delay" && !control.noticeHeld) {
            control.noticeHeld = true;
            return new Promise((resolve) => {
              control.releaseNotices = () => resolve({ data: [{ id: "old", book_title: "مەخپىي", excerpt: "يوشۇرۇن", read_at: null, book_id: 252, reply_id: "hidden", review_id: "hidden" }], error: null });
            });
          }
          return Promise.resolve({ data: control.noticeRows || [], error: null });
        }
        if (name === "mark_book_review_notification_read") return Promise.resolve({ data: null, error: null });
        if (name !== "my_book_review_status") return Promise.resolve({ data: null, error: null });
        if (control.holdStatus && !control.statusHeld) {
          control.statusHeld = true;
          return new Promise((resolve) => {
            control.releaseStatus = () => resolve({ data: "pending", error: null });
          });
        }
        if (control.statusMode === "error") return Promise.resolve({ data: null, error: { message: "status failed" } });
        return Promise.resolve({ data: control.statusValue, error: null });
      }
    };
    const api = window.KutadguMember;
    api.getUser = () => control.memberId ? { id: control.memberId } : null;
    api.getClient = () => db;
  }, options);
}

async function switchMember(page, memberId, statusMode) {
  await page.evaluate(({ memberId, statusMode }) => {
    const control = window.__reviewControl;
    control.memberId = memberId || "";
    if (statusMode) control.statusMode = statusMode;
    document.dispatchEvent(new CustomEvent("kutadgu-member-change"));
  }, { memberId: memberId, statusMode: statusMode || "" });
}

test("a delayed status from member A does not become member B's pending review", async ({ page }) => {
  const state = { approved: [], own: [], inserts: [], reviewGets: [] };
  await installStorefront(page, state);
  await openBook(page);
  await useSwitchableMember(page, {
    memberId: MEMBER_ID,
    holdStatus: true,
    approvedRows: [{ id: "pub", display_name: "ئەزا", body: "ئاشكارا باھا", created_at: "2026-10-01T00:00:00Z" }]
  });
  await switchMember(page, MEMBER_ID);
  await expect.poll(() => page.evaluate(() => window.__reviewControl.statusHeld)).toBe(true);
  await switchMember(page, MEMBER_B, "error");
  await page.evaluate(() => window.__reviewControl.releaseStatus());
  await expect(page.locator(".book-reviews-body")).toHaveText("ئاشكارا باھا");
  await expect(page.locator(".book-reviews-note", { hasText: "ئىنكاسلار يۈكلەنمىدى." })).toBeVisible();
  await expect(page.locator(".book-reviews-pending")).toHaveCount(0);
});

test("a delayed status from member A does not become the signed-out state", async ({ page }) => {
  const state = { approved: [], own: [], inserts: [], reviewGets: [] };
  await installStorefront(page, state);
  await openBook(page);
  await useSwitchableMember(page, {
    memberId: MEMBER_ID,
    holdStatus: true,
    approvedRows: [{ id: "pub", display_name: "ئەزا", body: "ئاشكارا باھا", created_at: "2026-10-01T00:00:00Z" }]
  });
  await switchMember(page, MEMBER_ID);
  await expect.poll(() => page.evaluate(() => window.__reviewControl.statusHeld)).toBe(true);
  await switchMember(page, "");
  await page.evaluate(() => window.__reviewControl.releaseStatus());
  await expect(page.locator(".book-reviews-body")).toHaveText("ئاشكارا باھا");
  await expect(page.locator(".book-reviews-invite a")).toHaveText("ئەزا بولغاندىن كېيىن كىتاب ھەققىدە ئىنكاس يېزىڭ");
  await expect(page.locator(".book-reviews-pending")).toHaveCount(0);
});

test("a saved review for member A does not become pending after an account switch", async ({ page }) => {
  const state = { approved: [], own: [], inserts: [], reviewGets: [] };
  await installStorefront(page, state);
  await page.setViewportSize({ width: 390, height: 800 });
  await openBook(page);
  await useSwitchableMember(page, { memberId: MEMBER_ID, holdStatus: false, approvedRows: [] });
  await switchMember(page, MEMBER_ID);
  await page.locator(".book-reviews-invite button").click();
  await page.locator(".book-reviews-form textarea").fill(PRIVATE_DRAFT);
  await page.evaluate(() => { window.__reviewControl.insertMode = "delay"; });
  await page.locator(".book-reviews-form").evaluate((form) => form.requestSubmit());
  await expect.poll(() => page.evaluate(() => typeof window.__reviewControl.releaseInsert === "function")).toBe(true);
  await switchMember(page, MEMBER_B);
  await expect(page.locator(".book-reviews-form button")).toBeDisabled();
  await page.evaluate(() => window.__reviewControl.releaseInsert());
  await expect(page.locator(".book-reviews-invite button")).toHaveText("كىتاب ھەققىدە ئىنكاس يېزىڭ");
  await expect(page.locator(".book-reviews-pending")).toHaveCount(0);
  await expect(page.locator(".book-reviews")).not.toContainText(PRIVATE_DRAFT);
  expect(await page.evaluate(() => window.__reviewControl.inserts.length)).toBe(1);
});

test("a saved review for member A does not become pending after sign-out", async ({ page }) => {
  const state = { approved: [], own: [], inserts: [], reviewGets: [] };
  await installStorefront(page, state);
  await openBook(page);
  await useSwitchableMember(page, { memberId: MEMBER_ID, holdStatus: false, approvedRows: [] });
  await switchMember(page, MEMBER_ID);
  await page.locator(".book-reviews-invite button").click();
  await page.locator(".book-reviews-form textarea").fill(PRIVATE_DRAFT);
  await page.evaluate(() => { window.__reviewControl.insertMode = "delay"; });
  await page.locator(".book-reviews-form").evaluate((form) => form.requestSubmit());
  await expect.poll(() => page.evaluate(() => typeof window.__reviewControl.releaseInsert === "function")).toBe(true);
  await switchMember(page, "");
  await expect(page.locator(".book-reviews-form button")).toBeDisabled();
  await page.evaluate(() => window.__reviewControl.releaseInsert());
  await expect(page.locator(".book-reviews-invite a")).toHaveText("ئەزا بولغاندىن كېيىن كىتاب ھەققىدە ئىنكاس يېزىڭ");
  await expect(page.locator(".book-reviews-pending")).toHaveCount(0);
  await expect(page.locator(".book-reviews")).not.toContainText(PRIVATE_DRAFT);
  expect(await page.evaluate(() => window.__reviewControl.inserts.length)).toBe(1);
});

test("a member can heart an approved review once and remove that heart", async ({ page }) => {
  const state = { approved: [], own: [], inserts: [], reviewGets: [] };
  await installStorefront(page, state);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openBook(page);
  await useReviewMember(page, MEMBER_ID);
  await page.evaluate(() => {
    const control = window.__reviewControl;
    control.approvedRows = [{ id: "r1", display_name: "ئەزا ئىسمى", body: "ئاشكارا ئىنكاس", created_at: "2026-10-01T00:00:00Z" }];
    control.heartRows = [{ review_id: "r1", heart_count: 2, mine: false }];
    document.dispatchEvent(new CustomEvent("kutadgu-member-change"));
  });
  const heart = page.locator(".book-reviews-heart");
  await expect(heart).toHaveAttribute("aria-pressed", "false");
  await expect(heart).toHaveAttribute("aria-label", "ياقتۇرۇش");
  await expect(heart).toContainText("2");
  await page.evaluate(() => { window.__reviewControl.heartWrite = "delay"; });
  await page.evaluate(() => {
    const button = document.querySelector(".book-reviews-heart");
    button.click();
    button.click();
  });
  await expect.poll(() => page.evaluate(() => (window.__reviewControl.heartCalls || []).length)).toBe(1);
  await page.evaluate(() => {
    window.__reviewControl.heartRows = [{ review_id: "r1", heart_count: 3, mine: true }];
    window.__reviewControl.releaseHeart();
  });
  await expect(heart).toHaveAttribute("aria-pressed", "true");
  await expect(heart).toHaveAttribute("aria-label", "ياقتۇرۇشنى ئېلىش");
  await expect(heart).toContainText("3");
  expect(await page.evaluate(() => window.__reviewControl.heartCalls)).toEqual([
    { name: "add_book_review_heart", args: { p_review_id: "r1" } }
  ]);
  await page.evaluate(() => {
    window.__reviewControl.heartWrite = "ok";
    window.__reviewControl.heartRows = [{ review_id: "r1", heart_count: 2, mine: false }];
  });
  await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => window.__reviewControl.heartCalls.map((call) => call.name))).toEqual([
    "add_book_review_heart",
    "remove_book_review_heart"
  ]);
  await page.evaluate(() => document.body.classList.add("dark-mode"));
  await page.setViewportSize({ width: 390, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

test("a signed-out reader uses the account entry for hearts and replies", async ({ page }) => {
  const state = {
    approved: [{ id: "r1", display_name: "ئەزا", body: "ئاشكارا ئىنكاس", created_at: "2026-10-01T00:00:00Z" }],
    replies: [{ id: "p1", review_id: "r1", display_name: "جاۋابچى", body: RAW, created_at: "2026-10-02T00:00:00Z" }],
    own: [],
    inserts: []
  };
  await installStorefront(page, state);
  await openBook(page);
  await expect(page.locator("#reply-p1 .book-reviews-body")).toHaveText(RAW);
  await expect(page.locator(".book-reviews-item script")).toHaveCount(0);
  await expect(page.locator(".book-reviews-item img")).toHaveCount(0);
  await expect(page.locator(".book-reviews-heart")).toHaveAttribute("href", "/account.html");
  await expect(page.locator(".book-reviews-heart")).toHaveAttribute("aria-label", "ياقتۇرۇش ئۈچۈن كىرىڭ");
  await expect(page.locator(".book-reviews-reply-signin")).toHaveAttribute("href", "/account.html");
  await expect(page.locator(".book-reviews-reply-signin")).toHaveText("جاۋاب يېزىش ئۈچۈن كىرىڭ");
});

test("a reply stays pending, keeps typed text after failure, and does not insert twice", async ({ page }) => {
  const state = { approved: [], own: [], inserts: [], reviewGets: [] };
  await installStorefront(page, state);
  await page.setViewportSize({ width: 390, height: 800 });
  await openBook(page);
  await useReviewMember(page, MEMBER_ID);
  await page.evaluate(() => {
    const control = window.__reviewControl;
    control.approvedRows = [{ id: "r1", display_name: "ئەزا", body: "ئاشكارا ئىنكاس", created_at: "2026-10-01T00:00:00Z" }];
    control.insertMode = "error";
    document.dispatchEvent(new CustomEvent("kutadgu-member-change"));
  });
  await page.getByRole("button", { name: "جاۋاب يېزىش" }).click();
  const area = page.locator(".book-reviews-reply-form textarea");
  await area.fill("بۇ جاۋاب");
  await expect(page.locator(".book-reviews-reply-form .book-reviews-count")).toContainText("قالغان:");
  await page.locator(".book-reviews-reply-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator(".book-reviews-reply-form .book-reviews-note")).toHaveText("جاۋاب يوللانمىدى. قايتا سىناڭ.");
  await expect(area).toHaveValue("بۇ جاۋاب");
  await page.evaluate(() => {
    window.__reviewControl.insertMode = "ok";
    window.__reviewControl.ownReplyRows = [{ id: "own1", review_id: "r1", body: "بۇ جاۋاب", status: "pending", created_at: "2026-10-03T00:00:00Z" }];
  });
  await page.locator(".book-reviews-reply-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator(".book-reviews-note", { hasText: "جاۋابىڭىز تەستىقنى ساقلاۋاتىدۇ." })).toBeVisible();
  await expect(page.locator(".book-reviews-reply-form textarea")).toHaveValue("");
  const inserts = await page.evaluate(() => window.__reviewControl.inserts.filter((row) => row.table === "book_review_replies"));
  expect(inserts).toEqual([
    { table: "book_review_replies", review_id: "r1", body: "بۇ جاۋاب" },
    { table: "book_review_replies", review_id: "r1", body: "بۇ جاۋاب" }
  ]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

test("admin can delete one review after confirmation", async ({ page }) => {
  await page.addInitScript(() => {
    const payload = btoa(JSON.stringify({ aal: "aal2" })).replace(/=+$/g, "");
    const token = "e30." + payload + ".sig";
    let rows = [{
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      book_id: 252,
      book_title: "تارىخىمىزدىكى خاقانلار",
      display_name: "ئەزا ئىسمى",
      body: "ئۆچىدىغان ئىنكاس",
      status: "approved",
      created_at: "2026-10-01T00:00:00Z"
    }];
    window.__reviewDecisions = [];
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguBookReviewAdminClient = {
      auth: { getSession: async () => ({ data: { session: { access_token: token } }, error: null }) },
      rpc(name, args) {
        if (name === "admin_list_book_reviews") return Promise.resolve({ data: rows.slice(), error: null });
        if (name === "admin_list_book_review_replies" || name === "admin_approval_counts") {
          return Promise.resolve({ data: name === "admin_approval_counts" ? { submissions: 0, reviews: rows.length, replies: 0 } : [], error: null });
        }
        if (name === "admin_book_review_exists") return Promise.resolve({ data: rows.some((row) => row.id === args.p_review_id), error: null });
        window.__reviewDecisions.push({ name: name, args: args });
        rows = [];
        return Promise.resolve({ data: null, error: null });
      }
    };
  });
  await page.goto("/admin.html#reviews", { waitUntil: "domcontentloaded" });
  await page.locator(".admin-review-filters button[data-review-status='approved']").click();
  const item = page.locator(".admin-review-item");
  await expect(item.locator("a")).toHaveAttribute("href", "/book/252");
  await expect(item.locator("a")).toHaveText("تارىخىمىزدىكى خاقانلار");
  page.once("dialog", (dialog) => dialog.dismiss());
  await item.getByRole("button", { name: "ئۆچۈرۈش" }).click();
  expect(await page.evaluate(() => window.__reviewDecisions)).toEqual([]);
  await expect(item).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await item.getByRole("button", { name: "ئۆچۈرۈش" }).click();
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("ئىنكاس ئۆچۈرۈلدى.");
  expect(await page.evaluate(() => window.__reviewDecisions)).toEqual([{
    name: "delete_book_review",
    args: { p_review_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
  }]);
});

test("the admin bell shows approval totals, keeps a failed read, and drops a stale response", async ({ page }) => {
  await page.addInitScript(() => {
    const payload = btoa(JSON.stringify({ aal: "aal2" })).replace(/=+$/g, "");
    window.__kutadguSkipAdminAuth = true;
    window.__approvalReads = 0;
    window.__kutadguBookReviewAdminClient = {
      auth: { getSession: async () => ({ data: { session: { access_token: "e30." + payload + ".sig" } }, error: null }) },
      rpc(name) {
        if (name === "admin_list_book_reviews" || name === "admin_list_book_review_replies") {
          return Promise.resolve({ data: [], error: null });
        }
        if (name === "admin_approval_counts") {
          window.__approvalReads += 1;
          if (window.__approvalDelay) {
            return new Promise((resolve) => {
              window.__releaseCounts = () => resolve({ data: { submissions: 9, reviews: 0, replies: 0 }, error: null });
            });
          }
          if (window.__approvalFail) return Promise.resolve({ data: null, error: { message: "counts failed" } });
          return Promise.resolve({ data: { submissions: 2, reviews: 3, replies: 1 }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }
    };
  });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  const bell = page.locator(".admin-approval-bell-button");
  await expect(bell).toContainText("6");
  await bell.click();
  const panel = page.locator(".admin-approval-panel");
  await expect(panel).toContainText("كىتاب تەستىقى 2");
  await expect(panel).toContainText("ئىنكاسلار 3");
  await expect(panel).toContainText("جاۋابلار 1");
  await panel.getByRole("button", { name: "كىتاب تەستىقى 2" }).click();
  await expect(page.locator("[data-admin-section-panel='submissions']")).toBeVisible();
  await page.evaluate(() => { window.__approvalFail = true; });
  await page.evaluate(() => window.KutadguAdminApprovals.refresh());
  await expect(bell).toContainText("6");
  await bell.click();
  await expect(panel).toContainText("سان يۈكلەنمىدى.");
  await expect(panel).not.toContainText("كىتاب تەستىقى 0");
  await page.evaluate(() => { window.__approvalFail = false; window.__approvalDelay = true; });
  await page.evaluate(() => { void window.KutadguAdminApprovals.refresh(); });
  await expect.poll(() => page.evaluate(() => typeof window.__releaseCounts === "function")).toBe(true);
  await page.evaluate(() => { document.querySelector("#idleLockPanel").hidden = false; });
  await expect(bell).toHaveCount(0);
  await page.evaluate(() => window.__releaseCounts());
  await expect(bell).toHaveCount(0);
  await page.evaluate(() => document.body.classList.add("dark-mode"));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

test("a member sees only their reply notification and marks that one read", async ({ page }) => {
  const state = { approved: [], own: [], inserts: [], reviewGets: [] };
  await installStorefront(page, state);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openBook(page);
  await useReviewMember(page, MEMBER_ID);
  await page.evaluate(() => {
    window.__reviewControl.noticeRows = [
      { id: "n1", review_id: "r1", reply_id: "p1", book_id: 252, book_title: "تارىخىمىزدىكى خاقانلار", excerpt: "قىسقا جاۋاب", read_at: null, created_at: "2026-10-04T00:00:00Z" },
      { id: "n2", review_id: "r2", reply_id: "p2", book_id: 252, book_title: "يەنە بىر كىتاب", excerpt: "ئىككىنچى", read_at: null, created_at: "2026-10-03T00:00:00Z" }
    ];
    document.dispatchEvent(new CustomEvent("kutadgu-member-change"));
  });
  const bell = page.locator(".book-review-notices-button");
  await expect(bell).toContainText("2");
  await bell.click();
  const panel = page.locator(".book-review-notices-panel");
  await expect(panel).toContainText("ئىنكاسىڭىزغا يېڭى جاۋاب كەلدى");
  await expect(panel).toContainText("تارىخىمىزدىكى خاقانلار");
  await expect(panel).toContainText("قىسقا جاۋاب");
  expect(await page.evaluate(() => window.__reviewControl.noticeMarks || [])).toEqual([]);
  await panel.getByRole("button", { name: /تارىخىمىزدىكى خاقانلار/ }).click();
  await expect.poll(() => page.evaluate(() => (window.__reviewControl.noticeMarks || []).length)).toBe(1);
  expect(await page.evaluate(() => window.__reviewControl.noticeMarks)).toEqual([{ p_id: "n1" }]);
  await expect(bell).toContainText("1");
  await expect(page).toHaveURL(/\/book\/252#reply-p1$/);
  await page.evaluate(() => { window.__reviewControl.noticeMode = "error"; });
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("kutadgu-member-change")));
  await expect(bell).toContainText("1");
  await bell.click();
  await expect(panel).toContainText("ئۇقتۇرۇش يۈكلەنمىدى.");
  await page.evaluate(() => document.body.classList.add("dark-mode"));
  await page.setViewportSize({ width: 390, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

test("a delayed notification from member A does not appear for member B", async ({ page }) => {
  const state = { approved: [], own: [], inserts: [], reviewGets: [] };
  await installStorefront(page, state);
  await openBook(page);
  await useSwitchableMember(page, { memberId: MEMBER_ID, approvedRows: [] });
  await page.evaluate(() => { window.__reviewControl.noticeMode = "delay"; });
  await switchMember(page, MEMBER_ID);
  await expect.poll(() => page.evaluate(() => window.__reviewControl.noticeHeld)).toBe(true);
  await switchMember(page, MEMBER_B);
  await page.evaluate(() => window.__reviewControl.releaseNotices());
  await expect(page.locator(".book-review-notices-panel")).not.toContainText("مەخپىي");
  await expect(page.locator(".book-reviews")).not.toContainText("يوشۇرۇن");
});
