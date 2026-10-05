# Storefront cover and performance investigation

Diagnosis only. No application code, styles, configuration, SQL, production data, or media assets were changed. Nothing was merged or deployed.

- Site: `https://www.kutadgubilik.com`
- Date: 2026-10-05
- Tested application commit: `d5802b66b34e846d6300b072708bc1ab9861c6ae`
- `shop.js` SHA-256: `b0c08e280594b35112bb942b534eae4e85eb7af7dcb36929c6d5e87c06e5750f`
- Numeric summary: `docs/investigations/2026-10-05-cover-load-summary.json`

## Plan recorded before the browser runs

Pages: `/`, `/books`, `/books?q=رومان`, `/adabiyat`, `/book/252`, `/book/261`, the author, translator, and publisher listings linked from those books, `/cart.html`, and `/favorites.html`.

Code paths: `shop.js` `coverSrc`, `assignCoverImage`, `handleCoverError`, `replayApprovedCover`, `markCoverUnavailable`, `coverImgHtml`, `syncStaticCards`, `applyDetailCoverFallback`, and the homepage carousel card builder; `premium-ux.js` `compactCard`, `bindCards`, `recoverCachedCoverFailure`, and `showGroup`; `kutadgu-category-listing.js` `coverHtml`; `kutadgu-image-storage.js` `installPreviewCoverBridge`; `shop.css` `img.is-cover-retrying`; `cloudflare/security-headers.js` `STOREFRONT_CODE` and `LONG_ASSET`; `cloudflare/preview-dispatch.js` `handlePosthog`.

Measurements: LCP, CLS, request count, transferred bytes, first visible cover time, intrinsic size versus displayed size, and failed or repeated image requests. INP was left unmeasured because these runs did not record interactions for that metric.

Scenarios: fresh browser context, second navigation in the same context, discovery tab switch while a slow download was still in progress, book then Back, rapid scroll on a slow connection, light and dark themes, 1280×900 and 390×800. One labeled request abort was added only after the real navigations.

## Live version

Chromium 151.0.7922.34 and WebKit 26.5, both Playwright headless. Caching stayed on. `shop.js?v=144` and `shop.js?v=138` returned the same bytes, and those bytes match the tested commit. `premium-ux.js?v=13` and `book-reviews.js?v=5` match that commit as well.

Pages requested the pins already in the tree: homepage `shop.js?v=144`, book shell `?v=143`, credit listings `?v=142`, cart `?v=141`, and `/books`, categories, and favorites `?v=138`. Every one of those navigations then loaded `premium-ux.js?v=13`. The homepage document matches the commit once the existing Cloudflare insights beacon and the R2 image boot scripts are removed.

Cover responses use `Cache-Control: public, max-age=31536000, immutable`. Storefront scripts use `public, max-age=300, s-maxage=3600, stale-while-revalidate=86400`. Book HTML uses `no-store, no-cache, must-revalidate`.

## What was exercised

Each row is a fresh context unless noted. Phone sizes are emulation, not a physical phone. Dark mode is `localStorage` key `kutadgu-theme=dark`, which adds `body.dark-mode`.

| Run | Result |
|---|---|
| Homepage, desktop, light. Carousel, then the first discovery group | 43 cover images, 9 in view, none blank after the group settled. Scripts `shop.js?v=144`, `premium-ux.js?v=13` |
| Homepage discovery group switch at 50 KB/s and 400 ms RTT | Final viewport showed decoded carousel covers. Discovery result images were below that viewport. CLS on this single harsh run was 0.786 |
| Homepage discovery group switch at about 1.6 Mb/s and 400 ms RTT | Same geometry: results below the fold, no in-viewport blank |
| `/books` desktop | Book 411 had `naturalWidth` 0 at 1675 ms. Next pixel sample was 7684 ms and showed a decoded image. Exact decode time was not sampled. LCP for that URL was 1764 ms |
| `/books` phone, rapid scroll, 50 KB/s | 6 in-view covers decoded. No blank remained |
| `/books` to `/book/448` and Back | Listing covers decoded. Some cover URLs were requested again and then served from cache |
| `/adabiyat`, search `رومان`, `/book/252` and its related row | In-view covers decoded |
| Author and publisher from book 252, direct and from the book | Decoded. `shop.js?v=142` |
| Translator from book 261, phone width | One in-view cover decoded. Book 252 has no translator link |
| Guest cart and guest favorites for book 252 | One in-view cover each. No checkout and no account write |
| Homepage and `/books` in dark mode, phone and desktop | Decoded |
| WebKit homepage, `/books` at 390×800, `/book/252` dark, `/adabiyat` | No blank in view |
| Labeled test abort of the first `/__r2/` cover on the homepage | The image errored once, a later request for the same URL returned 200, and the settled viewport had no blank |

