import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
const packagePath=process.env.PGLITE_MODULE||'/tmp/kutadgu-series-pglite/node_modules/@electric-sql/pglite/dist/index.js';
const {PGlite}=await import(pathToFileURL(packagePath).href);
const db=new PGlite();
const sql=name=>fs.readFileSync(path.join(root,name),'utf8');
const run=async(name,source)=>{try{await db.exec(source);console.log('PASS',name)}catch(e){throw Error(name+': '+e.message)}};
try{
 await run('isolated fixtures',sql('scripts/stage127-isolated-fixture.sql')+sql('scripts/stage130-isolated-fixture.sql'));
 for(const name of ['STAGE127_BOOK_VOLUME_GROUPS.sql','STAGE130_BOOK_VOLUME_STOREFRONT.sql','STAGE131_BOOK_VOLUME_SERIES_ENTRY.sql'])await run(name,sql(name));
 await run('production-shape series creation',`ALTER TABLE public.books ADD COLUMN original_price numeric(12,2);ALTER TABLE public.books ADD COLUMN cover_type text;ALTER TABLE public.books ADD COLUMN book_size text;ALTER TABLE public.books ADD COLUMN publisher text;ALTER TABLE public.books ADD COLUMN translator text;ALTER TABLE public.books ADD COLUMN publish_year integer;ALTER TABLE public.books ADD COLUMN pages integer;SELECT setval(pg_get_serial_sequence('public.books','id'),(SELECT max(id) FROM public.books));`+sql('STAGE135_SERIES_CREATION_IS_NEW.sql'));
 await run('existing public, duplicate, private, invalid groups',`
 INSERT INTO public.book_volume_groups(slug,title,is_public) VALUES
 ('series-d23590fc-1f72-4b8a-ac62-45bf4ae49105','ئويغانغان زېمىن',true),
 ('series-139','ئويغانغان زېمىن',true),('private-legacy','مەخپىي يۈرۈشلۈك',false),('invalid-legacy','ئىناۋەتسىز',true);
 INSERT INTO public.book_volume_group_members(group_id,book_id,position)
 SELECT g.id,((g.id-1)*2+n)::bigint,n::smallint FROM public.book_volume_groups g CROSS JOIN generate_series(1,2) n;
 UPDATE public.books SET is_active=false WHERE id=8;
 CREATE TEMP TABLE original_books AS SELECT * FROM public.books;
 CREATE TEMP TABLE original_members AS SELECT * FROM public.book_volume_group_members;
 CREATE TEMP TABLE original_groups AS SELECT * FROM public.book_volume_groups;`);
 const migration=sql('STAGE138_READABLE_SERIES_URLS.sql');await run('readable slug migration',migration);
 const groups=(await db.query('SELECT id,slug,public_slug,title FROM public.book_volume_groups ORDER BY id')).rows;
 assert.equal(groups[0].public_slug,'oyghanghan-zemin');assert.equal(groups[1].public_slug,'oyghanghan-zemin-2');
 assert.equal(groups[0].slug,'series-d23590fc-1f72-4b8a-ac62-45bf4ae49105');
 for(const row of groups.slice(0,2)){
  const lookup=await db.query('SELECT public.get_public_book_volume_group_storefront(NULL,$1,NULL) AS value',[row.slug]);
  assert.equal(lookup.rows[0].value.slug,row.slug);
  const routes=(await db.query('SELECT public.list_public_book_series_routes() AS value')).rows[0].value;
  assert.equal(routes.find(r=>r.group_id===row.id).public_slug,row.public_slug);
  // Legacy RPC semantics remain unchanged; the compatibility app resolves via the directory.
  const canonical=await db.query('SELECT public.get_public_book_volume_group_storefront(NULL,$1,NULL) AS value',[row.public_slug]);
  assert.equal(canonical.rows[0].value,null);
 }
 console.log('PASS deterministic duplicate-title backfill and public legacy/canonical lookup');
 await run('title/slug edits cannot silently move URLs',`UPDATE public.book_volume_groups SET title='Renamed title',slug='wrong-old-alias',public_slug='wrong-public-path' WHERE id=1;`);
 let row=(await db.query('SELECT slug,public_slug FROM public.book_volume_groups WHERE id=1')).rows[0];assert.equal(row.slug,groups[0].slug);assert.equal(row.public_slug,groups[0].public_slug);
 for(const slug of [groups[2].slug,groups[2].public_slug,groups[3].slug,groups[3].public_slug,'../bad','missing']){
  const r=await db.query('SELECT public.get_public_book_volume_group_storefront(NULL,$1,NULL) AS value',[slug]);assert.equal(r.rows[0].value,null,slug);
 }
 await run('migration idempotency',migration);assert.deepEqual((await db.query('SELECT public_slug FROM public.book_volume_groups ORDER BY id')).rows.map(r=>r.public_slug),groups.map(r=>r.public_slug));
 await run('collision with a legacy alias is reserved',`INSERT INTO public.book_volume_groups(slug,title) VALUES('another-old-slug','private-legacy');`);
 row=(await db.query("SELECT public_slug FROM public.book_volume_groups WHERE slug='another-old-slug'")).rows[0];assert.equal(row.public_slug,'private-legacy-5');
 await run('Admin AAL2 fixture',`SELECT set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal2"}',false);`);
 const request='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
 const payload={title:'يېڭى يۈرۈشلۈك',author:'',category:'رومانلار',source:'romanlar.html',description:'',complete_set_price:750,representative_position:1,parts:[1,2].map(i=>({price:i===1?370:399,stock:4,image_url:`https://www.kutadgubilik.com/__r2/book-covers/series-new/${request}/part-${i}-a.webp`}))};
 const create=await db.query('SELECT public.admin_create_book_volume_series($1::uuid,$2::jsonb) AS value',[request,JSON.stringify(payload)]);
 const created=create.rows[0].value;const id=created.group_id||created.id||created.group?.id;
 assert(id,'creation returned a group identity');const fresh=(await db.query('SELECT * FROM public.book_volume_groups WHERE id=$1',[id])).rows[0];assert.equal(fresh.public_slug,'yengi-yurushluk');assert.equal(fresh.is_public,false);
 const replay=await db.query('SELECT public.admin_create_book_volume_series($1::uuid,$2::jsonb) AS value',[request,JSON.stringify(payload)]);assert.equal(replay.rows[0].value.replayed,true);assert.equal(replay.rows[0].value.id,created.id);assert.deepEqual(replay.rows[0].value.members,created.members);
 console.log('PASS real new-series creation automatically allocates readable slug and preserves idempotency');
 // Publish only this isolated fixture, then exercise the same filtered public RPC.
 await db.exec(`UPDATE public.books SET is_active=true,submission_status='approved' WHERE id IN (SELECT book_id FROM public.book_volume_group_members WHERE group_id=${id});UPDATE public.book_volume_groups SET is_public=true WHERE id=${id};`);
 const published=await db.query('SELECT public.get_public_book_volume_group_storefront(NULL,$1,NULL) AS value',[fresh.slug]);assert.equal(published.rows[0].value.id,id);
 await assert.rejects(()=>db.query("INSERT INTO public.book_volume_groups(slug,title) VALUES($1,'Alias collision')",[groups[0].public_slug]),/conflicts with a published/);
 await db.exec("INSERT INTO public.book_volume_groups(slug,title) VALUES('punctuation-test','!!!')");
 assert.equal((await db.query("SELECT public_slug FROM public.book_volume_groups WHERE slug='punctuation-test'")).rows[0].public_slug,'series');
 await db.exec("INSERT INTO public.book_volume_groups(slug,title) VALUES('duplicate-new','يېڭى يۈرۈشلۈك')");
 const duplicate=(await db.query("SELECT id,public_slug FROM public.book_volume_groups WHERE slug='duplicate-new'")).rows[0];assert.equal(duplicate.public_slug,'yengi-yurushluk-'+duplicate.id);
 console.log('PASS new group publication, duplicate creation, empty transliteration and alias collision guard');
 await run('public catalog and sitemap use allocated slug',`DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.kutadgu_public_catalog_units() WHERE kind='group' AND slug='series-d23590fc-1f72-4b8a-ac62-45bf4ae49105') THEN RAISE EXCEPTION 'missing canonical catalog unit';END IF;
 IF EXISTS(SELECT * FROM original_books EXCEPT SELECT b.* FROM public.books b JOIN original_books o USING(id)) THEN RAISE EXCEPTION 'existing books modified';END IF;
 IF EXISTS(SELECT * FROM original_members EXCEPT SELECT * FROM public.book_volume_group_members) THEN RAISE EXCEPTION 'existing members modified';END IF;
 END $$;`);
 const sitemap=(await db.query('SELECT public.list_public_book_volume_sitemap_entries(0,1000) AS value')).rows[0].value;
 assert(sitemap.items.some(r=>r.kind==='group'&&r.slug===groups[0].slug));
 assert(!sitemap.items.some(r=>r.kind==='group'&&[groups[2].id,groups[3].id].includes(r.group_id)));
 const routesBeforeRollback=(await db.query('SELECT public.list_public_book_series_routes() AS value')).rows[0].value;
 await run('postlaunch rollback guard',sql('STAGE138_READABLE_SERIES_URLS_ROLLBACK.sql'));assert.equal((await db.query('SELECT public_slug FROM public.book_volume_groups WHERE id=1')).rows[0].public_slug,groups[0].public_slug);
 const routesAfterRollback=(await db.query('SELECT public.list_public_book_series_routes() AS value')).rows[0].value;assert.deepEqual(routesAfterRollback,routesBeforeRollback);
 for(const published of routesAfterRollback)for(const alias of [published.legacy_slug,published.public_slug]){const route=routesAfterRollback.find(r=>r.legacy_slug===alias||r.public_slug===alias);assert(route);const resolved=(await db.query('SELECT public.get_public_book_volume_group_storefront(NULL,$1,NULL) AS value',[route.legacy_slug])).rows[0].value;assert.equal(resolved.id,published.group_id);}
 console.log('PASS postlaunch readable URL and legacy alias resolve through retained directory');
 await run('reapply preserves allocations',migration);assert.equal((await db.query('SELECT public_slug FROM public.book_volume_groups WHERE id=1')).rows[0].public_slug,groups[0].public_slug);
 await db.exec('SET ROLE anon');
 await assert.rejects(()=>db.query('SELECT public_slug FROM public.book_volume_groups'),/permission denied/);
 const hidden=await db.query('SELECT public.get_public_book_volume_group_storefront(NULL,$1,NULL) AS value',[groups[2].public_slug]);assert.equal(hidden.rows[0].value,null);
 const anonRoutes=(await db.query('SELECT public.list_public_book_series_routes() AS value')).rows[0].value;assert(!anonRoutes.some(r=>r.group_id===groups[2].id||r.group_id===groups[3].id));
 console.log('PASS anonymous direct-table access denied; private alias lookup stays null');
 console.log('readable-series database: PASS');
}finally{await db.close()}
