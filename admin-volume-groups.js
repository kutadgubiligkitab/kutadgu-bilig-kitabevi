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
    suggest.attachCombobox($("#volumeGroupAuthor"),()=>suggest.uniqueValuesFromRows(root.__kutadguSuggestionRows||[],"author"));
    suggest.attachCombobox($("#volumeGroupCategory"),()=>[...new Set(categoryEntries().map(item=>item.label))]);
  }
  function setStatus(message,kind){
    const el=$("#volumeGroupStatus");
    if(!el)return;
    el.textContent=message||"";
    el.className=`admin-status${kind?` ${kind}`:""}`;
  }
  async function rpc(name,args){
    if(!state.db)throw new Error("admin_volume_groups_unavailable");
    const {data,error}=await state.db.rpc(name,args||{});
    if(error)throw error;
    return data;
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
  function bind(){
    bindSuggestions();
    $("#volumeGroupCategory")?.addEventListener("input",syncCategorySource);
    $("#newVolumeGroupBtn")?.addEventListener("click",newGroup);
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

  root.KutadguAdminVolumeGroups={init,load,newGroup,openGroup,normalizeMembers,editorPayload,_state:state};
})(typeof globalThis!=="undefined"?globalThis:this);
