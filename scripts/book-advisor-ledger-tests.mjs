import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire("C:/Users/kitab/AppData/Local/kutadgu-book-advisor-pg/package.json");
const EmbeddedPostgres = require("embedded-postgres").default;
const { Client } = require("pg");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 55432;
const databaseDir = path.join(process.env.LOCALAPPDATA, "kutadgu-book-advisor-pg", "data-" + process.pid);
const hashA = "ab".repeat(32);
const hashB = "cd".repeat(32);

function statements(sql) {
  const out = [];
  let current = "";
  let dollar = "";
  for (let i = 0; i < sql.length; i += 1) {
    if (!dollar && sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (sql[i] === "$") {
      const match = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        if (!dollar) dollar = match[0];
        else if (dollar === match[0]) dollar = "";
        current += match[0];
        i += match[0].length - 1;
        continue;
      }
    }
    if (!dollar && sql[i] === ";") {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += sql[i];
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

async function apply(client, file) {
  const sql = fs.readFileSync(path.join(root, file), "utf8");
  for (const statement of statements(sql)) await client.query(statement);
}

function connect() {
  return new Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    password: "password",
    database: "advisor"
  });
}

async function asService(work) {
  const client = connect();
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE service_role");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_rollback) { /* already closed */ }
    throw error;
  } finally {
    await client.end();
  }
}

