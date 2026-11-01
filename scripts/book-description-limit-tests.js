#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const root = path.join(__dirname, "..");
const TOO_LONG = "كىتاب ھەققىدە 5,000 ھەرپتىن ئېشىپ كەتمىسۇن.";
const MEMBER_TOO_LONG = "كىتاب ھەققىدە 10,000 ھەرپتىن ئېشىپ كەتمىسۇن.";
const MEMBERSHIP_UNKNOWN = "يۈرۈشلۈك ئەزالىقى تەكشۈرۈلمىدى. چۈشەندۈرۈش ساقلىمىدى.";
const HELP_ORDINARY = "قىسقىچە چۈشەندۈرۈش. ئەڭ كۆپ 5,000 ھەرپ.";
const HELP_MEMBER = "قىسقىچە چۈشەندۈرۈش. ئەڭ كۆپ 10,000 ھەرپ.";
const HELP_FAILED = "يۈرۈشلۈك ئەزالىقى تەكشۈرۈلمىدى.";
const SHORT = "قىسقا چۈشەندۈرۈش.\n\nداۋامى.";
const COVER = "https://www.kutadgubilik.com/__r2/book-covers/book/1788094203015.webp";

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function uyghurDescription(length) {
  const paragraph = "بۇ كىتاب ئۇيغۇرچە چۈشەندۈرۈش.\n\nئىككىنچى ئابزاس. ";
  let text = "";
  while (text.length + paragraph.length <= length) text += paragraph;
  const letters = "ئابپتجخدرزسشغفقكلمنھوېى";
  let index = 0;
  while (text.length < length) {
    text += letters[index % letters.length];
    index += 1;
  }
  return text;
}

