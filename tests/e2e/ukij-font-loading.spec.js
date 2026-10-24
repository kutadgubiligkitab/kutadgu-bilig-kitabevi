const { test, expect } = require("./playwright-test");
// This file installs network routes. Playwright disables HTTP caching when a route is set, so the assertions here are cold routed loads. The unrouted cache check is ukij-font-cache.spec.js.
const H = require("./helpers");

const PAGES = ["/", "/romanlar.html", "/book-shell.html", "/cart.html", "/account.html", "/admin.html", "/book-staff.html"];

function fontKind(url) {
  const path = new URL(url).pathname;
  if (path.endsWith("/UKIJCJK-primary.woff2")) return "primary-woff2";
  if (path.endsWith("/UKIJCJK-primary.ttf")) return "primary-ttf";
  if (path.endsWith("/UKIJCJK.woff2")) return "full-woff2";
  if (path.endsWith("/UKIJCJK.ttf")) return "full-ttf";
  return "";
}

async function openAndCollect(page, path) {
  const seen = [];
  const onRequest = (request) => {
    const kind = fontKind(request.url());
    if (kind) seen.push(kind);
  };
  page.on("request", onRequest);
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  page.off("request", onRequest);
  return seen;
}

async function fontFaces(page) {
  return page.evaluate(() => [...document.fonts]
    .filter((face) => face.family.replace(/"/g, "") === "UKIJ CJK")
    .map((face) => ({
      status: face.status,
      weight: face.weight,
      arabic: /U\+0?621(?:[^0-9A-F]|$)/i.test(face.unicodeRange),
      cjk: /U\+4E00/i.test(face.unicodeRange)
    })));
}

async function platformFonts(page, weight) {
  await page.evaluate((weight) => {
    let probe = document.getElementById("ukij-font-probe");
    if (!probe) {
      probe = document.createElement("span");
      probe.id = "ukij-font-probe";
      probe.textContent = "كىتابخانىسى";
      probe.style.cssText = "position:absolute;left:8px;top:8px;font-size:32px;";
      document.body.appendChild(probe);
    }
    probe.style.fontWeight = weight;
    probe.style.fontFamily = '"UKIJ CJK", Arial, sans-serif';
  }, weight);
  const client = await page.context().newCDPSession(page);
  await client.send("DOM.enable");
  await client.send("CSS.enable");
  const doc = await client.send("DOM.getDocument");
  const node = await client.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#ukij-font-probe" });
  const result = await client.send("CSS.getPlatformFontsForNode", { nodeId: node.nodeId });
  await client.detach();
  return result.fonts;
}

test.describe("UKIJ primary font loading", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("ordinary Uyghur pages use the primary font and defer the original", async ({ page }) => {
    test.setTimeout(120000);
    for (const path of PAGES) {
      const seen = await openAndCollect(page, path);
      expect(seen.filter((kind) => kind === "full-woff2" || kind === "full-ttf"), path).toEqual([]);
      if (path === "/") expect(seen, path).toContain("primary-woff2");
      const family = await page.evaluate(() => {
        const heading = document.querySelector("h1, .kutadgu-brand-text");
        return heading ? getComputedStyle(heading).fontFamily : "";
      });
      expect(family, path).toContain("UKIJ CJK");
      const faces = await fontFaces(page);
      expect(faces.some((face) => face.status === "loaded" && face.arabic && !face.cjk), path).toBe(true);
      expect(faces.some((face) => face.status === "loaded" && face.cjk), path).toBe(false);
      for (const weight of ["400", "700"]) {
        const used = await platformFonts(page, weight);
        expect(used, `${path} ${weight}`).toEqual([
          expect.objectContaining({ familyName: "UKIJ CJK", isCustomFont: true, glyphCount: 11 })
        ]);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(1);
    }

    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    const narrow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(narrow).toBeLessThanOrEqual(1);

    const full = [];
    page.on("request", (request) => {
      const kind = fontKind(request.url());
      if (kind) full.push(kind);
    });
    await page.evaluate(() => {
      const sample = document.createElement("p");
      sample.textContent = "中文 日本語 한글 ㄅ";
      document.body.prepend(sample);
    });
    await expect.poll(() => full.includes("full-woff2")).toBe(true);
    await page.evaluate(() => document.fonts.ready);
  });
});
