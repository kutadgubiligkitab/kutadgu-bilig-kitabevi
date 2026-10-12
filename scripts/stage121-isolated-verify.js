#!/usr/bin/env node
"use strict";

// Throwaway Postgres and PostgREST proof for cart-share permissions.
// Does not open the live Supabase project.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pathToFileURL } = require("url");
const { spawn } = require("child_process");

const root = path.join(__dirname, "..");
const MEMBER = "11111111-1111-4111-8111-111111111111";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const SUSPENDED = "66666666-6666-4666-8666-666666666666";
const NOPROFILE = "77777777-7777-4777-8777-777777777777";
const FUTURE = "99999999-9999-4999-8999-999999999999";
const failures = [];
const items = JSON.stringify([{ id: "246", qty: 1 }]);
function acceptedExpiry() {
  return new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
}
const distantExpiry = "2099-01-01T00:00:00.000Z";

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
      ('${MEMBER}'), ('${ADMIN}'), ('${SUSPENDED}'), ('${NOPROFILE}'), ('${FUTURE}')
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
      status text not null default 'active' check (status in ('active','suspended'))
    );
    insert into public.profiles (id, email, full_name, status) values
      ('${MEMBER}', 'member@example.com', 'Member', 'active'),
      ('${ADMIN}', 'admin@example.com', 'Admin', 'active'),
      ('${SUSPENDED}', 'suspended@example.com', 'Suspended', 'suspended')
    on conflict (id) do update set status = excluded.status;
    create or replace function public.is_kutadgu_admin()
    returns boolean language sql stable security definer set search_path = public
    as $$ select exists (select 1 from public.admin_users where user_id = auth.uid()); $$;
    revoke all on function public.is_kutadgu_admin() from public, anon, authenticated, service_role;
    grant execute on function public.is_kutadgu_admin() to authenticated;
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
    check(name, pattern.test(message), message.slice(0, 180));
  }
}

async function permission(client, sub) {
  const result = await asRole(client, "authenticated", sub, "aal1", () =>
    client.query("select public.my_cart_share_permission() as allowed")
  );
  return result.rows[0].allowed;
}

async function createLink(client, sub, code, expiry) {
  const result = await asRole(client, "authenticated", sub, "aal1", () =>
    client.query("select public.create_member_shared_cart_link($1, $2::jsonb, $3::timestamptz) as result", [code, items, expiry === undefined ? acceptedExpiry() : expiry])
  );
  return result.rows[0].result;
}

async function linkCount(client) {
  const result = await client.query("select count(*)::integer as count from public.shared_cart_links");
  return result.rows[0].count;
}

function jwt(claims) {
  const secret = "01234567890123456789012345678901";
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(Object.assign({ exp: Math.floor(Date.now() / 1000) + 3600 }, claims))).toString("base64url");
  const data = header + "." + body;
  return data + "." + crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

