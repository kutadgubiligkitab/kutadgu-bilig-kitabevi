#!/usr/bin/env node
"use strict";
const assert=require("assert");
const Q=require("../admin-book-quality.js");
const W=require("../admin-book-write.js");
const P=require("../admin-catalog-productivity.js");

let failed=0;
function test(name,fn){
  try{fn();console.log("PASS",name)}
  catch(err){failed++;console.error("FAIL",name,err.message)}
}

const fixtures=[
  {id:1,title:"Alpha Book",author:"Author A",price:10,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/a.webp",is_active:true,is_recommended:false,is_new:false,stock:3,stock_status:"in_stock",sales_count:5,legacy_id:"leg-1",created_at:"2026-01-01",isbn:"9781111111111",description:"d"},
  {id:2,title:"",author:"Author B",price:12,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/b.webp",is_active:true,stock:1,stock_status:"in_stock",sales_count:0,isbn:"1",description:"d"},
  {id:3,title:"No Author",author:"ئاپتور ئىسمى",price:8,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/c.webp",is_active:true,stock:1,stock_status:"in_stock",sales_count:0,isbn:"2",description:"d"},
  {id:4,title:"No Cat",author:"Author D",price:5,source:"",category:"",image_url:"https://cdn.example/d.webp",is_active:true,stock:1,stock_status:"in_stock",sales_count:0,isbn:"3",description:"d"},
  {id:5,title:"No Price",author:"Author E",price:null,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/e.webp",is_active:true,stock:1,stock_status:"in_stock",sales_count:0,isbn:"4",description:"d"},
  {id:6,title:"Zero Price",author:"Author F",price:0,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/f.webp",is_active:true,stock:1,stock_status:"in_stock",sales_count:0,isbn:"5",description:"d"},
  {id:7,title:"No Cover",author:"Author G",price:4,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"sample-book-cover.png",is_active:true,stock:1,stock_status:"in_stock",sales_count:0,isbn:"6",description:"d"},
  {id:8,title:"Hidden",author:"Author H",price:4,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/h.webp",is_active:false,stock:1,stock_status:"in_stock",sales_count:9,isbn:"7",description:"d"},
  {id:9,title:"No Stock",author:"Author I",price:4,source:"universal.html",category:"ئۇنىۋېرسال",image_url:"https://cdn.example/i.webp",is_active:true,stock:null,stock_status:"",sales_count:0,isbn:"8",description:"d"}
];

test("quick edit patch uses only allowed fields",()=>{
  const built=P.buildQuickEditPatch({
    title:" يېڭى نام ",
    author:"ئاپتور",
    price:"12.5",
    source:"romanlar.html",
    category:"رومانلار",
    stock:"4",
    stock_status:"low_stock",
    image_url:"https://cdn.example/x.webp",
    is_active:true,
    is_recommended:true,
    is_new:false,
    id:99,
    legacy_id:"nope",
    sales_count:999
  },{presentBookCols:new Set(["stock","stock_status"])});
  assert.strictEqual(built.ok,true);
  assert.strictEqual(built.patch.title,"يېڭى نام");
  assert.strictEqual(built.patch.price,12.5);
  assert.strictEqual(built.patch.source,"romanlar.html");
  assert.strictEqual("id" in built.patch,false);
  assert.strictEqual("legacy_id" in built.patch,false);
  assert.strictEqual("sales_count" in built.patch,false);
  assert.strictEqual("created_at" in built.patch,false);
});

test("quick edit requires title and category source",()=>{
  assert.strictEqual(P.buildQuickEditPatch({title:"",source:"universal.html"}).ok,false);
  assert.strictEqual(P.buildQuickEditPatch({title:"A",source:""}).ok,false);
});

test("price 0 is valid for quick edit and not a problem",()=>{
  const built=P.buildQuickEditPatch({title:"A",source:"universal.html",price:0},{presentBookCols:new Set()});
  assert.strictEqual(built.ok,true);
  assert.strictEqual(built.patch.price,0);
  assert.strictEqual(P.isMissingOrInvalidPrice(0),false);
  assert.strictEqual(P.bookMatchesProblem({price:0},"missing_price"),false);
});

test("stripProtectedFields never keeps identity or sales_count",()=>{
  const stripped=P.stripProtectedFields({id:1,legacy_id:"x",sales_count:8,created_at:"t",title:"A"});
  assert.deepStrictEqual(Object.keys(stripped).sort(),["title"]);
  assert.strictEqual("sales_count" in W.stripIdentityFields({sales_count:1,title:"A"}),true);
  assert.strictEqual("sales_count" in stripped,false);
});

test("bulk patch allows only verified fields",()=>{
  const rec=P.buildBulkPatch("recommended_on",{},{presentBookCols:new Set()});
  assert.deepStrictEqual(rec.patch,{is_recommended:true});
  const cat=P.buildBulkPatch("category",{source:"dini.html",category:"دىنىي كىتابلار"},{presentBookCols:new Set()});
  assert.strictEqual(cat.patch.source,"dini.html");
  const bad=P.buildBulkPatch("title",{title:"x"},{presentBookCols:new Set()});
  assert.strictEqual(bad.ok,false);
});

test("bulk confirm text states count field and value",()=>{
  const text=P.formatBulkConfirm({count:3,field:"تەۋسىيە",value:"قوزغىتىلغان"});
  assert.ok(text.includes("3"));
  assert.ok(text.includes("تەۋسىيە"));
  assert.ok(text.includes("قوزغىتىلغان"));
});

test("visible selection cap rejects hidden full-catalog sets",()=>{
  assert.throws(()=>P.assertVisibleSelection([],40),/NO_SELECTED_IDS/);
  assert.throws(()=>P.assertVisibleSelection(Array.from({length:41},(_,i)=>i),40),/SELECTED_IDS_EXCEED_PAGE/);
  P.assertVisibleSelection(["1","2"],40);
});

test("partial bulk failure is summarized honestly",async()=>{
  const updateOne=async(id)=>{
    if(String(id)==="2")return {error:new Error("row locked")};
    return {error:null};
  };
  const result=await P.applyBulkUpdates(updateOne,["1","2","3"],{is_active:true});
  assert.strictEqual(result.okCount,2);
  assert.strictEqual(result.failCount,1);
  assert.strictEqual(result.fullSuccess,false);
  assert.ok(result.text.includes("2 يېڭىلاندى"));
  assert.ok(result.text.includes("1 مەغلۇپ"));
});

test("problem filters match fixture rows and not price 0",()=>{
  const ids=problem=>P.filterLoadedBooks(fixtures,{problem},{stockSupported:true,stockStatusSupported:true}).map(b=>b.id);
  assert.deepStrictEqual(ids("missing_title"),[2]);
  assert.deepStrictEqual(ids("missing_author"),[3]);
  assert.deepStrictEqual(ids("missing_category"),[4]);
  assert.deepStrictEqual(ids("missing_price"),[5]);
  assert.ok(!ids("missing_price").includes(6));
  assert.deepStrictEqual(ids("missing_cover"),[7]);
  assert.deepStrictEqual(ids("inactive"),[8]);
  assert.deepStrictEqual(ids("missing_stock"),[9]);
  assert.deepStrictEqual(ids("missing_stock_status"),[9]);
});

test("problem filters combine with search without scanning invented columns",()=>{
  const rows=P.filterLoadedBooks(fixtures,{problem:"missing_cover",q:"Cover"},{stockSupported:true});
  assert.strictEqual(rows.length,1);
  assert.strictEqual(rows[0].id,7);
  const cleared=P.filterLoadedBooks(fixtures,{problem:"",q:""},{});
  assert.strictEqual(cleared.length,fixtures.length);
});

test("server-side problem specs are PostgREST filters not client arrays",()=>{
  const title=P.problemFilterSpec("missing_title");
  assert.ok(title.or.includes("title.is.null"));
  const price=P.problemFilterSpec("missing_price");
  assert.ok(price.or.includes("price.is.null"));
  assert.ok(price.or.includes("price.lt.0"));
  assert.ok(!price.or.includes("price.eq.0"));
  const inactive=P.problemFilterSpec("inactive");
  assert.deepStrictEqual(inactive.eq,["is_active",false]);
  const calls=[];
  const query={
    or(v){calls.push(["or",v]);return this},
    eq(k,v){calls.push(["eq",k,v]);return this}
  };
  P.applyProblemFilter(query,"inactive");
  assert.deepStrictEqual(calls,[["eq","is_active",false]]);
});

test("quality helper still classifies placeholder author",()=>{
  assert.strictEqual(Q.isMissingAuthor("ئاپتور ئىسمى"),true);
});

if(failed)process.exit(1);
console.log("admin-catalog-productivity-tests ok");
