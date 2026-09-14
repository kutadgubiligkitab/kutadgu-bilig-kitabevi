const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const LIVE = {
  weekdayOpen: "09:15",
  weekdayClose: "19:45",
  sundayOpen: "12:00",
  sundayClose: "16:30"
};

const CONTACT_HOURS = "#contact .contact-hours small, #contactDetails .contact-hours small, #contactHoursText";

async function mockHoursGet(page, content, status) {
  await page.route("**/rest/v1/store_shop_hours**", async (route) => {
    const method = route.request().method();
    if (method === "GET" || method === "HEAD") {
      if (status && status >= 400) {
        return route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({ code: "PGRST205", message: "Could not find the table" })
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: 1, content }])
      });
    }
    if (method === "PATCH" || method === "POST" || method === "PUT") {
      const raw = (() => {
        try { return route.request().postDataJSON(); } catch (err) {
          try { return JSON.parse(route.request().postData() || "{}"); } catch (e) { return {}; }
        }
      })();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: 1, content: (raw && raw.content) || content }])
      });
    }
    return route.continue();
  });
}

async function jsonLdHours(page) {
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll('script[type="application/ld+json"]')];
    for (const el of nodes) {
      let data;
      try { data = JSON.parse(el.textContent || ""); } catch (err) { continue; }
      const list = data && data["@graph"] ? data["@graph"] : [data];
      const store = list.find((n) => n && (n["@type"] === "BookStore" || (Array.isArray(n["@type"]) && n["@type"].includes("BookStore"))));
      if (store && store.openingHours) return store.openingHours;
    }
    return null;
  });
}

async function openStorefrontAdmin(page) {
  await page.addInitScript(() => {
    window.__kutadguSkipAdminAuth = true;
  });
  await page.goto("/admin.html#storefront", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  await page.locator('[data-admin-section="storefront"]').click();
  await expect(page.locator("#shopHoursCard")).toBeVisible({ timeout: 15000 });
}

test.describe("Stage Admin 1M shop hours", () => {
  test("A/H/I/J fallback keeps current Contact and JSON-LD hours", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await H.openFresh(page, "/");
    const hours = page.locator(CONTACT_HOURS).first();
    await expect(hours).toContainText("دۈشەنبە–شەنبە", { timeout: 20000 });
    await expect(hours).toContainText("08:30–20:00");
    await expect(hours).toContainText("يەكشەنبە");
    await expect(hours).toContainText("10:30–18:00");
    expect(await jsonLdHours(page)).toEqual(["Mo-Sa 08:30-20:00", "Su 10:30-18:00"]);
  });

  test("H/I live hours update Contact and JSON-LD from the same payload", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await mockHoursGet(page, LIVE);
    await H.openFresh(page, "/");
    const hours = page.locator(CONTACT_HOURS).first();
    await expect(hours).toContainText("09:15–19:45", { timeout: 20000 });
    await expect(hours).toContainText("12:00–16:30");
    await expect.poll(async () => jsonLdHours(page), { timeout: 20000 }).toEqual(["Mo-Sa 09:15-19:45", "Su 12:00-16:30"]);
  });

  test("G public overlay never writes shop hours", async ({ page }) => {
    const writes = [];
    await H.installReadSafeNetwork(page);
    page.on("request", (req) => {
      if (!String(req.url()).includes("/rest/v1/store_shop_hours")) return;
      if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method())) writes.push(req.method());
    });
    await H.openFresh(page, "/");
    expect(writes).toEqual([]);
  });

  test("B/C Full Admin loads defaults and saves valid hours", async ({ page }) => {
    const saves = [];
    await page.route("**/rest/v1/store_shop_hours**", async (route) => {
      const method = route.request().method();
      if (method === "GET" || method === "HEAD") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{
            id: 1,
            content: {
              weekdayOpen: "08:30",
              weekdayClose: "20:00",
              sundayOpen: "10:30",
              sundayClose: "18:00"
            }
          }])
        });
      }
      let body = {};
      try { body = route.request().postDataJSON() || {}; } catch (err) {
        try { body = JSON.parse(route.request().postData() || "{}"); } catch (e) { body = {}; }
      }
      saves.push({ method, body });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: 1, content: body.content }])
      });
    });
    await openStorefrontAdmin(page);
    await expect(page.locator("#shopHoursWeekdayOpen")).toHaveValue("08:30", { timeout: 20000 });
    await expect(page.locator("#shopHoursSundayClose")).toHaveValue("18:00");
    await page.locator("#shopHoursWeekdayOpen").fill("09:00");
    await page.locator("#shopHoursWeekdayClose").fill("21:00");
    await page.locator("#shopHoursSundayOpen").fill("11:00");
    await page.locator("#shopHoursSundayClose").fill("17:00");
    await page.locator("#shopHoursSaveBtn").click();
    await expect(page.locator("#shopHoursStatus")).toHaveText("دۇكان ئىش ۋاقتى ساقلىنىپ بولدى.");
    expect(saves.length).toBeGreaterThan(0);
    expect(saves[0].body.content.weekdayOpen).toBe("09:00");
    expect(saves[0].body.content.sundayClose).toBe("17:00");
  });

  test("D invalid inverted range is rejected and does not save", async ({ page }) => {
    let writes = 0;
    await page.route("**/rest/v1/store_shop_hours**", async (route) => {
      const method = route.request().method();
      if (method === "GET" || method === "HEAD") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{
            id: 1,
            content: {
              weekdayOpen: "08:30",
              weekdayClose: "20:00",
              sundayOpen: "10:30",
              sundayClose: "18:00"
            }
          }])
        });
      }
      writes += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await openStorefrontAdmin(page);
    await page.locator("#shopHoursWeekdayOpen").fill("20:00");
    await page.locator("#shopHoursWeekdayClose").fill("08:30");
    await page.locator("#shopHoursSaveBtn").click();
    await expect(page.locator("#shopHoursStatus")).toHaveText("تاقىلىش ۋاقتى ئېچىلىشتىن كېيىن بولسۇن.");
    expect(writes).toBe(0);
  });

  test("E/F Book Staff and Member pages have no shop-hours editor", async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await page.goto("/book-staff.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#shopHoursForm")).toHaveCount(0);
    await page.goto("/account.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#shopHoursForm")).toHaveCount(0);
  });

  test("K Admin hours card has no horizontal overflow at 390 / 768 / 1366", async ({ page }) => {
    await page.route("**/rest/v1/store_shop_hours**", async (route) => {
      if (route.request().method() === "GET" || route.request().method() === "HEAD") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{
            id: 1,
            content: {
              weekdayOpen: "08:30",
              weekdayClose: "20:00",
              sundayOpen: "10:30",
              sundayClose: "18:00"
            }
          }])
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    for (const width of [390, 768, 1366]) {
      await page.setViewportSize({ width, height: 800 });
      await openStorefrontAdmin(page);
      await expect(page.locator("#shopHoursCard")).toBeVisible();
      const overflow = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        card: document.querySelector("#shopHoursCard").scrollWidth - document.querySelector("#shopHoursCard").clientWidth
      }));
      expect(overflow.page, JSON.stringify({ width, overflow })).toBeLessThanOrEqual(1);
      expect(overflow.card, JSON.stringify({ width, overflow })).toBeLessThanOrEqual(1);
    }
  });
});
