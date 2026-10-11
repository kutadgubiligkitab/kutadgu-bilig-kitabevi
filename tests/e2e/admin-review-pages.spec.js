const { test, expect } = require("@playwright/test");

function pack(rows, args) {
  const status = args && args.p_status;
  const query = String((args && args.p_query) || "").trim().toLocaleLowerCase("en");
  let list = rows.filter((row) => row.status === status);
  if (query) {
    list = list.filter((row) => {
      const title = String(row.book_title || "").toLocaleLowerCase("en");
      const name = String(row.display_name || "").toLocaleLowerCase("en");
      return title.indexOf(query) !== -1 || name.indexOf(query) !== -1;
    });
  }
  list.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : (a.id < b.id ? -1 : 1)));
  const total = list.length;
  let page = Number(args && args.p_page);
  if (!Number.isInteger(page) || page < 0) page = 0;
  const last = total === 0 ? 0 : Math.floor((total - 1) / 10);
  if (page > last) page = last;
  return { total: total, page: page, rows: list.slice(page * 10, page * 10 + 10).map((row) => Object.assign({}, row)) };
}

async function installReviewPages(page, options) {
  await page.addInitScript((setup) => {
    function pack(rows, args) {
      const status = args && args.p_status;
      const query = String((args && args.p_query) || "").trim().toLocaleLowerCase("en");
      let list = rows.filter((row) => row.status === status);
      if (query) {
        list = list.filter((row) => {
          const title = String(row.book_title || "").toLocaleLowerCase("en");
          const name = String(row.display_name || "").toLocaleLowerCase("en");
          return title.indexOf(query) !== -1 || name.indexOf(query) !== -1;
        });
      }
      list.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : (a.id < b.id ? -1 : 1)));
      const total = list.length;
      let pageIndex = Number(args && args.p_page);
      if (!Number.isInteger(pageIndex) || pageIndex < 0) pageIndex = 0;
      const last = total === 0 ? 0 : Math.floor((total - 1) / 10);
      if (pageIndex > last) pageIndex = last;
      return { total: total, page: pageIndex, rows: list.slice(pageIndex * 10, pageIndex * 10 + 10).map((row) => Object.assign({}, row)) };
    }
    const reviews = setup.reviews.slice();
    const replies = setup.replies.slice();
    window.__reviewCalls = [];
    window.__reviewWrites = [];
    window.__sessionWriteMark = 0;
    window.__armSessionAfterWrite = (mode) => {
      window.__sessionWriteMark = window.__reviewWrites.length;
      window.__sessionAfterWrite = mode || "";
    };
    window.__aal = "aal2";
    window.__sub = "admin-1";
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguBookReviewAdminClient = {
      auth: {
        getSession: async () => {
          if (window.__sessionBeforeWrite) throw new Error("session before write");
          if (window.__sessionAfterWrite && window.__reviewWrites.length > window.__sessionWriteMark) {
            const mode = window.__sessionAfterWrite;
            if (mode === "throw") throw new Error("session read failed");
            if (mode === "aal1") window.__aal = "aal1";
            if (mode === "other") window.__sub = "admin-2";
          }
          const payload = btoa(JSON.stringify({ aal: window.__aal, sub: window.__sub })).replace(/=+$/g, "");
          return { data: { session: { access_token: "e30." + payload + ".sig" } }, error: null };
        }
      },
      rpc(name, args) {
        window.__reviewCalls.push({ name: name, args: args });
        if (name === "admin_approval_counts") return Promise.resolve({ data: { submissions: 7, reviews: 40, replies: 15 }, error: null });
        if (name === "admin_book_review_page") {
          if (window.__reviewReadFail) return Promise.reject(new Error("reviews failed"));
          if (window.__reviewReadError) return Promise.resolve({ data: null, error: { message: "reviews error", code: "08006" } });
          if (window.__reviewHold) {
            window.__reviewHold = false;
            return new Promise((resolve) => {
              window.__releaseReviewRead = () => resolve({ data: pack(reviews, args), error: null });
            });
          }
          if (window.__reviewMalformed) return Promise.resolve({ data: { total: null, rows: [] }, error: null });
          return Promise.resolve({ data: pack(reviews, args), error: null });
        }
        if (name === "admin_book_review_reply_page") {
          if (window.__replyReadFail) return Promise.reject(new Error("replies failed"));
          if (window.__replyReadError) return Promise.resolve({ data: null, error: { message: "replies error", code: "08006" } });
          if (window.__replyHold) {
            window.__replyHold = false;
            return new Promise((resolve) => {
              window.__releaseReplyRead = () => resolve({ data: pack(replies, args), error: null });
            });
          }
          if (window.__replyMalformed) return Promise.resolve({ data: { rows: [] }, error: null });
          return Promise.resolve({ data: pack(replies, args), error: null });
        }
        if (name === "admin_book_review_exists") {
          if (window.__reviewExistsError) return Promise.resolve({ data: null, error: { message: "exists failed", code: "08006" } });
          return Promise.resolve({ data: window.__reviewExists === true, error: null });
        }
        if (name === "admin_book_review_reply_exists") return Promise.resolve({ data: window.__replyExists, error: null });
        window.__reviewWrites.push({ name: name, args: args });
        if (window.__writeHold) {
          return new Promise((resolve) => {
            window.__releaseWrite = () => resolve({ data: null, error: window.__writeError || null });
          });
        }
        if (window.__writeError) return Promise.resolve({ data: null, error: window.__writeError });
        if (name === "moderate_book_review" || name === "delete_book_review") {
          const id = args.review_id || args.p_review_id;
          const index = reviews.findIndex((row) => row.id === id);
          if (index >= 0) reviews.splice(index, 1);
        }
        if (name === "moderate_book_review_reply" || name === "delete_book_review_reply") {
          const id = args.p_reply_id;
          const index = replies.findIndex((row) => row.id === id);
          if (index >= 0) replies.splice(index, 1);
        }
        return Promise.resolve({ data: null, error: null });
      }
    };
  }, options);
}

function rows(count, prefix, status) {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const stamp = number === 2 ? "2026-01-01T00:00:00.000Z" : new Date(Date.UTC(2026, 0, 1, 0, 0, number)).toISOString();
    return {
      id: prefix + "-" + String(number).padStart(3, "0"),
      review_id: "parent",
      book_id: number,
      book_title: number === 15 ? "ئالما كىتابى" : ("كىتاب " + String(number).padStart(3, "0")),
      display_name: number === 4 ? "100%_o'b\\ئۇيغۇر" : (number === 8 ? "جاۋابچىئەلى" : "ئەزا"),
      body: prefix + " " + String(number) + (number === 6 ? " " + "ئۇزۇن".repeat(40) : ""),
      status: status || "pending",
      created_at: number === 1 ? "2026-01-01T00:00:00.000Z" : stamp
    };
  });
}

