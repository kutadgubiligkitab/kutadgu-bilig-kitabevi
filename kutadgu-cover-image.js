(function(root){
"use strict";

/*
  New cover and gallery uploads only.
  Longest edge 1600px: the lightbox never draws wider than 760 CSS pixels
  (shop.css .cover-zoom-overlay img), so 1600 covers a 2x retina zoom with
  a little room and stays near 3x the 560px mobile detail image. Card size
  is not the cap. Images already smaller than 1600 are not enlarged.
  WebP quality 0.92 keeps Uyghur, Chinese, and Latin print and fine line art
  readable. GIF is left untouched so animation is not flattened.
*/
const MAX_EDGE=1600;
const WEBP_QUALITY=0.92;
const CACHE_CONTROL="public, max-age=31536000, immutable";
const CONVERTIBLE={"image/jpeg":true,"image/png":true,"image/webp":true};

function fitDimensions(width,height,maxEdge){
  const w=Math.max(0,Math.round(Number(width)||0));
  const h=Math.max(0,Math.round(Number(height)||0));
  const cap=Math.max(1,Math.round(Number(maxEdge)||MAX_EDGE));
  if(w<1||h<1)return {width:w,height:h,scale:1,capped:false};
  const scale=Math.min(1,cap/Math.max(w,h));
  return {
    width:Math.max(1,Math.round(w*scale)),
    height:Math.max(1,Math.round(h*scale)),
    scale:scale,
    capped:scale<1
  };
}

function uniqueStorageStamp(){
  return Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,10);
}

function outputName(file){
  const raw=String(file&&file.name||"cover");
  const base=raw.replace(/\.[^.\\/]+$/,"")||"cover";
  const clean=base.replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"")||"cover";
  return clean+".webp";
}

function canvasToBlob(canvas,type,quality){
  return new Promise(function(resolve,reject){
    try{
      canvas.toBlob(function(blob){resolve(blob||null);},type,quality);
    }catch(error){
      reject(error);
    }
  });
}

function canvasHasTransparency(ctx,width,height){
  const data=ctx.getImageData(0,0,width,height).data;
  for(let i=3;i<data.length;i+=4){
    if(data[i]<250)return true;
  }
  return false;
}

async function isUsableWebpBlob(blob){
  if(!blob||blob.size<12)return false;
  if(blob.type&&blob.type!=="image/webp")return false;
  const bytes=new Uint8Array(await blob.slice(0,12).arrayBuffer());
  return bytes[0]===0x52&&bytes[1]===0x49&&bytes[2]===0x46&&bytes[3]===0x46&&bytes[8]===0x57&&bytes[9]===0x45&&bytes[10]===0x42&&bytes[11]===0x50;
}

async function webpKeepsTransparency(blob){
  const decoded=await createImageBitmap(blob);
  try{
    const canvas=document.createElement("canvas");
    canvas.width=decoded.width;
    canvas.height=decoded.height;
    const ctx=canvas.getContext("2d",{alpha:true});
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(decoded,0,0);
    return canvasHasTransparency(ctx,canvas.width,canvas.height);
  }finally{
    decoded.close&&decoded.close();
  }
}

function fallbackOriginal(file,mime,fit,transparent){
  if(fit.capped){
    throw new Error(transparent?"سۈزۈك رەسىمنى سۈزۈكلۈكىنى يوقاتماي كىچىكلىتەلمىدى. يوللانمىدى.":"رەسىم WebP قىلىپ ئايلاندۇرۇلمىدى. يوللانمىدى.");
  }
  if(transparent&&mime!=="image/png"&&mime!=="image/webp"){
    throw new Error("سۈزۈك رەسىمنى سۈزۈكلۈكىنى يوقاتماي ساقلىغىلى بولمىدى.");
  }
  return file;
}

