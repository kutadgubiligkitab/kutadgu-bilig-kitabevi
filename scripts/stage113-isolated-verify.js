#!/usr/bin/env node
"use strict";

// Applies STAGE113 on a throwaway Postgres database. Does not open the live project.

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.join(__dirname, "..");
const ADMIN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MEMBER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const failures = [];

function check(name, ok, detail) {
  if (!ok) failures.push(name + (detail ? ": " + detail : ""));
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " — " + detail : ""));
}

function readSql(name) {
  return fs.readFileSync(path.join(root, name), "utf8");
}

function fixtureSql() {
  return `
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
    create or replace function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
    $$;
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(auth.jwt()->>'sub', '')::uuid;
    $$;
    create table if not exists public.admin_users (
      user_id uuid primary key references auth.users(id) on delete cascade
    );
    create or replace function public.is_kutadgu_admin()
    returns boolean language sql stable security definer set search_path = public
    as $$ select exists (select 1 from public.admin_users where user_id = auth.uid()); $$;
    revoke all on function public.is_kutadgu_admin() from public, anon;
    grant execute on function public.is_kutadgu_admin() to authenticated;
    create table if not exists public.profiles (
      id uuid primary key references auth.users(id) on delete cascade,
      email text not null default '',
      full_name text not null default '',
      phone text not null default '',
      country text not null default '',
      city text not null default '',
      address text not null default '',
      status text not null default 'active',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      last_login_at timestamptz,
      last_seen_at timestamptz,
      visit_count bigint not null default 0,
      last_page text not null default ''
    );
    create table if not exists public.member_cart_items (
      user_id uuid not null references auth.users(id) on delete cascade,
      book_id text not null,
      quantity integer not null default 1 check (quantity between 1 and 99),
      updated_at timestamptz not null default now(),
      primary key (user_id, book_id)
    );
    create table if not exists public.orders (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users(id) on delete cascade,
      status text not null,
      total numeric(12,2) not null default 0
    );
    alter table public.profiles enable row level security;
    alter table public.profiles force row level security;
    alter table public.member_cart_items enable row level security;
    alter table public.member_cart_items force row level security;
    alter table public.orders enable row level security;
    alter table public.orders force row level security;
    drop policy if exists "own profile" on public.profiles;
    create policy "own profile" on public.profiles for select to authenticated using (id = auth.uid());
    drop policy if exists "cart owner access" on public.member_cart_items;
    create policy "cart owner access" on public.member_cart_items for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
    drop policy if exists "own orders" on public.orders;
    create policy "own orders" on public.orders for select to authenticated using (user_id = auth.uid());
    grant select on public.profiles to authenticated;
    grant select, insert, update, delete on public.member_cart_items to authenticated;
    grant select on public.orders to authenticated;
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
    const message = String(error && error.message || error);
    check(name, pattern.test(message), message);
  }
}

async function main() {
  const base = "/tmp/stage107-pg/node_modules";
  const pg = require(path.join(base, "pg"));
  const embedded = await import(pathToFileURL(path.join(base, "embedded-postgres", "dist", "index.js")).href);
  const EmbeddedPostgres = embedded.default;
  const dir = path.join("/tmp", "stage113-pg-data-" + Date.now());
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port: 55463,
    persistent: false,
    initdbFlags: ["--locale=C", "--encoding=UTF8"],
    onLog() {},
    onError(error) { console.error(error); }
  });
  let client;
  try {
    await server.initialise();
    await server.start();
    await server.createDatabase("stage113");
    client = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:55463/stage113" });
    await client.connect();
    await client.query("create extension if not exists pgcrypto");
    await client.query("do $$ begin create role anon nologin; exception when duplicate_object then null; end $$");
    await client.query("do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$");
    await client.query("grant anon to postgres");
    await client.query("grant authenticated to postgres");
    await client.query("grant usage on schema public to anon, authenticated");
    await client.query(fixtureSql());
    await client.query(
      `insert into auth.users (id)
       select ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid
       from generate_series(1, 1100) s(i)`
    );
    await client.query("insert into auth.users (id) values ($1), ($2) on conflict (id) do nothing", [ADMIN, MEMBER]);
    await client.query("insert into public.admin_users (user_id) values ($1)", [ADMIN]);
    await client.query(
      `insert into public.profiles (id, email, full_name, phone, country, city, status, created_at, visit_count, last_page)
       select ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
              case when i = 1 then 'find-me_%@example.com' else 'member' || i::text || '@example.com' end,
              case
                when i = 1 then 'ئىزدەش نىشانى'
                when i = 4 then 'توختىتىلغان_%'
                else 'ئەزا ' || i::text
              end,
              case when i = 4 then '555_%' else '900' || i::text end,
              'تۈركىيە',
              case when i = 2 then 'ئىستانبۇل' else 'ئانكارا' end,
              case when i = 4 or i = 5 then 'suspended' else 'active' end,
              timestamp '2024-01-01' + (((i + 1) / 2) || ' seconds')::interval,
              i,
              '/book/' || i::text
       from generate_series(1, 1100) s(i)`
    );
    await client.query(
      "insert into public.profiles (id, email, full_name, status, visit_count) values ($1, 'admin@example.com', 'باشقۇرغۇچى', 'active', 999)",
      [ADMIN]
    );
    const cartMember = "00000000-0000-4000-8000-000000000002";
    const suspendedCart = "00000000-0000-4000-8000-000000000004";
    await client.query(
      "insert into public.member_cart_items (user_id, book_id, quantity) values ($1, 'a', 1), ($1, 'b', 2), ($1, 'c', 3), ($2, 'a', 4)",
      [cartMember, suspendedCart]
    );
    await client.query(
      "insert into public.orders (user_id, status, total) values ($1, 'confirmed', 12.50), ($1, 'prepared', 99), ($1, ' cancelled ', 5), ($2, 'COMPLETED', 3)",
      [cartMember, suspendedCart]
    );
    const beforeCart = await client.query("select user_id::text, book_id, quantity from public.member_cart_items order by 1, 2");
    const beforeGrants = await client.query(
      "select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'member_cart_items' order by 1, 2"
    );
    await client.query(readSql("STAGE113_ADMIN_MEMBER_DIRECTORY.sql"));
    await client.query(readSql("STAGE113_ADMIN_MEMBER_DIRECTORY.sql"));

    const def = await client.query(
      "select prosecdef, provolatile, proconfig::text as config from pg_proc where proname = 'admin_member_directory_page'"
    );
    check("function is security definer, stable, and pins search_path", def.rows[0] && def.rows[0].prosecdef === true && def.rows[0].provolatile === "s" && /search_path=public/.test(def.rows[0].config || ""));
    const acl = await client.query("select proacl::text as acl from pg_proc where proname = 'admin_member_directory_page'");
    check("execute is granted to authenticated and not anon", /authenticated=X/.test(acl.rows[0].acl) && !/anon=X/.test(acl.rows[0].acl), acl.rows[0].acl);

    await expectError("anonymous execute is denied", () => asRole(client, "anon", null, "aal2", () => client.query(
      "select public.admin_member_directory_page('', 'all', 'all', 0)"
    )), /permission denied|42501/i);
    await expectError("ordinary member is denied", () => asRole(client, "authenticated", MEMBER, "aal2", () => client.query(
      "select public.admin_member_directory_page('', 'all', 'all', 0)"
    )), /Admin permission required|42501/i);
    await expectError("admin AAL1 is denied", () => asRole(client, "authenticated", ADMIN, "aal1", () => client.query(
      "select public.admin_member_directory_page('', 'all', 'all', 0)"
    )), /Admin permission required|42501/i);
    await expectError("a bad filter is rejected", () => asRole(client, "authenticated", ADMIN, "aal2", () => client.query(
      "select public.admin_member_directory_page('', 'nope', 'all', 0)"
    )), /Invalid member filter|22023/i);

    const first = await asRole(client, "authenticated", ADMIN, "aal2", () => client.query(
      "select public.admin_member_directory_page('', 'all', 'all', 0) as payload"
    ));
    const page0 = first.rows[0].payload;
    check("first page has 20 rows and the full count", page0.rows.length === 20 && page0.total === 1100 && page0.page_size === 20, JSON.stringify({ total: page0.total, rows: page0.rows.length }));
    check("global stats ignore the admin row and uncounted orders", page0.stats.members === 1100 && Number(page0.stats.visits) === (1100 * 1101) / 2 && page0.stats.orders === 2 && Number(page0.stats.revenue) === 15.5, JSON.stringify(page0.stats));
    const ids = page0.rows.map((row) => row.id);
    check("page rows are unique", new Set(ids).size === ids.length);
    check("newest duplicate timestamp sorts by id descending", page0.rows[0].id > page0.rows[1].id && String(page0.rows[0].created_at) === String(page0.rows[1].created_at));
    check("the first page does not repeat a member who has several cart rows", !page0.rows.some((row) => row.id === cartMember));

    const last = await asRole(client, "authenticated", ADMIN, "aal2", () => client.query(
      "select public.admin_member_directory_page('', 'all', 'all', 55) as payload"
    ));
    const lastPage = last.rows[0].payload;
    check("the last page is the remaining members", lastPage.total === 1100 && lastPage.rows.length === 0);
    const realLast = await asRole(client, "authenticated", ADMIN, "aal2", () => client.query(
      "select public.admin_member_directory_page('', 'all', 'all', 54) as payload"
    ));
    const oldest = realLast.rows[0].payload;
    check("member 1 is on the last page, past the first thousand", oldest.rows.some((row) => row.email === "find-me_%@example.com") && oldest.rows.length === 20, String(oldest.rows.length));

    const found = await asRole(client, "authenticated", ADMIN, "aal2", () => client.query(
      "select public.admin_member_directory_page($1, 'all', 'all', 0) as payload",
      ["ئىزدەش"]
    ));
    check("Uyghur search finds the member beyond the first page", found.rows[0].payload.total === 1 && found.rows[0].payload.rows[0].email === "find-me_%@example.com");
    const literal = await asRole(client, "authenticated", ADMIN, "aal2", () => client.query(
      "select public.admin_member_directory_page('%', 'all', 'all', 0) as payload"
    ));
    const literalEmails = literal.rows[0].payload.rows.map((row) => row.email).sort();
    check("a percent sign is literal search text", literal.rows[0].payload.total === 2 && literalEmails.join(",") === "find-me_%@example.com,member4@example.com", JSON.stringify(literalEmails));
    const underscore = await asRole(client, "authenticated", ADMIN, "aal2", () => client.query(
      "select public.admin_member_directory_page('_%', 'all', 'all', 0) as payload"
    ));
    const underscoreEmails = underscore.rows[0].payload.rows.map((row) => row.email).sort();
    check("underscore stays literal and keeps character order", underscore.rows[0].payload.total === 2 && underscoreEmails.join(",") === "find-me_%@example.com,member4@example.com", JSON.stringify(underscoreEmails));
    const reversed = await asRole(client, "authenticated", ADMIN, "aal2", () => client.query(
      "select public.admin_member_directory_page('%_', 'all', 'all', 0) as payload"
    ));
    check("the reversed wildcard sequence matches no member", reversed.rows[0].payload.total === 0 && reversed.rows[0].payload.rows.length === 0);

    const carts = await asRole(client, "authenticated", ADMIN, "aal2", () => client.query(
      "select public.admin_member_directory_page('', 'all', 'with_items', 0) as payload"
    ));
    check("cart filter returns only members with saved rows", carts.rows[0].payload.total === 2 && carts.rows[0].payload.stats.members === 1100);
    const suspended = await asRole(client, "authenticated", ADMIN, "aal2", () => client.query(
      "select public.admin_member_directory_page('', 'suspended', 'with_items', 0) as payload"
    ));
    check("status and cart filters combine before pagination", suspended.rows[0].payload.total === 1 && suspended.rows[0].payload.rows[0].phone === "555_%");
    const normal = await asRole(client, "authenticated", ADMIN, "aal2", () => client.query(
      "select public.admin_member_directory_page('', 'active', 'all', 0) as payload"
    ));
    check("normal means not suspended", normal.rows[0].payload.total === 1098 && normal.rows[0].payload.rows.every((row) => row.status !== "suspended"));
    const empty = await asRole(client, "authenticated", ADMIN, "aal2", () => client.query(
      "select public.admin_member_directory_page('يوق-بۇ-ئىسىم', 'all', 'all', 0) as payload"
    ));
    check("an unmatched search is an empty page with the same stats", empty.rows[0].payload.total === 0 && empty.rows[0].payload.rows.length === 0 && empty.rows[0].payload.stats.members === 1100);

    const city = await asRole(client, "authenticated", ADMIN, "aal2", () => client.query(
      "select public.admin_member_directory_page('ئىستانبۇل', 'all', 'all', 0) as payload"
    ));
    const cityRow = city.rows[0].payload.rows[0];
    check("city remains searchable and one member with three cart rows is counted once", city.rows[0].payload.total === 1 && cityRow.id === cartMember && cityRow.order_count === 1 && Number(cityRow.order_total) === 12.5);

    const afterCart = await client.query("select user_id::text, book_id, quantity from public.member_cart_items order by 1, 2");
    check("cart rows are unchanged", JSON.stringify(afterCart.rows) === JSON.stringify(beforeCart.rows));
    const afterGrants = await client.query(
      "select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'member_cart_items' order by 1, 2"
    );
    check("cart table grants are unchanged", JSON.stringify(afterGrants.rows) === JSON.stringify(beforeGrants.rows));
    const policies = await client.query("select polname from pg_policy where polrelid = 'public.member_cart_items'::regclass order by 1");
    check("cart policy remains the owner policy", policies.rows.length === 1 && policies.rows[0].polname === "cart owner access");

    await client.query(readSql("STAGE113_ADMIN_MEMBER_DIRECTORY_ROLLBACK.sql"));
    const gone = await client.query("select proname from pg_proc where proname = 'admin_member_directory_page'");
    check("rollback drops only the directory function", gone.rows.length === 0);
    const still = await client.query("select count(*)::int as n from public.member_cart_items");
    check("rollback leaves cart rows", still.rows[0].n === 4);
    await client.query(readSql("STAGE113_ADMIN_MEMBER_DIRECTORY.sql"));
    const restored = await asRole(client, "authenticated", ADMIN, "aal2", () => client.query(
      "select (public.admin_member_directory_page('', 'all', 'with_items', 0)->>'total')::int as total"
    ));
    check("reapply restores the admin read", restored.rows[0].total === 2);
  } finally {
    if (client) await client.end().catch(() => {});
    await server.stop().catch(() => {});
  }
  if (failures.length) {
    console.error("\n" + failures.length + " stage113 check(s) failed");
    process.exit(1);
  }
  console.log("stage113 isolated postgres: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
