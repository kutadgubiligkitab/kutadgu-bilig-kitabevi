const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const PARENTING_TITLE = "ئائىلە ۋە پەرزەنتلىرىمىز";
const CHILDREN_TITLE = "بالىلار بايلىقى";
const TEXTBOOK_TITLE = "دەرسلىك بايلىقى";

async function installSplitStub(page) {
  await page.addInitScript(({ titles }) => {
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
    function stubLocal(extra) {
      return {
        id: extra.id,
        title: extra.title,
        author: "رەسمىي ئاپتور",
        price: 180,
        category: extra.category,
        subcategory: "",
        image_url: "/kutadgu-logo.png",
        is_active: true,
        is_recommended: false,
        is_new: false,
        sales_count: 0,
        created_at: "2026-08-01T00:00:00Z"
      };
    }
    const children = [stubLocal({ id: 91001, title: titles.children, category: "بالىلار كىتابلىرى" })];
    const parenting = [stubLocal({ id: 92001, title: titles.parenting, category: "پەرزەنت تەربىيەسى" })];
    const textbooks = [stubLocal({ id: 93001, title: titles.textbook, category: "دەرسلىك" })];
    window.fetch = async (input, init) => {
      const url = String(typeof input === "string" ? input : input && input.url || "");
      const method = String((init && init.method) || (typeof input === "object" && input && input.method) || "GET").toUpperCase();
      if (!url.includes("/rest/v1/books")) return origFetch(input, init);
      if (method === "HEAD") {
        return new Response(null, { status: 200, headers: { "content-range": "0-0/3" } });
      }
      if (url.includes("is_active=eq.false")) return jsonResponse([]);
      let category = "";
      try {
        const parsed = new URL(url, "https://example.invalid");
        category = String(parsed.searchParams.get("category") || "").replace(/^eq\./, "");
      } catch (err) {}
      if (category === "بالىلار كىتابلىرى") return jsonResponse(children);
      if (category === "پەرزەنت تەربىيەسى") return jsonResponse(parenting);
      if (category === "دەرسلىك") return jsonResponse(textbooks);
      if (category) return jsonResponse([]);
      return jsonResponse([]);
    };
  }, {
    titles: {
      children: CHILDREN_TITLE,
      parenting: PARENTING_TITLE,
      textbook: TEXTBOOK_TITLE
    }
  });
}

async function openDiscovery(page) {
  await H.installReadSafeNetwork(page);
  await installSplitStub(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#premiumDiscovery", { timeout: 45_000 });
}

test.describe("discovery children/parenting/textbooks split", () => {
  test("top-level groups are split and do not leak across categories", async ({ page }) => {
    await openDiscovery(page);
    const labels = await page.locator("#premiumDiscovery [data-premium-group]").evaluateAll((nodes) =>
      nodes.map((node) => ({ id: node.getAttribute("data-premium-group"), text: node.textContent.replace(/\s+/g, " ").trim() }))
    );
    expect(labels.map((row) => row.id)).toEqual(["literature", "history", "religion", "children", "parenting", "textbooks"]);
    expect(labels.find((row) => row.id === "children").text).toContain("بالىلار");
    expect(labels.find((row) => row.id === "parenting").text).toContain("پەرزەنت تەربىيەسى");
    expect(labels.find((row) => row.id === "textbooks").text).toContain("دەرسلىك");

    await page.locator('#premiumDiscovery [data-premium-group="children"]').click();
    await expect(page.locator("#premiumDiscoveryResults")).toContainText(CHILDREN_TITLE);
    await expect(page.locator("#premiumDiscoveryResults")).not.toContainText(PARENTING_TITLE);
    await expect(page.locator("#premiumDiscoveryResults")).not.toContainText(TEXTBOOK_TITLE);
    await expect(page.locator("#premiumSubcategories button")).toHaveCount(1);
    await expect(page.locator("#premiumSubcategories button")).toHaveText("بالىلار كىتابلىرى");

    await page.locator('#premiumDiscovery [data-premium-group="parenting"]').click();
    await expect(page.locator("#premiumDiscoveryResults")).toContainText(PARENTING_TITLE);
    await expect(page.locator("#premiumDiscoveryResults")).not.toContainText(CHILDREN_TITLE);
    await expect(page.locator("#premiumDiscoveryResults")).not.toContainText(TEXTBOOK_TITLE);

    await page.locator('#premiumDiscovery [data-premium-group="textbooks"]').click();
    await expect(page.locator("#premiumDiscoveryResults")).toContainText(TEXTBOOK_TITLE);
    await expect(page.locator("#premiumDiscoveryResults")).not.toContainText(CHILDREN_TITLE);
    await expect(page.locator("#premiumDiscoveryResults")).not.toContainText(PARENTING_TITLE);
  });

  test("wizard step 1 uses the separated groups", async ({ page }) => {
    await openDiscovery(page);
    await page.locator("#premiumWizardOpen").click();
    await expect(page.locator('#premiumWizard [data-wizard-group="parenting"]')).toBeVisible();
    await expect(page.locator('#premiumWizard [data-wizard-group="textbooks"]')).toBeVisible();
    await page.locator('#premiumWizard [data-wizard-group="parenting"]').click();
    await page.locator('#premiumWizard [data-wizard-style="all"]').click();
    await page.locator('#premiumWizard [data-wizard-price="all"]').click();
    await expect(page.locator("#premiumWizardResults")).toContainText(PARENTING_TITLE);
    await expect(page.locator("#premiumWizardResults")).not.toContainText(CHILDREN_TITLE);
    await expect(page.locator("#premiumWizardResults")).not.toContainText(TEXTBOOK_TITLE);
  });

  for (const width of [1366, 768, 390]) {
    test(`no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await openDiscovery(page);
      await expect(page.locator("#premiumDiscovery [data-premium-group]")).toHaveCount(6);
      const geo = await page.evaluate(() => {
        const section = document.querySelector("#premiumDiscovery");
        const groups = document.querySelector(".premium-discovery-groups");
        const buttons = [...document.querySelectorAll("#premiumDiscovery [data-premium-group]")];
        return {
          pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
          sectionOverflow: section ? section.scrollWidth - section.clientWidth : 0,
          groupsOverflow: groups ? groups.scrollWidth - groups.clientWidth : 0,
          clipped: buttons.map((button) => ({
            id: button.getAttribute("data-premium-group"),
            text: button.textContent.trim(),
            overflow: button.scrollWidth - button.clientWidth,
            height: button.getBoundingClientRect().height
          }))
        };
      });
      expect(geo.pageOverflow, JSON.stringify(geo)).toBeLessThanOrEqual(1);
      expect(geo.sectionOverflow, JSON.stringify(geo)).toBeLessThanOrEqual(1);
      expect(geo.groupsOverflow, JSON.stringify(geo)).toBeLessThanOrEqual(1);
      for (const button of geo.clipped) {
        expect(button.overflow, button.id).toBeLessThanOrEqual(1);
        expect(button.height).toBeGreaterThan(20);
      }
    });
  }
});
