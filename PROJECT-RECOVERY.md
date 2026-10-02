# Project recovery

Handoff for the Kutadgu Bilig bookstore repository. Read this before substantial work, then compare it with `origin/main`. Incident rollback is `STAGE11_RECOVERY.md`. The one-page emergency list is `docs/EMERGENCY.md`.

The runtime baseline below is the last verified application commit. It is not automatically the current GitHub `main` tip. Documentation-only commits, including this handoff, do not move it.

## Project overview

Uyghur-language bookstore storefront. Static HTML, CSS, and JavaScript on Vercel, with the live catalog, accounts, orders, and covers in Supabase. The public UI is RTL. Customers browse, search, and send orders through WhatsApp. There is no in-site card checkout.

Repository: `kutadgubiligkitab/kutadgu-bilig-kitabevi`. Default branch: `main`.

## Production website

- Canonical site: `https://www.kutadgubilik.com` (`KUTADGU_SITE_ORIGIN` in `supabase-config.js`)
- Live `www` and the apex are Cloudflare Worker Custom Domains on `kutadgu-cloudflare-production`. The apex still returns 308 to `https://www.kutadgubilik.com`.
- Apex `kutadgubilik.com` auth callbacks are sent to the `www` host
- `kutadgu-bilig-kitab.vercel.app` is not a production auth, analytics, or PostHog host. Live traffic stays on the Cloudflare custom domains.

## Main stack

- Storefront: static pages (`index.html`, category hubs, `book-shell.html`) plus `shop.js`
- Book URLs: `/book/<id>` is served by `api/book-public.js` through `vercel.json`
- Catalog and accounts: Supabase Auth, Postgres, and Storage (`book-covers`)
- Optional product analytics: PostHog, proxied under `/kbg/` in `vercel.json`
- Tests: Node unit scripts (`npm run test:unit`) and Playwright (`tests/e2e`)
- Node used by Stage 10 CI: 22

## GitHub, Vercel, and Supabase

- GitHub `main` is what Vercel production deploys. Promoting an older Vercel deployment rolls back code only. It does not roll back Supabase.
- SQL files in the repo are manual history. Do not execute them against production from an agent task unless the task explicitly says to.
- Public Supabase project ref, already recorded in `STAGE11_RECOVERY.md`: `fxlojnqwyojqjskfggmh`
- The browser uses the public URL and publishable key in `supabase-config.js`. That file must not gain a service-role key.
- Important tables called out in `STAGE11_RECOVERY.md`: `books`, `admin_users`, `profiles`, `member_favorites`, `member_cart_items`, `orders`, `analytics_events`, plus Supabase `auth.users`.
- Cover and gallery bytes live in the public `book-covers` bucket. Postgres backups do not include those file bytes.

## Important storefront behavior

- Search, category, and listing queries go through Supabase REST from `shop.js`. If Supabase is unavailable, `catalog.js` is only a small static fallback, not the live catalog. A configured remote failure stays an error. It does not switch to those demo books.
- The unfiltered `/books` listing defaults to `بۇ قېتىملىق بايقاش تەرتىپى`. That order is one permutation of the eligible catalog for the current tab visit, stored in `sessionStorage` (`kutadgu-books-visit-v1`). Category pages, the homepage, related books, and favorites do not use it. Search and the named sorts keep their own order. Returning to the default sort in the same visit restores the same order.
- ISBN search uses the ISBN column only when the whole query is shaped like an ISBN: digits, `X`, spaces, or hyphens, and the digit length is exactly 10 or 13.
- Book JSON-LD `isbn` is emitted only for a checksum-valid ISBN-10, or an ISBN-13 with prefix 978 or 979 that is not in the 9790 music range. `gtin13` is that same ISBN-13. A failed check omits both fields and does not substitute a SKU. The visible ISBN row still shows the stored number after spaces and hyphens are removed. These checks do not prove the number was assigned to that book.
- Public pages request active books. Anonymous clients are not given inactive rows. RLS `public can read active books` is `is_active = true`.
- Bestsellers depend on `sales_count > 0`. The homepage shares one in-flight count and keeps it for about 10 minutes. A WhatsApp click does not increment `sales_count`.
- `is_recommended` and `is_new` are admin choices, not the bestseller source.
- View counts render from `book_view_stats` when the total is at least 20 (`THRESHOLD` in `kutadgu-book-views.js`). Completed reads stay cached for 10 minutes. Concurrent reads of the same book id or the same normalized id set share one request. A failed read is not cached. Local preview hosts (`localhost`, `127.0.0.1`, `::1`) skip view-stat reads.
- Stock enforcement defaults on (`KUTADGU_STOCK_ENFORCEMENT`). Prepared orders do not reserve stock. Admin commit deducts it.
- Guest cart and favorites stay in browser localStorage (`kutadgu-cart-v1`, `kutadgu-favorites-v1`). Logged-in member cart and favorites use Supabase.
- Shared cart v1 remains a website link with no database row: `https://www.kutadgubilik.com/cart.html?share=v1.<id>x<qty>.<id>x<qty>`. That payload is only canonical numeric book ids and quantities from 1 to 99, at most 80 unique ids. Opening it still merges into the recipient cart after the live catalog is ready, using the current price and stock, then `history.replaceState` removes `share`.
- New shares from `📤 سېۋەتنى ھەمبەھىرلەش` create an 8-character code and return `https://www.kutadgubilik.com/c/<code>`. `POST /api/shared-cart` and `GET /api/shared-cart/<code>` run in the Worker with `SUPABASE_SECRET_KEY`. The browser never receives that key. `/c/<code>` serves `cart.html` without redirecting to the long query. The same merge path preserves the existing cart, sums duplicate quantities, clamps to live stock, and skips unknown or unavailable ids. A refresh in the same tab does not import that code again; `sessionStorage` key `kutadgu-shared-cart-short-v1` records the code, and the address bar stays `/c/<code>`. A later visit in a new tab can import it again until the row expires. A link stays valid for 30 days. WhatsApp and other link previews use the `cart.html` meta description `ھەمبەھىرلەنگەن كىتابلارنى كۆرۈش ئۈچۈن ئۇلانمىنى ئېچىڭ.` The robots meta stays `noindex, follow`. `create_shared_cart_link` deletes expired rows in the same transaction as a successful insert. The function also allows at most 300 new links every 10 minutes and 1000 new links every 24 hours for the whole site, using a transaction advisory lock and the table's own `created_at` values. Indexes on `created_at` and `expires_at` support those counts and the expired-row delete. `POST /api/shared-cart` rejects a body above 8192 bytes before buffering the rest of it. It does not store an IP address, account id, or other visitor identifier. Rows store only the code, `{id, qty}` items, `created_at`, and `expires_at`. `STAGE105_SHARED_CART_LINKS.sql` is applied on the live Supabase project. RLS is forced; `anon`, `authenticated`, and `PUBLIC` have no access. `service_role` is explicitly limited on the table to `SELECT`, `INSERT`, and `DELETE`, and only `service_role` can execute the validator/create functions. Android and iOS App Links are live for `/c/*` only. The Worker serves `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association` and still denies every other dot-path.
- In dark mode, cart unit price, line total, summary heading, summary figures, grand total, checkout section titles, and the member-note link use `--site-text`. Checkout placeholders use `--site-text-soft`. Light mode still uses `--site-brown-dark` and `--site-brown` for those prices and titles. That block lives in `shop.css` and was not edited again after #233.
- Public dark-mode links and account text are separate from the cart block. Back-links and in-content links on the trust pages use `--site-gold` (`#e2c98d`); visited, hover, and focus use `--site-text`. The brown `.trust-mail-btn` stays white on `--site-brown`. Shop mini-card titles use `--site-text` and their meta line uses `--site-text-soft`. The Google button and `.account-secondary` keep dark brown text on white and cream. Forgot-password, the login/signup switch, the auth kicker, and the privacy link use `--site-gold`. The divider, password toggle, and account placeholders use `--site-text-soft`. The homepage AI search button, show-more control, and meta line use `--site-text`, and their hover stays on the dark card. The password-reset page has no dark theme. Its disabled save button uses `#4b3327` on `#f4efe8` at full opacity. `404.html` stays light-only because it cannot load a script.
- Cover images on cards and the detail page use `object-fit: contain` inside a shared cream frame (`storefront-cover-presentation.css`). The image files are not cropped by that stylesheet.
- The book detail title (`.book-detail-info h1` in `book-shell.html`) is `clamp(22px, 2.6vw, 32px)` with line-height `1.3`. At `760px` and below it is `clamp(21px, 6.2vw, 28px)`. Card titles are unchanged.
- Non-numeric `/book/...` slugs are a noindex 404. `/adabiyat-roman` keeps its own title.
- Poetry and other pages load `UKIJCJK.woff2` first, then `UKIJCJK.ttf`.

