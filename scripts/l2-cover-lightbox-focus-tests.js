#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");

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
function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + 1);
  assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
  return src.slice(start, end);
}

const lightboxSrc = sliceBetween(shop, "function openCoverLightbox(slides,startIndex,alt,openerEl){", "function setupCoverZoom(book){");
const zoomSrc = sliceBetween(shop, "function setupCoverZoom(book){", "function renderBookGallery(book){");

test("lightbox keeps existing dialog markup and navigation/close wiring", () => {
  assert.match(lightboxSrc, /overlay\.className="cover-zoom-overlay"/);
  assert.match(lightboxSrc, /role","dialog"/);
  assert.match(lightboxSrc, /aria-modal","true"/);
  assert.match(lightboxSrc, /aria-label","كىتاب رەسىمىنى چوڭ كۆرۈش"/);
  assert.match(lightboxSrc, /cover-zoom-close/);
  assert.match(lightboxSrc, /cover-zoom-prev/);
  assert.match(lightboxSrc, /cover-zoom-next/);
  assert.match(lightboxSrc, /closeBtn\.textContent="✕"/);
  assert.match(lightboxSrc, /if\(e\.key==="Escape"\)\{close\(\);return\}/);
  assert.match(lightboxSrc, /e\.key==="ArrowLeft"\|\|e\.key==="ArrowRight"/);
  assert.match(lightboxSrc, /overlay\.onclick=e=>\{if\(e\.target===overlay\)close\(\)\}/);
  assert.match(lightboxSrc, /openerEl&&typeof openerEl\.focus==="function"/);
  assert.doesNotMatch(lightboxSrc, /inert/);
  assert.doesNotMatch(lightboxSrc, /aria-hidden/);
});

test("setupCoverZoom makes the cover IMG a keyboard button and passes it as opener", () => {
  assert.match(zoomSrc, /img\.tabIndex=0/);
  assert.match(zoomSrc, /setAttribute\("role","button"\)/);
  assert.match(zoomSrc, /setAttribute\("title","مۇقاۋىنى چوڭ كۆرۈش"\)/);
  assert.match(zoomSrc, /setAttribute\("aria-label","مۇقاۋىنى چوڭ كۆرۈش"\)/);
  assert.match(zoomSrc, /const openCover=\(\)=>\{/);
  assert.match(zoomSrc, /img\.onclick=openCover/);
  assert.match(zoomSrc, /e\.key==="Enter"\)openCover\(\)/);
  assert.match(zoomSrc, /e\.preventDefault\(\);openCover\(\)/);
  assert.match(zoomSrc, /openCoverLightbox\(slides\.length\?slides:\[current\],start,img\.alt\|\|"",img\)/);
  assert.doesNotMatch(zoomSrc, /createElement\("button"\)/);
});

function el(tag) {
  const node = {
    tagName: String(tag || "div").toUpperCase(),
    className: "",
    textContent: "",
    type: "",
    alt: "",
    src: "",
    hidden: false,
    tabIndex: -1,
    style: { display: "" },
    isConnected: false,
    parent: null,
    children: [],
    attrs: {},
    listeners: {},
    onclick: null,
    classList: {
      add(name) {
        const parts = String(node.className || "").split(/\s+/).filter(Boolean);
        if (!parts.includes(name)) parts.push(name);
        node.className = parts.join(" ");
      }
    },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) {
      if (name === "src" && this.src) return this.src;
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    appendChild(child) {
      child.parent = this;
      child.isConnected = true;
      this.children.push(child);
      return child;
    },
    contains(other) {
      if (other === this) return true;
      return this.children.some((child) => child === other || child.contains(other));
    },
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      this.listeners[type] = (this.listeners[type] || []).filter((h) => h !== fn);
    },
    remove() {
      if (!this.parent) {
        this.isConnected = false;
        return;
      }
      this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null;
      this.isConnected = false;
    },
    focus() { node.doc.activeElement = this; }
  };
  return node;
}

function makeDocument() {
  const body = el("body");
  body.isConnected = true;
  const box = el("div");
  box.className = "book-cover-box";
  const img = el("img");
  img.src = "https://example.com/a.webp";
  img.alt = "cover";
  img.setAttribute("src", "https://example.com/a.webp");
  box.appendChild(img);
  body.appendChild(box);
  const other = el("button");
  body.appendChild(other);
  const doc = {
    activeElement: other,
    body,
    keydown: [],
    querySelector(sel) {
      if (sel === ".book-cover-box img") return img;
      return null;
    },
    createElement(tag) {
      const node = el(tag);
      node.doc = doc;
      return node;
    },
    addEventListener(type, fn) {
      if (type === "keydown") doc.keydown.push(fn);
    },
    removeEventListener(type, fn) {
      if (type === "keydown") doc.keydown = doc.keydown.filter((h) => h !== fn);
    }
  };
  body.doc = doc;
  box.doc = doc;
  img.doc = doc;
  other.doc = doc;
  other.focus();
  return { doc, img, other, body };
}

function loadApi(document) {
  return new Function("document", `
    function isSafeCoverUrl(src){ return /^https?:\\/\\//.test(String(src||"")); }
    function isSampleDemoCover(){ return false; }
    function assignCoverImage(img,url){ img.src=url; }
    function detailGallerySlides(){ return ["https://example.com/a.webp","https://example.com/b.webp"]; }
    function getDetailBook(){ return { title: "Test" }; }
    ${lightboxSrc}
    ${zoomSrc}
    return { openCoverLightbox, setupCoverZoom };
  `)(document);
}

function overlayOf(body) {
  return body.children.find((n) => n.className === "cover-zoom-overlay");
}
function child(overlay, className) {
  return overlay.children.find((n) => n.className === className);
}
function fireDocKey(doc, key, opts) {
  const event = {
    key,
    code: key === " " ? "Space" : key,
    shiftKey: !!(opts && opts.shiftKey),
    prevented: false,
    preventDefault() { this.prevented = true; }
  };
  doc.keydown.slice().forEach((fn) => fn(event));
  return event;
}
function fireImgKey(img, key) {
  const event = {
    key,
    code: key === " " ? "Space" : key,
    prevented: false,
    preventDefault() { this.prevented = true; }
  };
  (img.listeners.keydown || []).forEach((fn) => fn(event));
  return event;
}

test("setupCoverZoom makes the IMG keyboard-focusable with button semantics", () => {
  const { doc, img } = makeDocument();
  loadApi(doc).setupCoverZoom({});
  assert.strictEqual(img.tagName, "IMG");
  assert.strictEqual(img.tabIndex, 0);
  assert.strictEqual(img.getAttribute("role"), "button");
  assert.strictEqual(img.getAttribute("title"), "مۇقاۋىنى چوڭ كۆرۈش");
  assert.strictEqual(img.getAttribute("aria-label"), "مۇقاۋىنى چوڭ كۆرۈش");
  assert.match(img.className, /detail-cover-zoomable/);
});

test("Enter and Space on the cover IMG open the existing lightbox; Space prevents default", () => {
  const { doc, img } = makeDocument();
  loadApi(doc).setupCoverZoom({});
  fireImgKey(img, "Enter");
  assert.ok(overlayOf(doc.body));
  assert.strictEqual(child(overlayOf(doc.body), "cover-zoom-close").textContent, "✕");
  fireDocKey(doc, "Escape");
  assert.strictEqual(overlayOf(doc.body), undefined);

  const space = fireImgKey(img, " ");
  assert.strictEqual(space.prevented, true);
  assert.ok(overlayOf(doc.body));
});

test("the actual IMG is stored as opener and close restores focus to that IMG", () => {
  const { doc, img, other } = makeDocument();
  loadApi(doc).setupCoverZoom({});
  other.focus();
  img.onclick();
  const overlay = overlayOf(doc.body);
  const closeBtn = child(overlay, "cover-zoom-close");
  assert.strictEqual(doc.activeElement, closeBtn);
  fireDocKey(doc, "Escape");
  assert.strictEqual(doc.activeElement, img);
  assert.notStrictEqual(doc.activeElement, other);

  other.focus();
  img.onclick();
  child(overlayOf(doc.body), "cover-zoom-close").onclick();
  assert.strictEqual(doc.activeElement, img);

  other.focus();
  img.onclick();
  overlayOf(doc.body).onclick({ target: overlayOf(doc.body) });
  assert.strictEqual(doc.activeElement, img);
});

test("Tab wraps last to first and Shift+Tab wraps first to last after IMG open", () => {
  const { doc, img } = makeDocument();
  loadApi(doc).setupCoverZoom({});
  img.onclick();
  const overlay = overlayOf(doc.body);
  const closeBtn = child(overlay, "cover-zoom-close");
  const prevBtn = child(overlay, "cover-zoom-prev");
  const nextBtn = child(overlay, "cover-zoom-next");
  assert.strictEqual(doc.activeElement, closeBtn);

  nextBtn.focus();
  const tab = fireDocKey(doc, "Tab");
  assert.strictEqual(tab.prevented, true);
  assert.strictEqual(doc.activeElement, closeBtn);

  const shift = fireDocKey(doc, "Tab", { shiftKey: true });
  assert.strictEqual(shift.prevented, true);
  assert.strictEqual(doc.activeElement, nextBtn);

  prevBtn.focus();
  const mid = fireDocKey(doc, "Tab");
  assert.strictEqual(mid.prevented, false);
  assert.strictEqual(doc.activeElement, prevBtn);
});

test("Escape overlay and arrows still work; visible UI is unchanged", () => {
  const { doc, img } = makeDocument();
  loadApi(doc).setupCoverZoom({});
  img.onclick();
  const overlay = overlayOf(doc.body);
  const count = overlay.children.find((n) => n.className === "cover-zoom-count");
  assert.strictEqual(count.textContent, "1 / 2");
  fireDocKey(doc, "ArrowRight");
  assert.strictEqual(count.textContent, "2 / 2");
  fireDocKey(doc, "ArrowLeft");
  assert.strictEqual(count.textContent, "1 / 2");
  assert.doesNotMatch(lightboxSrc, /focus-trap|tabindex="-1"|Visually hidden|skip lightbox/i);
  assert.doesNotMatch(zoomSrc, /createElement\("button"\)/);
});

if (failed) {
  console.error("\n" + failed + " l2 cover lightbox focus test(s) failed");
  process.exit(1);
}
console.log("l2-cover-lightbox-focus-tests ok");
