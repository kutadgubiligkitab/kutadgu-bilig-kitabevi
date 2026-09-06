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
          const btn = getComputedStyle(document.createElement("button"));
          document.body.appendChild(Object.assign(document.createElement("button"), { id: "kutadgu-font-probe" }));
          const probe = document.getElementById("kutadgu-font-probe");
          const probeCs = getComputedStyle(probe);
          const input = document.querySelector("input, textarea, select");
          const inputCs = input ? getComputedStyle(input) : probeCs;
          const header = document.querySelector("header.kutadgu-public-header");
          const search = header && header.querySelector(".kutadgu-header-search");
          probe.remove();
          return {
            fontUi: cs.getPropertyValue("--font-ui"),
            primaryBg: cs.getPropertyValue("--button-primary-bg").trim(),
            secondaryBg: cs.getPropertyValue("--button-secondary-bg").trim(),
            siteBg: cs.getPropertyValue("--site-bg").trim(),
            aliasBg: cs.getPropertyValue("--bg").trim(),
            aliasText: cs.getPropertyValue("--text").trim(),
            siteText: cs.getPropertyValue("--site-text").trim(),
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
        const input = document.querySelector("input");
        const cs = getComputedStyle(document.documentElement);
        return {
          dark: document.body.classList.contains("dark-mode"),
          bodyBg: body.backgroundColor,
          bodyColor: body.color,
          headerBg: header ? getComputedStyle(header).backgroundColor : "",
          headerColor: header ? getComputedStyle(header).color : "",
          inputBg: input ? getComputedStyle(input).backgroundColor : "",
          inputColor: input ? getComputedStyle(input).color : "",
          primary: cs.getPropertyValue("--button-primary-bg").trim(),
          primaryText: cs.getPropertyValue("--button-primary-text").trim(),
          secondary: cs.getPropertyValue("--button-secondary-bg").trim(),
          headerH: header ? header.getBoundingClientRect().height : 0
        };
      });
    }

    const light = await contrastSnap();
    expect(light.dark).toBeFalsy();
    expect(Math.abs(rgbLum(light.bodyBg) - rgbLum(light.bodyColor))).toBeGreaterThan(0.25);
    expect(Math.abs(rgbLum(light.headerBg) - rgbLum(light.headerColor))).toBeGreaterThan(0.25);
    expect(light.headerH).toBeLessThanOrEqual(120);

    await page.locator("header .theme-button, header .theme-toggle").first().click();
    await expect.poll(async () => page.evaluate(() => document.body.classList.contains("dark-mode"))).toBeTruthy();
    const dark = await contrastSnap();
    expect(dark.dark).toBeTruthy();
    expect(dark.bodyBg).not.toBe(light.bodyBg);
    expect(Math.abs(rgbLum(dark.bodyBg) - rgbLum(dark.bodyColor))).toBeGreaterThan(0.25);
    expect(Math.abs(rgbLum(dark.headerBg) - rgbLum(dark.headerColor))).toBeGreaterThan(0.25);
    expect(dark.headerH).toBeLessThanOrEqual(120);
    expect(dark.primary).toBeTruthy();
    expect(dark.primaryText).toBeTruthy();
    expect(dark.secondary).toBeTruthy();
  });
});