test("review and reply pages keep separate totals and an exact search", async ({ page }) => {
  const reviews = rows(61, "باھا");
  reviews[0].id = "00000000-0000-4000-8000-000000000002";
  reviews[1].id = "00000000-0000-4000-8000-000000000001";
  const replies = rows(21, "جاۋاب");
  replies[7].display_name = "جاۋاب يازغۇچى";
  await installReviewPages(page, { reviews: reviews, replies: replies });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin.html#reviews", { waitUntil: "domcontentloaded" });
  await expect(page.locator("label[for='bookReviewSearch']")).toHaveText("كىتاب نامى ياكى يازغۇچى ئىسمى");
  await expect(page.locator(".admin-review-item")).toHaveCount(10);
  await expect(page.locator(".admin-reply-item")).toHaveCount(10);
  await expect(page.locator("#bookReviewModerationList .admin-review-total")).toHaveText("جەمئىي 61 ئىنكاس · بەت 1 / 7");
  await expect(page.locator("#bookReviewReplyList .admin-review-total")).toHaveText("جەمئىي 21 جاۋاب · بەت 1 / 3");
  const firstReview = await page.locator("#bookReviewModerationList .admin-review-body").first().textContent();
  expect(firstReview).toContain("باھا 2");
  await page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" }).click();
  await expect(page.locator("#bookReviewModerationList .admin-review-body").first()).toContainText("باھا 11");
  await expect(page.locator("#bookReviewReplyList .admin-review-body").first()).toContainText("جاۋاب 1");
  await page.locator("#bookReviewReplyList").getByRole("button", { name: "كېيىنكى بەت" }).click();
  await page.locator("#bookReviewReplyList").getByRole("button", { name: "كېيىنكى بەت" }).click();
  await expect(page.locator(".admin-reply-item")).toHaveCount(1);
  await expect(page.locator("#bookReviewReplyList").getByRole("button", { name: "كېيىنكى بەت" })).toBeDisabled();
  await expect(page.locator("#bookReviewModerationList .admin-review-body").first()).toContainText("باھا 11");

  await page.locator("#bookReviewSearch").fill("ئالما");
  await expect(page.locator(".admin-review-item")).toHaveCount(1);
  await expect(page.locator("#bookReviewModerationList .admin-review-total")).toHaveText("جەمئىي 1 ئىنكاس · بەت 1 / 1");
  await expect(page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" })).toBeDisabled();
  await expect(page.locator("#bookReviewReplyList .admin-review-total")).toHaveText("جەمئىي 1 جاۋاب · بەت 1 / 1");
  await page.locator("#bookReviewSearch").fill("يوقسۆز");
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("بۇ ئىزدەشكە ماس ئىنكاس تېپىلمىدى.");
  await expect(page.locator("#bookReviewReplyStatus")).toHaveText("بۇ ئىزدەشكە ماس جاۋاب تېپىلمىدى.");
  await expect(page.locator("#bookReviewModerationList .admin-review-total")).toHaveText("جەمئىي 0 ئىنكاس");
  await expect(page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" })).toBeDisabled();
  await expect(page.locator("#bookReviewModerationList").getByRole("button", { name: "ئالدىنقى بەت" })).toBeDisabled();

  await page.locator("#bookReviewSearch").fill("100%_o'b\\ئۇيغۇر");
  await expect(page.locator(".admin-review-item")).toHaveCount(1);
  await expect(page.locator(".admin-review-item")).toContainText("100%_o'b\\ئۇيغۇر");
  await page.locator("#bookReviewSearch").fill("_");
  await expect.poll(() => page.evaluate(() => window.__reviewCalls.filter((call) => call.name === "admin_book_review_page" && call.args && call.args.p_query === "_").length)).toBeGreaterThan(0);

  await page.locator("#bookReviewSearch").fill("");
  await page.locator(".admin-review-filters button[data-review-status='approved']").click();
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("بۇ ھالەتتە ئىنكاس يوق.");
  await expect(page.locator("#bookReviewModerationList .admin-review-total")).toHaveText("جەمئىي 0 ئىنكاس");
  const bell = page.locator(".admin-approval-bell-button");
  await bell.click();
  await expect(page.locator(".admin-approval-panel")).toContainText("ئىنكاسلار 40");
  await expect(page.locator(".admin-approval-panel")).toContainText("جاۋابلار 15");
});

test("page sizes 0 through 60 disable the extra page and stay on the server query", async ({ page }) => {
  const cases = [0, 1, 9, 10, 11, 20, 21, 60];
  await installReviewPages(page, { reviews: rows(60, "باھا"), replies: rows(60, "جاۋاب") });
  await page.goto("/admin.html#reviews", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    const allReviews = [];
    const allReplies = [];
    for (let number = 1; number <= 60; number += 1) {
      const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, number)).toISOString();
      allReviews.push({ id: "r-" + number, book_id: number, book_title: "كىتاب", display_name: "ئەزا", body: "باھا " + number, status: "pending", created_at: stamp });
      allReplies.push({ id: "p-" + number, review_id: "parent", book_id: number, book_title: "كىتاب", display_name: "ئەزا", body: "جاۋاب " + number, status: "pending", created_at: stamp });
    }
    const db = window.__kutadguBookReviewAdminClient;
    const base = db.rpc;
    db.rpc = (name, args) => {
      if (name === "admin_book_review_page" || name === "admin_book_review_reply_page") {
        const limit = window.__activeLimit;
        const source = name === "admin_book_review_page" ? allReviews : allReplies;
        return base(name, args).then((result) => {
          if (!result || result.error || !result.data) return result;
          const sliced = source.slice(0, limit);
          const query = String((args && args.p_query) || "").trim();
          const matched = query ? sliced.filter((row) => String(row.book_title).indexOf(query) !== -1 || String(row.display_name).indexOf(query) !== -1) : sliced;
          const total = matched.length;
          let pageIndex = Number(args && args.p_page) || 0;
          const last = total === 0 ? 0 : Math.floor((total - 1) / 10);
          if (pageIndex > last) pageIndex = last;
          return { data: { total: total, page: pageIndex, rows: matched.slice(pageIndex * 10, pageIndex * 10 + 10) }, error: null };
        });
      }
      return base(name, args);
    };
  });
  for (const count of cases) {
    await page.evaluate((limit) => { window.__activeLimit = limit; }, count);
    await page.locator("#bookReviewSearch").fill("limit-" + count);
    await page.locator("#bookReviewSearch").fill("");
    await expect(page.locator("#bookReviewModerationList .admin-review-total")).toContainText("جەمئىي " + count + " ئىنكاس");
    const pages = count === 0 ? 0 : Math.floor((count - 1) / 10) + 1;
    if (!count) {
      await expect(page.locator("#bookReviewModerationList .admin-review-total")).toHaveText("جەمئىي 0 ئىنكاس");
      await expect(page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" })).toBeDisabled();
    } else {
      await expect(page.locator("#bookReviewModerationList .admin-review-total")).toContainText("بەت 1 / " + pages);
      if (count <= 10) await expect(page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" })).toBeDisabled();
      else await expect(page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" })).toBeEnabled();
    }
  }
  await page.evaluate(() => { window.__activeLimit = 21; });
  await page.locator(".admin-review-filters button[data-review-status='pending']").click();
  await page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" }).click();
  await page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" }).click();
  await expect(page.locator(".admin-review-item")).toHaveCount(1);
  await expect(page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" })).toBeDisabled();
  await page.evaluate(() => { window.__activeLimit = 20; });
  await page.locator(".admin-review-filters button[data-review-status='pending']").click();
  await page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" }).click();
  await expect(page.locator(".admin-review-item")).toHaveCount(10);
  await expect(page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" })).toBeDisabled();
});

test("search debounce, a failed read, and a failed refresh stay independent", async ({ page }) => {
  const reviews = rows(12, "باھا");
  reviews[11].book_title = "ئالما كىتابى";
  await installReviewPages(page, { reviews: reviews, replies: rows(3, "جاۋاب") });
  await page.goto("/admin.html#reviews", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".admin-review-item")).toHaveCount(10);
  await page.evaluate(() => { window.__reviewHold = true; });
  await page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseReviewRead === "function")).toBe(true);
  await page.locator("#bookReviewSearch").fill("ئالما");
  await page.evaluate(() => window.__releaseReviewRead());
  await expect(page.locator(".admin-review-item")).toHaveCount(1);
  await expect(page.locator("#bookReviewModerationList")).not.toContainText("باھا 11");
  await page.locator("#bookReviewSearch").fill("");
  await expect(page.locator(".admin-review-item")).toHaveCount(10);

  await page.evaluate(() => { window.__replyReadFail = true; });
  await page.locator(".admin-review-filters button[data-review-status='pending']").click();
  await expect(page.locator("#bookReviewReplyStatus")).toHaveText("جاۋابلار يۈكلەنمىدى.");
  await expect(page.locator("#bookReviewModerationStatus")).not.toHaveText("ئىنكاسلار يۈكلەنمىدى.");
  await expect(page.locator(".admin-review-item")).toHaveCount(10);
  await expect(page.locator("#bookReviewsCard")).toHaveAttribute("data-review-loading", "0");
  await page.evaluate(() => { window.__replyReadFail = false; window.__reviewMalformed = true; });
  await page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" }).click();
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("ئىنكاسلار يۈكلەنمىدى.");
  await expect(page.locator("#bookReviewModerationList .admin-review-total")).toContainText("جەمئىي 12 ئىنكاس");
  await expect(page.locator(".admin-review-item")).toHaveCount(10);
  await page.locator("#bookReviewRetry").click();
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("ئىنكاسلار يۈكلەنمىدى.");

  await page.evaluate(() => { window.__reviewMalformed = false; });
  await page.locator("#bookReviewRetry").click();
  await expect(page.locator(".admin-review-item")).toHaveCount(2);
  page.once("dialog", (dialog) => dialog.accept());
  await page.evaluate(() => { window.__reviewReadFail = true; });
  await page.locator(".admin-review-item").first().getByRole("button", { name: "تەستىقلاش" }).click();
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("ئىنكاس تەستىقلاندى، لېكىن تىزىملىك يېڭىلانمىدى.");
  const writes = await page.evaluate(() => window.__reviewWrites.length);
  await page.locator(".admin-review-actions button").first().click({ force: true }).catch(() => {});
  expect(await page.evaluate(() => window.__reviewWrites.length)).toBe(writes);
  await page.evaluate(() => { window.__reviewReadFail = false; });
  await page.locator("#bookReviewRetry").click();
  await expect(page.locator("#bookReviewModerationStatus")).not.toHaveText("ئىنكاس تەستىقلاندى، لېكىن تىزىملىك يېڭىلانمىدى.");
});

test("uncertain deletion, logout, and AAL2 loss do not restore private rows", async ({ page }) => {
  await installReviewPages(page, { reviews: rows(2, "باھا"), replies: rows(1, "جاۋاب") });
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/admin.html#reviews", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  page.once("dialog", (dialog) => dialog.accept());
  await page.evaluate(() => { window.__writeError = { message: "lost", code: "08006" }; window.__reviewExistsError = true; });
  await page.locator(".admin-review-item").first().getByRole("button", { name: "ئۆچۈرۈش" }).click();
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("ئۆچۈرۈش نەتىجىسى ئېنىق ئەمەس. قايتا سىناڭ.");
  expect(await page.evaluate(() => window.__reviewWrites.length)).toBe(1);
  await expect(page.locator(".admin-review-item").first().getByRole("button", { name: "ئۆچۈرۈش" })).toBeEnabled();

  await page.evaluate(() => {
    window.__writeError = null;
    window.__writeHold = true;
    window.__reviewHold = false;
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".admin-review-item").first().getByRole("button", { name: "ئۆچۈرۈش" }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseWrite === "function")).toBe(true);
  await page.evaluate(() => { document.querySelector("#adminLogout").click(); });
  await page.evaluate(() => window.__releaseWrite());
  await expect(page.locator(".admin-review-item")).toHaveCount(0);
  await expect(page.locator(".admin-reply-item")).toHaveCount(0);
  await expect(page.locator("#bookReviewSearch")).toHaveValue("");

  await page.evaluate(() => { document.querySelector("#idleLockPanel").hidden = true; document.querySelector("#dashboardPanel").hidden = false; });
  await page.locator(".admin-review-filters button[data-review-status='pending']").click();
  await expect(page.locator(".admin-review-item")).toHaveCount(2);
  await page.evaluate(() => { window.__reviewHold = true; });
  await page.locator(".admin-review-filters button[data-review-status='pending']").click();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseReviewRead === "function")).toBe(true);
  await page.evaluate(() => { window.__aal = "aal1"; });
  await page.evaluate(() => window.__releaseReviewRead());
  await expect(page.locator("#bookReviewModerationStatus")).toContainText("AAL2");
  await expect(page.locator(".admin-review-item")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 800 });
  await page.evaluate(() => document.body.classList.add("dark-mode"));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
  await page.locator("#bookReviewSearch").focus();
  await page.keyboard.type("ئۇزۇن ئىسىم");
  await page.keyboard.press("Tab");
  await expect(page.locator("#bookReviewSearch")).toBeFocused({ timeout: 1000 }).catch(async () => {
    await expect(page.locator(".admin-review-filters button").first()).toBeFocused();
  });
});

