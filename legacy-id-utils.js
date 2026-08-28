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

function sanitizeCartQty(raw){
  if(raw===true||raw===false)return 1;
  if(raw==null||raw==="")return 1;
  const n=parseInt(String(raw).trim(),10);
  if(!Number.isFinite(n)||n<1)return 1;
  if(n>MAX_CART_QTY)return MAX_CART_QTY;
  return n;
}

function collapseAliasQuantities(qtys){
  const nums=(Array.isArray(qtys)?qtys:[]).map(sanitizeCartQty);
  if(!nums.length)return 1;
  if(nums.length===1)return nums[0];
  const belowCap=nums.filter(qty=>qty<MAX_CART_QTY);
  if(belowCap.length)return Math.max(...belowCap);
  return MAX_CART_QTY;
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
      merged.set(resolved,{id:resolved,qtys:[qty]});
      order.push(resolved);
    }else{
      merged.get(resolved).qtys.push(qty);
    }
  });
  return order.map(id=>{
    const row=merged.get(id);
    return {id,qty:collapseAliasQuantities(row.qtys)};
  });
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
  migrateCartItems,
  migrateIdList,
  mergeGuestAndCloudCart,
  mergeGuestAndCloudFavs,
  shopStateSignature,
  activationGuard,
  remoteAvailableFromActiveCount
};

root.KutadguLegacyIds=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:typeof globalThis!=="undefined"?globalThis:this);
