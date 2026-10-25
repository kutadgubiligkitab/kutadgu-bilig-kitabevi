"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "admin-volume-groups.js"), "utf8");
const html = fs.readFileSync(path.join(root, "admin.html"), "utf8");

function sliceBetween(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}

const filter = sliceBetween("function catalogLookupFilter", "async function searchEligibleCatalog");
assert.match(filter, /__kutadguAdminTest/);
assert.match(filter, /searchOrFilter\(query,true\)/);

const catalog = sliceBetween("async function searchEligibleCatalog", "function mergeLookup");
assert.match(catalog, /catalogLookupFilter/);
assert.match(catalog, /\.from\("books"\)/);
assert.match(catalog, /\.or\(filter\)/);
assert.match(catalog, /\.order\("id"/);
assert.match(catalog, /\{count:"exact"\}/);
assert.match(catalog, /\.range\(start,start\+LOOKUP_PAGE-1\)/);
assert.doesNotMatch(catalog, /\.limit\(/);
assert.doesNotMatch(catalog, /listFilters/);
assert.doesNotMatch(catalog, /admin_preview_book_volume_members/);

const lookup = sliceBetween("async function lookupBook", "async function load");
assert.match(lookup, /lookupGeneration/);
assert.match(lookup, /admin_preview_book_volume_members/);
assert.match(lookup, /searchEligibleCatalog/);
assert.match(lookup, /isbnLookupQuery/);
assert.match(lookup, /exactId\|\|isbnQuery/);

const add = sliceBetween("async function addLookupCandidate", "async function lookupBook");
assert.match(add, /admin_preview_book_volume_members/);
assert.match(add, /volume_label:nextLabel/);
assert.doesNotMatch(add, /\.from\("books"\)/);
assert.doesNotMatch(add, /insert\(/);
assert.match(source, /readAcceptedBookMetadata/);
assert.match(source, /select\("id,category,source,description"\)/);
assert.doesNotMatch(catalog, /category,source,description/);

assert.match(html, /admin-volume-groups\.js\?v=13/);
assert.match(source, /function newLinkSlug/);
assert.match(source, /linkSave\.pending/);
assert.doesNotMatch(source, /series-\$\{state\.members\[0\]\.book_id\}/);
assert.match(html, /admin\.css\?v=68/);
assert.match(html, /admin\.js\?v=123/);
assert.match(source, /function resetLookup/);
assert.match(source, /resetLookup\(\)/);

console.log("volume-group lookup contract: ok");
