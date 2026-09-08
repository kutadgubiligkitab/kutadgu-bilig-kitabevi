#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, err.message);
  }
}
function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
  return src.slice(start, end);
}

const enhance = sliceBetween(shop, "function searchEnhance(){", "function dynamicListingCard");
const boot = sliceBetween(shop, "async function boot(){", "window.kutadguShop=");

test("cold-load q-param copies into #searchInput and does not run against static catalog first", () => {
  assert.match(enhance, /const qParam=new URLSearchParams\(location\.search\)\.get\("q"\)/);
  assert.match(enhance, /if\(qParam\)input\.value=qParam/);
  assert.doesNotMatch(enhance, /if\(qParam\)\{input\.value=qParam;run\(false\)\}/);
  assert.doesNotMatch(enhance, /if\(qParam\)input\.value=qParam;run\(false\)/);
});

test("queued q-param search waits for kutadgu:catalog-ready once then reuses run(false)", () => {
  assert.match(enhance, /kutadgu:catalog-ready/);
  assert.match(enhance, /addEventListener\("kutadgu:catalog-ready",runQueuedSearch,\{once:true\}\)/);
  assert.match(enhance, /const runQueuedSearch=\(\)=>\{if\(hasFilter\(\)\)run\(false\)\}/);
  assert.match(enhance, /if\(catalogBootSettled\|\|remoteCatalog\.available\)runQueuedSearch\(\)/);
  assert.match(boot, /document\.dispatchEvent\(new CustomEvent\("kutadgu:catalog-ready"/);
});

test("manual Enter/click search path is unchanged", () => {
  assert.match(enhance, /if\(btn\)btn\.onclick=\(\)=>run\(false\)/);
  assert.match(enhance, /inputTimer=setTimeout\(\(\)=>run\(false\),400\)/);
  assert.match(enhance, /if\(event\.key==="Enter"\)\{event\.preventDefault\(\);clearTimeout\(inputTimer\);run\(false\)\}/);
  assert.match(enhance, /await queryCatalog\(state,/);
  assert.match(enhance, /function hasFilter\(\)\{return !!\(input\.value\.trim\(\)/);
});

test("cold-load harness does not query until catalog-ready, then runs once with remote results", () => {
  const tailStart = enhance.lastIndexOf("res.innerHTML=fallbackNotice();");
  assert.ok(tailStart >= 0, "q-param tail");
  const tail = enhance.slice(tailStart, enhance.lastIndexOf("}"));
  function harness(search, catalogReady) {
    const calls = [];
    const listeners = [];
    const input = { value: "" };
    const res = { innerHTML: "" };
    const remoteItems = [{ id: "101", title: "ئىسكەندەرنامە" }];
    const run = (append) => {
      calls.push({ append, q: input.value, when: catalogReady.available ? "ready" : "static" });
      res.innerHTML = `<div class="advanced-search-summary"><strong>${remoteItems.length}</strong> دانە كىتاب تېپىلدى</div>`;
    };
    const hasFilter = () => !!input.value.trim();
    const documentRef = {
      addEventListener(type, fn, opts) {
        const wrapped = () => {
          if (opts && opts.once && wrapped.done) return;
          if (opts && opts.once) wrapped.done = true;
          fn();
        };
        listeners.push({ type, fn: wrapped, opts });
      }
    };
    const fn = new Function(
      "input", "res", "hasFilter", "run", "document", "location", "URLSearchParams",
      "catalogBootSettled", "remoteCatalog", "fallbackNotice",
      tail
    );
    fn(
      input, res, hasFilter, run, documentRef,
      { search }, URLSearchParams,
      false, catalogReady, () => ""
    );
    return { calls, listeners, input, res };
  }

  const remote = { available: false };
  const cold = harness("?q="+encodeURIComponent("ئىسكەندەرنامە"), remote);
  assert.strictEqual(cold.input.value, "ئىسكەندەرنامە");
  assert.deepStrictEqual(cold.calls, []);
  assert.doesNotMatch(cold.res.innerHTML, /نەتىجە تېپىلمىدى/);
  assert.strictEqual(cold.listeners.length, 1);
  assert.strictEqual(cold.listeners[0].type, "kutadgu:catalog-ready");
  assert.deepStrictEqual(cold.listeners[0].opts, { once: true });

  remote.available = true;
  cold.listeners[0].fn();
  assert.strictEqual(cold.calls.length, 1);
  assert.deepStrictEqual(cold.calls[0], { append: false, q: "ئىسكەندەرنامە", when: "ready" });
  assert.match(cold.res.innerHTML, /1<\/strong> دانە كىتاب تېپىلدى/);

  cold.listeners[0].fn();
  assert.strictEqual(cold.calls.length, 1, "catalog-ready listener is once");

  const idle = harness("", { available: false });
  assert.strictEqual(idle.input.value, "");
  assert.deepStrictEqual(idle.calls, []);
  assert.strictEqual(idle.listeners.length, 0);

  const alreadyReady = harness("?q=fixture-title", { available: true });
  assert.strictEqual(alreadyReady.input.value, "fixture-title");
  assert.strictEqual(alreadyReady.listeners.length, 0);
  assert.strictEqual(alreadyReady.calls.length, 1);
  assert.strictEqual(alreadyReady.calls[0].append, false);
});

test("manual run(false) after boot remains a direct click/Enter call, not catalog-ready", () => {
  assert.match(enhance, /if\(btn\)btn\.onclick=\(\)=>run\(false\)/);
  const clickAt = enhance.indexOf("if(btn)btn.onclick=()=>run(false)");
  const readyAt = enhance.indexOf("kutadgu:catalog-ready");
  assert.ok(clickAt >= 0 && readyAt > clickAt, "manual click wiring is independent of catalog-ready queue");
});

if (failed) {
  console.error("\n" + failed + " m1 cold-load search test(s) failed");
  process.exit(1);
}
console.log("m1-cross-page-search-cold-load-tests ok");
