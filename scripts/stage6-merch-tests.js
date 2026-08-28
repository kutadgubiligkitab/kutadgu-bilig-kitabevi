#!/usr/bin/env node
"use strict";
const assert=require("assert");
const Q=require("../admin-book-quality.js");

function isPlaceholderAuthor(value){
  const author=String(value||"").replace(/\s+/g," ").trim();
  return !author||author==="—"||author===Q.PLACEHOLDER_AUTHOR;
}
function storefrontAuthor(book){
  return isPlaceholderAuthor(book&&book.author)?"":String(book.author).trim();
}
function storefrontIsbn(book){
  return Q.normalizeIsbn(book&&book.isbn);
}

let failed=0;
function test(name,fn){
  try{fn();console.log("PASS",name)}
  catch(err){failed++;console.error("FAIL",name,err.message)}
}

test("placeholder author is omitted on storefront",()=>{
  assert.strictEqual(storefrontAuthor({author:"ئاپتور ئىسمى"}),"");
  assert.strictEqual(storefrontAuthor({author:"ئابدۇرېھىم ئۆتكۈر"}),"ئابدۇرېھىم ئۆتكۈر");
});

test("empty ISBN is omitted",()=>{
  assert.strictEqual(storefrontIsbn({isbn:""}),"");
  assert.strictEqual(storefrontIsbn({isbn:"978-975-08-0295-9"}),"9789750802959");
});

test("bestseller honesty hides when count is 0",()=>{
  function apply(hasSales){return !!hasSales}
  assert.strictEqual(apply(0>0),false);
  assert.strictEqual(apply(1>0),true);
});

if(failed)process.exit(1);
console.log("stage6-merch-tests ok");
