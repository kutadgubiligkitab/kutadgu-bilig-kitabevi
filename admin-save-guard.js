(function(root){
"use strict";

/*
  Deadlines for the admin book-save flow.
  Storage uploads stay at 3 minutes so a large in-cap original (the WebP
  size guard may keep the original file) can finish on a slow connection.
  Database calls are shorter. None of these retry an INSERT or UPDATE.
*/
const DUPLICATE_MS=25000;
const FINGERPRINT_MS=25000;
const DHASH_PAGE_MS=45000;
const STORAGE_UPLOAD_MS=180000;
const BOOK_WRITE_MS=45000;
const CATALOG_REFRESH_MS=45000;
const IMAGE_DECODE_MS=60000;
const IMAGE_ENCODE_MS=45000;

/*
  50 MiB. Phone JPEGs are usually under 20MB, and a normal cover scan
  (including a large PNG) still fits. Anything above this is large enough
  to stall the tab during decode, and the upload is resized to 1600px anyway.
*/
const MAX_COVER_BYTES=50*1024*1024;

const STATUS={
  duplicates:"تەكرارلىق تەكشۈرۈلىۋاتىدۇ...",
  cover:"مۇقاۋا تەكشۈرۈلىۋاتىدۇ...",
  coverPage:function(page){return "مۇقاۋا سېلىشتۇرۇلىۋاتىدۇ (بەت "+page+")...";},
  prepare:"مۇقاۋا رەسىمى تەييارلىنىۋاتىدۇ...",
  uploadCover:"مۇقاۋا يوللىنىۋاتىدۇ...",
  gallery:function(n,m){return "قوشۇمچە رەسىم يوللىنىۋاتىدۇ: "+n+" / "+m;},
  saving:"كىتاب ساقلىنىۋاتىدۇ...",
  saved:"كىتاب ساقلاندى.",
  refresh:"تىزىملىك يېڭىلىنىۋاتىدۇ...",
  confirm:"ئوخشاش مۇقاۋا جەزملەنمىسى كۈتۈلىۋاتىدۇ...",
  refreshFailed:"كىتاب ساقلاندى، لېكىن تىزىملىك يېڭىلانمىدى. ساقلاش تاماملانغان."
};

const WRITE_TIMEOUT_MESSAGE="ساقلاش ۋاقتى ئېشىپ كەتتى. كىتاب تىزىملىكىنى تەكشۈرۈپ ئاندىن قايتا ساقلاڭ. مۇلازىمېتىر يېزىشنى تاماملىغان بولۇشى مۇمكىن.";

function timeoutError(step){
  const err=new Error(step==="write"?WRITE_TIMEOUT_MESSAGE:"مەشغۇلات ۋاقتى ئېشىپ كەتتى.");
  err.code="save-timeout";
  err.name="TimeoutError";
  err.step=step||"";
  return err;
}

function withTimeout(work,ms,step){
  if(typeof work!=="function")return Promise.reject(new Error("timeout work missing"));
  const timeoutMs=Number(ms);
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0){
    return Promise.resolve().then(function(){return work(undefined);});
  }
  const Controller=typeof AbortController==="function"?AbortController:null;
  const controller=Controller?new Controller():null;
  let timer=null;
  let settled=false;
  return new Promise(function(resolve,reject){
    timer=setTimeout(function(){
      if(settled)return;
      settled=true;
      if(controller){
        try{controller.abort();}catch(e){}
      }
      reject(timeoutError(step));
    },timeoutMs);
    Promise.resolve().then(function(){
      return work(controller?controller.signal:undefined);
    }).then(function(value){
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      resolve(value);
    },function(err){
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      if(controller){
        try{controller.abort();}catch(e){}
      }
      reject(err);
    });
  });
}

function isSaveTimeout(err){
  return !!(err&&(err.code==="save-timeout"||err.name==="TimeoutError"));
}

function applyAbort(query,signal){
  if(signal&&query&&typeof query.abortSignal==="function")return query.abortSignal(signal);
  return query;
}

const api={
  DUPLICATE_MS:DUPLICATE_MS,
  FINGERPRINT_MS:FINGERPRINT_MS,
  DHASH_PAGE_MS:DHASH_PAGE_MS,
  STORAGE_UPLOAD_MS:STORAGE_UPLOAD_MS,
  BOOK_WRITE_MS:BOOK_WRITE_MS,
  CATALOG_REFRESH_MS:CATALOG_REFRESH_MS,
  IMAGE_DECODE_MS:IMAGE_DECODE_MS,
  IMAGE_ENCODE_MS:IMAGE_ENCODE_MS,
  MAX_COVER_BYTES:MAX_COVER_BYTES,
  STATUS:STATUS,
  WRITE_TIMEOUT_MESSAGE:WRITE_TIMEOUT_MESSAGE,
  withTimeout:withTimeout,
  isSaveTimeout:isSaveTimeout,
  applyAbort:applyAbort
};

if(typeof module!=="undefined"&&module.exports)module.exports=api;
root.KutadguAdminSaveGuard=api;
})(typeof window!=="undefined"?window:typeof globalThis!=="undefined"?globalThis:{});
