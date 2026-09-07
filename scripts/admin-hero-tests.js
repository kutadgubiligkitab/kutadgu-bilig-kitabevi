#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const Hero = require(path.join(root, "admin-hero.js"));
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const adminJs = fs.readFileSync(path.join(root, "admin.js"), "utf8");
const adminCss = fs.readFileSync(path.join(root, "admin.css"), "utf8");
const heroJs = fs.readFileSync(path.join(root, "admin-hero.js"), "utf8");
const sql = fs.readFileSync(path.join(root, "SITE_HERO_MANAGEMENT.sql"), "utf8");
const sqlStat = fs.statSync(path.join(root, "SITE_HERO_MANAGEMENT.sql"));

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

const DEFAULT_SLIDES = [
  { id: "repo-main", enabled: true, sort_order: 0, origin: "repo", repo_key: "main", image_url: null, object_path: null, created_at: "2020-01-01T00:00:00.000Z" },
  { id: "repo-library", enabled: true, sort_order: 1, origin: "repo", repo_key: "library", image_url: null, object_path: null, created_at: "2020-01-01T00:00:00.000Z" },
  { id: "repo-exterior", enabled: true, sort_order: 2, origin: "repo", repo_key: "exterior", image_url: null, object_path: null, created_at: "2020-01-01T00:00:00.000Z" }
];

