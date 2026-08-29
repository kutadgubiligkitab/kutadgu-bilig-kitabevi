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

test("A/H empty cart: zero lines and cartHas is false",()=>{
  const lookup=id=>Legacy.lookupBook(id,{staticBooks:[{id:"children-3",title:"c3"}]});
  assert.deepStrictEqual(Legacy.visibleCartLines([],lookup),[]);
  assert.strictEqual(Legacy.cartHasBook([],"children-3",lookup),false);
  assert.strictEqual(Legacy.cartHasBook([],"102",lookup),false);
});

test("B/G bigint cart row stays visible via alias when live cache was cleared",()=>{
  const staticBooks=[{id:"children-3",title:"بالىلار كىتابى 3"},{id:"children-4",title:"بالىلار كىتابى 4"}];
  const aliases=Legacy.rememberBookAliases({id:"102",legacyId:"children-3"},{});
  Object.assign(aliases,Legacy.rememberBookAliases({id:"103",legacyId:"children-4"},aliases));
  const lookup=id=>Legacy.lookupBook(id,{staticBooks,aliases});
  const lines=Legacy.visibleCartLines([{id:"102",qty:1}],lookup);
  assert.strictEqual(lines.length,1);
  assert.strictEqual(lines[0].qty,1);
  assert.ok(lines[0].book);
  assert.strictEqual(lines[0].book.title,"بالىلار كىتابى 3");
  assert.strictEqual(Legacy.cartHasBook([{id:"102",qty:1}],"children-3",lookup),true);
  assert.strictEqual(Legacy.cartHasBook([{id:"102",qty:1}],"children-4",lookup),false);
});

test("D both children-3 and children-4 resolve identically as slug or bigint",()=>{
  const remote3={id:"102",legacyId:"children-3",title:"c3"};
  const remote4={id:"103",legacyId:"children-4",title:"c4"};
  const cache=new Map([["102",remote3],["children-3",remote3],["103",remote4],["children-4",remote4]]);
  const lookup=id=>Legacy.lookupBook(id,{cache});
  assert.strictEqual(lookup("children-3").id,lookup("102").id);
  assert.strictEqual(lookup("children-4").id,lookup("103").id);
  const lines=Legacy.visibleCartLines([{id:"children-3",qty:1},{id:"103",qty:1}],lookup);
  assert.strictEqual(lines.length,2);
  assert.deepStrictEqual(lines.map(x=>x.id).sort(),["102","103"]);
  assert.strictEqual(Legacy.cartHasBook(lines,"102",lookup),true);
  assert.strictEqual(Legacy.cartHasBook(lines,"children-4",lookup),true);
});

test("badge count matches visible cart lines including unresolved ids",()=>{
  const lookup=()=>null;
  const lines=Legacy.visibleCartLines([{id:"102",qty:1},{id:"103",qty:1}],lookup);
  assert.strictEqual(lines.length,2);
  assert.strictEqual(lines.reduce((s,x)=>s+x.qty,0),2);
  assert.ok(lines.every(line=>line.book==null));
});

const aliasMap={"102":"children-3","children-3":"102","103":"children-4","children-4":"103"};

test("A polluted local children-3 qty99 + 102 qty1 collapses to safe qty not 100",()=>{
  const out=Legacy.repairCapPollutedCartItems(
    [{id:"children-3",qty:99},{id:"102",qty:1}],
    resolve,
    aliasMap
  );
  assert.deepStrictEqual(out,[{id:"102",qty:1}]);
  assert.strictEqual(out.reduce((s,x)=>s+x.qty,0),1);
});

test("B polluted cloud children-3 qty99 + 102 qty1 repairs once and is idempotent",()=>{
  const cloud=[{id:"children-3",qty:99},{id:"102",qty:1}];
  const first=Legacy.repairCapPollutedCartItems(cloud,resolve,aliasMap);
  const login=Legacy.repairCapPollutedCartItems(
    [...first,...cloud],
    resolve,
    aliasMap
  );
  assert.deepStrictEqual(login,[{id:"102",qty:1}]);
  const again=Legacy.repairCapPollutedCartItems(login,resolve,aliasMap);
  assert.deepStrictEqual(again,[{id:"102",qty:1}]);
});

test("C favorites children-3 + 102 become one favorite",()=>{
  const fav=Legacy.mergeGuestAndCloudFavs(["children-3"],["102"],resolve);
  assert.deepStrictEqual(fav,["102"]);
});

