(function (root) {
  "use strict";

  var images = root.KutadguImageStorage;
  if (!images || typeof images.installPreviewCoverBridge !== "function") return;
  if (typeof document === "undefined" || !root.location) return;
  var meta = document.querySelector('meta[name="kutadgu-r2-read"]');
  if (!meta || meta.getAttribute("content") !== "preview") return;
  images.installPreviewCoverBridge(document, {
    r2ReadEnabled: true,
    hostname: root.location.hostname,
    origin: root.location.origin,
    pathname: root.location.pathname
  });
})(typeof window !== "undefined" ? window : globalThis);
