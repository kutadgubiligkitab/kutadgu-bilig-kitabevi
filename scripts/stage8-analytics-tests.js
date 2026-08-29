#!/usr/bin/env node
"use strict";
const assert=require("assert");
const fs=require("fs");
const path=require("path");
const A=require("../kutadgu-analytics-core.js");

let failed=0;
function test(name,fn){
  try{fn();console.log("PASS",name)}
  catch(err){failed++;console.error("FAIL",name,err.message)}
}

test("E empty search is ignored",()=>{
  assert.deepStrictEqual(A.searchEvents("",12),[]);
  assert.deepStrictEqual(A.searchEvents("   ",0),[]);
  assert.strictEqual(A.shouldTrackSearch(""),false);
});

test("D F search tracks normalized query + result count; zero-result extra event",()=>{
  const hits=A.searchEvents("  قۇتادغۇ   بىلىك  ",4);
  assert.strictEqual(hits.length,1);
  assert.strictEqual(hits[0].name,"search");
  assert.strictEqual(hits[0].data.query,"قۇتادغۇ بىلىك");
  assert.strictEqual(hits[0].data.results,4);
  const zero=A.searchEvents("تېپىلمىغان كىتاب",0);
  assert.strictEqual(zero.length,2);
  assert.strictEqual(zero[0].name,"search");
  assert.strictEqual(zero[0].data.results,0);
  assert.strictEqual(zero[1].name,"zero_result_search");
});

test("G no sensitive form data stored",()=>{
  assert.deepStrictEqual(A.searchEvents("user@example.com",3),[]);
  assert.deepStrictEqual(A.searchEvents("+90 536 899 98 88",1),[]);
  assert.deepStrictEqual(A.searchEvents("parol12345",1),[]);
  assert.deepStrictEqual(A.searchEvents("پارول",1),[]);
  const row=A.buildRow("search",{query:"user@example.com",results:2},{path:"/index.html",sessionId:"s1"});
  assert.strictEqual(row,null);
  const wa=A.buildRow("whatsapp_order_click",{
    bookId:"102",bookIds:["102","103"],items:2,total:80,
    name:"Ali",phone:"+90536",address:"Istanbul",email:"a@b.c",message:"hello"
  },{path:"/cart.html",sessionId:"s1"});
  assert.ok(wa);
  assert.strictEqual(wa.book_id,"102");
  assert.deepStrictEqual(wa.meta.book_ids,["102","103"]);
  assert.ok(!JSON.stringify(wa).includes("Ali"));
  assert.ok(!JSON.stringify(wa).includes("a@b.c"));
  assert.ok(!JSON.stringify(wa).includes("Istanbul"));
  assert.ok(!JSON.stringify(wa).includes("hello"));
});

test("canonical book id preferred over legacy slug",()=>{
  const row=A.buildRow("book_view",{bookId:"102",legacyId:"children-3",category:"بالىلار"},{path:"/book.html",sessionId:"s"});
  assert.strictEqual(row.book_id,"102");
  assert.strictEqual(row.legacy_id,"children-3");
  assert.strictEqual(row.event_name,"book_view");
});

test("A book_view payload is one event object; unknown events dropped",()=>{
  assert.strictEqual(A.buildRow("book_view_spam",{bookId:"1"},{path:"/"}),null);
  const row=A.buildRow("book_view",{bookId:"1"},{path:"/book.html",sessionId:"s"});
  assert.strictEqual(row.event_name,"book_view");
  assert.ok(!("sales_count" in row));
});

test("B add_to_cart stores canonical id and qty, not sales_count",()=>{
  const row=A.buildRow("add_to_cart",{bookId:"88",qty:2},{path:"/romanlar.html",sessionId:"s"});
  assert.strictEqual(row.event_name,"add_to_cart");
  assert.strictEqual(row.book_id,"88");
  assert.strictEqual(row.item_count,2);
  assert.ok(!("sales_count" in row));
});

test("C whatsapp_order_click is one row with book_ids metadata",()=>{
  const row=A.buildRow("whatsapp_order_click",{bookId:"1",bookIds:["1","2"],items:2,total:50},{path:"/cart.html",sessionId:"s"});
  assert.strictEqual(row.event_name,"whatsapp_order_click");
  assert.strictEqual(row.book_id,"1");
  assert.deepStrictEqual(row.meta.book_ids,["1","2"]);
});

