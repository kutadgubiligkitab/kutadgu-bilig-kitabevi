"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

const migration = read("STAGE87_COVER_INTEGRITY.sql");
const admin = read("admin.js");
const config = read("supabase-config.js");

assert.match(migration, /ADD COLUMN IF NOT EXISTS cover_sha256 text NULL/);\nassert.match(migration, /ADD COLUMN IF NOT EXISTS cover_dhash text NULL/);
assert.match(migration, /books_cover_sha256_format_chk/);
assert.match(migration, /\^\[0-9a-f\]\{64\}\$/);
assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS books_cover_sha256_unique_idx/);\nassert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS books_cover_dhash_unique_idx/);
assert.doesNotMatch(migration, /UPDATE\s+public\.books/i);
assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.books/i);

assert.match(config, /cover_sha256:\s*false/);

assert.match(admin, /async function detectOptionalCoverSha256Column/);
assert.match(admin, /window\.crypto\.subtle\.digest\("SHA-256",bytes\)/);
assert.match(admin, /db\.from\("books"\)\.select\("id,title"\)\.eq\("cover_sha256",key\)/);
assert.match(admin, /books_cover_sha256_unique_idx/);
assert.match(admin, /if\(!isEdit&&!pendingSave&&!coverFile\)/);
assert.match(admin, /يېڭى كىتابقا مۇقاۋا رەسىمى تاللاش كېرەك/);
assert.match(admin, /row\.cover_sha256=coverHash/);

const repairAt = admin.indexOf("async function confirmCoverRepair");
const importAt = admin.indexOf("const coverResults=await ImportCovers.mapPool");
assert.ok(repairAt >= 0);
assert.ok(importAt >= 0);
assert.ok(admin.slice(repairAt, repairAt + 6000).includes("payload.cover_sha256=hash"));\nassert.ok(admin.slice(repairAt, repairAt + 6000).includes("payload.cover_dhash=visualHash"));
assert.ok(admin.slice(importAt, importAt + 4000).includes("patch.cover_sha256=hash"));
assert.ok(admin.slice(importAt, importAt + 4000).includes("findCoverShaConflict(hash,job.id)"));

console.log("cover integrity guard tests passed");
