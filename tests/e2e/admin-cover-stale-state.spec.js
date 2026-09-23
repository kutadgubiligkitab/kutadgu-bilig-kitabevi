const { test, expect } = require("./playwright-test");
const path = require("path");

const STUB = path.join(__dirname, "..", "fixtures", "ci-book-cover-stub.png");
const COVER = "https://cdn.example/book-a.webp";

const FIXTURES = [
  {
    id: 1,
    title: "Book A",
    author: "Author A",
    price: 10,
    source: "universal.html",
    category: "ئۇنىۋېرسال",
    image_url: COVER,
    is_active: true,
    isbn: "9781111111111",
    description: "desc"
  }
];

async function openAdmin(page, persist) {
  page.on("dialog", (dialog) => dialog.accept());
  await page.addInitScript((books) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguAdminPreviewBooks = books;
    window.__kutadguBookSaves = [];
    window.__kutadguAdminPersistBook = async (payload, operation, id) => {
      const forced = window.__kutadguForceBookSaveError;
      window.__kutadguBookSaves.push({
        payload: { ...payload },
        operation,
        id: String(id || ""),
        failed: !!forced
      });
      if (forced) return { error: { message: "forced cover save failure" } };
      return { error: null, data: [{ id: id || "created" }] };
    };
  }, FIXTURES);
  if (persist) await persist(page);
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
}

async function fillNewBook(page, title, withCover) {
  await page.locator("#newBookBtn").click();
  await expect(page.locator("#bookModal")).toBeVisible();
  await expect(page.locator("#bookCoverPickStatus")).toHaveText("مۇقاۋا رەسىمى تاللانمىدى");
  await page.locator("#bookTitle").fill(title);
  await page.locator("#bookAuthor").fill("Author");
  await page.locator("#bookPrice").fill("21");
  await page.locator("#bookSource").selectOption("universal.html");
  if (withCover) {
    await page.locator("#bookCover").setInputFiles(STUB);
    await expect(page.locator("#bookCoverPickStatus")).toHaveText("مۇقاۋا رەسىمى تاللاندى");
  }
}

test.describe("admin cover selection cannot leak into the next book", () => {
  test("A saved cover is not reused by the next new book", async ({ page }) => {
    await openAdmin(page);
    await fillNewBook(page, "Book A Create", true);
    await page.locator("#bookForm button[type='submit']").click();
    await expect(page.locator("#bookModal")).toBeHidden();
    await expect.poll(async () => page.evaluate(() => window.__kutadguBookSaves.length)).toBe(1);
    const first = await page.evaluate(() => window.__kutadguBookSaves[0]);
    expect(first.operation).toBe("INSERT");
    expect(first.payload.image_url).toMatch(/admin-preview-covers/);
    expect(first.payload.image_url).not.toMatch(/sample-book-cover/);

    await fillNewBook(page, "Book B Create", false);
    const files = await page.locator("#bookCover").evaluate((input) => input.files.length);
    expect(files).toBe(0);
    await page.locator("#bookForm button[type='submit']").click();
    await expect(page.locator("#bookModal")).toBeVisible();
    const saves = await page.evaluate(() => window.__kutadguBookSaves.slice());
    expect(saves).toHaveLength(1);
    expect(saves[0].payload.title).toBe("Book A Create");
  });

  test("B cancelled cover is not reused by the next new book", async ({ page }) => {
    await openAdmin(page);
    await fillNewBook(page, "Cancelled A", true);
    await page.locator("#closeBookModal").click();
    await expect(page.locator("#bookModal")).toBeHidden();
    await fillNewBook(page, "Book B After Cancel", false);
    const files = await page.locator("#bookCover").evaluate((input) => input.files.length);
    expect(files).toBe(0);
    await page.locator("#bookForm button[type='submit']").click();
    await expect(page.locator("#bookModal")).toBeVisible();
    const saves = await page.evaluate(() => window.__kutadguBookSaves.slice());
    expect(saves).toHaveLength(0);
  });

  test("C failed save does not leave its cover on the next new book", async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => { window.__kutadguForceBookSaveError = true; });
    await fillNewBook(page, "Failed A", true);
    await page.locator("#bookForm button[type='submit']").click();
    await expect.poll(async () => page.evaluate(() => window.__kutadguBookSaves.length)).toBe(1);
    await expect(page.locator("#bookModal")).toBeVisible();
    await page.locator("#closeBookModal").click();
    await expect(page.locator("#bookModal")).toBeHidden();
    await page.evaluate(() => { window.__kutadguForceBookSaveError = false; });
    await fillNewBook(page, "Book B After Failure", false);
    const files = await page.locator("#bookCover").evaluate((input) => input.files.length);
    expect(files).toBe(0);
    await page.locator("#bookForm button[type='submit']").click();
    await expect(page.locator("#bookModal")).toBeVisible();
    const saves = await page.evaluate(() => window.__kutadguBookSaves.slice());
    expect(saves).toHaveLength(1);
    expect(saves[0].failed).toBe(true);
    expect(saves[0].payload.title).toBe("Failed A");
  });

  test("D edit without a new file keeps the book's own image_url", async ({ page }) => {
    await openAdmin(page);
    await fillNewBook(page, "Unrelated", true);
    await page.locator("#closeBookModal").click();
    await page.locator('article[data-book-id="1"] [data-edit]').click();
    await expect(page.locator("#bookModal")).toBeVisible();
    await expect(page.locator("#bookCoverPickStatus")).toHaveText("مۇقاۋا رەسىمى تاللانمىدى");
    const files = await page.locator("#bookCover").evaluate((input) => input.files.length);
    expect(files).toBe(0);
    await page.locator("#bookForm button[type='submit']").click();
    await expect(page.locator("#bookModal")).toBeHidden();
    const call = await page.evaluate(() => window.__kutadguBookSaves[0]);
    expect(call.operation).toBe("UPDATE");
    expect(call.payload.image_url).toBe(COVER);
  });
});
