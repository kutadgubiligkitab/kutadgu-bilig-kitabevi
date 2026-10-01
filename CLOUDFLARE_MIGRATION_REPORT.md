# Cloudflare parallel preview

Preview only. Production is unchanged. This branch does not cut DNS over, does not deploy the live site, and does not switch book covers to R2.

## A. Existing architecture

The live site is static HTML, CSS, and JavaScript on Vercel. `vercel.json` redirects clean `.html` URLs, rewrites category hubs to `api/category-listing.js`, rewrites `/book/:id` to `api/book-public.js`, rewrites the sitemaps, redirects legacy `/book?id=` URLs, and proxies PostHog under `/kbg/`.

The browser talks to Supabase for the catalog, Auth, member cart, favorites, and Admin. The public project URL and publishable key live in `supabase-config.js`. Covers are public objects in the Supabase `book-covers` bucket, stored on each book as a normal `image_url`. Admin uploads still go to that bucket from `admin.js`. Edge Functions, RLS, and Auth are unchanged.

AI search is `POST /api/ai-search`, disabled unless `AI_SEARCH_ENABLED` is exactly `true`. PostHog loads only on `kutadgubilik.com`, `www.kutadgubilik.com`, and `kutadgu-bilig-kitab.vercel.app`.

## B. What was added for Cloudflare

| File | Responsibility |
|---|---|
| `cloudflare/worker.js` | Workers entry. Loads the existing modules and handles one request. |
| `cloudflare/preview-dispatch.js` | Same route order as `vercel.json`: redirects, legacy book URLs, categories, books, sitemaps, AI search, PostHog, and static files. |
| `cloudflare/security-headers.js` | The current security and cache headers. Report-only `img-src` keeps Supabase and can add one future R2 origin. |
| `cloudflare/r2-cover-upload.js` | Disabled admin upload scaffold. It never runs unless `KUTADGU_R2_UPLOAD_ENABLED=true`. |
| `kutadgu-image-storage.js` | Public image-host helper. It accepts the current Supabase URL and a configured R2 URL, and it does not rewrite either one. |
| `scripts/r2-s3-client.js` | Server-side R2 client for the migration utility. GET, HEAD, and PUT only. |
| `scripts/r2-cover-inventory.js` | Dry-run inventory by default. Copy requires an explicit flag and `KUTADGU_R2_COPY_CONFIRM=COPY_COVERS_NOW`. No delete path. |
| `scripts/cloudflare-preview-tests.js` | Migration checks. |
| `scripts/cloudflare-preview-dev.js` | Starts local Wrangler with its config and state outside the repo, so `.wrangler` writes do not sit inside the asset directory. |
| `wrangler.jsonc` | Local/preview Worker. No custom domain. |
| `.assetsignore` | Keeps secrets, SQL, tests, and `node_modules` out of the asset upload. |
| `.dev.vars.example` | Placeholder names for a local Wrangler session. |

`npm run preview:cloudflare` starts Wrangler on `127.0.0.1:8787`. The committed `wrangler.jsonc` still uses the repo as its asset directory. Running `wrangler dev` directly from that file watches the repo root, including the `.wrangler` directory Wrangler writes, and the local server reloads without answering. The preview script copies the same config to a temporary directory outside the repo and points assets at this checkout, so local state stays out of the watch tree. `npm run check:cloudflare` bundles without deploying. `npm run test:cloudflare` runs the migration tests. `npm run test:unit` still runs the previous suite, then these tests.

## C. Vercel compatibility

Unchanged. `vercel.json` and `api/*.js` were not edited. The Vercel project, its environment variables, and the production deployment path are still the live system. Cloudflare files sit beside that path.

## D. Cloudflare preview status

Local dispatch covers:

- homepage and static assets, including cache and security headers
- `/books` and the other clean HTML rewrites
- every category hub slug, including a failed catalog response as 503
- `/book/<id>` found, missing, and non-numeric
- legacy `/book?id=` and `/book.html?id=` 308 redirects
- `/sitemap.xml`, `/sitemap-books.xml`, and `/sitemap-books-<page>.xml`
- `GET` and `POST /api/ai-search`, including the disabled state
- `HEAD` for pages, books, categories, and sitemaps
- `/kbg/...` PostHog upstreams

The worker returns 421 for `www.kutadgubilik.com`, `kutadgubilik.com`, and `kutadgu-bilig-kitab.vercel.app`, so attaching this Worker to production by mistake does not serve the site.

Remote preview, workers.dev only:

`https://kutadgu-cloudflare-preview.kutadgu-preview.workers.dev`

The Worker name is `kutadgu-cloudflare-preview`. `wrangler.jsonc` has `workers_dev: true` and no `routes`, `route`, or `zone_id`. The account workers.dev subdomain registered for this preview is `kutadgu-preview`. That is not `kutadgubilik.com`. A check of `https://www.kutadgubilik.com` still returns `server: Vercel`.

PostHog collection on the preview host is not active. `posthog-config.js` still allows only the existing production hosts, so a `workers.dev` or localhost page does not start PostHog. The `/kbg` proxy itself is implemented and tested. Do not add the preview host to `allowedHosts` until a deliberate preview-analytics decision; that file also controls production.

Canonical URLs and JSON-LD stay on `https://www.kutadgubilik.com`. That matches the current SEO helpers.

`wrangler deploy --dry-run` bundles the Worker and does not deploy.

## E. R2 status

The bucket `kutadgu-covers-preview` exists (Eastern Europe, Standard). The preview Worker binds it as `COVERS`. Public image cutover is off: `KUTADGU_R2_PUBLIC_BASE_URL` is empty, `KUTADGU_R2_UPLOAD_ENABLED` is `false`, r2.dev stays disabled, and the remote upload route returns 404. Production book pages still use `fxlojnqwyojqjskfggmh.supabase.co` image URLs. The workers.dev preview serves those same objects through the private Worker route described in PREVIEW R2 SERVING TEST. No `image_url` or `gallery_images` row was changed. Preview copies are described in R2 COPY VERIFICATION.

