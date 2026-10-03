const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const T2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const P = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const LONG = "مۇھەممەد ئابدۇللاھ ئابدۇلقادىر ئۇيغۇر تەتقىقاتى";
const ODD = "غەربىي ئات (A&B)";
const PLAIN = "يالغۇز ئاپتور";

const IDENTITIES = {
  [A]: LONG,
  [B]: "پەرھات جىلانوۋ",
  [T1]: "تۇرسۇنگۈل ياسىن",
  [T2]: ODD,
  [P]: "شىنجاڭ خەلق نەشرىياتى"
};

function credit(role, id, position) {
  return { role, position, identity_id: id, catalog_identities: { id, display_name: IDENTITIES[id] } };
}

function book(id, extra) {
  return Object.assign({
    id,
    title: "كىتاب " + id,
    author: LONG,
    price: 40,
    category: "رومانلار",
    source: "romanlar.html",
    is_active: true,
    stock: 4,
    created_at: "2026-01-" + String(id).padStart(2, "0") + "T00:00:00Z"
  }, extra || {});
}

const BOOKS = [
  book(101, {
    title: "ئىككى ئاپتورلۇق",
    translator: "تۇرسۇنگۈل ياسىن، " + ODD,
    publisher: IDENTITIES[P],
    credits: [credit("author", A, 0), credit("author", B, 1), credit("translator", T1, 0), credit("translator", T2, 1), credit("publisher", P, 0)]
  }),
  book(102, { title: "پەقەت ئاپتور", translator: "", publisher: "", credits: [credit("author", A, 0)] }),
  book(106, { title: "ئىسىمسىز", author: PLAIN, translator: "", publisher: "", credits: [] })
];

function parseRange(headers) {
  const raw = headers.Range || headers.range || "0-99";
  const match = String(raw).match(/(\d+)-(\d+)/);
  return match ? { from: Number(match[1]), to: Number(match[2]) } : { from: 0, to: 99 };
}

function payloadBook(row, select) {
  const copy = Object.assign({}, row);
  delete copy.credits;
  if (/book_credits!/.test(String(select || ""))) {
    copy.book_credits = (row.credits || []).map((item) => ({ identity_id: item.identity_id, role: item.role }));
  } else {
    delete copy.book_credits;
  }
  return copy;
}

async function installApi(page, seen) {
  await page.route("**/book-shell.html**", async (route) => {
    const response = await route.fetch();
    let html = await response.text();
    if (/[?&]id=101(?:&|$)/.test(route.request().url())) {
      const next = html.replace(
        '<div class="book-author">ئاپتورى: —</div>',
        `<div class="book-author">ئاپتورى: <a class="book-credit-name" href="/author/${A}">${LONG}</a></div>`
      );
      seen.shellSourceHasAuthorLink = next !== html && next.includes(`href="/author/${A}"`);
      html = next;
    }
    const headers = response.headers();
    delete headers["content-length"];
    delete headers["content-encoding"];
    await route.fulfill({ status: response.status(), headers, body: html });
  });
  await page.route("**/rest/v1/catalog_identities**", async (route) => {
    const url = new URL(route.request().url());
    const id = String(url.searchParams.get("id") || "").replace(/^eq\./, "");
    const row = IDENTITIES[id] ? [{ id, display_name: IDENTITIES[id] }] : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(row) });
  });
  await page.route("**/rest/v1/book_credits**", async (route) => {
    const url = new URL(route.request().url());
    const bookId = String(url.searchParams.get("book_id") || "").replace(/^eq\./, "");
    seen.creditBookIds.push(bookId);
    const row = BOOKS.find((item) => String(item.id) === bookId);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(row ? row.credits : []) });
  });
  await page.route("**/rest/v1/books**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "HEAD") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-0/3" },
        body: ""
      });
    }
    const select = url.searchParams.get("select") || "";
    const creditId = String(url.searchParams.get("book_credits.identity_id") || "").replace(/^eq\./, "");
    const creditRole = String(url.searchParams.get("book_credits.role") || "").replace(/^eq\./, "");
    const idFilter = url.searchParams.get("id") || "";
    let rows = BOOKS.filter((row) => row.is_active !== false);
    if (creditId || creditRole) {
      rows = rows.filter((row) => (row.credits || []).some((item) => item.identity_id === creditId && item.role === creditRole));
    }
    if (idFilter.startsWith("in.(")) {
      const ids = idFilter.slice(4, -1).split(",");
      rows = ids.map((id) => BOOKS.find((row) => String(row.id) === id)).filter(Boolean);
    } else if (idFilter.startsWith("eq.")) {
      rows = BOOKS.filter((row) => String(row.id) === idFilter.slice(3));
    }
    const range = parseRange(req.headers());
    const slice = rows.slice(range.from, range.to + 1).map((row) => payloadBook(row, select));
    slice.forEach((row) => {
      if (String(row.id) !== "101") return;
      seen.detailBooks.push({
        select,
        idFilter,
        hasCredits: Object.prototype.hasOwnProperty.call(row, "credits"),
        hasBookCredits: Object.prototype.hasOwnProperty.call(row, "book_credits")
      });
    });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": `${range.from}-${range.from + Math.max(slice.length - 1, 0)}/${rows.length}` },
      body: JSON.stringify(slice)
    });
  });
}

