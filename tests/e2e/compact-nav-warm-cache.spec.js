const { test, expect } = require("@playwright/test");
const { execFileSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "../..");
const released = "007a635ff101e9582da312273539a6b8e4c15449";

function releasedBlob(file) {
  const args = ["show", released + ":" + file];
  try {
    return execFileSync("git", args, { cwd: root });
  } catch (err) {
    execFileSync("git", ["fetch", "--depth=1", "origin", released], {
      cwd: root,
      stdio: "ignore",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
    });
    return execFileSync("git", args, { cwd: root });
  }
}

const shop180 = releasedBlob("shop.js");
const premium22 = releasedBlob("premium-ux.js");

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".webp")) return "image/webp";
  if (file.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

function startServer() {
  const hits = { shop180: 0, premium22: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const cache = { "cache-control": "public, max-age=600" };
    if (url.pathname === "/warm-hits.json") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(hits));
      return;
    }
    if (url.pathname === "/shop.js" && url.searchParams.get("v") === "180") {
      hits.shop180 += 1;
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", ...cache });
      res.end(shop180);
      return;
    }
    if (url.pathname === "/premium-ux.js" && url.searchParams.get("v") === "22") {
      hits.premium22 += 1;
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", ...cache });
      res.end(premium22);
      return;
    }
    if (url.pathname === "/warm-released.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...cache });
      res.end(`<!doctype html><meta charset="utf-8"><title>warm</title>
<script>
window.__warm = Promise.all([
  fetch("/shop.js?v=180").then((response) => response.text()),
  fetch("/premium-ux.js?v=22").then((response) => response.text())
]).then((bodies) => { window.__warmBodies = bodies; });
</script>`);
      return;
    }
    const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("missing");
      return;
    }
    res.writeHead(200, { "content-type": contentType(file), ...cache });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("released shop and premium blobs stay cached and cannot rebuild discovery", async ({ page }) => {
  const server = await startServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const seen = [];
  page.on("request", (request) => seen.push(request.url()));
  const client = await page.context().newCDPSession(page);
  await client.send("Network.setCacheDisabled", { cacheDisabled: false });
  try {
    await page.goto(origin + "/warm-released.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Array.isArray(window.__warmBodies) && window.__warmBodies.length === 2);
    const warmed = await page.evaluate(() => window.__warmBodies);
    const firstSizes = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => ({
      name: entry.name,
      transfer: entry.transferSize
    })));
    expect(warmed[0]).toContain("function giftViewerDecision");
    expect(warmed[1]).toContain("قايسى كىتابنى ئوقۇغىڭىز بار");
    expect(premium22.toString("utf8")).toContain("قايسى كىتابنى ئوقۇغىڭىز بار");
    expect(firstSizes.find((entry) => entry.name.includes("shop.js?v=180")).transfer).toBeGreaterThan(0);
    expect(firstSizes.find((entry) => entry.name.includes("premium-ux.js?v=22")).transfer).toBeGreaterThan(0);
    const firstHits = await page.evaluate(async () => (await fetch("/warm-hits.json", { cache: "no-store" })).json());
    expect(firstHits).toEqual({ shop180: 1, premium22: 1 });
    const second = await page.evaluate(async () => {
      const shop = await fetch("/shop.js?v=180", { cache: "force-cache" });
      const premium = await fetch("/premium-ux.js?v=22", { cache: "force-cache" });
      return { shop: await shop.text(), premium: await premium.text() };
    });
    expect(second.shop).toContain("function giftViewerDecision");
    expect(second.premium).toContain("قايسى كىتابنى ئوقۇغىڭىز بار");
    const secondHits = await page.evaluate(async () => (await fetch("/warm-hits.json", { cache: "no-store" })).json());
    expect(secondHits).toEqual({ shop180: 1, premium22: 1 });

    seen.length = 0;
    await page.route(/https?:\/\/(?!127\.0\.0\.1)(?!localhost)/, (route) => route.abort());
    await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("script[src*='shop.js']").first()).toHaveAttribute("src", /shop\.js\?v=186/);
    await page.waitForResponse((response) => response.url().includes("premium-ux.js?v=23"));
    await expect.poll(async () => page.locator("#premiumDiscovery").count()).toBe(0);
    expect(seen.some((url) => url.includes("premium-ux.js?v=22"))).toBe(false);
    expect(seen.some((url) => url.includes("premium-ux.js?v=23"))).toBe(true);
    const live = await page.evaluate(async () => (await fetch(document.querySelector("script[src*='premium-ux.js']").src)).text());
    expect(live).not.toContain("قايسى كىتابنى ئوقۇغىڭىز بار");
    expect(live).toContain("#premiumDiscovery");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
