#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const Hours = require("../kutadgu-shop-hours.js");
const PublicHours = require("../store-hours-content.js");
const AdminHours = require("../admin-shop-hours.js");

let failed = 0;
function test(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === "function") {
      return out.then(() => console.log("PASS", name)).catch((err) => {
        failed += 1;
        console.error("FAIL", name, err && err.message);
      });
    }
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, err && err.message);
  }
}
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const sql = read("SITE_SHOP_HOURS.sql");
const maint = read("SITE_MAINTENANCE_MODE.sql");
const aboutSql = read("SITE_HOMEPAGE_ABOUT.sql");
const adminHtml = read("admin.html");
const adminJs = read("admin.js");
const indexHtml = read("index.html");
const cfg = read("supabase-config.js");
const staffHtml = read("book-staff.html");
const staffJs = read("book-staff.js");
const memberJs = read("member.js");
const isolation = read("scripts/auth-session-isolation-tests.js");
const helpers = read("tests/e2e/helpers.js");
const pending = [];

test("default hours match current Contact and JSON-LD fallback", () => {
  assert.deepStrictEqual(Hours.FALLBACK, {
    weekdayOpen: "08:30",
    weekdayClose: "20:00",
    sundayOpen: "10:30",
    sundayClose: "18:00"
  });
  const display = Hours.formatContactHours(null);
  assert.match(display.hoursText, /دۈشەنبە–شەنبە\n08:30–20:00\nيەكشەنبە\n10:30–18:00/);
  assert.deepStrictEqual(Hours.formatOpeningHours(null), ["Mo-Sa 08:30-20:00", "Su 10:30-18:00"]);
  assert.match(indexHtml, /دۈشەنبە–شەنبە\n<span dir="ltr">08:30–20:00<\/span>\nيەكشەنبە\n<span dir="ltr">10:30–18:00<\/span>/);
  assert.match(indexHtml, /"openingHours":\["Mo-Sa 08:30-20:00","Su 10:30-18:00"\]/);
  assert.match(cfg, /hours: "دۈشەنبە–شەنبە\\n08:30–20:00\\nيەكشەنبە\\n10:30–18:00"/);
});

test("validation accepts valid ranges and rejects missing/invalid/inverted times", () => {
  assert.strictEqual(Hours.validateHours(Hours.FALLBACK).ok, true);
  assert.strictEqual(Hours.validateHours({ ...Hours.FALLBACK, weekdayOpen: "" }).ok, false);
  assert.strictEqual(Hours.validateHours({ ...Hours.FALLBACK, sundayClose: "25:00" }).ok, false);
  assert.strictEqual(Hours.validateHours({ ...Hours.FALLBACK, weekdayOpen: "20:00", weekdayClose: "08:30" }).ok, false);
  assert.strictEqual(Hours.validateHours({ ...Hours.FALLBACK, sundayOpen: "18:00", sundayClose: "18:00" }).ok, false);
  const late = Hours.validateHours({ ...Hours.FALLBACK, weekdayClose: "20:00:00" });
  assert.strictEqual(late.ok, true);
  assert.strictEqual(late.hours.weekdayClose, "20:00");
});

pending.push(test("Admin controller loads and saves valid hours; invalid never writes", async () => {
  const row = { id: 1, content: Object.assign({}, Hours.FALLBACK) };
  const log = [];
  const db = {
    from(table) {
      const q = { table, action: "select", payload: null };
      const api = {
        select() { return api; },
        eq() { return api; },
        insert(payload) { q.action = "insert"; q.payload = payload; return api; },
        update(payload) { q.action = "update"; q.payload = payload; return api; },
        maybeSingle: async () => {
          log.push({ table: q.table, action: q.action, payload: q.payload });
          if (q.action === "select") return { data: { id: 1, content: Object.assign({}, row.content) }, error: null };
          if (q.action === "update") {
            row.content = Object.assign({}, q.payload.content);
            return { data: { id: 1 }, error: null };
          }
          return { data: { id: 1 }, error: null };
        }
      };
      return api;
    }
  };
  const ctl = AdminHours.createShopHoursAdminController({
    getDb: () => db,
    getUser: () => ({ id: "admin-1" })
  });
  const loaded = await ctl.load();
  assert.strictEqual(loaded.ok, true);
  assert.deepStrictEqual(loaded.hours.weekdayOpen, "08:30");
  const saved = await ctl.save({ weekdayOpen: "09:00", weekdayClose: "21:00", sundayOpen: "11:00", sundayClose: "17:00" });
  assert.strictEqual(saved.ok, true);
  assert.deepStrictEqual(saved.hours.weekdayOpen, "09:00");
  assert.ok(log.some((item) => item.table === "store_shop_hours" && item.action === "update"));
  const rejected = await ctl.save({ weekdayOpen: "20:00", weekdayClose: "08:30", sundayOpen: "11:00", sundayClose: "17:00" });
  assert.strictEqual(rejected.ok, false);
  assert.strictEqual(rejected.reason, "validation");
  assert.strictEqual(log.filter((item) => item.action === "update").length, 1);
}));