const RETAINED_REVIEW = "ئىنكاسلار يۈكلەنمىدى. كۆرۈنۈپ تۇرغان تىزىملىك ئالدىنقى نەتىجە.";
const RETAINED_REPLY = "جاۋابلار يۈكلەنمىدى. كۆرۈنۈپ تۇرغان تىزىملىك ئالدىنقى نەتىجە.";

async function pageReads(page, name) {
  return page.evaluate((rpcName) => (window.__reviewCalls || []).filter((call) => call.name === rpcName).map((call) => ({
    status: call.args && call.args.p_status,
    query: call.args && call.args.p_query,
    page: call.args && call.args.p_page
  })), name);
}

test("a failed status or search keeps the committed rows, actions, and page", async ({ page }) => {
  const reviews = rows(12, "تەستىق", "approved").concat(rows(12, "كۈتۈش", "pending"));
  const replies = rows(12, "جاۋاب-تەستىق", "approved").concat(rows(2, "جاۋاب-كۈتۈش", "pending"));
  await installReviewPages(page, { reviews: reviews, replies: replies });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin.html#reviews", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.locator(".admin-review-filters button[data-review-status='approved']").click();
  await expect(page.locator(".admin-review-item")).toHaveCount(10);
  await expect(page.locator("#bookReviewModerationList .admin-review-total")).toHaveText("جەمئىي 12 ئىنكاس · بەت 1 / 2");
  await expect(page.locator(".admin-review-item").getByRole("button", { name: "تەستىقلاش" })).toHaveCount(0);
  await expect(page.locator(".admin-reply-item").getByRole("button", { name: "تەستىقلاش" })).toHaveCount(0);
  await expect(page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" })).toBeEnabled();

  for (const mode of ["reject", "error"]) {
    await page.evaluate((kind) => {
      window.__reviewReadFail = kind === "reject";
      window.__reviewReadError = kind === "error";
      window.__replyReadFail = false;
      window.__replyReadError = false;
    }, mode);
    const before = (await pageReads(page, "admin_book_review_page")).length;
    await page.locator(".admin-review-filters button[data-review-status='pending']").click();
    await expect(page.locator("#bookReviewModerationStatus")).toHaveText(RETAINED_REVIEW);
    await expect(page.locator("#bookReviewModerationStatus")).not.toHaveText("بۇ ھالەتتە ئىنكاس يوق.");
    await expect(page.locator("#bookReviewReplyStatus")).not.toHaveText(RETAINED_REPLY);
    await expect(page.locator("#bookReviewReplyStatus")).not.toHaveText("جاۋابلار يۈكلەنمىدى.");
    await expect(page.locator(".admin-review-body").first()).toContainText("تەستىق 1");
    await expect(page.locator("#bookReviewModerationList .admin-review-total")).toHaveText("جەمئىي 12 ئىنكاس · بەت 1 / 2");
    await expect(page.locator(".admin-review-item").getByRole("button", { name: "تەستىقلاش" })).toHaveCount(0);
    await expect(page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" })).toBeDisabled();
    await expect(page.locator("#bookReviewModerationList").getByRole("button", { name: "ئالدىنقى بەت" })).toBeDisabled();
    await expect(page.locator(".admin-reply-item")).toHaveCount(2);
    await expect(page.locator(".admin-reply-item").getByRole("button", { name: "تەستىقلاش" })).toHaveCount(2);
    const pendingReads = (await pageReads(page, "admin_book_review_page")).slice(before);
    expect(pendingReads).toEqual([{ status: "pending", query: "", page: 0 }]);
    await page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" }).click({ force: true }).catch(() => {});
    expect((await pageReads(page, "admin_book_review_page")).slice(before)).toEqual([{ status: "pending", query: "", page: 0 }]);
    const beforeRetry = (await pageReads(page, "admin_book_review_page")).length;
    await page.locator("#bookReviewRetry").click();
    expect((await pageReads(page, "admin_book_review_page")).slice(beforeRetry)).toEqual([{ status: "pending", query: "", page: 0 }]);
    expect((await pageReads(page, "admin_book_review_reply_page")).filter((call) => call.page === 1 && call.status === "pending")).toEqual([]);
    await page.evaluate(() => {
      window.__reviewReadFail = false;
      window.__reviewReadError = false;
    });
    await page.locator(".admin-review-filters button[data-review-status='approved']").click();
    await expect(page.locator(".admin-review-body").first()).toContainText("تەستىق 1");
    await expect(page.locator("#bookReviewModerationStatus")).not.toContainText("يۈكلەنمىدى");
  }

  await page.evaluate(() => { window.__replyReadFail = true; });
  await page.locator("#bookReviewSearch").fill("باشقا");
  await expect(page.locator("#bookReviewReplyStatus")).toHaveText(RETAINED_REPLY);
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("بۇ ئىزدەشكە ماس ئىنكاس تېپىلمىدى.");
  await expect(page.locator(".admin-reply-item").first()).toContainText("جاۋاب-تەستىق 1");
  await expect(page.locator(".admin-reply-item").getByRole("button", { name: "تەستىقلاش" })).toHaveCount(0);
  await expect(page.locator("#bookReviewReplyList").getByRole("button", { name: "كېيىنكى بەت" })).toBeDisabled();
  const beforeReplyRetry = (await pageReads(page, "admin_book_review_reply_page")).length;
  await page.locator("#bookReviewReplyRetry").click();
  expect((await pageReads(page, "admin_book_review_reply_page")).slice(beforeReplyRetry)).toEqual([{ status: "approved", query: "باشقا", page: 0 }]);
  await page.evaluate(() => { window.__replyReadFail = false; });
  await page.locator("#bookReviewSearch").fill("");
  await page.locator(".admin-review-filters button[data-review-status='approved']").click();
  await expect(page.locator(".admin-review-body").first()).toContainText("تەستىق 1");
  await page.evaluate(() => { window.__reviewReadError = true; });
  await page.locator("#bookReviewSearch").fill("يوقسۆز");
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText(RETAINED_REVIEW);
  await expect(page.locator("#bookReviewReplyStatus")).toHaveText("بۇ ئىزدەشكە ماس جاۋاب تېپىلمىدى.");
  await expect(page.locator(".admin-review-body").first()).toContainText("تەستىق 1");
  await expect(page.locator("#bookReviewModerationList .admin-review-total")).toHaveText("جەمئىي 12 ئىنكاس · بەت 1 / 2");
  await expect(page.locator(".admin-review-item").getByRole("button", { name: "تەستىقلاش" })).toHaveCount(0);
  await expect(page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" })).toBeDisabled();
  const beforeSearchRetry = (await pageReads(page, "admin_book_review_page")).length;
  await page.locator("#bookReviewRetry").click();
  expect((await pageReads(page, "admin_book_review_page")).slice(beforeSearchRetry)).toEqual([{ status: "approved", query: "يوقسۆز", page: 0 }]);

  for (const viewport of [
    { width: 390, height: 800 },
    { width: 768, height: 900 },
    { width: 1280, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("#bookReviewModerationStatus")).toHaveText(RETAINED_REVIEW);
    await expect(page.locator("#bookReviewRetry")).toBeVisible();
    await expect(page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" })).toBeDisabled();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  }
  await page.evaluate(() => document.body.classList.add("dark-mode"));
  const darkOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(darkOverflow).toBe(false);
});

test("paging one review list does not cancel or reread the other", async ({ page }) => {
  await installReviewPages(page, { reviews: rows(12, "باھا", "pending"), replies: rows(12, "جاۋاب", "pending") });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin.html#reviews", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#bookReviewModerationList .admin-review-body").first()).toContainText("باھا 1");
  await expect(page.locator("#bookReviewReplyList .admin-review-body").first()).toContainText("جاۋاب 1");

  await page.evaluate(() => { window.__reviewHold = true; });
  const reviewNext = page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" });
  const replyNext = page.locator("#bookReviewReplyList").getByRole("button", { name: "كېيىنكى بەت" });
  await reviewNext.click();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseReviewRead === "function")).toBe(true);
  const reviewMark = (await pageReads(page, "admin_book_review_page")).length;
  const replyMark = (await pageReads(page, "admin_book_review_reply_page")).length;
  await replyNext.click();
  await expect(page.locator("#bookReviewReplyList .admin-review-body").first()).toContainText("جاۋاب 11");
  await expect(page.locator("#bookReviewModerationList .admin-review-body").first()).toContainText("باھا 1");
  expect((await pageReads(page, "admin_book_review_page")).slice(reviewMark)).toEqual([]);
  expect((await pageReads(page, "admin_book_review_reply_page")).slice(replyMark)).toEqual([{ status: "pending", query: "", page: 1 }]);
  await page.evaluate(() => window.__releaseReviewRead());
  await expect(page.locator("#bookReviewModerationList .admin-review-body").first()).toContainText("باھا 11");
  await expect(page.locator("#bookReviewReplyList .admin-review-body").first()).toContainText("جاۋاب 11");

  await page.locator("#bookReviewModerationList").getByRole("button", { name: "ئالدىنقى بەت" }).click();
  await page.locator("#bookReviewReplyList").getByRole("button", { name: "ئالدىنقى بەت" }).click();
  await expect(page.locator("#bookReviewModerationList .admin-review-body").first()).toContainText("باھا 1");
  await expect(page.locator("#bookReviewReplyList .admin-review-body").first()).toContainText("جاۋاب 1");
  await page.evaluate(() => { window.__replyHold = true; });
  await replyNext.click();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseReplyRead === "function")).toBe(true);
  const reviewMarkTwo = (await pageReads(page, "admin_book_review_page")).length;
  await reviewNext.click();
  await expect(page.locator("#bookReviewModerationList .admin-review-body").first()).toContainText("باھا 11");
  await expect(page.locator("#bookReviewReplyList .admin-review-body").first()).toContainText("جاۋاب 1");
  expect((await pageReads(page, "admin_book_review_reply_page")).filter((call, index, all) => index >= all.length - 1)).toEqual([{ status: "pending", query: "", page: 1 }]);
  expect((await pageReads(page, "admin_book_review_page")).slice(reviewMarkTwo)).toEqual([{ status: "pending", query: "", page: 1 }]);
  await page.evaluate(() => window.__releaseReplyRead());
  await expect(page.locator("#bookReviewReplyList .admin-review-body").first()).toContainText("جاۋاب 11");
  await expect(page.locator("#bookReviewModerationList .admin-review-body").first()).toContainText("باھا 11");

  await page.locator("#bookReviewModerationList").getByRole("button", { name: "ئالدىنقى بەت" }).click();
  await page.locator("#bookReviewReplyList").getByRole("button", { name: "ئالدىنقى بەت" }).click();
  await page.evaluate(() => { window.__reviewHold = true; window.__replyReadFail = true; });
  await reviewNext.click();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseReviewRead === "function")).toBe(true);
  const heldReviewCalls = (await pageReads(page, "admin_book_review_page")).length;
  await replyNext.click();
  await expect(page.locator("#bookReviewReplyStatus")).toHaveText("جاۋابلار يۈكلەنمىدى.");
  await expect(page.locator("#bookReviewReplyList .admin-review-body").first()).toContainText("جاۋاب 1");
  await expect(page.locator("#bookReviewModerationList .admin-review-body").first()).toContainText("باھا 1");
  expect((await pageReads(page, "admin_book_review_page")).length).toBe(heldReviewCalls);
  await page.evaluate(() => window.__releaseReviewRead());
  await expect(page.locator("#bookReviewModerationList .admin-review-body").first()).toContainText("باھا 11");
  await expect(page.locator("#bookReviewReplyStatus")).toHaveText("جاۋابلار يۈكلەنمىدى.");
  await expect(page.locator("#bookReviewReplyRetry")).toBeVisible();
  await page.evaluate(() => { window.__replyReadFail = false; });
  await page.locator("#bookReviewReplyRetry").click();
  await expect(page.locator("#bookReviewReplyList .admin-review-body").first()).toContainText("جاۋاب 11");
  await expect(page.locator("#bookReviewModerationList .admin-review-body").first()).toContainText("باھا 11");
});

