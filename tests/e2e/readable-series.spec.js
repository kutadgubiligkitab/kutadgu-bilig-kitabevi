const fs=require('node:fs');
const path=require('node:path');
const {test,expect}=require('./playwright-test');
const H=require('./helpers');
const F=require('../../scripts/readable-series-fixture');
let fixture,legacyFixture;
test.beforeAll(async()=>{fixture=await F.startServer();legacyFixture=await F.startServer({migrated:false})});
test.afterAll(async()=>{await fixture.close();await legacyFixture.close()});
const appConfig=fs.readFileSync(path.join(__dirname,'../../app-config.js'),'utf8').replace('multiVolumeBooks:false','multiVolumeBooks:true');
async function install(page,migrated=true){
 await H.installReadSafeNetwork(page);
 await page.addInitScript(()=>{localStorage.clear();sessionStorage.clear()});
 await page.route('**/app-config.js*',r=>r.fulfill({contentType:'text/javascript',body:appConfig}));
 await page.route('**/volume-cover-*.svg',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="#70503d"/></svg>'}));
 await page.route('**/rest/v1/**',async r=>{const req=r.request();if(/\/rpc\/(?:query_public_book_catalog|list_public_book_volume_discovery_unit_ids)/.test(req.url()))return r.fallback();const response=await F.fetchForState(migrated)(req.url(),{body:req.postData()});await r.fulfill({status:response.status,contentType:'application/json',headers:{'content-range':'0-1/2'},body:await response.text()})});

}
for(const migrated of [false,true])for(const width of [390,1280])test(`readable route ${migrated?'migrated':'legacy DB'} direct load, refresh, redirect and book navigation at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await install(page,migrated);
 const origin=migrated?fixture.origin:legacyFixture.origin;
 const groupPath=migrated?'/series/'+F.canonical:'/volume-group/'+F.legacy;
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let response=await page.goto(origin+groupPath,{waitUntil:'domcontentloaded'});
 expect(response.status()).toBe(200);const initial=await response.text();
 for(const m of F.members)expect(initial).toContain(`href="/book/${m.book_id}"`);
 await expect(page.locator('.volume-group-purchase-panel')).toBeVisible();
 await expect(page.locator('.volume-member-copy')).toHaveCount(2);
 await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href','https://www.kutadgubilik.com'+groupPath);
 await page.reload({waitUntil:'domcontentloaded'});await expect(page.locator('.volume-member-copy')).toHaveCount(2);
 const redirected=await page.goto(origin+'/volume-group/'+F.legacy+'?volume=2',{waitUntil:'domcontentloaded'});
 if(migrated){
  expect(redirected.request().redirectedFrom()).not.toBeNull();
  expect(redirected.request().redirectedFrom().redirectedFrom()).toBeNull();
  expect((await redirected.request().redirectedFrom().response()).status()).toBe(301);
 }else{expect(redirected.status()).toBe(200);expect(redirected.request().redirectedFrom()).toBeNull();expect(redirected.headers()['cache-control']).toContain('no-store');}
 await expect(page).toHaveURL(origin+groupPath+'?volume=2');
 await expect(page.locator('.volume-member-copy')).toHaveCount(2);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 expect(await page.locator('.volume-group-purchase-panel').evaluate(n=>getComputedStyle(n).direction)).toBe('rtl');
 await page.locator('[data-volume-book-id="1002"]').check();
 await expect(page.locator('[data-volume-selection-total]')).toContainText('90');
 await expect(page.locator('.book-cover-box img')).toHaveAttribute('src',/volume-cover-2\.svg/);
 await page.locator('.volume-add-selected').click();
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('kutadgu-cart-v1')||'[]'))).toEqual([{id:'1001',qty:1},{id:'1002',qty:1}]);
 await page.locator('.volume-add-set').click();
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('kutadgu-set-cart-v1')||'[]'))).toEqual([{kind:'set',group_id:'77',qty:1,quote_revision:'quote-r4'}]);

 await page.locator('.volume-member-copy[href="/book/1002"]').click();
 await expect(page).toHaveURL(/\/book\/1002$/);
 await expect(page.locator('.volume-group-purchase-panel')).toBeVisible();
 await expect(page.locator('[data-volume-book-id="1002"]')).toBeChecked();
 await expect(page.locator('h1')).toContainText(F.members[1].title);
 await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href','https://www.kutadgubilik.com/book/1002');
 expect(errors).toEqual([]);
});
test('unknown, malformed and private slugs stay unavailable',async({page})=>{
 await install(page);
 for(const p of ['/series/missing','/series/private-title','/volume-group/private-legacy','/series/bad_slug']){
  const response=await page.goto(fixture.origin+p,{waitUntil:'domcontentloaded'});expect(response.status(),p).toBe(404);
  await expect(page.locator('.volume-member-copy')).toHaveCount(0);
 }
});
