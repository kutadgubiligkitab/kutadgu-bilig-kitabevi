const { execFileSync } = require("child_process");
const { test, expect } = require("@playwright/test");

const reviewed = "574ec9f33229e5f356be0afe3e32c647ecb9393f";
const oldShopMain = execFileSync("git", ["show", "origin/main:shop.js"]);
const oldShopReviewed = execFileSync("git", ["show", reviewed + ":shop.js"]);
const oldMember = execFileSync("git", ["show", reviewed + ":member.js"]);

function fulfill(body) {
  return (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript; charset=utf-8",
    headers: { "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" },
    body: body
  });
}

async function warmOldAssets(page) {
  await page.route(/\/shop\.js\?v=148(?:&|$)/, fulfill(oldShopMain));
  await page.route(/\/shop\.js\?v=142(?:&|$)/, fulfill(oldShopMain));
  await page.route(/\/shop\.js\?v=149(?:&|$)/, fulfill(oldShopReviewed));
  await page.route(/\/member\.js\?v=28(?:&|$)/, fulfill(oldMember));
  await page.goto("/feedback", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    await fetch("/shop.js?v=148");
    await fetch("/shop.js?v=149");
    await fetch("/shop.js?v=142");
    await fetch("/member.js?v=28");
  });
  const cachedMember = await page.evaluate(async () => (await fetch("/member.js?v=28")).text());
  const cachedShop = await page.evaluate(async () => (await fetch("/shop.js?v=148")).text());
  expect(cachedMember).toContain("beginSignOut");
  expect(cachedMember).not.toContain("noteAuthUser");
  expect(cachedShop).not.toContain('href="/feedback"');
}

async function expectFreshShop(page, path) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.locator("footer a[href='/feedback']")).toBeVisible();
  const src = await page.locator("script[src*='shop.js']").first().getAttribute("src");
  expect(src).toContain("shop.js?v=150");
  const live = await page.evaluate(async (url) => (await fetch(url)).text(), src);
  expect(live).toContain('href="/feedback"');
  expect(live).toContain("member.js?v=29");
}

test("warm copies of the old shop and member URLs do not serve the new pages", async ({ page }) => {
  await warmOldAssets(page);
  for (const path of ["/", "/books", "/book-shell.html", "/cart.html"]) {
    await expectFreshShop(page, path);
  }
  await page.goto("/account.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("footer a[href='/feedback']")).toBeVisible();
  const memberSrc = await page.locator("script[src*='member.js']").getAttribute("src");
  expect(memberSrc).toContain("member.js?v=29");
  const memberBody = await page.evaluate(async (url) => (await fetch(url)).text(), memberSrc);
  expect(memberBody).toContain("noteAuthUser");
  await page.goto("/feedback", { waitUntil: "domcontentloaded" });
  await expect(page.locator("h1")).toHaveText("پىكىر ۋە تەكلىپ");
  await expect(page.locator("script[src*='shop.js']")).toHaveAttribute("src", /shop\.js\?v=150/);
  await expect(page.locator("script[src*='member.js']")).toHaveAttribute("src", /member\.js\?v=29/);
  await expect(page.locator("script[src*='feedback.js']")).toHaveAttribute("src", /feedback\.js\?v=2/);
  const feedbackBody = await page.evaluate(async () => (await fetch(document.querySelector("script[src*='feedback.js']").src)).text());
  expect(feedbackBody).toContain("noteAuthUser");
  expect(feedbackBody).toContain("characterLength");
});
