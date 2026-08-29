/* Lightweight privacy-conscious site analytics. No name, phone, address or message text is stored. */
(function(){
  "use strict";
  if(window.KutadguAnalytics?.__remoteReady)return;
  const cfg=window.KUTADGU_SUPABASE_CONFIG||{};
  const url=String(cfg.url||"").replace(/\/+$/,"");
  const key=String(cfg.anonKey||cfg.publishableKey||"");
  const enabled=()=>window.KUTADGU_APP_CONFIG?.featureFlags?.analyticsHooks!==false;
  const Core=()=>window.KutadguAnalyticsCore;
  const omitCols={legacy_id:false,meta:false};
  function sessionId(){
    try{let id=sessionStorage.getItem("kutadgu-analytics-session");if(!id){id=(crypto.randomUUID?.()||("s-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2)));sessionStorage.setItem("kutadgu-analytics-session",id)}return id}catch(e){return ""}
  }
  function stripOptional(row){
    const out={...row};
    if(omitCols.legacy_id)delete out.legacy_id;
    if(omitCols.meta)delete out.meta;
    return out;
  }
  function missingOptionalColumn(body){
    const text=String(body||"");
    if(/'legacy_id'|column legacy_id|schema cache/i.test(text)&&/legacy_id/i.test(text))return "legacy_id";
    if(/'meta'|column meta/i.test(text)&&/meta/i.test(text))return "meta";
    if(/PGRST204/.test(text)&&/legacy_id/.test(text))return "legacy_id";
    if(/PGRST204/.test(text)&&/meta/.test(text))return "meta";
    return "";
  }
  function payload(name,data={}){
    const core=Core();
    if(core&&core.buildRow){
      return core.buildRow(name,data,{path:location.pathname,sessionId:sessionId()});
    }
    const clean=(v,n=120)=>String(v??"").trim().slice(0,n);
    return {
      event_name:clean(name,60),
      book_id:clean(data.bookId||data.book_id,32)||null,
      search_query:name==="search"||name==="zero_result_search"?clean(data.query,80)||null:null,
      category:clean(data.category,100)||null,
      result_count:Number.isFinite(Number(data.results))?Number(data.results):null,
      item_count:Number.isFinite(Number(data.items||data.qty))?Number(data.items||data.qty):null,
      order_total:Number.isFinite(Number(data.total))?Number(data.total):null,
      path:clean(location.pathname,180),
      session_id:clean(sessionId(),100)||null
    };
  }
  async function postRow(row){
    if(!row||!url||!key)return;
    const body=stripOptional(row);
    const response=await fetch(url+"/rest/v1/analytics_events",{
      method:"POST",
      keepalive:true,
      headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",Prefer:"return=minimal"},
      body:JSON.stringify(body)
    });
    if(response.ok||response.status===201)return;
    let text="";
    try{text=await response.text()}catch(err){text=""}
    const missing=missingOptionalColumn(text);
    if(missing&&omitCols[missing]!==true){
      omitCols[missing]=true;
      await postRow(row);
    }
  }
  async function remoteTrack(name,data={}){
    try{
      if(!enabled())return;
      const detail={name,data,at:new Date().toISOString()};
      document.dispatchEvent(new CustomEvent("kutadgu:analytics-event",{detail}));
      if(!url||!key)return;
      const row=payload(name,data);
      if(!row)return;
      await postRow(row);
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
