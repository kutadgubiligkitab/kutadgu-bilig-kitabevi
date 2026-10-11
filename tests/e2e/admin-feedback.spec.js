const { test, expect } = require("@playwright/test");

function stamp(index) {
  return new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString();
}

function rows(count) {
  const list = [];
  for (let n = 1; n <= count; n += 1) {
    list.push({
      id: "12000000-0000-4000-8000-" + String(n).padStart(12, "0"),
      body: n === 1 ? "<img src=x onerror=alert(1)>" : ("پىكىر " + n),
      created_at: stamp(n),
      member_label: n === 2 ? "email-only@example.com" : "ئەزا " + n
    });
  }
  return list;
}

async function installInbox(page) {
  await page.addInitScript(() => {
    function pack(list, args) {
      const sorted = list.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : (a.id < b.id ? 1 : -1)));
      const before = args && args.p_before;
      const beforeId = args && args.p_before_id;
      let bounded = sorted;
      let boundAt = sorted[0] ? sorted[0].created_at : null;
      let boundId = sorted[0] ? sorted[0].id : null;
      if (before && beforeId) {
        boundAt = before;
        boundId = beforeId;
        bounded = sorted.filter((row) => row.created_at < before || (row.created_at === before && row.id <= beforeId));
      }
      const total = bounded.length;
      let pageNumber = Number(args && args.p_page);
      if (!Number.isInteger(pageNumber) || pageNumber < 0) pageNumber = 0;
      const last = total === 0 ? 0 : Math.floor((total - 1) / 10);
      if (pageNumber > last) pageNumber = last;
      return {
        total: total,
        page: pageNumber,
        rows: bounded.slice(pageNumber * 10, pageNumber * 10 + 10),
        bound_at: boundAt,
        bound_id: boundId
      };
    }
    function readFixture() {
      try {
        return JSON.parse(sessionStorage.getItem("kutadgu-feedback-e2e") || "{}");
      } catch (error) {
        return {};
      }
    }
    const setup = readFixture();
    window.__rows = Array.isArray(setup.rows) ? setup.rows : [];
    window.__aal = setup.aal || "aal2";
    window.__sub = setup.sub || "admin-1";
    window.__calls = [];
    window.__pending = [];
    window.__hold = !!setup.hold;
    window.__throwRead = !!setup.throwRead;
    window.__errorRead = !!setup.errorRead;
    window.__errorCode = setup.errorCode || "08006";
    window.__sessionMode = setup.sessionMode || "";
    window.__sessionHold = false;
    window.__sessionPending = [];
    window.__authListeners = [];
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguAnalyticsDb = {
      rpc() { return Promise.resolve({ data: null, error: null }); },
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        signOut: () => new Promise(() => {})
      }
    };
    window.__kutadguAdminFeedbackClient = {
      auth: {
        getSession: () => {
          const shot = { aal: window.__aal, sub: window.__sub, mode: window.__sessionMode };
          const respond = () => {
            if (shot.mode === "none") return { data: { session: null }, error: null };
            const payload = btoa(JSON.stringify({ aal: shot.aal, sub: shot.sub })).replace(/=+$/g, "");
            return { data: { session: { access_token: "h." + payload + ".s", user: { id: shot.sub } } }, error: null };
          };
          if (window.__sessionHold) return new Promise((resolve) => { window.__sessionPending.push(() => resolve(respond())); });
          return Promise.resolve(respond());
        },
        onAuthStateChange(cb) {
          window.__authListeners.push(cb);
          return { data: { subscription: { unsubscribe() {} } } };
        }
      },
      rpc(name, args) {
        window.__calls.push({ name: name, page: args && args.p_page, args: args });
        if (window.__throwRead) return Promise.reject(new Error("boom"));
        if (window.__errorRead) return Promise.resolve({ data: null, error: { message: "read", code: window.__errorCode } });
        if (window.__hold) return new Promise((resolve) => { window.__pending.push({ resolve: resolve, args: args }); });
        return Promise.resolve({ data: pack(window.__rows, args), error: null });
      }
    };
  });
}

async function openInbox(page, count, extra) {
  const fixture = Object.assign({ rows: rows(count) }, extra || {});
  await page.goto("/admin.html#feedback", { waitUntil: "domcontentloaded" });
  await page.evaluate((value) => {
    sessionStorage.setItem("kutadgu-feedback-e2e", JSON.stringify(value));
  }, fixture);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#websiteFeedbackCard")).toBeVisible();
}