## Admin and catalog behavior

- `admin.html` / `admin.js` is the admin catalog, orders, hero, and announcements UI. Admin book reads that see inactive rows require `is_kutadgu_admin()` and AAL2.
- Admin book save shows a status line in the book-modal footer (`#bookSaveStatus`). Deadlines live in `admin-save-guard.js`. Duplicate lookup 25s, exact cover fingerprint 25s, each near-dHash page 45s, cover or gallery Storage upload 180s, books INSERT/UPDATE 45s, catalog refresh 45s, cover decode 60s, WebP encode 45s. A timed-out INSERT or UPDATE is not retried; the alert tells the admin to check the book list first. After the write succeeds, the modal closes and the Save button is restored before `loadBooks()` / `loadStats()`. A failed refresh is a catalog warning, not “Save failed”.
- A new cover is decoded once. That bitmap is reused for dHash and WebP. SHA-256 still hashes the original file. Files over 50 MiB are rejected before decode. Phone photos and ordinary cover scans stay under that ceiling.
- The full near-dHash scan and distance `5` review rule stay. Gallery uploads stay serial, with “image N of M” status. `saveInFlight` and `coverFormEpoch` still block a second write and a stale cover choice.
- `book-staff.html` is the staff portal. New cover and gallery uploads go through `kutadgu-cover-image.js`: WebP quality `0.92`, longest edge `1600` px, no upscale. An in-cap image stays in its original format when the WebP is not smaller. Oversized images keep the resized WebP. Uploads use a unique path (`upsert: false`) and `Cache-Control: public, max-age=31536000, immutable`. The same 50 MiB ceiling and 45s encode timeout apply there.
- Hide and show of inactive books stays in admin. The public storefront does not fetch `is_active=eq.false`.

## Mobile app relationship

This repository is the website. It does not contain the Android app source.

`privacy.html` documents the Android app as a separate client of the same public catalog and Supabase Auth. The app can sign in with email/password or Google. Its cart, favorites, and theme stay on the device and are not synced to the member cart tables. It has no in-app card payment and no separate delivery-address form. Account deletion for the Play listing is the site page `/delete-account`.

Android package `com.kutadgubilig.kitabevi`. Production signing SHA-256 `2C:D7:46:A1:20:BA:11:D7:28:66:26:80:C7:44:C2:84:28:EF:0C:2F:D9:5C:D0:C6:6F:3F:55:E2:9A:28:44:FC`. Apple Team ID `8QU554PCLF`. iOS bundle identifier `com.kutadgubilig.kitabevi`. The canonical App Link path is `/c/*`. `.well-known/assetlinks.json` and `.well-known/apple-app-site-association.json` shipped in #239. The Worker serves the Apple file at `/.well-known/apple-app-site-association`. Production Worker `2a3f8dd4-ffb4-4386-ba3d-216b6c630e23` serves those two URLs with `Content-Type: application/json`, `GET` and `HEAD` 200, and no redirect.

## Last verified runtime/application baseline

This SHA is the last verified application and runtime baseline. It is not necessarily the current `origin/main` tip. Compare the two before substantial work. A documentation-only commit does not require changing it.

| | |
|---|---|
| Commit | `0abd907f22a620b64dc5b84cc235d1ff8e340441` |
| Subject | Merge pull request #239 from kutadgubiligkitab/feat/app-link-association-files |
| Date | 2026-10-02 |
| Branch | `main` |
| PR | #239, merged |
| Why it stays | Unstyled public links stayed browser blue on dark cards. Account controls that used `--text` or `--brown` became light-on-white or dim brown on the dark card. The homepage AI button used `--site-brown` on a dark surface. The reset page's disabled save button was white on `#f4efe8`. Dark mode now uses `--site-gold` for those links, `--site-text` / `--site-text-soft` for account and AI text, and `#3d2a23` on the white Google button and cream secondary button. The cart `shop.css` block from #233 is unchanged. Shared cart v1 merged as `f673c2a8db72f1f9666842d8d1e6c289a5ce68ce` and production Worker `02e54e03-b088-4a46-9ae6-709860365008` serves that `main` tip. Shared-cart short links are live on this commit. Production Worker `363a1a98-ace3-45fa-9dd3-cadb5f2ed724` serves `https://www.kutadgubilik.com/c/<code>`. `STAGE105_SHARED_CART_LINKS.sql` is applied and verified on live Supabase and must not be run again. Cart share preview copy is draft PR #237 on `fix/cart-share-preview-description` at `00db78b97fe8a56e8877fe3cbf379925a302712d`. It changes only the `cart.html` meta description. Robots stays `noindex, follow`. Short links, `/c/<code>`, the Shared Cart API, Supabase, Worker routing, cart logic, `shop.js`, CSS, the WhatsApp order flow, and App Links are unchanged. It is not this baseline until it is merged, and it is not deployed. App Link association files for `/c/*` are live on this commit. Production Worker `2a3f8dd4-ffb4-4386-ba3d-216b6c630e23` serves `https://www.kutadgubilik.com/.well-known/assetlinks.json` and `https://www.kutadgubilik.com/.well-known/apple-app-site-association`. `GET` and `HEAD` return 200 `application/json` with no redirect. Android package `com.kutadgubilig.kitabevi`, SHA-256 `2C:D7:46:A1:20:BA:11:D7:28:66:26:80:C7:44:C2:84:28:EF:0C:2F:D9:5C:D0:C6:6F:3F:55:E2:9A:28:44:FC`. Apple app ID `8QU554PCLF.com.kutadgubilig.kitabevi`, paths `["/c/*"]`. `/.git`, `/.env`, `/.vercel`, and `/.well-known/secret` stay 404. `/c/qVjmNEYG` still serves the cart page. The previous runtime baseline was `40eb0a5161e25c74af5261b096bb2e6d6ab2278e` on Worker `363a1a98-ace3-45fa-9dd3-cadb5f2ed724`. Production exceeded the Cloudflare Free Workers daily limit of 100,000 requests because `assets.run_worker_first` was `true`, so CSS, JavaScript, images, and fonts also invoked the Worker. Draft branch `feat/selective-worker-first-routing` changes that setting to a selective list. Ordinary CSS, JavaScript, images, and fonts bypass the Worker. HTML, clean URLs, book and category pages, `/api/*`, `/__r2/*`, `/kbg/*`, sitemaps, shared-cart `/c/*`, App Link files, and root dot-paths stay Worker-first. `admin.js`, `catalog-bibliography.js`, and `supabase-config.js` stay Worker-first because their current effective cache policy is `no-store`. This draft is not deployed, so this baseline stays. Some earlier `no-store` JavaScript names in `security-headers.js` are later overwritten by the generic JavaScript cache rule. That ordering is unchanged here. |

