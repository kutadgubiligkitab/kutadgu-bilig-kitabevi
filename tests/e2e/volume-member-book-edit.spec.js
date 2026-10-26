const fs = require("fs");
const path = require("path");
const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const STUB = path.join(__dirname, "..", "fixtures", "ci-book-cover-stub.png");
const appConfig = fs.readFileSync(path.join(__dirname, "..", "..", "app-config.js"), "utf8");

const books = [
  { id: 301, title: "ئالما خاتىرىسى", author: "مۇئەللىپ", price: 120, stock: 4, image_url: "/sample-book-cover.png", isbn: "", source: "universal.html", category: "ئۇنىۋېرسال", description: "بىرىنچى", is_active: true, is_new: false, is_recommended: false, sales_count: 0, pages: null, href: "/book/301" },
  { id: 302, title: "ئالما داۋامى", author: "مۇئەللىپ", price: 80, stock: 6, image_url: "/sample-book-cover.png", isbn: "", source: "universal.html", category: "ئۇنىۋېرسال", description: "ئىككىنچى", is_active: true, is_new: false, is_recommended: false, sales_count: 0, pages: 40, href: "/book/302" },
  { id: 401, title: "باشقا بىرى", author: "باشقا", price: 10, stock: 1, image_url: "/sample-book-cover.png", isbn: "", source: "universal.html", category: "ئۇنىۋېرسال", description: "", is_active: true, pages: null, href: "/book/401" },
  { id: 402, title: "باشقا ئىككى", author: "باشقا", price: 11, stock: 1, image_url: "/sample-book-cover.png", isbn: "", source: "universal.html", category: "ئۇنىۋېرسال", description: "", is_active: true, pages: null, href: "/book/402" }
];

function group(id) {
  if (String(id) === "88") {
    return {
      id: 88, revision: 1, slug: "other-series", title: "باشقا يۈرۈشلۈك", author: "باشقا",
      category: "ئۇنىۋېرسال", source: "universal.html", description: "باشقا چۈشەندۈرۈش",
      is_public: false, is_active: true, representative_book_id: "401",
      members: [
        { book_id: "401", position: 1, volume_label: "باشقا 1", title: "باشقا بىرى", author: "باشقا", price: 10, stock: 1, image_url: "/sample-book-cover.png", url: "/book/401" },
        { book_id: "402", position: 2, volume_label: "باشقا 2", title: "باشقا ئىككى", author: "باشقا", price: 11, stock: 1, image_url: "/sample-book-cover.png", url: "/book/402" }
      ]
    };
  }
  return {
    id: 55, revision: 2, slug: "alma", title: "ئالما يۈرۈشلۈكى", author: "مۇئەللىپ",
    category: "ئۇنىۋېرسال", source: "universal.html", description: "ئەسلى چۈشەندۈرۈش",
    is_public: true, is_active: true, representative_book_id: "301",
    members: [
      { book_id: "301", position: 1, volume_label: "1-قىسىم", title: "ئالما خاتىرىسى", author: "مۇئەللىپ", price: 120, stock: 4, image_url: "/sample-book-cover.png", url: "/book/301", pages: null },
      { book_id: "302", position: 2, volume_label: "2-قىسىم", title: "ئالما داۋامى", author: "مۇئەللىپ", price: 80, stock: 6, image_url: "/sample-book-cover.png", url: "/book/302", pages: 40 }
    ]
  };
}

