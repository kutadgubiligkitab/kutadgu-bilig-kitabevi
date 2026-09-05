const { test, expect } = require("./playwright-test");

const VERIFIED = [{ id: "factor-v", factor_type: "totp", status: "verified" }];
const MOCK_OTP = "123456";
const BAD_OTP = "000000";

async function installRestoredAdmin(page, opts = {}) {
  const factors = opts.factors || VERIFIED;
  const currentLevel = opts.currentLevel || "aal1";
  const mode = opts.mode || "restored";
  await page.addInitScript(({ factors, currentLevel, mode }) => {
    const now = Math.floor(Date.now() / 1000);
    const user = { id: "admin-1", email: "admin@example.com" };
    function freshSession(token) {
      return {
        access_token: token || "fresh-access",
        refresh_token: "refresh-token",
        expires_at: now + 3600,
        user
      };
    }
    function restoredSession() {
      return {
        access_token: "restored-access",
        refresh_token: "refresh-token",
        expires_at: now + 30,
        user
      };
    }
    window.__kutadguAuthCalls = {
      signIn: 0,
      refresh: 0,
      getUser: 0,
      challenge: 0,
      signOut: 0
    };
    window.__kutadguAuthCbs = [];
    window.__kutadguMfaUnenrollLog = [];
    window.__kutadguAal = { currentLevel };
    if (mode === "none") window.__kutadguMockSession = null;
    else if (mode === "expired") {
      window.__kutadguMockSession = {
        access_token: "expired-access",
        refresh_token: "dead-refresh",
        expires_at: now - 30,
        user
      };
    } else if (mode === "fresh") window.__kutadguMockSession = freshSession("password-fresh");
    else window.__kutadguMockSession = restoredSession();
    window.__kutadguMfaApi = {
      async listFactors() {
        const all = factors.map((f) => ({ ...f }));
        return {
          data: {
            all,
            totp: all.filter((f) => f.factor_type === "totp" && f.status === "verified"),
            phone: []
          },
          error: null
        };
      },
      async getAuthenticatorAssuranceLevel() {
        return { data: { currentLevel: window.__kutadguAal.currentLevel, nextLevel: "aal2" }, error: null };
      },
      async challengeAndVerify({ code }) {
        window.__kutadguAuthCalls.challenge += 1;
        if (window.__kutadguChallengeMode === "network") {
          return { data: null, error: { name: "AuthRetryableFetchError", message: "Failed to fetch" } };
        }
        if (window.__kutadguChallengeMode === "session") {
          return { data: null, error: { status: 401, message: "Invalid JWT" } };
        }
        if (window.__kutadguChallengeMode === "noaal2") {
          if (String(code) !== "123456") {
            return { data: null, error: { message: "Invalid TOTP code entered", code: "mfa_verification_failed" } };
          }
          return { data: { access_token: "test" }, error: null };
        }
        if (String(code) !== "123456") {
          return { data: null, error: { message: "Invalid TOTP code entered", code: "mfa_verification_failed" } };
        }
        window.__kutadguAal.currentLevel = "aal2";
        return { data: { access_token: "test" }, error: null };
      },
      async enroll() {
        return { data: null, error: { message: "not used" } };
      },
      async unenroll({ factorId }) {
        window.__kutadguMfaUnenrollLog.push(factorId);
        return { data: { id: factorId }, error: null };
      }
    };
    function chain(result) {
      const q = {};
      ["select", "eq", "in", "or", "order", "range", "is", "limit", "gte", "lte", "neq"].forEach((m) => {
        q[m] = () => q;
      });
      q.update = async () => result;
      q.insert = async () => result;
      q.delete = async () => result;
      q.maybeSingle = async () => result;
      q.single = async () => result;
      q.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
      return q;
    }
    function wrapClient() {
      return {
        auth: {
          initialize: async () => {},
          getSession: async () => ({ data: { session: window.__kutadguMockSession }, error: null }),
          getUser: async () => {
            window.__kutadguAuthCalls.getUser += 1;
            if (window.__kutadguMockSession && window.__kutadguMockSession.user) {
              return { data: { user: window.__kutadguMockSession.user }, error: null };
            }
            return { data: { user: null }, error: { name: "AuthSessionMissingError", message: "Auth session missing" } };
          },
          refreshSession: async () => {
            window.__kutadguAuthCalls.refresh += 1;
            if (window.__kutadguRefreshFails) {
              return {
                data: { session: null, user: null },
                error: { message: "Invalid Refresh Token: Refresh Token Not Found", code: "refresh_token_not_found" }
              };
            }
            window.__kutadguMockSession = freshSession("refreshed-access");
            return { data: { session: window.__kutadguMockSession, user: user }, error: null };
          },
          onAuthStateChange: (cb) => {
            window.__kutadguAuthCbs.push(cb);
            setTimeout(() => cb("INITIAL_SESSION", window.__kutadguMockSession), 0);
            return { data: { subscription: { unsubscribe() {} } } };
          },
          signOut: async () => {
            window.__kutadguAuthCalls.signOut += 1;
            window.__kutadguMockSession = null;
            return { error: null };
          },
          signInWithPassword: async () => {
            window.__kutadguAuthCalls.signIn += 1;
            window.__kutadguMockSession = freshSession("password-fresh");
            window.__kutadguAal.currentLevel = "aal1";
            return { error: null };
          },
          resetPasswordForEmail: async () => ({ error: null }),
          mfa: window.__kutadguMfaApi
        },
        from(table) {
          if (table === "admin_users") {
            return chain({ data: { user_id: "admin-1" }, error: null, count: 1 });
          }
          return chain({ data: [], error: null, count: 0 });
        },
        storage: {
          from() {
            return {
              upload: async () => ({ error: null }),
              getPublicUrl() { return { data: { publicUrl: "" } }; }
            };
          }
        }
      };
    }
    let supabaseValue;
    Object.defineProperty(window, "supabase", {
      configurable: true,
      enumerable: true,
      get() { return supabaseValue; },
      set(v) {
        if (v && typeof v.createClient === "function") {
          v.createClient = function () { return wrapClient(); };
        }
        supabaseValue = v;
      }
    });
    if (mode === "expired") window.__kutadguRefreshFails = true;
  }, { factors, currentLevel, mode });
}

