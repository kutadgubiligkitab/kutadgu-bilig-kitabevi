#!/usr/bin/env node
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const MIGRATION = "STAGE_AI_SEARCH_1C_VECTOR_FOUNDATION.sql";

const FROZEN = {
  "kutadgu-search-rank.js": "1a40c7ed8abc9594c893d3ca9fcab4c9891c1732558957f5e607d39a8c194ff5",
  "shop.js": "24e71d6008f74c7dc31a0e8d9961760c0964b35669aa9a1aa04f050f8edd909a",
  "STAGE2B_BOOKS_ACTIVE_SELECT_RLS.sql": "a2cf8760dc26d17bba65a64cdbb604cef2b5f0aa5bbd6b2f706449d701cde7c0",
  "STAGE2C_AAL2_BOOKS_WRITE_RLS.sql": "6bd143f8fcc0c21da0c06c55081109e54c1aa277222304e07bac3a14b61f75a3",
  "STAGE2C_AAL2_RESTRICTIVE_REPAIR.sql": "80403e29f52e9574061bfe18cbaa1277a4746bc1a8ecaa25b6381bb4435c760a",
  "STAGE2C_AAL2_ADMIN_SELECT_RLS.sql": "44a5e27f8be5adc20cdb316cac6d3f5f9e28597be24531662bf75d6e873bd5c0"
};

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
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
function sha256(rel) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, rel))).digest("hex");
}
function walkFiles(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || ["node_modules", "vendor", "test-results", "playwright-report"].includes(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

const sql = read(MIGRATION);
const shop = read("shop.js");
const rank = read("kutadgu-search-rank.js");
const stage2b = read("STAGE2B_BOOKS_ACTIVE_SELECT_RLS.sql");
const pkg = read("package.json");
const envExample = read(".env.example");

function functionBody(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(
    String.raw`create or replace function ${escaped}\([\s\S]*?\$\$;`,
    "i"
  ));
  assert.ok(match, "missing function " + name);
  return match[0];
}

test("Search 1A ranking module and shop.js remote ranking path are unchanged", () => {
  Object.keys(FROZEN).forEach((rel) => {
    assert.strictEqual(sha256(rel), FROZEN[rel], rel + " must remain byte-identical in this stage");
  });
  assert.match(rank, /isbnExact:\s*1000/);
  assert.match(rank, /titleExact:\s*900/);
  assert.match(shop, /Rank\.rankHits\(rows,state\.search\)/);
  assert.match(shop, /async function loadSearchRankIndex/);
  assert.doesNotMatch(shop, /match_active_books_ai/);
  assert.doesNotMatch(shop, /book_embeddings/);
  assert.doesNotMatch(shop, /text-embedding-3-large/);
});

test("existing books RLS policies are not dropped or rewritten", () => {
  assert.match(stage2b, /CREATE POLICY "public can read active books"/);
  assert.match(stage2b, /USING \(is_active = true\)/);
  assert.match(stage2b, /CREATE POLICY "admin can read all books"/);
  assert.doesNotMatch(sql, /ALTER TABLE public\.books\b/i);
  assert.doesNotMatch(sql, /DROP POLICY[^;]*\bON public\.books\b/i);
  assert.doesNotMatch(sql, /CREATE POLICY[\s\S]{0,400}\bON public\.books\b/i);
  assert.doesNotMatch(sql, /GRANT[\s\S]*ON TABLE public\.books\b/i);
  assert.doesNotMatch(sql, /REVOKE[\s\S]*ON TABLE public\.books\b/i);
});

test("migration is reviewed SQL only and is not auto-applied", () => {
  assert.match(sql, /MANUAL \/ REVIEWED APPLY ONLY/);
  assert.match(sql, /Do not run from CI or the browser/);
  assert.doesNotMatch(pkg, /STAGE_AI_SEARCH_1C_VECTOR_FOUNDATION\.sql/);
  assert.doesNotMatch(pkg, /supabase\s+db\s+push|psql\s+/);
  assert.doesNotMatch(sql, /OPENAI_API_KEY|api\.openai\.com|Authorization:\s*Bearer/i);
});

test("pgvector is enabled in the extensions schema at 1536 dimensions", () => {
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions/);
  assert.match(sql, /embedding extensions\.vector\(1536\) NOT NULL/);
  assert.match(sql, /query_embedding extensions\.vector\(1536\)/);
  assert.match(sql, /text-embedding-3-large/);
  assert.match(sql, /dimensions:\s*1536/);
});

test("book_embeddings is a separate table keyed to books.id with cascade delete", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.book_embeddings/);
  assert.match(sql, /book_id bigint PRIMARY KEY/);
  assert.match(sql, /REFERENCES public\.books\(id\) ON DELETE CASCADE/);
  assert.match(sql, /embedding_model text NOT NULL/);
  assert.match(sql, /source_text_hash text NOT NULL/);
  assert.match(sql, /updated_at timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(sql, /created_at timestamptz NOT NULL DEFAULT now\(\)/);
  assert.doesNotMatch(sql, /ADD COLUMN[\s\S]*embedding/i);
});

test("book_embeddings has RLS forced on and revokes public table access", () => {
  assert.match(sql, /ALTER TABLE public\.book_embeddings ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE public\.book_embeddings FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.book_embeddings FROM PUBLIC/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.book_embeddings FROM anon/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.book_embeddings FROM authenticated/);
});