## Cover findings

The lab did not produce a cover that stayed blank until a reload. That does not mean a phone on a poor network cannot show the symptom. The runs below are what actually happened.

On a fresh `/books` load, eager cards in the viewport were visible as empty images before the browser selected a source:

These rows are single observations. They are not medians, and they do not describe every cover.

- Book 411, one fresh desktop `/books` run. At 1675 ms the in-view image had `loading=eager`, `complete=false`, `currentSrc` empty, `naturalWidth=0`, opacity 1, and no `is-cover-retrying`. The next `naturalWidth` sample was at 7684 ms, and by then the image had decoded. No reload. The instant `naturalWidth` left 0 was not sampled between 1675 ms and 7684 ms. The same navigation recorded an LCP entry for that cover URL at 1764 ms. That timestamp is when the browser reported the largest paint, not a second pixel measurement. This observation does not say the cover stayed empty until 7.7 s, and it does not say every cover decoded within two seconds.
- Books 316, 392, and 398, one later `/books` timeline. At 1045 ms all three were empty in the same way. At 1297 ms book 398 had decoded and 316 and 392 were still empty. At 1549 ms 316 and 392 were still empty. At 1802 ms those two had decoded. The decode instant inside each gap was not measured. Book 316 is one of the titles named in the earlier literature-cover report. In this single lab run it had pixels by the 1802 ms sample.

That state is an image whose request had not committed a current source yet. It is distinct from a failed response, a missing image node, a `.book-cover-unavailable` replacement, and the `opacity: 0` rule on `img.is-cover-retrying` in `shop.css`. None of those four showed up on an untouched navigation. The retry class was not applied. No cover error event fired on those cards.

A warm second visit to `/books` painted the first cover from cache at about 270 ms in one sample run. The cold sample for a different book on the median set finished its response at about 1.1 s. Those two numbers are separate runs, not a before-and-after for the same image. A reload can still make a slow first paint look like a fix when the second load is served from the immutable cover cache. The physical-phone duration was not measured.

The labeled abort is separate evidence. `handleCoverError` and `replayApprovedCover` retried the cover, and the second response was HTTP 200. That confirms the existing retry can recover an aborted request. It does not identify the network error on the reported devices.

`/books`, category pages, cart, and favorites still request `shop.js?v=138`, while the homepage requests `?v=144`. Today both URLs return the current file, including the `premium-ux.js?v=13` loader. A browser that still held the pre-#243 `shop.js?v=138` body would be outside the one-day stale-while-revalidate window that started with the 2026-10-03 deploy. This lab always received the current file.

## Performance baseline

Lab conditions: Playwright, cache enabled, this machine's network, no CPU throttle. Cold means a new browser context. Warm means the second navigation to the same URL in that context. Figures are medians. Thresholds below are the Core Web Vitals targets published on web.dev (LCP within 2.5 s, CLS of 0.1 or less, INP within 200 ms). These are datacenter lab numbers, not physical-phone performance and not Chrome User Experience Report field data. INP was not measured. Cross-origin catalog timing reported 0 transferred bytes, so catalog payload size is unknown. WebKit reported about 205 KB for 27 covers, which cannot be the real file sizes, so WebKit byte totals are omitted.

| Page | Runs | Cold LCP | Warm LCP | Cold CLS | Warm CLS | Cold transfer | Warm transfer | Cold requests |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `/` 1280×900 | 5 | 500 ms | 64 ms | 0.018 | 0.015 | 6.16 MB | 117 KB | 113 |
| `/` 390×800 emulation | 3 | 488 ms | 64 ms | 0 | 0 | 4.63 MB | 117 KB | 100 |
| `/books` | 5 | 1.22 s | 300 ms | 0.009 | 0 | 3.90 MB | 114 KB | 80 |
| `/book/252` | 3 | 892 ms | 500 ms | 0.011 | 0 | 2.24 MB | 115 KB | 79 |
| `/adabiyat` | 3 | 704 ms | 560 ms | 0.006 | 0 | 5.89 MB | 121 KB | 96 |
| `/` WebKit 1280×900 | 3 | 1.06 s | 192 ms | 0 | 0 | — | — | 113 |

Load-only CLS stayed under 0.1. LCP stayed under 2.5 s. The homepage LCP element was `/assets/store/shop-interior-main.webp` (1440×1081, shown at 544×358 on desktop and 361×186 at phone width, 266 KB).

