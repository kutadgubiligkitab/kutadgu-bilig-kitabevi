(function(){
"use strict";

const cfg=window.KUTADGU_SUPABASE_CONFIG||{};
const $=s=>document.querySelector(s);
let db=null;

function status(msg,type=""){
  const el=$("#resetStatus");
  el.textContent=msg;
  el.className=`admin-status ${type}`.trim();
}

function configured(){
  return !!(String(cfg.url||"").trim() && String(cfg.anonKey||cfg.publishableKey||"").trim());
}

async function init(){
  if(!configured()){
    status("Supabase سەپلىمىسى تېپىلمىدى.","error");
    $("#resetPasswordForm").hidden=true;
    return;
  }
  if(!window.supabase?.createClient){
    status("Supabase كۈتۈپخانىسى يۈكلەنمىدى.","error");
    $("#resetPasswordForm").hidden=true;
    return;
  }

  db=window.supabase.createClient(cfg.url,cfg.anonKey||cfg.publishableKey);

  // Supabase v2 URL دىكى recovery session/code نى ئۆزى تونۇيدۇ.
  // Session قۇرۇلۇشىغا ئازراق ۋاقىت بېرىمىز.
  await new Promise(r=>setTimeout(r,350));
  const {data}=await db.auth.getSession();

  if(data?.session){
    status("✅ پارول يېڭىلاش رۇخسىتى توغرا. يېڭى پارولىڭىزنى كىرگۈزۈڭ.","ok");
  }else{
    // بەزى recovery links session نى auth event ئارقىلىق كېچىكىپ بېرىدۇ.
    let recovered=false;
    const {data:sub}=db.auth.onAuthStateChange((event,session)=>{
      if((event==="PASSWORD_RECOVERY" || event==="SIGNED_IN") && session){
        recovered=true;
        status("✅ پارول يېڭىلاش رۇخسىتى توغرا. يېڭى پارولىڭىزنى كىرگۈزۈڭ.","ok");
      }
    });
    setTimeout(()=>{
      if(!recovered){
        status("بۇ بەتنى Admin دىكى «پارولنى ئۇنتۇپ قالدىڭىزمۇ؟» ئارقىلىق Email غا كەلگەن يېڭى ئۇلانمىدىن ئېچىڭ.","warn");
      }
      sub?.subscription?.unsubscribe?.();
    },2200);
  }

  $("#resetPasswordForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const p1=$("#newPassword").value;
    const p2=$("#confirmPassword").value;

    if(p1.length<8){
      status("پارول كەم دېگەندە 8 ھەرپ/بەلگە بولسۇن.","warn");
      return;
    }
    if(p1!==p2){
      status("ئىككى پارول بىر-بىرىگە ماس كەلمىدى.","warn");
      return;
    }

    const btn=$("#savePasswordBtn");
    btn.disabled=true;
    btn.textContent="ساقلىنىۋاتىدۇ...";
    const {error}=await db.auth.updateUser({password:p1});

    if(error){
      status("پارول ساقلاش مەغلۇپ بولدى: "+error.message,"error");
      btn.disabled=false;
      btn.textContent="💾 يېڭى پارولنى ساقلاش";
      return;
    }

    status("✅ پارول مۇۋەپپەقىيەتلىك يېڭىلاندى. ھازىر Admin كىرىش بېتىگە قايتىسىز.","ok");
    await db.auth.signOut();
    setTimeout(()=>location.replace("admin.html"),1200);
  });
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();