test("a confirmed write survives a rejected session read and is not sent again", async ({ page }) => {
  await installReviewPages(page, { reviews: rows(12, "باھا", "pending"), replies: rows(2, "جاۋاب", "pending") });
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/admin.html#reviews", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const reviewId = await page.locator(".admin-review-item").first().getAttribute("data-review-id");
  const replyId = await page.locator(".admin-reply-item").first().getAttribute("data-reply-id");

  await page.evaluate(() => { window.__sessionBeforeWrite = true; });
  await page.locator(".admin-review-item").first().getByRole("button", { name: "تەستىقلاش" }).click();
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("بۇ مەشغۇلاتقا ئىجازەت يوق.");
  expect(await page.evaluate(() => window.__reviewWrites.length)).toBe(0);
  await expect(page.locator(".admin-review-item").first().getByRole("button", { name: "تەستىقلاش" })).toBeEnabled();

  await page.evaluate(() => { window.__sessionBeforeWrite = false; window.__armSessionAfterWrite("throw"); });
  await page.locator(".admin-review-item").first().getByRole("button", { name: "تەستىقلاش" }).click();
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("ئىنكاس تەستىقلاندى، لېكىن تىزىملىك يېڭىلانمىدى.");
  await expect(page.locator("#bookReviewModerationStatus")).not.toHaveText("بۇ مەشغۇلاتقا ئىجازەت يوق.");
  await expect(page.locator(".admin-review-item").first()).toHaveAttribute("data-review-id", reviewId);
  expect(await page.evaluate(() => window.__reviewWrites.map((row) => row.name))).toEqual(["moderate_book_review"]);
  await page.locator(".admin-review-item").first().getByRole("button", { name: "تەستىقلاش" }).click({ force: true }).catch(() => {});
  expect(await page.evaluate(() => window.__reviewWrites.length)).toBe(1);
  await page.evaluate(() => { window.__armSessionAfterWrite(""); });
  await page.locator("#bookReviewRetry").click();
  await expect(page.locator(".admin-review-item[data-review-id='" + reviewId + "']")).toHaveCount(0);
  expect(await page.evaluate(() => window.__reviewWrites.length)).toBe(1);

  await page.evaluate(() => { window.__armSessionAfterWrite("aal1"); });
  const secondId = await page.locator(".admin-review-item").first().getAttribute("data-review-id");
  await page.locator(".admin-review-item").first().getByRole("button", { name: "رەت قىلىش" }).click();
  await expect(page.locator("#bookReviewModerationStatus")).toContainText("AAL2");
  await expect(page.locator(".admin-review-item")).toHaveCount(0);
  await expect(page.locator(".admin-reply-item")).toHaveCount(0);
  expect(await page.evaluate((id) => window.__reviewWrites.filter((row) => row.args && row.args.review_id === id).length, secondId)).toBe(1);
  await page.evaluate(() => { window.__armSessionAfterWrite(""); window.__aal = "aal2"; window.__sub = "admin-1"; });
  await page.locator(".admin-review-filters button[data-review-status='pending']").click();
  await expect(page.locator(".admin-review-item").first()).toBeVisible();
  expect(await page.evaluate((id) => window.__reviewWrites.filter((row) => row.args && row.args.review_id === id).length, secondId)).toBe(1);

  await page.evaluate(() => { window.__armSessionAfterWrite("other"); });
  const thirdId = await page.locator(".admin-review-item").first().getAttribute("data-review-id");
  await page.locator(".admin-review-item").first().getByRole("button", { name: "تەستىقلاش" }).click();
  await expect(page.locator("#bookReviewModerationStatus")).toContainText("AAL2");
  await expect(page.locator(".admin-review-item")).toHaveCount(0);
  expect(await page.evaluate((id) => window.__reviewWrites.filter((row) => row.args && row.args.review_id === id).length, thirdId)).toBe(1);
  await page.evaluate(() => { window.__armSessionAfterWrite(""); window.__sub = "admin-1"; window.__aal = "aal2"; });
  await page.locator(".admin-review-filters button[data-review-status='pending']").click();
  await expect(page.locator(".admin-reply-item").first()).toHaveAttribute("data-reply-id", replyId);

  await page.evaluate(() => { window.__armSessionAfterWrite("throw"); });
  await page.locator(".admin-reply-item").first().getByRole("button", { name: "تەستىقلاش" }).click();
  await expect(page.locator("#bookReviewReplyStatus")).toHaveText("جاۋاب تەستىقلاندى، لېكىن تىزىملىك يېڭىلانمىدى.");
  await expect(page.locator("#bookReviewModerationStatus")).not.toHaveText("بۇ مەشغۇلاتقا ئىجازەت يوق.");
  const replyWrites = await page.evaluate(() => window.__reviewWrites.filter((row) => row.name === "moderate_book_review_reply").length);
  expect(replyWrites).toBe(1);
  await page.locator(".admin-reply-item").first().getByRole("button", { name: "تەستىقلاش" }).click({ force: true }).catch(() => {});
  expect(await page.evaluate(() => window.__reviewWrites.filter((row) => row.name === "moderate_book_review_reply").length)).toBe(1);
  await page.evaluate(() => { window.__armSessionAfterWrite(""); });
  await page.locator("#bookReviewReplyRetry").click();
  await expect(page.locator(".admin-reply-item[data-reply-id='" + replyId + "']")).toHaveCount(0);
  expect(await page.evaluate(() => window.__reviewWrites.filter((row) => row.name === "moderate_book_review_reply").length)).toBe(1);

  page.once("dialog", (dialog) => dialog.accept());
  await page.evaluate(() => {
    window.__writeError = { message: "lost", code: "08006" };
    window.__replyExists = null;
    window.__armSessionAfterWrite("throw");
  });
  await page.locator(".admin-reply-item").first().getByRole("button", { name: "ئۆچۈرۈش" }).click();
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("ئۆچۈرۈش نەتىجىسى ئېنىق ئەمەس. قايتا سىناڭ.");
  await expect(page.locator("#bookReviewReplyStatus")).not.toHaveText("جاۋاب ئۆچۈرۈلدى. تىزىملىك يېڭىلانمىدى.");
  await expect(page.locator(".admin-reply-item").first().getByRole("button", { name: "ئۆچۈرۈش" })).toBeEnabled();

  await page.evaluate(() => {
    window.__writeError = null;
    window.__armSessionAfterWrite("throw");
  });
  page.once("dialog", (dialog) => dialog.accept());
  const replyDeleteId = await page.locator(".admin-reply-item").first().getAttribute("data-reply-id");
  const replyDeletesBefore = await page.evaluate((id) => window.__reviewWrites.filter((row) => row.name === "delete_book_review_reply" && row.args && row.args.p_reply_id === id).length, replyDeleteId);
  await page.locator(".admin-reply-item").first().getByRole("button", { name: "ئۆچۈرۈش" }).click();
  await expect(page.locator("#bookReviewReplyStatus")).toHaveText("جاۋاب ئۆچۈرۈلدى. تىزىملىك يېڭىلانمىدى.");
  expect(await page.evaluate((id) => window.__reviewWrites.filter((row) => row.name === "delete_book_review_reply" && row.args && row.args.p_reply_id === id).length, replyDeleteId)).toBe(replyDeletesBefore + 1);
  await page.locator(".admin-reply-item").first().getByRole("button", { name: "ئۆچۈرۈش" }).click({ force: true }).catch(() => {});
  expect(await page.evaluate((id) => window.__reviewWrites.filter((row) => row.name === "delete_book_review_reply" && row.args && row.args.p_reply_id === id).length, replyDeleteId)).toBe(replyDeletesBefore + 1);
  await page.evaluate(() => { window.__armSessionAfterWrite(""); });
  await page.locator("#bookReviewReplyRetry").click();
  await expect(page.locator(".admin-reply-item[data-reply-id='" + replyDeleteId + "']")).toHaveCount(0);

  page.once("dialog", (dialog) => dialog.accept());
  await page.evaluate(() => { window.__armSessionAfterWrite("throw"); });
  const deleteId = await page.locator(".admin-review-item").first().getAttribute("data-review-id");
  await page.locator(".admin-review-item").first().getByRole("button", { name: "ئۆچۈرۈش" }).click();
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("ئىنكاس ئۆچۈرۈلدى. تىزىملىك يېڭىلانمىدى.");
  await expect(page.locator("#bookReviewModerationStatus")).not.toHaveText("ئۆچۈرۈش نەتىجىسى ئېنىق ئەمەس. قايتا سىناڭ.");
  await expect(page.locator("#bookReviewModerationStatus")).not.toHaveText("بۇ مەشغۇلاتقا ئىجازەت يوق.");
  expect(await page.evaluate((id) => window.__reviewWrites.filter((row) => row.name === "delete_book_review" && row.args && row.args.p_review_id === id).length, deleteId)).toBe(1);
  await page.locator(".admin-review-item").first().getByRole("button", { name: "ئۆچۈرۈش" }).click({ force: true }).catch(() => {});
  expect(await page.evaluate((id) => window.__reviewWrites.filter((row) => row.name === "delete_book_review" && row.args && row.args.p_review_id === id).length, deleteId)).toBe(1);
  await page.evaluate(() => { window.__armSessionAfterWrite(""); });
  await page.locator("#bookReviewRetry").click();
  await expect(page.locator(".admin-review-item[data-review-id='" + deleteId + "']")).toHaveCount(0);
  expect(await page.evaluate((id) => window.__reviewWrites.filter((row) => row.name === "delete_book_review" && row.args && row.args.p_review_id === id).length, deleteId)).toBe(1);

  for (const viewport of [
    { width: 390, height: 800 },
    { width: 1280, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("#bookReviewReplyStatus")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  }
});

async function showReviewSurface(page) {
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
}

test("a superseded refresh keeps the confirmed review protected", async ({ page }) => {
  await installReviewPages(page, { reviews: rows(4, "باھا", "pending"), replies: rows(3, "جاۋاب", "pending") });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin.html#reviews", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const reviewId = await page.locator(".admin-review-item").first().getAttribute("data-review-id");
  await page.evaluate(() => { window.__reviewHold = true; });
  await page.locator(".admin-review-item").first().getByRole("button", { name: "تەستىقلاش" }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseReviewRead === "function")).toBe(true);
  await page.evaluate(() => { window.__reviewReadFail = true; });
  await showReviewSurface(page);
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("ئىنكاس تەستىقلاندى، لېكىن تىزىملىك يېڭىلانمىدى.");
  await page.evaluate(() => window.__releaseReviewRead());
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("ئىنكاس تەستىقلاندى، لېكىن تىزىملىك يېڭىلانمىدى.");
  await expect(page.locator("#bookReviewModerationStatus")).not.toHaveText("بۇ مەشغۇلاتقا ئىجازەت يوق.");
  await expect(page.locator(".admin-review-item").first()).toHaveAttribute("data-review-id", reviewId);
  await expect(page.locator(".admin-review-item").first().getByRole("button", { name: "تەستىقلاش" })).toBeDisabled();
  await page.locator(".admin-review-item").first().getByRole("button", { name: "تەستىقلاش" }).click({ force: true }).catch(() => {});
  expect(await page.evaluate(() => window.__reviewWrites.filter((row) => row.name === "moderate_book_review").length)).toBe(1);
  await page.evaluate(() => { window.__reviewReadFail = false; });
  const beforeRetry = (await pageReads(page, "admin_book_review_page")).length;
  await page.locator("#bookReviewRetry").click();
  expect((await pageReads(page, "admin_book_review_page")).slice(beforeRetry)).toEqual([{ status: "pending", query: "", page: 0 }]);
  await expect(page.locator(".admin-review-item[data-review-id='" + reviewId + "']")).toHaveCount(0);
  expect(await page.evaluate(() => window.__reviewWrites.filter((row) => row.name === "moderate_book_review").length)).toBe(1);

  const replyId = await page.locator(".admin-reply-item").first().getAttribute("data-reply-id");
  await page.evaluate(() => { window.__replyHold = true; });
  await page.locator(".admin-reply-item").first().getByRole("button", { name: "رەت قىلىش" }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseReplyRead === "function")).toBe(true);
  await page.evaluate(() => { window.__replyReadError = true; });
  await showReviewSurface(page);
  await expect(page.locator("#bookReviewReplyStatus")).toHaveText("جاۋاب رەت قىلىندى، لېكىن تىزىملىك يېڭىلانمىدى.");
  await page.evaluate(() => window.__releaseReplyRead());
  await expect(page.locator("#bookReviewReplyStatus")).toHaveText("جاۋاب رەت قىلىندى، لېكىن تىزىملىك يېڭىلانمىدى.");
  await expect(page.locator(".admin-reply-item").first().getByRole("button", { name: "رەت قىلىش" })).toBeDisabled();
  await page.locator(".admin-reply-item").first().getByRole("button", { name: "رەت قىلىش" }).click({ force: true }).catch(() => {});
  expect(await page.evaluate((id) => window.__reviewWrites.filter((row) => row.name === "moderate_book_review_reply" && row.args && row.args.p_reply_id === id).length, replyId)).toBe(1);

  page.once("dialog", (dialog) => dialog.accept());
  await page.evaluate(() => {
    window.__replyReadError = false;
    window.__reviewHold = true;
    window.__replyHold = true;
  });
  const deleteId = await page.locator(".admin-review-item").first().getAttribute("data-review-id");
  await page.locator(".admin-review-item").first().getByRole("button", { name: "ئۆچۈرۈش" }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseReviewRead === "function" && typeof window.__releaseReplyRead === "function")).toBe(true);
  await page.evaluate(() => { window.__reviewReadError = true; window.__replyReadFail = true; });
  await showReviewSurface(page);
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("ئىنكاس ئۆچۈرۈلدى. تىزىملىك يېڭىلانمىدى.");
  await page.evaluate(() => { window.__releaseReviewRead(); window.__releaseReplyRead(); });
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("ئىنكاس ئۆچۈرۈلدى. تىزىملىك يېڭىلانمىدى.");
  await expect(page.locator("#bookReviewModerationStatus")).not.toHaveText("ئۆچۈرۈش نەتىجىسى ئېنىق ئەمەس. قايتا سىناڭ.");
  await expect(page.locator(".admin-review-item").first().getByRole("button", { name: "ئۆچۈرۈش" })).toBeDisabled();
  await expect(page.locator(".admin-reply-item").first().getByRole("button", { name: "ئۆچۈرۈش" })).toBeDisabled();
  await page.locator(".admin-review-item").first().getByRole("button", { name: "ئۆچۈرۈش" }).click({ force: true }).catch(() => {});
  await page.locator(".admin-reply-item").first().getByRole("button", { name: "ئۆچۈرۈش" }).click({ force: true }).catch(() => {});
  expect(await page.evaluate((id) => window.__reviewWrites.filter((row) => row.name === "delete_book_review" && row.args && row.args.p_review_id === id).length, deleteId)).toBe(1);
  expect(await page.evaluate(() => window.__reviewWrites.filter((row) => row.name === "delete_book_review_reply").length)).toBe(0);

  for (const viewport of [
    { width: 390, height: 800 },
    { width: 768, height: 900 },
    { width: 1280, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator(".admin-review-item").first().getByRole("button", { name: "ئۆچۈرۈش" })).toBeDisabled();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  }
});

