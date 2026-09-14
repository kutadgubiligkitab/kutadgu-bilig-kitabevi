const { test, expect } = require("./playwright-test");
const path = require("path");

const COVER = "https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/staff/demo/cover.jpg";
const G1 = "https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/staff/demo/g1.jpg";
const G2 = "https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/staff/demo/g2.jpg";
const GALLERY_STUB = path.join(__dirname, "..", "fixtures", "ci-book-cover-stub.png");

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
  description: "قىسقىچە چۈشەندۈرۈش",
  image_url: COVER,
  gallery_images: [G1, G2],
  submitted_by: "staff-user",
  submitted_at: "2026-09-01T10:00:00.000Z",
  submission_status: "pending",
  is_active: false,
  is_available: false
};

async function openPendingAdmin(page) {
  page.on("dialog", (dialog) => dialog.accept());
  await page.addInitScript((book) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguPendingSaves = [];
    window.__kutadguBookSaves = [];
    window.__kutadguReviews = [];
    const key = "kutadgu-pending-1j-fixtures";
    const stored = sessionStorage.getItem(key);
    window.__kutadguPendingSubmissionFixtures = stored
      ? JSON.parse(stored)
      : [JSON.parse(JSON.stringify(book))];
    const persistFixtures = () => {
      sessionStorage.setItem(key, JSON.stringify(window.__kutadguPendingSubmissionFixtures));
    };
    persistFixtures();
    window.__kutadguAdminPersistBook = async (payload, operation, id) => {
      window.__kutadguBookSaves.push({ payload: { ...payload }, operation, id: String(id || "") });
      return { error: new Error("pending save must not use persistBookRow") };
    };
    window.__kutadguAdminPersistPending = async (id, payload) => {
      window.__kutadguPendingSaves.push({
        id: Number(id),
        payload: JSON.parse(JSON.stringify(payload))
      });
      const row = window.__kutadguPendingSubmissionFixtures.find((b) => String(b.id) === String(id));
      if (row) {
        Object.assign(row, payload, {
          submission_status: "pending",
          is_active: false,
          is_available: false
        });
        persistFixtures();
      }
      return { error: null };
    };
    window.__kutadguAdminReviewStaff = async (id, approve) => {
      const row = window.__kutadguPendingSubmissionFixtures.find((b) => String(b.id) === String(id));
      window.__kutadguReviews.push({
        id: Number(id),
        approve,
        title: row && row.title,
        payloadTitle: row && row.title,
        is_active: row && row.is_active,
        submission_status: row && row.submission_status
      });
      if (row) {
        row.submission_status = approve ? "approved" : "rejected";
        row.is_active = !!approve;
        persistFixtures();
      }
      return { error: null };
    };
  }, PENDING_BOOK);
  await page.goto("/admin.html#submissions", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  await page.locator('[data-admin-section="submissions"]').click();
  await expect(page.locator("#submissionsCard")).toBeVisible();
  await expect(page.locator(".admin-submission-row")).toHaveCount(1);
}

async function noOverflow(page) {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth
  }));
  expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.client + 1);
}

