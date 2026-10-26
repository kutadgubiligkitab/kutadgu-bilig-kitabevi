"use strict";

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.join(__dirname, "..");

function stripOuterTransaction(sql) {
  return sql.replace(/BEGIN\s*;/, "").replace(/COMMIT\s*;\s*$/, "");
}

function chunks(sql) {
  return sql
    .split(/^-- @stage137 /m)
    .slice(1)
    .map((part) => part.replace(/^[^\n]*\n/, ""));
}

async function loadPglite() {
  const candidates = [
    path.join(process.env.TEMP || "", "pglite-stage132", "node_modules", "@electric-sql", "pglite", "dist", "index.js"),
    path.join(process.env.TEMP || "", "pglite-stage133", "node_modules", "@electric-sql", "pglite", "dist", "index.js"),
    path.join(root, "node_modules", "@electric-sql", "pglite", "dist", "index.js")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return import(pathToFileURL(candidate).href);
  }
  throw new Error("PGlite is not installed");
}

async function main() {
  const { PGlite } = await loadPglite();
  const db = new PGlite();
  const parts = chunks(fs.readFileSync(path.join(root, "scripts/stage137-isolated-assertions.sql"), "utf8"));
  const seed = `
    UPDATE public.book_categories SET admin_group = 'children' WHERE slug = 'children';
    UPDATE public.book_categories SET admin_group = 'parenting' WHERE slug = 'terbiye';
    UPDATE public.book_categories SET admin_group = 'textbooks' WHERE slug = 'derslik';
    UPDATE public.book_categories SET admin_group = 'literature' WHERE slug = 'romanlar';
    CREATE TEMP TABLE stage137_categories AS
    SELECT id, slug, source, label, summary, revision FROM public.book_categories;
    CREATE TEMP TABLE stage137_books AS
    SELECT id, source, category, price, stock FROM public.books;
  `;
  const steps = [
    ["fixture", fs.readFileSync(path.join(root, "scripts/stage132-isolated-fixture.sql"), "utf8")],
    ["stage132", stripOuterTransaction(fs.readFileSync(path.join(root, "STAGE132_BOOK_CATEGORIES.sql"), "utf8"))],
    ["stage136", stripOuterTransaction(fs.readFileSync(path.join(root, "STAGE136_CATEGORY_ADMIN_GROUP.sql"), "utf8"))],
    ["seed", seed],
    ["stage137", stripOuterTransaction(fs.readFileSync(path.join(root, "STAGE137_CATEGORY_PUBLIC_GROUP.sql"), "utf8"))],
    ["applied", parts[0]],
    ["rollback", stripOuterTransaction(fs.readFileSync(path.join(root, "STAGE137_CATEGORY_PUBLIC_GROUP_ROLLBACK.sql"), "utf8"))],
    ["rolled", parts[1]],
    ["stage137-again", stripOuterTransaction(fs.readFileSync(path.join(root, "STAGE137_CATEGORY_PUBLIC_GROUP.sql"), "utf8"))],
    ["restored", parts[2]]
  ];
  for (const [name, sql] of steps) {
    try {
      await db.exec(sql);
      console.log("ok", name);
    } catch (error) {
      console.error("failed", name);
      console.error(error && error.message || error);
      process.exit(1);
    }
  }
  console.log("stage137 isolated: PASS");
  await db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
