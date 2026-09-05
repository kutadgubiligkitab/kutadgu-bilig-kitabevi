const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const ROMAN_TITLE = "رومان بايلىقى";
const RELIGIOUS_TITLE = "دىنىي بايلىق";
const RECOMMENDED_TITLE = "تەۋسىيە بايلىقى";
const UNIVERSAL_TITLE = "ئۇنىۋېرسال بايلىق";

async function installDiscoveryStub(page, options = {}) {
  const romanEmpty = options.romanEmpty === true;
  const failRoman = options.failRoman === true;
  const holdRoman = options.holdRoman === true;
  await page.addInitScript(({ romanEmpty, failRoman, holdRoman, titles }) => {
    window.__discoveryTitles = titles;
    window.__discoveryHoldRoman = holdRoman
      ? new Promise((resolve) => { window.__releaseRoman = resolve; })
      : null;
    const origFetch = window.fetch.bind(window);
    const jsonResponse = (rows, status) => {
      const list = Array.isArray(rows) ? rows : [];
      const last = Math.max(0, list.length - 1);
      return new Response(JSON.stringify(list), {
        status: status || 200,
        headers: {
          "content-type": "application/json",
          "content-range": list.length ? `0-${last}/${list.length}` : "*/0"
        }
      });
    };
    const universal = Array.from({ length: 20 }, (_, i) => stubLocal({
      id: 70001 + i,
      title: `${titles.universal} ${i + 1}`,
      category: "ئۇنىۋېرسال",
      is_recommended: i < 3
    }));
    const roman = romanEmpty ? [] : [
      stubLocal({ id: 81001, title: titles.roman, category: "رومانلار" }),
      stubLocal({ id: 81002, title: `${titles.roman} 2`, category: "رومانلار" })
    ];
    const religious = [
      stubLocal({ id: 82001, title: titles.religious, category: "دىنىي كىتابلار" })
    ];
    const poems = [
      stubLocal({ id: 81001, title: titles.roman, category: "شېئىرلار" }),
      stubLocal({ id: 83001, title: "شېئىر بايلىقى", category: "شېئىرلار" })
    ];
    function stubLocal(extra) {
      return {
        id: extra.id,
        title: extra.title,
        author: "رەسمىي ئاپتور",
        price: extra.price == null ? 180 : extra.price,
        category: extra.category,
        subcategory: extra.subcategory || "",
        image_url: "/kutadgu-logo.png",
        is_active: true,
        is_recommended: extra.is_recommended === true,
        is_new: !!extra.is_new,
        sales_count: Number(extra.sales_count) || 0,
        created_at: "2026-08-01T00:00:00Z"
      };
    }
    window.fetch = async (input, init) => {
      const url = String(typeof input === "string" ? input : input && input.url || "");
      const method = String((init && init.method) || (typeof input === "object" && input && input.method) || "GET").toUpperCase();
      if (!url.includes("/rest/v1/books")) return origFetch(input, init);
      if (method === "HEAD") {
        return new Response(null, { status: 200, headers: { "content-range": "0-0/40" } });
      }
      if (url.includes("is_active=eq.false")) return jsonResponse([]);
      let category = "";
      try {
        const parsed = new URL(url, "https://example.invalid");
        category = String(parsed.searchParams.get("category") || "").replace(/^eq\./, "");
      } catch (err) {}
      if (category === "رومانلار") {
        if (failRoman) return jsonResponse({ message: "boom" }, 500);
        if (window.__discoveryHoldRoman) await window.__discoveryHoldRoman;
        return jsonResponse(roman);
      }
      if (category === "دىنىي كىتابلار") return jsonResponse(religious);
      if (category === "شېئىرلار") return jsonResponse(poems);
      if (category) return jsonResponse([]);
      if (url.includes("is_recommended=eq.true")) {
        return jsonResponse(universal.filter((row) => row.is_recommended).map((row) => ({
          ...row,
          title: titles.recommended
        })));
      }
      return jsonResponse(universal);
    };
  }, {
    romanEmpty,
    failRoman,
    holdRoman,
    titles: {
      roman: ROMAN_TITLE,
      religious: RELIGIOUS_TITLE,
      recommended: RECOMMENDED_TITLE,
      universal: UNIVERSAL_TITLE
    }
  });
}

async function openDiscovery(page, stubOptions) {
  await H.installReadSafeNetwork(page);
  await installDiscoveryStub(page, stubOptions);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#premiumDiscovery", { timeout: 45_000 });
}

