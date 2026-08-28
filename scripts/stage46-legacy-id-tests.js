#!/usr/bin/env node
"use strict";
const fs=require("fs");
const path=require("path");
const assert=require("assert");
const {createHash}=require("crypto");
const Legacy=require("../legacy-id-utils.js");

const root=path.join(__dirname,"..");
let failed=0;
function test(name,fn){
  try{fn();console.log("PASS",name)}
  catch(err){failed++;console.error("FAIL",name,err.message)}
}

const books=[
  {id:"101",legacyId:"ozumuzni-etirap-qilayli",title:"A"},
  {id:"102",legacyId:"romanlar-2",title:"B"}
];
const resolve=id=>{
  const hit=books.find(b=>b.id===String(id)||b.legacyId===String(id));
  return hit?hit.id:String(id);
};

test("A only legacy cart id resolves to canonical",()=>{
  const out=Legacy.migrateCartItems([{id:"ozumuzni-etirap-qilayli",qty:2}],resolve);
  assert.deepStrictEqual(out,[{id:"101",qty:2}]);
});

test("B legacy + canonical cart lines merge without summing",()=>{
  const out=Legacy.migrateCartItems([
    {id:"ozumuzni-etirap-qilayli",qty:1},
    {id:"101",qty:2}
  ],resolve);
  assert.strictEqual(out.length,1);
  assert.strictEqual(out[0].id,"101");
  assert.strictEqual(out[0].qty,2);
});

test("C old favorite slug maps and dedupes",()=>{
  const out=Legacy.migrateIdList(["romanlar-2","102","romanlar-2"],resolve);
  assert.deepStrictEqual(out,["102"]);
});

test("D recently viewed slug resolves and keeps order/limit",()=>{
  const out=Legacy.migrateIdList(
    ["ozumuzni-etirap-qilayli","romanlar-2","101","unknown-old"],
    resolve,
    {limit:12}
  );
  assert.deepStrictEqual(out,["101","102","unknown-old"]);
});

test("E/F lookup split never sends slug to bigint id",()=>{
  const split=Legacy.splitLookupIds(["ozumuzni-etirap-qilayli","101","romanlar-2"]);
  assert.deepStrictEqual(split.numeric,["101"]);
  assert.deepStrictEqual(split.legacy,["ozumuzni-etirap-qilayli","romanlar-2"]);
  assert.strictEqual(Legacy.isCanonicalBookId("ozumuzni-etirap-qilayli"),false);
  assert.strictEqual(Legacy.isCanonicalBookId("101"),true);
});

test("G unique visible catalog has one object per canonical id",()=>{
  const staticCopy={id:"ozumuzni-etirap-qilayli",title:"A-static"};
  const remote={id:"101",legacyId:"ozumuzni-etirap-qilayli",title:"A-remote"};
  const visible=Legacy.uniqueVisibleBooks([staticCopy,remote,remote]);
  assert.strictEqual(visible.length,2);
  const remoteOnly=Legacy.uniqueVisibleBooks([remote,remote]);
  assert.strictEqual(remoteOnly.length,1);
  assert.strictEqual(remoteOnly[0].id,"101");
});

test("H unresolved old ID is preserved",()=>{
  const cart=Legacy.migrateCartItems([{id:"ghost-slug",qty:4},{id:"101",qty:1}],resolve);
  assert.deepStrictEqual(cart,[{id:"ghost-slug",qty:4},{id:"101",qty:1}]);
  const fav=Legacy.migrateIdList(["ghost-slug","romanlar-2"],resolve);
  assert.deepStrictEqual(fav,["ghost-slug","102"]);
});

test("I inactive/zero active rows do not flip storefront",()=>{
  assert.strictEqual(Legacy.remoteAvailableFromActiveCount(0),false);
  assert.strictEqual(Legacy.remoteAvailableFromActiveCount(83),true);
  assert.strictEqual(Legacy.remoteAvailableFromActiveCount(84),true);
});

