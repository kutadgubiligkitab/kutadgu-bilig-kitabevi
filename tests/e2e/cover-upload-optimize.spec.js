const { test, expect } = require("./playwright-test");

test("admin and staff pages optimize a new cover locally without uploading", async ({ page }) => {
  const writes = [];
  await page.route("**/storage/v1/object/**", (route) => {
    const method = String(route.request().method() || "").toUpperCase();
    if (method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH") {
      writes.push(method + " " + route.request().url());
      return route.abort();
    }
    return route.fallback();
  });
  await page.addInitScript(() => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguAdminPreviewBooks = [];
  });
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.KutadguCoverImage && window.KutadguCoverImage.MAX_EDGE === 1600);
  const admin = await page.evaluate(async () => {
    const api = window.KutadguCoverImage;
    const canvas = document.createElement("canvas");
    canvas.width = 2200;
    canvas.height = 1100;
    const ctx = canvas.getContext("2d", { alpha: true });
    ctx.clearRect(0, 0, 2200, 1100);
    ctx.fillStyle = "#f6f0e5";
    ctx.fillRect(40, 40, 2120, 1020);
    ctx.fillStyle = "#221c18";
    ctx.fillRect(120, 180, 8, 760);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const file = new File([blob], "new-cover.png", { type: "image/png" });
    const out = await api.optimizeUploadImage(file);
    const bmp = await createImageBitmap(out);
    const prepared = await api.prepareStorageUpload(out);
    const corner = await (async () => {
      const check = document.createElement("canvas");
      check.width = bmp.width;
      check.height = bmp.height;
      const c = check.getContext("2d", { alpha: true });
      c.drawImage(bmp, 0, 0);
      return Array.from(c.getImageData(0, 0, 1, 1).data);
    })();
    return {
      loaded: typeof window.coverImageApi !== "function",
      type: out.type,
      w: bmp.width,
      h: bmp.height,
      before: file.size,
      after: out.size,
      cache: prepared.options.headers["cache-control"],
      upsert: prepared.options.upsert,
      binary: prepared.body instanceof ArrayBuffer,
      corner
    };
  });
  expect(admin.type).toBe("image/webp");
  expect(admin.w).toBe(1600);
  expect(admin.h).toBe(800);
  expect(admin.after).toBeLessThan(admin.before);
  expect(admin.cache).toBe("public, max-age=31536000, immutable");
  expect(admin.upsert).toBe(false);
  expect(admin.binary).toBe(true);
  expect(admin.corner[3]).toBeLessThan(10);
  expect(writes).toEqual([]);

  await page.addInitScript(() => {
    window.__kutadguSkipStaffRoute = true;
  });
  await page.goto("/book-staff.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.KutadguCoverImage && window.KutadguBookStaff);
  const staff = await page.evaluate(() => ({
    helper: window.KutadguCoverImage.CACHE_CONTROL,
    auth: /requireAal2/.test(String(window.KutadguBookStaff.uploadStaffCover)),
    gallery: /requireAal2/.test(String(window.KutadguBookStaff.uploadStaffGallery))
  }));
  expect(staff.helper).toBe("public, max-age=31536000, immutable");
  expect(staff.auth).toBe(true);
  expect(staff.gallery).toBe(true);
  expect(writes).toEqual([]);
});
