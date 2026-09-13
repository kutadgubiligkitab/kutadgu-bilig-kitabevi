(function(){
"use strict";
const $=s=>document.querySelector(s);
const ALLOWED_FIELDS=["title","author","category","price","image_url","description","source","original_price","stock","isbn","translator","publisher","publish_year","pages","cover_type","book_size","dimensions","is_color_print","interior_print_type"];
const FORBIDDEN_FIELDS=["id","legacy_id","language","href","publish_date","created_at","updated_at","sales_count","is_active","is_available","is_new","is_featured","is_recommended","is_bestseller","submission_status","submitted_by","submitted_at","gallery_images"];
const COVER_TYPES=["hardcover","paperback","other"];
const BOOK_SIZES=["A4","A5","B5","other"];
const INTERIOR=["color","bw"];
const IMAGE_TYPES=["image/jpeg","image/png","image/webp","image/gif"];
const MAX_COVER_BYTES=5*1024*1024;
let mfaGateCtl=null;
let mfaAttachCtl=null;
let staffUid="";

function memberApi(){return window.KutadguMember}
function mfaApi(){return window.KutadguAdminMfa||{}}
function db(){
  try{return memberApi()&&memberApi().getClient&&memberApi().getClient()}catch(e){return null}
}
function showPanel(id){
  ["staffLoading","staffSignedOut","staffForbidden","mfaGatePanel","mfaEnrollPanelWrap","staffWorkspace"].forEach(name=>{
    const el=$("#"+name);if(el)el.hidden=name!==id;
  });
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
function validateCoverFile(file){
  if(!file)return null;
  if(IMAGE_TYPES.indexOf(file.type)<0)throw new Error("رەسىم ھۆججىتى JPEG، PNG، WebP ياكى GIF بولسۇن.");
  if(file.size>MAX_COVER_BYTES)throw new Error("مۇقاۋا رەسىمى 5MB دىن ئېشىپ كەتمىسۇن.");
  return file;
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
  if(imageUrl)payload.image_url=imageUrl;
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
  const success=$("#staffSuccess");if(success)success.hidden=true;
  const bookForm=$("#staffBookForm");if(bookForm)bookForm.hidden=false;
  setStatus($("#staffSubmitStatus"),"", "");
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
  if(typeof Mfa.inspectAccess!=="function")throw new Error("MFA تەكشۈرۈلمىدى.");
  const inspect=await Mfa.inspectAccess(()=>client);
  const level=Mfa.normalizeLevel?Mfa.normalizeLevel(inspect&&inspect.assurance&&inspect.assurance.currentLevel):"";
  if(level!=="aal2")throw new Error("AAL2 required");
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
  const {error}=await client.storage.from(bucket).upload(path,valid,{upsert:false,contentType:valid.type||undefined});
  if(error)throw error;
  return path;
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
      isAdminSession:()=>!!(memberApi()&&memberApi().getUser&&memberApi().getUser())
    });
  }
}
async function routeStaffSession(){
  const member=memberApi();
  if(!member){showPanel("staffSignedOut");return}
  await member.ready;
  const user=member.getUser&&member.getUser();
  const logout=$("#staffLogout");
  if(!user||!user.id){
    clearStaffPrivateUi();
    showPanel("staffSignedOut");
    return;
  }
  staffUid=String(user.id);
  if(logout)logout.hidden=false;
  const ident=$("#staffIdentity");
  if(ident)ident.textContent=user.email||"";
  const client=db();
  if(!client){showPanel("staffSignedOut");return}
  const staff=await rpcIsBookStaff(client);
  if(!staff.ok||!staff.staff){
    showPanel("staffForbidden");
    return;
  }
  bindMfa(client);
  const Mfa=mfaApi();
  const inspect=typeof Mfa.inspectAccess==="function"?await Mfa.inspectAccess(()=>client):{assurance:{currentLevel:null},classified:{configured:false}};
  const surface=staffSurface(inspect);
  if(surface==="form"){
    fillSourceOptions();
    showPanel("staffWorkspace");
    return;
  }
  if(surface==="gate"){
    showPanel("mfaGatePanel");
    return;
  }
  showPanel("mfaEnrollPanelWrap");
  if(mfaAttachCtl&&mfaAttachCtl.refresh)await mfaAttachCtl.refresh();
}
async function logoutStaff(){
  const member=memberApi();
  if(member&&member.signOut)await member.signOut();
  clearStaffPrivateUi();
  showPanel("staffSignedOut");
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
    if(file)imageUrl=await uploadStaffCover(client,String(user.id),file);
    const values=formValues();
    values.image_url=imageUrl;
    const payload=buildPayload(values);
    const {data,error}=await client.rpc("submit_book_for_approval",{payload:payload});
    if(error)throw error;
    const newId=Array.isArray(data)?data[0]:data;
    $("#staffBookForm").hidden=true;
    $("#staffSuccess").hidden=false;
    $("#staffNewBookId").textContent=String(newId||"");
    const cover=$("#staffCoverFile");if(cover)cover.value="";
  }catch(err){
    setStatus(status,String(err&&err.message||err),"error");
  }finally{
    btn.disabled=false;
  }
}

window.KutadguBookStaff={
  ALLOWED_FIELDS,
  FORBIDDEN_FIELDS,
  isActiveStaffResult,
  staffCoverObjectPath,
  buildPayload,
  staffSurface,
  validateCoverFile
};

async function init(){
  fillSourceOptions();
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
    if(!member){showPanel("staffSignedOut");return}
    await member.ready;
    await routeStaffSession();
  }catch(e){
    showPanel("staffSignedOut");
  }
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
