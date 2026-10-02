#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const links = require("../kutadgu-shared-cart-links.js");
const codec = require("../kutadgu-shared-cart.js");
const preview = require("../cloudflare/preview-dispatch.js");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const cartHtml = fs.readFileSync(path.join(root, "cart.html"), "utf8");
const css = fs.readFileSync(path.join(root, "shop.css"), "utf8");
const sql = fs.readFileSync(path.join(root, "STAGE105_SHARED_CART_LINKS.sql"), "utf8");

let failed = 0;
const pending = [];
function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      pending.push(result.then(
        () => console.log("PASS", name),
        (err) => {
          failed += 1;
          console.error("FAIL", name, err && err.stack || err);
        }
      ));
      return;
    }
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, err && err.stack || err);
  }
}
function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, startNeedle);
  return src.slice(start, end);
}
function lookup(table) {
  return (id) => {
    const row = table[String(id)];
    return row ? Object.assign({ id: String(id) }, row) : null;
  };
}

const secret = "shared-cart-test-secret";

test("8-character secure code format", () => {
  const original = Math.random;
  let randomCalls = 0;
  Math.random = () => {
    randomCalls += 1;
    return 0.1;
  };
  try {
    const seen = new Set();
    for (let index = 0; index < 12; index += 1) {
      const code = links.generateShortCode();
      assert.match(code, links.CODE_RE);
      assert.strictEqual(code.length, 8);
      assert.strictEqual(codec.parseShortCartPath("/c/" + code), code);
      seen.add(code);
    }
    assert.ok(seen.size > 1);
    assert.strictEqual(randomCalls, 0);
    assert.strictEqual(links.ALPHABET, codec.SHORT_ALPHABET);
    assert.doesNotMatch(links.ALPHABET, /[0OIl1]/);
  } finally {
    Math.random = original;
  }
});

test("POST input validation", () => {
  assert.strictEqual(links.normalizeCreateItems(null).ok, false);
  assert.strictEqual(links.normalizeCreateItems({ items: [] }).ok, false);
  assert.strictEqual(links.normalizeCreateItems({ items: [{ id: "abc", qty: 1 }] }).ok, false);
  assert.strictEqual(links.normalizeCreateItems({ items: [{ id: "12", qty: "1" }] }).ok, false);
  assert.strictEqual(links.normalizeCreateItems({ items: [{ id: "12", qty: 1.5 }] }).ok, false);
  assert.deepStrictEqual(links.normalizeCreateItems({ items: [{ id: "246", qty: 1 }, { id: 139, qty: 2 }] }).items, [
    { id: "246", qty: 1 },
    { id: "139", qty: 2 }
  ]);
});

test("max 80 items", () => {
  const eighty = [];
  for (let index = 1; index <= 80; index += 1) eighty.push({ id: String(index), qty: 1 });
  assert.strictEqual(links.normalizeCreateItems({ items: eighty }).items.length, 80);
  eighty.push({ id: "81", qty: 1 });
  assert.strictEqual(links.normalizeCreateItems({ items: eighty }).error, "too_many");
});

test("qty clamp and reject behavior", () => {
  assert.strictEqual(links.normalizeCreateItems({ items: [{ id: "8", qty: 0 }] }).ok, false);
  assert.strictEqual(links.normalizeCreateItems({ items: [{ id: "8", qty: 100 }] }).ok, false);
  assert.strictEqual(links.normalizeCreateItems({ items: [{ id: "8", qty: -1 }] }).ok, false);
  assert.deepStrictEqual(
    links.normalizeCreateItems({ items: [{ id: "8", qty: 60 }, { id: "8", qty: 50 }] }).items,
    [{ id: "8", qty: 99 }]
  );
});