test("D remove canonical item removes all aliases local+cloud leftover",()=>{
  const local=[{id:"102",qty:1},{id:"79",qty:2}];
  const cloud=[{id:"children-3",qty:99},{id:"79",qty:2}];
  const afterLocal=Legacy.filterCartRemovingBook(local,"102",resolve,aliasMap);
  const afterCloud=Legacy.filterCartRemovingBook(cloud,"children-3",resolve,aliasMap);
  assert.deepStrictEqual(afterLocal,[{id:"79",qty:2}]);
  assert.deepStrictEqual(afterCloud,[{id:"79",qty:2}]);
  const leftoverMerge=Legacy.repairCapPollutedCartItems([...afterLocal,...afterCloud],resolve,aliasMap);
  assert.deepStrictEqual(leftoverMerge,[{id:"79",qty:2}]);
  const fav=Legacy.filterFavsRemovingBook(["102","children-3","79"],"102",resolve,aliasMap);
  assert.deepStrictEqual(fav,["79"]);
});

test("E refresh x5 after repair does not resurrect aliases",()=>{
  let cart=Legacy.repairCapPollutedCartItems([{id:"children-3",qty:99},{id:"102",qty:99}],resolve,aliasMap);
  let fav=Legacy.migrateIdList(["children-3","102"],resolve);
  for(let i=0;i<5;i++){
    cart=Legacy.repairCapPollutedCartItems(cart,resolve,aliasMap);
    fav=Legacy.migrateIdList(fav,resolve);
  }
  assert.deepStrictEqual(cart,[{id:"102",qty:1}]);
  assert.deepStrictEqual(fav,["102"]);
});

test("F logout/login merge of repaired empty book does not return children-3",()=>{
  const local=[];
  const cloud=[];
  const login=Legacy.mergeGuestAndCloudCart(local,cloud,resolve);
  assert.deepStrictEqual(login,[]);
});

test("G two tabs do not multiply repaired qty",()=>{
  const tabA=[{id:"102",qty:1}];
  const tabB=[{id:"children-3",qty:1}];
  const a=Legacy.repairCapPollutedCartItems([...tabA,...tabB],resolve,aliasMap);
  const b=Legacy.repairCapPollutedCartItems([...a,...tabA],resolve,aliasMap);
  assert.deepStrictEqual(b,[{id:"102",qty:1}]);
});

test("H children-3 and children-4 qty1 each → badge 2 not 198",()=>{
  const cart=Legacy.repairCapPollutedCartItems(
    [{id:"children-3",qty:1},{id:"children-4",qty:1}],
    resolve,
    aliasMap
  );
  assert.strictEqual(cart.length,2);
  assert.deepStrictEqual(cart.map(x=>x.id).sort(),["102","103"]);
  assert.strictEqual(cart.reduce((s,x)=>s+x.qty,0),2);
  const polluted=Legacy.repairCapPollutedCartItems(
    [{id:"children-3",qty:99},{id:"children-4",qty:99}],
    resolve,
    aliasMap
  );
  assert.strictEqual(polluted.reduce((s,x)=>s+x.qty,0),2);
});

test("I clean unrelated cart items are preserved",()=>{
  const out=Legacy.repairCapPollutedCartItems(
    [{id:"children-3",qty:99},{id:"102",qty:1},{id:"79",qty:4}],
    resolve,
    aliasMap
  );
  const extra=out.find(x=>x.id==="79");
  assert.deepStrictEqual(extra,{id:"79",qty:4});
});

test("J clean legitimate qty >1 is preserved",()=>{
  const out=Legacy.repairCapPollutedCartItems([{id:"79",qty:3},{id:"102",qty:5}],resolve,aliasMap);
  assert.deepStrictEqual(out.find(x=>x.id==="79"),{id:"79",qty:3});
  assert.deepStrictEqual(out.find(x=>x.id==="102"),{id:"102",qty:5});
});

test("solo dual-identity cap 99 repairs to 1 then stays 1",()=>{
  const first=Legacy.repairCapPollutedCartItems([{id:"102",qty:99}],resolve,aliasMap);
  assert.deepStrictEqual(first,[{id:"102",qty:1}]);
  const second=Legacy.repairCapPollutedCartItems(first,resolve,aliasMap);
  assert.deepStrictEqual(second,[{id:"102",qty:1}]);
});


if(failed){
  console.error("\n"+failed+" test(s) failed");
  process.exit(1);
}
console.log("\nAll P0 cart/favorites identity tests passed");