function createMemoryDb(opts) {
  opts = opts || {};
  const log = [];
  let settings = Object.assign({
    id: 1,
    eyebrow: "LOCKED",
    trust_line: null,
    body: null,
    primary_label: "LOCKED",
    primary_href: "#books",
    secondary_label: "LOCKED",
    secondary_href: "#about",
    rotation_interval_seconds: 7,
    updated_at: "2026-01-01T00:00:00.000Z"
  }, opts.settings || {});
  let slides = Array.isArray(opts.slides) ? opts.slides.map((row) => Object.assign({}, row)) : DEFAULT_SLIDES.map((row) => Object.assign({}, row));
  const storageFiles = new Map(Object.entries(opts.storageFiles || {}));
  let insertError = opts.insertError || null;
  let updateError = opts.updateError || null;
  let deleteError = opts.deleteError || null;
  let zeroRowUpdate = !!opts.zeroRowUpdate;
  let zeroRowDelete = !!opts.zeroRowDelete;
  let uploadThrow = !!opts.uploadThrow;
  let failEnableUpload = !!opts.failEnableUpload;
  let failEnableRepo = !!opts.failEnableRepo;
  let failDisableUpload = !!opts.failDisableUpload;
  let failDisableRepo = !!opts.failDisableRepo;
  let insertSeq = 0;

  function run(q) {
    log.push({
      table: q.table,
      action: q.action,
      payload: q.payload,
      filters: Object.assign({}, q.filters),
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
      if (q.action === "delete") return { data: null, error: { message: "settings delete forbidden" } };
    }
    if (q.table === "store_hero_store_slides") {
      if (q.action === "select") {
        return { data: slides.slice(), error: null };
      }
      if (q.action === "insert") {
        if (insertError) return { data: null, error: insertError };
        insertSeq += 1;
        const row = Object.assign({ id: "upload-" + insertSeq, created_at: "2026-06-01T12:00:00.000Z" }, q.payload);
        slides.push(row);
        return { data: q.single ? { id: row.id } : [{ id: row.id }], error: null };
      }
      if (q.action === "update") {
        if (updateError) return { data: null, error: updateError };
        if (zeroRowUpdate) return { data: null, error: null };
        const hit = slides.find((row) => String(row.id) === String(q.filters.id));
        if (!hit) return { data: q.single ? null : [], error: null };
        if (failEnableUpload && q.payload && q.payload.enabled === true && hit.origin === "upload") {
          return { data: null, error: { message: "upload enable failed" } };
        }
        if (failEnableRepo && q.payload && q.payload.enabled === true && hit.origin === "repo") {
          return { data: null, error: { message: "repo enable failed" } };
        }
        if (failDisableUpload && q.payload && q.payload.enabled === false && hit.origin === "upload" && hit.enabled !== false && hit.enabled !== "false" && hit.enabled !== 0) {
          return { data: null, error: { message: "upload disable failed" } };
        }
        if (failDisableRepo && q.payload && q.payload.enabled === false && hit.origin === "repo") {
          return { data: null, error: { message: "repo disable failed" } };
        }
        slides = slides.map((row) => String(row.id) === String(q.filters.id) ? Object.assign({}, row, q.payload) : row);
        return { data: q.single ? { id: hit.id } : [{ id: hit.id }], error: null };
      }
      if (q.action === "delete") {
        if (deleteError) return { data: null, error: deleteError };
        if (zeroRowDelete) return { data: null, error: null };
        const existing = slides.find((row) => String(row.id) === String(q.filters.id));
        if (!existing) return { data: q.single ? null : [], error: null };
        if (existing.origin === "repo") return { data: null, error: { message: "repo rows cannot be deleted" } };
        slides = slides.filter((row) => String(row.id) !== String(q.filters.id));
        return { data: q.single ? { id: existing.id } : [{ id: existing.id }], error: null };
      }
    }
    if (q.table === "store_hero_campaigns" || q.table === "books") {
      return { data: null, error: { message: "campaign admin removed" } };
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
        async upload(objectPath, file, uploadOpts) {
          log.push({ op: "upload", bucket, path: objectPath, type: file && file.type, size: file && file.size, opts: uploadOpts });
          if (uploadThrow) throw new Error("storage network exploded");
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
    get slides() { return slides; },
    storageFiles,
    setFailEnableUpload(v) { failEnableUpload = !!v; },
    setFailEnableRepo(v) { failEnableRepo = !!v; },
    setFailDisableUpload(v) { failDisableUpload = !!v; },
    setFailDisableRepo(v) { failDisableRepo = !!v; },
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
    URL: {
      createObjectURL: () => "blob:hero-preview",
      revokeObjectURL() {}
    }
  }, extra || {}));
}

function managedPath(slot, ext) {
  return "hero/store-slides/slot-" + slot + "-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee." + ext;
}

function saveFields() {
  return {
    trust_line: Hero.DEFAULT_TRUST_LINE,
    body: Hero.DEFAULT_BODY,
    rotation_interval_seconds: 7
  };
}

function repoSlides(overrides) {
  const rows = [
    { id: "repo-main", enabled: true, sort_order: 0, origin: "repo", repo_key: "main", image_url: null, object_path: null, created_at: "2020-01-01T00:00:00.000Z" },
    { id: "repo-library", enabled: true, sort_order: 1, origin: "repo", repo_key: "library", image_url: null, object_path: null, created_at: "2020-01-01T00:00:00.000Z" },
    { id: "repo-exterior", enabled: true, sort_order: 2, origin: "repo", repo_key: "exterior", image_url: null, object_path: null, created_at: "2020-01-01T00:00:00.000Z" }
  ];
  return rows.map((row) => Object.assign({}, row, (overrides && overrides[row.id]) || {}));
}

test("Admin Hero UI is one compact card after announcement", () => {
  const a = adminHtml.indexOf('id="announcementCard"');
  const h = adminHtml.indexOf('id="heroAdminCard"');
  const panel = adminHtml.indexOf('data-admin-section-panel="storefront"');
  assert.ok(a > panel && h > a);
  assert.match(adminHtml, /🖼 باش بەت Hero باشقۇرۇش/);
  assert.match(adminHtml, /id="announceInterval"/);
  assert.match(adminHtml, /id="heroForm"/);
  assert.match(adminHtml, /id="heroSlot1File"/);
  assert.match(adminHtml, /id="heroSlot2File"/);
  assert.match(adminHtml, /id="heroSlot3File"/);
  assert.match(adminHtml, /id="heroTrustLine"/);
  assert.match(adminHtml, /id="heroBody"/);
  assert.match(adminHtml, /id="heroRotation"/);
  assert.match(adminHtml, /id="heroSave"/);
  assert.match(adminHtml, /Hero نى ساقلاش/);
  assert.strictEqual((adminHtml.match(/id="heroSave"/g) || []).length, 1);
  assert.doesNotMatch(adminHtml, /heroCampaign/);
  assert.doesNotMatch(adminHtml, /heroBookSearch/);
  assert.doesNotMatch(adminHtml, /heroSettingsForm/);
  assert.doesNotMatch(adminHtml.slice(h, adminHtml.indexOf('id="booksCard"')), /datetime-local/);
  assert.doesNotMatch(heroJs, /store_hero_campaigns/);
  assert.doesNotMatch(heroJs, /searchBooks/);
  assert.doesNotMatch(heroJs, /service_role/);
  assert.doesNotMatch(adminJs, /service_role/);
  assert.match(heroJs, /store_hero_store_slides/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public.store_hero_settings/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public.store_hero_store_slides/);
});

test("interval helper only accepts 5/7/10/15", () => {
  assert.deepStrictEqual(Hero.HERO_INTERVALS, [5, 7, 10, 15]);
  assert.strictEqual(Hero.clampHeroInterval(7), 7);
  assert.strictEqual(Hero.clampHeroInterval(8), 7);
  assert.strictEqual(Hero.clampHeroInterval("15"), 15);
  const bad = Hero.validateSettingsFields({ rotation_interval_seconds: 8, trust_line: Hero.DEFAULT_TRUST_LINE, body: Hero.DEFAULT_BODY });
  assert.strictEqual(bad.ok, false);
  const good = Hero.validateSettingsFields({ rotation_interval_seconds: 10, trust_line: "خاس", body: "خاس تەن" });
  assert.strictEqual(good.ok, true);
  assert.strictEqual(good.payload.rotation_interval_seconds, 10);
});

test("settings payload never includes locked copy fields", () => {
  const parsed = Hero.validateSettingsFields({
    trust_line: "خاس ئىشەنچ",
    body: "خاس چۈشەندۈرۈش",
    rotation_interval_seconds: 5,
    eyebrow: "should-not-store",
    primary_label: "x",
    primary_href: "#books",
    secondary_label: "y",
    secondary_href: "#about"
  });
  assert.strictEqual(parsed.ok, true);
  assert.deepStrictEqual(Object.keys(parsed.payload).sort(), ["body", "rotation_interval_seconds", "trust_line"]);
  assert.strictEqual(parsed.payload.trust_line, "خاس ئىشەنچ");
});

test("exact default text stores NULL; custom stores string", () => {
  const def = Hero.validateSettingsFields({
    trust_line: Hero.DEFAULT_TRUST_LINE,
    body: Hero.DEFAULT_BODY,
    rotation_interval_seconds: 7
  });
  assert.strictEqual(def.payload.trust_line, null);
  assert.strictEqual(def.payload.body, null);
  const custom = Hero.validateSettingsFields({
    trust_line: "باشقا قۇر",
    body: "باشقا تەن",
    rotation_interval_seconds: 7
  });
  assert.strictEqual(custom.payload.trust_line, "باشقا قۇر");
  assert.strictEqual(custom.payload.body, "باشقا تەن");
});

test("NULL settings load as hard-coded defaults", () => {
  const form = Hero.settingsFormFromRow({ trust_line: null, body: null, rotation_interval_seconds: 7 });
  assert.strictEqual(form.trust_line, Hero.DEFAULT_TRUST_LINE);
  assert.strictEqual(form.body, Hero.DEFAULT_BODY);
});

test("slot mapping is main/library/exterior at 0/1/2", () => {
  assert.deepStrictEqual(Hero.HERO_SLOTS.map((s) => [s.slot, s.repoKey, s.sortOrder, s.defaultSrc]), [
    [1, "main", 0, "/assets/store/shop-interior-main.webp"],
    [2, "library", 1, "/assets/store/shop-interior-library.webp"],
    [3, "exterior", 2, "/assets/store/shop-exterior.webp"]
  ]);
});

test("MIME jpeg/png/webp accepted, SVG and huge files rejected", () => {
  assert.strictEqual(Hero.validateHeroUploadFile(fakeFile("image/jpeg", 10)).ok, true);
  assert.strictEqual(Hero.validateHeroUploadFile(fakeFile("image/png", 10)).ok, true);
  assert.strictEqual(Hero.validateHeroUploadFile(fakeFile("image/webp", 10)).ok, true);
  assert.strictEqual(Hero.validateHeroUploadFile(fakeFile("image/svg+xml", 10, "x.svg")).ok, false);
  assert.strictEqual(Hero.validateHeroUploadFile(fakeFile("image/jpeg", Hero.HERO_MAX_BYTES + 1)).ok, false);
  assert.strictEqual(Hero.validateHeroUploadFile(fakeFile("image/gif", 10)).ok, false);
});

test("generated path includes exact slot and safe UUID", () => {
  const uuid = "11111111-2222-3333-4444-555555555555";
  const pathName = Hero.generateHeroStoreSlideObjectPath(2, "image/jpeg", () => uuid);
  assert.strictEqual(pathName, "hero/store-slides/slot-2-" + uuid + ".jpg");
  assert.ok(Hero.isSafeHeroStoreSlideObjectPath(pathName));
  assert.strictEqual(Hero.managedSlotFromObjectPath(pathName), 2);
  const live = Hero.generateHeroStoreSlideObjectPath(1, "image/png", () => crypto.randomUUID());
  assert.match(live, /^hero\/store-slides\/slot-1-[0-9a-fA-F-]{36}\.png$/);
  assert.ok(!Hero.isSafeHeroStoreSlideObjectPath("covers/x.jpg"));
  assert.ok(!Hero.isSafeHeroStoreSlideObjectPath("/hero/store-slides/slot-1-x.jpg"));
  assert.ok(!Hero.isSafeHeroStoreSlideObjectPath("hero/store-slides/../slot-1-x.jpg"));
  assert.ok(!Hero.isSafeHeroStoreSlideObjectPath("hero/campaigns/" + uuid + ".jpg"));
  assert.ok(!Hero.isSafeHeroStoreSlideObjectPath("hero/store-slides/"));
  assert.ok(!Hero.isSafeHeroStoreSlideObjectPath(""));
  assert.ok(!Hero.isSafeHeroStoreSlideObjectPath("assets/store/shop-interior-main.webp"));
});

test("applySafeImgSrc never uses an empty src", () => {
  const img = {
    hidden: false,
    attrs: { src: "stale" },
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; }
  };
  assert.strictEqual(Hero.applySafeImgSrc(img, ""), false);
  assert.strictEqual(img.hidden, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(img.attrs, "src"));
  assert.strictEqual(Hero.applySafeImgSrc(img, "/assets/store/shop-interior-main.webp"), true);
  assert.strictEqual(img.attrs.src, "/assets/store/shop-interior-main.webp");
});

