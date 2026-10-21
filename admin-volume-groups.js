(function(root){
  "use strict";

  const $=selector=>document.querySelector(selector);
  const state={db:null,loaded:false,loading:false,groups:[],current:null,members:[],lookup:null};

  function text(value){return String(value==null?"":value).trim()}
  function positiveId(value){const v=text(value);return /^[1-9][0-9]*$/.test(v)?v:""}
  function escapeHtml(value){
    const safe=root.KutadguSafeUrl;
    if(safe&&safe.escapeHtml)return safe.escapeHtml(value);
    return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  }
  function safeCover(value){
    const safe=root.KutadguSafeUrl;
    return safe&&safe.safeCoverUrl?safe.safeCoverUrl(value,{fallback:"/sample-book-cover.png"}):"/sample-book-cover.png";
  }
  function categoryEntries(){
    const options=Array.from($("#bookSource")?.options||[])
      .filter(option=>option.value).map(option=>({source:option.value,label:option.textContent.trim()}));
    return options.length?options:(root.KUTADGU_APP_CONFIG?.catalogCategories||[]);
  }
  function syncCategorySource(){
    const input=$("#volumeGroupCategory");
    const category=text(input.value);
    // Editing an existing group must preserve its saved routing, including legacy values.
    if(state.current&&category===text(state.current.category)){
      $("#volumeGroupSource").value=text(state.current.source);
      input.setCustomValidity("");
      return;
    }
    const entry=categoryEntries().find(item=>text(item.label)===category);
    $("#volumeGroupSource").value=entry?entry.source:"";
    input.setCustomValidity(category&&!entry?"كىتاب تۈرىنى تىزىمدىن تاللاڭ.":"");
  }
  function bindSuggestions(){
    const suggest=root.KutadguBookEntrySuggest;
    if(!suggest)return;
    const authors=()=>suggest.uniqueValuesFromRows(root.__kutadguSuggestionRows||[],"author");
    const categories=()=>[...new Set(categoryEntries().map(item=>item.label))];
    suggest.attachCombobox($("#volumeGroupAuthor"),authors);
    suggest.attachCombobox($("#volumeGroupCategory"),categories);
    suggest.attachCombobox($("#volumeSeriesAuthor"),authors);
    suggest.attachCombobox($("#volumeSeriesCategory"),categories);
  }
  function setStatus(message,kind){
    const el=$("#volumeGroupStatus");
    if(!el)return;
    el.textContent=message||"";
    el.className=`admin-status${kind?` ${kind}`:""}`;
  }
  async function rpc(name,args){
    if(!state.db)throw new Error("admin_volume_groups_unavailable");
    const result=await state.db.rpc(name,args||{});
    if(!result||typeof result!=="object")throw new Error("admin_volume_groups_unavailable");
    const error=result.error;
    if(error){
      // PostgREST leaves HTTP status on the result. Gateway 500/502 bodies are
      // only {message} and do not carry error.status.
      if(typeof error==="object"&&result.status!=null&&error.status==null)error.status=result.status;
      if(typeof error==="object"&&result.statusText&&error.statusText==null)error.statusText=result.statusText;
      throw error;
    }
    return result.data;
  }
  function normalizedMember(value,index){
    if(!value||typeof value!=="object")return null;
    const id=positiveId(value.book_id??value.id);
    if(!id)return null;
    return {
      book_id:id,
      position:index+1,
      volume_label:text(value.volume_label)||`${index+1}-قىسىم`,
      title:text(value.title),
      author:text(value.author),
      price:value.price==null||value.price===""?null:Number(value.price),
      stock:value.stock==null||value.stock===""?null:Number(value.stock),
      stock_status:text(value.stock_status),
      image_url:text(value.image_url),
      href:text(value.href||value.url)||`/book/${id}`,
      isbn:text(value.isbn),
      is_active:value.is_active!==false,
      group_id:positiveId(value.group_id),
      group_title:text(value.group_title),
      group_slug:text(value.group_slug)
    };
  }
  function normalizeMembers(values){
    const seen=new Set();
    return (Array.isArray(values)?values:[]).map(normalizedMember).filter(member=>{
      if(!member||seen.has(member.book_id))return false;
      seen.add(member.book_id);
      return true;
    }).map((member,index)=>({...member,position:index+1}));
  }
  function groupRows(value){
    if(Array.isArray(value))return value;
    return Array.isArray(value&&value.items)?value.items:[];
  }
  function renderList(){
    const host=$("#volumeGroupList");
    if(!host)return;
    if(!state.groups.length){
      host.innerHTML='<div class="admin-empty">تېخى قىسىملىق كىتاب يوق.</div>';
      return;
    }
    host.innerHTML=state.groups.map(group=>`<button type="button" class="volume-group-list-row" data-volume-group-edit="${escapeHtml(group.id)}">
      <span><strong>${escapeHtml(group.title||"نامى يېزىلمىغان يۈرۈشلۈك")}</strong><small>${escapeHtml(group.slug||`ID ${group.id}`)}</small></span>
      <span>${Number(group.member_count)||0} قىسىم</span>
      <span class="${group.is_public?"is-public":"is-private"}">${group.is_public?"كۆرسىتىشكە تەييار":"تېخى چىقىرىلمىغان"}</span>
    </button>`).join("");
    host.querySelectorAll("[data-volume-group-edit]").forEach(button=>{
      button.onclick=()=>openGroup(button.dataset.volumeGroupEdit);
    });
  }
  function renderMembers(){
    const host=$("#volumeGroupMembers");
    if(!host)return;
    const representative=positiveId($("#volumeGroupRepresentative")?.value);
    if(!state.members.length){
      host.innerHTML='<div class="admin-empty">كىتاب نومۇرى ياكى ISBN بىلەن تېپىپ، ئاز دېگەندە 2 قىسىم قوشۇڭ.</div>';
      return;
    }
    host.innerHTML=state.members.map((member,index)=>`<article class="volume-admin-member" data-volume-member-id="${escapeHtml(member.book_id)}">
      <div class="volume-admin-member-order">
        <button type="button" data-member-move="-1" ${index===0?"disabled":""} aria-label="ئۈستىگە">↑</button>
        <strong>${index+1}</strong>
        <button type="button" data-member-move="1" ${index===state.members.length-1?"disabled":""} aria-label="ئاستىغا">↓</button>
      </div>
      <img src="${escapeHtml(safeCover(member.image_url))}" alt="" width="64" height="92">
      <div class="volume-admin-member-copy">
        <strong>${escapeHtml(member.title||`كىتاب ${member.book_id}`)}</strong>
        <small>ID ${escapeHtml(member.book_id)}${member.isbn?` · ISBN ${escapeHtml(member.isbn)}`:""}</small>
        <small>${member.price==null?"باھاسىز":`${escapeHtml(member.price)} ₺`} · ئامبار ${member.stock==null?"بېكىتىلمىگەن":escapeHtml(member.stock)}</small>
        <a href="${escapeHtml(member.href)}" target="_blank" rel="noopener">كىتابنى ئېچىش</a>
        <label>قىسىم بەلگىسى <input type="text" maxlength="120" value="${escapeHtml(member.volume_label)}" data-member-label></label>
      </div>
      <label class="volume-admin-representative"><input type="radio" name="volumeRepresentative" value="${escapeHtml(member.book_id)}" ${representative===member.book_id||(!representative&&index===0)?"checked":""}> باش مۇقاۋا</label>
      <button type="button" class="admin-danger" data-member-remove>چىقىرىش</button>
    </article>`).join("");
    const checked=host.querySelector('input[name="volumeRepresentative"]:checked');
    if($("#volumeGroupRepresentative"))$("#volumeGroupRepresentative").value=checked?checked.value:state.members[0].book_id;
    host.querySelectorAll(".volume-admin-member").forEach(row=>{
      const id=row.dataset.volumeMemberId;
      row.querySelector("[data-member-label]").oninput=event=>{
        const member=state.members.find(item=>item.book_id===id);
        if(member)member.volume_label=event.target.value;
      };
      row.querySelectorAll("[data-member-move]").forEach(button=>button.onclick=()=>moveMember(id,Number(button.dataset.memberMove)));
      row.querySelector("[data-member-remove]").onclick=()=>removeMember(id);
      row.querySelector('input[name="volumeRepresentative"]').onchange=event=>{
        if(event.target.checked)$("#volumeGroupRepresentative").value=id;
      };
    });
  }
  function moveMember(id,delta){
    const index=state.members.findIndex(member=>member.book_id===String(id));
    const target=index+delta;
    if(index<0||target<0||target>=state.members.length)return;
    const [member]=state.members.splice(index,1);
    state.members.splice(target,0,member);
    state.members=normalizeMembers(state.members);
    renderMembers();
  }
  function removeMember(id){
    state.members=normalizeMembers(state.members.filter(member=>member.book_id!==String(id)));
    renderMembers();
  }
  function fillEditor(group){
    const value=group||{};
    $("#volumeGroupId").value=positiveId(value.id);
    $("#volumeGroupRevision").value=Number(value.revision)||0;
    $("#volumeGroupSlug").value=text(value.slug);
    $("#volumeGroupTitle").value=text(value.title);
    $("#volumeGroupAuthor").value=text(value.author);
    $("#volumeGroupCategory").value=text(value.category);
    $("#volumeGroupCategory").setCustomValidity("");
    $("#volumeGroupSource").value=text(value.source);
    $("#volumeGroupDescription").value=text(value.description);
    $("#volumeGroupSetPrice").value=value.complete_set_price==null?"":value.complete_set_price;
    $("#volumeGroupActive").checked=value.is_active!==false;
    $("#volumeGroupRepresentative").value=positiveId(value.representative_book_id);
    $("#volumeGroupVisibility").textContent=value.is_public?"كۆرسىتىشكە تەييار":"تېخى چىقىرىلمىغان";
    $("#volumeGroupPublishBtn").textContent=value.is_public?"خېرىدارلاردىن يوشۇرۇش":"تور بەتكە تەييارلاش";
    $("#volumeGroupPublishBtn").disabled=!positiveId(value.id);
    state.current=value.id?value:null;
    state.members=normalizeMembers(value.members);
    renderMembers();
  }
  function newGroup(){
    showLinkForm();
    fillEditor({is_active:true,members:[]});
    $("#volumeGroupLookupPreview").innerHTML="";
    $("#volumeGroupBookLookup").value="";
    setStatus("قىسىملارنى قوشۇپ ساقلاڭ؛ تېخى خېرىدارلارغا كۆرۈنمەيدۇ.","");
  }
  async function openGroup(id){
    setStatus("يۈرۈشلۈك يۈكلىنىۋاتىدۇ…","");
    try{
      const group=await rpc("admin_get_book_volume_group",{p_group_id:positiveId(id)});
      if(!group)throw new Error("volume_group_not_found");
      fillEditor(group);
      setStatus("يۈرۈشلۈكنى ئۆزگەرتەلەيسىز.","ok");
    }catch(error){setStatus(error.message||String(error),"error")}
  }
  function editorPayload(){
    state.members=normalizeMembers(state.members);
    syncCategorySource();
    // Generate only for an unsaved group; never rename an existing group URL.
    if(!state.current&&!text($("#volumeGroupSlug").value)&&state.members.length){
      $("#volumeGroupSlug").value=`series-${state.members[0].book_id}`;
    }
    const representative=positiveId($("#volumeGroupRepresentative").value)||state.members[0]?.book_id||"";
    return {
      id:positiveId($("#volumeGroupId").value)||null,
      expectedRevision:Number($("#volumeGroupRevision").value)||null,
      group:{
        slug:text($("#volumeGroupSlug").value)||null,
        title:text($("#volumeGroupTitle").value),
        author:text($("#volumeGroupAuthor").value),
        category:text($("#volumeGroupCategory").value),
        source:text($("#volumeGroupSource").value),
        description:text($("#volumeGroupDescription").value),
        complete_set_price:$("#volumeGroupSetPrice").value===""?null:Number($("#volumeGroupSetPrice").value),
        representative_book_id:representative||null,
        is_active:$("#volumeGroupActive").checked
      },
      members:state.members.map((member,index)=>({
        book_id:member.book_id,
        position:index+1,
        volume_label:text(member.volume_label)||`${index+1}-قىسىم`
      }))
    };
  }
  async function saveGroup(event){
    event.preventDefault();
    const payload=editorPayload();
    if(!payload.group.title){setStatus("يۈرۈشلۈك نامىنى كىرگۈزۈڭ.","error");return}
    if(payload.members.length<2||payload.members.length>100){setStatus("يۈرۈشلۈكتە 2 دىن 100 گىچە قىسىم بولۇشى كېرەك.","error");return}
    if(!$("#volumeGroupCategory").checkValidity()||(!state.current&&!payload.group.source)){
      setStatus("كىتاب تۈرىنى تىزىمدىن تاللاڭ.","error");
      $("#volumeGroupCategory").reportValidity();
      return;
    }
    setStatus("ساقلىنىۋاتىدۇ…","");
    try{
      const saved=await rpc("admin_save_book_volume_group",{
        p_group_id:payload.id,
        p_expected_revision:payload.expectedRevision,
        p_group:payload.group,
        p_members:payload.members
      });
      fillEditor(saved);
      await load(true);
      setStatus("يۈرۈشلۈك ساقلاندى. كىتاب ئۇچۇرلىرى ئۆزگەرتىلمىدى.","ok");
    }catch(error){
      const stale=/stale|revision|40001/i.test(`${error.message||""} ${error.code||""}`);
      setStatus(stale?"بۇ يۈرۈشلۈك باشقا كۆزنەكتە ئۆزگەرتىلگەن. قايتا يۈكلەپ تەكرارلاڭ.":(error.message||String(error)),"error");
    }
  }
  async function publishGroup(){
    const id=positiveId($("#volumeGroupId").value);
    const revision=Number($("#volumeGroupRevision").value);
    if(!id||!revision)return;
    const next=!(state.current&&state.current.is_public===true);
    setStatus(next?"تەكشۈرۈلۈۋاتىدۇ…":"يوشۇرۇلۇۋاتىدۇ…","");
    try{
      const saved=await rpc("admin_set_book_volume_group_publication",{
        p_group_id:id,p_expected_revision:revision,p_is_public:next
      });
      fillEditor(saved);
      await load(true);
      setStatus(next?"يۈرۈشلۈك تەييارلاندى. قىسىملىق كىتاب ئىقتىدارى ئېچىلغاندا خېرىدارلار كۆرىدۇ.":"يۈرۈشلۈك خېرىدارلاردىن يوشۇرۇلدى.","ok");
    }catch(error){setStatus(error.message||String(error),"error")}
  }
  function normalizeLookup(value){
    const rows=Array.isArray(value)?value:Array.isArray(value&&value.items)?value.items:(value&&value.id?[value]:[]);
    return rows.map((row,index)=>normalizedMember(row,index)).filter(Boolean);
  }
  function renderLookup(rows){
    const host=$("#volumeGroupLookupPreview");
    if(!host)return;
    if(!rows.length){host.innerHTML='<div class="admin-empty">دەل ماس كېلىدىغان كىتاب تېپىلمىدى.</div>';return}
    const currentId=positiveId($("#volumeGroupId")?.value);
    host.innerHTML=rows.map(row=>{
      const linked=positiveId(row.group_id);
      const linkedElsewhere=!!linked&&linked!==currentId;
      const alreadyPresent=state.members.some(member=>member.book_id===row.book_id);
      return `<article class="volume-admin-lookup">
      <img src="${escapeHtml(safeCover(row.image_url))}" alt="" width="54" height="78">
      <span><strong>${escapeHtml(row.title||`كىتاب ${row.book_id}`)}</strong><small>ID ${escapeHtml(row.book_id)}${row.isbn?` · ISBN ${escapeHtml(row.isbn)}`:""}</small><small>${row.price==null?"باھاسىز":`${escapeHtml(row.price)} ₺`} · ئامبار ${row.stock==null?"بېكىتىلمىگەن":escapeHtml(row.stock)}</small>${linked?`<small class="${linkedElsewhere?"is-linked-elsewhere":"is-linked-current"}">${linkedElsewhere?"باشقا يۈرۈشلۈككە باغلانغان":"مۇشۇ يۈرۈشلۈككە باغلانغان"}: ${escapeHtml(row.group_title||row.group_slug||`ID ${linked}`)}</small>`:""}${row.href?`<a href="${escapeHtml(row.href)}" target="_blank" rel="noopener">كىتابنى ئېچىش</a>`:""}</span>
      <button type="button" class="admin-secondary" data-lookup-add="${escapeHtml(row.book_id)}"${linkedElsewhere||alreadyPresent?" disabled":""}>${linkedElsewhere?"باغلاشقا بولمايدۇ":alreadyPresent?"قوشۇلغان":"قىسىم قىلىپ قوشۇش"}</button>
    </article>`;
    }).join("");
    host.querySelectorAll("[data-lookup-add]").forEach(button=>button.onclick=()=>{
      const row=rows.find(item=>item.book_id===button.dataset.lookupAdd);
      if(!row)return;
      const linked=positiveId(row.group_id);
      if(linked&&linked!==currentId){setStatus("بۇ كىتاب باشقا يۈرۈشلۈككە باغلانغان. ئالدى بىلەن شۇ يۈرۈشلۈكتىن چىقىرىڭ.","error");return}
      if(state.members.some(member=>member.book_id===row.book_id)){setStatus("بۇ كىتاب ئاللىقاچان قىسىم تىزىملىكىدە.","error");return}
      if(!state.members.length&&!text($("#volumeGroupAuthor").value))$("#volumeGroupAuthor").value=row.author;
      state.members=normalizeMembers([...state.members,{...row,volume_label:`${state.members.length+1}-قىسىم`}]);
      renderMembers();
      host.innerHTML="";
    });
  }
  async function lookupBook(){
    const query=text($("#volumeGroupBookLookup").value);
    if(!query)return;
    setStatus("كىتاب تەكشۈرۈلۈۋاتىدۇ…","");
    try{
      const rows=normalizeLookup(await rpc("admin_preview_book_volume_members",{
        p_book_id:/^[1-9][0-9]*$/.test(query)?query:null,
        p_isbn:query
      }));
      renderLookup(rows);
      setStatus(rows.length?"كىتاب نامى ۋە باھاسىنى تەكشۈرۈپ، قىسىم قىلىپ قوشۇڭ.":"بۇ نومۇردا كىتاب تېپىلمىدى.",rows.length?"ok":"warn");
    }catch(error){setStatus(error.message||String(error),"error")}
  }
  async function load(force){
    if(state.loading||state.loaded&&!force)return;
    state.loading=true;
    setStatus("يۈرۈشلۈكلەر يۈكلىنىۋاتىدۇ…","");
    try{
      state.groups=groupRows(await rpc("admin_list_book_volume_groups"));
      state.loaded=true;
      renderList();
      setStatus("قىسىملىق كىتابلارنى باشقۇرالايسىز.","ok");
    }catch(error){setStatus(error.message||String(error),"error")}
    finally{state.loading=false}
  }
  const seriesState={requestId:"",saving:false};
  function newRequestId(){
    if(root.crypto&&typeof root.crypto.randomUUID==="function")return root.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,ch=>{
      const n=Math.floor(Math.random()*16);
      return (ch==="x"?n:(n&0x3|0x8)).toString(16);
    });
  }
  function seriesStatus(message,kind){
    const el=$("#volumeSeriesStatus");
    if(!el)return;
    el.textContent=message||"";
    el.className=`admin-status${kind?` ${kind}`:""}`;
  }
  function syncSeriesCategory(){
    const input=$("#volumeSeriesCategory");
    if(!input)return;
    const category=text(input.value);
    const entry=categoryEntries().find(item=>text(item.label)===category);
    if($("#volumeSeriesSource"))$("#volumeSeriesSource").value=entry?entry.source:"";
    input.setCustomValidity(category&&!entry?"كىتاب تۈرىنى تىزىمدىن تاللاڭ.":"");
  }
  function seriesEntryPayload(input){
    const value=input&&typeof input==="object"?input:{};
    const requestId=text(value.requestId).toLowerCase();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestId)){
      return {ok:false,message:"ساقلاش نومۇرى تەييار ئەمەس. قايتا باشلاڭ."};
    }
    const title=text(value.title);
    const category=text(value.category);
    const source=text(value.source);
    if(!title)return {ok:false,message:"كىتاب نامىنى كىرگۈزۈڭ."};
    if(!category||!source)return {ok:false,message:"كىتاب تۈرىنى تىزىمدىن تاللاڭ."};
    const rawPrice=value.completeSetPrice;
    const complete=rawPrice==null||rawPrice===""?null:Number(rawPrice);
    if(complete!=null&&(!Number.isFinite(complete)||complete<0))return {ok:false,message:"يۈرۈشلۈك باھاسى توغرا ئەمەس."};
    const parts=Array.isArray(value.parts)?value.parts:[];
    if(parts.length<2||parts.length>100)return {ok:false,message:"يۈرۈشلۈكتە 2 دىن 100 گىچە قىسىم بولۇشى كېرەك."};
    let representative=0;
    const built=[];
    for(let index=0;index<parts.length;index+=1){
      const part=parts[index]||{};
      const price=part.price==null||part.price===""?NaN:Number(part.price);
      const stock=part.stock==null||part.stock===""?NaN:Number(part.stock);
      if(!Number.isFinite(price)||price<0||!Number.isInteger(stock)||stock<0){
        return {ok:false,message:`${index+1}-قىسىمنىڭ باھاسى ۋە ئامبار سانىنى كىرگۈزۈڭ.`};
      }
      const image=text(part.imageUrl||part.image_url);
      const prefix=`https://www.kutadgubilik.com/__r2/book-covers/series-new/${requestId}/part-${index+1}-`;
      const preview=value.allowPreviewUrls===true&&image.startsWith("https://");
      if(!image||(!preview&&!image.startsWith(prefix)))return {ok:false,message:`${index+1}-قىسىمنىڭ مۇقاۋىسى يوللانمىدى.`};
      const isbn=text(part.isbn).replace(/[^0-9Xx]/g,"");
      if(isbn&&isbn.length!==10&&isbn.length!==13)return {ok:false,message:`${index+1}-قىسىمنىڭ ISBN نومۇرى 10 ياكى 13 خانە بولسۇن.`};
      if(part.main)representative=index+1;
      built.push({
        title:text(part.title),
        price,
        stock,
        isbn,
        image_url:image,
        volume_label:text(part.volumeLabel)||`${index+1}-قىسىم`
      });
    }
    return {
      ok:true,
      requestId,
      payload:{
        title,
        author:text(value.author),
        category,
        source,
        description:text(value.description),
        complete_set_price:complete,
        representative_position:representative||1,
        parts:built
      }
    };
  }
  function seriesPartElement(){
    const article=document.createElement("article");
    article.className="volume-series-part";
    article.innerHTML=`<div class="volume-series-part-tools">
      <strong>قىسىم</strong>
      <button type="button" data-series-move="-1" aria-label="ئۈستىگە">↑</button>
      <button type="button" data-series-move="1" aria-label="ئاستىغا">↓</button>
      <button type="button" data-series-remove>چىقىرىش</button>
      <label class="volume-admin-representative"><input type="radio" name="volumeSeriesMain" data-series-main> باش مۇقاۋا</label>
    </div>
    <label>مۇقاۋا<input type="file" accept="image/jpeg,image/png,image/webp" data-series-cover></label>
    <label>باھاسى<input type="number" min="0" step="0.01" dir="ltr" data-series-price></label>
    <label>ئامبار سانى<input type="number" min="0" step="1" dir="ltr" data-series-stock></label>
    <label>قىسىم نامى (ئىختىيارىي)<input type="text" maxlength="500" data-series-title placeholder="بوش قالدۇرسىڭىز، ئورتاق نامغا قىسىم نومۇرى قوشۇلىدۇ"></label>
    <label>ISBN (ئىختىيارىي)<input type="text" maxlength="32" dir="ltr" data-series-isbn></label>`;
    return article;
  }
  function refreshSeriesParts(){
    const rows=[...($("#volumeSeriesParts")?.children||[])];
    rows.forEach((row,index)=>{
      const label=row.querySelector("strong");
      if(label)label.textContent=`${index+1}-قىسىم`;
      const up=row.querySelector('[data-series-move="-1"]');
      const down=row.querySelector('[data-series-move="1"]');
      const remove=row.querySelector("[data-series-remove]");
      if(up)up.disabled=index===0;
      if(down)down.disabled=index===rows.length-1;
      if(remove)remove.disabled=rows.length<=2;
    });
  }
  function bindSeriesPart(row){
    row.querySelector('[data-series-move="-1"]').onclick=()=>moveSeriesPart(row,-1);
    row.querySelector('[data-series-move="1"]').onclick=()=>moveSeriesPart(row,1);
    row.querySelector("[data-series-remove]").onclick=()=>removeSeriesPart(row);
  }
  function addSeriesPart(){
    const host=$("#volumeSeriesParts");
    if(!host||host.children.length>=100){
      seriesStatus("يۈرۈشلۈكتە ئەڭ كۆپ 100 قىسىم بولۇشى كېرەك.","error");
      return;
    }
    const row=seriesPartElement();
    host.appendChild(row);
    bindSeriesPart(row);
    if(!host.querySelector("[data-series-main]:checked"))row.querySelector("[data-series-main]").checked=true;
    refreshSeriesParts();
  }
  function moveSeriesPart(row,delta){
    const host=$("#volumeSeriesParts");
    const rows=[...host.children];
    const index=rows.indexOf(row);
    const target=index+delta;
    if(index<0||target<0||target>=rows.length)return;
    if(delta<0)host.insertBefore(row,rows[target]);
    else host.insertBefore(rows[target],row);
    refreshSeriesParts();
  }
  function removeSeriesPart(row){
    const host=$("#volumeSeriesParts");
    if(!host||host.children.length<=2)return;
    const wasMain=row.querySelector("[data-series-main]").checked;
    row.remove();
    if(wasMain){
      const first=host.querySelector("[data-series-main]");
      if(first)first.checked=true;
    }
    refreshSeriesParts();
  }
  function readSeriesDom(){
    return [...($("#volumeSeriesParts")?.children||[])].map(row=>({
      row,
      title:row.querySelector("[data-series-title]").value,
      price:row.querySelector("[data-series-price]").value,
      stock:row.querySelector("[data-series-stock]").value,
      isbn:row.querySelector("[data-series-isbn]").value,
      file:row.querySelector("[data-series-cover]").files&&row.querySelector("[data-series-cover]").files[0]||null,
      imageUrl:row.dataset.imageUrl||"",
      objectKey:row.dataset.objectKey||"",
      main:row.querySelector("[data-series-main]").checked
    }));
  }
  function resetSeriesForm(){
    seriesState.requestId=newRequestId();
    $("#volumeSeriesRequestId").value=seriesState.requestId;
    $("#volumeSeriesTitle").value="";
    $("#volumeSeriesAuthor").value="";
    $("#volumeSeriesCategory").value="";
    $("#volumeSeriesCategory").setCustomValidity("");
    $("#volumeSeriesSource").value="";
    $("#volumeSeriesSetPrice").value="";
    $("#volumeSeriesDescription").value="";
    $("#volumeSeriesParts").innerHTML="";
    addSeriesPart();
    addSeriesPart();
    seriesStatus("قىسىملارنى تولدۇرۇپ ساقلاڭ. بۇ خېرىدارلارغا تېخى كۆرۈنمەيدۇ.","");
  }
  function showSeriesForm(){
    if($("#volumeSeriesForm"))$("#volumeSeriesForm").hidden=false;
    if($("#volumeGroupForm"))$("#volumeGroupForm").hidden=true;
    if(!text($("#volumeSeriesRequestId")?.value))resetSeriesForm();
  }
  function showLinkForm(){
    if($("#volumeSeriesForm"))$("#volumeSeriesForm").hidden=true;
    if($("#volumeGroupForm"))$("#volumeGroupForm").hidden=false;
  }
  function seriesTransactionRolledBack(error){
    if(!error||typeof error!=="object")return false;
    const status=Number(error.status);
    if(!Number.isInteger(status)||status<400||status>=500||status===408||status===429)return false;
    return /^[0-9A-Z]{5}$/.test(String(error.code||""));
  }
  function seriesSaveMayStillCommit(error){
    return !seriesTransactionRolledBack(error);
  }
  async function discardSeriesKeys(keys){
    const discard=root.kutadguDiscardUnusedSeriesCover;
    if(typeof discard!=="function")return;
    for(const key of keys){
      try{await discard(key)}catch(error){}
    }
  }
  function seriesCoverKeys(rows){
    const keys=[];
    rows.forEach(row=>{
      const key=text(row&&row.objectKey);
      if(key&&!keys.includes(key))keys.push(key);
    });
    const pending=seriesState.pending;
    (pending&&pending.objectKeys||[]).forEach(key=>{
      const value=text(key);
      if(value&&!keys.includes(value))keys.push(value);
    });
    return keys;
  }
  function clearSeriesUploads(rows){
    rows.forEach(row=>{
      if(!row.row)return;
      delete row.row.dataset.imageUrl;
      delete row.row.dataset.objectKey;
    });
  }
  function finishSavedSeries(saved){
    seriesState.pending=null;
    fillEditor(saved);
    showLinkForm();
    $("#volumeSeriesRequestId").value="";
    seriesState.requestId="";
    seriesStatus(saved&&saved.replayed?"بۇ يۈرۈشلۈك ئاللىقاچان ساقلانغان. قايتا قوشۇلمىدى.":"يۈرۈشلۈك ساقلاندى. خېرىدارلارغا تېخى چىقمىدى.","ok");
  }
  async function saveSeries(event){
    event.preventDefault();
    if(seriesState.saving)return;
    syncSeriesCategory();
    const rows=readSeriesDom();
    const requestId=text($("#volumeSeriesRequestId").value).toLowerCase();
    const pending=seriesState.pending&&seriesState.pending.requestId===requestId?seriesState.pending:null;
    if(!pending&&rows.some(row=>!row.file&&!row.imageUrl)){
      seriesStatus("ھەر بىر قىسىمغا ئۆزىنىڭ مۇقاۋىسىنى تاللاڭ.","error");
      return;
    }
    const upload=root.kutadguUploadSeriesPartCover;
    if(!pending&&typeof upload!=="function"){seriesStatus("مۇقاۋا يوللاش تەييار ئەمەس.","error");return}
    seriesState.saving=true;
    const created=[];
    try{
      let built;
      if(pending){
        built={ok:true,requestId:pending.requestId,payload:pending.payload};
      }else{
        for(let index=0;index<rows.length;index+=1){
          const row=rows[index];
          if(row.imageUrl)continue;
          seriesStatus(`${index+1}-قىسىمنىڭ مۇقاۋىسى يوللىنىۋاتىدۇ…`,"");
          const uploaded=await upload(requestId,index+1,row.file);
          row.imageUrl=text(uploaded&&uploaded.url);
          row.objectKey=text(uploaded&&uploaded.key);
          row.row.dataset.imageUrl=row.imageUrl;
          row.row.dataset.objectKey=row.objectKey;
          if(row.objectKey)created.push(row.objectKey);
        }
        built=seriesEntryPayload({
          requestId,
          title:$("#volumeSeriesTitle").value,
          author:$("#volumeSeriesAuthor").value,
          category:$("#volumeSeriesCategory").value,
          source:$("#volumeSeriesSource").value,
          description:$("#volumeSeriesDescription").value,
          completeSetPrice:$("#volumeSeriesSetPrice").value,
          allowPreviewUrls:root.__kutadguSkipAdminAuth===true,
          parts:rows.map(row=>({title:row.title,price:row.price,stock:row.stock,isbn:row.isbn,imageUrl:row.imageUrl,main:row.main}))
        });
        if(!built.ok){
          await discardSeriesKeys(created);
          clearSeriesUploads(rows);
          seriesStatus(built.message,"error");
          return;
        }
        seriesState.pending={
          requestId:built.requestId,
          payload:built.payload,
          objectKeys:rows.map(row=>text(row.objectKey)).filter(Boolean)
        };
      }
      seriesStatus("ساقلىنىۋاتىدۇ…","");
      const saved=await rpc("admin_create_book_volume_series",{p_request_id:built.requestId,p_payload:built.payload});
      const kept=new Set((saved&&saved.members||[]).map(member=>text(member.image_url)));
      if(saved&&saved.replayed===true)await discardSeriesKeys(created.filter(key=>!kept.has(rows.find(row=>row.objectKey===key)?.imageUrl||"")));
      finishSavedSeries(saved);
      await load(true);
    }catch(error){
      if(seriesSaveMayStillCommit(error)){
        seriesStatus("جاۋاب يېتىپ كەلمىدى. قايتا ساقلىسىڭىز، ئوخشاش يۈرۈشلۈك ئەسلىگە كېلىدۇ. مۇقاۋا ئۆچۈرۈلمەيدۇ.","error");
        return;
      }
      const message=`${error&&error.message||error||""}`;
      if(/idempotency_payload_mismatch/.test(message)){
        try{
          const saved=await rpc("admin_get_book_volume_series_request",{p_request_id:requestId});
          const kept=new Set((saved&&saved.members||[]).map(member=>text(member.image_url)));
          await discardSeriesKeys(seriesCoverKeys(rows).filter(key=>{
            const row=rows.find(item=>item.objectKey===key);
            return !kept.has(text(row&&row.imageUrl));
          }));
          finishSavedSeries(saved);
          await load(true);
          return;
        }catch(recoverError){
          if(seriesSaveMayStillCommit(recoverError)){
            seriesStatus("جاۋاب يېتىپ كەلمىدى. قايتا ساقلىسىڭىز، ئوخشاش يۈرۈشلۈك ئەسلىگە كېلىدۇ. مۇقاۋا ئۆچۈرۈلمەيدۇ.","error");
            return;
          }
        }
      }
      seriesState.pending=null;
      await discardSeriesKeys(seriesCoverKeys(rows));
      clearSeriesUploads(rows);
      seriesStatus(/AAL2|42501/.test(message)?"2-باسقۇچلۇق دەلىللەش كېرەك.":message,"error");
    }finally{
      seriesState.saving=false;
    }
  }
  function bind(){
    bindSuggestions();
    $("#volumeGroupCategory")?.addEventListener("input",syncCategorySource);
    $("#volumeSeriesCategory")?.addEventListener("input",syncSeriesCategory);
    $("#newVolumeGroupBtn")?.addEventListener("click",newGroup);
    $("#showVolumeSeriesBtn")?.addEventListener("click",showSeriesForm);
    $("#showVolumeLinkBtn")?.addEventListener("click",showLinkForm);
    $("#volumeSeriesAddPart")?.addEventListener("click",addSeriesPart);
    $("#volumeSeriesForm")?.addEventListener("submit",saveSeries);
    $("#reloadVolumeGroupsBtn")?.addEventListener("click",()=>load(true));
    $("#volumeGroupForm")?.addEventListener("submit",saveGroup);
    $("#volumeGroupPublishBtn")?.addEventListener("click",publishGroup);
    $("#volumeGroupLookupBtn")?.addEventListener("click",lookupBook);
    $("#volumeGroupBookLookup")?.addEventListener("keydown",event=>{
      if(event.key==="Enter"){event.preventDefault();lookupBook()}
    });
  }
  function init(options){
    if(state.db)return;
    state.db=options&&options.db||root.__kutadguAdminDb||null;
    bind();
  }

  root.KutadguAdminVolumeGroups={init,load,newGroup,openGroup,normalizeMembers,editorPayload,seriesEntryPayload,showSeriesForm,_state:state};
})(typeof globalThis!=="undefined"?globalThis:this);