test("PII is not persisted", async () => {
  let stored = null;
  const result = await links.handleSharedCartApi({
    method: "POST",
    pathname: "/api/shared-cart",
    body: JSON.stringify({
      name: "Ayshe",
      email: "a@b.c",
      phone: "05550000000",
      address: "Verify street",
      token: "tok-1",
      items: [{
        id: "246",
        qty: 1,
        title: "Secret title",
        price: 346,
        name: "Ayshe",
        email: "a@b.c",
        phone: "05550000000",
        address: "Verify street",
        token: "tok-1",
        image: "https://example.test/cover.webp"
      }]
    }),
    env: { SUPABASE_SECRET_KEY: secret },
    nowMs: Date.parse("2026-10-02T00:00:00.000Z"),
    generateCode: () => "Ab3K7xQ2",
    fetchImpl: async (url, init) => {
      stored = JSON.parse(init.body);
      assert.match(url, /\/rpc\/create_shared_cart_link$/);
      assert.strictEqual(init.headers.Authorization, "Bearer " + secret);
      return { status: 200, text: async () => "\"ok\"" };
    }
  });
  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(result.body, {
    ok: true,
    code: "Ab3K7xQ2",
    url: "https://www.kutadgubilik.com/c/Ab3K7xQ2"
  });
  assert.deepStrictEqual(Object.keys(stored).sort(), ["p_code", "p_expires_at", "p_items"]);
  assert.deepStrictEqual(stored.p_items, [{ id: "246", qty: 1 }]);
  const text = JSON.stringify(stored);
  assert.strictEqual(stored.p_expires_at, "2026-11-01T00:00:00.000Z");
  assert.ok(!text.includes("Ayshe"));
  assert.ok(!text.includes("a@b.c"));
  assert.ok(!text.includes("0555"));
  assert.ok(!text.includes("Verify"));
  assert.ok(!text.includes("tok-1"));
  assert.ok(!text.includes("346"));
  assert.ok(!text.includes("cover.webp"));
  assert.ok(!JSON.stringify(result.body).includes(secret));
});

test("GET valid code", async () => {
  const result = await links.handleSharedCartApi({
    method: "GET",
    pathname: "/api/shared-cart/Ab3K7xQ2",
    env: { SUPABASE_SECRET_KEY: secret },
    nowMs: Date.parse("2026-10-02T00:00:00.000Z"),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => [{
        items: [{ id: "246", qty: 1, price: 346, title: "Hidden" }],
        expires_at: "2026-11-01T00:00:00.000Z",
        created_at: "2026-10-02T00:00:00.000Z"
      }]
    })
  });
  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(result.body, { ok: true, items: [{ id: "246", qty: 1 }] });
  assert.ok(!JSON.stringify(result.body).includes(secret));
});

test("GET unknown code", async () => {
  const result = await links.handleSharedCartApi({
    method: "GET",
    pathname: "/api/shared-cart/Ab3K7xQ2",
    env: { SUPABASE_SECRET_KEY: secret },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] })
  });
  assert.strictEqual(result.status, 404);
  assert.deepStrictEqual(result.body, { ok: false, error: "not_found" });
  assert.strictEqual(preview.classifyPath("/api/shared-cart/not-a-code", "").kind, "asset");
});

test("expired code rejected", async () => {
  const result = await links.handleSharedCartApi({
    method: "GET",
    pathname: "/api/shared-cart/Ab3K7xQ2",
    env: { SUPABASE_SECRET_KEY: secret },
    nowMs: Date.parse("2026-12-01T00:00:00.000Z"),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => [{ items: [{ id: "246", qty: 1 }], expires_at: "2026-11-01T00:00:00.000Z" }]
    })
  });
  assert.strictEqual(result.status, 404);
  assert.deepStrictEqual(result.body, { ok: false, error: "expired" });
});

test("/c/code internally serves cart and the browser URL stays short", async () => {
  assert.strictEqual(preview.classifyPath("/c/Ab3K7xQ2", "").kind, "shared-cart-page");
  assert.strictEqual(preview.classifyPath("/c/Ab3K7xQ2", "").code, "Ab3K7xQ2");
  const response = await preview.dispatch(
    new Request("http://127.0.0.1:8787/c/Ab3K7xQ2"),
    {},
    {
      fetchImpl: async () => { throw new Error("short page must not call upstream"); },
      readAsset: async (filePath) => {
        assert.strictEqual(filePath, "/cart.html");
        return new Response("<!DOCTYPE html><html><head><title>cart</title></head><body><div id=\"cartItems\"></div></body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" }
        });
      }
    }
  );
  const body = await response.text();
  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.headers.get("location"), null);
  assert.match(body, /id="cartItems"/);
  assert.match(body, /<base href="\/">/);
  assert.ok(!body.includes("share=v1"));
  const apex = await preview.dispatch(
    new Request("https://kutadgubilik.com/c/Ab3K7xQ2"),
    { KUTADGU_HOST_MODE: "production" },
    {}
  );
  assert.strictEqual(apex.status, 308);
  assert.strictEqual(apex.headers.get("location"), "https://www.kutadgubilik.com/c/Ab3K7xQ2");
});