test("Admin Hero CSS guards overflow", () => {
  assert.match(adminCss, /#heroAdminCard\{overflow-x:hidden\}/);
  assert.match(adminCss, /#heroAdminCard,#heroAdminCard \*\{min-width:0\}/);
  assert.match(adminCss, /grid-template-columns:72px minmax\(0,1fr\)/);
});

test("SQL file is present and not rewritten by this simplification", () => {
  assert.ok(sqlStat.size > 1000);
  assert.match(sql, /origin = 'repo' AND repo_key = 'main'/);
});

const asyncTests = [];

asyncTests.push(test("settings load NULL as defaults and save only 5 keys on id=1", async () => {
  const db = createMemoryDb();
  const ctl = controller(db);
  const loaded = await ctl.loadSettings();
  assert.strictEqual(loaded.ok, true);
  assert.strictEqual(loaded.form.trust_line, Hero.DEFAULT_TRUST_LINE);
  assert.strictEqual(loaded.form.body, Hero.DEFAULT_BODY);
  const saved = await ctl.saveSettings({
    trust_line: Hero.DEFAULT_TRUST_LINE,
    body: "خاس چۈشەندۈرۈش",
    rotation_interval_seconds: 15
  });
  assert.strictEqual(saved.ok, true);
  assert.strictEqual(db.settings.trust_line, null);
  assert.strictEqual(db.settings.body, "خاس چۈشەندۈرۈش");
  assert.strictEqual(db.settings.rotation_interval_seconds, 15);
  assert.strictEqual(db.settings.updated_by, "user-1");
  assert.strictEqual(db.settings.eyebrow, "LOCKED");
  assert.strictEqual(db.settings.primary_label, "LOCKED");
  assert.strictEqual(db.settings.primary_href, "#books");
  assert.strictEqual(db.settings.secondary_href, "#about");
  const updates = db.log.filter((x) => x.table === "store_hero_settings" && x.action === "update");
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].filters.id, 1);
  assert.deepStrictEqual(Object.keys(updates[0].payload).sort(), ["body", "rotation_interval_seconds", "trust_line", "updated_at", "updated_by"]);
  assert.ok(!Object.prototype.hasOwnProperty.call(updates[0].payload, "eyebrow"));
  assert.ok(!Object.prototype.hasOwnProperty.call(updates[0].payload, "primary_label"));
  assert.ok(!Object.prototype.hasOwnProperty.call(updates[0].payload, "primary_href"));
  assert.ok(!Object.prototype.hasOwnProperty.call(updates[0].payload, "secondary_label"));
  assert.ok(!Object.prototype.hasOwnProperty.call(updates[0].payload, "secondary_href"));
  assert.ok(!db.log.some((x) => x.table === "store_hero_settings" && x.action === "insert"));
}));