async function postgrestProof(dbName, client) {
  const bin = process.env.POSTGREST_BIN || "/tmp/postgrest";
  if (!fs.existsSync(bin)) {
    check("PostgREST binary is available", false, bin);
    return;
  }
  const port = 34121;
  const conf = "/tmp/stage121-postgrest.conf";
  fs.writeFileSync(conf, [
    'db-uri = "postgres://authenticator:postgrest-local@127.0.0.1:55481/' + dbName + '"',
    'db-schemas = "public"',
    'db-anon-role = "anon"',
    'jwt-secret = "01234567890123456789012345678901"',
    "server-port = " + port
  ].join("\n"));
  const child = spawn(bin, [conf], { stdio: ["ignore", "pipe", "pipe"] });
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const probe = await fetch("http://127.0.0.1:" + port + "/");
      if (probe.status < 500) { ready = true; break; }
    } catch (error) {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  check("PostgREST starts for cart share", ready);
  if (!ready) { child.kill(); return; }
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
  const missing = await rpc("create_member_shared_cart_link", { p_code: "Ab3K7xQ2", p_items: [{ id: "246", qty: 1 }], p_expires_at: acceptedExpiry() }, "");
  check("PostgREST missing token cannot create", missing.status !== 200, String(missing.status));
  const forged = await rpc("create_member_shared_cart_link", { p_code: "Ab3K7xQ2", p_items: [{ id: "246", qty: 1 }], p_expires_at: acceptedExpiry() }, "aaa.bbb.ccc");
  check("PostgREST forged token cannot create", forged.status !== 200, String(forged.status));
  const expiredBody = Buffer.from(JSON.stringify({
    role: "authenticated",
    sub: MEMBER,
    exp: Math.floor(Date.now() / 1000) - 60
  })).toString("base64url");
  const expiredHeader = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const expiredData = expiredHeader + "." + expiredBody;
  const expired = expiredData + "." + crypto.createHmac("sha256", "01234567890123456789012345678901").update(expiredData).digest("base64url");
  const expiredCall = await rpc("my_cart_share_permission", {}, expired);
  check("PostgREST expired token cannot read permission", expiredCall.status !== 200, String(expiredCall.status));
  const anon = await rpc("create_member_shared_cart_link", { p_code: "Ab3K7xQ2", p_items: [{ id: "246", qty: 1 }], p_expires_at: acceptedExpiry() }, jwt({ role: "anon" }));
  check("PostgREST anon cannot create", anon.status !== 200, String(anon.status));
  const service = await rpc("create_member_shared_cart_link", { p_code: "Ab3K7xQ2", p_items: [{ id: "246", qty: 1 }], p_expires_at: acceptedExpiry() }, jwt({ role: "service_role", sub: MEMBER }));
  check("PostgREST service_role cannot call the member creator", service.status !== 200, String(service.status));
  const oldCreator = await rpc("create_shared_cart_link", { p_code: "Ab3K7xQ2", p_items: [{ id: "246", qty: 1 }], p_expires_at: acceptedExpiry() }, jwt({ role: "authenticated", sub: MEMBER }));
  check("PostgREST authenticated cannot call the service creator", oldCreator.status !== 200, String(oldCreator.status));
  const self = await rpc("admin_set_cart_share_grant", { p_user_id: MEMBER, p_granted: true }, jwt({ role: "authenticated", aal: "aal2", sub: MEMBER }));
  check("PostgREST member cannot grant sharing", self.status !== 200, String(self.status));
  const aal1 = await rpc("admin_cart_share_state", { p_user_ids: [] }, jwt({ role: "authenticated", aal: "aal1", sub: ADMIN }));
  check("PostgREST admin AAL1 cannot read cart-share state", aal1.status !== 200, String(aal1.status));
  const aal2 = await rpc("admin_set_cart_share_grant", { p_user_id: ADMIN, p_granted: true }, jwt({ role: "authenticated", aal: "aal2", sub: ADMIN }));
  check("PostgREST admin AAL2 can grant the signed-in admin", aal2.status === 200 && aal2.text.indexOf(ADMIN) !== -1, String(aal2.status));
  const table = await fetch("http://127.0.0.1:" + port + "/cart_share_grants", {
    headers: { Authorization: "Bearer " + jwt({ role: "authenticated", aal: "aal2", sub: ADMIN }), Accept: "application/json" }
  });
  check("PostgREST cannot select the grant table", table.status !== 200, String(table.status));
  const links = require(path.join(root, "kutadgu-shared-cart-links.js"));
  const memberGrant = await rpc("admin_set_cart_share_grant", { p_user_id: MEMBER, p_granted: true }, jwt({ role: "authenticated", aal: "aal2", sub: ADMIN }));
  check("PostgREST admin grant is ready for the worker handler", memberGrant.status === 200, String(memberGrant.status) + " " + memberGrant.text.slice(0, 120));
  const caller = jwt({ role: "authenticated", sub: MEMBER });
  async function forwardFetch(url, init) {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "").replace(/^\/rest\/v1/, "");
    const target = "http://127.0.0.1:" + port + path;
    return fetch(target, { method: init && init.method, headers: init && init.headers, body: init && init.body });
  }
  const created = await links.handleSharedCartApi({
    method: "POST",
    pathname: "/api/shared-cart",
    authorization: "Bearer " + caller,
    body: JSON.stringify({ items: [{ id: "246", qty: 1 }] }),
    fetchImpl: forwardFetch,
    generateCode: () => "WrkAaa22"
  });
  const createdRow = await client.query("select expires_at <= now() + interval '30 days' as capped, expires_at > now() + interval '30 days' - interval '1 minute' as fresh from public.shared_cart_links where code = 'WrkAaa22'");
  check("worker handler creates with the caller JWT and a 30-day row", created.status === 200 && created.body && created.body.ok === true && createdRow.rows.length === 1 && createdRow.rows[0].capped === true && createdRow.rows[0].fresh === true, JSON.stringify(created.body || created.status));
  const revokeMember = await rpc("admin_set_cart_share_grant", { p_user_id: MEMBER, p_granted: false }, jwt({ role: "authenticated", aal: "aal2", sub: ADMIN }));
  check("PostgREST admin revoke is ready for the worker handler", revokeMember.status === 200, String(revokeMember.status));
  const deniedCreate = await links.handleSharedCartApi({
    method: "POST",
    pathname: "/api/shared-cart",
    authorization: "Bearer " + caller,
    body: JSON.stringify({ items: [{ id: "246", qty: 1 }] }),
    fetchImpl: forwardFetch,
    generateCode: () => "WrkBbb22"
  });
  const deniedRow = await client.query("select count(*)::integer as count from public.shared_cart_links where code = 'WrkBbb22'");
  check("worker handler denies creation after revoke", deniedCreate.status === 403 && deniedCreate.body && deniedCreate.body.error === "denied" && deniedRow.rows[0].count === 0, JSON.stringify(deniedCreate.body || deniedCreate.status));
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}

