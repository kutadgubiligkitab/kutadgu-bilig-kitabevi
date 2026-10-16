(()=>{
  const ACTION="visit";
  const NOTE="زىيارەت سانىنى دەلىللەش ئۈچۈن بۇ تەكشۈرۈشنى تاماملاڭ.";
  function uuid(){
    const bytes=new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6]=(bytes[6]&15)|64;
    bytes[8]=(bytes[8]&63)|128;
    const hex=Array.from(bytes,item=>item.toString(16).padStart(2,"0")).join("");
    return hex.slice(0,8)+"-"+hex.slice(8,12)+"-"+hex.slice(12,16)+"-"+hex.slice(16,20)+"-"+hex.slice(20);
  }
  function eventId(){
    return uuid();
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
    return payload&&typeof payload==="object"?payload:{ok:false,counted:false,reason:"unavailable"};
  }
  function ensureHost(){
    let host=document.getElementById("kutadgu-visit-check");
    if(host)return host;
    host=document.createElement("div");
    host.id="kutadgu-visit-check";
    host.hidden=true;
    host.setAttribute("role","status");
    host.style.cssText="position:fixed;left:12px;right:12px;bottom:calc(76px + env(safe-area-inset-bottom));z-index:30;max-width:420px;margin:0 auto;padding:12px;background:#fffdf8;color:#2b2118;border:1px solid #c4b39a;";
    const text=document.createElement("p");
    text.textContent=NOTE;
    const slot=document.createElement("div");
    slot.setAttribute("data-turnstile","");
    host.append(text,slot);
    document.body.appendChild(host);
    return host;
  }
  function showCheck(){
    const host=ensureHost();
    host.hidden=false;
    return host.querySelector("[data-turnstile]");
  }
  async function finish(id){
    return post("/api/visit-count",{event_id:id});
  }
  function render(siteKey,id){
    const slot=ensureHost().querySelector("[data-turnstile]");
    window.turnstile.render(slot,{
      sitekey:siteKey,
      action:ACTION,
      callback(token){
        post("/api/visit-proof",{token,action:ACTION}).then(proof=>{
          if(!proof||!proof.ok)return null;
          return finish(id);
        }).catch(()=>{});
      },
      "before-interactive-callback"(){showCheck();},
      "error-callback"(){return true;}
    });
  }
  function loadWidget(siteKey,id){
    if(window.turnstile){
      render(siteKey,id);
      return;
    }
    const script=document.createElement("script");
    script.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async=true;
    script.onload=()=>render(siteKey,id);
    document.head.appendChild(script);
  }
  function allowedHost(){
    const host=String(location.hostname||"").toLowerCase();
    return host==="www.kutadgubilik.com"||host==="kutadgubilik.com";
  }
  async function start(){
    try{
      if(!allowedHost())return;
      const id=eventId();
      const existing=await finish(id);
      if(existing&&existing.ok)return;
      if(existing&&existing.reason!=="cookie_missing"&&existing&&existing.reason!=="verification_expired"&&existing&&existing.reason!=="cookie_invalid")return;
      const configResponse=await fetch("/api/visit-config",{credentials:"same-origin"});
      const config=await configResponse.json();
      if(!config||!config.configured||!config.siteKey)return;
      loadWidget(config.siteKey,id);
    }catch(err){}
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});
  else start();
})();
