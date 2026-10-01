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

The bucket `kutadgu-covers-preview` exists (Eastern Europe, Standard). The preview Worker binds it as `COVERS`. Public image cutover is off: `KUTADGU_R2_PUBLIC_BASE_URL` is empty, `KUTADGU_R2_UPLOAD_ENABLED` is `false`, and the remote upload route returns 404. Book pages on the preview still use `fxlojnqwyojqjskfggmh.supabase.co` image URLs. No cover was copied and no `image_url` row was changed.

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

- the bucket is bound for the preview Worker only; it is not a public image host
- no production cover was copied
- no `image_url` row was updated
- no Supabase Storage object was deleted or moved
- Admin UI still uploads to Supabase Storage

The upload route is not linked from `admin.js`. Wiring that button is a later step. The route does not write `books.image_url`.

## F. Security

No new secret values were committed. R2 and OpenAI values are environment variables or a Wrangler binding. `.dev.vars` is gitignored. The browser image helper returns only a public origin and drops any key material passed to it.

Auth, RLS, MFA, and Admin policies were not edited. The upload scaffold fails closed: disabled by default, then Supabase `/auth/v1/user`, then JWT `aal2`, then `is_kutadgu_admin()` with the user token. It does not use a service-role key. The migration client has no delete method.

The enforced CSP is still `frame-ancestors 'none'`. The report-only policy is unchanged unless a valid `https` R2 origin is configured, and that origin is added only to `img-src`.

## G. Tests

`npm run test:unit` was run again after the remote deploy and exited 0. The log has 1499 `PASS` lines across 105 files and no failing file. That includes `scripts/cloudflare-preview-tests.js` (10 tests).

Remote smoke tests against `https://kutadgu-cloudflare-preview.kutadgu-preview.workers.dev` (HTTP answered during certificate setup, then HTTPS returned 200):

- `/` 200, `/books` 200, `HEAD /books` 200
- `/adabiyat` 200, canonical `https://www.kutadgubilik.com/adabiyat`, JSON-LD, Supabase cover URLs
- `/book/106` 200, canonical `https://www.kutadgubilik.com/book/106`, JSON-LD, Supabase image URLs, no `r2.dev`
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
