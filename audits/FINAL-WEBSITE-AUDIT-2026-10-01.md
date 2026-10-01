# ئاخىرقى تور بېكەت تەكشۈرۈشى — 2026-10-01

## ئۇيغۇرچە قىسقىچە خۇلاسە

قۇتادغۇبىلىك كىتابخانىسىنىڭ ئىشلەپچىقىرىش بېتى ھازىر ئىشلىتىشكە بولىدۇ. خېرىدار كىتاب كۆرەلەيدۇ، ئىزدىيەلەيدۇ، سېۋەتكە قوشالايدۇ، ياقتۇرغانلىرىنى ساقلىيالايدۇ، ۋە زاكاز خېتىنى WhatsApp قا يوللىماي تۇرۇپ ئالدىن كۆرەلەيدۇ. بۇ قېتىمقى تەكشۈرۈشتە دەرھال توختىتىدىغان بۇزۇلغان خېرىدار يولى تېپىلمىدى.

ئىشلەپچىقىرىش بېتى GitHub `main` نىڭ `102f7db121787e7315b8832c01c8a4d1640b9fcb` نۇسخىسى بىلەن ماس. بۇ #219 نىڭ قوشۇلغان ھالىتى. #217 نىڭ ISBN قائىدىسى، #218 نىڭ ئانالىتىكا كودى، ۋە #219 نىڭ «بۇ قېتىملىق بايقاش تەرتىپى» ھەممىسى بۇ نۇسخىدا ساقلانغان.

ئېنىق پەرق بىرلا: كۈندىلىك زىيارەتچى سانى ئۈچۈن يېزىلغان `STAGE100` SQL ئىشلەپچىقىرىش سانداندا قوللىنىلمىغان. بۇ كود خاتالىقى ئەمەس. زىيارەتچى سانى كۆرۈنمەيدۇ، نۆل دەپ يالغان كۆرسىتىلمەيدۇ. بۇ SQL نى بۇ تەكشۈرۈش ئىجرا قىلمىدى.

كىرگەن ئەزا، Google كىرىش، پارول خېتى، ھېساب ئۆچۈرۈش، باشقۇرغۇچى MFA ۋە كىتاب تەھرىرلەش ئىشلەپچىقىرىشتا سىنالمىدى. ئۇلار «ئۆتتى» دەپ يېزىلمايدۇ. يەرلىك سىناق 768 قېتىم ئۆتتى، 3 ى ئاتلاپ كەتتى. سىناقنىڭ ئۆتۈشى ئىشلەپچىقىرىشنىڭ ئۆزىنى ئىسپاتلىمايدۇ. ئىشلەپچىقىرىشنى ئايرىم كۆرۈپ چىقتۇق.

كود توڭلىتىشقا بولىدۇ. دەرھال يېزىلىدىغان كود تۈزىتىشى يوق. زىيارەتچى سانى كېرەك بولغاندا SQL قول بىلەن قوللىنىلىدۇ. كودنى قايتا ئېچىشقا ئەرزىيدىغان ئەھۋال: بىخەتەرلىك ۋەقەسى، زاكاز يولىنىڭ بۇزۇلۇشى، كاتالوگنىڭ خاتا يوشۇرۇلۇشى، ياكى ئىگىسى STAGE100 نى قوللىنىشنى قارار قىلىشى.

## Baseline

