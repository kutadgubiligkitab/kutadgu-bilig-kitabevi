(function () {
  "use strict";

  var params;
  try {
    params = new URLSearchParams(location.search);
  } catch (err) {
    return;
  }
  if (params.get("kutadguHeaderDiag") !== "1") return;

  var MAX = 16;
  var snapshots = [];
  var scrollTimer = 0;
  var resizeTimer = 0;
  var summary;
  var area;
  var status;
  var panel;

  function round(value) {
    var number = Number(value);
    if (!isFinite(number)) return null;
    return Math.round(number * 100) / 100;
  }

  function safeAssetPath(value) {
    var raw = String(value == null ? "" : value).trim();
    if (!raw) return "";
    var url;
    try {
      url = new URL(raw, "https://diag.invalid/");
    } catch (err) {
      return "";
    }
    var parts = String(url.pathname || "").split("/");
    var name = parts[parts.length - 1] || "";
    if (!/^(?:mobile\.css|index\.css|theme\.css|shop\.css|public-header\.css|public-header\.js|mobile\.js|header-diag\.js)$/.test(name)) return "";
    var version = url.searchParams.get("v") || "";
    if (!/^[0-9]{1,4}$/.test(version)) version = "";
    return version ? "/" + name + "?v=" + version : "/" + name;
  }

  function documentPath() {
    return location.pathname + "?kutadguHeaderDiag=1";
  }

  function declared(style, name) {
    if (!style || !style.getPropertyValue) return "";
    return String(style.getPropertyValue(name) || "");
  }

  function headerEl() {
    return document.querySelector("body > header");
  }

  function contentEl(header) {
    var node = header ? header.nextElementSibling : null;
    while (node && node.id === "kutadguHeaderDiag") node = node.nextElementSibling;
    while (node && node.getBoundingClientRect && node.getBoundingClientRect().height < 8) {
      node = node.nextElementSibling;
    }
    return node;
  }

  function ancestors(header) {
    var rows = [];
    var node = header;
    while (node && rows.length < 8) {
      var style = getComputedStyle(node);
      rows.push({
        tag: node.tagName,
        id: node.id || "",
        className: String(node.className || "").slice(0, 120),
        position: style.position,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        transform: style.transform,
        filter: style.filter,
        backdrop: style.backdropFilter,
        contain: style.contain,
        willChange: style.willChange
      });
      node = node.parentElement;
    }
    return rows;
  }

  function matchedRules(header) {
    var rows = [];
    if (!header || !document.styleSheets) return rows;
    function walk(source, href, media) {
      var rules;
      try {
        rules = source.cssRules;
      } catch (err) {
        if (rows.length < 24) rows.push({ href: href, error: err && err.name ? err.name : "sheet" });
        return;
      }
      if (!rules) return;
      for (var index = 0; index < rules.length && rows.length < 24; index += 1) {
        var rule = rules[index];
        if (!rule.selectorText || !rule.style) {
          if (rule.cssRules) walk(rule, href, media || rule.conditionText || "");
          continue;
        }
        var matched = false;
        try {
          matched = header.matches(rule.selectorText);
        } catch (err) {
          matched = false;
        }
        if (!matched) continue;
        var item = {
          href: href,
          media: media,
          selector: String(rule.selectorText).slice(0, 180),
          position: declared(rule.style, "position"),
          top: declared(rule.style, "top"),
          insetBlockStart: declared(rule.style, "inset-block-start"),
          backdrop: declared(rule.style, "backdrop-filter"),
          webkitBackdrop: declared(rule.style, "-webkit-backdrop-filter")
        };
        if (item.position || item.top || item.insetBlockStart || item.backdrop || item.webkitBackdrop) rows.push(item);
      }
    }
    var sheets = document.styleSheets;
    for (var sheetIndex = 0; sheetIndex < sheets.length && rows.length < 24; sheetIndex += 1) {
      var rawHref = sheets[sheetIndex].href;
      var href = "";
      if (rawHref) {
        href = safeAssetPath(rawHref);
        if (!href) continue;
      }
      walk(sheets[sheetIndex], href, "");
    }
    return rows;
  }

  function assetPaths() {
    var rows = [];
    var entries = performance.getEntriesByType ? performance.getEntriesByType("resource") : [];
    for (var index = 0; index < entries.length; index += 1) {
      var entry = entries[index];
      var assetPath = safeAssetPath(entry.name);
      if (!/mobile\.css|index\.css|theme\.css|shop\.css|public-header\.css|public-header\.js|mobile\.js|header-diag\.js/.test(assetPath)) continue;
      rows.push({
        path: assetPath,
        transferSize: entry.transferSize,
        decodedBodySize: entry.decodedBodySize,
        responseStatus: entry.responseStatus || 0
      });
    }
    return rows;
  }

  function documentLinks() {
    var rows = [];
    var nodes = document.querySelectorAll("link[rel='stylesheet'], script[src]");
    for (var index = 0; index < nodes.length; index += 1) {
      var raw = nodes[index].getAttribute("href") || nodes[index].getAttribute("src") || "";
      var assetPath = safeAssetPath(raw);
      if (assetPath) rows.push(assetPath);
    }
    return rows;
  }

  function navigation() {
    var entry = performance.getEntriesByType ? performance.getEntriesByType("navigation")[0] : null;
    if (!entry) return null;
    return {
      type: entry.type || "",
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize
    };
  }

  function measure(label, persisted) {
    var header = headerEl();
    var headerStyle = header ? getComputedStyle(header) : null;
    var headerRect = header ? header.getBoundingClientRect() : null;
    var content = contentEl(header);
    var contentRect = content ? content.getBoundingClientRect() : null;
    var viewport = window.visualViewport || null;
    var panelRect = panel ? panel.getBoundingClientRect() : null;
    var rootStyle = getComputedStyle(document.documentElement);
    var bodyStyle = document.body ? getComputedStyle(document.body) : null;
    var links = documentLinks();
    var mobileHref = "";
    for (var index = 0; index < links.length; index += 1) {
      if (/mobile\.css/.test(links[index])) mobileHref = links[index];
    }
    return {
      label: label,
      t: round(performance.now()),
      persisted: persisted === true,
      mobileHref: mobileHref,
      nav: navigation(),
      scrollX: round(window.scrollX),
      scrollY: round(window.scrollY),
      innerWidth: round(window.innerWidth),
      innerHeight: round(window.innerHeight),
      rootScrollWidth: document.documentElement.scrollWidth,
      rootClientWidth: document.documentElement.clientWidth,
      vv: viewport ? {
        offsetTop: round(viewport.offsetTop),
        offsetLeft: round(viewport.offsetLeft),
        pageTop: round(viewport.pageTop),
        pageLeft: round(viewport.pageLeft),
        width: round(viewport.width),
        height: round(viewport.height),
        scale: round(viewport.scale)
      } : null,
      header: headerStyle ? {
        className: String(header.className || ""),
        top: round(headerRect.top),
        bottom: round(headerRect.bottom),
        height: round(headerRect.height),
        left: round(headerRect.left),
        width: round(headerRect.width),
        position: headerStyle.position,
        topStyle: headerStyle.top,
        insetBlockStart: headerStyle.insetBlockStart,
        transform: headerStyle.transform,
        filter: headerStyle.filter,
        backdrop: headerStyle.backdropFilter,
        webkitBackdrop: headerStyle.webkitBackdropFilter || "",
        zIndex: headerStyle.zIndex,
        paddingTop: headerStyle.paddingTop
      } : null,
      content: contentRect ? {
        tag: content.tagName,
        className: String(content.className || "").slice(0, 120),
        top: round(contentRect.top)
      } : null,
      body: bodyStyle ? {
        paddingTop: bodyStyle.paddingTop,
        overflowX: bodyStyle.overflowX,
        overflowY: bodyStyle.overflowY,
        className: String(document.body.className || "").slice(0, 160),
        headerVar: bodyStyle.getPropertyValue("--kutadgu-sticky-header-height")
      } : null,
      root: {
        overflowX: rootStyle.overflowX,
        overflowY: rootStyle.overflowY
      },
      panelTop: panelRect ? round(panelRect.top) : null,
      links: links,
      assets: assetPaths(),
      rules: matchedRules(header),
      ancestors: ancestors(header)
    };
  }

  function payload() {
    return JSON.stringify({
      v: 1,
      path: documentPath(),
      ua: navigator.userAgent,
      snapshots: snapshots
    });
  }

  function render() {
    if (!area || !summary) return;
    var last = snapshots[snapshots.length - 1];
    var headerTop = last && last.header ? last.header.top : "";
    var backdrop = last && last.header ? last.header.backdrop : "";
    var mobileHref = last && last.mobileHref ? last.mobileHref : "";
    summary.textContent = "خاتىرە " + snapshots.length + " · headerTop " + headerTop + " · backdrop " + backdrop + " · " + mobileHref;
    area.value = payload();
  }

  var LIFECYCLE = { domcontentloaded: 1, load: 1, pageshow: 1 };
  var REPEAT = { scroll: 1, resize: 1, viewport: 1, manual: 1 };

  function dropRepeatIndex() {
    var index;
    for (index = snapshots.length - 1; index >= 1; index -= 1) {
      if (REPEAT[snapshots[index].label]) return index;
    }
    var seen = {};
    var duplicate = -1;
    for (index = 1; index < snapshots.length; index += 1) {
      var name = snapshots[index].label;
      if (seen[name]) duplicate = index;
      else seen[name] = 1;
    }
    if (duplicate >= 1) return duplicate;
    return snapshots.length - 1;
  }

  function snap(label, persisted) {
    var row = measure(label, persisted);
    if (snapshots.length < MAX) {
      snapshots.push(row);
      render();
      return;
    }
    if (LIFECYCLE[label]) {
      snapshots.splice(dropRepeatIndex(), 1);
      snapshots.push(row);
      render();
      return;
    }
    if (!REPEAT[label]) {
      render();
      return;
    }
    if (snapshots[snapshots.length - 1].label === label) {
      snapshots[snapshots.length - 1] = row;
    } else {
      var same = -1;
      var index;
      for (index = snapshots.length - 1; index >= 1; index -= 1) {
        if (snapshots[index].label === label) {
          same = index;
          break;
        }
      }
      if (same >= 1) snapshots.splice(same, 1);
      else snapshots.splice(dropRepeatIndex(), 1);
      snapshots.push(row);
    }
    render();
  }

  function later(kind) {
    if (kind === "scroll") {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(function () { snap("scroll"); }, 400);
      return;
    }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { snap(kind); }, 200);
  }

  function build() {
    if (document.getElementById("kutadguHeaderDiag") || !document.body) return;
    panel = document.createElement("aside");
    panel.id = "kutadguHeaderDiag";
    panel.setAttribute("dir", "rtl");
    panel.setAttribute("lang", "ug");
    panel.style.cssText = "position:fixed;inset-inline:0;bottom:0;z-index:13050;max-height:42vh;overflow:auto;box-sizing:border-box;background:#fffdf9;color:#2a1c14;border-top:3px solid #4b3327;padding:10px 12px calc(10px + env(safe-area-inset-bottom));font:14px/1.45 sans-serif;";

    var title = document.createElement("strong");
    title.textContent = "باش بەت خاتىرىسى";
    var help = document.createElement("p");
    help.style.margin = "6px 0";
    help.textContent = "بۇ كۆزنەك پەقەت ئادرېستا kutadguHeaderDiag=1 بولغاندا ئېچىلىدۇ. بەتنى يېڭىلاڭ. باش قۇر تۆۋەنگە چۈشكەندە «ھازىر خاتىرىلە» نى بېسىڭ، ئاندىن تۆۋەندىكى خەتنى ئۇزۇن بېسىپ كۆچۈرۈپ ئەۋەتىڭ. بۇ خاتىرە ھېساب، كۇكى ياكى تورغا يوللانمايدۇ.";
    summary = document.createElement("p");
    summary.style.margin = "6px 0";
    var row = document.createElement("p");
    row.style.margin = "6px 0";
    var capture = document.createElement("button");
    capture.type = "button";
    capture.textContent = "ھازىر خاتىرىلە";
    capture.style.marginInlineEnd = "8px";
    var copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "كۆچۈرۈش";
    status = document.createElement("p");
    status.style.margin = "6px 0";
    area = document.createElement("textarea");
    area.readOnly = true;
    area.rows = 6;
    area.style.cssText = "width:100%;box-sizing:border-box;font:12px/1.35 ui-monospace,monospace;direction:ltr;text-align:left;";
    capture.addEventListener("click", function () { snap("manual"); });
    copy.addEventListener("click", function () {
      var text = area.value;
      var finish = function (ok) {
        status.textContent = ok ? "كۆچۈرۈلدى. بۇ خەتنى ئەۋەتىڭ." : "تۆۋەندىكى خەتنى ئۇزۇن بېسىپ كۆچۈرۈڭ.";
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { finish(true); }, selectFallback);
      } else {
        selectFallback();
      }
      function selectFallback() {
        area.focus();
        area.select();
        var ok = false;
        try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
        finish(ok);
      }
    });
    row.appendChild(capture);
    row.appendChild(copy);
    panel.appendChild(title);
    panel.appendChild(help);
    panel.appendChild(summary);
    panel.appendChild(row);
    panel.appendChild(status);
    panel.appendChild(area);
    document.body.appendChild(panel);
  }

  function bind() {
    window.addEventListener("pageshow", function (event) {
      snap("pageshow", !!(event && event.persisted));
    });
    window.addEventListener("resize", function () { later("resize"); });
    window.addEventListener("scroll", function () { later("scroll"); }, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", function () { later("viewport"); });
      window.visualViewport.addEventListener("scroll", function () { later("viewport"); });
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        build();
        snap("domcontentloaded");
      });
    } else {
      build();
      snap("domcontentloaded");
    }
    if (document.readyState !== "complete") {
      window.addEventListener("load", function () { snap("load"); });
    } else {
      snap("load");
    }
  }

  bind();
})();