asyncTests.push(test("opening Admin performs no write", async () => {
  const db = createMemoryDb();
  const ctl = controller(db);
  await ctl.loadSettings();
  await ctl.loadSlides();
  assert.ok(db.log.every((x) => x.action === "select" || x.action == null));
  assert.ok(!db.log.some((x) => x.action === "update" || x.action === "insert" || x.action === "delete" || x.op === "upload"));
  assert.strictEqual(ctl.state.writes.settings, 0);
  assert.strictEqual(ctl.state.writes.upload, 0);
}));

asyncTests.push(test("staged file and restore perform no write until Save", async () => {
  const db = createMemoryDb();
  const ctl = controller(db);
  await ctl.loadSlides();
  ctl.setPendingFile(1, fakeFile("image/jpeg", 10));
  ctl.stageRestore(2);
  assert.ok(!db.log.some((x) => x.op === "upload" || x.action === "update" || x.action === "insert"));
  assert.strictEqual(ctl.effectiveSlotSrc(ctl.state.slots[0]), "blob:hero-preview");
  assert.strictEqual(ctl.effectiveSlotSrc(ctl.state.slots[1]), "/assets/store/shop-interior-library.webp");
}));

asyncTests.push(test("first custom upload: upload then disabled insert then enable upload then disable repo", async () => {
  const db = createMemoryDb();
  const ctl = controller(db);
  await ctl.loadSlides();
  ctl.setPendingFile(1, fakeFile("image/png", 20, "user-name.PNG"));
  const res = await ctl.saveAll(saveFields());
  assert.strictEqual(res.ok, true);
  const uploadIdx = db.log.findIndex((x) => x.op === "upload");
  const insertIdx = db.log.findIndex((x) => x.table === "store_hero_store_slides" && x.action === "insert");
  const repoDisableIdx = db.log.findIndex((x) => x.table === "store_hero_store_slides" && x.action === "update" && x.filters.id === "repo-main" && x.payload.enabled === false);
  const uploadEnableIdx = db.log.findIndex((x) => x.table === "store_hero_store_slides" && x.action === "update" && x.filters.id === "upload-1" && x.payload.enabled === true);
  assert.ok(uploadIdx >= 0 && insertIdx > uploadIdx && uploadEnableIdx > insertIdx && repoDisableIdx > uploadEnableIdx);
  assert.strictEqual(db.log[insertIdx].payload.enabled, false);
  assert.strictEqual(db.log[insertIdx].payload.origin, "upload");
  assert.strictEqual(db.log[insertIdx].payload.repo_key, null);
  assert.strictEqual(db.log[insertIdx].payload.sort_order, 0);
  assert.strictEqual(db.log[uploadIdx].path, managedPath(1, "png"));
  const repo = db.slides.find((row) => row.id === "repo-main");
  const upload = db.slides.find((row) => row.origin === "upload");
  assert.strictEqual(repo.enabled, false);
  assert.strictEqual(upload.enabled, true);
  assert.strictEqual(db.slides.filter((row) => row.origin === "repo").length, 3);
}));