async function main() {
  const base = "/tmp/stage107-pg/node_modules";
  const pg = require(path.join(base, "pg"));
  const embedded = await import(pathToFileURL(path.join(base, "embedded-postgres", "dist", "index.js")).href);
  const EmbeddedPostgres = embedded.default;
  const dir = path.join("/tmp", "stage121-pg-data-" + Date.now());
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port: 55481,
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
    await server.createDatabase("stage121");
    const connect = () => new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:55481/stage121" });
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
    await client.query(readSql("STAGE105_SHARED_CART_LINKS.sql"));
    await client.query(readSql("STAGE121_CART_SHARE_PERMISSIONS.sql"));
    await client.query(readSql("STAGE121_CART_SHARE_PERMISSIONS.sql"));
    check("repeat migration is safe", true);

    const flags = await client.query(`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('cart_share_settings','cart_share_grants')
      order by c.relname
    `);
    check("permission tables force RLS", flags.rows.length === 2 && flags.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity));
    const privileges = await client.query(`
      select table_name, grantee, privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public' and table_name in ('cart_share_settings','cart_share_grants')
        and grantee in ('anon','authenticated','service_role','public')
    `);
    check("permission tables have no API grants", privileges.rows.length === 0, String(privileges.rows.length));
    for (const fn of [
      "public.my_cart_share_permission()",
      "public.admin_cart_share_state(uuid[])",
      "public.admin_set_cart_share_global(boolean)",
      "public.admin_set_cart_share_grant(uuid, boolean)",
      "public.create_member_shared_cart_link(text, jsonb, timestamptz)"
    ]) {
      for (const role of ["anon", "service_role", "public"]) {
        const allowed = await client.query("select has_function_privilege($1, $2, 'execute') as allowed", [role, fn]);
        check(role + " cannot execute " + fn, allowed.rows[0].allowed === false);
      }
      const memberExec = await client.query("select has_function_privilege('authenticated', $1, 'execute') as allowed", [fn]);
      check("authenticated can execute " + fn, memberExec.rows[0].allowed === true);
    }
    const oldExec = await client.query("select has_function_privilege('authenticated', 'public.create_shared_cart_link(text, jsonb, timestamptz)', 'execute') as allowed");
    check("authenticated still cannot execute create_shared_cart_link", oldExec.rows[0].allowed === false);
    const paths = await client.query(`
      select proname, prosecdef, proconfig
      from pg_proc
      where pronamespace = 'public'::regnamespace
        and proname in ('my_cart_share_permission','admin_cart_share_state','admin_set_cart_share_global','admin_set_cart_share_grant','create_member_shared_cart_link')
    `);
    check("privileged functions are security definer with a fixed search_path", paths.rows.length === 5 && paths.rows.every((row) => row.prosecdef && String(row.proconfig).indexOf("search_path=pg_catalog, public") !== -1));

    check("default member permission is false", await permission(client, MEMBER) === false);
    check("default admin is not auto-granted", await permission(client, ADMIN) === false);
    check("suspended permission is false", await permission(client, SUSPENDED) === false);
    check("missing profile permission is false", await permission(client, NOPROFILE) === false);
    check("default create stores nothing", await createLink(client, MEMBER, "DenydnAA") === "denied" && await linkCount(client) === 0);

    await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select public.admin_set_cart_share_grant($1, true)", [MEMBER])
    );
    check("individual grant allows the member", await permission(client, MEMBER) === true);
    check("individual grant creates one link", await createLink(client, MEMBER, "GrantAaa") === "ok" && await linkCount(client) === 1);
    const stored = await client.query("select items, code, expires_at <= now() + interval '30 days' as capped, expires_at > now() + interval '30 days' - interval '1 minute' as fresh from public.shared_cart_links where code = 'GrantAaa'");
    check("link row has no account identity", stored.rows.length === 1 && JSON.stringify(stored.rows[0]).indexOf(MEMBER) === -1);
    check("stored lifetime is the database clock plus 30 days", stored.rows[0].capped === true && stored.rows[0].fresh === true);
    const beforeDistant = await linkCount(client);
    check("a distant caller expiry is rejected", await createLink(client, MEMBER, "FarAa2x9", distantExpiry) === "invalid" && await linkCount(client) === beforeDistant);
    const infinity = await asRole(client, "authenticated", MEMBER, "aal1", () =>
      client.query("select public.create_member_shared_cart_link('InfinitA', $1::jsonb, 'infinity'::timestamptz) as result", [items])
    );
    check("infinity does not extend the lifetime", infinity.rows[0].result === "invalid" && await linkCount(client) === beforeDistant);
    check("an already expired caller timestamp is rejected", await createLink(client, MEMBER, "PastAaa2", "2000-01-01T00:00:00.000Z") === "invalid" && await linkCount(client) === beforeDistant);
    check("a null caller timestamp is rejected", await createLink(client, MEMBER, "NullAaa2", null) === "invalid" && await linkCount(client) === beforeDistant);
    await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select public.admin_set_cart_share_grant($1, false)", [MEMBER])
    );
    const afterRevoke = await linkCount(client);
    check("revoke denies and stores nothing more", await createLink(client, MEMBER, "DenydnBB") === "denied" && await linkCount(client) === afterRevoke);
    check("saved grant remains false", (await client.query("select granted from public.cart_share_grants where user_id = $1", [MEMBER])).rows[0].granted === false);

    await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select public.admin_set_cart_share_global(true)")
    );
    const grantsBefore = await client.query("select user_id, granted from public.cart_share_grants order by user_id");
    await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select public.admin_set_cart_share_global(false)")
    );
    await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select public.admin_set_cart_share_global(true)")
    );
    const grantsAfter = await client.query("select user_id, granted from public.cart_share_grants order by user_id");
    check("global toggles do not rewrite grants", JSON.stringify(grantsBefore.rows) === JSON.stringify(grantsAfter.rows));
    const globalFlag = await client.query("select global_enabled from public.cart_share_settings");
    const globalPermission = await permission(client, MEMBER);
    const globalCreate = await createLink(client, MEMBER, "MegaAaa2");
    check("global mode allows an active member without a grant", globalFlag.rows[0].global_enabled === true && globalPermission === true && globalCreate === "ok", JSON.stringify({ flag: globalFlag.rows[0].global_enabled, permission: globalPermission, create: globalCreate }));
    check("global mode still denies a suspended profile", await createLink(client, SUSPENDED, "MegaBbb2") === "denied");
    check("global mode still denies a missing profile", await createLink(client, NOPROFILE, "MegaCcc2") === "denied");
    await client.query("insert into public.profiles (id, email, full_name, status) values ($1, 'future@example.com', 'Future', 'active')", [FUTURE]);
    check("global mode allows a future active member", await createLink(client, FUTURE, "MegaDdd2") === "ok");
    await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select public.admin_set_cart_share_global(false)")
    );
    check("global off returns to the saved false grant", await permission(client, MEMBER) === false && await createLink(client, FUTURE, "MegaEee2") === "denied");
    await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select public.admin_set_cart_share_grant($1, true)", [MEMBER])
    );
    check("the saved individual grant works again", await createLink(client, MEMBER, "GrantBbb") === "ok");

    await expectError("admin AAL1 cannot read state", () => asRole(client, "authenticated", ADMIN, "aal1", () =>
      client.query("select public.admin_cart_share_state($1::uuid[])", [[MEMBER]])
    ), /42501/);
    await expectError("member cannot grant sharing", () => asRole(client, "authenticated", MEMBER, "aal2", () =>
      client.query("select public.admin_set_cart_share_grant($1, true)", [MEMBER])
    ), /42501/);
    await expectError("member cannot write the grant table", () => asRole(client, "authenticated", MEMBER, "aal1", () =>
      client.query("insert into public.cart_share_grants (user_id, granted) values ($1, true)", [MEMBER])
    ), /42501|permission denied/);
    await client.query("alter table public.profiles add column if not exists phone text, add column if not exists country text, add column if not exists city text, add column if not exists address text");
    await client.query("grant select (id, full_name, phone, country, city, address), update (full_name, phone, country, city, address) on public.profiles to authenticated");
    await asRole(client, "authenticated", FUTURE, "aal1", () =>
      client.query("update public.profiles set full_name = 'Changed' where id = $1", [FUTURE])
    );
    const ungrantedEdit = await client.query("select count(*)::integer as count from public.cart_share_grants where user_id = $1 and granted", [FUTURE]);
    check("profile edit of an ungranted member does not enable sharing", ungrantedEdit.rows[0].count === 0 && await permission(client, FUTURE) === false && await createLink(client, FUTURE, "EditAaaa") === "denied");

    const selfBefore = await permission(client, ADMIN);
    check("admin starts without an effective grant", selfBefore === false);
    const state = await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select public.admin_cart_share_state($1::uuid[]) as payload", [[MEMBER]])
    );
    check("batched state includes self and the page", state.rows[0].payload.self_id === ADMIN && state.rows[0].payload.grants.length === 1);
    await asRole(client, "authenticated", ADMIN, "aal2", () =>
      client.query("select public.admin_set_cart_share_grant($1, true)", [ADMIN])
    );
    check("the signed-in admin can grant their own account", await permission(client, ADMIN) === true && await createLink(client, ADMIN, "MineAaa2") === "ok");

    await client.query("begin");
    await left.query("begin");
    await left.query("select pg_catalog.pg_advisory_xact_lock(841211211)");
    let revokeSettled = false;
    const revokeCreate = asRole(right, "authenticated", MEMBER, "aal1", () =>
      right.query("select public.create_member_shared_cart_link($1, $2::jsonb, $3::timestamptz) as result", ["RaceAaaa", items, acceptedExpiry()])
    ).then((value) => { revokeSettled = true; return value; });
    await new Promise((resolve) => setTimeout(resolve, 400));
    check("create waits while the permission lock is held", revokeSettled === false);
    await left.query("update public.cart_share_grants set granted = false where user_id = $1", [MEMBER]);
    await left.query("commit");
    const revoked = await revokeCreate;
    check("a concurrent revoke denies the waiting create", revoked.rows[0].result === "denied");
    check("the waiting create did not insert", (await client.query("select count(*)::integer as count from public.shared_cart_links where code = 'RaceAaaa'")).rows[0].count === 0);
    await client.query("rollback");

    await left.query("begin");
    await left.query("select pg_catalog.pg_advisory_xact_lock(841211211)");
    let globalSettled = false;
    const waitingGlobalCreate = asRole(right, "authenticated", FUTURE, "aal1", () =>
      right.query("select public.create_member_shared_cart_link($1, $2::jsonb, $3::timestamptz) as result", ["RaceBbbb", items, acceptedExpiry()])
    ).then((value) => { globalSettled = true; return value; });
    await new Promise((resolve) => setTimeout(resolve, 400));
    check("a second create also waits for the permission lock", globalSettled === false);
    await left.query("update public.cart_share_settings set global_enabled = true where id = 1");
    await left.query("commit");
    const opened = await waitingGlobalCreate;
    check("global mode turned on under the lock allows the waiting create", opened.rows[0].result === "ok");
    const preserved = await client.query("select granted from public.cart_share_grants where user_id = $1", [MEMBER]);
    check("that global change left the individual grant false", preserved.rows[0].granted === false);

    await client.query("update public.cart_share_settings set global_enabled = false where id = 1");
    await client.query("update public.cart_share_grants set granted = true where user_id = $1", [MEMBER]);
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    for (let index = 0; index < 300; index += 1) {
      let rest = "";
      let value = index;
      for (let place = 0; place < 7; place += 1) {
        rest = alphabet[value % alphabet.length] + rest;
        value = Math.floor(value / alphabet.length);
      }
      await client.query("insert into public.shared_cart_links (code, items, created_at, expires_at) values ($1, $2::jsonb, now(), now() + interval '30 days')", ["Z" + rest, items]);
    }
    check("the rate cap denies without another row", await createLink(client, MEMBER, "RateAaaa") === "rate_limited");
    await client.query("delete from public.shared_cart_links where code like 'Z%'");
    await client.query("insert into public.shared_cart_links (code, items, expires_at) values ('Dupxcode', $1::jsonb, now() + interval '30 days')", [items]);
    check("a code collision returns conflict", await createLink(client, MEMBER, "Dupxcode") === "conflict");

    const beforeReapply = await client.query("select global_enabled from public.cart_share_settings");
    const grantReapply = await client.query("select count(*)::integer as count from public.cart_share_grants");
    const linkReapply = await linkCount(client);
    await client.query(readSql("STAGE121_CART_SHARE_PERMISSIONS.sql"));
    const afterReapply = await client.query("select global_enabled from public.cart_share_settings");
    check("reapply preserves the global flag, grants, and links",
      beforeReapply.rows[0].global_enabled === afterReapply.rows[0].global_enabled
      && (await client.query("select count(*)::integer as count from public.cart_share_grants")).rows[0].count === grantReapply.rows[0].count
      && await linkCount(client) === linkReapply);

    await client.query(readSql("STAGE121_CART_SHARE_PERMISSIONS_ROLLBACK.sql"));
    const dropped = await client.query("select to_regclass('public.cart_share_grants') as grants, to_regclass('public.shared_cart_links') as links, to_regprocedure('public.create_member_shared_cart_link(text, jsonb, timestamptz)') as creator");
    check("rollback drops permissions and keeps links", dropped.rows[0].grants === null && dropped.rows[0].creator === null && dropped.rows[0].links !== null && await linkCount(client) === linkReapply);
    await client.query(readSql("STAGE121_CART_SHARE_PERMISSIONS.sql"));
    check("reapply after rollback starts from global off", (await client.query("select global_enabled from public.cart_share_settings")).rows[0].global_enabled === false);
    check("reapply after rollback does not invent grants", (await client.query("select count(*)::integer as count from public.cart_share_grants")).rows[0].count === 0);

    await client.query("do $$ begin create role authenticator login password 'postgrest-local' noinherit; exception when duplicate_object then null; end $$");
    await client.query("grant anon, authenticated, service_role to authenticator");
    await client.query("grant usage on schema public to authenticator");
    await postgrestProof("stage121", client);
  } finally {
    if (left) await left.end().catch(() => {});
    if (right) await right.end().catch(() => {});
    if (client) await client.end().catch(() => {});
    await server.stop().catch(() => {});
  }
  if (failures.length) {
    console.error(failures.length + " stage121 check(s) failed");
    process.exit(1);
  }
  console.log("stage121 isolated verify ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
