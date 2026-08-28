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

if(failed)process.exit(1);
console.log("All admin save tests passed");
