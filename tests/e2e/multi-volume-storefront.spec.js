const fs = require("fs");
const path = require("path");
const { test, expect } = require("./playwright-test");
const H = require("./helpers");

const shell = fs.readFileSync(path.join(__dirname, "..", "..", "book-shell.html"), "utf8");
const appConfig = fs.readFileSync(path.join(__dirname, "..", "..", "app-config.js"), "utf8")
  .replace("multiVolumeBooks:false", "multiVolumeBooks:true");

async function openVolumeEditor(page, existing) {
  await H.installReadSafeNetwork(page);
  await page.addInitScript(() => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguSkipSuggestFetch = true;
    window.__kutadguSuggestionRows = [{id:156,author:"ئابدۇرېھىم ئۆتكۈر"}];
    window.__kutadguAdminPreviewBooks = [];
  });
  await page.goto("/admin.html", {waitUntil:"domcontentloaded"});
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  await page.evaluate((saved) => {
    window.__volumeEditorCalls = [];
    const rows = [156,157].map((id,index)=>({book_id:id,title:`ئويغانغان زېمىن ${index+1}. قىسىم`,author:"ئابدۇرېھىم ئۆتكۈر",price:index?399:370,stock:20,is_active:true}));
    window.KutadguAdminVolumeGroups.init({db:{rpc:async(name,args)=>{
      window.__volumeEditorCalls.push({name,args});
      if(name==="admin_preview_book_volume_members")return {data:rows.filter(b=>String(b.book_id)===String(args.p_book_id))};
      if(name==="admin_get_book_volume_group")return {data:saved};
      if(name==="admin_save_book_volume_group")return {data:{...args.p_group,id:args.p_group_id||77,revision:5,members:rows.map((b,i)=>({...b,position:i+1,volume_label:`${i+1}-قىسىم`}))}};
      return {data:[]};
    }}});
  }, existing||null);
  await page.locator('button[data-admin-section="volume-groups"]').click();
  await page.locator("#newVolumeGroupBtn").click();
}

async function addEditorVolume(page,id) {
  await page.locator("#volumeGroupBookLookup").fill(String(id));
  await page.locator("#volumeGroupLookupBtn").click();
  await page.locator(`[data-lookup-add="${id}"]`).click();
}

