#!/usr/bin/env node
// Isolated database coverage for search_public_catalog_lexical and the paid-call ledger.
// Never point this at production.
import fs from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), "utf8");
const catalog = JSON.parse(read("scripts/fixtures/public-catalog-search-stage2.json"));
const pglitePath = process.env.TEMP + "/kutadgu-stage2-pglite/node_modules/@electric-sql/pglite/dist/index.js";
if (!fs.existsSync(pglitePath)) {
  console.error("isolated Postgres driver is not available at", pglitePath);
  process.exit(1);
}
const { PGlite } = await import(pathToFileURL(pglitePath).href);
const Ai = await import(new URL("../kutadgu-ai-search.js", import.meta.url));

const db = new PGlite();
const failures = [];
const check = (name, fn) => Promise.resolve().then(fn).then(() => {
  console.log("PASS", name);
}).catch((error) => {
  failures.push(name);
  console.error("FAIL", name, error && error.message);
});

async function rows(sql, params) {
  const result = await db.query(sql, params);
  return result.rows;
}

await db.exec(`
CREATE SCHEMA IF NOT EXISTS private;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE TABLE public.books (
  id bigint PRIMARY KEY,
  title text NOT NULL,
  author text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  price numeric,
  image_url text NOT NULL DEFAULT '',
  stock integer NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  submission_status text NOT NULL DEFAULT 'approved'
);
CREATE TABLE public.book_volume_groups (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug text,
  title text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  is_public boolean NOT NULL DEFAULT false,
  public_slug text
);
CREATE TABLE public.book_volume_group_members (
  group_id bigint NOT NULL REFERENCES public.book_volume_groups(id),
  book_id bigint NOT NULL UNIQUE REFERENCES public.books(id),
  position integer NOT NULL,
  PRIMARY KEY (group_id, position)
);
CREATE FUNCTION private.kutadgu_public_volume_groups()
RETURNS TABLE (
  group_id bigint,
  title text,
  author text,
  member_count integer,
  member_book_ids bigint[],
  lowest_price numeric,
  representative_book_id bigint,
  representative_image_url text
)
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $groups$
  SELECT g.id, g.title, '', count(*)::integer,
         array_agg(m.book_id ORDER BY m.position),
         min(b.price),
         (array_agg(m.book_id ORDER BY m.position))[1],
         (array_agg(b.image_url ORDER BY m.position))[1]
  FROM public.book_volume_groups g
  JOIN public.book_volume_group_members m ON m.group_id = g.id
  JOIN public.books b ON b.id = m.book_id
  WHERE g.is_public AND g.is_active AND g.public_slug IS NOT NULL
  GROUP BY g.id, g.title
  HAVING count(*) BETWEEN 2 AND 100
    AND bool_and(b.is_active AND b.submission_status = 'approved' AND b.price IS NOT NULL AND b.price >= 0)
    AND min(m.position) = 1
    AND max(m.position) = count(*)
$groups$;
REVOKE ALL ON FUNCTION private.kutadgu_public_volume_groups() FROM PUBLIC, anon, authenticated, service_role;
`);
await db.exec(read("STAGE_AI_SEARCH_2_PUBLIC_CATALOG_LEXICAL.sql"));
await db.exec(read("STAGE_AI_SEARCH_2_QUERY_BUDGET.sql"));

