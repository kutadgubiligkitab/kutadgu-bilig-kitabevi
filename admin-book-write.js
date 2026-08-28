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

function editMustStop(editing,formId,formMode){
  return planBookSave(editing,formId,formMode).operation==="STOP";
}

function persistMethod(editing,formId,formMode){
  const op=planBookSave(editing,formId,formMode).operation;
  return op==="UPDATE"?"update":(op==="INSERT"?"insert":op);
}

function planBookSave(editing,formId,formMode){
  const editingBookId=resolveEditBookId(editing,formId);
  const markedEdit=String(formMode||"").toLowerCase()==="edit"||!!editing;
  if(markedEdit){
    if(!editingBookId){
      return {mode:"edit",editingBookId:"",operation:"STOP"};
    }
    return {mode:"edit",editingBookId,operation:"UPDATE"};
  }
  if(editingBookId){
    return {mode:"edit",editingBookId,operation:"UPDATE"};
  }
  return {mode:"create",editingBookId:"",operation:"INSERT"};
}

function enforcePersistOperation(operation,editingBookId){
  const id=canonicalBookId(editingBookId);
  const op=String(operation||"").toUpperCase();
  if(op==="STOP")return "STOP";
  if(id)return "UPDATE";
  if(op==="UPDATE")return "STOP";
  return "INSERT";
}

function persistRequest(operation,editingBookId){
  const op=enforcePersistOperation(operation,editingBookId);
  if(op==="UPDATE"){
    return {operation:"UPDATE",method:"PATCH",table:"books",filter:`id=eq.${canonicalBookId(editingBookId)}`};
  }
  if(op==="INSERT"){
    return {operation:"INSERT",method:"POST",table:"books",filter:""};
  }
  return {operation:"STOP",method:"",table:"",filter:""};
}

function stripIdentityFields(payload){
  const out={...(payload||{})};
  delete out.id;
  delete out.created_at;
  delete out.legacy_id;
  delete out.updated_at;
  return out;
}

const api={
  isCanonicalBookId,
  canonicalBookId,
  resolveEditBookId,
  editMustStop,
  persistMethod,
  planBookSave,
  enforcePersistOperation,
  persistRequest,
  stripIdentityFields
};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
root.KutadguAdminWrite=api;
})(typeof window!=="undefined"?window:typeof globalThis!=="undefined"?globalThis:{});
