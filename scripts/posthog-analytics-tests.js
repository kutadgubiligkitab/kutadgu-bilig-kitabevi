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
  assert.ok(!JSON.stringify(h.captures).includes("private"));
  h.emit("page_view"); h.emit("unknown"); h.emit("toString");
  h.emit("search", {query: "a@example.com"});
  h.emit("search", {query: "+90 536 899 98 88"});
  assert.equal(h.captures.length, 1);
  for (const name of Object.keys(core.ALLOWED_EVENTS).filter(n => n !== "page_view"))
    h.emit(name, {bookId: "102", query: "history", results: 0});
  assert.equal(h.captures.length, 10);
  const opt = h.options();
  assert.equal(opt.api_host, "https://eu.i.posthog.com");
  assert.equal(opt.capture_pageview, true);
  assert.equal(opt.disable_session_recording, true);
  const event = opt.before_send({event: "$pageview", properties: {$current_url: "private", $referrer: "private", $set: {email: "private"}, token: "private", distinct_id: "anon"}});
  assert.ok(!JSON.stringify(event).includes("private"));
  assert.equal(event.properties.$current_url, "https://kutadgubilik.com/book/102");
  assert.equal(event.properties.token, "phc_test");
  assert.equal(opt.before_send({event: "$autocapture"}), null);
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
    assert.ok(html.indexOf('/posthog-config.js') < html.indexOf('/posthog-analytics.js'), file);
    assert.ok(html.indexOf('/posthog-analytics.js') < html.search(/src="\/?analytics\.js/), file);
  }
  console.log(`PASS PostHog allowlist, privacy, queue, failure isolation, Supabase delivery, disabled config, ${pages} entry points`);
})().catch(error => {console.error(error); process.exitCode = 1;});
