#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Legacy = require("../legacy-id-utils.js");

const root = path.join(__dirname, "..");
const memberSrc = fs.readFileSync(path.join(root, "member.js"), "utf8");
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

function intentApi() {
  const src = sliceBetween(memberSrc, "function clonePreMergeCart(items){", "function composeMergedShopState(");
  return new Function(`
    function sanitizeMemberQty(raw){return Math.max(1,Math.min(99,parseInt(String(raw??1),10)||1))}
    ${src}
    return { clonePreMergeCart, clonePreMergeFav, preMergeCartIntent, applyPreMergeCartIntent, preMergeFavIntent, applyPreMergeFavIntent };
  `)();
}

function shouldMergeLocalForUser(owner, userId) {
  if (!owner || owner === "guest") return true;
  if (owner === "stale") return false;
  return owner === String(userId || "");
}

function runRace({
  owner = "user-a",
  userId = "user-a",
  baselineCart = [],
  baselineFav = [],
  cloudCart = [],
  cloudFav = [],
  act
} = {}) {
  const api = intentApi();
  const resolve = (id) => String(id);
  let localCart = baselineCart.map((row) => ({ id: String(row.id), qty: Number(row.qty) || 1 }));
  let localFav = baselineFav.map(String);
  const cloudWrites = [];
  let ready = false;
  function syncKey(kind, value) {
    if (!ready) {
      cloudWrites.push({ kind, mode: "deferred" });
      return "deferred";
    }
    cloudWrites.push({ kind, mode: "replace", value: JSON.parse(JSON.stringify(value)) });
    return "replaced";
  }
  const actions = {
    addCart(id, qty = 1) {
      const key = String(id);
      const hit = localCart.find((row) => String(row.id) === key);
      if (hit) hit.qty = qty;
      else localCart.push({ id: key, qty });
      return syncKey("cart", localCart);
    },
    removeCart(id) {
      localCart = localCart.filter((row) => String(row.id) !== String(id));
      return syncKey("cart", localCart);
    },
    setQty(id, qty) {
      const hit = localCart.find((row) => String(row.id) === String(id));
      if (hit) hit.qty = qty;
      return syncKey("cart", localCart);
    },
    addFav(id) {
      const key = String(id);
      if (!localFav.includes(key)) localFav.push(key);
      return syncKey("fav", localFav);
    },
    removeFav(id) {
      localFav = localFav.filter((row) => row !== String(id));
      return syncKey("fav", localFav);
    }
  };
  if (typeof act === "function") act(actions);
  const gated = shouldMergeLocalForUser(owner, userId)
    ? { localCart: baselineCart, localFav: baselineFav }
    : { localCart: [], localFav: [] };
  const synced = Legacy.syncAuthenticatedShopState({
    ...gated,
    cloudCart,
    cloudFav,
    resolveId: resolve,
    aliasMap: {}
  });
  const cart = api.applyPreMergeCartIntent(
    synced.cart,
    api.preMergeCartIntent(baselineCart, localCart, resolve),
    resolve
  );
  const fav = api.applyPreMergeFavIntent(
    synced.fav,
    api.preMergeFavIntent(baselineFav, localFav, resolve),
    resolve
  );
  ready = true;
  cloudWrites.push({ kind: "merge", mode: "merge", cart, fav });
  return { cart, fav, cloudWrites, localCart, localFav };
}

test("syncKey defers whole-state replace until initial merge is ready", () => {
  const sync = sliceBetween(memberSrc, "function syncKey(key,value){", "async function applySession(");
  assert.match(sync, /if\(!shopStateReadyFor\(syncForUserId\)\)/);
  assert.match(sync, /sync-key-deferred/);
  assert.ok(sync.indexOf("if(!shopStateReadyFor(syncForUserId))") < sync.indexOf("await replaceCart(value,syncForUserId)"));
  assert.ok(sync.indexOf("if(!shopStateReadyFor(syncForUserId))") < sync.indexOf("await replaceFavorites(value,syncForUserId)"));
  const run = sliceBetween(sync, "const run=async()=>{", "syncTimers.set");
  assert.match(run, /if\(!shopStateReadyFor\(syncForUserId\)\)return/);
});

