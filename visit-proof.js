(()=>{
  if(window.__kutadguVisitProofStarted)return;
  window.__kutadguVisitProofStarted=true;
  const ACTION="visit";
  const NOTE="زىيارەت سانىنى دەلىللەش ئۈچۈن بۇ تەكشۈرۈشنى تاماملاڭ.";
  const RETRY_NOTE="ساناش تېخى تاماملانمىدى. قايتا سىناش بۇ بەتنى توسمايدۇ.";
  const STOP_NOTE="ساناش بۇ قېتىم تاماملانمىدى. بەت ئىشلىتىشكە ئوچۇق.";
  const MAX_RETRIES=3;
  const PROOF_REASONS=["cookie_missing","verification_expired","cookie_invalid"];
  let flow=null;

  function uuid(){
    const bytes=new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6]=(bytes[6]&15)|64;
    bytes[8]=(bytes[8]&63)|128;
    const hex=Array.from(bytes,item=>item.toString(16).padStart(2,"0")).join("");
    return hex.slice(0,8)+"-"+hex.slice(8,12)+"-"+hex.slice(12,16)+"-"+hex.slice(16,20)+"-"+hex.slice(20);
  }
  function analyticsEnabled(){
    return window.KUTADGU_APP_CONFIG?.featureFlags?.analyticsHooks!==false;
  }
  function exerciseHost(){
    const host=String(location.hostname||"").toLowerCase();
    return document.documentElement.hasAttribute("data-kutadgu-visit-exercise")&&(host==="127.0.0.1"||host==="localhost");
  }
  function allowedHost(){
    const host=String(location.hostname||"").toLowerCase();
    return host==="www.kutadgubilik.com"||host==="kutadgubilik.com";
  }
  async function post(path,body){
    const response=await fetch(path,{
      method:"POST",
      credentials:"same-origin",
      headers:{"content-type":"application/json"},
      body:JSON.stringify(body||{})
    });
    let payload=null;
    try{payload=await response.json();}catch(err){payload=null;}
    if(payload&&typeof payload==="object"&&!Array.isArray(payload))return payload;
    return {ok:false,counted:false,reason:"unavailable"};
  }
  function settled(result){
    return !!(result&&result.ok===true);
  }
  function ensureHost(){
    let host=document.getElementById("kutadgu-visit-check");
    if(host)return host;
    host=document.createElement("section");
    host.id="kutadgu-visit-check";
    host.setAttribute("role","region");
    host.setAttribute("aria-label","زىيارەت دەلىللەش");
    host.style.cssText=[
      "position:static",
      "box-sizing:border-box",
      "display:block",
      "width:min(100%,28rem)",
      "max-width:100%",
      "margin:0 auto",
      "padding:0",
      "border:0",
      "background:transparent",
      "color:var(--site-text,#44352d)",
      "overflow:visible",
      "transform:none"
    ].join(";");
    const text=document.createElement("p");
    text.setAttribute("data-visit-note","");
    text.hidden=true;
    text.textContent=NOTE;
    text.style.cssText="margin:0 0 12px;line-height:1.6;";
    const slot=document.createElement("div");
    slot.setAttribute("data-turnstile","");
    slot.style.cssText="overflow:visible;transform:none;max-height:none;";
    const retry=document.createElement("button");
    retry.type="button";
    retry.hidden=true;
    retry.setAttribute("data-visit-retry","");
    retry.textContent="قايتا سىناش";
    retry.style.cssText="margin-top:12px;min-height:44px;padding:8px 14px;border-radius:999px;border:1px solid var(--button-secondary-border,var(--site-border,#e8dccb));background:var(--button-secondary-bg,var(--site-card,#fffdf9));color:var(--button-secondary-text,var(--site-text,#44352d));font:inherit;";
    retry.addEventListener("click",onRetry);
    host.append(text,slot,retry);
    document.body.appendChild(host);
    return host;
  }
  function showCheck(){
    const host=ensureHost();
    host.setAttribute("data-open","true");
    host.style.margin="16px auto";
    host.style.padding="12px 16px";
    host.style.border="1px solid var(--site-border,#e8dccb)";
    host.style.borderRadius="14px";
    host.style.background="var(--site-card,#fffdf9)";
    const note=host.querySelector("[data-visit-note]");
    if(note){
      note.hidden=false;
      if(!note.textContent)note.textContent=NOTE;
    }
    return host.querySelector("[data-turnstile]");
  }
  function clearCheck(){
    const host=document.getElementById("kutadgu-visit-check");
    if(!host)return;
    try{
      if(flow&&flow.widgetId!=null&&window.turnstile&&typeof window.turnstile.remove==="function"){
        window.turnstile.remove(flow.widgetId);
      }
    }catch(err){}
    host.remove();
  }
  function offerRetry(message){
    if(!flow||flow.done||flow.busy)return;
    const host=showCheck();
    const panel=host&&host.parentElement;
    const note=panel&&panel.querySelector("[data-visit-note]");
    const button=panel&&panel.querySelector("[data-visit-retry]");
    if(flow.retries>=MAX_RETRIES){
      if(note)note.textContent=STOP_NOTE;
      if(button)button.hidden=true;
      const slot=panel&&panel.querySelector("[data-turnstile]");
      try{
        if(flow.widgetId!=null&&window.turnstile&&typeof window.turnstile.remove==="function")window.turnstile.remove(flow.widgetId);
      }catch(err){}
      flow.widgetId=null;
      if(slot)slot.replaceChildren();
      return;
    }
    if(note)note.textContent=message||RETRY_NOTE;
    if(button)button.hidden=false;
  }
  async function finish(id){
    return post("/api/visit-count",{event_id:id});
  }
  async function acceptToken(token){
    if(!flow||flow.done||flow.busy)return;
    if(!token||flow.usedTokens.has(token)||flow.proofAccepted)return;
    flow.busy=true;
    flow.usedTokens.add(token);
    let proof=null;
    try{
      proof=await post("/api/visit-proof",{token,action:ACTION});
    }catch(err){
      proof=null;
    }
    if(!proof||proof.ok!==true){
      flow.busy=false;
      offerRetry();
      return;
    }
    flow.proofAccepted=true;
    let result=null;
    try{
      result=await finish(flow.id);
    }catch(err){
      result=null;
    }
    flow.busy=false;
    if(settled(result)){
      flow.done=true;
      clearCheck();
      return;
    }
    offerRetry();
  }
  function render(siteKey){
    const slot=ensureHost().querySelector("[data-turnstile]");
    // appearance "interaction-only" shows the widget only when a challenge
    // needs a person. before-interactive-callback is the documented signal
    // for that moment. retry "never" and refresh-expired "never" keep
    // recovery on the explicit button instead of an automatic loop.
    const widgetId=window.turnstile.render(slot,{
      sitekey:siteKey,
      action:ACTION,
      appearance:"interaction-only",
      retry:"never",
      "refresh-expired":"never",
      callback(token){acceptToken(token);},
      "before-interactive-callback"(){showCheck();},
      "error-callback"(){offerRetry();},
      "expired-callback"(){offerRetry();},
      "timeout-callback"(){offerRetry();}
    });
    flow.widgetId=widgetId;
  }
  function loadWidget(siteKey){
    if(flow.widgetId!=null||flow.widgetRequested)return;
    flow.widgetRequested=true;
    if(window.turnstile){
      render(siteKey);
      return;
    }
    const script=document.createElement("script");
    script.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async=true;
    script.onload=()=>render(siteKey);
    script.onerror=()=>{
      if(flow)flow.widgetRequested=false;
      offerRetry();
    };
    document.head.appendChild(script);
  }
  async function openWidget(){
    if(!flow||flow.done||flow.widgetRequested)return;
    const configResponse=await fetch("/api/visit-config",{credentials:"same-origin"});
    const config=await configResponse.json();
    if(!config||!config.configured||!config.siteKey){
      offerRetry();
      return;
    }
    loadWidget(config.siteKey);
  }
  async function onRetry(){
    if(!flow||flow.done||flow.busy||flow.retries>=MAX_RETRIES)return;
    flow.retries+=1;
    const button=document.querySelector("#kutadgu-visit-check [data-visit-retry]");
    if(button)button.hidden=true;
    flow.busy=true;
    let result=null;
    try{
      result=await finish(flow.id);
    }catch(err){
      result=null;
    }
    flow.busy=false;
    if(settled(result)){
      flow.done=true;
      clearCheck();
      return;
    }
    if(flow.proofAccepted){
      offerRetry();
      return;
    }
    if(!flow.widgetRequested){
      try{
        await openWidget();
      }catch(err){
        offerRetry();
      }
      if(!flow.widgetRequested)offerRetry();
      return;
    }
    if(flow.widgetId!=null&&window.turnstile&&typeof window.turnstile.reset==="function"){
      try{
        window.turnstile.reset(flow.widgetId);
        return;
      }catch(err){}
    }
    offerRetry();
  }
  async function start(){
    if(flow)return;
    try{
      if(!analyticsEnabled())return;
      if(!allowedHost()&&!exerciseHost())return;
      flow={
        id:uuid(),
        busy:false,
        done:false,
        retries:0,
        proofAccepted:false,
        widgetRequested:false,
        widgetId:null,
        usedTokens:new Set()
      };
      let existing=null;
      try{
        existing=await finish(flow.id);
      }catch(err){
        existing=null;
      }
      if(settled(existing)){
        flow.done=true;
        return;
      }
      if(existing&&PROOF_REASONS.indexOf(existing.reason)!==-1){
        await openWidget();
        return;
      }
      if(existing&&existing.reason&&existing.reason!=="unavailable")return;
      offerRetry();
    }catch(err){
      if(flow&&!flow.done)offerRetry();
    }
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});
  else start();
})();
