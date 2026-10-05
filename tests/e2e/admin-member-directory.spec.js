const { test, expect } = require("./playwright-test");

const ADMIN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OTHER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function buildMembers() {
  const rows = [];
  for (let i = 1; i <= 1100; i += 1) {
    const id = "00000000-0000-4000-8000-" + String(i).padStart(12, "0");
    rows.push({
      id: id,
      email: i === 1 ? "find-me_%@example.com" : "member" + i + "@example.com",
      full_name: i === 1 ? "ئىزدەش نىشانى" : (i === 4 ? "توختىتىلغان_%" : "ئەزا " + i),
      phone: i === 4 ? "555_%" : "900" + i,
      country: i >= 10 && i <= 30 ? "گۇرۇپپا" : "تۈركىيە",
      city: i === 2 ? "ئىستانبۇل" : "ئانكارا",
      status: i === 4 || i === 5 ? "suspended" : "active",
      created_at: new Date(Date.UTC(2024, 0, 1, 0, 0, Math.floor((i + 1) / 2))).toISOString(),
      last_login_at: null,
      last_seen_at: null,
      visit_count: i,
      last_page: "/book/" + i,
      cart: i === 2 || i === 4,
      order_count: i === 2 ? 1 : 0,
      order_total: i === 2 ? 12.5 : 0
    });
  }
  return rows;
}

async function install(page) {
  await page.addInitScript(({ adminId, members }) => {
    function answer(rows, args) {
      const query = String(args.p_query || "").trim().slice(0, 80).toLocaleLowerCase("ug");
      const status = args.p_status;
      const cart = args.p_cart;
      const pageIndex = Math.max(0, Number(args.p_page) || 0);
      const matched = rows.filter((member) => {
        if (status === "suspended" && member.status !== "suspended") return false;
        if (status === "active" && member.status === "suspended") return false;
        if (cart === "with_items" && !member.cart) return false;
        if (!query) return true;
        const hay = [member.full_name, member.email, member.phone, member.country, member.city].join(" ").toLocaleLowerCase("ug");
        return hay.includes(query);
      }).sort((a, b) => {
        if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
        return a.id < b.id ? 1 : -1;
      });
      return {
        total: matched.length,
        page: pageIndex,
        page_size: 20,
        rows: matched.slice(pageIndex * 20, pageIndex * 20 + 20).map((member) => {
          const copy = { ...member };
          delete copy.cart;
          return copy;
        }),
        stats: { members: 1100, visits: 605550, orders: 2, revenue: 15.5 }
      };
    }
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguMemberDirectoryMembers = members;
    window.__memberDirectoryCalls = [];
    window.__memberDirectoryHold = false;
    window.__memberDirectoryFailPage = null;
    window.__memberDirectoryReject = false;
    window.__memberDirectoryAal = "aal2";
    window.__memberDirectoryUser = adminId;
    const token = (aal, userId) => {
      const payload = btoa(JSON.stringify({ aal: aal, sub: userId })).replace(/=+$/g, "");
      return "e30." + payload + ".sig";
    };
    window.__kutadguAnalyticsDb = {
      auth: {
        getSession: async () => {
          window.__memberDirectorySessionReads = (window.__memberDirectorySessionReads || 0) + 1;
          if (!window.__memberDirectoryUser) return { data: { session: null }, error: null };
          return {
            data: {
              session: {
                access_token: token(window.__memberDirectoryAal, window.__memberDirectoryUser),
                user: { id: window.__memberDirectoryUser }
              }
            },
            error: null
          };
        }
      },
      rpc(name, args) {
        window.__memberDirectoryCalls.push({ name: name, args: args });
        if (name === "set_member_status") {
          const member = window.__kutadguMemberDirectoryMembers.find((row) => row.id === args.member_id);
          if (member) member.status = args.new_status;
          return Promise.resolve({ data: null, error: null });
        }
        if (name !== "admin_member_directory_page") return Promise.resolve({ data: null, error: { message: "unexpected rpc" } });
        if (window.__memberDirectoryReject) return Promise.reject(new Error("rejected"));
        if (window.__memberDirectoryFailPage != null && Number(args.p_page) === window.__memberDirectoryFailPage) {
          return Promise.resolve({ data: null, error: { message: "page failed", code: "500" } });
        }
        const payload = () => ({ data: answer(window.__kutadguMemberDirectoryMembers, args), error: null });
        if (window.__memberDirectoryHold) {
          return new Promise((resolve, reject) => {
            window.__releaseMemberDirectory = () => {
              if (window.__memberDirectoryReject) reject(new Error("rejected"));
              else resolve(payload());
            };
          });
        }
        return Promise.resolve(payload());
      },
      from() {
        throw new Error("unexpected table read");
      }
    };
    window.__kutadguMemberCartAdminClient = {
      auth: { getSession: async () => window.__kutadguAnalyticsDb.auth.getSession() },
      rpc() {
        return Promise.resolve({ data: [], error: null });
      }
    };
  }, { adminId: ADMIN, members: buildMembers() });
}