async function openSavedSeries(page) {
  page.on("dialog", (dialog) => dialog.accept());
  await page.addInitScript((rows) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguSkipSuggestFetch = true;
    window.__kutadguAdminPreviewBooks = rows;
    window.__kutadguBookSaves = [];
    window.__holdBookSave = false;
    window.__bookSaveHeld = false;
    window.__failBookSave = false;
    window.__kutadguAdminFetchBook = async (id) => {
      const row = (window.__kutadguAdminPreviewBooks || []).find((book) => String(book.id) === String(id));
      return row ? { ...row } : null;
    };
    window.__kutadguAdminPersistBook = async (payload, operation, id) => {
      if (window.__holdBookSave) {
        window.__bookSaveHeld = true;
        await new Promise((resolve) => { window.__releaseBookSave = resolve; });
        window.__holdBookSave = false;
      }
      if (window.__failBookSave) {
        window.__failBookSave = false;
        return { error: { message: "save_failed" } };
      }
      const saved = { payload: { ...payload }, operation, id: String(id || "") };
      window.__kutadguBookSaves.push(saved);
      const row = (window.__kutadguAdminPreviewBooks || []).find((book) => String(book.id) === String(id));
      if (row && payload && Object.prototype.hasOwnProperty.call(payload, "pages")) row.pages = payload.pages;
      return { error: null, data: [{ id }] };
    };
  }, books);
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  await page.evaluate((listed) => {
    window.__volumeEditorCalls = [];
    window.__groups = listed;
    window.KutadguAdminVolumeGroups.init({
      db: {
        async rpc(name, args) {
          window.__volumeEditorCalls.push({ name, args });
          if (name === "admin_list_book_volume_groups") {
            return { data: window.__groups.map((row) => ({ id: row.id, title: row.title, slug: row.slug, member_count: row.members.length, is_public: row.is_public })) };
          }
          if (name === "admin_get_book_volume_group") {
            return { data: window.__groups.find((row) => String(row.id) === String(args && args.p_group_id)) || null };
          }
          return { data: [] };
        }
      }
    });
  }, [group(55), group(88)]);
  await page.locator('button[data-admin-section="volume-groups"]').click();
  await page.locator("#showVolumeSeriesBtn").click();
  await page.locator("[data-series-cover]").first().setInputFiles(STUB);
  await page.locator("#showVolumeLinkBtn").click();
  await page.locator("#volumeGroupListToggle").click();
  await page.locator("[data-volume-group-edit='55']").click();
  await expect(page.locator("#volumeGroupId")).toHaveValue("55");
  await page.locator("#volumeGroupTitle").fill("ساقلانمىغان يۈرۈشلۈك");
  await page.locator("[data-volume-member-id='301'] [data-member-label]").fill("باش قىسىم");
}

function memberRow(page, id) {
  return page.locator(`[data-volume-member-id="${id}"]`);
}

async function saveOpenBook(page) {
  await page.locator("#bookForm button[type='submit']").click();
  await expect(page.locator("#bookModal")).toBeHidden();
}

test("saved member editing updates page count without recreating the series", async ({ page }) => {
  await openSavedSeries(page);
  const first = memberRow(page, "301");
  await expect(first.getByRole("link", { name: "كىتابنى ئېچىش" })).toHaveAttribute("href", "/book/301");
  await expect(first.locator("[data-member-pages]")).toBeHidden();
  await expect(memberRow(page, "302").locator("[data-member-pages]")).toHaveText("40 بەت");
  await first.getByRole("button", { name: "كىتاب ئۇچۇرىنى تەھرىرلەش" }).click();
  await expect(page.locator("#bookModal")).toBeVisible();
  await expect(page.locator("#bookId")).toHaveValue("301");
  await expect(page.locator("#bookPages")).toHaveValue("");
  await page.locator("#bookPages").fill("180");
  await saveOpenBook(page);
  await expect(first.locator("[data-member-pages]")).toHaveText("180 بەت");
  await expect(page.locator("#volumeGroupTitle")).toHaveValue("ساقلانمىغان يۈرۈشلۈك");
  await expect(first.locator("[data-member-label]")).toHaveValue("باش قىسىم");
  await expect(page.locator("#volumeGroupVisibility")).toHaveText("كۆرسىتىشكە تەييار");
  expect(await page.locator("[data-series-cover]").first().evaluate((input) => input.files.length)).toBe(1);
  const saved = await page.evaluate(() => window.__kutadguBookSaves.slice());
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ operation: "UPDATE", id: "301" });
  expect(saved[0].payload.pages).toBe(180);
  expect(saved[0].payload).not.toHaveProperty("id");
  expect(await page.evaluate(() => window.__volumeEditorCalls.map((call) => call.name))).not.toContain("admin_save_book_volume_group");
  expect(await page.evaluate(() => window.KutadguAdminVolumeGroups._state.members.map((member) => member.book_id))).toEqual(["301", "302"]);

  await first.getByRole("button", { name: "كىتاب ئۇچۇرىنى تەھرىرلەش" }).click();
  await expect(page.locator("#bookPages")).toHaveValue("180");
  await page.locator("#bookPages").fill("200");
  await saveOpenBook(page);
  await expect(first.locator("[data-member-pages]")).toHaveText("200 بەت");
  await first.getByRole("button", { name: "كىتاب ئۇچۇرىنى تەھرىرلەش" }).click();
  await expect(page.locator("#bookPages")).toHaveValue("200");
  await page.locator("#bookPages").fill("210");
  await page.locator("#cancelBookEdit").click();
  await expect(page.locator("#bookModal")).toBeHidden();
  await expect(first.locator("[data-member-pages]")).toHaveText("200 بەت");
  await expect(page.locator("#volumeGroupTitle")).toHaveValue("ساقلانمىغان يۈرۈشلۈك");

  await page.evaluate(() => { window.__failBookSave = true; });
  await first.getByRole("button", { name: "كىتاب ئۇچۇرىنى تەھرىرلەش" }).click();
  await page.locator("#bookPages").fill("999");
  await page.locator("#bookForm button[type='submit']").click();
  await expect(page.locator("#bookModal")).toBeVisible();
  await expect(page.locator("#bookPages")).toHaveValue("999");
  await expect(first.locator("[data-member-pages]")).toHaveText("200 بەت");
  await page.locator("#cancelBookEdit").click();
  expect(await page.evaluate(() => window.__kutadguBookSaves.map((row) => row.payload.pages))).toEqual([180, 200]);
  expect(await page.evaluate(() => window.KutadguAdminVolumeGroups._state.members.map((member) => [member.book_id, member.pages, member.price, member.stock]))).toEqual([
    ["301", 200, 120, 4],
    ["302", 40, 80, 6]
  ]);
});

