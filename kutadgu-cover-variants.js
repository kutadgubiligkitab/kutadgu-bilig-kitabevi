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

  function deliverySourceKey(objectKey){
    const key = String(objectKey || "").replace(/^\/+/, "");
    if (!key || key.length > 420 || key.indexOf("..") !== -1 || key.indexOf("\\") !== -1 || key.indexOf("%") !== -1) return "";
    if (!/^book-covers\/[A-Za-z0-9._/-]+$/.test(key)) return "";
    if (/^book-covers\/(?:hero|variants)\//.test(key)) return "";
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
    const rest = key.slice("book-covers/".length).replace(/\.[A-Za-z0-9]+$/, "");
    if (!rest || rest.indexOf("..") !== -1) return "";
    return "book-covers/variants/" + VERSION + "/w" + target + "/" + rest + ".webp";
  }

  function variantUrl(coverUrl, width){
    const key = objectKeyFromCoverUrl(coverUrl);
    const variant = variantObjectKey(key, width);
    if (!variant) return "";
    return CANONICAL_ORIGIN + "/__r2/" + variant.split("/").map(encodeURIComponent).join("/");
  }

  function eligibleWidths(sourceWidth){
    const width = Number(sourceWidth);
    if (!Number.isFinite(width) || width <= 0) return WIDTHS.slice();
    return WIDTHS.filter(function(target){ return target < width; });
  }

  function srcsetFor(coverUrl){
    const key = objectKeyFromCoverUrl(coverUrl);
    if (!key) return "";
    return WIDTHS.map(function(width){
      return variantUrl(coverUrl, width) + " " + width + "w";
    }).join(", ");
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

  async function encodeDeliveryVariants(source){
    if (!source || typeof document === "undefined" || typeof createImageBitmap !== "function") return [];
    const type = String(source.type || "").toLowerCase();
    if (type === "image/gif" || type === "image/svg+xml") return [];
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
        variants.push({ width: width, height: height, type: "image/webp", body: await blob.arrayBuffer(), bytes: blob.size });
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
      skip: reason || (Number.isFinite(knownWidth) && knownWidth > 0 && !widths.length ? "not-larger-than-variant" : "")
    };
  }

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
    eligibleWidths: eligibleWidths,
    srcsetFor: srcsetFor,
    deliveryAttributes: deliveryAttributes,
    encodeDeliveryVariants: encodeDeliveryVariants,
    planDelivery: planDelivery
  };
});
