(function(){
"use strict";
const Legacy=window.KutadguLegacyIds||{};
function sanitizeQty(raw){return Legacy.sanitizeCartQty?Legacy.sanitizeCartQty(raw):Math.max(1,Math.min(99,parseInt(String(raw??1),10)||1))}
function isCanonicalBookId(value){return Legacy.isCanonicalBookId?Legacy.isCanonicalBookId(value):/^\d+$/.test(String(value||"").trim())}
function uniqueVisibleBooks(books){return Legacy.uniqueVisibleBooks?Legacy.uniqueVisibleBooks(books):[...new Map((books||[]).filter(b=>b&&b.id).map(b=>[String(b.id),b])).values()]}
function splitLookupIds(ids){return Legacy.splitLookupIds?Legacy.splitLookupIds(ids):{numeric:(ids||[]).map(String).filter(isCanonicalBookId),legacy:(ids||[]).map(String).filter(id=>id&&!isCanonicalBookId(id))}}
function quotePostgrestValue(value){return Legacy.quotePostgrestValue?Legacy.quotePostgrestValue(value):`"${String(value).replace(/["\\]/g,"")}"`}
function legacyIdSupported(){return bibliographicColumnEnabled("legacy_id")}
function bibliographicLib(){return window.KutadguBibliography||{}}
function bibliographicColumnEnabled(col){
  const lib=bibliographicLib();
  if(lib.schemaOptional)return lib.schemaOptional(window.KUTADGU_BOOKS_SCHEMA,col);
  return window.KUTADGU_BOOKS_SCHEMA?.optionalColumns?.[col]!==false;
}
function disableBibliographicColumns(cols){
  const lib=bibliographicLib();
  if(lib.disableOptionalColumns){
    window.KUTADGU_BOOKS_SCHEMA=lib.disableOptionalColumns(window.KUTADGU_BOOKS_SCHEMA||{optionalColumns:{}},cols);
  }else{
    window.KUTADGU_BOOKS_SCHEMA=window.KUTADGU_BOOKS_SCHEMA||{optionalColumns:{}};
    window.KUTADGU_BOOKS_SCHEMA.optionalColumns=window.KUTADGU_BOOKS_SCHEMA.optionalColumns||{};
    (cols||[]).forEach(col=>{window.KUTADGU_BOOKS_SCHEMA.optionalColumns[col]=false});
  }
}

function normalizeGalleryImages(value,coverUrl){
  const fn=window.KutadguGallery?.normalizeGalleryImages;
  if(fn)return fn(value,{coverUrl});
  if(!Array.isArray(value))return [];
  const cover=String(coverUrl||"").trim();
  const seen=new Set();
  const out=[];
  value.forEach(item=>{
    const url=String(item||"").trim();
    if(!url||url.startsWith("data:")||/[<>"']/.test(url))return;
    if(/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)&&!/^https?:\/\//i.test(url))return;
    if((cover&&url===cover)||seen.has(url))return;
    seen.add(url);
    out.push(url);
  });
  return out.slice(0,4);
}
function normalizeCatalogBook(book,index=0,isRemote=false){
  const price=(book.price===null||book.price===undefined||book.price==="")?null:Number(book.price);
  const value=(camel,snake,defaultValue="")=>book[camel]??book[snake]??defaultValue;
  const flag=(camel,snake,defaultValue=false)=>value(camel,snake,defaultValue)===true;
  const id=String(book.id||"").trim();
  const legacyId=String(value("legacyId","legacy_id","")||"").trim();
  return {
    id,
    legacyId,
    title:book.title||"",
    author:book.author||"",
    isbn:String(value("isbn","isbn","")||"").trim(),
    price:Number.isFinite(price)?price:null,
    priceText:Number.isFinite(price)?money(price):"باھا تېخى بېكىتىلمىگەن",
    category:book.category||"",
    subcategory:book.subcategory||"",
    source:book.source||"universal.html",
    image:value("image","image_url","")||"",
    galleryImages:normalizeGalleryImages(value("galleryImages","gallery_images",[]),value("image","image_url","")||""),
    href:isRemote?`book.html?id=${encodeURIComponent(id)}`:(book.href||`book.html?id=${encodeURIComponent(id)}`),
    pages:book.pages??null,
    translator:book.translator||"",
    language:book.language||"",
    publishDate:value("publishDate","publish_date","")||"",
    publishYear:value("publishYear","publish_year","")||"",
    publisher:book.publisher||"",
    coverType:value("coverType","cover_type","")||"",
    dimensions:value("dimensions","book_size",value("dimensions","dimensions",""))||"",
    description:book.description||"",
    stock:book.stock??null,
    stockStatus:value("stockStatus","stock_status","")||"",
    isNew:flag("isNew","is_new",false),
    isFeatured:flag("isFeatured","is_featured",false),
    // is_featured is retained as legacy data, but new collection logic uses is_recommended only.
    isRecommended:flag("isRecommended","is_recommended",false),
    isBestSeller:flag("isBestSeller","is_bestseller",false),
    salesCount:Number(value("salesCount","sales_count",book.sold_count??0))||0,
    isActive:value("isActive","is_active",true)!==false,
    createdAt:value("createdAt","created_at","")||"",
    updatedAt:value("updatedAt","updated_at","")||"",
    isRemote,
    catalogOrder:index
  };
}
const STATIC_CATALOG=[...(window.KITAP_CATALOG||[])].map((book,index)=>normalizeCatalogBook(book,index,false)).filter(book=>book.id);
const catalogCache=new Map(STATIC_CATALOG.map(book=>[book.id,book]));
const bookLookupFallback=new Map(STATIC_CATALOG.flatMap(book=>book.legacyId&&book.legacyId!==book.id?[[book.id,book],[book.legacyId,book]]:[[book.id,book]]));
const ALIAS_KEY="kutadgu-id-aliases-v1";
let remoteVisible=false;
let inactiveRemoteKeys=new Set();
let C=uniqueVisibleBooks([...catalogCache.values()]);
let catalogStatus={source:"static",remoteCount:0,total:STATIC_CATALOG.length,migrated:false,error:""};
const QUERY_DEFAULTS=Object.freeze({
  offset:0,pageSize:24,category:"",source:"",search:"",sort:"new",
  minPrice:null,maxPrice:null,featured:false,recommended:false,bestseller:false,newOnly:false,allowZeroSales:false,
  ids:null,includeInactive:false
});
const catalogQueryState={
  search:{...QUERY_DEFAULTS},
  listing:{...QUERY_DEFAULTS},
  carousel:{...QUERY_DEFAULTS,pageSize:8},
  detail:{...QUERY_DEFAULTS,pageSize:1}
};
const remoteCatalog={configured:false,available:false,total:null};
const CATALOG_BOOT_TIMEOUT_MS=8000;
const CART_KEY="kutadgu-cart-v1", FAV_KEY="kutadgu-favorites-v1", REC_KEY="kutadgu-recent-v1", CUSTOMER_KEY="kutadgu-customer-v1";
const FALLBACK_COVER="sample-book-cover.png";
const COVER_LAYOUT_TEST_MODE=window.KUTADGU_COVER_LAYOUT_TEST_MODE===true;
const coverSrc=book=>COVER_LAYOUT_TEST_MODE?FALLBACK_COVER:(book?.image||FALLBACK_COVER);
const get=(k,d=[])=>{try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}};
const set=(k,v)=>{
  try{
    localStorage.setItem(k,JSON.stringify(v));
    window.KutadguMember?.syncKey?.(k,v);
    return true;
  }catch(error){
    console.warn("Local storage is unavailable; the current action was not saved.",error);
    toast("ساقلاش مۇمكىن بولمىدى؛ توركۆرگۈ ساقلاش ئىجازىتىنى تەكشۈرۈڭ.");
    return false;
  }
};
function visibilityContext(){
  return {remoteAvailable:!!remoteCatalog.available,inactiveKeys:inactiveRemoteKeys};
}
function isStorefrontVisible(book){
  const fn=window.KutadguVisibility?.isStorefrontVisible;
  if(fn)return fn(book,visibilityContext());
  if(!book||!String(book.id||"").trim())return false;
  if(book.isActive===false)return false;
  if(remoteCatalog.available){
    if(inactiveRemoteKeys.has(String(book.id||"")))return false;
    if(book.legacyId&&inactiveRemoteKeys.has(String(book.legacyId)))return false;
  }
  return true;
}
function indexCatalogBook(book){
  if(!book?.id)return;
  catalogCache.set(String(book.id),book);
  bookLookupFallback.set(String(book.id),book);
  persistBookAliases(book);
  if(book.legacyId){
    catalogCache.set(String(book.legacyId),book);
    bookLookupFallback.set(String(book.legacyId),book);
  }
}
function persistedAliases(){
  const raw=get(ALIAS_KEY,{});
  return raw&&typeof raw==="object"&&!Array.isArray(raw)?raw:{};
}
function persistBookAliases(book){
  if(!book?.id||!book.legacyId||String(book.id)===String(book.legacyId))return;
  const current=persistedAliases();
  const next=Legacy.rememberBookAliases?Legacy.rememberBookAliases(book,current):{...current,[String(book.id)]:String(book.legacyId),[String(book.legacyId)]:String(book.id)};
  if(JSON.stringify(next)===JSON.stringify(current))return;
  try{localStorage.setItem(ALIAS_KEY,JSON.stringify(next))}catch(error){}
}
function rebuildVisibleCatalog(){
  C=uniqueVisibleBooks([...catalogCache.values()]).filter(isStorefrontVisible);
  window.KUTADGU_LIVE_CATALOG=C;
  return C;
}
function beginRemoteVisibleCatalog(){
  if(remoteVisible)return;
  catalogCache.clear();
  remoteVisible=true;
}
function refreshStorefrontVisibility(){
  rebuildVisibleCatalog();
  syncStaticCards();
  decorateDetail();
  renderFavoritesPage();
  cartPage();
}
function restoreStaticVisibleCatalog(){
  catalogCache.clear();
  remoteVisible=false;
  inactiveRemoteKeys=new Set();
  STATIC_CATALOG.forEach(indexCatalogBook);
  rebuildVisibleCatalog();
}
const find=id=>{
  const key=String(id||"").trim();
  if(!key)return;
  if(Legacy.lookupBook){
    return Legacy.lookupBook(key,{
      cache:catalogCache,
      fallback:bookLookupFallback,
      staticBooks:STATIC_CATALOG,
      aliases:persistedAliases()
    })||undefined;
  }
  return catalogCache.get(key)||bookLookupFallback.get(key)||STATIC_CATALOG.find(book=>String(book.id)===key||String(book.legacyId)===key);
};
function canonicalId(id){
  const book=find(id);
  return book?.id||String(id||"");
}
const HOMEPAGE_DOCUMENT_TITLE="قۇتادغۇبىلىك كىتابخانىسى";
function storefrontPageFile(){
  return (location.pathname||"/").split("/").pop().split(/[?#]/)[0]||"";
}
function isStorefrontHomepage(){
  const file=storefrontPageFile();
  return file===""||file==="index.html";
}
function isBookDetailDocument(){
  if(isStorefrontHomepage())return false;
  if(document.body.hasAttribute("data-dynamic-book"))return true;
  if(storefrontPageFile()==="book.html")return true;
  return !!document.querySelector(".book-detail-page,.book-detail-info");
}
function applyHomepageDocumentTitle(){
  document.title=HOMEPAGE_DOCUMENT_TITLE;
}
const appConfig=()=>window.KUTADGU_APP_CONFIG||{};
const featureEnabled=name=>appConfig().featureFlags?.[name]!==false;
const trackEvent=(name,data={})=>{try{window.KutadguAnalytics?.track?.(name,data)}catch(err){}};
const trackedBookViews=new Set();
function trackBookViewOnce(book){
  try{
    if(!book)return;
    const id=String(book.id||"").trim();
    const canonical=/^\d+$/.test(id)?id:(window.KutadguLegacyIds?.isCanonicalBookId?.(id)?id:"");
    if(!canonical)return;
    if(trackedBookViews.has(canonical))return;
    trackedBookViews.add(canonical);
    trackEvent("book_view",{bookId:canonical,legacyId:book.legacyId||"",category:book.category||""});
  }catch(err){}
}
function trackSearchQuery(query,resultCount){
  try{
    const events=window.KutadguAnalyticsCore?.searchEvents
      ?window.KutadguAnalyticsCore.searchEvents(query,resultCount)
      :(String(query||"").trim()?[{name:"search",data:{query:String(query).trim().slice(0,80),results:Number(resultCount)||0}}]:[]);
    events.forEach(ev=>trackEvent(ev.name,ev.data));
  }catch(err){}
}

function supabasePublicConfig(){
  const c=window.KUTADGU_SUPABASE_CONFIG||{};
  return {
    url:String(c.url||"").replace(/\/+$/,""),
    key:String(c.anonKey||c.publishableKey||"")
  };
}

function normalizeRemoteBook(row,index=0){return normalizeCatalogBook(row,index,true)}

function refreshCatalogCache(books=[]){
  const list=(books||[]).filter(book=>book?.id);
  if(remoteCatalog.available&&list.length)beginRemoteVisibleCatalog();
  list.forEach(indexCatalogBook);
  rebuildVisibleCatalog();
  return list;
}

function isPlaceholderAuthor(value){
  const author=String(value||"").replace(/\s+/g," ").trim();
  return !author||author==="—"||author==="ئاپتور ئىسمى";
}
function storefrontAuthor(book){
  const author=book&&book.author;
  return isPlaceholderAuthor(author)?"":String(author).trim();
}
function storefrontIsbn(book){
  return String(book&&book.isbn||"").replace(/[\s-]+/g,"").trim();
}
function cleanSearchTerm(value){
  return String(value||"").replace(/[%_*,()]/g," ").replace(/\s+/g," ").trim().slice(0,120);
}

function pageSize(){return window.innerWidth<=700?12:24}

function normalizeQueryState(input={}){
  const requested=Number(input.pageSize);
  return {
    ...QUERY_DEFAULTS,
    ...input,
    offset:Math.max(0,Number(input.offset)||0),
    pageSize:Math.max(1,Math.min(100,Number.isFinite(requested)?requested:pageSize())),
    search:cleanSearchTerm(input.search),
    minPrice:input.minPrice===""||input.minPrice===null||input.minPrice===undefined?null:Number(input.minPrice),
    maxPrice:input.maxPrice===""||input.maxPrice===null||input.maxPrice===undefined?null:Number(input.maxPrice),
    includeInactive:!!input.includeInactive
  };
}

function staticQueryPage(input={}){
  const state=normalizeQueryState(input),q=normalizeText(state.search);
  let rows=STATIC_CATALOG.filter(isStorefrontVisible);
  if(state.ids?.length){const ids=new Set(state.ids.map(String));rows=rows.filter(book=>ids.has(book.id)||(book.legacyId&&ids.has(book.legacyId)))}
  if(state.source)rows=rows.filter(book=>book.source===state.source);
  if(state.category)rows=rows.filter(book=>book.category===state.category);
  if(q)rows=rows.filter(book=>{
    const hay=bibliographicLib().staticSearchHaystack
      ?bibliographicLib().staticSearchHaystack(book)
      :[book.title,book.author,book.category,book.translator,book.publisher,book.isbn].filter(Boolean).join(" ");
    return normalizeText(hay).includes(q)||normalizeText(String(book.isbn||"").replace(/[\s-]+/g,"")).includes(q);
  });
  if(Number.isFinite(state.minPrice))rows=rows.filter(book=>Number.isFinite(Number(book.price))&&Number(book.price)>=state.minPrice);
  if(Number.isFinite(state.maxPrice))rows=rows.filter(book=>Number.isFinite(Number(book.price))&&Number(book.price)<=state.maxPrice);
  if(state.newOnly)rows=rows.filter(book=>book.isNew===true);
  if(state.featured||state.recommended)rows=rows.filter(book=>book.isRecommended===true);
  if(state.bestseller&&!state.allowZeroSales)rows=rows.filter(book=>Number(book.salesCount)>0);
  rows=sortBooks(rows,state.sort);
  const total=rows.length,items=rows.slice(state.offset,state.offset+state.pageSize);
  return {items,total,hasMore:state.offset+items.length<total,offset:state.offset,pageSize:state.pageSize,source:"static"};
}

function remoteOrder(mode){
  if(mode==="priceLow")return "price.asc.nullslast,id.asc";
  if(mode==="priceHigh")return "price.desc.nullslast,id.asc";
  if(mode==="title")return "title.asc,id.asc";
  if(mode==="author")return "author.asc,id.asc";
  if(mode==="bestseller")return "sales_count.desc,created_at.desc.nullslast,id.asc";
  if(mode==="recommended")return "is_recommended.desc,created_at.desc.nullslast,id.asc";
  return "created_at.desc.nullslast,id.asc";
}

function remoteBooksUrl(input={}){
  const cfg=supabasePublicConfig(),state=normalizeQueryState(input),params=new URLSearchParams({select:"*"});
  if(!state.includeInactive)params.set("is_active","eq.true");
  const logic=[];
  if(state.ids?.length){
    const {numeric,legacy}=splitLookupIds(state.ids);
    const idParts=[];
    if(numeric.length)idParts.push(`id.in.(${numeric.join(",")})`);
    if(legacy.length&&legacyIdSupported())idParts.push(`legacy_id.in.(${legacy.map(quotePostgrestValue).join(",")})`);
    if(idParts.length===1&&numeric.length&&!legacy.length)params.set("id",`in.(${numeric.join(",")})`);
    else if(idParts.length===1&&legacy.length)params.set("legacy_id",`in.(${legacy.map(quotePostgrestValue).join(",")})`);
    else if(idParts.length>1)logic.push(`or(${idParts.join(",")})`);
    else params.set("id","eq.-1");
  }
  if(state.source)params.set("source",`eq.${state.source}`);
  if(state.category)params.set("category",`eq.${state.category}`);
  if(Number.isFinite(state.minPrice))params.set("price",`gte.${state.minPrice}`);
  if(Number.isFinite(state.maxPrice))params.append("price",`lte.${state.maxPrice}`);
  if(state.bestseller&&!state.allowZeroSales)params.set("sales_count","gt.0");

  if(state.search){
    const term=`*${state.search}*`;
    const cols=bibliographicLib().storefrontSearchColumns
      ?bibliographicLib().storefrontSearchColumns(window.KUTADGU_BOOKS_SCHEMA)
      :["title","author","category"];
    const parts=cols.map(col=>`${col}.ilike.${term}`);
    const digits=(bibliographicLib().normalizeIsbnDigits||(v=>String(v||"").replace(/[\s-]+/g,"")))(state.search);
    if(cols.includes("isbn")&&digits&&digits!==state.search)parts.push(`isbn.ilike.*${digits}*`);
    if(cols.includes("isbn")&&/^[0-9X]+$/i.test(digits))parts.push(`isbn.eq.${digits}`);
    logic.push(`or(${parts.join(",")})`);
  }
  if(state.newOnly)params.set("is_new","eq.true");
  if(state.featured||state.recommended)params.set("is_recommended","eq.true");
  if(logic.length===1){
    const expression=logic[0];
    params.set("or",`(${expression.slice(3,-1)})`);
  }else if(logic.length>1)params.set("and",`(${logic.join(",")})`);
  params.set("order",remoteOrder(state.sort));
  return {url:`${cfg.url}/rest/v1/books?${params.toString()}`,state,cfg};
}

function totalFromContentRange(value){
  const match=String(value||"").match(/\/(\d+|\*)$/);
  return match&&match[1]!=="*"?Number(match[1]):null;
}

async function fetchRemotePage(input={},options={}){
  if(!remoteCatalog.available)throw new Error("Supabase catalog is unavailable");
  const {url,state,cfg}=remoteBooksUrl(input),from=state.offset,to=from+state.pageSize-1;
  const response=await fetch(url,{
    signal:options.signal,
    headers:{
      apikey:cfg.key,Authorization:`Bearer ${cfg.key}`,Prefer:"count=exact",
      "Range-Unit":"items",Range:`${from}-${to}`
    }
  });
  if(!response.ok&&response.status!==416){
    let body="";
    try{body=await response.text()}catch(err){body=""}
    const missing=bibliographicLib().missingColumnsFromError
      ?bibliographicLib().missingColumnsFromError({message:body})
      :[];
    if(missing.length&&!options._bibRetry){
      disableBibliographicColumns(bibliographicLib().BIB_OPTIONAL_COLS||missing);
      return fetchRemotePage(input,{...options,_bibRetry:true});
    }
    throw new Error(`Catalog query failed (HTTP ${response.status})`);
  }
  const rows=response.status===416?[]:await response.json();
  if(!Array.isArray(rows))throw new Error("Catalog query returned invalid data");
  const fetched=refreshCatalogCache(rows.map((row,index)=>normalizeRemoteBook(row,from+index)).filter(book=>book.id));
  const items=state.includeInactive?fetched:fetched.filter(isStorefrontVisible);
  const exactTotal=totalFromContentRange(response.headers.get("content-range"));
  const total=Number.isFinite(exactTotal)?exactTotal:from+items.length+(items.length===state.pageSize?1:0);
  catalogStatus={source:"supabase",remoteCount:C.length,total:exactTotal,migrated:true,error:""};
  window.KUTADGU_CATALOG_STATUS=catalogStatus;
  return {items,total,hasMore:Number.isFinite(exactTotal)?from+items.length<exactTotal:items.length===state.pageSize,offset:from,pageSize:state.pageSize,source:"supabase"};
}

async function queryCatalog(input={},options={}){
  const state=normalizeQueryState(input);
  if(remoteCatalog.available){
    try{return await fetchRemotePage(state,options)}
    catch(error){
      if(error?.name==="AbortError")throw error;
      console.error("Supabase catalog query failed; static fallback is being used.",error);
      restoreStaticVisibleCatalog();
      catalogStatus={...catalogStatus,source:"static",error:String(error?.message||error)};
      window.KUTADGU_CATALOG_STATUS=catalogStatus;
    }
  }
  return staticQueryPage(state);
}

async function loadInactiveRemoteIndex(){
  if(!remoteCatalog.available){
    inactiveRemoteKeys=new Set();
    rebuildVisibleCatalog();
    return;
  }
  const cfg=supabasePublicConfig();
  const pager=window.KutadguVisibility?.loadInactiveKeysPaged;
  try{
    const fetchPage=async(from,to)=>{
      const response=await fetch(`${cfg.url}/rest/v1/books?select=id,legacy_id&is_active=eq.false`,{
        headers:{
          apikey:cfg.key,Authorization:`Bearer ${cfg.key}`,Prefer:"count=exact",
          "Range-Unit":"items",Range:`${from}-${to}`
        }
      });
      if(!response.ok)throw new Error(`Inactive index failed (HTTP ${response.status})`);
      const rows=await response.json();
      return Array.isArray(rows)?rows:[];
    };
    inactiveRemoteKeys=pager
      ?await pager(fetchPage,{pageSize:1000})
      :await (async()=>{
        const next=new Set();
        let from=0;
        for(;;){
          const rows=await fetchPage(from,from+999);
          if(!rows.length)break;
          rows.forEach(row=>{
            const id=String(row&&row.id||"").trim();
            const legacy=String(row&&row.legacy_id||"").trim();
            if(id)next.add(id);
            if(legacy)next.add(legacy);
          });
          if(rows.length<1000)break;
          from+=1000;
        }
        return next;
      })();
  }catch(error){
    console.warn("Inactive catalog index could not be loaded.",error);
  }
  rebuildVisibleCatalog();
}

async function loadRemoteCatalog(){
  const cfg=supabasePublicConfig();
  remoteCatalog.configured=!!(cfg.url&&cfg.key);
  if(!remoteCatalog.configured){window.KUTADGU_CATALOG_STATUS=catalogStatus;return}
  const controller=new AbortController();
  const timeoutId=setTimeout(()=>controller.abort(),CATALOG_BOOT_TIMEOUT_MS);
  try{
    const response=await fetch(`${cfg.url}/rest/v1/books?select=id&is_active=eq.true`,{
      method:"HEAD",
      signal:controller.signal,
      headers:{apikey:cfg.key,Authorization:`Bearer ${cfg.key}`,Prefer:"count=exact","Range-Unit":"items",Range:"0-0"}
    });
    if(!response.ok)throw new Error(`Catalog availability check failed (HTTP ${response.status})`);
    const total=totalFromContentRange(response.headers.get("content-range"));
    remoteCatalog.available=Number(total)>0;
    remoteCatalog.total=Number.isFinite(total)?total:null;
    if(remoteCatalog.available)await loadInactiveRemoteIndex();
    else restoreStaticVisibleCatalog();
    catalogStatus={source:remoteCatalog.available?"supabase":"static",remoteCount:0,total:remoteCatalog.available?total:STATIC_CATALOG.length,migrated:remoteCatalog.available,error:""};
    window.KUTADGU_CATALOG_STATUS=catalogStatus;
  }catch(err){
    console.warn("Remote catalog load failed; static catalog is being used.",err);
    remoteCatalog.available=false;
    restoreStaticVisibleCatalog();
    catalogStatus={source:"static",remoteCount:0,total:C.length,migrated:false,error:String(err?.message||err)};
    window.KUTADGU_CATALOG_STATUS=catalogStatus;
  }finally{clearTimeout(timeoutId)}
}

async function hydrateBooksByIds(ids=[]){
  const unique=[...new Set(ids.map(String).filter(Boolean))];
  if(!unique.length||!remoteCatalog.available)return;
  for(let index=0;index<unique.length;index+=100){
    const chunk=unique.slice(index,index+100);
    try{await fetchRemotePage({ids:chunk,pageSize:chunk.length,offset:0,sort:"new",includeInactive:true})}
    catch(error){if(error?.name!=="AbortError")console.warn("Saved book data could not be refreshed.",error)}
  }
}

async function hydratePageBook(){
  if(isStorefrontHomepage())return;
  const id=new URLSearchParams(location.search).get("id")||document.body.dataset.bookId;
  if(!id||!remoteCatalog.available)return;
  try{await fetchRemotePage({ids:[id],pageSize:1,offset:0,sort:"new",includeInactive:true})}
  catch(error){if(error?.name!=="AbortError")console.warn("Book detail could not be loaded.",error)}
}

function resolveStoredBookId(id){
  const raw=String(id||"");
  if(Legacy.bindResolve)return Legacy.bindResolve(value=>{
    const book=find(value);
    return book?.id&&isCanonicalBookId(book.id)?String(book.id):value;
  },aliasMap())(raw);
  const book=find(raw);
  if(!book||!book.id)return raw;
  const canonical=String(book.id);
  if(!isCanonicalBookId(canonical))return isCanonicalBookId(raw)?raw:canonical;
  if(!find(canonical))return raw;
  return canonical;
}
function aliasMap(){
  return Legacy.readPersistedAliasMap?Legacy.readPersistedAliasMap(localStorage):persistedAliases();
}
function migratePersistedBookIds(){
  const resolve=resolveStoredBookId;
  const aliases=aliasMap();
  const nextCart=Legacy.repairCapPollutedCartItems
    ?Legacy.repairCapPollutedCartItems(cart(),resolve,aliases)
    :(Legacy.migrateCartItems?Legacy.migrateCartItems(cart(),resolve):cart());
  const nextFav=Legacy.migrateIdList?Legacy.migrateIdList(favs(),resolve):favs().map(String);
  const nextRec=Legacy.migrateIdList?Legacy.migrateIdList(get(REC_KEY,[]),resolve,{limit:12}):get(REC_KEY,[]).map(String).slice(0,12);
  if(JSON.stringify(nextCart)!==JSON.stringify(cart()))set(CART_KEY,nextCart);
  if(JSON.stringify(nextFav)!==JSON.stringify((favs()||[]).map(String)))set(FAV_KEY,nextFav);
  if(JSON.stringify(nextRec)!==JSON.stringify((get(REC_KEY,[])||[]).map(String)))set(REC_KEY,nextRec);
}

function money(n){return n!=null&&n!==""?`${Number(n).toLocaleString("tr-TR")} ₺`:"باھا تېخى بېكىتىلمىگەن"}
function stockInfo(book){
  const raw=normalizeText(book?.stockStatus||"");
  const qty=book?.stock===null||book?.stock===undefined||book?.stock===""?null:Number(book.stock);
  if(["out","out_of_stock","soldout","sold-out","تۈگەپ كەتتى"].includes(raw))return {key:"out",label:"تۈگەپ كەتتى",canBuy:false,qty:0};
  if(Number.isFinite(qty)&&qty<=0)return {key:"out",label:"تۈگەپ كەتتى",canBuy:false,qty:0};
  if(["low","low_stock","ئاز قالدى"].includes(raw))return Number.isFinite(qty)&&qty<=0?{key:"out",label:"تۈگەپ كەتتى",canBuy:false,qty:0}:{key:"low",label:"ئاز قالدى",canBuy:true,qty:Number.isFinite(qty)&&qty>0?qty:null};
  if(["in","in_stock","available","ئامباردا بار"].includes(raw))return {key:"in",label:"ئامباردا بار",canBuy:true,qty:Number.isFinite(qty)&&qty>0?qty:null};
  if(Number.isFinite(qty)&&qty>0)return qty<=5?{key:"low",label:"ئاز قالدى",canBuy:true,qty}:{key:"in",label:"ئامباردا بار",canBuy:true,qty};
  return {key:"unknown",label:"",canBuy:true,qty:null};
}
function stockBadge(book){const s=stockInfo(book);return s.label?`<span class="stock-badge stock-${s.key}">${s.label}</span>`:""}
function cartButton(book,label="🛒 سېۋەتكە سېلىش",className="add-to-cart"){
  if(!isStorefrontVisible(book)){
    return `<button type="button" class="${escapeAttr(className)}" data-cart-id="${escapeAttr(book.id)}" disabled aria-disabled="true">ھازىرچە تەمىنلەنمەيدۇ</button>`;
  }
  const s=stockInfo(book),disabled=s.canBuy?"":" disabled aria-disabled=\"true\"";
  return `<button type="button" class="${escapeAttr(className)}" data-cart-id="${escapeAttr(book.id)}"${disabled}>${s.canBuy?escapeHtml(label):"تۈگەپ كەتتى"}</button>`;
}
function cart(){
  const items=get(CART_KEY,[]);
  if(!Array.isArray(items))return [];
  return items
    .filter(item=>item&&item.id)
    .map(item=>({...item,id:String(item.id),qty:sanitizeQty(item.qty)}));
}
function cartLookup(id){return find(id)||null}
function cartLines(){
  const items=cart();
  if(Legacy.visibleCartLines)return Legacy.visibleCartLines(items,cartLookup);
  return items.map(item=>{
    const book=cartLookup(item.id);
    return {id:book?.id||item.id,qty:item.qty,book:book||null};
  });
}
function cartBookForLine(line){
  if(line?.book)return line.book;
  const book=find(line?.id);
  if(book)return book;
  const id=String(line?.id||"");
  return {
    id,
    title:id,
    author:"",
    category:"",
    price:null,
    image:"",
    href:`book.html?id=${encodeURIComponent(id)}`,
    isActive:true
  };
}
function cartHas(id){
  if(Legacy.cartHasBook)return Legacy.cartHasBook(cart(),id,cartLookup);
  const want=canonicalId(id);
  return cartLines().some(line=>canonicalId(line.id)===want);
}
function updateBadge(){
  const n=cartLines().reduce((s,x)=>s+(x.qty||1),0);
  document.querySelectorAll(".cart-count").forEach(e=>e.textContent=n);
}
function add(id,qty=1){
  let b=find(id);if(!b)return;
  if(!isStorefrontVisible(b)){toast("بۇ كىتاب ھازىرچە تەمىنلەنمەيدۇ");return}
  const storeId=b.id;
  const stock=stockInfo(b);if(!stock.canBuy){toast("بۇ كىتاب ھازىر تۈگەپ كەتكەن");return}
  let a=cart(),x=a.find(i=>canonicalId(i.id)===storeId||canonicalId(i.id)===canonicalId(storeId)),next=sanitizeQty((x?.qty||0)+Math.max(1,sanitizeQty(qty)));
  if(Number.isFinite(stock.qty))next=Math.min(next,stock.qty);
  if(x){x.id=storeId;x.qty=next}else a.push({id:storeId,qty:next});
  if(set(CART_KEY,a)){updateBadge();toast("كىتاب سېۋەتكە قوشۇلدى 🛒");trackEvent("add_to_cart",{bookId:storeId,legacyId:b.legacyId||"",qty:Math.max(1,Number(qty)||1)})}
}
function remove(id){
  const resolve=resolveStoredBookId;
  const aliases=aliasMap();
  const next=Legacy.filterCartRemovingBook
    ?Legacy.filterCartRemovingBook(cart(),id,resolve,aliases)
    :cart().filter(x=>canonicalId(x.id)!==canonicalId(id));
  set(CART_KEY,next);
  updateBadge();
}
function favs(){return get(FAV_KEY,[])}
function favHas(id){
  const want=canonicalId(id);
  const aliases=aliasMap();
  return favs().some(x=>Legacy.sameBookIdentity?Legacy.sameBookIdentity(x,want,resolveStoredBookId,aliases):canonicalId(x)===want);
}
function toggleFav(id){
  const b=find(id);if(!b)return;
  const storeId=b.id;
  const resolve=resolveStoredBookId;
  const aliases=aliasMap();
  let a=favs().map(String);
  const added=!(Legacy.sameBookIdentity?a.some(x=>Legacy.sameBookIdentity(x,storeId,resolve,aliases)):a.some(x=>canonicalId(x)===storeId));
  if(!added){
    a=Legacy.filterFavsRemovingBook?Legacy.filterFavsRemovingBook(a,storeId,resolve,aliases):a.filter(x=>canonicalId(x)!==storeId);
    toast("ياقتۇرۇلغانلاردىن چىقىرىلدى");
  }
  else if(!isStorefrontVisible(b)){toast("بۇ كىتاب ھازىرچە تەمىنلەنمەيدۇ");return}
  else{a.push(storeId);toast("ياقتۇرغانلارغا قوشۇلدى ❤️")}
  if(set(FAV_KEY,a)){renderFavButtons();trackEvent(added?"add_to_favorite":"remove_from_favorite",{bookId:storeId,legacyId:b.legacyId||""})}
}
function recent(id){
  const b=find(id);if(!b)return;
  const storeId=b.id;
  let a=get(REC_KEY,[]).filter(x=>canonicalId(x)!==storeId);
  a.unshift(storeId);
  set(REC_KEY,a.slice(0,12));
}
function toast(msg){let t=document.querySelector(".shop-toast");if(!t){t=document.createElement("div");t.className="shop-toast";t.style.cssText="position:fixed;right:18px;bottom:18px;z-index:10000;background:#4b3327;color:#fff;padding:12px 18px;border-radius:9px;box-shadow:0 8px 25px rgba(0,0,0,.2);font-family:inherit;transition:opacity .2s";document.body.appendChild(t)}t.textContent=msg;t.style.opacity="1";clearTimeout(t._tm);t._tm=setTimeout(()=>t.style.opacity="0",1800)}
function isDesktopShopViewport(){
  return window.matchMedia("(min-width: 769px)").matches;
}
function ensureCartCount(link){
  if(!link||link.querySelector(".cart-count"))return link;
  const span=document.createElement("span");
  span.className="cart-count";
  span.textContent="0";
  link.appendChild(span);
  return link;
}
function ensureDesktopShopNav(){
  if(!isDesktopShopViewport()){
    document.documentElement.classList.remove("kutadgu-desktop-header-shop");
    return;
  }
  const headerNav=document.querySelector("header nav");
  const altHost=document.querySelector(".detail-topbar, .cart-page-top");
  let host=headerNav;
  if(!host&&altHost){
    host=altHost.querySelector(".kutadgu-desktop-shop-links");
    if(!host){
      host=document.createElement("nav");
      host.className="kutadgu-desktop-shop-links";
      host.setAttribute("aria-label","سېۋەت ۋە ھېساب");
      altHost.appendChild(host);
    }
  }
  if(!host){
    document.documentElement.classList.remove("kutadgu-desktop-header-shop");
    return;
  }
  const scoped=selector=>[...host.querySelectorAll(selector),...document.querySelectorAll(`header nav ${selector}, .detail-topbar ${selector}, .cart-page-top ${selector}`)][0];
  const add=(href,label)=>{
    let link=scoped(`a[href="${href}"]`);
    if(!link){
      link=document.createElement("a");
      link.href=href;
      link.textContent=label;
      if(!headerNav)link.dataset.kutadguDesktopShop="1";
      host.appendChild(link);
    }
    if(href==="cart.html")ensureCartCount(link);
    return link;
  };
  add("account.html","👤 ھېسابىم");
  add("cart.html","🛒 سېۋەت");
  add("favorites.html","❤️");
  document.documentElement.classList.add("kutadgu-desktop-header-shop");
}
function injectFloat(){
  if(!document.querySelector(".shop-floating")){
    let d=document.createElement("div");
    d.className="shop-floating";
    d.innerHTML=`<button class="shop-float-btn" onclick="location.href='cart.html'">🛒 سېۋەت <span class="cart-count">0</span></button><button class="shop-float-btn" onclick="location.href='favorites.html'">❤️ ياقتۇرغانلىرىم</button>`;
    document.body.appendChild(d);
  }
  ensureDesktopShopNav();
  updateBadge();
}
function cardIdentityKeys(card){
  const keys=new Set();
  const add=value=>{const v=String(value||"").trim();if(v)keys.add(v)};
  add(card.dataset.liveBookId);
  add(card.querySelector("[data-cart-id]")?.dataset.cartId);
  add(card.querySelector("[data-fav-id]")?.dataset.favId);
  add(card.querySelector("[data-share-id]")?.dataset.shareId);
  card.querySelectorAll("a[href]").forEach(anchor=>{
    const href=anchor.getAttribute("href")||"";
    try{
      const url=new URL(href,location.href);
      add(url.searchParams.get("id"));
      add((url.pathname.split("/").pop()||"").replace(/\.html$/i,""));
    }catch(error){
      add(href.replace(/\.html$/i,"").split("id=").pop());
    }
  });
  return [...keys];
}
function cardId(card){
  const keys=cardIdentityKeys(card);
  for(const key of keys){if(find(key))return find(key).id}
  const hrefs=[...card.querySelectorAll("a.book-image,a.book-cover,.detail-button,.book-button")].map(a=>a.getAttribute("href")).filter(Boolean);
  for(const href of hrefs){const b=C.find(x=>x.href===href);if(b)return b.id}
  const title=card.querySelector(".book-title")?.textContent.trim();
  if(title){const b=C.find(x=>x.title===title);if(b)return b.id}
  return keys[0]||null;
}
function syncStaticCards(){
  document.querySelectorAll(".book-card").forEach(card=>{
    if(card.querySelector(".book-icon")&&!card.querySelector("a.book-image,a.book-cover,.book-title"))return;
    const keys=cardIdentityKeys(card);
    const id=cardId(card);
    const book=id&&find(id);
    const suppressed=!!(keys.some(key=>inactiveRemoteKeys.has(String(key)))||(book&&!isStorefrontVisible(book)));
    card.hidden=suppressed;
    if(suppressed){
      card.setAttribute("aria-hidden","true");
      return;
    }
    card.removeAttribute("aria-hidden");
    if(!book)return;
    const cover=card.querySelector("a.book-image,a.book-cover");
    const img=cover?.querySelector("img");
    if(cover&&book.href)cover.href=book.href;
    if(img){img.loading="lazy";img.decoding="async";if(!img.getAttribute("width"))img.setAttribute("width","320");if(!img.getAttribute("height"))img.setAttribute("height","460");img.src=coverSrc(book);img.alt=`${book.title||"كىتاب"} كىتاب مۇقاۋىسى`;}
    const detail=card.querySelector(".detail-button,.book-button");if(detail&&book.href)detail.href=book.href;
    const title=card.querySelector(".book-title");if(title)title.textContent=book.title||"كىتاب";
    const author=card.querySelector(".book-author");
    if(author){
      const name=storefrontAuthor(book);
      author.textContent=name?`ئاپتورى: ${name}`:"";
      author.hidden=!name;
    }
    const price=card.querySelector(".book-price,.price");if(price)price.textContent=money(book.price);
  });
}
function applyStaticCoverFallbacks(scope=document){
  scope.querySelectorAll(".book-card .book-cover, .book-card .book-image").forEach(cover=>{
    let img=cover.matches("img")?cover:cover.querySelector("img");
    if(!img){
      img=document.createElement("img");
      const title=cover.closest(".book-card")?.querySelector(".book-title")?.textContent.trim()||"كىتاب";
      img.alt=`${title} كىتاب مۇقاۋىسى`;
      img.loading="lazy";
      cover.querySelectorAll(".dynamic-cover-placeholder,.cover-placeholder").forEach(el=>el.remove());
      cover.prepend(img);
    }
    img.onerror=function(){
      this.onerror=null;
      this.hidden=false;
      this.style.visibility="visible";
      this.src=FALLBACK_COVER;
    };
    img.loading="lazy";
    img.decoding="async";
    if(!img.getAttribute("width"))img.setAttribute("width","320");
    if(!img.getAttribute("height"))img.setAttribute("height","460");
    const src=(img.getAttribute("src")||"").trim();
    if(COVER_LAYOUT_TEST_MODE||!src||src==="#")img.src=coverSrc(null);
  });
}
function applyDetailCoverFallback(){
  const box=document.querySelector(".book-cover-box");
  if(!box)return;
  let img=box.querySelector("img");
  if(!img){
    img=document.createElement("img");
    box.prepend(img);
  }
  const book=getDetailBook();
  const current=(img.getAttribute("src")||"").trim();
  img.alt=img.alt||`${book?.title||"كىتاب"} كىتاب مۇقاۋىسى`;
  img.loading="eager";
  img.decoding="async";
  img.hidden=false;
  img.style.visibility="visible";
  box.classList.remove("no-cover");
  img.onerror=function(){
    this.onerror=null;
    this.hidden=false;
    this.style.visibility="visible";
    this.src=FALLBACK_COVER;
  };
  if(COVER_LAYOUT_TEST_MODE||!current||current==="#")img.src=coverSrc(book);
}
function decorateCards(){
  document.querySelectorAll(".book-card").forEach(card=>{
    let id=cardId(card); if(!id||card.querySelector(".book-actions"))return;
    let info=card.querySelector(".book-info")||card;
    let detail=info.querySelector(".detail-button");
    let wrap=document.createElement("div");
    wrap.className="book-actions";
    wrap.innerHTML=`${detail?detail.outerHTML:""}${cartButton(find(id))}<button type="button" class="favorite-button" data-fav-id="${id}" aria-label="ياقتۇرۇش">♡</button><button type="button" class="share-button" data-share-id="${id}" aria-label="ھەمبەھىرلەش">🔗</button>`;
    if(detail) detail.remove();
    info.appendChild(wrap);
  });
  document.querySelectorAll("[data-cart-id]").forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();add(b.dataset.cartId)});
  document.querySelectorAll("[data-fav-id]").forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();toggleFav(b.dataset.favId)});
  document.querySelectorAll("[data-share-id]").forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();let book=find(b.dataset.shareId);if(book)shareBook(book)});
  renderFavButtons();
}
function renderFavButtons(){document.querySelectorAll("[data-fav-id]").forEach(b=>{let yes=favHas(b.dataset.favId);b.classList.toggle("is-favorite",yes);if(b.classList.contains("mini-heart")||b.classList.contains("home-feature-heart")){b.textContent=yes?"♥":"♡";b.setAttribute("aria-pressed",yes?"true":"false");b.setAttribute("aria-label",yes?"ياقتۇرۇلدى":"ياقتۇرۇش");}else if(b.textContent.includes("ياقتۇرۇش")||b.textContent.includes("♡")||b.textContent.includes("♥"))b.textContent=yes?"♥ ياقتۇرۇلدى":"♡ ياقتۇرۇش"})}
function getDetailBook(){
  let id=document.body.dataset.bookId;
  let b=find(id); if(b)return b;
  let queryId=new URLSearchParams(location.search).get("id");
  if(queryId){b=find(queryId);if(b)return b}
  let file=(location.pathname.split("/").pop()||"").split("?")[0];
  const slug=file.replace(/\.html$/i,"");
  b=find(slug)||find(file);
  if(b)return b;
  const cached=[...catalogCache.values()];
  b=cached.find(x=>x.href===file||x.id===slug||x.legacyId===slug);
  if(b)return b;
  b=C.find(x=>x.href===file); if(b)return b;
  let title=document.querySelector(".book-detail-info h1")?.textContent.trim();
  return title?(cached.find(x=>x.title===title)||C.find(x=>x.title===title)):null;
}