test("a late book save does not repaint a different series", async ({ page }) => {
  await openSavedSeries(page);
  await page.evaluate(() => { window.__holdBookSave = true; window.__bookSaveHeld = false; });
  await memberRow(page, "301").getByRole("button", { name: "كىتاب ئۇچۇرىنى تەھرىرلەش" }).click();
  await page.locator("#bookPages").fill("240");
  await page.locator("#bookForm button[type='submit']").click();
  await page.waitForFunction(() => window.__bookSaveHeld === true);
  await page.evaluate(() => window.KutadguAdminVolumeGroups.openGroup(88));
  await expect(page.locator("#volumeGroupId")).toHaveValue("88");
  await expect(page.locator("#volumeGroupTitle")).toHaveValue("باشقا يۈرۈشلۈك");
  await page.evaluate(() => window.__releaseBookSave());
  await expect.poll(() => page.evaluate(() => window.__kutadguBookSaves.length)).toBe(1);
  await expect(page.locator("#volumeGroupId")).toHaveValue("88");
  await expect(page.locator("#volumeGroupTitle")).toHaveValue("باشقا يۈرۈشلۈك");
  await expect(page.locator("[data-volume-member-id]")).toHaveText([/باشقا بىرى/, /باشقا ئىككى/]);
  await expect(page.locator("[data-member-pages]:not([hidden])")).toHaveCount(0);
  const saved = await page.evaluate(() => window.__kutadguBookSaves[0]);
  expect(saved).toMatchObject({ operation: "UPDATE", id: "301" });
  expect(saved.payload.pages).toBe(240);
});

test("hydrated public series shows the saved member page count", async ({ page }) => {
  const publicGroup = require("../../kutadgu-public-volume-group.js");
  const edited = group(55);
  edited.members[0].pages = 180;
  edited.members[1].pages = null;
  const html = publicGroup.applyGroupDocument(publicGroup.readShell(), edited, {
    id: "301",
    title: edited.members[0].title,
    author: edited.members[0].author,
    pages: 180,
    price: edited.members[0].price,
    category: edited.category,
    source: edited.source,
    description: edited.description
  });
  await H.installReadSafeNetwork(page);
  await page.addInitScript(() => {
    try { sessionStorage.removeItem("kutadgu-catalog-active-count-v1"); } catch (error) {}
  });
  await page.route("**/app-config.js*", (route) => route.fulfill({
    status: 200,
    contentType: "text/javascript; charset=utf-8",
    body: appConfig
  }));
  await page.route("**/volume-group/alma**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: html
  }));
  await page.route("**/sample-book-cover.png", (route) => route.fulfill({
    status: 200,
    contentType: "image/png",
    body: fs.readFileSync(STUB)
  }));
  await page.route("**/rest/v1/**", (route) => {
    const request = route.request();
    const url = request.url();
    if (url.includes("/rest/v1/books") && request.method() === "HEAD") {
      return route.fulfill({ status: 200, headers: { "content-range": "0-0/2" }, body: "" });
    }
    if (url.includes("/rpc/get_public_book_volume_group_storefront")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(edited) });
    }
    if (url.includes("/rpc/resolve_public_book_volume_context")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ group: edited, selected_book_id: "301", canonical_path: "/book/301" })
      });
    }
    if (url.includes("/rest/v1/books")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-1/2" },
        body: JSON.stringify(edited.members.map((member) => ({
          id: Number(member.book_id),
          title: member.title,
          author: member.author,
          price: member.price,
          image_url: member.image_url,
          stock: member.stock,
          is_active: true,
          submission_status: "approved",
          pages: member.pages,
          category: edited.category,
          source: edited.source,
          description: member.title
        })))
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.goto("/volume-group/alma", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-volume-static-members]")).toHaveCount(0);
  await expect(page.locator(".volume-member-pages")).toHaveText(["180 بەت"]);
  await expect(page.locator(".volume-member-option").nth(1)).not.toContainText("بەت");
});
