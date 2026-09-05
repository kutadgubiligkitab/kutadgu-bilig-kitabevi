#!/usr/bin/env node
"use strict";
const assert=require("assert");
const fs=require("fs");
const path=require("path");
const Orig=require("../admin-original-price.js");
const Price=require("../admin-bulk-price.js");
const Prod=require("../admin-catalog-productivity.js");

let failed=0;
function test(name,fn){
  try{fn();console.log("PASS",name)}
  catch(err){failed++;console.error("FAIL",name,err.message)}
}
async function testAsync(name,fn){
  try{await fn();console.log("PASS",name)}
  catch(err){failed++;console.error("FAIL",name,err.message)}
}

const root=path.join(__dirname,"..");
function read(rel){return fs.readFileSync(path.join(root,rel),"utf8")}

const catalog=[
  {id:1,title:"كىتاب A",price:135,original_price:100,source:"universal.html"},
  {id:2,title:"Beta",price:200,original_price:200,source:"universal.html"},
  {id:3,title:"Gamma",price:20,original_price:15,source:"romanlar.html"},
  {id:4,title:"ZeroOrig",price:10,original_price:0,source:"universal.html"},
  {id:5,title:"MissingOrig",price:0,original_price:null,source:"universal.html"},
  {id:6,title:"BlankOrig",price:50,original_price:"",source:"dini.html"},
  {id:7,title:"Same",price:80,original_price:80,source:"universal.html"},
  {id:8,title:"PageTwo",price:50,original_price:40,source:"universal.html"}
];

test("migration is nullable, no default, and does not backfill price",()=>{
  const sql=read("STAGE64_ORIGINAL_PRICE.sql");
  const setup=read("SUPABASE_SETUP.sql");
  assert.match(sql,/ADD COLUMN IF NOT EXISTS original_price numeric\(12,2\)/);
  assert.match(sql,/ALTER COLUMN original_price DROP NOT NULL/);
  assert.match(sql,/ALTER COLUMN original_price DROP DEFAULT/);
  assert.match(sql,/original_price IS NULL OR original_price >= 0/);
  assert.doesNotMatch(sql,/\bUPDATE\s+public\.books\b/i);
  assert.doesNotMatch(sql,/price\s*=\s*original_price|original_price\s*=\s*price/i);
  assert.doesNotMatch(sql,/DEFAULT\s+0/);
  assert.doesNotMatch(setup,/original_price\s*=\s*price/i);
  assert.doesNotMatch(setup,/SET\s+original_price\s*=/i);
  assert.match(setup,/original_price numeric\(12,2\)/);
});

test("new book insert plan copies valid price once, including 0",()=>{
  assert.deepStrictEqual(Orig.planInsertOriginalPrice(150),{include:true,original_price:150});
  assert.deepStrictEqual(Orig.planInsertOriginalPrice(0),{include:true,original_price:0});
  assert.deepStrictEqual(Orig.planInsertOriginalPrice(null),{include:true,original_price:null});
  assert.deepStrictEqual(Orig.planInsertOriginalPrice(""),{include:true,original_price:null});
  assert.deepStrictEqual(Orig.planInsertOriginalPrice(-5),{include:true,original_price:null});
});

test("existing NULL original_price initializes only when the manual Edit price actually changed",()=>{
  const changed=Orig.planUpdateOriginalPrice(null,125,0);
  assert.deepStrictEqual(changed,{include:true,original_price:125});
  const fromMissing=Orig.planUpdateOriginalPrice(null,125,null);
  assert.deepStrictEqual(fromMissing,{include:true,original_price:125});
  const toZero=Orig.planUpdateOriginalPrice(null,0,null);
  assert.deepStrictEqual(toZero,{include:true,original_price:0});
  const skipInvalid=Orig.planUpdateOriginalPrice(null,null,0);
  assert.deepStrictEqual(skipInvalid,{include:false});
});

