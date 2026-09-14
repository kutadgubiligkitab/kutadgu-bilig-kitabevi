const { test, expect } = require("./playwright-test");

const MEMBER_KEY = "kutadgu-member-auth-v1";
const ADMIN_KEY = "kutadgu-admin-auth-v1";

async function installIsolatedAuth(page, opts = {}) {
  const memberUser = opts.memberUser || null;
  const adminUser = opts.adminUser || null;
  await page.addInitScript(({ memberUser, adminUser, MEMBER_KEY, ADMIN_KEY }) => {
    const now = Math.floor(Date.now() / 1000);
    function blob(user, token) {
      if (!user) return null;
      return {
        access_token: token,
        refresh_token: token + "-refresh",
        expires_at: now + 3600,
        user
      };
    }
    function read(kind) {
      try {
        const raw = localStorage.getItem(kind === "admin" ? ADMIN_KEY : MEMBER_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    }
    function write(kind, session) {
      const key = kind === "admin" ? ADMIN_KEY : MEMBER_KEY;
      if (!session) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(session));
    }
    if (localStorage.getItem("__kutadguIsolatedSeeded") !== "1") {
      write("member", blob(memberUser, "member-access"));
      write("admin", blob(adminUser, "admin-access"));
      localStorage.setItem("__kutadguIsolatedSeeded", "1");
    }
    window.__kutadguAuthCalls = window.__kutadguAuthCalls || { memberSignOut: 0, adminSignOut: 0, memberSignIn: 0, adminSignIn: 0 };
    window.__kutadguReadAuth = read;
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
    function makeClient(kind) {
      const isAdmin = kind === "admin";
      const getSession = () => read(kind);
      const setSession = (s) => write(kind, s);
      const user = () => getSession() && getSession().user;
      return {
        auth: {
          initialize: async () => {},
          getSession: async () => ({ data: { session: getSession() }, error: null }),
          getUser: async () => ({ data: { user: user() || null }, error: user() ? null : { name: "AuthSessionMissingError" } }),
          refreshSession: async () => ({ data: { session: getSession(), user: user() }, error: null }),
          onAuthStateChange: (cb) => {
            setTimeout(() => cb("INITIAL_SESSION", getSession()), 0);
            return { data: { subscription: { unsubscribe() {} } } };
          },
          signOut: async (opts) => {
            if (!opts || opts.scope !== "local") throw new Error("expected local signOut");
            if (isAdmin) window.__kutadguAuthCalls.adminSignOut += 1;
            else window.__kutadguAuthCalls.memberSignOut += 1;
            setSession(null);
            return { error: null };
          },
          signInWithPassword: async ({ email }) => {
            const next = blob({ id: isAdmin ? "admin-1" : "member-1", email }, isAdmin ? "admin-access" : "member-access");
            setSession(next);
            if (isAdmin) window.__kutadguAuthCalls.adminSignIn += 1;
            else window.__kutadguAuthCalls.memberSignIn += 1;
            return { error: null };
          },
          signInWithOAuth: async () => {
            if (isAdmin) throw new Error("Admin must not use Google OAuth");
            return { data: {}, error: null };
          },
          mfa: {
            async listFactors() { return { data: { all: [], totp: [], phone: [] }, error: null }; },
            async getAuthenticatorAssuranceLevel() {
              return { data: { currentLevel: isAdmin ? "aal2" : "aal1", nextLevel: "aal2" }, error: null };
            }
          }
        },
        from(table) {
          if (table === "admin_users") {
            const u = user();
            const ok = isAdmin && u && u.id === "admin-1";
            return chain(ok ? { data: { user_id: "admin-1" }, error: null, count: 1 } : { data: null, error: null, count: 0 });
          }
          return chain({ data: [], error: null, count: 0 });
        },
        rpc: async () => ({ data: false, error: null }),
        storage: { from() { return { upload: async () => ({ error: null }), getPublicUrl() { return { data: { publicUrl: "" } }; } }; } }
      };
    }
    let supabaseValue;
    Object.defineProperty(window, "supabase", {
      configurable: true,
      enumerable: true,
      get() { return supabaseValue; },
      set(v) {
        if (v && typeof v.createClient === "function") {
          v.createClient = function (url, key, options) {
            const storageKey = options && options.auth && options.auth.storageKey;
            if (storageKey === ADMIN_KEY) return makeClient("admin");
            return makeClient("member");
          };
        }
        supabaseValue = v;
      }
    });
  }, { memberUser, adminUser, MEMBER_KEY, ADMIN_KEY });
}

async function authState(page) {
  return page.evaluate(({ MEMBER_KEY, ADMIN_KEY }) => {
    function parse(key) {
      try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; }
    }
    return {
      member: parse(MEMBER_KEY),
      admin: parse(ADMIN_KEY),
      calls: window.__kutadguAuthCalls
    };
  }, { MEMBER_KEY, ADMIN_KEY });
}

