#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const hero = require(path.join(root, "home-hero-content.js"));
const slideshow = require(path.join(root, "home-hero-slideshow.js"));
const js = fs.readFileSync(path.join(root, "home-hero-content.js"), "utf8");
const slideJs = fs.readFileSync(path.join(root, "home-hero-slideshow.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "stage3-shop-identity.css"), "utf8");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, err.message);
  }
}

test("hard-coded fallback identity is still in index.html", () => {
  assert.match(html, /قۇتادغۇبىلىك كىتابخانىسى/);
  assert.match(html, /2013-يىلدىن بۇيان/);
  assert.match(html, /id="books"/);
  assert.match(html, /href="\/books"/);
  assert.match(html, /href="#about"/);
  assert.match(html, /كىتابلارنى كۆرۈش/);
  assert.match(html, /بىز ھەققىدە/);
  assert.match(html, /\/assets\/store\/shop-interior-main\.webp/);
  assert.match(html, /\/assets\/store\/shop-interior-library\.webp/);
  assert.match(html, /\/assets\/store\/shop-exterior\.webp/);
  assert.match(html, /fetchpriority="high"/);
  assert.match(html, /data-home-hero-eyebrow/);
  assert.match(html, /data-home-hero-title/);
  assert.match(html, /role="heading"/);
  assert.match(html, /aria-level="1"/);
  assert.match(html, /home-hero-slideshow\.js\?v=2/);
  assert.match(html, /home-hero-content\.js\?v=1/);
  const slideAt = html.indexOf("home-hero-slideshow.js");
  const contentAt = html.indexOf("home-hero-content.js");
  assert.ok(slideAt >= 0 && contentAt > slideAt);
  assert.doesNotMatch(html, /<h1[\s>]/);
});

test("slideshow keeps 7000 default and exposes a safe refresh API", () => {
  assert.match(slideJs, /INTERVAL_MS=7000/);
  assert.match(slideJs, /kutadgu:hero-slide-change/);
  assert.match(slideJs, /KutadguHeroSlideshow/);
  assert.match(slideJs, /getIntervalMs/);
  assert.match(slideJs, /prefers-reduced-motion:\s*reduce/);
  assert.strictEqual(slideshow.normalizeInterval(5000), 5000);
  assert.strictEqual(slideshow.normalizeInterval(7000), 7000);
  assert.strictEqual(slideshow.normalizeInterval(10000), 10000);
  assert.strictEqual(slideshow.normalizeInterval(15000), 15000);
  assert.strictEqual(slideshow.normalizeInterval(3000), 7000);
  assert.strictEqual(slideshow.normalizeInterval(8000), 7000);
  assert.strictEqual(slideshow.normalizeInterval("nope"), 7000);
});

test("internal hrefs match SQL intent", () => {
  ["#books", "#about", "/books", "/book/123", "/adabiyat", "/children"].forEach((href) => {
    assert.strictEqual(hero.isInternalHref(href), true, href);
  });
  [
    "//evil.example",
    "http://example.com",
    "https://external.example",
    "javascript:alert(1)",
    "data:text/html,x",
    "vbscript:x",
    "file:///etc/passwd",
    "blob:https://x",
    "./secret",
    "../escape",
    "/../escape",
    "https://kutadgubilik.com/"
  ].forEach((href) => {
    assert.strictEqual(hero.isInternalHref(href), false, href);
  });
});

test("image URLs allow https and root-relative only", () => {
  assert.strictEqual(hero.isSafeImageUrl("https://cdn.example/cover.webp"), true);
  assert.strictEqual(hero.isSafeImageUrl("/assets/store/shop-interior-main.webp"), true);
  [
    "http://insecure.example/x.webp",
    "javascript:alert(1)",
    "data:image/gif;base64,xx",
    "vbscript:x",
    "file:///x",
    "blob:https://x",
    "//cdn.example/x.webp"
  ].forEach((url) => {
    assert.strictEqual(hero.isSafeImageUrl(url), false, url);
  });
});

