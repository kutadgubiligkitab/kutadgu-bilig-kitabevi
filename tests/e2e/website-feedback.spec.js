const { test, expect } = require("@playwright/test");

async function installMember(page, setup) {
  await page.addInitScript((options) => {
    window.__calls = [];
    window.__stored = [];
    window.__user = options.user;
    window.__profile = options.profile;
    window.__blocked = !!options.blocked;
    window.__mode = "";
    window.__kutadguFeedbackMember = {
      ready: Promise.resolve(),
      getUser() { return window.__user; },
      getProfile() { return window.__profile; },
      isBlocked() { return !!window.__blocked; },
      getClient() {
        return {
          rpc(name, args) {
            window.__calls.push({ name: name, args: { p_id: args.p_id, p_body: args.p_body } });
            if (window.__mode === "throw") return Promise.reject(new Error("network down"));
            if (window.__mode === "error") return Promise.resolve({ data: null, error: { message: "db", code: window.__errorCode || "08006" } });
            if (window.__mode === "hold") {
              window.__mode = "";
              return new Promise((resolve, reject) => {
                window.__pending = { resolve: resolve, reject: reject, args: args };
              });
            }
            const same = window.__stored.find((row) => row.id === args.p_id);
            if (window.__mode === "lose") {
              window.__mode = "";
              if (!same) window.__stored.push({ id: args.p_id, body: args.p_body });
              return Promise.reject(new Error("response lost"));
            }
            if (same && same.body === args.p_body) return Promise.resolve({ data: { id: args.p_id, replayed: true }, error: null });
            if (same) return Promise.resolve({ data: null, error: { message: "mismatch", code: "23505" } });
            window.__stored.push({ id: args.p_id, body: args.p_body });
            return Promise.resolve({ data: { id: args.p_id, replayed: false }, error: null });
          }
        };
      }
    };
  }, setup || { user: null, profile: null, blocked: false });
}

async function openFeedback(page) {
  await page.goto("/feedback", { waitUntil: "domcontentloaded" });
  await expect(page.locator("h1")).toHaveText("پىكىر ۋە تەكلىپ");
}

test("guests are invited once and the footer link is present", async ({ page }) => {
  await installMember(page, { user: null, profile: null, blocked: false });
  await openFeedback(page);
  await expect(page.locator("#feedbackStatus")).toHaveText("پىكىر يوللاش ئۈچۈن ھېسابىڭىزغا كىرىڭ ياكى يېڭى ئەزا بولۇڭ.");
  await expect(page.locator("#feedbackInvite")).toBeVisible();
  await expect(page.locator("#feedbackForm")).toBeHidden();
  const links = page.locator("#feedbackInvite a");
  await expect(links).toHaveCount(2);
  await expect(links.nth(0)).toHaveAttribute("href", "/account.html");
  await expect(links.nth(1)).toHaveAttribute("href", "/account.html");
  expect(await page.locator("body").innerText()).not.toMatch(/account\.html\?/);
  const statusCount = await page.locator("text=پىكىر يوللاش ئۈچۈن ھېسابىڭىزغا كىرىڭ ياكى يېڭى ئەزا بولۇڭ.").count();
  expect(statusCount).toBe(1);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".site-footer a[href='/feedback']")).toHaveText("پىكىر ۋە تەكلىپ");
});

test("footer link is on the homepage and the account page", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".site-footer a[href='/feedback']")).toHaveText("پىكىر ۋە تەكلىپ");
  await page.goto("/account.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".site-footer a[href='/feedback']")).toHaveText("پىكىر ۋە تەكلىپ");
});