| Item | Value |
|---|---|
| Audit window | 2026-10-01 04:17–04:35 Europe/Istanbul (01:17–01:35 UTC) |
| Repository | `kutadgubiligkitab/kutadgu-bilig-kitabevi` |
| Source SHA reviewed | `102f7db121787e7315b8832c01c8a4d1640b9fcb` |
| Subject | Merge pull request #219 from `feat/books-visit-rotation` |
| Commit time | 2026-10-01 03:58:45 +03 |
| Application behavior SHA | `d6ba212392f8794f77fffc0fee0167b6050393c3` (visit-order behavior). The merge commit does not add a later behavior change. |
| Handoff on this SHA | `PROJECT-RECOVERY.md` still says PR #219 is draft and not merged. That sentence is stale. This audit does not edit the handoff. |
| Open pull requests | None at audit time |
| Production | `https://www.kutadgubilik.com` |
| Production deployment | `dpl_5KTRsHotA8ihS3xfPzZhzBoxnv8U`, state READY, target production |
| Deployment git SHA | `102f7db121787e7315b8832c01c8a4d1640b9fcb` on `main` |
| Deployment ready | 2026-10-01 00:59:00 UTC (03:59 +03) |
| Production aliases | `www.kutadgubilik.com`, `kutadgubilik.com` (308 to www), `kutadgu-bilig-kitab.vercel.app` |
| Asset match | Production `index.html`, `books.html`, and `shop.js` ETags equal the files at this SHA. `books.html` loads `kutadgu-visit-order.js?v=2` immediately before `kutadgu-search-rank.js?v=1` and `shop.js?v=137`. |
| Supabase | Project `fxlojnqwyojqjskfggmh`, Postgres 17.6, region `eu-west-1`, status ACTIVE_HEALTHY. Read-only schema and aggregate counts only. |
| Browser actually used | Playwright 1.62.1, Chromium 151.0.7922.34, headless, Linux, Node 22.14.0. Time zone set to Europe/Istanbul. |
| Viewports | 360, 390, 430, 768, 1280, and 1440 CSS pixels. These are emulated viewports in Chromium. They are not native Safari, Firefox, or a physical phone. |
| Analytics guard | Before navigation, the browser aborted `analytics_events`, `get_kutadgu_analytics`, `/kbg/`, PostHog script URLs, and `wa.me`. 123 POST attempts to `analytics_events` were aborted. One `wa.me` navigation was aborted. No WhatsApp message was sent. No order, account, or analytics row was written by this audit. |
| Local tests | `npm run test:unit` exit 0. Full Stage 10: 768 passed, 3 skipped, 0 failed, Chromium, `http://127.0.0.1:4173`, `KUTADGU_USE_LOCAL_STATIC=1`, `KUTADGU_PREVIEW_URL` unset. |

Production HTML and `shop.js` were compared by MD5 ETag and byte length with this checkout. They match. Repository behavior and production behavior are the same revision for this audit. That match is specific to deployment `dpl_5KTRsHotA8ihS3xfPzZhzBoxnv8U`. It should not be assumed for a later commit.

## Coverage

