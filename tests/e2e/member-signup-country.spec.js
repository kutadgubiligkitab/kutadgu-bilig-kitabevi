const { test, expect } = require("./playwright-test");

const PASSWORD = "correct-horse";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function directUser(email, mode) {
  return {
    id: USER,
    aud: "authenticated",
    email,
    role: "authenticated",
    created_at: new Date().toISOString(),
    identities: mode === "duplicate" ? [] : [{ provider: "email", user_id: USER }]
  };
}

function sessionBody(email) {
  return {
    access_token: "test-access-aaaaaaaa",
    refresh_token: "test-refresh-aaaaaaaa",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: directUser(email, "session")
  };
}

async function install(page) {
  const seen = [];
  await page.addInitScript(() => {
    window.__signupPosts = [];
    window.__signupUrls = [];
  });
  await page.route("**/*supabase.co/**", (route) => {
    if (route.request().url().includes("/logout")) return route.fulfill({ status: 204, body: "" });
    return route.abort();
  });
  await page.route("**/api/member-signup**", async (route) => {
    const body = route.request().postDataJSON();
    const url = route.request().url();
    seen.push(body);
    await page.evaluate((posted) => {
      window.__signupPosts.push(posted.body);
      window.__signupUrls.push(posted.url);
    }, { body, url });
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
    if (mode === "malformed") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true })
      });
    }
    if (mode === "session") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sessionBody(body.email))
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(directUser(body.email, mode))
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
  expect(posts[0].data.full_name).toBe("يېڭى ئەزا");
  expect(posts[0].full_name).toBeUndefined();
  expect(posts[0].code_challenge_method).toBe("s256");
  expect(posts[0].code_challenge).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  expect(posts[0].country).toBeUndefined();
  expect(posts[0].user_id).toBeUndefined();
  expect(JSON.stringify(posts[0])).not.toContain("cf-ipcountry");
  const urls = await page.evaluate(() => window.__signupUrls);
  expect(urls[0]).toContain("/api/member-signup");
  expect(decodeURIComponent(urls[0])).toContain("/account.html");
  const confirmAuth = await page.evaluate(async () => {
    const client = window.KutadguMember.getClient();
    const session = await client.auth.getSession();
    return {
      session: session.data.session,
      stored: localStorage.getItem("kutadgu-member-auth-v1"),
      verifier: localStorage.getItem("kutadgu-member-auth-v1-code-verifier")
    };
  });
  expect(confirmAuth.session).toBeNull();
  expect(confirmAuth.stored).toBeNull();
  expect(confirmAuth.verifier).toBeTruthy();

  await page.evaluate(() => { window.__signupMode = "session"; window.__oauthPosts = []; });
  await page.locator("[data-auth-tab='signup']").click();
  await fillSignup(page, "session@example.com");
  await expect(page.locator("#memberPanel")).toBeVisible();
  await expect(page.locator("#authStatus")).not.toContainText("ئەزالىق ئېچىش مەغلۇپ");
  const sessionAuth = await page.evaluate(async () => {
    const client = window.KutadguMember.getClient();
    const session = await client.auth.getSession();
    return {
      token: session.data.session && session.data.session.access_token,
      userId: session.data.session && session.data.session.user && session.data.session.user.id,
      stored: localStorage.getItem("kutadgu-member-auth-v1")
    };
  });
  expect(sessionAuth.token).toBe("test-access-aaaaaaaa");
  expect(sessionAuth.userId).toBe(USER);
  expect(sessionAuth.stored).toContain("test-access-aaaaaaaa");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction((id) => {
    const member = window.KutadguMember;
    return !!(member && member.sessionBootDone && member.sessionBootDone() && member.getUser && member.getUser() && member.getUser().id === id);
  }, USER);
  expect(await page.evaluate(() => window.__oauthPosts || [])).toEqual([]);

  await page.locator("#memberLogout").click();
  await expect(page.locator("#loginForm")).toBeVisible();
  await page.goto("/account.html?retry=1#signup", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#signupForm")).toBeVisible();
  await page.evaluate(() => { window.__signupMode = "reject"; });
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
      await page.goto("/account.html?pass=" + width + "-" + (dark ? "dark" : "light") + "#signup", { waitUntil: "domcontentloaded" });
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

const WORKER_USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const signupHandler = require("../../cloudflare/member-signup-country.js");

function createdAccount(email, nonce, createdAt) {
  const created = createdAt || new Date().toISOString();
  return {
    id: WORKER_USER,
    aud: "authenticated",
    email,
    created_at: created,
    user_metadata: { full_name: "يېڭى ئەزا", kutadgu_signup_nonce: nonce },
    identities: [{
      provider: "email",
      user_id: WORKER_USER,
      created_at: created,
      identity_data: { email, kutadgu_signup_nonce: nonce }
    }]
  };
}

function workerRequest(route) {
  const raw = route.request();
  const headers = raw.headers();
  return {
    method: raw.method(),
    url: raw.url(),
    headers: {
      get(name) {
        return headers[String(name || "").toLowerCase()] || "";
      }
    },
    text: async () => raw.postData() || "",
    cf: { country: "TR" }
  };
}

function authFixture(mode, sent) {
  const nonce = sent.data && sent.data.kutadgu_signup_nonce;
  const email = sent.email;
  if (mode === "session") {
    const user = createdAccount(email, nonce);
    return {
      status: 200,
      body: {
        access_token: "test-access-aaaaaaaa",
        refresh_token: "test-refresh-aaaaaaaa",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user
      }
    };
  }
  if (mode === "existing") {
    const created = new Date(Date.now() - 5000).toISOString();
    const stored = "11".repeat(32);
    return { status: 200, body: createdAccount(email, stored, created) };
  }
  if (mode === "duplicate") {
    return {
      status: 200,
      body: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        aud: "authenticated",
        email,
        created_at: new Date().toISOString(),
        user_metadata: { kutadgu_signup_nonce: nonce },
        identities: []
      }
    };
  }
  return { status: 200, body: createdAccount(email, nonce) };
}

