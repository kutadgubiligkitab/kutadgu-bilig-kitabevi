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

function requireConfiguredStock(raw){
  const parsed=parseAdminStock(raw);
  if(!parsed.ok)return parsed;
  if(!parsed.configured){
    return {ok:false,error:"ئامبار سانىنى كىرگۈزۈڭ (0 ياكى ئۇنىڭدىن چوڭ پۈتۈن سان)."};
  }
  return parsed;
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

const PHASE1_STOREFRONT_STOCK={key:"unknown",label:"",canBuy:true,qty:null};

function readGlobal(name){
  try{
    if(typeof window!=="undefined"&&window[name]!==undefined)return window[name];
  }catch(e){}
  try{
    if(typeof globalThis!=="undefined"&&globalThis[name]!==undefined)return globalThis[name];
  }catch(e){}
  return undefined;
}

function isStockEnforcementEnabled(opts){
  if(opts&&typeof opts.stockEnforcement==="boolean")return opts.stockEnforcement===true;
  if(opts&&typeof opts.enforcement==="boolean")return opts.enforcement===true;
  if(readGlobal("KUTADGU_STOCK_ENFORCEMENT")===true)return true;
  const cfg=readGlobal("KUTADGU_APP_CONFIG")||{};
  const flags=cfg.featureFlags||{};
  return flags.stockEnforcement===true||cfg.stockEnforcement===true;
}

function enforcedStorefrontStockInfo(book){
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

function storefrontStockInfo(book,opts){
  if(!isStockEnforcementEnabled(opts))return Object.assign({},PHASE1_STOREFRONT_STOCK);
  return enforcedStorefrontStockInfo(book);
}

const api={
  LOW_STOCK_THRESHOLD,
  STATUS,
  LABELS,
  STOREFRONT_KEYS,
  PHASE1_STOREFRONT_STOCK,
  parseStockQuantity,
  parseAdminStock,
  requireConfiguredStock,
  isBlankStock,
  isUnconfiguredStock,
  deriveStockStatus,
  formatStockInputValue,
  countUnconfiguredActiveBooks,
  unconfiguredStockLabel,
  isStockEnforcementEnabled,
  storefrontStockInfo
};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
root.KutadguStock=api;
})(typeof window!=="undefined"?window:typeof globalThis!=="undefined"?globalThis:{});
