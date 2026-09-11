/* Optional second destination. Existing analytics/Supabase remain independent. */
(function () {
  "use strict";
  if (window.__kutadguPosthogBridge) return;
  const cfg = window.KUTADGU_POSTHOG_CONFIG || {};
  const enabled = () => cfg.enabled === true && window.KUTADGU_APP_CONFIG?.featureFlags?.analyticsHooks !== false;
  if (!enabled() || !/^phc_[A-Za-z0-9]+$/.test(cfg.publicProjectKey || "") ||
      !Array.isArray(cfg.allowedHosts) || !cfg.allowedHosts.includes(location.hostname)) return;
  window.__kutadguPosthogBridge = true;
  const allowed = new Set(["book_view", "add_to_cart", "whatsapp_order_click", "search",
    "zero_result_search", "add_to_favorite", "remove_from_favorite", "contact_click", "filter_apply"]);
  const fields = ["book_id", "search_query", "category", "result_count", "item_count", "order_total", "path", "book_ids"];
  const sdkFields = ["distinct_id", "$device_id", "$session_id", "$window_id", "$lib", "$lib_version", "$insert_id", "$time"];
  let sdk = null, failed = false;
  const pending = [];
  // Never retain query strings, fragments, or arbitrary user-provided route segments.
  const safePath = () => /^\/[a-z0-9/-]*(?:\.html)?$/i.test(location.pathname) ? location.pathname : "/";
  function capture(name, properties) {
    if (!enabled() || failed) return;
    try {
      if (sdk) sdk.capture(name, properties);
      else if (pending.length < 50) pending.push([name, properties]);
    } catch (_) { /* Never interrupt another analytics destination or the shop. */ }
  }
  document.addEventListener("kutadgu:analytics-event", function (event) {
    try {
      const detail = event.detail || {}, core = window.KutadguAnalyticsCore;
      if (!enabled() || !allowed.has(detail.name) || !core?.buildRow) return;
      const row = core.buildRow(detail.name, detail.data, {path: safePath()});
      if (!row) return;
      const properties = {path: safePath()};
      if (core.isCanonicalBookId(row.book_id)) properties.book_id = row.book_id;
      if (row.search_query) properties.search_query = row.search_query;
      // Category is controlled catalog metadata, but still apply the core sensitive-value filter.
      if (row.category && !core.looksSensitive(row.category)) properties.category = row.category;
      for (const field of ["result_count", "item_count", "order_total"])
        if (Number.isFinite(row[field])) properties[field] = row[field];
      if (row.meta?.book_ids) properties.book_ids = row.meta.book_ids.slice(0, 100);
      capture(detail.name, properties);
    } catch (_) { /* Malformed events must not affect the storefront. */ }
  });
  function beforeSend(event) {
    if (!enabled() || !event || (event.event !== "$pageview" && !allowed.has(event.event))) return null;
    const source = event.properties || {}, properties = {};
    const copyKeys = event.event === "$pageview" ? sdkFields : sdkFields.concat(fields);
    for (const key of copyKeys)
      if (Object.prototype.hasOwnProperty.call(source, key)) properties[key] = source[key];
    const path = safePath();
    properties.path = path;
    properties.$current_url = location.origin + path;
    properties.$pathname = path;
    properties.$process_person_profile = false;
    properties.$ip = "0.0.0.0";
    // The SDK requires the public ingestion token inside properties.
    properties.token = cfg.publicProjectKey;
    delete event.$set;
    delete event.$set_once;
    delete properties.$set;
    delete properties.$set_once;
    delete properties.$referrer;
    delete properties.$referring_domain;
    delete properties.session_id;
    const core = window.KutadguAnalyticsCore;
    if (properties.distinct_id && core?.looksSensitive?.(properties.distinct_id)) delete properties.distinct_id;
    event.properties = properties;
    return event;
  }
  try {
    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    script.src = "https://eu-assets.i.posthog.com/static/array.js";
    script.onerror = () => { failed = true; pending.length = 0; };
    script.onload = function () {
      try {
        if (!enabled() || !window.posthog?.init) { failed = true; pending.length = 0; return; }
        window.posthog.init(cfg.publicProjectKey, {
          api_host: "https://eu.i.posthog.com", ui_host: "https://eu.posthog.com",
          persistence: "memory", person_profiles: "never", ip: false,
          capture_pageview: true, capture_pageleave: false,
          autocapture: false, rageclick: false, capture_dead_clicks: false,
          disable_session_recording: true, capture_heatmaps: false, capture_performance: false,
          capture_exceptions: false, enable_recording_console_log: false,
          disable_surveys: true, disable_external_dependency_loading: true,
          advanced_disable_flags: true, advanced_disable_decide: true,
          save_referrer: false, save_campaign_params: false,
          disable_capture_url_hashes: true, respect_dnt: true,
          session_recording: {maskAllInputs: true, maskTextSelector: "*"},
          before_send: beforeSend,
          loaded: function (instance) {
            sdk = instance;
            for (const [name, properties] of pending.splice(0)) capture(name, properties);
          }
        });
      } catch (_) { failed = true; pending.length = 0; }
    };
    document.head.appendChild(script);
  } catch (_) { failed = true; pending.length = 0; }
})();