| # | Area | Result | Evidence |
|---|---|---|---|
| 1 | First visit, homepage, navigation | PASS | Homepage title, one H1, hero copy, category links, and footer trust links render. `screenshots/01-home-1440.png`, `02-home-390.png`. |
| 2 | Header, mobile bottom nav, sticky | PASS | Header is `sticky` at 1280/1440 and `fixed` at 360–768. Bottom nav is visible at 360, 390, 430, and 768, hidden at 1280. Link height is 50px. No horizontal overflow. |
| 3 | All-books discovery order | PASS | Two fresh sessions showed different first pages. Reload and detail → Back kept the same ids. Sort value `discover`, label `بۇ قېتىملىق بايقاش تەرتىپى`. Visit key was in `sessionStorage` only. Snapshot length 341. |
| 4 | Pagination and catalog coverage | PASS | Load more 14 times rendered 341 unique ids and the button disappeared. Active-book count is `0-0/341`. `sitemap-books.xml` has 341 `<loc>` entries. |
| 5 | Categories and first-byte links | PASS | `/adabiyat` canonical is correct, the discover option is absent, and the grid became ready with 24 cards. Raw HTML contains 105 unique `/book/<id>` links before client paging. |
| 6 | Search, Uyghur, Latin, ISBN, zero results | PASS | Uyghur token from a live title returned a hit. ISBN `7537308195` returned 1/1 and the matching book. `zzzz-no-such-book-audit` showed `0 / 0` and the empty-state copy. A Latin token `kitab` returned no cards; titles in the sample are Uyghur, so that result is expected. |
| 7 | Filters, sorts, reset | PASS | Price low moved the grid and the first prices rose from 134,49 ₺ through 136 ₺. Price high started at 1.393 ₺ and fell. Reset restored `discover` and the same first-page ids. |
| 8 | Book detail, metadata, related books | PASS | `/book/328` has one Product+Book JSON-LD script, a breadcrumb, ISBN row, gallery, and related cards below the fold. `/book/not-a-number` is HTTP 404, `noindex`, title `كىتاب تېپىلمىدى`. |
| 9 | Covers and aspect ratio | PASS | Eight listing covers used `object-fit: contain` inside equal frames (353×534, ratio 0.66). None of those eight were broken. Detail cover is letterboxed, not cropped. |
| 10 | Prices, TRY, stock, quantity | PARTIAL | Prices use ₺ and line totals match quantity × unit price (2 × 240 = 480; preview 3 × 240 = 720; later preview 1 × 140 = 140). Manual `out_of_stock` on book 402 displays `تۈگەپ كەتتى` even though `stock` is 20. That follows `kutadgu-stock.js`: a manual out status wins over a positive quantity. Lowest active stock is 5, so a one-item ceiling was not present to test. |
| 11 | Guest cart | PASS | Add, quantity, line total, remove, and empty state work. After remove, `kutadgu-cart-v1` is `[]` and the badge returns to 0. `screenshots/10-cart-1280.png`, `13-cart-390.png`, `29-cart-after-remove.png`. |
| 12 | Favorites | PASS | A guest favorite survived reload on `/favorites.html` (1 card before and after reload). |
| 13 | WhatsApp preview | PASS | Preview contained the Uyghur title, quantity, unit price, line total, and grand total. The outbound `wa.me` navigation was aborted. No message was sent. `screenshots/11-order-preview-1280.png`. |
| 14 | Login, register, Google, recovery | PARTIAL | Login and signup forms render. Empty email is `valueMissing`, `not-an-email` is `typeMismatch`, a short password is `tooShort`. Mismatched signup passwords show `ئىككى پارول بىر-بىرىگە ماس كەلمىدى`. Google button is present. No account was created, no Google OAuth was completed, and no recovery email was sent. |
| 15 | Guest/member sync and account boundaries | BLOCKED | No member session was available. Guest cart and favorites stayed in local storage. Cloud merge was not executed. Stage 10 covers this with mocks only. |
| 16 | Logout, session expiry, deletion | PARTIAL | `/delete-account.html` renders the deletion explanation. Logout, expiry, and a real deletion were not run. |
| 17 | Admin access, AAL2, idle lock | BLOCKED | `/admin.html` shows the admin login wall to an anonymous visitor. MFA, idle lock, and role separation were not signed in. Stage 10 exercises them with mocks. |
| 18 | Admin catalog forms and uploads | BLOCKED | Not run against production. Local Stage 10 admin specs passed against mocks. |
| 19 | Admin analytics | PARTIAL | Application code from #218 is deployed. Production SQL is not. See the database section. The admin chart itself was not opened while signed in. |
| 20 | Announcements, hero, recommendations | PASS | Homepage hero, store photo, and recommendation/search blocks render. Related books render on the detail page. Admin editing of those blocks was not opened. |
| 21 | About, contact, hours, policies | PASS | Contact block shows the published address, hours (دۈشەنبە–شەنبە 09:00–19:30, يەكشەنبە 10:30–18:00), and the same WhatsApp destination used by checkout. `/order-info`, `/privacy`, and `/returns` return their own titles and canonicals. |
| 22 | Responsive, RTL, UKIJ, long content | PASS | `lang=ug`, `dir=rtl`. No horizontal overflow at the tested widths on the homepage, book detail, or cart. Mobile `/books` shows 12 cards and the discover sort. Long Uyghur titles remain inside cards in the screenshots. |
| 23 | Accessibility | PARTIAL | Search fields have labels. Keyboard focus on the header search draws a 3px light outline. Empty and mismatch errors are exposed on the forms. Dialog focus trapping and a full contrast audit of every component were not completed. Sampled body text `#44352d` on `#f6f0e5` is about 10.3:1. White header text on `rgb(75,51,39)` is about 11.7:1. The header placeholder, composited, is about 6.9:1. |
| 24 | SEO | PASS | Canonicals, titles, descriptions, `robots.txt`, and the sitemap index are present. Book 328 emits ISBN-10 `7537308195` and omits `gtin13`. Book 106 emits ISBN-13 `9787105123285` as both `isbn` and `gtin13`. Non-numeric book URLs are noindex 404s. |
| 25 | Performance and resilience | PARTIAL | Production pages returned in one round trip with the expected cache headers (`shop.js`: `max-age=300, s-maxage=3600, stale-while-revalidate=86400`). Slow, failed, and out-of-order requests were not replayed against production. Local Stage 10 includes failed-catalog, aborted Load more, and stale-response coverage, and that suite passed. |
| 26 | Security and privacy | PARTIAL | Anonymous reads of `orders`, `profiles`, and `analytics_events` return permission denied. Inactive books return an empty set. Admin HTML is behind a login wall. Framing is denied and HSTS is set. The longer CSP is report-only. Signed-in authorization and Storage writes were not probed. |

