# PostHog analytics

This optional second destination uses the official EU browser SDK and the existing
Kutadgubilik project (271583). The `phc_` ingestion key in `posthog-config.js` is
public browser configuration, not a personal API key. No server credentials are needed.

`posthog-analytics.js` listens before `analytics.js` runs, queues at most 50
sanitized events while the SDK loads, and catches SDK/load failures. The existing
Supabase tracker and core are unchanged. Only the nine approved custom events
are forwarded; existing `page_view` is ignored because the SDK owns `$pageview`.
Search filtering uses the existing core. Unknown fields, legacy IDs, session IDs
from Supabase, URL queries/fragments, referrers, and person properties are omitted.

The first version deliberately disables autocapture, session replay, heatmaps,
performance and console/network recording locally, regardless of remote project
settings. This avoids collecting checkout fields, WhatsApp URLs/message bodies,
or authentication URLs outside the reviewed event bridge. Remote project settings
are not changed. Those features require a separate privacy review before enabling.
In-memory anonymous IDs provide same-page funnels only, not cross-page identity.
Existing search heuristics cannot recognize every possible personal name or address
entered into search; the bridge preserves that existing protection.

Only the explicit production host list loads the SDK. Previews and local tests
remain disabled by default; override the public config before its script loads
to test a specific preview hostname. Set `enabled: false` to stop loading/sending.
Never add a wildcard preview host. Existing report-only CSP will report PostHog
requests, but the enforced policy does not block them. CSP policy changes are
outside this integration.

Run `npm run test:unit` (includes bridge tests). The new tests simulate the SDK
and run the real existing Supabase tracker without sending data externally.
Before merging, verify a preview with an explicit host override: one `$pageview`,
one `book_view`, allowed cart/search events, and no sensitive fields. Check network
payloads and PostHog ingestion. No live ingestion is claimed by unit tests.

References: https://posthog.com/docs/libraries/js and
https://posthog.com/docs/libraries/js/config.
