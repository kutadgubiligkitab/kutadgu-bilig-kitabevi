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
  await expect(page.locator("#feedbackForm")).toBeHidden();
  await page.evaluate(() => window.__pending.resolve({ data: { id: window.__pending.args.p_id, replayed: false }, error: null }));
  await expect(page.locator("#feedbackBody")).toHaveValue("");
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

function installRealMember(page) {
  return page.addInitScript(() => {
    window.__calls = [];
    window.__profiles = {
      "member-a": { id: "member-a", status: "active", full_name: "ئەزا أ" },
      "member-b": { id: "member-b", status: "active", full_name: "ئەزا ب" }
    };
    window.__holdMerge = false;
    window.__mergeWaiting = [];
    window.__holdRpc = false;
    window.__rpcPending = null;
    window.__rpcQueue = [];
    window.__profileError = false;
    window.__signOutMode = "";
    window.__signOutCalls = 0;
    window.__session = {
      access_token: "token-member-a",
      refresh_token: "refresh-member-a",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "member-a", email: "member-a@example.com" }
    };
    try {
      const extra = JSON.parse(sessionStorage.getItem("kutadgu-feedback-member") || "{}");
      (extra.omit || []).forEach((id) => { delete window.__profiles[id]; });
      if (extra.profileError) window.__profileError = true;
    } catch (error) {}
    function chain(table) {
      const state = { table: table, id: "" };
      const builder = {
        select() { return builder; },
        eq(col, val) { state.id = val; return builder; },
        in() { return builder; },
        order() { return builder; },
        update() { return builder; },
        delete() { return builder; },
        upsert() { return Promise.resolve({ data: null, error: null }); },
        maybeSingle() {
          if (state.table !== "profiles") return Promise.resolve({ data: null, error: null });
          if (window.__profileError) return Promise.resolve({ data: null, error: { message: "profile down" } });
          return Promise.resolve({ data: window.__profiles[state.id] || null, error: null });
        },
        then(ok, err) {
          const finish = () => {
            if (window.__holdMerge && (state.table === "member_favorites" || state.table === "member_cart_items")) {
              return new Promise((resolve) => {
                window.__mergeWaiting.push(() => resolve({ data: [], error: null }));
              });
            }
            return Promise.resolve({ data: [], error: null });
          };
          return finish().then(ok, err);
        }
      };
      return builder;
    }
    window.__memberDb = {
      auth: {
        onAuthStateChange(cb) {
          window.__authListeners = window.__authListeners || [];
          window.__authListeners.push(cb);
          window.__authCb = (event, session) => {
            window.__authListeners.slice().forEach((listener) => listener(event, session));
          };
          return { data: { subscription: { unsubscribe() {} } } };
        },
        getSession() { return Promise.resolve({ data: { session: window.__session }, error: null }); },
        refreshSession() { return Promise.resolve({ data: { session: null }, error: { message: "no refresh" } }); },
        signOut() {
          window.__signOutCalls += 1;
          if (window.__signOutMode === "reject") return Promise.reject(new Error("sign out rejected"));
          if (window.__signOutMode === "error") return Promise.resolve({ error: { message: "sign out failed" } });
          if (window.__signOutMode === "delay") {
            return new Promise((resolve, reject) => {
              window.__signOutResolve = resolve;
              window.__signOutReject = reject;
            });
          }
          window.__session = null;
          if (window.__authCb) window.__authCb("SIGNED_OUT", null);
          return Promise.resolve({ error: null });
        }
      },
      from: chain,
      rpc(name, args) {
        if (name !== "submit_website_feedback") return Promise.resolve({ data: null, error: null });
        const entry = { name: name, args: args, authUser: window.__session && window.__session.user && window.__session.user.id };
        window.__calls.push(entry);
        if (window.__holdRpc) {
          return new Promise((resolve, reject) => {
            const pending = { resolve: resolve, reject: reject, entry: entry };
            window.__rpcQueue.push(pending);
            window.__rpcPending = pending;
          });
        }
        return Promise.resolve({ data: { id: args.p_id, replayed: false }, error: null });
      }
    };
    window.KUTADGU_SUPABASE_CONFIG = { url: "https://example.supabase.co", anonKey: "public-anon-test-key" };
    const mockSdk = { createClient() { return window.__memberDb; } };
    Object.defineProperty(window, "supabase", {
      configurable: true,
      get() { return mockSdk; },
      set() {}
    });
  });
}

function sessionFor(id) {
  return {
    access_token: "token-" + id,
    refresh_token: "refresh-" + id,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: id, email: id + "@example.com" }
  };
}

