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
const MOBILE_OVERFLOW_MSG = "يېڭى كىتابلار تېخىمۇ ئەرزان باھادا سېتىلىدۇ!";
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
    const viewport = document.getElementById("kutadguAnnounceViewport");
    const track = document.getElementById("kutadguAnnounceTrack");
    const clones = track ? [...track.querySelectorAll("[data-announce-clone]")] : [];
    const csText = text ? getComputedStyle(text) : {};
    const csTrack = track ? getComputedStyle(track) : {};
    const csBar = bar ? getComputedStyle(bar) : {};
    return {
      ticker: !!(bar && bar.classList.contains("is-ticker")),
      wrap: !!(bar && bar.classList.contains("is-wrap")),
      text: text ? String(text.textContent || "") : "",
      cloneCount: clones.length,
      cloneHidden: clones.every((n) => n.getAttribute("aria-hidden") === "true"),
      cloneText: clones[0] ? String(clones[0].textContent || "") : "",
      scrollWidth: text ? text.scrollWidth : 0,
      clientWidth: viewport ? viewport.clientWidth : 0,
      overflowing: !!(text && viewport && text.scrollWidth > viewport.clientWidth + 1),
      webkitLineClamp: String(csText.webkitLineClamp || ""),
      textOverflow: String(csText.textOverflow || ""),
      whiteSpace: String(csText.whiteSpace || ""),
      animationName: String(csTrack.animationName || ""),
      playState: String(csTrack.animationPlayState || ""),
      duration: String(csTrack.animationDuration || ""),
      justify: String(csBar.justifyContent || csBar.webkitJustifyContent || ""),
      textAlign: String(csBar.textAlign || ""),
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth
    };
  });
}

