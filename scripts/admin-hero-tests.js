#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const Hero = require(path.join(root, "admin-hero.js"));
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const adminJs = fs.readFileSync(path.join(root, "admin.js"), "utf8");
const adminCss = fs.readFileSync(path.join(root, "admin.css"), "utf8");
const heroJs = fs.readFileSync(path.join(root, "admin-hero.js"), "utf8");
const sql = fs.readFileSync(path.join(root, "SITE_HERO_MANAGEMENT.sql"), "utf8");

let failed = 0;
function test(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === "function") {
      return out.then(() => console.log("PASS", name)).catch((err) => {
        failed++;
        console.error("FAIL", name, err && err.message);
      });
    }
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, err && err.message);
  }
}

function fakeFile(type, size, name) {
  return { type, size, name: name || "x" };
}

function fakeTimers() {
  let seq = 0;
  const items = new Map();
  return {
    now: 0,
    setTimeout(fn, ms) {
      const id = ++seq;
      items.set(id, { fn, at: this.now + ms });
      return id;
    },
    clearTimeout(id) {
      items.delete(id);
    },
    flush(ms) {
      this.now += ms;
      for (const [id, item] of [...items]) {
        if (item.at <= this.now) {
          items.delete(id);
          item.fn();
        }
      }
    }
  };
}

function createMemoryDb(opts) {
  opts = opts || {};
  const log = [];
  let settings = Object.assign({
    id: 1,
    eyebrow: "سۈكۈت قاش",
    trust_line: "2013",
    body: "تەن",
    primary_label: "كىتاب",
    primary_href: "#books",
    secondary_label: "ھەققىدە",
    secondary_href: "#about",
    rotation_interval_seconds: 7,
    updated_at: "2026-01-01T00:00:00.000Z"
  }, opts.settings || {});
  let campaigns = Array.isArray(opts.campaigns) ? opts.campaigns.slice() : [];
  const books = opts.books || [];
  const storageFiles = new Map(Object.entries(opts.storageFiles || {}));
  let insertError = opts.insertError || null;
  let updateError = opts.updateError || null;
  let deleteError = opts.deleteError || null;
  let zeroRowUpdate = !!opts.zeroRowUpdate;
  let zeroRowDelete = !!opts.zeroRowDelete;
  let uploadThrow = !!opts.uploadThrow;

  function run(q) {
    log.push({
      table: q.table,
      action: q.action,
      payload: q.payload,
      filters: Object.assign({}, q.filters),
      limit: q.limitN,
      or: q.orFilter,
      orders: q.orders.slice(),
      select: q.selectCols
    });
    if (q.table === "store_hero_settings") {
      if (q.action === "select") {
        const row = Number(q.filters.id) === 1 ? settings : null;
        return { data: q.single ? row : (row ? [row] : []), error: null };
      }
      if (q.action === "update") {
        if (Number(String(q.filters.id)) !== 1) return { data: null, error: { message: "refused non-singleton" } };
        if (updateError) return { data: null, error: updateError };
        if (zeroRowUpdate) return { data: null, error: null };
        settings = Object.assign({}, settings, q.payload, { id: 1 });
        return { data: q.single ? { id: 1 } : [settings], error: null };
      }
      if (q.action === "insert") return { data: null, error: { message: "settings insert forbidden" } };
    }
    if (q.table === "store_hero_campaigns") {
      if (q.action === "select") {
        return { data: campaigns.slice(), error: null };
      }
      if (q.action === "insert") {
        if (insertError) return { data: null, error: insertError };
        const row = Object.assign({ id: "camp-" + (campaigns.length + 1), created_at: "2026-01-01T00:00:00.000Z" }, q.payload);
        campaigns.push(row);
        return { data: q.single ? { id: row.id } : [{ id: row.id }], error: null };
      }
      if (q.action === "update") {
        if (updateError) return { data: null, error: updateError };
        if (zeroRowUpdate) return { data: null, error: null };
        const hit = campaigns.find((row) => String(row.id) === String(q.filters.id));
        if (!hit) return { data: q.single ? null : [], error: null };
        campaigns = campaigns.map((row) => String(row.id) === String(q.filters.id) ? Object.assign({}, row, q.payload) : row);
        return { data: q.single ? { id: hit.id } : [{ id: hit.id }], error: null };
      }
      if (q.action === "delete") {
        if (deleteError) return { data: null, error: deleteError };
        if (zeroRowDelete) return { data: null, error: null };
        const existing = campaigns.find((row) => String(row.id) === String(q.filters.id));
        if (!existing) return { data: q.single ? null : [], error: null };
        campaigns = campaigns.filter((row) => String(row.id) !== String(q.filters.id));
        return { data: q.single ? { id: existing.id } : [{ id: existing.id }], error: null };
      }
    }
    if (q.table === "books") {
      let rows = books.slice();
      if (Object.prototype.hasOwnProperty.call(q.filters, "id")) {
        const want = String(q.filters.id);
        rows = rows.filter((b) => String(b.id) === want);
        return { data: q.single ? (rows[0] || null) : rows, error: null };
      }
      if (q.orFilter) {
        const term = String(q.orFilter);
        rows = rows.filter((b) => term.includes("title") || term.includes("author"));
      }
      if (q.limitN != null) rows = rows.slice(0, q.limitN);
      return { data: rows, error: null };
    }
    return { data: null, error: { message: "unknown table " + q.table } };
  }

  function from(table) {
    const q = {
      table,
      action: "select",
      payload: null,
      filters: {},
      orders: [],
      limitN: null,
      orFilter: "",
      selectCols: "*",
      single: false
    };
    const api = {
      select(cols) { q.selectCols = cols; return api; },
      eq(k, v) { q.filters[k] = v; return api; },
      order(col, opts) { q.orders.push({ col, opts }); return api; },
      limit(n) { q.limitN = n; return api; },
      or(s) { q.orFilter = s; return api; },
      update(payload) { q.action = "update"; q.payload = payload; return api; },
      insert(payload) { q.action = "insert"; q.payload = Array.isArray(payload) ? payload[0] : payload; return api; },
      delete() { q.action = "delete"; return api; },
      maybeSingle() { q.single = true; return Promise.resolve(run(q)); },
      then(resolve, reject) { return Promise.resolve(run(q)).then(resolve, reject); }
    };
    return api;
  }

  const storage = {
    from(bucket) {
      return {
        async upload(objectPath, file, opts) {
          log.push({ op: "upload", bucket, path: objectPath, type: file && file.type, size: file && file.size, opts });
          if (uploadThrow) throw new Error("storage network exploded");
          if (opts && opts.uploadFail) return { error: { message: "upload fail" } };
          storageFiles.set(objectPath, file);
          return { data: { path: objectPath }, error: null };
        },
        getPublicUrl(objectPath) {
          log.push({ op: "getPublicUrl", path: objectPath });
          return { data: { publicUrl: "https://example.supabase.co/storage/v1/object/public/" + bucket + "/" + objectPath } };
        },
        async remove(paths) {
          log.push({ op: "remove", paths: [].concat(paths) });
          [].concat(paths).forEach((p) => storageFiles.delete(p));
          return { data: [], error: null };
        }
      };
    }
  };

  return {
    from,
    storage,
    log,
    get settings() { return settings; },
    get campaigns() { return campaigns; },
    storageFiles,
    setInsertError(err) { insertError = err; },
    setUpdateError(err) { updateError = err; },
    setZeroRowUpdate(v) { zeroRowUpdate = !!v; },
    setZeroRowDelete(v) { zeroRowDelete = !!v; },
    setUploadThrow(v) { uploadThrow = !!v; }
  };
}

