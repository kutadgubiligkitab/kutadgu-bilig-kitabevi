(function(root){
"use strict";

function isCanonicalBookId(value){
  return /^\d+$/.test(String(value||"").trim());
}

function canonicalBookId(value){
  const s=String(value??"").trim();
  return isCanonicalBookId(s)?s:"";
}

function resolveEditBookId(editing,formId){
  return canonicalBookId(editing&&editing.id)||canonicalBookId(formId);
}

function editMustStop(editing,formId){
  return !!editing&&!resolveEditBookId(editing,formId);
}

function persistMethod(editing){
  return editing?"update":"insert";
}

function stripIdentityFields(payload){
  const out={...(payload||{})};
  delete out.id;
  delete out.created_at;
  delete out.legacy_id;
  delete out.updated_at;
  return out;
}

const api={isCanonicalBookId,canonicalBookId,resolveEditBookId,editMustStop,persistMethod,stripIdentityFields};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
root.KutadguAdminWrite=api;
})(typeof window!=="undefined"?window:typeof globalThis!=="undefined"?globalThis:{});
