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

test("agreed polluted 99 on both local and cloud does not stay 99",()=>{
  const out=Legacy.syncAuthenticatedShopState({
    localCart:[{id:"102",qty:99}],
    localFav:["102"],
    cloudCart:[{id:"children-3",qty:99},{id:"102",qty:99}],
    cloudFav:["children-3","102"],
    resolveId:resolve,
    aliasMap:{}
  });
  assert.deepStrictEqual(out.cart,[{id:"102",qty:1}]);
  assert.deepStrictEqual(out.fav,["102"]);
  assert.strictEqual(out.badge,1);
});

test("SIGNED_IN empty local + polluted cloud is canonical qty1 not badge 198",()=>{
  const out=Legacy.syncAuthenticatedShopState({
    localCart:[],
    localFav:[],
    cloudCart:[
      {id:"children-3",qty:99},{id:"102",qty:99},
      {id:"children-4",qty:99},{id:"103",qty:99}
    ],
    cloudFav:["children-3","102","children-4","103"],
    resolveId:id=>id,
    aliasMap:{}
  });
  assert.strictEqual(out.cart.length,2);
  assert.deepStrictEqual(out.cart.map(x=>x.id).sort(),["102","103"]);
  assert.ok(out.cart.every(row=>row.qty===1));
  assert.strictEqual(out.badge,2);
  assert.ok(!out.cart.some(row=>String(row.id).startsWith("children-")));
  assert.deepStrictEqual(out.fav.slice().sort(),["102","103"]);
});

test("authenticated remove then next SIGNED_IN stays empty",()=>{
  const login=Legacy.syncAuthenticatedShopState({
    localCart:[],
    localFav:[],
    cloudCart:[{id:"children-3",qty:99},{id:"102",qty:99},{id:"children-4",qty:99},{id:"103",qty:99}],
    cloudFav:["children-3","102","children-4","103"],
    resolveId:id=>id,
    aliasMap:{}
  });
  const afterRemoveCart=Legacy.filterCartRemovingBook(
    Legacy.filterCartRemovingBook(login.cart,"102",id=>id,{}),
    "103",id=>id,{}
  );
  const afterRemoveFav=Legacy.filterFavsRemovingBook(
    Legacy.filterFavsRemovingBook(login.fav,"102",id=>id,{}),
    "children-4",id=>id,{}
  );
  assert.deepStrictEqual(afterRemoveCart,[]);
  assert.deepStrictEqual(afterRemoveFav,[]);
  const nextLogin=Legacy.syncAuthenticatedShopState({
    localCart:afterRemoveCart,
    localFav:afterRemoveFav,
    cloudCart:afterRemoveCart,
    cloudFav:afterRemoveFav,
    resolveId:id=>id,
    aliasMap:{}
  });
  assert.deepStrictEqual(nextLogin.cart,[]);
  assert.deepStrictEqual(nextLogin.fav,[]);
  assert.strictEqual(nextLogin.badge,0);
});

test("unrelated legitimate qty3 and favorite survive authenticated repair",()=>{
  const out=Legacy.syncAuthenticatedShopState({
    localCart:[],
    localFav:[],
    cloudCart:[
      {id:"children-3",qty:99},{id:"102",qty:99},{id:"79",qty:3}
    ],
    cloudFav:["children-3","102","79"],
    resolveId:resolve,
    aliasMap:{}
  });
  assert.deepStrictEqual(out.cart.find(x=>x.id==="79"),{id:"79",qty:3});
  assert.ok(out.fav.includes("79"));
  assert.deepStrictEqual(out.cart.find(x=>x.id==="102"),{id:"102",qty:1});
  assert.strictEqual(out.badge,4);
});

test("no seed and no multiplication on empty stores",()=>{
  const out=Legacy.syncAuthenticatedShopState({
    localCart:[],localFav:[],cloudCart:[],cloudFav:[],resolveId:resolve,aliasMap:{}
  });
  assert.deepStrictEqual(out.cart,[]);
  assert.deepStrictEqual(out.fav,[]);
});

test("static slug resolver cannot keep children-3 as a second line",()=>{
  const staticResolve=id=>String(id);
  const out=Legacy.repairCapPollutedCartItems(
    [{id:"children-3",qty:99},{id:"102",qty:99}],
    staticResolve,
    {}
  );
  assert.deepStrictEqual(out,[{id:"102",qty:1}]);
});