`#239` merged as `0abd907f22a620b64dc5b84cc235d1ff8e340441`. Production Worker `2a3f8dd4-ffb4-4386-ba3d-216b6c630e23` serves that `main` tip. `#236` merged as `40eb0a5161e25c74af5261b096bb2e6d6ab2278e`. Production Worker `363a1a98-ace3-45fa-9dd3-cadb5f2ed724` was the previous short-link deploy. `#235` merged as `f673c2a8db72f1f9666842d8d1e6c289a5ce68ce`. `#234` merged as `e3715b54c5f950f870a9f91f4bd0b6807740facb`. `#233` merged as `1600ed6d2721f1517f107ccbb0b3204efb68ecfc`. `cart.html` still requests `shop.css?v=55`. Other storefront pages still request `shop.css?v=54`. `public-header.js` is `?v=3` on the public HTML pages that already load it. That script still requests `public-header.css?v=7`. `account.css` is `?v=7`. Production `cart.html` requests `shop.js?v=141` and `kutadgu-shared-cart.js?v=3`. Every other storefront page still requests `shop.js?v=138`.

Measured in Chromium on `http://127.0.0.1:4173` at 1280 and 390. Dark-mode back-links and trust-page links resolved to `#e2c98d` on `#302824` or `#211b18` (about 8.9:1 to 10.5:1). The delete-account mail button stayed white on `#8d6b52` (4.82:1). Login Google text was `#3d2a23` on white (13.5:1). The forgot-password control was `#e2c98d` on `#302824` (8.92:1). The email placeholder was `#bcae9f`. Cart unit price, line total, summary heading, and checkout title stayed `#f1e7da`. The remove control stayed red. The reset disabled button was `#4b3327` on `#f4efe8` at opacity 1. Light mode kept brown Google text, brown forgot-password text, and browser-blue trust links. `dir` stayed `rtl`. Measured pages had no horizontal overflow. `npm run test:unit` on this Windows tree stops in `admin-save-guard-tests.js` because `admin.js` is CRLF and the assertion looks for LF. Node's `git diff ... HEAD;` also fails under cmd.exe (`HEAD;`). Those files were not edited here. Focused header, account-cache, 404, cart-token, and auth-recovery scripts passed, including the dark-cart token guard. The previous application baseline on `main` is `1600ed6d2721f1517f107ccbb0b3204efb68ecfc`. The cart measurement note from `4a93a6ba6027ae35fbb7d2a1db68653e6d92ae8c` still describes the unchanged `shop.css` rules. The zero-result Load more behavior below still belongs to `445fe48808dc80d498d0191d270896dcf793e108`.

`origin/main` when the zero-search branch was cut was `dcb26d4296df8d28d4af66009207aa8519d487ed`, the merge of #220. #220 is documentation only. It does not replace the visit-order behavior verified on `d6ba212392f8794f77fffc0fee0167b6050393c3`, which #219 merged. The zero-search baseline moved because admin analytics behavior changed. The unfiltered `/books` listing still uses one seeded discovery order per tab visit. A sort, search, or reset cancels an in-flight Load more. A short full-record page is read until `Content-Range` is exhausted before a missing id is skipped.

The visit order landed in `2a8cbc90dd144b39577db4ba3f1c7c671051d1c7`. `471cf62e` kept filter analytics on the catalog total and the public `select *` query. `d6ba2123` remains the listing behavior described below. Do not copy the #220 documentation commit over it, and do not treat `445fe488` as live until `STAGE101_ADMIN_ZERO_SEARCHES.sql` is applied by hand and the deployed admin is checked.

No-result pagination is one browsing snapshot. The first call and Refresh use the selected 7/30/90 value, omit `p_as_of`, and start at offset 0. `get_kutadgu_zero_searches` stamps `as_of` at `now()` and derives the Europe/Istanbul day window from that instant. Load more sends the retained session's days, the same `as_of`, and `next_offset`. It does not read the date control again. Grouping, order, and totals include only `created_at <= as_of`. A search that arrives after `as_of`, including a repeat that would become the newest row, stays outside the snapshot, so a group that has not been loaded yet remains reachable. An append response whose days, snapshot time, calendar bounds, cursor, or totals do not match the retained session is rejected. The rows, totals, and range label already on screen stay as they were. The forward file drops the older three-argument function before creating the four-argument one, so Postgres does not keep both. A call that omits `p_as_of` still starts a snapshot because that argument defaults to NULL. A future `as_of` is clamped to `now()`. The payload `schema_version` for this function is 2. That is not the Stage 100 analytics schema. This Load more fix did not change the SQL.

The shared 7/30/90 control is the admin's selection. Neither loader writes it. If one request fails, that section keeps the data it already showed and the label names that range, including the shown and total query counts. The other section can show the newly selected range at the same time. A stale response does not repaint the newer selection.

On `445fe48808dc80d498d0191d270896dcf793e108`, `npm run test:unit` passed (Node v22.14.0). `git diff --check` was clean. The SQL file did not change, so the earlier throwaway PostgreSQL 16.15 run still stands: `STAGE101 isolated postgres: PASS legacy_rows=55 final_rows=55`. That script was not applied to the live project. Focused Playwright `tests/e2e/admin-zero-searches.spec.js` and `tests/e2e/zero-result-search.spec.js` passed, 5 tests. Full local Stage 10 was 773 passed and 3 skipped (admin login, member login, and storefront legacy-id). Playwright 1.62.1, `http://127.0.0.1:4173`, `KUTADGU_USE_LOCAL_STATIC=1`, `KUTADGU_PREVIEW_URL` unset. The recording spec lets localhost attempt the same insert and the test route swallows it. No production analytics rows were written. This work did not deploy, merge, or change production data.