function staticChecks() {
  const adminHtml = read("admin.html");
  const staffHtml = read("book-staff.html");
  const shop = read("shop.js");
  const form = adminHtml.slice(adminHtml.indexOf('id="bookDescription"'), adminHtml.indexOf('id="bookPrice"'));
  assert.match(form, /id="bookDescription"/);
  assert.doesNotMatch(form, /maxlength=/);
  assert.match(form, /id="bookDescriptionHelp"/);
  assert.match(form, /قىسقىچە چۈشەندۈرۈش\. ئەڭ كۆپ 5,000 ھەرپ\./);
  assert.match(form, /id="bookDescriptionCount"/);
  const adminJs = read("admin.js");
  assert.match(adminJs, /admin_preview_book_volume_members/);
  assert.match(adminJs, /p_book_id:id,p_isbn:null/);
  assert.match(adminJs, /BOOK_DESCRIPTION_MEMBER_LIMIT=10000/);
  assert.match(adminHtml, /volumeSeriesDescription" rows="4" maxlength="10000"/);
  assert.match(adminHtml, /volumeGroupDescription" rows="4" maxlength="10000"/);
  assert.ok(adminHtml.includes("admin.js?v=" + require("./ci-asset-pins").assetPin("admin.js")));
  assert.doesNotMatch(staffHtml, /id="staffDescription"[^>]*maxlength=/);
  assert.match(staffHtml, /id="staffDescriptionCount"/);
  assert.match(staffHtml, /book-staff\.js\?v=14/);
  assert.match(shop, /paintDetailDescription\(desc,b\.description\|\|""\)/);
  assert.match(shop, /paragraph\.textContent=raw/);
  assert.doesNotMatch(shop, /b\.description\.slice|description\.slice\(0,\s*1200\)|description\.slice\(0,\s*5000\)/);
  const exact = uyghurDescription(5000);
  const over = uyghurDescription(5001);
  assert.strictEqual(exact.length, 5000);
  assert.strictEqual(over.length, 5001);
  assert.ok(exact.includes("\n\n"));
  assert.strictEqual(over.slice(0, 5000), exact);
  return { exact, over };
}

function counted(length) {
  return String(length).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

async function waitForKnownLimit(page, length, limit, help) {
  const countText = counted(length) + " / " + counted(limit);
  await page.waitForFunction(({ countText, help }) => {
    const count = document.querySelector("#bookDescriptionCount");
    const note = document.querySelector("#bookDescriptionHelp");
    return count && count.textContent === countText && note && note.textContent === help;
  }, { countText, help });
}

async function setDescription(page, value) {
  await page.locator("#bookDescription").evaluate((el, next) => {
    el.value = next;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function submitBook(page) {
  await page.evaluate(() => { window.__writes = []; window.__alerts = []; });
  await page.locator("#bookForm button[type=submit]").click();
}

function startStaticServer() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = path.resolve(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(file, (error, body) => {
      if (error) {
        res.writeHead(404);
        res.end("missing");
        return;
      }
      res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function adminPage(browser, origin) {
  const context = await browser.newContext();
  await context.addInitScript((cover) => {
    window.__cover = cover;
    window.__alerts = [];
    window.__writes = [];
    window.alert = (message) => { window.__alerts.push(String(message)); };
    window.__kutadguSkipAdminAuth = true;
    window.__creditRows = { data: [], error: null };
    window.__book = null;
    window.__kutadguAdminFetchBook = (id) => {
      if (window.__books && window.__books[String(id)]) return window.__books[String(id)];
      return window.__book;
    };
    window.__membershipMode = "ordinary";
    window.__memberIds = [];
    window.__membershipDelay = 0;
    window.__kutadguAdminPersistBook = async (payload, op) => {
      window.__writes.push({ kind: "book", payload, op });
      return { error: null, data: [{ id: window.__book && window.__book.id }] };
    };
    function chain(result) {
      const self = {
        select() { return self; },
        eq() { return self; },
        neq() { return self; },
        or() { return self; },
        in() { return self; },
        order() { return self; },
        not() { return self; },
        limit() { return self; },
        range() { return self; },
        maybeSingle() { return self; },
        update(payload) { window.__writes.push({ kind: "update", payload }); return self; },
        insert(payload) { window.__writes.push({ kind: "insert", payload }); return self; },
        delete() { return self; },
        then(ok, fail) { return Promise.resolve(result).then(ok, fail); }
      };
      return self;
    }
    window.__kutadguAnalyticsDb = {
      from() { return chain({ data: [], error: null }); },
      rpc(name, args) {
        window.__writes.push({ kind: "rpc", name, args });
        if (name === "admin_get_book_volume_group") {
          return Promise.resolve(window.__volumeGroup
            ? { data: window.__volumeGroup, error: null }
            : { data: null, error: { message: "missing group" } });
        }
        if (name !== "admin_preview_book_volume_members") {
          return Promise.resolve({ data: null, error: null });
        }
        const respond = () => {
          const mode = window.__membershipMode || "ordinary";
          const id = args && args.p_book_id;
          if (mode === "fail") return { data: null, error: { message: "lookup failed" } };
          if (mode === "empty") return { data: [], error: null };
          const member = mode === "member" || (Array.isArray(window.__memberIds) && window.__memberIds.map(String).includes(String(id)));
          return {
            data: [{ book_id: Number(id), group_id: member ? 7 : null, group_slug: member ? "saved-set" : null }],
            error: null
          };
        };
        const finish = () => {
          const delay = Number(window.__membershipDelay) || 0;
          if (delay > 0) return new Promise((resolve) => setTimeout(() => resolve(respond()), delay));
          return Promise.resolve(respond());
        };
        if (window.__membershipHold) return Promise.resolve(window.__membershipHold).then(finish);
        return finish();
      },
      auth: {
        onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
        getSession() {
          return Promise.resolve({ data: { session: { access_token: "isolated-admin-access-token" } }, error: null });
        }
      }
    };
  }, COVER);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(origin + "/admin.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__kutadguAdminTest && document.querySelector("#bookDescription"));
  return page;
}

async function main() {
  const samples = staticChecks();
  console.log("PASS static description limits");
  const { chromium } = require("@playwright/test");
  const server = await startStaticServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await adminPage(browser, origin);
    const source = await page.$eval("#bookSource", (el) => (el.options[1] && el.options[1].value) || "");
    assert.ok(source);
    await page.evaluate(({ source, description }) => {
      window.__book = {
        id: 106,
        title: "يۈزمىڭلىغان نېمە ئۈچۈن",
        author: "تۇرمۇش ساۋاتلىرى",
        source,
        category: "ئەدەبىيات",
        price: 42,
        stock: 3,
        image_url: window.__cover,
        is_active: true,
        language: "ug",
        description,
        sales_count: 0
      };
    }, { source, description: SHORT });
    await page.evaluate(() => window.__kutadguAdminTest.openEdit(106));
    await page.waitForFunction((expected) => document.querySelector("#bookDescription").value === expected, SHORT);
    await waitForKnownLimit(page, SHORT.length, 5000, HELP_ORDINARY);
    await submitBook(page);
    await page.waitForFunction(() => window.__writes.some((entry) => entry.kind === "book") || window.__alerts.length, null, { timeout: 30000 });
    const shortSave = await page.evaluate(() => ({
      alerts: window.__alerts.slice(),
      write: window.__writes.find((entry) => entry.kind === "book")
    }));
    assert.deepStrictEqual(shortSave.alerts, []);
    assert.strictEqual(shortSave.write.op, "UPDATE");
    assert.strictEqual(shortSave.write.payload.description, SHORT);
    assert.strictEqual(shortSave.write.payload.title, "يۈزمىڭلىغان نېمە ئۈچۈن");
    assert.strictEqual(shortSave.write.payload.price, 42);
    if (Object.prototype.hasOwnProperty.call(shortSave.write.payload, "stock")) {
      assert.strictEqual(shortSave.write.payload.stock, 3);
    }
    assert.strictEqual(shortSave.write.payload.image_url, "https://www.kutadgubilik.com/__r2/book-covers/book/1788094203015.webp");

    await page.evaluate(() => window.__kutadguAdminTest.openEdit(106));
    await page.waitForFunction((expected) => {
      const field = document.querySelector("#bookDescription");
      const modal = document.querySelector("#bookModal");
      return field && field.value === expected && modal && !modal.hidden;
    }, SHORT);
    await setDescription(page, samples.exact);
    await waitForKnownLimit(page, 5000, 5000, HELP_ORDINARY);
    await page.evaluate((description) => { window.__book.description = description; }, samples.exact);
    await submitBook(page);
    await page.waitForFunction(() => window.__writes.some((entry) => entry.kind === "book") || window.__alerts.length, null, { timeout: 30000 });
    const fullSave = await page.evaluate(() => ({
      alerts: window.__alerts.slice(),
      write: window.__writes.find((entry) => entry.kind === "book")
    }));
    assert.deepStrictEqual(fullSave.alerts, []);
    assert.strictEqual(fullSave.write.payload.description, samples.exact);
    assert.ok(fullSave.write.payload.description.includes("\n\n"));
    await page.evaluate(() => window.__kutadguAdminTest.openEdit(106));
    await page.waitForFunction((expected) => document.querySelector("#bookDescription").value === expected, samples.exact);
    assert.strictEqual(await page.locator("#bookDescription").inputValue(), samples.exact);

    const writesBeforeReject = await page.evaluate(() => window.__writes.length);
    await setDescription(page, samples.over);
    assert.strictEqual(await page.locator("#bookDescription").inputValue(), samples.over);
    await waitForKnownLimit(page, 5001, 5000, HELP_ORDINARY);
    await page.evaluate(() => { window.__alerts = []; });
    await page.locator("#bookForm button[type=submit]").click();
    await page.waitForFunction(() => window.__alerts.length > 0);
    const rejected = await page.evaluate(() => ({
      alerts: window.__alerts.slice(),
      value: document.querySelector("#bookDescription").value,
      writes: window.__writes.length
    }));
    assert.deepStrictEqual(rejected.alerts, [TOO_LONG]);
    assert.strictEqual(rejected.value, samples.over);
    assert.strictEqual(rejected.writes, writesBeforeReject);
    console.log("PASS admin description save, reopen, and rejection");

    const seriesDescription = uyghurDescription(10000);
    const pendingDescription = uyghurDescription(20000);
    await page.evaluate(({ source, description }) => {
      window.__book = {
        id: 220,
        title: "يۈرۈشلۈك قىسىم",
        author: "ئاپتور",
        source,
        category: "ئەدەبىيات",
        price: 42,
        pages: 80,
        stock: 3,
        image_url: window.__cover,
        is_active: true,
        language: "ug",
        description,
        sales_count: 0
      };
      window.__kutadguAdminPersistPending = async (bookId, payload) => {
        window.__writes.push({ kind: "pending", bookId, payload });
        return { error: null };
      };
    }, { source, description: seriesDescription });
    await page.evaluate(() => window.__kutadguAdminTest.openEdit(220));
    await page.waitForFunction((expected) => {
      const field = document.querySelector("#bookDescription");
      const modal = document.querySelector("#bookModal");
      return field && field.value === expected && modal && !modal.hidden;
    }, seriesDescription);
    await waitForKnownLimit(page, 10000, 5000, HELP_ORDINARY);
    await page.locator("#bookPrice").fill("55");
    if (await page.locator("#bookPages").isVisible()) await page.locator("#bookPages").fill("96");
    await page.evaluate(() => { window.__writes = []; window.__alerts = []; });
    await page.locator("#bookForm button[type=submit]").click();
    await page.waitForFunction(() => window.__writes.some((entry) => entry.kind === "book") || window.__alerts.length, null, { timeout: 30000 });
    const seriesSave = await page.evaluate(() => ({
      alerts: window.__alerts.slice(),
      write: window.__writes.find((entry) => entry.kind === "book")
    }));
    assert.deepStrictEqual(seriesSave.alerts, []);
    assert.ok(seriesSave.write);
    assert.strictEqual(seriesSave.write.payload.price, 55);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(seriesSave.write.payload, "description"), false);
    if (Object.prototype.hasOwnProperty.call(seriesSave.write.payload, "pages")) {
      assert.strictEqual(seriesSave.write.payload.pages, 96);
    }
    await page.evaluate(() => window.__kutadguAdminTest.openEdit(220));
    await page.waitForFunction((expected) => document.querySelector("#bookDescription").value === expected, seriesDescription);
    const changedSeries = seriesDescription.slice(0, -1) + "ا";
    await setDescription(page, changedSeries);
    const seriesWrites = await page.evaluate(() => window.__writes.length);
    await page.evaluate(() => { window.__alerts = []; });
    await page.locator("#bookForm button[type=submit]").click();
    await page.waitForFunction(() => window.__alerts.length > 0);
    const seriesRejected = await page.evaluate(() => ({
      alerts: window.__alerts.slice(),
      value: document.querySelector("#bookDescription").value,
      writes: window.__writes.length
    }));
    assert.deepStrictEqual(seriesRejected.alerts, [TOO_LONG]);
    assert.strictEqual(seriesRejected.value, changedSeries);
    assert.strictEqual(seriesRejected.writes, seriesWrites);
    console.log("PASS unchanged ordinary over-limit description stays stored");

    await page.evaluate(({ source, description }) => {
      window.__book = {
        id: 221,
        title: "خادىم تەكلىپى",
        author: "ئاپتور",
        source,
        category: "ئەدەبىيات",
        price: 18,
        pages: 40,
        stock: 2,
        image_url: window.__cover,
        is_active: false,
        submission_status: "pending",
        language: "ug",
        description,
        sales_count: 0
      };
    }, { source, description: pendingDescription });
    await page.evaluate(() => window.__kutadguAdminTest.openEdit(221));
    await page.waitForFunction((expected) => document.querySelector("#bookDescription").value === expected, pendingDescription);
    await page.locator("#bookPrice").fill("21");
    await page.evaluate(() => { window.__writes = []; window.__alerts = []; });
    await page.locator("#bookForm button[type=submit]").click();
    await page.waitForFunction(() => window.__writes.some((entry) => entry.kind === "pending") || window.__alerts.length, null, { timeout: 30000 });
    const pendingSave = await page.evaluate(() => ({
      alerts: window.__alerts.slice(),
      write: window.__writes.find((entry) => entry.kind === "pending")
    }));
    assert.deepStrictEqual(pendingSave.alerts, []);
    assert.ok(pendingSave.write);
    assert.strictEqual(pendingSave.write.payload.price, 21);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(pendingSave.write.payload, "description"), false);
    await page.evaluate(() => window.__kutadguAdminTest.openEdit(221));
    await page.waitForFunction((expected) => document.querySelector("#bookDescription").value === expected, pendingDescription);
    console.log("PASS unchanged pending description stays stored");

    const memberDescription = uyghurDescription(9000);
    const memberShorter = uyghurDescription(8000);
    const memberFull = uyghurDescription(10000);
    const memberOver = uyghurDescription(10001);
    await page.evaluate(({ source, description }) => {
      window.__membershipMode = "ordinary";
      window.__membershipDelay = 0;
      window.__memberIds = ["330"];
      window.__book = {
        id: 330,
        title: "ئادەتتىكى نام",
        author: "ئاپتور",
        source,
        category: "ئەدەبىيات",
        price: 42,
        pages: 80,
        stock: 3,
        image_url: window.__cover,
        is_active: true,
        language: "ug",
        description,
        sales_count: 0
      };
      window.__volumeGroup = {
        id: 7,
        revision: 1,
        slug: "saved-set",
        title: "ساقلانغان يۈرۈشلۈك",
        author: "ئاپتور",
        category: "ئەدەبىيات",
        source,
        description: "گۇرۇپپا چۈشەندۈرۈشى",
        is_public: false,
        is_active: true,
        representative_book_id: 330,
        members: [{ book_id: 330, title: "ئادەتتىكى نام", author: "ئاپتور", price: 42, stock: 3, image_url: window.__cover, volume_label: "1-قىسىم" }]
      };
    }, { source, description: memberDescription });
    await page.evaluate(() => { window.__writes = []; });
    await page.evaluate(() => window.__kutadguAdminTest.openEdit(330));
    await page.waitForFunction((expected) => document.querySelector("#bookDescription").value === expected, memberDescription);
    await waitForKnownLimit(page, 9000, 10000, HELP_MEMBER);
    const directLookup = await page.evaluate(() => window.__writes.filter((entry) => entry.kind === "rpc" && entry.name === "admin_preview_book_volume_members"));
    assert.ok(directLookup.some((entry) => String(entry.args.p_book_id) === "330" && entry.args.p_isbn == null));
    await setDescription(page, memberShorter);
    await waitForKnownLimit(page, 8000, 10000, HELP_MEMBER);
    await submitBook(page);
    await page.waitForFunction(() => window.__writes.some((entry) => entry.kind === "book") || window.__alerts.length, null, { timeout: 30000 });
    const shorterSave = await page.evaluate(() => ({
      alerts: window.__alerts.slice(),
      write: window.__writes.find((entry) => entry.kind === "book")
    }));
    assert.deepStrictEqual(shorterSave.alerts, []);
    assert.strictEqual(shorterSave.write.payload.description.length, 8000);
    assert.strictEqual(shorterSave.write.payload.description, memberShorter);
    assert.strictEqual(shorterSave.write.payload.price, 42);

    await page.evaluate((description) => {
      window.__book.description = description;
      window.__kutadguAdminTest.openEdit(330);
    }, memberDescription);
    await page.waitForFunction((expected) => document.querySelector("#bookDescription").value === expected, memberDescription);
    await waitForKnownLimit(page, 9000, 10000, HELP_MEMBER);
    await setDescription(page, memberFull);
    await submitBook(page);
    await page.waitForFunction(() => window.__writes.some((entry) => entry.kind === "book") || window.__alerts.length, null, { timeout: 30000 });
    const fullMemberSave = await page.evaluate(() => ({
      alerts: window.__alerts.slice(),
      write: window.__writes.find((entry) => entry.kind === "book")
    }));
    assert.deepStrictEqual(fullMemberSave.alerts, []);
    assert.strictEqual(fullMemberSave.write.payload.description.length, 10000);
    assert.strictEqual(fullMemberSave.write.payload.description, memberFull);

    await page.evaluate((description) => {
      window.__book.description = description;
      window.__kutadguAdminTest.openEdit(330);
    }, memberDescription);
    await page.waitForFunction((expected) => document.querySelector("#bookDescription").value === expected, memberDescription);
    await waitForKnownLimit(page, 9000, 10000, HELP_MEMBER);
    await setDescription(page, memberOver);
    const memberWrites = await page.evaluate(() => window.__writes.length);
    await page.evaluate(() => { window.__alerts = []; });
    await page.locator("#bookForm button[type=submit]").click();
    await page.waitForFunction(() => window.__alerts.length > 0);
    const memberRejected = await page.evaluate(() => ({
      alerts: window.__alerts.slice(),
      value: document.querySelector("#bookDescription").value,
      writes: window.__writes.length,
      help: document.querySelector("#bookDescriptionHelp").textContent,
      count: document.querySelector("#bookDescriptionCount").textContent
    }));
    assert.deepStrictEqual(memberRejected.alerts, [MEMBER_TOO_LONG]);
    assert.strictEqual(memberRejected.value, memberOver);
    assert.strictEqual(memberRejected.writes, memberWrites);
    assert.strictEqual(memberRejected.help, HELP_MEMBER);
    assert.strictEqual(memberRejected.count, "10,001 / 10,000");
    console.log("PASS saved member description accepts 8,000 and 10,000 and rejects 10,001");

    await page.locator("#cancelBookEdit").click();
    await page.evaluate(() => { window.__writes = []; });
    const volumeApi = await page.evaluate(() => {
      const api = window.KutadguAdminVolumeGroups;
      if (!api || typeof api.init !== "function" || typeof api.openGroup !== "function") return false;
      api.init({ db: window.__kutadguAnalyticsDb });
      return true;
    });
    assert.strictEqual(volumeApi, true);
    await page.evaluate(() => window.KutadguAdminVolumeGroups.openGroup(7));
    await page.waitForSelector("[data-member-edit='330']", { state: "attached" });
    await page.evaluate(() => document.querySelector("[data-member-edit='330']").click());
    await page.waitForFunction((expected) => {
      const field = document.querySelector("#bookDescription");
      const modal = document.querySelector("#bookModal");
      return field && field.value === expected && modal && !modal.hidden;
    }, memberDescription);
    await waitForKnownLimit(page, 9000, 10000, HELP_MEMBER);
    const buttonLookup = await page.evaluate(() => window.__writes.filter((entry) => entry.kind === "rpc" && entry.name === "admin_preview_book_volume_members"));
    assert.ok(buttonLookup.some((entry) => String(entry.args.p_book_id) === "330" && entry.args.p_isbn == null));
    console.log("PASS direct edit and member button use the same 10,000 limit");

    await page.evaluate(({ source, description }) => {
      window.__membershipMode = "fail";
      window.__memberIds = [];
      window.__book = {
        id: 601,
        title: "يۈرۈشلۈك قىسىم",
        author: "ئاپتور",
        source,
        category: "ئەدەبىيات",
        price: 42,
        pages: 80,
        stock: 3,
        image_url: window.__cover,
        is_active: true,
        language: "ug",
        description,
        sales_count: 0
      };
    }, { source, description: memberShorter });
    await page.evaluate(() => window.__kutadguAdminTest.openEdit(601));
    await page.waitForFunction((expected) => document.querySelector("#bookDescription").value === expected, memberShorter);
    await page.waitForFunction((help) => {
      const note = document.querySelector("#bookDescriptionHelp");
      const count = document.querySelector("#bookDescriptionCount");
      return note && note.textContent === help && count && count.textContent === "8,000" && !note.textContent.includes("5,000") && !note.textContent.includes("10,000");
    }, HELP_FAILED);
    await page.locator("#bookPrice").fill("64");
    await submitBook(page);
    await page.waitForFunction(() => window.__writes.some((entry) => entry.kind === "book") || window.__alerts.length, null, { timeout: 30000 });
    const failedUnchanged = await page.evaluate(() => ({
      alerts: window.__alerts.slice(),
      write: window.__writes.find((entry) => entry.kind === "book")
    }));
    assert.deepStrictEqual(failedUnchanged.alerts, []);
    assert.ok(failedUnchanged.write);
    assert.strictEqual(failedUnchanged.write.payload.price, 64);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(failedUnchanged.write.payload, "description"), false);
    await page.evaluate(() => window.__kutadguAdminTest.openEdit(601));
    await page.waitForFunction((expected) => document.querySelector("#bookDescription").value === expected, memberShorter);
    await page.waitForFunction((help) => document.querySelector("#bookDescriptionHelp").textContent === help, HELP_FAILED);
    await setDescription(page, memberShorter.slice(0, 7000));
    const failedBookWrites = await page.evaluate(() => window.__writes.filter((entry) => entry.kind === "book" || entry.kind === "pending").length);
    await page.evaluate(() => { window.__alerts = []; });
    await page.locator("#bookForm button[type=submit]").click();
    await page.waitForFunction(() => window.__alerts.length > 0);
    const failedLookup = await page.evaluate(() => ({
      alerts: window.__alerts.slice(),
      value: document.querySelector("#bookDescription").value,
      bookWrites: window.__writes.filter((entry) => entry.kind === "book" || entry.kind === "pending").length,
      help: document.querySelector("#bookDescriptionHelp").textContent
    }));
    assert.deepStrictEqual(failedLookup.alerts, [MEMBERSHIP_UNKNOWN]);
    assert.strictEqual(failedLookup.value.length, 7000);
    assert.strictEqual(failedLookup.bookWrites, failedBookWrites);
    assert.ok(!failedLookup.help.includes("5,000") && !failedLookup.help.includes("10,000"));
    await page.evaluate(() => { window.__membershipMode = "empty"; });
    await page.evaluate(() => { window.__alerts = []; });
    await page.locator("#bookForm button[type=submit]").click();
    await page.waitForFunction(() => window.__alerts.length > 0);
    const emptyLookup = await page.evaluate(() => ({
      alerts: window.__alerts.slice(),
      value: document.querySelector("#bookDescription").value,
      help: document.querySelector("#bookDescriptionHelp").textContent
    }));
    assert.deepStrictEqual(emptyLookup.alerts, [MEMBERSHIP_UNKNOWN]);
    assert.strictEqual(emptyLookup.value.length, 7000);
    assert.ok(!emptyLookup.alerts[0].includes("5,000") && !emptyLookup.alerts[0].includes("10,000"));
    console.log("PASS failed membership lookup does not apply either cap");

    await page.evaluate(({ source }) => {
      window.__membershipMode = "ordinary";
      window.__membershipDelay = 250;
      window.__memberIds = ["401"];
      window.__books = {
        401: {
          id: 401,
          title: "ئەزا",
          author: "ئاپتور",
          source,
          category: "ئەدەبىيات",
          price: 42,
          stock: 3,
          image_url: window.__cover,
          is_active: true,
          language: "ug",
          description: "ئەزا چۈشەندۈرۈشى",
          sales_count: 0
        },
        402: {
          id: 402,
          title: "ئادەتتىكى",
          author: "ئاپتور",
          source,
          category: "ئەدەبىيات",
          price: 11,
          stock: 1,
          image_url: window.__cover,
          is_active: true,
          language: "ug",
          description: "ئادەتتىكى چۈشەندۈرۈش",
          sales_count: 0
        }
      };
    }, { source });
    await page.evaluate(() => {
      window.__kutadguAdminTest.openEdit(401);
      window.__kutadguAdminTest.openEdit(402);
    });
    await page.waitForFunction(() => document.querySelector("#bookDescription").value === "ئادەتتىكى چۈشەندۈرۈش");
    await waitForKnownLimit(page, "ئادەتتىكى چۈشەندۈرۈش".length, 5000, HELP_ORDINARY);
    await page.waitForTimeout(400);
    await waitForKnownLimit(page, "ئادەتتىكى چۈشەندۈرۈش".length, 5000, HELP_ORDINARY);
    console.log("PASS a stale membership lookup does not change the open book");

    await page.evaluate((source) => {
      window.__membershipDelay = 300;
      window.__memberIds = ["501"];
      window.__books = null;
      window.__book = {
        id: 501,
        title: "ساقلانغان ئەزا",
        author: "ئاپتور",
        source,
        category: "ئەدەبىيات",
        price: 42,
        stock: 3,
        image_url: window.__cover,
        is_active: true,
        language: "ug",
        description: "قىسقا",
        sales_count: 0
      };
    }, source);
    const earlyMember = uyghurDescription(5001);
    await page.evaluate(() => window.__kutadguAdminTest.openEdit(501));
    await page.waitForFunction(() => document.querySelector("#bookDescription").value === "قىسقا");
    await setDescription(page, earlyMember);
    await submitBook(page);
    await page.waitForFunction(() => window.__writes.some((entry) => entry.kind === "book") || window.__alerts.length, null, { timeout: 30000 });
    const earlyMemberSave = await page.evaluate(() => ({
      alerts: window.__alerts.slice(),
      write: window.__writes.find((entry) => entry.kind === "book")
    }));
    assert.deepStrictEqual(earlyMemberSave.alerts, []);
    assert.strictEqual(earlyMemberSave.write.payload.description.length, 5001);

    await page.evaluate((source) => {
      window.__membershipDelay = 300;
      window.__memberIds = [];
      window.__book = {
        id: 502,
        title: "يۈرۈشلۈك قىسىم",
        author: "ئاپتور",
        source,
        category: "ئەدەبىيات",
        price: 42,
        stock: 3,
        image_url: window.__cover,
        is_active: true,
        language: "ug",
        description: "قىسقا",
        sales_count: 0
      };
    }, source);
    await page.evaluate(() => window.__kutadguAdminTest.openEdit(502));
    await page.waitForFunction(() => document.querySelector("#bookDescription").value === "قىسقا");
    await setDescription(page, earlyMember);
    const earlyOrdinaryWrites = await page.evaluate(() => window.__writes.length);
    await page.evaluate(() => { window.__alerts = []; });
    await page.locator("#bookForm button[type=submit]").click();
    await page.waitForFunction(() => window.__alerts.length > 0, null, { timeout: 30000 });
    const earlyOrdinary = await page.evaluate(() => ({
      alerts: window.__alerts.slice(),
      value: document.querySelector("#bookDescription").value,
      writes: window.__writes.length
    }));
    assert.deepStrictEqual(earlyOrdinary.alerts, [TOO_LONG]);
    assert.strictEqual(earlyOrdinary.value, earlyMember);
    assert.strictEqual(earlyOrdinary.writes, earlyOrdinaryWrites);
    await page.evaluate(() => { window.__membershipDelay = 0; window.__membershipMode = "ordinary"; });
    console.log("PASS an in-flight lookup is awaited before choosing the limit");

    await page.evaluate((source) => window.__kutadguAdminTest.openNew(), source);
    await page.selectOption("#bookSource", source);
    await page.locator("#bookTitle").fill("يېڭى ئادەتتىكى كىتاب");
    await page.locator("#bookAuthor").fill("ئاپتور");
    await setDescription(page, samples.over);
    await waitForKnownLimit(page, 5001, 5000, HELP_ORDINARY);
    await page.locator("#bookPrice").fill("12");
    const stock = page.locator("#bookStock");
    if (await stock.count() && await stock.isVisible()) await stock.fill("1");
    const createMembership = await page.evaluate(() => window.__writes.filter((entry) => entry.kind === "rpc" && entry.name === "admin_preview_book_volume_members").length);
    await page.evaluate(() => { window.__alerts = []; });
    await page.locator("#bookForm button[type=submit]").click();
    await page.waitForFunction(() => window.__alerts.length > 0);
    const createRejected = await page.evaluate(() => ({
      alerts: window.__alerts.slice(),
      value: document.querySelector("#bookDescription").value,
      membershipCalls: window.__writes.filter((entry) => entry.kind === "rpc" && entry.name === "admin_preview_book_volume_members").length
    }));
    assert.deepStrictEqual(createRejected.alerts, [TOO_LONG]);
    assert.strictEqual(createRejected.value, samples.over);
    assert.strictEqual(createRejected.membershipCalls, createMembership);
    console.log("PASS ordinary create stays at 5,000 without a membership lookup");

    const raced = uyghurDescription(8000);
    await page.evaluate(() => {
      window.__membershipMode = "ordinary";
      window.__membershipDelay = 0;
      window.__memberIds = [];
      window.__membershipHold = new Promise((resolve) => { window.__releaseMembership = resolve; });
      window.__planResult = null;
    });
    await page.evaluate((source) => {
      window.__book = {
        id: 801,
        title: "كىتاب A",
        author: "ئاپتور",
        source,
        category: "ئەدەبىيات",
        price: 42,
        stock: 3,
        image_url: window.__cover,
        is_active: true,
        language: "ug",
        description: "قىسقا",
        sales_count: 0
      };
    }, source);
    await page.evaluate(() => window.__kutadguAdminTest.openEdit(801));
    await page.waitForFunction(() => document.querySelector("#bookDescriptionHelp").textContent.includes("تەكشۈرۈلۈۋاتىدۇ"));
    await page.evaluate((text) => {
      window.__planResult = null;
      window.__kutadguAdminTest.bookDescriptionSavePlan(text).then((result) => { window.__planResult = result; });
    }, raced);
    await page.waitForFunction(() => window.__writes.some((entry) => entry.kind === "rpc" && entry.name === "admin_preview_book_volume_members" && String(entry.args.p_book_id) === "801"));
    await page.evaluate(() => {
      window.__kutadguAdminTest.setEditingBookForTest({
        id: 802,
        title: "كىتاب B",
        author: "ئاپتور",
        description: "ئەزا",
        price: 70
      }, { bookId: "802", status: "ready", limit: 10000, member: true });
    });
    await page.evaluate(() => window.__releaseMembership());
    await page.waitForFunction(() => window.__planResult);
    const racedPlan = await page.evaluate(() => window.__planResult);
    assert.strictEqual(racedPlan.ok, false);
    assert.strictEqual(racedPlan.reason, "stale");
    console.log("PASS description validation stays bound to the original book");

    await page.evaluate((source) => {
      window.__membershipHold = new Promise((resolve) => { window.__releaseMembership = resolve; });
      window.__memberIds = ["812"];
      window.__books = {
        811: {
          id: 811,
          title: "كىتاب A",
          author: "ئاپتور",
          source,
          category: "ئەدەبىيات",
          price: 42,
          stock: 3,
          image_url: window.__cover,
          is_active: true,
          language: "ug",
          description: "قىسقا",
          sales_count: 0
        },
        812: {
          id: 812,
          title: "كىتاب B",
          author: "ئاپتور",
          source,
          category: "ئەدەبىيات",
          price: 19,
          stock: 4,
          image_url: window.__cover,
          is_active: true,
          language: "ug",
          description: "ئەزا چۈشەندۈرۈشى",
          sales_count: 0
        }
      };
      window.__book = null;
    }, source);
    await page.evaluate(() => window.__kutadguAdminTest.openEdit(811));
    await page.waitForFunction(() => document.querySelector("#bookTitle").value === "كىتاب A");
    await setDescription(page, raced);
    const racedWrites = await page.evaluate(() => window.__writes.filter((entry) => entry.kind === "book" || entry.kind === "pending").length);
    await page.evaluate(() => { window.__alerts = []; document.querySelector("#bookForm").requestSubmit(); });
    await page.waitForFunction(() => window.__kutadguAdminTest.bookSaveValidationPending());
    await page.evaluate(() => {
      document.querySelector("#bookForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.strictEqual(await page.evaluate(() => window.__alerts.length), 0);
    await page.locator("#cancelBookEdit").click();
    await page.evaluate(() => window.__kutadguAdminTest.openEdit(812));
    await page.waitForFunction(() => document.querySelector("#bookTitle").value === "كىتاب B" && !document.querySelector("#bookModal").hidden);
    await page.locator("#bookTitle").fill("باقىدىغان نام");
    await page.locator("#bookPrice").fill("77");
    await setDescription(page, "بەش");
    await page.evaluate(() => window.__releaseMembership());
    await page.waitForTimeout(200);
    const afterSwitch = await page.evaluate(() => ({
      alerts: window.__alerts.slice(),
      hidden: document.querySelector("#bookModal").hidden,
      title: document.querySelector("#bookTitle").value,
      price: document.querySelector("#bookPrice").value,
      description: document.querySelector("#bookDescription").value,
      pending: window.__kutadguAdminTest.bookSaveValidationPending(),
      disabled: document.querySelector("#bookSaveBtn").disabled,
      writes: window.__writes.filter((entry) => entry.kind === "book" || entry.kind === "pending").length
    }));
    assert.deepStrictEqual(afterSwitch.alerts, []);
    assert.strictEqual(afterSwitch.hidden, false);
    assert.strictEqual(afterSwitch.title, "باقىدىغان نام");
    assert.strictEqual(afterSwitch.price, "77");
    assert.strictEqual(afterSwitch.description, "بەش");
    assert.strictEqual(afterSwitch.pending, false);
    assert.strictEqual(afterSwitch.disabled, false);
    assert.strictEqual(afterSwitch.writes, racedWrites);
    console.log("PASS closing A and opening B drops the pending save");

    await page.evaluate((source) => {
      window.__membershipHold = new Promise((resolve) => { window.__releaseMembership = resolve; });
      window.__membershipMode = "ordinary";
      window.__memberIds = [];
      window.__books = null;
      window.__book = {
        id: 821,
        title: "تەكرار ساقلاش",
        author: "ئاپتور",
        source,
        category: "ئەدەبىيات",
        price: 15,
        stock: 2,
        image_url: window.__cover,
        is_active: true,
        language: "ug",
        description: "قىسقا",
        sales_count: 0
      };
    }, source);
    await page.evaluate(() => window.__kutadguAdminTest.openEdit(821));
    await page.waitForFunction(() => document.querySelector("#bookTitle").value === "تەكرار ساقلاش");
    await setDescription(page, raced);
    const repeatWrites = await page.evaluate(() => window.__writes.filter((entry) => entry.kind === "book" || entry.kind === "pending").length);
    await page.evaluate(() => {
      window.__alerts = [];
      const form = document.querySelector("#bookForm");
      form.requestSubmit();
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() => window.__kutadguAdminTest.bookSaveValidationPending());
    await page.evaluate(() => window.__releaseMembership());
    await page.waitForFunction(() => window.__alerts.length > 0);
    const repeated = await page.evaluate(() => ({
      alerts: window.__alerts.slice(),
      value: document.querySelector("#bookDescription").value,
      writes: window.__writes.filter((entry) => entry.kind === "book" || entry.kind === "pending").length,
      pending: window.__kutadguAdminTest.bookSaveValidationPending(),
      disabled: document.querySelector("#bookSaveBtn").disabled
    }));
    assert.deepStrictEqual(repeated.alerts, [TOO_LONG]);
    assert.strictEqual(repeated.value, raced);
    assert.strictEqual(repeated.writes, repeatWrites);
    assert.strictEqual(repeated.pending, false);
    assert.strictEqual(repeated.disabled, false);
    await page.evaluate(() => { window.__membershipHold = null; window.__membershipMode = "ordinary"; });
    console.log("PASS repeated save clicks during lookup wait once");
    await page.context().close();

    const staff = await browser.newPage();
    await staff.goto(origin + "/book-staff.html", { waitUntil: "domcontentloaded" });
    await staff.waitForSelector("#staffDescription", { state: "attached" });
    await staff.waitForFunction(() => typeof window.KutadguBookStaff !== "undefined" && window.KutadguBookStaff.BOOK_DESCRIPTION_LIMIT === 5000);
    await staff.evaluate(() => {
      document.querySelector("#staffTitle").value = "يېڭى كىتاب";
      document.querySelector("#staffAuthor").value = "ئاپتور";
      document.querySelector("#staffPrice").value = "10";
      const source = document.querySelector("#staffSource");
      const option = document.createElement("option");
      option.value = "dini.html";
      option.textContent = "دىنىي";
      source.append(option);
      source.value = "dini.html";
    });
    await staff.locator("#staffDescription").evaluate((el, value) => {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, samples.over);
    await staff.locator("#staffBookForm").evaluate((form) => form.requestSubmit());
    await staff.waitForFunction((message) => document.querySelector("#staffSubmitStatus").textContent === message, TOO_LONG);
    assert.strictEqual(await staff.locator("#staffDescription").inputValue(), samples.over);
    assert.strictEqual(await staff.locator("#staffDescriptionCount").textContent(), "5,001 / 5,000");
    await staff.locator("#staffDescription").evaluate((el, value) => {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, samples.exact);
    assert.strictEqual(await staff.locator("#staffDescriptionCount").textContent(), "5,000 / 5,000");
    await staff.locator("#staffBookForm").evaluate((form) => form.requestSubmit());
    await staff.waitForFunction(() => {
      const status = document.querySelector("#staffSubmitStatus");
      return !status.textContent.includes("5,000 ھەرپتىن ئېشىپ");
    });
    assert.strictEqual(await staff.locator("#staffDescription").inputValue(), samples.exact);
    console.log("PASS staff description rejection keeps the entered text");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
