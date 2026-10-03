#!/usr/bin/env node
"use strict";

// Applies STAGE106 to an isolated in-process Postgres database.
// Does not open the live Supabase project and does not run production SQL.

const fs = require("fs");
const http = require("http");
const path = require("path");
const { pathToFileURL } = require("url");
const C = require("../catalog-credits.js");

const root = path.join(__dirname, "..");
const STAFF = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const failures = [];

function check(name, ok, detail) {
  if (!ok) failures.push(name + (detail ? ": " + detail : ""));
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " — " + detail : ""));
}

function readSql(name) {
  return fs.readFileSync(path.join(root, name), "utf8");
}

function representativeFixtureSql() {
  return `
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
    insert into auth.users (id) values ('${STAFF}'), ('${OTHER}')
    on conflict (id) do nothing;
    create or replace function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
    $$;
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(auth.jwt()->>'sub', '')::uuid;
    $$;
    create table if not exists public.admin_users (
      user_id uuid primary key references auth.users(id) on delete cascade,
      created_at timestamptz not null default now()
    );
    create table if not exists public.book_staff_users (
      user_id uuid primary key references auth.users(id) on delete cascade,
      active boolean not null default true,
      created_at timestamptz not null default now(),
      created_by uuid null
    );
    create or replace function public.is_kutadgu_admin()
    returns boolean language sql stable security definer set search_path = public
    as $$
      select exists (select 1 from public.admin_users where user_id = auth.uid());
    $$;
    create or replace function public.is_kutadgu_book_staff()
    returns boolean language sql stable security definer set search_path = public
    as $$
      select exists (
        select 1 from public.book_staff_users
        where user_id = auth.uid() and active = true
      );
    $$;
    create table if not exists public.books (
      id bigint generated always as identity primary key,
      title text not null,
      author text not null default '',
      price numeric(12,2),
      original_price numeric(12,2),
      category text not null,
      source text not null,
      image_url text not null default '',
      href text not null default '',
      pages integer,
      -- STAGE61 added these without NOT NULL. Fresh-install setup uses a default, existing books do not.
      translator text,
      language text not null default '',
      publish_date text not null default '',
      publish_year text not null default '',
      publisher text,
      cover_type text,
      book_size text,
      dimensions text not null default '',
      description text not null default '',
      stock integer not null default 0 check (stock >= 0),
      is_active boolean not null default true,
      is_new boolean not null default true,
      is_featured boolean not null default false,
      is_recommended boolean not null default false,
      is_color_print boolean not null default false,
      interior_print_type text,
      is_bestseller boolean not null default false,
      sales_count integer not null default 0 check (sales_count >= 0),
      is_available boolean not null default false,
      submission_status text not null default 'approved',
      submitted_by uuid,
      submitted_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint books_submission_status_chk check (submission_status in ('approved', 'pending', 'rejected')),
      constraint books_original_price_chk check (original_price is null or original_price >= 0),
      constraint books_cover_type_chk check (
        cover_type is null or cover_type = '' or cover_type in ('hardcover', 'paperback', 'other')
      ),
      constraint books_book_size_chk check (
        book_size is null or book_size = '' or book_size in ('A4', 'A5', 'B5', 'other')
      ),
      constraint books_interior_print_type_chk check (
        interior_print_type is null or interior_print_type in ('color', 'bw')
      )
    );
    alter table public.books enable row level security;
    alter table public.books force row level security;
  `;
}

function approveFunctionSql() {
  const sql = readSql("STAGE92_BOOK_STAFF_SECURITY.sql");
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.approve_staff_book_submission");
  const end = sql.indexOf("CREATE OR REPLACE FUNCTION public.reject_staff_book_submission");
  if (start < 0 || end < start) throw new Error("approve_staff_book_submission was not found in STAGE92");
  return sql.slice(start, end);
}