function setDynamicMeta(label,value){
  if(value===null||value===undefined||String(value).trim()==="")return "";
  return `<div class="book-meta-row"><div class="book-meta-label">${label}</div><div class="book-meta-value">${value}</div></div>`;
}

function setHeadMeta(selector,attributes){
  let node=document.head.querySelector(selector);
  if(!node){node=document.createElement(attributes.tag||"meta");document.head.appendChild(node)}
  Object.entries(attributes).forEach(([key,value])=>{if(key!=="tag")node.setAttribute(key,value)});
  return node;
}

function siteOrigin(){
  if(window.KutadguBookSeo&&window.KutadguBookSeo.productionOrigin)return window.KutadguBookSeo.productionOrigin();
  return "https://kutadgu-bilig-kitab.vercel.app";
}

function absoluteUrl(value){
  try{return new URL(value||"/",siteOrigin()+"/").href}catch(e){return siteOrigin()+"/"}
}

/* Detail SEO is generated only from known book data; missing facts stay omitted. */
function updateBookSeo(book){
  if(!book||!isBookDetailDocument())return;
  const Seo=window.KutadguBookSeo||{};
  const origin=siteOrigin();
  const canonical=Seo.bookCanonicalUrl?Seo.bookCanonicalUrl(book.id,origin):`${origin}/book.html?id=${encodeURIComponent(String(book.id||"").trim())}`;
  const title=`${book.title} - قۇتادغۇبىلىك كىتابخانىسى`;
  const authorName=storefrontAuthor(book);
  const description=Seo.metaDescription?Seo.metaDescription(book):(String(book.description||"").trim()||`${book.title} — قۇتادغۇبىلىك كىتابخانىسى`);
  const image=isStorefrontVisible(book)&&book.image?absoluteUrl(book.image):"";
  const indexable=isStorefrontVisible(book)&&/^\d+$/.test(String(book.id||"").trim());
  document.title=title;
  if(description)setHeadMeta('meta[name="description"]',{name:"description",content:description});
  setHeadMeta('meta[name="robots"]',{name:"robots",content:indexable?"index, follow":"noindex, follow"});
  setHeadMeta('link[rel="canonical"]',{tag:"link",rel:"canonical",href:canonical});
  setHeadMeta('meta[property="og:site_name"]',{property:"og:site_name",content:"قۇتادغۇبىلىك كىتابخانىسى"});
  setHeadMeta('meta[property="og:locale"]',{property:"og:locale",content:"ug"});
  setHeadMeta('meta[property="og:type"]',{property:"og:type",content:"book"});
  setHeadMeta('meta[property="og:title"]',{property:"og:title",content:book.title});
  if(description)setHeadMeta('meta[property="og:description"]',{property:"og:description",content:description});
  setHeadMeta('meta[property="og:url"]',{property:"og:url",content:canonical});
  if(image){
    setHeadMeta('meta[property="og:image"]',{property:"og:image",content:image});
    setHeadMeta('meta[property="og:image:alt"]',{property:"og:image:alt",content:`${book.title} كىتاب مۇقاۋىسى`});
  }
  setHeadMeta('meta[name="twitter:card"]',{name:"twitter:card",content:image?"summary_large_image":"summary"});
  setHeadMeta('meta[name="twitter:title"]',{name:"twitter:title",content:book.title});
  if(description)setHeadMeta('meta[name="twitter:description"]',{name:"twitter:description",content:description});
  if(image)setHeadMeta('meta[name="twitter:image"]',{name:"twitter:image",content:image});

  let schema=document.head.querySelector("#kutadguBookSchema");
  if(!schema){schema=document.createElement("script");schema.id="kutadguBookSchema";schema.type="application/ld+json";document.head.appendChild(schema)}
  const payload=Seo.buildBookJsonLd
    ?Seo.buildBookJsonLd(book,{origin,canonical,authorName,image,visible:isStorefrontVisible(book),stockKey:stockInfo(book).key})
    :{"@context":"https://schema.org","@graph":[{"@type":"Book",name:book.title,url:canonical}]};
  schema.textContent=JSON.stringify(payload).replace(/</g,"\\u003c");
}