asyncTests.push(test("first custom: upload enable fails and repo was never disabled", async () => {
  const db = createMemoryDb({ failEnableUpload: true });
  const ctl = controller(db);
  await ctl.loadSlides();
  ctl.setPendingFile(1, fakeFile("image/jpeg", 11));
  const res = await ctl.saveAll(saveFields());
  assert.strictEqual(res.ok, false);
  const repo = db.slides.find((row) => row.id === "repo-main");
  assert.strictEqual(repo.enabled, true);
  assert.ok(!db.log.some((x) => x.table === "store_hero_store_slides" && x.action === "update" && x.filters.id === "repo-main" && x.payload && x.payload.enabled === false));
  const enabledUploads = db.slides.filter((row) => row.origin === "upload" && row.enabled === true);
  assert.strictEqual(enabledUploads.length, 0);
}));

asyncTests.push(test("first custom: repo disable fails and upload rollback cleans safely", async () => {
  const db = createMemoryDb({ failDisableRepo: true });
  const ctl = controller(db);
  await ctl.loadSlides();
  ctl.setPendingFile(1, fakeFile("image/jpeg", 11));
  const res = await ctl.saveAll(saveFields());
  assert.strictEqual(res.ok, false);
  const repo = db.slides.find((row) => row.id === "repo-main");
  assert.strictEqual(repo.enabled, true);
  assert.ok(!db.slides.some((row) => row.origin === "upload"));
  const removed = db.log.filter((x) => x.op === "remove").flatMap((x) => x.paths);
  assert.ok(removed.includes(managedPath(1, "jpg")));
  const enableIdx = db.log.findIndex((x) => x.action === "update" && x.filters.id === "upload-1" && x.payload.enabled === true);
  const rollbackIdx = db.log.findIndex((x) => x.action === "update" && x.filters.id === "upload-1" && x.payload.enabled === false);
  const delIdx = db.log.findIndex((x) => x.action === "delete" && x.filters.id === "upload-1");
  const remIdx = db.log.findIndex((x) => x.op === "remove" && x.paths && x.paths[0] === managedPath(1, "jpg"));
  assert.ok(enableIdx >= 0 && rollbackIdx > enableIdx && delIdx > rollbackIdx && remIdx > delIdx);
}));

asyncTests.push(test("first custom: repo disable and upload rollback both fail keeps both enabled", async () => {
  const db = createMemoryDb({ failDisableRepo: true, failDisableUpload: true });
  const ctl = controller(db);
  await ctl.loadSlides();
  ctl.setPendingFile(1, fakeFile("image/webp", 11));
  const res = await ctl.saveAll(saveFields());
  assert.strictEqual(res.ok, false);
  const repo = db.slides.find((row) => row.id === "repo-main");
  const upload = db.slides.find((row) => row.origin === "upload");
  assert.strictEqual(repo.enabled, true);
  assert.ok(upload);
  assert.strictEqual(upload.enabled, true);
  assert.ok(db.storageFiles.has(managedPath(1, "webp")));
  const removed = db.log.filter((x) => x.op === "remove").flatMap((x) => x.paths);
  assert.ok(!removed.includes(managedPath(1, "webp")));
  assert.strictEqual(db.slides.filter((row) => row.origin === "repo").length, 3);
}));

asyncTests.push(test("disabled managed replacement: enable fail keeps repo and does not delete a referenced object", async () => {
  const oldPath = "hero/store-slides/slot-1-00000000-1111-2222-3333-444444444444.jpg";
  const oldUrl = "https://example.supabase.co/storage/v1/object/public/book-covers/" + oldPath;
  const db = createMemoryDb({
    failEnableUpload: true,
    slides: repoSlides().concat([{
      id: "custom-1",
      enabled: false,
      sort_order: 0,
      origin: "upload",
      repo_key: null,
      image_url: oldUrl,
      object_path: oldPath,
      created_at: "2026-01-01T00:00:00.000Z"
    }])
  });
  db.storageFiles.set(oldPath, fakeFile("image/jpeg", 10));
  const ctl = controller(db);
  await ctl.loadSlides();
  ctl.setPendingFile(1, fakeFile("image/png", 12));
  const res = await ctl.saveAll(saveFields());
  assert.strictEqual(res.ok, false);
  const repo = db.slides.find((row) => row.id === "repo-main");
  const custom = db.slides.find((row) => row.id === "custom-1");
  assert.strictEqual(repo.enabled, true);
  assert.strictEqual(custom.enabled, false);
  assert.strictEqual(custom.object_path, oldPath);
  assert.ok(db.storageFiles.has(oldPath));
  const newPath = managedPath(1, "png");
  const livePaths = db.slides.map((row) => row.object_path).filter(Boolean);
  assert.ok(!livePaths.includes(newPath));
  const removed = db.log.filter((x) => x.op === "remove").flatMap((x) => x.paths);
  assert.ok(removed.includes(newPath));
  assert.ok(!removed.includes(oldPath));
  assert.ok(!db.log.some((x) => x.filters && x.filters.id === "repo-main" && x.payload && x.payload.enabled === false));
}));

