const { test, expect } = require("./playwright-test");

const VERIFIED = [{ id: "factor-v", factor_type: "totp", status: "verified" }];
const IDLE_KEY = "kutadgu-admin-idle-v1";

async function installLiveAal2Admin(page) {
  const factors = VERIFIED;
  await page.addInitScript(({ factors }) => {
    const session = { user: { id: "admin-1", email: "admin@example.com" }, access_token: "test-access" };
    window.__kutadguMockSession = session;
    window.__kutadguAuthCbs = [];
    window.__kutadguSignOutCalls = 0;
    window.__kutadguAdminAalTest = { currentLevel: "aal2", factors };
    window.__kutadguMfaFactors = factors.map((f) => ({ ...f }));
    window.__kutadguMfaUnenrollLog = [];
    window.__kutadguMfaApi = {
      async listFactors() {
        const all = (window.__kutadguMfaFactors || []).map((f) => ({ ...f }));
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
        const level = window.__kutadguAdminAalTest && window.__kutadguAdminAalTest.currentLevel;
        return { data: { currentLevel: level, nextLevel: "aal2" }, error: null };
      },
      async challengeAndVerify({ code }) {
        if (String(code) !== "123456") {
          return { data: null, error: { message: "Invalid code" } };
        }
        return { data: {}, error: null };
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
          getSession: async () => ({ data: { session: window.__kutadguMockSession }, error: null }),
          onAuthStateChange: (cb) => {
            window.__kutadguAuthCbs.push(cb);
            setTimeout(() => cb("INITIAL_SESSION", window.__kutadguMockSession), 0);
            return { data: { subscription: { unsubscribe() {} } } };
          },
          signOut: async () => {
            window.__kutadguSignOutCalls += 1;
            window.__kutadguMockSession = null;
            return { error: null };
          },
          signInWithPassword: async () => ({ error: null }),
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
  }, { factors });
}

async function preloadExactIdleLock(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("kutadgu-admin-idle-v1", JSON.stringify({ lastActivity: 1, locked: true }));
    } catch (e) {}
  });
}