## Confirmed defects

No confirmed customer-facing code defect met the evidence bar in this audit.

The checks that looked like defects and were rejected are listed under false positives.

## Observations

These are real and evidenced. They are not counted as broken storefront bugs.

### 1. Stage 100 analytics SQL is not applied in production

Read-only catalog of `public.analytics_events` columns:

`id`, `event_name`, `book_id`, `search_query`, `category`, `result_count`, `item_count`, `order_total`, `path`, `session_id`, `created_at`, `legacy_id`, `meta`.

Absent: `visitor_id`, `event_id`, `host`, `occurred_at`, `action_seq`.

`public.get_kutadgu_analytics(p_days integer)` does not mention `visitor_id` or `Europe/Istanbul` (definition length 1940). The only non-internal trigger on the table is `analytics_events_apply_book_engagement`. The Stage 100 timing trigger is absent.

Impact: the daily visitor chart and the ordered funnel from #218 cannot be populated. The handoff says the admin page shows an unavailable mark rather than zero when those fields are missing. That claim was not re-checked while signed in, so the admin screen itself stays PARTIAL. Customer shopping does not depend on this SQL.

Priority: not a storefront P0/P1. It is an operational gap for the owner who wants those admin numbers. Applying the SQL is a manual database change. This audit did not apply it.

### 2. Catalog metadata is incomplete on some active books

Among 341 active books: 57 have a blank author or the stored fallback `يېزىلمىغان`, and 58 have no ISBN. ISBN-13 digit strings: 213. ISBN-10 shape: 70. ISBN-13 values with a prefix other than 978/979: 0. Values starting with `9790`: 0.

The storefront shows `يېزىلمىغان` instead of inventing an author. Invalid or empty ISBNs are omitted from JSON-LD. That is the intended #217 behavior. Filling the 57 authors or 58 ISBNs is catalog work, not a code change.

### 3. Three books are manually marked out of stock while the quantity column is positive

| id | stock | stock_status | Storefront |
|---|---|---|---|
| 402 | 20 | `out_of_stock` | Badge text `تۈگەپ كەتتى`, cover class `is-stock-out` |
| 403 | 15 | `out_of_stock` | Same code path |
| 404 | 20 | `out_of_stock` | Same code path |

`kutadgu-stock.js` treats a manual out-of-stock status as not purchasable even when quantity is above zero. The page follows that rule. If the status was set on purpose, the quantity column is stale. If the quantity is the truth, the status is stale. Either way the next step is an owner decision about those three rows, not a storefront code change.

### 4. The recovery handoff on this SHA is stale

`PROJECT-RECOVERY.md` at `102f7db` still says #219 is a draft and not merged, and it still describes `origin/main` as the #218 merge `8f9bf64e`. The runtime baseline SHA `d6ba2123` is still the right behavior commit. The merge commit should be recorded as merged, without moving the behavior baseline backward. This audit report records that. The handoff file was not edited.

### 5. Content-Security-Policy is report-only

Responses send an enforcing `frame-ancestors 'none'` plus `X-Frame-Options: DENY`, HSTS, `nosniff`, and a separate `Content-Security-Policy-Report-Only` policy. The report-only policy does not block. That is hardening headroom, not a demonstrated injection.

### 6. During a search the sort control can still display the discovery label

On a zero-result query the select still showed `بۇ قېتىملىق بايقاش تەرتىپى` while the empty count was `0 / 0`. The listing code maps discover-plus-search onto relevance internally. For an empty result the order is not visible. This is labeling accuracy, not a failed search. Reset returned the same discovery ids.

