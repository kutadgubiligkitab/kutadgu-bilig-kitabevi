const fs = require("fs");
const path = require("path");
const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const shell = fs.readFileSync(path.join(__dirname, "..", "..", "book-shell.html"), "utf8");
const appConfig = fs.readFileSync(path.join(__dirname, "..", "..", "app-config.js"), "utf8")
  .replace("multiVolumeBooks:false", "multiVolumeBooks:true");

async function openVolumeEditor(page, existing) {
  await H.installReadSafeNetwork(page);
  await page.addInitScript(() => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguSkipSuggestFetch = true;
    window.__kutadguSuggestionRows = [{id:156,author:"ئابدۇرېھىم ئۆتكۈر"}];
    window.__kutadguAdminPreviewBooks = [];
  });
  await page.goto("/admin.html", {waitUntil:"domcontentloaded"});
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  await page.evaluate((saved) => {
    window.__volumeEditorCalls = [];
    const rows = [156,157].map((id,index)=>({book_id:id,title:`ئويغانغان زېمىن ${index+1}. قىسىم`,author:"ئابدۇرېھىم ئۆتكۈر",price:index?399:370,stock:20,is_active:true}));
    window.KutadguAdminVolumeGroups.init({db:{rpc:async(name,args)=>{
      window.__volumeEditorCalls.push({name,args});
      if(name==="admin_preview_book_volume_members")return {data:rows.filter(b=>String(b.book_id)===String(args.p_book_id))};
      if(name==="admin_get_book_volume_group")return {data:saved};
      if(name==="admin_save_book_volume_group")return {data:{...args.p_group,id:args.p_group_id||77,revision:5,members:rows.map((b,i)=>({...b,position:i+1,volume_label:`${i+1}-قىسىم`}))}};
      if(name==="admin_create_book_volume_series"){
        if(window.__seriesHold){
          const gate=window.__seriesHold;
          window.__seriesHold=null;
          await gate;
        }
        const seriesResult=(replayed)=>({id:91,revision:1,slug:"series-new",title:args.p_payload.title,author:args.p_payload.author,category:args.p_payload.category,source:args.p_payload.source,complete_set_price:args.p_payload.complete_set_price,is_public:false,is_active:true,replayed,members:(args.p_payload.parts||[]).map((part,i)=>({book_id:900+i,position:i+1,volume_label:`${i+1}-قىسىم`,title:part.title,price:part.price,image_url:part.image_url,stock:part.stock}))});
        if(window.__seriesLoseOnce){
          window.__seriesLoseOnce=false;
          window.__seriesCommitted=JSON.parse(JSON.stringify(args));
          throw new TypeError("Failed to fetch");
        }
        if(window.__seriesCommitted){
          const same=JSON.stringify(window.__seriesCommitted.p_payload)===JSON.stringify(args.p_payload)
            && String(window.__seriesCommitted.p_request_id)===String(args.p_request_id);
          if(!same)return {data:null,error:{message:"idempotency_payload_mismatch",code:"23505",details:null,hint:null},status:409,statusText:"Conflict"};
          return {data:seriesResult(true)};
        }
        if(window.__seriesCreateFails){window.__seriesCreateFails-=1;return {data:null,error:{message:"series_create_failed",code:"P0001",details:null,hint:null},status:400,statusText:"Bad Request"};}
        return {data:seriesResult(false)};
      }
      if(name==="admin_get_book_volume_series_request"){
        if(!window.__seriesCommitted)return {error:{message:"series_request_not_committed",code:"P0002"}};
        const payload=window.__seriesCommitted.p_payload;
        return {data:{id:91,revision:1,slug:"series-new",title:payload.title,complete_set_price:payload.complete_set_price,is_public:false,replayed:true,members:(payload.parts||[]).map((part,i)=>({book_id:900+i,position:i+1,image_url:part.image_url,price:part.price}))}};
      }
      return {data:[]};
    }}});
  }, existing||null);
  await page.locator('button[data-admin-section="volume-groups"]').click();
  await page.locator("#newVolumeGroupBtn").click();
}

async function addEditorVolume(page,id) {
  await page.locator("#volumeGroupBookLookup").fill(String(id));
  await page.locator("#volumeGroupLookupBtn").click();
  await page.locator(`[data-lookup-add="${id}"]`).click();
}