for (const row of catalog) {
  await db.query(
    `INSERT INTO public.books (id, title, author, category, price, image_url, description, is_active, submission_status)
     VALUES ($1, $2, $3, $4, 40, $5, $6, true, 'approved')`,
    [row.id, row.title, row.author || "", row.category || "", "https://example.invalid/member/" + row.id + ".webp", row.has_description ? "ئاممىۋى چۈشەندۈرۈش" : ""]
  );
}
const bySeries = new Map();
for (const row of catalog) {
  if (!row.series_slug || !row.series_title) continue;
  if (!bySeries.has(row.series_slug)) bySeries.set(row.series_slug, { title: row.series_title, books: [] });
  bySeries.get(row.series_slug).books.push(row);
}
for (const [slug, group] of bySeries) {
  if (group.books.length < 2) continue;
  const inserted = await db.query(
    `INSERT INTO public.book_volume_groups (slug, title, is_public, is_active, public_slug)
     VALUES ($1, $2, true, true, $1) RETURNING id`,
    [slug, group.title]
  );
  let position = 1;
  for (const book of group.books) {
    await db.query(
      `INSERT INTO public.book_volume_group_members (group_id, book_id, position) VALUES ($1, $2, $3)`,
      [inserted.rows[0].id, book.id, position]
    );
    position += 1;
  }
}
await db.query(`
  UPDATE public.books AS b
  SET price = 15,
      image_url = 'https://example.invalid/series/' || g.public_slug || '.webp'
  FROM public.book_volume_group_members AS m
  JOIN public.book_volume_groups AS g ON g.id = m.group_id
  WHERE m.position = 1 AND b.id = m.book_id AND g.is_public
`);
await db.exec(`
INSERT INTO public.books (id, title, author, category, price, description, is_active, submission_status)
VALUES
  (990001, 'يوشۇرۇن كىتاب', 'يوشۇرۇن ئاپتور', 'رومان', 9, 'يوشۇرۇن', false, 'approved'),
  (990002, 'تەستىقسىز كىتاب', 'تەستىقسىز ئاپتور', 'رومان', 9, 'تەستىقسىز', true, 'pending'),
  (990003, 'مەخپىي بىر', 'مەخپىي ئاپتور', 'رومان', 9, '', true, 'approved'),
  (990004, 'مەخپىي ئىككى', 'مەخپىي ئاپتور', 'رومان', 9, '', true, 'approved');
INSERT INTO public.book_volume_groups (slug, title, is_public, is_active, public_slug)
VALUES ('private-series', 'مەخپىي تىزىس', false, true, 'private-series');
INSERT INTO public.book_volume_group_members (group_id, book_id, position)
SELECT g.id, b.id, CASE b.id WHEN 990003 THEN 1 ELSE 2 END
FROM public.book_volume_groups g
JOIN public.books b ON b.id IN (990003, 990004)
WHERE g.slug = 'private-series';
`);

await check("the SQL function retrieves every one of the 604 public titles", async () => {
  assert.equal(catalog.length, 604);
  for (const row of catalog) {
    const found = await rows(
      `SELECT id, description FROM public.search_public_catalog_lexical($1::text[], ARRAY[]::text[], 24)`,
      [Ai.queryVariants(row.title)]
    );
    assert.ok(found.some((item) => Number(item.id) === Number(row.id)), row.title);
    if (!row.has_description) {
      const mine = found.find((item) => Number(item.id) === Number(row.id));
      assert.equal(mine.description, "");
    }
  }
});

await check("a query with more than 24 matches stays capped and exact titles stay first", async () => {
  const capped = await rows(
    `SELECT id, title FROM public.search_public_catalog_lexical(ARRAY['قىسىم'], ARRAY[]::text[], 100)`
  );
  assert.equal(capped.length, 24);
  assert.ok(capped.every((row) => String(row.title).includes("قىسىم")));
  const exact = catalog.find((row) => row.title === "قىسىم");
  if (exact) assert.equal(Number(capped[0].id), Number(exact.id));
});

await check("published series, spelling variants, and hidden rows", async () => {
  const series = catalog.find((row) => row.series_slug && row.series_title && row.title !== row.series_title);
  const found = await rows(
    `SELECT series_title, series_slug, series_group_id FROM public.search_public_catalog_lexical($1::text[], ARRAY[]::text[], 24)`,
    [[series.series_title]]
  );
  assert.ok(found.some((row) => row.series_slug === series.series_slug && row.series_title === series.series_title));
  assert.ok(found.every((row) => row.series_group_id));
  const folded = catalog.find((row) => String(row.author).includes("چىڭغىز") || String(row.title).includes("چىڭغىز"));
  assert.ok(folded);
  const variant = await rows(
    `SELECT id FROM public.search_public_catalog_lexical($1::text[], ARRAY[]::text[], 24)`,
    [Ai.queryVariants(String(folded.author).includes("چىڭغىز") ? "چىڭگىز ئايتماتوۋ" : folded.title.replace("چىڭغىز", "چىڭگىز"))]
  );
  assert.ok(variant.some((row) => Number(row.id) === Number(folded.id)));
  const hidden = await rows(
    `SELECT id FROM public.search_public_catalog_lexical(ARRAY['يوشۇرۇن كىتاب','تەستىقسىز كىتاب','مەخپىي تىزىس'], ARRAY[]::text[], 24)`
  );
  assert.equal(hidden.length, 0);
});

