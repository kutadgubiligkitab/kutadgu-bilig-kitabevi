#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const member = fs.readFileSync(path.join(root, "member.js"), "utf8");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const mobile = fs.readFileSync(path.join(root, "mobile.js"), "utf8");
const header = fs.readFileSync(path.join(root, "public-header.js"), "utf8");
const accountHtml = fs.readFileSync(path.join(root, "account.html"), "utf8");

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

function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
  return src.slice(start, end);
}

function ownerApi({
  owner = "",
  sessionUser = "",
  liveUser = "",
  expiresAt = "future",
  accessToken = "tok",
  extraStore = {},
  configUrl = "https://fxlojnqwyojqjskfggmh.supabase.co",
  sessionBootDone = false,
  authKey = "sb-fxlojnqwyojqjskfggmh-auth-token"
} = {}) {
  const store = { ...extraStore };
  if (owner) store["kutadgu-shop-owner-v1"] = owner;
  if (sessionUser) {
    let exp = expiresAt;
    if (exp === "future") exp = Math.floor(Date.now() / 1000) + 3600;
    const session = { user: { id: sessionUser } };
    if (accessToken !== null) session.access_token = accessToken;
    session.refresh_token = "refresh-only-is-not-enough";
    if (exp !== "missing") session.expires_at = exp;
    store[authKey] = JSON.stringify(session);
  }
  const keys = Object.keys(store);
  const localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    key(i) { return keys[i] || null; },
    get length() { return keys.length; }
  };
  const src = sliceBetween(member, "function peekPersistedShopUserId(){", "function cartCountQty(items){");
  const live = liveUser ? JSON.stringify({ id: liveUser }) : "null";
  return new Function("localStorage", "window", `
    const SHOP_OWNER_GUEST="guest";
    const SHOP_OWNER_STALE="stale";
    let sessionBootDone=${sessionBootDone ? "true" : "false"};
    let user=${live};
    function readShopOwner(){ try{return String(localStorage.getItem("kutadgu-shop-owner-v1")||"").trim()}catch(e){return ""} }
    ${src}
    return { peekPersistedShopUserId, currentShopUserId, shopOwnerAllowsLocalDisplay, identityBootstrapPending };
  `)(localStorage, { KUTADGU_SUPABASE_CONFIG: configUrl == null ? {} : { url: configUrl } });
}

function badgeApi({ owner, cart, sessionUser, liveUser, sessionBootDone, expiresAt }) {
  const store = {
    "kutadgu-shop-owner-v1": owner,
    "kutadgu-cart-v1": JSON.stringify(cart)
  };
  if (sessionUser) {
    store["sb-fxlojnqwyojqjskfggmh-auth-token"] = JSON.stringify({
      access_token: "tok",
      refresh_token: "refresh",
      expires_at: expiresAt == null ? Math.floor(Date.now() / 1000) + 3600 : expiresAt,
      user: { id: sessionUser }
    });
  }
  const node = {
    textContent: "x",
    hidden: false,
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; }
  };
  const document = { querySelectorAll() { return [node]; } };
  const localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; }
  };
  const src = sliceBetween(member, "function peekPersistedShopUserId(){", "function shouldMergeLocalForUser(userId){");
  const live = liveUser ? JSON.stringify({ id: liveUser }) : "null";
  return new Function("localStorage", "window", "document", `
    const CART_KEY="kutadgu-cart-v1";
    const SHOP_OWNER_GUEST="guest";
    const SHOP_OWNER_STALE="stale";
    let sessionBootDone=${sessionBootDone ? "true" : "false"};
    let user=${live};
    function readShopOwner(){ try{return String(localStorage.getItem("kutadgu-shop-owner-v1")||"").trim()}catch(e){return ""} }
    ${src}
    refreshSafeCartCount();
    return document.querySelectorAll()[0];
  `)(localStorage, { KUTADGU_SUPABASE_CONFIG: { url: "https://fxlojnqwyojqjskfggmh.supabase.co" } }, document);
}

