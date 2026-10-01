# Project recovery

Handoff for the Kutadgu Bilig bookstore repository. Read this before substantial work, then compare it with `origin/main`. Incident rollback is `STAGE11_RECOVERY.md`. The one-page emergency list is `docs/EMERGENCY.md`.

The runtime baseline below is the last verified application commit. It is not automatically the current GitHub `main` tip. Documentation-only commits, including this handoff, do not move it.

## Project overview

Uyghur-language bookstore storefront. Static HTML, CSS, and JavaScript on Vercel, with the live catalog, accounts, orders, and covers in Supabase. The public UI is RTL. Customers browse, search, and send orders through WhatsApp. There is no in-site card checkout.

Repository: `kutadgubiligkitab/kutadgu-bilig-kitabevi`. Default branch: `main`.

## Production website

- Canonical site: `https://www.kutadgubilik.com` (`KUTADGU_SITE_ORIGIN` in `supabase-config.js`)
- Apex `kutadgubilik.com` auth callbacks are sent to the `www` host
- Vercel production alias, also treated as a production auth host: `https://kutadgu-bilig-kitab.vercel.app`

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

## Last verified runtime/application baseline

This SHA is the last verified application and runtime baseline. It is not necessarily the current `origin/main` tip. Compare the two before substantial work. A documentation-only commit does not require changing it.

| | |
|---|---|
| Commit | `445fe48808dc80d498d0191d270896dcf793e108` |
| Subject | Keep Load more on the retained no-result snapshot. |
| Date | 2026-10-01 |
| Branch | `cursor/admin-zero-result-searches-ac0d` |
| PR | #221 (draft, not merged) |
| Why it stays | A completed search with a confirmed total of zero is recorded, including a query searched once. Admin pages that list inside one server snapshot. Load more repeats that snapshot's days, as-of time, and offset, even when the date control has moved. |

`origin/main` when this branch was cut was `dcb26d4296df8d28d4af66009207aa8519d487ed`, the merge of #220. #220 is documentation only. It does not replace the visit-order behavior verified on `d6ba212392f8794f77fffc0fee0167b6050393c3`, which #219 merged. This baseline moves because admin analytics behavior changed. The unfiltered `/books` listing still uses one seeded discovery order per tab visit. A sort, search, or reset cancels an in-flight Load more. A short full-record page is read until `Content-Range` is exhausted before a missing id is skipped.

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
| `shop.js` | `?v=138` (`scripts/auth-production-cache-buster-tests.js`) |
| `kutadgu-visit-order.js` | `?v=2` on `books.html`, immediately before `kutadgu-search-rank.js` |
| `kutadgu-book-seo.js` | `?v=5` on `book-shell.html` (book schema hydration). Listing pages still request `?v=3`. |
| `supabase-config.js` | `?v=22` |
| `member.js` | `?v=28` |
| `admin.js` | `?v=82` (`no-store`; the pin still changes with the zero-search list) |
| `admin.css` | `?v=47` |
| `kutadgu-analytics-core.js` | `?v=7` on `admin.html`. Storefront pages still request `?v=5` because search recording did not change. |
| `analytics.js` | `?v=5` |
| `admin-save-guard.js` | `?v=1` |
| `kutadgu-cover-image.js` | `?v=2` on `admin.html` and `book-staff.html` |
| `book-staff.js` | `?v=8` |
| `kutadgu-book-views.js` | `?v=5` on `book-shell.html` |
| `covers.css` | `?v=2` |
| `storefront-cover-presentation.css` | `?v=1`, loaded from `shop.js` |

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

`playwright.config.js` uses `KUTADGU_PREVIEW_URL`, then `KUTADGU_BASE_URL` / `PLAYWRIGHT_BASE_URL`, then `https://kutadgu-bilig-kitab.vercel.app`. Leave the preview URL unset when the local server should be the target. The local server is `scripts/static-preview-server.js` on `127.0.0.1:4173`.

Stage 10 CI is Chromium only. Use Firefox and WebKit when a change is visual or browser-specific.

Do not send live analytics or view-count writes while measuring production traffic. Abort non-GET/HEAD Supabase calls in that kind of measurement.

## Security and RLS constraints

- Anonymous and normal authenticated clients can read active books only (`SUPABASE_SETUP.sql`, policy `public can read active books`).
- Admin reads of all books, profiles, orders, and analytics require `is_kutadgu_admin()` and AAL2 where that policy says so.
- `get_kutadgu_analytics` stays granted to `authenticated` only. The live function, read on 2026-09-30 before #218 merged, was still the older rolling-window body: it returns page, book, cart, and WhatsApp totals plus `top_books` and `zero_searches`. It does not return visitor counts or the cart, WhatsApp, and search breakdowns. `STAGE100_ADMIN_DAILY_VISITORS.sql` is the manual replacement. Do not apply `STAGE8_STORE_ANALYTICS.sql` over it. Neither #218 nor the visit-order work ran that migration on the live project. The isolated local run is recorded with the previous baseline note above. Merging #218 does not by itself change the live function.
- `public.match_active_books_ai` is the AI Search matcher. `STAGE_AI_SEARCH_1G2_CATEGORY_LOOKUP.sql` says it does not replace that function. It is granted to `anon` and `authenticated`. Do not rewrite it as part of an unrelated change.
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
