const { test, expect } = require("./playwright-test");

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function sessionFor(userId, provider) {
  return {
    access_token: "test-access-" + userId.slice(0, 8),
    refresh_token: "test-refresh-" + userId.slice(0, 8),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email: userId.slice(0, 8) + "@example.com",
      app_metadata: { provider: provider || "email" }
    }
  };
}

async function install(page, userId, provider, status) {
  const visits = [];
  const rpcs = [];
  const state = { mode: "ok", release: null };
  await page.addInitScript(({ stored, id }) => {
    if (!localStorage.getItem("kutadgu-member-auth-v1")) {
      localStorage.setItem("kutadgu-member-auth-v1", JSON.stringify(stored));
      localStorage.setItem("kutadgu-shop-owner-v1", id);
    }
  }, { stored: sessionFor(userId, provider), id: userId });
  await page.route("**/*supabase.co/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/logout")) return route.fulfill({ status: 204, body: "" });
    if (url.includes("/rest/v1/rpc/")) {
      rpcs.push(url);
      return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
    }
    if (url.includes("/rest/v1/profiles")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: userId, full_name: "ئەزا", status: status || "active", country: "تۈركىيە" }])
      });
    }
    if (url.includes("/rest/v1/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/member-visit", async (route) => {
    const body = route.request().postDataJSON();
    visits.push({
      body,
      authorization: String(route.request().headers().authorization || "").replace(/^Bearer\s+/i, "")
    });
    if (state.mode === "hold") await new Promise((resolve) => { state.release = resolve; });
    if (state.mode === "fail") return route.fulfill({ status: 503, body: "" });
    if (state.mode === "reject") return route.fulfill({ status: 401, body: "" });
    return route.fulfill({ status: 204, body: "" });
  });
  return { visits, rpcs, state };
}

async function visitKey(page, userId) {
  return page.evaluate((id) => localStorage.getItem("kutadgu-last-visit-" + id), userId);
}

test("an existing email session records one visit and keeps the cadence", async ({ page }) => {
  const gate = await install(page, USER, "email", "active");
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/account.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("#profileCountry")).toHaveValue("تۈركىيە");
  await expect.poll(() => gate.visits.length).toBe(1);
  expect(gate.visits[0].body).toEqual({ page_path: "account.html" });
  expect(gate.visits[0].authorization).toBe("test-access-" + USER.slice(0, 8));
  expect(gate.rpcs.some((url) => url.includes("record_member_visit"))).toBe(false);
  await expect.poll(() => visitKey(page, USER)).toBeTruthy();
  await page.goto("/feedback", { waitUntil: "domcontentloaded" });
  await expect(page.locator("h1")).toHaveText("پىكىر ۋە تەكلىپ");
  expect(gate.visits.length).toBe(1);
});

test("a google session, a failed write, and a retry do not double count", async ({ page }) => {
  const gate = await install(page, USER, "google", "active");
  gate.state.mode = "fail";
  await page.goto("/account.html", { waitUntil: "domcontentloaded" });
  await expect.poll(() => gate.visits.length).toBe(1);
  expect(await visitKey(page, USER)).toBeNull();
  gate.state.mode = "ok";
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect.poll(() => gate.visits.length).toBe(2);
  expect(gate.visits.every((visit) => visit.body.country == null && visit.body.user_id == null)).toBe(true);
  await expect.poll(() => visitKey(page, USER)).toBeTruthy();
  expect(gate.rpcs.some((url) => url.includes("record_member_visit"))).toBe(false);
});

test("rejected authentication and a suspended member do not keep a visit", async ({ page }) => {
  const rejected = await install(page, USER, "email", "active");
  rejected.state.mode = "reject";
  await page.goto("/account.html", { waitUntil: "domcontentloaded" });
  await expect.poll(() => rejected.visits.length).toBe(1);
  expect(await visitKey(page, USER)).toBeNull();

  const suspended = await install(page, OTHER, "email", "suspended");
  await page.goto("/feedback", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("ھېساب توختىتىلغان")).toBeVisible();
  expect(suspended.visits.length).toBe(0);
  expect(await visitKey(page, OTHER)).toBeNull();
});

function unsignedToken(userId) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    role: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600
  })).toString("base64url");
  return header + "." + payload + ".sig";
}

