#!/usr/bin/env node
"use strict";

// Applies STAGE112 on a throwaway Postgres database. Does not open the live project.

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.join(__dirname, "..");
const MEMBER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBER_EMPTY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ADMIN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
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
    insert into auth.users (id) values ('${MEMBER_A}'), ('${MEMBER_B}'), ('${MEMBER_EMPTY}'), ('${ADMIN}')
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
    create or replace function public.is_kutadgu_admin()
    returns boolean language sql stable security definer set search_path = public
    as $$ select exists (select 1 from public.admin_users where user_id = auth.uid()); $$;
    revoke all on function public.is_kutadgu_admin() from public, anon;
    grant execute on function public.is_kutadgu_admin() to authenticated;
    create table if not exists public.profiles (
      id uuid primary key references auth.users(id) on delete cascade,
      status text not null default 'active'
    );
    insert into public.profiles (id, status) values
      ('${MEMBER_A}', 'active'), ('${MEMBER_B}', 'active'), ('${MEMBER_EMPTY}', 'active'), ('${ADMIN}', 'active')
    on conflict (id) do nothing;
    create or replace function public.is_member_active()
    returns boolean language sql stable security definer set search_path = public
    as $$ select exists (select 1 from public.profiles where id = auth.uid() and status = 'active'); $$;
    revoke all on function public.is_member_active() from public, anon;
    grant execute on function public.is_member_active() to authenticated;
    create table if not exists public.books (
      id bigint generated always as identity primary key,
      title text not null,
      is_active boolean not null default true
    );
    alter table public.books enable row level security;
    alter table public.books force row level security;
    drop policy if exists "public reads active books" on public.books;
    create policy "public reads active books" on public.books for select to anon, authenticated using (is_active = true);
    grant select on table public.books to anon, authenticated;
    create table if not exists public.member_cart_items (
      user_id uuid not null references auth.users(id) on delete cascade,
      book_id text not null,
      quantity integer not null default 1 check (quantity between 1 and 99),
      updated_at timestamptz not null default now(),
      primary key (user_id, book_id)
    );
    alter table public.member_cart_items enable row level security;
    alter table public.member_cart_items force row level security;
    drop policy if exists "cart owner access" on public.member_cart_items;
    create policy "cart owner access" on public.member_cart_items for all to authenticated
      using (user_id = auth.uid() and public.is_member_active())
      with check (user_id = auth.uid() and public.is_member_active());
    grant select, insert, update, delete on public.member_cart_items to authenticated;
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

async function snapshotCart(client) {
  const rows = await client.query("select user_id::text, book_id, quantity from public.member_cart_items order by user_id, book_id");
  return JSON.stringify(rows.rows);
}