async function installIdleAdmin(page, opts = {}) {
  const currentLevel = opts.currentLevel || "aal2";
  const factors = opts.factors || VERIFIED;
  const idleMs = opts.idleMs || 50;
  const clock = opts.clock == null ? 1_000_000 : opts.clock;
  const locked = !!opts.locked;
  const lastActivity = opts.lastActivity == null ? (locked ? clock - idleMs : clock) : opts.lastActivity;
  await page.addInitScript(({ currentLevel, factors, idleMs, clock, locked, lastActivity, IDLE_KEY }) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguAdminAalTest = { currentLevel, factors };
    window.__kutadguAdminIdleMs = idleMs;
    window.__kutadguIdleClock = clock;
    window.__kutadguAdminIdleNow = () => window.__kutadguIdleClock;
    window.__kutadguMfaFactors = factors.map((f) => ({ ...f }));
    window.__kutadguMfaUnenrollLog = [];
    try {
      localStorage.setItem(IDLE_KEY, JSON.stringify({ lastActivity, locked }));
    } catch (e) {}
    window.__kutadguMfaApi = {
      async listFactors() {
        const all = (window.__kutadguMfaFactors || []).map((f) => ({ ...f }));
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
        const level = window.__kutadguAdminAalTest && window.__kutadguAdminAalTest.currentLevel;
        return { data: { currentLevel: level, nextLevel: "aal2" }, error: null };
      },
      async challengeAndVerify({ code }) {
        if (String(code) !== "123456") {
          return { data: null, error: { message: "Invalid code" } };
        }
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
  }, { currentLevel, factors, idleMs, clock, locked, lastActivity, IDLE_KEY });
}

test.describe("stage 2C Admin idle lock", () => {
  test("active Admin before timeout sees dashboard", async ({ page }) => {
    await installIdleAdmin(page, { locked: false });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await expect(page.locator("#idleLockPanel")).toBeHidden();
  });

  test("timeout hides dashboard and shows lock", async ({ page }) => {
    await installIdleAdmin(page, { locked: true });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#idleLockPanel")).toBeVisible();
    await expect(page.locator("#dashboardPanel")).toBeHidden();
    await expect(page.locator("#idleLockPanel")).toContainText("Admin قۇلۇپلانغان");
  });

  test("aal2 cannot bypass an active idle lock", async ({ page }) => {
    await installIdleAdmin(page, { currentLevel: "aal2", locked: true });
    await page.goto("/admin.html#books", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#idleLockPanel")).toBeVisible();
    await expect(page.locator("#dashboardPanel")).toBeHidden();
    await expect(page.locator("#mfaGatePanel")).toBeHidden();
  });

  test("reload after timeout remains locked", async ({ page }) => {
    await installIdleAdmin(page, { locked: true });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#idleLockPanel")).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#idleLockPanel")).toBeVisible();
    await expect(page.locator("#dashboardPanel")).toBeHidden();
  });

  test("valid TOTP unlocks dashboard; bad OTP stays locked and does not unenroll", async ({ page }) => {
    await installIdleAdmin(page, { locked: true });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await page.locator("#idleLockOtp").fill("000000");
    await page.locator("#idleLockSubmit").click();
    await expect(page.locator("#idleLockPanel")).toBeVisible();
    await expect(page.locator("#idleLockOtp")).toHaveValue("");
    await expect(page.locator("#idleLockStatus")).toContainText("كود توغرا ئەمەس");
    const unenroll = await page.evaluate(() => (window.__kutadguMfaUnenrollLog || []).length);
    expect(unenroll).toBe(0);
    await page.locator("#idleLockOtp").fill("123456");
    await page.locator("#idleLockSubmit").click();
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await expect(page.locator("#idleLockPanel")).toBeHidden();
  });

  test("trusted pointerdown resets timer so tick does not lock", async ({ page }) => {
    await installIdleAdmin(page, { locked: false, idleMs: 50, clock: 1_000_000, lastActivity: 1_000_000 });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await page.evaluate(() => { window.__kutadguIdleClock += 20; });
    await page.locator("#dashboardPanel").click({ position: { x: 24, y: 24 } });
    await page.evaluate(() => {
      window.__kutadguIdleClock += 20;
      window.__kutadguAdminTest.tickAdminIdle();
    });
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await expect(page.locator("#idleLockPanel")).toBeHidden();
  });

  test("untrusted synthetic pointerdown does not reset the idle timer", async ({ page }) => {
    await installIdleAdmin(page, { locked: false, idleMs: 50, clock: 1_000_000, lastActivity: 1_000_000 });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await page.locator("#dashboardPanel").dispatchEvent("pointerdown");
    await page.locator("#dashboardPanel").dispatchEvent("keydown");
    await page.locator("#dashboardPanel").dispatchEvent("touchstart");
    await page.evaluate(() => {
      window.__kutadguIdleClock += 50;
      window.__kutadguAdminTest.tickAdminIdle();
    });
    await expect(page.locator("#idleLockPanel")).toBeVisible();
  });

  test("inactivity then tickAdminIdle locks without signOut", async ({ page }) => {
    await installIdleAdmin(page, { locked: false, idleMs: 50, clock: 1_000_000, lastActivity: 1_000_000 });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await page.evaluate(() => {
      window.__kutadguIdleClock += 50;
      window.__kutadguAdminTest.tickAdminIdle();
    });
    await expect(page.locator("#idleLockPanel")).toBeVisible();
    await expect(page.locator("#dashboardPanel")).toBeHidden();
  });

  test("token refresh routeSession does not unlock", async ({ page }) => {
    await installIdleAdmin(page, { locked: true });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#idleLockPanel")).toBeVisible();
    await page.evaluate(async () => {
      await window.__kutadguAdminTest.openAuthorizedDashboard();
    });
    await expect(page.locator("#idleLockPanel")).toBeVisible();
    await expect(page.locator("#dashboardPanel")).toBeHidden();
  });

  test("mousemove and scroll do not reset the idle timer", async ({ page }) => {
    await installIdleAdmin(page, { locked: false, idleMs: 50, clock: 1_000_000, lastActivity: 1_000_000 });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await page.mouse.move(20, 20);
    await page.mouse.move(80, 80);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("scroll", { bubbles: true }));
      document.dispatchEvent(new Event("scroll", { bubbles: true }));
      window.__kutadguIdleClock += 50;
      window.__kutadguAdminTest.tickAdminIdle();
    });
    await expect(page.locator("#idleLockPanel")).toBeVisible();
  });

  test("trusted keydown resets the idle timer", async ({ page }) => {
    await installIdleAdmin(page, { locked: false, idleMs: 50, clock: 1_000_000, lastActivity: 1_000_000 });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await page.evaluate(() => { window.__kutadguIdleClock += 20; });
    await page.locator("#adminSearch").click();
    await page.keyboard.press("a");
    await page.evaluate(() => {
      window.__kutadguIdleClock += 20;
      window.__kutadguAdminTest.tickAdminIdle();
    });
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await expect(page.locator("#idleLockPanel")).toBeHidden();
  });

  test("token refresh does not reset lastActivity", async ({ page }) => {
    await installIdleAdmin(page, { locked: false, idleMs: 50_000, clock: 1_000_000, lastActivity: 1_000_000 });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    const times = await page.evaluate(async () => {
      const before = JSON.parse(localStorage.getItem("kutadgu-admin-idle-v1") || "{}").lastActivity;
      window.__kutadguIdleClock += 10_000;
      await window.__kutadguAdminTest.routeSession();
      const after = JSON.parse(localStorage.getItem("kutadgu-admin-idle-v1") || "{}").lastActivity;
      return { before, after };
    });
    expect(times.after).toBe(times.before);
    await expect(page.locator("#dashboardPanel")).toBeVisible();
  });

  test("OTP is not written to localStorage or sessionStorage", async ({ page }) => {
    await installIdleAdmin(page, { locked: true });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await page.locator("#idleLockOtp").fill("123456");
    const blob = await page.evaluate(() => {
      const dump = (store) => {
        const out = [];
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          out.push(k + "=" + store.getItem(k));
        }
        return out.join("\n");
      };
      return dump(localStorage) + "\n" + dump(sessionStorage);
    });
    expect(blob).not.toMatch(/123456/);
    expect(blob).not.toMatch(/sb-.*auth-token.*=.*123456/);
  });

  test("idle lock does not call signOut (no auth token cleared)", async ({ page }) => {
    await installIdleAdmin(page, { locked: true });
    await page.addInitScript(() => {
      try { localStorage.setItem("sb-fxlojnqwyojqjskfggmh-auth-token", JSON.stringify({ access_token: "keep" })); } catch (e) {}
    });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#idleLockPanel")).toBeVisible();
    const kept = await page.evaluate(() => localStorage.getItem("sb-fxlojnqwyojqjskfggmh-auth-token"));
    expect(kept).toContain("keep");
  });

  test("idle lock logout uses explicit logout and shows login", async ({ page }) => {
    await installIdleAdmin(page, { locked: true });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await page.locator("#idleLockLogout").click();
    await expect(page.locator("#loginPanel")).toBeVisible();
    await expect(page.locator("#idleLockPanel")).toBeHidden();
    await expect(page.locator("#dashboardPanel")).toBeHidden();
    const idleRaw = await page.evaluate(() => localStorage.getItem("kutadgu-admin-idle-v1"));
    expect(idleRaw).toBeNull();
  });

  test("aal1 verified factor still uses MFA gate when idle lock is not active", async ({ page }) => {
    await installIdleAdmin(page, { currentLevel: "aal1", locked: false });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#mfaGatePanel")).toBeVisible();
    await expect(page.locator("#idleLockPanel")).toBeHidden();
    await expect(page.locator("#dashboardPanel")).toBeHidden();
  });

  test("idle lock takes precedence over aal1 MFA gate", async ({ page }) => {
    await installIdleAdmin(page, { currentLevel: "aal1", locked: true });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#idleLockPanel")).toBeVisible();
    await expect(page.locator("#mfaGatePanel")).toBeHidden();
    await expect(page.locator("#dashboardPanel")).toBeHidden();
  });
});