test("existing cart preserved, duplicate qty summed, stock clamped, unknown skipped", () => {
  const merged = codec.mergeSharedLines(
    [{ id: "207", qty: 1 }, { id: "236", qty: 1 }],
    [{ id: "236", qty: 99, price: 1 }, { id: "164", qty: 1 }, { id: "999999", qty: 1 }],
    lookup({
      236: { available: true, canBuy: true, stockQty: 15 },
      164: { available: true, canBuy: true, stockQty: 4 }
    })
  );
  assert.deepStrictEqual(merged.items, [
    { id: "207", qty: 1 },
    { id: "236", qty: 15 },
    { id: "164", qty: 1 }
  ]);
  assert.ok(merged.skipped >= 1);
  assert.ok(merged.clamped >= 1);
  assert.ok(!JSON.stringify(merged.items).includes("price"));
});

test("live price remains authoritative", () => {
  const page = sliceBetween(shop, "function cartPage(){", "function changeQty(");
  assert.match(page, /b\.price/);
  const importer = sliceBetween(shop, "async function importSharedCartFromQuery(){", "function scheduleSharedCartImport(){");
  assert.match(importer, /mergeSharedLines\(existing,incoming,lookup\)/);
  assert.doesNotMatch(importer, /price|title|email|phone/);
});

test("refresh does not repeatedly import the same short link", () => {
  const first = codec.rememberShortImport({}, "Ab3K7xQ2");
  assert.strictEqual(codec.shortImportSeen(first, "Ab3K7xQ2"), true);
  assert.strictEqual(codec.shortImportSeen({}, "Ab3K7xQ2"), false);
  assert.strictEqual(codec.shortImportSeen(first, "Zz9mN4pQ"), false);
  const importer = sliceBetween(shop, "async function importSharedCartFromQuery(){", "function scheduleSharedCartImport(){");
  assert.match(importer, /shortCartAlreadyImported\(shortCode\)/);
  assert.match(importer, /markShortCartImported\(shortCode\)/);
  assert.match(shop, /kutadgu-shared-cart-short-v1/);
  assert.match(importer, /stripShareQuery\(\)/);
  const shortBranch = importer.slice(importer.indexOf("if(shortCode){"), importer.indexOf("}else{"));
  assert.doesNotMatch(shortBranch, /stripShareQuery|replaceState|cart\.html/);
});

test("legacy share=v1 still works", () => {
  const decoded = codec.decodeSharedCart("v1.236x2.164x1");
  assert.strictEqual(decoded.ok, true);
  assert.deepStrictEqual(decoded.items, [{ id: "236", qty: 2 }, { id: "164", qty: 1 }]);
  const importer = sliceBetween(shop, "async function importSharedCartFromQuery(){", "function scheduleSharedCartImport(){");
  assert.match(importer, /decodeSharedCart\(raw\)/);
  assert.match(importer, /stripShareQuery\(\)/);
});