async function main() {
  const base = "/tmp/stage107-pg/node_modules";
  const pg = require(path.join(base, "pg"));
  const embedded = await import(pathToFileURL(path.join(base, "embedded-postgres", "dist", "index.js")).href);
  const EmbeddedPostgres = embedded.default;
  const dir = path.join("/tmp", "stage112-pg-data-" + Date.now());
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port: 55462,
    persistent: false,
    initdbFlags: ["--locale=C", "--encoding=UTF8"],
    onLog() {},
    onError(error) { console.error(error); }
  });
  let client;
  try {
    await server.initialise();
    await server.start();
    await server.createDatabase("stage112");
    client = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:55462/stage112" });
    await client.connect();
    await client.query("create extension if not exists pgcrypto");
    await client.query("do $$ begin create role anon nologin; exception when duplicate_object then null; end $$");
    await client.query("do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$");
    await client.query("grant anon to postgres");
    await client.query("grant authenticated to postgres");
    await client.query("grant usage on schema public to anon, authenticated");
    await client.query(fixtureSql());

    const active = await client.query("insert into public.books (title, is_active) values ('كۇتادغۇ بىلىگ', true) returning id");
    const inactive = await client.query("insert into public.books (title, is_active) values ('يوشۇرۇن كىتاب', false) returning id");
    const blank = await client.query("insert into public.books (title, is_active) values ('', true) returning id");
    const activeId = String(active.rows[0].id);
    const inactiveId = String(inactive.rows[0].id);
    const blankId = String(blank.rows[0].id);
    await client.query(
      "insert into public.member_cart_items (user_id, book_id, quantity) values ($1, $2, 2), ($1, $3, 5), ($1, $4, 4), ($1, 'missing-book', 9), ($5, $2, 7)",
      [MEMBER_A, activeId, inactiveId, blankId, MEMBER_B]
    );
    for (let i = 1; i <= 101; i += 1) {
      await client.query(
        "insert into public.member_cart_items (user_id, book_id, quantity) values ($1, $2, $3)",
        [MEMBER_EMPTY, "p" + String(i).padStart(4, "0"), (i % 9) + 1]
      );
    }
    const before = await snapshotCart(client);
    await client.query(readSql("STAGE112_ADMIN_MEMBER_CART.sql"));
    await client.query(readSql("STAGE112_ADMIN_MEMBER_CART.sql"));

    const def = await client.query(
      "select prosecdef, provolatile, proconfig::text as config from pg_proc where proname = 'admin_member_cart_page'"
    );
    check("function is security definer, stable, and pins search_path", def.rows[0] && def.rows[0].prosecdef === true && def.rows[0].provolatile === "s" && /search_path=public/.test(def.rows[0].config || ""));
    const acl = await client.query("select proacl::text as acl from pg_proc where proname = 'admin_member_cart_page'");
    check("execute is granted to authenticated and not anon", /authenticated=X/.test(acl.rows[0].acl) && !/=X\/[^\s]*anon/.test(acl.rows[0].acl) && !/anon=X/.test(acl.rows[0].acl), acl.rows[0].acl);
    const policies = await client.query("select polname from pg_policy where polrelid = 'public.member_cart_items'::regclass order by polname");
    check("cart policies stay the owner policy", policies.rows.length === 1 && policies.rows[0].polname === "cart owner access", JSON.stringify(policies.rows));

    const own = await asRole(client, "authenticated", MEMBER_A, "aal1", () =>
      client.query("select book_id, quantity from public.member_cart_items order by book_id")
    );
    check("member still reads only their own cart", own.rows.length === 4 && own.rows.every((row) => true), String(own.rows.length));
    const other = await asRole(client, "authenticated", MEMBER_A, "aal1", () =>
      client.query("select book_id from public.member_cart_items where user_id = $1", [MEMBER_B])
    );
    check("member cannot read another member through the table", other.rows.length === 0);

    await expectError("anonymous cannot execute the cart read", () => asRole(client, "anon", null, "aal1", () =>
      client.query("select * from public.admin_member_cart_page($1, null)", [MEMBER_A])
    ), /permission denied/i);
    await expectError("anonymous cannot select the cart table", () => asRole(client, "anon", null, "aal1", () =>
      client.query("select * from public.member_cart_items")
    ), /permission denied/i);
    await expectError("ordinary member cannot execute the cart read", () => asRole(client, "authenticated", MEMBER_A, "aal2", () =>
      client.query("select * from public.admin_member_cart_page($1, null)", [MEMBER_B])
    ), /42501|Admin permission required/i);
    await expectError("admin AAL1 cannot execute the cart read", () => asRole(client, "authenticated", ADMIN, "aal1", () =>
      client.query("select * from public.admin_member_cart_page($1, null)", [MEMBER_A])
    ), /42501|Admin permission required/i);
    await expectError("a null member is rejected", () => asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select * from public.admin_member_cart_page(null, null)")
    ), /22023|Member required/i);

    const adminTable = await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select book_id from public.member_cart_items")
    );
    check("admin AAL2 still cannot read the cart table directly", adminTable.rows.length === 0);
    const updated = await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("update public.member_cart_items set quantity = 99 where user_id = $1", [MEMBER_A])
    );
    check("admin AAL2 cannot update another member's cart", updated.rowCount === 0);

    const page = await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select book_id, quantity, title from public.admin_member_cart_page($1, null) order by book_id", [MEMBER_A])
    );
    const byId = new Map(page.rows.map((row) => [row.book_id, row]));
    check("admin AAL2 reads the saved quantity and active title", byId.get(activeId) && byId.get(activeId).quantity === 2 && byId.get(activeId).title === "كۇتادغۇ بىلىگ");
    check("admin AAL2 reads an inactive book's title", byId.get(inactiveId) && byId.get(inactiveId).quantity === 5 && byId.get(inactiveId).title === "يوشۇرۇن كىتاب");
    check("a blank title is returned blank and keeps its quantity", byId.get(blankId) && byId.get(blankId).quantity === 4 && byId.get(blankId).title === "");
    check("a missing book keeps the quantity and a null title", byId.get("missing-book") && byId.get("missing-book").quantity === 9 && byId.get("missing-book").title === null);
    check("the first page does not include the other member", page.rows.length === 4);

    const first = await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select book_id, quantity from public.admin_member_cart_page($1, null)", [MEMBER_EMPTY])
    );
    const second = await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select book_id, quantity from public.admin_member_cart_page($1, $2)", [MEMBER_EMPTY, first.rows[first.rows.length - 1].book_id])
    );
    check("the first cart page is 100 rows in book_id order", first.rows.length === 100 && first.rows[0].book_id === "p0001" && first.rows[99].book_id === "p0100");
    check("the next page returns the remaining row", second.rows.length === 1 && second.rows[0].book_id === "p0101" && second.rows[0].quantity === (101 % 9) + 1);
    const empty = await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select book_id from public.admin_member_cart_page($1, null)", [ADMIN])
    );
    check("a member with no rows returns an empty page", empty.rows.length === 0);

    const after = await snapshotCart(client);
    check("admin reads do not change saved cart rows", before === after);

    await client.query(readSql("STAGE112_ADMIN_MEMBER_CART_ROLLBACK.sql"));
    const gone = await client.query("select proname from pg_proc where proname = 'admin_member_cart_page'");
    check("rollback drops the read function", gone.rows.length === 0);
    const stillOwn = await asRole(client, "authenticated", MEMBER_B, "aal1", () =>
      client.query("select quantity from public.member_cart_items")
    );
    check("rollback keeps the member's own cart read", stillOwn.rows.length === 1 && stillOwn.rows[0].quantity === 7);
    await expectError("rollback removes admin execute", () => asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select * from public.admin_member_cart_page($1, null)", [MEMBER_A])
    ), /does not exist|admin_member_cart_page/i);
    await client.query(readSql("STAGE112_ADMIN_MEMBER_CART.sql"));
    const restored = await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select quantity from public.admin_member_cart_page($1, null) where book_id = $2", [MEMBER_B, activeId])
    );
    check("reapplying the migration restores the admin read", restored.rows.length === 1 && restored.rows[0].quantity === 7);
    const finalRows = await snapshotCart(client);
    check("rollback and reapply do not change saved cart rows", finalRows === before);
  } finally {
    if (client) await client.end().catch(() => {});
    await server.stop().catch(() => {});
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("stage112 isolated verify ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
