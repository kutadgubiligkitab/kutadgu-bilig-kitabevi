#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "stage3-shop-identity.css"), "utf8");
const js = fs.readFileSync(path.join(root, "home-hero-slideshow.js"), "utf8");
const cfg = fs.readFileSync(path.join(root, "supabase-config.js"), "utf8");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");

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

test("real shop photos exist as unmodified WebP assets", () => {
  for (const name of ["shop-interior-main.webp", "shop-interior-library.webp", "shop-exterior.webp"]) {
    const file = path.join(root, "assets/store", name);
    assert.ok(fs.existsSync(file), name);
    const buf = fs.readFileSync(file);
    assert.ok(buf.length > 100000, name);
    assert.strictEqual(buf.slice(8, 12).toString(), "WEBP");
  }
});

test("visible hero uses real photos and not the CSS bookstore scene", () => {
  assert.match(html, /data-shop-hero-slideshow="1"/);
  assert.match(html, /\/assets\/store\/shop-interior-main\.webp/);
  assert.match(html, /\/assets\/store\/shop-interior-library\.webp/);
  assert.match(html, /\/assets\/store\/shop-exterior\.webp/);
  assert.match(html, /2013-يىلدىن بۇيان/);
  assert.doesNotMatch(html, /بىلىمگە باشلايدىغان كىتابلار/);
  assert.match(html, /href="#books"/);
  assert.match(html, /href="#about"/);
  assert.doesNotMatch(html, /class="bookstore-scene"/);
  assert.doesNotMatch(html, /خوش كەلدىڭىز!/);
  assert.doesNotMatch(html, /🔎 كىتاب ئىزدەش/);
});

test("slideshow CSS is a stable cover frame with reduced-motion pause", () => {
  assert.match(css, /aspect-ratio:\s*4\s*\/\s*3/);
  assert.match(css, /object-fit:\s*cover/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(js, /prefers-reduced-motion:\s*reduce/);
  assert.match(js, /INTERVAL_MS=7000/);
  assert.doesNotMatch(js, /transform:\s*scale/);
});

test("About uses the real 2013 story and three service areas", () => {
  assert.match(html, /id="about"/);
  assert.match(html, /2013-يىلى قۇرۇلغان/);
  assert.match(html, /كىتاب ۋە ئوقۇش قوراللىرى سېتىش/);
  assert.match(html, /كىتاب ئارىيەت بېرىش/);
  assert.match(html, /كۈتۈپخانا/);
  assert.doesNotMatch(html, /دۇنيا بويىچە ئەۋەتىش/);
});

test("contact presents address hours WhatsApp and Instagram", () => {
  assert.match(html, /Kemalpaşa Mah\. 1\. Turna Sk/);
  assert.match(html, /08:30–20:00/);
  assert.match(html, /ھەپتىنىڭ 7 كۈنى تولۇق ئېچىلىدۇ/);
  assert.match(html, /@kutadgu_bilig_kitabhanisi/);
  assert.match(html, /instagram\.com\/kutadgu_bilig_kitabhanisi\/"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /wa\.me\/905368999888/);
  assert.match(cfg, /hours: "ھەپتىنىڭ 7 كۈنى تولۇق ئېچىلىدۇ\\n08:30–20:00"/);
  assert.match(cfg, /KUTADGU_WHATSAPP_NUMBER = "905368999888"/);
  const contact = shop.slice(shop.indexOf("function renderContactSection(){"), shop.indexOf("async function orderWithWhatsApp(){"));
  assert.match(contact, /contact-address/);
  assert.match(contact, /contact-hours/);
  assert.ok(contact.indexOf("دۇكان ئادرېسى") < contact.indexOf("خىزمەت ۋاقتى"));
  assert.ok(contact.indexOf("خىزمەت ۋاقتى") < contact.indexOf("contact-whatsapp"));
});

test("this stage does not change SQL Admin auth or order surfaces", () => {
  const out = execSync("git diff --name-only origin/main HEAD; git diff --name-only; git diff --cached --name-only", {
    cwd: root,
    encoding: "utf8"
  });
  const files = [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))];
  const forbidden = files.filter((file) =>
    /\.sql$/i.test(file) ||
    /(^|\/)supabase\//i.test(file) ||
    /(^|\/)admin\.(html|js|css)$/i.test(file) ||
    /listing-card-safety|detail-similar-card-safety|recently-viewed-card-safety|detail-cover-mobile-safety/.test(file)
  );
  assert.deepStrictEqual(forbidden, [], forbidden.join(", "));
});

if (failed) {
  console.error("\n" + failed + " stage3 shop identity test(s) failed");
  process.exit(1);
}
console.log("stage3-shop-identity-tests ok");
