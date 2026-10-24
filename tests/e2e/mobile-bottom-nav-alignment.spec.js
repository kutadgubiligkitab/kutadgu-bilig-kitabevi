const { test, expect } = require("./playwright-test");

const PAGES = ["/", "/books.html", "/romanlar.html", "/book-shell.html", "/cart.html", "/favorites.html", "/account.html"];

async function readNav(page) {
  await page.waitForSelector(".mobile-bottom-nav");
  return page.evaluate(async () => {
    const nav = document.querySelector(".mobile-bottom-nav");
    const box = nav.getBoundingClientRect();
    const style = getComputedStyle(nav);
    const links = [...nav.querySelectorAll("a")].map((link) => {
      const linkBox = link.getBoundingClientRect();
      return {
        href: link.getAttribute("href"),
        text: link.textContent.replace(/\s+/g, " ").trim(),
        minHeight: getComputedStyle(link).minHeight,
        center: Math.round(linkBox.top + linkBox.height / 2)
      };
    });
    const pin = [...document.querySelectorAll("link[rel='stylesheet']")].map((link) => link.getAttribute("href")).find((href) => href && href.includes("mobile.css")) || "";
    const css = pin ? await (await fetch(new URL(pin, location.href).href)).text() : "";
    const navRule = (css.match(/\.mobile-bottom-nav\s*\{[^}]+\}/) || [""])[0];
    const safeArea = css.match(/--mobile-bottom-safe:\s*env\(safe-area-inset-bottom,\s*0px\)/g) || [];
    return {
      viewport: document.querySelector('meta[name="viewport"]').content,
      pin,
      bottom: Math.round(box.bottom),
      height: Math.round(box.height),
      paddingBottom: style.paddingBottom,
      position: style.position,
      bodyPadding: getComputedStyle(document.body).paddingBottom,
      rule: navRule,
      safeAreaCount: safeArea.length,
      links,
      overflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      viewportHeight: window.innerHeight
    };
  });
}

test.describe("shared mobile bottom navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/*", (route) => {
      const request = route.request();
      const url = request.url();
      if (request.method() !== "GET" && request.method() !== "HEAD") return route.abort();
      if (/supabase\.co|analytics|posthog|cdn-cgi/.test(url)) return route.abort();
      return route.continue();
    });
  });

  for (const size of [{ width: 390, height: 844, name: "portrait" }, { width: 667, height: 375, name: "landscape" }]) {
    test(`${size.name} keeps one nav position in light and dark`, async ({ page }) => {
      await page.setViewportSize(size);
      const readings = [];
      for (const path of PAGES) {
        await page.goto(path, { waitUntil: "domcontentloaded" });
        await page.evaluate(() => {
          document.body.classList.remove("dark-mode");
          document.documentElement.classList.remove("dark-mode");
        });
        const light = await readNav(page);
        await page.evaluate(() => window.scrollTo(0, 900));
        const scrolled = await readNav(page);
        await page.evaluate(() => {
          document.body.classList.add("dark-mode");
          document.documentElement.classList.add("dark-mode");
        });
        await page.waitForTimeout(400);
        const dark = await readNav(page);
        readings.push({ path, light, scrolled, dark });
      }
      const first = readings[0].light;
      expect(first.viewport).toContain("viewport-fit=cover");
      expect(first.pin).toContain("mobile.css?v=28");
      expect(first.position).toBe("fixed");
      expect(first.paddingBottom).toBe("5px");
      expect(first.safeAreaCount).toBe(1);
      expect(first.rule).toContain("var(--mobile-bottom-safe)");
      expect(first.rule).not.toContain("safe-area-inset-bottom");
      expect(first.links.map((link) => link.href)).toEqual(["/cart.html", "/favorites.html", "/account.html"]);
      expect(first.links.every((link) => link.minHeight === "50px")).toBe(true);
      for (const reading of readings) {
        for (const mode of ["light", "scrolled", "dark"]) {
          const nav = reading[mode];
          expect(nav.viewport, reading.path).toContain("viewport-fit=cover");
          expect(nav.pin, reading.path).toContain("mobile.css?v=28");
          expect(nav.bottom, `${reading.path} ${mode}`).toBe(first.bottom);
          expect(nav.height, reading.path).toBe(first.height);
          expect(nav.paddingBottom, reading.path).toBe(first.paddingBottom);
          expect(nav.bodyPadding, reading.path).toBe(first.bodyPadding);
          expect(nav.links.map((link) => link.center), reading.path).toEqual(first.links.map((link) => link.center));
          expect(nav.overflow, reading.path).toBe(true);
          expect(nav.bottom, reading.path).toBe(nav.viewportHeight);
        }
      }
    });
  }
});