for (const [width, height] of [[390, 844], [768, 1024], [1280, 800]]) {
  test.describe(`idle lock viewport ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });
    test(`lock controls usable at ${width}`, async ({ page }) => {
      await installIdleAdmin(page, { locked: true });
      await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
      await expect(page.locator("#idleLockOtp")).toBeVisible();
      await expect(page.locator("#idleLockSubmit")).toBeVisible();
      const box = await page.locator("#idleLockSubmit").boundingBox();
      expect(box && box.height).toBeGreaterThanOrEqual(20);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      expect(overflow).toBe(false);
    });
  });
}

test.describe("idle lock shared Admin tabs", () => {
  test("new Admin tab stays locked after shared timeout", async ({ context }) => {
    const page1 = await context.newPage();
    await installIdleAdmin(page1, { locked: true });
    await page1.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page1.locator("#idleLockPanel")).toBeVisible();
    const page2 = await context.newPage();
    await installIdleAdmin(page2, { locked: true });
    await page2.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page2.locator("#idleLockPanel")).toBeVisible();
    await expect(page2.locator("#dashboardPanel")).toBeHidden();
    await page2.close();
  });

  test("activity in one Admin tab keeps the other Admin tab active", async ({ context }) => {
    const page1 = await context.newPage();
    await installIdleAdmin(page1, { locked: false, idleMs: 50, clock: 1_000_000, lastActivity: 1_000_000 });
    await page1.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page1.locator("#dashboardPanel")).toBeVisible();
    const page2 = await context.newPage();
    await installIdleAdmin(page2, { locked: false, idleMs: 50, clock: 1_000_000, lastActivity: 1_000_000 });
    await page2.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page2.locator("#dashboardPanel")).toBeVisible();
    await page1.evaluate(() => { window.__kutadguIdleClock += 20; });
    await page1.locator("#dashboardPanel").click({ position: { x: 24, y: 24 } });
    await page2.evaluate(() => {
      window.__kutadguIdleClock += 50;
      window.__kutadguAdminTest.tickAdminIdle();
    });
    await expect(page2.locator("#dashboardPanel")).toBeVisible();
    await expect(page2.locator("#idleLockPanel")).toBeHidden();
    await page1.close();
    await page2.close();
  });
});

test.describe("exact Preview persisted lock reproduction", () => {
  test("localStorage locked true on live aal2 boot keeps dashboard hidden", async ({ page }) => {
    await preloadExactIdleLock(page);
    await installLiveAal2Admin(page);
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#idleLockPanel")).toBeVisible();
    await expect(page.locator("#dashboardPanel")).toBeHidden();
    await expect(page.locator("#mfaGatePanel")).toBeHidden();
    const snap = await page.evaluate(() => localStorage.getItem("kutadgu-admin-idle-v1"));
    expect(snap).toBe("{\"lastActivity\":1,\"locked\":true}");
    const signOuts = await page.evaluate(() => window.__kutadguSignOutCalls || 0);
    expect(signOuts).toBe(0);
    await page.evaluate(async () => {
      (window.__kutadguAuthCbs || []).forEach((cb) => cb("TOKEN_REFRESHED", window.__kutadguMockSession));
      await window.__kutadguAdminTest.routeSession();
      await window.__kutadguAdminTest.openAuthorizedDashboard();
    });
    await expect(page.locator("#idleLockPanel")).toBeVisible();
    await expect(page.locator("#dashboardPanel")).toBeHidden();
    const snap2 = await page.evaluate(() => localStorage.getItem("kutadgu-admin-idle-v1"));
    expect(snap2).toBe("{\"lastActivity\":1,\"locked\":true}");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#idleLockPanel")).toBeVisible();
    await expect(page.locator("#dashboardPanel")).toBeHidden();
    const snap3 = await page.evaluate(() => localStorage.getItem("kutadgu-admin-idle-v1"));
    expect(snap3).toBe("{\"lastActivity\":1,\"locked\":true}");
  });

  test("activity cannot unlock persisted lock; TOTP unlock can", async ({ page }) => {
    await preloadExactIdleLock(page);
    await installLiveAal2Admin(page);
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#idleLockPanel")).toBeVisible();
    await page.mouse.click(40, 40);
    await page.keyboard.press("a");
    const stillLocked = await page.evaluate(() => localStorage.getItem("kutadgu-admin-idle-v1"));
    expect(stillLocked).toBe("{\"lastActivity\":1,\"locked\":true}");
    await page.locator("#idleLockOtp").fill("000000");
    await page.locator("#idleLockSubmit").click();
    await expect(page.locator("#idleLockPanel")).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("kutadgu-admin-idle-v1")).locked)).toBe(true);
    expect(await page.evaluate(() => window.__kutadguSignOutCalls || 0)).toBe(0);
    await page.locator("#idleLockOtp").fill("123456");
    await page.locator("#idleLockSubmit").click();
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await expect(page.locator("#idleLockPanel")).toBeHidden();
    const unlocked = await page.evaluate(() => JSON.parse(localStorage.getItem("kutadgu-admin-idle-v1")));
    expect(unlocked.locked).toBe(false);
    expect(unlocked.lastActivity).toBeGreaterThan(1);
  });
});