test("existing WhatsApp and order share stay unchanged", () => {
  const shareFn = sliceBetween(shop, "async function shareOrder(){", "function whatsappOrderUrl(text){");
  assert.match(shareFn, /getOrBuildOrder\(true\)/);
  assert.match(shareFn, /title:"قۇتادغۇبىلىك كىتابخانىسى — زاكاز",text:o\.text/);
  assert.doesNotMatch(shareFn, /\/api\/shared-cart|parseShortCartPath/);
  assert.match(shop, /function whatsappOrderUrl/);
  assert.match(cartHtml, /id="whatsappOrder"/);
  assert.match(cartHtml, /id="prepareOrder"/);
  assert.match(cartHtml, /id="copyOrder"/);
  assert.match(cartHtml, /id="shareOrder">📤 زاكازنى ھەمبەھىرلەش/);
  const button = sliceBetween(shop, "async function shareCartLink(){", "async function importSharedCartFromQuery(){");
  assert.match(button, /\/api\/shared-cart/);
  assert.match(button, /isCanonicalShortCartUrl\(url\)/);
  assert.doesNotMatch(button, /sharedCartUrl\(|supabase\.co|SUPABASE_SECRET/);
});

test("no public Supabase access", () => {
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.shared_cart_links FROM PUBLIC/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.shared_cart_links FROM anon/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.shared_cart_links FROM authenticated/);
  assert.match(sql, /GRANT SELECT, INSERT, DELETE ON TABLE public\.shared_cart_links TO service_role/);
  assert.doesNotMatch(sql, /create policy/i);
  assert.doesNotMatch(sql, /GRANT [^;]+ TO anon/i);
  assert.doesNotMatch(sql, /GRANT [^;]+ TO authenticated/i);
  const table = sliceBetween(sql, "CREATE TABLE IF NOT EXISTS public.shared_cart_links", ");");
  assert.match(table, /code text PRIMARY KEY/);
  assert.match(table, /items jsonb NOT NULL/);
  assert.doesNotMatch(table, /email|phone|address|password|name|title|price/i);
  const server = fs.readFileSync(path.join(root, "kutadgu-shared-cart-links.js"), "utf8");
  assert.match(server, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(server, /eval\s*\(|new\s+Function\s*\(|javascript\s*:/);
});

test("server errors stay generic and hide the secret", async () => {
  const result = await links.handleSharedCartApi({
    method: "POST",
    pathname: "/api/shared-cart",
    body: JSON.stringify({ items: [{ id: "246", qty: 1 }] }),
    env: { SUPABASE_SECRET_KEY: secret },
    generateCode: () => "Ab3K7xQ2",
    fetchImpl: async () => {
      throw new Error("upstream failed " + secret);
    }
  });
  assert.strictEqual(result.status, 503);
  assert.deepStrictEqual(result.body, { ok: false, error: "unavailable" });
  assert.ok(!JSON.stringify(result.body).includes(secret));
});

function rpcOk() {
  return { status: 200, text: async () => "\"ok\"" };
}

test("POST /api/shared-cart through preview.dispatch reaches the handler", async () => {
  assert.strictEqual(preview.methodAllowed("shared-cart-create", "POST"), true);
  assert.strictEqual(preview.methodAllowed("shared-cart-create", "GET"), false);
  assert.strictEqual(preview.methodAllowed("shared-cart-read", "GET"), true);
  assert.strictEqual(preview.methodAllowed("shared-cart-read", "HEAD"), true);
  assert.strictEqual(preview.methodAllowed("shared-cart-read", "POST"), false);
  assert.strictEqual(preview.methodAllowed("shared-cart-page", "GET"), true);
  assert.strictEqual(preview.methodAllowed("shared-cart-page", "POST"), false);
  const seen = [];
  const response = await preview.dispatch(
    new Request("http://127.0.0.1:8787/api/shared-cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: "246", qty: 1 }] })
    }),
    { SUPABASE_SECRET_KEY: secret },
    {
      fetchImpl: async (url, init) => {
        seen.push(String(url));
        assert.match(String(init.body), /"p_items"/);
        return rpcOk();
      }
    }
  );
  const body = await response.json();
  assert.strictEqual(response.status, 200);
  assert.strictEqual(body.ok, true);
  assert.match(body.url, /^https:\/\/www\.kutadgubilik\.com\/c\/[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{8}$/);
  assert.match(seen[0], /\/rpc\/create_shared_cart_link$/);
});

test("GET create endpoint and POST read endpoint are 405", async () => {
  const getCreate = await preview.dispatch(new Request("http://127.0.0.1:8787/api/shared-cart"), {}, {
    fetchImpl: async () => { throw new Error("create GET must not call upstream"); }
  });
  assert.strictEqual(getCreate.status, 405);
  const postRead = await preview.dispatch(
    new Request("http://127.0.0.1:8787/api/shared-cart/Ab3K7xQ2", { method: "POST", body: "{}" }),
    { SUPABASE_SECRET_KEY: secret },
    { fetchImpl: async () => { throw new Error("read POST must not call upstream"); } }
  );
  assert.strictEqual(postRead.status, 405);
});

test("item check calls a function and does not embed a subquery", () => {
  const check = sliceBetween(sql, "shared_cart_links_items_shape", "ENABLE ROW LEVEL SECURITY");
  assert.match(check, /CHECK \(public\.shared_cart_items_valid\(items\)\)/);
  assert.doesNotMatch(check, /select|jsonb_array_elements/i);
  const validator = sliceBetween(sql, "FUNCTION public.shared_cart_items_valid", "$shared_cart_items$;");
  assert.match(validator, /IMMUTABLE/);
  assert.match(validator, /jsonb_typeof\(value\) = 'array'/);
  assert.match(validator, /BETWEEN 1 AND 80/);
  assert.match(validator, /elem\.value - 'id' - 'qty'/);
  assert.match(validator, /\^\[0-9\]\{1,18\}\$/);
  assert.match(validator, /numeric <> trunc/);
  assert.match(validator, /numeric < 1/);
  assert.match(validator, /numeric > 99/);
  assert.doesNotMatch(validator, /security definer/i);
});

test("validator accepts valid items and rejects bad shape", () => {
  assert.strictEqual(links.sharedCartItemsValid([{ id: "246", qty: 1 }]), true);
  assert.strictEqual(links.sharedCartItemsValid([{ id: "246", qty: 1, title: "Hidden" }]), false);
  assert.strictEqual(links.sharedCartItemsValid([{ id: "12a", qty: 1 }]), false);
  assert.strictEqual(links.sharedCartItemsValid([{ id: "8", qty: 0 }]), false);
  assert.strictEqual(links.sharedCartItemsValid([{ id: "8", qty: 100 }]), false);
  assert.strictEqual(links.sharedCartItemsValid([{ id: "8", qty: 1.5 }]), false);
});

test("rate limit allows a count below the threshold and rejects the overflow", async () => {
  assert.strictEqual(links.CREATE_LIMIT, 300);
  assert.strictEqual(links.CREATE_WINDOW_MINUTES, 10);
  assert.strictEqual(links.CREATE_DAY_LIMIT, 1000);
  assert.strictEqual(links.CREATE_WINDOW_HOURS, 24);
  const creator = sliceBetween(sql, "FUNCTION public.create_shared_cart_link", "$shared_cart_create$;");
  assert.match(creator, /pg_advisory_xact_lock\(841050105\)/);
  assert.match(creator, /interval '10 minutes'/);
  assert.match(creator, /recent_count >= 300/);
  assert.match(creator, /created_at > now\(\) - interval '24 hours'/);
  assert.match(creator, /day_count >= 1000/);
  assert.ok(creator.indexOf("DELETE FROM public.shared_cart_links") > creator.lastIndexOf("RETURN 'rate_limited'"));
  assert.match(creator, /DELETE FROM public\.shared_cart_links\s+WHERE expires_at <= now\(\)/);
  const allowed = await links.handleSharedCartApi({
    method: "POST",
    pathname: "/api/shared-cart",
    body: JSON.stringify({ items: [{ id: "246", qty: 1 }] }),
    env: { SUPABASE_SECRET_KEY: secret },
    generateCode: () => "Ab3K7xQ2",
    fetchImpl: async () => rpcOk()
  });
  assert.strictEqual(allowed.status, 200);
  const limited = await links.handleSharedCartApi({
    method: "POST",
    pathname: "/api/shared-cart",
    body: JSON.stringify({ items: [{ id: "246", qty: 1 }] }),
    env: { SUPABASE_SECRET_KEY: secret },
    generateCode: () => "Ab3K7xQ2",
    fetchImpl: async () => ({ status: 200, text: async () => "\"rate_limited\"" })
  });
  assert.strictEqual(limited.status, 429);
  assert.deepStrictEqual(limited.body, { ok: false, error: "rate_limited" });
  assert.ok(!JSON.stringify(limited.body).includes(secret));
  const button = sliceBetween(shop, "async function shareCartLink(){", "async function importSharedCartFromQuery(){");
  assert.match(button, /error==="rate_limited"/);
  assert.match(button, /سەل تۇرۇپ قايتا سىناڭ/);
});

test("creation RPC is service_role only", () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.create_shared_cart_link\(text, jsonb, timestamptz\) FROM PUBLIC/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.create_shared_cart_link\(text, jsonb, timestamptz\) FROM anon/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.create_shared_cart_link\(text, jsonb, timestamptz\) FROM authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.create_shared_cart_link\(text, jsonb, timestamptz\) TO service_role/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.shared_cart_items_valid\(jsonb\) FROM PUBLIC/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.shared_cart_items_valid\(jsonb\) TO service_role/);
  assert.doesNotMatch(sql, /security definer/i);
  const creator = sliceBetween(sql, "FUNCTION public.create_shared_cart_link", "$shared_cart_create$;");
  assert.doesNotMatch(creator, /inet|ip_address|user_id|auth\.uid/i);
});

test("created_at and expires_at indexes support both creation caps", () => {
  assert.match(sql, /CREATE INDEX IF NOT EXISTS shared_cart_links_created_at_idx\s+ON public\.shared_cart_links \(created_at\)/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS shared_cart_links_expires_at_idx\s+ON public\.shared_cart_links \(expires_at\)/);
  const creator = sliceBetween(sql, "FUNCTION public.create_shared_cart_link", "$shared_cart_create$;");
  assert.match(creator, /WHERE created_at > now\(\) - interval '10 minutes'/);
  assert.match(creator, /WHERE created_at > now\(\) - interval '24 hours'/);
  assert.doesNotMatch(creator, /inet|ip_address|user_id|auth\.uid|fingerprint|cookie/i);
  const table = sliceBetween(sql, "CREATE TABLE IF NOT EXISTS public.shared_cart_links", "CREATE OR REPLACE FUNCTION public.shared_cart_items_valid");
  assert.doesNotMatch(table, /inet|ip_address|user_id|fingerprint|cookie/i);
});

test("Content-Length above 8192 is rejected before the body is read", async () => {
  let read = false;
  const response = await preview.dispatch({
    url: "http://127.0.0.1:8787/api/shared-cart",
    method: "POST",
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-length" ? "8193" : null;
      }
    },
    body: {
      getReader() {
        read = true;
        throw new Error("body was read");
      },
      cancel() {
        return Promise.resolve();
      }
    },
    text() {
      read = true;
      return Promise.reject(new Error("text was read"));
    }
  }, { SUPABASE_SECRET_KEY: secret }, {
    fetchImpl: async () => { throw new Error("upstream must not run"); }
  });
  assert.strictEqual(read, false);
  assert.strictEqual(response.status, 413);
  const payload = await response.json();
  assert.deepStrictEqual(payload, { ok: false, error: "invalid" });
  assert.ok(!JSON.stringify(payload).includes(secret));
  assert.ok(!JSON.stringify(payload).includes("8193"));
});

