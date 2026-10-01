(function (root) {
  "use strict";

  const SUPABASE_ORIGIN = "https://fxlojnqwyojqjskfggmh.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_lqxWeLH9m7hGbPMUfVY0pA_bdcK-PzE";
  const PUBLIC_OBJECT_PREFIX = SUPABASE_ORIGIN + "/storage/v1/object/public/";
  const COVER_BUCKET = "book-covers";

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
    futurePublicUrl
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.KutadguImageStorage = api;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : {});