Prepared:

- public URL classification for the current Supabase host and one future R2 host
- report-only CSP can include that R2 host without dropping Supabase
- dry-run inventory and a copy planner that skips objects unless overwrite is explicitly enabled
- a Worker upload route that is 404 until `KUTADGU_R2_UPLOAD_ENABLED=true`
- Worker binding `COVERS` points at the existing bucket `kutadgu-covers-preview`

Tested:

- Supabase URLs stay accepted and are not rewritten
- a configured `https://covers.example.com` URL is accepted beside them
- dry-run performs no PUT
- copy without the confirmation value performs no PUT
- an existing key is kept unless `KUTADGU_R2_OVERWRITE=true`
- the upload route returns 404 while disabled, and when enabled in a unit test it requires a Supabase user, JWT `aal` `aal2`, and `is_kutadgu_admin()` before `put`

Not activated:

- the bucket is bound for the preview Worker only; r2.dev public access stays disabled
- copied objects are not used by the website
- no `image_url` row was updated
- no Supabase Storage object was deleted or moved
- Admin UI still uploads to Supabase Storage

The upload route is not linked from `admin.js`. Wiring that button is a later step. The route does not write `books.image_url`. Admin uploads still target the Supabase `book-covers` bucket.

## R2 COPY VERIFICATION

Date: 2026-10-01. Source: public Supabase Storage at `https://fxlojnqwyojqjskfggmh.supabase.co` (`book-covers` objects referenced by active books). Destination: R2 bucket `kutadgu-covers-preview` only. Copies used the existing Wrangler login and `wrangler r2 object put/get --remote`. No R2 API token was created. No delete command was run.

- book rows inspected: 341
- image references: 1020
- unique Supabase objects planned: 1020
- duplicates removed: 0
- non-Supabase URLs skipped: 0
- unsafe/invalid URLs: 0
- total source bytes: 246920073
- VERIFIED_COPIED: 1020
- VERIFIED_EXISTING: 0
- SKIPPED: 0
- SOURCE_FAILED: 0
- CONFLICT: 0
- VERIFY_FAILED: 0
- verified destination bytes: 246920073

SHA-256 and byte length were checked for every copied object by reading it back from the remote bucket. Every copied object matched its source hash. Content types sent with the objects were `image/webp`, `image/png`, and `image/jpeg`, with `Cache-Control: public, max-age=31536000, immutable`.

Supabase Storage originals were not deleted, renamed, moved, overwritten, or otherwise altered. Database `image_url` and `gallery_images` values were not updated. R2 image cutover remains disabled: `KUTADGU_R2_PUBLIC_BASE_URL` is empty, r2.dev public access is disabled, and `POST /api/r2-cover-upload` returns 404. Immediately after the copy, the preview and `https://www.kutadgubilik.com/book/106` still rendered Supabase image URLs. Preview-only serving through the Worker is recorded in PREVIEW R2 SERVING TEST. `https://www.kutadgubilik.com` still responds with `server: Vercel`.

The object manifest and downloaded bytes stay in gitignored `.tmp/r2-cover-migration/`. They are not committed. `.assetsignore` also excludes `.tmp` from the preview asset upload.

## PREVIEW R2 SERVING TEST

Date: 2026-10-01. Private route: `GET` and `HEAD` `/__r2/book-covers/<object-key>` on `https://kutadgu-cloudflare-preview.kutadgu-preview.workers.dev` only. The Worker reads `env.COVERS.get` / `env.COVERS.head`. It does not list, put, or delete. Traversal, backslashes, bad encodings, and keys outside `book-covers/` are rejected. Missing keys return 404. `PUT` and `DELETE` return 405.

Preview-only flag: `KUTADGU_R2_READ_ENABLED=true` in `wrangler.jsonc`. `.env.example` leaves it `false`. Production hosts (`kutadgubilik.com`, `www.kutadgubilik.com`, `kutadgu-bilig-kitab.vercel.app`) still receive 421 from this Worker and are not rewritten. Admin and book-staff pages are not rewritten. `KUTADGU_R2_UPLOAD_ENABLED` stays `false`. `KUTADGU_R2_PUBLIC_BASE_URL` stays empty. r2.dev public access stays disabled. No custom domain or route was added.

On the preview host, Supabase `book-covers` URLs in book and gallery `<img>` tags become same-origin `/__r2/...` URLs. Other HTTPS images stay unchanged. The original Supabase URL is kept on `data-kutadgu-cover-origin`. If that R2 image fails, the preview requests the original Supabase URL once and does not switch back. Canonical URLs and JSON-LD stay on `https://www.kutadgubilik.com` and still cite the Supabase image. The enforced CSP is still `frame-ancestors 'none'`. Images are same-origin, so `img-src` did not gain a new host.

Remote checks on the deployed preview:

- `/`, `/books`, `/adabiyat`, `/romanlar`, `/sheirlar`, `/book/106`, `/favorites.html`, and `/cart.html` returned 200
- displayed book images on the homepage (35), `/books` (24), `/book/106` (5, cover plus gallery/related), a guest cart row, and a guest favorites row used `/__r2/` and made no Supabase Storage image request
- `/adabiyat` server HTML contained 105 `/__r2/` cover images and no Supabase `src`
- sampled image responses: 10 homepage, 10 category, 10 book detail/gallery. 30 of 30 returned HTTP 200, an image content type, a non-zero body, `Cache-Control: public, max-age=31536000, immutable`, and no redirect
- one known cover, `book-covers/book/1788094203015.webp`, had the same SHA-256 and 161348 bytes from the Worker route, from `wrangler r2 object get --remote`, and from the Supabase original
- a missing preview key returned one R2 404 and then one Supabase request. It did not loop
- `POST /api/ai-search` stayed 503 and `POST /api/r2-cover-upload` stayed 404
- `https://www.kutadgubilik.com` and `/book/106` still respond with `server: Vercel` and a Supabase cover URL, with no `/__r2/` and no `workers.dev` image
- book 106 `image_url` is still the Supabase object URL. `gallery_images` was not rewritten. Admin upload code still targets the Supabase `book-covers` bucket

