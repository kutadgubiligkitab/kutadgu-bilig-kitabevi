#!/usr/bin/env node
"use strict";

// Throwaway Postgres proof for STAGE120. Does not open the live Supabase project.

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { spawn } = require("child_process");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const MEMBER = "11111111-1111-4111-8111-111111111111";
const EMAIL_ONLY = "22222222-2222-4222-8222-222222222222";
const BLANK = "44444444-4444-4444-8444-444444444444";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const STAFF = "55555555-5555-4555-8555-555555555555";
const SUSPENDED = "66666666-6666-4666-8666-666666666666";
const NOPROFILE = "77777777-7777-4777-8777-777777777777";
const OTHER = "88888888-8888-4888-8888-888888888888";
const failures = [];
const feedbackJs = require(path.join(root, "feedback.js"));

function check(name, ok, detail) {
  if (!ok) failures.push(name + (detail ? ": " + detail : ""));
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " — " + detail : ""));
}

function readSql(name) {
  return fs.readFileSync(path.join(root, name), "utf8");
}

function uuid(n) {
  return "12000000-0000-4000-8000-" + String(n).padStart(12, "0");
}

function fixtureSql() {
  return `
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
    insert into auth.users (id) values
      ('${MEMBER}'), ('${EMAIL_ONLY}'), ('${BLANK}'), ('${ADMIN}'),
      ('${STAFF}'), ('${SUSPENDED}'), ('${NOPROFILE}'), ('${OTHER}')
    on conflict (id) do nothing;
    create or replace function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
    $$;
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(auth.jwt()->>'sub', '')::uuid;
    $$;
    create table if not exists public.admin_users (
      user_id uuid primary key references auth.users(id) on delete cascade
    );
    insert into public.admin_users (user_id) values ('${ADMIN}') on conflict (user_id) do nothing;
    create table if not exists public.profiles (
      id uuid primary key references auth.users(id) on delete cascade,
      email text not null default '',
      full_name text not null default '',
      status text not null default 'active'
    );
    insert into public.profiles (id, email, full_name, status) values
      ('${MEMBER}', 'member-secret@example.com', 'ئەزا ئىسمى', 'active'),
      ('${EMAIL_ONLY}', 'email-only-secret@example.com', '   ', 'active'),
      ('${BLANK}', '   ', '   ', 'active'),
      ('${ADMIN}', 'admin-secret@example.com', 'باشقۇرغۇچى', 'active'),
      ('${STAFF}', 'staff-secret@example.com', 'خىزمەتچى', 'active'),
      ('${SUSPENDED}', 'suspended-secret@example.com', 'توختىتىلغان', 'suspended'),
      ('${OTHER}', 'other-secret@example.com', 'باشقا ئەزا', 'active')
    on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, status = excluded.status;
    create table if not exists public.unrelated_guard (id integer primary key);
    insert into public.unrelated_guard (id) values (1) on conflict (id) do nothing;
    create or replace function public.is_kutadgu_admin()
    returns boolean language sql stable security definer set search_path = public
    as $$ select exists (select 1 from public.admin_users where user_id = auth.uid()); $$;
    revoke all on function public.is_kutadgu_admin() from public, anon;
    grant execute on function public.is_kutadgu_admin() to authenticated;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant execute on function auth.jwt() to anon, authenticated;
  `;
}

async function asRole(client, role, sub, aal, fn) {
  await client.query("begin");
  try {
    const claims = { role: role, aal: aal || "aal1" };
    if (sub) claims.sub = sub;
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await client.query("set local role " + role);
    const value = await fn();
    await client.query("commit");
    return value;
  } catch (error) {
    try { await client.query("rollback"); } catch (ignore) {}
    throw error;
  }
}

async function expectError(name, fn, pattern) {
  try {
    await fn();
    check(name, false, "completed without an error");
  } catch (error) {
    const message = String(error && (error.code + " " + error.message) || error);
    check(name, pattern.test(message), message);
  }
}