function populateDynamicBookPage(b){
  if(isStorefrontHomepage()||!isBookDetailDocument()){
    if(isStorefrontHomepage())applyHomepageDocumentTitle();
    return;
  }
  const dynamic=document.body.hasAttribute("data-dynamic-book");
  if(!dynamic&&!b.isRemote)return;
  document.body.dataset.bookId=b.id;
  document.title=`${b.title} - قۇتادغۇبىلىك كىتابخانىسى`;

  const img=document.querySelector(".book-cover-box img");
  if(img){
    img.src=coverSrc(b);
    img.alt=`${b.title} كىتاب مۇقاۋىسى`;
    img.hidden=false;
    img.parentElement.classList.remove("no-cover");
    img.onerror=()=>{img.onerror=null;img.src=FALLBACK_COVER};
  }

  const info=document.querySelector(".book-detail-info");
  if(!info)return;
  const h1=info.querySelector("h1");
  if(h1)h1.textContent=b.title;
  const author=info.querySelector(".book-author");
  if(author){
    const name=storefrontAuthor(b);
    author.textContent=name?`ئاپتورى: ${name}`:"";
    author.hidden=!name;
  }

  const meta=info.querySelector(".book-meta");
  if(meta&&(dynamic||b.isRemote)){
    meta.innerHTML=[
      setDynamicMeta("ئاپتورى",storefrontAuthor(b)),
      setDynamicMeta("تەرجىمانى",b.translator),
      setDynamicMeta("نەشرىيات",b.publisher),
      setDynamicMeta("نەشر يىلى",b.publishYear),
      setDynamicMeta("ISBN",storefrontIsbn(b)),
      setDynamicMeta("بەت سانى",b.pages),
      setDynamicMeta("كىتاب تۈرى",b.category)
    ].join("");
  }

  let desc=document.querySelector(".dynamic-book-description");
  if(desc){
    if(b.description){
      desc.hidden=false;
      desc.querySelector("p").textContent=b.description;
    }else desc.hidden=true;
  }
}

