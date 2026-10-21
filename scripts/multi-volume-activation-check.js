"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.join(__dirname, "..");
const pgliteRoot = "/tmp/pglite-stage131/node_modules/@electric-sql/pglite";

function stripOuterTransaction(sql) {
  return sql.replace(/^\s*BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, "");
}

function read(name) {
  return fs.readFileSync(path.join(root, name), "utf8");
}

function productionConfig() {
  return JSON.parse(read("wrangler.jsonc"));
}

function assertFlags() {
  const config = productionConfig();
  const production = config.env && config.env.production && config.env.production.vars;
  assert.strictEqual(production.MULTI_VOLUME_BOOKS_ENABLED, "true");
  assert.strictEqual(config.vars.MULTI_VOLUME_BOOKS_ENABLED, undefined);
  assert.strictEqual(config.env.production.name, "kutadgu-cloudflare-production");
  const app = read("app-config.js");
  assert.match(app, /multiVolumeBooks:true/);
  assert.doesNotMatch(app, /multiVolumeBooks:false/);
  const windowShim = {};
  global.window = windowShim;
  require(path.join(root, "app-config.js"));
  delete global.window;
  global.KUTADGU_APP_CONFIG = windowShim.KUTADGU_APP_CONFIG;
  const storefront = require(path.join(root, "kutadgu-volume-storefront.js"));
  const groups = require(path.join(root, "kutadgu-volume-groups.js"));
  assert.strictEqual(storefront.enabled(), true);
  assert.strictEqual(String(production.MULTI_VOLUME_BOOKS_ENABLED) === "true", true);
  const priced = groups.groupSetPrice({
    complete_set_price: 750,
    members: [{ price: 370 }, { price: 399 }]
  });
  assert.strictEqual(priced, 750);
  const admin = read("admin.html");
  assert.match(admin, /id="volumeSeriesForm"/);
  assert.match(admin, /id="volumeGroupForm"/);
  assert.match(admin, /id="bookForm"/);
  assert.match(admin, /id="volumeSeriesForm"[^>]*hidden/);
  console.log("flags: production worker true, client true, preview worker unset");
}

async function assertDatabase() {
  const { PGlite } = await import(pathToFileURL(path.join(pgliteRoot, "dist/index.js")).href);
  const db = new PGlite();
  const steps = [
    ["fixture127", read("scripts/stage127-isolated-fixture.sql")],
    ["fixture128", read("scripts/stage128-isolated-fixture.sql")],
    ["fixture130", read("scripts/stage130-isolated-fixture.sql")],
    ["stage127", stripOuterTransaction(read("STAGE127_BOOK_VOLUME_GROUPS.sql"))],
    ["stage128", stripOuterTransaction(read("STAGE128_BOOK_VOLUME_COMMERCE.sql"))],
    ["stage130", stripOuterTransaction(read("STAGE130_BOOK_VOLUME_STOREFRONT.sql"))],
    ["stage131", read("STAGE131_BOOK_VOLUME_SERIES_ENTRY.sql")],
    ["stage131-assertions", read("scripts/stage131-isolated-assertions.sql")],
    ["activation-assertions", read("scripts/multi-volume-activation-assertions.sql")]
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
  await db.close();
  console.log("activation isolated: PASS");
}

assertFlags();
assertDatabase().catch((error) => {
  console.error(error);
  process.exit(1);
});
