# Readable series URLs — revised local report

Base: `a0d90eeb2326576942b55b8bd6e38dfed6b9ce93`. Branch: `readable-series-urls`. This report describes the final compatibility design, superseding the coupled-release design previously reviewed. No production migration, deployment, merge, push or production write was performed.

## Implementation

Stage 138 adds immutable `book_volume_groups.public_slug`, allocates title-based ASCII slugs using the existing Uyghur folding map, and backfills in ascending group-ID order. Duplicate bases receive `-<group ID>`, then an attempt suffix if necessary. Both public slugs and legacy aliases are reserved; conflicting new aliases fail explicitly. An advisory transaction lock serializes allocation and a unique index provides a final duplicate guard. IDs, legacy slugs, books, memberships, prices, stock and revisions remain unchanged by the backfill. Title edits retain both URL keys. Private groups receive internal allocations but are excluded from the public route directory.

Unlike the previous candidate, Stage 138 does **not** replace existing public/private catalog or group RPC definitions. It only adds `list_public_book_series_routes()`, filtered through the existing public-group helper. The new shared `kutadgu-series-routes.js` maps legacy public data into URL paths. The compatibility application works before and after migration. Missing-function PGRST202 means legacy URLs; valid directory data enables readable URLs; other errors do not produce permanent guessed redirects.

Before migration, legacy URLs remain 200/no-store with legacy canonical links. Explicit UUID series paths receive only a temporary no-store redirect to the legacy URL. After migration, legacy requests on either www or apex receive one 301 directly to the final HTTPS www readable URL, preserving query parameters and checking group visibility first. Readable pages retain server member anchors, canonical/Open Graph/BookSeries metadata and hydrated individual-volume behavior.

Category SSR, browser catalog/cards, AI result links and generated sitemaps share the same route mapping. Existing RPC fields retain legacy values for old clients. Individual `/book/ID` pages, commerce/quote identity, category anchors, member anchors, privacy deletion link and hidden/retired-category rules are preserved. The deferred stable-page link wording and visibility condition are unchanged.

Illustrative fixture URLs, not production data mappings:

- `ئويغانغان زېمىن` → `/series/oyghanghan-zemin`.
- Duplicate title on group 2 → `/series/oyghanghan-zemin-2`.
- `/volume-group/series-d23590fc-1f72-4b8a-ac62-45bf4ae49105?volume=2` → directly to the corresponding HTTPS www readable URL once Stage 138 is available.
- Newly created `يېڭى يۈرۈشلۈك` → `/series/yengi-yurushluk`.

Browser pins in the prepared release: shop 190→191; AI UI 2→3 where loaded; premium UX 23→24; volume storefront 4→6; new series route helper v1. The HTML changes are cache pins. No CSS change.

## Migration and rollback

Migration uses transaction-local 2-second lock and 15-second statement timeouts and notifies PostgREST to reload schema after commit. Failure aborts the whole transaction; rollback any editor transaction left open and retry the complete script after resolving the cause. Do not increase timeouts or remove protections without review.

The compatibility application must be deployed and recorded **before** migration. It then becomes the postlaunch rollback target. The original pre-compatibility Worker is not a safe target after readable URLs are published. The revised rollback SQL is a non-destructive guard: it retains the directory, aliases and allocator. Actual readable and legacy URL resolution after rollback is tested. New groups continue receiving stable slugs during an application rollback.

See [the release/rollback runbook](readable-series-release-runbook.md) for exact order, commands, timeout semantics, failure handling and limitations. No destructive database rollback is offered after publication; a defect in the durable routing layer requires a forward repair preserving aliases.

## Validation evidence

- PGlite 0.5.14: real Stage SQL, existing-group backfill/collisions, title/alias immutability, repeat apply, real Admin AAL2 new-series creation and retry, isolated publication, duplicate new titles, empty transliteration, alias conflicts, private/invalid omission, anonymous table-access denial, unchanged books/membership, rollback URL resolution and reapply.
- Real SQL-to-Worker release matrix: current database, migrated database and postlaunch compatibility rollback; unchanged old catalog/group/context/sitemap RPC definitions and legacy group payload; old/new links and metadata; one-hop www/apex redirects with queries; private/missing aliases without Location; directory outage 503; readable URLs still 200 and legacy aliases still 301 after rollback.
- PostgreSQL 18.6 in disposable local Docker container: genuinely independent psql sessions, distinct backend PIDs and observed advisory-lock waits. Duplicate-title commit allocates unique slugs; abort releases the bare slug; committed public-slug/legacy-alias conflict is rejected; committed legacy alias is reserved during title allocation; aborted reservation is released. A held read transaction forces migration lock timeout, leaves no partial column, and full retry/reapply succeeds. Container removed after test. Image digest: `sha256:10a5c69a83035ab5239f5620d708520e8b28f5aa1f2b20143e6024532edadfb5`.
- Chromium: both current and migrated DB contracts at mobile/desktop widths; direct load, refresh, hydration, old redirect chain, correct individual member navigation/canonical, no page runtime errors, RTL/overflow. Commerce checks cover selection, totals, cover preview, selected-volume cart and complete-set cart. Existing storefront checks retain stock, set-price, many-part, pagination and 320 px coverage.
- Relevant suites: internal-link discovery, route/API compatibility, category navigation/client/first-byte SEO, Stage 7 sitemap, storefront/cart contracts, compact cards, Cloudflare dispatcher and cover variants; asset-pin preflight, diff whitespace check and Worker dry-run build.

Earlier full-suite baseline failures in admin-save-guard, homepage compact UX and SEO-2H were not repaired or relabeled. No unrelated full-suite rerun was required. Test fixture failures found while adding the route-directory contract were corrected within the affected tests.

## Reproduction and remaining release prerequisites

```sh
npm run test:series-urls
npm install --prefix /tmp/kutadgu-series-pglite --cache /tmp/kutadgu-npm-cache @electric-sql/pglite@0.5.14
npm run test:series-urls:db
npm run test:series-urls:postgres
```

`PGLITE_MODULE` can select an absolute PGlite dist/index.js path. PostgreSQL checks require access to the local Docker socket and image. Browser tests use isolated loopback Worker-dispatch servers and mocked browser REST; this environment uses system Chromium through a temporary configuration override. No production fixture is used.

Local release blockers identified in review have been addressed. Production schema/function drift, backup readiness, the actual deployed versions and edge configuration must still be checked during an authorized release. Local Worker checks establish one-hop routing when requests reach the Worker; no production edge rule was changed or verified in this local-only task. Capture the deployed compatibility version before applying SQL. Production application/SQL verification remains pending by instruction.
