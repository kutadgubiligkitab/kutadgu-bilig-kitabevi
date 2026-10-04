#!/usr/bin/env node
"use strict";

// Applies STAGE107 to a throwaway Postgres database.
// Does not open the live Supabase project and does not run production SQL.

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.join(__dirname, "..");
const MEMBER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
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
    insert into auth.users (id) values ('${MEMBER}'), ('${OTHER}'), ('${ADMIN}')
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
    insert into public.admin_users (user_id) values ('${ADMIN}')
    on conflict (user_id) do nothing;
    create table if not exists public.profiles (
      id uuid primary key references auth.users(id) on delete cascade,
      email text not null default '',
      full_name text not null default ''
    );
    insert into public.profiles (id, email, full_name) values
      ('${MEMBER}', 'member-secret@example.com', 'ئەزا ئىسمى'),
      ('${OTHER}', 'other-secret@example.com', 'other-secret@example.com'),
      ('${ADMIN}', 'admin-secret@example.com', 'باشقۇرغۇچى')
    on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
    create or replace function public.is_kutadgu_admin()
    returns boolean language sql stable security definer set search_path = public
    as $$
      select exists (select 1 from public.admin_users where user_id = auth.uid());
    $$;
    revoke all on function public.is_kutadgu_admin() from public, anon;
    grant execute on function public.is_kutadgu_admin() to authenticated;
    create table if not exists public.books (
      id bigint generated always as identity primary key,
      title text not null,
      is_active boolean not null default true
    );
    alter table public.books enable row level security;
    alter table public.books force row level security;
    drop policy if exists "public reads active books" on public.books;
    create policy "public reads active books"
      on public.books for select to anon, authenticated
      using (is_active = true);
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
    const message = String(error && error.message || error);
    check(name, pattern.test(message), message);
  }
}