test("empty, one, ten, and eleven rows page inside the admin inbox", async ({ page }) => {
  await installInbox(page);
  await openInbox(page, 0);
  await expect(page.locator("#websiteFeedbackStatus")).toHaveText("پىكىر يوق.");
  await expect(page.locator("#websiteFeedbackList")).toHaveText("");
  await expect(page.locator("#websiteFeedbackRetry")).toBeHidden();
  expect(await page.locator("text=پىكىر يوق.").count()).toBe(1);

  await openInbox(page, 1);
  await expect(page.locator("#websiteFeedbackList .admin-review-body")).toHaveText("<img src=x onerror=alert(1)>");
  await expect(page.locator("#websiteFeedbackList img")).toHaveCount(0);
  await expect(page.locator("#websiteFeedbackList .admin-help")).toContainText("ئەزا 1");
  await expect(page.locator("#websiteFeedbackPager")).toContainText("جەمئىي 1 پىكىر · بەت 1 / 1");
  await expect(page.locator("#websiteFeedbackPager").getByRole("button", { name: "كېيىنكى بەت" })).toBeDisabled();
  await expect(page.locator("#websiteFeedbackPager").getByRole("button", { name: "ئالدىنقى بەت" })).toBeDisabled();

  await openInbox(page, 10);
  await expect(page.locator("#websiteFeedbackList .admin-review-item")).toHaveCount(10);
  await expect(page.locator("#websiteFeedbackPager").getByRole("button", { name: "كېيىنكى بەت" })).toBeDisabled();

  await openInbox(page, 11);
  await expect(page.locator("#websiteFeedbackList .admin-review-body").first()).toHaveText("پىكىر 11");
  await expect(page.locator("#websiteFeedbackPager")).toContainText("بەت 1 / 2");
  await page.locator("#websiteFeedbackPager").getByRole("button", { name: "كېيىنكى بەت" }).click();
  await expect(page.locator("#websiteFeedbackList .admin-review-item")).toHaveCount(1);
  await expect(page.locator("#websiteFeedbackPager").getByRole("button", { name: "كېيىنكى بەت" })).toBeDisabled();
  await expect(page.locator("#websiteFeedbackPager").getByRole("button", { name: "ئالدىنقى بەت" })).toBeEnabled();
  await page.locator("#websiteFeedbackPager").getByRole("button", { name: "ئالدىنقى بەت" }).click();
  await expect(page.locator("#websiteFeedbackList .admin-review-item")).toHaveCount(10);
});

test("a failed page keeps the same admin's rows and retry reloads that page", async ({ page }) => {
  await installInbox(page);
  await openInbox(page, 11);
  await expect(page.locator("#websiteFeedbackList .admin-review-item")).toHaveCount(10);
  await page.evaluate(() => { window.__errorRead = true; });
  await page.locator("#websiteFeedbackPager").getByRole("button", { name: "كېيىنكى بەت" }).click();
  await expect(page.locator("#websiteFeedbackList .admin-review-item")).toHaveCount(10);
  await expect(page.locator("#websiteFeedbackStatus")).toContainText("پىكىرلەر يۈكلەنمىدى.");
  await expect(page.locator("#websiteFeedbackStatus")).toContainText("كۆرۈنۈپ تۇرغان تىزىملىك ئالدىنقى نەتىجە.");
  await expect(page.locator("#websiteFeedbackStatus")).not.toContainText("پىكىر يوق.");
  await expect(page.locator("#websiteFeedbackRetry")).toBeVisible();
  await expect(page.locator("#websiteFeedbackPager").getByRole("button", { name: "كېيىنكى بەت" })).toBeDisabled();
  await page.evaluate(() => { window.__errorRead = false; });
  await page.locator("#websiteFeedbackRetry").click();
  await expect(page.locator("#websiteFeedbackList .admin-review-item")).toHaveCount(1);
  await expect(page.locator("#websiteFeedbackStatus")).toHaveText("");
});

