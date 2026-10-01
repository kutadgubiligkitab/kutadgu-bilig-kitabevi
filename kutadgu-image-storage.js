(function (root) {
  "use strict";

  const SUPABASE_ORIGIN = "https://fxlojnqwyojqjskfggmh.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_lqxWeLH9m7hGbPMUfVY0pA_bdcK-PzE";
  const PUBLIC_OBJECT_PREFIX = SUPABASE_ORIGIN + "/storage/v1/object/public/";
  const COVER_BUCKET = "book-covers";
  const PRIVATE_READ_PREFIX = "/__r2/";
  const BLOCKED_PREVIEW_HOSTS = Object.freeze([
    "kutadgubilik.com",
    "www.kutadgubilik.com",
    "kutadgu-bilig-kitab.vercel.app"
  ]);
  const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

  function httpsOrigin(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    let url;
    try {
      url = new URL(raw);
    } catch (err) {
      return "";
    }
    if (url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    if (!url.hostname) return "";
    return url.origin;
  }

  function browserConfig() {
    if (typeof window === "undefined" || !window.KUTADGU_IMAGE_STORAGE) return {};
    return window.KUTADGU_IMAGE_STORAGE;
  }

  function publicImageConfig(source) {
    const src = source && typeof source === "object" ? source : browserConfig();
    return {
      supabaseOrigin: SUPABASE_ORIGIN,
      r2PublicBase: httpsOrigin(src.r2PublicBase || src.publicBase || "")
    };
  }

  function isSafeImageUrl(raw) {
    const api = root && root.KutadguSafeUrl;
    if (api && typeof api.isSafeCoverUrl === "function") return api.isSafeCoverUrl(raw);
    const t = String(raw || "").trim();
    if (!t) return false;
    if (/^(?:javascript|data|vbscript|file|blob)\s*:/i.test(t)) return false;
    if (/[<>"'\s]/.test(t)) return false;
    if (t.indexOf("//") === 0) return false;
    if (/^https?:\/\//i.test(t)) return true;
    if (t.charAt(0) === "/") return true;
    if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return false;
    return true;
  }

  function classifyImageUrl(raw, source) {
    const config = publicImageConfig(source);
    const text = String(raw == null ? "" : raw).trim();
    if (!text) return { kind: "empty", href: "", host: "" };
    if (!isSafeImageUrl(text)) return { kind: "unsafe", href: "", host: "" };
    if (text.charAt(0) === "/" && text.charAt(1) !== "/") {
      return { kind: "site", href: text, host: "" };
    }
    if (!/^https:\/\//i.test(text)) {
      return { kind: "other", href: text, host: "" };
    }
    let url;
    try {
      url = new URL(text);
    } catch (err) {
      return { kind: "unsafe", href: "", host: "" };
    }
    if (url.origin === config.supabaseOrigin) {
      return { kind: "supabase", href: text, host: url.host };
    }
    if (config.r2PublicBase && url.origin === config.r2PublicBase) {
      return { kind: "r2", href: text, host: url.host };
    }
    return { kind: "https", href: text, host: url.host };
  }

  function isAcceptedImageUrl(raw, source) {
    const kind = classifyImageUrl(raw, source).kind;
    return kind === "supabase" || kind === "r2" || kind === "site" || kind === "https" || kind === "other";
  }

  function displayImageUrl(raw, source) {
    const found = classifyImageUrl(raw, source);
    if (!isAcceptedImageUrl(raw, source)) return "";
    return found.href;
  }

  function supabaseObjectKey(raw) {
    const found = classifyImageUrl(raw, { r2PublicBase: "" });
    if (found.kind !== "supabase") return "";
    let url;
    try {
      url = new URL(found.href);
    } catch (err) {
      return "";
    }
    if (!url.pathname.startsWith("/storage/v1/object/public/")) return "";
    const key = decodeURIComponent(url.pathname.slice("/storage/v1/object/public/".length));
    if (!key || key.indexOf("..") !== -1 || key.charAt(0) === "/") return "";
    if (key.indexOf(COVER_BUCKET + "/") !== 0) return "";
    return key;
  }

  function futurePublicUrl(key, source) {
    const config = publicImageConfig(source);
    const objectKey = String(key || "").replace(/^\/+/, "");
    if (!config.r2PublicBase || !objectKey || objectKey.indexOf("..") !== -1) return "";
    return config.r2PublicBase + "/" + objectKey.split("/").map(encodeURIComponent).join("/");
  }

  function normalizeHost(hostname) {
    return String(hostname || "")
      .toLowerCase()
      .replace(/\.$/, "")
      .replace(/^\[|\]$/g, "");
  }

  function isBlockedPreviewHost(hostname) {
    return BLOCKED_PREVIEW_HOSTS.indexOf(normalizeHost(hostname)) !== -1;
  }

  function previewHostAllowsRead(hostname) {
    const host = normalizeHost(hostname);
    if (!host || isBlockedPreviewHost(host)) return false;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    return host.endsWith(".workers.dev");
  }

  function previewReadEnabled(source) {
    const src = source && typeof source === "object" ? source : browserConfig();
    const flag = src.r2ReadEnabled != null ? src.r2ReadEnabled : src.KUTADGU_R2_READ_ENABLED;
    return String(flag) === "true";
  }

  function isStaffPath(pathname) {
    const path = String(pathname || "");
    return path === "/admin" || path === "/admin.html" || path === "/book-staff" || path === "/book-staff.html";
  }

  function coverObjectKey(key) {
    const value = String(key || "");
    if (!value || value.length > 512) return "";
    if (value.indexOf("\\") !== -1 || value.indexOf("\0") !== -1 || value.indexOf("..") !== -1) return "";
    if (value.indexOf("%") !== -1 || value.charAt(0) === "/" || value.charAt(0) === ".") return "";
    const parts = value.split("/");
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      if (!part || part === "." || part === ".." || part.charAt(0) === ".") return "";
    }
    if (!/^book-covers\/[A-Za-z0-9._/-]+$/.test(value)) return "";
    return value;
  }

  function privateObjectKeyFromPath(pathname) {
    const path = String(pathname || "");
    if (path.indexOf("\\") !== -1 || path.indexOf("\0") !== -1) return "";
    if (path !== "/__r2" && path.indexOf(PRIVATE_READ_PREFIX) !== 0) return "";
    if (path === "/__r2" || path === PRIVATE_READ_PREFIX || path.charAt(path.length - 1) === "/") return "";
    const raw = path.slice(PRIVATE_READ_PREFIX.length);
    let decoded;
    try {
      decoded = decodeURIComponent(raw);
    } catch (err) {
      return "";
    }
    return coverObjectKey(decoded);
  }

  function privateReadPath(key) {
    const safe = coverObjectKey(key);
    if (!safe) return "";
    return PRIVATE_READ_PREFIX + safe.split("/").map(encodeURIComponent).join("/");
  }

  function safePreviewOrigin(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    let url;
    try {
      url = new URL(raw);
    } catch (err) {
      return "";
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.username || url.password) return "";
    if (!previewHostAllowsRead(url.hostname)) return "";
    return url.origin;
  }

  function previewImageUrl(raw, source) {
    const found = displayImageUrl(raw, source);
    if (!found) return "";
    const src = source && typeof source === "object" ? source : {};
    if (!previewReadEnabled(src) || !previewHostAllowsRead(src.hostname)) return found;
    const key = coverObjectKey(supabaseObjectKey(raw));
    if (!key) return found;
    const path = privateReadPath(key);
    const origin = safePreviewOrigin(src.origin);
    return origin ? origin + path : path;
  }

  function escapeAttr(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function rewriteImgTag(tag, source) {
    let origin = "";
    const next = tag.replace(/\s(src|data-cover-src)\s*=\s*("([^"]*)"|'([^']*)')/gi, (full, attr, quoted, dq, sq) => {
      const value = dq != null ? dq : sq;
      const mapped = previewImageUrl(value, source);
      if (!mapped || mapped === value) return full;
      if (!origin) origin = value;
      const quote = dq != null ? '"' : "'";
      return " " + attr + "=" + quote + mapped + quote;
    });
    if (!origin || /data-kutadgu-cover-origin\s*=/i.test(next)) return next;
    return next.replace(/<img\b/i, '<img data-kutadgu-cover-origin="' + escapeAttr(origin) + '"');
  }

  function rewritePreviewHtmlImages(html, source) {
    const src = source && typeof source === "object" ? source : {};
    const text = String(html || "");
    if (!previewReadEnabled(src) || !previewHostAllowsRead(src.hostname) || isStaffPath(src.pathname)) return text;
    return text.replace(/<img\b[^>]*>/gi, (tag) => rewriteImgTag(tag, src));
  }

  function injectPreviewBoot(html, source) {
    const src = source && typeof source === "object" ? source : {};
    const text = String(html || "");
    if (!previewReadEnabled(src) || !previewHostAllowsRead(src.hostname) || isStaffPath(src.pathname)) return text;
    if (text.indexOf("kutadgu-preview-r2-images.js") !== -1) return text;
    const boot = '<meta name="kutadgu-r2-read" content="preview"><script src="/kutadgu-image-storage.js"></script><script src="/kutadgu-preview-r2-images.js"></script>';
    if (/<head\b[^>]*>/i.test(text)) return text.replace(/<head\b[^>]*>/i, (open) => open + boot);
    return boot + text;
  }

  function previewFallbackTarget(state) {
    const current = state && typeof state === "object" ? state : {};
    const src = String(current.src || "");
    const origin = String(current.origin || "");
    const fallback = String(current.fallback || "");
    if (fallback === "1" || !origin || origin === src || src.indexOf("/__r2/") === -1) {
      return { action: "ignore" };
    }
    return { action: "fallback", src: origin, fallback: "1" };
  }

  function installPreviewCoverBridge(doc, source) {
    const src = source && typeof source === "object" ? source : {};
    if (!doc || !previewReadEnabled(src) || !previewHostAllowsRead(src.hostname)) return false;
    const pathName = src.pathname || (doc.location && doc.location.pathname) || "";
    if (isStaffPath(pathName)) return false;
    const rootEl = doc.documentElement;
    if (!rootEl || typeof rootEl.getAttribute !== "function") return false;
    if (rootEl.getAttribute("data-kutadgu-r2-read") === "1") return true;
    rootEl.setAttribute("data-kutadgu-r2-read", "1");
    const originAttr = "data-kutadgu-cover-origin";
    const fallbackAttr = "data-kutadgu-r2-fallback";
    let rewriting = false;

    function applyValue(img, value) {
      if (!img || img.getAttribute(fallbackAttr) === "1") return value;
      const next = previewImageUrl(value, src);
      if (!next || next === value) return value;
      if (!img.getAttribute(originAttr)) img.setAttribute(originAttr, value);
      if (img.getAttribute("data-cover-src") === value) img.setAttribute("data-cover-src", next);
      return next;
    }

    function applyElement(img) {
      if (!img || String(img.tagName || "").toUpperCase() !== "IMG") return;
      const current = img.getAttribute("src") || "";
      const next = applyValue(img, current);
      if (next === current) return;
      rewriting = true;
      img.setAttribute("src", next);
      rewriting = false;
    }

    const elementProto = root.Element && root.Element.prototype;
    const innerHtml = elementProto && Object.getOwnPropertyDescriptor(elementProto, "innerHTML");
    if (innerHtml && innerHtml.set && innerHtml.get && !elementProto.kutadguPreviewHtmlHook) {
      try {
        Object.defineProperty(elementProto, "innerHTML", {
          configurable: true,
          enumerable: innerHtml.enumerable,
          get() { return innerHtml.get.call(this); },
          set(value) {
            const next = rewriting ? value : rewritePreviewHtmlImages(value, src);
            rewriting = true;
            innerHtml.set.call(this, next);
            rewriting = false;
          }
        });
        const insertHtml = elementProto.insertAdjacentHTML;
        if (typeof insertHtml === "function") {
          elementProto.insertAdjacentHTML = function (position, html) {
            const next = rewriting ? html : rewritePreviewHtmlImages(html, src);
            return insertHtml.call(this, position, next);
          };
        }
        Object.defineProperty(elementProto, "kutadguPreviewHtmlHook", { value: true });
      } catch (err) {
        rewriting = false;
      }
    }

    const imageProto = root.HTMLImageElement && root.HTMLImageElement.prototype;
    const desc = imageProto && Object.getOwnPropertyDescriptor(imageProto, "src");
    if (desc && desc.set && desc.get && !imageProto.kutadguPreviewSrcHook) {
      try {
        Object.defineProperty(imageProto, "src", {
          configurable: true,
          enumerable: desc.enumerable,
          get() { return desc.get.call(this); },
          set(value) {
            const next = rewriting ? value : applyValue(this, value);
            rewriting = true;
            desc.set.call(this, next);
            rewriting = false;
          }
        });
        Object.defineProperty(imageProto, "kutadguPreviewSrcHook", { value: true });
      } catch (err) {
        rewriting = false;
      }
    }

    doc.addEventListener("error", (event) => {
      const img = event && event.target;
      if (!img || String(img.tagName || "").toUpperCase() !== "IMG") return;
      const decision = previewFallbackTarget({
        src: img.getAttribute("src") || "",
        origin: img.getAttribute(originAttr) || "",
        fallback: img.getAttribute(fallbackAttr) || ""
      });
      if (decision.action !== "fallback") return;
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      img.setAttribute(fallbackAttr, "1");
      if (img.getAttribute("data-cover-src")) img.setAttribute("data-cover-src", decision.src);
      rewriting = true;
      img.setAttribute("src", decision.src);
      rewriting = false;
    }, true);

    if (typeof root.MutationObserver === "function") {
      const observer = new root.MutationObserver((records) => {
        if (rewriting) return;
        (records || []).forEach((record) => {
          if (record.type === "attributes") applyElement(record.target);
          const added = record.addedNodes || [];
          for (let i = 0; i < added.length; i += 1) {
            const node = added[i];
            if (!node || node.nodeType !== 1) continue;
            if (String(node.tagName || "").toUpperCase() === "IMG") applyElement(node);
            if (typeof node.querySelectorAll === "function") {
              const nested = node.querySelectorAll("img");
              for (let j = 0; j < nested.length; j += 1) applyElement(nested[j]);
            }
          }
        });
      });
      observer.observe(rootEl, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["src"]
      });
    }
    if (typeof doc.querySelectorAll === "function") {
      const existing = doc.querySelectorAll("img");
      for (let i = 0; i < existing.length; i += 1) applyElement(existing[i]);
    }
    return true;
  }

  const api = {
    SUPABASE_ORIGIN,
    SUPABASE_PUBLISHABLE_KEY,
    PUBLIC_OBJECT_PREFIX,
    COVER_BUCKET,
    httpsOrigin,
    publicImageConfig,
    classifyImageUrl,
    isAcceptedImageUrl,
    displayImageUrl,
    supabaseObjectKey,
    futurePublicUrl,
    BLOCKED_PREVIEW_HOSTS,
    PRIVATE_READ_PREFIX,
    IMMUTABLE_CACHE,
    isBlockedPreviewHost,
    previewHostAllowsRead,
    previewReadEnabled,
    isStaffPath,
    coverObjectKey,
    privateObjectKeyFromPath,
    privateReadPath,
    previewImageUrl,
    rewritePreviewHtmlImages,
    injectPreviewBoot,
    previewFallbackTarget,
    installPreviewCoverBridge
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.KutadguImageStorage = api;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : {});
