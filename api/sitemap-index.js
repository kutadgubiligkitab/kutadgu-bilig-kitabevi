const sitemap = require("../kutadgu-sitemap.js");

module.exports = async function sitemapIndex(req, res) {
  try {
    const xml = await sitemap.buildIndexSitemapXml();
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    res.end(xml);
  } catch (err) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end("sitemap index unavailable");
  }
};