await check("series grouping, volume lookup, covers, prices, and broad categories", async () => {
  const grouped = [...bySeries.values()].find((group) => group.title === "ئويغانغان زېمىن");
  assert.ok(grouped);
  const seriesRows = await rows(
    `SELECT id, title, series_title, series_slug, series_group_id, series_lowest_price, series_image_url, series_representative_id
     FROM public.search_public_catalog_lexical(ARRAY['ئويغانغان زېمىن'], ARRAY[]::text[], 24)`
  );
  assert.equal(seriesRows.length, 1);
  assert.equal(seriesRows[0].series_title, "ئويغانغان زېمىن");
  assert.equal(Number(seriesRows[0].series_lowest_price), 15);
  assert.equal(seriesRows[0].series_image_url, "https://example.invalid/series/" + seriesRows[0].series_slug + ".webp");
  const volume = grouped.books.find((book) => book.title.includes("1"));
  const volumeRows = await rows(
    `SELECT id, title, price, series_group_id FROM public.search_public_catalog_lexical($1::text[], ARRAY[]::text[], 24)`,
    [[volume.title]]
  );
  assert.ok(volumeRows.some((row) => Number(row.id) === Number(volume.id) && row.title === volume.title));
  const children = await rows(
    `SELECT title, category FROM public.search_public_catalog_lexical(ARRAY['بالىلار'], ARRAY['بالىلار كىتابلىرى'], 24)`
  );
  assert.equal(children.length, 24);
  assert.ok(children.every((row) => String(row.title).includes("بالىلار")));
  const history = await rows(
    `SELECT id, title FROM public.search_public_catalog_lexical(ARRAY['تارىخىي رومان'], ARRAY['تارىخىي رومانلار','تارىخىي رومان'], 24)`
  );
  assert.equal(history.length, 24);
  const mapped = seriesRows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    author: "",
    category: "",
    price: 40,
    image_url: "https://example.invalid/member/" + row.id + ".webp",
    series_title: row.series_title,
    series_slug: row.series_slug,
    series_group_id: Number(row.series_group_id),
    series_member_count: grouped.books.length,
    series_lowest_price: Number(row.series_lowest_price),
    series_image_url: row.series_image_url,
    series_representative_id: Number(row.series_representative_id)
  }));
  const presented = Ai.presentSearchResults("ئويغانغان زېمىن", mapped);
  assert.equal(presented.length, 1);
  assert.equal(presented[0].kind, "group");
  assert.equal(presented[0].title, "ئويغانغان زېمىن");
  assert.equal(presented[0].price, 15);
  assert.equal(presented[0].image_url, seriesRows[0].series_image_url);
  assert.equal(presented[0].public_slug, seriesRows[0].series_slug);
});

await check("literal patterns do not expand wildcards or backslashes", async () => {
  for (const query of ["%%%", "___", "%_%", "\\", "\\\\", "...", "!!!", "؟؟؟", "يەر%"]) {
    const found = await rows(
      `SELECT count(*)::int AS n FROM public.search_public_catalog_lexical(ARRAY[$1], ARRAY[]::text[], 24)`,
      [query]
    );
    assert.equal(found[0].n, 0, query);
  }
  const literal = catalog.find((row) => row.title.includes("يەر"));
  const hit = await rows(
    `SELECT id FROM public.search_public_catalog_lexical(ARRAY[$1], ARRAY[]::text[], 24)`,
    [literal.title]
  );
  assert.ok(hit.some((row) => Number(row.id) === Number(literal.id)));
});

