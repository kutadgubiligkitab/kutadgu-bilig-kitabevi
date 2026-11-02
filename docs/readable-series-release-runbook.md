# Readable series URLs: phased release and durable rollback

This is a preparation document. No production command or SQL has been executed.

## Compatibility contract

The application in this branch is the compatibility/rollback application. Deploy and retain this exact reviewed build before installing Stage 138. It supports both database states; no second application deployment is needed to activate readable URLs.

| Database state | Legacy URL on HTTPS www | Internal links/canonical | Explicit `/series/series-UUID` |
| --- | --- | --- | --- |
| Current database; directory RPC missing with PGRST202 | 200, no-store, no redirect | Existing `/volume-group/<legacy>` | 302/no-store to legacy path; never a cached intermediate canonical destination |
| Stage 138 committed and RPC discoverable | 301 directly to final HTTPS www readable URL | `/series/<public_slug>` | 301 directly to readable URL |
| Postlaunch Worker rollback to this compatibility build | Same as Stage 138 | Same published readable URLs | Same as Stage 138 |

The directory RPC is additive. All existing catalog, group, book-context, discovery, sitemap and Admin RPC definitions and legacy slug fields remain unchanged. Old clients retain their existing `/volume-group/` links. The compatible Worker resolves them directly to readable URLs after migration. Individual `/book/ID` canonical URLs remain unchanged.

The directory returns only groups passing the existing public/active/member-validity filter. Both apex redirects and canonical-host redirects resolve visibility before sending a destination. Unknown/private/invalid groups are 404 without Location. Directory/network errors are 503 rather than permanent redirects to a guessed URL. The application treats only missing-function PGRST202 as the old schema.

## Exact future release order

1. Follow the repository's review/CI/Git workflow for this change. Identify the exact reviewed commit and ensure the deployment checkout contains it without unrelated work. Reconcile newer origin/main work without overwriting it. Record current production Worker version, custom domains, bindings and rollback version. Target remains `kutadgu-cloudflare-production`, serving `www.kutadgubilik.com`; do not use Vercel.
2. Deploy the compatibility application **while the current database is unchanged**, using the existing workflow: `node_modules/.bin/wrangler deploy --env production --keep-vars`. Preserve current variables/secrets/bindings. Record the resulting version as `SERIES_COMPAT_VERSION` and its commit/artifact. Keep this release available as the postlaunch rollback target. Wait until it receives 100% of traffic; verify legacy URLs are 200 with legacy canonical links, and no permanent redirects to `/series/series-UUID` are emitted. Do not apply SQL if that verification fails. The original pre-compatibility Worker is not the postlaunch rollback target.
3. Confirm backup/PITR readiness and review actual production schema/function definitions and the title/alias inventory. Manually run the complete `STAGE138_READABLE_SERIES_URLS.sql` transaction through the approved database workflow. The application and CI must not auto-apply SQL. This adds persistent slugs and a new RPC, without changing old RPCs or publishing private groups.
4. Wait for PostgREST's notified schema reload. Read `list_public_book_series_routes()` and verify public allocations. Before the new RPC is visible, the compatibility app continues serving legacy paths; it does not publish a temporary UUID series path. RPC outages other than the missing-function case fail without issuing permanent redirects.
5. Perform read-only checks on HTTPS www and apex legacy links, final canonical pages and hydration; query retention; invalid/private routes; individual member pages; category and volume anchors; privacy link; hidden-category sitemap rules; updated assets and runtime errors. No orders or production fixtures. Confirm legacy RPC payload slug values still match the old contract. Once the directory is discoverable the same compatibility build serves readable links automatically.
6. Retain `SERIES_COMPAT_VERSION`, its source commit, Stage 138 SQL and the public route inventory. No maintenance overlay, DNS/hosting migration, or destructive SQL reversal is required.

## Migration timeout, failure and retry