function detailRecommendations(book,limit=4){
  let same=C.filter(x=>x.id!==book.id && x.category===book.category);
  let other=C.filter(x=>x.id!==book.id && x.category!==book.category);
  return [...same,...other].slice(0,limit);
}

function detailGallerySlides(book){
  const main=coverSrc(book);
  const extras=normalizeGalleryImages(book?.galleryImages||[],book?.image||"");
  return [main,...extras].filter(Boolean);
}

function setDetailHeroImage(src,alt){
  const img=document.querySelector(".book-cover-box img");
  if(!img)return;
  img.src=src;
  img.alt=alt||img.alt||"";
  img.hidden=false;
  img.style.visibility="visible";
}

function openCoverLightbox(slides,startIndex,alt){
  const list=(slides||[]).filter(Boolean);
  if(!list.length)return;
  let index=Math.max(0,Math.min(startIndex||0,list.length-1));
  const overlay=document.createElement("div");
  overlay.className="cover-zoom-overlay";
  overlay.setAttribute("role","dialog");
  overlay.setAttribute("aria-modal","true");
  overlay.setAttribute("aria-label","كىتاب رەسىمىنى چوڭ كۆرۈش");
  const nav=list.length>1
    ? `<button type="button" class="cover-zoom-prev" aria-label="ئالدىنقى رەسىم">›</button><button type="button" class="cover-zoom-next" aria-label="كېيىنكى رەسىم">‹</button><div class="cover-zoom-count"></div>`
    : "";
  overlay.innerHTML=`<button type="button" class="cover-zoom-close" aria-label="تاقاش">✕</button>${nav}<img src="${list[index]}" alt="${alt||""}">`;
  document.body.appendChild(overlay);
  const picture=overlay.querySelector("img");
  const count=overlay.querySelector(".cover-zoom-count");
  const show=()=>{
    picture.src=list[index];
    if(count)count.textContent=`${index+1} / ${list.length}`;
  };
  show();
  const close=()=>{
    overlay.remove();
    document.removeEventListener("keydown",onKey);
  };
  const step=dir=>{
    index=(index+dir+list.length)%list.length;
    show();
  };
  function onKey(e){
    if(e.key==="Escape")close();
    else if(list.length>1&&(e.key==="ArrowLeft"||e.key==="ArrowRight")){
      e.preventDefault();
      step(e.key==="ArrowLeft"?1:-1);
    }
  }
  overlay.querySelector(".cover-zoom-close").onclick=close;
  overlay.querySelector(".cover-zoom-prev")?.addEventListener("click",e=>{e.stopPropagation();step(-1)});
  overlay.querySelector(".cover-zoom-next")?.addEventListener("click",e=>{e.stopPropagation();step(1)});
  overlay.onclick=e=>{if(e.target===overlay)close()};
  document.addEventListener("keydown",onKey);
}

function setupCoverZoom(book){
  const img=document.querySelector(".book-cover-box img");
  if(!img||img.style.display==="none")return;
  img.classList.add("detail-cover-zoomable");
  img.setAttribute("title","مۇقاۋىنى چوڭ كۆرۈش");
  const slides=detailGallerySlides(book||getDetailBook());
  img.onclick=()=>{
    const current=img.getAttribute("src")||"";
    const start=Math.max(0,slides.indexOf(current));
    openCoverLightbox(slides.length?slides:[current],start,img.alt||"");
  };
}

function renderBookGallery(book){
  const col=document.querySelector(".book-cover-column");
  const existing=col?.querySelector(".book-gallery-thumbs");
  existing?.remove();
  const extras=normalizeGalleryImages(book?.galleryImages||[],book?.image||"");
  setupCoverZoom(book);
  if(!col||!extras.length)return;
  const slides=detailGallerySlides(book);
  const strip=document.createElement("div");
  strip.className="book-gallery-thumbs";
  strip.setAttribute("role","list");
  strip.setAttribute("aria-label","كىتاب رەسىملىرى");
  strip.innerHTML=slides.map((src,index)=>`<button type="button" class="book-gallery-thumb${index===0?" is-active":""}" role="listitem" data-gallery-index="${index}" aria-label="${index===0?"ئاساسىي مۇقاۋا":"قوشۇمچە رەسىم "+index}">
      <img src="${src}" alt="" ${index===0?"":'loading="lazy"'} decoding="async">
    </button>`).join("");
  col.appendChild(strip);
  strip.querySelectorAll(".book-gallery-thumb").forEach(btn=>{
    btn.onclick=()=>{
      const index=Number(btn.dataset.galleryIndex)||0;
      setDetailHeroImage(slides[index],`${book.title||"كىتاب"} ${index===0?"كىتاب مۇقاۋىسى":"رەسىم "+(index+1)}`);
      strip.querySelectorAll(".book-gallery-thumb").forEach(el=>el.classList.toggle("is-active",el===btn));
    };
  });
}

function renderDetailExtras(book){
  let main=document.querySelector(".book-detail-page");
  if(!main||main.querySelector(".detail-extra-sections"))return;

  let related=detailRecommendations(book,4);
  let recentBooks=get(REC_KEY,[])
    .filter(id=>canonicalId(id)!==canonicalId(book.id))
    .map(find)
    .filter(book=>book&&isStorefrontVisible(book))
    .slice(0,4);

  let wrap=document.createElement("div");
  wrap.className="detail-extra-sections";

  let relatedHtml=featureEnabled("recommendations")&&related.length
    ? `<section class="detail-extra-section">
         <div class="detail-section-heading">
           <div>
             <span class="detail-section-kicker">📚 يەنە كۆرۈپ بېقىڭ</span>
             <h2>ئوخشاش كىتابلار</h2>
           </div>
           <a href="${book.source||'/#books'}" class="detail-section-link">بۇ بۆلۈمدىكى كىتابلار →</a>
         </div>
         <div class="shop-grid detail-related-grid">${related.map(miniCard).join("")}</div>
       </section>`
    : "";

  let recentHtml=featureEnabled("recentlyViewed")&&recentBooks.length
    ? `<section class="detail-extra-section">
         <div class="detail-section-heading">
           <div>
             <span class="detail-section-kicker">🕘 قايتا تېپىش ئاسان</span>
             <h2>يېقىندا كۆرگەنلىرىڭىز</h2>
           </div>
         </div>
         <div class="shop-grid detail-related-grid">${recentBooks.map(miniCard).join("")}</div>
       </section>`
    : "";

  wrap.innerHTML=relatedHtml+recentHtml;
  if(wrap.innerHTML.trim()){
    main.appendChild(wrap);
    bindDynamicActions(wrap);
  }
}

function decorateDetail(){
  if(isStorefrontHomepage()){
    applyHomepageDocumentTitle();
    return;
  }
  if(!isBookDetailDocument())return;
  let b=getDetailBook(); if(!b)return;
  populateDynamicBookPage(b);
  updateBookSeo(b);
  renderBookGallery(b);
  if(isStorefrontVisible(b))recent(b.id);
  trackBookViewOnce(b);

  let box=document.querySelector(".book-detail-info");
  if(!box)return;
  box.classList.add("detail-info-upgraded");

  let title=box.querySelector("h1");
  if(title&&!box.querySelector(".detail-category-badge")){
    let badge=document.createElement("div");
    badge.className="detail-category-badge";
    badge.textContent=b.category||"كىتاب";
    title.before(badge);
  }

  let old=box.querySelector(".detail-actions");
  if(old)old.remove();
  box.querySelector(".detail-purchase-panel")?.remove();

  if(!isStorefrontVisible(b)){
    const unavailable=document.createElement("div");
    unavailable.className="detail-purchase-panel detail-unavailable-panel";
    unavailable.innerHTML=`
      <div class="detail-unavailable-title">بۇ كىتاب ھازىرچە تەمىنلەنمەيدۇ.</div>
      <p class="detail-order-tip">بۇ كىتاب تېخى سېتىلىشقا چىقىرىلمىغان ياكى ۋاقتىنچە يوشۇرۇلغان.</p>
      ${favHas(b.id)?`<button type="button" class="favorite-button" data-fav-id="${b.id}">♥ ياقتۇرۇلدى</button>`:""}
    `;
    box.appendChild(unavailable);
    unavailable.querySelector("[data-fav-id]")?.addEventListener("click",()=>{toggleFav(b.id);decorateDetail()});
    renderDetailExtras(b);
    return;
  }

  let panel=document.createElement("div");
  panel.className="detail-purchase-panel";
  panel.innerHTML=`
    <div class="detail-price-line">
      <div>
        <span class="detail-price-label">كىتاب باھاسى</span>
        <div class="detail-price">${money(b.price)}</div>
      </div>
      <div class="detail-quantity-wrap">
        <span class="detail-quantity-label">سانى</span>
        <div class="detail-quantity-control">
          <button type="button" class="detail-qty-minus" aria-label="سانىنى ئازايتىش">−</button>
          <span class="detail-qty-value">1</span>
          <button type="button" class="detail-qty-plus" aria-label="سانىنى كۆپەيتىش">+</button>
        </div>
      </div>
    </div>

    ${cartButton(b,"🛒 سېۋەتكە قوشۇش","add-to-cart detail-cart detail-main-cart")}

    <div class="detail-secondary-actions">
      <button type="button" class="favorite-button" data-fav-id="${b.id}">♡ ياقتۇرۇش</button>
      <button type="button" class="share-button" data-share-id="${b.id}">🔗 ھەمبەھىرلەش</button>
    </div>

    <div class="detail-order-tip">سېۋەتكە قوشقاندىن كېيىن WhatsApp ئارقىلىق زاكاز قىلىڭ. كۆرسىتىلگەن باھا كىتاب باھاسى؛ توشۇش ھەققى زاكازدا ئايرىم جەزمللىنىدۇ. دۇكاندىن ئېلىش ياكى كارگو تاللىسىڭىز بولىدۇ.</div>
  `;
  box.appendChild(panel);

  let qty=1;
  const qtyText=panel.querySelector(".detail-qty-value");
  panel.querySelector(".detail-qty-minus").onclick=()=>{
    qty=Math.max(1,qty-1);
    qtyText.textContent=qty;
  };
  panel.querySelector(".detail-qty-plus").onclick=()=>{
    qty=Math.min(99,qty+1);
    qtyText.textContent=qty;
  };
  panel.querySelector(".detail-main-cart").onclick=()=>add(b.id,qty);
  panel.querySelector("[data-fav-id]").onclick=()=>toggleFav(b.id);
  panel.querySelector("[data-share-id]").onclick=()=>shareBook(b);

  renderFavButtons();
  renderDetailExtras(b);
}

async function shareBook(b){
  let url=new URL(b.href,location.href).href;
  try{
    if(navigator.share){await navigator.share({title:b.title,text:`${b.title} — ${b.author}`,url});toast("ھەمبەھىرلەش تەييار")}
    else if(navigator.clipboard){await navigator.clipboard.writeText(url);toast("كىتاب ئۇلىنىشى كۆچۈرۈلدى 🔗")}
    else{let ta=document.createElement("textarea");ta.value=url;document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();toast("كىتاب ئۇلىنىشى كۆچۈرۈلدى 🔗")}
  }catch(e){}
}
function miniCover(b){
  return `<img src="${coverSrc(b)}" alt="${b.title}" width="320" height="460" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${FALLBACK_COVER}'">`;
}

function miniCard(b){return `<article class="shop-mini-card"><button type="button" class="mini-heart" data-fav-id="${b.id}">♡</button><a href="${b.href}">${miniCover(b)}<div class="shop-mini-title">${b.title}</div><div class="shop-mini-meta">${b.author}</div><div class="mini-card-status">${stockBadge(b)}</div><div class="shop-mini-price">${money(b.price)}</div></a><div class="mini-actions">${cartButton(b)}<button type="button" class="share-button" data-share-id="${b.id}">🔗</button></div></article>`}

function favoriteCard(b){
  if(!isStorefrontVisible(b)){
    return `<article class="favorite-card favorite-card-unavailable">
    <a class="favorite-cover" href="${b.href}">${miniCover(b)}</a>
    <div class="favorite-card-info">
      <a class="favorite-card-title" href="${b.href}">${b.title}</a>
      <div class="favorite-card-author">${b.author||"—"}</div>
      <div class="favorite-card-row"><span class="stock-badge stock-out">ھازىرچە تەمىنلەنمەيدۇ</span></div>
      <div class="favorite-card-actions">
        <button type="button" class="favorite-remove" data-remove-favorite="${b.id}">ياقتۇرغانلاردىن چىقىرىش</button>
      </div>
    </div>
  </article>`;
  }
  return `<article class="favorite-card">
    <a class="favorite-cover" href="${b.href}">${miniCover(b)}</a>
    <div class="favorite-card-info">
      <a class="favorite-card-title" href="${b.href}">${b.title}</a>
      <div class="favorite-card-author">${b.author||"—"}</div>
      <div class="favorite-card-row"><strong>${money(b.price)}</strong>${stockBadge(b)}</div>
      <div class="favorite-card-actions">
        ${cartButton(b)}
        <button type="button" class="favorite-remove" data-remove-favorite="${b.id}">ياقتۇرغانلاردىن چىقىرىش</button>
      </div>
    </div>
  </article>`;
}

function renderFavoritesPage(){
  const host=document.querySelector("#favoritesList");if(!host)return;
  const books=favs().map(id=>find(id)).filter(Boolean);
  host.innerHTML=books.length
    ? `<div class="favorites-grid">${books.map(favoriteCard).join("")}</div>`
    : `<div class="empty-state favorites-empty"><span>♡</span><h2>ھازىرچە ياقتۇرغان كىتاب يوق</h2><p>كىتاب كارتىسىدىكى يۈرەك بەلگىسىنى بېسىپ بۇ يەرگە ساقلىيالايسىز. مېھمان بولسىڭىز شۇ ئۈسكۈنىدە ساقلىنىدۇ؛ ھېسابقا كىرسىڭىز ھېسابىڭىزغا ماسلىشىدۇ.</p><a class="empty-state-button" href="/#books">كىتابلارنى كۆرۈش</a></div>`;
  bindDynamicActions(host);
  host.querySelectorAll("[data-remove-favorite]").forEach(button=>button.onclick=()=>{toggleFav(button.dataset.removeFavorite);renderFavoritesPage()});
}

function recommendedBooks(limit=12){
  let pinned=C.filter(b=>b.isRecommended===true);
  let groups=new Map();
  C.forEach(b=>{
    let key=b.category||"باشقا";
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(b);
  });
  let lists=[...groups.values()];
  let out=[...pinned.slice(0,limit)],i=0;
  while(out.length<limit && lists.some(a=>i<a.length)){
    for(const a of lists){
      if(a[i] && !out.some(x=>x.id===a[i].id))out.push(a[i]);
      if(out.length>=limit)break;
    }
    i++;
  }
  return out;
}


async function renderHomeFeaturedBooks(){
  const host=document.querySelector("#homeFeaturedBooks");
  if(!host)return;
  if(!featureEnabled("newArrivals")){host.hidden=true;return}

  function card(b){
    return `<article class="home-feature-card">
      <button type="button" class="home-feature-heart favorite-button mini-heart" data-fav-id="${b.id}" aria-label="ياقتۇرۇش" aria-pressed="false">♡</button>
      <a href="${b.href}">
        <div class="home-feature-cover">
          <div class="home-feature-cover-frame">
            <img src="${coverSrc(b)}" alt="${b.title} كىتاب مۇقاۋىسى" width="320" height="460" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${FALLBACK_COVER}'">
          </div>
        </div>
        <div class="home-feature-info">
          <div class="home-feature-title">${b.title}</div>
          <div class="home-feature-author">${b.author||"—"}</div>
          <div class="home-feature-bottom">
            <span class="home-feature-price">${money(b.price)}</span>
            ${cartButton(b,"🛒","add-to-cart home-feature-cart")}
          </div>
        </div>
      </a>
    </article>`;
  }

  host.innerHTML=`<section class="home-featured-section">
    <div class="home-featured-head">
      <div>
        <h3>🕘 يېقىندا قوشۇلغانلار</h3>
        <p>باش بەتتىنلا كىتابلارنى كۆرۈپ تاللاڭ.</p>
      </div>
      <a class="home-featured-all" href="my-books.html">ھەممىسىنى كۆرۈش ←</a>
    </div>
    <div class="home-featured-grid"><div class="catalog-loading-state"><span class="catalog-loading-spinner" aria-hidden="true"></span><span>يېقىندا قوشۇلغان كىتابلار يۈكلىنىۋاتىدۇ…</span></div></div>
  </section>`;
  try{
    // This standalone section is independent from the Admin-controlled is_new tab.
    // Only the latest twelve rows are requested; remoteOrder("new") maps to created_at DESC.
    const result=await queryCatalog({offset:0,pageSize:12,sort:"new"});
    const books=result.items.filter(isStorefrontVisible);
    const grid=host.querySelector(".home-featured-grid");
    if(grid)grid.innerHTML=books.length?books.map(card).join(""):'<div class="empty-state shop-section-empty">كىتابلار تېخى قوشۇلمىغان.</div>';
    bindDynamicActions(host);
  }catch(error){
    console.error("Recently added books query failed.",error);
    const grid=host.querySelector(".home-featured-grid");
    if(grid)grid.innerHTML='<div class="empty-state shop-section-empty">يېقىندا قوشۇلغان كىتابلارنى يۈكلەش ۋاقىتلىق مۇمكىن بولمىدى.</div>';
  }
}

