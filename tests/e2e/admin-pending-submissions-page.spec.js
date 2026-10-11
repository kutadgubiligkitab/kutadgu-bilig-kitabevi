const { test, expect } = require("./playwright-test");

function pendingBooks(count, extras = []) {
  const rows = [];
  for (let i = 1; i <= count; i++) {
    rows.push({
      id: 5000 + i,
      title: `تەستىق كىتاب ${String(i).padStart(2, "0")}`,
      author: i === 4 ? "ئالاھىدە ئاپتور" : `ئاپتور ${i}`,
      translator: i === 2 ? "پەقەت تەرجىمان سۆز" : "",
      isbn: `97800000${String(i).padStart(5, "0")}`,
      price: 10,
      stock: 1,
      category: "ئۇنىۋېرسال",
      source: "universal.html",
      image_url: "",
      gallery_images: [],
      submitted_by: "staff",
      submitted_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      submission_status: "pending",
      is_active: false,
      is_available: false
    });
  }
  return rows.concat(extras);
}

function approvedExtra() {
  return {
    id: 5999,
    title: "تەستىقلانغان كىتاب",
    author: "ئاپتور",
    translator: "",
    isbn: "9780000099999",
    price: 10,
    stock: 1,
    category: "ئۇنىۋېرسال",
    source: "universal.html",
    image_url: "",
    gallery_images: [],
    submitted_by: "staff",
    submitted_at: "2026-12-01T00:00:00.000Z",
    submission_status: "approved",
    is_active: true,
    is_available: true
  };
}

function pageLabel(page, pages, total) {
  return `${page} / ${pages} · جەمئىي ${total} كىتاب · ھەر بەتتە 10`;
}

async function openPending(page, rows, { review = false } = {}) {
  await page.addInitScript(({ rows, review }) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguPendingSubmissionFixtures = rows;
    if (review) {
      window.__kutadguAdminReviewStaff = async (id) => {
        const row = window.__kutadguPendingSubmissionFixtures.find((b) => String(b.id) === String(id));
        if (row) row.submission_status = "approved";
        return { error: null };
      };
    }
  }, { rows, review });
  await page.goto("/admin.html#submissions", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  await page.locator('[data-admin-section="submissions"]').click();
  await expect(page.locator("#submissionsCard")).toBeVisible();
}

async function expectQueue(page, rows, total, label) {
  await expect(page.locator(".admin-submission-row")).toHaveCount(rows);
  await expect(page.locator("#pendingSubmissionCount")).toHaveText(`تەستىق ساقلاۋاتقان: ${total}`);
  if (!total) {
    await expect(page.locator("#pendingSubmissionPager")).toBeHidden();
    const term = (await page.locator("#pendingSubmissionSearch").inputValue()).trim();
    const copy = term ? "بۇ ئىزدەشكە ماس كىتاب تېپىلمىدى." : "تەستىق كۈتۈۋاتقان كىتاب يوق.";
    await expect(page.locator("#pendingSubmissionStatus")).toHaveText(copy);
    await expect(page.locator("#pendingSubmissionList")).toContainText(copy);
    return;
  }
  await expect(page.locator("#pendingSubmissionPager span")).toHaveText(label);
  await expect(page.locator("#pendingSubmissionStatus")).toHaveText(`تەستىق كۈتۈۋاتقان ${total} كىتاب.`);
}

