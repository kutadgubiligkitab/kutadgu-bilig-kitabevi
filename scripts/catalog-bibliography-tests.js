#!/usr/bin/env node
"use strict";
const assert=require("assert");
const B=require("../catalog-bibliography.js");
const Q=require("../admin-book-quality.js");
const W=require("../admin-book-write.js");

let failed=0;
function test(name,fn){
  try{fn();console.log("PASS",name)}
  catch(err){failed++;console.error("FAIL",name,err.message)}
}

test("year empty is ok; 1000–2100 integer; invalid rejected",()=>{
  assert.strictEqual(B.parsePublishYear("").ok,true);
  assert.strictEqual(B.parsePublishYear("").value,null);
  assert.strictEqual(B.parsePublishYear("2024").value,2024);
  assert.strictEqual(B.parsePublishYear("999").ok,false);
  assert.strictEqual(B.parsePublishYear("2101").ok,false);
  assert.strictEqual(B.parsePublishYear("19.5").ok,false);
});

test("pages empty is ok; >=1 integer; zero rejected",()=>{
  assert.strictEqual(B.parsePages("").ok,true);
  assert.strictEqual(B.parsePages("").value,null);
  assert.strictEqual(B.parsePages("320").value,320);
  assert.strictEqual(B.parsePages("0").ok,false);
  assert.strictEqual(B.parsePages("-3").ok,false);
});

test("storefront search columns gate translator/publisher by schema",()=>{
  const on=B.storefrontSearchColumns({optionalColumns:{translator:true,publisher:true,isbn:true}});
  assert.ok(on.includes("title")&&on.includes("author")&&on.includes("translator")&&on.includes("publisher")&&on.includes("isbn")&&on.includes("category"));
  const off=B.storefrontSearchColumns({optionalColumns:{translator:false,publisher:false,isbn:true}});
  assert.ok(!off.includes("translator")&&!off.includes("publisher"));
  assert.ok(off.includes("isbn"));
});

test("static haystack includes translator publisher isbn",()=>{
  const hay=B.staticSearchHaystack({
    title:"كىتاب",author:"ئاپتور",translator:"تەرجىمان",publisher:"نەشرىيات",
    category:"رومانلار",isbn:"978-975-08-0295-9"
  });
  assert.ok(hay.includes("تەرجىمان"));
  assert.ok(hay.includes("نەشرىيات"));
  assert.ok(hay.includes("9789750802959"));
});

test("optional bibliography never marks quality incomplete",()=>{
  const issues=Q.qualityIssues({
    title:"A",author:"ئابدۇرېھىم ئۆتكۈر",image_url:"https://cdn.example/a.webp",
    description:"قىسقا.",isbn:"9789750802959",translator:"",publisher:"",publish_year:null,pages:null
  });
  assert.deepStrictEqual(issues,[]);
  assert.strictEqual(B.qualityIgnoresOptionalBibliography(),true);
});

test("edit with bibliographic payload is still UPDATE by id",()=>{
  const plan=W.planBookSave({id:2},"2","edit");
  assert.strictEqual(plan.operation,"UPDATE");
  const req=W.persistRequest(plan.operation,plan.editingBookId);
  assert.strictEqual(req.method,"PATCH");
  assert.strictEqual(req.filter,"id=eq.2");
  assert.notStrictEqual(req.method,"POST");
});

test("42703 disables bibliographic columns without guessing extras",()=>{
  const cols=B.missingColumnsFromError({code:"42703",message:'column books.translator does not exist'});
  assert.deepStrictEqual(cols,["translator"]);
  const spec=B.disableOptionalColumns({optionalColumns:{translator:true,publisher:true}},["translator"]);
  assert.strictEqual(spec.optionalColumns.translator,false);
  assert.strictEqual(spec.optionalColumns.publisher,true);
});

if(failed)process.exit(1);
console.log("catalog-bibliography-tests ok");
