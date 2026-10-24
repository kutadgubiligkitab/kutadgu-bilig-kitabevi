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
    slot.style.cssText="display:block;width:100%;max-width:100%;overflow:visible;transform:none;max-height:none;";
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
  function activeFlow(){
    return !!(flow&&!flow.done&&!flow.stopped);
  }
  function owns(generation){
    return !!(flow&&flow.generation===generation&&!flow.done&&!flow.stopped);
  }
  function paintOpen(noteText){
    const host=ensureHost();
    host.setAttribute("data-open","true");
    host.style.margin="12px auto";
    host.style.padding="12px 0";
    host.style.border="1px solid var(--site-border,#e8dccb)";
    host.style.borderRadius="14px";
    host.style.background="var(--site-card,#fffdf9)";
    host.style.width="min(100%,28rem)";
    host.style.maxWidth="100%";
    const note=host.querySelector("[data-visit-note]");
    if(note){
      note.hidden=false;
      note.style.padding="0 12px";
      if(noteText)note.textContent=noteText;
      else if(!note.textContent)note.textContent=NOTE;
    }
    const retry=host.querySelector("[data-visit-retry]");
    if(retry)retry.style.margin="12px 12px 0";
    return host.querySelector("[data-turnstile]");
  }
  function showCheck(){
    if(!activeFlow())return null;
    return paintOpen("");
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
    if(!activeFlow()||flow.busy)return;
    if(flow.retries>=MAX_RETRIES){
      flow.stopped=true;
      const slot=paintOpen(STOP_NOTE);
      const panel=slot&&slot.parentElement;
      const button=panel&&panel.querySelector("[data-visit-retry]");
      if(button)button.hidden=true;
      try{
        if(flow.widgetId!=null&&window.turnstile&&typeof window.turnstile.remove==="function")window.turnstile.remove(flow.widgetId);
      }catch(err){}
      flow.widgetId=null;
      if(slot)slot.replaceChildren();
      return;
    }
    const slot=paintOpen(message||RETRY_NOTE);
    const button=slot&&slot.parentElement&&slot.parentElement.querySelector("[data-visit-retry]");
    if(button)button.hidden=false;
  }
  async function finish(id){
    return post("/api/visit-count",{event_id:id});
  }
  async function acceptToken(token,generation){
    if(!owns(generation)||flow.busy)return;
    if(!token||flow.usedTokens.has(token)||flow.proofAccepted)return;
    flow.busy=true;
    flow.usedTokens.add(token);
    let proof=null;
    try{
      proof=await post("/api/visit-proof",{token,action:ACTION});
    }catch(err){
      proof=null;
    }
    if(!owns(generation)){
      flow.busy=false;
      return;
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
    if(!owns(generation)){
      flow.busy=false;
      return;
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
    if(!activeFlow())return;
    const generation=(flow.generation||0)+1;
    flow.generation=generation;
    const slot=ensureHost().querySelector("[data-turnstile]");
    // appearance "interaction-only" shows the widget only when a challenge
    // needs a person. before-interactive-callback is the documented signal
    // for that moment. size "normal" is the documented 300 by 65 widget.
    // retry "never" and refresh-expired "never" keep recovery on the
    // explicit button instead of an automatic loop. Ownership is recorded
    // before render so a synchronous interaction callback still belongs
    // to this widget, and a later callback from a finished widget does not.
    const widgetId=window.turnstile.render(slot,{
      sitekey:siteKey,
      action:ACTION,
      size:"normal",
      appearance:"interaction-only",
      retry:"never",
      "refresh-expired":"never",
      callback(token){acceptToken(token,generation);},
      "before-interactive-callback"(){if(owns(generation))showCheck();},
      "error-callback"(){if(owns(generation))offerRetry();},
      "expired-callback"(){if(owns(generation))offerRetry();},
      "timeout-callback"(){if(owns(generation))offerRetry();}
    });
    if(!owns(generation)){
      try{
        if(window.turnstile&&typeof window.turnstile.remove==="function")window.turnstile.remove(widgetId);
      }catch(err){}
      return;
    }
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
    if(!flow||flow.done||flow.stopped||flow.busy||flow.retries>=MAX_RETRIES)return;
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
    if(flow.retries>=MAX_RETRIES){
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
        generation:0,
        stopped:false,
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
