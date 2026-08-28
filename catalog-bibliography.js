(function(root){
"use strict";

const BIB_OPTIONAL_COLS=["translator","publisher","publish_year","pages"];

function schemaOptional(spec,col){
  const optional=(spec&&spec.optionalColumns)||{};
  return optional[col]!==false;
}

function parsePublishYear(value){
  const raw=String(value??"").trim();
  if(!raw)return {ok:true,value:null,empty:true};
  if(!/^\d+$/.test(raw))return {ok:false,error:"نەشر يىلى پۈتۈن سان بولسۇن"};
  const n=Number(raw);
  if(!Number.isInteger(n)||n<1000||n>2100){
    return {ok:false,error:"نەشر يىلى 1000–2100 ئارىسىدا بولسۇن"};
  }
  return {ok:true,value:n,empty:false};
}

function parsePages(value){
  const raw=String(value??"").trim();
  if(!raw)return {ok:true,value:null,empty:true};
  if(!/^\d+$/.test(raw))return {ok:false,error:"بەت سانى پۈتۈن سان بولسۇن"};
  const n=Number(raw);
  if(!Number.isInteger(n)||n<1)return {ok:false,error:"بەت سانى 1 ياكى ئۇنىڭدىن چوڭ بولسۇن"};
  return {ok:true,value:n,empty:false};
}

function normalizeIsbnDigits(value){
  return String(value??"").trim().replace(/[\s-]+/g,"").replace(/[^0-9Xx]/g,"").toUpperCase();
}

function storefrontSearchColumns(spec){
  const cols=["title","author","category"];
  if(schemaOptional(spec,"translator"))cols.push("translator");
  if(schemaOptional(spec,"publisher"))cols.push("publisher");
  if(schemaOptional(spec,"isbn"))cols.push("isbn");
  return cols;
}

function adminSearchColumns(present){
  const has=col=>present&&typeof present.has==="function"?present.has(col):!!(present&&present[col]);
  const cols=["title","author"];
  if(has("translator"))cols.push("translator");
  if(has("publisher"))cols.push("publisher");
  return cols;
}

function staticSearchHaystack(book){
  const isbn=normalizeIsbnDigits(book&&(book.isbn||book.ISBN));
  return [
    book&&book.title,
    book&&book.author,
    book&&book.translator,
    book&&book.publisher,
    book&&book.category,
    book&&book.isbn,
    isbn
  ].filter(Boolean).join(" ");
}

function missingColumnsFromError(error){
  const msg=String(error&&error.message||error||"");
  const code=error&&error.code;
  const hit=code==="42703"||code==="PGRST204"||/does not exist/i.test(msg)||/schema cache/i.test(msg);
  if(!hit)return [];
  const found=BIB_OPTIONAL_COLS.filter(col=>new RegExp(`\\b${col}\\b`,"i").test(msg));
  return found.length?found:BIB_OPTIONAL_COLS.slice();
}

function disableOptionalColumns(spec,cols){
  const next=spec&&typeof spec==="object"?spec:{optionalColumns:{}};
  next.optionalColumns=Object.assign({},next.optionalColumns||{});
  (cols||[]).forEach(col=>{next.optionalColumns[col]=false});
  return next;
}

function qualityIgnoresOptionalBibliography(){
  return true;
}

const api={
  BIB_OPTIONAL_COLS,
  schemaOptional,
  parsePublishYear,
  parsePages,
  normalizeIsbnDigits,
  storefrontSearchColumns,
  adminSearchColumns,
  staticSearchHaystack,
  missingColumnsFromError,
  disableOptionalColumns,
  qualityIgnoresOptionalBibliography
};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
root.KutadguBibliography=api;
})(typeof window!=="undefined"?window:typeof globalThis!=="undefined"?globalThis:{});
