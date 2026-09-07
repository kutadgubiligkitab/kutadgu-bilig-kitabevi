const { test, expect } = require("./playwright-test");

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
  test("announcement admin remains on storefront with Hero card after it", async ({ page }) => {
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
    await expect(page.locator("#heroSettingsForm")).toBeVisible();
    await expect(page.locator("#heroRotation")).toHaveValue("7");
  });

  test("empty preview has no broken image src", async ({ page }) => {
    await openStorefrontAdmin(page);
    await expect(page.locator("#heroPreviewImg")).toBeHidden();
    const previewSrc = await page.locator("#heroPreviewImg").evaluate((el) => el.getAttribute("src"));
    expect(previewSrc).toBeNull();
    await expect(page.locator("#heroCampaignImagePreview")).toBeHidden();
    const campaignSrc = await page.locator("#heroCampaignImagePreview").evaluate((el) => el.getAttribute("src"));
    expect(campaignSrc).toBeNull();
    const broken = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll("#heroAdminCard img")];
      return imgs.filter((img) => img.getAttribute("src") === "" || (img.hasAttribute("src") && !img.getAttribute("src"))).map((img) => img.id || img.className);
    });
    expect(broken).toEqual([]);
  });

  test("XSS-looking title stays plain text in preview", async ({ page }) => {
    await openStorefrontAdmin(page);
    const payload = "<img src=x onerror=alert(1)>";
    await page.locator("#heroCampaignTitle").fill(payload);
    await page.locator("#heroCampaignBody").fill("<script>alert(2)</script>");
    await expect(page.locator("#heroPreviewTitle")).toHaveText(payload);
    const html = await page.locator("#heroPreviewTitle").evaluate((el) => el.innerHTML);
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain("&lt;img");
  });

  for (const width of [390, 430, 768, 1366]) {
    test(`no horizontal overflow at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await openStorefrontAdmin(page);
      await expect(page.locator("#heroAdminCard")).toBeVisible();
      await expect(page.locator("#heroBookSearch")).toBeVisible();
      await expect(page.locator("#heroCampaignSave")).toBeVisible();
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
        dir: document.documentElement.getAttribute("dir")
      }));
      expect(overflow.dir).toBe("rtl");
      expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.client + 1);
    });
  }
});
