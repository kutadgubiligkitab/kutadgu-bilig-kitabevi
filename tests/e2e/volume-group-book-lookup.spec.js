const fs = require("fs");
const os = require("os");
const path = require("path");
const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const shotDir = path.join(os.tmpdir(), "kutadgu-volume-lookup");

const books = [
  { id: 12, title: "باشقا بەت كىتاب", author: "باشقا", price: 10, stock: 1, image_url: "/sample-book-cover.png", isbn: null, url: "/book/12" },
  { id: 156, title: "ئويغانغان زېمىن", author: "ئابدۇرېھىم ئۆتكۈر", price: 370, stock: 20, image_url: "/sample-book-cover.png", isbn: "978-1-4028-9462-6", url: "/book/156" },
  { id: 301, title: "ئالما خاتىرىسى", author: "مۇئەللىپ", price: 120, stock: 4, image_url: "/sample-book-cover.png", isbn: null, url: "/book/301" },
  { id: 302, title: "ئالما داۋامى", author: "مۇئەللىپ", price: 80, stock: 6, image_url: "/sample-book-cover.png", isbn: null, url: "/book/302" },
  { id: 303, title: "تېز كىتاب", author: "تېز", price: 15, stock: 2, image_url: "/sample-book-cover.png", isbn: null, url: "/book/303" },
  { id: 304, title: "ئاستا كىتاب", author: "ئاستا", price: 16, stock: 2, image_url: "/sample-book-cover.png", isbn: null, url: "/book/304" },
  { id: 410, title: "باغلانغان كىتاب", author: "مۇئەللىپ", price: 40, stock: 3, image_url: "/sample-book-cover.png", isbn: null, url: "/book/410", group_id: 4, group_title: "باشقا يۈرۈشلۈك" },
  { id: 501, title: "خەلقئارا نومۇرلۇق", author: "نېشرىيات", price: 55, stock: 8, image_url: "/sample-book-cover.png", isbn: "978-0-306-40615-7", url: "/book/501" }
];