asyncTests.push(test("disabled managed replacement: repo disable and custom rollback fail keeps both enabled", async () => {
  const oldPath = "hero/store-slides/slot-1-00000000-1111-2222-3333-444444444444.jpg";
  const db = createMemoryDb({
    failDisableRepo: true,
    failDisableUpload: true,
    slides: repoSlides().concat([{
      id: "custom-1",
      enabled: false,
      sort_order: 0,
      origin: "upload",
      repo_key: null,
      image_url: "https://example.supabase.co/storage/v1/object/public/book-covers/" + oldPath,
      object_path: oldPath,
      created_at: "2026-01-01T00:00:00.000Z"
    }])
  });
  db.storageFiles.set(oldPath, fakeFile("image/jpeg", 10));
  const ctl = controller(db);
  await ctl.loadSlides();
  ctl.setPendingFile(1, fakeFile("image/webp", 12));
  const res = await ctl.saveAll(saveFields());
  assert.strictEqual(res.ok, false);
  const repo = db.slides.find((row) => row.id === "repo-main");
  const custom = db.slides.find((row) => row.id === "custom-1");
  const newPath = managedPath(1, "webp");
  assert.strictEqual(repo.enabled, true);
  assert.strictEqual(custom.enabled, true);
  assert.strictEqual(custom.object_path, newPath);
  assert.ok(db.storageFiles.has(newPath));
  const removed = db.log.filter((x) => x.op === "remove").flatMap((x) => x.paths);
  assert.ok(!removed.includes(newPath));
}));

asyncTests.push(test("replacement uploads new then updates DB then cleans old object", async () => {
  const oldPath = "hero/store-slides/slot-1-00000000-1111-2222-3333-444444444444.jpg";
  const db = createMemoryDb({
    slides: [
      { id: "repo-main", enabled: false, sort_order: 0, origin: "repo", repo_key: "main", image_url: null, object_path: null, created_at: "2020-01-01T00:00:00.000Z" },
      { id: "repo-library", enabled: true, sort_order: 1, origin: "repo", repo_key: "library", image_url: null, object_path: null, created_at: "2020-01-01T00:00:00.000Z" },
      { id: "repo-exterior", enabled: true, sort_order: 2, origin: "repo", repo_key: "exterior", image_url: null, object_path: null, created_at: "2020-01-01T00:00:00.000Z" },
      {
        id: "custom-1",
        enabled: true,
        sort_order: 0,
        origin: "upload",
        repo_key: null,
        image_url: "https://example.supabase.co/storage/v1/object/public/book-covers/" + oldPath,
        object_path: oldPath,
        created_at: "2026-01-01T00:00:00.000Z"
      }
    ]
  });
  db.storageFiles.set(oldPath, fakeFile("image/jpeg", 10));
  const ctl = controller(db);
  await ctl.loadSlides();
  ctl.setPendingFile(1, fakeFile("image/webp", 12));
  const res = await ctl.saveAll({
    trust_line: Hero.DEFAULT_TRUST_LINE,
    body: Hero.DEFAULT_BODY,
    rotation_interval_seconds: 7
  });
  assert.strictEqual(res.ok, true);
  const uploadIdx = db.log.findIndex((x) => x.op === "upload");
  const updateIdx = db.log.findIndex((x) => x.table === "store_hero_store_slides" && x.action === "update" && x.filters.id === "custom-1");
  const removeIdx = db.log.findIndex((x) => x.op === "remove" && x.paths && x.paths[0] === oldPath);
  assert.ok(uploadIdx >= 0 && updateIdx > uploadIdx && removeIdx > updateIdx);
  const custom = db.slides.find((row) => row.id === "custom-1");
  assert.strictEqual(custom.object_path, managedPath(1, "webp"));
}));

