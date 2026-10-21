"use strict";

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.join(__dirname, "..");
const pgliteRoot = "/tmp/pglite-stage131/node_modules/@electric-sql/pglite";

function stripOuterTransaction(sql) {
  return sql.replace(/^\s*BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, "");
}

async function main() {
  const { PGlite } = await import(pathToFileURL(path.join(pgliteRoot, "dist/index.js")).href);
  const db = new PGlite();
  const steps = [
    ["fixture", fs.readFileSync(path.join(root, "scripts/stage127-isolated-fixture.sql"), "utf8")],
    ["stage127", stripOuterTransaction(fs.readFileSync(path.join(root, "STAGE127_BOOK_VOLUME_GROUPS.sql"), "utf8"))],
    ["stage131", fs.readFileSync(path.join(root, "STAGE131_BOOK_VOLUME_SERIES_ENTRY.sql"), "utf8")],
    ["assertions", fs.readFileSync(path.join(root, "scripts/stage131-isolated-assertions.sql"), "utf8")]
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
  console.log("stage131 isolated: PASS");
  await db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
