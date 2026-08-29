#!/usr/bin/env node
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const root = path.join(__dirname, "..");
const port = Number(process.env.PORT || 4173);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/index.html") {
    send(res, 308, { Location: `/${url.search}` }, "");
    return;
  }
  let rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const abs = path.join(root, rel);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    send(res, 403, { "Content-Type": "text/plain" }, "forbidden");
    return;
  }
  fs.readFile(abs, (err, data) => {
    if (err) {
      send(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "not found");
      return;
    }
    send(res, 200, { "Content-Type": TYPES[path.extname(abs)] || "application/octet-stream" }, data);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`static preview http://127.0.0.1:${port}/`);
});
