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
  link.rel="stylesheet";link.href="member.css?v=1";link.dataset.kutadguMemberStyle="1";
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
async function replaceCart(values){
  if(!db||!user||blocked)return;
  const rows=(Array.isArray(values)?values:[])
    .filter(x=>x&&x.id)
    .map(x=>({user_id:user.id,book_id:String(x.id),quantity:Math.max(1,Math.min(99,Number(x.qty)||1))}));
  const {error:delError}=await db.from("member_cart_items").delete().eq("user_id",user.id);
  if(delError)throw delError;
  if(rows.length){
    const {error}=await db.from("member_cart_items").insert(rows);
    if(error)throw error;
  }
}
async function mergeShopState(){
  if(!db||!user||blocked)return;
  try{
    const [{data:favRows,error:favError},{data:cartRows,error:cartError}]=await Promise.all([
      db.from("member_favorites").select("book_id").eq("user_id",user.id),
      db.from("member_cart_items").select("book_id,quantity").eq("user_id",user.id)
    ]);
    if(favError)throw favError;if(cartError)throw cartError;

    const localFav=Array.isArray(safeJson(FAV_KEY,[]))?safeJson(FAV_KEY,[]):[];
    const mergedFav=[...new Set([...localFav,...(favRows||[]).map(x=>x.book_id)].map(String).filter(Boolean))];

    const cartMap=new Map();
    (cartRows||[]).forEach(x=>cartMap.set(String(x.book_id),Math.max(1,Number(x.quantity)||1)));
    const localCart=Array.isArray(safeJson(CART_KEY,[]))?safeJson(CART_KEY,[]):[];
    localCart.forEach(x=>{
      if(!x?.id)return;
      const id=String(x.id),qty=Math.max(1,Number(x.qty)||1);
      cartMap.set(id,Math.max(qty,cartMap.get(id)||0));
    });
    const mergedCart=[...cartMap].map(([id,qty])=>({id,qty}));

    localStorage.setItem(FAV_KEY,JSON.stringify(mergedFav));
    localStorage.setItem(CART_KEY,JSON.stringify(mergedCart));
    await replaceFavorites(mergedFav);
    await replaceCart(mergedCart);
    emit("kutadgu-member-state-synced");
  }catch(err){console.warn("Member shop sync failed",err)}
}
const syncTimers=new Map();
function syncKey(key,value){
  if(!user||blocked||![CART_KEY,FAV_KEY].includes(key))return;
  clearTimeout(syncTimers.get(key));
  syncTimers.set(key,setTimeout(async()=>{
    try{
      if(key===FAV_KEY)await replaceFavorites(value);
      if(key===CART_KEY)await replaceCart(value);
    }catch(err){console.warn("Member state save failed",err)}
    finally{syncTimers.delete(key)}
  },250));
}
async function applySession(session,{trackLogin=false,sync=true}={}){
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
  if(result.data?.session)await queueSession(result.data.session,{trackLogin:true});
  return result.data;
}
async function signIn({email,password}){
  if(!db)throw new Error("ئەزالىق مۇلازىمىتى تېخى تەييار ئەمەس");
  const {data,error}=await db.auth.signInWithPassword({email,password});
  if(error)throw error;
  await queueSession(data.session,{trackLogin:true});
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
  user=null;profile=null;blocked=false;renderButton();emit();
}
async function resetPassword(email,next="account"){
  if(!db)throw new Error("ئەزالىق مۇلازىمىتى تېخى تەييار ئەمەس");
  const base=location.pathname.replace(/[^/]*$/,"");
  const redirectTo=`${location.origin}${base}reset-password.html?next=${encodeURIComponent(next)}`;
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
    await queueSession(data.session,{sync:true});
    db.auth.onAuthStateChange((event,session)=>{
      setTimeout(()=>queueSession(session,{trackLogin:event==="SIGNED_IN",sync:event!=="TOKEN_REFRESHED"}),0);
    });
  }catch(err){initError=err;console.warn("Member system failed to initialize",err);renderButton();emit()}
  readyResolve(api);
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