asyncTests.push(test("failed replacement keeps old object and cleans the new one", async () => {
  const oldPath = "hero/store-slides/slot-1-00000000-1111-2222-3333-444444444444.jpg";
  const db = createMemoryDb({
    zeroRowUpdate: true,
    slides: [
      { id: "repo-main", enabled: false, sort_order: 0, origin: "repo", repo_key: "main", created_at: "2020-01-01T00:00:00.000Z" },
      { id: "repo-library", enabled: true, sort_order: 1, origin: "repo", repo_key: "library", created_at: "2020-01-01T00:00:00.000Z" },
      { id: "repo-exterior", enabled: true, sort_order: 2, origin: "repo", repo_key: "exterior", created_at: "2020-01-01T00:00:00.000Z" },
      { id: "custom-1", enabled: true, sort_order: 0, origin: "upload", repo_key: null, object_path: oldPath, image_url: "https://example.supabase.co/x.jpg", created_at: "2026-01-01T00:00:00.000Z" }
    ]
  });
  db.storageFiles.set(oldPath, fakeFile("image/jpeg", 10));
  const ctl = controller(db);
  await ctl.loadSlides();
  ctl.setPendingFile(1, fakeFile("image/png", 12));
  const res = await ctl.saveAll({
    trust_line: Hero.DEFAULT_TRUST_LINE,
    body: Hero.DEFAULT_BODY,
    rotation_interval_seconds: 7
  });
  assert.strictEqual(res.ok, false);
  assert.ok(db.storageFiles.has(oldPath));
  const removed = db.log.filter((x) => x.op === "remove").flatMap((x) => x.paths);
  assert.ok(removed.includes(managedPath(1, "png")));
  assert.ok(!removed.includes(oldPath));
  assert.strictEqual(db.slides.find((row) => row.id === "custom-1").object_path, oldPath);
}));

asyncTests.push(test("restore disables custom, enables repo, deletes row, then storage", async () => {
  const oldPath = "hero/store-slides/slot-3-bbbbbbbb-cccc-dddd-eeee-ffffffffffff.webp";
  const db = createMemoryDb({
    slides: [
      { id: "repo-main", enabled: true, sort_order: 0, origin: "repo", repo_key: "main", created_at: "2020-01-01T00:00:00.000Z" },
      { id: "repo-library", enabled: true, sort_order: 1, origin: "repo", repo_key: "library", created_at: "2020-01-01T00:00:00.000Z" },
      { id: "repo-exterior", enabled: false, sort_order: 2, origin: "repo", repo_key: "exterior", created_at: "2020-01-01T00:00:00.000Z" },
      { id: "custom-3", enabled: true, sort_order: 2, origin: "upload", repo_key: null, object_path: oldPath, image_url: "https://example.supabase.co/x.webp", created_at: "2026-01-01T00:00:00.000Z" }
    ]
  });
  db.storageFiles.set(oldPath, fakeFile("image/webp", 10));
  const ctl = controller(db);
  await ctl.loadSlides();
  ctl.stageRestore(3);
  const res = await ctl.saveAll({
    trust_line: Hero.DEFAULT_TRUST_LINE,
    body: Hero.DEFAULT_BODY,
    rotation_interval_seconds: 7
  });
  assert.strictEqual(res.ok, true);
  const disableIdx = db.log.findIndex((x) => x.action === "update" && x.filters.id === "custom-3" && x.payload.enabled === false);
  const repoIdx = db.log.findIndex((x) => x.action === "update" && x.filters.id === "repo-exterior" && x.payload.enabled === true);
  const delIdx = db.log.findIndex((x) => x.action === "delete" && x.filters.id === "custom-3");
  const remIdx = db.log.findIndex((x) => x.op === "remove" && x.paths && x.paths[0] === oldPath);
  assert.ok(disableIdx >= 0 && repoIdx > disableIdx && delIdx > repoIdx && remIdx > delIdx);
  assert.ok(!db.slides.some((row) => row.id === "custom-3"));
  assert.strictEqual(db.slides.find((row) => row.id === "repo-exterior").enabled, true);
  assert.strictEqual(db.slides.filter((row) => row.origin === "repo").length, 3);
}));

asyncTests.push(test("failed repo re-enable restores custom row", async () => {
  const oldPath = "hero/store-slides/slot-2-bbbbbbbb-cccc-dddd-eeee-ffffffffffff.jpg";
  const db = createMemoryDb({
    failEnableRepo: true,
    slides: [
      { id: "repo-main", enabled: true, sort_order: 0, origin: "repo", repo_key: "main", created_at: "2020-01-01T00:00:00.000Z" },
      { id: "repo-library", enabled: false, sort_order: 1, origin: "repo", repo_key: "library", created_at: "2020-01-01T00:00:00.000Z" },
      { id: "repo-exterior", enabled: true, sort_order: 2, origin: "repo", repo_key: "exterior", created_at: "2020-01-01T00:00:00.000Z" },
      { id: "custom-2", enabled: true, sort_order: 1, origin: "upload", repo_key: null, object_path: oldPath, image_url: "https://example.supabase.co/x.jpg", created_at: "2026-01-01T00:00:00.000Z" }
    ]
  });
  const ctl = controller(db);
  await ctl.loadSlides();
  ctl.stageRestore(2);
  const res = await ctl.saveAll({
    trust_line: Hero.DEFAULT_TRUST_LINE,
    body: Hero.DEFAULT_BODY,
    rotation_interval_seconds: 7
  });
  assert.strictEqual(res.ok, false);
  const custom = db.slides.find((row) => row.id === "custom-2");
  assert.ok(custom);
  assert.strictEqual(custom.enabled, true);
  assert.ok(db.log.every((x) => x.op !== "remove"));
}));

