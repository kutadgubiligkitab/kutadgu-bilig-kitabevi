/**
 * Isolated commercial editor for a public-site Instagram Story.
 * Photographs the live storefront. Does not change production code or data.
 * Guest cart writes stay in this browser's localStorage.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "artifacts", "promo-story");
const PLATE_DIR = path.join(OUT_DIR, "commercial-plates");
const CLIP_DIR = path.join(OUT_DIR, "commercial-clips");
const QC_DIR = path.join(OUT_DIR, "commercial-qc");
const FINAL_PATH = path.join(OUT_DIR, "kutadgu-professional-story.mp4");
const SITE = "https://www.kutadgubilik.com";
const QUERY = "ئاننا كارېنىنا 1";
const DOMAIN = "kutadgubilik.com";
const BOOK_ID = "147";
const BOOK_HREF = `/book/${BOOK_ID}`;
const CSS_W = 414;
const CSS_H = 736;
const DSF = 4;
const OUT_W = 1080;
const OUT_H = 1920;
const FPS = 30;
const forbiddenClick = /#whatsappOrder|#prepareOrder|#copyOrder|#shareOrder|wa\.me|whatsapp\.com|^tel:/i;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
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
  if (url.hostname.toLowerCase().endsWith(".supabase.co")) {
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

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}\n${err.slice(-1200)}`));
    });
  });
}

function easeExpr(frames) {
  const n = Math.max(1, frames - 1);
  return `((n/${n})*(n/${n})*(3-2*(n/${n})))`;
}

function containedFocus(imgW, imgH, z, cx, cy) {
  const cropW = imgW / z;
  const cropH = cropW * OUT_H / OUT_W;
  return {
    cx: Math.min(imgW - cropW / 2, Math.max(cropW / 2, cx)),
    cy: Math.min(imgH - cropH / 2, Math.max(cropH / 2, cy))
  };
}

async function renderMotion(png, out, motion) {
  const { seconds, imgW, imgH } = motion;
  const z0 = motion.z0 ?? 1.02;
  const z1 = Math.abs((motion.z1 ?? z0) - z0) < 0.015 ? z0 + 0.02 : (motion.z1 ?? z0);
  const frames = Math.max(2, Math.round(seconds * FPS));
  const start = containedFocus(imgW, imgH, Math.max(z0, z1), motion.cx0 ?? imgW / 2, motion.cy0 ?? imgH / 2);
  const end = containedFocus(imgW, imgH, Math.max(z0, z1), motion.cx1 ?? motion.cx0 ?? imgW / 2, motion.cy1 ?? motion.cy0 ?? imgH / 2);
  const ease = easeExpr(frames);
  const z = `(${z0.toFixed(4)}+(${(z1 - z0).toFixed(4)})*${ease})`;
  const progress = `((in_w/${OUT_W}-${z0.toFixed(4)})/${(z1 - z0).toFixed(4)})`;
  const cx = `(${start.cx.toFixed(2)}+(${(end.cx - start.cx).toFixed(2)})*${progress})`;
  const cy = `(${start.cy.toFixed(2)}+(${(end.cy - start.cy).toFixed(2)})*${progress})`;
  const vf = [
    `scale=w='trunc(${OUT_W}*(${z})/2)*2':h='trunc(${imgH}*${OUT_W}*(${z})/${imgW}/2)*2':eval=frame:flags=lanczos`,
    `crop=${OUT_W}:${OUT_H}:(${cx})/${imgW}*in_w-out_w/2:(${cy})/${imgW}*in_w-out_h/2`,
    "setsar=1",
    `fps=${FPS}`,
    "format=yuv420p"
  ].join(",");
  await run("ffmpeg", [
    "-y", "-loop", "1", "-framerate", String(FPS), "-i", png,
    "-vf", vf, "-frames:v", String(frames),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
    out
  ]);
  return seconds;
}

async function renderSequence(frames, out, motion) {
  const list = path.join(CLIP_DIR, `${path.basename(out)}.txt`);
  const lines = frames.map((frame) => `file '${frame.file}'\nduration ${frame.seconds.toFixed(4)}\n`);
  lines.push(`file '${frames[frames.length - 1].file}'\n`);
  fs.writeFileSync(list, lines.join(""));
  let vf = `scale=${OUT_W}:${OUT_H}:flags=lanczos,setsar=1,fps=${FPS},format=yuv420p`;
  if (motion) {
    const focus = containedFocus(motion.imgW, motion.imgH, motion.z, motion.cx, motion.cy);
    const w = motion.imgW / motion.z;
    const h = w * OUT_H / OUT_W;
    vf = [
      `crop=w=${w.toFixed(2)}:h=${h.toFixed(2)}:x=${(focus.cx - w / 2).toFixed(2)}:y=${(focus.cy - h / 2).toFixed(2)}`,
      `scale=${OUT_W}:${OUT_H}:flags=lanczos`,
      "setsar=1",
      `fps=${FPS}`,
      "format=yuv420p"
    ].join(",");
  }
  await run("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", list,
    "-vf", vf,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
    out
  ]);
  return frames.reduce((sum, frame) => sum + frame.seconds, 0);
}

async function renderEntrance(png, out, seconds) {
  const frames = Math.max(2, Math.round(seconds * FPS));
  const ease = easeExpr(frames);
  const z = `(0.84+0.16*${ease})`;
  const vf = [
    `scale=w='trunc(${OUT_W}*(${z})/2)*2':h='trunc(${OUT_H}*(${z})/2)*2':eval=frame:flags=lanczos`,
    `pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2:color=0x1c1410:eval=frame`,
    "setsar=1",
    `fps=${FPS}`,
    "format=yuv420p"
  ].join(",");
  await run("ffmpeg", [
    "-y", "-loop", "1", "-framerate", String(FPS), "-i", png,
    "-vf", vf, "-frames:v", String(frames),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
    out
  ]);
  return seconds;
}

async function joinVideos(files, out) {
  const list = path.join(CLIP_DIR, `${path.basename(out)}.join.txt`);
  fs.writeFileSync(list, files.map((file) => `file '${file}'\n`).join(""));
  await run("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", list,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-an",
    out
  ]);
}

function writeWav(file, samples, rate) {
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + samples.length * 2, 4);
  data.write("WAVE", 8);
  data.write("fmt ", 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i] || 0));
    data.writeInt16LE((value * 32767) | 0, 44 + i * 2);
  }
  fs.writeFileSync(file, data);
}

function synthSoundtrack(events, duration, file) {
  const rate = 44100;
  const samples = new Float64Array(Math.ceil((duration + 0.2) * rate));
  const add = (start, dur, amp, make) => {
    const a = Math.max(0, Math.floor(start * rate));
    const n = Math.floor(dur * rate);
    for (let i = 0; i < n && a + i < samples.length; i += 1) samples[a + i] += make(i, n);
  };
  for (const event of events) {
    if (event.kind === "key") {
      add(event.at, 0.045, 0.22, (i) => (Math.random() * 2 - 1) * Math.exp(-i / (rate * 0.008)));
    } else if (event.kind === "click") {
      add(event.at, 0.07, 0.28, (i) => Math.sin(2 * Math.PI * 920 * i / rate) * Math.exp(-i / (rate * 0.012)));
    } else if (event.kind === "whoosh") {
      add(event.at, 0.42, 0.16, (i, n) => {
        const p = i / n;
        const env = Math.sin(Math.PI * p) ** 1.4;
        return (Math.random() * 2 - 1) * env;
      });
    } else if (event.kind === "pop") {
      add(event.at, 0.16, 0.3, (i) => {
        const f = 640 - 380 * (i / (rate * 0.16));
        return Math.sin(2 * Math.PI * f * i / rate) * Math.exp(-i / (rate * 0.045));
      });
    }
  }
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
  const gain = peak > 0 ? 0.42 / peak : 1;
  writeWav(file, Array.from(samples, (sample) => sample * gain), rate);
}

async function requireUkij(page, selector) {
  const info = await page.evaluate(async (selector) => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const el = document.querySelector(selector);
    const root = getComputedStyle(document.documentElement);
    const check = !!(document.fonts && document.fonts.check('20px "UKIJ CJK"'));
    if (!el) return { ok: false, reason: "missing", check, dir: root.direction };
    const html = document.documentElement;
    const cs = getComputedStyle(el);
    const text = (el.innerText || el.value || el.textContent || "").trim();
    const dir = html.dir || getComputedStyle(html).direction;
    return {
      ok: check && /UKIJ CJK/.test(cs.fontFamily) && dir === "rtl" && html.lang === "ug" && text.length > 0,
      font: cs.fontFamily,
      dir,
      lang: html.lang,
      check,
      text: text.slice(0, 80)
    };
  }, selector);
  if (!info.ok) throw new Error(`UKIJ/RTL gate failed for ${selector}: ${JSON.stringify(info)}`);
  return info;
}

async function waitImages(page) {
  await page.waitForFunction(() => {
    const imgs = [...document.images].filter((img) => {
      const rect = img.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight && rect.width > 8 && !img.hidden;
    });
    return imgs.every((img) => img.complete && img.naturalWidth > 0);
  }, { timeout: 15000 }).catch(() => {});
  await sleep(180);
}

async function shoot(page, file) {
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await waitImages(page);
  await page.screenshot({ path: file, type: "png", animations: "disabled" });
  return file;
}

async function measure(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) return null;
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    cx: (box.x + box.width / 2) * DSF,
    cy: (box.y + box.height / 2) * DSF
  };
}

async function scrollTo(page, selector, offset) {
  const found = await page.evaluate(({ selector, offset }) => {
    const el = document.querySelector(selector);
    if (!el) return false;
    const y = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo(0, Math.max(0, y));
    return true;
  }, { selector, offset });
  if (!found) throw new Error(`Missing ${selector}`);
  await sleep(280);
}

function attachSafety(context, page, blocked) {
  let fatalError = null;
  const markFatal = (reason) => {
    blocked.fatal.push(reason);
    if (!fatalError) fatalError = new Error(reason);
  };
  context.route("**/*", async (route) => {
    const request = route.request();
    let url;
    try { url = new URL(request.url()); } catch { await route.continue(); return; }
    const kind = classify(url, request.method());
    if (kind === "allow") { await route.continue(); return; }
    const line = `${request.method().toUpperCase()} ${publicUrl(request.url())}`;
    if (kind === "fatal") markFatal(line);
    else blocked.analytics.push(line);
    await route.abort();
  });
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
  return () => {
    if (fatalError) throw fatalError;
  };
}

