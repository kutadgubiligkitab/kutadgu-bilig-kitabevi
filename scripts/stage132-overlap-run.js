"use strict";

const fs = require("fs");
const path = require("path");

const os = require("os");
const { pathToFileURL } = require("url");

const root = path.join(__dirname, "..");
const embeddedPort = 54329;
let connectionString = process.env.STAGE132_PG_URL || "";
let embedded = null;

async function startEmbeddedPostgres() {
  const modulePath = path.join(process.env.TEMP || os.tmpdir(), "pglite-stage132", "node_modules", "embedded-postgres", "dist", "index.js");
  const loaded = await import(pathToFileURL(modulePath).href);
  const EmbeddedPostgres = loaded.default;
  process.env.LANG = "C";
  process.env.LC_ALL = "C";
  process.env.LC_MESSAGES = "C";
  embedded = new EmbeddedPostgres({
    databaseDir: path.join(os.tmpdir(), "stage132-overlap-pg-" + Date.now()),
    user: "postgres",
    password: "stage132",
    port: embeddedPort,
    persistent: false,
    initdbFlags: ["--locale=C", "--encoding=UTF8"],
    onLog: () => {},
    onError: (error) => console.error("postgres", error && error.message || error)
  });
  await embedded.initialise();
  await embedded.start();
  connectionString = `postgres://postgres:stage132@127.0.0.1:${embeddedPort}/postgres`;
}

function stripOuterTransaction(sql) {
  return sql.replace(/BEGIN\s*;/, "").replace(/COMMIT\s*;\s*$/, "");
}

function claims() {
  return JSON.stringify({
    sub: "22222222-2222-4222-8222-222222222222",
    role: "authenticated",
    aal: "aal2"
  });
}

async function applySchema(client) {
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.query("DROP SCHEMA IF EXISTS auth CASCADE");
  await client.query(fs.readFileSync(path.join(root, "scripts/stage132-isolated-fixture.sql"), "utf8"));
  await client.query(stripOuterTransaction(fs.readFileSync(path.join(root, "STAGE132_BOOK_CATEGORIES.sql"), "utf8")));
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [claims()]);
}

async function waitFor(check, label) {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(label);
}