async function submit(client, role, sub, id, body) {
  const result = await asRole(client, role, sub, "aal1", () =>
    client.query("select public.submit_website_feedback($1, $2) as payload", [id, body])
  );
  return result.rows[0].payload;
}

async function page(client, sub, aal, index, before, beforeId) {
  const result = await asRole(client, "authenticated", sub, aal, () =>
    client.query("select public.admin_website_feedback_page($1, $2, $3) as payload", [index, before || null, beforeId || null])
  );
  return result.rows[0].payload;
}

function jwt(claims) {
  const secret = "01234567890123456789012345678901";
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(Object.assign({ exp: Math.floor(Date.now() / 1000) + 3600 }, claims))).toString("base64url");
  const data = header + "." + body;
  return data + "." + crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

async function postgrestProof(dbName) {
  const bin = process.env.POSTGREST_BIN || "/tmp/postgrest";
  if (!fs.existsSync(bin)) {
    check("PostgREST binary is available", false, bin);
    return;
  }
  const port = 34120;
  const conf = "/tmp/stage120-postgrest.conf";
  fs.writeFileSync(conf, [
    'db-uri = "postgres://authenticator:postgrest-local@127.0.0.1:55480/' + dbName + '"',
    'db-schemas = "public"',
    'db-anon-role = "anon"',
    'jwt-secret = "01234567890123456789012345678901"',
    "server-port = " + port
  ].join("\n"));
  const child = spawn(bin, [conf], { stdio: ["ignore", "pipe", "pipe"] });
  const chunks = [];
  child.stdout.on("data", (buf) => chunks.push(buf));
  child.stderr.on("data", (buf) => chunks.push(buf));
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const probe = await fetch("http://127.0.0.1:" + port + "/");
      if (probe.status < 500) {
        ready = true;
        break;
      }
    } catch (error) {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) {
    check("PostgREST starts for feedback", false, Buffer.concat(chunks).toString("utf8").slice(-500));
    child.kill();
    return;
  }
  async function rpc(name, body, token) {
    const headers = { Accept: "application/json", "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    const response = await fetch("http://127.0.0.1:" + port + "/rpc/" + name, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body || {})
    });
    return { status: response.status, text: await response.text() };
  }
  const service = await rpc("submit_website_feedback", { p_id: uuid(901), p_body: "service" }, jwt({ role: "service_role", sub: MEMBER }));
  check("PostgREST service_role cannot submit", service.status !== 200, String(service.status) + " " + service.text.slice(0, 160));
  const anon = await rpc("submit_website_feedback", { p_id: uuid(900), p_body: "anon" }, jwt({ role: "anon" }));
  check("PostgREST anon cannot submit", anon.status !== 200, String(anon.status));
  const memberRead = await rpc("admin_website_feedback_page", { p_page: 0 }, jwt({ role: "authenticated", aal: "aal2", sub: MEMBER }));
  check("PostgREST member cannot read feedback", memberRead.status !== 200, String(memberRead.status) + " " + memberRead.text.slice(0, 160));
  const staff = await rpc("admin_website_feedback_page", { p_page: 0 }, jwt({ role: "authenticated", aal: "aal2", sub: STAFF }));
  check("PostgREST staff cannot read feedback", staff.status !== 200, String(staff.status));
  const aal1 = await rpc("admin_website_feedback_page", { p_page: 0 }, jwt({ role: "authenticated", aal: "aal1", sub: ADMIN }));
  check("PostgREST admin AAL1 cannot read feedback", aal1.status !== 200, String(aal1.status));
  const table = await fetch("http://127.0.0.1:" + port + "/website_feedback", {
    headers: { Authorization: "Bearer " + jwt({ role: "authenticated", aal: "aal2", sub: MEMBER }), Accept: "application/json" }
  });
  check("PostgREST member cannot select the table", table.status !== 200, String(table.status));
  const ok = await rpc("admin_website_feedback_page", { p_page: 0 }, jwt({ role: "authenticated", aal: "aal2", sub: ADMIN }));
  let parsed = null;
  try { parsed = JSON.parse(ok.text); } catch (error) { parsed = null; }
  if (parsed && typeof parsed === "string") parsed = JSON.parse(parsed);
  check(
    "PostgREST admin AAL2 reads the inbox",
    ok.status === 200 && parsed && Number(parsed.total) >= 1 && Array.isArray(parsed.rows),
    ok.status + " " + ok.text.slice(0, 180)
  );
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}

