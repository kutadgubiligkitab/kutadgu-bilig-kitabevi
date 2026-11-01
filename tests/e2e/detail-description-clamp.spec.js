const fs = require("fs");
const path = require("path");
const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const shellPath = path.join(__dirname, "..", "..", "book-shell.html");
const shopPath = path.join(__dirname, "..", "..", "shop.js");
const shell = fs.readFileSync(shellPath, "utf8");
const shop = fs.readFileSync(shopPath, "utf8");

function paint(page, text) {
  return page.evaluate((value) => {
    const section = document.querySelector(".dynamic-book-description");
    window.kutadguShop.paintDetailDescription(section, value);
    const paragraph = section.querySelector("p");
    const button = section.querySelector(".detail-description-toggle");
    const style = paragraph ? getComputedStyle(paragraph) : null;
    return {
      hidden: section.hidden,
      text: paragraph ? paragraph.textContent : "",
      buttons: section.querySelectorAll(".detail-description-toggle").length,
      buttonHidden: button ? button.hidden : null,
      expanded: button ? button.getAttribute("aria-expanded") : null,
      controls: button ? button.getAttribute("aria-controls") : null,
      bodyId: (section.querySelector(".detail-description-body") || {}).id || "",
      clamped: !!(section.querySelector(".detail-description-body") || {}).classList?.contains("is-clamped"),
      direction: paragraph ? style.direction : "",
      whiteSpace: paragraph ? style.whiteSpace : "",
      lineClamp: paragraph ? style.webkitLineClamp : "",
      lineHeight: paragraph ? parseFloat(style.lineHeight) : 0,
      height: paragraph ? paragraph.getBoundingClientRect().height : 0,
      scroll: paragraph ? paragraph.scrollHeight : 0
    };
  }, text);
}

