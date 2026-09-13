const { test, expect } = require("./playwright-test");

async function installSharedAuth(page, opts = {}) {
  const isAdmin = opts.isAdmin === true;
  const currentLevel = opts.currentLevel || (isAdmin ? "aal2" : "aal1");
  const userId = opts.userId || (isAdmin ? "admin-1" : "member-1");
  const email = opts.email || (isAdmin ? "admin@example.com" : "member@example.com");
  await page.addInitScript(({ isAdmin, currentLevel, userId, email }) => {
    const now = Math.floor(Date.now() / 1000);
    const user = { id: userId, email };
    function session(token) {
      return {
        access_token: token || "member-access",
        refresh_token: "refresh-token",
        expires_at: now + 3600,
        user
      };
    }
    window.__kutadguAuthCalls = { signOut: 0, signIn: 0 };
    window.__kutadguAuthCbs = [];
    window.__kutadguMockSession = session("shared-access");
    window.__kutadguAal = { currentLevel };
    window.__kutadguMfaApi = {
      async listFactors() {
        return { data: { all: [], totp: [], phone: [] }, error: null };
      },
      async getAuthenticatorAssuranceLevel() {
        return { data: { currentLevel: window.__kutadguAal.currentLevel, nextLevel: "aal2" }, error: null };
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
          getUser: async () => ({
            data: { user: window.__kutadguMockSession && window.__kutadguMockSession.user },
            error: window.__kutadguMockSession ? null : { name: "AuthSessionMissingError", message: "Auth session missing" }
          }),
          refreshSession: async () => ({
            data: { session: window.__kutadguMockSession, user: window.__kutadguMockSession && window.__kutadguMockSession.user },
            error: null
          }),
          onAuthStateChange: (cb) => {
            window.__kutadguAuthCbs.push(cb);
            setTimeout(() => cb("INITIAL_SESSION", window.__kutadguMockSession), 0);
            return { data: { subscription: { unsubscribe() {} } } };
          },
          signOut: async () => {
            window.__kutadguAuthCalls.signOut += 1;
            window.__kutadguMockSession = null;
            window.__kutadguAuthCbs.forEach((cb) => cb("SIGNED_OUT", null));
            return { error: null };
          },
          signInWithPassword: async () => {
            window.__kutadguAuthCalls.signIn += 1;
            return { error: null };
          },
          mfa: window.__kutadguMfaApi
        },
        from(table) {
          if (table === "admin_users") {
            return chain(isAdmin
              ? { data: { user_id: userId }, error: null, count: 1 }
              : { data: null, error: null, count: 0 });
          }
          if (table === "kutadgu_book_staff") {
            return chain({ data: null, error: null, count: 0 });
          }
          return chain({ data: [], error: null, count: 0 });
        },
        rpc: async () => ({ data: false, error: null }),
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
  }, { isAdmin, currentLevel, userId, email });
}

test.describe("Admin non-admin session must not globally sign out", () => {
  test("member session on admin.html stays signed in locally unauthorized", async ({ page }) => {
    await installSharedAuth(page, { isAdmin: false, userId: "staff-1", email: "staff@example.com" });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#loginPanel")).toBeVisible();
    await expect(page.locator("#dashboardPanel")).toBeHidden();
    await expect(page.locator("#mfaGatePanel")).toBeHidden();
    await expect(page.locator("#loginStatus")).toHaveText("بۇ ھېسابات Admin ھېسابى ئەمەس.");
    const before = await page.evaluate(() => ({
      signOut: window.__kutadguAuthCalls.signOut,
      hasSession: !!(window.__kutadguMockSession && window.__kutadguMockSession.user)
    }));
    expect(before.signOut).toBe(0);
    expect(before.hasSession).toBe(true);
    await page.evaluate(() => {
      (window.__kutadguAuthCbs || []).forEach((cb) => cb("SIGNED_IN", window.__kutadguMockSession));
    });
    await expect(page.locator("#loginPanel")).toBeVisible();
    const after = await page.evaluate(() => ({
      signOut: window.__kutadguAuthCalls.signOut,
      hasSession: !!(window.__kutadguMockSession && window.__kutadguMockSession.user)
    }));
    expect(after.signOut).toBe(0);
    expect(after.hasSession).toBe(true);
  });

  test("book-staff.html stays reachable while Admin shows unauthorized", async ({ page }) => {
    await installSharedAuth(page, { isAdmin: false, userId: "staff-1", email: "staff@example.com" });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#loginStatus")).toHaveText("بۇ ھېسابات Admin ھېسابى ئەمەس.");
    expect(await page.evaluate(() => window.__kutadguAuthCalls.signOut)).toBe(0);
    const staff = await page.goto("/book-staff.html", { waitUntil: "domcontentloaded" });
    expect(staff && staff.ok()).toBeTruthy();
    await expect(page.locator("body")).toBeVisible();
  });

  test("Full Admin AAL2 still opens the dashboard", async ({ page }) => {
    await installSharedAuth(page, { isAdmin: true, currentLevel: "aal2" });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await expect(page.locator("#loginPanel")).toBeHidden();
    expect(await page.evaluate(() => window.__kutadguAuthCalls.signOut)).toBe(0);
  });

  test("explicit Admin logout still signs out", async ({ page }) => {
    await installSharedAuth(page, { isAdmin: true, currentLevel: "aal2" });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await page.locator("#adminLogout").click();
    await expect(page.locator("#loginPanel")).toBeVisible();
    const calls = await page.evaluate(() => ({
      signOut: window.__kutadguAuthCalls.signOut,
      hasSession: !!window.__kutadguMockSession
    }));
    expect(calls.signOut).toBeGreaterThan(0);
    expect(calls.hasSession).toBe(false);
  });
});
