#!/usr/bin/env node
"use strict";
const assert=require("assert");
const Legacy=require("../legacy-id-utils.js");

let failed=0;
function test(name,fn){
  try{fn();console.log("PASS",name)}
  catch(err){failed++;console.error("FAIL",name,err.message)}
}

const books=[
  {id:"102",legacyId:"children-3",title:"children-3"},
  {id:"103",legacyId:"children-4",title:"children-4"},
  {id:"79",legacyId:"children-1",title:"children-1"}
];
const resolve=id=>{
  const hit=books.find(b=>b.id===String(id)||b.legacyId===String(id));
  return hit?hit.id:String(id);
};

function refreshN(cart,fav,n){
  let c=cart,f=fav;
  for(let i=0;i<n;i++){
    c=Legacy.migrateCartItems(c,resolve);
    f=Legacy.migrateIdList(f,resolve);
  }
  return {cart:c,fav:f};
}

test("A empty cart+favorites refresh 5x never invents children-3/4",()=>{
  const out=refreshN([],[],5);
  assert.deepStrictEqual(out.cart,[]);
  assert.deepStrictEqual(out.fav,[]);
  const merged=Legacy.mergeGuestAndCloudCart([],[],resolve);
  const mergedFav=Legacy.mergeGuestAndCloudFavs([],[],resolve);
  assert.deepStrictEqual(merged,[]);
  assert.deepStrictEqual(mergedFav,[]);
});

test("B add children-3 qty 1, refresh 5x stays 1",()=>{
  let cart=[{id:"children-3",qty:1}];
  const out=refreshN(cart,[],5);
  assert.deepStrictEqual(out.cart,[{id:"102",qty:1}]);
  assert.ok(!out.cart.some(x=>x.id==="103"));
});

test("C children-3 qty 3 survives refresh",()=>{
  const out=refreshN([{id:"102",qty:3}],[],1);
  assert.deepStrictEqual(out.cart,[{id:"102",qty:3}]);
});

test("D children-4 stays absent",()=>{
  const out=refreshN([{id:"children-3",qty:1}],[],5);
  assert.strictEqual(out.cart.length,1);
  assert.strictEqual(out.cart[0].id,"102");
  assert.ok(!JSON.stringify(out).includes("103"));
  assert.ok(!out.cart.some(x=>x.id==="children-4"));
});

test("E favorite children-3 only, refresh, exactly one",()=>{
  const out=refreshN([],["children-3"],3);
  assert.deepStrictEqual(out.fav,["102"]);
});

test("F login merge empty does not auto-add; alias pair does not multiply qty",()=>{
  const empty=Legacy.mergeGuestAndCloudCart([],[],resolve);
  assert.deepStrictEqual(empty,[]);
  const once=Legacy.mergeGuestAndCloudCart([{id:"102",qty:1}],[{id:"children-3",qty:1}],resolve);
  assert.deepStrictEqual(once,[{id:"102",qty:1}]);
  const twice=Legacy.mergeGuestAndCloudCart(once,once,resolve);
  assert.deepStrictEqual(twice,[{id:"102",qty:1}]);
  const fav=Legacy.mergeGuestAndCloudFavs([],[],resolve);
  assert.deepStrictEqual(fav,[]);
});

test("G logout/login re-merge does not invent or multiply",()=>{
  const local=[{id:"102",qty:1}];
  const cloud=[{id:"102",qty:1}];
  const login=Legacy.mergeGuestAndCloudCart(local,cloud,resolve);
  const login2=Legacy.mergeGuestAndCloudCart(login,login,resolve);
  assert.deepStrictEqual(login2,[{id:"102",qty:1}]);
  const fav=Legacy.mergeGuestAndCloudFavs(["102"],["children-3"],resolve);
  assert.deepStrictEqual(fav,["102"]);
});

test("H legacy_id + bigint collapse to one canonical entry",()=>{
  const cart=Legacy.migrateCartItems([{id:"children-3",qty:1},{id:"102",qty:1},{id:"102",qty:1}],resolve);
  assert.deepStrictEqual(cart,[{id:"102",qty:1}]);
  const fav=Legacy.migrateIdList(["children-3","102","children-3"],resolve);
  assert.deepStrictEqual(fav,["102"]);
});

test("I corrupt quantities sanitize deterministically",()=>{
  assert.strictEqual(Legacy.sanitizeCartQty("99"),99);
  assert.strictEqual(Legacy.sanitizeCartQty(99),99);
  assert.strictEqual(Legacy.sanitizeCartQty(-1),1);
  assert.strictEqual(Legacy.sanitizeCartQty("abc"),1);
  assert.strictEqual(Legacy.sanitizeCartQty(null),1);
  assert.strictEqual(Legacy.sanitizeCartQty(undefined),1);
  assert.strictEqual(Legacy.sanitizeCartQty(""),1);
  assert.strictEqual(Legacy.sanitizeCartQty("0"),1);
  const migrated=Legacy.migrateCartItems([
    {id:"102",qty:"abc"},
    {id:"102",qty:null},
    {id:"102",qty:-1}
  ],resolve);
  assert.deepStrictEqual(migrated,[{id:"102",qty:1}]);
});

test("I-2 duplicate alias with cap 99 keeps real qty, does not sum to 99",()=>{
  const out=Legacy.migrateCartItems([
    {id:"children-3",qty:1},
    {id:"102",qty:99}
  ],resolve);
  assert.deepStrictEqual(out,[{id:"102",qty:1}]);
  const summedWouldBe=Legacy.mergeGuestAndCloudCart(
    [{id:"children-3",qty:2}],
    [{id:"102",qty:2}],
    resolve
  );
  assert.deepStrictEqual(summedWouldBe,[{id:"102",qty:2}]);
});

test("J two-tab merge of same snapshot does not multiply",()=>{
  const tabA=[{id:"102",qty:3}];
  const tabB=[{id:"children-3",qty:3}];
  const a=Legacy.mergeGuestAndCloudCart(tabA,tabB,resolve);
  const b=Legacy.mergeGuestAndCloudCart(a,tabA,resolve);
  const c=Legacy.mergeGuestAndCloudCart(b,tabB,resolve);
  assert.deepStrictEqual(c,[{id:"102",qty:3}]);
});

test("K removed children-3 stays gone when absent from both stores",()=>{
  const cart=Legacy.mergeGuestAndCloudCart([],[],resolve);
  const fav=Legacy.mergeGuestAndCloudFavs([],[],resolve);
  assert.ok(!cart.some(x=>x.id==="102"||x.id==="children-3"));
  assert.ok(!fav.includes("102")&&!fav.includes("children-3"));
  const leftoverAlias=Legacy.mergeGuestAndCloudFavs([],["children-3"],resolve);
  assert.deepStrictEqual(leftoverAlias,["102"]);
});

test("never seeds children-3/4 on identity migration of unrelated cart",()=>{
  const out=Legacy.migrateCartItems([{id:"79",qty:1}],resolve);
  assert.deepStrictEqual(out,[{id:"79",qty:1}]);
});

test("repeated migrateCartItems is idempotent",()=>{
  const first=Legacy.migrateCartItems([{id:"children-3",qty:2},{id:"102",qty:2}],resolve);
  const second=Legacy.migrateCartItems(first,resolve);
  const third=Legacy.migrateCartItems(second,resolve);
  assert.deepStrictEqual(first,second);
  assert.deepStrictEqual(second,third);
});

if(failed){
  console.error("\n"+failed+" test(s) failed");
  process.exit(1);
}
console.log("\nAll P0 cart/favorites identity tests passed");