async function optimizeUploadImage(file){
  if(!file)return file;
  const mime=String(file.type||"").toLowerCase();
  if(!mime.startsWith("image/"))return file;
  if(mime==="image/gif")return file;
  if(mime==="image/svg+xml")throw new Error("SVG رەسىم يوللانمايدۇ.");
  if(!CONVERTIBLE[mime])throw new Error("بۇ رەسىم شەكلى قوللانمايدۇ. JPEG، PNG ياكى WebP يوللاڭ.");
  if(typeof createImageBitmap!=="function"||typeof document==="undefined"){
    throw new Error("بۇ browser رەسىمنى ئايلاندۇرالمايدۇ.");
  }
  let bitmap;
  try{
    bitmap=await createImageBitmap(file);
  }catch(error){
    throw new Error("رەسىم ئوقۇلمىدى. بۇزۇلغان ھۆججەت يوللانمايدۇ.");
  }
  try{
    if(!bitmap.width||!bitmap.height)throw new Error("رەسىم ئوقۇلمىدى. بۇزۇلغان ھۆججەت يوللانمايدۇ.");
    const fit=fitDimensions(bitmap.width,bitmap.height,MAX_EDGE);
    if(mime==="image/webp"&&!fit.capped)return file;
    const canvas=document.createElement("canvas");
    canvas.width=fit.width;
    canvas.height=fit.height;
    const wantsAlpha=mime!=="image/jpeg";
    const ctx=canvas.getContext("2d",{alpha:wantsAlpha});
    if(!ctx)throw new Error("رەسىم ئايلاندۇرۇلمىدى.");
    if(wantsAlpha)ctx.clearRect(0,0,fit.width,fit.height);
    ctx.drawImage(bitmap,0,0,fit.width,fit.height);
    const transparent=wantsAlpha&&canvasHasTransparency(ctx,fit.width,fit.height);
    let blob=null;
    try{blob=await canvasToBlob(canvas,"image/webp",WEBP_QUALITY);}catch(error){blob=null;}
    if(!(await isUsableWebpBlob(blob)))return fallbackOriginal(file,mime,fit,transparent);
    if(transparent){
      let kept=false;
      try{kept=await webpKeepsTransparency(blob);}catch(error){kept=false;}
      if(!kept)return fallbackOriginal(file,mime,fit,true);
    }
    return new File([blob],outputName(file),{type:"image/webp"});
  }finally{
    bitmap.close&&bitmap.close();
  }
}

async function prepareStorageUpload(file){
  if(!file||typeof file.arrayBuffer!=="function")throw new Error("رەسىم ھۆججىتى تەييار ئەمەس.");
  const body=await file.arrayBuffer();
  if(!body||typeof body.byteLength!=="number"||body.byteLength<1)throw new Error("بوش رەسىم يوللانمايدۇ.");
  if(typeof Blob!=="undefined"&&body instanceof Blob)throw new Error("رەسىم يوللاش شەكلى توغرا ئەمەس.");
  const options={
    upsert:false,
    contentType:String(file.type||"application/octet-stream"),
    cacheControl:"31536000",
    headers:{"cache-control":CACHE_CONTROL}
  };
  if(cacheControlStoredBySupabase(body,options)!==CACHE_CONTROL){
    throw new Error("رەسىم غەملەك باشلىقى توغرا يوللانمايدۇ.");
  }
  return {body:body,options:options};
}

function cacheControlStoredBySupabase(body,options){
  const opts=options||{};
  const isBlob=typeof Blob!=="undefined"&&body instanceof Blob;
  if(isBlob){
    const field=opts.cacheControl==null?"":String(opts.cacheControl);
    return field?"max-age="+field:"no-cache";
  }
  const headers=Object.assign({
    "cache-control":"max-age="+String(opts.cacheControl==null?"":opts.cacheControl)
  },opts.headers||{});
  return String(headers["cache-control"]||"");
}

const api={
  MAX_EDGE:MAX_EDGE,
  WEBP_QUALITY:WEBP_QUALITY,
  CACHE_CONTROL:CACHE_CONTROL,
  fitDimensions:fitDimensions,
  uniqueStorageStamp:uniqueStorageStamp,
  optimizeUploadImage:optimizeUploadImage,
  prepareStorageUpload:prepareStorageUpload,
  cacheControlStoredBySupabase:cacheControlStoredBySupabase
};

if(typeof module!=="undefined"&&module.exports)module.exports=api;
root.KutadguCoverImage=api;
})(typeof window!=="undefined"?window:typeof globalThis!=="undefined"?globalThis:{});
