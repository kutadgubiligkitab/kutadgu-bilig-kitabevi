(function(){
"use strict";
const Write=window.KutadguAdminWrite||{};
const Quality=window.KutadguAdminQuality||{};
const Bib=window.KutadguBibliography||{};
const ImportCovers=window.KutadguAdminImportCovers||{};
const CoverRepair=window.KutadguAdminCoverRepair||{};
const ImportIntake=window.KutadguAdminImportIntake||{};
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
let coverRepairDraft=null;
let coverRepairLookupGen=0;
let lastImportMissingQueue=[];
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

// Quick chips only write these same listFilters keys; applyListFilters() remains the query path.
const STATUS_CHIP_PRESETS={
  all:{recommended:"",isNew:""},
  recommended:{recommended:"yes",isNew:""},
  new:{recommended:"",isNew:"yes"},
  unmarked:{recommended:"no",isNew:"no"}
};

function matchedStatusChip(){
  const rec=listFilters.recommended||"";
  const neu=listFilters.isNew||"";
  if(rec===""&&neu==="")return "all";
  if(rec==="yes"&&neu==="")return "recommended";
  if(rec===""&&neu==="yes")return "new";
  if(rec==="no"&&neu==="no")return "unmarked";
  return "";
}

function syncStatusFilterUi(){
  const active=matchedStatusChip();
  document.querySelectorAll("[data-status-filter]").forEach(btn=>{
    const on=active!==""&&btn.dataset.statusFilter===active;
    btn.classList.toggle("is-active",on);
    btn.setAttribute("aria-pressed",on?"true":"false");
  });
  const recSel=$("#adminFilterRecommended");
  const newSel=$("#adminFilterNew");
  if(recSel)recSel.value=listFilters.recommended||"";
  if(newSel)newSel.value=listFilters.isNew||"";
}

function applyStatusChip(which){
  const preset=STATUS_CHIP_PRESETS[which];
  if(!preset)return;
  listFilters.recommended=preset.recommended;
  listFilters.isNew=preset.isNew;
  listPage=0;
  syncStatusFilterUi();
  loadBooks();
}

function statusBadgesHtml(book){
  const bits=[];
  if(book.is_recommended===true)bits.push('<span class="admin-status-badge admin-status-badge-recommended">⭐ تەۋسىيەلىك</span>');
  if(book.is_new===true)bits.push('<span class="admin-status-badge admin-status-badge-new">🆕 يېڭى كەلگەن</span>');
  if(!bits.length)return "";
  return `<div class="admin-status-badges">${bits.join("")}</div>`;
}

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
const ADMIN_SECTIONS=["overview","books","storefront","import-covers","insights","customers","system"];
const DEFAULT_ADMIN_SECTION="books";
let applyingAdminSection=false;
function parseAdminSectionHash(hash){
  const raw=String(hash==null?"":hash).replace(/^#/,"").trim().toLowerCase();
  return ADMIN_SECTIONS.includes(raw)?raw:DEFAULT_ADMIN_SECTION;
}
function dashboardAuthorized(){
  const panel=$("#dashboardPanel");
  return !!(panel&&!panel.hidden);
}
function showAdminSection(sectionId,opts){
  const options=opts||{};
  const id=ADMIN_SECTIONS.includes(sectionId)?sectionId:DEFAULT_ADMIN_SECTION;
  document.querySelectorAll("[data-admin-section-panel]").forEach(el=>{
    el.hidden=el.getAttribute("data-admin-section-panel")!==id;
  });
  document.querySelectorAll("[data-admin-section]").forEach(btn=>{
    const active=btn.getAttribute("data-admin-section")===id;
    btn.classList.toggle("is-active",active);
    if(active)btn.setAttribute("aria-current","page");
    else btn.removeAttribute("aria-current");
  });
  const select=$("#adminSectionSelect");
  if(select&&select.value!==id)select.value=id;
  if(options.updateHash===false||!dashboardAuthorized())return;
  const next="#"+id;
  if((location.hash||"")===next)return;
  applyingAdminSection=true;
  if(options.replace&&history.replaceState)history.replaceState(null,"",next);
  else location.hash=id;
  applyingAdminSection=false;
}
function onAdminHashChange(){
  if(applyingAdminSection||!dashboardAuthorized())return;
  showAdminSection(parseAdminSectionHash(location.hash),{updateHash:false});
}
function applyDashboardSectionFromLocation(opts){
  if(!dashboardAuthorized())return;
  showAdminSection(parseAdminSectionHash(location.hash),opts||{replace:true});
}
function bindAdminNavigation(){
  if(window.__kutadguAdminNavBound)return;
  window.__kutadguAdminNavBound=true;
  document.querySelectorAll("[data-admin-section]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      if(!dashboardAuthorized())return;
      showAdminSection(btn.getAttribute("data-admin-section"));
    });
  });
  $("#adminSectionSelect")&&$("#adminSectionSelect").addEventListener("change",()=>{
    if(!dashboardAuthorized())return;
    showAdminSection($("#adminSectionSelect").value);
  });
  window.addEventListener("hashchange",onAdminHashChange);
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
    if(key==="cover_file"||key==="coverStatus"||key==="coverMatchFile"||key==="insertedId")return;
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
  const cover_file=String(headerAlias(raw,["cover_file","coverfile","cover_filename","مۇقاۋا_ھۆججىتى"])).trim();
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
    cover_file,
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

function parseMaintenanceFlag(value){
  return value===true||value==="true"||value==="t"||value===1||value==="1";
}

function renderMaintenanceCard(on,opts={}){
  const card=$("#maintenanceCard");
  const btn=$("#maintenanceToggleBtn");
  const el=$("#maintenanceStatus");
  if(!card||!btn||!el)return;
  card.classList.remove("is-active","is-inactive","is-missing");
  if(opts.missing){
    card.classList.add("is-missing");
    btn.disabled=true;
    btn.textContent="ئاسراشنى باشلاش";
    status(el,"ئاسراش جەدۋىلى تېخى قوشۇلمىغان. SITE_MAINTENANCE_MODE.sql نى قولدا ئىجرا قىلغاندىن كېيىن بۇ يەردىن باشقۇرغىلى بولىدۇ.","warn");
    return;
  }
  if(opts.error){
    card.classList.add("is-inactive");
    btn.disabled=true;
    status(el,"ئاسراش ھالىتى ئوقۇلمىدى. تور بەت قۇلۇپلانمايدۇ.","warn");
    return;
  }
  btn.disabled=false;
  if(on){
    card.classList.add("is-active");
    btn.textContent="ئاسراشنى توختىتىش";
    status(el,"ئاسراش ھازىر ئوچۇق. ئادەتتىكى زىيارەتچى ۋە ئەزالار كاتالوگنى كۆرەلمەيدۇ. پەقەت Admin تور بەتنى نورمال كۆرەلەيدۇ.","warn");
  }else{
    card.classList.add("is-inactive");
    btn.textContent="ئاسراشنى باشلاش";
    status(el,"ئاسراش ھازىر يېپىق. تور بەت نورمال ئېچىق.","ok");
  }
}

async function loadMaintenanceCard(){
  if(!db)return;
  try{
    const {data,error}=await db.from("store_settings").select("key,value").eq("key","maintenance_mode").maybeSingle();
    if(error){
      const msg=String(error.message||error.code||"");
      const missing=/store_settings|does not exist|42P01|PGRST/i.test(msg)||error.code==="42P01"||error.code==="PGRST205";
      renderMaintenanceCard(false,{missing,error:true});
      return;
    }
    renderMaintenanceCard(parseMaintenanceFlag(data&&data.value));
  }catch(err){
    renderMaintenanceCard(false,{error:true});
  }
}

async function toggleMaintenanceMode(){
  if(!db||!user)return;
  const btn=$("#maintenanceToggleBtn");
  const el=$("#maintenanceStatus");
  const currentlyOn=$("#maintenanceCard")&&$("#maintenanceCard").classList.contains("is-active");
  const next=!currentlyOn;
  const ok=confirm(next
    ?"ئاسراشتىن كېيىن ئادەتتىكى زىيارەتچى كاتالوگنى كۆرەلمەيدۇ. داۋاملاشتۇرامسىز؟"
    :"ئاسراشنى توختىتىپ تور بەتنى نورمال ئېچىۋېتەمسىز؟");
  if(!ok)return;
  if(btn)btn.disabled=true;
  status(el,"ئاسراش ھالىتى يېزىلىۋاتىدۇ...");
  try{
    const {error}=await db.from("store_settings").update({
      value:next,
      updated_at:new Date().toISOString(),
      updated_by:user.id
    }).eq("key","maintenance_mode");
    if(error)throw error;
    await loadMaintenanceCard();
  }catch(err){
    status(el,"ئاسراش ھالىتى يېزىلمىدى: "+(err.message||err),"error");
    if(btn)btn.disabled=false;
  }
}

function isMissingAnnounceTable(error){
  const msg=String((error&& (error.message||error.code))||"");
  return /store_announcements|store_announcement_settings|does not exist|42P01|PGRST/i.test(msg)||(error&& (error.code==="42P01"||error.code==="PGRST205"));
}

function clampAnnounceInterval(value){
  const n=Math.round(Number(value));
  if(!Number.isFinite(n))return 5;
  return Math.min(60,Math.max(2,n));
}

function toDatetimeLocal(iso){
  if(!iso)return "";
  const d=new Date(iso);
  if(Number.isNaN(d.getTime()))return "";
  const pad=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(value){
  const raw=String(value||"").trim();
  if(!raw)return null;
  const d=new Date(raw);
  if(Number.isNaN(d.getTime()))return null;
  return d.toISOString();
}

function resetAnnounceForm(){
  $("#announceEditId")&&($("#announceEditId").value="");
  $("#announceMessage")&&($("#announceMessage").value="");
  $("#announceEnabled")&&($("#announceEnabled").checked=true);
  $("#announceSort")&&($("#announceSort").value="0");
  $("#announceStart")&&($("#announceStart").value="");
  $("#announceEnd")&&($("#announceEnd").value="");
}

function fillAnnounceForm(row){
  if(!row)return resetAnnounceForm();
  $("#announceEditId").value=row.id||"";
  $("#announceMessage").value=row.message||"";
  $("#announceEnabled").checked=row.enabled!==false;
  $("#announceSort").value=Number.isFinite(Number(row.sort_order))?row.sort_order:0;
  $("#announceStart").value=toDatetimeLocal(row.starts_at);
  $("#announceEnd").value=toDatetimeLocal(row.ends_at);
}

function renderAnnounceMissing(){
  const card=$("#announcementCard");
  if(card)card.classList.add("is-missing");
  const list=$("#announcementList");
  if(list)list.innerHTML="";
  ["announceSaveBtn","announceResetBtn","announceIntervalSave"].forEach(id=>{
    const el=$(`#${id}`);
    if(el)el.disabled=true;
  });
  status($("#announcementStatus"),"ئېلان جەدۋىلى تېخى Database غا قوشۇلمىغان. SITE_ANNOUNCEMENT_BAR.sql نى قولدا ئىجرا قىلىڭ. تور بەت بۇنىڭ بىلەن بۇزۇلمايدۇ.","warn");
}

let announceRows=[];

function renderAnnounceList(){
  const list=$("#announcementList");
  if(!list)return;
  list.innerHTML="";
  if(!announceRows.length){
    const empty=document.createElement("p");
    empty.className="admin-help";
    empty.textContent="ھازىرچە ئېلان يوق. يېڭى ئېلان قوشۇڭ.";
    list.appendChild(empty);
    return;
  }
  announceRows.forEach((row,idx)=>{
    const item=document.createElement("div");
    item.className="admin-announce-row";
    const body=document.createElement("div");
    const title=document.createElement("div");
    title.className="admin-announce-message";
    title.textContent=row.message||"";
    const meta=document.createElement("div");
    meta.className="admin-book-meta";
    meta.textContent=(row.enabled===false?"يېپىق":"ئوچۇق")+" · تەرتىپ "+(row.sort_order??0);
    body.append(title,meta);
    const actions=document.createElement("div");
    actions.className="admin-book-actions";
    const mk=(label,cls,fn)=>{
      const b=document.createElement("button");
      b.type="button";
      b.className=cls||"";
      b.textContent=label;
      b.addEventListener("click",fn);
      return b;
    };
    actions.append(
      mk("↑","",()=>reorderAnnounce(idx,-1)),
      mk("↓","",()=>reorderAnnounce(idx,1)),
      mk("تەھرىرلەش","",()=>fillAnnounceForm(row)),
      mk(row.enabled===false?"قوزغىتىش":"توختىتىش","",()=>toggleAnnounceEnabled(row)),
      mk("ئۆچۈرۈش","admin-danger",()=>deleteAnnounce(row))
    );
    item.append(body,actions);
    list.appendChild(item);
  });
}

async function loadAnnouncementCard(){
  if(!db)return;
  const card=$("#announcementCard");
  if(card)card.classList.remove("is-missing");
  try{
    const [listRes,setRes]=await Promise.all([
      db.from("store_announcements").select("id,message,enabled,sort_order,starts_at,ends_at,created_at").order("sort_order",{ascending:true}).order("created_at",{ascending:true}),
      db.from("store_announcement_settings").select("id,rotation_interval_seconds").eq("id",1).maybeSingle()
    ]);
    if(listRes.error){
      if(isMissingAnnounceTable(listRes.error))return renderAnnounceMissing();
      throw listRes.error;
    }
    if(setRes.error && isMissingAnnounceTable(setRes.error))return renderAnnounceMissing();
    if(setRes.error)throw setRes.error;
    ["announceSaveBtn","announceResetBtn","announceIntervalSave"].forEach(id=>{
      const el=$(`#${id}`);
      if(el)el.disabled=false;
    });
    announceRows=Array.isArray(listRes.data)?listRes.data:[];
    const interval=clampAnnounceInterval(setRes.data&&setRes.data.rotation_interval_seconds);
    if($("#announceInterval"))$("#announceInterval").value=String(interval);
    renderAnnounceList();
    status($("#announcementStatus"),"ئېلان سانى: "+announceRows.length+" · ئايلىنىش: "+interval+" سېكۇنت","ok");
  }catch(err){
    if(isMissingAnnounceTable(err))return renderAnnounceMissing();
    status($("#announcementStatus"),"ئېلانلار ئوقۇلمىدى: "+(err.message||err),"error");
  }
}

async function saveAnnounceInterval(e){
  e&&e.preventDefault();
  if(!db||!user)return;
  const seconds=clampAnnounceInterval($("#announceInterval")&&$("#announceInterval").value);
  if($("#announceInterval"))$("#announceInterval").value=String(seconds);
  try{
    const {error}=await db.from("store_announcement_settings").update({
      rotation_interval_seconds:seconds,
      updated_at:new Date().toISOString(),
      updated_by:user.id
    }).eq("id",1);
    if(error)throw error;
    status($("#announcementStatus"),"ئايلىنىش ئارىلىقى "+seconds+" سېكۇنت قىلىپ ساقلاندى.","ok");
  }catch(err){
    if(isMissingAnnounceTable(err))return renderAnnounceMissing();
    status($("#announcementStatus"),"ئارىلىق ساقلانمىدى: "+(err.message||err),"error");
  }
}

async function saveAnnounce(e){
  e&&e.preventDefault();
  if(!db||!user)return;
  const message=String($("#announceMessage")&&$("#announceMessage").value||"").trim();
  if(!message){
    status($("#announcementStatus"),"ئېلان تېكىستى بوش بولماسلىقى كېرەك.","error");
    return;
  }
  const payload={
    message,
    enabled:!!($("#announceEnabled")&&$("#announceEnabled").checked),
    sort_order:Number($("#announceSort")&&$("#announceSort").value)||0,
    starts_at:fromDatetimeLocal($("#announceStart")&&$("#announceStart").value),
    ends_at:fromDatetimeLocal($("#announceEnd")&&$("#announceEnd").value),
    updated_at:new Date().toISOString(),
    updated_by:user.id
  };
  const id=String($("#announceEditId")&&$("#announceEditId").value||"").trim();
  try{
    let error;
    if(id){
      ({error}=await db.from("store_announcements").update(payload).eq("id",id));
    }else{
      ({error}=await db.from("store_announcements").insert(payload));
    }
    if(error)throw error;
    resetAnnounceForm();
    await loadAnnouncementCard();
    status($("#announcementStatus"),id?"ئېلان يېڭىلاندى.":"يېڭى ئېلان قوشۇلدى.","ok");
  }catch(err){
    if(isMissingAnnounceTable(err))return renderAnnounceMissing();
    status($("#announcementStatus"),"ئېلان ساقلانمىدى: "+(err.message||err),"error");
  }
}

async function toggleAnnounceEnabled(row){
  if(!db||!user||!row)return;
  try{
    const {error}=await db.from("store_announcements").update({
      enabled:row.enabled===false,
      updated_at:new Date().toISOString(),
      updated_by:user.id
    }).eq("id",row.id);
    if(error)throw error;
    await loadAnnouncementCard();
  }catch(err){
    status($("#announcementStatus"),"ھالەت ئۆزگەرتىلمىدى: "+(err.message||err),"error");
  }
}

async function deleteAnnounce(row){
  if(!db||!row)return;
  if(!confirm("بۇ ئېلاننى ئۆچۈرەمسىز؟"))return;
  try{
    const {error}=await db.from("store_announcements").delete().eq("id",row.id);
    if(error)throw error;
    if($("#announceEditId")&&$("#announceEditId").value===row.id)resetAnnounceForm();
    await loadAnnouncementCard();
    status($("#announcementStatus"),"ئېلان ئۆچۈرۈلدى.","ok");
  }catch(err){
    status($("#announcementStatus"),"ئېلان ئۆچۈرۈلمىدى: "+(err.message||err),"error");
  }
}

async function reorderAnnounce(idx,dir){
  const other=idx+dir;
  if(other<0||other>=announceRows.length)return;
  const a=announceRows[idx];
  const b=announceRows[other];
  const aOrder=Number(a.sort_order)||0;
  const bOrder=Number(b.sort_order)||0;
  const nextA=aOrder===bOrder?aOrder+dir:bOrder;
  const nextB=aOrder===bOrder?bOrder:aOrder;
  try{
    const u1=await db.from("store_announcements").update({sort_order:nextA,updated_at:new Date().toISOString(),updated_by:user.id}).eq("id",a.id);
    if(u1.error)throw u1.error;
    const u2=await db.from("store_announcements").update({sort_order:nextB,updated_at:new Date().toISOString(),updated_by:user.id}).eq("id",b.id);
    if(u2.error)throw u2.error;
    await loadAnnouncementCard();
  }catch(err){
    status($("#announcementStatus"),"تەرتىپ ئۆزگەرتىلمىدى: "+(err.message||err),"error");
  }
}

function bindAnnouncementAdmin(){
  $("#announcementForm")&&$("#announcementForm").addEventListener("submit",saveAnnounce);
  $("#announcementSettingsForm")&&$("#announcementSettingsForm").addEventListener("submit",saveAnnounceInterval);
  $("#announceResetBtn")&&($("#announceResetBtn").onclick=resetAnnounceForm);
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
  applyDashboardSectionFromLocation({replace:true});
  await Promise.all([loadBooks(),loadMembers(),loadAnalytics(),loadStats(),loadMaintenanceCard(),loadAnnouncementCard()]);
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
        ${statusBadgesHtml(b)}
        <div class="admin-quality-row">${Quality.qualityChipsHtml?Quality.qualityChipsHtml(b,{descriptionSupported:true,isbnSupported:isbnColumn}):""}</div>
        <div class="admin-book-meta">${esc(b.author||"—")} · ${esc(b.category||"")} · ${money(b.price)}${presentBookCols.has("stock")||presentBookCols.has("stock_status")?` · ئامبار ${b.stock==null?"—":Number(b.stock)} · ${b.stock_status==="out_of_stock"?"تۈگەپ كەتتى":b.stock_status==="low_stock"?"ئاز قالدى":"ئامباردا بار"}`:""}</div>
        <div class="admin-book-meta">${b.is_active===false?"🙈 يوشۇرۇلغان":"✅ كۆرۈنىدۇ"} ${Number(b.sales_count)>0?` · 🔥 سېتىلغان ${Number(b.sales_count)}`:""}${b.isbn?` · ISBN <span class="admin-isbn">${esc(b.isbn)}</span>`:""}${b.publisher?` · ${esc(b.publisher)}`:""}</div>
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
    return "https://www.kutadgubilik.com/reset-password.html?next=admin";
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
  if($("#importCoverFiles"))$("#importCoverFiles").value="";
  $("#importPreviewWrap").hidden=true;
  $("#importProgress").hidden=true;
  $("#confirmImportBtn").disabled=true;
  const ignoreNote=$("#importUnsupportedNote");
  if(ignoreNote){ignoreNote.hidden=true;ignoreNote.textContent=""}
  status($("#importStatus"),"CSV ياكى Excel (.xlsx) تاللاڭ. مۇقاۋا رەسىملىرىنى ئايرىم تاللىسىڭىز بولىدۇ.");
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

function selectedImportCoverFiles(){
  const input=$("#importCoverFiles");
  return input&&input.files?Array.from(input.files):[];
}

function refreshImportPlanSummary(){
  if(!CoverRepair.summarizeImportPlan||!importRows.length||!$("#importSummary"))return;
  const dupMode=$("#importDupIsbn")&&$("#importDupIsbn").value||"skip";
  $("#importSummary").textContent=CoverRepair.formatPlanText(CoverRepair.summarizeImportPlan(importRows,dupMode,ImportCovers.classifyImportRowAction))+" · جەزملەشتۈرمىگۈچە يېزىلمايدۇ ۋە رەسىم يۈكلەنمەيدۇ.";
}

const COVER_REPAIR_SELECT="id,title,author,isbn,image_url,price,sales_count,is_active";

function selectedCoverRepairFile(){
  const input=$("#coverRepairFile");
  return input&&input.files&&input.files[0]?input.files[0]:null;
}

function clearCoverRepairTargetDisplay(){
  const wrap=$("#coverRepairPreview");
  if(wrap)wrap.hidden=true;
  if($("#coverRepairConfirmBtn"))$("#coverRepairConfirmBtn").disabled=true;
  if($("#coverRepairTitle"))$("#coverRepairTitle").textContent="";
  if($("#coverRepairMeta"))$("#coverRepairMeta").textContent="";
  const thumb=$("#coverRepairThumb");
  if(thumb){
    thumb.removeAttribute("src");
    thumb.style.visibility="hidden";
  }
}

function resetCoverRepairPreview(msg){
  const file=selectedCoverRepairFile();
  coverRepairDraft=CoverRepair.invalidateRepairTarget?CoverRepair.invalidateRepairTarget({file:file}):{book:null,file:file};
  clearCoverRepairTargetDisplay();
  if(msg)status($("#coverRepairStatus"),msg);
}

function invalidateCoverRepairOnLookupChange(){
  coverRepairLookupGen+=1;
  const file=selectedCoverRepairFile()||(coverRepairDraft&&coverRepairDraft.file)||null;
  coverRepairDraft=CoverRepair.invalidateRepairTarget?CoverRepair.invalidateRepairTarget({file:file}):{book:null,file:file};
  clearCoverRepairTargetDisplay();
  if($("#coverRepairConfirmBtn"))$("#coverRepairConfirmBtn").disabled=true;
}

async function lookupCoverRepairBook(raw){
  if(!CoverRepair.parseLookup)throw new Error("admin-cover-repair.js يوق");
  const lookup=CoverRepair.parseLookup(raw,normalizeIsbn);
  if(!lookup.ok){
    return {ok:false,reason:lookup.error==="empty"?"empty":"unrecognized"};
  }
  let rows=[];
  if(lookup.kind==="id"){
    const {data,error}=await db.from("books").select(COVER_REPAIR_SELECT).eq("id",lookup.value);
    if(error)throw error;
    rows=Array.isArray(data)?data:(data?[data]:[]);
  }else if(lookup.kind==="isbn"){
    if(!isbnColumn)return {ok:false,reason:"none"};
    const scale=window.KutadguAdminImportScale;
    if(!scale||typeof scale.pageInColumn!=="function"||typeof scale.isbnLookupTokens!=="function"){
      throw new Error("admin-import-scale.js missing");
    }
    const tokens=scale.isbnLookupTokens(raw,normalizeIsbn);
    rows=await scale.pageInColumn(db,"isbn",tokens,COVER_REPAIR_SELECT,scale.ISBN_IN_CHUNK||80);
  }else{
    return {ok:false,reason:"unrecognized"};
  }
  return CoverRepair.resolveMatches(rows,lookup,normalizeIsbn);
}

function renderCoverRepairPreview(book,file){
  const wrap=$("#coverRepairPreview");
  if(!wrap||!book)return;
  wrap.hidden=false;
  const thumb=$("#coverRepairThumb");
  if(thumb){
    thumb.src=file?URL.createObjectURL(file):(book.image_url||"");
    thumb.style.visibility=(file||book.image_url)?"visible":"hidden";
  }
  if($("#coverRepairTitle"))$("#coverRepairTitle").textContent=book.title||"—";
  const coverState=book.image_url?"مۇقاۋا بار":"مۇقاۋا يوق";
  if($("#coverRepairMeta"))$("#coverRepairMeta").textContent=`ID ${book.id} · ${book.author||"—"} · ISBN ${book.isbn||"—"} · ${coverState}`;
  if($("#coverRepairConfirmBtn"))$("#coverRepairConfirmBtn").disabled=!file;
}

async function previewCoverRepair(){
  if(!db){status($("#coverRepairStatus"),"Database ئۇلىنىشى يوق.","error");return}
  const raw=$("#coverRepairLookup")&&$("#coverRepairLookup").value;
  const file=selectedCoverRepairFile();
  const gen=++coverRepairLookupGen;
  coverRepairDraft=CoverRepair.invalidateRepairTarget?CoverRepair.invalidateRepairTarget({file:file}):{book:null,file:file};
  clearCoverRepairTargetDisplay();
  status($("#coverRepairStatus"),"كىتاب تەكشۈرۈلىۋاتىدۇ...");
  try{
    const resolved=await lookupCoverRepairBook(raw);
    if(gen!==coverRepairLookupGen)return;
    coverRepairDraft=CoverRepair.applyLookupOutcome?CoverRepair.applyLookupOutcome({file:file},resolved):(!resolved.ok?{book:null,file:file}:{book:resolved.book,file:file});
    if(!resolved.ok||!coverRepairDraft.book){
      clearCoverRepairTargetDisplay();
      if(resolved.reason==="none")status($("#coverRepairStatus"),"ماس كىتاب تېپىلمىدى. يېزىلمايدۇ.","error");
      else if(resolved.reason==="ambiguous")status($("#coverRepairStatus"),`ISBN ${resolved.matches.length} كىتابقا ماس كەلدى — قايسىسى ئىكەنلىكى ئېنىق ئەمەس. يېزىلمايدۇ.`,"error");
      else status($("#coverRepairStatus"),"ID ياكى ISBN كىرگۈزۈڭ. ئىسىم بىلەن ئىزدەلمەيدۇ.","error");
      return;
    }
    renderCoverRepairPreview(coverRepairDraft.book,file||null);
    status($("#coverRepairStatus"),file?"كىتاب تېپىلدى. جەزملەشتۈرمىگۈچە پەقەت image_url ئۆزگەرمەيدۇ.":"كىتاب تېپىلدى. رەسىم تاللاپ جەزملەڭ.","ok");
  }catch(err){
    coverRepairDraft=CoverRepair.invalidateRepairTarget?CoverRepair.invalidateRepairTarget({file:file}):{book:null,file:file};
    clearCoverRepairTargetDisplay();
    status($("#coverRepairStatus"),"تەكشۈرۈش مەغلۇپ: "+(err.message||err),"error");
  }
}

async function confirmCoverRepair(){
  const file=selectedCoverRepairFile()||(coverRepairDraft&&coverRepairDraft.file)||null;
  if(file&&coverRepairDraft)coverRepairDraft.file=file;
  if(CoverRepair.canWriteCoverRepair&&!CoverRepair.canWriteCoverRepair(coverRepairDraft)){
    status($("#coverRepairStatus"),"ئالدى بىلەن نۆۋەتتىكى ID/ISBN نى تەكشۈرۈڭ.","error");
    return;
  }
  if(!coverRepairDraft||!coverRepairDraft.book){status($("#coverRepairStatus"),"ئالدى بىلەن كىتابنى تەكشۈرۈڭ.","error");return}
  if(!file){status($("#coverRepairStatus"),"رەسىم تاللاڭ.","error");return}
  const book=coverRepairDraft.book;
  if(!confirm(`«${book.title||book.id}» غا پەقەت مۇقاۋا باغلامسىز؟\nباشقا مەيدانلار ئۆزگەرمەيدۇ.`))return;
  const btn=$("#coverRepairConfirmBtn");
  if(btn)btn.disabled=true;
  status($("#coverRepairStatus"),"مۇقاۋا يۈكلىنىۋاتىدۇ...");
  try{
    const url=await uploadCover(book.id,file);
    const payload=CoverRepair.coverOnlyPayload(url);
    const {error,data}=await db.from("books").update(payload).eq("id",book.id).select(COVER_REPAIR_SELECT);
    if(error)throw error;
    const updated=Array.isArray(data)?data[0]:data;
    status($("#coverRepairStatus"),`مۇقاۋا باغلاش تاماملاندى (ID ${book.id}). پەقەت image_url يېڭىلاندى.`,"ok");
    if(updated)renderCoverRepairPreview(updated,null);
    coverRepairDraft={book:updated||book,file:null};
    if($("#coverRepairFile"))$("#coverRepairFile").value="";
    await Promise.all([loadBooks(),loadStats()]);
  }catch(err){
    status($("#coverRepairStatus"),"مۇقاۋا يۈكلەنمىدى؛ كىتاب قۇرى ئۆزگەرتىلمىدى: "+(err.message||err),"error");
    if(btn)btn.disabled=false;
  }
}

function refreshImportPreviewFromInputs(){
  const file=$("#importFile")&&$("#importFile").files&&$("#importFile").files[0];
  if(file)buildImportPreview(file);
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
  if(!ImportCovers.applyCoverMatches){
    status($("#importStatus"),"admin-import-covers.js يوق.","error");
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
          row.duplicate="title_author";
          row.warnings.push(`ئىسىم+ئاپتور ئوخشاش كىتاب بار (${t.id}) — يېڭى كىتاب قوشۇلمايدۇ، مەۋجۇت كىتاب قاپلانمايدۇ`);
        }
      }
    });
  }catch(err){
    status($("#importStatus"),"مەۋجۇت كىتابلارنى تەكشۈرۈش مەغلۇپ بولدى: "+(err.message||err),"error");
    importRows=[];
    return;
  }
  ImportCovers.applyCoverMatches(mapped,selectedImportCoverFiles());
  mapped.forEach(row=>{
    if(row.errors.length)row.status="error";
    else if(row.duplicate==="isbn"||row.duplicate==="title_author")row.status="dup";
    else if(row.warnings.length)row.status="warn";
    else row.status="ok";
  });
  importRows=mapped;
  const errors=mapped.filter(r=>r.status==="error").length;
  const dups=mapped.filter(r=>r.duplicate==="isbn").length;
  const titleDups=mapped.filter(r=>r.duplicate==="title_author").length;
  const warns=mapped.filter(r=>r.status==="warn").length;
  const coverProblems=mapped.filter(r=>r.coverStatus==="missing"||r.coverStatus==="duplicate").length;
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
  $("#importSummary").textContent=(CoverRepair.formatPlanText?CoverRepair.formatPlanText(CoverRepair.summarizeImportPlan(mapped,$("#importDupIsbn")&&$("#importDupIsbn").value||"skip",ImportCovers.classifyImportRowAction)):"")+` · جەزملەشتۈرمىگۈچە يېزىلمايدۇ ۋە رەسىم يۈكلەنمەيدۇ.`;
  $("#importPreviewBody").innerHTML=mapped.map(r=>{
    const cls=r.status==="error"?"admin-row-error":r.status==="dup"||r.status==="warn"?"admin-row-warn":"admin-row-ok";
    const coverNote=ImportCovers.coverStatusLabel?ImportCovers.coverStatusLabel(r.coverStatus):r.coverStatus;
    const coverDetail=r.cover_file?`${coverNote} (${r.cover_file})`:coverNote;
    const note=[...r.errors,...r.warnings].join("؛ ")||"جەزملەشنى ساقلاۋاتىدۇ";
    return `<tr class="${cls}"><td>${r.row}</td><td>${esc(r.title)}</td><td>${esc(r.author)}</td><td class="admin-isbn">${esc(r.isbn||"—")}</td><td class="admin-isbn">${esc(r.legacy_id||"—")}</td><td>${r.price==null?"—":esc(r.price)}</td><td>${esc(r.category||"—")}</td><td>${esc(coverDetail)}</td><td>${esc(note)}</td></tr>`;
  }).join("");
  const canImport=mapped.some(r=>r.status!=="error")||mapped.some(r=>r.duplicate==="isbn");
  $("#confirmImportBtn").disabled=!mapped.length;
  status($("#importStatus"),canImport?"ئالدىن كۆرۈش تەييار. خاتا قۇرلار كىرگۈزۈلمەيدۇ. ئىسىم+ئاپتور تەكرار قۇرلار ئۆتكۈزۈلىدۇ.":"ok","ok");
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

