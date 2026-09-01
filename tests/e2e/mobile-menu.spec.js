const { test, expect } = require("@playwright/test");
const H = require("./helpers");

function drawer() {
  return "nav#mobileSiteMenu.mobile-site-menu";
}

async function openMobileMenu(page) {
  const toggle = page.locator(".mobile-menu-toggle");
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(drawer())).toHaveClass(/is-open/);
  await expect(page.locator(".mobile-menu-backdrop")).toHaveClass(/is-open/);
}

async function hitTargetAtLinkCenter(page, locator) {
  const box = await locator.boundingBox();
  expect(box, "menu link must have a hit box").toBeTruthy();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  return page.evaluate(({ x, y }) => {
    const node = document.elementFromPoint(x, y);
    if (!node || !(node instanceof Element)) return { tag: "", className: "", href: "", parent: "" };
    const link = node.closest("a");
    return {
      tag: node.tagName,
      className: String(node.className || ""),
      href: link ? link.getAttribute("href") || "" : "",
      parent: node.closest("nav") ? node.closest("nav").id : ""
    };
  }, { x, y });
}

async function expectLinkReceivesHit(page, locator, href) {
  await expect(locator).toBeVisible();
  const hit = await hitTargetAtLinkCenter(page, locator);
  expect(hit.className).not.toMatch(/mobile-menu-backdrop/);
  expect(hit.href).toBe(href);
  expect(hit.parent).toBe("mobileSiteMenu");
  expect(["A", "SPAN"]).toContain(hit.tag);
  return hit;
}

async function expectDrawerHoisted(page) {
  await expect.poll(async () => page.evaluate(() => {
    const nav = document.getElementById("mobileSiteMenu");
    return !!(nav && nav.parentElement === document.body && nav.classList.contains("mobile-site-menu"));
  })).toBe(true);
}

