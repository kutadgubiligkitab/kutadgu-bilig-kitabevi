const { test, expect } = require("./playwright-test");
const path = require("path");

const COVER = "https://cdn.example/cover.webp";
const EXTRA_A = "https://cdn.example/toc.webp";
const STUB = path.join(__dirname, "..", "fixtures", "ci-book-cover-stub.png");

const FIXTURES = [
  {
    id: 1,
    title: "Cover Book",
    author: "Author A",
    price: 10,
    source: "universal.html",
    category: "ئۇنىۋېرسال",
    image_url: COVER,
    gallery_images: [EXTRA_A],
    is_active: true,
    isbn: "9781111111111",
    description: "desc"
  }
];

async function openAdminBooks(page) {
  page.on("dialog", (dialog) => dialog.accept());
  await page.addInitScript((books) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguAdminPreviewBooks = books;
    window.__kutadguBookSaves = [];
    window.__kutadguAdminPersistBook = async (payload, operation, id) => {
      window.__kutadguBookSaves.push({ payload: { ...payload }, operation, id: String(id || "") });
      return { error: null, data: [{ id }] };
    };
  }, FIXTURES);
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
}

async function noOverflow(page) {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth
  }));
  expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.client + 1);
}

function nativePickerRe() {
  return /Choose File|No file chosen|Dosya Seç|Dosya seçilmedi|Dosya Seçilmedi/i;
}

test.describe("admin Uyghur main cover picker", () => {
  test("create form hides native picker text and uses Uyghur controls", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator("#newBookBtn").click();
    await expect(page.locator("#bookModal")).toBeVisible();
    await expect(page.locator("#bookCoverPickBtn")).toBeVisible();
    await expect(page.locator("#bookCoverPickBtn")).toHaveText("مۇقاۋا رەسىمى تاللاش");
    await expect(page.locator("#bookCoverPickStatus")).toHaveText("مۇقاۋا رەسىمى تاللانمىدى");
    await expect(page.locator("#bookCover")).toBeAttached();
    await expect(page.locator("#bookCoverPickBtn")).toHaveAttribute("aria-controls", "bookCover");
    const pickerText = await page.locator(".admin-cover-picker").innerText();
    expect(pickerText).not.toMatch(nativePickerRe());
    const box = await page.locator("#bookCover").boundingBox();
    expect(box).toBeTruthy();
    expect(box.width).toBeLessThanOrEqual(2);
    expect(box.height).toBeLessThanOrEqual(2);
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.locator("#bookCoverPickBtn").click()
    ]);
    expect(chooser.isMultiple()).toBe(false);
    await chooser.setFiles(STUB);
    await expect(page.locator("#bookCoverPickStatus")).toHaveText("مۇقاۋا رەسىمى تاللاندى");
    await expect(page.locator("#bookCoverText")).toHaveText("ci-book-cover-stub.png");
    await expect.poll(async () => page.locator("#bookCoverPreview").evaluate((img) => img.style.visibility)).toBe("visible");
    await expect.poll(async () => page.locator("#bookCoverPreview").evaluate((img) => String(img.src || "").startsWith("blob:"))).toBe(true);
    await page.locator("#clearCoverPick").click();
    await expect(page.locator("#bookCoverPickStatus")).toHaveText("مۇقاۋا رەسىمى تاللانمىدى");
    await expect(page.locator("#bookCoverPreview")).toHaveCSS("visibility", "hidden");
  });

  test("edit keeps image_url when no new cover is chosen", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator('article[data-book-id="1"] [data-edit]').click();
    await expect(page.locator("#bookModal")).toBeVisible();
    await expect(page.locator("#bookCoverPickStatus")).toHaveText("مۇقاۋا رەسىمى تاللانمىدى");
    await expect(page.locator("#bookCoverPreview")).toHaveAttribute("src", COVER);
    await expect(page.locator("#bookCoverText")).toContainText("ھازىرقى مۇقاۋا");
    await page.locator("#bookForm button[type='submit']").click();
    await expect(page.locator("#bookModal")).toBeHidden();
    const call = await page.evaluate(() => window.__kutadguBookSaves[0]);
    expect(call.operation).toBe("UPDATE");
    expect(call.payload.image_url).toBe(COVER);
  });

  test("clear after picking a cover on an existing book restores image_url preview", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator('article[data-book-id="1"] [data-edit]').click();
    await expect(page.locator("#bookModal")).toBeVisible();
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.locator("#bookCoverPickBtn").click()
    ]);
    await chooser.setFiles(STUB);
    await expect(page.locator("#bookCoverPickStatus")).toHaveText("مۇقاۋا رەسىمى تاللاندى");
    await page.locator("#clearCoverPick").click();
    await expect(page.locator("#bookCoverPickStatus")).toHaveText("مۇقاۋا رەسىمى تاللانمىدى");
    await expect(page.locator("#bookCoverPreview")).toHaveAttribute("src", COVER);
    await expect(page.locator("#bookCoverText")).toContainText("ھازىرقى مۇقاۋا");
  });

  test("gallery picker from PR 112 is unchanged", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator('article[data-book-id="1"] [data-edit]').click();
    await expect(page.locator("#bookGalleryPickBtn")).toHaveText("رەسىم تاللاش");
    await expect(page.locator("#bookGalleryPickStatus")).toHaveText("رەسىم تاللانمىدى");
    await expect(page.locator("[data-gallery-remove]")).toHaveCount(1);
    await expect(page.locator("[data-gallery-remove]")).toHaveAttribute("aria-label", "ئۆچۈرۈش");
  });

  for (const width of [390, 430, 768, 1366]) {
    test(`cover picker has no overflow at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width >= 1366 ? 900 : 844 });
      await openAdminBooks(page);
      await page.locator("#newBookBtn").click();
      await expect(page.locator("#bookCoverPickBtn")).toBeVisible();
      await noOverflow(page);
    });
  }

  test("Hero Admin remains on storefront section", async ({ page }) => {
    await openAdminBooks(page);
    await page.locator('[data-admin-section="storefront"]').click();
    await expect(page.locator("#heroAdminCard")).toBeVisible();
    await expect(page.locator("#heroSave")).toBeVisible();
  });
});
