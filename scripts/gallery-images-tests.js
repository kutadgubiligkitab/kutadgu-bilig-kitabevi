#!/usr/bin/env node
"use strict";
const assert=require("assert");
const fs=require("fs");
const path=require("path");
const G=require("../gallery-images.js");

let failed=0;
function test(name,fn){
  try{fn();console.log("PASS",name)}
  catch(err){failed++;console.error("FAIL",name,err.message)}
}

test("empty / missing gallery is []",()=>{
  assert.deepStrictEqual(G.normalizeGalleryImages(undefined),[]);
  assert.deepStrictEqual(G.normalizeGalleryImages(null),[]);
  assert.deepStrictEqual(G.normalizeGalleryImages([]),[]);
  assert.deepStrictEqual(G.normalizeGalleryImages("[]"),[]);
  assert.deepStrictEqual(G.normalizeGalleryImages(""),[]);
});

test("keeps up to 4 unique http/path URLs and drops cover duplicate",()=>{
  const cover="sample-book-cover.png";
  const out=G.normalizeGalleryImages([
    cover,
    "back.png",
    "back.png",
    "toc.png",
    "page-1.png",
    "page-2.png",
    "page-3.png",
    "data:image/png;base64,abc"
  ],{coverUrl:cover});
  assert.deepStrictEqual(out,["back.png","toc.png","page-1.png","page-2.png"]);
});

test("planGallerySelection blocks a 5th image",()=>{
  const full=G.planGallerySelection(4,1);
  assert.strictEqual(full.ok,false);
  assert.strictEqual(full.take,0);
  const overflow=G.planGallerySelection(0,5);
  assert.strictEqual(overflow.ok,false);
  assert.strictEqual(overflow.take,4);
  assert.strictEqual(overflow.skipped,1);
  const ok=G.planGallerySelection(1,2);
  assert.strictEqual(ok.ok,true);
  assert.strictEqual(ok.take,2);
});

test("rejects javascript and data URLs",()=>{
  assert.deepStrictEqual(G.normalizeGalleryImages(["javascript:alert(1)","data:image/png;base64,xx","https://cdn.example/a.jpg"]),["https://cdn.example/a.jpg"]);
});

test("mime allowlist rejects svg and octet-stream",()=>{
  assert.strictEqual(G.isAllowedGalleryMime("image/jpeg"),true);
  assert.strictEqual(G.isAllowedGalleryMime("image/png"),true);
  assert.strictEqual(G.isAllowedGalleryMime("image/svg+xml"),false);
  assert.strictEqual(G.isAllowedGalleryMime("application/octet-stream"),false);
});

test("magic-byte sniff does not trust extension",()=>{
  assert.strictEqual(G.sniffImageMime(Uint8Array.from([0xFF,0xD8,0xFF,0,0,0,0,0,0,0,0,0])),"image/jpeg");
  assert.strictEqual(G.sniffImageMime(Uint8Array.from([0x00,0x00,0x00,0,0,0,0,0,0,0,0,0])),"");
});

test("sample-book-cover.png bytes are unchanged",()=>{
  const file=path.join(__dirname,"..","sample-book-cover.png");
  const buf=fs.readFileSync(file);
  assert.ok(buf.length>1000);
  assert.strictEqual(buf[0],0x89);
  assert.strictEqual(buf[1],0x50);
  assert.strictEqual(buf[2],0x4E);
  assert.strictEqual(buf[3],0x47);
});

if(failed){process.exit(1)}
console.log("All gallery helper tests passed");
