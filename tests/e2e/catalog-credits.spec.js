const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const T2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const P = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const LONG = "مۇھەممەد ئابدۇللاھ ئابدۇلقادىر ئۇيغۇر تەتقىقاتى";
const ODD = "غەربىي ئات (A&B)";

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
  book(103, { title: "تۈگەپ كەتكەن", stock: 0, credits: [credit("author", A, 0)] }),
  book(104, { title: "تەرجىمە رولى", author: "باشقا ئاپتور", credits: [credit("translator", A, 0), credit("author", B, 0)] }),
  book(105, { title: "يوشۇرۇن", is_active: false, credits: [credit("author", A, 0)] })
];
for (let id = 110; id <= 119; id += 1) BOOKS.push(book(id, { credits: [credit("author", A, 0)] }));

function parseRange(headers) {
  const raw = headers.Range || headers.range || "0-99";
  const match = String(raw).match(/(\d+)-(\d+)/);
  return match ? { from: Number(match[1]), to: Number(match[2]) } : { from: 0, to: 99 };
}

function matchesCredit(row, id, role) {
  return (row.credits || []).some((item) => item.identity_id === id && item.role === role);
}

async function installCreditApi(page, seen) {
  await page.route("**/rest/v1/catalog_identities**", async (route) => {
    const url = new URL(route.request().url());
    const id = String(url.searchParams.get("id") || "").replace(/^eq\./, "");
    const row = IDENTITIES[id] ? [{ id, display_name: IDENTITIES[id] }] : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(row) });
  });
  await page.route("**/rest/v1/book_credits**", async (route) => {
    const url = new URL(route.request().url());
    const bookId = String(url.searchParams.get("book_id") || "").replace(/^eq\./, "");
    const row = BOOKS.find((item) => String(item.id) === bookId);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(row ? row.credits : []) });
  });
  await page.route("**/rest/v1/books**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    seen.urls.push(url.toString());
    if (req.method() === "HEAD") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-0/20" },
        body: ""
      });
    }
    const creditId = String(url.searchParams.get("book_credits.identity_id") || "").replace(/^eq\./, "");
    const creditRole = String(url.searchParams.get("book_credits.role") || "").replace(/^eq\./, "");
    const active = url.searchParams.get("is_active");
    const idFilter = url.searchParams.get("id") || "";
    let rows = BOOKS.slice();
    if (active === "eq.true") rows = rows.filter((row) => row.is_active);
    if (creditId || creditRole) rows = rows.filter((row) => matchesCredit(row, creditId, creditRole));
    const term = decodeURIComponent(url.searchParams.get("or") || "");
    const searched = (term.match(/ilike\.\*([^*]+)\*/) || [])[1] || "";
    if (searched) rows = rows.filter((row) => String(row.title).includes(searched));
    if (idFilter.startsWith("in.(")) {
      const ids = idFilter.slice(4, -1).split(",");
      rows = ids.map((id) => BOOKS.find((row) => String(row.id) === id)).filter(Boolean);
    }
    rows = rows.slice().sort((a, b) => a.id - b.id);
    const range = parseRange(req.headers());
    const slice = rows.slice(range.from, range.to + 1);
    seen.ranges.push({ from: range.from, count: slice.length, total: rows.length, creditId, creditRole, active });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": `${range.from}-${range.from + Math.max(slice.length - 1, 0)}/${rows.length}` },
      body: JSON.stringify(slice)
    });
  });
}

async function boot(page) {
  const seen = { urls: [], ranges: [] };
  await H.installReadSafeNetwork(page);
  await installCreditApi(page, seen);
  return seen;
}

function mobileFilterToggle(page) {
  return page.locator("#catalogFilterBar").locator("xpath=preceding-sibling::button[contains(@class,'mobile-filter-toggle')]");
}

