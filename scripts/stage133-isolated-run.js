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

async function main() {
  const { PGlite } = await loadPglite();
  const db = new PGlite();
  const steps = [
    ["fixture", fs.readFileSync(path.join(root, "scripts/stage133-isolated-fixture.sql"), "utf8")],
    ["migration", fs.readFileSync(path.join(root, "STAGE133_BOOK_VOLUME_SERIES_CREATE_SCHEMA.sql"), "utf8")],
    ["assertions", fs.readFileSync(path.join(root, "scripts/stage133-isolated-assertions.sql"), "utf8")]
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
