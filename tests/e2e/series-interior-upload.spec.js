const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const tinyGif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

function keepSeriesFieldsVisible(page) {
  return page.addInitScript(() => {
    const reveal = () => {
      document.querySelectorAll("#volumeSeriesForm [data-series-accordion-panel][hidden]").forEach((panel) => {
        panel.hidden = false;
      });
    };
    const start = () => {
      if (document.documentElement.dataset.seriesFieldsVisible === "1") return;
      document.documentElement.dataset.seriesFieldsVisible = "1";
      new MutationObserver(reveal).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden"] });
      reveal();
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  });
}

async function installRealUploader(page) {
  const calls = [];
  const gate = { failGallery: 0 };
  await page.addInitScript(() => {
    window.__seriesProbe = { creates: [], galleries: [], omitImageUrl: false, galleryFails: 0 };
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguSkipSuggestFetch = true;
    window.__kutadguAnalyticsDb = {
      auth: {
        getSession: async () => ({ data: { session: { access_token: "probe-token" } }, error: null }),
        onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
      },
      from(table) {
        const state = { table, payload: null, id: null };
        const api = {
          update(payload) { state.payload = payload; return api; },
          eq(col, id) { state.id = id; return api; },
          select() {
            const galleryWrite = !!(state.payload && Object.prototype.hasOwnProperty.call(state.payload, "gallery_images"));
            if (galleryWrite && window.__seriesProbe.galleryFails > 0) {
              window.__seriesProbe.galleryFails -= 1;
              const error = new Error("Could not find the gallery_images column of books");
              error.code = "PGRST204";
              return Promise.resolve({ data: null, error });
            }
            if (galleryWrite) {
              window.__seriesProbe.galleries.push({
                table: state.table,
                id: String(state.id),
                gallery: state.payload.gallery_images
              });
            }
            return Promise.resolve({ data: [{ id: state.id == null ? 1 : state.id }], error: null });
          },
          limit() { return Promise.resolve({ data: [], error: null }); },
          order() { return api; },
          range() { return Promise.resolve({ data: [], error: null }); }
        };
        return api;
      },
      rpc: async (name, args) => {
        if (name === "admin_create_book_volume_series") {
          const same = window.__seriesProbe.creates.some((call) => call.p_request_id === args.p_request_id);
          window.__seriesProbe.creates.push(JSON.parse(JSON.stringify(args)));
          const parts = args.p_payload && args.p_payload.parts || [];
          return { data: {
            id: 91,
            revision: 1,
            slug: "series-probe",
            title: args.p_payload.title,
            author: args.p_payload.author,
            category: args.p_payload.category,
            source: args.p_payload.source,
            description: args.p_payload.description,
            complete_set_price: args.p_payload.complete_set_price,
            is_public: false,
            is_active: true,
            replayed: same,
            members: parts.map((part, index) => {
              const member = {
                book_id: 900 + index,
                position: index + 1,
                volume_label: `${index + 1}-قىسىم`,
                title: part.title,
                price: part.price,
                stock: part.stock
              };
              if (!window.__seriesProbe.omitImageUrl) member.image_url = part.image_url;
              return member;
            })
          }, error: null };
        }
        return { data: [], error: null };
      }
    };
  });
  return { calls, gate, bindRoute: () => bindR2Route(page, calls, gate) };
}

async function bindR2Route(page, calls, gate) {
  await page.route("**/api/r2-cover-upload", async (route) => {
    const request = route.request();
    const key = request.headers()["x-kutadgu-object-key"] || "";
    const call = {
      key,
      authorization: request.headers().authorization || "",
      contentType: request.headers()["content-type"] || "",
      failed: false
    };
    if (key.includes("/gallery/") && !key.includes("/variants/") && gate.failGallery > 0) {
      gate.failGallery -= 1;
      call.failed = true;
      calls.push(call);
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "rejected" })
      });
    }
    calls.push(call);
    const url = "https://www.kutadgubilik.com/__r2/" + key.split("/").map(encodeURIComponent).join("/");
    const body = { ok: true, key, url };
    if (request.headers()["x-kutadgu-source-key"]) body.availability = "published";
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(body)
    });
  });
}

