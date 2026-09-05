const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const MEMBER_STUB = `window.KutadguMember=(function(){
  let user=null,profile=null,blocked=false,ordersHold=null;
  const ordersByUser={};
  const ready=Promise.resolve();
  function emit(){document.dispatchEvent(new Event("kutadgu-member-change"))}
  const api={
    ready,configured:()=>true,getUser:()=>user,getProfile:()=>profile,isBlocked:()=>blocked,
    applyFieldDirections(){},
    async getOrders(){if(ordersHold)await ordersHold;const id=user&&user.id;return id&&ordersByUser[id]?ordersByUser[id].slice():[]},
    async signIn(){user=window.__accountB.user;profile=window.__accountB.profile;blocked=false;emit()},
    async signUp(values){user={id:"user-new-id",email:values.email,created_at:"2026-09-05T00:00:00Z"};profile={full_name:values.fullName,email:values.email,phone:"",country:"",city:"",address:"",visit_count:0};ordersByUser[user.id]=[];emit();return {session:{user}}},
    async signOut(){user=null;profile=null;blocked=false;emit()},
    async updateProfile(values){profile=Object.assign({},profile,values);emit();return profile},
    async resetPassword(){},async signInWithGoogle(){}
  };
  window.__accountMemberTest={
    setA(){user=window.__accountA.user;profile=window.__accountA.profile;blocked=false;ordersByUser[user.id]=window.__accountA.orders;emit()},
    setB(){user=window.__accountB.user;profile=window.__accountB.profile;blocked=false;ordersByUser[user.id]=window.__accountB.orders;emit()},
    signedOut(){user=null;profile=null;blocked=false;emit()},
    block(){blocked=true;emit()},
    holdOrders(p){ordersHold=p},
    releaseHold(){ordersHold=null},
    seedA(){user=window.__accountA.user;profile=window.__accountA.profile;ordersByUser[user.id]=window.__accountA.orders},
    getUser(){return user}
  };
  return api;
})();`;

const ACCOUNT_A = {
  user: { id: "user-a-id", email: "a@example.com", created_at: "2026-01-02T10:00:00Z" },
  profile: {
    full_name: "ئەلى ئەزىز",
    email: "a@example.com",
    created_at: "2026-01-02T10:00:00Z",
    last_seen_at: "2026-09-05T12:00:00Z",
    visit_count: 7,
    phone: "+905551112233",
    country: "Türkiye",
    city: "Istanbul",
    address: "Kadıköy gizli كوچا 12"
  },
  orders: [{
    order_no: "KB-A-1001",
    created_at: "2026-08-01T09:00:00Z",
    status: "completed",
    total_qty: 2,
    total: 80,
    items: [{ title: "كىتاب A", qty: 2 }]
  }]
};

const ACCOUNT_B = {
  user: { id: "user-b-id", email: "b@example.com", created_at: "2026-02-02T10:00:00Z" },
  profile: {
    full_name: "باتۇر بەك",
    email: "b@example.com",
    phone: "+905559998877",
    country: "Türkiye",
    city: "Ankara",
    address: "Çankaya 5",
    visit_count: 1,
    created_at: "2026-02-02T10:00:00Z",
    last_seen_at: "2026-09-05T13:00:00Z"
  },
  orders: [{
    order_no: "KB-B-2002",
    created_at: "2026-08-02T09:00:00Z",
    status: "processing",
    total_qty: 1,
    total: 40,
    items: [{ title: "كىتاب B", qty: 1 }]
  }]
};

