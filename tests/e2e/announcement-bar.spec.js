const { test, expect } = require("@playwright/test");
const H = require("./helpers");

function sampleRows() {
  return [
    { id: "a1", message: "بىرىنچى ئېلان", enabled: true, sort_order: 1, starts_at: null, ends_at: null, created_at: "2026-01-01T00:00:00Z" },
    { id: "a2", message: "ئىككىنچى ئېلان", enabled: true, sort_order: 2, starts_at: null, ends_at: null, created_at: "2026-01-02T00:00:00Z" }
  ];
}

test.describe("announcement bar", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("0 announcements leaves no bar and no gap", async ({ page }) => {
    await H.installAnnouncementFixtures(page, { announcements: [] });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    const bar = page.locator("#kutadguAnnounceBar");
    await expect.poll(async () => page.evaluate(() => {
      const el = document.getElementById("kutadguAnnounceBar");
      if (!el) return "missing";
      const cs = getComputedStyle(el);
      return cs.display === "none" || el.hidden ? "hidden" : "visible";
    })).toBe("hidden");
    const gap = await page.evaluate(() => {
      const header = document.querySelector("header");
      const bar = document.getElementById("kutadguAnnounceBar");
      if (!header) return -1;
      const extra = bar && getComputedStyle(bar).display !== "none" ? bar.getBoundingClientRect().height : 0;
      return extra;
    });
    expect(gap).toBe(0);
  });

  test("1 announcement is visible without autoplay", async ({ page }) => {
    await H.installAnnouncementFixtures(page, {
      interval: 2,
      announcements: [sampleRows()[0]]
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#kutadguAnnounceBar.is-visible")).toBeVisible();
    await expect(page.locator("#kutadguAnnounceText")).toHaveText("بىرىنچى ئېلان");
    await page.waitForTimeout(2200);
    await expect(page.locator("#kutadguAnnounceText")).toHaveText("بىرىنچى ئېلان");
    const state = await page.evaluate(() => window.kutadguAnnouncements && window.kutadguAnnouncements._state());
    expect(state.timer).toBe(false);
    expect(state.items.length).toBe(1);
  });

  test("multiple announcements rotate at configured interval and pause on hover", async ({ page }) => {
    await H.installAnnouncementFixtures(page, { interval: 2, announcements: sampleRows() });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#kutadguAnnounceText")).toHaveText("بىرىنچى ئېلان");
    await expect.poll(async () => page.locator("#kutadguAnnounceText").innerText(), { timeout: 5000 }).toBe("ئىككىنچى ئېلان");
    await page.locator("#kutadguAnnounceBar").hover();
    const pausedText = await page.locator("#kutadguAnnounceText").innerText();
    await page.waitForTimeout(2500);
    await expect(page.locator("#kutadguAnnounceText")).toHaveText(pausedText);
    await page.mouse.move(0, 0);
    await expect.poll(async () => page.locator("#kutadguAnnounceText").innerText(), { timeout: 5000 }).not.toBe(pausedText);
  });

  test("reduced-motion disables autoplay", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await H.installAnnouncementFixtures(page, { interval: 2, announcements: sampleRows() });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator("#kutadguAnnounceText")).toHaveText("بىرىنچى ئېلان");
    await page.waitForTimeout(2200);
    await expect(page.locator("#kutadguAnnounceText")).toHaveText("بىرىنچى ئېلان");
    const state = await page.evaluate(() => window.kutadguAnnouncements && window.kutadguAnnouncements._state());
    expect(state.timer).toBe(false);
  });

  test("start/end date filtering keeps future and expired messages off", async ({ page }) => {
    await H.installAnnouncementFixtures(page, {
      announcements: [
        { id: "future", message: "كەلگۈسى", enabled: true, sort_order: 1, starts_at: "2099-01-01T00:00:00Z" },
        { id: "past", message: "ئۆتۈپ كەتكەن", enabled: true, sort_order: 2, ends_at: "2020-01-01T00:00:00Z" },
        { id: "now", message: "ھازىرقى", enabled: true, sort_order: 3, starts_at: null, ends_at: null }
      ]
    });
    await H.openFresh(page, "/");
    await expect(page.locator("#kutadguAnnounceBar.is-visible")).toBeVisible();
    await expect(page.locator("#kutadguAnnounceText")).toHaveText("ھازىرقى");
  });

  test("missing announcement tables fail open", async ({ page }) => {
    await H.installAnnouncementFixtures(page, { missing: true });
    const errors = H.collectPageErrors(page);
    await H.openFresh(page, "/");
    await expect(page.locator("#searchInput")).toBeVisible();
    const hidden = await page.evaluate(() => {
      const el = document.getElementById("kutadguAnnounceBar");
      return !el || el.hidden || getComputedStyle(el).display === "none";
    });
    expect(hidden).toBe(true);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("homepage and category headers stay sticky", async ({ page }) => {
    await H.installAnnouncementFixtures(page, { announcements: [sampleRows()[0]] });
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    const homePos = await page.locator("header").evaluate((el) => getComputedStyle(el).position);
    expect(["sticky", "fixed"]).toContain(homePos);
    await page.evaluate(() => window.scrollTo(0, 500));
    const homeTop = await page.locator("header").evaluate((el) => el.getBoundingClientRect().top);
    expect(homeTop).toBeLessThanOrEqual(1);

    await page.goto("/adabiyat-roman.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("header")).toBeVisible();
    const catPos = await page.locator("header").evaluate((el) => getComputedStyle(el).position);
    expect(["sticky", "fixed"]).toContain(catPos);
    await page.evaluate(() => window.scrollTo(0, 400));
    const catTop = await page.locator("header").evaluate((el) => el.getBoundingClientRect().top);
    expect(catTop).toBeLessThanOrEqual(1);
  });

  test("mobile header plus bar does not cover hero content", async ({ page }) => {
    await H.installAnnouncementFixtures(page, { announcements: [sampleRows()[0]] });
    await page.setViewportSize({ width: 390, height: 844 });
    await H.openFresh(page, "/");
    await expect(page.locator("#kutadguAnnounceBar.is-visible")).toBeVisible();
    const gap = await page.evaluate(() => {
      const header = document.querySelector("header");
      const hero = document.querySelector(".home-bookstore-hero, .hero");
      if (!header || !hero) return -999;
      return hero.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(-1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.locator(".mobile-menu-toggle")).toHaveCSS("min-width", "44px");
    await expect(page.locator(".mobile-header-cart")).toHaveCSS("min-width", "44px");
    await expect(page.locator(".mobile-bottom-nav")).toBeVisible();
  });

  test("non-link category logo becomes a homepage link", async ({ page }) => {
    await H.installAnnouncementFixtures(page, { announcements: [] });
    await page.goto("/adabiyat-roman.html", { waitUntil: "domcontentloaded" });
    const logo = page.locator("header .logo").first();
    await expect(logo).toHaveAttribute("href", /\/$|index\.html/);
    await logo.click();
    await page.waitForURL(/\/$|index\.html/);
  });

  test("Admin announcement controls exist and maintenance card is unchanged", async ({ page }) => {
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#announcementCard")).toBeAttached();
    await expect(page.locator("#announceInterval")).toBeAttached();
    await expect(page.locator("#announceSaveBtn")).toBeAttached();
    await expect(page.locator("#announceResetBtn")).toBeAttached();
    await expect(page.locator("#announcementForm")).toBeAttached();
    await expect(page.locator("#maintenanceToggleBtn")).toBeAttached();
    await expect(page.locator("#maintenanceCard")).toContainText("ئاسراش");
    await expect(page.locator("#newBookBtn")).toBeAttached();
  });
});
