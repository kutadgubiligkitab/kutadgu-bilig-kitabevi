(function(){
"use strict";

const cfg=window.KUTADGU_SUPABASE_CONFIG||{};
const CART_KEY="kutadgu-cart-v1";
const FAV_KEY="kutadgu-favorites-v1";
const SHOP_OWNER_KEY="kutadgu-shop-owner-v1";
const SHOP_OWNER_GUEST="guest";
const SHOP_OWNER_STALE="stale";
const SDK_URL="/vendor/supabase-js-2.45.4.umd.js";
let db=null,user=null,profile=null,blocked=false,initError=null;
let applyChain=Promise.resolve(),lastLoginRecordedAt=0;
let readyResolve;
const ready=new Promise(resolve=>{readyResolve=resolve});

function configured(){
  return !!(String(cfg.url||"").trim()&&String(cfg.anonKey||cfg.publishableKey||"").trim());
}
function safeJson(key,fallback){
  try{const value=JSON.parse(localStorage.getItem(key));return value??fallback}catch(e){return fallback}
}
function setFieldDirection(field){
  if(!field?.matches||field.matches('input[type="checkbox"],input[type="radio"],input[type="file"],input[type="button"],input[type="submit"],input[type="range"],input[type="color"]'))return;
  const type=String(field.getAttribute("type")||"").toLowerCase();
  const ltr=["email","tel","url","number","password","date","time","datetime-local","month","week"].includes(type);
  const update=()=>{
    let direction="";
    if(ltr)direction="ltr";
    else{
      const text=String(field.value||field.getAttribute("placeholder")||"");
      for(const char of text){
        if(!/\p{L}/u.test(char))continue;
        direction=/[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/u.test(char)?"rtl":"ltr";
        break;
      }
      if(!direction)direction="rtl";
    }
    field.setAttribute("dir",direction);
    field.style.direction=direction;
    field.style.textAlign=direction==="rtl"?"right":"left";
  };
  if(field.dataset.kutadguDirectionReady!=="1"){
    field.dataset.kutadguDirectionReady="1";
    field.addEventListener("input",update);
    field.addEventListener("change",update);
  }
  update();
}
function applyFieldDirections(root=document){
  if(root?.matches?.("input,textarea"))setFieldDirection(root);
  root.querySelectorAll?.("input,textarea").forEach(setFieldDirection);
}
function enableSmartFieldDirections(){
  applyFieldDirections(document);
  if(!document.body||typeof MutationObserver!=="function")return;
  const observer=new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{
    if(node?.querySelectorAll||node?.matches)applyFieldDirections(node);
  })));
  observer.observe(document.body,{childList:true,subtree:true});
}
function emit(name="kutadgu-member-change"){
  document.dispatchEvent(new CustomEvent(name,{detail:{user,profile,blocked,error:initError}}));
}
function ensureStyle(){
  if(document.querySelector('link[data-kutadgu-member-style]'))return;
  const link=document.createElement("link");
  link.rel="stylesheet";link.href="member.css?v=2";link.dataset.kutadguMemberStyle="1";
  document.head.appendChild(link);
}
function loadSdk(){
  if(window.supabase?.createClient)return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const old=document.querySelector('script[data-kutadgu-supabase-sdk]');
    if(old){old.addEventListener("load",resolve,{once:true});old.addEventListener("error",reject,{once:true});return}
    const script=document.createElement("script");
    script.src=SDK_URL;script.async=true;script.dataset.kutadguSupabaseSdk="1";
    script.onload=resolve;script.onerror=()=>reject(new Error("Supabase كۈتۈپخانىسى يۈكلەنمىدى"));
    document.head.appendChild(script);
  });
}
function accountButton(){
  if(document.body?.dataset.accountPage==="true")return null;
  let button=document.querySelector(".member-account-button");
  if(button)return button;
  let host=document.querySelector(".shop-floating");
  if(!host){
    host=document.createElement("div");host.className="member-standalone-floating";document.body.appendChild(host);
  }
  button=document.createElement("a");
  button.className="member-account-button";button.href="account.html";
  host.appendChild(button);
  return button;
}
function renderButton(){
  const button=accountButton();if(!button)return;
  if(blocked){button.textContent="⛔ ھېساب توختىتىلغان";button.classList.add("is-blocked");return}
  button.classList.remove("is-blocked");
  if(user){
    const name=String(profile?.full_name||"").trim();
    button.textContent=`👤 ${name||"ھېسابىم"}`;
  }else button.textContent="👤 كىرىش / ئەزا بولۇش";
}
async function fetchProfile(){
  if(!db||!user)return null;
  const {data,error}=await db.from("profiles").select("*").eq("id",user.id).maybeSingle();
  if(error)throw error;
  profile=data||null;
  return profile;
}
async function recordVisit(){
  if(!db||!user||blocked)return;
  const key=`kutadgu-last-visit-${user.id}`;
  const now=Date.now(),last=Number(localStorage.getItem(key)||0);
  if(now-last<60000)return;
  const page=`${location.pathname.split("/").pop()||"index.html"}${location.search||""}`;
  const {error}=await db.rpc("record_member_visit",{page_path:page});
  if(!error)localStorage.setItem(key,String(now));
}
function memberLog(level,step,detail){
  const payload={step,detail:detail&&detail.message?String(detail.message):detail};
  if(level==="error")console.error("Kutadgu member shop",payload,detail);
  else console.warn("Kutadgu member shop",payload,detail||"");
}
async function fetchCanonicalIdMap(ids=[]){
  const helpers=window.KutadguLegacyIds;
  const map=Object.assign({},helpers?.KNOWN_RESTORED_ALIASES||{},helpers?.readPersistedAliasMap?helpers.readPersistedAliasMap():{});
  const unique=[...new Set((ids||[]).map(id=>String(id||"").trim()).filter(Boolean))];
  unique.forEach(id=>{
    if(helpers?.isCanonicalBookId?.(id)&&!map[id])map[id]=id;
  });
  if(!db||!unique.length)return map;
  const split=helpers?.splitLookupIds?helpers.splitLookupIds(unique):{numeric:unique.filter(id=>/^\d+$/.test(id)),legacy:unique.filter(id=>id&&!/^\d+$/.test(id))};
  const numericIds=split.numeric.map(id=>/^\d+$/.test(id)?Number(id):id);
  const queries=[];
  if(numericIds.length){
    queries.push(db.from("books").select("id,legacy_id").in("id",numericIds));
  }
  if(split.legacy.length){
    queries.push(db.from("books").select("id,legacy_id").in("legacy_id",split.legacy));
  }
  if(!queries.length)return map;
  try{
    const results=await Promise.all(queries);
    results.forEach(({data,error})=>{
      if(error)throw error;
      (data||[]).forEach(row=>{
        const id=String(row.id||"").trim();
        const legacy=String(row.legacy_id||"").trim();
        if(helpers?.rememberRowAliases)Object.assign(map,helpers.rememberRowAliases(map,id,legacy));
        else{
          if(id&&legacy){map[legacy]=id;map[id]=legacy}
          else if(id)map[id]=id;
        }
      });
    });
  }catch(err){
    memberLog("warn","canonical-id-lookup",err);
  }
  try{localStorage.setItem("kutadgu-id-aliases-v1",JSON.stringify(map))}catch(e){}
  return map;
}
function memberResolveId(id,idMap={}){
  const helpers=window.KutadguLegacyIds;
  const resolve=helpers?.bindResolve
    ?helpers.bindResolve(raw=>{
      const book=window.kutadguShop?.find?.(raw);
      return book?.id&&helpers.isCanonicalBookId?.(book.id)?String(book.id):raw;
    },idMap)
    :raw=>String(idMap[raw]||raw);
  return resolve(id);
}
async function replaceFavorites(values){
  if(!db||!user||blocked){
    memberLog("warn","replace-favorites-skipped",{hasDb:!!db,hasUser:!!user,blocked});
    return {ok:false,reason:"not-ready"};
  }
  const ids=[...new Set((Array.isArray(values)?values:[]).map(String).filter(Boolean))];
  const helpers=window.KutadguLegacyIds;
  const aliasIds=helpers?.replacementIdentityIds?helpers.replacementIdentityIds([],ids,memberResolveId,helpers.readPersistedAliasMap?helpers.readPersistedAliasMap():{}):[];
  if(aliasIds.length){
    const {error:aliasDelError}=await db.from("member_favorites").delete().eq("user_id",user.id).in("book_id",aliasIds);
    if(aliasDelError){
      memberLog("error","replace-favorites-alias-delete",aliasDelError);
      throw aliasDelError;
    }
  }
  const {error:delError}=await db.from("member_favorites").delete().eq("user_id",user.id);
  if(delError){
    memberLog("error","replace-favorites-delete",delError);
    throw delError;
  }
  if(ids.length){
    const {error}=await db.from("member_favorites").insert(ids.map(book_id=>({user_id:user.id,book_id})));
    if(error){
      memberLog("error","replace-favorites-insert",error);
      throw error;
    }
  }
  const {data:verify,error:verifyError}=await db.from("member_favorites").select("book_id").eq("user_id",user.id);
  if(verifyError){
    memberLog("error","replace-favorites-verify",verifyError);
    throw verifyError;
  }
  const remaining=(verify||[]).map(row=>String(row.book_id||"")).filter(Boolean).sort();
  const expected=[...ids].sort();
  if(JSON.stringify(remaining)!==JSON.stringify(expected)){
    const err=new Error("member_favorites replace verify mismatch");
    memberLog("error","replace-favorites-verify-mismatch",{remaining,expected});
    throw err;
  }
  return {ok:true,ids};
}
function sanitizeMemberQty(raw){
  return window.KutadguLegacyIds?.sanitizeCartQty
    ?window.KutadguLegacyIds.sanitizeCartQty(raw)
    :Math.max(1,Math.min(99,parseInt(String(raw??1),10)||1));
}
async function replaceCart(values){
  if(!db||!user||blocked){
    memberLog("warn","replace-cart-skipped",{hasDb:!!db,hasUser:!!user,blocked});
    return {ok:false,reason:"not-ready"};
  }
  const helpers=window.KutadguLegacyIds;
  previewShopDebug("replace-cart",{
    writeUser:idSuffix(user.id),
    rowCount:(Array.isArray(values)?values:[]).filter(x=>x&&x.id).length
  });
  const rows=(Array.isArray(values)?values:[])
    .filter(x=>x&&x.id)
    .map(x=>({user_id:user.id,book_id:String(x.id),quantity:sanitizeMemberQty(x.qty)}));
  const aliasIds=helpers?.replacementIdentityIds?helpers.replacementIdentityIds(values,[],memberResolveId,helpers.readPersistedAliasMap?helpers.readPersistedAliasMap():{}):[];
  const {error:aliasDelError}=aliasIds.length
    ?await db.from("member_cart_items").delete().eq("user_id",user.id).in("book_id",aliasIds)
    :{error:null};
  if(aliasDelError){
    memberLog("error","replace-cart-alias-delete",aliasDelError);
    throw aliasDelError;
  }
  const {error:delError}=await db.from("member_cart_items").delete().eq("user_id",user.id);
  if(delError){
    memberLog("error","replace-cart-delete",delError);
    throw delError;
  }
  if(rows.length){
    const {error}=await db.from("member_cart_items").insert(rows);
    if(error){
      memberLog("error","replace-cart-insert",error);
      throw error;
    }
  }
  const {data:verify,error:verifyError}=await db.from("member_cart_items").select("book_id,quantity").eq("user_id",user.id);
  if(verifyError){
    memberLog("error","replace-cart-verify",verifyError);
    throw verifyError;
  }
  const remaining=(verify||[]).map(row=>({id:String(row.book_id||""),qty:sanitizeMemberQty(row.quantity)}));
  if(remaining.some(row=>helpers?.isCanonicalBookId&&!helpers.isCanonicalBookId(row.id))){
    const err=new Error("member_cart_items still contains legacy alias rows");
    memberLog("error","replace-cart-alias-survived",remaining);
    throw err;
  }
  const expected=rows.map(row=>({id:row.book_id,qty:row.quantity})).sort((a,b)=>a.id.localeCompare(b.id));
  const got=remaining.slice().sort((a,b)=>a.id.localeCompare(b.id));
  if(JSON.stringify(expected)!==JSON.stringify(got)){
    const err=new Error("member_cart_items replace verify mismatch");
    memberLog("error","replace-cart-verify-mismatch",{expected,got});
    throw err;
  }
  return {ok:true,rows};
}
let mergedForUserId=null;
let shopSyncInFlight=null;
let shopSyncUserId=null;
const MERGE_LOCK_KEY="kutadgu-member-shop-merged-v3";
function readMergeLock(){
  try{return String(localStorage.getItem(MERGE_LOCK_KEY)||"")}catch(e){return ""}
}
function writeMergeLock(id){
  mergedForUserId=id||null;
  try{
    if(id)localStorage.setItem(MERGE_LOCK_KEY,id);
    else localStorage.removeItem(MERGE_LOCK_KEY);
  }catch(e){}
}
function readShopOwner(){
  try{return String(localStorage.getItem(SHOP_OWNER_KEY)||"").trim()}catch(e){return ""}
}
function writeShopOwner(owner){
  try{
    if(owner)localStorage.setItem(SHOP_OWNER_KEY,owner);
    else localStorage.removeItem(SHOP_OWNER_KEY);
  }catch(e){}
}
function stampShopOwnerForCurrentUser(){
  writeShopOwner(user?.id?String(user.id):SHOP_OWNER_GUEST);
}
function shouldMergeLocalForUser(userId){
  const owner=readShopOwner();
  if(!owner||owner===SHOP_OWNER_GUEST)return true;
  if(owner===SHOP_OWNER_STALE)return false;
  return owner===String(userId||"");
}
function localItemsForMerge(userId,localCart,localFav){
  if(shouldMergeLocalForUser(userId)){
    return {
      localCart:Array.isArray(localCart)?localCart:[],
      localFav:Array.isArray(localFav)?localFav:[]
    };
  }
  return {localCart:[],localFav:[]};
}
function stillMergingFor(userId){
  return !!(db&&user&&!blocked&&String(user.id)===String(userId||""));
}
function idSuffix(value){
  const text=String(value||"").trim();
  if(!text)return "(empty)";
  if(text===SHOP_OWNER_GUEST||text===SHOP_OWNER_STALE)return text;
  return text.slice(-4);
}
function isPreviewShopDebug(){
  try{
    const host=String(location.hostname||"").toLowerCase();
    if(host==="www.kutadgubilik.com"||host==="kutadgubilik.com")return false;
    if(typeof window.kutadguIsProductionAuthHost==="function"&&window.kutadguIsProductionAuthHost(host))return false;
    return host.endsWith(".vercel.app")||host==="localhost"||host==="127.0.0.1";
  }catch(e){return false}
}
function previewShopDebug(event,fields){
  if(!isPreviewShopDebug())return;
  const safe={event:String(event||"")};
  Object.keys(fields||{}).forEach(key=>{
    if(/(email|token|password|secret|anon|jwt|authorization|apikey)/i.test(key))return;
    const val=fields[key];
    if(typeof val==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)){
      safe[key]=idSuffix(val);
      return;
    }
    safe[key]=val;
  });
  console.info("[kutadgu-shop-debug]",safe);
}
function mergeSourceDecision(userId,rawLocalCount,cloudCount){
  const owner=readShopOwner();
  const mergeLocal=shouldMergeLocalForUser(userId);
  let reason="cloud-only";
  if(!owner)reason="union-local-missing-owner";
  else if(owner===SHOP_OWNER_GUEST)reason="union-local-guest";
  else if(owner===SHOP_OWNER_STALE)reason="cloud-only-stale-owner";
  else if(owner===String(userId||""))reason="union-local-same-owner";
  else reason="cloud-only-foreign-owner";
  if(!mergeLocal&&(reason.startsWith("union-")))reason="cloud-only";
  return {owner:owner?idSuffix(owner):"(empty)",mergeLocal,reason,rawLocalCount,cloudCount};
}
function clearLocalCartAndFavorites(){
  try{
    localStorage.removeItem(CART_KEY);
    localStorage.removeItem(FAV_KEY);
  }catch(e){}
  emit("kutadgu-member-state-synced");
}
function abandonMemberShopSync(){
  user=null;
  profile=null;
  blocked=false;
  writeMergeLock("");
  writeShopOwner(SHOP_OWNER_STALE);
  clearLocalCartAndFavorites();
  previewShopDebug("abandon-sync",{
    owner:idSuffix(readShopOwner()),
    localCart:Array.isArray(safeJson(CART_KEY,[]))?safeJson(CART_KEY,[]).length:0
  });
  const pending=shopSyncInFlight;
  if(pending){
    Promise.resolve(pending).finally(()=>{
      if(!user){
        writeShopOwner(SHOP_OWNER_STALE);
        clearLocalCartAndFavorites();
      }
    });
  }
  return pending;
}
async function mergeShopState(){
  if(!db||!user||blocked)return;
  const mergeForUserId=user.id;
  if(shopSyncInFlight){
    if(shopSyncUserId===mergeForUserId)return shopSyncInFlight;
    try{await shopSyncInFlight}catch(e){}
    if(!stillMergingFor(mergeForUserId))return;
  }
  shopSyncUserId=mergeForUserId;
  shopSyncInFlight=(async()=>{
    try{
      const [{data:favRows,error:favError},{data:cartRows,error:cartError}]=await Promise.all([
        db.from("member_favorites").select("book_id,user_id").eq("user_id",mergeForUserId),
        db.from("member_cart_items").select("book_id,quantity,user_id").eq("user_id",mergeForUserId)
      ]);
      if(favError){
        memberLog("error","fetch-cloud-favorites",favError);
        throw favError;
      }
      if(cartError){
        memberLog("error","fetch-cloud-cart",cartError);
        throw cartError;
      }
      if(!stillMergingFor(mergeForUserId))return;

      const cloudFav=(favRows||[]).map(x=>x.book_id).filter(Boolean);
      const cloudCart=(cartRows||[]).map(x=>({id:x.book_id,qty:x.quantity}));
      const rawLocalFav=Array.isArray(safeJson(FAV_KEY,[]))?safeJson(FAV_KEY,[]):[];
      const rawLocalCart=Array.isArray(safeJson(CART_KEY,[]))?safeJson(CART_KEY,[]):[];
      const gated=localItemsForMerge(mergeForUserId,rawLocalCart,rawLocalFav);
      const localFav=gated.localFav;
      const localCart=gated.localCart;
      const foreignCart=(cartRows||[]).filter(row=>row&&row.user_id&&String(row.user_id)!==String(mergeForUserId)).length;
      const decision=mergeSourceDecision(mergeForUserId,Array.isArray(rawLocalCart)?rawLocalCart.length:0,cloudCart.length);
      previewShopDebug("merge-fetch",{
        user:idSuffix(mergeForUserId),
        liveUser:idSuffix(user&&user.id),
        owner:decision.owner,
        localCart:decision.rawLocalCount,
        cloudCart:decision.cloudCount,
        gatedLocalCart:localCart.length,
        mergeSource:decision.reason,
        mergeLocal:decision.mergeLocal,
        filterEqUser:idSuffix(mergeForUserId),
        foreignCartRows:foreignCart
      });
      const pendingIds=[
        ...cloudFav,
        ...cloudCart.map(x=>x.id),
        ...localFav,
        ...localCart.map(x=>x?.id)
      ].map(String).filter(Boolean);
      const idMap=await fetchCanonicalIdMap(pendingIds);
      if(!stillMergingFor(mergeForUserId))return;
      if(typeof window.kutadguShop?.hydrateBooksByIds==="function"){
        await window.kutadguShop.hydrateBooksByIds(pendingIds);
      }
      if(!stillMergingFor(mergeForUserId))return;

      const helpers=window.KutadguLegacyIds;
      const aliases={...idMap,...(helpers?.readPersistedAliasMap?helpers.readPersistedAliasMap():{})};
      const resolveId=id=>memberResolveId(id,aliases);
      const synced=helpers?.syncAuthenticatedShopState
        ?helpers.syncAuthenticatedShopState({localCart,localFav,cloudCart,cloudFav,resolveId,aliasMap:aliases})
        :{
          cart:helpers?.repairCapPollutedCartItems?helpers.repairCapPollutedCartItems([...(cloudCart||[]),...(localCart||[])],resolveId,aliases):localCart,
          fav:helpers?.migrateIdList?helpers.migrateIdList([...(localFav||[]),...(cloudFav||[])],resolveId):[...new Set([...(localFav||[]),...(cloudFav||[])].map(String))]
        };

      const mergedFav=synced.fav;
      const mergedCart=synced.cart;
      if(!stillMergingFor(mergeForUserId))return;
      previewShopDebug("merge-write",{
        mergeUser:idSuffix(mergeForUserId),
        liveUser:idSuffix(user&&user.id),
        writeMismatch:String(user&&user.id)!==String(mergeForUserId),
        mergedCart:mergedCart.length,
        mergeSource:decision.reason
      });
      try{
        await replaceFavorites(mergedFav);
        await replaceCart(mergedCart);
      }catch(saveErr){
        writeMergeLock("");
        throw saveErr;
      }
      if(!stillMergingFor(mergeForUserId))return;
      localStorage.setItem(FAV_KEY,JSON.stringify(mergedFav));
      localStorage.setItem(CART_KEY,JSON.stringify(mergedCart));
      writeShopOwner(String(mergeForUserId));
      writeMergeLock(mergeForUserId);
      previewShopDebug("merge-applied",{
        user:idSuffix(mergeForUserId),
        owner:idSuffix(readShopOwner()),
        localCart:mergedCart.length,
        cloudCart:cloudCart.length,
        mergeSource:decision.reason
      });
      emit("kutadgu-member-state-synced");
    }catch(err){
      writeMergeLock("");
      memberLog("error","member-shop-sync",err);
    }
  })().finally(()=>{
    if(shopSyncUserId===mergeForUserId){
      shopSyncInFlight=null;
      shopSyncUserId=null;
    }
  });
  return shopSyncInFlight;
}
const syncTimers=new Map();
function syncKey(key,value){
  if(!user||blocked||![CART_KEY,FAV_KEY].includes(key))return;
  const syncForUserId=user.id;
  previewShopDebug("sync-key",{
    key:key===CART_KEY?"cart":"fav",
    user:idSuffix(syncForUserId),
    count:Array.isArray(value)?value.length:0
  });
  clearTimeout(syncTimers.get(key));
  const run=async()=>{
    try{
      if(!stillMergingFor(syncForUserId))return;
      if(key===FAV_KEY)await replaceFavorites(value);
      if(key===CART_KEY)await replaceCart(value);
    }catch(err){memberLog("error","member-state-save",err)}
    finally{syncTimers.delete(key)}
  };
  syncTimers.set(key,setTimeout(run,0));
}
async function applySession(session,{trackLogin=false,sync=false}={}){
  user=session?.user||null;profile=null;blocked=false;
  previewShopDebug("apply-session",{
    user:idSuffix(user&&user.id),
    sync:!!sync,
    trackLogin:!!trackLogin,
    owner:idSuffix(readShopOwner()),
    localCart:Array.isArray(safeJson(CART_KEY,[]))?safeJson(CART_KEY,[]).length:0
  });
  if(user){
    try{
      await fetchProfile();
      if(profile?.status==="suspended"){
        blocked=true;renderButton();emit();await db.auth.signOut();user=null;return;
      }
      if(trackLogin&&Date.now()-lastLoginRecordedAt>5000){
        await db.rpc("record_member_login");lastLoginRecordedAt=Date.now();
      }
      await recordVisit();
      if(sync)await mergeShopState();
      await fetchProfile();
    }catch(err){
      initError=err;
      console.warn("Member session setup failed",err);
    }
  }
  renderButton();emit();
}
function queueSession(session,options){
  applyChain=applyChain.then(()=>applySession(session,options)).catch(err=>{
    initError=err;console.warn("Member session queue failed",err);
  });
  return applyChain;
}
async function signUp({email,password,fullName}){
  if(!db)throw new Error("ئەزالىق مۇلازىمىتى تېخى تەييار ئەمەس");
  const result=await db.auth.signUp({email,password,options:{data:{full_name:fullName||""},emailRedirectTo:new URL("account.html",location.href).href}});
  if(result.error)throw result.error;
  if(result.data?.session)await queueSession(result.data.session,{trackLogin:true,sync:true});
  return result.data;
}
async function signIn({email,password}){
  if(!db)throw new Error("ئەزالىق مۇلازىمىتى تېخى تەييار ئەمەس");
  const {data,error}=await db.auth.signInWithPassword({email,password});
  if(error)throw error;
  previewShopDebug("sign-in",{
    user:idSuffix(data.user&&data.user.id),
    sessionUser:idSuffix(data.session&&data.session.user&&data.session.user.id),
    sameUser:String(data.user&&data.user.id)===String(data.session&&data.session.user&&data.session.user.id)
  });
  await queueSession(data.session,{trackLogin:true,sync:true});
  return data;
}
function googleAccountRedirectTo(){
  const wwwAccount="https://www.kutadgubilik.com/account.html";
  const host=String(location.hostname||"");
  const origin=String(location.origin||"").replace(/\/+$/,"");
  if(window.kutadguIsProductionAuthHost?window.kutadguIsProductionAuthHost(host):(host==="www.kutadgubilik.com"||host==="kutadgubilik.com"||host==="kutadgu-bilig-kitab.vercel.app")){
    return wwwAccount;
  }
  if(origin && origin!=="null")return origin+"/account.html";
  if(typeof window.kutadguGoogleAccountRedirectTo==="function"){
    const url=String(window.kutadguGoogleAccountRedirectTo()||"");
    if(/\/account\.html$/i.test(url) && url.indexOf("reset-password")===-1)return url;
  }
  return wwwAccount;
}