async function openLookupEditor(page) {
  const writes = [];
  page.on("request", (req) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method())) writes.push(req.url());
  });
  page._lookupWrites = writes;
  await H.installReadSafeNetwork(page);
  await page.addInitScript(() => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguSkipSuggestFetch = true;
    window.__kutadguSuggestionRows = [{ id: 156, author: "ئابدۇرېھىم ئۆتكۈر" }];
    window.__kutadguAdminPreviewBooks = [];
  });
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  await page.evaluate((rows) => {
    window.__lookupBooks = rows;
    window.__catalogCalls = [];
    window.__volumeEditorCalls = [];
    window.__bookWrites = [];
    window.__catalogError = "";
    window.__holdNextCatalog = false;
    let pending = null;
    window.__releaseLookup = () => {
      const finish = pending;
      pending = null;
      if (finish) finish();
    };
    const db = {
      from(table) {
        const op = { table, method: "select", orFilter: "", limit: null, range: null, count: "", eqs: [] };
        const chain = {
          select(_columns, options) { op.method = "select"; op.count = options && options.count || ""; return chain; },
          insert(payload) { op.method = "insert"; window.__bookWrites.push({ table, op: "insert", payload }); return chain; },
          update(payload) { op.method = "update"; window.__bookWrites.push({ table, op: "update", payload }); return chain; },
          delete() { op.method = "delete"; window.__bookWrites.push({ table, op: "delete" }); return chain; },
          or(filter) { op.orFilter = String(filter || ""); return chain; },
          order() { return chain; },
          range(from, to) { op.range = [from, to]; return chain; },
          limit(n) { op.limit = n; return chain; },
          eq(column, value) { op.eqs.push([column, value]); return chain; },
          then(resolve) {
            const finish = () => {
              window.__catalogCalls.push({ ...op, eqs: op.eqs.slice() });
              if (window.__catalogError) {
                const message = window.__catalogError;
                window.__catalogError = "";
                resolve({ data: null, error: { message } });
                return;
              }
              const match = op.orFilter.match(/title\.ilike\."%([^"]*)%"/);
              const term = match ? match[1] : "";
              const found = window.__lookupBooks.filter((book) => String(book.title).includes(term) || String(book.author || "").includes(term)).sort((a, b) => a.id - b.id);
              const pageRows = op.range ? found.slice(op.range[0], op.range[1] + 1) : found.slice(0, op.limit || found.length);
              resolve({ data: pageRows, error: null, count: found.length });
            };
            if (window.__holdNextCatalog) {
              window.__holdNextCatalog = false;
              window.__lookupHeld = true;
              pending = finish;
              return;
            }
            finish();
          }
        };
        return chain;
      },
      async rpc(name, args) {
        window.__volumeEditorCalls.push({ name, args });
        if (name === "admin_preview_book_volume_members") {
          const id = args && args.p_book_id != null ? String(args.p_book_id) : "";
          const isbn = args && args.p_isbn != null ? String(args.p_isbn) : "";
          if (window.__holdPreviewId && id === String(window.__holdPreviewId)) {
            window.__holdPreviewId = "";
            window.__previewHeld = true;
            await new Promise((resolve) => { window.__releasePreview = resolve; });
          }
          const found = window.__lookupBooks.filter((book) => (id && String(book.id) === id) || (isbn && book.isbn && String(book.isbn) === isbn));
          return { data: found.map((book) => ({ book_id: book.id, isbn: book.isbn, title: book.title, author: book.author, price: book.price, image_url: book.image_url, stock: book.stock, url: book.url, group_id: book.group_id || null, group_title: book.group_title || null })) };
        }
        if (name === "admin_list_book_volume_groups") return { data: [{ id: 88, title: "باشقا يۈرۈشلۈك", slug: "other", member_count: 0, is_public: false }] };
        if (name === "admin_get_book_volume_group") return { data: { id: args.p_group_id, revision: 2, title: "باشقا يۈرۈشلۈك", slug: "other", is_public: false, is_active: true, members: [] } };
        if (name === "admin_save_book_volume_group") {
          const members = (args.p_members || []).map((member) => {
            const book = window.__lookupBooks.find((row) => String(row.id) === String(member.book_id)) || {};
            return { book_id: member.book_id, position: member.position, volume_label: member.volume_label, title: book.title, author: book.author, price: book.price, stock: book.stock, image_url: book.image_url, isbn: book.isbn, url: book.url };
          });
          return { data: { id: 77, revision: 1, slug: args.p_group.slug, title: args.p_group.title, author: args.p_group.author, category: args.p_group.category, source: args.p_group.source, complete_set_price: args.p_group.complete_set_price, is_public: false, is_active: true, members } };
        }
        return { data: [] };
      }
    };
    window.KutadguAdminVolumeGroups.init({ db });
  }, books);
  await page.locator('button[data-admin-section="volume-groups"]').click();
  await page.locator("#newVolumeGroupBtn").click();
}

async function searchLookup(page, query) {
  await page.locator("#volumeGroupBookLookup").fill(query);
  await page.locator("#volumeGroupLookupBtn").click();
}