test.describe("pending submission pages of 10", () => {
  test("0 matching rows keep a zero total and no page of cards", async ({ page }) => {
    await openPending(page, [approvedExtra()]);
    await expectQueue(page, 0, 0);
    await expect(page.locator("#pendingSubmissionList")).toContainText("تەستىق كۈتۈۋاتقان كىتاب يوق");
  });

  test("1 matching row stays one card with total 1", async ({ page }) => {
    await openPending(page, pendingBooks(1));
    await expectQueue(page, 1, 1, pageLabel(1, 1, 1));
    await expect(page.locator(".admin-submission-title")).toHaveText("تەستىق كىتاب 01");
    await expect(page.locator("[data-edit-submission]")).toHaveText("تەھرىرلەش");
    await expect(page.locator("[data-approve-submission]")).toHaveText("تەستىقلاش");
    await expect(page.locator("[data-reject-submission]")).toHaveText("رەت قىلىش");
    await expect(page.locator("[data-pending-page='next']")).toBeDisabled();
    await expect(page.locator("[data-pending-page='prev']")).toBeDisabled();
  });

  test("10 matching rows fill one page and leave the next control off", async ({ page }) => {
    await openPending(page, pendingBooks(10));
    await expectQueue(page, 10, 10, pageLabel(1, 1, 10));
    await expect(page.locator(".admin-submission-title").first()).toHaveText("تەستىق كىتاب 10");
    await expect(page.locator(".admin-submission-title").last()).toHaveText("تەستىق كىتاب 01");
    await expect(page.locator("[data-pending-page='next']")).toBeDisabled();
  });

  test("11 matching rows split 10 and 1 while the total stays 11", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openPending(page, pendingBooks(11, [approvedExtra()]), { review: true });
    await expectQueue(page, 10, 11, pageLabel(1, 2, 11));
    await expect(page.locator(".admin-submission-title").first()).toHaveText("تەستىق كىتاب 11");
    const titles = await page.locator(".admin-submission-title").allTextContents();
    expect(titles).not.toContain("تەستىقلانغان كىتاب");
    await page.locator("[data-pending-page='next']").click();
    await expectQueue(page, 1, 11, pageLabel(2, 2, 11));
    await expect(page.locator(".admin-submission-title")).toHaveText("تەستىق كىتاب 01");
    await expect(page.locator("[data-pending-page='next']")).toBeDisabled();
    page.on("dialog", (dialog) => dialog.accept());
    await page.locator("[data-approve-submission]").click();
    await expectQueue(page, 10, 10, pageLabel(1, 1, 10));
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 768, height: 900 },
      { width: 390, height: 800 }
    ]) {
      await page.setViewportSize(viewport);
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth
      }));
      expect(overflow.scroll, JSON.stringify({ viewport, overflow })).toBeLessThanOrEqual(overflow.client + 1);
    }
  });

  test("20 matching rows are two full pages of 10", async ({ page }) => {
    await openPending(page, pendingBooks(20));
    await expectQueue(page, 10, 20, pageLabel(1, 2, 20));
    await page.locator("[data-pending-page='next']").click();
    await expectQueue(page, 10, 20, pageLabel(2, 2, 20));
    await expect(page.locator(".admin-submission-title").first()).toHaveText("تەستىق كىتاب 10");
    await expect(page.locator(".admin-submission-title").last()).toHaveText("تەستىق كىتاب 01");
    await expect(page.locator("[data-pending-page='next']")).toBeDisabled();
  });

  test("21 matching rows end on a last page of 1", async ({ page }) => {
    await openPending(page, pendingBooks(21));
    await expectQueue(page, 10, 21, pageLabel(1, 3, 21));
    await page.locator("[data-pending-page='next']").click();
    await expectQueue(page, 10, 21, pageLabel(2, 3, 21));
    await page.locator("[data-pending-page='next']").click();
    await expectQueue(page, 1, 21, pageLabel(3, 3, 21));
    await expect(page.locator(".admin-submission-title")).toHaveText("تەستىق كىتاب 01");
  });

  test("60 matching rows are six pages of 10", async ({ page }) => {
    await openPending(page, pendingBooks(60));
    await expectQueue(page, 10, 60, pageLabel(1, 6, 60));
    await expect(page.locator(".admin-submission-title").first()).toHaveText("تەستىق كىتاب 60");
    for (let pageNo = 2; pageNo <= 6; pageNo++) {
      await page.locator("[data-pending-page='next']").click();
      await expectQueue(page, 10, 60, pageLabel(pageNo, 6, 60));
    }
    await expect(page.locator(".admin-submission-title").first()).toHaveText("تەستىق كىتاب 10");
    await expect(page.locator(".admin-submission-title").last()).toHaveText("تەستىق كىتاب 01");
    await expect(page.locator("[data-pending-page='next']")).toBeDisabled();
  });

  test("title, author, and ISBN search reset to the first page", async ({ page }) => {
    await openPending(page, pendingBooks(21));
    await page.locator("[data-pending-page='next']").click();
    await expectQueue(page, 10, 21, pageLabel(2, 3, 21));
    await page.locator("#pendingSubmissionSearch").fill("ئالاھىدە ئاپتور");
    await expectQueue(page, 1, 1, pageLabel(1, 1, 1));
    await expect(page.locator(".admin-submission-title")).toHaveText("تەستىق كىتاب 04");
    await page.locator("#pendingSubmissionSearch").fill("978-0000000004");
    await expectQueue(page, 1, 1, pageLabel(1, 1, 1));
    await expect(page.locator(".admin-submission-title")).toHaveText("تەستىق كىتاب 04");
    await page.locator("#pendingSubmissionSearch").fill("تەستىق كىتاب 15");
    await expectQueue(page, 1, 1, pageLabel(1, 1, 1));
    await expect(page.locator(".admin-submission-title")).toHaveText("تەستىق كىتاب 15");
    await page.locator("#pendingSubmissionSearch").fill("پەقەت تەرجىمان سۆز");
    await expectQueue(page, 0, 0);
    await page.locator("#pendingSubmissionSearch").fill("");
    await expectQueue(page, 10, 21, pageLabel(1, 3, 21));
    await expect(page.locator(".admin-submission-title").first()).toHaveText("تەستىق كىتاب 21");
  });
});
