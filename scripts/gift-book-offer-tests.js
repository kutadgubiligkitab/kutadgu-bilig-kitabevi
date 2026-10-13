#!/usr/bin/env node
"use strict";
const assert = require("assert");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const admin = fs.readFileSync(path.join(root, "admin.js"), "utf8");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const migration = fs.readFileSync(path.join(root, "STAGE122_GIFT_BOOK_OFFERS.sql"), "utf8");
const rollback = fs.readFileSync(path.join(root, "STAGE122_GIFT_BOOK_OFFERS_ROLLBACK.sql"), "utf8");
const Stock = require("../kutadgu-stock.js");
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, err && err.stack || err.message);
  }
}

function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, startNeedle + " .. " + endNeedle);
  return src.slice(start, end);
}

function gitDiff(rel) {
  return execSync("git diff -- origin/main -- " + rel, { cwd: root, encoding: "utf8" });
}

const decide = new Function(`
  ${sliceBetween(shop, "function giftViewerDecision(state){", "function giftViewerState(){")}
  return giftViewerDecision;
`)();
const message = new Function(`
  function absoluteUrl(value){return "https://www.kutadgubilik.com" + (String(value||"").startsWith("/")?value:"/"+value)}
  function bookDetailHref(id){return "/book/" + id}
  ${sliceBetween(shop, "function giftRequestMessage(book){", "function giftDisplayBook(book){")}
  return giftRequestMessage;
`)();
const requestable = new Function("stockInfo", `
  ${sliceBetween(shop, "function giftBookRequestable(book){", "function giftRequestMessage(book){")}
  return giftBookRequestable;
`)((book) => Stock.storefrontStockInfo(book, { stockEnforcement: true }));

function memberState(overrides) {
  return Object.assign({
    eventSeen: true,
    authError: false,
    sessionBootDone: true,
    configured: true,
    user: { id: "member-1" },
    profile: { status: "active" },
    blocked: false,
    holdsAccount: true,
    bootstrapPending: false,
    persistedUserId: ""
  }, overrides || {});
}

test("gift viewer keeps guest, member, blocked, and unresolved apart", () => {
  assert.strictEqual(decide(memberState()), "member");
  assert.strictEqual(decide(memberState({
    user: null, profile: null, holdsAccount: false
  })), "guest");
  assert.strictEqual(decide(memberState({ blocked: true })), "blocked");
  assert.strictEqual(decide(memberState({ profile: { status: "suspended" } })), "blocked");
  assert.strictEqual(decide(memberState({ eventSeen: false })), "unresolved");
  assert.strictEqual(decide(memberState({ authError: true })), "unresolved");
  assert.strictEqual(decide(memberState({ sessionBootDone: false })), "unresolved");
  assert.strictEqual(decide(memberState({ bootstrapPending: true })), "unresolved");
  assert.strictEqual(decide(memberState({ profile: null })), "unresolved");
  assert.strictEqual(decide(memberState({
    configured: false, user: null, profile: null, holdsAccount: false
  })), "guest");
  assert.strictEqual(decide(memberState({
    configured: false, user: { id: "x" }
  })), "unresolved");
});

test("gift request text names the book and its public link", () => {
  const text = message({ id: 252, title: "قۇتادغۇ بىلىك" });
  assert.match(text, /ھەقسىز قەغەز سوۋغا سوراش/);
  assert.match(text, /كىتاب: قۇتادغۇ بىلىك/);
  assert.match(text, /https:\/\/www\.kutadgubilik\.com\/book\/252/);
  assert.match(text, /بۇ پۇل تۆلىنىدىغان زاكاز ئەمەس/);
  assert.doesNotMatch(text, /₺|جەمئىي|يەتكۈزۈش|ھەقسىز يەتكۈزۈش|دانە/);
});

test("requestable gifts follow active, approved, and stock rules", () => {
  const base = { is_active: true, submission_status: "approved", stock: 2, stock_status: "in_stock" };
  assert.strictEqual(requestable(base), true);
  assert.strictEqual(requestable(Object.assign({}, base, { stock: null, stock_status: "" })), true);
  assert.strictEqual(requestable(Object.assign({}, base, { stock: 0 })), false);
  assert.strictEqual(requestable(Object.assign({}, base, { stock: 4, stock_status: "out_of_stock" })), false);
  assert.strictEqual(requestable(Object.assign({}, base, { stock: 4, stock_status: "تۈگەپ كەتتى" })), false);
  assert.strictEqual(requestable(Object.assign({}, base, { is_active: false })), false);
  assert.strictEqual(requestable(Object.assign({}, base, { submission_status: "pending" })), false);
});

