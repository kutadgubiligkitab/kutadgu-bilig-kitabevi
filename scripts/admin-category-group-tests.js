"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const config = fs.readFileSync(path.join(root, "app-config.js"), "utf8");
for (const id of ["literature", "history", "religion", "children", "parenting", "textbooks"]) {
  assert.match(config, new RegExp('id:"' + id + '"'));
}
const literature = config.slice(config.indexOf('id:"literature"'), config.indexOf('id:"history"'));
const history = config.slice(config.indexOf('id:"history"'), config.indexOf('id:"religion"'));
assert.match(literature, /تارىخىي رومانلار/);
assert.match(history, /تارىخىي رومانلار/);
assert.match(literature, /ئۇيغۇر ئەدەبىياتى/);
assert.match(history, /ئۇيغۇر ئەدەبىياتى/);

function element(id) {
  return {
    id: id,
    hidden: true,
    value: "",
    innerHTML: "",
    textContent: "",
    disabled: false,
    className: "",
    parentElement: null,
    dataset: {},
    children: [],
    attributes: {},
    appendChild(node) {
      if (node.parentElement && node.parentElement.children) {
        const parent = node.parentElement;
        parent.children = parent.children.filter((child) => child !== node);
      }
      this.children.push(node);
      node.parentElement = this;
      return node;
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {}
  };
}

const elements = {};
["bookCategoryList", "bookCategoryMoveSource", "bookCategoryMoveDestination", "bookCategoryMovePreview", "bookCategoryMovePanel", "bookCategoryMovePark", "bookCategoryConfirmMove", "bookCategoryReveal", "bookCategoryLabel", "bookCategorySummary", "bookCategoryGroup", "bookCategoryCreate"].forEach((id) => {
  elements[id] = element(id);
});
elements.bookCategoryMovePark.appendChild(elements.bookCategoryMovePanel);

const rows = [
  { id: 1, slug: "romanlar", source: "romanlar.html", label: "رومانلار", is_hidden: false, retired: false, book_count: 2, revision: 1, admin_group: null },
  { id: 8, slug: "tibb", source: "tibb.html", label: "تېبابەت", is_hidden: true, retired: false, book_count: 1, revision: 4, admin_group: null },
  { id: 15, slug: "dictionary", source: "dictionary.html", label: "لۇغەت", is_hidden: true, retired: true, book_count: 0, revision: 3, admin_group: null },
  { id: 9, slug: "universal", source: "universal.html", label: "ئۇنىۋېرسال", is_hidden: false, retired: false, book_count: 4, revision: 1, admin_group: "literature" }
];

const sandbox = {
  console,
  KUTADGU_APP_CONFIG: {
    discoveryGroups: [
      { id: "literature", label: "ئەدەبىيات", categories: ["رومانلار", "تارىخىي رومانلار"] },
      { id: "history", label: "تارىخ", categories: ["تارىخىي رومانلار"] },
      { id: "religion", label: "دىنىي", categories: ["دىنىي كىتابلار"] },
      { id: "children", label: "بالىلار", categories: ["بالىلار كىتابلىرى"] },
      { id: "parenting", label: "پەرزەنت تەربىيەسى", categories: ["پەرزەنت تەربىيەسى"] },
      { id: "textbooks", label: "دەرسلىك", categories: ["دەرسلىك"] }
    ]
  },
  document: {
    querySelector(selector) {
      if (selector.charAt(0) === "#") return elements[selector.slice(1)] || null;
      const match = String(selector).match(/data-category-id="([^"]+)"/);
      if (!match) return null;
      return elements.bookCategoryList.children.find((node) => node && node.id === match[1]) || null;
    },
    querySelectorAll() { return []; }
  }
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.KutadguBookCategories = {
  received: null,
  setAdminRows(value) { this.received = value; }
};
vm.runInNewContext(fs.readFileSync(path.join(root, "admin-book-categories.js"), "utf8"), sandbox, { filename: "admin-book-categories.js" });
const api = sandbox.KutadguAdminBookCategories;
api.state.rows = rows.map((row) => Object.assign({}, row));
api.render();

assert.strictEqual(api.state.rows.length, 4);
assert.deepStrictEqual(sandbox.KutadguBookCategories.received.map((row) => row.slug), rows.map((row) => row.slug));
assert.match(elements.bookCategoryList.innerHTML, /رومانلار/);
assert.match(elements.bookCategoryList.innerHTML, /ئەدەبىيات/);
assert.doesNotMatch(elements.bookCategoryList.innerHTML, /تېبابەت/);
assert.doesNotMatch(elements.bookCategoryList.innerHTML, /لۇغەت/);
assert.doesNotMatch(elements.bookCategoryMoveDestination.innerHTML, /تېبابەت/);
assert.doesNotMatch(elements.bookCategoryMoveDestination.innerHTML, /لۇغەت/);
assert.match(elements.bookCategoryMoveDestination.innerHTML, /رومانلار/);
assert.doesNotMatch(elements.bookCategoryMoveSource.innerHTML, /تېبابەت/);
assert.strictEqual(elements.bookCategoryReveal.attributes["aria-pressed"], "false");

api.state.showInactive = true;
api.render();
assert.strictEqual(api.state.rows.length, 4);
assert.match(elements.bookCategoryList.innerHTML, /تېبابەت/);
assert.match(elements.bookCategoryList.innerHTML, /يوشۇرۇن/);
assert.match(elements.bookCategoryList.innerHTML, /لۇغەت/);
assert.match(elements.bookCategoryList.innerHTML, /ئېلىۋېتىلگەن/);
assert.doesNotMatch(elements.bookCategoryMoveDestination.innerHTML, /تېبابەت/);
assert.doesNotMatch(elements.bookCategoryMoveDestination.innerHTML, /لۇغەت/);
assert.match(elements.bookCategoryMoveSource.innerHTML, /تېبابەت/);
assert.doesNotMatch(elements.bookCategoryMoveSource.innerHTML, /لۇغەت/);
assert.strictEqual(elements.bookCategoryReveal.attributes["aria-pressed"], "true");
assert.deepStrictEqual(api.state.rows.map((row) => row.label), rows.map((row) => row.label));

elements.bookCategoryLabel.value = "";
elements.bookCategoryGroup.value = "";
assert.strictEqual(api.createArgs().message, "تۈر نامىنى كىرگۈزۈڭ.");
elements.bookCategoryLabel.value = "يېڭى تۈر";
elements.bookCategoryGroup.value = "nope";
assert.strictEqual(api.createArgs().message, "چوڭ گۇرۇپپىنى تاللاڭ.");
elements.bookCategoryGroup.value = "textbooks";
const prepared = api.createArgs();
assert.strictEqual(prepared.args.p_admin_group, "textbooks");
assert.strictEqual(prepared.args.p_label, "يېڭى تۈر");
assert.strictEqual(api.groupOptions().map((group) => group.label).join(","), "ئەدەبىيات,تارىخ,دىنىي,بالىلار,پەرزەنت تەربىيەسى,دەرسلىك");

console.log("admin category groups: PASS");
