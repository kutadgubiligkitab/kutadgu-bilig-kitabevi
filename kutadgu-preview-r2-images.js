(function (root) {
  "use strict";

  var images = root.KutadguImageStorage;
  if (!images || typeof images.installPreviewCoverBridge !== "function") return;
  if (typeof document === "undefined" || !root.location) return;
  var meta = document.querySelector('meta[name="kutadgu-r2-read"]');
  var mode = meta ? meta.getAttribute("content") : "";
  if (mode !== "preview" && mode !== "production") return;
  images.installPreviewCoverBridge(document, {
    r2ReadEnabled: true,
    hostMode: mode,
    hostname: root.location.hostname,
    origin: root.location.origin,
    pathname: root.location.pathname
  });
})(typeof window !== "undefined" ? window : globalThis);
