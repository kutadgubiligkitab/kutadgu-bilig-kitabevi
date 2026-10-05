#!/usr/bin/env node
"use strict";

// Applies STAGE107 and the later review migrations on a throwaway Postgres database.
// Does not open the live Supabase project.

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.join(__dirname, "..");
const MEMBER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const STAFF = "44444444-4444-4444-8444-444444444444";
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
    insert into auth.users (id) values ('${MEMBER}'), ('${OTHER}'), ('${ADMIN}'), ('${STAFF}')
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
    create table if not exists public.book_staff (
      user_id uuid primary key references auth.users(id) on delete cascade
    );
    insert into public.book_staff (user_id) values ('${STAFF}')
    on conflict (user_id) do nothing;
    create or replace function public.is_kutadgu_book_staff()
    returns boolean language sql stable security definer set search_path = public
    as $$ select exists (select 1 from public.book_staff where user_id = auth.uid()); $$;
    revoke all on function public.is_kutadgu_book_staff() from public, anon;
    grant execute on function public.is_kutadgu_book_staff() to authenticated;
    create table if not exists public.profiles (
      id uuid primary key references auth.users(id) on delete cascade,
      email text not null default '',
      full_name text not null default ''
    );
    insert into public.profiles (id, email, full_name) values
      ('${MEMBER}', 'member-secret@example.com', 'ئەزا ئىسمى'),
      ('${OTHER}', 'other-secret@example.com', 'باشقا ئەزا'),
      ('${ADMIN}', 'admin-secret@example.com', 'باشقۇرغۇچى'),
      ('${STAFF}', 'staff-secret@example.com', 'خادىم')
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
    const message = String(error && error.message || error);
    check(name, pattern.test(message), message);
  }
}

