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
    book_engagement_detail:1,
    book_engagement_cart:1,
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

  function finiteOrNull(value){
    if(value===null||value===undefined||value==="")return null;
    const n=typeof value==="number"?value:Number(value);
    if(!Number.isFinite(n))return null;
    return n;
  }

  function searchEvents(query,resultCount){
    if(!shouldTrackSearch(query))return [];
    const q=normalizeSearchQuery(query);
    const known=finiteOrNull(resultCount);
    const results=known===null?null:Math.max(0,known);
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
      result_count:finiteOrNull(rowData.results),
      item_count:Number.isFinite(Number(rowData.items||rowData.qty))?Number(rowData.items||rowData.qty):null,
      order_total:event==="whatsapp_order_click"&&Number.isFinite(Number(rowData.total))?Number(rowData.total):null,
      path:clean(ctx&&ctx.path||"",PATH_MAX)||null,
      session_id:clean(ctx&&ctx.sessionId||"",100)||null
    };
    if(legacy)row.legacy_id=legacy;
    const meta=metaFor(event,rowData);
    if(meta)row.meta=meta;
    const visitor=String(ctx&&ctx.visitorId||"");
    const eventId=String(ctx&&ctx.eventId||"");
    const host=String(ctx&&ctx.host||"").toLowerCase().replace(/:\d+$/,"");
    if(isUuidV4(visitor))row.visitor_id=visitor.toLowerCase();
    if(isUuidV4(eventId))row.event_id=eventId.toLowerCase();
    if(PRODUCTION_HOSTS[host])row.host=host;
    const seq=Number(ctx&&ctx.actionSeq);
    const occurred=ctx&&ctx.occurredAt?new Date(ctx.occurredAt):null;
    if(Number.isInteger(seq)&&seq>=0&&seq<=1000000&&occurred&&!Number.isNaN(occurred.getTime())){
      row.action_seq=seq;
      row.occurred_at=occurred.toISOString();
    }
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

  const ISTANBUL_OFFSET_MS=3*60*60*1000;
  const VISITOR_KEY="kutadgu-analytics-visitor";
  const SESSION_KEY="kutadgu-analytics-session";
  const PRODUCTION_HOSTS={
    "www.kutadgubilik.com":1,
    "kutadgubilik.com":1,
    "kutadgu-bilig-kitab.vercel.app":1
  };
  const UUID_V4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function isUuidV4(value){
    return UUID_V4.test(String(value||"").trim());
  }

  function cryptoApi(){
    const root=typeof globalThis!=="undefined"?globalThis:typeof window!=="undefined"?window:{};
    if(root.crypto&&(typeof root.crypto.randomUUID==="function"||typeof root.crypto.getRandomValues==="function"))return root.crypto;
    return null;
  }

  function newUuidV4(cryptoObj){
    const c=cryptoObj||cryptoApi();
    if(!c)return "";
    if(typeof c.randomUUID==="function"){
      const id=String(c.randomUUID()||"");
      if(isUuidV4(id))return id.toLowerCase();
    }
    if(typeof c.getRandomValues!=="function")return "";
    const bytes=new Uint8Array(16);
    c.getRandomValues(bytes);
    bytes[6]=(bytes[6]&0x0f)|0x40;
    bytes[8]=(bytes[8]&0x3f)|0x80;
    const hex=Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
    const id=hex.slice(0,8)+"-"+hex.slice(8,12)+"-"+hex.slice(12,16)+"-"+hex.slice(16,20)+"-"+hex.slice(20);
    return isUuidV4(id)?id:"";
  }

  function readId(storage,key,requireUuid){
    if(!storage||typeof storage.getItem!=="function"||typeof storage.setItem!=="function")return "";
    try{
      const existing=String(storage.getItem(key)||"");
      if(requireUuid){
        if(isUuidV4(existing))return existing.toLowerCase();
      }else if(existing){
        return existing.slice(0,100);
      }
      const created=newUuidV4();
      if(!created){
        if(requireUuid)return "";
        const fallback="s-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2);
        storage.setItem(key,fallback);
        return String(storage.getItem(key)||fallback).slice(0,100);
      }
      storage.setItem(key,created);
      const stored=String(storage.getItem(key)||"");
      if(requireUuid)return isUuidV4(stored)?stored.toLowerCase():"";
      return stored?stored.slice(0,100):"";
    }catch(err){
      return "";
    }
  }

  function visitorId(storage){
    return readId(storage,VISITOR_KEY,true);
  }

  function sessionId(storage){
    return readId(storage,SESSION_KEY,false);
  }

  function shouldRecordRemote(host,path){
    const name=String(host||"").toLowerCase().replace(/:\d+$/,"");
    if(!PRODUCTION_HOSTS[name])return false;
    const cleanPath=String(path||"").split("?")[0].toLowerCase();
    if(/(^|\/)admin\.html$/.test(cleanPath))return false;
    if(/(^|\/)book-staff\.html$/.test(cleanPath))return false;
    return true;
  }

  const OPTIONAL_COLUMN_LIMIT=7;

  function boundedCount(value,fallback){
    const n=Number(value);
    return Number.isFinite(n)&&n>=0?n:fallback;
  }

  function retryDecision(status,missingColumn,attempt,opts){
    const n=Number(attempt)||0;
    const idempotent=!(opts&&opts.idempotent===false);
    const schemaAttempts=boundedCount(opts&&opts.schemaAttempts,n);
    const networkAttempts=boundedCount(opts&&opts.networkAttempts,n);
    const optionalLimit=boundedCount(opts&&opts.optionalLimit,OPTIONAL_COLUMN_LIMIT)||OPTIONAL_COLUMN_LIMIT;
    // Each recognized optional column may be omitted once. This budget is not
    // the lost-response retry.
    if(missingColumn)return schemaAttempts<optionalLimit?"omit-column":"drop";
    const code=Number(status);
    if(code===409||(code>=200&&code<300))return "stored";
    // A lost response or 5xx can mean the insert already committed.
    // Retry once, and only while event_id uniqueness can ignore that duplicate.
    if((code===0||code>=500)&&networkAttempts<1&&idempotent)return "retry-same-id";
    return "drop";
  }

  function nextActionSeq(storage){
    if(!storage||typeof storage.getItem!=="function"||typeof storage.setItem!=="function")return null;
    try{
      const current=Number(storage.getItem("kutadgu-analytics-action-seq")||0);
      const next=Number.isInteger(current)&&current>=0&&current<1000000?current+1:1;
      storage.setItem("kutadgu-analytics-action-seq",String(next));
      const stored=Number(storage.getItem("kutadgu-analytics-action-seq"));
      return stored===next?next:null;
    }catch(err){
      return null;
    }
  }

  function acceptClientOccurredAt(occurredAt,serverNow){
    const at=Date.parse(occurredAt);
    const now=serverNow instanceof Date?serverNow.getTime():Date.parse(serverNow);
    if(!Number.isFinite(at)||!Number.isFinite(now))return null;
    if(at<now-5*60*1000||at>now+60*1000)return null;
    return new Date(at).toISOString();
  }

  function istanbulParts(date){
    const d=date instanceof Date?date:new Date(date);
    if(Number.isNaN(d.getTime()))return null;
    const shifted=new Date(d.getTime()+ISTANBUL_OFFSET_MS);
    const month=String(shifted.getUTCMonth()+1).padStart(2,"0");
    const day=String(shifted.getUTCDate()).padStart(2,"0");
    return {date:shifted.getUTCFullYear()+"-"+month+"-"+day};
  }

  function istanbulDate(date){
    const parts=istanbulParts(date||new Date());
    return parts?parts.date:"";
  }

  function addCalendarDays(iso,delta){
    const bits=String(iso||"").split("-").map(Number);
    if(bits.length!==3||bits.some(n=>!Number.isFinite(n)))return "";
    const utc=new Date(Date.UTC(bits[0],bits[1]-1,bits[2]+Number(delta||0)));
    const month=String(utc.getUTCMonth()+1).padStart(2,"0");
    const day=String(utc.getUTCDate()).padStart(2,"0");
    return utc.getUTCFullYear()+"-"+month+"-"+day;
  }

  function istanbulRange(days,now){
    const end=istanbulDate(now||new Date());
    const n=Math.max(1,Math.min(365,Number(days)||30));
    return {start:addCalendarDays(end,1-n),end,days:n,timezone:"Europe/Istanbul"};
  }

  function lastSevenEnding(endDate){
    const days=[];
    for(let i=6;i>=0;i-=1)days.push(addCalendarDays(endDate,-i));
    return days.filter(Boolean);
  }

  function hasOwn(obj,key){
    return !!obj&&Object.prototype.hasOwnProperty.call(obj,key);
  }

  function countState(summary,key){
    if(!summary||typeof summary!=="object"||!hasOwn(summary,key)||summary[key]==null||summary[key]===""){
      return {state:"unsupported",value:null};
    }
    const n=Number(summary[key]);
    if(!Number.isFinite(n))return {state:"unsupported",value:null};
    return {state:"value",value:n};
  }

  function listState(summary,key){
    if(!summary||typeof summary!=="object"||!hasOwn(summary,key)||summary[key]==null){
      return {state:"unsupported",rows:null};
    }
    if(!Array.isArray(summary[key]))return {state:"unsupported",rows:null};
    return {state:summary[key].length?"rows":"empty",rows:summary[key]};
  }

  function visitorMetric(day){
    if(!day||typeof day!=="object")return {text:"—",status:"unavailable",visitors:null};
    const status=day.status==="zero"||day.status==="partial"||day.status==="complete"||day.status==="unavailable"
      ?day.status
      :(Number(day.events)===0?"zero":"unavailable");
    if(status==="zero")return {text:"0",status:"zero",visitors:0};
    if(status==="complete"||status==="partial"){
      const n=Number(day.visitors);
      if(!Number.isFinite(n))return {text:"—",status,visitors:null};
      return {text:String(n),status,visitors:n};
    }
    return {text:"—",status:"unavailable",visitors:null};
  }

  function chartDays(summary,now){
    const serverDays=summary&&summary.visitors&&Array.isArray(summary.visitors.daily)?summary.visitors.daily:[];
    const schema=Number(summary&&summary.schema_version)===2;
    const end=schema&&serverDays.length?String(serverDays[serverDays.length-1].date||""):istanbulDate(now||new Date());
    const axis=lastSevenEnding(end||istanbulDate(now||new Date()));
    const by=new Map(serverDays.map(row=>[row&&row.date,row]));
    return axis.map(date=>{
      if(!schema||!by.has(date))return {date,status:"unavailable",visitors:null,events:null};
      const row=by.get(date)||{};
      const metric=visitorMetric(row);
      return {date,status:metric.status,visitors:metric.visitors,events:row.events==null?null:Number(row.events)};
    });
  }

  function pctOrNull(value){
    if(value===null||value===undefined||value==="")return null;
    const n=Number(value);
    return Number.isFinite(n)?n:null;
  }

  function copyFunnel(funnel,kind,accurate){
    return {
      kind,
      order:funnel&&funnel.order||"",
      accurate_user_action_order:accurate,
      views:Number(funnel&&funnel.views||0),
      cart_adds:Number(funnel&&funnel.cart_adds||0),
      whatsapp_clicks:Number(funnel&&funnel.whatsapp_clicks||0),
      view_to_cart_pct:pctOrNull(funnel&&funnel.view_to_cart_pct),
      cart_to_whatsapp_pct:pctOrNull(funnel&&funnel.cart_to_whatsapp_pct),
      view_to_whatsapp_pct:pctOrNull(funnel&&funnel.view_to_whatsapp_pct),
      excluded_without_session:Number(funnel&&funnel.excluded_without_session||0),
      excluded_without_action_seq:Number(funnel&&funnel.excluded_without_action_seq||0)
    };
  }

  function describeFunnel(summary){
    const funnel=summary&&summary.funnel&&typeof summary.funnel==="object"?summary.funnel:null;
    if(funnel&&funnel.kind==="ordered_user_action"){
      return {kind:"ordered_user_action",funnel:copyFunnel(funnel,"ordered_user_action",true)};
    }
    if(funnel&&(funnel.kind==="recorded_arrival"||funnel.kind==="ordered_session")){
      return {kind:"recorded_arrival",funnel:copyFunnel(funnel,"recorded_arrival",false)};
    }
    const counts=funnelFromCounts(summary||{});
    return {kind:"aggregate_ratio",funnel:Object.assign({kind:"aggregate_ratio",accurate_user_action_order:false},counts)};
  }

  function describeAnalytics(summary,now){
    const src=summary&&typeof summary==="object"?summary:{};
    const schema=Number(src.schema_version)===2?2:1;
    const range=schema===2&&src.range_start&&src.range_end
      ?{start:String(src.range_start),end:String(src.range_end),timezone:"Europe/Istanbul"}
      :null;
    const period=schema===2?visitorMetric(src.visitors&&src.visitors.period):{text:"—",status:"unavailable",visitors:null};
    return {
      schema,
      timezone:"Europe/Istanbul",
      range,
      generatedAt:src.generated_at||null,
      counts:{
        page_views:countState(src,"page_views"),
        book_views:countState(src,"book_views"),
        cart_adds:countState(src,"cart_adds"),
        whatsapp_clicks:countState(src,"whatsapp_clicks"),
        zero_result_searches:countState(src,"zero_result_searches"),
        unknown_result_searches:countState(src,"unknown_result_searches"),
        book_engagement_detail:countState(src,"book_engagement_detail"),
        book_engagement_cart:countState(src,"book_engagement_cart")
      },
      lists:{
        top_books:listState(src,"top_books"),
        top_cart_books:listState(src,"top_cart_books"),
        top_whatsapp_books:listState(src,"top_whatsapp_books"),
        top_searches:listState(src,"top_searches"),
        zero_searches:listState(src,"zero_searches")
      },
      visitors:{
        today:schema===2?visitorMetric(src.visitors&&src.visitors.today):{text:"—",status:"unavailable",visitors:null},
        yesterday:schema===2?visitorMetric(src.visitors&&src.visitors.yesterday):{text:"—",status:"unavailable",visitors:null},
        period,
        daily:chartDays(src,now)
      },
      funnel:describeFunnel(src),
      arrival:src.arrival_funnel&&typeof src.arrival_funnel==="object"
        ?describeFunnel({funnel:src.arrival_funnel}).funnel
        :null
    };
  }

  function createAnalyticsLoadGate(){
    let token=0;
    return {
      begin(){token+=1;return token;},
      isCurrent(id){return id===token;}
    };
  }

  function classifyVisitorDay(events,day){
    let total=0;
    let identified=0;
    const ids=new Set();
    (Array.isArray(events)?events:[]).forEach(event=>{
      if(istanbulDate(event&&event.created_at)!==day)return;
      total+=1;
      const id=String(event&&event.visitor_id||"");
      if(isUuidV4(id)){
        identified+=1;
        ids.add(id.toLowerCase());
      }
    });
    if(total===0)return {date:day,status:"zero",visitors:0,events:0,identified_events:0};
    if(identified===0)return {date:day,status:"unavailable",visitors:null,events:total,identified_events:0};
    return {
      date:day,
      status:identified<total?"partial":"complete",
      visitors:ids.size,
      events:total,
      identified_events:identified
    };
  }

  function periodVisitorCount(events,start,end){
    let total=0;
    let identified=0;
    const ids=new Set();
    (Array.isArray(events)?events:[]).forEach(event=>{
      const day=istanbulDate(event&&event.created_at);
      if(!day||day<start||day>end)return;
      total+=1;
      const id=String(event&&event.visitor_id||"");
      if(isUuidV4(id)){
        identified+=1;
        ids.add(id.toLowerCase());
      }
    });
    if(total===0)return {status:"zero",visitors:0,events:0,identified_events:0};
    if(identified===0)return {status:"unavailable",visitors:null,events:total,identified_events:0};
    return {
      status:identified<total?"partial":"complete",
      visitors:ids.size,
      events:total,
      identified_events:identified
    };
  }

  function sessionFunnel(events,mode){
    const userAction=mode==="user_action";
    const rows=Array.isArray(events)?events:[];
    let excludedSession=0;
    let excludedSeq=0;
    const bySession=new Map();
    rows.forEach(event=>{
      const name=event&&event.event_name;
      if(name!=="book_view"&&name!=="add_to_cart"&&name!=="whatsapp_order_click")return;
      const sid=String(event.session_id||"").trim();
      if(!sid){excludedSession+=1;return;}
      let key=null;
      if(userAction){
        const seq=Number(event.action_seq);
        const occurred=Date.parse(event&&event.occurred_at);
        if(!Number.isInteger(seq)||seq<0||seq>1000000||!Number.isFinite(occurred)){
          excludedSeq+=1;
          return;
        }
        key=seq;
      }else{
        key=new Date(event.created_at).getTime();
        if(!Number.isFinite(key))return;
      }
      if(!bySession.has(sid))bySession.set(sid,{views:[],carts:[],clicks:[]});
      const bag=bySession.get(sid);
      if(name==="book_view")bag.views.push(key);
      else if(name==="add_to_cart")bag.carts.push(key);
      else bag.clicks.push(key);
    });
    let views=0,carts=0,clicks=0;
    bySession.forEach(bag=>{
      if(!bag.views.length)return;
      views+=1;
      const firstView=Math.min.apply(null,bag.views);
      const cartsAfter=bag.carts.filter(key=>userAction?key>firstView:key>=firstView);
      if(!cartsAfter.length)return;
      carts+=1;
      const firstCart=Math.min.apply(null,cartsAfter);
      if(bag.clicks.some(key=>userAction?key>firstCart:key>=firstCart))clicks+=1;
    });
    return {
      kind:userAction?"ordered_user_action":"recorded_arrival",
      order:userAction?"validated_client_action_seq":"server_receipt_time",
      accurate_user_action_order:userAction,
      scope:userAction?"sessions_with_validated_action_seq":"sessions_with_session_id",
      views,
      cart_adds:carts,
      whatsapp_clicks:clicks,
      view_to_cart_pct:conversionPct(carts,views),
      cart_to_whatsapp_pct:conversionPct(clicks,carts),
      view_to_whatsapp_pct:conversionPct(clicks,views),
      excluded_without_session:excludedSession,
      excluded_without_action_seq:excludedSeq,
      whatsapp_is:"intent_not_purchase"
    };
  }

  function orderedUserActionFunnel(events){
    return sessionFunnel(events,"user_action");
  }

  function recordedArrivalFunnel(events){
    return sessionFunnel(events,"arrival");
  }

  function resolveBookId(raw,books){
    const token=String(raw==null?"":raw).trim();
    if(!token)return "";
    const list=Array.isArray(books)?books:[];
    const canonical=list.find(book=>String(book&&book.id)!=null&&String(book.id)===token);
    if(canonical)return String(canonical.id);
    const legacy=list.filter(book=>String(book&&book.legacy_id||"")===token)
      .sort((a,b)=>Number(a.id)-Number(b.id));
    if(legacy.length)return String(legacy[0].id);
    return token;
  }

  function whatsappTokens(event){
    const meta=event&&event.meta;
    const fromArray=meta&&Array.isArray(meta.book_ids);
    const source=fromArray?meta.book_ids:[event&&event.book_id];
    return [...new Set(source.map(value=>String(value==null?"":value).trim()).filter(Boolean))];
  }

  function formatIstanbulStamp(value){
    const d=value instanceof Date?value:new Date(value);
    if(Number.isNaN(d.getTime()))return "";
    const parts=istanbulParts(d);
    const shifted=new Date(d.getTime()+ISTANBUL_OFFSET_MS);
    const hh=String(shifted.getUTCHours()).padStart(2,"0");
    const mm=String(shifted.getUTCMinutes()).padStart(2,"0");
    return parts.date+" "+hh+":"+mm;
  }

  function confirmedResultCount(result){
    if(!result||typeof result!=="object")return null;
    if(result.discovery)return null;
    if(result.source==="static"){
      const total=Number(result.total);
      return Number.isFinite(total)&&total>=0?total:null;
    }
    const header=result.contentRange!=null?String(result.contentRange):"";
    const match=header.match(/\/(\d+|\*)$/);
    if(match&&match[1]!=="*"){
      const exact=Number(match[1]);
      if(Number.isFinite(exact)&&exact>=0)return exact;
    }
    const status=Number(result.status);
    const offset=Number(result.offset);
    const rowCount=Number(result.rowCount);
    if(status===200&&offset===0&&rowCount===0)return 0;
    if(result.source==="supabase"&&!Object.prototype.hasOwnProperty.call(result,"status")&&!Object.prototype.hasOwnProperty.call(result,"contentRange")){
      const ranked=Number(result.total);
      if(Number.isFinite(ranked)&&ranked>=0)return ranked;
    }
    return null;
  }

  function integerAtLeast(value,min){
    const n=Number(value);
    if(!Number.isInteger(n)||n<min)return null;
    return n;
  }

  function normalizeZeroSearchPage(payload){
    if(!payload||typeof payload!=="object"||Array.isArray(payload))return null;
    const totalQueries=integerAtLeast(payload.total_queries,0);
    const totalEvents=integerAtLeast(payload.total_events,0);
    const offset=integerAtLeast(payload.offset,0);
    const limit=integerAtLeast(payload.limit,1);
    if(totalQueries===null||totalEvents===null||offset===null||limit===null)return null;
    const raw=Array.isArray(payload.queries)?payload.queries:[];
    const queries=[];
    const seen=new Set();
    raw.forEach(row=>{
      const query=normalizeSearchQuery(row&&row.query);
      const searches=Number(row&&row.searches);
      if(!query||!Number.isFinite(searches)||searches<0||seen.has(query))return;
      seen.add(query);
      queries.push({query,searches,last_searched_at:row&&row.last_searched_at||null});
    });
    return {
      queries,
      total_queries:totalQueries,
      total_events:totalEvents,
      offset,
      limit,
      has_more:offset+queries.length<totalQueries,
      range_start:payload.range_start?String(payload.range_start):"",
      range_end:payload.range_end?String(payload.range_end):"",
      timezone:"Europe/Istanbul",
      representation:payload.representation==="zero_result_search"?"zero_result_search":"search"
    };
  }

  function appendZeroSearchRows(existing,incoming){
    const rows=Array.isArray(existing)?existing.slice():[];
    const seen=new Set(rows.map(row=>row&&row.query).filter(Boolean));
    (Array.isArray(incoming)?incoming:[]).forEach(row=>{
      if(!row||!row.query||seen.has(row.query))return;
      seen.add(row.query);
      rows.push(row);
    });
    return rows;
  }

  function missingZeroSearchRpc(error){
    if(!error||typeof error!=="object")return false;
    const code=String(error.code||"");
    if(code==="PGRST202"||code==="42883")return true;
    const text=[error.message,error.details,error.hint].map(part=>String(part||"")).join(" ");
    return /get_kutadgu_zero_searches/i.test(text)&&/(could not find|does not exist|schema cache|undefined function)/i.test(text);
  }

  const api={
    QUERY_MAX,
    ALLOWED_EVENTS,
    PRODUCTION_HOSTS,
    VISITOR_KEY,
    SESSION_KEY,
    isCanonicalBookId,
    clean,
    normalizeSearchQuery,
    looksSensitive,
    shouldTrackSearch,
    searchEvents,
    finiteOrNull,
    canonicalBookId,
    legacyBookId,
    buildRow,
    conversionPct,
    funnelFromCounts,
    isUuidV4,
    newUuidV4,
    visitorId,
    sessionId,
    shouldRecordRemote,
    OPTIONAL_COLUMN_LIMIT,
    retryDecision,
    istanbulDate,
    istanbulRange,
    addCalendarDays,
    countState,
    listState,
    visitorMetric,
    chartDays,
    describeFunnel,
    describeAnalytics,
    createAnalyticsLoadGate,
    classifyVisitorDay,
    periodVisitorCount,
    orderedUserActionFunnel,
    recordedArrivalFunnel,
    nextActionSeq,
    acceptClientOccurredAt,
    resolveBookId,
    whatsappTokens,
    formatIstanbulStamp,
    confirmedResultCount,
    normalizeZeroSearchPage,
    appendZeroSearchRows,
    missingZeroSearchRpc
  };

  if(typeof module==="object"&&module.exports)module.exports=api;
  root.KutadguAnalyticsCore=api;
})(typeof window!=="undefined"?window:typeof global!=="undefined"?global:this);