No R2 object was deleted or overwritten in this step. No Supabase object or database row was changed.

## F. Security

No new secret values were committed. R2 and OpenAI values are environment variables or a Wrangler binding. `.dev.vars` is gitignored. The browser image helper returns only a public origin and drops any key material passed to it.

Auth, RLS, MFA, and Admin policies were not edited. The upload scaffold fails closed: disabled by default, then Supabase `/auth/v1/user`, then JWT `aal2`, then `is_kutadgu_admin()` with the user token. It does not use a service-role key. The migration client has no delete method.

The enforced CSP is still `frame-ancestors 'none'`. The report-only policy is unchanged unless a valid `https` R2 origin is configured, and that origin is added only to `img-src`.

## G. Tests

`npm run test:unit` after the remote deploy exited 0 with 1499 `PASS` lines. It was run again after the R2 copy and exited 0 with 1500 `PASS` lines across 105 files and no failing file. It was run again after private preview reads and exited 0 with 1501 `PASS` lines and no failing file. That includes `scripts/cloudflare-preview-tests.js`.

Remote smoke tests against `https://kutadgu-cloudflare-preview.kutadgu-preview.workers.dev` (HTTP answered during certificate setup, then HTTPS returned 200):

- `/` 200, `/books` 200, `HEAD /books` 200
- `/adabiyat` 200, canonical `https://www.kutadgubilik.com/adabiyat`, JSON-LD. Visible covers on the current preview use the private R2 route.
- `/book/106` 200, canonical `https://www.kutadgubilik.com/book/106`, JSON-LD still cites the Supabase image, the visible cover uses the private R2 route, no `r2.dev`
- `/book/1` and `/book/not-a-number` 404
- `/book?id=106` 308 to `/book/106`
- `/sitemap.xml` and `/sitemap-books.xml` 200 (341 book URLs)
- `HEAD /book/106` and `HEAD /sitemap.xml` 200
- `shop.js` cache `public, max-age=300, s-maxage=3600, stale-while-revalidate=86400`
- `admin.js` cache `no-store, must-revalidate`
- `GET /api/ai-search` 405, `POST /api/ai-search` 503 disabled
- `POST /api/r2-cover-upload` 404
- security headers include `content-security-policy: frame-ancestors 'none'` and the report-only policy still lists only the Supabase image host

`npm run check:cloudflare` (`wrangler deploy --dry-run`) completed earlier and did not deploy.

`npm run preview:cloudflare` served `http://127.0.0.1:8787`. Checked there: `/` 200, `/books` 200, `HEAD /books` 200, `/adabiyat` 200 with canonical `https://www.kutadgubilik.com/adabiyat` and JSON-LD, `/book/106` 200 with canonical and JSON-LD, `/book/1` and `/book/not-a-number` 404, `/book?id=1` 308 to `/book/1`, `/sitemap.xml` and `/sitemap-books.xml` 200, `/sitemap-books-2.xml` 200 empty urlset, `GET /api/ai-search` 405, `POST /api/ai-search` 503 disabled, unknown path 404, `POST /api/r2-cover-upload` 404, `shop.js` and `admin.js` cache headers, and `www.kutadgubilik.com` pointed at the local port returns 421. No DNS record was changed.

No production order, Auth user, SQL migration, or Storage delete was run. `--live` inventory was tested with a mock response only.

## H. Remaining manual steps

These need a Cloudflare login. Do them only for a preview. Do not point `kutadgubilik.com` at the Worker.

The preview Worker is already deployed. Do not point `kutadgubilik.com` at it.

1. Leave `KUTADGU_R2_UPLOAD_ENABLED` false. Put a provider key in `.dev.vars` or `wrangler secret put` only if a later preview should try AI search.
2. DNS cutover is a separate, explicit decision. This branch has no custom domain and refuses the production hostnames.

## I. Rollback

Leave production on Vercel. Do not merge this branch if the preview should stay unused. The live deployment is still whatever Vercel builds from `main`. Deleting the preview Worker or the unused R2 bucket does not affect Supabase or the current site. No data migration has to be undone because none was applied.

## FINAL PRE-PRODUCTION QA

Read-only comparison on 1 October 2026. Preview: `https://kutadgu-cloudflare-preview.kutadgu-preview.workers.dev`. Production: `https://www.kutadgubilik.com`. No DNS, domain, Supabase, R2, Auth, or Vercel change was made. No account, order, or WhatsApp message was created.

`npm run test:unit` exited 0 with 1501 `PASS` lines and 0 failures.

### Storefront comparison

These paths returned the same status on both hosts: `/`, `/books`, all 17 category routes (`adabiyat`, `romanlar`, `tarikhiy-romanlar`, `sheirlar`, `hekayiler`, `dastanlar`, `dunya-edebiyati`, `adabiyat-roman`, `uyghur-adabiyati`, `universal`, `tibb`, `derslik`, `terbiye`, `dini`, `children`, `dictionary`, `grammar`), `/book/106`, `/book/not-a-number` (404), `/privacy`, `/returns`, `/delete-account`, `/order-info`, `/account.html`, `/admin.html`, `/cart.html`, `/favorites.html`, `/robots.txt`, `/sitemap.xml`, `/sitemap-books.xml`, `/sitemap-pages.xml`, `/shop.js`, `/shop.css`, `/mobile.js`, and an unknown path (404).

Legacy redirects matched: `/index.html`, `/books.html`, and `/privacy.html` are 308 to the clean path; `/book.html?id=106` and `/book?id=122` are 308 to `/book/106` and `/book/122`; `/book.html?id=children-3` is 404 on both. `HEAD` `/`, `/books`, `/book/106`, `/sitemap.xml`, and `/shop.js` returned 200 on both.

