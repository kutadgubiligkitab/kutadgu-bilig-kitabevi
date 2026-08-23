(function(){
"use strict";
const STATIC_CATALOG=[...(window.KITAP_CATALOG||[])];
let C=[...STATIC_CATALOG];
const CART_KEY="kutadgu-cart-v1", FAV_KEY="kutadgu-favorites-v1", REC_KEY="kutadgu-recent-v1", CUSTOMER_KEY="kutadgu-customer-v1";
const FALLBACK_COVER="sample-book-cover.png";
const COVER_LAYOUT_TEST_MODE=window.KUTADGU_COVER_LAYOUT_TEST_MODE===true;
const coverSrc=book=>COVER_LAYOUT_TEST_MODE?FALLBACK_COVER:(book?.image||FALLBACK_COVER);
const get=(k,d=[])=>{try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}};
const set=(k,v)=>{
  localStorage.setItem(k,JSON.stringify(v));
  window.KutadguMember?.syncKey?.(k,v);
};
const find=id=>C.find(x=>x.id===id);

function supabasePublicConfig(){
  const c=window.KUTADGU_SUPABASE_CONFIG||{};
  return {
    url:String(c.url||"").replace(/\/+$/,""),
    key:String(c.anonKey||c.publishableKey||"")
  };
}

function normalizeRemoteBook(r){
  const price=(r.price===null||r.price===undefined||r.price==="")?null:Number(r.price);
  return {
    id:String(r.id||"").trim(),
    title:r.title||"",
    author:r.author||"—",
    price:Number.isFinite(price)?price:null,
    priceText:Number.isFinite(price)?money(price):"باھا تېخى بېكىتىلمىگەن",
    category:r.category||"",
    source:r.source||"universal.html",
    image:r.image_url||r.image||"",
    href:r.href||`book.html?id=${encodeURIComponent(r.id||"")}`,
    pages:r.pages??null,
    translator:r.translator||"",
    language:r.language||"",
    publishDate:r.publish_date||"",
    publisher:r.publisher||"",
    description:r.description||"",
    stock:r.stock??null,
    isNew:r.is_new!==false,
    isRecommended:r.is_recommended===true,
    isBestSeller:r.is_bestseller===true,
    salesCount:Number(r.sales_count??r.sold_count??0)||0,
    isActive:r.is_active!==false,
    createdAt:r.created_at||"",
    updatedAt:r.updated_at||"",
    isRemote:true
  };
}

async function loadRemoteCatalog(){
  const cfg=supabasePublicConfig();
  if(!cfg.url||!cfg.key)return;
  try{
    const response=await fetch(`${cfg.url}/rest/v1/books?select=*&order=created_at.desc`,{
      headers:{
        "apikey":cfg.key,
        "Authorization":`Bearer ${cfg.key}`
      }
    });
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const rows=await response.json();
    if(!Array.isArray(rows))return;

    const remote=rows.map(normalizeRemoteBook).filter(b=>b.id);
    const remoteIds=new Set(remote.map(b=>b.id));
    const merged=[
      ...remote,
      ...STATIC_CATALOG.filter(b=>!remoteIds.has(b.id)).map(b=>({...b,isActive:true}))
    ];
    C=merged.filter(b=>b.isActive!==false);
    window.KUTADGU_LIVE_CATALOG=C;
  }catch(err){
    console.warn("Remote catalog load failed; static catalog is being used.",err);
    C=[...STATIC_CATALOG];
  }
}

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
  const explicit=card.querySelector("[data-cart-id],[data-fav-id],[data-share-id]")?.dataset.cartId||card.querySelector("[data-fav-id]")?.dataset.favId||card.querySelector("[data-share-id]")?.dataset.shareId;
  if(explicit&&find(explicit))return explicit;
  const hrefs=[...card.querySelectorAll("a.book-image,a.book-cover,.detail-button,.book-button")].map(a=>a.getAttribute("href")).filter(Boolean);
  for(const href of hrefs){const b=C.find(x=>x.href===href);if(b)return b.id}
  const title=card.querySelector(".book-title")?.textContent.trim();
  if(title){const b=C.find(x=>x.title===title);if(b)return b.id}
  return null;
}
function syncStaticCards(){
  document.querySelectorAll(".book-card").forEach(card=>{
    const id=cardId(card),book=id&&find(id);if(!book)return;
    const cover=card.querySelector("a.book-image,a.book-cover");
    const img=cover?.querySelector("img");
    if(cover&&book.href)cover.href=book.href;
    if(img){img.src=coverSrc(book);img.alt=`${book.title||"كىتاب"} كىتاب مۇقاۋىسى`;}
    const detail=card.querySelector(".detail-button,.book-button");if(detail&&book.href)detail.href=book.href;
    const title=card.querySelector(".book-title");if(title)title.textContent=book.title||"كىتاب";
    const author=card.querySelector(".book-author");if(author)author.textContent=`ئاپتورى: ${book.author||"—"}`;
    const price=card.querySelector(".book-price,.price");if(price)price.textContent=money(book.price);
  });
}
function applyStaticCoverFallbacks(scope=document){
  scope.querySelectorAll(".book-card .book-cover, .book-card .book-image").forEach(cover=>{
    let img=cover.matches("img")?cover:cover.querySelector("img");
    if(!img){
      img=document.createElement("img");
      const title=cover.closest(".book-card")?.querySelector(".book-title")?.textContent.trim()||"كىتاب";
      img.alt=`${title} كىتاب مۇقاۋىسى`;
      img.loading="lazy";
      cover.querySelectorAll(".dynamic-cover-placeholder,.cover-placeholder").forEach(el=>el.remove());
      cover.prepend(img);
    }
    img.onerror=function(){
      this.onerror=null;
      this.hidden=false;
      this.style.visibility="visible";
      this.src=FALLBACK_COVER;
    };
    const src=(img.getAttribute("src")||"").trim();
    if(COVER_LAYOUT_TEST_MODE||!src||src==="#")img.src=coverSrc(null);
  });
}
function applyDetailCoverFallback(){
  const box=document.querySelector(".book-cover-box");
  if(!box)return;
  let img=box.querySelector("img");
  if(!img){
    img=document.createElement("img");
    box.prepend(img);
  }
  const book=getDetailBook();
  const current=(img.getAttribute("src")||"").trim();
  img.alt=img.alt||`${book?.title||"كىتاب"} كىتاب مۇقاۋىسى`;
  img.hidden=false;
  img.style.visibility="visible";
  box.classList.remove("no-cover");
  img.onerror=function(){
    this.onerror=null;
    this.hidden=false;
    this.style.visibility="visible";
    this.src=FALLBACK_COVER;
  };
  if(COVER_LAYOUT_TEST_MODE||!current||current==="#")img.src=coverSrc(book);
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
function renderFavButtons(){let a=favs();document.querySelectorAll("[data-fav-id]").forEach(b=>{let yes=a.includes(b.dataset.favId);b.classList.toggle("is-favorite",yes);if(b.classList.contains("mini-heart")||b.classList.contains("home-feature-heart")){b.textContent=yes?"♥":"♡";b.setAttribute("aria-pressed",yes?"true":"false");b.setAttribute("aria-label",yes?"ياقتۇرۇلدى":"ياقتۇرۇش");}else if(b.textContent.includes("ياقتۇرۇش")||b.textContent.includes("♡")||b.textContent.includes("♥"))b.textContent=yes?"♥ ياقتۇرۇلدى":"♡ ياقتۇرۇش"})}
function getDetailBook(){
  let id=document.body.dataset.bookId;
  let b=find(id); if(b)return b;
  let queryId=new URLSearchParams(location.search).get("id");
  if(queryId){b=find(queryId);if(b)return b}
  let file=(location.pathname.split("/").pop()||"").split("?")[0];
  b=C.find(x=>x.href===file); if(b)return b;
  let title=document.querySelector(".book-detail-info h1")?.textContent.trim();
  return title?C.find(x=>x.title===title):null;
}

function setDynamicMeta(label,value){
  if(value===null||value===undefined||String(value).trim()==="")return "";
  return `<div class="book-meta-row"><div class="book-meta-label">${label}</div><div class="book-meta-value">${value}</div></div>`;
}

function populateDynamicBookPage(b){
  const dynamic=document.body.hasAttribute("data-dynamic-book");
  if(!dynamic&&!b.isRemote)return;
  document.body.dataset.bookId=b.id;
  document.title=`${b.title} - قۇتادغۇبىلىك كىتابخانىسى`;

  const img=document.querySelector(".book-cover-box img");
  if(img){
    img.src=coverSrc(b);
    img.alt=`${b.title} كىتاب مۇقاۋىسى`;
    img.hidden=false;
    img.parentElement.classList.remove("no-cover");
    img.onerror=()=>{img.onerror=null;img.src=FALLBACK_COVER};
  }

  const info=document.querySelector(".book-detail-info");
  if(!info)return;
  const h1=info.querySelector("h1");
  if(h1)h1.textContent=b.title;
  const author=info.querySelector(".book-author");
  if(author)author.textContent=`ئاپتورى: ${b.author||"—"}`;

  const meta=info.querySelector(".book-meta");
  if(meta&&(dynamic||b.isRemote)){
    meta.innerHTML=[
      setDynamicMeta("ئاپتورى",b.author),
      setDynamicMeta("كىتاب تۈرى",b.category),
      setDynamicMeta("بەت سانى",b.pages),
      setDynamicMeta("تەرجىمانى",b.translator),
      setDynamicMeta("تىلى",b.language),
      setDynamicMeta("نەشر ۋاقتى",b.publishDate),
      setDynamicMeta("نەشرىيات",b.publisher),
      setDynamicMeta("ئامبار",Number.isFinite(Number(b.stock))?`${b.stock} دانە`:"")
    ].join("");
  }

  let desc=document.querySelector(".dynamic-book-description");
  if(desc){
    if(b.description){
      desc.hidden=false;
      desc.querySelector("p").textContent=b.description;
    }else desc.hidden=true;
  }
}

function detailRecommendations(book,limit=4){
  let same=C.filter(x=>x.id!==book.id && x.category===book.category);
  let other=C.filter(x=>x.id!==book.id && x.category!==book.category);
  return [...same,...other].slice(0,limit);
}

function setupCoverZoom(){
  let img=document.querySelector(".book-cover-box img");
  if(!img||img.style.display==="none")return;
  img.classList.add("detail-cover-zoomable");
  img.setAttribute("title","مۇقاۋىنى چوڭ كۆرۈش");
  img.onclick=()=>{
    let overlay=document.createElement("div");
    overlay.className="cover-zoom-overlay";
    overlay.setAttribute("role","dialog");
    overlay.setAttribute("aria-label","كىتاب مۇقاۋىسىنى چوڭ كۆرۈش");
    overlay.innerHTML=`<button type="button" class="cover-zoom-close" aria-label="تاقاش">✕</button><img src="${img.src}" alt="${img.alt||""}">`;
    document.body.appendChild(overlay);
    let close=()=>overlay.remove();
    overlay.querySelector(".cover-zoom-close").onclick=close;
    overlay.onclick=e=>{if(e.target===overlay)close()};
    document.addEventListener("keydown",function esc(e){if(e.key==="Escape"){close();document.removeEventListener("keydown",esc)}});
  };
}

function renderDetailExtras(book){
  let main=document.querySelector(".book-detail-page");
  if(!main||main.querySelector(".detail-extra-sections"))return;

  let related=detailRecommendations(book,4);
  let recentBooks=get(REC_KEY,[])
    .filter(id=>id!==book.id)
    .map(find)
    .filter(Boolean)
    .slice(0,4);

  let wrap=document.createElement("div");
  wrap.className="detail-extra-sections";

  let relatedHtml=related.length
    ? `<section class="detail-extra-section">
         <div class="detail-section-heading">
           <div>
             <span class="detail-section-kicker">📚 يەنە كۆرۈپ بېقىڭ</span>
             <h2>مۇناسىۋەتلىك كىتابلار</h2>
           </div>
           <a href="${book.source||'index.html#books'}" class="detail-section-link">بۇ بۆلۈمدىكى كىتابلار →</a>
         </div>
         <div class="shop-grid detail-related-grid">${related.map(miniCard).join("")}</div>
       </section>`
    : "";

  let recentHtml=recentBooks.length
    ? `<section class="detail-extra-section">
         <div class="detail-section-heading">
           <div>
             <span class="detail-section-kicker">🕘 قايتا تېپىش ئاسان</span>
             <h2>يېقىندا كۆرگەنلىرىڭىز</h2>
           </div>
         </div>
         <div class="shop-grid detail-related-grid">${recentBooks.map(miniCard).join("")}</div>
       </section>`
    : "";

  wrap.innerHTML=relatedHtml+recentHtml;
  if(wrap.innerHTML.trim()){
    main.appendChild(wrap);
    bindDynamicActions(wrap);
  }
}

function decorateDetail(){
  let b=getDetailBook(); if(!b)return;
  populateDynamicBookPage(b);
  recent(b.id);

  let box=document.querySelector(".book-detail-info");
  if(!box)return;
  box.classList.add("detail-info-upgraded");

  let title=box.querySelector("h1");
  if(title&&!box.querySelector(".detail-category-badge")){
    let badge=document.createElement("div");
    badge.className="detail-category-badge";
    badge.textContent=b.category||"كىتاب";
    title.before(badge);
  }

  let old=box.querySelector(".detail-actions");
  if(old)old.remove();

  let panel=document.createElement("div");
  panel.className="detail-purchase-panel";
  panel.innerHTML=`
    <div class="detail-price-line">
      <div>
        <span class="detail-price-label">كىتاب باھاسى</span>
        <div class="detail-price">${money(b.price)}</div>
      </div>
      <div class="detail-quantity-wrap">
        <span class="detail-quantity-label">سانى</span>
        <div class="detail-quantity-control">
          <button type="button" class="detail-qty-minus" aria-label="سانىنى ئازايتىش">−</button>
          <span class="detail-qty-value">1</span>
          <button type="button" class="detail-qty-plus" aria-label="سانىنى كۆپەيتىش">+</button>
        </div>
      </div>
    </div>

    <button type="button" class="add-to-cart detail-cart detail-main-cart">🛒 سېۋەتكە قوشۇش</button>

    <div class="detail-secondary-actions">
      <button type="button" class="favorite-button" data-fav-id="${b.id}">♡ ياقتۇرۇش</button>
      <button type="button" class="share-button" data-share-id="${b.id}">🔗 ھەمبەھىرلەش</button>
    </div>

    <div class="detail-order-tip">📦 سېۋەتكە قوشقاندىن كېيىن زاكاز ئۇچۇرلىرىنى تولدۇرالايسىز.</div>
  `;
  box.appendChild(panel);

  let qty=1;
  const qtyText=panel.querySelector(".detail-qty-value");
  panel.querySelector(".detail-qty-minus").onclick=()=>{
    qty=Math.max(1,qty-1);
    qtyText.textContent=qty;
  };
  panel.querySelector(".detail-qty-plus").onclick=()=>{
    qty=Math.min(99,qty+1);
    qtyText.textContent=qty;
  };
  panel.querySelector(".detail-main-cart").onclick=()=>add(b.id,qty);
  panel.querySelector("[data-fav-id]").onclick=()=>toggleFav(b.id);
  panel.querySelector("[data-share-id]").onclick=()=>shareBook(b);

  renderFavButtons();
  setupCoverZoom();
  renderDetailExtras(b);
}

async function shareBook(b){
  let url=new URL(b.href,location.href).href;
  try{
    if(navigator.share){await navigator.share({title:b.title,text:`${b.title} — ${b.author}`,url});toast("ھەمبەھىرلەش تەييار")}
    else if(navigator.clipboard){await navigator.clipboard.writeText(url);toast("كىتاب ئۇلىنىشى كۆچۈرۈلدى 🔗")}
    else{let ta=document.createElement("textarea");ta.value=url;document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();toast("كىتاب ئۇلىنىشى كۆچۈرۈلدى 🔗")}
  }catch(e){}
}
function miniCover(b){
  return `<img src="${coverSrc(b)}" alt="${b.title}" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK_COVER}'">`;
}

function miniCard(b){return `<article class="shop-mini-card"><button type="button" class="mini-heart" data-fav-id="${b.id}">♡</button><a href="${b.href}">${miniCover(b)}<div class="shop-mini-title">${b.title}</div><div class="shop-mini-meta">${b.author}</div><div class="shop-mini-price">${money(b.price)}</div></a><div class="mini-actions"><button type="button" class="add-to-cart" data-cart-id="${b.id}">🛒 سېۋەتكە سېلىش</button><button type="button" class="share-button" data-share-id="${b.id}">🔗</button></div></article>`}

function recommendedBooks(limit=12){
  let pinned=C.filter(b=>b.isRecommended===true);
  let groups=new Map();
  C.forEach(b=>{
    let key=b.category||"باشقا";
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(b);
  });
  let lists=[...groups.values()];
  let out=[...pinned.slice(0,limit)],i=0;
  while(out.length<limit && lists.some(a=>i<a.length)){
    for(const a of lists){
      if(a[i] && !out.some(x=>x.id===a[i].id))out.push(a[i]);
      if(out.length>=limit)break;
    }
    i++;
  }
  return out;
}


function renderHomeFeaturedBooks(){
  const host=document.querySelector("#homeFeaturedBooks");
  if(!host)return;

  const marked=C.filter(b=>b.isNew===true);
  const books=(marked.length?marked:C).slice(0,6);

  function card(b){
    return `<article class="home-feature-card">
      <button type="button" class="home-feature-heart favorite-button mini-heart" data-fav-id="${b.id}" aria-label="ياقتۇرۇش" aria-pressed="false">♡</button>
      <a href="${b.href}">
        <div class="home-feature-cover">
          <div class="home-feature-cover-frame">
            <img src="${coverSrc(b)}" alt="${b.title} كىتاب مۇقاۋىسى" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK_COVER}'">
          </div>
        </div>
        <div class="home-feature-info">
          <div class="home-feature-title">${b.title}</div>
          <div class="home-feature-author">${b.author||"—"}</div>
          <div class="home-feature-bottom">
            <span class="home-feature-price">${money(b.price)}</span>
            <button type="button" class="add-to-cart home-feature-cart" data-cart-id="${b.id}" aria-label="سېۋەتكە قوشۇش">🛒</button>
          </div>
        </div>
      </a>
    </article>`;
  }

  host.innerHTML=`<section class="home-featured-section">
    <div class="home-featured-head">
      <div>
        <h3>🆕 يېڭى كىتابلار</h3>
        <p>باش بەتتىنلا كىتابلارنى كۆرۈپ تاللاڭ.</p>
      </div>
      <a class="home-featured-all" href="my-books.html">ھەممىسىنى كۆرۈش ←</a>
    </div>
    <div class="home-featured-grid">${books.map(card).join("")}</div>
  </section>`;

  bindDynamicActions(host);
}

function renderHomeSections(){
  let host=document.querySelector("#homeShopSections");if(!host)return;
  let rec=get(REC_KEY,[]).map(find).filter(Boolean).slice(0,6);
  let fav=favs().map(find).filter(Boolean).slice(0,6);
  let newest=C.slice(0,8);
  let recommended=recommendedBooks(8);
  let data={newest:["🆕 يېڭى قوشۇلغان كىتابلار",newest],recommended:["⭐ تەۋسىيە قىلىنغان كىتابلار",recommended],recent:["🕘 يېقىندا كۆرۈلگەن كىتابلار",rec],favorites:["❤️ ياقتۇرغان كىتابلار",fav]};
  host.innerHTML=`<div class="shop-selector"><button type="button" class="shop-selector-button" id="shopSelectorButton">📚 كىتابلارنى تاللاش <span>⌄</span></button><div class="shop-selector-menu" id="shopSelectorMenu"><button type="button" data-shop-tab="newest">🆕 يېڭى قوشۇلغان كىتابلار</button><button type="button" data-shop-tab="recommended">⭐ تەۋسىيە قىلىنغان كىتابلار</button><button type="button" data-shop-tab="recent">🕘 يېقىندا كۆرۈلگەن كىتابلار</button><button type="button" data-shop-tab="favorites">❤️ ياقتۇرغان كىتابلار</button><a class="shop-selector-all-link" href="my-books.html">📚 مېنىڭ كىتابلىرىم — ھەممىسىنى بىر يەردە كۆرۈش</a></div></div><div id="shopSelectedContent" class="shop-selected-content"></div>`;
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
    <a class="advanced-search-cover" href="${b.href}"><img src="${coverSrc(b)}" alt="${b.title}" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK_COVER}'"></a>
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

function dynamicListingCard(b){
  return `<article class="book-card" data-live-book-id="${b.id}">
    <a class="book-image" href="${b.href}">
      <img alt="${b.title}" src="${coverSrc(b)}" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK_COVER}'">
    </a>
    <div class="book-info">
      <h2 class="book-title">${b.title}</h2>
      <p class="book-author">${b.author||"—"}</p>
      <div class="book-price">${money(b.price)}</div>
      <a class="detail-button" href="${b.href}">تەپسىلات</a>
    </div>
  </article>`;
}

function setupCatalogFilters(){
  let file=(location.pathname.split("/").pop()||"").split(/[?#]/)[0]||"index.html";
  let pageBooks=C.filter(b=>b.source===file);
  let grid=document.querySelector(".books-grid");
  if(!grid||!pageBooks.length||document.querySelector("#catalogFilterBar"))return;

  let existingIds=new Set([...grid.querySelectorAll(".book-card")].map(cardId).filter(Boolean));
  let missing=pageBooks.filter(b=>!existingIds.has(b.id));
  if(missing.length){
    grid.insertAdjacentHTML("beforeend",missing.map(dynamicListingCard).join(""));
    decorateCards();
  }

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

function myBooksData(){
  return {
    newest:(C.filter(b=>b.isNew===true).length?C.filter(b=>b.isNew===true):C).slice(0,12),
    recommended:recommendedBooks(12),
    recent:get(REC_KEY,[]).map(find).filter(Boolean).slice(0,12),
    favorites:favs().map(find).filter(Boolean)
  };
}

function renderMyBooks(){
  let host=document.querySelector("#myBooksApp");if(!host)return;
  let active=host.dataset.activeTab||"newest";

  function tabMeta(data){
    return {
      newest:["🆕","يېڭى قوشۇلغانلار",data.newest.length],
      recommended:["⭐","تەۋسىيە قىلىنغانلار",data.recommended.length],
      recent:["🕘","يېقىندا كۆرگەنلىرىم",data.recent.length],
      favorites:["❤️","ياقتۇرغانلىرىم",data.favorites.length]
    };
  }

  function emptyText(key){
    if(key==="favorites")return "❤️ ھازىرچە ياقتۇرغان كىتاب يوق. كىتاب كارتىسىدىكى يۈرەك بەلگىسىنى بېسىپ بۇ يەرگە ساقلىيالايسىز.";
    if(key==="recent")return "🕘 ھازىرچە كۆرۈش تارىخى يوق. بىر كىتابنىڭ تەپسىلات بېتىنى ئاچسىڭىز بۇ يەردە كۆرۈنىدۇ.";
    return "كىتابلار تېخى قوشۇلمىغان.";
  }

  function draw(key,scroll=false){
    let data=myBooksData();
    let meta=tabMeta(data);
    let arr=data[key]||[];
    active=key;
    host.dataset.activeTab=key;

    host.querySelectorAll("[data-mybooks-tab]").forEach(btn=>{
      btn.classList.toggle("is-active",btn.dataset.mybooksTab===key);
      btn.setAttribute("aria-selected",btn.dataset.mybooksTab===key?"true":"false");
    });

    let content=host.querySelector("#myBooksContent");
    content.innerHTML=`
      <div class="mybooks-section-head">
        <div>
          <span class="mybooks-kicker">${meta[key][0]} مېنىڭ كىتابلىرىم</span>
          <h2>${meta[key][1]}</h2>
        </div>
        <span class="mybooks-result-count">${arr.length} دانە</span>
      </div>
      ${arr.length
        ? `<div class="shop-grid mybooks-grid">${arr.map(miniCard).join("")}</div>`
        : `<div class="empty-state mybooks-empty">${emptyText(key)}</div>`
      }`;

    bindDynamicActions(content);

    // Favorite changes should refresh counts and the favorite tab immediately.
    content.querySelectorAll("[data-fav-id]").forEach(btn=>{
      const old=btn.onclick;
      btn.onclick=e=>{
        if(old)old(e);
        setTimeout(()=>renderMyBooks(),0);
      };
    });

    updateMyBooksCounts();
    if(scroll)content.scrollIntoView({behavior:"smooth",block:"start"});
  }

  function updateMyBooksCounts(){
    let data=myBooksData(),meta=tabMeta(data);
    Object.keys(meta).forEach(key=>{
      let badge=host.querySelector(`[data-mybooks-count="${key}"]`);
      if(badge)badge.textContent=meta[key][2];
    });
    let total=host.querySelector("#myBooksTotal");
    let cartNum=host.querySelector("#myBooksCartCount");
    if(total)total.textContent=C.length;
    if(cartNum)cartNum.textContent=cart().reduce((s,x)=>s+(x.qty||1),0);
  }

  let data=myBooksData(),meta=tabMeta(data);
  host.innerHTML=`
    <section class="mybooks-summary">
      <div class="mybooks-summary-card">
        <span>📚</span>
        <strong id="myBooksTotal">${C.length}</strong>
        <small>بارلىق كىتاب</small>
      </div>
      <div class="mybooks-summary-card">
        <span>❤️</span>
        <strong data-mybooks-count="favorites">${data.favorites.length}</strong>
        <small>ياقتۇرغان</small>
      </div>
      <div class="mybooks-summary-card">
        <span>🕘</span>
        <strong data-mybooks-count="recent">${data.recent.length}</strong>
        <small>يېقىندا كۆرگەن</small>
      </div>
      <a href="cart.html" class="mybooks-summary-card mybooks-summary-link">
        <span>🛒</span>
        <strong id="myBooksCartCount">${cart().reduce((s,x)=>s+(x.qty||1),0)}</strong>
        <small>سېۋەتتىكى كىتاب</small>
      </a>
    </section>

    <div class="mybooks-tabs" role="tablist" aria-label="مېنىڭ كىتابلىرىم">
      ${Object.entries(meta).map(([key,m])=>`
        <button type="button" role="tab" data-mybooks-tab="${key}" aria-selected="${key===active?"true":"false"}" class="${key===active?"is-active":""}">
          <span>${m[0]} ${m[1]}</span>
          <b data-mybooks-count="${key}">${m[2]}</b>
        </button>`).join("")}
    </div>

    <section id="myBooksContent" class="mybooks-content"></section>
  `;

  host.querySelectorAll("[data-mybooks-tab]").forEach(btn=>{
    btn.onclick=()=>draw(btn.dataset.mybooksTab,true);
  });

  draw(active,false);
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
      <img src="${coverSrc(x.b)}" alt="${x.b.title}" onerror="this.onerror=null;this.src='${FALLBACK_COVER}'">
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

function loadMemberProfileIntoCheckout(){
  const p=window.KutadguMember?.getProfile?.();if(!p)return;
  const values={
    customerName:p.full_name,
    customerPhone:p.phone,
    customerCity:[p.city,p.country].filter(Boolean).join(" / "),
    customerAddress:p.address
  };
  let changed=false;
  Object.entries(values).forEach(([id,value])=>{
    const el=document.querySelector("#"+id);
    if(el&&!el.value&&value){el.value=value;changed=true}
  });
  if(changed)saveCustomerData();
}

function makeOrderId(){
  let now=new Date();
  let y=String(now.getFullYear()).slice(-2);
  let m=String(now.getMonth()+1).padStart(2,"0");
  let d=String(now.getDate()).padStart(2,"0");
  let r=Math.floor(1000+Math.random()*9000);
  return `KB-${y}${m}${d}-${r}`;
}

let preparedOrder=null,preparedOrderSignature="";
function currentOrderSignature(customer){
  return JSON.stringify({cart:cart(),customer});
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

  return {
    text:lines.join("\n"),
    orderId,
    total,
    totalQty,
    customer:c,
    items:items.map(x=>({
      book_id:x.b.id,
      title:x.b.title,
      author:x.b.author,
      price:Number(x.b.price)||0,
      qty:x.qty,
      line_total:(Number(x.b.price)||0)*x.qty
    }))
  };
}

function getOrBuildOrder(requireCustomer=true){
  const form=document.querySelector("#checkoutForm");
  if(requireCustomer&&form&&!form.reportValidity())return null;
  const customer=saveCustomerData();
  const signature=currentOrderSignature(customer);
  if(preparedOrder&&preparedOrderSignature===signature)return preparedOrder;
  const order=buildOrderText(false);if(!order)return null;
  preparedOrder=order;preparedOrderSignature=signature;
  return order;
}

async function savePreparedOrderHistory(order){
  if(!order)return {saved:false};
  if(order.historySaved)return {saved:true};
  if(window.KutadguMember?.ready)await window.KutadguMember.ready;
  const result=await window.KutadguMember?.saveOrder?.(order);
  if(result?.saved)order.historySaved=true;
  return result||{saved:false,reason:"member_unavailable"};
}

async function showOrderPreview(){
  let o=getOrBuildOrder(true);if(!o)return null;
  let wrap=document.querySelector("#orderPreviewWrap");
  let pre=document.querySelector("#orderPreview");
  if(wrap&&pre){
    pre.textContent=o.text;
    wrap.hidden=false;
    wrap.scrollIntoView({behavior:"smooth",block:"nearest"});
  }
  try{
    const saved=await savePreparedOrderHistory(o);
    if(saved?.saved)toast("زاكاز تەييارلاندى ۋە ھېسابىڭىزغا ساقلاندى ✅");
    else if(saved?.reason==="not_signed_in")toast("زاكاز تەييارلاندى؛ ئەزا بولسىڭىز زاكاز تارىخىغىمۇ ساقلىنىدۇ");
    else toast("زاكاز ئۇچۇرى تەييار بولدى ✅");
  }catch(err){
    console.warn("Order history save failed",err);
    toast("زاكاز تەييارلاندى؛ تارىخقا ساقلاش ۋاقىتلىق مەغلۇپ بولدى");
  }
  return o;
}

async function copyOrder(){
  let o=getOrBuildOrder(true);if(!o)return;
  try{await savePreparedOrderHistory(o)}catch(err){console.warn("Order history save failed",err)}
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
  let o=getOrBuildOrder(true);if(!o)return;
  try{await savePreparedOrderHistory(o)}catch(err){console.warn("Order history save failed",err)}
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



/* ===== باش بەت: يېڭى كەلگەن كىتابلار Carousel ===== */
function setupHomeCarousel(){
  const host=document.querySelector("#homeCarouselTrack");
  const viewport=document.querySelector("#homeCarouselViewport");
  const dotsHost=document.querySelector("#homeCarouselDots");
  const tabs=[...document.querySelectorAll("[data-carousel-mode]")];
  if(!host||!viewport||!dotsHost)return;

  const sampleCover=FALLBACK_COVER;
  let mode="recommended";
  let list=[];
  let index=0,timer=null;
  const gap=10;

  function recommendedList(){
    const picked=C.filter(b=>b.isRecommended===true);
    return (picked.length?picked:recommendedBooks(20)).slice(0,20);
  }

  function bestsellerList(){
    const marked=C.filter(b=>b.isBestSeller===true || Number(b.salesCount)>0)
      .sort((a,b)=>(Number(b.salesCount)||0)-(Number(a.salesCount)||0));
    /* سېتىلىش سانى تېخى كىرگۈزۈلمىگەن بولسا، بەت بوش قالمىسۇن:
       تەۋسىيەلىك كىتابلار ۋاقىتلىق كۆرسىتىلىدۇ. */
    return (marked.length?marked:recommendedList()).slice(0,20);
  }

  function currentList(){
    return mode==="bestseller"?bestsellerList():recommendedList();
  }

  function card(b){
    return `<article class="home-carousel-card">
      <button type="button" class="home-carousel-fav favorite-button mini-heart" data-fav-id="${b.id}" aria-label="ياقتۇرۇش">♡</button>
      <a href="${b.href}" class="home-carousel-link">
        <div class="home-carousel-cover"><img src="${coverSrc(b)}" alt="${b.title||'كىتاب مۇقاۋىسى'}" loading="lazy" onerror="this.onerror=null;this.src='${sampleCover}'"></div>
        <div class="home-carousel-info">
          <div class="home-carousel-title">${b.title||"كىتاب"}</div>
          <div class="home-carousel-author">${b.author||"—"}</div>
          <div class="home-carousel-bottom">
            <span class="home-carousel-price">${money(b.price)}</span>
            <button type="button" class="home-carousel-cart add-to-cart" data-cart-id="${b.id}" aria-label="سېۋەتكە قوشۇش">🛒</button>
          </div>
        </div>
      </a>
    </article>`;
  }

  const visible=()=>window.innerWidth<=430?1:window.innerWidth<=700?2:window.innerWidth<=1100?4:8;
  const maxIndex=()=>Math.max(0,list.length-visible());

  function renderDots(){
    const count=maxIndex()+1;
    dotsHost.innerHTML=Array.from({length:count},(_,i)=>`<button type="button" class="home-carousel-dot${i===index?' is-active':''}" data-carousel-dot="${i}" aria-label="${i+1}-بەت"></button>`).join("");
    dotsHost.querySelectorAll("[data-carousel-dot]").forEach(btn=>btn.onclick=()=>{
      index=Number(btn.dataset.carouselDot)||0;
      move();
      restart();
    });
  }

  function move(){
    index=Math.max(0,Math.min(index,maxIndex()));
    const cardEl=host.querySelector(".home-carousel-card");
    if(!cardEl)return;
    const step=cardEl.getBoundingClientRect().width+gap;
    host.style.transform=`translateX(${index*step}px)`;
    dotsHost.querySelectorAll(".home-carousel-dot").forEach((d,i)=>d.classList.toggle("is-active",i===index));
  }

  function draw(){
    list=currentList();
    index=0;
    host.style.transform="translateX(0)";
    host.innerHTML=list.map(card).join("");
    bindDynamicActions(host);
    renderFavButtons();
    renderDots();
    move();
  }

  function setMode(nextMode){
    mode=nextMode==="bestseller"?"bestseller":"recommended";
    tabs.forEach(btn=>{
      const active=btn.dataset.carouselMode===mode;
      btn.classList.toggle("is-active",active);
      btn.setAttribute("aria-selected",active?"true":"false");
    });
    draw();
    restart();
  }

  function next(){index=index>=maxIndex()?0:index+1;move()}
  function prev(){index=index<=0?maxIndex():index-1;move()}
  function stop(){if(timer){clearInterval(timer);timer=null}}
  function start(){stop();timer=setInterval(next,3000)}
  function restart(){start()}

  tabs.forEach(btn=>btn.addEventListener("click",()=>setMode(btn.dataset.carouselMode)));
  document.querySelector("#carouselNext")?.addEventListener("click",()=>{next();restart()});
  document.querySelector("#carouselPrev")?.addEventListener("click",()=>{prev();restart()});
  viewport.addEventListener("mouseenter",stop);
  viewport.addEventListener("mouseleave",start);
  viewport.addEventListener("focusin",stop);
  viewport.addEventListener("focusout",start);
  document.addEventListener("visibilitychange",()=>document.hidden?stop():start());
  window.addEventListener("resize",()=>{index=Math.min(index,maxIndex());renderDots();move()});

  setMode("recommended");
}

function loadMemberSystem(){
  if(document.querySelector('script[data-kutadgu-member-script]')||window.KutadguMember)return;
  const script=document.createElement("script");
  script.src="member.js?v=3";script.async=true;script.dataset.kutadguMemberScript="1";
  document.body.appendChild(script);
}
function refreshAfterMemberSync(){
  updateBadge();renderFavButtons();
  if(document.querySelector("#cartItems"))cartPage();
  if(document.querySelector("#myBooksApp"))renderMyBooks();
  loadMemberProfileIntoCheckout();
}
function init(){
  injectFloat();applyStaticCoverFallbacks();syncStaticCards();applyDetailCoverFallback();decorateCards();decorateDetail();searchEnhance();setupCatalogFilters();setupHomeCarousel();renderHomeFeaturedBooks();renderHomeSections();renderMyBooks();cartPage();setupCheckout();
  document.addEventListener("kutadgu-member-state-synced",refreshAfterMemberSync);
  document.addEventListener("kutadgu-member-change",loadMemberProfileIntoCheckout);
  loadMemberSystem();
}
async function boot(){await loadRemoteCatalog();init()}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
window.kutadguShop={add,remove,toggleFav,cart,shareBook,buildOrderText,copyOrder,shareOrder};
})();
