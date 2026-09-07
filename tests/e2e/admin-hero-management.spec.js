const { test, expect } = require("./playwright-test");
const fs = require("fs");
const path = require("path");

async function openStorefrontAdmin(page) {
  await page.addInitScript(() => {
    window.__kutadguSkipAdminAuth = true;
  });
  await page.goto("/admin.html#storefront", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  await expect(page.locator("#announcementCard")).toBeVisible();
  await expect(page.locator("#heroAdminCard")).toBeVisible();
}

test.describe("admin hero management", () => {
  test("announcement admin remains and Hero card is compact", async ({ page }) => {
    await openStorefrontAdmin(page);
    const order = await page.evaluate(() => {
      const panel = document.querySelector('[data-admin-section-panel="storefront"]');
      const cards = [...panel.querySelectorAll(":scope > .admin-card")].map((el) => el.id);
      return cards;
    });
    expect(order[0]).toBe("announcementCard");
    expect(order[1]).toBe("heroAdminCard");
    await expect(page.locator("#announceMessage")).toBeVisible();
    await expect(page.locator("#announceSaveBtn")).toBeVisible();
    await expect(page.locator("#heroForm")).toBeVisible();
    await expect(page.locator("#heroSlot1File")).toBeAttached();
    await expect(page.locator("#heroSlot2File")).toBeAttached();
    await expect(page.locator("#heroSlot3File")).toBeAttached();
    await expect(page.locator("#heroTrustLine")).toBeVisible();
    await expect(page.locator("#heroBody")).toBeVisible();
    await expect(page.locator("#heroRotation")).toHaveValue("7");
    await expect(page.locator("#heroSave")).toBeVisible();
    await expect(page.locator("#heroCampaignForm")).toHaveCount(0);
    await expect(page.locator("#heroBookSearch")).toHaveCount(0);
    await expect(page.locator("#heroCampaignStart")).toHaveCount(0);
    await expect(page.locator("#heroCampaignEnd")).toHaveCount(0);
    await expect(page.locator("#heroEyebrow")).toHaveCount(0);
    await expect(page.locator("#heroPrimaryHref")).toHaveCount(0);
    const saveCount = await page.locator("#heroAdminCard button.admin-primary").count();
    expect(saveCount).toBe(1);
  });

  test("empty or hidden slot images have no broken src", async ({ page }) => {
    await openStorefrontAdmin(page);
    const broken = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll("#heroAdminCard img")];
      return imgs.filter((img) => img.getAttribute("src") === "" || (img.hasAttribute("src") && !String(img.getAttribute("src") || "").trim())).map((img) => img.id || img.className);
    });
    expect(broken).toEqual([]);
  });

  test("trust and body stay plain text fields", async ({ page }) => {
    await openStorefrontAdmin(page);
    const payload = "<img src=x onerror=alert(1)>";
    await page.locator("#heroTrustLine").fill(payload);
    await page.locator("#heroBody").fill("<script>alert(2)</script>");
    await expect(page.locator("#heroTrustLine")).toHaveValue(payload);
    await expect(page.locator("#heroBody")).toHaveValue("<script>alert(2)</script>");
    const injected = await page.locator("#heroAdminCard img[src='x']").count();
    expect(injected).toBe(0);
    const content = await page.locator("#heroTrustLine").evaluate((el) => el.innerHTML);
    expect(content).not.toMatch(/<img/i);
  });

  for (const width of [390, 430, 768, 1366]) {
    test(`no horizontal overflow at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openStorefrontAdmin(page);
      await expect(page.locator("#heroAdminCard")).toBeVisible();
      await expect(page.locator("#heroSave")).toBeVisible();
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
        dir: document.documentElement.getAttribute("dir")
      }));
      expect(overflow.dir).toBe("rtl");
      expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.client + 1);
      const shotDir = path.join("test-results", "hero-admin-simple");
      fs.mkdirSync(shotDir, { recursive: true });
      await page.locator("#heroAdminCard").screenshot({
        path: path.join(shotDir, `hero-admin-${width}.png`)
      });
    });
  }
});