test("a streamed body is cancelled once it crosses 8192 bytes", async () => {
  let pulls = 0;
  let cancelled = false;
  const chunk = new Uint8Array(3000);
  chunk.fill(65);
  const response = await preview.dispatch({
    url: "http://127.0.0.1:8787/api/shared-cart",
    method: "POST",
    headers: { get() { return null; } },
    body: new ReadableStream({
      pull(controller) {
        pulls += 1;
        if (pulls > 20) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      }
    })
  }, { SUPABASE_SECRET_KEY: secret }, {
    fetchImpl: async () => { throw new Error("upstream must not run"); }
  });
  assert.strictEqual(cancelled, true);
  assert.ok(pulls <= 3);
  assert.strictEqual(response.status, 413);
  const payload = await response.json();
  assert.deepStrictEqual(payload, { ok: false, error: "invalid" });
  assert.ok(!JSON.stringify(payload).includes("AAAA"));
  assert.ok(!JSON.stringify(payload).includes(secret));
});

test("dark light and mobile cart layout stay unchanged", () => {
  assert.match(cartHtml, /shop\.css\?v=55/);
  assert.match(cartHtml, /shop\.js\?v=141/);
  assert.match(cartHtml, /kutadgu-shared-cart\.js\?v=3/);
  assert.doesNotMatch(cartHtml, /<style/);
  const page = sliceBetween(shop, "function cartPage(){", "function changeQty(");
  assert.match(page, /class="checkout-secondary" id="shareCart"/);
  assert.match(page, /📤 سېۋەتنى ھەمبەھىرلەش/);
  const dark = sliceBetween(css, "body.dark-mode .cart-unit-price,", "body.dark-mode .checkout-form input::placeholder");
  assert.match(dark, /color:var\(--site-text\)/);
  assert.match(css, /\.whatsapp-order\{[^}]*background:#168b4b/);
  assert.match(css, /\.remove-cart\{[^}]*color:#a94a3b/);
});

Promise.all(pending).then(() => {
  if (failed) {
    console.error("\n" + failed + " shared-cart short-link test(s) failed");
    process.exit(1);
  }
  console.log("shared-cart-short-links-v2-tests ok");
});
