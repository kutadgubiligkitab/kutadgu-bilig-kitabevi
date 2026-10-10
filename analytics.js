/* Lightweight privacy-conscious site analytics. No name, phone, address or message text is stored. */
(function(){
  "use strict";
  if(window.KutadguAnalytics?.__remoteReady)return;
  const cfg=window.KUTADGU_SUPABASE_CONFIG||{};
  const url=String(cfg.url||"").replace(/\/+$/,"");
  const key=String(cfg.anonKey||cfg.publishableKey||"");
  const enabled=()=>window.KUTADGU_APP_CONFIG?.featureFlags?.analyticsHooks!==false;
  const Core=()=>window.KutadguAnalyticsCore;
  // host, occurred_at, and action_seq are not columns on the live table.
  // PostgREST 14.5 answers PGRST204 and stores nothing until they are omitted.
  // STAGE100 would add them and is not applied. visitor_id and event_id exist.
  const omitCols={legacy_id:false,meta:false,visitor_id:false,event_id:false,host:true,occurred_at:true,action_seq:true};
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
      host:location.hostname,
      occurredAt:new Date().toISOString(),
      actionSeq:core&&core.nextActionSeq?core.nextActionSeq(safeStorage("session")):null
    };
  }
  function stripOptional(row){
    const out={...row};
    Object.keys(omitCols).forEach(col=>{if(omitCols[col])delete out[col]});
    return out;
  }
  function missingOptionalColumn(body){
    const text=String(body||"");
    const cols=["visitor_id","event_id","host","occurred_at","action_seq","legacy_id","meta"];
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
  function workerDecision(status){
    const core=Core();
    if(core&&core.workerAnalyticsResult)return core.workerAnalyticsResult(status);
    const code=Number(status);
    if(code===409||(code>=200&&code<300))return "stored";
    return "direct";
  }
  async function postViaWorker(body){
    let response;
    try{
      response=await fetch("/api/analytics-event",{
        method:"POST",
        keepalive:true,
        cache:"no-store",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(body)
      });
    }catch(err){
      return "direct";
    }
    return workerDecision(response&&response.status);
  }
  async function postRow(row,progress){
    const state=progress&&typeof progress==="object"?progress:{schema:0,network:0};
    const optionalLimit=Object.keys(omitCols).length;
    if(!row||!url||!key||state.schema>optionalLimit||state.network>1)return;
    const body=stripOptional(row);
    ["country","ip","client_ip","cf_country"].forEach(col=>{delete body[col]});
    if(!state.workerTried){
      state.workerTried=true;
      if(await postViaWorker(body)==="stored")return;
    }
    const hasEvent=!!body.event_id;
    const decide=(status,missing)=>{
      const core=Core();
      if(!core||!core.retryDecision)return status>=200&&status<300?"stored":"drop";
      return core.retryDecision(status,missing,state.network,{
        idempotent:hasEvent,
        schemaAttempts:state.schema,
        networkAttempts:state.network,
        optionalLimit
      });
    };
    let response;
    try{
      response=await fetch(url+"/rest/v1/analytics_events",{
        method:"POST",
        keepalive:true,
        headers:{
          apikey:key,
          Authorization:"Bearer "+key,
          "Content-Type":"application/json",
          // A repeated event_id hits the unique index and returns 409, which is stored.
          // Asking PostgREST to ignore duplicates makes it SELECT the insert, and anon cannot.
          Prefer:"return=minimal"
        },
        body:JSON.stringify(body)
      });
    }catch(err){
      const decision=decide(0,"");
      if(decision==="retry-same-id"){
        state.network+=1;
        return postRow(row,state);
      }
      return;
    }
    if(decide(response.status,"")==="stored"||response.ok)return;
    let text="";
    try{text=await response.text()}catch(err){text=""}
    const missing=missingOptionalColumn(text);
    const canOmit=missing&&omitCols[missing]!==true;
    const decision=decide(response.status,canOmit?missing:"");
    if(decision==="omit-column"&&canOmit){
      omitCols[missing]=true;
      state.schema+=1;
      return postRow(row,state);
    }
    if(decision==="retry-same-id"){
      state.network+=1;
      return postRow(row,state);
    }
    if(decision==="stored")return;
  }
  function allowedHere(){
    const core=Core();
    if(core&&core.shouldRecordRemote)return core.shouldRecordRemote(location.hostname,location.pathname);
    const host=String(location.hostname||"").toLowerCase();
    return host==="www.kutadgubilik.com"||host==="kutadgubilik.com";
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