function controller(db, extra) {
  return Hero.createHeroAdminController(Object.assign({
    getDb: () => db,
    getUser: () => ({ id: "user-1" }),
    getCfg: () => ({ bucket: "book-covers" }),
    uuid: () => "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    now: () => Date.parse("2026-06-01T12:00:00.000Z"),
    confirm: () => true,
    URL: {
      createObjectURL: () => "blob:hero-preview",
      revokeObjectURL() {}
    }
  }, extra || {}));
}

test("Admin Hero card sits after announcement in storefront", () => {
  const a = adminHtml.indexOf('id="announcementCard"');
  const h = adminHtml.indexOf('id="heroAdminCard"');
  const panel = adminHtml.indexOf('data-admin-section-panel="storefront"');
  assert.ok(a > panel && h > a);
  assert.match(adminHtml, /🖼 باش بەت Hero باشقۇرۇش/);
  assert.match(adminHtml, /id="announceInterval"/);
  assert.match(adminHtml, /يېڭى Hero تەكلىپى/);
  assert.doesNotMatch(heroJs, /store_hero_store_slides/);
  assert.doesNotMatch(heroJs, /service_role/);
  assert.doesNotMatch(adminJs, /service_role/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public.store_hero_settings/);
});

test("interval helper only accepts 5/7/10/15", () => {
  assert.deepStrictEqual(Hero.HERO_INTERVALS, [5, 7, 10, 15]);
  assert.strictEqual(Hero.clampHeroInterval(7), 7);
  assert.strictEqual(Hero.clampHeroInterval(8), 7);
  assert.strictEqual(Hero.clampHeroInterval("15"), 15);
  const bad = Hero.validateSettingsFields({ rotation_interval_seconds: 8, primary_href: "#books", secondary_href: "#about" });
  assert.strictEqual(bad.ok, false);
  const good = Hero.validateSettingsFields({ rotation_interval_seconds: 10, primary_href: "#books" });
  assert.strictEqual(good.ok, true);
  assert.strictEqual(good.payload.rotation_interval_seconds, 10);
});