async function openCustomers(page) {
  await page.goto("/admin.html#customers", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#memberManagement")).toBeVisible();
  await page.locator("#reloadMembers").click();
  await expect(page.locator(".admin-member-row")).toHaveCount(20);
}

test("search and filters page the whole member set", async ({ page }) => {
  await install(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCustomers(page);
  await expect(page.locator("#adminMemberPager")).toContainText("بەت 1 / 55");
  await expect(page.locator("#adminMemberPager")).toContainText("جەمئىي 1100 ئەزا");
  await expect(page.locator("#adminMemberPager")).toContainText("ھەر بەتتە 20");
  await expect(page.locator("#statMembers")).toHaveText("1100");
  await expect(page.locator(".admin-member-name").first()).toHaveText("ئەزا 1100");
  await expect(page.locator(".admin-member-name", { hasText: "ئىزدەش نىشانى" })).toHaveCount(0);

  await page.locator("#adminMemberPager").getByRole("button", { name: "كېيىنكى" }).click();
  await expect(page.locator("#adminMemberPager")).toContainText("بەت 2 / 55");
  await expect(page.locator(".admin-member-name").first()).toHaveText("ئەزا 1080");
  const calls = await page.evaluate(() => window.__memberDirectoryCalls.map((call) => call.args && call.args.p_page));
  expect(calls).toContain(1);

  await page.locator("#memberSearch").fill("ئىزدەش");
  await expect(page.locator(".admin-member-name")).toHaveCount(1);
  await expect(page.locator(".admin-member-name")).toHaveText("ئىزدەش نىشانى");
  await expect(page.locator("#adminMemberPager")).toContainText("جەمئىي 1 ئەزا");
  await expect(page.locator(".admin-member-email")).toHaveText("find-me_%@example.com");

  await page.locator("#memberSearch").fill("%");
  await expect(page.locator(".admin-member-row")).toHaveCount(2);
  await expect(page.locator("#adminMemberPager")).toContainText("جەمئىي 2 ئەزا");
  await page.locator("#memberSearch").fill("_%");
  await expect(page.locator(".admin-member-row")).toHaveCount(2);
  await expect(page.locator("#adminMemberPager")).toContainText("جەمئىي 2 ئەزا");
  await page.locator("#memberSearch").fill("%_");
  await expect(page.locator("#adminMemberList .admin-empty")).toHaveText("ماس خېرىدار تېپىلمىدى.");

  await page.locator("#memberSearch").fill("");
  await page.locator("#memberStatusFilter").selectOption("suspended");
  await page.locator("#memberCartFilter").selectOption("with_items");
  await expect(page.locator(".admin-member-row")).toHaveCount(1);
  await expect(page.locator(".admin-member-name")).toHaveText("توختىتىلغان_%");
  await expect(page.locator("#statMembers")).toHaveText("1100");

  await page.locator("#memberStatusFilter").selectOption("all");
  await page.locator("#memberCartFilter").selectOption("all");
  await page.locator("#memberSearch").fill("يوق-بۇ-ئىسىم");
  await expect(page.locator("#adminMemberList .admin-empty")).toHaveText("ماس خېرىدار تېپىلمىدى.");
  await expect(page.locator("#adminMemberPager")).toBeHidden();
});

test("failed reads keep the committed page and late responses do not replace it", async ({ page }) => {
  await install(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCustomers(page);
  await page.evaluate(() => { window.__memberDirectoryFailPage = 1; });
  await page.locator("#adminMemberPager").getByRole("button", { name: "كېيىنكى" }).click();
  await expect(page.locator("#adminMemberNotice")).toContainText("ئالدىنقى نەتىجە");
  await expect(page.locator(".admin-member-name").first()).toHaveText("ئەزا 1100");
  await expect(page.locator("#adminMemberPager")).toContainText("بەت 1 / 55");
  await page.evaluate(() => { window.__memberDirectoryFailPage = null; });
  await page.locator("#memberDirectoryRetry").click();
  await expect(page.locator("#adminMemberPager")).toContainText("بەت 2 / 55");
  await expect(page.locator(".admin-member-name").first()).toHaveText("ئەزا 1080");

  await page.locator("#memberSearch").fill("");
  await expect(page.locator(".admin-member-row")).toHaveCount(20);
  await page.evaluate(() => { window.__memberDirectoryHold = true; window.__memberDirectoryCalls = []; });
  await page.locator("#memberSearch").fill("ئىزدەش");
  await expect.poll(() => page.evaluate(() => window.__memberDirectoryCalls.length)).toBe(1);
  await page.evaluate(() => { window.__memberDirectoryHold = false; });
  await page.locator("#memberSearch").fill("توختىتىلغان");
  await expect(page.locator(".admin-member-name")).toHaveCount(1);
  await expect(page.locator(".admin-member-name")).toHaveText("توختىتىلغان_%");
  await page.evaluate(() => window.__releaseMemberDirectory());
  await expect(page.locator(".admin-member-name")).toHaveCount(1);
  await expect(page.locator(".admin-member-name")).toHaveText("توختىتىلغان_%");

  await page.evaluate(() => { window.__memberDirectoryHold = true; });
  await page.locator("#reloadMembers").click();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseMemberDirectory === "function")).toBe(true);
  await page.evaluate((id) => { window.__memberDirectoryUser = id; }, OTHER);
  await page.evaluate(() => window.__releaseMemberDirectory());
  await expect(page.locator(".admin-member-row")).toHaveCount(0);
  await expect(page.locator(".admin-member-email")).toHaveCount(0);
});

test("logout, idle lock, and denial clear private rows", async ({ page }) => {
  await install(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await openCustomers(page);
  await page.evaluate(() => { document.querySelector("#idleLockPanel").hidden = false; });
  await expect(page.locator(".admin-member-row")).toHaveCount(0);
  await expect(page.locator("#memberCartPanel")).toBeHidden();
  await page.evaluate(() => {
    document.querySelector("#idleLockPanel").hidden = true;
    window.__memberDirectoryHold = true;
  });
  await page.locator("#reloadMembers").click();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseMemberDirectory === "function")).toBe(true);
  await page.evaluate(() => { window.__memberDirectoryAal = "aal1"; });
  await page.evaluate(() => window.__releaseMemberDirectory());
  await expect(page.locator("#adminMemberList")).toContainText("AAL2");
  await expect(page.locator(".admin-member-email")).toHaveCount(0);

  await page.evaluate(() => { window.__memberDirectoryAal = "aal2"; window.__memberDirectoryHold = false; });
  await page.locator("#memberDirectoryRetry").click();
  await expect(page.locator(".admin-member-row")).toHaveCount(20);
  const before = await page.evaluate(() => window.__memberDirectoryCalls.length);
  await page.evaluate(() => { window.__memberDirectoryUser = ""; });
  await page.locator("#reloadMembers").click();
  await expect(page.locator(".admin-member-row")).toHaveCount(0);
  expect(await page.evaluate((start) => window.__memberDirectoryCalls.slice(start).some((call) => call.name === "admin_member_directory_page"), before)).toBe(false);
});