test("a thrown read is not an empty inbox, and a stale page does not overwrite", async ({ page }) => {
  await installInbox(page);
  await openInbox(page, 0, { throwRead: true });
  await expect(page.locator("#websiteFeedbackStatus")).toHaveText("پىكىرلەر يۈكلەنمىدى.");
  await expect(page.locator("#websiteFeedbackList")).not.toContainText("پىكىر يوق.");
  await expect(page.locator("#websiteFeedbackRetry")).toBeVisible();
  await page.evaluate(() => { window.__throwRead = false; });
  await page.locator("#websiteFeedbackRetry").click();
  await expect(page.locator("#websiteFeedbackStatus")).toHaveText("پىكىر يوق.");

  await openInbox(page, 11, { hold: true });
  await page.waitForFunction(() => window.__pending.length === 1);
  await expect(page.locator("#websiteFeedbackStatus")).toHaveText("پىكىرلەر يۈكلىنىۋاتىدۇ.");
  await page.evaluate(() => {
    window.__hold = false;
    window.__rows.push({
      id: "12000000-0000-4000-8000-000000000099",
      body: "يېڭى پىكىر",
      created_at: "2026-02-01T00:00:00Z",
      member_label: "يېڭى ئەزا"
    });
    document.querySelector("[data-admin-section='feedback']").click();
  });
  await expect(page.locator("#websiteFeedbackList .admin-review-body").first()).toHaveText("يېڭى پىكىر");
  await page.evaluate(() => {
    const stale = window.__pending.shift();
    stale.resolve({ data: { total: 11, page: 0, rows: [{ id: "old", body: "كونا", created_at: "2026-01-01T00:00:00Z", member_label: "كونا" }] }, error: null });
  });
  await expect(page.locator("#websiteFeedbackList .admin-review-body").first()).toHaveText("يېڭى پىكىر");
});

test("AAL downgrade and logout drop the inbox without keeping another context", async ({ page }) => {
  await installInbox(page);
  await openInbox(page, 2);
  await expect(page.locator("#websiteFeedbackList .admin-review-item")).toHaveCount(2);
  await page.evaluate(() => { window.__aal = "aal1"; });
  await page.locator("[data-admin-section='feedback']").click();
  await expect(page.locator("#websiteFeedbackStatus")).toContainText("AAL2");
  await expect(page.locator("#websiteFeedbackList .admin-review-item")).toHaveCount(0);

  await page.evaluate(() => { window.__aal = "aal2"; });
  await page.locator("[data-admin-section='feedback']").click();
  await expect(page.locator("#websiteFeedbackList .admin-review-item")).toHaveCount(2);
  await page.evaluate(() => { window.__hold = true; });
  await page.locator("[data-admin-section='feedback']").click();
  await page.waitForFunction(() => window.__pending.length === 1);
  await page.evaluate(() => { window.__aal = "aal1"; window.__pending.shift().resolve({ data: { total: 2, page: 0, rows: window.__rows }, error: null }); });
  await expect(page.locator("#websiteFeedbackList .admin-review-item")).toHaveCount(0);
  await expect(page.locator("#websiteFeedbackStatus")).toContainText("AAL2");

  await page.evaluate(() => { window.__aal = "aal2"; window.__hold = false; });
  await page.locator("[data-admin-section='feedback']").click();
  await expect(page.locator("#websiteFeedbackList .admin-review-item")).toHaveCount(2);
  await page.evaluate(() => { void window.__kutadguAdminTest.logout(); });
  await expect(page.locator("#websiteFeedbackList .admin-review-item")).toHaveCount(0);
});

test("admin identity changes and delayed session reads drop the other inbox", async ({ page }) => {
  await installInbox(page);
  await openInbox(page, 2);
  await expect(page.locator("#websiteFeedbackList .admin-review-item")).toHaveCount(2);
  await page.evaluate(() => { window.__sessionHold = true; });
  await page.locator("[data-admin-section='feedback']").click();
  await page.waitForFunction(() => window.__sessionPending.length === 1);
  await page.evaluate(() => {
    window.__sub = "admin-b";
    const payload = btoa(JSON.stringify({ aal: "aal2", sub: "admin-b" })).replace(/=+$/g, "");
    window.__authListeners.forEach((cb) => cb("SIGNED_IN", { access_token: "h." + payload + ".s", user: { id: "admin-b" } }));
  });
  await expect(page.locator("#websiteFeedbackList .admin-review-item")).toHaveCount(0);
  await page.evaluate(() => {
    window.__sessionHold = false;
    window.__sessionPending.splice(0).forEach((release) => release());
  });
  await expect(page.locator("#websiteFeedbackList .admin-review-body")).toHaveCount(0);
  await expect(page.locator("#websiteFeedbackStatus")).not.toContainText("ئالدىنقى نەتىجە");

  await page.evaluate(() => { window.__sub = "admin-a"; window.__aal = "aal2"; });
  await page.locator("[data-admin-section='feedback']").click();
  await expect(page.locator("#websiteFeedbackList .admin-review-item")).toHaveCount(2);
  await page.evaluate(() => {
    const payload = btoa(JSON.stringify({ aal: "aal1", sub: "admin-a" })).replace(/=+$/g, "");
    window.__authListeners.forEach((cb) => cb("TOKEN_REFRESHED", { access_token: "h." + payload + ".s", user: { id: "admin-a" } }));
  });
  await expect(page.locator("#websiteFeedbackList .admin-review-item")).toHaveCount(0);
  await expect(page.locator("#websiteFeedbackStatus")).toContainText("AAL2");

  await page.evaluate(() => { window.__aal = "aal2"; window.__hold = true; window.__errorRead = false; });
  await page.locator("[data-admin-section='feedback']").click();
  await page.waitForFunction(() => window.__pending.length === 1);
  await page.evaluate(() => {
    window.__sub = "admin-c";
    const payload = btoa(JSON.stringify({ aal: "aal2", sub: "admin-c" })).replace(/=+$/g, "");
    window.__authListeners.forEach((cb) => cb("SIGNED_IN", { access_token: "h." + payload + ".s", user: { id: "admin-c" } }));
    window.__pending.splice(0).forEach((item) => item.resolve({ data: null, error: { message: "read", code: "08006" } }));
  });
  await expect(page.locator("#websiteFeedbackList .admin-review-item")).toHaveCount(0);
  await expect(page.locator("#websiteFeedbackStatus")).not.toContainText("ئالدىنقى نەتىجە");
});