test("H I funnel percents only when denominator > 0",()=>{
  const empty=A.funnelFromCounts({book_views:0,cart_adds:4,whatsapp_clicks:1});
  assert.strictEqual(empty.view_to_cart_pct,null);
  const full=A.funnelFromCounts({book_views:100,cart_adds:25,whatsapp_clicks:5});
  assert.strictEqual(full.view_to_cart_pct,25);
  assert.strictEqual(full.cart_to_whatsapp_pct,20);
  assert.strictEqual(full.view_to_whatsapp_pct,5);
});

test("query length is capped",()=>{
  const long="ك".repeat(200);
  const ev=A.searchEvents(long,1);
  assert.ok(ev[0].data.query.length<=A.QUERY_MAX);
});

test("K shop.js does not increment sales_count from view/cart/whatsapp",()=>{
  const shop=fs.readFileSync(path.join(__dirname,"..","shop.js"),"utf8");
  assert.ok(shop.includes("trackBookViewOnce"));
  assert.ok(shop.includes("trackSearchQuery"));
  assert.ok(shop.includes("whatsapp_order_click"));
  const addFn=shop.slice(shop.indexOf("function add("),shop.indexOf("function remove("));
  assert.ok(!/sales_count\s*:/.test(addFn));
  assert.ok(!/salesCount\s*\+/.test(addFn));
  const wa=shop.slice(shop.indexOf("async function orderWithWhatsApp"),shop.indexOf("function setupCheckout"));
  assert.ok(!/sales_count/.test(wa));
  const view=shop.slice(shop.indexOf("function trackBookViewOnce"),shop.indexOf("function trackSearchQuery"));
  assert.ok(!/sales_count/.test(view));
});

test("A shop.js book_view is deduped per canonical id",()=>{
  const shop=fs.readFileSync(path.join(__dirname,"..","shop.js"),"utf8");
  assert.ok(shop.includes("trackedBookViews"));
  assert.ok(shop.includes("if(trackedBookViews.has(canonical))return"));
});

test("D shop.js ignores empty listing/home search and load-more",()=>{
  const shop=fs.readFileSync(path.join(__dirname,"..","shop.js"),"utf8");
  assert.ok(shop.includes("if(!append)trackSearchQuery(state.search,result.total)"));
  assert.ok(shop.includes("trackSearchQuery(text.value,result.total)"));
});

test("J admin analytics uses RPC not raw event table",()=>{
  const admin=fs.readFileSync(path.join(__dirname,"..","admin.js"),"utf8");
  assert.ok(admin.includes('rpc("get_kutadgu_analytics"'));
  assert.ok(!admin.includes('from("analytics_events")'));
  assert.ok(admin.includes("analyticsRange"));
});

test("L analytics.js track failures are swallowed",()=>{
  const js=fs.readFileSync(path.join(__dirname,"..","analytics.js"),"utf8");
  assert.ok(js.includes("analytics must never block the shop"));
  assert.ok(js.includes("try{"));
  const shop=fs.readFileSync(path.join(__dirname,"..","shop.js"),"utf8");
  assert.ok(shop.includes('const trackEvent=(name,data={})=>{try{window.KutadguAnalytics?.track?.(name,data)}catch(err){}}'));
});

test("SQL is repeat-safe and does not touch sales_count or delete events",()=>{
  const sql=fs.readFileSync(path.join(__dirname,"..","STAGE8_STORE_ANALYTICS.sql"),"utf8");
  assert.ok(/create or replace function public\.get_kutadgu_analytics/i.test(sql));
  assert.ok(/add column if not exists legacy_id/i.test(sql));
  assert.ok(/add column if not exists meta/i.test(sql));
  assert.ok(!/\bsales_count\b/i.test(sql));
  assert.ok(!/delete from public\.analytics_events/i.test(sql));
  assert.ok(!/service_role/i.test(sql.replace(/service_role ئاچىلمايدۇ/g,"")));
  assert.ok(sql.includes("funnel"));
  assert.ok(sql.includes("top_cart_books"));
  assert.ok(sql.includes("top_whatsapp_books"));
  assert.ok(sql.includes("top_searches"));
  assert.ok(sql.includes("p_days"));
});

test("H I date range 7 and 30 remain in Admin",()=>{
  const html=fs.readFileSync(path.join(__dirname,"..","admin.html"),"utf8");
  assert.ok(html.includes('value="7"'));
  assert.ok(html.includes('value="30"'));
  assert.ok(html.includes("WhatsApp زاكاز چېكىش"));
  assert.ok(html.includes("نەتىجىسىز ئىزدەش"));
});

if(failed){
  console.error(failed+" failed");
  process.exit(1);
}
console.log("stage8-analytics-tests ok");
