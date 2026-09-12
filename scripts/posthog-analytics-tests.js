"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const core = require("../kutadgu-analytics-core.js");
const source = fs.readFileSync("posthog-analytics.js", "utf8");
function setup(overrides = {}) {
  const listeners = {}, captures = [], requests = [], scripts = [];
  let options;
  const document = {
    readyState: "loading", head: {appendChild: s => scripts.push(s)}, createElement: () => ({}),
    addEventListener: (name, fn) => (listeners[name] ||= []).push(fn),
    dispatchEvent: event => (listeners[event.type] || []).forEach(fn => fn(event))
  };
  const instance = {capture: (event, properties) => captures.push({event, properties})};
  const window = {KutadguAnalyticsCore: core,
    KUTADGU_POSTHOG_CONFIG: {enabled: true, publicProjectKey: "phc_test", allowedHosts: ["kutadgubilik.com"], ...overrides},
    KUTADGU_SUPABASE_CONFIG: {url: "https://example.invalid", anonKey: "test"},
    posthog: {init: (key, config) => {options = config; config.loaded(instance);}}
  };
  const context = vm.createContext({window, document, location: {hostname: "kutadgubilik.com", origin: "https://kutadgubilik.com", pathname: "/book/102", search: "?email=private", hash: "#access_token=private"},
    CustomEvent: function(type, init) {this.type = type; this.detail = init.detail;},
    fetch: async (url, init) => {requests.push({url, init}); return {ok: true};},
    sessionStorage: {getItem: () => "test-session"}, crypto: {}, console});
  vm.runInContext(source, context);
  return {window, document, captures, requests, scripts, context, instance, options: () => options,
    emit: (name, data = {}) => document.dispatchEvent({type: "kutadgu:analytics-event", detail: {name, data}})};
}
(async () => {
  const h = setup();
  h.emit("book_view", {bookId: "102", email: "private", name: "private", message: "private"});
  assert.equal(h.captures.length, 0);
  h.scripts[0].onload();
  assert.equal(h.captures.length, 1);
  assert.equal(h.captures[0].properties.book_id, "102");
  assert.equal(h.captures[0].properties.path, "/book/102");
  assert.ok(!("session_id" in h.captures[0].properties));
  assert.ok(!JSON.stringify(h.captures).includes("private"));
  assert.ok(!JSON.stringify(h.captures).includes("email=private"));
  assert.ok(!JSON.stringify(h.captures).includes("access_token"));
  h.emit("page_view"); h.emit("unknown"); h.emit("toString");
  h.emit("search", {query: "a@example.com"});
  h.emit("search", {query: "+90 536 899 98 88"});
  h.emit("whatsapp_order_click", {bookId: "102", items: 1, total: 80, name: "Ali", phone: "+90536", address: "Istanbul", email: "a@b.c", message: "hello", note: "leave at door"});
  h.emit("filter_apply", {source: "romanlar", results: 4, rendered: 4});
  assert.equal(h.captures.length, 3);
  assert.equal(h.captures[1].event, "whatsapp_order_click");
  assert.ok(!JSON.stringify(h.captures[1]).includes("Ali"));
  assert.ok(!JSON.stringify(h.captures[1]).includes("Istanbul"));
  assert.ok(!("source" in h.captures[2].properties));
  assert.equal(h.captures[2].properties.result_count, 4);
  const afterPrivacy = h.captures.length;
  for (const name of Object.keys(core.ALLOWED_EVENTS).filter(n => n !== "page_view"))
    h.emit(name, {bookId: "102", query: "history", results: 0});
  assert.equal(h.captures.length, afterPrivacy + 9);
  const opt = h.options();
  assert.equal(h.scripts[0].src, "/kbg/static/array.js");
  assert.equal(opt.api_host, "/kbg");
  assert.equal(opt.ui_host, "https://eu.posthog.com");
  assert.ok(!source.includes("https://eu-assets.i.posthog.com"));
  assert.ok(!source.includes("https://eu.i.posthog.com"));
  assert.equal(opt.persistence, "memory");
  assert.equal(opt.person_profiles, "never");
  assert.equal(opt.ip, false);
  assert.equal(opt.capture_pageview, true);
  assert.equal(opt.capture_pageleave, false);
  assert.equal(opt.autocapture, false);
  assert.equal(opt.rageclick, false);
  assert.equal(opt.capture_dead_clicks, false);
  assert.equal(opt.disable_session_recording, true);
  assert.equal(opt.capture_heatmaps, false);
  assert.equal(opt.capture_performance, false);
  assert.equal(opt.capture_exceptions, false);
  assert.equal(opt.enable_recording_console_log, false);
  assert.equal(opt.disable_surveys, true);
  assert.equal(opt.save_referrer, false);
  assert.equal(opt.save_campaign_params, false);
  assert.equal(opt.respect_dnt, true);
  assert.ok(!source.includes("identify("));
  assert.match(source, /new Set\(\["book_view", "add_to_cart", "whatsapp_order_click", "search",\s*"zero_result_search", "add_to_favorite", "remove_from_favorite", "contact_click", "filter_apply"\]\)/);
  const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
  const rewrites = vercel.rewrites || [];
  const assetProxy = rewrites.find((rule) => rule.source === "/kbg/static/:path*");
  const arrayProxy = rewrites.find((rule) => rule.source === "/kbg/array/:path*");
  const ingestProxy = rewrites.find((rule) => rule.source === "/kbg/:path*");
  assert.equal(assetProxy.destination, "https://eu-assets.i.posthog.com/static/:path*");
  assert.equal(arrayProxy.destination, "https://eu.i.posthog.com/array/:path*");
  assert.equal(ingestProxy.destination, "https://eu.i.posthog.com/:path*");
  const assetIdx = rewrites.findIndex((rule) => rule.source === "/kbg/static/:path*");
  const arrayIdx = rewrites.findIndex((rule) => rule.source === "/kbg/array/:path*");
  const ingestIdx = rewrites.findIndex((rule) => rule.source === "/kbg/:path*");
  const lastBookstoreIdx = rewrites.findIndex(
    (rule) => rule.source === "/book" && rule.destination === "/book-shell.html"
  );
  assert.ok(assetIdx > lastBookstoreIdx);
  assert.equal(arrayIdx, assetIdx + 1);
  assert.equal(ingestIdx, arrayIdx + 1);
  assert.ok(arrayIdx < ingestIdx);
  for (const sourcePath of ["/sitemap.xml", "/adabiyat", "/dictionary", "/grammar", "/books", "/book/:id(\\d+)", "/book/:id", "/book"])
    assert.ok(rewrites.some((rule) => rule.source === sourcePath), sourcePath);
  const event = opt.before_send({event: "$pageview", properties: {$current_url: "https://kutadgubilik.com/book/102?email=private", path: "/book/102?email=private", $referrer: "private", $set: {email: "private"}, token: "private", distinct_id: "anon", search_query: "private", session_id: "test-session"}});
  assert.equal(event.properties.$process_person_profile, false);
  assert.equal(event.properties.$ip, "0.0.0.0");
  assert.ok(!JSON.stringify(event).includes("private"));
  assert.ok(!JSON.stringify(event).includes("test-session"));
  assert.equal(event.properties.$current_url, "https://kutadgubilik.com/book/102");
  assert.equal(event.properties.path, "/book/102");
  assert.ok(!("search_query" in event.properties));
  assert.ok(!("session_id" in event.properties));
  assert.equal(event.properties.token, "phc_test");
  assert.equal(event.properties.distinct_id, "anon");
  const uuid = "01936c8e-7c3a-7c11-9f2a-7b1e4c8d9e0f";
  const kept = opt.before_send({event: "$pageview", distinct_id: uuid, properties: {distinct_id: uuid, $device_id: uuid}});
  assert.equal(kept.properties.distinct_id, uuid);
  assert.equal(kept.distinct_id, uuid);
  const fromEvent = opt.before_send({event: "book_view", distinct_id: uuid, properties: {book_id: "102", path: "/book/102"}});
  assert.equal(fromEvent.properties.distinct_id, uuid);
  const droppedEmail = opt.before_send({event: "$pageview", properties: {distinct_id: "user@example.com"}});
  assert.ok(!droppedEmail.properties.distinct_id);
  const sensitive = opt.before_send({event: "$pageview", properties: {
    distinct_id: uuid, $set: {email: "a@b.c", name: "Ali", phone: "+90536"}, $set_once: {address: "Istanbul"},
    $referrer: "https://evil.example/?q=1", session_id: "test-session", $current_url: "https://kutadgubilik.com/book/102?token=secret#frag"
  }});
  const sensitiveJson = JSON.stringify(sensitive);
  assert.equal(sensitive.properties.distinct_id, uuid);
  assert.ok(!sensitiveJson.includes("a@b.c"));
  assert.ok(!sensitiveJson.includes("Ali"));
  assert.ok(!sensitiveJson.includes("+90536"));
  assert.ok(!sensitiveJson.includes("Istanbul"));
  assert.ok(!sensitiveJson.includes("test-session"));
  assert.ok(!sensitiveJson.includes("token=secret"));
  assert.ok(!sensitiveJson.includes("#frag"));
  assert.ok(!("session_id" in sensitive.properties));
  assert.ok(!("$set" in sensitive.properties));
  assert.ok(!("$set_once" in sensitive.properties));
  assert.ok(!("$referrer" in sensitive.properties));
  assert.equal(sensitive.properties.$current_url, "https://kutadgubilik.com/book/102");
  assert.equal(opt.before_send({event: "$autocapture"}), null);
  assert.equal(opt.before_send({event: "$web_vitals"}), null);
  assert.equal(opt.before_send({event: "$pageleave"}), null);
  vm.runInContext(source, h.context);
  assert.equal(h.scripts.length, 1);
  const unavailable = setup();
  unavailable.scripts[0].onerror();
  unavailable.emit("add_to_cart", {bookId: "102"});
  assert.equal(unavailable.captures.length, 0);
  assert.equal(setup({enabled: false}).scripts.length, 0);
  assert.equal(setup({publicProjectKey: ""}).scripts.length, 0);
  assert.equal(setup({allowedHosts: []}).scripts.length, 0);
  // Exercise the actual existing remote tracker with a throwing PostHog SDK.
  h.window.posthog = null;
  h.instance.capture = () => {throw new Error("SDK unavailable");};
  vm.runInContext(fs.readFileSync("analytics.js", "utf8"), h.context);
  await h.window.KutadguAnalytics.track("add_to_cart", {bookId: "102", qty: 2});
  assert.equal(h.requests.length, 1);
  assert.equal(JSON.parse(h.requests[0].init.body).item_count, 2);
  vm.runInContext(fs.readFileSync("analytics.js", "utf8"), unavailable.context);
  await unavailable.window.KutadguAnalytics.track("whatsapp_order_click", {bookId: "102", items: 2, total: 80});
  assert.equal(unavailable.requests.length, 1);
  h.window.KUTADGU_APP_CONFIG = {featureFlags: {analyticsHooks: false}};
  assert.equal(opt.before_send({event: "$pageview"}), null);
  // Check every existing analytics entry point, including absolute book routes.
  let pages = 0;
  for (const file of fs.readdirSync('.').filter(f => f.endsWith('.html'))) {
    const html = fs.readFileSync(file, 'utf8');
    if (!/src="\/?analytics\.js/.test(html)) continue;
    pages++;
    const coreIdx = html.search(/kutadgu-analytics-core\.js/);
    const cfgIdx = html.search(/posthog-config\.js/);
    const phIdx = html.search(/posthog-analytics\.js/);
    const anIdx = html.search(/src="\/?analytics\.js/);
    assert.ok(coreIdx >= 0 && cfgIdx > coreIdx && phIdx > cfgIdx && anIdx > phIdx, file);
  }
  console.log(`PASS PostHog allowlist, privacy, queue, failure isolation, Supabase delivery, disabled config, ${pages} entry points`);
})().catch(error => {console.error(error); process.exitCode = 1;});
