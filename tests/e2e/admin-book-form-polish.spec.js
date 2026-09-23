const { test, expect } = require("./playwright-test");
const path = require("path");
const STUB = path.join(__dirname, "..", "fixtures", "ci-book-cover-stub.png");

const FIXTURES = [
  {
    id: 1,
    title: "ئىسلام تارىخى",
    author: "ئابدۇللا ھاجى روزى",
    price: 20,
    source: "universal.html",
    category: "ئۇنىۋېرسال",
    image_url: "https://cdn.example/cover.webp",
    gallery_images: [],
    is_active: true,
    isbn: "9781111111111",
    description: "desc",
    stock: 3
  }
];

const FORM_IDS = [
  "bookTitle", "bookAuthor", "bookIsbn", "bookSource", "bookTranslator", "bookDescription",
  "bookPrice", "bookStock", "bookSalesCount",
  "bookPublisher", "bookPublishYear", "bookPages", "bookCoverType", "bookSize",
  "bookCoverPickBtn", "bookGalleryPickBtn",
  "bookIsActive", "bookIsNew", "bookIsRecommended",
  "bookSaveBtn", "cancelBookEdit"
];

async function openCreateModal(page) {
  page.on("dialog", (dialog) => dialog.accept());
  await page.addInitScript((books) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguSkipSuggestFetch = true;
    window.__kutadguSuggestionRows = books;
    window.__kutadguAdminPreviewBooks = books;
    window.__kutadguBookSaves = [];
    window.__kutadguAdminPersistBook = async (payload, operation, id) => {
      window.__kutadguBookSaves.push({ payload: { ...payload }, operation, id: String(id || "") });
      return { error: null, data: [{ id: id || 99 }] };
    };
  }, FIXTURES);
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  await page.locator("#newBookBtn").click();
  await expect(page.locator("#bookModal")).toBeVisible();
}

async function assertNoOverflow(page) {
  const overflow = await page.locator("#bookModal .admin-modal-card").evaluate((el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
    formScroll: document.querySelector(".admin-book-form-scroll")
      ? document.querySelector(".admin-book-form-scroll").scrollWidth
      : 0,
    formClient: document.querySelector(".admin-book-form-scroll")
      ? document.querySelector(".admin-book-form-scroll").clientWidth
      : 0
  }));
  expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.client + 1);
  expect(overflow.formScroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.formClient + 1);
}

test.describe("Stage Admin 1L book form visual polish", () => {
  test("section headings, IDs, and no technical helper copy", async ({ page }) => {
    await openCreateModal(page);
    await expect(page.locator(".admin-book-section-title")).toHaveText([
      "ئاساسىي ئۇچۇرلار",
      "باھا ۋە ئامبار",
      "نەشر ئۇچۇرلىرى",
      "رەسىملەر",
      "كۆرۈنۈش تەڭشەكلىرى"
    ]);
    for (const id of FORM_IDS) {
      await expect(page.locator("#" + id)).toHaveCount(1);
    }
    await expect(page.locator("#bookTitleSimilarWarning")).toBeAttached();
    await expect(page.locator("#createDuplicateWarning")).toBeAttached();
    await expect(page.locator("#bookSaveDiag")).toBeHidden();
    const visible = await page.locator("#bookForm").innerText();
    expect(visible).not.toMatch(/\bNULL\b/);
    expect(visible).not.toMatch(/Completed sales only/);
    expect(visible).not.toMatch(/image_url/);
    expect(visible).not.toMatch(/sample-book-cover\.png/);
    expect(visible).toContain("ئىختىيارىي.");
    expect(visible).toContain("خەلقئارا كىتاب نومۇرى (ISBN)");
    await expect(page.locator("#bookForm label[data-book-col='stock']")).toContainText("0 = تۈگەپ كەتتى.");
    await expect(page.locator("#createDuplicateWarning")).toBeHidden();
  });

  test("sticky save bar does not cover the last visibility fields", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 700 });
    await openCreateModal(page);
    const last = page.locator("#bookIsRecommended");
    await last.scrollIntoViewIfNeeded();
    const gap = await page.evaluate(() => {
      const field = document.querySelector("#bookIsRecommended");
      const footer = document.querySelector(".admin-book-form-footer");
      const fr = field.getBoundingClientRect();
      const bar = footer.getBoundingClientRect();
      return {
        fieldBottom: fr.bottom,
        barTop: bar.top,
        fieldVisible: fr.height > 0 && fr.bottom > fr.top,
        overlap: fr.bottom - bar.top
      };
    });
    expect(gap.fieldVisible).toBe(true);
    expect(gap.overlap, JSON.stringify(gap)).toBeLessThanOrEqual(1);
    await expect(page.locator("#bookSaveBtn")).toBeVisible();
    await expect(page.locator("#cancelBookEdit")).toBeVisible();
  });

  test("modal scrolls to every major field without horizontal overflow at 390 / 768 / 1366", async ({ page }) => {
    for (const width of [390, 768, 1366]) {
      await page.setViewportSize({ width, height: 800 });
      await openCreateModal(page);
      for (const id of ["bookTitle", "bookPrice", "bookPublisher", "bookCoverPickBtn", "bookIsRecommended"]) {
        const loc = page.locator("#" + id);
        await loc.scrollIntoViewIfNeeded();
        await expect(loc).toBeVisible();
      }
      await expect(page.locator("#bookCoverPickBtn")).toBeVisible();
      await expect(page.locator("#bookGalleryPickBtn")).toBeAttached();
      await assertNoOverflow(page);
      await page.locator("#cancelBookEdit").click();
    }
  });

  test("create save still works and similar-title plus duplicate warnings remain", async ({ page }) => {
    await openCreateModal(page);
    await page.locator("#bookTitle").fill("ئىسلام تارىخى");
    await expect(page.locator("#bookTitleSimilarWarning")).toBeVisible();
    await expect(page.locator("#bookTitleSimilarWarning")).toContainText("بۇ نامغا ئوخشايدىغان كىتاب بار، قايتا تەكشۈرۈپ بېقىڭ");
    await page.locator("#bookAuthor").fill("ھاجى");
    const authorList = page.locator("#bookAuthor").locator("xpath=following-sibling::ul[@role='listbox']");
    await expect(authorList).toBeVisible();
    await expect(authorList.locator("[role='option']")).toHaveText("ئابدۇللا ھاجى روزى");
    await page.locator("#bookAuthor").fill("ئابدۇللا ھاجى روزى");
    await page.locator("#bookPrice").fill("12");
    await page.locator("#bookSource").selectOption("universal.html");
    await page.locator("#bookCover").setInputFiles(STUB);
    await expect(page.locator("#bookCoverPickStatus")).toHaveText("مۇقاۋا رەسىمى تاللاندى");
    await expect(page.locator("#createDuplicateWarning")).toBeHidden();
    await expect(page.locator("#createDuplicateConfirm")).toHaveCount(1);
    await page.locator("#bookTitle").fill("پۈتۈنلەي يېڭى نام");
    await expect(page.locator("#bookTitleSimilarWarning")).toBeHidden();
    await page.locator("#bookSaveBtn").click();
    await expect.poll(async () => page.evaluate(() => (window.__kutadguBookSaves || []).length)).toBe(1);
    const save = await page.evaluate(() => window.__kutadguBookSaves[0]);
    expect(save.operation).toBe("INSERT");
    expect(save.payload.title).toBe("پۈتۈنلەي يېڭى نام");
    expect(save.payload.author).toBe("ئابدۇللا ھاجى روزى");
  });
});
