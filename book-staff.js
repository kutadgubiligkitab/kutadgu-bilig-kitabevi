(function(){
"use strict";
const $=s=>document.querySelector(s);
const ALLOWED_FIELDS=["title","author","category","price","image_url","description","source","original_price","stock","isbn","translator","publisher","publish_year","pages","cover_type","book_size","dimensions","is_color_print","interior_print_type","gallery_images"];
const FORBIDDEN_FIELDS=["id","legacy_id","language","href","publish_date","created_at","updated_at","sales_count","is_active","is_available","is_new","is_featured","is_recommended","is_bestseller","submission_status","submitted_by","submitted_at"];
const COVER_TYPES=["hardcover","paperback","other"];
const BOOK_SIZES=["A4","A5","B5","other"];
const INTERIOR=["color","bw"];
const IMAGE_TYPES=["image/jpeg","image/png","image/webp","image/gif"];
const MAX_COVER_BYTES=5*1024*1024;
const MAX_STAFF_GALLERY=4;
const STAFF_COVER_ORIGIN="https://fxlojnqwyojqjskfggmh.supabase.co";
const STAFF_COVER_BUCKET="book-covers";
let mfaGateCtl=null;
let mfaAttachCtl=null;
let staffUid="";
let staffRouteSeq=0;
let lastStaffPanel="staffLoading";
let galleryDraft=[];

function memberApi(){return window.KutadguMember}
function mfaApi(){return window.KutadguAdminMfa||{}}
function db(){
  try{return memberApi()&&memberApi().getClient&&memberApi().getClient()}catch(e){return null}
}
function currentStaffUserId(){
  try{
    const user=memberApi()&&memberApi().getUser&&memberApi().getUser();
    return user&&user.id?String(user.id):"";
  }catch(e){return ""}
}
function beginStaffRoute(){
  return {seq:++staffRouteSeq,uid:currentStaffUserId()};
}
function isCurrentStaffRoute(token){
  return !!(token && token.seq===staffRouteSeq && token.uid===currentStaffUserId());
}
function invalidateStaffRoutes(){
  staffRouteSeq++;
  staffUid="";
}
function suggestionCatalogRows(){
  return Array.isArray(window.__kutadguSuggestionRows)?window.__kutadguSuggestionRows:[];
}
function bindBookEntrySuggestions(){
  const S=window.KutadguBookEntrySuggest;
  if(!S||window.__kutadguStaffSuggestBound)return;
  window.__kutadguStaffSuggestBound=true;
  if(!Array.isArray(window.__kutadguSuggestionRows))window.__kutadguSuggestionRows=[];
  const getRows=()=>suggestionCatalogRows();
  if($("#staffAuthor"))S.attachCombobox($("#staffAuthor"),()=>S.uniqueValuesFromRows(getRows(),"author"));
  if($("#staffTranslator"))S.attachCombobox($("#staffTranslator"),()=>S.uniqueValuesFromRows(getRows(),"translator"));
  if($("#staffPublisher"))S.attachCombobox($("#staffPublisher"),()=>S.uniqueValuesFromRows(getRows(),"publisher"));
  if($("#staffTitle"))S.attachTitleWarning($("#staffTitle"),getRows,{box:$("#staffTitleSimilarWarning")});
}
function loadStaffSuggestionRows(){
  const S=window.KutadguBookEntrySuggest;
  if(!S||window.__kutadguSkipSuggestFetch)return;
  const client=db();
  if(!client||typeof client.from!=="function")return;
  S.loadSuggestionRows(client,{cacheKey:"staff"}).then(function(rows){
    window.__kutadguSuggestionRows=rows||[];
  });
}
function showPanel(id,token){
  if(token && !isCurrentStaffRoute(token))return;
  lastStaffPanel=id;
  ["staffLoading","staffSignedOut","staffForbidden","mfaGatePanel","mfaEnrollPanelWrap","staffWorkspace"].forEach(name=>{
    const el=$("#"+name);if(el)el.hidden=name!==id;
  });
  if(id==="staffWorkspace")loadStaffSuggestionRows();
}
function setStatus(el,message,type){
  if(!el)return;el.hidden=!message;el.textContent=message||"";el.className=("account-status "+(type||"")).trim();
}
function categoryOptions(){
  const map=new Map();
  (window.KUTADGU_APP_CONFIG&&window.KUTADGU_APP_CONFIG.catalogCategories||[]).forEach(item=>{
    if(item&&item.source&&!map.has(item.source))map.set(item.source,item.label||item.source);
  });
  return [...map.entries()];
}
function fillSourceOptions(){
  const sel=$("#staffSource");if(!sel)return;
  const current=sel.value;
  sel.innerHTML='<option value="">تۈر تاللاڭ</option>'+categoryOptions().map(([source,label])=>`<option value="${esc(source)}">${esc(label)}</option>`).join("");
  if(current)sel.value=current;
}
function esc(value){return String(value??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function isActiveStaffResult(data){
  if(data===true)return true;
  if(Array.isArray(data))return data[0]===true;
  return false;
}
async function rpcIsBookStaff(client){
  if(!client||typeof client.rpc!=="function")return {ok:false,staff:false};
  try{
    const result=await client.rpc("is_kutadgu_book_staff");
    if(result&&result.error)return {ok:false,staff:false,error:result.error};
    return {ok:true,staff:isActiveStaffResult(result&&result.data)};
  }catch(error){
    return {ok:false,staff:false,error:error};
  }
}
function staffCoverObjectPath(uid,file){
  const ext=String((file&&file.name||"cover.jpg").split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
  const now=new Date();
  const y=now.getUTCFullYear();
  const m=String(now.getUTCMonth()+1).padStart(2,"0");
  const d=String(now.getUTCDate()).padStart(2,"0");
  const rand=Math.random().toString(36).slice(2,8);
  return "staff/"+String(uid)+"/"+y+m+d+"-"+rand+"-cover."+ext;
}
function configuredCoverOrigin(){
  const cfg=window.KUTADGU_SUPABASE_CONFIG||{};
  return String(cfg.url||"").replace(/\/$/,"");
}
function configuredCoverBucket(){
  const cfg=window.KUTADGU_SUPABASE_CONFIG||{};
  return String(cfg.bucket||STAFF_COVER_BUCKET);
}
function staffCoverPublicUrl(uid,objectPath){
  const id=String(uid||"");
  const path=String(objectPath||"").replace(/^\/+/,"");
  if(!id||path.indexOf("staff/"+id+"/")!==0)throw new Error("مۇقاۋا يولى توغرا ئەمەس.");
  if(path.includes("..")||/[?#@]/.test(path))throw new Error("مۇقاۋا يولى توغرا ئەمەس.");
  if(configuredCoverOrigin()!==STAFF_COVER_ORIGIN)throw new Error("مۇقاۋا ئادرېسى توغرا ئەمەس.");
  if(configuredCoverBucket()!==STAFF_COVER_BUCKET)throw new Error("مۇقاۋا ئادرېسى توغرا ئەمەس.");
  return STAFF_COVER_ORIGIN+"/storage/v1/object/public/"+STAFF_COVER_BUCKET+"/"+path;
}
function assertStaffCoverPublicUrl(uid,url){
  const id=String(uid||"");
  const t=String(url||"").trim();
  let parsed=null;
  try{parsed=new URL(t)}catch(e){parsed=null}
  if(!parsed||parsed.protocol!=="https:"||parsed.origin!==STAFF_COVER_ORIGIN)throw new Error("مۇقاۋا ئادرېسى توغرا ئەمەس.");
  if(parsed.search||parsed.hash||parsed.username||parsed.password)throw new Error("مۇقاۋا ئادرېسى توغرا ئەمەس.");
  if(/[?#@]/.test(t)||t.includes(".."))throw new Error("مۇقاۋا ئادرېسى توغرا ئەمەس.");
  const expected="/storage/v1/object/public/"+STAFF_COVER_BUCKET+"/staff/"+id+"/";
  if(parsed.pathname.indexOf(expected)!==0)throw new Error("مۇقاۋا ئادرېسى توغرا ئەمەس.");
  return parsed.origin+parsed.pathname;
}
function galleryFileExtension(file){
  const valid=validateCoverFile(file);
  if(!valid)throw new Error("رەسىم ھۆججىتى JPEG، PNG، WebP ياكى GIF بولسۇن.");
  const map={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif"};
  const ext=map[valid.type];
  if(!ext)throw new Error("رەسىم ھۆججىتى JPEG، PNG، WebP ياكى GIF بولسۇن.");
  return ext;
}
function isSafeStaffGalleryFilename(name){
  const rest=String(name||"");
  return !!rest && !rest.includes("/") && /^[A-Za-z0-9._-]+$/.test(rest) && /\.(jpe?g|png|webp|gif)$/i.test(rest);
}
function staffGalleryObjectPath(uid,file,index){
  const ext=galleryFileExtension(file);
  const now=new Date();
  const y=now.getUTCFullYear();
  const m=String(now.getUTCMonth()+1).padStart(2,"0");
  const d=String(now.getUTCDate()).padStart(2,"0");
  const rand=Math.random().toString(36).slice(2,8);
  const n=String(Math.max(0,Number(index)||0));
  return "staff/"+String(uid)+"/gallery/"+y+m+d+"-"+rand+"-"+n+"."+ext;
}
function staffGalleryPublicUrl(uid,objectPath){
  const id=String(uid||"");
  const path=String(objectPath||"").replace(/^\/+/,"");
  if(!id||path.indexOf("staff/"+id+"/gallery/")!==0)throw new Error("ئىچكى رەسىم يولى توغرا ئەمەس.");
  if(path.includes("..")||/[?#@]/.test(path))throw new Error("ئىچكى رەسىم يولى توغرا ئەمەس.");
  const rest=path.slice(("staff/"+id+"/gallery/").length);
  if(!isSafeStaffGalleryFilename(rest))throw new Error("ئىچكى رەسىم يولى توغرا ئەمەس.");
  if(configuredCoverOrigin()!==STAFF_COVER_ORIGIN)throw new Error("ئىچكى رەسىم ئادرېسى توغرا ئەمەس.");
  if(configuredCoverBucket()!==STAFF_COVER_BUCKET)throw new Error("ئىچكى رەسىم ئادرېسى توغرا ئەمەس.");
  return STAFF_COVER_ORIGIN+"/storage/v1/object/public/"+STAFF_COVER_BUCKET+"/"+path;
}
function assertStaffGalleryPublicUrl(uid,url){
  const id=String(uid||"");
  const t=String(url||"").trim();
  if(!t||t.length>2000)throw new Error("ئىچكى رەسىم ئادرېسى توغرا ئەمەس.");
  let parsed=null;
  try{parsed=new URL(t)}catch(e){parsed=null}
  if(!parsed||parsed.protocol!=="https:"||parsed.origin!==STAFF_COVER_ORIGIN)throw new Error("ئىچكى رەسىم ئادرېسى توغرا ئەمەس.");
  if(parsed.search||parsed.hash||parsed.username||parsed.password)throw new Error("ئىچكى رەسىم ئادرېسى توغرا ئەمەس.");
  if(/[?#@]/.test(t)||t.includes(".."))throw new Error("ئىچكى رەسىم ئادرېسى توغرا ئەمەس.");
  const expected="/storage/v1/object/public/"+STAFF_COVER_BUCKET+"/staff/"+id+"/gallery/";
  if(parsed.pathname.indexOf(expected)!==0)throw new Error("ئىچكى رەسىم ئادرېسى توغرا ئەمەس.");
  const rest=parsed.pathname.slice(expected.length);
  if(!isSafeStaffGalleryFilename(rest))throw new Error("ئىچكى رەسىم ئادرېسى توغرا ئەمەس.");
  return parsed.origin+parsed.pathname;
}
const KNOWN_SAMPLE_COVER_SHA256={
  "596d3ed8ffab73b6c5b9059cd97cba5e12e9222da66dd0efe5bf3eaaa4aae183":true,
  "2e144fd20d419c3360b53dca21ce97df2f105b7f637cc48644b043fddb4bc6b9":true
};
function isSampleDemoCoverName(name){
  return /(?:^|\/)(?:sample-book-cover(?:\(\d+\))?|carousel-sample-cover)\.png(?:$|\?)/i.test(String(name||"").trim());
}
function validateCoverFile(file){
  if(!file)return null;
  if(isSampleDemoCoverName(file.name))throw new Error("ئۆرنەك ياكى سىناق مۇقاۋىسىنى ھەقىقىي كىتاب مۇقاۋىسى قىلىپ ساقلىغىلى بولمايدۇ.");
  if(IMAGE_TYPES.indexOf(file.type)<0)throw new Error("رەسىم ھۆججىتى JPEG، PNG، WebP ياكى GIF بولسۇن.");
  if(file.size>MAX_COVER_BYTES)throw new Error("مۇقاۋا رەسىمى 5MB دىن ئېشىپ كەتمىسۇن.");
  return file;
}
async function staffCoverSha256(file){
  if(!file||typeof file.arrayBuffer!=="function"||typeof crypto==="undefined"||!crypto.subtle){
    throw new Error("مۇقاۋا fingerprint ھېسابلاشنى بۇ browser قوللىمايدۇ. Browser نى يېڭىلاپ قايتا سىناڭ.");
  }
  const digest=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map(function(b){return b.toString(16).padStart(2,"0")}).join("");
}
async function rejectUnsafeStaffCover(client,file){
  validateCoverFile(file);
  const sha=await staffCoverSha256(file);
  if(KNOWN_SAMPLE_COVER_SHA256[sha])throw new Error("ئۆرنەك ياكى سىناق مۇقاۋىسىنى ھەقىقىي كىتاب مۇقاۋىسى قىلىپ ساقلىغىلى بولمايدۇ.");
  return sha;
}
function parseNonNegNumber(raw,label){
  const t=String(raw||"").trim();
  if(!t)return null;
  if(!/^[0-9]+(\.[0-9]+)?$/.test(t))throw new Error(label+" سان بولسۇن.");
  const n=Number(t);
  if(!Number.isFinite(n)||n<0)throw new Error(label+" 0 ياكى ئۇنىڭدىن چوڭ بولسۇن.");
  return n;
}
function parseNonNegInt(raw,label){
  const t=String(raw||"").trim();
  if(!t)return null;
  if(!/^[0-9]+$/.test(t))throw new Error(label+" پۈتۈن سان بولسۇن.");
  const n=Number(t);
  if(!Number.isInteger(n)||n<0)throw new Error(label+" 0 ياكى ئۇنىڭدىن چوڭ پۈتۈن سان بولسۇن.");
  return n;
}
function parsePositiveInt(raw,label){
  const n=parseNonNegInt(raw,label);
  if(n==null)return null;
  if(n<1)throw new Error(label+" 1 ياكى ئۇنىڭدىن چوڭ بولسۇن.");
  return n;
}
function buildPayload(values){
  const payload={};
  const title=String(values.title||"").trim();
  const author=String(values.author||"").trim();
  const source=String(values.source||"").trim();
  const category=String(values.category||"").trim();
  if(!title||!author||!source||!category)throw new Error("كىتاب نامى، ئاپتور، تۈر ۋە مەنبە تولدۇرۇلسۇن.");
  const price=parseNonNegNumber(values.price,"باھا");
  if(price==null)throw new Error("باھا تولدۇرۇلسۇن.");
  payload.title=title;
  payload.author=author;
  payload.source=source;
  payload.category=category;
  payload.price=price;
  const original=parseNonNegNumber(values.original_price,"ئەسلى باھا");
  if(original!=null)payload.original_price=original;
  const stock=parseNonNegInt(values.stock,"ئامبار");
  if(stock!=null)payload.stock=stock;
  const pages=parsePositiveInt(values.pages,"بەت سانى");
  if(pages!=null)payload.pages=pages;
  const year=parseNonNegInt(values.publish_year,"نەشر يىلى");
  if(year!=null){
    if(year<1000||year>2100)throw new Error("نەشر يىلى 1000–2100 بولسۇن.");
    payload.publish_year=year;
  }
  const isbn=String(values.isbn||"").trim();
  if(isbn)payload.isbn=isbn.slice(0,32);
  const translator=String(values.translator||"").trim();
  if(translator)payload.translator=translator;
  const publisher=String(values.publisher||"").trim();
  if(publisher)payload.publisher=publisher;
  const dimensions=String(values.dimensions||"").trim();
  if(dimensions)payload.dimensions=dimensions;
  const description=String(values.description||"").trim();
  if(description)payload.description=description;
  const coverType=String(values.cover_type||"").trim();
  if(coverType){
    if(COVER_TYPES.indexOf(coverType)<0)throw new Error("مۇقاۋا تۈرى توغرا ئەمەس.");
    payload.cover_type=coverType;
  }
  const bookSize=String(values.book_size||"").trim();
  if(bookSize){
    if(BOOK_SIZES.indexOf(bookSize)<0)throw new Error("كىتاب ئۆلچىمى توغرا ئەمەس.");
    payload.book_size=bookSize;
  }
  const interior=String(values.interior_print_type||"").trim();
  if(interior){
    if(INTERIOR.indexOf(interior)<0)throw new Error("ئىچكى بېسىش تىپى توغرا ئەمەس.");
    payload.interior_print_type=interior;
  }
  payload.is_color_print=!!values.is_color_print;
  const imageUrl=String(values.image_url||"").trim();
  if(isSampleDemoCoverName(imageUrl))throw new Error("ئۆرنەك ياكى سىناق مۇقاۋىسىنى ھەقىقىي كىتاب مۇقاۋىسى قىلىپ ساقلىغىلى بولمايدۇ.");
  if(imageUrl)payload.image_url=imageUrl;
  if(Object.prototype.hasOwnProperty.call(values,"gallery_images")){
    if(!Array.isArray(values.gallery_images))throw new Error("ئىچكى رەسىم تىزىمى توغرا ئەمەس.");
    if(values.gallery_images.length>MAX_STAFF_GALLERY)throw new Error("ئەڭ كۆپ 4 پارچە رەسىم تاللىغىلى بولىدۇ.");
    payload.gallery_images=values.gallery_images.map(url=>assertStaffGalleryPublicUrl(values.staff_uid||staffUid,url));
  }
  Object.keys(payload).forEach(key=>{
    if(FORBIDDEN_FIELDS.indexOf(key)>=0)throw new Error("قوغدىلىدىغان مەيدان يوللانمايدۇ.");
    if(ALLOWED_FIELDS.indexOf(key)<0)throw new Error("بۇ مەيدان يوللانمايدۇ: "+key);
  });
  return payload;
}
function formValues(){
  const source=$("#staffSource")&&$("#staffSource").value||"";
  const hit=categoryOptions().find(([src])=>src===source);
  return {
    title:$("#staffTitle")&&$("#staffTitle").value,
    author:$("#staffAuthor")&&$("#staffAuthor").value,
    source:source,
    category:hit?hit[1]:($("#staffCategory")&&$("#staffCategory").value||""),
    price:$("#staffPrice")&&$("#staffPrice").value,
    original_price:$("#staffOriginalPrice")&&$("#staffOriginalPrice").value,
    stock:$("#staffStock")&&$("#staffStock").value,
    isbn:$("#staffIsbn")&&$("#staffIsbn").value,
    translator:$("#staffTranslator")&&$("#staffTranslator").value,
    publisher:$("#staffPublisher")&&$("#staffPublisher").value,
    publish_year:$("#staffPublishYear")&&$("#staffPublishYear").value,
    pages:$("#staffPages")&&$("#staffPages").value,
    cover_type:$("#staffCoverType")&&$("#staffCoverType").value,
    book_size:$("#staffBookSize")&&$("#staffBookSize").value,
    dimensions:$("#staffDimensions")&&$("#staffDimensions").value,
    is_color_print:!!($("#staffColorPrint")&&$("#staffColorPrint").checked),
    interior_print_type:$("#staffInteriorPrint")&&$("#staffInteriorPrint").value,
    description:$("#staffDescription")&&$("#staffDescription").value
  };
}
function resetStaffForm(){
  const form=$("#staffBookForm");
  if(form)form.reset();
  fillSourceOptions();
  const cover=$("#staffCoverFile");if(cover)cover.value="";
  setCoverFileStatus(null);
  resetGallerySelection();
  const success=$("#staffSuccess");if(success)success.hidden=true;
  const bookForm=$("#staffBookForm");if(bookForm)bookForm.hidden=false;
  setStatus($("#staffSubmitStatus"),"", "");
}
function coverFileLabel(file){
  const raw=String(file&&file.name||"").replace(/\\/g,"/").split("/").pop();
  return raw.replace(/[<>\u0000-\u001f]/g,"");
}
function setCoverFileStatus(file){
  const el=$("#staffCoverFileName");
  if(!el)return;
  el.textContent=file?coverFileLabel(file):"رەسىم تاللانمىدى";
}
function bindCoverPicker(){
  const input=$("#staffCoverFile");
  const btn=$("#staffCoverPickBtn");
  if(btn&&input)btn.addEventListener("click",()=>input.click());
  if(input)input.addEventListener("change",()=>setCoverFileStatus(input.files&&input.files[0]));
}
function galleryPreviewUrl(file){
  try{
    if(typeof URL!=="undefined"&&URL.createObjectURL)return URL.createObjectURL(file);
  }catch(e){}
  return "";
}
function revokeGalleryPreview(item){
  if(!item||!item.preview||String(item.preview).indexOf("blob:")!==0)return;
  try{if(typeof URL!=="undefined"&&URL.revokeObjectURL)URL.revokeObjectURL(item.preview)}catch(e){}
}
function setGalleryFileStatus(){
  const el=$("#staffGalleryFileName");
  if(!el)return;
  el.textContent=galleryDraft.length?galleryDraft.length+" پارچە رەسىم تاللاندى":"رەسىم تاللانمىدى";
}
function renderGalleryDraft(){
  const host=$("#staffGalleryList");
  setGalleryFileStatus();
  if(!host)return;
  host.innerHTML=galleryDraft.map((item,index)=>{
    const src=item&&item.preview?esc(item.preview):"";
    return `<article class="staff-gallery-item">
      <span class="staff-gallery-num">${index+1}</span>
      ${src?`<img src="${src}" alt="${index+1}" draggable="false">`:"<div></div>"}
      <button type="button" class="account-secondary staff-gallery-remove" data-gallery-remove="${index}">ئۆچۈرۈش</button>
    </article>`;
  }).join("");
  host.querySelectorAll&&host.querySelectorAll("[data-gallery-remove]").forEach(btn=>{
    btn.addEventListener("click",()=>removeGalleryItem(Number(btn.getAttribute("data-gallery-remove"))));
  });
}
function addGalleryFiles(fileList){
  const incoming=[];
  if(fileList&&typeof fileList.length==="number"){
    for(let i=0;i<fileList.length;i++)if(fileList[i])incoming.push(fileList[i]);
  }
  if(!incoming.length)return {ok:true};
  if(galleryDraft.length+incoming.length>MAX_STAFF_GALLERY){
    return {ok:false,error:new Error("ئەڭ كۆپ 4 پارچە رەسىم تاللىغىلى بولىدۇ.")};
  }
  try{
    incoming.forEach(file=>validateCoverFile(file));
  }catch(error){
    return {ok:false,error:error};
  }
  incoming.forEach(file=>{
    galleryDraft.push({file:file,preview:galleryPreviewUrl(file)});
  });
  renderGalleryDraft();
  return {ok:true};
}
function removeGalleryItem(index){
  const i=Number(index);
  if(!Number.isInteger(i)||i<0||i>=galleryDraft.length)return;
  revokeGalleryPreview(galleryDraft[i]);
  galleryDraft.splice(i,1);
  renderGalleryDraft();
}
function resetGallerySelection(){
  galleryDraft.forEach(revokeGalleryPreview);
  galleryDraft=[];
  const input=$("#staffGalleryFiles");if(input)input.value="";
  renderGalleryDraft();
}
function bindGalleryPicker(){
  const input=$("#staffGalleryFiles");
  const btn=$("#staffGalleryPickBtn");
  if(btn&&input)btn.addEventListener("click",()=>input.click());
  if(input)input.addEventListener("change",()=>{
    const result=addGalleryFiles(input.files);
    input.value="";
    if(!result.ok)setStatus($("#staffSubmitStatus"),staffFriendlyMessage(result.error),"error");
  });
}
const STAFF_GENERIC_ERROR="مەشغۇلات تاماملانمىدى. سەل تۇرۇپ قايتا سىناڭ.";
const STAFF_KNOWN_ERRORS=[
  {re:/MFA\s+API\s+يوق/i,msg:"دەلىللەش مۇلازىمىتى تېپىلمىدى."},
  {re:/Authentication required/i,msg:"كىرىش كېرەك. قايتا كىرىڭ."},
  {re:/Book staff permission required/i,msg:"كىتاب قوشۇش ھوقۇقى يوق."},
  {re:/Admin permission required/i,msg:"بۇ مەشغۇلاتقا ھوقۇق يەتمىدى."},
  {re:/AAL2 required/i,msg:"2-باسقۇچلۇق دەلىللەش كېرەك."},
  {re:/Invalid book payload/i,msg:"كىتاب ئۇچۇرى توغرا ئەمەس."},
  {re:/Unsupported book field/i,msg:"بۇ مەيدان قوللىمايدۇ."},
  {re:/Client may not set publication or identity fields/i,msg:"بۇ مەيدانلارنى ئۆزگەرتكىلى بولمايدۇ."},
  {re:/title,\s*author,\s*category and source are required/i,msg:"ماۋزۇ، ئاپتور، تۈر ۋە مەنبە كېرەك."},
  {re:/price is required/i,msg:"باھا كېرەك ۋە مەنپىي بولمىسۇن."},
  {re:/price must be non-negative/i,msg:"باھا مەنپىي بولمىسۇن."},
  {re:/original_price must be/i,msg:"ئەسلى باھا توغرا ئەمەس."},
  {re:/stock must be/i,msg:"ئامبار سانى توغرا ئەمەس."},
  {re:/pages must be/i,msg:"بەت سانى توغرا ئەمەس."},
  {re:/publish_year/i,msg:"نەشر يىلى توغرا ئەمەس."},
  {re:/image_url must be empty/i,msg:"مۇقاۋا ئادرېسى توغرا ئەمەس."},
  {re:/invalid cover_type/i,msg:"مۇقاۋا تىپى توغرا ئەمەس."},
  {re:/invalid book_size/i,msg:"كىتاب چوڭلۇقى توغرا ئەمەس."},
  {re:/invalid interior_print_type/i,msg:"ئىچكى بېسىش تىپى توغرا ئەمەس."},
  {re:/gallery_images must be a JSON array/i,msg:"ئىچكى رەسىم تىزىمى توغرا ئەمەس."},
  {re:/gallery_images may contain at most 4/i,msg:"ئەڭ كۆپ 4 پارچە رەسىم تاللىغىلى بولىدۇ."},
  {re:/gallery_images items must be strings/i,msg:"ئىچكى رەسىم ئادرېسى توغرا ئەمەس."},
  {re:/gallery_images URL is invalid/i,msg:"ئىچكى رەسىم ئادرېسى توغرا ئەمەس."},
  {re:/gallery_images must be book-covers staff gallery URLs/i,msg:"ئىچكى رەسىم ئادرېسى توغرا ئەمەس."},
  {re:/jwt expired|invalid jwt|bad[_\s-]?jwt|session expired|refresh[_\s-]?token|Auth session missing|invalid[_\s-]?session|not authenticated/i,msg:"كىرىش ۋاقتى توشتى. قايتا كىرىڭ."},
  {re:/row-level security|\bRLS\b|permission denied|not allowed|not authorized|unauthorized|new row violates|storage.*policy|Bucket not found|object not found|mime type|payload too large|resource already exists|duplicate/i,msg:"ھۆججەت يوللاشقا رۇخسەت يوق ياكى مەغلۇپ بولدى."},
  {re:/failed to fetch|networkerror|network error|load failed|fetch failed|ERR_NETWORK|ECONNRESET|\btimeout\b|\boffline\b/i,msg:"تور ئۇلىنىشى مەغلۇپ بولدى. قايتا سىناڭ."}
];
function extractErrorText(err){
  if(err==null||err==="")return "";
  if(typeof err==="string")return err;
  if(typeof err.message==="string"&&err.message)return err.message;
  if(typeof err.error_description==="string"&&err.error_description)return err.error_description;
  try{return String(err)}catch(e){return ""}
}
function looksLikeSecret(text){
  return /eyJ[A-Za-z0-9_-]{20,}|\bservice_role\b|\bsbp_|\bsb_secret|Bearer\s+[A-Za-z0-9._-]+|-----BEGIN/i.test(String(text||""));
}
function staffVisibleCopy(text){
  let next=String(text||"")
    .replace(/MFA\s+API\s+يوق/gi,"دەلىللەش مۇلازىمىتى تېپىلمىدى.")
    .replace(/Authenticator/g,"دەلىللەش ئەپى")
    .replace(/\bTOTP\b/g,"دەلىللەش ئەپى")
    .replace(/\bAAL2\b/g,"2-باسقۇچلۇق دەلىللەش")
    .replace(/\bMFA\b/g,"دەلىللەش")
    .replace(/Admin قۇلۇپلانمايدۇ/g,"ھېساب قۇلۇپلانمايدۇ")
    .replace(/Admin نورمال ئىشلەيدۇ/g,"كىتاب يوللاش داۋاملىشىدۇ")
    .replace(/Admin كىرىش ئۆزگەرمىدى/g,"كىرىش ئۆزگەرمىدى");
  if(/\bAPI\b/i.test(next))return "دەلىللەش مۇلازىمىتى تېپىلمىدى.";
  return next;
}
function looksSafeStaffMessage(text){
  const t=String(text||"").trim();
  if(!t||looksLikeSecret(t))return false;
  if(/\b(API|MFA|TOTP|AAL2|Authenticator|JWT|RLS|PGRST|postgres|supabase)\b/i.test(t))return false;
  const stripped=t.replace(/\b(JPEG|PNG|WebP|GIF|ISBN|QR|MB|A4|A5|B5)\b/gi,"").replace(/[0-9./()\-–—,،:：]+/g,"").replace(/\s+/g,"");
  if(/[A-Za-z]/.test(stripped))return false;
  return /[\u0600-\u06FF]/.test(t);
}
function staffFriendlyMessage(err){
  const raw=extractErrorText(err).replace(/[<>\u0000-\u001f]/g,"");
  if(!raw||looksLikeSecret(raw))return STAFF_GENERIC_ERROR;
  for(let i=0;i<STAFF_KNOWN_ERRORS.length;i++){
    if(STAFF_KNOWN_ERRORS[i].re.test(raw))return STAFF_KNOWN_ERRORS[i].msg;
  }
  const visible=staffVisibleCopy(raw);
  if(looksSafeStaffMessage(visible))return visible;
  return STAFF_GENERIC_ERROR;
}
function localizeStaffMfaCopy(){
  ["mfaGateStatus","mfaStatus"].forEach(id=>{
    const el=$("#"+id);
    if(!el||!el.textContent)return;
    const next=staffFriendlyMessage(el.textContent);
    if(next!==el.textContent)el.textContent=next;
  });
  const qr=$("#mfaQr");
  if(qr&&qr.getAttribute){
    const alt=staffVisibleCopy(qr.getAttribute("alt")||"");
    if(alt)qr.setAttribute("alt",alt);
  }
}
let mfaCopyObserver=null;
function observeStaffMfaCopy(){
  if(mfaCopyObserver||typeof MutationObserver!=="function")return;
  mfaCopyObserver=new MutationObserver(()=>localizeStaffMfaCopy());
  ["mfaGateStatus","mfaStatus"].forEach(id=>{
    const el=$("#"+id);
    if(el)mfaCopyObserver.observe(el,{childList:true,characterData:true,subtree:true});
  });
}
function clearStaffPrivateUi(){
  staffUid="";
  resetStaffForm();
  const ident=$("#staffIdentity");if(ident)ident.textContent="";
  const logout=$("#staffLogout");if(logout)logout.hidden=true;
  const idEl=$("#staffNewBookId");if(idEl)idEl.textContent="";
}
async function requireAal2(client){
  const Mfa=mfaApi();
  if(typeof Mfa.ensurePrimarySessionReady==="function"){
    const ready=await Mfa.ensurePrimarySessionReady(()=>client);
    if(!ready||!ready.ok)throw new Error("كىرىش ۋاقتى توشتى. قايتا كىرىڭ.");
  }
  if(typeof Mfa.inspectAccess!=="function")throw new Error("دەلىللەش تەكشۈرۈلمىدى.");
  const inspect=await Mfa.inspectAccess(()=>client);
  const level=Mfa.normalizeLevel?Mfa.normalizeLevel(inspect&&inspect.assurance&&inspect.assurance.currentLevel):"";
  if(level!=="aal2")throw new Error("2-باسقۇچلۇق دەلىللەش كېرەك.");
  return inspect;
}
async function uploadStaffCover(client,uid,file){
  const valid=validateCoverFile(file);
  if(!valid)return "";
  await requireAal2(client);
  const staff=await rpcIsBookStaff(client);
  if(!staff.ok||!staff.staff)throw new Error("كىتاب قوشۇش ھوقۇقى يوق.");
  const cfg=window.KUTADGU_SUPABASE_CONFIG||{};
  const bucket=cfg.bucket||"book-covers";
  const path=staffCoverObjectPath(uid,valid);
  if(path.indexOf("staff/"+uid+"/")!==0)throw new Error("مۇقاۋا يولى توغرا ئەمەس.");
  if(bucket!==STAFF_COVER_BUCKET)throw new Error("مۇقاۋا ئادرېسى توغرا ئەمەس.");
  const {error}=await client.storage.from(bucket).upload(path,valid,{upsert:false,contentType:valid.type||undefined});
  if(error)throw error;
  const canonical=staffCoverPublicUrl(uid,path);
  let fromApi="";
  try{
    const pub=client.storage.from(bucket).getPublicUrl(path);
    fromApi=String(pub&&pub.data&&pub.data.publicUrl||"").trim();
  }catch(e){fromApi=""}
  if(fromApi){
    try{assertStaffCoverPublicUrl(uid,fromApi)}catch(e){fromApi=""}
  }
  return assertStaffCoverPublicUrl(uid,canonical);
}
async function uploadStaffGallery(client,uid,files){
  const list=Array.isArray(files)?files.filter(Boolean):[];
  if(!list.length)return [];
  if(list.length>MAX_STAFF_GALLERY)throw new Error("ئەڭ كۆپ 4 پارچە رەسىم تاللىغىلى بولىدۇ.");
  await requireAal2(client);
  const staff=await rpcIsBookStaff(client);
  if(!staff.ok||!staff.staff)throw new Error("كىتاب قوشۇش ھوقۇقى يوق.");
  const cfg=window.KUTADGU_SUPABASE_CONFIG||{};
  const bucket=cfg.bucket||"book-covers";
  if(bucket!==STAFF_COVER_BUCKET)throw new Error("ئىچكى رەسىم ئادرېسى توغرا ئەمەس.");
  const urls=[];
  for(let i=0;i<list.length;i++){
    const valid=validateCoverFile(list[i]);
    const path=staffGalleryObjectPath(uid,valid,i);
    if(path.indexOf("staff/"+uid+"/gallery/")!==0)throw new Error("ئىچكى رەسىم يولى توغرا ئەمەس.");
    const {error}=await client.storage.from(bucket).upload(path,valid,{upsert:false,contentType:valid.type||undefined});
    if(error)throw error;
    const canonical=assertStaffGalleryPublicUrl(uid,staffGalleryPublicUrl(uid,path));
    let publicUrl=canonical;
    try{
      const pub=client.storage.from(bucket).getPublicUrl(path);
      const fromApi=String(pub&&pub.data&&pub.data.publicUrl||"").trim();
      if(fromApi)publicUrl=assertStaffGalleryPublicUrl(uid,fromApi);
    }catch(e){
      publicUrl=canonical;
    }
    urls.push(assertStaffGalleryPublicUrl(uid,publicUrl));
  }
  return urls;
}
function staffSurface(inspect){
  const level=String(inspect&&inspect.assurance&&inspect.assurance.currentLevel||"").toLowerCase();
  if(level==="aal2")return "form";
  if(inspect&&inspect.classified&&inspect.classified.configured)return "gate";
  return "enroll";
}
function bindMfa(client){
  const Mfa=mfaApi();
  if(typeof Mfa.attachGate==="function"&&!mfaGateCtl){
    mfaGateCtl=Mfa.attachGate({
      getDb:()=>client,
      onAal2:()=>routeStaffSession(),
      onLogout:()=>logoutStaff(),
      onSessionInvalid:()=>logoutStaff(),
      onNoFactor:()=>routeStaffSession()
    });
  }
  if(typeof Mfa.attach==="function"&&!mfaAttachCtl){
    mfaAttachCtl=Mfa.attach({
      getDb:()=>client,
      isAdminSession:()=>!!currentStaffUserId()
    });
    const verifyBtn=$("#mfaVerifyBtn");
    if(verifyBtn){
      verifyBtn.onclick=async function(){
        if(mfaAttachCtl&&mfaAttachCtl.verifyOtp)await mfaAttachCtl.verifyOtp();
        localizeStaffMfaCopy();
        await afterStaffMfaVerified();
      };
    }
    observeStaffMfaCopy();
  }
}
async function afterStaffMfaVerified(){
  await routeStaffSession();
  localizeStaffMfaCopy();
}
async function routeStaffSession(){
  if(window.__kutadguSkipStaffRoute){
    showPanel("staffWorkspace");
    return;
  }
  const token=beginStaffRoute();
  const member=memberApi();
  if(!member){showPanel("staffSignedOut",token);return}
  await member.ready;
  if(!isCurrentStaffRoute(token))return;
  const user=member.getUser&&member.getUser();
  const logout=$("#staffLogout");
  if(!user||!user.id){
    if(!isCurrentStaffRoute(token))return;
    clearStaffPrivateUi();
    showPanel("staffSignedOut",token);
    return;
  }
  if(token.uid && token.uid!==String(user.id))return;
  staffUid=String(user.id);
  if(logout)logout.hidden=false;
  const ident=$("#staffIdentity");
  if(ident)ident.textContent=user.email||"";
  const client=db();
  if(!client){showPanel("staffSignedOut",token);return}
  const staff=await rpcIsBookStaff(client);
  if(!isCurrentStaffRoute(token))return;
  if(!staff.ok||!staff.staff){
    showPanel("staffForbidden",token);
    return;
  }
  bindMfa(client);
  if(!isCurrentStaffRoute(token))return;
  const Mfa=mfaApi();
  const inspect=typeof Mfa.inspectAccess==="function"?await Mfa.inspectAccess(()=>client):{assurance:{currentLevel:null},classified:{configured:false}};
  if(!isCurrentStaffRoute(token))return;
  const surface=staffSurface(inspect);
  if(surface==="form"){
    fillSourceOptions();
    showPanel("staffWorkspace",token);
    return;
  }
  if(surface==="gate"){
    showPanel("mfaGatePanel",token);
    localizeStaffMfaCopy();
    return;
  }
  showPanel("mfaEnrollPanelWrap",token);
  if(mfaAttachCtl&&mfaAttachCtl.refresh)await mfaAttachCtl.refresh();
  localizeStaffMfaCopy();
}
async function logoutStaff(){
  invalidateStaffRoutes();
  clearStaffPrivateUi();
  showPanel("staffSignedOut");
  const member=memberApi();
  if(member&&member.signOut)await member.signOut();
}
async function submitBook(e){
  e.preventDefault();
  const status=$("#staffSubmitStatus");
  const btn=$("#staffSubmitBtn");
  setStatus(status,"","");
  const client=db();
  const user=memberApi()&&memberApi().getUser&&memberApi().getUser();
  if(!client||!user){showPanel("staffSignedOut");return}
  btn.disabled=true;
  try{
    const staff=await rpcIsBookStaff(client);
    if(!staff.ok||!staff.staff){showPanel("staffForbidden");return}
    await requireAal2(client);
    let imageUrl="";
    const file=$("#staffCoverFile")&&$("#staffCoverFile").files&&$("#staffCoverFile").files[0];
    if(file){
      await rejectUnsafeStaffCover(client,file);
      const live=$("#staffCoverFile")&&$("#staffCoverFile").files&&$("#staffCoverFile").files[0];
      if(live!==file)throw new Error("مۇقاۋا تاللىشى ئۆزگەرگەن. قايتا تاللاپ ساقلاڭ.");
      imageUrl=await uploadStaffCover(client,String(user.id),file);
    }
    if(imageUrl)imageUrl=assertStaffCoverPublicUrl(String(user.id),imageUrl);
    const galleryUrls=await uploadStaffGallery(client,String(user.id),galleryDraft.map(item=>item&&item.file));
    const values=formValues();
    values.image_url=imageUrl;
    values.staff_uid=String(user.id);
    values.gallery_images=galleryUrls;
    const payload=buildPayload(values);
    const {data,error}=await client.rpc("submit_book_for_approval",{payload:payload});
    if(error)throw error;
    const newId=Array.isArray(data)?data[0]:data;
    $("#staffBookForm").hidden=true;
    $("#staffSuccess").hidden=false;
    $("#staffNewBookId").textContent=String(newId||"");
    const cover=$("#staffCoverFile");if(cover)cover.value="";
    resetGallerySelection();
  }catch(err){
    setStatus(status,staffFriendlyMessage(err),"error");
  }finally{
    btn.disabled=false;
  }
}

window.KutadguBookStaff={
  ALLOWED_FIELDS,
  FORBIDDEN_FIELDS,
  STAFF_COVER_ORIGIN,
  STAFF_COVER_BUCKET,
  isActiveStaffResult,
  staffCoverObjectPath,
  staffCoverPublicUrl,
  assertStaffCoverPublicUrl,
  galleryFileExtension,
  staffGalleryObjectPath,
  staffGalleryPublicUrl,
  assertStaffGalleryPublicUrl,
  addGalleryFiles,
  removeGalleryItem,
  resetGallerySelection,
  galleryDraft:function(){return galleryDraft.slice()},
  MAX_STAFF_GALLERY,
  buildPayload,
  staffSurface,
  validateCoverFile,
  rejectUnsafeStaffCover,
  isSampleDemoCoverName,
  beginStaffRoute,
  isCurrentStaffRoute,
  invalidateStaffRoutes,
  routeStaffSession,
  logoutStaff,
  afterStaffMfaVerified,
  staffVisibleCopy,
  staffFriendlyMessage,
  STAFF_GENERIC_ERROR,
  setCoverFileStatus,
  lastStaffPanel:function(){return lastStaffPanel}
};

async function init(){
  fillSourceOptions();
  bindCoverPicker();
  bindGalleryPicker();
  bindBookEntrySuggestions();
  document.addEventListener("kutadgu-member-change",()=>{routeStaffSession()});
  const logout=$("#staffLogout");if(logout)logout.onclick=()=>logoutStaff();
  const form=$("#staffBookForm");if(form)form.addEventListener("submit",submitBook);
  const another=$("#staffAddAnother");if(another)another.onclick=()=>resetStaffForm();
  const source=$("#staffSource");
  if(source)source.addEventListener("change",()=>{
    const hit=categoryOptions().find(([src])=>src===source.value);
    if($("#staffCategory"))$("#staffCategory").value=hit?hit[1]:"";
  });
  try{
    const member=memberApi();
    if(window.__kutadguSkipStaffRoute){
      showPanel("staffWorkspace");
      return;
    }
    if(!member){showPanel("staffSignedOut");return}
    await member.ready;
    await routeStaffSession();
  }catch(e){
    showPanel("staffSignedOut");
  }
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