First-run resource split for the cold homepage, before any discovery click:

| Bucket | Requests | Transferred |
|---|---:|---:|
| Cover images | 27 | 3.82 MB |
| Preloaded font and other link resources | 22 | 1.24 MB |
| Other images, including all three hero slides | 4 | 756 KB |
| Scripts | 36 | 333 KB |
| Document | 1 | 7 KB |

`UKIJCJK.woff2` is 1.17 MB. The 6.09 MB `UKIJCJK.ttf` was not downloaded. The phone-width homepage requested 16 covers and 2.30 MB of cover bytes because fewer lazy images were in range.

Sampled card images versus the box they occupy:

| Book | Intrinsic | Displayed | Decoded |
|---|---|---|---:|
| 447 on `/books` | 1131×1600 | 353×534 | 601 KB |
| 133 on `/books` | 789×1124 | 353×534 | 44 KB |
| 306 on `/` | 955×1351 | 227×320 | 97 KB |
| 252 detail | 690×966 | 370×555 | 42 KB |

The three hero files are stacked in one frame, so Chromium fetched all of them on first paint: main 266 KB, library 219 KB, exterior 176 KB. Only the main slide is the LCP image.

On the warm homepage, cover, font, CSS, and `shop.js` transferred 0 bytes. The remaining ~117 KB was mostly `/kbg/static/array.js` (102 KB transferred, 319 KB decoded). `handlePosthog` copies the content type and does not set `Cache-Control`, and the live response has no cache header.

`/book/252` cold TTFB median was 518 ms, and the warm TTFB stayed 466 ms because the document is `no-store`. LCP was still 892 ms.

Opening a discovery group on one desktop run produced CLS 0.136. `compactCard` images have no `width` or `height`. Load-only homepage CLS stayed at 0.018, so the shift is tied to that later render.

## Ranked plan

This phase does not authorize the changes. Keep RTL layout, UKIJ CJK, colors, navigation, cards, stock behavior, contributor links, reviews, cart, favorites, and WhatsApp checkout as they are.

### 1. Cover behavior

No code defect was confirmed as a cover that stays blank until reload. The observed empty cards were still loading and then decoded.

The change that matches that evidence is a smaller card file, added beside the current cover. `kutadgu-cover-image.js` still stores the longest-edge 1600 WebP. `coverImgHtml` in `shop.js` and `compactCard` in `premium-ux.js` would point cards at a new shorter-edge variant. Detail and the lightbox keep the existing file. Do not replace, delete, or regenerate the current objects. Expected effect: the cold `/books` window where books such as 316 have `naturalWidth` 0 gets shorter, and the 3.8 MB homepage cover download drops. Verify on a throttled fresh `/books` load that the empty interval shrinks, that a warm load still comes from cache, and that the detail image is unchanged.

`img.is-cover-retrying { opacity: 0 }` in `shop.css` can hide a cover for the 300 ms and 900 ms retry delays. Real navigations did not enter that class. Leave it until a captured error shows the class on a blank card.

### 2. Measured loading cost

Inactive hero slides. `index.html` marks the library and exterior images `loading="lazy"`, but they share the visible hero frame, so Chromium downloaded all three (about 661 KB). `home-hero-content.js` can set the inactive `src` when the slide changes. Expected effect: about 395 KB less contention with the first covers. Verify that the first load requests only the main slide, that the next slide appears when the hero advances, and that LCP remains the main image.

Analytics static file. In `handlePosthog`, set a public cache header on GET `/kbg/static/` only. POST ingest stays uncached. Expected effect: the warm homepage drops about 102 KB and one repeated script. Verify a second navigation reports `transferSize` 0 for `array.js`, and that a POST to `/kbg` still has no long cache.

Card width and height. `compactCard` should set the same 2:3 box the CSS already uses. Expected effect: the 0.136 CLS measured while opening discovery stays under 0.1. Verify a throttled group switch. The 0.786 CLS figure came from one 50 KB/s run and should not be treated as the field value.

### 3. Needs more evidence

A cover that remains blank until reload, on a physical phone, was not reproduced. A useful capture is the blank card's book id, `src`, `currentSrc`, `complete`, `naturalWidth`, and whether `is-cover-retrying` is present, taken before the reload.

`recoverCachedCoverFailure` in `premium-ux.js` treats `complete && naturalWidth === 0` as an error. If a lazy image reports that pair before its request starts, `handleCoverError` would hide it with `opacity: 0`. These runs did not show that pair on discovery cards. A trace from a device that does would confirm it.