test.describe("announcement responsive ticker", () => {
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
    expect(m.wrap).toBe(false);
    expect(m.cloneCount).toBe(0);
    expect(m.overflowing).toBe(false);
    expect(m.animationName === "none" || !m.animationName.includes("kutadgu-announce-ltr")).toBeTruthy();
    expect(m.webkitLineClamp === "" || m.webkitLineClamp === "none").toBeTruthy();
    expect(m.textOverflow).not.toBe("ellipsis");
    expect(["center", "start"]).toContain(m.textAlign);
  });

  test("B long text enables ticker without ellipsis and keeps full copy in DOM", async ({ page }) => {
    await H.installAnnouncementFixtures(page, { announcements: [row(DESKTOP_OVERFLOW_MSG, "long")] });
    await page.setViewportSize({ width: 1280, height: 800 });
    await H.openFresh(page, "/");
    await expect(page.locator("#kutadguAnnounceBar.is-visible")).toBeVisible();
    await expect.poll(async () => (await announceMetrics(page)).ticker).toBe(true);
    const m = await announceMetrics(page);
    expect(m.overflowing).toBe(true);
    expect(m.text).toBe(DESKTOP_OVERFLOW_MSG);
    expect(m.cloneCount).toBe(1);
    expect(m.cloneHidden).toBe(true);
    expect(m.cloneText).toBe(DESKTOP_OVERFLOW_MSG);
    expect(m.animationName).toContain("kutadgu-announce-ltr");
    expect(m.webkitLineClamp === "" || m.webkitLineClamp === "none").toBeTruthy();
    expect(m.textOverflow).not.toBe("ellipsis");
    expect(m.whiteSpace).toContain("nowrap");
    expect(m.pageOverflow).toBeLessThanOrEqual(1);
  });

  for (const vp of [
    { name: "C 390x844", width: 390, height: 844, mobileNav: true },
    { name: "D 412x915", width: 412, height: 915, mobileNav: true },
    { name: "E 768 tablet", width: 768, height: 1024, mobileNav: true }
  ]) {
    test(`${vp.name} long announcement tickers without page overflow`, async ({ page }) => {
      await H.installAnnouncementFixtures(page, { announcements: [row(DESKTOP_OVERFLOW_MSG, "long")] });
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await H.openFresh(page, "/");
      await expect(page.locator("#kutadguAnnounceBar.is-visible")).toBeVisible();
      await expect.poll(async () => (await announceMetrics(page)).ticker).toBe(true);
      const m = await announceMetrics(page);
      expect(m.text).toBe(DESKTOP_OVERFLOW_MSG);
      expect(m.cloneCount).toBe(1);
      expect(m.pageOverflow).toBeLessThanOrEqual(1);
      expect(m.webkitLineClamp === "" || m.webkitLineClamp === "none").toBeTruthy();
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

  test("F desktop 1280 hover and focus pause the ticker", async ({ page }) => {
    await H.installAnnouncementFixtures(page, { announcements: [row(DESKTOP_OVERFLOW_MSG, "long")] });
    await page.setViewportSize({ width: 1280, height: 800 });
    await H.openFresh(page, "/");
    await expect.poll(async () => (await announceMetrics(page)).ticker).toBe(true);
    await expect.poll(async () => (await announceMetrics(page)).playState).toBe("running");
    await page.locator("#kutadguAnnounceBar").hover();
    await expect.poll(async () => (await announceMetrics(page)).playState).toBe("paused");
    await page.mouse.move(0, 400);
    await expect.poll(async () => (await announceMetrics(page)).playState).toBe("running");
    await page.locator("#kutadguAnnounceBar").focus();
    await expect.poll(async () => (await announceMetrics(page)).playState).toBe("paused");
  });

  test("G resize switches ticker and static without duplicate clones", async ({ page }) => {
    await H.installAnnouncementFixtures(page, { announcements: [row(MOBILE_OVERFLOW_MSG, "mid")] });
    await page.setViewportSize({ width: 390, height: 844 });
    await H.openFresh(page, "/");
    await expect(page.locator("#kutadguAnnounceBar.is-visible")).toBeVisible();
    await expect.poll(async () => {
      const m = await announceMetrics(page);
      return m.overflowing ? m.ticker : m.ticker === false;
    }).toBe(true);
    const narrow = await announceMetrics(page);
    expect(narrow.cloneCount).toBeLessThanOrEqual(1);
    if (narrow.overflowing) expect(narrow.ticker).toBe(true);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect.poll(async () => {
      const m = await announceMetrics(page);
      if (m.overflowing) return m.ticker === true && m.cloneCount === 1;
      return m.ticker === false && m.cloneCount === 0;
    }).toBe(true);
    const wide = await announceMetrics(page);
    expect(wide.cloneCount).toBeLessThanOrEqual(1);
    expect(wide.text).toBe(MOBILE_OVERFLOW_MSG);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => {
      const m = await announceMetrics(page);
      return m.cloneCount <= 1 && m.text === MOBILE_OVERFLOW_MSG;
    }).toBe(true);
  });

  test("H reduced motion does not continuously animate and remains readable", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await H.installAnnouncementFixtures(page, { announcements: [row(DESKTOP_OVERFLOW_MSG, "long")] });
    await page.setViewportSize({ width: 390, height: 844 });
    await H.openFresh(page, "/");
    await expect(page.locator("#kutadguAnnounceBar.is-visible")).toBeVisible();
    await expect.poll(async () => (await announceMetrics(page)).text).toBe(DESKTOP_OVERFLOW_MSG);
    const m = await announceMetrics(page);
    expect(m.ticker).toBe(false);
    expect(m.wrap).toBe(true);
    expect(m.cloneCount).toBe(0);
    expect(m.animationName === "none" || !m.animationName.includes("kutadgu-announce-ltr")).toBeTruthy();
    expect(m.webkitLineClamp === "" || m.webkitLineClamp === "none").toBeTruthy();
    expect(m.textOverflow).not.toBe("ellipsis");
    expect(m.whiteSpace).not.toBe("nowrap");
    expect(m.pageOverflow).toBeLessThanOrEqual(1);
  });

  async function announceVisibility(page) {
    return page.evaluate(() => {
      function intersect(a, b) {
        if (!a || !b) return false;
        return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top && a.width > 1 && a.height > 1;
      }
      const bar = document.getElementById("kutadguAnnounceBar");
      const viewport = document.getElementById("kutadguAnnounceViewport");
      const track = document.getElementById("kutadguAnnounceTrack");
      const text = document.getElementById("kutadguAnnounceText");
      const copies = track
        ? [text, ...track.querySelectorAll("[data-announce-clone]")].filter(Boolean)
        : (text ? [text] : []);
      const vpBox = viewport ? viewport.getBoundingClientRect() : null;
      const csText = text ? getComputedStyle(text) : {};
      const color = String(csText.color || "");
      const transparent = color === "transparent" || color === "rgba(0, 0, 0, 0)";
      const visibleCopy = copies.some((el) => {
        const cs = getComputedStyle(el);
        if (Number(cs.opacity) <= 0) return false;
        if (cs.visibility === "hidden") return false;
        return intersect(el.getBoundingClientRect(), vpBox);
      });
      return {
        viewportW: viewport ? viewport.clientWidth : 0,
        viewportH: viewport ? viewport.clientHeight : 0,
        text: text ? String(text.textContent || "") : "",
        opacity: Number(csText.opacity),
        visibility: String(csText.visibility || ""),
        color,
        transparent,
        visibleCopy,
        barH: bar ? bar.getBoundingClientRect().height : 0,
        htmlDir: document.documentElement.getAttribute("dir") || ""
      };
    });
  }

  async function sampleTickerHits(page) {
    return page.evaluate(() => {
      function intersect(a, b) {
        return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top && a.width > 1 && a.height > 1;
      }
      const viewport = document.getElementById("kutadguAnnounceViewport");
      const track = document.getElementById("kutadguAnnounceTrack");
      const text = document.getElementById("kutadguAnnounceText");
      if (!viewport || !track || !text) return [];
      const copies = [text, ...track.querySelectorAll("[data-announce-clone]")];
      const vpBox = viewport.getBoundingClientRect();
      const anims = typeof track.getAnimations === "function" ? track.getAnimations() : [];
      const anim = anims[0];
      const duration = anim && anim.effect
        ? Number(anim.effect.getComputedTiming().duration) || 8000
        : 8000;
      const times = [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99, 1];
      if (!anim) {
        return [{ p: 0, hit: copies.some((el) => intersect(el.getBoundingClientRect(), vpBox)) }];
      }
      const prev = anim.currentTime;
      const out = times.map((p) => {
        anim.currentTime = p * duration;
        const vp = viewport.getBoundingClientRect();
        const hit = copies.some((el) => intersect(el.getBoundingClientRect(), vp));
        return { p, hit };
      });
      anim.currentTime = prev;
      return out;
    });
  }

  test("short announcement is visible immediately without ticker", async ({ page }) => {
    await H.installAnnouncementFixtures(page, { announcements: [row(SHORT_MSG)] });
    await page.setViewportSize({ width: 1280, height: 800 });
    await H.openFresh(page, "/");
    await expect(page.locator("#kutadguAnnounceBar.is-visible")).toBeVisible();
    const v = await announceVisibility(page);
    expect(v.text).toBe(SHORT_MSG);
    expect(v.viewportW).toBeGreaterThan(0);
    expect(v.opacity).toBeGreaterThan(0);
    expect(v.visibility).not.toBe("hidden");
    expect(v.transparent).toBe(false);
    expect(v.visibleCopy).toBe(true);
    const m = await announceMetrics(page);
    expect(m.ticker).toBe(false);
    expect(m.animationName === "none" || !m.animationName.includes("kutadgu-announce-ltr")).toBeTruthy();
  });

  test("long announcement text intersects viewport at load and throughout ticker", async ({ page }) => {
    await H.installAnnouncementFixtures(page, { announcements: [row(DESKTOP_OVERFLOW_MSG, "long")] });
    await page.setViewportSize({ width: 390, height: 844 });
    await H.openFresh(page, "/");
    await expect(page.locator("#kutadguAnnounceBar.is-visible")).toBeVisible();
    await expect.poll(async () => (await announceMetrics(page)).ticker).toBe(true);
    const v = await announceVisibility(page);
    expect(v.htmlDir).toBe("rtl");
    expect(v.viewportW).toBeGreaterThan(0);
    expect(v.viewportH).toBeGreaterThan(0);
    expect(v.text.length).toBeGreaterThan(0);
    expect(v.opacity).toBeGreaterThan(0);
    expect(v.visibility).not.toBe("hidden");
    expect(v.transparent).toBe(false);
    expect(v.visibleCopy).toBe(true);
    const samples = await sampleTickerHits(page);
    expect(samples.length).toBeGreaterThan(10);
    samples.forEach((s) => expect(s.hit, "empty ticker at t=" + s.p).toBe(true));
    const beforeAfter = samples.filter((s) => s.p === 0.99 || s.p === 1 || s.p === 0);
    expect(beforeAfter.length).toBeGreaterThan(1);
    beforeAfter.forEach((s) => expect(s.hit, "loop boundary empty at t=" + s.p).toBe(true));
  });

  for (const vp of [
    { name: "portrait 390x844", width: 390, height: 844 },
    { name: "portrait 412x915", width: 412, height: 915 }
  ]) {
    test(`${vp.name} ticker stays filled through a full cycle`, async ({ page }) => {
      await H.installAnnouncementFixtures(page, { announcements: [row(DESKTOP_OVERFLOW_MSG, "long")] });
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await H.openFresh(page, "/");
      await expect(page.locator("#kutadguAnnounceBar.is-visible")).toBeVisible();
      await expect.poll(async () => (await announceMetrics(page)).ticker).toBe(true);
      const v = await announceVisibility(page);
      expect(v.visibleCopy).toBe(true);
      expect(v.opacity).toBeGreaterThan(0);
      expect(v.visibility).not.toBe("hidden");
      expect(v.transparent).toBe(false);
      expect(v.viewportW).toBeGreaterThan(0);
      const m = await announceMetrics(page);
      expect(m.cloneCount).toBe(1);
      expect(m.pageOverflow).toBeLessThanOrEqual(1);
      const samples = await sampleTickerHits(page);
      expect(samples.length).toBeGreaterThan(10);
      samples.forEach((s) => expect(s.hit, `${vp.name} empty at t=${s.p}`).toBe(true));
    });
  }

  for (const vp of [
    { name: "landscape 844x390", width: 844, height: 390 },
    { name: "landscape 915x412", width: 915, height: 412 },
    { name: "tablet 768", width: 768, height: 1024 },
    { name: "desktop 1280", width: 1280, height: 800 }
  ]) {
    test(`${vp.name} long ticker is filled immediately`, async ({ page }) => {
      await H.installAnnouncementFixtures(page, { announcements: [row(DESKTOP_OVERFLOW_MSG, "long")] });
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await H.openFresh(page, "/");
      await expect.poll(async () => (await announceMetrics(page)).ticker).toBe(true);
      const v = await announceVisibility(page);
      expect(v.visibleCopy).toBe(true);
      expect(v.opacity).toBeGreaterThan(0);
      const m = await announceMetrics(page);
      expect(m.cloneCount).toBe(1);
      expect(m.pageOverflow).toBeLessThanOrEqual(1);
      const samples = await sampleTickerHits(page);
      samples.forEach((s) => expect(s.hit, `${vp.name} empty at t=${s.p}`).toBe(true));
    });
  }

  test("portrait→landscape→portrait keeps one clone and a filled viewport", async ({ page }) => {
    await H.installAnnouncementFixtures(page, { announcements: [row(DESKTOP_OVERFLOW_MSG, "long")] });
    const cycle = [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 390, height: 844 }
    ];
    await page.setViewportSize(cycle[0]);
    await H.openFresh(page, "/");
    for (const size of cycle) {
      await page.setViewportSize(size);
      await expect.poll(async () => {
        const m = await announceMetrics(page);
        const vis = await announceVisibility(page);
        return m.ticker === true && m.cloneCount === 1 && vis.visibleCopy === true;
      }).toBe(true);
      const m = await announceMetrics(page);
      expect(m.cloneCount).toBe(1);
      expect(m.pageOverflow).toBeLessThanOrEqual(1);
      const samples = await sampleTickerHits(page);
      samples.forEach((s) => expect(s.hit, `empty after ${size.width}x${size.height} at t=${s.p}`).toBe(true));
    }
  });

  test("412 portrait→landscape→portrait keeps a filled viewport", async ({ page }) => {
    await H.installAnnouncementFixtures(page, { announcements: [row(DESKTOP_OVERFLOW_MSG, "long")] });
    const cycle = [
      { width: 412, height: 915 },
      { width: 915, height: 412 },
      { width: 412, height: 915 }
    ];
    await page.setViewportSize(cycle[0]);
    await H.openFresh(page, "/");
    for (const size of cycle) {
      await page.setViewportSize(size);
      await expect.poll(async () => {
        const m = await announceMetrics(page);
        const vis = await announceVisibility(page);
        return m.ticker === true && m.cloneCount === 1 && vis.visibleCopy === true;
      }).toBe(true);
      const samples = await sampleTickerHits(page);
      samples.forEach((s) => expect(s.hit, `empty after ${size.width}x${size.height} at t=${s.p}`).toBe(true));
    }
  });
});
