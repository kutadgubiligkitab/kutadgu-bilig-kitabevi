const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const SUPABASE_HTTPS_ORIGIN = "https://fxlojnqwyojqjskfggmh.supabase.co";
const CSP_REPORT_ONLY = "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' https://fxlojnqwyojqjskfggmh.supabase.co blob: data:; font-src 'self'; connect-src 'self' https://fxlojnqwyojqjskfggmh.supabase.co; frame-src 'none'; worker-src 'none'; media-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

const XSS_BOOK = {
  id: "900001",
  title: `<img src=x onerror="window.__xssRan=true">`,
  author: `</div><img src=x onerror="window.__xssRan=true">`,
  href: "javascript:window.__xssRan=true",
  image: "javascript:window.__xssRan=true",
  price: 12,
  category: `<b>onerror</b>`,
  isActive: true,
  is_active: true
};

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  expect(overflow).toBe(false);
}

function normalizeCsp(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function assertReportOnlyCsp(value) {
  const csp = normalizeCsp(value);
  expect(csp).toBe(CSP_REPORT_ONLY);
  expect(csp).toMatch(/default-src\s+'self'/);
  expect(csp).toContain(SUPABASE_HTTPS_ORIGIN);
  expect(csp).not.toMatch(/\*\.supabase\.co/);
  expect(csp).not.toMatch(/wss:/i);
  expect(csp).not.toMatch(/unsafe-eval/);
  expect(csp).toMatch(/script-src 'self' https:\/\/cdnjs\.cloudflare\.com/);
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(csp).toMatch(/style-src 'self' 'unsafe-inline'/);
  expect(csp).toMatch(/object-src\s+'none'/);
  expect(csp).toMatch(/frame-ancestors\s+'none'/);
  expect(csp).toMatch(/base-uri\s+'self'/);
  expect(csp).toMatch(/form-action\s+'self'/);
  expect(csp).not.toMatch(/report-uri|report-to/i);
}

function formatCspViolation(v) {
  return [
    `violatedDirective=${v.violatedDirective || ""}`,
    `effectiveDirective=${v.effectiveDirective || ""}`,
    `blockedURI=${v.blockedURI || ""}`,
    `documentURI=${v.documentURI || ""}`
  ].join(" | ");
}

function originOfBlockedUri(uri) {
  const raw = String(uri || "").trim();
  if (!raw || raw === "inline" || raw === "eval" || raw === "wasm-eval") return raw;
  try {
    return new URL(raw).origin;
  } catch (err) {
    return raw;
  }
}

function isForeignHttpsImgSrcViolation(v, pageOrigin) {
  const dir = String(v.effectiveDirective || v.violatedDirective || "").toLowerCase();
  if (!dir.startsWith("img-src")) return false;
  try {
    const parsed = new URL(String(v.blockedURI || ""));
    if (parsed.protocol !== "https:") return false;
    if (parsed.origin === SUPABASE_HTTPS_ORIGIN) return false;
    if (pageOrigin && parsed.origin === pageOrigin) return false;
    return true;
  } catch (err) {
    return false;
  }
}

async function installCspReportOnlyObserver(page) {
  await page.addInitScript(() => {
    const sink = [];
    window.__cspReportOnlyViolations = sink;
    document.addEventListener("securitypolicyviolation", (event) => {
      if (String(event.disposition || "") !== "report") return;
      sink.push({
        violatedDirective: String(event.violatedDirective || ""),
        blockedURI: String(event.blockedURI || ""),
        effectiveDirective: String(event.effectiveDirective || ""),
        documentURI: String(event.documentURI || ""),
        originalPolicy: String(event.originalPolicy || ""),
        sourceFile: String(event.sourceFile || ""),
        sample: String(event.sample || "")
      });
    });
  });
}

async function drainCspReportOnly(page) {
  return page.evaluate(() => (
    Array.isArray(window.__cspReportOnlyViolations)
      ? window.__cspReportOnlyViolations.slice()
      : []
  ));
}

async function settleForCsp(page) {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  try {
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1000)));
  } catch (err) {
    const msg = String(err && err.message || err);
    if (!/Execution context was destroyed|Target closed/i.test(msg)) throw err;
    await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1000)));
  }
}