test("unsafe hrefs are rejected for settings and campaigns", () => {
  const bad = [
    "https://evil.example",
    "http://x",
    "javascript:alert(1)",
    "data:text/html,x",
    "vbscript:x",
    "file:///etc/passwd",
    "blob:foo",
    "//cdn.example/x",
    "./secret",
    "../admin",
    "/../admin"
  ];
  bad.forEach((href) => {
    assert.strictEqual(Hero.isInternalHref(href), false, href);
    assert.strictEqual(Hero.validateSettingsFields({ rotation_interval_seconds: 7, primary_href: href }).ok, false, href);
    assert.strictEqual(Hero.validateCampaignDraft({ enabled: false, primary_href: href }).ok, false, href);
  });
  ["#books", "#about", "/book/123", "/adabiyat", "/children"].forEach((href) => {
    assert.strictEqual(Hero.isInternalHref(href), true, href);
  });
  ["/\\evil.example", "/foo\\bar", "\\\\evil.example"].forEach((href) => {
    assert.strictEqual(Hero.isInternalHref(href), false, href);
    assert.strictEqual(Hero.validateSettingsFields({ rotation_interval_seconds: 7, primary_href: href }).ok, false, href);
  });
});

test("derived campaign status", () => {
  const now = Date.parse("2026-06-01T12:00:00.000Z");
  assert.strictEqual(Hero.campaignStatus({ enabled: false }, now).key, "disabled");
  assert.strictEqual(Hero.campaignStatus({ enabled: true, starts_at: "2026-07-01T00:00:00.000Z" }, now).key, "scheduled");
  assert.strictEqual(Hero.campaignStatus({ enabled: true, ends_at: "2026-05-01T00:00:00.000Z" }, now).key, "expired");
  assert.strictEqual(Hero.campaignStatus({ enabled: true }, now).key, "active");
  assert.strictEqual(Hero.campaignStatus({ enabled: false }, now).label, "توختىتىلغان");
  assert.strictEqual(Hero.campaignStatus({ enabled: true, starts_at: "2026-07-01T00:00:00.000Z" }, now).label, "پىلانلانغان");
  assert.strictEqual(Hero.campaignStatus({ enabled: true, ends_at: "2026-05-01T00:00:00.000Z" }, now).label, "ۋاقتى ئۆتكەن");
  assert.strictEqual(Hero.campaignStatus({ enabled: true }, now).label, "ئاكتىپ");
});

test("end <= start is rejected", () => {
  const res = Hero.validateCampaignDraft({
    enabled: false,
    starts_at: "2026-06-02T10:00",
    ends_at: "2026-06-02T09:00"
  });
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.schedule);
});

test("enabled custom campaign requires title + image", () => {
  const missing = Hero.validateCampaignDraft({ enabled: true, title: "", book_id: "" });
  assert.strictEqual(missing.ok, false);
  assert.ok(missing.errors.title);
  assert.ok(missing.errors.image);
  const ok = Hero.validateCampaignDraft({
    enabled: true,
    title: "باھار",
    pendingFile: fakeFile("image/jpeg", 10)
  });
  assert.strictEqual(ok.ok, true);
});

