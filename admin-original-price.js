(function(root){
"use strict";

const Price=root.KutadguAdminBulkPrice||(typeof require==="function"?require("./admin-bulk-price.js"):{});

function isValidPrice(value){
  if(Price.isValidExistingPrice)return Price.isValidExistingPrice(value);
  if(value===null||value===undefined||value==="")return false;
  const n=Number(value);
  return Number.isFinite(n)&&n>=0;
}

function roundMoney(value){
  if(Price.roundMoney)return Price.roundMoney(value);
  const n=Number(value);
  if(!Number.isFinite(n))return n;
  return Math.round((n+Number.EPSILON)*100)/100;
}

function formatMoney(value){
  if(Price.formatMoney)return Price.formatMoney(value);
  if(!isValidPrice(value))return "—";
  return `${Number(value).toLocaleString("tr-TR")} ₺`;
}

function pricesEqual(a,b){
  if(!isValidPrice(a)||!isValidPrice(b))return false;
  return roundMoney(a)===roundMoney(b);
}

function originalPriceStatus(value,{create=false}={}){
  if(create){
    return {initialized:false,text:"يېڭى كىتابتا ئىناۋەتلىك باھا ساقلانسا ئەسلى باھا شۇ باھا بولىدۇ."};
  }
  if(!isValidPrice(value)){
    return {initialized:false,text:"ئەسلى باھا تېخى ساقلانمىغان"};
  }
  return {initialized:true,text:`ئەسلى باھا: ${formatMoney(value)}`};
}

function planInsertOriginalPrice(price){
  if(!isValidPrice(price))return {include:true,original_price:null};
  return {include:true,original_price:roundMoney(price)};
}

function planUpdateOriginalPrice(existingOriginal,savedPrice){
  if(isValidPrice(existingOriginal))return {include:false};
  if(!isValidPrice(savedPrice))return {include:false};
  return {include:true,original_price:roundMoney(savedPrice)};
}

function assertPriceOnlyPatch(patch){
  const keys=Object.keys(patch||{});
  if(keys.length!==1||keys[0]!=="price")throw new Error("PRICE_ONLY_PATCH");
  if(Object.prototype.hasOwnProperty.call(patch||{},"original_price"))throw new Error("ORIGINAL_PRICE_LOCKED");
  return true;
}

function resetFingerprint(settings,preview){
  const selected=[...new Set((settings&&settings.selectedIds||[]).map(id=>String(id||"").trim()).filter(Boolean))].sort();
  return JSON.stringify({
    scope:String(settings&&settings.scope||""),
    source:String(settings&&settings.source||"").trim(),
    selected:String(settings&&settings.scope)==="selected"?selected:[],
    updateCount:preview&&preview.updateCount
  });
}

function buildResetPreview(books,settings){
  const scoped=Price.selectScopeBooks?Price.selectScopeBooks(books,settings):{ok:true,books:Array.isArray(books)?books:[]};
  if(!scoped.ok)return {ok:false,error:scoped.error,canApply:false,emptySelected:!!scoped.emptySelected};
  const resettable=[],missing=[],unchanged=[];
  scoped.books.forEach(book=>{
    const row={
      id:book&&book.id,
      title:book&&book.title||"",
      oldPrice:book&&book.price,
      originalPrice:book&&book.original_price,
      newPrice:book&&book.original_price
    };
    if(!isValidPrice(book&&book.original_price)){
      missing.push({...row,skipped:true,reason:"missing_original"});
      return;
    }
    if(pricesEqual(book.price,book.original_price)){
      unchanged.push({...row,skipped:true,reason:"unchanged"});
      return;
    }
    resettable.push({
      ...row,
      oldPrice:isValidPrice(book.price)?roundMoney(book.price):book.price,
      newPrice:roundMoney(book.original_price)
    });
  });
  const updateCount=resettable.length;
  const canApply=updateCount>0;
  const highRisk=canApply&&(String(settings&&settings.scope)==="all"||updateCount>=(Price.HIGH_RISK_UPDATE_THRESHOLD||20));
  return {
    ok:true,
    canApply,
    error:canApply?"":"قايتۇرۇلىدىغان ئەسلى باھا تېپىلمىدى.",
    fingerprint:resetFingerprint(settings,{updateCount}),
    scope:String(settings&&settings.scope||""),
    scopeLabel:(Price.SCOPE_LABELS&&Price.SCOPE_LABELS[String(settings&&settings.scope||"")])||"",
    targeted:scoped.books.length,
    updateCount,
    skippedCount:missing.length+unchanged.length,
    missingCount:missing.length,
    unchangedCount:unchanged.length,
    highRisk,
    resettable,
    missing,
    unchanged,
    updatable:resettable,
    rows:[...resettable,...missing,...unchanged]
  };
}

function formatResetLine(row){
  const title=row&&row.title?String(row.title):"(نامسىز)";
  if(row&&row.reason==="missing_original")return `${title}\n${formatMoney(row.oldPrice)} → ئەسلى باھا يوق`;
  if(row&&row.reason==="unchanged")return `${title}\n${formatMoney(row.oldPrice)} → ${formatMoney(row.originalPrice)} (ئوخشاش)`;
  return `${title}\n${formatMoney(row.oldPrice)} → ${formatMoney(row.newPrice)}`;
}

function canConfirmReset(preview,settings){
  if(!preview||!preview.canApply||!preview.fingerprint)return false;
  return preview.fingerprint===resetFingerprint(settings,preview);
}

function canFinalizeReset(preview,settings,typedCount){
  if(!canConfirmReset(preview,settings))return false;
  if(!preview.highRisk)return false;
  const typed=Price.parseTypedCount?Price.parseTypedCount(typedCount):{ok:false};
  if(!typed.ok)return false;
  return typed.value===Number(preview.updateCount);
}

const api={
  isValidPrice,
  originalPriceStatus,
  planInsertOriginalPrice,
  planUpdateOriginalPrice,
  assertPriceOnlyPatch,
  buildResetPreview,
  formatResetLine,
  canConfirmReset,
  canFinalizeReset,
  resetFingerprint
};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
root.KutadguAdminOriginalPrice=api;
})(typeof window!=="undefined"?window:typeof globalThis!=="undefined"?globalThis:{});