async function scanForeignCoverImages(page) {
  return page.evaluate((supabaseOrigin) => {
    const out = [];
    for (const img of document.querySelectorAll("img")) {
      const src = String(img.currentSrc || img.getAttribute("src") || "").trim();
      if (!src || src.startsWith("data:") || src.startsWith("blob:")) continue;
      let origin = "";
      try {
        origin = new URL(src, location.href).origin;
      } catch (err) {
        continue;
      }
      if (!origin || origin === location.origin || origin === supabaseOrigin) continue;
      out.push({
        src,
        origin,
        documentURI: location.href,
        bookHref: img.closest("a")?.getAttribute("href") || ""
      });
    }
    return out;
  }, SUPABASE_HTTPS_ORIGIN);
}

test.describe("security hardening 2a", () => {
  test.beforeEach(async ({ page }) => {
    await H.installReadSafeNetwork(page);
  });

  test("security headers are present on HTML", async ({ request, baseURL }) => {
    const res = await request.get(new URL("/", baseURL).href);
    expect(res.status()).toBe(200);
    const headers = res.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-frame-options"].toLowerCase()).toBe("deny");
    expect(headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    expect(headers["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(headers["content-security-policy"] || "").not.toMatch(/script-src/);
    expect(headers["strict-transport-security"]).toBeFalsy();
    expect(headers["content-security-policy-report-only"]).toBeTruthy();
    assertReportOnlyCsp(headers["content-security-policy-report-only"]);
  });

  test("stored XSS fixtures do not execute in mini, featured, or lightbox", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    const result = await page.evaluate((book) => {
      window.__xssRan = false;
      const shop = window.kutadguShop;
      const wrap = document.createElement("div");
      wrap.id = "xss-fixture-host";
      wrap.innerHTML = shop.miniCard(book) + shop.homeFeatureCard(book) + shop.bookCardMarkup(book);
      document.body.appendChild(wrap);
      shop.openCoverLightbox(["javascript:alert(1)", "https://example.com/cover.webp"], 0, book.title);
      const overlay = document.querySelector(".cover-zoom-overlay img");
      const imgs = [...wrap.querySelectorAll("img")];
      const hrefs = [...wrap.querySelectorAll("a")].map((a) => a.getAttribute("href") || "");
      const dangerousHandlers = [...wrap.querySelectorAll("*")].filter((el) => {
        const onerror = el.getAttribute("onerror") || "";
        const onclick = el.getAttribute("onclick") || "";
        return /xssRan|alert\s*\(|javascript:/i.test(`${onerror} ${onclick}`);
      }).length;
      return {
        xss: window.__xssRan === true,
        scripts: wrap.querySelectorAll("script").length,
        dangerousHandlers,
        imgSrcs: imgs.map((img) => img.getAttribute("src") || ""),
        hrefs,
        miniTitle: wrap.querySelector(".shop-mini-title")?.textContent || "",
        featuredTitle: wrap.querySelector(".home-feature-title")?.textContent || "",
        lightboxSrc: overlay ? overlay.getAttribute("src") || overlay.src : "",
        unexpectedImg: wrap.querySelector('img[src="x"]') != null
      };
    }, XSS_BOOK);

    expect(result.xss).toBe(false);
    expect(result.scripts).toBe(0);
    expect(result.dangerousHandlers).toBe(0);
    expect(result.unexpectedImg).toBe(false);
    expect(result.miniTitle).toContain("<img");
    expect(result.featuredTitle).toContain("<img");
    expect(result.imgSrcs.every((src) => !/^\s*javascript:/i.test(src))).toBe(true);
    expect(result.hrefs.every((href) => !/^\s*javascript:/i.test(href))).toBe(true);
    expect(result.lightboxSrc).not.toMatch(/javascript:/i);
    expect(result.lightboxSrc).toContain("example.com/cover.webp");
  });

  test("valid https and internal covers still render", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    const srcs = await page.evaluate(() => {
      const shop = window.kutadguShop;
      return {
        https: shop.coverSrc({ image: "https://cdn.example/ok.webp" }),
        root: shop.coverSrc({ image: "/sample-book-cover.png" }),
        relative: shop.coverSrc({ image: "sample-book-cover.png" }),
        bad: shop.coverSrc({ image: "javascript:alert(1)" })
      };
    });
    expect(srcs.https).toBe("https://cdn.example/ok.webp");
    expect(srcs.root).toBe("");
    expect(srcs.relative).toBe("");
    expect(srcs.bad).toBe("");
    expect(srcs.bad).not.toMatch(/javascript:/i);
  });

  test("admin login and Google OAuth helpers still present", async ({ page }) => {
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#loginPanel")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#loginForm")).toBeVisible();
    await expect(page.locator("#dashboardPanel")).toBeHidden();
    await expect(page.locator("#adminEmail")).toBeVisible();

    await page.goto("/account.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.kutadguGoogleAccountRedirectTo === "function");
    const oauth = await page.evaluate(() => ({
      origin: window.KUTADGU_SITE_ORIGIN,
      google: window.kutadguGoogleAccountRedirectTo()
    }));
    expect(oauth.origin).toBe("https://www.kutadgubilik.com");
    expect(oauth.google).toMatch(/\/account\.html$/);
    expect(oauth.google).not.toMatch(/reset-password/);

    await page.goto("/reset-password.html?type=recovery", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#resetPasswordForm")).toBeVisible();
    await expect(page.locator("#newPassword")).toBeDisabled();
  });

  test("report-only CSP observations on representative Preview pages", async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    await installCspReportOnlyObserver(page);

    const observed = [];
    const foreignCovers = [];
    const consoleReports = [];
    page.on("console", (msg) => {
      const text = String(msg.text() || "");
      if (/report only/i.test(text) && /refused/i.test(text)) consoleReports.push(text);
    });

    async function visit(path, after) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      if (after) await after();
      await settleForCsp(page);
      const batch = await drainCspReportOnly(page);
      for (const event of batch) {
        observed.push(Object.assign({ navigatedPath: path }, event));
      }
      const covers = await scanForeignCoverImages(page);
      for (const cover of covers) foreignCovers.push(Object.assign({ navigatedPath: path }, cover));
    }

    await visit("/", async () => {
      await H.waitForShop(page);
    });
    expect(
      await page.evaluate(() => Array.isArray(window.__cspReportOnlyViolations)),
      "securitypolicyviolation observer should be installed before page scripts"
    ).toBe(true);
    await visit("/universal", async () => {
      await H.waitForShop(page);
    });

    const book = await H.discoverLiveBook(page);
    await visit(book.detailPath, async () => {
      await H.waitForDetailTitle(page, book.title);
    });
    await visit("/cart.html", async () => {
      await H.waitForShop(page);
    });
    await visit("/favorites.html", async () => {
      await H.waitForShop(page);
    });
    await visit("/account.html", async () => {
      await page.waitForFunction(() => typeof window.kutadguGoogleAccountRedirectTo === "function");
      await expect(page.locator("#loginForm, #authPanel").first()).toBeVisible({ timeout: 30_000 });
    });
    await visit("/admin.html", async () => {
      await expect(page.locator("#loginPanel")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("#dashboardPanel")).toBeHidden();
    });

    await visit("/reset-password.html?type=recovery", async () => {
      await expect(page.locator("#resetPasswordForm")).toBeVisible();
      await expect(page.locator("#newPassword")).toBeDisabled();
    });

    await visit("/", async () => {
      await H.waitForShop(page);
      await page.evaluate(() => {
        const img = document.createElement("img");
        img.setAttribute("data-cover-src", "/missing-csp-cover-probe.png");
        img.setAttribute("alt", "");
        img.src = "/missing-csp-cover-probe.png";
        document.body.appendChild(img);
      });
      await page.waitForTimeout(1200);
      await page.evaluate(() => {
        document.querySelector('[data-kutadgu-nav="favorites.html"]')?.click();
      });
    });
    if (/favorites\.html/.test(page.url())) {
      await settleForCsp(page);
      const batch = await drainCspReportOnly(page);
      for (const event of batch) observed.push(Object.assign({ navigatedPath: "/favorites.html#float" }, event));
    }

    await page.goto("/universal", { waitUntil: "domcontentloaded" });
    await H.waitForShop(page);
    await visit("/cart.html", async () => {
      await H.waitForShop(page);
      const back = page.locator("a[data-kutadgu-history-back]");
      await expect(back).toHaveAttribute("href", "/");
      await back.click();
    });
    await settleForCsp(page);

    await visit("/admin-quality-preview.html", async () => {
      await page.locator("#adminBookList, #dashboardPanel").first().waitFor({ timeout: 20_000 }).catch(() => {});
    });

    const pageOrigin = new URL(String(baseURL || page.url())).origin;
    const coverReports = [];
    const unexpected = [];
    const scriptSrcViolations = [];
    for (const event of observed) {
      const line = formatCspViolation(event);
      const dir = String(event.effectiveDirective || event.violatedDirective || "").toLowerCase();
      if (dir.startsWith("script-src")) scriptSrcViolations.push(line);
      if (isForeignHttpsImgSrcViolation(event, pageOrigin)) {
        coverReports.push(`${line} | origin=${originOfBlockedUri(event.blockedURI)}`);
      } else {
        unexpected.push(line);
      }
    }

    if (observed.length) {
      console.log(`[csp-report-only] ${observed.length} securitypolicyviolation event(s) (disposition=report):`);
      for (const event of observed) console.log(`[csp-report-only] ${formatCspViolation(event)}`);
    } else {
      console.log("[csp-report-only] no securitypolicyviolation events (disposition=report)");
    }

    const blockedOrigins = [...new Set(observed.map((event) => originOfBlockedUri(event.blockedURI)).filter(Boolean))];
    if (blockedOrigins.length) {
      console.log(`[csp-report-only] blocked origins: ${blockedOrigins.join(", ")}`);
    }

    if (coverReports.length) {
      console.log("[csp-report-only] live catalog cover hosts outside Policy A img-src (not broadening img-src):");
      for (const line of coverReports) console.log(`[csp-report-only] ${line}`);
    }
    if (foreignCovers.length) {
      const uniqueOrigins = [...new Set(foreignCovers.map((row) => row.origin))];
      console.log(`[csp-report-only] foreign <img> origins on exercised pages: ${uniqueOrigins.join(", ")}`);
      for (const row of foreignCovers) {
        console.log(`[csp-report-only] foreign cover origin=${row.origin} page=${row.documentURI} href=${row.bookHref || "(none)"} src=${row.src}`);
      }
    }
    if (consoleReports.length) {
      console.log("[csp-report-only] browser console Report-Only refusals:");
      for (const line of consoleReports) console.log(`[csp-report-only] ${line}`);
    }

    expect(scriptSrcViolations, scriptSrcViolations.join("\n")).toEqual([]);
    expect(unexpected, unexpected.join("\n")).toEqual([]);
  });

  for (const [width, height] of [[390, 844], [412, 915], [768, 1024], [1280, 800]]) {
    test(`storefront does not overflow at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/index.html", { waitUntil: "domcontentloaded" });
      await expect(page.locator("body")).toBeVisible();
      await expect(page.locator("#searchInput")).toBeVisible();
      await assertNoHorizontalOverflow(page);
    });
  }
});
