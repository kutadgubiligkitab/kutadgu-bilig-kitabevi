(function(root,factory){
  const api=factory(root);
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.KutadguVolumeGroups=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
  "use strict";

  const SET_CART_KEY="kutadgu-set-cart-v1";
  const QUOTE_SCHEMA_VERSION=1;
  const MAX_SET_QTY=99;
  const MAX_GROUP_VOLUMES=100;
  let cachedQuote=null;
  let cachedSignature="";
  let quotePromise=null;

  function featureEnabled(){
    const cfg=root.KUTADGU_APP_CONFIG||{};
    return cfg.featureFlags&&cfg.featureFlags.multiVolumeBooks===true;
  }
  function positiveId(value){
    const text=String(value==null?"":value).trim();
    return /^[1-9][0-9]*$/.test(text)?text:"";
  }
  function qty(value){
    const n=Number(value);
    return Number.isInteger(n)&&n>=1&&n<=MAX_SET_QTY?n:null;
  }
  function normalizeSetLine(value){
    if(!value||typeof value!=="object"||Array.isArray(value))return null;
    if(value.kind!==undefined&&String(value.kind)!=="set")return null;
    const groupId=positiveId(value.group_id??value.groupId);
    const quantity=qty(value.qty??value.quantity);
    if(!groupId||quantity==null)return null;
    return {
      kind:"set",
      group_id:groupId,
      qty:quantity,
      quote_revision:String(value.quote_revision??value.quoteRevision??"").trim()
    };
  }
  function readRaw(storage){
    const target=storage||(typeof localStorage!=="undefined"?localStorage:null);
    if(!target)return [];
    try{
      const parsed=JSON.parse(target.getItem(SET_CART_KEY)||"[]");
      return Array.isArray(parsed)?parsed:[];
    }catch(error){return []}
  }
  function splitSetCart(storage){
    const lines=[];
    const unsupported=[];
    const index=new Map();
    readRaw(storage).forEach(raw=>{
      const line=normalizeSetLine(raw);
      if(!line){unsupported.push(raw);return}
      if(index.has(line.group_id)){
        const at=index.get(line.group_id);
        lines[at].qty=Math.min(MAX_SET_QTY,lines[at].qty+line.qty);
        if(line.quote_revision)lines[at].quote_revision=line.quote_revision;
      }else{
        index.set(line.group_id,lines.length);
        lines.push(line);
      }
    });
    return {lines,unsupported};
  }
  function normalizeSetLines(values){
    const lines=[];
    const unsupported=[];
    const index=new Map();
    (Array.isArray(values)?values:[]).forEach(raw=>{
      const line=normalizeSetLine(raw);
      if(!line){unsupported.push(raw);return}
      if(index.has(line.group_id)){
        const at=index.get(line.group_id);
        lines[at].qty=Math.min(MAX_SET_QTY,lines[at].qty+line.qty);
        if(line.quote_revision)lines[at].quote_revision=line.quote_revision;
        return;
      }
      index.set(line.group_id,lines.length);
      lines.push(line);
    });
    return {lines,unsupported};
  }
  function writeSetCart(lines,storage){
    const target=storage||(typeof localStorage!=="undefined"?localStorage:null);
    if(!target)return false;
    const previous=splitSetCart(target);
    const normalized=[];
    const seen=new Set();
    (Array.isArray(lines)?lines:[]).forEach(raw=>{
      const line=normalizeSetLine(raw);
      if(!line||seen.has(line.group_id))return;
      seen.add(line.group_id);
      normalized.push(line);
    });
    target.setItem(SET_CART_KEY,JSON.stringify([...normalized,...previous.unsupported]));
    invalidateQuote();
    return true;
  }
  function mergeSetLines(existing,incoming){
    const base=normalizeSetLines(existing);
    const next=base.lines.map(line=>({...line}));
    const index=new Map(next.map((line,at)=>[line.group_id,at]));
    const added=[];
    const increased=[];
    const parsed=normalizeSetLines(incoming);
    parsed.lines.forEach(line=>{
      const at=index.get(line.group_id);
      if(at===undefined){
        index.set(line.group_id,next.length);
        next.push({...line});
        added.push(line.group_id);
        return;
      }
      const before=next[at].qty;
      next[at].qty=Math.min(MAX_SET_QTY,before+line.qty);
      if(line.quote_revision)next[at].quote_revision=line.quote_revision;
      if(next[at].qty!==before)increased.push(line.group_id);
    });
    return {
      lines:next,
      unsupported:[...base.unsupported,...parsed.unsupported],
      added,
      increased
    };
  }
  function cloudRowsToSetLines(rows){
    return normalizeSetLines((Array.isArray(rows)?rows:[]).map(row=>({
      kind:"set",
      group_id:row&&row.group_id,
      qty:row&&row.quantity,
      quote_revision:row&&row.quote_revision
    })));
  }
  function addSet(groupId,quantity,quoteRevision,storage){
    const line=normalizeSetLine({kind:"set",group_id:groupId,qty:quantity,quote_revision:quoteRevision});
    if(!line)return false;
    const current=splitSetCart(storage).lines;
    const existing=current.find(row=>row.group_id===line.group_id);
    if(existing){
      existing.qty=Math.min(MAX_SET_QTY,existing.qty+line.qty);
      if(line.quote_revision)existing.quote_revision=line.quote_revision;
    }else current.push(line);
    return writeSetCart(current,storage);
  }
  function removeSet(groupId,storage){
    const id=positiveId(groupId);
    return writeSetCart(splitSetCart(storage).lines.filter(line=>line.group_id!==id),storage);
  }
  function changeSetQty(groupId,delta,storage){
    const id=positiveId(groupId);
    const lines=splitSetCart(storage).lines;
    const line=lines.find(row=>row.group_id===id);
    if(!line)return false;
    line.qty=Math.max(1,Math.min(MAX_SET_QTY,line.qty+Number(delta||0)));
    return writeSetCart(lines,storage);
  }
  function cartInput(bookLines,setLines){
    const books=(Array.isArray(bookLines)?bookLines:[]).map(line=>({
      kind:"book",
      book_id:positiveId(line&&line.id),
      qty:qty(line&&line.qty)
    })).filter(line=>line.book_id&&line.qty!=null);
    const sets=(Array.isArray(setLines)?setLines:[]).map(normalizeSetLine).filter(Boolean).map(line=>({
      kind:"set",group_id:line.group_id,qty:line.qty
    }));
    return [...books,...sets];
  }
  function cartSignature(bookLines,setLines){
    return JSON.stringify(cartInput(bookLines,setLines));
  }
  function invalidateQuote(){
    cachedQuote=null;
    cachedSignature="";
    quotePromise=null;
  }
  function quoteExpiryMs(quote){
    const ms=Date.parse(String(quote&&quote.expires_at||""));
    return Number.isFinite(ms)?ms:0;
  }
  function quoteUsable(quote,signature,now){
    const at=Number.isFinite(Number(now))?Number(now):Date.now();
    return !!quote
      &&Number(quote.schema_version)===QUOTE_SCHEMA_VERSION
      &&String(quote.fingerprint||"")
      &&quoteExpiryMs(quote)>at+1000
      &&(!signature||String(signature)===cachedSignature);
  }
  function publicConfig(){
    const cfg=root.KUTADGU_SUPABASE_CONFIG||{};
    return {url:String(cfg.url||"").replace(/\/+$/,""),key:String(cfg.anonKey||cfg.publishableKey||"")};
  }
  async function rpc(name,args,fetchImpl){
    const cfg=publicConfig();
    if(!cfg.url||!cfg.key)throw new Error("volume_quote_unavailable");
    const response=await (fetchImpl||fetch)(`${cfg.url}/rest/v1/rpc/${name}`,{
      method:"POST",
      headers:{apikey:cfg.key,Authorization:`Bearer ${cfg.key}`,"Content-Type":"application/json",Accept:"application/json"},
      body:JSON.stringify(args||{})
    });
    const text=await response.text();
    let data=null;
    try{data=text?JSON.parse(text):null}catch(error){}
    if(!response.ok){
      const err=new Error(String(data&&data.message||data&&data.error||"volume_quote_failed"));
      err.status=response.status;
      err.details=data&&data.details;
      err.hint=data&&data.hint;
      throw err;
    }
    return data;
  }
  async function requestQuote(bookLines,setLines,options){
    const signature=cartSignature(bookLines,setLines);
    if(!signature||signature==="[]")throw new Error("empty_items");
    if(quoteUsable(cachedQuote,signature))return cachedQuote;
    if(quotePromise&&cachedSignature===signature)return quotePromise;
    cachedSignature=signature;
    quotePromise=rpc("quote_book_volume_cart",{p_items:cartInput(bookLines,setLines)},options&&options.fetchImpl)
      .then(quote=>{
        if(!quoteUsable(quote,"")){
          throw new Error("invalid_volume_quote");
        }
        if(cachedSignature===signature)cachedQuote=quote;
        return quote;
      })
      .finally(()=>{quotePromise=null});
    return quotePromise;
  }
  function cachedQuoteFor(bookLines,setLines){
    const signature=cartSignature(bookLines,setLines);
    return quoteUsable(cachedQuote,signature)?cachedQuote:null;
  }
  function normalizeGroup(value){
    if(!value||typeof value!=="object"||Array.isArray(value))return null;
    const id=positiveId(value.id);
    const rawMembers=Array.isArray(value.members)?value.members:[];
    if(!id||rawMembers.length<2||rawMembers.length>MAX_GROUP_VOLUMES)return null;
    const members=rawMembers.map(member=>{
      const bookId=positiveId(member&&member.book_id);
      const position=Number(member&&member.position);
      const price=Number(member&&member.price);
      const stock=Number(member&&member.stock);
      if(!bookId||!Number.isInteger(position)||position<1||position>MAX_GROUP_VOLUMES)return null;
      return {
        book_id:bookId,
        position,
        volume_label:String(member.volume_label||""),
        title:String(member.title||""),
        author:String(member.author||""),
        price:Number.isFinite(price)?price:null,
        image_url:String(member.image_url||""),
        stock:Number.isInteger(stock)&&stock>=0?stock:null,
        stock_status:String(member.stock_status||""),
        is_active:member.is_active!==false
      };
    });
    if(members.some(member=>!member))return null;
    const bookIds=new Set(members.map(member=>member.book_id));
    const positions=new Set(members.map(member=>member.position));
    if(bookIds.size!==members.length||positions.size!==members.length)return null;
    members.sort((a,b)=>a.position-b.position);
    return {
      id,
      slug:String(value.slug||""),
      title:String(value.title||""),
      author:String(value.author||""),
      category:String(value.category||""),
      source:String(value.source||""),
      description:String(value.description||""),
      complete_set_price:value.complete_set_price==null?null:Number(value.complete_set_price),
      representative_book_id:positiveId(value.representative_book_id)||members[0].book_id,
      revision:Number(value.revision)||0,
      quote_revision:String(value.quote_revision||""),
      members
    };
  }
  async function getPublicGroup(groupId,options){
    const id=positiveId(groupId);
    if(!id)return null;
    return normalizeGroup(await rpc("get_public_book_volume_group_storefront",{
      p_group_id:id,
      p_slug:null,
      p_child_book_id:null
    },options&&options.fetchImpl));
  }
  function explicitSetPrice(group){
    if(!group||group.complete_set_price==null||group.complete_set_price==="")return null;
    const amount=Number(group.complete_set_price);
    return Number.isFinite(amount)?amount:null;
  }
  function groupSetPrice(group){
    if(!group)return null;
    const explicit=explicitSetPrice(group);
    if(explicit!=null)return explicit;
    let total=0;
    for(const member of group.members||[]){
      if(!Number.isFinite(Number(member.price)))return null;
      total+=Number(member.price);
    }
    return total;
  }
  function memberAvailable(member,quantity){
    const amount=qty(quantity)||1;
    if(!member||member.is_active===false||member.price==null)return false;
    if(String(member.stock_status||"").trim()==="out_of_stock")return false;
    return Number.isFinite(member.stock)?member.stock>=amount:true;
  }
  function setAvailable(group,quantity){
    return !!group&&(group.members||[]).length>=2&&group.members.every(member=>memberAvailable(member,quantity));
  }
  function quoteItemsForHistory(quote){
    return Array.isArray(quote&&quote.items)?quote.items.map(item=>({...item})):[];
  }

  return {
    SET_CART_KEY,QUOTE_SCHEMA_VERSION,MAX_SET_QTY,MAX_GROUP_VOLUMES,
    featureEnabled,positiveId,qty,normalizeSetLine,normalizeSetLines,splitSetCart,writeSetCart,
    mergeSetLines,cloudRowsToSetLines,addSet,removeSet,changeSetQty,cartInput,cartSignature,invalidateQuote,
    quoteUsable,requestQuote,cachedQuoteFor,normalizeGroup,getPublicGroup,
    explicitSetPrice,groupSetPrice,memberAvailable,setAvailable,quoteItemsForHistory
  };
});
