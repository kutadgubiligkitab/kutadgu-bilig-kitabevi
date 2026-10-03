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

  await exec(`
    create schema if not exists auth;
    create or replace function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
    $$;
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(auth.jwt()->>'sub', '')::uuid;
    $$;
    create or replace function public.is_kutadgu_admin() returns boolean language sql stable as $$
      select coalesce(current_setting('kutadgu.test_admin', true), '') = 'yes';
    $$;
    create or replace function public.is_kutadgu_book_staff() returns boolean language sql stable as $$
      select coalesce(current_setting('kutadgu.test_staff', true), '') = 'yes';
    $$;
    create table public.books (
      id bigint generated always as identity primary key,
      title text not null default '',
      author text not null default '',
      translator text,
      publisher text,
      is_active boolean not null default false,
      submission_status text,
      submitted_by uuid
    );
    alter table public.books enable row level security;
    alter table public.books force row level security;
  `);
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
    await q("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims || {})]);
    await q("select set_config('kutadgu.test_admin', $1, false)", [flags && flags.admin ? "yes" : ""]);
    await q("select set_config('kutadgu.test_staff', $1, false)", [flags && flags.staff ? "yes" : ""]);
    if (role) await exec("set role " + role);
    try {
      return await fn();
    } finally {
      await exec("reset role");
    }
  }

  const inserted = await q(
    "insert into public.books (title, author, translator, publisher, is_active, submission_status, submitted_by) values ($1,$2,$3,$4,true,null,null) returning id",
    ["ئاكتىپ", "يالغۇز ئاپتور", null, "بىر نەشرىيات"]
  );
  const activeId = inserted[0].id;
  const pending = await q(
    "insert into public.books (title, author, is_active, submission_status, submitted_by) values ($1,$2,false,'pending',$3) returning id",
    ["كۈتۈش", "كونا ئاپتور", STAFF]
  );
  const pendingId = pending[0].id;
  const inactive = await q(
    "insert into public.books (title, author, is_active) values ($1,$2,false) returning id",
    ["يوشۇرۇن", "يوشۇرۇن ئاپتور"]
  );
  const inactiveId = inactive[0].id;

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
  await asSession("authenticated", { aal: "aal2", sub: OTHER }, { admin: true }, async () => {
    await q("select public.set_book_credits($1, $2::jsonb, '[]'::jsonb, null)", [
      inactiveId,
      JSON.stringify(["ئاپتور ئالف"])
    ]);
  });
  const translatorBook = await q(
    "insert into public.books (title, author, is_active) values ($1,$2,true) returning id",
    ["تەرجىمە", "باشقا ئاپتور"]
  );
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
  const mappedBook = await q(
    "insert into public.books (title, author, is_active) values ($1,$2,true) returning id",
    ["خەرىتە", mapped]
  );
  await q("update public.books set author = $2 where id = $1", [mappedBook[0].id, mapped]);
  const unmapped = "باشقا ئىسىم، خەرىتىدە يوق";
  const unmappedBook = await q(
    "insert into public.books (title, author, is_active) values ($1,$2,true) returning id",
    ["خەرىتىسىز", unmapped]
  );
  await q("update public.books set author = $2 where id = $1", [unmappedBook[0].id, unmapped]);
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
  if (failures.length) {
    console.error("STAGE106 isolated postgres: FAIL");
    failures.forEach((item) => console.error(" - " + item));
    process.exit(1);
  }
  console.log("STAGE106 isolated postgres: PASS");
  console.log("FORM_BROWSER_BLOCKER: no local Supabase Auth or AAL2 session. Admin and staff HTML were not logged in. The form commit functions were executed against this database.");
}

main().catch((error) => {
  console.error("STAGE106 isolated postgres: BLOCKED");
  console.error(error && error.stack || error);
  process.exit(1);
});