async function runConcurrentLockProof() {
  const base = path.join(process.env.TEMP || "", "stage106-pg", "node_modules");
  let pg;
  let EmbeddedPostgres;
  try {
    pg = require(path.join(base, "pg"));
    const embedded = await import(pathToFileURL(path.join(base, "embedded-postgres", "dist", "index.js")).href);
    EmbeddedPostgres = embedded.default;
    if (!pg || !EmbeddedPostgres) throw new Error("PostgreSQL modules did not load");
  } catch (error) {
    console.log("CONCURRENCY_LIMITATION: PGlite has one connection and cannot overlap two transactions. No separate PostgreSQL server was available (" + (error && error.message) + "). The sequential approved-then-write check is not concurrency evidence.");
    return;
  }
  const dir = path.join(process.env.TEMP || "", "stage106-pg-data-" + Date.now());
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port: 55432,
    persistent: false,
    initdbFlags: ["--locale=C", "--encoding=UTF8"],
    onLog() {},
    onError() {}
  });
  const clients = [];
  try {
    await server.initialise();
    await server.start();
    await server.createDatabase("stage106");
    const connectionString = "postgresql://postgres:postgres@127.0.0.1:55432/stage106";
    async function connect() {
      const client = new pg.Client({ connectionString });
      await client.connect();
      clients.push(client);
      return client;
    }
    const setup = await connect();
    await setup.query(representativeFixtureSql());
    await setup.query("create extension if not exists pgcrypto");
    await setup.query("create role anon nologin");
    await setup.query("create role authenticated nologin");
    await setup.query("grant anon to postgres");
    await setup.query("grant authenticated to postgres");
    await setup.query("grant usage on schema public to anon, authenticated");
    await setup.query(readSql("STAGE106_CATALOG_CREDITS.sql"));
    await setup.query(approveFunctionSql());
    await setup.query("grant execute on all functions in schema public to authenticated");
    await setup.query("insert into public.admin_users (user_id) values ($1::uuid)", [OTHER]);
    await setup.query("insert into public.book_staff_users (user_id, active) values ($1::uuid, true)", [STAFF]);

    async function pendingBook(title) {
      const inserted = await setup.query(
        `insert into public.books (title, author, category, source, is_active, is_available, submission_status, submitted_by)
         values ($1, 'ئەسلى', 'رومان', 'romanlar.html', false, false, 'pending', $2::uuid) returning id`,
        [title, STAFF]
      );
      return inserted.rows[0].id;
    }
    async function names(bookId) {
      const rows = await setup.query(
        `select i.display_name from public.book_credits c
         join public.catalog_identities i on i.id = c.identity_id
         where c.book_id = $1 and c.role = 'author' order by c.position`,
        [bookId]
      );
      return rows.rows.map((row) => row.display_name).join("|");
    }
    async function beginAs(client, sub) {
      await client.query("begin");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ aal: "aal2", sub })]);
      await client.query("set local role authenticated");
    }
    async function waitForLock(client) {
      const started = Date.now();
      while (Date.now() - started < 8000) {
        const found = await client.query(
          "select pid from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock'"
        );
        if (found.rows.length) return true;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      return false;
    }

    const watcher = await connect();
    const firstId = await pendingBook("قۇلۇپ بىرىنچى");
    await setup.query("begin");
    await setup.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ aal: "aal2", sub: OTHER })]);
    await setup.query("set local role authenticated");
    await setup.query("select public.set_book_credits($1, $2::jsonb, '[]'::jsonb, null)", [firstId, JSON.stringify(["ئەسلى"])]);
    await setup.query("commit");

    const approval = await connect();
    const staff = await connect();
    await approval.query("begin");
    // Same row lock approve_staff_book_submission takes inside its
    // security-definer UPDATE. Role is set after the lock so RLS does not
    // hide the pending row from the lock statement.
    await approval.query("select id from public.books where id = $1 for update", [firstId]);
    await approval.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ aal: "aal2", sub: OTHER })]);
    await approval.query("set local role authenticated");
    let staffError = "";
    const staffWrite = (async () => {
      try {
        await beginAs(staff, STAFF);
        await staff.query(
          "select public.set_own_pending_book_credits($1, $2::jsonb, '[]'::jsonb, null)",
          [firstId, JSON.stringify(["رەقىب"])]
        );
        await staff.query("commit");
        return "";
      } catch (error) {
        staffError = error.message || String(error);
        try { await staff.query("rollback"); } catch (rollbackError) {}
        return staffError;
      }
    })();
    const staffWaited = await waitForLock(watcher);
    await approval.query("select public.approve_staff_book_submission($1)", [firstId]);
    await approval.query("commit");
    const staffOutcome = await staffWrite;
    check(
      "approval transaction blocks a staff credit write until the book is approved",
      staffWaited && /Pending book permission required/.test(staffOutcome) && (await names(firstId)) === "ئەسلى",
      JSON.stringify({ staffWaited, staffOutcome, names: await names(firstId) })
    );

    const secondId = await pendingBook("قۇلۇپ ئىككىنچى");
    const staffFirst = await connect();
    const approvalSecond = await connect();
    await beginAs(staffFirst, STAFF);
    await staffFirst.query(
      "select public.set_own_pending_book_credits($1, $2::jsonb, '[]'::jsonb, null)",
      [secondId, JSON.stringify(["يېڭى خادىم"])]
    );
    let approvalError = "";
    const approvalWrite = (async () => {
      try {
        await beginAs(approvalSecond, OTHER);
        await approvalSecond.query("select public.approve_staff_book_submission($1)", [secondId]);
        await approvalSecond.query("commit");
        return "";
      } catch (error) {
        approvalError = error.message || String(error);
        try { await approvalSecond.query("rollback"); } catch (rollbackError) {}
        return approvalError;
      }
    })();
    const approvalWaited = await waitForLock(watcher);
    await staffFirst.query("commit");
    const approvalOutcome = await approvalWrite;
    const status = await setup.query("select submission_status from public.books where id = $1", [secondId]);
    check(
      "staff credit transaction blocks approval until the credit write commits",
      approvalWaited && approvalOutcome === "" && status.rows[0].submission_status === "approved" && (await names(secondId)) === "يېڭى خادىم",
      JSON.stringify({ approvalWaited, approvalOutcome, status: status.rows[0] && status.rows[0].submission_status, names: await names(secondId) })
    );
    await setup.query(readSql("STAGE106_CATALOG_CREDIT_CORRECTIONS.sql"));
    const mappedText = "ئەنۋەر جاپپار، پەرھات جىلانوۋ، قادىر قاۋۇز";
    const newerText = "باشقا ئىسىم، يېڭىراق";
    const raceInserted = await setup.query(
      `insert into public.books (title, author, category, source, is_active, is_available)
       values ('يېڭىلانغان', 'يېڭى ئاپتور', 'رومان', 'romanlar.html', true, true) returning id`
    );
    const raceId = raceInserted.rows[0].id;
    await setup.query("begin");
    await setup.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ aal: "aal2", sub: OTHER })]);
    await setup.query("set local role authenticated");
    await setup.query(
      "select public.set_book_credits($1, $2::jsonb, '[]'::jsonb, null)",
      [raceId, JSON.stringify(["يېڭى ئاپتور", "يېڭى شېرىك"])]
    );
    await setup.query("commit");
    await setup.query("update public.books set author = $2 where id = $1", [raceId, mappedText]);
    const holder = await connect();
    const applier = await connect();
    await holder.query("begin");
    await holder.query("select id from public.books where id = $1 for update", [raceId]);
    const applyPromise = applier.query(
      "select book_id, role, status from public.apply_catalog_credit_corrections()"
    );
    const correctionWaited = await waitForLock(watcher);
    await holder.query("update public.books set author = $2 where id = $1", [raceId, newerText]);
    await holder.query("commit");
    const applyRows = (await applyPromise).rows;
    const raceAuthor = await setup.query("select author from public.books where id = $1", [raceId]);
    check(
      "correction waits for the book lock and then skips the stale review",
      correctionWaited
        && applyRows.some((row) => String(row.book_id) === String(raceId) && row.status === "skipped-stale")
        && !applyRows.some((row) => String(row.book_id) === String(raceId) && row.status === "corrected")
        && raceAuthor.rows[0].author === newerText
        && (await names(raceId)) === "يېڭى ئاپتور|يېڭى شېرىك",
      JSON.stringify({ correctionWaited, applyRows, author: raceAuthor.rows[0].author, names: await names(raceId) })
    );
    console.log("CONCURRENCY: two independent PostgreSQL sessions overlapped in both orders.");
  } finally {
    for (const client of clients) {
      try { await client.end(); } catch (error) {}
    }
    try { await server.stop(); } catch (error) {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) {}
  }
}