test("a retained list cannot mutate or offer a retry that does nothing", async ({ page }) => {
  const reviews = rows(12, "كۈتۈش", "pending").concat(rows(2, "تەستىق", "approved"));
  const replies = rows(12, "جاۋاب", "pending").concat(rows(2, "جاۋاب-تەستىق", "approved"));
  await installReviewPages(page, { reviews: reviews, replies: replies });
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/admin.html#reviews", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".admin-review-item").first().getByRole("button", { name: "تەستىقلاش" })).toBeEnabled();
  await page.evaluate(() => { window.__reviewReadFail = true; window.__replyReadError = true; });
  await page.locator(".admin-review-filters button[data-review-status='approved']").click();
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText(RETAINED_REVIEW);
  await expect(page.locator("#bookReviewReplyStatus")).toHaveText(RETAINED_REPLY);
  await expect(page.locator(".admin-review-body").first()).toContainText("كۈتۈش 1");
  await expect(page.locator(".admin-reply-item").first()).toContainText("جاۋاب 1");
  await expect(page.locator(".admin-review-item").first().getByRole("button", { name: "تەستىقلاش" })).toBeDisabled();
  await expect(page.locator(".admin-review-item").first().getByRole("button", { name: "ئۆچۈرۈش" })).toBeDisabled();
  await expect(page.locator(".admin-reply-item").first().getByRole("button", { name: "تەستىقلاش" })).toBeDisabled();
  await expect(page.locator(".admin-reply-item").first().getByRole("button", { name: "ئۆچۈرۈش" })).toBeDisabled();
  const writesBefore = await page.evaluate(() => window.__reviewWrites.length);
  await page.locator(".admin-review-item").first().getByRole("button", { name: "تەستىقلاش" }).click({ force: true }).catch(() => {});
  await page.locator(".admin-reply-item").first().getByRole("button", { name: "رەت قىلىش" }).click({ force: true }).catch(() => {});
  expect(await page.evaluate(() => window.__reviewWrites.length)).toBe(writesBefore);
  const reviewMark = (await pageReads(page, "admin_book_review_page")).length;
  const replyMark = (await pageReads(page, "admin_book_review_reply_page")).length;
  await page.locator("#bookReviewRetry").click();
  await page.locator("#bookReviewReplyRetry").click();
  expect((await pageReads(page, "admin_book_review_page")).slice(reviewMark)).toEqual([{ status: "approved", query: "", page: 0 }]);
  expect((await pageReads(page, "admin_book_review_reply_page")).slice(replyMark)).toEqual([{ status: "approved", query: "", page: 0 }]);
  expect(await page.evaluate(() => window.__reviewWrites.length)).toBe(writesBefore);

  await page.evaluate(() => { window.__reviewReadFail = false; window.__replyReadError = false; });
  await page.locator(".admin-review-filters button[data-review-status='pending']").click();
  await expect(page.locator(".admin-review-item").first().getByRole("button", { name: "تەستىقلاش" })).toBeEnabled();
  await page.evaluate(() => { window.__reviewReadError = true; });
  await page.locator("#bookReviewSearch").fill("يوقسۆز");
  await expect(page.locator(".admin-review-actions button").first()).toBeDisabled();
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText(RETAINED_REVIEW);
  await expect(page.locator(".admin-review-item").first().getByRole("button", { name: "ئۆچۈرۈش" })).toBeDisabled();
  await page.locator(".admin-review-item").first().getByRole("button", { name: "تەستىقلاش" }).click({ force: true }).catch(() => {});
  expect(await page.evaluate(() => window.__reviewWrites.length)).toBe(writesBefore);
  const searchMark = (await pageReads(page, "admin_book_review_page")).length;
  await page.locator("#bookReviewRetry").click();
  expect((await pageReads(page, "admin_book_review_page")).slice(searchMark)).toEqual([{ status: "pending", query: "يوقسۆز", page: 0 }]);

  await page.evaluate(() => { window.__reviewReadError = false; });
  await page.locator("#bookReviewSearch").fill("");
  await expect(page.locator(".admin-reply-item").first().getByRole("button", { name: "ئۆچۈرۈش" })).toBeEnabled();
  await page.evaluate(() => { window.__replyReadFail = true; });
  await page.locator("#bookReviewSearch").fill("باشقا");
  await expect(page.locator("#bookReviewReplyStatus")).toHaveText(RETAINED_REPLY);
  await expect(page.locator(".admin-reply-item").first().getByRole("button", { name: "ئۆچۈرۈش" })).toBeDisabled();
  const replySearchMark = (await pageReads(page, "admin_book_review_reply_page")).length;
  await page.locator("#bookReviewReplyRetry").click();
  expect((await pageReads(page, "admin_book_review_reply_page")).slice(replySearchMark)).toEqual([{ status: "pending", query: "باشقا", page: 0 }]);
  expect(await page.evaluate(() => window.__reviewWrites.length)).toBe(writesBefore);

  await page.evaluate(() => { window.__replyReadFail = false; });
  await page.locator("#bookReviewSearch").fill("");
  await expect(page.locator(".admin-review-item").first().getByRole("button", { name: "تەستىقلاش" })).toBeEnabled();
  const reviewId = await page.locator(".admin-review-item").first().getAttribute("data-review-id");
  await page.evaluate(() => { window.__armSessionAfterWrite("throw"); });
  await page.locator(".admin-review-item").first().getByRole("button", { name: "تەستىقلاش" }).click();
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("ئىنكاس تەستىقلاندى، لېكىن تىزىملىك يېڭىلانمىدى.");
  await expect(page.locator(".admin-review-item").first().getByRole("button", { name: "تەستىقلاش" })).toBeDisabled();
  await page.locator(".admin-review-item").first().getByRole("button", { name: "تەستىقلاش" }).click({ force: true }).catch(() => {});
  expect(await page.evaluate((id) => window.__reviewWrites.filter((row) => row.name === "moderate_book_review" && row.args && row.args.review_id === id).length, reviewId)).toBe(1);
  await page.evaluate(() => { window.__armSessionAfterWrite(""); });
  await page.locator("#bookReviewRetry").click();
  await expect(page.locator(".admin-review-item[data-review-id='" + reviewId + "']")).toHaveCount(0);
  expect(await page.evaluate((id) => window.__reviewWrites.filter((row) => row.name === "moderate_book_review" && row.args && row.args.review_id === id).length, reviewId)).toBe(1);

  await page.evaluate(() => { window.__reviewHold = true; });
  await page.locator("#bookReviewSearch").fill("ك");
  await expect(page.locator(".admin-review-actions button").first()).toBeDisabled();
  await expect(page.locator(".admin-reply-actions button").first()).toBeDisabled();
  await page.evaluate(() => { if (window.__releaseReviewRead) window.__releaseReviewRead(); });
});