async function boot(page) {
  const seen = { creditBookIds: [], detailBooks: [], shellSourceHasAuthorLink: false };
  await H.installReadSafeNetwork(page);
  await installApi(page, seen);
  return seen;
}

async function openDetail(page, id) {
  await page.goto(`/book-shell.html?id=${id}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction((bookId) => document.body.dataset.bookId === bookId, String(id));
}

async function linkAtPoint(page, locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
  const box = await locator.boundingBox();
  expect(box).toBeTruthy();
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const link = el && el.closest ? el.closest("a") : null;
    return {
      href: link ? link.getAttribute("href") || "" : "",
      tag: el ? el.tagName.toLowerCase() : "",
      className: el && el.className ? String(el.className) : ""
    };
  }, { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 8) });
}

async function expectCreditLink(page, href) {
  const link = page.locator(`a.book-credit-name[href="${href}"]`).first();
  await expect(link).toBeVisible();
  const authorHtml = await page.locator(".book-author").innerHTML();
  const hit = await linkAtPoint(page, link);
  expect(hit, authorHtml).toMatchObject({ href });
  return link;
}

async function cachedCreditCount(page, id) {
  return page.evaluate((bookId) => {
    const book = window.kutadguShop.find(bookId);
    return book && Array.isArray(book.credits) ? book.credits.length : 0;
  }, String(id));
}

test.describe("contributor links survive a later catalog refetch", () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true });

  test("mobile reload, another book, and Back keep stored identity links", async ({ page }) => {
    const seen = await boot(page);
    await openDetail(page, 101);
    expect(seen.shellSourceHasAuthorLink).toBe(true);
    expect(seen.creditBookIds).toContain("101");
    expect(seen.detailBooks.some((row) => row.idFilter === "in.(101)" && row.hasCredits === false && row.hasBookCredits === false)).toBe(true);
    await expectCreditLink(page, `/author/${A}`);
    await expectCreditLink(page, `/author/${B}`);
    await expectCreditLink(page, `/translator/${T1}`);
    await expectCreditLink(page, `/publisher/${P}`);
    await expect.poll(() => seen.detailBooks.filter((row) => row.idFilter === "").length).toBeGreaterThan(0);
    await expect.poll(() => cachedCreditCount(page, 101)).toBe(5);
    await page.evaluate(() => window.kutadguShop.refreshStorefrontVisibility());
    await expectCreditLink(page, `/author/${A}`);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("kutadgu-recent-v1") || "[]"))).toContain("101");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.dataset.bookId === "101");
    await expectCreditLink(page, `/author/${A}`);
    await expectCreditLink(page, `/author/${B}`);
    await expectCreditLink(page, `/translator/${T1}`);
    await expectCreditLink(page, `/translator/${T2}`);
    await expectCreditLink(page, `/publisher/${P}`);
    await expect.poll(() => cachedCreditCount(page, 101)).toBe(5);

    await openDetail(page, 102);
    await expectCreditLink(page, `/author/${A}`);
    await expect(page.locator(`a.book-credit-name[href="/translator/${T1}"]`)).toHaveCount(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.dataset.bookId === "102");
    await expectCreditLink(page, `/author/${A}`);

    await openDetail(page, 101);
    const author = await expectCreditLink(page, `/author/${A}`);
    await author.click();
    await expect(page).toHaveURL(new RegExp(`/author/${A}$`));
    await expect(page.locator("#creditName")).toHaveText(LONG);
    await page.goBack({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.dataset.bookId === "101");
    const returned = await expectCreditLink(page, `/author/${A}`);
    await returned.click();
    await expect(page).toHaveURL(new RegExp(`/author/${A}$`));

    await openDetail(page, 106);
    await expect(page.locator(".book-author")).toContainText(PLAIN);
    await expect(page.locator("a.book-credit-name")).toHaveCount(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.dataset.bookId === "106");
    await expect(page.locator(".book-author")).toContainText(`ئاپتورى: ${PLAIN}`);
    await expect(page.locator("a.book-credit-name")).toHaveCount(0);
  });
});

test.describe("desktop contributor links", () => {
  test.use({ viewport: { width: 1280, height: 900 }, hasTouch: false });

  test("reload keeps author, translator, and publisher links", async ({ page }) => {
    await boot(page);
    await openDetail(page, 101);
    await expectCreditLink(page, `/author/${A}`);
    await expectCreditLink(page, `/translator/${T1}`);
    await expectCreditLink(page, `/publisher/${P}`);
    await expect.poll(() => cachedCreditCount(page, 101)).toBe(5);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.dataset.bookId === "101");
    await expectCreditLink(page, `/author/${A}`);
    await expectCreditLink(page, `/translator/${T1}`);
    await expectCreditLink(page, `/publisher/${P}`);
  });
});
