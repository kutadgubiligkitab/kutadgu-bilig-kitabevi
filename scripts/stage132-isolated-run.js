"use strict";

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.join(__dirname, "..");

function stripOuterTransaction(sql) {
  return sql.replace(/BEGIN\s*;/, "").replace(/COMMIT\s*;\s*$/, "");
}

async function loadPglite() {
  const candidates = [
    path.join(process.env.TEMP || "", "pglite-stage132", "node_modules", "@electric-sql", "pglite", "dist", "index.js"),
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
  const steps = [
    ["fixture", fs.readFileSync(path.join(root, "scripts/stage132-isolated-fixture.sql"), "utf8")],
    ["stage132", stripOuterTransaction(fs.readFileSync(path.join(root, "STAGE132_BOOK_CATEGORIES.sql"), "utf8"))],
    ["assertions", fs.readFileSync(path.join(root, "scripts/stage132-isolated-assertions.sql"), "utf8")]
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
  console.log("stage132 isolated: PASS");
  await db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
