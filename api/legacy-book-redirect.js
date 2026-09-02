const seo = require("../kutadgu-book-seo.js");

module.exports = async function legacyBookRedirect(req, res) {
  const location = seo.legacyNumericIdRedirectPath(
    String((req && req.url) || "").includes("?")
      ? String(req.url).slice(String(req.url).indexOf("?"))
      : ""
  );
  if (!location) {
    res.statusCode = 404;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("not found");
    return;
  }
  res.statusCode = 308;
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  res.setHeader("Location", location);
  res.end();
};