async function loadPglite() {
  const candidates = [
    process.env.PGLITE_MODULE,
    "@electric-sql/pglite",
    path.join(process.env.TEMP || "", "pglite-stage106", "node_modules", "@electric-sql", "pglite", "dist", "index.js"),
    path.join(process.env.TEMP || "", "pglite-stage106", "node_modules", "@electric-sql", "pglite", "dist", "index.cjs")
  ].filter(Boolean);
  let last;
  for (const item of candidates) {
    const target = item.startsWith("@") || item.startsWith("file:") ? item : pathToFileURL(item).href;
    try {
      return await import(target);
    } catch (error) {
      last = error;
    }
  }
  throw last || new Error("PGlite module not found");
}

async function main() {
  const { PGlite } = await loadPglite();
  const cryptoUrl = pathToFileURL(path.join(process.env.TEMP || "", "pglite-stage106", "node_modules", "@electric-sql", "pglite", "dist", "contrib", "pgcrypto.js")).href;
  const { pgcrypto } = await import(cryptoUrl);
  const db = new PGlite({ extensions: { pgcrypto } });
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const exec = (sql) => db.exec(sql);

  await exec(representativeFixtureSql());
  await exec("create role anon nologin");
  await exec("create role authenticated nologin");
  await exec("grant anon to postgres");
  await exec("grant authenticated to postgres");
  await exec("grant usage on schema public to anon, authenticated");
  await exec("grant select on public.books to anon, authenticated");
  await exec(`
    create policy books_public_read on public.books
    for select to anon, authenticated
    using (is_active = true);
    create policy books_admin_read on public.books
    for select to authenticated
    using (public.is_kutadgu_admin() and (select auth.jwt()->>'aal') = 'aal2');
  `);

  await exec(readSql("STAGE106_CATALOG_CREDITS.sql"));
  const firstCredits = await q("select count(*)::int as n from public.book_credits");
  await exec(readSql("STAGE106_CATALOG_CREDITS.sql"));
  const secondCredits = await q("select count(*)::int as n from public.book_credits");
  check("repeat apply keeps credit rows", firstCredits[0].n === secondCredits[0].n, String(secondCredits[0].n));

  async function asSession(role, claims, flags, fn) {
    await exec("reset role");
    await exec("delete from public.admin_users");
    await exec("delete from public.book_staff_users");
    const sub = claims && claims.sub;
    if (flags && flags.admin && sub) {
      await q("insert into public.admin_users (user_id) values ($1::uuid)", [sub]);
    }
    if (flags && flags.staff && sub) {
      await q("insert into public.book_staff_users (user_id, active) values ($1::uuid, true)", [sub]);
    }
    await q("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims || {})]);
    if (role) await exec("set role " + role);
    try {
      return await fn();
    } finally {
      await exec("reset role");
    }
  }

  async function insertBook(fields) {
    const row = Object.assign({ category: "رومان", source: "romanlar.html" }, fields);
    const keys = Object.keys(row).filter((key) => row[key] !== undefined);
    const rows = await q(
      `insert into public.books (${keys.join(",")}) values (${keys.map((_, index) => "$" + (index + 1)).join(",")}) returning id`,
      keys.map((key) => row[key])
    );
    return rows[0].id;
  }

  const activeId = await insertBook({
    title: "ئاكتىپ",
    author: "يالغۇز ئاپتور",
    publisher: "بىر نەشرىيات",
    is_active: true
  });
  const pendingId = await insertBook({
    title: "كۈتۈش",
    author: "كونا ئاپتور",
    is_active: false,
    submission_status: "pending",
    submitted_by: STAFF
  });
  const inactiveId = await insertBook({
    title: "يوشۇرۇن",
    author: "يوشۇرۇن ئاپتور",
    is_active: false
  });

  await asSession("authenticated", { aal: "aal2", sub: OTHER }, { admin: true }, async () => {
    await q(
      "select public.set_book_credits($1, $2::jsonb, $3::jsonb, $4)",
      [activeId, JSON.stringify(["ئاپتور ئالف", "ئاپتور بېت"]), JSON.stringify(["تەرجىمان ئالف"]), "نەشر ئالف"]
    );
  });
  const linked = await q(
    `select i.display_name
     from public.book_credits c
     join public.catalog_identities i on i.id = c.identity_id
     where c.book_id = $1 and c.role = 'author'
     order by c.position`,
    [activeId]
  );
  check("explicit admin write keeps two authors in order", linked.map((row) => row.display_name).join("|") === "ئاپتور ئالف|ئاپتور بېت");
  const authorText = await q("select author from public.books where id = $1", [activeId]);
  check("explicit write stores the compatible joined text", authorText[0].author === "ئاپتور ئالف، ئاپتور بېت");

  const authorId = (await q(
    `select c.identity_id::text as id
     from public.book_credits c
     where c.book_id = $1 and c.role = 'author' and c.position = 0`,
    [activeId]
  ))[0].id;
  await q("update public.books set translator = $2, publisher = $3 where id = $1", [inactiveId, "كونا تەرجىمان", "كونا نەشر"]);
  await asSession("authenticated", { aal: "aal2", sub: OTHER }, { admin: true }, async () => {
    await q("select public.set_book_credits($1, $2::jsonb, '[]'::jsonb, null)", [
      inactiveId,
      JSON.stringify(["ئاپتور ئالف", "ئاپتور بېت"])
    ]);
  });
  const optionalColumns = await q("select translator, publisher from public.books where id = $1", [inactiveId]);
  check(
    "empty translator and publisher become null on the existing books schema",
    optionalColumns[0].translator == null && optionalColumns[0].publisher == null,
    JSON.stringify(optionalColumns[0])
  );
  const optionalAuthors = await q(
    `select i.display_name
     from public.book_credits c
     join public.catalog_identities i on i.id = c.identity_id
     where c.book_id = $1 and c.role = 'author'
     order by c.position`,
    [inactiveId]
  );
  check(
    "empty optional roles keep both authors in order",
    optionalAuthors.map((row) => row.display_name).join("|") === "ئاپتور ئالف|ئاپتور بېت"
  );
  const optionalTranslators = await q(
    "select count(*)::int as n from public.book_credits where book_id = $1 and role = 'translator'",
    [inactiveId]
  );
  check("empty translator stores no translator links", optionalTranslators[0].n === 0, String(optionalTranslators[0].n));
  const translatorBook = [{ id: await insertBook({ title: "تەرجىمە", author: "باشقا ئاپتور", is_active: true }) }];
  await asSession("authenticated", { aal: "aal2", sub: OTHER }, { admin: true }, async () => {
    await q("select public.set_book_credits($1, $2::jsonb, $3::jsonb, null)", [
      translatorBook[0].id,
      JSON.stringify(["باشقا ئاپتور"]),
      JSON.stringify(["ئاپتور ئالف"])
    ]);
  });

  await exec("reset role");
  await q("update public.books set author = $2 where id = $1", [activeId, "ئاپتور ئالف، ئاپتور بېت، ئاپتور گىم"]);
  const afterCollapse = await q(
    `select i.display_name
     from public.book_credits c
     join public.catalog_identities i on i.id = c.identity_id
     where c.book_id = $1 and c.role = 'author'
     order by c.position`,
    [activeId]
  );
  check(
    "ambiguous text does not collapse existing contributors",
    afterCollapse.map((row) => row.display_name).join("|") === "ئاپتور ئالف|ئاپتور بېت",
    afterCollapse.map((row) => row.display_name).join("|")
  );

  async function expectReject(name, role, claims, flags, sql, params) {
    let rejected = false;
    let message = "";
    try {
      await asSession(role, claims, flags, async () => {
        await q(sql, params);
      });
    } catch (error) {
      rejected = true;
      message = error.message || String(error);
    }
    check(name, rejected, message.split("\n")[0]);
  }

  await expectReject(
    "anon cannot execute set_book_credits",
    "anon",
    {},
    {},
    "select public.set_book_credits($1, $2::jsonb, '[]'::jsonb, null)",
    [activeId, JSON.stringify(["باشقا"])]
  );
  await expectReject(
    "ordinary authenticated user cannot execute set_book_credits",
    "authenticated",
    { aal: "aal2", sub: OTHER },
    {},
    "select public.set_book_credits($1, $2::jsonb, '[]'::jsonb, null)",
    [activeId, JSON.stringify(["باشقا"])]
  );
  await expectReject(
    "admin AAL1 cannot execute set_book_credits",
    "authenticated",
    { aal: "aal1", sub: OTHER },
    { admin: true },
    "select public.set_book_credits($1, $2::jsonb, '[]'::jsonb, null)",
    [activeId, JSON.stringify(["باشقا"])]
  );
  await expectReject(
    "staff AAL2 cannot edit another pending book",
    "authenticated",
    { aal: "aal2", sub: OTHER },
    { staff: true },
    "select public.set_own_pending_book_credits($1, $2::jsonb, '[]'::jsonb, null)",
    [pendingId, JSON.stringify(["يېڭى"])]
  );
  await expectReject(
    "staff AAL1 cannot edit an own pending book",
    "authenticated",
    { aal: "aal1", sub: STAFF },
    { staff: true },
    "select public.set_own_pending_book_credits($1, $2::jsonb, '[]'::jsonb, null)",
    [pendingId, JSON.stringify(["يېڭى"])]
  );

  await asSession("authenticated", { aal: "aal2", sub: STAFF }, { staff: true }, async () => {
    await q("select public.set_own_pending_book_credits($1, $2::jsonb, '[]'::jsonb, null)", [
      pendingId,
      JSON.stringify(["خادىم ئاپتور", "خادىم شېرىك"])
    ]);
  });
  const staffCredits = await q(
    `select i.display_name from public.book_credits c
     join public.catalog_identities i on i.id = c.identity_id
     where c.book_id = $1 and c.role = 'author' order by c.position`,
    [pendingId]
  );
  check("staff AAL2 writes own pending contributors in order", staffCredits.map((row) => row.display_name).join("|") === "خادىم ئاپتور|خادىم شېرىك");

  await exec("reset role");
  await q("update public.books set submission_status = 'approved', is_active = true where id = $1", [pendingId]);
  const beforeRace = staffCredits.map((row) => row.display_name).join("|");
  await expectReject(
    "staff credit write fails after approval",
    "authenticated",
    { aal: "aal2", sub: STAFF },
    { staff: true },
    "select public.set_own_pending_book_credits($1, $2::jsonb, '[]'::jsonb, null)",
    [pendingId, JSON.stringify(["ئالماشتۇرۇلغان"])]
  );
  const afterRace = await q(
    `select i.display_name from public.book_credits c
     join public.catalog_identities i on i.id = c.identity_id
     where c.book_id = $1 and c.role = 'author' order by c.position`,
    [pendingId]
  );
  check("approval wins over a later staff credit write", afterRace.map((row) => row.display_name).join("|") === beforeRace);

  const anonAuthors = await asSession("anon", {}, {}, async () => q(
    `select b.id from public.books b
     join public.book_credits c on c.book_id = b.id
     where c.identity_id = $1::uuid and c.role = 'author'
     order by b.id`,
    [authorId]
  ));
  check(
    "anon author filter excludes the translator-only and inactive books",
    anonAuthors.length === 1 && String(anonAuthors[0].id) === String(activeId),
    JSON.stringify(anonAuthors)
  );
  const anonTotal = await asSession("anon", {}, {}, async () => q(
    `select count(*)::int as n from public.books b
     join public.book_credits c on c.book_id = b.id
     where c.identity_id = $1::uuid and c.role = 'author'`,
    [authorId]
  ));
  check("anon author total is one", anonTotal[0].n === 1, String(anonTotal[0].n));

  const reviewBefore = await q("select count(*)::int as n from public.catalog_credit_review");
  await q("select book_id, role, legacy_value from public.catalog_credit_review");
  const reviewAfter = await q("select count(*)::int as n from public.catalog_credit_review");
  check("reading catalog_credit_review does not change review rows", reviewBefore[0].n === reviewAfter[0].n);

  const mapped = "ئەنۋەر جاپپار، پەرھات جىلانوۋ، قادىر قاۋۇز";
  const mappedBook = [{ id: await insertBook({ title: "خەرىتە", author: mapped, is_active: true }) }];
  await q("update public.books set author = $2 where id = $1", [mappedBook[0].id, mapped]);
  const paddedBook = [{ id: await insertBook({ title: "بوشلۇق", author: mapped + " ", is_active: true }) }];
  const unmapped = "باشقا ئىسىم، خەرىتىدە يوق";
  const unmappedBook = [{ id: await insertBook({ title: "خەرىتىسىز", author: unmapped, is_active: true }) }];
  await q("update public.books set author = $2 where id = $1", [unmappedBook[0].id, unmapped]);
  const newerText = "باشقا ئىسىم، يېڭىراق";
  const staleBook = [{ id: await insertBook({ title: "كونا خەرىتە", author: "يېڭى ئاپتور", is_active: true }) }];
  const firstMap = "ھاجى مىرزاھىد كېرىمى، ساۋۇت داۋۇت";
  const secondMap = "شى شۇەن، جىن چۈنمىڭ";
  const historyBook = [{ id: await insertBook({ title: "كۆپ خەرىتە", author: "باشلانغۇچ", is_active: true }) }];
  await asSession("authenticated", { aal: "aal2", sub: OTHER }, { admin: true }, async () => {
    await q("select public.set_book_credits($1, $2::jsonb, '[]'::jsonb, null)", [
      staleBook[0].id,
      JSON.stringify(["يېڭى ئاپتور", "يېڭى شېرىك"])
    ]);
    await q("select public.set_book_credits($1, $2::jsonb, '[]'::jsonb, null)", [
      historyBook[0].id,
      JSON.stringify(["ۋاقىتلىق", "ئىسىم"])
    ]);
  });
  await q("update public.books set author = $2 where id = $1", [staleBook[0].id, mapped]);
  await q("update public.books set author = $2 where id = $1", [staleBook[0].id, newerText]);
  await q("update public.books set author = $2 where id = $1", [historyBook[0].id, firstMap]);
  await q("update public.books set author = $2 where id = $1", [historyBook[0].id, secondMap]);
  await exec(readSql("STAGE106_CATALOG_CREDIT_CORRECTIONS.sql"));
  const corrected = await q("select book_id, role, status from public.apply_catalog_credit_corrections() order by book_id");
  const mappedNames = await q(
    `select i.display_name from public.book_credits c
     join public.catalog_identities i on i.id = c.identity_id
     where c.book_id = $1 and c.role = 'author' order by c.position`,
    [mappedBook[0].id]
  );
  check(
    "reviewed correction preserves mapped order",
    mappedNames.map((row) => row.display_name).join("|") === "ئەنۋەر جاپپار|پەرھات جىلانوۋ|قادىر قاۋۇز",
    mappedNames.map((row) => row.display_name).join("|")
  );
  check("correction result includes the mapped book", corrected.some((row) => String(row.book_id) === String(mappedBook[0].id) && row.status === "corrected"));
  const unresolved = await q("select book_id, role, legacy_value from public.catalog_credit_unresolved()");
  check(
    "unmapped review row stays unresolved",
    unresolved.some((row) => String(row.book_id) === String(unmappedBook[0].id) && row.legacy_value === unmapped),
    JSON.stringify(unresolved)
  );
  const unmappedCredits = await q("select count(*)::int as n from public.book_credits where book_id = $1", [unmappedBook[0].id]);
  check("unmapped string was not split into credits", unmappedCredits[0].n === 0, String(unmappedCredits[0].n));
  const paddedNames = await q(
    `select i.display_name from public.book_credits c
     join public.catalog_identities i on i.id = c.identity_id
     where c.book_id = $1 and c.role = 'author' order by c.position`,
    [paddedBook[0].id]
  );
  check(
    "trimmed current text still matches the reviewed whole string",
    paddedNames.map((row) => row.display_name).join("|") === "ئەنۋەر جاپپار|پەرھات جىلانوۋ|قادىر قاۋۇز"
      && corrected.some((row) => String(row.book_id) === String(paddedBook[0].id) && row.status === "corrected"),
    paddedNames.map((row) => row.display_name).join("|")
  );
  async function authorState(bookId) {
    const text = await q("select author from public.books where id = $1", [bookId]);
    const credits = await q(
      `select i.display_name from public.book_credits c
       join public.catalog_identities i on i.id = c.identity_id
       where c.book_id = $1 and c.role = 'author' order by c.position`,
      [bookId]
    );
    return {
      author: text[0].author,
      names: credits.map((row) => row.display_name).join("|")
    };
  }
  const staleState = await authorState(staleBook[0].id);
  check(
    "a newer ambiguous value keeps its text and credits",
    staleState.author === newerText
      && staleState.names === "يېڭى ئاپتور|يېڭى شېرىك"
      && corrected.some((row) => String(row.book_id) === String(staleBook[0].id) && row.status === "skipped-stale")
      && !corrected.some((row) => String(row.book_id) === String(staleBook[0].id) && row.status === "corrected"),
    JSON.stringify(staleState)
  );
  const historyState = await authorState(historyBook[0].id);
  const historyRows = corrected.filter((row) => String(row.book_id) === String(historyBook[0].id));
  check(
    "older mapped reviews do not replace the current mapped names",
    historyState.author === secondMap
      && historyState.names === "شى شۇەن|جىن چۈنمىڭ"
      && historyRows.some((row) => row.status === "corrected")
      && historyRows.some((row) => row.status === "skipped-stale")
      && !historyState.names.includes("ھاجى مىرزاھىد كېرىمى"),
    JSON.stringify({ historyState, historyRows })
  );
  const beforeSecondApply = await q(
    `select c.book_id, c.role, c.position, i.display_name
     from public.book_credits c
     join public.catalog_identities i on i.id = c.identity_id
     where c.book_id = any($1::bigint[])
     order by c.book_id, c.role, c.position`,
    [[mappedBook[0].id, paddedBook[0].id, staleBook[0].id, historyBook[0].id]]
  );
  const repeated = await q("select book_id, role, status from public.apply_catalog_credit_corrections() order by book_id");
  const afterSecondApply = await q(
    `select c.book_id, c.role, c.position, i.display_name
     from public.book_credits c
     join public.catalog_identities i on i.id = c.identity_id
     where c.book_id = any($1::bigint[])
     order by c.book_id, c.role, c.position`,
    [[mappedBook[0].id, paddedBook[0].id, staleBook[0].id, historyBook[0].id]]
  );
  check(
    "repeat application preserves already corrected contributors",
    JSON.stringify(beforeSecondApply) === JSON.stringify(afterSecondApply)
      && !repeated.some((row) => String(row.book_id) === String(mappedBook[0].id))
      && repeated.some((row) => String(row.book_id) === String(staleBook[0].id) && row.status === "skipped-stale"),
    JSON.stringify(repeated)
  );

  // Custom HTTP test wrapper. It runs the same SQL under a chosen role.
  // It is not PostgREST and it does not call the live Supabase API.
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const role = req.headers["x-test-role"] || "anon";
    const aal = req.headers["x-test-aal"] || "";
    const admin = req.headers["x-test-admin"] === "yes";
    try {
      if (req.method === "GET" && url.pathname === "/rest/v1/books") {
        const identity = (url.searchParams.get("book_credits.identity_id") || "").replace(/^eq\./, "");
        const creditRole = (url.searchParams.get("book_credits.role") || "").replace(/^eq\./, "");
        const rows = await asSession(role, { aal, sub: OTHER }, { admin }, async () => q(
          `select b.id, b.title
           from public.books b
           join public.book_credits c on c.book_id = b.id
           where c.identity_id = $1::uuid and c.role = $2
           order by b.id`,
          [identity, creditRole]
        ));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(rows));
        return;
      }
      if (req.method === "GET" && url.pathname === "/rest/v1/catalog_credit_review") {
        const rows = await asSession(role, { aal, sub: STAFF }, { admin, staff: req.headers["x-test-staff"] === "yes" }, async () =>
          q("select book_id, role, legacy_value from public.catalog_credit_review order by book_id")
        );
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(rows));
        return;
      }
      res.writeHead(404);
      res.end();
    } catch (error) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: error.message || String(error) }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const api = (pathname, headers) => fetch(`http://127.0.0.1:${port}${pathname}`, { headers });
  const anonList = await api(
    `/rest/v1/books?book_credits.identity_id=eq.${authorId}&book_credits.role=eq.author&is_active=eq.true`,
    { "x-test-role": "anon" }
  );
  const anonJson = await anonList.json();
  check("API author filter returns only the active author book", anonList.status === 200 && anonJson.length === 1 && String(anonJson[0].id) === String(activeId), JSON.stringify(anonJson));
  const anonReview = await api("/rest/v1/catalog_credit_review", { "x-test-role": "anon" });
  check("API anon cannot read catalog_credit_review", anonReview.status === 403, String(anonReview.status));
  const userReview = await api("/rest/v1/catalog_credit_review", { "x-test-role": "authenticated", "x-test-aal": "aal2" });
  const userReviewJson = await userReview.json();
  check("API ordinary user reads no review rows", userReview.status === 200 && userReviewJson.length === 0, JSON.stringify(userReviewJson));
  const aal1Review = await api("/rest/v1/catalog_credit_review", { "x-test-role": "authenticated", "x-test-aal": "aal1", "x-test-admin": "yes" });
  const aal1Json = await aal1Review.json();
  check("API admin AAL1 reads no review rows", aal1Review.status === 200 && aal1Json.length === 0, JSON.stringify(aal1Json));
  const staffReview = await api("/rest/v1/catalog_credit_review", { "x-test-role": "authenticated", "x-test-aal": "aal2", "x-test-staff": "yes" });
  const staffReviewJson = await staffReview.json();
  check("API staff AAL2 reads no review rows", staffReview.status === 200 && staffReviewJson.length === 0, JSON.stringify(staffReviewJson));
  const adminReview = await api("/rest/v1/catalog_credit_review", { "x-test-role": "authenticated", "x-test-aal": "aal2", "x-test-admin": "yes" });
  const adminReviewJson = await adminReview.json();
  check("API admin AAL2 can read unresolved review rows", adminReview.status === 200 && adminReviewJson.some((row) => row.legacy_value === unmapped), JSON.stringify(adminReviewJson));
  server.close();

  const formPlan = C.planCreditSave({ authors: ["ئاپتور ئالف", "ئاپتور بېت", "ئاپتور گىم"], translators: [], publisher: "نەشر ئالف" });
  let legacyFallback = false;
  const rejectedForm = await C.commitAdminContributorWrite({
    plan: formPlan,
    writeBook: async (columns) => {
      if (columns) throw new Error("admin form included legacy columns");
      return { error: null };
    },
    writeCredits: async () => {
      try {
        await asSession("authenticated", { aal: "aal1", sub: OTHER }, { admin: true }, async () => {
          await q("select public.set_book_credits($1, $2::jsonb, $3::jsonb, $4)", [
            activeId,
            JSON.stringify(formPlan.authors),
            JSON.stringify(formPlan.translators),
            formPlan.publisher
          ]);
        });
        return { error: null };
      } catch (error) {
        return { error: { code: error.code || "42501", message: error.message } };
      }
    },
    writeLegacyText: async () => {
      legacyFallback = true;
      return { error: null };
    }
  });
  check("admin form RPC rejection does not write legacy text", rejectedForm.status === "credit-failed" && legacyFallback === false, rejectedForm.status);
  const stillTwo = await q(
    `select count(*)::int as n from public.book_credits where book_id = $1 and role = 'author'`,
    [activeId]
  );
  check("admin form rejection keeps the two author links", stillTwo[0].n === 2, String(stillTwo[0].n));
  const acceptedForm = await C.commitAdminContributorWrite({
    plan: formPlan,
    writeBook: async () => ({ error: null }),
    writeCredits: async () => {
      await asSession("authenticated", { aal: "aal2", sub: OTHER }, { admin: true }, async () => {
        await q("select public.set_book_credits($1, $2::jsonb, $3::jsonb, $4)", [
          activeId,
          JSON.stringify(formPlan.authors),
          JSON.stringify(formPlan.translators),
          formPlan.publisher
        ]);
      });
      return { error: null };
    },
    writeLegacyText: async () => ({ error: null })
  });
  const three = await q(
    `select i.display_name from public.book_credits c
     join public.catalog_identities i on i.id = c.identity_id
     where c.book_id = $1 and c.role = 'author' order by c.position`,
    [activeId]
  );
  check(
    "admin form retry writes credits and text together",
    acceptedForm.status === "saved" && three.map((row) => row.display_name).join("|") === "ئاپتور ئالف|ئاپتور بېت|ئاپتور گىم",
    three.map((row) => row.display_name).join("|")
  );

  const protectedBooks = [activeId, mappedBook[0].id, pendingId];
  const beforeRepeat = await q(
    `select c.book_id, c.role, c.position, i.display_name
     from public.book_credits c
     join public.catalog_identities i on i.id = c.identity_id
     where c.book_id = any($1::bigint[])
     order by c.book_id, c.role, c.position`,
    [protectedBooks]
  );
  await exec(readSql("STAGE106_CATALOG_CREDITS.sql"));
  const afterRepeat = await q(
    `select c.book_id, c.role, c.position, i.display_name
     from public.book_credits c
     join public.catalog_identities i on i.id = c.identity_id
     where c.book_id = any($1::bigint[])
     order by c.book_id, c.role, c.position`,
    [protectedBooks]
  );
  check("repeat apply does not replace existing contributor rows", JSON.stringify(beforeRepeat) === JSON.stringify(afterRepeat));
  const preservedAuthor = (await q("select author from public.books where id = $1", [activeId]))[0].author;
  await exec(readSql("STAGE106_CATALOG_CREDITS_ROLLBACK.sql"));
  const gone = await q("select to_regclass('public.book_credits') as credits, to_regclass('public.catalog_credit_correction_map') as corrections");
  const authorAfterRollback = (await q("select author from public.books where id = $1", [activeId]))[0].author;
  check("rollback drops credit tables", gone[0].credits == null && gone[0].corrections == null, JSON.stringify(gone[0]));
  check("rollback keeps the legacy author text", authorAfterRollback === preservedAuthor, authorAfterRollback);
  await exec(readSql("STAGE106_CATALOG_CREDITS.sql"));
  const restored = await q("select to_regclass('public.book_credits') as credits");
  check("reapply restores book_credits", restored[0].credits === "book_credits");

  await db.close();
  console.log("ISOLATED_DB: direct SQL uses PGlite. The HTTP checks use a custom wrapper in this script, not PostgREST and not the live Supabase API.");
  try {
    await runConcurrentLockProof();
  } catch (error) {
    check("two independent PostgreSQL sessions", false, error && error.stack || String(error));
  }
  if (failures.length) {
    console.error("STAGE106 isolated postgres: FAIL");
    failures.forEach((item) => console.error(" - " + item));
    process.exit(1);
  }
  console.log("STAGE106 isolated postgres: PASS");
  console.log("FORM_BROWSER_BLOCKER: no local Supabase Auth or AAL2 browser login. Admin create/edit and staff submit/retry are exercised through the real form scripts with controlled sessions, not a signed-in browser.");
}

main().catch((error) => {
  console.error("STAGE106 isolated postgres: BLOCKED");
  console.error(error && error.stack || error);
  process.exit(1);
});