async function main() {
  const base = "/tmp/stage107-pg/node_modules";
  const pg = require(path.join(base, "pg"));
  const embedded = await import(pathToFileURL(path.join(base, "embedded-postgres", "dist", "index.js")).href);
  const EmbeddedPostgres = embedded.default;
  const dir = path.join("/tmp", "stage108-pg-data-" + Date.now());
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port: 55434,
    persistent: false,
    initdbFlags: ["--locale=C", "--encoding=UTF8"],
    onLog() {},
    onError(error) { console.error(error); }
  });
  let client;
  try {
    await server.initialise();
    await server.start();
    await server.createDatabase("stage108");
    client = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:55434/stage108" });
    await client.connect();
    await client.query("create extension if not exists pgcrypto");
    await client.query("do $$ begin create role anon nologin; exception when duplicate_object then null; end $$");
    await client.query("do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$");
    await client.query("grant anon to postgres");
    await client.query("grant authenticated to postgres");
    await client.query("grant usage on schema public to anon, authenticated");
    await client.query(fixtureSql());
    await client.query(readSql("STAGE107_BOOK_REVIEWS.sql"));

    const active = await client.query("insert into public.books (title, is_active) values ('ئۇزۇن كىتاب', true) returning id");
    const otherBook = await client.query("insert into public.books (title, is_active) values ('باشقا كىتاب', true) returning id");
    const activeId = active.rows[0].id;
    const otherId = otherBook.rows[0].id;
    const longBody = "ئ".repeat(1500);
    const historical = await asRole(client, "authenticated", MEMBER, "aal1", async () => {
      const row = await client.query(
        "insert into public.book_reviews (book_id, body) values ($1, $2) returning id",
        [activeId, longBody]
      );
      return row.rows[0].id;
    });
    const unrelated = await asRole(client, "authenticated", OTHER, "aal1", async () => {
      const row = await client.query(
        "insert into public.book_reviews (book_id, body) values ($1, 'باشقا ئىنكاس') returning id",
        [otherId]
      );
      return row.rows[0].id;
    });

    await client.query(readSql("STAGE108_BOOK_REVIEW_LIMITS_DELETE.sql"));
    console.log("STAGE 1");

    const kept = await client.query("select body, status from public.book_reviews where id = $1", [historical]);
    check("historical review longer than 1000 survives migration", kept.rows[0] && kept.rows[0].body === longBody && kept.rows[0].status === "pending", String(kept.rows[0] && kept.rows[0].body.length));

    await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select public.moderate_book_review($1, 'approved')", [historical])
    );
    const moderated = await client.query("select status, char_length(body) as len from public.book_reviews where id = $1", [historical]);
    check("historical long review can still be approved", moderated.rows[0].status === "approved" && Number(moderated.rows[0].len) === 1500);

    await expectError("new review over 1000 characters is rejected", () => asRole(client, "authenticated", MEMBER, "aal1", () =>
      client.query("insert into public.book_reviews (book_id, body) values ($1, $2)", [otherId, "ئ".repeat(1001)])
    ), /too long|22023/i);

    const exact = await asRole(client, "authenticated", MEMBER, "aal1", async () => {
      const row = await client.query(
        "insert into public.book_reviews (book_id, body) values ($1, $2) returning id, status",
        [otherId, "  " + "ئ".repeat(1000) + "  "]
      );
      return row.rows[0];
    });
    const exactStored = await client.query("select char_length(body) as len from public.book_reviews where id = $1", [exact.id]);
    check("new review of 1000 trimmed characters is stored", exact.status === "pending" && Number(exactStored.rows[0].len) === 1000);

    await expectError("anonymous cannot delete a review", () => asRole(client, "anon", null, "aal1", () =>
      client.query("select public.delete_book_review($1)", [historical])
    ), /permission denied/i);
    await expectError("member cannot delete a review", () => asRole(client, "authenticated", MEMBER, "aal1", () =>
      client.query("select public.delete_book_review($1)", [historical])
    ), /Admin permission required|42501/i);
    await expectError("book staff cannot delete a review", () => asRole(client, "authenticated", STAFF, "aal2", () =>
      client.query("select public.delete_book_review($1)", [historical])
    ), /Admin permission required|42501/i);
    await expectError("admin without AAL2 cannot delete a review", () => asRole(client, "authenticated", ADMIN, "aal1", () =>
      client.query("select public.delete_book_review($1)", [historical])
    ), /Admin permission required|42501/i);

    const booksBefore = await client.query("select count(*)::int as n from public.books");
    const usersBefore = await client.query("select count(*)::int as n from auth.users");
    await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select public.delete_book_review($1)", [historical])
    );
    const gone = await client.query("select count(*)::int as n from public.book_reviews where id = $1", [historical]);
    const still = await client.query("select id from public.book_reviews where id = $1", [unrelated]);
    const booksAfter = await client.query("select count(*)::int as n from public.books");
    const usersAfter = await client.query("select count(*)::int as n from auth.users");
    check("admin AAL2 deletes only the chosen review", gone.rows[0].n === 0 && still.rows.length === 1);
    check("deleting a review does not delete the book or member", booksAfter.rows[0].n === booksBefore.rows[0].n && usersAfter.rows[0].n === usersBefore.rows[0].n);

    const anonAfter = await asRole(client, "anon", null, "aal1", async () => {
      const rows = await client.query("select id from public.book_reviews where id = $1", [historical]);
      return rows.rows;
    });
    check("deleted approved review is not publicly readable", anonAfter.length === 0);

    const listed = await asRole(client, "authenticated", ADMIN, "aal2", async () => {
      const rows = await client.query("select id, book_title, status from public.admin_list_book_reviews('pending')");
      return rows.rows;
    });
    check("admin list returns the pending review and book title", listed.some((row) => row.id === exact.id && row.book_title === "باشقا كىتاب" && row.status === "pending"), JSON.stringify(listed));
    await expectError("anonymous cannot list reviews for moderation", () => asRole(client, "anon", null, "aal1", () =>
      client.query("select * from public.admin_list_book_reviews('pending')")
    ), /permission denied/i);

    console.log("STAGE 2");
    await client.query(readSql("STAGE109_BOOK_REVIEW_HEARTS_REPLIES.sql"));
    const CONCURRENT = "55555555-5555-4555-8555-555555555555";
    const FRESH = "66666666-6666-4666-8666-666666666666";
    await client.query("insert into auth.users (id) values ($1), ($2) on conflict (id) do nothing", [CONCURRENT, FRESH]);
    await client.query(
      "insert into public.profiles (id, email, full_name) values ($1, 'concurrent-secret@example.com', 'تەڭ ئەزا'), ($2, 'fresh-secret@example.com', 'يېڭى ئەزا') on conflict (id) do nothing",
      [CONCURRENT, FRESH]
    );

    await expectError("a reply to a pending review is rejected", () => asRole(client, "authenticated", MEMBER, "aal1", () =>
      client.query("insert into public.book_review_replies (review_id, body) values ($1, 'ياخشى')", [exact.id])
    ), /not public|42501/i);
    const rejectedLogs = await client.query("select count(*)::int as n from public.book_review_submission_log");
    check("a rejected reply does not consume the submission interval", rejectedLogs.rows[0].n === 0);

    await expectError("a heart on a pending review is rejected", () => asRole(client, "authenticated", MEMBER, "aal1", () =>
      client.query("select public.add_book_review_heart($1)", [exact.id])
    ), /not public|42501/i);

    await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select public.moderate_book_review($1, 'approved')", [unrelated])
    );

    await expectError("a reply longer than 500 characters is rejected", () => asRole(client, "authenticated", MEMBER, "aal1", () =>
      client.query("insert into public.book_review_replies (review_id, body) values ($1, $2)", [unrelated, "ئ".repeat(501)])
    ), /too long|22023/i);
    const longReplyLogs = await client.query("select count(*)::int as n from public.book_review_submission_log");
    check("a rejected long reply does not consume the submission interval", longReplyLogs.rows[0].n === 0);

    const reply = await asRole(client, "authenticated", MEMBER, "aal1", async () => {
      const row = await client.query(
        "insert into public.book_review_replies (review_id, body) values ($1, $2) returning id, status, char_length(body) as len",
        [unrelated, "  " + "ئ".repeat(500) + "  "]
      );
      return row.rows[0];
    });
    const replyOwner = await client.query("select user_id::text as user_id from public.book_review_replies where id = $1", [reply.id]);
    check("a trimmed 500-character reply is stored as pending for auth.uid()", reply.status === "pending" && Number(reply.len) === 500 && replyOwner.rows[0].user_id === MEMBER);

    await expectError("a second reply inside 30 seconds is rejected", () => asRole(client, "authenticated", MEMBER, "aal1", () =>
      client.query("insert into public.book_review_replies (review_id, body) values ($1, 'يەنە بىر')", [unrelated])
    ), /submission interval|P0501/i);
    const intervalLogs = await client.query("select count(*)::int as n from public.book_review_submission_log where user_id = $1", [MEMBER]);
    check("a rejected interval write does not add another submission", intervalLogs.rows[0].n === 1);

    const pendingPublic = await asRole(client, "anon", null, "aal1", async () => {
      const rows = await client.query("select id from public.book_review_replies where id = $1", [reply.id]);
      return rows.rows;
    });
    check("anonymous readers cannot see a pending reply", pendingPublic.length === 0);
    await expectError("anonymous cannot read reply user ids", () => asRole(client, "anon", null, "aal1", () =>
      client.query("select user_id from public.book_review_replies")
    ), /permission denied/i);

    await asRole(client, "authenticated", OTHER, "aal1", () => client.query("select public.add_book_review_heart($1)", [unrelated]));
    await asRole(client, "authenticated", OTHER, "aal1", () => client.query("select public.add_book_review_heart($1)", [unrelated]));
    await asRole(client, "authenticated", ADMIN, "aal1", () => client.query("select public.add_book_review_heart($1)", [unrelated]));
    const heartRows = await client.query("select count(*)::int as n from public.book_review_hearts where review_id = $1", [unrelated]);
    check("each member has one heart and a repeated add does not duplicate it", heartRows.rows[0].n === 2);
    const summary = await asRole(client, "anon", null, "aal1", async () => {
      const rows = await client.query("select review_id, heart_count, mine from public.book_review_heart_summary($1::uuid[])", [[unrelated]]);
      return rows.rows[0];
    });
    check("public heart summary returns the count without a liker id", summary && Number(summary.heart_count) === 2 && summary.mine === false && !Object.prototype.hasOwnProperty.call(summary, "user_id"));
    await asRole(client, "authenticated", ADMIN, "aal1", () => client.query("select public.remove_book_review_heart($1)", [unrelated]));
    const afterRemove = await client.query("select count(*)::int as n from public.book_review_hearts where review_id = $1 and user_id = $2", [unrelated, ADMIN]);
    check("a member can remove only their own heart", afterRemove.rows[0].n === 0);
    await expectError("anonymous cannot read heart rows", () => asRole(client, "anon", null, "aal1", () =>
      client.query("select * from public.book_review_hearts")
    ), /permission denied/i);
    await expectError("anonymous cannot add a heart", () => asRole(client, "anon", null, "aal1", () =>
      client.query("select public.add_book_review_heart($1)", [unrelated])
    ), /permission denied/i);

    const otherReply = await asRole(client, "authenticated", OTHER, "aal1", async () => {
      const row = await client.query(
        "insert into public.book_review_replies (review_id, body) values ($1, '<script>alert(1)</script>') returning id",
        [unrelated]
      );
      return row.rows[0].id;
    });
    await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select public.moderate_book_review_reply($1, 'approved')", [reply.id])
    );
    await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select public.moderate_book_review_reply($1, 'rejected')", [otherReply])
    );
    const visibleReplies = await asRole(client, "anon", null, "aal1", async () => {
      const rows = await client.query("select id, body from public.book_review_replies order by created_at asc, id asc");
      return rows.rows;
    });
    check("anonymous readers see only the approved reply text", visibleReplies.length === 1 && visibleReplies[0].id === reply.id && visibleReplies[0].body === "ئ".repeat(500));
    const ownReplies = await asRole(client, "authenticated", OTHER, "aal1", async () => {
      const rows = await client.query("select id, status from public.my_book_review_replies($1)", [otherId]);
      return rows.rows;
    });
    check("the author can see their rejected reply and not another member's reply", ownReplies.length === 1 && ownReplies[0].id === otherReply && ownReplies[0].status === "rejected");
    await expectError("anonymous cannot moderate a reply", () => asRole(client, "anon", null, "aal1", () =>
      client.query("select public.moderate_book_review_reply($1, 'approved')", [otherReply])
    ), /permission denied/i);
    await expectError("a member cannot delete a reply", () => asRole(client, "authenticated", MEMBER, "aal1", () =>
      client.query("select public.delete_book_review_reply($1)", [reply.id])
    ), /Admin permission required|42501/i);
    await expectError("admin without AAL2 cannot delete a reply", () => asRole(client, "authenticated", ADMIN, "aal1", () =>
      client.query("select public.delete_book_review_reply($1)", [reply.id])
    ), /Admin permission required|42501/i);

    const replyPolicy = await client.query("select qual from pg_policies where policyname = 'public reads approved replies of public reviews'");
    check("the public reply policy does not call the admin helper", replyPolicy.rows[0] && !/is_kutadgu_admin/.test(String(replyPolicy.rows[0].qual)));

    const bookA = await client.query("insert into public.books (title, is_active) values ('تەڭ كىتاب 1', true) returning id");
    const bookB = await client.query("insert into public.books (title, is_active) values ('تەڭ كىتاب 2', true) returning id");
    const sideA = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:55434/stage108" });
    const sideB = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:55434/stage108" });
    await sideA.connect();
    await sideB.connect();
    const raced = await Promise.allSettled([
      asRole(sideA, "authenticated", CONCURRENT, "aal1", () => sideA.query("insert into public.book_reviews (book_id, body) values ($1, 'بىرىنچى')", [bookA.rows[0].id])),
      asRole(sideB, "authenticated", CONCURRENT, "aal1", () => sideB.query("insert into public.book_reviews (book_id, body) values ($1, 'ئىككىنچى')", [bookB.rows[0].id]))
    ]);
    await sideA.end();
    await sideB.end();
    const raceOk = raced.filter((item) => item.status === "fulfilled").length;
    const raceDenied = raced.filter((item) => item.status === "rejected" && /submission interval|P0501/i.test(String(item.reason && item.reason.message))).length;
    const raceLogs = await client.query("select count(*)::int as n from public.book_review_submission_log where user_id = $1", [CONCURRENT]);
    check("concurrent submissions allow one write in the interval", raceOk === 1 && raceDenied === 1 && raceLogs.rows[0].n === 1, JSON.stringify(raced.map((item) => item.status === "rejected" ? item.reason.message : "ok")));

    await expectError("an oversized review does not consume the interval", () => asRole(client, "authenticated", FRESH, "aal1", () =>
      client.query("insert into public.book_reviews (book_id, body) values ($1, $2)", [bookA.rows[0].id, "ئ".repeat(1001)])
    ), /too long|22023/i);
    const freshReview = await asRole(client, "authenticated", FRESH, "aal1", async () => {
      const row = await client.query("insert into public.book_reviews (book_id, body) values ($1, 'ياخشى') returning id", [bookA.rows[0].id]);
      return row.rows[0].id;
    });
    check("a valid review still succeeds after a rejected oversized write", !!freshReview);

    const booksBeforeCascade = await client.query("select count(*)::int as n from public.books");
    const usersBeforeCascade = await client.query("select count(*)::int as n from auth.users");
    await asRole(client, "authenticated", ADMIN, "aal2", () => client.query("select public.delete_book_review($1)", [unrelated]));
    const cascadedReplies = await client.query("select count(*)::int as n from public.book_review_replies where review_id = $1", [unrelated]);
    const cascadedHearts = await client.query("select count(*)::int as n from public.book_review_hearts where review_id = $1", [unrelated]);
    const keptReview = await client.query("select id from public.book_reviews where id = $1", [exact.id]);
    const booksAfterCascade = await client.query("select count(*)::int as n from public.books");
    const usersAfterCascade = await client.query("select count(*)::int as n from auth.users");
    check("deleting a parent review removes its replies and hearts only", cascadedReplies.rows[0].n === 0 && cascadedHearts.rows[0].n === 0 && keptReview.rows.length === 1);
    check("cascade deletion keeps the book and member", booksAfterCascade.rows[0].n === booksBeforeCascade.rows[0].n && usersAfterCascade.rows[0].n === usersBeforeCascade.rows[0].n);

    const counts = await asRole(client, "authenticated", ADMIN, "aal2", async () => {
      const row = await client.query("select public.admin_approval_counts() as counts");
      return row.rows[0].counts;
    });
    check("approval counts include pending submissions, reviews, and replies", Number(counts.reviews) >= 1 && Number(counts.replies) === 0 && Number(counts.submissions) === 0, JSON.stringify(counts));
    await expectError("anonymous cannot read approval counts", () => asRole(client, "anon", null, "aal1", () =>
      client.query("select public.admin_approval_counts()")
    ), /permission denied/i);

    console.log("STAGE 4");
    await client.query(readSql("STAGE110_BOOK_REVIEW_NOTIFICATIONS.sql"));
    const AUTHOR = "77777777-7777-4777-8777-777777777777";
    const REPLIER = "88888888-8888-4888-8888-888888888888";
    await client.query("insert into auth.users (id) values ($1), ($2) on conflict (id) do nothing", [AUTHOR, REPLIER]);
    await client.query(
      "insert into public.profiles (id, email, full_name) values ($1, 'author-secret@example.com', 'ئاپتور'), ($2, 'replier-secret@example.com', 'جاۋابچى') on conflict (id) do nothing",
      [AUTHOR, REPLIER]
    );
    const noteBook = await client.query("insert into public.books (title, is_active) values ('ئۇقتۇرۇش كىتابى', true) returning id");
    const noteBookId = noteBook.rows[0].id;
    const authorReview = await asRole(client, "authenticated", AUTHOR, "aal1", async () => {
      const row = await client.query("insert into public.book_reviews (book_id, body) values ($1, 'ئانا ئىنكاس') returning id", [noteBookId]);
      return row.rows[0].id;
    });
    await asRole(client, "authenticated", ADMIN, "aal2", () => client.query("select public.moderate_book_review($1, 'approved')", [authorReview]));
    const pendingReply = await asRole(client, "authenticated", REPLIER, "aal1", async () => {
      const row = await client.query("insert into public.book_review_replies (review_id, body) values ($1, 'تەستىقلىنىدىغان جاۋاب') returning id", [authorReview]);
      return row.rows[0].id;
    });
    const beforeApproval = await client.query("select count(*)::int as n from public.book_review_notifications");
    check("a pending reply does not create a notification", beforeApproval.rows[0].n === 0);
    await asRole(client, "authenticated", ADMIN, "aal2", () => client.query("select public.moderate_book_review_reply($1, 'rejected')", [pendingReply]));
    const afterReject = await client.query("select count(*)::int as n from public.book_review_notifications");
    check("a rejected reply does not create a notification", afterReject.rows[0].n === 0);
    await client.query("delete from public.book_review_submission_log where user_id = $1", [REPLIER]);
    const approvedReply = await asRole(client, "authenticated", REPLIER, "aal1", async () => {
      const row = await client.query("insert into public.book_review_replies (review_id, body) values ($1, 'كۆرۈنىدىغان جاۋاب') returning id", [authorReview]);
      return row.rows[0].id;
    });
    await asRole(client, "authenticated", ADMIN, "aal2", () => client.query("select public.moderate_book_review_reply($1, 'approved')", [approvedReply]));
    await expectError("approving the same reply again does not add a notification", () => asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select public.moderate_book_review_reply($1, 'approved')", [approvedReply])
    ), /not pending|02000/i);
    const notes = await client.query("select recipient_id::text as recipient_id, book_id, book_title, excerpt, reply_id from public.book_review_notifications");
    check("approval notifies only the parent author once", notes.rows.length === 1 && notes.rows[0].recipient_id === AUTHOR && notes.rows[0].reply_id === approvedReply && notes.rows[0].book_title === "ئۇقتۇرۇش كىتابى" && notes.rows[0].excerpt === "كۆرۈنىدىغان جاۋاب");
    await client.query("delete from public.book_review_submission_log where user_id = $1", [AUTHOR]);
    const selfReply = await asRole(client, "authenticated", AUTHOR, "aal1", async () => {
      const row = await client.query("insert into public.book_review_replies (review_id, body) values ($1, 'ئۆز جاۋابىم') returning id", [authorReview]);
      return row.rows[0].id;
    });
    await asRole(client, "authenticated", ADMIN, "aal2", () => client.query("select public.moderate_book_review_reply($1, 'approved')", [selfReply]));
    const afterSelf = await client.query("select count(*)::int as n from public.book_review_notifications where reply_id = $1", [selfReply]);
    check("an author is not notified about their own reply", afterSelf.rows[0].n === 0);
    const authorSees = await asRole(client, "authenticated", AUTHOR, "aal1", async () => {
      const rows = await client.query("select id, read_at from public.my_book_review_notifications()");
      return rows.rows;
    });
    const replierSees = await asRole(client, "authenticated", REPLIER, "aal1", async () => {
      const rows = await client.query("select id from public.my_book_review_notifications()");
      return rows.rows;
    });
    check("only the recipient can read the notification", authorSees.length === 1 && authorSees[0].read_at == null && replierSees.length === 0);
    await asRole(client, "authenticated", REPLIER, "aal1", () => client.query("select public.mark_book_review_notification_read($1)", [authorSees[0].id]));
    const stillUnread = await client.query("select read_at from public.book_review_notifications where id = $1", [authorSees[0].id]);
    check("another member cannot mark the recipient's notification read", stillUnread.rows[0].read_at == null);
    await asRole(client, "authenticated", AUTHOR, "aal1", () => client.query("select public.mark_book_review_notification_read($1)", [authorSees[0].id]));
    const marked = await client.query("select read_at is not null as read from public.book_review_notifications where id = $1", [authorSees[0].id]);
    check("the recipient can mark one notification read", marked.rows[0].read === true);
    await expectError("anonymous cannot insert a notification", () => asRole(client, "anon", null, "aal1", () =>
      client.query("insert into public.book_review_notifications (recipient_id, review_id, reply_id, book_id) values ($1, $2, $3, $4)", [AUTHOR, authorReview, approvedReply, noteBookId])
    ), /permission denied/i);
    await asRole(client, "authenticated", ADMIN, "aal2", () => client.query("select public.delete_book_review_reply($1)", [approvedReply]));
    const afterReplyDelete = await client.query("select count(*)::int as n from public.book_review_notifications where reply_id = $1", [approvedReply]);
    check("deleting a reply removes its notification", afterReplyDelete.rows[0].n === 0);
    const keptBook = await client.query("select id from public.books where id = $1", [noteBookId]);
    const keptAuthor = await client.query("select id from auth.users where id = $1", [AUTHOR]);
    check("notification cleanup keeps the book and the member", keptBook.rows.length === 1 && keptAuthor.rows.length === 1);

    console.log("STAGE 111");
    await client.query(readSql("STAGE111_BOOK_REVIEW_PAGES.sql"));
    const targetDef = await client.query("select pg_get_functiondef('public.public_book_review_reply_target(uuid)'::regprocedure) as def");
    check("public reply target does not call the admin helper", !/is_kutadgu_admin/.test(targetDef.rows[0].def));
    check("public reply target does not return a user id", !/user_id/.test(targetDef.rows[0].def));
    const anonTarget = await client.query("select has_function_privilege('anon', 'public.public_book_review_reply_target(uuid)', 'execute') as ok");
    const anonPage = await client.query("select has_function_privilege('anon', 'public.admin_list_book_reviews(text, timestamptz, uuid)', 'execute') as ok");
    check("anonymous can read one public reply target", anonTarget.rows[0].ok === true);
    check("anonymous cannot page the moderation queue", anonPage.rows[0].ok === false);

    const pageBook = await client.query("insert into public.books (title, is_active) values ('بەت كىتابى', true) returning id");
    const pageBookId = pageBook.rows[0].id;
    const inactiveBook = await client.query("insert into public.books (title, is_active) values ('يوشۇرۇن كىتاب', false) returning id");
    await client.query("insert into auth.users (id) select ('10000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid from generate_series(1, 101) i on conflict do nothing");
    await client.query("alter table public.book_reviews disable trigger book_reviews_before_insert");
    await client.query("alter table public.book_review_replies disable trigger book_review_replies_before_insert");
    for (const status of ["pending", "approved", "rejected"]) {
      await client.query(
        `insert into public.book_reviews (book_id, user_id, display_name, body, status, created_at)
         select $1, ('10000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'ئەزا', $2 || i::text, $3,
                timestamptz '2099-01-01' + (i || ' seconds')::interval
         from generate_series(1, 101) i`,
        [pageBookId, "باھا-" + status + "-", status]
      );
    }
    const parent = await client.query(
      "insert into public.book_reviews (book_id, user_id, display_name, body, status, created_at) values ($1, $2, 'ئەزا', 'ئانا ئىنكاس', 'approved', timestamptz '2098-01-01') returning id",
      [pageBookId, MEMBER]
    );
    const hiddenParent = await client.query(
      "insert into public.book_reviews (book_id, user_id, display_name, body, status, created_at) values ($1, $2, 'ئەزا', 'يوشۇرۇن ئىنكاس', 'approved', timestamptz '2098-01-02') returning id",
      [inactiveBook.rows[0].id, MEMBER]
    );
    for (const status of ["pending", "approved", "rejected"]) {
      await client.query(
        `insert into public.book_review_replies (review_id, user_id, display_name, body, status, created_at)
         select $1, ('10000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'ئەزا', $2 || i::text, $3,
                timestamptz '2099-06-01' + (i || ' seconds')::interval
         from generate_series(1, 101) i`,
        [parent.rows[0].id, "جاۋاب-" + status + "-", status]
      );
    }
    await client.query(
      "insert into public.book_review_replies (review_id, user_id, display_name, body, status) values ($1, $2, 'ئەزا', 'يوشۇرۇن جاۋاب', 'approved')",
      [hiddenParent.rows[0].id, MEMBER]
    );
    await client.query("alter table public.book_reviews enable trigger book_reviews_before_insert");
    await client.query("alter table public.book_review_replies enable trigger book_review_replies_before_insert");

    async function walkPages(fnName, status) {
      let after = null;
      let afterId = null;
      const seen = [];
      for (let page = 0; page < 6; page += 1) {
        const rows = await asRole(client, "authenticated", ADMIN, "aal2", async () => {
          const result = await client.query(
            "select id::text as id, body, created_at from public." + fnName + "($1, $2, $3)",
            [status, after, afterId]
          );
          return result.rows;
        });
        check(fnName + " " + status + " page is bounded", rows.length <= 100, String(rows.length));
        if (!rows.length) break;
        seen.push.apply(seen, rows);
        if (rows.length < 100) break;
        after = rows[rows.length - 1].created_at;
        afterId = rows[rows.length - 1].id;
      }
      return seen;
    }

    for (const status of ["pending", "approved", "rejected"]) {
      const reviews = await walkPages("admin_list_book_reviews", status);
      const mine = reviews.filter((row) => String(row.body).indexOf("باھا-" + status + "-") === 0);
      const ids = new Set(reviews.map((row) => row.id));
      check("every " + status + " review page is reachable", mine.length === 101 && ids.size === reviews.length, String(mine.length));
      check(status + " review pages stay ordered", reviews.every((row, index) => index === 0 || String(reviews[index - 1].created_at) <= String(row.created_at)));
      const replies = await walkPages("admin_list_book_review_replies", status);
      const replyMine = replies.filter((row) => String(row.body).indexOf("جاۋاب-" + status + "-") === 0);
      check("every " + status + " reply page is reachable", replyMine.length === 101, String(replyMine.length));
    }
    const pendingBeforeDelete = await walkPages("admin_list_book_reviews", "pending");
    const doomed = pendingBeforeDelete.find((row) => row.body === "باھا-pending-50");
    const lastPending = pendingBeforeDelete.find((row) => row.body === "باھا-pending-101");
    await asRole(client, "authenticated", ADMIN, "aal2", () => client.query("select public.delete_book_review($1)", [doomed.id]));
    const pendingAfterDelete = await walkPages("admin_list_book_reviews", "pending");
    check("deleting one paged review leaves the later record reachable",
      !pendingAfterDelete.some((row) => row.id === doomed.id) && pendingAfterDelete.some((row) => row.id === lastPending.id));
    await expectError("anonymous cannot page reviews", () => asRole(client, "anon", null, "aal1", () =>
      client.query("select * from public.admin_list_book_reviews('pending', null, null)")
    ), /permission denied/i);

    const visibleReply = await client.query(
      "select id from public.book_review_replies where body = 'جاۋاب-approved-101' and review_id = $1",
      [parent.rows[0].id]
    );
    const pendingReply = await client.query(
      "select id from public.book_review_replies where body = 'جاۋاب-pending-1' and review_id = $1",
      [parent.rows[0].id]
    );
    const hiddenReply = await client.query(
      "select id from public.book_review_replies where body = 'يوشۇرۇن جاۋاب'"
    );
    const anonSeen = await asRole(client, "anon", null, "aal1", async () => {
      const row = await client.query("select reply_body, review_body, book_id from public.public_book_review_reply_target($1)", [visibleReply.rows[0].id]);
      return row.rows;
    });
    check("anonymous can read an approved reply outside a short page", anonSeen.length === 1 && anonSeen[0].reply_body === "جاۋاب-approved-101" && anonSeen[0].review_body === "ئانا ئىنكاس" && String(anonSeen[0].book_id) === String(pageBookId));
    const pendingSeen = await asRole(client, "anon", null, "aal1", async () => {
      const row = await client.query("select reply_id from public.public_book_review_reply_target($1)", [pendingReply.rows[0].id]);
      return row.rows;
    });
    check("a pending reply is not a public target", pendingSeen.length === 0);
    const inactiveSeen = await asRole(client, "authenticated", OTHER, "aal1", async () => {
      const row = await client.query("select reply_id from public.public_book_review_reply_target($1)", [hiddenReply.rows[0].id]);
      return row.rows;
    });
    check("an inactive book reply is not a public target", inactiveSeen.length === 0);
    await client.query("delete from public.book_review_replies where id = $1", [visibleReply.rows[0].id]);
    const deletedSeen = await asRole(client, "anon", null, "aal1", async () => {
      const row = await client.query("select reply_id from public.public_book_review_reply_target($1)", [visibleReply.rows[0].id]);
      return row.rows;
    });
    check("a deleted reply target is empty", deletedSeen.length === 0);

    if (failures.length) {
      console.error(failures.length + " stage108 check(s) failed");
      process.exitCode = 1;
    } else {
      console.log("stage108 isolated postgres: PASS");
    }
  } finally {
    if (client) await client.end().catch(() => {});
    await server.stop().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
