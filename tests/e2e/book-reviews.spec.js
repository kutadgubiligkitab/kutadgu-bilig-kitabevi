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
        if (name === "public_book_review_reply_target") {
          if (control.targetMode === "error") return Promise.resolve({ data: null, error: { message: "target failed" } });
          if (control.targetMode === "missing") return Promise.resolve({ data: [], error: null });
          const id = args && args.p_reply_id;
          const row = (control.targets || []).find((item) => item && item.reply_id === id);
          return Promise.resolve({ data: row ? [row] : [], error: null });
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
        if (name === "public_book_review_reply_target") {
          const id = args && args.p_reply_id;
          const row = (control.targets || []).find((item) => item && item.reply_id === id);
          return Promise.resolve({ data: row ? [row] : [], error: null });
        }
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
  let confirmText = "";
  page.once("dialog", (dialog) => {
    confirmText = dialog.message();
    dialog.accept();
  });
  await item.getByRole("button", { name: "ئۆچۈرۈش" }).click();
  expect(confirmText).toContain("تارىخىمىزدىكى خاقانلار");
  expect(confirmText).toContain("ئۆچىدىغان ئىنكاس");
  expect(confirmText).toContain("جاۋابلىرى");
  expect(confirmText).toContain("كىتاب ۋە ئەزا ھېسابى ئۆچمەيدۇ");
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
    window.__reviewControl.targets = [{
      review_id: "r1",
      review_display_name: "ئەزا",
      review_body: "ئانا ئىنكاس",
      reply_id: "p1",
      reply_display_name: "جاۋابچى",
      reply_body: "كۆرۈنىدىغان جاۋاب",
      book_id: 252
    }];
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
  const openedReply = page.locator("#reply-p1.book-reviews-target .book-reviews-body");
  await expect(openedReply).toBeVisible();
  await expect(openedReply).toHaveText("كۆرۈنىدىغان جاۋاب");
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

test("a warm cached header delivers the member bell on the first navigation", async ({ browser }) => {
  const { execSync } = require("child_process");
  const http = require("http");
  const oldHeader = execSync("git show origin/main:public-header.js", { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  expect(oldHeader).not.toContain("ensureReviewNotices");
  const hits = { v3: 0, v4: 0, notes: [] };
  const fixture = "<!doctype html><html lang=\"ug\" dir=\"rtl\"><head><title>fixture</title></head><body><a class=\"member-account-button\" href=\"/account.html\">كىرىش</a><script src=\"/public-header.js?v=3\"></script></body></html>";
  const origin = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (url.pathname === "/header-cache-fixture.html" || url.pathname === "/header-cache-next.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(fixture);
        return;
      }
      if (url.pathname === "/public-header.js" && url.searchParams.get("v") === "3") {
        hits.v3 += 1;
        hits.notes.push(String(req.headers["cache-control"] || req.headers.pragma || "no-request-cache"));
        res.writeHead(200, {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "public, max-age=300, immutable",
          "content-length": Buffer.byteLength(oldHeader)
        });
        res.end(oldHeader);
        return;
      }
      if (url.pathname === "/public-header.js" && url.searchParams.get("v") === "4") hits.v4 += 1;
      const proxy = http.request({
        hostname: "127.0.0.1",
        port: 4173,
        path: req.url,
        method: req.method,
        headers: Object.assign({}, req.headers, { host: "127.0.0.1:4173" })
      }, (upstream) => {
        res.writeHead(upstream.statusCode || 502, upstream.headers);
        upstream.pipe(res);
      });
      proxy.on("error", () => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
        res.end("proxy failed");
      });
      req.pipe(proxy);
    });
    server.listen(0, "127.0.0.1", () => resolve({ server: server, origin: "http://127.0.0.1:" + server.address().port }));
    server.on("error", reject);
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(origin.origin + "/header-cache-fixture.html", { waitUntil: "domcontentloaded" });
    expect(hits.v3).toBe(1);
    await expect(page.locator("script[src*='book-reviews.js']")).toHaveCount(0);
    await page.goto(origin.origin + "/header-cache-next.html", { waitUntil: "domcontentloaded" });
    expect(hits.v3, JSON.stringify(hits)).toBe(1);
    const cached = await page.evaluate(() => performance.getEntriesByType("resource").filter((entry) => entry.name.includes("public-header.js?v=3")).map((entry) => ({ transferSize: entry.transferSize, decodedBodySize: entry.decodedBodySize })));
    expect(cached.some((entry) => entry.transferSize === 0 && entry.decodedBodySize > 0)).toBe(true);
    await expect(page.locator("script[src*='book-reviews.js']")).toHaveCount(0);
    await page.goto(origin.origin + "/account.html", { waitUntil: "domcontentloaded" });
    expect(hits.v4).toBe(1);
    expect(hits.v3).toBe(1);
    await page.waitForFunction(() => window.KutadguBookReviews && window.KutadguMember);
    await page.evaluate((memberId) => {
      window.KutadguMember.getUser = () => ({ id: memberId });
      window.KutadguMember.getClient = () => ({ rpc: () => Promise.resolve({ data: [], error: null }) });
      document.dispatchEvent(new CustomEvent("kutadgu-member-change"));
    }, MEMBER_ID);
    await expect(page.locator(".book-review-notices-button")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(page.locator(".book-review-notices-button")).toBeVisible();
    await page.evaluate(() => document.body.classList.add("dark-mode"));
    await expect(page.locator(".book-review-notices-button")).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator(".book-review-notices-button")).toBeVisible();
  } finally {
    await context.close();
    await new Promise((resolve) => origin.server.close(resolve));
  }
});

