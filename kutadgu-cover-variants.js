(function(root, factory){
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.KutadguCoverVariants = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(){
  const CANONICAL_ORIGIN = "https://www.kutadgubilik.com";
  const VERSION = "v1";
  const WIDTHS = [480, 960];
  const WEBP_QUALITY = 0.82;
  const CARD_SIZES = "(max-width: 650px) 46vw, (max-width: 900px) 30vw, 240px";
  const DETAIL_SIZES = "(max-width: 700px) min(92vw, 560px), 560px";
  const THUMB_SIZES = "48px";
  const CART_SIZES = "108px";
  const AVAILABILITY_CACHE_MS = 60000;
  const AVAILABILITY_READ_BUDGET_MS = 400;
  const AVAILABILITY_CACHE_CONTROL = "public, max-age=60";
  const GLOBAL_AVAILABILITY_KEY = "book-covers/variants/" + VERSION + "/availability.json";

  let published = { version: VERSION, sources: {} };
  const availabilityCache = new Map();
  const appliedKeys = new Map();

  function deliverySourceKey(objectKey){
    const key = String(objectKey || "").replace(/^\/+/, "");
    if (!key || key.length > 460 || key.indexOf("..") !== -1 || key.indexOf("\\") !== -1 || key.indexOf("%") !== -1) return "";
    if (!/^book-covers\/[A-Za-z0-9._/-]+$/.test(key)) return "";
    if (/^book-covers\/(?:hero|variants)\//.test(key) || key.indexOf("/variants/") !== -1) return "";
    if (/\.(?:gif|svg)$/i.test(key)) return "";
    return key;
  }

  function objectKeyFromCoverUrl(value){
    const raw = String(value || "").trim();
    if (!raw || /[?#]/.test(raw)) return "";
    let url;
    try { url = new URL(raw, CANONICAL_ORIGIN); }
    catch (error) { return ""; }
    if (url.origin !== CANONICAL_ORIGIN && url.origin !== "https://kutadgubilik.com") return "";
    if (url.search || url.hash) return "";
    let path = url.pathname;
    try { path = decodeURIComponent(path); }
    catch (error) { return ""; }
    const marker = "/__r2/";
    const at = path.indexOf(marker);
    if (at < 0) return "";
    return deliverySourceKey(path.slice(at + marker.length));
  }

  function variantObjectKey(objectKey, width){
    const key = deliverySourceKey(objectKey);
    const target = Number(width);
    if (!key || WIDTHS.indexOf(target) < 0) return "";
    const rest = key.slice("book-covers/".length);
    if (!rest || rest.indexOf("..") !== -1) return "";
    const staff = rest.match(/^staff\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(.+)$/i);
    if (staff) return "book-covers/staff/" + staff[1] + "/variants/" + VERSION + "/w" + target + "/" + staff[2] + ".webp";
    if (rest.indexOf("staff/") === 0) return "";
    return "book-covers/variants/" + VERSION + "/w" + target + "/" + rest + ".webp";
  }

  function availabilityDocumentKey(objectKey){
    const key = deliverySourceKey(objectKey);
    if (!key) return "";
    const rest = key.slice("book-covers/".length);
    const staff = rest.match(/^staff\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(.+)$/i);
    if (staff) return "book-covers/staff/" + staff[1].toLowerCase() + "/variants/" + VERSION + "/availability.json";
    if (rest.indexOf("staff/") === 0) return "";
    return GLOBAL_AVAILABILITY_KEY;
  }

  function availabilityRequestUrl(docKey){
    const relative = "/__r2/" + String(docKey || "").split("/").map(function(part){ return encodeURIComponent(part); }).join("/");
    const origin = typeof location !== "undefined" && location && /^https?:$/i.test(String(location.protocol || "")) ? location.origin : "";
    return origin ? origin + relative : publicUrlForKey(docKey);
  }

  function publicUrlForKey(objectKey){
    const key = String(objectKey || "").replace(/^\/+/, "");
    if (!key || key.indexOf("..") !== -1 || key.indexOf("\\") !== -1 || !/^book-covers\/[A-Za-z0-9._/-]+$/.test(key)) return "";
    return CANONICAL_ORIGIN + "/__r2/" + key.split("/").map(encodeURIComponent).join("/");
  }

  function variantUrl(coverUrl, width){
    const key = objectKeyFromCoverUrl(coverUrl);
    const variant = variantObjectKey(key, width);
    if (!variant) return "";
    return CANONICAL_ORIGIN + "/__r2/" + variant.split("/").map(encodeURIComponent).join("/");
  }

  function eligibleWidths(sourceWidth){
    const width = Number(sourceWidth);
    if (!Number.isFinite(width) || width <= 0) return [];
    return WIDTHS.filter(function(target){ return target < width; });
  }

  function sanitizeRecord(sourceKey, record){
    const width = Number(record && record.width);
    const variants = Array.isArray(record && record.variants) ? record.variants : [];
    const clean = [];
    variants.forEach(function(item){
      const target = Number(item && item.width);
      if (WIDTHS.indexOf(target) < 0 || !(width > target) || item.key !== variantObjectKey(sourceKey, target)) return;
      clean.push({ width: target, height: Number(item.height) || 0, bytes: Number(item.bytes) || 0, key: item.key });
    });
    if (!clean.length || !Number.isFinite(width) || width <= 0) return null;
    return { width: width, height: Number(record.height) || 0, variants: clean };
  }

  function useAvailability(data){
    const sources = data && data.sources && typeof data.sources === "object" ? data.sources : {};
    published = { version: VERSION, sources: {} };
    appliedKeys.clear();
    Object.keys(sources).forEach(function(key){
      const clean = sanitizeRecord(key, sources[key]);
      if (clean) published.sources[key] = clean;
    });
    return published;
  }

  function mergeDocument(docKey, sources){
    const previous = appliedKeys.get(docKey) || new Set();
    previous.forEach(function(key){ delete published.sources[key]; });
    const next = new Set();
    Object.keys(sources || {}).forEach(function(key){
      if (availabilityDocumentKey(key) !== docKey) return;
      const clean = sanitizeRecord(key, sources[key]);
      if (!clean) return;
      published.sources[key] = clean;
      next.add(key);
    });
    appliedKeys.set(docKey, next);
  }

  function sourceRecord(coverUrl){
    const key = objectKeyFromCoverUrl(coverUrl);
    const record = key && published.sources ? published.sources[key] : null;
    return record && typeof record === "object" ? { key: key, record: record } : null;
  }

  function srcsetFor(coverUrl, sizes){
    const found = sourceRecord(coverUrl);
    if (!found) return "";
    const sourceWidth = Number(found.record.width);
    const variants = Array.isArray(found.record.variants) ? found.record.variants : [];
    const parts = variants.filter(function(item){
      const width = Number(item && item.width);
      return WIDTHS.indexOf(width) >= 0 && sourceWidth > width && item.key === variantObjectKey(found.key, width);
    }).map(function(item){
      return publicUrlForKey(item.key) + " " + Number(item.width) + "w";
    });
    const widest = variants.reduce(function(max, item){
      const width = Number(item && item.width);
      return width > max ? width : max;
    }, 0);
    if (String(sizes || "") === DETAIL_SIZES && sourceWidth > widest) parts.push(publicUrlForKey(found.key) + " " + sourceWidth + "w");
    return parts.join(", ");
  }

  function recordAvailable(sourceKey, sourceWidth, sourceHeight, variant){
    const key = deliverySourceKey(sourceKey);
    const width = Number(variant && variant.width);
    const expected = variantObjectKey(key, width);
    if (!key || !expected || expected !== String(variant && variant.key || "") || !(Number(sourceWidth) > width)) return false;
    const current = published.sources[key] && typeof published.sources[key] === "object" ? published.sources[key] : { variants: [] };
    const variants = (Array.isArray(current.variants) ? current.variants : []).filter(function(item){ return Number(item.width) !== width; });
    variants.push({ width: width, height: Number(variant.height) || 0, bytes: Number(variant.bytes) || 0, key: expected });
    published.sources[key] = { width: Number(sourceWidth), height: Number(sourceHeight) || 0, variants: variants };
    return true;
  }

  function deliveryAttributes(coverUrl, sizes){
    const set = srcsetFor(coverUrl, sizes);
    if (!set) return "";
    const chosen = String(sizes || CARD_SIZES);
    return ' srcset="' + set.replace(/"/g, "") + '" sizes="' + chosen.replace(/"/g, "") + '"';
  }

  function canvasHasTransparency(ctx, width, height){
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let i = 3; i < data.length; i += 16) {
      if (data[i] < 250) return true;
    }
    return false;
  }

  async function webpKeepsTransparency(blob){
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d", { alpha: true });
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0);
      return canvasHasTransparency(ctx, canvas.width, canvas.height);
    } finally {
      if (bitmap.close) bitmap.close();
    }
  }

  function isAnimatedImage(bytes, type){
    const mime = String(type || "").toLowerCase();
    if (mime === "image/gif" || mime === "image/svg+xml") return true;
    const list = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (list.length >= 6 && list[0] === 0x47 && list[1] === 0x49 && list[2] === 0x46) return true;
    let text = "";
    const limit = Math.min(list.length, 512000);
    for (let i = 0; i < limit; i++) text += String.fromCharCode(list[i]);
    if (text.indexOf("WEBP") >= 0 && (text.indexOf("ANIM") >= 0 || text.indexOf("ANMF") >= 0)) return true;
    if (list.length >= 8 && list[0] === 0x89 && list[1] === 0x50 && text.indexOf("acTL") >= 0) return true;
    return false;
  }

  async function encodeDeliveryVariants(source){
    if (!source || typeof document === "undefined" || typeof createImageBitmap !== "function") return [];
    const type = String(source.type || "").toLowerCase();
    if (type === "image/gif" || type === "image/svg+xml") return [];
    if (typeof source.arrayBuffer === "function") {
      try {
        if (isAnimatedImage(new Uint8Array(await source.arrayBuffer()), type)) return [];
      } catch (error) { return []; }
    }
    let bitmap;
    try { bitmap = await createImageBitmap(source); }
    catch (error) { return []; }
    try {
      if (!bitmap.width || !bitmap.height) return [];
      const probe = document.createElement("canvas");
      probe.width = bitmap.width;
      probe.height = bitmap.height;
      const probeCtx = probe.getContext("2d", { alpha: true });
      probeCtx.clearRect(0, 0, probe.width, probe.height);
      probeCtx.drawImage(bitmap, 0, 0);
      const transparent = canvasHasTransparency(probeCtx, probe.width, probe.height);
      const variants = [];
      const targets = eligibleWidths(bitmap.width);
      for (let i = 0; i < targets.length; i++) {
        const width = targets[i];
        const height = Math.max(1, Math.round(bitmap.height * (width / bitmap.width)));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { alpha: true });
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(bitmap, 0, 0, width, height);
        const blob = await new Promise(function(resolve){ canvas.toBlob(resolve, "image/webp", WEBP_QUALITY); });
        if (!blob || blob.size < 1) continue;
        if (transparent) {
          let kept = false;
          try { kept = await webpKeepsTransparency(blob); }
          catch (error) { kept = false; }
          if (!kept) continue;
        }
        variants.push({ width: width, height: height, sourceWidth: bitmap.width, sourceHeight: bitmap.height, type: "image/webp", body: await blob.arrayBuffer(), bytes: blob.size });
      }
      return variants;
    } finally {
      if (bitmap && bitmap.close) bitmap.close();
    }
  }

  function promiseTimeout(work, limit){
    return new Promise(function(resolve, reject){
      let timer = setTimeout(function(){ reject(new Error("availability-timeout")); }, limit);
      Promise.resolve(work).then(function(value){
        clearTimeout(timer);
        resolve(value);
      }, function(error){
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  async function readBucketAvailability(bucket, docKey){
    if (!bucket || typeof bucket.get !== "function") throw new Error("availability-unreadable");
    const object = await bucket.get(docKey);
    if (!object) return { sources: {}, etag: "" };
    let text = "";
    if (typeof object.text === "function") text = await object.text();
    else if (typeof object.body === "string") text = object.body;
    else if (object.body) text = Buffer.from(object.body).toString("utf8");
    const parsed = JSON.parse(text || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("availability-malformed");
    if (parsed.sources != null && (typeof parsed.sources !== "object" || Array.isArray(parsed.sources))) throw new Error("availability-malformed");
    const sources = parsed.sources && typeof parsed.sources === "object" ? parsed.sources : {};
    return { sources: sources, etag: String(object.etag || object.httpEtag || "") };
  }

  async function publishStoredAvailability(bucket, input){
    const sourceKey = deliverySourceKey(input && input.sourceKey);
    const variantKey = String(input && input.variantKey || "");
    const width = WIDTHS.find(function(target){ return variantObjectKey(sourceKey, target) === variantKey; }) || 0;
    const sourceWidth = Number(input && input.sourceWidth);
    const sourceHeight = Number(input && input.sourceHeight) || 0;
    const docKey = availabilityDocumentKey(sourceKey);
    if (!bucket || typeof bucket.put !== "function" || !sourceKey || !width || !(sourceWidth > width) || !docKey) return { published: false };
    const budget = Number(input && input.budgetMs);
    const limit = Number.isFinite(budget) && budget >= 0 ? budget : 2000;
    const deadline = Date.now() + limit;
    const variant = { width: width, height: Number(input && input.variantHeight) || 0, bytes: Number(input && input.bytes) || 0, key: variantKey };
    let failures = 0;
    while (Date.now() <= deadline) {
      try {
        const remaining = Math.max(1, deadline - Date.now());
        const current = await promiseTimeout(readBucketAvailability(bucket, docKey), remaining);
        const sources = Object.assign({}, current.sources);
        const existing = sources[sourceKey] && typeof sources[sourceKey] === "object" ? sources[sourceKey] : { variants: [] };
        const variants = (Array.isArray(existing.variants) ? existing.variants : []).filter(function(item){ return Number(item.width) !== width; });
        variants.push(variant);
        sources[sourceKey] = { width: sourceWidth, height: sourceHeight || Number(existing.height) || 0, variants: variants };
        const body = JSON.stringify({ version: VERSION, sources: sources });
        const options = { httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: AVAILABILITY_CACHE_CONTROL } };
        options.onlyIf = current.etag ? { etagMatches: current.etag } : { etagDoesNotMatch: "*" };
        const stored = await promiseTimeout(bucket.put(docKey, body, options), Math.max(1, deadline - Date.now()));
        if (stored == null) {
          await new Promise(function(resolve){ setTimeout(resolve, 5); });
          continue;
        }
        return { published: true, key: docKey };
      } catch (error) {
        failures += 1;
        if (failures >= 2 || Date.now() >= deadline) break;
      }
    }
    return { published: false, key: docKey };
  }

  async function loadAvailabilityDocument(docKey, options){
    const opts = options || {};
    if (opts.bucket) {
      const loaded = await readBucketAvailability(opts.bucket, docKey);
      return loaded.sources;
    }
    const fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (typeof fetchImpl !== "function") throw new Error("availability-unreadable");
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(function(){ controller.abort(); }, 1500) : 0;
    try {
      const response = await fetchImpl(availabilityRequestUrl(docKey), controller ? { signal: controller.signal } : {});
      if (response && response.status === 404) return {};
      if (!response || !response.ok || typeof response.json !== "function") throw new Error("availability-unreadable");
      const payload = await response.json();
      return payload && payload.sources && typeof payload.sources === "object" ? payload.sources : {};
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function readPublishedAvailability(options){
    const opts = options || {};
    const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
    const requestedBudget = Number(opts.readBudgetMs);
    const budget = Number.isFinite(requestedBudget) && requestedBudget >= 0 ? requestedBudget : AVAILABILITY_READ_BUDGET_MS;
    const deadline = Date.now() + budget;
    const docKeys = [GLOBAL_AVAILABILITY_KEY];
    const urls = [];
    if (opts.sourceUrl) urls.push(opts.sourceUrl);
    if (Array.isArray(opts.sourceUrls)) urls.push.apply(urls, opts.sourceUrls);
    urls.forEach(function(url){
      const doc = availabilityDocumentKey(objectKeyFromCoverUrl(url));
      if (doc && docKeys.indexOf(doc) < 0) docKeys.push(doc);
    });
    const direct = availabilityDocumentKey(opts.sourceKey);
    if (direct && docKeys.indexOf(direct) < 0) docKeys.push(direct);
    for (let i = 0; i < docKeys.length; i++) {
      const docKey = docKeys[i];
      const hit = availabilityCache.get(docKey);
      if (hit && now - hit.at < AVAILABILITY_CACHE_MS) {
        mergeDocument(docKey, hit.sources);
        continue;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        if (hit) mergeDocument(docKey, hit.sources);
        continue;
      }
      try {
        const sources = await promiseTimeout(loadAvailabilityDocument(docKey, opts), remaining);
        availabilityCache.set(docKey, { at: now, sources: sources });
        mergeDocument(docKey, sources);
      } catch (error) {
        if (hit) mergeDocument(docKey, hit.sources);
      }
    }
    return published;
  }

  function resetAvailabilityMemory(){
    published = { version: VERSION, sources: {} };
    availabilityCache.clear();
    appliedKeys.clear();
  }

  function refreshVisibleCovers(){
    if (typeof document === "undefined") return;
    document.querySelectorAll("img[data-cover-src]").forEach(function(img){
      if (img.closest && img.closest(".cover-zoom-overlay")) return;
      if (img.getAttribute("srcset")) return;
      const url = img.getAttribute("data-cover-src") || "";
      const sizes = img.closest && img.closest(".book-cover-box") ? DETAIL_SIZES : (img.getAttribute("sizes") || CARD_SIZES);
      const set = srcsetFor(url, sizes);
      if (!set) return;
      img.setAttribute("srcset", set);
      if (!img.getAttribute("sizes")) img.setAttribute("sizes", sizes);
    });
  }

  function installBrowserAvailability(){
    if (typeof document === "undefined" || typeof fetch !== "function") return;
    let pending = 0;
    const scan = function(){
      const urls = [];
      document.querySelectorAll("img[data-cover-src]").forEach(function(img){ urls.push(img.getAttribute("data-cover-src") || ""); });
      pending += 1;
      const token = pending;
      readPublishedAvailability({ fetchImpl: fetch, sourceUrls: urls, now: Date.now() }).then(function(){
        if (token === pending) refreshVisibleCovers();
      }, function(){});
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan);
    else scan();
    if (typeof MutationObserver === "function" && document.documentElement) {
      let timer = 0;
      const observer = new MutationObserver(function(){
        clearTimeout(timer);
        timer = setTimeout(scan, 50);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-cover-src"] });
    }
  }

  function planDelivery(entry){
    const source = entry && typeof entry === "object" ? entry : {};
    const key = deliverySourceKey(source.key) || objectKeyFromCoverUrl(source.url);
    const reason = !key ? "ineligible" : "";
    const knownWidth = Number(source.width);
    const widths = reason ? [] : eligibleWidths(Number.isFinite(knownWidth) && knownWidth > 0 ? knownWidth : 0);
    return {
      sourceKey: key,
      sourceUrl: String(source.url || ""),
      widths: widths,
      variants: widths.map(function(width){
        return { width: width, key: variantObjectKey(key, width), url: variantUrl(source.url || (CANONICAL_ORIGIN + "/__r2/" + key), width) };
      }),
      skip: reason || (!Number.isFinite(knownWidth) || knownWidth <= 0 ? "dimensions-unknown" : (!widths.length ? "not-larger-than-variant" : ""))
    };
  }

  const host = typeof globalThis !== "undefined" ? globalThis : {};
  if (host.KutadguCoverAvailability) useAvailability(host.KutadguCoverAvailability);
  installBrowserAvailability();
  return {
    CANONICAL_ORIGIN: CANONICAL_ORIGIN,
    VERSION: VERSION,
    WIDTHS: WIDTHS,
    WEBP_QUALITY: WEBP_QUALITY,
    CARD_SIZES: CARD_SIZES,
    DETAIL_SIZES: DETAIL_SIZES,
    THUMB_SIZES: THUMB_SIZES,
    CART_SIZES: CART_SIZES,
    AVAILABILITY_CACHE_MS: AVAILABILITY_CACHE_MS,
    AVAILABILITY_READ_BUDGET_MS: AVAILABILITY_READ_BUDGET_MS,
    AVAILABILITY_CACHE_CONTROL: AVAILABILITY_CACHE_CONTROL,
    GLOBAL_AVAILABILITY_KEY: GLOBAL_AVAILABILITY_KEY,
    deliverySourceKey: deliverySourceKey,
    availabilityDocumentKey: availabilityDocumentKey,
    objectKeyFromCoverUrl: objectKeyFromCoverUrl,
    variantObjectKey: variantObjectKey,
    variantUrl: variantUrl,
    publicUrlForKey: publicUrlForKey,
    availabilityRequestUrl: availabilityRequestUrl,
    eligibleWidths: eligibleWidths,
    useAvailability: useAvailability,
    recordAvailable: recordAvailable,
    publishStoredAvailability: publishStoredAvailability,
    readPublishedAvailability: readPublishedAvailability,
    resetAvailabilityMemory: resetAvailabilityMemory,
    isAnimatedImage: isAnimatedImage,
    srcsetFor: srcsetFor,
    deliveryAttributes: deliveryAttributes,
    encodeDeliveryVariants: encodeDeliveryVariants,
    planDelivery: planDelivery
  };
});
