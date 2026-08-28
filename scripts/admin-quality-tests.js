#!/usr/bin/env node
"use strict";
const assert=require("assert");
const Q=require("../admin-book-quality.js");
const W=require("../admin-book-write.js");

let failed=0;
function test(name,fn){
  try{fn();console.log("PASS",name)}
  catch(err){failed++;console.error("FAIL",name,err.message)}
}

test("placeholder author and cover are incomplete",()=>{
  const issues=Q.qualityIssues({
    title:"رومان",
    author:"ئاپتور ئىسمى",
    image_url:"sample-book-cover.png",
    description:"",
    isbn:""
  });
  assert.deepStrictEqual(issues,["author","cover","description","isbn"]);
});

test("complete book has Complete chip",()=>{
  const book={title:"A",author:"ئابدۇرېھىم ئۆتكۈر",image_url:"https://cdn.example/covers/1.webp",description:"قىسقا چۈشەندۈرۈش.",isbn:"9789750802959"};
  assert.deepStrictEqual(Q.qualityIssues(book),[]);
  assert.strictEqual(Q.qualityLabels([]).length,1);
  assert.strictEqual(Q.qualityLabels([])[0].title,"Complete");
});

test("ISBN hyphen/space trim keeps ISBN-10 vs ISBN-13",()=>{
  assert.strictEqual(Q.formatIsbn(" 978-975-08-0295-9 "),"9789750802959");
  assert.strictEqual(Q.formatIsbn("0-306-40615-2"),"0306406152");
  assert.strictEqual(Q.isbnLooksValid("978-975-08-0295-9"),true);
  assert.strictEqual(Q.isbnLooksValid("0306406152"),true);
  assert.strictEqual(Q.isbnLooksValid("123"),false);
  assert.strictEqual(Q.isbnLooksValid(""),true);
});

test("server-side quality filters do not scan client arrays",()=>{
  const missing=Q.qualityFilterSpec("missing_author");
  assert.ok(missing.or.includes("ئاپتور ئىسمى"));
  const cover=Q.qualityFilterSpec("placeholder_cover");
  assert.ok(cover.or.includes("sample-book-cover.png"));
  const complete=Q.qualityFilterSpec("complete");
  assert.ok(Array.isArray(complete.ands));
  assert.ok(complete.ands.some(step=>step.args&&step.args.includes("ئاپتور ئىسمى")));
});

test("create duplicate warning is INSERT-only",()=>{
  const existing={id:2,title:"رومان كىتابى 2",author:"ئاپتور ئىسمى",price:203,is_active:true};
  const matches=Q.mergeConflictRows([existing],"title_author");
  assert.strictEqual(Q.shouldWarnCreateDuplicates("INSERT",matches),true);
  assert.strictEqual(Q.shouldWarnCreateDuplicates("UPDATE",matches),false);
  assert.strictEqual(Q.shouldSkipCreateDuplicateCheck("UPDATE"),true);
  assert.strictEqual(Q.shouldSkipCreateDuplicateCheck("INSERT"),false);
  const editPlan=W.planBookSave({id:2},"2","edit");
  assert.strictEqual(editPlan.operation,"UPDATE");
  assert.strictEqual(Q.shouldWarnCreateDuplicates(editPlan.operation,matches),false);
});

test("unique create does not warn",()=>{
  assert.strictEqual(Q.shouldWarnCreateDuplicates("INSERT",[]),false);
});

test("duplicate ISBN is a strong signal",()=>{
  assert.strictEqual(Q.isbnExactMatch({isbn:"978-975-08-0295-9"},{isbn:"9789750802959"}),true);
  assert.strictEqual(Q.isbnExactMatch({isbn:""},{isbn:""}),false);
});

test("duplicate message includes existing identity fields for UI",()=>{
  const matches=Q.mergeConflictRows([{id:83,title:"ت",author:"ئ",price:100,is_active:false,isbn:"9789750802959"}],"title_author");
  assert.strictEqual(matches[0].id,83);
  assert.strictEqual(matches[0].title,"ت");
  assert.strictEqual(matches[0].author,"ئ");
  assert.strictEqual(matches[0].price,100);
  assert.strictEqual(matches[0].is_active,false);
  assert.ok(/same title and author/i.test(Q.createDuplicateMessage(matches)));
});

if(failed)process.exit(1);
console.log("admin-quality-tests ok");
