#!/usr/bin/env node
"use strict";
const assert=require("assert");
const fs=require("fs");
const path=require("path");
const Safe=require("../kutadgu-safe-url.js");
const P=require("../admin-catalog-productivity.js");

let failed=0;
function test(name,fn){
  try{fn();console.log("PASS",name)}
  catch(err){failed++;console.error("FAIL",name,err.message)}
}

test("escapeHtml renders markup characters as text",()=>{
  const raw=`<img src=x onerror="alert(1)">"'`;
  const out=Safe.escapeHtml(raw);
  assert.ok(!out.includes("<img"));
  assert.match(out,/&lt;img/);
  assert.match(out,/&quot;/);
  assert.match(out,/&#39;/);
});

test("dangerous cover schemes are rejected",()=>{
  ["javascript:alert(1)","JAVASCRIPT:foo","data:text/html,hi","vbscript:msg","file:///etc/passwd","blob:https://example/1","//evil.example/x.png"].forEach(url=>{
    assert.strictEqual(Safe.isSafeCoverUrl(url),false,url);
    assert.strictEqual(Safe.safeCoverUrl(url,{fallback:"",fallbackOnInvalid:false}),"",url);
  });
});

test("valid https and internal covers still work",()=>{
  assert.strictEqual(Safe.isSafeCoverUrl("https://cdn.example/cover.webp"),true);
  assert.strictEqual(Safe.isSafeCoverUrl("/sample-book-cover.png"),true);
  assert.strictEqual(Safe.isSafeCoverUrl("sample-book-cover.png"),true);
  assert.strictEqual(Safe.safeCoverUrl("https://cdn.example/cover.webp"),"https://cdn.example/cover.webp");
  assert.strictEqual(Safe.safeCoverUrl("/covers/a.webp"),"/covers/a.webp");
});

test("javascript href is not kept",()=>{
  assert.strictEqual(Safe.safeHref("javascript:alert(1)"),"#");
  assert.strictEqual(Safe.safeHref("/book/102"),"/book/102");
  assert.strictEqual(Safe.safeHref("book.html?id=102"),"book.html?id=102");
});

test("quick edit rejects dangerous cover without rewriting other fields",()=>{
  const built=P.buildQuickEditPatch({
    title:"Alpha",
    source:"universal.html",
    image_url:"javascript:alert(1)"
  },{presentBookCols:new Set()});
  assert.strictEqual(built.ok,false);
  assert.match(String(built.error||""),/مۇقاۋا|URL/);
});

test("quick edit accepts https and relative covers",()=>{
  const https=P.buildQuickEditPatch({title:"A",source:"universal.html",image_url:"https://cdn.example/a.webp"},{presentBookCols:new Set()});
  assert.strictEqual(https.ok,true);
  assert.strictEqual(https.patch.image_url,"https://cdn.example/a.webp");
  const rel=P.buildQuickEditPatch({title:"A",source:"universal.html",image_url:"sample-book-cover.png"},{presentBookCols:new Set()});
  assert.strictEqual(rel.ok,true);
  assert.strictEqual(rel.patch.image_url,"sample-book-cover.png");
});

const SUPABASE_HTTPS_ORIGIN="https://fxlojnqwyojqjskfggmh.supabase.co";
const CSP_REPORT_ONLY="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' https://fxlojnqwyojqjskfggmh.supabase.co blob: data:; font-src 'self'; connect-src 'self' https://fxlojnqwyojqjskfggmh.supabase.co; frame-src 'none'; worker-src 'none'; media-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

function assertUnchangedBrowserSecurityHeaders(map){
  assert.strictEqual(map["X-Content-Type-Options"],"nosniff");
  assert.strictEqual(map["Referrer-Policy"],"strict-origin-when-cross-origin");
  assert.strictEqual(map["Permissions-Policy"],"camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  assert.strictEqual(map["X-Frame-Options"],"DENY");
}

function assertEnforcedCspUnchanged(value){
  assert.strictEqual(value,"frame-ancestors 'none'");
  assert.doesNotMatch(value||"",/script-src/);
}

function assertCspReportOnlyPolicy(value){
  const csp=String(value||"");
  assert.strictEqual(csp,CSP_REPORT_ONLY);
  assert.match(csp,/default-src\s+'self'/);
  assert.ok(csp.includes(SUPABASE_HTTPS_ORIGIN));
  assert.doesNotMatch(csp,/\*\.supabase\.co/);
  assert.doesNotMatch(csp,/wss:/i);
  assert.doesNotMatch(csp,/unsafe-eval/);
  assert.match(csp,/object-src\s+'none'/);
  assert.match(csp,/frame-ancestors\s+'none'/);
  assert.match(csp,/base-uri\s+'self'/);
  assert.match(csp,/form-action\s+'self'/);
  assert.doesNotMatch(csp,/report-uri|report-to/i);
}

test("vercel.json ships incremental security headers without a full script CSP",()=>{
  const vercel=JSON.parse(fs.readFileSync(path.join(__dirname,"..","vercel.json"),"utf8"));
  const catchAll=(vercel.headers||[]).find(rule=>rule.source==="/(.*)");
  assert.ok(catchAll,"catch-all /(.*) header rule is required");
  const map=Object.fromEntries((catchAll.headers||[]).map(h=>[h.key,h.value]));
  assertUnchangedBrowserSecurityHeaders(map);
  assertEnforcedCspUnchanged(map["Content-Security-Policy"]);
  assert.ok(map["Content-Security-Policy-Report-Only"],"Content-Security-Policy-Report-Only must exist as a separate header");
  assertCspReportOnlyPolicy(map["Content-Security-Policy-Report-Only"]);
  assert.ok(!Object.prototype.hasOwnProperty.call(map,"Strict-Transport-Security"));
  const vercelText=JSON.stringify(vercel);
  assert.doesNotMatch(vercelText,/Strict-Transport-Security/);
  assert.doesNotMatch(vercelText,/unsafe-eval/);
  assert.doesNotMatch(vercelText,/\*\.supabase\.co/);
  assert.doesNotMatch(vercelText,/wss:/i);
});

test("static-preview-server mirrors catch-all security headers including CSP Report-Only",()=>{
  const src=fs.readFileSync(path.join(__dirname,"..","scripts","static-preview-server.js"),"utf8");
  assert.match(src,/"X-Content-Type-Options":\s*"nosniff"/);
  assert.match(src,/"Referrer-Policy":\s*"strict-origin-when-cross-origin"/);
  assert.match(src,/"Permissions-Policy":\s*"camera=\(\), microphone=\(\), geolocation=\(\), payment=\(\), usb=\(\)"/);
  assert.match(src,/"X-Frame-Options":\s*"DENY"/);
  assert.match(src,/"Content-Security-Policy":\s*"frame-ancestors 'none'"/);
  assert.ok(src.includes(`"Content-Security-Policy-Report-Only": "${CSP_REPORT_ONLY}"`));
  assert.doesNotMatch(src,/Strict-Transport-Security/);
  assert.doesNotMatch(src,/unsafe-eval/);
  assert.doesNotMatch(src,/\*\.supabase\.co/);
  assert.doesNotMatch(src,/wss:/i);
});

test("supabase js is self-hosted at a pinned 2.45.4 UMD path",()=>{
  const admin=fs.readFileSync(path.join(__dirname,"..","admin.html"),"utf8");
  const reset=fs.readFileSync(path.join(__dirname,"..","reset-password.html"),"utf8");
  const member=fs.readFileSync(path.join(__dirname,"..","member.js"),"utf8");
  assert.match(admin,/vendor\/supabase-js-2\.45\.4\.umd\.js/);
  assert.match(reset,/vendor\/supabase-js-2\.45\.4\.umd\.js/);
  assert.match(member,/vendor\/supabase-js-2\.45\.4\.umd\.js/);
  assert.doesNotMatch(admin,/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\//);
  assert.doesNotMatch(member,/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\//);
  const umd=fs.readFileSync(path.join(__dirname,"..","vendor","supabase-js-2.45.4.umd.js"),"utf8");
  assert.match(umd,/createClient/);
});

test("shop templates escape mini/home/lightbox interpolation",()=>{
  const shop=fs.readFileSync(path.join(__dirname,"..","shop.js"),"utf8");
  assert.match(shop,/function miniCard\(b\)\{\s*const id=escapeAttr/);
  assert.match(shop,/function homeFeatureCard\(b\)\{\s*const id=escapeAttr/);
  assert.match(shop,/if\(!url\|\|!isSafeCoverUrl\(url\)\|\|isSampleDemoCover\(url\)\)return;/);
  assert.match(shop,/assignCoverImage\(picture,url\);/);
  assert.doesNotMatch(shop,/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\//);
});

if(failed)process.exit(1);
console.log("security-hardening-2a-tests ok");
