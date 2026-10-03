(function(root){
"use strict";

const ROLES=["author","translator","publisher"];
const ROLE_LABELS={author:"ئاپتور",translator:"تەرجىمان",publisher:"نەشرىيات"};
const ROLE_META_LABELS={author:"ئاپتورى",translator:"تەرجىمە قىلغۇچى",publisher:"نەشرىيات"};
const HELPER_LABEL="بارلىق كىتابلىرى";
const LEGACY_SEPARATOR="، ";
const MAX_NAMES=8;
const MAX_LENGTH=500;
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AMBIGUOUS_RE=/[،,;؛/|&+·•]|[\r\n]|(?:^|\s)ۋە(?:\s|$)/;

function escapeHtml(value){
  return String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function escapeAttr(value){
  return escapeHtml(value).replace(/'/g,"&#39;");
}
function displayName(value){
  const raw=String(value??"").replace(/\u00a0/g," ").trim();
  if(!raw)return "";
  try{return raw.normalize("NFC")}catch(err){return raw}
}
function nameKey(value){
  return displayName(value);
}
function isOmittedCreditName(value){
  const name=displayName(value);
  if(!name)return true;
  if(name==="—"||name==="–"||name==="-"||name==="ئاپتور ئىسمى")return true;
  if(/^(undefined|null|unknown)$/i.test(name))return true;
  return false;
}
function legacyAmbiguous(value){
  const raw=String(value??"");
  if(isOmittedCreditName(raw))return false;
  return AMBIGUOUS_RE.test(raw);
}
function legacySingleCredit(value){
  if(isOmittedCreditName(value))return null;
  const name=displayName(value);
  return {name,ambiguous:legacyAmbiguous(value)};
}
function legacyJoin(names){
  return (names||[]).map(displayName).filter(name=>name&&!isOmittedCreditName(name)).join(LEGACY_SEPARATOR);
}
function normalizeRole(value){
  const role=String(value||"").trim().toLowerCase();
  return ROLES.indexOf(role)>=0?role:"";
}
function normalizeCreditId(value){
  const id=String(value||"").trim().toLowerCase();
  return UUID_RE.test(id)?id:"";
}
function creditHref(role,id){
  const safeRole=normalizeRole(role);
  const safeId=normalizeCreditId(id);
  if(!safeRole||!safeId)return "";
  return "/"+safeRole+"/"+safeId;
}
function parseCreditPath(pathname){
  const path=String(pathname||"").split("?")[0].split("#")[0].replace(/\/+$/,"")||"/";
  const match=path.match(/^\/(author|translator|publisher)\/([^/]+)$/i);
  if(!match)return null;
  let raw=match[2];
  try{raw=decodeURIComponent(raw)}catch(err){raw=""}
  const role=normalizeRole(match[1]);
  const id=normalizeCreditId(raw);
  return {role,id,valid:!!(role&&id)};
}
function creditBooksSelect(){
  return "*,book_credits!inner(identity_id,role)";
}
function applyCreditFilter(params,state){
  const id=normalizeCreditId(state&&state.creditId);
  const role=normalizeRole(state&&state.creditRole);
  if(!id||!role||!params||typeof params.set!=="function")return false;
  const base=String(params.get("select")||"*");
  const embed="book_credits!inner(identity_id,role)";
  params.set("select",base.indexOf("book_credits!")>=0?base:(base==="*"?"*,"+embed:base+","+embed));
  params.set("book_credits.identity_id","eq."+id);
  params.set("book_credits.role","eq."+role);
  if(!params.get("is_active"))params.set("is_active","eq.true");
  return true;
}
function identityRow(row){
  const nested=row&&(row.catalog_identities||row.identity);
  const ident=Array.isArray(nested)?nested[0]:nested;
  const id=normalizeCreditId(row&&(row.identity_id||row.identityId)||ident&&ident.id);
  const name=displayName(row&&(row.display_name||row.name)||ident&&(ident.display_name||ident.name));
  if(!name||isOmittedCreditName(name))return null;
  return {id,name,role:normalizeRole(row&&row.role),position:Number(row&&row.position)||0};
}
function structuredRows(book){
  if(!book)return null;
  if(Array.isArray(book.credits))return book.credits;
  if(Array.isArray(book.book_credits))return book.book_credits;
  return null;
}
function roleEntries(book,role){
  const safeRole=normalizeRole(role);
  if(!book||!safeRole)return [];
  const rows=structuredRows(book);
  if(rows){
    const parsed=rows.map(identityRow).filter(item=>item&&item.role===safeRole&&item.id);
    parsed.sort((a,b)=>a.position-b.position||a.name.localeCompare(b.name,"ug"));
    const seen=new Set();
    const out=[];
    parsed.forEach(item=>{
      if(seen.has(item.id))return;
      seen.add(item.id);
      out.push({id:item.id,name:item.name});
    });
    if(out.length)return out;
  }
  const field=safeRole==="author"?(book.author):(safeRole==="translator"?book.translator:book.publisher);
  const single=legacySingleCredit(field);
  return single?[{id:"",name:single.name}]:[];
}
function renderLinkedPeople(role,entries){
  const people=(entries||[]).filter(item=>item&&item.name&&normalizeCreditId(item.id));
  if(!people.length)return "";
  return `<div class="book-credit-list">`+people.map(item=>{
    const href=escapeAttr(creditHref(role,item.id));
    const name=escapeHtml(item.name);
    return `<div class="book-credit-person"><a class="book-credit-name" href="${href}">${name}</a><a class="book-credit-all" href="${href}">${escapeHtml(HELPER_LABEL)}</a></div>`;
  }).join("")+`</div>`;
}
function renderRoleValue(book,role){
  const entries=roleEntries(book,role);
  if(!entries.length)return "";
  const linked=renderLinkedPeople(role,entries);
  if(linked)return linked;
  return escapeHtml(legacyJoin(entries.map(item=>item.name)));
}
function renderMetaRow(label,role,book){
  const value=renderRoleValue(book,role);
  if(!value)return "";
  const shownLabel=label||ROLE_META_LABELS[normalizeRole(role)]||"";
  return `<div class="book-meta-row"><div class="book-meta-label">${escapeHtml(shownLabel)}</div><div class="book-meta-value">${value}</div></div>`;
}
function renderAuthorLine(book){
  const entries=roleEntries(book,"author");
  if(!entries.length)return "";
  const body=entries.map(item=>{
    const href=creditHref("author",item.id);
    if(!href)return escapeHtml(item.name);
    return `<a class="book-credit-name" href="${escapeAttr(href)}">${escapeHtml(item.name)}</a>`;
  }).join(escapeHtml(LEGACY_SEPARATOR));
  return `ئاپتورى: ${body}`;
}
function failPlan(error,role){
  const who=role==="translator"?"تەرجىمان":role==="publisher"?"نەشرىيات":"ئاپتور";
  let message="ئىسىم تىزىمى توغرا ئەمەس.";
  if(error==="duplicate")message=`ئوخشاش ${who}نى قايتا قوشقىلى بولمايدۇ.`;
  else if(error==="too-many")message=`ئەڭ كۆپ ${MAX_NAMES} ئىسىم قوشقىلى بولىدۇ.`;
  else if(error==="too-long")message="ئىسىم بەك ئۇزۇن.";
  else if(error==="required")message="ئاپتور ئىسمى كېرەك.";
  return {ok:false,error,message,writeCredits:false,omitLegacy:false,authors:[],translators:[],publisher:null,legacy:{author:"",translator:null,publisher:null}};
}
function collectCreditNames(values,options){
  const max=Math.max(1,Number(options&&options.max)||MAX_NAMES);
  const names=[];
  const seen=new Set();
  for(const raw of values||[]){
    if(isOmittedCreditName(raw))continue;
    const name=displayName(raw);
    if(name.length>MAX_LENGTH)return {ok:false,error:"too-long",names:[]};
    const key=nameKey(name);
    if(seen.has(key))return {ok:false,error:"duplicate",names:[]};
    seen.add(key);
    names.push(name);
    if(names.length>max)return {ok:false,error:"too-many",names:[]};
  }
  return {ok:true,names};
}
function planCreditSave(input){
  const source=input||{};
  if(source.loading){
    return {ok:false,error:"loading",message:"ئاپتور ئۇچۇرى يۈكلىنىۋاتىدۇ. يۈكلەش تاماملانغۇچە ساقلىماڭ.",writeCredits:false,omitLegacy:true,authors:[],translators:[],publisher:null,legacy:{author:"",translator:null,publisher:null}};
  }
  if(source.blocked){
    return {ok:true,error:"",message:"",writeCredits:false,omitLegacy:true,authors:[],translators:[],publisher:null,legacy:{author:"",translator:null,publisher:null}};
  }
  const authors=collectCreditNames(source.authors,{max:MAX_NAMES});
  if(!authors.ok)return failPlan(authors.error,"author");
  if(!authors.names.length)return failPlan("required","author");
  const translators=collectCreditNames(source.translators,{max:MAX_NAMES});
  if(!translators.ok)return failPlan(translators.error,"translator");
  const publisherRaw=displayName(source.publisher);
  if(publisherRaw&&publisherRaw.length>MAX_LENGTH)return failPlan("too-long","publisher");
  const publisher=isOmittedCreditName(publisherRaw)?null:publisherRaw;
  return {
    ok:true,
    error:"",
    message:"",
    writeCredits:!source.legacyOnly,
    omitLegacy:false,
    authors:authors.names,
    translators:translators.names,
    publisher,
    legacy:{
      author:legacyJoin(authors.names),
      translator:translators.names.length?legacyJoin(translators.names):null,
      publisher
    }
  };
}
function legacyColumnsForBookWrite(plan){
  if(!plan||plan.ok===false||plan.omitLegacy||plan.writeCredits)return null;
  const legacy=plan.legacy||{};
  return {
    author:legacy.author==null?"":legacy.author,
    translator:legacy.translator==null?null:legacy.translator,
    publisher:legacy.publisher==null?null:legacy.publisher
  };
}
function blankDirtyRoles(){
  return {author:false,translator:false,publisher:false};
}
function createCreditEditor(){
  let generation=0;
  let mode="create";
  let bookId="";
  let dirtyRoles=blankDirtyRoles();
  function snapshot(){
    const roles={author:!!dirtyRoles.author,translator:!!dirtyRoles.translator,publisher:!!dirtyRoles.publisher};
    return {generation,mode,bookId,dirty:roles.author||roles.translator||roles.publisher,dirtyRoles:roles};
  }
  return {
    snapshot,
    openCreate(){
      generation+=1;
      mode="create";
      bookId="";
      dirtyRoles=blankDirtyRoles();
      return snapshot();
    },
    openBook(id){
      generation+=1;
      mode="loading";
      bookId=String(id==null?"":id);
      dirtyRoles=blankDirtyRoles();
      return snapshot();
    },
    markDirty(role){
      if(role==="author"||role==="translator"||role==="publisher")dirtyRoles[role]=true;
      else dirtyRoles={author:true,translator:true,publisher:true};
    },
    matches(token,id){
      if(!token||token.generation!==generation)return false;
      const expected=String(id==null?"":id);
      return bookId===expected&&String(token.bookId)===expected;
    },
    complete(token,nextMode){
      if(!this.matches(token,token&&token.bookId))return false;
      if(mode!=="loading")return false;
      mode=nextMode;
      return true;
    }
  };
}
function settleCreditLoad(editor,token,bookId,result){
  const source=result||{};
  if(!editor||typeof editor.matches!=="function"||!editor.matches(token,bookId)){
    return {ignored:true,applied:false,mode:editor&&editor.snapshot?editor.snapshot().mode:""};
  }
  if(editor.snapshot().mode!=="loading"){
    return {ignored:true,applied:false,mode:editor.snapshot().mode};
  }
  if(source.ok===false){
    const next=source.missing?"legacyOnly":"blocked";
    editor.complete(token,next);
    return {ignored:false,applied:false,keptInput:false,mode:next,applyRoles:[],rows:[]};
  }
  const dirtyRoles=(editor.snapshot().dirtyRoles)||{};
  editor.complete(token,"ready");
  const applyRoles=ROLES.filter(role=>!dirtyRoles[role]);
  return {
    ignored:false,
    applied:applyRoles.length===ROLES.length,
    keptInput:applyRoles.length<ROLES.length,
    mode:"ready",
    applyRoles,
    rows:Array.isArray(source.rows)?source.rows:[]
  };
}
async function loadCreditEditor(editor,token,bookId,query){
  let result;
  try{
    result=await query();
  }catch(error){
    result={ok:false,missing:false,error};
  }
  return settleCreditLoad(editor,token,bookId,result||{ok:false});
}
async function writeStructuredCredits(invoke){
  let error=null;
  try{
    const result=await invoke();
    error=result&&result.error||null;
  }catch(err){
    error=err;
  }
  if(!error)return {status:"saved"};
  if(creditRpcMissing(error))return {status:"rpc-missing",error};
  const failure=new Error(error.message||String(error));
  failure.creditWriteFailed=true;
  failure.cause=error;
  throw failure;
}
async function commitAdminContributorWrite(options){
  const source=options||{};
  const plan=source.plan||{};
  if(plan.ok===false){
    return {status:"blocked",creditsCalled:false,bookWritten:false,legacyWritten:false};
  }
  const columns=legacyColumnsForBookWrite(plan);
  const bookResult=await source.writeBook(columns);
  if(bookResult&&bookResult.error){
    return {status:"book-failed",creditsCalled:false,bookWritten:false,legacyWritten:!!columns,error:bookResult.error};
  }
  if(!plan.writeCredits){
    return {status:"book-saved",creditsCalled:false,bookWritten:true,legacyWritten:!!columns};
  }
  try{
    const outcome=await writeStructuredCredits(()=>source.writeCredits(plan));
    if(outcome.status==="rpc-missing"){
      const fallback=await source.writeLegacyText(plan.legacy||{});
      if(fallback&&fallback.error){
        return {status:"credit-failed",creditsCalled:true,bookWritten:true,legacyWritten:false,error:fallback.error};
      }
      return {status:"legacy-fallback",creditsCalled:true,bookWritten:true,legacyWritten:true};
    }
    return {status:"saved",creditsCalled:true,bookWritten:true,legacyWritten:false};
  }catch(error){
    return {status:"credit-failed",creditsCalled:true,bookWritten:true,legacyWritten:false,error};
  }
}
async function commitPendingSubmissionCredits(options){
  const source=options||{};
  let submitted;
  try{
    submitted=await source.submit();
  }catch(error){
    return {status:"submission-failed",creditsCalled:false,error};
  }
  if(!submitted||submitted.error){
    return {status:"submission-failed",creditsCalled:false,error:submitted&&submitted.error};
  }
  const outcome=await commitAdminContributorWrite({
    plan:source.plan,
    writeBook:async()=>({error:null,id:submitted.id}),
    writeCredits:source.writeCredits,
    writeLegacyText:source.writeLegacyText
  });
  outcome.id=submitted.id;
  return outcome;
}
async function applyStaffCredits(rpc,bookId,plan){
  if(!plan||plan.ok===false){
    return {status:"blocked",panel:"incomplete",retry:false};
  }
  if(!plan.writeCredits){
    return {status:"saved",panel:"success",retry:false};
  }
  try{
    const outcome=await writeStructuredCredits(()=>rpc({
      p_book_id:Number(bookId),
      p_authors:plan.authors,
      p_translators:plan.translators,
      p_publisher:plan.publisher
    }));
    if(outcome.status==="rpc-missing"){
      return {status:"rpc-missing",panel:"incomplete",retry:true,error:outcome.error};
    }
    return {status:"saved",panel:"success",retry:false};
  }catch(error){
    return {status:"failed",panel:"incomplete",retry:true,error};
  }
}
async function saveStaffCreditsAfterInsert(submit,rpc,plan){
  let submitted;
  try{
    submitted=await submit();
  }catch(error){
    return {status:"submission-failed",creditsCalled:false,panel:"error",error};
  }
  if(!submitted||submitted.error){
    return {status:"submission-failed",creditsCalled:false,panel:"error",error:submitted&&submitted.error};
  }
  const credit=await applyStaffCredits(rpc,submitted.id,plan);
  return Object.assign({creditsCalled:!!(plan&&plan.writeCredits),id:submitted.id},credit);
}
function creditRelationMissing(error){
  const code=String(error&&error.code||"");
  const msg=String(error&&(error.message||error.details||error.hint||"")||"");
  return code==="PGRST205"||code==="42P01"||/could not find the table/i.test(msg)||/relation ["']?public\.book_credits["']? does not exist/i.test(msg);
}
function creditRpcMissing(error){
  const code=String(error&&error.code||"");
  const msg=String(error&&(error.message||error.details||error.hint||"")||"");
  return code==="PGRST202"||code==="42883"||/could not find the function/i.test(msg)||/schema cache/i.test(msg)||/function .* does not exist/i.test(msg);
}
function dedupeCreditRows(rows){
  const seen=new Set();
  return (rows||[]).filter(row=>{
    const id=String(row&&row.id||"");
    if(!id||seen.has(id))return false;
    seen.add(id);
    return true;
  });
}
function sameCredit(book,role,id){
  const safeId=normalizeCreditId(id);
  if(!safeId)return false;
  return roleEntries(book,role).some(item=>item.id===safeId);
}
function summaryText(role,total){
  const label=ROLE_LABELS[normalizeRole(role)]||"";
  const count=Number(total);
  const shown=Number.isFinite(count)&&count>=0?String(count):"—";
  return label?`${label} · جەمئىي ${shown} كىتاب`:"";
}

const api={
  ROLES,
  ROLE_LABELS,
  ROLE_META_LABELS,
  HELPER_LABEL,
  LEGACY_SEPARATOR,
  MAX_NAMES,
  MAX_LENGTH,
  displayName,
  nameKey,
  isOmittedCreditName,
  legacyAmbiguous,
  legacySingleCredit,
  legacyJoin,
  normalizeRole,
  normalizeCreditId,
  creditHref,
  parseCreditPath,
  creditBooksSelect,
  applyCreditFilter,
  roleEntries,
  renderRoleValue,
  renderMetaRow,
  renderAuthorLine,
  collectCreditNames,
  planCreditSave,
  legacyColumnsForBookWrite,
  createCreditEditor,
  settleCreditLoad,
  loadCreditEditor,
  writeStructuredCredits,
  commitAdminContributorWrite,
  commitPendingSubmissionCredits,
  applyStaffCredits,
  saveStaffCreditsAfterInsert,
  creditRelationMissing,
  creditRpcMissing,
  sameCredit,
  dedupeCreditRows,
  summaryText,
  escapeHtml,
  escapeAttr
};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
root.KutadguCredits=api;
})(typeof window!=="undefined"?window:typeof globalThis!=="undefined"?globalThis:{});
