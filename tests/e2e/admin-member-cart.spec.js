const { test, expect } = require("./playwright-test");

const MEMBER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBER_EMPTY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ADMIN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function paddedRows(count) {
  const rows = [];
  for (let i = 1; i <= count; i += 1) {
    rows.push({ book_id: "p" + String(i).padStart(4, "0"), quantity: (i % 9) + 1, title: "بەت " + String(i) });
  }
  return rows;
}

async function installAdmin(page, carts) {
  await page.addInitScript(({ members, carts: stored, adminId }) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguAdminPreviewMembers = members;
    window.__memberCartCalls = [];
    window.__memberCartWrites = [];
    window.__memberCarts = stored;
    window.__memberCartFrozen = JSON.stringify(stored);
    window.__memberCartSession = { aal: "aal2", userId: adminId };
    window.__memberCartHold = "";
    window.__memberCartReleaseGeneration = 0;
    window.__memberCartFail = false;
    window.__memberCartReject = false;
    window.__memberCartFailPage = false;
    window.__kutadguMemberCartAdminClient = {
      auth: {
        getSession: async () => {
          const mode = window.__memberCartSession;
          if (!mode) return { data: { session: null }, error: null };
          const payload = btoa(JSON.stringify({ aal: mode.aal || "" })).replace(/=+$/g, "");
          return {
            data: { session: { access_token: "e30." + payload + ".sig", user: { id: mode.userId || "" } } },
            error: null
          };
        }
      },
      rpc(name, args) {
        window.__memberCartCalls.push({ name: name, user: args && args.p_user_id, after: args && args.p_after_book_id });
        if (name !== "admin_member_cart_page") return Promise.resolve({ data: null, error: { message: "unexpected rpc" } });
        if (window.__memberCartReject) return Promise.reject(new Error("rejected"));
        if (window.__memberCartHold && args && args.p_user_id === window.__memberCartHold && !args.p_after_book_id) {
          window.__memberCartReleaseGeneration += 1;
          return new Promise((resolve) => { window.__releaseMemberCart = () => resolve(window.__memberCartPage(args)); });
        }
        return Promise.resolve(window.__memberCartPage(args));
      },
      from() {
        window.__memberCartWrites.push("from");
        throw new Error("cart table write");
      }
    };
    window.__memberCartPage = (args) => {
      if (window.__memberCartFail) return { data: null, error: { message: "permission denied", code: "42501" } };
      if (window.__memberCartFailPage && args && args.p_after_book_id) return { data: null, error: { message: "page failed" } };
      const rows = (window.__memberCarts[args.p_user_id] || []).slice();
      const after = args.p_after_book_id ? String(args.p_after_book_id) : "";
      const start = after ? rows.findIndex((row) => String(row.book_id) === after) + 1 : 0;
      const page = rows.slice(start, start + 100).map((row) => ({ book_id: row.book_id, quantity: row.quantity, title: row.title }));
      return { data: page, error: null };
    };
    window.__kutadguBookReviewAdminClient = {
      auth: { getSession: async () => window.__kutadguMemberCartAdminClient.auth.getSession() },
      rpc(name) {
        if (name === "admin_approval_counts") return Promise.resolve({ data: { submissions: 1, reviews: 0, replies: 0 }, error: null });
        if (name === "admin_list_book_reviews" || name === "admin_list_book_review_replies") return Promise.resolve({ data: [], error: null });
        return Promise.resolve({ data: null, error: null });
      }
    };
  }, {
    adminId: ADMIN,
    members: [
      { id: MEMBER_A, full_name: "ئەزا ئالف", email: "a@example.com", phone: "111", country: "تۈركىيە", city: "ئىستانبۇل", status: "active" },
      { id: MEMBER_B, full_name: "ئەزا بې", email: "b@example.com", phone: "222", country: "تۈركىيە", city: "ئانكارا", status: "active" },
      { id: MEMBER_EMPTY, full_name: "ئەزا بوش", email: "c@example.com", phone: "333", status: "active" }
    ],
    carts: carts
  });
}

