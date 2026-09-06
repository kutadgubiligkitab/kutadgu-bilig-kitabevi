#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const member = fs.readFileSync(path.join(root, "member.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const cartHtml = fs.readFileSync(path.join(root, "cart.html"), "utf8");
const accountHtml = fs.readFileSync(path.join(root, "account.html"), "utf8");

let failed = 0;
const pending = [];
function test(name, fn) {
  let result;
  try {
    result = fn();
  } catch (err) {
    failed++;
    console.error("FAIL", name, err.message);
    return;
  }
  if (result && typeof result.then === "function") {
    pending.push(result.then(() => {
      console.log("PASS", name);
    }, err => {
      failed++;
      console.error("FAIL", name, err && err.message || err);
    }));
    return;
  }
  console.log("PASS", name);
}
function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
  return src.slice(start, end);
}

function provenApi() {
  const src = sliceBetween(member, "function provenMemberSession(session){", "async function recoverProvenMemberSession(){");
  return new Function(`${src}\nreturn { provenMemberSession };`)();
}
function recoverApi() {
  const provenSrc = sliceBetween(member, "function provenMemberSession(session){", "async function recoverProvenMemberSession(){");
  const recoverSrc = sliceBetween(member, "async function recoverProvenMemberSession(){", "function queueRecoveredSession(");
  return new Function(`
    let db = null;
    ${provenSrc}
    ${recoverSrc}
    return {
      setDb(next){ db = next; },
      provenMemberSession,
      recoverProvenMemberSession
    };
  `)();
}

function identityApi({
  liveUser = null,
  sessionUser = "",
  owner = "",
  accessToken = "tok",
  expiresAt = "future",
  sessionBootDone = false,
  extraStore = {}
} = {}) {
  const store = { ...extraStore };
  if (owner) store["kutadgu-shop-owner-v1"] = owner;
  if (sessionUser) {
    let exp = expiresAt;
    if (exp === "future") exp = Math.floor(Date.now() / 1000) + 3600;
    const session = {
      user: { id: sessionUser },
      refresh_token: "refresh-only-is-not-enough"
    };
    if (accessToken !== null) session.access_token = accessToken;
    if (exp !== "missing") session.expires_at = exp;
    store["sb-fxlojnqwyojqjskfggmh-auth-token"] = JSON.stringify(session);
  }
  const localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; }
  };
  const windowObj = {
    KUTADGU_SUPABASE_CONFIG: { url: "https://fxlojnqwyojqjskfggmh.supabase.co" },
    KutadguMember: {
      getUser() { return liveUser ? { id: liveUser } : null; },
      sessionBootDone() { return !!sessionBootDone; }
    }
  };
  const src = sliceBetween(shop, "function peekPersistedShopUserId(){", "function alignCartDisplayAfterMemberSync(prevItems){");
  const applied = [];
  const api = new Function("localStorage", "window", "applied", `
    const CART_KEY="kutadgu-cart-v1";
    const FAV_KEY="kutadgu-favorites-v1";
    const CART_DISPLAY_KEY="kutadgu-cart-display-v1";
    const SHOP_OWNER_GUEST="guest";
    const SHOP_OWNER_STALE="stale";
    function readShopOwner(){ try{return String(localStorage.getItem("kutadgu-shop-owner-v1")||"").trim()}catch(e){return ""} }
    function writeShopOwner(owner){
      try{
        if(owner)localStorage.setItem("kutadgu-shop-owner-v1",owner);
        else localStorage.removeItem("kutadgu-shop-owner-v1");
      }catch(e){}
    }
    function add(id,qty){ applied.push({kind:"add",id:String(id),qty:qty||1}); }
    function toggleFav(id){ applied.push({kind:"fav",id:String(id)}); }
    function favHas(){ return false; }
    ${src}
    return {
      peekPersistedShopUserId,
      currentShopUserId,
      shopOwnerAllowsLocalDisplay,
      identityBootstrapPending,
      shopStateWriteAllowed,
      canRecoverOrphanedOwnerForGuestWrite,
      recoverOrphanedOwnerForGuestWrite,
      recoverStaleOwnerForGuestWrite,
      enqueueShopIntent,
      replayPendingShopIntents,
      dropPendingShopIntents,
      applied,
      pending(){ return pendingShopIntents.slice(); }
    };
  `)(localStorage, windowObj, applied);
  api.store = store;
  return api;
}