async function installAccountStub(page, { seedA = false, holdOrders = false } = {}) {
  await page.addInitScript(({ a, b, seed, hold, stub }) => {
    window.__accountA = a;
    window.__accountB = b;
    window.__accountStubSource = stub;
    window.__accountSeedA = seed;
    window.__accountHoldOrders = hold;
    if (hold) {
      window.__accountOrdersHold = new Promise((resolve) => {
        window.__accountReleaseOrders = resolve;
      });
    }
  }, { a: ACCOUNT_A, b: ACCOUNT_B, seed: seedA, hold: holdOrders, stub: MEMBER_STUB });
  await page.route("**/member.js*", async (route) => {
    const extras = holdOrders
      ? "if(window.__accountHoldOrders&&window.__accountOrdersHold){window.__accountMemberTest.holdOrders(window.__accountOrdersHold);}"
      : "";
    const seed = seedA ? "window.__accountMemberTest.seedA();" : "";
    await route.fulfill({
      status: 200,
      contentType: "application/javascript; charset=utf-8",
      body: MEMBER_STUB + seed + extras
    });
  });
}

async function openAccount(page, opts) {
  await H.installReadSafeNetwork(page);
  await installAccountStub(page, opts);
  await page.goto("/account.html", { waitUntil: "domcontentloaded" });
}

