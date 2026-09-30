/* Lightweight privacy-conscious site analytics. No name, phone, address or message text is stored. */
(function(){
  "use strict";
  if(window.KutadguAnalytics?.__remoteReady)return;
  const cfg=window.KUTADGU_SUPABASE_CONFIG||{};
  const url=String(cfg.url||"").replace(/\/+$/,"");
  const key=String(cfg.anonKey||cfg.publishableKey||"");
  const enabled=()=>window.KUTADGU_APP_CONFIG?.featureFlags?.analyticsHooks!==false;
  const Core=()=>window.KutadguAnalyticsCore;
  const omitCols={legacy_id:false,meta:false,visitor_id:false,event_id:false,host:false};
  function safeStorage(kind){
    try{return kind==="local"?localStorage:sessionStorage}catch(err){return null}
  }
  function sessionId(){
    const core=Core();
    if(core&&core.sessionId)return core.sessionId(safeStorage("session"));
    try{let id=sessionStorage.getItem("kutadgu-analytics-session");if(!id){id=(crypto.randomUUID?.()||("s-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2)));sessionStorage.setItem("kutadgu-analytics-session",id)}return id}catch(e){return ""}
  }
  function context(){
    const core=Core();
    return {
      path:location.pathname,
      sessionId:sessionId(),
      visitorId:core&&core.visitorId?core.visitorId(safeStorage("local")):"",
      eventId:core&&core.newUuidV4?core.newUuidV4():"",
      host:location.hostname
    };
  }
  function stripOptional(row){
    const out={...row};
    Object.keys(omitCols).forEach(col=>{if(omitCols[col])delete out[col]});
    return out;
  }
  function missingOptionalColumn(body){
    const text=String(body||"");
    const cols=["visitor_id","event_id","host","legacy_id","meta"];
    for(let i=0;i<cols.length;i++){
      const col=cols[i];
      if((new RegExp("'"+col+"'|column "+col,"i").test(text)||/PGRST204/i.test(text))&&new RegExp(col,"i").test(text))return col;
    }
    return "";
  }
  function payload(name,data={}){
    const core=Core();
    const ctx=context();
    if(core&&core.buildRow)return core.buildRow(name,data,ctx);
    const clean=(v,n=120)=>String(v??"").trim().slice(0,n);
    const results=data.results;
    const known=results!==null&&results!==undefined&&results!==""&&Number.isFinite(Number(results));
    return {
      event_name:clean(name,60),
      book_id:clean(data.bookId||data.book_id,32)||null,
      search_query:name==="search"||name==="zero_result_search"?clean(data.query,80)||null:null,
      category:clean(data.category,100)||null,
      result_count:known?Number(results):null,
      item_count:Number.isFinite(Number(data.items||data.qty))?Number(data.items||data.qty):null,
      order_total:Number.isFinite(Number(data.total))?Number(data.total):null,
      path:clean(location.pathname,180),
      session_id:clean(ctx.sessionId,100)||null
    };
  }
  async function postRow(row,attempt){
    if(!row||!url||!key||attempt>4)return;
    const body=stripOptional(row);
    const hasEvent=!!body.event_id;
    let response;
    try{
      response=await fetch(url+"/rest/v1/analytics_events",{
        method:"POST",
        keepalive:true,
        headers:{
          apikey:key,
          Authorization:"Bearer "+key,
          "Content-Type":"application/json",
          Prefer:hasEvent?"return=minimal,resolution=ignore-duplicates":"return=minimal"
        },
        body:JSON.stringify(body)
      });
    }catch(err){
      const decision=Core()?.retryDecision?Core().retryDecision(0,"",attempt):"drop";
      if(decision==="retry-same-id")return postRow(row,attempt+1);
      return;
    }
    const core=Core();
    const decisionOf=(status,missing)=>core&&core.retryDecision?core.retryDecision(status,missing,attempt):(status>=200&&status<300?"stored":"drop");
    if(decisionOf(response.status,"")==="stored"||response.ok)return;
    let text="";
    try{text=await response.text()}catch(err){text=""}
    const missing=missingOptionalColumn(text);
    const canOmit=missing&&omitCols[missing]!==true;
    const decision=decisionOf(response.status,canOmit?missing:"");
    if(decision==="omit-column"&&canOmit){
      omitCols[missing]=true;
      return postRow(row,attempt+1);
    }
    if(decision==="retry-same-id")return postRow(row,attempt+1);
    if(decision==="stored")return;
  }
  function allowedHere(){
    const core=Core();
    if(core&&core.shouldRecordRemote)return core.shouldRecordRemote(location.hostname,location.pathname);
    const host=String(location.hostname||"").toLowerCase();
    return host==="www.kutadgubilik.com"||host==="kutadgubilik.com"||host==="kutadgu-bilig-kitab.vercel.app";
  }
  async function remoteTrack(name,data={}){
    try{
      if(!enabled()||!allowedHere())return;
      const detail={name,data,at:new Date().toISOString()};
      document.dispatchEvent(new CustomEvent("kutadgu:analytics-event",{detail}));
      if(!url||!key)return;
      const row=payload(name,data);
      if(!row)return;
      await postRow(row,0);
    }catch(e){/* analytics must never block the shop */}
  }
  window.KutadguAnalytics={...(window.KutadguAnalytics||{}),__remoteReady:true,track:remoteTrack};
  const page=()=>remoteTrack("page_view",{});
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",page,{once:true});else page();
  document.addEventListener("click",event=>{
    try{
      const link=event.target.closest?.("#contactDetails a");if(!link)return;
      const type=link.classList.contains("contact-whatsapp")?"whatsapp":link.href?.startsWith("tel:")?"phone":link.href?.includes("instagram.com")?"instagram":link.href?.includes("google.com/maps")?"maps":"other";
      remoteTrack("contact_click",{category:type});
    }catch(err){}
  });
})();