test("paging away closes the open cart, and an emptied page steps back", async ({ page }) => {
  await install(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCustomers(page);
  await page.locator("[data-member-cart]").first().click();
  await expect(page.locator("#memberCartIdentity")).toContainText("ئەزا 1100");
  await page.locator("#adminMemberPager").getByRole("button", { name: "كېيىنكى" }).click();
  await expect(page.locator("#memberCartPanel")).toBeHidden();
  await expect(page.locator("#memberCartIdentity")).toHaveText("");
  await expect(page.locator("#memberCartPanel")).not.toContainText("ئەزا 1100");

  await page.locator("#memberSearch").fill("گۇرۇپپا");
  await page.locator("#memberStatusFilter").selectOption("active");
  await expect(page.locator("#adminMemberPager")).toContainText("جەمئىي 21 ئەزا");
  await page.locator("#adminMemberPager").getByRole("button", { name: "كېيىنكى" }).click();
  await expect(page.locator(".admin-member-row")).toHaveCount(1);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("[data-member-status]").click();
  await expect(page.locator("#adminMemberPager")).toContainText("بەت 1 / 1");
  await expect(page.locator(".admin-member-row")).toHaveCount(20);
});

async function holdDirectoryReload(page) {
  await page.evaluate(() => {
    window.__memberDirectoryReject = false;
    window.__memberDirectoryHold = true;
  });
  await page.locator("#reloadMembers").click();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseMemberDirectory === "function")).toBe(true);
  return page.evaluate(() => window.__memberDirectorySessionReads || 0);
}