test("raw vectors are not publicly selectable", () => {
  assert.match(sql, /DROP POLICY IF EXISTS "public can read book embeddings"/);
  assert.match(sql, /Intentionally no SELECT\/INSERT\/UPDATE\/DELETE policies/);
  assert.doesNotMatch(sql, /CREATE POLICY[\s\S]*ON public\.book_embeddings/i);
  assert.doesNotMatch(sql, /GRANT SELECT ON TABLE public\.book_embeddings/i);
  assert.doesNotMatch(sql, /GRANT ALL ON TABLE public\.book_embeddings/i);
  assert.doesNotMatch(sql, /FOR SELECT[\s\S]*book_embeddings/i);
});

test("no premature ANN / HNSW / IVFFLAT index", () => {
  assert.doesNotMatch(sql, /create\s+index[\s\S]{0,120}(hnsw|ivfflat)/i);
  assert.doesNotMatch(sql, /using\s+(hnsw|ivfflat)/i);
  assert.match(sql, /No HNSW \/ IVFFLAT \/ ANN index/);
  assert.match(sql, /~147 active books/);
});

test("match_active_books_ai is SECURITY DEFINER, fixed search_path, min grants", () => {
  const fn = functionBody(sql, "public.match_active_books_ai");
  assert.match(fn, /SECURITY DEFINER/i);
  assert.match(fn, /SET search_path = public, extensions, pg_temp/);
  assert.match(fn, /LANGUAGE sql/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.match_active_books_ai\(extensions\.vector, integer\) FROM PUBLIC/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.match_active_books_ai\(extensions\.vector, integer\) TO anon/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.match_active_books_ai\(extensions\.vector, integer\) TO authenticated/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[\s\S]*match_active_books_ai[\s\S]*TO PUBLIC/i);
});

test("public AI match path can only return active approved books and never raw vectors", () => {
  const fn = functionBody(sql, "public.match_active_books_ai");
  assert.match(fn, /INNER JOIN public\.books AS b\s+ON b\.id = e\.book_id/);
  assert.match(fn, /b\.is_active IS TRUE/);
  assert.match(fn, /b\.submission_status = 'approved'/);
  assert.match(fn, /LIMIT LEAST\(GREATEST\(COALESCE\(match_count, 12\), 1\), 24\)/);
  assert.match(fn, /1 - \(e\.embedding <=> query_embedding\)/);
  assert.match(fn, /RETURNS TABLE \(/);
  assert.match(fn, /\bimage_url text\b/);
  assert.match(fn, /\bstock integer\b/);
  assert.match(fn, /\bsimilarity double precision\b/);
  const returns = fn.match(/RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE/i);
  assert.ok(returns, "RETURNS TABLE block");
  assert.doesNotMatch(returns[1], /\bembedding\b/);
  assert.doesNotMatch(fn, /e\.embedding\s+AS/i);
  assert.doesNotMatch(fn, /,\s*e\.embedding\b/);
  assert.doesNotMatch(fn, /is_active IS NOT TRUE/);
  assert.doesNotMatch(fn, /submission_status = 'pending'/);
});

test("RPC preflight uses real books columns and does not invent cover", () => {
  assert.match(sql, /\('image_url'\)/);
  assert.match(sql, /\('submission_status'\)/);
  assert.doesNotMatch(sql, /\bcover\b/);
  assert.match(sql, /is_available is NOT used/);
});

test("no OpenAI key, secret, or embedding API client is committed in this stage", () => {
  assert.doesNotMatch(envExample, /OPENAI/);
  const files = walkFiles(root, []);
  const secretRe = /OPENAI_API_KEY\s*[=:]\s*['"]?sk-/i;
  const serviceRoleAssignRe = /SUPABASE_SERVICE_ROLE_KEY\s*[=:]\s*['"]?eyJ/;
  const sdkRe = /api\.openai\.com|openai\.embeddings|text-embedding-3-large/;
  files.forEach((full) => {
    const rel = path.relative(root, full);
    if (
      rel === MIGRATION ||
      rel === path.join("scripts", "stage-ai-search-1c-vector-foundation-tests.js")
    ) return;
    const text = fs.readFileSync(full, "utf8");
    assert.doesNotMatch(text, secretRe, rel);
    assert.doesNotMatch(text, serviceRoleAssignRe, rel);
    assert.doesNotMatch(text, /sk-(?:proj-|svcacct-)?[A-Za-z0-9]{10,}/, rel);
    assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, rel);
    const sdkExempt = rel === path.join("scripts", "ai-search-1d-generate-book-embeddings.js")
      || rel === path.join("scripts", "stage-ai-search-1d-generate-book-embeddings-tests.js")
      || rel === path.join("scripts", "stage-ai-search-1e-backend-api-tests.js")
      || rel === path.join("scripts", "stage-ai-search-1g2-relevance-rerank-tests.js")
      || rel === path.join("api", "ai-search.js")
      || rel === "kutadgu-ai-search.js";
    if (!rel.endsWith(".sql") && !sdkExempt) {
      assert.doesNotMatch(text, sdkRe, rel);
    }
  });
  assert.doesNotMatch(sql, /OPENAI_API_KEY/);
  assert.doesNotMatch(sql, /fetch\(/);
  assert.doesNotMatch(pkg, /"openai"/);
});

test("unit suite registers this file and does not execute the migration", () => {
  assert.match(pkg, /node scripts\/stage-ai-search-1c-vector-foundation-tests\.js/);
  assert.ok(fs.existsSync(path.join(root, MIGRATION)));
  assert.doesNotMatch(pkg, /STAGE_AI_SEARCH_1C_VECTOR_FOUNDATION\.sql/);
});

if (failed) {
  console.error("\n" + failed + " AI Search 1C vector foundation test(s) failed");
  process.exit(1);
}
console.log("stage-ai-search-1c-vector-foundation-tests ok");
