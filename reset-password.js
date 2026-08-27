(function(){
"use strict";

const cfg=window.KUTADGU_SUPABASE_CONFIG||{};
const $=s=>document.querySelector(s);
let db=null;
let recoveryReady=false;

function returnTarget(){
  return new URLSearchParams(location.search).get("next")==="admin"?"admin.html":"account.html";
}

function status(msg,type=""){
  const el=$("#resetStatus");
  if(!el)return;
  el.textContent=msg;
  el.className=`admin-status ${type}`.trim();
}

function configured(){
  return !!(String(cfg.url||"").trim() && String(cfg.anonKey||cfg.publishableKey||"").trim());
}

function setFormEnabled(enabled){
  const form=$("#resetPasswordForm");
  if(!form)return;
  form.querySelectorAll("input,button").forEach(el=>el.disabled=!enabled);
}

async function establishRecoverySession(){
  const params=new URLSearchParams(location.search);
  const hashParams=new URLSearchParams(String(location.hash||"").replace(/^#/,""));
  const code=params.get("code");
  const tokenHash=params.get("token_hash")||hashParams.get("token_hash");
  const otpType=String(params.get("type")||hashParams.get("type")||"recovery").toLowerCase();

  if(code){
    const {error}=await db.auth.exchangeCodeForSession(code);
    if(error)throw error;
  }else if(tokenHash){
    const {error}=await db.auth.verifyOtp({token_hash:tokenHash,type:otpType==="recovery"?"recovery":otpType});
    if(error)throw error;
  }

  for(let i=0;i<12;i++){
    const {data}=await db.auth.getSession();
    if(data?.session)return data.session;
    await new Promise(r=>setTimeout(r,250));
  }
  return null;
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

  db=window.supabase.createClient(cfg.url,cfg.anonKey||cfg.publishableKey,{
    auth:{detectSessionInUrl:true,persistSession:true,flowType:"pkce"}
  });
  setFormEnabled(false);
  status("پارول يېڭىلاش ئۇلانمىسى تەكشۈرۈلۈۋاتىدۇ...");

  let authSub=null;

  try{
    const {data:sub}=db.auth.onAuthStateChange((event,session)=>{
      if((event==="PASSWORD_RECOVERY" || event==="SIGNED_IN") && session){
        recoveryReady=true;
        setFormEnabled(true);
        status("✅ پارول يېڭىلاش رۇخسىتى توغرا. يېڭى پارولىڭىزنى كىرگۈزۈڭ.","ok");
      }
    });
    authSub=sub;

    const session=await establishRecoverySession();

    if(session){
      recoveryReady=true;
      setFormEnabled(true);
      status("✅ پارول يېڭىلاش رۇخسىتى توغرا. يېڭى پارولىڭىزنى كىرگۈزۈڭ.","ok");
    }else{
      status("بۇ بەتنى «پارولنى ئۇنتۇپ قالدىڭىزمۇ؟» ئارقىلىق Email غا كەلگەن يېڭى ئۇلانمىدىن ئېچىڭ.","warn");
    }
  }catch(err){
    status("پارول يېڭىلاش ئۇلانمىسىنى ئېچىش مەغلۇپ بولدى: "+(err.message||err),"error");
  }

  $("#resetPasswordForm").addEventListener("submit",async e=>{
    e.preventDefault();

    if(!recoveryReady){
      status("پارول يېڭىلاش رۇخسىتى تېپىلمىدى. Email غا كەلگەن يېڭى recovery ئۇلانمىسىدىن بۇ بەتنى قايتا ئېچىڭ.","warn");
      return;
    }

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

    status("✅ پارول مۇۋەپپەقىيەتلىك يېڭىلاندى. ھازىر كىرىش بېتىگە قايتىسىز.","ok");
    await db.auth.signOut();
    authSub?.subscription?.unsubscribe?.();
    setTimeout(()=>location.replace(returnTarget()),1200);
  });
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
