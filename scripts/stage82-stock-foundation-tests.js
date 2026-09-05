#!/usr/bin/env node
"use strict";
const assert=require("assert");
const fs=require("fs");
const path=require("path");
const Stock=require("../kutadgu-stock.js");
const Prod=require("../admin-catalog-productivity.js");

const root=path.join(__dirname,"..");
let failed=0;
function test(name,fn){
  try{fn();console.log("PASS",name)}
  catch(err){failed++;console.error("FAIL",name,err&&err.message)}
}
function read(rel){return fs.readFileSync(path.join(root,rel),"utf8")}

const sql=read("STAGE82_STOCK_FOUNDATION.sql");
const setup=read("SUPABASE_SETUP.sql");
const adminJs=read("admin.js");
const adminHtml=read("admin.html");
const shop=read("shop.js");
const cfg=read("supabase-config.js");
const prodJs=read("admin-catalog-productivity.js");
const helper=read("kutadgu-stock.js");
const stage80=read("STAGE80_MEMBER_ORDER_INTEGRITY.sql");
const stage2c=read("STAGE2C_AAL2_BOOKS_WRITE_RLS.sql");

test("stock NULL remains NULL and is not coerced to 0",()=>{
  assert.deepStrictEqual(Stock.parseAdminStock(null),{ok:true,value:null,configured:false});
  assert.deepStrictEqual(Stock.parseAdminStock(""),{ok:true,value:null,configured:false});
  assert.deepStrictEqual(Stock.parseAdminStock("   "),{ok:true,value:null,configured:false});
  assert.deepStrictEqual(Stock.parseAdminStock(undefined),{ok:true,value:null,configured:false});
  assert.strictEqual(Stock.formatStockInputValue(null),"");
  assert.strictEqual(Stock.formatStockInputValue(""),"");
  assert.strictEqual(Stock.isUnconfiguredStock(null),true);
  assert.strictEqual(Stock.isUnconfiguredStock(0),false);
});

test("stock 0 derives out_of_stock",()=>{
  const derived=Stock.deriveStockStatus(0);
  assert.strictEqual(derived.ok,true);
  assert.strictEqual(derived.key,"out_of_stock");
  assert.strictEqual(derived.label,"تۈگەپ كەتتى");
  assert.strictEqual(derived.qty,0);
  assert.strictEqual(Stock.storefrontStockInfo({stock:0}).canBuy,false);
  assert.strictEqual(Stock.storefrontStockInfo({stock:0}).key,"out");
});

test("stock 1,2,3 derive low_stock",()=>{
  assert.strictEqual(Stock.LOW_STOCK_THRESHOLD,3);
  [1,2,3].forEach(qty=>{
    const derived=Stock.deriveStockStatus(qty);
    assert.strictEqual(derived.key,"low_stock",String(qty));
    assert.strictEqual(derived.label,"ئاز قالدى");
    assert.strictEqual(Stock.storefrontStockInfo({stock:qty}).canBuy,true);
    assert.strictEqual(Stock.storefrontStockInfo({stock:qty}).key,"low");
  });
});

test("stock 4+ derives in_stock",()=>{
  [4,5,12,100].forEach(qty=>{
    const derived=Stock.deriveStockStatus(qty);
    assert.strictEqual(derived.key,"in_stock",String(qty));
    assert.strictEqual(derived.label,"ئامباردا بار");
    assert.strictEqual(Stock.storefrontStockInfo({stock:qty}).canBuy,true);
    assert.strictEqual(Stock.storefrontStockInfo({stock:qty}).key,"in");
  });
});

test("negative stock is rejected",()=>{
  assert.strictEqual(Stock.parseAdminStock("-1").ok,false);
  assert.strictEqual(Stock.parseAdminStock(-3).ok,false);
  assert.strictEqual(Stock.deriveStockStatus("-8").ok,false);
});