const REVIEW_EMPTY = "بۇ ھالەتتە ئىنكاس يوق.";
const REPLY_EMPTY = "بۇ ھالەتتە جاۋاب يوق.";
const REVIEW_SEARCH_EMPTY = "بۇ ئىزدەشكە ماس ئىنكاس تېپىلمىدى.";
const REPLY_SEARCH_EMPTY = "بۇ ئىزدەشكە ماس جاۋاب تېپىلمىدى.";

test("each empty review sentence is announced once", async ({ page }) => {
  await installReviewPages(page, { reviews: rows(1, "باھا", "pending"), replies: rows(1, "جاۋاب", "pending") });
  await page.goto("/admin.html#reviews", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".admin-review-item")).toHaveCount(1);
  await expect(page.locator(".admin-reply-item")).toHaveCount(1);
  for (const viewport of [
    { width: 390, height: 800 },
    { width: 768, height: 900 },
    { width: 1280, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByText(REVIEW_EMPTY, { exact: true })).toHaveCount(0);
    await expect(page.getByText(REPLY_EMPTY, { exact: true })).toHaveCount(0);
    await expect(page.getByText(REVIEW_SEARCH_EMPTY, { exact: true })).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  }

  await page.locator("#bookReviewSearch").fill("يوقسۆز");
  await expect(page.locator("#bookReviewModerationStatus")).toHaveAttribute("role", "status");
  await expect(page.locator("#bookReviewReplyStatus")).toHaveAttribute("role", "status");
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText(REVIEW_SEARCH_EMPTY);
  await expect(page.locator("#bookReviewReplyStatus")).toHaveText(REPLY_SEARCH_EMPTY);
  await expect(page.getByText(REVIEW_SEARCH_EMPTY, { exact: true })).toHaveCount(1);
  await expect(page.getByText(REPLY_SEARCH_EMPTY, { exact: true })).toHaveCount(1);
  await expect(page.locator("#bookReviewModerationList > p.admin-help")).toHaveCount(0);
  await expect(page.locator("#bookReviewReplyList > p.admin-help")).toHaveCount(0);
  await expect(page.locator("#bookReviewModerationList .admin-review-total")).toHaveText("جەمئىي 0 ئىنكاس");
  await expect(page.locator("#bookReviewReplyList .admin-review-total")).toHaveText("جەمئىي 0 جاۋاب");
  await expect(page.locator("#bookReviewModerationList").getByRole("button", { name: "ئالدىنقى بەت" })).toBeDisabled();
  await expect(page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" })).toBeDisabled();
  await expect(page.locator("#bookReviewReplyList").getByRole("button", { name: "ئالدىنقى بەت" })).toBeDisabled();
  await expect(page.locator("#bookReviewReplyList").getByRole("button", { name: "كېيىنكى بەت" })).toBeDisabled();

  await page.evaluate(() => { window.__reviewReadError = true; window.__replyReadError = true; });
  await page.locator("#bookReviewSearch").fill("");
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("ئىنكاسلار يۈكلەنمىدى. كۆرۈنۈپ تۇرغان تىزىملىك ئالدىنقى نەتىجە.");
  await expect(page.locator("#bookReviewReplyStatus")).toHaveText("جاۋابلار يۈكلەنمىدى. كۆرۈنۈپ تۇرغان تىزىملىك ئالدىنقى نەتىجە.");
  await expect(page.getByText(REVIEW_EMPTY, { exact: true })).toHaveCount(0);
  await expect(page.getByText(REVIEW_SEARCH_EMPTY, { exact: true })).toHaveCount(0);
  await expect(page.locator("#bookReviewModerationList .admin-review-total")).toHaveText("جەمئىي 0 ئىنكاس");
  await expect(page.locator("#bookReviewRetry")).toBeEnabled();
  await page.evaluate(() => { window.__reviewReadError = false; window.__replyReadError = false; });
  await page.locator("#bookReviewRetry").click();
  await expect(page.locator(".admin-review-item")).toHaveCount(1);
  await expect(page.getByText(REVIEW_EMPTY, { exact: true })).toHaveCount(0);
  await page.evaluate(() => { window.__reviewReadError = true; });
  await page.locator(".admin-review-filters button[data-review-status='pending']").click();
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("ئىنكاسلار يۈكلەنمىدى.");
  await expect(page.getByText(REVIEW_EMPTY, { exact: true })).toHaveCount(0);
  await expect(page.locator(".admin-review-item")).toHaveCount(1);
  await page.evaluate(() => { window.__reviewReadError = false; });
  await page.locator(".admin-review-filters button[data-review-status='pending']").click();
  await expect(page.locator(".admin-review-item")).toHaveCount(1);

  await page.evaluate(() => { window.__reviewReadError = true; window.__replyReadError = true; });
  await page.locator(".admin-review-filters button[data-review-status='rejected']").click();
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("ئىنكاسلار يۈكلەنمىدى. كۆرۈنۈپ تۇرغان تىزىملىك ئالدىنقى نەتىجە.");
  await expect(page.locator("#bookReviewReplyStatus")).toHaveText("جاۋابلار يۈكلەنمىدى. كۆرۈنۈپ تۇرغان تىزىملىك ئالدىنقى نەتىجە.");
  await expect(page.getByText(REVIEW_EMPTY, { exact: true })).toHaveCount(0);
  await expect(page.getByText(REPLY_EMPTY, { exact: true })).toHaveCount(0);
  await expect(page.locator(".admin-review-item")).toHaveCount(1);
  await expect(page.locator(".admin-review-item").getByRole("button", { name: "تەستىقلاش" })).toBeDisabled();
  await expect(page.locator(".admin-reply-item").getByRole("button", { name: "ئۆچۈرۈش" })).toBeDisabled();
  await expect(page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" })).toBeDisabled();
  await page.evaluate(() => { window.__reviewReadError = false; window.__replyReadError = false; });
  await page.locator(".admin-review-filters button[data-review-status='pending']").click();
  await expect(page.locator(".admin-review-item").getByRole("button", { name: "تەستىقلاش" })).toBeEnabled();

  await page.locator(".admin-review-filters button[data-review-status='approved']").click();
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText(REVIEW_EMPTY);
  await expect(page.locator("#bookReviewReplyStatus")).toHaveText(REPLY_EMPTY);
  await expect(page.getByText(REVIEW_EMPTY, { exact: true })).toHaveCount(1);
  await expect(page.getByText(REPLY_EMPTY, { exact: true })).toHaveCount(1);
  await expect(page.locator("#bookReviewModerationList > p.admin-help")).toHaveCount(0);
  await expect(page.locator("#bookReviewReplyList > p.admin-help")).toHaveCount(0);
  await expect(page.locator("#bookReviewModerationList .admin-review-total")).toHaveText("جەمئىي 0 ئىنكاس");
  await expect(page.locator("#bookReviewModerationList").getByRole("button", { name: "ئالدىنقى بەت" })).toBeDisabled();
  await expect(page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" })).toBeDisabled();

  await page.locator(".admin-review-filters button[data-review-status='pending']").click();
  await expect(page.locator(".admin-review-item")).toHaveCount(1);
  await page.evaluate(() => { window.__armSessionAfterWrite("throw"); });
  await page.locator(".admin-review-item").first().getByRole("button", { name: "تەستىقلاش" }).click();
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("ئىنكاس تەستىقلاندى، لېكىن تىزىملىك يېڭىلانمىدى.");
  await expect(page.getByText(REVIEW_EMPTY, { exact: true })).toHaveCount(0);
  await expect(page.locator("#bookReviewRetry")).toBeEnabled();
  await expect(page.locator(".admin-review-item").first().getByRole("button", { name: "تەستىقلاش" })).toBeDisabled();
  await expect(page.locator(".admin-review-item").first().getByRole("button", { name: "ئۆچۈرۈش" })).toBeDisabled();
  const writes = await page.evaluate(() => window.__reviewWrites.filter((row) => row.name === "moderate_book_review").length);
  await page.locator(".admin-review-item").first().getByRole("button", { name: "تەستىقلاش" }).click({ force: true }).catch(() => {});
  expect(await page.evaluate(() => window.__reviewWrites.filter((row) => row.name === "moderate_book_review").length)).toBe(writes);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".admin-review-item")).toHaveCount(1);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".admin-review-item").first().getByRole("button", { name: "ئۆچۈرۈش" }).click();
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("ئىنكاس ئۆچۈرۈلدى.");
  await expect(page.getByText(REVIEW_EMPTY, { exact: true })).toHaveCount(1);
  await expect(page.locator("#bookReviewModerationList > p.admin-help")).toHaveText(REVIEW_EMPTY);
  await expect(page.locator("#bookReviewModerationList .admin-review-total")).toHaveText("جەمئىي 0 ئىنكاس");
  await expect(page.locator("#bookReviewModerationList").getByRole("button", { name: "ئالدىنقى بەت" })).toBeDisabled();
  await expect(page.locator("#bookReviewModerationList").getByRole("button", { name: "كېيىنكى بەت" })).toBeDisabled();
  await expect(page.locator(".admin-review-item")).toHaveCount(0);
  await expect(page.locator(".admin-reply-item")).toHaveCount(1);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".admin-reply-item").first().getByRole("button", { name: "ئۆچۈرۈش" }).click();
  await expect(page.locator("#bookReviewReplyStatus")).toHaveText("جاۋاب ئۆچۈرۈلدى.");
  await expect(page.getByText(REPLY_EMPTY, { exact: true })).toHaveCount(1);
  await expect(page.locator("#bookReviewReplyList > p.admin-help")).toHaveText(REPLY_EMPTY);
  await expect(page.locator("#bookReviewReplyList .admin-review-total")).toHaveText("جەمئىي 0 جاۋاب");
  await expect(page.locator("#bookReviewReplyList").getByRole("button", { name: "ئالدىنقى بەت" })).toBeDisabled();
  await expect(page.locator("#bookReviewReplyList").getByRole("button", { name: "كېيىنكى بەت" })).toBeDisabled();
  await expect(page.locator("#bookReviewModerationStatus")).toHaveText("ئىنكاس ئۆچۈرۈلدى.");
});
