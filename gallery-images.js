(function(root){
"use strict";

const MAX_GALLERY_IMAGES=4;
const MAX_GALLERY_BYTES=8*1024*1024;
const ALLOWED_GALLERY_MIMES=["image/jpeg","image/png","image/webp","image/gif"];

function normalizeGalleryImages(value,opts){
  const cover=String(opts&&opts.coverUrl||"").trim();
  const max=Number(opts&&opts.max)||MAX_GALLERY_IMAGES;
  let list=[];
  if(Array.isArray(value))list=value;
  else if(typeof value==="string"){
    const raw=value.trim();
    if(!raw||raw==="[]")list=[];
    else{
      try{
        const parsed=JSON.parse(raw);
        if(Array.isArray(parsed))list=parsed;
      }catch(e){list=[]}
    }
  }
  const out=[];
  const seen=new Set();
  list.forEach(item=>{
    const url=String(item==null?"":item).trim();
    if(!url||url.startsWith("data:"))return;
    if(/[<>"']/.test(url))return;
    if(/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)&&!/^https?:\/\//i.test(url))return;
    if(cover&&url===cover)return;
    if(seen.has(url))return;
    seen.add(url);
    out.push(url);
  });
  return out.slice(0,Math.max(0,max));
}

function planGallerySelection(currentCount,incomingCount,max){
  const cap=Number.isFinite(max)?max:MAX_GALLERY_IMAGES;
  const current=Math.max(0,Number(currentCount)||0);
  const incoming=Math.max(0,Number(incomingCount)||0);
  const room=Math.max(0,cap-current);
  if(incoming<=0)return {ok:true,take:0,skipped:0,room};
  if(incoming<=room)return {ok:true,take:incoming,skipped:0,room};
  return {ok:false,take:room,skipped:incoming-room,room};
}

function isAllowedGalleryMime(type){
  return ALLOWED_GALLERY_MIMES.indexOf(String(type||"").toLowerCase())!==-1;
}

function sniffImageMime(bytes){
  if(!bytes||bytes.length<12)return "";
  if(bytes[0]===0xFF&&bytes[1]===0xD8&&bytes[2]===0xFF)return "image/jpeg";
  if(bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4E&&bytes[3]===0x47)return "image/png";
  if(bytes[0]===0x47&&bytes[1]===0x49&&bytes[2]===0x46)return "image/gif";
  const riff=String.fromCharCode(bytes[0],bytes[1],bytes[2],bytes[3]);
  const webp=String.fromCharCode(bytes[8],bytes[9],bytes[10],bytes[11]);
  if(riff==="RIFF"&&webp==="WEBP")return "image/webp";
  return "";
}

const api={
  MAX_GALLERY_IMAGES,
  MAX_GALLERY_BYTES,
  ALLOWED_GALLERY_MIMES,
  normalizeGalleryImages,
  planGallerySelection,
  isAllowedGalleryMime,
  sniffImageMime
};

if(typeof module!=="undefined"&&module.exports)module.exports=api;
root.KutadguGallery=api;
})(typeof window!=="undefined"?window:typeof globalThis!=="undefined"?globalThis:{});
