const { test, expect } = require("./playwright-test");

test.use({ timezoneId: "UTC" });

const ADMIN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function members() {
  return [
    {
      id: "00000000-0000-4000-8000-000000000001",
      email: "tr@example.com",
      full_name: "ئالىيە",
      phone: "9001",
      country: "تۈركىيە",
      city: "ئانكارا",
      status: "active",
      created_at: "2026-10-14T00:00:00.000Z",
      visit_count: 1,
      last_page: "cart.html?utm_source=ad&fbclid=1#top",
      last_visit_country: "DE",
      last_visit_observed_at: "2026-10-14T15:04:00.000Z",
      order_count: 0,
      order_total: 0
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      email: "old@example.com",
      full_name: "كونا ئەزا",
      phone: "9002",
      country: "ئامېرىكا",
      city: "ئانكارا",
      status: "active",
      created_at: "2020-01-01T00:00:00.000Z",
      visit_count: 2,
      last_page: "/book/42",
      last_visit_country: null,
      last_visit_observed_at: null,
      order_count: 0,
      order_total: 0
    },
    {
      id: "00000000-0000-4000-8000-000000000003",
      email: "hostile@example.com",
      full_name: "نامسىز <b>ئەزا</b>",
      phone: "9003",
      country: "https://evil.example",
      city: "",
      status: "active",
      created_at: "2024-01-01T00:00:00.000Z",
      visit_count: 3,
      last_page: "<script>alert(1)</script>",
      last_visit_country: "QQ",
      last_visit_observed_at: "2026-10-14T15:04:00.000Z",
      order_count: 0,
      order_total: 0
    }
  ];
}

async function install(page) {
  await page.addInitScript(({ adminId, rows }) => {
    const token = (aal, userId) => {
      const payload = btoa(JSON.stringify({ aal, sub: userId })).replace(/=+$/g, "");
      return "e30." + payload + ".sig";
    };
    window.__kutadguSkipAdminAuth = true;
    window.__memberDirectoryCalls = [];
    window.__kutadguAnalyticsDb = {
      auth: {
        getSession: async () => ({
          data: {
            session: {
              access_token: token("aal2", adminId),
              user: { id: adminId }
            }
          },
          error: null
        })
      },
      rpc(name, args) {
        window.__memberDirectoryCalls.push({ name, args });
        if (name !== "admin_member_directory_page") return Promise.resolve({ data: null, error: { message: "unexpected" } });
        return Promise.resolve({
          data: {
            total: rows.length,
            page: 0,
            page_size: 20,
            rows,
            stats: { members: rows.length, visits: 6, orders: 0, revenue: 0 }
          },
          error: null
        });
      },
      from() { throw new Error("unexpected table read"); }
    };
    window.__kutadguMemberCartAdminClient = {
      auth: { getSession: async () => window.__kutadguAnalyticsDb.auth.getSession() },
      rpc() { return Promise.resolve({ data: [], error: null }); }
    };
  }, { adminId: ADMIN, rows: members() });
}

async function openDirectory(page) {
  await page.goto("/admin.html#customers", { waitUntil: "domcontentloaded" });
  await page.locator("#reloadMembers").click();
  await expect(page.locator(".admin-member-row")).toHaveCount(3);
}

test("member rows show the latest visit country and Uyghur page names", async ({ page }) => {
  await install(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openDirectory(page);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const rows = page.locator(".admin-member-row");
  await expect(rows.nth(0)).toContainText("ئاخىرقى زىيارەت دۆلىتى: گېرمانىيە · 2026-يىلى 10-ئاينىڭ 14-كۈنى، 15:04");
  await expect(rows.nth(0)).toContainText("ئاخىرقى بەت: سېۋەت");
  await expect(rows.nth(0)).toContainText("تۈركىيە");
  await expect(rows.nth(0)).not.toContainText("ئەزا بولغان دۆلەت");
  await expect(rows.nth(0)).not.toContainText("utm_source");
  await expect(rows.nth(0)).not.toContainText("cart.html");
  await expect(rows.nth(1)).toContainText("ئاخىرقى زىيارەت دۆلىتى: نامەلۇم");
  await expect(rows.nth(1)).toContainText("ئاخىرقى بەت: كىتاب تەپسىلاتى");
  await expect(rows.nth(1)).toContainText("ئامېرىكا");
  await expect(rows.nth(2)).toContainText("ئاخىرقى زىيارەت دۆلىتى: نامەلۇم · 2026-يىلى 10-ئاينىڭ 14-كۈنى، 15:04");
  await expect(rows.nth(2)).not.toContainText("QQ");
  await expect(rows.nth(2)).toContainText("ئاخىرقى بەت: نامەلۇم");
  await expect(rows.nth(2)).toContainText("https://evil.example");
  await expect(rows.nth(2)).not.toContainText("<script>");
  await expect(page.locator("#memberCartTitle")).toHaveText("سېۋەت");
  await rows.nth(0).locator("[data-member-cart]").click();
  await expect(page.locator("#memberCartTitle")).toHaveText("سېۋەت");
  await expect(page.locator("#memberCartIdentity")).toContainText("ئالىيە");
  await expect(page.locator("#memberCartIdentity")).not.toContainText("cart.html");
  await expect(page.locator("#memberCartPanel")).not.toContainText("utm_source");
});

test("the same labels stay inside the row on a narrow viewport and a dark color scheme", async ({ page }) => {
  await install(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 800 });
  await openDirectory(page);
  await page.evaluate(() => { document.body.classList.add("dark-mode"); });
  const row = page.locator(".admin-member-row").first();
  await expect(row).toContainText("ئاخىرقى زىيارەت دۆلىتى: گېرمانىيە");
  await expect(row).toContainText("ئاخىرقى بەت: سېۋەت");
  const box = await row.boundingBox();
  expect(box.width).toBeLessThanOrEqual(390);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});