The next `shop.js` edit can bring the old stale-pin problem back for `/books` and categories, because those documents still say `?v=138`. It is not a current byte mismatch.

Subsetting `UKIJCJK.woff2` would cut about 1.17 MB from the first visit. That needs a glyph check before anyone changes the font file. This investigation does not recommend editing the font.

Book HTML `no-store` explains the ~500 ms TTFB. LCP is already under 2.5 s, so a cache change is not justified by these numbers alone.

## Follow-up plan

Recorded before the additional runs. The earlier slow discovery switches left `#premiumDiscoveryResults` below the viewport, so they do not describe visible result cards.

Additional scenarios, cache enabled, no reload until an in-view empty card has been recorded:

- Chromium 390×800 emulation, lab network emulation at 1.6 Mb/s down and 400 ms RTT: fresh group with result cards scrolled to the center of the viewport; rapid switch to the next group while the first group is still loading, then scroll that group's cards into view; warm second visit; open a visible card and go Back.
- Chromium 390×800 emulation, lab network emulation at 400 kb/s down and 400 ms RTT: one fresh group with result cards held in the viewport.
- WebKit 390×800 emulation on this machine's network. This WebKit build has no throughput emulation. Fresh, rapid switch, warm, and Back, with result cards in the viewport.

A run that cannot place result-card images inside the viewport is discarded as evidence of their visible loading. Phone-width figures stay emulation. The datacenter LCP and byte medians above stay lab results, not physical-phone performance.

Documentation updated by this follow-up: `docs/investigations/2026-10-05-cover-load-and-performance.md`, `docs/investigations/2026-10-05-cover-load-summary.json`, and the investigation sentence in `PROJECT-RECOVERY.md`. No application file changes.

## Visible discovery cards

Phone width here is a 390×800 Playwright viewport, not a physical phone. Cache stayed on. Chromium 151.0.7922.34 and WebKit 26.5. No follow-up run reloaded the page, and none of these runs aborted a cover request. The labeled abort farther up is a different, injected failure.

Before any group click, each fresh homepage had `#premiumDiscovery` present and `#premiumDiscoveryResults` empty: 0 images, friendly-empty prompt. That is the initial state.

A card counts as in view only when its image is more than 40 pixels inside the viewport and the rendered height is over 40 pixels. The earlier 50 KB/s and 1.6 Mb/s switches left the result grid below the viewport, so they are not used here. One 400 kb/s warm attempt also left the images around y=3971 while the viewport was 800 pixels tall. That attempt is discarded. The 400 kb/s warm row below is the retry that held the cards in view.

Clocks are `performance.now()` on that document. A warm navigation starts a new clock. These are individual samples, not medians. No in-view discovery image in these runs had `naturalWidth` 0. Several images were `naturalWidth` 0 at insertion, while they were still outside the viewport. The first sample that passed the in-view test already had decoded pixels. The exact decode time was not measured. That does not mean every cover painted within two seconds.

Chromium, lab throttle 1.6 Mb/s down and 400 ms RTT. The homepage waited 12875 ms. Literature was clicked at 12882 ms and History at 14806 ms, so the switch was 1.9 s after the literature click, once literature images existed. Two of eight History cards were then in view (tops 363 and 360, scrollY 6081).

| Book | When it was empty | First in-view sample | Bound |
|---|---|---|---|
| 468 | 14845 ms, `naturalWidth` 0, not in view. Same millisecond after `scrollIntoView`, still 0 and still not in view | 15433 ms, pixels present, `loading=lazy` | Exact decode time not sampled |
| 467 | Same 14845 ms empty, not in view | 15433 ms, pixels present | Exact decode time not sampled |

Neither History URL was in the resource list before the History click. No discovery image error fired. No `is-cover-retrying`, opacity stayed off 0, and no `.book-cover-unavailable` appeared. The retained request log does not include a timed row for those two paths.

Literature books 470 and 463 were already decoded in view by 14634 ms, before the History click. The switch did not catch those two while empty. When the grid was replaced at 14842 ms, books 456, 334, 330, 329, 317, and 316 still had `naturalWidth` 0. They were not the in-view pair. The replacement is `showGroup` writing new `innerHTML`. Those removed nodes had no retry class.

Warm literature on a second navigation, two cards in view (tops 362 and 362): books 470 and 463 were `naturalWidth` 0 at insertion (2576 ms, not in view) and decoded at the first in-view sample (3549 ms). No error, no retry class, opacity not 0.