function mutationApi({
  owner = "guest",
  liveUser = null,
  sessionUser = "",
  expiresAt = "future",
  sessionBootDone = false
} = {}) {
  const ident = identityApi({ owner, liveUser, sessionUser, expiresAt, sessionBootDone });
  const store = {
    "kutadgu-cart-v1": JSON.stringify([{ id: "A", qty: 1 }, { id: "B", qty: 1 }]),
    "kutadgu-favorites-v1": JSON.stringify(["A", "B"]),
    "kutadgu-shop-owner-v1": owner
  };
  const writes = [];
  const toasts = [];
  const syncs = [];
  const CART_KEY = "kutadgu-cart-v1";
  const FAV_KEY = "kutadgu-favorites-v1";
  function shopOwnerAllowsLocalDisplay() {
    return ident.shopOwnerAllowsLocalDisplay();
  }
  function stampShopOwner() { writes.push("stamp"); }
  const set = new Function("shopOwnerAllowsLocalDisplay", "stampShopOwner", "window", "localStorage", "CART_KEY", "FAV_KEY", "writes", `
    const set=(k,v)=>{
      try{
        if((k===CART_KEY||k===FAV_KEY)&&!shopOwnerAllowsLocalDisplay())return false;
        localStorage.setItem(k,JSON.stringify(v));
        writes.push({key:k,value:v});
        if(k===CART_KEY||k===FAV_KEY)stampShopOwner();
        window.KutadguMember&&window.KutadguMember.syncKey&&window.KutadguMember.syncKey(k,v);
        return true;
      }catch(error){return false}
    };
    return set;
  `)(shopOwnerAllowsLocalDisplay, stampShopOwner, {
    KutadguMember: { syncKey(k, v) { syncs.push({ k, v }); } }
  }, {
    setItem(k, v) { store[k] = String(v); },
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; }
  }, CART_KEY, FAV_KEY, writes);
  return { ident, store, writes, toasts, syncs, set, CART_KEY, FAV_KEY };
}

