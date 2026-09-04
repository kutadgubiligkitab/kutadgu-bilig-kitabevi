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
    if(safeUrlApi()&&safeUrlApi().isSafeCoverUrl&&!safeUrlApi().isSafeCoverUrl(url))return;
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
    href:bookDetailHref(id,isRemote?"":book.href),
    pages:book.pages??null,
    translator:book.translator||"",
    language:book.language||"",
    publishDate:value("publishDate","publish_date","")||"",
    publishYear:value("publishYear","publish_year","")||"",
    publisher:book.publisher||"",
    coverType:(bibliographicLib().normalizeCoverType?bibliographicLib().normalizeCoverType(value("coverType","cover_type","")):String(value("coverType","cover_type","")||"").trim())||"",
    bookSize:(bibliographicLib().normalizeBookSize?bibliographicLib().normalizeBookSize(value("bookSize","book_size","")):String(value("bookSize","book_size","")||"").trim())||"",
    dimensions:value("dimensions","dimensions","")||"",
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
const CART_KEY="kutadgu-cart-v1", CART_DISPLAY_KEY="kutadgu-cart-display-v1", CART_DISPLAY_VERSION=1, CART_DISPLAY_MAX_ITEMS=80, FAV_KEY="kutadgu-favorites-v1", REC_KEY="kutadgu-recent-v1", CUSTOMER_KEY="kutadgu-customer-v1";
const SHOP_OWNER_KEY="kutadgu-shop-owner-v1", SHOP_OWNER_GUEST="guest", SHOP_OWNER_STALE="stale";
function isPreviewShopDebug(){
  try{
    const host=String(location.hostname||"").toLowerCase();
    if(host==="www.kutadgubilik.com"||host==="kutadgubilik.com")return false;
    if(typeof window.kutadguIsProductionAuthHost==="function"&&window.kutadguIsProductionAuthHost(host))return false;
    return host.endsWith(".vercel.app")||host==="localhost"||host==="127.0.0.1";
  }catch(e){return false}
}
const FALLBACK_COVER="/sample-book-cover.png";
const COVER_LAYOUT_TEST_MODE=window.KUTADGU_COVER_LAYOUT_TEST_MODE===true;
function safeUrlApi(){return window.KutadguSafeUrl||null}
function escapeHtml(v){
  const api=safeUrlApi();
  if(api&&api.escapeHtml)return api.escapeHtml(v);
  return String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
function escapeAttr(v){return escapeHtml(v)}
function isSafeCoverUrl(raw){
  const api=safeUrlApi();
  if(api&&api.isSafeCoverUrl)return api.isSafeCoverUrl(raw);
  const t=String(raw||"").trim();
  if(!t||/^(?:javascript|data|vbscript|file|blob)\s*:/i.test(t)||/[<>"'\s]/.test(t)||t.startsWith("//"))return false;
  if(/^https?:\/\//i.test(t))return true;
  if(t.startsWith("/")&&!t.startsWith("//"))return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(t);
}
function safeCoverUrl(raw,opts){
  const api=safeUrlApi();
  if(api&&api.safeCoverUrl)return api.safeCoverUrl(raw,opts&&typeof opts==="object"?opts:{fallback:FALLBACK_COVER});
  const t=String(raw||"").trim();
  if(!t)return FALLBACK_COVER;
  return isSafeCoverUrl(t)?t:FALLBACK_COVER;
}
function safeHref(raw,fallback){
  const api=safeUrlApi();
  if(api&&api.safeHref)return api.safeHref(raw,fallback);
  const t=String(raw||"").trim();
  if(!t)return fallback==null?"#":fallback;
  if(/^(?:javascript|data|vbscript|file|blob)\s*:/i.test(t)||t.startsWith("//"))return fallback==null?"#":fallback;
  if(/^https?:\/\//i.test(t)||t.startsWith("#")||t.startsWith("?")||t.startsWith("/")||t.startsWith("./")||t.startsWith("../"))return t;
  if(!/^[a-z][a-z0-9+.-]*:/i.test(t))return t;
  return fallback==null?"#":fallback;
}
function coverSrc(book){
  if(COVER_LAYOUT_TEST_MODE)return FALLBACK_COVER;
  const raw=String(book&&(book.image||book.image_url)||"").trim();
  if(!raw||isSampleDemoCover(raw))return "";
  const safe=safeCoverUrl(raw,{fallback:""});
  if(!safe||isSampleDemoCover(safe))return "";
  return storefrontAssetPath(safe);
}
function isSampleDemoCover(src){
  return /(?:^|\/)sample-book-cover\.png(?:$|\?)/i.test(String(src||"").trim());
}
const COVER_RETRY_MAX=2;
const COVER_RETRY_DELAYS=[300,900];
const COVER_RETRY_CONCURRENCY=3;
const coverRetryStates=new WeakMap();
let coverRetryQueue=[];
let coverRetryInFlight=0;
let coverRetryGenerationSeq=0;
function isRetryableCoverUrl(src){
  const t=String(src||"").trim();
  if(!t||isSampleDemoCover(t)||!isSafeCoverUrl(t))return false;
  return true;
}
function coverRetryState(img){
  let state=coverRetryStates.get(img);
  if(!state){
    state={generation:0,failures:0,timer:0,queued:false,src:"",release:null,replaying:false};
    coverRetryStates.set(img,state);
  }
  return state;
}
function approvedCoverSrc(img){
  return String(img&&(img.getAttribute("data-cover-src")||img.getAttribute("src"))||"").trim();
}
function isCoverJobCurrent(img,generation,src){
  if(!img||!img.isConnected)return false;
  const state=coverRetryStates.get(img);
  if(!state)return false;
  if(state.generation!==generation)return false;
  if(src&&state.src!==src)return false;
  if(src&&approvedCoverSrc(img)!==src)return false;
  return true;
}
function releaseCoverRetrySlot(state){
  if(!state||typeof state.release!=="function")return;
  const fn=state.release;
  state.release=null;
  fn();
}
function beginCoverAssignment(img,src){
  const prev=img?coverRetryStates.get(img):null;
  if(prev){
    if(prev.timer){clearTimeout(prev.timer);prev.timer=0}
    prev.queued=false;
    prev.replaying=false;
    releaseCoverRetrySlot(prev);
  }
  if(img){
    img.onload=null;
    img.onerror=null;
  }
  const state={generation:++coverRetryGenerationSeq,failures:0,timer:0,queued:false,src:String(src||""),release:null,replaying:false};
  if(img){
    coverRetryStates.set(img,state);
    if(img.classList)img.classList.remove("is-cover-retrying");
    if(img.removeAttribute)img.removeAttribute("aria-busy");
  }
  return state;
}
function clearCoverRetry(img){
  const state=img?coverRetryStates.get(img):null;
  if(!state)return;
  if(state.timer){clearTimeout(state.timer);state.timer=0}
  state.queued=false;
  state.replaying=false;
  releaseCoverRetrySlot(state);
  if(img&&img.classList)img.classList.remove("is-cover-retrying");
  if(img&&img.removeAttribute)img.removeAttribute("aria-busy");
}
function markCoverUnavailable(img){
  if(!img||!img.parentNode)return;
  beginCoverAssignment(img,"");
  img.onload=null;
  img.onerror=null;
  const span=document.createElement("span");
  span.className="book-cover-unavailable";
  span.setAttribute("aria-hidden","true");
  img.replaceWith(span);
}
function handleCoverLoad(img){
  if(!img)return;
  const state=coverRetryStates.get(img);
  if(state&&state.replaying)return;
  clearCoverRetry(img);
}
function handleCoverError(img){
  if(!img)return;
  if(COVER_LAYOUT_TEST_MODE){
    img.onerror=null;
    img.src=FALLBACK_COVER;
    return;
  }
  const state=coverRetryStates.get(img);
  if(state&&state.replaying)return;
  const src=state&&state.src?state.src:approvedCoverSrc(img);
  if(!isRetryableCoverUrl(src)){
    markCoverUnavailable(img);
    return;
  }
  if(!state){
    beginCoverAssignment(img,src);
  }
  const current=coverRetryState(img);
  if(current.src!==src)return;
  if(current.timer||current.queued)return;
  current.failures=(current.failures||0)+1;
  if(current.failures>COVER_RETRY_MAX){
    markCoverUnavailable(img);
    return;
  }
  img.classList.add("is-cover-retrying");
  img.setAttribute("aria-busy","true");
  const generation=current.generation;
  const delay=COVER_RETRY_DELAYS[Math.min(current.failures-1,COVER_RETRY_DELAYS.length-1)];
  current.timer=setTimeout(()=>{
    current.timer=0;
    if(!isCoverJobCurrent(img,generation,src))return;
    enqueueCoverRetry(img,generation,src);
  },delay);
}
function enqueueCoverRetry(img,generation,src){
  const state=coverRetryStates.get(img);
  if(!state||state.generation!==generation||state.src!==src)return;
  if(state.queued)return;
  state.queued=true;
  coverRetryQueue.push({img,generation,src});
  pumpCoverRetryQueue();
}
function pumpCoverRetryQueue(){
  while(coverRetryInFlight<COVER_RETRY_CONCURRENCY&&coverRetryQueue.length){
    const job=coverRetryQueue.shift();
    if(!job)continue;
    const state=job.img?coverRetryStates.get(job.img):null;
    if(state&&state.generation===job.generation)state.queued=false;
    if(!isCoverJobCurrent(job.img,job.generation,job.src))continue;
    replayApprovedCover(job);
  }
}
function replayApprovedCover(job){
  const img=job&&job.img;
  const generation=job&&job.generation;
  const src=job&&job.src;
  if(!isCoverJobCurrent(img,generation,src)||!isRetryableCoverUrl(src)){
    if(img&&img.isConnected&&coverRetryStates.get(img)&&coverRetryStates.get(img).generation===generation)markCoverUnavailable(img);
    return;
  }
  const state=coverRetryState(img);
  let released=false;
  const release=()=>{
    if(released)return;
    released=true;
    if(state.release===release)state.release=null;
    coverRetryInFlight=Math.max(0,coverRetryInFlight-1);
    pumpCoverRetryQueue();
  };
  state.release=release;
  coverRetryInFlight++;
  img.onload=function(){
    release();
    if(!isCoverJobCurrent(img,generation,src))return;
    handleCoverLoad(img);
  };
  img.onerror=function(){
    release();
    if(!isCoverJobCurrent(img,generation,src))return;
    handleCoverError(img);
  };
  state.replaying=true;
  img.removeAttribute("src");
  try{void img.offsetWidth}catch(e){}
  img.src=src;
  state.replaying=false;
}
function assignCoverImage(img,src,opts={}){
  if(!img)return;
  const approved=isRetryableCoverUrl(src)?src:"";
  const state=beginCoverAssignment(img,approved);
  if(!approved){
    if(COVER_LAYOUT_TEST_MODE){img.src=FALLBACK_COVER;return}
    markCoverUnavailable(img);
    return;
  }
  img.setAttribute("data-cover-src",approved);
  const generation=state.generation;
  img.onload=()=>{if(!isCoverJobCurrent(img,generation,approved))return;handleCoverLoad(img)};
  img.onerror=()=>{if(!isCoverJobCurrent(img,generation,approved))return;handleCoverError(img)};
  if(opts.loading)img.loading=opts.loading;
  if(opts.fetchpriority)img.setAttribute("fetchpriority",opts.fetchpriority);
  state.replaying=true;
  img.src=approved;
  state.replaying=false;
}
function getCoverRetryDebug(){
  return {inFlight:coverRetryInFlight,queued:coverRetryQueue.length};
}
window.kutadguMarkCoverUnavailable=markCoverUnavailable;
window.kutadguHandleCoverError=handleCoverError;
window.kutadguHandleCoverLoad=handleCoverLoad;
function isDelegatedCoverImg(img){
  return !!(img&&img.tagName==="IMG"&&img.getAttribute&&img.getAttribute("data-cover-src"));
}
function coverPropertyHandlerSet(img,type){
  const handler=type==="error"?img.onerror:img.onload;
  return typeof handler==="function";
}
function onDelegatedCoverEvent(type,event){
  const img=event&&event.target;
  if(!isDelegatedCoverImg(img))return;
  if(coverPropertyHandlerSet(img,type))return;
  if(type==="error")handleCoverError(img);
  else handleCoverLoad(img);
}
function shouldUseHistoryBack(){
  if(typeof history==="undefined"||history.length<=1)return false;
  const ref=typeof document!=="undefined"?String(document.referrer||"").trim():"";
  if(!ref)return false;
  try{
    return new URL(ref).origin===location.origin;
  }catch(err){
    return false;
  }
}
function onHistoryBackClick(event){
  const link=event.target&&event.target.closest&&event.target.closest("a[data-kutadgu-history-back]");
  if(!link)return;
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  if(!shouldUseHistoryBack())return;
  event.preventDefault();
  history.back();
}
if(typeof document!=="undefined"&&document.documentElement&&document.documentElement.dataset.kutadguCspListeners!=="1"){
  document.documentElement.dataset.kutadguCspListeners="1";
  document.addEventListener("error",(event)=>onDelegatedCoverEvent("error",event),true);
  document.addEventListener("load",(event)=>onDelegatedCoverEvent("load",event),true);
  document.addEventListener("click",onHistoryBackClick);
}
function coverImgHtml(book,opts={}){
  const src=coverSrc(book);
  const alt=escapeAttr(`${book&&book.title||"كىتاب"} كىتاب مۇقاۋىسى`);
  const width=opts.width||320;
  const height=opts.height||460;
  const loading=opts.loading||"lazy";
  const prio=opts.fetchpriority?` fetchpriority="${escapeAttr(opts.fetchpriority)}"`:"";
  if(!src)return `<span class="book-cover-unavailable" aria-hidden="true"></span>`;
  return `<img src="${escapeAttr(src)}" alt="${alt}" width="${width}" height="${height}" loading="${loading}" decoding="async" data-cover-src="${escapeAttr(src)}"${prio}>`;
}
function listingCardSkeletonMarkup(){
  return `<article class="book-card is-skeleton" aria-hidden="true">
    <div class="book-image"><span class="listing-skel-cover" aria-hidden="true"></span></div>
    <div class="book-info">
      <div class="home-skel-line home-skel-line-title"></div>
      <div class="home-skel-line home-skel-line-meta"></div>
      <div class="home-skel-line listing-skel-price"></div>
    </div>
  </article>`;
}
function listingBootSkeletonMarkup(count=6){
  const n=Math.max(3,Math.min(12,Number(count)||6));
  return Array.from({length:n},listingCardSkeletonMarkup).join("");
}
function liveListingGrid(){
  return document.querySelector(".books-grid[data-catalog-source]");
}
function liveListingWaiting(){
  const grid=liveListingGrid();
  if(!grid)return false;
  return !grid.hasAttribute("data-catalog-ready");
}
function paintListingBootState(){
  const grid=liveListingGrid();
  if(!grid)return;
  grid.setAttribute("aria-busy","true");
  grid.removeAttribute("data-catalog-ready");
  const hasDemo=!!grid.querySelector(".book-card:not(.is-skeleton), img[src*='sample-book-cover']");
  const hasSkeleton=!!grid.querySelector(".book-card.is-skeleton");
  if(hasDemo||!hasSkeleton)grid.innerHTML=listingBootSkeletonMarkup(6);
}
function listingErrorMarkup(){
  return `<div class="catalog-error-state" role="alert"><p>كىتابلارنى يۈكلەشتە خاتالىق كۆرۈلدى. قايتا سىناڭ.</p><button type="button" class="catalog-retry-btn">قايتا سىناش</button></div>`;
}
function supabaseStorefrontConfigured(){
  const cfg=supabasePublicConfig();
  return !!(cfg.url&&cfg.key);
}
let catalogBootSettled=false;
function markCatalogBootSettled(){
  refreshCartDisplaySnapshotsFromCatalog();
  catalogBootSettled=true;
}
function isCartDocument(){
  return !!document.querySelector("#cartItems");
}
function cartWaitingForRemoteBooks(){
  if(!isCartDocument())return false;
  if(catalogBootSettled)return false;
  if(!supabaseStorefrontConfigured())return false;
  return cart().length>0;
}
function cartHydrationPending(){
  return cartWaitingForRemoteBooks();
}
function emptyCartDisplayStore(){
  return {v:CART_DISPLAY_VERSION,items:{}};
}
function clipCartDisplayText(raw,max){
  return String(raw??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,Math.max(1,Number(max)||1));
}
function sanitizeCartDisplaySnapshot(raw,fallbackId){
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;
  const id=clipCartDisplayText(raw.id||fallbackId,64);
  if(!id||/[<>"'`]/.test(id))return null;
  const title=clipCartDisplayText(raw.title,300);
  if(!title)return null;
  const author=clipCartDisplayText(raw.author,200);
  let price=raw.price;
  price=price===""||price==null?null:Number(price);
  if(!Number.isFinite(price)||price<0)price=null;
  let image=String(raw.image||"").trim();
  if(!image||isSampleDemoCover(image)||!isSafeCoverUrl(image))image="";
  let stock=raw.stock===""||raw.stock==null?null:Number(raw.stock);
  if(!Number.isFinite(stock)||stock<0)stock=null;
  const statusRaw=clipCartDisplayText(raw.stockStatus||raw.stock_status,32).toLowerCase();
  const allowed=new Set(["in","in_stock","available","low","low_stock","out","out_of_stock","soldout","sold-out"]);
  const stockStatus=allowed.has(statusRaw)?statusRaw:"";
  return {id,title,author,price,image,stock,stockStatus};
}
function readCartDisplayStore(){
  if(!shopOwnerAllowsLocalDisplay())return emptyCartDisplayStore();
  try{
    const raw=JSON.parse(localStorage.getItem(CART_DISPLAY_KEY)||"null");
    if(!raw||typeof raw!=="object"||Array.isArray(raw))return emptyCartDisplayStore();
    const items=raw.items&&typeof raw.items==="object"&&!Array.isArray(raw.items)?raw.items:{};
    const clean={};
    for(const [key,value] of Object.entries(items)){
      const snap=sanitizeCartDisplaySnapshot(value,key);
      if(snap)clean[snap.id]=snap;
    }
    return {v:CART_DISPLAY_VERSION,items:clean};
  }catch(e){return emptyCartDisplayStore()}
}
function writeCartDisplayStore(store){
  if(!shopOwnerAllowsLocalDisplay())return;
  try{
    const items=store&&store.items&&typeof store.items==="object"&&!Array.isArray(store.items)?store.items:{};
    const bounded={};
    const ids=Object.keys(items).slice(0,CART_DISPLAY_MAX_ITEMS);
    for(const id of ids){
      const snap=sanitizeCartDisplaySnapshot(items[id],id);
      if(snap)bounded[snap.id]=snap;
    }
    localStorage.setItem(CART_DISPLAY_KEY,JSON.stringify({v:CART_DISPLAY_VERSION,items:bounded}));
  }catch(e){}
}
function snapshotFromBook(book){
  if(!book||!book.id)return null;
  return sanitizeCartDisplaySnapshot({
    id:book.id,
    title:book.title,
    author:book.author,
    price:book.price,
    image:book.image||book.image_url||"",
    stock:book.stock,
    stockStatus:book.stockStatus||book.stock_status||""
  });
}
function cartDisplayBookFromSnapshot(snap){
  if(!snap)return null;
  return {
    id:snap.id,
    title:snap.title,
    author:snap.author||"",
    category:"",
    price:snap.price,
    image:snap.image||"",
    href:bookDetailHref(snap.id),
    stock:snap.stock,
    stockStatus:snap.stockStatus||"",
    isActive:true,
    __cartDisplayPreview:true
  };
}
function pruneCartDisplaySnapshots(store){
  const allowed=new Set(cart().map(item=>String(item.id)));
  const src=store||readCartDisplayStore();
  const next=emptyCartDisplayStore();
  for(const id of allowed){
    if(src.items[id])next.items[id]=src.items[id];
  }
  writeCartDisplayStore(next);
  return next;
}
function upsertCartDisplaySnapshot(book){
  const snap=snapshotFromBook(book);
  if(!snap)return;
  const store=readCartDisplayStore();
  store.items[snap.id]=snap;
  pruneCartDisplaySnapshots(store);
}
function refreshCartDisplaySnapshotsFromCatalog(){
  const store=readCartDisplayStore();
  const next=emptyCartDisplayStore();
  for(const item of cart()){
    const live=find(item.id);
    const snap=live?snapshotFromBook(live):store.items[String(item.id)];
    if(snap)next.items[String(snap.id)]=snap;
  }
  writeCartDisplayStore(next);
}
function migrateCartDisplaySnapshots(prevItems){
  const store=readCartDisplayStore();
  const next=emptyCartDisplayStore();
  const current=cart();
  for(const item of current){
    const id=String(item.id);
    let snap=store.items[id];
    if(!snap&&Array.isArray(prevItems)){
      const prev=prevItems.find(p=>String(resolveStoredBookId(p.id))===id||canonicalId(p.id)===canonicalId(id)||String(p.id)===id);
      if(prev)snap=store.items[String(prev.id)];
    }
    if(snap){
      const clean=sanitizeCartDisplaySnapshot({...snap,id},id);
      if(clean)next.items[id]=clean;
    }
  }
  writeCartDisplayStore(next);
}
function cartHasUsableDisplayPreview(){
  const items=cart();
  if(!items.length)return false;
  const store=readCartDisplayStore();
  return items.every(item=>{
    const snap=store.items[String(item.id)];
    return !!(snap&&snap.title&&snap.title!==String(item.id));
  });
}
function cartItemSkeletonMarkup(){
  return `<div class="cart-item is-skeleton" aria-hidden="true">
      <div class="cart-item-cover"><span class="cart-skel-cover"></span></div>
      <div class="cart-item-body">
        <div class="home-skel-line home-skel-line-title"></div>
        <div class="home-skel-line home-skel-line-meta"></div>
        <div class="cart-item-toolbar">
          <span class="home-skel-line cart-skel-chip"></span>
          <span class="home-skel-line cart-skel-chip"></span>
        </div>
      </div>
    </div>`;
}
function showCartBootSkeleton(count){
  const host=document.querySelector("#cartItems");
  if(!host)return;
  const n=Math.max(1,Math.min(8,Number(count)||1));
  host.innerHTML=Array.from({length:n},cartItemSkeletonMarkup).join("");
  host.setAttribute("aria-busy","true");
  const layout=document.querySelector("#cartLayout");
  if(layout)layout.setAttribute("data-empty","false");
  const aside=document.querySelector("#cartAside");
  if(aside)aside.hidden=true;
  const checkout=document.querySelector("#checkoutCard");
  if(checkout)checkout.hidden=true;
  const summaryHost=document.querySelector("#cartSummaryHost");
  if(summaryHost)summaryHost.innerHTML="";
}
function paintCartBootState(){
  if(!isCartDocument())return;
  if(cartWaitingForRemoteBooks()){
    if(cartHasUsableDisplayPreview())cartPage();
    else showCartBootSkeleton(cart().length);
    updateBadge();
    return;
  }
  cartPage();
}
function homepageVisibleBooks(result){
  const items=(result&&result.items||[]).filter(isStorefrontVisible);
  if(remoteCatalog.configured&&result&&result.source==="static"){
    return items.filter(book=>!isSampleDemoCover(book.image));
  }
  return items;
}
function homeCarouselSkeletonMarkup(count=4){
  const n=Math.max(1,Number(count)||4);
  return Array.from({length:n},()=>`<article class="home-carousel-card is-skeleton" aria-hidden="true">
      <div class="home-carousel-cover"><span class="home-skel-cover"></span></div>
      <div class="home-carousel-info">
        <div class="home-skel-line home-skel-line-title"></div>
        <div class="home-skel-line home-skel-line-meta"></div>
      </div>
    </article>`).join("");
}
function homeFeatureCardSkeletonMarkup(){
  return `<article class="home-feature-card is-skeleton" aria-hidden="true">
      <div class="home-feature-cover"><span class="home-skel-cover"></span></div>
      <div class="home-feature-info">
        <div class="home-skel-line home-skel-line-title"></div>
        <div class="home-skel-line home-skel-line-meta"></div>
      </div>
    </article>`;
}
function homeFeaturedSkeletonTrack(count){
  return `<div class="home-featured-row"><div class="home-featured-track">${Array.from({length:count},homeFeatureCardSkeletonMarkup).join("")}</div></div>`;
}
function readShopOwner(){
  try{return String(localStorage.getItem(SHOP_OWNER_KEY)||"").trim()}catch(e){return ""}
}
function writeShopOwner(owner){
  try{
    if(owner)localStorage.setItem(SHOP_OWNER_KEY,owner);
    else localStorage.removeItem(SHOP_OWNER_KEY);
  }catch(e){}
}
function stampShopOwner(){
  const uid=window.KutadguMember?.getUser?.()?.id;
  if(uid){writeShopOwner(String(uid));return}
  const current=readShopOwner();
  if(current&&current!==SHOP_OWNER_GUEST&&current!==SHOP_OWNER_STALE)return;
  if(typeof console!=="undefined"&&isPreviewShopDebug()){
    console.info("[kutadgu-shop-debug]",{event:"stamp-owner",from:current||"(empty)",to:"guest",hadUser:false});
  }
  writeShopOwner(SHOP_OWNER_GUEST);
}
function shopOwnerAllowsLocalDisplay(){
  const owner=readShopOwner();
  if(!owner||owner===SHOP_OWNER_GUEST)return true;
  if(owner===SHOP_OWNER_STALE)return false;
  const uid=window.KutadguMember?.getUser?.()?.id;
  if(!uid)return false;
  return String(uid)===owner;
}
const get=(k,d=[])=>{try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}};
const set=(k,v)=>{
  try{
    localStorage.setItem(k,JSON.stringify(v));
    if(k===CART_KEY||k===FAV_KEY)stampShopOwner();
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
function bookDetailHref(id, fallbackHref){
  const Seo=window.KutadguBookSeo||{};
  const raw=String(id||"").trim();
  if(Seo.bookPath){
    const path=Seo.bookPath(raw);
    if(path)return path;
  }
  if(/^\d+$/.test(raw))return `/book/${raw}`;
  const fallback=String(fallbackHref||"").trim();
  if(fallback)return fallback;
  return raw?`book.html?id=${encodeURIComponent(raw)}`:"/book.html";
}
function storefrontAssetPath(src){
  const value=String(src||"").trim();
  if(!value||value==="#")return value;
  if(/^(javascript|data|vbscript|file|blob):/i.test(value))return "";
  if(/^(https?:)?\/\//i.test(value)||value.startsWith("/"))return value;
  return "/"+value.replace(/^\.\//,"");
}
const STOREFRONT_CATEGORY_HUBS={
  "adabiyat.html":"/adabiyat",
  "adabiyat-roman.html":"/adabiyat-roman",
  "children.html":"/children",
  "dastanlar.html":"/dastanlar",
  "derslik.html":"/derslik",
  "dini.html":"/dini",
  "dunya-edebiyati.html":"/dunya-edebiyati",
  "hekayiler.html":"/hekayiler",
  "romanlar.html":"/romanlar",
  "sheirlar.html":"/sheirlar",
  "tarikhiy-romanlar.html":"/tarikhiy-romanlar",
  "terbiye.html":"/terbiye",
  "tibb.html":"/tibb",
  "universal.html":"/universal",
  "uyghur-adabiyati.html":"/uyghur-adabiyati"
};
const STOREFRONT_APP_PAGES={
  "account.html":"/account.html",
  "cart.html":"/cart.html",
  "favorites.html":"/favorites.html",
  "index.html":"/",
  "my-books.html":"/my-books.html",
  "order-info.html":"/order-info.html",
  "privacy.html":"/privacy.html",
  "returns.html":"/returns.html"
};
function storefrontKnownPageParts(raw){
  const t=String(raw||"").trim();
  if(!t||/^(?:javascript|data|vbscript|file|blob)\s*:/i.test(t)||t.startsWith("//")||/[<>"'`]/.test(t))return null;
  let path=t;
  let hash="";
  const hashAt=t.indexOf("#");
  if(hashAt>=0){hash=t.slice(hashAt);path=t.slice(0,hashAt)}
  path=path.split("?")[0].replace(/^\.\//,"");
  if(/^https?:\/\//i.test(path)){
    try{
      const url=new URL(path);
      if(typeof location==="undefined"||url.origin!==location.origin)return null;
      path=url.pathname||"/";
    }catch(e){return null}
  }
  const file=String(path.split("/").pop()||"").toLowerCase();
  return {file,hash,path};
}
function storefrontCategoryHref(source){
  const parts=storefrontKnownPageParts(source);
  if(!parts||!parts.file)return "/#books";
  if(STOREFRONT_CATEGORY_HUBS[parts.file])return STOREFRONT_CATEGORY_HUBS[parts.file]+parts.hash;
  const numbered=parts.file.match(/^([a-z0-9-]+)-\d+\.html$/);
  if(numbered&&STOREFRONT_CATEGORY_HUBS[numbered[1]+".html"])return STOREFRONT_CATEGORY_HUBS[numbered[1]+".html"]+parts.hash;
  return "/#books";
}
function storefrontAppHref(page,fallback="/"){
  const parts=storefrontKnownPageParts(page);
  if(!parts||!parts.file)return fallback;
  if(parts.file==="index.html"&&parts.hash==="#books")return "/#books";
  const dest=STOREFRONT_APP_PAGES[parts.file];
  if(!dest)return fallback;
  if(dest==="/")return "/"+parts.hash;
  return dest+parts.hash;
}
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
  const Seo=window.KutadguBookSeo||{};
  if(Seo.isBookDetailPath&&Seo.isBookDetailPath(location.pathname))return true;
  if(storefrontPageFile()==="book.html")return true;
  return !!document.querySelector(".book-detail-page,.book-detail-info");
}
function maybeRedirectLegacyBookUrl(){
  const Seo=window.KutadguBookSeo||{};
  const next=Seo.legacyBookRedirectPath?Seo.legacyBookRedirectPath(location):"";
  if(!next)return false;
  location.replace(next+(location.hash||""));
  return true;
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
      if(remoteCatalog.configured){
        catalogStatus={...catalogStatus,source:"error",error:String(error?.message||error)};
        window.KUTADGU_CATALOG_STATUS=catalogStatus;
        throw error;
      }
      console.error("Supabase catalog query failed; static fallback is being used.",error);
      restoreStaticVisibleCatalog();
      catalogStatus={...catalogStatus,source:"static",error:String(error?.message||error)};
      window.KUTADGU_CATALOG_STATUS=catalogStatus;
    }
  }
  if(remoteCatalog.configured){
    throw new Error(catalogStatus.error||"كىتابلارنى يۈكلەشتە خاتالىق كۆرۈلدى.");
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
    remoteCatalog.available=true;
    remoteCatalog.total=Number.isFinite(total)?total:null;
    beginRemoteVisibleCatalog();
    rebuildVisibleCatalog();
    if(Number(total)>0)await loadInactiveRemoteIndex();
    catalogStatus={source:"supabase",remoteCount:C.length,total:Number.isFinite(total)?total:0,migrated:true,error:""};
    window.KUTADGU_CATALOG_STATUS=catalogStatus;
  }catch(err){
    console.warn("Remote catalog load failed.",err);
    remoteCatalog.available=false;
    if(!remoteCatalog.configured){
      restoreStaticVisibleCatalog();
      catalogStatus={source:"static",remoteCount:0,total:C.length,migrated:false,error:String(err?.message||err)};
    }else{
      catalogStatus={source:"error",remoteCount:0,total:0,migrated:false,error:String(err?.message||err)};
    }
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
  const Seo=window.KutadguBookSeo||{};
  const id=(Seo.parseBookIdFromLocation?Seo.parseBookIdFromLocation(location):"")||new URLSearchParams(location.search).get("id")||document.body.dataset.bookId;
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
  if(!shopOwnerAllowsLocalDisplay())return;
  const resolve=resolveStoredBookId;
  const aliases=aliasMap();
  const prevCart=cart();
  const nextCart=Legacy.repairCapPollutedCartItems
    ?Legacy.repairCapPollutedCartItems(prevCart,resolve,aliases)
    :(Legacy.migrateCartItems?Legacy.migrateCartItems(prevCart,resolve):prevCart);
  const nextFav=Legacy.migrateIdList?Legacy.migrateIdList(favs(),resolve):favs().map(String);
  const nextRec=Legacy.migrateIdList?Legacy.migrateIdList(get(REC_KEY,[]),resolve,{limit:12}):get(REC_KEY,[]).map(String).slice(0,12);
  if(JSON.stringify(nextCart)!==JSON.stringify(prevCart)){
    set(CART_KEY,nextCart);
    migrateCartDisplaySnapshots(prevCart);
  }else pruneCartDisplaySnapshots();
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
  if(!shopOwnerAllowsLocalDisplay())return [];
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
  const preview=cartDisplayBookFromSnapshot(readCartDisplayStore().items[String(line?.id||"")]);
  if(preview)return preview;
  const id=String(line?.id||"");
  return {
    id,
    title:id,
    author:"",
    category:"",
    price:null,
    image:"",
    href:bookDetailHref(id),
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
  if(set(CART_KEY,a)){
    upsertCartDisplaySnapshot(b);
    updateBadge();
    toast("كىتاب سېۋەتكە قوشۇلدى 🛒");
    trackEvent("add_to_cart",{bookId:storeId,legacyId:b.legacyId||"",qty:Math.max(1,Number(qty)||1)});
  }
}
function remove(id){
  const resolve=resolveStoredBookId;
  const aliases=aliasMap();
  const next=Legacy.filterCartRemovingBook
    ?Legacy.filterCartRemovingBook(cart(),id,resolve,aliases)
    :cart().filter(x=>canonicalId(x.id)!==canonicalId(id));
  set(CART_KEY,next);
  pruneCartDisplaySnapshots();
  updateBadge();
}
function favs(){return shopOwnerAllowsLocalDisplay()?get(FAV_KEY,[]):[]}
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
  const add=(file,label)=>{
    const href=storefrontAppHref(file,"/"+file);
    let link=scoped(`a[href="${file}"], a[href="${href}"]`);
    if(!link){
      link=document.createElement("a");
      link.textContent=label;
      if(!headerNav)link.dataset.kutadguDesktopShop="1";
      host.appendChild(link);
    }
    link.setAttribute("href",href);
    if(file==="cart.html")ensureCartCount(link);
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
    d.innerHTML=`<button type="button" class="shop-float-btn" data-kutadgu-nav="cart.html">🛒 سېۋەت <span class="cart-count">0</span></button><button type="button" class="shop-float-btn" data-kutadgu-nav="favorites.html">❤️ ياقتۇرغانلىرىم</button>`;
    d.querySelectorAll("[data-kutadgu-nav]").forEach(btn=>{
      btn.addEventListener("click",()=>{
        const href=storefrontAppHref(String(btn.getAttribute("data-kutadgu-nav")||"").trim(),"");
        if(href)location.assign(href);
      });
    });
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
      const parts=url.pathname.replace(/\/+$/,"").split("/").filter(Boolean);
      if(parts.length>=2&&parts[parts.length-2]==="book")add(parts[parts.length-1]);
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
    if(card.classList.contains("is-skeleton"))return;
    if(liveListingWaiting()&&card.closest("[data-catalog-source]"))return;
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
    if(img){
      img.loading="lazy";img.decoding="async";
      if(!img.getAttribute("width"))img.setAttribute("width","320");
      if(!img.getAttribute("height"))img.setAttribute("height","460");
      const src=coverSrc(book);
      img.alt=`${book.title||"كىتاب"} كىتاب مۇقاۋىسى`;
      if(!src)markCoverUnavailable(img);
      else assignCoverImage(img,src);
    }
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
  scope.querySelectorAll(".book-card:not(.is-skeleton) .book-cover, .book-card:not(.is-skeleton) .book-image").forEach(cover=>{
    let img=cover.matches("img")?cover:cover.querySelector("img");
    if(!img){
      if(!COVER_LAYOUT_TEST_MODE)return;
      img=document.createElement("img");
      const title=cover.closest(".book-card")?.querySelector(".book-title")?.textContent.trim()||"كىتاب";
      img.alt=`${title} كىتاب مۇقاۋىسى`;
      img.loading="lazy";
      cover.querySelectorAll(".dynamic-cover-placeholder,.cover-placeholder").forEach(el=>el.remove());
      cover.prepend(img);
    }
    img.onerror=function(){handleCoverError(this)};
    img.onload=function(){handleCoverLoad(this)};
    img.loading="lazy";
    img.decoding="async";
    if(!img.getAttribute("width"))img.setAttribute("width","320");
    if(!img.getAttribute("height"))img.setAttribute("height","460");
    const src=(img.getAttribute("src")||"").trim();
    if(COVER_LAYOUT_TEST_MODE&&(!src||src==="#"))img.src=coverSrc(null);
    else if(!src||src==="#"||isSampleDemoCover(src)||!isRetryableCoverUrl(src)){
      markCoverUnavailable(img);
    }else{
      img.setAttribute("data-cover-src",src);
    }
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
  if(COVER_LAYOUT_TEST_MODE){img.src=coverSrc(book);return}
  const src=coverSrc(book);
  if(!src||isSampleDemoCover(current)||!current||current==="#"){
    if(!src){markCoverUnavailable(img);return}
    assignCoverImage(img,src,{loading:"eager",fetchpriority:"high"});
    return;
  }
  assignCoverImage(img,src,{loading:"eager"});
}
function decorateCards(){
  document.querySelectorAll(".book-card").forEach(card=>{
    if(card.classList.contains("is-skeleton"))return;
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
  const Seo=window.KutadguBookSeo||{};
  let id=document.body.dataset.bookId;
  let b=find(id); if(b)return b;
  let queryId=Seo.parseBookIdFromLocation?Seo.parseBookIdFromLocation(location):new URLSearchParams(location.search).get("id");
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
  const lib=bibliographicLib();
  if(lib.detailMetaVisible){
    if(!lib.detailMetaVisible(value))return "";
  }else if(value===null||value===undefined||String(value).trim()==="")return "";
  const shown=String(value).trim();
  if(/^(undefined|null|unknown)$/i.test(shown))return "";
  return `<div class="book-meta-row"><div class="book-meta-label">${escapeHtml(label)}</div><div class="book-meta-value">${escapeHtml(shown)}</div></div>`;
}

function setHeadMeta(selector,attributes){
  let node=document.head.querySelector(selector);
  if(!node){node=document.createElement(attributes.tag||"meta");document.head.appendChild(node)}
  Object.entries(attributes).forEach(([key,value])=>{if(key!=="tag")node.setAttribute(key,value)});
  return node;
}

function siteOrigin(){
  if(window.KutadguBookSeo&&window.KutadguBookSeo.productionOrigin)return window.KutadguBookSeo.productionOrigin();
  return "https://www.kutadgubilik.com";
}

function absoluteUrl(value){
  try{return new URL(value||"/",siteOrigin()+"/").href}catch(e){return siteOrigin()+"/"}
}

/* Detail SEO is generated only from known book data; missing facts stay omitted. */
function updateBookSeo(book){
  if(!book||!isBookDetailDocument())return;
  const Seo=window.KutadguBookSeo||{};
  const origin=siteOrigin();
  const canonical=Seo.bookCanonicalUrl?Seo.bookCanonicalUrl(book.id,origin):`${origin}${bookDetailHref(book.id)}`;
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
    img.alt=`${b.title} كىتاب مۇقاۋىسى`;
    img.hidden=false;
    img.parentElement.classList.remove("no-cover");
    const src=coverSrc(b);
    if(!src)markCoverUnavailable(img);
    else assignCoverImage(img,src,{loading:"eager",fetchpriority:"high"});
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
      setDynamicMeta("تەرجىمە قىلغۇچى",b.translator),
      setDynamicMeta("نەشرىيات",b.publisher),
      setDynamicMeta("نەشر يىلى",b.publishYear),
      setDynamicMeta("ISBN",storefrontIsbn(b)),
      setDynamicMeta("بەت سانى",b.pages),
      setDynamicMeta("مۇقاۋا تۈرى",bibliographicLib().coverTypeLabel?bibliographicLib().coverTypeLabel(b.coverType):b.coverType),
      setDynamicMeta("كىتاب ئۆلچىمى",bibliographicLib().bookSizeLabel?bibliographicLib().bookSizeLabel(b.bookSize):b.bookSize),
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

const DETAIL_RELATED_LIMIT=4;
const DETAIL_RELATED_PAGE_SIZE=16;
let detailRelatedFetch={key:"",token:0,status:""};

function detailRelatedIdentity(book){
  return canonicalId(book&&book.id)+"|"+String(book&&book.category||"").trim();
}
function detailRelatedQueryInput(book){
  return {category:String(book&&book.category||"").trim(),pageSize:DETAIL_RELATED_PAGE_SIZE,offset:0,sort:"new"};
}
function detailRelatedShouldQuery(book,knownCount,state,recsEnabled){
  if(recsEnabled===false)return false;
  if(!book||!String(book.category||"").trim())return false;
  if((Number(knownCount)||0)>=DETAIL_RELATED_LIMIT)return false;
  const key=detailRelatedIdentity(book);
  if(state&&state.key===key&&(state.status==="loading"||state.status==="ready"))return false;
  return true;
}
function detailRecommendations(book,limit=DETAIL_RELATED_LIMIT,catalog){
  const max=Math.max(0,Number(limit)||0);
  if(!book||!max)return [];
  const category=String(book.category||"").trim();
  if(!category)return [];
  const self=canonicalId(book.id);
  const pool=(Array.isArray(catalog)?catalog:C).filter(item=>{
    if(!item||!isStorefrontVisible(item))return false;
    if(canonicalId(item.id)===self)return false;
    return String(item.category||"").trim()===category;
  });
  const subcategory=String(book.subcategory||"").trim();
  if(subcategory){
    const sameSub=pool.filter(item=>String(item.subcategory||"").trim()===subcategory);
    const rest=pool.filter(item=>String(item.subcategory||"").trim()!==subcategory);
    return [...sameSub,...rest].slice(0,max);
  }
  return pool.slice(0,max);
}

function detailGallerySlides(book){
  const main=coverSrc(book);
  const extras=normalizeGalleryImages(book?.galleryImages||[],book?.image||"")
    .map(src=>safeCoverUrl(src,{fallback:"",fallbackOnInvalid:false}))
    .filter(Boolean);
  return [main,...extras].filter(src=>src&&isSafeCoverUrl(src)&&!isSampleDemoCover(src));
}

function setDetailHeroImage(src,alt){
  const img=document.querySelector(".book-cover-box img");
  if(!img)return;
  const safe=isSafeCoverUrl(src)&&!isSampleDemoCover(src)?src:"";
  img.alt=alt||img.alt||"";
  img.hidden=false;
  img.style.visibility="visible";
  if(!safe){if(COVER_LAYOUT_TEST_MODE){img.src=FALLBACK_COVER;return}markCoverUnavailable(img);return}
  assignCoverImage(img,safe);
}

function openCoverLightbox(slides,startIndex,alt){
  const list=(slides||[]).map(src=>isSafeCoverUrl(src)?src:"").filter(Boolean);
  if(!list.length)return;
  let index=Math.max(0,Math.min(startIndex||0,list.length-1));
  const overlay=document.createElement("div");
  overlay.className="cover-zoom-overlay";
  overlay.setAttribute("role","dialog");
  overlay.setAttribute("aria-modal","true");
  overlay.setAttribute("aria-label","كىتاب رەسىمىنى چوڭ كۆرۈش");
  const closeBtn=document.createElement("button");
  closeBtn.type="button";
  closeBtn.className="cover-zoom-close";
  closeBtn.setAttribute("aria-label","تاقاش");
  closeBtn.textContent="✕";
  overlay.appendChild(closeBtn);
  let prevBtn=null,nextBtn=null,count=null;
  if(list.length>1){
    prevBtn=document.createElement("button");
    prevBtn.type="button";
    prevBtn.className="cover-zoom-prev";
    prevBtn.setAttribute("aria-label","ئالدىنقى رەسىم");
    prevBtn.textContent="›";
    nextBtn=document.createElement("button");
    nextBtn.type="button";
    nextBtn.className="cover-zoom-next";
    nextBtn.setAttribute("aria-label","كېيىنكى رەسىم");
    nextBtn.textContent="‹";
    count=document.createElement("div");
    count.className="cover-zoom-count";
    overlay.appendChild(prevBtn);
    overlay.appendChild(nextBtn);
    overlay.appendChild(count);
  }
  const picture=document.createElement("img");
  picture.alt=String(alt||"");
  overlay.appendChild(picture);
  document.body.appendChild(overlay);
  const show=()=>{
    const url=list[index];
    if(!url||!isSafeCoverUrl(url)||isSampleDemoCover(url))return;
    assignCoverImage(picture,url);
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
  closeBtn.onclick=close;
  prevBtn?.addEventListener("click",e=>{e.stopPropagation();step(-1)});
  nextBtn?.addEventListener("click",e=>{e.stopPropagation();step(1)});
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
  strip.innerHTML=slides.map((src,index)=>{
    if(!isSafeCoverUrl(src)||isSampleDemoCover(src))return "";
    return `<button type="button" class="book-gallery-thumb${index===0?" is-active":""}" role="listitem" data-gallery-index="${index}" aria-label="${index===0?"ئاساسىي مۇقاۋا":"قوشۇمچە رەسىم "+index}">
      <img src="${escapeAttr(src)}" alt="" data-cover-src="${escapeAttr(src)}" ${index===0?"":'loading="lazy"'} decoding="async">
    </button>`;
  }).filter(Boolean).join("");
  col.appendChild(strip);
  strip.querySelectorAll(".book-gallery-thumb").forEach(btn=>{
    btn.onclick=()=>{
      const index=Number(btn.dataset.galleryIndex)||0;
      setDetailHeroImage(slides[index],`${book.title||"كىتاب"} ${index===0?"كىتاب مۇقاۋىسى":"رەسىم "+(index+1)}`);
      strip.querySelectorAll(".book-gallery-thumb").forEach(el=>el.classList.toggle("is-active",el===btn));
    };
  });
}

function detailRelatedMarkup(book,related){
  if(!featureEnabled("recommendations"))return "";
  const categoryCta=`<a href="${escapeAttr(storefrontCategoryHref(book.source))}" class="detail-section-link">بۇ بۆلۈمدىكى كىتابلار →</a>`;
  if(related&&related.length){
    return `<section class="detail-extra-section" data-detail-related="1">
         <div class="detail-section-heading">
           <div>
             <span class="detail-section-kicker">📚 يەنە كۆرۈپ بېقىڭ</span>
             <h2>ئوخشاش كىتابلار</h2>
           </div>
           ${categoryCta}
         </div>
         <div class="shop-grid detail-related-grid">${related.map(miniCard).join("")}</div>
       </section>`;
  }
  return `<section class="detail-extra-section detail-category-cta-only" data-detail-related="1">
         <div class="detail-section-heading">${categoryCta}</div>
       </section>`;
}
function paintDetailRelated(book,related){
  if(!featureEnabled("recommendations"))return;
  const main=document.querySelector(".book-detail-page");
  if(!main)return;
  let wrap=main.querySelector(".detail-extra-sections");
  const html=detailRelatedMarkup(book,related||[]);
  if(!wrap){
    wrap=document.createElement("div");
    wrap.className="detail-extra-sections";
    main.appendChild(wrap);
  }
  const existing=wrap.querySelector("[data-detail-related]");
  if(existing){
    const tmp=document.createElement("div");
    tmp.innerHTML=html;
    const next=tmp.firstElementChild;
    if(next)existing.replaceWith(next);
    else existing.remove();
  }else if(html)wrap.insertAdjacentHTML("afterbegin",html);
  const painted=wrap.querySelector("[data-detail-related]");
  if(painted)bindDynamicActions(painted);
  if(!wrap.innerHTML.trim())wrap.remove();
}
function scheduleDetailRelated(book){
  if(!featureEnabled("recommendations")||!book)return;
  const known=detailRecommendations(book,DETAIL_RELATED_LIMIT);
  paintDetailRelated(book,known);
  if(!detailRelatedShouldQuery(book,known.length,detailRelatedFetch,true)){
    if(known.length>=DETAIL_RELATED_LIMIT)detailRelatedFetch={key:detailRelatedIdentity(book),token:detailRelatedFetch.token,status:"ready"};
    return;
  }
  const key=detailRelatedIdentity(book);
  const token=++detailRelatedFetch.token;
  detailRelatedFetch={key,token,status:"loading"};
  Promise.resolve(queryCatalog(detailRelatedQueryInput(book))).then(()=>{
    if(token!==detailRelatedFetch.token)return;
    const live=getDetailBook();
    if(live&&detailRelatedIdentity(live)!==key)return;
    detailRelatedFetch={key,token,status:"ready"};
    paintDetailRelated(book,detailRecommendations(book,DETAIL_RELATED_LIMIT));
  }).catch(()=>{
    if(token!==detailRelatedFetch.token)return;
    detailRelatedFetch={key,token,status:"error"};
    paintDetailRelated(book,detailRecommendations(book,DETAIL_RELATED_LIMIT));
  });
}
function renderDetailExtras(book){
  let main=document.querySelector(".book-detail-page");
  if(!main)return;
  if(!main.querySelector(".detail-extra-sections")){
    let recentBooks=get(REC_KEY,[])
      .filter(id=>canonicalId(id)!==canonicalId(book.id))
      .map(find)
      .filter(item=>item&&isStorefrontVisible(item))
      .slice(0,4);
    let wrap=document.createElement("div");
    wrap.className="detail-extra-sections";
    const relatedHtml=detailRelatedMarkup(book,detailRecommendations(book,DETAIL_RELATED_LIMIT));
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
  scheduleDetailRelated(book);
}

function decorateDetail(){
  if(maybeRedirectLegacyBookUrl())return;
  if(isStorefrontHomepage()){
    applyHomepageDocumentTitle();
    return;
  }
  if(!isBookDetailDocument())return;
  let b=getDetailBook();
  if(!b){
    const Seo=window.KutadguBookSeo||{};
    if(Seo.applyUnresolvedDetailDocument)Seo.applyUnresolvedDetailDocument(document);
    else{
      setHeadMeta('meta[name="robots"]',{name:"robots",content:"noindex, follow"});
      setHeadMeta('link[rel="canonical"]',{tag:"link",rel:"canonical",href:siteOrigin()+"/book.html"});
      document.head.querySelector("#kutadguBookSchema")?.remove();
    }
    return;
  }
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
  return coverImgHtml(b,{width:320,height:460});
}

function miniCard(b){
  const id=escapeAttr(b.id),href=escapeAttr(safeHref(b.href)),title=escapeHtml(b.title),author=escapeHtml(b.author);
  return `<article class="shop-mini-card"><button type="button" class="mini-heart" data-fav-id="${id}">♡</button><a href="${href}">${miniCover(b)}<div class="shop-mini-title">${title}</div><div class="shop-mini-meta">${author}</div><div class="mini-card-status">${stockBadge(b)}</div><div class="shop-mini-price">${money(b.price)}</div></a><div class="mini-actions">${cartButton(b)}<button type="button" class="share-button" data-share-id="${id}">🔗</button></div></article>`;
}

function favoriteCard(b){
  const id=escapeAttr(b.id),href=escapeAttr(safeHref(b.href)),title=escapeHtml(b.title),author=escapeHtml(b.author||"—");
  if(!isStorefrontVisible(b)){
    return `<article class="favorite-card favorite-card-unavailable">
    <a class="favorite-cover" href="${href}">${miniCover(b)}</a>
    <div class="favorite-card-info">
      <a class="favorite-card-title" href="${href}">${title}</a>
      <div class="favorite-card-author">${author}</div>
      <div class="favorite-card-row"><span class="stock-badge stock-out">ھازىرچە تەمىنلەنمەيدۇ</span></div>
      <div class="favorite-card-actions">
        <button type="button" class="favorite-remove" data-remove-favorite="${id}">ياقتۇرغانلاردىن چىقىرىش</button>
      </div>
    </div>
  </article>`;
  }
  return `<article class="favorite-card">
    <a class="favorite-cover" href="${href}">${miniCover(b)}</a>
    <div class="favorite-card-info">
      <a class="favorite-card-title" href="${href}">${title}</a>
      <div class="favorite-card-author">${author}</div>
      <div class="favorite-card-row"><strong>${money(b.price)}</strong>${stockBadge(b)}</div>
      <div class="favorite-card-actions">
        ${cartButton(b)}
        <button type="button" class="favorite-remove" data-remove-favorite="${id}">ياقتۇرغانلاردىن چىقىرىش</button>
      </div>
    </div>
  </article>`;
}

function renderFavoritesPage(){
  const host=document.querySelector("#favoritesList");if(!host)return;
  const books=favs().map(id=>find(id)).filter(Boolean);
  host.innerHTML=books.length
    ? `<div class="favorites-grid">${books.map(favoriteCard).join("")}</div>`
    : `<div class="empty-state favorites-empty"><span>♡</span><h2>ھازىرچە ياقتۇرغان كىتاب يوق</h2><p>كىتاب كارتىسىدىكى يۈرەك بەلگىسىنى بېسىپ بۇ يەرگە ساقلىيالايسىز. مېھمان بولسىڭىز شۇ ئۈسكۈنىدە ساقلىنىدۇ؛ ھېسابقا كىرسىڭىز ھېسابىڭىزغا ماسلىشىدۇ.</p><a class="empty-state-button" href="index.html#books">كىتابلارنى كۆرۈش</a></div>`;
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


function homeFeatureCard(b){
  const id=escapeAttr(b.id),href=escapeAttr(safeHref(b.href)),title=escapeHtml(b.title),author=escapeHtml(b.author||"—");
  return `<article class="home-feature-card">
      <button type="button" class="home-feature-heart favorite-button mini-heart" data-fav-id="${id}" aria-label="ياقتۇرۇش" aria-pressed="false">♡</button>
      <a href="${href}">
        <div class="home-feature-cover">
          <div class="home-feature-cover-frame">
            ${coverImgHtml(b,{width:320,height:460})}
          </div>
        </div>
        <div class="home-feature-info">
          <div class="home-feature-title">${title}</div>
          <div class="home-feature-author">${author}</div>
          <div class="home-feature-bottom">
            <span class="home-feature-price">${money(b.price)}</span>
            ${cartButton(b,"🛒","add-to-cart home-feature-cart")}
          </div>
        </div>
      </a>
    </article>`;
}

let homeFeaturedRequestId=0;
async function renderHomeFeaturedBooks(){
  const host=document.querySelector("#homeFeaturedBooks");
  if(!host)return;
  if(!featureEnabled("newArrivals")){host.hidden=true;return}

  if(!host.querySelector("[data-home-featured-shell]")){
    host.innerHTML=`<section class="home-featured-section" data-home-featured-shell="1">
    <div class="home-featured-head">
      <div>
        <h3>🕘 يېقىندا قوشۇلغانلار</h3>
        <p>باش بەتتىنلا كىتابلارنى كۆرۈپ تاللاڭ.</p>
      </div>
      <a class="home-featured-all" href="#books">ھەممىسىنى كۆرۈش ←</a>
    </div>
    <div class="home-featured-grid is-skeleton-grid" aria-busy="true">${homeFeaturedSkeletonTrack(5)}${homeFeaturedSkeletonTrack(5)}</div>
  </section>`;
  }
  const token=++homeFeaturedRequestId;
  try{
    // This standalone section is independent from the Admin-controlled is_new tab.
    // Only the latest twenty rows are requested; remoteOrder("new") maps to created_at DESC.
    const result=await queryCatalog({offset:0,pageSize:20,sort:"new"});
    if(token!==homeFeaturedRequestId)return;
    const books=homepageVisibleBooks(result);
    const grid=host.querySelector(".home-featured-grid");
    if(grid){
      if(!books.length){
        grid.classList.remove("is-marquee","is-skeleton-grid");
        grid.removeAttribute("aria-busy");
        grid.innerHTML='<div class="empty-state shop-section-empty">كىتابلار تېخى قوشۇلمىغان.</div>';
      }else{
        const split=splitFeaturedRows(books);
        const rowMarkup=(items,which)=>`<div class="home-featured-row" data-featured-row="${which}" data-direction="${featuredRowDirection(which)}"><div class="home-featured-track">${items.map(homeFeatureCard).join("")}</div></div>`;
        grid.classList.add("is-marquee");
        grid.classList.remove("is-skeleton-grid");
        grid.removeAttribute("aria-busy");
        grid.innerHTML=`${rowMarkup(split.top,"top")}${split.bottom.length?rowMarkup(split.bottom,"bottom"):""}`;
        grid.classList.add("home-catalog-fade");
      }
    }
    bindDynamicActions(host);
    setupHomeFeaturedMarquee(host);
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
function bookCardMarkup(b,variant="listing",coverOpts={}){
  const id=escapeAttr(b.id),href=escapeAttr(safeHref(b.href)),title=escapeHtml(b.title),authorName=storefrontAuthor(b),author=escapeHtml(authorName),category=escapeHtml(b.category||"");
  const authorBlock=authorName?`<div class="${variant==="search"?"advanced-search-meta":"book-author"}">${variant==="search"?`ئاپتورى: ${author}`:`ئاپتورى: ${author}`}</div>`:(variant==="search"?"":`<p class="book-author" hidden></p>`);
  if(variant==="search")return `<article class="advanced-search-result" data-live-book-id="${id}">
    <a class="advanced-search-cover" href="${href}">${coverImgHtml(b)}</a>
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
      ${coverImgHtml(b,coverOpts)}
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
        <select id="searchCategory"><option value="">بارلىق تۈرلەر</option>${uniqueCategories().map(x=>`<option value="${escapeAttr(x)}">${escapeHtml(x)}</option>`).join("")}</select>
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
  const fallbackNotice=()=>(!remoteCatalog.configured&&catalogStatus.error)?'<div class="catalog-data-notice">تور سانلىق مەلۇماتى ۋاقىتلىق يۈكلەنمىدى؛ ساقلانغان كىتاب تىزىملىكى كۆرسىتىلدى.</div>':"";
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
      res.innerHTML=fallbackNotice();
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
  res.innerHTML=fallbackNotice();
}

function dynamicListingCard(b,index=0){return bookCardMarkup(b,"listing",{loading:index<3?"eager":"lazy",fetchpriority:index<2?"high":""})}

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
  const emptyMarkup='<strong>نەتىجە تېپىلمىدى.</strong><br><span>سۈزگۈچنى تازىلاڭ ياكى باشقا تۈرنى كۆرۈڭ.</span><br><button type="button" class="catalog-empty-reset">↺ سۈزگۈچنى تازىلاش</button> <a href="index.html#books">باشقا كىتابلارنى كۆرۈش</a>';
  let empty=document.createElement("div");empty.className="catalog-filter-empty";empty.hidden=true;empty.innerHTML=emptyMarkup;controls.insertAdjacentElement("afterend",empty);
  if(catalogStatus.error&&!remoteCatalog.configured){
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
    grid.innerHTML=items.map((b,i)=>dynamicListingCard(b,i)).join("");
    grid.setAttribute("data-catalog-ready","");
    grid.setAttribute("aria-busy","false");
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
    else{
      items=[];
      grid.removeAttribute("data-catalog-ready");
      grid.setAttribute("aria-busy","true");
      if(!grid.querySelector(".book-card.is-skeleton"))grid.innerHTML=listingBootSkeletonMarkup(6);
      controls.innerHTML="";count.textContent="";
    }
    try{
      const result=await queryCatalog(state,{signal:controller.signal});
      if(token!==requestId)return;
      draw({...result,items:result.items.filter(isStorefrontVisible)},append);
    }catch(error){
      if(error?.name!=="AbortError"&&token===requestId){
        console.error("Category catalog query failed.",error);
        empty.hidden=true;controls.hidden=true;grid.hidden=false;
        grid.removeAttribute("data-catalog-ready");
        grid.setAttribute("aria-busy","false");
        grid.innerHTML=listingErrorMarkup();
        grid.querySelector(".catalog-retry-btn")?.addEventListener("click",async()=>{
          await loadRemoteCatalog();
          apply(false);
        });
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
      <a href="${escapeAttr(storefrontAppHref("cart.html"))}" class="mybooks-summary-card mybooks-summary-link">
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
  const preview=cartHydrationPending();
  if(preview&&!cartHasUsableDisplayPreview()){
    showCartBootSkeleton(cart().length);
    updateBadge();
    return;
  }
  if(preview){
    host.setAttribute("aria-busy","true");
    host.setAttribute("data-cart-hydration","pending");
  }else{
    host.removeAttribute("aria-busy");
    host.setAttribute("data-cart-hydration","ready");
  }
  let items=cartLines().map(line=>({...line,b:cartBookForLine(line)}));
  const orderable=preview?[]:items.filter(x=>isStorefrontVisible(x.b)&&stockInfo(x.b).canBuy&&!x.b.__cartDisplayPreview);
  let totalQty=orderable.reduce((s,x)=>s+x.qty,0);
  let total=orderable.reduce((s,x)=>s+(x.b.price||0)*x.qty,0);
  let checkout=document.querySelector("#checkoutCard");
  const layout=document.querySelector("#cartLayout");
  const aside=document.querySelector("#cartAside");
  const summaryHost=document.querySelector("#cartSummaryHost");
  const blocked=preview||items.some(x=>!isStorefrontVisible(x.b)||!stockInfo(x.b).canBuy||x.b.__cartDisplayPreview);

  if(!items.length){
    host.innerHTML=`<div class="empty-state"><span aria-hidden="true">🛒</span><h2>سېۋەت ھازىرچە بوش</h2><p>ياقتۇرغان كىتابلىرىڭىزنى تاللاپ سېۋەتكە قوشۇڭ.</p><a class="empty-state-button" href="index.html#books">كىتابلارنى كۆرۈش</a></div>`;
    if(summaryHost)summaryHost.innerHTML="";
    if(layout)layout.setAttribute("data-empty","true");
    if(aside)aside.hidden=true;
    if(checkout)checkout.hidden=true;
    updateBadge();
    return;
  }

    if(layout)layout.setAttribute("data-empty","false");
    if(aside)aside.hidden=preview;
    if(checkout){
      checkout.hidden=blocked||preview;
      checkout.setAttribute("aria-hidden",(blocked||preview)?"true":"false");
    }

  host.innerHTML=items.map((x,index)=>{
    const visible=isStorefrontVisible(x.b);
    const stock=stockInfo(x.b);
    return `<div class="cart-item${visible?"":" cart-item-unavailable"}">
      <div class="cart-item-cover">
        ${coverImgHtml(x.b,{width:100,height:127,loading:index<2?"eager":"lazy"})}
      </div>
      <div class="cart-item-body">
        <div class="cart-title">${escapeHtml(x.b.title)}</div>
        <div class="cart-meta">${escapeHtml(x.b.author)} · ${escapeHtml(x.b.category)}</div>
        <div class="cart-stock">${visible?stockBadge(x.b):`<span class="stock-badge stock-out">ھازىرچە تەمىنلەنمەيدۇ</span>`}</div>
        <div class="cart-item-toolbar">
          <div class="cart-unit-price">بىرلىك باھاسى: ${money(x.b.price)}</div>
          <div class="qty-control">
            <button type="button" aria-label="ئازايتىش" data-minus="${x.b.id}"${preview||!visible?" disabled aria-disabled=\"true\"":""}>−</button>
            <span class="cart-qty-value">${x.qty}</span>
            <button type="button" aria-label="كۆپەيتىش" data-plus="${x.b.id}"${preview||!visible||(Number.isFinite(stock.qty)&&x.qty>=stock.qty)?" disabled aria-disabled=\"true\"":""}>+</button>
          </div>
          <div class="cart-line-price"><small>جەمئىي</small><strong>${visible?money((x.b.price||0)*x.qty):"—"}</strong></div>
          <button type="button" class="remove-cart" data-remove="${x.b.id}">ئۆچۈرۈش</button>
        </div>
      </div>
    </div>`;
  }).join("");

  const summaryHtml=`<div class="cart-summary">
       <h2 class="cart-summary-heading">زاكاز خۇلاسىسى</h2>
       <div class="cart-summary-meta">
         <div class="cart-summary-row"><span>جەمئىي كىتاب سانى</span><strong>${totalQty}</strong></div>
         <div class="cart-summary-row"><span>كىتاب جەمئىي</span><strong>${money(total)}</strong></div>
       </div>
       <p class="cart-shipping-note">بۇ سومما پەقەت كىتاب باھاسى. توشۇش ھەققى مەنزىل، ئېغىرلىق ۋە يەتكۈزۈش ئۇسۇلىغا قاراپ WhatsApp تا جەزمللىنىدۇ.</p>
       <div class="cart-total"><span>كىتاب جەمئىي</span><strong>${money(total)}</strong></div>
       <div class="cart-summary-actions">
         ${blocked?"":`<button type="button" class="checkout-secondary" id="scrollCheckout">📦 زاكاز ئۇچۇرىنى تولدۇرۇش</button>`}
         <button type="button" class="clear-cart" id="clearCart">🗑️ سېۋەتنى تازىلاش</button>
       </div>
     </div>`;
  if(preview){
    if(summaryHost)summaryHost.innerHTML="";
  }else if(summaryHost)summaryHost.innerHTML=summaryHtml;
  else host.insertAdjacentHTML("beforeend",summaryHtml);

  host.querySelectorAll("[data-plus]").forEach(b=>b.onclick=()=>changeQty(b.dataset.plus,1));
  host.querySelectorAll("[data-minus]").forEach(b=>b.onclick=()=>changeQty(b.dataset.minus,-1));
  host.querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>{remove(b.dataset.remove);cartPage()});

  let clear=document.querySelector("#clearCart");
  if(clear)clear.onclick=()=>{
    if(confirm("سېۋەتتىكى بارلىق كىتابلارنى ئۆچۈرەمسىز؟")){
      set(CART_KEY,[]);
      pruneCartDisplaySnapshots();
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
  if(cartHydrationPending())return;
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
  if(cartHydrationPending()){toast("كىتاب ئۇچۇرى يۈكلىنىۋاتىدۇ؛ سەل ساقلاڭ.");return null}
  let items=cartLines().map(line=>({...line,b:find(line.id)||null}));
  if(!items.length){toast("سېۋەت بوش");return null}
  if(items.some(x=>!x.b||x.b.__cartDisplayPreview)){toast("كىتاب ئۇچۇرى تېخى جەزملەنمىدى؛ سەل ساقلاڭ.");return null}
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
  const member=window.KutadguMember;
  if(member?.ready)await member.ready;
  if(typeof member?.getUser==="function"&&!member.getUser())return {saved:false,reason:"not_signed_in"};
  const result=await member?.saveOrder?.(order);
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
  toast("زاكاز ئۇچۇرى تەييار بولدى ✅");
  return o;
}

async function copyOrder(){
  let o=getOrBuildOrder(true);if(!o)return;
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
      <a href="/order-info">زاكاز قانداق بولىدۇ</a>
      <a href="/privacy">مەخپىيەتلىك</a>
      <a href="/returns">قايتۇرۇش / ئالماشتۇرۇش</a>
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

function firstPopulatedCarouselMode(enabledModes,itemCounts){
  const modes=Array.isArray(enabledModes)?enabledModes.filter(Boolean):[];
  if(!modes.length)return "";
  for(let i=0;i<modes.length;i++){
    const mode=modes[i];
    if(Number(itemCounts&&itemCounts[mode])>0)return mode;
  }
  return modes[0];
}

function carouselVisibleCount(width,config){
  const w=Number(width)||0;
  const desktop=Math.max(1,Number(config&&config.desktopCardsPerRow)||4);
  if(w>1100)return desktop;
  if(w<=430)return 1;
  if(w<=850)return 2;
  return Math.min(3,Number(config&&config.tabletVisibleCards)||3);
}

function carouselShouldAutoplay(itemCount,visible,options){
  const opts=options||{};
  if(opts.reducedMotion||opts.hidden||opts.autoPlayEnabled===false)return false;
  if(opts.mobile&&opts.mobileAutoPlayEnabled!==true)return false;
  return Number(itemCount)>Number(visible);
}

function featuredRowVisibleCount(width){
  const w=Number(width)||0;
  if(w<=700)return 2;
  if(w<=1100)return 3;
  return 5;
}

function featuredRowShouldAutoplay(itemCount,visible,options){
  return carouselShouldAutoplay(itemCount,visible,options);
}

function splitFeaturedRows(books){
  const list=Array.isArray(books)?books:[];
  const mid=Math.ceil(list.length/2);
  return {top:list.slice(0,mid),bottom:list.slice(mid)};
}

function featuredRowDirection(which){
  return which==="bottom"?"ltr":"rtl";
}

function setupHomeFeaturedMarquee(host){
  if(!host)return;
  if(typeof host._featuredMarqueeCleanup==="function")host._featuredMarqueeCleanup();
  const section=host.querySelector(".home-featured-section")||host;
  const rowEls=[...host.querySelectorAll(".home-featured-row")];
  if(!rowEls.length)return;
  const delay=5500,duration=900;
  const motionMq=window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let reducedMotion=motionMq?.matches===true;
  let hoverPaused=false;
  let focusPaused=false;
  const states=new WeakMap();
  let timer=null;
  const pendingSnaps=new Set();
  const pendingTimers=new Set();
  function interactionPaused(){return hoverPaused||focusPaused}

  function isMobile(){return window.innerWidth<=700}

  function rowCards(track){
    return [...track.querySelectorAll(".home-feature-card")];
  }

  function apply(track,offset,animate){
    const enable=animate&&!reducedMotion;
    track.style.transition=enable?`transform ${duration}ms cubic-bezier(.22,.61,.36,1)`:"none";
    track.style.transform=`translateX(${offset}px)`;
    if(!enable)void track.offsetWidth;
  }

  function sizeCards(row,track){
    const items=rowCards(track);
    items.forEach(el=>{el.style.flex="";el.style.width="";el.style.maxWidth=""});
    if(isMobile())return {items,itemCount:items.length,visible:featuredRowVisibleCount(window.innerWidth),step:0};
    const visible=featuredRowVisibleCount(window.innerWidth);
    const gap=parseFloat(window.getComputedStyle(track).columnGap||window.getComputedStyle(track).gap)||14;
    const rowWidth=row.clientWidth;
    const cardWidth=visible>0?(rowWidth-gap*(visible-1))/visible:0;
    items.forEach(el=>{
      el.style.flex=`0 0 ${cardWidth}px`;
      el.style.width=`${cardWidth}px`;
      el.style.maxWidth=`${cardWidth}px`;
    });
    return {items,itemCount:items.length,visible,step:cardWidth+gap};
  }

  function clearPending(track){
    pendingSnaps.forEach(fn=>{if(track)track.removeEventListener("transitionend",fn)});
    pendingTimers.forEach(id=>clearTimeout(id));
    pendingTimers.clear();
  }

  function afterTransform(track,fn){
    let done=false;
    let tid=null;
    const finish=event=>{
      if(done)return;
      if(event&&event.propertyName!=="transform")return;
      if(event&&event.target!==track)return;
      done=true;
      track.removeEventListener("transitionend",finish);
      pendingSnaps.delete(finish);
      if(tid!=null){clearTimeout(tid);pendingTimers.delete(tid)}
      fn();
    };
    pendingSnaps.add(finish);
    track.addEventListener("transitionend",finish);
    tid=setTimeout(()=>finish(),duration+150);
    pendingTimers.add(tid);
  }

  function drawRow(row){
    const track=row.querySelector(".home-featured-track");
    if(!track)return;
    clearPending(track);
    const sized=sizeCards(row,track);
    const dir=row.dataset.direction||featuredRowDirection(row.dataset.featuredRow);
    const canPlay=featuredRowShouldAutoplay(sized.itemCount,sized.visible,{
      reducedMotion,hidden:document.hidden,autoPlayEnabled:true,mobile:isMobile(),mobileAutoPlayEnabled:false
    });
    row.dataset.autoplay=canPlay?"1":"0";
    if(isMobile()){
      states.set(row,{track,dir,itemCount:sized.itemCount,step:0,offset:0,canPlay:false,busy:false});
      track.style.transition="";
      track.style.transform="";
      return;
    }
    states.set(row,{track,dir,itemCount:sized.itemCount,step:sized.step,offset:0,canPlay,busy:false});
    apply(track,0,false);
  }

  function draw(){rowEls.forEach(drawRow)}

  function tick(){
    if(interactionPaused()||document.hidden||reducedMotion||isMobile())return;
    rowEls.forEach(row=>{
      const st=states.get(row);
      if(!st||!st.canPlay||!st.step||st.busy)return;
      const items=rowCards(st.track);
      if(items.length<2)return;
      st.busy=true;
      if(st.dir==="rtl"){
        st.offset=-st.step;
        apply(st.track,-st.step,true);
        afterTransform(st.track,()=>{
          const first=st.track.querySelector(".home-feature-card");
          if(first)st.track.appendChild(first);
          st.offset=0;
          apply(st.track,0,false);
          st.busy=false;
        });
      }else{
        const last=st.track.querySelector(".home-feature-card:last-child");
        if(last)st.track.insertBefore(last,st.track.firstChild);
        st.offset=-st.step;
        apply(st.track,-st.step,false);
        st.offset=0;
        apply(st.track,0,true);
        afterTransform(st.track,()=>{
          st.offset=0;
          st.busy=false;
        });
      }
    });
  }

  function stop(){if(timer){clearInterval(timer);timer=null}}
  function start(){
    stop();
    if(interactionPaused()||isMobile()||reducedMotion||document.hidden)return;
    if(!rowEls.some(row=>states.get(row)?.canPlay))return;
    timer=setInterval(tick,delay);
  }
  function onEnter(){hoverPaused=true;stop()}
  function onLeave(){hoverPaused=false;if(!focusPaused)start()}
  function onFocusIn(){focusPaused=true;stop()}
  function onFocusOut(event){
    if(section.contains(event.relatedTarget))return;
    focusPaused=false;
    if(!hoverPaused)start();
  }
  function onVis(){if(document.hidden)stop();else start()}
  function onMotion(event){reducedMotion=event.matches;draw();if(reducedMotion)stop();else start()}
  function onResize(){draw();start()}

  draw();
  section.addEventListener("mouseenter",onEnter);
  section.addEventListener("mouseleave",onLeave);
  section.addEventListener("focusin",onFocusIn);
  section.addEventListener("focusout",onFocusOut);
  document.addEventListener("visibilitychange",onVis);
  motionMq?.addEventListener?.("change",onMotion);
  window.addEventListener("resize",onResize);
  start();
  host._featuredMarqueeCleanup=()=>{
    stop();
    pendingSnaps.forEach(fn=>{
      rowEls.forEach(row=>{
        const track=row.querySelector(".home-featured-track");
        if(track)track.removeEventListener("transitionend",fn);
      });
    });
    pendingSnaps.clear();
    pendingTimers.forEach(id=>clearTimeout(id));
    pendingTimers.clear();
    section.removeEventListener("mouseenter",onEnter);
    section.removeEventListener("mouseleave",onLeave);
    section.removeEventListener("focusin",onFocusIn);
    section.removeEventListener("focusout",onFocusOut);
    document.removeEventListener("visibilitychange",onVis);
    motionMq?.removeEventListener?.("change",onMotion);
    window.removeEventListener("resize",onResize);
  };
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
    desktopCardsPerRow:4,desktopRows:1,tabletVisibleCards:4,
    autoplayDelay:5000,animationDuration:800,staggerDelay:90,
    autoPlayEnabled:true,mobileAutoPlayEnabled:false,
    ...(appConfig().carousel||{})
  };
  let reducedMotion=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches===true;
  const gap=10;
  let mode=enabledModes[0],list=[],index=0,timer=null,touchX=null,dualLayout=false;
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
    homepageVisibleBooks(result).forEach(book=>{if(!known.has(book.id)){known.add(book.id);merged.push(book)}});
    const value={items:merged,hasMore:result.hasMore&&merged.length<24,total:result.total};
    modeCache.set(currentMode,value);
    return value;
  }
  function card(b,i=0){
    const loading=i<4?"eager":"lazy";
    const fetchpriority=i<2?"high":"";
    const id=escapeAttr(b.id),href=escapeAttr(safeHref(b.href)),title=escapeHtml(b.title||"كىتاب");
    const authorName=storefrontAuthor(b);
    return `<article class="home-carousel-card">
      <button type="button" class="home-carousel-fav favorite-button mini-heart" data-fav-id="${id}" aria-label="ياقتۇرۇش">♡</button>
      <a href="${href}" class="home-carousel-link">
        <div class="home-carousel-cover">${coverImgHtml(b,{width:320,height:460,loading,fetchpriority})}</div>
      </a>
      <div class="home-carousel-info">
        <a href="${href}" class="home-carousel-meta-link"><div class="home-carousel-title">${title}</div>${authorName?`<div class="home-carousel-author">${escapeHtml(authorName)}</div>`:""}</a>
        <div class="home-carousel-bottom"><span class="home-carousel-price">${money(b.price)}</span>${cartButton(b,"🛒","home-carousel-cart add-to-cart")}</div>
      </div>
    </article>`;
  }
  const isDual=()=>window.innerWidth>1100&&Number(carousel.desktopRows)>1;
  dualLayout=isDual();
  const visibleCount=()=>carouselVisibleCount(window.innerWidth,carousel);
  const rowLength=()=>Math.ceil(list.length/Math.max(1,Number(carousel.desktopRows)||1));
  const maxIndex=()=>Math.max(0,(isDual()?rowLength()-(Number(carousel.desktopCardsPerRow)||4):list.length-visibleCount()));
  let loopPad=0,snapping=false;

  function renderDots(){
    const count=maxIndex()+1;
    dotsHost.innerHTML=Array.from({length:count},(_,i)=>`<button type="button" class="home-carousel-dot${i===index?' is-active':''}" data-carousel-dot="${i}" aria-label="${i+1}-كۆرۈنۈش"></button>`).join("");
    dotsHost.querySelectorAll("[data-carousel-dot]").forEach(button=>button.onclick=()=>{index=Number(button.dataset.carouselDot)||0;move();restart()});
  }
  function trackIndex(){return(isDual()?0:loopPad)+index}
  function move(animate=true){
    if(isDual())index=Math.max(0,Math.min(index,maxIndex()));
    const first=host.querySelector(".home-carousel-card");if(!first)return;
    const lane=isDual()?first.closest(".home-carousel-row"):host;
    const laneStyle=window.getComputedStyle(lane);
    const renderedGap=parseFloat(laneStyle.columnGap||laneStyle.gap)||gap;
    const step=first.getBoundingClientRect().width+renderedGap;
    const enableAnim=animate!==false&&!reducedMotion&&!snapping;
    if(isDual()){
      host.style.transform="";
      host.querySelectorAll(".home-carousel-row").forEach(row=>{
        row.style.transition=enableAnim?"":"none";
        row.style.transform=`translateX(${index*step}px)`;
      });
    }else{
      host.style.transition=enableAnim?"":"none";
      host.style.transform=`translateX(${trackIndex()*step}px)`;
      if(!enableAnim){void host.offsetWidth;host.style.transition=""}
    }
    const n=Math.max(list.length,1);
    const wrapped=((index%n)+n)%n;
    const dotIndex=Math.max(0,Math.min(wrapped,maxIndex()));
    dotsHost.querySelectorAll(".home-carousel-dot").forEach((dot,i)=>dot.classList.toggle("is-active",i===dotIndex));
  }
  function draw(rotate=false){
    const vis=visibleCount();
    const canRotate=rotate&&mode==="recommended"&&list.length>8;
    index=canRotate?(new Date().getDate()%Math.min(3,maxIndex()+1)):0;
    host.style.transform="translateX(0)";
    host.classList.toggle("is-dual-row",isDual());host.classList.toggle("is-single-row",!isDual());
    const fadeFromSkel=!!host.querySelector(".home-carousel-card.is-skeleton");
    if(isDual()){
      loopPad=0;
      const midpoint=Math.ceil(list.length/2),top=list.slice(0,midpoint),bottom=list.slice(midpoint);
      host.innerHTML=`<div class="home-carousel-row">${top.map((b,i)=>card(b,i)).join("")}</div><div class="home-carousel-row">${bottom.map((b,i)=>card(b,i+top.length)).join("")}</div>`;
    }else{
      const loop=list.length>vis;
      const lead=loop?list.slice(-vis):[];
      const tail=loop?list.slice(0,vis):[];
      loopPad=lead.length;
      host.innerHTML=[...lead,...list,...tail].map((b,i)=>card(b,i)).join("");
    }
    bindDynamicActions(host);renderFavButtons();renderDots();move(false);
    host.removeAttribute("aria-busy");
    if(fadeFromSkel)host.classList.add("home-catalog-fade");
  }
  async function setMode(nextMode){
    mode=enabledModes.includes(nextMode)?nextMode:enabledModes[0];
    tabs.forEach(button=>{const active=button.dataset.carouselMode===mode;button.classList.toggle("is-active",active);button.setAttribute("aria-selected",active?"true":"false")});
    const requestedMode=mode;
    if(!host.querySelector(".home-carousel-card.is-skeleton"))host.innerHTML=homeCarouselSkeletonMarkup(4);
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
    if(!list.length)return;
    const vis=visibleCount();
    const cached=modeCache.get(mode);
    if(!isDual()&&index>=list.length-vis&&cached?.hasMore&&cached.items.length<24){
      try{
        const keep=index;
        const loaded=await loadMode(mode,true);
        list=loaded.items;draw();index=Math.min(keep,Math.max(0,list.length-1));move(false);
      }catch(error){if(error?.name!=="AbortError")console.warn("More carousel books could not be loaded.",error)}
    }
    if(isDual()){index=index>=maxIndex()?0:index+1;move(true);return}
    if(list.length<=vis){index=0;move(true);return}
    index+=1;move(true);
  }
  function prev(){
    if(!list.length)return;
    if(isDual()){index=index<=0?maxIndex():index-1;move(true);return}
    if(list.length<=visibleCount()){index=0;move(true);return}
    index-=1;move(true);
  }
  function stop(){if(timer){clearInterval(timer);timer=null}}
  function start(){
    stop();
    if(!featureEnabled("autoCarousel"))return;
    if(!carouselShouldAutoplay(list.length,visibleCount(),{
      reducedMotion,hidden:document.hidden,autoPlayEnabled:carousel.autoPlayEnabled,
      mobile:window.innerWidth<=700,mobileAutoPlayEnabled:carousel.mobileAutoPlayEnabled
    }))return;
    timer=setInterval(()=>{next()},Math.max(5000,Number(carousel.autoplayDelay)||5000));
  }
  function restart(){start()}
  function settleLoop(){
    if(isDual()||list.length<=visibleCount())return;
    if(index>=list.length){snapping=true;index=0;move(false);snapping=false}
    else if(index<0){snapping=true;index=list.length-1;move(false);snapping=false}
  }

  let userPickedMode=false;
  async function resolveInitialMode(){
    const itemCounts={};
    for(const candidate of enabledModes){
      try{
        const loaded=modeCache.get(candidate)||await loadMode(candidate,false);
        itemCounts[candidate]=loaded.items.length;
        if(loaded.items.length)break;
      }catch(error){
        if(error?.name==="AbortError"){
          if(userPickedMode)return mode;
          continue;
        }
        console.warn("Homepage carousel mode probe failed.",candidate,error);
        itemCounts[candidate]=0;
      }
    }
    return firstPopulatedCarouselMode(enabledModes,itemCounts);
  }
  tabs.forEach(button=>button.addEventListener("click",()=>{userPickedMode=true;setMode(button.dataset.carouselMode)}));
  document.querySelector("#carouselNext")?.addEventListener("click",()=>{next();restart()});
  document.querySelector("#carouselPrev")?.addEventListener("click",()=>{prev();restart()});
  const carouselRoot=viewport.closest("#newBooksCarousel")||viewport;
  carouselRoot.addEventListener("mouseenter",stop);
  carouselRoot.addEventListener("mouseleave",start);
  viewport.addEventListener("focusin",stop);viewport.addEventListener("focusout",start);
  host.addEventListener("transitionend",event=>{if(event.target===host&&event.propertyName==="transform")settleLoop()});
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
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.addEventListener?.("change",event=>{reducedMotion=event.matches;if(reducedMotion)stop();else restart()});
  window.addEventListener("resize",()=>{const changed=dualLayout!==isDual();dualLayout=isDual();if(changed)draw();else{if(isDual())index=Math.min(index,maxIndex());renderDots();move(false)}restart()});
  resolveInitialMode().then(initial=>{if(!userPickedMode)setMode(initial)});
}

function loadMemberSystem(){
  if(document.querySelector('script[data-kutadgu-member-script]')||window.KutadguMember)return;
  const script=document.createElement("script");
        script.src="/member.js?v=18";script.async=true;script.dataset.kutadguMemberScript="1";
  document.body.appendChild(script);
}
function refreshAfterMemberSync(){
  if(isPreviewShopDebug()){
    const owner=readShopOwner();
    const uid=window.KutadguMember?.getUser?.()?.id;
    let raw=0;
    try{const value=JSON.parse(localStorage.getItem(CART_KEY));raw=Array.isArray(value)?value.length:0}catch(e){}
    console.info("[kutadgu-shop-debug]",{
      event:"display",
      user:uid?String(uid).slice(-4):"(empty)",
      owner:owner?(/^[0-9a-f-]{36}$/i.test(owner)?String(owner).slice(-4):owner):"(empty)",
      localCartRaw:raw,
      localCartDisplay:cart().length,
      allowDisplay:shopOwnerAllowsLocalDisplay()
    });
  }
  updateBadge();renderFavButtons();
  if(document.querySelector("#cartItems"))cartPage();
  if(document.querySelector("#favoritesList")){
    const ids=favs().map(String).filter(Boolean);
    const draw=()=>renderFavoritesPage();
    if(ids.length)Promise.resolve(hydrateBooksByIds(ids)).then(draw,draw);
    else draw();
  }
  if(document.querySelector("#myBooksApp"))renderMyBooks();
  loadMemberProfileIntoCheckout();
}
function loadAssetScript(src,id){
  if(document.getElementById(id))return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const script=document.createElement("script");script.id=id;script.src=storefrontAssetPath(src);script.defer=true;
    script.onload=resolve;script.onerror=()=>reject(new Error(`${src} could not be loaded`));
    document.head.appendChild(script);
  });
}
function ensureCoverSystemCss(){
  let el=document.querySelector("link[data-kutadgu-covers]");
  if(!el){
    el=document.createElement("link");
    el.rel="stylesheet";
    el.href="/covers.css?v=2";
    el.dataset.kutadguCovers="1";
  }
  document.head.appendChild(el);
}
function loadPremiumUX(){
  if(!document.querySelector('link[data-kutadgu-premium-ux]')){
    const link=document.createElement("link");link.rel="stylesheet";link.href="/premium-ux.css?v=8";link.dataset.kutadguPremiumUx="1";document.head.appendChild(link);
  }
  ensureCoverSystemCss();
  return loadAssetScript("/premium-ux.js?v=11","kutadguPremiumUxScript");
}
let staticShellReady=false;
function initStaticShell(){
  if(staticShellReady)return;
  staticShellReady=true;
  ensureCoverSystemCss();
  injectFloat();
  paintListingBootState();
  if(!liveListingWaiting()){
    applyStaticCoverFallbacks();
    syncStaticCards();
  }
  decorateCards();
  searchEnhance();
  renderHomeSections();
  renderMyBooks();
  renderFavoritesPage();
  renderContactSection();
  renderSiteFooter();
  paintCartBootState();
  setupCheckout();
}
function init(){
  if(maybeRedirectLegacyBookUrl())return;
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
  if(!liveListingWaiting())syncStaticCards();
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
  bootStarted=true;
  if(maybeRedirectLegacyBookUrl())return;
  try{await loadAssetScript("/app-config.js?v=2","kutadguAppConfigScript")}catch(error){console.warn(error)}
  initStaticShell();
  await loadRemoteCatalog();
  await hydratePageBook();
  const savedIds=[...cart().map(item=>item.id),...favs(),...get(REC_KEY,[])];
  await hydrateBooksByIds(savedIds);
  migratePersistedBookIds();
  await hydrateBooksByIds([...cart().map(item=>item.id),...favs()]);
  migratePersistedBookIds();
  markCatalogBootSettled();
  window.KUTADGU_LIVE_CATALOG=C;
  init();
  document.dispatchEvent(new CustomEvent("kutadgu:catalog-ready",{detail:{count:C.length}}));
  try{await loadPremiumUX()}catch(error){console.warn(error)}
  ensureCoverSystemCss();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
window.kutadguShop={add,remove,toggleFav,cart,cartHas,cartLines,favorites:()=>[...favs()],favHas,find,canonicalId,hydrateBooksByIds,shareBook,buildOrderText,showOrderPreview,copyOrder,shareOrder,orderWithWhatsApp,whatsappOrderUrl,getCatalog:()=>[...C],queryCatalog,getQueryState:()=>JSON.parse(JSON.stringify(catalogQueryState)),trackEvent,migratePersistedBookIds,renderBookGallery,normalizeGalleryImages,isStorefrontVisible,refreshStorefrontVisibility,applyBestsellerHonesty,countPositiveSales,storefrontAuthor,storefrontIsbn,isPlaceholderAuthor,aliasMap,HOMEPAGE_DOCUMENT_TITLE,isStorefrontHomepage,isBookDetailDocument,applyHomepageDocumentTitle,miniCard,homeFeatureCard,bookCardMarkup,favoriteCard,openCoverLightbox,coverSrc,coverImgHtml,isSampleDemoCover,isRetryableCoverUrl,handleCoverError,handleCoverLoad,assignCoverImage,getCoverRetryDebug,escapeHtml,escapeAttr,safeHref,isSafeCoverUrl,setDynamicMeta,normalizeCatalogBook,cartHydrationPending,CART_DISPLAY_KEY,detailRecommendations,storefrontCategoryHref,storefrontAppHref,DETAIL_RELATED_PAGE_SIZE,detailRelatedQueryInput,detailRelatedShouldQuery,COVER_RETRY_MAX,COVER_RETRY_DELAYS,COVER_RETRY_CONCURRENCY};
})();
