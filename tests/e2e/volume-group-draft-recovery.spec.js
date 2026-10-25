const fs = require("fs");
const os = require("os");
const path = require("path");
const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const shotDir = path.join(os.tmpdir(), "kutadgu-volume-editor-drafts");

const books = [
  { id: 301, title: "ئالما خاتىرىسى", author: "مۇئەللىپ", price: 120, stock: 4, image_url: "/sample-book-cover.png", isbn: "", url: "/book/301", category: "تارىخىي رومانلار", source: "tarikhiy-romanlar.html", description: "بىرىنچى قىسىم ھەققىدە" },
  { id: 302, title: "ئالما داۋامى", author: "باشقا ئاپتور", price: 80, stock: 6, image_url: "/sample-book-cover.png", isbn: "", url: "/book/302", category: "رومانلار", source: "romanlar.html", description: "ئىككىنچى قىسىم" },
  { id: 303, title: "يېڭى قىسىم", author: "يېڭى ئاپتور", price: 40, stock: 2, image_url: "/sample-book-cover.png", isbn: "", url: "/book/303", category: "رومانلار", source: "romanlar.html", description: "باشقا چۈشەندۈرۈش" },
  { id: 304, title: "يېڭى داۋام", author: "يېڭى ئاپتور", price: 45, stock: 2, image_url: "/sample-book-cover.png", isbn: "", url: "/book/304", category: "رومانلار", source: "romanlar.html", description: "داۋام" },
  { id: 410, title: "يوشۇرۇن تۈردىكى كىتاب", author: "يوشۇرۇن ئاپتور", price: 15, stock: 1, image_url: "/sample-book-cover.png", isbn: "", url: "/book/410", category: "يوشۇرۇن", source: "yoshurun.html", description: "يوشۇرۇن چۈشەندۈرۈش" },
  { id: 139, title: "ئامەت ۋە ئاپەت 1-قىسىم", author: "جالالىدىن بەھرام", price: 180, stock: 3, image_url: "/sample-book-cover.png", isbn: "", url: "/book/139", category: "تارىخىي رومانلار", source: "tarikhiy-romanlar.html", description: "بىرىنچى قىسىم" },
  { id: 140, title: "ئامەت ۋە ئاپەت 2-قىسىم", author: "جالالىدىن بەھرام", price: 190, stock: 3, image_url: "/sample-book-cover.png", isbn: "", url: "/book/140", category: "تارىخىي رومانلار", source: "tarikhiy-romanlar.html", description: "ئىككىنچى قىسىم" }
];

