#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const theme = fs.readFileSync(path.join(root, "theme.css"), "utf8");
const headerCss = fs.readFileSync(path.join(root, "public-header.css"), "utf8");
const shopCss = fs.readFileSync(path.join(root, "shop.css"), "utf8");
const accountCss = fs.readFileSync(path.join(root, "account.css"), "utf8");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, err.message);
  }
}

function cssBlock(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, "missing block " + marker);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error("unclosed block " + marker);
}

function varsOf(block) {
  const vars = {};
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(block))) vars[m[1]] = m[2].trim();
  return vars;
}

const CANONICAL = [
  "--site-bg",
  "--site-bg-soft",
  "--site-card",
  "--site-text",
  "--site-text-soft",
  "--site-brown",
  "--site-brown-dark",
  "--site-border"
];

const TOKENS = [
  "--font-ui",
  "--font-size-xs",
  "--font-size-sm",
  "--font-size-md",
  "--font-size-lg",
  "--font-size-xl",
  "--font-weight-normal",
  "--font-weight-medium",
  "--font-weight-bold",
  "--space-1",
  "--space-2",
  "--space-3",
  "--space-4",
  "--space-5",
  "--space-6",
  "--space-section",
  "--radius-sm",
  "--radius-md",
  "--radius-lg",
  "--radius-pill",
  "--shadow-sm",
  "--shadow-md",
  "--button-primary-bg",
  "--button-primary-hover",
  "--button-primary-text",
  "--button-secondary-bg",
  "--button-secondary-border",
  "--button-secondary-text"
];

const LEGACY_ALIASES = {
  "--bg": "--site-bg",
  "--bg-soft": "--site-bg-soft",
  "--header": "--site-brown-dark",
  "--text": "--site-text",
  "--text-soft": "--site-text-soft",
  "--card": "--site-card",
  "--button": "--site-brown",
  "--button-hover": "--site-brown-dark",
  "--border": "--site-border",
  "--cream": "--site-bg",
  "--brown": "--site-brown",
  "--brown-dark": "--site-brown-dark"
};

const LIGHT_HEX = {
  "--site-bg": "#f6f0e5",
  "--site-bg-soft": "#fbf8f2",
  "--site-card": "#fffdf9",
  "--site-text": "#44352d",
  "--site-text-soft": "#806f62",
  "--site-brown-dark": "#4b3327",
  "--site-brown": "#70503d",
  "--site-border": "#e8dccb"
};

const DARK_HEX = {
  "--site-bg": "#211b18",
  "--site-bg-soft": "#29221e",
  "--site-card": "#302824",
  "--site-text": "#f1e7da",
  "--site-text-soft": "#bcae9f",
  "--site-brown-dark": "#171311",
  "--site-brown": "#8d6b52",
  "--site-border": "#4a3b33"
};

const rootVars = varsOf(cssBlock(theme, ":root"));
const darkVars = varsOf(cssBlock(theme, "body.dark-mode"));

test("canonical color tokens exist on :root with current bookstore hexes", () => {
  CANONICAL.forEach((name) => {
    assert.ok(rootVars[name], name);
    assert.strictEqual(rootVars[name].toLowerCase(), LIGHT_HEX[name]);
  });
});

test("typography spacing radius shadow and button tokens exist on :root", () => {
  TOKENS.forEach((name) => assert.ok(rootVars[name], name));
  assert.match(rootVars["--font-ui"], /UKIJ CJK/);
  assert.strictEqual(rootVars["--button-primary-bg"], "var(--site-brown)");
  assert.strictEqual(rootVars["--button-primary-hover"], "var(--site-brown-dark)");
  assert.strictEqual(rootVars["--button-primary-text"], "#fff");
  assert.strictEqual(rootVars["--button-secondary-bg"], "var(--site-card)");
  assert.strictEqual(rootVars["--button-secondary-border"], "var(--site-border)");
  assert.strictEqual(rootVars["--button-secondary-text"], "var(--site-text)");
});

test("legacy color names alias canonical --site-* tokens", () => {
  Object.entries(LEGACY_ALIASES).forEach(([legacy, canonical]) => {
    assert.ok(rootVars[legacy], legacy);
    assert.strictEqual(rootVars[legacy], "var(" + canonical + ")");
    assert.ok(darkVars[legacy], "dark " + legacy);
    assert.strictEqual(darkVars[legacy], "var(" + canonical + ")");
  });
});

test("dark mode keeps compatible site colors and button tokens", () => {
  CANONICAL.forEach((name) => {
    assert.ok(darkVars[name], name);
    assert.strictEqual(darkVars[name].toLowerCase(), DARK_HEX[name]);
  });
  [
    "--button-primary-bg",
    "--button-primary-hover",
    "--button-primary-text",
    "--button-secondary-bg",
    "--button-secondary-border",
    "--button-secondary-text",
    "--shadow-sm",
    "--shadow-md"
  ].forEach((name) => assert.ok(darkVars[name], "dark " + name));
  assert.strictEqual(darkVars["--button-primary-text"], "#fff");
  assert.notStrictEqual(darkVars["--site-bg"], rootVars["--site-bg"]);
  assert.notStrictEqual(darkVars["--site-text"], rootVars["--site-text"]);
});