Back from `/book/470`: `pageshow.persisted` was false, the path was `/`, the discovery section was present, and result images were 0 with the friendly-empty prompt. The grid did not survive Back. The later samples are a new Literature click, not a restored grid. On that click, books 470 and 463 were already decoded at insertion (`naturalWidth` 628 and 946) and were in view. One load event for book 470 followed at 4783 ms.

Chromium, lab throttle 400 kb/s down and 400 ms RTT. Fresh Literature hold. The homepage waited 36773 ms. Two of eight cards stayed in view (tops 362 and 362, scrollY 6244).

| Book | Insertion | First in-view sample |
|---|---|---|
| 463 | 39090 ms, `naturalWidth` 0, not in view | 40613 ms, pixels present. 22 later in-view samples, none empty |
| 470 | 39090 ms, `naturalWidth` 0, not in view | 40693 ms, pixels present. 21 in-view samples, none empty |

The click was at 36779 ms. No load event, error event, retry class, opacity 0, or unavailable node was recorded on this hold. The session's request log, which is not aligned to these pixel samples, includes HTTP 200 durations under this throttle such as 17424 ms for book 463's file. Those are request durations. They are not a measured blank-while-visible interval, and they are not physical-phone times.

Warm retry at the same throttle, after one Literature click and a second navigation. Before the second click the results were empty again. Two cards were in view (tops 362 and 362, scrollY 6244). Book 470's first in-view sample was 5883 ms with `naturalWidth` 628. Book 463's was 6183 ms with `naturalWidth` 946. No earlier empty in-view sample. No error, retry class, or unavailable node.

Back under that throttle opened `/book/470`. `pageshow.persisted` was false. At the first read, `#premiumDiscovery` was not in the document yet. After the section appeared, result cards were still 0 until Literature was clicked again. Those later samples are the new click. Books 470 and 463 were decoded at the first in-view sample (10147 ms). Load events at 10085 ms already had pixels, including off-screen books 456, 334, and 330.

WebKit 26.5 on this machine's network. Throughput was not emulated. The homepage waited 1262 ms. Literature at 1271 ms, History at 3008 ms. Four of eight History cards were in view (tops 363, 361, 757, and 757, scrollY 6091).

| Book | Insertion | First in-view sample | Request |
|---|---|---|---|
| 468 | 3080 ms, in view, `naturalWidth` 634 | 3080 ms, already decoded | URL already requested before the History click. Load at 3083 ms |
| 467 | 3080 ms, in view, `naturalWidth` 771 | 3080 ms, already decoded | Already requested. Load at 3084 ms |
| 461 | 3080 ms, not in view, `naturalWidth` 946 | 3331 ms, already decoded | Already requested. Load at 3084 ms |
| 460 | 3080 ms, not in view, `naturalWidth` 1126 | 3331 ms, already decoded | Already requested. Load at 3084 ms |

No empty in-view sample, no error, no retry class, no opacity 0, no unavailable node. WebKit request-byte timing was not collected. Literature books 470 and 463 were already decoded before the History click. Books 330, 329, 317, and 316 still had `naturalWidth` 0 when the grid was replaced at 3071 ms. They were outside the four in-view cards.

Warm Literature, four cards in view. Books 470 and 463 had pixels at insertion (1209 ms) and were already requested; the first in-view sample was 1461 ms. Books 456 and 334 also had pixels at insertion. Their load events are 1210 ms, the same millisecond as insertion, and the URL was not in the pre-click resource list. The first in-view sample was 1461 ms and already decoded.

Back from `/book/470`: `persisted` false, discovery present, 0 result images, friendly-empty prompt. A new Literature click then showed books 470, 463, 456, and 334 decoded at the first in-view sample. Load events at 949–950 ms already had `naturalWidth` above 0.

No follow-up run produced a discovery card that stayed blank until reload. The original symptom was not reproduced and is not explained. These throttled clocks are lab loading delays. They are not a phone trace.

## Limits

No physical phone. The datacenter LCP and byte medians are lab results, not physical-phone performance. No signed-in member. Guest cart and favorites stayed inside the test browser. WebKit byte sizes are unreliable. Catalog response sizes were opaque in resource timing. One injected abort is labeled and is not a field failure. The visible discovery runs did not inject a failure. They also did not record an in-view card with `naturalWidth` 0, so they do not time the empty-while-visible interval. The earlier premium-discovery retry and the homepage `shop.js?v=144` pin were present and loaded. The `/books` empty readings above are individual samples from the shared card markup and the current `shop.js` bytes. They are not a single recovery time for every cover. A cover that stays blank until reload was not reproduced.
