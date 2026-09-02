/*
  Premium discovery UX module
  Discovery, wizard, smart suggestions, empty-state actions and analytics hooks.
*/
(function(){
  "use strict";
  if(window.KUTADGU_PREMIUM_UX_READY)return;
  window.KUTADGU_PREMIUM_UX_READY=true;

  const config=window.KUTADGU_APP_CONFIG||{};
  const features={
    discovery:true,smartWizard:true,smartSearchSuggestions:true,
    smartEmptyState:true,recentlyViewed:true,recommendations:true,
    analyticsHooks:true,
    ...(config.featureFlags||{})
  };
  const REC_KEY=config.storageKeys?.recentlyViewed||"kutadgu-recent-v1";
  const fallbackCover="/sample-book-cover.png";

  const catalog=()=>{
    const rows=window.kutadguShop?.getCatalog?.()||window.KUTADGU_LIVE_CATALOG||window.KITAP_CATALOG||[];
    return rows.filter(book=>window.kutadguShop?.isStorefrontVisible?window.kutadguShop.isStorefrontVisible(book):book.isActive!==false&&book.is_active!==false);
  };
  const normalize=value=>String(value||"").trim().toLocaleLowerCase("ug");
  const escapeHtml=value=>String(value??"").replace(/[&<>'"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch]));
  const money=value=>value!==null&&value!==undefined&&value!==""?`${Number(value).toLocaleString("tr-TR")} ₺`:"باھا تېخى بېكىتىلمىگەن";
  const assetPath=src=>{
    const value=String(src||"").trim();
    if(!value)return fallbackCover;
    if(/^(https?:)?\/\//i.test(value)||value.startsWith("/")||value.startsWith("data:"))return value;
    return "/"+value.replace(/^\.\//,"");
  };
  const cover=book=>escapeHtml(assetPath(book?.image||fallbackCover));
  const bookHref=book=>{
    const id=String(book&&book.id||"").trim();
    if(/^\d+$/.test(id))return `/book/${id}`;
    return book&&book.href?String(book.href):(`book.html?id=${encodeURIComponent(id)}`);
  };
  const enabled=name=>features[name]!==false;

  function badges(book){
    const items=[];
    if(book.isNew===true)items.push("🆕 يېڭى");
    if(book.isBestSeller===true)items.push("🔥 كۆپ سېتىلغان");
    if(!items.length&&(book.isRecommended===true||book.isFeatured===true))items.push("⭐ تەۋسىيە");
    return items.slice(0,2).map(label=>`<span>${label}</span>`).join("");
  }

  window.KutadguAnalytics=window.KutadguAnalytics||{
    track(name,data={}){
      if(!enabled("analyticsHooks"))return;
      document.dispatchEvent(new CustomEvent("kutadgu:analytics-event",{detail:{name,data,at:new Date().toISOString()}}));
    }
  };

  function compactCard(book){
    return `<article class="premium-book-card" data-premium-book-id="${escapeHtml(book.id)}">
      <button type="button" class="premium-card-favorite" data-premium-favorite="${escapeHtml(book.id)}" aria-label="ياقتۇرۇش" aria-pressed="false">♡</button>
      <a class="premium-card-link" href="${escapeHtml(bookHref(book))}">
        <span class="premium-card-cover"><img src="${cover(book)}" alt="${escapeHtml(book.title)} كىتاب مۇقاۋىسى" loading="lazy" decoding="async"></span>
        ${badges(book)?`<span class="premium-card-badges">${badges(book)}</span>`:""}
        <strong>${escapeHtml(book.title)}</strong>
        <small>${escapeHtml(book.author||"—")}</small>
        <span class="premium-card-price">${money(book.price)}</span>
      </a>
      <button type="button" class="premium-card-cart" data-premium-cart="${escapeHtml(book.id)}">🛒 سېۋەتكە</button>
    </article>`;
  }

  function bindCards(scope){
    scope.querySelectorAll(".premium-card-cover img").forEach(img=>img.onerror=()=>{img.onerror=null;img.src=fallbackCover});
    scope.querySelectorAll("[data-premium-favorite]").forEach(button=>{
      const active=!!window.kutadguShop?.favHas?.(button.dataset.premiumFavorite);
      button.classList.toggle("is-favorite",active);button.textContent=active?"♥":"♡";button.setAttribute("aria-pressed",active?"true":"false");
    });
    scope.querySelectorAll("[data-premium-cart]").forEach(button=>button.onclick=()=>window.kutadguShop?.add?.(button.dataset.premiumCart));
    scope.querySelectorAll("[data-premium-favorite]").forEach(button=>button.onclick=()=>{
      window.kutadguShop?.toggleFav?.(button.dataset.premiumFavorite);
      button.classList.toggle("is-favorite");
      button.textContent=button.classList.contains("is-favorite")?"♥":"♡";
      button.setAttribute("aria-pressed",button.classList.contains("is-favorite")?"true":"false");
    });
  }

  function booksForCategories(categories){
    const set=new Set(categories||[]);
    return catalog().filter(book=>set.has(book.category)||set.has(book.subcategory));
  }

  function recommended(limit=8){
    const all=catalog();
    const marked=all.filter(book=>book.isRecommended===true||book.isFeatured===true);
    return (marked.length?marked:all).slice(0,limit);
  }

  function renderDiscovery(){
    if(!enabled("discovery")||document.querySelector("#premiumDiscovery"))return;
    const anchor=document.querySelector("#bookCategories")||document.querySelector(".home-search-card-section")||document.querySelector(".home-trust-strip");
    if(!anchor)return;
    const groups=(config.discoveryGroups||[]).filter(group=>group?.id&&group?.label);
    if(!groups.length)return;

    const section=document.createElement("section");
    section.id="premiumDiscovery";
    section.className="premium-discovery";
    section.innerHTML=`
      <div class="premium-section-heading">
        <div><span>✨ كىتاب تېپىشنى ئاسانلاشتۇرىمىز</span><h2><span class="premium-discovery-title-desktop">قايسى كىتابنى ئوقۇغىڭىز بار؟</span><span class="premium-discovery-title-mobile">قايسى كىتابنى ئوقۇغىڭىز بار؟</span></h2><p>تۈرنى تاللاڭ؛ سىزگە ئەڭ ماس 4–8 كىتابنى كۆرسىتىمىز.</p></div>
        ${enabled("smartWizard")?'<button type="button" class="premium-wizard-open" id="premiumWizardOpen" aria-expanded="false">🧭 سىزگە ماس كىتابنى تېپىڭ</button>':""}
      </div>
      <div class="premium-discovery-groups" role="group" aria-label="كىتاب تۈرلىرى">
        ${groups.map((group)=>`<button type="button" class="premium-group-button" data-premium-group="${escapeHtml(group.id)}"><span>${escapeHtml(group.icon||"📚")}</span>${escapeHtml(group.label)}</button>`).join("")}
      </div>
      <div class="premium-subcategories" id="premiumSubcategories"></div>
      <div class="premium-discovery-results" id="premiumDiscoveryResults" aria-live="polite"></div>
      ${enabled("smartWizard")?wizardMarkup(groups):""}`;
    anchor.insertAdjacentElement("beforebegin",section);

    const results=section.querySelector("#premiumDiscoveryResults");
    const subcategories=section.querySelector("#premiumSubcategories");
    function showGroup(id,category=""){
      const group=groups.find(item=>item.id===id)||groups[0];
      section.querySelectorAll("[data-premium-group]").forEach(button=>button.classList.toggle("is-active",button.dataset.premiumGroup===group.id));
      const list=booksForCategories(group.categories);
      subcategories.innerHTML=group.categories.map(name=>`<button type="button" data-premium-subcategory="${escapeHtml(name)}" class="${name===category?'is-active':''}">${escapeHtml(name)}</button>`).join("");
      const filtered=category?list.filter(book=>book.category===category||book.subcategory===category):list;
      const shown=(filtered.length?filtered:recommended(8)).slice(0,8);
      results.innerHTML=shown.length?`<div class="premium-book-grid">${shown.map(compactCard).join("")}</div>`:'<div class="premium-friendly-empty">بۇ تۈردە ھازىرچە كىتاب يوق. باشقا تۈرنى تاللاپ كۆرۈڭ.</div>';
      bindCards(results);
      subcategories.querySelectorAll("[data-premium-subcategory]").forEach(button=>button.onclick=()=>showGroup(group.id,button.dataset.premiumSubcategory));
    }
    section.querySelectorAll("[data-premium-group]").forEach(button=>button.onclick=()=>showGroup(button.dataset.premiumGroup));
    results.innerHTML='<div class="premium-friendly-empty">تۈرنى تاللاڭ؛ شۇ تۈردىكى كىتابلار تۆۋەندە كۆرۈنىدۇ.</div>';
    setupWizard(section,groups);
  }

  function wizardMarkup(groups){
    return `<div class="premium-wizard" id="premiumWizard" hidden>
      <div class="premium-wizard-progress"><span class="is-active">1</span><span>2</span><span>3</span></div>
      <div class="premium-wizard-step" data-wizard-step="1"><h3>1. قايسى تۈرنى خالايسىز؟</h3><div>${groups.map(group=>`<button type="button" data-wizard-group="${escapeHtml(group.id)}">${escapeHtml(group.icon||"📚")} ${escapeHtml(group.label)}</button>`).join("")}</div></div>
      <div class="premium-wizard-step" data-wizard-step="2" hidden><h3>2. قانداق كىتاب ئىزدەۋاتىسىز؟</h3><div><button type="button" data-wizard-style="story">رومان ۋە ھېكايە</button><button type="button" data-wizard-style="knowledge">بىلىم ۋە دەرسلىك</button><button type="button" data-wizard-style="children">بالىلار ئۈچۈن</button><button type="button" data-wizard-style="all">ھەممىسى</button></div></div>
      <div class="premium-wizard-step" data-wizard-step="3" hidden><h3>3. باھا دائىرىسى</h3><div><button type="button" data-wizard-price="0-200">200 ₺ غىچە</button><button type="button" data-wizard-price="201-300">201–300 ₺</button><button type="button" data-wizard-price="301-999999">300 ₺ دىن يۇقىرى</button><button type="button" data-wizard-price="all">باھا چەكلىمىسى يوق</button></div></div>
      <div class="premium-wizard-results" id="premiumWizardResults" aria-live="polite"></div>
    </div>`;
  }

  function setupWizard(section,groups){
    const open=section.querySelector("#premiumWizardOpen"),wizard=section.querySelector("#premiumWizard");
    if(!open||!wizard)return;
    const state={group:"",style:"all",price:"all"};
    open.onclick=()=>{wizard.hidden=!wizard.hidden;open.setAttribute("aria-expanded",wizard.hidden?"false":"true");if(!wizard.hidden)wizard.scrollIntoView({behavior:"smooth",block:"nearest"})};
    const setStep=step=>{
      wizard.querySelectorAll("[data-wizard-step]").forEach(node=>node.hidden=Number(node.dataset.wizardStep)!==step);
      wizard.querySelectorAll(".premium-wizard-progress span").forEach((node,index)=>node.classList.toggle("is-active",index<step));
    };
    wizard.querySelectorAll("[data-wizard-group]").forEach(button=>button.onclick=()=>{state.group=button.dataset.wizardGroup;setStep(2)});
    wizard.querySelectorAll("[data-wizard-style]").forEach(button=>button.onclick=()=>{state.style=button.dataset.wizardStyle;setStep(3)});
    wizard.querySelectorAll("[data-wizard-price]").forEach(button=>button.onclick=()=>{
      state.price=button.dataset.wizardPrice;
      const group=groups.find(item=>item.id===state.group);
      let list=booksForCategories(group?.categories||[]);
      if(state.style==="story")list=list.filter(book=>/رومان|ھېكايە|داستان/.test(`${book.category} ${book.subcategory||""}`));
      if(state.style==="knowledge")list=list.filter(book=>/دەرسلىك|تېبابەت|ئۇنىۋېرسال|دىنىي/.test(`${book.category} ${book.subcategory||""}`));
      if(state.style==="children")list=list.filter(book=>/بالىلار|تەربىيە/.test(`${book.category} ${book.subcategory||""}`));
      if(state.price!=="all"){
        const [min,max]=state.price.split("-").map(Number);
        list=list.filter(book=>Number(book.price)>=min&&Number(book.price)<=max);
      }
      const shown=(list.length?list:recommended(8)).slice(0,8);
      const host=wizard.querySelector("#premiumWizardResults");
      host.innerHTML=`<h3>سىزگە ماس كىتابلار</h3><div class="premium-book-grid">${shown.map(compactCard).join("")}</div><button type="button" class="premium-wizard-restart">↺ قايتا تاللاش</button>`;
      bindCards(host);
      host.querySelector(".premium-wizard-restart").onclick=()=>{state.group="";state.style="all";state.price="all";host.innerHTML="";setStep(1)};
      wizard.querySelectorAll("[data-wizard-step]").forEach(node=>node.hidden=true);
      window.KutadguAnalytics?.track?.("filter_apply",{source:"smart_wizard",results:shown.length});
    });
  }

  function setupSearchSuggestions(){
    if(!enabled("smartSearchSuggestions"))return;
    const input=document.querySelector("#searchInput");
    if(!input||input.dataset.premiumSuggestions==="1")return;
    input.dataset.premiumSuggestions="1";
    input.setAttribute("aria-autocomplete","list");
    input.setAttribute("aria-controls","premiumSearchSuggestions");
    const list=document.createElement("div");
    list.id="premiumSearchSuggestions";
    list.className="premium-search-suggestions";
    list.setAttribute("role","listbox");
    list.hidden=true;
    input.parentElement.appendChild(list);
    let active=-1;

    function close(){list.hidden=true;list.innerHTML="";active=-1;input.removeAttribute("aria-activedescendant")}
    function choose(value,href=""){
      if(href){location.href=href;return}
      input.value=value;input.dispatchEvent(new Event("input",{bubbles:true}));close();
    }
    function draw(){
      const q=normalize(input.value);
      if(q.length<1){close();return}
      const matches=catalog().filter(book=>normalize([book.title,book.author,book.category,book.subcategory].join(" ")).includes(q)).slice(0,5);
      const suggestions=[];
      matches.forEach(book=>suggestions.push({type:"كىتاب",value:book.title,meta:book.author,href:book.href}));
      for(const field of ["author","category","subcategory"]){
        for(const book of catalog()){
          const value=book[field];
          if(value&&normalize(value).includes(q)&&!suggestions.some(item=>item.value===value))suggestions.push({type:field==="author"?"ئاپتور":"تۈر",value,meta:""});
          if(suggestions.length>=8)break;
        }
      }
      const shown=suggestions.slice(0,8);
      if(!shown.length){close();return}
      list.innerHTML=shown.map((item,index)=>`<button type="button" role="option" id="premiumSuggestion${index}" data-suggestion-index="${index}"><span><b>${escapeHtml(item.value)}</b><small>${escapeHtml(item.meta)}</small></span><em>${escapeHtml(item.type)}</em></button>`).join("");
      list.hidden=false;active=-1;
      list.querySelectorAll("[data-suggestion-index]").forEach(button=>button.onmousedown=event=>{event.preventDefault();const item=shown[Number(button.dataset.suggestionIndex)];choose(item.value,item.href)});
      list._items=shown;
    }
    input.addEventListener("input",draw);
    input.addEventListener("keydown",event=>{
      const buttons=[...list.querySelectorAll("[role=option]")];if(list.hidden||!buttons.length)return;
      if(event.key==="ArrowDown"||event.key==="ArrowUp"){
        event.preventDefault();active=(active+(event.key==="ArrowDown"?1:-1)+buttons.length)%buttons.length;
        buttons.forEach((button,index)=>button.classList.toggle("is-active",index===active));
        input.setAttribute("aria-activedescendant",buttons[active].id);
      }else if(event.key==="Enter"&&active>=0){event.preventDefault();const item=list._items[active];choose(item.value,item.href)}
      else if(event.key==="Escape")close();
    });
    input.addEventListener("blur",()=>setTimeout(close,120));
  }

  function emptyActionMarkup(query){
    const phone=String(window.KUTADGU_CONTACT_CONFIG?.whatsapp||window.KUTADGU_WHATSAPP_NUMBER||"").replace(/\D/g,"");
    const text=`ئەسسالامۇ ئەلەيكۇم، «${query||"ئىزدەۋاتقان كىتاب"}» توغرىسىدا سورىماقچى ئىدىم.`;
    const whatsapp=phone?`https://wa.me/${phone}?text=${encodeURIComponent(text)}`:"#contact";
    const cats=[...new Set(catalog().map(book=>book.category).filter(Boolean))].slice(0,4);
    return `<div class="smart-empty-actions">
      <p>سۈزگۈچنى تازىلاپ قايتا سىناڭ ياكى يېقىن تۈرلەرنى كۆرۈڭ.</p>
      <div><button type="button" data-empty-reset>↺ سۈزگۈچنى تازىلاش</button>${cats.map(cat=>`<button type="button" data-empty-category="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`).join("")}<a href="${whatsapp}" target="_blank" rel="noopener noreferrer">💬 WhatsApp ئارقىلىق سوراش</a></div>
      <h3>كۆپ تاللىنىدىغان كىتابلار</h3>
      <div class="premium-book-grid premium-empty-books">${recommended(4).map(compactCard).join("")}</div>
    </div>`;
  }

  function setupSmartEmptyState(){
    if(!enabled("smartEmptyState"))return;
    const results=document.querySelector("#searchResults");if(!results)return;
    const enhance=()=>{
      const empty=results.querySelector(".search-empty");if(!empty||empty.querySelector(".smart-empty-actions"))return;
      const query=document.querySelector("#searchInput")?.value.trim()||"";
      empty.innerHTML=`<h2>ئىزدەش نەتىجىسى تېپىلمىدى</h2>${emptyActionMarkup(query)}`;
      bindCards(empty);
      empty.querySelector("[data-empty-reset]")?.addEventListener("click",()=>document.querySelector("#searchReset")?.click());
      empty.querySelectorAll("[data-empty-category]").forEach(button=>button.onclick=()=>{
        const select=document.querySelector("#searchCategory");if(!select)return;
        select.value=button.dataset.emptyCategory;select.dispatchEvent(new Event("change",{bubbles:true}));
      });
    };
    new MutationObserver(enhance).observe(results,{childList:true,subtree:true});enhance();
  }

  function setupFilterUX(){
    document.querySelectorAll(".advanced-search-panel,.catalog-filter-bar").forEach(panel=>{
      if(panel.dataset.premiumFilter==="1")return;panel.dataset.premiumFilter="1";
      const toggle=document.createElement("button");toggle.type="button";toggle.className="premium-filter-toggle";toggle.textContent="⚙️ سۈزگۈچلەرنى ئېچىش / يىغىش";toggle.setAttribute("aria-expanded","false");
      panel.before(toggle);panel.classList.add("is-collapsed");toggle.onclick=()=>{panel.classList.toggle("is-collapsed");toggle.setAttribute("aria-expanded",panel.classList.contains("is-collapsed")?"false":"true")};
      const chips=document.createElement("div");chips.className="premium-active-filters";panel.after(chips);
      const update=()=>{
        const active=[...panel.querySelectorAll("input,select")].filter(el=>el.value&&!(el.tagName==="SELECT"&&el.selectedIndex===0));
        chips.innerHTML=active.map(el=>`<button type="button" data-filter-clear="${escapeHtml(el.id)}">${escapeHtml(el.labels?.[0]?.textContent||el.value)}: ${escapeHtml(el.selectedOptions?.[0]?.textContent||el.value)} ×</button>`).join("");
        chips.querySelectorAll("[data-filter-clear]").forEach(button=>button.onclick=()=>{const el=document.getElementById(button.dataset.filterClear);if(!el)return;el.value="";el.dispatchEvent(new Event(el.tagName==="SELECT"?"change":"input",{bubbles:true}))});
      };
      panel.addEventListener("input",update);panel.addEventListener("change",()=>{update();window.KutadguAnalytics?.track?.("filter_apply",{source:panel.id||"catalog"})});update();
    });
  }

  function enhanceDetail(){
    const page=document.querySelector(".book-detail-page");if(!page)return;
    const currentId=document.body.dataset.bookId||new URLSearchParams(location.search).get("id");
    const current=catalog().find(book=>book.id===currentId||book.legacyId===currentId||book.href===(location.pathname.split("/").pop()||""));
    if(!current)return;
    const extras=page.querySelector(".detail-extra-sections");
    if(extras&&enabled("recommendations")&&!extras.querySelector("[data-people-also-viewed]")){
      const already=new Set([current.id]);
      extras.querySelectorAll("[data-cart-id]").forEach(node=>already.add(node.dataset.cartId));
      const books=[...catalog().filter(book=>!already.has(book.id)&&book.category===current.category),...catalog().filter(book=>!already.has(book.id)&&book.category!==current.category)].slice(0,4);
      if(books.length){
        const section=document.createElement("section");section.className="detail-extra-section";section.dataset.peopleAlsoViewed="1";
        section.innerHTML=`<div class="detail-section-heading"><div><span class="detail-section-kicker">📖 تۈرىگە ئاساسەن تاللاندى</span><h2>بۇ كىتابنى كۆرگەنلەر يەنە...</h2></div></div><div class="premium-book-grid">${books.map(compactCard).join("")}</div>`;
        extras.appendChild(section);bindCards(section);
      }
    }
    if(enabled("recentlyViewed")){
      [...page.querySelectorAll(".detail-extra-section")].forEach(section=>{
        if(!section.querySelector("h2")?.textContent.includes("يېقىندا")||section.querySelector(".premium-recent-clear"))return;
        const button=document.createElement("button");button.type="button";button.className="premium-recent-clear";button.textContent="تازىلاش";
        section.querySelector(".detail-section-heading")?.appendChild(button);
        button.onclick=()=>{try{localStorage.removeItem(REC_KEY)}catch(error){}section.remove()};
      });
    }
  }

  function init(){renderDiscovery();setupSearchSuggestions();setupSmartEmptyState();setupFilterUX();enhanceDetail()}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