test("unrelated Edit save does not initialize NULL original_price from the loaded price",()=>{
  assert.deepStrictEqual(Orig.planUpdateOriginalPrice(null,0,0),{include:false});
  assert.deepStrictEqual(Orig.planUpdateOriginalPrice(null,125,125),{include:false});
  assert.deepStrictEqual(Orig.planUpdateOriginalPrice("",0,0),{include:false});
  assert.deepStrictEqual(Orig.planUpdateOriginalPrice(null,0),{include:false});
});

test("initialized original_price is not overwritten by later price edits",()=>{
  assert.deepStrictEqual(Orig.planUpdateOriginalPrice(125,200,125),{include:false});
  assert.deepStrictEqual(Orig.planUpdateOriginalPrice(0,90,0),{include:false});
  assert.deepStrictEqual(Orig.planUpdateOriginalPrice(100,100,100),{include:false});
});

test("explicit original_price correction writes only original_price",()=>{
  const set=Orig.planOriginalPriceCorrection({bookId:"5",loadedOriginal:null,enteredValue:"350"});
  assert.strictEqual(set.ok,true);
  assert.strictEqual(set.write,true);
  assert.strictEqual(set.method,"update");
  assert.deepStrictEqual(set.patch,{original_price:350});
  Orig.assertOriginalPriceOnlyPatch(set.patch);
  const fix=Orig.planOriginalPriceCorrection({bookId:"1",loadedOriginal:350,enteredValue:"420"});
  assert.deepStrictEqual(fix.patch,{original_price:420});
  const zero=Orig.planOriginalPriceCorrection({bookId:"1",loadedOriginal:350,enteredValue:"0"});
  assert.deepStrictEqual(zero.patch,{original_price:0});
});

test("invalid original_price corrections do not plan a write",()=>{
  assert.strictEqual(Orig.planOriginalPriceCorrection({bookId:"1",loadedOriginal:350,enteredValue:"-1"}).write,false);
  assert.strictEqual(Orig.parseCorrectionPrice("-5").ok,false);
  assert.strictEqual(Orig.parseCorrectionPrice("").ok,false);
  assert.strictEqual(Orig.parseCorrectionPrice("abc").ok,false);
  assert.strictEqual(Orig.parseCorrectionPrice("Infinity").ok,false);
  assert.strictEqual(Orig.planOriginalPriceCorrection({bookId:"",loadedOriginal:null,enteredValue:"350"}).ok,false);
  assert.strictEqual(Orig.planOriginalPriceCorrection({bookId:"book-abc",loadedOriginal:null,enteredValue:"350"}).ok,false);
});

test("same original value is a safe no-op",()=>{
  const same=Orig.planOriginalPriceCorrection({bookId:"1",loadedOriginal:350,enteredValue:"350"});
  assert.strictEqual(same.ok,true);
  assert.strictEqual(same.noop,true);
  assert.strictEqual(same.write,false);
  const sameZero=Orig.planOriginalPriceCorrection({bookId:"1",loadedOriginal:0,enteredValue:"0"});
  assert.strictEqual(sameZero.write,false);
});

test("stale original_price is detected before overwrite",()=>{
  assert.strictEqual(Orig.isStaleOriginal(350,420),true);
  assert.strictEqual(Orig.isStaleOriginal(null,350),true);
  assert.strictEqual(Orig.isStaleOriginal(null,""),false);
  assert.strictEqual(Orig.isStaleOriginal(0,0),false);
  assert.strictEqual(Orig.isStaleOriginal(350,350),false);
});

test("admin form status is read-only and does not invent a value",()=>{
  assert.ok(Orig.originalPriceStatus(125).text.includes("125"));
  assert.ok(Orig.originalPriceStatus(125).text.includes("ئەسلى باھا"));
  assert.strictEqual(Orig.originalPriceStatus(null).text,"ئەسلى باھا تېخى ساقلانمىغان");
  assert.strictEqual(Orig.originalPriceStatus(0).initialized,true);
});

