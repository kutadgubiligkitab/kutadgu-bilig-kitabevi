#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }

let failed = 0;
const pending = [];
function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      pending.push(result.then(() => console.log("PASS", name)).catch((err) => {
        failed++;
        console.error("FAIL", name, err && err.stack || err.message);
      }));
      return;
    }
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, err && err.stack || err.message);
  }
}

const api = require(path.join(root, "kutadgu-cover-image.js"));
const adminJs = read("admin.js");
const staffJs = read("book-staff.js");
const adminHtml = read("admin.html");
const staffHtml = read("book-staff.html");
const helperJs = read("kutadgu-cover-image.js");

function slice(src, start, end) {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return src.slice(a, b);
}

test("longest edge is 1600 and WebP quality stays high", () => {
  assert.strictEqual(api.MAX_EDGE, 1600);
  assert.strictEqual(api.WEBP_QUALITY, 0.92);
  assert.strictEqual(api.CACHE_CONTROL, "public, max-age=31536000, immutable");
  assert.ok(api.WEBP_QUALITY >= 0.9);
});

test("dimensions cap the long edge, keep aspect ratio, and do not enlarge", () => {
  const wide = api.fitDimensions(4000, 2000);
  assert.strictEqual(wide.width, 1600);
  assert.strictEqual(wide.height, 800);
  assert.ok(Math.abs(wide.width / wide.height - 2) < 0.001);
  const tall = api.fitDimensions(1800, 2700);
  assert.strictEqual(tall.height, 1600);
  assert.strictEqual(tall.width, 1067);
  assert.ok(Math.abs(tall.width / tall.height - 1800 / 2700) < 0.002);
  const small = api.fitDimensions(420, 640);
  assert.deepStrictEqual({ width: small.width, height: small.height, capped: small.capped }, { width: 420, height: 640, capped: false });
  const exact = api.fitDimensions(1600, 900);
  assert.strictEqual(exact.capped, false);
  assert.strictEqual(exact.width, 1600);
  assert.strictEqual(exact.height, 900);
});

test("new upload body is binary so Storage keeps the full immutable cache header", async () => {
  const prepared = await api.prepareStorageUpload({
    type: "image/webp",
    arrayBuffer: async () => new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]).buffer
  });
  assert.ok(prepared.body instanceof ArrayBuffer);
  assert.ok(!(typeof Blob !== "undefined" && prepared.body instanceof Blob));
  assert.strictEqual(prepared.options.upsert, false);
  assert.strictEqual(prepared.options.contentType, "image/webp");
  assert.strictEqual(prepared.options.headers["cache-control"], "public, max-age=31536000, immutable");
  assert.strictEqual(api.cacheControlStoredBySupabase(prepared.body, prepared.options), api.CACHE_CONTROL);
  const blob = new Blob([new Uint8Array(16)], { type: "image/webp" });
  const multipart = api.cacheControlStoredBySupabase(blob, prepared.options);
  assert.match(multipart, /^max-age=/);
  assert.notStrictEqual(multipart, api.CACHE_CONTROL);
});

test("GIF is unchanged, SVG and non-images do not become a corrupt upload", async () => {
  const gif = { name: "page.gif", type: "image/gif", size: 20 };
  assert.strictEqual(await api.optimizeUploadImage(gif), gif);
  await assert.rejects(() => api.optimizeUploadImage({ name: "x.svg", type: "image/svg+xml", size: 10 }), /SVG/);
  const text = { name: "x.txt", type: "text/plain", size: 4 };
  assert.strictEqual(await api.optimizeUploadImage(text), text);
  await assert.rejects(() => api.optimizeUploadImage({ name: "x.bmp", type: "image/bmp", size: 10 }), /JPEG/);
});

