#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const helpersSrc = fs.readFileSync(path.join(root, "tests/e2e/helpers.js"), "utf8");
const H = require(path.join(root, "tests/e2e/helpers.js"));
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

test("tiny local book-cover fixture exists and is a PNG", () => {
  assert.ok(fs.existsSync(H.BOOK_COVER_STUB_PATH));
  assert.ok(H.BOOK_COVER_STUB.length > 0);
  assert.ok(H.BOOK_COVER_STUB.length < 1024, "fixture must stay tiny");
  assert.strictEqual(H.BOOK_COVER_STUB.slice(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.match(helpersSrc, /contentType:\s*"image\/png"/);
});

test("matcher targets only public book-covers Storage paths", () => {
  assert.strictEqual(H.BOOK_COVER_STORAGE_PATH, "/storage/v1/object/public/book-covers/");
  assert.strictEqual(
    H.isSupabaseBookCoverStorageUrl("https://abcd.supabase.co/storage/v1/object/public/book-covers/book/example.webp"),
    true
  );
  assert.strictEqual(
    H.isSupabaseBookCoverStorageUrl("https://abcd.supabase.co/storage/v1/object/public/book-covers/x.png?v=1"),
    true
  );
  assert.strictEqual(
    H.isSupabaseBookCoverStorageUrl("https://abcd.supabase.co/storage/v1/object/public/other-bucket/x.webp"),
    false
  );
  assert.strictEqual(
    H.isSupabaseBookCoverStorageUrl("https://abcd.supabase.co/storage/v1/object/sign/book-covers/x.webp"),
    false
  );
  assert.strictEqual(H.isSupabaseBookCoverStorageUrl("http://127.0.0.1:4173/cover-retry-probe.png"), false);
  assert.strictEqual(H.isSupabaseBookCoverStorageUrl("/cover-retry-a.png"), false);
  assert.strictEqual(H.isSupabaseBookCoverStorageUrl("/cover-retry-b.png"), false);
  assert.strictEqual(H.isSupabaseBookCoverStorageUrl("/cover-retry-c.png"), false);
  assert.strictEqual(H.isSupabaseBookCoverStorageUrl("https://kutadgu-bilig-kitab.vercel.app/kutadgu-logo.png"), false);
});

test("installReadSafeNetwork defaults to mock mode with explicit opt-out only", () => {
  assert.match(helpersSrc, /async function installReadSafeNetwork\(page, opts = \{\}\)/);
  assert.match(helpersSrc, /allowLiveBookCovers/);
  assert.match(helpersSrc, /installBookCoverEgressGuard\(page\)/);
  assert.doesNotMatch(helpersSrc, /process\.env\.[A-Z0-9_]*LIVE.*COVER/);
  assert.match(helpersSrc, /function fulfillBookCoverStorageStub/);
  assert.match(helpersSrc, /method === "HEAD"/);
});

test("Playwright uses a shared fixture that stubs book-covers Storage", () => {
  const fixture = fs.readFileSync(path.join(root, "tests/e2e/playwright-test.js"), "utf8");
  const spec = fs.readFileSync(path.join(root, "tests/e2e/storefront.spec.js"), "utf8");
  const cover = fs.readFileSync(path.join(root, "tests/e2e/cover-load-resilience.spec.js"), "utf8");
  assert.match(fixture, /installBookCoverEgressGuard/);
  assert.match(fixture, /logMockedBookCoverSummary/);
  assert.match(spec, /require\("\.\/playwright-test"\)/);
  assert.match(cover, /require\("\.\/playwright-test"\)/);
  assert.doesNotMatch(cover, /allowLiveBookCovers:\s*true/);
});

test("storefront shop.js is not part of this CI intercept", () => {
  const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
  assert.doesNotMatch(shop, /BOOK_COVER_STUB/);
  assert.doesNotMatch(shop, /ci-book-cover-stub/);
  assert.doesNotMatch(shop, /mockedBookCoverRequests/);
});

if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
}
console.log("ci-supabase-egress-protection-tests ok");
