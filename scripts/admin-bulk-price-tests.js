#!/usr/bin/env node
"use strict";
const assert=require("assert");
const fs=require("fs");
const path=require("path");
const P=require("../admin-bulk-price.js");
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

const catalog=[
  {id:1,title:"Alpha",price:100,source:"universal.html"},
  {id:2,title:"Beta",price:200,source:"universal.html"},
  {id:3,title:"Gamma",price:20,source:"romanlar.html"},
  {id:4,title:"Zero",price:0,source:"universal.html"},
  {id:5,title:"Missing",price:null,source:"universal.html"},
  {id:6,title:"Blank",price:"",source:"dini.html"},
  {id:7,title:"NaN",price:"abc",source:"universal.html"},
  {id:8,title:"PageTwo",price:50,source:"universal.html"}
];

test("percentage increase uses 2 decimal money rounding",()=>{
  const r=P.computeNewPrice(100,"pct_inc",10);
  assert.strictEqual(r.ok,true);
  assert.strictEqual(r.value,110);
  const tiny=P.computeNewPrice(10.1,"pct_inc",10);
  assert.strictEqual(tiny.value,11.11);
});

test("percentage decrease allows zero and blocks negative",()=>{
  const zero=P.computeNewPrice(100,"pct_dec",100);
  assert.strictEqual(zero.ok,true);
  assert.strictEqual(zero.value,0);
  const neg=P.computeNewPrice(100,"pct_dec",110);
  assert.strictEqual(neg.ok,false);
  assert.strictEqual(neg.negative,true);
});

test("fixed increase and decrease",()=>{
  assert.strictEqual(P.computeNewPrice(100,"fixed_inc",20).value,120);
  assert.strictEqual(P.computeNewPrice(100,"fixed_dec",25).value,75);
  const blocked=P.computeNewPrice(20,"fixed_dec",25);
  assert.strictEqual(blocked.ok,false);
  assert.strictEqual(blocked.negative,true);
});

test("zero price is valid and missing prices are not invented",()=>{
  assert.strictEqual(P.isValidExistingPrice(0),true);
  assert.strictEqual(P.computeNewPrice(0,"pct_inc",10).value,0);
  assert.strictEqual(P.computeNewPrice(null,"pct_inc",10).skipped,true);
  assert.strictEqual(P.computeNewPrice("","fixed_inc",5).skipped,true);
  assert.strictEqual(P.computeNewPrice("nope","fixed_inc",5).skipped,true);
});

test("amount parser rejects signs and non-numbers",()=>{
  assert.strictEqual(P.parseAdjustmentAmount("10").ok,true);
  assert.strictEqual(P.parseAdjustmentAmount("-15").ok,false);
  assert.strictEqual(P.parseAdjustmentAmount("").ok,false);
  assert.strictEqual(P.parseAdjustmentAmount("x").ok,false);
});

test("selected / category / all scopes use complete catalogs not a page slice",()=>{
  const page=catalog.slice(0,2);
  const all=P.selectScopeBooks(catalog,{scope:"all"});
  assert.strictEqual(all.books.length,catalog.length);
  assert.ok(all.books.length>page.length);
  const cat=P.selectScopeBooks(catalog,{scope:"category",source:"romanlar.html"});
  assert.deepStrictEqual(cat.books.map(b=>b.id),[3]);
  const sel=P.selectScopeBooks(catalog,{scope:"selected",selectedIds:["1","8"]});
  assert.deepStrictEqual(sel.books.map(b=>String(b.id)),["1","8"]);
  const empty=P.selectScopeBooks(catalog,{scope:"selected",selectedIds:[]});
  assert.strictEqual(empty.ok,false);
  assert.strictEqual(empty.emptySelected,true);
});