test("a newer row between pages stays behind the returned cursor, including retry", async ({ page }) => {
  await installInbox(page);
  await openInbox(page, 11);
  await expect(page.locator("#websiteFeedbackList .admin-review-body").first()).toHaveText("پىكىر 11");
  const first = await page.evaluate(() => window.__calls[0].args);
  expect(first.p_before).toBeUndefined();
  expect(first.p_before_id).toBeUndefined();
  const newest = rows(11)[10];
  await page.evaluate((row) => {
    window.__rows.push({
      id: "12000000-0000-4000-8000-000000000099",
      body: "يېڭى پىكىر",
      created_at: "2026-03-01T00:00:00.000Z",
      member_label: "يېڭى ئەزا"
    });
    window.__errorRead = true;
    window.__cursorRow = row;
  }, { created_at: newest.created_at, id: newest.id });
  await page.locator("#websiteFeedbackPager").getByRole("button", { name: "كېيىنكى بەت" }).click();
  await expect(page.locator("#websiteFeedbackList .admin-review-item")).toHaveCount(10);
  await expect(page.locator("#websiteFeedbackList")).not.toContainText("يېڭى پىكىر");
  await expect(page.locator("#websiteFeedbackStatus")).toContainText("كۆرۈنۈپ تۇرغان تىزىملىك ئالدىنقى نەتىجە.");
  const failed = await page.evaluate(() => window.__calls[window.__calls.length - 1].args);
  const bound = await page.evaluate(() => window.__cursorRow);
  expect(failed.p_page).toBe(1);
  expect(failed.p_before).toBe(bound.created_at);
  expect(failed.p_before_id).toBe(bound.id);
  await page.evaluate(() => { window.__errorRead = false; });
  await page.locator("#websiteFeedbackRetry").click();
  const retried = await page.evaluate(() => window.__calls[window.__calls.length - 1].args);
  expect(retried.p_page).toBe(1);
  expect(retried.p_before).toBe(bound.created_at);
  expect(retried.p_before_id).toBe(bound.id);
  await expect(page.locator("#websiteFeedbackList .admin-review-item")).toHaveCount(1);
  await expect(page.locator("#websiteFeedbackList .admin-review-body")).toHaveText("<img src=x onerror=alert(1)>");
  await expect(page.locator("#websiteFeedbackList")).not.toContainText("يېڭى پىكىر");
  await page.locator("[data-admin-section='feedback']").click();
  await expect(page.locator("#websiteFeedbackList .admin-review-body").first()).toHaveText("يېڭى پىكىر");
  const fresh = await page.evaluate(() => window.__calls[window.__calls.length - 1].args);
  expect(fresh.p_page).toBe(0);
  expect(fresh.p_before).toBeUndefined();
  expect(fresh.p_before_id).toBeUndefined();
});

test("admin inbox layout stays RTL on a narrow viewport and in dark mode", async ({ page }) => {
  await installInbox(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await openInbox(page, 1);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("#websiteFeedbackCard")).toBeVisible();
  const narrow = await page.locator("#websiteFeedbackList .admin-review-body").boundingBox();
  expect(narrow.width).toBeGreaterThan(100);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator("#websiteFeedbackPager").getByRole("button", { name: "كېيىنكى بەت" })).toBeDisabled();
  await page.evaluate(() => document.body.classList.add("dark-mode"));
  await expect(page.locator("#websiteFeedbackCard")).toBeVisible();
  await page.locator("[data-admin-section='feedback']").focus();
  await expect(page.locator("[data-admin-section='feedback']")).toBeFocused();
});
