const assert = require("assert");
const fs = require("fs");
const path = require("path");

global.KUTADGU_APP_CONFIG = { featureFlags: { multiVolumeBooks: false } };
global.KUTADGU_SUPABASE_CONFIG = {
  url: "https://example.supabase.co",
  anonKey: "public-key"
};

const Volume = require(path.join(__dirname, "..", "kutadgu-volume-groups.js"));
const Shared = require(path.join(__dirname, "..", "kutadgu-shared-cart.js"));
const SharedLinks = require(path.join(__dirname, "..", "kutadgu-shared-cart-links.js"));

function storage(initial) {
  const values = new Map(Object.entries(initial || {}));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function test(name, fn) {
  Promise.resolve().then(fn).then(
    () => console.log("ok - " + name),
    (error) => {
      console.error("not ok - " + name);
      console.error(error);
      process.exitCode = 1;
    }
  );
}

test("feature exposure defaults disabled", () => {
  assert.strictEqual(Volume.featureEnabled(), false);
  global.KUTADGU_APP_CONFIG.featureFlags.multiVolumeBooks = true;
  assert.strictEqual(Volume.featureEnabled(), true);
  global.KUTADGU_APP_CONFIG.featureFlags.multiVolumeBooks = false;
});

test("typed set lines normalize variable groups and preserve unsupported rows", () => {
  const raw = [
    { kind: "set", group_id: "8", qty: 1, quote_revision: "a" },
    { groupId: 8, quantity: 2, quoteRevision: "b" },
    { kind: "future", group_id: "9", qty: 1 },
    { kind: "set", group_id: "10", qty: 100 }
  ];
  const store = storage({ [Volume.SET_CART_KEY]: JSON.stringify(raw) });
  const parsed = Volume.splitSetCart(store);
  assert.deepStrictEqual(parsed.lines, [
    { kind: "set", group_id: "8", qty: 3, quote_revision: "b" }
  ]);
  assert.strictEqual(parsed.unsupported.length, 2);
  assert.strictEqual(Volume.addSet("9", 1, "r9", store), true);
  const persisted = JSON.parse(store.getItem(Volume.SET_CART_KEY));
  assert.deepStrictEqual(persisted.slice(0, 2), [
    { kind: "set", group_id: "8", qty: 3, quote_revision: "b" },
    { kind: "set", group_id: "9", qty: 1, quote_revision: "r9" }
  ]);
  assert.deepStrictEqual(persisted.slice(2), parsed.unsupported);
});

test("guest and cloud set carts merge without flattening intent", () => {
  const result = Volume.mergeSetLines(
    [{ kind: "set", group_id: "2", qty: 2, quote_revision: "old" }],
    [
      { kind: "set", group_id: "2", qty: 3, quote_revision: "new" },
      { kind: "set", group_id: "9", qty: 1 },
      { kind: "future", group_id: "7", qty: 1 }
    ]
  );
  assert.deepStrictEqual(result.lines, [
    { kind: "set", group_id: "2", qty: 5, quote_revision: "new" },
    { kind: "set", group_id: "9", qty: 1, quote_revision: "" }
  ]);
  assert.deepStrictEqual(result.increased, ["2"]);
  assert.deepStrictEqual(result.added, ["9"]);
  assert.strictEqual(result.unsupported.length, 1);
});

test("quote input keeps ordinary volumes and complete sets distinct", () => {
  const books = [{ id: "11", qty: 1 }, { id: 12, qty: 2 }];
  const sets = [{ kind: "set", group_id: "20", qty: 2, quote_revision: "stale-client-value" }];
  assert.deepStrictEqual(Volume.cartInput(books, sets), [
    { kind: "book", book_id: "11", qty: 1 },
    { kind: "book", book_id: "12", qty: 2 },
    { kind: "set", group_id: "20", qty: 2 }
  ]);
});

test("2, 3, 8, 9, and 10+ member public groups normalize", () => {
  for (const count of [2, 3, 8, 9, 10, 37, 100]) {
    const group = Volume.normalizeGroup({
      id: count,
      title: "Group " + count,
      members: Array.from({ length: count }, (_, index) => ({
        book_id: 1000 + index,
        position: index + 1,
        title: "Volume " + (index + 1),
        price: index + 1,
        stock: 5,
        is_active: true
      }))
    });
    assert.ok(group);
    assert.strictEqual(group.members.length, count);
    assert.strictEqual(Volume.groupSetPrice(group), count * (count + 1) / 2);
    assert.strictEqual(Volume.setAvailable(group, 5), true);
    assert.strictEqual(Volume.setAvailable(group, 6), false);
  }
  assert.strictEqual(Volume.normalizeGroup({ id: 1, members: [{ book_id: 1, position: 1 }] }), null);
  assert.strictEqual(Volume.normalizeGroup({
    id: 101,
    members: Array.from({ length: 101 }, (_, index) => ({ book_id: index + 1, position: index + 1 }))
  }), null);
  assert.strictEqual(Volume.normalizeGroup({
    id: 2,
    members: [{ book_id: 1, position: 1 }, { book_id: 1, position: 2 }]
  }), null);
  assert.strictEqual(Volume.normalizeGroup({
    id: 2,
    members: [{ book_id: 1, position: 1 }, { book_id: 2, position: 1 }]
  }), null);
});

test("explicit complete-set price overrides fallback sum", () => {
  const group = Volume.normalizeGroup({
    id: 1,
    complete_set_price: 49.5,
    members: [
      { book_id: 1, position: 1, price: 30, stock: 2 },
      { book_id: 2, position: 2, price: 40, stock: 2 }
    ]
  });
  assert.strictEqual(Volume.groupSetPrice(group), 49.5);
  group.members[1].stock_status = "out_of_stock";
  assert.strictEqual(Volume.setAvailable(group, 1), false);
});

test("five-minute quotes are cached only for the exact typed cart", async () => {
  const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls += 1;
    assert.ok(url.endsWith("/rest/v1/rpc/quote_book_volume_cart"));
    assert.deepStrictEqual(JSON.parse(options.body), {
      p_items: [{ kind: "set", group_id: "7", qty: 1 }]
    });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          schema_version: 1,
          fingerprint: "quoted",
          expires_at: expires,
          items: [],
          total: 90,
          total_qty: 9
        });
      }
    };
  };
  Volume.invalidateQuote();
  const line = [{ kind: "set", group_id: "7", qty: 1 }];
  const first = await Volume.requestQuote([], line, { fetchImpl });
  const second = await Volume.requestQuote([], line, { fetchImpl });
  assert.strictEqual(first, second);
  assert.strictEqual(calls, 1);
  assert.strictEqual(Volume.cachedQuoteFor([], line).fingerprint, "quoted");
  assert.strictEqual(Volume.cachedQuoteFor([], [{ kind: "set", group_id: "7", qty: 2 }]), null);
});

