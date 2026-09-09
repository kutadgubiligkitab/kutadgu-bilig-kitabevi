"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const AboutPublic = require(path.join(root, "home-about-content.js"));
const AboutAdmin = require(path.join(root, "admin-about.js"));
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const adminHero = fs.readFileSync(path.join(root, "admin-hero.js"), "utf8");
const adminAbout = fs.readFileSync(path.join(root, "admin-about.js"), "utf8");
const homeAbout = fs.readFileSync(path.join(root, "home-about-content.js"), "utf8");
const sql = fs.readFileSync(path.join(root, "SITE_HOMEPAGE_ABOUT.sql"), "utf8");
const shopCss = fs.readFileSync(path.join(root, "shop.css"), "utf8");
const identityCss = fs.readFileSync(path.join(root, "stage3-shop-identity.css"), "utf8");

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, err && err.message);
  }
}

const FIELDS = AboutPublic.FIELDS;

function createMemoryDb(opts) {
  opts = opts || {};
  const log = [];
  let row = opts.missing
    ? null
    : {
        id: 1,
        content: Object.assign({}, AboutAdmin.FALLBACK, opts.content || {})
      };
  const selectError = opts.selectError || null;
  const updateError = opts.updateError || null;

  function from(table) {
    const q = { table, filters: {}, payload: null, action: "select" };
    const api = {
      select() { return api; },
      eq(key, value) { q.filters[key] = value; return api; },
      insert(payload) { q.action = "insert"; q.payload = payload; return api; },
      update(payload) { q.action = "update"; q.payload = payload; return api; },
      maybeSingle: async function () {
        log.push({ table: q.table, action: q.action, payload: q.payload, filters: Object.assign({}, q.filters) });
        if (q.action === "select") {
          if (selectError) return { data: null, error: selectError };
          return { data: row ? { id: row.id, content: Object.assign({}, row.content) } : null, error: null };
        }
        if (q.action === "update") {
          if (updateError) return { data: null, error: updateError };
          if (!row) return { data: null, error: null };
          row = { id: 1, content: Object.assign({}, q.payload.content) };
          return { data: { id: 1 }, error: null };
        }
        if (q.action === "insert") {
          row = { id: 1, content: Object.assign({}, q.payload.content) };
          return { data: { id: 1 }, error: null };
        }
        return { data: null, error: null };
      }
    };
    return api;
  }

  return { from, log, getRow: () => row };
}