test.describe("plain-language multi-volume admin editor",()=>{
  test("author and category use existing suggestions; refreshed author data appears",async({page})=>{
    await openVolumeEditor(page);
    await expect(page.locator("#volumeGroupSlug")).toBeHidden();
    await expect(page.locator("#volumeGroupSource")).toBeHidden();
    const author=page.locator("#volumeGroupAuthor");
    await author.fill("ئابدۇر");
    const options=page.locator("#volumeGroupAuthor").locator("..").getByRole("option");
    await expect(options).toHaveText(["ئابدۇرېھىم ئۆتكۈر"]);
    await author.press("Enter");
    await expect(author).toHaveValue("ئابدۇرېھىم ئۆتكۈر");
    await page.evaluate(()=>window.__kutadguSuggestionRows.push({id:9,author:"يېڭى ئاپتور"}));
    await author.fill("يېڭى");
    await expect(options).toHaveText(["يېڭى ئاپتور"]);
    await options.click();
    const category=page.locator("#volumeGroupCategory");
    await category.fill("تارىخىي");
    await category.locator("..").getByRole("option",{name:"تارىخىي رومانلار",exact:true}).click();
    await expect(category).toHaveValue("تارىخىي رومانلار");
    await expect(page.locator("#volumeGroupSource")).toHaveValue("tarikhiy-romanlar.html");
    await expect(page.locator("#volumeGroupsCard")).not.toContainText("slug");
  });

  test("new series saves summed-price intent and an automatic link without publishing",async({page})=>{
    await openVolumeEditor(page);
    await page.locator("#volumeGroupTitle").fill("ئويغانغان زېمىن");
    await page.locator("#volumeGroupCategory").fill("تارىخىي رومانلار");
    await addEditorVolume(page,156);
    await expect(page.locator("#volumeGroupAuthor")).toHaveValue("ئابدۇرېھىم ئۆتكۈر");
    await addEditorVolume(page,157);
    await page.locator('#volumeGroupForm button[type="submit"]').click();
    await expect(page.locator("#volumeGroupStatus")).toContainText("ساقلاندى");
    const calls=await page.evaluate(()=>window.__volumeEditorCalls);
    const saves=calls.filter(c=>c.name==="admin_save_book_volume_group");
    expect(saves).toHaveLength(1);
    expect(saves[0].args).toMatchObject({p_group_id:null,p_expected_revision:null,p_group:{slug:"series-156",category:"تارىخىي رومانلار",source:"tarikhiy-romanlar.html",complete_set_price:null},p_members:[{book_id:"156",position:1},{book_id:"157",position:2}]});
    expect(calls.some(c=>c.name==="admin_set_book_volume_group_publication")).toBe(false);
  });

  test("editing keeps the saved link, legacy routing, explicit price and revision",async({page})=>{
    await openVolumeEditor(page,{id:88,revision:4,slug:"existing-series",title:"بۇرۇنقى نام",category:"بۇرۇنقى تۈر",source:"existing-category.html",complete_set_price:700,is_active:true,members:[{book_id:156,position:1},{book_id:157,position:2}]});
    await page.evaluate(()=>window.KutadguAdminVolumeGroups.openGroup("88"));
    await page.locator("#volumeGroupTitle").fill("يېڭى نام");
    await page.locator('#volumeGroupForm button[type="submit"]').click();
    await expect(page.locator("#volumeGroupStatus")).toContainText("ساقلاندى");
    const args=await page.evaluate(()=>window.__volumeEditorCalls.find(c=>c.name==="admin_save_book_volume_group").args);
    expect(args).toMatchObject({p_group_id:"88",p_expected_revision:4,p_group:{slug:"existing-series",category:"بۇرۇنقى تۈر",source:"existing-category.html",complete_set_price:700}});
  });

  test("unknown edited category blocks a save and mobile controls fit",async({page})=>{
    await openVolumeEditor(page);
    await page.setViewportSize({width:390,height:844});
    await page.locator("#volumeGroupTitle").fill("ئويغانغان زېمىن");
    await addEditorVolume(page,156);
    await addEditorVolume(page,157);
    await page.locator("#volumeGroupCategory").fill("تىزىمدە يوق");
    await page.locator('#volumeGroupForm button[type="submit"]').click();
    expect(await page.evaluate(()=>document.querySelector("#volumeGroupCategory").validity.valid)).toBe(false);
    expect(await page.evaluate(()=>window.__volumeEditorCalls.filter(c=>c.name==="admin_save_book_volume_group").length)).toBe(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBe(true);
  });
});

const members = [
  {
    book_id: "1001", position: 1, volume_label: "1-جىلد", title: "بىرىنچى جىلد",
    author: "سىناق ئاپتور", price: 35, image_url: "/volume-cover-1.svg",
    stock: 4, stock_status: "in_stock", is_active: true
  },
  {
    book_id: "1002", position: 2, volume_label: "2-جىلد", title: "ئىككىنچى جىلد",
    author: "سىناق ئاپتور", price: 55, image_url: "/volume-cover-2.svg",
    stock: 2, stock_status: "in_stock", is_active: true
  },
  {
    book_id: "1003", position: 3, volume_label: "3-جىلد", title: "ئۈچىنچى جىلد",
    author: "سىناق ئاپتور", price: 65, image_url: "/volume-cover-3.svg",
    stock: 0, stock_status: "out_of_stock", is_active: true
  }
];

const group = {
  id: "77",
  slug: "sample-series",
  title: "سىناق توپلام",
  author: "سىناق ئاپتور",
  category: "رومانلار",
  source: "romanlar.html",
  description: "ئۈچ جىلدلىق سىناق توپلام",
  complete_set_price: 125,
  effective_set_price: 125,
  representative_book_id: "1001",
  revision: 4,
  quote_revision: "quote-r4",
  members
};

function book(member) {
  return {
    id: Number(member.book_id),
    title: member.title,
    author: member.author,
    category: "رومانلار",
    source: "romanlar.html",
    description: member.title,
    price: member.price,
    image_url: member.image_url,
    stock: member.stock,
    stock_status: member.stock_status,
    is_active: true,
    submission_status: "approved",
    created_at: "2026-10-20T00:00:00Z"
  };
}

async function installFixture(page) {
  await H.installReadSafeNetwork(page);
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.removeItem("kutadgu-catalog-active-count-v1");
    } catch (error) {}
  });
  await page.route("**/volume-group/sample-series**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: shell
  }));
  await page.route("**/book/1002**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: shell
  }));
  await page.route("**/app-config.js*", (route) => route.fulfill({
    status: 200,
    contentType: "text/javascript; charset=utf-8",
    body: appConfig
  }));
  await page.route("**/volume-cover-*.svg", (route) => route.fulfill({
    status: 200,
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="#70503d"/></svg>'
  }));
  await page.route("**/auth/v1/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ user: null })
  }));
  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.includes("/rest/v1/books")) {
      if (request.method() === "HEAD") {
        return route.fulfill({
          status: 200,
          headers: { "content-range": "0-0/3" },
          body: ""
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-2/3" },
        body: JSON.stringify(members.map(book))
      });
    }
    if (url.includes("/rpc/get_public_book_volume_group_storefront")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(group) });
    }
    if (url.includes("/rpc/resolve_public_book_volume_context")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          book: book(members[1]),
          group,
          selected_book_id: "1002",
          canonical_path: "/book/1002"
        })
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

test.describe("multi-volume storefront", () => {
  test.beforeEach(async ({ page }) => {
    await installFixture(page);
  });

  test("group page selects available volumes and blocks an incomplete set", async ({ page }) => {
    await page.goto("/volume-group/sample-series", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".volume-group-purchase-panel")).toBeVisible();
    await expect(page.locator("[data-volume-book-id]")).toHaveCount(3);
    await expect(page.locator(".volume-set-price")).toContainText("125");
    await expect(page.locator(".volume-add-set")).toBeDisabled();
    await expect(page.locator(".cart-stock-block-note")).toBeVisible();
    await expect(page.locator("[data-volume-book-id='1003']")).toBeDisabled();

    await page.locator("[data-volume-book-id='1002']").check();
    await expect(page.locator("[data-volume-selection-summary]")).toContainText("55");
    await expect(page.locator(".book-cover-box img")).toHaveAttribute("src", /volume-cover-2\.svg/);
    await page.locator(".volume-add-selected").click();
    await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("kutadgu-cart-v1") || "[]")))
      .toEqual([{ id: "1001", qty: 1 }, { id: "1002", qty: 1 }]);
  });

  test("direct child link keeps that volume selected in group context", async ({ page }) => {
    await page.goto("/book/1002", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".volume-group-purchase-panel")).toBeVisible();
    await expect(page.locator("[data-volume-book-id='1002']")).toBeChecked();
    await expect(page.locator("[data-volume-selection-summary]")).toContainText("ئىككىنچى جىلد");
    await expect(page.locator(".volume-group-stable-link")).toHaveAttribute("href", "/volume-group/sample-series");
  });
});