test("an eligible member can submit, retry, and keep a newer draft", async ({ page }) => {
  await installMember(page, { user: { id: "member-a" }, profile: { status: "active", full_name: "ئەزا ئىسمى" }, blocked: false });
  await openFeedback(page);
  await expect(page.locator("#feedbackForm")).toBeVisible();
  expect(await page.evaluate(() => window.__calls.length)).toBe(0);
  await page.locator("#feedbackBody").fill("   ");
  await page.locator("#feedbackSubmit").click();
  await expect(page.locator("#feedbackStatus")).toHaveText("پىكىرنى يېزىڭ.");
  expect(await page.evaluate(() => window.__calls.length)).toBe(0);

  await page.locator("#feedbackBody").evaluate((el) => { el.value = "پ".repeat(2001); el.dispatchEvent(new Event("input")); });
  await page.locator("#feedbackSubmit").click();
  await expect(page.locator("#feedbackStatus")).toHaveText("پىكىر 2,000 ھەرپتىن ئېشىپ كەتمىسۇن.");
  await expect(page.locator("#feedbackCount")).toHaveText("2,001 / 2,000");

  const exact = "پ".repeat(2000);
  await page.locator("#feedbackBody").fill(exact);
  await expect(page.locator("#feedbackCount")).toHaveText("2,000 / 2,000");
  await page.evaluate(() => { window.__mode = "hold"; });
  await page.locator("#feedbackSubmit").click();
  await expect(page.locator("#feedbackStatus")).toHaveText("يوللىنىۋاتىدۇ…");
  await page.locator("#feedbackBody").fill("يېڭى مەزمۇن");
  await page.evaluate(() => window.__pending.resolve({ data: { id: window.__pending.args.p_id, replayed: false }, error: null }));
  await expect(page.locator("#feedbackStatus")).toHaveText("ئالدىنقى پىكىر يوللاندى. يېڭى مەزمۇن تېخى يوللانمىدى.");
  await expect(page.locator("#feedbackBody")).toHaveValue("يېڭى مەزمۇن");

  await page.evaluate(() => { window.__mode = "throw"; });
  await page.locator("#feedbackSubmit").click();
  await expect(page.locator("#feedbackStatus")).toHaveText("پىكىر يوللانمىدى. قايتا سىناڭ.");
  await expect(page.locator("#feedbackRetry")).toBeVisible();
  await expect(page.locator("#feedbackBody")).toHaveValue("يېڭى مەزمۇن");
  await page.evaluate(() => { window.__mode = ""; });
  await page.locator("#feedbackRetry").click();
  await expect(page.locator("#feedbackStatus")).toHaveText("پىكىرىڭىز يوللاندى. رەھمەت.");
  await expect(page.locator("#feedbackBody")).toHaveValue("");
});

test("a lost response retries the same receipt and a changed message does not", async ({ page }) => {
  await installMember(page, { user: { id: "member-a" }, profile: { status: "active" }, blocked: false });
  await openFeedback(page);
  await page.evaluate(() => { window.__mode = "lose"; });
  await page.locator("#feedbackBody").fill("<script>alert(1)</script>");
  await page.locator("#feedbackSubmit").click();
  await expect(page.locator("#feedbackStatus")).toHaveText("پىكىر يوللانمىدى. قايتا سىناڭ.");
  await expect(page.locator("#feedbackBody")).toHaveValue("<script>alert(1)</script>");
  const firstId = await page.evaluate(() => window.__calls[0].args.p_id);
  await page.locator("#feedbackRetry").click();
  await expect(page.locator("#feedbackStatus")).toHaveText("پىكىرىڭىز يوللاندى. رەھمەت.");
  const secondId = await page.evaluate(() => window.__calls[1].args.p_id);
  expect(secondId).toBe(firstId);
  expect(await page.evaluate(() => window.__stored.length)).toBe(1);

  await page.locator("#feedbackBody").fill("باشقا پىكىر");
  await page.locator("#feedbackSubmit").click();
  await expect(page.locator("#feedbackStatus")).toHaveText("پىكىرىڭىز يوللاندى. رەھمەت.");
  const thirdId = await page.evaluate(() => window.__calls[2].args.p_id);
  expect(thirdId).not.toBe(firstId);
});