test("a failed or rejected approved read keeps hearts, replies, and own replies", async ({ page }) => {
  const state = { approved: [], own: [], inserts: [], reviewGets: [] };
  await installStorefront(page, state);
  await openBook(page);
  await useReviewMember(page, MEMBER_ID);
  await page.evaluate(() => {
    const control = window.__reviewControl;
    control.approvedRows = [{ id: "r1", display_name: "ئەزا", body: "ئاشكارا ئىنكاس", created_at: "2026-10-01T00:00:00Z" }];
    control.heartRows = [{ review_id: "r1", heart_count: 3, mine: true }];
    control.replyRows = [{ id: "p1", review_id: "r1", display_name: "جاۋابچى", body: "ئاشكارا جاۋاب", created_at: "2026-10-02T00:00:00Z" }];
    control.ownReplyRows = [{ id: "own1", review_id: "r1", body: "كۈتۈۋاتقان جاۋاب", status: "pending", created_at: "2026-10-03T00:00:00Z" }];
    document.dispatchEvent(new CustomEvent("kutadgu-member-change"));
  });
  await expect(page.locator(".book-reviews-heart")).toContainText("3");
  await expect(page.locator(".book-reviews-heart")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#reply-p1 .book-reviews-body")).toHaveText("ئاشكارا جاۋاب");
  await expect(page.locator(".book-reviews-note", { hasText: "كۈتۈۋاتقان جاۋاب" })).toBeVisible();
  await page.evaluate(() => {
    window.__reviewControl.approvedMode = "error";
    document.dispatchEvent(new CustomEvent("kutadgu-member-change"));
  });
  await expect(page.locator(".book-reviews-note", { hasText: "ئىنكاسلار يۈكلەنمىدى." })).toBeVisible();
  await expect(page.locator(".book-reviews-body").first()).toHaveText("ئاشكارا ئىنكاس");
  await expect(page.locator(".book-reviews-heart")).toContainText("3");
  await expect(page.locator(".book-reviews-heart")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#reply-p1 .book-reviews-body")).toHaveText("ئاشكارا جاۋاب");
  await expect(page.locator(".book-reviews-note", { hasText: "كۈتۈۋاتقان جاۋاب" })).toBeVisible();
  await page.evaluate(() => {
    window.__reviewControl.approvedMode = "reject";
    document.dispatchEvent(new CustomEvent("kutadgu-member-change"));
  });
  await expect(page.locator(".book-reviews-heart")).toContainText("3");
  await expect(page.locator("#reply-p1 .book-reviews-body")).toHaveText("ئاشكارا جاۋاب");
  await expect(page.locator(".book-reviews-note", { hasText: "كۈتۈۋاتقان جاۋاب" })).toBeVisible();
  await page.evaluate(() => {
    const control = window.__reviewControl;
    control.approvedMode = "ok";
    control.approvedRows = [];
    control.heartRows = [];
    control.replyRows = [];
    control.ownReplyRows = [];
    document.dispatchEvent(new CustomEvent("kutadgu-member-change"));
  });
  await expect(page.locator(".book-reviews-heart")).toHaveCount(0);
  await expect(page.locator("#reply-p1")).toHaveCount(0);
  await expect(page.locator(".book-reviews-note", { hasText: "كۈتۈۋاتقان جاۋاب" })).toHaveCount(0);
  await page.evaluate(() => document.body.classList.add("dark-mode"));
  await page.setViewportSize({ width: 390, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

test("a delayed reply insert refreshes the member who is current when it finishes", async ({ page }) => {
  const state = { approved: [], own: [], inserts: [], reviewGets: [] };
  await installStorefront(page, state);
  await openBook(page);
  await useSwitchableMember(page, {
    memberId: MEMBER_ID,
    approvedRows: [{ id: "r1", display_name: "ئەزا", body: "ئاشكارا ئىنكاس", created_at: "2026-10-01T00:00:00Z" }]
  });
  await switchMember(page, MEMBER_ID);
  await page.getByRole("button", { name: "جاۋاب يېزىش" }).click();
  await page.locator(".book-reviews-reply-form textarea").fill("ئا جاۋابى");
  await page.evaluate(() => { window.__reviewControl.insertMode = "delay"; });
  await page.locator(".book-reviews-reply-form").evaluate((form) => form.requestSubmit());
  await expect.poll(() => page.evaluate(() => typeof window.__reviewControl.releaseInsert === "function")).toBe(true);
  const before = await page.evaluate(() => window.__reviewControl.rpcs.length);
  await switchMember(page, MEMBER_B);
  await page.evaluate(() => window.__reviewControl.releaseInsert());
  await expect.poll(() => page.evaluate((start) => window.__reviewControl.rpcs.some((row, index) => index >= start && row.name === "my_book_review_status" && row.memberId === "22222222-2222-4222-8222-222222222222"), before)).toBe(true);
  await expect(page.locator(".book-reviews")).not.toContainText("ئا جاۋابى");
});

test("a delayed reply insert refreshes the signed-out page", async ({ page }) => {
  const state = { approved: [], own: [], inserts: [], reviewGets: [] };
  await installStorefront(page, state);
  await openBook(page);
  await useSwitchableMember(page, {
    memberId: MEMBER_ID,
    approvedRows: [{ id: "r1", display_name: "ئەزا", body: "ئاشكارا ئىنكاس", created_at: "2026-10-01T00:00:00Z" }]
  });
  await switchMember(page, MEMBER_ID);
  await page.getByRole("button", { name: "جاۋاب يېزىش" }).click();
  await page.locator(".book-reviews-reply-form textarea").fill("ئا جاۋابى");
  await page.evaluate(() => { window.__reviewControl.insertMode = "delay"; });
  await page.locator(".book-reviews-reply-form").evaluate((form) => form.requestSubmit());
  await expect.poll(() => page.evaluate(() => typeof window.__reviewControl.releaseInsert === "function")).toBe(true);
  await switchMember(page, "");
  await page.evaluate(() => window.__reviewControl.releaseInsert());
  await expect(page.locator(".book-reviews-invite a")).toHaveText("ئەزا بولغاندىن كېيىن كىتاب ھەققىدە ئىنكاس يېزىڭ");
  await expect(page.locator(".book-reviews")).not.toContainText("ئا جاۋابى");
  await expect(page.locator(".book-reviews-reply-form")).toHaveCount(0);
});

test("a saved reply is not inserted again when the refresh keeps failing", async ({ page }) => {
  const state = { approved: [], own: [], inserts: [], reviewGets: [] };
  await installStorefront(page, state);
  await openBook(page);
  await useReviewMember(page, MEMBER_ID);
  await page.evaluate(() => {
    const control = window.__reviewControl;
    control.approvedRows = [{ id: "r1", display_name: "ئەزا", body: "ئاشكارا ئىنكاس", created_at: "2026-10-01T00:00:00Z" }];
    control.insertMode = "fail-refresh";
    document.dispatchEvent(new CustomEvent("kutadgu-member-change"));
  });
  await page.getByRole("button", { name: "جاۋاب يېزىش" }).click();
  await page.locator(".book-reviews-reply-form textarea").fill("ساقلانغان جاۋاب");
  await page.locator(".book-reviews-reply-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator(".book-reviews-note", { hasText: "جاۋاب ساقلاندى. كۆرۈنۈش يېڭىلانمىدى." })).toBeVisible();
  await page.getByRole("button", { name: "قايتا سىناش" }).click();
  await page.getByRole("button", { name: "قايتا سىناش" }).click();
  await expect.poll(() => page.evaluate(() => window.__reviewControl.inserts.filter((row) => row.table === "book_review_replies").length)).toBe(1);
  const form = page.locator(".book-reviews-reply-form");
  if (await form.count()) {
    await page.getByRole("button", { name: "جاۋاب يېزىش" }).click();
    await form.locator("textarea").fill("ساقلانغان جاۋاب");
    await form.evaluate((node) => node.requestSubmit());
  }
  expect(await page.evaluate(() => window.__reviewControl.inserts.filter((row) => row.table === "book_review_replies"))).toEqual([
    { table: "book_review_replies", review_id: "r1", body: "ساقلانغان جاۋاب" }
  ]);
});

test("a failed heart write shows a retryable message", async ({ page }) => {
  const state = { approved: [], own: [], inserts: [], reviewGets: [] };
  await installStorefront(page, state);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openBook(page);
  await useReviewMember(page, MEMBER_ID);
  await page.evaluate(() => {
    const control = window.__reviewControl;
    control.approvedRows = [{ id: "r1", display_name: "ئەزا", body: "ئاشكارا ئىنكاس", created_at: "2026-10-01T00:00:00Z" }];
    control.heartRows = [{ review_id: "r1", heart_count: 3, mine: false }];
    control.heartWrite = "error";
    document.dispatchEvent(new CustomEvent("kutadgu-member-change"));
  });
  const button = page.locator(".book-reviews-heart");
  await expect(button).toContainText("3");
  await button.click();
  await expect(page.locator(".book-reviews-heart-note")).toHaveText("ياقتۇرۇش يوللانمىدى. قايتا سىناڭ.");
  await expect(button).toBeEnabled();
  await expect(button).toContainText("3");
  await button.click();
  expect(await page.evaluate(() => window.__reviewControl.heartCalls.map((row) => row.name))).toEqual([
    "add_book_review_heart",
    "add_book_review_heart"
  ]);
  await page.evaluate(() => document.body.classList.add("dark-mode"));
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.locator(".book-reviews-heart-note")).toBeVisible();
});

test("a queued notification read runs for the current member and after the tab is visible", async ({ page }) => {
  const state = { approved: [], own: [], inserts: [], reviewGets: [] };
  await installStorefront(page, state);
  await openBook(page);
  await useSwitchableMember(page, { memberId: MEMBER_ID, approvedRows: [] });
  await page.evaluate(() => { window.__reviewControl.noticeMode = "delay"; });
  await switchMember(page, MEMBER_ID);
  await expect.poll(() => page.evaluate(() => window.__reviewControl.noticeHeld)).toBe(true);
  await switchMember(page, MEMBER_B);
  await page.evaluate(() => {
    window.__reviewControl.noticeRows = [{ id: "b1", book_title: "بەتنىڭ كىتابى", excerpt: "يېڭى خەت", read_at: null, book_id: 252, reply_id: "br", review_id: "bv" }];
  });
  const before = await page.evaluate(() => window.__reviewControl.rpcs.filter((row) => row.name === "my_book_review_notifications" && row.memberId === "22222222-2222-4222-8222-222222222222").length);
  await page.evaluate(() => window.__reviewControl.releaseNotices());
  await expect.poll(() => page.evaluate((start) => window.__reviewControl.rpcs.filter((row) => row.name === "my_book_review_notifications" && row.memberId === "22222222-2222-4222-8222-222222222222").length > start, before)).toBe(true);
  await expect(page.locator(".book-review-notices-button")).toContainText("1");
  await page.locator(".book-review-notices-button").click();
  await expect(page.locator(".book-review-notices-panel")).toContainText("بەتنىڭ كىتابى");
  await expect(page.locator(".book-review-notices-panel")).not.toContainText("مەخپىي");
  await page.evaluate(() => {
    window.__reviewControl.noticeHeld = false;
    window.__reviewControl.noticeMode = "delay";
    window.__reviewControl.noticeRows = [{ id: "b2", book_title: "كۆرۈنگەن كىتاب", excerpt: "ئىككىنچى", read_at: null, book_id: 252, reply_id: "br2", review_id: "bv2" }];
    document.dispatchEvent(new CustomEvent("kutadgu-member-change"));
  });
  await expect.poll(() => page.evaluate(() => window.__reviewControl.noticeHeld)).toBe(true);
  const defined = await page.evaluate(() => {
    try {
      let state = "visible";
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
      window.__setReviewVisibility = (value) => {
        state = value;
        document.dispatchEvent(new Event("visibilitychange"));
      };
      return true;
    } catch (error) {
      return false;
    }
  });
  expect(defined).toBe(true);
  const visibleBefore = await page.evaluate(() => window.__reviewControl.rpcs.filter((row) => row.name === "my_book_review_notifications").length);
  await page.evaluate(() => window.__setReviewVisibility("hidden"));
  await page.evaluate(() => window.__setReviewVisibility("visible"));
  await page.evaluate(() => window.__reviewControl.releaseNotices());
  await expect.poll(() => page.evaluate((start) => window.__reviewControl.rpcs.filter((row) => row.name === "my_book_review_notifications").length > start, visibleBefore)).toBe(true);
  await expect(page.locator(".book-review-notices-button")).toContainText("1");
});

test("a notification opens a reply outside the first page and leaves a missing reply alone", async ({ page }) => {
  const state = { approved: [], own: [], inserts: [], reviewGets: [] };
  await installStorefront(page, state);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openBook(page);
  await useReviewMember(page, MEMBER_ID);
  const filler = Array.from({ length: 50 }, (_, index) => ({
    id: "fill-" + String(index),
    display_name: "ئەزا",
    body: "بەت ئىنكاسى " + String(index),
    created_at: "2026-10-01T00:00:" + String(index).padStart(2, "0") + "Z"
  }));
  await page.evaluate((rows) => {
    const control = window.__reviewControl;
    control.approvedRows = rows;
    control.noticeRows = [{ id: "n-old", review_id: "old-review", reply_id: "old-reply", book_id: 252, book_title: "تارىخىمىزدىكى خاقانلار", excerpt: "كونا", read_at: null }];
    control.targets = [{
      review_id: "old-review",
      review_display_name: "كونا ئەزا",
      review_body: "كونا ئىنكاس",
      reply_id: "old-reply",
      reply_display_name: "جاۋابچى",
      reply_body: "بەت سىرتىدىكى جاۋاب",
      book_id: 252
    }];
    document.dispatchEvent(new CustomEvent("kutadgu-member-change"));
  }, filler);
  await expect(page.locator(".book-reviews-item")).toHaveCount(50);
  await expect(page.locator("#reply-old-reply")).toHaveCount(0);
  const before = page.url();
  await page.locator(".book-review-notices-button").click();
  await page.locator(".book-review-notice").click();
  const target = page.locator("#reply-old-reply.book-reviews-target .book-reviews-body");
  await expect(target).toBeVisible();
  await expect(target).toHaveText("بەت سىرتىدىكى جاۋاب");
  await expect(page.locator("#review-old-review .book-reviews-body").first()).toHaveText("كونا ئىنكاس");
  await expect(page).toHaveURL(/\/book\/252#reply-old-reply$/);
  expect(await page.evaluate(() => window.__reviewControl.noticeMarks)).toEqual([{ p_id: "n-old" }]);
  await page.evaluate(() => {
    window.__reviewControl.targetMode = "missing";
    window.__reviewControl.noticeMarks = [];
    window.__reviewControl.noticeRows = [{ id: "n-gone", review_id: "gone", reply_id: "gone-reply", book_id: 252, book_title: "يوق كىتاب", excerpt: "يوق", read_at: null }];
    document.dispatchEvent(new CustomEvent("kutadgu-member-change"));
  });
  await page.locator(".book-review-notices-button").click();
  await page.locator(".book-review-notice", { hasText: "يوق كىتاب" }).click();
  await expect(page.locator(".book-review-notices-panel .book-review-notice-error")).toHaveText("بۇ جاۋاب تېپىلمىدى.");
  await expect(page).toHaveURL(/\/book\/252#reply-old-reply$/);
  expect(page.url()).toBe(page.url());
  expect(await page.evaluate(() => window.__reviewControl.noticeMarks)).toEqual([]);
  expect(page.url()).not.toBe(before);
  await page.evaluate(() => document.body.classList.add("dark-mode"));
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(target).toBeVisible();
});

test("a notification on another page renders the reply before it is marked read", async ({ page }) => {
  const state = { approved: [], own: [], inserts: [], reviewGets: [] };
  await installStorefront(page, state);
  await page.addInitScript((memberId) => {
    const control = {
      noticeRows: [{ id: "n-cross", review_id: "cross-review", reply_id: "cross-reply", book_id: 252, book_title: "تارىخىمىزدىكى خاقانلار", excerpt: "يىراق", read_at: null }],
      targets: [{
        review_id: "cross-review",
        review_display_name: "ئەزا",
        review_body: "يىراق ئىنكاس",
        reply_id: "cross-reply",
        reply_display_name: "جاۋابچى",
        reply_body: "باشقا بەتتىكى جاۋاب",
        book_id: 252
      }],
      noticeMarks: [],
      approvedRows: [],
      ownReplyRows: [],
      replyRows: [],
      heartRows: []
    };
    window.__reviewControl = control;
    const db = {
      from() {
        const query = {
          select() { return query; },
          eq() { return query; },
          in() { return query; },
          order() { return query; },
          limit() { return query; },
          insert() { return Promise.resolve({ data: null, error: null }); },
          then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); }
        };
        return query;
      },
      rpc(name, args) {
        if (name === "my_book_review_notifications") return Promise.resolve({ data: control.noticeRows, error: null });
        if (name === "public_book_review_reply_target") {
          const row = control.targets.find((item) => item.reply_id === args.p_reply_id);
          return Promise.resolve({ data: row ? [row] : [], error: null });
        }
        if (name === "mark_book_review_notification_read") {
          control.noticeMarks.push(args);
          return Promise.resolve({ data: null, error: null });
        }
        if (name === "my_book_review_status") return Promise.resolve({ data: null, error: null });
        if (name === "my_book_review_replies") return Promise.resolve({ data: [], error: null });
        if (name === "book_review_heart_summary") return Promise.resolve({ data: [], error: null });
        return Promise.resolve({ data: null, error: null });
      }
    };
    let current = null;
    const wrap = (value) => {
      if (value && typeof value === "object") {
        value.getUser = () => ({ id: memberId });
        value.getClient = () => db;
      }
      current = value;
      Object.defineProperty(window, "KutadguMember", { configurable: true, writable: true, value: value });
    };
    Object.defineProperty(window, "KutadguMember", { configurable: true, set: wrap, get: () => current });
  }, MEMBER_ID);
  await page.goto("/account.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".book-review-notices-button")).toBeVisible();
  await page.locator(".book-review-notices-button").click();
  await page.locator(".book-review-notice").click();
  await page.waitForURL(/\/book\/252#reply-cross-reply$/);
  const reply = page.locator("#reply-cross-reply.book-reviews-target .book-reviews-body");
  await expect(reply).toBeVisible();
  await expect(reply).toHaveText("باشقا بەتتىكى جاۋاب");
  await expect.poll(() => page.evaluate(() => (window.__reviewControl.noticeMarks || []).length)).toBe(1);
  expect(await page.evaluate(() => window.__reviewControl.noticeMarks)).toEqual([{ p_id: "n-cross" }]);
});

function moderationRows(status, prefix) {
  return Array.from({ length: 105 }, (_, index) => {
    const number = index + 1;
    return {
      id: prefix + "-" + status + "-" + String(number).padStart(3, "0"),
      review_id: "parent-" + status,
      book_id: 252,
      book_title: "تارىخىمىزدىكى خاقانلار",
      display_name: "ئەزا",
      body: prefix + "-" + status + "-" + String(number),
      status: status,
      created_at: new Date(Date.UTC(2099, 0, 1, 0, 0, number)).toISOString()
    };
  });
}

test("moderation pages reach every status and name the deleted record", async ({ page }) => {
  await page.addInitScript(() => {
    const payload = btoa(JSON.stringify({ aal: "aal2" })).replace(/=+$/g, "");
    const statuses = ["pending", "approved", "rejected"];
    const reviews = [];
    const replies = [];
    statuses.forEach((status) => {
      for (let number = 1; number <= 105; number += 1) {
        const stamp = new Date(Date.UTC(2099, 0, 1, 0, 0, number)).toISOString();
        reviews.push({
          id: "review-" + status + "-" + String(number).padStart(3, "0"),
          book_id: 252,
          book_title: "تارىخىمىزدىكى خاقانلار",
          display_name: "ئەزا",
          body: "باھا-" + status + "-" + String(number),
          status: status,
          created_at: stamp
        });
        replies.push({
          id: "reply-" + status + "-" + String(number).padStart(3, "0"),
          review_id: "parent",
          book_id: 252,
          book_title: "تارىخىمىزدىكى خاقانلار",
          display_name: "ئەزا",
          body: "جاۋاب-" + status + "-" + String(number),
          status: status,
          created_at: stamp
        });
      }
    });
    function pageOf(rows, args) {
      const status = args && args.p_status;
      let list = rows.filter((row) => row.status === status);
      list.sort((a, b) => a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : (a.id < b.id ? -1 : 1));
      if (args && args.p_after) {
        list = list.filter((row) => row.created_at > args.p_after || (row.created_at === args.p_after && row.id > args.p_after_id));
      }
      return list.slice(0, 100);
    }
    window.__reviewDecisions = [];
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguBookReviewAdminClient = {
      auth: {
        getSession: async () => ({ data: { session: { access_token: "e30." + payload + ".sig" } }, error: null }),
        signOut: async () => ({ error: null })
      },
      rpc(name, args) {
        if (name === "admin_list_book_reviews") return Promise.resolve({ data: pageOf(reviews, args), error: null });
        if (name === "admin_list_book_review_replies") return Promise.resolve({ data: pageOf(replies, args), error: null });
        if (name === "admin_approval_counts") return Promise.resolve({ data: { submissions: 0, reviews: 0, replies: 0 }, error: null });
        if (name === "admin_book_review_exists" || name === "admin_book_review_reply_exists") return Promise.resolve({ data: false, error: null });
        window.__reviewDecisions.push({ name: name, args: args });
        if (name === "delete_book_review") {
          const index = reviews.findIndex((row) => row.id === args.p_review_id);
          if (index >= 0) reviews.splice(index, 1);
        }
        if (name === "delete_book_review_reply") {
          const index = replies.findIndex((row) => row.id === args.p_reply_id);
          if (index >= 0) replies.splice(index, 1);
        }
        return Promise.resolve({ data: null, error: null });
      }
    };
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin.html#reviews", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".admin-review-item")).toHaveCount(100);
  await expect(page.locator(".admin-reply-item")).toHaveCount(100);
  await expect(page.locator(".admin-review-item", { hasText: "باھا-pending-101" })).toHaveCount(0);
  await page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" }).click();
  await page.locator("#bookReviewReplyList").getByRole("button", { name: "كېيىنكى بەت" }).click();
  await expect(page.locator(".admin-review-item", { hasText: "باھا-pending-101" })).toBeVisible();
  await expect(page.locator(".admin-reply-item", { hasText: "جاۋاب-pending-105" })).toBeVisible();
  let confirmText = "";
  page.once("dialog", (dialog) => {
    confirmText = dialog.message();
    dialog.accept();
  });
  await page.locator(".admin-review-item", { hasText: "باھا-pending-101" }).getByRole("button", { name: "ئۆچۈرۈش" }).click();
  await expect(page.locator(".admin-review-item", { hasText: "باھا-pending-101" })).toHaveCount(0);
  expect(confirmText).toContain("تارىخىمىزدىكى خاقانلار");
  expect(confirmText).toContain("باھا-pending-101");
  await page.locator("#bookReviewModerationList").getByRole("button", { name: "ئالدىنقى بەت" }).click();
  await expect(page.locator(".admin-review-body", { hasText: /^باھا-pending-1$/ })).toBeVisible();
  for (const status of ["approved", "rejected"]) {
    await page.locator(".admin-review-filters button[data-review-status='" + status + "']").click();
    await expect(page.locator(".admin-review-item")).toHaveCount(100);
    await page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" }).click();
    await expect(page.locator(".admin-review-item", { hasText: "باھا-" + status + "-105" })).toBeVisible();
    await expect(page.locator(".admin-review-item", { hasText: "باھا-pending-1" })).toHaveCount(0);
    await page.locator("#bookReviewReplyList").getByRole("button", { name: "كېيىنكى بەت" }).click();
    await expect(page.locator(".admin-reply-item", { hasText: "جاۋاب-" + status + "-105" })).toBeVisible();
  }
  await page.evaluate(() => document.body.classList.add("dark-mode"));
  await page.setViewportSize({ width: 390, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

test("late moderation responses stay on the requested filter and private lists clear", async ({ page }) => {
  await page.addInitScript(() => {
    const payload = btoa(JSON.stringify({ aal: "aal2" })).replace(/=+$/g, "");
    const reviews = {
      pending: [{ id: "p-review", book_id: 252, book_title: "كۈتۈۋاتقان كىتاب", display_name: "ئەزا", body: "كۈتۈۋاتقان ئىنكاس", status: "pending", created_at: "2026-10-01T00:00:00Z" }],
      approved: [{ id: "a-review", book_id: 252, book_title: "تەستىق كىتاب", display_name: "ئەزا", body: "تەستىقلانغان ئىنكاس", status: "approved", created_at: "2026-10-02T00:00:00Z" }],
      rejected: [{ id: "r-review", book_id: 252, book_title: "رەت كىتاب", display_name: "ئەزا", body: "رەت قىلىنغان ئىنكاس", status: "rejected", created_at: "2026-10-03T00:00:00Z" }]
    };
    const replies = {
      pending: [{ id: "p-reply", review_id: "parent", book_id: 252, book_title: "كۈتۈۋاتقان كىتاب", display_name: "ئەزا", body: "كۈتۈۋاتقان جاۋاب", status: "pending", created_at: "2026-10-01T00:00:00Z" }],
      approved: [{ id: "a-reply", review_id: "parent", book_id: 252, book_title: "تەستىق كىتاب", display_name: "ئەزا", body: "تەستىقلانغان جاۋاب", status: "approved", created_at: "2026-10-02T00:00:00Z" }],
      rejected: [{ id: "r-reply", review_id: "parent", book_id: 252, book_title: "رەت كىتاب", display_name: "ئەزا", body: "رەت قىلىنغان جاۋاب", status: "rejected", created_at: "2026-10-03T00:00:00Z" }]
    };
    window.__kutadguSkipAdminAuth = true;
    window.__reviewReads = 0;
    window.__kutadguBookReviewAdminClient = {
      auth: {
        getSession: async () => ({ data: { session: { access_token: "e30." + payload + ".sig" } }, error: null }),
        signOut: async () => ({ error: null })
      },
      rpc(name, args) {
        const status = args && args.p_status;
        if (name === "admin_approval_counts") {
          window.__reviewReads += 1;
          if (window.__approvalDelay && !window.__approvalHeld) {
            window.__approvalHeld = true;
            return new Promise((resolve) => {
              window.__releaseCounts = () => resolve({ data: { submissions: 4, reviews: 0, replies: 0 }, error: null });
            });
          }
          return Promise.resolve({ data: { submissions: 1, reviews: 1, replies: 1 }, error: null });
        }
        if (name === "admin_list_book_reviews") {
          if (window.__rejectReads) return Promise.reject(new Error("reviews rejected"));
          if (status === "pending" && window.__holdPending && !window.__pendingHeld) {
            window.__pendingHeld = true;
            return new Promise((resolve) => {
              window.__releasePending = () => resolve({ data: reviews.pending, error: null });
            });
          }
          return Promise.resolve({ data: reviews[status] || [], error: null });
        }
        if (name === "admin_list_book_review_replies") {
          if (window.__rejectReads) return Promise.reject(new Error("replies rejected"));
          return Promise.resolve({ data: replies[status] || [], error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }
    };
  });
  await page.goto("/admin.html#reviews", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".admin-review-item")).toContainText("كۈتۈۋاتقان ئىنكاس");
  await page.evaluate(() => { window.__holdPending = true; window.__pendingHeld = false; });
  await page.locator(".admin-review-filters button[data-review-status='pending']").click();
  await expect.poll(() => page.evaluate(() => window.__pendingHeld)).toBe(true);
  await page.locator(".admin-review-filters button[data-review-status='approved']").click();
  await expect(page.locator(".admin-review-item")).toContainText("تەستىقلانغان ئىنكاس");
  await expect(page.locator(".admin-reply-item")).toContainText("تەستىقلانغان جاۋاب");
  await page.evaluate(() => window.__releasePending());
  await expect(page.locator(".admin-review-item")).toContainText("تەستىقلانغان ئىنكاس");
  await expect(page.locator(".admin-review-item")).not.toContainText("كۈتۈۋاتقان ئىنكاس");
  await expect(page.locator(".admin-reply-item")).toContainText("تەستىقلانغان جاۋاب");
  await expect(page.locator(".admin-reply-item")).not.toContainText("كۈتۈۋاتقان جاۋاب");
  await page.evaluate(() => { window.__rejectReads = true; });
  await page.locator(".admin-review-filters button[data-review-status='approved']").click();
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("ئىنكاسلار يۈكلەنمىدى.");
  await expect(page.locator(".admin-review-item")).toContainText("تەستىقلانغان ئىنكاس");
  await expect(page.locator("#bookReviewReplyStatus")).toHaveText("جاۋابلار يۈكلەنمىدى.");
  await page.evaluate(() => { window.__approvalDelay = true; window.__approvalHeld = false; });
  await page.evaluate(() => { void window.KutadguAdminApprovals.refresh(); });
  await expect.poll(() => page.evaluate(() => typeof window.__releaseCounts === "function")).toBe(true);
  const readsBefore = await page.evaluate(() => window.__reviewReads);
  await page.evaluate(() => {
    let state = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    window.__setReviewVisibility = (value) => {
      state = value;
      document.dispatchEvent(new Event("visibilitychange"));
    };
    window.__setReviewVisibility("hidden");
    window.__setReviewVisibility("visible");
  });
  await page.evaluate(() => window.__releaseCounts());
  await expect.poll(() => page.evaluate((start) => window.__reviewReads > start, readsBefore)).toBe(true);
  await expect(page.locator(".admin-approval-bell-button")).toContainText("3");
  await page.evaluate(() => { document.querySelector("#idleLockPanel").hidden = false; });
  await expect(page.locator(".admin-review-item")).toHaveCount(0);
  await expect(page.locator(".admin-reply-item")).toHaveCount(0);
  await expect(page.locator(".admin-approval-bell")).toHaveCount(0);
  await page.evaluate(() => {
    document.querySelector("#idleLockPanel").hidden = true;
    window.__rejectReads = false;
    window.__holdPending = true;
    window.__pendingHeld = false;
  });
  await page.locator(".admin-review-filters button[data-review-status='pending']").click();
  await expect.poll(() => page.evaluate(() => window.__pendingHeld)).toBe(true);
  await page.evaluate(() => { document.querySelector("#adminLogout").click(); });
  await page.evaluate(() => window.__releasePending());
  await expect(page.locator(".admin-review-item")).toHaveCount(0);
  await expect(page.locator(".admin-reply-item")).toHaveCount(0);
});
