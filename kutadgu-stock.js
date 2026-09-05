(function(root){
"use strict";

const LOW_STOCK_THRESHOLD=3;

const STATUS={
  UNCONFIGURED:"unconfigured",
  OUT_OF_STOCK:"out_of_stock",
  LOW_STOCK:"low_stock",
  IN_STOCK:"in_stock"
};

const LABELS={
  unconfigured:"تەڭشەلمىگەن",
  out_of_stock:"تۈگەپ كەتتى",
  low_stock:"ئاز قالدى",
  in_stock:"ئامباردا بار"
};

const STOREFRONT_KEYS={
  unconfigured:"unknown",
  out_of_stock:"out",
  low_stock:"low",
  in_stock:"in"
};

function isBlankStock(raw){
  if(raw===null||raw===undefined)return true;
  return String(raw).trim()==="";
}

function parseStockQuantity(raw){
  if(isBlankStock(raw))return {ok:true,value:null,configured:false};
  const text=String(raw).trim();
  if(!/^(0|[1-9]\d*)$/.test(text)){
    return {ok:false,error:"ئامبار سانى پەقەت 0 ياكى ئۇنىڭدىن چوڭ پۈتۈن سان بولسۇن."};
  }
  const n=Number(text);
  if(!Number.isInteger(n)||n<0){
    return {ok:false,error:"ئامبار سانى پەقەت 0 ياكى ئۇنىڭدىن چوڭ پۈتۈن سان بولسۇن."};
  }
  return {ok:true,value:n,configured:true};
}

function parseAdminStock(raw){
  return parseStockQuantity(raw);
}

function isUnconfiguredStock(raw){
  const parsed=parseStockQuantity(raw);
  return parsed.ok&&!parsed.configured;
}

function deriveStockStatus(raw){
  const parsed=parseStockQuantity(raw);
  if(!parsed.ok)return {ok:false,error:parsed.error,key:null,label:"",qty:null};
  if(!parsed.configured){
    return {ok:true,key:STATUS.UNCONFIGURED,label:LABELS.unconfigured,qty:null};
  }
  const qty=parsed.value;
  if(qty===0)return {ok:true,key:STATUS.OUT_OF_STOCK,label:LABELS.out_of_stock,qty:0};
  if(qty<=LOW_STOCK_THRESHOLD)return {ok:true,key:STATUS.LOW_STOCK,label:LABELS.low_stock,qty};
  return {ok:true,key:STATUS.IN_STOCK,label:LABELS.in_stock,qty};
}

function formatStockInputValue(raw){
  const parsed=parseStockQuantity(raw);
  if(!parsed.ok||!parsed.configured)return "";
  return String(parsed.value);
}

function countUnconfiguredActiveBooks(books){
  return (Array.isArray(books)?books:[]).filter(book=>{
    if(!book||book.is_active===false)return false;
    return isUnconfiguredStock(book.stock);
  }).length;
}

function unconfiguredStockLabel(count){
  const n=Number(count);
  const shown=Number.isFinite(n)?String(n):"—";
  return `ئامبار سانى تەڭشەلمىگەن: ${shown}`;
}

function normalizeStockStatusText(value){
  return String(value??"").replace(/\s+/g," ").trim().toLowerCase();
}

function storefrontStockInfo(book){
  const parsed=parseStockQuantity(book&&book.stock);
  if(parsed.ok&&parsed.configured){
    const derived=deriveStockStatus(parsed.value);
    return {
      key:STOREFRONT_KEYS[derived.key]||"unknown",
      label:derived.label,
      canBuy:derived.key!==STATUS.OUT_OF_STOCK,
      qty:derived.qty
    };
  }
  const raw=normalizeStockStatusText(book&&(book.stockStatus||book.stock_status||""));
  if(["out","out_of_stock","soldout","sold-out","تۈگەپ كەتتى"].includes(raw)){
    return {key:"out",label:LABELS.out_of_stock,canBuy:false,qty:0};
  }
  if(["low","low_stock","ئاز قالدى"].includes(raw)){
    return {key:"low",label:LABELS.low_stock,canBuy:true,qty:null};
  }
  if(["in","in_stock","available","ئامباردا بار"].includes(raw)){
    return {key:"in",label:LABELS.in_stock,canBuy:true,qty:null};
  }
  return {key:"unknown",label:"",canBuy:true,qty:null};
}

const api={
  LOW_STOCK_THRESHOLD,
  STATUS,
  LABELS,
  STOREFRONT_KEYS,
  parseStockQuantity,
  parseAdminStock,
  isBlankStock,
  isUnconfiguredStock,
  deriveStockStatus,
  formatStockInputValue,
  countUnconfiguredActiveBooks,
  unconfiguredStockLabel,
  storefrontStockInfo
};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
root.KutadguStock=api;
})(typeof window!=="undefined"?window:typeof globalThis!=="undefined"?globalThis:{});
