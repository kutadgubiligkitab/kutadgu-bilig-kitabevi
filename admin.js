(function(){
"use strict";

const cfg=window.KUTADGU_SUPABASE_CONFIG||{};
const STATIC=[...(window.KITAP_CATALOG||[])];
const $=s=>document.querySelector(s);
let db=null,user=null,books=[],editing=null,members=[],orders=[];

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
function idForNew(){return `book-${Date.now().toString(36)}`}
function categoryOptions(){
  const map=new Map();
  STATIC.forEach(b=>{if(b.source&&!map.has(b.source))map.set(b.source,b.category||b.source)});
  return [...map.entries()].sort((a,b)=>a[1].localeCompare(b[1],"ug"));
}
function sourceCategory(source){
  return categoryOptions().find(x=>x[0]===source)?.[1]||source;
}
function renderSourceOptions(){
  const sel=$("#bookSource");if(!sel)return;
  sel.innerHTML='<option value="">تۈر تاللاڭ</option>'+categoryOptions().map(([source,cat])=>`<option value="${esc(source)}">${esc(cat)}</option>`).join("");
}
function show(id){
  ["setupPanel","loginPanel","dashboardPanel"].forEach(x=>$("#"+x).hidden=x!==id);
}
function modal(open){
  $("#bookModal").hidden=!open;
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
  user=session.user;
  $("#adminLogout").hidden=false;
  show("dashboardPanel");
  await Promise.all([loadBooks(),loadMembers()]);
}
async function loadBooks(){
  status($("#adminStatus"),"كىتابلار يۈكلىنىۋاتىدۇ...");
  const {data,error}=await db.from("books").select("*").order("created_at",{ascending:false});
  if(error){status($("#adminStatus"),"Database دىن كىتاب ئوقۇش مەغلۇپ بولدى: "+error.message,"error");return}
  books=data||[];
  status($("#adminStatus"),`Admin كىرىش مۇۋەپپەقىيەتلىك — ${user?.email||""}`,"ok");
  renderStats();
  renderBooks();
}
function renderStats(){
  $("#statAll").textContent=books.length;
  $("#statActive").textContent=books.filter(b=>b.is_active!==false).length;
  $("#statRecommended").textContent=books.filter(b=>b.is_recommended===true).length;
  $("#statStock").textContent=books.reduce((s,b)=>s+(Number(b.stock)||0),0);
}
function renderBooks(){
  const host=$("#adminBookList");
  const q=String($("#adminSearch")?.value||"").trim().toLocaleLowerCase("ug");
  const filtered=books.filter(b=>!q||`${b.title||""} ${b.author||""} ${b.category||""}`.toLocaleLowerCase("ug").includes(q));
  if(!filtered.length){host.innerHTML='<div class="admin-empty">كىتاب تېپىلمىدى.</div>';return}
  host.innerHTML=filtered.map(b=>`
    <article class="admin-book-row ${b.is_active===false?"admin-hidden-book":""}">
      ${b.image_url?`<img src="${esc(b.image_url)}" alt="${esc(b.title)}" onerror="this.style.visibility='hidden'">`:"<div>📕</div>"}
      <div>
        <div class="admin-book-title">${esc(b.title)}</div>
        <div class="admin-book-meta">${esc(b.author||"—")} · ${esc(b.category||"")} · ${money(b.price)} · ئامبار ${Number(b.stock)||0}</div>
        <div class="admin-book-meta">${b.is_active===false?"🙈 يوشۇرۇلغان":"✅ كۆرۈنىدۇ"} ${b.is_recommended?" · ⭐ تەۋسىيە":""} ${b.is_new?" · 🆕 يېڭى":""}</div>
      </div>
      <div class="admin-book-actions">
        <a href="${esc(b.href||`book.html?id=${encodeURIComponent(b.id)}`)}" target="_blank">👁️ كۆرۈش</a>
        <button type="button" data-edit="${esc(b.id)}">✏️ تەھرىرلەش</button>
        <button type="button" data-hide="${esc(b.id)}">${b.is_active===false?"♻️ قايتا كۆرسىتىش":"🙈 يوشۇرۇش"}</button>
      </div>
    </article>`).join("");

  host.querySelectorAll("[data-edit]").forEach(btn=>btn.onclick=()=>openEdit(btn.dataset.edit));
  host.querySelectorAll("[data-hide]").forEach(btn=>btn.onclick=()=>toggleActive(btn.dataset.hide));
}
function dateText(value){
  if(!value)return "—";
  const d=new Date(value);if(Number.isNaN(d.getTime()))return "—";
  return new Intl.DateTimeFormat("tr-TR",{dateStyle:"medium",timeStyle:"short"}).format(d);
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
function clearForm(){
  editing=null;
  $("#bookForm").reset();
  $("#bookId").value=idForNew();
  $("#bookIsActive").checked=true;
  $("#bookIsNew").checked=true;
  $("#bookIsRecommended").checked=false;
  $("#bookStock").value=0;
  $("#bookCoverPreview").src="";
  $("#bookCoverPreview").style.visibility="hidden";
  $("#bookCoverText").textContent="رەسىم تاللانمىدى";
  $("#bookModalTitle").textContent="➕ يېڭى كىتاب";
}
function openNew(){
  clearForm();
  modal(true);
}
function openEdit(id){
  const b=books.find(x=>x.id===id);if(!b)return;
  editing=b;
  $("#bookModalTitle").textContent="✏️ كىتابنى تەھرىرلەش";
  $("#bookId").value=b.id;
  $("#bookTitle").value=b.title||"";
  $("#bookAuthor").value=b.author||"";
  $("#bookPrice").value=b.price??"";
  $("#bookStock").value=b.stock??0;
  $("#bookSource").value=b.source||"";
  $("#bookPages").value=b.pages??"";
  $("#bookTranslator").value=b.translator||"";
  $("#bookLanguage").value=b.language||"";
  $("#bookPublishDate").value=b.publish_date||"";
  $("#bookPublisher").value=b.publisher||"";
  $("#bookDescription").value=b.description||"";
  $("#bookIsActive").checked=b.is_active!==false;
  $("#bookIsNew").checked=b.is_new!==false;
  $("#bookIsRecommended").checked=b.is_recommended===true;
  $("#bookCoverPreview").src=b.image_url||"";
  $("#bookCoverPreview").style.visibility=b.image_url?"visible":"hidden";
  $("#bookCoverText").textContent=b.image_url?"ھازىرقى مۇقاۋا":"مۇقاۋا يوق";
  modal(true);
}
async function uploadCover(id,file){
  if(!file)return editing?.image_url||"";
  const bucket=cfg.bucket||"book-covers";
  const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
  const path=`${id}/${Date.now()}.${ext}`;
  const {error}=await db.storage.from(bucket).upload(path,file,{upsert:false,contentType:file.type||undefined});
  if(error)throw error;
  const {data}=db.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
async function saveBook(e){
  e.preventDefault();
  const id=$("#bookId").value||idForNew();
  const source=$("#bookSource").value;
  if(!source){alert("كىتاب تۈرىنى تاللاڭ.");return}
  const submit=$("#bookForm button[type='submit']");
  submit.disabled=true;
  submit.textContent="ساقلىنىۋاتىدۇ...";
  try{
    const imageUrl=await uploadCover(id,$("#bookCover").files[0]);
    const row={
      id,
      title:$("#bookTitle").value.trim(),
      author:$("#bookAuthor").value.trim(),
      price:$("#bookPrice").value===""?null:Number($("#bookPrice").value),
      category:sourceCategory(source),
      source,
      image_url:imageUrl,
      href:editing?.href||`book.html?id=${encodeURIComponent(id)}`,
      pages:$("#bookPages").value===""?null:Number($("#bookPages").value),
      translator:$("#bookTranslator").value.trim(),
      language:$("#bookLanguage").value.trim(),
      publish_date:$("#bookPublishDate").value.trim(),
      publisher:$("#bookPublisher").value.trim(),
      description:$("#bookDescription").value.trim(),
      stock:Number($("#bookStock").value)||0,
      is_active:$("#bookIsActive").checked,
      is_new:$("#bookIsNew").checked,
      is_recommended:$("#bookIsRecommended").checked
    };
    const {error}=await db.from("books").upsert(row,{onConflict:"id"});
    if(error)throw error;
    modal(false);
    await loadBooks();
  }catch(err){
    alert("ساقلاش مەغلۇپ بولدى:\n"+(err.message||err));
  }finally{
    submit.disabled=false;
    submit.textContent="💾 ساقلاش";
  }
}
async function toggleActive(id){
  const b=books.find(x=>x.id===id);if(!b)return;
  const next=b.is_active===false;
  const {error}=await db.from("books").update({is_active:next}).eq("id",id);
  if(error){alert(error.message);return}
  await loadBooks();
}
async function importStatic(){
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
      stock:0
    }));
    const {error}=await db.from("books").upsert(rows,{onConflict:"id"});
    if(error)throw error;
    await loadBooks();
    alert("ھازىرقى كىتابلار Database قا مۇۋەپپەقىيەتلىك كىرگۈزۈلدى ✅");
  }catch(err){
    alert("كىرگۈزۈش مەغلۇپ بولدى:\n"+(err.message||err));
  }finally{
    btn.disabled=false;btn.textContent="📥 ھازىرقى كىتابلارنى Database قا كىرگۈزۈش";
  }
}