async function rejectHeldDirectory(page, reads) {
  await page.evaluate(() => {
    window.__memberDirectoryReject = true;
    window.__releaseMemberDirectory();
  });
  await expect.poll(() => page.evaluate(() => window.__memberDirectorySessionReads || 0)).toBeGreaterThan(reads);
  await expect(page.locator(".admin-member-row")).toHaveCount(0);
  await expect(page.locator(".admin-member-email")).toHaveCount(0);
  await expect(page.locator("#adminMemberList")).not.toContainText("member1100@example.com");
  await expect(page.locator("#adminMemberNotice")).not.toContainText("ئالدىنقى نەتىجە");
}

test("a rejected directory read follows the authenticated context", async ({ page }) => {
  await install(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCustomers(page);
  await expect(page.locator(".admin-member-email").first()).toHaveText("member1100@example.com");
  await expect(page.locator("#statMembers")).toHaveText("1100");

  await page.evaluate(() => { window.__memberDirectoryReject = true; });
  await page.locator("#adminMemberPager").getByRole("button", { name: "كېيىنكى" }).click();
  await expect(page.locator("#adminMemberNotice")).toContainText("خېرىدارلارنى ئوقۇش مەغلۇپ بولدى.");
  await expect(page.locator(".admin-member-name").first()).toHaveText("ئەزا 1100");
  await expect(page.locator(".admin-member-email").first()).toHaveText("member1100@example.com");
  await expect(page.locator("#statMembers")).toHaveText("1100");
  await expect(page.locator("#adminMemberPager")).toContainText("بەت 1 / 55");
  await expect(page.locator("[data-member-cart]")).toHaveCount(20);
  await page.evaluate(() => { window.__memberDirectoryReject = false; });
  await page.locator("#memberDirectoryRetry").click();
  await expect(page.locator("#adminMemberPager")).toContainText("بەت 2 / 55");
  await expect(page.locator(".admin-member-name").first()).toHaveText("ئەزا 1080");
  await expect(page.locator("#adminMemberNotice")).toBeHidden();

  await page.locator("#memberSearch").fill("");
  await expect(page.locator(".admin-member-row")).toHaveCount(20);
  await page.evaluate((id) => {
    window.__memberDirectoryUser = id;
    window.__memberDirectoryReject = true;
  }, OTHER);
  await page.locator("#reloadMembers").click();
  await expect(page.locator(".admin-member-row")).toHaveCount(0);
  await expect(page.locator(".admin-member-email")).toHaveCount(0);
  await expect(page.locator("#adminMemberList")).not.toContainText("member1100@example.com");
  await expect(page.locator("#adminMemberList")).toContainText("خېرىدارلارنى ئوقۇش مەغلۇپ بولدى.");
  await expect(page.locator("#adminMemberNotice")).not.toContainText("ئالدىنقى نەتىجە");
  await expect(page.locator("#statMembers")).toHaveText("0");
  await expect(page.locator("[data-member-cart]")).toHaveCount(0);

  await page.evaluate((id) => {
    window.__memberDirectoryUser = id;
    window.__memberDirectoryReject = false;
    window.__memberDirectoryHold = false;
  }, ADMIN);
  await page.locator("#memberDirectoryRetry").click();
  await expect(page.locator(".admin-member-row")).toHaveCount(20);
  await expect(page.locator("#adminMemberPager")).toContainText("بەت 2 / 55");
  await expect(page.locator(".admin-member-email").first()).toHaveText("member1080@example.com");
  await expect(page.locator("#adminMemberList")).not.toContainText("ئالدىنقى نەتىجە");

  let reads = await holdDirectoryReload(page);
  await page.evaluate((id) => { window.__memberDirectoryUser = id; }, OTHER);
  await rejectHeldDirectory(page, reads);

  await page.evaluate((id) => {
    window.__memberDirectoryUser = id;
    window.__memberDirectoryAal = "aal2";
    window.__memberDirectoryReject = false;
    window.__memberDirectoryHold = false;
  }, ADMIN);
  await page.locator("#reloadMembers").click();
  await expect(page.locator(".admin-member-row")).toHaveCount(20);

  reads = await holdDirectoryReload(page);
  await page.evaluate(() => { window.__memberDirectoryUser = ""; });
  await rejectHeldDirectory(page, reads);
  await expect(page.locator("#adminMemberList")).toContainText("AAL2");

  await page.evaluate((id) => {
    window.__memberDirectoryUser = id;
    window.__memberDirectoryAal = "aal2";
    window.__memberDirectoryReject = false;
    window.__memberDirectoryHold = false;
  }, ADMIN);
  await page.locator("#memberDirectoryRetry").click();
  await expect(page.locator(".admin-member-row")).toHaveCount(20);

  reads = await holdDirectoryReload(page);
  await page.evaluate(() => { window.__memberDirectoryAal = "aal1"; });
  await rejectHeldDirectory(page, reads);
  await expect(page.locator("#adminMemberList")).toContainText("AAL2");
  await expect(page.locator("#statMembers")).toHaveText("0");
});

test("phone and desktop controls stay in view", async ({ page }) => {
  await install(page);
  for (const size of [{ width: 1280, height: 900 }, { width: 390, height: 800 }]) {
    await page.setViewportSize(size);
    await openCustomers(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() => document.body.classList.add("dark-mode"));
    const box = await page.locator("#memberStatusFilter").evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        overflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        background: style.backgroundColor,
        color: style.color,
        width: el.getBoundingClientRect().width
      };
    });
    expect(box.overflow).toBe(true);
    expect(box.width).toBeGreaterThan(40);
    expect(box.background).toBe("rgb(255, 255, 255)");
    await page.locator("#memberSearch").focus();
    await page.keyboard.press("Tab");
    await expect(page.locator("#reloadMembers")).toBeFocused();
  }
});