test("stale or expired WhatsApp quotes are invalidated with a visible retry message", () => {
  const shop = fs.readFileSync(path.join(__dirname, "..", "shop.js"), "utf8");
  assert.match(shop, /expired_quote/);
  assert.match(shop, /stale_quote/);
  assert.match(shop, /volumeGroups\(\)\?\.invalidateQuote\?\.\(\)/);
  assert.match(shop, /WhatsApp تېكىستىنى يېڭىلاپ قايتا يوللاڭ/);
});

test("shared cart v1 stays readable and ordinary shares stay v1", () => {
  const encoded = Shared.encodeSharedCart([{ id: "11", qty: 2 }, { id: "12", qty: 1 }]);
  assert.strictEqual(encoded.payload, "v1.11x2.12x1");
  assert.deepStrictEqual(Shared.decodeSharedCart(encoded.payload).items, [
    { id: "11", qty: 2 },
    { id: "12", qty: 1 }
  ]);
});

test("shared cart v2 preserves explicit complete-set intent", () => {
  const encoded = Shared.encodeSharedCart([
    { id: "11", qty: 2 },
    { kind: "set", group_id: "7", qty: 1 }
  ]);
  assert.strictEqual(encoded.payload, "v2.b11x2.s7x1");
  assert.deepStrictEqual(Shared.decodeSharedCart(encoded.payload).items, [
    { kind: "book", id: "11", qty: 2 },
    { kind: "set", group_id: "7", qty: 1 }
  ]);
  assert.strictEqual(Shared.encodeSharedCart([{ kind: "future", id: "1", qty: 1 }]).reason, "unsupported");
});

test("short-link API accepts exact typed lines and rejects forged prices", async () => {
  const normalized = SharedLinks.normalizeCreateItems({
    items: [
      { kind: "book", id: "11", qty: 2 },
      { kind: "set", group_id: "7", qty: 1 }
    ]
  });
  assert.deepStrictEqual(normalized, {
    ok: true,
    items: [
      { kind: "book", id: "11", qty: 2 },
      { kind: "set", group_id: "7", qty: 1 }
    ]
  });
  assert.deepStrictEqual(
    SharedLinks.normalizeCreateItems({ items: [{ kind: "set", group_id: "7", qty: 1, price: 1 }] }),
    { ok: false, error: "invalid" }
  );
  assert.deepStrictEqual(
    SharedLinks.normalizeStoredItems(normalized.items),
    normalized.items
  );
});

process.on("beforeExit", () => {
  if (!process.exitCode) console.log("multi-volume cart contracts: PASS");
});
