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

test("production static romanlar-2 with no remote mapping is not sellable",()=>{
  const staticDemo={id:"romanlar-2",isActive:true,isRemote:false,price:200};
  assert.strictEqual(V.isStorefrontVisible(staticDemo,{requireRemoteAuthority:true,remoteAvailable:true,inactiveKeys:new Set()}),false);
  assert.strictEqual(V.isStorefrontVisible(staticDemo,{production:true,remoteAvailable:false,inactiveKeys:new Set()}),false);
});

test("real active numeric remote book stays visible",()=>{
  const remote={id:"123",isActive:true,isRemote:true,legacyId:"old-slug"};
  assert.strictEqual(V.isStorefrontVisible(remote,{requireRemoteAuthority:true,remoteAvailable:true,inactiveKeys:new Set()}),true);
});

test("future remote legacy mapping resolves through the canonical remote book",()=>{
  const mapped={id:"123",legacyId:"old-slug",isActive:true,isRemote:true};
  assert.strictEqual(V.isStorefrontVisible(mapped,{requireRemoteAuthority:true,remoteAvailable:true,inactiveKeys:new Set()}),true);
  assert.strictEqual(V.isCanonicalBookId(mapped.id),true);
  assert.strictEqual(V.isRemoteProvenance(mapped),true);
});

test("inactive remote mapped book is not sellable",()=>{
  const inactive=V.collectInactiveKeys([{id:123,legacy_id:"old-slug"}]);
  const remote={id:"123",legacyId:"old-slug",isActive:false,isRemote:true};
  assert.strictEqual(V.isStorefrontVisible(remote,{requireRemoteAuthority:true,remoteAvailable:true,inactiveKeys:inactive}),false);
  const staticClone={id:"old-slug",isActive:true,isRemote:false};
  assert.strictEqual(V.isStorefrontVisible(staticClone,{requireRemoteAuthority:true,remoteAvailable:true,inactiveKeys:inactive}),false);
});

test("static clone is suppressed when remote inactive keys include legacy_id",()=>{
  const inactive=V.collectInactiveKeys([{id:123,legacy_id:"romanlar-2"}]);
  assert.ok(inactive.has("123"));
  assert.ok(inactive.has("romanlar-2"));
  const staticClone={id:"romanlar-2",legacyId:"",isActive:true};
  assert.strictEqual(V.isStorefrontVisible(staticClone,{remoteAvailable:true,inactiveKeys:inactive}),false);
});

test("unrelated active remote book stays visible",()=>{
  const inactive=V.collectInactiveKeys([{id:123,legacy_id:"romanlar-2"}]);
  assert.strictEqual(V.isStorefrontVisible({id:"5",legacyId:"romanlar-5",isActive:true,isRemote:true},{remoteAvailable:true,inactiveKeys:inactive}),true);
});

test("production supabase unavailable does not expose static demo fallback",()=>{
  const inactive=V.collectInactiveKeys([{id:123,legacy_id:"romanlar-2"}]);
  assert.strictEqual(V.isStorefrontVisible({id:"romanlar-2",isActive:true},{requireRemoteAuthority:true,remoteAvailable:false,inactiveKeys:inactive}),false);
});

test("local fixture static remains visible when remote authority is not required",()=>{
  const inactive=V.collectInactiveKeys([{id:123,legacy_id:"romanlar-2"}]);
  assert.strictEqual(V.isStorefrontVisible({id:"romanlar-2",isActive:true},{remoteAvailable:false,inactiveKeys:inactive}),true);
});

test("empty inactive index does not keep static demo sellable when remote is up",()=>{
  const inactive=V.collectInactiveKeys([]);
  assert.strictEqual(V.isStorefrontVisible({id:"romanlar-2",isActive:true},{remoteAvailable:true,inactiveKeys:inactive}),false);
  assert.strictEqual(V.isStorefrontVisible({id:"88",isActive:true,isRemote:true},{remoteAvailable:true,inactiveKeys:inactive}),true);
});

test("remote inactive id hides matching static clone even if clone isActive true",()=>{
  const inactive=V.collectInactiveKeys([{id:"88",legacy_id:"sheirlar-1"}]);
  assert.strictEqual(V.isStorefrontVisible({id:"sheirlar-1",legacyId:"",isActive:true},{remoteAvailable:true,inactiveKeys:inactive}),false);
  assert.strictEqual(V.isStorefrontVisible({id:"88",legacyId:"sheirlar-1",isActive:false},{remoteAvailable:true,inactiveKeys:inactive}),false);
});

if(failed){
  console.error("\n"+failed+" test(s) failed");
  process.exit(1);
}
console.log("All visibility tests passed");