test("storefront pages still load shop.js without statically loading member.js", () => {
  assert.match(indexHtml, /shop\.js\?v=114/);
  assert.doesNotMatch(indexHtml, /src="member\.js/);
  assert.match(cartHtml, /shop\.js\?v=113/);
  assert.doesNotMatch(cartHtml, /src="member\.js/);
  assert.match(accountHtml, /member\.js\?v=25/);
  assert.doesNotMatch(accountHtml, /shop\.js\?/);
});

test("member.js reuses one client and reads live supabase config", () => {
  assert.match(member, /if\(window\.KutadguMember\)\{/);
  assert.match(member, /function liveConfig\(\)\{/);
  assert.doesNotMatch(member, /const cfg=window\.KUTADGU_SUPABASE_CONFIG\|\|\{\};/);
  const init = sliceBetween(member, "async function init(){", "if(document.readyState===");
  assert.match(init, /const cfg=liveConfig\(\)/);
  assert.ok(init.indexOf("onAuthStateChange") < init.indexOf("recoverProvenMemberSession"));
  assert.match(init, /TOKEN_REFRESHED/);
  assert.match(member, /function provenMemberSession\(session\)\{/);
  assert.match(member, /sessionBootDone/);
});

test("member.js still fail-closes unknown identity and uses official refreshSession", () => {
  const recover = sliceBetween(member, "async function recoverProvenMemberSession(){", "function queueRecoveredSession(");
  assert.match(recover, /db\.auth\.getSession\(\)/);
  assert.match(recover, /db\.auth\.refreshSession\(\)/);
  assert.doesNotMatch(recover, /fetch\(/);
  assert.doesNotMatch(recover, /grant_type=refresh_token/);
  const proven = sliceBetween(member, "function provenMemberSession(session){", "async function recoverProvenMemberSession(){");
  assert.doesNotMatch(proven, /expires_in/);
  assert.doesNotMatch(member, /localStorage\.length/);
  assert.doesNotMatch(member, /sb-\.\+-auth-token/);
});

test("account button is reused and skipped on the account page", () => {
  const btn = sliceBetween(member, "function accountButton(){", "function renderButton(){");
  assert.match(btn, /dataset\.accountPage==="true"/);
  assert.match(btn, /querySelector\("\.member-account-button"\)/);
  assert.doesNotMatch(member, /member-account-button-2/);
});

test("shop.js does not await member boot before catalog first paint", () => {
  const boot = sliceBetween(shop, "async function boot(){", "window.kutadguShop=");
  assert.match(boot, /loadMemberSystem\(\);\n  await loadRemoteCatalog\(\)/);
  assert.doesNotMatch(boot, /await loadMemberSystem/);
  assert.match(shop, /member\.js\?v=25/);
  assert.match(shop, /script\[src\*="member\.js"\]/);
});

test("shopOwnerAllowsLocalDisplay stays fail-closed for expired peek", () => {
  const uid = "11111111-1111-4111-8111-111111111111";
  const expired = identityApi({
    owner: uid,
    sessionUser: uid,
    expiresAt: Math.floor(Date.now() / 1000) - 60
  });
  assert.strictEqual(expired.peekPersistedShopUserId(), "");
  assert.strictEqual(expired.shopOwnerAllowsLocalDisplay(), false);
  assert.strictEqual(expired.identityBootstrapPending(), true);
  const fresh = identityApi({ owner: uid, sessionUser: uid });
  assert.strictEqual(fresh.peekPersistedShopUserId(), uid);
  assert.strictEqual(fresh.shopOwnerAllowsLocalDisplay(), true);
  assert.strictEqual(fresh.identityBootstrapPending(), false);
  const guest = identityApi({ owner: "guest" });
  assert.strictEqual(guest.shopOwnerAllowsLocalDisplay(), true);
  assert.strictEqual(guest.identityBootstrapPending(), false);
});

test("provenMemberSession requires access_token, user.id, and explicit future expires_at", () => {
  const api = provenApi();
  const uid = "11111111-1111-4111-8111-111111111111";
  const ok = api.provenMemberSession({
    access_token: "tok",
    expires_at: Math.floor(Date.now() / 1000) + 30,
    user: { id: uid }
  });
  assert.ok(ok);
  assert.strictEqual(ok.user.id, uid);
  assert.strictEqual(api.provenMemberSession({
    access_token: "tok",
    refresh_token: "r",
    expires_at: Math.floor(Date.now() / 1000) - 30,
    user: { id: uid }
  }), null);
  assert.strictEqual(api.provenMemberSession({
    access_token: "tok",
    user: { id: uid },
    expires_in: 3600
  }), null);
  assert.strictEqual(api.provenMemberSession({
    access_token: "tok",
    refresh_token: "r",
    user: { id: uid }
  }), null);
  assert.strictEqual(api.provenMemberSession({
    refresh_token: "r",
    expires_at: Math.floor(Date.now() / 1000) + 30,
    user: { id: uid }
  }), null);
  assert.strictEqual(api.provenMemberSession({
    access_token: "tok",
    expires_at: "soon",
    user: { id: uid }
  }), null);
  assert.strictEqual(api.provenMemberSession({
    access_token: "tok",
    expires_at: Number.NaN,
    user: { id: uid }
  }), null);
});

test("refreshable expired session is accepted only after official refresh with expires_at", () => {
  const uid = "11111111-1111-4111-8111-111111111111";
  const expired = {
    access_token: "old",
    refresh_token: "r",
    expires_at: Math.floor(Date.now() / 1000) - 90,
    user: { id: uid }
  };
  const fresh = {
    access_token: "new",
    refresh_token: "r2",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: uid }
  };
  const api = recoverApi();
  api.setDb({
    auth: {
      getSession() { return Promise.resolve({ data: { session: expired }, error: null }); },
      refreshSession() { return Promise.resolve({ data: { session: fresh }, error: null }); }
    }
  });
  return api.recoverProvenMemberSession().then((result) => {
    assert.ok(result);
    assert.strictEqual(result.user.id, uid);
    assert.strictEqual(result.access_token, "new");
  });
});

test("refresh session without explicit expires_at is rejected", () => {
  const uid = "11111111-1111-4111-8111-111111111111";
  const expired = {
    access_token: "old",
    refresh_token: "r",
    expires_at: Math.floor(Date.now() / 1000) - 90,
    user: { id: uid }
  };
  const noExpiry = {
    access_token: "new",
    refresh_token: "r2",
    expires_in: 3600,
    user: { id: uid }
  };
  const api = recoverApi();
  api.setDb({
    auth: {
      getSession() { return Promise.resolve({ data: { session: expired }, error: null }); },
      refreshSession() { return Promise.resolve({ data: { session: noExpiry }, error: null }); }
    }
  });
  return api.recoverProvenMemberSession().then((result) => {
    assert.strictEqual(result, null);
  });
});

test("orphaned owner recovery is allowed only after boot with no live or persisted user", () => {
  const uid = "11111111-1111-4111-8111-111111111111";
  const leftover = {
    "kutadgu-cart-v1": JSON.stringify([{ id: "102", qty: 2 }]),
    "kutadgu-favorites-v1": JSON.stringify(["102"]),
    "kutadgu-cart-display-v1": JSON.stringify({ v: 1, items: { "102": { id: "102", title: "old" } } })
  };

  const stale = identityApi({
    owner: "stale",
    sessionBootDone: true,
    extraStore: leftover
  });
  assert.strictEqual(stale.identityBootstrapPending(), false);
  assert.strictEqual(stale.canRecoverOrphanedOwnerForGuestWrite(), true);
  assert.strictEqual(stale.recoverOrphanedOwnerForGuestWrite(), true);
  assert.strictEqual(stale.shopOwnerAllowsLocalDisplay(), true);
  assert.strictEqual(stale.store["kutadgu-shop-owner-v1"], "guest");
  assert.strictEqual(stale.store["kutadgu-cart-v1"], undefined);
  assert.strictEqual(stale.store["kutadgu-favorites-v1"], undefined);
  assert.strictEqual(stale.store["kutadgu-cart-display-v1"], undefined);

  const orphanUuid = identityApi({
    owner: uid,
    sessionBootDone: true,
    extraStore: leftover
  });
  assert.strictEqual(orphanUuid.currentShopUserId(), "");
  assert.strictEqual(orphanUuid.identityBootstrapPending(), false);
  assert.strictEqual(orphanUuid.canRecoverOrphanedOwnerForGuestWrite(), true);
  assert.strictEqual(orphanUuid.recoverOrphanedOwnerForGuestWrite(), true);
  assert.strictEqual(orphanUuid.store["kutadgu-shop-owner-v1"], "guest");
  assert.strictEqual(orphanUuid.store["kutadgu-cart-v1"], undefined);
  assert.strictEqual(orphanUuid.store["kutadgu-favorites-v1"], undefined);
  assert.strictEqual(orphanUuid.shopOwnerAllowsLocalDisplay(), true);

  const expiredPeek = identityApi({
    owner: uid,
    sessionUser: uid,
    expiresAt: Math.floor(Date.now() / 1000) - 90,
    sessionBootDone: true,
    extraStore: leftover
  });
  assert.strictEqual(expiredPeek.peekPersistedShopUserId(), "");
  assert.strictEqual(expiredPeek.identityBootstrapPending(), false);
  assert.strictEqual(expiredPeek.recoverOrphanedOwnerForGuestWrite(), true);
  assert.strictEqual(expiredPeek.store["kutadgu-shop-owner-v1"], "guest");
  assert.strictEqual(expiredPeek.store["kutadgu-cart-v1"], undefined);
});

test("orphaned owner recovery never runs while bootstrap is pending or a session exists", () => {
  const uid = "11111111-1111-4111-8111-111111111111";
  const leftover = {
    "kutadgu-cart-v1": JSON.stringify([{ id: "102", qty: 2 }]),
    "kutadgu-favorites-v1": JSON.stringify(["102"])
  };

  const pending = identityApi({
    owner: uid,
    sessionBootDone: false,
    extraStore: leftover
  });
  assert.strictEqual(pending.identityBootstrapPending(), true);
  assert.strictEqual(pending.canRecoverOrphanedOwnerForGuestWrite(), false);
  assert.strictEqual(pending.recoverOrphanedOwnerForGuestWrite(), false);
  assert.strictEqual(pending.enqueueShopIntent("add", { id: "C", qty: 1 }), true);
  assert.strictEqual(pending.store["kutadgu-shop-owner-v1"], uid);
  assert.deepStrictEqual(JSON.parse(pending.store["kutadgu-cart-v1"]).map((row) => row.id), ["102"]);
  assert.deepStrictEqual(JSON.parse(pending.store["kutadgu-favorites-v1"]), ["102"]);

  const validPeek = identityApi({
    owner: uid,
    sessionUser: uid,
    sessionBootDone: false,
    extraStore: leftover
  });
  assert.strictEqual(validPeek.currentShopUserId(), uid);
  assert.strictEqual(validPeek.identityBootstrapPending(), false);
  assert.strictEqual(validPeek.canRecoverOrphanedOwnerForGuestWrite(), false);
  assert.strictEqual(validPeek.recoverOrphanedOwnerForGuestWrite(), false);
  assert.strictEqual(validPeek.store["kutadgu-shop-owner-v1"], uid);
  assert.deepStrictEqual(JSON.parse(validPeek.store["kutadgu-cart-v1"]).map((row) => row.id), ["102"]);

  const liveSame = identityApi({
    owner: uid,
    liveUser: uid,
    sessionUser: uid,
    sessionBootDone: true,
    extraStore: leftover
  });
  assert.strictEqual(liveSame.canRecoverOrphanedOwnerForGuestWrite(), false);
  assert.strictEqual(liveSame.recoverOrphanedOwnerForGuestWrite(), false);
  assert.strictEqual(liveSame.store["kutadgu-shop-owner-v1"], uid);
  assert.deepStrictEqual(JSON.parse(liveSame.store["kutadgu-cart-v1"]).map((row) => row.id), ["102"]);

  const liveMismatch = identityApi({
    owner: uid,
    liveUser: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    sessionBootDone: true,
    extraStore: leftover
  });
  assert.strictEqual(liveMismatch.recoverOrphanedOwnerForGuestWrite(), false);
  assert.strictEqual(liveMismatch.store["kutadgu-shop-owner-v1"], uid);
  assert.deepStrictEqual(JSON.parse(liveMismatch.store["kutadgu-cart-v1"]).map((row) => row.id), ["102"]);
});

test("stampShopOwner rewrites STALE to guest and never restamps a leftover live uid", () => {
  const uid = "11111111-1111-4111-8111-111111111111";
  const src = sliceBetween(shop, "function stampShopOwner(){", "function peekPersistedShopUserId(){");
  function stamp(owner, liveUid) {
    const store = { "kutadgu-shop-owner-v1": owner };
    return new Function("localStorage", `
      const SHOP_OWNER_KEY="kutadgu-shop-owner-v1";
      const SHOP_OWNER_GUEST="guest";
      const SHOP_OWNER_STALE="stale";
      function readShopOwner(){ return String(localStorage.getItem(SHOP_OWNER_KEY)||"").trim(); }
      function writeShopOwner(next){ localStorage.setItem(SHOP_OWNER_KEY, next); }
      function liveShopUserId(){ return ${JSON.stringify(liveUid)}; }
      function isPreviewShopDebug(){ return false; }
      ${src}
      stampShopOwner();
      return readShopOwner();
    `)({
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); }
    });
  }
  assert.strictEqual(stamp("stale", uid), "guest");
  assert.strictEqual(stamp("guest", uid), uid);
  assert.strictEqual(stamp(uid, uid), uid);
  assert.strictEqual(stamp(uid, ""), uid);
});

test("guest add still writes immediately and is not queued", () => {
  const api = identityApi({ owner: "guest" });
  assert.strictEqual(api.enqueueShopIntent("add", { id: "C", qty: 1 }), false);
  assert.deepStrictEqual(api.pending(), []);
  const mut = mutationApi({ owner: "guest" });
  assert.strictEqual(mut.set(mut.CART_KEY, [{ id: "G", qty: 1 }]), true);
  assert.strictEqual(JSON.parse(mut.store[mut.CART_KEY])[0].id, "G");
  assert.strictEqual(mut.syncs.length, 1);
});

test("fail-closed member owner does not overwrite local cart while identity is unknown", () => {
  const uid = "11111111-1111-4111-8111-111111111111";
  const mut = mutationApi({
    owner: uid,
    sessionUser: uid,
    expiresAt: Math.floor(Date.now() / 1000) - 90
  });
  assert.strictEqual(mut.ident.shopOwnerAllowsLocalDisplay(), false);
  assert.strictEqual(mut.set(mut.CART_KEY, [{ id: "C", qty: 1 }]), false);
  assert.deepStrictEqual(JSON.parse(mut.store[mut.CART_KEY]).map((row) => row.id), ["A", "B"]);
  assert.deepStrictEqual(mut.syncs, []);
});

test("early add during bootstrap is queued for the same owner and replayed after restore", () => {
  const uid = "11111111-1111-4111-8111-111111111111";
  const pending = identityApi({
    owner: uid,
    sessionUser: uid,
    expiresAt: Math.floor(Date.now() / 1000) - 90
  });
  assert.strictEqual(pending.enqueueShopIntent("add", { id: "C", qty: 1 }), true);
  assert.strictEqual(pending.enqueueShopIntent("fav-add", { id: "C" }), true);
  assert.strictEqual(pending.pending().length, 2);
  pending.replayPendingShopIntents();
  assert.deepStrictEqual(pending.applied, []);
  const restored = identityApi({ owner: uid, liveUser: uid, sessionUser: uid });
  restored.enqueueShopIntent("add", { id: "C", qty: 1 });
  assert.deepStrictEqual(restored.pending(), []);
  const queued = identityApi({
    owner: uid,
    sessionUser: uid,
    expiresAt: Math.floor(Date.now() / 1000) - 90
  });
  queued.enqueueShopIntent("add", { id: "C", qty: 1 });
  queued.enqueueShopIntent("fav-add", { id: "C" });
  queued.applied.length = 0;
  const live = identityApi({ owner: uid, liveUser: uid });
  live.pending().splice(0, live.pending().length);
  queued.replayPendingShopIntents();
  assert.deepStrictEqual(queued.applied, []);
});

test("replay applies same-user queued intents once identity is live", () => {
  const uid = "11111111-1111-4111-8111-111111111111";
  const api = identityApi({
    owner: uid,
    sessionUser: uid,
    expiresAt: Math.floor(Date.now() / 1000) - 90
  });
  assert.strictEqual(api.enqueueShopIntent("add", { id: "C", qty: 2 }), true);
  assert.strictEqual(api.enqueueShopIntent("fav-add", { id: "C" }), true);
  api.KutadguLive = uid;
  const store = { "kutadgu-shop-owner-v1": uid };
  const localStorage = {
    getItem(k) { return store[k] || null; }
  };
  const windowObj = {
    KUTADGU_SUPABASE_CONFIG: { url: "https://fxlojnqwyojqjskfggmh.supabase.co" },
    KutadguMember: { getUser() { return { id: uid }; }, sessionBootDone() { return true; } }
  };
  const src = sliceBetween(shop, "function peekPersistedShopUserId(){", "function alignCartDisplayAfterMemberSync(prevItems){");
  const applied = [];
  const live = new Function("localStorage", "window", "applied", `
    const SHOP_OWNER_GUEST="guest";
    const SHOP_OWNER_STALE="stale";
    function readShopOwner(){ return String(localStorage.getItem("kutadgu-shop-owner-v1")||"").trim(); }
    function add(id,qty){ applied.push({kind:"add",id:String(id),qty:qty||1}); }
    function toggleFav(id){ applied.push({kind:"fav",id:String(id)}); }
    function favHas(){ return false; }
    ${src}
    pendingShopIntents.push({owner:"${uid}",kind:"add",payload:{id:"C",qty:2}});
    pendingShopIntents.push({owner:"${uid}",kind:"fav-add",payload:{id:"C"}});
    replayPendingShopIntents();
    return { applied, pending: pendingShopIntents.slice(), allows: shopOwnerAllowsLocalDisplay() };
  `)(localStorage, windowObj, applied);
  assert.strictEqual(live.allows, true);
  assert.deepStrictEqual(live.applied, [
    { kind: "add", id: "C", qty: 2 },
    { kind: "fav", id: "C" }
  ]);
  assert.deepStrictEqual(live.pending, []);
});

test("A owner plus B live identity never replays A intents into B", () => {
  const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const src = sliceBetween(shop, "function peekPersistedShopUserId(){", "function alignCartDisplayAfterMemberSync(prevItems){");
  const localStorage = {
    getItem(k) {
      if (k === "kutadgu-shop-owner-v1") return a;
      return null;
    }
  };
  const windowObj = {
    KUTADGU_SUPABASE_CONFIG: { url: "https://fxlojnqwyojqjskfggmh.supabase.co" },
    KutadguMember: { getUser() { return { id: b }; }, sessionBootDone() { return true; } }
  };
  const out = new Function("localStorage", "window", `
    const SHOP_OWNER_GUEST="guest";
    const SHOP_OWNER_STALE="stale";
    function readShopOwner(){ return String(localStorage.getItem("kutadgu-shop-owner-v1")||"").trim(); }
    function add(){ throw new Error("must-not-replay-A-into-B"); }
    function toggleFav(){ throw new Error("must-not-replay-A-into-B"); }
    function favHas(){ return false; }
    ${src}
    pendingShopIntents.push({owner:"${a}",kind:"add",payload:{id:"C",qty:1}});
    const queued=enqueueShopIntent("add",{id:"D",qty:1});
    replayPendingShopIntents();
    return { queued, pending: pendingShopIntents.slice(), allows: shopOwnerAllowsLocalDisplay() };
  `)(localStorage, windowObj);
  assert.strictEqual(out.allows, false);
  assert.strictEqual(out.queued, false);
  assert.deepStrictEqual(out.pending, []);
});

test("expired unrefreshable boot drops the queue and does not write cloud", () => {
  const uid = "11111111-1111-4111-8111-111111111111";
  const src = sliceBetween(shop, "function peekPersistedShopUserId(){", "function alignCartDisplayAfterMemberSync(prevItems){");
  const localStorage = {
    getItem(k) {
      if (k === "kutadgu-shop-owner-v1") return uid;
      return null;
    }
  };
  const windowObj = {
    KUTADGU_SUPABASE_CONFIG: { url: "https://fxlojnqwyojqjskfggmh.supabase.co" },
    KutadguMember: { getUser() { return null; }, sessionBootDone() { return true; } }
  };
  const out = new Function("localStorage", "window", `
    const SHOP_OWNER_GUEST="guest";
    const SHOP_OWNER_STALE="stale";
    function readShopOwner(){ return String(localStorage.getItem("kutadgu-shop-owner-v1")||"").trim(); }
    function add(){ throw new Error("must-not-replay-after-failed-refresh"); }
    function toggleFav(){ throw new Error("must-not-replay-after-failed-refresh"); }
    function favHas(){ return false; }
    ${src}
    pendingShopIntents.push({owner:"${uid}",kind:"add",payload:{id:"C",qty:1}});
    replayPendingShopIntents();
    return { pending: pendingShopIntents.slice(), bootstrap: identityBootstrapPending(), allows: shopOwnerAllowsLocalDisplay() };
  `)(localStorage, windowObj);
  assert.strictEqual(out.allows, false);
  assert.strictEqual(out.bootstrap, false);
  assert.deepStrictEqual(out.pending, []);
});

test("add/toggleFav recover orphaned owners after boot and never silent-fail a guest write", () => {
  const add = sliceBetween(shop, "function add(id,qty=1){", "function remove(id){");
  const fav = sliceBetween(shop, "function toggleFav(id){", "function recent(id){");
  const set = sliceBetween(shop, "const set=(k,v)=>{", "function visibilityContext(){");
  assert.match(add, /recoverOrphanedOwnerForGuestWrite\(\)/);
  assert.ok(add.indexOf("recoverOrphanedOwnerForGuestWrite") < add.indexOf("enqueueShopIntent"));
  assert.match(add, /if\(!shopOwnerAllowsLocalDisplay\(\)\)\{/);
  assert.match(add, /enqueueShopIntent\("add"/);
  assert.match(add, /كىتاب سېۋەتكە قوشۇلمىدى\. سەھىپىنى يېڭىلاپ قايتا سىناڭ\./);
  assert.ok(add.indexOf("enqueueShopIntent") < add.indexOf("set(CART_KEY,a)"));
  assert.match(fav, /recoverOrphanedOwnerForGuestWrite\(\)/);
  assert.ok(fav.indexOf("recoverOrphanedOwnerForGuestWrite") < fav.indexOf("enqueueShopIntent"));
  assert.match(fav, /enqueueShopIntent\("fav-add"/);
  assert.match(fav, /ياقتۇرغانلارغا قوشۇلمىدى\. سەھىپىنى يېڭىلاپ قايتا سىناڭ\./);
  assert.ok(fav.indexOf("enqueueShopIntent") < fav.indexOf("set(FAV_KEY,a)"));
  assert.match(shop, /function canRecoverOrphanedOwnerForGuestWrite\(\)\{/);
  assert.match(shop, /if\(liveShopUserId\(\)\)return false;/);
  assert.match(shop, /if\(currentShopUserId\(\)\)return false;/);
  assert.match(shop, /if\(identityBootstrapPending\(\)\)return false;/);
  assert.match(shop, /if\(owner===SHOP_OWNER_STALE\)return true;/);
  assert.match(shop, /return member\.sessionBootDone\(\)===true;/);
  assert.match(shop, /localStorage\.removeItem\(CART_KEY\)/);
  assert.match(shop, /localStorage\.removeItem\(FAV_KEY\)/);
  assert.match(shop, /localStorage\.removeItem\(CART_DISPLAY_KEY\)/);
  assert.match(set, /if\(\(k===CART_KEY\|\|k===FAV_KEY\)&&!shopStateWriteAllowed\(\)\)return false/);
  assert.match(set, /if\(ownerBefore!==SHOP_OWNER_STALE\)window\.KutadguMember\?\.syncKey\?\.\(k,v\)/);
  assert.match(shop, /if\(current===SHOP_OWNER_STALE\)\{\s*writeShopOwner\(SHOP_OWNER_GUEST\);\s*return;/);
  assert.match(shop, /if\(!currentUid\)return false/);
  assert.match(shop, /return currentUid===currentOwner/);
});

test("refreshAfterMemberSync and member-change replay queued storefront intents", () => {
  const refresh = sliceBetween(shop, "function refreshAfterMemberSync(){", "function loadAssetScript(");
  assert.match(refresh, /replayPendingShopIntents\(\)/);
  const listeners = sliceBetween(shop, "function bindShopMemberListeners(){", "function init(){");
  assert.match(listeners, /replayPendingShopIntents\(\)/);
  assert.match(listeners, /kutadgu:catalog-ready/);
  assert.match(listeners, /kutadgu-member-change/);
  assert.match(listeners, /kutadgu-member-state-synced/);
});

test("mobile toast sits above the bottom nav via shared CSS variables", () => {
  const shopCss = fs.readFileSync(path.join(root, "shop.css"), "utf8");
  const mobileCss = fs.readFileSync(path.join(root, "mobile.css"), "utf8");
  assert.match(shop, /t\.className="shop-toast"/);
  assert.doesNotMatch(shop, /t\.style\.cssText=/);
  assert.doesNotMatch(shop, /bottom:18px;z-index:10000/);
  assert.match(shopCss, /\.shop-toast\{/);
  assert.match(shopCss, /bottom:18px;/);
  assert.match(mobileCss, /--mobile-shop-nav-height:\s*var\(--mobile-bottom-height\)/);
  assert.match(mobileCss, /--mobile-bottom-safe:\s*env\(safe-area-inset-bottom,\s*0px\)/);
  assert.match(mobileCss, /\.shop-toast \{/);
  assert.match(mobileCss, /bottom:\s*calc\(var\(--mobile-shop-nav-height\) \+ var\(--mobile-bottom-safe\) \+ var\(--mobile-toast-gap\)\)/);
  assert.match(mobileCss, /z-index:\s*11900/);
});

test("logout still abandons member shop state and account page still loads member.js once", () => {
  assert.match(member, /if\(event==="SIGNED_OUT"\)\{\s*abandonMemberShopSync\(\);/);
  assert.match(member, /recoveredIdentityId="signed-out"/);
  assert.match(member, /async function signOut\(\)\{\s*const pending=abandonMemberShopSync\(\);/);
  const accountScripts = accountHtml.match(/member\.js\?v=\d+/g) || [];
  assert.deepStrictEqual(accountScripts, ["member.js?v=25"]);
});

Promise.resolve().then(() => Promise.all(pending)).then(() => {
  if (failed) {
    console.error("\n" + failed + " test(s) failed");
    process.exit(1);
  }
  console.log("\nAll storefront session bootstrap tests passed");
});
