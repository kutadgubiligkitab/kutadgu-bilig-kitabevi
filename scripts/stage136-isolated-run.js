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
    .split(/^-- @stage136 /m)
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
  const forward = stripOuterTransaction(fs.readFileSync(path.join(root, "STAGE136_CATEGORY_ADMIN_GROUP.sql"), "utf8"));
  const rollback = stripOuterTransaction(fs.readFileSync(path.join(root, "STAGE136_CATEGORY_ADMIN_GROUP_ROLLBACK.sql"), "utf8"));
  const parts = chunks(fs.readFileSync(path.join(root, "scripts/stage136-isolated-assertions.sql"), "utf8"));
  const snapshot = `
    CREATE TEMP TABLE stage136_categories AS
    SELECT id, slug, source, label, summary, icon, sort_order, is_hidden, retired_at, redirect_category_id, revision
    FROM public.book_categories;
    CREATE TEMP TABLE stage136_books AS
    SELECT id, title, author, category, source, price, image_url, stock, is_active, submission_status
    FROM public.books;
    CREATE TEMP TABLE stage136_groups AS
    SELECT id, slug, title, category, source, complete_set_price, revision
    FROM public.book_volume_groups;
  `;
  const steps = [
    ["fixture", fs.readFileSync(path.join(root, "scripts/stage132-isolated-fixture.sql"), "utf8")],
    ["stage132", stripOuterTransaction(fs.readFileSync(path.join(root, "STAGE132_BOOK_CATEGORIES.sql"), "utf8"))],
    ["snapshot", snapshot],
    ["stage136", forward],
    ["stage136-again", forward],
    ["applied", parts[0]],
    ["rollback", rollback],
    ["rolled", parts[1]],
    ["stage136-restored", forward],
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
  console.log("stage136 isolated: PASS");
  await db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