test("linked-book campaign can save without custom image", () => {
  const res = Hero.validateCampaignDraft({
    enabled: true,
    book_id: "9007199254740993",
    title: ""
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.payload.book_id, "9007199254740993");
});

test("MIME jpeg/png/webp accepted, SVG and huge files rejected", () => {
  assert.strictEqual(Hero.validateHeroUploadFile(fakeFile("image/jpeg", 10)).ok, true);
  assert.strictEqual(Hero.validateHeroUploadFile(fakeFile("image/png", 10)).ok, true);
  assert.strictEqual(Hero.validateHeroUploadFile(fakeFile("image/webp", 10)).ok, true);
  assert.strictEqual(Hero.validateHeroUploadFile(fakeFile("image/svg+xml", 10, "x.svg")).ok, false);
  assert.strictEqual(Hero.validateHeroUploadFile(fakeFile("image/jpeg", Hero.HERO_MAX_BYTES + 1)).ok, false);
  assert.strictEqual(Hero.validateHeroUploadFile(fakeFile("image/gif", 10)).ok, false);
});

test("safe object-path generation ignores user filename", () => {
  const pathName = Hero.generateHeroCampaignObjectPath("image/jpeg", () => "11111111-2222-3333-4444-555555555555");
  assert.strictEqual(pathName, "hero/campaigns/11111111-2222-3333-4444-555555555555.jpg");
  assert.ok(Hero.isSafeHeroCampaignObjectPath(pathName));
  assert.ok(!Hero.isSafeHeroCampaignObjectPath("covers/x.jpg"));
  assert.ok(!Hero.isSafeHeroCampaignObjectPath("/hero/campaigns/x.jpg"));
  assert.ok(!Hero.isSafeHeroCampaignObjectPath("hero/campaigns/../x.jpg"));
  assert.ok(!Hero.isSafeHeroCampaignObjectPath("hero/campaigns/"));
  assert.ok(!Hero.isSafeHeroCampaignObjectPath(""));
  assert.ok(!Hero.isSafeHeroCampaignObjectPath("hero/other/x.jpg"));
});

test("bigint book id stays an exact decimal string", () => {
  const big = "9007199254740993";
  assert.strictEqual(Hero.bookIdKey(big), big);
  assert.notStrictEqual(Hero.bookIdKey(big), String(Number(big)));
  assert.strictEqual(Hero.bookIdKey(Number(big)), "");
});

test("XSS-looking copy is assigned via textContent, not innerHTML", () => {
  assert.match(heroJs, /title\.textContent\s*=\s*row\.title/);
  assert.match(heroJs, /node\.textContent\s*=\s*value/);
  assert.doesNotMatch(heroJs, /innerHTML\s*=\s*row\.(title|body|eyebrow)/);
  const node = { innerHTML: "SAFE", _t: "" };
  Object.defineProperty(node, "textContent", {
    set(v) { this._t = String(v); },
    get() { return this._t; }
  });
  node.textContent = "<img onerror=alert(1)>";
  assert.strictEqual(node._t, "<img onerror=alert(1)>");
  assert.strictEqual(node.innerHTML, "SAFE");
});

const asyncTests = [];

asyncTests.push(test("settings load into form and save only updates id=1", async () => {
  const db = createMemoryDb();
  const ctl = controller(db);
  const loaded = await ctl.loadSettings();
  assert.strictEqual(loaded.ok, true);
  assert.strictEqual(loaded.form.eyebrow, "سۈكۈت قاش");
  assert.strictEqual(loaded.form.rotation_interval_seconds, 7);
  const saved = await ctl.saveSettings({
    eyebrow: "يېڭى قاش",
    trust_line: "",
    body: "يېڭى تەن",
    primary_label: "ئاچ",
    primary_href: "#books",
    secondary_label: "",
    secondary_href: "#about",
    rotation_interval_seconds: 15
  });
  assert.strictEqual(saved.ok, true);
  assert.strictEqual(saved.form.eyebrow, "يېڭى قاش");
  assert.strictEqual(saved.form.trust_line, "");
  assert.strictEqual(db.settings.id, 1);
  assert.strictEqual(db.settings.rotation_interval_seconds, 15);
  assert.strictEqual(db.settings.updated_by, "user-1");
  const updates = db.log.filter((x) => x.table === "store_hero_settings" && x.action === "update");
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].filters.id, 1);
  assert.ok(!db.log.some((x) => x.table === "store_hero_settings" && x.action === "insert"));
}));

asyncTests.push(test("unsafe settings href is not saved", async () => {
  const db = createMemoryDb();
  const ctl = controller(db);
  const res = await ctl.saveSettings({
    rotation_interval_seconds: 7,
    primary_href: "https://evil.test"
  });
  assert.strictEqual(res.ok, false);
  assert.ok(!db.log.some((x) => x.action === "update"));
}));