async function signInWithGoogle(){
  if(!db)throw new Error("ئەزالىق مۇلازىمىتى تېخى تەييار ئەمەس");
  const redirectTo=googleAccountRedirectTo();
  const {data,error}=await db.auth.signInWithOAuth({provider:"google",options:{redirectTo}});
  if(error)throw error;
  return data;
}
async function signOut(){
  const pending=abandonMemberShopSync();
  previewShopDebug("sign-out",{
    owner:idSuffix(readShopOwner()),
    localCart:Array.isArray(safeJson(CART_KEY,[]))?safeJson(CART_KEY,[]).length:0,
    liveUser:idSuffix(user&&user.id)
  });
  if(db)await db.auth.signOut();
  if(pending)try{await pending}catch(e){}
  if(!user){
    writeShopOwner(SHOP_OWNER_STALE);
    clearLocalCartAndFavorites();
  }
  previewShopDebug("sign-out-done",{
    owner:idSuffix(readShopOwner()),
    localCart:Array.isArray(safeJson(CART_KEY,[]))?safeJson(CART_KEY,[]).length:0,
    liveUser:idSuffix(user&&user.id)
  });
  renderButton();emit();
}
async function resetPassword(email,next="account"){
  if(!db)throw new Error("ئەزالىق مۇلازىمىتى تېخى تەييار ئەمەس");
  const redirectTo=(window.kutadguPasswordResetRedirectTo||function(n){
    return "https://www.kutadgubilik.com/reset-password.html?next="+encodeURIComponent(n==="admin"?"admin":"account");
  })(next);
  const {error}=await db.auth.resetPasswordForEmail(email,{redirectTo});
  if(error)throw error;
}
async function updateProfile(values){
  if(!db||!user)throw new Error("ئاۋۋال ھېسابىڭىزغا كىرىڭ");
  const allowed={
    full_name:String(values.full_name||"").trim(),
    phone:String(values.phone||"").trim(),
    country:String(values.country||"").trim(),
    city:String(values.city||"").trim(),
    address:String(values.address||"").trim()
  };
  const {data,error}=await db.from("profiles").update(allowed).eq("id",user.id).select().single();
  if(error)throw error;
  profile=data;renderButton();emit();return data;
}
async function getOrders(){
  if(!db||!user)return [];
  const {data,error}=await db.from("orders").select("*").eq("user_id",user.id).order("created_at",{ascending:false});
  if(error)throw error;
  return data||[];
}
async function saveOrder(order){
  if(!db||!user)return {saved:false,reason:"not_signed_in"};
  if(blocked)return {saved:false,reason:"suspended"};
  const c=order.customer||{};
  const row={
    order_no:order.orderId,
    user_id:user.id,
    status:"prepared",
    items:Array.isArray(order.items)?order.items:[],
    total:Number(order.total)||0,
    total_qty:Number(order.totalQty)||0,
    customer_name:c.name||"",
    customer_phone:c.phone||"",
    customer_city:c.city||"",
    customer_address:c.address||"",
    delivery_method:c.delivery||"",
    customer_note:c.note||""
  };
  const {data,error}=await db.from("orders").insert(row).select().single();
  if(error)throw error;
  return {saved:true,order:data};
}