test("J activation guard count != 84 refuses",()=>{
  const g=Legacy.activationGuard(83,84);
  assert.strictEqual(g.ok,false);
  assert.strictEqual(g.activate,false);
});

test("K activation guard count == 84 would activate",()=>{
  const g=Legacy.activationGuard(84,84);
  assert.strictEqual(g.ok,true);
  assert.strictEqual(g.activate,true);
});

test("CSV: 84 legacy_id rows, is_active false, covers unchanged, price 0 kept",()=>{
  const text=fs.readFileSync(path.join(root,"CURRENT_CATALOG_TO_SUPABASE.csv"),"utf8");
  const lines=text.replace(/^\uFEFF/,"").trim().split(/\n/);
  const header=lines[0].split(",");
  assert.ok(header.includes("legacy_id"));
  assert.ok(!header.includes("id"));
  assert.strictEqual(lines.length-1,84);
  const idx=Object.fromEntries(header.map((h,i)=>[h,i]));
  const legacy=new Set();
  let zero=0,activeTrue=0;
  lines.slice(1).forEach(line=>{
    const cols=parseCsvLine(line);
    const id=cols[idx.legacy_id];
    assert.ok(id&&id.trim()===id);
    assert.ok(!legacy.has(id),id);
    legacy.add(id);
    assert.strictEqual(cols[idx.is_active],"false");
    assert.strictEqual(cols[idx.image_url],"sample-book-cover.png");
    if(cols[idx.price]==="0")zero++;
    if(cols[idx.is_active]==="true")activeTrue++;
  });
  assert.strictEqual(legacy.size,84);
  assert.strictEqual(zero,36);
  assert.strictEqual(activeTrue,0);
});

test("SQL files exist, are not executed here, and contain guards",()=>{
  const legacy=fs.readFileSync(path.join(root,"STAGE45_LEGACY_ID_MIGRATION.sql"),"utf8");
  assert.ok(/add column if not exists legacy_id text/i.test(legacy));
  assert.ok(/books_legacy_id_unique_idx/.test(legacy));
  assert.ok(!/update public\.books/i.test(legacy));
  const act=fs.readFileSync(path.join(root,"STAGE45_ACTIVATE_MIGRATED_CATALOG.sql"),"utf8");
  assert.ok(/v_expected integer := 84/.test(act));
  assert.ok(/activation refused/.test(act));
  assert.ok(/is_active = true/.test(act));
  const an=fs.readFileSync(path.join(root,"STAGE46_ANALYTICS_LEGACY_ID.sql"),"utf8");
  assert.ok(/b\.legacy_id = e\.book_id/.test(an));
  assert.ok(/b\.id::text = e\.book_id/.test(an));
});

test("sample-book-cover.png bytes unchanged",()=>{
  const buf=fs.readFileSync(path.join(root,"sample-book-cover.png"));
  const md5=createHash("md5").update(buf).digest("hex");
  assert.strictEqual(md5,"ec1cbc43beb79299dfb8484451dabaed");
});

test("trim legacy_id only, do not rewrite spelling",()=>{
  assert.strictEqual(Legacy.trimLegacyId("  romanlar-2  "),"romanlar-2");
  assert.strictEqual(Legacy.trimLegacyId("Romanlar-2"),"Romanlar-2");
});

function parseCsvLine(line){
  const out=[];let cur="",q=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(q){
      if(ch==='"'){if(line[i+1]==='"'){cur+='"';i++;}else q=false;}
      else cur+=ch;
    }else if(ch==='"')q=true;
    else if(ch===","){out.push(cur);cur=""}
    else cur+=ch;
  }
  out.push(cur);
  return out;
}

if(failed){
  console.error("\n"+failed+" test(s) failed");
  process.exit(1);
}
console.log("\nAll Stage 4.6 local tests passed");