test("preview shows old to new, skips invalid, and blocks negatives before apply",()=>{
  const preview=P.buildPreview(catalog,{
    scope:"all",
    operation:"pct_inc",
    amount:"10"
  });
  assert.strictEqual(preview.targeted,catalog.length);
  assert.strictEqual(preview.updateCount,5);
  assert.strictEqual(preview.skippedCount,3);
  const alpha=preview.updatable.find(r=>String(r.id)==="1");
  assert.strictEqual(alpha.oldPrice,100);
  assert.strictEqual(alpha.newPrice,110);
  const zero=preview.updatable.find(r=>String(r.id)==="4");
  assert.strictEqual(zero.oldPrice,0);
  assert.strictEqual(zero.newPrice,0);
  assert.strictEqual(preview.canApply,true);

  const blocked=P.buildPreview(catalog,{
    scope:"category",
    source:"romanlar.html",
    operation:"fixed_dec",
    amount:"25"
  });
  assert.strictEqual(blocked.hasNegative,true);
  assert.strictEqual(blocked.canApply,false);
  assert.ok(blocked.error.includes("مەنپىي"));
});

test("changing settings invalidates confirmation",()=>{
  const settings={scope:"selected",selectedIds:["1","2"],operation:"pct_inc",amount:"10"};
  const preview=P.buildPreview(catalog,settings);
  assert.strictEqual(P.canConfirm(preview,settings),true);
  assert.strictEqual(P.canConfirm(preview,{...settings,amount:"15"}),false);
  assert.strictEqual(P.canConfirm(preview,{...settings,operation:"pct_dec"}),false);
  assert.strictEqual(P.canConfirm(preview,{...settings,scope:"all"}),false);
  assert.strictEqual(P.canConfirm(null,settings),false);
});

test("small selected increase is not high-risk and does not warn",()=>{
  const settings={scope:"selected",selectedIds:["1","2"],operation:"pct_inc",amount:"10"};
  const preview=P.buildPreview(catalog,settings);
  assert.strictEqual(preview.highRisk,false);
  assert.strictEqual(P.isHighRisk(preview,settings),false);
  assert.strictEqual(preview.zeroCount,0);
  assert.strictEqual(preview.zeroWarning.text,"");
  assert.strictEqual(P.canFinalizeHighRisk(preview,settings,"2"),false);
});

test("all-books scope is always high-risk",()=>{
  const settings={scope:"all",operation:"pct_inc",amount:"10"};
  const preview=P.buildPreview(catalog,settings);
  assert.strictEqual(preview.highRisk,true);
  assert.strictEqual(P.canConfirm(preview,settings),true);
  assert.strictEqual(P.canFinalizeHighRisk(preview,settings,String(preview.updateCount)),true);
  assert.strictEqual(P.canFinalizeHighRisk(preview,settings,"999"),false);
});

test("20+ updatable books are high-risk",()=>{
  const many=Array.from({length:20},(_,i)=>({id:100+i,title:"B"+i,price:10,source:"universal.html"}));
  const settings={scope:"selected",selectedIds:many.map(b=>String(b.id)),operation:"fixed_inc",amount:"1"};
  const preview=P.buildPreview(many,settings);
  assert.strictEqual(preview.updateCount,20);
  assert.strictEqual(preview.highRisk,true);
  assert.ok(P.HIGH_RISK_UPDATE_THRESHOLD<=20);
});

test("non-zero prices becoming 0 warn and require high-risk confirmation",()=>{
  const settings={scope:"selected",selectedIds:["1","2"],operation:"pct_dec",amount:"100"};
  const preview=P.buildPreview(catalog,settings);
  assert.strictEqual(preview.zeroFromPositiveCount,2);
  assert.strictEqual(preview.zeroCount,2);
  assert.strictEqual(preview.allBecomeZero,true);
  assert.strictEqual(preview.highRisk,true);
  assert.ok(preview.zeroWarning.text.includes("جىددىي ئاگاھلاندۇرۇش"));
  assert.strictEqual(P.canFinalizeHighRisk(preview,settings,"1"),false);
  assert.strictEqual(P.canFinalizeHighRisk(preview,settings,"2"),true);
  assert.strictEqual(P.canFinalizeHighRisk(preview,{...settings,amount:"90"},"2"),false);
});