async function holdCategoryDirectory(page) {
  let resolveGate = () => {};
  let settled = false;
  const gate = new Promise((resolve) => { resolveGate = resolve; });
  const release = () => {
    if (settled) return;
    settled = true;
    resolveGate();
  };
  let arrived = false;
  await page.route("**/rpc/list_public_book_categories**", async (route) => {
    arrived = true;
    await gate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ categories: [], redirects: [] })
    }).catch(() => {});
  });
  return { release, arrived: () => arrived };
}

async function openCreditWhilePremiumWaits(page, width) {
  await boot(page);
  await page.setViewportSize({ width, height: width >= 1000 ? 900 : 800 });
  const held = await holdCategoryDirectory(page);
  await H.openFresh(page, `/author/${A}`);
  await expect.poll(() => held.arrived()).toBe(true);
  await expect.poll(() => page.evaluate(() => ({
    bar: !!document.querySelector("#catalogFilterBar"),
    premium: !!window.KutadguPremiumUx
  }))).toEqual({ bar: true, premium: false });
  return held;
}

async function readFilterChrome(page) {
  return page.evaluate(() => {
    const panel = document.querySelector("#catalogFilterBar");
    const before = panel ? [...panel.parentElement.querySelectorAll(".mobile-filter-toggle, .premium-filter-toggle")] : [];
    const preceding = before.filter((button) => panel.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_PRECEDING);
    const mobile = preceding.find((button) => button.classList.contains("mobile-filter-toggle")) || null;
    const premium = preceding.find((button) => button.classList.contains("premium-filter-toggle")) || null;
    const input = document.querySelector("#catalogFilterText");
    return {
      open: !!(panel && panel.classList.contains("is-open")),
      collapsed: !!(panel && panel.classList.contains("is-collapsed")),
      hidden: panel ? panel.getAttribute("aria-hidden") : null,
      mobileExpanded: mobile ? mobile.getAttribute("aria-expanded") : null,
      premiumExpanded: premium ? premium.getAttribute("aria-expanded") : null,
      display: panel ? getComputedStyle(panel).display : "",
      premiumDisplay: premium ? getComputedStyle(premium).display : "",
      value: input ? input.value : "",
      focused: !!(input && document.activeElement === input),
      premiumReady: !!(panel && panel.dataset.premiumFilter === "1")
    };
  });
}