function renderHomeSections(){
  let host=document.querySelector("#homeShopSections");if(!host)return;
  if(host.dataset.kutadguHomeSections==="1")return;
  host.dataset.kutadguHomeSections="1";
  let data={};
  if(featureEnabled("newArrivals"))data.newest="🆕 يېڭى قوشۇلغان كىتابلار";
  if(featureEnabled("recommendations"))data.recommended="⭐ تەۋسىيە قىلىنغان كىتابلار";
  if(featureEnabled("recentlyViewed"))data.recent="🕘 يېقىندا كۆرۈلگەن كىتابلار";
  data.favorites="❤️ ياقتۇرغان كىتابلار";
  const labels={newest:"🆕 يېڭى قوشۇلغان كىتابلار",recommended:"⭐ تەۋسىيە قىلىنغان كىتابلار",recent:"🕘 يېقىندا كۆرۈلگەن كىتابلار",favorites:"❤️ ياقتۇرغان كىتابلار"};
  host.innerHTML=`<div class="shop-selector"><button type="button" class="shop-selector-button" id="shopSelectorButton">📚 كىتابلارنى تاللاش <span>⌄</span></button><div class="shop-selector-menu" id="shopSelectorMenu">${Object.keys(data).map(key=>`<button type="button" data-shop-tab="${key}">${labels[key]}</button>`).join("")}<a class="shop-selector-all-link" href="my-books.html">📚 مېنىڭ كىتابلىرىم — ھەممىسىنى بىر يەردە كۆرۈش</a></div></div><div id="shopSelectedContent" class="shop-selected-content"></div>`;
  const btn=host.querySelector("#shopSelectorButton"),menu=host.querySelector("#shopSelectorMenu"),content=host.querySelector("#shopSelectedContent");
  let requestId=0,controller=null;
  async function show(key){
    const token=++requestId;controller?.abort();controller=new AbortController();
    const title=data[key];
    content.innerHTML=`<section class="shop-section shop-section-selected"><h2>${title}</h2><div class="catalog-loading-state"><span class="catalog-loading-spinner" aria-hidden="true"></span><span>كىتابلار يۈكلىنىۋاتىدۇ…</span></div></section>`;
    try{
      let arr=[];
      if(key==="newest")arr=(await queryCatalog({offset:0,pageSize:8,sort:"new",newOnly:true},{signal:controller.signal})).items;
      else if(key==="recommended")arr=(await queryCatalog({offset:0,pageSize:8,sort:"recommended",recommended:true},{signal:controller.signal})).items;
      else if(key==="recent")arr=get(REC_KEY,[]).map(find).filter(book=>book&&isStorefrontVisible(book)).slice(0,6);
      else arr=favs().map(find).filter(book=>book&&isStorefrontVisible(book)).slice(0,6);
      if(token!==requestId)return;
      content.innerHTML=`<section class="shop-section shop-section-selected"><h2>${title}</h2>${arr.length?`<div class="shop-grid">${arr.map(miniCard).join("")}</div>`:`<div class="empty-state shop-section-empty">${key==='favorites'?"❤️ ھازىرچە ياقتۇرغان كىتاب يوق.":key==='recent'?"🕘 ھازىرچە يېقىندا كۆرۈلگەن كىتاب يوق.":"كىتابلار تېخى قوشۇلمىغان."}</div>`}</section>`;
      bindDynamicActions(content);
    }catch(error){if(error?.name!=="AbortError"&&token===requestId){console.error("Home selection query failed.",error);content.innerHTML=`<section class="shop-section shop-section-selected"><h2>${title}</h2><div class="empty-state shop-section-empty">كىتابلارنى يۈكلەش ۋاقىتلىق مۇمكىن بولمىدى.</div></section>`}}
  }
  btn.onclick=()=>menu.classList.toggle("is-open");
  menu.querySelectorAll("[data-shop-tab]").forEach(b=>b.onclick=()=>{show(b.dataset.shopTab);menu.classList.remove("is-open");btn.querySelector("span").textContent="⌄"});
  document.addEventListener("click",e=>{if(!host.contains(e.target))menu.classList.remove("is-open")});
  content.innerHTML=`<div class="shop-select-hint">📚 ئۈستىدىكى «كىتابلارنى تاللاش» كۇنۇپكىسىنى بېسىپ، كۆرۈشنى خالايدىغان تۈرنى تاللاڭ.</div>`;
}
function normalizeText(v){
  return String(v||"").toLocaleLowerCase("ug").replace(/\s+/g," ").trim();
}
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]))}
function escapeAttr(v){return escapeHtml(v)}
function bookTime(book){const value=Date.parse(book?.createdAt||"");return Number.isFinite(value)?value:Number.NEGATIVE_INFINITY}
function uniqueCategories(){
  let seen=new Set(),out=[];
  C.forEach(b=>{let v=(b.category||"").trim();if(v&&!seen.has(v)){seen.add(v);out.push(v)}});
  return out;
}
function sortBooks(items,mode){
  let arr=[...items];
  const priceOf=(book,fallback)=>book.price===null||book.price===undefined||book.price===""?fallback:Number(book.price);
  if(mode==="priceLow")arr.sort((a,b)=>priceOf(a,Number.POSITIVE_INFINITY)-priceOf(b,Number.POSITIVE_INFINITY));
  else if(mode==="priceHigh")arr.sort((a,b)=>priceOf(b,Number.NEGATIVE_INFINITY)-priceOf(a,Number.NEGATIVE_INFINITY));
  else if(mode==="title")arr.sort((a,b)=>String(a.title||"").localeCompare(String(b.title||""),"ug"));
  else if(mode==="author")arr.sort((a,b)=>String(a.author||"").localeCompare(String(b.author||""),"ug"));
  else if(mode==="bestseller")arr.sort((a,b)=>(Number(b.salesCount)||0)-(Number(a.salesCount)||0)||bookTime(b)-bookTime(a)||a.catalogOrder-b.catalogOrder);
  else if(mode==="recommended")arr.sort((a,b)=>Number(b.isRecommended===true)-Number(a.isRecommended===true)||bookTime(b)-bookTime(a)||a.catalogOrder-b.catalogOrder);
  else arr.sort((a,b)=>bookTime(b)-bookTime(a)||a.catalogOrder-b.catalogOrder);
  return arr;
}
function bindDynamicActions(scope){
  if(!scope)return;
  scope.querySelectorAll("[data-cart-id]").forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();add(b.dataset.cartId)});
  scope.querySelectorAll("[data-fav-id]").forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();toggleFav(b.dataset.favId)});
  scope.querySelectorAll("[data-share-id]").forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();let book=find(b.dataset.shareId);if(book)shareBook(book)});
  renderFavButtons();
}
function bookCardMarkup(b,variant="listing"){
  const id=escapeAttr(b.id),href=escapeAttr(b.href),title=escapeHtml(b.title),authorName=storefrontAuthor(b),author=escapeHtml(authorName),category=escapeHtml(b.category||""),cover=escapeAttr(coverSrc(b));
  const authorBlock=authorName?`<div class="${variant==="search"?"advanced-search-meta":"book-author"}">${variant==="search"?`ئاپتورى: ${author}`:`ئاپتورى: ${author}`}</div>`:(variant==="search"?"":`<p class="book-author" hidden></p>`);
  if(variant==="search")return `<article class="advanced-search-result" data-live-book-id="${id}">
    <a class="advanced-search-cover" href="${href}"><img src="${cover}" alt="${escapeAttr(b.title)}" width="320" height="460" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${FALLBACK_COVER}'"></a>
    <div class="advanced-search-info">
      <a class="advanced-search-title" href="${href}">${title}</a>
      ${authorBlock}
      <div class="advanced-search-meta">${category}</div>
      <div class="advanced-search-price">${money(b.price)}</div>
      <div class="advanced-search-actions">
        <a class="detail-button" href="${href}">تەپسىلات</a>
        ${cartButton(b,"🛒 سېۋەتكە")}
        <button type="button" class="favorite-button" data-fav-id="${id}" aria-label="ياقتۇرۇش">♡</button>
        <button type="button" class="share-button" data-share-id="${id}" aria-label="ھەمبەھىرلەش">🔗</button>
      </div>
    </div>
  </article>`;
  return `<article class="book-card" data-live-book-id="${id}">
    <a class="book-image" href="${href}">
      <img alt="${escapeAttr(b.title)} كىتاب مۇقاۋىسى" src="${cover}" width="320" height="460" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${FALLBACK_COVER}'">
    </a>
    <div class="book-info">
      <h2 class="book-title">${title}</h2>
      ${authorName?`<p class="book-author">ئاپتورى: ${author}</p>`:`<p class="book-author" hidden></p>`}
      ${stockBadge(b)}
      <div class="book-price">${money(b.price)}</div>
      <div class="book-actions">
        <a class="detail-button" href="${href}">تەپسىلات</a>
        ${cartButton(b)}
        <button type="button" class="favorite-button" data-fav-id="${id}" aria-label="ياقتۇرۇش">♡</button>
        <button type="button" class="share-button" data-share-id="${id}" aria-label="ھەمبەھىرلەش">🔗</button>
      </div>
    </div>
  </article>`;
}
function searchResultCard(b){return bookCardMarkup(b,"search")}
function searchEnhance(){
  let input=document.querySelector("#searchInput"),res=document.querySelector("#searchResults");if(!input||!res)return;
  if(input.dataset.kutadguSearchReady==="1")return;
  input.dataset.kutadguSearchReady="1";
  let btn=document.querySelector("#searchButton");
  let box=input.closest(".search-box")||input.parentElement;
  if(!document.querySelector("#advancedSearchPanel")){
    let panel=document.createElement("div");
    panel.id="advancedSearchPanel";
    panel.className="advanced-search-panel";
    panel.innerHTML=`
      <div class="advanced-search-field">
        <label for="searchCategory">كىتاب تۈرى</label>
        <select id="searchCategory"><option value="">بارلىق تۈرلەر</option>${uniqueCategories().map(x=>`<option value="${x}">${x}</option>`).join("")}</select>
      </div>
      <div class="advanced-search-field">
        <label for="searchCollection">تاللانما</label>
        <select id="searchCollection"><option value="">بارلىق كىتابلار</option><option value="new">يېڭى كەلگەنلەر</option><option value="bestseller">كۆپ سېتىلغانلار</option><option value="recommended">تەۋسىيەلىك كىتابلار</option></select>
      </div>
      <div class="advanced-search-field">
        <label for="searchMinPrice">ئەڭ تۆۋەن باھا</label>
        <input id="searchMinPrice" type="number" min="0" inputmode="numeric" placeholder="0 ₺">
      </div>
      <div class="advanced-search-field">
        <label for="searchMaxPrice">ئەڭ يۇقىرى باھا</label>
        <input id="searchMaxPrice" type="number" min="0" inputmode="numeric" placeholder="مەسىلەن 500 ₺">
      </div>
      <div class="advanced-search-field">
        <label for="searchSort">تەرتىپلەش</label>
        <select id="searchSort">
          <option value="new">يېڭى قوشۇلغان تەرتىپ</option>
          <option value="title">كىتاب نامى بويىچە</option>
          <option value="author">ئاپتور بويىچە</option>
          <option value="priceLow">باھاسى ئەرزاندىن</option>
          <option value="priceHigh">باھاسى قىممەتتىن</option>
          <option value="bestseller">كۆپ سېتىلغان تەرتىپ</option>
          <option value="recommended">تەۋسىيەلىك تەرتىپ</option>
        </select>
      </div>
      <button type="button" class="advanced-search-reset" id="searchReset">↺ تازىلاش</button>`;
    const panelAnchor=document.querySelector(".home-search-quick-links")||box||res;
    panelAnchor.insertAdjacentElement("afterend",panel);
  }
  let category=document.querySelector("#searchCategory"),collection=document.querySelector("#searchCollection"),minEl=document.querySelector("#searchMinPrice"),maxEl=document.querySelector("#searchMaxPrice"),sortEl=document.querySelector("#searchSort"),reset=document.querySelector("#searchReset");
  const fallbackNotice=()=>catalogStatus.error?'<div class="catalog-data-notice">تور سانلىق مەلۇماتى ۋاقىتلىق يۈكلەنمىدى؛ ساقلانغان كىتاب تىزىملىكى كۆرسىتىلدى.</div>':"";
  function hasFilter(){return !!(input.value.trim()||category?.value||collection?.value||minEl?.value||maxEl?.value)}
  let requestId=0,controller=null,items=[],loadingMore=false;
  function readState(offset=0){
    const collectionMode=collection?.value||"";
    catalogQueryState.search={
      ...QUERY_DEFAULTS,
      offset,pageSize:pageSize(),search:input.value.trim(),category:category?.value||"",
      minPrice:minEl?.value??"",maxPrice:maxEl?.value??"",sort:collectionMode==="new"?"new":sortEl?.value||"new",
      newOnly:collectionMode==="new",recommended:collectionMode==="recommended",bestseller:collectionMode==="bestseller"
    };
    return catalogQueryState.search;
  }
  function draw(result,append=false){
    if(append){
      const known=new Set(items.map(book=>book.id));
      result.items.forEach(book=>{if(!known.has(book.id)){known.add(book.id);items.push(book)}});
    }else items=[...result.items];
    res.innerHTML=fallbackNotice()+`<div class="advanced-search-summary"><strong>${result.total}</strong> دانە كىتاب تېپىلدى</div>`+
      (items.length?`<div class="advanced-search-results-grid">${items.map(searchResultCard).join("")}</div>${result.hasMore?`<button type="button" class="search-load-more" id="searchLoadMore">يەنە ${result.pageSize} دانە كۆرۈش</button>`:""}`:'<div class="search-empty"><strong>نەتىجە تېپىلمىدى.</strong><br>سۈزگۈچنى تازىلاڭ ياكى باشقا كىتاب/ئاپتور نامىنى سىناڭ.</div>');
    bindDynamicActions(res);
    const more=res.querySelector("#searchLoadMore");
    if(more)more.onclick=()=>run(true);
  }
  async function run(append=false){
    if(!hasFilter()){
      controller?.abort();items=[];
      res.innerHTML=fallbackNotice()+'<div class="advanced-search-hint">🔎 كىتاب نامى ياكى ئاپتور يېزىڭ، ياكى تۈر/باھا سۈزگۈچىنى تاللاڭ.</div>';
      return;
    }
    if(loadingMore)return;
    const token=++requestId;
    controller?.abort();controller=new AbortController();
    const offset=append?items.length:0,state=readState(offset);
    loadingMore=append;
    if(append){const button=res.querySelector("#searchLoadMore");if(button){button.disabled=true;button.textContent="يۈكلىنىۋاتىدۇ…"}}
    else res.innerHTML='<div class="catalog-loading-state"><span class="catalog-loading-spinner" aria-hidden="true"></span><span>كىتابلار ئىزدەلىۋاتىدۇ…</span></div>';
    try{
      const result=await queryCatalog(state,{signal:controller.signal});
      if(token!==requestId)return;
      draw({...result,items:result.items.filter(isStorefrontVisible)},append);
      if(!append)trackSearchQuery(state.search,result.total);
    }catch(error){
      if(error?.name!=="AbortError"&&token===requestId){
        console.error("Catalog search failed.",error);
        res.innerHTML='<div class="search-empty"><strong>ئىزدەش ۋاقىتلىق ئىشلىمىدى.</strong><br>تورنى تەكشۈرۈپ قايتا سىناڭ.</div>';
      }
    }finally{if(token===requestId)loadingMore=false}
  }
  if(btn)btn.onclick=()=>run(false);
  let inputTimer;
  const debouncedRun=()=>{clearTimeout(inputTimer);inputTimer=setTimeout(()=>run(false),400)};
  input.addEventListener("input",debouncedRun);
  input.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();clearTimeout(inputTimer);run(false)}});
  [category,collection,sortEl].forEach(el=>el&&el.addEventListener("change",()=>run(false)));
  [minEl,maxEl].forEach(el=>el&&el.addEventListener("input",debouncedRun));
  if(reset)reset.onclick=()=>{input.value="";if(category)category.value="";if(collection)collection.value="";if(minEl)minEl.value="";if(maxEl)maxEl.value="";if(sortEl)sortEl.value="new";run(false)};
  res.innerHTML=fallbackNotice()+'<div class="advanced-search-hint">🔎 كىتاب نامى ياكى ئاپتور يېزىڭ، ياكى تۈر/باھا سۈزگۈچىنى تاللاڭ.</div>';
}

