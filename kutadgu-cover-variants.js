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

  let published = { version: VERSION, sources: {} };

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

  function useAvailability(data){
    const sources = data && data.sources && typeof data.sources === "object" ? data.sources : {};
    published = { version: VERSION, sources: sources };
    return published;
  }

  function sourceRecord(coverUrl){
    const key = objectKeyFromCoverUrl(coverUrl);
    const record = key && published.sources ? published.sources[key] : null;
    return record && typeof record === "object" ? { key: key, record: record } : null;
  }

  function srcsetFor(coverUrl){
    const found = sourceRecord(coverUrl);
    if (!found) return "";
    const sourceWidth = Number(found.record.width);
    const variants = Array.isArray(found.record.variants) ? found.record.variants : [];
    return variants.filter(function(item){
      const width = Number(item && item.width);
      return WIDTHS.indexOf(width) >= 0 && sourceWidth > width && item.key === variantObjectKey(found.key, width);
    }).map(function(item){
      return publicUrlForKey(item.key) + " " + Number(item.width) + "w";
    }).join(", ");
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
    const set = srcsetFor(coverUrl);
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
  return {
    CANONICAL_ORIGIN: CANONICAL_ORIGIN,
    VERSION: VERSION,
    WIDTHS: WIDTHS,
    WEBP_QUALITY: WEBP_QUALITY,
    CARD_SIZES: CARD_SIZES,
    DETAIL_SIZES: DETAIL_SIZES,
    THUMB_SIZES: THUMB_SIZES,
    CART_SIZES: CART_SIZES,
    deliverySourceKey: deliverySourceKey,
    objectKeyFromCoverUrl: objectKeyFromCoverUrl,
    variantObjectKey: variantObjectKey,
    variantUrl: variantUrl,
    publicUrlForKey: publicUrlForKey,
    eligibleWidths: eligibleWidths,
    useAvailability: useAvailability,
    recordAvailable: recordAvailable,
    isAnimatedImage: isAnimatedImage,
    srcsetFor: srcsetFor,
    deliveryAttributes: deliveryAttributes,
    encodeDeliveryVariants: encodeDeliveryVariants,
    planDelivery: planDelivery
  };
});