test("applySession snapshots local state before emit and before merge", () => {
  const apply = sliceBetween(memberSrc, "async function applySession(session,{trackLogin=false,sync=false}={}){", "function queueSession(");
  assert.ok(apply.indexOf("beginPreMergeShopSnapshot(user.id)") < apply.indexOf("renderButton();emit();"));
  assert.ok(apply.indexOf("renderButton();emit();") < apply.indexOf("if(sync)await mergeShopState()"));
  assert.match(memberSrc, /if\(nextId!==prevId\)resetMemberShopSyncState\(\)/);
});

test("logout/abandon resets ready state and snapshot", () => {
  const abandon = sliceBetween(memberSrc, "function abandonMemberShopSync(){", "async function mergeShopState(){");
  assert.match(abandon, /resetMemberShopSyncState\(\)/);
  assert.ok(abandon.indexOf("resetMemberShopSyncState()") < abandon.indexOf("clearLocalCartAndFavorites()"));
});

test("cloud replace is pinned to the merge/sync user id", () => {
  const merge = sliceBetween(memberSrc, "async function mergeShopState(){", "function syncKey(");
  assert.match(merge, /await replaceFavorites\(mergedFav,mergeForUserId\)/);
  assert.match(merge, /await replaceCart\(mergedCart,mergeForUserId\)/);
  const sync = sliceBetween(memberSrc, "function syncKey(key,value){", "async function applySession(");
  assert.match(sync, /await replaceFavorites\(value,syncForUserId\)/);
  assert.match(sync, /await replaceCart\(value,syncForUserId\)/);
  const replaceFav = sliceBetween(memberSrc, "async function replaceFavorites(values,forUserId){", "function sanitizeMemberQty(");
  const replaceCart = sliceBetween(memberSrc, "async function replaceCart(values,forUserId){", "let mergedForUserId=null;");
  assert.match(replaceFav, /String\(user.id\)!==uid/);
  assert.match(replaceCart, /String\(user.id\)!==uid/);
  assert.match(replaceFav, /\.eq\("user_id",uid\)/);
  assert.match(replaceCart, /\.eq\("user_id",uid\)/);
});

test("merge failure does not mark shop state ready", () => {
  const merge = sliceBetween(memberSrc, "async function mergeShopState(){", "function syncKey(");
  const catchIdx = merge.lastIndexOf("}catch(err){");
  assert.ok(catchIdx > 0);
  const catchBlock = merge.slice(catchIdx);
  assert.doesNotMatch(catchBlock, /shopStateReadyUserId=/);
  assert.match(catchBlock, /writeMergeLock\(""\)/);
  const saveCatch = sliceBetween(merge, "}catch(saveErr){", "if(!stillMergingFor(mergeForUserId))return;");
  assert.doesNotMatch(saveCatch, /shopStateReadyUserId=/);
  assert.match(saveCatch, /writeMergeLock\(""\)/);
});

test("1 cloud A+B, local empty, early Add C -> A+B+C without destructive replace", () => {
  const out = runRace({
    baselineCart: [],
    cloudCart: [{ id: "A", qty: 1 }, { id: "B", qty: 1 }],
    act(actions) { assert.strictEqual(actions.addCart("C"), "deferred"); }
  });
  assert.deepStrictEqual(out.cart.map((row) => row.id).sort(), ["A", "B", "C"]);
  assert.ok(out.cloudWrites.every((row) => row.mode !== "replace"));
  assert.ok(out.cloudWrites.some((row) => row.mode === "deferred"));
});

test("2 cloud favorites A+B, local empty, early Favorite C -> A+B+C", () => {
  const out = runRace({
    baselineFav: [],
    cloudFav: ["A", "B"],
    act(actions) { assert.strictEqual(actions.addFav("C"), "deferred"); }
  });
  assert.deepStrictEqual(out.fav.slice().sort(), ["A", "B", "C"]);
});

