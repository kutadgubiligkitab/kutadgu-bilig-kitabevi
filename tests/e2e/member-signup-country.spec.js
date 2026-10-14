const { test, expect } = require("./playwright-test");

const PASSWORD = "correct-horse";

async function install(page) {
  const seen = [];
  await page.addInitScript(() => {
    window.__signupPosts = [];
  });
  await page.route("**/*supabase.co/**", (route) => route.abort());
  await page.route("**/api/member-signup", async (route) => {
    const body = route.request().postDataJSON();
    seen.push(body);
    await page.evaluate((posted) => { window.__signupPosts.push(posted); }, body);
    const mode = await page.evaluate(() => window.__signupMode || "confirm");
    if (mode === "reject") {
      return route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ msg: "پارول بەك ئاجىز" })
      });
    }
    if (mode === "fail") {
      return route.fulfill({ status: 503, contentType: "application/json", body: "" });
    }
    if (mode === "session") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            created_at: new Date().toISOString(),
            identities: [{ provider: "email", user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }]
          },
          session: {
            access_token: "header.payload.signature-token",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user: {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              email: body.email,
              created_at: "2020-01-01T00:00:00.000Z",
              identities: [{ provider: "email" }]
            }
          }
        })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          identities: mode === "duplicate" ? [] : [{ provider: "email" }]
        },
        session: null
      })
    });
  });
  await page.route("**/api/member-signup-country", async (route) => {
    await page.evaluate((posted) => { window.__oauthPosts = (window.__oauthPosts || []).concat([posted]); }, {
      authorization: route.request().headers().authorization || "",
      body: route.request().postData() || ""
    });
    return route.fulfill({ status: 204, body: "" });
  });
  return seen;
}

async function openSignup(page) {
  await page.goto("/account.html#signup", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#signupForm")).toBeVisible();
}

async function fillSignup(page, email) {
  await page.locator("#signupName").fill("يېڭى ئەزا");
  await page.locator("#signupEmail").fill(email);
  await page.locator("#signupPassword").fill(PASSWORD);
  await page.locator("#signupConfirm").fill(PASSWORD);
  await page.locator("#signupForm").locator("button[type=submit]").click();
}

test("password signup posts no country and keeps confirmation, rejection, and session behavior", async ({ page }) => {
  await install(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openSignup(page);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await fillSignup(page, "new@example.com");
  await expect(page.locator("#authStatus")).toContainText("ئەزالىق قۇرۇلدى");
  await expect(page.locator("#loginForm")).toBeVisible();
  const posts = await page.evaluate(() => window.__signupPosts);
  expect(posts).toHaveLength(1);
  expect(posts[0].email).toBe("new@example.com");
  expect(posts[0].full_name).toBe("يېڭى ئەزا");
  expect(posts[0].country).toBeUndefined();
  expect(posts[0].user_id).toBeUndefined();
  expect(JSON.stringify(posts[0])).not.toContain("cf-ipcountry");

  await page.evaluate(() => { window.__signupMode = "session"; window.__oauthPosts = []; });
  await page.locator("[data-auth-tab='signup']").click();
  await fillSignup(page, "session@example.com");
  await expect(page.locator("#memberPanel")).toBeVisible();
  await expect(page.locator("#authStatus")).not.toContainText("ئەزالىق ئېچىش مەغلۇپ");
  expect(await page.evaluate(() => window.__oauthPosts || [])).toEqual([]);

  await page.goto("/account.html#signup", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#signupForm")).toBeVisible();
  await page.evaluate(() => { window.__signupMode = "reject"; });
  await page.locator("[data-auth-tab='signup']").click();
  await fillSignup(page, "weak@example.com");
  await expect(page.locator("#authStatus")).toContainText("مەغلۇپ بولدى");
  await expect(page.locator("#signupForm")).toBeVisible();

  await page.evaluate(() => { window.__signupMode = "duplicate"; });
  await fillSignup(page, "again@example.com");
  await expect(page.locator("#authStatus")).toContainText("ئەزالىق قۇرۇلدى");

  await page.evaluate(() => { window.__signupMode = "fail"; });
  await page.locator("[data-auth-tab='signup']").click();
  await fillSignup(page, "down@example.com");
  await expect(page.locator("#authStatus")).toContainText("مەغلۇپ بولدى");
  await expect(page.locator("#memberPanel")).toBeHidden();
});

test("signup confirmation and an existing login stay stable in both themes and a narrow viewport", async ({ page }) => {
  await install(page);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 800 : 900 });
    for (const dark of [false, true]) {
      await page.goto("/account.html#signup", { waitUntil: "domcontentloaded" });
      await page.evaluate((isDark) => {
        document.body.classList.toggle("dark-mode", isDark);
      }, dark);
      await expect(page.locator("#signupForm")).toBeVisible();
      const box = await page.locator("#signupForm").boundingBox();
      expect(box.width).toBeLessThanOrEqual(width);
      await page.evaluate(() => { window.__signupMode = "confirm"; });
      await fillSignup(page, "theme-" + width + "-" + (dark ? "dark" : "light") + "@example.com");
      await expect(page.locator("#authStatus")).toContainText("ئەزالىق قۇرۇلدى");
    }
  }
  await page.evaluate(() => { window.__oauthPosts = []; });
  await page.locator("#loginEmail").fill("old@example.com");
  await page.locator("#loginPassword").fill(PASSWORD);
  await page.locator("#loginForm").locator("button[type=submit]").click();
  await expect(page.locator("#authStatus")).toContainText("مەغلۇپ");
  const oauth = await page.evaluate(() => window.__oauthPosts || []);
  expect(oauth).toEqual([]);
});
