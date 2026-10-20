(function(root,factory){
  const api=factory(root);
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.KutadguVolumeStorefront=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
  "use strict";

  const MAX_PAGE_SIZE=100;
  const MAX_DISCOVERY_UNITS=5000;

  function enabled(){
    const cfg=root.KUTADGU_APP_CONFIG||{};
    return cfg.featureFlags&&cfg.featureFlags.multiVolumeBooks===true;
  }
  function positiveId(value){
    const text=String(value==null?"":value).trim();
    return /^[1-9][0-9]*$/.test(text)?text:"";
  }
  function slug(value){
    const text=String(value==null?"":value).trim().toLowerCase();
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text)?text:"";
  }
  function creditKey(value){
    const text=String(value==null?"":value).trim().toLowerCase();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text)?text:"";
  }
  function publicConfig(){
    const cfg=root.KUTADGU_SUPABASE_CONFIG||{};
    return {url:String(cfg.url||"").replace(/\/+$/,""),key:String(cfg.anonKey||cfg.publishableKey||"")};
  }
  async function rpc(name,args,options){
    const cfg=publicConfig();
    if(!cfg.url||!cfg.key)throw new Error("volume_storefront_unavailable");
    const fetchImpl=options&&options.fetchImpl||(typeof fetch==="function"?fetch:null);
    if(!fetchImpl)throw new Error("volume_storefront_unavailable");
    const response=await fetchImpl(`${cfg.url}/rest/v1/rpc/${name}`,{
      method:"POST",
      signal:options&&options.signal,
      headers:{apikey:cfg.key,Authorization:`Bearer ${cfg.key}`,"Content-Type":"application/json",Accept:"application/json"},
      body:JSON.stringify(args||{})
    });
    const text=await response.text();
    let data=null;
    try{data=text?JSON.parse(text):null}catch(error){}
    if(!response.ok){
      const err=new Error(String(data&&data.message||data&&data.error||"volume_storefront_failed"));
      err.status=response.status;
      err.details=data&&data.details;
      throw err;
    }
    return data;
  }
  function groupPath(value){
    const key=slug(value&&value.slug)||positiveId(value&&value.group_id??value&&value.id);
    return key?`/volume-group/${encodeURIComponent(key)}`:"";
  }
  function normalizeMember(value){
    if(!value||typeof value!=="object")return null;
    const id=positiveId(value.book_id??value.id);
    const position=Number(value.position);
    const price=value.price==null||value.price===""?null:Number(value.price);
    const stock=value.stock==null||value.stock===""?null:Number(value.stock);
    if(!id||!Number.isInteger(position)||position<1||position>100)return null;
    return {
      book_id:id,
      position,
      volume_label:String(value.volume_label||""),
      title:String(value.title||""),
      author:String(value.author||""),
      price:Number.isFinite(price)?price:null,
      image_url:String(value.image_url||""),
      stock:Number.isInteger(stock)&&stock>=0?stock:null,
      stock_status:String(value.stock_status||""),
      is_active:value.is_active!==false
    };
  }
  function normalizeGroup(value){
    if(!value||typeof value!=="object")return null;
    const id=positiveId(value.id??value.group_id);
    const members=(Array.isArray(value.members)?value.members:[]).map(normalizeMember).filter(Boolean).sort((a,b)=>a.position-b.position);
    if(!id||members.length<2||members.length>100)return null;
    const explicit=value.complete_set_price==null||value.complete_set_price===""?null:Number(value.complete_set_price);
    const effectiveRaw=value.effective_set_price??value.set_price;
    const effective=effectiveRaw==null||effectiveRaw===""?null:Number(effectiveRaw);
    return {
      id,
      slug:slug(value.slug),
      title:String(value.title||""),
      author:String(value.author||""),
      category:String(value.category||""),
      source:String(value.source||""),
      description:String(value.description||""),
      complete_set_price:Number.isFinite(explicit)?explicit:null,
      effective_set_price:Number.isFinite(effective)?effective:null,
      representative_book_id:positiveId(value.representative_book_id)||members[0].book_id,
      revision:Number(value.revision)||0,
      quote_revision:String(value.quote_revision||""),
      members
    };
  }
  function normalizeCatalogItem(value){
    if(!value||typeof value!=="object")return null;
    const kind=String(value.kind||value.unit_kind||"book")==="group"?"group":"book";
    const id=positiveId(value.id??value.book_id??value.representative_book_id);
    if(!id)return null;
    const groupId=kind==="group"?positiveId(value.group_id):"";
    if(kind==="group"&&!groupId)return null;
    const price=value.price==null||value.price===""?null:Number(value.price);
    const setPrice=value.complete_set_price==null||value.complete_set_price===""?null:Number(value.complete_set_price);
    const effectiveSetPrice=value.effective_set_price==null||value.effective_set_price===""?null:Number(value.effective_set_price);
    const stock=value.stock==null||value.stock===""?null:Number(value.stock);
    const memberIds=(Array.isArray(value.member_book_ids)?value.member_book_ids:[])
      .map(positiveId).filter(Boolean);
    const path=kind==="group"
      ?groupPath({slug:value.group_slug||value.slug,group_id:groupId})
      :`/book/${id}`;
    return {
      ...value,
      kind,
      id,
      group_id:groupId,
      group_slug:slug(value.group_slug||value.slug),
      unit_key:String(value.unit_key||value.unit_id||(kind==="group"?`group:${groupId}`:`book:${id}`)),
      representative_book_id:positiveId(value.representative_book_id)||id,
      member_book_ids:memberIds,
      member_count:Number(value.member_count)||memberIds.length,
      title:String(value.title||""),
      author:String(value.author||""),
      category:String(value.category||""),
      source:String(value.source||""),
      description:String(value.description||""),
      image_url:String(value.image_url||""),
      price:Number.isFinite(price)?price:null,
      complete_set_price:Number.isFinite(setPrice)?setPrice:null,
      effective_set_price:Number.isFinite(effectiveSetPrice)?effectiveSetPrice:null,
      stock:Number.isInteger(stock)&&stock>=0?stock:null,
      stock_status:String(value.stock_status||""),
      is_active:value.is_active!==false,
      href:path
    };
  }
  function catalogQuery(input){
    const value=input&&typeof input==="object"?input:{};
    const pageSize=Math.max(1,Math.min(MAX_PAGE_SIZE,Number(value.pageSize)||24));
    const offset=Math.max(0,Number(value.offset)||0);
    const ids=(Array.isArray(value.ids)?value.ids:[]).map(String).filter(Boolean).slice(0,MAX_PAGE_SIZE);
    return {
      search:String(value.search||"").trim().slice(0,300),
      category:String(value.category||"").trim().slice(0,200),
      source:String(value.source||"").trim().slice(0,300),
      sources:Array.isArray(value.sources)?value.sources.map(x=>String(x||"").trim()).filter(Boolean).slice(0,50):null,
      sort:String(value.sort||"new"),
      min_price:Number.isFinite(Number(value.minPrice))?Number(value.minPrice):null,
      max_price:Number.isFinite(Number(value.maxPrice))?Number(value.maxPrice):null,
      recommended:value.recommended===true||value.featured===true,
      bestseller:value.bestseller===true,
      new_only:value.newOnly===true,
      credit_id:creditKey(value.creditId)||null,
      credit_role:String(value.creditRole||"").trim().slice(0,40)||null,
      ids:ids.length?ids:null,
      offset,
      limit:pageSize
    };
  }
  async function queryCatalog(input,options){
    const query=catalogQuery(input);
    const result=await rpc("query_public_book_catalog",{p_query:query},options);
    const rows=Array.isArray(result)?result:Array.isArray(result&&result.items)?result.items:[];
    const items=rows.map(normalizeCatalogItem).filter(Boolean);
    const total=Number(result&&result.total);
    return {
      items,
      total:Number.isFinite(total)?total:items.length,
      hasMore:result&&typeof result.has_more==="boolean"?result.has_more:query.offset+items.length<(Number.isFinite(total)?total:query.offset+items.length),
      offset:query.offset,
      pageSize:query.limit,
      source:"volume-groups"
    };
  }
  async function listUnitIds(options){
    const result=await rpc("list_public_book_volume_discovery_unit_ids",{p_seed:"storefront-unit-index",p_offset:0,p_limit:MAX_DISCOVERY_UNITS},options);
    const rows=Array.isArray(result)?result:Array.isArray(result&&result.unit_ids)?result.unit_ids:[];
    return rows.slice(0,MAX_DISCOVERY_UNITS).map(row=>{
      if(typeof row==="string")return row;
      return String(row&&row.unit_key||"");
    }).filter(value=>/^(?:book|group):[1-9][0-9]*$/.test(value));
  }
  async function resolveBook(bookId,options){
    const id=positiveId(bookId);
    if(!id)return null;
    const result=await rpc("resolve_public_book_volume_context",{p_book_id:id},options);
    if(!result||typeof result!=="object")return null;
    return {
      book:result.book&&typeof result.book==="object"?result.book:null,
      group:normalizeGroup(result.group),
      selected_book_id:positiveId(result.selected_book_id)||id,
      canonical_path:String(result.canonical_path||`/book/${id}`)
    };
  }
  async function getGroupBySlug(value,options){
    const key=slug(value);
    if(!key)return null;
    return normalizeGroup(await rpc("get_public_book_volume_group_storefront",{p_group_id:null,p_slug:key,p_child_book_id:null},options));
  }
  async function getGroupById(groupId,options){
    const id=positiveId(groupId);
    if(!id)return null;
    return normalizeGroup(await rpc("get_public_book_volume_group_storefront",{p_group_id:id,p_slug:null,p_child_book_id:null},options));
  }
  async function mapBookIdsToUnits(ids,options){
    const clean=(Array.isArray(ids)?ids:[]).map(positiveId).filter(Boolean).slice(0,100);
    if(!clean.length)return [];
    const result=await rpc("map_public_books_to_catalog_units",{p_book_ids:clean},options);
    const rows=Array.isArray(result)?result:Array.isArray(result&&result.items)?result.items:[];
    return rows.map(normalizeCatalogItem).filter(Boolean);
  }

  return {
    MAX_PAGE_SIZE,MAX_DISCOVERY_UNITS,enabled,positiveId,slug,creditKey,groupPath,
    normalizeMember,normalizeGroup,normalizeCatalogItem,catalogQuery,queryCatalog,
    listUnitIds,resolveBook,getGroupBySlug,getGroupById,mapBookIdsToUnits,rpc
  };
});