async function main() {
  if (!connectionString) await startEmbeddedPostgres();
  let Client;
  try {
    ({ Client } = require("pg"));
  } catch (error) {
    ({ Client } = require(path.join(process.env.TEMP || "", "pglite-stage132", "node_modules", "pg")));
  }
  const setup = new Client({ connectionString });
  await setup.connect();
  await applySchema(setup);
  const grammar = (await setup.query("SELECT id, source FROM public.book_categories WHERE slug = 'grammar'")).rows[0];
  const romanlar = (await setup.query("SELECT id FROM public.book_categories WHERE slug = 'romanlar'")).rows[0];
  await setup.end();

  const holder = new Client({ connectionString });
  const other = new Client({ connectionString });
  const watcher = new Client({ connectionString });
  await holder.connect();
  await other.connect();
  await watcher.connect();
  holder.on("error", () => {});
  other.on("error", () => {});
  watcher.on("error", () => {});

  await holder.query("BEGIN");
  await holder.query("SELECT id FROM public.book_categories WHERE id = $1 FOR UPDATE", [grammar.id]);
  await holder.query(
    "UPDATE public.book_categories SET retired_at = now(), is_hidden = true, redirect_category_id = $2 WHERE id = $1",
    [grammar.id, romanlar.id]
  );
  const assignment = other.query("BEGIN").then(() => other.query(
    "UPDATE public.books SET source = $1, category = 'گرامماتىكا' WHERE id = 3 RETURNING source",
    [grammar.source]
  ));
  await waitFor(async () => {
    const locks = await watcher.query(
      "SELECT count(*)::int AS blocked FROM pg_stat_activity WHERE state = 'active' AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()"
    );
    return locks.rows[0].blocked > 0;
  }, "the assignment did not wait for the retiring transaction");
  await holder.query("COMMIT");
  let assignmentError = null;
  try {
    await assignment;
    await other.query("COMMIT");
  } catch (error) {
    assignmentError = error;
    await other.query("ROLLBACK");
  }
  if (!assignmentError || !/category_retired/.test(String(assignmentError.message || ""))) {
    throw new Error("an overlapping assignment survived retirement: " + (assignmentError && assignmentError.message));
  }
  const afterAssignment = await holder.query("SELECT source FROM public.books WHERE id = 3");
  if (afterAssignment.rows[0].source !== "other.html") throw new Error("the blocked assignment changed the legacy source");
  await holder.query(
    "UPDATE public.book_categories SET retired_at = NULL, is_hidden = false, redirect_category_id = NULL WHERE id = $1",
    [grammar.id]
  );
  console.log("ok retirement blocks a concurrent assignment");

  await holder.query("BEGIN");
  await holder.query("UPDATE public.books SET source = $1, category = 'گرامماتىكا' WHERE id = 3", [grammar.source]);
  const retire = (async () => {
    await other.query("BEGIN");
    await other.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims()]);
    return other.query(
      "SELECT public.admin_retire_book_category($1, $2, 1, $3)",
      ["10000000-0000-4000-8000-000000000301", grammar.id, romanlar.id]
    );
  })();
  await waitFor(async () => {
    const locks = await watcher.query(
      "SELECT count(*)::int AS blocked FROM pg_stat_activity WHERE state = 'active' AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()"
    );
    return locks.rows[0].blocked > 0;
  }, "retirement did not wait for the open assignment");
  await holder.query("COMMIT");
  let retireError = null;
  try {
    await retire;
    await other.query("COMMIT");
  } catch (error) {
    retireError = error;
    await other.query("ROLLBACK");
  }
  if (!retireError || !/category_not_empty/.test(String(retireError.message || ""))) {
    throw new Error("retirement committed over a concurrent assignment: " + (retireError && retireError.message));
  }
  const assigned = await holder.query("SELECT source FROM public.books WHERE id = 3");
  const stillOpen = await holder.query("SELECT retired_at FROM public.book_categories WHERE id = $1", [grammar.id]);
  if (assigned.rows[0].source !== grammar.source || stillOpen.rows[0].retired_at) {
    throw new Error("the overlapping assignment and retirement left an inconsistent category");
  }
  console.log("ok an open assignment blocks retirement");

  await holder.query("UPDATE public.books SET source = 'other.html', category = 'Custom' WHERE id = 3");
  await holder.query("BEGIN");
  await holder.query(
    "UPDATE public.book_volume_groups SET source = $1, category = 'گرامماتىكا' WHERE id = 9",
    [grammar.source]
  );
  const groupRetire = (async () => {
    await other.query("BEGIN");
    await other.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims()]);
    return other.query(
      "SELECT public.admin_retire_book_category($1, $2, 1, $3)",
      ["10000000-0000-4000-8000-000000000302", grammar.id, romanlar.id]
    );
  })();
  await waitFor(async () => {
    const locks = await watcher.query(
      "SELECT count(*)::int AS blocked FROM pg_stat_activity WHERE state = 'active' AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()"
    );
    return locks.rows[0].blocked > 0;
  }, "retirement did not wait for the group membership change");
  await holder.query("COMMIT");
  let groupError = null;
  try {
    await groupRetire;
    await other.query("COMMIT");
  } catch (error) {
    groupError = error;
    await other.query("ROLLBACK");
  }
  if (!groupError || !/category_not_empty/.test(String(groupError.message || ""))) {
    throw new Error("retirement committed over a concurrent group change: " + (groupError && groupError.message));
  }
  const group = await holder.query("SELECT source FROM public.book_volume_groups WHERE id = 9");
  if (group.rows[0].source !== grammar.source) throw new Error("the group source change was lost");
  console.log("ok an open group change blocks retirement");

  await holder.end();
  await other.end();
  await watcher.end();
  if (embedded) await embedded.stop();
  console.log("stage132 overlap: PASS");
}

main().catch(async (error) => {
  if (embedded) {
    try { await embedded.stop(); } catch (stopError) {}
  }
  console.error(error && error.stack || error);
  process.exit(1);
});
