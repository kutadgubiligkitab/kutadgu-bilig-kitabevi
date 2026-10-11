#!/usr/bin/env node
"use strict";

// Throwaway Postgres proof for STAGE119. Does not open the live Supabase project.

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { spawn } = require("child_process");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const MEMBER = "11111111-1111-4111-8111-111111111111";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const failures = [];

function check(name, ok, detail) {
  if (!ok) failures.push(name + (detail ? ": " + detail : ""));
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " — " + detail : ""));
}

function readSql(name) {
  return fs.readFileSync(path.join(root, name), "utf8");
}

function uuid(n) {
  return "10000000-0000-4000-8000-" + String(n).padStart(12, "0");
}

function fixtureSql() {
  return `
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
    insert into auth.users (id) values ('${MEMBER}'), ('${ADMIN}') on conflict (id) do nothing;
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
      full_name text not null default ''
    );
    insert into public.profiles (id, email, full_name) values
      ('${MEMBER}', 'member-secret@example.com', 'مەخپىيئات'),
      ('${ADMIN}', 'admin-secret@example.com', 'باشقۇرغۇچى')
    on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
    create or replace function public.is_kutadgu_admin()
    returns boolean language sql stable security definer set search_path = public
    as $$ select exists (select 1 from public.admin_users where user_id = auth.uid()); $$;
    revoke all on function public.is_kutadgu_admin() from public, anon;
    grant execute on function public.is_kutadgu_admin() to authenticated;
    create table if not exists public.books (
      id bigint generated always as identity primary key,
      title text not null,
      is_active boolean not null default true,
      submission_status text not null default 'approved'
    );
    alter table public.books enable row level security;
    alter table public.books force row level security;
    drop policy if exists "public reads active books" on public.books;
    create policy "public reads active books" on public.books for select to anon, authenticated using (is_active = true);
    grant select on table public.books to anon, authenticated;
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

async function page(client, fn, status, query, index) {
  const result = await asRole(client, "authenticated", ADMIN, "aal2", () =>
    client.query("select public." + fn + "($1, $2, $3) as payload", [status, query, index])
  );
  return result.rows[0].payload;
}

function assertPage(name, payload, total, index, length) {
  const rows = payload && payload.rows;
  const ok = payload && payload.total === total && payload.page === index && Array.isArray(rows) && rows.length === length;
  check(name, ok, JSON.stringify({ total: payload && payload.total, page: payload && payload.page, length: rows && rows.length }));
  if (payload) {
    const blob = JSON.stringify(payload);
    check(name + " hides private fields", !/user_id|member-secret|admin-secret|مەخپىيئات/.test(blob), blob.slice(0, 180));
  }
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
  const port = 3019;
  const conf = "/tmp/stage119-postgrest.conf";
  const log = "/tmp/stage119-postgrest.log";
  fs.writeFileSync(conf, [
    'db-uri = "postgres://authenticator:postgrest-local@127.0.0.1:55479/' + dbName + '"',
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
    check("PostgREST 14.5 starts", false, Buffer.concat(chunks).toString("utf8").slice(-500));
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
    const text = await response.text();
    return { status: response.status, text: text };
  }
  const admin = jwt({ role: "authenticated", aal: "aal2", sub: ADMIN });
  const anon = await rpc("admin_book_review_page", { p_status: "pending", p_query: "", p_page: 0 }, jwt({ role: "anon" }));
  check("PostgREST anon cannot page reviews", anon.status !== 200, String(anon.status));
  const member = await rpc("admin_book_review_page", { p_status: "pending", p_query: "", p_page: 0 }, jwt({ role: "authenticated", aal: "aal2", sub: MEMBER }));
  check("PostgREST member cannot page reviews", member.status !== 200, String(member.status) + " " + member.text.slice(0, 120));
  const aal1 = await rpc("admin_book_review_page", { p_status: "pending", p_query: "", p_page: 0 }, jwt({ role: "authenticated", aal: "aal1", sub: ADMIN }));
  check("PostgREST admin AAL1 cannot page reviews", aal1.status !== 200, String(aal1.status));
  const helper = await rpc("admin_review_search_pattern", { p_query: "ئالما" }, admin);
  check("PostgREST does not expose the search helper", helper.status !== 200, String(helper.status));
  const ok = await rpc("admin_book_review_page", { p_status: "pending", p_query: "", p_page: 0 }, admin);
  let parsed = null;
  try { parsed = JSON.parse(ok.text); } catch (error) { parsed = null; }
  if (parsed && typeof parsed === "string") parsed = JSON.parse(parsed);
  check("PostgREST admin AAL2 page returns the exact total", ok.status === 200 && parsed && parsed.total === 100 && parsed.page === 0 && parsed.rows.length === 10, ok.status + " " + ok.text.slice(0, 180));
  const literal = await rpc("admin_book_review_page", { p_status: "pending", p_query: "_", p_page: 0 }, admin);
  let literalPage = null;
  try { literalPage = JSON.parse(literal.text); } catch (error) { literalPage = null; }
  if (literalPage && typeof literalPage === "string") literalPage = JSON.parse(literalPage);
  check("PostgREST underscore stays literal", literal.status === 200 && literalPage && literalPage.total === 1, literal.text.slice(0, 180));
  const oldList = await rpc("admin_list_book_reviews", { p_status: "pending", p_after: null, p_after_id: null }, admin);
  let oldRows = null;
  try { oldRows = JSON.parse(oldList.text); } catch (error) { oldRows = null; }
  check("PostgREST keeps the older 100-row list", oldList.status === 200 && Array.isArray(oldRows) && oldRows.length === 100, String(oldList.status) + " " + (oldRows && oldRows.length));
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}

async function main() {
  const base = "/tmp/stage107-pg/node_modules";
  const pg = require(path.join(base, "pg"));
  const embedded = await import(pathToFileURL(path.join(base, "embedded-postgres", "dist", "index.js")).href);
  const EmbeddedPostgres = embedded.default;
  const dir = path.join("/tmp", "stage119-pg-data-" + Date.now());
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port: 55479,
    persistent: false,
    initdbFlags: ["--locale=C", "--encoding=UTF8"],
    onLog() {},
    onError(error) { console.error(error); }
  });
  let client;
  try {
    await server.initialise();
    await server.start();
    await server.createDatabase("stage119");
    client = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:55479/stage119" });
    await client.connect();
    await client.query("create extension if not exists pgcrypto");
    await client.query("do $$ begin create role anon nologin; exception when duplicate_object then null; end $$");
    await client.query("do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$");
    await client.query("grant anon to postgres");
    await client.query("grant authenticated to postgres");
    await client.query("grant usage on schema public to anon, authenticated");
    await client.query(fixtureSql());
    for (const file of [
      "STAGE107_BOOK_REVIEWS.sql",
      "STAGE108_BOOK_REVIEW_LIMITS_DELETE.sql",
      "STAGE109_BOOK_REVIEW_HEARTS_REPLIES.sql",
      "STAGE110_BOOK_REVIEW_NOTIFICATIONS.sql",
      "STAGE111_BOOK_REVIEW_PAGES.sql",
      "STAGE119_ADMIN_REVIEW_PAGES.sql"
    ]) {
      await client.query(readSql(file));
    }
    await client.query(readSql("STAGE119_ADMIN_REVIEW_PAGES.sql"));
    check("repeat migration is safe", true);

    await client.query("alter table public.book_reviews disable trigger book_reviews_before_insert");
    await client.query("alter table public.book_review_replies disable trigger book_review_replies_before_insert");
    const bookIds = [];
    for (let n = 1; n <= 101; n += 1) {
      const title = n === 80 ? "ئالما كىتابى" : ("كىتاب " + String(n).padStart(3, "0"));
      const active = n !== 90;
      const inserted = await client.query("insert into public.books (title, is_active) values ($1, $2) returning id", [title, active]);
      bookIds.push(inserted.rows[0].id);
    }
    const stamp = "2026-01-01T00:00:00Z";
    for (let n = 1; n <= 101; n += 1) {
      let name = "ئادەتتىكى";
      if (n <= 9) name = "grp9x";
      else if (n <= 19) name = "grp10x";
      else if (n <= 30) name = "grp11x";
      else if (n <= 50) name = "grp20x";
      else if (n <= 71) name = "grp21x";
      if (n === 101) name = "100%_o'b\\ئۇ";
      const created = n <= 2 ? stamp : new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
      await client.query(
        "insert into public.book_reviews (id, book_id, user_id, display_name, body, status, created_at) values ($1, $2, $3, $4, $5, 'pending', $6)",
        [uuid(n), bookIds[n - 1], MEMBER, name, "باھا " + n, created]
      );
    }
    await client.query(
      "insert into public.book_review_replies (id, review_id, user_id, display_name, body, status, created_at) values ($1, $2, $3, $4, $5, 'pending', $6)",
      [uuid(500), uuid(1), MEMBER, "جاۋابچىئەلى", "بىر جاۋاب", stamp]
    );
    await client.query("alter table public.book_reviews enable trigger book_reviews_before_insert");
    await client.query("alter table public.book_review_replies enable trigger book_review_replies_before_insert");

    const first = await page(client, "admin_book_review_page", "pending", "", 0);
    assertPage("101 pending reviews page 0", first, 101, 0, 10);
    check("equal timestamps use id order", first.rows[0].id === uuid(1) && first.rows[1].id === uuid(2), first.rows[0].id + " " + first.rows[1].id);
    const last = await page(client, "admin_book_review_page", "pending", "", 10);
    assertPage("last page of 101", last, 101, 10, 1);
    const clamped = await page(client, "admin_book_review_page", "pending", "", 50);
    assertPage("page past the end clamps", clamped, 101, 10, 1);
    assertPage("search miss is a zero total", await page(client, "admin_book_review_page", "pending", "يوقسۆز", 0), 0, 0, 0);
    assertPage("one title match", await page(client, "admin_book_review_page", "pending", "ئالما", 3), 1, 0, 1);
    assertPage("nine author matches", await page(client, "admin_book_review_page", "pending", "grp9x", 0), 9, 0, 9);
    assertPage("ten author matches have no extra page", await page(client, "admin_book_review_page", "pending", "grp10x", 0), 10, 0, 10);
    assertPage("ten author matches clamp an extra page", await page(client, "admin_book_review_page", "pending", "grp10x", 1), 10, 0, 10);
    assertPage("eleven author matches", await page(client, "admin_book_review_page", "pending", "grp11x", 1), 11, 1, 1);
    assertPage("twenty author matches", await page(client, "admin_book_review_page", "pending", "grp20x", 1), 20, 1, 10);
    assertPage("twenty author matches clamp the empty page", await page(client, "admin_book_review_page", "pending", "grp20x", 2), 20, 1, 10);
    assertPage("twenty-one author matches", await page(client, "admin_book_review_page", "pending", "grp21x", 2), 21, 2, 1);
    const special = await page(client, "admin_book_review_page", "pending", "100%_o'b\\ئۇ", 0);
    assertPage("literal percent underscore apostrophe and backslash", special, 1, 0, 1);
    assertPage("underscore is not a wildcard", await page(client, "admin_book_review_page", "pending", "_", 0), 1, 0, 1);
    assertPage("percent is not a wildcard", await page(client, "admin_book_review_page", "pending", "%", 0), 1, 0, 1);
    assertPage("profile email is not a review search", await page(client, "admin_book_review_page", "pending", "member-secret", 0), 0, 0, 0);
    assertPage("profile full name is not a review search", await page(client, "admin_book_review_page", "pending", "مەخپىيئات", 0), 0, 0, 0);
    const inactive = await page(client, "admin_book_review_page", "pending", "كىتاب 090", 0);
    assertPage("inactive book stays in the admin page", inactive, 1, 0, 1);
    const replyHit = await page(client, "admin_book_review_reply_page", "pending", "جاۋابچىئەلى", 0);
    assertPage("reply author search", replyHit, 1, 0, 1);
    assertPage("review author does not match the reply", await page(client, "admin_book_review_reply_page", "pending", "grp9x", 0), 0, 0, 0);
    assertPage("reply search does not use the review author", await page(client, "admin_book_review_page", "pending", "جاۋابچىئەلى", 0), 0, 0, 0);
    check("blank search is the full total", (await page(client, "admin_book_review_page", "pending", "   ", 0)).total === 101);

    await expectError("search longer than 200 is rejected", () => page(client, "admin_book_review_page", "pending", "ئ".repeat(201), 0), /22023|too long/i);
    await expectError("negative page is rejected", () => page(client, "admin_book_review_page", "pending", "", -1), /22023|Invalid review page/i);
    await expectError("huge page is rejected", () => page(client, "admin_book_review_page", "pending", "", 100001), /22023|Invalid review page/i);
    await expectError("bad status is rejected", () => page(client, "admin_book_review_page", "nope", "", 0), /22023|Invalid review status/i);
    await expectError("anon cannot page", () => asRole(client, "anon", null, "aal1", () => client.query("select public.admin_book_review_page('pending', '', 0)")), /42501|permission/i);
    await expectError("member cannot page", () => asRole(client, "authenticated", MEMBER, "aal2", () => client.query("select public.admin_book_review_page('pending', '', 0)")), /42501|Admin permission/i);
    await expectError("admin AAL1 cannot page", () => asRole(client, "authenticated", ADMIN, "aal1", () => client.query("select public.admin_book_review_reply_page('pending', '', 0)")), /42501|Admin permission/i);

    const oldRows = await asRole(client, "authenticated", ADMIN, "aal2", async () => {
      const result = await client.query("select * from public.admin_list_book_reviews('pending', null, null)");
      return result.rows;
    });
    check("older list still returns 100", oldRows.length === 100, String(oldRows.length));
    const anonRead = await asRole(client, "anon", null, "aal1", async () => {
      const result = await client.query("select id from public.book_reviews");
      return result.rows;
    });
    check("anon still cannot read pending reviews", anonRead.length === 0, String(anonRead.length));
    await asRole(client, "authenticated", ADMIN, "aal2", () => client.query("select public.moderate_book_review($1, 'approved')", [uuid(80)]));
    const approved = await asRole(client, "anon", null, "aal1", async () => {
      const result = await client.query("select id from public.book_reviews where id = $1", [uuid(80)]);
      return result.rows;
    });
    check("approved active review stays publicly readable", approved.length === 1);
    const helperGrant = await client.query("select has_function_privilege('authenticated', 'public.admin_review_search_pattern(text)', 'execute') as ok");
    check("search helper is not granted to authenticated", helperGrant.rows[0].ok === false);
    const pageGrant = await client.query("select has_function_privilege('anon', 'public.admin_book_review_page(text, text, integer)', 'execute') as anon_ok, has_function_privilege('authenticated', 'public.admin_book_review_page(text, text, integer)', 'execute') as auth_ok");
    check("page execute is authenticated only", pageGrant.rows[0].anon_ok === false && pageGrant.rows[0].auth_ok === true);

    const beforeRollback = await client.query("select count(*)::int as n from public.book_reviews");
    await client.query(readSql("STAGE119_ADMIN_REVIEW_PAGES_ROLLBACK.sql"));
    const afterRollback = await client.query("select count(*)::int as n from public.book_reviews");
    const repliesLeft = await client.query("select count(*)::int as n from public.book_review_replies");
    check("rollback keeps reviews and replies", beforeRollback.rows[0].n === afterRollback.rows[0].n && repliesLeft.rows[0].n === 1, String(afterRollback.rows[0].n));
    const gone = await client.query("select to_regprocedure('public.admin_book_review_page(text, text, integer)') as fn");
    check("rollback drops the new page function", gone.rows[0].fn == null);
    const oldStill = await asRole(client, "authenticated", ADMIN, "aal2", async () => {
      const result = await client.query("select count(*)::int as n from public.admin_list_book_reviews('pending', null, null)");
      return result.rows[0].n;
    });
    check("rollback keeps the older list", oldStill === 100, String(oldStill));
    await client.query(readSql("STAGE119_ADMIN_REVIEW_PAGES.sql"));
    assertPage("reapply restores the page", await page(client, "admin_book_review_page", "pending", "", 0), 100, 0, 10);

    await client.query("do $$ begin create role authenticator login password 'postgrest-local' noinherit; exception when duplicate_object then null; end $$");
    await client.query("grant anon, authenticated to authenticator");
    await client.query("grant usage on schema public to authenticator");
    const hba = path.join(dir, "pg_hba.conf");
    if (fs.existsSync(hba)) {
      fs.writeFileSync(hba, "local all all trust\nhost all all 127.0.0.1/32 trust\nhost all all ::1/128 trust\n");
      await client.query("select pg_reload_conf()");
    }
    await postgrestProof("stage119");
  } finally {
    if (client) await client.end().catch(() => {});
    await server.stop().catch(() => {});
  }
  if (failures.length) {
    console.error(failures.length + " stage119 check(s) failed");
    process.exit(1);
  }
  console.log("stage119 isolated verify ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