test("reset preview shows current → original and skips NULL originals",()=>{
  const preview=Orig.buildResetPreview(catalog,{scope:"all"});
  assert.strictEqual(preview.targeted,catalog.length);
  assert.ok(preview.updateCount>=3);
  const a=preview.resettable.find(r=>String(r.id)==="1");
  assert.strictEqual(a.oldPrice,135);
  assert.strictEqual(a.newPrice,100);
  const missing=preview.missing.find(r=>String(r.id)==="5");
  assert.ok(missing);
  assert.strictEqual(missing.reason,"missing_original");
  assert.ok(!preview.resettable.some(r=>String(r.id)==="5"));
  const line=Orig.formatResetLine(a);
  assert.ok(line.includes("135"));
  assert.ok(line.includes("100"));
  const zero=preview.resettable.find(r=>String(r.id)==="4");
  assert.strictEqual(zero.newPrice,0);
});

test("already-at-original books are skipped unchanged",()=>{
  const preview=Orig.buildResetPreview(catalog,{scope:"selected",selectedIds:["2","7"]});
  assert.strictEqual(preview.updateCount,0);
  assert.strictEqual(preview.unchangedCount,2);
  assert.strictEqual(preview.canApply,false);
});

test("selected / category / all reset scopes are not page-limited",()=>{
  const page=catalog.slice(0,2);
  const all=Orig.buildResetPreview(catalog,{scope:"all"});
  assert.ok(all.targeted>page.length);
  const cat=Orig.buildResetPreview(catalog,{scope:"category",source:"romanlar.html"});
  assert.strictEqual(cat.targeted,1);
  assert.strictEqual(cat.updateCount,1);
  const sel=Orig.buildResetPreview(catalog,{scope:"selected",selectedIds:["1","8"]});
  assert.strictEqual(sel.targeted,2);
  assert.strictEqual(sel.updateCount,2);
});

test("stale preview / settings cannot confirm reset",()=>{
  const settings={scope:"selected",selectedIds:["1","8"]};
  const preview=Orig.buildResetPreview(catalog,settings);
  assert.strictEqual(Orig.canConfirmReset(preview,settings),true);
  assert.strictEqual(Orig.canConfirmReset(preview,{...settings,scope:"all"}),false);
  assert.strictEqual(Orig.canConfirmReset(preview,{...settings,selectedIds:["1"]}),false);
  assert.strictEqual(Orig.canConfirmReset(null,settings),false);
});

test("high-risk reset requires typed resettable count",()=>{
  const all=Orig.buildResetPreview(catalog,{scope:"all"});
  assert.strictEqual(all.highRisk,true);
  assert.strictEqual(Orig.canFinalizeReset(all,{scope:"all"},String(all.updateCount)),true);
  assert.strictEqual(Orig.canFinalizeReset(all,{scope:"all"},"999"),false);
  const many=Array.from({length:20},(_,i)=>({id:100+i,title:"B"+i,price:10,original_price:5,source:"universal.html"}));
  const settings={scope:"selected",selectedIds:many.map(b=>String(b.id))};
  const preview=Orig.buildResetPreview(many,settings);
  assert.strictEqual(preview.updateCount,20);
  assert.strictEqual(preview.highRisk,true);
  const small=Orig.buildResetPreview(catalog,{scope:"selected",selectedIds:["1"]});
  assert.strictEqual(small.highRisk,false);
  assert.strictEqual(Orig.canFinalizeReset(small,{scope:"selected",selectedIds:["1"]},"1"),false);
});

test("bulk price patches are price-only and never carry original_price",()=>{
  Orig.assertPriceOnlyPatch({price:120});
  assert.throws(()=>Orig.assertPriceOnlyPatch({price:120,original_price:100}),/ORIGINAL_PRICE_LOCKED|PRICE_ONLY_PATCH/);
  assert.throws(()=>Orig.assertPriceOnlyPatch({original_price:100}),/PRICE_ONLY_PATCH/);
});

