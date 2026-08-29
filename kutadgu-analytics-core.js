/*
  Stage 8 — analytics payload helpers (browser + Node tests).
  No names, emails, phones, addresses, passwords, or checkout fields.
  Never writes books.sales_count.
*/
(function(root){
  "use strict";

  const QUERY_MAX=80;
  const NAME_MAX=60;
  const ID_MAX=32;
  const PATH_MAX=180;
  const ALLOWED_EVENTS={
    page_view:1,
    book_view:1,
    add_to_cart:1,
    whatsapp_order_click:1,
    search:1,
    zero_result_search:1,
    add_to_favorite:1,
    remove_from_favorite:1,
    contact_click:1,
    filter_apply:1
  };

  function isCanonicalBookId(value){
    return /^\d+$/.test(String(value==null?"":value).trim());
  }

  function clean(value,max){
    return String(value==null?"":value).replace(/\s+/g," ").trim().slice(0,max||120);
  }

  function normalizeSearchQuery(value){
    return clean(value,QUERY_MAX);
  }

  function looksSensitive(query){
    const q=String(query||"");
    if(!q)return true;
    if(q.indexOf("@")>=0)return true;
    if(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(q))return true;
    const digits=q.replace(/\D/g,"");
    const compact=q.replace(/[\s-]/g,"");
    const isbn=/^[0-9]{13}$/.test(compact)||/^[0-9]{9}[0-9Xx]$/i.test(compact);
    if(!isbn&&(digits.length>=11||/^\+[\d\s()-]{9,}$/.test(q)))return true;
    if(/password|passwd|parol|secret|token|email/i.test(q))return true;
    if(/پارول|ئېلېكتىرونلۇق خەت|تېلېفون|ئادرېس/.test(q))return true;
    return false;
  }

  function shouldTrackSearch(query){
    const normalized=normalizeSearchQuery(query);
    if(!normalized)return false;
    if(looksSensitive(normalized))return false;
    return true;
  }

  function searchEvents(query,resultCount){
    if(!shouldTrackSearch(query))return [];
    const q=normalizeSearchQuery(query);
    const results=Number.isFinite(Number(resultCount))?Math.max(0,Number(resultCount)):0;
    const events=[{name:"search",data:{query:q,results}}];
    if(results===0)events.push({name:"zero_result_search",data:{query:q,results:0}});
    return events;
  }

  function canonicalBookId(data){
    const raw=clean(data&&(data.bookId||data.book_id)||"",ID_MAX);
    if(isCanonicalBookId(raw))return raw;
    const list=Array.isArray(data&&data.bookIds)?data.bookIds:[];
    const found=list.map(id=>clean(id,ID_MAX)).find(isCanonicalBookId);
    if(found)return found;
    return raw||"";
  }

  function legacyBookId(data){
    const legacy=clean(data&&(data.legacyId||data.legacy_id)||"",120);
    if(legacy&&!isCanonicalBookId(legacy))return legacy;
    const raw=clean(data&&(data.bookId||data.book_id)||"",120);
    if(raw&&!isCanonicalBookId(raw))return raw;
    return "";
  }

  function metaFor(name,data){
    const ids=[...new Set((Array.isArray(data&&data.bookIds)?data.bookIds:[])
      .map(id=>clean(id,ID_MAX))
      .filter(isCanonicalBookId))];
    if(name==="whatsapp_order_click"&&ids.length)return {book_ids:ids};
    return null;
  }

  function buildRow(name,data,ctx){
    const event=clean(name,NAME_MAX);
    if(!event||!ALLOWED_EVENTS[event])return null;
    const rowData=data&&typeof data==="object"?data:{};
    const searchName=event==="search"||event==="zero_result_search";
    const query=searchName?normalizeSearchQuery(rowData.query||rowData.search_query||""):"";
    if(searchName&&!shouldTrackSearch(query))return null;
    const bookId=canonicalBookId(rowData);
    const legacy=legacyBookId(rowData);
    const row={
      event_name:event,
      book_id:bookId||null,
      search_query:searchName?query||null:null,
      category:clean(rowData.category,100)||null,
      result_count:Number.isFinite(Number(rowData.results))?Number(rowData.results):null,
      item_count:Number.isFinite(Number(rowData.items||rowData.qty))?Number(rowData.items||rowData.qty):null,
      order_total:event==="whatsapp_order_click"&&Number.isFinite(Number(rowData.total))?Number(rowData.total):null,
      path:clean(ctx&&ctx.path||"",PATH_MAX)||null,
      session_id:clean(ctx&&ctx.sessionId||"",100)||null
    };
    if(legacy)row.legacy_id=legacy;
    const meta=metaFor(event,rowData);
    if(meta)row.meta=meta;
    return row;
  }

  function conversionPct(numerator,denominator){
    const n=Number(numerator),d=Number(denominator);
    if(!Number.isFinite(n)||!Number.isFinite(d)||d<=0)return null;
    return Math.round((1000*n)/d)/10;
  }

  function funnelFromCounts(counts){
    const views=Number(counts&&counts.book_views||0);
    const cart=Number(counts&&counts.cart_adds||0);
    const whatsapp=Number(counts&&counts.whatsapp_clicks||0);
    return {
      views,
      cart_adds:cart,
      whatsapp_clicks:whatsapp,
      view_to_cart_pct:conversionPct(cart,views),
      cart_to_whatsapp_pct:conversionPct(whatsapp,cart),
      view_to_whatsapp_pct:conversionPct(whatsapp,views)
    };
  }

  const api={
    QUERY_MAX,
    ALLOWED_EVENTS,
    isCanonicalBookId,
    clean,
    normalizeSearchQuery,
    looksSensitive,
    shouldTrackSearch,
    searchEvents,
    canonicalBookId,
    legacyBookId,
    buildRow,
    conversionPct,
    funnelFromCounts
  };

  if(typeof module==="object"&&module.exports)module.exports=api;
  root.KutadguAnalyticsCore=api;
})(typeof window!=="undefined"?window:typeof global!=="undefined"?global:this);