Category pages had the same count of `/book/{id}` links. `/sitemap-books.xml` has 341 `<loc>` entries on both. `robots.txt` bytes match and still advertise `https://www.kutadgubilik.com/sitemap.xml`. Canonical URLs and `robots` meta stay on `www.kutadgubilik.com`. Book JSON-LD still cites the Supabase image. Enforced CSP is `frame-ancestors 'none'` on both. `x-content-type-options`, `x-frame-options`, `referrer-policy`, and `permissions-policy` match. The report-only CSP still allows the Supabase image host.

`shop.js`, `mobile.js`, `admin.js`, `supabase-config.js`, `posthog-config.js`, and `posthog-analytics.js` have the same SHA-256 on both hosts. There is no separate login or register document. Login and signup are both on `/account.html`, and both forms plus the Google button are present. Admin HTML is byte-identical and still shows the admin-only login gate. The gate was not submitted.

On the preview, a browser check loaded the homepage with 35 private R2 covers and no Supabase image `src`, opened the mobile menu, searched, changed sort and the new-arrivals filter, and kept result images on `/__r2/`. `/books` sort changed the grid and its covers stayed on R2. `/adabiyat` rendered cart buttons. `/book/106` showed the R2 cover, gallery images, and 4 related book links. Adding that book locally showed one cart line and one favorite, both with R2 images. The WhatsApp button was present and `whatsappOrderUrl` built a `wa.me` link. That handler was not clicked and no message was sent. A missing cover requested `/__r2/` and then fell back to the Supabase URL. The Google button started the provider page and was left before any credential was entered. Preview `kutadguGoogleAccountRedirectTo()` is the workers.dev `/account.html` URL.

### Cutover findings

Production `POST /api/ai-search` with a one-character query returns 400 `invalid_query`. That status is only reached when `AI_SEARCH_ENABLED` is exactly `true`. The same request on the preview returns 503 `disabled`. `GET /api/ai-search` is 405 on both. The route reads the Worker secret `OPENAI_API_KEY`, calls the embeddings provider, then the existing Supabase RPCs `match_active_books_ai` and `list_active_books_by_categories_ai`. No secret was copied or printed. A production Worker needs `AI_SEARCH_ENABLED` set to `true` and `OPENAI_API_KEY` added with `wrangler secret put` on that Worker only. Using the current preview vars would turn the live AI search off.

Private R2 reads and the HTML/client rewrite run only when `KUTADGU_R2_READ_ENABLED` is `true` and the hostname is localhost or `*.workers.dev`. Production hostnames are also rejected by `dispatch` with 421 before that route. A later production Worker must allow `www.kutadgubilik.com` and `kutadgubilik.com` for both the page rewrite and `/__r2/book-covers/*`, bind `COVERS` to the verified bucket, and keep `KUTADGU_R2_UPLOAD_ENABLED` false and `KUTADGU_R2_PUBLIC_BASE_URL` empty. No database URL rewrite is required: the Worker maps Supabase `book-covers` URLs to the private route at response time, and the original URL remains the fallback. Do not make that host change on this preview Worker.

PostHog is ready for a same-hostname cutover. `allowedHosts` already contains `kutadgubilik.com`, `www.kutadgubilik.com`, and `kutadgu-bilig-kitab.vercel.app`. The browser loads `/kbg/static/array.js` and posts to `/kbg`. Both hosts return 200 for `/kbg/static/array.js` and 400 for an empty `/kbg/e/`. The workers.dev preview stays outside the allowlist, so analytics do not start there. No analytics file was changed.

Admin uploads stay in browser code that writes to Supabase Storage. Moving HTML hosting to Cloudflare does not switch that path. Admin uploads, JSON-LD images, and cover fallbacks can still create Supabase Storage egress.

Auth for the production hostname is ready without a new redirect URL. `kutadguIsProductionAuthHost` sends Google and password-recovery redirects to `https://www.kutadgubilik.com`. Signup uses the current page origin, which remains that host after cutover. The Supabase dashboard allow-list was not opened. The preview origin is a different callback and is not required for the production hostname.

### Production Worker to prepare later

Do not remove the 421 check from the preview Worker and do not attach `kutadgubilik.com` to `kutadgu-cloudflare-preview`. Prepare a separate Worker, for example `kutadgu-cloudflare-production`, with its own Wrangler environment:

- `workers_dev` false and routes only for `www.kutadgubilik.com/*` and `kutadgubilik.com/*`
- a new flag, defaulting to the current preview behavior, so this preview script keeps returning 421 for production hosts
- production-host R2 read and HTML rewrite enabled only in that environment
- `COVERS` bound to the bucket that holds the 1020 verified objects
- `AI_SEARCH_ENABLED` true and `OPENAI_API_KEY` as a secret
- upload disabled, public R2 base empty, r2.dev disabled
- the same security headers, plus `strict-transport-security: max-age=63072000`, which Vercel sends today and this preview omits

### Rollback, not executed

Nameservers are already `steven.ns.cloudflare.com` and `coco.ns.cloudflare.com`. The site records still point at Vercel:

- `www` CNAME `691042ca7074d500.vercel-dns-017.com`
- apex A `216.198.79.1`
- `https://kutadgubilik.com/` returns 308 to `https://www.kutadgubilik.com/` with `server: Vercel`

If a later cutover is reverted: remove the production Worker route, restore that CNAME and apex A as DNS-only records, leave the nameservers alone, and confirm `https://www.kutadgubilik.com` again sends `server: Vercel` and Supabase cover URLs. Leave the preview Worker and R2 bucket in place. Do not delete the Vercel project before or during the attempt.

### Classification

Confirmed cutover blockers, not preview regressions:

- This Worker returns 421 for the production hostnames, so pointing DNS at it would take the site down.
- R2 rewrite and `/__r2/` reads do not run for `kutadgubilik.com`.
- Production AI search is enabled. This Worker has `AI_SEARCH_ENABLED` false, so it would answer 503 until the production secret and flag are set.

