(function(root){
"use strict";

const Orig=root.KutadguAdminOriginalPrice||(typeof require==="function"?require("./admin-original-price.js"):{});
const Price=root.KutadguAdminBulkPrice||(typeof require==="function"?require("./admin-bulk-price.js"):{});

const PAGE_SIZE=20;
const CHANGE_KIND_PRICE="price_change";
const CHANGE_KIND_ROLLBACK="rollback";
const ALLOWED_KINDS=[CHANGE_KIND_PRICE,CHANGE_KIND_ROLLBACK];
const KIND_LABELS={
  price_change:"باھا ئۆزگەردى",
  rollback:"تارىختىن قايتۇرۇلدى"
};
const EMPTY_TEXT="تېخى باھا ئۆزگىرىش تارىخى يوق.";
const STALE_PRICE_ERROR="باھا باشقا بەتتە ئۆزگەرتىلگەن. كىتابنى قايتا ئېچىپ قايتا سىناڭ.";
const WRONG_BOOK_ERROR="تارىخ قۇرى بۇ كىتابقا تەۋە ئەمەس.";
const INVALID_ROLLBACK_ERROR="قايتۇرۇلىدىغان باھا ئىناۋەتسىز.";
const MISSING_HISTORY_ERROR="تارىخ قۇرى تېپىلمىدى.";
const MISSING_BOOK_ERROR="كىتاب تېپىلمىدى.";
const MISSING_TABLE_ERROR="باھا تارىخى جەدۋىلى تېخى Database دا يوق. STAGE65_PRICE_HISTORY.sql نى Supabase SQL Editor دا Run قىلىڭ.";
const HISTORY_COLUMNS=["id","book_id","old_price","new_price","change_kind","changed_at"];

function roundMoney(value){
  if(Orig.roundMoney)return Orig.roundMoney(value);
  if(Price.roundMoney)return Price.roundMoney(value);
  const n=Number(value);
  if(!Number.isFinite(n))return n;
  return Math.round((n+Number.EPSILON)*100)/100;
}

function isValidRollbackPrice(value){
  if(value===null||value===undefined||value==="")return false;
  if(typeof value==="boolean")return false;
  const n=Number(value);
  if(!Number.isFinite(n))return false;
  return n>=0;
}

function normalizeNullablePrice(value){
  if(value===null||value===undefined||value==="")return null;
  if(typeof value==="boolean")return value;
  const n=Number(value);
  if(!Number.isFinite(n))return value;
  return n;
}

function isDistinctPrice(a,b){
  const na=normalizeNullablePrice(a);
  const nb=normalizeNullablePrice(b);
  if(na===null&&nb===null)return false;
  if(na===null||nb===null)return true;
  if(typeof na==="boolean"||typeof nb==="boolean")return na!==nb;
  if(!Number.isFinite(Number(na))||!Number.isFinite(Number(nb)))return String(na)!==String(nb);
  return roundMoney(na)!==roundMoney(nb);
}

function pricesEqual(a,b){
  return !isDistinctPrice(a,b);
}

function formatMoney(value){
  if(!isValidRollbackPrice(value))return "—";
  if(Price.formatMoney)return Price.formatMoney(value);
  if(Orig.formatMoney)return Orig.formatMoney(value);
  return `${Number(value).toLocaleString("tr-TR")} ₺`;
}

function formatPriceTransition(oldPrice,newPrice){
  return `${formatMoney(oldPrice)} → ${formatMoney(newPrice)}`;
}

function changeKindLabel(kind){
  const key=String(kind||"");
  return KIND_LABELS[key]||KIND_LABELS[CHANGE_KIND_PRICE];
}

function resolveChangeKind(setting){
  const raw=String(setting==null?"":setting).trim();
  if(raw===CHANGE_KIND_ROLLBACK)return CHANGE_KIND_ROLLBACK;
  return CHANGE_KIND_PRICE;
}

function canRollbackHistoryRow(row,currentPrice){
  if(!row)return false;
  if(!isValidRollbackPrice(row.old_price))return false;
  if(!isDistinctPrice(row.old_price,currentPrice))return false;
  return true;
}

function historyFromBookPatch(oldRow,patch,kindSetting){
  if(!oldRow||!patch||!Object.prototype.hasOwnProperty.call(patch,"price")){
    return {insert:false};
  }
  if(!isDistinctPrice(oldRow.price,patch.price))return {insert:false};
  return {
    insert:true,
    book_id:oldRow.id,
    old_price:oldRow.price==null||oldRow.price===""?null:oldRow.price,
    new_price:patch.price==null||patch.price===""?null:patch.price,
    change_kind:resolveChangeKind(kindSetting)
  };
}

function planRollback({bookId,historyRow,currentPrice}={}){
  const id=decimalId(bookId);
  if(!id){
    return {ok:false,canRollback:false,error:"كىتاب ID تېپىلمىدى. يېڭى قۇر قوشۇلمايدۇ."};
  }
  if(!historyRow||historyRow.id==null){
    return {ok:false,canRollback:false,error:MISSING_HISTORY_ERROR};
  }
  if(decimalId(historyRow.book_id)!==id){
    return {ok:false,canRollback:false,error:WRONG_BOOK_ERROR};
  }
  if(!isValidRollbackPrice(historyRow.old_price)){
    return {ok:false,canRollback:false,error:INVALID_ROLLBACK_ERROR};
  }
  if(!isDistinctPrice(historyRow.old_price,currentPrice)){
    return {ok:true,canRollback:false,alreadyCurrent:true,targetPrice:roundMoney(historyRow.old_price),historyId:historyRow.id};
  }
  return {
    ok:true,
    canRollback:true,
    alreadyCurrent:false,
    bookId:id,
    historyId:historyRow.id,
    targetPrice:roundMoney(historyRow.old_price),
    expectedPrice:currentPrice==null||currentPrice===""?null:currentPrice
  };
}

function isStaleCurrentPrice(loadedPrice,freshPrice){
  return isDistinctPrice(loadedPrice,freshPrice);
}

function compareDecimalIdDesc(a,b){
  const sa=decimalId(a);
  const sb=decimalId(b);
  if(sa===sb)return 0;
  if(!sa)return 1;
  if(!sb)return -1;
  if(sa.length!==sb.length)return sb.length-sa.length;
  return sa<sb?1:sa>sb?-1:0;
}

function historyQueryPlan(bookId,{offset=0,limit=PAGE_SIZE}={}){
  const pageSize=Number(limit)||PAGE_SIZE;
  const start=Math.max(0,Number(offset)||0);
  return {
    table:"book_price_history",
    bookId:decimalId(bookId),
    columns:HISTORY_COLUMNS.slice(),
    order:[{column:"changed_at",ascending:false},{column:"id",ascending:false}],
    range:[start,start+pageSize],
    pageSize
  };
}

function sortHistory(rows){
  return [...(rows||[])].sort((a,b)=>{
    const ta=new Date(a&&a.changed_at).getTime();
    const tb=new Date(b&&b.changed_at).getTime();
    const sa=Number.isFinite(ta)?ta:0;
    const sb=Number.isFinite(tb)?tb:0;
    if(sb!==sa)return sb-sa;
    return compareDecimalIdDesc(a&&a.id,b&&b.id);
  });
}

function historyForBook(store,bookId){
  const id=decimalId(bookId)||String(bookId||"");
  return sortHistory((store&&store.history||[]).filter(row=>decimalId(row.book_id)===id||String(row.book_id)===id));
}

function paginateHistory(rows,offset,pageSize){
  const size=Number(pageSize)||PAGE_SIZE;
  const start=Math.max(0,Number(offset)||0);
  const list=rows||[];
  const slice=list.slice(start,start+size);
  return {
    rows:slice,
    hasMore:start+slice.length<list.length,
    nextOffset:start+slice.length
  };
}

function createHistoryStore(books,history){
  const byId={};
  (books||[]).forEach(book=>{
    const key=decimalId(book.id)||String(book.id);
    byId[key]={...book};
  });
  const rows=[...(history||[])];
  const seq=rows.reduce((max,row)=>Math.max(max,Number(row&&row.id)||0),0);
  return {books:byId,history:rows,seq};
}

function applyBookPriceChange(store,bookId,newPrice,opts){
  const book=store&&store.books&&store.books[decimalId(bookId)||String(bookId)];
  if(!book)return {error:new Error(MISSING_BOOK_ERROR),data:[],historyInserted:false};
  const original=book.original_price;
  const planned=historyFromBookPatch(book,{price:newPrice},opts&&opts.kindSetting);
  book.price=newPrice==null||newPrice===""?null:newPrice;
  if(!planned.insert){
    return {
      error:null,
      data:[{id:book.id,price:book.price,original_price:book.original_price}],
      historyInserted:false,
      noop:true
    };
  }
  store.seq=(Number(store.seq)||0)+1;
  const row={
    id:store.seq,
    book_id:decimalId(book.id)||String(book.id),
    old_price:planned.old_price,
    new_price:planned.new_price,
    change_kind:planned.change_kind,
    changed_at:(opts&&opts.changedAt)||new Date().toISOString(),
    changed_by:opts&&opts.changedBy||null
  };
  store.history.push(row);
  if(book.original_price!==original){
    book.original_price=original;
  }
  return {
    error:null,
    data:[{id:book.id,price:book.price,original_price:book.original_price}],
    historyInserted:true,
    row
  };
}

function simulateRollback(store,{bookId,historyId,expectedPrice,isAdmin,aal}={}){
  if(!isAdmin)return {error:new Error("Admin permission required"),data:[]};
  if(String(aal||"")!=="aal2")return {error:new Error("AAL2 required"),data:[]};
  const id=decimalId(bookId);
  if(!id)return {error:new Error("كىتاب ID تېپىلمىدى."),data:[]};
  const book=store&&store.books&&store.books[id];
  if(!book)return {error:new Error(MISSING_BOOK_ERROR),data:[]};
  const hid=decimalId(historyId);
  if(!hid)return {error:new Error(MISSING_HISTORY_ERROR),data:[]};
  const hist=(store.history||[]).find(row=>decimalId(row.id)===hid);
  if(!hist)return {error:new Error(MISSING_HISTORY_ERROR),data:[]};
  if(decimalId(hist.book_id)!==decimalId(book.id))return {error:new Error(WRONG_BOOK_ERROR),data:[]};
  if(!isValidRollbackPrice(hist.old_price))return {error:new Error(INVALID_ROLLBACK_ERROR),data:[]};
  if(isDistinctPrice(book.price,expectedPrice))return {error:new Error(STALE_PRICE_ERROR),data:[]};
  if(!isDistinctPrice(book.price,hist.old_price)){
    return {
      error:null,
      data:[{id:book.id,price:book.price,original_price:book.original_price}],
      noop:true
    };
  }
  const originalBefore=book.original_price;
  const result=applyBookPriceChange(store,id,hist.old_price,{kindSetting:CHANGE_KIND_ROLLBACK});
  if(store.books[id].original_price!==originalBefore){
    store.books[id].original_price=originalBefore;
  }
  result.originalUnchanged=store.books[id].original_price===originalBefore;
  return result;
}

function decimalId(value){
  const s=String(value??"").trim();
  return /^\d+$/.test(s)?s:"";
}

function rollbackRpcArgs(bookId,historyId,expectedPrice){
  // PostgREST accepts decimal strings for bigint arguments. Keep canonical IDs
  // as strings so values above 2^53-1 are not rounded by IEEE-754 number conversion.
  return {
    p_book_id:decimalId(bookId),
    p_history_id:decimalId(historyId),
    p_expected_price:expectedPrice==null||expectedPrice===""?null:expectedPrice
  };
}

function isBigintIdType(value){
  const v=String(value||"").trim().toLowerCase();
  return v==="int8"||v==="bigint";
}

function historyFkCompatible(booksIdType,historyBookIdType){
  return isBigintIdType(booksIdType)&&isBigintIdType(historyBookIdType);
}

const api={
  PAGE_SIZE,
  CHANGE_KIND_PRICE,
  CHANGE_KIND_ROLLBACK,
  ALLOWED_KINDS,
  KIND_LABELS,
  EMPTY_TEXT,
  STALE_PRICE_ERROR,
  WRONG_BOOK_ERROR,
  INVALID_ROLLBACK_ERROR,
  MISSING_HISTORY_ERROR,
  MISSING_BOOK_ERROR,
  MISSING_TABLE_ERROR,
  HISTORY_COLUMNS,
  roundMoney,
  isValidRollbackPrice,
  isDistinctPrice,
  pricesEqual,
  formatMoney,
  formatPriceTransition,
  changeKindLabel,
  resolveChangeKind,
  canRollbackHistoryRow,
  historyFromBookPatch,
  planRollback,
  isStaleCurrentPrice,
  historyQueryPlan,
  sortHistory,
  historyForBook,
  paginateHistory,
  createHistoryStore,
  applyBookPriceChange,
  simulateRollback,
  decimalId,
  rollbackRpcArgs,
  historyFkCompatible
};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
root.KutadguAdminPriceHistory=api;
})(typeof window!=="undefined"?window:typeof globalThis!=="undefined"?globalThis:{});
