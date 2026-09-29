/**
 * Isolated Instagram Story recorder for the public Kutadgu Bilig storefront.
 *
 * Reads the live site. Does not change storefront code or Supabase data.
 * Guest cart writes stay in this browser's localStorage.
 * Supabase writes, analytics posts, WhatsApp, and tel: links are aborted.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "artifacts", "promo-story");
const MP4_PATH = path.join(OUT_DIR, "kutadgu-story.mp4");
const FRAME_DIR = path.join(OUT_DIR, "frames");
const LOG_PATH = path.join(OUT_DIR, "run-log.json");
const SITE = "https://www.kutadgubilik.com";
const QUERY = "ئاننا كارېنىنا 1";
const BOOK_ID = "147";
const BOOK_HREF = `/book/${BOOK_ID}`;
const VIEW = { width: 720, height: 1280 };
const TARGET_MS = 34000;

const forbiddenClick = /#whatsappOrder|#prepareOrder|#copyOrder|#shareOrder|wa\.me|whatsapp\.com|^tel:/i;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function publicUrl(raw) {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return String(raw || "").slice(0, 180);
  }
}

function isWhatsAppHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "wa.me" || host === "whatsapp.com" || host.endsWith(".whatsapp.com") || host.endsWith(".wa.me");
}

function classify(url, method) {
  const verb = String(method || "GET").toUpperCase();
  if (url.protocol === "tel:") return "fatal";
  if (isWhatsAppHost(url.hostname)) return "fatal";
  if (verb === "OPTIONS") return "allow";
  const supabase = url.hostname.toLowerCase().endsWith(".supabase.co");
  if (supabase) {
    if (verb === "GET" || verb === "HEAD") return "allow";
    if (verb === "POST" && url.pathname.includes("/analytics_events")) return "analytics";
    return "fatal";
  }
  if (url.pathname.startsWith("/kbg") || url.hostname.toLowerCase().includes("posthog")) {
    if (verb === "GET" || verb === "HEAD") return "allow";
    return "analytics";
  }
  return "allow";
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}`));
    });
  });
}

function probe(file) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,width,height,avg_frame_rate,pix_fmt:format=duration",
      "-of", "json",
      file
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(err || `ffprobe exited ${code}`));
      else resolve(JSON.parse(out));
    });
  });
}

async function smoothScrollTo(page, targetY, duration) {
  await page.evaluate(async ({ targetY, duration }) => {
    const start = window.scrollY;
    const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const dest = Math.max(0, Math.min(maxY, targetY));
    const delta = dest - start;
    if (Math.abs(delta) < 2) return;
    const t0 = performance.now();
    await new Promise((resolve) => {
      const frame = (now) => {
        const p = Math.min(1, (now - t0) / duration);
        const eased = p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2;
        window.scrollTo(0, start + delta * eased);
        if (p < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }, { targetY, duration });
}

async function elementTop(page, selector) {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    return el.getBoundingClientRect().top + window.scrollY;
  }, selector);
}

async function smoothScrollSelector(page, selector, duration, offset) {
  const top = await elementTop(page, selector);
  if (top == null) throw new Error(`Missing ${selector}`);
  await smoothScrollTo(page, Math.max(0, top - offset), duration);
}

async function safeClick(page, selector) {
  if (forbiddenClick.test(selector)) throw new Error(`Refusing selector ${selector}`);
  const locator = page.locator(selector).filter({ visible: true }).first();
  await locator.waitFor({ state: "visible", timeout: 12000 });
  const href = await locator.getAttribute("href");
  if (href && forbiddenClick.test(href)) throw new Error(`Refusing href ${href}`);
  const id = await locator.getAttribute("id");
  if (id && forbiddenClick.test(`#${id}`)) throw new Error(`Refusing id ${id}`);
  await locator.click({ delay: 60 });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(FRAME_DIR, { recursive: true });
  for (const name of fs.readdirSync(OUT_DIR)) {
    if (name.endsWith(".webm") || name.endsWith(".mp4")) fs.rmSync(path.join(OUT_DIR, name));
  }

  const blocked = { analytics: [], fatal: [] };
  let fatalError = null;
  const markFatal = (reason) => {
    blocked.fatal.push(reason);
    if (!fatalError) fatalError = new Error(reason);
  };

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox", "--disable-notifications", "--hide-scrollbars"]
  });
  const context = await browser.newContext({
    viewport: VIEW,
    screen: VIEW,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    colorScheme: "light",
    reducedMotion: "no-preference",
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    recordVideo: { dir: OUT_DIR, size: VIEW },
    serviceWorkers: "block"
  });

  await context.addInitScript(() => {
    const blocked = (value) => /wa\.me|whatsapp\.com|^tel:/i.test(String(value || ""));
    const originalOpen = window.open;
    window.open = function (url, ...rest) {
      if (blocked(url)) {
        window.__kutadguPromoBlockedOpen = String(url || "");
        return null;
      }
      return originalOpen.call(window, url, ...rest);
    };
    document.addEventListener("click", (event) => {
      const el = event.target && event.target.closest
        ? event.target.closest("#whatsappOrder,#prepareOrder,#copyOrder,#shareOrder,a[href*='wa.me'],a[href*='whatsapp.com'],a[href^='tel:']")
        : null;
      if (!el) return;
      window.__kutadguPromoForbiddenClick = el.id || el.getAttribute("href") || "forbidden";
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  });

  await context.route("**/*", async (route) => {
    const request = route.request();
    let url;
    try { url = new URL(request.url()); } catch { await route.continue(); return; }
    const kind = classify(url, request.method());
    if (kind === "allow") {
      await route.continue();
      return;
    }
    const line = `${request.method().toUpperCase()} ${publicUrl(request.url())}`;
    if (kind === "fatal") markFatal(line);
    else blocked.analytics.push(line);
    await route.abort();
  });

  const page = await context.newPage();
  page.on("popup", async (popup) => {
    markFatal(`popup ${publicUrl(popup.url())}`);
    await popup.close().catch(() => {});
  });
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    const raw = frame.url();
    if (isWhatsAppHost(raw) || raw.startsWith("tel:")) markFatal(`navigation ${publicUrl(raw)}`);
  });
  page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));

  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const marks = [];
  const mark = (label) => {
    const ms = elapsed();
    marks.push({ label, ms });
    console.log(`${(ms / 1000).toFixed(2)}s  ${label}`);
  };
  const until = async (ms) => {
    const wait = ms - elapsed();
    if (wait > 30) await sleep(wait);
  };
  const ensureSafe = async () => {
    const flagged = await page.evaluate(() => ({
      click: window.__kutadguPromoForbiddenClick || "",
      open: window.__kutadguPromoBlockedOpen || ""
    })).catch(() => ({ click: "", open: "" }));
    if (flagged.click) markFatal(`forbidden click ${flagged.click}`);
    if (flagged.open) markFatal(`blocked open ${flagged.open}`);
    if (fatalError) throw fatalError;
  };

  let video = null;
  try {
    video = page.video();
    mark("open");
    await page.goto(`${SITE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("h1.home-hero-eyebrow", { state: "visible", timeout: 15000 });
    await page.waitForFunction(() => {
      const logo = document.querySelector(".kutadgu-site-logo");
      return logo && logo.complete && logo.naturalWidth > 0;
    }, { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    mark("hero");
    const cardsReady = page.waitForFunction(() => {
      const img = document.querySelector("#homeFeaturedBooks .home-feature-card:not(.is-skeleton) img, .home-carousel-card:not(.is-skeleton) img");
      return !!(img && img.complete && img.naturalWidth > 8);
    }, { timeout: 15000 });
    await until(5000);
    await cardsReady;
    mark("cards-ready");
    await smoothScrollSelector(page, "#homeFeaturedBooks .home-feature-card:not(.is-skeleton), .home-carousel-card:not(.is-skeleton)", 1600, 88);
    mark("cards");
    await until(10000);

    await smoothScrollSelector(page, "#searchInput", 1200, 120);
    mark("search-visible");
    const input = page.locator("#searchInput");
    await input.click({ delay: 40 });
    await input.pressSequentially(QUERY, { delay: 70 });
    await sleep(450);
    await safeClick(page, "#searchButton");
    await page.waitForSelector(`a.advanced-search-title[href$="${BOOK_HREF}"]`, { state: "visible", timeout: 15000 });
    await smoothScrollSelector(page, `a.advanced-search-title[href$="${BOOK_HREF}"]`, 900, 180);
    mark("search-result");
    await until(16000);
    await ensureSafe();

    await Promise.all([
      page.waitForURL((url) => url.pathname === BOOK_HREF, { timeout: 20000 }),
      safeClick(page, `a.advanced-search-title[href$="${BOOK_HREF}"]`)
    ]);
    await page.waitForFunction((bookId) => {
      const img = document.querySelector(".book-cover-box img");
      const title = document.querySelector(".book-detail-info h1");
      const button = document.querySelector("button.detail-main-cart");
      const text = title ? title.textContent : "";
      return !!(img && !img.hidden && img.naturalWidth > 20 && text && text.includes("ئاننا") && button && button.dataset.cartId === bookId && !button.disabled);
    }, BOOK_ID, { timeout: 20000 });
    mark("detail");
    await sleep(900);
    await smoothScrollTo(page, 260, 1100);
    mark("detail-scrolled");
    await until(23000);
    await ensureSafe();

    await safeClick(page, `button.detail-main-cart[data-cart-id="${BOOK_ID}"]`);
    await page.waitForFunction((bookId) => {
      try {
        const rows = JSON.parse(localStorage.getItem("kutadgu-cart-v1") || "[]");
        return Array.isArray(rows) && rows.some((row) => String(row && row.id) === bookId && Number(row.qty) >= 1);
      } catch { return false; }
    }, BOOK_ID, { timeout: 8000 });
    await page.waitForSelector(".shop-toast", { state: "visible", timeout: 4000 }).catch(() => {});
    mark("added");
    await until(28000);
    await ensureSafe();

    const cartLink = page.locator(".mobile-bottom-nav a[href='/cart.html'], a[href='/cart.html']").filter({ visible: true }).first();
    await Promise.all([
      page.waitForURL((url) => url.pathname.endsWith("/cart.html"), { timeout: 20000 }),
      cartLink.click({ delay: 60 })
    ]);
    await page.waitForFunction(() => {
      const item = document.querySelector("#cartItems .cart-item:not(.is-skeleton) .cart-title");
      return !!(item && item.textContent && item.textContent.includes("ئاننا"));
    }, { timeout: 15000 });
    mark("cart");
    await until(31500);
    const whatsappTop = await page.evaluate(() => {
      const button = document.querySelector("#whatsappOrder");
      if (!button) return null;
      const nav = document.querySelector(".mobile-bottom-nav");
      const navH = nav ? nav.getBoundingClientRect().height : 0;
      const bottom = button.getBoundingClientRect().bottom + window.scrollY;
      return Math.max(0, bottom - (window.innerHeight - navH - 28));
    });
    if (whatsappTop == null) throw new Error("WhatsApp order button was not on the cart page");
    await smoothScrollTo(page, whatsappTop, 1400);
    mark("whatsapp-visible");
    await page.waitForSelector("#whatsappOrder", { state: "visible", timeout: 4000 });
    await until(TARGET_MS);
    await ensureSafe();
    mark("done");
  } catch (error) {
    fatalError = fatalError || error;
    mark(`error ${error && error.message ? error.message : error}`);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  const webmPath = video ? await video.path().catch(() => "") : "";
  const log = {
    marks,
    analyticsBlocked: blocked.analytics.length,
    analyticsSample: blocked.analytics.slice(0, 12),
    fatal: blocked.fatal,
    webmPath,
    error: fatalError ? String(fatalError.message || fatalError) : ""
  };
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));

  if (fatalError) {
    console.error(fatalError.message || fatalError);
    process.exitCode = 1;
    return;
  }
  if (!webmPath || !fs.existsSync(webmPath)) {
    console.error("Playwright did not save a WebM recording");
    process.exitCode = 1;
    return;
  }

  const keptWebm = path.join(OUT_DIR, "kutadgu-story.webm");
  fs.copyFileSync(webmPath, keptWebm);

  await runFfmpeg([
    "-y",
    "-i", keptWebm,
    "-vf", "scale=1080:1920:flags=lanczos:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0xF6F0E5,unsharp=5:5:0.25:5:5:0.0,fps=30,setsar=1",
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-an",
    MP4_PATH
  ]);

  const info = await probe(MP4_PATH);
  const stream = (info.streams && info.streams[0]) || {};
  const duration = Number(info.format && info.format.duration);
  console.log(JSON.stringify({
    path: MP4_PATH,
    bytes: fs.statSync(MP4_PATH).size,
    duration,
    codec: stream.codec_name,
    width: stream.width,
    height: stream.height,
    pix_fmt: stream.pix_fmt,
    fps: stream.avg_frame_rate
  }, null, 2));

  const frames = [
    ["01-home.jpg", "3"],
    ["02-cards.jpg", "8"],
    ["03-search.jpg", "14"],
    ["04-detail.jpg", "20"],
    ["05-cart-add.jpg", "26"],
    ["06-cart.jpg", "31.2"],
    ["07-whatsapp.jpg", "33.6"]
  ];
  for (const [name, at] of frames) {
    const stamp = Math.max(0, Math.min(Number(at), Math.max(0, duration - 0.2))).toFixed(2);
    await runFfmpeg(["-y", "-ss", stamp, "-i", MP4_PATH, "-frames:v", "1", "-update", "1", path.join(FRAME_DIR, name)]);
  }

  const width = Number(stream.width);
  const height = Number(stream.height);
  const fps = String(stream.avg_frame_rate || "");
  if (width !== 1080 || height !== 1920) throw new Error(`Unexpected size ${width}x${height}`);
  if (stream.codec_name !== "h264") throw new Error(`Unexpected codec ${stream.codec_name}`);
  if (stream.pix_fmt !== "yuv420p") throw new Error(`Unexpected pixel format ${stream.pix_fmt}`);
  const [fpsNum, fpsDen] = fps.split("/").map(Number);
  const fpsValue = fpsDen ? fpsNum / fpsDen : 0;
  if (Math.abs(fpsValue - 30) > 0.05) throw new Error(`Unexpected frame rate ${fps}`);
  if (!(duration >= 30 && duration <= 35)) {
    throw new Error(`Duration ${duration}s is outside 30–35 seconds`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