test("repeated clicks and a returned error do not send twice or drop the draft", async ({ page }) => {
  await installMember(page, { user: { id: "member-a" }, profile: { status: "active" }, blocked: false });
  await openFeedback(page);
  await page.locator("#feedbackBody").fill("بىر قېتىم");
  await page.evaluate(() => { window.__mode = "hold"; });
  await page.locator("#feedbackForm").evaluate((form) => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(await page.evaluate(() => window.__calls.length)).toBe(1);
  await page.evaluate(() => window.__pending.resolve({ data: null, error: { message: "db", code: "08006" } }));
  await expect(page.locator("#feedbackStatus")).toHaveText("پىكىر يوللانمىدى. قايتا سىناڭ.");
  await expect(page.locator("#feedbackRetry")).toBeVisible();
  await expect(page.locator("#feedbackBody")).toHaveValue("بىر قېتىم");
  await expect(page.locator("#feedbackSubmit")).toBeEnabled();
});

test("logout, account switch, session loss, and suspension drop private drafts", async ({ page }) => {
  await installMember(page, { user: { id: "member-a" }, profile: { status: "active" }, blocked: false });
  await openFeedback(page);
  await page.locator("#feedbackBody").fill("مەخپىي");
  await page.evaluate(() => { window.__mode = "hold"; });
  await page.locator("#feedbackSubmit").click();
  await page.evaluate(() => window.KutadguWebsiteFeedback.beginSignOut());
  await page.locator("#feedbackBody").fill("يېڭى");
  await page.evaluate(() => window.__pending.resolve({ data: { id: window.__pending.args.p_id, replayed: false }, error: null }));
  await expect(page.locator("#feedbackBody")).toHaveValue("يېڭى");
  await expect(page.locator("#feedbackStatus")).not.toHaveText("پىكىرىڭىز يوللاندى. رەھمەت.");

  await page.evaluate(() => {
    window.__user = { id: "member-b" };
    window.__profile = { status: "active" };
    window.__blocked = false;
    document.dispatchEvent(new CustomEvent("kutadgu-member-change", {
      detail: { user: window.__user, profile: window.__profile, blocked: false }
    }));
  });
  await expect(page.locator("#feedbackBody")).toHaveValue("");
  await page.locator("#feedbackBody").fill("ئىككىنچى ئەزا");
  await page.evaluate(() => {
    window.__user = null;
    window.__profile = null;
    window.__blocked = false;
    document.dispatchEvent(new CustomEvent("kutadgu-member-change", {
      detail: { user: null, profile: null, blocked: false }
    }));
  });
  await expect(page.locator("#feedbackStatus")).toHaveText("پىكىر يوللاش ئۈچۈن ھېسابىڭىزغا كىرىڭ ياكى يېڭى ئەزا بولۇڭ.");
  await expect(page.locator("#feedbackForm")).toBeHidden();

  await page.evaluate(() => {
    window.__blocked = true;
    window.__user = { id: "member-a" };
    window.__profile = { status: "suspended" };
    document.dispatchEvent(new CustomEvent("kutadgu-member-change", {
      detail: { user: window.__user, profile: window.__profile, blocked: true }
    }));
  });
  await expect(page.locator("#feedbackStatus")).toHaveText("بۇ ھېسابات توختىتىلغان. پىكىر يوللاشقا بولمايدۇ.");
  await expect(page.locator("#feedbackForm")).toBeHidden();
  expect(await page.locator("text=بۇ ھېسابات توختىتىلغان. پىكىر يوللاشقا بولمايدۇ.").count()).toBe(1);
});

test("keyboard, narrow, desktop, and dark theme stay usable", async ({ page }) => {
  await installMember(page, { user: { id: "member-a" }, profile: { status: "active" }, blocked: false });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width: width, height: width === 390 ? 800 : 900 });
    await openFeedback(page);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("#feedbackForm")).toBeVisible();
    const box = await page.locator("#feedbackBody").boundingBox();
    expect(box.width).toBeGreaterThan(200);
    expect(box.x).toBeGreaterThanOrEqual(0);
    await page.locator("#feedbackBody").pressSequentially("كۇنۇپكا");
    await expect(page.locator("#feedbackBody")).toHaveValue("كۇنۇپكا");
    await page.locator("#feedbackSubmit").press("Enter");
    await expect(page.locator("#feedbackStatus")).toHaveText("پىكىرىڭىز يوللاندى. رەھمەت.");
  }
  await page.evaluate(() => document.body.classList.add("dark-mode"));
  const color = await page.locator(".back-link").evaluate((el) => getComputedStyle(el).color);
  expect(color).not.toBe("");
  await expect(page.locator("#feedbackSubmit")).toBeVisible();
});
