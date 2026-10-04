#!/usr/bin/env node
"use strict";
const assert = require("assert");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(root, "storefront-cover-presentation.css"), "utf8");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const body = css.replace(/\/\*[\s\S]*?\*\//g, "");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, err && err.message);
  }
}

test("cover images stay fully visible and centered", () => {
  assert.match(body, /object-fit:\s*contain\s*!important/);
  assert.match(body, /object-position:\s*center center\s*!important/);
  assert.doesNotMatch(body, /object-fit:\s*cover/);
  assert.match(body, /max-width:\s*100%\s*!important/);
  assert.match(body, /max-height:\s*100%\s*!important/);
  assert.match(body, /max-height:\s*min\(72vh,\s*560px\)\s*!important/);
});

test("frames use a cream mat, hairline, soft shadow, and modest radius", () => {
  assert.match(body, /--cover-present-mat:\s*#f4efe4/);
  assert.match(body, /border:\s*1px solid var\(--cover-present-line\)\s*!important/);
  assert.match(body, /box-shadow:\s*var\(--cover-present-shadow\)\s*!important/);
  assert.match(body, /border-radius:\s*var\(--cover-present-radius\)\s*!important/);
  assert.match(body, /--cover-present-radius:\s*8px/);
  assert.match(body, /body\.dark-mode/);
  assert.doesNotMatch(body, /@keyframes|animation:/);
});

test("homepage, listing, search, related, and detail covers are included", () => {
  for (const sel of [
    ".book-card .book-image",
    ".home-carousel-cover",
    ".advanced-search-cover",
    ".shop-mini-card .cover-stock-wrap",
    ".book-cover-box:not(.no-cover)"
  ]) {
    assert.ok(body.includes(sel), sel);
  }
});

test("shop.js loads the presentation sheet after the card polish sheet", () => {
  const start = shop.indexOf("function ensureStorefrontCards1aPolishCss(){");
  const end = shop.indexOf("function ensureStorefrontCoverPresentationCss(){");
  assert.ok(start >= 0 && end > start);
  assert.match(shop.slice(start, end), /ensureStorefrontCoverPresentationCss\(\)/);
  assert.match(shop, /storefront-cover-presentation\.css\?v=1/);
  assert.match(shop, /data-kutadgu-cover-presentation/);
});

test("no cover image files, schema, or covers.css are part of this change", () => {
  const out = execSync("git diff --name-only origin/main HEAD; git diff --name-only; git diff --cached --name-only", {
    cwd: root,
    encoding: "utf8"
  });
  const files = [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))];
  const images = files.filter((file) => /\.(png|jpe?g|webp|gif|avif)$/i.test(file));
  assert.deepStrictEqual(images, []);
  const stage100Sql = new Set([
    "STAGE100_ADMIN_DAILY_VISITORS.sql",
    "STAGE100_ADMIN_DAILY_VISITORS_ROLLBACK.sql",
    "scripts/stage100-isolated-fixture.sql",
    "scripts/stage100-isolated-load.sql",
    "scripts/stage100-isolated-assertions.sql",
    "scripts/stage100-isolated-rollback-assertions.sql",
    "scripts/stage100-isolated-reapply-assertions.sql",
    "STAGE101_ADMIN_ZERO_SEARCHES.sql",
    "STAGE101_ADMIN_ZERO_SEARCHES_ROLLBACK.sql",
    "scripts/stage101-isolated-assertions.sql",
    "scripts/stage101-isolated-rollback-assertions.sql",
    "STAGE103_BLOCK_BOOK_COVER_STORAGE_WRITES.sql",
    "STAGE104_REWRITE_BOOK_IMAGE_URLS.sql",
    "STAGE_AI_SEARCH_RPC_SERVER_ONLY.sql",
    "STAGE106_CATALOG_CREDITS.sql",
    "STAGE106_CATALOG_CREDIT_CORRECTIONS.sql",
    "STAGE106_CATALOG_CREDITS_ROLLBACK.sql",
    "STAGE107_BOOK_REVIEWS.sql",
    "STAGE107_BOOK_REVIEWS_ROLLBACK.sql"
  ]);
  const forbidden = files.filter((file) =>
    (/\.sql$/i.test(file) && !stage100Sql.has(file)) ||
    /(^|\/)supabase\//i.test(file) ||
    /(^|\/)covers\.css$/.test(file)
  );
  assert.deepStrictEqual(forbidden, []);
});

if (failed) {
  console.error("\n" + failed + " cover presentation test(s) failed");
  process.exit(1);
}
console.log("storefront-cover-presentation-tests ok");
