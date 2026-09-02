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

const SHORT_MSG = "قىسقا ئېلان";
const MOBILE_OVERFLOW_MSG = "يېڭى كىتابلار تېخىمۇ ئەرزان باھادا سېتىلىدۇ! پۇرسەتنى قولدىن بەرمەڭ، بۈگۈن زاكاز قىلىڭ.";
const DESKTOP_OVERFLOW_MSG = Array.from({ length: 24 }, () => "يېڭى كىتابلار تېخىمۇ ئەرزان باھادا سېتىلىدۇ!").join(" ");

function row(message, id) {
  return {
    id: id || "row-1",
    message,
    enabled: true,
    sort_order: 1,
    starts_at: null,
    ends_at: null,
    created_at: "2026-01-01T00:00:00Z"
  };
}

async function announceMetrics(page) {
  return page.evaluate(() => {
    const bar = document.getElementById("kutadguAnnounceBar");
    const text = document.getElementById("kutadguAnnounceText");
    const inner = document.getElementById("kutadguAnnounceInner");
    const toggle = document.getElementById("kutadguAnnounceToggle");
    const clones = document.querySelectorAll("[data-announce-clone]");
    const csText = text ? getComputedStyle(text) : {};
    const csBar = bar ? getComputedStyle(bar) : {};
    const csToggle = toggle ? getComputedStyle(toggle) : {};
    const lineHeight = Number.parseFloat(csText.lineHeight) || 0;
    const clamped = !!(text && text.classList.contains("is-clamped"));
    const overflowing = !!(text && clamped && text.scrollHeight > text.clientHeight + 1);
    const toggleVisible = !!(toggle && !toggle.hidden && getComputedStyle(toggle).display !== "none");
    const barW = bar ? bar.getBoundingClientRect().width : 0;
    const innerW = inner ? inner.getBoundingClientRect().width : 0;
    return {
      ticker: !!(bar && bar.classList.contains("is-ticker")),
      expanded: !!(bar && bar.classList.contains("is-expanded")),
      text: text ? String(text.textContent || "") : "",
      cloneCount: clones.length,
      scrollHeight: text ? text.scrollHeight : 0,
      clientHeight: text ? text.clientHeight : 0,
      lineHeight,
      clamped,
      overflowing,
      webkitLineClamp: String(csText.webkitLineClamp || csText.lineClamp || ""),
      whiteSpace: String(csText.whiteSpace || ""),
      textOverflow: String(csText.textOverflow || ""),
      animationName: String(csText.animationName || csBar.animationName || ""),
      textAlign: String(csText.textAlign || csBar.textAlign || ""),
      dir: document.documentElement.getAttribute("dir") || "",
      toggleVisible,
      toggleText: toggle ? String(toggle.textContent || "").trim() : "",
      toggleBorder: String(csToggle.borderTopWidth || ""),
      toggleRadius: String(csToggle.borderRadius || ""),
      toggleDecoration: String(csToggle.textDecorationLine || csToggle.textDecoration || ""),
      ariaExpanded: toggle ? String(toggle.getAttribute("aria-expanded") || "") : "",
      ariaControls: toggle ? String(toggle.getAttribute("aria-controls") || "") : "",
      barH: bar ? bar.getBoundingClientRect().height : 0,
      barW,
      innerW,
      innerRatio: barW > 0 ? innerW / barW : 0,
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth
    };
  });
}

async function waitForLongCollapsed(page) {
  await expect(page.locator("#kutadguAnnounceBar.is-visible")).toBeVisible();
  await expect.poll(async () => {
    const m = await announceMetrics(page);
    return m.toggleVisible && m.clamped && !m.expanded;
  }).toBe(true);
}

async function expandAndCollapse(page) {
  const btn = page.locator("#kutadguAnnounceToggle");
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText("تەپسىلات ↓");
  await btn.click();
  await expect.poll(async () => (await announceMetrics(page)).expanded).toBe(true);
  await expect(btn).toHaveText("يىغىش ↑");
  await expect(btn).toHaveAttribute("aria-expanded", "true");
  const open = await announceMetrics(page);
  expect(open.clamped).toBe(false);
  expect(open.scrollHeight).toBeGreaterThan(open.clientHeight - 1);
  await btn.click();
  await expect.poll(async () => (await announceMetrics(page)).expanded).toBe(false);
  await expect(btn).toHaveText("تەپسىلات ↓");
  await expect(btn).toHaveAttribute("aria-expanded", "false");
}