asyncTests.push(test("campaign list includes disabled/scheduled/expired", async () => {
  const db = createMemoryDb({
    campaigns: [
      { id: "a", enabled: true, sort_order: 2, title: "active", created_at: "2026-01-03T00:00:00.000Z" },
      { id: "b", enabled: false, sort_order: 0, title: "off", created_at: "2026-01-01T00:00:00.000Z" },
      { id: "c", enabled: true, sort_order: 1, title: "later", starts_at: "2027-01-01T00:00:00.000Z", created_at: "2026-01-02T00:00:00.000Z" },
      { id: "d", enabled: true, sort_order: 1, title: "old", ends_at: "2020-01-01T00:00:00.000Z", created_at: "2026-01-02T01:00:00.000Z" }
    ]
  });
  const ctl = controller(db);
  const res = await ctl.loadCampaigns();
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.rows.map((r) => r.id), ["b", "c", "d", "a"]);
  const keys = res.rows.map((r) => Hero.campaignStatus(r, Date.parse("2026-06-01T00:00:00.000Z")).key);
  assert.deepStrictEqual(keys, ["disabled", "scheduled", "expired", "active"]);
}));

asyncTests.push(test("book search is bounded and debounced", async () => {
  const timers = fakeTimers();
  const books = [];
  for (let i = 1; i <= 20; i++) books.push({ id: String(1000 + i), title: "Kitab " + i, author: "A" });
  const db = createMemoryDb({ books });
  let searches = 0;
  const origFrom = db.from.bind(db);
  db.from = function (table) {
    const chain = origFrom(table);
    if (table === "books") {
      const origThen = chain.then.bind(chain);
      chain.then = function (res, rej) {
        searches += 1;
        return origThen(res, rej);
      };
      const origSingle = chain.maybeSingle;
      chain.maybeSingle = function () {
        searches += 1;
        return origSingle();
      };
    }
    return chain;
  };
  const ctl = controller(db, { timers });
  ctl.scheduleBookSearch("ki");
  ctl.scheduleBookSearch("kit");
  assert.strictEqual(searches, 0);
  timers.flush(249);
  assert.strictEqual(searches, 0);
  timers.flush(2);
  await new Promise((r) => setImmediate(r));
  const result = await ctl.searchBooks("kit");
  assert.ok(result.rows.length <= Hero.HERO_BOOK_SEARCH_LIMIT);
  assert.strictEqual(ctl.state.lastBookSearch.limit, 8);
  const bookLogs = db.log.filter((x) => x.table === "books");
  assert.ok(bookLogs.every((x) => x.limit === 8));
  assert.ok(bookLogs.every((x) => x.or));
}));

asyncTests.push(test("create upload success + DB fail cleans new object", async () => {
  const db = createMemoryDb({ insertError: { message: "rls" } });
  const ctl = controller(db);
  ctl.state.draft.enabled = true;
  ctl.state.draft.title = "تەكلىپ";
  ctl.setPendingFile(fakeFile("image/png", 20, "user-name.PNG"));
  const res = await ctl.saveCampaign();
  assert.strictEqual(res.ok, false);
  const uploads = db.log.filter((x) => x.op === "upload");
  const removes = db.log.filter((x) => x.op === "remove");
  assert.strictEqual(uploads.length, 1);
  assert.strictEqual(uploads[0].path, "hero/campaigns/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png");
  assert.strictEqual(removes.length, 1);
  assert.deepStrictEqual(removes[0].paths, ["hero/campaigns/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png"]);
  assert.strictEqual(db.campaigns.length, 0);
}));

asyncTests.push(test("edit replacement removes old object only after DB success", async () => {
  const oldPath = "hero/campaigns/old-object.jpg";
  const db = createMemoryDb({
    campaigns: [{
      id: "c1",
      enabled: true,
      title: "كونا",
      image_url: "https://example.supabase.co/storage/v1/object/public/book-covers/" + oldPath,
      object_path: oldPath,
      sort_order: 0
    }]
  });
  db.storageFiles.set(oldPath, fakeFile("image/jpeg", 10));
  const ctl = controller(db);
  await ctl.loadCampaigns();
  ctl.fillDraftFromRow(db.campaigns[0]);
  ctl.setPendingFile(fakeFile("image/webp", 12));
  const res = await ctl.saveCampaign();
  assert.strictEqual(res.ok, true);
  const ops = db.log.filter((x) => x.op === "upload" || x.op === "remove" || x.action === "update");
  const uploadIdx = db.log.findIndex((x) => x.op === "upload");
  const updateIdx = db.log.findIndex((x) => x.table === "store_hero_campaigns" && x.action === "update");
  const removeIdx = db.log.findIndex((x) => x.op === "remove" && x.paths && x.paths[0] === oldPath);
  assert.ok(uploadIdx >= 0 && updateIdx > uploadIdx && removeIdx > updateIdx);
  assert.strictEqual(db.campaigns[0].object_path, "hero/campaigns/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.webp");
}));