function queueRepairButtonHtml(id){
  const safe=ImportIntake.repairLookupValue?ImportIntake.repairLookupValue(id):"";
  if(!safe)return "";
  return `<button type="button" class="admin-secondary last-import-repair-btn" data-repair-id="${esc(safe)}">رېمونت</button>`;
}

function renderLastImportCoverQueue(){
  const items=lastImportMissingQueue||[];
  const modalWrap=$("#importMissingCoverWrap");
  const modalBody=$("#importMissingCoverBody");
  const modalSum=$("#importMissingCoverSummary");
  const dash=$("#lastImportCoverQueue");
  const dashBody=$("#lastImportCoverQueueBody");
  if(modalSum)modalSum.textContent=items.length?`بۇ كىرگۈزۈشتە مۇقاۋا يوق ${items.length} كىتاب. رەسىم تاللاپ جەزملەڭ.`:"بۇ كىرگۈزۈشتە مۇقاۋا نۆۋىتى قۇرۇق.";
  const rows=items.map(item=>{
    const btn=queueRepairButtonHtml(item.id);
    return `<tr><td class="admin-isbn">${esc(item.id)}</td><td>${esc(item.title||"—")}</td><td>${esc(item.author||"—")}</td><td>${esc(item.reasonLabel||item.reason||"—")}</td><td>${btn}</td></tr>`;
  }).join("");
  if(modalBody)modalBody.innerHTML=rows||"";
  if(modalWrap)modalWrap.hidden=!items.length;
  if(dashBody){
    dashBody.innerHTML=items.length?`<div class="admin-table-scroll"><table class="admin-import-table"><thead><tr><th>ID</th><th>كىتاب</th><th>ئاپتور</th><th>سەۋەب</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`:"<p class=\"admin-help\">نۆۋەت يوق.</p>";
  }
  if(dash)dash.hidden=!items.length;
}