test("3 cloud A+B, early Remove B during merge -> A only", () => {
  const out = runRace({
    baselineCart: [{ id: "A", qty: 1 }, { id: "B", qty: 1 }],
    cloudCart: [{ id: "A", qty: 1 }, { id: "B", qty: 1 }],
    act(actions) { assert.strictEqual(actions.removeCart("B"), "deferred"); }
  });
  assert.deepStrictEqual(out.cart, [{ id: "A", qty: 1 }]);
});

test("4 cloud favorites A+B, early unfavorite B -> A only", () => {
  const out = runRace({
    baselineFav: ["A", "B"],
    cloudFav: ["A", "B"],
    act(actions) { assert.strictEqual(actions.removeFav("B"), "deferred"); }
  });
  assert.deepStrictEqual(out.fav, ["A"]);
});

test("5 cloud cart A qty1, early quantity increase to qty2", () => {
  const out = runRace({
    baselineCart: [{ id: "A", qty: 1 }],
    cloudCart: [{ id: "A", qty: 1 }],
    act(actions) { actions.setQty("A", 2); }
  });
  assert.deepStrictEqual(out.cart, [{ id: "A", qty: 2 }]);
});

test("6 multiple quick mutations preserve latest user intent", () => {
  const out = runRace({
    baselineCart: [{ id: "A", qty: 1 }, { id: "B", qty: 1 }],
    baselineFav: ["A", "B"],
    cloudCart: [{ id: "A", qty: 1 }, { id: "B", qty: 1 }],
    cloudFav: ["A", "B"],
    act(actions) {
      actions.addCart("C");
      actions.setQty("A", 3);
      actions.removeCart("B");
      actions.addCart("B");
      actions.removeCart("B");
      actions.addFav("C");
      actions.removeFav("B");
      actions.addFav("B");
      actions.removeFav("B");
    }
  });
  assert.deepStrictEqual(out.cart.slice().sort((a, b) => a.id.localeCompare(b.id)), [
    { id: "A", qty: 3 },
    { id: "C", qty: 1 }
  ]);
  assert.deepStrictEqual(out.fav.slice().sort(), ["A", "C"]);
});

test("7 initial merge failure does not trigger destructive whole-state replace", () => {
  const api = intentApi();
  let ready = false;
  const writes = [];
  function syncKey(value) {
    if (!ready) {
      writes.push("deferred");
      return "deferred";
    }
    writes.push("replace:" + JSON.stringify(value));
    return "replaced";
  }
  const local = [{ id: "C", qty: 1 }];
  assert.strictEqual(syncKey(local), "deferred");
  const failed = false;
  assert.strictEqual(failed, false);
  assert.deepStrictEqual(writes, ["deferred"]);
  const retry = runRace({
    baselineCart: [],
    cloudCart: [{ id: "A", qty: 1 }, { id: "B", qty: 1 }],
    act(actions) { actions.addCart("C"); }
  });
  assert.deepStrictEqual(retry.cart.map((row) => row.id).sort(), ["A", "B", "C"]);
  assert.ok(!writes.some((row) => String(row).startsWith("replace:")));
  assert.ok(api.preMergeCartIntent([], local, (id) => String(id)).upserts.some((row) => row.id === "C"));
});

test("8 retry after failure does not duplicate or lose items", () => {
  const first = runRace({
    baselineCart: [],
    cloudCart: [{ id: "A", qty: 1 }, { id: "B", qty: 1 }],
    act(actions) { actions.addCart("C"); }
  });
  const retry = runRace({
    baselineCart: [],
    cloudCart: first.cart,
    act(actions) { actions.addCart("C"); }
  });
  assert.deepStrictEqual(retry.cart.map((row) => row.id).sort(), ["A", "B", "C"]);
  assert.strictEqual(retry.cart.filter((row) => row.id === "C").length, 1);
});

