#!/usr/bin/env node
"use strict";
const assert = require("assert");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Legacy = require("../legacy-id-utils.js");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const accountJs = fs.readFileSync(path.join(root, "account.js"), "utf8");
const accountHtml = fs.readFileSync(path.join(root, "account.html"), "utf8");
const cartHtml = fs.readFileSync(path.join(root, "cart.html"), "utf8");
const member = fs.readFileSync(path.join(root, "member.js"), "utf8");
const HEADLINE = "سېۋەتتىكى كىتابلارنى ھېسابىڭىزدا ساقلاڭ";
const CTA = "ئەزا بولۇش";
let failed = 0;
const pending = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      pending.push(result.then(() => console.log("PASS", name)).catch((err) => {
        failed++;
        console.error("FAIL", name, err && err.stack || err.message);
      }));
      return;
    }
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, err && err.stack || err.message);
  }
}

function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
  return src.slice(start, end);
}

function gitDiff(rel) {
  return execSync(`git diff -- origin/main -- ${rel}`, { cwd: root, encoding: "utf8" });
}

const decide = new Function(`
  const SHOP_OWNER_GUEST = "guest";
  ${sliceBetween(shop, "function guestCartInviteDecision(state){", "let memberIdentity=")}
  return guestCartInviteDecision;
`)();

function guestState(overrides) {
  return Object.assign({
    eventSeen: true,
    authError: false,
    sessionBootDone: true,
    configured: true,
    user: null,
    profile: null,
    blocked: false,
    holdsAccount: false,
    bootstrapPending: false,
    persistedUserId: "",
    owner: "guest",
    cartLength: 1
  }, overrides || {});
}

