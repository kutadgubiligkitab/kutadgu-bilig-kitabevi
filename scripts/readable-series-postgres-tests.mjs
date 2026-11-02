// Disposable LOCAL Docker PostgreSQL only. No external database URL is accepted.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
const name='kutadgu-series-test-'+process.pid;
const env={...process.env};for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
const dockerArgs=['--host=unix:///var/run/docker.sock'];
const docker=(args,options={})=>execFileSync('docker',[...dockerArgs,...args],{env,encoding:'utf8',...options});
const sql=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const query=(source,database='postgres')=>docker(['exec','-i',name,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],{input:source});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function session(label,database='postgres'){
 const child=spawn('docker',[...dockerArgs,'exec','-i',name,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],{env});
 const state={child,out:'',err:'',code:null};child.stdout.on('data',b=>state.out+=b);child.stderr.on('data',b=>state.err+=b);child.on('exit',code=>state.code=code);
 state.send=s=>child.stdin.write(s+'\n');
 state.wait=async marker=>{const deadline=Date.now()+10000;while(!state.out.includes(marker)){if(state.code!==null)throw Error(state.err||state.out);if(Date.now()>deadline)throw Error('session timeout '+label+': '+marker);await pause(20)};};
 state.send("SET application_name='"+label+"'; SELECT 'PID:'||pg_backend_pid();");return state;
}
async function waiting(label){const deadline=Date.now()+10000;while(Date.now()<deadline){if(query("SELECT count(*) FROM pg_stat_activity WHERE application_name='"+label+"' AND wait_event='advisory'").trim()==='1')return;await pause(20)}throw Error('no observed advisory wait for '+label);}
async function pair({title,aAlias,bAlias,aEnd='COMMIT',expectConflict=false,reserveLegacy=false}){
 const a=session('series_A'),b=session('series_B');
 try{
  a.send("BEGIN;INSERT INTO public.book_volume_groups(slug,title) VALUES('"+aAlias+"','"+(reserveLegacy?'Different title':title)+"');SELECT 'A_READY';");await a.wait('A_READY');
  b.send("BEGIN;INSERT INTO public.book_volume_groups(slug,title) VALUES('"+bAlias+"','"+title+"');SELECT 'B_READY';");await waiting('series_B');
  await a.wait('PID:');await b.wait('PID:');assert.notEqual(a.out.match(/PID:(\d+)/)[1],b.out.match(/PID:(\d+)/)[1]);
  a.send(aEnd+";SELECT 'A_END';");await a.wait('A_END');
  if(expectConflict){const deadline=Date.now()+10000;while(b.code===null&&Date.now()<deadline)await pause(20);assert.notEqual(b.code,0);assert.match(b.err,/conflicts with a published series URL/);}
  else{await b.wait('B_READY');b.send("COMMIT;SELECT 'B_END';");await b.wait('B_END');const allocated=query("SELECT public_slug FROM public.book_volume_groups WHERE slug='"+bAlias+"'").trim();if(aEnd==='ROLLBACK')assert.equal(allocated,title);else assert.match(allocated,new RegExp('^'+title+'-[0-9]+$'));}
  console.log('PASS distinct PostgreSQL PIDs; observed advisory wait; '+aEnd+'; '+(expectConflict?'alias conflict rejected':reserveLegacy?'legacy alias reserved':title));
 }finally{a.child.stdin.end();b.child.stdin.end();}
}
const fixtures=['scripts/stage127-isolated-fixture.sql','scripts/stage130-isolated-fixture.sql','STAGE127_BOOK_VOLUME_GROUPS.sql','STAGE130_BOOK_VOLUME_STOREFRONT.sql'];
let started=false;
try{
 docker(['run','--rm','-d','--name',name,'-e','POSTGRES_PASSWORD=isolated-local-test','postgres:18-alpine']);started=true;
 const deadline=Date.now()+30000;while(true){try{docker(['exec',name,'pg_isready','-U','postgres']);break}catch(e){if(Date.now()>deadline)throw e;await pause(100)}}
 console.log(query('SELECT version()').trim());
 query(fixtures.map(sql).join('\n')+sql('STAGE138_READABLE_SERIES_URLS.sql'));
 await pair({title:'duplicate-title',aAlias:'old-a',bAlias:'old-b'});
 await pair({title:'aborted-title',aAlias:'abort-a',bAlias:'abort-b',aEnd:'ROLLBACK'});
 await pair({title:'published-alias',aAlias:'alias-a',bAlias:'published-alias',expectConflict:true});
 await pair({title:'reserved-legacy',aAlias:'reserved-legacy',bAlias:'other-alias',reserveLegacy:true});
 await pair({title:'aborted-alias',aAlias:'abort-alias-a',bAlias:'aborted-alias',aEnd:'ROLLBACK'});
 query('CREATE DATABASE migration_timeout');
 // Roles already exist in the cluster; databases have independent schemas/data.
 const fixture=fixtures.map(sql).join('\n').replace(/CREATE ROLE (anon|authenticated|service_role|authenticator)[^;]*;/g,'');
 query(fixture,'migration_timeout');
 const blocker=session('migration_blocker','migration_timeout');blocker.send("BEGIN;SELECT count(*) FROM public.book_volume_groups;SELECT 'LOCKED';");await blocker.wait('LOCKED');
 try{assert.throws(()=>query(sql('STAGE138_READABLE_SERIES_URLS.sql'),'migration_timeout'),/lock timeout/);}finally{blocker.send('ROLLBACK;');blocker.child.stdin.end();}
 assert.equal(query("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='book_volume_groups' AND column_name='public_slug'",'migration_timeout').trim(),'0');
 query(sql('STAGE138_READABLE_SERIES_URLS.sql'),'migration_timeout');query(sql('STAGE138_READABLE_SERIES_URLS.sql'),'migration_timeout');
 console.log('PASS real lock timeout rolls entire migration back; retry and reapply succeed');
 console.log('readable-series independent PostgreSQL: PASS');
}catch(e){console.error(e.message);process.exitCode=1}finally{if(started)docker(['rm','-f',name]);}
