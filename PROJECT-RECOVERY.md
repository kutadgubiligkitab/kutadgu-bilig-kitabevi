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

- Search, category, and listing queries go through Supabase REST from `shop.js`. If Supabase is unavailable, `catalog.js` is only a small static fallback, not the live catalog.
- ISBN search uses the ISBN column only when the whole query is shaped like an ISBN: digits, `X`, spaces, or hyphens, and the digit length is exactly 10 or 13.
- Public pages request active books. Anonymous clients are not given inactive rows. RLS `public can read active books` is `is_active = true`.
- Bestsellers depend on `sales_count > 0`. The homepage shares one in-flight count and keeps it for about 10 minutes. A WhatsApp click does not increment `sales_count`.
- `is_recommended` and `is_new` are admin choices, not the bestseller source.
- View counts render from `book_view_stats` when the total is at least 20 (`THRESHOLD` in `kutadgu-book-views.js`). Completed reads stay cached for 10 minutes. Concurrent reads of the same book id or the same normalized id set share one request. A failed read is not cached. Local preview hosts (`localhost`, `127.0.0.1`, `::1`) skip view-stat reads.
- Stock enforcement defaults on (`KUTADGU_STOCK_ENFORCEMENT`). Prepared orders do not reserve stock. Admin commit deducts it.
- Guest cart and favorites stay in browser localStorage (`kutadgu-cart-v1`, `kutadgu-favorites-v1`). Logged-in member cart and favorites use Supabase.
- Cover images on cards and the detail page use `object-fit: contain` inside a shared cream frame (`storefront-cover-presentation.css`). The image files are not cropped by that stylesheet.
- Non-numeric `/book/...` slugs are a noindex 404. `/adabiyat-roman` keeps its own title.
- Poetry and other pages load `UKIJCJK.woff2` first, then `UKIJCJK.ttf`.

## Admin and catalog behavior

- `admin.html` / `admin.js` is the admin catalog, orders, hero, and announcements UI. Admin book reads that see inactive rows require `is_kutadgu_admin()` and AAL2.
- `book-staff.html` is the staff portal. New cover and gallery uploads go through `kutadgu-cover-image.js`: WebP quality `0.92`, longest edge `1600` px, no upscale. An in-cap image stays in its original format when the WebP is not smaller. Oversized images keep the resized WebP. Uploads use a unique path (`upsert: false`) and `Cache-Control: public, max-age=31536000, immutable`.
- Hide and show of inactive books stays in admin. The public storefront does not fetch `is_active=eq.false`.

## Mobile app relationship

This repository is the website. It does not contain the Android app source.

`privacy.html` documents the Android app as a separate client of the same public catalog and Supabase Auth. The app can sign in with email/password or Google. Its cart, favorites, and theme stay on the device and are not synced to the member cart tables. It has no in-app card payment and no separate delivery-address form. Account deletion for the Play listing is the site page `/delete-account`.

## Last verified runtime/application baseline

This SHA is the last verified application and runtime baseline. It is not necessarily the current `origin/main` tip. Compare the two before substantial work. A documentation-only commit does not require changing it.

| | |
|---|---|
| Commit | `70e741bd2bf75734e4c94c2baf974e80e9f0a96e` |
| Subject | Merge pull request #209 from `cursor/cover-presentation-c4dc` |
| Date | 2026-09-26 |
| Why it stays | PR #210 is documentation and Cursor rules only. It does not change storefront, admin, schema, RLS, Auth, Storage, or production data. |

Last full local Stage 10 observed on the #209 revision (`9211ff09771c759b477c1b161af37c706e4fa03b`, merged by the baseline above): **759 passed, 3 skipped**, Chromium, `http://127.0.0.1:4173` with `KUTADGU_USE_LOCAL_STATIC=1`. The pass count changes when tests are added. A new failure is the regression signal.

PR #210 (`cursor/project-recovery-c4dc`) records this baseline wording in the same PR. Stage 2H diff-gate is the check for that documentation change. Do not copy PR #210’s head over the runtime baseline.

## Recent merged PRs

| PR | Merge | Purpose |
|---|---|---|
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
| `shop.js` | `?v=133` (`scripts/auth-production-cache-buster-tests.js`) |
| `supabase-config.js` | `?v=22` |
| `member.js` | `?v=28` |
| `admin.js` | `?v=79` |
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
- Category listing HTML is packaged for the Vercel function. `includeFiles` paths must stay within Vercel’s length limit (#201).
- Guest carts are device-local. They are not in Postgres.

## Remaining optional work

The repo has no separate backlog file. These are cautions, not scheduled tasks:

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