async function requestPasswordReset(){
  const email=$("#adminEmail").value.trim();
  if(!email){
    status($("#loginStatus"),"ئاۋۋال Email ئادرېسىڭىزنى كىرگۈزۈڭ.","warn");
    $("#adminEmail").focus();
    return;
  }
  status($("#loginStatus"),"پارول يېڭىلاش ئۇلانمىسى ئەۋەتىلىۋاتىدۇ...");
  const base=location.pathname.replace(/admin\.html.*$/,"");
  const redirectTo=`${location.origin}${base}reset-password.html?next=admin`;
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

function init(){
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
  $("#closeBookModal").onclick=()=>modal(false);
  $("#cancelBookEdit").onclick=()=>modal(false);
  $("#bookForm").addEventListener("submit",saveBook);
  $("#importStaticBtn").onclick=importStatic;
  $("#adminSearch").addEventListener("input",renderBooks);
  $("#memberSearch").addEventListener("input",renderMembers);
  $("#reloadMembers").onclick=loadMembers;
  $("#bookCover").addEventListener("change",()=>{
    const file=$("#bookCover").files[0];
    if(!file)return;
    $("#bookCoverPreview").src=URL.createObjectURL(file);
    $("#bookCoverPreview").style.visibility="visible";
    $("#bookCoverText").textContent=file.name;
  });
  $("#bookModal").addEventListener("click",e=>{if(e.target===$("#bookModal"))modal(false)});
  db.auth.onAuthStateChange(()=>setTimeout(routeSession,0));
  routeSession();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