test("repo_key mapping is a fixed allow-list", () => {
  assert.strictEqual(hero.repoSlideForKey("main").src, "/assets/store/shop-interior-main.webp");
  assert.strictEqual(hero.repoSlideForKey("library").src, "/assets/store/shop-interior-library.webp");
  assert.strictEqual(hero.repoSlideForKey("exterior").src, "/assets/store/shop-exterior.webp");
  assert.strictEqual(hero.repoSlideForKey("../main"), null);
  assert.strictEqual(hero.repoSlideForKey("MAIN"), null);
  assert.strictEqual(hero.repoSlideForKey("custom"), null);
});

test("stock 0 and missing books are ineligible", () => {
  assert.strictEqual(hero.isPublicBookEligible({ id: 1, stock: 4, is_active: true }), true);
  assert.strictEqual(hero.isPublicBookEligible({ id: 1, stock: 0, is_active: true }), false);
  assert.strictEqual(hero.isPublicBookEligible({ id: 1, stock: 2, is_active: false }), false);
  const bookMap = { "12": { id: 12, title: "A", image_url: "/assets/store/shop-interior-main.webp", stock: 3, is_active: true } };
  const linked = hero.buildCampaignItem({
    enabled: true,
    book_id: 12,
    title: "",
    image_url: null
  }, bookMap);
  assert.ok(linked);
  assert.strictEqual(linked.defaultPrimaryHref, "/book/12");
  assert.strictEqual(linked.primary_href, "/book/12");
  assert.ok(!hero.buildCampaignItem({ enabled: true, book_id: 12, image_url: "/x.webp" }, {}));
  assert.ok(!hero.buildCampaignItem({
    enabled: true,
    book_id: 9,
    image_url: "/assets/store/shop-interior-main.webp"
  }, { "9": { id: 9, title: "Z", image_url: "/a.webp", stock: 0, is_active: true } }));
});

test("custom campaigns require title and safe image", () => {
  const ok = hero.buildCampaignItem({
    enabled: true,
    title: "باھار",
    image_url: "/assets/store/shop-interior-main.webp"
  }, {});
  assert.ok(ok);
  assert.ok(!hero.buildCampaignItem({ enabled: true, title: "باھار" }, {}));
  assert.ok(!hero.buildCampaignItem({ enabled: true, image_url: "/assets/store/shop-interior-main.webp" }, {}));
  assert.ok(!hero.buildCampaignItem({
    enabled: true,
    title: "باھار",
    image_url: "javascript:alert(1)"
  }, {}));
});

test("unsafe campaign href falls back to canonical book route", () => {
  const item = hero.buildCampaignItem({
    enabled: true,
    book_id: 4,
    primary_href: "javascript:alert(1)",
    primary_label: "ئېچىش",
    image_url: "/assets/store/shop-interior-main.webp",
    title: "كىتاب"
  }, { "4": { id: 4, title: "كىتاب", image_url: "/assets/store/shop-interior-main.webp", stock: 2, is_active: true } });
  assert.strictEqual(item.primary_href, "/book/4");
  assert.strictEqual(item.primary_label, "ئېچىش");
});

