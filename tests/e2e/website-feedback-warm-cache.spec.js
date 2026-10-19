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

const oldShopMain = gitShow(mainSha + ":shop.js");
const releasedShop = gitShow("2eff3e230b814cc7b0ddc08012b28482c67dccbe:shop.js");
const oldShopReviewed = gitShow(reviewed + ":shop.js");
const oldShopPrevious = gitShow(previous + ":shop.js");
const oldMember = gitShow(reviewed + ":member.js");
const oldMemberPrevious = gitShow(previous + ":member.js");
const cartShareShop = gitShow("0848e8063ecccae61b7b74f3e84cc85cb9d6366a:shop.js");
const releasedOrderShop = gitShow("435bd6c11b722c59c718903224b4912bc8e79372:shop.js");
const cartShareMember = gitShow("0848e8063ecccae61b7b74f3e84cc85cb9d6366a:member.js");
const productionMember = gitShow("cd548bc0ad71c7f450f5c68f50d50fd4f8cc5197:member.js");
const oldFeedback = gitShow(previous + ":feedback.js");
const releasedCompactShop = gitShow("2401309be7e5d0c6e70bd83392952a1bacf62b51:shop.js");
const releasedCartInviteShop = gitShow("94094934ea801741043fdf1362afc31f3ec7b6f7:shop.js");
const releasedAccount = gitShow("2401309be7e5d0c6e70bd83392952a1bacf62b51:account.js");

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
  await page.route(/\/shop\.js\?v=151(?:&|$)/, fulfill(releasedShop));
  await page.route(/\/shop\.js\?v=152(?:&|$)/, fulfill(cartShareShop));
  await page.route(/\/shop\.js\?v=153(?:&|$)/, fulfill(releasedOrderShop));
  await page.route(/\/shop\.js\?v=154(?:&|$)/, fulfill(releasedCompactShop));
  await page.route(/\/shop\.js\?v=155(?:&|$)/, fulfill(releasedCartInviteShop));
  await page.route(/\/account\.js\?v=7(?:&|$)/, fulfill(releasedAccount));
  await page.route(/\/member\.js\?v=28(?:&|$)/, fulfill(oldMember));
  await page.route(/\/member\.js\?v=29(?:&|$)/, fulfill(oldMemberPrevious));
  await page.route(/\/member\.js\?v=30(?:&|$)/, fulfill(cartShareMember));
  await page.route(/\/member\.js\?v=31(?:&|$)/, fulfill(productionMember));
  await page.route(/\/feedback\.js\?v=2(?:&|$)/, fulfill(oldFeedback));
  await page.goto("/feedback", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    await fetch("/shop.js?v=148");
    await fetch("/shop.js?v=149");
    await fetch("/shop.js?v=150");
    await fetch("/shop.js?v=151");
    await fetch("/shop.js?v=152");
    await fetch("/shop.js?v=153");
    await fetch("/shop.js?v=154");
    await fetch("/shop.js?v=155");
    await fetch("/shop.js?v=142");
    await fetch("/account.js?v=7");
    await fetch("/member.js?v=28");
    await fetch("/member.js?v=29");
    await fetch("/member.js?v=30");
    await fetch("/member.js?v=31");
    await fetch("/feedback.js?v=2");
  });
  const cachedMember = await page.evaluate(async () => (await fetch("/member.js?v=28")).text());
  const cachedMemberPrevious = await page.evaluate(async () => (await fetch("/member.js?v=29")).text());
  const cachedShop = await page.evaluate(async () => (await fetch("/shop.js?v=148")).text());
  const cachedShopPrevious = await page.evaluate(async () => (await fetch("/shop.js?v=150")).text());
  const cachedShopReleased = await page.evaluate(async () => (await fetch("/shop.js?v=151")).text());
  const cachedFeedback = await page.evaluate(async () => (await fetch("/feedback.js?v=2")).text());
  expect(cachedMember).toContain("beginSignOut");
  expect(cachedMember).not.toContain("noteAuthUser");
  expect(cachedMemberPrevious).toContain("restoreRejectedSignOut");
  expect(cachedShop).not.toContain('href="/feedback"');
  expect(cachedShopPrevious).toContain("member.js?v=29");
  const cachedShopCartShare = await page.evaluate(async () => (await fetch("/shop.js?v=152")).text());
  const cachedMemberCartShare = await page.evaluate(async () => (await fetch("/member.js?v=30")).text());
  const cachedProductionMember = await page.evaluate(async () => (await fetch("/member.js?v=31")).text());
  expect(cachedShopReleased).not.toContain("my_cart_share_permission");
  expect(cachedShopCartShare).toContain("my_cart_share_permission");
  expect(cachedShopCartShare).not.toContain("noteCartShareAuth");
  const cachedReleasedOrder = await page.evaluate(async () => (await fetch("/shop.js?v=153")).text());
  expect(cachedReleasedOrder).toContain("دانە ×");
  expect(cachedReleasedOrder).not.toContain("دانە ·");
  const cachedCompactShop = await page.evaluate(async () => (await fetch("/shop.js?v=154")).text());
  const cachedAccount = await page.evaluate(async () => (await fetch("/account.js?v=7")).text());
  expect(cachedCompactShop).toContain("دانە ·");
  expect(cachedCompactShop).not.toContain("guestCartInviteDecision");
  const cachedCartInviteShop = await page.evaluate(async () => (await fetch("/shop.js?v=155")).text());
  expect(cachedCartInviteShop).toContain("guestCartInviteDecision");
  expect(cachedCartInviteShop).not.toContain("function giftViewerDecision");
  expect(cachedAccount).not.toContain("signupEntryRequested");
  expect(cachedMemberCartShare).not.toContain("noteCartShareSignOut");
  expect(cachedProductionMember).not.toContain("memberAuthFetch");
  expect(cachedProductionMember).not.toContain("/api/member-signup");
  expect(cachedFeedback).not.toContain("sendSeq");
}

