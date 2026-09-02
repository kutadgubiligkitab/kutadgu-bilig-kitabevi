(function(root){
"use strict";

const COVER_FALLBACK="/sample-book-cover.png";
const DANGEROUS_SCHEME=/^(?:javascript|data|vbscript|file|blob)\s*:/i;

function escapeHtml(v){
  return String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
function escapeAttr(v){return escapeHtml(v)}

function hasDangerousScheme(raw){
  return DANGEROUS_SCHEME.test(String(raw||"").trim());
}

function isSafeCoverUrl(raw){
  const t=String(raw||"").trim();
  if(!t)return false;
  if(hasDangerousScheme(t))return false;
  if(/[<>"'\s]/.test(t))return false;
  if(t.startsWith("//"))return false;
  if(/^https:\/\//i.test(t))return true;
  if(/^http:\/\//i.test(t))return true;
  if(t.startsWith("/")&&!t.startsWith("//"))return true;
  if(!/^[a-z][a-z0-9+.-]*:/i.test(t))return true;
  return false;
}

function safeCoverUrl(raw,opts){
  const options=opts&&typeof opts==="object"?opts:{};
  const fallback=Object.prototype.hasOwnProperty.call(options,"fallback")?options.fallback:COVER_FALLBACK;
  const t=String(raw||"").trim();
  if(!t)return fallback||"";
  if(isSafeCoverUrl(t))return t;
  if(options.fallbackOnInvalid===false)return "";
  return fallback||"";
}

function isSafeHref(raw){
  const t=String(raw||"").trim();
  if(!t)return false;
  if(hasDangerousScheme(t))return false;
  if(t.startsWith("//"))return false;
  if(/^https?:\/\//i.test(t))return true;
  if(t.startsWith("#")||t.startsWith("?")||t.startsWith("/")||t.startsWith("./")||t.startsWith("../"))return true;
  if(!/^[a-z][a-z0-9+.-]*:/i.test(t))return true;
  return false;
}

function safeHref(raw,fallback){
  const t=String(raw||"").trim();
  if(isSafeHref(t))return t;
  return fallback==null?"#":fallback;
}

const api={
  COVER_FALLBACK,
  escapeHtml,
  escapeAttr,
  hasDangerousScheme,
  isSafeCoverUrl,
  safeCoverUrl,
  isSafeHref,
  safeHref,
  COVER_URL_ERROR:"مۇقاۋا URL بىخەتەر ئەمەس. پەقەت https ياكى تور بەت ئىچىدىكى يولنى يېزىڭ. javascript / data ئىشلىتىلمەيدۇ."
};

if(typeof module!=="undefined"&&module.exports)module.exports=api;
root.KutadguSafeUrl=api;
})(typeof window!=="undefined"?window:typeof globalThis!=="undefined"?globalThis:{});