Expected differences: `server` is `cloudflare` on the preview and `Vercel` on production; visible covers use `/__r2/` only on the preview; JSON-LD images stay on Supabase; preview HTML includes the R2 boot tags; category and sitemap responses expose `s-maxage` directly, while Vercel shows the browser `max-age=0` form; `/sitemap.xml` on Vercel is the static file with a comment and the preview serves the generated index with the same two child URLs; `shop.js` is `text/javascript` on the preview and `application/javascript` on Vercel.

Observations: Cloudflare already hosts DNS while the website still targets Vercel. Admin and fallback image traffic can remain on Supabase. The preview has no HSTS header.

Unverified: the Supabase Auth redirect allow-list was not inspected; a zero-stock product was not clicked, though sold-out text counts matched and `shop.js` is identical; a live `Host` spoof was not sent, and the 421 behavior remains covered by the unit tests; a real AI search query was not sent, so the OpenAI key itself was not exercised.

## PRODUCTION WORKER PREPARATION

A second Worker, `kutadgu-cloudflare-production`, is deployed only at `https://kutadgu-cloudflare-production.kutadgu-preview.workers.dev`. The active version is `b859be14-dc00-4277-a426-451011f2dfc5`, created when the production secret was uploaded. The earlier script version was `f101be3f-3b15-41d6-a65e-7f467a1b141a`. It has no custom domain and no route. The zone `kutadgubilik.com` has zero Worker routes and zero Worker custom domains. `wrangler.jsonc` keeps the deployable config separate from `cloudflare/production-cutover-routes.json`, which is not activated.

The preview Worker was not redeployed for the secret. Its current version is `28a872c7-cfc5-4a23-abd3-dd7b53a05324`. `KUTADGU_HOST_MODE=preview` on the preview config still returns 421 for `kutadgubilik.com`, `www.kutadgubilik.com`, and `kutadgu-bilig-kitab.vercel.app`. Production mode is a different flag on the other Worker. It allows `www.kutadgubilik.com`, its own `workers.dev` hostname, and localhost. Apex `kutadgubilik.com` is allowed and answers 308 to `https://www.kutadgubilik.com` with the path and query preserved. The Vercel alias stays refused.

`COVERS` binds the existing bucket `kutadgu-covers-preview`. `KUTADGU_R2_READ_ENABLED` is true. `KUTADGU_R2_UPLOAD_ENABLED` and `KUTADGU_R2_OVERWRITE` are false. `KUTADGU_R2_PUBLIC_BASE_URL` is empty. There is no r2.dev host, no list, put, or delete route. HTML on an allowed production host rewrites Supabase book-cover URLs to the same-origin `/__r2/book-covers/` path. The database value is not written. The Supabase URL stays on `data-kutadgu-cover-origin` for one fallback. Staff pages are not rewritten.

Production responses, except localhost, send `Strict-Transport-Security: max-age=63072000`. Preview and localhost responses do not. The other security headers are unchanged.

`AI_SEARCH_ENABLED` is true on this Worker. `wrangler secret list --env production` includes the name `OPENAI_API_KEY` and does not return the value. A one-character `POST /api/ai-search` returned 400 `invalid_query`. One query, `kitab`, returned 200 with `ok: true` and 12 results, so the route reached the embeddings provider and the existing Supabase RPC. The same one-character POST on the preview Worker returned 503 `disabled`. The secret value was not printed.

Validation on the workers.dev URL after the secret version: `/`, `/books`, `/adabiyat`, `/romanlar`, `/children`, and `/book/106` returned 200 with HSTS `max-age=63072000` and `frame-ancestors 'none'`. The homepage boot meta is `production`. `/adabiyat` rewrote 105 cover `src` values to the same-origin `/__r2/book-covers/` path and kept the Supabase URL on `data-kutadgu-cover-origin`. Eight of those cover requests returned 200 `image/webp` with HSTS and no redirect. A missing cover key returned 404 with no redirect. `/book/106` JSON-LD `image` stayed on Supabase. `/book.html?id=106` returned 308 to `/book/106`. Both sitemaps returned 200, and the book sitemap has 341 URLs. `/account.html` has the login, signup, and Google controls. `/admin.html` does not load the cover bridge. `/kbg/static/array.js` returned 200. `POST /api/r2-cover-upload` returned 404. The preview homepage stayed mode `preview` and sent no HSTS.

`https://www.kutadgubilik.com` still responds with `server: Vercel`. DNS is unchanged: `www` CNAME `691042ca7074d500.vercel-dns-017.com`, apex A `216.198.79.1`. The Vercel project is still the live site.

`npm run test:unit` exited 0 with 1502 `PASS` lines and 0 failures.

### Cutover plan, not executed

1. Confirmed on version `b859be14-dc00-4277-a426-451011f2dfc5`: `wrangler secret list --env production` includes the name `OPENAI_API_KEY`, the validation URL returns 200 with HSTS and private covers, `www` shows `server: Vercel`, and the zone has no Worker route. The secret value was not printed.
2. Copy the patterns in `cloudflare/production-cutover-routes.json` into `env.production` only, then run `npx wrangler deploy --env production`. Do not add those patterns to the preview Worker.
3. The zone already uses Cloudflare nameservers. Public resolvers return the `www` CNAME `691042ca7074d500.vercel-dns-017.com` and the apex A `216.198.79.1`. Read each record's proxy flag from the DNS API before changing it. Proxy a hostname only when that flag is off, and do not replace those targets unless a later cutover explicitly says to.
4. Apex requests are already answered with 308 to `https://www.kutadgubilik.com` plus the original path and query. Confirm that redirect on the live apex immediately after the record change.
5. Smoke-test `https://www.kutadgubilik.com/`, `/books`, one category, `/book/106`, one private cover, `/sitemap.xml`, `/account.html`, and the admin gate. Confirm HSTS, `server` is no longer only Vercel, and a one-character AI search POST returns 400 rather than 503 `disabled`.
6. Roll back if the homepage, a book page, or cover reads fail, if the apex no longer redirects to www, if account or admin HTML does not load, or if AI search returns `disabled`.
7. Remove the production routes, restore the `www` CNAME and apex A above as DNS-only records, and leave the nameservers in place. Confirm `server: Vercel` and Supabase cover URLs on `https://www.kutadgubilik.com`.
8. Do not delete or pause the Vercel project during the rollback window. The preview Worker and the R2 bucket can stay.