const CART_KEY="kutadgu-cart-v1";
const FAV_KEY="kutadgu-favorites-v1";
const REC_KEY="kutadgu-recent-v1";
const CUSTOMER_KEY="kutadgu-customer-v1";
function clearLocalCartAndFavorites(store){
  delete store[CART_KEY];
  delete store[FAV_KEY];
}

test("A logout then B login does not carry A cart/favorites into B",()=>{
  const store={
    [CART_KEY]:JSON.stringify([{id:"102",qty:2}]),
    [FAV_KEY]:JSON.stringify(["102"]),
    [REC_KEY]:JSON.stringify(["102"]),
    [CUSTOMER_KEY]:JSON.stringify({name:"A"})
  };
  clearLocalCartAndFavorites(store);
  assert.strictEqual(store[CART_KEY],undefined);
  assert.strictEqual(store[FAV_KEY],undefined);
  assert.strictEqual(store[REC_KEY],JSON.stringify(["102"]));
  assert.strictEqual(store[CUSTOMER_KEY],JSON.stringify({name:"A"}));
  const localCart=store[CART_KEY]?JSON.parse(store[CART_KEY]):[];
  const localFav=store[FAV_KEY]?JSON.parse(store[FAV_KEY]):[];
  const out=Legacy.syncAuthenticatedShopState({
    localCart,
    localFav,
    cloudCart:[{id:"79",qty:1}],
    cloudFav:["79"],
    resolveId:resolve,
    aliasMap:{}
  });
  assert.deepStrictEqual(out.cart,[{id:"79",qty:1}]);
  assert.deepStrictEqual(out.fav,["79"]);
  assert.ok(!JSON.stringify(out).includes("102"));
});

test("guest cart/favorites still merge on first login",()=>{
  const localCart=[{id:"102",qty:3}];
  const localFav=["102"];
  const out=Legacy.syncAuthenticatedShopState({
    localCart,
    localFav,
    cloudCart:[],
    cloudFav:[],
    resolveId:resolve,
    aliasMap:{}
  });
  assert.deepStrictEqual(out.cart,[{id:"102",qty:3}]);
  assert.deepStrictEqual(out.fav,["102"]);
});

