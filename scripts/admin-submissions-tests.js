#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
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
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const adminHtml = read("admin.html");
const adminJs = read("admin.js");
const adminCss = read("admin.css");
const navSpec = read("tests/e2e/admin-navigation.spec.js");

function sliceFn(source, name) {
  const start = source.indexOf("async function " + name + "(");
  const alt = source.indexOf("function " + name + "(");
  const from = start >= 0 ? start : alt;
  assert.ok(from >= 0, "missing " + name);
  const next = source.slice(from + 1).search(/\n(?:async )?function /);
  return next < 0 ? source.slice(from) : source.slice(from, from + 1 + next);
}

test("submissions exists in desktop Admin navigation and mobile selector", () => {
  assert.match(adminHtml, /data-admin-section="submissions">📥 تەستىق ساقلاۋاتقان كىتابلار/);
  assert.match(adminHtml, /<option value="submissions">📥 تەستىق ساقلاۋاتقان كىتابلار<\/option>/);
  assert.match(adminHtml, /id="submissionsCard"[^>]*data-admin-section-panel="submissions"/);
  assert.match(adminHtml, /id="pendingSubmissionList"/);
  assert.match(adminHtml, /id="pendingSubmissionCount"/);
  assert.match(adminHtml, /تەستىق ساقلاۋاتقان: 0/);
  assert.match(adminHtml, /class="admin-sidenav"/);
  assert.match(adminHtml, /id="adminSectionSelect"/);
});

test("ADMIN_SECTIONS includes submissions and existing sections", () => {
  assert.match(
    adminJs,
    /const ADMIN_SECTIONS=\["overview","books","submissions","storefront","import-covers","insights","customers","orders","system"\]/
  );
  const parseStart = adminJs.match(/const ADMIN_SECTIONS=\[[^\]]+\]/);
  const def = adminJs.match(/const DEFAULT_ADMIN_SECTION="[^"]+"/);
  const fn = adminJs.match(/function parseAdminSectionHash\(hash\)\{[\s\S]*?\n\}/);
  const parse = new Function(`${parseStart[0]};${def[0]};${fn[0]};return parseAdminSectionHash;`)();
  assert.strictEqual(parse("#submissions"), "submissions");
  assert.strictEqual(parse("#books"), "books");
  assert.strictEqual(parse("#orders"), "orders");
  assert.strictEqual(parse("#system"), "system");
  assert.strictEqual(parse("#nope"), "books");
});

test("pending loader queries submission_status pending only", () => {
  const fn = sliceFn(adminJs, "loadPendingSubmissions");
  assert.match(fn, /PENDING_SUBMISSION_SELECT/);
  assert.match(adminJs, /const PENDING_SUBMISSION_SELECT="id,title,author,category,source,price,original_price,stock,isbn,publisher,publish_year,pages,cover_type,book_size,image_url,submitted_by,submitted_at,submission_status"/);
  assert.match(fn, /\.from\("books"\)/);
  assert.match(fn, /\.eq\("submission_status","pending"\)/);
  assert.doesNotMatch(fn, /\.eq\("is_active"/);
  assert.doesNotMatch(fn, /profiles|orders|admin_users|book_staff_users/);
});

test("approve and reject use staff submission RPCs and never books.update", () => {
  const fn = sliceFn(adminJs, "reviewStaffSubmission");
  const render = sliceFn(adminJs, "renderPendingSubmissions");
  assert.match(fn, /confirm\("بۇ كىتابنى تەستىقلاپ ئاممىۋى قىلامسىز/);
  assert.match(fn, /تور بەتتە كۆرۈنىدۇ/);
  assert.match(fn, /confirm\("بۇ تەكلىپنى رەت قىلامسىز/);
  assert.match(fn, /كىتاب ئاكتىپ بولمايدۇ ۋە رەت قىلىندى دەپ بەلگىلىنىدۇ/);
  assert.match(fn, /db\.rpc\(rpcName,\{p_book_id:Number\(id\)\}\)/);
  assert.match(fn, /approve_staff_book_submission/);
  assert.match(fn, /reject_staff_book_submission/);
  assert.doesNotMatch(fn, /\.from\("books"\)\.update/);
  assert.doesNotMatch(fn, /submission_status\s*=/);
  assert.doesNotMatch(render, /data-edit|data-delete|data-hide|data-quick-edit/);
  assert.match(adminJs, /if\(id==="submissions"\)loadPendingSubmissions\(\)/);
  assert.match(navSpec, /submissions: "#submissionsCard"/);
});

test("submission errors surface missing RPC, permission, AAL2, stale, and network failures", () => {
  const fn = sliceFn(adminJs, "formatStaffSubmissionError");
  assert.match(fn, /PGRST202/);
  assert.match(fn, /42883/);
  assert.match(fn, /isAal2OrderUpdateError/);
  assert.match(fn, /42501/);
  assert.match(fn, /P0002/);
  assert.match(fn, /failed to fetch/);
});

function cssBraceBalance(css) {
  const withoutComments = String(css).replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0;
  let min = 0;
  let quote = "";
  for (let i = 0; i < withoutComments.length; i++) {
    const ch = withoutComments[i];
    const prev = i > 0 ? withoutComments[i - 1] : "";
    if (quote) {
      if (ch === quote && prev !== "\\") quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth < min) min = depth;
    }
  }
  return { depth, min, quote };
}

test("admin.css brace structure is balanced and has no trailing unmatched }", () => {
  const { depth, min, quote } = cssBraceBalance(adminCss);
  assert.strictEqual(quote, "", "unclosed CSS string");
  assert.ok(min >= 0, "admin.css has an unmatched closing brace");
  assert.strictEqual(depth, 0, "admin.css brace depth ended at " + depth);
  assert.match(
    adminCss,
    /@media\(max-width:850px\)\{\s*\.admin-submission-row\{grid-template-columns:48px minmax\(0,1fr\)\}\s*\.admin-submission-row img,\s*\.admin-submission-row > div:first-child\{width:48px;height:64px\}\s*\.admin-submission-actions button\{flex:1;min-height:44px\}\s*\}/
  );
});

test("existing Admin sections remain in navigation", () => {
  ["books", "overview", "storefront", "import-covers", "insights", "customers", "orders", "system"].forEach((id) => {
    assert.match(adminHtml, new RegExp(`data-admin-section="${id}"`));
    assert.match(adminHtml, new RegExp(`<option value="${id}"`));
  });
  assert.match(adminHtml, /id="booksCard"/);
  assert.match(adminHtml, /id="orderManagement"/);
  assert.match(adminCss, /admin-submission-row/);
});

test("this PR does not add SQL or change public storefront files", () => {
  const out = execSync("git diff --name-only origin/main HEAD; git diff --name-only; git diff --cached --name-only", {
    cwd: root,
    encoding: "utf8"
  });
  const files = [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))];
  const sql = files.filter((file) => /\.sql$/i.test(file));
  assert.deepStrictEqual(sql, [], sql.join(", "));
  const storefront = files.filter((file) =>
    /^(index\.html|shop\.js|shop\.css|public-header\.(js|css)|catalog\.js)$/.test(file)
  );
  assert.deepStrictEqual(storefront, [], storefront.join(", "));
  assert.doesNotMatch(adminJs, /submit_book_for_approval/);
  assert.doesNotMatch(adminHtml, /is_kutadgu_book_staff/);
});

if (failed) {
  console.error("\n" + failed + " admin submissions test(s) failed");
  process.exit(1);
}
console.log("admin-submissions-tests ok");
