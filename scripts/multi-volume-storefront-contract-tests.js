"use strict";

const assert=require("assert");
const fs=require("fs");
const path=require("path");

const root=path.join(__dirname,"..");
global.KUTADGU_APP_CONFIG={featureFlags:{multiVolumeBooks:true}};
global.KUTADGU_SUPABASE_CONFIG={url:"https://example.supabase.co",anonKey:"public-key"};
const storefront=require(path.join(root,"kutadgu-volume-storefront.js"));
const publicGroups=require(path.join(root,"kutadgu-public-volume-group.js"));

let failed=0;
function test(name,fn){
  Promise.resolve().then(fn).then(()=>console.log(`✓ ${name}`)).catch(error=>{
    failed+=1;
    console.error(`✗ ${name}`);
    console.error(error&&error.stack||error);
  });
}
function member(position,overrides){
  return {
    book_id:String(1000+position),
    position,
    volume_label:`${position}-جىلد`,
    title:`Volume ${position}`,
    price:position*10,
    image_url:`/cover-${position}.jpg`,
    stock:5,
    stock_status:"in_stock",
    is_active:true,
    ...(overrides||{})
  };
}
function group(count,overrides){
  return {
    id:"77",
    slug:"sample-series",
    title:"Sample series",
    complete_set_price:null,
    representative_book_id:"1001",
    members:Array.from({length:count},(_,index)=>member(index+1)),
    ...(overrides||{})
  };
}

[2,3,8,9,10,37,100].forEach(count=>{
  test(`normalizes ${count} ordered volumes`,()=>{
    const value=storefront.normalizeGroup(group(count));
    assert.ok(value);
    assert.strictEqual(value.members.length,count);
    assert.strictEqual(value.members[0].position,1);
    assert.strictEqual(value.members[count-1].position,count);
  });
});

test("rejects unsupported group sizes",()=>{
  assert.strictEqual(storefront.normalizeGroup(group(1)),null);
  assert.strictEqual(storefront.normalizeGroup(group(101)),null);
  assert.strictEqual(storefront.normalizeGroup(group(2,{members:[member(1),member(1)]})),null);
  assert.strictEqual(storefront.normalizeGroup(group(2,{members:[member(1),member(2,{book_id:"1001"})]})),null);
});

test("catalog group keeps representative identity and stable group URL",()=>{
  const value=storefront.normalizeCatalogItem({
    kind:"group",group_id:77,group_slug:"sample-series",representative_book_id:1004,
    id:1004,title:"Series",price:12,member_book_ids:[1001,1002,1003,1004]
  });
  assert.strictEqual(value.id,"1004");
  assert.strictEqual(value.group_id,"77");
  assert.strictEqual(value.href,"/volume-group/sample-series");
  assert.strictEqual(value.price,12);
  assert.deepStrictEqual(value.member_book_ids,["1001","1002","1003","1004"]);
});

test("catalog query carries grouped-before-pagination filters",()=>{
  assert.deepStrictEqual(storefront.catalogQuery({
    search:"  history ",source:"romanlar.html",sort:"priceLow",minPrice:10,maxPrice:90,
    recommended:true,bestseller:true,newOnly:true,creditId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",creditRole:"author",
    ids:["group:7","book:9"],offset:24,pageSize:24
  }),{
    search:"history",category:"",source:"romanlar.html",sources:null,sort:"priceLow",
    min_price:10,max_price:90,recommended:true,bestseller:true,new_only:true,
    credit_id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",credit_role:"author",ids:["group:7","book:9"],offset:24,limit:24
  });
});

test("RPC catalog response preserves authoritative totals",async()=>{
  const response={
    ok:true,status:200,
    text:async()=>JSON.stringify({total:2,has_more:false,items:[
      {kind:"book",id:10,title:"Standalone",price:40},
      {kind:"group",id:1001,group_id:77,group_slug:"sample-series",title:"Series",price:10,member_book_ids:[1001,1002]}
    ]})
  };
  const page=await storefront.queryCatalog({offset:0,pageSize:24},{fetchImpl:async()=>response});
  assert.strictEqual(page.total,2);
  assert.strictEqual(page.items.length,2);
  assert.strictEqual(page.items[1].href,"/volume-group/sample-series");
});

test("public group SSR validates slug and emits BookSeries",()=>{
  const normalized=publicGroups.normalizeGroup(group(9),"sample-series");
  assert.ok(normalized);
  const graph=publicGroups.groupJsonLd(normalized,"https://www.kutadgubilik.com/volume-group/sample-series");
  assert.strictEqual(graph["@type"],"BookSeries");
  assert.strictEqual(graph.numberOfBooks,9);
  assert.strictEqual(graph.hasPart.length,9);
  assert.strictEqual(publicGroups.validSlug("../bad"),"");
  assert.strictEqual(publicGroups.normalizeGroup(group(2,{members:[member(1),member(1)]}),"sample-series"),null);
  assert.strictEqual(publicGroups.normalizeGroup(group(2,{members:[member(1),member(2,{book_id:"1001"})]}),"sample-series"),null);
});

test("admin workflow preserves IDs and uses revisioned RPCs",()=>{
  const source=fs.readFileSync(path.join(root,"admin-volume-groups.js"),"utf8");
  assert.match(source,/admin_save_book_volume_group/);
  assert.match(source,/p_expected_revision/);
  assert.match(source,/admin_set_book_volume_group_publication/);
  assert.match(source,/admin_preview_book_volume_members/);
  assert.doesNotMatch(source,/\\.from\\(["']books["']\\)\\.update/);
});

test("storefront is dark by default and grouping is server paginated",()=>{
  const config=fs.readFileSync(path.join(root,"app-config.js"),"utf8");
  const shop=fs.readFileSync(path.join(root,"shop.js"),"utf8");
  const vercel=JSON.parse(fs.readFileSync(path.join(root,"vercel.json"),"utf8"));
  assert.match(config,/multiVolumeBooks:false/);
  assert.match(shop,/grouped\.queryCatalog\(state/);
  assert.match(shop,/volumeGroupSlugFromLocation/);
  assert.match(shop,/renderVolumeGroupPurchasePanel/);
  assert.ok(vercel.rewrites.some(rule=>rule.source==="/volume-group/:slug"));
});

test("public server exposure requires an explicit release flag",()=>{
  const api=fs.readFileSync(path.join(root,"api","volume-group-public.js"),"utf8");
  const worker=fs.readFileSync(path.join(root,"cloudflare","preview-dispatch.js"),"utf8");
  assert.match(api,/MULTI_VOLUME_BOOKS_ENABLED/);
  assert.match(worker,/MULTI_VOLUME_BOOKS_ENABLED/);
});

process.on("beforeExit",()=>{
  if(failed){
    console.error(`multi-volume storefront contracts: ${failed} failed`);
    process.exitCode=1;
  }else console.log("multi-volume storefront contracts: PASS");
});
