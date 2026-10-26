#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "kutadgu-category-nav.js"), "utf8");
const premium = fs.readFileSync(path.join(root, "premium-ux.js"), "utf8");

function load(rows) {
  const listeners = {};
  const document = {
    readyState: "complete",
    body: {},
    head: { appendChild() {} },
    querySelector() { return null; },
    addEventListener(name, fn) { listeners[name] = fn; },
    dispatchEvent(event) { if (listeners[event.type]) listeners[event.type](event); }
  };
  const context = {
    window: null,
    document,
    location: { pathname: "/" },
    matchMedia() { return { matches: false }; }
  };
  context.window = context;
  context.window.KutadguBookCategories = { visible: () => rows };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.KutadguCategoryNav;
}

const nav = load([
  { slug: "romanlar", label: "رومانلار" },
  { slug: "dastanlar", label: "داستانلار" },
  { slug: "adabiyat", label: "ئەدەبىيات" },
  { slug: "yoshurun", label: "يوشۇرۇن", is_hidden: true },
  { slug: "eski", label: "كونا", retired: true },
  { slug: "yeni-tur", label: "يېڭى تۈر" }
]);
const data = JSON.parse(JSON.stringify(nav.model()));
assert.strictEqual(data.groups.find((group) => group.id === "history"), undefined);
assert.strictEqual(data.groups.find((group) => group.id === "literature").leaves.map((leaf) => leaf.slug).join(","), "romanlar");
assert.strictEqual(data.unmapped.map((leaf) => leaf.slug).join(","), "dastanlar,adabiyat,yeni-tur");
assert.ok(data.all.every((leaf) => leaf.slug !== "yoshurun" && leaf.slug !== "eski"));

const placed = load([
  { slug: "romanlar", label: "رومان" },
  { slug: "derslik", label: "دەرسلىك" },
  { slug: "dunyawi-meshhur-eser-2", label: "دۇنياۋى مەشھۇر ئەسەر", group_key: "literature" },
  { slug: "meshhur-shexisler", label: "مەشھۇر شەخسلەر", group_key: "history" },
  { slug: "children", label: "بالىلار", group_key: "children" },
  { slug: "yeni-tur", label: "يېڭى تۈر" }
]);
const placedData = JSON.parse(JSON.stringify(placed.model()));
const literature = placedData.groups.find((group) => group.id === "literature").leaves.map((leaf) => leaf.slug);
const history = placedData.groups.find((group) => group.id === "history").leaves.map((leaf) => leaf.slug);
const family = placedData.groups.find((group) => group.id === "family").leaves.map((leaf) => leaf.slug);
assert.deepStrictEqual(literature, ["romanlar", "dunyawi-meshhur-eser-2"]);
assert.deepStrictEqual(history, ["meshhur-shexisler"]);
assert.deepStrictEqual(family, ["children"]);
assert.strictEqual(placedData.unmapped.map((leaf) => leaf.slug).join(","), "yeni-tur");
assert.strictEqual(literature.filter((slug) => slug === "romanlar").length, 1);
assert.strictEqual(history.includes("romanlar"), false);
assert.match(premium.slice(premium.indexOf("function renderDiscovery"), premium.indexOf("function wizardMarkup")), /#premiumDiscovery/);
assert.doesNotMatch(premium.slice(premium.indexOf("function renderDiscovery"), premium.indexOf("function wizardMarkup")), /insertAdjacentElement|createElement/);
console.log("category-nav-tests passed");