function dynamicListingCard(b){return bookCardMarkup(b,"listing")}

function setupCatalogFilters(){
  let grid=document.querySelector(".books-grid[data-catalog-source]");
  if(!grid||document.querySelector("#catalogFilterBar"))return;
  const source=grid.dataset.catalogSource;

  let bar=document.createElement("div");
  bar.id="catalogFilterBar";
  bar.className="catalog-filter-bar";
  bar.innerHTML=`
    <div class="catalog-filter-search"><label for="catalogFilterText">🔎 بۇ بۆلۈمدىن ئىزدەش</label><input id="catalogFilterText" type="search" placeholder="كىتاب ياكى ئاپتور ئىزدەڭ..."></div>
    <div class="catalog-filter-field"><label for="catalogCollection">تاللانما</label><select id="catalogCollection"><option value="">بارلىق كىتابلار</option><option value="new">يېڭى كەلگەنلەر</option><option value="bestseller">كۆپ سېتىلغانلار</option><option value="recommended">تەۋسىيەلىك</option></select></div>
    <div class="catalog-filter-field"><label for="catalogMinPrice">ئەڭ تۆۋەن باھا</label><input id="catalogMinPrice" type="number" min="0" placeholder="0 ₺"></div>
    <div class="catalog-filter-field"><label for="catalogMaxPrice">ئەڭ يۇقىرى باھا</label><input id="catalogMaxPrice" type="number" min="0" placeholder="500 ₺"></div>
    <div class="catalog-filter-field"><label for="catalogSort">تەرتىپلەش</label><select id="catalogSort"><option value="new">يېڭى قوشۇلغان</option><option value="title">كىتاب نامى</option><option value="author">ئاپتور</option><option value="priceLow">ئەرزاندىن قىممەتكە</option><option value="priceHigh">قىممەتتىن ئەرزانغا</option><option value="bestseller">كۆپ سېتىلغان تەرتىپ</option><option value="recommended">تەۋسىيەلىك تەرتىپ</option></select></div>
    <button type="button" class="catalog-filter-reset" id="catalogFilterReset">↺ تازىلاش</button>
    <div class="catalog-filter-count" id="catalogFilterCount"></div>`;
  grid.parentElement.insertBefore(bar,grid);
  let controls=document.createElement("div");controls.className="catalog-pagination-controls";grid.insertAdjacentElement("afterend",controls);
  const emptyMarkup='<strong>نەتىجە تېپىلمىدى.</strong><br><span>سۈزگۈچنى تازىلاڭ ياكى باشقا تۈرنى كۆرۈڭ.</span><br><button type="button" class="catalog-empty-reset">↺ سۈزگۈچنى تازىلاش</button> <a href="/#books">باشقا كىتابلارنى كۆرۈش</a>';
  let empty=document.createElement("div");empty.className="catalog-filter-empty";empty.hidden=true;empty.innerHTML=emptyMarkup;controls.insertAdjacentElement("afterend",empty);
  if(catalogStatus.error){
    const notice=document.createElement("div");notice.className="catalog-data-notice";notice.textContent="تور سانلىق مەلۇماتى ۋاقىتلىق يۈكلەنمىدى؛ ساقلانغان كىتاب تىزىملىكى كۆرسىتىلدى.";bar.insertAdjacentElement("beforebegin",notice);
  }

  let text=bar.querySelector("#catalogFilterText"),collection=bar.querySelector("#catalogCollection"),minEl=bar.querySelector("#catalogMinPrice"),maxEl=bar.querySelector("#catalogMaxPrice"),sortEl=bar.querySelector("#catalogSort"),count=bar.querySelector("#catalogFilterCount"),reset=bar.querySelector("#catalogFilterReset");
  let inputTimer,controller=null,requestId=0,items=[],loadingMore=false;
  function readState(offset=0){
    const collectionMode=collection.value||"";
    catalogQueryState.listing={
      ...QUERY_DEFAULTS,
      offset,pageSize:pageSize(),source,search:text.value.trim(),sort:collectionMode==="new"?"new":sortEl.value||"new",
      minPrice:minEl.value,maxPrice:maxEl.value,
      newOnly:collectionMode==="new",recommended:collectionMode==="recommended",bestseller:collectionMode==="bestseller"
    };
    return catalogQueryState.listing;
  }
  function draw(result,append=false){
    if(append){
      const known=new Set(items.map(book=>book.id));
      result.items.forEach(book=>{if(!known.has(book.id)){known.add(book.id);items.push(book)}});
    }else items=[...result.items];
    grid.innerHTML=items.map(dynamicListingCard).join("");
    bindDynamicActions(grid);
    count.textContent=`${items.length} / ${result.total} كىتاب كۆرسىتىلدى`;
    controls.innerHTML=result.hasMore?`<button type="button" class="catalog-load-more">تېخىمۇ كۆپ — يەنە ${result.pageSize} دانە</button>`:"";
    controls.querySelector(".catalog-load-more")?.addEventListener("click",()=>apply(true));
    empty.innerHTML=emptyMarkup;
    empty.querySelector(".catalog-empty-reset")?.addEventListener("click",()=>reset.click());
    empty.hidden=result.total!==0;
    grid.hidden=result.total===0;
    controls.hidden=result.total===0;
    if(!append){
      trackEvent("filter_apply",{source,results:result.total,rendered:items.length});
      trackSearchQuery(text.value,result.total);
    }
  }
  async function apply(append=false){
    if(loadingMore)return;
    const token=++requestId;
    controller?.abort();controller=new AbortController();
    const state=readState(append?items.length:0);
    loadingMore=append;
    empty.hidden=true;grid.hidden=false;controls.hidden=false;
    if(append){const button=controls.querySelector(".catalog-load-more");if(button){button.disabled=true;button.textContent="يۈكلىنىۋاتىدۇ…"}}
    else{items=[];grid.innerHTML='<div class="catalog-loading-state"><span class="catalog-loading-spinner" aria-hidden="true"></span><span>كىتابلار يۈكلىنىۋاتىدۇ…</span></div>';controls.innerHTML="";count.textContent=""}
    try{
      const result=await queryCatalog(state,{signal:controller.signal});
      if(token!==requestId)return;
      draw({...result,items:result.items.filter(isStorefrontVisible)},append);
    }catch(error){
      if(error?.name!=="AbortError"&&token===requestId){
        console.error("Category catalog query failed.",error);
        grid.hidden=true;controls.hidden=true;empty.hidden=false;
        empty.innerHTML='<strong>كىتابلارنى يۈكلەش مۇمكىن بولمىدى.</strong><br><span>تورنى تەكشۈرۈپ قايتا سىناڭ.</span>';
      }
    }finally{if(token===requestId)loadingMore=false}
  }
  const debouncedApply=()=>{clearTimeout(inputTimer);inputTimer=setTimeout(()=>apply(false),400)};
  [text,minEl,maxEl].forEach(el=>el.addEventListener("input",debouncedApply));
  [sortEl,collection].forEach(el=>el.addEventListener("change",()=>apply(false)));
  reset.onclick=()=>{text.value="";collection.value="";minEl.value="";maxEl.value="";sortEl.value="new";apply(false)};
  empty.querySelector(".catalog-empty-reset")?.addEventListener("click",()=>reset.click());
  apply(false);
}

function myBooksData(){
  return {
    newest:sortBooks(C,"new").slice(0,12),
    recommended:recommendedBooks(12),
    recent:get(REC_KEY,[]).map(find).filter(book=>book&&isStorefrontVisible(book)).slice(0,12),
    favorites:favs().map(find).filter(Boolean)
  };
}

function renderMyBooks(){
  let host=document.querySelector("#myBooksApp");if(!host)return;
  let active=host.dataset.activeTab||"newest";
  let remoteCounts={},requestId=0,controller=null;

  function tabMeta(data){
    return {
      newest:["🆕","يېڭى قوشۇلغانلار",remoteCounts.newest??data.newest.length],
      recommended:["⭐","تەۋسىيە قىلىنغانلار",remoteCounts.recommended??data.recommended.length],
      recent:["🕘","يېقىندا كۆرگەنلىرىم",data.recent.length],
      favorites:["❤️","ياقتۇرغانلىرىم",data.favorites.length]
    };
  }

  function emptyText(key){
    if(key==="favorites")return "❤️ ھازىرچە ياقتۇرغان كىتاب يوق. كىتاب كارتىسىدىكى يۈرەك بەلگىسىنى بېسىپ بۇ يەرگە ساقلىيالايسىز.";
    if(key==="recent")return "🕘 ھازىرچە كۆرۈش تارىخى يوق. بىر كىتابنىڭ تەپسىلات بېتىنى ئاچسىڭىز بۇ يەردە كۆرۈنىدۇ.";
    return "كىتابلار تېخى قوشۇلمىغان.";
  }

  async function draw(key,scroll=false){
    let data=myBooksData();
    let meta=tabMeta(data);
    active=key;
    host.dataset.activeTab=key;

    host.querySelectorAll("[data-mybooks-tab]").forEach(btn=>{
      btn.classList.toggle("is-active",btn.dataset.mybooksTab===key);
      btn.setAttribute("aria-selected",btn.dataset.mybooksTab===key?"true":"false");
    });

    let content=host.querySelector("#myBooksContent");
    const token=++requestId;controller?.abort();controller=new AbortController();
    content.innerHTML=`<div class="mybooks-section-head"><div><span class="mybooks-kicker">${meta[key][0]} مېنىڭ كىتابلىرىم</span><h2>${meta[key][1]}</h2></div></div><div class="catalog-loading-state"><span class="catalog-loading-spinner" aria-hidden="true"></span><span>كىتابلار يۈكلىنىۋاتىدۇ…</span></div>`;
    let arr=data[key]||[];
    try{
      if(key==="newest"){
        const result=await queryCatalog({offset:0,pageSize:12,sort:"new",newOnly:true},{signal:controller.signal});
        arr=result.items.filter(isStorefrontVisible);remoteCounts.newest=result.total;
      }else if(key==="recommended"){
        const result=await queryCatalog({offset:0,pageSize:12,sort:"recommended",recommended:true},{signal:controller.signal});
        arr=result.items.filter(isStorefrontVisible);remoteCounts.recommended=result.total;
      }
      if(token!==requestId)return;
      meta=tabMeta(myBooksData());
    }catch(error){if(error?.name==="AbortError")return;console.error("My books query failed.",error)}
    content.innerHTML=`
      <div class="mybooks-section-head">
        <div>
          <span class="mybooks-kicker">${meta[key][0]} مېنىڭ كىتابلىرىم</span>
          <h2>${meta[key][1]}</h2>
        </div>
        <span class="mybooks-result-count">${arr.length} دانە</span>
      </div>
      ${arr.length
        ? `<div class="${key==="favorites"?"favorites-grid":"shop-grid mybooks-grid"}">${arr.map(key==="favorites"?favoriteCard:miniCard).join("")}</div>`
        : `<div class="empty-state mybooks-empty">${emptyText(key)}</div>`
      }`;

    bindDynamicActions(content);
    content.querySelectorAll("[data-remove-favorite]").forEach(button=>button.onclick=()=>{toggleFav(button.dataset.removeFavorite);renderMyBooks()});

    // Favorite changes should refresh counts and the favorite tab immediately.
    content.querySelectorAll("[data-fav-id]").forEach(btn=>{
      const old=btn.onclick;
      btn.onclick=e=>{
        if(old)old(e);
        setTimeout(()=>renderMyBooks(),0);
      };
    });

    updateMyBooksCounts();
    if(scroll)content.scrollIntoView({behavior:"smooth",block:"start"});
  }

  function updateMyBooksCounts(){
    let data=myBooksData(),meta=tabMeta(data);
    Object.keys(meta).forEach(key=>{
      let badge=host.querySelector(`[data-mybooks-count="${key}"]`);
      if(badge)badge.textContent=meta[key][2];
    });
    let total=host.querySelector("#myBooksTotal");
    let cartNum=host.querySelector("#myBooksCartCount");
    if(total)total.textContent=remoteCatalog.available&&Number.isFinite(remoteCatalog.total)?remoteCatalog.total:C.length;
    if(cartNum)cartNum.textContent=cart().reduce((s,x)=>s+(x.qty||1),0);
  }

  let data=myBooksData(),meta=tabMeta(data);
  host.innerHTML=`
    <section class="mybooks-summary">
      <div class="mybooks-summary-card">
        <span>📚</span>
        <strong id="myBooksTotal">${C.length}</strong>
        <small>بارلىق كىتاب</small>
      </div>
      <div class="mybooks-summary-card">
        <span>❤️</span>
        <strong data-mybooks-count="favorites">${data.favorites.length}</strong>
        <small>ياقتۇرغان</small>
      </div>
      <div class="mybooks-summary-card">
        <span>🕘</span>
        <strong data-mybooks-count="recent">${data.recent.length}</strong>
        <small>يېقىندا كۆرگەن</small>
      </div>
      <a href="cart.html" class="mybooks-summary-card mybooks-summary-link">
        <span>🛒</span>
        <strong id="myBooksCartCount">${cart().reduce((s,x)=>s+(x.qty||1),0)}</strong>
        <small>سېۋەتتىكى كىتاب</small>
      </a>
    </section>

    <div class="mybooks-tabs" role="tablist" aria-label="مېنىڭ كىتابلىرىم">
      ${Object.entries(meta).map(([key,m])=>`
        <button type="button" role="tab" data-mybooks-tab="${key}" aria-selected="${key===active?"true":"false"}" class="${key===active?"is-active":""}">
          <span>${m[0]} ${m[1]}</span>
          <b data-mybooks-count="${key}">${m[2]}</b>
        </button>`).join("")}
    </div>

    <section id="myBooksContent" class="mybooks-content"></section>
  `;

  host.querySelectorAll("[data-mybooks-tab]").forEach(btn=>{
    btn.onclick=()=>draw(btn.dataset.mybooksTab,true);
  });

  draw(active,false);
}

function cartPage(){
  let host=document.querySelector("#cartItems");if(!host)return;
  let items=cartLines().map(line=>({...line,b:cartBookForLine(line)}));
  const orderable=items.filter(x=>isStorefrontVisible(x.b)&&stockInfo(x.b).canBuy);
  let totalQty=orderable.reduce((s,x)=>s+x.qty,0);
  let total=orderable.reduce((s,x)=>s+(x.b.price||0)*x.qty,0);
  let checkout=document.querySelector("#checkoutCard");
  const blocked=items.some(x=>!isStorefrontVisible(x.b)||!stockInfo(x.b).canBuy);

  if(!items.length){
    host.innerHTML=`<div class="empty-state"><span aria-hidden="true">🛒</span><h2>سېۋەت ھازىرچە بوش</h2><p>ياقتۇرغان كىتابلىرىڭىزنى تاللاپ سېۋەتكە قوشۇڭ.</p><a class="empty-state-button" href="/#books">كىتابلارنى كۆرۈش</a></div>`;
    if(checkout)checkout.hidden=true;
    updateBadge();
    return;
  }

    if(checkout){
      checkout.hidden=blocked;
      checkout.setAttribute("aria-hidden",blocked?"true":"false");
    }

  host.innerHTML=items.map(x=>{
    const visible=isStorefrontVisible(x.b);
    const stock=stockInfo(x.b);
    return `<div class="cart-item${visible?"":" cart-item-unavailable"}">
      <img src="${coverSrc(x.b)}" alt="${x.b.title}" width="75" height="95" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${FALLBACK_COVER}'">
      <div>
        <div class="cart-title">${x.b.title}</div>
        <div class="cart-meta">${x.b.author} · ${x.b.category}</div>
        <div class="cart-stock">${visible?stockBadge(x.b):`<span class="stock-badge stock-out">ھازىرچە تەمىنلەنمەيدۇ</span>`}</div>
        <div class="cart-unit-price">بىرلىك باھاسى: ${money(x.b.price)}</div>
      </div>
      <div class="qty-control">
        <button type="button" aria-label="ئازايتىش" data-minus="${x.b.id}"${!visible?" disabled":""}>−</button>
        <span>${x.qty}</span>
        <button type="button" aria-label="كۆپەيتىش" data-plus="${x.b.id}"${!visible||(Number.isFinite(stock.qty)&&x.qty>=stock.qty)?" disabled aria-disabled=\"true\"":""}>+</button>
      </div>
      <div class="cart-line-price"><small>جەمئىي</small><strong>${visible?money((x.b.price||0)*x.qty):"—"}</strong></div>
      <button type="button" class="remove-cart" data-remove="${x.b.id}">ئۆچۈرۈش</button>
    </div>`;
  }).join("")+
    `<div class="cart-summary">
       <div class="cart-summary-meta">
         <span>📚 جەمئىي كىتاب سانى: ${totalQty}</span>
         <span>💰 كىتاب جەمئىي: ${money(total)}</span>
       </div>
       <div class="cart-total">كىتاب جەمئىي: ${money(total)}</div>
       <p class="cart-shipping-note">بۇ سومما پەقەت كىتاب باھاسى. توشۇش ھەققى مەنزىل، ئېغىرلىق ۋە يەتكۈزۈش ئۇسۇلىغا قاراپ WhatsApp تا جەزمللىنىدۇ.</p>
       <div class="cart-summary-actions">
         ${blocked?"":`<button type="button" class="add-to-cart" id="scrollCheckout">📦 زاكاز ئۇچۇرىنى تولدۇرۇش</button>`}
         <button type="button" class="clear-cart" id="clearCart">🗑️ سېۋەتنى تازىلاش</button>
       </div>
     </div>`;

  host.querySelectorAll("[data-plus]").forEach(b=>b.onclick=()=>changeQty(b.dataset.plus,1));
  host.querySelectorAll("[data-minus]").forEach(b=>b.onclick=()=>changeQty(b.dataset.minus,-1));
  host.querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>{remove(b.dataset.remove);cartPage()});

  let clear=document.querySelector("#clearCart");
  if(clear)clear.onclick=()=>{
    if(confirm("سېۋەتتىكى بارلىق كىتابلارنى ئۆچۈرەمسىز؟")){
      set(CART_KEY,[]);
      cartPage();
      toast("سېۋەت تازىلاندى");
    }
  };

  let scroll=document.querySelector("#scrollCheckout");
  if(scroll)scroll.onclick=()=>document.querySelector("#checkoutCard")?.scrollIntoView({behavior:"smooth",block:"start"});

  setupCheckout();
  updateBadge();
}

