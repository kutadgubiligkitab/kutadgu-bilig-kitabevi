#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const appConfigSrc = fs.readFileSync(path.join(root, "app-config.js"), "utf8");
const premium = fs.readFileSync(path.join(root, "premium-ux.js"), "utf8");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const wrapCss = fs.readFileSync(path.join(root, "premium-discovery-groups-wrap.css"), "utf8");

let failed = 0;
const pending = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      pending.push(result.then(() => console.log("PASS", name)).catch((err) => {
        failed++;
        console.error("FAIL", name, err && err.stack || err.message);
      }));
      return;
    }
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, err && err.stack || err.message);
  }
}

function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
  return src.slice(start, end);
}

function loadAppConfig() {
  const sandbox = { window: {} };
  vm.runInNewContext(appConfigSrc, sandbox);
  return JSON.parse(JSON.stringify(sandbox.window.KUTADGU_APP_CONFIG));
}

function loadDiscoveryApi(shopApi) {
  const src = sliceBetween(premium, "const DISCOVERY_PAGE_SIZE=8;", "function renderDiscovery(){");
  return new Function("window", `
    "use strict";
    ${src}
    return {
      DISCOVERY_PAGE_SIZE,
      queryCategoryAuthoritative,
      queryDiscoveryCategories,
      matchesSelectedCategory
    };
  `)({ kutadguShop: shopApi });
}

function book(id, category, extra) {
  return Object.assign({
    id,
    title: extra && extra.title || ("كىتاب " + id),
    category,
    subcategory: "",
    price: 120,
    isActive: true,
    isRemote: true
  }, extra || {});
}

const CHILDREN = "بالىلار كىتابلىرى";
const PARENTING = "پەرزەنت تەربىيەسى";
const TEXTBOOKS = "دەرسلىك";
const PARENTING_TITLE = "ئائىلە ۋە پەرزەنتلىرىمىز";

test("1 بالىلار contains only بالىلار كىتابلىرى", () => {
  const cfg = loadAppConfig();
  const children = cfg.discoveryGroups.find((g) => g.id === "children");
  assert.strictEqual(children.label, "بالىلار");
  assert.deepStrictEqual(children.categories, [CHILDREN]);
  assert.ok(!children.categories.includes(PARENTING));
  assert.ok(!children.categories.includes(TEXTBOOKS));
});

test("2 پەرزەنت تەربىيەسى is its own top-level group", () => {
  const cfg = loadAppConfig();
  const parenting = cfg.discoveryGroups.find((g) => g.id === "parenting");
  assert.ok(parenting);
  assert.strictEqual(parenting.label, PARENTING);
  assert.deepStrictEqual(parenting.categories, [PARENTING]);
});

test("3 دەرسلىك is its own top-level group", () => {
  const cfg = loadAppConfig();
  const textbooks = cfg.discoveryGroups.find((g) => g.id === "textbooks");
  assert.ok(textbooks);
  assert.strictEqual(textbooks.label, TEXTBOOKS);
  assert.deepStrictEqual(textbooks.categories, [TEXTBOOKS]);
});

test("7 existing Literature History and Religion groups are unchanged", () => {
  const cfg = loadAppConfig();
  const byId = Object.fromEntries(cfg.discoveryGroups.map((g) => [g.id, g]));
  assert.deepStrictEqual(byId.literature, {
    id: "literature",
    label: "ئەدەبىيات",
    icon: "📖",
    categories: ["رومانلار", "تارىخىي رومانلار", "شېئىرلار", "ھېكايىلەر", "داستانلار", "دۇنيا ئەدەبىياتى", "ئەدەبىيات رومانلىرى", "ئۇيغۇر ئەدەبىياتى"]
  });
  assert.deepStrictEqual(byId.history, {
    id: "history",
    label: "تارىخ",
    icon: "🏛️",
    categories: ["تارىخىي رومانلار", "ئۇيغۇر ئەدەبىياتى"]
  });
  assert.deepStrictEqual(byId.religion, {
    id: "religion",
    label: "دىنىي",
    icon: "🕌",
    categories: ["دىنىي كىتابلار"]
  });
});