test("PR #63 bulk increase/decrease does not plan original_price writes",()=>{
  const books=catalog.map(b=>({...b}));
  const inc=Price.buildPreview(books,{scope:"selected",selectedIds:["1"],operation:"pct_inc",amount:"20"});
  assert.strictEqual(inc.updatable[0].newPrice,162);
  assert.strictEqual(books[0].original_price,100);
  const dec=Price.buildPreview(books,{scope:"selected",selectedIds:["1"],operation:"pct_dec",amount:"20"});
  assert.strictEqual(dec.updatable[0].newPrice,108);
  assert.strictEqual(books[0].original_price,100);
});

test("quick edit still does not include original_price",()=>{
  const built=Prod.buildQuickEditPatch({title:"A",source:"universal.html",price:99});
  assert.strictEqual(built.ok,true);
  assert.ok(!Object.prototype.hasOwnProperty.call(built.patch,"original_price"));
});

test("admin HTML/JS keep original_price read-only and reuse PR63 reset UI",()=>{
  const html=read("admin.html");
  const js=read("admin.js");
  assert.match(html,/id="bulkResetOpenBtn"/);
  assert.match(html,/ئەسلى باھاغا قايتۇرۇش/);
  assert.match(html,/id="bookOriginalPriceStatus"/);
  assert.match(html,/ئەسلى باھا تېخى ساقلانمىغان/);
  assert.match(html,/ئەسلى باھاغا قايتۇرۇشنى جەزملەشتۈرۈش/);
  assert.match(html,/admin-original-price\.js\?v=5/);
  assert.match(html,/admin\.css\?v=34/);
  assert.match(html,/admin\.js\?v=59/);
  assert.match(html,/id="bookOriginalPriceCorrectBtn"/);
  assert.match(html,/id="bookOriginalPriceResetBtn"/);
  assert.match(html,/id="originalPriceCorrectModal"/);
  assert.match(html,/id="singleOriginalResetModal"/);
  assert.match(html,/تىزىملىكتىن تاللانغان كىتابلار/);
  assert.doesNotMatch(html,/id="bookOriginalPrice"/);
  assert.match(js,/planUpdateOriginalPrice\(editing&&editing\.original_price,row\.price,editing&&editing\.price\)/);
  assert.match(js,/assertPriceOnlyPatch/);
  assert.match(js,/persistOriginalPriceCorrection/);
  assert.match(js,/assertOriginalPriceOnlyPatch/);
  assert.match(js,/persistOriginalPriceCorrection\(draft\.id,planned\.patch,draft\.loadedOriginal\)/);
  const correctStart=js.indexOf("async function persistOriginalPriceCorrection");
  const correctEnd=js.indexOf("async function saveOriginalPriceCorrection");
  assert.ok(correctStart>0&&correctEnd>correctStart);
  const correctFn=js.slice(correctStart,correctEnd);
  assert.match(correctFn,/\.update\(patch\)/);
  assert.match(correctFn,/applyExpectedOriginalFilter/);
  assert.match(correctFn,/originalPriceCasResult/);
  assert.doesNotMatch(correctFn,/\.insert\(/);
  assert.doesNotMatch(correctFn,/\.upsert\(/);
  assert.doesNotMatch(correctFn,/persistBookRow/);
  assert.doesNotMatch(correctFn,/\bprice\s*:/);
  assert.match(js,/persistSingleBookReset/);
  assert.match(js,/applySingleResetCasFilter/);
  const resetStart=js.indexOf("async function persistSingleBookReset");
  const resetEnd=js.indexOf("async function saveSingleOriginalReset");
  assert.ok(resetStart>0&&resetEnd>resetStart);
  const resetFn=js.slice(resetStart,resetEnd);
  assert.match(resetFn,/\.update\(patch\)/);
  assert.doesNotMatch(resetFn,/\.insert\(/);
  assert.doesNotMatch(resetFn,/\.upsert\(/);
  assert.doesNotMatch(resetFn,/persistBookRow/);
  const css=read("admin.css");
  assert.match(css,/\.admin-bulk-price-card \[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(js,/__kutadguAdminBulkResetUpdateOne/);
  assert.match(js,/bulkResetInFlight/);
  const updateFn=js.match(/function rowToUpdate\(row\)\{[\s\S]*?\n\}/);
  assert.ok(updateFn);
  assert.doesNotMatch(updateFn[0],/original_price/);
  assert.doesNotMatch(js,/admin_bulk_reset_original_price/);
  const origJs=read("admin-original-price.js");
  assert.doesNotMatch(origJs,/SECURITY DEFINER/i);
  assert.doesNotMatch(origJs,/\.rpc\(/);
});

test("CSV mapper does not require or write original_price on updates",()=>{
  const js=read("admin.js");
  const mapFn=js.match(/function mapImportRow\(raw\)\{[\s\S]*?\n\}/);
  assert.ok(mapFn);
  assert.doesNotMatch(mapFn[0],/original_price/);
  const insertFn=js.match(/function rowToInsert\(row,id\)\{[\s\S]*?\nfunction rowToUpdate/);
  assert.ok(insertFn);
  assert.match(insertFn[0],/planInsertOriginalPrice/);
});

test("SQL/AAL2 files were not weakened for original_price writes",()=>{
  const sql=read("STAGE64_ORIGINAL_PRICE.sql");
  assert.doesNotMatch(sql,/CREATE POLICY/i);
  assert.doesNotMatch(sql,/DROP POLICY/i);
  assert.doesNotMatch(sql,/SECURITY DEFINER/i);
  assert.doesNotMatch(sql,/DISABLE ROW LEVEL SECURITY/i);
  const aal=read("STAGE2C_AAL2_BOOKS_WRITE_RLS.sql");
  assert.match(aal,/aal2 required to update books/);
});

(async()=>{
  await testAsync("reset apply writes price only and preserves original_price",async()=>{
    const preview=Orig.buildResetPreview(catalog,{scope:"selected",selectedIds:["1","4"]});
    const store={
      1:{price:135,original_price:100},
      4:{price:10,original_price:0}
    };
    const result=await Price.applyPriceUpdates(async(id,patch)=>{
      Orig.assertPriceOnlyPatch(patch);
      store[id].price=patch.price;
      return {error:null};
    },preview.updatable,{concurrency:1});
    assert.strictEqual(result.fullSuccess,true);
    assert.strictEqual(store[1].price,100);
    assert.strictEqual(store[1].original_price,100);
    assert.strictEqual(store[4].price,0);
    assert.strictEqual(store[4].original_price,0);
  });

  await testAsync("preview does not write and partial reset is not full success",async()=>{
    const preview=Orig.buildResetPreview(catalog,{scope:"selected",selectedIds:["1","8"]});
    const calls=[];
    const result=await Price.applyPriceUpdates(async(id,patch)=>{
      calls.push({id:String(id),patch});
      if(String(id)==="8")return {error:new Error("row locked")};
      return {error:null};
    },preview.updatable,{concurrency:1});
    assert.strictEqual(result.fullSuccess,false);
    assert.strictEqual(result.okCount,1);
    assert.deepStrictEqual(calls.map(c=>c.patch),[{price:100},{price:40}]);
    assert.ok(!calls.some(c=>Object.prototype.hasOwnProperty.call(c.patch,"original_price")));
  });

  test("compare-and-swap filters numeric originals with eq and NULL with is",()=>{
    function mockQuery(){
      const calls=[];
      return {
        calls,
        eq(col,val){calls.push({op:"eq",col,val});return this},
        is(col,val){calls.push({op:"is",col,val});return this}
      };
    }
    const numeric=mockQuery();
    Orig.applyExpectedOriginalFilter(numeric,350);
    assert.deepStrictEqual(numeric.calls,[{op:"eq",col:"original_price",val:350}]);
    const zero=mockQuery();
    Orig.applyExpectedOriginalFilter(zero,0);
    assert.deepStrictEqual(zero.calls,[{op:"eq",col:"original_price",val:0}]);
    const missing=mockQuery();
    Orig.applyExpectedOriginalFilter(missing,null);
    assert.deepStrictEqual(missing.calls,[{op:"is",col:"original_price",val:null}]);
    const blank=mockQuery();
    Orig.applyExpectedOriginalFilter(blank,"");
    assert.deepStrictEqual(blank.calls,[{op:"is",col:"original_price",val:null}]);
  });

  test("successful compare-and-swap writes original_price only and leaves selling price",()=>{
    const store={1:{id:1,price:135,original_price:350,title:"A",stock:3}};
    const result=Orig.compareAndSwapOriginalPrice(store,{
      id:1,
      expectedOriginal:350,
      patch:{original_price:420}
    });
    assert.strictEqual(result.matched,true);
    assert.strictEqual(result.data.length,1);
    assert.strictEqual(store[1].original_price,420);
    assert.strictEqual(store[1].price,135);
    assert.strictEqual(store[1].title,"A");
    assert.strictEqual(store[1].stock,3);
    Orig.assertOriginalPriceOnlyPatch({original_price:420});
  });

  await testAsync("race between prefetch and update does not overwrite original_price",async()=>{
    const store={1:{id:1,price:135,original_price:350,title:"A",stock:3,sales_count:5}};
    const loadedOriginal=350;
    const fresh=store[1].original_price;
    assert.strictEqual(Orig.isStaleOriginal(loadedOriginal,fresh),false);
    store[1].original_price=420;
    const result=Orig.compareAndSwapOriginalPrice(store,{
      id:1,
      expectedOriginal:loadedOriginal,
      patch:{original_price:500}
    });
    assert.deepStrictEqual(result.data,[]);
    assert.strictEqual(result.matched,false);
    assert.strictEqual(store[1].original_price,420);
    assert.strictEqual(store[1].price,135);
    const classified=Orig.originalPriceCasResult(result.data,store[1]);
    assert.strictEqual(classified.ok,false);
    assert.strictEqual(classified.stale,true);
    assert.strictEqual(classified.error,Orig.STALE_ORIGINAL_ERROR);
  });

  await testAsync("NULL compare-and-swap aborts if another session initializes original_price",async()=>{
    const store={5:{id:5,price:0,original_price:null}};
    assert.strictEqual(Orig.isStaleOriginal(null,store[5].original_price),false);
    store[5].original_price=350;
    const result=Orig.compareAndSwapOriginalPrice(store,{
      id:5,
      expectedOriginal:null,
      patch:{original_price:500}
    });
    assert.deepStrictEqual(result.data,[]);
    assert.strictEqual(result.matched,false);
    assert.strictEqual(store[5].original_price,350);
    assert.strictEqual(store[5].price,0);
    const classified=Orig.originalPriceCasResult(result.data,store[5]);
    assert.strictEqual(classified.stale,true);
    const missing=Orig.originalPriceCasResult([],null);
    assert.strictEqual(missing.missing,true);
    assert.strictEqual(missing.error,Orig.MISSING_BOOK_ERROR);
  });

  test("reset preview enablement ignores selectedIds unless selected scope",()=>{
    assert.strictEqual(Orig.canRunResetPreview({scope:"selected",selectedIds:[]}),false);
    assert.strictEqual(Orig.canRunResetPreview({scope:"selected",selectedIds:["1"]}),true);
    assert.strictEqual(Orig.canRunResetPreview({scope:"category",source:"",selectedIds:["1"]}),false);
    assert.strictEqual(Orig.canRunResetPreview({scope:"category",source:"romanlar.html",selectedIds:[]}),true);
    assert.strictEqual(Orig.canRunResetPreview({scope:"all",selectedIds:[]}),true);
  });

  test("single-book reset writes price only when original exists and differs",()=>{
    const planned=Orig.planSingleBookReset({id:1,price:360,original_price:350});
    assert.strictEqual(planned.ok,true);
    assert.deepStrictEqual(planned.patch,{price:350});
    Orig.assertPriceOnlyPatch(planned.patch);
    assert.strictEqual(Orig.canShowSingleBookReset({id:1,price:360,original_price:350}),true);
    assert.strictEqual(Orig.canShowSingleBookReset({id:4,price:10,original_price:0}),true);
    assert.strictEqual(Orig.canShowSingleBookReset({id:5,price:0,original_price:null}),false);
    assert.strictEqual(Orig.canShowSingleBookReset({id:2,price:80,original_price:80}),false);
    assert.strictEqual(Orig.planSingleBookReset({id:2,price:80,original_price:80}).write,false);
  });

  await testAsync("single-book reset CAS aborts stale price, stale original, and post-fetch race",async()=>{
    const store={1:{id:1,price:360,original_price:350,title:"A",stock:3}};
    const ok=Orig.compareAndSwapSingleReset(store,{
      id:1,
      expectedPrice:360,
      expectedOriginal:350,
      patch:{price:350}
    });
    assert.strictEqual(ok.matched,true);
    assert.strictEqual(store[1].price,350);
    assert.strictEqual(store[1].original_price,350);
    store[1].price=360;
    store[1].original_price=350;
    store[1].price=400;
    const stalePrice=Orig.compareAndSwapSingleReset(store,{
      id:1,
      expectedPrice:360,
      expectedOriginal:350,
      patch:{price:350}
    });
    assert.deepStrictEqual(stalePrice.data,[]);
    assert.strictEqual(store[1].price,400);
    assert.strictEqual(store[1].original_price,350);
    store[1].price=360;
    store[1].original_price=420;
    const staleOrig=Orig.compareAndSwapSingleReset(store,{
      id:1,
      expectedPrice:360,
      expectedOriginal:350,
      patch:{price:350}
    });
    assert.deepStrictEqual(staleOrig.data,[]);
    assert.strictEqual(store[1].price,360);
    assert.strictEqual(store[1].original_price,420);
    store[1].original_price=350;
    assert.strictEqual(Orig.isStaleSingleReset({price:360,original_price:350},store[1]),false);
    store[1].price=420;
    const raced=Orig.compareAndSwapSingleReset(store,{
      id:1,
      expectedPrice:360,
      expectedOriginal:350,
      patch:{price:350}
    });
    assert.strictEqual(raced.matched,false);
    assert.strictEqual(store[1].price,420);
    assert.strictEqual(store[1].original_price,350);
    const queryCalls=[];
    const query={eq(col,val){queryCalls.push({op:"eq",col,val});return this},is(){queryCalls.push({op:"is"});return this}};
    Orig.applySingleResetCasFilter(query,{price:360,original_price:350});
    assert.deepStrictEqual(queryCalls,[{op:"eq",col:"price",val:360},{op:"eq",col:"original_price",val:350}]);
  });

  await testAsync("bulk price apply leaves original_price untouched",async()=>{
    const books=[{id:1,title:"A",price:100,original_price:100,source:"universal.html"}];
    const preview=Price.buildPreview(books,{scope:"selected",selectedIds:["1"],operation:"pct_inc",amount:"20"});
    const store={1:{price:100,original_price:100}};
    await Price.applyPriceUpdates(async(id,patch)=>{
      Orig.assertPriceOnlyPatch(patch);
      store[id].price=patch.price;
      return {error:null};
    },preview.updatable,{concurrency:1});
    assert.strictEqual(store[1].price,120);
    assert.strictEqual(store[1].original_price,100);
    const down=Price.buildPreview([{id:1,title:"A",price:120,original_price:100,source:"universal.html"}],{scope:"selected",selectedIds:["1"],operation:"fixed_dec",amount:"20"});
    await Price.applyPriceUpdates(async(id,patch)=>{
      Orig.assertPriceOnlyPatch(patch);
      store[id].price=patch.price;
      return {error:null};
    },down.updatable,{concurrency:1});
    assert.strictEqual(store[1].price,100);
    assert.strictEqual(store[1].original_price,100);
  });

  if(failed){
    console.error(failed+" failed");
    process.exit(1);
  }
  console.log("admin-original-price-tests ok");
})();