test("partial zeroing shows the milder warning",()=>{
  const settings={scope:"selected",selectedIds:["1","3"],operation:"fixed_dec",amount:"20"};
  const preview=P.buildPreview(catalog,settings);
  assert.strictEqual(preview.canApply,true);
  assert.strictEqual(preview.zeroFromPositiveCount,1);
  assert.strictEqual(preview.allBecomeZero,false);
  assert.ok(preview.zeroWarning.text.includes("دىققەت"));
  assert.ok(preview.zeroWarning.text.includes("1"));
  assert.strictEqual(preview.highRisk,true);
});

test("scope query for all/category does not attach list page range itself",()=>{
  const calls=[];
  const query={
    eq(k,v){calls.push(["eq",k,v]);return this},
    in(k,v){calls.push(["in",k,v]);return this},
    range(from,to){calls.push(["range",from,to]);return this}
  };
  P.applyScopeToQuery(query,{scope:"all"});
  assert.deepStrictEqual(calls,[]);
  P.applyScopeToQuery(query,{scope:"category",source:"dini.html"});
  assert.deepStrictEqual(calls,[["eq","source","dini.html"]]);
});

test("existing quick/bulk helpers stay intact",()=>{
  assert.ok(Prod.QUICK_EDIT_FIELDS.includes("price"));
  assert.ok(!Prod.ALLOWED_BULK_ACTIONS.includes("price"));
  assert.strictEqual(Prod.buildQuickEditPatch({title:"A",source:"universal.html",price:0}).ok,true);
});

test("no SECURITY DEFINER price RPC was added",()=>{
  const js=fs.readFileSync(path.join(__dirname,"../admin-bulk-price.js"),"utf8");
  const admin=fs.readFileSync(path.join(__dirname,"../admin.js"),"utf8");
  assert.doesNotMatch(js,/SECURITY DEFINER/i);
  assert.doesNotMatch(js,/\.rpc\(/);
  assert.doesNotMatch(admin,/admin_bulk_update_book_prices/);
});

(async()=>{
  await testAsync("paginated fetch walks every matching page",async()=>{
    const pages={
      "0-1":[{id:1,price:1},{id:2,price:2}],
      "2-3":[{id:3,price:3},{id:4,price:4}],
      "4-5":[{id:5,price:5}]
    };
    const ranges=[];
    const rows=await P.fetchAllMatching(()=>{
      const q={
        order(){return this},
        async range(from,to){
          ranges.push([from,to]);
          return {data:pages[`${from}-${to}`]||[],error:null};
        }
      };
      return q;
    },2);
    assert.deepStrictEqual(ranges,[[0,1],[2,3],[4,5]]);
    assert.strictEqual(rows.length,5);
  });

  await testAsync("preview does not write and partial writes are not full success",async()=>{
    const preview=P.buildPreview(catalog,{scope:"selected",selectedIds:["1","2"],operation:"fixed_inc",amount:"20"});
    assert.strictEqual(preview.canApply,true);
    const calls=[];
    const result=await P.applyPriceUpdates(async(id,patch)=>{
      calls.push({id:String(id),patch});
      if(String(id)==="2")return {error:new Error("row locked")};
      return {error:null};
    },preview.updatable,{concurrency:1});
    assert.strictEqual(result.fullSuccess,false);
    assert.strictEqual(result.okCount,1);
    assert.strictEqual(result.failCount,1);
    assert.ok(result.text.includes("تولۇق تاماملانمىدى"));
    assert.deepStrictEqual(calls.map(c=>c.patch),[{price:120},{price:220}]);
  });

  await testAsync("apply success text includes updated count",async()=>{
    const preview=P.buildPreview(catalog,{scope:"selected",selectedIds:["1"],operation:"pct_inc",amount:"10"});
    const result=await P.applyPriceUpdates(async()=>({error:null}),preview.updatable,{concurrency:1});
    assert.strictEqual(result.fullSuccess,true);
    assert.ok(result.text.includes("1"));
    assert.ok(result.text.includes("يېڭىلاندى"));
  });

  if(failed){
    console.error(failed+" failed");
    process.exit(1);
  }
  console.log("admin-bulk-price-tests ok");
})();
