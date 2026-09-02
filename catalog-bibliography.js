(function(root){
"use strict";

const BIB_OPTIONAL_COLS=["translator","publisher","publish_year","pages"];
const COVER_SIZE_OPTIONAL_COLS=["cover_type","book_size"];
const COVER_TYPE_VALUES=["hardcover","paperback","other"];
const BOOK_SIZE_VALUES=["A4","A5","B5","other"];
const COVER_TYPE_LABELS={hardcover:"قاتتىق مۇقاۋىلىق",paperback:"يۇمشاق مۇقاۋىلىق",other:"باشقا"};
const BOOK_SIZE_LABELS={A4:"A4",A5:"A5",B5:"B5",other:"باشقا"};

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

function normalizeCoverType(value){
  if(value==null)return null;
  const s=String(value).trim();
  if(!s)return null;
  const key=s.toLowerCase().replace(/[\s_-]+/g,"");
  if(key==="hardcover"||key==="hard"||key==="hardback")return "hardcover";
  if(key==="paperback"||key==="softcover"||key==="soft")return "paperback";
  if(key==="other")return "other";
  return null;
}

function normalizeBookSize(value){
  if(value==null)return null;
  const s=String(value).trim();
  if(!s)return null;
  const u=s.toUpperCase();
  if(u==="A4"||u==="A5"||u==="B5")return u;
  if(s.toLowerCase()==="other")return "other";
  return null;
}

function coverTypeLabel(value){
  const n=normalizeCoverType(value);
  return n?COVER_TYPE_LABELS[n]:"";
}

function bookSizeLabel(value){
  const n=normalizeBookSize(value);
  return n?BOOK_SIZE_LABELS[n]:"";
}

function detailMetaVisible(value){
  if(value===null||value===undefined)return false;
  const s=String(value).trim();
  if(!s)return false;
  if(/^(undefined|null|unknown)$/i.test(s))return false;
  return true;
}

function canonicalOptionalForSave(selectValue,previous,isEdit,normalize){
  const fn=typeof normalize==="function"?normalize:function(){return null};
  const n=fn(selectValue);
  if(n)return {include:true,value:n};
  const prev=previous==null?"":String(previous);
  if(isEdit&&prev.trim()&&!fn(prev))return {include:false};
  return {include:true,value:null};
}

function missingColumnsFromError(error){
  const msg=String(error&&error.message||error||"");
  const code=error&&error.code;
  const hit=code==="42703"||code==="PGRST204"||/does not exist/i.test(msg)||/schema cache/i.test(msg);
  if(!hit)return [];
  const found=BIB_OPTIONAL_COLS.filter(col=>new RegExp(`\\b${col}\\b`,"i").test(msg));
  if(found.length)return found;
  if(COVER_SIZE_OPTIONAL_COLS.some(col=>new RegExp(`\\b${col}\\b`,"i").test(msg)))return [];
  return BIB_OPTIONAL_COLS.slice();
}

function missingCoverSizeColumnsFromError(error){
  const msg=String(error&&error.message||error||"");
  const code=error&&error.code;
  const hit=code==="42703"||code==="PGRST204"||/does not exist/i.test(msg)||/schema cache/i.test(msg);
  if(!hit)return [];
  return COVER_SIZE_OPTIONAL_COLS.filter(col=>new RegExp(`\\b${col}\\b`,"i").test(msg));
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
  COVER_SIZE_OPTIONAL_COLS,
  COVER_TYPE_VALUES,
  BOOK_SIZE_VALUES,
  COVER_TYPE_LABELS,
  BOOK_SIZE_LABELS,
  schemaOptional,
  parsePublishYear,
  parsePages,
  normalizeCoverType,
  normalizeBookSize,
  coverTypeLabel,
  bookSizeLabel,
  detailMetaVisible,
  canonicalOptionalForSave,
  normalizeIsbnDigits,
  storefrontSearchColumns,
  adminSearchColumns,
  staticSearchHaystack,
  missingColumnsFromError,
  missingCoverSizeColumnsFromError,
  disableOptionalColumns,
  qualityIgnoresOptionalBibliography
};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
root.KutadguBibliography=api;
})(typeof window!=="undefined"?window:typeof globalThis!=="undefined"?globalThis:{});
