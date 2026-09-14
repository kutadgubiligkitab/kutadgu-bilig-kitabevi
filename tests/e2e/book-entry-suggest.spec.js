const { test, expect } = require("./playwright-test");

const SUGGEST_ROWS = [
  {
    id: 1,
    title: "ئىسلام تارىخى",
    author: "ئابدۇللا ھاجى روزى",
    translator: "ئەلى تەرجىمان",
    publisher: "شىنجاڭ خەلق نەشرىياتى",
    isbn: "9781111111111"
  },
  {
    id: 2,
    title: "بالىلار ھېكايىسى",
    author: "ئابدۇللا ھاجى روزى",
    translator: "",
    publisher: "شىنجاڭ خەلق نەشرىياتى",
    isbn: "9782222222222"
  },
  {
    id: 3,
    title: "ھاجىلار يولى",
    author: "باشقا ئاپتور",
    translator: "ئەلى تەرجىمان",
    publisher: "مىللەتلەر نەشرىياتى",
    isbn: "9783333333333"
  }
];

const PENDING_BOOK = {
  id: 9401,
  title: "تەستىق كۈتۈۋاتقان كىتاب",
  author: "ئەسلى ئاپتور",
  translator: "تەرجىمان",
  publisher: "نەشرىيات",
  isbn: "9781111111111",
  price: 45,
  stock: 3,
  category: "ئۇنىۋېرسال",
  source: "universal.html",
  publish_year: 2024,
  pages: 120,
  cover_type: "paperback",
  book_size: "A5",
  original_price: 60,
  dimensions: "14x21",
  is_color_print: true,
  interior_print_type: "bw",
  description: "قىسقىچە چۈشەندۈرۈش",
  image_url: "https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/staff/demo/cover.jpg",
  gallery_images: [
    "https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/staff/demo/g1.jpg"
  ],
  submitted_by: "staff-user",
  submitted_at: "2026-09-01T10:00:00.000Z",
  submission_status: "pending",
  is_active: false,
  is_available: false
};

async function openAdminEditor(page, extraInit) {
  await page.addInitScript((rows) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguSkipSuggestFetch = true;
    window.__kutadguSuggestionRows = rows;
    window.__kutadguAdminPreviewBooks = [];
  }, SUGGEST_ROWS);
  if (extraInit) await page.addInitScript(extraInit);
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  await page.locator("#newBookBtn").click();
  await expect(page.locator("#bookModal")).toBeVisible();
}

async function openStaffForm(page) {
  await page.addInitScript((rows) => {
    window.__kutadguSkipStaffRoute = true;
    window.__kutadguSkipSuggestFetch = true;
    window.__kutadguSuggestionRows = rows;
  }, SUGGEST_ROWS);
  await page.goto("/book-staff.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    const workspace = document.getElementById("staffWorkspace");
    const loading = document.getElementById("staffLoading");
    const signedOut = document.getElementById("staffSignedOut");
    const form = document.getElementById("staffBookForm");
    if (loading) loading.hidden = true;
    if (signedOut) signedOut.hidden = true;
    if (workspace) workspace.hidden = false;
    if (form) form.hidden = false;
  });
  await expect(page.locator("#staffBookForm")).toBeVisible();
}

async function noOverflow(page) {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth
  }));
  expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.client + 1);
}