test("catalog source mappings stay children/terbiye/derslik", () => {
  const cfg = loadAppConfig();
  const bySource = Object.fromEntries(cfg.catalogCategories.map((row) => [row.source, row.label]));
  assert.strictEqual(bySource["children.html"], CHILDREN);
  assert.strictEqual(bySource["terbiye.html"], PARENTING);
  assert.strictEqual(bySource["derslik.html"], TEXTBOOKS);
});

test("4 parenting-category book cannot appear in the Children group", async () => {
  const cfg = loadAppConfig();
  const children = cfg.discoveryGroups.find((g) => g.id === "children");
  const catalog = [
    book("c1", CHILDREN, { title: "بالىلار كىتابى" }),
    book("p1", PARENTING, { title: PARENTING_TITLE }),
    book("t1", TEXTBOOKS, { title: "دەرسلىك كىتابى" })
  ];
  const calls = [];
  const api = loadDiscoveryApi({
    canonicalId: (id) => String(id),
    isStorefrontVisible: () => true,
    async queryCatalog(input) {
      calls.push(input);
      return { items: catalog.filter((row) => row.category === input.category), source: "supabase" };
    }
  });
  const items = await api.queryDiscoveryCategories(children.categories, 8, null, 8);
  assert.deepStrictEqual(calls.map((row) => row.category), [CHILDREN]);
  assert.deepStrictEqual(items.map((row) => row.title), ["بالىلار كىتابى"]);
  assert.ok(!items.some((row) => row.category === PARENTING || row.title === PARENTING_TITLE));
  assert.ok(!items.some((row) => row.category === TEXTBOOKS));
});

test("5 a children-category book cannot appear in Parenting", async () => {
  const cfg = loadAppConfig();
  const parenting = cfg.discoveryGroups.find((g) => g.id === "parenting");
  const catalog = [
    book("c1", CHILDREN, { title: "بالىلار كىتابى" }),
    book("p1", PARENTING, { title: PARENTING_TITLE })
  ];
  const api = loadDiscoveryApi({
    canonicalId: (id) => String(id),
    isStorefrontVisible: () => true,
    async queryCatalog(input) {
      return { items: catalog.filter((row) => row.category === input.category), source: "supabase" };
    }
  });
  const items = await api.queryDiscoveryCategories(parenting.categories, 8, null, 8);
  assert.deepStrictEqual(items.map((row) => row.title), [PARENTING_TITLE]);
  assert.ok(!items.some((row) => row.category === CHILDREN));
});

test("6 a textbook-category book cannot appear in Children", async () => {
  const cfg = loadAppConfig();
  const children = cfg.discoveryGroups.find((g) => g.id === "children");
  const textbooks = cfg.discoveryGroups.find((g) => g.id === "textbooks");
  const catalog = [
    book("c1", CHILDREN),
    book("t1", TEXTBOOKS, { title: "دەرسلىك كىتابى" })
  ];
  const api = loadDiscoveryApi({
    canonicalId: (id) => String(id),
    isStorefrontVisible: () => true,
    async queryCatalog(input) {
      return { items: catalog.filter((row) => row.category === input.category), source: "supabase" };
    }
  });
  const childItems = await api.queryDiscoveryCategories(children.categories, 8, null, 8);
  const textbookItems = await api.queryDiscoveryCategories(textbooks.categories, 8, null, 8);
  assert.ok(!childItems.some((row) => row.category === TEXTBOOKS));
  assert.deepStrictEqual(textbookItems.map((row) => row.category), [TEXTBOOKS]);
});

test("8 Discovery uses authoritative exact category queries", async () => {
  const calls = [];
  const api = loadDiscoveryApi({
    canonicalId: (id) => String(id),
    isStorefrontVisible: () => true,
    async queryCatalog(input) {
      calls.push(input);
      return { items: [book("1", input.category)], source: "supabase" };
    }
  });
  await api.queryDiscoveryCategories([CHILDREN, PARENTING, TEXTBOOKS], 8, null, 8);
  assert.deepStrictEqual(calls.map((row) => row.category), [CHILDREN, PARENTING, TEXTBOOKS]);
  for (const input of calls) {
    assert.strictEqual(input.offset, 0);
    assert.ok(!("ilike" in input));
    assert.ok(!("search" in input) || !input.search);
    assert.strictEqual(input.category, String(input.category).trim());
  }
  const showGroup = sliceBetween(premium, "async function showGroup(", "section.querySelectorAll(\"[data-premium-group]\").forEach(button=>button.onclick");
  assert.match(showGroup, /queryDiscoveryCategories/);
  assert.match(shop, /params\.set\("category",`eq\.\$\{state\.category\}`\)/);
});