async function run() {
  await test("SQL is a singleton About object and does not alter store_settings", () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.store_homepage_about/);
    assert.match(sql, /content jsonb NOT NULL/);
    assert.match(sql, /CONSTRAINT store_homepage_about_singleton CHECK \(id = 1\)/);
    assert.match(sql, /GRANT SELECT ON TABLE public\.store_homepage_about TO anon, authenticated/);
    assert.match(sql, /GRANT INSERT, UPDATE ON TABLE public\.store_homepage_about TO authenticated/);
    assert.doesNotMatch(sql, /DELETE ON TABLE public\.store_homepage_about/);
    assert.doesNotMatch(sql, /ALTER TABLE public\.store_settings/);
    assert.doesNotMatch(sql, /INSERT INTO public\.store_settings/);
    assert.doesNotMatch(sql, /jsonb_build_object\(\s*'year'/);
    assert.match(sql, /Founding year 2013 is not stored/);
    assert.match(sql, /aal2 required to insert store_homepage_about/);
    assert.match(sql, /aal2 required to update store_homepage_about/);
    assert.match(sql, /MANUAL \/ REVIEWED APPLY ONLY/);
  });

  await test("index.html keeps About design hooks and fallback copy", () => {
    assert.match(indexHtml, /class="about about-pro"/);
    assert.match(indexHtml, /class="about-year-badge"/);
    assert.match(indexHtml, /class="about-intro"/);
    assert.match(indexHtml, /class="about-story"/);
    assert.match(indexHtml, /class="about-closing"/);
    assert.match(indexHtml, /class="about-service-chips"/);
    assert.match(indexHtml, /class="about-service-chip"/);
    assert.match(indexHtml, /<span class="about-year-badge">2013<\/span>/);
    assert.doesNotMatch(indexHtml, /data-about-field="year"/);
    assert.match(indexHtml, /data-about-field="title"/);
    assert.match(indexHtml, /data-about-field="chip1"/);
    assert.match(indexHtml, /data-about-field="chip2"/);
    assert.match(indexHtml, /data-about-field="chip3"/);
    assert.match(indexHtml, />2013</);
    assert.match(indexHtml, /بىز ھەققىدە/);
    assert.match(indexHtml, /كىتاب ۋە ئوقۇش قوراللىرى سېتىش/);
    assert.match(indexHtml, /كىتاب ئارىيەت بېرىش/);
    assert.match(indexHtml, /كۈتۈپخانا/);
    assert.match(indexHtml, /home-about-content\.js\?v=1/);
  });

  await test("About CSS families remain and this PR does not edit global About styles", () => {
    assert.match(identityCss, /\.about-year-badge\{/);
    assert.match(identityCss, /\.about-service-chips\{/);
    assert.match(shopCss, /\.about-pro/);
    const out = execSync("git diff --name-only origin/main -- shop.css stage3-shop-identity.css mobile.css index.css theme.css", {
      cwd: root,
      encoding: "utf8"
    });
    assert.strictEqual(out.trim(), "");
  });

  await test("public overlay uses textContent only and restores fallback on failure", () => {
    assert.match(homeAbout, /el\.textContent = next/);
    assert.doesNotMatch(homeAbout, /innerHTML/);
    assert.deepStrictEqual(AboutPublic.FIELDS, ["title", "intro", "paragraph1", "paragraph2", "closing", "chip1", "chip2", "chip3"]);
    assert.ok(!AboutPublic.FIELDS.includes("year"));
    const dirty = AboutPublic.normalizeContent({
      year: "2014<script>",
      title: "تېست",
      chip1: "بىر",
      chip2: "ئىككى",
      chip3: "ئۈچ"
    });
    assert.strictEqual(dirty.year, undefined);
    assert.strictEqual(dirty.chip1, "بىر");
    const nodes = {};
    const fallback = AboutAdmin.FALLBACK;
    FIELDS.forEach((name) => {
      nodes[name] = { textContent: fallback[name] };
    });
    const yearBadge = { textContent: "2013" };
    const section = {
      querySelector(sel) {
        if (String(sel).indexOf('data-about-field="year"') >= 0) return yearBadge;
        const match = String(sel).match(/data-about-field="([^"]+)"/);
        return match ? nodes[match[1]] : null;
      }
    };
    const prev = global.document;
    global.document = {
      querySelector(sel) {
        if (String(sel).indexOf("about") >= 0) return section;
        return null;
      }
    };
    try {
      AboutPublic.applyContent({}, fallback);
      assert.strictEqual(nodes.chip1.textContent, fallback.chip1);
      AboutPublic.applyContent({
        chip1: "A",
        chip2: "B",
        chip3: "C",
        year: "2015",
        title: "ت",
        intro: "i",
        paragraph1: "p1",
        paragraph2: "p2",
        closing: "c"
      }, fallback);
      assert.strictEqual(nodes.chip1.textContent, "A");
      assert.strictEqual(nodes.chip2.textContent, "B");
      assert.strictEqual(nodes.chip3.textContent, "C");
      assert.strictEqual(yearBadge.textContent, "2013");
    } finally {
      global.document = prev;
    }
  });

  await test("Admin button opens a single editor and Save writes all three chips", async () => {
    assert.match(adminAbout, /بىز ھەققىدە خەتلىرىنى ئۆزگەرتىش/);
    assert.match(adminAbout, /id = "aboutSaveBtn"/);
    assert.match(adminAbout, /aboutEditModal/);
    assert.doesNotMatch(adminAbout, /\.innerHTML\s*=/);
    assert.match(adminHero, /admin-about\.js\?v=1/);
    assert.match(adminHero, /attachHomepageAboutAdmin/);
    assert.match(adminAbout, /aboutEditBtn/);
    assert.doesNotMatch(adminAbout, /aboutField_year/);
    assert.doesNotMatch(adminAbout, /year: "يىل"/);

    const saved = {
      title: "تېست ماۋزۇ",
      intro: "كىرىش",
      paragraph1: "ئابزاس1",
      paragraph2: "ئابزاس2",
      closing: "ئاخىرى",
      chip1: "سېتىش تېستى",
      chip2: "ئارىيەت تېستى",
      chip3: "كۈتۈپخانا تېستى"
    };
    const db = createMemoryDb({ content: saved });
    const ctl = AboutAdmin.createAboutAdminController({
      getDb: () => db,
      getUser: () => ({ id: "11111111-1111-1111-1111-111111111111" })
    });
    const loaded = await ctl.load();
    assert.equal(loaded.ok, true);
    assert.strictEqual(loaded.content.chip1, "سېتىش تېستى");
    assert.strictEqual(loaded.content.chip2, "ئارىيەت تېستى");
    assert.strictEqual(loaded.content.chip3, "كۈتۈپخانا تېستى");
    assert.strictEqual(loaded.content.year, undefined);

    const next = Object.assign({}, saved, { chip1: "يېڭى 1", chip2: "يېڭى 2", chip3: "يېڭى 3", year: "1999" });
    const res = await ctl.save(next);
    assert.equal(res.ok, true);
    assert.strictEqual(res.content.chip1, "يېڭى 1");
    assert.strictEqual(res.content.chip2, "يېڭى 2");
    assert.strictEqual(res.content.chip3, "يېڭى 3");
    assert.strictEqual(res.content.year, undefined);
    assert.strictEqual(db.getRow().content.chip1, "يېڭى 1");
    assert.strictEqual(db.getRow().content.year, undefined);
    assert.ok(db.log.some((x) => x.action === "update"));
  });

  await test("settings load failure keeps fallback copy", async () => {
    const db = createMemoryDb({
      selectError: { code: "PGRST205", message: "Could not find the table" }
    });
    const ctl = AboutAdmin.createAboutAdminController({
      getDb: () => db,
      getUser: () => ({ id: "11111111-1111-1111-1111-111111111111" })
    });
    const loaded = await ctl.load();
    assert.equal(loaded.ok, false);
    assert.equal(loaded.missing, true);
    assert.strictEqual(loaded.content.title, AboutAdmin.FALLBACK.title);
    assert.strictEqual(loaded.content.chip3, AboutAdmin.FALLBACK.chip3);
  });

  if (failed) {
    console.error("\n" + failed + " homepage-about-editor test(s) failed");
    process.exit(1);
  }
  console.log("homepage-about-editor-tests ok");
}

run();
