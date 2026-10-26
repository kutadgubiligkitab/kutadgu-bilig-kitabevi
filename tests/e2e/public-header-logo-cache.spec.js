const { test, expect } = require("./playwright-test");
const pins = require("../../scripts/ci-asset-pins");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");

const root = path.join(__dirname, "..", "..");
const releasedHeader = fs.readFileSync(path.join(__dirname, "fixtures", "public-header-477d372.js"));
const currentHeader = fs.readFileSync(path.join(root, "public-header.js"));
const cartHtml = fs.readFileSync(path.join(root, "cart.html"));
const headerCss = fs.readFileSync(path.join(root, "public-header.css"));
const images = {
  "/kutadgu-logo-128.webp": ["image/webp", fs.readFileSync(path.join(root, "kutadgu-logo-128.webp"))],
  "/kutadgu-logo-128.png": ["image/png", fs.readFileSync(path.join(root, "kutadgu-logo-128.png"))],
  "/kutadgu-logo.webp": ["image/webp", fs.readFileSync(path.join(root, "kutadgu-logo.webp"))],
  "/kutadgu-logo.png": ["image/png", fs.readFileSync(path.join(root, "kutadgu-logo.png"))]
};
const warmHtml = Buffer.from(
  "<!doctype html><html lang=\"ug\" dir=\"rtl\"><head><title>warm</title></head><body><script src=\"/public-header.js?v=5\"></script></body></html>",
  "utf8"
);

function blobSha1(buffer) {
  return crypto.createHash("sha1").update("blob " + buffer.length + "\0").update(buffer).digest("hex");
}

test("a warm released header cache still fetches the cart logo helper", async ({ browser }) => {
  expect(blobSha1(releasedHeader)).toBe("c896349045d78d7f882140c8ef16bbf43bde1535");
  expect(releasedHeader.toString("utf8")).toContain('srcset="/kutadgu-logo.webp"');
  expect(releasedHeader.toString("utf8")).not.toContain("kutadgu-logo-128");
  expect(currentHeader.toString("utf8")).toContain('srcset="/kutadgu-logo-128.webp"');
  expect(cartHtml.toString("utf8")).toContain('src="' + pins.assetQuery("public-header.js") + '"');
  expect(cartHtml.toString("utf8")).not.toContain("kutadgu-logo");

  const hits = { v5: 0, v6: 0 };
  const origin = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (url.pathname === "/header-v5-warm.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(warmHtml);
        return;
      }
      if (url.pathname === "/cart.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(cartHtml);
        return;
      }
      if (url.pathname === "/public-header.js" && url.searchParams.get("v") === "5") {
        hits.v5 += 1;
        res.writeHead(200, {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "public, max-age=300",
          "content-length": releasedHeader.length
        });
        res.end(releasedHeader);
        return;
      }
      if (url.pathname === "/public-header.js" && url.searchParams.get("v") === pins.assetPin("public-header.js")) {
        hits.v6 += 1;
        res.writeHead(200, {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-store",
          "content-length": currentHeader.length
        });
        res.end(currentHeader);
        return;
      }
      if (url.pathname === "/public-header.css") {
        res.writeHead(200, {
          "content-type": "text/css; charset=utf-8",
          "cache-control": "no-store",
          "content-length": headerCss.length
        });
        res.end(headerCss);
        return;
      }
      const image = images[url.pathname];
      if (image) {
        res.writeHead(200, {
          "content-type": image[0],
          "cache-control": "no-store",
          "content-length": image[1].length
        });
        res.end(image[1]);
        return;
      }
      if (url.pathname.endsWith(".js")) {
        const empty = Buffer.from("/* blocked */");
        res.writeHead(200, {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-store",
          "content-length": empty.length
        });
        res.end(empty);
        return;
      }
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      res.end("not found");
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, origin: "http://127.0.0.1:" + server.address().port }));
    server.on("error", reject);
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(origin.origin + "/header-v5-warm.html", { waitUntil: "domcontentloaded" });
    expect(hits.v5).toBe(1);
    await page.goto(origin.origin + "/header-v5-warm.html", { waitUntil: "domcontentloaded" });
    expect(hits.v5).toBe(1);
    const warmed = await page.evaluate(() => performance.getEntriesByType("resource")
      .filter((entry) => entry.name.includes("public-header.js?v=5"))
      .map((entry) => ({ transferSize: entry.transferSize, decodedBodySize: entry.decodedBodySize })));
    expect(warmed.some((entry) => entry.transferSize === 0 && entry.decodedBodySize > 0)).toBe(true);

    await page.goto(origin.origin + "/cart.html", { waitUntil: "domcontentloaded" });
    expect(hits.v6).toBe(1);
    expect(hits.v5).toBe(1);
    const fetched = await page.evaluate(() => performance.getEntriesByType("resource")
      .filter((entry) => entry.name.includes(pins.assetQuery("public-header.js")))
      .map((entry) => entry.transferSize));
    expect(fetched.some((size) => size > 0)).toBe(true);
    await expect(page.locator("script[src='" + pins.assetQuery("public-header.js") + "']")).toHaveCount(1);

    const logo = page.locator("header.kutadgu-public-header img.kutadgu-site-logo");
    await expect(logo).toBeVisible();
    await page.waitForFunction(() => {
      const img = document.querySelector("header.kutadgu-public-header img.kutadgu-site-logo");
      return img && img.naturalWidth > 0;
    });
    const drawn = await logo.evaluate((img) => ({
      currentSrc: img.currentSrc,
      src: img.getAttribute("src"),
      naturalWidth: img.naturalWidth,
      width: Math.round(img.getBoundingClientRect().width)
    }));
    const source = await page.locator("header.kutadgu-public-header picture.kutadgu-site-logo-picture source").getAttribute("srcset");
    expect(source).toBe("/kutadgu-logo-128.webp");
    expect(drawn.src).toBe("/kutadgu-logo-128.png");
    expect(drawn.currentSrc).toContain("/kutadgu-logo-128.webp");
    expect(drawn.naturalWidth).toBe(128);
    expect(drawn.width).toBe(38);
    const resources = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name));
    expect(resources.some((name) => name.includes("/kutadgu-logo-128.webp"))).toBe(true);
    expect(resources.some((name) => /\/kutadgu-logo\.webp(?:\?|$)/.test(name))).toBe(false);
  } finally {
    await context.close();
    await new Promise((resolve) => origin.server.close(resolve));
  }
});