const LINK_SLUG = /^series-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function contrast(foreground, background) {
  const parse = (value) => value.match(/\d+/g).slice(0, 3).map(Number);
  const channel = (value) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (rgb) => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  const left = luminance(parse(foreground));
  const right = luminance(parse(background));
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

async function openEditor(page) {
  await H.installReadSafeNetwork(page);
  await H.installCategoryDirectoryFixture(page);
  await page.addInitScript(() => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguSkipSuggestFetch = true;
    window.__kutadguSuggestionRows = [];
    window.__kutadguAdminPreviewBooks = [];
  });
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  await page.evaluate((rows) => {
    window.__lookupBooks = rows;
    window.__groups = [];
    window.__volumeEditorCalls = [];
    window.__catalogCalls = [];
    window.__bookWrites = [];
    const memberFrom = (member) => {
      const book = window.__lookupBooks.find((row) => String(row.id) === String(member.book_id)) || {};
      return { book_id: member.book_id, position: member.position, volume_label: member.volume_label, title: book.title, author: book.author, price: book.price, stock: book.stock, image_url: book.image_url, isbn: book.isbn, url: book.url };
    };
    const db = {
      from(table) {
        const op = { table, eqs: [] };
        const chain = {
          select() { return chain; },
          eq(column, value) { op.eqs.push([column, value]); return chain; },
          order() { return chain; },
          range() { return chain; },
          or() { return chain; },
          maybeSingle() {
            window.__catalogCalls.push({ table, select: "id,category,source,description", eqs: op.eqs.slice() });
            const id = op.eqs.find((pair) => pair[0] === "id");
            const book = window.__lookupBooks.find((row) => String(row.id) === String(id && id[1]));
            if (window.__metadataError) return Promise.resolve({ data: null, error: { message: "metadata unavailable" } });
            return Promise.resolve({ data: book ? { id: book.id, category: book.category || "", source: book.source || "", description: book.description || "" } : null, error: null });
          },
          then(resolve) { resolve({ data: [], error: null, count: 0 }); }
        };
        return chain;
      },
      async rpc(name, args) {
        window.__volumeEditorCalls.push({ name, args: JSON.parse(JSON.stringify(args || {})) });
        if (name === "admin_preview_book_volume_members") {
          const id = args && args.p_book_id != null ? String(args.p_book_id) : "";
          const found = window.__lookupBooks.filter((book) => String(book.id) === id);
          return { data: found.map((book) => ({ book_id: book.id, title: book.title, author: book.author, price: book.price, stock: book.stock, image_url: book.image_url, isbn: book.isbn, url: book.url })) };
        }
        if (name === "admin_list_book_volume_groups") {
          if (window.__listFails) return { data: null, error: { message: "permission denied", code: "42501" }, status: 403 };
          return { data: window.__groups };
        }
        if (name === "admin_get_book_volume_group") {
          if (window.__detailMode === "denied") return { data: null, error: { message: "permission denied", code: "42501" }, status: 403 };
          const group = window.__groups.find((row) => String(row.id) === String(args.p_group_id));
          if (window.__detailMode === "null") return { data: null };
          if (window.__detailMode === "mismatch-slug") return { data: group ? { ...group, slug: "other-slug" } : null };
          if (window.__detailMode === "mismatch-id") return { data: group ? { ...group, id: 999 } : null };
          return { data: group || null };
        }
        if (name === "admin_save_book_volume_group") {
          if (window.__holdSave) {
            window.__saveHeld = true;
            await new Promise((resolve) => { window.__releaseSave = resolve; });
          }
          if (window.__loseSave) return { data: null };
          if (window.__duplicateSlug) {
            return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint \"book_volume_groups_slug_uidx\"", details: `Key (slug)=(${args.p_group.slug}) already exists.` }, status: 409 };
          }
          const saved = {
            id: args.p_group_id || 77,
            revision: Number(args.p_expected_revision || 0) + 1,
            slug: args.p_group.slug,
            title: args.p_group.title,
            author: args.p_group.author,
            category: args.p_group.category,
            source: args.p_group.source,
            description: args.p_group.description,
            complete_set_price: args.p_group.complete_set_price,
            representative_book_id: args.p_group.representative_book_id,
            is_active: args.p_group.is_active,
            is_public: false,
            members: (args.p_members || []).map(memberFrom)
          };
          window.__groups = [saved, ...window.__groups.filter((row) => String(row.id) !== String(saved.id))];
          return { data: saved };
        }
        if (name === "admin_set_book_volume_group_publication") {
          if (window.__holdPublish) {
            window.__publishHeld = true;
            await new Promise((resolve) => { window.__releasePublish = resolve; });
          }
          if (window.__publishError) return { data: null, error: window.__publishError, status: 502 };
          const current = window.__groups.find((row) => String(row.id) === String(args.p_group_id)) || { id: args.p_group_id, members: [] };
          const saved = { ...current, is_public: args.p_is_public === true, revision: Number(args.p_expected_revision || 0) + 1 };
          window.__groups = [saved, ...window.__groups.filter((row) => String(row.id) !== String(saved.id))];
          return { data: saved };
        }
        return { data: [] };
      }
    };
    window.KutadguAdminVolumeGroups.init({ db });
  }, books);
  await page.locator('button[data-admin-section="volume-groups"]').click();
  await page.locator("#newVolumeGroupBtn").click();
  await expect(page.locator("#volumeGroupMode")).toHaveAttribute("data-mode", "draft");
}

async function addBook(page, id) {
  await page.locator("#volumeGroupBookLookup").fill(String(id));
  await page.locator("#volumeGroupLookupBtn").click();
  await page.locator(`[data-lookup-add="${id}"]`).click();
  await expect(page.locator(`[data-volume-member-id="${id}"]`)).toBeVisible();
}

async function useDraftSlugForListedGroup(page) {
  const slug = await page.locator("#volumeGroupSlug").inputValue();
  await page.evaluate((value) => {
    window.__groups = (window.__groups || []).map((row) => ({ ...row, slug: value }));
  }, slug);
  return slug;
}