const ORDER_MEMBER = "11111111-1111-4111-8111-111111111111";
const ORDER_PROFILE = { id: ORDER_MEMBER, full_name: "يوشۇرۇن ئەزا", email: "hidden-member@example.com" };
const ORDER_ROWS = [{
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  order_no: "KB-77",
  user_id: ORDER_MEMBER,
  customer_name: "خېرىدار ئىسمى",
  customer_phone: "900100",
  customer_city: "ئانكارا",
  status: "confirmed",
  total: 10,
  total_qty: 1,
  created_at: "2024-06-01T00:00:00.000Z",
  items: []
}];

async function installOrders(page) {
  await page.addInitScript(({ adminId, orders, profile }) => {
    window.__kutadguSkipAdminAuth = true;
    window.__memberDirectoryAal = "aal2";
    window.__memberDirectoryUser = adminId;
    window.__profileHydrationHold = false;
    window.__profileHydrationPending = false;
    window.__adminOrderRows = orders;
    window.__adminOrderProfiles = [profile];
    const token = (aal, userId) => {
      const payload = btoa(JSON.stringify({ aal: aal, sub: userId })).replace(/=+$/g, "");
      return "e30." + payload + ".sig";
    };
    function builder(table) {
      const state = { table: table, ids: null };
      const api = {
        select() { return api; },
        range() { return api; },
        eq() { return api; },
        or() { return api; },
        order() { return api; },
        limit() { return api; },
        in(_column, ids) { state.ids = ids.slice(); return api; },
        then(onFulfilled, onRejected) {
          let result;
          if (state.table === "orders") {
            result = Promise.resolve({
              data: window.__adminOrderRows,
              error: null,
              count: window.__adminOrderRows.length
            });
          } else if (state.table === "profiles") {
            const rows = window.__adminOrderProfiles.filter((row) => !state.ids || state.ids.indexOf(row.id) !== -1);
            if (window.__profileHydrationHold) {
              window.__profileHydrationPending = true;
              result = new Promise((resolve) => {
                window.__releaseProfileHydration = () => resolve({ data: rows, error: null });
              });
            } else {
              result = Promise.resolve({ data: rows, error: null });
            }
          } else {
            result = Promise.resolve({ data: [], error: null, count: 0 });
          }
          return result.then(onFulfilled, onRejected);
        }
      };
      return api;
    }
    window.__kutadguAnalyticsDb = {
      auth: {
        getSession: async () => {
          if (!window.__memberDirectoryUser) return { data: { session: null }, error: null };
          return {
            data: {
              session: {
                access_token: token(window.__memberDirectoryAal, window.__memberDirectoryUser),
                user: { id: window.__memberDirectoryUser }
              }
            },
            error: null
          };
        }
      },
      rpc() { return Promise.resolve({ data: null, error: null }); },
      from(table) { return builder(table); }
    };
  }, { adminId: ADMIN, orders: ORDER_ROWS, profile: ORDER_PROFILE });
}

