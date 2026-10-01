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

Attempted 2026-10-01T12:52:37Z. Stopped before any write. Rollback was not needed because no Worker route and no DNS record was changed.

The Wrangler token can read the zone and Worker routes. `GET /zones/7476a42df4a2e7ed8debfe10b29216ea/dns_records` returned HTTP 403, error code 10000, authentication error. Proxy state, configured TTL, and record IDs were not returned, so the required rollback snapshot is incomplete. Public resolvers still answer apex `A` `216.198.79.1` and `www` `CNAME` `691042ca7074d500.vercel-dns-017.com`, with nameservers `steven.ns.cloudflare.com` and `coco.ns.cloudflare.com`. That public answer is not a Cloudflare proxy flag.

Before the stop, the zone had zero Worker routes and zero Worker custom domains. Production Worker `kutadgu-cloudflare-production` remained version `b859be14-dc00-4277-a426-451011f2dfc5`. The secret list still contains the name `OPENAI_API_KEY` only. `https://www.kutadgubilik.com/`, `/books`, and `/book/106` returned 200 with `server: Vercel`. A book cover on Supabase returned 200 `image/webp`. Live AI search returned 400 `invalid_query` for one character and 200 with 12 results for `kitab`. `npm run test:unit` exited 0 with 1502 `PASS` lines and 0 failures.

No route was attached. DNS targets and proxy flags were not written. Vercel and Supabase were not modified. The production Worker and the R2 bucket were not deleted. Draft PR #222 stays unmerged.