function changeQty(id,d){
  let a=cart();
  const aliases=aliasMap();
  let x=a.find(i=>Legacy.sameBookIdentity?Legacy.sameBookIdentity(i.id,id,resolveStoredBookId,aliases):canonicalId(i.id)===canonicalId(id));
  if(!x)return;
  const book=find(id);
  if(!isStorefrontVisible(book))return;
  const stock=stockInfo(book);
  x.qty=sanitizeQty((sanitizeQty(x.qty))+d);
  if(Number.isFinite(stock.qty))x.qty=Math.min(x.qty,stock.qty);
  set(CART_KEY,a);
  cartPage();
  updateBadge();
}

function customerData(){
  let d=get(CUSTOMER_KEY,{});
  return d&&typeof d==="object"&&!Array.isArray(d)?d:{};
}

function saveCustomerData(){
  let data={
    name:document.querySelector("#customerName")?.value.trim()||"",
    phone:document.querySelector("#customerPhone")?.value.trim()||"",
    city:document.querySelector("#customerCity")?.value.trim()||"",
    address:document.querySelector("#customerAddress")?.value.trim()||"",
    delivery:document.querySelector("#deliveryMethod")?.value||"",
    note:document.querySelector("#customerNote")?.value.trim()||""
  };
  set(CUSTOMER_KEY,data);
  return data;
}

function loadCustomerData(){
  let d=customerData();
  let map={
    customerName:d.name,
    customerPhone:d.phone,
    customerCity:d.city,
    customerAddress:d.address,
    deliveryMethod:d.delivery,
    customerNote:d.note
  };
  Object.entries(map).forEach(([id,val])=>{
    let el=document.querySelector("#"+id);
    if(el&&val)el.value=val;
  });
}

function loadMemberProfileIntoCheckout(){
  const p=window.KutadguMember?.getProfile?.();if(!p)return;
  const values={
    customerName:p.full_name,
    customerPhone:p.phone,
    customerCity:[p.city,p.country].filter(Boolean).join(" / "),
    customerAddress:p.address
  };
  let changed=false;
  Object.entries(values).forEach(([id,value])=>{
    const el=document.querySelector("#"+id);
    if(el&&!el.value&&value){el.value=value;changed=true}
  });
  if(changed)saveCustomerData();
}

function makeOrderId(){
  let now=new Date();
  let y=String(now.getFullYear()).slice(-2);
  let m=String(now.getMonth()+1).padStart(2,"0");
  let d=String(now.getDate()).padStart(2,"0");
  let r=Math.floor(1000+Math.random()*9000);
  return `KB-${y}${m}${d}-${r}`;
}

let preparedOrder=null,preparedOrderSignature="";
function currentOrderSignature(customer){
  return JSON.stringify({cart:cart(),customer});
}

function buildOrderText(requireCustomer=true){
  let items=cartLines().map(line=>({...line,b:cartBookForLine(line)}));
  if(!items.length){toast("سېۋەت بوش");return null}
  if(items.some(x=>!isStorefrontVisible(x.b))){toast("سېۋەتتە ھازىرچە تەمىنلەنمەيدىغان كىتاب بار");return null}
  if(items.some(x=>!stockInfo(x.b).canBuy)){toast("سېۋەتتە تۈگەپ كەتكەن كىتاب بار؛ ئۇنى ئۆچۈرۈڭ");return null}

  let form=document.querySelector("#checkoutForm");
  if(requireCustomer&&form&&!form.reportValidity())return null;

  let c=saveCustomerData();
  let total=items.reduce((s,x)=>s+(x.b.price||0)*x.qty,0);
  let totalQty=items.reduce((s,x)=>s+x.qty,0);
  let orderId=makeOrderId();

  let lines=[
    "ئەسسالامۇ ئەلەيكۇم، تۆۋەندىكى كىتابلارنى زاكاز قىلماقچى ئىدىم:",
    "",
    `زاكاز نومۇرى: ${orderId}`,
    ""
  ];

  items.forEach((x,i)=>{
    lines.push(`${i+1}. ${x.b.title} — ${x.qty} دانە × ${money(x.b.price)} = ${money((x.b.price||0)*x.qty)}`);
  });

  lines.push(
    "",
    `جەمئىي كىتاب سانى: ${totalQty}`,
    `جەمئىي: ${money(total)}`,
    "",
    "خېرىدار ئۇچۇرى:",
    `ئىسمى: ${c.name||"-"}`,
    `تېلېفون: ${c.phone||"-"}`,
    `شەھەر / رايون: ${c.city||"-"}`,
    `ئادرېس: ${c.address||"-"}`,
    `يەتكۈزۈش: ${c.delivery||"-"}`,
    `ئىزاھات: ${c.note||"-"}`
  );

  return {
    text:lines.join("\n"),
    orderId,
    total,
    totalQty,
    customer:c,
    items:items.map(x=>({
      book_id:x.b.id,
      title:x.b.title,
      author:x.b.author,
      price:Number(x.b.price)||0,
      qty:x.qty,
      line_total:(Number(x.b.price)||0)*x.qty
    }))
  };
}

function getOrBuildOrder(requireCustomer=true){
  const form=document.querySelector("#checkoutForm");
  if(requireCustomer&&form&&!form.reportValidity())return null;
  const customer=saveCustomerData();
  const signature=currentOrderSignature(customer);
  if(preparedOrder&&preparedOrderSignature===signature)return preparedOrder;
  const order=buildOrderText(false);if(!order)return null;
  preparedOrder=order;preparedOrderSignature=signature;
  return order;
}

async function savePreparedOrderHistory(order){
  if(!order)return {saved:false};
  if(order.historySaved)return {saved:true};
  if(window.KutadguMember?.ready)await window.KutadguMember.ready;
  const result=await window.KutadguMember?.saveOrder?.(order);
  if(result?.saved)order.historySaved=true;
  return result||{saved:false,reason:"member_unavailable"};
}

async function showOrderPreview(){
  let o=getOrBuildOrder(true);if(!o)return null;
  let wrap=document.querySelector("#orderPreviewWrap");
  let pre=document.querySelector("#orderPreview");
  if(wrap&&pre){
    pre.textContent=o.text;
    wrap.hidden=false;
    wrap.scrollIntoView({behavior:"smooth",block:"nearest"});
  }
  try{
    const saved=await savePreparedOrderHistory(o);
    if(saved?.saved)toast("زاكاز تەييارلاندى ۋە ھېسابىڭىزغا ساقلاندى ✅");
    else if(saved?.reason==="not_signed_in")toast("زاكاز تەييارلاندى؛ ئەزا بولسىڭىز زاكاز تارىخىغىمۇ ساقلىنىدۇ");
    else toast("زاكاز ئۇچۇرى تەييار بولدى ✅");
  }catch(err){
    console.warn("Order history save failed",err);
    toast("زاكاز تەييارلاندى؛ تارىخقا ساقلاش ۋاقىتلىق مەغلۇپ بولدى");
  }
  return o;
}

async function copyOrder(){
  let o=getOrBuildOrder(true);if(!o)return;
  try{await savePreparedOrderHistory(o)}catch(err){console.warn("Order history save failed",err)}
  try{
    if(navigator.clipboard)await navigator.clipboard.writeText(o.text);
    else throw new Error();
    toast("زاكاز ئۇچۇرى كۆچۈرۈلدى 📋");
  }catch(e){
    let ta=document.createElement("textarea");
    ta.value=o.text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast("زاكاز ئۇچۇرى كۆچۈرۈلدى 📋");
  }
}

async function shareOrder(){
  let o=getOrBuildOrder(true);if(!o)return;
  try{await savePreparedOrderHistory(o)}catch(err){console.warn("Order history save failed",err)}
  try{
    if(navigator.share){
      await navigator.share({title:"قۇتادغۇبىلىك كىتابخانىسى — زاكاز",text:o.text});
      toast("زاكاز ھەمبەھىرلەندى 📤");
    }else{
      await copyOrder();
      toast("ھەمبەھىرلەش يوق؛ زاكاز كۆچۈرۈلدى 📋");
    }
  }catch(e){}
}

function whatsappOrderUrl(text){
  const configured=String(window.KUTADGU_WHATSAPP_NUMBER||"").replace(/\D/g,"");
  const base=configured?`https://wa.me/${configured}`:"https://wa.me/";
  return `${base}?text=${encodeURIComponent(text)}`;
}

function safeText(value){
  const span=document.createElement("span");
  span.textContent=String(value||"");
  return span.innerHTML;
}

function siteFooterHtml(){
  const cfg=window.KUTADGU_CONTACT_CONFIG||{};
  const whatsapp=String(cfg.whatsapp||window.KUTADGU_WHATSAPP_NUMBER||"").replace(/\D/g,"");
  const waHref=whatsapp?`https://wa.me/${whatsapp}`:"https://wa.me/";
  const phoneHref=cfg.phone?`tel:${String(cfg.phone).replace(/[^+\d]/g,"")}`:"";
  const ig=cfg.instagramUrl||"";
  const maps=cfg.addressUrl||"";
  return `<div class="site-footer-inner">
    <strong class="site-footer-name">قۇتادغۇبىلىك كىتابخانىسى</strong>
    <nav class="site-footer-links" aria-label="ئىشەنچ ۋە ئالاقە">
      <a href="${waHref}" target="_blank" rel="noopener noreferrer">WhatsApp</a>
      ${phoneHref?`<a href="${phoneHref}">تېلېفون</a>`:""}
      ${ig?`<a href="${ig}" target="_blank" rel="noopener noreferrer">Instagram</a>`:""}
      ${maps?`<a href="${maps}" target="_blank" rel="noopener noreferrer">خەرىتە</a>`:""}
      <a href="order-info.html">زاكاز قانداق بولىدۇ</a>
      <a href="privacy.html">مەخپىيەتلىك</a>
      <a href="returns.html">قايتۇرۇش / ئالماشتۇرۇش</a>
    </nav>
    <p class="site-footer-copy">© ${new Date().getFullYear()} قۇتادغۇبىلىك كىتابخانىسى — بارلىق ھوقۇقلار قوغدىلىدۇ.</p>
  </div>`;
}
function renderSiteFooter(){
  let foot=document.querySelector("footer");
  if(!foot){
    foot=document.createElement("footer");
    document.body.appendChild(foot);
  }
  if(foot.dataset.kutadguFooter==="1")return;
  foot.dataset.kutadguFooter="1";
  foot.classList.add("site-footer");
  foot.innerHTML=siteFooterHtml();
}

