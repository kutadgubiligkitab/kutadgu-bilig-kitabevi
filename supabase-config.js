/*
  قۇتادغۇبىلىك كىتابخانىسى — Supabase public config
  پەقەت PUBLIC Project URL ۋە PUBLIC Publishable key ئىشلىتىلىدۇ.
*/
window.KUTADGU_SITE_ORIGIN = "https://www.kutadgubilig.com";

window.kutadguPasswordResetRedirectTo = function(next){
  const origin=String(window.KUTADGU_SITE_ORIGIN||"https://www.kutadgubilig.com").replace(/\/+$/,"");
  const url=origin+"/reset-password.html";
  if(next==="admin"||next==="account")return url+"?next="+encodeURIComponent(next);
  return url+"?next=account";
};

window.kutadguIsPasswordRecoveryType = function(search,hash){
  const q=new URLSearchParams(search||"");
  const h=new URLSearchParams(String(hash||"").replace(/^#/,""));
  const type=String(q.get("type")||h.get("type")||"").toLowerCase();
  return type==="recovery";
};

(function kutadguBounceRecoveryToResetPage(){
  try{
    const file=(location.pathname.split("/").pop()||"index.html").split(/[?#]/)[0]||"index.html";
    if(file==="reset-password.html")return;
    const search=location.search||"";
    const hash=location.hash||"";
    if(!window.kutadguIsPasswordRecoveryType(search,hash))return;
    const dest=new URL("reset-password.html",location.href);
    new URLSearchParams(search).forEach((value,key)=>{if(key)dest.searchParams.set(key,value)});
    dest.hash=hash||"";
    location.replace(dest.pathname+dest.search+dest.hash);
  }catch(error){}
})();

window.KUTADGU_SUPABASE_CONFIG = {
  url: "https://fxlojnqwyojqjskfggmh.supabase.co",
  anonKey: "sb_publishable_lqxWeLH9m7hGbPMUfVY0pA_bdcK-PzE",
  bucket: "book-covers"
};

/*
  Live public.books capabilities for this Supabase project (fxlojnqwyojqjskfggmh).
  Verified read-only via PostgREST column selects. Not a secret; not a probe list.
  Admin uses this map so missing optional columns are never requested.
  Core columns always selected via *: id, title, author, price, image_url,
  category, source, description, is_active, is_new, is_recommended, sales_count.
  description is live-supported optional text.
  translator/publisher/publish_year/pages: true after STAGE61_BIBLIOGRAPHIC_METADATA.sql.
  If that SQL has not been run, Admin/storefront drop those columns on the first 42703 write/search (no boot probe).
*/
window.KUTADGU_BOOKS_SCHEMA = {
  identityId: true,
  optionalColumns: {
    isbn: true,
    publisher: true,
    href: false,
    stock: false,
    stock_status: false,
    pages: true,
    translator: true,
    language: false,
    publish_date: false,
    publish_year: true,
    cover_type: false,
    dimensions: false,
    /* true after STAGE45_LEGACY_ID_MIGRATION.sql. Importer never writes books.id. */
    legacy_id: true,
    /* false until GALLERY_IMAGES_MIGRATION.sql. Admin also live-detects the column. */
    gallery_images: false
  }
};

/*
  ئالاقە مەلۇماتى — ئىگىسى تەمىنلىگەن ھەقىقىي قىممەتلەر.
  WhatsApp سىستېمىسى دۆلەت كودى بىلەن، + ۋە بوشلۇقسىز نومۇر ئىشلىتىدۇ.
  خىزمەت ۋاقتىغا ھەقىقىي سانلىق مەلۇمات كىرگۈزۈلمىگەچكە بوش قالدۇرۇلدى.
*/
window.KUTADGU_WHATSAPP_NUMBER = "905368999888";
window.KUTADGU_CONTACT_CONFIG = {
  whatsapp: "905368999888",
  whatsappDisplay: "+90 536 899 98 88",
  phone: "+90 536 899 98 88",
  instagram: "@kutadgu_bilig_kitabhanisi",
  instagramUrl: "https://www.instagram.com/kutadgu_bilig_kitabhanisi/",
  address: "KEMALPAŞA MAH. 1. TURNA SK. AKPINAR APT. NO: 25/C, KAPI NO: K, KÜÇÜKÇEKMECE / İSTANBUL",
  addressUrl: "https://www.google.com/maps/search/?api=1&query=KEMALPA%C5%9EA%20MAH.%201.%20TURNA%20SK.%20AKPINAR%20APT.%20NO%3A%2025%2FC%2C%20KAPI%20NO%3A%20K%2C%20K%C3%9C%C3%87%C3%9CK%C3%87EKMECE%20%2F%20%C4%B0STANBUL",
  hours: "",
  storePhoto: ""
};

(function kutadguLoadMaintenanceGuard(){
  try{
    var file=(location.pathname.split("/").pop()||"").toLowerCase();
    if(file==="admin.html"||file==="admin-quality-preview.html"||file==="reset-password.html")return;
    document.documentElement.classList.add("kutadgu-maint-pending");
    if(!document.getElementById("kutadgu-maintenance-boot-style")){
      var css=document.createElement("style");
      css.id="kutadgu-maintenance-boot-style";
      css.textContent="html.kutadgu-maint-pending body,body.kutadgu-maint-pending{visibility:hidden!important}";
      (document.head||document.documentElement).appendChild(css);
    }
    if(document.querySelector('script[data-kutadgu-maintenance="1"]'))return;
    var s=document.createElement("script");
    s.src="kutadgu-maintenance.js?v=2";
    s.async=true;
    s.dataset.kutadguMaintenance="1";
    (document.head||document.documentElement).appendChild(s);
  }catch(e){}
})();
