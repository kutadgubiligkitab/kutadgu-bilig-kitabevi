(function(root){
"use strict";

function collectInactiveKeys(rows){
  const keys=new Set();
  (rows||[]).forEach(row=>{
    if(!row)return;
    const id=String(row.id??"").trim();
    const legacy=String(row.legacy_id??row.legacyId??"").trim();
    if(id)keys.add(id);
    if(legacy)keys.add(legacy);
  });
  return keys;
}

function bookIdentityKeys(book){
  if(!book)return [];
  return [book.id,book.legacyId,book.legacy_id]
    .map(value=>String(value||"").trim())
    .filter(Boolean);
}

function isStorefrontVisible(book,ctx){
  const remoteAvailable=!!(ctx&&ctx.remoteAvailable);
  const inactiveKeys=ctx&&ctx.inactiveKeys?ctx.inactiveKeys:new Set();
  if(!book||!String(book.id||"").trim())return false;
  if(book.isActive===false||book.is_active===false)return false;
  if(remoteAvailable){
    for(const key of bookIdentityKeys(book)){
      if(inactiveKeys.has(key))return false;
    }
  }
  return true;
}

async function loadInactiveKeysPaged(fetchPage,options){
  const pageSize=Math.max(1,(options&&options.pageSize)||1000);
  const maxPages=Math.max(1,(options&&options.maxPages)||100000);
  const keys=new Set();
  let from=0;
  for(let n=0;n<maxPages;n++){
    const to=from+pageSize-1;
    const rows=await fetchPage(from,to);
    if(!Array.isArray(rows)||!rows.length)break;
    collectInactiveKeys(rows).forEach(key=>keys.add(key));
    if(rows.length<pageSize)break;
    from+=pageSize;
  }
  return keys;
}

const api={collectInactiveKeys,bookIdentityKeys,isStorefrontVisible,loadInactiveKeysPaged};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
root.KutadguVisibility=api;
})(typeof window!=="undefined"?window:typeof globalThis!=="undefined"?globalThis:{});