Earlier, `npm run test:unit` also passed on `d6ba212392f8794f77fffc0fee0167b6050393c3`. Focused Playwright `tests/e2e/books-visit-rotation.spec.js` and `tests/e2e/stage5d-global-books.spec.js` passed, 16 tests, on that same local static server. Full local Stage 10 on that tree was 767 passed and 3 skipped.

Visit lifecycle for the unfiltered All books listing:

- A visit is one tab session. `sessionStorage` key `kutadgu-books-visit-v1` stores `{seed, ids, cursor}`. A new tab or a new browser session starts empty and receives a new seed. The seed is not written to `localStorage`. If `sessionStorage` throws, the same visit stays in module memory until that document is discarded.
- The snapshot is one Fisher-Yates permutation of the canonical active ids collected when the visit first builds it. The same seed and the same id list always produce the same unique order. A different seed moves books across the whole catalog. Books added after the snapshot join the next visit.
- Pagination walks that frozen list. Each step requests only the full records needed to fill the current page, in batches of at most 100 ids. If that response is shorter than the request and `Content-Range` shows more rows, those later rows are read before any unresolved id is treated as missing. A deleted or hidden id is then skipped and still consumes a snapshot position, so later ids are not dropped and Load more ends when the cursor reaches the snapshot end. A short HTTP 206 with no total fails the listing. Reloading a loaded span is capped at 5000 rows in one response.
- Sort, search, collection, price, and reset during Load more abort that append and run the new query. A second Load more click while the first append is in flight is ignored. A response from the aborted request does not repaint the grid, move the visit cursor, or clear the newer request’s loading state.
- The id index selects `id,is_active` (or `id` when `is_active` is missing), ordered by `id`, in pages of 1000. A short page is complete when `Content-Range` gives the total, or when the response is HTTP 200. A short HTTP 206 with no total fails the listing. A configured remote error stays on the existing retry message and does not show static demo books.
- The default label is `بۇ قېتىملىق بايقاش تەرتىپى` (`discover`). Search uses relevance. Newest, title, author, price, bestseller, and recommended stay explicit. Price, collection, category, and hub filters leave rotation. Returning to the default sort in the same visit restores the same snapshot and the cards already loaded. Book detail and Back keep that progress through `sessionStorage` and BFCache.

A later documentation-only commit on this branch does not replace the runtime baseline above. Do not copy that docs commit over `445fe48808dc80d498d0191d270896dcf793e108`. The previous application baseline on this branch was `3850edf2bc1a23d8254c7ffbd5d05690bb949394`, which kept each page inside one snapshot but still sent the selector's days on Load more.

The previous application baseline was `f7f75b23d0b34194c4cd6fcb7edf70ad3a38007e` on `feat/admin-daily-visitors`, merged by #218. `STAGE100_ADMIN_DAILY_VISITORS.sql` was executed only on a throwaway local PostgreSQL 16.15 database (`scripts/stage100-isolated-postgres.sh`), not on production. That run applied it twice, loaded 24 representative rows, applied it again with the row count unchanged, then checked access, Istanbul boundaries, visitors, duplicates, and joins. Rollback left 24 rows and the new columns, and applying the forward file again restored `schema_version` 2. Measured on that run: Istanbul today `2026-10-01` was partial with 3 visitors, 5 events, and 4 identified events; yesterday was complete with 1 visitor; the 7-day period distinct count was 3. The user-action funnel had 2 carts and the arrival funnel had 2 carts with `accurate_user_action_order` false. Book 15 and book 2 each had 1 view. Whether `STAGE100` has been applied to the live project is still unknown.

Last full local Stage 10 observed on the #209 revision (`9211ff09771c759b477c1b161af37c706e4fa03b`, merged by `70e741bd2bf75734e4c94c2baf974e80e9f0a96e`): **759 passed, 3 skipped**, Chromium, `http://127.0.0.1:4173` with `KUTADGU_USE_LOCAL_STATIC=1`. The pass count changes when tests are added. A new failure is the regression signal.

## Recent merged PRs

| PR | Merge | Purpose |
|---|---|---|
| #239 | `0abd907f` | App Link association files for `/c/*`. Merged as `0abd907f22a620b64dc5b84cc235d1ff8e340441`. Production Worker `2a3f8dd4-ffb4-4386-ba3d-216b6c630e23`. |
| #236 | `40eb0a51` | Shared-cart short links. Merged as `40eb0a5161e25c74af5261b096bb2e6d6ab2278e`. Production Worker `363a1a98-ace3-45fa-9dd3-cadb5f2ed724`. `STAGE105` was applied by hand before that deploy and must not be run again. |
| #235 | `f673c2a8` | Shared cart v1 links. Merged as `f673c2a8db72f1f9666842d8d1e6c289a5ce68ce`. |
| #232 | `5ebdd2f7` | AI search RPCs use the Cloudflare server secret. Merged as `5ebdd2f703c776dfb1f95074ba0f14850bdd7dba`. Live EXECUTE is `service_role` only. |
| #222 | `1bbdd2bd` | Cloudflare production Worker, private R2 reads, and the first live route cutover. Runtime baseline remained `445fe488` until the cart text fix. |
| #221 | `9acaa1cd` | Admin zero-result search list and snapshot Load more. `STAGE101` stays manual SQL. Runtime baseline remains `445fe488`. |
| #220 | `dcb26d42` | 2026-10-01 production website audit. Documentation only. Runtime baseline stayed on the visit-order commit until this zero-search change. |
| #219 | `102f7db1` | Visit discovery order for the unfiltered `/books` listing. |
| #218 | `8f9bf64e` | Admin daily visitors and trustworthy analytics. `STAGE100` stays manual SQL. |
| #217 | `f35fa6f` | ISBN-13 `isbn` / `gtin13` require prefix 978 or 979 and reject 9790. ISBN-10 and normalization stay. |
| #214 | `459a3cc` | Smaller book detail title again: desktop cap `32px`, mobile cap `28px`, line-height `1.3`. |
| #213 | `7bafe49` | Smaller book detail title: desktop cap `35px`, mobile cap `30px`, line-height `1.3`. |
| #212 | `09f8667` | Admin book save reports each step, bounds stalled requests, and unlocks after a successful write. |
| #211 | `f4dc454` | Remove the repeated out-of-stock badge from book covers. |
| #210 | `12f3551` | Project recovery handoff and Cursor rule. Documentation only. |
| #209 | `70e741b` | Cream mat, hairline, and soft shadow around existing storefront covers. No image-file changes. |
| #208 | `81d2ed4` | Share in-flight `book_view_stats` reads, one homepage `sales_count > 0` count, and stop the public inactive-book read. |
| #207 | `5c463cf` | New cover and gallery uploads become high-quality WebP, with the in-cap size guard. |
| #206 | `f74bc6f` | `UKIJCJK.woff2` first. `no-store` headers for `admin.js`, `catalog-bibliography.js`, and `supabase-config.js` win over the general JS/CSS cache. |
| #205 | `d73d2d6` | Header search focus ring, distinct `/adabiyat-roman` title, noindex 404 for non-numeric book URLs. |
| #204 | `6a582e8` | Customer search, book CSS path, login copy, empty categories. ISBN match tightened to exact 10- or 13-digit shape. |
| #203 | `b1112ec` | Fewer repeated public Supabase reads on the Free plan. |
| #201 | `47cd106` | Category HTML templates fit Vercel’s include path limit. |
| #200 | `235125c` | Server-rendered category book links. |
| #199 | `c595056` | Product structured data on book pages. |