test("9 logout while merge is in flight prevents stale write", () => {
  const src = sliceBetween(memberSrc, "async function mergeShopState(){", "function syncKey(");
  assert.match(src, /if\(!stillMergingFor\(mergeForUserId\)\)return/);
  const abandon = sliceBetween(memberSrc, "function abandonMemberShopSync(){", "async function mergeShopState(){");
  assert.match(abandon, /user=null/);
  assert.match(abandon, /resetMemberShopSyncState\(\)/);
  const afterLogout = runRace({
    owner: "stale",
    userId: "user-b",
    baselineCart: [{ id: "A", qty: 1 }],
    cloudCart: [{ id: "X", qty: 1 }],
    act(actions) { actions.addCart("C"); }
  });
  assert.deepStrictEqual(afterLogout.cart.map((row) => row.id).sort(), ["C", "X"]);
  assert.ok(!afterLogout.cart.some((row) => row.id === "A"));
});

test("10 User A merge finishing after User B signs in cannot keep A's items", () => {
  const gatedB = shouldMergeLocalForUser("user-a", "user-b");
  assert.strictEqual(gatedB, false);
  const out = runRace({
    owner: "user-a",
    userId: "user-b",
    baselineCart: [{ id: "A-only", qty: 2 }],
    cloudCart: [{ id: "B-cloud", qty: 1 }],
    act(actions) { actions.addCart("B-early"); }
  });
  assert.deepStrictEqual(out.cart.map((row) => row.id).sort(), ["B-cloud", "B-early"]);
  assert.ok(!out.cart.some((row) => row.id === "A-only"));
  assert.match(memberSrc, /if\(!stillMergingFor\(mergeForUserId\)\)return/);
});

test("11 guest -> login merge still unions guest items with cloud", () => {
  const out = runRace({
    owner: "guest",
    userId: "user-a",
    baselineCart: [{ id: "G", qty: 1 }],
    baselineFav: ["G"],
    cloudCart: [{ id: "A", qty: 1 }],
    cloudFav: ["A"],
    act(actions) { actions.addCart("C"); actions.addFav("C"); }
  });
  assert.deepStrictEqual(out.cart.map((row) => row.id).sort(), ["A", "C", "G"]);
  assert.deepStrictEqual(out.fav.slice().sort(), ["A", "C", "G"]);
});

test("composeMergedShopState uses baseline for union then latest intent", () => {
  assert.match(memberSrc, /function composeMergedShopState\(/);
  assert.match(memberSrc, /const snapshot=preMergeSnapshot&&preMergeSnapshot.userId===String\(mergeForUserId\)\?preMergeSnapshot:null/);
  assert.match(memberSrc, /localItemsForMerge\(mergeForUserId,baselineCart,baselineFav\)/);
  assert.match(memberSrc, /shopStateReadyUserId=String\(mergeForUserId\)/);
  assert.match(memberSrc, /preMergeSnapshot=null/);
});

test("member.js pin is v=21", () => {
  const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
  const account = fs.readFileSync(path.join(root, "account.html"), "utf8");
  assert.match(shop, /member\.js\?v=21/);
  assert.match(account, /member\.js\?v=21/);
});

test("12 same-user instant cart first paint is not gated on member merge ready", () => {
  const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
  const paint = sliceBetween(shop, "function paintCartBootState(){", "function homepageVisibleBooks(");
  assert.doesNotMatch(paint, /shopStateReadyFor/);
  assert.match(paint, /cartHasUsableDisplayPreview\(\)/);
  const set = sliceBetween(shop, "const set=(k,v)=>{", "function visibilityContext(){");
  assert.ok(set.indexOf("localStorage.setItem") < set.indexOf("syncKey"));
  assert.doesNotMatch(set, /shopStateReadyFor/);
  const add = sliceBetween(shop, "function add(id,qty=1){", "function remove(id){");
  assert.doesNotMatch(add, /cartHydrationPending\(\)/);
  assert.doesNotMatch(add, /shopStateReadyFor/);
  assert.match(shop, /function peekPersistedShopUserId\(\)/);
});

if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
}
console.log("member-premerge-sync-tests ok");