## LIVE PRODUCTION CUTOVER

Completed 2026-10-01T13:21Z. Rollback was not needed.

Before the write, the website records were read again. Apex `A` `216.198.79.1`, TTL `1`, proxied `false`, record `b4ae03df35c72088c3cfc41a3966792f`. `www` `CNAME` `691042ca7074d500.vercel-dns-017.com`, TTL `1`, proxied `false`, record `2a773132ea82770dac4e6524d0971a6b`. The zone had no Worker routes. Zone SSL was `full`. `https://www.kutadgubilik.com` returned 200 from Vercel. The production Worker was still `kutadgu-cloudflare-production` version `b859be14-dc00-4277-a426-451011f2dfc5`, with the secret name `OPENAI_API_KEY` present and the value unread.

Only the proxy flag on those two website records changed, from `false` to `true`. Type, target, and TTL stayed the same. Before routes were attached, `/`, `/books`, and `/book/106` still returned 200 through Cloudflare with a Vercel origin id, and the apex returned one 308 to www.

The live routes are `kutadgubilik.com/*` and `www.kutadgubilik.com/*`, both on `kutadgu-cloudflare-production`. The preview Worker has no route. After the routes, `www` returned 200 from the Worker with HSTS `max-age=63072000`, production cover mode, and no Vercel origin id. The apex returned one 308 to `https://www.kutadgubilik.com/`. Core pages, sitemaps, account, cart, favorites, delete-account, and the admin gate returned 200. `/privacy.html` returns 308 to `/privacy`, which returns 200. CSS and JavaScript referenced by the homepage returned 200. Book JSON-LD `image` stayed on Supabase. The canonical URL stayed on `https://www.kutadgubilik.com/book/106`.

R2: 30 of 30 sampled cover requests returned 200 with an image content type, a non-zero body, `immutable` cache, and no Supabase redirect. The homepage rendered 35 private R2 covers and no Supabase image `src`. One missing cover fell back to the Supabase original once and set the fallback flag. `POST /api/r2-cover-upload` returned 404. Database image URLs were not changed.

AI search: one character returned 400 `invalid_query`. One query, `kitab`, returned 200 with 12 results. The secret was not printed.

Auth: account page shows login, signup, and Google. Google sign-in reached `accounts.google.com` and the redirect target included `https://www.kutadgubilik.com`. The sign-in was not completed. Admin still shows the password gate and does not load the cover bridge. Admin upload code still uses Supabase Storage. PostHog allows the production hosts, the homepage loads `posthog-analytics.js` once, and `/kbg/static/array.js` returned 200. The cart page has a WhatsApp control and no order was sent.

A second check of `/`, `/books`, `/book/106`, `/adabiyat`, and the apex redirect stayed on the Worker. Vercel was not deleted. Supabase was not modified. PR #222 later merged to `main` at `1bbdd2bd`. `npm run test:unit` before the write, and again after the production route was recorded in `wrangler.jsonc`, exited 0 with 1502 `PASS` lines and 0 failures.

## WORKER CUSTOM DOMAINS

Completed 2026-10-01. Rollback was not needed. The production Worker version stayed `b859be14-dc00-4277-a426-451011f2dfc5`. No new Worker was deployed.

Before the write, the website records were read again. Apex `A` `216.198.79.1`, TTL `1`, proxied `true`, record `b4ae03df35c72088c3cfc41a3966792f`. `www` `CNAME` `691042ca7074d500.vercel-dns-017.com`, TTL `1`, proxied `true`, record `2a773132ea82770dac4e6524d0971a6b`. Routes were `www.kutadgubilik.com/*` (`3432cbcd618a45cb933b5fcb4617c3ee`) and `kutadgubilik.com/*` (`5f99587367a6422e915d14ea626d0334`), both on `kutadgu-cloudflare-production`. Custom domains were empty. Apex mail `MX` and `TXT` records were left in place.

The first custom-domain publish returned 409 because those hostnames still had externally managed `A` and `CNAME` records. Those two website records were deleted, and the same publish was retried immediately. Both exact hostnames attached to `kutadgu-cloudflare-production` with certificates. Cloudflare created proxied `AAAA` `100::` records for `kutadgubilik.com` (`aa570918784bcc31ed0ae0b0b1e9d227`) and `www.kutadgubilik.com` (`94f2330af21f12bb1ad613d6594f404f`). The old `/*` routes were deleted only after HTTPS on both hostnames returned the Worker, with HSTS `max-age=63072000` and one apex 308 to `https://www.kutadgubilik.com/`.

After the route removal, `/`, `/books`, `/adabiyat`, `/romanlar`, `/sheirlar`, `/children`, `/dictionary`, `/book/106`, cart, favorites, account, admin, privacy, returns, delete-account, `robots.txt`, and both sitemaps returned 200. The book sitemap contained 341 locations. `/book.html?id=106` returned 308 to `/book/106`. `/privacy.html` returned 308 to `/privacy`. An unknown path returned 404. Book JSON-LD `image` stayed on Supabase. The canonical URL stayed on `https://www.kutadgubilik.com/book/106`.

R2: 30 of 30 sampled cover requests returned 200 `image/webp`, a non-zero body, and `public, max-age=31536000, immutable`. The homepage rendered 35 private R2 covers and no Supabase image `src`. A missing object returned 404, then the page fell back to the Supabase original once and did not change that `src` again. `POST /api/r2-cover-upload` returned 404. Database image URLs were not changed.

AI search: one character returned 400 `invalid_query`. One query, `kitab`, returned 200 with 12 results. The secret was not printed.