test.describe("Stage Admin 1J pending book edit", () => {
  test("A-F Full Admin can prefills, cancel, save pending edits", async ({ page }) => {
    await openPendingAdmin(page);
    await expect(page.locator("[data-edit-submission]")).toHaveText("تەھرىرلەش");
    await expect(page.locator("[data-approve-submission]")).toHaveText("تەستىقلاش");
    await expect(page.locator("[data-reject-submission]")).toHaveText("رەت قىلىش");
    await expect(page.locator(".admin-submission-status")).toHaveText("تەستىق كۈتۈۋاتىدۇ");
    await expect(page.locator(".admin-submission-title")).toHaveText(PENDING_BOOK.title);

    await page.locator("[data-edit-submission]").click();
    await expect(page.locator("#bookModal")).toBeVisible();
    await expect(page.locator("#bookModalTitle")).toHaveText("كىتاب ئۇچۇرلىرىنى تەكشۈرۈش");
    await expect(page.locator("#pendingEditHelp")).toBeVisible();
    await expect(page.locator("#bookSaveBtn")).toHaveText("ئۆزگەرتىشلەرنى ساقلاش");
    await expect(page.locator("#cancelBookEdit")).toHaveText("بىكار قىلىش");
    await expect(page.locator("#bookTitle")).toHaveValue(PENDING_BOOK.title);
    await expect(page.locator("#bookAuthor")).toHaveValue(PENDING_BOOK.author);
    await expect(page.locator("#bookTranslator")).toHaveValue(PENDING_BOOK.translator);
    await expect(page.locator("#bookPublisher")).toHaveValue(PENDING_BOOK.publisher);
    await expect(page.locator("#bookIsbn")).toHaveValue(PENDING_BOOK.isbn);
    await expect(page.locator("#bookPrice")).toHaveValue(String(PENDING_BOOK.price));
    await expect(page.locator("#bookCoverPreview")).toHaveAttribute("src", COVER);
    await expect(page.locator("#bookGalleryList img").nth(0)).toHaveAttribute("src", G1);
    await expect(page.locator("#bookGalleryList img").nth(1)).toHaveAttribute("src", G2);
    await expect(page.locator("#bookIsActive")).toBeHidden();

    await page.locator("#bookTitle").fill("ئۆزگەرتىلگەن ۋاقىتلىق نام");
    await page.locator("#cancelBookEdit").click();
    await expect(page.locator("#bookModal")).toBeHidden();
    await expect(page.locator(".admin-submission-title")).toHaveText(PENDING_BOOK.title);
    const savesAfterCancel = await page.evaluate(() => window.__kutadguPendingSaves.length);
    expect(savesAfterCancel).toBe(0);

    await page.locator("[data-edit-submission]").click();
    await expect(page.locator("#bookTitle")).toHaveValue(PENDING_BOOK.title);
    await page.locator("#bookTitle").fill("تۈزىتىلگەن كىتاب نامى");
    await page.locator("#bookSaveBtn").click();
    await expect(page.locator("#bookModal")).toBeHidden();
    await expect(page.locator("#pendingSubmissionStatus")).toContainText("ئۆزگەرتىشلەر ساقلىنىپ بولدى");
    await expect(page.locator(".admin-submission-title")).toHaveText("تۈزىتىلگەن كىتاب نامى");
    await expect(page.locator(".admin-submission-status")).toHaveText("تەستىق كۈتۈۋاتىدۇ");

    const save = await page.evaluate(() => ({
      pending: window.__kutadguPendingSaves,
      books: window.__kutadguBookSaves
    }));
    expect(save.books).toEqual([]);
    expect(save.pending).toHaveLength(1);
    expect(save.pending[0].payload.title).toBe("تۈزىتىلگەن كىتاب نامى");
    expect(save.pending[0].payload.author).toBe(PENDING_BOOK.author);
    expect(save.pending[0].payload.image_url).toBe(COVER);
    expect(save.pending[0].payload.gallery_images).toEqual([G1, G2]);
    expect(save.pending[0].payload).not.toHaveProperty("is_active");
    expect(save.pending[0].payload).not.toHaveProperty("is_available");
    expect(save.pending[0].payload).not.toHaveProperty("submission_status");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-admin-section="submissions"]').click();
    await expect(page.locator(".admin-submission-title")).toHaveText("تۈزىتىلگەن كىتاب نامى");
    await expect(page.locator(".admin-submission-status")).toHaveText("تەستىق كۈتۈۋاتىدۇ");
  });

  test("G-H approve uses edited values; reject still works", async ({ page }) => {
    await openPendingAdmin(page);
    await page.locator("[data-edit-submission]").click();
    await page.locator("#bookTitle").fill("تەستىقلىنىدىغان نام");
    await page.locator("#bookSaveBtn").click();
    await expect(page.locator(".admin-submission-title")).toHaveText("تەستىقلىنىدىغان نام");
    await page.locator("[data-approve-submission]").click();
    await expect(page.locator(".admin-submission-row")).toHaveCount(0);
    const review = await page.evaluate(() => window.__kutadguReviews[0]);
    expect(review.approve).toBe(true);
    expect(review.title).toBe("تەستىقلىنىدىغان نام");
    expect(review.submission_status).toBe("pending");
  });

  test("H reject still works on an unedited pending card", async ({ page }) => {
    await openPendingAdmin(page);
    await page.locator("[data-reject-submission]").click();
    await expect(page.locator(".admin-submission-row")).toHaveCount(0);
    const review = await page.evaluate(() => window.__kutadguReviews[0]);
    expect(review.approve).toBe(false);
    expect(review.title).toBe(PENDING_BOOK.title);
  });

  test("L-N cover/gallery stay untouched; gallery max 4 still enforced", async ({ page }) => {
    await openPendingAdmin(page);
    await page.locator("[data-edit-submission]").click();
    await expect(page.locator("#bookGalleryList .admin-gallery-item")).toHaveCount(2);
    await page.locator("#bookSaveBtn").click();
    const payload = await page.evaluate(() => window.__kutadguPendingSaves[0].payload);
    expect(payload.image_url).toBe(COVER);
    expect(payload.gallery_images).toEqual([G1, G2]);

    await page.locator("[data-edit-submission]").click();
    page.once("dialog", (dialog) => dialog.accept());
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.locator("#bookGalleryPickBtn").click()
    ]);
    await chooser.setFiles([GALLERY_STUB, GALLERY_STUB, GALLERY_STUB]);
    await expect.poll(async () => page.locator("#bookGalleryList .admin-gallery-item").count()).toBeLessThanOrEqual(4);
  });

  test("R pending editor has no horizontal overflow at 390/768/1366", async ({ page }) => {
    await openPendingAdmin(page);
    await page.locator("[data-edit-submission]").click();
    await expect(page.locator("#bookModal")).toBeVisible();
    for (const width of [390, 768, 1366]) {
      await page.setViewportSize({ width, height: 844 });
      await noOverflow(page);
    }
  });

  test("I-J member and book staff pages have no pending-edit controls", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-edit-submission]")).toHaveCount(0);
    await expect(page.locator("#bookSaveBtn")).toHaveCount(0);
    await page.goto("/book-staff.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-edit-submission]")).toHaveCount(0);
    const staffSource = await page.evaluate(async () => {
      const res = await fetch("book-staff.js");
      return res.text();
    });
    expect(staffSource).not.toMatch(/update_pending_staff_book_submission/);
    expect(staffSource).not.toMatch(/\.from\("books"\)\.(update|insert|upsert|delete)/);
  });
});
