#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Stock = require("../kutadgu-stock.js");
const Prod = require("../admin-catalog-productivity.js");

const root = path.join(__dirname, "..");
function read(rel){ return fs.readFileSync(path.join(root, rel), "utf8"); }

let failed = 0;
function test(name, fn) {
  try { fn(); console.log("PASS", name); }
  catch (err) { failed++; console.error("FAIL", name, err && err.message); }
}

const on = { stockEnforcement: true };
const sql = read("STAGE85_STOCK_STATUS_OVERRIDE.sql");
const adminHtml = read("admin.html");
const adminJs = read("admin.js");
const shop = read("shop.js");

test("Automatic uses numeric quantity", () => {
  const auto12 = Stock.storefrontStockInfo({ stock: 12, stock_status: null }, on);
  assert.strictEqual(auto12.key, "in");
  assert.strictEqual(auto12.canBuy, true);
  assert.strictEqual(auto12.qty, 12);
  assert.strictEqual(auto12.label, "ئامباردا بار");

  const auto3 = Stock.storefrontStockInfo({ stock: 3, stock_status: "" }, on);
  assert.strictEqual(auto3.key, "low");
  assert.strictEqual(auto3.canBuy, true);
  assert.strictEqual(auto3.label, "ئاز قالدى");
  assert.strictEqual(auto3.qty, 3);

  const auto0 = Stock.storefrontStockInfo({ stock: 0 }, on);
  assert.strictEqual(auto0.key, "out");
  assert.strictEqual(auto0.canBuy, false);
  assert.strictEqual(auto0.label, "تۈگەپ كەتتى");
});

test("Manual low stock keeps quantity and stays buyable", () => {
  const info = Stock.storefrontStockInfo({ stock: 12, stock_status: "low_stock" }, on);
  assert.strictEqual(info.key, "low");
  assert.strictEqual(info.label, "ئاز قالدى");
  assert.strictEqual(info.canBuy, true);
  assert.strictEqual(info.qty, 12);
});

test("Manual sold out with stock > 0 blocks purchase", () => {
  const info = Stock.storefrontStockInfo({ stock: 12, stock_status: "out_of_stock" }, on);
  assert.strictEqual(info.key, "out");
  assert.strictEqual(info.label, "تۈگەپ كەتتى");
  assert.strictEqual(info.canBuy, false);
  assert.strictEqual(info.qty, 12);
});

test("stock=0 cannot be manually made purchasable", () => {
  const inn = Stock.storefrontStockInfo({ stock: 0, stock_status: "in_stock" }, on);
  const low = Stock.storefrontStockInfo({ stock: 0, stock_status: "low_stock" }, on);
  assert.strictEqual(inn.canBuy, false);
  assert.strictEqual(inn.key, "out");
  assert.strictEqual(inn.label, "تۈگەپ كەتتى");
  assert.strictEqual(low.canBuy, false);
  assert.strictEqual(low.key, "out");
});

test("Returning to Automatic restores quantity-based behavior", () => {
  const sold = Stock.storefrontStockInfo({ stock: 12, stock_status: "out_of_stock" }, on);
  assert.strictEqual(sold.canBuy, false);
  const auto = Stock.storefrontStockInfo({ stock: 12, stock_status: null }, on);
  assert.strictEqual(auto.canBuy, true);
  assert.strictEqual(auto.key, "in");
});

test("migration is additive, nullable, and does not rewrite stock", () => {
  const apply = sql.split("READ-ONLY POST-CHECK")[0];
  assert.match(apply, /ADD COLUMN IF NOT EXISTS stock_status text/);
  assert.match(apply, /ALTER COLUMN stock_status DROP NOT NULL/);
  assert.match(apply, /ALTER COLUMN stock_status DROP DEFAULT/);
  assert.match(apply, /in_stock', 'low_stock', 'out_of_stock'/);
  assert.match(apply, /CREATE SCHEMA IF NOT EXISTS private/);
  assert.match(apply, /CREATE OR REPLACE FUNCTION private\.kutadgu_orders_reject_manual_sold_out/);
  assert.match(apply, /SET search_path = ''/);
  assert.doesNotMatch(apply, /CREATE OR REPLACE FUNCTION public\.kutadgu_orders_reject_manual_sold_out/);
  assert.match(apply, /kutadgu_orders_reject_manual_sold_out/);
  assert.match(apply, /HINT = 'manual_sold_out'/);
  assert.doesNotMatch(apply, /\bUPDATE\s+public\.books\b/i);
  assert.doesNotMatch(apply, /SET\s+stock\s*=/i);
  assert.doesNotMatch(apply, /DELETE\s+FROM\s+public\.books/i);
});

test("Admin selector has Automatic plus three overrides", () => {
  assert.match(adminHtml, /id="bookStockStatus"/);
  assert.match(adminHtml, /id="quickStockStatus"/);
  assert.match(adminHtml, />ئاپتوماتىك</);
  assert.match(adminHtml, /value="in_stock">ئامباردا بار</);
  assert.match(adminHtml, /value="low_stock">ئاز قالدى</);
  assert.match(adminHtml, /value="out_of_stock">تۈگەپ كەتتى</);
  assert.match(adminJs, /row\.stock_status=statusParsed\.value/);
  assert.match(adminJs, /detectOptionalStockStatusColumn/);
});

test("Quick Edit persists stock_status when the column is present", () => {
  const built = Prod.buildQuickEditPatch(
    { title: "A", source: "universal.html", stock: "12", stock_status: "out_of_stock" },
    { presentBookCols: new Set(["stock", "stock_status"]) }
  );
  assert.strictEqual(built.ok, true);
  assert.strictEqual(built.patch.stock, 12);
  assert.strictEqual(built.patch.stock_status, "out_of_stock");
  const auto = Prod.buildQuickEditPatch(
    { title: "A", source: "universal.html", stock: "12", stock_status: "" },
    { presentBookCols: new Set(["stock", "stock_status"]) }
  );
  assert.strictEqual(auto.patch.stock_status, null);
});

test("storefront loads stock helper before shop.js uses it", () => {
  const cfg = read("supabase-config.js");
  assert.match(cfg, /kutadgu-stock\.js\?v=4/);
  assert.match(cfg, /kutadguLoadStockHelper/);
  assert.match(shop, /if\(helper&&typeof helper\.storefrontStockInfo==="function"\)return helper\.storefrontStockInfo\(book\)/);
});

if (failed) process.exit(1);
console.log("manual-stock-status-tests ok");