asyncTests.push(test("zero-row UPDATE is not success", async () => {
  const db = createMemoryDb({ zeroRowUpdate: true });
  const ctl = controller(db);
  const res = await ctl.saveSettings({
    trust_line: "قوللىنىلمىسۇن",
    body: Hero.DEFAULT_BODY,
    rotation_interval_seconds: 7
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, "not_applied");
  assert.match(res.message, /قوللىنىلمىدى/);
  assert.strictEqual(db.settings.trust_line, null);
}));

asyncTests.push(test("zero-row DELETE is not success and skips storage", async () => {
  const oldPath = "hero/store-slides/slot-1-bbbbbbbb-cccc-dddd-eeee-ffffffffffff.jpg";
  const db = createMemoryDb({
    zeroRowDelete: true,
    slides: [
      { id: "repo-main", enabled: false, sort_order: 0, origin: "repo", repo_key: "main", created_at: "2020-01-01T00:00:00.000Z" },
      { id: "repo-library", enabled: true, sort_order: 1, origin: "repo", repo_key: "library", created_at: "2020-01-01T00:00:00.000Z" },
      { id: "repo-exterior", enabled: true, sort_order: 2, origin: "repo", repo_key: "exterior", created_at: "2020-01-01T00:00:00.000Z" },
      { id: "custom-1", enabled: true, sort_order: 0, origin: "upload", repo_key: null, object_path: oldPath, image_url: "https://example.supabase.co/x.jpg", created_at: "2026-01-01T00:00:00.000Z" }
    ]
  });
  db.storageFiles.set(oldPath, fakeFile("image/jpeg", 10));
  const ctl = controller(db);
  await ctl.loadSlides();
  ctl.stageRestore(1);
  const res = await ctl.saveAll({
    trust_line: Hero.DEFAULT_TRUST_LINE,
    body: Hero.DEFAULT_BODY,
    rotation_interval_seconds: 7
  });
  assert.ok(res.ok === false || (res.slotResults && res.slotResults[0].result.cleanupFailed));
  assert.ok(db.storageFiles.has(oldPath));
  assert.ok(db.slides.some((row) => row.id === "custom-1"));
}));

asyncTests.push(test("storage delete refuses any non managed store-slides path", async () => {
  const db = createMemoryDb();
  const ctl = controller(db);
  const refused = [
    "books/1/cover.jpg",
    "hero/campaigns/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg",
    "assets/store/shop-interior-main.webp",
    "/hero/store-slides/slot-1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg",
    "hero/store-slides/../slot-1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg",
    "hero/store-slides/slot-1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.svg"
  ];
  for (const p of refused) {
    const res = await ctl.safeRemoveObject(p);
    assert.strictEqual(res.ok, false, p);
  }
  assert.ok(!db.log.some((x) => x.op === "remove"));
}));

asyncTests.push(test("repo rows are never deleted", async () => {
  const db = createMemoryDb();
  const ctl = controller(db);
  await ctl.loadSlides();
  ctl.setPendingFile(1, fakeFile("image/jpeg", 10));
  await ctl.saveAll({
    trust_line: Hero.DEFAULT_TRUST_LINE,
    body: Hero.DEFAULT_BODY,
    rotation_interval_seconds: 7
  });
  const deleted = db.log.filter((x) => x.table === "store_hero_store_slides" && x.action === "delete");
  assert.ok(deleted.every((x) => x.filters.id !== "repo-main" && x.filters.id !== "repo-library" && x.filters.id !== "repo-exterior"));
  assert.strictEqual(db.slides.filter((row) => row.origin === "repo").length, 3);
}));

asyncTests.push(test("thrown Storage upload is caught and only the new path is cleaned", async () => {
  const oldPath = "hero/store-slides/slot-1-00000000-1111-2222-3333-444444444444.jpg";
  const db = createMemoryDb({
    uploadThrow: true,
    slides: [
      { id: "repo-main", enabled: false, sort_order: 0, origin: "repo", repo_key: "main", created_at: "2020-01-01T00:00:00.000Z" },
      { id: "repo-library", enabled: true, sort_order: 1, origin: "repo", repo_key: "library", created_at: "2020-01-01T00:00:00.000Z" },
      { id: "repo-exterior", enabled: true, sort_order: 2, origin: "repo", repo_key: "exterior", created_at: "2020-01-01T00:00:00.000Z" },
      { id: "custom-1", enabled: true, sort_order: 0, origin: "upload", repo_key: null, object_path: oldPath, image_url: "https://example.supabase.co/x.jpg", created_at: "2026-01-01T00:00:00.000Z" }
    ]
  });
  db.storageFiles.set(oldPath, fakeFile("image/jpeg", 10));
  const ctl = controller(db);
  const res = await ctl.uploadHeroImage(1, fakeFile("image/jpeg", 11));
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, "upload_throw");
  assert.ok(db.storageFiles.has(oldPath));
  const removed = db.log.filter((x) => x.op === "remove").flatMap((x) => x.paths);
  assert.ok(removed.includes(managedPath(1, "jpg")));
  assert.ok(!removed.includes(oldPath));
}));

Promise.all(asyncTests.filter(Boolean)).then(() => {
  if (failed) {
    console.error(failed + " failed");
    process.exit(1);
  }
  console.log("admin-hero-tests ok");
});
