const sitemap = require("../kutadgu-sitemap.js");

function pageFromRequest(req) {
  try {
    const host = req.headers && (req.headers.host || "localhost");
    const url = new URL(req.url || "/", `https://${host}`);
    const fromQuery = url.searchParams.get("page");
    if (fromQuery) return fromQuery;
    const file = url.pathname.split("/").pop() || "";
    const match = file.match(/^sitemap-books-(\d+)\.xml$/i);
    if (match) return match[1];
  } catch (err) {}
  return "1";
}

module.exports = async function sitemapBooks(req, res) {
  try {
    const xml = await sitemap.buildBooksSitemapXml(pageFromRequest(req));
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    res.end(xml);
  } catch (err) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end("book sitemap unavailable");
  }
};
