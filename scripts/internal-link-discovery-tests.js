#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const preview = require("../cloudflare/preview-dispatch");
const listing = require("../kutadgu-category-listing");
const sitemap = require("../kutadgu-sitemap");
const nav = require("../kutadgu-category-nav");
const publicGroup = require("../kutadgu-public-volume-group");
const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const rows = [
  { slug: "romanlar", source: "romanlar.html", label: "رومانلار" },
  { slug: "future-category", source: "future-category.html", label: "يېڭى تۈر <test>", group_key: "literature" },
  { slug: "unmapped", source: "unmapped.html", label: "باشقا تۈر" },
  { slug: "taamlar", source: "taamlar.html", label: "يوشۇرۇن", is_hidden: true },
  { slug: "retired", source: "retired.html", label: "كونا", retired: true }
];
const payload = { categories: rows, redirects: [] };

async function main() {
  let requests = 0;
  const deps = {
    listing, sitemap,
    readAsset: async name => new Response(read(name.replace(/^\//, ""))),
    fetchImpl: async url => {
      assert.ok(String(url).endsWith("/rpc/list_public_book_categories"));
      requests++;
      return new Response(JSON.stringify(payload), { status: 200 });
    }
  };
  const response = await preview.dispatch(new Request("http://localhost/"), {}, deps);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.equal(requests, 1);
  for (const slug of ["romanlar", "future-category", "unmapped"]) {
    assert.ok(html.includes(`href="/${slug}" data-category-slug="${slug}" hidden`));
  }
  assert.ok(!html.includes('href="/taamlar"'));
  assert.ok(!html.includes('href="/retired"'));
  assert.ok(html.includes("يېڭى تۈر &lt;test&gt;"));
  assert.ok(html.includes("data-kutadgu-category-nav"));
  console.log("PASS homepage dispatch emits real public menu anchors before interaction");

  const seed = html.match(/id="kutadguPublicCategoryDirectory" type="application\/json">([\s\S]*?)<\/script>/)[1];
  const context = {
    document: { readyState: "complete", getElementById: () => ({ textContent: seed }), addEventListener() {}, querySelector() { return null; } },
    fetch: () => { throw Error("hydration should reuse the server directory"); }
  };
  context.window = context;
  vm.runInNewContext(read("kutadgu-book-categories.js"), context);
  await context.KutadguBookCategories.boot();
  assert.equal(context.KutadguBookCategories.snapshot().mode, "authoritative");
  assert.deepEqual(Array.from(context.KutadguBookCategories.visible(), row => row.slug), ["romanlar", "future-category", "unmapped"]);
  context.KutadguBookCategories.applyFailure("directory temporarily unavailable");
  assert.deepEqual(Array.from(context.KutadguBookCategories.visible(), row => row.slug), ["romanlar", "future-category", "unmapped"]);
  vm.runInNewContext(read("kutadgu-category-nav.js"), context);
  assert.equal(context.KutadguCategoryNav.model().all.length, 3);
  context.KutadguBookCategories = { snapshot: () => ({ mode: "failed" }), visible: () => rows };
  assert.equal(context.KutadguCategoryNav.model().all.length, 0);
  const hostile = nav.applyDirectoryDocument(read("index.html"), { categories: [{ slug: "safe", source: "safe.html", label: '</script><img src=x onerror="x">' }] });
  const hostileSeed = hostile.match(/id="kutadguPublicCategoryDirectory" type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(hostileSeed).categories[0].label, '</script><img src=x onerror="x">');
  assert.ok(!hostile.includes('<img src=x onerror="x">'));
  console.log("PASS hydration reuses the server directory and escapes HTML/JSON safely");

  for (const size of [2, 9, 100]) {
    const members = Array.from({ length: size }, (_, i) => ({ book_id: String(700 + i), position: i + 1, title: `كىتاب ${i + 1} <test>`, volume_label: `${i + 1}-قىسىم` }));
    const memberHtml = publicGroup.renderStaticMemberList({ members });
    assert.equal((memberHtml.match(/<a href="\/book\/\d+">/g) || []).length, size);
    members.forEach(member => assert.ok(memberHtml.includes(`href="/book/${member.book_id}"`)));
    assert.ok(memberHtml.includes("&lt;test&gt;"));
  }
  console.log("PASS server member anchors cover variable public group sizes");

  const managed = await preview.dispatch(new Request("http://localhost/sitemap-pages.xml"), {}, deps);
  const xml = await managed.text();
  for (const slug of ["taamlar", "dastanlar", "adabiyat-roman", "retired"]) assert.ok(!xml.includes(`/${slug}</loc>`));
  for (const slug of ["adabiyat", "romanlar", "future-category", "unmapped", "privacy", "delete-account"]) assert.ok(xml.includes(`/${slug}</loc>`));
  assert.ok(!read("sitemap-pages.xml").includes("/taamlar</loc>"));
  const old = '<urlset><url><loc>https://www.kutadgubilik.com/taamlar</loc></url></urlset>';
  assert.ok(!sitemap.appendManagedCategories(old, rows).includes("/taamlar</loc>"));
  assert.ok(sitemap.appendManagedCategories(old, [{ slug: "taamlar" }]).includes("/taamlar</loc>"));
  const down = await preview.dispatch(new Request("http://localhost/"), {}, { ...deps, fetchImpl: async () => { throw Error("unavailable"); } });
  assert.equal(down.status, 200);
  assert.ok(!(await down.text()).includes('href="/taamlar"'));
  const malformed = await preview.dispatch(new Request("http://localhost/sitemap-pages.xml"), {}, { ...deps, fetchImpl: async () => new Response("{}") });
  assert.ok((await malformed.text()).includes("/romanlar</loc>"));
  console.log("PASS static and managed sitemaps obey public visibility and preserve the literature hub");
  assert.match(read("privacy.html"), /<a href="\/delete-account">[^<]+<\/a>/);
  assert.ok(read("delete-account.html").includes("info@kutadgubilik.com"));
  console.log("PASS privacy provides a static Uyghur link to deletion instructions");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
