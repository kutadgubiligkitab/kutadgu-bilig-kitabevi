#!/usr/bin/env node
"use strict";

// Throwaway Postgres proof for gift-book offers.
// Does not open the live Supabase project and does not write production rows.

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.join(__dirname, "..");
const MEMBER = "11111111-1111-4111-8111-111111111111";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const SUSPENDED = "66666666-6666-4666-8666-666666666666";
const NOPROFILE = "77777777-7777-4777-8777-777777777777";
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
    insert into auth.users (id) values
      ('${MEMBER}'), ('${ADMIN}'), ('${SUSPENDED}'), ('${NOPROFILE}')
    on conflict (id) do nothing;
    create or replace function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
    $$;
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(auth.jwt()->>'sub', '')::uuid;
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.jwt() to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    create table if not exists public.admin_users (
      user_id uuid primary key references auth.users(id) on delete cascade
    );
    insert into public.admin_users (user_id) values ('${ADMIN}') on conflict (user_id) do nothing;
    create table if not exists public.profiles (
      id uuid primary key references auth.users(id) on delete cascade,
      email text not null default '',
      full_name text not null default '',
      status text not null default 'active' check (status in ('active','suspended'))
    );
    insert into public.profiles (id, email, full_name, status) values
      ('${MEMBER}', 'member@example.com', 'Member', 'active'),
      ('${ADMIN}', 'admin@example.com', 'Admin', 'active'),
      ('${SUSPENDED}', 'suspended@example.com', 'Suspended', 'suspended')
    on conflict (id) do update set status = excluded.status;
    create table if not exists public.books (
      id bigint generated always as identity primary key,
      title text not null,
      author text not null default '',
      price numeric,
      stock integer,
      stock_status text,
      is_active boolean not null default true,
      submission_status text not null default 'approved',
      image_url text
    );
    alter table public.books enable row level security;
    alter table public.books force row level security;
    drop policy if exists "public can read active books" on public.books;
    create policy "public can read active books" on public.books
      for select to anon, authenticated
      using (is_active = true and submission_status = 'approved');
    grant select on public.books to anon, authenticated;
    create or replace function public.is_kutadgu_admin()
    returns boolean language sql stable security definer set search_path = public
    as $$ select exists (select 1 from public.admin_users where user_id = auth.uid()); $$;
    revoke all on function public.is_kutadgu_admin() from public, anon, authenticated, service_role;
    grant execute on function public.is_kutadgu_admin() to authenticated;
    drop policy if exists "member can read own profile" on public.profiles;
    alter table public.profiles enable row level security;
    alter table public.profiles force row level security;
    create policy "member can read own profile" on public.profiles
      for select to authenticated using (id = (select auth.uid()));
    grant select on public.profiles to authenticated;
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
    check(name, pattern.test(message), message.slice(0, 220));
  }
}

async function visibleOffers(client, sub, aal) {
  const result = await asRole(client, "authenticated", sub, aal, () =>
    client.query("select book_id, enabled from public.gift_book_offers order by book_id")
  );
  return result.rows;
}