test.describe("account cross-tab logout privacy", () => {
  test("1 logged in as User A shows A private data", async ({ page }) => {
    await openAccount(page, { seedA: true });
    await expect(page.locator("#memberPanel")).toBeVisible();
    await expect(page.locator("#memberWelcome")).toHaveText("ئەلى ئەزىز");
    await expect(page.locator("#memberEmail")).toHaveText("a@example.com");
    await expect(page.locator("#profilePhone")).toHaveValue("+905551112233");
    await expect(page.locator("#profileAddress")).toHaveValue("Kadıköy gizli كوچا 12");
    await expect(page.locator("#orderList")).toContainText("KB-A-1001");
    await expect(page.locator("#memberOrders")).toHaveText("1");
  });

  test("2 member-change with user=null hides member UI and clears A data", async ({ page }) => {
    await openAccount(page, { seedA: true });
    await expect(page.locator("#memberPanel")).toBeVisible();
    await page.evaluate(() => window.__accountMemberTest.signedOut());
    await expect(page.locator("#memberPanel")).toBeHidden();
    await expect(page.locator("#authPanel")).toBeVisible();
    await expect(page.locator("#memberWelcome")).toHaveText("ھېسابىم");
    await expect(page.locator("#memberEmail")).toHaveText("");
    await expect(page.locator("#profileName")).toHaveValue("");
    await expect(page.locator("#profilePhone")).toHaveValue("");
    await expect(page.locator("#profileAddress")).toHaveValue("");
    await expect(page.locator("#memberVisits")).toHaveText("0");
    await expect(page.locator("#memberOrders")).toHaveText("0");
    await expect(page.locator("#orderList")).toHaveText("");
    await expect(page.locator("body")).not.toContainText("ئەلى ئەزىز");
    await expect(page.locator("body")).not.toContainText("a@example.com");
    await expect(page.locator("body")).not.toContainText("KB-A-1001");
  });

  test("3 cross-tab SIGNED_OUT clears account without reload", async ({ page }) => {
    await openAccount(page, { seedA: true });
    await expect(page.locator("#memberPanel")).toBeVisible();
    const before = page.url();
    await page.evaluate(() => window.__accountMemberTest.signedOut());
    await expect(page.locator("#authPanel")).toBeVisible();
    expect(page.url()).toBe(before);
    await expect(page.locator("body")).not.toContainText("KB-A-1001");
  });

  test("4 same-tab Logout still works", async ({ page }) => {
    await openAccount(page, { seedA: true });
    await page.locator("#memberLogout").click();
    await expect(page.locator("#authPanel")).toBeVisible();
    await expect(page.locator("#memberPanel")).toBeHidden();
    await expect(page.locator("#loginForm")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("ئەلى ئەزىز");
  });

  test("5 stale getOrders for User A must not repaint after logout", async ({ page }) => {
    await openAccount(page, { seedA: true, holdOrders: true });
    await expect(page.locator("#memberWelcome")).toHaveText("ئەلى ئەزىز");
    await expect(page.locator("#orderList")).not.toContainText("KB-A-1001");
    await page.evaluate(() => window.__accountMemberTest.signedOut());
    await expect(page.locator("#authPanel")).toBeVisible();
    await page.evaluate(() => {
      window.__accountMemberTest.releaseHold();
      if (window.__accountReleaseOrders) window.__accountReleaseOrders();
    });
    await page.waitForTimeout(50);
    await expect(page.locator("#orderList")).not.toContainText("KB-A-1001");
    await expect(page.locator("body")).not.toContainText("كىتاب A");
  });

  test("6 User A then User B never shows A private data", async ({ page }) => {
    await openAccount(page, { seedA: true });
    await expect(page.locator("#orderList")).toContainText("KB-A-1001");
    await page.evaluate(() => window.__accountMemberTest.signedOut());
    await expect(page.locator("#authPanel")).toBeVisible();
    await page.evaluate(() => window.__accountMemberTest.setB());
    await expect(page.locator("#memberPanel")).toBeVisible();
    await expect(page.locator("#memberWelcome")).toHaveText("باتۇر بەك");
    await expect(page.locator("#memberEmail")).toHaveText("b@example.com");
    await expect(page.locator("#orderList")).toContainText("KB-B-2002");
    await expect(page.locator("body")).not.toContainText("ئەلى ئەزىز");
    await expect(page.locator("body")).not.toContainText("a@example.com");
    await expect(page.locator("body")).not.toContainText("KB-A-1001");
    await expect(page.locator("body")).not.toContainText("Kadıköy");
  });

  test("7 suspended account still shows blocked auth state", async ({ page }) => {
    await openAccount(page, { seedA: true });
    await page.evaluate(() => window.__accountMemberTest.block());
    await expect(page.locator("#authPanel")).toBeVisible();
    await expect(page.locator("#authStatus")).toContainText(/ۋاقىتلىق توختىتىلغان/);
    await expect(page.locator("#memberPanel")).toBeHidden();
    await expect(page.locator("body")).not.toContainText("KB-A-1001");
  });

  test("8 login register and profile save still work", async ({ page }) => {
    await openAccount(page, { seedA: false });
    await expect(page.locator("#authPanel")).toBeVisible();
    await page.locator("#loginEmail").fill("b@example.com");
    await page.locator("#loginPassword").fill("password1");
    await page.locator("#loginForm button[type=submit]").click();
    await expect(page.locator("#memberPanel")).toBeVisible();
    await expect(page.locator("#memberEmail")).toHaveText("b@example.com");

    await page.locator("#memberLogout").click();
    await page.locator("[data-auth-tab=signup]").click();
    await page.locator("#signupName").fill("يېڭى ئەزا");
    await page.locator("#signupEmail").fill("new@example.com");
    await page.locator("#signupPassword").fill("password1");
    await page.locator("#signupConfirm").fill("password1");
    await page.locator("#signupForm button[type=submit]").click();
    await expect(page.locator("#memberPanel")).toBeVisible();
    await expect(page.locator("#memberWelcome")).toHaveText("يېڭى ئەزا");

    await page.locator("#profileName").fill("يېڭى ئەزا يېڭىلاندى");
    await page.locator("#profileCity").fill("Izmir");
    await page.locator("#profileForm button[type=submit]").click();
    await expect(page.locator("#profileStatus")).toContainText(/ساقلاندى/);
    await expect(page.locator("#memberWelcome")).toHaveText("يېڭى ئەزا يېڭىلاندى");
  });

  test("10 account page still has only one working member client", async ({ page }) => {
    await openAccount(page, { seedA: true });
    const info = await page.evaluate(() => ({
      scripts: [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src")),
      client: !!(window.KutadguMember && window.KutadguMember.getUser)
    }));
    expect(info.scripts.filter((src) => /member\.js/.test(src))).toEqual(["member.js?v=25"]);
    expect(info.scripts.filter((src) => /account\.js/.test(src))).toEqual(["account.js?v=5"]);
    expect(info.client).toBe(true);
  });
});