async function findBackdropHitPoint(page) {
  await expect(page.locator(".mobile-menu-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(drawer())).toHaveClass(/is-open/);
  await expect(page.locator(".mobile-menu-backdrop")).toHaveClass(/is-open/);
  await expect.poll(async () => page.evaluate(() => {
    const backdrop = document.querySelector(".mobile-menu-backdrop");
    const nav = document.getElementById("mobileSiteMenu");
    if (!backdrop || !nav) return false;
    const cs = getComputedStyle(backdrop);
    const box = nav.getBoundingClientRect();
    return cs.pointerEvents === "auto"
      && Number(cs.opacity) >= 0.99
      && cs.visibility === "visible"
      && nav.classList.contains("is-open")
      && backdrop.classList.contains("is-open")
      && box.width > 8
      && box.height > 8;
  })).toBe(true);

  const point = await page.evaluate(() => {
    const backdrop = document.querySelector(".mobile-menu-backdrop");
    const nav = document.getElementById("mobileSiteMenu");
    const header = document.querySelector("header.is-mobile-enhanced, .mobile-site-header");
    const toggle = document.querySelector(".mobile-menu-toggle");
    const bottom = document.querySelector(".mobile-bottom-nav");
    if (!backdrop || !nav) return null;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const drawerBox = nav.getBoundingClientRect();
    const headerBox = header ? header.getBoundingClientRect() : { left: 0, right: vw, top: 0, bottom: 62 };
    const toggleBox = toggle ? toggle.getBoundingClientRect() : null;
    const bottomBox = bottom ? bottom.getBoundingClientRect() : null;

    function hitsBackdrop(x, y) {
      if (x < 1 || y < 1 || x >= vw - 1 || y >= vh - 1) return false;
      const node = document.elementFromPoint(x, y);
      if (!node || !(node instanceof Element)) return false;
      return !!node.closest(".mobile-menu-backdrop");
    }
    function outside(box, x, y, pad) {
      if (!box) return true;
      return x < box.left - pad || x > box.right + pad || y < box.top - pad || y > box.bottom + pad;
    }

    const xs = [];
    const ys = [];
    for (let x = 4; x <= vw - 4; x += 8) xs.push(x);
    for (let y = 4; y <= vh - 4; y += 10) ys.push(y);
    const extras = [
      [Math.max(4, drawerBox.left - 6), Math.min(vh - 4, drawerBox.top + 20)],
      [Math.min(vw - 4, drawerBox.right + 6), Math.min(vh - 4, drawerBox.top + 20)],
      [Math.max(4, drawerBox.left - 6), Math.min(vh - 4, (drawerBox.top + drawerBox.bottom) / 2)],
      [Math.min(vw - 4, drawerBox.right + 6), Math.min(vh - 4, (drawerBox.top + drawerBox.bottom) / 2)],
      [vw / 2, Math.min(vh - 4, drawerBox.bottom + 12)]
    ];

    const candidates = extras.concat(ys.flatMap(y => xs.map(x => [x, y])));
    for (const [x, y] of candidates) {
      if (!outside(drawerBox, x, y, 1)) continue;
      if (!outside(headerBox, x, y, 1)) continue;
      if (toggleBox && !outside(toggleBox, x, y, 2)) continue;
      if (bottomBox && !outside(bottomBox, x, y, 1)) continue;
      if (hitsBackdrop(x, y)) return { x, y, className: "mobile-menu-backdrop" };
    }
    const fallbackNode = document.elementFromPoint(4, Math.min(vh - 4, Math.max(headerBox.bottom + 8, drawerBox.top + 8)));
    const fallbackClosest = fallbackNode && fallbackNode.closest ? fallbackNode.closest(".mobile-menu-backdrop") : null;
    return {
      x: 4,
      y: Math.min(vh - 4, Math.max(headerBox.bottom + 8, drawerBox.top + 8)),
      className: fallbackClosest ? "mobile-menu-backdrop" : (fallbackNode ? String(fallbackNode.className || fallbackNode.tagName) : "")
    };
  });

  expect(point, "must find a real backdrop hit point").toBeTruthy();
  expect(point.className).toMatch(/mobile-menu-backdrop/);
  return point;
}

test.describe("mobile menu tap", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("390x844 drawer links receive hits and hash-navigate, not the backdrop", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await H.openFresh(page, "/");
    await openMobileMenu(page);
    await expectDrawerHoisted(page);

    const books = page.locator(`${drawer()} a[href='#books']`);
    await expectLinkReceivesHit(page, books, "#books");
    await books.click();
    await expect.poll(async () => new URL(page.url()).hash).toBe("#books");
    await expect(page.locator(drawer())).not.toHaveClass(/is-open/);
    await expect(page.locator("body")).not.toHaveClass(/mobile-menu-open/);

    await openMobileMenu(page);
    await expectLinkReceivesHit(page, page.locator(`${drawer()} a[href='#home']`), "#home");
    await page.locator(`${drawer()} a[href='#home']`).click();
    await expect.poll(async () => new URL(page.url()).hash).toBe("#home");

    await openMobileMenu(page);
    await expectLinkReceivesHit(page, page.locator(`${drawer()} a[href='#contact']`), "#contact");
    await page.locator(`${drawer()} a[href='#contact']`).click();
    await expect.poll(async () => new URL(page.url()).hash).toBe("#contact");
  });

  test("390x844 account, cart, and favorites menu links navigate", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await H.openFresh(page, "/");
    await openMobileMenu(page);
    await page.locator(`${drawer()} a[href='account.html']`).click();
    await expect.poll(async () => new URL(page.url()).pathname).toBe("/account.html");

    await H.openFresh(page, "/");
    await openMobileMenu(page);
    await page.locator(`${drawer()} a[href='cart.html']`).click();
    await expect.poll(async () => new URL(page.url()).pathname).toBe("/cart.html");

    await H.openFresh(page, "/");
    await openMobileMenu(page);
    await page.locator(`${drawer()} a[href='favorites.html']`).click();
    await expect.poll(async () => new URL(page.url()).pathname).toBe("/favorites.html");
  });

  test("390x844 close control, backdrop, bottom nav, and overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await H.openFresh(page, "/");
    await openMobileMenu(page);
    await page.locator(".mobile-menu-toggle").click();
    await expect(page.locator(".mobile-menu-toggle")).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(drawer())).not.toHaveClass(/is-open/);

    await openMobileMenu(page);
    const gutter = await findBackdropHitPoint(page);
    await page.mouse.click(gutter.x, gutter.y);
    await expect(page.locator(drawer())).not.toHaveClass(/is-open/);
    await expect(page.locator("body")).not.toHaveClass(/mobile-menu-open/);

    await expect(page.locator(".mobile-bottom-nav")).toBeVisible();
    await page.locator(".mobile-bottom-nav a[href='cart.html']").click();
    await expect.poll(async () => new URL(page.url()).pathname).toBe("/cart.html");

    await H.openFresh(page, "/");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(4);
  });

  test("412x915 Android-like width can tap a hash menu link", async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await H.openFresh(page, "/");
    await openMobileMenu(page);
    const about = page.locator(`${drawer()} a[href='#about']`);
    await expectLinkReceivesHit(page, about, "#about");
    await about.click();
    await expect.poll(async () => new URL(page.url()).hash).toBe("#about");
  });

  test("desktop header nav stays in-page and has no mobile drawer toggle", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/");
    await expect(page.locator(".mobile-menu-toggle")).toBeHidden();
    await expect(page.locator("header nav a[href='#books']")).toBeVisible();
    await expect.poll(async () => page.locator("header nav").count()).toBe(1);
    await page.locator("header nav a[href='#books']").click();
    await expect.poll(async () => new URL(page.url()).hash).toBe("#books");
    await expect(page.locator("header nav")).not.toHaveClass(/is-open/);
  });

  test("mobile to desktop resize restores the same header nav", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await H.openFresh(page, "/");
    await openMobileMenu(page);
    await expect.poll(async () => page.evaluate(() => document.getElementById("mobileSiteMenu")?.parentElement === document.body)).toBe(true);

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator(".mobile-menu-toggle")).toBeHidden();
    await expect(page.locator("header nav a[href='#books']")).toBeVisible();
    await expect.poll(async () => page.evaluate(() => {
      const navs = [...document.querySelectorAll("header nav, nav#mobileSiteMenu")];
      const unique = new Set(navs);
      const headerNav = document.querySelector("header nav");
      return {
        unique: unique.size,
        inHeader: !!(headerNav && headerNav.parentElement && headerNav.parentElement.matches("header")),
        open: headerNav ? headerNav.classList.contains("is-open") : false,
        bodyLock: document.body.classList.contains("mobile-menu-open")
      };
    })).toEqual({ unique: 1, inHeader: true, open: false, bodyLock: false });

    await page.locator("header nav a[href='#books']").click();
    await expect.poll(async () => new URL(page.url()).hash).toBe("#books");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".mobile-menu-toggle")).toBeVisible();
    await openMobileMenu(page);
    await expect.poll(async () => page.evaluate(() => document.querySelectorAll("nav#mobileSiteMenu").length)).toBe(1);
    await expectLinkReceivesHit(page, page.locator(`${drawer()} a[href='#books']`), "#books");
  });
});
