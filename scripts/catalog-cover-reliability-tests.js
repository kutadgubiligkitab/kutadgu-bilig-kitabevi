#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const images = require("../kutadgu-image-storage.js");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "shop.js"), "utf8");
const A = "https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/book/111.webp";
const B = "https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/book/222.webp";
const preview = {
  r2ReadEnabled: true,
  hostname: "kutadgu-cloudflare-preview.kutadgu-preview.workers.dev",
  origin: "https://kutadgu-cloudflare-preview.kutadgu-preview.workers.dev",
  pathname: "/"
};

function sliceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}

const changed = images.rewritePreviewHtmlImages('<img data-kutadgu-cover-origin="' + A + '" src="' + B + '">', preview);
assert.ok(changed.includes('data-kutadgu-cover-origin="' + B + '"'), changed);
assert.ok(!changed.includes('data-kutadgu-cover-origin="' + A + '"'), changed);
assert.ok(changed.includes("/__r2/book-covers/book/222.webp"), changed);

const same = images.rewritePreviewHtmlImages('<img data-kutadgu-cover-origin="' + A + '" src="' + A + '">', preview);
assert.ok(same.includes('data-kutadgu-cover-origin="' + A + '"'), same);
assert.ok(same.includes("/__r2/book-covers/book/111.webp"), same);

const fresh = images.rewritePreviewHtmlImages('<img src="' + A + '">', preview);
assert.ok(fresh.includes('data-kutadgu-cover-origin="' + A + '"'), fresh);

const pageBook = sliceBetween(shop, "function pageBookReadFailureAuthority", "async function attachPublicBookCredits");
assert.match(pageBook, /if\(isBookDetailDocument\(\)&&\(requiresRemoteProductAuthority\(\)\|\|numericBook\)\)return "unavailable"/);
assert.match(pageBook, /return "idle"/);
assert.match(pageBook, /pageBookAuthority=pageBookReadFailureAuthority\(id\)/);

const boot = sliceBetween(shop, "async function boot()", "window.kutadguShop=");
assert.match(boot, /const catalogProbe=loadRemoteCatalog\(\);\r?\n  catalogProbe\.catch\(\(\)=>\{\}\);\r?\n  await hydratePageBook\(\)/);
assert.doesNotMatch(boot, /await loadRemoteCatalog\(\)/);
assert.doesNotMatch(boot, /await loadMemberSystem/);

const hydrate = sliceBetween(shop, "async function hydratePageBook()", "function resolveStoredBookId");
assert.match(hydrate, /if\(!remoteCatalog\.available&&!remoteCatalog\.configured\)/);
const saved = sliceBetween(shop, "async function hydrateBooksByIds", "let pageBookHydrationDone");
assert.match(saved, /!remoteCatalog\.available&&!remoteCatalog\.configured/);
const probe = sliceBetween(shop, "async function loadRemoteCatalog()", "async function hydrateBooksByIds");
assert.match(probe, /if\(remoteCatalog\.available\)/);

const cover = sliceBetween(shop, "function applyDetailCoverFallback(){", "function decorateCards(){");
assert.match(cover, /if\(!book\|\|!isStorefrontVisible\(book\)\)\{/);
assert.match(cover, /if\(book&&!isStorefrontVisible\(book\)\)/);
assert.match(cover, /trustworthyDetailCover\(img\)/);
assert.match(shop, /function ensureDetailCoverImage\(\)/);
assert.match(shop, /function scheduleDetailHeroRecovery\(box,src,bookId\)/);
const recovery = sliceBetween(shop, "function scheduleDetailHeroRecovery(box,src,bookId){", "function trustworthyDetailCover");
assert.match(recovery, /coverHeroGeneration/);
assert.match(recovery, /coverHeroSrc/);
assert.match(recovery, /pageBookAuthority==="hidden"/);
const hero = sliceBetween(shop, "function setDetailHeroImage(src,alt){", "function openCoverLightbox");
assert.match(hero, /ensureDetailCoverImage\(\)/);
assert.match(hero, /bumpDetailHeroRecovery\(box\)/);
assert.ok(hero.indexOf("bumpDetailHeroRecovery(box)") < hero.indexOf("assignCoverImage"));
const populate = sliceBetween(shop, "function populateDynamicBookPage(b){", "const DETAIL_RELATED_LIMIT");
assert.match(populate, /keepDecodedDetailCover\(img\)/);
assert.doesNotMatch(populate, /keepDecodedDetailCover\(img\)\)return/);
assert.ok(populate.indexOf("keepDecodedDetailCover(img)") < populate.indexOf("h1.textContent=b.title"));
const listingApply = sliceBetween(shop, "async function apply(append=false,options={})", "const debouncedApply");
const listingCatch = listingApply.slice(listingApply.lastIndexOf("}catch(error){"));
const appendAt = listingCatch.indexOf("if(append){");
const hideAt = listingCatch.indexOf("controls.hidden=true");
assert.ok(appendAt >= 0 && hideAt > appendAt);
const appendBranch = listingCatch.slice(appendAt, hideAt);
assert.match(appendBranch, /controls\.hidden=false/);
assert.doesNotMatch(appendBranch, /grid\.innerHTML/);

const featured = sliceBetween(shop, "async function renderHomeFeaturedBooks(options={})", "function renderHomeSections()");
const featuredCatch = featured.slice(featured.indexOf("}catch(error){"));
assert.ok(featuredCatch.indexOf("if(token!==homeFeaturedRequestId)return;") < featuredCatch.indexOf("grid.innerHTML"));
assert.ok(featuredCatch.indexOf("keptFeatured") < featuredCatch.indexOf("grid.innerHTML"));
assert.match(featured, /host\.dataset\.catalogState="failed"/);
assert.match(featured, /host\.dataset\.catalogState="empty"/);

const carousel = sliceBetween(shop, "async function setupHomeCarousel()", "function loadMemberSystem");
const setMode = carousel.slice(carousel.indexOf("async function setMode"), carousel.indexOf("async function next()"));
const errorPath = setMode.slice(setMode.indexOf("}catch(error){"));
assert.ok(errorPath.indexOf("mode!==requestedMode") < errorPath.indexOf("host.innerHTML"));
assert.match(errorPath, /kept&&kept\.settled/);
assert.match(carousel, /data-catalog-state="empty"/);

const search = sliceBetween(shop, "function searchEnhance()", "function dynamicListingCard");
assert.match(search, /function paintSearchFailure\(\)/);
assert.match(search, /retainSearch/);
assert.match(search, /settledSearch\.state/);

console.log("catalog cover reliability tests passed");