async function openSeries(page, transport) {
  await H.installReadSafeNetwork(page);
  await transport.bindRoute();
  await H.installCategoryDirectoryFixture(page);
  await keepSeriesFieldsVisible(page);
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  await page.evaluate(() => {
    window.KutadguAdminVolumeGroups.init({ db: window.__kutadguAnalyticsDb });
  });
  await page.locator('button[data-admin-section="volume-groups"]').click();
  await page.locator("#newVolumeGroupBtn").click();
  await page.locator("#showVolumeSeriesBtn").click();
  return transport;
}

async function fillSeven(page, interiors) {
  await page.locator("#volumeSeriesTitle").fill("يەتتە قىسىم");
  await page.locator("#volumeSeriesCategory").fill("تارىخىي");
  await page.locator("#volumeSeriesCategory").locator("..").getByRole("option", { name: "تارىخىي رومانلار", exact: true }).click();
  await page.locator("#volumeSeriesDescription").fill("ئىزاھات");
  await page.locator("#volumeSeriesSetPrice").fill("750");
  for (let index = 0; index < 5; index += 1) await page.locator("#volumeSeriesAddPart").click();
  const parts = page.locator(".volume-series-part");
  await expect(parts).toHaveCount(7);
  for (let index = 0; index < 7; index += 1) {
    await parts.nth(index).locator("[data-series-price]").fill(String(10 + index));
    await parts.nth(index).locator("[data-series-stock]").fill(String(index + 1));
    await parts.nth(index).locator("[data-series-title]").fill(`قىسىم ${index + 1}`);
    if (index === 6) await parts.nth(index).locator("[data-series-isbn]").fill("9781234567890");
    await parts.nth(index).locator("[data-series-cover]").setInputFiles({
      name: `cover-${index + 1}.png`,
      mimeType: "image/png",
      buffer: tinyPng
    });
  }
  if (interiors) {
    await parts.nth(0).locator("[data-series-pages-input]").setInputFiles(interiors);
  }
  return parts;
}

function png(name) {
  return { name, mimeType: "image/png", buffer: tinyPng };
}

function masterCalls(calls, marker) {
  return calls.filter((call) => call.key.includes(marker) && !call.key.includes("/variants/"));
}