async function main() {
  const base = "/tmp/stage107-pg/node_modules";
  const pg = require(path.join(base, "pg"));
  const embedded = await import(pathToFileURL(path.join(base, "embedded-postgres", "dist", "index.js")).href);
  const EmbeddedPostgres = embedded.default;
  const dir = path.join("/tmp", "stage107-pg-data-" + Date.now());
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port: 55433,
    persistent: false,
    initdbFlags: ["--locale=C", "--encoding=UTF8"],
    onLog() {},
    onError(error) { console.error(error); }
  });
  let client;
  try {
    await server.initialise();
    await server.start();
    await server.createDatabase("stage107");
    client = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:55433/stage107" });
    await client.connect();
    await client.query("create extension if not exists pgcrypto");
    await client.query("do $$ begin create role anon nologin; exception when duplicate_object then null; end $$");
    await client.query("do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$");
    await client.query("grant anon to postgres");
    await client.query("grant authenticated to postgres");
    await client.query("grant usage on schema public to anon, authenticated");
    await client.query(fixtureSql());
    await client.query(readSql("STAGE107_BOOK_REVIEWS.sql"));
    await client.query(readSql("STAGE107_BOOK_REVIEWS.sql"));

    const active = await client.query("insert into public.books (title, is_active) values ('ئوچۇق', true) returning id");
    const hidden = await client.query("insert into public.books (title, is_active) values ('يوشۇرۇن', false) returning id");
    const other = await client.query("insert into public.books (title, is_active) values ('باشقا', true) returning id");
    const activeId = active.rows[0].id;
    const hiddenId = hidden.rows[0].id;
    const otherId = other.rows[0].id;

    const policies = await client.query(
      "select polname, pg_get_expr(polqual, polrelid) as qual from pg_policy where polrelid = 'public.book_reviews'::regclass"
    );
    const anonPolicy = policies.rows.find((row) => row.polname === "public reads approved reviews of active books");
    check("anonymous select policy does not call the admin helper", !!(anonPolicy && !/is_kutadgu_admin/.test(anonPolicy.qual)), anonPolicy && anonPolicy.qual);

    const inserted = await asRole(client, "authenticated", MEMBER, "aal1", async () => {
      const row = await client.query(
        "insert into public.book_reviews (book_id, body) values ($1, $2) returning id, status, display_name",
        [activeId, "  <script>alert(1)</script>  "]
      );
      return row.rows[0];
    });
    check("member insert stays pending", inserted.status === "pending", inserted.status);
    check("display name comes from the profile name", inserted.display_name === "ئەزا ئىسمى", inserted.display_name);

    const stored = await client.query("select user_id, body, display_name from public.book_reviews where id = $1", [inserted.id]);
    check("member insert is stored as that member", stored.rows[0].user_id === MEMBER, stored.rows[0].user_id);
    check("stored body keeps markup as text", stored.rows[0].body === "<script>alert(1)</script>", stored.rows[0].body);
    check("stored row does not copy the member email", stored.rows[0].display_name !== "member-secret@example.com");

    const memberStatus = await asRole(client, "authenticated", MEMBER, "aal1", async () => {
      const row = await client.query("select public.my_book_review_status($1) as status", [activeId]);
      return row.rows[0].status;
    });
    check("member status read returns that member's pending review", memberStatus === "pending", String(memberStatus));

    const otherStatus = await asRole(client, "authenticated", OTHER, "aal1", async () => {
      const row = await client.query("select public.my_book_review_status($1) as status", [activeId]);
      return row.rows[0].status;
    });
    check("another member's pending review does not become this member's status", otherStatus == null, String(otherStatus));

    const adminStatus = await asRole(client, "authenticated", ADMIN, "aal2", async () => {
      const row = await client.query("select public.my_book_review_status($1) as status", [activeId]);
      return row.rows[0].status;
    });
    check("admin AAL2 status read does not adopt another member's pending review", adminStatus == null, String(adminStatus));

    const adminQueue = await asRole(client, "authenticated", ADMIN, "aal2", async () => {
      const rows = await client.query("select id, status from public.book_reviews where status = 'pending'");
      return rows.rows;
    });
    check("admin AAL2 moderation queue still reads the pending review", adminQueue.length === 1 && adminQueue[0].id === inserted.id && adminQueue[0].status === "pending", JSON.stringify(adminQueue));

    const statusPrivileges = await client.query(
      "select has_function_privilege('anon', 'public.my_book_review_status(bigint)', 'execute') as anon_exec, has_function_privilege('authenticated', 'public.my_book_review_status(bigint)', 'execute') as auth_exec, (select prosecdef from pg_proc where proname = 'my_book_review_status') as definer"
    );
    check(
      "own-status execute is limited to authenticated",
      statusPrivileges.rows[0].anon_exec === false && statusPrivileges.rows[0].auth_exec === true && statusPrivileges.rows[0].definer === true,
      JSON.stringify(statusPrivileges.rows[0])
    );

    await expectError("anonymous cannot execute the own-status read", () => asRole(client, "anon", null, "aal1", () =>
      client.query("select public.my_book_review_status($1)", [activeId])
    ), /permission denied/i);

    await expectError("second pending insert from the same member is rejected", () => asRole(client, "authenticated", MEMBER, "aal1", () =>
      client.query("insert into public.book_reviews (book_id, body) values ($1, 'قايتا')", [activeId])
    ), /duplicate|unique/i);

    await expectError("empty review text is rejected", () => asRole(client, "authenticated", MEMBER, "aal1", () =>
      client.query("insert into public.book_reviews (book_id, body) values ($1, '   ')", [otherId])
    ), /empty or too long|check|22023/i);

    await expectError("member cannot choose another user id", () => asRole(client, "authenticated", MEMBER, "aal1", () =>
      client.query("insert into public.book_reviews (book_id, body, user_id) values ($1, 'باشقا', $2)", [otherId, OTHER])
    ), /permission denied/i);

    await expectError("member cannot insert an approved review", () => asRole(client, "authenticated", MEMBER, "aal1", () =>
      client.query("insert into public.book_reviews (book_id, body, status) values ($1, 'تەستىق', 'approved')", [otherId])
    ), /permission denied/i);

    await expectError("inactive book cannot be reviewed", () => asRole(client, "authenticated", MEMBER, "aal1", () =>
      client.query("insert into public.book_reviews (book_id, body) values ($1, 'يوشۇرۇن')", [hiddenId])
    ), /not public|42501|row-level/i);

    await expectError("member cannot update a review", () => asRole(client, "authenticated", MEMBER, "aal1", () =>
      client.query("update public.book_reviews set body = 'ئۆزگەرتىش' where id = $1", [inserted.id])
    ), /permission denied/i);

    await expectError("member cannot approve a review", () => asRole(client, "authenticated", MEMBER, "aal1", () =>
      client.query("select public.moderate_book_review($1, 'approved')", [inserted.id])
    ), /Admin permission required|42501/i);

    await expectError("admin without AAL2 cannot approve", () => asRole(client, "authenticated", ADMIN, "aal1", () =>
      client.query("select public.moderate_book_review($1, 'approved')", [inserted.id])
    ), /Admin permission required|42501/i);

    await expectError("anonymous cannot call moderation", () => asRole(client, "anon", null, "aal1", () =>
      client.query("select public.moderate_book_review($1, 'approved')", [inserted.id])
    ), /permission denied/i);

    const anonPending = await asRole(client, "anon", null, "aal1", async () => {
      const rows = await client.query("select id, body from public.book_reviews where book_id = $1", [activeId]);
      return rows.rows;
    });
    check("anonymous readers do not see a pending review", anonPending.length === 0, String(anonPending.length));

    await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select public.moderate_book_review($1, 'approved')", [inserted.id])
    );
    const anonApproved = await asRole(client, "anon", null, "aal1", async () => {
      const rows = await client.query("select book_id, body, display_name from public.book_reviews where book_id = $1", [activeId]);
      return rows.rows;
    });
    check("approved review appears for the same book", anonApproved.length === 1 && String(anonApproved[0].book_id) === String(activeId), JSON.stringify(anonApproved));
    const otherBook = await asRole(client, "anon", null, "aal1", async () => {
      const rows = await client.query("select id from public.book_reviews where book_id = $1", [otherId]);
      return rows.rows;
    });
    check("approved review stays on its own book", otherBook.length === 0);

    const otherInsert = await asRole(client, "authenticated", OTHER, "aal1", async () => {
      const row = await client.query(
        "insert into public.book_reviews (book_id, body) values ($1, 'باشقا ئەزا') returning id, display_name",
        [otherId]
      );
      return row.rows[0];
    });
    const otherStored = await client.query("select user_id from public.book_reviews where id = $1", [otherInsert.id]);
    check("email-shaped profile name is not published", otherInsert.display_name === "ئەزا" && otherStored.rows[0].user_id === OTHER, otherInsert.display_name);

    await expectError("anonymous cannot read the user id column", () => asRole(client, "anon", null, "aal1", () =>
      client.query("select user_id from public.book_reviews")
    ), /permission denied/i);

    const memberSeesOwn = await asRole(client, "authenticated", OTHER, "aal1", async () => {
      const rows = await client.query("select status from public.book_reviews where book_id = $1 and status = 'pending'", [otherId]);
      return rows.rows;
    });
    check("author can see their own pending status", memberSeesOwn.length === 1 && memberSeesOwn[0].status === "pending");
    const stranger = await asRole(client, "authenticated", MEMBER, "aal1", async () => {
      const rows = await client.query("select status from public.book_reviews where book_id = $1 and status = 'pending'", [otherId]);
      return rows.rows;
    });
    check("another member cannot see that pending review", stranger.length === 0);

    const pendingOther = await reviewId(client, otherId);
    await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select public.moderate_book_review($1, 'rejected')", [pendingOther])
    );
    const rejectedHidden = await asRole(client, "anon", null, "aal1", async () => {
      const rows = await client.query("select id from public.book_reviews where book_id = $1", [otherId]);
      return rows.rows;
    });
    check("rejected review is hidden from anonymous readers", rejectedHidden.length === 0);

    const rejectedStatus = await asRole(client, "authenticated", OTHER, "aal1", async () => {
      const row = await client.query("select public.my_book_review_status($1) as status", [otherId]);
      return row.rows[0].status;
    });
    check("member status read returns that member's rejected review", rejectedStatus === "rejected", String(rejectedStatus));

    const adminRejectedStatus = await asRole(client, "authenticated", ADMIN, "aal2", async () => {
      const row = await client.query("select public.my_book_review_status($1) as status", [otherId]);
      return row.rows[0].status;
    });
    check("admin AAL2 status read does not adopt another member's rejected review", adminRejectedStatus == null, String(adminRejectedStatus));

    const anonVisible = await asRole(client, "anon", null, "aal1", async () => {
      const rows = await client.query("select book_id, status from public.book_reviews order by book_id");
      return rows.rows;
    });
    check(
      "anonymous readers still see only approved reviews of active books",
      anonVisible.length === 1 && anonVisible[0].status === "approved" && String(anonVisible[0].book_id) === String(activeId),
      JSON.stringify(anonVisible)
    );

    await expectError("authenticated cannot read the user id column", () => asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select user_id from public.book_reviews")
    ), /permission denied/i);

    await client.query(readSql("STAGE107_BOOK_REVIEWS_ROLLBACK.sql"));
    const gone = await client.query("select to_regclass('public.book_reviews') as name");
    check("rollback removes the review table", gone.rows[0].name === null);
    const functionGone = await client.query("select to_regprocedure('public.my_book_review_status(bigint)') as name");
    check("rollback removes the own-status function", functionGone.rows[0].name === null);
    await client.query(readSql("STAGE107_BOOK_REVIEWS.sql"));
    const back = await client.query("select to_regclass('public.book_reviews') as name");
    check("review SQL can be applied again after rollback", back.rows[0].name === "book_reviews");
    const functionBack = await client.query("select to_regprocedure('public.my_book_review_status(bigint)') as name");
    check("own-status function returns after the review SQL is applied again", functionBack.rows[0].name === "my_book_review_status(bigint)");
  } finally {
    if (client) await client.end().catch(() => {});
    await server.stop().catch(() => {});
  }
  if (failures.length) {
    console.error("STAGE107 isolated postgres: FAIL " + failures.length);
    process.exit(1);
  }
  console.log("STAGE107 isolated postgres: PASS");
}

async function reviewId(client, bookId) {
  const row = await client.query("select id from public.book_reviews where book_id = $1 and status = 'pending'", [bookId]);
  return row.rows[0].id;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
