const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const PATHS = ["/", "/adabiyat", "/book/122", "/cart.html", "/favorites.html", "/account.html"];
const VIEWPORTS = [390, 768, 1366];

function rgbLum(rgb) {
  const m = String(rgb).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return 0;
  const [r, g, b] = [m[1], m[2], m[3]].map((n) => Number(n) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a, b) {
  const hi = Math.max(rgbLum(a), rgbLum(b));
  const lo = Math.min(rgbLum(a), rgbLum(b));
  return (hi + 0.05) / (lo + 0.05);
}

test.describe("design foundation", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
    await H.stubNumericBookDocuments(page, ["122"]);
  });

  test("root tokens, UKIJ, RTL, and compact header at 390/768/1366", async ({ page }) => {
    test.setTimeout(90_000);
    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: width === 1366 ? 768 : 844 });
      for (const path of PATHS) {
        await page.goto(path, { waitUntil: "domcontentloaded" });
        await expect.poll(async () => page.locator("header.kutadgu-public-header").count()).toBeGreaterThan(0);
        const snap = await page.evaluate(() => {
          const cs = getComputedStyle(document.documentElement);
          const body = getComputedStyle(document.body);
          const probe = document.createElement("button");
          probe.type = "button";
          probe.id = "kutadgu-font-probe";
          probe.textContent = "ئا";
          document.body.appendChild(probe);
          const probeCs = getComputedStyle(probe);
          const input = document.querySelector(".kutadgu-header-search input, input, textarea, select");
          const inputCs = input ? getComputedStyle(input) : probeCs;
          const header = document.querySelector("header.kutadgu-public-header");
          const search = header && header.querySelector(".kutadgu-header-search");
          const tokenColor = (name) => {
            const el = document.createElement("div");
            el.style.color = "var(" + name + ")";
            document.body.appendChild(el);
            const color = getComputedStyle(el).color;
            el.remove();
            return color;
          };
          const out = {
            fontUi: cs.getPropertyValue("--font-ui"),
            primaryBg: cs.getPropertyValue("--button-primary-bg").trim(),
            secondaryBg: cs.getPropertyValue("--button-secondary-bg").trim(),
            aliasBg: tokenColor("--bg"),
            siteBg: tokenColor("--site-bg"),
            aliasText: tokenColor("--text"),
            siteText: tokenColor("--site-text"),
            bodyFont: body.fontFamily,
            probeFont: probeCs.fontFamily,
            inputFont: inputCs.fontFamily,
            dir: document.documentElement.dir || document.body.dir,
            overflowX: document.documentElement.scrollWidth - window.innerWidth,
            headerH: header ? header.getBoundingClientRect().height : 0,
            searchH: search ? search.getBoundingClientRect().height : 0,
            headerDisplay: header ? getComputedStyle(header).display : "",
            headerFlex: header ? getComputedStyle(header).flexDirection : ""
          };
          probe.remove();
          return out;
        });
        expect(snap.fontUi, path).toMatch(/UKIJ CJK/);
        expect(snap.bodyFont, path).toMatch(/UKIJ CJK/);
        expect(snap.probeFont, path).toMatch(/UKIJ CJK/);
        expect(snap.inputFont, path).toMatch(/UKIJ CJK/);
        expect(snap.primaryBg).toBeTruthy();
        expect(snap.secondaryBg).toBeTruthy();
        expect(snap.aliasBg).toBe(snap.siteBg);
        expect(snap.aliasText).toBe(snap.siteText);
        expect(snap.dir).toBe("rtl");
        expect(snap.overflowX, `${path} ${width}`).toBeLessThanOrEqual(2);
        expect(snap.headerDisplay === "grid" || snap.headerFlex === "row").toBeTruthy();
        expect(snap.searchH).toBeLessThanOrEqual(48);
        expect(snap.headerH).toBeLessThanOrEqual(width === 1366 ? 120 : 210);
      }
    }
  });

  test("light and dark tokens stay readable and header stays compact", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.locator("header .theme-button, header .theme-toggle").count()).toBeGreaterThan(0);

    async function contrastSnap() {
      return page.evaluate(() => {
        const body = getComputedStyle(document.body);
        const header = document.querySelector("header.kutadgu-public-header");
        const input = document.querySelector(".kutadgu-header-search input, input");
        return {
          dark: document.body.classList.contains("dark-mode"),
          bodyBg: body.backgroundColor,
          bodyColor: body.color,
          siteBg: body.getPropertyValue("--site-bg").trim(),
          siteText: body.getPropertyValue("--site-text").trim(),
          headerBg: header ? getComputedStyle(header).backgroundColor : "",
          headerColor: header ? getComputedStyle(header).color : "",
          inputBg: input ? getComputedStyle(input).backgroundColor : "",
          inputColor: input ? getComputedStyle(input).color : "",
          primary: body.getPropertyValue("--button-primary-bg").trim(),
          primaryText: body.getPropertyValue("--button-primary-text").trim(),
          secondary: body.getPropertyValue("--button-secondary-bg").trim(),
          headerH: header ? header.getBoundingClientRect().height : 0
        };
      });
    }

    const light = await contrastSnap();
    expect(light.dark).toBeFalsy();
    expect(light.bodyBg).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\)/);
    expect(light.headerBg).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\)/);
    expect(contrastRatio(light.bodyBg, light.bodyColor)).toBeGreaterThan(3);
    expect(contrastRatio(light.headerBg, light.headerColor)).toBeGreaterThan(3);
    expect(light.headerH).toBeLessThanOrEqual(120);

    await page.locator("header .theme-button, header .theme-toggle").first().click();
    await expect.poll(async () => page.evaluate(() => document.body.classList.contains("dark-mode"))).toBeTruthy();
    await expect.poll(async () => {
      const snap = await contrastSnap();
      return rgbLum(snap.bodyBg);
    }).toBeLessThan(0.25);
    const dark = await contrastSnap();
    expect(dark.dark).toBeTruthy();
    expect(dark.siteBg).not.toBe(light.siteBg);
    expect(dark.siteText).not.toBe(light.siteText);
    expect(contrastRatio(dark.bodyBg, dark.bodyColor)).toBeGreaterThan(3);
    expect(contrastRatio(dark.headerBg, dark.headerColor)).toBeGreaterThan(3);
    expect(dark.headerH).toBeLessThanOrEqual(120);
    expect(dark.primary).toBeTruthy();
    expect(dark.primaryText).toBeTruthy();
    expect(dark.secondary).toBeTruthy();
  });
});