test("9 Smart Wizard consumes the same discoveryGroups without merging categories", () => {
  const render = sliceBetween(premium, "function renderDiscovery(){", "function wizardMarkup(groups){");
  assert.match(render, /wizardMarkup\(groups\)/);
  assert.match(render, /setupWizard\(section,groups\)/);
  const markup = sliceBetween(premium, "function wizardMarkup(groups){", "function setupWizard(section,groups){");
  assert.match(markup, /groups\.map\(group=>/);
  assert.match(markup, /data-wizard-group/);
  const wizard = sliceBetween(premium, "function setupWizard(section,groups){", "function setupSearchSuggestions(){");
  assert.match(wizard, /queryDiscoveryCategories\(group\?\.categories\|\|\[\]/);
  assert.doesNotMatch(wizard, /بالىلار كىتابلىرى","پەرزەنت تەربىيەسى","دەرسلىك/);
  assert.doesNotMatch(premium, /id:"children"[\s\S]{0,200}پەرزەنت تەربىيەسى/);
});

test("10-12 wrap CSS keeps group buttons wrapping without overflow", () => {
  assert.match(indexHtml, /premium-discovery-groups-wrap\.css\?v=1/);
  assert.match(indexHtml, /data-kutadgu-premium-discovery-groups-wrap="1"/);
  assert.match(wrapCss, /#premiumDiscovery \.premium-discovery-groups/);
  assert.match(wrapCss, /overflow-x:\s*hidden/);
  assert.match(wrapCss, /white-space:\s*normal/);
  assert.match(wrapCss, /overflow-wrap:\s*anywhere/);
  assert.match(wrapCss, /min-width:\s*0/);
  const groupsCss = fs.readFileSync(path.join(root, "premium-ux.css"), "utf8");
  assert.match(groupsCss, /\.premium-discovery-groups\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(groupsCss, /@media\(max-width:900px\)\{[\s\S]*?\.premium-discovery-groups\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(groupsCss, /@media\(max-width:430px\)\{[\s\S]*?\.premium-discovery-groups\{grid-template-columns:1fr 1fr/);
});

test("13 search category pages cart wishlist and WhatsApp files stay out of this hotfix besides cache pins", () => {
  const out = execSync("git diff --name-only origin/main HEAD; git diff --name-only; git diff --cached --name-only", {
    cwd: root,
    encoding: "utf8"
  });
  const files = [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))];
  const unexpected = files.filter((file) =>
    /cart\.js|favorites\.js|member\.js|kutadgu-search-rank\.js|whatsapp/i.test(file)
  );
  assert.deepStrictEqual(unexpected, [], unexpected.join(", "));
});

test("14 no SQL RLS auth or database-record changes", () => {
  const out = execSync("git diff --name-only origin/main HEAD; git diff --name-only; git diff --cached --name-only", {
    cwd: root,
    encoding: "utf8"
  });
  const files = [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))];
  const forbidden = files.filter((file) =>
    (/\.sql$/i.test(file) && file !== "STAGE_AI_SEARCH_1C_VECTOR_FOUNDATION.sql" && file !== "STAGE_AI_SEARCH_1G2_CATEGORY_LOOKUP.sql" && file !== "STAGE87_COVER_INTEGRITY.sql" && file !== "STAGE99_BOOK_ENGAGEMENT_VIEW_COUNTS.sql") ||
    /(^|\/)supabase\//i.test(file) ||
    /\brls\b/i.test(file) ||
    /catalog\.js$/.test(file)
  );
  assert.deepStrictEqual(forbidden, [], forbidden.join(", "));
  assert.match(shop, /app-config\.js\?v=5/);
  assert.doesNotMatch(shop, /UPDATE\s+books|alter\s+table/i);
});

Promise.resolve().then(() => Promise.all(pending)).then(() => {
  if (failed) {
    console.error("\n" + failed + " test(s) failed");
    process.exit(1);
  }
  console.log("\nAll discovery category split hotfix unit tests passed");
});