Older recovery and SEO history remains in git log. #202 is not in the merged list above.

## Asset and cache pins

Query pins are how cached storefront files change. Bump the pin when the file’s behavior changes. Do not put `immutable` on an unhashed `?v=` URL.

| File | Pin at the runtime baseline |
|---|---|
| `shop.js` | `?v=141` on `cart.html` only. Other storefront pages stay on `?v=138`. |
| `kutadgu-shared-cart.js` | `?v=3` on `cart.html` only |
| `kutadgu-visit-order.js` | `?v=2` on `books.html`, immediately before `kutadgu-search-rank.js` |
| `kutadgu-book-seo.js` | `?v=5` on `book-shell.html` (book schema hydration). Listing pages still request `?v=3`. |
| `supabase-config.js` | `?v=22` |
| `member.js` | `?v=28` |
| `admin.js` | `?v=83` (`no-store`; new book images upload to private R2) |
| `admin.css` | `?v=47` |
| `kutadgu-analytics-core.js` | `?v=7` on `admin.html`. Storefront pages still request `?v=5` because search recording did not change. |
| `analytics.js` | `?v=5` |
| `admin-save-guard.js` | `?v=1` |
| `kutadgu-cover-image.js` | `?v=2` on `admin.html` and `book-staff.html` |
| `book-staff.js` | `?v=9` |
| `kutadgu-book-views.js` | `?v=5` on `book-shell.html` |
| `covers.css` | `?v=2` |
| `storefront-cover-presentation.css` | `?v=1`, loaded from `shop.js` |
| `shop.css` | `?v=55` on `cart.html` only. Other storefront pages still request `?v=54`. |

`vercel.json` cache, last matching header wins:

- General `/(.*)\.(css|js)`: `public, max-age=300, s-maxage=3600, stale-while-revalidate=86400`
- After that rule, `no-store, must-revalidate` for `/admin.js`, `/catalog-bibliography.js`, and `/supabase-config.js`
- `UKIJCJK.woff2`: `public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800` (`scripts/security-hardening-2a-tests.js`)
- HTML such as `admin.html` and `book-staff.html` is `no-store`

Several SEO tests freeze SHA-256 values for `shop.js`, `index.html`, `book-shell.html`, and `vercel.json`. Behavior edits to those files must refresh the frozen hashes and the Stage 2H allowlist in `scripts/stage-seo-2h-category-listing-seo-tests.js`.

## Testing

Unit tests:

```bash
npm run test:unit
```

Stage 10 is `.github/workflows/stage10-regression.yml`: `npm ci`, Playwright Chromium, then `npx playwright test`. On a pull request the workflow refuses to fall through to production. Local equivalent, against this checkout rather than production:

```bash
unset KUTADGU_PREVIEW_URL
export KUTADGU_BASE_URL=http://127.0.0.1:4173
export KUTADGU_USE_LOCAL_STATIC=1
npx playwright test
```

`playwright.config.js` uses `KUTADGU_PREVIEW_URL`, then `KUTADGU_BASE_URL` / `PLAYWRIGHT_BASE_URL`, then `https://www.kutadgubilik.com`. Leave the preview URL unset when the local server should be the target. The local server is `scripts/static-preview-server.js` on `127.0.0.1:4173`.

Stage 10 CI is Chromium only. Use Firefox and WebKit when a change is visual or browser-specific.

Do not send live analytics or view-count writes while measuring production traffic. Abort non-GET/HEAD Supabase calls in that kind of measurement.

## Security and RLS constraints

- Anonymous and normal authenticated clients can read active books only (`SUPABASE_SETUP.sql`, policy `public can read active books`).
- Admin reads of all books, profiles, orders, and analytics require `is_kutadgu_admin()` and AAL2 where that policy says so.
- `get_kutadgu_analytics` stays granted to `authenticated` only. The live function, read on 2026-09-30 before #218 merged, was still the older rolling-window body: it returns page, book, cart, and WhatsApp totals plus `top_books` and `zero_searches`. It does not return visitor counts or the cart, WhatsApp, and search breakdowns. `STAGE100_ADMIN_DAILY_VISITORS.sql` is the manual replacement. Do not apply `STAGE8_STORE_ANALYTICS.sql` over it. Neither #218 nor the visit-order work ran that migration on the live project. The isolated local run is recorded with the previous baseline note above. Merging #218 does not by itself change the live function.
- `public.match_active_books_ai` is the AI Search matcher. `STAGE_AI_SEARCH_1G2_CATEGORY_LOOKUP.sql` does not replace that function. `STAGE_AI_SEARCH_RPC_SERVER_ONLY.sql` leaves both function bodies as they are. It grants EXECUTE only to `service_role` and revokes EXECUTE from `anon`, `authenticated`, and PUBLIC on `match_active_books_ai(extensions.vector, integer)` and `list_active_books_by_categories_ai(text[], integer)`. That grant is live. Production Worker `kutadgu-cloudflare-production` version `5d6fb126-8971-4c56-8f6b-8acb5feb56a6` is serving it, and a normal AI search returns HTTP 200. On both AI RPCs, `service_role` EXECUTE is true. `anon`, `authenticated`, and PUBLIC EXECUTE are false. A direct anon call returns permission denied. The public publishable key remains the browser catalog key. Do not put the server key in Git, HTML, browser JS, Android, iOS, responses, or logs.
- Admin and storage writes stay on the admin/staff paths. Do not weaken RLS, grants, or Storage policies to make a public page work.
- Password recovery must use the redirect and `token_hash` flow noted in `supabase-config.js`, not `{{ .ConfirmationURL }}`.
- `scripts/security-hardening-2a-tests.js` rejects `eval`, `new Function`, and string timers in app HTML/JS.

## Do not touch