async function openCustomers(page) {
  await page.goto("/admin.html#customers", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#memberManagement")).toBeVisible();
  await expect(page.getByRole("button", { name: "سېۋەتنى كۆرۈش" })).toHaveCount(3);
  await expect(page.locator("[data-member-status]")).toHaveCount(3);
}

function cartButton(page, memberId) {
  return page.locator(`[data-member-cart="${memberId}"]`);
}

test("saved carts stay distinct across members, errors, and retry", async ({ page }) => {
  await installAdmin(page, {
    [MEMBER_A]: [
      { book_id: "10", quantity: 2, title: "كۇتادغۇ بىلىگ" },
      { book_id: "11", quantity: 1, title: null },
      { book_id: "12", quantity: 4, title: "   " }
    ],
    [MEMBER_B]: [{ book_id: "20", quantity: 7, title: "باشقا كىتاب" }],
    [MEMBER_EMPTY]: []
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCustomers(page);
  await cartButton(page, MEMBER_A).click();
  const dialog = page.locator("#memberCartPanel");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#memberCartIdentity")).toContainText("ئەزا ئالف");
  await expect(page.locator("#memberCartIdentity")).toContainText("a@example.com");
  await expect(page.locator("#memberCartIdentity")).toContainText("111");
  await expect(dialog.getByText("كۇتادغۇ بىلىگ")).toBeVisible();
  await expect(dialog.getByText("سانى: 2")).toBeVisible();
  await expect(dialog.getByText("كىتاب ئۇچۇرى يوق")).toHaveCount(2);
  await expect(dialog.getByText("سانى: 1")).toBeVisible();
  await expect(dialog.getByText("سانى: 4")).toBeVisible();
  await expect(dialog).not.toContainText("باشقا كىتاب");
  await expect(dialog).not.toContainText("سېۋەتتە كىتاب يوق.");

  await cartButton(page, MEMBER_B).click();
  await expect(page.locator("#memberCartIdentity")).toContainText("ئەزا بې");
  await expect(dialog.getByText("باشقا كىتاب")).toBeVisible();
  await expect(dialog.getByText("سانى: 7")).toBeVisible();
  await expect(dialog).not.toContainText("كۇتادغۇ بىلىگ");

  await cartButton(page, MEMBER_EMPTY).click();
  await expect(page.locator("#memberCartBody")).toHaveAttribute("data-member-cart-state", "empty");
  await expect(dialog.getByText("سېۋەتتە كىتاب يوق.")).toBeVisible();
  await expect(dialog).not.toContainText("كۇتادغۇ بىلىگ");
  await expect(dialog).not.toContainText("باشقا كىتاب");

  await page.evaluate(() => { window.__memberCartFail = true; });
  await cartButton(page, MEMBER_A).click();
  await expect(dialog.getByText("سېۋەتنى ئوقۇش مەغلۇپ بولدى.")).toBeVisible();
  await expect(dialog).not.toContainText("سېۋەتتە كىتاب يوق.");
  await expect(dialog).not.toContainText("كۇتادغۇ بىلىگ");
  await page.evaluate(() => { window.__memberCartReject = true; window.__memberCartFail = false; });
  await dialog.getByRole("button", { name: "قايتا سىناش" }).click();
  await expect(dialog.getByText("سېۋەتنى ئوقۇش مەغلۇپ بولدى.")).toBeVisible();
  await expect(dialog).not.toContainText("سېۋەتتە كىتاب يوق.");
  await page.evaluate(() => { window.__memberCartReject = false; });
  await dialog.getByRole("button", { name: "قايتا سىناش" }).click();
  await expect(dialog.getByText("كۇتادغۇ بىلىگ")).toBeVisible();
  await expect(page.locator("#memberCartIdentity")).toContainText("ئەزا ئالف");
  const unchanged = await page.evaluate(() => window.__memberCartFrozen === JSON.stringify(window.__memberCarts) && window.__memberCartWrites.length === 0 && window.__memberCartCalls.every((call) => call.name === "admin_member_cart_page"));
  expect(unchanged).toBe(true);
});

test("stale reads, closing, logout, session loss, and idle lock drop private rows", async ({ page }) => {
  await installAdmin(page, {
    [MEMBER_A]: [{ book_id: "10", quantity: 2, title: "كۇتادغۇ بىلىگ" }],
    [MEMBER_B]: [{ book_id: "20", quantity: 7, title: "باشقا كىتاب" }],
    [MEMBER_EMPTY]: []
  });
  await openCustomers(page);
  const releaseGeneration = await page.evaluate(() => window.__memberCartReleaseGeneration || 0);
  await page.evaluate((id) => { window.__memberCartHold = id; }, MEMBER_A);
  await cartButton(page, MEMBER_A).click();
  await expect.poll(() => page.evaluate((generation) => window.__memberCartReleaseGeneration > generation, releaseGeneration)).toBe(true);
  await cartButton(page, MEMBER_B).click();
  await expect(page.locator("#memberCartPanel").getByText("باشقا كىتاب")).toBeVisible();
  await page.evaluate(() => window.__releaseMemberCart());
  await expect(page.locator("#memberCartPanel")).toContainText("باشقا كىتاب");
  await expect(page.locator("#memberCartPanel")).not.toContainText("كۇتادغۇ بىلىگ");

  await page.locator("#closeMemberCart").click();
  await expect(page.locator("#memberCartPanel")).toBeHidden();
  await expect(page.locator("#memberCartBody")).toBeEmpty();
  await expect(page.locator("#memberCartIdentity")).toHaveText("");
  await page.evaluate(() => { window.__memberCartFail = true; window.__memberCartHold = ""; });
  await cartButton(page, MEMBER_A).click();
  await expect(page.locator("#memberCartPanel").getByText("سېۋەتنى ئوقۇش مەغلۇپ بولدى.")).toBeVisible();
  await expect(page.locator("#memberCartPanel")).not.toContainText("كۇتادغۇ بىلىگ");
  await page.evaluate(() => { window.__memberCartFail = false; });
  await page.locator("#memberCartPanel").getByRole("button", { name: "قايتا سىناش" }).click();
  await expect(page.locator("#memberCartPanel").getByText("كۇتادغۇ بىلىگ")).toBeVisible();

  await page.evaluate(() => document.querySelector("#adminLogout").click());
  await expect(page.locator("#memberCartPanel")).toBeHidden();
  await expect(page.locator("#memberCartBody")).toBeEmpty();

  await cartButton(page, MEMBER_A).click();
  await expect(page.locator("#memberCartPanel").getByText("كۇتادغۇ بىلىگ")).toBeVisible();
  await page.evaluate(() => {
    document.querySelector("#dashboardPanel").hidden = true;
  });
  await expect(page.locator("#memberCartPanel")).toBeHidden();
  await expect(page.locator("#memberCartBody")).toBeEmpty();
  await page.evaluate(() => { document.querySelector("#dashboardPanel").hidden = false; });

  const sessionReleaseGeneration = await page.evaluate(() => window.__memberCartReleaseGeneration || 0);
  await page.evaluate((id) => { window.__memberCartHold = id; }, MEMBER_A);
  await cartButton(page, MEMBER_A).click();
  await expect.poll(() => page.evaluate((generation) => window.__memberCartReleaseGeneration > generation, sessionReleaseGeneration)).toBe(true);
  await page.evaluate(() => { window.__memberCartSession = null; });
  await page.evaluate(() => window.__releaseMemberCart());
  await expect(page.locator("#memberCartPanel")).toBeHidden();
  await expect(page.locator("#memberCartBody")).not.toContainText("كۇتادغۇ بىلىگ");

  await page.evaluate((adminId) => { window.__memberCartSession = { aal: "aal2", userId: adminId }; window.__memberCartHold = ""; }, ADMIN);
  await cartButton(page, MEMBER_A).click();
  await expect(page.locator("#memberCartPanel").getByText("كۇتادغۇ بىلىگ")).toBeVisible();
  await page.evaluate(() => { document.querySelector("#idleLockPanel").hidden = false; });
  await expect(page.locator("#memberCartPanel")).toBeHidden();
  await expect(page.locator("#memberCartBody")).toBeEmpty();
  const stored = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
  expect(stored).not.toContain("كۇتادغۇ بىلىگ");
  expect(stored).not.toContain(MEMBER_A);
});

test("cart pages continue until a short page and a failed refresh keeps the same member", async ({ page }) => {
  const many = paddedRows(101);
  await installAdmin(page, {
    [MEMBER_A]: many,
    [MEMBER_B]: [{ book_id: "20", quantity: 3, title: "باشقا كىتاب" }],
    [MEMBER_EMPTY]: []
  });
  await openCustomers(page);
  await page.evaluate(() => { window.__memberCartFailPage = true; });
  await cartButton(page, MEMBER_A).click();
  await expect(page.locator("#memberCartPanel").getByText("سېۋەتنى ئوقۇش مەغلۇپ بولدى.")).toBeVisible();
  await expect(page.locator("#memberCartPanel").locator(".admin-analytics-row")).toHaveCount(0);
  await expect(page.locator("#memberCartPanel")).not.toContainText("سېۋەتتە كىتاب يوق.");
  await page.evaluate(() => { window.__memberCartFailPage = false; });
  await page.locator("#memberCartPanel").getByRole("button", { name: "قايتا سىناش" }).click();
  await expect(page.locator("#memberCartPanel").locator(".admin-analytics-row")).toHaveCount(101);
  await expect(page.locator("#memberCartPanel").getByText("بەت 1", { exact: true })).toBeVisible();
  await expect(page.locator("#memberCartPanel").getByText("بەت 101", { exact: true })).toBeVisible();
  const pages = await page.evaluate(() => window.__memberCartCalls.filter((call) => call.user === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" && !call.after).length);
  expect(pages).toBeGreaterThan(0);
  const continued = await page.evaluate(() => window.__memberCartCalls.some((call) => call.after === "p0100"));
  expect(continued).toBe(true);

  await page.evaluate(() => { window.__memberCartFailPage = true; });
  await cartButton(page, MEMBER_A).click();
  await expect(page.locator("#memberCartPanel").getByText("يېڭىلاش مەغلۇپ بولدى.")).toBeVisible();
  await expect(page.locator("#memberCartPanel").getByText("ئالدىنقى كۆرۈنۈش ساقلىنىۋاتىدۇ.")).toBeVisible();
  await expect(page.locator("#memberCartPanel").locator(".admin-analytics-row")).toHaveCount(101);
  await expect(page.locator("#memberCartIdentity")).toContainText("ئەزا ئالف");
  await expect(page.locator("#memberCartPanel")).not.toContainText("باشقا كىتاب");
  await expect(page.locator("#memberCartPanel")).not.toContainText("سېۋەتتە كىتاب يوق.");

  await page.evaluate(() => { window.__memberCartFail = true; window.__memberCartFailPage = false; });
  await cartButton(page, MEMBER_B).click();
  await expect(page.locator("#memberCartPanel")).not.toContainText("بەت 1");
  await expect(page.locator("#memberCartPanel").getByText("سېۋەتنى ئوقۇش مەغلۇپ بولدى.")).toBeVisible();
  await page.evaluate(() => { window.__memberCartFail = false; });
  await page.locator("#memberCartPanel").getByRole("button", { name: "قايتا سىناش" }).click();
  await expect(page.locator("#memberCartPanel").getByText("باشقا كىتاب")).toBeVisible();
  await expect(page.locator("#memberCartPanel").locator(".admin-analytics-row")).toHaveCount(1);
});

test("phone and desktop layouts keep the members section and the approval bell", async ({ page }) => {
  await installAdmin(page, {
    [MEMBER_A]: [{ book_id: "10", quantity: 2, title: "كۇتادغۇ بىلىگ" }],
    [MEMBER_B]: [{ book_id: "20", quantity: 7, title: "باشقا كىتاب" }],
    [MEMBER_EMPTY]: []
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCustomers(page);
  const bell = page.locator(".admin-approval-bell-button");
  await expect(bell).toBeVisible();
  await bell.click();
  await expect(page.locator(".admin-approval-panel").getByRole("button", { name: "كىتاب تەستىقى 1" })).toBeVisible();
  await page.locator(".admin-approval-panel").getByRole("button", { name: "كىتاب تەستىقى 1" }).click();
  await expect(page.locator("[data-admin-section-panel='submissions']")).toBeVisible();
  await page.locator('[data-admin-section="customers"]').click();
  await expect(page.locator("#memberManagement")).toBeVisible();
  await expect(page.locator("[data-member-status]").first()).toBeVisible();
  await cartButton(page, MEMBER_A).click();
  await expect(page.locator("#memberCartPanel").getByText("كۇتادغۇ بىلىگ")).toBeVisible();
  await page.evaluate(() => document.body.classList.add("dark-mode"));
  await page.emulateMedia({ colorScheme: "dark" });
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.locator("#memberCartPanel").getByText("سانى: 2")).toBeVisible();
  const colors = await page.locator("#memberCartPanel").evaluate((el) => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, dir: document.documentElement.dir };
  });
  expect(colors.dir).toBe("rtl");
  expect(colors.background).toBe("rgb(255, 253, 248)");
  overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
  await page.evaluate(() => { window.__memberCartSession = { aal: "aal1", userId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }; });
  await cartButton(page, MEMBER_B).click();
  await expect(page.locator("#memberCartPanel").getByText("2-باسقۇچلۇق دەلىللەش")).toBeVisible();
  await expect(page.locator("#memberCartPanel")).not.toContainText("باشقا كىتاب");
  await expect(page.locator("#memberCartPanel")).not.toContainText("سېۋەتتە كىتاب يوق.");
  const calls = await page.evaluate(() => window.__memberCartCalls.filter((call) => call.user === "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb").length);
  expect(calls).toBe(0);
});
