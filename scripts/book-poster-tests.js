#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const BLUE_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const DEVICE_CHECK = [
  "Physical iPhone Safari is a pre-release check. Linux WebKit and iPhone viewport emulation are not that check.",
  "1. Sign in to Admin on the iPhone so the session is AAL2.",
  "2. Open a public /book/{id} with a long Uyghur description and the original cover.",
  "3. Tap «رەسىم سۈپىتىدە ساقلاش». Export story (1080×1920) and feed (1080×1350).",
  "4. Confirm joined Uyghur, the real cover, left-to-right ISBN and year, every description paragraph, and no price, cart, favorites, navigation, thumbnails, reviews, or recommendations.",
  "5. Save each image with «ساقلاش», or open «رەسىمنى ئېچىش» and use the system share sheet or long-press save.",
  "6. Confirm the photos in the Photos app."
].join("\n");

let failed = 0;
function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result.then(() => console.log("PASS", name)).catch((error) => {
        failed += 1;
        console.error("FAIL", name, error && error.stack || error);
      });
    }
    console.log("PASS", name);
  } catch (error) {
    failed += 1;
    console.error("FAIL", name, error && error.stack || error);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const htmlFiles = fs.readdirSync(root).filter((name) => name.endsWith(".html"));
const gate = read("kutadgu-book-poster-gate.js");
const poster = read("kutadgu-book-poster.js");
const shell = read("book-shell.html");
const shop = read("shop.js");

test("gate is pinned only on the book shell and the poster module is not a static script", () => {
  assert.equal((shell.match(/kutadgu-book-poster-gate\.js\?v=2/g) || []).length, 1);
  assert.doesNotMatch(shell, /kutadgu-book-poster\.js/);
  htmlFiles.forEach((file) => {
    const text = read(file);
    if (file === "book-shell.html") return;
    assert.doesNotMatch(text, /kutadgu-book-poster/);
  });
  assert.match(gate, /\/kutadgu-book-poster\.js\?v=2/);
  assert.match(gate, /is_kutadgu_admin/);
  assert.match(gate, /aal2/);
  assert.doesNotMatch(gate, /kutadguBookPosterOpen/);
  assert.doesNotMatch(poster, /kutadgu-admin-auth-v1/);
  assert.doesNotMatch(poster, /foreignObject|html2canvas|instagram/i);
  assert.doesNotMatch(shop, /kutadgu-admin-auth-v1|kutadgu-book-poster/);
  assert.doesNotMatch(read("book-staff.js"), /kutadgu-book-poster/);
  assert.doesNotMatch(read("package.json"), /html2canvas|instagram/);
});

test("poster access requires the admin storage key, a session user, AAL2, and is_kutadgu_admin", () => {
  const sandbox = {
    window: {},
    document: {
      readyState: "loading",
      addEventListener() {},
      querySelector() { return null; },
      body: null
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(gate, sandbox);
  const decide = sandbox.kutadguPosterAccessDecision;
  const user = { user: { id: "admin" } };
  function fields(result) { return [result.loadClient, result.loadPoster]; }
  assert.deepStrictEqual(fields(decide({ storageRaw: null, session: user, aal: "aal2", isAdmin: true })), [false, false]);
  assert.deepStrictEqual(fields(decide({ storageRaw: "x", session: null, aal: "aal2", isAdmin: true })), [true, false]);
  assert.deepStrictEqual(fields(decide({ storageRaw: "x", session: user, aal: "aal1", isAdmin: true })), [true, false]);
  assert.deepStrictEqual(fields(decide({ storageRaw: "x", session: user, aal: "aal2", isAdmin: false })), [true, false]);
  assert.deepStrictEqual(fields(decide({ storageRaw: "x", session: user, aal: "aal2", isAdmin: true })), [true, true]);
  assert.equal(decide({ storageRaw: "x", session: user, aal: "AAL2", isAdmin: true }).loadPoster, true);
});

function sentence() {
  return "بۇ رومان يېقىنقى ئەسىر ئۇيغۇر جەمئىيىتىدىكى ئويغىنىش، ۋەتەن سۆيگۈسى ۋە شەخسىي تەقدىر مەسىلىسىنى بايان قىلىدۇ.";
}

function longDescription() {
  const parts = [];
  let text = "";
  while (text.length < 1185) {
    parts.push(sentence(), "", sentence());
    text = parts.join("\n");
  }
  return text;
}

function renderHarness() {
  const description = longDescription().replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!DOCTYPE html>
<html lang="ug" dir="rtl">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/theme.css?v=13">
</head>
<body class="detail-page-body" data-dynamic-book="1" data-book-id="99">
<main class="book-detail-page">
  <nav class="detail-topbar"><a href="/">باش بەت</a></nav>
  <section class="book-detail-top">
    <div class="book-cover-column">
      <div class="book-cover-box"><img data-cover-src="/covers/original.png" src="/covers/variant.png" srcset="/covers/variant.png 480w" alt=""></div>
      <div class="book-gallery-thumbs"><img src="/covers/variant.png" alt="thumb"></div>
    </div>
    <div class="book-detail-info">
      <h1>ئۆزۈمنى ئىزدەپ قېلىش</h1>
      <div class="book-author">ئابدۇرېھىم ئۆتكۈر</div>
      <div class="detail-purchase-panel">₺120 باھاسى سېۋەت ياقتۇر</div>
      <div class="book-meta">
        <div class="book-meta-row"><div class="book-meta-label">نەشر يىلى</div><div class="book-meta-value">2019</div></div>
        <div class="book-meta-row"><div class="book-meta-label">ISBN</div><div class="book-meta-value">978-605-123-456-7</div></div>
        <div class="book-meta-row"><div class="book-meta-label">كىتاب ئۆلچىمى</div><div class="book-meta-value">13.5 × 21 سانتىمېتىر</div></div>
      </div>
      <section class="dynamic-book-description"><h2>كىتاب ھەققىدە</h2><p>${description}</p></section>
      <section class="book-reviews">باھا ۋە ئىنكاس</section>
      <section class="similar-books">تەۋسىيە</section>
    </div>
  </section>
</main>
<script src="/kutadgu-book-poster.js?v=2"></script>
</body>
</html>`;
}

function authHarness(extra) {
  return `<!DOCTYPE html>
<html lang="ug" dir="rtl">
<body data-dynamic-book="1" ${extra || ""}>
<nav class="detail-topbar"></nav>
<script src="/supabase-config.js?v=22"></script>
<script>
const params = new URLSearchParams(location.search);
const mode = params.get("case") || "visitor";
const adminKey = "kutadgu-admin-auth-v1";
const memberKey = "kutadgu-member-auth-v1";
if (mode === "member" || mode === "staff") localStorage.setItem(memberKey, JSON.stringify({ currentSession: { user: { id: "member" } } }));
if (["fake", "aal1", "aal2", "denied", "umd"].includes(mode)) {
  localStorage.setItem(adminKey, mode === "fake" ? "not-a-session" : JSON.stringify({ currentSession: { access_token: "t", user: { id: "admin" } } }));
}
window.__posterAuth = {
  session: ["fake", "visitor", "member", "staff"].includes(mode) ? null : { user: { id: "admin" } },
  aal: mode === "aal2" || mode === "denied" ? "aal2" : "aal1",
  isAdmin: mode === "aal2"
};
window.__createCalls = 0;
if (mode !== "umd") {
  window.supabase = {
    createClient() {
      window.__createCalls += 1;
      const auth = window.__posterAuth;
      return {
        auth: {
          getSession: async () => ({ data: { session: auth.session } }),
          mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: auth.aal } }) }
        },
        rpc: async (name) => ({ data: name === "is_kutadgu_admin" && auth.isAdmin === true })
      };
    }
  };
}
</script>
<script src="/kutadgu-book-poster-gate.js?v=2"></script>
</body>
</html>`;
}

function fontHarness() {
  return `<!DOCTYPE html><html lang="ug" dir="rtl"><head><meta charset="utf-8"></head><body data-dynamic-book="1" data-book-id="5"><script src="/kutadgu-book-poster.js?v=2"></script></body></html>`;
}

function sdkJwt(userId, aal) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
    aal,
    exp: Math.floor(Date.now() / 1000) + 3600
  })).toString("base64url");
  return header + "." + payload + ".sig";
}

function sdkSession(userId, aal) {
  return {
    access_token: sdkJwt(userId, aal),
    refresh_token: "refresh-" + userId.slice(0, 8),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email: userId.slice(0, 8) + "@example.test",
      app_metadata: { provider: "email" },
      user_metadata: {},
      factors: [],
      created_at: "2026-01-01T00:00:00.000Z"
    }
  };
}

const SDK_ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SDK_MEMBER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SDK_FIXTURES = {
  aal2: sdkSession(SDK_ADMIN, "aal2"),
  aal1: sdkSession(SDK_ADMIN, "aal1"),
  member: sdkSession(SDK_MEMBER, "aal2"),
  visitor: null
};

function sdkFixture(mode) {
  return Object.prototype.hasOwnProperty.call(SDK_FIXTURES, mode) ? SDK_FIXTURES[mode] : SDK_FIXTURES.aal2;
}

function sdkHarness(mode) {
  const session = sdkFixture(mode);
  return `<!DOCTYPE html>