test("decimal stock is rejected without rounding",()=>{
  assert.strictEqual(Stock.parseAdminStock("1.5").ok,false);
  assert.strictEqual(Stock.parseAdminStock("1.0").ok,false);
  assert.strictEqual(Stock.parseAdminStock("4.00").ok,false);
  assert.strictEqual(Stock.parseAdminStock("1e2").ok,false);
  assert.strictEqual(Stock.parseAdminStock("01").ok,false);
});

test("blank Admin stock saves NULL in staging phase",()=>{
  const built=Prod.buildQuickEditPatch({title:"A",source:"universal.html",stock:""},{presentBookCols:new Set(["stock"])});
  assert.strictEqual(built.ok,true);
  assert.strictEqual(built.patch.stock,null);
});

test("exact integer saves exact quantity",()=>{
  const built=Prod.buildQuickEditPatch({title:"A",source:"universal.html",stock:"26"},{presentBookCols:new Set(["stock"])});
  assert.strictEqual(built.ok,true);
  assert.strictEqual(built.patch.stock,26);
});

test("Admin omits stock when schema column is absent",()=>{
  const built=Prod.buildQuickEditPatch({title:"A",source:"universal.html",stock:"9"},{presentBookCols:new Set()});
  assert.strictEqual(built.ok,true);
  assert.strictEqual("stock" in built.patch,false);
  assert.match(adminJs,/LIVE_OPTIONAL_BOOK_COLS=\{[^}]*stock:false/);
  assert.match(cfg,/stock: false/);
  assert.match(adminJs,/async function detectOptionalStockColumn\(/);
  assert.match(adminJs,/disableStockColumn\(/);
  assert.match(adminJs,/enableStockColumn\(/);
});

test("Admin exposes stock controls only through presentBookCols / live detect",()=>{
  assert.match(adminHtml,/id="bookStock"/);
  assert.match(adminHtml,/id="bookStock"[^>]*type="text"/);
  assert.match(adminHtml,/id="quickStock"[^>]*type="text"/);
  assert.doesNotMatch(adminHtml,/id="bookStock"[^>]*pattern=/);
  assert.match(adminHtml,/id="bookStockDerivedStatus"/);
  assert.match(adminHtml,/id="adminUnconfiguredStock"/);
  assert.match(adminHtml,/kutadgu-stock\.js\?v=1/);
  assert.match(adminJs,/if\(presentBookCols\.has\("stock"\)\)row\.stock=stockValue/);
  assert.match(adminJs,/setStockInputValue\(\$\("#bookStock"\),b\.stock\)/);
  assert.doesNotMatch(adminJs,/\$\("#bookStock"\)\.value=b\.stock\?\?0/);
  assert.doesNotMatch(adminJs,/stock:Number\(\$\("#bookStock"\)\.value\)\|\|0/);
});

test("existing book CRUD is not rewritten to require stock",()=>{
  assert.match(adminJs,/function saveBook\(/);
  assert.match(adminJs,/function persistBookRow\(/);
  assert.match(adminJs,/function writeBookRow\(/);
  assert.match(adminJs,/OPTIONAL_BOOK_COLS\.includes\(key\)&&!presentBookCols\.has\(key\)/);
});

test("current order flow files are unchanged by this migration",()=>{
  const executable=sql.split("\n").filter(line=>!/^\s*--/.test(line)).join("\n");
  assert.match(executable,/BEGIN;/);
  assert.match(executable,/COMMIT;/);
  assert.doesNotMatch(executable,/create_member_order/i);
  assert.doesNotMatch(executable,/CREATE\s+OR\s+REPLACE\s+FUNCTION/i);
  assert.doesNotMatch(executable,/CREATE\s+TRIGGER/i);
  assert.doesNotMatch(executable,/POLICY/i);
  assert.doesNotMatch(executable,/\bGRANT\b/i);
  assert.doesNotMatch(executable,/\bREVOKE\b/i);
  assert.match(stage80,/create or replace function public\.create_member_order/i);
  assert.match(stage2c,/is_kutadgu_admin/);
});

test("static/demo production safety still fails closed in shop.js",()=>{
  assert.match(shop,/function requiresRemoteProductAuthority\(\)\{/);
  assert.match(shop,/KUTADGU_REQUIRE_REMOTE_PRODUCT_AUTHORITY/);
});

test("unconfigured storefront stock stays sellable; configured 0 is out",()=>{
  const unknown=Stock.storefrontStockInfo({stock:null,stockStatus:""});
  assert.strictEqual(unknown.key,"unknown");
  assert.strictEqual(unknown.canBuy,true);
  assert.strictEqual(unknown.qty,null);
  assert.match(shop,/qty<=3/);
  assert.doesNotMatch(shop,/qty<=5/);
  assert.match(shop,/key:"unknown",label:"",canBuy:true,qty:null/);
});

test("migration adds nullable integer stock with no backfill",()=>{
  const apply=sql.split("READ-ONLY POST-CHECK")[0];
  assert.match(apply,/ADD COLUMN IF NOT EXISTS stock integer/);
  assert.match(apply,/ALTER COLUMN stock DROP NOT NULL/);
  assert.match(apply,/ALTER COLUMN stock DROP DEFAULT/);
  assert.match(apply,/stock IS NULL OR stock >= 0/);
  assert.match(apply,/books_stock_nonnegative_chk/);
  assert.match(apply,/NULL = not configured yet/i);
  assert.match(apply,/0 = out of stock/i);
  assert.match(apply,/4\+ = in stock/);
  assert.doesNotMatch(apply,/\bUPDATE\s+public\.books\b/i);
  assert.doesNotMatch(apply,/ADD COLUMN IF NOT EXISTS stock_status/i);
  assert.doesNotMatch(apply,/SET\s+stock\s*=/i);
  assert.doesNotMatch(apply,/DEFAULT\s+0/);
  assert.doesNotMatch(apply,/SET\s+NOT\s+NULL/i);
  assert.doesNotMatch(apply,/stock integer NOT NULL/i);
  assert.match(setup,/add column if not exists stock integer/i);
  assert.match(setup,/books_stock_nonnegative_chk/);
});

test("post-check SQL is documented and read-only",()=>{
  const checks=sql.split("READ-ONLY POST-CHECK")[1]||"";
  assert.match(checks,/information_schema\.columns/);
  assert.match(checks,/data_type/);
  assert.match(checks,/is_nullable/);
  assert.match(checks,/stock IS NULL/);
  assert.match(checks,/books_stock_nonnegative_chk/);
  assert.match(checks,/pg_policies/);
  assert.match(checks,/create_member_order/);
  assert.doesNotMatch(checks,/^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|GRANT|REVOKE)\b/im);
});

test("derived status is the source of truth; stock_status is not persisted",()=>{
  assert.match(helper,/LOW_STOCK_THRESHOLD=3/);
  assert.match(prodJs,/parseAdminStock/);
  assert.doesNotMatch(prodJs,/patch\.stock_status=String\(input&&input\.stock_status\|\|"in_stock"\)/);
  assert.match(adminJs,/document\.querySelectorAll\("\[data-book-col='stock_status'\]"\)/);
  assert.match(adminHtml,/id="bookStockStatus"[^>]*disabled/);
  assert.match(adminHtml,/ئامبار سانى تەڭشەلمىگەن/);
});

test("unconfigured active-book counter treats 0 as configured",()=>{
  const books=[
    {id:1,is_active:true,stock:null},
    {id:2,is_active:true,stock:0},
    {id:3,is_active:false,stock:null},
    {id:4,is_active:true,stock:4}
  ];
  assert.strictEqual(Stock.countUnconfiguredActiveBooks(books),1);
  assert.strictEqual(Stock.unconfiguredStockLabel(26),"ئامبار سانى تەڭشەلمىگەن: 26");
});

if(failed)process.exit(1);
console.log("stage82-stock-foundation-tests ok");