async function saveDraft(page) {
  await page.locator("#volumeGroupForm button[type='submit']").click();
  await expect(page.locator("#volumeGroupStatus")).toContainText("ساقلاندى");
}

test.describe("volume editor draft recovery", () => {
  test("publication leaves a fresh draft and keeps the published group listed", async ({ page }) => {
    await openEditor(page);
    await addBook(page, 301);
    await addBook(page, 302);
    await page.locator("#volumeGroupCategory").fill("تارىخىي رومانلار");
    await saveDraft(page);
    await expect(page.locator("#volumeGroupId")).toHaveValue("77");
    await expect(page.locator("#volumeGroupMode")).toHaveAttribute("data-mode", "saved");
    await expect(page.locator("#volumeGroupPublishBtn")).toBeEnabled();
    expect(await page.evaluate(() => window.__volumeEditorCalls.some((call) => call.name === "admin_set_book_volume_group_publication"))).toBe(false);
    await page.locator("#volumeGroupPublishBtn").click();
    await expect(page.locator("#volumeGroupMode")).toHaveAttribute("data-mode", "draft");
    await expect(page.locator("#volumeGroupId")).toHaveValue("");
    await expect(page.locator("#volumeGroupTitle")).toHaveValue("");
    const freshSlug = await page.locator("#volumeGroupSlug").inputValue();
    expect(freshSlug).toMatch(LINK_SLUG);
    await expect(page.locator("[data-volume-member-id]")).toHaveCount(0);
    await expect(page.locator("[data-volume-group-edit='77']")).toContainText("كۆرسىتىشكە تەييار");
    await addBook(page, 303);
    await addBook(page, 304);
    await page.locator("#volumeGroupCategory").fill("تارىخىي رومانلار");
    await saveDraft(page);
    const saves = await page.evaluate(() => window.__volumeEditorCalls.filter((call) => call.name === "admin_save_book_volume_group").map((call) => call.args.p_group.slug));
    expect(saves[0]).toMatch(LINK_SLUG);
    expect(saves[1]).toBe(freshSlug);
    expect(saves[1]).not.toBe(saves[0]);
    expect(saves).not.toContain("series-301");
    expect(saves).not.toContain("series-303");
    expect(await page.evaluate(() => window.__bookWrites)).toEqual([]);
  });

  test("a failed or late publication does not clear the draft that is open", async ({ page }) => {
    await openEditor(page);
    await addBook(page, 301);
    await addBook(page, 302);
    await page.locator("#volumeGroupCategory").fill("تارىخىي رومانلار");
    await saveDraft(page);
    await page.evaluate(() => { window.__publishError = { message: "gateway timeout", status: 502 }; });
    await page.locator("#volumeGroupPublishBtn").click();
    await expect(page.locator("#volumeGroupStatus")).toContainText("gateway timeout");
    await expect(page.locator("#volumeGroupId")).toHaveValue("77");
    await expect(page.locator("[data-volume-member-id]")).toHaveCount(2);
    await page.evaluate(() => { window.__publishError = null; window.__holdPublish = true; window.__publishHeld = false; });
    await page.locator("#volumeGroupPublishBtn").click();
    await page.waitForFunction(() => window.__publishHeld === true);
    await page.locator("#newVolumeGroupBtn").click();
    await page.locator("#volumeGroupTitle").fill("يېڭى قوليازمى");
    await page.evaluate(() => window.__releasePublish());
    await expect(page.locator("#volumeGroupTitle")).toHaveValue("يېڭى قوليازمى");
    await expect(page.locator("#volumeGroupId")).toHaveValue("");
    await expect(page.locator("[data-volume-group-edit='77']")).toBeVisible();
    await expect(page.locator("[data-volume-member-id]")).toHaveCount(0);
    await page.evaluate(() => { window.__holdSave = true; window.__saveHeld = false; });
    await addBook(page, 303);
    await addBook(page, 304);
    await page.locator("#volumeGroupTitle").fill("كېچىككەن ساقلاش");
    await page.locator("#volumeGroupCategory").fill("تارىخىي رومانلار");
    await page.locator("#volumeGroupForm button[type='submit']").click();
    await page.waitForFunction(() => window.__saveHeld === true);
    await page.locator("#newVolumeGroupBtn").click();
    await page.locator("#volumeGroupTitle").fill("باشقا قوليازمى");
    await page.evaluate(() => window.__releaseSave());
    await expect(page.locator("#volumeGroupTitle")).toHaveValue("باشقا قوليازمى");
    await expect(page.locator("#volumeGroupId")).toHaveValue("");
    await expect(page.locator("[data-volume-group-edit='77']")).toContainText("كېچىككەن ساقلاش");
  });

  test("the first accepted book suggests shared metadata without overriding edits or set price", async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => {
      window.KutadguBookCategories = {
        authoritative() { return true; },
        visible() { return [{ source: "tarikhiy-romanlar.html", label: "تارىخىي رومانلار" }, { source: "romanlar.html", label: "رومانلار" }]; }
      };
    });
    await addBook(page, 301);
    await expect(page.locator("#volumeGroupTitle")).toHaveValue("ئالما خاتىرىسى");
    await expect(page.locator("#volumeGroupAuthor")).toHaveValue("مۇئەللىپ");
    await expect(page.locator("#volumeGroupCategory")).toHaveValue("تارىخىي رومانلار");
    await expect(page.locator("#volumeGroupSource")).toHaveValue("tarikhiy-romanlar.html");
    await expect(page.locator("#volumeGroupDescription")).toHaveValue("بىرىنچى قىسىم ھەققىدە");
    await expect(page.locator("#volumeGroupSetPrice")).toHaveValue("");
    const member = await page.evaluate(() => window.KutadguAdminVolumeGroups._state.members[0]);
    expect(member).toMatchObject({ book_id: "301", price: 120, href: "/book/301", image_url: "/sample-book-cover.png" });
    await page.locator("#volumeGroupDescription").fill("");
    await page.locator("#volumeGroupAuthor").fill("قولدا يېزىلغان");
    await addBook(page, 302);
    await expect(page.locator("#volumeGroupDescription")).toHaveValue("");
    await expect(page.locator("#volumeGroupAuthor")).toHaveValue("قولدا يېزىلغان");
    await expect(page.locator("#volumeGroupTitle")).toHaveValue("ئالما خاتىرىسى");
    await expect(page.locator("#volumeGroupSetPrice")).toHaveValue("");
    const reads = await page.evaluate(() => window.__catalogCalls);
    expect(reads.every((call) => call.select === "id,category,source,description")).toBe(true);
    expect(reads.length).toBeGreaterThan(0);
    await page.locator("#newVolumeGroupBtn").click();
    await addBook(page, 410);
    await expect(page.locator("#volumeGroupCategory")).toHaveValue("");
    await expect(page.locator("#volumeGroupSource")).toHaveValue("");
    await expect(page.locator("#volumeGroupDescription")).toHaveValue("يوشۇرۇن چۈشەندۈرۈش");
    await page.evaluate(() => {
      window.__groups = [{ id: 88, revision: 4, slug: "existing-series", title: "بۇرۇنقى نام", author: "بۇرۇنقى ئاپتور", category: "بۇرۇنقى تۈر", source: "existing-category.html", description: "بۇرۇنقى چۈشەندۈرۈش", complete_set_price: 700, is_public: false, is_active: true, members: [] }];
    });
    await page.evaluate(() => window.KutadguAdminVolumeGroups.openGroup("88"));
    await expect(page.locator("#volumeGroupTitle")).toHaveValue("بۇرۇنقى نام");
    await addBook(page, 301);
    await expect(page.locator("#volumeGroupTitle")).toHaveValue("بۇرۇنقى نام");
    await expect(page.locator("#volumeGroupDescription")).toHaveValue("بۇرۇنقى چۈشەندۈرۈش");
    await expect(page.locator("#volumeGroupSetPrice")).toHaveValue("700");
  });

  test("detaching a member stays local and unsaved edits can be abandoned", async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => {
      window.__groups = [{
        id: 91,
        revision: 3,
        slug: "published-series",
        title: "نەشر قىلىنغان",
        author: "ئاپتور",
        category: "تارىخىي رومانلار",
        source: "tarikhiy-romanlar.html",
        description: "چۈشەندۈرۈش",
        complete_set_price: null,
        is_public: true,
        is_active: true,
        members: [
          { book_id: 301, position: 1, volume_label: "1-قىسىم", title: "ئالما خاتىرىسى", price: 120, stock: 4, image_url: "/sample-book-cover.png", url: "/book/301" },
          { book_id: 302, position: 2, volume_label: "2-قىسىم", title: "ئالما داۋامى", price: 80, stock: 6, image_url: "/sample-book-cover.png", url: "/book/302" }
        ]
      }];
    });
    await page.evaluate(() => window.KutadguAdminVolumeGroups.openGroup("91"));
    await expect(page.locator("#volumeGroupMode")).toHaveAttribute("data-mode", "published");
    await expect(page.locator("#volumeGroupMemberNote")).toContainText("كىتاب تىزىمدا قالىدۇ");
    const detach = page.locator("[data-member-remove-ask]").first();
    await expect(detach).toHaveAttribute("aria-label", /يۈرۈشلۈكتىن ئايرىش: ئالما خاتىرىسى/);
    await detach.click();
    await expect(page.locator("[data-volume-member-id]")).toHaveCount(2);
    await page.locator("[data-member-remove-confirm]").click();
    await expect(page.locator("[data-volume-member-id]")).toHaveCount(1);
    expect(await page.evaluate(() => window.__volumeEditorCalls.filter((call) => call.name === "admin_save_book_volume_group"))).toEqual([]);
    await expect(page.locator("#volumeGroupAbandon")).toBeVisible();
    await page.locator("#volumeGroupAbandon").click();
    await expect(page.locator("[data-volume-member-id]")).toHaveCount(2);
    await page.setViewportSize({ width: 390, height: 844 });
    const box = await page.locator("[data-member-remove-ask]").first().boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    const colors = await page.locator("[data-member-remove-ask]").first().evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor };
    });
    expect(contrast(colors.color, colors.background)).toBeGreaterThanOrEqual(4.5);
    await page.locator("[data-member-remove-ask]").first().focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    expect(outline).not.toBe("none");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() => document.body.classList.add("dark-mode"));
    const darkNote = await page.locator("#volumeGroupMemberNote").evaluate((element) => {
      const style = getComputedStyle(element);
      let node = element;
      let background = style.backgroundColor;
      while (node && (background === "rgba(0, 0, 0, 0)" || background === "transparent")) {
        node = node.parentElement;
        background = node ? getComputedStyle(node).backgroundColor : background;
      }
      return { color: style.color, background };
    });
    const darkButton = await page.locator("[data-member-remove-ask]").first().evaluate((element) => {
      const style = getComputedStyle(element);
      const parent = getComputedStyle(element.parentElement);
      return { color: style.color, background: style.backgroundColor, parent: parent.backgroundColor };
    });
    expect(contrast(darkButton.color, darkButton.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkNote.color, darkNote.background)).toBeGreaterThanOrEqual(4.5);
    fs.mkdirSync(shotDir, { recursive: true });
    await page.screenshot({ path: path.join(shotDir, "detach-390-dark.png"), fullPage: true });
  });

  test("a duplicate slug opens the verified group and does not invent another link", async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => {
      window.__duplicateSlug = true;
      window.__groups = [{ id: 55, revision: 2, slug: "series-301", title: "كونا يۈرۈشلۈك", author: "كونا", category: "تارىخىي رومانلار", source: "tarikhiy-romanlar.html", description: "كونا", is_public: true, is_active: true, members: [{ book_id: 301, position: 1, volume_label: "1-قىسىم", title: "ئالما خاتىرىسى", price: 120, url: "/book/301" }, { book_id: 302, position: 2, volume_label: "2-قىسىم", title: "ئالما داۋامى", price: 80, url: "/book/302" }] }];
    });
    await addBook(page, 301);
    await addBook(page, 302);
    await page.locator("#volumeGroupCategory").fill("تارىخىي رومانلار");
    const slug = await useDraftSlugForListedGroup(page);
    await page.locator("#volumeGroupForm button[type='submit']").click();
    await expect(page.locator("#volumeGroupStatus")).toContainText("كونا يۈرۈشلۈك");
    await expect(page.locator("#volumeGroupStatus")).not.toContainText("book_volume_groups_slug_uidx");
    await expect(page.locator(".volume-slug-open")).toHaveText("شۇ يۈرۈشلۈكنى ئېچىش");
    const slugs = await page.evaluate(() => window.__volumeEditorCalls.filter((call) => call.name === "admin_save_book_volume_group").map((call) => call.args.p_group.slug));
    expect(slugs).toEqual([slug]);
    expect(slug).toMatch(LINK_SLUG);
    await page.locator(".volume-slug-open").click();
    await expect(page.locator("#volumeGroupId")).toHaveValue("55");
    await expect(page.locator("#volumeGroupSlug")).toHaveValue(slug);
    await expect(page.locator("#volumeGroupTitle")).toHaveValue("كونا يۈرۈشلۈك");
    await page.evaluate(() => { window.__listFails = true; window.__duplicateSlug = true; });
    await page.locator("#newVolumeGroupBtn").click();
    await addBook(page, 303);
    await addBook(page, 304);
    await page.locator("#volumeGroupCategory").fill("تارىخىي رومانلار");
    const second = await page.locator("#volumeGroupSlug").inputValue();
    await page.locator("#volumeGroupForm button[type='submit']").click();
    await expect(page.locator("#volumeGroupStatus")).toContainText("خاتىرىسىنى ئوقۇيالمىدىم");
    await expect(page.locator(".volume-slug-open")).toHaveCount(0);
    const later = await page.evaluate(() => window.__volumeEditorCalls.filter((call) => call.name === "admin_save_book_volume_group").map((call) => call.args.p_group.slug));
    expect(later).toEqual([slug, second]);
    expect(second).not.toBe(slug);
    expect(later.some((value) => /-2$/.test(value))).toBe(false);
  });

  test("a late publication or save leaves the new-series form in place", async ({ page }) => {
    await openEditor(page);
    await addBook(page, 301);
    await addBook(page, 302);
    await page.locator("#volumeGroupCategory").fill("تارىخىي رومانلار");
    await saveDraft(page);
    await page.evaluate(() => { window.__holdPublish = true; window.__publishHeld = false; });
    await page.locator("#volumeGroupPublishBtn").click();
    await page.waitForFunction(() => window.__publishHeld === true);
    await page.locator("#showVolumeSeriesBtn").click();
    const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await page.locator("#volumeSeriesTitle").fill("يېڭى يۈرۈش");
    await page.locator(".volume-series-part").nth(0).locator("[data-series-cover]").setInputFiles({ name: "part-1.png", mimeType: "image/png", buffer: tinyPng });
    const requestId = await page.locator("#volumeSeriesRequestId").inputValue();
    await page.evaluate(() => window.__releasePublish());
    await expect(page.locator("#volumeSeriesForm")).toBeVisible();
    await expect(page.locator("#volumeGroupForm")).toBeHidden();
    await expect(page.locator("#volumeSeriesTitle")).toHaveValue("يېڭى يۈرۈش");
    await expect(page.locator("#volumeSeriesRequestId")).toHaveValue(requestId);
    expect(await page.locator(".volume-series-part").nth(0).locator("[data-series-cover]").evaluate((input) => input.files[0] && input.files[0].name)).toBe("part-1.png");
    await expect(page.locator("[data-volume-group-edit='77']")).toContainText("كۆرسىتىشكە تەييار");

    await page.locator("#showVolumeLinkBtn").click();
    await page.locator("#newVolumeGroupBtn").click();
    await addBook(page, 303);
    await addBook(page, 304);
    await page.locator("#volumeGroupCategory").fill("تارىخىي رومانلار");
    await page.evaluate(() => { window.__holdPublish = false; window.__holdSave = true; window.__saveHeld = false; });
    await page.locator("#volumeGroupForm button[type='submit']").click();
    await page.waitForFunction(() => window.__saveHeld === true);
    await page.locator("#showVolumeSeriesBtn").click();
    await page.locator("#volumeSeriesTitle").fill("ساقلاش كېچىككەن");
    await page.locator(".volume-series-part").nth(0).locator("[data-series-cover]").setInputFiles({ name: "late-part.png", mimeType: "image/png", buffer: tinyPng });
    const seriesRequest = await page.locator("#volumeSeriesRequestId").inputValue();
    await page.evaluate(() => window.__releaseSave());
    await expect(page.locator("#volumeSeriesForm")).toBeVisible();
    await expect(page.locator("#volumeGroupForm")).toBeHidden();
    await expect(page.locator("#volumeSeriesTitle")).toHaveValue("ساقلاش كېچىككەن");
    await expect(page.locator("#volumeSeriesRequestId")).toHaveValue(seriesRequest);
    expect(await page.locator(".volume-series-part").nth(0).locator("[data-series-cover]").evaluate((input) => input.files[0] && input.files[0].name)).toBe("late-part.png");
  });

  test("a duplicate slug omits Open unless the detail read matches the listed group", async ({ page }) => {
    await openEditor(page);
    const modes = ["denied", "null", "mismatch-slug", "mismatch-id"];
    const sent = [];
    for (let index = 0; index < modes.length; index += 1) {
      await page.evaluate((detailMode) => {
        window.__duplicateSlug = true;
        window.__detailMode = detailMode;
        window.__groups = [{ id: 55, revision: 2, slug: "series-301", title: "كونا يۈرۈشلۈك", author: "كونا", category: "تارىخىي رومانلار", source: "tarikhiy-romanlar.html", description: "كونا", is_public: true, is_active: true, members: [{ book_id: 301, position: 1, volume_label: "1-قىسىم", title: "ئالما خاتىرىسى", price: 120, url: "/book/301" }, { book_id: 302, position: 2, volume_label: "2-قىسىم", title: "ئالما داۋامى", price: 80, url: "/book/302" }] }];
      }, modes[index]);
      if (index > 0) await page.locator("#newVolumeGroupBtn").click();
      await addBook(page, 301);
      await addBook(page, 302);
      await page.locator("#volumeGroupCategory").fill("تارىخىي رومانلار");
      const title = await page.locator("#volumeGroupTitle").inputValue();
      const slug = await useDraftSlugForListedGroup(page);
      await page.locator("#volumeGroupForm button[type='submit']").click();
      await expect(page.locator("#volumeGroupStatus")).toContainText("جەزملەپ ئېچەلمىدىم");
      await expect(page.locator("#volumeGroupStatus")).not.toContainText("42501");
      await expect(page.locator("#volumeGroupStatus")).not.toContainText("book_volume_groups_slug");
      await expect(page.locator(".volume-slug-open")).toHaveCount(0);
      await expect(page.locator("#volumeGroupId")).toHaveValue("");
      await expect(page.locator("#volumeGroupTitle")).toHaveValue(title);
      await expect(page.locator("[data-volume-member-id]")).toHaveCount(2);
      await expect(page.locator("#volumeGroupSlug")).toHaveValue(slug);
      sent.push(slug);
    }
    const slugs = await page.evaluate(() => window.__volumeEditorCalls.filter((call) => call.name === "admin_save_book_volume_group").map((call) => call.args.p_group.slug));
    expect(slugs).toEqual(sent);
    expect(new Set(sent).size).toBe(4);
    expect(sent.every((slug) => LINK_SLUG.test(slug))).toBe(true);
  });

  test("unlinked books 139 and 140 keep an independent link when series-139 already exists", async ({ page }) => {
    await openEditor(page);
    const anna = {
      id: 2,
      revision: 8,
      slug: "series-139",
      title: "ئاننا كارېنىنا",
      author: "بۇرۇنقى ئاپتور",
      category: "تارىخىي رومانلار",
      source: "tarikhiy-romanlar.html",
      description: "بۇرۇنقى يۈرۈشلۈك",
      is_public: true,
      is_active: true,
      members: [
        { book_id: 147, position: 1, volume_label: "1-قىسىم", title: "ئاننا كارېنىنا 1", price: 200, url: "/book/147" },
        { book_id: 148, position: 2, volume_label: "2-قىسىم", title: "ئاننا كارېنىنا 2", price: 210, url: "/book/148" }
      ]
    };
    await page.evaluate((group) => { window.__groups = [group]; }, anna);
    const slug = await page.locator("#volumeGroupSlug").inputValue();
    expect(slug).toMatch(LINK_SLUG);
    expect(slug).not.toBe("series-139");
    await page.locator("#showVolumeSeriesBtn").click();
    await page.locator("#showVolumeLinkBtn").click();
    await expect(page.locator("#volumeGroupSlug")).toHaveValue(slug);
    await addBook(page, 139);
    await addBook(page, 140);
    await page.locator("#volumeGroupCategory").fill("تارىخىي رومانلار");
    await expect(page.locator("#volumeGroupSlug")).toHaveValue(slug);
    await expect(page.locator("#volumeGroupSetPrice")).toHaveValue("");
    const originalTitle = await page.locator("#volumeGroupTitle").inputValue();
    await page.evaluate(() => { window.__holdSave = true; window.__saveHeld = false; window.__loseSave = true; });
    await page.locator("#volumeGroupForm button[type='submit']").click();
    await page.waitForFunction(() => window.__saveHeld === true);
    await expect(page.locator("#volumeGroupForm button[type='submit']")).toBeDisabled();
    await page.evaluate(() => document.querySelector("#volumeGroupForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(await page.evaluate(() => window.__volumeEditorCalls.filter((call) => call.name === "admin_save_book_volume_group").length)).toBe(1);
    await page.evaluate(() => window.__releaseSave());
    await expect(page.locator("#volumeGroupStatus")).toContainText("تازىلانمىدى");
    await expect(page.locator("#volumeGroupSlug")).toHaveValue(slug);
    await expect(page.locator("#volumeGroupId")).toHaveValue("");
    await page.locator("#volumeGroupTitle").fill("ئۆزگەرتىلگەن نام");
    await page.evaluate(() => { window.__holdSave = false; window.__loseSave = false; });
    await page.locator("#volumeGroupForm button[type='submit']").click();
    await expect(page.locator("#volumeGroupStatus")).toContainText("ساقلاندى");
    const creates = await page.evaluate(() => window.__volumeEditorCalls.filter((call) => call.name === "admin_save_book_volume_group" && !call.args.p_group_id));
    expect(creates).toHaveLength(2);
    expect(creates[0].args).toEqual(creates[1].args);
    expect(creates[0].args.p_group.slug).toBe(slug);
    expect(creates[0].args.p_group.title).toBe(originalTitle);
    expect(creates[0].args.p_group.complete_set_price).toBeNull();
    expect(creates[0].args.p_members.map((member) => member.book_id)).toEqual(["139", "140"]);
    const stored = await page.evaluate(() => window.__groups.map((group) => ({ id: group.id, revision: group.revision, slug: group.slug, title: group.title, members: (group.members || []).map((member) => String(member.book_id)) })));
    expect(stored.find((group) => group.id === 2)).toEqual({ id: 2, revision: 8, slug: "series-139", title: "ئاننا كارېنىنا", members: ["147", "148"] });
    expect(stored.filter((group) => group.slug === slug)).toHaveLength(1);
    await expect(page.locator(".volume-slug-open")).toHaveCount(0);
    await expect(page.locator("#volumeGroupId")).toHaveValue("77");
    await page.locator("#volumeGroupPublishBtn").click();
    await expect(page.locator("#volumeGroupMode")).toHaveAttribute("data-mode", "draft");
    await expect(page.locator("#volumeGroupId")).toHaveValue("");
    await expect(page.locator("#volumeGroupTitle")).toHaveValue("");
    await expect(page.locator("[data-volume-member-id]")).toHaveCount(0);
    const fresh = await page.locator("#volumeGroupSlug").inputValue();
    expect(fresh).toMatch(LINK_SLUG);
    expect(fresh).not.toBe(slug);
    expect(fresh).not.toBe("series-139");
    await page.evaluate(() => window.KutadguAdminVolumeGroups.openGroup("2"));
    await expect(page.locator("#volumeGroupId")).toHaveValue("2");
    await expect(page.locator("#volumeGroupSlug")).toHaveValue("series-139");
    await expect(page.locator("#volumeGroupTitle")).toHaveValue("ئاننا كارېنىنا");
    await page.locator("#volumeGroupTitle").fill("ئاننا كارېنىنا تەھرىر");
    await page.locator("#volumeGroupForm button[type='submit']").click();
    await expect(page.locator("#volumeGroupStatus")).toContainText("ساقلاندى");
    await expect(page.locator("#volumeGroupSlug")).toHaveValue("series-139");
    await expect(page.locator("#volumeGroupId")).toHaveValue("2");
    const edited = await page.evaluate(() => window.__volumeEditorCalls.filter((call) => call.name === "admin_save_book_volume_group" && String(call.args.p_group_id) === "2").pop());
    expect(edited.args.p_group.slug).toBe("series-139");
    expect(edited.args.p_group.title).toBe("ئاننا كارېنىنا تەھرىر");
    expect(edited.args.p_members.map((member) => member.book_id)).toEqual(["147", "148"]);
    expect(await page.evaluate(() => window.__volumeEditorCalls.some((call) => /-2$/.test(String(call.args && call.args.p_group && call.args.p_group.slug || ""))))).toBe(false);
  });
});