async function main() {
  const base = process.env.STAGE122_PG_MODULES || "/tmp/stage122-pg/node_modules";
  const pg = require(path.join(base, "pg"));
  const embedded = await import(pathToFileURL(path.join(base, "embedded-postgres", "dist", "index.js")).href);
  const EmbeddedPostgres = embedded.default;
  const dir = path.join("/tmp", "stage122-pg-data-" + Date.now());
  const port = Number(process.env.STAGE122_PG_PORT || 55482);
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port: port,
    persistent: false,
    initdbFlags: ["--locale=C", "--encoding=UTF8"],
    onLog() {},
    onError(error) { console.error(error); }
  });
  let client;
  try {
    await server.initialise();
    await server.start();
    await server.createDatabase("stage122");
    client = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:" + port + "/stage122" });
    await client.connect();
    await client.query("do $$ begin create role anon nologin; exception when duplicate_object then null; end $$");
    await client.query("do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$");
    await client.query("do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$");
    await client.query("grant anon, authenticated, service_role to postgres");
    await client.query("grant usage on schema public to anon, authenticated, service_role");
    await client.query(fixtureSql());
    const beforePolicy = await client.query(`
      select pg_get_expr(polqual, polrelid) as expr
      from pg_policy
      where polname = 'public can read active books'
    `);
    await client.query(readSql("STAGE122_GIFT_BOOK_OFFERS.sql"));
    await client.query(readSql("STAGE122_GIFT_BOOK_OFFERS.sql"));
    check("repeat migration is safe", true);
    const afterPolicy = await client.query(`
      select pg_get_expr(polqual, polrelid) as expr
      from pg_policy
      where polname = 'public can read active books'
    `);
    check("books public policy still requires approved submissions",
      beforePolicy.rows[0].expr === afterPolicy.rows[0].expr && /submission_status/.test(afterPolicy.rows[0].expr),
      afterPolicy.rows[0] && afterPolicy.rows[0].expr);

    const flags = await client.query(`
      select c.relrowsecurity, c.relforcerowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'gift_book_offers'
    `);
    check("gift offers force row level security", flags.rows.length === 1 && flags.rows[0].relrowsecurity && flags.rows[0].relforcerowsecurity);

    const grants = await client.query(`
      select grantee, privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'gift_book_offers'
        and grantee in ('anon','authenticated','service_role','public')
      order by grantee, privilege_type
    `);
    const grantText = grants.rows.map((row) => row.grantee + ":" + row.privilege_type).join(",");
    check("only authenticated receives table privileges",
      grantText === "authenticated:DELETE,authenticated:INSERT,authenticated:SELECT,authenticated:UPDATE",
      grantText);

    const inserted = await client.query(`
      insert into public.books (title, stock, stock_status, is_active, submission_status)
      values
        ('available', 3, 'in_stock', true, 'approved'),
        ('zero', 0, 'in_stock', true, 'approved'),
        ('manual out', 4, 'out_of_stock', true, 'approved'),
        ('uyghur out', 4, 'تۈگەپ كەتتى', true, 'approved'),
        ('disabled', 5, 'in_stock', true, 'approved'),
        ('inactive', 5, 'in_stock', false, 'approved'),
        ('pending', 5, 'in_stock', true, 'pending'),
        ('unconfigured', null, '', true, 'approved')
      returning id, title
    `);
    const id = {};
    inserted.rows.forEach((row) => { id[row.title] = row.id; });
    await client.query(`
      insert into public.gift_book_offers (book_id, enabled)
      values
        ($1, true), ($2, true), ($3, true), ($4, true),
        ($5, false), ($6, true), ($7, true), ($8, true)
    `, [id.available, id.zero, id["manual out"], id["uyghur out"], id.disabled, id.inactive, id.pending, id.unconfigured]);

    await expectError("anon cannot read gift offers", () => asRole(client, "anon", "", "aal1", () =>
      client.query("select * from public.gift_book_offers")
    ), /permission denied/);

    const memberRows = await visibleOffers(client, MEMBER, "aal1");
    check("active member sees only enabled available offers",
      memberRows.length === 2 && memberRows.every((row) => row.enabled === true) &&
      memberRows.map((row) => Number(row.book_id)).sort((a, b) => a - b).join(",") === [Number(id.available), Number(id.unconfigured)].sort((a, b) => a - b).join(","),
      JSON.stringify(memberRows));

    const suspendedRows = await visibleOffers(client, SUSPENDED, "aal1");
    check("suspended profile sees no offers", suspendedRows.length === 0, JSON.stringify(suspendedRows));
    const missingRows = await visibleOffers(client, NOPROFILE, "aal1");
    check("missing profile sees no offers", missingRows.length === 0, JSON.stringify(missingRows));

    const anonBooks = await asRole(client, "anon", "", "aal1", () =>
      client.query("select id, title from public.books order by id")
    );
    check("anonymous catalog still returns approved public titles",
      anonBooks.rows.some((row) => row.title === "available") && anonBooks.rows.every((row) => row.title !== "pending" && row.title !== "inactive"),
      JSON.stringify(anonBooks.rows.map((row) => row.title)));

    await expectError("member cannot insert an offer", () => asRole(client, "authenticated", MEMBER, "aal1", () =>
      client.query("insert into public.gift_book_offers (book_id, enabled) values ($1, true)", [id.available])
    ), /42501|row-level security|permission denied/);

    await expectError("admin aal1 cannot insert an offer", () => asRole(client, "authenticated", ADMIN, "aal1", () =>
      client.query("insert into public.gift_book_offers (book_id, enabled) values ($1, true)", [id.zero])
    ), /42501|row-level security|permission denied/);

    const adminRows = await visibleOffers(client, ADMIN, "aal2");
    check("admin aal2 can read disabled offers",
      adminRows.some((row) => Number(row.book_id) === Number(id.disabled) && row.enabled === false) && adminRows.length === 8,
      "count " + adminRows.length);

    const extraBook = await client.query("insert into public.books (title, stock, is_active, submission_status) values ('new gift', 2, true, 'approved') returning id");
    const created = await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("insert into public.gift_book_offers (book_id, enabled) values ($1, true) returning book_id, enabled", [extraBook.rows[0].id])
    );
    check("admin aal2 can insert an offer", created.rows[0] && created.rows[0].enabled === true, JSON.stringify(created.rows[0]));

    const stale = await client.query("select updated_at from public.gift_book_offers where book_id = $1", [id.available]);
    const stamped = stale.rows[0].updated_at;
    const conflict = await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("update public.gift_book_offers set enabled = false where book_id = $1 and updated_at = $2 returning book_id", [id.available, "2000-01-01T00:00:00Z"])
    );
    check("stale updated_at does not overwrite the offer", conflict.rows.length === 0);
    const current = await client.query("select enabled, updated_at from public.gift_book_offers where book_id = $1", [id.available]);
    check("offer stays enabled after the stale update", current.rows[0].enabled === true && String(current.rows[0].updated_at) === String(stamped));

    await client.query(readSql("STAGE122_GIFT_BOOK_OFFERS_ROLLBACK.sql"));
    const gone = await client.query("select to_regclass('public.gift_book_offers') as name");
    check("rollback drops the offer table", gone.rows[0].name === null);
    const booksRemain = await client.query("select count(*)::integer as count from public.books");
    check("rollback keeps books", booksRemain.rows[0].count >= 8, String(booksRemain.rows[0].count));
    const policyRemains = await client.query("select pg_get_expr(polqual, polrelid) as expr from pg_policy where polname = 'public can read active books'");
    check("rollback keeps the approved books policy", /submission_status/.test(policyRemains.rows[0].expr));

    await client.query(readSql("STAGE122_GIFT_BOOK_OFFERS.sql"));
    const restored = await client.query("select to_regclass('public.gift_book_offers') as name");
    check("reapply after rollback restores an empty offer table", restored.rows[0].name === "gift_book_offers");
    const empty = await client.query("select count(*)::integer as count from public.gift_book_offers");
    check("reapply does not restore deleted offers", empty.rows[0].count === 0);
  } finally {
    if (client) {
      try { await client.end(); } catch (ignore) {}
    }
    try { await server.stop(); } catch (ignore) {}
  }
  if (failures.length) {
    console.error("\n" + failures.length + " stage 122 check(s) failed");
    process.exit(1);
  }
  console.log("stage122-isolated-verify ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
