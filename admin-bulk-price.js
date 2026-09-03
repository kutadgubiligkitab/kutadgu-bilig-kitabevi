(function(root){
"use strict";

const SCOPES=["all","category","selected"];
const OPERATIONS=["pct_inc","pct_dec","fixed_inc","fixed_dec"];
const FETCH_PAGE=500;
const PREVIEW_PAGE_SIZE=20;
const WRITE_CONCURRENCY=4;

const OPERATION_LABELS={
  pct_inc:"پىرسەنت بويىچە ئۆستۈرۈش",
  pct_dec:"پىرسەنت بويىچە چۈشۈرۈش",
  fixed_inc:"مۇقىم سومما قوشۇش",
  fixed_dec:"مۇقىم سومما كېمەيتىش"
};

function roundMoney(value){
  const n=Number(value);
  if(!Number.isFinite(n))return n;
  return Math.round((n+Number.EPSILON)*100)/100;
}

function toCents(value){
  return Math.round(roundMoney(value)*100);
}

function fromCents(cents){
  return roundMoney(Number(cents)/100);
}

function parseAdjustmentAmount(raw){
  const v=String(raw??"").trim();
  if(!v)return {ok:false,error:"سان قىممەت كىرگۈزۈڭ."};
  if(v.startsWith("-"))return {ok:false,error:"قوشۇش/ئېلىش بەلگىسى يازماڭ؛ مەشغۇلات تۈرى تاللىنىدۇ."};
  const n=Number(v.replace(",",".").replace(/^\+/,""));
  if(!Number.isFinite(n))return {ok:false,error:"سان قىممەت كىرگۈزۈڭ."};
  if(n<0)return {ok:false,error:"قوشۇش/ئېلىش بەلگىسى يازماڭ؛ مەشغۇلات تۈرى تاللىنىدۇ."};
  return {ok:true,value:n};
}

function isValidExistingPrice(value){
  if(value===null||value===undefined||value==="")return false;
  if(typeof value==="boolean")return false;
  const n=Number(value);
  if(!Number.isFinite(n))return false;
  return n>=0;
}

function computeNewPrice(oldPrice,operation,amount){
  if(!isValidExistingPrice(oldPrice)){
    return {ok:false,skipped:true,reason:"missing_price"};
  }
  const op=String(operation||"");
  if(!OPERATIONS.includes(op))return {ok:false,error:"مەشغۇلات تۈرى ئىناۋەتسىز."};
  const amt=Number(amount);
  if(!Number.isFinite(amt)||amt<0)return {ok:false,error:"سان قىممەت كىرگۈزۈڭ."};
  const oldC=toCents(oldPrice);
  let nextC;
  if(op==="pct_inc")nextC=Math.round(oldC*(100+amt)/100);
  else if(op==="pct_dec")nextC=Math.round(oldC*(100-amt)/100);
  else if(op==="fixed_inc")nextC=oldC+toCents(amt);
  else nextC=oldC-toCents(amt);
  const value=fromCents(nextC);
  if(value<0)return {ok:false,negative:true,oldPrice:fromCents(oldC),value};
  return {ok:true,oldPrice:fromCents(oldC),value};
}

function normalizeSelectedIds(ids){
  return [...new Set((ids||[]).map(id=>String(id||"").trim()).filter(Boolean))];
}

function selectScopeBooks(books,settings){
  const list=Array.isArray(books)?books:[];
  const scope=String(settings&&settings.scope||"");
  if(!SCOPES.includes(scope))return {ok:false,error:"دائىرە تاللاڭ.",books:[]};
  if(scope==="all")return {ok:true,books:list.slice()};
  if(scope==="category"){
    const source=String(settings&&settings.source||"").trim();
    if(!source)return {ok:false,error:"كاتېگورىيە تاللاڭ.",books:[]};
    return {ok:true,books:list.filter(book=>String(book&&book.source||"")===source)};
  }
  const selected=normalizeSelectedIds(settings&&settings.selectedIds);
  if(!selected.length){
    return {ok:false,error:"كىتاب تاللانمىدى. بۇ دائىرە نۆۋەتتىكى بەتتە تاللانغان كىتابلارغا ئىشلىتىلىدۇ.",books:[],emptySelected:true};
  }
  const want=new Set(selected);
  return {ok:true,books:list.filter(book=>want.has(String(book&&book.id)))};
}

function settingsFingerprint(settings){
  const selected=normalizeSelectedIds(settings&&settings.selectedIds);
  const amount=parseAdjustmentAmount(settings&&settings.amount);
  return JSON.stringify({
    scope:String(settings&&settings.scope||""),
    source:String(settings&&settings.source||"").trim(),
    operation:String(settings&&settings.operation||""),
    amount:amount.ok?amount.value:String(settings&&settings.amount||""),
    selected:String(settings&&settings.scope)==="selected"?selected.sort():[]
  });
}

function buildPreview(books,settings){
  const amount=parseAdjustmentAmount(settings&&settings.amount);
  if(!amount.ok)return {ok:false,error:amount.error,canApply:false};
  const op=String(settings&&settings.operation||"");
  if(!OPERATIONS.includes(op))return {ok:false,error:"مەشغۇلات تۈرى تاللاڭ.",canApply:false};
  const scoped=selectScopeBooks(books,settings);
  if(!scoped.ok)return {ok:false,error:scoped.error,canApply:false,emptySelected:!!scoped.emptySelected};
  const updatable=[],skipped=[],blocked=[];
  scoped.books.forEach(book=>{
    const computed=computeNewPrice(book&&book.price,op,amount.value);
    const row={
      id:book&&book.id,
      title:book&&book.title||"",
      oldPrice:book&&book.price,
      newPrice:computed.value,
      skipped:!!computed.skipped,
      negative:!!computed.negative
    };
    if(computed.skipped)skipped.push(row);
    else if(computed.negative)blocked.push(row);
    else if(computed.ok)updatable.push({...row,oldPrice:computed.oldPrice,newPrice:computed.value});
    else skipped.push({...row,skipped:true});
  });
  const hasNegative=blocked.length>0;
  const canApply=!hasNegative&&updatable.length>0;
  let error="";
  if(hasNegative)error="نەتىجە مەنپىي باھا بولىدۇ. ئۆزگەرتىش ئىجرا قىلىنمايدۇ.";
  else if(!updatable.length)error="يېڭىلىنىدىغان ئىناۋەتلىك باھا تېپىلمىدى.";
  return {
    ok:true,
    canApply,
    error,
    fingerprint:settingsFingerprint(settings),
    operation:op,
    operationLabel:OPERATION_LABELS[op],
    amount:amount.value,
    targeted:scoped.books.length,
    updateCount:updatable.length,
    skippedCount:skipped.length,
    blockedCount:blocked.length,
    hasNegative,
    updatable,
    skipped,
    blocked,
    rows:[...updatable,...blocked,...skipped]
  };
}

function previewPage(rows,page,pageSize){
  const list=Array.isArray(rows)?rows:[];
  const size=Math.max(1,Number(pageSize)||PREVIEW_PAGE_SIZE);
  const pages=Math.max(1,Math.ceil(list.length/size));
  const p=Math.min(Math.max(0,Number(page)||0),pages-1);
  return {
    page:p,
    pages,
    pageSize:size,
    total:list.length,
    rows:list.slice(p*size,(p+1)*size)
  };
}

function canConfirm(preview,settings){
  if(!preview||!preview.canApply||!preview.fingerprint)return false;
  return preview.fingerprint===settingsFingerprint(settings);
}

function formatMoney(value){
  if(!isValidExistingPrice(value))return "—";
  return `${Number(value).toLocaleString("tr-TR")} ₺`;
}

function operationSummary(operation,amount){
  const op=String(operation||"");
  const n=Number(amount);
  if(op==="pct_inc")return `+${n}%`;
  if(op==="pct_dec")return `-${n}%`;
  if(op==="fixed_inc")return `+${n} ₺`;
  if(op==="fixed_dec")return `-${n} ₺`;
  return "";
}

function formatPreviewLine(row){
  const title=row&&row.title?String(row.title):"(نامسىز)";
  if(row&&row.skipped)return `${title}\n${formatMoney(row.oldPrice)} → ئۆتكۈزۈلدى (باھا يوق/ئىناۋەتسىز)`;
  if(row&&row.negative)return `${title}\n${formatMoney(row.oldPrice)} → ${formatMoney(row.newPrice)} (مەنپىي، توسۇلدى)`;
  return `${title}\n${formatMoney(row.oldPrice)} → ${formatMoney(row.newPrice)}`;
}

async function fetchAllMatching(queryFactory,pageSize){
  const size=Math.max(1,Number(pageSize)||FETCH_PAGE);
  const all=[];
  let from=0;
  for(;;){
    const query=queryFactory();
    if(!query||typeof query.range!=="function")throw new Error("PRICE_SCOPE_QUERY");
    const ranged=query.order?query.order("id",{ascending:true}).range(from,from+size-1):query.range(from,from+size-1);
    const {data,error}=await ranged;
    if(error)throw error;
    const chunk=Array.isArray(data)?data:[];
    all.push(...chunk);
    if(chunk.length<size)break;
    from+=size;
  }
  return all;
}

function applyScopeToQuery(query,settings){
  if(!query)return query;
  const scope=String(settings&&settings.scope||"");
  if(scope==="category"){
    const source=String(settings&&settings.source||"").trim();
    if(source&&typeof query.eq==="function")return query.eq("source",source);
  }
  if(scope==="selected"&&typeof query.in==="function"){
    const ids=normalizeSelectedIds(settings&&settings.selectedIds);
    return query.in("id",ids);
  }
  return query;
}

async function applyPriceUpdates(updateOne,rows,opts={}){
  const list=Array.isArray(rows)?rows:[];
  const ok=[],fail=[];
  const concurrency=Math.max(1,Number(opts.concurrency)||WRITE_CONCURRENCY);
  let cursor=0;
  async function worker(){
    while(cursor<list.length){
      const index=cursor++;
      const row=list[index];
      try{
        const result=await updateOne(row.id,{price:row.newPrice});
        if(result&&result.error)fail.push({id:row.id,error:result.error.message||String(result.error)});
        else if(result&&result.skipped)fail.push({id:row.id,error:"يېڭىلانمىدى"});
        else ok.push(row.id);
      }catch(err){
        fail.push({id:row.id,error:err&&err.message||String(err)});
      }
    }
  }
  const workers=Array.from({length:Math.min(concurrency,list.length||1)},()=>worker());
  await Promise.all(workers);
  const fullSuccess=fail.length===0&&ok.length===list.length;
  return {
    ok,
    fail,
    okCount:ok.length,
    failCount:fail.length,
    fullSuccess,
    text:fullSuccess
      ?`${ok.length} كىتابنىڭ باھاسى يېڭىلاندى`
      :`باھا ئۆزگەرتىش تولۇق تاماملانمىدى: ${ok.length} يېڭىلاندى، ${fail.length} مەغلۇپ`
  };
}

const api={
  SCOPES,
  OPERATIONS,
  FETCH_PAGE,
  PREVIEW_PAGE_SIZE,
  OPERATION_LABELS,
  roundMoney,
  parseAdjustmentAmount,
  isValidExistingPrice,
  computeNewPrice,
  selectScopeBooks,
  settingsFingerprint,
  buildPreview,
  previewPage,
  canConfirm,
  formatMoney,
  operationSummary,
  formatPreviewLine,
  fetchAllMatching,
  applyScopeToQuery,
  applyPriceUpdates
};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
root.KutadguAdminBulkPrice=api;
})(typeof window!=="undefined"?window:typeof globalThis!=="undefined"?globalThis:{});