test("homepage tab and shop read path stay on the member client", () => {
  assert.match(index, /data-carousel-mode="gifts"/);
  assert.match(index, /ھەدىيەلىك كىتابلار/);
  assert.match(index, /data-carousel-mode="recommended"[^>]*aria-selected="true"/);
  assert.match(index, /shop\.js\?v=160/);
  const clientFn = sliceBetween(shop, "function giftMemberClient(){", "let giftEpoch");
  assert.match(clientFn, /getClient/);
  const loader = sliceBetween(shop, "async function loadGiftOffers(epoch){", "async function verifyGiftOffer");
  assert.match(loader, /giftMemberClient/);
  assert.match(loader, /gift_book_offers/);
  assert.doesNotMatch(loader, /remoteBooksUrl|localStorage|sessionStorage/);
  const verify = sliceBetween(shop, "async function verifyGiftOffer(bookId,epoch){", "async function setupHomeCarousel");
  assert.match(verify, /giftMemberClient/);
  assert.doesNotMatch(verify, /remoteBooksUrl|getOrBuildOrder|function add\(/);
  const request = sliceBetween(shop, "async function requestGiftFromButton(button){", "const isDual");
  assert.match(request, /whatsappOrderUrl\(giftRequestMessage/);
  assert.doesNotMatch(request, /getOrBuildOrder|savePreparedOrderHistory|\badd\(/);
  assert.match(shop, /function orderWithWhatsApp\(\)\{\s*let o=getOrBuildOrder\(true\);if\(!o\)return;/);
  assert.strictEqual(gitDiff("member.js"), "");
  assert.strictEqual(gitDiff("premium-ux.js"), "");
  assert.strictEqual(gitDiff("kutadgu-public-book.js"), "");
});

test("admin gift writes stay outside the book payload", () => {
  assert.match(adminHtml, /id="bookIsGift"/);
  assert.match(adminHtml, /<input id="bookIsGift" type="checkbox"><span>🎁 ھەدىيەلىك كىتاب<\/span>/);
  assert.doesNotMatch(adminHtml, /id="bookIsGift"[\s\S]{0,80}ھەقسىز قەغەز سوۋغا/);
  assert.match(adminHtml, /admin\.js\?v=111/);
  const planLog = sliceBetween(admin, "function logSavePlan(plan){", "function planCurrentSave");
  assert.match(planLog, /console\.info\("\[kutadgu-admin-save\]",safe\)/);
  assert.match(planLog, /diag\.hidden=true/);
  assert.match(planLog, /diag\.textContent=""/);
  assert.doesNotMatch(planLog, /diag\.hidden=false/);
  assert.doesNotMatch(planLog, /mode=\$\{safe\.mode\}/);
  const row = sliceBetween(admin, "const row={", "if(coverHash&&coverVisualHash");
  assert.match(row, /is_recommended/);
  assert.doesNotMatch(row, /gift|bookIsGift/);
  const pending = sliceBetween(admin, "if(pendingSave){", "let payload=writeBookRow");
  assert.doesNotMatch(pending, /persistGiftOfferAfterBookSave|gift_book_offers/);
  const offer = sliceBetween(admin, "async function persistGiftOfferAfterBookSave", "function applyGiftOfferWriteResult");
  assert.match(offer, /status==="failed"|status!=="ready"/);
  assert.match(offer, /GIFT_PARTIAL/);
  assert.match(admin, /admin\.aal!=="aal2"/);
  assert.match(admin, /seq!==giftOfferSeq/);
});

test("stage 122 migration is a separate offer table and does not rewrite books policies", () => {
  assert.match(migration, /create table if not exists public\.gift_book_offers/);
  assert.match(migration, /book_id bigint primary key references public\.books \(id\) on delete cascade/);
  assert.match(migration, /enabled boolean not null default false/);
  assert.match(migration, /updated_at timestamptz not null default now\(\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /revoke all on table public\.gift_book_offers from public, anon, authenticated, service_role/);
  assert.match(migration, /grant select, insert, update, delete on table public\.gift_book_offers to authenticated/);
  assert.doesNotMatch(migration, /grant [^;]* to anon|to service_role;/i);
  assert.match(migration, /security invoker/);
  assert.match(migration, /set search_path = pg_catalog, public/);
  assert.match(migration, /submission_status = 'approved'/);
  assert.match(migration, /members read eligible gift offers/);
  assert.match(migration, /admins read gift offers/);
  assert.match(migration, /as restrictive/);
  assert.doesNotMatch(migration, /drop policy[^;]*on public\.books|alter table public\.books/i);
  assert.match(rollback, /drop table if exists public\.gift_book_offers/);
  assert.match(rollback, /drop function if exists public\.gift_book_is_requestable\(bigint\)/);
  assert.ok(rollback.indexOf("drop table if exists public.gift_book_offers") < rollback.indexOf("drop function if exists public.gift_book_is_requestable(bigint)"));
  assert.doesNotMatch(rollback, /drop table if exists public\.books|drop policy[^;]*books/i);
});

if (failed) {
  console.error("\n" + failed + " gift book offer test(s) failed");
  process.exit(1);
}
console.log("gift-book-offer-tests ok");
