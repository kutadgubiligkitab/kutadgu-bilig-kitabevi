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

const openClients = new Set();

function spawnExit(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code == null ? 1 : code));
  });
}

async function connect() {
  const client = new Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    password: "budget-test",
    database: "budget",
    statement_timeout: 5000,
    query_timeout: 5000,
    connectionTimeoutMillis: 5000
  });
  await client.connect();
  openClients.add(client);
  return client;
}

async function closeClient(client) {
  if (!client || !openClients.has(client)) return;
  openClients.delete(client);
  try { await client.end(); } catch (error) {}
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
  await closeClient(setup);

  async function resetLedger(remaining, callsToday) {
    const admin = await connect();
    await admin.query(
      "UPDATE private.ai_search_query_budget SET remaining_micro_usd = $1, calls_today = $2, day_utc = (timezone('utc', now()))::date",
      [remaining, callsToday]
    );
    await admin.query("DELETE FROM private.ai_search_ip_windows");
    await closeClient(admin);
  }

  async function ledgerState(hash) {
    const reader = await connect();
    const budget = await reader.query(
      "SELECT remaining_micro_usd, calls_today FROM private.ai_search_query_budget"
    );
    const window = await reader.query(
      "SELECT calls FROM private.ai_search_ip_windows WHERE ip_hash = $1",
      [hash]
    );
    await closeClient(reader);
    return {
      remaining: Number(budget.rows[0].remaining_micro_usd),
      callsToday: Number(budget.rows[0].calls_today),
      ipCalls: window.rows[0] ? Number(window.rows[0].calls) : 0
    };
  }

  async function blockedReservation(hash) {
    const holder = await connect();
    const waiter = await connect();
    const observer = await connect();
    try {
      const holderPid = Number((await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      const waiterPid = Number((await waiter.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      assert.notEqual(holderPid, waiterPid);
      await holder.query("BEGIN");
      await holder.query("SELECT singleton FROM private.ai_search_query_budget WHERE singleton FOR UPDATE");
      let settled = false;
      let waiterError = null;
      let decision = null;
      const pending = waiter.query(
        "SELECT allowed, remaining_micro_usd FROM public.reserve_ai_search_paid_call($1)",
        [hash]
      ).then((result) => {
        settled = true;
        decision = result.rows[0];
      }).catch((error) => {
        settled = true;
        waiterError = error;
      });
      const started = Date.now();
      let waiting = false;
      while (Date.now() - started < 2000 && !settled) {
        const locks = await observer.query(
          "SELECT count(*)::int AS n FROM pg_locks WHERE pid = $1 AND NOT granted",
          [waiterPid]
        );
        if (Number(locks.rows[0].n) > 0) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      assert.equal(waiting, true, "competing reservation was not observed waiting on the budget lock");
      assert.equal(settled, false);
      await holder.query("COMMIT");
      await pending;
      if (waiterError) throw waiterError;
      return { allowed: decision.allowed === true, remaining: Number(decision.remaining_micro_usd) };
    } finally {
      try { await holder.query("ROLLBACK"); } catch (error) {}
      await closeClient(holder);
      await closeClient(waiter);
      await closeClient(observer);
    }
  }

  await resetLedger(100, 0);
  const finalDecision = await blockedReservation("11".repeat(16));
  assert.equal(finalDecision.allowed, true);
  assert.equal(finalDecision.remaining, 0);
  const finalLedger = await ledgerState("11".repeat(16));
  assert.deepEqual(finalLedger, { remaining: 0, callsToday: 1, ipCalls: 1 });

  await resetLedger(1000000, 0);
  const first = await connect();
  const second = await connect();
  const firstPid = Number((await first.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
  const secondPid = Number((await second.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
  assert.notEqual(firstPid, secondPid);
  const differentA = await first.query("SELECT allowed FROM public.reserve_ai_search_paid_call($1)", ["22".repeat(16)]);
  const differentB = await second.query("SELECT allowed FROM public.reserve_ai_search_paid_call($1)", ["33".repeat(16)]);
  assert.equal(differentA.rows[0].allowed, true);
  assert.equal(differentB.rows[0].allowed, true);
  await closeClient(first);
  await closeClient(second);
  const differentLedger = await ledgerState("22".repeat(16));
  assert.equal(differentLedger.remaining, 999800);
  assert.equal(differentLedger.callsToday, 2);
  assert.equal(differentLedger.ipCalls, 1);
  assert.equal((await ledgerState("33".repeat(16))).ipCalls, 1);

  await resetLedger(1000000, 200);
  const dailyDecision = await blockedReservation("44".repeat(16));
  assert.equal(dailyDecision.allowed, false);
  const dailyLedger = await ledgerState("44".repeat(16));
  assert.deepEqual(dailyLedger, { remaining: 1000000, callsToday: 200, ipCalls: 0 });

  await resetLedger(1000000, 0);
  const ipSeed = await connect();
  await ipSeed.query(
    "INSERT INTO private.ai_search_ip_windows (ip_hash, window_start, calls) VALUES ($1, now(), 5)",
    ["66".repeat(16)]
  );
  await closeClient(ipSeed);
  const ipDecision = await blockedReservation("66".repeat(16));
  assert.equal(ipDecision.allowed, false);
  const ipLedger = await ledgerState("66".repeat(16));
  assert.deepEqual(ipLedger, { remaining: 1000000, callsToday: 0, ipCalls: 5 });

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
  await closeClient(poor);
  console.log("ai-search-stage2-budget-concurrency-tests ok");
} catch (error) {
  console.error("FAIL", error && error.stack || error && error.message);
  process.exitCode = 1;
} finally {
  for (const client of [...openClients]) await closeClient(client);
  const removed = await spawnExit("docker", ["rm", "-f", name]);
  const inspect = await spawnExit("docker", ["inspect", name]);
  if (inspect === 0) {
    console.error("FAIL container", name, "was still present after cleanup");
    process.exitCode = 1;
  } else if (removed !== 0 && removed !== 1) {
    console.error("FAIL docker rm exited", removed);
    process.exitCode = 1;
  }
}