test.describe("homepage authoritative discovery", () => {
  test("1 partial homepage cache still shows authoritative Roman books", async ({ page }) => {
    await openDiscovery(page);
    await expect.poll(async () => page.evaluate(() => {
      const rows = (window.kutadguShop && window.kutadguShop.getCatalog && window.kutadguShop.getCatalog()) || [];
      return rows.some((book) => book.category === "رومانلار");
    })).toBe(false);
    await page.locator('#premiumDiscovery [data-premium-group="literature"]').click();
    await page.locator('#premiumDiscovery [data-premium-subcategory="رومانلار"]').click();
    await expect(page.locator("#premiumDiscoveryResults")).toContainText(ROMAN_TITLE);
    await expect(page.locator("#premiumDiscoveryResults")).not.toContainText(RECOMMENDED_TITLE);
    await expect(page.locator("#premiumDiscoveryResults")).not.toContainText(UNIVERSAL_TITLE);
    await expect(page.locator("#premiumDiscoveryResults [data-premium-book-id]")).toHaveCount(2);
  });

  test("2 empty authoritative Roman query stays empty without Recommended fallback", async ({ page }) => {
    await openDiscovery(page, { romanEmpty: true });
    await page.locator('#premiumDiscovery [data-premium-group="literature"]').click();
    await page.locator('#premiumDiscovery [data-premium-subcategory="رومانلار"]').click();
    await expect(page.locator("#premiumDiscoveryResults .premium-friendly-empty")).toContainText("بۇ تۈردە ھازىرچە كىتاب يوق");
    await expect(page.locator("#premiumDiscoveryResults")).not.toContainText(RECOMMENDED_TITLE);
    await expect(page.locator("#premiumDiscoveryResults")).not.toContainText(UNIVERSAL_TITLE);
    await expect(page.locator("#premiumDiscoveryResults [data-premium-book-id]")).toHaveCount(0);
  });

  test("3 literature group combines configured categories, dedupes, and caps at 8", async ({ page }) => {
    await openDiscovery(page);
    await page.locator('#premiumDiscovery [data-premium-group="literature"]').click();
    await expect(page.locator("#premiumDiscoveryResults [data-premium-book-id]")).toHaveCount(3);
    const ids = await page.locator("#premiumDiscoveryResults [data-premium-book-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-premium-book-id")));
    expect(ids).toEqual(["81001", "81002", "83001"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("4 selecting one subcategory renders only that category", async ({ page }) => {
    await openDiscovery(page);
    await page.locator('#premiumDiscovery [data-premium-group="literature"]').click();
    await page.locator('#premiumDiscovery [data-premium-subcategory="شېئىرلار"]').click();
    await expect(page.locator("#premiumDiscoveryResults")).toContainText("شېئىر بايلىقى");
    await expect(page.locator("#premiumDiscoveryResults")).not.toContainText(`${ROMAN_TITLE} 2`);
    const ids = await page.locator("#premiumDiscoveryResults [data-premium-book-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-premium-book-id")));
    expect(ids).toEqual(["81001", "83001"]);
  });

  test("5 late Roman response does not overwrite Religious selection", async ({ page }) => {
    await openDiscovery(page, { holdRoman: true });
    await page.locator('#premiumDiscovery [data-premium-group="literature"]').click();
    await page.locator('#premiumDiscovery [data-premium-group="religion"]').click();
    await expect(page.locator("#premiumDiscoveryResults")).toContainText(RELIGIOUS_TITLE);
    await page.evaluate(() => { if (window.__releaseRoman) window.__releaseRoman(); });
    await page.waitForTimeout(80);
    await expect(page.locator("#premiumDiscoveryResults")).toContainText(RELIGIOUS_TITLE);
    await expect(page.locator("#premiumDiscoveryResults")).not.toContainText(ROMAN_TITLE);
  });

  test("6 remote discovery error shows unavailable state without Recommended books", async ({ page }) => {
    await openDiscovery(page, { failRoman: true });
    await page.locator('#premiumDiscovery [data-premium-group="literature"]').click();
    await page.locator('#premiumDiscovery [data-premium-subcategory="رومانلار"]').click();
    await expect(page.locator("#premiumDiscoveryResults .premium-discovery-error")).toContainText("ۋاقىتلىق خاتالىق");
    await expect(page.locator("#premiumDiscoveryResults")).not.toContainText(RECOMMENDED_TITLE);
    await expect(page.locator("#premiumDiscoveryResults [data-premium-book-id]")).toHaveCount(0);
  });

  test("7 wizard true empty shows restart and no Recommended books", async ({ page }) => {
    await openDiscovery(page);
    await page.locator("#premiumWizardOpen").click();
    await page.locator('#premiumWizard [data-wizard-group="literature"]').click();
    await page.locator('#premiumWizard [data-wizard-style="children"]').click();
    await page.locator('#premiumWizard [data-wizard-price="all"]').click();
    await expect(page.locator("#premiumWizardResults .premium-friendly-empty")).toContainText("بۇ تۈردە ھازىرچە كىتاب يوق");
    await expect(page.locator("#premiumWizardResults")).not.toContainText(RECOMMENDED_TITLE);
    await expect(page.locator("#premiumWizardResults .premium-wizard-restart")).toBeVisible();
    await page.locator("#premiumWizardResults .premium-wizard-restart").click();
    await expect(page.locator('#premiumWizard [data-wizard-step="1"]')).toBeVisible();
  });
});
