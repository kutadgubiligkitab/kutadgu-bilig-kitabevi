// Real isolated SQL + actual Worker dispatcher; no production network access.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE||'/tmp/kutadgu-series-pglite/node_modules/@electric-sql/pglite/dist/index.js'));
const db=new PGlite();
const preview=require('../cloudflare/preview-dispatch');
const F=require('./readable-series-fixture');
const routes=require('../kutadgu-series-routes');
const sitemap=require('../kutadgu-sitemap');
const listing=require('../kutadgu-category-listing');
const env={KUTADGU_HOST_MODE:'production',MULTI_VOLUME_BOOKS_ENABLED:'true'};
let directoryOutage=false;
const fetchImpl=async(url,options={})=>{
 const name=String(url).split('/rpc/')[1];const args=JSON.parse(options.body||'{}');
 if(name==='list_public_book_series_routes'){
  if(directoryOutage)return new Response('{}',{status:503});
  if(!(await db.query("SELECT to_regprocedure('public.list_public_book_series_routes()') AS f")).rows[0].f)return Response.json({code:'PGRST202'},{status:404});
  return Response.json((await db.query('SELECT public.list_public_book_series_routes() AS v')).rows[0].v);
 }
 if(name==='get_public_book_volume_group_storefront')return Response.json((await db.query('SELECT public.get_public_book_volume_group_storefront($1,$2,$3) AS v',[args.p_group_id,args.p_slug,args.p_child_book_id])).rows[0].v);
 if(String(url).includes('/rest/v1/books')){
  const id=new URL(url).searchParams.get('id')?.replace('eq.','');
  return Response.json((await db.query('SELECT * FROM public.books WHERE id=$1',[id])).rows);
 }
 return Response.json([]);
};
const deps={...F.deps,fetchImpl};
const request=p=>preview.dispatch(new Request('https://www.kutadgubilik.com'+p),env,deps);
const definitions=async()=>(await db.query("SELECT proname,pg_get_functiondef(oid) AS body FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('query_public_book_catalog','get_public_book_volume_group_storefront','resolve_public_book_volume_context','list_public_book_volume_sitemap_entries') ORDER BY proname")).rows;
try{
 for(const file of ['scripts/stage127-isolated-fixture.sql','scripts/stage130-isolated-fixture.sql','STAGE127_BOOK_VOLUME_GROUPS.sql','STAGE130_BOOK_VOLUME_STOREFRONT.sql'])await db.exec(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'));
 await db.exec("INSERT INTO public.book_volume_groups(slug,title,is_public) VALUES('series-old','ئويغانغان زېمىن',true),('private-alias','Hidden',false);INSERT INTO public.book_volume_group_members(group_id,book_id,position) VALUES(1,1,1),(1,2,2),(2,3,1),(2,4,2)");
 const original=await definitions();
 const legacyPayload=(await db.query("SELECT public.get_public_book_volume_group_storefront(NULL,'series-old',NULL) AS v")).rows[0].v;
 const checkLinks=async(expected)=>{
  const directory=await routes.load({fetchImpl});
  const row=routes.enrich({kind:'group',group_id:1,group_slug:'series-old',id:1,title:'Series',member_book_ids:[1,2]},directory);
  assert.equal(routes.groupPath(row),expected);
  assert(sitemap.groupedRowToSitemapEntry({...row,slug:'series-old'}).loc.endsWith(expected));
  assert(listing.listingCardMarkup(row).includes('href="'+expected+'"'));
 };
 await checkLinks('/volume-group/series-old');
 const before=await request('/volume-group/series-old');assert.equal(before.status,200);assert.equal(before.headers.get('location'),null);assert.match(before.headers.get('cache-control'),/no-store/);
 const temporary=await request('/series/series-old');assert.equal(temporary.status,302);assert.equal(temporary.headers.get('cache-control'),'no-store');assert(!temporary.headers.get('location').includes('/series/'));
 console.log('PASS compatibility app before SQL: legacy 200, no temporary permanent redirect, old links/canonical');
 await db.exec(fs.readFileSync(new URL('../STAGE138_READABLE_SERIES_URLS.sql',import.meta.url),'utf8'));
 assert.deepEqual(await definitions(),original);
 assert.deepEqual((await db.query("SELECT public.get_public_book_volume_group_storefront(NULL,'series-old',NULL) AS v")).rows[0].v,legacyPayload);
 console.log('PASS all existing catalog/group/context/sitemap RPC definitions and legacy group payload unchanged');
 const checkPublished=async()=>{
  await checkLinks('/series/oyghanghan-zemin');
  for(const host of ['www.kutadgubilik.com','kutadgubilik.com']){
   const redirect=await preview.dispatch(new Request('https://'+host+'/volume-group/series-old?volume=2'),env,deps);
   assert.equal(redirect.status,301);assert.equal(redirect.headers.get('location'),'https://www.kutadgubilik.com/series/oyghanghan-zemin?volume=2');
   const final=await preview.dispatch(new Request(redirect.headers.get('location')),env,deps);assert.equal(final.status,200);assert.equal(final.headers.get('location'),null);
  }
  const html=await (await request('/series/oyghanghan-zemin')).text();assert(html.includes('https://www.kutadgubilik.com/series/oyghanghan-zemin'));assert(html.includes('href="/book/2"'));
  for(const alias of ['private-alias','hidden','missing','bad_slug']){
   const response=await preview.dispatch(new Request('https://kutadgubilik.com/volume-group/'+alias),env,deps);assert.equal(response.status,404);assert.equal(response.headers.get('location'),null);
  }
 };
 await checkPublished();console.log('PASS migrated app: readable HTML/links/metadata, www/apex one-hop 301, private aliases do not redirect');
 directoryOutage=true;assert.equal((await request('/volume-group/series-old')).status,503);directoryOutage=false;
 await db.exec(fs.readFileSync(new URL('../STAGE138_READABLE_SERIES_URLS_ROLLBACK.sql',import.meta.url),'utf8'));
 await checkPublished();assert.deepEqual(await definitions(),original);
 await db.exec("INSERT INTO public.book_volume_groups(slug,title,is_public) VALUES('new-after-rollback','New After Rollback',true);INSERT INTO public.book_volume_group_members(group_id,book_id,position) SELECT id,5,1 FROM public.book_volume_groups WHERE slug='new-after-rollback';INSERT INTO public.book_volume_group_members(group_id,book_id,position) SELECT id,6,2 FROM public.book_volume_groups WHERE slug='new-after-rollback'");
 for(const row of await routes.load({fetchImpl})){
  const old=await request('/volume-group/'+row.legacy_slug);assert.equal(old.status,301);
  assert.equal(old.headers.get('location'),'https://www.kutadgubilik.com/series/'+row.public_slug);
  const readable=await request('/series/'+row.public_slug);assert.equal(readable.status,200);assert.equal(readable.headers.get('location'),null);
 }
 console.log('PASS every public directory URL resolves after rollback, including new groups created during rollback');
 console.log('PASS postlaunch compatibility rollback: readable URLs remain 200, old aliases 301 directly, old RPCs unchanged');
 console.log('readable-series release stages: PASS');
}catch(e){console.error(e.message);process.exitCode=1}finally{await db.close()}