test.describe("book entry suggestions", () => {
  test("Admin author/translator/publisher contains match, keyboard, click, escape, and free text", async ({ page }) => {
    await openAdminEditor(page);
    const author = page.locator("#bookAuthor");
    await expect(author).toHaveAttribute("role", "combobox");
    await author.fill("ھاجى");
    const authorList = page.locator("#bookAuthor").locator("xpath=following-sibling::ul[@role='listbox']");
    await expect(authorList).toBeVisible();
    await expect(authorList.locator("[role='option']")).toHaveCount(1);
    await expect(authorList.locator("[role='option']")).toHaveText("ئابدۇللا ھاجى روزى");
    await author.press("ArrowDown");
    await author.press("Enter");
    await expect(author).toHaveValue("ئابدۇللا ھاجى روزى");
    await expect(authorList).toBeHidden();

    const translator = page.locator("#bookTranslator");
    await translator.fill("ئەلى");
    const translatorList = page.locator("#bookTranslator").locator("xpath=following-sibling::ul[@role='listbox']");
    await expect(translatorList.locator("[role='option']")).toHaveText("ئەلى تەرجىمان");
    await translatorList.locator("[role='option']").click();
    await expect(translator).toHaveValue("ئەلى تەرجىمان");

    const publisher = page.locator("#bookPublisher");
    await publisher.fill("خەلق");
    const publisherList = page.locator("#bookPublisher").locator("xpath=following-sibling::ul[@role='listbox']");
    await expect(publisherList.locator("[role='option']")).toHaveText("شىنجاڭ خەلق نەشرىياتى");
    await publisher.press("Escape");
    await expect(publisherList).toBeHidden();
    await expect(publisher).toHaveValue("خەلق");

    await publisher.fill("يېڭى نەشرىيات");
    await expect(publisherList).toBeHidden();
    await expect(publisher).toHaveValue("يېڭى نەشرىيات");

    await expect(page.locator("#bookTitle")).not.toHaveAttribute("role", "combobox");
  });

  test("Admin title shows similar warning and is not filled from suggestions", async ({ page }) => {
    await openAdminEditor(page);
    const title = page.locator("#bookTitle");
    const warn = page.locator("#bookTitleSimilarWarning");
    await title.fill("ئىسلام تارىخى");
    await expect(warn).toBeVisible({ timeout: 5000 });
    await expect(warn).toContainText("بۇ نامغا ئوخشايدىغان كىتاب بار، قايتا تەكشۈرۈپ بېقىڭ.");
    await expect(warn).toContainText("ئىسلام تارىخى");
    await expect(warn).toContainText("ئابدۇللا ھاجى روزى");
    await expect(warn).toContainText("9781111111111");
    await title.fill("پۈتۈنلەي يېڭى نام");
    await expect(warn).toBeHidden({ timeout: 5000 });
    await expect(page.locator("#bookTitle")).toHaveValue("پۈتۈنلەي يېڭى نام");
  });

  test("existing Admin create duplicate warning UI remains separate from title similarity", async ({ page }) => {
    await openAdminEditor(page);
    await expect(page.locator("#createDuplicateWarning")).toHaveCount(1);
    await expect(page.locator("#createDuplicateConfirm")).toHaveCount(1);
    await expect(page.locator("#bookTitleSimilarWarning")).toHaveCount(1);
    await expect(page.locator("#createDuplicateWarning")).toBeHidden();
    await page.locator("#bookTitle").fill("ئىسلام تارىخى");
    await expect(page.locator("#bookTitleSimilarWarning")).toBeVisible();
    await expect(page.locator("#createDuplicateWarning")).toBeHidden();
  });

  test("Book Staff suggestions, advisory title warning, and submit stays enabled", async ({ page }) => {
    await openStaffForm(page);
    const author = page.locator("#staffAuthor");
    await author.fill("ھاجى");
    const authorList = page.locator("#staffAuthor").locator("xpath=following-sibling::ul[@role='listbox']");
    await expect(authorList.locator("[role='option']")).toHaveText("ئابدۇللا ھاجى روزى");
    await authorList.locator("[role='option']").click();
    await expect(author).toHaveValue("ئابدۇللا ھاجى روزى");

    await page.locator("#staffTranslator").fill("ئەلى");
    const translatorList = page.locator("#staffTranslator").locator("xpath=following-sibling::ul[@role='listbox']");
    await expect(translatorList.locator("[role='option']")).toHaveText("ئەلى تەرجىمان");

    await page.locator("#staffPublisher").fill("مىللەت");
    const publisherList = page.locator("#staffPublisher").locator("xpath=following-sibling::ul[@role='listbox']");
    await expect(publisherList.locator("[role='option']")).toHaveText("مىللەتلەر نەشرىياتى");

    await page.locator("#staffTitle").fill("ئىسلام تارىخى");
    await expect(page.locator("#staffTitleSimilarWarning")).toBeVisible();
    await expect(page.locator("#staffTitleSimilarWarning")).toContainText("بۇ نامغا ئوخشايدىغان كىتاب بار، قايتا تەكشۈرۈپ بېقىڭ.");
    await expect(page.locator("#staffSubmitBtn")).toBeEnabled();
    await expect(page.locator("#staffTitle")).not.toHaveAttribute("role", "combobox");
    await expect(page.locator("#staffSource")).toHaveJSProperty("tagName", "SELECT");
  });

  test("forms still work when suggestion fetch is empty/failed", async ({ page }) => {
    await page.addInitScript(() => {
      window.__kutadguSkipAdminAuth = true;
      window.__kutadguSkipSuggestFetch = true;
      window.__kutadguSuggestionRows = [];
      window.__kutadguAdminPreviewBooks = [];
    });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await page.locator("#newBookBtn").click();
    await page.locator("#bookAuthor").fill("يېڭى ئاپتور");
    await expect(page.locator("#bookAuthor").locator("xpath=following-sibling::ul[@role='listbox']")).toBeHidden();
    await expect(page.locator("#bookAuthor")).toHaveValue("يېڭى ئاپتور");
    await page.locator("#bookTitle").fill("يېڭى كىتاب");
    await expect(page.locator("#bookTitleSimilarWarning")).toBeHidden();
    await expect(page.locator("#bookForm button[type='submit']")).toBeEnabled();
  });

  test("Pending edit still prefills and Save stays pending with typeahead optional", async ({ page }) => {
    page.on("dialog", (dialog) => dialog.accept());
    await page.addInitScript((book) => {
      window.__kutadguSkipAdminAuth = true;
      window.__kutadguSkipSuggestFetch = true;
      window.__kutadguSuggestionRows = [
        { id: 8, title: "باشقا", author: "ئابدۇللا ھاجى روزى", translator: "", publisher: "", isbn: "" }
      ];
      window.__kutadguPendingSaves = [];
      window.__kutadguBookSaves = [];
      window.__kutadguPendingSubmissionFixtures = [JSON.parse(JSON.stringify(book))];
      window.__kutadguAdminPersistPending = async (id, payload) => {
        window.__kutadguPendingSaves.push({ id: Number(id), payload: { ...payload } });
        const row = window.__kutadguPendingSubmissionFixtures.find((b) => String(b.id) === String(id));
        if (row) Object.assign(row, payload, { submission_status: "pending", is_active: false, is_available: false });
        return { error: null };
      };
      window.__kutadguAdminPersistBook = async (payload, operation, id) => {
        window.__kutadguBookSaves.push({ payload: { ...payload }, operation, id: String(id || "") });
        return { error: new Error("pending save must not use persistBookRow") };
      };
    }, PENDING_BOOK);
    await page.goto("/admin.html#submissions", { waitUntil: "domcontentloaded" });
    await page.locator('[data-admin-section="submissions"]').click();
    await page.locator("[data-edit-submission]").click();
    await expect(page.locator("#bookTitle")).toHaveValue(PENDING_BOOK.title);
    await expect(page.locator("#bookAuthor")).toHaveValue(PENDING_BOOK.author);
    await page.locator("#bookAuthor").fill("ھاجى");
    const pendingAuthorList = page.locator("#bookAuthor").locator("xpath=following-sibling::ul[@role='listbox']");
    await expect(pendingAuthorList.locator("[role='option']")).toHaveCount(1);
    await page.locator("#bookAuthor").fill(PENDING_BOOK.author);
    await page.locator("#bookSaveBtn").click();
    await expect(page.locator("#bookModal")).toBeHidden();
    const result = await page.evaluate(() => ({
      pending: window.__kutadguPendingSaves.slice(),
      books: window.__kutadguBookSaves.slice()
    }));
    expect(result.pending.length).toBe(1);
    expect(result.books.length).toBe(0);
    expect(result.pending[0].payload.is_active).toBeUndefined();
  });

  for (const width of [390, 768, 1366]) {
    test(`no horizontal overflow at ${width}px with dropdown open`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await openAdminEditor(page);
      await page.locator("#bookAuthor").fill("ھاجى");
      await expect(page.locator("#bookAuthor").locator("xpath=following-sibling::ul[@role='listbox']")).toBeVisible();
      await noOverflow(page);
    });
  }

  for (const width of [390, 768, 1366]) {
    test(`Book Staff has no horizontal overflow at ${width}px with dropdown open`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await openStaffForm(page);
      await page.locator("#staffAuthor").fill("ھاجى");
      await expect(page.locator("#staffAuthor").locator("xpath=following-sibling::ul[@role='listbox']")).toBeVisible();
      await noOverflow(page);
    });
  }
});