test.describe("announcement expandable text", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("A short text stays static, centered, and untruncated", async ({ page }) => {
    await H.installAnnouncementFixtures(page, { announcements: [row(SHORT_MSG)] });
    await page.setViewportSize({ width: 1280, height: 800 });
    await H.openFresh(page, "/");
    await expect(page.locator("#kutadguAnnounceBar.is-visible")).toBeVisible();
    await expect.poll(async () => (await announceMetrics(page)).text).toBe(SHORT_MSG);
    const m = await announceMetrics(page);
    expect(m.ticker).toBe(false);
    expect(m.cloneCount).toBe(0);
    expect(m.toggleVisible).toBe(false);
    expect(m.expanded).toBe(false);
    expect(m.animationName === "none" || !m.animationName.includes("kutadgu-announce-ltr")).toBeTruthy();
    expect(["center", "start"]).toContain(m.textAlign);
    expect(m.whiteSpace).not.toBe("nowrap");
    expect(page.locator("#kutadguAnnounceToggle")).toBeHidden();
  });

  test("B long text clamps to two lines and expands in place", async ({ page }) => {
    await H.installAnnouncementFixtures(page, { announcements: [row(DESKTOP_OVERFLOW_MSG, "long")] });
    await page.setViewportSize({ width: 1280, height: 800 });
    await H.openFresh(page, "/");
    await waitForLongCollapsed(page);
    const m = await announceMetrics(page);
    expect(m.ticker).toBe(false);
    expect(m.cloneCount).toBe(0);
    expect(m.text).toBe(DESKTOP_OVERFLOW_MSG);
    expect(m.webkitLineClamp === "2" || m.clamped).toBeTruthy();
    if (m.lineHeight > 0) {
      expect(m.clientHeight).toBeLessThanOrEqual(m.lineHeight * 2 + 4);
    }
    expect(m.pageOverflow).toBeLessThanOrEqual(1);
    expect(Number.parseFloat(m.toggleBorder) || 0).toBeGreaterThan(0);
    expect(m.toggleDecoration.includes("underline")).toBe(false);
    await expect(page.locator("#kutadguAnnounceToggle")).toHaveAttribute("aria-controls", "kutadguAnnounceText");
    await expandAndCollapse(page);
    await page.locator("#kutadguAnnounceToggle").focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await announceMetrics(page)).expanded).toBe(true);
  });

  for (const vp of [
    { name: "C 390x844", width: 390, height: 844 },
    { name: "D 412x915", width: 412, height: 915 },
    { name: "E 768 tablet", width: 768, height: 1024 }
  ]) {
    test(`${vp.name} long announcement expands without page overflow`, async ({ page }) => {
      await H.installAnnouncementFixtures(page, { announcements: [row(DESKTOP_OVERFLOW_MSG, "long")] });
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await H.openFresh(page, "/");
      await waitForLongCollapsed(page);
      const m = await announceMetrics(page);
      expect(m.text).toBe(DESKTOP_OVERFLOW_MSG);
      expect(m.cloneCount).toBe(0);
      expect(m.pageOverflow).toBeLessThanOrEqual(1);
      if (vp.width <= 700) {
        expect(m.innerW / (vp.width - 96)).toBeGreaterThan(0.84);
      }
      await expandAndCollapse(page);
      const toggle = page.locator(".mobile-menu-toggle");
      if (await toggle.isVisible()) {
        await toggle.click();
        await expect(page.locator("nav#mobileSiteMenu.mobile-site-menu")).toHaveClass(/is-open/);
        await toggle.click();
        await expect(page.locator("nav#mobileSiteMenu.mobile-site-menu")).not.toHaveClass(/is-open/);
      }
      if (vp.width <= 700) {
        await expect(page.locator(".mobile-bottom-nav")).toBeVisible();
      }
    });
  }

  test("F desktop 1280 stays compact and expands only when needed", async ({ page }) => {
    await H.installAnnouncementFixtures(page, { announcements: [row(DESKTOP_OVERFLOW_MSG, "long")] });
    await page.setViewportSize({ width: 1280, height: 800 });
    await H.openFresh(page, "/");
    await waitForLongCollapsed(page);
    const collapsed = await announceMetrics(page);
    expect(collapsed.barH).toBeLessThan(80);
    expect(collapsed.pageOverflow).toBeLessThanOrEqual(1);
    expect(collapsed.innerRatio).toBeGreaterThan(0.5);
    await page.locator("#kutadguAnnounceToggle").click();
    await expect.poll(async () => (await announceMetrics(page)).expanded).toBe(true);
    const open = await announceMetrics(page);
    expect(open.barH).toBeGreaterThan(collapsed.barH);
    expect(open.pageOverflow).toBeLessThanOrEqual(1);
  });

  test("G resize shows the control only when rendered text overflows two lines", async ({ page }) => {
    await H.installAnnouncementFixtures(page, { announcements: [row(MOBILE_OVERFLOW_MSG, "mid")] });
    await page.setViewportSize({ width: 390, height: 844 });
    await H.openFresh(page, "/");
    await expect(page.locator("#kutadguAnnounceBar.is-visible")).toBeVisible();
    await expect.poll(async () => {
      const m = await announceMetrics(page);
      return m.toggleVisible === m.clamped;
    }).toBe(true);
    const narrow = await announceMetrics(page);
    expect(narrow.cloneCount).toBe(0);
    expect(narrow.toggleVisible).toBe(narrow.clamped);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect.poll(async () => {
      const m = await announceMetrics(page);
      return m.text === MOBILE_OVERFLOW_MSG && m.toggleVisible === m.clamped && m.cloneCount === 0;
    }).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => {
      const m = await announceMetrics(page);
      return m.text === MOBILE_OVERFLOW_MSG && m.toggleVisible === m.clamped;
    }).toBe(true);
  });

  test("H RTL wrapping stays readable without clipping or ticker motion", async ({ page }) => {
    await H.installAnnouncementFixtures(page, { announcements: [row(DESKTOP_OVERFLOW_MSG, "long")] });
    await page.setViewportSize({ width: 390, height: 844 });
    await H.openFresh(page, "/");
    await waitForLongCollapsed(page);
    const m = await announceMetrics(page);
    expect(m.dir).toBe("rtl");
    expect(m.ticker).toBe(false);
    expect(m.cloneCount).toBe(0);
    expect(m.whiteSpace).not.toBe("nowrap");
    expect(m.animationName === "none" || !m.animationName.includes("kutadgu-announce-ltr")).toBeTruthy();
    expect(m.pageOverflow).toBeLessThanOrEqual(1);
    expect(m.barH).toBeGreaterThan(8);
    expect(m.textOverflow).not.toBe("ellipsis");
    expect(m.innerW / (390 - 96)).toBeGreaterThan(0.84);
  });
});
