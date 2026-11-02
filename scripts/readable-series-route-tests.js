"use strict";
const assert=require("node:assert/strict");
const preview=require("../cloudflare/preview-dispatch.js");
const F=require("./readable-series-fixture.js");
const env={MULTI_VOLUME_BOOKS_ENABLED:"true"};
const request=(p,method="GET",deps=F.deps)=>preview.dispatch(new Request("http://127.0.0.1"+p,{method}),env,deps);
(async()=>{
 for(const alias of ["/volume-group/"+F.legacy,"/volume-group/"+F.canonical,"/series/"+F.legacy,"/series/"+F.canonical+"/","/series/"+F.canonical.toUpperCase()]){
  const r=await request(alias+"?volume=2&utm_source=shared");
  assert.equal(r.status,301,alias);assert.equal(r.headers.get("location"),"/series/"+F.canonical+"?volume=2&utm_source=shared");
  assert.equal((await request(r.headers.get("location"))).status,200);
 }
 console.log("PASS legacy and noncanonical aliases permanently redirect in one hop with queries");
 const html=await (await request("/series/"+F.canonical)).text();
 assert.match(html,new RegExp('rel="canonical" href="https://www.kutadgubilik.com/series/'+F.canonical+'"'));
 assert.match(html,/"@type":"BookSeries"/);assert.match(html,/data-volume-static-members/);
 for(const m of F.members)assert.ok(html.includes('href="/book/'+m.book_id+'"'));
 const head=await request("/series/"+F.canonical,"HEAD");assert.equal(head.status,200);assert.equal(await head.text(),"");
 assert.equal((await request("/book/1002")).status,200);
 console.log("PASS canonical GET/HEAD, initial member anchors, metadata and individual books");
 for(const p of ["/series/missing","/volume-group/private-legacy","/series/private-title","/series/%2Fbad","/series/bad_slug","/series/%E0%A4%A"]){
  const r=await request(p);assert.equal(r.status,404,p);assert.equal(r.headers.get("location"),null);
 }
 assert.equal((await request("/series/"+F.canonical,"GET",{...F.deps,fetchImpl:async()=>{throw Error("offline")}})).status,503);
 assert.equal((await preview.dispatch(new Request("http://127.0.0.1/series/"+F.canonical),{},F.deps)).status,404);
 console.log("PASS missing/invalid/private paths remain 404, failures 503, release flag respected");
 const handler=require("../api/volume-group-public.js");const oldFetch=global.fetch,oldFlag=process.env.MULTI_VOLUME_BOOKS_ENABLED;
 global.fetch=F.fetchImpl;process.env.MULTI_VOLUME_BOOKS_ENABLED="true";
 async function api(url){const r={headers:{},setHeader(k,v){this.headers[k]=v},end(body){this.body=body}};await handler({url},r);return r;}
 try{
  assert.equal((await api("/series/"+F.canonical)).statusCode,200);
  assert.equal((await api("/api/volume-group-public?route=series&slug="+F.canonical)).statusCode,200);
  for(const p of ["/volume-group/"+F.legacy,"/api/volume-group-public?route=series&slug="+F.legacy]){
   const r=await api(p+(p.includes("?")?"&":"?")+"volume=2");assert.equal(r.statusCode,301);assert.equal(r.headers.Location,"/series/"+F.canonical+"?volume=2");
  }
  assert.equal((await api("/volume-group/"+F.legacy+"?route=series&slug="+F.canonical)).statusCode,301);
  assert.equal((await api("/volume-group/"+F.legacy+"?slug=missing")).headers.Location,"/series/"+F.canonical+"?slug=missing");
  global.fetch=F.fetchForState(false);
  assert.equal((await api("/volume-group/"+F.legacy)).statusCode,200);
  assert.equal((await api("/api/volume-group-public?route=volume-group&slug="+F.legacy)).statusCode,200);
  const temporary=await api("/api/volume-group-public?route=series&slug="+F.legacy);
  assert.equal(temporary.statusCode,302);assert.equal(temporary.headers.Location,"/volume-group/"+F.legacy);assert.equal(temporary.headers['Cache-Control'],'no-store');
 }finally{global.fetch=oldFetch;if(oldFlag===undefined)delete process.env.MULTI_VOLUME_BOOKS_ENABLED;else process.env.MULTI_VOLUME_BOOKS_ENABLED=oldFlag;}
 console.log("PASS compatibility API rewrite and direct legacy routes use canonical URL");
})().catch(e=>{console.error(e);process.exitCode=1});