async function installWorker(page, state) {
  const upstream = [];
  await page.route("**/*supabase.co/**", (route) => {
    if (route.request().url().includes("/logout")) return route.fulfill({ status: 204, body: "" });
    return route.abort();
  });
  await page.route("**/api/member-signup**", async (route) => {
    const result = await signupHandler.handleMemberSignup(
      workerRequest(route),
      { SUPABASE_SECRET_KEY: "server-secret" },
      {
        fetchImpl: async (url, init) => {
          const target = String(url);
          if (target.includes("supabase.co") && !target.includes("/auth/v1/signup") && !target.includes("/rest/v1/rpc/record_member_signup_country")) {
            throw new Error("production auth host was contacted: " + target);
          }
          const body = init && init.body ? JSON.parse(init.body) : null;
          if (target.includes("/auth/v1/signup")) {
            upstream.push(body);
            const fixture = authFixture(state.mode, body);
            return { status: fixture.status, text: async () => JSON.stringify(fixture.body) };
          }
          if (target.includes("/rest/v1/rpc/record_member_signup_country")) {
            state.records.push(body);
            return { status: 204, text: async () => "" };
          }
          throw new Error("unexpected signup worker request: " + target);
        }
      }
    );
    await route.fulfill({
      status: result.status,
      contentType: result.contentType,
      body: result.body
    });
  });
  return upstream;
}

async function authStorage(page) {
  return page.evaluate(async () => {
    const client = window.KutadguMember.getClient();
    const session = await client.auth.getSession();
    return {
      token: session.data.session && session.data.session.access_token,
      stored: localStorage.getItem("kutadgu-member-auth-v1"),
      verifier: localStorage.getItem("kutadgu-member-auth-v1-code-verifier")
    };
  });
}