await check("the paid ledger is locked, capped, and fail-closed", async () => {
  const hash = "ab".repeat(16);
  const first = await rows(`SELECT allowed, remaining_micro_usd FROM public.reserve_ai_search_paid_call($1)`, [hash]);
  assert.equal(first[0].allowed, true);
  assert.equal(Number(first[0].remaining_micro_usd), 999900);
  await db.query(`UPDATE private.ai_search_query_budget SET remaining_micro_usd = 150, calls_today = 0`);
  const second = await rows(`SELECT allowed FROM public.reserve_ai_search_paid_call($1)`, [hash]);
  assert.equal(second[0].allowed, true);
  const third = await rows(`SELECT allowed, remaining_micro_usd FROM public.reserve_ai_search_paid_call($1)`, [hash]);
  assert.equal(third[0].allowed, false);
  assert.equal(Number(third[0].remaining_micro_usd), 50);
  await db.query(`UPDATE private.ai_search_query_budget SET remaining_micro_usd = 1000000, calls_today = 200`);
  const daily = await rows(`SELECT allowed FROM public.reserve_ai_search_paid_call($1)`, ["cd".repeat(16)]);
  assert.equal(daily[0].allowed, false);
  await db.query(`UPDATE private.ai_search_query_budget SET calls_today = 0`);
  await db.query(`DELETE FROM private.ai_search_ip_windows`);
  for (let i = 0; i < 5; i += 1) {
    const call = await rows(`SELECT allowed FROM public.reserve_ai_search_paid_call($1)`, ["ef".repeat(16)]);
    assert.equal(call[0].allowed, true);
  }
  const blocked = await rows(`SELECT allowed FROM public.reserve_ai_search_paid_call($1)`, ["ef".repeat(16)]);
  assert.equal(blocked[0].allowed, false);
  await db.query(
    `INSERT INTO private.ai_search_ip_windows (ip_hash, window_start, calls) VALUES ($1, now() - interval '11 minutes', 3)`,
    ["12".repeat(16)]
  );
  await rows(`SELECT allowed FROM public.reserve_ai_search_paid_call($1)`, ["13".repeat(16)]);
  const expired = await rows(`SELECT count(*)::int AS n FROM private.ai_search_ip_windows WHERE ip_hash = $1`, ["12".repeat(16)]);
  assert.equal(expired[0].n, 0);
  const bad = await rows(`SELECT allowed FROM public.reserve_ai_search_paid_call($1)`, [""]);
  assert.equal(bad[0].allowed, false);
  const before = await rows(`SELECT remaining_micro_usd FROM private.ai_search_query_budget`);
  await db.exec(read("STAGE_AI_SEARCH_2_QUERY_BUDGET.sql"));
  const after = await rows(`SELECT remaining_micro_usd FROM private.ai_search_query_budget`);
  assert.equal(Number(after[0].remaining_micro_usd), Number(before[0].remaining_micro_usd));
  const tables = await rows(`
    SELECT has_table_privilege('service_role', 'private.ai_search_query_budget', 'UPDATE') AS budget,
           has_table_privilege('service_role', 'private.ai_search_ip_windows', 'UPDATE') AS windows
  `);
  assert.equal(tables[0].budget, false);
  assert.equal(tables[0].windows, false);
  await db.query(`DELETE FROM private.ai_search_query_budget`);
  const missing = await rows(`SELECT allowed FROM public.reserve_ai_search_paid_call($1)`, [hash]);
  assert.equal(missing[0].allowed, false);
  const priv = await rows(`
    SELECT has_function_privilege('anon', 'public.reserve_ai_search_paid_call(text)', 'EXECUTE') AS anon,
           has_function_privilege('authenticated', 'public.reserve_ai_search_paid_call(text)', 'EXECUTE') AS authenticated,
           has_function_privilege('public', 'public.reserve_ai_search_paid_call(text)', 'EXECUTE') AS public,
           has_function_privilege('service_role', 'public.reserve_ai_search_paid_call(text)', 'EXECUTE') AS service
  `);
  assert.deepEqual(priv[0], { anon: false, authenticated: false, public: false, service: true });
  const catalogPriv = await rows(`
    SELECT has_function_privilege('anon', 'public.search_public_catalog_lexical(text[],text[],integer)', 'EXECUTE') AS anon,
           has_function_privilege('service_role', 'public.search_public_catalog_lexical(text[],text[],integer)', 'EXECUTE') AS service
  `);
  assert.equal(catalogPriv[0].anon, false);
  assert.equal(catalogPriv[0].service, true);
});

await db.close();
if (failures.length) {
  console.error("failures", failures.join(", "));
  process.exit(1);
}
console.log("ai-search-stage2-sql-catalog-tests ok");