function renderContactSection(){
  const host=document.querySelector("#contactDetails");if(!host)return;
  const cfg=window.KUTADGU_CONTACT_CONFIG||{};
  const whatsapp=String(cfg.whatsapp||window.KUTADGU_WHATSAPP_NUMBER||"").replace(/\D/g,"");
  const cards=[];
  const add=(icon,label,value,href="",className="",forceLtr=false)=>{
    if(!value)return;
    const valueHtml=forceLtr
      ? `<small class="contact-number-ltr" dir="ltr"><bdi dir="ltr">${safeText(value)}</bdi></small>`
      : `<small>${safeText(value)}</small>`;
    const body=`<span aria-hidden="true">${icon}</span><div><strong>${safeText(label)}</strong>${valueHtml}</div>`;
    const classes=`contact-card${className?` ${className}`:""}`;
    cards.push(href?`<a class="${classes}" href="${href}"${/^https?:/i.test(href)?' target="_blank" rel="noopener noreferrer"':""}>${body}</a>`:`<div class="${classes}">${body}</div>`);
  };
  add("☎️","تېلېفون",cfg.phone,cfg.phone?`tel:${String(cfg.phone).replace(/[^+\d]/g,"")}`:"","",true);
  add("📷","Instagram",cfg.instagram,cfg.instagramUrl||"","",true);
  add("📍","دۇكان ئادرېسى",cfg.address,cfg.addressUrl||"","contact-address");
  add("🕒","خىزمەت ۋاقتى",cfg.hours);
  const waHref=whatsapp?`https://wa.me/${whatsapp}`:"https://wa.me/";
  cards.unshift(`<a class="contact-card contact-whatsapp" href="${waHref}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">💬</span><div><strong>WhatsApp</strong><small class="contact-number-ltr" dir="ltr"><bdi dir="ltr">${whatsapp?safeText(cfg.whatsappDisplay||cfg.phone||"ئۇچۇر يوللاش"):"WhatsApp ئارقىلىق ئالاقىلىشىش"}</bdi></small></div></a>`);
  const photo=String(cfg.storePhoto||cfg.aboutPhoto||"").trim();
  if(photo&&!/[<>"']/.test(photo)){
    cards.push(`<figure class="contact-store-photo"><img src="${safeText(photo)}" alt="دۇكان رەسىمى" width="640" height="400" loading="lazy" decoding="async"></figure>`);
  }
  host.innerHTML=cards.join("");
}

async function orderWithWhatsApp(){
  let o=getOrBuildOrder(true);if(!o)return;
  const bookIds=[...new Set(cart().map(line=>canonicalId(line.id)).filter(id=>id&&/^\d+$/.test(String(id))))];
  trackEvent("whatsapp_order_click",{bookId:bookIds[0]||"",bookIds,items:bookIds.length||o.items?.length||cart().length,total:o.total||0});
  const url=whatsappOrderUrl(o.text);
  const popup=window.open(url,"_blank");
  if(popup)popup.opener=null;
  else location.href=url;
  try{await savePreparedOrderHistory(o)}catch(err){console.warn("Order history save failed",err)}
}

function setupCheckout(){
  let form=document.querySelector("#checkoutForm");if(!form||form.dataset.ready==="1")return;
  form.dataset.ready="1";
  loadCustomerData();

  form.querySelectorAll("input,textarea,select").forEach(el=>{
    el.addEventListener("change",saveCustomerData);
    el.addEventListener("blur",saveCustomerData);
  });

  let prepare=document.querySelector("#prepareOrder");
  let copy=document.querySelector("#copyOrder");
  let share=document.querySelector("#shareOrder");
  let whatsapp=document.querySelector("#whatsappOrder");

  if(whatsapp)whatsapp.onclick=orderWithWhatsApp;
  if(prepare)prepare.onclick=showOrderPreview;
  if(copy)copy.onclick=copyOrder;
  if(share)share.onclick=shareOrder;
}



/* ===== Premium configurable carousel: 2x4 desktop, swipe carousel mobile ===== */
function applyBestsellerHonesty(hasSales){
  const show=!!hasSales;
  document.querySelectorAll("[data-carousel-mode='bestseller']").forEach(el=>{
    el.hidden=!show;
    if(!show)el.setAttribute("aria-hidden","true");
    else el.removeAttribute("aria-hidden");
  });
  document.querySelectorAll("#searchCollection option[value='bestseller'],#catalogCollection option[value='bestseller'],#searchSort option[value='bestseller'],#catalogSort option[value='bestseller']").forEach(opt=>{
    opt.hidden=!show;
    opt.disabled=!show;
    if(!show&&opt.selected)opt.selected=false;
  });
  return show;
}

async function countPositiveSales(){
  if(Number.isFinite(window.__kutadguPositiveSalesCount))return window.__kutadguPositiveSalesCount;
  const cfg=supabasePublicConfig();
  if(cfg&&cfg.url&&cfg.anonKey){
    try{
      const url=`${String(cfg.url).replace(/\/+$/,"")}/rest/v1/books?select=id&sales_count=gt.0`;
      const res=await fetch(url,{
        method:"HEAD",
        headers:{
          apikey:cfg.anonKey,
          Authorization:`Bearer ${cfg.anonKey}`,
          Prefer:"count=exact",
          Range:"0-0"
        }
      });
      const range=res.headers.get("content-range")||"";
      const total=Number(String(range).split("/")[1]);
      if(Number.isFinite(total)){
        window.__kutadguPositiveSalesCount=total;
        return total;
      }
    }catch(err){console.warn("positive sales count skipped",err)}
  }
  const n=C.filter(book=>Number(book.salesCount)>0).length;
  window.__kutadguPositiveSalesCount=n;
  return n;
}

async function setupHomeCarousel(){
  const host=document.querySelector("#homeCarouselTrack");
  const viewport=document.querySelector("#homeCarouselViewport");
  const dotsHost=document.querySelector("#homeCarouselDots");
  const tabs=[...document.querySelectorAll("[data-carousel-mode]")];
  if(!host||!viewport||!dotsHost)return;
  const hasSales=(await countPositiveSales())>0;
  applyBestsellerHonesty(hasSales);
  if(viewport.dataset.kutadguCarouselReady==="1")return;
  viewport.dataset.kutadguCarouselReady="1";
  const carouselModeFlags={recommended:"recommendations",bestseller:"bestSellers",newest:"newArrivals"};
  const enabledModes=["recommended","bestseller","newest"].filter(item=>{
    if(!featureEnabled(carouselModeFlags[item]))return false;
    if(item==="bestseller"&&!hasSales)return false;
    return true;
  });
  tabs.forEach(button=>{button.hidden=!enabledModes.includes(button.dataset.carouselMode)});
  if(!enabledModes.length){viewport.closest("section")?.setAttribute("hidden","");return}

  const carousel={
    desktopCardsPerRow:4,desktopRows:2,tabletVisibleCards:4,
    autoplayDelay:6000,animationDuration:600,staggerDelay:90,
    autoPlayEnabled:true,mobileAutoPlayEnabled:false,
    ...(appConfig().carousel||{})
  };
  const reducedMotion=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches===true;
  const gap=10,sampleCover=FALLBACK_COVER;
  let mode=enabledModes[0],list=[],index=0,timer=null,touchX=null,dualLayout=window.innerWidth>1100;
  let modeRequestId=0,modeController=null;
  const modeCache=new Map();
  host.style.setProperty("--carousel-duration",`${Number(carousel.animationDuration)||600}ms`);
  host.style.setProperty("--carousel-stagger",`${Number(carousel.staggerDelay)||90}ms`);
  viewport.tabIndex=0;
  viewport.setAttribute("role","region");
  viewport.setAttribute("aria-roledescription","carousel");
  viewport.setAttribute("aria-label","كىتاب تاللانمىلىرى");

  function modeState(currentMode,offset=0){
    catalogQueryState.carousel={
      ...QUERY_DEFAULTS,offset,pageSize:8,
      sort:currentMode==="bestseller"?"bestseller":currentMode==="recommended"?"recommended":"new",
      newOnly:currentMode==="newest",recommended:currentMode==="recommended",bestseller:currentMode==="bestseller",
      allowZeroSales:false
    };
    return catalogQueryState.carousel;
  }
  async function loadMode(currentMode,append=false){
    const existing=modeCache.get(currentMode)||{items:[],hasMore:true,total:0};
    if(append&&(!existing.hasMore||existing.items.length>=24))return existing;
    const token=++modeRequestId;modeController?.abort();modeController=new AbortController();
    let result=await queryCatalog(modeState(currentMode,append?existing.items.length:0),{signal:modeController.signal});
    if(token!==modeRequestId)throw new DOMException("Stale carousel query","AbortError");
    const merged=append?[...existing.items]:[];
    const known=new Set(merged.map(book=>book.id));
    result.items.filter(isStorefrontVisible).forEach(book=>{if(!known.has(book.id)){known.add(book.id);merged.push(book)}});
    const value={items:merged,hasMore:result.hasMore&&merged.length<24,total:result.total};
    modeCache.set(currentMode,value);
    return value;
  }
  function card(b,i=0){
    const loading=i<4?"eager":"lazy";
    return `<article class="home-carousel-card">
      <button type="button" class="home-carousel-fav favorite-button mini-heart" data-fav-id="${b.id}" aria-label="ياقتۇرۇش">♡</button>
      <a href="${b.href}" class="home-carousel-link">
        <div class="home-carousel-cover"><img src="${coverSrc(b)}" alt="${b.title||'كىتاب مۇقاۋىسى'}" width="320" height="460" loading="${loading}" decoding="async" onerror="this.onerror=null;this.src='${sampleCover}'"></div>
      </a>
      <div class="home-carousel-info">
        <a href="${b.href}" class="home-carousel-meta-link"><div class="home-carousel-title">${b.title||"كىتاب"}</div>${storefrontAuthor(b)?`<div class="home-carousel-author">${storefrontAuthor(b)}</div>`:""}</a>
        <div class="home-carousel-bottom"><span class="home-carousel-price">${money(b.price)}</span>${cartButton(b,"🛒","home-carousel-cart add-to-cart")}</div>
      </div>
    </article>`;
  }
  const isDual=()=>window.innerWidth>1100;
  const visibleSingle=()=>{
    if(window.innerWidth<=430)return 1;
    if(window.innerWidth<=850)return 2;
    return Math.min(3,Number(carousel.tabletVisibleCards)||3);
  };
  const rowLength=()=>Math.ceil(list.length/Math.max(1,Number(carousel.desktopRows)||2));
  const maxIndex=()=>Math.max(0,(isDual()?rowLength()-(Number(carousel.desktopCardsPerRow)||4):list.length-visibleSingle()));

  function renderDots(){
    const count=maxIndex()+1;
    dotsHost.innerHTML=Array.from({length:count},(_,i)=>`<button type="button" class="home-carousel-dot${i===index?' is-active':''}" data-carousel-dot="${i}" aria-label="${i+1}-كۆرۈنۈش"></button>`).join("");
    dotsHost.querySelectorAll("[data-carousel-dot]").forEach(button=>button.onclick=()=>{index=Number(button.dataset.carouselDot)||0;move();restart()});
  }
  function move(){
    index=Math.max(0,Math.min(index,maxIndex()));
    const first=host.querySelector(".home-carousel-card");if(!first)return;
    const lane=isDual()?first.closest(".home-carousel-row"):host;
    const laneStyle=window.getComputedStyle(lane);
    const renderedGap=parseFloat(laneStyle.columnGap||laneStyle.gap)||gap;
    const step=first.getBoundingClientRect().width+renderedGap;
    if(isDual()){
      host.style.transform="";
      host.querySelectorAll(".home-carousel-row").forEach(row=>row.style.transform=`translateX(${index*step}px)`);
    }else{
      host.style.transform=`translateX(${index*step}px)`;
    }
    dotsHost.querySelectorAll(".home-carousel-dot").forEach((dot,i)=>dot.classList.toggle("is-active",i===index));
  }
  function draw(rotate=false){
    const canRotate=rotate&&mode==="recommended"&&list.length>8;
    index=canRotate?(new Date().getDate()%Math.min(3,maxIndex()+1)):0;
    host.style.transform="translateX(0)";
    host.classList.toggle("is-dual-row",isDual());host.classList.toggle("is-single-row",!isDual());
    if(isDual()){
      const midpoint=Math.ceil(list.length/2),top=list.slice(0,midpoint),bottom=list.slice(midpoint);
      host.innerHTML=`<div class="home-carousel-row">${top.map((b,i)=>card(b,i)).join("")}</div><div class="home-carousel-row">${bottom.map((b,i)=>card(b,i+top.length)).join("")}</div>`;
    }else host.innerHTML=list.map((b,i)=>card(b,i)).join("");
    bindDynamicActions(host);renderFavButtons();renderDots();move();
  }
  async function setMode(nextMode){
    mode=enabledModes.includes(nextMode)?nextMode:enabledModes[0];
    tabs.forEach(button=>{const active=button.dataset.carouselMode===mode;button.classList.toggle("is-active",active);button.setAttribute("aria-selected",active?"true":"false")});
    const requestedMode=mode;
    host.innerHTML='<div class="catalog-loading-state"><span class="catalog-loading-spinner" aria-hidden="true"></span><span>كىتابلار يۈكلىنىۋاتىدۇ…</span></div>';
    try{
      const loaded=modeCache.get(requestedMode)||await loadMode(requestedMode,false);
      if(mode!==requestedMode)return;
      list=loaded.items;
      if(!list.length){
        stop();
        dotsHost.innerHTML="";
        host.innerHTML='<div class="empty-state shop-section-empty">بۇ بۆلۈمگە تېخى كىتاب تاللانمىدى.</div>';
        return;
      }
      draw(true);restart();
    }catch(error){if(error?.name!=="AbortError"){console.error("Homepage carousel query failed.",error);host.innerHTML='<div class="empty-state shop-section-empty">كىتابلارنى يۈكلەش ۋاقىتلىق مۇمكىن بولمىدى.</div>';dotsHost.innerHTML=""}}
  }
  async function next(){
    const cached=modeCache.get(mode);
    if(index>=maxIndex()&&cached?.hasMore&&cached.items.length<24){
      try{const loaded=await loadMode(mode,true);list=loaded.items;draw();index=Math.min(1,maxIndex());move();return}catch(error){if(error?.name!=="AbortError")console.warn("More carousel books could not be loaded.",error)}
    }
    index=index>=maxIndex()?0:index+1;move();
  }
  function prev(){index=index<=0?maxIndex():index-1;move()}
  function stop(){if(timer){clearInterval(timer);timer=null}}
  function start(){
    stop();
    const mobile=window.innerWidth<=700;
    if(reducedMotion||!featureEnabled("autoCarousel")||carousel.autoPlayEnabled===false||(mobile&&carousel.mobileAutoPlayEnabled!==true)||document.hidden)return;
    timer=setInterval(()=>{next()},Math.max(5000,Number(carousel.autoplayDelay)||6000));
  }
  function restart(){start()}

  tabs.forEach(button=>button.addEventListener("click",()=>setMode(button.dataset.carouselMode)));
  document.querySelector("#carouselNext")?.addEventListener("click",()=>{next();restart()});
  document.querySelector("#carouselPrev")?.addEventListener("click",()=>{prev();restart()});
  viewport.addEventListener("mouseenter",stop);viewport.addEventListener("mouseleave",start);
  viewport.addEventListener("focusin",stop);viewport.addEventListener("focusout",start);
  viewport.addEventListener("touchstart",event=>{
    if(window.innerWidth<=768)return;
    touchX=event.touches[0]?.clientX??null;stop();
  },{passive:true});
  viewport.addEventListener("touchend",event=>{
    if(window.innerWidth<=768||touchX===null)return;
    const end=event.changedTouches[0]?.clientX??touchX,delta=end-touchX;
    touchX=null;if(Math.abs(delta)>38)(delta<0?next:prev)();restart();
  },{passive:true});
  viewport.addEventListener("keydown",event=>{if(event.key==="ArrowLeft"){event.preventDefault();next();restart()}else if(event.key==="ArrowRight"){event.preventDefault();prev();restart()}});
  document.addEventListener("visibilitychange",()=>document.hidden?stop():start());
  window.addEventListener("resize",()=>{const changed=dualLayout!==isDual();dualLayout=isDual();if(changed)draw();else{index=Math.min(index,maxIndex());renderDots();move()}restart()});
  setMode(enabledModes[0]);
}

function loadMemberSystem(){
  if(document.querySelector('script[data-kutadgu-member-script]')||window.KutadguMember)return;
  const script=document.createElement("script");
  script.src="member.js?v=8";script.async=true;script.dataset.kutadguMemberScript="1";
  document.body.appendChild(script);
}
function refreshAfterMemberSync(){
  updateBadge();renderFavButtons();
  if(document.querySelector("#cartItems"))cartPage();
  if(document.querySelector("#myBooksApp"))renderMyBooks();
  loadMemberProfileIntoCheckout();
}
function loadAssetScript(src,id){
  if(document.getElementById(id))return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const script=document.createElement("script");script.id=id;script.src=src;script.defer=true;
    script.onload=resolve;script.onerror=()=>reject(new Error(`${src} could not be loaded`));
    document.head.appendChild(script);
  });
}
function ensureCoverSystemCss(){
  let el=document.querySelector("link[data-kutadgu-covers]");
  if(!el){
    el=document.createElement("link");
    el.rel="stylesheet";
    el.href="covers.css?v=2";
    el.dataset.kutadguCovers="1";
  }
  document.head.appendChild(el);
}
function loadPremiumUX(){
  if(!document.querySelector('link[data-kutadgu-premium-ux]')){
    const link=document.createElement("link");link.rel="stylesheet";link.href="premium-ux.css?v=8";link.dataset.kutadguPremiumUx="1";document.head.appendChild(link);
  }
  ensureCoverSystemCss();
  return loadAssetScript("premium-ux.js?v=9","kutadguPremiumUxScript");
}
let staticShellReady=false;
function initStaticShell(){
  if(staticShellReady)return;
  staticShellReady=true;
  ensureCoverSystemCss();
  injectFloat();
  applyStaticCoverFallbacks();
  syncStaticCards();
  decorateCards();
  searchEnhance();
  renderHomeFeaturedBooks();
  renderHomeSections();
  renderMyBooks();
  renderFavoritesPage();
  renderContactSection();
  renderSiteFooter();
  cartPage();
  setupCheckout();
}
function init(){
  initStaticShell();
  if(isStorefrontHomepage())applyHomepageDocumentTitle();
  applyDetailCoverFallback();
  decorateDetail();
  setupCatalogFilters();
  setupHomeCarousel();
  countPositiveSales().then(n=>applyBestsellerHonesty(n>0));
  // Refresh catalog-backed views after remote availability is known.
  // Selector/contact/checkout shells are already built by initStaticShell().
  renderHomeFeaturedBooks();
  renderMyBooks();
  renderFavoritesPage();
  cartPage();
  syncStaticCards();
  if(document.documentElement.dataset.kutadguShopListeners!=="1"){
    document.documentElement.dataset.kutadguShopListeners="1";
    document.addEventListener("kutadgu-member-state-synced",refreshAfterMemberSync);
    document.addEventListener("kutadgu-member-change",loadMemberProfileIntoCheckout);
    window.addEventListener("resize",()=>{ensureDesktopShopNav();updateBadge()});
    window.addEventListener("pageshow",()=>{if(isStorefrontHomepage())applyHomepageDocumentTitle()});
  }
  loadMemberSystem();
}
let bootStarted=false;
async function boot(){
  if(bootStarted)return;
  bootStarted=true;  try{await loadAssetScript("app-config.js?v=1","kutadguAppConfigScript")}catch(error){console.warn(error)}
  initStaticShell();
  await loadRemoteCatalog();
  await hydratePageBook();
  const savedIds=[...cart().map(item=>item.id),...favs(),...get(REC_KEY,[])];
  await hydrateBooksByIds(savedIds);
  migratePersistedBookIds();
  await hydrateBooksByIds([...cart().map(item=>item.id),...favs()]);
  migratePersistedBookIds();
  window.KUTADGU_LIVE_CATALOG=C;
  init();
  document.dispatchEvent(new CustomEvent("kutadgu:catalog-ready",{detail:{count:C.length}}));
  try{await loadPremiumUX()}catch(error){console.warn(error)}
  ensureCoverSystemCss();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
window.kutadguShop={add,remove,toggleFav,cart,cartHas,cartLines,favorites:()=>[...favs()],favHas,find,canonicalId,hydrateBooksByIds,shareBook,buildOrderText,copyOrder,shareOrder,orderWithWhatsApp,whatsappOrderUrl,getCatalog:()=>[...C],queryCatalog,getQueryState:()=>JSON.parse(JSON.stringify(catalogQueryState)),trackEvent,migratePersistedBookIds,renderBookGallery,normalizeGalleryImages,isStorefrontVisible,refreshStorefrontVisibility,applyBestsellerHonesty,countPositiveSales,storefrontAuthor,storefrontIsbn,isPlaceholderAuthor,aliasMap,HOMEPAGE_DOCUMENT_TITLE,isStorefrontHomepage,isBookDetailDocument,applyHomepageDocumentTitle};
})();
