(function(root){
"use strict";

const Quality=root.KutadguAdminQuality||(typeof require==="function"?require("./admin-book-quality.js"):{});
const Write=root.KutadguAdminWrite||(typeof require==="function"?require("./admin-book-write.js"):{});
const Safe=root.KutadguSafeUrl||(typeof require==="function"?require("./kutadgu-safe-url.js"):{});

const PROTECTED_FIELDS=["id","legacy_id","sales_count","created_at","updated_at"];
const QUICK_EDIT_FIELDS=["title","author","price","source","category","stock","stock_status","is_active","is_recommended","is_new","image_url"];
const ALLOWED_BULK_ACTIONS=["category","stock_status","stock","publisher","recommended_on","recommended_off","new_on","new_off","activate","deactivate"];
const PROBLEM_FILTERS=["missing_title","missing_author","missing_category","missing_price","missing_cover","inactive","missing_stock","missing_stock_status"];

function normalizeText(value){
  if(Quality.normalizeCatalogText)return Quality.normalizeCatalogText(value);
  return String(value??"").replace(/\s+/g," ").trim();
}

function isMissingTitle(value){
  return !normalizeText(value);
}

function isMissingCategory(book){
  const source=normalizeText(book&&book.source);
  const category=normalizeText(book&&book.category);
  return !source&&!category;
}

function isMissingOrInvalidPrice(value){
  if(value===null||value===undefined||value==="")return true;
  const n=Number(value);
  if(!Number.isFinite(n))return true;
  return n<0;
}

function isMissingStock(value){
  return value===null||value===undefined||value==="";
}

function isMissingStockStatus(value){
  return !normalizeText(value);
}

function isInactive(book){
  return book&&book.is_active===false;
}

function problemFilterSpec(problem){
  const q=String(problem||"").trim();
  if(!q)return null;
  if(q==="missing_title"){
    return {or:'title.is.null,title.eq.""'};
  }
  if(q==="missing_author"){
    return Quality.qualityFilterSpec?Quality.qualityFilterSpec("missing_author"):null;
  }
  if(q==="missing_category"){
    return {or:'source.is.null,source.eq."",category.is.null,category.eq.""'};
  }
  if(q==="missing_price"){
    return {or:"price.is.null,price.lt.0"};
  }
  if(q==="missing_cover"){
    return Quality.qualityFilterSpec?Quality.qualityFilterSpec("placeholder_cover"):null;
  }
  if(q==="inactive"){
    return {eq:["is_active",false]};
  }
  if(q==="missing_stock"){
    return {or:"stock.is.null"};
  }
  if(q==="missing_stock_status"){
    return {or:'stock_status.is.null,stock_status.eq.""'};
  }
  return null;
}

function applyProblemFilter(query,problem){
  const spec=problemFilterSpec(problem);
  if(!spec||!query)return query;
  if(spec.or&&typeof query.or==="function")query=query.or(spec.or);
  if(spec.eq&&typeof query.eq==="function")query=query.eq(spec.eq[0],spec.eq[1]);
  if(spec.ands){
    spec.ands.forEach(step=>{
      const fn=query[step.method];
      if(typeof fn==="function")query=fn.apply(query,step.args);
    });
  }
  return query;
}

function bookMatchesProblem(book,problem,opts={}){
  const q=String(problem||"").trim();
  if(!q)return true;
  if(q==="missing_title")return isMissingTitle(book&&book.title);
  if(q==="missing_author")return Quality.isMissingAuthor?Quality.isMissingAuthor(book&&book.author):isMissingTitle(book&&book.author);
  if(q==="missing_category")return isMissingCategory(book);
  if(q==="missing_price")return isMissingOrInvalidPrice(book&&book.price);
  if(q==="missing_cover")return Quality.isPlaceholderCover?Quality.isPlaceholderCover(book&&(book.image_url||book.image)):!(book&&book.image_url);
  if(q==="inactive")return isInactive(book);
  if(q==="missing_stock"){
    if(opts.stockSupported===false)return false;
    return isMissingStock(book&&book.stock);
  }
  if(q==="missing_stock_status"){
    if(opts.stockStatusSupported===false)return false;
    return isMissingStockStatus(book&&book.stock_status);
  }
  return true;
}

function filterLoadedBooks(books,filters,opts={}){
  const list=Array.isArray(books)?books:[];
  const q=normalizeText(filters&&filters.q).toLocaleLowerCase("ug");
  return list.filter(book=>{
    if(filters&&filters.source&&String(book.source||"")!==String(filters.source))return false;
    if(filters&&filters.active==="yes"&&book.is_active===false)return false;
    if(filters&&filters.active==="no"&&book.is_active!==false)return false;
    if(filters&&filters.recommended==="yes"&&book.is_recommended!==true)return false;
    if(filters&&filters.recommended==="no"&&book.is_recommended===true)return false;
    if(filters&&filters.isNew==="yes"&&book.is_new!==true)return false;
    if(filters&&filters.isNew==="no"&&book.is_new===true)return false;
    if(filters&&filters.quality&&Quality.qualityIssues){
      const issues=Quality.qualityIssues(book,{
        descriptionSupported:opts.descriptionSupported!==false,
        isbnSupported:opts.isbnSupported!==false
      });
      const quality=String(filters.quality);
      if(quality==="complete"&&issues.length)return false;
      if(quality==="missing_author"&&!issues.includes("author"))return false;
      if(quality==="placeholder_cover"&&!issues.includes("cover"))return false;
      if(quality==="missing_description"&&!issues.includes("description"))return false;
      if(quality==="missing_isbn"&&!issues.includes("isbn"))return false;
    }
    if(filters&&filters.problem&&!bookMatchesProblem(book,filters.problem,opts))return false;
    if(q){
      const hay=`${book.title||""} ${book.author||""} ${book.isbn||""}`.toLocaleLowerCase("ug");
      if(!hay.includes(q))return false;
    }
    return true;
  });
}

function stripProtectedFields(payload){
  const out={...(payload||{})};
  PROTECTED_FIELDS.forEach(key=>delete out[key]);
  if(Write.stripIdentityFields){
    const stripped=Write.stripIdentityFields(out);
    delete stripped.sales_count;
    return stripped;
  }
  delete out.sales_count;
  return out;
}

function parseQuickPrice(raw){
  if(raw===null||raw===undefined||String(raw).trim()==="")return {ok:true,value:null};
  const n=Number(raw);
  if(!Number.isFinite(n))return {ok:false,error:"باھا سان بولسۇن"};
  if(n<0)return {ok:false,error:"باھا مەنپىي بولماسلىقى كېرەك"};
  return {ok:true,value:n};
}

function parseQuickStock(raw,present){
  if(!present)return {ok:true,omit:true};
  if(raw===null||raw===undefined||String(raw).trim()==="")return {ok:true,value:null};
  const n=Number(raw);
  if(!Number.isInteger(n)||n<0)return {ok:false,error:"ئامبار سانى توغرا پۈتۈن سان بولسۇن"};
  return {ok:true,value:n};
}

function buildQuickEditPatch(input,opts={}){
  const present=opts.presentBookCols instanceof Set?opts.presentBookCols:new Set(opts.presentBookCols||[]);
  const title=normalizeText(input&&input.title);
  if(!title)return {ok:false,error:"كىتاب ئىسمى كېرەك."};
  const source=String(input&&input.source||"").trim();
  if(!source)return {ok:false,error:"كىتاب تۈرىنى تاللاڭ."};
  const price=parseQuickPrice(input&&input.price);
  if(!price.ok)return price;
  const stock=parseQuickStock(input&&input.stock,present.has("stock")||opts.stockSupported===true);
  if(!stock.ok)return stock;
  const patch={
    title,
    author:normalizeText(input&&input.author),
    price:price.value,
    source,
    category:String(input&&input.category||"").trim()||source,
    is_active:input&&input.is_active!==false,
    is_recommended:input&&input.is_recommended===true,
    is_new:input&&input.is_new===true
  };
  if(present.has("stock_status")||opts.stockStatusSupported){
    patch.stock_status=String(input&&input.stock_status||"in_stock");
  }
  if(!stock.omit)patch.stock=stock.value;
  const cover=String(input&&input.image_url||"").trim();
  if(Object.prototype.hasOwnProperty.call(input||{},"image_url")){
    if(cover&&Safe.isSafeCoverUrl&&!Safe.isSafeCoverUrl(cover)){
      return {ok:false,error:Safe.COVER_URL_ERROR||"مۇقاۋا URL بىخەتەر ئەمەس."};
    }
    patch.image_url=cover;
  }
  const safe=stripProtectedFields(patch);
  const leaked=PROTECTED_FIELDS.filter(k=>Object.prototype.hasOwnProperty.call(safe,k));
  if(leaked.length)return {ok:false,error:"قوغدىلىدىغان مەيدان يېزىلمايدۇ"};
  return {ok:true,patch:safe};
}

function bulkFieldLabel(action){
  const map={
    category:"تۈر",
    stock_status:"ئامبار ھالىتى",
    stock:"ئامبار سانى",
    publisher:"نەشرىيات",
    recommended_on:"تەۋسىيە",
    recommended_off:"تەۋسىيە",
    new_on:"يېڭى بەلگىسى",
    new_off:"يېڭى بەلگىسى",
    activate:"كۆرۈنۈش",
    deactivate:"كۆرۈنۈش"
  };
  return map[action]||action;
}

function buildBulkPatch(action,values,opts={}){
  const present=opts.presentBookCols instanceof Set?opts.presentBookCols:new Set(opts.presentBookCols||[]);
  const act=String(action||"");
  if(!ALLOWED_BULK_ACTIONS.includes(act))return {ok:false,error:"بۇ توپلام مەشغۇلات رۇخسەت قىلىنمايدۇ"};
  let patch=null,valueLabel="";
  if(act==="category"){
    const source=String(values&&values.source||"").trim();
    if(!source)return {ok:false,error:"تۈر تاللاڭ."};
    patch={source,category:String(values.category||source)};
    valueLabel=patch.category;
  }else if(act==="stock_status"){
    if(!present.has("stock_status")&&opts.stockStatusSupported!==true)return {ok:false,error:"stock_status يوق"};
    patch={stock_status:String(values&&values.stock_status||"")};
    valueLabel=patch.stock_status;
  }else if(act==="stock"){
    if(!present.has("stock")&&opts.stockSupported!==true)return {ok:false,error:"stock يوق"};
    const n=Number(values&&values.stock);
    if(!Number.isInteger(n)||n<0)return {ok:false,error:"ئامبار سانى توغرا پۈتۈن سان بولسۇن."};
    patch={stock:n};
    valueLabel=String(n);
  }else if(act==="publisher"){
    if(!present.has("publisher")&&opts.publisherSupported!==true)return {ok:false,error:"publisher يوق"};
    patch={publisher:String(values&&values.publisher||"").trim()};
    valueLabel=patch.publisher||"(بوش)";
  }else if(act==="recommended_on"){patch={is_recommended:true};valueLabel="قوزغىتىلغان"}
  else if(act==="recommended_off"){patch={is_recommended:false};valueLabel="ئېلىندى"}
  else if(act==="new_on"){patch={is_new:true};valueLabel="قوزغىتىلغان"}
  else if(act==="new_off"){patch={is_new:false};valueLabel="ئېلىندى"}
  else if(act==="activate"){patch={is_active:true};valueLabel="كۆرۈنىدۇ"}
  else if(act==="deactivate"){patch={is_active:false};valueLabel="يوشۇرۇلغان"}
  const safe=stripProtectedFields(patch||{});
  return {
    ok:true,
    patch:safe,
    field:bulkFieldLabel(act),
    valueLabel,
    action:act
  };
}

function formatBulkConfirm({count,field,value}){
  const n=Number(count)||0;
  return `${n} دانە كىتاب يېڭىلىنىدۇ.\nمەيدان: ${field}\nيېڭى قىممەت: ${value}\nپەقەت تاللانغان ID لار يېڭىلىنىدۇ؛ پۈتۈن كاتالوگ ئەمەس.`;
}

function summarizeBulkResults({ok,fail}){
  const okN=(ok||[]).length;
  const failN=(fail||[]).length;
  const full=failN===0;
  return {
    okCount:okN,
    failCount:failN,
    fullSuccess:full,
    text:`${okN} يېڭىلاندى، ${failN} مەغلۇپ`
  };
}

async function applyBulkUpdates(updateOne,ids,patch){
  const ok=[],fail=[];
  for(const id of ids||[]){
    try{
      const result=await updateOne(id,patch);
      if(result&&result.error){
        fail.push({id,error:result.error.message||String(result.error)});
      }else if(result&&result.skipped){
        fail.push({id,error:result.error&&result.error.message||"يېڭىلانمىدى"});
      }else ok.push(id);
    }catch(err){
      fail.push({id,error:err&&err.message||String(err)});
    }
  }
  return {ok,fail,...summarizeBulkResults({ok,fail})};
}

function assertVisibleSelection(ids,pageSize){
  if(!Array.isArray(ids)||ids.length===0)throw new Error("NO_SELECTED_IDS");
  const cap=Number(pageSize)||40;
  if(ids.length>cap)throw new Error("SELECTED_IDS_EXCEED_PAGE");
}

function mergeBookPatch(list,id,patch){
  return (list||[]).map(book=>{
    if(String(book.id)!==String(id))return book;
    return {...book,...patch};
  });
}

const api={
  PROTECTED_FIELDS,
  QUICK_EDIT_FIELDS,
  ALLOWED_BULK_ACTIONS,
  PROBLEM_FILTERS,
  isMissingTitle,
  isMissingCategory,
  isMissingOrInvalidPrice,
  isMissingStock,
  isMissingStockStatus,
  problemFilterSpec,
  applyProblemFilter,
  bookMatchesProblem,
  filterLoadedBooks,
  stripProtectedFields,
  buildQuickEditPatch,
  buildBulkPatch,
  formatBulkConfirm,
  summarizeBulkResults,
  applyBulkUpdates,
  assertVisibleSelection,
  mergeBookPatch
};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
root.KutadguAdminProductivity=api;
})(typeof window!=="undefined"?window:typeof globalThis!=="undefined"?globalThis:{});
