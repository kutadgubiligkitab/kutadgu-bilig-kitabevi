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
  const hasAccessToken=!!(hashParams.get("access_token")||params.get("access_token"));
  const hasProviderToken=!!(hashParams.get("provider_token")||params.get("provider_token"));
  return {params,hashParams,type,next,code,tokenHash,hasAccessToken,hasProviderToken};
}

function isExplicitRecoveryType(type){
  return type==="recovery";
}

function recoveryHashTokens(info){
  if(!info||info.hasProviderToken)return null;
  if(!isExplicitRecoveryType(info.type))return null;
  const access=String((info.hashParams&&info.hashParams.get("access_token"))||(info.params&&info.params.get("access_token"))||"").trim();
  const refresh=String((info.hashParams&&info.hashParams.get("refresh_token"))||(info.params&&info.params.get("refresh_token"))||"").trim();
  if(!access||!refresh)return null;
  return {access_token:access,refresh_token:refresh};
}

function isIntendedRecoveryLink(info){
  if(info.hasProviderToken)return false;
  if(recoveryHashTokens(info))return true;
  if(!info.tokenHash)return false;
  return isExplicitRecoveryType(info.type);
}

function isGenericOauthCallback(info){
  if(info.hasProviderToken)return true;
  if(info.hasAccessToken && !isExplicitRecoveryType(info.type))return true;
  return false;
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

function stripRecoverySecretsFromUrl(){
  try{
    const next=new URLSearchParams(location.search).get("next");
    const dest=new URL(location.pathname,location.href);
    dest.searchParams.set("type","recovery");
    if(next==="admin"||next==="account")dest.searchParams.set("next",next);
    history.replaceState(null,"",dest.pathname+dest.search);
  }catch(error){}
}

function markRecoveryReady(){
  recoveryReady=true;
  setFormEnabled(true);
  stripRecoverySecretsFromUrl();
  status("✅ پارول يېڭىلاش رۇخسىتى توغرا. يېڭى پارولىڭىزنى كىرگۈزۈڭ.","ok");
}

async function waitForSession(){
  for(let i=0;i<12;i++){
    const {data:now}=await db.auth.getSession();
    if(now?.session)return now.session;
    await new Promise(r=>setTimeout(r,250));
  }
  return null;
}

async function establishRecoverySession(info){
  if(!isIntendedRecoveryLink(info))return null;
  if(info.tokenHash){
    const {data,error}=await db.auth.verifyOtp({token_hash:info.tokenHash,type:"recovery"});
    if(error)throw error;
    if(data?.session)return data.session;
    return waitForSession();
  }
  const tokens=recoveryHashTokens(info);
  if(tokens){
    const {data,error}=await db.auth.setSession({
      access_token:tokens.access_token,
      refresh_token:tokens.refresh_token
    });
    if(error)throw error;
    if(data?.session)return data.session;
    return waitForSession();
  }
  return null;
}

async function init(){
  const info=recoveryParams();

  if(isGenericOauthCallback(info)){
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
    auth:{detectSessionInUrl:false,persistSession:true,flowType:"pkce"}
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

    if(session)markRecoveryReady();
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
  isGenericOauthCallback,
  recoveryHashTokens,
  usesPkceCodeExchange:false
};

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