async function expectFreshShop(page, path) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.locator("footer a[href='/feedback']")).toBeVisible();
  const src = await page.locator("script[src*='shop.js']").first().getAttribute("src");
  expect(src).toContain("shop.js?v=167");
  const live = await page.evaluate(async (url) => (await fetch(url)).text(), src);
  expect(live).toContain('href="/feedback"');
  expect(live).toContain("member.js?v=34");
  expect(live).toContain("my_cart_share_permission");
  expect(live).toContain("noteCartShareAuth");
  expect(live).toContain("دانە ·");
  expect(live).toContain("*جەمئىي كىتاب سانى:");
  expect(live).toContain("guestCartInviteDecision");
  expect(live).toContain("function giftViewerDecision");
  expect(live).not.toContain("دانە ×");
}

test("warm copies of the old shop and member URLs do not serve the new pages", async ({ page }) => {
  await warmOldAssets(page);
  for (const path of ["/", "/books", "/book-shell.html", "/cart.html"]) {
    await expectFreshShop(page, path);
  }
  await page.goto("/account.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("footer a[href='/feedback']")).toBeVisible();
  const memberSrc = await page.locator("script[src*='member.js']").getAttribute("src");
  expect(memberSrc).toContain("member.js?v=34");
  const memberBody = await page.evaluate(async (url) => (await fetch(url)).text(), memberSrc);
  expect(memberBody).toContain("noteAuthUser");
  expect(memberBody).toContain("noteCartShareSignOut");
  expect(memberBody).not.toContain("restoreRejectedSignOut");
  const accountSrc = await page.locator("script[src*='account.js']").getAttribute("src");
  expect(accountSrc).toContain("account.js?v=8");
  const accountBody = await page.evaluate(async (url) => (await fetch(url)).text(), accountSrc);
  expect(accountBody).toContain("signupEntryRequested");
  expect(accountBody).toContain('"#signup"');
  await page.goto("/feedback", { waitUntil: "domcontentloaded" });
  await expect(page.locator("h1")).toHaveText("پىكىر ۋە تەكلىپ");
  await expect(page.locator("script[src*='shop.js']")).toHaveAttribute("src", /shop\.js\?v=167/);
  await expect(page.locator("script[src*='member.js']")).toHaveAttribute("src", "member.js?v=34");
  const feedbackMember = await page.evaluate(async () => (await fetch(document.querySelector("script[src*='member.js']").src)).text());
  const warmedProductionMember = await page.evaluate(async () => (await fetch("/member.js?v=31")).text());
  expect(feedbackMember).toContain('"/api/member-visit"');
  expect(feedbackMember).not.toContain("memberAuthFetch");
  expect(feedbackMember).not.toContain('"/api/member-signup"');
  expect(warmedProductionMember).not.toContain("/api/member-visit");
  expect(feedbackMember).not.toBe(warmedProductionMember);
  await expect(page.locator("script[src*='feedback.js']")).toHaveAttribute("src", /feedback\.js\?v=3/);
  const feedbackBody = await page.evaluate(async () => (await fetch(document.querySelector("script[src*='feedback.js']").src)).text());
  expect(feedbackBody).toContain("noteAuthUser");
  expect(feedbackBody).toContain("characterLength");
  expect(feedbackBody).toContain("sendSeq");
});
