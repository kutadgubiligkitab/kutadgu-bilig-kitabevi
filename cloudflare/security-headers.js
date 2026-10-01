"use strict";

const SUPABASE_ORIGIN = "https://fxlojnqwyojqjskfggmh.supabase.co";

const PRODUCTION_CSP_REPORT_ONLY = "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' https://fxlojnqwyojqjskfggmh.supabase.co blob: data:; font-src 'self'; connect-src 'self' https://fxlojnqwyojqjskfggmh.supabase.co; frame-src 'none'; worker-src 'none'; media-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

const ENFORCED_CSP = "frame-ancestors 'none'";

const BASE_SECURITY = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": ENFORCED_CSP
});

const NO_STORE = "no-store, must-revalidate";
const STOREFRONT_CODE = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
const LONG_ASSET = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

const CACHE_RULES = Object.freeze([
  { exact: "/admin.html", value: NO_STORE },
  { exact: "/book-staff.html", value: NO_STORE },
  { exact: "/book-staff.js", value: NO_STORE },
  { exact: "/admin-idle.js", value: NO_STORE },
  { exact: "/admin-hero.js", value: NO_STORE },
  { exact: "/admin-shop-hours.js", value: NO_STORE },
  { exact: "/admin-book-write.js", value: NO_STORE },
  { exact: "/admin-book-quality.js", value: NO_STORE },
  { ext: /(?:png|jpg|jpeg|webp|gif|svg|ttf|woff|woff2)$/i, value: LONG_ASSET },
  { exact: "/kutadgu-maintenance.js", value: NO_STORE },
  { exact: "/kutadgu-announcements.js", value: NO_STORE },
  { ext: /(?:css|js)$/i, value: STOREFRONT_CODE },
  { exact: "/admin.js", value: NO_STORE },
  { exact: "/catalog-bibliography.js", value: NO_STORE },
  { exact: "/supabase-config.js", value: NO_STORE }
]);

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
  if (!url.hostname || url.hostname === "localhost") return "";
  return url.origin;
}

function r2PublicOrigin(env) {
  const source = env || {};
  const origin = httpsOrigin(source.KUTADGU_R2_PUBLIC_BASE_URL || source.R2_PUBLIC_BASE_URL || "");
  if (!origin || origin === SUPABASE_ORIGIN) return "";
  return origin;
}

function cspReportOnly(env) {
  const extra = r2PublicOrigin(env);
  if (!extra) return PRODUCTION_CSP_REPORT_ONLY;
  return PRODUCTION_CSP_REPORT_ONLY.replace(
    "img-src 'self' " + SUPABASE_ORIGIN + " blob: data:",
    "img-src 'self' " + SUPABASE_ORIGIN + " " + extra + " blob: data:"
  );
}

function securityHeaders(env) {
  return {
    "X-Content-Type-Options": BASE_SECURITY["X-Content-Type-Options"],
    "Referrer-Policy": BASE_SECURITY["Referrer-Policy"],
    "Permissions-Policy": BASE_SECURITY["Permissions-Policy"],
    "X-Frame-Options": BASE_SECURITY["X-Frame-Options"],
    "Content-Security-Policy": ENFORCED_CSP,
    "Content-Security-Policy-Report-Only": cspReportOnly(env)
  };
}

function cacheControlForPath(pathname) {
  const path = String(pathname || "").split("?")[0];
  let value = "";
  CACHE_RULES.forEach((rule) => {
    if (rule.exact && path === rule.exact) value = rule.value;
    else if (rule.ext && rule.ext.test(path)) value = rule.value;
  });
  return value;
}

function applySecurity(headers, env) {
  const security = securityHeaders(env);
  Object.keys(security).forEach((key) => headers.set(key, security[key]));
  return headers;
}

module.exports = {
  SUPABASE_ORIGIN,
  PRODUCTION_CSP_REPORT_ONLY,
  ENFORCED_CSP,
  NO_STORE,
  STOREFRONT_CODE,
  LONG_ASSET,
  httpsOrigin,
  r2PublicOrigin,
  cspReportOnly,
  securityHeaders,
  cacheControlForPath,
  applySecurity
};
