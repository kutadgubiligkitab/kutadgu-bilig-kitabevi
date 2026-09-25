"use strict";

const listing = require("../kutadgu-category-listing.js");

function isHead(req) {
  return String((req && req.method) || "GET").toUpperCase() === "HEAD";
}

function send(res, status, headers, body, head) {
  res.statusCode = status;
  Object.keys(headers).forEach((key) => res.setHeader(key, headers[key]));
  if (head) {
    res.end();
    return;
  }
  res.end(body);
}

module.exports = async function categoryListing(req, res) {
  const head = isHead(req);
  const slug = listing.parseCategorySlug(req);
  if (!slug) {
    send(res, 404, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": listing.FAILURE_CACHE_CONTROL,
      "X-Robots-Tag": "noindex, follow"
    }, listing.failureDocument(""), head);
    return;
  }
  let template = "";
  try {
    template = listing.readTemplate(slug);
  } catch (err) {
    template = "";
  }
  if (!template) {
    send(res, 503, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": listing.FAILURE_CACHE_CONTROL,
      "X-Robots-Tag": "noindex, follow"
    }, listing.failureDocument(""), head);
    return;
  }
  try {
    const books = await listing.loadCategoryBooks(slug);
    const html = listing.applyCategoryDocument(template, slug, books);
    send(res, 200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": listing.SUCCESS_CACHE_CONTROL
    }, html, head);
  } catch (err) {
    send(res, 503, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": listing.FAILURE_CACHE_CONTROL,
      "X-Robots-Tag": "noindex, follow"
    }, listing.failureDocument(template), head);
  }
};