async function safeClick(page, selector) {
  if (forbiddenClick.test(selector)) throw new Error(`Refusing selector ${selector}`);
  const locator = page.locator(selector).filter({ visible: true }).first();
  await locator.waitFor({ state: "visible", timeout: 15000 });
  const href = await locator.getAttribute("href");
  if (href && forbiddenClick.test(href)) throw new Error(`Refusing href ${href}`);
  await locator.click({ delay: 40 });
}

function introHtml(typed, pageImage) {
  const caret = typed.length < DOMAIN.length ? '<span style="display:inline-block;width:2px;height:34px;background:#70503d;margin-left:2px;vertical-align:-6px"></span>' : "";
  const page = pageImage
    ? `<img src="${pageImage}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top center">`
    : `<img src="${SITE}/kutadgu-logo.webp" alt="" width="168" height="168" style="position:absolute;left:50%;top:250px;transform:translateX(-50%);border-radius:32px">`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;width:1080px;height:1920px;overflow:hidden;background:#1c1410;display:flex;align-items:center;justify-content:center;font-family:'Liberation Sans',sans-serif">
    <div style="width:860px;height:1620px;background:linear-gradient(#3a2b24,#241912);border-radius:68px;padding:16px;box-shadow:0 50px 90px rgba(0,0,0,.48)">
      <div style="height:100%;border-radius:54px;background:#f4efe6;position:relative;overflow:hidden">
        ${page}
        <div style="position:absolute;left:28px;right:28px;top:36px;height:96px;border-radius:48px;background:#fffdf9;box-shadow:0 12px 28px rgba(28,20,16,.18);display:flex;align-items:center;padding:0 28px;direction:ltr;z-index:2">
          <span style="width:18px;height:22px;border:3px solid #70503d;border-radius:4px 4px 8px 8px;margin-right:16px;position:relative"><span style="position:absolute;left:3px;top:-9px;width:8px;height:8px;border:3px solid #70503d;border-bottom:0;border-radius:8px 8px 0 0"></span></span>
          <span style="font-size:34px;color:#44352d;letter-spacing:.2px">${typed}${caret}</span>
        </div>
      </div>
    </div>
  </body></html>`;
}

async function captureChip(page) {
  await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"></head>
    <body style="margin:0;background:transparent;display:inline-block">
      <div style="display:inline-block;background:rgba(28,20,16,.92);color:#f6f1ea;font-family:'Liberation Sans',sans-serif;font-size:30px;line-height:1;padding:16px 28px;border-radius:999px">kutadgubilik.com</div>
    </body></html>`, { waitUntil: "load" });
  const file = path.join(PLATE_DIR, "domain-chip.png");
  await page.locator("div").first().screenshot({ path: file, type: "png", omitBackground: true });
  return file;
}

