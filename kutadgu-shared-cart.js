(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.KutadguSharedCart=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  const VERSION="v1";
  const MAX_ITEMS=80;
  const MAX_QTY=99;
  const MAX_PAYLOAD=2048;

  function asQty(raw){
    const n=typeof raw==="number"?raw:Number(String(raw??"").trim());
    if(!Number.isInteger(n)||n<1)return null;
    return Math.min(MAX_QTY,n);
  }

  function encodeSharedCart(items){
    if(!Array.isArray(items)||!items.length)return {ok:false,reason:"empty",payload:""};
    const map=new Map();
    for(const item of items){
      if(!item||typeof item!=="object")continue;
      const id=String(item.id==null?"":item.id).trim();
      if(!/^\d+$/.test(id))continue;
      const qty=asQty(item.qty);
      if(qty==null)continue;
      const prev=map.get(id)||0;
      map.set(id,Math.min(MAX_QTY,prev+qty));
    }
    if(!map.size)return {ok:false,reason:"empty",payload:""};
    if(map.size>MAX_ITEMS)return {ok:false,reason:"too_many",payload:""};
    const parts=[];
    for(const pair of map)parts.push(pair[0]+"x"+pair[1]);
    return {ok:true,reason:"",payload:VERSION+"."+parts.join(".")};
  }

  function decodeSharedCart(raw){
    let text=String(raw==null?"":raw).trim();
    if(!text||text.length>MAX_PAYLOAD)return {ok:false,reason:text?"too_long":"empty",items:[]};
    try{text=decodeURIComponent(text.replace(/\+/g," "))}
    catch(e){return {ok:false,reason:"encoding",items:[]}}
    text=text.trim();
    if(!text||text.length>MAX_PAYLOAD)return {ok:false,reason:text?"too_long":"empty",items:[]};
    if(!/^v1(?:\.|$)/.test(text))return {ok:false,reason:"version",items:[]};
    if(!/^v1(?:\.\d+x\d+)+$/.test(text))return {ok:false,reason:"malformed",items:[]};
    const chunks=text.slice(3).split(".");
    if(chunks.length>MAX_ITEMS)return {ok:false,reason:"too_many",items:[]};
    const map=new Map();
    for(const chunk of chunks){
      const match=/^(\d+)x(\d+)$/.exec(chunk);
      if(!match)return {ok:false,reason:"malformed",items:[]};
      const qty=asQty(match[2]);
      if(qty==null)return {ok:false,reason:"malformed",items:[]};
      const prev=map.get(match[1])||0;
      map.set(match[1],Math.min(MAX_QTY,prev+qty));
    }
    if(map.size>MAX_ITEMS)return {ok:false,reason:"too_many",items:[]};
    const items=[];
    for(const pair of map)items.push({id:pair[0],qty:pair[1]});
    return {ok:true,reason:"",items};
  }

  function mergeSharedLines(existing,incoming,lookup){
    const base=Array.isArray(existing)?existing:[];
    const items=[];
    const index=new Map();
    for(const row of base){
      if(!row||row.id==null)continue;
      const id=String(row.id).trim();
      if(!id)continue;
      const qty=asQty(row.qty)||1;
      if(index.has(id)){
        const at=index.get(id);
        items[at].qty=Math.min(MAX_QTY,items[at].qty+qty);
      }else{
        index.set(id,items.length);
        items.push({id,qty});
      }
    }
    const skipped=new Set();
    const clamped=new Set();
    let added=0;
    let increased=0;
    const rows=Array.isArray(incoming)?incoming:[];
    for(const row of rows){
      if(!row||!/^\d+$/.test(String(row.id||"").trim())){
        skipped.add(String(row&&row.id||""));
        continue;
      }
      const book=typeof lookup==="function"?lookup(String(row.id).trim()):null;
      if(!book||book.available===false||book.canBuy===false){
        skipped.add(String(row.id));
        continue;
      }
      const storeId=String(book.id||row.id).trim();
      if(!/^\d+$/.test(storeId)){
        skipped.add(String(row.id));
        continue;
      }
      let qty=asQty(row.qty);
      if(qty==null){
        skipped.add(storeId);
        continue;
      }
      const stock=book.stockQty;
      if(Number.isFinite(stock)){
        if(stock<=0){
          skipped.add(storeId);
          continue;
        }
        if(qty>stock){
          qty=stock;
          clamped.add(storeId);
        }
      }
      if(index.has(storeId)){
        const at=index.get(storeId);
        const beforeQty=items[at].qty;
        let sum=beforeQty+qty;
        if(Number.isFinite(stock)&&sum>stock){
          sum=stock;
          clamped.add(storeId);
        }
        if(sum>MAX_QTY){
          sum=MAX_QTY;
          clamped.add(storeId);
        }
        items[at].qty=sum;
        items[at].id=storeId;
        if(sum!==beforeQty)increased+=1;
      }else{
        index.set(storeId,items.length);
        items.push({id:storeId,qty});
        added+=1;
      }
    }
    return {
      items,
      added,
      increased,
      skipped:skipped.size,
      clamped:clamped.size,
      skippedIds:[...skipped],
      clampedIds:[...clamped]
    };
  }

  function sharedCartNotice(stats){
  const added=Number(stats&&stats.added)||0;
  const increased=Number(stats&&stats.increased)||0;
  const skipped=Number(stats&&stats.skipped)||0;
  const clamped=Number(stats&&stats.clamped)||0;
  if(!added&&!increased&&!clamped)return "بۇ ئۇلانمىدىكى كىتابلارنى قوشقىلى بولمىدى";
    if(skipped||clamped)return "بەزى كىتابلار قوشۇلدى. قالغانلىرى ئامبار ياكى تىزىملىكتە يوق";
    return "ھەمبەھىرلەنگەن كىتابلار سېۋىتىڭىزگە قوشۇلدى";
  }

  function sharedCartUrl(origin,payload){
    const base=String(origin||"https://www.kutadgubilik.com").replace(/\/+$/,"");
    return base+"/cart.html?share="+encodeURIComponent(String(payload||""));
  }

  function stripShareSearch(search){
    const params=new URLSearchParams(String(search||"").replace(/^\?/,""));
    params.delete("share");
    const query=params.toString();
    return query?"?"+query:"";
  }

  return {
    VERSION,
    MAX_ITEMS,
    MAX_QTY,
    encodeSharedCart,
    decodeSharedCart,
    mergeSharedLines,
    sharedCartNotice,
    sharedCartUrl,
    stripShareSearch
  };
});
