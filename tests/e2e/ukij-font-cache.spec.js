const { test, expect } = require("@playwright/test");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const FILES = {
  "/theme.css": ["theme.css", "text/css; charset=utf-8"],
  "/UKIJCJK-primary.woff2": ["UKIJCJK-primary.woff2", "font/woff2"],
  "/UKIJCJK-primary.ttf": ["UKIJCJK-primary.ttf", "font/ttf"],
  "/UKIJCJK.woff2": ["UKIJCJK.woff2", "font/woff2"],
  "/UKIJCJK.ttf": ["UKIJCJK.ttf", "font/ttf"]
};

function fontKind(url) {
  const pathname = new URL(url).pathname;
  if (pathname.endsWith("/UKIJCJK-primary.woff2")) return "primary-woff2";
  if (pathname.endsWith("/UKIJCJK.woff2")) return "full-woff2";
  return "";
}

function startServer() {
  const html = fs.readFileSync(path.join(__dirname, "fixtures", "ukij-font-cache.html"));
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/fixture.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
      return;
    }
    const file = FILES[url.pathname];
    if (!file) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      "content-type": file[1],
      "cache-control": "public, max-age=86400"
    });
    res.end(fs.readFileSync(path.join(ROOT, file[0])));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("a second unrouted navigation uses the cached primary font", async ({ context }) => {
  test.setTimeout(60000);
  const server = await startServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await context.newPage();
  const seen = [];
  page.on("request", (request) => {
    const kind = fontKind(request.url());
    if (kind) seen.push(kind);
  });
  try {
    await page.goto(`${origin}/fixture.html`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    expect(seen).toContain("primary-woff2");
    expect(seen).not.toContain("full-woff2");
    const cold = await page.evaluate(() => performance.getEntriesByType("resource")
      .filter((entry) => entry.name.includes("UKIJCJK"))
      .map((entry) => ({ name: entry.name.split("/").pop(), transfer: entry.transferSize, decoded: entry.decodedBodySize })));
    expect(cold.some((entry) => entry.name === "UKIJCJK-primary.woff2" && entry.transfer > 0)).toBe(true);

    const warmPage = await context.newPage();
    const warmSeen = [];
    warmPage.on("request", (request) => {
      const kind = fontKind(request.url());
      if (kind) warmSeen.push(kind);
    });
    await warmPage.goto(`${origin}/fixture.html`, { waitUntil: "domcontentloaded" });
    await warmPage.evaluate(() => document.fonts.ready);
    expect(warmSeen).not.toContain("full-woff2");
    const warm = await warmPage.evaluate(() => performance.getEntriesByType("resource")
      .filter((entry) => entry.name.includes("UKIJCJK"))
      .map((entry) => ({ name: entry.name.split("/").pop(), transfer: entry.transferSize, decoded: entry.decodedBodySize })));
    const primary = warm.find((entry) => entry.name === "UKIJCJK-primary.woff2");
    expect(primary, JSON.stringify({ warm, warmSeen })).toBeTruthy();
    expect(primary.transfer).toBe(0);
    expect(primary.decoded).toBeGreaterThan(0);
    await warmPage.evaluate(() => {
      const probe = document.createElement("span");
      probe.id = "ukij-font-probe";
      probe.textContent = "كىتابخانىسى";
      probe.style.cssText = 'position:absolute;left:8px;top:8px;font-size:32px;font-weight:700;font-family:"UKIJ CJK", Arial, sans-serif';
      document.body.appendChild(probe);
    });
    const client = await context.newCDPSession(warmPage);
    await client.send("DOM.enable");
    await client.send("CSS.enable");
    const doc = await client.send("DOM.getDocument");
    const node = await client.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#ukij-font-probe" });
    const used = await client.send("CSS.getPlatformFontsForNode", { nodeId: node.nodeId });
    await client.detach();
    expect(used.fonts).toEqual([
      expect.objectContaining({ familyName: "UKIJ CJK", isCustomFont: true, glyphCount: 11 })
    ]);
    await warmPage.close();
  } finally {
    await page.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