<html lang="ug" dir="rtl">
<body data-dynamic-book="1">
<nav class="detail-topbar"></nav>
<script src="/supabase-config.js?v=22"></script>
<script>
const session = ${JSON.stringify(session)};
if (session) localStorage.setItem("kutadgu-admin-auth-v1", JSON.stringify(session));
</script>
<script src="/kutadgu-book-poster-gate.js?v=2"></script>
</body>
</html>`;
}

function contentType(file) {
  const ext = path.extname(file);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".woff2") return "font/woff2";
  return "application/octet-stream";
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/covers/variant.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(BLUE_PNG);
      return;
    }
    if (url.pathname === "/covers/original.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      fs.createReadStream(path.join(root, "sample-book-cover.png")).pipe(res);
      return;
    }
    if (url.pathname === "/poster-render.html" || /^\/book\/99\/?$/.test(url.pathname)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderHarness());
      return;
    }
    if (url.pathname === "/poster-font.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fontHarness());
      return;
    }
    if (/^\/book\/8\/?$/.test(url.pathname)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(sdkHarness(url.searchParams.get("case") || "visitor"));
      return;
    }
    if (/^\/book\/7\/?$/.test(url.pathname)) {
      const extra = url.searchParams.get("case") === "slug" ? 'data-volume-group-slug="demo"' : "";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(authHarness(extra));
      return;
    }
    if (/^\/volume-group\/[^/]+\/?$/.test(url.pathname)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(authHarness('data-volume-group-slug="demo"').replace('case") || "visitor"', 'case") || "aal2"'));
      return;
    }
    if (/^\/book\/\d+\/?$/.test(url.pathname)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(shell);
      return;
    }
    const file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end("missing");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType(file) });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function loadPlaywright() {
  try { return require("playwright"); } catch (error) {}
  return require("@playwright/test");
}

async function settle(page, url) {
  const hits = [];
  page.on("request", (request) => hits.push(request.url()));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(400);
  return hits;
}

async function realSdkSessionChecks(browser, origin) {
  const cases = [
    { name: "aal2", poster: true, admin: true },
    { name: "aal1", poster: false, admin: true },
    { name: "member", poster: false, admin: false },
    { name: "visitor", poster: false, admin: false }
  ];
  for (const item of cases) {
    const expected = sdkFixture(item.name);
    const probe = await browser.newPage();
    let tokenHits = 0;
    await probe.route("**/*", async (route) => {
      const raw = route.request().url();
      if (raw.startsWith("blob:") || raw.startsWith("data:")) return route.continue();
      let url;
      try { url = new URL(raw); } catch (error) { return route.abort(); }
      if (url.hostname === "127.0.0.1") return route.continue();
      if (url.hostname.endsWith(".supabase.co")) {
        if (url.pathname.includes("/auth/v1/token")) {
          tokenHits += 1;
          return route.fulfill({
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({ error: "invalid_grant", error_description: "refresh is not part of this fixture" })
          });
        }
        if (url.pathname.includes("/rpc/is_kutadgu_admin")) {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(item.admin === true)
          });
        }
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      }
      return route.abort();
    });
    const hits = [];
    probe.on("request", (request) => hits.push(request.url()));
    await probe.goto(origin + "/book/8?case=" + item.name, { waitUntil: "load" });
    if (item.poster) await probe.waitForSelector("#kutadguBookPosterOpen", { timeout: 10_000 });
    else await probe.waitForTimeout(700);
    assert.equal(await probe.locator("#kutadguBookPosterOpen").count(), item.poster ? 1 : 0, item.name + " poster control");
    assert.equal(hits.some((hit) => hit.includes("kutadgu-book-poster.js")), item.poster, item.name + " poster module");
    assert.equal(tokenHits, 0, item.name + " called token refresh");
    const stored = await probe.evaluate(() => localStorage.getItem("kutadgu-admin-auth-v1"));
    if (!expected) {
      assert.equal(stored, null, "visitor storage");
    } else {
      const parsed = JSON.parse(stored);
      assert.equal(parsed.user.id, expected.user.id, item.name + " user");
      assert.equal(parsed.access_token, expected.access_token, item.name + " access token changed");
      assert.equal(parsed.refresh_token, expected.refresh_token, item.name + " refresh token changed");
      assert.ok(parsed.expires_at > Math.floor(Date.now() / 1000) + 30, item.name + " expiry");
    }
    await probe.close();
  }
}

async function browserSuite(browserType, name, origin) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await page.route("**/*", (route) => {
    const raw = route.request().url();
    if (raw.startsWith("blob:") || raw.startsWith("data:")) return route.continue();
    const host = new URL(raw).hostname;
    if (host !== "127.0.0.1") return route.abort();
    return route.continue();
  });
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  const cases = ["visitor", "member", "staff", "fake", "aal1", "denied", "slug"];
  for (const mode of cases) {
    const hits = await settle(page, origin + "/book/7?case=" + mode);
    const posterHit = hits.some((item) => item.includes("kutadgu-book-poster.js"));
    const umdHit = hits.some((item) => item.includes("supabase-js-"));
    const button = await page.locator("#kutadguBookPosterOpen").count();
    assert.equal(posterHit, false, mode + " requested the poster module");
    assert.equal(button, 0, mode + " showed the poster control");
    if (mode === "visitor" || mode === "member" || mode === "staff" || mode === "slug") {
      assert.equal(umdHit, false, mode + " requested the Supabase library");
      assert.equal(await page.evaluate(() => window.__createCalls || 0), 0);
    }
  }
  const volumeHits = await settle(page, origin + "/volume-group/demo?case=aal2");
  assert.equal(volumeHits.some((item) => item.includes("kutadgu-book-poster.js")), false);
  assert.equal(await page.locator("#kutadguBookPosterOpen").count(), 0);

  const umdHits = await settle(page, origin + "/book/7?case=umd");
  assert.equal(umdHits.some((item) => item.includes("/vendor/supabase-js-2.45.4.umd.js")), true);
  assert.equal(umdHits.some((item) => item.includes("kutadgu-book-poster.js")), false);
  assert.equal(await page.locator("#kutadguBookPosterOpen").count(), 0);

  const adminHits = await settle(page, origin + "/book/7?case=aal2");
  assert.equal(adminHits.some((item) => item.includes("kutadgu-book-poster.js?v=2")), true);
  assert.equal(adminHits.some((item) => item.includes("/vendor/supabase-js-")), false);
  await page.waitForSelector("#kutadguBookPosterOpen");
  await realSdkSessionChecks(browser, origin);

  const shellHits = [];
  const shellPage = await browser.newPage();
  shellPage.on("request", (request) => shellHits.push(request.url()));
  await shellPage.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host.endsWith("supabase.co") || host.includes("posthog") || host.includes("cloudflare")) return route.abort();
    return route.continue();
  });
  await shellPage.goto(origin + "/book/42", { waitUntil: "load" });
  await shellPage.waitForTimeout(500);
  assert.equal(shellHits.some((item) => item.includes("kutadgu-book-poster.js")), false);
  assert.equal(await shellPage.locator("#kutadguBookPosterOpen").count(), 0);
  await shellPage.close();

  await page.goto(origin + "/book/99", { waitUntil: "load" });
  await page.waitForFunction(() => document.fonts.check('48px "UKIJ CJK"'));
  const book = await page.evaluate(() => window.KutadguBookPoster.readVisibleBook());
  assert.equal(book.title, "ئۆزۈمنى ئىزدەپ قېلىش");
  assert.equal(book.coverSrc, "/covers/original.png");
  assert.doesNotMatch(book.description, /سېۋەت|ياقتۇر|باھاسى|₺/);
  assert.equal(book.description, longDescription());
  const shaping = await page.evaluate(() => window.KutadguBookPoster.shapingProbe());
  assert.equal(shaping.fontCheck48, true);
  assert.ok(shaping.ratio < 0.9, "joined width " + shaping.ratio);
  assert.ok(Math.abs(shaping.domWidth - shaping.canvasWidth) / shaping.canvasWidth < 0.08);

  const source = longDescription();
  const full = {
    title: book.title,
    author: book.author,
    meta: book.meta,
    description: source,
    coverSrc: book.coverSrc
  };
  const short = {
    title: book.title,
    author: "",
    meta: [{ label: "ISBN", value: "978-605-123-456-7" }],
    description: "قىسقا بايان.",
    coverSrc: book.coverSrc
  };
  for (const format of ["story", "feed"]) {
    const rendered = await page.evaluate(async (payload) => window.KutadguBookPoster.exportForTest(payload.model, payload.format, { png: true }), { model: format === "story" ? full : short, format });
    if (format === "story") {
      assert.equal(rendered.ok, true, JSON.stringify(rendered));
      assert.equal(rendered.width, 1080);
      assert.equal(rendered.height, 1920);
      assert.ok(rendered.slides > 1);
      assert.equal(rendered.joined, source);
      assert.equal(rendered.files, rendered.slides);
      assert.equal(rendered.excluded, false);
      assert.equal(rendered.coverOnLaterSlide, false);
      assert.equal(rendered.continuationTitle, true);
      assert.equal(rendered.continuationHeading, true);
      assert.ok(rendered.minMeasured >= 48);
      assert.equal(rendered.dirs["978-605-123-456-7"], "ltr");
      assert.equal(rendered.dirs["2019"], "ltr");
      assert.equal(rendered.dirs["13.5 × 21 سانتىمېتىر"], "rtl");
      assert.ok(rendered.cover.ink > 1000, JSON.stringify(rendered.cover));
      assert.ok(rendered.cover.warm > 500, JSON.stringify(rendered.cover));
      assert.ok(rendered.titleDark > 20);
      const dir = path.join("/opt/cursor/artifacts/book-poster");
      fs.mkdirSync(dir, { recursive: true });
      rendered.pngs.forEach((png, index) => {
        const body = Buffer.from(png.replace(/^data:image\/png;base64,/, ""), "base64");
        fs.writeFileSync(path.join(dir, name + "-story-" + index + ".png"), body);
      });
    } else {
      assert.equal(rendered.ok, true, JSON.stringify(rendered));
      assert.equal(rendered.width, 1080);
      assert.equal(rendered.height, 1350);
      assert.equal(rendered.slides, 1);
      assert.equal(rendered.joined, short.description);
      assert.equal(rendered.files, 1);
      assert.ok(rendered.minMeasured >= 48);
      assert.equal(rendered.dirs["978-605-123-456-7"], "ltr");
      const dir = path.join("/opt/cursor/artifacts/book-poster");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name + "-feed-0.png"), Buffer.from(rendered.pngs[0].replace(/^data:image\/png;base64,/, ""), "base64"));
    }
  }
  const longTitle = new Array(8).fill("ئۆزۈمنى ئىزدەپ قېلىش").join(" ");
  for (const format of ["story", "feed"]) {
    const titled = await page.evaluate(async (payload) => window.KutadguBookPoster.exportForTest(payload.model, payload.format, { png: true }), {
      model: { title: longTitle, author: book.author, meta: book.meta, description: source, coverSrc: book.coverSrc },
      format
    });
    assert.equal(titled.ok, true, JSON.stringify({ code: titled.code, message: titled.message, bounds: titled.bounds }));
    assert.equal(titled.width, 1080);
    assert.equal(titled.height, format === "story" ? 1920 : 1350);
    assert.ok(titled.slides > 1, format + " slides " + titled.slides);
    assert.equal(titled.joined, source);
    assert.equal(titled.excluded, false);
    assert.equal(titled.coverOnLaterSlide, false);
    titled.bounds.forEach((bound, index) => {
      assert.ok(bound.footerScroll <= bound.footerClient + 1, JSON.stringify(bound));
      assert.ok(bound.overflowX <= 1, JSON.stringify(bound));
      assert.ok(bound.pageFont >= 48, JSON.stringify(bound));
      assert.equal(bound.page, (index + 1) + " / " + titled.slides);
      assert.equal(bound.title, longTitle);
    });
    titled.footerInk.forEach((columns) => assert.ok(columns < 320, format + " footer ink columns " + columns));
    const titledDir = path.join("/opt/cursor/artifacts/book-poster");
    fs.mkdirSync(titledDir, { recursive: true });
    titled.pngs.forEach((png, index) => {
      fs.writeFileSync(path.join(titledDir, name + "-long-title-" + format + "-" + index + ".png"), Buffer.from(png.replace(/^data:image\/png;base64,/, ""), "base64"));
    });
  }
  const feedLong = await page.evaluate(async (model) => window.KutadguBookPoster.exportForTest(model, "feed"), full);
  assert.equal(feedLong.ok, true, JSON.stringify(feedLong));
  assert.ok(feedLong.slides > 1);
  assert.equal(feedLong.joined, source);
  assert.equal(feedLong.width, 1080);
  assert.equal(feedLong.height, 1350);
  assert.equal(feedLong.excluded, false);
  assert.equal(feedLong.coverOnLaterSlide, false);

  const missing = await page.evaluate(async (model) => window.KutadguBookPoster.exportForTest(model, "story"), Object.assign({}, short, { coverSrc: "/missing-cover.png" }));
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "cover");
  assert.equal(missing.files, 0);
  assert.match(missing.message, /قايتا سىناڭ/);
  const beforeSample = requests.length;
  const sample = await page.evaluate(async (model) => window.KutadguBookPoster.exportForTest(model, "story"), Object.assign({}, short, { coverSrc: "/sample-book-cover.png" }));
  assert.equal(sample.ok, false);
  assert.equal(sample.code, "cover");
  assert.equal(sample.files, 0);
  assert.equal(requests.slice(beforeSample).some((item) => item.includes("sample-book-cover.png")), false);

  await page.evaluate(() => window.KutadguBookPoster.attach());
  await page.locator("#kutadguBookPosterOpen").click();
  await page.evaluate(() => {
    document.querySelector(".book-cover-box img").setAttribute("data-cover-src", "/missing-cover.png");
  });
  await page.locator("[data-poster-format=story]").click();
  await page.waitForSelector("[data-poster-status][data-state=error]");
  assert.equal(await page.locator("[data-poster-preview] img").count(), 0);
  assert.equal(await page.locator("[data-poster-retry]").isVisible(), true);
  await page.evaluate(() => {
    document.querySelector(".book-cover-box img").setAttribute("data-cover-src", "/covers/original.png");
  });
  await page.locator("[data-poster-retry]").click();
  await page.waitForFunction(() => {
    const img = document.querySelector("[data-poster-preview] img");
    return img && img.complete && img.naturalWidth === 1080 && img.naturalHeight === 1920;
  });
  const saved = page.locator("[data-poster-preview] a[download]");
  const opened = page.locator("[data-poster-preview] a[target=_blank]");
  assert.equal(await saved.count(), await page.locator("[data-poster-preview] img").count());
  assert.match(await opened.first().getAttribute("href"), /^blob:/);
  assert.equal(await opened.first().textContent(), "رەسىمنى ئېچىش");
  await page.locator("[data-poster-format=feed]").click();
  await page.waitForFunction(() => {
    const img = document.querySelector("[data-poster-preview] img");
    return img && img.naturalWidth === 1080 && img.naturalHeight === 1350;
  });

  await page.goto(origin + "/poster-font.html", { waitUntil: "load" });
  const fontMiss = await page.evaluate(async () => window.KutadguBookPoster.exportForTest({
    title: "ئۆزۈمنى ئىزدەپ قېلىش",
    description: "قىسقا بايان.",
    coverSrc: "/covers/original.png"
  }, "story"));
  assert.equal(fontMiss.ok, false);
  assert.equal(fontMiss.code, "font");
  assert.equal(fontMiss.files, 0);
  await browser.close();
  return shaping;
}

async function main() {
  const server = await startServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const playwright = loadPlaywright();
  const chromiumShape = await browserSuite(playwright.chromium, "chromium", origin);
  const webkitShape = await browserSuite(playwright.webkit, "webkit", origin);
  const iphone = await playwright.webkit.launch();
  const context = await iphone.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    userAgent: playwright.devices["iPhone 13"].userAgent,
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  await page.goto(origin + "/book/99", { waitUntil: "load" });
  await page.waitForFunction(() => document.fonts.check('48px "UKIJ CJK"'));
  const emulated = await page.evaluate(() => window.KutadguBookPoster.shapingProbe());
  assert.ok(Math.abs(emulated.ratio - webkitShape.ratio) < 0.02);
  await iphone.close();
  server.close();
  console.log("SHAPING", JSON.stringify({ chromium: chromiumShape, webkit: webkitShape, emulatedWebKit: emulated }));
  console.log(DEVICE_CHECK);
  console.log("Emulation user agent is host WebKit with an iPhone user agent. It is not a physical iPhone, Core Text, or the iOS share sheet.");
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
