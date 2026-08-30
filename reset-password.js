(function(){
"use strict";

const cfg=window.KUTADGU_SUPABASE_CONFIG||{};
const $=s=>document.querySelector(s);
let db=null;
let recoveryReady=false;

function returnTarget(){
  return new URLSearchParams(location.search).get("next")==="admin"?"admin.html":"account.html";
}

function recoveryParams(){
  const params=new URLSearchParams(location.search);
  const hashParams=new URLSearchParams(String(location.hash||"").replace(/^#/,""));
  const type=String(params.get("type")||hashParams.get("type")||"").toLowerCase();
  const next=String(params.get("next")||"").toLowerCase();
  const code=params.get("code")||hashParams.get("code");
  const tokenHash=params.get("token_hash")||hashParams.get("token_hash");
  return {params,hashParams,type,next,code,tokenHash};
}

function isExplicitRecoveryType(type){
  return type==="recovery";
}

function isIntendedRecoveryLink(info){
  if(isExplicitRecoveryType(info.type))return true;
  if((info.next==="account"||info.next==="admin")&&(info.code||info.tokenHash))return true;
  return false;
}

function isGenericOauthCode(info){
  if(!info.code)return false;
  if(isExplicitRecoveryType(info.type))return false;
  if(info.next==="account"||info.next==="admin")return false;
  return true;
}

function sendGenericOauthToAccount(info){
  const dest=new URL("account.html",location.href);
  info.params.forEach((value,key)=>{if(key)dest.searchParams.set(key,value)});
  dest.hash=location.hash||"";
  location.replace(dest.pathname+dest.search+dest.hash);
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

function markRecoveryReady(){
  recoveryReady=true;
  setFormEnabled(true);
  status("✅ پارول يېڭىلاش رۇخسىتى توغرا. يېڭى پارولىڭىزنى كىرگۈزۈڭ.","ok");
}

async function establishRecoverySession(info){
  const otpType=isExplicitRecoveryType(info.type)?"recovery":(info.type||"recovery");
  let consumed=false;

  if(info.code){
    const {error}=await db.auth.exchangeCodeForSession(info.code);
    if(error)throw error;
    consumed=true;
  }else if(info.tokenHash && (isExplicitRecoveryType(info.type) || !info.type)){
    const {error}=await db.auth.verifyOtp({token_hash:info.tokenHash,type:otpType==="recovery"?"recovery":otpType});
    if(error)throw error;
    consumed=true;
  }

  if(!consumed)return null;

  for(let i=0;i<12;i++){
    const {data}=await db.auth.getSession();
    if(data?.session)return data.session;
    await new Promise(r=>setTimeout(r,250));
  }
  return null;
}

async function init(){
  const info=recoveryParams();

  if(isGenericOauthCode(info)){
    sendGenericOauthToAccount(info);
    return;
  }

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
    auth:{
      detectSessionInUrl:isExplicitRecoveryType(info.type),
      persistSession:true,
      flowType:"pkce"
    }
  });
  setFormEnabled(false);

  if(!isIntendedRecoveryLink(info)){
    status("بۇ بەتنى «پارولنى ئۇنتۇپ قالدىڭىزمۇ؟» ئارقىلىق Email غا كەلگەن يېڭى ئۇلانمىدىن ئېچىڭ.","warn");
    return;
  }

  status("پارول يېڭىلاش ئۇلانمىسى تەكشۈرۈلۈۋاتىدۇ...");

  let authSub=null;

  try{
    const {data:sub}=db.auth.onAuthStateChange((event,session)=>{
      if(event==="PASSWORD_RECOVERY" && session)markRecoveryReady();
    });
    authSub=sub;

    const session=await establishRecoverySession(info);

    if(session && (info.code || info.tokenHash))markRecoveryReady();
    else if(!recoveryReady && !isExplicitRecoveryType(info.type)){
      status("بۇ بەتنى «پارولنى ئۇنتۇپ قالدىڭىزمۇ؟» ئارقىلىق Email غا كەلگەن يېڭى ئۇلانمىدىن ئېچىڭ.","warn");
    }else if(!recoveryReady){
      setTimeout(()=>{
        if(!recoveryReady)status("بۇ بەتنى «پارولنى ئۇنتۇپ قالدىڭىزمۇ؟» ئارقىلىق Email غا كەلگەن يېڭى ئۇلانمىدىن ئېچىڭ.","warn");
      },3000);
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

window.kutadguResetPasswordTest={
  returnTarget,
  isExplicitRecoveryType,
  isIntendedRecoveryLink,
  isGenericOauthCode
};

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
