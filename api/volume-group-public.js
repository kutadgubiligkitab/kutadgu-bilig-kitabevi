const volumeGroup=require("../kutadgu-public-volume-group.js");
const publicBook=require("../kutadgu-public-book.js");

module.exports=async function volumeGroupPublic(req,res){
  if(String(process.env.MULTI_VOLUME_BOOKS_ENABLED||"")!=="true"){
    res.statusCode=404;
    res.setHeader("Content-Type","text/html; charset=utf-8");
    res.setHeader("Cache-Control","no-store");
    res.end(publicBook.missingBookHtml());
    return;
  }
  const slug=volumeGroup.parseSlug(req);
  if(!slug){
    res.statusCode=404;
    res.setHeader("Content-Type","text/html; charset=utf-8");
    res.setHeader("Cache-Control","no-store");
    res.end(publicBook.missingBookHtml());
    return;
  }
  const result=await volumeGroup.lookupPublicVolumeGroup(slug);
  if(result.outcome==="found"){
    const url=new URL(req.url,"https://www.kutadgubilik.com");
    const canonicalPath=volumeGroup.groupPath(result.group);
    // API rewrites carry the original public route explicitly.
    if(url.pathname!==canonicalPath && !(url.pathname==="/api/volume-group-public"&&["series","volume-group"].includes(url.searchParams.get("route"))&&("/"+url.searchParams.get("route")+"/"+url.searchParams.get("slug"))===canonicalPath)){
      if(url.pathname==="/api/volume-group-public"){
        url.searchParams.delete("slug");
        url.searchParams.delete("route");
      }
      const query=url.searchParams.toString();
      res.statusCode=result.group.public_slug?301:302;
      res.setHeader("Location",canonicalPath+(query?"?"+query:""));
      res.setHeader("Cache-Control",result.group.public_slug?"public, max-age=300":"no-store");
      res.end();
      return;
    }
    const bookResult=await publicBook.lookupPublicNumericBook(result.group.representative_book_id);
    if(bookResult.outcome==="found"){
      res.statusCode=200;
      res.setHeader("Content-Type","text/html; charset=utf-8");
      res.setHeader("Cache-Control","no-store");
      res.end(volumeGroup.applyGroupDocument(volumeGroup.readShell(),result.group,bookResult.book));
      return;
    }
  }
  if(result.outcome==="error"){
    res.statusCode=503;
    res.setHeader("Content-Type","text/html; charset=utf-8");
    res.setHeader("Cache-Control","no-store");
    res.setHeader("X-Robots-Tag","noindex, follow");
    res.end(publicBook.lookupFailureHtml());
    return;
  }
  res.statusCode=404;
  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.setHeader("Cache-Control","public, s-maxage=60");
  res.end(publicBook.missingBookHtml());
};