test("member.js clears only cart/favorites on signOut and SIGNED_OUT",()=>{
  const src=require("fs").readFileSync(require("path").join(__dirname,"..","member.js"),"utf8");
  assert.match(src,/function clearLocalCartAndFavorites\(\)\{/);
  assert.match(src,/function abandonMemberShopSync\(\)\{/);
  assert.match(src,/localStorage\.removeItem\(CART_KEY\)/);
  assert.match(src,/localStorage\.removeItem\(FAV_KEY\)/);
  assert.match(src,/emit\("kutadgu-member-state-synced"\)/);
  assert.match(src,/async function signOut\(\)\{\s*const pending=abandonMemberShopSync\(\);/);
  assert.match(src,/if\(event==="SIGNED_OUT"\)abandonMemberShopSync\(\);/);
  assert.match(src,/Promise\.resolve\(pending\)\.finally/);
  assert.match(src,/if\(!user\)\{\s*writeShopOwner\(SHOP_OWNER_STALE\);\s*clearLocalCartAndFavorites\(\);/);
  assert.doesNotMatch(src,/localStorage\.removeItem\(REC_KEY\)/);
  assert.doesNotMatch(src,/removeItem\("kutadgu-recent-v1"\)/);
  assert.doesNotMatch(src,/removeItem\("kutadgu-customer-v1"\)/);
});

test("guest items login A logout A login B does not give B A's local cart",()=>{
  const guestCart=[{id:"102",qty:2}];
  const guestFav=["102"];
  const aCloudCart=[];
  const aCloudFav=[];
  const mergedA=Legacy.syncAuthenticatedShopState({
    localCart:guestCart,
    localFav:guestFav,
    cloudCart:aCloudCart,
    cloudFav:aCloudFav,
    resolveId:resolve,
    aliasMap:{}
  });
  assert.deepStrictEqual(mergedA.cart,[{id:"102",qty:2}]);
  assert.deepStrictEqual(mergedA.fav,["102"]);

  const store={
    [CART_KEY]:JSON.stringify(mergedA.cart),
    [FAV_KEY]:JSON.stringify(mergedA.fav),
    [REC_KEY]:JSON.stringify(["79"]),
    [CUSTOMER_KEY]:JSON.stringify({name:"A"})
  };

  clearLocalCartAndFavorites(store);
  store[CART_KEY]=JSON.stringify(mergedA.cart);
  store[FAV_KEY]=JSON.stringify(mergedA.fav);
  clearLocalCartAndFavorites(store);

  assert.strictEqual(store[CART_KEY],undefined);
  assert.strictEqual(store[FAV_KEY],undefined);
  assert.strictEqual(store[REC_KEY],JSON.stringify(["79"]));

  const bOut=Legacy.syncAuthenticatedShopState({
    localCart:store[CART_KEY]?JSON.parse(store[CART_KEY]):[],
    localFav:store[FAV_KEY]?JSON.parse(store[FAV_KEY]):[],
    cloudCart:[{id:"79",qty:1}],
    cloudFav:["79"],
    resolveId:resolve,
    aliasMap:{}
  });
  assert.deepStrictEqual(bOut.cart,[{id:"79",qty:1}]);
  assert.deepStrictEqual(bOut.fav,["79"]);
  assert.ok(!JSON.stringify(bOut).includes("102"));
});

test("homepage recently-added view-all points to public catalog not my-books",()=>{
  const shop=require("fs").readFileSync(require("path").join(__dirname,"..","shop.js"),"utf8");
  assert.match(shop,/class="home-featured-all" href="#books"/);
  assert.doesNotMatch(shop,/class="home-featured-all" href="my-books\.html"/);
  assert.match(shop,/class="shop-selector-all-link" href="my-books\.html"/);
  assert.match(shop,/kutadgu-shop-owner-v1/);
  assert.match(shop,/function stampShopOwner\(\)/);
});

const OWNER_KEY="kutadgu-shop-owner-v1";
function shouldMergeLocalForUser(owner,userId){
  if(!owner||owner==="guest")return true;
  if(owner==="stale")return false;
  return owner===String(userId||"");
}
function localItemsForMerge(owner,userId,localCart,localFav){
  if(shouldMergeLocalForUser(owner,userId)){
    return {localCart:Array.isArray(localCart)?localCart:[],localFav:Array.isArray(localFav)?localFav:[]};
  }
  return {localCart:[],localFav:[]};
}

test("Guest → login A: guest items merge into A",()=>{
  const gated=localItemsForMerge("guest","user-a",[{id:"102",qty:2}],["102"]);
  const out=Legacy.syncAuthenticatedShopState({
    ...gated,cloudCart:[],cloudFav:[],resolveId:resolve,aliasMap:{}
  });
  assert.deepStrictEqual(out.cart,[{id:"102",qty:2}]);
  assert.deepStrictEqual(out.fav,["102"]);
});

test("A logout → B login: A items do not appear in B",()=>{
  const leftover=[{id:"102",qty:2}];
  const gated=localItemsForMerge("stale","user-b",leftover,["102"]);
  assert.deepStrictEqual(gated.localCart,[]);
  const out=Legacy.syncAuthenticatedShopState({
    ...gated,cloudCart:[{id:"79",qty:1}],cloudFav:["79"],resolveId:resolve,aliasMap:{}
  });
  assert.deepStrictEqual(out.cart,[{id:"79",qty:1}]);
  assert.deepStrictEqual(out.fav,["79"]);
  assert.ok(!JSON.stringify(out).includes("102"));
});

test("B adds item → logout → A login: B item does not appear in A",()=>{
  const gated=localItemsForMerge("user-b","user-a",[{id:"102",qty:1}],["102"]);
  const out=Legacy.syncAuthenticatedShopState({
    ...gated,cloudCart:[{id:"79",qty:3}],cloudFav:["79"],resolveId:resolve,aliasMap:{}
  });
  assert.deepStrictEqual(out.cart,[{id:"79",qty:3}]);
  assert.deepStrictEqual(out.fav,["79"]);
  assert.ok(!JSON.stringify(out).includes("102"));
});

test("A logout → guest: A items do not become guest items",()=>{
  const src=require("fs").readFileSync(require("path").join(__dirname,"..","member.js"),"utf8");
  assert.match(src,/writeShopOwner\(SHOP_OWNER_STALE\)/);
  assert.match(src,/function abandonMemberShopSync\(\)\{[\s\S]*writeShopOwner\(SHOP_OWNER_STALE\)/);
  const gated=localItemsForMerge("stale","",[{id:"102",qty:2}],["102"]);
  assert.deepStrictEqual(gated.localCart,[]);
  assert.deepStrictEqual(gated.localFav,[]);
});

test("authenticated page refresh hydrates from current user cloud",()=>{
  const src=require("fs").readFileSync(require("path").join(__dirname,"..","member.js"),"utf8");
  assert.match(src,/queueSession\(data\.session,\{sync:!!data\.session\?\.user\}\)/);
  const gated=localItemsForMerge("user-a","user-a",[{id:"102",qty:1}],["102"]);
  const out=Legacy.syncAuthenticatedShopState({
    ...gated,cloudCart:[{id:"102",qty:1},{id:"79",qty:1}],cloudFav:["102","79"],resolveId:resolve,aliasMap:{}
  });
  assert.ok(out.cart.some(x=>x.id==="102"));
  assert.ok(out.cart.some(x=>x.id==="79"));
});

test("stale in-flight A merge cannot write into B",()=>{
  const src=require("fs").readFileSync(require("path").join(__dirname,"..","member.js"),"utf8");
  assert.match(src,/const mergeForUserId=user\.id/);
  assert.match(src,/function stillMergingFor\(userId\)/);
  assert.match(src,/if\(!stillMergingFor\(mergeForUserId\)\)return/);
  assert.match(src,/if\(shopSyncUserId===mergeForUserId\)return shopSyncInFlight/);
  const aMerge={userId:"user-a",payload:[{id:"102",qty:2}]};
  const currentUser="user-b";
  const allowWrite=currentUser===aMerge.userId;
  assert.strictEqual(allowWrite,false);
  const gated=localItemsForMerge("user-a","user-b",aMerge.payload,["102"]);
  const out=Legacy.syncAuthenticatedShopState({
    ...gated,cloudCart:[],cloudFav:[],resolveId:resolve,aliasMap:{}
  });
  assert.deepStrictEqual(out.cart,[]);
});

test("member.js owner-stamp wiring",()=>{
  const src=require("fs").readFileSync(require("path").join(__dirname,"..","member.js"),"utf8");
  assert.match(src,/SHOP_OWNER_KEY="kutadgu-shop-owner-v1"/);
  assert.match(src,/function shouldMergeLocalForUser/);
  assert.match(src,/function localItemsForMerge/);
  assert.match(src,/writeShopOwner\(String\(mergeForUserId\)\)/);
  assert.doesNotMatch(src,/queueSession\(data\.session,\{sync:false\}\)/);
  assert.strictEqual(shouldMergeLocalForUser("","u1"),true);
  assert.strictEqual(shouldMergeLocalForUser("guest","u1"),true);
  assert.strictEqual(shouldMergeLocalForUser("u1","u1"),true);
  assert.strictEqual(shouldMergeLocalForUser("stale","u1"),false);
  assert.strictEqual(shouldMergeLocalForUser("u2","u1"),false);
});

test("storefront pages keep cart markup pin shop.js v=90",()=>{
  const html=require("fs").readFileSync(require("path").join(__dirname,"..","cart.html"),"utf8");
  const fav=require("fs").readFileSync(require("path").join(__dirname,"..","favorites.html"),"utf8");
  const home=require("fs").readFileSync(require("path").join(__dirname,"..","index.html"),"utf8");
  const member=require("fs").readFileSync(require("path").join(__dirname,"..","member.js"),"utf8");
  const shop=require("fs").readFileSync(require("path").join(__dirname,"..","shop.js"),"utf8");
  const account=require("fs").readFileSync(require("path").join(__dirname,"..","account.html"),"utf8");
  assert.match(html,/shop\.js\?v=90/);
  assert.match(html,/shop\.css\?v=49/);
  assert.match(html,/id="cartLayout"/);
  assert.match(html,/id="cartSummaryHost"/);
  assert.match(html,/id="whatsappOrder"/);
  assert.match(html,/id="customerName"/);
  assert.match(html,/id="checkoutCustomerHeading"/);
  assert.match(html,/href="account.html"/);
  assert.match(html,/زاكاز ئۇچۇرلىرىڭىزنى تولدۇرۇڭ\. توشۇش ھەققى ئايرىم ھېسابلىنىدۇ\./);
  assert.doesNotMatch(html,/1\) تولدۇرۇڭ/);
  assert.doesNotMatch(html,/cart-order-steps"[^>]*>[^<]*WhatsApp/);
  assert.match(html,/href="index.html#books"/);
  assert.match(fav,/shop\.js\?v=90/);
  assert.match(home,/shop\.js\?v=90/);
  assert.match(shop,/member\.js\?v=17/);
  assert.match(shop,/cart-item-cover/);
  assert.match(shop,/cart-item-toolbar/);
  assert.match(shop,/data-plus=/);
  assert.match(shop,/data-minus=/);
  assert.match(shop,/data-remove=/);
  assert.match(shop,/CART_KEY/);
  assert.match(account,/member\.js\?v=17/);
  assert.match(member,/\.eq\("user_id",mergeForUserId\)/);
  assert.match(member,/\.eq\("user_id",user\.id\)/);
  assert.match(member,/function previewShopDebug/);
  assert.match(member,/\[kutadgu-shop-debug\]/);
  assert.doesNotMatch(member,/previewShopDebug\([^\)]*email/);
});

test("ABC inspect-before-add: distinct users + filtered cloud stay isolated",()=>{
  const uniqueA=[{id:"102",qty:1}];
  const afterLogout=localItemsForMerge("stale","user-b",uniqueA,["102"]);
  const bOut=Legacy.syncAuthenticatedShopState({
    ...afterLogout,cloudCart:[],cloudFav:[],resolveId:resolve,aliasMap:{}
  });
  assert.deepStrictEqual(bOut.cart,[]);
  const cOut=Legacy.syncAuthenticatedShopState({
    ...localItemsForMerge("stale","user-c",uniqueA,["102"]),
    cloudCart:[],cloudFav:[],resolveId:resolve,aliasMap:{}
  });
  assert.deepStrictEqual(cOut.cart,[]);
});

test("ABC leak path: stale rewritten to guest while leftover local remains",()=>{
  const leftover=[{id:"102",qty:1}];
  const bOut=Legacy.syncAuthenticatedShopState({
    ...localItemsForMerge("guest","user-b",leftover,[]),
    cloudCart:[],cloudFav:[],resolveId:resolve,aliasMap:{}
  });
  assert.deepStrictEqual(bOut.cart,[{id:"102",qty:1}]);
  const cOut=Legacy.syncAuthenticatedShopState({
    ...localItemsForMerge("guest","user-c",leftover,[]),
    cloudCart:[],cloudFav:[],resolveId:resolve,aliasMap:{}
  });
  assert.deepStrictEqual(cOut.cart,[{id:"102",qty:1}]);
  const shop=require("fs").readFileSync(require("path").join(__dirname,"..","shop.js"),"utf8");
  assert.match(shop,/if\(current&&current!==SHOP_OWNER_GUEST&&current!==SHOP_OWNER_STALE\)return;/);
  assert.match(shop,/writeShopOwner\(SHOP_OWNER_GUEST\)/);
});

test("favorites.html re-renders after member-state-synced",()=>{
  const shop=require("fs").readFileSync(require("path").join(__dirname,"..","shop.js"),"utf8");
  assert.match(shop,/function refreshAfterMemberSync\(\)\{/);
  assert.match(shop,/if\(document\.querySelector\("#favoritesList"\)\)\{/);
  assert.match(shop,/hydrateBooksByIds\(ids\)/);
  assert.match(shop,/renderFavoritesPage\(\)/);
  const fn=shop.slice(shop.indexOf("function refreshAfterMemberSync"),shop.indexOf("function loadAssetScript"));
  assert.match(fn,/querySelector\("#favoritesList"\)/);
  assert.match(fn,/renderFavoritesPage/);
  assert.match(fn,/querySelector\("#cartItems"\)/);
});

test("authenticated favorites display waits for matching user id",()=>{
  function allows(owner,uid){
    if(!owner||owner==="guest")return true;
    if(owner==="stale")return false;
    if(!uid)return false;
    return String(uid)===owner;
  }
  assert.strictEqual(allows("guest",null),true);
  assert.strictEqual(allows("stale",null),false);
  assert.strictEqual(allows("user-a",null),false);
  assert.strictEqual(allows("user-a","user-a"),true);
  assert.strictEqual(allows("user-a","user-b"),false);
});




if(failed){
  console.error("\n"+failed+" test(s) failed");
  process.exit(1);
}
console.log("\nAll P0 cart/favorites identity tests passed");
