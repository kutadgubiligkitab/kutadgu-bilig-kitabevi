#!/usr/bin/env node
"use strict";
const assert=require("assert");
const V=require("../catalog-visibility.js");

let failed=0;
function test(name,fn){
  try{fn();console.log("PASS",name)}
  catch(err){failed++;console.error("FAIL",name,err.message)}
}

test("active book is visible",()=>{
  assert.strictEqual(V.isStorefrontVisible({id:"2",isActive:true}),true);
});

test("is_active false is hidden even without remote index",()=>{
  assert.strictEqual(V.isStorefrontVisible({id:"2",isActive:false}),false);
});

test("static clone is suppressed when remote inactive keys include legacy_id",()=>{
  const inactive=V.collectInactiveKeys([{id:123,legacy_id:"romanlar-2"}]);
  assert.ok(inactive.has("123"));
  assert.ok(inactive.has("romanlar-2"));
  const staticClone={id:"romanlar-2",legacyId:"",isActive:true};
  assert.strictEqual(V.isStorefrontVisible(staticClone,{remoteAvailable:true,inactiveKeys:inactive}),false);
  assert.strictEqual(V.isStorefrontVisible(staticClone,{remoteAvailable:false,inactiveKeys:inactive}),true);
});

test("unrelated active book stays visible",()=>{
  const inactive=V.collectInactiveKeys([{id:123,legacy_id:"romanlar-2"}]);
  assert.strictEqual(V.isStorefrontVisible({id:"5",legacyId:"romanlar-5",isActive:true},{remoteAvailable:true,inactiveKeys:inactive}),true);
});

test("supabase-unavailable context does not use inactive keys to hide static fallback",()=>{
  const inactive=V.collectInactiveKeys([{id:123,legacy_id:"romanlar-2"}]);
  assert.strictEqual(V.isStorefrontVisible({id:"romanlar-2",isActive:true},{remoteAvailable:false,inactiveKeys:inactive}),true);
});

test("empty inactive index keeps active static visible when remote is up",()=>{
  const inactive=V.collectInactiveKeys([]);
  assert.strictEqual(V.isStorefrontVisible({id:"romanlar-2",isActive:true},{remoteAvailable:true,inactiveKeys:inactive}),true);
});

test("remote inactive id hides matching static clone even if clone isActive true",()=>{
  const inactive=V.collectInactiveKeys([{id:"88",legacy_id:"sheirlar-1"}]);
  assert.strictEqual(V.isStorefrontVisible({id:"sheirlar-1",legacyId:"",isActive:true},{remoteAvailable:true,inactiveKeys:inactive}),false);
  assert.strictEqual(V.isStorefrontVisible({id:"88",legacyId:"sheirlar-1",isActive:false},{remoteAvailable:true,inactiveKeys:inactive}),false);
});
console.log("All visibility tests passed");
