(function(){
"use strict";
const Write=window.KutadguAdminWrite||{};
const Quality=window.KutadguAdminQuality||{};
const Bib=window.KutadguBibliography||{};
const cfg=window.KUTADGU_SUPABASE_CONFIG||{};
const STATIC=[...(window.KITAP_CATALOG||[])];
const $=s=>document.querySelector(s);
const PAGE_SIZE=40;
const IMPORT_BATCH=80;
const OPTIONAL_BOOK_COLS=["isbn","publisher","href","stock","stock_status","pages","translator","language","publish_date","publish_year","cover_type","dimensions","legacy_id","gallery_images"];
const OPTIONAL_COL_ALIASES={
  isbn:["isbn","barcode","باركود"],
  publisher:["publisher","نەشرىيات"],
  href:["href","url","link"],
  stock:["stock","ئامبار"],
  stock_status:["stock_status"],
  pages:["pages","بەت","بەت_سانى"],
  translator:["translator","تەرجىمان","تەرجىمانى"],
  language:["language"],
  publish_date:["publish_date"],
  publish_year:["publish_year","year","نەشر_يىلى"],
  cover_type:["cover_type"],
  dimensions:["dimensions"],
  legacy_id:["legacy_id","legacyid","static_id"],
  gallery_images:["gallery_images","gallery"]
};
const LIVE_OPTIONAL_BOOK_COLS={isbn:true,publisher:true,href:false,stock:false,stock_status:false,pages:true,translator:true,language:false,publish_date:false,publish_year:true,cover_type:false,dimensions:false,legacy_id:false,gallery_images:false};

let db=null,user=null,books=[],editing=null,members=[],orders=[];
let isbnColumn=true,migrationWarned=false;
let generatedAlwaysId=false;
const presentBookCols=new Set();
let listTotal=0,listPage=0,listRequest=0;
let selectedIds=new Set();
let searchTimer=null;
let importRows=[];
let importRunning=false;
let xlsxLoading=null;
let galleryDraft=[];
let saveInFlight=false;
let createConflictAck=false;

const listFilters={
  q:"",
  source:"",
  active:"",
  recommended:"",
  isNew:"",
  quality:"",
  sort:"created_at.desc"
};

function configured(){
  return !!(String(cfg.url||"").trim() && String(cfg.anonKey||cfg.publishableKey||"").trim());
}
function status(el,msg,type=""){
  if(!el)return;
  el.textContent=msg;
  el.className=`admin-status ${type}`.trim();
}
function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function money(n){return n!==null&&n!==undefined&&n!==""?`${Number(n).toLocaleString("tr-TR")} ₺`:"—"}
function applyFieldDirections(){
  document.querySelectorAll("input,textarea").forEach(field=>{
    if(field.matches('input[type="checkbox"],input[type="radio"],input[type="file"],input[type="button"],input[type="submit"]'))return;
    const type=String(field.type||"").toLowerCase();
    field.dir=["email","tel","url","number","password","date","time","datetime-local"].includes(type)||field.id==="bookIsbn"?"ltr":"auto";
    field.style.textAlign="start";
  });
}
function idForNew(){return `book-${Date.now().toString(36)}`}
function categoryOptions(){
  const map=new Map();
  (window.KUTADGU_APP_CONFIG?.catalogCategories||[]).forEach(item=>{if(item?.source&&!map.has(item.source))map.set(item.source,item.label||item.source)});
  STATIC.forEach(b=>{if(b.source&&!map.has(b.source))map.set(b.source,b.category||b.source)});
  return [...map.entries()].sort((a,b)=>a[1].localeCompare(b[1],"ug"));
}
function sourceCategory(source){
  return categoryOptions().find(x=>x[0]===source)?.[1]||source;
}
function resolveCategory(value){
  const raw=String(value||"").trim();
  if(!raw)return null;
  const opts=categoryOptions();
  const bySource=opts.find(([source])=>source===raw||source.replace(/\.html$/,"")===raw.replace(/\.html$/,""));
  if(bySource)return {source:bySource[0],category:bySource[1]};
  const byLabel=opts.find(([,label])=>label===raw);
  if(byLabel)return {source:byLabel[0],category:byLabel[1]};
  return null;
}
function renderSourceOptions(){
  const sel=$("#bookSource");if(!sel)return;
  sel.innerHTML='<option value="">تۈر تاللاڭ</option>'+categoryOptions().map(([source,cat])=>`<option value="${esc(source)}">${esc(cat)}</option>`).join("");
  const filter=$("#adminFilterSource");
  if(filter)filter.innerHTML='<option value="">بارلىق تۈرلەر</option>'+categoryOptions().map(([source,cat])=>`<option value="${esc(source)}">${esc(cat)}</option>`).join("");
}
function show(id){
  ["setupPanel","loginPanel","dashboardPanel"].forEach(x=>$("#"+x).hidden=x!==id);
}
function modal(open){
  $("#bookModal").hidden=!open;
}
function normalizeIsbn(value){
  return Quality.normalizeIsbn?Quality.normalizeIsbn(value):String(value??"").trim().replace(/[\s-]+/g,"").replace(/[^0-9Xx]/g,"").toUpperCase();
}
function formatIsbn(value){
  return Quality.formatIsbn?Quality.formatIsbn(value):normalizeIsbn(value);
}
function isbnLooksValid(value){
  const n=normalizeIsbn(value);
  if(!n)return true;
  return n.length===10||n.length===13;
}
function searchSafe(term){
  return String(term||"").replace(/[%_*(),]/g," ").replace(/\s+/g," ").trim().slice(0,80);
}
function postgrestIlike(column,term){
  const like=`%${String(term).replace(/\\/g," ").replace(/"/g,"")}%`;
  return `${column}.ilike."${like}"`;
}
function applyBooksSchema(){
  const spec=window.KUTADGU_BOOKS_SCHEMA||{};
  const optional={...LIVE_OPTIONAL_BOOK_COLS,...(spec.optionalColumns||{})};
  presentBookCols.clear();
  OPTIONAL_BOOK_COLS.forEach(col=>{if(optional[col]!==false)presentBookCols.add(col)});
  isbnColumn=presentBookCols.has("isbn");
  generatedAlwaysId=spec.identityId==null?true:spec.identityId===true;
  document.querySelectorAll("[data-book-col]").forEach(el=>{
    const col=el.getAttribute("data-book-col");
    el.hidden=!presentBookCols.has(col);
  });
  const search=$("#adminSearch");
  if(search){
    search.placeholder="كىتاب، ئاپتور، تەرجىمان، نەشرىيات ياكى ISBN ئىزدەڭ...";
  }
  const staticBtn=$("#importStaticBtn");
  if(staticBtn){
    staticBtn.hidden=generatedAlwaysId;
    staticBtn.disabled=generatedAlwaysId;
  }
  if(!isbnColumn)warnMigrationOnce();
}
function disableBibColumns(cols){
  (cols||[]).forEach(col=>presentBookCols.delete(col));
  const spec=window.KUTADGU_BOOKS_SCHEMA;
  if(spec&&Bib.disableOptionalColumns)window.KUTADGU_BOOKS_SCHEMA=Bib.disableOptionalColumns(spec,cols);
  applyBooksSchema();
}
function searchOrFilter(term,includeIsbn){
  const t=searchSafe(term);
  if(!t)return "";
  const cols=Bib.adminSearchColumns?Bib.adminSearchColumns(presentBookCols):["title","author"];
  const parts=cols.map(col=>postgrestIlike(col,t));
  if(includeIsbn&&presentBookCols.has("isbn")){
    parts.push(postgrestIlike("isbn",t));
    const digits=normalizeIsbn(t);
    if(digits&&digits!==t)parts.push(postgrestIlike("isbn",digits));
    if(digits)parts.push(`isbn.eq.${digits}`);
  }
  return parts.join(",");
}
function isCanonicalBookId(value){
  return Write.isCanonicalBookId?Write.isCanonicalBookId(value):/^\d+$/.test(String(value||"").trim());
}
function canonicalBookId(value){
  return Write.canonicalBookId?Write.canonicalBookId(value):(isCanonicalBookId(value)?String(value).trim():"");
}
function writeBookRow(row,opts={}){
  const omitId=!!opts.omitId||(generatedAlwaysId&&opts.mode!=="update");
  const out={};
  Object.keys(row||{}).forEach(key=>{
    if(OPTIONAL_BOOK_COLS.includes(key)&&!presentBookCols.has(key))return;
    if(omitId&&key==="id")return;
    if(opts.mode==="update"&&(key==="id"||key==="created_at"||key==="legacy_id"||key==="updated_at"))return;
    out[key]=row[key];
  });
  if(opts.mode==="update"&&Write.stripIdentityFields)return Write.stripIdentityFields(out);
  return out;
}
function generatedIdError(error){
  const msg=String(error?.message||error||"");
  return error?.code==="428C9"||/GENERATED ALWAYS/i.test(msg)||/identity column/i.test(msg);
}
function ignoredImportColumns(objects){
  const keys=new Set();
  (objects||[]).forEach(row=>Object.keys(row||{}).forEach(k=>{if(k&&k!=="_row")keys.add(k)}));
  return OPTIONAL_BOOK_COLS.filter(col=>{
    if(presentBookCols.has(col))return false;
    return (OPTIONAL_COL_ALIASES[col]||[col]).some(alias=>keys.has(alias));
  });
}
function nonEmptyIgnoredValues(raw){
  return OPTIONAL_BOOK_COLS.filter(col=>{
    if(presentBookCols.has(col))return false;
    const value=headerAlias(raw,OPTIONAL_COL_ALIASES[col]||[col]);
    return String(value??"").trim()!=="";
  });
}

function parseCsvText(text){
  const src=String(text||"").replace(/^\uFEFF/,"");
  const rows=[];
  let row=[],field="",i=0,inQuotes=false;
  const pushField=()=>{row.push(field);field=""};
  const pushRow=()=>{if(row.length>1||(row.length===1&&row[0]!==""))rows.push(row);row=[]};
  while(i<src.length){
    const ch=src[i];
    if(inQuotes){
      if(ch==='"'){
        if(src[i+1]==='"'){field+='"';i+=2;continue}
        inQuotes=false;i++;continue;
      }
      field+=ch;i++;continue;
    }
    if(ch==='"'){inQuotes=true;i++;continue}
    if(ch===","){pushField();i++;continue}
    if(ch==="\n"){pushField();pushRow();i++;continue}
    if(ch==="\r"){i++;continue}
    field+=ch;i++;
  }
  pushField();pushRow();
  return rows;
}
function rowsToObjects(rows){
  if(!rows.length)return [];
  const headers=rows[0].map(h=>String(h||"").trim().toLowerCase().replace(/\s+/g,"_"));
  return rows.slice(1).map((cells,idx)=>{
    const obj={_row:idx+2};
    headers.forEach((key,i)=>{if(key)obj[key]=cells[i]==null?"":String(cells[i])});
    return obj;
  });
}
function headerAlias(row,names){
  for(const name of names){
    if(row[name]!=null&&String(row[name]).trim()!=="")return row[name];
  }
  for(const name of names){
    if(Object.prototype.hasOwnProperty.call(row,name))return row[name]??"";
  }
  return "";
}
function parseBoolCell(raw,field){
  const v=String(raw??"").trim();
  if(v==="")return {ok:true,value:null,empty:true};
  const n=v.toLowerCase();
  if(["true","1","yes","y","on","ھەئە","ھە","راست"].includes(n))return {ok:true,value:true,empty:false};
  if(["false","0","no","n","off","ياق","خاتا"].includes(n))return {ok:true,value:false,empty:false};
  return {ok:false,error:`${field} ئۈچۈن «${v}» ئىناۋەتسىز boolean`};
}
function parseNumberCell(raw,field,{allowEmpty=true,integer=false}={}){
  const v=String(raw??"").trim();
  if(v==="")return allowEmpty?{ok:true,value:null,empty:true}:{ok:false,error:`${field} بوش`};
  const n=Number(v.replace(",", "."));
  if(!Number.isFinite(n))return {ok:false,error:`${field} سان ئەمەس`};
  if(integer&&!Number.isInteger(n))return {ok:false,error:`${field} پۈتۈن سان بولسۇن`};
  if(n<0)return {ok:false,error:`${field} مەنپىي بولماسلىقى كېرەك`};
  return {ok:true,value:n,empty:false};
}

function mapImportRow(raw){
  const title=String(headerAlias(raw,["title","book_title","كىتاب"])).trim();
  const author=String(headerAlias(raw,["author","ئاپتور"])).trim();
  const isbn=formatIsbn(headerAlias(raw,["isbn","barcode","باركود"]));
  const publisher=String(headerAlias(raw,["publisher","نەشرىيات"])).trim();
  const description=String(headerAlias(raw,["description","desc"])).trim();
  const cover=String(headerAlias(raw,["cover_url","image_url","image","cover"])).trim();
  const translator=String(headerAlias(raw,["translator","تەرجىمان","تەرجىمانى"])).trim();
  const language=String(headerAlias(raw,["language"])).trim();
  const publishYearRaw=String(headerAlias(raw,["publish_year","year","نەشر_يىلى"])).trim();
  const stockStatus=String(headerAlias(raw,["stock_status"])).trim();
  const sourceRaw=String(headerAlias(raw,["source","category_source"])).trim();
  const categoryRaw=String(headerAlias(raw,["category","تۈر"])).trim();
  const errors=[],warnings=[];
  if(!title)errors.push("كىتاب ئىسمى بوش");
  if(/^EXAMPLE(_|$)/i.test(title)||/^example[_ ]/i.test(title))errors.push("ئۆرنەك قۇر (EXAMPLE) كىرگۈزۈلمەيدۇ");
  const cat=resolveCategory(sourceRaw||categoryRaw);
  if(!cat)errors.push("تۈر نامەلۇم ياكى بوش — category ياكى source تولدۇرۇڭ");
  const price=parseNumberCell(headerAlias(raw,["price","باھا"]), "price");
  if(!price.ok)errors.push(price.error);
  const stock=parseNumberCell(headerAlias(raw,["stock","ئامبار"]),"stock",{integer:true});
  if(!stock.ok)errors.push(stock.error);
  const pages=Bib.parsePages?Bib.parsePages(headerAlias(raw,["pages","بەت","بەت_سانى"])):parseNumberCell(headerAlias(raw,["pages"]),"pages",{integer:true});
  if(!pages.ok)errors.push(pages.error);
  const year=Bib.parsePublishYear?Bib.parsePublishYear(publishYearRaw):{ok:true,value:publishYearRaw||null,empty:!publishYearRaw};
  if(!year.ok)errors.push(year.error);
  const sales=parseNumberCell(headerAlias(raw,["sales_count","sold_count"]),"sales_count",{integer:true});
  if(!sales.ok)errors.push(sales.error);
  const rec=parseBoolCell(headerAlias(raw,["is_recommended","recommended"]),"is_recommended");
  if(!rec.ok)errors.push(rec.error);
  const neu=parseBoolCell(headerAlias(raw,["is_new","new"]),"is_new");
  if(!neu.ok)errors.push(neu.error);
  const act=parseBoolCell(headerAlias(raw,["is_active","active"]),"is_active");
  if(!act.ok)errors.push(act.error);
  if(isbn&&!isbnLooksValid(isbn))errors.push("ISBN 10 ياكى 13 خانىلىق بولسۇن");
  const allowedStock=["","in_stock","low_stock","out_of_stock","in","low","out"];
  if(stockStatus&&!allowedStock.includes(stockStatus))errors.push("stock_status ئىناۋەتسىز");
  let stock_status=stockStatus;
  if(stock_status==="in")stock_status="in_stock";
  if(stock_status==="low")stock_status="low_stock";
  if(stock_status==="out")stock_status="out_of_stock";
  if(!stock_status)stock_status="in_stock";
  if(headerAlias(raw,["is_bestseller","bestseller"]))warnings.push("is_bestseller ئىمپورت قىلىنمايدۇ؛ كۆپ سېتىلغان sales_count بويىچە ئاپتوماتىك");
  const suppliedId=String(headerAlias(raw,["id","book_id"])).trim();
  if(suppliedId)warnings.push("id ستونى ئىمپورت قىلىنمايدۇ؛ Database identity id ھاسىل قىلىدۇ");
  const legacy_id=String(headerAlias(raw,["legacy_id","legacyid","static_id"])).trim();
  if(legacy_id&&!presentBookCols.has("legacy_id")){
    errors.push("legacy_id ستونى Database دا يوق — STAGE45_LEGACY_ID_MIGRATION.sql نى ئىجرا قىلىڭ");
  }
  nonEmptyIgnoredValues(raw).forEach(col=>warnings.push(`${col} بۇ Database لايىھەسىدە يوق — كىرگۈزۈلمەيدۇ`));
  return {
    row:raw._row,
    title,
    author,
    isbn,
    isbnKey:normalizeIsbn(isbn),
    publisher,
    description,
    image_url:cover,
    translator,
    language,
    publish_year:year.empty?null:year.value,
    source:cat?.source||"",
    category:cat?.category||"",
    price:price.value,
    stock:stock.empty?null:stock.value,
    pages:pages.empty?null:pages.value,
    sales_count:sales.empty?0:sales.value,
    is_recommended:rec.empty?false:rec.value,
    is_new:neu.empty?false:neu.value,
    is_active:act.empty?true:act.value,
    stock_status,
    legacy_id,
    errors,
    warnings,
    status:errors.length?"error":"ok"
  };
}

async function checkAdmin(u){
  const {data,error}=await db.from("admin_users").select("user_id").eq("user_id",u.id).maybeSingle();
  if(error)return false;
  return !!data;
}
async function routeSession(){
  const {data}=await db.auth.getSession();
  const session=data.session;
  if(!session){show("loginPanel");$("#adminLogout").hidden=true;return}
  const ok=await checkAdmin(session.user);
  if(!ok){
    await db.auth.signOut();
    show("loginPanel");
    status($("#loginStatus"),"بۇ ھېسابات Admin تىزىملىكىدە يوق.","error");
    return;
  }
  await detectOptionalGalleryColumn();
  user=session.user;
  $("#adminLogout").hidden=false;
  show("dashboardPanel");
  await Promise.all([loadBooks(),loadMembers(),loadAnalytics(),loadStats()]);
}

function columnList(){
  return "*";
}
function applyListFilters(query){
  if(listFilters.source)query=query.eq("source",listFilters.source);
  if(listFilters.active==="yes")query=query.eq("is_active",true);
  if(listFilters.active==="no")query=query.eq("is_active",false);
  if(listFilters.recommended==="yes")query=query.eq("is_recommended",true);
  if(listFilters.recommended==="no")query=query.eq("is_recommended",false);
  if(listFilters.isNew==="yes")query=query.eq("is_new",true);
  if(listFilters.isNew==="no")query=query.eq("is_new",false);
  if(listFilters.quality){
    if(Quality.applyQualityFilter)query=Quality.applyQualityFilter(query,listFilters.quality);
  }
  const term=searchSafe(listFilters.q);
  if(term){
    query=query.or(searchOrFilter(listFilters.q,isbnColumn));
  }
  const [col,dir]=String(listFilters.sort||"created_at.desc").split(".");
  const allowed={created_at:1,title:1,author:1,price:1,sales_count:1};
  const column=allowed[col]?col:"created_at";
  query=query.order(column,{ascending:dir==="asc",nullsFirst:false}).order("id",{ascending:true});
  return query;
}
function warnMigrationOnce(){
  if(migrationWarned)return;
  migrationWarned=true;
  status($("#adminStatus"),"ISBN ستونى تېخى Database دا يوق. STAGE4_ADMIN_SCALABILITY.sql نى Supabase SQL Editor دا Run قىلىڭ. باشقا Admin ئىقتىدارلىرى داۋاملىشىدۇ.","warn");
}

async function loadStats(){
  if(!db)return;
  try{
    const [all,active,rec]=await Promise.all([
      db.from("books").select("id",{count:"exact",head:true}),
      db.from("books").select("id",{count:"exact",head:true}).eq("is_active",true),
      db.from("books").select("id",{count:"exact",head:true}).eq("is_recommended",true)
    ]);
    if(!all.error)$("#statAll").textContent=all.count??0;
    if(!active.error)$("#statActive").textContent=active.count??0;
    if(!rec.error)$("#statRecommended").textContent=rec.count??0;
    if(presentBookCols.has("stock")){
      const scale=window.KutadguAdminImportScale;
      if(scale&&typeof scale.fetchStockSumRpc==="function"){
        const sum=await scale.fetchStockSumRpc(db);
        $("#statStock").textContent=sum.ok?String(sum.total):"—";
      }else{
        $("#statStock").textContent="—";
      }
    }
    const note=$("#adminCatalogNote");
    if(note){
      const dbCount=Number(all.error?NaN:all.count);
      if(!all.error&&dbCount===0&&STATIC.length){
        note.hidden=false;
        note.textContent=`Database دا ھازىر 0 كىتاب بار. تور بەت ${STATIC.length} دانە static catalog.js كىتابىنى كۆرسىتىدۇ. ئۇلارنى Admin دا تەھرىرلىگىلى بولمايدۇ؛ CSV/Excel ئالدىن كۆرۈش ۋە جەزملەشتىن كېيىنلا Database غا كىرگۈزۈلىدۇ.`;
      }else{
        note.hidden=true;
      }
    }
  }catch(error){
    console.warn(error);
  }
}

async function loadBooks(){
  if(!db)return;
  const req=++listRequest;
  status($("#adminStatus"),"كىتابلار يۈكلىنىۋاتىدۇ...");
  const from=listPage*PAGE_SIZE;
  const to=from+PAGE_SIZE-1;
  let query=db.from("books").select(columnList(),{count:"exact"}).range(from,to);
  query=applyListFilters(query);
  let {data,error,count}=await query;
  if(error){
    const missing=Bib.missingColumnsFromError?Bib.missingColumnsFromError(error):[];
    if(missing.length){
      disableBibColumns(Bib.BIB_OPTIONAL_COLS||missing);
      query=db.from("books").select(columnList(),{count:"exact"}).range(from,to);
      query=applyListFilters(query);
      ({data,error,count}=await query);
    }
  }
  if(req!==listRequest)return;
  if(error){
    status($("#adminStatus"),"Database دىن كىتاب ئوقۇش مەغلۇپ بولدى: "+error.message,"error");
    $("#adminBookList").innerHTML=`<div class="admin-empty">${esc(error.message)}</div>`;
    return;
  }
  books=data||[];
  listTotal=count||0;
  const maxPage=Math.max(0,Math.ceil(listTotal/PAGE_SIZE)-1);
  if(listPage>maxPage){listPage=maxPage;return loadBooks()}
  selectedIds=new Set([...selectedIds].filter(id=>books.some(b=>b.id===id)));
  if(!migrationWarned||isbnColumn){
    status($("#adminStatus"),`Admin كىرىش مۇۋەپپەقىيەتلىك — ${user?.email||""}`,"ok");
  }
  renderBooks();
  renderPager();
  renderSelection();
}

function renderSelection(){
  const el=$("#adminSelectedCount");
  if(el)el.textContent=`تاللانغان: ${selectedIds.size} (پەقەت نۆۋەتتىكى بەت / يۈكلەنگەن نەتىجە)`;
}
function renderPager(){
  const host=$("#adminPager");if(!host)return;
  const pages=Math.max(1,Math.ceil(listTotal/PAGE_SIZE));
  host.innerHTML=`<button type="button" data-page="prev" ${listPage<=0?"disabled":""}>‹</button>
    <span>${listPage+1} / ${pages} · جەمئىي ${listTotal} كىتاب · ھەر بەتتە ${PAGE_SIZE}</span>
    <button type="button" data-page="next" ${listPage>=pages-1?"disabled":""}>›</button>`;
  host.querySelector("[data-page='prev']").onclick=()=>{if(listPage>0){listPage--;loadBooks()}};
  host.querySelector("[data-page='next']").onclick=()=>{if(listPage<pages-1){listPage++;loadBooks()}};
}
function renderBooks(){
  const host=$("#adminBookList");
  if(!books.length){host.innerHTML='<div class="admin-empty">كىتاب تېپىلمىدى.</div>';renderSelection();return}
  host.innerHTML=books.map(b=>`
    <article class="admin-book-row ${b.is_active===false?"admin-hidden-book":""}">
      <input class="admin-book-check" type="checkbox" data-select="${esc(b.id)}" ${selectedIds.has(b.id)?"checked":""} aria-label="تاللاش">
      ${b.image_url?`<img src="${esc(b.image_url)}" alt="${esc(b.title)}" onerror="this.style.visibility='hidden'">`:"<div>📕</div>"}
      <div>
        <div class="admin-book-title">${esc(b.title)}</div>
        <div class="admin-quality-row">${Quality.qualityChipsHtml?Quality.qualityChipsHtml(b,{descriptionSupported:true,isbnSupported:isbnColumn}):""}</div>
        <div class="admin-book-meta">${esc(b.author||"—")} · ${esc(b.category||"")} · ${money(b.price)}${presentBookCols.has("stock")||presentBookCols.has("stock_status")?` · ئامبار ${b.stock==null?"—":Number(b.stock)} · ${b.stock_status==="out_of_stock"?"تۈگەپ كەتتى":b.stock_status==="low_stock"?"ئاز قالدى":"ئامباردا بار"}`:""}</div>
        <div class="admin-book-meta">${b.is_active===false?"🙈 يوشۇرۇلغان":"✅ كۆرۈنىدۇ"} ${b.is_recommended?" · ⭐ تەۋسىيە":""} ${b.is_new?" · 🆕 يېڭى":""} ${Number(b.sales_count)>0?` · 🔥 سېتىلغان ${Number(b.sales_count)}`:""}${b.isbn?` · ISBN <span class="admin-isbn">${esc(b.isbn)}</span>`:""}${b.publisher?` · ${esc(b.publisher)}`:""}</div>
      </div>
      <div class="admin-book-actions">
        <a href="${esc(b.href||`book.html?id=${encodeURIComponent(b.id)}`)}" target="_blank">👁️ كۆرۈش</a>
        <button type="button" data-edit="${esc(b.id)}">✏️ تەھرىرلەش</button>
        <button type="button" data-hide="${esc(b.id)}">${b.is_active===false?"♻️ قايتا كۆرسىتىش":"🙈 يوشۇرۇش"}</button>
        <button type="button" class="admin-danger" data-delete="${esc(b.id)}">🗑️ ئۆچۈرۈش</button>
      </div>
    </article>`).join("");

  host.querySelectorAll("[data-edit]").forEach(btn=>btn.onclick=()=>openEdit(btn.dataset.edit));
  host.querySelectorAll("[data-hide]").forEach(btn=>btn.onclick=()=>toggleActive(btn.dataset.hide));
  host.querySelectorAll("[data-delete]").forEach(btn=>btn.onclick=()=>deleteBook(btn.dataset.delete));
  host.querySelectorAll("[data-select]").forEach(box=>box.onchange=()=>{
    if(box.checked)selectedIds.add(box.dataset.select);else selectedIds.delete(box.dataset.select);
    renderSelection();
  });
  renderSelection();
}
function dateText(value){
  if(!value)return "—";
  const d=new Date(value);if(Number.isNaN(d.getTime()))return "—";
  const two=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-يىلى ${d.getMonth()+1}-ئاينىڭ ${d.getDate()}-كۈنى، ${two(d.getHours())}:${two(d.getMinutes())}`;
}
async function loadMembers(){
  const host=$("#adminMemberList");
  if(host)host.innerHTML='<div class="admin-empty">خېرىدارلار يۈكلىنىۋاتىدۇ...</div>';
  const [profileResult,orderResult]=await Promise.all([
    db.from("profiles").select("*").order("created_at",{ascending:false}),
    db.from("orders").select("user_id,total,status,created_at").order("created_at",{ascending:false})
  ]);
  if(profileResult.error){
    if(host)host.innerHTML=`<div class="admin-empty">خېرىدارلارنى ئوقۇش مەغلۇپ بولدى: ${esc(profileResult.error.message)}<br>SUPABASE_SETUP.sql نى ئىجرا قىلغانلىقىڭىزنى تەكشۈرۈڭ.</div>`;
    return;
  }
  members=(profileResult.data||[]).filter(p=>p.id!==user?.id);
  orders=orderResult.error?[]:(orderResult.data||[]);
  renderMemberStats();
  renderMembers();
}
function renderMemberStats(){
  const memberIds=new Set(members.map(m=>m.id));
  const customerOrders=orders.filter(o=>memberIds.has(o.user_id));
  $("#statMembers").textContent=members.length;
  $("#statVisits").textContent=members.reduce((sum,m)=>sum+(Number(m.visit_count)||0),0).toLocaleString("tr-TR");
  $("#statOrders").textContent=customerOrders.length;
  $("#statRevenue").textContent=money(customerOrders.filter(o=>o.status!=="cancelled").reduce((sum,o)=>sum+(Number(o.total)||0),0));
}
function memberOrderSummary(memberId){
  const list=orders.filter(o=>o.user_id===memberId);
  return {
    count:list.length,
    total:list.filter(o=>o.status!=="cancelled").reduce((sum,o)=>sum+(Number(o.total)||0),0)
  };
}
function renderMembers(){
  const host=$("#adminMemberList");if(!host)return;
  const q=String($("#memberSearch")?.value||"").trim().toLocaleLowerCase("ug");
  const filtered=members.filter(m=>!q||`${m.full_name||""} ${m.email||""} ${m.phone||""} ${m.country||""} ${m.city||""}`.toLocaleLowerCase("ug").includes(q));
  if(!filtered.length){host.innerHTML='<div class="admin-empty">ماس خېرىدار تېپىلمىدى.</div>';return}
  host.innerHTML=filtered.map(m=>{
    const summary=memberOrderSummary(m.id),suspended=m.status==="suspended";
    const contact=[m.phone,m.country,m.city].filter(Boolean).join(" · ")||"قوشۇمچە ئالاقە ئۇچۇرى يوق";
    return `<article class="admin-member-row ${suspended?"is-suspended":""}">
      <div>
        <div class="admin-member-name">${esc(m.full_name||"ئىسمى كىرگۈزۈلمىگەن")}</div>
        <div class="admin-member-email">${esc(m.email||"—")}</div>
        <div class="admin-member-contact">${esc(contact)}</div>
      </div>
      <div class="admin-member-metrics">
        <div class="admin-member-metric"><span>تىزىملاتقان</span><strong>${dateText(m.created_at)}</strong></div>
        <div class="admin-member-metric"><span>ئاخىرقى كىرىش</span><strong>${dateText(m.last_login_at)}</strong></div>
        <div class="admin-member-metric"><span>ئاخىرقى زىيارەت</span><strong>${dateText(m.last_seen_at)}</strong></div>
        <div class="admin-member-metric"><span>زىيارەت / زاكاز</span><strong>${Number(m.visit_count)||0} / ${summary.count} · ${money(summary.total)}</strong></div>
      </div>
      <div class="admin-member-side">
        <span class="admin-member-badge ${suspended?"is-suspended":""}">${suspended?"⛔ توختىتىلغان":"✅ نورمال"}</span>
        <button type="button" class="${suspended?"":"member-suspend"}" data-member-status="${esc(m.id)}" data-next-status="${suspended?"active":"suspended"}">${suspended?"♻️ قايتا ئېچىش":"⛔ توختىتىش"}</button>
      </div>
      <div class="admin-member-last-page">ئاخىرقى بەت: ${esc(m.last_page||"—")}</div>
    </article>`;
  }).join("");
  host.querySelectorAll("[data-member-status]").forEach(btn=>btn.onclick=()=>toggleMemberStatus(btn.dataset.memberStatus,btn.dataset.nextStatus));
}
async function toggleMemberStatus(memberId,nextStatus){
  const member=members.find(m=>m.id===memberId);if(!member)return;
  const label=nextStatus==="suspended"?"توختىتىش":"قايتا ئېچىش";
  if(!confirm(`${member.full_name||member.email||"بۇ خېرىدار"} ھېسابىنى ${label}نى جەزملەشتۈرەمسىز؟`))return;
  const {error}=await db.rpc("set_member_status",{member_id:memberId,new_status:nextStatus});
  if(error){alert("ھېساب ھالىتىنى ئۆزگەرتىش مەغلۇپ بولدى:\n"+error.message);return}
  await loadMembers();
}
function setSaveMode(mode){
  const form=$("#bookForm");
  if(form)form.dataset.saveMode=mode==="edit"?"edit":"create";
  const diag=$("#bookSaveDiag");
  if(diag){
    diag.hidden=true;
    diag.textContent="";
  }
}
function logSavePlan(plan){
  const safe={
    mode:plan&&plan.mode||"",
    editingBookId:plan&&plan.editingBookId||"",
    operation:plan&&plan.operation||""
  };
  console.info("[kutadgu-admin-save]",safe);
  const diag=$("#bookSaveDiag");
  if(diag){
    diag.hidden=false;
    diag.textContent=`mode=${safe.mode} editingBookId=${safe.editingBookId||"—"} operation=${safe.operation}`;
  }
}
function planCurrentSave(){
  const formMode=$("#bookForm")&&$("#bookForm").dataset.saveMode;
  const formId=$("#bookId")?$("#bookId").value:"";
  if(Write.planBookSave)return Write.planBookSave(editing,formId,formMode);
  const editingBookId=canonicalBookId(editing&&editing.id)||canonicalBookId(formId);
  if(formMode==="edit"||editing||editingBookId){
    return {mode:"edit",editingBookId,operation:editingBookId?"UPDATE":"STOP"};
  }
  return {mode:"create",editingBookId:"",operation:"INSERT"};
}
function hideCreateConflict(){
  createConflictAck=false;
  const box=$("#createDuplicateWarning");
  const ack=$("#createDuplicateConfirm");
  if(box)box.hidden=true;
  if(ack)ack.checked=false;
  const list=$("#createDuplicateMatches");
  if(list)list.innerHTML="";
}
function renderCreateConflict(matches){
  const box=$("#createDuplicateWarning");
  const list=$("#createDuplicateMatches");
  const msg=$("#createDuplicateMessage");
  if(!box||!list)return;
  if(msg)msg.textContent=Quality.createDuplicateMessage?Quality.createDuplicateMessage(matches):"بۇ نام ۋە ئاپتور بىلەن ئوخشاش كىتاب بار.";
  list.innerHTML=(matches||[]).map(row=>`<div class="admin-dup-match">
    <strong>id ${esc(row.id)}</strong>
    <span>${esc(row.title||"—")}</span>
    <span>${esc(row.author||"—")}</span>
    <span>${money(row.price)}</span>
    <span>${row.is_active===false?"يوشۇرۇلغان":"كۆرۈنىدۇ"}</span>
  </div>`).join("");
  box.hidden=false;
  const ack=$("#createDuplicateConfirm");
  if(ack)ack.checked=false;
  createConflictAck=false;
}
async function findCreateConflicts({title,author,isbn,excludeId}){
  if(!db)return [];
  const merged=[];
  const t=Quality.normalizeCatalogText?Quality.normalizeCatalogText(title):String(title||"").trim();
  const a=Quality.normalizeCatalogText?Quality.normalizeCatalogText(author):String(author||"").trim();
  if(t&&a){
    const {data,error}=await db.from("books").select("id,title,author,price,is_active,isbn").eq("title",t).eq("author",a).limit(8);
    if(!error&&Quality.mergeConflictRows)merged.push(...Quality.mergeConflictRows(data,"title_author"));
  }
  const isbnN=normalizeIsbn(isbn);
  if(isbnN&&isbnColumn){
    let query=db.from("books").select("id,title,author,price,is_active,isbn").or(`isbn.eq.${isbnN},isbn.eq."${isbnN}"`).limit(8);
    if(excludeId)query=query.neq("id",excludeId);
    const {data,error}=await query;
    if(!error&&Quality.mergeConflictRows){
      Quality.mergeConflictRows(data,"isbn").forEach(row=>{
        const existing=merged.find(x=>String(x.id)===String(row.id));
        if(existing){
          if(!existing.reasons.includes("isbn"))existing.reasons.push("isbn");
        }else merged.push(row);
      });
    }
  }
  if(excludeId)return merged.filter(row=>String(row.id)!==String(excludeId));
  return merged;
}
function clearForm(){
  editing=null;
  hideCreateConflict();
  $("#bookForm").reset();
  setSaveMode("create");
  $("#bookId").value=idForNew();
  $("#bookIsActive").checked=true;
  $("#bookIsNew").checked=false;
  $("#bookIsRecommended").checked=false;
  $("#bookIsbn").value="";
  $("#bookStock").value=0;
  $("#bookStockStatus").value="in_stock";
  $("#bookSalesCount").value=0;
  $("#bookCoverPreview").src="";
  $("#bookCoverPreview").style.visibility="hidden";
  $("#bookCoverText").textContent="يېڭى ھۆججەت تاللانمىسا مۇقاۋا قوشۇلمايدۇ";
  resetGalleryDraft([]);
  $("#bookModalTitle").textContent="➕ يېڭى كىتاب";
}
function openNew(){
  clearForm();
  modal(true);
}
async function fetchBook(id){
  const local=books.find(x=>x.id===id);
  const {data,error}=await db.from("books").select("*").eq("id",id).maybeSingle();
  if(error)throw error;
  return data||local||null;
}
async function openEdit(id){
  let b;
  try{b=await fetchBook(id)}catch(err){alert(err.message||err);return}
  if(!b)return;
  editing=b;
  setSaveMode("edit");
  $("#bookModalTitle").textContent="✏️ كىتابنى تەھرىرلەش";
  $("#bookId").value=b.id;
  $("#bookTitle").value=b.title||"";
  $("#bookAuthor").value=b.author||"";
  $("#bookIsbn").value=b.isbn||"";
  $("#bookPrice").value=b.price??"";
  $("#bookStock").value=b.stock??0;
  $("#bookStockStatus").value=b.stock_status||"in_stock";
  $("#bookSalesCount").value=b.sales_count??0;
  $("#bookSource").value=b.source||"";
  $("#bookPages").value=b.pages??"";
  $("#bookTranslator").value=b.translator||"";
  $("#bookLanguage").value=b.language||"";
  $("#bookPublishDate").value=b.publish_date||"";
  $("#bookPublishYear").value=b.publish_year||"";
  $("#bookPublisher").value=b.publisher||"";
  $("#bookCoverType").value=b.cover_type||"";
  $("#bookDimensions").value=b.dimensions||"";
  $("#bookDescription").value=b.description||"";
  $("#bookIsActive").checked=b.is_active!==false;
  $("#bookIsNew").checked=b.is_new===true;
  $("#bookIsRecommended").checked=b.is_recommended===true;
  $("#bookCoverPreview").src=b.image_url||"";
  $("#bookCoverPreview").style.visibility=b.image_url?"visible":"hidden";
  $("#bookCoverText").textContent=b.image_url?"ھازىرقى مۇقاۋا — يېڭى ھۆججەت تاللانمىسا ئۆزگەرمەيدۇ":"مۇقاۋا يوق";
  hideCreateConflict();
  resetGalleryDraft(normalizeGalleryField(b.gallery_images,b.image_url));
  modal(true);
  logSavePlan(planCurrentSave());
}
async function detectOptionalGalleryColumn(){
  if(!db)return;
  const {error}=await db.from("books").select("gallery_images").limit(1);
  const missing=!!error&&(error.code==="42703"||/gallery_images/.test(String(error.message||"")));
  if(missing)presentBookCols.delete("gallery_images");
  else if(!error)presentBookCols.add("gallery_images");
  document.querySelectorAll('[data-book-col="gallery_images"]').forEach(el=>{
    el.hidden=!presentBookCols.has("gallery_images");
  });
}
function galleryLib(){
  return window.KutadguGallery||{};
}
function normalizeGalleryField(value,coverUrl){
  const fn=galleryLib().normalizeGalleryImages;
  if(fn)return fn(value,{coverUrl,max:galleryLib().MAX_GALLERY_IMAGES||4});
  if(!Array.isArray(value))return [];
  return value.map(v=>String(v||"").trim()).filter(Boolean).slice(0,4);
}
function resetGalleryDraft(urls){
  galleryDraft=(urls||[]).map(url=>({url,file:null,preview:url}));
  const input=$("#bookGallery");
  if(input)input.value="";
  renderGalleryDraft();
}
function renderGalleryDraft(){
  const host=$("#bookGalleryList");
  const statusEl=$("#bookGalleryStatus");
  const max=galleryLib().MAX_GALLERY_IMAGES||4;
  if(statusEl){
    statusEl.textContent=galleryDraft.length
      ?`${galleryDraft.length} / ${max} قوشۇمچە رەسىم`
      :"ھازىرچە قوشۇمچە رەسىم يوق.";
  }
  if(!host)return;
  host.innerHTML=galleryDraft.map((item,index)=>`<article class="admin-gallery-item">
      <img src="${esc(item.preview||item.url||"")}" alt="قوشۇمچە رەسىم ${index+1}">
      <div class="admin-gallery-item-actions">
        <button type="button" data-gallery-up="${index}" ${index===0?"disabled":""}>↑</button>
        <button type="button" data-gallery-down="${index}" ${index===galleryDraft.length-1?"disabled":""}>↓</button>
        <button type="button" class="admin-danger" data-gallery-remove="${index}">ئۆچۈرۈش</button>
      </div>
    </article>`).join("");
  host.querySelectorAll("[data-gallery-remove]").forEach(btn=>btn.onclick=()=>{
    const i=Number(btn.dataset.galleryRemove);
    galleryDraft.splice(i,1);
    renderGalleryDraft();
  });
  host.querySelectorAll("[data-gallery-up]").forEach(btn=>btn.onclick=()=>{
    const i=Number(btn.dataset.galleryUp);
    if(i<=0)return;
    const swap=galleryDraft[i-1];galleryDraft[i-1]=galleryDraft[i];galleryDraft[i]=swap;
    renderGalleryDraft();
  });
  host.querySelectorAll("[data-gallery-down]").forEach(btn=>btn.onclick=()=>{
    const i=Number(btn.dataset.galleryDown);
    if(i>=galleryDraft.length-1)return;
    const swap=galleryDraft[i+1];galleryDraft[i+1]=galleryDraft[i];galleryDraft[i]=swap;
    renderGalleryDraft();
  });
}
async function readMagicMime(file){
  const sniff=galleryLib().sniffImageMime;
  if(!sniff||!file?.slice)return "";
  try{
    const buf=new Uint8Array(await file.slice(0,16).arrayBuffer());
    return sniff(buf);
  }catch(e){return ""}
}
async function addGalleryFiles(fileList){
  const files=[...fileList||[]];
  const max=galleryLib().MAX_GALLERY_IMAGES||4;
  const maxBytes=galleryLib().MAX_GALLERY_BYTES||8*1024*1024;
  const plan=(galleryLib().planGallerySelection||((c,n,m)=>{
    const room=Math.max(0,(m||4)-c);return {ok:n<=room,take:Math.min(n,room),skipped:Math.max(0,n-room)};
  }))(galleryDraft.length,files.length,max);
  if(!plan.take){
    alert(`ئەڭ كۆپ ${max} دانە قوشۇمچە رەسىم قوشقىلى بولىدۇ.`);
    return;
  }
  if(!plan.ok){
    alert(`ئەڭ كۆپ ${max} دانە قوشۇمچە رەسىم. پەقەت ${plan.take} دانىسى قوشۇلدى.`);
  }
  const chosen=files.slice(0,plan.take);
  for(const file of chosen){
    const magic=await readMagicMime(file);
    const mime=magic||String(file.type||"").toLowerCase();
    if(!(galleryLib().isAllowedGalleryMime||(t=>String(t||"").startsWith("image/")&&t!=="image/svg+xml"))(mime)){
      alert(`«${file.name}» رەسىم ھۆججىتى ئەمەس. JPEG / PNG / WebP / GIF قوبۇل قىلىنىدۇ.`);
      continue;
    }
    if(file.size>maxBytes){
      alert(`«${file.name}» بەك چوڭ (ئەڭ چوڭ 8MB).`);
      continue;
    }
    galleryDraft.push({url:"",file,preview:URL.createObjectURL(file)});
  }
  renderGalleryDraft();
}
async function optimizeGalleryImage(file){
  if(!file||!String(file.type||"").startsWith("image/"))return file;
  try{
    const type=String(file.type||"").toLowerCase();
    if(type==="image/gif")return file;
    let bitmap;
    try{bitmap=await createImageBitmap(file,{imageOrientation:"none"})}
    catch(e){bitmap=await createImageBitmap(file)}
    const maxEdge=2400;
    const scale=Math.min(1,maxEdge/Math.max(bitmap.width,bitmap.height));
    if(scale>=1&&file.size<=2*1024*1024){
      bitmap.close?.();
      return file;
    }
    const width=Math.max(1,Math.round(bitmap.width*scale));
    const height=Math.max(1,Math.round(bitmap.height*scale));
    const canvas=document.createElement("canvas");
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext("2d",{alpha:type!=="image/jpeg"});
    ctx.drawImage(bitmap,0,0,width,height);bitmap.close?.();
    const outType=type==="image/png"?"image/png":(type==="image/webp"?"image/webp":"image/jpeg");
    const quality=outType==="image/png"?undefined:0.88;
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,outType,quality));
    if(!blob)return file;
    const ext=outType==="image/png"?"png":outType==="image/webp"?"webp":"jpg";
    return new File([blob],`${(file.name||"page").replace(/\.[^.]+$/,"")}.${ext}`,{type:outType});
  }catch(error){console.warn("Gallery optimization skipped",error)}
  return file;
}
function storageToken(id){
  return String(id||"book").replace(/[^a-zA-Z0-9._-]/g,"-").slice(0,80)||"book";
}
async function uploadGalleryFile(id,file){
  const bucket=cfg.bucket||"book-covers";
  const optimized=await optimizeGalleryImage(file);
  const ext=(optimized.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
  const path=`${storageToken(id)}/gallery/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
  const {error}=await db.storage.from(bucket).upload(path,optimized,{upsert:false,contentType:optimized.type||undefined});
  if(error)throw error;
  const {data}=db.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
async function collectGalleryUrls(id){
  if(!presentBookCols.has("gallery_images"))return [];
  const urls=[];
  for(const item of galleryDraft){
    if(item.file)urls.push(await uploadGalleryFile(id,item.file));
    else if(item.url)urls.push(item.url);
  }
  return urls;
}

async function optimizeCover(file){
  if(!file||!String(file.type||"").startsWith("image/"))return file;
  try{
    const bitmap=await createImageBitmap(file);
    const maxWidth=1000,scale=Math.min(1,maxWidth/bitmap.width);
    const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
    const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext("2d",{alpha:false});ctx.drawImage(bitmap,0,0,width,height);bitmap.close?.();
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",0.82));
    if(blob&&blob.size<file.size)return new File([blob],`${file.name.replace(/\.[^.]+$/,'')||'cover'}.webp`,{type:"image/webp"});
  }catch(error){console.warn("Cover optimization skipped",error)}
  return file;
}
async function uploadCover(id,file){
  if(!file)return editing?.image_url||"";
  const bucket=cfg.bucket||"book-covers";
  const optimized=await optimizeCover(file);
  const ext=(optimized.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
  const path=`${id}/${Date.now()}.${ext}`;
  const {error}=await db.storage.from(bucket).upload(path,optimized,{upsert:false,contentType:optimized.type||undefined});
  if(error)throw error;
  const {data}=db.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
async function persistBookRow(payload,operation,editingBookId){
  const op=Write.enforcePersistOperation?Write.enforcePersistOperation(operation,editingBookId):(canonicalBookId(editingBookId)?"UPDATE":(operation==="UPDATE"?"STOP":"INSERT"));
  logSavePlan({mode:op==="INSERT"?"create":"edit",editingBookId:canonicalBookId(editingBookId),operation:op});
  if(op==="STOP"){
    return {error:new Error("تەھرىرلەش ئۈچۈن كىتاب ID تېپىلمىدى. يېڭى قۇر قوشۇلمايدۇ.")};
  }
  if(op==="UPDATE"){
    const {data,error}=await db.from("books").update(payload).eq("id",editingBookId).select("id");
    if(error)return {error};
    if(!Array.isArray(data)||data.length!==1){
      return {error:new Error("بۇ كىتاب يېڭىلانمىدى. يېڭى قۇر قوشۇلمىدى.")};
    }
    return {error:null,data};
  }
  if(canonicalBookId(editingBookId)){
    return {error:new Error("CREATE cannot INSERT while a canonical book id is present.")};
  }
  const insertPayload={...payload};
  delete insertPayload.id;
  return db.from("books").insert(insertPayload).select("id");
}
async function saveBook(e){
  e.preventDefault();
  if(saveInFlight)return;
  const source=$("#bookSource").value;
  if(!source){alert("كىتاب تۈرىنى تاللاڭ.");return}
  const isbn=formatIsbn($("#bookIsbn").value);
  if(isbn&&!isbnLooksValid(isbn)){alert("ISBN 10 ياكى 13 خانىلىق بولسۇن (بوش قالدۇرۇشقا بولىدۇ).");return}
  const year=Bib.parsePublishYear?Bib.parsePublishYear($("#bookPublishYear").value):{ok:true,value:$("#bookPublishYear").value.trim()||null};
  if(!year.ok){alert(year.error);return}
  const pages=Bib.parsePages?Bib.parsePages($("#bookPages").value):{ok:true,value:$("#bookPages").value===""?null:Number($("#bookPages").value)};
  if(!pages.ok){alert(pages.error);return}
  const title=Quality.normalizeCatalogText?Quality.normalizeCatalogText($("#bookTitle").value):$("#bookTitle").value.trim();
  if(!title){alert("كىتاب ئىسمى كېرەك.");return}
  const plan=planCurrentSave();
  logSavePlan(plan);
  if(plan.operation==="STOP"||(Write.editMustStop&&Write.editMustStop(editing,$("#bookId").value,$("#bookForm")&&$("#bookForm").dataset.saveMode))){
    alert("تەھرىرلەش ئۈچۈن كىتاب ID تېپىلمىدى. يېڭى قۇر قوشۇلمايدۇ.");
    return;
  }
  const isEdit=plan.operation==="UPDATE";
  const editingBookId=plan.editingBookId;
  const author=Quality.normalizeCatalogText?Quality.normalizeCatalogText($("#bookAuthor").value):$("#bookAuthor").value.trim();
  const submit=$("#bookForm button[type='submit']");
  saveInFlight=true;
  submit.disabled=true;
  submit.textContent="ساقلىنىۋاتىدۇ...";
  try{
    if(!Quality.shouldSkipCreateDuplicateCheck||!Quality.shouldSkipCreateDuplicateCheck(plan.operation)){
      const matches=await findCreateConflicts({title,author,isbn,excludeId:""});
      if(Quality.shouldWarnCreateDuplicates(plan.operation,matches)&&!createConflictAck){
        renderCreateConflict(matches);
        saveInFlight=false;
        submit.disabled=false;
        submit.textContent="💾 ساقلاش";
        return;
      }
    }else if(isbn){
      const isbnHits=await findCreateConflicts({title:"",author:"",isbn,excludeId:editingBookId});
      const isbnOnly=isbnHits.filter(row=>(row.reasons||[]).includes("isbn"));
      if(isbnOnly.length&&!createConflictAck){
        renderCreateConflict(isbnOnly);
        saveInFlight=false;
        submit.disabled=false;
        submit.textContent="💾 ساقلاش";
        return;
      }
    }
    const storageId=isEdit?editingBookId:(canonicalBookId($("#bookId").value)||"book");
    const imageUrl=await uploadCover(storageId,$("#bookCover").files[0]);
    const galleryUrls=await collectGalleryUrls(storageId);
    const row={
      title,
      author,
      price:$("#bookPrice").value===""?null:Number($("#bookPrice").value),
      category:sourceCategory(source),
      source,
      image_url:imageUrl,
      href:editing?.href||(isEdit?`book.html?id=${encodeURIComponent(editingBookId)}`:""),
      pages:pages.value,
      translator:$("#bookTranslator").value.trim()||null,
      language:$("#bookLanguage").value.trim(),
      publish_date:$("#bookPublishDate").value.trim(),
      publish_year:year.value,
      publisher:$("#bookPublisher").value.trim()||null,
      cover_type:$("#bookCoverType").value.trim(),
      dimensions:$("#bookDimensions").value.trim(),
      description:$("#bookDescription").value.trim(),
      stock:Number($("#bookStock").value)||0,
      stock_status:$("#bookStockStatus").value,
      sales_count:Number($("#bookSalesCount").value)||0,
      is_active:$("#bookIsActive").checked,
      is_new:$("#bookIsNew").checked,
      is_recommended:$("#bookIsRecommended").checked
    };
    if(presentBookCols.has("gallery_images"))row.gallery_images=normalizeGalleryField(galleryUrls,imageUrl);
    if(isbnColumn)row.isbn=isbn;
    let payload=writeBookRow(row,{mode:isEdit?"update":"insert",omitId:!isEdit});
    if(isEdit&&Write.stripIdentityFields)payload=Write.stripIdentityFields(payload);
    let {error}=await persistBookRow(payload,plan.operation,editingBookId);
    if(error&&generatedIdError(error)&&plan.operation==="INSERT"){
      generatedAlwaysId=true;
      payload=writeBookRow(row,{omitId:true,mode:"insert"});
      ({error}=await persistBookRow(payload,"INSERT",""));
    }
    if(error&&/gallery_images/.test(String(error.message||""))){
      presentBookCols.delete("gallery_images");
      delete payload.gallery_images;
      ({error}=await persistBookRow(payload,plan.operation,editingBookId));
    }
    const bibMissing=Bib.missingColumnsFromError?Bib.missingColumnsFromError(error):[];
    if(error&&bibMissing.length){
      const cols=Bib.BIB_OPTIONAL_COLS||bibMissing;
      disableBibColumns(cols);
      cols.forEach(col=>delete payload[col]);
      ({error}=await persistBookRow(payload,plan.operation,editingBookId));
      if(!error){
        alert("تەرجىمان / نەشرىيات / نەشر يىلى / بەت سانى ستونى تېخى Database دا يوق. STAGE61_BIBLIOGRAPHIC_METADATA.sql نى Supabase SQL Editor دا Run قىلىڭ. باشقا مەيدانلار ساقلاندى.");
      }
    }
    if(error)throw error;
    modal(false);
    await Promise.all([loadBooks(),loadStats()]);
  }catch(err){
    alert("ساقلاش مەغلۇپ بولدى:\n"+(err.message||err));
  }finally{
    saveInFlight=false;
    submit.disabled=false;
    submit.textContent="💾 ساقلاش";
  }
}
async function toggleActive(id){
  const b=await fetchBook(id).catch(()=>null);if(!b)return;
  const next=b.is_active===false;
  const {error}=await db.from("books").update({is_active:next}).eq("id",id);
  if(error){alert(error.message);return}
  await Promise.all([loadBooks(),loadStats()]);
}
async function deleteBook(id){
  const b=await fetchBook(id).catch(()=>null);if(!b)return;
  if(!confirm(`«${b.title||id}» نى Database دىن پۈتۈنلەي ئۆچۈرەمسىز؟\nبۇ مەشغۇلاتنى قايتۇرغىلى بولمايدۇ.`))return;
  const {error}=await db.from("books").delete().eq("id",id);
  if(error){alert("ئۆچۈرۈش مەغلۇپ بولدى:\n"+error.message);return}
  selectedIds.delete(id);
  await Promise.all([loadBooks(),loadStats()]);
}
async function importStatic(){
  if(generatedAlwaysId){
    alert("بۇ Database دا كىتاب id نى ئۆزى ھاسىل قىلىدۇ. static catalog نى بىۋاسىتە ID بىلەن يازغىلى بولمايدۇ. CSV/Excel ئالدىن كۆرۈش ئارقىلىق كىرگۈزۈڭ.");
    return;
  }
  if(!STATIC.length)return;
  if(!confirm(`ھازىرقى ${STATIC.length} دانە كىتابنى Database قا كىرگۈزەمسىز؟\nبار بولغان ID لار يېڭىلىنىدۇ.`))return;
  const btn=$("#importStaticBtn");
  btn.disabled=true;btn.textContent="كىرگۈزۈلۈۋاتىدۇ...";
  try{
    const rows=STATIC.map(b=>({
      id:b.id,
      title:b.title,
      author:b.author||"",
      price:b.price??null,
      category:b.category||"",
      source:b.source||"universal.html",
      image_url:b.image||"",
      href:b.href||`book.html?id=${encodeURIComponent(b.id)}`,
      is_active:true,
      is_new:false,
      is_recommended:false,
      sales_count:0,
      stock:0,
      stock_status:"in_stock"
    }));
    for(let i=0;i<rows.length;i+=IMPORT_BATCH){
      const chunk=rows.slice(i,i+IMPORT_BATCH).map(writeBookRow);
      const {error}=await db.from("books").upsert(chunk,{onConflict:"id"});
      if(error)throw error;
    }
    await Promise.all([loadBooks(),loadStats()]);
    alert("ھازىرقى كىتابلار Database قا مۇۋەپپەقىيەتلىك كىرگۈزۈلدى ✅");
  }catch(err){
    alert("كىرگۈزۈش مەغلۇپ بولدى:\n"+(err.message||err));
  }finally{
    btn.disabled=false;btn.textContent="📥 ھازىرقى كىتابلارنى Database قا كىرگۈزۈش";
  }
}

function selectedIdList(){
  return [...new Set([...selectedIds].map(id=>String(id||"").trim()).filter(Boolean))];
}
function assertSelectedIds(ids){
  if(!Array.isArray(ids)||ids.length===0){
    throw new Error("NO_SELECTED_IDS");
  }
  if(ids.length>PAGE_SIZE){
    throw new Error("SELECTED_IDS_EXCEED_PAGE");
  }
}
function updateBulkValueUi(){
  const action=$("#bulkAction").value;
  const sel=$("#bulkValueSelect"),inp=$("#bulkValueInput");
  sel.hidden=true;inp.hidden=true;sel.innerHTML="";inp.value="";
  if(action==="category"){
    sel.hidden=false;
    sel.innerHTML=categoryOptions().map(([source,cat])=>`<option value="${esc(source)}">${esc(cat)}</option>`).join("");
  }else if(action==="stock_status"){
    sel.hidden=false;
    sel.innerHTML='<option value="in_stock">ئامباردا بار</option><option value="low_stock">ئاز قالدى</option><option value="out_of_stock">تۈگەپ كەتتى</option>';
  }else if(action==="stock"){
    inp.hidden=false;inp.type="number";inp.min="0";inp.placeholder="ئامبار سانى";
  }else if(action==="publisher"){
    inp.hidden=false;inp.type="text";inp.placeholder="نەشرىيات";
  }
}
async function applyBulk(){
  const ids=selectedIdList();
  const action=$("#bulkAction").value;
  if(!ids.length){alert("ئالدى بىلەن نۆۋەتتىكى بەتتىن كىتاب تاللاڭ.");return}
  if(!action){alert("توپلام مەشغۇلات تاللاڭ.");return}
  let patch=null,label=action;
  if(action==="category"){
    const source=$("#bulkValueSelect").value;
    if(!source){alert("تۈر تاللاڭ.");return}
    patch={source,category:sourceCategory(source)};
    label=`تۈرنى «${sourceCategory(source)}» قىلىش`;
  }else if(action==="stock_status"){
    patch={stock_status:$("#bulkValueSelect").value};
    label="ئامبار ھالىتىنى ئۆزگەرتىش";
  }else if(action==="stock"){
    const n=Number($("#bulkValueInput").value);
    if(!Number.isInteger(n)||n<0){alert("ئامبار سانى توغرا پۈتۈن سان بولسۇن.");return}
    patch={stock:n};
    label=`ئامبار سانىنى ${n} قىلىش`;
  }else if(action==="publisher"){
    patch={publisher:$("#bulkValueInput").value.trim()};
    label="نەشرىياتنى ئۆزگەرتىش";
  }else if(action==="recommended_on"){patch={is_recommended:true};label="تەۋسىيە قىلىش"}
  else if(action==="recommended_off"){patch={is_recommended:false};label="تەۋسىيەنى ئېلىش"}
  else if(action==="new_on"){patch={is_new:true};label="يېڭى بەلگىسى قويۇش"}
  else if(action==="new_off"){patch={is_new:false};label="يېڭى بەلگىسىنى ئېلىش"}
  else if(action==="activate"){patch={is_active:true};label="كۆرسىتىش"}
  else if(action==="deactivate"){patch={is_active:false};label="يوشۇرۇش"}
  if(!patch)return;
  const missingPatch=Object.keys(patch).filter(k=>OPTIONAL_BOOK_COLS.includes(k)&&!presentBookCols.has(k));
  if(missingPatch.length){
    alert("بۇ توپلام مەشغۇلات بۇ Database لايىھەسىدە يوق ستونغا يېزىلىدۇ: "+missingPatch.join(", "));
    return;
  }
  if(!confirm(`تاللانغان ${ids.length} دانە كىتابقا «${label}» قىلامسىز؟\nپەقەت تاللانغان ID لار يېڭىلىنىدۇ.`))return;
  try{assertSelectedIds(ids)}catch(err){alert("توپلام يېڭىلاش توختىتىلدى: تاللانغان ID يوق ياكى بەت چېكىدىن ئېشىپ كەتتى.");return}
  const {error}=await db.from("books").update(patch).in("id",ids);
  if(error){alert("توپلام يېڭىلاش مەغلۇپ بولدى:\n"+error.message);return}
  selectedIds.clear();
  await Promise.all([loadBooks(),loadStats()]);
  alert(`${ids.length} دانە كىتاب يېڭىلاندى ✅`);
}

async function loadAnalytics(){
  const hostTop=$("#analyticsTopBooks"),hostZero=$("#analyticsZeroSearches");
  const hostCart=$("#analyticsTopCart"),hostWa=$("#analyticsTopWhatsapp"),hostSearch=$("#analyticsTopSearches");
  if(!db||!hostTop||!hostZero)return;
  const days=Math.max(1,Number($("#analyticsRange")?.value)||30);
  const loading='<div class="admin-empty">يۈكلىنىۋاتىدۇ...</div>';
  [hostTop,hostZero,hostCart,hostWa,hostSearch].forEach(el=>{if(el)el.innerHTML=loading});
  const {data,error}=await db.rpc("get_kutadgu_analytics",{p_days:days});
  if(error){
    const msg='Analytics نى ئوقۇش مەغلۇپ بولدى: '+esc(error.message)+'<br>STAGE8_STORE_ANALYTICS.sql نى Supabase SQL Editor دا بىر قېتىم Run قىلىڭ (ئالدىن STAGE4_ANALYTICS_RPC_FIX.sql).';
    [hostTop,hostZero,hostCart,hostWa,hostSearch].forEach(el=>{if(el)el.innerHTML=`<div class="admin-empty">${msg}</div>`});
    return;
  }
  const summary=data||{};
  const Core=window.KutadguAnalyticsCore;
  const funnel=summary.funnel&&typeof summary.funnel==="object"
    ?summary.funnel
    :(Core&&Core.funnelFromCounts?Core.funnelFromCounts(summary):{
      views:Number(summary.book_views||0),
      cart_adds:Number(summary.cart_adds||0),
      whatsapp_clicks:Number(summary.whatsapp_clicks||0)
    });
  $("#analyticsPageViews").textContent=Number(summary.page_views||0).toLocaleString("tr-TR");
  $("#analyticsBookViews").textContent=Number(summary.book_views||0).toLocaleString("tr-TR");
  $("#analyticsCartAdds").textContent=Number(summary.cart_adds||0).toLocaleString("tr-TR");
  $("#analyticsWhatsapp").textContent=Number(summary.whatsapp_clicks||0).toLocaleString("tr-TR");
  const zeroEl=$("#analyticsZeroSearchesCount");
  if(zeroEl)zeroEl.textContent=Number(summary.zero_result_searches||0).toLocaleString("tr-TR");
  const fmtPct=value=>{
    if(value===null||value===undefined||value==="")return "";
    return ` · ${Number(value).toLocaleString("tr-TR")}%`;
  };
  const funnelHost=$("#analyticsFunnelSteps");
  if(funnelHost){
    funnelHost.innerHTML=`
      <div class="admin-analytics-funnel-step"><span>1. كىتاب كۆرۈش</span><strong>${Number(funnel.views||0).toLocaleString("tr-TR")}</strong></div>
      <div class="admin-analytics-funnel-step"><span>2. سېۋەتكە قوشۇش${fmtPct(funnel.view_to_cart_pct)}</span><strong>${Number(funnel.cart_adds||0).toLocaleString("tr-TR")}</strong></div>
      <div class="admin-analytics-funnel-step"><span>3. WhatsApp زاكاز چېكىش (مەقسەت)${fmtPct(funnel.view_to_whatsapp_pct)}${funnel.cart_to_whatsapp_pct!=null?` · سېۋەتتىن ${Number(funnel.cart_to_whatsapp_pct).toLocaleString("tr-TR")}%`:""}</span><strong>${Number(funnel.whatsapp_clicks||0).toLocaleString("tr-TR")}</strong></div>`;
  }
  const list=(rows,countKey,emptyText)=>rows.length?rows.map((row,i)=>`<div class="admin-analytics-row"><span>${i+1}. ${esc(row.title||row.query||row.book_id||"—")}</span><strong>${Number(row[countKey]||row.views||row.adds||row.clicks||row.searches||0)}</strong></div>`).join(""):`<div class="admin-empty">${emptyText}</div>`;
  const top=Array.isArray(summary.top_books)?summary.top_books:[];
  hostTop.innerHTML=list(top,"views","بۇ ۋاقىت دائىرىسىدە كىتاب كۆرۈش سانلىق مەلۇماتى يوق.");
  if(hostCart)hostCart.innerHTML=list(Array.isArray(summary.top_cart_books)?summary.top_cart_books:[],"adds","سېۋەتكە قوشۇش سانلىق مەلۇماتى يوق.");
  if(hostWa)hostWa.innerHTML=list(Array.isArray(summary.top_whatsapp_books)?summary.top_whatsapp_books:[],"clicks","WhatsApp چېكىش سانلىق مەلۇماتى يوق.");
  if(hostSearch)hostSearch.innerHTML=list(Array.isArray(summary.top_searches)?summary.top_searches:[],"searches","ئىزدەش سانلىق مەلۇماتى يوق.");
  const zeros=Array.isArray(summary.zero_searches)?summary.zero_searches:[];
  hostZero.innerHTML=list(zeros,"searches","نەتىجىسىز ئىزدەش يوق.");
}

async function requestPasswordReset(){
  const email=$("#adminEmail").value.trim();
  if(!email){
    status($("#loginStatus"),"ئاۋۋال Email ئادرېسىڭىزنى كىرگۈزۈڭ.","warn");
    $("#adminEmail").focus();
    return;
  }
  status($("#loginStatus"),"پارول يېڭىلاش ئۇلانمىسى ئەۋەتىلىۋاتىدۇ...");
  const redirectTo=(window.kutadguPasswordResetRedirectTo||function(){
    return `${String(window.KUTADGU_SITE_ORIGIN||location.origin).replace(/\/+$/,"")}/reset-password.html?next=admin`;
  })("admin");
  const {error}=await db.auth.resetPasswordForEmail(email,{redirectTo});
  if(error){
    status($("#loginStatus"),"ئۇلانما ئەۋەتىش مەغلۇپ بولدى: "+error.message,"error");
    return;
  }
  status($("#loginStatus"),"✅ پارول يېڭىلاش ئۇلانمىسى Email غا ئەۋەتىلدى. Email دىكى ئۇلانمىنى بېسىڭ.","ok");
}

async function login(e){
  e.preventDefault();
  const email=$("#adminEmail").value.trim();
  const password=$("#adminPassword").value;
  status($("#loginStatus"),"كىرىۋاتىدۇ...");
  const {error}=await db.auth.signInWithPassword({email,password});
  if(error){status($("#loginStatus"),"كىرىش مەغلۇپ بولدى: "+error.message,"error");return}
  await routeSession();
}
async function logout(){await db.auth.signOut();user=null;show("loginPanel");$("#adminLogout").hidden=true}

function openImport(){
  importRows=[];
  importRunning=false;
  $("#importFile").value="";
  $("#importPreviewWrap").hidden=true;
  $("#importProgress").hidden=true;
  $("#confirmImportBtn").disabled=true;
  const ignoreNote=$("#importUnsupportedNote");
  if(ignoreNote){ignoreNote.hidden=true;ignoreNote.textContent=""}
  status($("#importStatus"),"CSV ياكى Excel (.xlsx) تاللاڭ.");
  $("#importModal").hidden=false;
}
function closeImport(){
  if(importRunning)return;
  $("#importModal").hidden=true;
  importRows=[];
}

function loadScript(src,attrs={}){
  return new Promise((resolve,reject)=>{
    const s=document.createElement("script");
    s.src=src;s.async=true;
    if(attrs.integrity){
      s.integrity=attrs.integrity;
      s.crossOrigin=attrs.crossOrigin||"anonymous";
    }
    s.onload=()=>resolve();
    s.onerror=()=>reject(new Error("Excel كۈتۈپخانىسى يۈكلەنمىدى"));
    document.head.appendChild(s);
  });
}
async function ensureXlsx(){
  if(window.XLSX)return window.XLSX;
  if(!xlsxLoading){
    xlsxLoading=loadScript(
      "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
      {integrity:"sha512-r22gChDnGvBylk90+2e/ycr3RVrDi8DIOkIGNhJlKfuyQM4tIRAI062MaV8sfjQKYVGjOBaZBOA87z+IhZE9DA==",crossOrigin:"anonymous"}
    );
  }
  await xlsxLoading;
  if(!window.XLSX)throw new Error("XLSX parser يوق");
  return window.XLSX;
}

async function parseImportFile(file){
  const name=String(file.name||"").toLowerCase();
  if(name.endsWith(".xlsx")||file.type.includes("spreadsheet")){
    const XLSX=await ensureXlsx();
    const buf=await file.arrayBuffer();
    const wb=XLSX.read(buf,{type:"array"});
    const sheet=wb.Sheets[wb.SheetNames[0]];
    if(!sheet)throw new Error("Excel ھۆججەتتە ۋاراق يوق");
    const rows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,defval:""});
    return rowsToObjects(rows.map(r=>(r||[]).map(c=>c==null?"":String(c))));
  }
  const text=await file.text();
  return rowsToObjects(parseCsvText(text));
}

function titleAuthorKey(title,author){
  return `${String(title||"").trim().toLocaleLowerCase("ug")}|||${String(author||"").trim().toLocaleLowerCase("ug")}`;
}

async function loadExistingForImport(mapped){
  const scale=window.KutadguAdminImportScale;
  if(!scale||typeof scale.loadExistingForImport!=="function"){
    throw new Error("admin-import-scale.js missing");
  }
  return scale.loadExistingForImport(db,mapped,{
    isbnColumn,
    hasLegacy:presentBookCols.has("legacy_id"),
    normalizeIsbn,
    titleAuthorKey
  });
}

async function buildImportPreview(file){
  status($("#importStatus"),"ھۆججەت تەھلىل قىلىنىۋاتىدۇ...");
  $("#confirmImportBtn").disabled=true;
  let objects;
  try{
    objects=await parseImportFile(file);
  }catch(err){
    status($("#importStatus"),"ھۆججەتنى ئوقۇش مەغلۇپ بولدى: "+(err.message||err),"error");
    importRows=[];
    return;
  }
  if(!objects.length){
    status($("#importStatus"),"ھۆججەتتە ئىمپورت قىلىدىغان قۇر يوق ياكى ستون ماۋزۇسى تونۇلمىدى.","error");
    importRows=[];
    return;
  }
  const mapped=objects.map(mapImportRow);
  const seenIsbn=new Map();
  const seenLegacy=new Map();
  mapped.forEach(row=>{
    if(row.isbnKey){
      if(seenIsbn.has(row.isbnKey))row.errors.push("ئەسىلى ھۆججەت ئىچىدە ئوخشاش ISBN تەكرار");
      else seenIsbn.set(row.isbnKey,row.row);
    }
    if(row.legacy_id){
      if(seenLegacy.has(row.legacy_id))row.errors.push("ئەسىلى ھۆججەت ئىچىدە ئوخشاش legacy_id تەكرار — قاپلىمايمىز");
      else seenLegacy.set(row.legacy_id,row.row);
    }
  });
  try{
    const {existingIsbn,existingTitle,existingLegacy}=await loadExistingForImport(mapped);
    mapped.forEach(row=>{
      if(row.legacy_id&&existingLegacy.has(row.legacy_id)){
        const match=existingLegacy.get(row.legacy_id);
        row.errors.push(`legacy_id مەۋجۇت كىتابقا تەكرار (${match.id}) — قاپلىمايمىز`);
      }
      if(row.isbnKey&&existingIsbn.has(row.isbnKey)){
        const matches=existingIsbn.get(row.isbnKey)||[];
        row.isbnMatchCount=matches.length;
        if(matches.length===1){
          row.dbMatch=matches[0];
          row.duplicate="isbn";
          row.warnings.push(`ISBN مەۋجۇت بىر كىتابقا ماس كېلىدۇ (${row.dbMatch.id})`);
        }else{
          row.errors.push(`ISBN ${matches.length} كىتابقا ماس كەلدى؛ يېڭىلاش/ئاپتوماتىك ماسلاشتۇرۇش رۇخسەت قىلىنمايدۇ`);
        }
      }else{
        const t=existingTitle.get(titleAuthorKey(row.title,row.author));
        if(t){
          row.titleMatch=t;
          row.warnings.push(`ئىسىم+ئاپتور ئوخشاش كىتاب بار، ISBN يوق/پەرقلىق — ئاپتوماتىك قاپلىمايمىز (${t.id})`);
        }
      }
      if(row.errors.length)row.status="error";
      else if(row.duplicate==="isbn")row.status="dup";
      else if(row.warnings.length)row.status="warn";
      else row.status="ok";
    });
  }catch(err){
    status($("#importStatus"),"مەۋجۇت كىتابلارنى تەكشۈرۈش مەغلۇپ بولدى: "+(err.message||err),"error");
    importRows=[];
    return;
  }
  importRows=mapped;
  const errors=mapped.filter(r=>r.status==="error").length;
  const dups=mapped.filter(r=>r.duplicate==="isbn").length;
  const warns=mapped.filter(r=>r.status==="warn").length;
  $("#importPreviewWrap").hidden=false;
  const ignored=ignoredImportColumns(objects);
  const ignoreNote=$("#importUnsupportedNote");
  if(ignoreNote){
    if(ignored.length){
      ignoreNote.hidden=false;
      ignoreNote.textContent=`بۇ ھۆججەتتىكى ${ignored.join(", ")} ستونلىرى ھازىرقى books جەدۋىلىدە يوق. قىممەتلەر كىرگۈزۈلمەيدۇ.`;
    }else{
      ignoreNote.hidden=true;
      ignoreNote.textContent="";
    }
  }
  $("#importSummary").textContent=`جەمئىي ${mapped.length} قۇر · خاتا ${errors} · ISBN تەكرار ${dups} · ئاگاھلاندۇرۇش ${warns}. جەزملەشتۈرمىگۈچە يېزىلمايدۇ.`;
  $("#importPreviewBody").innerHTML=mapped.map(r=>{
    const cls=r.status==="error"?"admin-row-error":r.status==="dup"||r.status==="warn"?"admin-row-warn":"admin-row-ok";
    const note=[...r.errors,...r.warnings].join("؛ ")||"جەزملەشنى ساقلاۋاتىدۇ";
    return `<tr class="${cls}"><td>${r.row}</td><td>${esc(r.title)}</td><td>${esc(r.author)}</td><td class="admin-isbn">${esc(r.isbn||"—")}</td><td class="admin-isbn">${esc(r.legacy_id||"—")}</td><td>${r.price==null?"—":esc(r.price)}</td><td>${esc(r.category||"—")}</td><td>${esc(note)}</td></tr>`;
  }).join("");
  const canImport=mapped.some(r=>r.status!=="error")||mapped.some(r=>r.duplicate==="isbn");
  $("#confirmImportBtn").disabled=!mapped.length;
  status($("#importStatus"),canImport?"ئالدىن كۆرۈش تەييار. خاتا قۇرلار كىرگۈزۈلمەيدۇ.":"ok","ok");
  if(errors&&errors===mapped.length){
    $("#confirmImportBtn").disabled=true;
    status($("#importStatus"),"ھەممە قۇر خاتا. Database غا يېزىلمايدۇ.","error");
  }
}

function rowToInsert(row,id){
  const rec={
    id,
    title:row.title,
    author:row.author||"",
    price:row.price,
    category:row.category,
    source:row.source,
    image_url:row.image_url||"",
    href:`book.html?id=${encodeURIComponent(id)}`,
    pages:row.pages==null?null:row.pages,
    translator:row.translator||null,
    language:row.language||"",
    publish_year:row.publish_year==null?null:row.publish_year,
    publisher:row.publisher||null,
    description:row.description||"",
    stock:row.stock,
    stock_status:row.stock_status||"",
    sales_count:row.sales_count||0,
    is_active:row.is_active!==false,
    is_new:row.is_new===true,
    is_recommended:row.is_recommended===true
  };
  if(isbnColumn)rec.isbn=row.isbn||"";
  if(presentBookCols.has("legacy_id")&&row.legacy_id)rec.legacy_id=row.legacy_id;
  return rec;
}
function rowToUpdate(row){
  const rec={
    title:row.title,
    author:row.author||"",
    price:row.price,
    category:row.category,
    source:row.source,
    publisher:row.publisher||null,
    description:row.description||"",
    stock:row.stock,
    stock_status:row.stock_status||"",
    sales_count:row.sales_count||0,
    is_active:row.is_active!==false,
    is_new:row.is_new===true,
    is_recommended:row.is_recommended===true,
    translator:row.translator||null,
    publish_year:row.publish_year==null?null:row.publish_year,
    pages:row.pages==null?null:row.pages
  };
  if(row.image_url)rec.image_url=row.image_url;
  if(isbnColumn)rec.isbn=row.isbn||"";
  return rec;
}

async function confirmImport(){
  if(importRunning)return;
  const dupMode=$("#importDupIsbn").value||"skip";
  const actionable=importRows.filter(r=>r.status!=="error");
  if(!actionable.length){status($("#importStatus"),"كىرگۈزۈشكە تەييار قۇر يوق.","error");return}
  if(!confirm(`${actionable.length} قۇرنى Database غا يېزىشنى جەزملەشتۈرەمسىز؟\nخاتا قۇرلار ئۆتكۈزۈلىدۇ.`))return;
  importRunning=true;
  $("#confirmImportBtn").disabled=true;
  $("#importFile").disabled=true;
  const progress=$("#importProgress");
  progress.hidden=false;
  let imported=0,skipped=0,failed=0,updated=0;
  const failedRows=[];
  const inserts=[];
  const updates=[];
  actionable.forEach(row=>{
    if(row.duplicate==="isbn"){
      if(dupMode==="skip"){skipped++;row.result="skipped";return}
      if(dupMode==="update"){
        if(row.isbnMatchCount===1&&row.dbMatch?.id){updates.push(row);return}
        skipped++;
        row.result="skipped-ambiguous";
        return;
      }
    }
    inserts.push(row);
  });
  const totalWork=inserts.length+updates.length;
  let done=0;
  const tick=()=>{progress.textContent=`${done} / ${totalWork||actionable.length} كىتاب بىر تەرەپ قىلىندى · كىرگۈزۈلدى ${imported} · يېڭىلاندى ${updated} · ئۆتكۈزۈلدى ${skipped} · مەغلۇپ ${failed}`;};

  try{
    for(let i=0;i<inserts.length;i+=IMPORT_BATCH){
      const source=inserts.slice(i,i+IMPORT_BATCH);
      let chunk=source.map((row,idx)=>writeBookRow(rowToInsert(row,`book-imp-${Date.now().toString(36)}-${i}-${idx}`),{omitId:generatedAlwaysId}));
      if(generatedAlwaysId)chunk=chunk.map(r=>{const {id,...rest}=r;return rest});
      let {error}=await db.from("books").insert(chunk);
      if(error&&generatedIdError(error)){
        generatedAlwaysId=true;
        chunk=chunk.map(r=>{const {id,...rest}=r;return rest});
        ({error}=await db.from("books").insert(chunk));
      }
      if(error){
        failed+=source.length;
        failedRows.push({rows:source.map(c=>c.title),message:error.message});
        done+=source.length;
        tick();
      }else{
        imported+=source.length;
        done+=source.length;
        tick();
      }
    }
    for(const row of updates){
      if(row.isbnMatchCount!==1||!row.dbMatch?.id){skipped++;done++;tick();continue}
      const {error}=await db.from("books").update(writeBookRow(rowToUpdate(row))).eq("id",row.dbMatch.id);
      if(error){failed++;failedRows.push({rows:[row.title],message:error.message})}
      else updated++;
      done++;
      tick();
    }
    const type=failed&&imported+updated?"warn":failed?"error":"ok";
    status($("#importStatus"),`تاماملاندى: كىرگۈزۈلدى ${imported}، يېڭىلاندى ${updated}، ئۆتكۈزۈلدى ${skipped}، مەغلۇپ ${failed}${failedRows.length? " — "+failedRows.map(f=>f.message).join("; "):""}`,type);
    if(failed&&!(imported||updated))progress.textContent+=" · پۈتۈن كىرگۈزۈش مۇۋەپپەقىيەتلىك دېيىلمىدى.";
    await Promise.all([loadBooks(),loadStats()]);
  }catch(err){
    status($("#importStatus"),"كىرگۈزۈش توختىدى: "+(err.message||err),"error");
  }finally{
    importRunning=false;
    $("#confirmImportBtn").disabled=false;
    $("#importFile").disabled=false;
  }
}

function scheduleSearch(){
  clearTimeout(searchTimer);
  searchTimer=setTimeout(()=>{
    listFilters.q=$("#adminSearch").value||"";
    listPage=0;
    loadBooks();
  },300);
}

function init(){
  if(window.__kutadguAdminInit)return;
  window.__kutadguAdminInit=true;
  applyBooksSchema();
  applyFieldDirections();
  if(window.__kutadguSkipAdminAuth){
    show("dashboardPanel");
    books=Array.isArray(window.__kutadguAdminPreviewBooks)?window.__kutadguAdminPreviewBooks:[];
    listTotal=books.length;
    if($("#adminBookList"))renderBooks();
    if($("#adminPager"))renderPager();
    return;
  }
  if(!configured()){
    show("setupPanel");
    return;
  }
  if(!window.supabase?.createClient){
    show("setupPanel");
    $("#setupPanel .admin-status").textContent="Supabase JavaScript كۈتۈپخانىسى يۈكلەنمىدى. تور ئۇلىنىشىنى تەكشۈرۈڭ.";
    return;
  }
  db=window.supabase.createClient(cfg.url,cfg.anonKey||cfg.publishableKey);
  renderSourceOptions();
  $("#loginForm").addEventListener("submit",login);
  $("#forgotPasswordBtn").onclick=requestPasswordReset;
  $("#adminLogout").onclick=logout;
  $("#newBookBtn").onclick=openNew;
  $("#closeBookModal").onclick=()=>{if(!saveInFlight)modal(false)};
  $("#cancelBookEdit").onclick=()=>{if(!saveInFlight)modal(false)};
  $("#bookForm").addEventListener("submit",saveBook);
  $("#importStaticBtn").onclick=importStatic;
  $("#adminSearch").addEventListener("input",scheduleSearch);
  $("#adminFilterSource").onchange=()=>{listFilters.source=$("#adminFilterSource").value;listPage=0;loadBooks()};
  $("#adminFilterActive").onchange=()=>{listFilters.active=$("#adminFilterActive").value;listPage=0;loadBooks()};
  $("#adminFilterRecommended").onchange=()=>{listFilters.recommended=$("#adminFilterRecommended").value;listPage=0;loadBooks()};
  $("#adminFilterNew").onchange=()=>{listFilters.isNew=$("#adminFilterNew").value;listPage=0;loadBooks()};
  $("#adminFilterQuality")&&($("#adminFilterQuality").onchange=()=>{listFilters.quality=$("#adminFilterQuality").value;listPage=0;loadBooks()});
  $("#adminSort").onchange=()=>{listFilters.sort=$("#adminSort").value;listPage=0;loadBooks()};
  $("#createDuplicateConfirm")&&($("#createDuplicateConfirm").onchange=()=>{createConflictAck=!!$("#createDuplicateConfirm").checked});
  $("#clearCoverPick")&&($("#clearCoverPick").onclick=()=>{
    $("#bookCover").value="";
    if(editing&&editing.image_url){
      $("#bookCoverPreview").src=editing.image_url;
      $("#bookCoverPreview").style.visibility="visible";
      $("#bookCoverText").textContent="ھازىرقى مۇقاۋا — يېڭى ھۆججەت تاللانمىسا ئۆزگەرمەيدۇ";
    }else{
      $("#bookCoverPreview").src="";
      $("#bookCoverPreview").style.visibility="hidden";
      $("#bookCoverText").textContent="يېڭى ھۆججەت تاللانمىسا مۇقاۋا قوشۇلمايدۇ";
    }
  });
  $("#bookIsbn")&&$("#bookIsbn").addEventListener("blur",()=>{$("#bookIsbn").value=formatIsbn($("#bookIsbn").value)});
  $("#selectPageBtn").onclick=()=>{books.forEach(b=>selectedIds.add(b.id));renderBooks()};
  $("#clearSelectionBtn").onclick=()=>{selectedIds.clear();renderBooks()};
  $("#bulkAction").onchange=updateBulkValueUi;
  $("#bulkApplyBtn").onclick=applyBulk;
  $("#importCsvBtn").onclick=openImport;
  $("#closeImportModal").onclick=closeImport;
  $("#cancelImportBtn").onclick=closeImport;
  $("#confirmImportBtn").onclick=confirmImport;
  $("#importFile").addEventListener("change",()=>{
    const file=$("#importFile").files[0];
    if(file)buildImportPreview(file);
  });
  $("#memberSearch").addEventListener("input",renderMembers);
  $("#reloadMembers").onclick=loadMembers;
  $("#bookCover").addEventListener("change",()=>{
    const file=$("#bookCover").files[0];
    if(!file)return;
    $("#bookCoverPreview").src=URL.createObjectURL(file);
    $("#bookCoverPreview").style.visibility="visible";
    $("#bookCoverText").textContent=file.name;
  });
  $("#bookGallery")?.addEventListener("change",()=>{
    addGalleryFiles($("#bookGallery").files||[]);
    $("#bookGallery").value="";
  });
  $("#bookModal").addEventListener("click",e=>{if(saveInFlight)return;if(e.target===$("#bookModal"))modal(false)});
  $("#importModal").addEventListener("click",e=>{if(e.target===$("#importModal")&&!importRunning)closeImport()});
  db.auth.onAuthStateChange(()=>setTimeout(routeSession,0));
  routeSession();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();

$("#reloadAnalytics")?.addEventListener("click",loadAnalytics);
$("#analyticsRange")?.addEventListener("change",loadAnalytics);

window.__kutadguAdminTest={
  parseCsvText,rowsToObjects,mapImportRow,normalizeIsbn,isbnLooksValid,formatIsbn,parseBoolCell,parseNumberCell,resolveCategory,searchSafe,searchOrFilter,postgrestIlike,selectedIdList,assertSelectedIds,writeBookRow,applyBooksSchema,ignoredImportColumns,PAGE_SIZE,IMPORT_BATCH,presentBookCols,OPTIONAL_BOOK_COLS,rowToInsert,normalizeGalleryField,planGallerySelection:()=>(window.KutadguGallery||{}).planGallerySelection,canonicalBookId,persistBookRow,planCurrentSave,logSavePlan,findCreateConflicts,renderCreateConflict,applyListFilters,listFilters,loadExistingForImport
};
})();