test("SQL is a singleton hours object and does not alter store_settings or About", () => {
  assert.match(sql, /MANUAL \/ REVIEWED APPLY ONLY/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.store_shop_hours/);
  assert.match(sql, /CONSTRAINT store_shop_hours_singleton CHECK \(id = 1\)/);
  assert.match(sql, /weekdayOpen', '08:30'/);
  assert.match(sql, /GRANT SELECT ON TABLE public\.store_shop_hours TO anon, authenticated/);
  assert.match(sql, /GRANT INSERT, UPDATE ON TABLE public\.store_shop_hours TO authenticated/);
  assert.doesNotMatch(sql, /GRANT INSERT, UPDATE ON TABLE public\.store_shop_hours TO anon/);
  assert.doesNotMatch(sql, /DELETE ON TABLE public\.store_shop_hours/);
  assert.doesNotMatch(sql, /service_role/);
  assert.doesNotMatch(sql, /is_kutadgu_book_staff/);
  assert.doesNotMatch(sql, /ALTER TABLE public\.store_settings/);
  assert.doesNotMatch(sql, /ALTER TABLE public\.store_homepage_about|INSERT INTO public\.store_homepage_about/);
  assert.match(sql, /is_kutadgu_admin\(\)/);
  assert.match(sql, /aal2 required to insert store_shop_hours/);
  assert.match(sql, /aal2 required to update store_shop_hours/);
  assert.match(sql, /AS RESTRICTIVE/);
  assert.match(maint, /value boolean NOT NULL DEFAULT false/);
  assert.match(aboutSql, /store_homepage_about/);
});

test("Book Staff, Member, and browser clients cannot write shop hours", () => {
  assert.doesNotMatch(staffJs, /store_shop_hours/);
  assert.doesNotMatch(staffHtml, /shopHoursSaveBtn|دۇكان ئىش ۋاقتى/);
  assert.doesNotMatch(memberJs, /store_shop_hours/);
  assert.doesNotMatch(adminJs, /service_role/);
  assert.doesNotMatch(read("admin-shop-hours.js"), /service_role/);
  assert.doesNotMatch(read("store-hours-content.js"), /service_role/);
});

test("Contact and JSON-LD share the formatter; public overlay fail-open", () => {
  const live = Hours.formatContactHours({ weekdayOpen: "09:15", weekdayClose: "19:45", sundayOpen: "12:00", sundayClose: "16:30" });
  const json = Hours.formatOpeningHours({ weekdayOpen: "09:15", weekdayClose: "19:45", sundayOpen: "12:00", sundayClose: "16:30" });
  assert.match(live.hoursHtml, /09:15–19:45/);
  assert.deepStrictEqual(json, ["Mo-Sa 09:15-19:45", "Su 12:00-16:30"]);
  assert.ok(PublicHours.applyHours);
  assert.ok(PublicHours.loadHours);
  assert.match(indexHtml, /store-hours-content\.js\?v=1/);
  assert.match(indexHtml, /kutadgu-shop-hours\.js\?v=1/);
  assert.match(indexHtml, /id="contactHoursText"/);
  assert.match(read("store-hours-content.js"), /store_shop_hours\?select=id,content/);
  assert.match(read("store-hours-content.js"), /openingHours/);
  assert.match(read("store-hours-content.js"), /res\.error\) return \{ ok: false \}/);
  assert.match(read("store-hours-content.js"), /kutadgu:catalog-ready/);
  assert.doesNotMatch(read("store-hours-content.js"), /method:\s*"PATCH"|method:\s*"POST"/);
});

test("Admin UI is Uyghur, storefront-only, and does not expose schema jargon", () => {
  assert.match(adminHtml, /id="shopHoursCard"/);
  assert.match(adminHtml, />دۇكان ئىش ۋاقتى</);
  assert.match(adminHtml, /id="shopHoursWeekdayOpen"/);
  assert.match(adminHtml, /id="shopHoursSundayClose"/);
  assert.match(adminHtml, /ئۆزگەرتىشلەرنى ساقلاش/);
  assert.match(read("admin-shop-hours.js"), /دۇكان ئىش ۋاقتى ساقلىنىپ بولدى/);
  const card = adminHtml.slice(adminHtml.indexOf('id="shopHoursCard"'), adminHtml.indexOf('id="booksCard"'));
  assert.doesNotMatch(card, /jsonb|RLS|AAL2|store_shop_hours|NULL|service_role/);
  assert.match(adminHtml, /data-admin-section-panel="storefront"/);
  assert.match(read("admin-hero.js"), /bindShopHoursAdmin/);
  assert.match(read("admin.css"), /#shopHoursCard/);
});

test("e2e helper stubs hours reads as missing and blocks writes", () => {
  assert.match(helpers, /store_shop_hours/);
  assert.match(isolation, /kutadgu-admin-auth-v1/);
});

Promise.all(pending.filter(Boolean)).then(() => {
  if (failed) {
    console.error("\n" + failed + " stage97 shop hours test(s) failed");
    process.exit(1);
  }
  console.log("stage97-shop-hours-tests ok");
});