test("cart.html keeps one hidden guest invitation outside checkout", () => {
  assert.strictEqual((cartHtml.match(/id="guestCartInvite"/g) || []).length, 1);
  assert.strictEqual((cartHtml.match(/checkout-member-note/g) || []).length, 1);
  assert.match(cartHtml, /shop\.js\?v=159/);
  assert.match(cartHtml, /shop\.css\?v=55/);
  assert.doesNotMatch(cartHtml, /shop\.js\?v=154/);
  const aside = sliceBetween(cartHtml, 'id="cartAside"', 'id="checkoutCard"');
  assert.match(aside, /id="guestCartInvite"[^>]*hidden/);
  assert.match(aside, new RegExp(HEADLINE));
  assert.match(aside, new RegExp(`href="account\\.html#signup"[^>]*>${CTA}<`));
  const card = sliceBetween(cartHtml, 'id="checkoutCard"', "</section>");
  assert.doesNotMatch(card, /guestCartInvite|checkout-member-note/);
  assert.match(cartHtml, /#guestCartInvite a\{[^}]*min-height:44px/);
  assert.match(cartHtml, /#guestCartInvite\{[^}]*direction:rtl/);
  assert.match(accountHtml, /account\.js\?v=8/);
  assert.match(accountHtml, /member\.js\?v=31/);
  assert.match(shop, /\/member\.js\?v=31/);
  assert.strictEqual(gitDiff("member.js"), "");
  assert.strictEqual(gitDiff("shop.css"), "");
});

test("invitation decision requires a confirmed signed-out guest cart", () => {
  assert.strictEqual(decide(guestState()), true);
  assert.strictEqual(decide(guestState({ cartLength: 2 })), true);
  [
    { eventSeen: false },
    { authError: true },
    { sessionBootDone: false },
    { configured: false },
    { user: { id: "user-a" } },
    { profile: { status: "active" } },
    { profile: null, user: { id: "user-a" } },
    { blocked: true },
    { holdsAccount: true },
    { bootstrapPending: true },
    { persistedUserId: "user-a" },
    { owner: "" },
    { owner: "stale" },
    { owner: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    { cartLength: 0 },
    { cartLength: -1 }
  ].forEach((overrides) => {
    assert.strictEqual(decide(guestState(overrides)), false, JSON.stringify(overrides));
  });
  assert.strictEqual(decide(null), false);
  const stateFn = sliceBetween(shop, "function guestCartInviteState(){", "function syncGuestCartInvite(){");
  assert.match(stateFn, /sessionBootDone/);
  assert.match(stateFn, /configured/);
  assert.match(stateFn, /getUser/);
  assert.match(stateFn, /getProfile/);
  assert.match(stateFn, /isBlocked/);
  assert.match(stateFn, /peekPersistedShopUserId/);
  assert.match(stateFn, /identityBootstrapPending/);
  assert.match(stateFn, /readShopOwner/);
  assert.match(stateFn, /cart\(\)\.length/);
  assert.doesNotMatch(stateFn, /createClient|my_cart_share_permission|setInterval/);
  const note = sliceBetween(shop, "function noteMemberIdentity(event){", "function cartPage(){");
  assert.match(note, /if\(detail\.error\)memberIdentity\.authError=true/);
  assert.doesNotMatch(note, /authError=false/);
  const cartPage = sliceBetween(shop, "function cartPage(){", "function changeQty(id,d){");
  assert.strictEqual((cartPage.match(/syncGuestCartInvite\(\)/g) || []).length, 3);
  assert.match(cartPage, /checkout\.hidden=blocked\|\|preview/);
  const add = sliceBetween(shop, "function add(id,qty=1){", "function remove(id){");
  assert.match(add, /if\(document\.querySelector\("#cartItems"\)\)cartPage\(\)/);
});

class El {
  constructor(tag, attrs = {}) {
    this.tagName = String(tag || "div").toUpperCase();
    this.id = attrs.id || "";
    this.hidden = !!attrs.hidden;
    this.textContent = attrs.textContent || "";
    this.value = attrs.value || "";
    this.className = "";
    this.dataset = Object.assign({}, attrs.dataset);
    this.disabled = false;
    this.type = attrs.type || "";
    this.onclick = null;
    this._listeners = {};
    this.classList = { toggle() {}, add() {}, remove() {}, contains() { return false; } };
  }
  setAttribute() {}
  querySelector(sel) {
    if (sel === 'button[type="submit"]') return this.submitBtn || (this.submitBtn = new El("button", { type: "submit", textContent: "submit" }));
    if (sel === "span") return this.span || (this.span = new El("span", { textContent: "Google" }));
    return null;
  }
  focus() {}
  async dispatch(type, extra) {
    const event = Object.assign({ currentTarget: this, preventDefault() {}, target: this }, extra || {});
    if (type === "click" && this.onclick) await this.onclick(event);
    for (const fn of this._listeners[type] || []) await fn(event);
  }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
}

function bootAccount(opts = {}) {
  const ids = ["accountLoading", "accountSetup", "authPanel", "memberPanel", "authTitle", "authSubtitle", "authStatus", "loginForm", "signupForm", "loginEmail", "loginPassword", "signupName", "signupEmail", "signupPassword", "signupConfirm", "googleSignIn", "forgotPassword", "memberLogout", "bookStaffEntry", "memberWelcome", "memberEmail", "memberCreated", "memberLastSeen", "memberVisits", "memberOrders", "profileStatus", "profileForm", "profileName", "profilePhone", "profileCountry", "profileCity", "profileAddress", "orderList"];
  const byId = {};
  ids.forEach((id) => {
    byId[id] = new El("div", { id, hidden: ["accountSetup", "authPanel", "memberPanel", "signupForm", "bookStaffEntry"].includes(id) });
  });
  const tabs = [
    new El("button", { dataset: { authTab: "login" } }),
    new El("button", { dataset: { authTab: "signup" } })
  ];
  const docListeners = {};
  const document = {
    readyState: "loading",
    querySelector(sel) { const m = /^#(.+)$/.exec(sel); return m ? byId[m[1]] || null : null; },
    querySelectorAll(sel) {
      if (sel === "[data-auth-tab]") return tabs;
      if (sel === "[data-password-toggle]") return [];
      return [];
    },
    getElementById(id) { return byId[id] || null; },
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
    dispatchEvent(event) {
      for (const fn of docListeners[event.type] || []) fn(event);
      return true;
    }
  };
  let user = opts.user || null;
  let profile = opts.profile || null;
  const memberApi = {
    ready: Promise.resolve(),
    configured: () => opts.configured !== false,
    getUser: () => user,
    getProfile: () => profile,
    isBlocked: () => !!opts.blocked,
    applyFieldDirections() {},
    getClient() { return { rpc() { return Promise.resolve({ data: false, error: null }); } }; },
    async getOrders() { return []; },
    async signIn() { user = { id: "user-b", email: "b@example.com" }; profile = { full_name: "باتۇر" }; },
    async signUp() {
      if (opts.signup === "fail") throw new Error("rejected");
      if (opts.signup === "confirm") return { session: null };
      user = { id: "user-new", email: "new@example.com" };
      profile = { full_name: "يېڭى" };
      return { session: { user } };
    },
    async signOut() { user = null; profile = null; },
    async resetPassword() {},
    async signInWithGoogle() {},
    async updateProfile() {}
  };
  const sandbox = {
    window: { KutadguMember: memberApi, document },
    document,
    location: { hash: opts.hash || "" },
    console, Date, Number, String, Array, Object, JSON, Math, parseInt, Boolean, Error, Promise, setTimeout, setImmediate, Intl
  };
  sandbox.window.window = sandbox.window;
  vm.runInNewContext(accountJs, sandbox);
  for (const fn of docListeners.DOMContentLoaded || []) fn();
  return { byId, tabs, document, docListeners };
}

test("account.html#signup opens signup once and ordinary entry stays on login", async () => {
  const signup = bootAccount({ hash: "#signup" });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(signup.byId.signupForm.hidden, false);
  assert.strictEqual(signup.byId.loginForm.hidden, true);
  signup.document.dispatchEvent({ type: "kutadgu-member-change" });
  assert.strictEqual(signup.byId.signupForm.hidden, false);
  await signup.tabs[0].dispatch("click");
  assert.strictEqual(signup.byId.loginForm.hidden, false);
  signup.document.dispatchEvent({ type: "kutadgu-member-change" });
  assert.strictEqual(signup.byId.loginForm.hidden, false);
  assert.strictEqual(signup.byId.signupForm.hidden, true);

  const login = bootAccount({ hash: "" });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(login.byId.loginForm.hidden, false);
  assert.strictEqual(login.byId.signupForm.hidden, true);
  await login.tabs[1].dispatch("click");
  assert.strictEqual(login.byId.signupForm.hidden, false);
  await login.tabs[0].dispatch("click");
  assert.strictEqual(login.byId.loginForm.hidden, false);

  for (const hash of ["#Signup", "#signup?next=cart", "#login"]) {
    const other = bootAccount({ hash });
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(other.byId.loginForm.hidden, false, hash);
    assert.strictEqual(other.byId.signupForm.hidden, true, hash);
  }
});

test("email confirmation switches to login without claiming the cart is saved", async () => {
  const confirm = bootAccount({ hash: "#signup", signup: "confirm" });
  await new Promise((r) => setImmediate(r));
  confirm.byId.signupPassword.value = "password1";
  confirm.byId.signupConfirm.value = "password1";
  confirm.byId.signupEmail.value = "guest@example.com";
  await confirm.byId.signupForm.dispatch("submit");
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(confirm.byId.loginForm.hidden, false);
  assert.strictEqual(confirm.byId.signupForm.hidden, true);
  assert.match(confirm.byId.authStatus.textContent, /جەزملەشتۈرۈش ئۇلانمىسى/);
  assert.doesNotMatch(confirm.byId.authStatus.textContent, /سېۋەت/);
  confirm.document.dispatchEvent({ type: "kutadgu-member-change" });
  assert.strictEqual(confirm.byId.loginForm.hidden, false);
  assert.strictEqual(confirm.byId.signupForm.hidden, true);

  const failed = bootAccount({ hash: "#signup", signup: "fail" });
  await new Promise((r) => setImmediate(r));
  failed.byId.signupPassword.value = "password1";
  failed.byId.signupConfirm.value = "password1";
  await failed.byId.signupForm.dispatch("submit");
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(failed.byId.signupForm.hidden, false);
  assert.match(failed.byId.authStatus.textContent, /مەغلۇپ/);
});

function memoryStorage(initial) {
  const data = Object.assign({}, initial || {});
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; }
  };
}

function ownerApi(storage) {
  const src = sliceBetween(member, "function readShopOwner(){", "function writeShopOwner(owner){")
    + sliceBetween(member, "function shouldMergeLocalForUser(userId){", "function stillMergingFor(userId){");
  return new Function("localStorage", `
    const SHOP_OWNER_KEY="kutadgu-shop-owner-v1";
    const SHOP_OWNER_GUEST="guest";
    const SHOP_OWNER_STALE="stale";
    ${src}
    return { shouldMergeLocalForUser, localItemsForMerge };
  `)(storage);
}

function intentApi() {
  const src = sliceBetween(member, "function clonePreMergeCart(items){", "function composeMergedShopState(");
  return new Function(`
    function sanitizeMemberQty(raw){return Math.max(1,Math.min(99,parseInt(String(raw??1),10)||1))}
    ${src}
    return { preMergeCartIntent, applyPreMergeCartIntent };
  `)();
}

function mergedFor(owner, userId, localCart, cloudCart, latestCart) {
  const storage = memoryStorage({ "kutadgu-shop-owner-v1": owner });
  const owners = ownerApi(storage);
  const gated = owners.localItemsForMerge(userId, localCart, []);
  const synced = Legacy.syncAuthenticatedShopState({
    localCart: gated.localCart,
    localFav: gated.localFav,
    cloudCart,
    cloudFav: [],
    resolveId: (id) => String(id),
    aliasMap: {}
  });
  const intent = intentApi();
  return intent.applyPreMergeCartIntent(
    synced.cart,
    intent.preMergeCartIntent(localCart, latestCart || localCart, (id) => String(id)),
    (id) => String(id)
  );
}

test("existing merge keeps guest books by max quantity and excludes another account", () => {
  const signUp = sliceBetween(member, "async function signUp({email,password,fullName}){", "async function signIn({email,password}){");
  assert.match(signUp, /if\(result\.data\?\.session\)await queueSession\(result\.data\.session,\{trackLogin:true,sync:true\}\)/);
  assert.doesNotMatch(signUp, /localStorage|member_cart_items|سېۋەت ساقلاندى/);
  assert.match(member, /async function mergeShopState\(\)\{[\s\S]{0,4000}if\(!stillMergingFor\(mergeForUserId\)\)return/);
  assert.strictEqual(Legacy.collapseAliasQuantities([2, 5]), 5);
  assert.strictEqual(Legacy.collapseAliasQuantities([4, 4]), 4);

  const guest = mergedFor("guest", "user-b", [{ id: "11", qty: 2 }, { id: "12", qty: 3 }], [{ id: "11", qty: 5 }, { id: "13", qty: 1 }]);
  assert.deepStrictEqual(guest, [
    { id: "11", qty: 5 },
    { id: "13", qty: 1 },
    { id: "12", qty: 3 }
  ]);
  const same = mergedFor("user-b", "user-b", [{ id: "11", qty: 4 }], [{ id: "11", qty: 4 }]);
  assert.deepStrictEqual(same, [{ id: "11", qty: 4 }]);
  const foreign = mergedFor("user-a", "user-b", [{ id: "11", qty: 9 }, { id: "12", qty: 2 }], [{ id: "21", qty: 3 }]);
  assert.deepStrictEqual(foreign, [{ id: "21", qty: 3 }]);
  const stale = mergedFor("stale", "user-b", [{ id: "11", qty: 9 }], [{ id: "21", qty: 1 }]);
  assert.deepStrictEqual(stale, [{ id: "21", qty: 1 }]);
  const during = mergedFor("guest", "user-b", [{ id: "11", qty: 1 }], [{ id: "11", qty: 2 }], [{ id: "11", qty: 4 }]);
  assert.deepStrictEqual(during, [{ id: "11", qty: 4 }]);
  const removed = mergedFor("guest", "user-b", [{ id: "11", qty: 2 }], [{ id: "11", qty: 5 }], []);
  assert.deepStrictEqual(removed, []);
});

test("existing foreign-owner merge still applies a local quantity change made during the merge", () => {
  const foreignDelta = mergedFor("user-a", "user-b", [{ id: "11", qty: 2 }], [{ id: "21", qty: 3 }], [{ id: "11", qty: 9 }]);
  assert.deepStrictEqual(foreignDelta, [{ id: "21", qty: 3 }, { id: "11", qty: 9 }]);
});

test("storefront shop pins are v=159 and account.js stays the only signup entry", () => {
  const htmlPins = execSync("git grep -l 'shop.js?v=' -- '*.html'", { cwd: root, encoding: "utf8" }).trim().split("\n");
  htmlPins.forEach((rel) => {
    const html = fs.readFileSync(path.join(root, rel), "utf8");
    assert.match(html, /shop\.js\?v=159/, rel);
    assert.doesNotMatch(html, /shop\.js\?v=154/, rel);
  });
  assert.match(accountJs, /function signupEntryRequested\(\)/);
  assert.match(accountJs, /String\(location\.hash\|\|""\)==="#signup"/);
  assert.doesNotMatch(accountJs, /returnUrl|next=/);
  assert.doesNotMatch(shop, /kutadgu-cart-v2|guest-cart-invite-v/);
});

Promise.resolve().then(() => Promise.all(pending)).then(() => {
  if (failed) {
    console.error("\n" + failed + " guest cart invite test(s) failed");
    process.exit(1);
  }
  console.log("guest-cart-invite-tests ok");
});
