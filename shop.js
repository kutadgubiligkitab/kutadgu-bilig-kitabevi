(function(){
"use strict";
const C=window.KITAP_CATALOG||[];
const CART_KEY="kutadgu-cart-v1", FAV_KEY="kutadgu-favorites-v1", REC_KEY="kutadgu-recent-v1";
const get=(k,d=[])=>{try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}};
const set=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const find=id=>C.find(x=>x.id===id);
function money(n){return n!=null&&n!==""?`${Number(n).toLocaleString("tr-TR")} ₺`:"باھا تېخى بېكىتىلمىگەن"}
function cart(){return get(CART_KEY,[])}
function updateBadge(){let n=cart().reduce((s,x)=>s+(x.qty||1),0);document.querySelectorAll(".cart-count").forEach(e=>e.textContent=n)}
function add(id,qty=1){let b=find(id);if(!b)return;let a=cart(),x=a.find(i=>i.id===id);if(x)x.qty+=qty;else a.push({id,qty});set(CART_KEY,a);updateBadge();toast("كىتاب سېۋەتكە قوشۇلدى 🛒")}
function remove(id){set(CART_KEY,cart().filter(x=>x.id!==id));updateBadge()}
function favs(){return get(FAV_KEY,[])}
function toggleFav(id){if(!find(id))return;let a=favs();if(a.includes(id)){a=a.filter(x=>x!==id);toast("ياقتۇرۇلغانلاردىن چىقىرىلدى")}else{a.push(id);toast("ياقتۇرغانلارغا قوشۇلدى ❤️")}set(FAV_KEY,a);renderFavButtons()}
function recent(id){if(!find(id))return;let a=get(REC_KEY,[]).filter(x=>x!==id);a.unshift(id);set(REC_KEY,a.slice(0,12))}
function toast(msg){let t=document.querySelector(".shop-toast");if(!t){t=document.createElement("div");t.className="shop-toast";t.style.cssText="position:fixed;right:18px;bottom:18px;z-index:10000;background:#4b3327;color:#fff;padding:12px 18px;border-radius:9px;box-shadow:0 8px 25px rgba(0,0,0,.2);font-family:inherit;transition:opacity .2s";document.body.appendChild(t)}t.textContent=msg;t.style.opacity="1";clearTimeout(t._tm);t._tm=setTimeout(()=>t.style.opacity="0",1800)}
function injectFloat(){if(document.querySelector(".shop-floating"))return;let d=document.createElement("div");d.className="shop-floating";d.innerHTML=`<button class="shop-float-btn" onclick="location.href='cart.html'">🛒 سېۋەت <span class="cart-count">0</span></button><button class="shop-float-btn" onclick="location.href='favorites.html'">❤️ ياقتۇرغانلىرىم</button>`;document.body.appendChild(d);updateBadge()}
function cardId(card){
  const hrefs=[...card.querySelectorAll("a.book-image,a.book-cover,.detail-button,.book-button")].map(a=>a.getAttribute("href")).filter(Boolean);
  for(const href of hrefs){const b=C.find(x=>x.href===href);if(b)return b.id}
  const title=card.querySelector(".book-title")?.textContent.trim();
  if(title){const b=C.find(x=>x.title===title);if(b)return b.id}
  return null;
}
function decorateCards(){
  document.querySelectorAll(".book-card").forEach(card=>{
    let id=cardId(card); if(!id||card.querySelector(".book-actions"))return;
    let info=card.querySelector(".book-info")||card;
    let detail=info.querySelector(".detail-button");
    let wrap=document.createElement("div");
    wrap.className="book-actions";
    wrap.innerHTML=`${detail?detail.outerHTML:""}<button type="button" class="add-to-cart" data-cart-id="${id}">🛒 سېۋەتكە سېلىش</button><button type="button" class="favorite-button" data-fav-id="${id}">♡ ياقتۇرۇش</button><button type="button" class="share-button" data-share-id="${id}">🔗 ھەمبەھىرلەش</button>`;
    if(detail) detail.remove();
    info.appendChild(wrap);
  });
  document.querySelectorAll("[data-cart-id]").forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();add(b.dataset.cartId)});
  document.querySelectorAll("[data-fav-id]").forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();toggleFav(b.dataset.favId)});
  document.querySelectorAll("[data-share-id]").forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();let book=find(b.dataset.shareId);if(book)shareBook(book)});
  renderFavButtons();
}
function renderFavButtons(){let a=favs();document.querySelectorAll("[data-fav-id]").forEach(b=>{let yes=a.includes(b.dataset.favId);b.classList.toggle("is-favorite",yes);if(b.classList.contains("mini-heart"))b.textContent=yes?"♥":"♡";else if(b.textContent.includes("ياقتۇرۇش")||b.textContent.includes("♡")||b.textContent.includes("♥"))b.textContent=yes?"♥ ياقتۇرۇلدى":"♡ ياقتۇرۇش"})}
function getDetailBook(){
  let id=document.body.dataset.bookId;
  let b=find(id); if(b)return b;
  let file=(location.pathname.split("/").pop()||"").split("?")[0];
  b=C.find(x=>x.href===file); if(b)return b;
  let title=document.querySelector(".book-detail-info h1")?.textContent.trim();
  return title?C.find(x=>x.title===title):null;
}
function decorateDetail(){
  let b=getDetailBook(); if(!b)return;
  recent(b.id);
  let box=document.querySelector(".book-detail-info");
  if(!box)return;
  let old=box.querySelector(".detail-actions");
  if(old)old.remove();
  let d=document.createElement("div");d.className="detail-actions";
  d.innerHTML=`<div class="detail-price">${money(b.price)}</div><button type="button" class="add-to-cart detail-cart" data-cart-id="${b.id}">🛒 سېۋەتكە سېلىش</button><button type="button" class="favorite-button" data-fav-id="${b.id}">♡ ياقتۇرۇش</button><button type="button" class="share-button" data-share-id="${b.id}">🔗 ھەمبەھىرلەش</button>`;
  box.appendChild(d);
  d.querySelector("[data-cart-id]").onclick=()=>add(b.id);
  d.querySelector("[data-fav-id]").onclick=()=>toggleFav(b.id);
  d.querySelector("[data-share-id]").onclick=()=>shareBook(b);
  renderFavButtons();
}
async function shareBook(b){
  let url=new URL(b.href,location.href).href;
  try{
    if(navigator.share){await navigator.share({title:b.title,text:`${b.title} — ${b.author}`,url});toast("ھەمبەھىرلەش تەييار")}
    else if(navigator.clipboard){await navigator.clipboard.writeText(url);toast("كىتاب ئۇلىنىشى كۆچۈرۈلدى 🔗")}
    else{let ta=document.createElement("textarea");ta.value=url;document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();toast("كىتاب ئۇلىنىشى كۆچۈرۈلدى 🔗")}
  }catch(e){}
}
function miniCard(b){return `<article class="shop-mini-card"><button type="button" class="mini-heart" data-fav-id="${b.id}">♡</button><a href="${b.href}"><img src="${b.image||''}" alt="${b.title}" loading="lazy" onerror="this.style.visibility='hidden'"><div class="shop-mini-title">${b.title}</div><div class="shop-mini-meta">${b.author}</div><div class="shop-mini-price">${money(b.price)}</div></a><div class="mini-actions"><button type="button" class="add-to-cart" data-cart-id="${b.id}">🛒 سېۋەتكە سېلىش</button><button type="button" class="share-button" data-share-id="${b.id}">🔗</button></div></article>`}
function renderHomeSections(){
  let host=document.querySelector("#homeShopSections");if(!host)return;
  let rec=get(REC_KEY,[]).map(find).filter(Boolean).slice(0,6);
  let fav=favs().map(find).filter(Boolean).slice(0,6);
  let newest=C.slice(0,8);
  let recommended=C.slice(0,6);
  let data={newest:["🆕 يېڭى قوشۇلغان كىتابلار",newest],recommended:["⭐ تەۋسىيە قىلىنغان كىتابلار",recommended],recent:["🕘 يېقىندا كۆرۈلگەن كىتابلار",rec],favorites:["❤️ ياقتۇرغان كىتابلار",fav]};
  host.innerHTML=`<div class="shop-selector"><button type="button" class="shop-selector-button" id="shopSelectorButton">📚 كىتابلارنى تاللاش <span>⌄</span></button><div class="shop-selector-menu" id="shopSelectorMenu"><button type="button" data-shop-tab="newest">🆕 يېڭى قوشۇلغان كىتابلار</button><button type="button" data-shop-tab="recommended">⭐ تەۋسىيە قىلىنغان كىتابلار</button><button type="button" data-shop-tab="recent">🕘 يېقىندا كۆرۈلگەن كىتابلار</button><button type="button" data-shop-tab="favorites">❤️ ياقتۇرغان كىتابلار</button></div></div><div id="shopSelectedContent" class="shop-selected-content"></div>`;
  const btn=host.querySelector("#shopSelectorButton"),menu=host.querySelector("#shopSelectorMenu"),content=host.querySelector("#shopSelectedContent");
  function show(key){let [title,arr]=data[key];content.innerHTML=`<section class="shop-section shop-section-selected"><h2>${title}</h2>${arr.length?`<div class="shop-grid">${arr.map(miniCard).join("")}</div>`:`<div class="empty-state shop-section-empty">${key==='favorites'?"❤️ ھازىرچە ياقتۇرغان كىتاب يوق.":key==='recent'?"🕘 ھازىرچە يېقىندا كۆرۈلگەن كىتاب يوق.":"كىتابلار تېخى قوشۇلمىغان."}</div>`}</section>`;content.querySelectorAll("[data-cart-id]").forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();add(b.dataset.cartId)});content.querySelectorAll("[data-fav-id]").forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();toggleFav(b.dataset.favId)});content.querySelectorAll("[data-share-id]").forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();let book=find(b.dataset.shareId);if(book)shareBook(book)});renderFavButtons()}
  btn.onclick=()=>menu.classList.toggle("is-open");
  menu.querySelectorAll("[data-shop-tab]").forEach(b=>b.onclick=()=>{show(b.dataset.shopTab);menu.classList.remove("is-open");btn.querySelector("span").textContent="⌄"});
  document.addEventListener("click",e=>{if(!host.contains(e.target))menu.classList.remove("is-open")});
  content.innerHTML=`<div class="shop-select-hint">📚 ئۈستىدىكى «كىتابلارنى تاللاش» كۇنۇپكىسىنى بېسىپ، كۆرۈشنى خالايدىغان تۈرنى تاللاڭ.</div>`;
}
function searchEnhance(){
  let input=document.querySelector("#searchInput"),res=document.querySelector("#searchResults");if(!input||!res)return;
  let btn=document.querySelector("#searchButton");
  if(btn)btn.onclick=run;
  input.addEventListener("input",()=>{if(!input.value.trim())res.innerHTML="";else run()});
  function run(){let q=input.value.trim().toLocaleLowerCase("ug");let matches=C.filter(b=>[b.title,b.author,b.category].join(" ").toLocaleLowerCase("ug").includes(q));let sort=document.querySelector("#searchSort")?.value||"new";if(sort==="priceLow")matches.sort((a,b)=>(a.price||999999)-(b.price||999999));if(sort==="priceHigh")matches.sort((a,b)=>(b.price||0)-(a.price||0));if(sort==="title")matches.sort((a,b)=>a.title.localeCompare(b.title,"ug"));res.innerHTML=matches.length?`<div class="search-tools"><span>${matches.length} نەتىجە</span><select id="searchSort"><option value="new">تەرتىپى</option><option value="title">ئىسىم بويىچە</option><option value="priceLow">ئەرزانىدىن</option><option value="priceHigh">قىممىتىدىن</option></select></div>`+matches.map(b=>`<a class="search-result" href="${b.href}"><img class="search-result-image" src="${b.image}" alt="${b.title}" onerror="this.style.display='none'"><div class="search-result-content"><div class="search-result-title">${b.title}</div><div class="search-result-author">ئاپتورى: ${b.author}</div><div class="search-result-category">${b.category}</div><div class="search-result-category">${money(b.price)}</div></div></a>`).join(""):"<div class='search-empty'>بۇ ئىزدەش بويىچە كىتاب تېپىلمىدى.</div>";let s=document.querySelector("#searchSort");if(s)s.onchange=run}
}
function cartPage(){let host=document.querySelector("#cartItems");if(!host)return;let items=cart().map(x=>({...x,b:find(x.id)})).filter(x=>x.b);let total=items.reduce((s,x)=>s+(x.b.price||0)*x.qty,0);host.innerHTML=items.length?items.map(x=>`<div class="cart-item"><img src="${x.b.image}" alt="${x.b.title}" onerror="this.style.visibility='hidden'"><div><div class="cart-title">${x.b.title}</div><div class="cart-meta">${x.b.author} · ${x.b.category}</div></div><div class="qty-control"><button type="button" data-minus="${x.b.id}">−</button><span>${x.qty}</span><button type="button" data-plus="${x.b.id}">+</button></div><div class="cart-line-price">${money((x.b.price||0)*x.qty)}</div><button type="button" class="remove-cart" data-remove="${x.b.id}">ئۆچۈرۈش</button></div>`).join("")+`<div class="cart-summary"><div class="cart-total">جەمئىي: ${money(total)}</div><button type="button" class="add-to-cart" id="copyOrder">📋 زاكاز ئۇچۇرىنى كۆچۈرۈش</button></div>`:`<div class="empty-state">🛒 سېۋەت ھازىرچە بوش.<br><a href="index.html#books">كىتاب كۆرۈش →</a></div>`;host.querySelectorAll("[data-plus]").forEach(b=>b.onclick=()=>changeQty(b.dataset.plus,1));host.querySelectorAll("[data-minus]").forEach(b=>b.onclick=()=>changeQty(b.dataset.minus,-1));host.querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>{remove(b.dataset.remove);cartPage()});let order=document.querySelector("#copyOrder");if(order)order.onclick=copyOrder}
function changeQty(id,d){let a=cart(),x=a.find(i=>i.id===id);if(!x)return;x.qty=Math.max(1,x.qty+d);set(CART_KEY,a);cartPage();updateBadge()}
async function copyOrder(){let items=cart().map(x=>({...x,b:find(x.id)})).filter(x=>x.b);let lines=["قۇتادغۇبىلىك كىتابخانىسى — سېۋەت زاكازى",""];items.forEach(x=>lines.push(`${x.b.title} × ${x.qty} — ${money((x.b.price||0)*x.qty)}`));let total=items.reduce((s,x)=>s+(x.b.price||0)*x.qty,0);lines.push("",`جەمئىي: ${money(total)}`);try{if(navigator.clipboard)await navigator.clipboard.writeText(lines.join("\n"));else throw new Error();toast("زاكاز ئۇچۇرى كۆچۈرۈلدى 📋")}catch(e){alert(lines.join("\n"))}}
function init(){injectFloat();decorateCards();decorateDetail();searchEnhance();renderHomeSections();cartPage()}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
window.kutadguShop={add,remove,toggleFav,cart,shareBook};
})();