test("replacement stamps differ and existing objects are not rewritten", () => {
  const a = api.uniqueStorageStamp();
  const b = api.uniqueStorageStamp();
  assert.notStrictEqual(a, b);
  assert.match(a, /^[a-z0-9]+-[a-z0-9]+$/);
  assert.doesNotMatch(helperJs, /\.remove\(|\.update\(|\.list\(|upsert\s*:\s*true/);
  const upload = slice(adminJs, "async function uploadCover(id,file){", "async function persistBookRow");
  const gallery = slice(adminJs, "async function uploadGalleryFile(id,file){", "async function collectGalleryUrls");
  const collect = slice(adminJs, "async function collectGalleryUrls(id){", "const KNOWN_SAMPLE_COVER_SHA256");
  assert.match(upload, /if\(!file\)return editing\?\.image_url\|\|""/);
  assert.match(upload, /if\(!db&&window\.__kutadguSkipAdminAuth\)return skipAuthPreviewCoverUrl/);
  assert.match(upload, /uniqueStorageStamp\(\)/);
  assert.match(upload, /prepareStorageUpload/);
  assert.match(upload, /upsert:false/);
  assert.doesNotMatch(upload, /\.remove\(|\.update\(|\.list\(/);
  assert.match(gallery, /uniqueStorageStamp\(\)/);
  assert.match(gallery, /upsert:false/);
  assert.match(collect, /if\(item\.file\)urls\.push\(await uploadGalleryFile/);
  assert.match(collect, /else if\(item\.url\)urls\.push\(item\.url\)/);
  assert.doesNotMatch(collect, /uploadGalleryFile\([^)]*item\.url/);
  const save = slice(adminJs, "async function saveBook(e){", "async function toggleActive(id){");
  const fpAt = save.indexOf("fingerprintSelectedCover(coverFile");
  const upAt = save.indexOf("uploadCover(storageId,coverFile)");
  assert.ok(fpAt >= 0 && upAt > fpAt);
  assert.match(adminJs, /async function optimizeCover\(file\)\{/);
  assert.doesNotMatch(read("admin-hero.js"), /KutadguCoverImage|31536000/);
  assert.doesNotMatch(read("shop.js"), /KutadguCoverImage|31536000/);
});

test("admin and staff pages load the shared helper before upload code", () => {
  assert.ok(adminHtml.indexOf('kutadgu-cover-image.js?v=1') < adminHtml.indexOf('admin.js?v=79'));
  assert.ok(staffHtml.indexOf('kutadgu-cover-image.js?v=1') < staffHtml.indexOf('book-staff.js?v=8'));
  assert.match(adminJs, /optimizeCover\(file\)/);
  assert.match(staffJs, /await requireAal2\(client\)/);
  assert.match(staffJs, /rpcIsBookStaff\(client\)/);
  const cover = slice(staffJs, "async function uploadStaffCover(client,uid,file){", "async function uploadStaffGallery");
  const gallery = slice(staffJs, "async function uploadStaffGallery(client,uid,files){", "function staffSurface");
  assert.ok(cover.indexOf("requireAal2") < cover.indexOf("optimizeUploadImage"));
  assert.ok(cover.indexOf("rpcIsBookStaff") < cover.indexOf("optimizeUploadImage"));
  assert.ok(cover.indexOf("optimizeUploadImage") < cover.indexOf(".upload("));
  assert.match(cover, /upsert:false/);
  assert.ok(gallery.indexOf("requireAal2") < gallery.indexOf(".upload("));
  assert.ok(gallery.indexOf("rpcIsBookStaff") < gallery.indexOf("optimizeUploadImage"));
  assert.match(gallery, /upsert:false/);
  assert.doesNotMatch(cover + gallery, /\.remove\(|\.update\(|\.list\(/);
});

function loadStaff() {
  const sandbox = {
    window: {
      KUTADGU_SUPABASE_CONFIG: {
        url: "https://fxlojnqwyojqjskfggmh.supabase.co",
        bucket: "book-covers"
      }
    },
    document: {
      readyState: "complete",
      querySelector() { return { hidden: true, textContent: "", value: "", addEventListener() {}, reset() {} }; },
      addEventListener() {}
    },
    console,
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    Error,
    URL,
    Promise,
    Map,
    setTimeout,
    clearTimeout
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;
  sandbox.globalThis = sandbox.window;
  vm.runInNewContext(helperJs, sandbox, { filename: "kutadgu-cover-image.js" });
  vm.runInNewContext(staffJs, sandbox, { filename: "book-staff.js" });
  return sandbox.window;
}

function staffClient(uploads, staff) {
  return {
    storage: {
      from() {
        return {
          upload(path, body, options) {
            uploads.push({ path, body, options });
            return { error: null };
          },
          getPublicUrl(path) {
            return { data: { publicUrl: "https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/" + path } };
          }
        };
      }
    },
    rpc() {
      return Promise.resolve({ data: staff, error: null });
    }
  };
}

function allowStaff(win, level) {
  win.KutadguAdminMfa = {
    inspectAccess: async () => ({ assurance: { currentLevel: level }, classified: { configured: true } }),
    normalizeLevel: (value) => String(value || "")
  };
}

test("staff cover and gallery uploads keep authorization and use a new immutable object", async () => {
  const win = loadStaff();
  const uid = "11111111-1111-4111-8111-111111111111";
  const gif = { name: "page.gif", type: "image/gif", size: 24, arrayBuffer: async () => new Uint8Array(24).buffer };
  const denied = [];
  await assert.rejects(() => win.KutadguBookStaff.uploadStaffCover(staffClient(denied, true), uid, gif), /دەلىللەش/);
  assert.strictEqual(denied.length, 0);
  allowStaff(win, "aal1");
  await assert.rejects(() => win.KutadguBookStaff.uploadStaffCover(staffClient(denied, true), uid, gif), /2-باسقۇچلۇق/);
  assert.strictEqual(denied.length, 0);
  allowStaff(win, "aal2");
  await assert.rejects(() => win.KutadguBookStaff.uploadStaffCover(staffClient(denied, false), uid, gif), /ھوقۇقى يوق/);
  assert.strictEqual(denied.length, 0);
  await assert.rejects(() => win.KutadguBookStaff.uploadStaffCover(staffClient(denied, true), uid, { name: "x.svg", type: "image/svg+xml", size: 10 }), /JPEG/);
  assert.strictEqual(denied.length, 0);
  const uploads = [];
  const client = staffClient(uploads, true);
  const first = await win.KutadguBookStaff.uploadStaffCover(client, uid, gif);
  const second = await win.KutadguBookStaff.uploadStaffCover(client, uid, { name: "other.gif", type: "image/gif", size: 24, arrayBuffer: async () => new Uint8Array(24).buffer });
  assert.notStrictEqual(uploads[0].path, uploads[1].path);
  assert.match(uploads[0].path, /^staff\/11111111-1111-4111-8111-111111111111\/\d{8}-[a-z0-9]+-cover\.gif$/);
  assert.match(first, /\/book-covers\/staff\/11111111-1111-4111-8111-111111111111\//);
  assert.notStrictEqual(first, second);
  uploads.forEach((call) => {
    assert.strictEqual(call.options.upsert, false);
    assert.strictEqual(call.options.headers["cache-control"], "public, max-age=31536000, immutable");
    assert.strictEqual(call.options.contentType, "image/gif");
    assert.ok(call.body instanceof ArrayBuffer);
  });
  const galleryUploads = [];
  const urls = await win.KutadguBookStaff.uploadStaffGallery(staffClient(galleryUploads, true), uid, [gif, gif]);
  assert.strictEqual(urls.length, 2);
  assert.notStrictEqual(galleryUploads[0].path, galleryUploads[1].path);
  assert.match(galleryUploads[0].path, /\/gallery\/\d{8}-[a-z0-9]+-0\.gif$/);
  assert.match(galleryUploads[1].path, /\/gallery\/\d{8}-[a-z0-9]+-1\.gif$/);
  galleryUploads.forEach((call) => {
    assert.strictEqual(call.options.upsert, false);
    assert.strictEqual(call.options.headers["cache-control"], api.CACHE_CONTROL);
  });
  const jpegUploads = [];
  await assert.rejects(() => win.KutadguBookStaff.uploadStaffCover(staffClient(jpegUploads, true), uid, {
    name: "cover.jpg",
    type: "image/jpeg",
    size: 32,
    arrayBuffer: async () => new Uint8Array(32).buffer
  }));
  assert.strictEqual(jpegUploads.length, 0);
});

test("browser converts JPEG and PNG to capped high-quality WebP and rejects broken files", async () => {
  const { chromium } = require("@playwright/test");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.setContent("<!doctype html><meta charset=utf-8><title>cover</title>");
    await page.addScriptTag({ path: path.join(root, "kutadgu-cover-image.js") });
    const report = await page.evaluate(async () => {
      const api = window.KutadguCoverImage;
      async function paint(width, height, mime, draw) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { alpha: mime !== "image/jpeg" });
        if (mime !== "image/jpeg") ctx.clearRect(0, 0, width, height);
        draw(ctx, width, height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, mime === "image/jpeg" ? 0.92 : undefined));
        const name = mime === "image/png" ? "cover.png" : mime === "image/webp" ? "cover.webp" : "cover.jpg";
        return { file: new File([blob], name, { type: mime }), blob, canvas };
      }
      function coverDraw(ctx, width, height) {
        ctx.fillStyle = "#f4ead8";
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = "#1b1b1b";
        for (let y = Math.floor(height * 0.12); y < height * 0.88; y += 14) {
          ctx.fillRect(Math.floor(width * 0.12), y, Math.floor(width * 0.76), 3);
        }
        ctx.fillStyle = "#8c2f2f";
        ctx.fillRect(Math.floor(width * 0.18), Math.floor(height * 0.08), Math.floor(width * 0.28), Math.floor(height * 0.06));
      }
      const jpeg = await paint(2000, 2800, "image/jpeg", coverDraw);
      const jpegOut = await api.optimizeUploadImage(jpeg.file);
      const jpegBmp = await createImageBitmap(jpegOut);
      const png = await paint(1800, 2600, "image/png", coverDraw);
      const pngOut = await api.optimizeUploadImage(png.file);
      const pngBmp = await createImageBitmap(pngOut);
      const small = await paint(420, 640, "image/jpeg", coverDraw);
      const smallOut = await api.optimizeUploadImage(small.file);
      const smallBmp = await createImageBitmap(smallOut);
      const alpha = await paint(640, 480, "image/png", (ctx, width, height) => {
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "rgba(20,20,20,1)";
        ctx.fillRect(Math.floor(width * 0.3), Math.floor(height * 0.2), Math.floor(width * 0.4), Math.floor(height * 0.6));
      });
      const alphaOut = await api.optimizeUploadImage(alpha.file);
      const alphaBmp = await createImageBitmap(alphaOut);
      const alphaCanvas = document.createElement("canvas");
      alphaCanvas.width = alphaBmp.width;
      alphaCanvas.height = alphaBmp.height;
      const alphaCtx = alphaCanvas.getContext("2d", { alpha: true });
      alphaCtx.drawImage(alphaBmp, 0, 0);
      const corner = alphaCtx.getImageData(0, 0, 1, 1).data;
      const ink = alphaCtx.getImageData(Math.floor(alphaBmp.width * 0.5), Math.floor(alphaBmp.height * 0.5), 1, 1).data;
      const wide = await paint(3200, 1800, "image/png", coverDraw);
      const wideOut = await api.optimizeUploadImage(wide.file);
      const wideBmp = await createImageBitmap(wideOut);
      const already = await paint(800, 500, "image/webp", coverDraw);
      const alreadyOut = await api.optimizeUploadImage(already.file);
      const detail = await paint(1200, 1600, "image/jpeg", coverDraw);
      const detailOut = await api.optimizeUploadImage(detail.file);
      const lowBlob = await new Promise((resolve) => detail.canvas.toBlob(resolve, "image/webp", 0.5));
      const line = await paint(900, 1200, "image/png", (ctx, width, height) => {
        ctx.fillStyle = "#fffdf8";
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = "#111111";
        ctx.fillRect(80, 80, 6, height - 160);
      });
      const lineOut = await api.optimizeUploadImage(line.file);
      const lineBmp = await createImageBitmap(lineOut);
      const lineCanvas = document.createElement("canvas");
      lineCanvas.width = lineBmp.width;
      lineCanvas.height = lineBmp.height;
      const lineCtx = lineCanvas.getContext("2d");
      lineCtx.drawImage(lineBmp, 0, 0);
      const dark = lineCtx.getImageData(82, Math.floor(lineBmp.height / 2), 1, 1).data;
      const paper = lineCtx.getImageData(20, 20, 1, 1).data;
      let broken = "";
      try {
        await api.optimizeUploadImage(new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])], "broken.jpg", { type: "image/jpeg" }));
      } catch (error) {
        broken = String(error && error.message || error);
      }
      const noise = await paint(1400, 1800, "image/png", (ctx, width, height) => {
        const image = ctx.createImageData(width, height);
        const data = image.data;
        let seed = 20260926;
        for (let i = 0; i < data.length; i += 4) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          data[i] = seed & 255;
          data[i + 1] = (seed >>> 8) & 255;
          data[i + 2] = (seed >>> 16) & 255;
          data[i + 3] = 255;
        }
        ctx.putImageData(image, 0, 0);
      });
      const noiseOut = await api.optimizeUploadImage(noise.file);
      const noiseBmp = await createImageBitmap(noiseOut);
      async function fileFrom(width, height, mime, quality, draw) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { alpha: mime !== "image/jpeg" });
        if (mime !== "image/jpeg") ctx.clearRect(0, 0, width, height);
        draw(ctx, width, height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
        const name = mime === "image/png" ? "tight.png" : "tight.jpg";
        return new File([blob], name, { type: mime });
      }
      function noiseDraw(ctx, width, height) {
        const image = ctx.createImageData(width, height);
        const data = image.data;
        let seed = 99;
        for (let i = 0; i < data.length; i += 4) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          data[i] = seed & 255;
          data[i + 1] = (seed >>> 8) & 255;
          data[i + 2] = (seed >>> 16) & 255;
          data[i + 3] = 255;
        }
        ctx.putImageData(image, 0, 0);
      }
      const tightJpeg = await fileFrom(480, 360, "image/jpeg", 0.35, noiseDraw);
      const tightJpegOut = await api.optimizeUploadImage(tightJpeg);
      const tightPng = await fileFrom(64, 64, "image/png", undefined, (ctx, width, height) => {
        ctx.fillStyle = "#f4ead8";
        ctx.fillRect(0, 0, width, height);
      });
      const tightPngOut = await api.optimizeUploadImage(tightPng);
      const smallerPng = await fileFrom(420, 640, "image/png", undefined, coverDraw);
      const smallerPngOut = await api.optimizeUploadImage(smallerPng);
      const cappedNoise = await fileFrom(1800, 2000, "image/jpeg", 0.4, noiseDraw);
      const cappedNoiseOut = await api.optimizeUploadImage(cappedNoise);
      const cappedNoiseBmp = await createImageBitmap(cappedNoiseOut);
      const smallAlpha = await fileFrom(48, 48, "image/png", undefined, (ctx, width, height) => {
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "rgba(20,20,20,1)";
        ctx.fillRect(Math.floor(width * 0.3), Math.floor(height * 0.2), Math.max(1, Math.floor(width * 0.4)), Math.max(1, Math.floor(height * 0.5)));
      });
      const smallAlphaOut = await api.optimizeUploadImage(smallAlpha);
      const smallAlphaBmp = await createImageBitmap(smallAlphaOut);
      const smallAlphaCanvas = document.createElement("canvas");
      smallAlphaCanvas.width = smallAlphaBmp.width;
      smallAlphaCanvas.height = smallAlphaBmp.height;
      const smallAlphaCtx = smallAlphaCanvas.getContext("2d", { alpha: true });
      smallAlphaCtx.drawImage(smallAlphaBmp, 0, 0);
      const prepared = await api.prepareStorageUpload(jpegOut);
      const header = new Uint8Array(await jpegOut.slice(0, 12).arrayBuffer());
      return {
        jpeg: { before: jpeg.file.size, after: jpegOut.size, type: jpegOut.type, name: jpegOut.name, w: jpegBmp.width, h: jpegBmp.height },
        noise: { before: noise.file.size, after: noiseOut.size, type: noiseOut.type, w: noiseBmp.width, h: noiseBmp.height },
        png: { before: png.file.size, after: pngOut.size, type: pngOut.type, w: pngBmp.width, h: pngBmp.height },
        small: { w: smallBmp.width, h: smallBmp.height, type: smallOut.type, before: small.file.size, after: smallOut.size },
        alpha: { corner: Array.from(corner), ink: Array.from(ink), type: alphaOut.type },
        wide: { w: wideBmp.width, h: wideBmp.height },
        already: { same: alreadyOut === already.file, before: already.file.size, after: alreadyOut.size, type: alreadyOut.type },
        tightJpeg: { same: tightJpegOut === tightJpeg, type: tightJpegOut.type, before: tightJpeg.size, after: tightJpegOut.size },
        tightPng: { same: tightPngOut === tightPng, type: tightPngOut.type, before: tightPng.size, after: tightPngOut.size },
        smallerPng: { type: smallerPngOut.type, before: smallerPng.size, after: smallerPngOut.size },
        cappedNoise: { type: cappedNoiseOut.type, before: cappedNoise.size, after: cappedNoiseOut.size, w: cappedNoiseBmp.width, h: cappedNoiseBmp.height },
        smallAlpha: { same: smallAlphaOut === smallAlpha, type: smallAlphaOut.type, corner: Array.from(smallAlphaCtx.getImageData(0, 0, 1, 1).data) },
        low: lowBlob.size,
        high: detailOut.size,
        line: { dark: Array.from(dark), paper: Array.from(paper) },
        broken,
        cache: prepared.options.headers["cache-control"],
        upsert: prepared.options.upsert,
        bodyBytes: prepared.body.byteLength,
        header: Array.from(header)
      };
    });
    assert.strictEqual(report.jpeg.type, "image/webp");
    assert.match(report.jpeg.name, /\.webp$/);
    assert.strictEqual(report.jpeg.h, 1600);
    assert.strictEqual(report.jpeg.w, 1143);
    assert.ok(report.jpeg.after < report.jpeg.before, "jpeg " + report.jpeg.before + " -> " + report.jpeg.after);
    assert.strictEqual(report.noise.type, "image/webp");
    assert.strictEqual(report.noise.h, 1600);
    assert.strictEqual(report.noise.w, 1244);
    assert.ok(report.noise.after < report.noise.before, "noise " + report.noise.before + " -> " + report.noise.after);
    assert.strictEqual(report.png.type, "image/webp");
    assert.strictEqual(report.png.h, 1600);
    assert.strictEqual(report.png.w, 1108);
    assert.ok(Math.abs(report.png.w / report.png.h - 1800 / 2600) < 0.01);
    assert.ok(report.png.after < report.png.before, "png " + report.png.before + " -> " + report.png.after);
    assert.deepStrictEqual({ w: report.small.w, h: report.small.h, type: report.small.type }, { w: 420, h: 640, type: "image/webp" });
    assert.ok(report.small.after < report.small.before);
    assert.strictEqual(report.tightJpeg.same, true);
    assert.strictEqual(report.tightJpeg.type, "image/jpeg");
    assert.strictEqual(report.tightJpeg.after, report.tightJpeg.before);
    assert.strictEqual(report.tightPng.same, true);
    assert.strictEqual(report.tightPng.type, "image/png");
    assert.strictEqual(report.tightPng.after, report.tightPng.before);
    assert.strictEqual(report.smallerPng.type, "image/webp");
    assert.ok(report.smallerPng.after < report.smallerPng.before);
    assert.strictEqual(report.cappedNoise.type, "image/webp");
    assert.strictEqual(report.cappedNoise.w, 1440);
    assert.strictEqual(report.cappedNoise.h, 1600);
    assert.ok(report.cappedNoise.after > report.cappedNoise.before);
    assert.strictEqual(report.smallAlpha.same, true);
    assert.strictEqual(report.smallAlpha.type, "image/png");
    assert.ok(report.smallAlpha.corner[3] < 10);
    assert.strictEqual(report.alpha.type, "image/webp");
    assert.ok(report.alpha.corner[3] < 10, "corner alpha " + report.alpha.corner.join(","));
    assert.ok(report.alpha.ink[3] > 240, "ink alpha " + report.alpha.ink.join(","));
    assert.deepStrictEqual(report.wide, { w: 1600, h: 900 });
    assert.ok(report.already.after <= report.already.before);
    assert.strictEqual(report.already.type, "image/webp");
    if (!report.already.same) assert.ok(report.already.after < report.already.before);
    assert.ok(report.high > report.low, "q0.92 " + report.high + " vs q0.5 " + report.low);
    assert.ok(report.line.dark[0] < 40 && report.line.paper[0] > 220);
    assert.match(report.broken, /بۇزۇلغان/);
    assert.strictEqual(report.cache, "public, max-age=31536000, immutable");
    assert.strictEqual(report.upsert, false);
    assert.strictEqual(report.bodyBytes, report.jpeg.after);
    assert.deepStrictEqual(report.header.slice(0, 4), [0x52, 0x49, 0x46, 0x46]);
    assert.deepStrictEqual(report.header.slice(8, 12), [0x57, 0x45, 0x42, 0x50]);
    console.log("EXAMPLE jpeg 2000x2800", report.jpeg.before, "->", report.jpeg.after);
    console.log("EXAMPLE png 1800x2600", report.png.before, "->", report.png.after);
    console.log("EXAMPLE noisy png 1400x1800", report.noise.before, "->", report.noise.after);
    fs.writeFileSync("/tmp/cover-upload-sizes.json", JSON.stringify({ jpeg: report.jpeg, png: report.png, noise: report.noise, low: report.low, high: report.high }, null, 2));
  } finally {
    await browser.close();
  }
});

Promise.all(pending).then(() => {
  if (failed) {
    console.error("\n" + failed + " cover upload optimization test(s) failed");
    process.exit(1);
  }
  console.log("cover-upload-optimize-tests ok");
});