test.describe("plain-language multi-volume admin editor",()=>{
  test("author and category use existing suggestions; refreshed author data appears",async({page})=>{
    await openVolumeEditor(page);
    await expect(page.locator("#volumeGroupSlug")).toBeHidden();
    await expect(page.locator("#volumeGroupSource")).toBeHidden();
    const author=page.locator("#volumeGroupAuthor");
    await author.fill("ئابدۇر");
    const options=page.locator("#volumeGroupAuthor").locator("..").getByRole("option");
    await expect(options).toHaveText(["ئابدۇرېھىم ئۆتكۈر"]);
    await author.press("Enter");
    await expect(author).toHaveValue("ئابدۇرېھىم ئۆتكۈر");
    await page.evaluate(()=>window.__kutadguSuggestionRows.push({id:9,author:"يېڭى ئاپتور"}));
    await author.fill("يېڭى");
    await expect(options).toHaveText(["يېڭى ئاپتور"]);
    await options.click();
    const category=page.locator("#volumeGroupCategory");
    await category.fill("تارىخىي");
    await category.locator("..").getByRole("option",{name:"تارىخىي رومانلار",exact:true}).click();
    await expect(category).toHaveValue("تارىخىي رومانلار");
    await expect(page.locator("#volumeGroupSource")).toHaveValue("tarikhiy-romanlar.html");
    await expect(page.locator("#volumeGroupsCard")).not.toContainText("slug");
  });

  test("new series saves summed-price intent and an automatic link without publishing",async({page})=>{
    await openVolumeEditor(page);
    await page.locator("#volumeGroupTitle").fill("ئويغانغان زېمىن");
    await page.locator("#volumeGroupCategory").fill("تارىخىي رومانلار");
    await addEditorVolume(page,156);
    await expect(page.locator("#volumeGroupAuthor")).toHaveValue("ئابدۇرېھىم ئۆتكۈر");
    await addEditorVolume(page,157);
    await page.locator('#volumeGroupForm button[type="submit"]').click();
    await expect(page.locator("#volumeGroupStatus")).toContainText("ساقلاندى");
    const calls=await page.evaluate(()=>window.__volumeEditorCalls);
    const saves=calls.filter(c=>c.name==="admin_save_book_volume_group");
    expect(saves).toHaveLength(1);
    expect(saves[0].args).toMatchObject({p_group_id:null,p_expected_revision:null,p_group:{slug:"series-156",category:"تارىخىي رومانلار",source:"tarikhiy-romanlar.html",complete_set_price:null},p_members:[{book_id:"156",position:1},{book_id:"157",position:2}]});
    expect(calls.some(c=>c.name==="admin_set_book_volume_group_publication")).toBe(false);
  });

  test("editing keeps the saved link, legacy routing, explicit price and revision",async({page})=>{
    await openVolumeEditor(page,{id:88,revision:4,slug:"existing-series",title:"بۇرۇنقى نام",category:"بۇرۇنقى تۈر",source:"existing-category.html",complete_set_price:700,is_active:true,members:[{book_id:156,position:1},{book_id:157,position:2}]});
    await page.evaluate(()=>window.KutadguAdminVolumeGroups.openGroup("88"));
    await page.locator("#volumeGroupTitle").fill("يېڭى نام");
    await page.locator('#volumeGroupForm button[type="submit"]').click();
    await expect(page.locator("#volumeGroupStatus")).toContainText("ساقلاندى");
    const args=await page.evaluate(()=>window.__volumeEditorCalls.find(c=>c.name==="admin_save_book_volume_group").args);
    expect(args).toMatchObject({p_group_id:"88",p_expected_revision:4,p_group:{slug:"existing-series",category:"بۇرۇنقى تۈر",source:"existing-category.html",complete_set_price:700}});
  });

  test("unknown edited category blocks a save and mobile controls fit",async({page})=>{
    await openVolumeEditor(page);
    await page.setViewportSize({width:390,height:844});
    await page.locator("#volumeGroupTitle").fill("ئويغانغان زېمىن");
    await addEditorVolume(page,156);
    await addEditorVolume(page,157);
    await page.locator("#volumeGroupCategory").fill("تىزىمدە يوق");
    await page.locator('#volumeGroupForm button[type="submit"]').click();
    expect(await page.evaluate(()=>document.querySelector("#volumeGroupCategory").validity.valid)).toBe(false);
    expect(await page.evaluate(()=>window.__volumeEditorCalls.filter(c=>c.name==="admin_save_book_volume_group").length)).toBe(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBe(true);
  });

  test("new series entry saves parts and an explicit price without publishing",async({page})=>{
    await openVolumeEditor(page);
    await expect(page.locator("#bookForm")).toHaveCount(1);
    await page.locator("#showVolumeSeriesBtn").click();
    await expect(page.locator("#volumeSeriesForm")).toBeVisible();
    await expect(page.locator("#volumeGroupForm")).toBeHidden();
    await expect(page.locator("#volumeSeriesSource")).toBeHidden();
    const tinyPng=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==","base64");
    await page.locator("#volumeSeriesTitle").fill("ئويغانغان زېمىن");
    await page.locator("#volumeSeriesCategory").fill("تارىخىي");
    await page.locator("#volumeSeriesCategory").locator("..").getByRole("option",{name:"تارىخىي رومانلار",exact:true}).click();
    await page.locator("#volumeSeriesSetPrice").fill("750");
    const parts=page.locator(".volume-series-part");
    await expect(parts).toHaveCount(2);
    await parts.nth(0).locator("[data-series-price]").fill("370");
    await parts.nth(0).locator("[data-series-stock]").fill("20");
    await parts.nth(0).locator("[data-series-cover]").setInputFiles({name:"part-1.png",mimeType:"image/png",buffer:tinyPng});
    await parts.nth(1).locator("[data-series-price]").fill("399");
    await parts.nth(1).locator("[data-series-stock]").fill("20");
    await parts.nth(1).locator("[data-series-cover]").setInputFiles({name:"part-2.png",mimeType:"image/png",buffer:tinyPng});
    await page.locator("#volumeSeriesAddPart").click();
    await expect(parts).toHaveCount(3);
    await parts.nth(2).locator("[data-series-remove]").click();
    await expect(parts).toHaveCount(2);
    await page.locator('#volumeSeriesForm button[type="submit"]').click();
    await expect(page.locator("#volumeSeriesStatus")).toContainText("ساقلاندى");
    const calls=await page.evaluate(()=>window.__volumeEditorCalls);
    const saves=calls.filter(c=>c.name==="admin_create_book_volume_series");
    expect(saves).toHaveLength(1);
    expect(saves[0].args.p_payload.complete_set_price).toBe(750);
    expect(saves[0].args.p_payload.parts.map(part=>part.price)).toEqual([370,399]);
    expect(saves[0].args.p_payload.parts[0].image_url).toContain("/book-covers/series-new/");
    expect(calls.some(c=>c.name==="admin_set_book_volume_group_publication")).toBe(false);
    await page.setViewportSize({width:390,height:844});
    await page.locator("#showVolumeSeriesBtn").click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBe(true);
  });

  test("a failed series save retries the same request and discards only the new covers",async({page})=>{
    await openVolumeEditor(page);
    await page.evaluate(()=>{window.__seriesCreateFails=1;window.__kutadguDiscardedSeriesCovers=[];});
    await page.locator("#showVolumeSeriesBtn").click();
    const tinyPng=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==","base64");
    await page.locator("#volumeSeriesTitle").fill("ئويغانغان زېمىن");
    await page.locator("#volumeSeriesCategory").fill("تارىخىي رومانلار");
    await page.locator("#volumeSeriesSetPrice").fill("750");
    const parts=page.locator(".volume-series-part");
    for(const index of [0,1]){
      await parts.nth(index).locator("[data-series-price]").fill(index?"399":"370");
      await parts.nth(index).locator("[data-series-stock]").fill("8");
      await parts.nth(index).locator("[data-series-cover]").setInputFiles({name:`part-${index+1}.png`,mimeType:"image/png",buffer:tinyPng});
    }
    const requestId=await page.locator("#volumeSeriesRequestId").inputValue();
    await page.locator('#volumeSeriesForm button[type="submit"]').click();
    await expect(page.locator("#volumeSeriesStatus")).toContainText("series_create_failed");
    expect(await page.locator("#volumeSeriesRequestId").inputValue()).toBe(requestId);
    const discarded=await page.evaluate(()=>window.__kutadguDiscardedSeriesCovers||[]);
    expect(discarded.length).toBe(2);
    expect(discarded.every(key=>key.startsWith(`book-covers/series-new/${requestId}/`))).toBe(true);
    await page.locator('#volumeSeriesForm button[type="submit"]').click();
    await expect(page.locator("#volumeSeriesStatus")).toContainText("ساقلاندى");
    const saves=await page.evaluate(()=>window.__volumeEditorCalls.filter(c=>c.name==="admin_create_book_volume_series"));
    expect(saves).toHaveLength(2);
    expect(saves[0].args.p_request_id).toBe(requestId);
    expect(saves[1].args.p_request_id).toBe(requestId);
    expect(saves[1].args.p_payload.complete_set_price).toBe(750);
  });

  test("a lost response keeps the committed payload and the same covers",async({page})=>{
    await openVolumeEditor(page);
    await page.evaluate(()=>{
      window.__seriesLoseOnce=true;
      window.__seriesUploads=0;
      window.__kutadguDiscardedSeriesCovers=[];
      const upload=window.kutadguUploadSeriesPartCover;
      window.kutadguUploadSeriesPartCover=async(requestId,position,file)=>{
        window.__seriesUploads+=1;
        return upload(requestId,position,file);
      };
    });
    await page.locator("#showVolumeSeriesBtn").click();
    const tinyPng=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==","base64");
    await page.locator("#volumeSeriesTitle").fill("ئويغانغان زېمىن");
    await page.locator("#volumeSeriesCategory").fill("تارىخىي رومانلار");
    await page.locator("#volumeSeriesSetPrice").fill("750");
    const parts=page.locator(".volume-series-part");
    for(const index of [0,1]){
      await parts.nth(index).locator("[data-series-price]").fill(index?"399":"370");
      await parts.nth(index).locator("[data-series-stock]").fill("8");
      await parts.nth(index).locator("[data-series-cover]").setInputFiles({name:`part-${index+1}.png`,mimeType:"image/png",buffer:tinyPng});
    }
    const requestId=await page.locator("#volumeSeriesRequestId").inputValue();
    await page.locator('#volumeSeriesForm button[type="submit"]').click();
    await expect(page.locator("#volumeSeriesStatus")).toContainText("جاۋاب يېتىپ كەلمىدى");
    expect(await page.locator("#volumeSeriesRequestId").inputValue()).toBe(requestId);
    expect(await page.evaluate(()=>window.__kutadguDiscardedSeriesCovers||[])).toEqual([]);
    expect(await page.evaluate(()=>window.__seriesUploads)).toBe(2);
    await page.locator("#volumeSeriesTitle").fill("باشقا نام");
    await page.locator('#volumeSeriesForm button[type="submit"]').click();
    await expect(page.locator("#volumeSeriesStatus")).toContainText("ئاللىقاچان ساقلانغان");
    const saves=await page.evaluate(()=>window.__volumeEditorCalls.filter(c=>c.name==="admin_create_book_volume_series"));
    expect(saves).toHaveLength(2);
    expect(saves[0].args.p_request_id).toBe(requestId);
    expect(saves[1].args).toEqual(saves[0].args);
    expect(saves[1].args.p_payload.title).toBe("ئويغانغان زېمىن");
    expect(saves[1].args.p_payload.complete_set_price).toBe(750);
    expect(await page.evaluate(()=>window.__seriesUploads)).toBe(2);
    expect(await page.evaluate(()=>window.__kutadguDiscardedSeriesCovers||[])).toEqual([]);
  });

  test("covers stay while a committed save is still answering",async({page})=>{
    await openVolumeEditor(page);
    await page.evaluate(()=>{
      window.__seriesHold=new Promise(resolve=>{window.__releaseSeriesHold=resolve;});
      window.__seriesUploads=0;
      window.__kutadguDiscardedSeriesCovers=[];
      const upload=window.kutadguUploadSeriesPartCover;
      window.kutadguUploadSeriesPartCover=async(requestId,position,file)=>{
        window.__seriesUploads+=1;
        return upload(requestId,position,file);
      };
    });
    await page.locator("#showVolumeSeriesBtn").click();
    const tinyPng=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==","base64");
    await page.locator("#volumeSeriesTitle").fill("ئويغانغان زېمىن");
    await page.locator("#volumeSeriesCategory").fill("تارىخىي رومانلار");
    await page.locator("#volumeSeriesSetPrice").fill("750");
    const parts=page.locator(".volume-series-part");
    for(const index of [0,1]){
      await parts.nth(index).locator("[data-series-price]").fill(index?"399":"370");
      await parts.nth(index).locator("[data-series-stock]").fill("8");
      await parts.nth(index).locator("[data-series-cover]").setInputFiles({name:`part-${index+1}.png`,mimeType:"image/png",buffer:tinyPng});
    }
    await page.locator('#volumeSeriesForm button[type="submit"]').click();
    await expect.poll(()=>page.evaluate(()=>window.__volumeEditorCalls.filter(c=>c.name==="admin_create_book_volume_series").length)).toBe(1);
    expect(await page.evaluate(()=>window.__kutadguDiscardedSeriesCovers||[])).toEqual([]);
    expect(await page.evaluate(()=>window.__seriesUploads)).toBe(2);
    await page.evaluate(()=>window.__releaseSeriesHold());
    await expect(page.locator("#volumeSeriesStatus")).toContainText("ساقلاندى");
    expect(await page.evaluate(()=>window.__kutadguDiscardedSeriesCovers||[])).toEqual([]);
    expect(await page.evaluate(()=>window.__seriesUploads)).toBe(2);
  });
});

async function openSupabaseSeries(page){
  await H.installReadSafeNetwork(page);
  await page.addInitScript(()=>{
    window.__kutadguSkipAdminAuth=true;
    window.__kutadguSkipSuggestFetch=true;
    window.__kutadguSuggestionRows=[{id:156,author:"ئابدۇرېھىم ئۆتكۈر"}];
    window.__kutadguAdminPreviewBooks=[];
  });
  await page.goto("/admin.html",{waitUntil:"domcontentloaded"});
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  await page.evaluate(()=>{
    window.__seriesCalls=[];
    window.__seriesUploads=0;
    window.__kutadguDiscardedSeriesCovers=[];
    window.__seriesNextStatus=0;
    const upload=window.kutadguUploadSeriesPartCover;
    window.kutadguUploadSeriesPartCover=async(requestId,position,file)=>{
      window.__seriesUploads+=1;
      return upload(requestId,position,file);
    };
    const client=window.supabase.createClient("https://example.supabase.co","anon-key",{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      global:{
        fetch:async(url,options)=>{
          const href=String(url);
          const name=(href.split("/rpc/")[1]||"").split("?")[0];
          let args={};
          try{args=JSON.parse(options&&options.body||"{}")}catch(error){args={}}
          if(name==="admin_create_book_volume_series"){
            const status=window.__seriesNextStatus||200;
            window.__seriesNextStatus=0;
            window.__seriesCalls.push({status,args});
            if(status>=500){
              const message=status===502?"Bad Gateway":"Internal Server Error";
              window.__seriesCommitted=JSON.parse(JSON.stringify(args));
              return new Response(JSON.stringify({message}),{status,statusText:message,headers:{"content-type":"application/json"}});
            }
            const committed=window.__seriesCommitted;
            const same=committed
              && JSON.stringify(committed.p_payload)===JSON.stringify(args.p_payload)
              && String(committed.p_request_id)===String(args.p_request_id);
            if(committed&&!same){
              return new Response(JSON.stringify({code:"23505",details:null,hint:null,message:"idempotency_payload_mismatch"}),{status:409,statusText:"Conflict",headers:{"content-type":"application/json"}});
            }
            const payload=args.p_payload||{};
            return new Response(JSON.stringify({
              id:91,revision:1,slug:"series-new",title:payload.title,complete_set_price:payload.complete_set_price,
              is_public:false,replayed:!!committed,
              members:(payload.parts||[]).map((part,index)=>({book_id:900+index,position:index+1,image_url:part.image_url,price:part.price}))
            }),{status:200,headers:{"content-type":"application/json"}});
          }
          return new Response("[]",{status:200,headers:{"content-type":"application/json"}});
        }
      }
    });
    window.KutadguAdminVolumeGroups.init({db:client});
  });
  await page.locator('button[data-admin-section="volume-groups"]').click();
  await page.locator("#newVolumeGroupBtn").click();
}

async function fillSeriesParts(page){
  const tinyPng=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==","base64");
  await page.locator("#showVolumeSeriesBtn").click();
  await page.locator("#volumeSeriesTitle").fill("ئويغانغان زېمىن");
  await page.locator("#volumeSeriesCategory").fill("تارىخىي رومانلار");
  await page.locator("#volumeSeriesSetPrice").fill("750");
  const parts=page.locator(".volume-series-part");
  for(const index of [0,1]){
    await parts.nth(index).locator("[data-series-price]").fill(index?"399":"370");
    await parts.nth(index).locator("[data-series-stock]").fill("8");
    await parts.nth(index).locator("[data-series-cover]").setInputFiles({name:`part-${index+1}.png`,mimeType:"image/png",buffer:tinyPng});
  }
}

test.describe("series save gateway responses",()=>{
  for(const status of [502,500]){
    test(`HTTP ${status} keeps the request, payload, and covers`,async({page})=>{
      await openSupabaseSeries(page);
      const message=status===502?"Bad Gateway":"Internal Server Error";
      const shape=await page.evaluate(async(sample)=>{
        const client=window.supabase.createClient("https://example.supabase.co","anon-key",{
          auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
          global:{fetch:async()=>new Response(JSON.stringify({message:sample.message}),{status:sample.status,statusText:sample.message,headers:{"content-type":"application/json"}})}
        });
        const result=await client.rpc("admin_create_book_volume_series",{p_request_id:"00000000-0000-4000-8000-000000000000",p_payload:{}});
        return {status:result.status,message:result.error&&result.error.message,errorStatus:result.error?Object.prototype.hasOwnProperty.call(result.error,"status"):false,code:result.error&&result.error.code||null};
      },{status,message});
      expect(shape).toEqual({status,message,errorStatus:false,code:null});
      await fillSeriesParts(page);
      const requestId=await page.locator("#volumeSeriesRequestId").inputValue();
      await page.evaluate((next)=>window.__seriesNextStatus=next,status);
      await page.locator('#volumeSeriesForm button[type="submit"]').click();
      await expect(page.locator("#volumeSeriesStatus")).toContainText("جاۋاب يېتىپ كەلمىدى");
      expect(await page.locator("#volumeSeriesRequestId").inputValue()).toBe(requestId);
      expect(await page.evaluate(()=>window.__seriesUploads)).toBe(2);
      expect(await page.evaluate(()=>window.__kutadguDiscardedSeriesCovers||[])).toEqual([]);
      await page.locator("#volumeSeriesTitle").fill("باشقا نام");
      await page.locator('#volumeSeriesForm button[type="submit"]').click();
      await expect(page.locator("#volumeSeriesStatus")).toContainText("ئاللىقاچان ساقلانغان");
      const calls=await page.evaluate(()=>window.__seriesCalls);
      expect(calls.map(call=>call.status)).toEqual([status,200]);
      expect(calls[0].args.p_request_id).toBe(requestId);
      expect(calls[1].args).toEqual(calls[0].args);
      expect(calls[1].args.p_payload.title).toBe("ئويغانغان زېمىن");
      expect(calls[1].args.p_payload.complete_set_price).toBe(750);
      expect(calls[1].args.p_payload.parts.map(part=>part.image_url)).toEqual(calls[0].args.p_payload.parts.map(part=>part.image_url));
      expect(await page.evaluate(()=>window.__seriesUploads)).toBe(2);
      expect(await page.evaluate(()=>window.__kutadguDiscardedSeriesCovers||[])).toEqual([]);
    });
  }
});

const members = [
  {
    book_id: "1001", position: 1, volume_label: "1-جىلد", title: "بىرىنچى جىلد",
    author: "سىناق ئاپتور", price: 35, image_url: "/volume-cover-1.svg",
    stock: 4, stock_status: "in_stock", is_active: true
  },
  {
    book_id: "1002", position: 2, volume_label: "2-جىلد", title: "ئىككىنچى جىلد",
    author: "سىناق ئاپتور", price: 55, image_url: "/volume-cover-2.svg",
    stock: 2, stock_status: "in_stock", is_active: true
  },
  {
    book_id: "1003", position: 3, volume_label: "3-جىلد", title: "ئۈچىنچى جىلد",
    author: "سىناق ئاپتور", price: 65, image_url: "/volume-cover-3.svg",
    stock: 0, stock_status: "out_of_stock", is_active: true
  }
];

const group = {
  id: "77",
  slug: "sample-series",
  title: "سىناق توپلام",
  author: "سىناق ئاپتور",
  category: "رومانلار",
  source: "romanlar.html",
  description: "ئۈچ جىلدلىق سىناق توپلام",
  complete_set_price: 125,
  effective_set_price: 125,
  representative_book_id: "1001",
  revision: 4,
  quote_revision: "quote-r4",
  members
};

function book(member) {
  return {
    id: Number(member.book_id),
    title: member.title,
    author: member.author,
    category: "رومانلار",
    source: "romanlar.html",
    description: member.title,
    price: member.price,
    image_url: member.image_url,
    stock: member.stock,
    stock_status: member.stock_status,
    is_active: true,
    submission_status: "approved",
    created_at: "2026-10-20T00:00:00Z"
  };
}

async function installFixture(page) {
  await H.installReadSafeNetwork(page);
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.removeItem("kutadgu-catalog-active-count-v1");
    } catch (error) {}
  });
  await page.route("**/volume-group/sample-series**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: shell
  }));
  await page.route("**/book/1002**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: shell
  }));
  await page.route("**/app-config.js*", (route) => route.fulfill({
    status: 200,
    contentType: "text/javascript; charset=utf-8",
    body: appConfig
  }));
  await page.route("**/volume-cover-*.svg", (route) => route.fulfill({
    status: 200,
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="#70503d"/></svg>'
  }));
  await page.route("**/auth/v1/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ user: null })
  }));
  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.includes("/rest/v1/books")) {
      if (request.method() === "HEAD") {
        return route.fulfill({
          status: 200,
          headers: { "content-range": "0-0/3" },
          body: ""
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-2/3" },
        body: JSON.stringify(members.map(book))
      });
    }
    if (url.includes("/rpc/get_public_book_volume_group_storefront")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(group) });
    }
    if (url.includes("/rpc/resolve_public_book_volume_context")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          book: book(members[1]),
          group,
          selected_book_id: "1002",
          canonical_path: "/book/1002"
        })
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