test("account.html does not load shop.js and member owns the safe badge", () => {
  assert.doesNotMatch(accountHtml, /shop\.js/);
  assert.match(accountHtml, /public-header\.js/);
  assert.match(accountHtml, /member\.js\?v=25/);
  assert.match(member, /function shopOwnerAllowsLocalDisplay\(owner,uid\)\{/);
  assert.match(member, /function identityBootstrapPending\(\)\{/);
  assert.match(member, /function refreshSafeCartCount\(\)\{/);
  assert.match(member, /if\(identityBootstrapPending\(\)\)\{/);
  assert.match(member, /if\(!shopOwnerAllowsLocalDisplay\(\)\)\{/);
  assert.match(header, /refreshSafeCartCount/);
  assert.match(header, /data-kutadgu-count-state", "pending"/);
  assert.doesNotMatch(mobile, /JSON\.parse\(localStorage\.getItem\("kutadgu-cart-v1"/);
  assert.match(mobile, /refreshSafeCartCount/);
  assert.match(shop, /updateBadge,add,/);
  assert.match(shop, /data-kutadgu-count-state","ready"/);
});

test("member shopOwnerAllowsLocalDisplay matches storefront guest/stale/uuid rules", () => {
  const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  assert.strictEqual(ownerApi({ owner: "guest" }).shopOwnerAllowsLocalDisplay(), true);
  assert.strictEqual(ownerApi({ owner: "" }).shopOwnerAllowsLocalDisplay(), true);
  assert.strictEqual(ownerApi({ owner: "stale", sessionUser: a }).shopOwnerAllowsLocalDisplay(), false);
  assert.strictEqual(ownerApi({ owner: a }).shopOwnerAllowsLocalDisplay(), false);
  assert.strictEqual(ownerApi({ owner: a, sessionUser: b }).shopOwnerAllowsLocalDisplay(), false);
  assert.strictEqual(ownerApi({ owner: a, sessionUser: a }).shopOwnerAllowsLocalDisplay(), true);
  assert.strictEqual(ownerApi({ owner: a, liveUser: a }).shopOwnerAllowsLocalDisplay(), true);
});

test("UUID owner stays pending until identity resolves and does not paint private qty", () => {
  const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const pending = ownerApi({ owner: a, sessionBootDone: false });
  assert.strictEqual(pending.identityBootstrapPending(), true);
  assert.strictEqual(pending.shopOwnerAllowsLocalDisplay(), false);
  const node = badgeApi({
    owner: a,
    cart: [{ id: "102", qty: 7 }],
    sessionBootDone: false
  });
  assert.strictEqual(node.textContent, "");
  assert.strictEqual(node.attrs["data-kutadgu-count-state"], "hidden");
});

test("guest-owned cart paints total qty on the account header path", () => {
  const node = badgeApi({
    owner: "guest",
    cart: [{ id: "102", qty: 2 }, { id: "103", qty: 3 }],
    sessionBootDone: false
  });
  assert.strictEqual(node.textContent, "5");
  assert.strictEqual(node.attrs["data-kutadgu-count-state"], "ready");
});

test("foreign or stale owner does not expose stored quantity", () => {
  const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const foreign = badgeApi({
    owner: a,
    sessionUser: b,
    cart: [{ id: "102", qty: 9 }],
    sessionBootDone: true
  });
  assert.strictEqual(foreign.textContent, "0");
  assert.notStrictEqual(foreign.textContent, "9");
  const stale = badgeApi({
    owner: "stale",
    liveUser: a,
    cart: [{ id: "102", qty: 9 }],
    sessionBootDone: true
  });
  assert.strictEqual(stale.textContent, "0");
});

test("matching signed-in owner paints qty after identity is known", () => {
  const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const node = badgeApi({
    owner: a,
    liveUser: a,
    cart: [{ id: "102", qty: 4 }],
    sessionBootDone: true
  });
  assert.strictEqual(node.textContent, "4");
});

test("sign-out / stale transition clears the previous member count", () => {
  const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const after = badgeApi({
    owner: "stale",
    cart: [],
    sessionBootDone: true
  });
  assert.strictEqual(after.textContent, "0");
  const abandoned = sliceBetween(member, "function abandonMemberShopSync(){", "async function mergeShopState(){");
  assert.match(member, /refreshSafeCartCount\(\);/);
  assert.match(abandoned, /writeShopOwner\(SHOP_OWNER_STALE\)/);
});

if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
}
console.log("account-header-cart-count-tests ok");
