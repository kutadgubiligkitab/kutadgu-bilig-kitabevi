/*
  Stage 4.6 — pure ID compatibility helpers.
  Canonical identity is the database bigint id as a decimal string.
  legacy_id is only an alias.
*/
(function(root){
"use strict";

const CANONICAL_ID=/^\d+$/;
const EXPECTED_MIGRATED_COUNT=84;
const MAX_CART_QTY=99;
const KNOWN_RESTORED_ALIASES=Object.freeze({
  "children-3":"102","102":"children-3",
  "children-4":"103","103":"children-4"
});

function mergedAliasMap(aliasMap){
  return Object.assign({},KNOWN_RESTORED_ALIASES,aliasMap&&typeof aliasMap==="object"&&!Array.isArray(aliasMap)?aliasMap:{});
}

function bindResolve(resolveId,aliasMap){
  const map=mergedAliasMap(aliasMap);
  const caller=typeof resolveId==="function"?resolveId:id=>id;
  return function(id){
    const raw=String(id??"").trim();
    if(!raw)return raw;
    const fromRaw=applyBookIdMap(raw,map);
    if(isCanonicalBookId(fromRaw))return fromRaw;
    let via=raw;
    try{via=String(caller(raw)||raw)}catch(e){via=raw}
    const fromVia=applyBookIdMap(via,map);
    if(isCanonicalBookId(fromVia))return fromVia;
    if(isCanonicalBookId(via))return via;
    if(isCanonicalBookId(raw))return raw;
    return fromRaw||via||raw;
  };
}

function isHistoricalCapPollutionId(id,resolveId,aliasMap){
  const resolve=typeof resolveId==="function"?resolveId:bindResolve(resolveId,aliasMap);
  const canonical=String(resolve(id)||id||"");
  const keys=identityKeys(id,resolve,mergedAliasMap(aliasMap));
  if(keys.has("children-3")||keys.has("102")||keys.has("children-4")||keys.has("103"))return true;
  if(!isCanonicalBookId(canonical))return true;
  return [...keys].some(key=>key!==canonical);
}

function sanitizeCartQty(raw){
  if(raw===true||raw===false)return 1;
  if(raw==null||raw==="")return 1;
  const n=parseInt(String(raw).trim(),10);
  if(!Number.isFinite(n)||n<1)return 1;
  if(n>MAX_CART_QTY)return MAX_CART_QTY;
  return n;
}

function collapseAliasQuantities(qtys,options={}){
  const nums=(Array.isArray(qtys)?qtys:[]).map(sanitizeCartQty);
  if(!nums.length)return 1;
  const sourceCount=Number(options.sourceCount);
  const distinctSources=Number.isFinite(sourceCount)?sourceCount:nums.length;
  const belowCap=nums.filter(qty=>qty<MAX_CART_QTY);
  if(belowCap.length)return Math.max(...belowCap);
  if(distinctSources>=2)return 1;
  if(nums.length===1)return nums[0];
  return MAX_CART_QTY;
}

function readPersistedAliasMap(storage){
  try{
    const raw=(storage||(typeof localStorage!=="undefined"?localStorage:null))?.getItem?.("kutadgu-id-aliases-v1");
    const parsed=raw?JSON.parse(raw):{};
    return parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed:{};
  }catch(e){return {}}
}

function identityKeys(id,resolveId=x=>x,aliasMap={}){
  const raw=String(id??"").trim();
  const keys=new Set();
  if(!raw)return keys;
  keys.add(raw);
  const resolved=String(resolveId(raw)||raw);
  if(resolved)keys.add(resolved);
  const map=aliasMap&&typeof aliasMap==="object"?aliasMap:{};
  let guard=0;
  while(guard++<8){
    let added=false;
    [...keys].forEach(key=>{
      const mapped=String(map[key]||"").trim();
      if(mapped&&!keys.has(mapped)){keys.add(mapped);added=true}
      const extra=String(resolveId(key)||"").trim();
      if(extra&&!keys.has(extra)){keys.add(extra);added=true}
    });
    if(!added)break;
  }
  return keys;
}

function sameBookIdentity(a,b,resolveId=x=>x,aliasMap={}){
  const left=identityKeys(a,resolveId,aliasMap);
  if(!left.size)return false;
  return [...identityKeys(b,resolveId,aliasMap)].some(key=>left.has(key));
}

function applyBookIdMap(id,idMap={}){
  const raw=String(id??"").trim();
  if(!raw)return raw;
  const mapped=idMap[raw];
  if(mapped==null||mapped==="")return raw;
  if(isCanonicalBookId(String(mapped)))return String(mapped);
  if(isCanonicalBookId(raw))return raw;
  return String(mapped);
}

function rememberRowAliases(idMap={},id,legacyId){
  return rememberBookAliases({id,legacyId,legacy_id:legacyId},idMap);
}

function isCanonicalBookId(value){
  return CANONICAL_ID.test(String(value||"").trim());
}

function trimLegacyId(value){
  return String(value??"").trim();
}

function quotePostgrestValue(value){
  return `"${String(value).replace(/["\\]/g,"")}"`;
}

function splitLookupIds(ids=[]){
  const numeric=[],legacy=[];
  [...new Set((ids||[]).map(id=>String(id||"").trim()).filter(Boolean))].forEach(id=>{
    if(isCanonicalBookId(id))numeric.push(id);
    else legacy.push(id);
  });
  return {numeric,legacy};
}

function uniqueVisibleBooks(books=[]){
  const seen=new Map();
  (books||[]).forEach(book=>{
    if(!book||!book.id)return;
    if(!seen.has(String(book.id)))seen.set(String(book.id),book);
  });
  return [...seen.values()];
}

function migrateCartItems(items=[],resolveId=id=>id){
  const order=[];
  const merged=new Map();
  (Array.isArray(items)?items:[]).forEach(item=>{
    if(!item||item.id==null||item.id==="")return;
    const raw=String(item.id);
    const mapped=resolveId(raw);
    const resolved=mapped==null||mapped===""?raw:String(mapped);
    const qty=sanitizeCartQty(item.qty);
    if(!merged.has(resolved)){
      merged.set(resolved,{id:resolved,qtys:[qty],rawIds:new Set([raw])});
      order.push(resolved);
    }else{
      const row=merged.get(resolved);
      row.qtys.push(qty);
      row.rawIds.add(raw);
    }
  });
  return order.map(id=>{
    const row=merged.get(id);
    return {id,qty:collapseAliasQuantities(row.qtys,{sourceCount:row.rawIds.size})};
  });
}

function repairCapPollutedCartItems(items=[],resolveId=id=>id,aliasMap={}){
  const resolve=bindResolve(resolveId,aliasMap);
  const map=mergedAliasMap(aliasMap);
  const migrated=migrateCartItems(items,resolve);
  return migrated.map(row=>{
    const qty=sanitizeCartQty(row.qty);
    if(qty!==MAX_CART_QTY)return {id:row.id,qty};
    if(isHistoricalCapPollutionId(row.id,resolve,map))return {id:row.id,qty:1};
    return {id:row.id,qty};
  });
}

function filterCartRemovingBook(items=[],bookId="",resolveId=id=>id,aliasMap={}){
  const resolve=bindResolve(resolveId,aliasMap);
  const map=mergedAliasMap(aliasMap);
  const want=String(bookId||"").trim();
  if(!want)return repairCapPollutedCartItems(items,resolve,map);
  return repairCapPollutedCartItems(items,resolve,map).filter(item=>!sameBookIdentity(item.id,want,resolve,map));
}

function filterFavsRemovingBook(ids=[],bookId="",resolveId=id=>id,aliasMap={}){
  const resolve=bindResolve(resolveId,aliasMap);
  const map=mergedAliasMap(aliasMap);
  const want=String(bookId||"").trim();
  const migrated=migrateIdList(ids,resolve);
  if(!want)return migrated;
  return migrated.filter(id=>!sameBookIdentity(id,want,resolve,map));
}

function syncAuthenticatedShopState(input={}){
  const resolve=bindResolve(input.resolveId,input.aliasMap);
  const map=mergedAliasMap(input.aliasMap);
  const localCart=Array.isArray(input.localCart)?input.localCart:[];
  const cloudCart=Array.isArray(input.cloudCart)?input.cloudCart:[];
  const localFav=Array.isArray(input.localFav)?input.localFav:[];
  const cloudFav=Array.isArray(input.cloudFav)?input.cloudFav:[];
  const repairedLocalCart=repairCapPollutedCartItems(localCart,resolve,map);
  const repairedCloudCart=repairCapPollutedCartItems(cloudCart,resolve,map);
  const repairedLocalFav=migrateIdList(localFav,resolve);
  const repairedCloudFav=migrateIdList(cloudFav,resolve);
  const cart=repairCapPollutedCartItems([...repairedCloudCart,...repairedLocalCart],resolve,map);
  const fav=migrateIdList([...repairedLocalFav,...repairedCloudFav],resolve);
  const rawCloudIds=[...cloudCart.map(x=>String(x&&x.id||"")),...cloudFav.map(String)].filter(Boolean);
  const nextIds=[...cart.map(x=>String(x.id)),...fav.map(String)];
  const staleAliasRemained=rawCloudIds.some(id=>!isCanonicalBookId(id))||nextIds.some(id=>!isCanonicalBookId(id));
  return {
    cart,
    fav,
    repairedLocalCart,
    repairedCloudCart,
    repairedLocalFav,
    repairedCloudFav,
    staleAliasRemained,
    badge:cart.reduce((sum,row)=>sum+sanitizeCartQty(row.qty),0)
  };
}

function replacementIdentityIds(cartItems=[],favIds=[],resolveId=id=>id,aliasMap={}){
  const resolve=bindResolve(resolveId,aliasMap);
  const map=mergedAliasMap(aliasMap);
  const keys=new Set(Object.keys(KNOWN_RESTORED_ALIASES));
  [...(Array.isArray(cartItems)?cartItems:[]),...(Array.isArray(favIds)?favIds:[])].forEach(value=>{
    const id=String(value&&value.id!=null?value.id:value||"").trim();
    if(!id)return;
    identityKeys(id,resolve,map).forEach(key=>keys.add(key));
  });
  return [...keys];
}

function mergeGuestAndCloudCart(localCart=[],cloudCart=[],resolveId=id=>id){
  return migrateCartItems([...(Array.isArray(cloudCart)?cloudCart:[]),...(Array.isArray(localCart)?localCart:[])],resolveId);
}

function mergeGuestAndCloudFavs(localFav=[],cloudFav=[],resolveId=id=>id){
  return migrateIdList([...(Array.isArray(localFav)?localFav:[]),...(Array.isArray(cloudFav)?cloudFav:[])],resolveId);
}

function shopStateSignature(cartItems=[],favIds=[]){
  const cart=migrateCartItems(cartItems,id=>id).map(row=>`${row.id}:${row.qty}`).join(",");
  const fav=migrateIdList(favIds,id=>id).join(",");
  return `c=${cart}|f=${fav}`;
}

function rememberBookAliases(book,aliasMap={}){
  const next={...(aliasMap&&typeof aliasMap==="object"&&!Array.isArray(aliasMap)?aliasMap:{})};
  const id=String(book?.id||"").trim();
  const legacy=String(book?.legacyId||book?.legacy_id||"").trim();
  if(id&&legacy&&id!==legacy){
    next[id]=legacy;
    next[legacy]=id;
  }
  return next;
}

function lookupBook(id,indexes={},seen){
  const key=String(id||"").trim();
  if(!key)return null;
  const visited=seen||new Set();
  if(visited.has(key))return null;
  visited.add(key);
  const fromMap=map=>{
    if(!map)return null;
    if(typeof map.get==="function")return map.get(key)||null;
    if(!Array.isArray(map)&&typeof map==="object")return map[key]||null;
    return null;
  };
  const fromList=list=>(Array.isArray(list)?list:[]).find(book=>String(book?.id||"")===key||String(book?.legacyId||book?.legacy_id||"")===key)||null;
  const direct=fromMap(indexes.cache)||fromMap(indexes.fallback)||fromList(indexes.staticBooks);
  if(direct)return direct;
  const alias=indexes.aliases?String(indexes.aliases[key]||"").trim():"";
  if(!alias||alias===key)return null;
  return lookupBook(alias,{cache:indexes.cache,fallback:indexes.fallback,staticBooks:indexes.staticBooks,aliases:indexes.aliases},visited);
}

function visibleCartLines(items=[],lookup=id=>null){
  const resolve=id=>{
    const book=lookup(id);
    return book&&book.id?String(book.id):String(id||"");
  };
  return migrateCartItems(items,resolve).map(item=>{
    const book=lookup(item.id)||lookup(item.id);
    return {id:book&&book.id?String(book.id):String(item.id),qty:item.qty,book:book||null};
  });
}

function cartHasBook(items=[],bookId="",lookup=id=>null){
  const book=lookup(bookId);
  const want=String(book&&book.id?book.id:bookId||"");
  if(!want)return false;
  return visibleCartLines(items,lookup).some(line=>String(line.id)===want);
}

function migrateIdList(ids=[],resolveId=id=>id,{limit=null}={}){
  const out=[];
  const seen=new Set();
  (Array.isArray(ids)?ids:[]).forEach(value=>{
    if(value==null||value==="")return;
    const raw=String(value);
    const mapped=resolveId(raw);
    const resolved=mapped==null||mapped===""?raw:String(mapped);
    if(seen.has(resolved))return;
    seen.add(resolved);
    out.push(resolved);
  });
  if(Number.isFinite(limit)&&limit>=0)return out.slice(0,limit);
  return out;
}

function activationGuard(foundCount,expected=EXPECTED_MIGRATED_COUNT){
  const found=Number(foundCount);
  if(found!==Number(expected)){
    return {ok:false,activate:false,expected:Number(expected),found,reason:"count-mismatch"};
  }
  return {ok:true,activate:true,expected:Number(expected),found};
}

function remoteAvailableFromActiveCount(activeCount){
  return Number(activeCount)>0;
}

const api={
  EXPECTED_MIGRATED_COUNT,
  MAX_CART_QTY,
  isCanonicalBookId,
  trimLegacyId,
  quotePostgrestValue,
  splitLookupIds,
  uniqueVisibleBooks,
  sanitizeCartQty,
  collapseAliasQuantities,
  KNOWN_RESTORED_ALIASES,
  mergedAliasMap,
  bindResolve,
  isHistoricalCapPollutionId,
  identityKeys,
  sameBookIdentity,
  applyBookIdMap,
  rememberRowAliases,
  readPersistedAliasMap,
  migrateCartItems,
  repairCapPollutedCartItems,
  filterCartRemovingBook,
  filterFavsRemovingBook,
  syncAuthenticatedShopState,
  replacementIdentityIds,
  migrateIdList,
  mergeGuestAndCloudCart,
  mergeGuestAndCloudFavs,
  rememberBookAliases,
  lookupBook,
  visibleCartLines,
  cartHasBook,
  shopStateSignature,
  activationGuard,
  remoteAvailableFromActiveCount
};

root.KutadguLegacyIds=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:typeof globalThis!=="undefined"?globalThis:this);