test.describe("multi-volume storefront", () => {
  test.beforeEach(async ({ page }) => {
    await installFixture(page);
  });

  test("group page selects available volumes and blocks an incomplete set", async ({ page }) => {
    await page.goto("/volume-group/sample-series", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".volume-group-purchase-panel")).toBeVisible();
    await expect(page.locator("[data-volume-book-id]")).toHaveCount(3);
    await expect(page.locator(".volume-set-price")).toContainText("125");
    await expect(page.locator(".volume-add-set")).toBeDisabled();
    await expect(page.locator(".cart-stock-block-note")).toBeVisible();
    await expect(page.locator("[data-volume-book-id='1003']")).toBeDisabled();

    await page.locator("[data-volume-book-id='1002']").check();
    await expect(page.locator("[data-volume-selection-summary]")).toContainText("55");
    await expect(page.locator(".book-cover-box img")).toHaveAttribute("src", /volume-cover-2\.svg/);
    await page.locator(".volume-add-selected").click();
    await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("kutadgu-cart-v1") || "[]")))
      .toEqual([{ id: "1001", qty: 1 }, { id: "1002", qty: 1 }]);
  });

  test("owner series shows the explicit 750 beside part prices 370 and 399", async ({ page }) => {
    const ownerMembers = [
      { book_id: "156", position: 1, volume_label: "1-قىسىم", title: "ئويغانغان زېمىن 1. قىسىم", author: "ئابدۇرېھىم ئۆتكۈر", price: 370, image_url: "/volume-cover-1.svg", stock: 20, stock_status: "in_stock", is_active: true },
      { book_id: "157", position: 2, volume_label: "2-قىسىم", title: "ئويغانغان زېمىن 2. قىسىم", author: "ئابدۇرېھىم ئۆتكۈر", price: 399, image_url: "/volume-cover-2.svg", stock: 20, stock_status: "in_stock", is_active: true }
    ];
    const ownerGroup = {
      id: "1", slug: "series-156", title: "ئويغانغان زېمىن", author: "ئابدۇرېھىم ئۆتكۈر",
      category: "تارىخىي رومانلار", source: "tarikhiy-romanlar.html", description: "",
      complete_set_price: 750, effective_set_price: 750, representative_book_id: "156",
      revision: 2, quote_revision: "quote-owner", members: ownerMembers
    };
    await page.route("**/rpc/get_public_book_volume_group_storefront", (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify(ownerGroup)
    }));
    await page.route("**/rest/v1/books**", (route) => {
      const ownerBooks = ownerMembers.map(book);
      if (route.request().method() === "HEAD") {
        return route.fulfill({ status: 200, headers: { "content-range": "0-1/2" }, body: "" });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-1/2" },
        body: JSON.stringify(ownerBooks)
      });
    });
    await page.route("**/volume-group/series-156**", (route) => route.fulfill({
      status: 200, contentType: "text/html; charset=utf-8", body: shell
    }));
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/volume-group/series-156", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".volume-set-price")).toContainText("750");
    await expect(page.locator(".volume-set-price")).toContainText("بېكىتىلگەن يۈرۈشلۈك باھاسى");
    await expect(page.locator(".volume-group-price-range")).toContainText("370");
    await expect(page.locator(".volume-group-price-range")).toContainText("399");
    await expect(page.locator(".volume-member-price").nth(0)).toContainText("370");
    await expect(page.locator(".volume-member-price").nth(1)).toContainText("399");
    await expect(page.locator(".volume-set-price")).not.toContainText("769");
    const card = await page.evaluate(() => window.kutadguShop.bookCardMarkup({
      id: "156", catalogKind: "group", groupId: "1", title: "ئويغانغان زېمىن", author: "ئابدۇرېھىم ئۆتكۈر",
      memberCount: 2, memberPrices: [370, 399], completeSetPrice: 750, effectiveSetPrice: 750,
      price: 370, href: "/volume-group/series-156"
    }));
    expect(card.match(/<article/g)).toHaveLength(1);
    expect(card).toContain("750");
    expect(card).toContain("370");
    expect(card).toContain("399");
    expect(card).not.toContain("769");
    const summed = await page.evaluate(() => window.kutadguShop.bookCardMarkup({
      id: "200", catalogKind: "group", groupId: "2", title: "يىغىندا", memberCount: 2,
      memberPrices: [370, 399], completeSetPrice: null, effectiveSetPrice: 769, price: 370,
      href: "/volume-group/summed"
    }));
    expect(summed).toContain("تولۇق يۈرۈشلۈك");
    expect(summed).toContain("769");
    expect(summed).not.toContain("بېكىتىلگەن يۈرۈشلۈك باھاسى");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  });

  test("grouped catalog shows one series card per page and keeps the explicit price", async ({ page }) => {
    const units = Array.from({ length: 25 }, (_, index) => {
      const number = index + 1;
      const owner = number === 1;
      const summed = number === 2;
      return {
        kind: "group",
        id: owner ? "156" : String(200 + number),
        group_id: String(number),
        group_slug: owner ? "series-156" : `series-page-${number}`,
        unit_key: `group:${number}`,
        representative_book_id: owner ? "156" : String(200 + number),
        member_book_ids: owner ? ["156", "157"] : [String(200 + number), String(500 + number)],
        member_count: 2,
        member_prices: owner || summed ? [370, 399] : [10, 11],
        title: owner ? "ئويغانغان زېمىن" : `يۈرۈشلۈك ${number}`,
        author: "ئابدۇرېھىم ئۆتكۈر",
        category: "تارىخىي رومانلار",
        source: "tarikhiy-romanlar.html",
        image_url: "/volume-cover-1.svg",
        price: owner || summed ? 370 : 10,
        complete_set_price: owner ? 750 : null,
        effective_set_price: owner ? 750 : 769,
        is_active: true,
        stock: 8,
        stock_status: "in_stock"
      };
    });
    const queries = [];
    await page.route("**/rpc/query_public_book_catalog", async (route) => {
      const body = route.request().postDataJSON() || {};
      const query = body.p_query || {};
      queries.push(query);
      const offset = Number(query.offset) || 0;
      const limit = Math.max(1, Number(query.limit) || 24);
      let rows = units;
      if (Array.isArray(query.ids) && query.ids.length) {
        const wanted = new Set(query.ids.map(String));
        rows = units.filter((unit) => wanted.has(unit.unit_key));
      } else {
        rows = units.slice(offset, offset + limit);
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: rows, total: units.length, has_more: offset + rows.length < units.length })
      });
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/tarikhiy-romanlar.html", { waitUntil: "domcontentloaded" });
    const grid = page.locator(".books-grid[data-catalog-source]");
    await expect(grid).toHaveAttribute("data-catalog-client", "1");
    await expect(grid.locator(".book-card")).toHaveCount(24);
    await expect(grid.locator('a.detail-button[href="/volume-group/series-156"]')).toHaveCount(1);
    await expect(grid.locator('a[href="/book/156"], a[href="/book/157"]')).toHaveCount(0);
    const ownerCard = grid.locator(".book-card", { has: page.locator('a.detail-button[href="/volume-group/series-156"]') });
    await expect(ownerCard).toContainText("750");
    await expect(ownerCard).toContainText("370");
    await expect(ownerCard).toContainText("399");
    await expect(ownerCard).toContainText("بېكىتىلگەن يۈرۈشلۈك باھاسى");
    await expect(ownerCard).not.toContainText("769");
    const summedCard = grid.locator(".book-card", { has: page.locator('a.detail-button[href="/volume-group/series-page-2"]') });
    await expect(summedCard).toContainText("تولۇق يۈرۈشلۈك");
    await expect(summedCard).toContainText("769");
    await expect(summedCard).not.toContainText("بېكىتىلگەن يۈرۈشلۈك باھاسى");
    expect(queries[0]).toMatchObject({ offset: 0, limit: 24, source: "tarikhiy-romanlar.html" });
    expect(queries.some((query) => Array.isArray(query.ids) && query.ids.some((id) => String(id) === "156" || String(id) === "157"))).toBe(false);
    await page.locator(".catalog-load-more").click();
    await expect(grid.locator(".book-card")).toHaveCount(25);
    expect(queries.some((query) => query.offset === 24 && query.limit === 24)).toBe(true);
    await expect(grid.locator('a[href="/book/156"], a[href="/book/157"]')).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(grid).toHaveAttribute("data-catalog-client", "1");
    await expect(grid.locator(".book-card")).toHaveCount(12);
    const mobileOwner = grid.locator(".book-card", { has: page.locator('a.detail-button[href="/volume-group/series-156"]') });
    const box = await mobileOwner.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(391);
    expect(queries.some((query) => query.offset === 0 && query.limit === 12)).toBe(true);
  });

  test("direct child link keeps that volume selected in group context", async ({ page }) => {
    await page.goto("/book/1002", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".volume-group-purchase-panel")).toBeVisible();
    await expect(page.locator("[data-volume-book-id='1002']")).toBeChecked();
    await expect(page.locator("[data-volume-selection-summary]")).toContainText("ئىككىنچى جىلد");
    await expect(page.locator(".volume-group-stable-link")).toHaveAttribute("href", "/volume-group/sample-series");
  });
});