test.describe("series interior upload", () => {
  test.describe.configure({ timeout: 180000 });

  test("seven parts and three interior images use the real upload and gallery update", async ({ page }) => {
    const transport = await installRealUploader(page);
    await openSeries(page, transport);
    await fillSeven(page, [png("inside-1.png"), png("inside-2.png"), png("inside-3.png")]);
    const requestId = await page.locator("#volumeSeriesRequestId").inputValue();
    await page.locator('#volumeSeriesForm button[type="submit"]').click();
    await expect(page.locator("#volumeSeriesStatus")).toContainText("ساقلاندى");
    const saved = await page.evaluate(() => ({
      creates: window.__seriesProbe.creates,
      galleries: window.__seriesProbe.galleries,
      shortcut: window.__kutadguGalleryUploads || []
    }));
    expect(saved.shortcut).toEqual([]);
    expect(saved.creates).toHaveLength(1);
    expect(saved.creates[0].p_request_id).toBe(requestId);
    expect(saved.creates[0].p_payload.parts).toHaveLength(7);
    expect(saved.creates[0].p_payload.parts[0].gallery_images).toBeUndefined();
    expect(saved.creates[0].p_payload.description).toBe("ئىزاھات");
    expect(saved.creates[0].p_payload.parts.map((part) => part.price)).toEqual([10, 11, 12, 13, 14, 15, 16]);
    expect(saved.creates[0].p_payload.parts[6].isbn).toBe("9781234567890");
    expect(saved.galleries).toEqual([{
      table: "books",
      id: "900",
      gallery: saved.galleries[0].gallery
    }]);
    expect(saved.galleries[0].gallery).toHaveLength(3);
    saved.galleries[0].gallery.forEach((url) => {
      expect(url).toContain("/book-covers/900/gallery/");
    });
    const covers = masterCalls(transport.calls, "/series-new/");
    const interiors = masterCalls(transport.calls, "/gallery/");
    expect(covers).toHaveLength(7);
    expect(interiors.filter((call) => !call.failed)).toHaveLength(3);
    interiors.forEach((call) => {
      expect(call.authorization).toBe("Bearer probe-token");
      expect(["image/png", "image/webp", "image/jpeg"]).toContain(call.contentType);
    });
  });

  test("a failed interior upload names the part, image, and stage, then a removal retries the same series", async ({ page }) => {
    const transport = await installRealUploader(page);
    transport.gate.failGallery = 1;
    await openSeries(page, transport);
    await fillSeven(page, [png("inside-1.png"), png("inside-2.png"), png("inside-3.png")]);
    const requestId = await page.locator("#volumeSeriesRequestId").inputValue();
    await page.locator('#volumeSeriesForm button[type="submit"]').click();
    const status = page.locator("#volumeSeriesStatus");
    await expect(status).toContainText("1-قىسىم");
    await expect(status).toContainText("inside-1.png");
    await expect(status).toContainText("يوللاش");
    await expect(status).toContainText("ئىچ بەت رەسىمى ساقلانمىدى");
    await expect(status).toContainText("رەسىم يوللانمىدى");
    const diagnostic = await status.getAttribute("data-diagnostic");
    expect(diagnostic).toBe("stage=upload;part=1;code=rejected");
    await expect(status).not.toContainText("rejected");
    expect(masterCalls(transport.calls, "/series-new/")).toHaveLength(7);
    expect(masterCalls(transport.calls, "/gallery/").filter((call) => call.failed)).toHaveLength(1);
    await page.locator("#volumeSeriesTitle").fill("باشقا نام");
    await page.locator(".volume-series-part").nth(0).locator("[data-page-remove]").first().click();
    await expect(page.locator(".volume-series-page")).toHaveCount(2);
    await page.locator('#volumeSeriesForm button[type="submit"]').click();
    await expect(status).toContainText("قايتا قوشۇلمىدى");
    const retry = await page.evaluate(() => window.__seriesProbe);
    expect(retry.creates).toHaveLength(2);
    expect(retry.creates[1].p_request_id).toBe(requestId);
    expect(retry.creates[1].p_payload).toEqual(retry.creates[0].p_payload);
    expect(retry.creates[1].p_payload.title).toBe("يەتتە قىسىم");
    expect(retry.creates[1].p_payload.description).toBe("ئىزاھات");
    expect(retry.creates[1].p_payload.parts[6].isbn).toBe("9781234567890");
    expect(masterCalls(transport.calls, "/series-new/")).toHaveLength(7);
    expect(masterCalls(transport.calls, "/gallery/").filter((call) => !call.failed)).toHaveLength(2);
    expect(retry.galleries).toHaveLength(1);
    expect(retry.galleries[0].id).toBe("900");
    expect(retry.galleries[0].gallery).toHaveLength(2);
    expect(await page.evaluate(() => window.__kutadguGalleryUploads || [])).toEqual([]);
  });

  test("missing member cover URLs fail at matching, and removing the images reuses the series", async ({ page }) => {
    const transport = await installRealUploader(page);
    await openSeries(page, transport);
    await page.evaluate(() => { window.__seriesProbe.omitImageUrl = true; });
    await fillSeven(page, [png("inside-1.png"), png("inside-2.png"), png("inside-3.png")]);
    const requestId = await page.locator("#volumeSeriesRequestId").inputValue();
    await page.locator('#volumeSeriesForm button[type="submit"]').click();
    const status = page.locator("#volumeSeriesStatus");
    await expect(status).toContainText("1-قىسىم");
    await expect(status).toContainText("ماسلاش");
    await expect(status).toContainText("ئىچ بەت رەسىمى ساقلانمىدى");
    expect(await status.getAttribute("data-diagnostic")).toBe("stage=match;part=1;code=interior_part_unmatched");
    await expect(status).not.toContainText("interior_part_unmatched");
    expect(masterCalls(transport.calls, "/gallery/")).toHaveLength(0);
    await page.locator(".volume-series-part").nth(0).locator("[data-page-remove]").evaluateAll((buttons) => {
      buttons.forEach((button) => button.click());
    });
    await expect(page.locator(".volume-series-page")).toHaveCount(0);
    await page.locator('#volumeSeriesForm button[type="submit"]').click();
    await expect(status).toContainText("قايتا قوشۇلمىدى");
    const retry = await page.evaluate(() => window.__seriesProbe);
    expect(retry.creates.map((call) => call.p_request_id)).toEqual([requestId, requestId]);
    expect(retry.creates[1].p_payload).toEqual(retry.creates[0].p_payload);
    expect(retry.galleries).toEqual([]);
    expect(masterCalls(transport.calls, "/series-new/")).toHaveLength(7);
    expect(masterCalls(transport.calls, "/gallery/")).toHaveLength(0);
  });

  test("GIF is refused before upload and a forced GIF names the upload stage", async ({ page }) => {
    const transport = await installRealUploader(page);
    await openSeries(page, transport);
    const parts = await fillSeven(page, [png("inside-1.png"), png("inside-2.png"), png("inside-3.png")]);
    await parts.nth(0).locator("[data-series-pages-input]").setInputFiles({
      name: "moving.gif",
      mimeType: "image/gif",
      buffer: tinyGif
    });
    await expect(page.locator(".volume-series-page")).toHaveCount(3);
    await expect(page.locator("#volumeSeriesStatus")).toContainText("JPEG، PNG ياكى WebP");
    await page.evaluate(() => {
      const pages = [...document.querySelectorAll(".volume-series-page")];
      pages.forEach((node, index) => {
        const bytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0, 0, 33, 249, 4, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59]);
        node._file = new File([bytes], `sheet-${index + 1}.gif`, { type: "image/gif" });
      });
    });
    const requestId = await page.locator("#volumeSeriesRequestId").inputValue();
    await page.locator('#volumeSeriesForm button[type="submit"]').click();
    const status = page.locator("#volumeSeriesStatus");
    await expect(status).toContainText("1-قىسىم");
    await expect(status).toContainText("sheet-1.gif");
    await expect(status).toContainText("يوللاش");
    await expect(status).toContainText("JPEG، PNG ياكى WebP");
    expect(await status.getAttribute("data-diagnostic")).toBe("stage=upload;part=1;code=invalid_object");
    expect(masterCalls(transport.calls, "/gallery/")).toHaveLength(0);
    expect(masterCalls(transport.calls, "/series-new/")).toHaveLength(7);
    await page.locator(".volume-series-part").nth(0).locator("[data-page-remove]").evaluateAll((buttons) => {
      buttons.forEach((button) => button.click());
    });
    await page.locator('#volumeSeriesForm button[type="submit"]').click();
    await expect(status).toContainText("قايتا قوشۇلمىدى");
    const retry = await page.evaluate(() => window.__seriesProbe);
    expect(retry.creates.map((call) => call.p_request_id)).toEqual([requestId, requestId]);
    expect(retry.creates[1].p_payload.title).toBe("يەتتە قىسىم");
    expect(retry.galleries).toEqual([]);
    expect(masterCalls(transport.calls, "/series-new/")).toHaveLength(7);
    expect(masterCalls(transport.calls, "/gallery/")).toHaveLength(0);
  });
});
