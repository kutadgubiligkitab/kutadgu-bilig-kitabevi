#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const listing = require("../kutadgu-category-listing.js");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, err && err.stack || err);
  }
}

function vercelConfig() {
  return JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
}

function categoryIncludePattern(config) {
  const functions = config && config.functions;
  const entry = functions && functions["api/category-listing.js"];
  return entry && typeof entry.includeFiles === "string" ? entry.includeFiles : "";
}

function expandIncludeFiles(pattern) {
  const raw = String(pattern || "").trim();
  if (!raw) return [];
  const brace = raw.match(/^\{([^{}]+)\}(.*)$/);
  if (!brace) return [raw];
  const suffix = brace[2] || "";
  return brace[1].split(",").map((part) => `${part.trim()}${suffix}`).filter((name) => name && name !== suffix);
}

function trustedTemplateRels() {
  return listing.CATEGORY_SLUGS.map((slug) => listing.templateFile(slug));
}

function staticRequireGraph(entryRel) {
  const seen = new Set();
  function walk(rel) {
    const normalized = rel.split(path.sep).join("/");
    if (seen.has(normalized)) return;
    seen.add(normalized);
    const abs = path.join(root, normalized);
    const text = fs.readFileSync(abs, "utf8");
    const dir = path.dirname(abs);
    for (const match of text.matchAll(/require\(\s*(["'])(\.[^"']+)\1\s*\)/g)) {
      let target = path.normalize(path.join(dir, match[2]));
      if (!path.extname(target)) {
        if (fs.existsSync(target + ".js")) target += ".js";
        else if (fs.existsSync(path.join(target, "index.js"))) target = path.join(target, "index.js");
      }
      const next = path.relative(root, target);
      if (next.startsWith("..") || path.isAbsolute(next)) continue;
      walk(next);
    }
  }
  walk(entryRel);
  return seen;
}

function copyRel(rel, destRoot) {
  const from = path.join(root, rel);
  const to = path.join(destRoot, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function stageFunction(destRoot, extraRels) {
  for (const rel of staticRequireGraph("api/category-listing.js")) copyRel(rel, destRoot);
  for (const rel of extraRels || []) copyRel(rel, destRoot);
}

function readTemplatesInBundle(destRoot) {
  const script = `
    const listing = require("./kutadgu-category-listing.js");
    const out = {};
    for (const slug of listing.CATEGORY_SLUGS) {
      try {
        const html = listing.readTemplate(slug);
        out[slug] = {
          ok: typeof html === "string" && html.includes('class="books-grid"'),
          bytes: typeof html === "string" ? html.length : 0
        };
      } catch (err) {
        out[slug] = { ok: false, code: err && err.code || "throw" };
      }
    }
    process.stdout.write(JSON.stringify(out));
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: destRoot,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "bundle probe failed");
  }
  return JSON.parse(result.stdout);
}

test("includeFiles is scoped to the category function and lists every trusted template", () => {
  const config = vercelConfig();
  assert.deepStrictEqual(Object.keys(config.functions || {}), ["api/category-listing.js"]);
  const pattern = categoryIncludePattern(config);
  assert.ok(pattern.length > 0 && pattern.length <= 256, "includeFiles must fit the Vercel schema maxLength");
  const included = expandIncludeFiles(pattern).sort();
  const trusted = trustedTemplateRels().sort();
  assert.deepStrictEqual(included, trusted);
  assert.strictEqual(trusted.length, 17);
  for (const rel of ["admin.html", "book-staff.html", "book-shell.html", "books.html", "index.html"]) {
    assert.ok(!included.includes(rel), rel);
  }
  for (const slug of listing.CATEGORY_SLUGS) {
    const rel = listing.templateFile(slug);
    const expected = path.join(root, rel);
    assert.strictEqual(listing.templatePath(slug), expected);
    assert.ok(fs.existsSync(expected), rel);
    assert.ok(listing.readTemplate(slug).includes('class="books-grid"'), slug);
  }
});

test("a traced-only function bundle cannot read category templates", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "kutadgu-category-traced-"));
  try {
    stageFunction(dest, []);
    for (const rel of trustedTemplateRels()) {
      assert.ok(!fs.existsSync(path.join(dest, rel)), rel);
    }
    const probed = readTemplatesInBundle(dest);
    assert.strictEqual(probed.romanlar.ok, false);
    assert.strictEqual(probed.romanlar.code, "ENOENT");
    assert.strictEqual(probed.children.ok, false);
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test("includeFiles gives the function runtime access to every category template", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "kutadgu-category-packaged-"));
  try {
    const included = expandIncludeFiles(categoryIncludePattern(vercelConfig()));
    stageFunction(dest, included);
    for (const rel of ["admin.html", "book-staff.html", "book-shell.html"]) {
      assert.ok(!fs.existsSync(path.join(dest, rel)), rel);
    }
    const probed = readTemplatesInBundle(dest);
    for (const slug of listing.CATEGORY_SLUGS) {
      assert.strictEqual(probed[slug] && probed[slug].ok, true, slug);
      assert.ok(probed[slug].bytes > 500, slug);
    }
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

if (failed) {
  console.error("\n" + failed + " category template packaging test(s) failed");
  process.exit(1);
}
console.log("category-template-packaging-tests ok");