test("real member.js blocks submission until an eligible profile exists", async ({ page }) => {
  await installRealMember(page);
  await page.goto("/feedback", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => sessionStorage.setItem("kutadgu-feedback-member", JSON.stringify({ omit: ["member-a"] })));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.KutadguMember && window.KutadguMember.getUser && window.KutadguMember.getUser());
  await expect(page.locator("#feedbackForm")).toBeHidden();
  await page.evaluate(() => document.getElementById("feedbackForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(await page.evaluate(() => window.__calls.length)).toBe(0);
  await page.evaluate((session) => {
    window.__profiles["member-a"] = { id: "member-a", status: "active", full_name: "ئەزا أ" };
    window.__session = session;
    window.__authCb("SIGNED_IN", session);
  }, sessionFor("member-a"));
  await expect(page.locator("#feedbackForm")).toBeVisible();
});

test("an in-flight A submission cannot finish inside B's session", async ({ page }) => {
  await installRealMember(page);
  await page.goto("/feedback", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#feedbackForm")).toBeVisible();
  await page.locator("#feedbackBody").fill("A نىڭ مەخپىي پىكرى");
  await page.evaluate(() => { window.__holdRpc = true; });
  await page.locator("#feedbackSubmit").click();
  await page.waitForFunction(() => window.__calls.length === 1);
  await page.evaluate((session) => {
    window.__holdMerge = true;
    window.__authCb("SIGNED_IN", session);
  }, sessionFor("member-a"));
  await page.waitForFunction(() => window.__mergeWaiting.length >= 1);
  expect(await page.evaluate(() => window.KutadguMember.getUser().id)).toBe("member-a");
  await page.evaluate((session) => {
    window.__session = session;
    window.__authCb("SIGNED_IN", session);
  }, sessionFor("member-b"));
  await expect(page.locator("#feedbackBody")).toHaveValue("");
  await expect(page.locator("#feedbackForm")).toBeHidden();
  await page.evaluate(() => window.__rpcPending.resolve({ data: { id: window.__rpcPending.entry.args.p_id, replayed: false }, error: null }));
  await expect(page.locator("#feedbackStatus")).not.toHaveText("پىكىرىڭىز يوللاندى. رەھمەت.");
  expect(await page.evaluate(() => window.__calls.length)).toBe(1);
  expect(await page.evaluate(() => window.__calls[0].authUser)).toBe("member-a");
  await page.evaluate(() => document.getElementById("feedbackForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(await page.evaluate(() => window.__calls.length)).toBe(1);
  await page.evaluate(() => {
    window.__holdMerge = false;
    window.__holdRpc = false;
    window.__mergeWaiting.splice(0).forEach((release) => release());
  });
  await expect(page.locator("#feedbackForm")).toBeVisible();
  await expect(page.locator("#feedbackBody")).toHaveValue("");
  await expect(page.locator("#feedbackStatus")).not.toHaveText("پىكىرىڭىز يوللاندى. رەھمەت.");
  await page.locator("#feedbackBody").fill("B نىڭ پىكرى");
  await page.locator("#feedbackSubmit").click();
  await expect.poll(() => page.evaluate(() => window.__calls.length)).toBe(2);
  expect(await page.evaluate(() => window.__calls[1].authUser)).toBe("member-b");
  expect(await page.evaluate(() => window.__calls[1].args.p_body)).toBe("B نىڭ پىكرى");
});

test("an older request cannot change the newer member's pending submission", async ({ page }) => {
  await installRealMember(page);
  await page.goto("/feedback", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#feedbackForm")).toBeVisible();

  async function holdPair(oldFailure) {
    await page.evaluate((session) => {
      window.__holdRpc = true;
      window.__holdMerge = false;
      window.__session = session;
      window.__authCb("SIGNED_IN", session);
    }, sessionFor("member-a"));
    await page.waitForFunction(() => {
      const user = window.KutadguMember.getUser();
      const profile = window.KutadguMember.getProfile();
      return user && user.id === "member-a" && profile && profile.status === "active";
    });
    await expect(page.locator("#feedbackForm")).toBeVisible();
    await page.locator("#feedbackBody").fill("A نىڭ مەخپىي پىكرى");
    await page.locator("#feedbackSubmit").click();
    await page.waitForFunction(() => window.__rpcQueue.length === 1);
    await page.evaluate((session) => {
      window.__holdMerge = true;
      window.__session = session;
      window.__authCb("SIGNED_IN", session);
    }, sessionFor("member-b"));
    await page.waitForFunction(() => window.__mergeWaiting.length >= 1);
    await page.evaluate(() => {
      window.__holdMerge = false;
      window.__mergeWaiting.splice(0).forEach((release) => release());
    });
    await expect(page.locator("#feedbackForm")).toBeVisible();
    await expect(page.locator("#feedbackBody")).toHaveValue("");
    await page.locator("#feedbackBody").fill("B نىڭ پىكرى");
    await page.locator("#feedbackSubmit").click();
    await page.waitForFunction(() => window.__rpcQueue.length === 2);
    await expect(page.locator("#feedbackSubmit")).toBeDisabled();
    await expect(page.locator("#feedbackStatus")).toHaveText("يوللىنىۋاتىدۇ…");
    await page.evaluate(() => document.getElementById("feedbackForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(await page.evaluate(() => window.__calls.length)).toBe(2);
    await page.evaluate(oldFailure);
    await expect(page.locator("#feedbackBody")).toHaveValue("B نىڭ پىكرى");
    await expect(page.locator("#feedbackStatus")).toHaveText("يوللىنىۋاتىدۇ…");
    await expect(page.locator("#feedbackSubmit")).toBeDisabled();
    await expect(page.locator("#feedbackStatus")).not.toHaveText("پىكىرىڭىز يوللاندى. رەھمەت.");
    await expect(page.locator("#feedbackStatus")).not.toHaveText("پىكىر يوللانمىدى. قايتا سىناڭ.");
    await page.evaluate(() => document.getElementById("feedbackForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(await page.evaluate(() => window.__calls.length)).toBe(2);
    expect(await page.evaluate(() => window.__calls[1].authUser)).toBe("member-b");
    expect(await page.evaluate(() => window.__calls[1].args.p_body)).toBe("B نىڭ پىكرى");
    await page.evaluate(() => {
      const pending = window.__rpcQueue[1];
      pending.resolve({ data: { id: pending.entry.args.p_id, replayed: false }, error: null });
    });
    await expect(page.locator("#feedbackStatus")).toHaveText("پىكىرىڭىز يوللاندى. رەھمەت.");
    await expect(page.locator("#feedbackBody")).toHaveValue("");
    await page.evaluate(() => { window.__calls = []; window.__rpcQueue = []; window.__holdRpc = false; });
  }

  await holdPair(() => window.__rpcQueue[0].reject(new Error("old request failed")));
  await holdPair(() => window.__rpcQueue[0].resolve({ data: null, error: { message: "old request failed", code: "08006" } }));
});

test("real sign-out delay, rejection, and returned error keep feedback blocked", async ({ page }) => {
  await installRealMember(page);
  await page.goto("/feedback", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#feedbackForm")).toBeVisible();
  await page.locator("#feedbackBody").fill("چىقىشتىن بۇرۇن");
  await page.evaluate(() => { window.__holdRpc = true; });
  await page.locator("#feedbackSubmit").click();
  await page.waitForFunction(() => window.__rpcPending);
  await page.evaluate(() => {
    window.__signOutMode = "delay";
    window.__signOutPromise = window.KutadguMember.signOut();
  });
  await expect(page.locator("#feedbackForm")).toBeHidden();
  await expect(page.locator("#feedbackBody")).toHaveValue("");
  expect(await page.evaluate(() => window.__signOutCalls)).toBe(1);
  await page.evaluate(() => document.getElementById("feedbackForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(await page.evaluate(() => window.__calls.length)).toBe(1);
  await page.evaluate(() => window.__rpcPending.resolve({ data: { id: window.__rpcPending.entry.args.p_id, replayed: false }, error: null }));
  await expect(page.locator("#feedbackStatus")).not.toHaveText("پىكىرىڭىز يوللاندى. رەھمەت.");
  await page.evaluate(() => { window.__signOutResolve({ error: null }); return window.__signOutPromise; });
  await expect(page.locator("#feedbackStatus")).toHaveText("پىكىر يوللاش ئۈچۈن ھېسابىڭىزغا كىرىڭ ياكى يېڭى ئەزا بولۇڭ.");

  await page.evaluate((session) => {
    window.__signOutMode = "";
    window.__session = session;
    window.__authCb("SIGNED_IN", session);
  }, sessionFor("member-a"));
  await expect(page.locator("#feedbackForm")).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem("kutadgu-cart-v1", JSON.stringify([{ id: "old-a", qty: 2 }]));
    localStorage.setItem("kutadgu-favorites-v1", JSON.stringify(["old-a"]));
    window.__holdRpc = true;
    window.__signOutMode = "reject";
  });
  await page.locator("#feedbackBody").fill("قايتا");
  await page.locator("#feedbackSubmit").click();
  await page.waitForFunction(() => window.__calls.length === 2);
  await page.evaluate(async () => {
    try { await window.KutadguMember.signOut(); } catch (error) { window.__signOutError = String(error && error.message || error); }
  });
  await expect(page.locator("#feedbackBody")).toHaveValue("");
  await expect(page.locator("#feedbackForm")).toBeHidden();
  expect(await page.evaluate(() => window.__signOutError)).toContain("sign out rejected");
  expect(await page.evaluate(() => window.KutadguMember.getUser())).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("kutadgu-cart-v1") || "")).not.toContain("old-a");
  expect(await page.evaluate(() => localStorage.getItem("kutadgu-favorites-v1") || "")).not.toContain("old-a");
  await page.evaluate(() => window.__rpcPending.resolve({ data: { id: window.__rpcPending.entry.args.p_id, replayed: false }, error: null }));
  await expect(page.locator("#feedbackStatus")).not.toHaveText("پىكىرىڭىز يوللاندى. رەھمەت.");
  await page.evaluate(() => document.getElementById("feedbackForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(await page.evaluate(() => window.__calls.length)).toBe(2);

  await page.evaluate((session) => {
    window.__signOutMode = "";
    window.__holdRpc = false;
    window.__session = session;
    window.__authCb("SIGNED_IN", session);
  }, sessionFor("member-a"));
  await expect(page.locator("#feedbackForm")).toBeVisible();
  await page.locator("#feedbackBody").fill("يەنە A");
  await page.locator("#feedbackSubmit").click();
  await expect.poll(() => page.evaluate(() => window.__calls.length)).toBe(3);
  expect(await page.evaluate(() => window.__calls[2].authUser)).toBe("member-a");

  await page.evaluate(() => {
    localStorage.setItem("kutadgu-cart-v1", JSON.stringify([{ id: "old-a", qty: 2 }]));
    localStorage.setItem("kutadgu-favorites-v1", JSON.stringify(["old-a"]));
    window.__signOutMode = "error";
    window.__signOutResult = window.KutadguMember.signOut().then(
      (value) => { window.__signOutValue = value == null ? "resolved" : "resolved"; },
      (error) => { window.__signOutValue = String(error && error.message || error); }
    );
  });
  await page.evaluate(() => window.__signOutResult);
  await expect(page.locator("#feedbackForm")).toBeHidden();
  await expect(page.locator("#feedbackBody")).toHaveValue("");
  expect(await page.evaluate(() => window.__signOutValue)).toBe("resolved");
  expect(await page.evaluate(() => window.KutadguMember.getUser())).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("kutadgu-cart-v1") || "")).not.toContain("old-a");
  expect(await page.evaluate(() => localStorage.getItem("kutadgu-favorites-v1") || "")).not.toContain("old-a");
  await page.evaluate(() => document.getElementById("feedbackForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(await page.evaluate(() => window.__calls.length)).toBe(3);

  await page.evaluate((session) => {
    window.__signOutMode = "";
    window.__session = session;
    window.__authCb("SIGNED_IN", session);
  }, sessionFor("member-a"));
  await expect(page.locator("#feedbackForm")).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem("kutadgu-cart-v1", JSON.stringify([{ id: "old-a", qty: 4 }]));
    localStorage.setItem("kutadgu-favorites-v1", JSON.stringify(["old-a"]));
    window.__holdMerge = true;
    window.__signOutMode = "delay";
    window.__signOutPromise = window.KutadguMember.signOut();
  });
  await page.evaluate((session) => {
    window.__session = session;
    window.__authCb("SIGNED_IN", session);
    localStorage.setItem("kutadgu-cart-v1", JSON.stringify([{ id: "bee", qty: 1 }]));
    localStorage.setItem("kutadgu-favorites-v1", JSON.stringify(["bee"]));
  }, sessionFor("member-b"));
  await page.waitForFunction(() => window.KutadguMember.getUser() && window.KutadguMember.getUser().id === "member-b");
  await page.evaluate(() => window.__signOutReject(new Error("late rejection")));
  await page.evaluate(() => window.__signOutPromise.catch(() => {}));
  expect(await page.evaluate(() => window.KutadguMember.getUser().id)).toBe("member-b");
  expect(await page.evaluate(() => localStorage.getItem("kutadgu-cart-v1"))).toContain("bee");
  expect(await page.evaluate(() => localStorage.getItem("kutadgu-cart-v1"))).not.toContain("old-a");
  expect(await page.evaluate(() => localStorage.getItem("kutadgu-favorites-v1"))).toContain("bee");
  expect(await page.evaluate(() => localStorage.getItem("kutadgu-favorites-v1"))).not.toContain("old-a");
  await expect(page.locator("#feedbackBody")).toHaveValue("");

  await page.evaluate(() => {
    window.__holdMerge = false;
    window.__mergeWaiting.splice(0).forEach((release) => release());
    localStorage.setItem("kutadgu-cart-v1", JSON.stringify([{ id: "old-a", qty: 4 }]));
    localStorage.setItem("kutadgu-favorites-v1", JSON.stringify(["old-a"]));
    window.__signOutMode = "delay";
    window.__signOutPromise = window.KutadguMember.signOut();
  });
  await page.evaluate(() => {
    window.__session = null;
    window.__authCb("SIGNED_OUT", null);
  });
  await page.evaluate(() => { window.__signOutResolve({ error: { message: "sign out failed" } }); return window.__signOutPromise; });
  expect(await page.evaluate(() => window.KutadguMember.getUser())).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("kutadgu-cart-v1") || "")).not.toContain("old-a");
  expect(await page.evaluate(() => localStorage.getItem("kutadgu-favorites-v1") || "")).not.toContain("old-a");
  await expect(page.locator("#feedbackForm")).toBeHidden();
  await expect(page.locator("#feedbackBody")).toHaveValue("");
});

test("session loss, missing and failed profiles, suspension, and restoration", async ({ page }) => {
  await installRealMember(page);
  await page.goto("/feedback", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#feedbackForm")).toBeVisible();
  await page.locator("#feedbackBody").fill("يوقىلىدۇ");
  await page.evaluate(() => {
    window.__session = null;
    window.__authCb("SIGNED_OUT", null);
  });
  await expect(page.locator("#feedbackBody")).toHaveValue("");
  await expect(page.locator("#feedbackForm")).toBeHidden();
  await expect(page.locator("#feedbackStatus")).toHaveText("پىكىر يوللاش ئۈچۈن ھېسابىڭىزغا كىرىڭ ياكى يېڭى ئەزا بولۇڭ.");

  await page.evaluate((session) => {
    window.__profiles["member-a"] = null;
    window.__session = session;
    window.__authCb("SIGNED_IN", session);
  }, sessionFor("member-a"));
  await expect(page.locator("#feedbackForm")).toBeHidden();
  await expect(page.locator("#feedbackStatus")).toHaveText("ھېساب تەكشۈرۈلۈۋاتىدۇ.");
  expect(await page.evaluate(() => window.KutadguMember.getUser().id)).toBe("member-a");

  await page.evaluate((session) => {
    window.__profileError = true;
    window.__profiles["member-b"] = { id: "member-b", status: "active" };
    window.__session = session;
    window.__authCb("SIGNED_IN", session);
  }, sessionFor("member-b"));
  await expect(page.locator("#feedbackForm")).toBeHidden();
  await page.evaluate(() => document.getElementById("feedbackForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(await page.evaluate(() => window.__calls.length)).toBe(0);

  await page.evaluate((session) => {
    window.__profileError = false;
    window.__profiles["member-a"] = { id: "member-a", status: "suspended", full_name: "توختىتىلغان" };
    window.__signOutMode = "";
    window.__session = session;
    window.__authCb("SIGNED_IN", session);
  }, sessionFor("member-a"));
  await expect(page.locator("#feedbackStatus")).toHaveText("بۇ ھېسابات توختىتىلغان. پىكىر يوللاشقا بولمايدۇ.");
  await expect(page.locator("#feedbackForm")).toBeHidden();

  await page.evaluate((session) => {
    window.__profiles["member-b"] = { id: "member-b", status: "active", full_name: "ئەزا ب" };
    window.__session = session;
    window.__authCb("SIGNED_IN", session);
  }, sessionFor("member-b"));
  await expect(page.locator("#feedbackForm")).toBeVisible();
  await expect(page.locator("#feedbackStatus")).not.toHaveText("بۇ ھېسابات توختىتىلغان. پىكىر يوللاشقا بولمايدۇ.");
  await page.locator("#feedbackBody").fill("قايتا ئاكتىپ");
  await page.locator("#feedbackSubmit").click();
  await expect.poll(() => page.evaluate(() => window.__calls.length)).toBe(1);
  expect(await page.evaluate(() => window.__calls[0].authUser)).toBe("member-b");
});