const api=window.KutadguMember={
  ready,
  configured,
  getClient:()=>db,
  getUser:()=>user,
  getProfile:()=>profile,
  isBlocked:()=>blocked,
  refreshProfile:fetchProfile,
  signUp,signIn,signInWithGoogle,signOut,resetPassword,updateProfile,getOrders,saveOrder,syncKey,applyFieldDirections,
  readShopOwner,writeShopOwner,shouldMergeLocalForUser,localItemsForMerge,
  SHOP_OWNER_KEY,SHOP_OWNER_GUEST,SHOP_OWNER_STALE
};

async function init(){
  enableSmartFieldDirections();ensureStyle();renderButton();
  if(!configured()){initError=new Error("Supabase سەپلىمىسى يوق");readyResolve(api);emit();return}
  try{
    await loadSdk();
    db=window.supabase.createClient(cfg.url,cfg.anonKey||cfg.publishableKey,{
      auth:{detectSessionInUrl:true,persistSession:true,flowType:"pkce"}
    });
    const {data,error}=await db.auth.getSession();
    if(error)throw error;
    await queueSession(data.session,{sync:!!data.session?.user});
    db.auth.onAuthStateChange((event,session)=>{
      if(event==="SIGNED_OUT")abandonMemberShopSync();
      if(event==="INITIAL_SESSION"||event==="TOKEN_REFRESHED"||event==="USER_UPDATED")return;
      const isLogin=event==="SIGNED_IN";
      setTimeout(()=>queueSession(session,{trackLogin:isLogin,sync:isLogin}),0);
    });
  }catch(err){initError=err;console.warn("Member system failed to initialize",err);renderButton();emit()}
  readyResolve(api);
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
