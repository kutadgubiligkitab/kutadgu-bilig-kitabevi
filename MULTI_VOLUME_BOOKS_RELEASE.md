# Multi-volume books release and rollback

The repository ships this feature dark. `app-config.js` keeps
`multiVolumeBooks:false`, and server-rendered group routes, grouped category
pages, grouped sitemaps, and grouped AI results additionally require
`MULTI_VOLUME_BOOKS_ENABLED=true`.

No migration links existing books automatically.

## Reviewed apply order

Apply manually, in order, after taking a database backup:

0. Confirm Stage 106 catalog credits is already applied; Stage 130 deliberately
   fails preflight if its `book_credits` contract is absent.
1. `STAGE127_BOOK_VOLUME_GROUPS.sql`
2. `STAGE128_BOOK_VOLUME_COMMERCE.sql`
3. `STAGE129_SHARED_CART_TYPED_LINES.sql`
4. `STAGE130_BOOK_VOLUME_STOREFRONT.sql`

Run each isolated PostgreSQL script before touching the target database. Verify
the target schema against the migration prerequisites; do not substitute the
setup rollup for live-schema evidence.

After SQL is applied:

1. Deploy the application with both public exposure controls still off.
2. Use the admin+AAL2 volume-group editor to link existing book IDs in explicit
   order. Confirm the previewed ID, ISBN, cover, price, stock, and URL before
   each link.
3. Save the group privately. Confirm the representative volume and set price.
   A null set price means the current sum of all member prices.
4. Use the separate revision-checked publish action. Publishing fails if any
   required member is inactive, unapproved, unpriced, duplicated, or missing.
5. Exercise quotes, mixed volume/set orders, confirmation, cancellation, order
   history, direct child URLs, and the stable group URL in a non-production
   environment.
6. Set `MULTI_VOLUME_BOOKS_ENABLED=true` on both application hosts.
7. Change `app-config.js` to `multiVolumeBooks:true` in a reviewed deployment.
   Confirm grouped catalog counts, category first-byte output, normal/AI
   search, randomized pagination, sitemap output, cart sharing, and checkout.

The server-side flag should be enabled before the client flag and disabled
after the client flag during rollback, so browsers never receive group URLs
that the server refuses.

## Data-preserving rollback

For an application rollback:

1. Restore `multiVolumeBooks:false` and deploy it.
2. Keep Stage 127–130 SQL installed while any set cart, set order, or shared
   typed link exists.
3. Set `MULTI_VOLUME_BOOKS_ENABLED=false` after the client rollback is live.

This immediately restores the legacy flat catalog while preserving book IDs,
memberships, carts, set snapshots, order history, and stock behavior.

Do **not** restore the pre-Stage-128 stock parser while a set order exists.
Confirmation, cancellation/restoration, retry idempotency, committed-book
deletion protection, and inventory aggregation must continue to use immutable
saved components. The Stage 128 rollback intentionally retains those
component-aware helpers.

Only after all typed set carts, shared links, and set orders have been retained
or migrated to an equivalent component-aware format may the reviewed rollback
scripts be considered, in reverse order:

1. `STAGE130_BOOK_VOLUME_STOREFRONT_ROLLBACK.sql`
2. `STAGE129_SHARED_CART_TYPED_LINES_ROLLBACK.sql`
3. `STAGE128_BOOK_VOLUME_COMMERCE_ROLLBACK.sql`
4. `STAGE127_BOOK_VOLUME_GROUPS_ROLLBACK.sql`

Stage 127 cannot be removed while memberships or dependent commerce rows
remain. Never delete or rewrite child `books` rows to roll back catalog
grouping.
