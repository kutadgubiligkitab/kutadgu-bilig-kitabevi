const { test, expect } = require("./playwright-test");

const EXISTING = [
  {
    id: 1,
    title: "ئىسلام تارىخى",
    author: "ئابدۇللا ھاجى روزى",
    translator: "ئەلى تەرجىمان",
    publisher: "شىنجاڭ خەلق نەشرىياتى",
    isbn: "9781111111111"
  }
];

async function openAdmin(page, extraInit) {
  page.on("dialog", (dialog) => dialog.accept());
  await page.addInitScript((books) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguSkipSuggestFetch = true;
    window.__kutadguSuggestionRows = books.slice();
    window.__kutadguAdminPreviewBooks = books.slice();
    window.__kutadguBookSaves = [];
    window.__kutadguNextSavedId = 8801;
    window.__kutadguAdminPersistBook = async (payload, operation, id) => {
      window.__kutadguBookSaves.push({ payload: { ...payload }, operation, id: String(id || "") });
      if (window.__kutadguPersistShouldFail) return { error: new Error("forced save failure") };
      const savedId = operation === "UPDATE" ? Number(id) : window.__kutadguNextSavedId++;
      return { error: null, data: [{ id: savedId }] };
    };
  }, EXISTING);
  if (extraInit) await page.addInitScript(extraInit);
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
}

async function fillAndSaveNew(page, fields) {
  await page.locator("#newBookBtn").click();
  await expect(page.locator("#bookModal")).toBeVisible();
  await page.locator("#bookTitle").fill(fields.title);
  await page.locator("#bookAuthor").fill(fields.author);
  if (fields.translator) await page.locator("#bookTranslator").fill(fields.translator);
  if (fields.publisher) await page.locator("#bookPublisher").fill(fields.publisher);
  await page.locator("#bookPrice").fill("20");
  await page.locator("#bookSource").selectOption("universal.html");
  await page.locator("#bookSaveBtn").click();
  await expect(page.locator("#bookModal")).toBeHidden();
}

test.describe("Stage Admin 1K suggestion refresh after save", () => {
  test("successful create immediately suggests new author/translator/publisher and title", async ({ page }) => {
    await openAdmin(page);
    await fillAndSaveNew(page, {
      title: "يېڭى ساقلاش نامى",
      author: "ئابدۇقادىر مەمەت",
      translator: "يېڭى تەرجىمان",
      publisher: "يېڭى نەشرىيات"
    });
    await page.locator("#newBookBtn").click();
    await expect(page.locator("#bookModal")).toBeVisible();

    await page.locator("#bookAuthor").fill("ئابدۇ");
    const authorList = page.locator("#bookAuthor").locator("xpath=following-sibling::ul[@role='listbox']");
    await expect(authorList.locator("[role='option']")).toContainText(["ئابدۇقادىر مەمەت"]);

    await page.locator("#bookTranslator").fill("يېڭى تە");
    await expect(page.locator("#bookTranslator").locator("xpath=following-sibling::ul[@role='listbox']").locator("[role='option']")).toContainText(["يېڭى تەرجىمان"]);

    await page.locator("#bookPublisher").fill("يېڭى نەش");
    await expect(page.locator("#bookPublisher").locator("xpath=following-sibling::ul[@role='listbox']").locator("[role='option']")).toContainText(["يېڭى نەشرىيات"]);

    await page.locator("#bookTitle").fill("يېڭى ساقلاش");
    await expect(page.locator("#bookTitleSimilarWarning")).toBeVisible();
    await expect(page.locator("#bookTitleSimilarWarning")).toContainText("يېڭى ساقلاش نامى");
  });

  test("successful edit replaces suggestion row by id", async ({ page }) => {
    await openAdmin(page);
    await expect(page.locator('[data-edit="1"]')).toBeVisible();
    await page.locator('[data-edit="1"]').click();
    await expect(page.locator("#bookModal")).toBeVisible();
    await page.locator("#bookTitle").fill("تەھرىرلەنگەن نام");
    await page.locator("#bookAuthor").fill("تەھرىرلەنگەن ئاپتور");
    await page.locator("#bookIsbn").fill("");
    await page.locator("#bookSource").selectOption("universal.html");
    await page.locator("#bookSaveBtn").click();
    await expect(page.locator("#bookModal")).toBeHidden();

    const rows = await page.evaluate(() => (window.__kutadguSuggestionRows || []).filter((row) => String(row.id) === "1"));
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("تەھرىرلەنگەن نام");
    expect(rows[0].author).toBe("تەھرىرلەنگەن ئاپتور");

    await page.locator("#newBookBtn").click();
    await page.locator("#bookAuthor").fill("تەھرىر");
    await expect(page.locator("#bookAuthor").locator("xpath=following-sibling::ul[@role='listbox']").locator("[role='option']")).toContainText(["تەھرىرلەنگەن ئاپتور"]);
    await page.locator("#bookAuthor").fill("ئىسلام تارىخى-كونا");
    await page.locator("#bookTitle").fill("ئىسلام تارىخى");
    await expect(page.locator("#bookTitleSimilarWarning")).toBeHidden();
  });

  test("failed save does not mutate suggestion rows", async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => { window.__kutadguPersistShouldFail = true; });
    await page.locator("#newBookBtn").click();
    await page.locator("#bookTitle").fill("مەغلۇپ نام");
    await page.locator("#bookAuthor").fill("مەغلۇپ ئاپتور");
    await page.locator("#bookPrice").fill("20");
    await page.locator("#bookSource").selectOption("universal.html");
    await page.locator("#bookSaveBtn").click();
    await expect(page.locator("#bookModal")).toBeVisible();
    const authors = await page.evaluate(() => {
      const S = window.KutadguBookEntrySuggest;
      return S.uniqueValuesFromRows(window.__kutadguSuggestionRows || [], "author");
    });
    expect(authors).not.toContain("مەغلۇپ ئاپتور");
    expect(authors).toContain("ئابدۇللا ھاجى روزى");
  });
});
