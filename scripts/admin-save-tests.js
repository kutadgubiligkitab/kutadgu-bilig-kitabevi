#!/usr/bin/env node
"use strict";
const assert=require("assert");
const W=require("../admin-book-write.js");

let failed=0;
function test(name,fn){
  try{fn();console.log("PASS",name)}
  catch(err){failed++;console.error("FAIL",name,err.message)}
}

test("canonical bigint ids are accepted",()=>{
  assert.strictEqual(W.isCanonicalBookId("1"),true);
  assert.strictEqual(W.isCanonicalBookId(99),true);
  assert.strictEqual(W.isCanonicalBookId("book-lxyz"),false);
  assert.strictEqual(W.canonicalBookId(" 83 "),"83");
});

test("edit without bigint id must stop and never insert",()=>{
  assert.strictEqual(W.editMustStop({id:""},""),true);
  assert.strictEqual(W.editMustStop({id:"book-abc"},"book-abc"),true);
  assert.strictEqual(W.editMustStop({id:1},"1"),false);
  assert.strictEqual(W.persistMethod({id:1}),"update");
  assert.strictEqual(W.persistMethod(null),"insert");
});

test("edit id prefers editing record over form fallback",()=>{
  assert.strictEqual(W.resolveEditBookId({id:96},"99"),"96");
  assert.strictEqual(W.resolveEditBookId(null,"96"),"96");
});

test("update payload never carries identity columns",()=>{
  const stripped=W.stripIdentityFields({
    id:1,legacy_id:"ozumuzni-etirap-qilayli",created_at:"2026-08-27",updated_at:"2026-08-28",
    title:"ت",price:888
  });
  assert.strictEqual("id" in stripped,false);
  assert.strictEqual("legacy_id" in stripped,false);
  assert.strictEqual("created_at" in stripped,false);
  assert.strictEqual("updated_at" in stripped,false);
  assert.strictEqual(stripped.price,888);
});

test("create path is insert, edit path is update",()=>{
  assert.notStrictEqual(W.persistMethod({id:1}),"insert");
  assert.strictEqual(W.persistMethod(undefined),"insert");
});

test("PR13 hole: editing=null but #bookId=2 is UPDATE not INSERT",()=>{
  const plan=W.planBookSave(null,"2","create");
  assert.strictEqual(plan.operation,"UPDATE");
  assert.strictEqual(plan.editingBookId,"2");
  assert.strictEqual(W.enforcePersistOperation("INSERT","2"),"UPDATE");
  const req=W.persistRequest("INSERT","2");
  assert.strictEqual(req.method,"PATCH");
  assert.strictEqual(req.filter,"id=eq.2");
});

test("openEdit id 2 plans PATCH books?id=eq.2",()=>{
  const plan=W.planBookSave({id:2},"2","edit");
  assert.deepStrictEqual(plan,{mode:"edit",editingBookId:"2",operation:"UPDATE"});
  const req=W.persistRequest(plan.operation,plan.editingBookId);
  assert.strictEqual(req.method,"PATCH");
  assert.strictEqual(req.table,"books");
  assert.strictEqual(req.filter,"id=eq.2");
  assert.notStrictEqual(req.method,"POST");
});

test("new book slug never inserts via update and never carries canonical id",()=>{
  const plan=W.planBookSave(null,"book-lxyz","create");
  assert.strictEqual(plan.operation,"INSERT");
  assert.strictEqual(plan.editingBookId,"");
  const req=W.persistRequest(plan.operation,plan.editingBookId);
  assert.strictEqual(req.method,"POST");
  assert.strictEqual(req.filter,"");
});

test("edit mode without id stops instead of inserting",()=>{
  const plan=W.planBookSave({id:"book-abc"},"book-abc","edit");
  assert.strictEqual(plan.operation,"STOP");
  assert.strictEqual(W.enforcePersistOperation("UPDATE",""),"STOP");
});

test("second edit of same id still PATCH eq.2",()=>{
  const first=W.persistRequest("UPDATE","2");
  const second=W.persistRequest("UPDATE","2");
  assert.strictEqual(first.filter,"id=eq.2");
  assert.strictEqual(second.filter,"id=eq.2");
  assert.strictEqual(first.method,"PATCH");
  assert.strictEqual(second.method,"PATCH");
});

if(failed)process.exit(1);
console.log("All admin save tests passed");