- `SET LOCAL lock_timeout = '2s'` bounds each lock acquisition; `SET LOCAL statement_timeout = '15s'` bounds each statement, including the backfill DO block. These settings expire at transaction end and do not alter database defaults. They are not a 15-second whole-transaction deadline.
- ALTER TABLE takes Access Exclusive lock and can briefly block group-dependent reads. The write-blocking table lock and DDL lock are held until commit. Run in a quiet window; ordinary transactions continue outside affected resources. This is a bounded database operation, not a promise of zero added latency.
- Lock timeout, statement timeout, deadlock, constraint or privilege failure aborts the transaction. Execute `ROLLBACK` if the editor leaves the failed transaction open, then inspect blockers/error evidence. Do not kill unrelated sessions, disable constraints, or increase timeout blindly.
- Retry the **entire unchanged migration** after resolving the cause. New application code still works with the old database after a failed transaction. The migration is repeat-safe after success; persisted slugs never regenerate. A failed backfill cannot partially publish routes: column, trigger, backfill and directory creation commit together. The schema reload notification is transactional.
- Real PostgreSQL validation held a read transaction while migration attempted DDL: lock timeout occurred, the new column was absent after failure, and full retry plus reapply succeeded.

## Rollback before SQL

If the compatibility application itself fails before Stage 138 is installed, restore the version recorded before step 2 using the normal Worker rollback workflow. The database is untouched and no readable routes have been published. Verify legacy responses and discovery fixes.

## Rollback after Stage 138 / after publication

1. Keep Stage 138 installed. Retain public_slug values, frozen legacy aliases, the allocation trigger, unique index and `list_public_book_series_routes()` RPC. Do not restore a pre-Stage-138 database backup as an application rollback.
2. Review/run `STAGE138_READABLE_SERIES_URLS_ROLLBACK.sql` if a database guard is desired. It is deliberately a **compatibility guard, not a schema reversal**. It verifies the durable contract and removes nothing. If the guard fails, stop and repair the compatibility contract instead of blindly rolling back further.
3. If a later application release introduced the regression, route 100% of Worker traffic back to recorded `SERIES_COMPAT_VERSION` using `node_modules/.bin/wrangler rollback <SERIES_COMPAT_VERSION> --env production`. Verify bindings/variables against the recorded version and do not change hosting configuration. If the active version is already that compatibility version, redeploying it will not repair a defect within it: fix forward while retaining the URL contract.
4. Verify actual GET resolution: every visible directory public_slug resolves 200 at `/series/<public_slug>`; every corresponding legacy alias returns a single 301 to that same HTTPS www URL; hidden/private groups remain unavailable. Verify canonical/member HTML and hydration. The isolated release-stage tests execute this resolution after the SQL guard, rather than checking retained data only.
5. Continue allocating readable slugs for new groups during rollback. Do not drop the RPC or trigger and do not deploy the original Worker that lacks `/series/`. Restoring that original application after publication would break shared readable URLs.

This rollback preserves published URLs by retaining a small permanent routing/schema compatibility layer. It does not reverse Stage 138. If the routing layer or migration itself needs correction, use a reviewed forward repair preserving every published alias; there is no safe generic destructive schema undo after publication.

## Local evidence

- `npm run test:series-urls`: dispatcher and compatibility API/rewrite checks, including pre-migration no-redirect/temporary-redirect handling.
- `npm run test:series-urls:db`: PGlite allocation/Admin-creation checks plus real SQL-to-Worker release-stage matrix, unchanged legacy RPC definitions/payload, canonical links/sitemap/HTML, apex visibility and actual postrollback URL resolution.
- `npm run test:series-urls:postgres`: disposable local PostgreSQL 18 container, independent psql processes/PIDs and observed advisory waits. Covers duplicate-title commit, abort, committed public-slug versus new legacy-alias conflict, committed legacy-alias versus new title collision, aborted alias reservation, migration lock failure/full rollback/retry/reapply. It accepts no production database URL and removes its own container.
- Chromium covers current and migrated DB contracts at 390/1280 px, direct/refresh/hydrated navigation, selection/totals/previews/cart actions, and individual book URLs. Existing storefront checks also cover 320 px, unavailable stock, many-part groups and grouped pagination.
- The separate deferred “يۈرۈشلۈكنىڭ مۇقىم بېتىنى ئېچىش” link has no wording or visibility-condition edit.
