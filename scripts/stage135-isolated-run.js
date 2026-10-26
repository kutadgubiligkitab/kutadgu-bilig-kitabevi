"use strict";

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.join(__dirname, "..");

async function loadPglite() {
  const candidates = [
    path.join(process.env.TEMP || "", "pglite-stage133", "node_modules", "@electric-sql", "pglite", "dist", "index.js"),
    path.join(process.env.TEMP || "", "pglite-stage132", "node_modules", "@electric-sql", "pglite", "dist", "index.js"),
    path.join(root, "node_modules", "@electric-sql", "pglite", "dist", "index.js")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return import(pathToFileURL(candidate).href);
  }
  throw new Error("PGlite is not installed");
}

function sliceFrom(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error("missing " + startMarker);
  return text.slice(start, end);
}

async function main() {
  const { PGlite } = await loadPglite();
  const db = new PGlite();
  const columns = `
    ALTER TABLE public.books ADD COLUMN cover_type text;
    ALTER TABLE public.books ADD COLUMN book_size text;
    ALTER TABLE public.books ADD COLUMN stock_status text;
    ALTER TABLE public.books DROP CONSTRAINT IF EXISTS books_cover_type_chk;
    ALTER TABLE public.books ADD CONSTRAINT books_cover_type_chk CHECK (
      cover_type IS NULL OR cover_type = '' OR cover_type IN ('hardcover', 'paperback', 'other')
    );
    ALTER TABLE public.books DROP CONSTRAINT IF EXISTS books_book_size_chk;
    ALTER TABLE public.books ADD CONSTRAINT books_book_size_chk CHECK (
      book_size IS NULL OR book_size = '' OR book_size IN ('A4', 'A5', 'B5', 'other')
    );
    ALTER TABLE public.books DROP CONSTRAINT IF EXISTS books_stock_status_allowed_chk;
    ALTER TABLE public.books ADD CONSTRAINT books_stock_status_allowed_chk CHECK (
      stock_status IS NULL OR btrim(stock_status) = '' OR stock_status IN ('in_stock', 'low_stock', 'out_of_stock')
    );
    CREATE SCHEMA IF NOT EXISTS private;
  `;
  const stage130 = fs.readFileSync(path.join(root, "STAGE130_BOOK_VOLUME_STOREFRONT.sql"), "utf8");
  const groupsStart = stage130.indexOf("CREATE OR REPLACE FUNCTION private.kutadgu_public_volume_groups()");
  const groupsEnd = stage130.indexOf("REVOKE ALL ON FUNCTION private.kutadgu_public_volume_groups()");
  const publicGroups = `
    ALTER TABLE public.books ADD COLUMN IF NOT EXISTS sales_count integer NOT NULL DEFAULT 0;
    ALTER TABLE public.books ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;
    ALTER TABLE public.books ADD COLUMN IF NOT EXISTS is_recommended boolean NOT NULL DEFAULT false;
    ALTER TABLE public.books ADD COLUMN IF NOT EXISTS is_bestseller boolean NOT NULL DEFAULT false;
    ${stage130.slice(groupsStart, groupsEnd)}
  `;
  const stage131 = fs.readFileSync(path.join(root, "STAGE131_BOOK_VOLUME_SERIES_ENTRY.sql"), "utf8");
  const publication = sliceFrom(
    stage131,
    "CREATE OR REPLACE FUNCTION public.admin_set_book_volume_group_publication(",
    "REVOKE ALL ON FUNCTION public.list_public_book_volume_part_prices"
  ) + `
    REVOKE ALL ON FUNCTION public.admin_set_book_volume_group_publication(bigint, bigint, boolean) FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.admin_set_book_volume_group_publication(bigint, bigint, boolean) TO authenticated;
  `;
  const cycle = fs.readFileSync(path.join(root, "scripts/stage135-isolated-assertions.sql"), "utf8")
    .split(/^-- @stage135 /m)
    .slice(1)
    .map((part) => part.replace(/^[^\n]*\n/, ""));
  const forward = fs.readFileSync(path.join(root, "STAGE135_SERIES_CREATION_IS_NEW.sql"), "utf8");
  const rollback = fs.readFileSync(path.join(root, "STAGE135_SERIES_CREATION_IS_NEW_ROLLBACK.sql"), "utf8");
  const steps = [
    ["fixture", fs.readFileSync(path.join(root, "scripts/stage133-isolated-fixture.sql"), "utf8")],
    ["columns", columns],
    ["stage133", fs.readFileSync(path.join(root, "STAGE133_BOOK_VOLUME_SERIES_CREATE_SCHEMA.sql"), "utf8")],
    ["public-groups", publicGroups],
    ["publication", publication],
    ["stage134", fs.readFileSync(path.join(root, "STAGE134_SERIES_VOLUME_METADATA.sql"), "utf8")],
    ["stage133-assertions", fs.readFileSync(path.join(root, "scripts/stage133-isolated-assertions.sql"), "utf8")],
    ...fs.readFileSync(path.join(root, "scripts/stage134-isolated-assertions.sql"), "utf8")
      .split(/(?=^DO \$\$)/m)
      .filter((part) => part.trim().startsWith("DO"))
      .map((part, index) => ["stage134-assertions-" + (index + 1), part]),
    ["stage135-forward", forward],
    ["stage135-after-forward", cycle[0]],
    ["stage135-rollback", rollback],
    ["stage135-after-rollback", cycle[1]],
    ["stage135-forward-again", forward],
    ["stage135-after-second-forward", cycle[2]]
  ];
  for (const [name, sql] of steps) {
    try {
      const result = await db.exec(sql);
      const rows = result.flatMap((item) => item.rows || []);
      console.log("ok", name, rows.length ? JSON.stringify(rows) : "");
    } catch (error) {
      console.error("failed", name);
      console.error(error && error.message || error);
      process.exit(1);
    }
  }
  await db.close();
}

main();