test("DB text is never assigned with innerHTML", () => {
  assert.match(js, /function restoreHardcodedHero\(/);
  assert.match(js, /textContent/);
  const assigns = [...js.matchAll(/innerHTML\s*=/g)];
  assert.ok(assigns.length >= 1);
  assigns.forEach((m) => {
    const around = js.slice(Math.max(0, m.index - 80), m.index + 40);
    assert.match(around, /snapshot\.mediaHtml/);
  });
  assert.doesNotMatch(js, /service_role/);
  assert.doesNotMatch(js, /shop\.js/);
});

test("campaign CSS is scoped and store cover geometry stays cover", () => {
  assert.match(css, /\[data-hero-kind="campaign"\]/);
  assert.match(css, /\.home-hero-campaign-title/);
  const campaign = css.slice(css.indexOf('[data-hero-kind="campaign"]'));
  assert.match(campaign, /object-fit:\s*contain/);
  assert.match(css, /\.shop-hero-frame \[data-shop-hero-slide\]\{[\s\S]*object-fit:\s*cover/);
});

test("interval settings only accept 5/7/10/15 seconds", () => {
  assert.strictEqual(hero.intervalFromSettings({ rotation_interval_seconds: 5 }), 5000);
  assert.strictEqual(hero.intervalFromSettings({ rotation_interval_seconds: 7 }), 7000);
  assert.strictEqual(hero.intervalFromSettings({ rotation_interval_seconds: 10 }), 10000);
  assert.strictEqual(hero.intervalFromSettings({ rotation_interval_seconds: 15 }), 15000);
  assert.strictEqual(hero.intervalFromSettings({ rotation_interval_seconds: 8 }), 7000);
  assert.strictEqual(hero.intervalFromSettings({}), 7000);
});

test("bookIdKey is bigint-safe and keeps exact decimal strings", () => {
  const fn = js.slice(js.indexOf("function bookIdKey"), js.indexOf("function isPublicBookEligible"));
  assert.doesNotMatch(fn, /Number\(id\)/);
  assert.doesNotMatch(fn, /parseInt\s*\(/);
  assert.doesNotMatch(fn, /(?:^|[^\w.])\+id/);
  assert.strictEqual(hero.bookIdKey(42), "42");
  assert.strictEqual(hero.bookIdKey("42"), "42");
  assert.strictEqual(hero.bookIdKey("9007199254740993"), "9007199254740993");
  assert.strictEqual(hero.bookIdKey(Number.MAX_SAFE_INTEGER), String(Number.MAX_SAFE_INTEGER));
  assert.strictEqual(hero.bookIdKey(Number.MAX_SAFE_INTEGER + 1), "");
  assert.strictEqual(hero.bookIdKey(Number("9007199254740993")), "");
  assert.strictEqual(hero.bookIdKey(0), "");
  assert.strictEqual(hero.bookIdKey("0"), "");
  assert.strictEqual(hero.bookIdKey(-4), "");
  assert.strictEqual(hero.bookIdKey("01"), "");
  assert.strictEqual(hero.bookIdKey("1e2"), "");
  assert.strictEqual(hero.bookIdKey("12.5"), "");
  assert.strictEqual(hero.bookIdKey(1.5), "");
  const linked = hero.buildCampaignItem({
    enabled: true,
    book_id: "9007199254740993",
    title: "چوڭ ID",
    image_url: "/assets/store/shop-interior-main.webp"
  }, {
    "9007199254740993": {
      id: "9007199254740993",
      title: "چوڭ ID",
      image_url: "/assets/store/shop-interior-main.webp",
      stock: 2,
      is_active: true
    }
  });
  assert.ok(linked);
  assert.strictEqual(linked.defaultPrimaryHref, "/book/9007199254740993");
});

test("restoreHardcodedMedia restores snapshot aria-label", () => {
  const fn = js.slice(js.indexOf("function restoreHardcodedMedia"), js.indexOf("function matchesHardcodedStoreSources"));
  assert.match(fn, /snapshot\.mediaHtml/);
  assert.match(fn, /snapshot\.ariaLabel/);
  assert.match(fn, /setAttribute\("aria-label"/);
});

test("exact hardcoded gallery is sources plus original fallback alt", () => {
  const exact = ["main", "library", "exterior"].map((key) => ({
    src: hero.REPO_SLIDES[key].src,
    alt: hero.REPO_SLIDES[key].alt
  }));
  assert.strictEqual(hero.isExactHardcodedStoreGallery(exact), true);
  assert.strictEqual(hero.matchesHardcodedStoreSources(exact), true);
  const customAlt = exact.map((row, i) => i === 0 ? { ...row, alt: "سىناق ئالت" } : row);
  assert.strictEqual(hero.matchesHardcodedStoreSources(customAlt), true);
  assert.strictEqual(hero.isExactHardcodedStoreGallery(customAlt), false);
});

if (failed) {
  console.error("\n" + failed + " home-hero-overlay test(s) failed");
  process.exit(1);
}
console.log("home-hero-overlay-tests ok");