async function openShell(page) {
  await H.installReadSafeNetwork(page);
  await page.goto("/book-shell.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.kutadguShop && typeof window.kutadguShop.paintDetailDescription === "function");
  await page.evaluate(() => new Promise((resolve) => {
    if (Array.isArray(window.KUTADGU_LIVE_CATALOG)) {
      resolve();
      return;
    }
    document.addEventListener("kutadgu:catalog-ready", () => resolve(), { once: true });
  }));
}

test.describe("public book description clamp", () => {
  test("volume groups and books share one description painter", () => {
    expect(shop).toMatch(/description:activeVolumeGroup\.description\|\|b\.description/);
    expect(shop).toMatch(/populateDynamicBookPage\(displayBook\)/);
    expect(shop).toMatch(/paintDetailDescription\(desc,b\.description\|\|""\)/);
    expect(shell).not.toMatch(/<button[^>]*detail-description-toggle/);
    expect(shell).toMatch(/<section class="dynamic-book-description" hidden>/);
  });

  test("short and empty descriptions do not show a control", async ({ page }) => {
    await openShell(page);
    const empty = await paint(page, "   \n");
    expect(empty.hidden).toBe(true);
    expect(empty.buttonHidden).not.toBe(false);
    const short = await paint(page, "قىسقا چۈشەندۈرۈش");
    expect(short.hidden).toBe(false);
    expect(short.text).toBe("قىسقا چۈشەندۈرۈش");
    expect(short.buttonHidden).toBe(true);
    expect(short.buttons).toBeLessThanOrEqual(1);
    expect(short.direction).toBe("rtl");
    expect(short.whiteSpace).toBe("pre-line");
    expect(short.clamped).toBe(false);
  });

  test("long descriptions clamp to 7 desktop lines and 5 mobile lines", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openShell(page);
    const paragraph = "بۇ ئۇزۇن چۈشەندۈرۈش سېتىۋالغۇچىنى باھا كونترولىدىن ئايرىپ قويماسلىقى كېرەك.";
    const long = `${paragraph}\n\n${paragraph}`.repeat(8);
    const desktop = await paint(page, long);
    expect(desktop.buttons).toBe(1);
    expect(desktop.buttonHidden).toBe(false);
    expect(desktop.expanded).toBe("false");
    expect(desktop.controls).toBe("detail-description-body");
    expect(desktop.bodyId).toBe("detail-description-body");
    expect(desktop.text).toBe(long);
    expect(desktop.clamped).toBe(true);
    expect(desktop.lineClamp).toBe("7");
    expect(desktop.height).toBeGreaterThan(desktop.lineHeight * 6);
    expect(desktop.height).toBeLessThan(desktop.lineHeight * 7 + 4);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const mobile = await page.evaluate(() => {
      const paragraphNode = document.querySelector(".dynamic-book-description p");
      const style = getComputedStyle(paragraphNode);
      return {
        buttons: document.querySelectorAll(".detail-description-toggle").length,
        lineClamp: style.webkitLineClamp,
        lineHeight: parseFloat(style.lineHeight),
        height: paragraphNode.getBoundingClientRect().height,
        text: paragraphNode.textContent
      };
    });
    expect(mobile.buttons).toBe(1);
    expect(mobile.text).toBe(long);
    expect(mobile.lineClamp).toBe("5");
    expect(mobile.height).toBeGreaterThan(mobile.lineHeight * 4);
    expect(mobile.height).toBeLessThan(mobile.lineHeight * 5 + 4);
  });

  test("keyboard, repeated toggles, hydration, and collapse stay with the control", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await openShell(page);
    const first = "بىرىنچى ئابزاس.\n\nئىككىنچى ئابزاس.";
    const long = `${first}\n${"بۇ قۇر سېتىۋېلىش رامكىسىدىن ئىلگىرى كۆرۈنىدۇ. ".repeat(18)}`.repeat(6);
    const replaced = `${long}\nيېڭىلانغان چۈشەندۈرۈش.`;
    await page.evaluate(() => {
      const section = document.querySelector(".dynamic-book-description");
      const panel = document.createElement("div");
      panel.className = "detail-purchase-panel";
      panel.innerHTML = '<div class="detail-price">70</div><button type="button" class="detail-main-cart">سېۋەت</button>';
      section.after(panel);
      const spacer = document.createElement("div");
      spacer.dataset.descriptionSpacer = "1";
      spacer.style.height = "1800px";
      panel.after(spacer);
    });
    const initial = await paint(page, long);
    expect(initial.clamped).toBe(true);
    const button = page.locator(".detail-description-toggle");
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(button).toHaveText("يىغىش");
    const expanded = await page.locator(".dynamic-book-description p").evaluate((node) => ({
      clamp: node.parentElement.classList.contains("is-clamped"),
      text: node.textContent,
      height: node.getBoundingClientRect().height,
      line: parseFloat(getComputedStyle(node).lineHeight)
    }));
    expect(expanded.clamp).toBe(false);
    expect(expanded.text).toContain("بىرىنچى ئابزاس.");
    expect(expanded.text).toContain("ئىككىنچى ئابزاس.");
    expect(expanded.height).toBeGreaterThan(expanded.line * 8);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.keyboard.press("Space");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toHaveText("تولۇق ئوقۇش");
    const near = await button.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    });
    expect(near).toBe(true);
    await button.click();
    await button.click();
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".detail-description-toggle")).toHaveCount(1);
    const next = await paint(page, replaced);
    expect(next.buttons).toBe(1);
    expect(next.expanded).toBe("false");
    expect(next.clamped).toBe(true);
    expect(next.text).toBe(replaced);
    await page.evaluate(() => document.fonts.ready);
    const afterFonts = await paint(page, replaced);
    expect(afterFonts.buttons).toBe(1);
    expect(afterFonts.clamped).toBe(true);
    await expect(page.locator(".detail-purchase-panel .detail-price")).toHaveText("70");
    await expect(page.locator(".detail-main-cart")).toHaveText("سېۋەت");
  });

  test("a borderline description appears only when the rendered lines overflow", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openShell(page);
    const fitted = await page.evaluate(() => {
      const section = document.querySelector(".dynamic-book-description");
      const paragraph = section.querySelector("p");
      section.hidden = false;
      let text = "بىر قۇر";
      paragraph.textContent = text;
      const line = parseFloat(getComputedStyle(paragraph).lineHeight);
      while (paragraph.scrollHeight <= line * 6 + 1 && text.length < 4000) {
        text += " سۆز";
        paragraph.textContent = text;
      }
      return text;
    });
    const desktop = await paint(page, fitted);
    expect(desktop.buttonHidden).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const mobile = await page.evaluate(() => {
      const button = document.querySelector(".detail-description-toggle");
      const paragraph = document.querySelector(".dynamic-book-description p");
      const style = getComputedStyle(paragraph);
      return {
        hidden: button ? button.hidden : true,
        clamp: style.webkitLineClamp,
        height: paragraph.getBoundingClientRect().height,
        line: parseFloat(style.lineHeight)
      };
    });
    expect(mobile.hidden).toBe(false);
    expect(mobile.clamp).toBe("5");
    expect(mobile.height).toBeLessThan(mobile.line * 5 + 4);
  });

  test("dark theme keeps description and control colors distinct", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openShell(page);
    await paint(page, `${"قېنىق تېما چۈشەندۈرۈشى. ".repeat(40)}\n\n${"يەنە بىر ئابزاس. ".repeat(20)}`);
    const colors = await page.evaluate(() => {
      document.body.classList.add("dark-mode");
      const section = document.querySelector(".dynamic-book-description");
      const paragraph = section.querySelector("p");
      const button = section.querySelector(".detail-description-toggle");
      const sectionStyle = getComputedStyle(section);
      const textStyle = getComputedStyle(paragraph);
      const buttonStyle = getComputedStyle(button);
      return {
        sectionBg: sectionStyle.backgroundColor,
        text: textStyle.color,
        buttonText: buttonStyle.color,
        buttonBg: buttonStyle.backgroundColor
      };
    });
    expect(colors.text).not.toBe(colors.sectionBg);
    expect(colors.buttonText).not.toBe(colors.buttonBg);
  });
});

test.describe("public description without javascript", () => {
  test.use({ javaScriptEnabled: false });

  test("the server description stays complete", async ({ page }) => {
    const text = "بىرىنچى ئابزاس.\n\nئىككىنچى ئابزاس. ".repeat(20);
    const html = shell.replace(
      /<section class="dynamic-book-description" hidden>\s*<h2>كىتاب ھەققىدە<\/h2>\s*<p><\/p>\s*<\/section>/,
      `<section class="dynamic-book-description"><h2>كىتاب ھەققىدە</h2><p>${text}</p></section>`
    );
    await page.route("**/book-shell.html**", (route) => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: html
    }));
    await page.goto("/book-shell.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".dynamic-book-description p")).toHaveText(text);
    await expect(page.locator(".detail-description-toggle")).toHaveCount(0);
    const readable = await page.locator(".dynamic-book-description p").evaluate((node) => {
      const style = getComputedStyle(node);
      return style.webkitLineClamp === "none" && node.scrollHeight <= node.clientHeight + 2;
    });
    expect(readable).toBe(true);
  });
});