async function openOrders(page) {
  await page.goto("/admin.html#orders", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#orderManagement")).toBeVisible();
}

async function emptyPrivateCache(page) {
  await page.evaluate(() => { document.querySelector("#idleLockPanel").hidden = false; });
  await page.evaluate(() => { document.querySelector("#idleLockPanel").hidden = true; });
}

async function holdOrderProfiles(page) {
  await page.evaluate(() => {
    window.__profileHydrationHold = true;
    window.__profileHydrationPending = false;
  });
  await page.locator('[data-admin-section="orders"]').click();
  await expect.poll(() => page.evaluate(() => window.__profileHydrationPending)).toBe(true);
}

async function expectPrivateProfileDiscarded(page) {
  await page.evaluate(() => window.__releaseProfileHydration());
  await expect(page.locator("#adminOrderList")).toContainText("ئەزا تېپىلمىدى");
  await expect(page.locator("#adminOrderList")).not.toContainText("يوشۇرۇن ئەزا");
  await expect(page.locator("#adminOrderList")).not.toContainText("hidden-member@example.com");
  await expect(page.locator("#adminOrderList")).toContainText("KB-77");
}

test("an authorized order page still hydrates the member name", async ({ page }) => {
  await installOrders(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openOrders(page);
  await expect(page.locator("#adminOrderList")).toContainText("يوشۇرۇن ئەزا");
  await expect(page.locator("#adminOrderList")).toContainText("hidden-member@example.com");
  await expect(page.locator("#adminOrderList")).toContainText("KB-77");
  await expect(page.locator("#adminOrderList")).not.toContainText("ئەزا تېپىلمىدى");
});

test("a late profile hydration does not refill a cleared private cache", async ({ page }) => {
  await installOrders(page);
  await page.addInitScript(() => { window.__profileHydrationHold = true; });
  await page.setViewportSize({ width: 1280, height: 900 });
  await openOrders(page);
  await expect.poll(() => page.evaluate(() => window.__profileHydrationPending)).toBe(true);
  await page.evaluate(() => { document.querySelector("#idleLockPanel").hidden = false; });
  await expectPrivateProfileDiscarded(page);

  await page.evaluate(() => {
    document.querySelector("#idleLockPanel").hidden = true;
    window.__profileHydrationHold = false;
  });
  await page.locator('[data-admin-section="orders"]').click();
  await expect(page.locator("#adminOrderList")).toContainText("يوشۇرۇن ئەزا");
  await expect(page.locator("#adminOrderList")).toContainText("hidden-member@example.com");

  await emptyPrivateCache(page);
  await holdOrderProfiles(page);
  await page.evaluate((id) => { window.__memberDirectoryUser = id; }, OTHER);
  await expectPrivateProfileDiscarded(page);

  await emptyPrivateCache(page);
  await page.evaluate((id) => {
    window.__memberDirectoryUser = id;
    window.__memberDirectoryAal = "aal2";
  }, ADMIN);
  await holdOrderProfiles(page);
  await page.evaluate(() => { window.__memberDirectoryUser = ""; });
  await expectPrivateProfileDiscarded(page);

  await emptyPrivateCache(page);
  await page.evaluate((id) => {
    window.__memberDirectoryUser = id;
    window.__memberDirectoryAal = "aal2";
  }, ADMIN);
  await holdOrderProfiles(page);
  await page.evaluate(() => { window.__memberDirectoryAal = "aal1"; });
  await expectPrivateProfileDiscarded(page);
});
