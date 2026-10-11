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
    window.__aal = "aal2";
    window.__sub = "admin-1";
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguBookReviewAdminClient = {
      auth: {
        getSession: async () => {
          const payload = btoa(JSON.stringify({ aal: window.__aal, sub: window.__sub })).replace(/=+$/g, "");
          return { data: { session: { access_token: "e30." + payload + ".sig" } }, error: null };
        }
      },
      rpc(name, args) {
        window.__reviewCalls.push({ name: name, args: args });
        if (name === "admin_approval_counts") return Promise.resolve({ data: { submissions: 7, reviews: 40, replies: 15 }, error: null });
        if (name === "admin_book_review_page") {
          if (window.__reviewReadFail) return Promise.reject(new Error("reviews failed"));
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
