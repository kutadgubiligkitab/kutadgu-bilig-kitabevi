#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const source = fs.readFileSync(path.join(root, "header-diag.js"), "utf8");
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, err && err.message);
  }
}

test("homepage loads the diagnostic from an external script", () => {
  assert.match(html, /<script defer src="header-diag\.js\?v=2"><\/script>/);
  assert.doesNotMatch(html, /kutadguHeaderDiag/);
  assert.match(source, /params\.get\("kutadguHeaderDiag"\) !== "1"\) return;/);
  assert.match(html, /mobile\.css\?v=26/);
  assert.match(html, /shop\.js\?v=167/);
});

test("diagnostic stays local and does not move the page", () => {
  ["fetch(", "XMLHttpRequest", "sendBeacon", "localStorage", "sessionStorage", "document.cookie", "scrollTo", "WebSocket", "indexedDB"].forEach((token) => {
    assert.equal(source.includes(token), false, token);
  });
  assert.match(source, /pageshow/);
  assert.match(source, /"scroll"/);
  assert.match(source, /visualViewport/);
  assert.match(source, /ھازىر خاتىرىلە/);
  assert.match(source, /ئۇزۇن بېسىپ كۆچۈرۈپ/);
  assert.match(source, /backdrop-filter/);
  assert.match(source, /inset-block-start/);
  assert.match(source, /--kutadgu-sticky-header-height/);
  assert.match(source, /https:\/\/diag\.invalid\//);
  assert.doesNotMatch(source, /location\.pathname \+ location\.search/);
  assert.match(source, /LIFECYCLE/);
});

if (failed) {
  console.error(failed + " test(s) failed");
  process.exit(1);
}
console.log("header diag source checks passed");
