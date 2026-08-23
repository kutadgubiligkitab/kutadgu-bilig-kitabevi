(function(){
"use strict";
const $=s=>document.querySelector(s);
const api=()=>window.KutadguMember;
const statusLabels={prepared:"تەييارلاندى",confirmed:"جەزملەشتۈرۈلدى",processing:"تەييارلىنىۋاتىدۇ",shipped:"كارگوغا بېرىلدى",completed:"تاماملاندى",cancelled:"بىكار قىلىندى"};

function showStatus(el,message,type=""){
  if(!el)return;el.hidden=false;el.textContent=message;el.className=`account-status ${type}`.trim();
}
function clearStatus(el){if(el)el.hidden=true}
function dateText(value){
  if(!value)return "—";
  const d=new Date(value);if(Number.isNaN(d.getTime()))return "—";
  const two=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-يىلى ${d.getMonth()+1}-ئاينىڭ ${d.getDate()}-كۈنى، ${two(d.getHours())}:${two(d.getMinutes())}`;
}
function money(value){return `${Number(value||0).toLocaleString("tr-TR")} ₺`}
function esc(value){return String(value??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function setBusy(form,busy,text){
  const button=form?.querySelector('button[type="submit"]');if(!button)return;
  if(!button.dataset.label)button.dataset.label=button.textContent;
  button.disabled=busy;button.textContent=busy?text:button.dataset.label;
}
function showPanel(id){
  ["accountLoading","accountSetup","authPanel","memberPanel"].forEach(name=>{const el=$("#"+name);if(el)el.hidden=name!==id});
}
function switchTab(tab){
  document.querySelectorAll("[data-auth-tab]").forEach(btn=>{
    const active=btn.dataset.authTab===tab;btn.classList.toggle("is-active",active);btn.setAttribute("aria-selected",active?"true":"false");
  });
  $("#loginForm").hidden=tab!=="login";$("#signupForm").hidden=tab!=="signup";
  $("#authTitle").textContent=tab==="signup"?"يېڭى ئەزالىق ئېچىڭ":"ھېسابىڭىزغا كىرىڭ";
  $("#authSubtitle").textContent=tab==="signup"?"بىر مىنۇتتا ھېساب قۇرۇپ، كىتابلىرىڭىزنى ساقلاڭ.":"ساقلانغان كىتاب، سېۋەت ۋە زاكازلىرىڭىزنى كۆرۈڭ.";
  clearStatus($("#authStatus"));
}
async function renderOrders(){
  const host=$("#orderList");
  try{
    const orders=await api().getOrders();$("#memberOrders").textContent=orders.length;
    if(!orders.length){host.innerHTML='<div class="account-empty">ھازىرچە زاكاز تارىخى يوق.<br><a href="index.html#books">كىتاب كۆرۈش →</a></div>';return}
    host.innerHTML=orders.map(order=>{
      const items=Array.isArray(order.items)?order.items:[];
      return `<article class="member-order">
        <div class="member-order-head">
          <div><div class="member-order-no">${esc(order.order_no)}</div><div class="member-order-date">${dateText(order.created_at)}</div></div>
          <span class="member-order-status is-${esc(order.status)}">${esc(statusLabels[order.status]||order.status)}</span>
        </div>
        <div class="member-order-meta">${Number(order.total_qty)||0} دانە كىتاب · ${money(order.total)}</div>
        <div class="member-order-items">${items.map(x=>`${esc(x.title||x.book_id||"كىتاب")} × ${Number(x.qty)||1}`).join(" · ")}</div>
      </article>`;
    }).join("");
  }catch(err){host.innerHTML=`<div class="account-empty">زاكازلارنى ئوقۇش مەغلۇپ بولدى: ${esc(err.message||err)}</div>`}
}
async function renderMember(){
  const member=api(),user=member.getUser(),profile=member.getProfile();
  if(!user){showPanel("authPanel");return}
  showPanel("memberPanel");
  $("#memberWelcome").textContent=profile?.full_name||"ھېسابىم";
  $("#memberEmail").textContent=user.email||profile?.email||"";
  $("#memberCreated").textContent=dateText(profile?.created_at||user.created_at);
  $("#memberLastSeen").textContent=dateText(profile?.last_seen_at);
  $("#memberVisits").textContent=Number(profile?.visit_count)||0;
  $("#profileName").value=profile?.full_name||"";
  $("#profilePhone").value=profile?.phone||"";
  $("#profileCountry").value=profile?.country||"";
  $("#profileCity").value=profile?.city||"";
  $("#profileAddress").value=profile?.address||"";
  api().applyFieldDirections(document);
  await renderOrders();
}
async function init(){
  document.querySelectorAll("[data-auth-tab]").forEach(btn=>btn.onclick=()=>switchTab(btn.dataset.authTab));
  try{
    await api().ready;
    if(!api().configured()){showPanel("accountSetup");return}
    if(api().isBlocked()){
      showPanel("authPanel");
      showStatus($("#authStatus"),"بۇ ھېساب باشقۇرغۇچى تەرىپىدىن ۋاقىتلىق توختىتىلغان.","error");
      return;
    }
    await renderMember();
  }catch(err){showPanel("accountSetup")}

  $("#loginForm").addEventListener("submit",async e=>{
    e.preventDefault();const form=e.currentTarget;clearStatus($("#authStatus"));setBusy(form,true,"كىرىۋاتىدۇ...");
    try{
      await api().signIn({email:$("#loginEmail").value.trim(),password:$("#loginPassword").value});
      await renderMember();
    }catch(err){showStatus($("#authStatus"),"كىرىش مەغلۇپ بولدى: "+(err.message||err),"error")}
    finally{setBusy(form,false)}
  });

  $("#googleSignIn").addEventListener("click",async e=>{
    const button=e.currentTarget;
    clearStatus($("#authStatus"));
    if(!button.dataset.label)button.dataset.label=button.innerHTML;
    button.disabled=true;button.querySelector("span").textContent="Google غا ئۇلىنىۋاتىدۇ...";
    try{
      await api().signInWithGoogle();
    }catch(err){
      const message=String(err.message||err);
      const friendly=/provider.*not enabled|unsupported provider/i.test(message)
        ?"Google ئارقىلىق كىرىش تېخى Supabase تا قوزغىتىلمىدى."
        :"Google ئارقىلىق كىرىش مەغلۇپ بولدى: "+message;
      showStatus($("#authStatus"),friendly,"error");
      button.disabled=false;button.innerHTML=button.dataset.label;
    }
  });

  $("#signupForm").addEventListener("submit",async e=>{
    e.preventDefault();const form=e.currentTarget,p1=$("#signupPassword").value,p2=$("#signupConfirm").value;
    clearStatus($("#authStatus"));
    if(p1!==p2){showStatus($("#authStatus"),"ئىككى پارول بىر-بىرىگە ماس كەلمىدى.","warn");return}
    setBusy(form,true,"ھېساب ئېچىلىۋاتىدۇ...");
    try{
      const data=await api().signUp({email:$("#signupEmail").value.trim(),password:p1,fullName:$("#signupName").value.trim()});
      if(data.session)await renderMember();
      else{switchTab("login");$("#loginEmail").value=$("#signupEmail").value.trim();showStatus($("#authStatus"),"✅ ئەزالىق قۇرۇلدى. ئېلخەتتىكى جەزملەشتۈرۈش ئۇلانمىسىنى بېسىپ ئاندىن كىرىڭ.","ok")}
    }catch(err){showStatus($("#authStatus"),"ئەزالىق ئېچىش مەغلۇپ بولدى: "+(err.message||err),"error")}
    finally{setBusy(form,false)}
  });

  $("#forgotPassword").onclick=async()=>{
    const email=$("#loginEmail").value.trim();
    if(!email){showStatus($("#authStatus"),"ئاۋۋال ئېلخەت ئادرېسىڭىزنى كىرگۈزۈڭ.","warn");$("#loginEmail").focus();return}
    try{await api().resetPassword(email,"account");showStatus($("#authStatus"),"✅ پارول يېڭىلاش ئۇلانمىسى ئېلخەتكە ئەۋەتىلدى.","ok")}
    catch(err){showStatus($("#authStatus"),"ئۇلانما ئەۋەتىش مەغلۇپ بولدى: "+(err.message||err),"error")}
  };

  $("#memberLogout").onclick=async()=>{await api().signOut();switchTab("login");showPanel("authPanel")};
  $("#profileForm").addEventListener("submit",async e=>{
    e.preventDefault();const form=e.currentTarget;clearStatus($("#profileStatus"));setBusy(form,true,"ساقلىنىۋاتىدۇ...");
    try{
      await api().updateProfile({full_name:$("#profileName").value,phone:$("#profilePhone").value,country:$("#profileCountry").value,city:$("#profileCity").value,address:$("#profileAddress").value});
      showStatus($("#profileStatus"),"✅ ئارخىپىڭىز ساقланды.","ok");await renderMember();
    }catch(err){showStatus($("#profileStatus"),"ساقلاش مەغلۇپ بولدى: "+(err.message||err),"error")}
    finally{setBusy(form,false)}
  });

  document.addEventListener("kutadgu-member-change",()=>{if(api().isBlocked()){showPanel("authPanel");showStatus($("#authStatus"),"بۇ ھېساب باشقۇرغۇچى تەرىپىدىن ۋاقىتلىق توختىتىلغان.","error")}});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
