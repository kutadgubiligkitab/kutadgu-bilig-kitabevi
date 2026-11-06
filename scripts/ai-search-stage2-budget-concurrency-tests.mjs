#!/usr/bin/env node
// Two-connection budget test. This file does not pass unless two separate
// Postgres sessions are observed. A single PGlite session is not accepted.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url);
const sql = fs.readFileSync(new URL("STAGE_AI_SEARCH_2_QUERY_BUDGET.sql", root), "utf8");

function dockerAvailable() {
  return new Promise((resolve) => {
    const child = spawn("docker", ["info"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

if (!(await dockerAvailable())) {
  console.error("NOT RUN: Docker is not available, so two database connections were not tested.");
  process.exit(2);
}

const pgPath = process.env.TEMP + "/kutadgu-stage2-pg/node_modules/pg/lib/index.js";
if (!fs.existsSync(pgPath)) {
  console.error("NOT RUN: the local pg client is not installed at", pgPath);
  process.exit(2);
}
const importedPg = await import(pathToFileURL(pgPath).href);
const Client = importedPg.Client || (importedPg.default && importedPg.default.Client);
if (typeof Client !== "function") {
  console.error("NOT RUN: the local pg client did not provide a Client constructor.");
  process.exit(2);
}
const port = await freePort();
const name = "kutadgu-ai-budget-" + port;
const started = spawn("docker", [
  "run", "--rm", "--name", name,
  "-e", "POSTGRES_PASSWORD=budget-test",
  "-e", "POSTGRES_DB=budget",
  "-p", "127.0.0.1:" + port + ":5432",
  "postgres:16-alpine"
], { stdio: "ignore" });
started.on("error", () => {});

async function connect() {
  const client = new Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    password: "budget-test",
    database: "budget"
  });
  await client.connect();
  return client;
}

function waitForDatabase() {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - startedAt > 30000) {
        clearInterval(timer);
        reject(new Error("database did not start"));
        return;
      }
      try {
        const client = await connect();
        await client.end();
        clearInterval(timer);
        resolve();
      } catch (error) {}
    }, 500);
  });
}

try {
  await waitForDatabase();
  const setup = await connect();
  await setup.query("CREATE SCHEMA IF NOT EXISTS private");
  await setup.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  END $$`);
  await setup.query(sql);
  await setup.end();

  async function race(hashA, hashB, prepare) {
    const left = await connect();
    const right = await connect();
    if (prepare) await prepare(left);
    const calls = await Promise.all([
      left.query("SELECT allowed FROM public.reserve_ai_search_paid_call($1)", [hashA]),
      right.query("SELECT allowed FROM public.reserve_ai_search_paid_call($1)", [hashB])
    ]);
    await left.end();
    await right.end();
    return calls.map((result) => result.rows[0].allowed);
  }

  const finalHash = "11".repeat(16);
  const admin = await connect();
  await admin.query("UPDATE private.ai_search_query_budget SET remaining_micro_usd = 100, calls_today = 0");
  await admin.query("DELETE FROM private.ai_search_ip_windows");
  await admin.end();
  const finalPair = await race(finalHash, finalHash);
  assert.equal(finalPair.filter(Boolean).length, 1);

  const same = "22".repeat(16);
  const other = "33".repeat(16);
  const admin2 = await connect();
  await admin2.query("UPDATE private.ai_search_query_budget SET remaining_micro_usd = 1000000, calls_today = 0");
  await admin2.query("DELETE FROM private.ai_search_ip_windows");
  await admin2.end();
  const different = await race(same, other);
  assert.deepEqual(different, [true, true]);

  const sameAdmin = await connect();
  await sameAdmin.query("UPDATE private.ai_search_query_budget SET remaining_micro_usd = 1000000, calls_today = 0");
  await sameAdmin.query("DELETE FROM private.ai_search_ip_windows");
  await sameAdmin.end();
  const sameIdentity = await race("88".repeat(16), "88".repeat(16));
  assert.deepEqual(sameIdentity, [true, true]);

  const daily = await connect();
  await daily.query("UPDATE private.ai_search_query_budget SET remaining_micro_usd = 1000000, calls_today = 199");
  await daily.query("DELETE FROM private.ai_search_ip_windows");
  await daily.end();
  const dailyPair = await race("44".repeat(16), "55".repeat(16));
  assert.equal(dailyPair.filter(Boolean).length, 1);

  const ipAdmin = await connect();
  await ipAdmin.query("UPDATE private.ai_search_query_budget SET remaining_micro_usd = 1000000, calls_today = 0");
  await ipAdmin.query("DELETE FROM private.ai_search_ip_windows");
  await ipAdmin.query(
    "INSERT INTO private.ai_search_ip_windows (ip_hash, window_start, calls) VALUES ($1, now(), 4)",
    ["66".repeat(16)]
  );
  await ipAdmin.end();
  const ipPair = await race("66".repeat(16), "66".repeat(16));
  assert.equal(ipPair.filter(Boolean).length, 1);

  const poor = await connect();
  await poor.query("UPDATE private.ai_search_query_budget SET remaining_micro_usd = 50, calls_today = 0");
  const poorResult = await poor.query("SELECT allowed FROM public.reserve_ai_search_paid_call($1)", ["77".repeat(16)]);
  assert.equal(poorResult.rows[0].allowed, false);
  const bad = await poor.query("SELECT allowed FROM public.reserve_ai_search_paid_call($1)", ["nope"]);
  assert.equal(bad.rows[0].allowed, false);
  await poor.query("DELETE FROM private.ai_search_query_budget");
  const missing = await poor.query("SELECT allowed FROM public.reserve_ai_search_paid_call($1)", ["77".repeat(16)]);
  assert.equal(missing.rows[0].allowed, false);
  await poor.query(sql);
  const refilled = await poor.query("SELECT remaining_micro_usd FROM private.ai_search_query_budget");
  assert.equal(Number(refilled.rows[0].remaining_micro_usd), 1000000);
  await poor.query("UPDATE private.ai_search_query_budget SET remaining_micro_usd = 1234");
  await poor.query(sql);
  const kept = await poor.query("SELECT remaining_micro_usd FROM private.ai_search_query_budget");
  assert.equal(Number(kept.rows[0].remaining_micro_usd), 1234);
  await poor.end();
  console.log("ai-search-stage2-budget-concurrency-tests ok");
} catch (error) {
  console.error("FAIL", error && error.message);
  process.exitCode = 1;
} finally {
  spawn("docker", ["rm", "-f", name], { stdio: "ignore" });
}