asyncTests.push(test("failed update does not remove old object", async () => {
  const oldPath = "hero/campaigns/keep-me.jpg";
  const db = createMemoryDb({
    campaigns: [{ id: "c1", enabled: true, title: "كونا", object_path: oldPath, image_url: "https://example.supabase.co/x.jpg", sort_order: 0 }],
    updateError: { message: "permission denied", code: "42501" }
  });
  db.storageFiles.set(oldPath, fakeFile("image/jpeg", 10));
  const ctl = controller(db);
  ctl.fillDraftFromRow(db.campaigns[0]);
  ctl.setPendingFile(fakeFile("image/jpeg", 11));
  const res = await ctl.saveCampaign();
  assert.strictEqual(res.ok, false);
  assert.ok(res.keptOld);
  assert.ok(db.storageFiles.has(oldPath));
  const removed = db.log.filter((x) => x.op === "remove").flatMap((x) => x.paths);
  assert.ok(!removed.includes(oldPath));
  assert.ok(removed.includes("hero/campaigns/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg"));
}));

asyncTests.push(test("linked-book custom-image removal nulls DB image fields", async () => {
  const oldPath = "hero/campaigns/drop-me.png";
  const db = createMemoryDb({
    campaigns: [{
      id: "c2",
      enabled: true,
      book_id: "42",
      title: "كىتاب",
      object_path: oldPath,
      image_url: "https://example.supabase.co/storage/v1/object/public/book-covers/" + oldPath,
      sort_order: 0
    }]
  });
  const ctl = controller(db);
  ctl.fillDraftFromRow(db.campaigns[0], { id: "42", title: "كىتاب", is_active: true, stock: 5 });
  const allow = ctl.requestRemoveCustomImage();
  assert.strictEqual(allow.ok, true);
  const res = await ctl.saveCampaign();
  assert.strictEqual(res.ok, true);
  const upd = db.log.find((x) => x.table === "store_hero_campaigns" && x.action === "update");
  assert.strictEqual(upd.payload.image_url, null);
  assert.strictEqual(upd.payload.object_path, null);
  const removeIdx = db.log.findIndex((x) => x.op === "remove");
  const updateIdx = db.log.findIndex((x) => x.table === "store_hero_campaigns" && x.action === "update");
  assert.ok(removeIdx > updateIdx);
}));

asyncTests.push(test("campaign delete is DB first then storage", async () => {
  const oldPath = "hero/campaigns/gone.jpg";
  const db = createMemoryDb({
    campaigns: [{ id: "del1", enabled: true, title: "x", object_path: oldPath }]
  });
  const ctl = controller(db);
  const res = await ctl.deleteCampaign(db.campaigns[0], true);
  assert.strictEqual(res.ok, true);
  const delIdx = db.log.findIndex((x) => x.table === "store_hero_campaigns" && x.action === "delete");
  const remIdx = db.log.findIndex((x) => x.op === "remove");
  assert.ok(delIdx >= 0 && remIdx > delIdx);
  assert.strictEqual(db.campaigns.length, 0);
}));

asyncTests.push(test("storage delete refuses non-hero/campaigns path", async () => {
  const db = createMemoryDb();
  const ctl = controller(db);
  const res = await ctl.safeRemoveObject("books/1/cover.jpg");
  assert.strictEqual(res.ok, false);
  assert.ok(!db.log.some((x) => x.op === "remove"));
}));

asyncTests.push(test("preview does not write or upload", async () => {
  const db = createMemoryDb();
  const ctl = controller(db);
  ctl.state.draft.title = "ئالدىن كۆرۈش";
  ctl.setPendingFile(fakeFile("image/jpeg", 10));
  const writesBefore = JSON.stringify(ctl.state.writes);
  const model = ctl.buildPreviewModel();
  assert.strictEqual(model.title, "ئالدىن كۆرۈش");
  assert.strictEqual(ctl.previewWouldWrite(), false);
  assert.strictEqual(JSON.stringify(ctl.state.writes), writesBefore);
  assert.ok(!db.log.some((x) => x.op === "upload" || x.action === "insert" || x.action === "update"));
}));