Auth: Google sign-in reached `accounts.google.com` and the redirect target included `https://www.kutadgubilik.com/account.html`. The sign-in was not completed and no user was created. Admin still shows the password gate and does not load the cover bridge. PostHog allows `www.kutadgubilik.com`, the homepage loads `posthog-analytics.js` once, and `/kbg/static/array.js` returned 200. No WhatsApp message and no order were sent.

Security headers on `www` stayed `max-age=63072000`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` with camera, microphone, geolocation, payment, and usb disabled, and the existing content security policy. Neither hostname still contains the Vercel IP or Vercel CNAME. The Vercel project was not deleted. Supabase was not modified. `npm run test:unit` after `wrangler.jsonc` recorded the exact custom domains exited 0 with 1502 `PASS` lines and 0 failures. Runtime baseline stays `445fe488`.

## VERCEL HOST RETIREMENT

The storefront no longer treats `kutadgu-bilig-kitab.vercel.app` as a production host. Auth callbacks, analytics recording, PostHog `allowedHosts`, and AI search production hosts stay on `kutadgubilik.com` and `www.kutadgubilik.com`. The preview Worker still refuses those two production hostnames. The deployed Workers were not redeployed. Playwright and Stage 10 default to `https://www.kutadgubilik.com` when no preview URL is set. `npm run test:unit` after this cleanup exited 0 with 1502 `PASS` lines and 0 failures.

## PRIVATE R2 BOOK IMAGE UPLOADS

New book-image bytes no longer go to Supabase Storage. Admin cover upload, gallery upload, cover replacement, cover repair, and bulk/import cover upload call `POST /api/r2-cover-upload`. Book Staff cover and gallery uploads use the same route, and only for an object key under `book-covers/staff/<that user's uuid>/`. The stored URL is `https://www.kutadgubilik.com/__r2/book-covers/<object-key>`. Existing Supabase public URLs stay in the database and still render. No Storage objects, database image URLs, R2 objects, books, or gallery rows were deleted.

The route stays off unless the host mode is production, `KUTADGU_R2_UPLOAD_ENABLED` is `true`, and the request host is `www.kutadgubilik.com` or `kutadgubilik.com`. It still requires a Supabase bearer JWT, a successful `/auth/v1/user` check, and JWT `aal` `aal2`. Catalog keys require `is_kutadgu_admin()`. Allowed types are WebP, JPEG, and PNG. Traversal and unsafe keys are rejected. The body limit is 50 MiB. Overwrite stays off. The object cache header is `public, max-age=31536000, immutable`. The response is `{ ok, key, url }` and does not include an r2.dev URL. `KUTADGU_R2_PUBLIC_BASE_URL` stays empty. The `COVERS` binding stays on the private bucket `kutadgu-covers-preview`. Homepage hero slides still upload to the Supabase `book-covers` bucket under `hero/store-slides/`; those are not book images.

`STAGE102_R2_BOOK_IMAGE_URLS.sql` replaces `submit_book_for_approval(jsonb)` and `update_pending_staff_book_submission(bigint, jsonb)` so those two functions accept both the old Supabase public prefix and `https://www.kutadgubilik.com/__r2/book-covers/`. Before that replace, the live function bodies matched `STAGE93_BOOK_STAFF_GALLERY.sql` and `STAGE94_PENDING_BOOK_EDIT.sql` once whitespace was ignored, and both already required AAL2. The replace does not change RLS or delete objects. Admin catalog saves write `books.image_url` directly and do not use those functions.

Admin already enrolls TOTP and gates book writes at AAL2, so the upload route keeps the AAL2 check. `npm run test:unit` on `cursor/r2-book-image-uploads-575f` at `2d39415b` exited 0 with 1503 `PASS` lines and 0 failures. Draft PR #225.

The live functions already matched `STAGE93` and `STAGE94` once whitespace was ignored. Migration `r2_book_image_url_allowlist` added the R2 prefix to those live bodies. Both stay `SECURITY DEFINER`, `search_path=public`, AAL2, executable by `authenticated`, and not by `anon`. Old Supabase prefixes remain accepted. No storage objects or image URL rows were deleted or rewritten.

Homepage hero uploads moved off Supabase Storage in the following section. Until that deploy, hero slides still uploaded to `book-covers` under `hero/store-slides/`.

`kutadgu-cloudflare-production` version `581ca4d5-c85a-4ca5-8b13-6880afc2e1b3` is the deploy that turned `KUTADGU_R2_UPLOAD_ENABLED` on. `KUTADGU_R2_OVERWRITE` is false and `KUTADGU_R2_PUBLIC_BASE_URL` is empty. The `COVERS` binding is still `kutadgu-covers-preview`. r2.dev public access stayed disabled. The bucket still held 1020 objects and 247 MB after the deploy. `www` returned 200 from Cloudflare with HSTS `max-age=63072000`. The apex returned 308 to `https://www.kutadgubilik.com/`. Unauthenticated `POST /api/r2-cover-upload` on `www` returned 401 `auth_required`. The same POST on the preview Worker returned 404. `/book/106` still contains the Supabase cover URL and also `https://www.kutadgubilik.com/__r2/book-covers/book/1788094203015.webp`. That private R2 URL returned 200 `image/webp` with `public, max-age=31536000, immutable`. The original Supabase URL still returned 200 `image/webp`. Deployed `admin.js?v=83` calls `postR2CoverUpload` and does not call `storage.from`. No new catalog row and no new R2 object were created. `storage.objects` in `book-covers` had 0 rows created in the six hours around this change. Runtime baseline stays `445fe488`.

## HERO SLIDES ON PRIVATE R2