test.describe("volume-group existing book lookup", () => {
  test("title and author search finds ISBN-less books outside the current admin page", async ({ page }) => {
    await openLookupEditor(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      window.__kutadguAdminTest.listFilters.q = "باشقا بەت";
      window.__kutadguAdminTest.listFilters.source = "should-not-apply";
    });
    await page.locator("#volumeGroupBookLookup").focus();
    await page.locator("#volumeGroupBookLookup").fill("ئالما خاتىرىسى");
    await page.locator("#volumeGroupBookLookup").press("Enter");
    const card = page.locator(".volume-admin-lookup").filter({ hasText: "ئالما خاتىرىسى" });
    await expect(card).toBeVisible();
    await expect(card.locator("img")).toBeVisible();
    await expect(card.locator(".volume-admin-lookup-author")).toHaveText("مۇئەللىپ");
    await expect(card).toContainText("120 ₺");
    await expect(card).not.toContainText("ISBN");
    await expect(card.locator(".volume-admin-lookup-id")).toHaveText("ئىچكى نومۇر 301");
    await expect(card.getByRole("button", { name: "قىسىم قىلىپ قوشۇش" })).toBeEnabled();
    await expect(page.locator(".volume-admin-lookup")).toHaveCount(1);
    const calls = await page.evaluate(() => window.__catalogCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: "books", method: "select", count: "exact", range: [0, 39], eqs: [] });
    expect(calls[0].orFilter).toContain("title.ilike.");
    expect(calls[0].orFilter).toContain("author.ilike.");
    expect(calls[0].orFilter).toContain("ئالما خاتىرىسى");
    expect(calls[0].orFilter).not.toContain("باشقا بەت");
    expect(calls[0].orFilter).not.toContain("should-not-apply");
    expect(await page.evaluate(() => window.__volumeEditorCalls.filter((call) => call.name === "admin_preview_book_volume_members"))).toEqual([]);
    const box = await page.locator("#volumeGroupLookupBtn").boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    fs.mkdirSync(shotDir, { recursive: true });
    await page.screenshot({ path: path.join(shotDir, "lookup-390.png") });
    let reached = false;
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press("Tab");
      reached = await page.locator("[data-lookup-add='301']").evaluate((el) => el === document.activeElement);
      if (reached) break;
    }
    expect(reached).toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-volume-member-id='301']")).toContainText("ئالما خاتىرىسى");
    await expect(page.locator("[data-volume-member-id='301'] a")).toHaveAttribute("href", "/book/301");
    const member = await page.evaluate(() => window.KutadguAdminVolumeGroups._state.members[0]);
    expect(member).toMatchObject({ book_id: "301", title: "ئالما خاتىرىسى", author: "مۇئەللىپ", price: 120, stock: 4, image_url: "/sample-book-cover.png", href: "/book/301", isbn: "" });
    expect(page._lookupWrites.filter((url) => url.includes("/rest/v1/books") || url.includes("admin_save_book_volume_group"))).toEqual([]);
    expect(await page.evaluate(() => window.__bookWrites)).toEqual([]);
  });

  test("multiple title matches stay unordered until the admin chooses them", async ({ page }) => {
    await openLookupEditor(page);
    await page.locator("#volumeGroupAuthor").fill("گۇرۇپپا ئاپتورى");
    await searchLookup(page, "مۇئەللىپ");
    await expect(page.locator(".volume-admin-lookup strong")).toHaveText(["ئالما خاتىرىسى", "ئالما داۋامى", "باغلانغان كىتاب"]);
    await page.locator("[data-lookup-add='302']").click();
    await searchLookup(page, "مۇئەللىپ");
    await page.locator("[data-lookup-add='301']").click();
    const ids = await page.locator("[data-volume-member-id]").evaluateAll((els) => els.map((el) => el.getAttribute("data-volume-member-id")));
    expect(ids).toEqual(["302", "301"]);
    await expect(page.locator("#volumeGroupAuthor")).toHaveValue("گۇرۇپپا ئاپتورى");
    const titles = await page.evaluate(() => window.KutadguAdminVolumeGroups._state.members.map((member) => member.title));
    expect(titles).toEqual(["ئالما داۋامى", "ئالما خاتىرىسى"]);
  });

  test("later catalog matches stay reachable past the first result page", async ({ page }) => {
    await openLookupEditor(page);
    await page.evaluate(() => {
      for (let i = 1; i <= 41; i += 1) {
        window.__lookupBooks.push({ id: 1000 + i, title: `توپ ${i}`, author: "توپ ئاپتور", price: 1, stock: 1, image_url: "/sample-book-cover.png", isbn: null, url: `/book/${1000 + i}` });
      }
    });
    await searchLookup(page, "توپ ئاپتور");
    await expect(page.locator(".volume-admin-lookup")).toHaveCount(40);
    await expect(page.locator("[data-lookup-add='1041']")).toHaveCount(0);
    await page.evaluate(() => { window.__holdNextCatalog = true; window.__lookupHeld = false; });
    await page.locator("[data-lookup-more]").click();
    await page.waitForFunction(() => window.__lookupHeld === true);
    await page.locator("[data-volume-group-edit='88']").click();
    await page.evaluate(() => window.__releaseLookup());
    await expect(page.locator("#volumeGroupId")).toHaveValue("88");
    await expect(page.locator("#volumeGroupLookupPreview")).toBeEmpty();
    await expect(page.locator("[data-volume-member-id]")).toHaveCount(0);
    await searchLookup(page, "توپ ئاپتور");
    await expect(page.locator(".volume-admin-lookup")).toHaveCount(40);
    await page.locator("[data-lookup-more]").click();
    await expect(page.locator("[data-lookup-add='1041']")).toBeVisible();
    await expect(page.locator(".volume-admin-lookup")).toHaveCount(41);
    await expect(page.locator("[data-lookup-more]")).toHaveCount(0);
    const ranges = await page.evaluate(() => window.__catalogCalls.map((call) => call.range));
    expect(ranges).toEqual([[0, 39], [40, 79], [0, 39], [40, 79]]);
    await page.locator("[data-lookup-add='1041']").click();
    await expect(page.locator("[data-volume-member-id]")).toHaveCount(1);
    const only = await page.evaluate(() => window.KutadguAdminVolumeGroups._state.members.map((member) => member.book_id));
    expect(only).toEqual(["1041"]);
  });

  test("a long title goes to the catalog and a late selection cannot join another draft", async ({ page }) => {
    await openLookupEditor(page);
    const longTitle = "ئۇزۇن نام ".repeat(6).trim();
    expect(longTitle.length).toBeGreaterThan(32);
    await page.evaluate((title) => {
      window.__lookupBooks.push({ id: 777, title, author: "ئۇزۇن ئاپتور", price: 33, stock: 2, image_url: "/sample-book-cover.png", isbn: null, url: "/book/777" });
    }, longTitle);
    await searchLookup(page, longTitle);
    await expect(page.locator("[data-lookup-add='777']")).toBeVisible();
    expect(await page.evaluate(() => window.__volumeEditorCalls.filter((call) => call.name === "admin_preview_book_volume_members"))).toEqual([]);

    await page.evaluate(() => { window.__holdPreviewId = "777"; window.__previewHeld = false; });
    await page.locator("[data-lookup-add='777']").click();
    await page.waitForFunction(() => window.__previewHeld === true);
    await page.locator("[data-volume-group-edit='88']").click();
    await page.evaluate(() => window.__releasePreview());
    await expect(page.locator("[data-volume-member-id]")).toHaveCount(0);
    await expect(page.locator("#volumeGroupLookupPreview")).toBeEmpty();
  });

  test("exact id and ISBN lookup stay on the authoritative preview", async ({ page }) => {
    await openLookupEditor(page);
    await searchLookup(page, "156");
    await expect(page.locator("[data-lookup-add='156']")).toBeVisible();
    await expect(page.locator(".volume-admin-lookup")).toContainText("ISBN 978-1-4028-9462-6");
    expect(await page.evaluate(() => window.__catalogCalls)).toEqual([]);
    const idPreview = await page.evaluate(() => window.__volumeEditorCalls.filter((call) => call.name === "admin_preview_book_volume_members"));
    expect(idPreview).toEqual([{ name: "admin_preview_book_volume_members", args: { p_book_id: "156", p_isbn: "156" } }]);
    await page.locator("[data-lookup-add='156']").click();
    await expect(page.locator("[data-volume-member-id='156']")).toBeVisible();

    await searchLookup(page, "978-0-306-40615-7");
    await expect(page.locator("[data-lookup-add='501']")).toBeVisible();
    await expect(page.locator(".volume-admin-lookup")).toHaveCount(1);
    const isbnPreview = await page.evaluate(() => window.__volumeEditorCalls.filter((call) => call.name === "admin_preview_book_volume_members").at(-1));
    expect(isbnPreview.args).toEqual({ p_book_id: null, p_isbn: "978-0-306-40615-7" });
    const catalog = await page.evaluate(() => window.__catalogCalls);
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.at(-1).orFilter).toContain("isbn.ilike.");
  });

  test("a duplicate or a book already in another group is not added", async ({ page }) => {
    await openLookupEditor(page);
    await searchLookup(page, "ئالما خاتىرىسى");
    await page.locator("[data-lookup-add='301']").click();
    await searchLookup(page, "ئالما خاتىرىسى");
    await expect(page.locator("[data-lookup-add='301']")).toBeDisabled();
    await expect(page.locator("[data-lookup-add='301']")).toHaveText("قوشۇلغان");
    await expect(page.locator("[data-volume-member-id]")).toHaveCount(1);

    await searchLookup(page, "باغلانغان كىتاب");
    await expect(page.locator("[data-lookup-add='410']")).toBeEnabled();
    await page.locator("[data-lookup-add='410']").click();
    await expect(page.locator("#volumeGroupStatus")).toContainText("باشقا يۈرۈشلۈككە باغلانغان");
    await expect(page.locator("[data-lookup-add='410']")).toBeDisabled();
    await expect(page.locator("[data-lookup-add='410']")).toHaveText("باغلاشقا بولمايدۇ");
    await expect(page.locator("[data-volume-member-id]")).toHaveCount(1);
    const preview = await page.evaluate(() => window.__volumeEditorCalls.filter((call) => call.name === "admin_preview_book_volume_members" && String(call.args.p_book_id) === "410"));
    expect(preview.length).toBeGreaterThan(0);
  });

  test("an older search cannot replace a newer one, and a failed search can be retried", async ({ page }) => {
    await openLookupEditor(page);
    await page.evaluate(() => { window.__holdNextCatalog = true; window.__lookupHeld = false; });
    await searchLookup(page, "ئاستا");
    await page.waitForFunction(() => window.__lookupHeld === true);
    await expect(page.locator("#volumeGroupLookupPreview")).toContainText("تەكشۈرۈلۈۋاتىدۇ");
    await searchLookup(page, "تېز");
    await expect(page.locator(".volume-admin-lookup")).toContainText("تېز كىتاب");
    await page.evaluate(() => window.__releaseLookup());
    await expect(page.locator("#volumeGroupLookupPreview")).toContainText("تېز كىتاب");
    await expect(page.locator("#volumeGroupLookupPreview")).not.toContainText("ئاستا كىتاب");

    await page.evaluate(() => { window.__catalogError = "catalog_unavailable"; });
    await searchLookup(page, "ئالما");
    await expect(page.locator("#volumeGroupLookupPreview [role='alert']")).toContainText("catalog_unavailable");
    await expect(page.locator("[data-lookup-retry]")).toBeEnabled();
    await page.locator("[data-lookup-retry]").click();
    await expect(page.locator(".volume-admin-lookup strong")).toHaveText(["ئالما خاتىرىسى", "ئالما داۋامى"]);
    await searchLookup(page, "يوق نەتىجە");
    await expect(page.locator("#volumeGroupStatus")).toContainText("تېپىلمىدى");
    await expect(page.locator(".volume-admin-lookup")).toHaveCount(0);
  });

  test("saving keeps the selected existing ids in the chosen order", async ({ page }) => {
    await openLookupEditor(page);
    await page.locator("#volumeGroupTitle").fill("ئالما يۈرۈشلۈكى");
    await page.locator("#volumeGroupCategory").fill("تارىخىي رومانلار");
    await searchLookup(page, "ئالما داۋامى");
    await page.locator("[data-lookup-add='302']").click();
    await page.locator("#volumeGroupForm button[type='submit']").click();
    await expect(page.locator("#volumeGroupStatus")).toContainText("2 دىن 100");
    expect(await page.evaluate(() => window.__volumeEditorCalls.filter((call) => call.name === "admin_save_book_volume_group"))).toEqual([]);

    await searchLookup(page, "ئالما خاتىرىسى");
    await page.locator("[data-lookup-add='301']").click();
    await page.locator("[data-volume-member-id='302'] [data-member-label]").fill("داۋامى");
    await page.locator("[data-volume-member-id='301'] [data-member-label]").fill("باش قىسىم");
    await page.locator("#volumeGroupForm button[type='submit']").click();
    await expect(page.locator("#volumeGroupStatus")).toContainText("ساقلاندى");
    await expect(page.locator("[data-volume-member-id='302']")).toContainText("ئالما داۋامى");
    await expect(page.locator("[data-volume-member-id='301']")).toContainText("ئالما خاتىرىسى");
    const saves = await page.evaluate(() => window.__volumeEditorCalls.filter((call) => call.name === "admin_save_book_volume_group"));
    expect(saves).toHaveLength(1);
    expect(saves[0].args.p_members).toEqual([
      { book_id: "302", position: 1, volume_label: "داۋامى" },
      { book_id: "301", position: 2, volume_label: "باش قىسىم" }
    ]);
    expect(saves[0].args.p_group.title).toBe("ئالما يۈرۈشلۈكى");
    expect(await page.evaluate(() => window.__volumeEditorCalls.some((call) => call.name === "admin_set_book_volume_group_publication"))).toBe(false);
    expect(await page.evaluate(() => window.__bookWrites)).toEqual([]);
    expect(page._lookupWrites.filter((url) => url.includes("/rest/v1/books"))).toEqual([]);
    fs.mkdirSync(shotDir, { recursive: true });
    await page.screenshot({ path: path.join(shotDir, "lookup-saved-order.png") });
  });
});
