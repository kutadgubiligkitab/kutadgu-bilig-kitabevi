(function(){
"use strict";
const C=window.KITAP_CATALOG||[];
const CART_KEY="kutadgu-cart-v1", FAV_KEY="kutadgu-favorites-v1", REC_KEY="kutadgu-recent-v1", CUSTOMER_KEY="kutadgu-customer-v1";
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
function normalizeText(v){
  return String(v||"").toLocaleLowerCase("ug").replace(/\s+/g," ").trim();
}
function uniqueCategories(){
  let seen=new Set(),out=[];
  C.forEach(b=>{let v=(b.category||"").trim();if(v&&!seen.has(v)){seen.add(v);out.push(v)}});
  return out;
}
function pricePass(b,min,max){
  let p=Number(b.price);
  if(Number.isFinite(min)&&(!Number.isFinite(p)||p<min))return false;
  if(Number.isFinite(max)&&(!Number.isFinite(p)||p>max))return false;
  return true;
}
function sortBooks(items,mode){
  let arr=[...items];
  if(mode==="priceLow")arr.sort((a,b)=>(Number(a.price)||999999999)-(Number(b.price)||999999999));
  else if(mode==="priceHigh")arr.sort((a,b)=>(Number(b.price)||0)-(Number(a.price)||0));
  else if(mode==="title")arr.sort((a,b)=>String(a.title||"").localeCompare(String(b.title||""),"ug"));
  else if(mode==="author")arr.sort((a,b)=>String(a.author||"").localeCompare(String(b.author||""),"ug"));
  else arr.sort((a,b)=>C.indexOf(a)-C.indexOf(b));
  return arr;
}
function bindDynamicActions(scope){
  if(!scope)return;
  scope.querySelectorAll("[data-cart-id]").forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();add(b.dataset.cartId)});
  scope.querySelectorAll("[data-fav-id]").forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();toggleFav(b.dataset.favId)});
  scope.querySelectorAll("[data-share-id]").forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();let book=find(b.dataset.shareId);if(book)shareBook(book)});
  renderFavButtons();
}
function searchResultCard(b){
  return `<article class="advanced-search-result">
    <a class="advanced-search-cover" href="${b.href}"><img src="${b.image||''}" alt="${b.title}" loading="lazy" onerror="this.style.visibility='hidden'"></a>
    <div class="advanced-search-info">
      <a class="advanced-search-title" href="${b.href}">${b.title}</a>
      <div class="advanced-search-meta">ئاپتورى: ${b.author||"—"}</div>
      <div class="advanced-search-meta">${b.category||""}</div>
      <div class="advanced-search-price">${money(b.price)}</div>
      <div class="advanced-search-actions">
        <a class="detail-button" href="${b.href}">تەپسىلات</a>
        <button type="button" class="add-to-cart" data-cart-id="${b.id}">🛒 سېۋەتكە</button>
        <button type="button" class="favorite-button" data-fav-id="${b.id}">♡ ياقتۇرۇش</button>
        <button type="button" class="share-button" data-share-id="${b.id}">🔗</button>
      </div>
    </div>
  </article>`;
}
function searchEnhance(){
  let input=document.querySelector("#searchInput"),res=document.querySelector("#searchResults");if(!input||!res)return;
  let btn=document.querySelector("#searchButton");
  let box=input.closest(".search-box")||input.parentElement;
  if(!document.querySelector("#advancedSearchPanel")){
    let panel=document.createElement("div");
    panel.id="advancedSearchPanel";
    panel.className="advanced-search-panel";
    panel.innerHTML=`
      <div class="advanced-search-field">
        <label for="searchCategory">كىتاب تۈرى</label>
        <select id="searchCategory"><option value="">بارلىق تۈرلەر</option>${uniqueCategories().map(x=>`<option value="${x}">${x}</option>`).join("")}</select>
      </div>
      <div class="advanced-search-field">
        <label for="searchMinPrice">ئەڭ تۆۋەن باھا</label>
        <input id="searchMinPrice" type="number" min="0" inputmode="numeric" placeholder="0 ₺">
      </div>
      <div class="advanced-search-field">
        <label for="searchMaxPrice">ئەڭ يۇقىرى باھا</label>
        <input id="searchMaxPrice" type="number" min="0" inputmode="numeric" placeholder="مەسىلەن 500 ₺">
      </div>
      <div class="advanced-search-field">
        <label for="searchSort">تەرتىپلەش</label>
        <select id="searchSort">
          <option value="new">يېڭى قوشۇلغان تەرتىپ</option>
          <option value="title">كىتاب نامى بويىچە</option>
          <option value="author">ئاپتور بويىچە</option>
          <option value="priceLow">باھاسى ئەرزاندىن</option>
          <option value="priceHigh">باھاسى قىممەتتىن</option>
        </select>
      </div>
      <button type="button" class="advanced-search-reset" id="searchReset">↺ تازىلاش</button>`;
    (box||res).insertAdjacentElement("afterend",panel);
  }
  let category=document.querySelector("#searchCategory"),minEl=document.querySelector("#searchMinPrice"),maxEl=document.querySelector("#searchMaxPrice"),sortEl=document.querySelector("#searchSort"),reset=document.querySelector("#searchReset");
  function hasFilter(){return !!(input.value.trim()||category?.value||minEl?.value||maxEl?.value)}
  function run(){
    let q=normalizeText(input.value),cat=category?.value||"";
    let min=minEl?.value!==""?Number(minEl.value):NaN,max=maxEl?.value!==""?Number(maxEl.value):NaN;
    if(!hasFilter()){
      res.innerHTML='<div class="advanced-search-hint">🔎 كىتاب نامى ياكى ئاپتور يېزىڭ، ياكى تۈر/باھا سۈزگۈچىنى تاللاڭ.</div>';
      return;
    }
    let matches=C.filter(b=>{
      let hay=normalizeText([b.title,b.author,b.category,b.publisher,b.language].filter(Boolean).join(" "));
      return (!q||hay.includes(q))&&(!cat||b.category===cat)&&pricePass(b,min,max);
    });
    matches=sortBooks(matches,sortEl?.value||"new");
    res.innerHTML=`<div class="advanced-search-summary"><strong>${matches.length}</strong> دانە كىتاب تېپىلدى</div>`+
      (matches.length?`<div class="advanced-search-results-grid">${matches.map(searchResultCard).join("")}</div>`:'<div class="search-empty">بۇ شەرتكە ماس كىتاب تېپىلمىدى.</div>');
    bindDynamicActions(res);
  }
  if(btn)btn.onclick=run;
  input.addEventListener("input",run);
  [category,minEl,maxEl,sortEl].forEach(el=>el&&el.addEventListener("change",run));
  [minEl,maxEl].forEach(el=>el&&el.addEventListener("input",run));
  if(reset)reset.onclick=()=>{input.value="";if(category)category.value="";if(minEl)minEl.value="";if(maxEl)maxEl.value="";if(sortEl)sortEl.value="new";run()};
  res.innerHTML='<div class="advanced-search-hint">🔎 كىتاب نامى ياكى ئاپتور يېزىڭ، ياكى تۈر/باھا سۈزگۈچىنى تاللاڭ.</div>';
}
function setupCatalogFilters(){
  let file=(location.pathname.split("/").pop()||"").split(/[?#]/)[0]||"index.html";
  let pageBooks=C.filter(b=>b.source===file);
  let grid=document.querySelector(".books-grid");
  if(!grid||!pageBooks.length||document.querySelector("#catalogFilterBar"))return;

  let mapped=[...grid.querySelectorAll(".book-card")].map((card,order)=>({card,id:cardId(card),order})).filter(x=>x.id&&pageBooks.some(b=>b.id===x.id));
  if(!mapped.length)return;

  let bar=document.createElement("div");
  bar.id="catalogFilterBar";
  bar.className="catalog-filter-bar";
  bar.innerHTML=`
    <div class="catalog-filter-search"><label for="catalogFilterText">🔎 بۇ بۆلۈمدىن ئىزدەش</label><input id="catalogFilterText" type="search" placeholder="كىتاب ياكى ئاپتور ئىزدەڭ..."></div>
    <div class="catalog-filter-field"><label for="catalogMinPrice">ئەڭ تۆۋەن باھا</label><input id="catalogMinPrice" type="number" min="0" placeholder="0 ₺"></div>
    <div class="catalog-filter-field"><label for="catalogMaxPrice">ئەڭ يۇقىرى باھا</label><input id="catalogMaxPrice" type="number" min="0" placeholder="500 ₺"></div>
    <div class="catalog-filter-field"><label for="catalogSort">تەرتىپلەش</label><select id="catalogSort"><option value="new">ئەسلى تەرتىپ</option><option value="title">كىتاب نامى</option><option value="author">ئاپتور</option><option value="priceLow">ئەرزاندىن قىممەتكە</option><option value="priceHigh">قىممەتتىن ئەرزانغا</option></select></div>
    <button type="button" class="catalog-filter-reset" id="catalogFilterReset">↺ تازىلاش</button>
    <div class="catalog-filter-count" id="catalogFilterCount"></div>`;
  grid.parentElement.insertBefore(bar,grid);
  let empty=document.createElement("div");empty.className="catalog-filter-empty";empty.hidden=true;empty.textContent="بۇ شەرتكە ماس كىتاب تېپىلمىدى.";grid.insertAdjacentElement("afterend",empty);

  let text=bar.querySelector("#catalogFilterText"),minEl=bar.querySelector("#catalogMinPrice"),maxEl=bar.querySelector("#catalogMaxPrice"),sortEl=bar.querySelector("#catalogSort"),count=bar.querySelector("#catalogFilterCount"),reset=bar.querySelector("#catalogFilterReset");
  function apply(){
    let q=normalizeText(text.value),min=minEl.value!==""?Number(minEl.value):NaN,max=maxEl.value!==""?Number(maxEl.value):NaN;
    let matches=mapped.filter(x=>{let b=find(x.id);if(!b)return false;let hay=normalizeText([b.title,b.author,b.category].join(" "));return (!q||hay.includes(q))&&pricePass(b,min,max)});
    let sorted=sortBooks(matches.map(x=>find(x.id)),sortEl.value);
    let matchIds=new Set(sorted.map(b=>b.id));
    mapped.forEach(x=>x.card.hidden=!matchIds.has(x.id));
    sorted.forEach(b=>{let x=mapped.find(m=>m.id===b.id);if(x)grid.appendChild(x.card)});
    count.textContent=`${matches.length} / ${mapped.length} كىتاب`;
    empty.hidden=matches.length!==0;
  }
  [text,minEl,maxEl].forEach(el=>el.addEventListener("input",apply));
  sortEl.addEventListener("change",apply);
  reset.onclick=()=>{text.value="";minEl.value="";maxEl.value="";sortEl.value="new";apply()};
  apply();
}
function cartPage(){
  let host=document.querySelector("#cartItems");if(!host)return;
  let items=cart().map(x=>({...x,b:find(x.id)})).filter(x=>x.b);
  let totalQty=items.reduce((s,x)=>s+x.qty,0);
  let total=items.reduce((s,x)=>s+(x.b.price||0)*x.qty,0);
  let checkout=document.querySelector("#checkoutCard");

  if(!items.length){
    host.innerHTML=`<div class="empty-state">🛒 سېۋەت ھازىرچە بوش.<br><a href="index.html#books">كىتاب كۆرۈش →</a></div>`;
    if(checkout)checkout.hidden=true;
    updateBadge();
    return;
  }

  if(checkout)checkout.hidden=false;

  host.innerHTML=items.map(x=>`<div class="cart-item">
      <img src="${x.b.image||''}" alt="${x.b.title}" onerror="this.style.visibility='hidden'">
      <div>
        <div class="cart-title">${x.b.title}</div>
        <div class="cart-meta">${x.b.author} · ${x.b.category}</div>
      </div>
      <div class="qty-control">
        <button type="button" aria-label="ئازايتىش" data-minus="${x.b.id}">−</button>
        <span>${x.qty}</span>
        <button type="button" aria-label="كۆپەيتىش" data-plus="${x.b.id}">+</button>
      </div>
      <div class="cart-line-price">${money((x.b.price||0)*x.qty)}</div>
      <button type="button" class="remove-cart" data-remove="${x.b.id}">ئۆچۈرۈش</button>
    </div>`).join("")+
    `<div class="cart-summary">
       <div class="cart-summary-meta">
         <span>📚 جەمئىي كىتاب سانى: ${totalQty}</span>
         <span>💰 ئومۇمىي باھا: ${money(total)}</span>
       </div>
       <div class="cart-total">جەمئىي: ${money(total)}</div>
       <div class="cart-summary-actions">
         <button type="button" class="add-to-cart" id="scrollCheckout">📦 زاكاز ئۇچۇرىنى تولدۇرۇش</button>
         <button type="button" class="clear-cart" id="clearCart">🗑️ سېۋەتنى تازىلاش</button>
       </div>
     </div>`;

  host.querySelectorAll("[data-plus]").forEach(b=>b.onclick=()=>changeQty(b.dataset.plus,1));
  host.querySelectorAll("[data-minus]").forEach(b=>b.onclick=()=>changeQty(b.dataset.minus,-1));
  host.querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>{remove(b.dataset.remove);cartPage()});

  let clear=document.querySelector("#clearCart");
  if(clear)clear.onclick=()=>{
    if(confirm("سېۋەتتىكى بارلىق كىتابلارنى ئۆچۈرەمسىز؟")){
      set(CART_KEY,[]);
      cartPage();
      toast("سېۋەت تازىلاندى");
    }
  };

  let scroll=document.querySelector("#scrollCheckout");
  if(scroll)scroll.onclick=()=>document.querySelector("#checkoutCard")?.scrollIntoView({behavior:"smooth",block:"start"});

  setupCheckout();
  updateBadge();
}

function changeQty(id,d){
  let a=cart(),x=a.find(i=>i.id===id);if(!x)return;
  x.qty=Math.max(1,x.qty+d);
  set(CART_KEY,a);
  cartPage();
  updateBadge();
}

function customerData(){
  let d=get(CUSTOMER_KEY,{});
  return d&&typeof d==="object"&&!Array.isArray(d)?d:{};
}

function saveCustomerData(){
  let data={
    name:document.querySelector("#customerName")?.value.trim()||"",
    phone:document.querySelector("#customerPhone")?.value.trim()||"",
    city:document.querySelector("#customerCity")?.value.trim()||"",
    address:document.querySelector("#customerAddress")?.value.trim()||"",
    delivery:document.querySelector("#deliveryMethod")?.value||"",
    note:document.querySelector("#customerNote")?.value.trim()||""
  };
  set(CUSTOMER_KEY,data);
  return data;
}

function loadCustomerData(){
  let d=customerData();
  let map={
    customerName:d.name,
    customerPhone:d.phone,
    customerCity:d.city,
    customerAddress:d.address,
    deliveryMethod:d.delivery,
    customerNote:d.note
  };
  Object.entries(map).forEach(([id,val])=>{
    let el=document.querySelector("#"+id);
    if(el&&val)el.value=val;
  });
}

function makeOrderId(){
  let now=new Date();
  let y=String(now.getFullYear()).slice(-2);
  let m=String(now.getMonth()+1).padStart(2,"0");
  let d=String(now.getDate()).padStart(2,"0");
  let r=Math.floor(1000+Math.random()*9000);
  return `KB-${y}${m}${d}-${r}`;
}

function buildOrderText(requireCustomer=true){
  let items=cart().map(x=>({...x,b:find(x.id)})).filter(x=>x.b);
  if(!items.length){toast("سېۋەت بوش");return null}

  let form=document.querySelector("#checkoutForm");
  if(requireCustomer&&form&&!form.reportValidity())return null;

  let c=saveCustomerData();
  let total=items.reduce((s,x)=>s+(x.b.price||0)*x.qty,0);
  let totalQty=items.reduce((s,x)=>s+x.qty,0);
  let orderId=makeOrderId();

  let lines=[
    "قۇتادغۇبىلىك كىتابخانىسى — زاكاز",
    `زاكاز نومۇرى: ${orderId}`,
    ""
  ];

  items.forEach((x,i)=>{
    lines.push(`${i+1}. ${x.b.title}`);
    lines.push(`   ${x.b.author} · ${x.qty} دانە · ${money((x.b.price||0)*x.qty)}`);
  });

  lines.push(
    "",
    `جەمئىي كىتاب سانى: ${totalQty}`,
    `ئومۇمىي باھا: ${money(total)}`,
    "",
    "خېرىدار ئۇچۇرى:",
    `ئىسمى: ${c.name||"-"}`,
    `تېلېفون: ${c.phone||"-"}`,
    `شەھەر / رايون: ${c.city||"-"}`,
    `ئادرېس: ${c.address||"-"}`,
    `يەتكۈزۈش: ${c.delivery||"-"}`,
    `ئىزاھات: ${c.note||"-"}`
  );

  return {text:lines.join("\n"),orderId,total,totalQty};
}

function showOrderPreview(){
  let o=buildOrderText(true);if(!o)return null;
  let wrap=document.querySelector("#orderPreviewWrap");
  let pre=document.querySelector("#orderPreview");
  if(wrap&&pre){
    pre.textContent=o.text;
    wrap.hidden=false;
    wrap.scrollIntoView({behavior:"smooth",block:"nearest"});
  }
  toast("زاكاز ئۇچۇرى تەييار بولدى ✅");
  return o;
}

async function copyOrder(){
  let o=buildOrderText(true);if(!o)return;
  try{
    if(navigator.clipboard)await navigator.clipboard.writeText(o.text);
    else throw new Error();
    toast("زاكاز ئۇچۇرى كۆچۈرۈلدى 📋");
  }catch(e){
    let ta=document.createElement("textarea");
    ta.value=o.text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast("زاكاز ئۇچۇرى كۆچۈرۈلدى 📋");
  }
}

async function shareOrder(){
  let o=buildOrderText(true);if(!o)return;
  try{
    if(navigator.share){
      await navigator.share({title:"قۇتادغۇبىلىك كىتابخانىسى — زاكاز",text:o.text});
      toast("زاكاز ھەمبەھىرلەندى 📤");
    }else{
      await copyOrder();
      toast("ھەمبەھىرلەش يوق؛ زاكاز كۆچۈرۈلدى 📋");
    }
  }catch(e){}
}

function setupCheckout(){
  let form=document.querySelector("#checkoutForm");if(!form||form.dataset.ready==="1")return;
  form.dataset.ready="1";
  loadCustomerData();

  form.querySelectorAll("input,textarea,select").forEach(el=>{
    el.addEventListener("change",saveCustomerData);
    el.addEventListener("blur",saveCustomerData);
  });

  let prepare=document.querySelector("#prepareOrder");
  let copy=document.querySelector("#copyOrder");
  let share=document.querySelector("#shareOrder");

  if(prepare)prepare.onclick=showOrderPreview;
  if(copy)copy.onclick=copyOrder;
  if(share)share.onclick=shareOrder;
}

function init(){injectFloat();decorateCards();decorateDetail();searchEnhance();setupCatalogFilters();renderHomeSections();cartPage();setupCheckout()}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
window.kutadguShop={add,remove,toggleFav,cart,shareBook,buildOrderText,copyOrder,shareOrder};
})();