test("the bundled SDK signup reaches Auth through the Worker with S256 and plain PKCE", async ({ page }) => {
  const state = { mode: "confirm", records: [] };
  const upstream = await installWorker(page, state);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openSignup(page);
  await fillSignup(page, "worker-new@example.com");
  await expect(page.locator("#authStatus")).toContainText("ئەزالىق قۇرۇلدى");
  expect(upstream).toHaveLength(1);
  expect(upstream[0].code_challenge_method).toBe("s256");
  expect(upstream[0].code_challenge).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  expect(upstream[0].data.kutadgu_signup_nonce).toMatch(/^[0-9a-f]{64}$/);
  expect(upstream[0].data.country).toBeUndefined();
  expect(state.records).toEqual([{
    p_user_id: WORKER_USER,
    p_country: "TR",
    p_nonce: upstream[0].data.kutadgu_signup_nonce
  }]);
  const confirmAuth = await authStorage(page);
  expect(confirmAuth.token).toBeFalsy();
  expect(confirmAuth.stored).toBeNull();
  expect(confirmAuth.verifier).toBeTruthy();

  state.mode = "session";
  await page.locator("[data-auth-tab='signup']").click();
  await fillSignup(page, "worker-session@example.com");
  await expect(page.locator("#memberPanel")).toBeVisible();
  const sessionAuth = await authStorage(page);
  expect(sessionAuth.token).toBe("test-access-aaaaaaaa");
  expect(sessionAuth.stored).toContain("test-access-aaaaaaaa");
  expect(upstream[1].code_challenge_method).toBe("s256");
  expect(state.records).toHaveLength(2);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction((id) => {
    const member = window.KutadguMember;
    return !!(member && member.sessionBootDone && member.sessionBootDone() && member.getUser && member.getUser() && member.getUser().id === id);
  }, WORKER_USER);

  await page.locator("#memberLogout").click();
  await expect(page.locator("#loginForm")).toBeVisible();
  await page.goto("/account.html#signup", { waitUntil: "domcontentloaded" });
  const beforeExisting = state.records.length;
  state.mode = "existing";
  await fillSignup(page, "worker-existing@example.com");
  await expect(page.locator("#authStatus")).toContainText("ئەزالىق قۇرۇلدى");
  expect(state.records).toHaveLength(beforeExisting);
  expect(upstream.at(-1).data.kutadgu_signup_nonce).not.toBe("11".repeat(32));

  state.mode = "duplicate";
  await page.locator("[data-auth-tab='signup']").click();
  await fillSignup(page, "worker-duplicate@example.com");
  await expect(page.locator("#authStatus")).toContainText("ئەزالىق قۇرۇلدى");
  expect(state.records).toHaveLength(beforeExisting);
  expect(upstream.at(-1).code_challenge_method).toBe("s256");
});

test("the bundled SDK plain PKCE fallback still signs up through the Worker", async ({ page }) => {
  await page.addInitScript(() => {
    const random = window.crypto.getRandomValues.bind(window.crypto);
    Object.defineProperty(window, "crypto", {
      configurable: true,
      value: { getRandomValues: random }
    });
  });
  const state = { mode: "confirm", records: [] };
  const upstream = await installWorker(page, state);
  await page.setViewportSize({ width: 390, height: 800 });
  await openSignup(page);
  await fillSignup(page, "worker-plain@example.com");
  await expect(page.locator("#authStatus")).toContainText("ئەزالىق قۇرۇلدى");
  expect(upstream).toHaveLength(1);
  expect(upstream[0].code_challenge_method).toBe("plain");
  expect(upstream[0].code_challenge).toMatch(/^[0-9a-f]{112}$/);
  expect(state.records).toHaveLength(1);
  expect(state.records[0].p_nonce).toBe(upstream[0].data.kutadgu_signup_nonce);
  expect(state.records[0].p_country).toBe("TR");
  const confirmAuth = await authStorage(page);
  expect(confirmAuth.token).toBeFalsy();
  expect(confirmAuth.verifier).toBe(upstream[0].code_challenge);

  state.mode = "session";
  await page.locator("[data-auth-tab='signup']").click();
  await fillSignup(page, "worker-plain-session@example.com");
  await expect(page.locator("#memberPanel")).toBeVisible();
  const sessionAuth = await authStorage(page);
  expect(sessionAuth.token).toBe("test-access-aaaaaaaa");
  expect(sessionAuth.stored).toContain("test-access-aaaaaaaa");
  expect(upstream[1].code_challenge_method).toBe("plain");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction((id) => {
    const member = window.KutadguMember;
    return !!(member && member.sessionBootDone && member.sessionBootDone() && member.getUser && member.getUser() && member.getUser().id === id);
  }, WORKER_USER);
});