function openCoverRepairFromQueue(id){
  const safe=ImportIntake.repairLookupValue?ImportIntake.repairLookupValue(id):"";
  if(!safe){status($("#coverRepairStatus"),"بۇ نۆۋەتتە بىخەتەر كىتاب ID يوق.","error");return}
  const lookup=$("#coverRepairLookup");
  if(lookup)lookup.value=safe;
  invalidateCoverRepairOnLookupChange();
  if(lookup)lookup.value=safe;
  const card=$("#coverRepairCard");
  if(dashboardAuthorized())showAdminSection("import-covers");
  if(card&&card.scrollIntoView)card.scrollIntoView({block:"start"});
  if($("#importModal")&&!$("#importModal").hidden)closeImport();
  previewCoverRepair();
}

function importInsertSelectCols(){
  return isbnColumn?"id,title,author,isbn":"id,title,author";
}

async function confirmImport(){
  if(importRunning)return;
  const dupMode=$("#importDupIsbn").value||"skip";
  if(!ImportCovers.classifyImportRowAction||!ImportCovers.pairInsertedRows||!ImportCovers.mapPool){
    status($("#importStatus"),"admin-import-covers.js يوق.","error");
    return;
  }
  const actionable=importRows.filter(r=>ImportCovers.classifyImportRowAction(r,dupMode)!=="exclude");
  if(!actionable.length){status($("#importStatus"),"كىرگۈزۈشكە تەييار قۇر يوق.","error");return}
  if(!confirm((CoverRepair.formatPlanText?CoverRepair.formatPlanText(CoverRepair.summarizeImportPlan(importRows,dupMode,ImportCovers.classifyImportRowAction)):"")+`\nچوڭ كىرگۈزۈشتىن بۇرۇن Database زاپاس قىلىڭ؛ Storage رەسىملىرى زاپاسقا كىرمەيدۇ.\nخاتا قۇرلار ئۆتكۈزۈلىدۇ. ئىسىم+ئاپتور تەكرار قۇرلار قوشۇلمايدۇ. مۇقاۋا رەسىملىرى پەقەت ماس كەلگەن قۇرلارغا يۈكلىنىدۇ. مۇقاۋا مەغلۇپ بولسا كىتاب ئۆچۈرۈلمەيدۇ — رېمونت بۆلىكىدىن قايتا باغلاڭ.`))return;
  importRunning=true;
  $("#confirmImportBtn").disabled=true;
  $("#importFile").disabled=true;
  if($("#importCoverFiles"))$("#importCoverFiles").disabled=true;
  const progress=$("#importProgress");
  progress.hidden=false;
  let imported=0,skipped=0,failed=0,updated=0,coverOk=0,coverFailed=0,unmappedIds=0;
  const failedRows=[];
  const inserts=[];
  const updates=[];
  const coverJobs=[];
  const succeededRows=[];
  const coverOkByKey={};
  actionable.forEach(row=>{
    const action=ImportCovers.classifyImportRowAction(row,dupMode);
    if(action==="skip"){skipped++;row.result="skipped";return}
    if(action==="update"){updates.push(row);return}
    inserts.push(row);
  });
  const totalWork=inserts.length+updates.length;
  let done=0;
  const tick=()=>{progress.textContent=`${done} / ${totalWork||actionable.length} كىتاب بىر تەرەپ قىلىندى · كىرگۈزۈلدى ${imported} · يېڭىلاندى ${updated} · ئۆتكۈزۈلدى ${skipped} · مەغلۇپ ${failed} · مۇقاۋا ${coverOk} · مۇقاۋا مەغلۇپ ${coverFailed}`;};

  try{
    for(let i=0;i<inserts.length;i+=IMPORT_BATCH){
      const source=inserts.slice(i,i+IMPORT_BATCH);
      let chunk=source.map((row,idx)=>writeBookRow(rowToInsert(row,`book-imp-${Date.now().toString(36)}-${i}-${idx}`),{omitId:generatedAlwaysId}));
      if(generatedAlwaysId)chunk=chunk.map(r=>{const {id,...rest}=r;return rest});
      let {error,data}=await db.from("books").insert(chunk).select(importInsertSelectCols());
      if(error&&generatedIdError(error)){
        generatedAlwaysId=true;
        chunk=chunk.map(r=>{const {id,...rest}=r;return rest});
        ({error,data}=await db.from("books").insert(chunk).select(importInsertSelectCols()));
      }
      if(error){
        failed+=source.length;
        failedRows.push({rows:source.map(c=>c.title),message:error.message});
        done+=source.length;
        tick();
      }else{
        imported+=source.length;
        const paired=ImportCovers.pairInsertedRows(chunk,data,{normalizeIsbn});
        source.forEach((row,idx)=>{
          const pair=paired.pairs[idx];
          if(pair&&pair.id!=null&&pair.id!==""){
            row.insertedId=pair.id;
            if(row.coverStatus==="matched"&&row.coverMatchFile){
              coverJobs.push({id:pair.id,file:row.coverMatchFile,title:row.title});
            }
          }else if(row.coverStatus==="matched"){
            unmappedIds++;
            failedRows.push({rows:[row.title],message:"كىتاب كىرگۈزۈلدى، ئەمما id نى بىخەتەر ماسلاشتۇرالمىدى — مۇقاۋا يۈكلەنمىدى"});
          }
          succeededRows.push(row);
        });
        done+=source.length;
        tick();
      }
    }
    for(const row of updates){
      if(row.isbnMatchCount!==1||!row.dbMatch?.id){skipped++;done++;tick();continue}
      const {error}=await db.from("books").update(writeBookRow(rowToUpdate(row))).eq("id",row.dbMatch.id);
      if(error){failed++;failedRows.push({rows:[row.title],message:error.message})}
      else{
        updated++;
        succeededRows.push(row);
        if(row.coverStatus==="matched"&&row.coverMatchFile){
          coverJobs.push({id:row.dbMatch.id,file:row.coverMatchFile,title:row.title});
        }
      }
      done++;
      tick();
    }
    if(coverJobs.length){
      progress.textContent+=` · مۇقاۋا يۈكلىنىۋاتىدۇ (${coverJobs.length})`;
      const coverResults=await ImportCovers.mapPool(coverJobs,ImportCovers.COVER_UPLOAD_CONCURRENCY,async job=>{
        const url=await uploadCover(job.id,job.file);
        const {error}=await db.from("books").update({image_url:url}).eq("id",job.id);
        if(error)throw error;
        return url;
      });
      coverResults.forEach((res,idx)=>{
        const job=coverJobs[idx];
        if(res&&res.ok){
          coverOk++;
          if(job&&job.id!=null)coverOkByKey[String(job.id)]=true;
        }else{
          coverFailed++;
          const msg=res&&res.error&&(res.error.message||res.error)||"نامەلۇم خاتالىق";
          failedRows.push({rows:[job&&job.title],message:"مۇقاۋا يۈكلەنمىدى (كىتاب ئۆچۈرۈلمىدى؛ رېمونت بۆلىكىدىن قايتا باغلاڭ): "+msg});
        }
      });
    }
    const withoutImageUrl=CoverRepair.countWithoutImageUrl?CoverRepair.countWithoutImageUrl(succeededRows,null,coverOkByKey):0;
    const built=ImportIntake.buildMissingCoverQueue?ImportIntake.buildMissingCoverQueue(succeededRows,coverOkByKey):[];
    lastImportMissingQueue=ImportIntake.replaceLastImportQueue?ImportIntake.replaceLastImportQueue(lastImportMissingQueue,built):built;
    renderLastImportCoverQueue();
    const type=(failed||coverFailed||unmappedIds)&&(imported+updated)?"warn":(failed||coverFailed)?"error":"ok";
    let resultLine=CoverRepair.formatResultText?CoverRepair.formatResultText({imported,updated,skipped,failed,coverOk,coverFailed,withoutImageUrl}):`تاماملاندى: كىرگۈزۈلدى ${imported}، يېڭىلاندى ${updated}، ئۆتكۈزۈلدى ${skipped}، مەغلۇپ ${failed}، مۇقاۋا ${coverOk}، مۇقاۋا مەغلۇپ ${coverFailed}`;
    if(ImportIntake.appendQueueCount)resultLine=ImportIntake.appendQueueCount(resultLine,lastImportMissingQueue.length);
    status($("#importStatus"),resultLine+(failedRows.length? " — "+failedRows.map(f=>f.message).join("; "):""),type);
    if(failed&&!(imported||updated))progress.textContent+=" · پۈتۈن كىرگۈزۈش مۇۋەپپەقىيەتلىك دېيىلمىدى.";
    tick();
    await Promise.all([loadBooks(),loadStats()]);
  }catch(err){
    const built=ImportIntake.buildMissingCoverQueue?ImportIntake.buildMissingCoverQueue(succeededRows,coverOkByKey):[];
    lastImportMissingQueue=ImportIntake.replaceLastImportQueue?ImportIntake.replaceLastImportQueue(lastImportMissingQueue,built):built;
    renderLastImportCoverQueue();
    status($("#importStatus"),"كىرگۈزۈش توختىدى: "+(err.message||err),"error");
  }finally{
    importRunning=false;
    $("#confirmImportBtn").disabled=false;
    $("#importFile").disabled=false;
    if($("#importCoverFiles"))$("#importCoverFiles").disabled=false;
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
  bindAdminNavigation();
  if(window.__kutadguSkipAdminAuth){
    show("dashboardPanel");
    applyDashboardSectionFromLocation({replace:true});
    books=Array.isArray(window.__kutadguAdminPreviewBooks)?window.__kutadguAdminPreviewBooks:[];
    listTotal=books.length;
    if($("#adminBookList"))renderBooks();
    if($("#adminPager"))renderPager();
    $("#newBookBtn")&&($("#newBookBtn").onclick=openNew);
    $("#closeBookModal")&&($("#closeBookModal").onclick=()=>{if(!saveInFlight)modal(false)});
    $("#cancelBookEdit")&&($("#cancelBookEdit").onclick=()=>{if(!saveInFlight)modal(false)});
    $("#importCsvBtn")&&($("#importCsvBtn").onclick=openImport);
    $("#closeImportModal")&&($("#closeImportModal").onclick=closeImport);
    $("#cancelImportBtn")&&($("#cancelImportBtn").onclick=closeImport);
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
  $("#maintenanceToggleBtn")&&($("#maintenanceToggleBtn").onclick=toggleMaintenanceMode);
  bindAnnouncementAdmin();
  $("#newBookBtn").onclick=openNew;
  $("#closeBookModal").onclick=()=>{if(!saveInFlight)modal(false)};
  $("#cancelBookEdit").onclick=()=>{if(!saveInFlight)modal(false)};
  $("#bookForm").addEventListener("submit",saveBook);
  $("#importStaticBtn").onclick=importStatic;
  $("#adminSearch").addEventListener("input",scheduleSearch);
  $("#adminFilterSource").onchange=()=>{listFilters.source=$("#adminFilterSource").value;listPage=0;loadBooks()};
  $("#adminFilterActive").onchange=()=>{listFilters.active=$("#adminFilterActive").value;listPage=0;loadBooks()};
  $("#adminFilterRecommended").onchange=()=>{listFilters.recommended=$("#adminFilterRecommended").value;listPage=0;syncStatusFilterUi();loadBooks()};
  $("#adminFilterNew").onchange=()=>{listFilters.isNew=$("#adminFilterNew").value;listPage=0;syncStatusFilterUi();loadBooks()};
  document.querySelectorAll("[data-status-filter]").forEach(btn=>{
    btn.onclick=()=>applyStatusChip(btn.dataset.statusFilter);
  });
  syncStatusFilterUi();
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
  document.addEventListener("click",e=>{
    const btn=e.target&&e.target.closest&&e.target.closest(".last-import-repair-btn");
    if(!btn)return;
    e.preventDefault();
    openCoverRepairFromQueue(btn.getAttribute("data-repair-id"));
  });
  $("#importFile").addEventListener("change",()=>{
    refreshImportPreviewFromInputs();
  });
  $("#importCoverFiles")&&$("#importCoverFiles").addEventListener("change",()=>{
    refreshImportPreviewFromInputs();
  });
  $("#importDupIsbn")&&$("#importDupIsbn").addEventListener("change",refreshImportPlanSummary);
  $("#coverRepairPreviewBtn")&&($("#coverRepairPreviewBtn").onclick=previewCoverRepair);
  $("#coverRepairConfirmBtn")&&($("#coverRepairConfirmBtn").onclick=confirmCoverRepair);
  $("#coverRepairLookup")&&$("#coverRepairLookup").addEventListener("input",()=>{
    invalidateCoverRepairOnLookupChange();
  });
  $("#coverRepairFile")&&$("#coverRepairFile").addEventListener("change",()=>{
    const file=selectedCoverRepairFile();
    if(coverRepairDraft)coverRepairDraft.file=file;
    if(coverRepairDraft&&coverRepairDraft.book){
      renderCoverRepairPreview(coverRepairDraft.book,file);
      if(file)status($("#coverRepairStatus"),"رەسىم تاللاندى. جەزملەشتۈرمىگۈچە يېزىلمايدۇ.","ok");
    }else if($("#coverRepairConfirmBtn")){
      $("#coverRepairConfirmBtn").disabled=true;
    }
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
  parseCsvText,rowsToObjects,mapImportRow,normalizeIsbn,isbnLooksValid,formatIsbn,parseBoolCell,parseNumberCell,resolveCategory,searchSafe,searchOrFilter,postgrestIlike,selectedIdList,assertSelectedIds,writeBookRow,applyBooksSchema,ignoredImportColumns,PAGE_SIZE,IMPORT_BATCH,presentBookCols,OPTIONAL_BOOK_COLS,rowToInsert,normalizeGalleryField,planGallerySelection:()=>(window.KutadguGallery||{}).planGallerySelection,canonicalBookId,persistBookRow,planCurrentSave,logSavePlan,findCreateConflicts,renderCreateConflict,applyListFilters,listFilters,matchedStatusChip,STATUS_CHIP_PRESETS,statusBadgesHtml,loadExistingForImport,selectedImportCoverFiles,ImportCovers,CoverRepair,lookupCoverRepairBook,coverOnlyPayload:()=>CoverRepair.coverOnlyPayload,ImportIntake,openCoverRepairFromQueue,parseMaintenanceFlag,renderMaintenanceCard,clampAnnounceInterval,isMissingAnnounceTable,toDatetimeLocal,fromDatetimeLocal,ADMIN_SECTIONS,DEFAULT_ADMIN_SECTION,parseAdminSectionHash,showAdminSection,dashboardAuthorized
};
})();
