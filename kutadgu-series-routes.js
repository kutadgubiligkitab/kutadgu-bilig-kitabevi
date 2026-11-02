(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.KutadguSeriesRoutes=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  let browserRows=[];
  const valid=value=>/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value||''))?String(value):'';
  function enrich(value,rows){
    const directory=rows||browserRows;
    const key=String(value.group_slug||value.groupSlug||value.slug||'');
    const row=directory.find(r=>r.legacy_slug===key||r.public_slug===key)
      ||directory.find(r=>String(r.group_id)===String(value.group_id||value.groupId||value.id));
    return {...value,public_slug:valid(value.public_slug)||valid(row&&row.public_slug)};
  }
  function groupPath(value){
    const item=enrich(value||{});
    const readable=valid(item.public_slug);
    const legacy=valid(item.group_slug||item.slug);
    return readable?'/series/'+readable:legacy?'/volume-group/'+legacy:'';
  }
  async function load(options={}){
    const cfg=root.KUTADGU_SUPABASE_CONFIG||{};
    const url=options.url||cfg.url||'https://fxlojnqwyojqjskfggmh.supabase.co';
    const key=options.key||cfg.anonKey||cfg.publishableKey||'sb_publishable_lqxWeLH9m7hGbPMUfVY0pA_bdcK-PzE';
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),4000);
    try{
      const response=await (options.fetchImpl||fetch)(url.replace(/\/$/,'')+'/rest/v1/rpc/list_public_book_series_routes',{
        method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:'{}',signal:options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal
      });
      const data=await response.json();
      // Only the missing-function response is a pre-migration database.
      if(response.status===404&&data&&data.code==='PGRST202')return [];
      if(!response.ok||!Array.isArray(data))throw Error('series_routes_unavailable');
      if(data.some(r=>!r||!/^\d+$/.test(String(r.group_id))||!valid(r.legacy_slug)||!valid(r.public_slug)))throw Error('invalid_series_routes');
      if(root.document)browserRows=data;
      return data;
    }finally{clearTimeout(timer)}
  }
  return {valid,enrich,groupPath,load};
});
