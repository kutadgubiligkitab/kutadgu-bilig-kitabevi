#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const accountJs = fs.readFileSync(path.join(root, "account.js"), "utf8");
const accountHtml = fs.readFileSync(path.join(root, "account.html"), "utf8");
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

test("account.html pins a single member.js and one account.js", () => {
  const memberScripts = accountHtml.match(/member\.js\?v=\d+/g) || [];
  const accountScripts = accountHtml.match(/account\.js\?v=\d+/g) || [];
  assert.deepStrictEqual(memberScripts, ["member.js?v=25"]);
  assert.deepStrictEqual(accountScripts, ["account.js?v=5"]);
  assert.doesNotMatch(accountHtml, /<script[^>]+src="member\.js[^"]*"[^>]*>[\s\S]*<script[^>]+src="member\.js/);
});

test("account.js clears private DOM and invalidates stale renders without signing out", () => {
  assert.match(accountJs, /function clearPrivateAccountUi\(\)\{/);
  assert.match(accountJs, /#memberWelcome/);
  assert.match(accountJs, /#memberEmail/);
  assert.match(accountJs, /#memberCreated/);
  assert.match(accountJs, /#memberLastSeen/);
  assert.match(accountJs, /#memberVisits/);
  assert.match(accountJs, /#memberOrders/);
  assert.match(accountJs, /#profileName/);
  assert.match(accountJs, /#profilePhone/);
  assert.match(accountJs, /#profileCountry/);
  assert.match(accountJs, /#profileCity/);
  assert.match(accountJs, /#profileAddress/);
  assert.match(accountJs, /#orderList/);
  assert.match(accountJs, /#profileStatus/);
  assert.match(accountJs, /let accountRenderSeq=0/);
  assert.match(accountJs, /function isCurrentAccountRender\(token\)/);
  assert.match(accountJs, /function invalidateAccountRenders\(\)/);
  const listener = sliceBetween(accountJs, "function onMemberChange(){", "async function init(){");
  assert.match(listener, /api\(\)\.isBlocked\(\)/);
  assert.match(listener, /showUnauthenticatedAccount\(\)/);
  assert.doesNotMatch(listener, /signOut\(/);
  assert.match(accountJs, /if\(!isCurrentAccountRender\(token\)\)return/);
  const orders = sliceBetween(accountJs, "async function renderOrders(token){", "async function renderMember(){");
  assert.match(orders, /await api\(\)\.getOrders\(\)/);
  assert.ok(orders.indexOf("await api().getOrders()") < orders.indexOf("if(!isCurrentAccountRender(token))return"));
});

class El {
  constructor(tag, attrs = {}) {
    this.tagName = String(tag || "div").toUpperCase();
    this.id = attrs.id || "";
    this.hidden = !!attrs.hidden;
    this._textContent = attrs.textContent || "";
    this._innerHTML = attrs.innerHTML || "";
    this.value = attrs.value || "";
    this.className = attrs.className || "";
    this.dataset = Object.assign({}, attrs.dataset);
    this.disabled = false;
    this.type = attrs.type || (this.tagName === "INPUT" ? "text" : "");
    this.children = [];
    this._listeners = {};
    this.onclick = null;
    this.classList = {
      toggle: () => {},
      add: () => {},
      remove: () => {},
      contains: () => false
    };
  }
  get textContent() { return this._textContent; }
  set textContent(v) { this._textContent = String(v ?? ""); }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = String(v); this._textContent = String(v).replace(/<[^>]+>/g, " "); }
  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }
  setAttribute() {}
  querySelector(sel) {
    if (sel === 'button[type="submit"]') {
      if (!this.submitBtn) this.submitBtn = new El("button", { type: "submit", textContent: "submit" });
      return this.submitBtn;
    }
    if (sel === "span") return this.span || (this.span = new El("span", { textContent: "Google" }));
    return null;
  }
  focus() {}
  async dispatch(type, extra) {
    const event = Object.assign({ currentTarget: this, preventDefault() {}, target: this }, extra || {});
    if (type === "click" && this.onclick) await this.onclick(event);
    for (const fn of this._listeners[type] || []) await fn(event);
  }
}

function makeAccountDom() {
  const byId = {};
  const ids = [
    "accountLoading", "accountSetup", "authPanel", "memberPanel",
    "authTitle", "authSubtitle", "authStatus",
    "loginForm", "signupForm", "loginEmail", "loginPassword",
    "signupName", "signupEmail", "signupPassword", "signupConfirm",
    "googleSignIn", "forgotPassword", "memberLogout",
    "memberWelcome", "memberEmail", "memberCreated", "memberLastSeen",
    "memberVisits", "memberOrders", "profileStatus", "profileForm",
    "profileName", "profilePhone", "profileCountry", "profileCity",
    "profileAddress", "orderList"
  ];
  ids.forEach((id) => {
    const tag = /Form$/.test(id) ? "form" : /profile|login|signup|Email|Password|Name|Phone|Country|City/.test(id) ? "input" : "div";
    const hidden = ["accountSetup", "authPanel", "memberPanel", "signupForm"].includes(id);
    byId[id] = new El(id === "profileAddress" ? "textarea" : tag, { id, hidden });
  });
  byId.profileAddress = new El("textarea", { id: "profileAddress", hidden: false });
  byId.orderList.innerHTML = '<div class="account-empty">زاكازلار يۈكلىنىۋاتىدۇ...</div>';
  byId.memberWelcome.textContent = "ھېسابىم";
  byId.memberCreated.textContent = "—";
  byId.memberLastSeen.textContent = "—";
  byId.memberVisits.textContent = "0";
  byId.memberOrders.textContent = "0";
  const authTabs = [
    Object.assign(new El("button", { dataset: { authTab: "login" } })),
    Object.assign(new El("button", { dataset: { authTab: "signup" } }))
  ];
  const docListeners = {};
  const document = {
    readyState: "loading",
    querySelector(sel) {
      const m = /^#(.+)$/.exec(sel);
      if (m) return byId[m[1]] || null;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === "[data-auth-tab]") return authTabs;
      if (sel === "[data-password-toggle]") return [];
      return [];
    },
    getElementById(id) { return byId[id] || null; },
    addEventListener(type, fn) {
      (docListeners[type] = docListeners[type] || []).push(fn);
    },
    dispatchEvent(event) {
      const type = event && event.type;
      for (const fn of docListeners[type] || []) fn(event);
      return true;
    }
  };
  return { byId, document, docListeners };
}

function userA() {
  return {
    id: "user-a-id",
    email: "a@example.com",
    created_at: "2026-01-02T10:00:00Z"
  };
}
function profileA() {
  return {
    full_name: "ئەلى ئەزىز",
    email: "a@example.com",
    created_at: "2026-01-02T10:00:00Z",
    last_seen_at: "2026-09-05T12:00:00Z",
    visit_count: 7,
    phone: "+905551112233",
    country: "Türkiye",
    city: "Istanbul",
    address: "Kadıköy gizli كوچا 12"
  };
}
function ordersA() {
  return [{
    order_no: "KB-A-1001",
    created_at: "2026-08-01T09:00:00Z",
    status: "completed",
    total_qty: 2,
    total: 80,
    items: [{ title: "كىتاب A", qty: 2 }]
  }];
}
function userB() {
  return { id: "user-b-id", email: "b@example.com", created_at: "2026-02-02T10:00:00Z" };
}
function profileB() {
  return {
    full_name: "باتۇر بەك",
    email: "b@example.com",
    phone: "+905559998877",
    country: "Türkiye",
    city: "Ankara",
    address: "Çankaya 5",
    visit_count: 1,
    created_at: "2026-02-02T10:00:00Z",
    last_seen_at: "2026-09-05T13:00:00Z"
  };
}
function ordersB() {
  return [{
    order_no: "KB-B-2002",
    created_at: "2026-08-02T09:00:00Z",
    status: "processing",
    total_qty: 1,
    total: 40,
    items: [{ title: "كىتاب B", qty: 1 }]
  }];
}

function bootAccount(opts = {}) {
  const dom = makeAccountDom();
  let user = opts.user || null;
  let profile = opts.profile || null;
  let blocked = !!opts.blocked;
  let ordersHold = opts.ordersHold || null;
  const ordersByUser = Object.assign({
    "user-a-id": ordersA(),
    "user-b-id": ordersB()
  }, opts.ordersByUser || {});
  const signOutCalls = [];
  const member = {
    ready: Promise.resolve(),
    configured: () => true,
    getUser: () => user,
    getProfile: () => profile,
    isBlocked: () => blocked,
    applyFieldDirections() {},
    async getOrders() {
      if (ordersHold) await ordersHold;
      const id = user && user.id;
      return (id && ordersByUser[id]) ? ordersByUser[id].slice() : [];
    },
    async signIn() {
      user = opts.signInUser || userB();
      profile = opts.signInProfile || profileB();
      blocked = false;
      dom.document.dispatchEvent({ type: "kutadgu-member-change" });
    },
    async signUp(values) {
      if (opts.signupNeedsConfirm) return { session: null };
      user = { id: "user-new-id", email: values.email, created_at: "2026-09-05T00:00:00Z" };
      profile = { full_name: values.fullName, email: values.email, phone: "", country: "", city: "", address: "", visit_count: 0 };
      ordersByUser[user.id] = [];
      dom.document.dispatchEvent({ type: "kutadgu-member-change" });
      return { session: { user } };
    },
    async signOut() {
      signOutCalls.push(1);
      user = null;
      profile = null;
      blocked = false;
      dom.document.dispatchEvent({ type: "kutadgu-member-change" });
    },
    async updateProfile(values) {
      profile = Object.assign({}, profile, values);
      dom.document.dispatchEvent({ type: "kutadgu-member-change" });
      return profile;
    },
    async resetPassword() {},
    async signInWithGoogle() {},
    __set({ nextUser, nextProfile, nextBlocked, hold }) {
      user = nextUser;
      profile = nextProfile;
      if (nextBlocked !== undefined) blocked = nextBlocked;
      if (hold !== undefined) ordersHold = hold;
    }
  };
  const sandbox = {
    window: { KutadguMember: member, document: dom.document },
    document: dom.document,
    console,
    Date,
    Number,
    String,
    Array,
    Object,
    JSON,
    Math,
    parseInt,
    Boolean,
    Error,
    Promise,
    setTimeout,
    setImmediate,
    Intl
  };
  sandbox.window.window = sandbox.window;
  vm.runInNewContext(accountJs, sandbox);
  for (const fn of dom.docListeners.DOMContentLoaded || []) fn();
  return { dom, member, signOutCalls };
}

function privateLeak(byId, marker) {
  const blobs = [
    byId.memberWelcome.textContent,
    byId.memberEmail.textContent,
    byId.memberCreated.textContent,
    byId.memberLastSeen.textContent,
    byId.profileName.value,
    byId.profilePhone.value,
    byId.profileCountry.value,
    byId.profileCity.value,
    byId.profileAddress.value,
    byId.orderList.innerHTML,
    byId.profileStatus.textContent
  ].join("\n");
  return blobs.includes(marker);
}

function assertLoggedOut(byId) {
  assert.strictEqual(byId.memberPanel.hidden, true);
  assert.strictEqual(byId.authPanel.hidden, false);
  assert.strictEqual(byId.memberWelcome.textContent, "ھېسابىم");
  assert.strictEqual(byId.memberEmail.textContent, "");
  assert.strictEqual(byId.memberCreated.textContent, "—");
  assert.strictEqual(byId.memberLastSeen.textContent, "—");
  assert.strictEqual(byId.memberVisits.textContent, "0");
  assert.strictEqual(byId.memberOrders.textContent, "0");
  assert.strictEqual(byId.profileName.value, "");
  assert.strictEqual(byId.profilePhone.value, "");
  assert.strictEqual(byId.profileCountry.value, "");
  assert.strictEqual(byId.profileCity.value, "");
  assert.strictEqual(byId.profileAddress.value, "");
  assert.strictEqual(byId.orderList.innerHTML, "");
  assert.ok(!privateLeak(byId, "ئەلى ئەزىز"));
  assert.ok(!privateLeak(byId, "a@example.com"));
  assert.ok(!privateLeak(byId, "Kadıköy"));
  assert.ok(!privateLeak(byId, "+905551112233"));
  assert.ok(!privateLeak(byId, "KB-A-1001"));
  assert.ok(!privateLeak(byId, "كىتاب A"));
}

test("1 logged-in User A shows private member data", async () => {
  const { dom } = bootAccount({ user: userA(), profile: profileA() });
  await Promise.resolve();
  await new Promise((r) => setImmediate(r));
  const { byId } = dom;
  assert.strictEqual(byId.memberPanel.hidden, false);
  assert.strictEqual(byId.authPanel.hidden, true);
  assert.strictEqual(byId.memberWelcome.textContent, "ئەلى ئەزىز");
  assert.strictEqual(byId.memberEmail.textContent, "a@example.com");
  assert.strictEqual(byId.profilePhone.value, "+905551112233");
  assert.strictEqual(byId.profileAddress.value, "Kadıköy gizli كوچا 12");
  assert.strictEqual(byId.memberVisits.textContent, "7");
  assert.match(byId.orderList.innerHTML, /KB-A-1001/);
  assert.strictEqual(byId.memberOrders.textContent, "1");
});

test("2 member-change with user=null clears private DOM and shows login", async () => {
  const { dom, member } = bootAccount({ user: userA(), profile: profileA() });
  await new Promise((r) => setImmediate(r));
  member.__set({ nextUser: null, nextProfile: null, nextBlocked: false });
  dom.document.dispatchEvent({ type: "kutadgu-member-change" });
  assertLoggedOut(dom.byId);
  assert.strictEqual(dom.byId.loginForm.hidden, false);
});

test("3 cross-tab SIGNED_OUT style event does not need reload", async () => {
  const { dom, member } = bootAccount({ user: userA(), profile: profileA() });
  await new Promise((r) => setImmediate(r));
  member.__set({ nextUser: null, nextProfile: null, nextBlocked: false });
  dom.document.dispatchEvent({ type: "kutadgu-member-change" });
  assertLoggedOut(dom.byId);
  assert.strictEqual(dom.docListeners.DOMContentLoaded.length, 1);
});

test("4 same-tab logout still works and does not loop signOut", async () => {
  const { dom, signOutCalls } = bootAccount({ user: userA(), profile: profileA() });
  await new Promise((r) => setImmediate(r));
  await dom.byId.memberLogout.dispatch("click");
  assert.strictEqual(signOutCalls.length, 1);
  assertLoggedOut(dom.byId);
});

test("5 in-flight User A getOrders must not repaint after logout", async () => {
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  const { dom, member } = bootAccount({ user: userA(), profile: profileA(), ordersHold: hold });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(dom.byId.memberWelcome.textContent, "ئەلى ئەزىز");
  assert.ok(!dom.byId.orderList.innerHTML.includes("KB-A-1001"));
  member.__set({ nextUser: null, nextProfile: null, nextBlocked: false, hold: null });
  dom.document.dispatchEvent({ type: "kutadgu-member-change" });
  assertLoggedOut(dom.byId);
  release();
  await hold;
  await new Promise((r) => setImmediate(r));
  assertLoggedOut(dom.byId);
  assert.doesNotMatch(dom.byId.orderList.innerHTML, /KB-A-1001/);
});

test("6 User A then User B never keeps A private data", async () => {
  const { dom, member } = bootAccount({ user: userA(), profile: profileA() });
  await new Promise((r) => setImmediate(r));
  member.__set({ nextUser: null, nextProfile: null });
  dom.document.dispatchEvent({ type: "kutadgu-member-change" });
  assertLoggedOut(dom.byId);
  member.__set({ nextUser: userB(), nextProfile: profileB() });
  dom.document.dispatchEvent({ type: "kutadgu-member-change" });
  await new Promise((r) => setImmediate(r));
  const { byId } = dom;
  assert.strictEqual(byId.memberPanel.hidden, false);
  assert.strictEqual(byId.memberWelcome.textContent, "باتۇر بەك");
  assert.strictEqual(byId.memberEmail.textContent, "b@example.com");
  assert.match(byId.orderList.innerHTML, /KB-B-2002/);
  assert.ok(!privateLeak(byId, "ئەلى ئەزىز"));
  assert.ok(!privateLeak(byId, "a@example.com"));
  assert.ok(!privateLeak(byId, "KB-A-1001"));
  assert.ok(!privateLeak(byId, "Kadıköy"));
  assert.ok(!privateLeak(byId, "+905551112233"));
});

test("7 suspended/blocked account still shows auth error and clears private DOM", async () => {
  const { dom, member } = bootAccount({ user: userA(), profile: profileA() });
  await new Promise((r) => setImmediate(r));
  member.__set({ nextUser: userA(), nextProfile: profileA(), nextBlocked: true });
  dom.document.dispatchEvent({ type: "kutadgu-member-change" });
  assert.strictEqual(dom.byId.authPanel.hidden, false);
  assert.strictEqual(dom.byId.memberPanel.hidden, true);
  assert.match(dom.byId.authStatus.textContent, /ۋاقىتلىق توختىتىلغان/);
  assert.ok(!privateLeak(dom.byId, "ئەلى ئەزىز"));
  assert.ok(!privateLeak(dom.byId, "KB-A-1001"));
});

test("8 login, register, and profile save still work", async () => {
  const loggedOut = bootAccount({ user: null, profile: null });
  await new Promise((r) => setImmediate(r));
  loggedOut.dom.byId.loginEmail.value = "b@example.com";
  loggedOut.dom.byId.loginPassword.value = "password1";
  await loggedOut.dom.byId.loginForm.dispatch("submit");
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(loggedOut.dom.byId.memberPanel.hidden, false);
  assert.strictEqual(loggedOut.dom.byId.memberEmail.textContent, "b@example.com");

  const register = bootAccount({ user: null, profile: null });
  await new Promise((r) => setImmediate(r));
  register.dom.byId.signupName.value = "يېڭى ئەزا";
  register.dom.byId.signupEmail.value = "new@example.com";
  register.dom.byId.signupPassword.value = "password1";
  register.dom.byId.signupConfirm.value = "password1";
  await register.dom.byId.signupForm.dispatch("submit");
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(register.dom.byId.memberPanel.hidden, false);
  assert.strictEqual(register.dom.byId.memberWelcome.textContent, "يېڭى ئەزا");

  const profile = bootAccount({ user: userB(), profile: profileB() });
  await new Promise((r) => setImmediate(r));
  profile.dom.byId.profileName.value = "باتۇر بەك يېڭىلاندى";
  profile.dom.byId.profileCity.value = "Izmir";
  await profile.dom.byId.profileForm.dispatch("submit");
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(profile.dom.byId.profileName.value, "باتۇر بەك يېڭىلاندى");
  assert.strictEqual(profile.dom.byId.profileCity.value, "Izmir");
  assert.match(profile.dom.byId.profileStatus.textContent, /ساقلاندى/);
});

Promise.resolve().then(() => Promise.all(pending)).then(() => {
  if (failed) {
    console.error("\n" + failed + " test(s) failed");
    process.exit(1);
  }
  console.log("\nAll account cross-tab logout tests passed");
});
