#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const account = fs.readFileSync(path.join(root, "account.js"), "utf8");
const member = fs.readFileSync(path.join(root, "member.js"), "utf8");

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

function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0 && end > start, startNeedle);
  return src.slice(start, end);
}

function searchApi() {
  const src = sliceBetween(shop, "function searchDigitShape(search){", "function remoteBooksUrl(input={},flags={}){");
  return new Function(
    "function bibliographicLib(){\n" +
    "  return { normalizeIsbnDigits(value){\n" +
    "    return String(value??\"\").trim().replace(/[\\s-]+/g,\"\").replace(/[^0-9Xx]/g,\"\").toUpperCase();\n" +
    "  } };\n" +
    "}\n" +
    src +
    "\nreturn { searchDigitShape, storefrontSearchMatchParts };"
  )();
}

function loginMessage(err) {
  const src = sliceBetween(account, "function customerLoginErrorMessage(err){", "function clearStatus");
  return new Function(`${src} return customerLoginErrorMessage;`)()(err);
}

const COLS = ["title", "author", "category", "translator", "publisher", "isbn"];
const api = searchApi();

test("zzzznotabook does not add an ISBN fragment match", () => {
  const parts = api.storefrontSearchMatchParts(COLS, "*zzzznotabook*", "zzzznotabook");
  assert.ok(parts.includes("title.ilike.*zzzznotabook*"));
  assert.ok(parts.includes("author.ilike.*zzzznotabook*"));
  assert.ok(parts.every((part) => part.includes("zzzznotabook")));
  assert.ok(!parts.some((part) => /isbn\.eq\./.test(part)));
});

test("zzzznotabook999 does not match ISBN only because it contains 999", () => {
  const parts = api.storefrontSearchMatchParts(COLS, "*zzzznotabook999*", "zzzznotabook999");
  assert.ok(parts.includes("title.ilike.*zzzznotabook999*"));
  assert.ok(parts.includes("author.ilike.*zzzznotabook999*"));
  assert.ok(!parts.some((part) => part === "isbn.ilike.*999*" || part === "isbn.eq.999"));
  assert.ok(parts.every((part) => part.includes("zzzznotabook999")));
});

test("short digit query does not search ISBN", () => {
  const parts = api.storefrontSearchMatchParts(COLS, "*2*", "2");
  assert.ok(parts.includes("title.ilike.*2*"));
  assert.ok(parts.includes("author.ilike.*2*"));
  assert.ok(!parts.some((part) => part.startsWith("isbn.")));
  assert.strictEqual(api.searchDigitShape("999").shortDigit, true);
  assert.strictEqual(api.searchDigitShape("999").isbnLike, false);
});

test("a real ISBN and a hyphenated ISBN still search ISBN", () => {
  const plain = api.storefrontSearchMatchParts(COLS, "*9787228109999*", "9787228109999");
  assert.ok(plain.includes("title.ilike.*9787228109999*"));
  assert.ok(plain.includes("isbn.ilike.*9787228109999*"));
  assert.ok(plain.includes("isbn.eq.9787228109999"));
  const hyphen = api.storefrontSearchMatchParts(COLS, "*978-7-228-10999-9*", "978-7-228-10999-9");
  assert.ok(hyphen.includes("title.ilike.*978-7-228-10999-9*"));
  assert.ok(hyphen.includes("isbn.eq.9787228109999"));
  assert.ok(hyphen.includes("isbn.ilike.*9787228109999*"));
  const isbn10 = api.storefrontSearchMatchParts(COLS, "*0-306-40615-X*", "0-306-40615-X");
  assert.ok(isbn10.includes("isbn.eq.030640615X"));
});

test("title and author searches stay full-query matches", () => {
  const title = api.storefrontSearchMatchParts(COLS, "*ئەلپىدا*", "ئەلپىدا");
  assert.ok(title.includes("title.ilike.*ئەلپىدا*"));
  assert.ok(title.includes("author.ilike.*ئەلپىدا*"));
  assert.ok(!title.some((part) => part.startsWith("isbn.eq.")));
  const author = api.storefrontSearchMatchParts(COLS, "*تۇرسۇن*قادىر*", "تۇرسۇن قادىر");
  assert.ok(author.includes("author.ilike.*تۇرسۇن*قادىر*"));
  assert.ok(author.includes("title.ilike.*تۇرسۇن*قادىر*"));
  assert.ok(!author.some((part) => /isbn\.ilike\.\*\d+\*/.test(part)));
});

test("shop no longer ORs an extracted digit fragment into ISBN", () => {
  const remote = sliceBetween(shop, "function remoteBooksUrl(input={},flags={}){", "function totalFromContentRange");
  assert.match(remote, /Rank\.postgrestPattern\?Rank\.postgrestPattern\(state\.search\)/);
  assert.match(remote, /storefrontSearchMatchParts\(cols,term,state\.search\)/);
  assert.doesNotMatch(remote, /isbn\.ilike\.\*\$\{digits\}\*/);
  assert.doesNotMatch(shop, /digits!==state\.search/);
});

test("member.css is rooted so /book/:id does not request /book/member.css", () => {
  assert.match(member, /link\.href="\/member\.css\?v=2"/);
  assert.doesNotMatch(member, /link\.href="member\.css\?v=2"/);
});

test("invalid login credentials become a Uyghur message and unknown errors stay visible", () => {
  assert.strictEqual(
    loginMessage({ message: "Invalid login credentials" }),
    "ئېلخەت ياكى پارول توغرا ئەمەس. قايتا تەكشۈرۈپ كىرىڭ."
  );
  assert.strictEqual(loginMessage(new Error("invalid_grant")), "ئېلخەت ياكى پارول توغرا ئەمەس. قايتا تەكشۈرۈپ كىرىڭ.");
  assert.strictEqual(loginMessage({ message: "Email rate limit exceeded" }), "كىرىش مەغلۇپ بولدى: Email rate limit exceeded");
  assert.match(account, /customerLoginErrorMessage\(err\)/);
  assert.doesNotMatch(account, /كىرىش مەغلۇپ بولدى: "\+\(err\.message\|\|err\)/);
});

test("idle empty category copy is distinct from an active filter miss", () => {
  assert.match(shop, /const emptySectionMarkup='<strong>بۇ بۆلۈمدە ھازىرچە كىتاب يوق\.<\/strong>/);
  assert.match(shop, /const emptyFilterMarkup='<strong>نەتىجە تېپىلمىدى\.<\/strong>/);
  assert.match(shop, /empty\.innerHTML=listingFiltersIdle\(\)\?emptySectionMarkup:emptyFilterMarkup/);
  assert.match(shop, /emptySectionMarkup[\s\S]*باشقا كىتابلارنى كۆرۈش/);
  assert.match(shop, /emptyFilterMarkup[\s\S]*سۈزگۈچنى تازىلاڭ[\s\S]*باشقا كىتابلارنى كۆرۈش/);
});

if (failed) {
  console.error("\n" + failed + " qa customer-facing fix test(s) failed");
  process.exit(1);
}
console.log("qa-customer-facing-fixes-tests ok");
