#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const root = path.join(__dirname, "..");
const TOO_LONG = "كىتاب ھەققىدە 2,000 ھەرپتىن ئېشىپ كەتمىسۇن.";
const SHORT = "قىسقا چۈشەندۈرۈش.\n\nداۋامى.";

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
  assert.match(form, /قىسقىچە چۈشەندۈرۈش\. ئەڭ كۆپ 2,000 ھەرپ\./);
  assert.match(form, /id="bookDescriptionCount"/);
  assert.match(adminHtml, /volumeSeriesDescription" rows="4" maxlength="10000"/);
  assert.match(adminHtml, /volumeGroupDescription" rows="4" maxlength="10000"/);
  assert.ok(adminHtml.includes("admin.js?v=" + require("./ci-asset-pins").assetPin("admin.js")));
  assert.doesNotMatch(staffHtml, /id="staffDescription"[^>]*maxlength=/);
  assert.match(staffHtml, /id="staffDescriptionCount"/);
  assert.match(staffHtml, /book-staff\.js\?v=13/);
  assert.match(shop, /desc\.querySelector\("p"\)\.textContent=b\.description/);
  assert.doesNotMatch(shop, /b\.description\.slice|description\.slice\(0,\s*1200\)/);
  const exact = uyghurDescription(2000);
  const over = uyghurDescription(2001);
  assert.strictEqual(exact.length, 2000);
  assert.strictEqual(over.length, 2001);
  assert.ok(exact.includes("\n\n"));
  assert.strictEqual(over.slice(0, 2000), exact);
  return { exact, over };
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
  await context.addInitScript(() => {
    window.__alerts = [];
    window.__writes = [];
    window.alert = (message) => { window.__alerts.push(String(message)); };
    window.__kutadguSkipAdminAuth = true;
    window.__creditRows = { data: [], error: null };
    window.__book = null;
    window.__kutadguAdminFetchBook = () => window.__book;
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
        return Promise.resolve({ data: null, error: null });
      },
      auth: {
        onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
        getSession() {
          return Promise.resolve({ data: { session: { access_token: "isolated-admin-access-token" } }, error: null });
        }
      }
    };
  });
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
        image_url: "https://www.kutadgubilik.com/__r2/book-covers/book/1788094203015.webp",
        is_active: true,
        language: "ug",
        description,
        sales_count: 0
      };
    }, { source, description: SHORT });
    await page.evaluate(() => window.__kutadguAdminTest.openEdit(106));
    await page.waitForFunction((expected) => document.querySelector("#bookDescription").value === expected, SHORT);
    assert.strictEqual(await page.locator("#bookDescriptionCount").innerText(), SHORT.length + " / 2,000");
    await page.evaluate(() => { window.__writes = []; window.__alerts = []; });
    await page.locator("#bookForm button[type=submit]").click();
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
    await page.locator("#bookDescription").evaluate((el, value) => {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, samples.exact);
    assert.strictEqual(await page.locator("#bookDescriptionCount").innerText(), "2,000 / 2,000");
    await page.evaluate((description) => {
      window.__writes = [];
      window.__alerts = [];
      window.__book.description = description;
    }, samples.exact);
    await page.locator("#bookForm button[type=submit]").click();
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
    await page.locator("#bookDescription").evaluate((el, value) => {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, samples.over);
    assert.strictEqual(await page.locator("#bookDescription").inputValue(), samples.over);
    assert.strictEqual(await page.locator("#bookDescriptionCount").innerText(), "2,001 / 2,000");
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
        image_url: "https://www.kutadgubilik.com/__r2/book-covers/book/1788094203015.webp",
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
    await page.locator("#bookDescription").evaluate((el, value) => {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, changedSeries);
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
    console.log("PASS unchanged series-member description stays stored");

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
        image_url: "https://www.kutadgubilik.com/__r2/book-covers/book/1788094203015.webp",
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
    await page.context().close();

    const staff = await browser.newPage();
    await staff.goto(origin + "/book-staff.html", { waitUntil: "domcontentloaded" });
    await staff.waitForSelector("#staffDescription", { state: "attached" });
    await staff.waitForFunction(() => typeof window.KutadguBookStaff !== "undefined" && window.KutadguBookStaff.BOOK_DESCRIPTION_LIMIT === 2000);
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
    assert.strictEqual(await staff.locator("#staffDescriptionCount").textContent(), "2,001 / 2,000");
    await staff.locator("#staffDescription").evaluate((el, value) => {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, samples.exact);
    assert.strictEqual(await staff.locator("#staffDescriptionCount").textContent(), "2,000 / 2,000");
    await staff.locator("#staffBookForm").evaluate((form) => form.requestSubmit());
    await staff.waitForFunction(() => {
      const status = document.querySelector("#staffSubmitStatus");
      return !status.textContent.includes("2,000 ھەرپتىن ئېشىپ");
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
