const { test, expect } = require("./playwright-test");
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

test.describe("UKIJ primary font loading", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("ordinary Uyghur pages use the primary font and defer the original", async ({ page }) => {
    test.setTimeout(120000);
    for (const path of PAGES) {
      const seen = await openAndCollect(page, path);
      expect(seen.filter((kind) => kind === "full-woff2" || kind === "full-ttf"), path).toEqual([]);
      if (path === "/") {
        expect(seen, path).toContain("primary-woff2");
      } else {
        const loaded = await page.evaluate(() => document.fonts.check('16px "UKIJ CJK"'));
        expect(loaded, path).toBe(true);
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