test.describe("catalog credit browsing", () => {
  test("detail links, role listings, pagination, stock, and navigation", async ({ page }) => {
    const seen = await boot(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await H.openFresh(page, "/book-shell.html?id=101");
    const authorA = page.locator(`a.book-credit-name[href="/author/${A}"]`).first();
    const authorB = page.locator(`a.book-credit-name[href="/author/${B}"]`).first();
    const translatorA = page.locator(`a.book-credit-name[href="/translator/${T1}"]`);
    const translatorOdd = page.locator(`a.book-credit-name[href="/translator/${T2}"]`);
    const publisher = page.locator(`a.book-credit-name[href="/publisher/${P}"]`);
    await expect(authorA).toBeVisible();
    await expect(authorB).toBeVisible();
    await expect(translatorA).toHaveText("تۇرسۇنگۈل ياسىن");
    await expect(translatorOdd).toHaveText(ODD);
    await expect(publisher).toHaveText(IDENTITIES[P]);
    await expect(page.locator(`a.book-credit-all[href="/author/${A}"]`)).toHaveText("بارلىق كىتابلىرى");
    await expect(page.locator(`a.book-credit-all[href="/author/${B}"]`)).toHaveCount(1);
    await expect(page.locator(".book-meta-row", { hasText: "تەرجىمە قىلغۇچى" })).toBeVisible();

    const nameBox = await authorA.boundingBox();
    const helpBox = await page.locator(`a.book-credit-all[href="/author/${A}"]`).boundingBox();
    expect(helpBox.x).toBeLessThan(nameBox.x);
    const decoration = await authorA.evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(decoration).toContain("underline");
    const light = await page.locator(`a.book-credit-all[href="/author/${A}"]`).evaluate((el) => getComputedStyle(el).color);
    expect(light).toBe("rgb(112, 80, 61)");
    await page.evaluate(() => document.body.classList.add("dark-mode"));
    const dark = await page.locator(`a.book-credit-all[href="/author/${A}"]`).evaluate((el) => getComputedStyle(el).color);
    expect(dark).toBe("rgb(226, 201, 141)");
    await page.evaluate(() => document.body.classList.remove("dark-mode"));
    await authorA.focus();
    await expect(authorA).toBeFocused();
    await page.setViewportSize({ width: 390, height: 800 });

    await authorA.click();
    await expect(page).toHaveURL(new RegExp(`/author/${A}$`));
    await expect(page.locator("#creditName")).toHaveText(LONG);
    await expect(page.locator("#creditSummary")).toHaveText("ئاپتور · جەمئىي 13 كىتاب");
    await expect(page.locator(".book-card[data-live-book-id='105']")).toHaveCount(0);
    await expect(page.locator(".book-card[data-live-book-id='104']")).toHaveCount(0);
    await expect(page.locator(".book-card[data-live-book-id='103'] button[disabled]")).toBeVisible();
    const firstPageIds = await page.locator(".book-card[data-live-book-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-live-book-id")));
    expect(new Set(firstPageIds).size).toBe(firstPageIds.length);
    expect(firstPageIds).toHaveLength(12);
    const creditRequests = seen.ranges.filter((item) => item.creditId === A && item.creditRole === "author");
    expect(creditRequests[0].active).toBe("eq.true");
    await page.locator(".catalog-load-more").click();
    await expect(page.locator(".book-card[data-live-book-id]")).toHaveCount(13);
    const next = seen.ranges.filter((item) => item.creditId === A && item.creditRole === "author");
    expect(next[next.length - 1].from).toBe(12);
    expect(page.url()).not.toContain("book_credits");

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => ({
      premium: !!window.KutadguPremiumUx,
      bar: !!document.querySelector("#catalogFilterBar")
    }))).toEqual({ premium: true, bar: true });
    await page.locator("#catalogFilterBar .category-filter-toggle").click();
    await expect(page.locator("#catalogFilterReset")).toBeVisible();
    await page.locator("#catalogFilterText").fill("ئىككى");
    await expect(page.locator(".book-card[data-live-book-id]")).toHaveCount(1);
    expect(seen.urls.some((url) => url.includes("book_credits.identity_id=eq." + A) && url.includes("ilike"))).toBe(true);
    await expect(page.locator("#catalogFilterReset")).toBeVisible();
    await page.locator("#catalogFilterReset").click();
    await expect(page.locator(".book-card[data-live-book-id]")).toHaveCount(12);

    const inStock = page.locator(".book-card[data-live-book-id='101'] button[data-cart-id='101']");
    await inStock.click();
    await expect.poll(() => H.readCart(page)).toEqual(expect.arrayContaining([expect.objectContaining({ id: "101" })]));
    await page.locator(".book-card[data-live-book-id='101'] [data-fav-id='101']").click();
    await expect.poll(() => H.readFavs(page)).toEqual(expect.arrayContaining(["101"]));

    await page.evaluate(() => window.scrollTo(0, 240));
    await page.locator(".book-card[data-live-book-id='101'] a.book-title, .book-card[data-live-book-id='101'] h2 a, .book-card[data-live-book-id='101'] a.detail-button").first().click();
    await page.goBack();
    await expect(page.locator("#creditName")).toHaveText(LONG);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);

    await page.goto(`/translator/${A}`);
    await expect(page.locator("#creditName")).toHaveText(LONG);
    await expect(page.locator("#creditSummary")).toHaveText("تەرجىمان · جەمئىي 1 كىتاب");
    await expect(page.locator(".book-card[data-live-book-id='104']")).toBeVisible();
    await expect(page.locator(".book-card[data-live-book-id='101']")).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".book-card[data-live-book-id='104']")).toBeVisible();

    await page.goto(`/publisher/${P}`);
    await expect(page.locator("#creditSummary")).toHaveText("نەشرىيات · جەمئىي 1 كىتاب");
    await expect(page.locator(".book-card[data-live-book-id='101']")).toBeVisible();
  });

  test("missing metadata, narrow layout, bad urls, and ordinary catalog", async ({ page }) => {
    const seen = await boot(page);
    await page.setViewportSize({ width: 390, height: 800 });
    await H.openFresh(page, "/book-shell.html?id=102");
    await expect(page.locator(`a.book-credit-name[href="/author/${A}"]`).first()).toBeVisible();
    await expect(page.locator(".book-meta-row", { hasText: "تەرجىمە قىلغۇچى" })).toHaveCount(0);
    await expect(page.locator(".book-meta-row", { hasText: "نەشرىيات" })).toHaveCount(0);
    const nameBox = await page.locator(`a.book-credit-name[href="/author/${A}"]`).first().boundingBox();
    const helpBox = await page.locator(`a.book-credit-all[href="/author/${A}"]`).boundingBox();
    expect(helpBox.y).toBeGreaterThan(nameBox.y + nameBox.height - 4);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    expect(overflow).toBe(true);

    await page.goto("/author/not-a-uuid");
    await expect(page.getByRole("heading", { name: "بۇ ئادرېس توغرا ئەمەس" })).toBeVisible();
    await expect(page.locator(".book-card[data-live-book-id]")).toHaveCount(0);

    await page.goto(`/author/${B}`);
    await expect(page.locator("#creditSummary")).toHaveText("ئاپتور · جەمئىي 2 كىتاب");
    await expect(page.locator(".book-card[data-live-book-id='101']")).toBeVisible();
    await expect(page.locator(".book-card[data-live-book-id='104']")).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/books.html");
    await expect(page.locator(".book-card[data-live-book-id='101']")).toBeVisible();
    expect(seen.urls.some((url) => url.includes("/rest/v1/books") && !url.includes("book_credits") && !url.includes("select=id"))).toBe(true);
  });

  test("late premium initialization keeps an opened mobile filter", async ({ page }) => {
    const held = await openCreditWhilePremiumWaits(page, 390);
    try {
      const toggle = mobileFilterToggle(page);
      await expect(toggle).toBeVisible();
      await toggle.click();
      const field = page.locator("#catalogFilterText");
      await expect(field).toBeVisible();
      await field.click();
      await field.fill("ئىككى");
      await expect(field).toBeFocused();
      await expect.poll(() => page.evaluate(() => !!window.KutadguPremiumUx)).toBe(false);
      held.release();
      await expect.poll(() => page.evaluate(() => document.querySelector("#catalogFilterBar")?.dataset.premiumFilter || "")).toBe("1");
      const open = await readFilterChrome(page);
      expect(open.open).toBe(true);
      expect(open.collapsed).toBe(false);
      expect(open.hidden).toBeNull();
      expect(open.mobileExpanded).toBe("true");
      expect(open.premiumExpanded).toBe("true");
      expect(open.display).not.toBe("none");
      expect(open.value).toBe("ئىككى");
      expect(open.focused).toBe(true);
      await expect(page.locator("#catalogFilterReset")).toBeVisible();
      await expect(page.locator("#catalogFilterBar + .premium-active-filters")).toContainText("ئىككى");

      await page.locator("#catalogFilterReset").click();
      await expect(field).toHaveValue("");
      await expect(page.locator("#catalogFilterBar + .premium-active-filters")).not.toContainText("ئىككى");
      await expect(page.locator("#catalogFilterReset")).toBeVisible();
      const cleared = await readFilterChrome(page);
      expect(cleared.open).toBe(true);
      expect(cleared.collapsed).toBe(false);
      expect(cleared.mobileExpanded).toBe("true");
      expect(cleared.premiumExpanded).toBe("true");

      await toggle.click();
      await expect(page.locator("#catalogFilterReset")).toBeHidden();
      const closed = await readFilterChrome(page);
      expect(closed.open).toBe(false);
      expect(closed.collapsed).toBe(true);
      expect(closed.hidden).toBeNull();
      expect(closed.mobileExpanded).toBe("false");
      expect(closed.premiumExpanded).toBe("false");
      expect(closed.display).not.toBe("none");
      await expect(page.locator("#catalogSort")).toBeVisible();

      await toggle.click();
      await expect(page.locator("#catalogFilterReset")).toBeVisible();
      const reopened = await readFilterChrome(page);
      expect(reopened.open).toBe(true);
      expect(reopened.collapsed).toBe(false);
      expect(reopened.hidden).toBeNull();
      expect(reopened.mobileExpanded).toBe("true");
      expect(reopened.premiumExpanded).toBe("true");
      expect(reopened.value).toBe("");
    } finally {
      held.release();
    }
  });

  test("late premium initialization leaves a closed mobile filter closed", async ({ page }) => {
    const held = await openCreditWhilePremiumWaits(page, 390);
    try {
      await expect(mobileFilterToggle(page)).toBeVisible();
      await expect(page.locator("#catalogFilterReset")).toBeHidden();
      const before = await readFilterChrome(page);
      expect(before.open).toBe(false);
      expect(before.collapsed).toBe(true);
      expect(before.hidden).toBeNull();
      expect(before.mobileExpanded).toBe("false");
      expect(before.premiumExpanded).toBe(null);
      held.release();
      await expect.poll(() => page.evaluate(() => document.querySelector("#catalogFilterBar")?.dataset.premiumFilter || "")).toBe("1");
      const after = await readFilterChrome(page);
      expect(after.open).toBe(false);
      expect(after.collapsed).toBe(true);
      expect(after.hidden).toBeNull();
      expect(after.mobileExpanded).toBe("false");
      expect(after.premiumExpanded).toBe("false");
      expect(after.display).not.toBe("none");
      await expect(page.locator("#catalogFilterReset")).toBeHidden();

      await mobileFilterToggle(page).click();
      await expect(page.locator("#catalogFilterReset")).toBeVisible();
      await page.locator("#catalogFilterText").fill("ئىككى");
      await page.locator("#catalogFilterReset").click();
      await expect(page.locator("#catalogFilterText")).toHaveValue("");
      await expect(page.locator("#catalogFilterReset")).toBeVisible();
      await mobileFilterToggle(page).click();
      await expect(page.locator("#catalogFilterReset")).toBeHidden();
      await mobileFilterToggle(page).click();
      await expect(page.locator("#catalogFilterReset")).toBeVisible();
    } finally {
      held.release();
    }
  });

  test("late premium initialization keeps desktop filter fields visible", async ({ page }) => {
    const held = await openCreditWhilePremiumWaits(page, 1280);
    try {
      const field = page.locator("#catalogFilterText");
      await expect(field).toBeVisible();
      await field.click();
      await field.fill("ئىككى");
      await expect(field).toBeFocused();
      await expect.poll(() => page.evaluate(() => !!window.KutadguPremiumUx)).toBe(false);
      held.release();
      await expect.poll(() => page.evaluate(() => document.querySelector("#catalogFilterBar")?.dataset.premiumFilter || "")).toBe("1");
      const open = await readFilterChrome(page);
      expect(open.display).not.toBe("none");
      expect(open.premiumDisplay).toBe("none");
      expect(open.value).toBe("ئىككى");
      expect(open.focused).toBe(true);
      await expect(field).toBeVisible();
      await page.locator("#catalogFilterBar .category-filter-toggle").click();
      await page.locator("#catalogFilterReset").click();
      await expect(field).toHaveValue("");
      await expect(field).toBeVisible();
      const cleared = await readFilterChrome(page);
      expect(cleared.display).not.toBe("none");
      expect(cleared.premiumDisplay).toBe("none");
    } finally {
      held.release();
    }
  });
});
