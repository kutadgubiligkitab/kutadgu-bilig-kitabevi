"use strict";

const fs=require("fs");
const path=require("path");
const publicBook=require("./kutadgu-public-book.js");
const safe=require("./kutadgu-safe-url.js");
const volumeStorefront=require("./kutadgu-volume-storefront.js");

const SUPABASE_URL=publicBook.SUPABASE_URL;
const SUPABASE_ANON_KEY="sb_publishable_lqxWeLH9m7hGbPMUfVY0pA_bdcK-PzE";
const SITE_ORIGIN="https://www.kutadgubilik.com";
const LOOKUP_TIMEOUT_MS=4000;

function validSlug(value){
  const text=String(value==null?"":value).trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text)?text:"";
}
function parseSlug(req){
  let href=String(req&&req.url||"/");
  if(!/^https?:\/\//i.test(href))href=`https://example.invalid${href.startsWith("/")?"":"/"}${href}`;
  try{
    const url=new URL(href);
    const query=validSlug(url.searchParams.get("slug"));
    if(query)return query;
    const match=String(url.pathname||"").match(/^\/volume-group\/([^/?#]+)\/?$/i);
    return match?validSlug(decodeURIComponent(match[1])):"";
  }catch(error){return ""}
}
function rpcUrl(){
  return `${SUPABASE_URL}/rest/v1/rpc/get_public_book_volume_group_storefront`;
}
function normalizeGroup(value,expectedSlug){
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const slug=validSlug(value.slug);
  const id=String(value.id==null?"":value.id).trim();
  const members=Array.isArray(value.members)?value.members:[];
  if(!id||slug!==expectedSlug||members.length<2||members.length>100)return null;
  if(members.some(member=>{
    const position=Number(member&&member.position);
    return !member||!/^[1-9][0-9]*$/.test(String(member.book_id||""))
      ||!Number.isInteger(position)||position<1||position>100;
  }))return null;
  const bookIds=new Set(members.map(member=>String(member.book_id)));
  const positions=new Set(members.map(member=>Number(member.position)));
  if(bookIds.size!==members.length||positions.size!==members.length)return null;
  const representative=String(value.representative_book_id||members[0].book_id);
  if(!members.some(member=>String(member.book_id)===representative))return null;
  return {
    ...value,id,slug,members,representative_book_id:representative,
    title:String(value.title||"").trim(),
    author:String(value.author||"").trim(),
    description:String(value.description||"").trim()
  };
}
async function lookupPublicVolumeGroup(slug,options){
  const canonical=validSlug(slug);
  if(!canonical)return {outcome:"invalid"};
  const fetchImpl=options&&options.fetchImpl||fetch;
  const timeoutMs=Number(options&&options.timeoutMs)||LOOKUP_TIMEOUT_MS;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchImpl(rpcUrl(),{
      method:"POST",
      headers:{apikey:SUPABASE_ANON_KEY,Authorization:`Bearer ${SUPABASE_ANON_KEY}`,"Content-Type":"application/json",Accept:"application/json"},
      body:JSON.stringify({p_group_id:null,p_slug:canonical,p_child_book_id:null}),
      signal:controller.signal
    });
    if(response.status!==200)return {outcome:"error",reason:`http-${response.status}`,status:response.status};
    let payload;
    try{payload=await response.json()}catch(error){return {outcome:"error",reason:"bad-json"}}
    if(payload==null)return {outcome:"missing"};
    const group=normalizeGroup(payload,canonical);
    return group?{outcome:"found",group}:{outcome:"missing"};
  }catch(error){
    return {outcome:"error",reason:error&&error.name==="AbortError"?"timeout":"network"};
  }finally{clearTimeout(timer)}
}
function upsert(html,re,tag){
  if(re.test(html))return String(html).replace(re,tag);
  return String(html).replace(/<\/head>/i,`${tag}\n</head>`);
}
function groupJsonLd(group,canonical){
  return {
    "@context":"https://schema.org",
    "@type":"BookSeries",
    name:group.title,
    url:canonical,
    description:group.description||undefined,
    numberOfBooks:group.members.length,
    hasPart:group.members.map(member=>({
      "@type":"Book",
      name:String(member.title||member.volume_label||`${member.position}-جىلد`),
      url:`${SITE_ORIGIN}/book/${member.book_id}`
    }))
  };
}
function renderStaticMemberList(group){
  const items=(group.members||[]).map(member=>{
    const label=safe.escapeHtml(String(member.volume_label||`${member.position}-قىسىم`));
    const title=safe.escapeHtml(String(member.title||""));
    const pages=volumeStorefront.memberPageCountLabel(member);
    const pageHtml=pages?`<small class="volume-member-pages">${safe.escapeHtml(pages)}</small>`:"";
    return `<li data-volume-book-id="${safe.escapeAttr(member.book_id)}"><strong>${label}</strong> <span>${title}</span> ${pageHtml}</li>`;
  }).join("");
  return `<ul class="volume-member-picker volume-member-picker-static" data-volume-static-members>${items}</ul>`;
}
function applyGroupDocument(html,group,representativeBook){
  const canonical=`${SITE_ORIGIN}/volume-group/${group.slug}`;
  const display={
    ...representativeBook,
    title:group.title||representativeBook.title,
    author:group.author||representativeBook.author,
    description:group.description||representativeBook.description,
    category:group.category||representativeBook.category,
    source:group.source||representativeBook.source
  };
  let out=publicBook.applyFoundPublicBookHead(html,representativeBook.id,display);
  const title=`${display.title} - قۇتادغۇبىلىك كىتابخانىسى`;
  out=upsert(out,/<title>[\s\S]*?<\/title>/i,`<title>${safe.escapeHtml(title)}</title>`);
  out=upsert(out,/<link\s+rel=["']canonical["'][^>]*>/i,`<link rel="canonical" href="${safe.escapeAttr(canonical)}">`);
  out=upsert(out,/<meta\s+property=["']og:url["'][^>]*>/i,`<meta property="og:url" content="${safe.escapeAttr(canonical)}">`);
  const schema=`<script id="kutadguBookSchema" type="application/ld+json">${JSON.stringify(groupJsonLd(group,canonical)).replace(/</g,"\\u003c")}</script>`;
  out=upsert(out,/<script\s+id=["']kutadguBookSchema["'][\s\S]*?<\/script>/i,schema);
  if(!out.includes("data-volume-static-members")){
    out=out.replace(/<div class="book-meta"><\/div>/,`<div class="book-meta"></div>\n${renderStaticMemberList(group)}`);
  }
  out=out.replace(/<body([^>]*)>/i,(match,attrs)=>{
    const clean=String(attrs).replace(/\sdata-volume-group-slug=["'][^"']*["']/i,"");
    return `<body${clean} data-volume-group-slug="${safe.escapeAttr(group.slug)}">`;
  });
  return out;
}
function readShell(){
  return fs.readFileSync(path.join(__dirname,"book-shell.html"),"utf8");
}

module.exports={
  SUPABASE_URL,SUPABASE_ANON_KEY,SITE_ORIGIN,LOOKUP_TIMEOUT_MS,
  validSlug,parseSlug,rpcUrl,normalizeGroup,lookupPublicVolumeGroup,
  groupJsonLd,renderStaticMemberList,applyGroupDocument,readShell
};
