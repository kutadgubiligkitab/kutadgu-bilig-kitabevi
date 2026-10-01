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

PostHog collection on the preview host is not active. `posthog-config.js` still allows only the existing production hosts, so a `workers.dev` or localhost page does not start PostHog. The `/kbg` proxy itself is implemented and tested. Do not add the preview host to `allowedHosts` until a deliberate preview-analytics decision; that file also controls production.

Canonical URLs and JSON-LD stay on `https://www.kutadgubilik.com`. That matches the current SEO helpers.

`wrangler deploy --dry-run` bundles the Worker and does not deploy.

## E. R2 status

Prepared and covered by local tests. Not activated.

Prepared:

- public URL classification for the current Supabase host and one future R2 host
- report-only CSP can include that R2 host without dropping Supabase
- dry-run inventory and a copy planner that skips objects unless overwrite is explicitly enabled
- a Worker upload route that is 404 until `KUTADGU_R2_UPLOAD_ENABLED=true`
- an R2 binding name, `kutadgu-covers-preview`, with no production bucket attached

Tested:

- Supabase URLs stay accepted and are not rewritten
- a configured `https://covers.example.com` URL is accepted beside them
- dry-run performs no PUT
- copy without the confirmation value performs no PUT
- an existing key is kept unless `KUTADGU_R2_OVERWRITE=true`
- the upload route returns 404 while disabled, and when enabled in a unit test it requires a Supabase user, JWT `aal` `aal2`, and `is_kutadgu_admin()` before `put`

Not activated:

- no R2 bucket was created in the Cloudflare account
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

`npm run test:unit` exited 0. The log has 1499 `PASS` lines across 105 files and no failing file. That includes `scripts/cloudflare-preview-tests.js` (10 tests).

`npm run check:cloudflare` (`wrangler deploy --dry-run`) completed earlier and did not deploy.

`npm run preview:cloudflare` served `http://127.0.0.1:8787`. Checked there: `/` 200, `/books` 200, `HEAD /books` 200, `/adabiyat` 200 with canonical `https://www.kutadgubilik.com/adabiyat` and JSON-LD, `/book/106` 200 with canonical and JSON-LD, `/book/1` and `/book/not-a-number` 404, `/book?id=1` 308 to `/book/1`, `/sitemap.xml` and `/sitemap-books.xml` 200, `/sitemap-books-2.xml` 200 empty urlset, `GET /api/ai-search` 405, `POST /api/ai-search` 503 disabled, unknown path 404, `POST /api/r2-cover-upload` 404, `shop.js` and `admin.js` cache headers, and `www.kutadgubilik.com` pointed at the local port returns 421. No DNS record was changed.

No production order, Auth user, SQL migration, or Storage delete was run. `--live` inventory was tested with a mock response only.

## H. Remaining manual steps

These need a Cloudflare login. Do them only for a preview. Do not point `kutadgubilik.com` at the Worker.

1. Create an R2 bucket named `kutadgu-covers-preview` when a remote preview is wanted. Local `wrangler dev` can simulate the binding before that bucket exists.
2. Put preview secrets in `.dev.vars` or `wrangler secret put` for a remote preview: `OPENAI_API_KEY` only if AI search should be tried, and leave `KUTADGU_R2_UPLOAD_ENABLED` false.
3. A later remote preview deploy is `npx wrangler deploy` without a custom domain. That command is not an npm script on purpose.
4. DNS cutover is a separate, explicit decision. This branch refuses the production hostnames so that step cannot happen accidentally.

## I. Rollback

Leave production on Vercel. Do not merge this branch if the preview should stay unused. The live deployment is still whatever Vercel builds from `main`. Deleting the preview Worker or the unused R2 bucket does not affect Supabase or the current site. No data migration has to be undone because none was applied.