Homepage hero custom slides now upload through `POST /api/r2-cover-upload` and delete only through `POST /api/r2-hero-delete`. The hero key is `book-covers/hero/store-slides/slot-[123]-<uuid>.(jpg|png|webp)`. The stored URL is `https://www.kutadgubilik.com/__r2/book-covers/hero/store-slides/<file>`. Both routes stay on the production host with `KUTADGU_R2_UPLOAD_ENABLED=true`. They require a Supabase JWT, `/auth/v1/user`, AAL2, and `is_kutadgu_admin()`. Book Staff is rejected. Hero bodies over 5 MB are rejected. Book covers stay at 50 MiB. Overwrite stays off. A hero key that a `store_hero_store_slides` row still references is not deleted. A database failure keeps the previous image and removes only the new R2 object. Legacy `hero/store-slides/` paths are recognized so an old row can be replaced, and those Supabase bytes are not deleted by the new client.

The three live slides stayed `origin=repo` for `main`, `library`, and `exterior`, with null `image_url` and `object_path`. Zero referenced rows were rewritten. Two unreferenced Supabase objects were copied into R2 and checked byte-for-byte:

- `book-covers/hero/store-slides/slot-1-066f5e31-394a-48f1-8eeb-c0f60bc0c045.jpg`, 217411 bytes, SHA-256 `1ef22ac5e8c50a86ae24d5b7b1d9ccc8738874bcea45dfef494f67c1e55243ce`, `image/jpeg`
- `book-covers/hero/store-slides/slot-1-aeebbfbf-5a6f-4a85-af00-c0fe7ed16e9a.png`, 1353906 bytes, SHA-256 `1ac0b5430c2b7b202249293505bd2f8fe42620f3db0eae84b775030715c31d75`, `image/png`

Both private `/__r2/` URLs returned 200 with `public, max-age=31536000, immutable`. The Supabase sources still returned 200. They were not attached to the homepage and were not deleted.

`STAGE103_BLOCK_BOOK_COVER_STORAGE_WRITES.sql` was applied as `block_book_cover_storage_writes`. The four permissive policies (`admin can upload book covers`, `admin can update book covers`, `admin can delete book covers`, `book staff can upload own covers`) are gone. The three restrictive AAL2 policies remain. `book-covers` stays public. An authenticated AAL2 insert returned `42501`. An update changed 0 rows. A publishable-key upload and delete returned 403. The probe name was not left in the bucket. No other bucket was changed.

`kutadgu-cloudflare-production` version `7d181bb5-c9c6-4885-9222-f8a38a55d36b` serves the new admin hero script. `www` returned 200. The apex returned 308 to `https://www.kutadgubilik.com/`. The homepage hero is still the three repo images and advanced from the main interior to the library interior. Unauthenticated production upload and hero delete returned 401 `auth_required`. Preview upload stayed 404. The preview Worker was not redeployed, so its old build answers `POST /api/r2-hero-delete` with 405 and does not write. `/book/106` still contains a Supabase cover URL and a private R2 cover URL. Both returned 200 `image/webp`. `POST /api/ai-search` with `{}` returned 400 `invalid_query`. `/account.html` returned 200. r2.dev stayed disabled. `KUTADGU_R2_PUBLIC_BASE_URL` stayed empty. `npm run test:unit` at `bc0b845a` exited 0 with 1508 `PASS` lines and 0 failures. Draft PR #226. Runtime baseline stays `445fe488`. Old book images and the two Supabase hero sources remain for a later verified cleanup.

## BOOK IMAGE URLS ON PRIVATE R2

`STAGE104_REWRITE_BOOK_IMAGE_URLS.sql` was applied as `rewrite_book_image_urls_to_r2`. It rewrites only `books.image_url` and `books.gallery_images`, and only when the value starts with the public Supabase `book-covers` prefix. The replacement is `https://www.kutadgubilik.com/__r2/book-covers/` plus the same object path. `books_touch_updated_at` is disabled for that statement and enabled again before the post-checks. A failed post-check raises and rolls the transaction back.

Before the statement, production had 341 cover URLs and 679 gallery URLs, all on Supabase, and 0 on `/__r2/`. Those 1020 references were 1020 unique objects. Each source object existed, the matching R2 object existed, byte size matched, SHA-256 matched, and the private URL returned 200 with `image/webp`, `image/png`, or `image/jpeg`. No referenced object needed a new copy. After the statement, Supabase book-covers URLs in both columns are 0, `/__r2/` counts are 341 and 679, double prefixes are 0, and gallery lengths match the rollback snapshot for all 341 books. Storage still has 1112 objects and 261653092 bytes. No object was deleted.

The bucket classification is A 1020, B 2, C 5, D 0, E 85. Class E is unknown and is not proposed for deletion. Class C is unreferenced Book Staff data and stays. Class A and class B are the only later-deletion candidates, and only in a separate reviewed pass. The rollback map is `scripts/r2-book-url-object-manifest.json` plus `scripts/r2-book-url-rollback-manifest.json`. The classification is `scripts/r2-book-url-storage-classification.json`.

Live checks after the rewrite: `/book/106`, `/book/113`, `/book/174`, and `/book/454` serve `/__r2/` `og:image` and Book/Product JSON-LD and contain no Supabase book-covers URL. `/romanlar` contains `/__r2/` cover URLs and no Supabase book-covers URL. The homepage hero is still `/assets/store/shop-interior-main.webp`, `/assets/store/shop-interior-library.webp`, and `/assets/store/shop-exterior.webp`. The apex returns 308. `POST /api/ai-search` with `{}` returns 400 `invalid_query`. Unauthenticated `POST /api/r2-cover-upload` returns 401 `auth_required`. r2.dev stays disabled. `npm run test:unit` at `db7c820d`: 1508 PASS, 0 FAIL. Draft PR #227. Runtime baseline stays `445fe488`.

## LEGACY STORAGE DELETION STILL HELD

A resumed cleanup was asked to read `kutadgubiligkitab/kutadgubilig-mobile-app` before deleting class A and class B. The GitHub installation token available here lists one repository, `kutadgubiligkitab/kutadgu-bilig-kitabevi`. The mobile repository returns 404. Cart storage, wishlist storage, and release history were not read. No Storage API delete ran, `storage.objects` was not changed by SQL, and no restore manifest was created. All 1112 `book-covers` objects remain. Runtime baseline stays `445fe488`.