test("a delayed getSession cannot send another account token for the pending member", async ({ page }) => {
  const gate = await install(page, USER, "email", "active");
  const otherToken = unsignedToken(OTHER);
  await page.addInitScript((captured) => {
    window.__visitGate = { holdWhenUser: captured, used: false, held: false, release: null };
    let current;
    const wrap = (client) => {
      const original = client.auth.getSession.bind(client.auth);
      client.auth.getSession = async (...args) => {
        const live = window.KutadguMember && window.KutadguMember.getUser && window.KutadguMember.getUser();
        const liveId = live && live.id ? String(live.id) : "";
        const fromVisit = String(new Error().stack || "").includes("recordVisit");
        if (fromVisit && window.__visitGate.holdWhenUser && liveId === window.__visitGate.holdWhenUser && !window.__visitGate.used) {
          window.__visitGate.used = true;
          window.__visitGate.held = true;
          await new Promise((resolve) => { window.__visitGate.release = resolve; });
        }
        return original(...args);
      };
      return client;
    };
    Object.defineProperty(window, "supabase", {
      configurable: true,
      get() { return current; },
      set(value) {
        current = value;
        if (value && typeof value.createClient === "function" && !value.__visitWrapped) {
          const create = value.createClient.bind(value);
          value.createClient = (...args) => wrap(create(...args));
          value.__visitWrapped = true;
        }
      }
    });
  }, USER);
  await page.route("**/auth/v1/user**", async (route) => {
    const authorization = String(route.request().headers().authorization || "");
    const id = authorization.includes(otherToken) ? OTHER : USER;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id,
        aud: "authenticated",
        role: "authenticated",
        email: id.slice(0, 8) + "@example.com",
        app_metadata: { provider: "email" }
      })
    });
  });
  await page.goto("/account.html", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => window.__visitGate && window.__visitGate.held)).toBe(true);
  expect(gate.visits.length).toBe(0);
  expect(await page.evaluate(() => window.KutadguMember.getUser().id)).toBe(USER);
  const switched = await page.evaluate(async ({ token, refresh, id }) => {
    const client = window.KutadguMember.getClient();
    const result = await client.auth.setSession({ access_token: token, refresh_token: refresh });
    return {
      error: result.error && result.error.message || "",
      sessionUser: result.data && result.data.session && result.data.session.user && result.data.session.user.id || "",
      appUser: window.KutadguMember.getUser() && window.KutadguMember.getUser().id || ""
    };
  }, { token: otherToken, refresh: "refresh-" + OTHER, id: OTHER });
  expect(switched.error).toBe("");
  expect(switched.sessionUser).toBe(OTHER);
  expect(switched.appUser).toBe(USER);
  expect(gate.visits.length).toBe(0);
  await page.evaluate(() => window.__visitGate.release());
  await expect.poll(() => visitKey(page, USER)).toBeNull();
  await expect.poll(() => gate.visits.length).toBe(1);
  expect(gate.visits[0].authorization).toBe(otherToken);
  expect(gate.visits[0].body).toEqual({ page_path: "account.html" });
  expect(await visitKey(page, USER)).toBeNull();
  await expect.poll(() => visitKey(page, OTHER)).toBeTruthy();
});

test("logout and an account switch keep each visit on its own key", async ({ page }) => {
  const gate = await install(page, USER, "email", "active");
  gate.state.mode = "hold";
  await page.goto("/account.html", { waitUntil: "domcontentloaded" });
  await expect.poll(() => gate.visits.length).toBe(1);
  await page.evaluate(() => window.KutadguMember.signOut());
  gate.state.mode = "ok";
  gate.state.release();
  await expect.poll(() => visitKey(page, USER)).toBeTruthy();
  await page.evaluate(({ stored, id }) => {
    localStorage.setItem("kutadgu-member-auth-v1", JSON.stringify(stored));
    localStorage.setItem("kutadgu-shop-owner-v1", id);
  }, { stored: sessionFor(OTHER, "google"), id: OTHER });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect.poll(() => gate.visits.length).toBe(2);
  expect(gate.visits[1].authorization).toBe("test-access-" + OTHER.slice(0, 8));
  expect(gate.visits[1].body.country).toBeUndefined();
  expect(await visitKey(page, USER)).toBeTruthy();
  await expect.poll(() => visitKey(page, OTHER)).toBeTruthy();
});