asyncTests.push(test("form reset does not carry previous edit state", async () => {
  const ctl = controller(createMemoryDb());
  ctl.fillDraftFromRow({
    id: "keep-me",
    enabled: false,
    sort_order: 9,
    title: "كونا ماۋزۇ",
    body: "كونا تەن",
    book_id: "99",
    primary_href: "#books",
    starts_at: "2026-01-01T00:00:00.000Z",
    ends_at: "2026-02-01T00:00:00.000Z"
  }, { id: "99", title: "K" });
  const d = ctl.resetDraft();
  assert.strictEqual(d.id, "");
  assert.strictEqual(d.enabled, true);
  assert.strictEqual(d.sort_order, 0);
  assert.strictEqual(d.title, "");
  assert.strictEqual(d.body, "");
  assert.strictEqual(d.book_id, "");
  assert.strictEqual(d.starts_at, "");
  assert.strictEqual(d.ends_at, "");
  assert.strictEqual(d.linkedBook, null);
}));

asyncTests.push(test("exact bigint id is stored from picker without Number()", async () => {
  const big = "9007199254740993";
  const ctl = controller(createMemoryDb());
  const selected = ctl.selectLinkedBook({ id: big, title: "چوڭ ID", author: "A", stock: 0, is_active: false });
  assert.strictEqual(selected.id, big);
  assert.strictEqual(ctl.state.draft.book_id, big);
  assert.ok(Hero.linkedBookWarning(selected));
}));

