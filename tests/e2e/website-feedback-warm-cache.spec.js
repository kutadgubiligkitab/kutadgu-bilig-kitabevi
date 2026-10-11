const { execFileSync } = require("child_process");
const { test, expect } = require("@playwright/test");

const mainSha = "b6d0aa793f814934110e5d51dfb99b4236a7f5fd";
const reviewed = "574ec9f33229e5f356be0afe3e32c647ecb9393f";
const previous = "4b6775726d152ad83db6bf859c80638544971a81";

function gitShow(spec) {
  try {
    return execFileSync("git", ["show", spec]);
  } catch (error) {
    const colon = spec.indexOf(":");
    const rev = spec.slice(0, colon);
    const file = spec.slice(colon + 1);
    const sha = rev === "origin/main" ? mainSha : rev;
    execFileSync("git", ["fetch", "--depth=1", "origin", sha], { stdio: "inherit" });
    return execFileSync("git", ["show", sha + ":" + file]);
  }
}

const oldShopMain = gitShow("origin/main:shop.js");
const oldShopReviewed = gitShow(reviewed + ":shop.js");
const oldShopPrevious = gitShow(previous + ":shop.js");
const oldMember = gitShow(reviewed + ":member.js");
const oldMemberPrevious = gitShow(previous + ":member.js");
const oldFeedback = gitShow(previous + ":feedback.js");

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
  await page.route(/\/shop\.js\?v=150(?:&|$)/, fulfill(oldShopPrevious));
  await page.route(/\/member\.js\?v=28(?:&|$)/, fulfill(oldMember));
  await page.route(/\/member\.js\?v=29(?:&|$)/, fulfill(oldMemberPrevious));
  await page.route(/\/feedback\.js\?v=2(?:&|$)/, fulfill(oldFeedback));
  await page.goto("/feedback", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    await fetch("/shop.js?v=148");
    await fetch("/shop.js?v=149");
    await fetch("/shop.js?v=150");
    await fetch("/shop.js?v=142");
    await fetch("/member.js?v=28");
    await fetch("/member.js?v=29");
    await fetch("/feedback.js?v=2");
  });
  const cachedMember = await page.evaluate(async () => (await fetch("/member.js?v=28")).text());
  const cachedMemberPrevious = await page.evaluate(async () => (await fetch("/member.js?v=29")).text());
  const cachedShop = await page.evaluate(async () => (await fetch("/shop.js?v=148")).text());
  const cachedShopPrevious = await page.evaluate(async () => (await fetch("/shop.js?v=150")).text());
  const cachedFeedback = await page.evaluate(async () => (await fetch("/feedback.js?v=2")).text());
  expect(cachedMember).toContain("beginSignOut");
  expect(cachedMember).not.toContain("noteAuthUser");
  expect(cachedMemberPrevious).toContain("restoreRejectedSignOut");
  expect(cachedShop).not.toContain('href="/feedback"');
  expect(cachedShopPrevious).toContain("member.js?v=29");
  expect(cachedFeedback).not.toContain("sendSeq");
}

async function expectFreshShop(page, path) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.locator("footer a[href='/feedback']")).toBeVisible();
  const src = await page.locator("script[src*='shop.js']").first().getAttribute("src");
  expect(src).toContain("shop.js?v=151");
  const live = await page.evaluate(async (url) => (await fetch(url)).text(), src);
  expect(live).toContain('href="/feedback"');
  expect(live).toContain("member.js?v=30");
}

test("warm copies of the old shop and member URLs do not serve the new pages", async ({ page }) => {
  await warmOldAssets(page);
  for (const path of ["/", "/books", "/book-shell.html", "/cart.html"]) {
    await expectFreshShop(page, path);
  }
  await page.goto("/account.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("footer a[href='/feedback']")).toBeVisible();
  const memberSrc = await page.locator("script[src*='member.js']").getAttribute("src");
  expect(memberSrc).toContain("member.js?v=30");
  const memberBody = await page.evaluate(async (url) => (await fetch(url)).text(), memberSrc);
  expect(memberBody).toContain("noteAuthUser");
  expect(memberBody).not.toContain("restoreRejectedSignOut");
  await page.goto("/feedback", { waitUntil: "domcontentloaded" });
  await expect(page.locator("h1")).toHaveText("پىكىر ۋە تەكلىپ");
  await expect(page.locator("script[src*='shop.js']")).toHaveAttribute("src", /shop\.js\?v=151/);
  await expect(page.locator("script[src*='member.js']")).toHaveAttribute("src", /member\.js\?v=30/);
  await expect(page.locator("script[src*='feedback.js']")).toHaveAttribute("src", /feedback\.js\?v=3/);
  const feedbackBody = await page.evaluate(async () => (await fetch(document.querySelector("script[src*='feedback.js']").src)).text());
  expect(feedbackBody).toContain("noteAuthUser");
  expect(feedbackBody).toContain("characterLength");
  expect(feedbackBody).toContain("sendSeq");
});
