"use strict";
// Isolated public data only. Never reaches Supabase or production.
const fs=require("node:fs");
const path=require("node:path");
const legacy="series-d23590fc-1f72-4b8a-ac62-45bf4ae49105";
const canonical="oyghanghan-zemin";
const members=[1,2].map(n=>({book_id:String(1000+n),position:n,volume_label:n+"-جىلد",title:"ئويغانغان زېمىن "+n,author:"سىناق ئاپتور",price:n===1?35:55,image_url:"/volume-cover-"+n+".svg",stock:4,stock_status:"in_stock",is_active:true,pages:120}));
const group={id:"77",slug:legacy,public_slug:canonical,title:"ئويغانغان زېمىن",author:"سىناق ئاپتور",category:"رومانلار",source:"romanlar.html",description:"ئىككى جىلدلىق سىناق توپلام",complete_set_price:80,effective_set_price:80,representative_book_id:"1001",revision:4,quote_revision:"quote-r4",members};
const book=member=>({...member,id:Number(member.book_id),category:group.category,source:group.source,description:member.title,is_active:true,submission_status:"approved",created_at:"2026-10-20T00:00:00Z"});
async function fetchImpl(url,options={}){
 const href=String(url),args=options.body?JSON.parse(options.body):{};
 let value=[];
 if(href.includes("/rpc/list_public_book_series_routes"))value=[{group_id:77,legacy_slug:legacy,public_slug:canonical}];
 else if(href.includes("/rpc/get_public_book_volume_group_storefront"))value=args.p_slug===legacy||args.p_group_id?{...group,public_slug:undefined}:null;
 else if(href.includes("/rpc/resolve_public_book_volume_context"))value={book:book(members[1]),group:{...group,public_slug:undefined},selected_book_id:"1002",canonical_path:"/book/1002"};
 else if(href.includes("/rest/v1/books")){
  const id=new URL(href).searchParams.get("id");
  value=members.filter(m=>!id||id==="eq."+m.book_id||(id.startsWith("in.(")&&id.slice(4,-1).split(",").includes(m.book_id))).map(book);
 }
 return new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json","content-range":"0-1/2"}});
}
const deps={publicVolumeGroup:require("../kutadgu-public-volume-group.js"),publicBook:require("../kutadgu-public-book.js"),fetchImpl,
 readAsset:async file=>{const target=path.join(__dirname,"..",file);return fs.existsSync(target)?new Response(fs.readFileSync(target),{headers:{"Content-Type":({".js":"text/javascript",".css":"text/css",".html":"text/html",".svg":"image/svg+xml",".woff2":"font/woff2",".ico":"image/x-icon"})[path.extname(target)]||"application/octet-stream"}}):new Response("missing",{status:404});}};
function fetchForState(migrated=true){return async(url,options)=>{
 if(!migrated&&String(url).includes("/rpc/list_public_book_series_routes"))return Response.json({code:"PGRST202"},{status:404});
 return fetchImpl(url,options);
};}
async function startServer({migrated=true}={}){
 const http=require("node:http"),preview=require("../cloudflare/preview-dispatch");
 const server=http.createServer(async(req,res)=>{
  try{
   const response=await preview.dispatch(new Request("http://127.0.0.1:"+server.address().port+req.url,{method:req.method}),{MULTI_VOLUME_BOOKS_ENABLED:"true"},{...deps,fetchImpl:fetchForState(migrated)});
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){res.writeHead(500);res.end("Fixture server failure");}
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 return {origin:"http://127.0.0.1:"+server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};
}
module.exports={legacy,canonical,group,members,book,fetchImpl,deps,startServer,fetchForState};