test.describe("Admin and Member auth sessions are isolated", () => {
  test("A. Admin session does not create a storefront Member session", async ({ page }) => {
    await installIsolatedAuth(page, { adminUser: { id: "admin-1", email: "admin-owner@example.com" } });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    const state = await authState(page);
    expect(state.member).toBeFalsy();
    expect(state.admin && state.admin.user.id).toBe("admin-1");
  });

  test("D. Member logout is local and leaves Admin signed in", async ({ page }) => {
    await installIsolatedAuth(page, {
      adminUser: { id: "admin-1", email: "admin-owner@example.com" },
      memberUser: { id: "member-1", email: "customer@example.com" }
    });
    await page.goto("/account.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      if (window.KutadguMember && window.KutadguMember.signOut) await window.KutadguMember.signOut();
    });
    const state = await authState(page);
    expect(state.member).toBeFalsy();
    expect(state.admin && state.admin.user.id).toBe("admin-1");
    expect(state.calls.memberSignOut).toBeGreaterThan(0);
    expect(state.calls.adminSignOut).toBe(0);
  });

  test("E. Admin logout is local and leaves Member signed in", async ({ page }) => {
    await installIsolatedAuth(page, {
      adminUser: { id: "admin-1", email: "admin-owner@example.com" },
      memberUser: { id: "member-1", email: "customer@example.com" }
    });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await page.locator("#adminLogout").click();
    const state = await authState(page);
    expect(state.admin).toBeFalsy();
    expect(state.member && state.member.user.id).toBe("member-1");
    expect(state.calls.adminSignOut).toBeGreaterThan(0);
    expect(state.calls.memberSignOut).toBe(0);
  });

  test("F. same user in both namespaces survives the other logout", async ({ page }) => {
    const same = { id: "admin-1", email: "same@example.com" };
    await installIsolatedAuth(page, { adminUser: same, memberUser: same });
    await page.goto("/account.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => { await window.KutadguMember.signOut(); });
    let state = await authState(page);
    expect(state.member).toBeFalsy();
    expect(state.admin && state.admin.user.email).toBe("same@example.com");
    await page.evaluate(({ MEMBER_KEY }) => {
      const now = Math.floor(Date.now() / 1000);
      localStorage.setItem(MEMBER_KEY, JSON.stringify({
        access_token: "member-access",
        refresh_token: "member-access-refresh",
        expires_at: now + 3600,
        user: { id: "admin-1", email: "same@example.com" }
      }));
    }, { MEMBER_KEY });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await page.locator("#adminLogout").click();
    state = await authState(page);
    expect(state.admin).toBeFalsy();
    expect(state.member && state.member.user.email).toBe("same@example.com");
  });

  test("I. non-admin identity on the Admin client is unauthorized without Member signOut", async ({ page }) => {
    await installIsolatedAuth(page, {
      adminUser: { id: "member-1", email: "customer@example.com" },
      memberUser: { id: "member-1", email: "customer@example.com" }
    });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#loginStatus")).toHaveText("بۇ ھېسابات Admin ھېسابى ئەمەس.");
    const state = await authState(page);
    expect(state.member && state.member.user.id).toBe("member-1");
    expect(state.calls.memberSignOut).toBe(0);
    expect(state.calls.adminSignOut).toBe(0);
  });

  test("H. Book Staff uses Member keys and does not construct Admin login", async ({ page }) => {
    await installIsolatedAuth(page, { memberUser: { id: "member-1", email: "staff@example.com" } });
    await page.goto("/book-staff.html", { waitUntil: "domcontentloaded" });
    const keys = await page.evaluate(() => ({
      memberFn: !!(window.KutadguMember && window.KutadguMember.getClient),
      memberKey: window.KUTADGU_MEMBER_AUTH_STORAGE_KEY,
      adminKey: window.KUTADGU_ADMIN_AUTH_STORAGE_KEY
    }));
    expect(keys.memberFn).toBe(true);
    expect(keys.memberKey).toBe(MEMBER_KEY);
    expect(keys.adminKey).toBe(ADMIN_KEY);
  });
});