- Database passwords, service-role keys, Vercel tokens, GitHub tokens, `.env` values, and customer PII. They do not belong in git or in this file.
- Production rows, Storage objects, and Auth users, unless the task explicitly includes a reviewed migration.
- Logo, font, and cover paths. `README.md` says they are tied to the database and static catalog.
- Existing SQL history. Add a new idempotent file when a migration is actually required. Do not rebuild `SUPABASE_SETUP.sql` in place.
- `STAGE11_RECOVERY.md`’s rule that a Vercel rollback is not a database rollback.
- Bulk rewrite of existing cover objects. Upload optimization applies to new uploads.
- `immutable` cache on unhashed `?v=` assets.

## Known intentional behavior

- The public inactive-book request is gone on purpose. Admin hide/show remains.
- Two homepage card groups may still request `book_view_stats` separately. Same-id and same-set calls are deduped. Different id sets are not merged.
- The detail page may read a book’s view stats once for display and once more after a successful engagement so the visible total can move.
- Cover presentation does not crop or replace image files. Odd proportions stay letterboxed inside the frame.
- An in-cap JPEG, PNG, or WebP is not replaced by a WebP that is the same size or larger.
- Admin cover files above 50 MiB are rejected before decode. The stored image is still capped at 1600px.
- This supabase-js 2.45.4 build does not forward `abortSignal` on Storage `upload`. The admin UI stops waiting at 180s. The HTTP upload may still finish later as an unused object because the path is unique and `upsert` is false.
- Category listing HTML is packaged for the Vercel function. `includeFiles` paths must stay within Vercel’s length limit (#201).
- Guest carts are device-local. They are not in Postgres.

## Admin analytics

The Analytics card in `admin.html` reads `get_kutadgu_analytics`. Until `STAGE100_ADMIN_DAILY_VISITORS.sql` is applied by hand, visitor counts and the new breakdowns show as unavailable (`—`), not zero. After it is applied, deploy the site. The site can ship first: inserts omit `visitor_id`, `event_id`, `host`, `occurred_at`, and `action_seq` if those columns are missing, and also `legacy_id` and `meta`. Each recognized optional column is omitted once. That budget is separate from the lost-response retry, so five missing columns on the first page view still reach one valid insert. A lost response or HTTP 5xx is retried once only while `event_id` is still on the request, so the unique index can ignore the duplicate. After `event_id` is omitted, that same failure is dropped instead of inserted again.

Definitions once the migration is applied:

- Time zone is `Europe/Istanbul`. The selected 7, 30, or 90 days are calendar days ending today, not a rolling `now() - N days` window. The chart is always the last 7 Istanbul days, including today.
- A visitor is one anonymous browser id stored in `localStorage` (`kutadgu-analytics-visitor`). The tab session id stays in `sessionStorage`. Several pages or reloads on one Istanbul day count as one visitor. Page views stay page views.
- Today, yesterday, and the selected period each use their own `count(distinct visitor_id)`. The period total is not the sum of the daily totals.
- Days with no events are zero. Days with events but no visitor id are unavailable. Days with a mix count only the identified visitors and are marked partial. Historical rows are not rebuilt from page-view totals.
- The user-action funnel orders `action_seq`, which the browser assigns once when the person acts and reuses on retry. The server keeps `occurred_at` only from 5 minutes before `now()` through 1 minute after; otherwise it clears both ordering fields and still stores the event. A later step must have a strictly greater sequence, so equal timestamps and equal sequence numbers are not a later step. Sessions without that pair are excluded, not reconstructed from arrival time. `arrival_funnel` uses `created_at` and sets `accurate_user_action_order` false. The old RPC has no funnel object, so the page labels those figures as aggregate event ratios and does not cap them at 100%. WhatsApp is intent, not a sale.
- A search with an unknown result count is unknown, not a zero-result search. `search` and `zero_result_search` are not added together.
- No-result admin list, after `STAGE101_ADMIN_ZERO_SEARCHES.sql`: `get_kutadgu_zero_searches(p_days, p_offset, p_limit)` returns one jsonb page. It does not replace `get_kutadgu_analytics`. Days are Europe/Istanbul calendar days, clamped to 1..365. Page size is clamped to 1..50. The browser asks for 20. Order is last searched time descending, then the normalized query ascending.
- A qualifying row is `event_name = 'search' AND result_count = 0` when the selected window contains any `search` event. `result_count` NULL is unknown, not zero. `zero_result_search` is used only when that window has no `search` event at all, and only when its `result_count` is NULL or 0. The two names are never added for the same window, because the current site writes both for one completed zero search and the legacy table has no `event_id` to pair them. A legacy-only query inside a mixed window is omitted. That is a documented limit, not a reconstructed history. There is no exactly-once claim while `event_id` is absent.
- Grouping matches browser normalization: trim, collapse whitespace, keep 80 characters, do not fold case. The partial index `analytics_events_zero_search_recent_idx` limits the canonical scan to confirmed zero `search` rows in time order. It is not an expression group index. The legacy event still uses `analytics_events_name_created_idx`.
- The function requires `is_kutadgu_admin()` and AAL2. Execute is granted to `authenticated` only. Public and anon are revoked. A missing function shows a setup-required state and an em dash, not the old top-ten list and not zero. An empty confirmed period shows zero. A failed read keeps the previous rows when they exist and does not paint a failed read as zero. Refresh and a date change start again at offset 0. A stale response does not repaint a newer selection.
- Until Stage 100 is applied, the other analytics cards still use the rolling window in the live `get_kutadgu_analytics`. Their zero-result total can disagree with this calendar list. This section uses only the total from `get_kutadgu_zero_searches`.
- Homepage, header, `/books`, and category search record after the current request succeeds. The recorded query is the text captured when that request started. Load more, a redraw, an aborted or stale response, a blank query, a sensitive query, an unknown total, and a failed catalog request do not add a zero-result event. A later deliberate repeat of the same search can increase the count. A successful search still records `search` only. The homepage premium empty-state enhancer can rewrite a failed search's `.search-empty` box into the no-results sentence. That failure is still not recorded.
- Book lists resolve a numeric id first, then the lowest `books.id` for a legacy id. They do not join on both at once. WhatsApp book ids are deduplicated per click.
- `book_view`, `book_engagement_detail`, and `add_to_cart` stay separate. Analytics does not change `books.sales_count`.
- Collection skips local, preview, and other non-production hosts, and skips `admin.html` and `book-staff.html`. A logged-in admin on the public storefront can still be counted, because inserts use the public key. Bot filtering is not complete. PostHog stays separate and is not added to these totals.

Apply order: run `STAGE100_ADMIN_DAILY_VISITORS.sql` in the Supabase SQL editor, then deploy. Rollback is `STAGE100_ADMIN_DAILY_VISITORS_ROLLBACK.sql`, run by itself. It restores the previous rolling-window function and the Stage 99 insert policy, drops the timing trigger, and leaves `visitor_id`, `event_id`, `host`, `occurred_at`, and `action_seq` in place. Do not delete `analytics_events`. Do not replace the function with `STAGE8_STORE_ANALYTICS.sql`.

## Cloudflare parallel preview

This is not a runtime baseline move. `vercel.json`, the Vercel `api/*.js` routes, Supabase, Auth, RLS, and production image URLs stay as they are. PR #222 merged to `main` at `1bbdd2bd`. The remote preview is `https://kutadgu-cloudflare-preview.kutadgu-preview.workers.dev`. It binds R2 bucket `kutadgu-covers-preview` as `COVERS`. Live `www` is served by `kutadgu-cloudflare-production` through Worker Custom Domains and reads covers through the private `/__r2/book-covers/` route. Supabase remains the stored image URL and the fallback. The implementation note is `CLOUDFLARE_MIGRATION_REPORT.md`. That cutover left the runtime baseline at `445fe488`. The current baseline is the cart text commit in the table above.

- A Workers preview serves the same static site and calls the existing book, category, sitemap, and AI search modules. It does not replace the Vercel deployment. `npm run preview:cloudflare` runs that preview with Wrangler state outside the repo so the asset watcher does not reload on its own writes.
- The preview worker refuses `www.kutadgubilik.com` and `kutadgubilik.com`. The preview top-level Wrangler config has no production hostname. Production custom domains are only under `env.production`. The retired Vercel alias is not an allowed production host.
- R2 cover bytes for the 1020 active public Supabase cover and gallery objects were copied into `kutadgu-covers-preview` and checked with SHA-256. The workers.dev preview now displays those covers through the private Worker route. Production, Vercel, and the database still use Supabase URLs. `KUTADGU_R2_PUBLIC_BASE_URL` is empty, r2.dev stays disabled, and the admin upload route stays off. A future public R2 host can be named with `KUTADGU_R2_PUBLIC_BASE_URL` without removing the Supabase host.
- Storefront pins are unchanged. This branch does not change shop, admin, or book-shell behavior.
- Final pre-production QA compared the workers.dev preview with `https://www.kutadgubilik.com` before cutover. The preview still returns 421 for production hosts, serves private R2 only on workers.dev, and leaves AI search disabled. Production `POST /api/ai-search` is enabled on the production Worker. The note is `CLOUDFLARE_MIGRATION_REPORT.md`. Runtime baseline stays `445fe488`.
- `kutadgu-cloudflare-production` version `b859be14-dc00-4277-a426-451011f2dfc5` serves `https://www.kutadgubilik.com` and the apex as Worker Custom Domains. The old `kutadgubilik.com/*` and `www.kutadgubilik.com/*` routes were removed after those domains were active. The Vercel apex `A` `216.198.79.1` and `www` CNAME `691042ca7074d500.vercel-dns-017.com` are gone. Cloudflare created proxied `AAAA` `100::` records for both hostnames. Private R2 reads and AI search stay live. Supabase was not modified. The preview Worker has no custom domain and no route. Custom domains were recorded on `cursor/worker-custom-domains-575f` at `16ea72aa`, merged by PR #223. Runtime baseline stays `445fe488`.
- `kutadgu-bilig-kitab.vercel.app` is no longer an allowed production host in auth, analytics, PostHog, or AI search. The default Playwright and Stage 10 production origin is `https://www.kutadgubilik.com`. The deployed Workers were not redeployed for this cleanup. `npm run test:unit` on `cursor/retire-vercel-host-575f` at `eea08f4c`: 1502 PASS, 0 FAIL. Draft PR #224 merged as `a5cfcc16`. Runtime baseline stays `445fe488`.
- New book cover, gallery, cover-repair, and import uploads from Admin, and new Book Staff cover and gallery uploads, post to `POST /api/r2-cover-upload` and store `https://www.kutadgubilik.com/__r2/book-covers/...`. The route stays AAL2, requires `is_kutadgu_admin()` for catalog keys, and allows `is_kutadgu_book_staff()` only for `book-covers/staff/<that user>/`. Preview and non-production hosts stay 404. `KUTADGU_R2_PUBLIC_BASE_URL` stays empty. Existing Supabase image URLs still render. `STAGE102_R2_BOOK_IMAGE_URLS.sql` is the reviewed allowlist. Production received the same allowlist on the live compact functions as migration `r2_book_image_url_allowlist`. It does not delete objects. `npm run test:unit` on `cursor/r2-book-image-uploads-575f` at `2d39415b`: 1503 PASS, 0 FAIL. Draft PR #225. Production Worker `kutadgu-cloudflare-production` version `581ca4d5-c85a-4ca5-8b13-6880afc2e1b3` has `KUTADGU_R2_UPLOAD_ENABLED=true`, overwrite false, and an empty public base. No catalog upload was created. Runtime baseline stays `445fe488`.
- Current book cover and gallery URLs now point at private R2. Migration `rewrite_book_image_urls_to_r2` (`STAGE104_REWRITE_BOOK_IMAGE_URLS.sql`) rewrote 341 `books.image_url` values and 679 `books.gallery_images` values from `https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/<path>` to `https://www.kutadgubilik.com/__r2/book-covers/<path>`. The path is unchanged, so there is no `book-covers/book-covers/` prefix. Gallery order and length stayed. `updated_at`, titles, prices, stock, categories, descriptions, and `cover_sha256` stayed. Before the rewrite, all 1020 unique objects matched R2 byte size and SHA-256, and each `/__r2/` URL returned 200 with an image content type. After it, Supabase book-covers URLs in `books` are 0 and `/__r2/` URLs are 341 covers plus 679 gallery entries. A rescan of public and private text/json columns found no remaining book-covers Storage URLs. Hero slides are still the three repo images. The `book-covers` bucket still has 1112 objects and 261653092 bytes. Classification is A 1020 migrated book objects, B 2 old Hero sources, C 5 unreferenced Book Staff objects, D 0, and E 85 unknown. Nothing was deleted. Rollback is `scripts/r2-book-url-rollback-manifest.json`. `npm run test:unit` on `cursor/r2-book-url-rewrite-575f` at `db7c820d`: 1508 PASS, 0 FAIL. Draft PR #227. r2.dev stays disabled. Runtime baseline stays `445fe488`.
- Homepage hero custom slides now use the same private R2 upload. New keys are `book-covers/hero/store-slides/slot-[123]-<uuid>.(jpg|png|webp)`. The stored URL is `https://www.kutadgubilik.com/__r2/book-covers/hero/store-slides/<file>`. Upload and `POST /api/r2-hero-delete` require a Supabase JWT, AAL2, and `is_kutadgu_admin()`. Book Staff cannot write or delete that namespace. Hero objects stay at 5 MB. The delete route rejects every key that is not a hero slide, and it refuses a key that `store_hero_store_slides` still references. A failed database update keeps the previous image. Legacy `hero/store-slides/` paths are not deleted from Supabase. The three live slides are still the repo images (`main`, `library`, `exterior`) with null URLs. Two unreferenced Supabase objects, `hero/store-slides/slot-1-066f5e31-394a-48f1-8eeb-c0f60bc0c045.jpg` (217411 bytes) and `hero/store-slides/slot-1-aeebbfbf-5a6f-4a85-af00-c0fe7ed16e9a.png` (1353906 bytes), were copied to the matching R2 keys and checked with SHA-256. They were not attached to a slide row, and the Supabase sources were not deleted. `STAGE103_BLOCK_BOOK_COVER_STORAGE_WRITES.sql` was applied as migration `block_book_cover_storage_writes`. It drops only the four permissive `book-covers` INSERT, UPDATE, and DELETE policies. The restrictive AAL2 policies remain and do not grant writes. The bucket stays public, so old Supabase URLs still read. An authenticated AAL2 insert into `storage.objects` returned `42501`, an update changed 0 rows, and a publishable-key upload returned 403. No probe object was left behind. `npm run test:unit` on `cursor/hero-r2-storage-lock-575f` at `bc0b845a`: 1508 PASS, 0 FAIL. Draft PR #226. Production Worker version `7d181bb5-c9c6-4885-9222-f8a38a55d36b`. r2.dev stays disabled. Runtime baseline stays `445fe488`.

- AI search RPC calls from the storefront stay on `POST /api/ai-search`. `kutadgu-ai-search.js` sends `env.SUPABASE_SECRET_KEY` only on `match_active_books_ai` and `list_active_books_by_categories_ai`. A missing secret fails closed with 503 before OpenAI or Supabase. Catalog, sitemap, and public book reads keep the publishable key. `STAGE_AI_SEARCH_RPC_SERVER_ONLY.sql` is the reviewed grant file. The Cloudflare production secret name is `SUPABASE_SECRET_KEY`. Its value is not in Git. PR #232 merged as `5ebdd2f703c776dfb1f95074ba0f14850bdd7dba` from `fix/ai-rpc-server-only-access`. `npm run test:unit` on `3f5e2ee247b7f43c1bfe8d1b4af2dd43ed2e88ed`: 1508 PASS, 0 FAIL. Production Worker `kutadgu-cloudflare-production` version `5d6fb126-8971-4c56-8f6b-8acb5feb56a6` is current. A normal AI search returns HTTP 200. On both AI RPCs, `service_role` EXECUTE is true. `anon`, `authenticated`, and PUBLIC EXECUTE are false. A direct anon call returns permission denied. The Edge Function `legacy-cover-exact-delete` has been deleted. `delete-account` remains active. That AI RPC change did not move the runtime baseline.

## Remaining optional work

The repo has no separate backlog file. These are cautions, not scheduled tasks:

- Apply `STAGE101_ADMIN_ZERO_SEARCHES.sql` manually before expecting the full no-result list in production. The isolated PostgreSQL check does not replace that production apply. Rollback is `STAGE101_ADMIN_ZERO_SEARCHES_ROLLBACK.sql`, run by itself. It drops only `get_kutadgu_zero_searches(integer, integer, integer)` and `analytics_events_zero_search_recent_idx`. It does not delete `analytics_events` and it does not restore or replace `get_kutadgu_analytics`. Do not run `STAGE8_STORE_ANALYTICS.sql` as that rollback, and do not rerun Stage 8 over a database that already has Stage 100. The live list is not fixed until this SQL is applied and the deployed admin is checked.
- Apply `STAGE100_ADMIN_DAILY_VISITORS.sql` manually before expecting visitor counts in production. The isolated PostgreSQL check does not replace that production apply. Do not run it from an agent task, and do not replace it with `STAGE8_STORE_ANALYTICS.sql`. Stage 101 does not require Stage 100. Stage 100 can be applied later; the zero-search function does not read the Stage 100 columns.
- Android and iOS analytics were not reviewed in this repository. The insert contract for `search` and `zero_result_search` is unchanged. Mobile clients that already send those events stay compatible with the new admin read. Whether those apps emit the same pair was not verified.
- A visit snapshot does not include books added after it was built. A server that returns a short id page, or a short full-record page, without an exact total fails that `/books` listing instead of showing a partial catalog. Restoring cards already loaded in the visit is capped at 5000 rows. The order belongs to one tab, not to a shared profile.
- Rows stored before `action_seq` exists stay out of the user-action funnel. Receipt order can still be shown as arrival, and that figure is not user-action order. A client clock outside the server window also drops ordering for that event.

- Public book queries still use broad `select=*` in places. Narrowing columns needs a check that cards and detail pages still receive every field they render.
- `STAGE11_RECOVERY.md` still mentions agent branches as `cursor/<name>-fd87`. Recent merged work used `cursor/<name>-c4dc`. Confirm the live branch suffix before creating a branch.
- Android app source is outside this repo. Website changes that affect auth, catalog shape, or privacy copy can affect that app even though its code is not here.
- Current book image URLs use private R2. PR #231 recorded the completed Supabase Storage deletion: 1022 objects (class A 1020 and class B 2, 248491390 bytes) were removed. 90 protected objects remain (class C 5 and class E 85, 13161702 bytes). Do not delete those 90. Restore is `scripts/legacy-cover-storage/restore-from-r2.js`. The Edge Function `legacy-cover-exact-delete` has been deleted. `delete-account` remains active.

## How to resume work safely

1. Read this file, `README.md`, and, if the task can touch data or deploys, `STAGE11_RECOVERY.md`.
2. `git fetch origin main`. Compare `git rev-parse origin/main` with the runtime baseline. They may differ. Do not treat the stored SHA as the current `main` tip.
3. If a PR recorded here has since merged, reconcile this file with `origin/main` before new work. Documentation-only commits on `main` still leave the runtime baseline where it is.
4. Create one branch from current `main`. Recent agent branches look like `cursor/<descriptive-name>-c4dc`. Open one draft PR. Do not merge it unless the task says to merge.
5. Keep the diff inside the task. Do not mix schema, RLS, Auth, Storage, or production data into a storefront or docs change.
6. For storefront or admin behavior, run `npm run test:unit`. Run Stage 10 when the change can affect pages Playwright covers. Refresh frozen hashes and the Stage 2H allowlist when those tests require it.
7. Before the task is considered complete, update this file in that same PR. A later session confirms the merge. Do not open a second documentation PR just to move a SHA.

## How to update this document

Update it in the same PR as a significant feature, bug fix, or infrastructure change, before that PR is considered complete. Skip trivial formatting-only edits. Documentation-only commits do not change the runtime baseline.

Record the feature or fix, the PR number when it exists, the tested branch and head SHA, and the tests or status. Update pins, behavior, and future work when those changed. Move the runtime baseline only when application or runtime behavior changed. Delete notes that are no longer true.

A later session checks whether that PR merged and reconciles this file with `origin/main`. Never assume the stored baseline is the current `main` tip.

Do not paste secrets, tokens, passwords, `.env` contents, or service-role keys. Public domains and the public Supabase ref may stay because they are already in the repo.

If a new file is added, `scripts/stage-seo-2h-category-listing-seo-tests.js` may need that path on its allowlist. This file and `.cursor/rules/project-recovery.mdc` are already listed.