## False positives reviewed

- The pagination script reported duplicate ids because it scanned the whole grid after every Load more. The unique set was 341, the snapshot was 341, and Load more ended. Those duplicates were double-counting, not repeated books.
- The first detail-image measurement matched the header logo (38×38). Listing and detail covers use `object-fit: contain` in the shared frame.
- The first order-preview screenshot was blank because the WhatsApp navigation was aborted and left the cart document. The preview text had already been captured, and a later screenshot shows the prepared order before send.
- Programmatic focus on the header input does not draw the ring. `:focus-visible` does. Keyboard focus showed `outline: rgba(255, 245, 230, 0.95) solid 3px`.
- A Latin query `kitab` with zero cards is not a broken search. Uyghur text and a full ISBN matched.

## Strongest behavior

1. Production is the commit that was audited. ETags, script pins (`shop.js?v=137`, `kutadgu-visit-order.js?v=2`), and the deployment SHA agree.
2. The full active catalog is one set of 341 books in the database count, the sitemap, and a complete Load more walk. Hidden books are not returned to the anonymous key.
3. Visit discovery does what #219 specified: a new tab gets a new order, the same tab keeps it across reload and Back, and the seed is not stored in `localStorage`.
4. ISBN structured data matches #217 on live pages: a valid ISBN-10 stays `isbn` without `gtin13`; a valid 978 ISBN-13 is both `isbn` and `gtin13`.
5. Guest cart math, favorites, empty states, and the WhatsApp preview are coherent in Uyghur, including quantity and ₺ totals.
6. Anonymous clients cannot read orders, profiles, or analytics events. The admin URL shows a login wall.
7. RTL layout holds at phone and desktop widths used here, with no horizontal overflow on the pages measured.

## Weakest behavior

1. The visitor analytics feature is deployed in code and absent in the database. Admin numbers from #218 are not live.
2. Signed-in member sync, Google login, password-reset delivery, account deletion, admin MFA, idle lock, and catalog uploads were not exercised on production.
3. Dozens of active books still have no author or no ISBN. The UI is honest about that, and the gaps remain visible.
4. The handoff file on `main` still describes #219 as unmerged.
5. Native Safari and Firefox were not available. Chromium emulation is the browser evidence.

## Decision table

Suggestions only. Nothing in this table was implemented.

| Decision | Item | Why | Impact | Priority | Optional |
|---|---|---|---|---|---|
| KEEP | Visit discovery on unfiltered `/books` | Two sessions differed; reload and Back matched; category pages do not use it | Customer browsing | — | No |
| KEEP | ISBN / `gtin13` rules | Live JSON-LD matches the prefix and checksum rules | Search appearance | — | No |
| KEEP | Guest cart, favorites, WhatsApp preview | Add, totals, remove, and preview encoding worked; send was intercepted | Orders | — | No |
| KEEP | Current cover files and pins | Frames use contain; files and paths were not part of a defect | Catalog appearance | — | No |
| KEEP | Analytics client that omits missing columns | Production still has the old columns; the client is built to skip them | Avoids duplicate or failed inserts | — | No |
| FIX | None in application code | No confirmed broken customer path | — | — | — |
| REMOVE | None | No abandoned control was shown to be harmful | — | — | — |
| ADD | None | No missing feature blocked a current customer task | — | — | — |

Operational, outside this code table: when the owner wants daily visitor counts, apply `STAGE100_ADMIN_DAILY_VISITORS.sql` by hand in the Supabase SQL editor, then look at the admin analytics card. Do not apply `STAGE8_STORE_ANALYTICS.sql` over it. This audit did not run that SQL.

## Staged roadmap

### Stage A — urgent security, data integrity, or broken customer flows

No item. Anonymous data access is denied on orders, profiles, and analytics. The cart and preview paths that were tested completed. Stage 100 being unapplied does not corrupt customer orders or show false zero visitors in a check this audit could see.

### Stage B — other confirmed functional defects

No item.

### Stage C — worthwhile professional polish

