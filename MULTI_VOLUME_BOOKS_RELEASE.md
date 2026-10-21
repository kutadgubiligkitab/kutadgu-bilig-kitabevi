# Multi-volume books release and rollback

PR #300 stays dark: `app-config.js` keeps `multiVolumeBooks:false`, and
server-rendered group routes, grouped category pages, grouped sitemaps, and
grouped AI results additionally require `MULTI_VOLUME_BOOKS_ENABLED=true`.
This activation branch is separate. It sets the production Worker variable
`MULTI_VOLUME_BOOKS_ENABLED` to `true` and `app-config.js` `multiVolumeBooks`
to `true`. Do not merge it into PR #300 or deploy it before the sequence
below. The preview Worker is unchanged.

No migration links existing books automatically.

## Reviewed sequence

1. Merge draft PR #300 through the normal path. Keep its reviewed head
   `4de1384aa8e204e30b5b848543a6429f3bafb7fc` until that merge. Do not deploy a
   documentation commit made after the merge.
2. Apply `STAGE131_BOOK_VOLUME_SERIES_ENTRY.sql` once, with both exposure
   flags still off. Stages 127–130 are already installed; do not reapply them.
   Leave group 1, `series-156`, books 156 and 157, and the explicit 750 TRY
   set price unchanged.
3. From a clean checkout of that exact merge, deploy with
   `wrangler deploy --env production --keep-vars`.
4. Verify that deploy before any public exposure: the owner series is
   unchanged, and grouped routes stay unavailable while the flags are off.
5. Deploy this activation only after it is reviewed. One production Worker
   version carries both flag changes: `MULTI_VOLUME_BOOKS_ENABLED=true` on
   `kutadgu-cloudflare-production`, and `multiVolumeBooks:true` in
   `app-config.js`.

Keep installed SQL during a Worker rollback. Use the Stage 131 rollback file
only as a separately reviewed database rollback, and only after accounting for
series rows created by `admin_create_book_volume_series`. Do not reverse
Stages 127–130 while group 1 or any later series still has members.

## Reviewed apply order

Apply manually, in order, after taking a database backup:

0. Confirm Stage 106 catalog credits is already applied; Stage 130 deliberately
   fails preflight if its `book_credits` contract is absent.
1. `STAGE127_BOOK_VOLUME_GROUPS.sql`
2. `STAGE128_BOOK_VOLUME_COMMERCE.sql`
3. `STAGE129_SHARED_CART_TYPED_LINES.sql`
4. `STAGE130_BOOK_VOLUME_STOREFRONT.sql`
5. `STAGE131_BOOK_VOLUME_SERIES_ENTRY.sql` after this review. It adds the
   atomic new-series save and the public part-price list. It does not rewrite
   Stages 127–130 and does not update an existing series. Do not apply it
   until the draft is accepted. The production group `series-156` already has
   explicit `complete_set_price` 750; leave that row, its members, covers,
   stock, and URLs unchanged.

Run each isolated PostgreSQL script before touching the target database. Verify
the target schema against the migration prerequisites; do not substitute the
setup rollup for live-schema evidence.

After the dark merge is deployed and verified, the reviewed activation above
is the exposure step. Until that activation is deployed, both flags stay off.

Admin use after Stage 131, still with the flags off:

1. Use the admin+AAL2 volume-group editor to link existing book IDs in explicit
   order. Confirm the previewed ID, ISBN, cover, price, stock, and URL before
   each link. New parts that do not exist yet use «قىسىملىق كىتاب قوشۇش».
   That save creates the books and the private series together. A repeated
   request returns the same series. A failure leaves no public series and no
   extra books. Covers use the existing authorized upload path; cleanup deletes
   only unreferenced `book-covers/series-new/` objects from that failed attempt.
2. Save the group privately. Confirm the representative volume and set price.
   A null set price means the current sum of all member prices. An explicit
   price, including the saved 750 for `series-156`, stays the series price.
3. Use the separate revision-checked publish action. Publishing fails if any
   required member is inactive, unapproved, unpriced, duplicated, or missing.
4. Exercise quotes, mixed volume/set orders, confirmation, cancellation, order
   history, direct child URLs, and the stable group URL in a non-production
   environment.
5. Deploy the reviewed activation. It enables
   `MULTI_VOLUME_BOOKS_ENABLED` on `kutadgu-cloudflare-production` and
   `multiVolumeBooks` in the same version. Confirm grouped catalog counts,
   category first-byte output, normal/AI search, randomized pagination,
   sitemap output, cart sharing, and checkout.

Rollback of exposure deploys the dark merge first, so
`multiVolumeBooks:false` is what browsers receive. Then set
`MULTI_VOLUME_BOOKS_ENABLED` to `false` on the production Worker. A version
rollback to the dark merge restores that version's assets and bindings
together. Keep the installed SQL either way.

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
