(function(root){
"use strict";

const PLACEHOLDER_AUTHOR="ئاپتور ئىسمى";
const PLACEHOLDER_COVER="sample-book-cover.png";

function normalizeCatalogText(value){
  return String(value??"").replace(/\s+/g," ").trim();
}

function normalizeIsbn(value){
  return String(value??"").trim().replace(/[\s-]+/g,"").replace(/[^0-9Xx]/g,"").toUpperCase();
}

function formatIsbn(value){
  return normalizeIsbn(value);
}

function isbnLooksValid(value){
  const n=normalizeIsbn(value);
  if(!n)return true;
  return n.length===10||n.length===13;
}

function coverFileName(value){
  const raw=String(value??"").trim();
  if(!raw)return "";
  try{
    const path=raw.split("?")[0].split("#")[0];
    const parts=path.split("/").filter(Boolean);
    return String(parts[parts.length-1]||path).toLowerCase();
  }catch(err){
    return raw.toLowerCase();
  }
}

function isMissingAuthor(value){
  const author=normalizeCatalogText(value);
  return !author||author==="—"||author===PLACEHOLDER_AUTHOR;
}

function isPlaceholderCover(value){
  const raw=String(value??"").trim();
  if(!raw)return true;
  const name=coverFileName(raw);
  return name===PLACEHOLDER_COVER||raw===PLACEHOLDER_COVER;
}

function isMissingDescription(value){
  return !normalizeCatalogText(value);
}

function isMissingIsbn(value){
  return !normalizeIsbn(value);
}

function qualityIssues(book,opts={}){
  const descriptionSupported=opts.descriptionSupported!==false;
  const isbnSupported=opts.isbnSupported!==false;
  const issues=[];
  if(isMissingAuthor(book&&(book.author)))issues.push("author");
  if(isPlaceholderCover(book&&(book.image_url||book.image)))issues.push("cover");
  if(descriptionSupported&&isMissingDescription(book&&book.description))issues.push("description");
  if(isbnSupported&&isMissingIsbn(book&&book.isbn))issues.push("isbn");
  // translator / publisher / publish_year / pages are optional bibliography and never mark a book incomplete.
  return issues;
}

function qualityLabels(issues){
  if(!issues||!issues.length)return [{key:"complete",text:"تولۇق",title:"Complete"}];
  const map={
    author:{key:"author",text:"ئاپتور يوق",title:"Missing author"},
    cover:{key:"cover",text:"مۇقاۋا يوق",title:"Missing cover"},
    description:{key:"description",text:"چۈشەندۈرۈش يوق",title:"Missing description"},
    isbn:{key:"isbn",text:"ISBN يوق",title:"Missing ISBN"}
  };
  return issues.map(key=>map[key]).filter(Boolean);
}

function qualityChipsHtml(book,opts){
  return qualityLabels(qualityIssues(book,opts)).map(item=>
    `<span class="admin-quality-chip admin-quality-${item.key}" title="${item.title}">${item.text}</span>`
  ).join("");
}

function postgrestQuoted(value){
  return `"${String(value??"").replace(/"/g,"")}"`;
}

function qualityFilterSpec(quality){
  const q=String(quality||"").trim();
  if(!q)return null;
  if(q==="missing_author"){
    return {or:`author.is.null,author.eq."",author.eq.${postgrestQuoted(PLACEHOLDER_AUTHOR)}`};
  }
  if(q==="placeholder_cover"){
    return {or:`image_url.is.null,image_url.eq."",image_url.eq.${postgrestQuoted(PLACEHOLDER_COVER)},image_url.ilike."%${PLACEHOLDER_COVER}%"`};
  }
  if(q==="missing_description"){
    return {or:`description.is.null,description.eq.""`};
  }
  if(q==="missing_isbn"){
    return {or:`isbn.is.null,isbn.eq.""`};
  }
  if(q==="complete"){
    return {
      ands:[
        {method:"not",args:["author","is",null]},
        {method:"neq",args:["author",""]},
        {method:"neq",args:["author",PLACEHOLDER_AUTHOR]},
        {method:"not",args:["image_url","is",null]},
        {method:"neq",args:["image_url",""]},
        {method:"not",args:["image_url","ilike",`%${PLACEHOLDER_COVER}%`]},
        {method:"not",args:["description","is",null]},
        {method:"neq",args:["description",""]},
        {method:"not",args:["isbn","is",null]},
        {method:"neq",args:["isbn",""]}
      ]
    };
  }
  return null;
}

function applyQualityFilter(query,quality){
  const spec=qualityFilterSpec(quality);
  if(!spec||!query)return query;
  if(spec.or&&typeof query.or==="function")query=query.or(spec.or);
  (spec.ands||[]).forEach(step=>{
    const fn=query[step.method];
    if(typeof fn==="function")query=fn.apply(query,step.args);
  });
  return query;
}

function titlesAuthorsMatch(a,b){
  return normalizeCatalogText(a&&a.title)===normalizeCatalogText(b&&b.title)
    && normalizeCatalogText(a&&a.author)===normalizeCatalogText(b&&b.author)
    && !!normalizeCatalogText(a&&a.title)
    && !!normalizeCatalogText(a&&a.author);
}

function isbnExactMatch(a,b){
  const left=normalizeIsbn(a&&a.isbn);
  const right=normalizeIsbn(b&&b.isbn);
  return !!left&&left===right;
}

function mergeConflictRows(rows,reason){
  const out=[];
  const seen=new Map();
  (rows||[]).forEach(row=>{
    if(!row||row.id==null||row.id==="")return;
    const id=String(row.id);
    if(seen.has(id)){
      const existing=seen.get(id);
      if(!existing.reasons.includes(reason))existing.reasons.push(reason);
      return;
    }
    const item={
      id:row.id,
      title:row.title||"",
      author:row.author||"",
      price:row.price,
      is_active:row.is_active!==false,
      isbn:row.isbn||"",
      reasons:[reason]
    };
    seen.set(id,item);
    out.push(item);
  });
  return out;
}

function shouldWarnCreateDuplicates(operation,matches){
  return String(operation||"").toUpperCase()==="INSERT"&&Array.isArray(matches)&&matches.length>0;
}

function shouldSkipCreateDuplicateCheck(operation){
  const op=String(operation||"").toUpperCase();
  return op==="UPDATE"||op==="STOP";
}

function createDuplicateMessage(matches){
  const reasons=new Set();
  (matches||[]).forEach(row=>(row.reasons||[]).forEach(r=>reasons.add(r)));
  if(reasons.has("isbn")&&reasons.has("title_author")){
    return "ئوخشاش ISBN ۋە ئوخشاش ئىسىم+ئاپتورلۇق مەۋجۇت كىتاب تېپىلدى.";
  }
  if(reasons.has("isbn"))return "ئوخشاش ISBN لىق مەۋجۇت كىتاب تېپىلدى.";
  return "بۇ نام ۋە ئاپتور بىلەن ئوخشاش كىتاب بار.";
}

const api={
  PLACEHOLDER_AUTHOR,
  PLACEHOLDER_COVER,
  normalizeCatalogText,
  normalizeIsbn,
  formatIsbn,
  isbnLooksValid,
  isMissingAuthor,
  isPlaceholderCover,
  isMissingDescription,
  isMissingIsbn,
  qualityIssues,
  qualityLabels,
  qualityChipsHtml,
  qualityFilterSpec,
  applyQualityFilter,
  titlesAuthorsMatch,
  isbnExactMatch,
  mergeConflictRows,
  shouldWarnCreateDuplicates,
  shouldSkipCreateDuplicateCheck,
  createDuplicateMessage
};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
root.KutadguAdminQuality=api;
})(typeof window!=="undefined"?window:typeof globalThis!=="undefined"?globalThis:{});
