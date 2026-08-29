(function(){
"use strict";

const cfg=window.KUTADGU_SUPABASE_CONFIG||{};
const CART_KEY="kutadgu-cart-v1";
const FAV_KEY="kutadgu-favorites-v1";
const SDK_URL="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";
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
async function fetchCanonicalIdMap(ids=[]){
  const helpers=window.KutadguLegacyIds;
  const map=helpers?.readPersistedAliasMap?helpers.readPersistedAliasMap():{};
  const unique=[...new Set((ids||[]).map(id=>String(id||"").trim()).filter(Boolean))];
  unique.forEach(id=>{
    if(map[id])return;
    if(helpers?.isCanonicalBookId?.(id))map[id]=id;
  });
  if(!db||!unique.length)return map;
  const split=helpers?.splitLookupIds?helpers.splitLookupIds(unique):{numeric:unique.filter(id=>/^\d+$/.test(id)),legacy:unique.filter(id=>id&&!/^\d+$/.test(id))};
  const queries=[];
  if(split.numeric.length){
    queries.push(db.from("books").select("id,legacy_id").in("id",split.numeric));
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
          if(id)map[id]=id;
          if(id&&legacy)map[legacy]=id;
        }
      });
    });
  }catch(err){
    console.warn("Member book identity lookup failed",err);
  }
  try{localStorage.setItem("kutadgu-id-aliases-v1",JSON.stringify(map))}catch(e){}
  return map;
}
function memberResolveId(id,idMap={}){
  const raw=String(id||"");
  const fromShop=window.kutadguShop?.find?.(raw);
  if(fromShop?.id)return String(fromShop.id);
  const helpers=window.KutadguLegacyIds;
  if(helpers?.applyBookIdMap){
    const mapped=helpers.applyBookIdMap(raw,idMap);
    if(mapped)return mapped;
  }
  return idMap[raw]||raw;
}
async function replaceFavorites(values){
  if(!db||!user||blocked)return;
  const ids=[...new Set((Array.isArray(values)?values:[]).map(String).filter(Boolean))];
  const {error:delError}=await db.from("member_favorites").delete().eq("user_id",user.id);
  if(delError)throw delError;
  if(ids.length){
    const {error}=await db.from("member_favorites").insert(ids.map(book_id=>({user_id:user.id,book_id})));
    if(error)throw error;
  }
}
function sanitizeMemberQty(raw){
  return window.KutadguLegacyIds?.sanitizeCartQty
    ?window.KutadguLegacyIds.sanitizeCartQty(raw)
    :Math.max(1,Math.min(99,parseInt(String(raw??1),10)||1));
}
async function replaceCart(values){
  if(!db||!user||blocked)return;
  const rows=(Array.isArray(values)?values:[])
    .filter(x=>x&&x.id)
    .map(x=>({user_id:user.id,book_id:String(x.id),quantity:sanitizeMemberQty(x.qty)}));
  const {error:delError}=await db.from("member_cart_items").delete().eq("user_id",user.id);
  if(delError)throw delError;
  if(rows.length){
    const {error}=await db.from("member_cart_items").insert(rows);
    if(error)throw error;
  }
}
let mergedForUserId=null;
const MERGE_LOCK_KEY="kutadgu-member-shop-merged-v2";
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
async function mergeShopState(){
  if(!db||!user||blocked)return;
  if(mergedForUserId===user.id||readMergeLock()===user.id)return;
  writeMergeLock(user.id);
  try{
    const [{data:favRows,error:favError},{data:cartRows,error:cartError}]=await Promise.all([
      db.from("member_favorites").select("book_id").eq("user_id",user.id),
      db.from("member_cart_items").select("book_id,quantity").eq("user_id",user.id)
    ]);
    if(favError)throw favError;if(cartError)throw cartError;

    const cloudFav=(favRows||[]).map(x=>x.book_id).filter(Boolean);
    const cloudCart=(cartRows||[]).map(x=>({id:x.book_id,qty:x.quantity}));
    const localFav=Array.isArray(safeJson(FAV_KEY,[]))?safeJson(FAV_KEY,[]):[];
    const localCart=Array.isArray(safeJson(CART_KEY,[]))?safeJson(CART_KEY,[]):[];
    const pendingIds=[
      ...cloudFav,
      ...cloudCart.map(x=>x.id),
      ...localFav,
      ...localCart.map(x=>x?.id)
    ].map(String).filter(Boolean);
    const idMap=await fetchCanonicalIdMap(pendingIds);
    if(typeof window.kutadguShop?.hydrateBooksByIds==="function"){
      await window.kutadguShop.hydrateBooksByIds(pendingIds);
    }

    const resolveId=id=>memberResolveId(id,idMap);
    const helpers=window.KutadguLegacyIds;
    const aliases={...idMap,...(helpers?.readPersistedAliasMap?helpers.readPersistedAliasMap():{})};

    const mergedFav=helpers?.mergeGuestAndCloudFavs
      ?helpers.mergeGuestAndCloudFavs(localFav,cloudFav,resolveId)
      :(helpers?.migrateIdList?helpers.migrateIdList([...localFav,...cloudFav].map(String).filter(Boolean),resolveId):[...new Set([...localFav,...cloudFav].map(String).filter(Boolean))]);

    const combinedCart=[
      ...(Array.isArray(cloudCart)?cloudCart:[]),
      ...(Array.isArray(localCart)?localCart:[])
    ];
    const mergedCart=helpers?.repairCapPollutedCartItems
      ?helpers.repairCapPollutedCartItems(combinedCart,resolveId,aliases)
      :(helpers?.mergeGuestAndCloudCart
        ?helpers.mergeGuestAndCloudCart(localCart,cloudCart,resolveId)
        :(helpers?.migrateCartItems?helpers.migrateCartItems(combinedCart,resolveId):localCart));

    const nextFavJson=JSON.stringify(mergedFav);
    const nextCartJson=JSON.stringify(mergedCart);
    const prevFavJson=JSON.stringify(Array.isArray(localFav)?localFav.map(String):[]);
    const prevCartJson=JSON.stringify(Array.isArray(localCart)?localCart:[]);
    if(nextFavJson!==prevFavJson)localStorage.setItem(FAV_KEY,nextFavJson);
    if(nextCartJson!==prevCartJson)localStorage.setItem(CART_KEY,nextCartJson);

    const cloudFavCanon=helpers?.migrateIdList?helpers.migrateIdList(cloudFav,resolveId):cloudFav.map(String);
    const cloudCartCanon=helpers?.repairCapPollutedCartItems
      ?helpers.repairCapPollutedCartItems(cloudCart,resolveId,aliases)
      :(helpers?.migrateCartItems?helpers.migrateCartItems(cloudCart,resolveId):cloudCart);
    const cloudChanged=JSON.stringify(cloudFavCanon)!==nextFavJson||JSON.stringify(cloudCartCanon)!==nextCartJson;
    if(cloudChanged||nextFavJson!==prevFavJson||nextCartJson!==prevCartJson){
      await replaceFavorites(mergedFav);
      await replaceCart(mergedCart);
    }
    emit("kutadgu-member-state-synced");
  }catch(err){
    writeMergeLock("");
    console.warn("Member shop sync failed",err);
  }
}
const syncTimers=new Map();
function syncKey(key,value){
  if(!user||blocked||![CART_KEY,FAV_KEY].includes(key))return;
  clearTimeout(syncTimers.get(key));
  const run=async()=>{
    try{
      if(key===FAV_KEY)await replaceFavorites(value);
      if(key===CART_KEY)await replaceCart(value);
    }catch(err){console.warn("Member state save failed",err)}
    finally{syncTimers.delete(key)}
  };
  syncTimers.set(key,setTimeout(run,0));
}
async function applySession(session,{trackLogin=false,sync=false}={}){
  user=session?.user||null;profile=null;blocked=false;
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
  if(result.data?.session)await queueSession(result.data.session,{trackLogin:true,sync:false});
  return result.data;
}
async function signIn({email,password}){
  if(!db)throw new Error("ئەزالىق مۇلازىمىتى تېخى تەييار ئەمەس");
  const {data,error}=await db.auth.signInWithPassword({email,password});
  if(error)throw error;
  await queueSession(data.session,{trackLogin:true,sync:false});
  return data;
}
async function signInWithGoogle(){
  if(!db)throw new Error("ئەزالىق مۇلازىمىتى تېخى تەييار ئەمەس");
  const redirectTo=new URL("account.html",location.href).href;
  const {data,error}=await db.auth.signInWithOAuth({provider:"google",options:{redirectTo}});
  if(error)throw error;
  return data;
}
async function signOut(){
  if(db)await db.auth.signOut();
  writeMergeLock("");
  user=null;profile=null;blocked=false;renderButton();emit();
}
async function resetPassword(email,next="account"){
  if(!db)throw new Error("ئەزالىق مۇلازىمىتى تېخى تەييار ئەمەس");
  const redirectTo=(window.kutadguPasswordResetRedirectTo||function(n){
    return `${String(window.KUTADGU_SITE_ORIGIN||location.origin).replace(/\/+$/,"")}/reset-password.html?next=${encodeURIComponent(n||"account")}`;
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
  signUp,signIn,signInWithGoogle,signOut,resetPassword,updateProfile,getOrders,saveOrder,syncKey,applyFieldDirections
};

async function init(){
  enableSmartFieldDirections();ensureStyle();renderButton();
  if(!configured()){initError=new Error("Supabase سەپلىمىسى يوق");readyResolve(api);emit();return}
  try{
    await loadSdk();
    db=window.supabase.createClient(cfg.url,cfg.anonKey||cfg.publishableKey);
    const {data,error}=await db.auth.getSession();
    if(error)throw error;
    await queueSession(data.session,{sync:false});
    db.auth.onAuthStateChange((event,session)=>{
      if(event==="SIGNED_OUT")writeMergeLock("");
      const isLogin=event==="SIGNED_IN";
      setTimeout(()=>queueSession(session,{trackLogin:isLogin,sync:isLogin}),0);
    });
  }catch(err){initError=err;console.warn("Member system failed to initialize",err);renderButton();emit()}
  readyResolve(api);
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
