"use strict";

const fs = require("fs");
const path = require("path");
const publicBook = require("../kutadgu-public-book.js");

const SHELL_PATH = path.join(__dirname, "..", "book-shell.html");

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

module.exports = async function bookPublic(req, res) {
  const head = isHead(req);
  const id = publicBook.parseNumericBookId(req);
  if (!id) {
    send(res, 404, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }, publicBook.missingBookHtml(), head);
    return;
  }
  const result = await publicBook.lookupPublicNumericBook(id);
  if (result.outcome === "found") {
    let html;
    try {
      html = fs.readFileSync(SHELL_PATH);
    } catch (err) {
      send(res, 503, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      }, publicBook.lookupFailureHtml(), head);
      return;
    }
    send(res, 200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate"
    }, html, head);
    return;
  }
  if (result.outcome === "missing") {
    send(res, 404, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }, publicBook.missingBookHtml(), head);
    return;
  }
  send(res, 503, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  }, publicBook.lookupFailureHtml(), head);
};