async function reserve(hash, amount) {
  return asService((client) => client.query(
    "SELECT public.reserve_book_advisor_spend($1, $2)::text AS id",
    [hash, amount]
  ).then((result) => result.rows[0].id));
}

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: "postgres",
    password: "password",
    port,
    persistent: false,
    autoRehydrateSymlinks: true,
    initdbFlags: ["--locale=C", "--encoding=UTF8"]
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("advisor");
  const admin = connect();
  await admin.connect();
  try {
    await admin.query("CREATE ROLE anon NOLOGIN");
    await admin.query("CREATE ROLE authenticated NOLOGIN");
    await admin.query("CREATE ROLE service_role NOLOGIN");
    await apply(admin, "STAGE_BOOK_ADVISOR_SPEND.sql");
    const args = await admin.query(`
      SELECT pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'reserve_book_advisor_spend'
    `);
    assert.equal(args.rows[0].args, "p_client_hash text, p_micro_usd bigint");
    const privileges = await admin.query(`
      SELECT
        has_schema_privilege('anon', 'private', 'USAGE') AS anon_schema,
        has_function_privilege('anon', 'public.reserve_book_advisor_spend(text, bigint)', 'EXECUTE') AS anon_execute,
        has_function_privilege('authenticated', 'public.reserve_book_advisor_spend(text, bigint)', 'EXECUTE') AS auth_execute,
        has_function_privilege('service_role', 'public.reserve_book_advisor_spend(text, bigint)', 'EXECUTE') AS service_execute,
        has_function_privilege('service_role', 'private.reserve_book_advisor_spend(text, bigint)', 'EXECUTE') AS service_private,
        has_table_privilege('service_role', 'private.book_advisor_spend', 'SELECT') AS service_table
    `);
    assert.equal(privileges.rows[0].anon_schema, false);
    assert.equal(privileges.rows[0].anon_execute, false);
    assert.equal(privileges.rows[0].auth_execute, false);
    assert.equal(privileges.rows[0].service_execute, true);
    assert.equal(privileges.rows[0].service_private, false);
    assert.equal(privileges.rows[0].service_table, false);
    await admin.query("BEGIN");
    await admin.query("SET LOCAL ROLE anon");
    await assert.rejects(
      () => admin.query("SELECT public.reserve_book_advisor_spend($1, 1)", [hashA]),
      /permission denied/
    );
    await admin.query("ROLLBACK");
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM private.book_advisor_spend")).rows[0].n, 0);

    await admin.query("UPDATE private.book_advisor_policy SET daily_limit_micro_usd = 500, monthly_limit_micro_usd = 800, per_minute = 20");
    const firstWave = await Promise.all(Array.from({ length: 8 }, () => reserve(hashA, 100).then(() => "ok").catch((error) => error.message)));
    assert.equal(firstWave.filter((item) => item === "ok").length, 5);
    assert.equal(firstWave.filter((item) => item.includes("advisor_budget")).length, 3);
    const afterCreate = await admin.query("SELECT period_kind, reserved_micro_usd, spent_micro_usd FROM private.book_advisor_spend ORDER BY period_kind");
    assert.deepEqual(afterCreate.rows, [
      { period_kind: "day", reserved_micro_usd: "500", spent_micro_usd: "0" },
      { period_kind: "month", reserved_micro_usd: "500", spent_micro_usd: "0" }
    ]);
    const reservation = (await admin.query("SELECT id FROM private.book_advisor_reservations LIMIT 1")).rows[0].id;
    const settled = await asService((client) => client.query(
      "SELECT public.settle_book_advisor_spend($1, 40)::text AS actual",
      [reservation]
    ).then((result) => result.rows[0].actual));
    const replay = await asService((client) => client.query(
      "SELECT public.settle_book_advisor_spend($1, 40)::text AS actual",
      [reservation]
    ).then((result) => result.rows[0].actual));
    assert.equal(settled, "40");
    assert.equal(replay, "40");
    await assert.rejects(
      () => asService((client) => client.query("SELECT public.settle_book_advisor_spend($1, 99)", [reservation])),
      /advisor_budget_unavailable/
    );
    const balances = await admin.query("SELECT reserved_micro_usd, spent_micro_usd FROM private.book_advisor_spend WHERE period_kind = 'day'");
    assert.equal(balances.rows[0].reserved_micro_usd, "400");
    assert.equal(balances.rows[0].spent_micro_usd, "40");
    const releasable = (await admin.query("SELECT id FROM private.book_advisor_reservations WHERE state = 'reserved' LIMIT 1")).rows[0].id;
    await asService((client) => client.query("SELECT public.release_book_advisor_spend($1)", [releasable]));
    await asService((client) => client.query("SELECT public.release_book_advisor_spend($1)", [releasable]));
    const released = await admin.query("SELECT reserved_micro_usd FROM private.book_advisor_spend WHERE period_kind = 'day'");
    assert.equal(released.rows[0].reserved_micro_usd, "300");
    const negatives = await admin.query("SELECT count(*)::int AS n FROM private.book_advisor_spend WHERE reserved_micro_usd < 0 OR spent_micro_usd < 0");
    assert.equal(negatives.rows[0].n, 0);

    await admin.query("DELETE FROM private.book_advisor_reservations");
    await admin.query("DELETE FROM private.book_advisor_rate");
    await admin.query("DELETE FROM private.book_advisor_spend");
    await admin.query("UPDATE private.book_advisor_policy SET daily_limit_micro_usd = 10000, monthly_limit_micro_usd = 250, per_minute = 20");
    const monthWave = await Promise.all(Array.from({ length: 4 }, () => reserve(hashA, 100).then(() => "ok").catch((error) => error.message)));
    assert.equal(monthWave.filter((item) => item === "ok").length, 2);
    assert.equal(monthWave.filter((item) => item.includes("advisor_budget")).length, 2);

    await admin.query("DELETE FROM private.book_advisor_reservations");
    await admin.query("DELETE FROM private.book_advisor_rate");
    await admin.query("DELETE FROM private.book_advisor_spend");
    await admin.query("UPDATE private.book_advisor_policy SET daily_limit_micro_usd = 100000, monthly_limit_micro_usd = 100000, per_minute = 2");
    const clients = await Promise.all([
      ...Array.from({ length: 3 }, () => reserve(hashA, 10).then(() => "a-ok").catch((error) => "a-" + error.message)),
      ...Array.from({ length: 3 }, () => reserve(hashB, 10).then(() => "b-ok").catch((error) => "b-" + error.message))
    ]);
    assert.equal(clients.filter((item) => item === "a-ok").length, 2);
    assert.equal(clients.filter((item) => item === "b-ok").length, 2);
    assert.equal(clients.filter((item) => item.includes("advisor_rate_limit")).length, 2);

    const session = await asService((client) => client.query(
      "SELECT public.book_advisor_session_create($1, $2)::text AS id",
      [hashA, [718, 701]]
    ).then((result) => result.rows[0].id));
    const own = await asService((client) => client.query(
      "SELECT public.book_advisor_session_read($1, $2) AS ids",
      [session, hashA]
    ).then((result) => result.rows[0].ids));
    const other = await asService((client) => client.query(
      "SELECT public.book_advisor_session_read($1, $2) AS ids",
      [session, hashB]
    ).then((result) => result.rows[0].ids));
    assert.deepEqual(own.map(Number).sort(), [701, 718]);
    assert.deepEqual(other, []);

    await apply(admin, "STAGE_BOOK_ADVISOR_SPEND_ROLLBACK.sql");
    const gone = await admin.query(`
      SELECT count(*)::int AS n
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname LIKE '%book_advisor%'
    `);
    assert.equal(gone.rows[0].n, 0);
    await apply(admin, "STAGE_BOOK_ADVISOR_SPEND.sql");
    const again = await reserve(hashA, 1);
    assert.match(again, /^[0-9a-f-]{36}$/i);
    console.log("book-advisor-ledger-tests ok");
  } finally {
    await admin.end();
    await pg.stop();
    fs.rmSync(databaseDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
