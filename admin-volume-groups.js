(function(root){
  "use strict";

  const $=selector=>document.querySelector(selector);
  const state={db:null,loaded:false,loading:false,groups:[],current:null,members:[],lookup:null};
  const linkSave={saving:false,pending:null};

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
      .filter(option=>option.value).map(option=>({
        source:option.value,
        label:option.textContent.replace(/\s*\(يوشۇرۇن\)\s*$/,"").trim()
      }));
    const base=options.length?options:(root.KUTADGU_APP_CONFIG?.catalogCategories||[]);
    const directory=root.KutadguBookCategories;
    if(!directory||typeof directory.authoritative!=="function"||!directory.authoritative())return base;
    const current=text(state.current&&state.current.source);
    return base.filter(item=>{
      const visible=directory.visible().some(row=>row.source===item.source);
      return visible||item.source===current;
    });
  }
  function markHiddenAssignment(input,source){
    if(!input)return;
    let note=input.parentElement&&input.parentElement.querySelector(".book-category-hidden-note");
    if(!note){
      note=document.createElement("span");
      note.className="book-category-hidden-note";
      input.insertAdjacentElement("afterend",note);
    }
    const directory=root.KutadguBookCategories;
    const hidden=!!(directory&&typeof directory.authoritative==="function"&&directory.authoritative()&&source&&!directory.visible().some(row=>row.source===source));
    note.textContent=hidden?"بۇ تۈر يوشۇرۇن. ئۆزگەرتمىسىڭىز ساقلىنىدۇ.":"";
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
    const currentId=positiveId(state.current&&state.current.id);
    if(!state.groups.length){
      host.innerHTML='<div class="admin-empty">تېخى قىسىملىق كىتاب يوق.</div>';
      return;
    }
    host.innerHTML=state.groups.map(group=>{
      const id=positiveId(group.id);
      const current=id&&id===currentId;
      return `<button type="button" class="volume-group-list-row" data-volume-group-edit="${escapeHtml(group.id)}" aria-current="${current?"true":"false"}">
      <span><strong>${escapeHtml(group.title||"نامى يېزىلمىغان يۈرۈشلۈك")}</strong><small>${escapeHtml(group.slug||`ID ${group.id}`)}</small></span>
      <span>${Number(group.member_count)||0} قىسىم</span>
      <span class="${group.is_public?"is-public":"is-private"}">${group.is_public?"كۆرسىتىشكە تەييار":"تېخى چىقىرىلمىغان"}</span>
    </button>`;
    }).join("");
    host.querySelectorAll("[data-volume-group-edit]").forEach(button=>{
      button.onclick=()=>openGroup(button.dataset.volumeGroupEdit);
    });
  }
  let editorGeneration=0;
  const metadataTouched={title:false,author:false,category:false,description:false};
  let savedFingerprint="";
  function editorFingerprint(){
    return JSON.stringify({
      id:positiveId($("#volumeGroupId")&&$("#volumeGroupId").value),
      title:text($("#volumeGroupTitle")&&$("#volumeGroupTitle").value),
      author:text($("#volumeGroupAuthor")&&$("#volumeGroupAuthor").value),
      category:text($("#volumeGroupCategory")&&$("#volumeGroupCategory").value),
      source:text($("#volumeGroupSource")&&$("#volumeGroupSource").value),
      description:text($("#volumeGroupDescription")&&$("#volumeGroupDescription").value),
      price:$("#volumeGroupSetPrice")?$("#volumeGroupSetPrice").value:"",
      active:$("#volumeGroupActive")?$("#volumeGroupActive").checked:true,
      representative:positiveId($("#volumeGroupRepresentative")&&$("#volumeGroupRepresentative").value),
      members:state.members.map(member=>({id:member.book_id,label:text(member.volume_label)}))
    });
  }
  function rememberSavedEditor(){
    savedFingerprint=editorFingerprint();
    syncAbandon();
  }
  function syncAbandon(){
    const button=$("#volumeGroupAbandon");
    if(!button)return;
    const id=positiveId($("#volumeGroupId")&&$("#volumeGroupId").value);
    button.hidden=!(id&&editorFingerprint()!==savedFingerprint);
  }
  function markMetadataTouched(field){
    if(Object.prototype.hasOwnProperty.call(metadataTouched,field))metadataTouched[field]=true;
    syncAbandon();
  }
  function resetMetadataTouched(){
    Object.keys(metadataTouched).forEach(field=>{metadataTouched[field]=false});
  }
  function renderMode(){
    const el=$("#volumeGroupMode");
    const current=state.current;
    const id=positiveId(current&&current.id);
    if(!el)return;
    if(!id){
      el.dataset.mode="draft";
      el.textContent="يېڭى يۈرۈشلۈك";
    }else if(current.is_public===true){
      el.dataset.mode="published";
      el.textContent=`نەشر قىلىنغان يۈرۈشلۈك: ${text(current.title)||"نامى يېزىلمىغان"}`;
    }else{
      el.dataset.mode="saved";
      el.textContent=`ساقلانغان يۈرۈشلۈك: ${text(current.title)||"نامى يېزىلمىغان"}`;
    }
    renderList();
  }
  function clearSlugRecovery(){
    const host=$("#volumeGroupSlugRecovery");
    if(!host)return;
    host.hidden=true;
    host.innerHTML="";
  }
  function categoryForBook(meta){
    const source=text(meta&&meta.source);
    const label=text(meta&&meta.category);
    const entries=categoryEntries();
    if(source){
      const bySource=entries.find(item=>item.source===source);
      if(bySource)return bySource;
    }
    if(label)return entries.find(item=>text(item.label)===label)||null;
    return null;
  }
  function applySharedMetadata(chosen,meta){
    if(state.current||state.members.length)return;
    const title=text(chosen&&chosen.title);
    const author=text(chosen&&chosen.author);
    const description=text(meta&&meta.description);
    if(!metadataTouched.title&&title)$("#volumeGroupTitle").value=title;
    if(!metadataTouched.author&&author)$("#volumeGroupAuthor").value=author;
    if(!metadataTouched.description&&description)$("#volumeGroupDescription").value=description;
    if(!metadataTouched.category){
      const entry=categoryForBook(meta);
      if(entry){
        $("#volumeGroupCategory").value=entry.label;
        syncCategorySource();
        markHiddenAssignment($("#volumeGroupCategory"),text($("#volumeGroupSource").value));
      }
    }
  }
  function retainGroup(saved){
    const id=positiveId(saved&&saved.id);
    if(!id)return;
    const summary={
      id:saved.id,
      title:text(saved.title),
      slug:text(saved.slug),
      member_count:Array.isArray(saved.members)?saved.members.length:Number(saved.member_count)||0,
      is_public:saved.is_public===true
    };
    const index=state.groups.findIndex(row=>positiveId(row.id)===id);
    if(index>=0)state.groups[index]={...state.groups[index],...summary};
    else state.groups=[summary,...state.groups];
    renderList();
  }
  function memberTitle(member){
    return text(member&&member.title)||`كىتاب ${member&&member.book_id||""}`;
  }
  function memberDetachControl(member,published){
    const name=`يۈرۈشلۈكتىن ئايرىش: ${memberTitle(member)}`;
    if(!published)return `<button type="button" class="volume-member-detach" data-member-remove aria-label="${escapeHtml(name)}">يۈرۈشلۈكتىن ئايرىش</button>`;
    return `<div class="volume-member-detach-box"><button type="button" class="volume-member-detach" data-member-remove-ask aria-label="${escapeHtml(name)}">يۈرۈشلۈكتىن ئايرىش</button></div>`;
  }
  function bindMemberDetach(row,id){
    const direct=row.querySelector("[data-member-remove]");
    if(direct){direct.onclick=()=>removeMember(id);return}
    const ask=row.querySelector("[data-member-remove-ask]");
    if(!ask)return;
    ask.onclick=()=>{
      const member=state.members.find(item=>item.book_id===id);
      const box=row.querySelector(".volume-member-detach-box");
      if(!box||!member)return;
      const name=memberTitle(member);
      box.innerHTML=`<p class="volume-member-detach-note">«${escapeHtml(name)}» تىزىمدا قالىدۇ. بۇ ئۆزگەرتىش ساقلىغاندىن كېيىن ئاندىن يېزىلىدۇ.</p><button type="button" class="volume-member-detach" data-member-remove-confirm aria-label="ئايرىشنى جەزملەش: ${escapeHtml(name)}">ئايرىشنى جەزملەش</button><button type="button" class="admin-secondary volume-member-detach-cancel" data-member-remove-cancel>ۋاز كېچىش</button>`;
      box.querySelector("[data-member-remove-confirm]").onclick=()=>removeMember(id);
      box.querySelector("[data-member-remove-cancel]").onclick=()=>renderMembers();
    };
  }
  function renderMembers(){
    const host=$("#volumeGroupMembers");
    if(!host)return;
    const representative=positiveId($("#volumeGroupRepresentative")?.value);
    if(!state.members.length){
      host.innerHTML='<div class="admin-empty">كىتاب نامى، ئاپتور، نومۇر ياكى ISBN بىلەن تېپىپ، ئاز دېگەندە 2 قىسىم قوشۇڭ.</div>';
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
      ${memberDetachControl(member,!!(state.current&&state.current.is_public))}
    </article>`).join("");
    const checked=host.querySelector('input[name="volumeRepresentative"]:checked');
    if($("#volumeGroupRepresentative"))$("#volumeGroupRepresentative").value=checked?checked.value:state.members[0].book_id;
    host.querySelectorAll(".volume-admin-member").forEach(row=>{
      const id=row.dataset.volumeMemberId;
      row.querySelector("[data-member-label]").oninput=event=>{
        const member=state.members.find(item=>item.book_id===id);
        if(member)member.volume_label=event.target.value;
        syncAbandon();
      };
      row.querySelectorAll("[data-member-move]").forEach(button=>button.onclick=()=>moveMember(id,Number(button.dataset.memberMove)));
      bindMemberDetach(row,id);
      row.querySelector('input[name="volumeRepresentative"]').onchange=event=>{
        if(event.target.checked){
          $("#volumeGroupRepresentative").value=id;
          syncAbandon();
        }
      };
    });
    syncAbandon();
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
    linkSave.pending=null;
    const value=group||{};
    $("#volumeGroupId").value=positiveId(value.id);
    $("#volumeGroupRevision").value=Number(value.revision)||0;
    $("#volumeGroupSlug").value=text(value.slug);
    $("#volumeGroupTitle").value=text(value.title);
    $("#volumeGroupAuthor").value=text(value.author);
    $("#volumeGroupCategory").value=text(value.category);
    $("#volumeGroupCategory").setCustomValidity("");
    $("#volumeGroupSource").value=text(value.source);
    markHiddenAssignment($("#volumeGroupCategory"),text(value.source));
    $("#volumeGroupDescription").value=text(value.description);
    $("#volumeGroupSetPrice").value=value.complete_set_price==null?"":value.complete_set_price;
    $("#volumeGroupActive").checked=value.is_active!==false;
    $("#volumeGroupRepresentative").value=positiveId(value.representative_book_id);
    $("#volumeGroupVisibility").textContent=value.is_public?"كۆرسىتىشكە تەييار":"تېخى چىقىرىلمىغان";
    $("#volumeGroupPublishBtn").textContent=value.is_public?"خېرىدارلاردىن يوشۇرۇش":"تور بەتكە تەييارلاش";
    $("#volumeGroupPublishBtn").disabled=!positiveId(value.id);
    state.current=value.id?value:null;
    state.members=normalizeMembers(value.members);
    if(state.current)Object.keys(metadataTouched).forEach(field=>{metadataTouched[field]=true});
    else resetMetadataTouched();
    renderMembers();
    renderMode();
    resetLookup();
    clearSlugRecovery();
    rememberSavedEditor();
  }
  function newGroup(){
    editorGeneration++;
    showLinkForm();
    fillEditor({is_active:true,members:[]});
    assignLinkSlug();
    setStatus("قىسىملارنى قوشۇپ ساقلاڭ؛ تېخى خېرىدارلارغا كۆرۈنمەيدۇ.","");
  }
  async function openGroup(id){
    editorGeneration++;
    const generation=editorGeneration;
    resetLookup();
    setStatus("يۈرۈشلۈك يۈكلىنىۋاتىدۇ…","");
    try{
      const group=await rpc("admin_get_book_volume_group",{p_group_id:positiveId(id)});
      if(generation!==editorGeneration)return;
      if(!group)throw new Error("volume_group_not_found");
      fillEditor(group);
      setStatus(group.is_public?"نەشر قىلىنغان يۈرۈشلۈك ئېچىلدى. ئۆزگەرتىش ساقلىغاندىن كېيىن ئاندىن يېزىلىدۇ.":"يۈرۈشلۈكنى ئۆزگەرتەلەيسىز.","ok");
    }catch(error){
      if(generation!==editorGeneration)return;
      setStatus(error.message||String(error),"error");
    }
  }
  function duplicateSlugError(error){
    const code=text(error&&typeof error==="object"?error.code:"");
    const blob=`${code} ${error&&error.message||""} ${error&&error.details||""} ${error&&error.hint||""}`;
    if(code!=="23505"&&!/23505/.test(blob))return false;
    return /book_volume_groups_slug|slug/i.test(blob);
  }
  async function explainDuplicateSlug(error,slug,generation){
    if(!duplicateSlugError(error))return false;
    const wanted=text(slug);
    let found=null;
    let readable=false;
    let detailState="absent";
    try{
      const rows=groupRows(await rpc("admin_list_book_volume_groups"));
      if(generation!==editorGeneration)return true;
      readable=true;
      state.groups=rows;
      state.loaded=true;
      renderList();
      const listed=rows.find(row=>text(row.slug)===wanted);
      if(listed&&positiveId(listed.id)){
        detailState="unverified";
        try{
          const detail=await rpc("admin_get_book_volume_group",{p_group_id:positiveId(listed.id)});
          if(generation!==editorGeneration)return true;
          if(detail&&positiveId(detail.id)===positiveId(listed.id)&&text(detail.slug)===wanted){
            found=detail;
            detailState="verified";
          }
        }catch(readError){
          if(generation!==editorGeneration)return true;
        }
      }
    }catch(listError){
      if(generation!==editorGeneration)return true;
      readable=false;
    }
    if(generation!==editorGeneration)return true;
    const host=$("#volumeGroupSlugRecovery");
    if(detailState==="verified"&&found&&positiveId(found.id)){
      setStatus(`بۇ ئۇلانما «${text(found.title)||wanted}» يۈرۈشلۈكىدە. يېڭى ئۇلانما ياسالمىدى ۋە كىتابلار قايتا باغلانمىدى.`,"error");
      if(host){
        host.hidden=false;
        host.innerHTML="";
        const button=document.createElement("button");
        button.type="button";
        button.className="admin-secondary volume-slug-open";
        button.textContent="شۇ يۈرۈشلۈكنى ئېچىش";
        button.addEventListener("click",()=>openGroup(found.id));
        host.appendChild(button);
      }
      return true;
    }
    const unverified=detailState==="unverified";
    const message=unverified
      ?"بۇ ئۇلانما ئىشلىتىلىۋاتىدۇ. يېڭى ئۇلانما ياسالمىدى. بۇ يۈرۈشلۈكنى جەزملەپ ئېچەلمىدىم."
      :readable
        ?"بۇ ئۇلانما ئىشلىتىلىۋاتىدۇ. يېڭى ئۇلانما ياسالمىدى. ماس يۈرۈشلۈكنىڭ خاتىرىسى تىزىمدا يوق."
        :"بۇ ئۇلانما ئىشلىتىلىۋاتىدۇ. يېڭى ئۇلانما ياسالمىدى. بۇرۇنقى يۈرۈشلۈكنىڭ خاتىرىسىنى ئوقۇيالمىدىم.";
    setStatus(message,"error");
    clearSlugRecovery();
    return true;
  }
  function newLinkSlug(){
    return `series-${newRequestId()}`;
  }
  function assignLinkSlug(){
    const input=$("#volumeGroupSlug");
    if(!input||text(input.value)||state.current||positiveId($("#volumeGroupId").value))return;
    input.value=newLinkSlug();
  }
  function linkSaveRejected(error){
    if(!error||typeof error!=="object")return false;
    const status=Number(error.status);
    if(!Number.isInteger(status)||status<400||status>=500||status===408||status===429)return false;
    return /^[0-9A-Z]{5}$/.test(String(error.code||""));
  }
  function editorPayload(){
    state.members=normalizeMembers(state.members);
    syncCategorySource();
    // A new linking draft gets one identifier. An existing group keeps its saved URL.
    if(!state.current&&!positiveId($("#volumeGroupId").value))assignLinkSlug();
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
    if(linkSave.saving)return;
    const generation=editorGeneration;
    const creating=!positiveId($("#volumeGroupId").value)&&!state.current;
    const frozen=creating&&linkSave.pending&&text(linkSave.pending.group&&linkSave.pending.group.slug)===text($("#volumeGroupSlug").value)?linkSave.pending:null;
    let payload;
    if(frozen)payload=frozen;
    else{
      payload=editorPayload();
      if(generation!==editorGeneration)return;
      if(!payload.group.title){setStatus("يۈرۈشلۈك نامىنى كىرگۈزۈڭ.","error");return}
      if(payload.members.length<2||payload.members.length>100){setStatus("يۈرۈشلۈكتە 2 دىن 100 گىچە قىسىم بولۇشى كېرەك.","error");return}
      if(!$("#volumeGroupCategory").checkValidity()||(!state.current&&!payload.group.source)){
        setStatus("كىتاب تۈرىنى تىزىمدىن تاللاڭ.","error");
        $("#volumeGroupCategory").reportValidity();
        return;
      }
      if(creating){
        if(!text(payload.group.slug)){
          setStatus("ئۇلانما ياسالمىدى. يۈرۈشلۈك ساقلانمىدى.","error");
          return;
        }
        linkSave.pending=JSON.parse(JSON.stringify(payload));
        payload=linkSave.pending;
      }
    }
    const button=$("#volumeGroupForm")?.querySelector("button[type='submit']");
    linkSave.saving=true;
    if(button)button.disabled=true;
    setStatus("ساقلىنىۋاتىدۇ…","");
    try{
      const saved=await rpc("admin_save_book_volume_group",{
        p_group_id:payload.id,
        p_expected_revision:payload.expectedRevision,
        p_group:payload.group,
        p_members:payload.members
      });
      if(generation!==editorGeneration){
        retainGroup(saved);
        return;
      }
      if(!saved||!positiveId(saved.id)){
        setStatus("جاۋاب يېتىپ كەلمىدى. يۈرۈشلۈك تازىلانمىدى.","error");
        return;
      }
      linkSave.pending=null;
      fillEditor(saved);
      await load(true,generation);
      if(generation!==editorGeneration)return;
      retainGroup(saved);
      setStatus("يۈرۈشلۈك ساقلاندى. كىتاب ئۇچۇرلىرى ئۆزگەرتىلمىدى.","ok");
    }catch(error){
      if(generation!==editorGeneration)return;
      if(creating&&!linkSaveRejected(error)){
        setStatus("جاۋاب يېتىپ كەلمىدى. يۈرۈشلۈك تازىلانمىدى.","error");
        return;
      }
      if(creating)linkSave.pending=null;
      if(await explainDuplicateSlug(error,payload.group.slug,generation))return;
      const stale=/stale|revision|40001/i.test(`${error.message||""} ${error.code||""}`);
      setStatus(stale?"بۇ يۈرۈشلۈك باشقا كۆزنەكتە ئۆزگەرتىلگەن. قايتا يۈكلەپ تەكرارلاڭ.":(error.message||String(error)),"error");
    }finally{
      linkSave.saving=false;
      if(button)button.disabled=false;
    }
  }
  async function publishGroup(){
    const generation=editorGeneration;
    const id=positiveId($("#volumeGroupId").value);
    const revision=Number($("#volumeGroupRevision").value);
    if(!id||!revision)return;
    const next=!(state.current&&state.current.is_public===true);
    setStatus(next?"تەكشۈرۈلۈۋاتىدۇ…":"يوشۇرۇلۇۋاتىدۇ…","");
    try{
      const saved=await rpc("admin_set_book_volume_group_publication",{
        p_group_id:id,p_expected_revision:revision,p_is_public:next
      });
      if(generation!==editorGeneration){
        retainGroup(saved);
        return;
      }
      if(!saved||!positiveId(saved.id)||saved.is_public!==next){
        setStatus("نەشر جاۋابى جەزملىنمىدى. ئېكران تازىلانمىدى.","error");
        return;
      }
      await load(true,generation);
      if(generation!==editorGeneration){
        retainGroup(saved);
        return;
      }
      retainGroup(saved);
      if(next){
        newGroup();
        setStatus("يۈرۈشلۈك تىزىمدا ساقلاندى. بۇ ئېكران يېڭى يۈرۈشلۈككە تەييار.","ok");
        return;
      }
      fillEditor(saved);
      setStatus("يۈرۈشلۈك خېرىدارلاردىن يوشۇرۇلدى.","ok");
    }catch(error){
      if(generation!==editorGeneration)return;
      setStatus(error.message||String(error),"error");
    }
  }
  function normalizeLookup(value){
    const rows=Array.isArray(value)?value:Array.isArray(value&&value.items)?value.items:(value&&value.id?[value]:[]);
    return rows.map((row,index)=>normalizedMember(row,index)).filter(Boolean);
  }
  let lookupGeneration=0;
  const lookupSelecting=new Set();
  const LOOKUP_PAGE=40;
  function resetLookup(){
    lookupGeneration++;
    lookupSelecting.clear();
    state.lookupRows=[];
    state.lookupQuery="";
    state.lookupCatalogCount=0;
    state.lookupTotal=0;
    const host=$("#volumeGroupLookupPreview");
    if(host){
      host.innerHTML="";
      host.setAttribute("aria-busy","false");
    }
    const input=$("#volumeGroupBookLookup");
    if(input)input.value="";
  }
  function isbnLookupQuery(query){
    const raw=text(query);
    if(!raw||raw.length>32||!/^[0-9Xx\s-]+$/.test(raw))return "";
    const digits=raw.replace(/[\s-]+/g,"").toUpperCase();
    if(digits.length!==10&&digits.length!==13)return "";
    return raw;
  }
  function catalogLookupFilter(query){
    const api=root.__kutadguAdminTest;
    if(!api||typeof api.searchOrFilter!=="function")throw new Error("admin_catalog_search_unavailable");
    return api.searchOrFilter(query,true);
  }
  async function searchEligibleCatalog(query,offset){
    // The admin book list is one filtered page. This query uses the same
    // authorized ilike filter and then walks every match, not that page.
    const filter=catalogLookupFilter(query);
    if(!filter)return {rows:[],total:0};
    if(!state.db||typeof state.db.from!=="function")throw new Error("admin_catalog_search_unavailable");
    const start=Number(offset)>0?Number(offset):0;
    const result=await state.db.from("books").select("id,title,author,price,stock,stock_status,image_url,isbn,is_active",{count:"exact"}).or(filter).order("id",{ascending:true}).range(start,start+LOOKUP_PAGE-1);
    if(!result||result.error)throw (result&&result.error)||new Error("admin_catalog_search_unavailable");
    const data=Array.isArray(result.data)?result.data:[];
    const total=Number(result.count);
    return {rows:data,total:Number.isFinite(total)?total:start+data.length};
  }
  function mergeLookup(previewRows,catalogRows){
    const seen=new Set();
    const out=[];
    (previewRows||[]).forEach(row=>{
      if(!row||seen.has(row.book_id))return;
      seen.add(row.book_id);
      out.push({...row,previewed:true});
    });
    (catalogRows||[]).forEach(row=>{
      const member=normalizedMember({...row,book_id:row.book_id??row.id},out.length);
      if(!member||seen.has(member.book_id))return;
      seen.add(member.book_id);
      out.push({...member,previewed:false,group_id:""});
    });
    return out;
  }
  function renderLookup(rows){
    const host=$("#volumeGroupLookupPreview");
    if(!host)return;
    state.lookupRows=rows||[];
    host.setAttribute("aria-busy","false");
    if(!state.lookupRows.length){
      host.innerHTML='<div class="admin-empty">دەل ماس كېلىدىغان كىتاب تېپىلمىدى.</div>';
      return;
    }
    const currentId=positiveId($("#volumeGroupId")?.value);
    host.innerHTML=state.lookupRows.map(row=>{
      const linked=positiveId(row.group_id);
      const linkedElsewhere=!!linked&&linked!==currentId;
      const alreadyPresent=state.members.some(member=>member.book_id===row.book_id);
      return `<article class="volume-admin-lookup">
      <img src="${escapeHtml(safeCover(row.image_url))}" alt="" width="54" height="78">
      <span><strong>${escapeHtml(row.title||`كىتاب ${row.book_id}`)}</strong><small class="volume-admin-lookup-author">${escapeHtml(row.author||"—")}</small><small>${row.price==null?"باھاسىز":`${escapeHtml(row.price)} ₺`} · ئامبار ${row.stock==null?"بېكىتىلمىگەن":escapeHtml(row.stock)}</small>${row.isbn?`<small>ISBN ${escapeHtml(row.isbn)}</small>`:""}<small class="volume-admin-lookup-id">ئىچكى نومۇر ${escapeHtml(row.book_id)}</small>${linked?`<small class="${linkedElsewhere?"is-linked-elsewhere":"is-linked-current"}">${linkedElsewhere?"باشقا يۈرۈشلۈككە باغلانغان":"مۇشۇ يۈرۈشلۈككە باغلانغان"}: ${escapeHtml(row.group_title||row.group_slug||`ID ${linked}`)}</small>`:""}${row.href?`<a href="${escapeHtml(row.href)}" target="_blank" rel="noopener">كىتابنى ئېچىش</a>`:""}</span>
      <button type="button" class="admin-secondary" data-lookup-add="${escapeHtml(row.book_id)}"${linkedElsewhere||alreadyPresent?" disabled":""}>${linkedElsewhere?"باغلاشقا بولمايدۇ":alreadyPresent?"قوشۇلغان":"قىسىم قىلىپ قوشۇش"}</button>
    </article>`;
    }).join("")+(state.lookupQuery&&state.lookupCatalogCount<state.lookupTotal?'<button type="button" class="admin-secondary volume-admin-lookup-more" data-lookup-more>كېيىنكى ماس كىتابلار</button>':"");
  }
  function showLookupFailure(error){
    const host=$("#volumeGroupLookupPreview");
    if(!host)return;
    host.setAttribute("aria-busy","false");
    host.innerHTML=`<p class="volume-admin-lookup-status" role="alert">${escapeHtml(error&&error.message||String(error||"كىتاب تېپىلمىدى."))}</p><button type="button" class="admin-secondary" data-lookup-retry>قايتا سىناش</button>`;
  }
  async function readAcceptedBookMetadata(bookId){
    const id=positiveId(bookId);
    if(!id||!state.db||typeof state.db.from!=="function")return null;
    const result=await state.db.from("books").select("id,category,source,description").eq("id",id).maybeSingle();
    if(!result||result.error||!result.data)return null;
    return result.data;
  }
  async function addLookupCandidate(bookId){
    const generation=lookupGeneration;
    const id=positiveId(bookId);
    const row=(state.lookupRows||[]).find(item=>item.book_id===id);
    if(!row||lookupSelecting.has(id)||generation!==lookupGeneration)return;
    lookupSelecting.add(id);
    const currentId=positiveId($("#volumeGroupId")?.value);
    try{
      let chosen=row;
      if(!row.previewed){
        const checked=normalizeLookup(await rpc("admin_preview_book_volume_members",{p_book_id:id,p_isbn:null}));
        if(generation!==lookupGeneration)return;
        const fresh=checked.find(item=>item.book_id===id);
        if(!fresh){setStatus("بۇ كىتاب تېپىلمىدى.","error");return}
        chosen={...fresh,previewed:true};
        const index=state.lookupRows.findIndex(item=>item.book_id===id);
        if(index>=0)state.lookupRows[index]=chosen;
      }
      if(generation!==lookupGeneration)return;
      const linked=positiveId(chosen.group_id);
      if(linked&&linked!==currentId){
        renderLookup(state.lookupRows);
        setStatus("بۇ كىتاب باشقا يۈرۈشلۈككە باغلانغان. ئالدى بىلەن شۇ يۈرۈشلۈكتىن چىقىرىڭ.","error");
        return;
      }
      if(state.members.some(member=>member.book_id===chosen.book_id)){
        renderLookup(state.lookupRows);
        setStatus("بۇ كىتاب ئاللىقاچان قىسىم تىزىملىكىدە.","error");
        return;
      }
      let shared=null;
      try{shared=await readAcceptedBookMetadata(chosen.book_id)}catch(readError){shared=null}
      if(generation!==lookupGeneration)return;
      applySharedMetadata(chosen,shared);
      if(generation!==lookupGeneration)return;
      const nextLabel=`${state.members.length+1}-قىسىم`;
      state.members=normalizeMembers([...state.members,{...chosen,volume_label:nextLabel}]);
      renderMembers();
      const host=$("#volumeGroupLookupPreview");
      if(host){host.innerHTML="";host.setAttribute("aria-busy","false")}
    }catch(error){
      if(generation!==lookupGeneration)return;
      setStatus(error.message||String(error),"error");
    }finally{
      lookupSelecting.delete(id);
    }
  }
  async function lookupMore(){
    const generation=lookupGeneration;
    const query=state.lookupQuery;
    if(!query||state.lookupCatalogCount>=state.lookupTotal)return;
    const button=$("#volumeGroupLookupPreview [data-lookup-more]");
    if(button)button.disabled=true;
    try{
      const found=await searchEligibleCatalog(query,state.lookupCatalogCount);
      if(generation!==lookupGeneration)return;
      const seen=new Set((state.lookupRows||[]).map(row=>row.book_id));
      const extras=mergeLookup([],found.rows).filter(row=>!seen.has(row.book_id));
      state.lookupCatalogCount+=found.rows.length;
      state.lookupTotal=found.total;
      renderLookup((state.lookupRows||[]).concat(extras));
    }catch(error){
      if(generation!==lookupGeneration)return;
      setStatus(error.message||String(error),"error");
      renderLookup(state.lookupRows||[]);
    }
  }
  async function lookupBook(){
    const query=text($("#volumeGroupBookLookup").value);
    if(!query)return;
    const generation=++lookupGeneration;
    const host=$("#volumeGroupLookupPreview");
    if(host){
      host.setAttribute("aria-busy","true");
      host.innerHTML='<p class="volume-admin-lookup-status" role="status">كىتاب تەكشۈرۈلۈۋاتىدۇ…</p>';
    }
    setStatus("كىتاب تەكشۈرۈلۈۋاتىدۇ…","");
    try{
      const exactId=/^[1-9][0-9]*$/.test(query);
      const isbnQuery=exactId?"":isbnLookupQuery(query);
      let previewRows=[];
      if(exactId||isbnQuery){
        previewRows=normalizeLookup(await rpc("admin_preview_book_volume_members",{
          p_book_id:exactId?query:null,
          p_isbn:exactId?query:isbnQuery
        }));
        if(generation!==lookupGeneration)return;
      }
      let catalogRows=[];
      if(exactId){
        state.lookupQuery="";
        state.lookupCatalogCount=0;
        state.lookupTotal=0;
      }else{
        const found=await searchEligibleCatalog(query,0);
        if(generation!==lookupGeneration)return;
        catalogRows=found.rows;
        state.lookupQuery=query;
        state.lookupCatalogCount=found.rows.length;
        state.lookupTotal=found.total;
      }
      const rows=mergeLookup(previewRows,catalogRows);
      renderLookup(rows);
      setStatus(rows.length?"كىتاب نامى ۋە باھاسىنى تەكشۈرۈپ، قىسىم قىلىپ قوشۇڭ.":exactId?"بۇ نومۇردا كىتاب تېپىلمىدى.":"بۇ نام ياكى ئاپتور بويىچە كىتاب تېپىلمىدى.",rows.length?"ok":"warn");
    }catch(error){
      if(generation!==lookupGeneration)return;
      showLookupFailure(error);
      setStatus(error.message||String(error),"error");
    }
  }
  async function load(force,generation){
    if(state.loading||state.loaded&&!force)return;
    const watch=generation==null?editorGeneration:generation;
    state.loading=true;
    if(watch===editorGeneration)setStatus("يۈرۈشلۈكلەر يۈكلىنىۋاتىدۇ…","");
    try{
      state.groups=groupRows(await rpc("admin_list_book_volume_groups"));
      state.loaded=true;
      renderList();
      if(watch===editorGeneration)setStatus("قىسىملىق كىتابلارنى باشقۇرالايسىز.","ok");
    }catch(error){
      if(watch===editorGeneration)setStatus(error.message||String(error),"error");
    }
    finally{state.loading=false}
  }
  const seriesState={requestId:"",saving:false};
  let seriesPartSeq=0;
  function seriesInteriorCap(){
    // books.gallery_images and KutadguGallery both stop at 4. The form follows
    // that stored cap and does not offer a fifth image. Raising it needs SQL.
    const stored=Number(root.KutadguGallery&&root.KutadguGallery.MAX_GALLERY_IMAGES);
    const persisted=Number.isFinite(stored)&&stored>0?stored:4;
    return Math.min(5,persisted);
  }
  function seriesUserError(error){
    const raw=text(error&&typeof error==="object"?error.message:error);
    const code=text(error&&typeof error==="object"?error.code:"");
    const blob=`${code} ${raw}`.trim();
    let message="يۈرۈشلۈك ساقلانمىدى. قايتا سىناڭ.";
    if(/AAL2|42501/.test(blob))message="2-باسقۇچلۇق دەلىللەش كېرەك.";
    else if(/invalid_volume_count/.test(blob))message="قىسىم سانى 2 دىن 100 گىچە بولسۇن.";
    else if(/invalid_series_isbn/.test(blob))message="كىتابنىڭ خەلقئارا نومۇرى توغرا ئەمەس.";
    else if(/invalid_series_cover|series_cover_already_used/.test(blob))message="مۇقاۋا قوبۇل قىلىنمىدى.";
    else if(/invalid_complete_set_price|explicit_price_replaced/.test(blob))message="يۈرۈشلۈك باھاسى ساقلانمىدى.";
    else if(/gallery_images|interior_/.test(blob))message="ئىچ بەت رەسىمى ساقلانمىدى.";
    else if(/invalid_series_part|invalid_series_payload|invalid_series_shared_fields|invalid_series_source|invalid_representative_volume|series_not_private/.test(blob))message="قىسىم ئۇچۇرى تولۇق ئەمەس.";
    return {message,diagnostic:blob.slice(0,500)};
  }
  function safeFileLabel(name){
    const clean=String(name||"").replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,"").replace(/[<>"']/g,"").trim();
    return clean.slice(0,80)||"رەسىم";
  }
  function newRequestId(){
    if(root.crypto&&typeof root.crypto.randomUUID==="function")return root.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,ch=>{
      const n=Math.floor(Math.random()*16);
      return (ch==="x"?n:(n&0x3|0x8)).toString(16);
    });
  }
  function seriesStatus(message,kind,diagnostic){
    const el=$("#volumeSeriesStatus");
    if(!el)return;
    el.textContent=message||"";
    el.className=`admin-status${kind?` ${kind}`:""}`;
    if(diagnostic)el.dataset.diagnostic=String(diagnostic).slice(0,500);
    else delete el.dataset.diagnostic;
  }
  function syncSeriesCategory(){
    const input=$("#volumeSeriesCategory");
    if(!input)return;
    const category=text(input.value);
    const entry=categoryEntries().find(item=>text(item.label)===category);
    if($("#volumeSeriesSource"))$("#volumeSeriesSource").value=entry?entry.source:"";
    input.setCustomValidity(category&&!entry?"كىتاب تۈرىنى تىزىمدىن تاللاڭ.":"");
  }
  const SERIES_COVER_TYPES={hardcover:true,paperback:true,other:true};
  const SERIES_BOOK_SIZES={A4:true,A5:true,B5:true,other:true};
  const SERIES_STOCK_STATUSES={in_stock:true,low_stock:true,out_of_stock:true};
  function seriesCreditNames(value){
    if(value==null||value==="")return [];
    if(!Array.isArray(value))return null;
    const names=[];
    for(let index=0;index<value.length;index+=1){
      const item=value[index];
      const name=text(item&&typeof item==="object"?item.name:item);
      if(!name)continue;
      if(name.length>500||names.length>=8)return null;
      names.push(name);
    }
    return names;
  }
  function seriesOptionalWhole(value,min,max){
    const raw=text(value);
    if(!raw)return {ok:true,value:null};
    if(!/^\d+$/.test(raw))return {ok:false};
    const number=Number(raw);
    if(!Number.isInteger(number)||number<min||number>max)return {ok:false};
    return {ok:true,value:number};
  }
  function seriesOptionalChoice(value,allowed){
    const raw=text(value);
    if(!raw)return {ok:true,value:null};
    return allowed[raw]?{ok:true,value:raw}:{ok:false};
  }
  function seriesCreditValues(primarySelector,extrasSelector){
    const names=[];
    const primary=primarySelector?document.querySelector(primarySelector):null;
    if(primary&&text(primary.value))names.push(text(primary.value));
    const extras=extrasSelector?document.querySelector(extrasSelector):null;
    if(extras)extras.querySelectorAll("input").forEach(input=>{
      if(text(input.value))names.push(text(input.value));
    });
    return names;
  }
  function addSeriesCreditInput(extrasId){
    const extras=$(extrasId);
    if(!extras)return;
    const count=1+extras.querySelectorAll("input").length;
    if(count>=8)return;
    const row=document.createElement("div");
    row.className="book-credit-extra";
    const input=document.createElement("input");
    input.maxLength=500;
    input.dir="auto";
    const remove=document.createElement("button");
    remove.type="button";
    remove.className="admin-secondary";
    remove.textContent="ئۆچۈرۈش";
    remove.addEventListener("click",()=>row.remove());
    row.append(input,remove);
    extras.appendChild(row);
    const Suggest=root.KutadguBookEntrySuggest;
    const field=extrasId==="#volumeSeriesTranslatorExtras"?"translator":"author";
    if(Suggest&&Suggest.attachCombobox){
      Suggest.attachCombobox(input,()=>Suggest.uniqueValuesFromRows(typeof state.suggestionRows==="function"?state.suggestionRows():[],field));
    }
  }
  function seriesStructuredCreditPlan(authors,translators,publisher){
    if(!authors.length&&!translators.length)return {ok:true};
    const Credits=root.KutadguCredits;
    if(!Credits||typeof Credits.planCreditSave!=="function")return {ok:false,message:"ئاپتور ئۇچۇرى تەكشۈرۈلمىدى."};
    const plan=Credits.planCreditSave({
      authors:authors.length?authors:[],
      translators,
      publisher:publisher||""
    });
    if(!plan||plan.ok===false||plan.writeCredits!==true)return {ok:false,message:plan&&plan.message||"ئاپتور ئۇچۇرى توغرا ئەمەس."};
    return plan;
  }
  function seriesFail(message, section, field, partIndex){
    const result={ok:false,message};
    if(section)result.section=section;
    if(field)result.field=field;
    if(Number.isInteger(partIndex))result.partIndex=partIndex;
    return result;
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
    if(!title)return seriesFail("كىتاب نامىنى كىرگۈزۈڭ.","shared","title");
    if(!category||!source)return seriesFail("كىتاب تۈرىنى تىزىمدىن تاللاڭ.","shared","category");
    const rawPrice=value.completeSetPrice;
    const complete=rawPrice==null||rawPrice===""?null:Number(rawPrice);
    if(complete!=null&&(!Number.isFinite(complete)||complete<0))return seriesFail("يۈرۈشلۈك باھاسى توغرا ئەمەس.","shared","setPrice");
    const authors=seriesCreditNames(value.authors);
    if(authors==null)return seriesFail("ئاپتور نامى 500 ھەرپتىن ئاشمايدۇ.","shared","author");
    const translators=seriesCreditNames(value.translators);
    if(translators==null)return seriesFail("تەرجىمان نامى 500 ھەرپتىن ئاشمايدۇ.","shared","translator");
    const authorText=authors.length?authors.join("، "):text(value.author);
    if(authorText.length>500)return seriesFail("ئاپتور نامى 500 ھەرپتىن ئاشمايدۇ.","shared","author");
    const sharedPublisher=text(value.publisher);
    if(sharedPublisher.length>500)return seriesFail("نەشرىيات نامى 500 ھەرپتىن ئاشمايدۇ.","shared","publisher");
    const sharedTranslator=translators.length?translators.join("، "):text(value.translator);
    if(sharedTranslator.length>500)return seriesFail("تەرجىمان نامى 500 ھەرپتىن ئاشمايدۇ.","shared","translator");
    const sharedYear=seriesOptionalWhole(value.publishYear,1000,2100);
    if(!sharedYear.ok)return seriesFail("نەشر يىلى 1000 دىن 2100 گىچە بولسۇن.","shared","year");
    const sharedPages=seriesOptionalWhole(value.pages,1,100000);
    if(!sharedPages.ok)return seriesFail("بەت سانى 1 ياكى ئۇنىڭدىن چوڭ بولسۇن.","shared","pages");
    const sharedCover=seriesOptionalChoice(value.coverType,SERIES_COVER_TYPES);
    if(!sharedCover.ok)return seriesFail("مۇقاۋا تۈرىنى تىزىمدىن تاللاڭ.","shared","coverType");
    const sharedSize=seriesOptionalChoice(value.bookSize,SERIES_BOOK_SIZES);
    if(!sharedSize.ok)return seriesFail("كىتاب ئۆلچىمىنى تىزىمدىن تاللاڭ.","shared","bookSize");
    const sharedCredits=seriesStructuredCreditPlan(authors,translators,sharedPublisher);
    if(!sharedCredits.ok)return seriesFail(sharedCredits.message,"shared","author");
    const parts=Array.isArray(value.parts)?value.parts:[];
    if(parts.length<2||parts.length>100)return seriesFail("يۈرۈشلۈكتە 2 دىن 100 گىچە قىسىم بولۇشى كېرەك.");
    let representative=0;
    const built=[];
    for(let index=0;index<parts.length;index+=1){
      const part=parts[index]||{};
      const price=part.price==null||part.price===""?NaN:Number(part.price);
      const stock=part.stock==null||part.stock===""?NaN:Number(part.stock);
      const priceBad=!Number.isFinite(price)||price<0;
      const stockBad=!Number.isInteger(stock)||stock<0;
      if(priceBad||stockBad){
        return seriesFail(`${index+1}-قىسىمنىڭ باھاسى ۋە ئامبار سانىنى كىرگۈزۈڭ.`,"part",priceBad?"price":"stock",index);
      }
      const image=text(part.imageUrl||part.image_url);
      const prefix=`https://www.kutadgubilik.com/__r2/book-covers/series-new/${requestId}/part-${index+1}-`;
      const preview=value.allowPreviewUrls===true&&image.startsWith("https://");
      if(value.skipCoverCheck!==true&&(!image||(!preview&&!image.startsWith(prefix))))return seriesFail(`${index+1}-قىسىمنىڭ مۇقاۋىسى يوللانمىدى.`,"part","cover",index);
      const isbn=text(part.isbn).replace(/[^0-9Xx]/g,"");
      if(isbn&&isbn.length!==10&&isbn.length!==13)return seriesFail(`${index+1}-قىسىمنىڭ خەلقئارا نومۇرى 10 ياكى 13 خانە بولسۇن.`,"part","isbn",index);
      const partAuthors=seriesCreditNames(part.authors);
      if(partAuthors==null)return seriesFail(`${index+1}-قىسىمنىڭ ئاپتور نامى 500 ھەرپتىن ئاشمايدۇ.`,"part","",index);
      const partTranslators=seriesCreditNames(part.translators);
      if(partTranslators==null)return seriesFail(`${index+1}-قىسىمنىڭ تەرجىمان نامى 500 ھەرپتىن ئاشمايدۇ.`,"part","",index);
      const year=seriesOptionalWhole(part.publishYear!=null?part.publishYear:part.publish_year,1000,2100);
      if(!year.ok)return seriesFail(`${index+1}-قىسىمنىڭ نەشر يىلى 1000 دىن 2100 گىچە بولسۇن.`,"part","year",index);
      const pages=seriesOptionalWhole(part.pages,1,100000);
      if(!pages.ok)return seriesFail(`${index+1}-قىسىمنىڭ بەت سانى 1 ياكى ئۇنىڭدىن چوڭ بولسۇن.`,"part","pages",index);
      const publisher=text(part.publisher);
      if(publisher.length>500)return seriesFail(`${index+1}-قىسىمنىڭ نەشرىيات نامى 500 ھەرپتىن ئاشمايدۇ.`,"part","publisher",index);
      const cover=seriesOptionalChoice(part.coverType!=null?part.coverType:part.cover_type,SERIES_COVER_TYPES);
      if(!cover.ok)return seriesFail(`${index+1}-قىسىمنىڭ مۇقاۋا تۈرىنى تىزىمدىن تاللاڭ.`,"part","coverType",index);
      const size=seriesOptionalChoice(part.bookSize!=null?part.bookSize:part.book_size,SERIES_BOOK_SIZES);
      if(!size.ok)return seriesFail(`${index+1}-قىسىمنىڭ كىتاب ئۆلچىمىنى تىزىمدىن تاللاڭ.`,"part","bookSize",index);
      const stockStatus=seriesOptionalChoice(part.stockStatus!=null?part.stockStatus:part.stock_status,SERIES_STOCK_STATUSES);
      if(!stockStatus.ok)return seriesFail(`${index+1}-قىسىمنىڭ سېتىش ھالىتىنى تىزىمدىن تاللاڭ.`,"part","stockStatus",index);
      const partCredits=seriesStructuredCreditPlan(partAuthors,partTranslators,publisher);
      if(!partCredits.ok)return seriesFail(partCredits.message,"part","",index);
      if(part.main)representative=index+1;
      const row={
        title:text(part.title),
        price,
        stock,
        isbn,
        image_url:image,
        volume_label:text(part.volumeLabel)||`${index+1}-قىسىم`
      };
      if(partAuthors.length){
        row.authors=partAuthors;
        row.author=partAuthors.join("، ");
      }
      if(partTranslators.length){
        row.translators=partTranslators;
        row.translator=partTranslators.join("، ");
      }
      if(publisher)row.publisher=publisher;
      if(year.value!=null)row.publish_year=year.value;
      if(pages.value!=null)row.pages=pages.value;
      if(cover.value)row.cover_type=cover.value;
      if(size.value)row.book_size=size.value;
      if(stockStatus.value)row.stock_status=stockStatus.value;
      built.push(row);
    }
    const payload={
      title,
      author:authorText,
      category,
      source,
      description:text(value.description),
      complete_set_price:complete,
      representative_position:representative||1,
      parts:built
    };
    if(authors.length)payload.authors=authors;
    if(translators.length)payload.translators=translators;
    else if(sharedTranslator)payload.translator=sharedTranslator;
    if(sharedPublisher)payload.publisher=sharedPublisher;
    if(sharedYear.value!=null)payload.publish_year=sharedYear.value;
    if(sharedPages.value!=null)payload.pages=sharedPages.value;
    if(sharedCover.value)payload.cover_type=sharedCover.value;
    if(sharedSize.value)payload.book_size=sharedSize.value;
    return {ok:true,requestId,payload};
  }
  function seriesPartElement(){
    seriesPartSeq+=1;
    const n=seriesPartSeq;
    const cap=seriesInteriorCap();
    const article=document.createElement("article");
    article.className="volume-series-part";
    article.dataset.seriesAccordionSection="part";
    article.innerHTML=`<h3 class="volume-series-part-accordion">
      <button type="button" class="volume-series-accordion-toggle" data-series-accordion aria-expanded="false" aria-controls="volumeSeriesPartPanel${n}">
        <span data-series-part-number>قىسىم</span>
        <span class="volume-series-accordion-summary" data-series-part-summary></span>
        <span class="volume-series-badge" data-series-part-badge data-state="incomplete">تولۇق ئەمەس</span>
      </button>
    </h3>
    <div id="volumeSeriesPartPanel${n}" data-series-accordion-panel hidden>
    <div class="volume-series-part-head">
      <strong>قىسىم</strong>
      <button type="button" class="volume-series-remove" data-series-remove aria-describedby="volumeSeriesRemoveLimit">× بۇ قىسىمنى ئېلىۋېتىش</button>
    </div>
    <div class="volume-series-part-tools">
      <button type="button" data-series-move="-1" aria-label="ئۈستىگە">↑</button>
      <button type="button" data-series-move="1" aria-label="ئاستىغا">↓</button>
      <label class="volume-admin-representative"><input type="radio" name="volumeSeriesMain" data-series-main> باش مۇقاۋا</label>
    </div>
    <div class="volume-series-cover">
      <span class="volume-series-cover-label" id="volumeSeriesCoverLabel${n}">مۇقاۋا</span>
      <input id="volumeSeriesCover${n}" class="admin-gallery-file-input" type="file" accept="image/jpeg,image/png,image/webp" data-series-cover tabindex="-1" aria-labelledby="volumeSeriesCoverLabel${n}" aria-describedby="volumeSeriesCoverStatus${n}">
      <button type="button" class="admin-secondary" data-series-cover-btn aria-controls="volumeSeriesCover${n}">مۇقاۋا تاللاش</button>
      <span class="volume-series-cover-status" id="volumeSeriesCoverStatus${n}" data-series-cover-status role="status">تاللانمىدى</span>
    </div>
    <div class="volume-series-metrics">
      <label>باھاسى<input type="number" min="0" step="0.01" inputmode="decimal" dir="ltr" data-series-price></label>
      <label>ئامبار سانى<input type="number" min="0" step="1" inputmode="numeric" dir="ltr" data-series-stock></label>
    </div>
    <label>قىسىم نامى<input type="text" maxlength="500" data-series-title placeholder="بوش قالسا نومۇر قوشۇلىدۇ"></label>
    <label>كىتابنىڭ خەلقئارا نومۇرى<input type="text" maxlength="32" dir="ltr" inputmode="text" data-series-isbn autocomplete="off"></label>
    <details class="volume-series-extra" data-series-extra>
      <summary>بۇ قىسىمنىڭ ئۆز ئۇچۇرى</summary>
      <label>بەت سانى<input type="number" min="1" step="1" inputmode="numeric" dir="ltr" data-series-page-total placeholder="ئورتاق قىممەت"></label>
      <label>نەشر يىلى<input type="number" min="1000" max="2100" step="1" inputmode="numeric" dir="ltr" data-series-year placeholder="ئورتاق قىممەت"></label>
      <label>نەشرىيات<input type="text" maxlength="500" data-series-publisher placeholder="ئورتاق قىممەت" autocomplete="off"></label>
      <label>مۇقاۋا تۈرى<select data-series-cover-type><option value="">ئورتاق قىممەت</option><option value="hardcover">قاتتىق مۇقاۋىلىق</option><option value="paperback">يۇمشاق مۇقاۋىلىق</option><option value="other">باشقا</option></select></label>
      <label>كىتاب ئۆلچىمى<select data-series-size><option value="">ئورتاق قىممەت</option><option value="A4">A4</option><option value="A5">A5</option><option value="B5">B5</option><option value="other">باشقا</option></select></label>
      <label>سېتىش ھالىتى<select data-series-stock-status><option value="">ئاپتوماتىك</option><option value="in_stock">ئامباردا بار</option><option value="low_stock">ئاز قالدى</option><option value="out_of_stock">تۈگەپ كەتتى</option></select></label>
    </details>
    <div class="volume-series-pages">
        <div class="volume-series-pages-head">
          <span id="volumeSeriesPagesLabel${n}">ئىچ بەت رەسىملىرى</span>
          <span data-series-page-count>0 / ${cap}</span>
        </div>
        <input id="volumeSeriesPages${n}" class="admin-gallery-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple data-series-pages-input tabindex="-1" aria-labelledby="volumeSeriesPagesLabel${n}" aria-describedby="volumeSeriesPagesStatus${n}">
        <button type="button" class="admin-secondary" data-series-pages-btn aria-controls="volumeSeriesPages${n}">رەسىم تاللاش</button>
        <span class="volume-series-pages-status" id="volumeSeriesPagesStatus${n}" data-series-pages-status role="status">تاللانمىدى</span>
        <div class="volume-series-pages-list" data-series-pages-list></div>
    </div>
    </div>`;
    return article;
  }
  function releaseSeriesPage(node){
    if(!node||!node._preview)return;
    try{URL.revokeObjectURL(node._preview)}catch(error){}
    node._preview="";
  }
  function refreshSeriesPages(row){
    if(!row)return;
    const pages=[...row.querySelectorAll(".volume-series-page")];
    const cap=seriesInteriorCap();
    pages.forEach((page,index)=>{
      const up=page.querySelector('[data-page-move="-1"]');
      const down=page.querySelector('[data-page-move="1"]');
      if(up)up.disabled=index===0;
      if(down)down.disabled=index===pages.length-1;
    });
    const count=row.querySelector("[data-series-page-count]");
    if(count)count.textContent=`${pages.length} / ${cap}`;
    const status=row.querySelector("[data-series-pages-status]");
    if(status)status.textContent=pages.length?`${pages.length} رەسىم تاللاندى`:"تاللانمىدى";
    const btn=row.querySelector("[data-series-pages-btn]");
    if(btn)btn.disabled=pages.length>=cap;
  }
  function seriesPageElement(file){
    const article=document.createElement("article");
    article.className="volume-series-page";
    article._file=file;
    article._url="";
    article._preview=URL.createObjectURL(file);
    const img=document.createElement("img");
    img.src=article._preview;
    img.alt="ئىچ بەت رەسىمى";
    const name=document.createElement("span");
    name.className="volume-series-page-name";
    name.textContent=safeFileLabel(file.name);
    const tools=document.createElement("div");
    tools.className="volume-series-page-tools";
    const up=document.createElement("button");
    up.type="button";
    up.dataset.pageMove="-1";
    up.setAttribute("aria-label","ئۈستىگە");
    up.textContent="↑";
    const down=document.createElement("button");
    down.type="button";
    down.dataset.pageMove="1";
    down.setAttribute("aria-label","ئاستىغا");
    down.textContent="↓";
    const remove=document.createElement("button");
    remove.type="button";
    remove.dataset.pageRemove="1";
    remove.setAttribute("aria-label","چىقىرىش");
    remove.textContent="چىقىرىش";
    tools.append(up,down,remove);
    article.append(img,name,tools);
    up.addEventListener("click",()=>moveSeriesPage(article,-1));
    down.addEventListener("click",()=>moveSeriesPage(article,1));
    remove.addEventListener("click",()=>removeSeriesPage(article));
    return article;
  }
  function moveSeriesPage(node,delta){
    const host=node&&node.parentElement;
    if(!host)return;
    const rows=[...host.children];
    const index=rows.indexOf(node);
    const target=index+delta;
    if(index<0||target<0||target>=rows.length)return;
    if(delta<0)host.insertBefore(node,rows[target]);
    else host.insertBefore(rows[target],node);
    refreshSeriesPages(node.closest(".volume-series-part"));
  }
  function removeSeriesPage(node){
    const row=node&&node.closest(".volume-series-part");
    releaseSeriesPage(node);
    if(node)node.remove();
    refreshSeriesPages(row);
  }
  function seriesPageRejection(file){
    const lib=root.KutadguGallery||{};
    const maxBytes=Number(lib.MAX_GALLERY_BYTES)||8*1024*1024;
    if(Number(file&&file.size)>maxBytes)return "بۇ رەسىم بەك چوڭ.";
    const mime=String(file&&file.type||"").toLowerCase();
    const allowed=typeof lib.isAllowedGalleryMime==="function"
      ?lib.isAllowedGalleryMime(mime)
      :["image/jpeg","image/png","image/webp","image/gif"].indexOf(mime)>=0;
    return allowed?"":"بۇ ھۆججەت رەسىم ئەمەس.";
  }
  function addSeriesPages(row,fileList){
    const host=row&&row.querySelector("[data-series-pages-list]");
    if(!host)return;
    const incoming=[...(fileList||[])];
    const cap=seriesInteriorCap();
    const room=Math.max(0,cap-host.children.length);
    const plan=root.KutadguGallery&&typeof root.KutadguGallery.planGallerySelection==="function"
      ?root.KutadguGallery.planGallerySelection(host.children.length,incoming.length,cap)
      :{ok:incoming.length<=room,take:Math.min(incoming.length,room)};
    if(!plan.take){
      seriesStatus(`ئىچ بەت رەسىمى ${cap} پارچىدىن ئاشمايدۇ.`,"error");
      refreshSeriesPages(row);
      return;
    }
    let rejected="";
    incoming.slice(0,plan.take).forEach(file=>{
      const why=seriesPageRejection(file);
      if(why){rejected=why;return}
      host.appendChild(seriesPageElement(file));
    });
    if(!plan.ok||rejected)seriesStatus(rejected||`ئىچ بەت رەسىمى ${cap} پارچىدىن ئاشمايدۇ.`,"error");
    refreshSeriesPages(row);
  }
  function bindSeriesCover(row){
    const input=row.querySelector("[data-series-cover]");
    const btn=row.querySelector("[data-series-cover-btn]");
    const status=row.querySelector("[data-series-cover-status]");
    if(btn&&input)btn.addEventListener("click",()=>input.click());
    if(!input)return;
    input.addEventListener("change",()=>{
      const file=input.files&&input.files[0];
      if(!file)return;
      row._coverFile=file;
      if(status)status.textContent=`تاللاندى: ${safeFileLabel(file.name)}`;
    });
  }
  function bindSeriesPages(row){
    const input=row.querySelector("[data-series-pages-input]");
    const btn=row.querySelector("[data-series-pages-btn]");
    if(btn&&input)btn.addEventListener("click",()=>input.click());
    if(!input)return;
    input.addEventListener("change",()=>{
      const files=[...(input.files||[])];
      input.value="";
      if(!files.length)return;
      addSeriesPages(row,files);
    });
  }
  function seriesSections(){
    return [...document.querySelectorAll("#volumeSeriesForm [data-series-accordion-section]")];
  }
  function setSeriesSectionOpen(section, open){
    if(!section)return;
    const toggle=section.querySelector("[data-series-accordion]");
    const panel=section.querySelector("[data-series-accordion-panel]");
    if(toggle)toggle.setAttribute("aria-expanded",open?"true":"false");
    if(panel)panel.hidden=!open;
  }
  function openSeriesSection(section){
    if(!section)return;
    seriesSections().forEach(item=>setSeriesSectionOpen(item,item===section));
  }
  function toggleSeriesSection(section){
    const toggle=section&&section.querySelector("[data-series-accordion]");
    if(!toggle)return;
    if(toggle.getAttribute("aria-expanded")==="true")setSeriesSectionOpen(section,false);
    else openSeriesSection(section);
  }
  function seriesRequestProbe(){
    const id=text($("#volumeSeriesRequestId")&&$("#volumeSeriesRequestId").value).toLowerCase();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)?id:"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  }
  function seriesProbeCover(position){
    return `https://www.kutadgubilik.com/__r2/book-covers/series-new/${seriesRequestProbe()}/part-${position}-probe.webp`;
  }
  function seriesSharedFieldValues(){
    syncSeriesCategory();
    return {
      requestId:seriesRequestProbe(),
      title:$("#volumeSeriesTitle")&&$("#volumeSeriesTitle").value,
      author:$("#volumeSeriesAuthor")&&$("#volumeSeriesAuthor").value,
      authors:seriesCreditValues("#volumeSeriesAuthor","#volumeSeriesAuthorExtras"),
      translator:$("#volumeSeriesTranslator")&&$("#volumeSeriesTranslator").value,
      translators:seriesCreditValues("#volumeSeriesTranslator","#volumeSeriesTranslatorExtras"),
      publisher:$("#volumeSeriesPublisher")&&$("#volumeSeriesPublisher").value,
      publishYear:$("#volumeSeriesYear")&&$("#volumeSeriesYear").value,
      pages:$("#volumeSeriesPages")&&$("#volumeSeriesPages").value,
      coverType:$("#volumeSeriesCoverType")&&$("#volumeSeriesCoverType").value,
      bookSize:$("#volumeSeriesSize")&&$("#volumeSeriesSize").value,
      category:$("#volumeSeriesCategory")&&$("#volumeSeriesCategory").value,
      source:$("#volumeSeriesSource")&&$("#volumeSeriesSource").value,
      description:$("#volumeSeriesDescription")&&$("#volumeSeriesDescription").value,
      completeSetPrice:$("#volumeSeriesSetPrice")&&$("#volumeSeriesSetPrice").value
    };
  }
  function seriesValidProbePart(position){
    return {title:"",price:0,stock:0,isbn:"",imageUrl:seriesProbeCover(position)};
  }
  function seriesRowProbePart(row){
    const input=row.querySelector("[data-series-cover]");
    const file=row._coverFile||input&&input.files&&input.files[0]||null;
    const stored=text(row.dataset.imageUrl);
    return {
      title:row.querySelector("[data-series-title]").value,
      price:row.querySelector("[data-series-price]").value,
      stock:row.querySelector("[data-series-stock]").value,
      isbn:row.querySelector("[data-series-isbn]").value,
      pages:row.querySelector("[data-series-page-total]").value,
      publishYear:row.querySelector("[data-series-year]").value,
      publisher:row.querySelector("[data-series-publisher]").value,
      coverType:row.querySelector("[data-series-cover-type]").value,
      bookSize:row.querySelector("[data-series-size]").value,
      stockStatus:row.querySelector("[data-series-stock-status]").value,
      imageUrl:stored||(file?seriesProbeCover(1):"")
    };
  }
  function seriesBadge(node, complete){
    if(!node)return;
    node.textContent=complete?"تولدۇرۇلدى":"تولۇق ئەمەس";
    node.dataset.state=complete?"complete":"incomplete";
  }
  function seriesSharedComplete(){
    const result=seriesEntryPayload({
      ...seriesSharedFieldValues(),
      skipCoverCheck:true,
      parts:[seriesValidProbePart(1),seriesValidProbePart(2)]
    });
    return result.ok===true||result.section==="part";
  }
  function seriesPartComplete(row){
    const input=row.querySelector("[data-series-cover]");
    const file=row._coverFile||input&&input.files&&input.files[0]||null;
    const hasCover=!!(file||text(row.dataset.imageUrl));
    const result=seriesEntryPayload({
      requestId:seriesRequestProbe(),
      title:"نام",
      category:"تۈر",
      source:"probe.html",
      completeSetPrice:"",
      skipCoverCheck:hasCover,
      parts:[seriesRowProbePart(row),seriesValidProbePart(2)]
    });
    if(result.ok===true)return true;
    return !(result.section==="part"&&result.partIndex===0);
  }
  function refreshSeriesSummaries(){
    const sharedTitle=$("[data-series-shared-title]");
    if(sharedTitle)sharedTitle.textContent=text($("#volumeSeriesTitle")&&$("#volumeSeriesTitle").value);
    seriesBadge($("[data-series-shared-badge]"),seriesSharedComplete());
    [...($("#volumeSeriesParts")?.children||[])].forEach(row=>{
      const summary=row.querySelector("[data-series-part-summary]");
      const title=row.querySelector("[data-series-title]");
      if(summary)summary.textContent=text(title&&title.value);
      seriesBadge(row.querySelector("[data-series-part-badge]"),seriesPartComplete(row));
    });
  }
  function focusSeriesProblem(section, field, row){
    if(!field)return;
    const shared={
      title:"#volumeSeriesTitle",
      category:"#volumeSeriesCategory",
      setPrice:"#volumeSeriesSetPrice",
      author:"#volumeSeriesAuthor",
      translator:"#volumeSeriesTranslator",
      publisher:"#volumeSeriesPublisher",
      year:"#volumeSeriesYear",
      pages:"#volumeSeriesPages",
      coverType:"#volumeSeriesCoverType",
      bookSize:"#volumeSeriesSize"
    };
    const part={
      price:"[data-series-price]",
      stock:"[data-series-stock]",
      cover:"[data-series-cover-btn]",
      isbn:"[data-series-isbn]",
      year:"[data-series-year]",
      pages:"[data-series-page-total]",
      publisher:"[data-series-publisher]",
      coverType:"[data-series-cover-type]",
      bookSize:"[data-series-size]",
      stockStatus:"[data-series-stock-status]"
    };
    const sel=section==="part"?part[field]:shared[field];
    if(!sel)return;
    const el=section==="part"&&row?row.querySelector(sel):$(sel);
    if(!el||typeof el.focus!=="function")return;
    const details=el.closest("details");
    if(details)details.open=true;
    el.focus();
  }
  function revealSeriesValidation(result, rows){
    if(!result||!result.section)return;
    if(result.section==="shared"){
      openSeriesSection(document.querySelector("#volumeSeriesForm [data-series-accordion-section='shared']"));
      focusSeriesProblem("shared",result.field);
      return;
    }
    if(result.section!=="part"||!Number.isInteger(result.partIndex))return;
    const row=rows&&rows[result.partIndex]&&rows[result.partIndex].row||($("#volumeSeriesParts")&&$("#volumeSeriesParts").children[result.partIndex]);
    if(!row)return;
    openSeriesSection(row);
    focusSeriesProblem("part",result.field,row);
  }
  function refreshSeriesParts(){
    const rows=[...($("#volumeSeriesParts")?.children||[])];
    rows.forEach((row,index)=>{
      const label=row.querySelector("strong");
      if(label)label.textContent=`${index+1}-قىسىم`;
      const number=row.querySelector("[data-series-part-number]");
      if(number)number.textContent=`${index+1}-قىسىم`;
      const up=row.querySelector('[data-series-move="-1"]');
      const down=row.querySelector('[data-series-move="1"]');
      const remove=row.querySelector("[data-series-remove]");
      if(up)up.disabled=index===0;
      if(down)down.disabled=index===rows.length-1;
      if(remove){
        remove.disabled=rows.length<=2;
        remove.setAttribute("aria-label",`${index+1}-قىسىمنى ئېلىۋېتىش`);
      }
      refreshSeriesPages(row);
    });
    const count=$("#volumeSeriesPartCount");
    if(count)count.textContent=`${rows.length} / 100`;
    const add=$("#volumeSeriesAddPart");
    if(add)add.disabled=rows.length>=100;
    refreshSeriesSummaries();
  }
  function bindSeriesPart(row){
    row.querySelector('[data-series-move="-1"]').onclick=()=>moveSeriesPart(row,-1);
    row.querySelector('[data-series-move="1"]').onclick=()=>moveSeriesPart(row,1);
    row.querySelector("[data-series-remove]").onclick=()=>removeSeriesPart(row);
    bindSeriesCover(row);
    bindSeriesPages(row);
  }
  function addSeriesPart(activate){
    const host=$("#volumeSeriesParts");
    if(!host||host.children.length>=100){
      seriesStatus("100 قىسىم بولدى.","error");
      return;
    }
    const row=seriesPartElement();
    host.appendChild(row);
    bindSeriesPart(row);
    if(!host.querySelector("[data-series-main]:checked"))row.querySelector("[data-series-main]").checked=true;
    refreshSeriesParts();
    if(activate!==false){
      openSeriesSection(row);
      const toggle=row.querySelector("[data-series-accordion]");
      if(toggle&&typeof toggle.focus==="function")toggle.focus();
    }
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
    row.querySelectorAll(".volume-series-page").forEach(releaseSeriesPage);
    row.remove();
    if(wasMain){
      const first=host.querySelector("[data-series-main]");
      if(first)first.checked=true;
    }
    refreshSeriesParts();
  }
  function readSeriesDom(){
    return [...($("#volumeSeriesParts")?.children||[])].map(row=>{
      const input=row.querySelector("[data-series-cover]");
      return {
        row,
        title:row.querySelector("[data-series-title]").value,
        price:row.querySelector("[data-series-price]").value,
        stock:row.querySelector("[data-series-stock]").value,
        isbn:row.querySelector("[data-series-isbn]").value,
        pageCount:row.querySelector("[data-series-page-total]").value,
        publishYear:row.querySelector("[data-series-year]").value,
        publisher:row.querySelector("[data-series-publisher]").value,
        coverType:row.querySelector("[data-series-cover-type]").value,
        bookSize:row.querySelector("[data-series-size]").value,
        stockStatus:row.querySelector("[data-series-stock-status]").value,
        file:row._coverFile||input&&input.files&&input.files[0]||null,
        imageUrl:row.dataset.imageUrl||"",
        objectKey:row.dataset.objectKey||"",
        main:row.querySelector("[data-series-main]").checked,
        pages:[...row.querySelectorAll(".volume-series-page")].map(node=>({
          node,
          file:node._file||null,
          url:node._url||""
        }))
      };
    });
  }
  function resetSeriesForm(){
    seriesState.requestId=newRequestId();
    $("#volumeSeriesRequestId").value=seriesState.requestId;
    $("#volumeSeriesTitle").value="";
    $("#volumeSeriesAuthor").value="";
    if($("#volumeSeriesAuthorExtras"))$("#volumeSeriesAuthorExtras").replaceChildren();
    if($("#volumeSeriesTranslator"))$("#volumeSeriesTranslator").value="";
    if($("#volumeSeriesTranslatorExtras"))$("#volumeSeriesTranslatorExtras").replaceChildren();
    if($("#volumeSeriesPublisher"))$("#volumeSeriesPublisher").value="";
    if($("#volumeSeriesYear"))$("#volumeSeriesYear").value="";
    if($("#volumeSeriesPages"))$("#volumeSeriesPages").value="";
    if($("#volumeSeriesCoverType"))$("#volumeSeriesCoverType").value="";
    if($("#volumeSeriesSize"))$("#volumeSeriesSize").value="";
    $("#volumeSeriesCategory").value="";
    $("#volumeSeriesCategory").setCustomValidity("");
    $("#volumeSeriesSource").value="";
    $("#volumeSeriesSetPrice").value="";
    $("#volumeSeriesDescription").value="";
    const host=$("#volumeSeriesParts");
    if(host){
      host.querySelectorAll(".volume-series-page").forEach(releaseSeriesPage);
      host.replaceChildren();
    }
    addSeriesPart(false);
    addSeriesPart(false);
    openSeriesSection(document.querySelector("#volumeSeriesForm [data-series-accordion-section='shared']"));
    seriesStatus("ساقلاش خېرىدارغا چىقارمايدۇ.","");
  }
  function showSeriesForm(){
    if($("#volumeSeriesForm")?.hidden)editorGeneration++;
    resetLookup();
    if($("#volumeSeriesForm"))$("#volumeSeriesForm").hidden=false;
    if($("#volumeGroupForm"))$("#volumeGroupForm").hidden=true;
    if(!text($("#volumeSeriesRequestId")?.value))resetSeriesForm();
  }
  function showLinkForm(){
    if($("#volumeGroupForm")?.hidden)editorGeneration++;
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
  function snapshotSeriesInteriors(rows){
    return (Array.isArray(rows)?rows:[]).map(row=>({
      imageUrl:text(row&&row.imageUrl),
      pages:(Array.isArray(row&&row.pages)?row.pages:[]).map(page=>({
        file:page&&page.file||null,
        url:text(page&&page.url),
        node:page&&page.node||null
      }))
    })).filter(part=>part.imageUrl&&part.pages.some(page=>page.file||page.url));
  }
  function seriesMemberByCover(members, imageUrl){
    const identity=text(imageUrl);
    if(!identity)return null;
    const matches=(Array.isArray(members)?members:[]).filter(item=>text(item&&item.image_url)===identity);
    return matches.length===1?matches[0]:null;
  }
  async function persistSeriesInteriors(parts, saved){
    const members=Array.isArray(saved&&saved.members)?saved.members:[];
    const upload=root.kutadguUploadBookGallery;
    const persist=root.kutadguPersistBookGallery;
    for(const part of Array.isArray(parts)?parts:[]){
      const pages=Array.isArray(part.pages)?part.pages:[];
      if(!pages.length)continue;
      const imageUrl=text(part.imageUrl);
      if(!imageUrl)continue;
      const member=seriesMemberByCover(members, imageUrl);
      const bookId=member&&(member.book_id||member.id);
      if(!bookId)throw new Error("interior_part_unmatched");
      if(typeof upload!=="function"||typeof persist!=="function")throw new Error("interior_upload_unavailable");
      const urls=[];
      for(const page of pages){
        let url=text(page.url);
        if(!url&&page.file){
          const position=Number(member.position);
          seriesStatus(Number.isInteger(position)&&position>0?`${position}-قىسىمنىڭ ئىچ بەت رەسىمى يوللىنىۋاتىدۇ…`:"ئىچ بەت رەسىمى يوللىنىۋاتىدۇ…","");
          url=text(await upload(bookId,page.file));
          page.url=url;
          if(page.node)page.node._url=url;
        }
        if(url)urls.push(url);
      }
      if(urls.length)await persist(bookId,urls,imageUrl);
    }
  }
  async function saveInteriorsOrStop(rows, saved){
    try{
      await persistSeriesInteriors(rows, saved);
      return true;
    }catch(galleryError){
      const shown=seriesUserError(galleryError);
      seriesStatus("ئىچ بەت رەسىمى ساقلانمىدى. قايتا ساقلىسىڭىز، يۈرۈشلۈك قايتا قوشۇلمايدۇ.","error",shown.diagnostic);
      return false;
    }
  }
  function showCreditRecovery(message){
    if($("#volumeSeriesForm"))$("#volumeSeriesForm").hidden=false;
    if($("#volumeGroupForm"))$("#volumeGroupForm").hidden=true;
    seriesStatus(message,"error");
    setStatus(message,"error");
  }
  async function persistSeriesCredits(saved,payload){
    const Credits=root.KutadguCredits;
    if(!saved||!payload)return;
    const members=Array.isArray(saved.members)?saved.members:[];
    const parts=Array.isArray(payload.parts)?payload.parts:[];
    for(let index=0;index<members.length;index+=1){
      const part=parts[index]||{};
      const bookId=Number(members[index]&&(members[index].book_id||members[index].id));
      if(!Number.isInteger(bookId)||bookId<1)continue;
      const authors=Array.isArray(part.authors)&&part.authors.length?part.authors:(Array.isArray(payload.authors)&&payload.authors.length?payload.authors:(payload.author?[payload.author]:[]));
      const translators=Array.isArray(part.translators)&&part.translators.length?part.translators:(Array.isArray(payload.translators)?payload.translators:[]);
      if(!authors.length&&!translators.length)continue;
      const plan=seriesStructuredCreditPlan(authors,translators,part.publisher||payload.publisher||"");
      if(!plan.ok){
        const error=new Error(plan.message||"ئاپتور ئۇلانمىسى ساقلانمىدى.");
        error.creditPlan=true;
        throw error;
      }
      if(!Credits||typeof Credits.planCreditSave!=="function"){
        const error=new Error("ئاپتور ئۇچۇرى تەكشۈرۈلمىدى.");
        error.creditPlan=true;
        throw error;
      }
      await rpc("set_book_credits",{
        p_book_id:bookId,
        p_authors:plan.authors,
        p_translators:plan.translators,
        p_publisher:plan.publisher
      });
    }
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
    const upload=root.kutadguUploadSeriesPartCover;
    if(!pending&&typeof upload!=="function"){seriesStatus("مۇقاۋا يوللاش تەييار ئەمەس.","error");return}
    const interiorSource=pending&&Array.isArray(pending.interiors)?pending.interiors:rows;
    const needsInterior=interiorSource.some(row=>(row.pages||[]).some(page=>page.file||page.url));
    if(needsInterior&&(typeof root.kutadguUploadBookGallery!=="function"||typeof root.kutadguPersistBookGallery!=="function")){
      seriesStatus("ئىچ بەت رەسىمى يوللاش تەييار ئەمەس.","error");
      return;
    }
    seriesState.saving=true;
    const created=[];
    try{
      let built;
      if(pending){
        built={ok:true,requestId:pending.requestId,payload:pending.payload};
      }else{
        const metadata=seriesEntryPayload({
          requestId,
          title:$("#volumeSeriesTitle").value,
          author:$("#volumeSeriesAuthor").value,
          authors:seriesCreditValues("#volumeSeriesAuthor","#volumeSeriesAuthorExtras"),
          translator:$("#volumeSeriesTranslator")&&$("#volumeSeriesTranslator").value,
          translators:seriesCreditValues("#volumeSeriesTranslator","#volumeSeriesTranslatorExtras"),
          publisher:$("#volumeSeriesPublisher")&&$("#volumeSeriesPublisher").value,
          publishYear:$("#volumeSeriesYear")&&$("#volumeSeriesYear").value,
          pages:$("#volumeSeriesPages")&&$("#volumeSeriesPages").value,
          coverType:$("#volumeSeriesCoverType")&&$("#volumeSeriesCoverType").value,
          bookSize:$("#volumeSeriesSize")&&$("#volumeSeriesSize").value,
          category:$("#volumeSeriesCategory").value,
          source:$("#volumeSeriesSource").value,
          description:$("#volumeSeriesDescription").value,
          completeSetPrice:$("#volumeSeriesSetPrice").value,
          skipCoverCheck:true,
          parts:rows.map(row=>({
            title:row.title,price:row.price,stock:row.stock,isbn:row.isbn,imageUrl:row.imageUrl||"pending",
            pages:row.pageCount,publishYear:row.publishYear,publisher:row.publisher,coverType:row.coverType,
            bookSize:row.bookSize,stockStatus:row.stockStatus,main:row.main
          }))
        });
        if(!metadata.ok){
          seriesStatus(metadata.message,"error");
          setStatus(metadata.message,"error");
          revealSeriesValidation(metadata,rows);
          return;
        }
        if(rows.some(row=>!row.file&&!row.imageUrl)){
          const index=rows.findIndex(row=>!row.file&&!row.imageUrl);
          seriesStatus("ھەر بىر قىسىمغا ئۆزىنىڭ مۇقاۋىسىنى تاللاڭ.","error");
          revealSeriesValidation({section:"part",partIndex:index,field:"cover"},rows);
          return;
        }
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
          authors:seriesCreditValues("#volumeSeriesAuthor","#volumeSeriesAuthorExtras"),
          translator:$("#volumeSeriesTranslator")&&$("#volumeSeriesTranslator").value,
          translators:seriesCreditValues("#volumeSeriesTranslator","#volumeSeriesTranslatorExtras"),
          publisher:$("#volumeSeriesPublisher")&&$("#volumeSeriesPublisher").value,
          publishYear:$("#volumeSeriesYear")&&$("#volumeSeriesYear").value,
          pages:$("#volumeSeriesPages")&&$("#volumeSeriesPages").value,
          coverType:$("#volumeSeriesCoverType")&&$("#volumeSeriesCoverType").value,
          bookSize:$("#volumeSeriesSize")&&$("#volumeSeriesSize").value,
          category:$("#volumeSeriesCategory").value,
          source:$("#volumeSeriesSource").value,
          description:$("#volumeSeriesDescription").value,
          completeSetPrice:$("#volumeSeriesSetPrice").value,
          allowPreviewUrls:root.__kutadguSkipAdminAuth===true,
          parts:rows.map(row=>({
            title:row.title,price:row.price,stock:row.stock,isbn:row.isbn,imageUrl:row.imageUrl,main:row.main,
            pages:row.pageCount,publishYear:row.publishYear,publisher:row.publisher,coverType:row.coverType,
            bookSize:row.bookSize,stockStatus:row.stockStatus
          }))
        });
        if(!built.ok){
          await discardSeriesKeys(created);
          clearSeriesUploads(rows);
          seriesStatus(built.message,"error");
          revealSeriesValidation(built,rows);
          return;
        }
        seriesState.pending={
          requestId:built.requestId,
          payload:built.payload,
          objectKeys:rows.map(row=>text(row.objectKey)).filter(Boolean),
          interiors:snapshotSeriesInteriors(rows)
        };
      }
      seriesStatus("ساقلىنىۋاتىدۇ…","");
      const saved=await rpc("admin_create_book_volume_series",{p_request_id:built.requestId,p_payload:built.payload});
      const kept=new Set((saved&&saved.members||[]).map(member=>text(member.image_url)));
      if(saved&&saved.replayed===true)await discardSeriesKeys(created.filter(key=>!kept.has(rows.find(row=>row.objectKey===key)?.imageUrl||"")));
      const creditRetry=!!(seriesState.pending&&seriesState.pending.creditsIncomplete&&seriesState.pending.interiorsSaved);
      const interiors=seriesState.pending&&Array.isArray(seriesState.pending.interiors)?seriesState.pending.interiors:[];
      if(!creditRetry){
        if(!(await saveInteriorsOrStop(interiors, saved)))return;
        if(seriesState.pending)seriesState.pending.interiorsSaved=true;
      }
      try{
        await persistSeriesCredits(saved, built.payload);
      }catch(error){
        if(seriesState.pending)seriesState.pending.creditsIncomplete=true;
        const creditMessage=error&&error.creditPlan&&error.message?error.message:"يۈرۈشلۈك ساقلاندى، ئاپتور ئۇلانمىسى ساقلانمىدى. قايتا ساقلىسىڭىز كىتاب قايتا قوشۇلمايدۇ.";
        showCreditRecovery(creditMessage);
        return;
      }
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
          const recovered=seriesState.pending&&Array.isArray(seriesState.pending.interiors)?seriesState.pending.interiors:[];
          if(!(await saveInteriorsOrStop(recovered, saved)))return;
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
      const shown=seriesUserError(error);
      seriesStatus(shown.message,"error",shown.diagnostic);
    }finally{
      seriesState.saving=false;
    }
  }
  function bind(){
    bindSuggestions();
    $("#volumeGroupCategory")?.addEventListener("input",()=>{markMetadataTouched("category");syncCategorySource()});
    $("#volumeGroupTitle")?.addEventListener("input",()=>markMetadataTouched("title"));
    $("#volumeGroupAuthor")?.addEventListener("input",()=>markMetadataTouched("author"));
    $("#volumeGroupDescription")?.addEventListener("input",()=>markMetadataTouched("description"));
    $("#volumeGroupSetPrice")?.addEventListener("input",syncAbandon);
    $("#volumeGroupActive")?.addEventListener("change",syncAbandon);
    $("#volumeSeriesCategory")?.addEventListener("input",syncSeriesCategory);
    $("#volumeSeriesForm")?.addEventListener("click",event=>{
      const toggle=event.target.closest&&event.target.closest("[data-series-accordion]");
      if(!toggle||!$("#volumeSeriesForm").contains(toggle))return;
      toggleSeriesSection(toggle.closest("[data-series-accordion-section]"));
    });
    $("#volumeSeriesForm")?.addEventListener("input",refreshSeriesSummaries);
    $("#volumeSeriesForm")?.addEventListener("change",refreshSeriesSummaries);
    $("#newVolumeGroupBtn")?.addEventListener("click",newGroup);
    $("#showVolumeSeriesBtn")?.addEventListener("click",showSeriesForm);
    $("#showVolumeLinkBtn")?.addEventListener("click",showLinkForm);
    $("#volumeSeriesAddPart")?.addEventListener("click",addSeriesPart);
    $("#volumeSeriesForm")?.addEventListener("submit",saveSeries);
    $("#reloadVolumeGroupsBtn")?.addEventListener("click",()=>load(true));
    $("#volumeGroupForm")?.addEventListener("submit",saveGroup);
    $("#volumeGroupForm")?.querySelector("button[type='submit']")?.addEventListener("click",event=>{
      if(!linkSave.saving&&!linkSave.pending)return;
      event.preventDefault();
      saveGroup(event);
    });
    $("#volumeGroupPublishBtn")?.addEventListener("click",publishGroup);
    $("#volumeGroupAbandon")?.addEventListener("click",()=>{
      const id=positiveId($("#volumeGroupId")&&$("#volumeGroupId").value);
      if(id)openGroup(id);
    });
    $("#volumeGroupLookupBtn")?.addEventListener("click",lookupBook);
    $("#volumeGroupBookLookup")?.addEventListener("keydown",event=>{
      if(event.key==="Enter"){event.preventDefault();lookupBook()}
    });
    $("#volumeGroupLookupPreview")?.addEventListener("click",event=>{
      if(event.target.closest("[data-lookup-retry]")){lookupBook();return}
      if(event.target.closest("[data-lookup-more]")){lookupMore();return}
      const button=event.target.closest("[data-lookup-add]");
      if(button&&!button.disabled)addLookupCandidate(button.dataset.lookupAdd);
    });
  }
  function attachSeriesSuggestions(){
    const Suggest=root.KutadguBookEntrySuggest;
    if(!Suggest||!Suggest.attachCombobox)return;
    const rows=()=>typeof state.suggestionRows==="function"?state.suggestionRows():[];
    ["#volumeSeriesAuthor","#volumeSeriesTranslator","#volumeSeriesPublisher"].forEach(selector=>{
      const input=$(selector);
      if(!input||input.dataset.seriesSuggest==="1")return;
      input.dataset.seriesSuggest="1";
      const field=selector==="#volumeSeriesPublisher"?"publisher":selector==="#volumeSeriesTranslator"?"translator":"author";
      Suggest.attachCombobox(input,()=>Suggest.uniqueValuesFromRows(rows(),field));
    });
  }
  function init(options){
    if(options&&typeof options.suggestionRows==="function")state.suggestionRows=options.suggestionRows;
    if(state.db)return;
    state.db=options&&options.db||root.__kutadguAdminDb||null;
    bind();
    const authorAdd=$("#volumeSeriesAuthorAdd");
    const translatorAdd=$("#volumeSeriesTranslatorAdd");
    if(authorAdd)authorAdd.addEventListener("click",()=>addSeriesCreditInput("#volumeSeriesAuthorExtras"));
    if(translatorAdd)translatorAdd.addEventListener("click",()=>addSeriesCreditInput("#volumeSeriesTranslatorExtras"));
    attachSeriesSuggestions();
  }

  root.KutadguAdminVolumeGroups={init,load,newGroup,openGroup,normalizeMembers,editorPayload,seriesEntryPayload,seriesUserError,seriesInteriorCap,showSeriesForm,_state:state};
})(typeof globalThis!=="undefined"?globalThis:this);
