/*
  قۇتادغۇبىلىك كىتابخانىسى — Supabase public config
  پەقەت PUBLIC Project URL ۋە PUBLIC Publishable key ئىشلىتىلىدۇ.
*/
window.KUTADGU_SITE_ORIGIN = "https://kutadgu-bilig-kitab.vercel.app";

window.kutadguPasswordResetRedirectTo = function(next){
  const origin=String(window.KUTADGU_SITE_ORIGIN||location.origin||"").replace(/\/+$/,"");
  const url=origin+"/reset-password.html";
  if(next==="admin"||next==="account")return url+"?next="+encodeURIComponent(next);
  return url;
};

(function kutadguBounceRecoveryToResetPage(){
  try{
    const file=(location.pathname.split("/").pop()||"index.html").split(/[?#]/)[0]||"index.html";
    if(file==="reset-password.html")return;
    const search=new URLSearchParams(location.search);
    const hash=new URLSearchParams(String(location.hash||"").replace(/^#/,""));
    const type=String(search.get("type")||hash.get("type")||"").toLowerCase();
    if(type==="signup"||type==="email")return;
    const recovery=type==="recovery";
    const onHome=file==="index.html"||file==="";
    const authOnHome=onHome&&(search.has("code")||search.has("token_hash")||hash.has("access_token"));
    if(!recovery&&!authOnHome)return;
    const dest=new URL("reset-password.html",location.href);
    search.forEach((value,key)=>{if(key)dest.searchParams.set(key,value)});
    dest.hash=location.hash||"";
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
  description is live-supported optional text. Do not invent columns.
*/
window.KUTADGU_BOOKS_SCHEMA = {
  identityId: true,
  optionalColumns: {
    isbn: true,
    publisher: false,
    href: false,
    stock: false,
    stock_status: false,
    pages: false,
    translator: false,
    language: false,
    publish_date: false,
    publish_year: false,
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