test.describe("Admin MFA restored-session reliability", () => {
  test("restored AAL1 session reaches MFA without password login and valid code opens dashboard", async ({ page }) => {
    await installRestoredAdmin(page, { mode: "restored", currentLevel: "aal1" });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#mfaGatePanel")).toBeVisible();
    await expect(page.locator("#dashboardPanel")).toBeHidden();
    await expect(page.locator("#loginPanel")).toBeHidden();
    const before = await page.evaluate(() => window.__kutadguAuthCalls);
    expect(before.signIn).toBe(0);
    expect(before.refresh).toBeGreaterThan(0);
    await page.locator("#mfaGateOtp").fill(MOCK_OTP);
    await page.locator("#mfaGateForm").evaluate((form) => form.requestSubmit());
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await expect(page.locator("#mfaGatePanel")).toBeHidden();
    const after = await page.evaluate(() => window.__kutadguAuthCalls);
    expect(after.signIn).toBe(0);
    expect(after.challenge).toBe(1);
    expect(after.signOut).toBe(0);
  });

  test("expired restored session returns to login without wrong-code copy", async ({ page }) => {
    await installRestoredAdmin(page, { mode: "expired", currentLevel: "aal1" });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#loginPanel")).toBeVisible();
    await expect(page.locator("#dashboardPanel")).toBeHidden();
    await expect(page.locator("#mfaGatePanel")).toBeHidden();
    await expect(page.locator("#loginStatus")).toContainText("كىرىش ۋاقتى توشتى");
    await expect(page.locator("#loginStatus")).not.toContainText("كود توغرا ئەمەس");
    const calls = await page.evaluate(() => window.__kutadguAuthCalls);
    expect(calls.challenge).toBe(0);
    expect(calls.signOut).toBe(0);
  });

  test("explicit password login still reaches MFA then dashboard", async ({ page }) => {
    await installRestoredAdmin(page, { mode: "none", currentLevel: "aal1" });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#loginPanel")).toBeVisible();
    await page.locator("#adminEmail").fill("admin@example.com");
    await page.locator("#adminPassword").fill("not-a-production-secret");
    await page.locator("#loginForm").evaluate((form) => form.requestSubmit());
    await expect(page.locator("#mfaGatePanel")).toBeVisible();
    await page.locator("#mfaGateOtp").fill(MOCK_OTP);
    await page.locator("#mfaGateForm").evaluate((form) => form.requestSubmit());
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    const calls = await page.evaluate(() => window.__kutadguAuthCalls);
    expect(calls.signIn).toBe(1);
    expect(calls.challenge).toBe(1);
  });

  test("invalid OTP keeps the invalid-code message on the gate", async ({ page }) => {
    await installRestoredAdmin(page, { mode: "fresh", currentLevel: "aal1" });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#mfaGatePanel")).toBeVisible();
    await page.locator("#mfaGateOtp").fill(BAD_OTP);
    await page.locator("#mfaGateForm").evaluate((form) => form.requestSubmit());
    await expect(page.locator("#mfaGateStatus")).toContainText("كود توغرا ئەمەس ياكى ۋاقتى ئۆتۈپ كەتتى");
    await expect(page.locator("#mfaGatePanel")).toBeVisible();
    await expect(page.locator("#dashboardPanel")).toBeHidden();
    await expect(page.locator("#loginPanel")).toBeHidden();
  });

  test("session error during MFA returns to login without blaming the OTP", async ({ page }) => {
    await installRestoredAdmin(page, { mode: "fresh", currentLevel: "aal1" });
    await page.addInitScript(() => { window.__kutadguChallengeMode = "session"; });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#mfaGatePanel")).toBeVisible();
    await page.evaluate(() => { window.__kutadguChallengeMode = "session"; });
    await page.locator("#mfaGateOtp").fill(MOCK_OTP);
    await page.locator("#mfaGateForm").evaluate((form) => form.requestSubmit());
    await expect(page.locator("#loginPanel")).toBeVisible();
    await expect(page.locator("#loginStatus")).toContainText("كىرىش ۋاقتى توشتى");
    await expect(page.locator("#dashboardPanel")).toBeHidden();
    await expect(page.locator("#loginStatus")).not.toContainText("كود توغرا ئەمەس");
  });

  test("network error during MFA stays on the gate with a retry message", async ({ page }) => {
    await installRestoredAdmin(page, { mode: "fresh", currentLevel: "aal1" });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#mfaGatePanel")).toBeVisible();
    await page.evaluate(() => { window.__kutadguChallengeMode = "network"; });
    await page.locator("#mfaGateOtp").fill(MOCK_OTP);
    await page.locator("#mfaGateForm").evaluate((form) => form.requestSubmit());
    await expect(page.locator("#mfaGatePanel")).toBeVisible();
    await expect(page.locator("#mfaGateStatus")).toContainText("تور ياكى مۇلازىمېتېر");
    await expect(page.locator("#mfaGateStatus")).not.toContainText("كود توغرا ئەمەس");
    await expect(page.locator("#dashboardPanel")).toBeHidden();
  });

  test("successful challenge without AAL2 keeps the dashboard blocked", async ({ page }) => {
    await installRestoredAdmin(page, { mode: "fresh", currentLevel: "aal1" });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#mfaGatePanel")).toBeVisible();
    await page.evaluate(() => { window.__kutadguChallengeMode = "noaal2"; });
    await page.locator("#mfaGateOtp").fill(MOCK_OTP);
    await page.locator("#mfaGateForm").evaluate((form) => form.requestSubmit());
    await expect(page.locator("#mfaGatePanel")).toBeVisible();
    await expect(page.locator("#mfaGateStatus")).toContainText("دەلىللەش تامام بولمىدى");
    await expect(page.locator("#dashboardPanel")).toBeHidden();
    const level = await page.evaluate(() => window.__kutadguAal.currentLevel);
    expect(level).toBe("aal1");
  });

  test("INITIAL_SESSION plus TOKEN_REFRESHED does not open dashboard before AAL2", async ({ page }) => {
    await installRestoredAdmin(page, { mode: "restored", currentLevel: "aal1" });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#mfaGatePanel")).toBeVisible();
    await page.evaluate(async () => {
      (window.__kutadguAuthCbs || []).forEach((cb) => cb("TOKEN_REFRESHED", window.__kutadguMockSession));
      await window.__kutadguAdminTest.routeSession();
    });
    await expect(page.locator("#mfaGatePanel")).toBeVisible();
    await expect(page.locator("#dashboardPanel")).toBeHidden();
    const calls = await page.evaluate(() => window.__kutadguAuthCalls);
    expect(calls.signOut).toBe(0);
  });

  for (const viewport of [
    { name: "mobile", width: 390, height: 844 },
    { name: "mobile-412", width: 412, height: 915 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1280, height: 800 }
  ]) {
    test(`restored MFA gate usable at ${viewport.name} ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installRestoredAdmin(page, { mode: "fresh", currentLevel: "aal1" });
      await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
      await expect(page.locator("#mfaGatePanel")).toBeVisible();
      await expect(page.locator("#mfaGateOtp")).toBeVisible();
      await expect(page.locator("#mfaGateSubmit")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      expect(overflow).toBe(false);
    });
  }
});