asyncTests.push(test("Admin Hero CSS guards overflow", () => {
  assert.match(adminCss, /#heroAdminCard\{overflow-x:hidden\}/);
  assert.match(adminCss, /#heroAdminCard,#heroAdminCard \*\{min-width:0\}/);
  assert.match(adminCss, /grid-template-columns:48px minmax\(0,1fr\) auto/);
}));

asyncTests.push(test("settings zero-row update is not success", async () => {
  const db = createMemoryDb({ zeroRowUpdate: true });
  const ctl = controller(db);
  const before = db.settings.eyebrow;
  const res = await ctl.saveSettings({
    eyebrow: "قوللىنىلمىسۇن",
    rotation_interval_seconds: 7,
    primary_href: "#books"
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, "not_applied");
  assert.match(res.message, /قوللىنىلمىدى/);
  assert.strictEqual(db.settings.eyebrow, before);
}));

asyncTests.push(test("campaign zero-row update cleans only the new object", async () => {
  const oldPath = "hero/campaigns/keep-zero.jpg";
  const db = createMemoryDb({
    zeroRowUpdate: true,
    campaigns: [{
      id: "c-zero",
      enabled: true,
      title: "كونا",
      object_path: oldPath,
      image_url: "https://example.supabase.co/storage/v1/object/public/book-covers/" + oldPath,
      sort_order: 0
    }]
  });
  db.storageFiles.set(oldPath, fakeFile("image/jpeg", 10));
  const ctl = controller(db);
  ctl.fillDraftFromRow(db.campaigns[0]);
  ctl.setPendingFile(fakeFile("image/png", 12));
  const res = await ctl.saveCampaign();
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, "not_applied");
  assert.ok(res.keptOld);
  assert.strictEqual(ctl.state.draft.id, "c-zero");
  assert.strictEqual(db.campaigns[0].object_path, oldPath);
  assert.ok(db.storageFiles.has(oldPath));
  const removed = db.log.filter((x) => x.op === "remove").flatMap((x) => x.paths);
  assert.ok(removed.includes("hero/campaigns/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png"));
  assert.ok(!removed.includes(oldPath));
}));

asyncTests.push(test("campaign zero-row delete does not touch Storage", async () => {
  const oldPath = "hero/campaigns/still-here.jpg";
  const db = createMemoryDb({
    zeroRowDelete: true,
    campaigns: [{ id: "del-zero", enabled: true, title: "x", object_path: oldPath }]
  });
  db.storageFiles.set(oldPath, fakeFile("image/jpeg", 10));
  const ctl = controller(db);
  const res = await ctl.deleteCampaign(db.campaigns[0], true);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, "not_applied");
  assert.ok(res.storageSkipped);
  assert.strictEqual(db.campaigns.length, 1);
  assert.ok(db.storageFiles.has(oldPath));
  assert.ok(!db.log.some((x) => x.op === "remove"));
}));

asyncTests.push(test("Edit loads real linked book and preview falls back after custom image remove", async () => {
  const oldPath = "hero/campaigns/custom.png";
  const db = createMemoryDb({
    campaigns: [{
      id: "c-real",
      enabled: true,
      book_id: "42",
      title: null,
      image_url: "/custom-campaign.webp",
      object_path: oldPath,
      sort_order: 0
    }],
    books: [{
      id: "42",
      title: "ھەقىقىي كىتاب",
      author: "ئاپتور",
      image_url: "/real-book-cover.webp",
      is_active: true,
      stock: 8
    }]
  });
  const ctl = controller(db);
  const edited = await ctl.beginEditCampaign(db.campaigns[0]);
  assert.strictEqual(edited.ok, true);
  assert.strictEqual(ctl.state.draft.book_id, "42");
  assert.strictEqual(ctl.state.draft.linkedBook.title, "ھەقىقىي كىتاب");
  assert.strictEqual(ctl.state.draft.linkedBook.image_url, "/real-book-cover.webp");
  assert.notStrictEqual(ctl.state.draft.linkedBook.title, ctl.state.draft.title);
  const allow = ctl.requestRemoveCustomImage();
  assert.strictEqual(allow.ok, true);
  const preview = ctl.buildPreviewModel();
  assert.strictEqual(preview.image, "/real-book-cover.webp");
  assert.notStrictEqual(preview.image, "/custom-campaign.webp");
  const res = await ctl.saveCampaign();
  assert.strictEqual(res.ok, true);
  assert.strictEqual(db.campaigns[0].image_url, null);
  assert.strictEqual(db.campaigns[0].object_path, null);
}));

asyncTests.push(test("inactive linked book warning uses real book state", async () => {
  const db = createMemoryDb({
    campaigns: [{ id: "c-warn", enabled: true, book_id: "42", title: null, image_url: null, sort_order: 0 }],
    books: [{ id: "42", title: "يوشۇرۇن", author: "A", image_url: "/cover.webp", is_active: false, stock: 0 }]
  });
  const ctl = controller(db);
  await ctl.beginEditCampaign(db.campaigns[0]);
  const preview = ctl.buildPreviewModel();
  assert.ok(preview.warning);
  assert.match(preview.warning, /ئاممىۋى Hero/);
}));

asyncTests.push(test("book lookup failure preserves book_id without fake cover", async () => {
  const db = createMemoryDb({
    campaigns: [{ id: "c-miss", enabled: true, book_id: "99", title: null, image_url: "/custom-campaign.webp", sort_order: 0 }],
    books: []
  });
  const ctl = controller(db);
  const edited = await ctl.beginEditCampaign(db.campaigns[0]);
  assert.ok(edited.bookLookupFailed);
  assert.strictEqual(ctl.state.draft.book_id, "99");
  assert.strictEqual(ctl.state.draft.linkedBook, null);
  const preview = ctl.buildPreviewModel();
  assert.ok(preview.warning);
  assert.strictEqual(ctl.state.draft.linkedBook, null);
  assert.strictEqual(ctl.state.draft.book_id, "99");
}));

asyncTests.push(test("thrown Storage upload is caught and only new path is cleaned", async () => {
  const oldPath = "hero/campaigns/old-keep.jpg";
  const db = createMemoryDb({
    uploadThrow: true,
    campaigns: [{ id: "c-throw", enabled: true, title: "كونا", object_path: oldPath, image_url: "https://example.supabase.co/x.jpg", sort_order: 0 }]
  });
  db.storageFiles.set(oldPath, fakeFile("image/jpeg", 10));
  const ctl = controller(db);
  ctl.fillDraftFromRow(db.campaigns[0]);
  ctl.setPendingFile(fakeFile("image/jpeg", 11));
  const res = await ctl.uploadHeroImage(fakeFile("image/jpeg", 11));
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, "upload_throw");
  assert.ok(db.storageFiles.has(oldPath));
  const removed = db.log.filter((x) => x.op === "remove").flatMap((x) => x.paths);
  assert.ok(removed.includes("hero/campaigns/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg"));
  assert.ok(!removed.includes(oldPath));
}));

asyncTests.push(test("applySafeImgSrc hides empty preview images", () => {
  const img = {
    hidden: false,
    attrs: { src: "stale" },
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; }
  };
  assert.strictEqual(Hero.applySafeImgSrc(img, ""), false);
  assert.strictEqual(img.hidden, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(img.attrs, "src"));
  assert.strictEqual(Hero.applySafeImgSrc(img, "/real-book-cover.webp"), true);
  assert.strictEqual(img.hidden, false);
  assert.strictEqual(img.attrs.src, "/real-book-cover.webp");
}));

Promise.all(asyncTests.filter(Boolean)).then(() => {
  if (failed) {
    console.error(failed + " failed");
    process.exit(1);
  }
  console.log("admin-hero-tests ok");
});