async function main() {
  const base = "/tmp/stage107-pg/node_modules";
  const pg = require(path.join(base, "pg"));
  const embedded = await import(pathToFileURL(path.join(base, "embedded-postgres", "dist", "index.js")).href);
  const EmbeddedPostgres = embedded.default;
  const dir = path.join("/tmp", "stage120-pg-data-" + Date.now());
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port: 55480,
    persistent: false,
    initdbFlags: ["--locale=C", "--encoding=UTF8"],
    onLog() {},
    onError(error) { console.error(error); }
  });
  let client;
  let left;
  let right;
  try {
    await server.initialise();
    await server.start();
    await server.createDatabase("stage120");
    const connect = () => new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:55480/stage120" });
    client = connect();
    left = connect();
    right = connect();
    await client.connect();
    await left.connect();
    await right.connect();
    await client.query("do $$ begin create role anon nologin; exception when duplicate_object then null; end $$");
    await client.query("do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$");
    await client.query("do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$");
    await client.query("grant anon, authenticated, service_role to postgres");
    await client.query("grant usage on schema public to anon, authenticated, service_role");
    await client.query("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role");
    await client.query(fixtureSql());
    await client.query(readSql("STAGE120_WEBSITE_FEEDBACK.sql"));
    await client.query(readSql("STAGE120_WEBSITE_FEEDBACK.sql"));
    check("repeat migration is safe", true);

    const flags = await client.query("select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.website_feedback'::regclass");
    check("row security is enabled and forced", flags.rows[0].relrowsecurity === true && flags.rows[0].relforcerowsecurity === true);
    const grants = await client.query(`
      select
        has_table_privilege('anon', 'public.website_feedback', 'select') as anon_select,
        has_table_privilege('authenticated', 'public.website_feedback', 'select') as auth_select,
        has_table_privilege('authenticated', 'public.website_feedback', 'insert') as auth_insert,
        has_table_privilege('service_role', 'public.website_feedback', 'select') as service_select,
        has_function_privilege('public', 'public.submit_website_feedback(uuid, text)', 'execute') as public_submit,
        has_function_privilege('anon', 'public.submit_website_feedback(uuid, text)', 'execute') as anon_submit,
        has_function_privilege('authenticated', 'public.submit_website_feedback(uuid, text)', 'execute') as auth_submit,
        has_function_privilege('service_role', 'public.submit_website_feedback(uuid, text)', 'execute') as service_submit,
        has_function_privilege('public', 'public.admin_website_feedback_page(integer, timestamptz, uuid)', 'execute') as public_page,
        has_function_privilege('anon', 'public.admin_website_feedback_page(integer, timestamptz, uuid)', 'execute') as anon_page,
        has_function_privilege('authenticated', 'public.admin_website_feedback_page(integer, timestamptz, uuid)', 'execute') as auth_page,
        has_function_privilege('service_role', 'public.admin_website_feedback_page(integer, timestamptz, uuid)', 'execute') as service_page,
        has_function_privilege('public', 'public.website_feedback_normalize(text)', 'execute') as public_norm,
        has_function_privilege('anon', 'public.website_feedback_normalize(text)', 'execute') as anon_norm,
        has_function_privilege('authenticated', 'public.website_feedback_normalize(text)', 'execute') as auth_norm,
        has_function_privilege('service_role', 'public.website_feedback_normalize(text)', 'execute') as service_norm
    `);
    const grant = grants.rows[0];
    check(
      "table grants stay closed and execute is authenticated only",
      grant.anon_select === false && grant.auth_select === false && grant.auth_insert === false && grant.service_select === false &&
      grant.public_submit === false && grant.anon_submit === false && grant.auth_submit === true && grant.service_submit === false &&
      grant.public_page === false && grant.anon_page === false && grant.auth_page === true && grant.service_page === false &&
      grant.public_norm === false && grant.anon_norm === false && grant.auth_norm === false && grant.service_norm === false,
      JSON.stringify(grant)
    );
    await client.query("begin");
    try {
      await client.query("set local role service_role");
      await client.query("select public.submit_website_feedback($1, $2)", [uuid(910), "ياخشى"]);
      check("service_role cannot execute submit", false, "completed without an error");
    } catch (error) {
      check("service_role cannot execute submit", /42501|permission/i.test(String(error && error.message)), String(error && error.message));
    }
    await client.query("rollback");
    await client.query("begin");
    try {
      await client.query("set local role service_role");
      await client.query("select public.admin_website_feedback_page(0)");
      check("service_role cannot execute the inbox", false, "completed without an error");
    } catch (error) {
      check("service_role cannot execute the inbox", /42501|permission/i.test(String(error && error.message)), String(error && error.message));
    }
    await client.query("rollback");
    const published = await client.query("select count(*)::int as n from pg_publication_tables where tablename = 'website_feedback'");
    check("feedback is not in a publication", published.rows[0].n === 0, String(published.rows[0].n));

    await expectError("anon cannot submit", () => submit(client, "anon", null, uuid(1), "ياخشى"), /42501|permission/i);
    await expectError("suspended member cannot submit", () => submit(client, "authenticated", SUSPENDED, uuid(2), "ياخشى"), /42501|permission/i);
    await expectError("missing profile cannot submit", () => submit(client, "authenticated", NOPROFILE, uuid(3), "ياخشى"), /42501|permission/i);
    await expectError("blank text is rejected", () => submit(client, "authenticated", MEMBER, uuid(4), "  \n\t  "), /22023|empty|too long/i);
    await expectError("2001 characters are rejected", () => submit(client, "authenticated", MEMBER, uuid(5), "پ".repeat(2001)), /22023|too long/i);
    await expectError("null id is rejected", () => submit(client, "authenticated", MEMBER, null, "ياخشى"), /22023|id/i);

    const exact = await submit(client, "authenticated", MEMBER, uuid(6), "پ".repeat(2000));
    check("exact 2000 characters are stored", exact && exact.replayed === false && exact.id === uuid(6));
    const emoji = "😀";
    const emojiExact = await submit(client, "authenticated", MEMBER, uuid(16), emoji.repeat(2000));
    const emojiLen = await client.query("select char_length(body)::int as n, octet_length(body) as bytes from public.website_feedback where id = $1", [uuid(16)]);
    check("2000 supplementary characters are one code point each", emojiExact && emojiExact.replayed === false && emojiLen.rows[0].n === 2000 && emojiLen.rows[0].bytes === 8000, JSON.stringify(emojiLen.rows[0]));
    await expectError("2001 supplementary characters are rejected", () => submit(client, "authenticated", MEMBER, uuid(17), emoji.repeat(2001)), /22023|too long/i);
    const mixed = await submit(client, "authenticated", MEMBER, uuid(18), "پ".repeat(1999) + emoji);
    const mixedLen = await client.query("select char_length(body)::int as n from public.website_feedback where id = $1", [uuid(18)]);
    check("mixed text counts code points", mixed && mixed.replayed === false && mixedLen.rows[0].n === 2000);
    await expectError("mixed text over the code-point limit is rejected", () => submit(client, "authenticated", MEMBER, uuid(19), "پ".repeat(2000) + emoji), /22023|too long/i);
    let blankSlot = 30;
    for (const blank of ["\u000b", "\u00a0", "\u3000", "\ufeff", " \u00a0\u000b"]) {
      await expectError("unicode whitespace is empty: " + blank.codePointAt(0).toString(16), () => submit(client, "authenticated", MEMBER, uuid(blankSlot), blank), /22023|empty|too long/i);
      blankSlot += 1;
    }
    const spaced = " \u3000سەتر\nئىچكى \u00a0بوشلۇق\t";
    const spacedId = uuid(21);
    const spacedRow = await submit(client, "authenticated", MEMBER, spacedId, spaced);
    const spacedStored = await client.query("select body from public.website_feedback where id = $1", [spacedId]);
    const spacedJs = feedbackJs.normalizeBody(spaced);
    check(
      "client and server keep the same internal text",
      spacedRow && spacedStored.rows[0].body === "سەتر\nئىچكى \u00a0بوشلۇق" && spacedJs.body === spacedStored.rows[0].body,
      JSON.stringify(spacedStored.rows[0].body)
    );
    await expectError(
      "direct nbsp-only insert fails the check",
      () => client.query("insert into public.website_feedback (id, user_id, body) values ($1, $2, $3)", [uuid(22), MEMBER, "\u00a0"]),
      /23514|check/i
    );
    const markupId = uuid(7);
    const markup = "<script>alert(1)</script>";
    const storedMarkup = await submit(client, "authenticated", MEMBER, markupId, "  " + markup + "\n");
    check("markup is trimmed and stored as text", storedMarkup && storedMarkup.replayed === false);
    const markupRow = await client.query("select body, user_id from public.website_feedback where id = $1", [markupId]);
    check("stored sender is the session user and markup is unchanged", markupRow.rows[0].body === markup && markupRow.rows[0].user_id === MEMBER);

    const replay = await submit(client, "authenticated", MEMBER, markupId, "  " + markup + "\n");
    const replayCount = await client.query("select count(*)::int as n from public.website_feedback where id = $1", [markupId]);
    check("same id and body replays one row", replay && replay.replayed === true && replayCount.rows[0].n === 1);

    await expectError("same id and a different body is rejected", () => submit(client, "authenticated", MEMBER, markupId, "باشقا پىكىر"), /23505|does not match/i);
    const unchanged = await client.query("select body from public.website_feedback where id = $1", [markupId]);
    check("rejected retry does not replace the stored text", unchanged.rows[0].body === markup);

    await expectError(
      "member cannot insert a forged sender",
      () => asRole(client, "authenticated", MEMBER, "aal1", () => client.query(
        "insert into public.website_feedback (id, user_id, body) values ($1, $2, $3)",
        [uuid(8), OTHER, "ساختا"]
      )),
      /42501|permission/i
    );
    await expectError(
      "member cannot select feedback",
      () => asRole(client, "authenticated", MEMBER, "aal2", () => client.query("select id from public.website_feedback")),
      /42501|permission/i
    );
    await expectError(
      "member cannot count feedback",
      () => asRole(client, "authenticated", MEMBER, "aal2", () => client.query("select count(*) from public.website_feedback")),
      /42501|permission/i
    );
    await expectError("member cannot read the inbox", () => page(client, MEMBER, "aal2", 0), /42501|permission/i);
    await expectError("staff cannot read the inbox", () => page(client, STAFF, "aal2", 0), /42501|permission/i);
    await expectError("admin AAL1 cannot read the inbox", () => page(client, ADMIN, "aal1", 0), /42501|permission/i);
    const staffSubmit = await submit(client, "authenticated", STAFF, uuid(9), "خىزمەتچى پىكرى");
    check("staff can submit only as themselves", staffSubmit && staffSubmit.replayed === false);
    const staffRow = await client.query("select user_id from public.website_feedback where id = $1", [uuid(9)]);
    check("staff row uses the staff session", staffRow.rows[0].user_id === STAFF);

    const raceId = uuid(10);
    const raced = await Promise.all([
      submit(left, "authenticated", MEMBER, raceId, "تەكرار"),
      submit(right, "authenticated", MEMBER, raceId, "تەكرار")
    ]);
    const raceCount = await client.query("select count(*)::int as n from public.website_feedback where id = $1", [raceId]);
    check(
      "concurrent same submission stores one row",
      raceCount.rows[0].n === 1 && raced.filter((row) => row && row.id === raceId).length === 2 && raced.some((row) => row.replayed === true),
      JSON.stringify(raced.map((row) => row && row.replayed))
    );
    const mismatchId = uuid(11);
    const mismatched = await Promise.allSettled([
      submit(left, "authenticated", MEMBER, mismatchId, "بىرىنچى تەن"),
      submit(right, "authenticated", MEMBER, mismatchId, "ئىككىنچى تەن")
    ]);
    const mismatchRow = await client.query("select body, user_id from public.website_feedback where id = $1", [mismatchId]);
    check(
      "overlapping mismatched payloads keep one body",
      mismatchRow.rows.length === 1 && mismatchRow.rows[0].user_id === MEMBER &&
      mismatched.filter((item) => item.status === "fulfilled").length === 1 &&
      mismatched.filter((item) => item.status === "rejected").length === 1 &&
      /23505|does not match/i.test(String(mismatched.find((item) => item.status === "rejected").reason && mismatched.find((item) => item.status === "rejected").reason.message)),
      JSON.stringify({ body: mismatchRow.rows[0] && mismatchRow.rows[0].body, states: mismatched.map((item) => item.status) })
    );
    const senderId = uuid(12);
    const senders = await Promise.allSettled([
      submit(left, "authenticated", MEMBER, senderId, "ئوخشاش تېكىست"),
      submit(right, "authenticated", OTHER, senderId, "ئوخشاش تېكىست")
    ]);
    const senderRow = await client.query("select user_id, body from public.website_feedback where id = $1", [senderId]);
    const winner = senders.find((item) => item.status === "fulfilled");
    check(
      "overlapping different senders keep one owner",
      senderRow.rows.length === 1 && winner && senderRow.rows[0].user_id === (winner.value && winner.value.id ? senderRow.rows[0].user_id : "") &&
      (senderRow.rows[0].user_id === MEMBER || senderRow.rows[0].user_id === OTHER) &&
      senderRow.rows[0].body === "ئوخشاش تېكىست" &&
      senders.filter((item) => item.status === "rejected").length === 1,
      JSON.stringify({ owner: senderRow.rows[0] && senderRow.rows[0].user_id, states: senders.map((item) => item.status) })
    );

    await client.query("delete from public.website_feedback");
    for (let n = 1; n <= 11; n += 1) {
      const who = n === 11 ? EMAIL_ONLY : (n === 10 ? BLANK : MEMBER);
      await client.query(
        "insert into public.website_feedback (id, user_id, body, created_at) values ($1, $2, $3, $4)",
        [uuid(100 + n), who, "پىكىر " + n, new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString()]
      );
    }
    await client.query(
      "insert into public.website_feedback (id, user_id, body, created_at) values ($1, $2, $3, $4)",
      [uuid(90), MEMBER, "تەڭ ۋاقىت", "2026-01-01T00:00:00Z"]
    );
    await client.query(
      "update public.website_feedback set created_at = '2026-01-01T00:00:00Z' where id = $1",
      [uuid(101)]
    );
    const first = await page(client, ADMIN, "aal2", 0);
    check("twelve rows page 0 returns ten newest", first.total === 12 && first.page === 0 && first.rows.length === 10, JSON.stringify({ total: first.total, page: first.page, length: first.rows.length }));
    const ordered = await client.query("select id from public.website_feedback where created_at = '2026-01-01T00:00:00Z' order by created_at desc, id desc");
    check("tied rows are id descending", ordered.rows.length === 2 && ordered.rows[0].id > ordered.rows[1].id, ordered.rows.map((row) => row.id).join(" "));
    const tiedPage = [...first.rows, ...(await page(client, ADMIN, "aal2", 1)).rows].filter((row) => ordered.rows.some((item) => item.id === row.id));
    check("the page returns tied rows in that order", tiedPage.length === 2 && tiedPage[0].id === ordered.rows[0].id && tiedPage[1].id === ordered.rows[1].id, tiedPage.map((row) => row.id).join(" "));
    const second = await page(client, ADMIN, "aal2", 1);
    check("page 1 contains the older remainder", second.total === 12 && second.page === 1 && second.rows.length === 2, JSON.stringify({ total: second.total, length: second.rows.length }));
    const clamped = await page(client, ADMIN, "aal2", 9);
    check("a page past the end clamps", clamped.page === 1 && clamped.rows.length === 2, JSON.stringify(clamped.page));
    const empty = await page(client, ADMIN, "aal2", 0);
    check("rows do not include user_id", !JSON.stringify(first).includes("user_id") && !JSON.stringify(first).includes("member-secret"));
    const emailLabel = first.rows.find((row) => row.id === uuid(111)) || second.rows.find((row) => row.id === uuid(111));
    const blankLabel = [...first.rows, ...second.rows].find((row) => row.id === uuid(110));
    check("email is the label only when the name is blank", emailLabel && emailLabel.member_label === "email-only-secret@example.com", JSON.stringify(emailLabel));
    check("blank profile uses the member fallback", blankLabel && blankLabel.member_label === "ئەزا", JSON.stringify(blankLabel));
    const named = [...first.rows, ...second.rows].find((row) => row.id === uuid(105));
    check("named member label is the name", named && named.member_label === "ئەزا ئىسمى" && !JSON.stringify(named).includes("member-secret"));
    check("empty is not confused with this populated page", empty.total === 12);
    const beforeReapply = await client.query("select id, user_id, body, created_at from public.website_feedback order by id");
    await client.query(readSql("STAGE120_WEBSITE_FEEDBACK.sql"));
    const afterReapply = await client.query("select id, user_id, body, created_at from public.website_feedback order by id");
    check(
      "reapply keeps existing feedback rows unchanged",
      JSON.stringify(beforeReapply.rows) === JSON.stringify(afterReapply.rows) && beforeReapply.rows.length > 0,
      String(beforeReapply.rows.length)
    );
    await client.query("delete from public.website_feedback");
    for (let n = 1; n <= 20; n += 1) {
      const id = uuid(400 + n);
      await client.query(
        "insert into public.website_feedback (id, user_id, body, created_at) values ($1, $2, $3, $4)",
        [id, MEMBER, "بەت " + n, new Date(Date.UTC(2026, 2, 1, 0, 0, n)).toISOString()]
      );
    }
    const walked = await page(client, ADMIN, "aal2", 0);
    const page0Ids = walked.rows.map((row) => row.id);
    const newestId = uuid(421);
    await client.query(
      "insert into public.website_feedback (id, user_id, body, created_at) values ($1, $2, $3, $4)",
      [newestId, MEMBER, "يېڭى بەت", new Date(Date.UTC(2026, 2, 1, 0, 1, 0)).toISOString()]
    );
    const shifted = await page(client, ADMIN, "aal2", 1);
    const shiftedIds = shifted.rows.map((row) => row.id);
    const stable = await page(client, ADMIN, "aal2", 1, walked.bound_at, walked.bound_id);
    const stableIds = stable.rows.map((row) => row.id);
    const oldestId = uuid(401);
    check(
      "a newer row between pages duplicates and skips without a cursor",
      shiftedIds.includes(page0Ids[page0Ids.length - 1]) && !shiftedIds.includes(oldestId),
      JSON.stringify({ page0: page0Ids, shifted: shiftedIds })
    );
    check(
      "the returned cursor keeps the same walk",
      page0Ids.every((id) => !stableIds.includes(id)) && stableIds.includes(oldestId) && stable.total === 20 && !stableIds.includes(newestId),
      JSON.stringify({ stable: stableIds, total: stable.total, bound: walked.bound_id })
    );
    await client.query("delete from public.website_feedback");
    const none = await page(client, ADMIN, "aal2", 4);
    check("empty inbox is total 0 page 0", none.total === 0 && none.page === 0 && Array.isArray(none.rows) && none.rows.length === 0, JSON.stringify(none));

    const beforeDelete = await submit(client, "authenticated", OTHER, uuid(300), "ئۆچۈرۈلىدۇ");
    check("other member stored a row", beforeDelete && beforeDelete.replayed === false);
    await submit(client, "authenticated", MEMBER, uuid(301), "قالىدۇ");
    await client.query("delete from auth.users where id = $1", [OTHER]);
    const deleted = await client.query("select count(*)::int as n from public.website_feedback where id = $1", [uuid(300)]);
    const kept = await client.query("select count(*)::int as n from public.website_feedback where id = $1", [uuid(301)]);
    check("deleting the account removes that member's feedback only", deleted.rows[0].n === 0 && kept.rows[0].n === 1);

    const profilesBefore = await client.query("select count(*)::int as n from public.profiles");
    const guardBefore = await client.query("select count(*)::int as n from public.unrelated_guard");
    await client.query(readSql("STAGE120_WEBSITE_FEEDBACK_ROLLBACK.sql"));
    const goneTable = await client.query("select to_regclass('public.website_feedback') as name");
    const goneFn = await client.query("select to_regprocedure('public.submit_website_feedback(uuid, text)') as submit, to_regprocedure('public.admin_website_feedback_page(integer, timestamptz, uuid)') as page, to_regprocedure('public.website_feedback_normalize(text)') as norm");
    const profilesAfter = await client.query("select count(*)::int as n from public.profiles");
    const guardAfter = await client.query("select count(*)::int as n from public.unrelated_guard");
    check("rollback drops the table and both functions", goneTable.rows[0].name == null && goneFn.rows[0].submit == null && goneFn.rows[0].page == null);
    check("rollback keeps profiles and unrelated rows", profilesAfter.rows[0].n === profilesBefore.rows[0].n && guardAfter.rows[0].n === guardBefore.rows[0].n);
    await client.query(readSql("STAGE120_WEBSITE_FEEDBACK.sql"));
    const again = await submit(client, "authenticated", MEMBER, uuid(302), "قايتا");
    check("reapply accepts a new submission", again && again.replayed === false);

    await client.query("do $$ begin create role authenticator login password 'postgrest-local' noinherit; exception when duplicate_object then null; end $$");
    await client.query("grant anon, authenticated, service_role to authenticator");
    await client.query("grant usage on schema public to authenticator");
    const hba = path.join(dir, "pg_hba.conf");
    if (fs.existsSync(hba)) {
      fs.writeFileSync(hba, "local all all trust\nhost all all 127.0.0.1/32 trust\nhost all all ::1/128 trust\n");
      await client.query("select pg_reload_conf()");
    }
    await postgrestProof("stage120");
  } finally {
    if (left) await left.end().catch(() => {});
    if (right) await right.end().catch(() => {});
    if (client) await client.end().catch(() => {});
    await server.stop().catch(() => {});
  }
  if (failures.length) {
    console.error(failures.length + " stage120 check(s) failed");
    process.exit(1);
  }
  console.log("stage120 isolated verify ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