- Reconcile `PROJECT-RECOVERY.md` so #219 is recorded as merged at `102f7db`, while leaving the behavior baseline at `d6ba2123`. Documentation only.
- If the owner wants the sort control to say relevance whenever a search box is non-empty, that is a small label change. Search results already follow relevance.

### Stage D — deferred optional features

No feature from this audit needs a backlog entry. Author and ISBN gaps are catalog data, not a new feature. Enforcing the report-only CSP would be a later security hardening pass, only after a separate review of every allowed host.

## Tests

| Suite | Result | Notes |
|---|---|---|
| `npm run test:unit` on `102f7db` | Exit 0 | Includes visit-order, ISBN/schema, analytics retry, and security-hardening unit checks. |
| Stage 10 Playwright, Chromium, local static preview | 768 passed, 3 skipped, 0 failed, 7.1 minutes | Target `http://127.0.0.1:4173`. Not production. |
| Skipped | `seo-admin.spec.js` admin dashboard login (optional credentials) | No credentials in the environment. |
| Skipped | `seo-admin.spec.js` member account login (optional credentials) | No credentials. |
| Skipped | `storefront.spec.js` legacy id resolves to the same book | Conditional skip inside the spec. Not a failure. |
| Flaky retries | None in this Stage 10 run | The earlier hero-screenshot `EIO` was on the pre-merge branch and did not recur. |
| Production browser | Chromium only | Recorded above. Not a substitute for the local suite, and the local suite is not a substitute for production. |

## Open PRs and deployment drift

- Open pull requests: none.
- Latest merged: #219 at `102f7db`, #218 at `8f9bf64e`, #217 at `f35fa6f`.
- Vercel production deployment `dpl_5KTRsHotA8ihS3xfPzZhzBoxnv8U` is that same #219 merge. Code drift between GitHub `main` and the live site was not observed.
- Database drift: Stage 100 objects are absent. Merging #218 did not change the live function. The live function is still the older rolling-window body described in the handoff.
- `PROJECT-RECOVERY.md` drift: it has not yet been updated to say #219 merged.

## Stabilization

Before a code freeze, no application change is required by this audit.

What can wait:

- Applying Stage 100, until the owner wants visitor counts.
- Filling missing authors and ISBNs in the catalog.
- Editing the three out-of-stock status rows after the owner decides which field is true.
- Updating the handoff sentence about #219.
- Any CSP enforcement work.

Reopen code changes if:

- A customer cannot add to the cart, open a book, or prepare a WhatsApp order.
- Active books disappear from the public catalog or inactive books become public.
- A security report shows unauthorized reads or writes.
- The owner applies Stage 100 and the admin chart disagrees with the SQL definitions.
- A new `main` commit is deployed and the production SHA no longer matches the commit that was reviewed.

## Direct answers

Is the site usable now? Yes. A guest can browse, search, filter, paginate the full 341-book catalog, add and remove cart lines, keep a favorite, and preview a WhatsApp order.

Is an immediate fix needed? No code fix. The unapplied analytics SQL does not block shopping. It should be applied only when those admin numbers are wanted, and not from an unreviewed agent run.

What is the smallest justified first fix? There is no justified code fix from this audit. The smallest useful follow-up is operational: either leave Stage 100 unapplied and freeze, or apply that one SQL file by hand and then check the admin chart.

Can development pause after the necessary fixes? Yes. There is no necessary code fix waiting. Pause is reasonable. Signed-in and admin production flows remain unverified, so a pause does not mean those flows were proven.

## Evidence

All paths are under `audits/final-website-audit-2026-10-01/`.

- `browser-evidence.json` — production interaction log, blocked request counts, discovery ids, pagination, search, account validity flags.
- `probe.json` — stock badge on book 402, price-sort samples, keyboard focus, mobile page size, cart preview text, cart removal.
- `rest-probes.json` — anonymous counts and permission denials. No row bodies.
- `screenshots/` — desktop and mobile captures listed in the coverage table. Screenshot `11-order-preview-1280.png` is the prepared order before the intercepted send. Screenshot `25-signup-validation-1280.png` uses the synthetic address `audit-example@example.com`; the submit was aborted and no account was created.

No customer personal data, session token, or API key is included in these files.
