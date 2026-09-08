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

const lightboxSrc = sliceBetween(shop, "function openCoverLightbox(slides,startIndex,alt){", "function setupCoverZoom(book){");
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
  assert.doesNotMatch(lightboxSrc, /inert/);
  assert.doesNotMatch(lightboxSrc, /aria-hidden/);
});

test("setupCoverZoom still opens the same lightbox from the cover image", () => {
  assert.match(zoomSrc, /img\.onclick=/);
  assert.match(zoomSrc, /openCoverLightbox\(slides\.length\?slides:\[current\],start,img\.alt\|\|""\)/);
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
    isConnected: false,
    parent: null,
    children: [],
    attrs: {},
    listeners: {},
    onclick: null,
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
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
  const opener = el("button");
  opener.className = "detail-cover-zoomable";
  opener.isConnected = true;
  body.appendChild(opener);
  const doc = {
    activeElement: opener,
    body,
    keydown: [],
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
  opener.doc = doc;
  opener.focus();
  return { doc, opener, body };
}

function loadLightbox(document) {
  return new Function("document", `
    function isSafeCoverUrl(src){ return /^https?:\\/\\//.test(String(src||"")); }
    function isSampleDemoCover(){ return false; }
    function assignCoverImage(img,url){ img.src=url; }
    ${lightboxSrc}
    return { openCoverLightbox };
  `)(document);
}

function overlayOf(body) {
  return body.children.find((n) => n.className === "cover-zoom-overlay");
}
function child(overlay, className) {
  return overlay.children.find((n) => n.className === className);
}
function fireKey(doc, key, opts) {
  const event = {
    key,
    shiftKey: !!(opts && opts.shiftKey),
    prevented: false,
    preventDefault() { this.prevented = true; }
  };
  doc.keydown.slice().forEach((fn) => fn(event));
  return event;
}

test("opening stores the opener and moves focus to the close button", () => {
  const { doc, opener } = makeDocument();
  const api = loadLightbox(doc);
  api.openCoverLightbox(["https://example.com/a.webp"], 0, "cover");
  const overlay = overlayOf(doc.body);
  const closeBtn = child(overlay, "cover-zoom-close");
  assert.ok(overlay);
  assert.strictEqual(doc.activeElement, closeBtn);
  assert.strictEqual(closeBtn.textContent, "✕");
  fireKey(doc, "Escape");
  assert.strictEqual(doc.activeElement, opener);
});

test("Tab wraps last to first and Shift+Tab wraps first to last", () => {
  const { doc } = makeDocument();
  const api = loadLightbox(doc);
  api.openCoverLightbox(["https://example.com/a.webp", "https://example.com/b.webp"], 0, "cover");
  const overlay = overlayOf(doc.body);
  const closeBtn = child(overlay, "cover-zoom-close");
  const prevBtn = child(overlay, "cover-zoom-prev");
  const nextBtn = child(overlay, "cover-zoom-next");
  assert.strictEqual(doc.activeElement, closeBtn);

  nextBtn.focus();
  const tab = fireKey(doc, "Tab");
  assert.strictEqual(tab.prevented, true);
  assert.strictEqual(doc.activeElement, closeBtn);

  const shift = fireKey(doc, "Tab", { shiftKey: true });
  assert.strictEqual(shift.prevented, true);
  assert.strictEqual(doc.activeElement, nextBtn);

  prevBtn.focus();
  const mid = fireKey(doc, "Tab");
  assert.strictEqual(mid.prevented, false);
  assert.strictEqual(doc.activeElement, prevBtn);
});

test("single-control dialog traps Tab on the close button", () => {
  const { doc } = makeDocument();
  const api = loadLightbox(doc);
  api.openCoverLightbox(["https://example.com/a.webp"], 0, "cover");
  const overlay = overlayOf(doc.body);
  const closeBtn = child(overlay, "cover-zoom-close");
  assert.ok(!child(overlay, "cover-zoom-prev"));
  const tab = fireKey(doc, "Tab");
  assert.strictEqual(tab.prevented, true);
  assert.strictEqual(doc.activeElement, closeBtn);
  const shift = fireKey(doc, "Tab", { shiftKey: true });
  assert.strictEqual(shift.prevented, true);
  assert.strictEqual(doc.activeElement, closeBtn);
});

test("Escape and overlay click still close and restore opener; arrows still step", () => {
  const { doc, opener } = makeDocument();
  const api = loadLightbox(doc);
  api.openCoverLightbox(["https://example.com/a.webp", "https://example.com/b.webp"], 0, "cover");
  let overlay = overlayOf(doc.body);
  const count = overlay.children.find((n) => n.className === "cover-zoom-count");
  assert.strictEqual(count.textContent, "1 / 2");
  fireKey(doc, "ArrowRight");
  assert.strictEqual(count.textContent, "2 / 2");
  fireKey(doc, "ArrowLeft");
  assert.strictEqual(count.textContent, "1 / 2");
  fireKey(doc, "Escape");
  assert.strictEqual(overlayOf(doc.body), undefined);
  assert.strictEqual(doc.activeElement, opener);

  api.openCoverLightbox(["https://example.com/a.webp"], 0, "cover");
  overlay = overlayOf(doc.body);
  overlay.onclick({ target: overlay });
  assert.strictEqual(overlayOf(doc.body), undefined);
  assert.strictEqual(doc.activeElement, opener);
});

test("close button still restores focus without new visible copy", () => {
  const { doc, opener } = makeDocument();
  const api = loadLightbox(doc);
  api.openCoverLightbox(["https://example.com/a.webp"], 0, "cover");
  const overlay = overlayOf(doc.body);
  const closeBtn = child(overlay, "cover-zoom-close");
  closeBtn.onclick();
  assert.strictEqual(overlayOf(doc.body), undefined);
  assert.strictEqual(doc.activeElement, opener);
  assert.doesNotMatch(lightboxSrc, /focus-trap|tabindex="-1"|Visually hidden|skip lightbox/i);
});

if (failed) {
  console.error("\n" + failed + " l2 cover lightbox focus test(s) failed");
  process.exit(1);
}
console.log("l2-cover-lightbox-focus-tests ok");