async function captureIntro(browser, heroFile) {
  const context = await browser.newContext({ viewport: { width: OUT_W, height: OUT_H }, deviceScaleFactor: 1, colorScheme: "light" });
  const page = await context.newPage();
  await page.route("https://promo.local/hero.png", (route) => route.fulfill({ path: heroFile, contentType: "image/png" }));
  const frames = [];
  const push = async (typed, seconds, pageImage) => {
    await page.setContent(introHtml(typed, pageImage || ""), { waitUntil: "load" });
    await page.locator("img").first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    await sleep(40);
    const file = path.join(PLATE_DIR, `intro-${String(frames.length).padStart(2, "0")}.png`);
    await page.screenshot({ path: file, type: "png" });
    frames.push({ file, seconds });
  };
  await push("", 0, "");
  for (let i = 1; i <= DOMAIN.length; i += 1) await push(DOMAIN.slice(0, i), 0.095, "");
  await push(DOMAIN, 0.42, "");
  await push(DOMAIN, 0.34, "https://promo.local/hero.png");
  await push(DOMAIN, 0.72, "https://promo.local/hero.png");
  const chip = await captureChip(page);
  await context.close();
  return { frames, chip };
}

async function captureSite(browser, blocked) {
  const context = await browser.newContext({
    viewport: { width: CSS_W, height: CSS_H },
    screen: { width: CSS_W, height: CSS_H },
    deviceScaleFactor: DSF,
    isMobile: true,
    hasTouch: true,
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    colorScheme: "light",
    reducedMotion: "no-preference",
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    serviceWorkers: "block"
  });
  await context.addInitScript(() => {
    const blockedUrl = (value) => /wa\.me|whatsapp\.com|^tel:/i.test(String(value || ""));
    const original = window.open;
    window.open = function (url, ...rest) {
      if (blockedUrl(url)) {
        window.__kutadguPromoBlockedOpen = String(url || "");
        return null;
      }
      return original.call(window, url, ...rest);
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
  const page = await context.newPage();
  const assertSafe = attachSafety(context, page, blocked);
    const plates = {};
    const boxes = {};
    const typeNotes = [];
  try {
    await page.goto(`${SITE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("h1.home-hero-eyebrow", { state: "visible", timeout: 15000 });
    typeNotes.push(await requireUkij(page, "h1.home-hero-eyebrow"));
    await page.evaluate(() => {
      document.querySelectorAll("[data-shop-hero-slide]").forEach((img, index) => img.classList.toggle("is-active", index === 0));
    });
    boxes.hero = await measure(page, "h1.home-hero-eyebrow");
    plates.hero = await shoot(page, path.join(PLATE_DIR, "hero.png"));
    await page.waitForFunction(() => {
      const img = document.querySelector("#homeFeaturedBooks .home-feature-card:not(.is-skeleton) img, .home-carousel-card:not(.is-skeleton) img");
      return !!(img && img.complete && img.naturalWidth > 8);
    }, { timeout: 20000 });
    await scrollTo(page, "#homeFeaturedBooks .home-feature-card:not(.is-skeleton), .home-carousel-card:not(.is-skeleton)", 150);
    typeNotes.push(await requireUkij(page, ".home-feature-title, .home-carousel-title"));
    boxes.books = await page.evaluate((dsf) => {
      const cards = [...document.querySelectorAll("#homeFeaturedBooks .home-feature-card:not(.is-skeleton), .home-carousel-card:not(.is-skeleton)")];
      const ranked = cards.map((card) => {
        const rect = card.getBoundingClientRect();
        const left = Math.max(rect.left, 0);
        const right = Math.min(rect.right, window.innerWidth);
        const top = Math.max(rect.top, 0);
        const bottom = Math.min(rect.bottom, window.innerHeight);
        return { left, top, width: right - left, height: bottom - top };
      }).filter((rect) => rect.width > 80 && rect.height > 80);
      ranked.sort((a, b) => (b.width * b.height) - (a.width * a.height));
      const rect = ranked[0];
      if (!rect) return null;
      return {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        cx: (rect.left + rect.width / 2) * dsf,
        cy: (rect.top + rect.height / 2) * dsf
      };
    }, DSF);
    plates.books = await shoot(page, path.join(PLATE_DIR, "books.png"));

    await scrollTo(page, "#searchInput", 300);
    await page.locator("#searchInput").click({ delay: 30 });
    typeNotes.push(await requireUkij(page, "#homeSearchTitle"));
    plates.search = [];
    for (let i = 0; i <= QUERY.length; i += 1) {
      const partial = QUERY.slice(0, i);
      await page.locator("#searchInput").evaluate((el, value) => {
        el.focus();
        el.value = value;
      }, partial);
      if (i === QUERY.length) {
        typeNotes.push(await requireUkij(page, "#searchInput"));
        boxes.search = await measure(page, "#searchInput");
      }
      const file = path.join(PLATE_DIR, `search-${String(i).padStart(2, "0")}.png`);
      plates.search.push(await shoot(page, file));
    }
    await safeClick(page, "#searchButton");
    await page.waitForSelector(`a.advanced-search-title[href$="${BOOK_HREF}"]`, { state: "visible", timeout: 15000 });
    await scrollTo(page, `a.advanced-search-title[href$="${BOOK_HREF}"]`, 260);
    typeNotes.push(await requireUkij(page, `a.advanced-search-title[href$="${BOOK_HREF}"]`));
    boxes.result = await measure(page, `a.advanced-search-title[href$="${BOOK_HREF}"]`);
    plates.result = await shoot(page, path.join(PLATE_DIR, "result.png"));
    assertSafe();

    await Promise.all([
      page.waitForURL((url) => url.pathname === BOOK_HREF, { timeout: 20000 }),
      safeClick(page, `a.advanced-search-title[href$="${BOOK_HREF}"]`)
    ]);
    await page.waitForFunction((bookId) => {
      const img = document.querySelector(".book-cover-box img");
      const title = document.querySelector(".book-detail-info h1");
      const button = document.querySelector("button.detail-main-cart");
      return !!(img && !img.hidden && img.naturalWidth > 20 && title && title.textContent.includes("ئاننا") && button && button.dataset.cartId === bookId && !button.disabled);
    }, BOOK_ID, { timeout: 20000 });
    typeNotes.push(await requireUkij(page, ".book-detail-info h1"));
    boxes.cover = await measure(page, ".book-cover-box img");
    boxes.title = await measure(page, ".book-detail-info h1");
    plates.cover = await shoot(page, path.join(PLATE_DIR, "cover.png"));
    await scrollTo(page, ".book-detail-info h1", 210);
    boxes.detailTitle = await measure(page, ".book-detail-info h1");
    plates.detail = await shoot(page, path.join(PLATE_DIR, "detail.png"));
    await scrollTo(page, "button.detail-main-cart", 240);
    typeNotes.push(await requireUkij(page, ".detail-price"));
    typeNotes.push(await requireUkij(page, "button.detail-main-cart"));
    boxes.button = await measure(page, "button.detail-main-cart");
    boxes.price = await measure(page, ".detail-price");
    plates.buy = await shoot(page, path.join(PLATE_DIR, "buy.png"));
    plates.button = boxes.button;
    await safeClick(page, `button.detail-main-cart[data-cart-id="${BOOK_ID}"]`);
    await page.waitForFunction((bookId) => {
      try {
        const rows = JSON.parse(localStorage.getItem("kutadgu-cart-v1") || "[]");
        return Array.isArray(rows) && rows.some((row) => String(row && row.id) === bookId);
      } catch { return false; }
    }, BOOK_ID, { timeout: 8000 });
    await sleep(220);
    plates.added = await shoot(page, path.join(PLATE_DIR, "added.png"));
    assertSafe();

    const cartLink = page.locator(".mobile-bottom-nav a[href='/cart.html'], a[href='/cart.html']").filter({ visible: true }).first();
    await Promise.all([
      page.waitForURL((url) => url.pathname.endsWith("/cart.html"), { timeout: 20000 }),
      cartLink.click({ delay: 40 })
    ]);
    await page.waitForFunction(() => {
      const item = document.querySelector("#cartItems .cart-item:not(.is-skeleton) .cart-title");
      return !!(item && item.textContent && item.textContent.includes("ئاننا"));
    }, { timeout: 15000 });
    typeNotes.push(await requireUkij(page, ".cart-title"));
    await scrollTo(page, ".cart-title", 200);
    boxes.cart = await measure(page, ".cart-title");
    plates.cart = await shoot(page, path.join(PLATE_DIR, "cart.png"));
    await page.evaluate(() => {
      const button = document.querySelector("#whatsappOrder");
      const nav = document.querySelector(".mobile-bottom-nav");
      const navH = nav ? nav.getBoundingClientRect().height : 0;
      const targetTop = Math.min(window.innerHeight * 0.56, window.innerHeight - navH - button.getBoundingClientRect().height - 28);
      const y = button.getBoundingClientRect().top + window.scrollY - targetTop;
      window.scrollTo(0, Math.max(0, y));
    });
    await sleep(300);
    typeNotes.push(await requireUkij(page, "#whatsappOrder"));
    boxes.whatsapp = await measure(page, "#whatsappOrder");
    plates.whatsapp = await shoot(page, path.join(PLATE_DIR, "whatsapp.png"));
    const flagged = await page.evaluate(() => ({
      click: window.__kutadguPromoForbiddenClick || "",
      open: window.__kutadguPromoBlockedOpen || ""
    }));
    if (flagged.click) throw new Error(`forbidden click ${flagged.click}`);
    if (flagged.open) throw new Error(`blocked open ${flagged.open}`);
    assertSafe();
  } finally {
    await context.close();
  }
    plates.boxes = boxes;
  return { plates, typeNotes };
}

function aim(box, imgW, imgH, fallbackY) {
  return {
    cx: box && box.cx ? box.cx : imgW / 2,
    cy: box && box.cy ? box.cy : (fallbackY ?? imgH / 2)
  };
}

async function buildClips(introFrames, plates) {
  const imgW = CSS_W * DSF;
  const imgH = CSS_H * DSF;
  const boxes = plates.boxes || {};
  const clips = [];
  const entranceSeconds = 1.05;
  const entrancePath = path.join(CLIP_DIR, "00-entrance.mp4");
  const typingPath = path.join(CLIP_DIR, "00-typing.mp4");
  const introPath = path.join(CLIP_DIR, "01-intro.mp4");
  await renderEntrance(introFrames[0].file, entrancePath, entranceSeconds);
  const typingFrames = introFrames.slice(1);
  const typingDuration = await renderSequence(typingFrames, typingPath);
  await joinVideos([entrancePath, typingPath], introPath);
  const introDuration = entranceSeconds + typingDuration;
  const keyTimes = [];
  let typedAt = entranceSeconds;
  for (const frame of typingFrames) {
    if (frame.seconds <= 0.12) keyTimes.push(typedAt + frame.seconds * 0.35);
    typedAt += frame.seconds;
  }
  clips.push({
    file: introPath,
    duration: introDuration,
    fade: 0.36,
    transition: "fade",
    keys: keyTimes,
    clicks: [Math.max(0.4, introDuration - 1.05)],
    whoosh: true
  });

  const heroAim = aim(boxes.hero, imgW, imgH, imgH * 0.28);
  const hero = path.join(CLIP_DIR, "02-hero.mp4");
  await renderMotion(plates.hero, hero, {
    seconds: 3.8, imgW, imgH, z0: 1.02, z1: 1.06,
    cx0: imgW / 2, cy0: heroAim.cy + 140, cx1: imgW / 2, cy1: heroAim.cy + 40
  });
  clips.push({ file: hero, duration: 3.8, fade: 0.28, transition: "smoothup", whoosh: true });

  const bookAim = aim(boxes.books, imgW, imgH, imgH * 0.42);
  const books = path.join(CLIP_DIR, "03-books.mp4");
  await renderMotion(plates.books, books, {
    seconds: 2.8, imgW, imgH, z0: 1.12, z1: 1.2,
    cx0: bookAim.cx, cy0: bookAim.cy + 40, cx1: bookAim.cx, cy1: bookAim.cy
  });
  clips.push({ file: books, duration: 2.8, fade: 0.2, transition: "fade", whoosh: true });

  const searchFrames = plates.search.map((file, index) => ({
    file,
    seconds: index === 0 ? 0.36 : 0.098
  }));
  searchFrames[searchFrames.length - 1].seconds = 0.62;
  const searchAim = aim(boxes.search, imgW, imgH, imgH * 0.38);
  const searchPath = path.join(CLIP_DIR, "04-search.mp4");
  const searchDuration = await renderSequence(searchFrames, searchPath, {
    imgW, imgH, z: 1.36, cx: searchAim.cx, cy: searchAim.cy + 40
  });
  const searchKeys = [];
  let local = searchFrames[0].seconds;
  for (let i = 1; i < searchFrames.length - 1; i += 1) {
    searchKeys.push(local + 0.03);
    local += searchFrames[i].seconds;
  }
  clips.push({
    file: searchPath,
    duration: searchDuration,
    fade: 0.16,
    transition: "fade",
    keys: searchKeys,
    clicks: [searchDuration - 0.16],
    whoosh: true
  });

  const resultAim = aim(boxes.result, imgW, imgH, imgH * 0.4);
  const result = path.join(CLIP_DIR, "05-result.mp4");
  await renderMotion(plates.result, result, {
    seconds: 3.5, imgW, imgH, z0: 1.02, z1: 1.06,
    cx0: imgW / 2, cy0: resultAim.cy + 80, cx1: resultAim.cx, cy1: resultAim.cy
  });
  clips.push({ file: result, duration: 3.5, fade: 0.1, transition: "fade", clicks: [3.15] });

  const coverAim = aim(boxes.cover, imgW, imgH, imgH * 0.36);
  const cover = path.join(CLIP_DIR, "06-cover.mp4");
  await renderMotion(plates.cover, cover, {
    seconds: 3.2, imgW, imgH, z0: 1.015, z1: 1.04,
    cx0: imgW / 2, cy0: coverAim.cy + 60, cx1: coverAim.cx, cy1: coverAim.cy
  });
  clips.push({ file: cover, duration: 3.2, fade: 0.3, transition: "smoothup", whoosh: true });

  const detailAim = aim(boxes.detailTitle, imgW, imgH, imgH * 0.24);
  const detail = path.join(CLIP_DIR, "06b-detail.mp4");
  await renderMotion(plates.detail, detail, {
    seconds: 2.8, imgW, imgH, z0: 1.015, z1: 1.03,
    cx0: imgW / 2, cy0: detailAim.cy + 180, cx1: imgW / 2, cy1: detailAim.cy + 90
  });
  clips.push({ file: detail, duration: 2.8, fade: 0.22, transition: "smoothup", whoosh: true });

  const buyAim = aim(boxes.button, imgW, imgH, imgH * 0.46);
  const buy = path.join(CLIP_DIR, "07-buy.mp4");
  await renderMotion(plates.buy, buy, {
    seconds: 2.5, imgW, imgH, z0: 1.02, z1: 1.07,
    cx0: imgW / 2, cy0: buyAim.cy - 80, cx1: buyAim.cx, cy1: buyAim.cy
  });
  clips.push({ file: buy, duration: 2.5, fade: 0.08, transition: "fade", clicks: [2.2] });

  const added = path.join(CLIP_DIR, "08-added.mp4");
  await renderMotion(plates.added, added, {
    seconds: 2.2, imgW, imgH, z0: 1.06, z1: 1.02,
    cx0: buyAim.cx, cy0: buyAim.cy, cx1: imgW / 2, cy1: buyAim.cy - 30
  });
  clips.push({ file: added, duration: 2.2, fade: 0.18, transition: "fade", pops: [0.08], clicks: [1.9], whoosh: true });

  const cartAim = aim(boxes.cart, imgW, imgH, imgH * 0.34);
  const cart = path.join(CLIP_DIR, "09-cart.mp4");
  await renderMotion(plates.cart, cart, {
    seconds: 3.6, imgW, imgH, z0: 1.01, z1: 1.02,
    cx0: imgW / 2, cy0: cartAim.cy + 70, cx1: cartAim.cx, cy1: cartAim.cy
  });
  clips.push({ file: cart, duration: 3.6, fade: 0.26, transition: "smoothup", whoosh: true });

  const orderAim = aim(boxes.whatsapp, imgW, imgH, imgH * 0.58);
  const end = path.join(CLIP_DIR, "10-end.mp4");
  await renderMotion(plates.whatsapp, end, {
    seconds: 3.4, imgW, imgH, z0: 1.02, z1: 1.05,
    cx0: imgW / 2, cy0: orderAim.cy - 160, cx1: orderAim.cx, cy1: orderAim.cy - 40
  });
  clips.push({ file: end, duration: 3.4, fade: 0.4, transition: "fade", whoosh: true });

  const endcardPath = path.join(CLIP_DIR, "11-endcard.mp4");
  const endFrame = introFrames[introFrames.length - 1];
  const endcardDuration = await renderSequence([{ file: endFrame.file, seconds: 1.7 }], endcardPath);
  clips.push({ file: endcardPath, duration: endcardDuration, fade: 0, transition: "fade" });
  return clips;
}

async function compose(clips) {
  const filters = [];
  let prev = "[0:v]";
  let cursor = clips[0].duration;
  const starts = [0];
  for (let i = 1; i < clips.length; i += 1) {
    const fade = clips[i - 1].fade;
    const offset = cursor - fade;
    starts.push(offset);
    const label = i === clips.length - 1 ? "[v]" : `[v${i}]`;
    filters.push(`${prev}[${i}:v]xfade=transition=${clips[i - 1].transition}:duration=${fade.toFixed(3)}:offset=${offset.toFixed(3)}${label}`);
    prev = label;
    cursor = offset + clips[i].duration;
  }
  const duration = cursor;
  const events = [];
  clips.forEach((clip, index) => {
    const start = starts[index];
    (clip.keys || []).forEach((at) => events.push({ at: start + at, kind: "key" }));
    (clip.clicks || []).forEach((at) => events.push({ at: start + at, kind: "click" }));
    (clip.pops || []).forEach((at) => events.push({ at: start + at, kind: "pop" }));
    if (clip.whoosh) events.push({ at: start + clip.duration - clip.fade, kind: "whoosh" });
  });
  const wav = path.join(OUT_DIR, "commercial-sfx.wav");
  synthSoundtrack(events, duration, wav);
  const args = ["-y"];
  clips.forEach((clip) => args.push("-i", clip.file));
  args.push("-i", wav);
  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[v]", "-map", `${clips.length}:a`,
    "-t", duration.toFixed(3),
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
    "-movflags", "+faststart",
    FINAL_PATH
  );
  await run("ffmpeg", args);
  return { duration, starts };
}

async function probe(file) {
  const out = await new Promise((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,codec_type,width,height,avg_frame_rate,pix_fmt:format=duration,size", "-of", "json", file], { stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    let err = "";
    child.stdout.on("data", (chunk) => { text += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("close", (code) => code === 0 ? resolve(text) : reject(new Error(err)));
  });
  return JSON.parse(out);
}

async function main() {
  ensureDir(PLATE_DIR);
  ensureDir(CLIP_DIR);
  ensureDir(QC_DIR);
  const blocked = { analytics: [], fatal: [] };
  const metaPath = path.join(PLATE_DIR, "meta.json");
  let intro;
  let site;
  const composeOnly = process.env.PROMO_COMPOSE_ONLY === "1" && fs.existsSync(metaPath);
  const browser = composeOnly ? null : await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox", "--disable-notifications", "--hide-scrollbars"]
  });
  try {
    if (composeOnly) {
      const saved = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      intro = { frames: saved.intro, chip: saved.chip };
      site = { plates: saved.plates, typeNotes: saved.typography };
      blocked.analytics = saved.analytics || [];
      blocked.fatal = saved.fatal || [];
    } else {
      site = await captureSite(browser, blocked);
      intro = await captureIntro(browser, site.plates.hero);
      fs.writeFileSync(metaPath, JSON.stringify({
        intro: intro.frames,
        chip: intro.chip,
        plates: site.plates,
        typography: site.typeNotes,
        analytics: blocked.analytics,
        fatal: blocked.fatal
      }, null, 2));
    }
    const clips = await buildClips(intro.frames, site.plates);
    const composed = await compose(clips);
    const info = await probe(FINAL_PATH);
    const video = (info.streams || []).find((stream) => stream.codec_type === "video") || {};
    const audio = (info.streams || []).find((stream) => stream.codec_type === "audio") || {};
    const duration = Number(info.format && info.format.duration);
    const qcShots = [];
    composed.starts.forEach((start, index) => {
      const clip = clips[index];
      qcShots.push({ name: `${String(index + 1).padStart(2, "0")}`, t: Math.min(duration - 0.25, start + Math.min(0.7, clip.duration * 0.25)) });
      qcShots.push({ name: `${String(index + 1).padStart(2, "0")}r`, t: Math.max(start + 0.2, Math.min(duration - 0.12, start + clip.duration - clip.fade - 0.16)) });
    });
    for (const shot of qcShots) {
      await run("ffmpeg", ["-y", "-i", FINAL_PATH, "-ss", shot.t.toFixed(3), "-frames:v", "1", "-update", "1", path.join(QC_DIR, `${shot.name}.jpg`)]);
    }
    const report = {
      duration,
      width: video.width,
      height: video.height,
      codec: video.codec_name,
      pix_fmt: video.pix_fmt,
      fps: video.avg_frame_rate,
      audio: audio.codec_name || "",
      bytes: Number(info.format && info.format.size),
      capture: `Playwright screenshot ${CSS_W}x${CSS_H} CSS at deviceScaleFactor ${DSF} (${CSS_W * DSF}x${CSS_H * DSF}), lanczos scale to ${OUT_W}x${OUT_H}. Zoom stays at or below source pixels.`,
      typography: site.typeNotes,
      analyticsBlocked: blocked.analytics.length,
      fatal: blocked.fatal,
      starts: composed.starts,
      composeOnly
    };
    fs.writeFileSync(path.join(OUT_DIR, "commercial-report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (video.width !== OUT_W || video.height !== OUT_H) throw new Error("Unexpected size");
    if (video.codec_name !== "h264" || video.pix_fmt !== "yuv420p") throw new Error("Unexpected video encode");
    if (!audio.codec_name) throw new Error("Missing audio");
    if (!(duration >= 30 && duration <= 35)) throw new Error(`Duration ${duration} outside 30-35s`);
    if (blocked.fatal.length) throw new Error(blocked.fatal.join("; "));
  } finally {
    if (browser) await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