test("UKIJ body * !important rule is kept; form controls also use UKIJ", () => {
  assert.match(rootVars["--font-ui"], /UKIJ CJK/);
  assert.match(
    theme,
    /html\s*,\s*body\s*,\s*body \*\s*\{[\s\S]*?font-family:\s*var\(--font-ui\)\s*!important/
  );
  assert.match(theme, /body \* \{/);
  assert.match(
    theme,
    /input\s*,\s*button\s*,\s*textarea\s*,\s*select\s*\{[\s\S]*?font-family:\s*var\(--font-ui\)\s*!important/
  );
  assert.doesNotMatch(theme, /font-family:\s*var\(--font-ui,/);
});

test("no new unscoped header geometry rule overrides public-header compact bar", () => {
  assert.match(headerCss, /display:\s*grid !important/);
  assert.match(
    headerCss,
    /grid-template-columns:\s*minmax\(150px, 240px\) minmax\(280px, 360px\) minmax\(260px, 1fr\)/
  );
  assert.match(headerCss, /grid-template-rows:\s*64px auto/);
  assert.match(headerCss, /max-width:\s*360px !important/);
  assert.match(headerCss, /min-width:\s*280px !important/);
  assert.match(headerCss, /max-width:\s*420px !important/);
  assert.doesNotMatch(theme, /\.kutadgu-public-header[^{]*\{[\s\S]*display:\s*block/);
  const unscopedHeader = [...theme.matchAll(/(?:^|\n)header\s*\{([\s\S]*?)\n\}/g)];
  assert.ok(unscopedHeader.length >= 1, "legacy header block still present");
  unscopedHeader.forEach((m) => {
    assert.doesNotMatch(m[1], /display:\s*(?:flex|grid|block)/);
    assert.doesNotMatch(m[1], /flex-direction:\s*column/);
  });
});

test("shared primitives exist without renaming behavioral classes", () => {
  assert.match(theme, /\.kutadgu-btn-primary\s*\{/);
  assert.match(theme, /\.kutadgu-btn-secondary\s*\{/);
  assert.match(theme, /\.kutadgu-btn-tertiary\s*\{/);
  assert.match(theme, /\.kutadgu-surface\s*\{/);
  assert.match(theme, /\.kutadgu-field\s*\{/);
  assert.match(theme, /\.button,\s*\n\.book-button,\s*\n\.back-button,\s*\n\.detail-button/);
  assert.match(theme, /background-color:\s*var\(--button-primary-bg\)/);
  assert.match(shopCss, /\.empty-state-button\{[^}]*--button-primary-bg/);
  assert.match(shopCss, /\.search-load-more\{[^}]*--button-secondary-bg/);
  assert.match(shopCss, /\.catalog-load-more\{[^}]*--button-secondary-bg/);
  assert.match(accountCss, /\.account-primary\{[^}]*--button-primary-bg/);
  assert.match(accountCss, /\.account-form input,\.account-form textarea\{[^}]*--radius-md/);
  assert.doesNotMatch(shopCss, /\.add-to-cart\{[^}]*--button-primary-bg/);
});

test("this PR does not change Admin/auth-backend/SQL surfaces", () => {
  const out = execSync("git diff --name-only main HEAD; git diff --name-only; git diff --cached --name-only", {
    cwd: root,
    encoding: "utf8"
  });
  const files = [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))];
  const allowedSql = new Set([
    "SITE_HOMEPAGE_ABOUT.sql",
    "STAGE9_ANALYTICS_INSERT_RLS.sql",
    "STAGE4_ANALYTICS_RPC_FIX.sql",
    "SUPABASE_SETUP.sql",
    "DATABASE_UPGRADE_V10.sql"
  ]);
  const forbidden = files.filter((file) =>
    (/\.sql$/i.test(file) && !allowedSql.has(file)) ||
    /(^|\/)supabase\//i.test(file) ||
    /(^|\/)admin\.(html|js|css)$/i.test(file) ||
    /(^|\/)(rls|grants?|triggers?)\b/i.test(file)
  );
  assert.deepStrictEqual(forbidden, [], "unexpected backend files: " + forbidden.join(", "));
  files.forEach((file) => {
    if (/(^|\/)scripts\/.*tests\.js$/.test(file) || file.startsWith("tests/")) return;
    if (!/\.(css|js|html)$/i.test(file)) return;
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(text, /CREATE POLICY|ALTER TABLE|GRANT SELECT|ENABLE ROW LEVEL SECURITY/);
  });
});

if (failed) {
  console.error("\n" + failed + " design-foundation test(s) failed");
  process.exit(1);
}
console.log("design-foundation-tests ok");
