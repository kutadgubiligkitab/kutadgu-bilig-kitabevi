(function (global) {
  "use strict";

  var STORY = { name: "story", label: "ھېكايە (1080×1920)", w: 1080, h: 1920, padTop: 250, padX: 72, padBottom: 280, footer: 104 };
  var FEED = { name: "feed", label: "لېنتا (1080×1350)", w: 1080, h: 1350, padTop: 72, padX: 72, padBottom: 80, footer: 104 };
  var BODY = 48;
  var TITLE_SIZE = 64;
  var COVER_H = 560;
  var HEADING = "كىتاب ھەققىدە";
  var COVER_ERROR = "مۇقاۋا رەسىمى چۈشمىدى. رەسىمسىز چۈشۈرۈلمەيدۇ. قايتا سىناڭ.";
  var FONT_ERROR = "خەت نۇسخىسى تەييار ئەمەس. رەسىم چۈشۈرۈلمىدى. قايتا سىناڭ.";
  var BOOK_ERROR = "كىتاب ئۇچۇرى تېخى يۈكلەنمىدى. قايتا سىناڭ.";
  var GENERIC_ERROR = "رەسىم تەييارلانمىدى. قايتا سىناڭ.";
  var attached = false;
  var urls = [];
  var lastFormat = "story";
  var painting = false;

  function fail(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function isSampleCover(src) {
    return /(?:^|\/)(?:sample-book-cover(?:\(\d+\))?|carousel-sample-cover)\.png(?:$|\?)/i.test(String(src || "").trim());
  }

  function textDirection(value) {
    var text = String(value || "");
    var arabic = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(text);
    var digits = /[0-9\u0660-\u0669\u06F0-\u06F9]/.test(text);
    if (!arabic && digits) return "ltr";
    return "rtl";
  }

  function isSingleBookDocument() {
    var path = "";
    try { path = String(global.location && global.location.pathname || ""); } catch (error) { return false; }
    if (!/^\/book\/\d+\/?$/.test(path)) return false;
    var body = global.document && global.document.body;
    if (!body || body.getAttribute("data-dynamic-book") == null) return false;
    if (body.getAttribute("data-volume-group-slug")) return false;
    return true;
  }

  function coverStorageSource() {
    var mode = "";
    try {
      var meta = global.document && global.document.querySelector('meta[name="kutadgu-r2-read"]');
      mode = meta ? String(meta.getAttribute("content") || "") : "";
    } catch (error) {}
    var location = global.location || {};
    return {
      r2ReadEnabled: mode === "preview" || mode === "production",
      hostMode: mode === "production" ? "production" : (mode === "preview" ? "preview" : ""),
      hostname: location.hostname || "",
      origin: location.origin || "",
      pathname: location.pathname || ""
    };
  }

  function coverRequestUrl(src) {
    var raw = String(src || "").trim();
    if (!raw || isSampleCover(raw)) return "";
    if (/^(?:javascript|data|vbscript|file|blob)\s*:/i.test(raw)) return "";
    var candidate = raw;
    var storage = global.KutadguImageStorage;
    if (storage && typeof storage.previewCoverFetchUrl === "function") {
      try {
        candidate = storage.previewCoverFetchUrl(raw, coverStorageSource()) || raw;
      } catch (error) {
        candidate = raw;
      }
    }
    if (!candidate || isSampleCover(candidate)) return "";
    if (/^(?:javascript|data|vbscript|file|blob)\s*:/i.test(candidate)) return "";
    try {
      var url = new URL(candidate, global.location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      if (isSampleCover(url.pathname) || isSampleCover(url.href)) return "";
      return url.href;
    } catch (error) {
      return "";
    }
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function detailReady() {
    if (!isSingleBookDocument()) return false;
    var body = global.document.body;
    if (!body.dataset.bookId) return false;
    var title = global.document.querySelector(".book-detail-info h1");
    if (!title) return false;
    var text = String(title.textContent || "").trim();
    if (!text || text === "كىتاب") return false;
    if (global.document.querySelector(".book-detail-info [data-detail-boot]")) return false;
    var img = global.document.querySelector(".book-cover-column .book-cover-box img");
    if (!img) return false;
    var src = String(img.getAttribute("data-cover-src") || img.getAttribute("src") || "").trim();
    return !!src;
  }

  async function waitForBook() {
    var deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (detailReady()) {
        await delay(250);
        if (detailReady()) return;
      }
      await delay(50);
    }
    throw fail("book");
  }

  function canvasTextWidth(font) {
    var canvas = global.document.createElement("canvas");
    var ctx = canvas.getContext("2d");
    ctx.font = font;
    ctx.direction = "rtl";
    return ctx.measureText("قۇتادغۇبىلىك").width;
  }

  async function ensureFont() {
    if (!global.document.fonts || typeof global.document.fonts.load !== "function") throw fail("font");
    try {
      await global.document.fonts.load('48px "UKIJ CJK"', "قۇتادغۇبىلىك");
      await global.document.fonts.ready;
    } catch (error) {
      throw fail("font");
    }
    if (!global.document.fonts.check('48px "UKIJ CJK"')) throw fail("font");
    var shaped = canvasTextWidth('48px "UKIJ CJK"');
    var fallback = canvasTextWidth("48px sans-serif");
    if (!shaped || Math.abs(shaped - fallback) < 1) throw fail("font");
  }

  function readVisibleBook() {
    var titleEl = global.document.querySelector(".book-detail-info h1");
    var authorEl = global.document.querySelector(".book-detail-info .book-author");
    var author = "";
    if (authorEl && !authorEl.hidden) author = String(authorEl.textContent || "").trim();
    var meta = [];
    global.document.querySelectorAll(".book-detail-info .book-meta .book-meta-row").forEach(function (row) {
      var label = row.querySelector(".book-meta-label");
      var value = row.querySelector(".book-meta-value");
      if (!label || !value) return;
      var labelText = String(label.textContent || "").trim();
      var valueText = String(value.textContent || "").trim();
      if (!labelText || !valueText) return;
      meta.push({ label: labelText, value: valueText, dir: textDirection(valueText) });
    });
    var section = global.document.querySelector(".book-detail-info .dynamic-book-description");
    var description = "";
    if (section && !section.hidden) {
      var paragraph = section.querySelector("p");
      description = paragraph ? String(paragraph.textContent || "") : "";
    }
    var img = global.document.querySelector(".book-cover-column .book-cover-box img");
    var coverSrc = img ? String(img.getAttribute("data-cover-src") || img.getAttribute("src") || "").trim() : "";
    return {
      title: titleEl ? String(titleEl.textContent || "").trim() : "",
      author: author,
      meta: meta,
      description: description,
      coverSrc: coverSrc,
      bookId: global.document.body && global.document.body.dataset.bookId || ""
    };
  }

  async function decodeCover(src) {
    var url = coverRequestUrl(src);
    if (!url) throw fail("cover");
    var response;
    try { response = await fetch(url, { credentials: "omit", cache: "no-store" }); }
    catch (error) { throw fail("cover"); }
    if (!response || !response.ok) throw fail("cover");
    var blob = await response.blob();
    if (!blob || !blob.size) throw fail("cover");
    try {
      if (typeof createImageBitmap === "function") {
        var bitmap = await createImageBitmap(blob);
        if (bitmap && bitmap.width && bitmap.height) return bitmap;
      }
    } catch (error) {}
    var objectUrl = URL.createObjectURL(blob);
    try {
      var image = new Image();
      image.src = objectUrl;
      if (typeof image.decode === "function") await image.decode();
      else await new Promise(function (resolve, reject) {
        image.onload = resolve;
        image.onerror = function () { reject(fail("cover")); };
      });
      if (!image.naturalWidth || !image.naturalHeight) throw fail("cover");
      return image;
    } catch (error) {
      throw fail("cover");
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function ensureStage() {
    var stage = global.document.getElementById("kutadgu-poster-stage");
    if (stage) return stage;
    stage = global.document.createElement("div");
    stage.id = "kutadgu-poster-stage";
    stage.dir = "rtl";
    stage.lang = "ug";
    stage.style.cssText = "position:fixed;left:-20000px;top:0;z-index:0;pointer-events:none;font-family:'UKIJ CJK',sans-serif;";
    global.document.body.appendChild(stage);
    return stage;
  }

  function leaf(text, style, dir, role) {
    var el = global.document.createElement("div");
    el.textContent = text;
    el.style.cssText = style;
    el.dir = dir || "rtl";
    el.dataset.posterRole = role || "text";
    el.dataset.posterText = "1";
    return el;
  }

  function visualLines(el) {
    var node = el.firstChild;
    if (!node || node.nodeType !== 3) return [];
    var text = node.textContent || "";
    if (!text) return [];
    var range = global.document.createRange();
    var lines = [];
    var start = 0;
    while (start < text.length) {
      range.setStart(node, start);
      range.setEnd(node, Math.min(text.length, start + 1));
      var first = range.getBoundingClientRect();
      var end = Math.min(text.length, start + 1);
      while (end < text.length) {
        range.setEnd(node, end + 1);
        var rect = range.getBoundingClientRect();
        if (rect.height > first.height * 1.45) break;
        end += 1;
      }
      if (end <= start) end = start + 1;
      lines.push(text.slice(start, end));
      start = end;
    }
    if (lines.join("") !== text) throw fail("layout");
    return lines;
  }

  function measureHost(width) {
    var probe = global.document.createElement("div");
    probe.dir = "rtl";
    probe.style.cssText = "position:absolute;left:-20000px;top:0;width:" + width + "px;font-family:'UKIJ CJK',sans-serif;";
    global.document.body.appendChild(probe);
    return probe;
  }

  function splitLines(text, width, style) {
    var host = measureHost(width);
    var el = leaf(text, style, "rtl", "measure");
    host.appendChild(el);
    var lines = visualLines(el);
    host.remove();
    if (lines.join("") !== String(text)) throw fail("layout");
    return lines.length ? lines : [String(text)];
  }

  function textStyle(size, weight, color, margin, wrap) {
    return "display:block;box-sizing:border-box;font-family:'UKIJ CJK',sans-serif;font-size:" + size + "px;font-weight:" + weight + ";line-height:" + (size === TITLE_SIZE ? "1.35" : "1.7") + ";color:" + color + ";margin:" + margin + ";" + (wrap ? "white-space:pre-wrap;overflow-wrap:anywhere;" : "white-space:nowrap;");
  }

  function buildBlocks(model, innerWidth) {
    var blocks = [{ kind: "cover" }];
    var title = String(model.title || "").trim();
    if (!title) throw fail("book");
    var titleLines = splitLines(title, innerWidth, textStyle(TITLE_SIZE, 800, "#44352d", "0", true));
    titleLines.forEach(function (line, index) {
      blocks.push({
        kind: "title",
        text: line,
        size: TITLE_SIZE,
        weight: 800,
        dir: "rtl",
        margin: index === titleLines.length - 1 ? "0 0 18px" : "0"
      });
    });
    var author = String(model.author || "").trim();
    if (author) {
      splitLines(author, innerWidth, textStyle(BODY, 700, "#806f62", "0", true)).forEach(function (line, index, all) {
        blocks.push({
          kind: "author",
          text: line,
          size: BODY,
          weight: 700,
          dir: "rtl",
          margin: index === all.length - 1 ? "0 0 12px" : "0"
        });
      });
    }
    (model.meta || []).forEach(function (row) {
      blocks.push({
        kind: "meta",
        label: String(row.label || ""),
        value: String(row.value || ""),
        dir: row.dir || textDirection(row.value)
      });
    });
    var description = String(model.description || "");
    var heading = null;
    if (description.trim()) {
      heading = { kind: "heading", text: HEADING, size: BODY, weight: 800, dir: "rtl", margin: "18px 0 10px" };
      blocks.push(heading);
      description.split("\n").forEach(function (para, paraIndex) {
        if (para === "") {
          blocks.push({ kind: "desc", text: "", para: paraIndex, last: true, spacer: true });
          return;
        }
        var lines = splitLines(para, innerWidth, textStyle(BODY, 400, "#806f62", "0", true));
        lines.forEach(function (line, lineIndex) {
          blocks.push({
            kind: "desc",
            text: line,
            size: BODY,
            weight: 400,
            dir: "rtl",
            margin: lineIndex === lines.length - 1 ? "0 0 16px" : "0",
            para: paraIndex,
            last: lineIndex === lines.length - 1
          });
        });
      });
    }
    return { blocks: blocks, titleBlocks: blocks.filter(function (block) { return block.kind === "title"; }), heading: heading, description: description };
  }

  function blockNode(block) {
    if (block.kind === "cover") {
      var box = global.document.createElement("div");
      box.dataset.posterRole = "cover";
      box.style.cssText = "height:" + COVER_H + "px;margin:0 0 12px;display:flex;align-items:center;justify-content:center;background:#f3eadc;";
      var img = global.document.createElement("img");
      img.alt = "";
      img.style.cssText = "max-width:100%;max-height:100%;object-fit:contain;display:block;";
      box.appendChild(img);
      return box;
    }
    if (block.kind === "meta") {
      var wrap = global.document.createElement("div");
      wrap.dataset.posterRole = "meta";
      wrap.style.cssText = "display:grid;grid-template-columns:250px minmax(0,1fr);gap:18px;font-size:48px;line-height:1.45;margin:0 0 8px;font-family:'UKIJ CJK',sans-serif;";
      var label = leaf(block.label, "font-size:48px;font-weight:800;line-height:1.45;color:#44352d;white-space:pre-wrap;overflow-wrap:anywhere;", "rtl", "meta-label");
      var value = leaf(block.value, "font-size:48px;font-weight:400;line-height:1.45;color:#806f62;white-space:pre-wrap;overflow-wrap:anywhere;", block.dir, "meta-value");
      value.dataset.metaValue = block.value;
      wrap.appendChild(label);
      wrap.appendChild(value);
      return wrap;
    }
    if (block.spacer) {
      var spacer = global.document.createElement("div");
      spacer.dataset.posterRole = "desc";
      spacer.dataset.paragraph = String(block.para);
      spacer.dataset.last = "1";
      spacer.style.cssText = "height:16px;";
      return spacer;
    }
    var color = block.kind === "desc" || block.kind === "author" ? "#806f62" : "#44352d";
    var size = block.size || BODY;
    var node = leaf(
      block.text,
      textStyle(size, block.weight || 400, color, block.margin || "0", false),
      block.dir || "rtl",
      block.kind
    );
    if (block.kind === "desc") {
      node.dataset.paragraph = String(block.para);
      node.dataset.last = block.last ? "1" : "0";
    }
    return node;
  }

  function renderSlide(spec) {
    var slide = global.document.createElement("article");
    slide.dir = "rtl";
    slide.lang = "ug";
    slide.dataset.format = spec.name;
    slide.style.cssText = "width:" + spec.w + "px;height:" + spec.h + "px;box-sizing:border-box;padding:" + spec.padTop + "px " + spec.padX + "px " + spec.padBottom + "px;display:flex;flex-direction:column;background:#f6f0e5;font-family:'UKIJ CJK',sans-serif;";
    var card = global.document.createElement("div");
    card.className = "poster-card";
    card.style.cssText = "flex:1;min-height:0;box-sizing:border-box;padding:28px;background:#fffdf9;border:1px solid #e8dccb;overflow:hidden;";
    var footer = global.document.createElement("div");
    footer.dataset.posterRole = "footer";
    footer.style.cssText = "height:" + spec.footer + "px;display:flex;align-items:center;justify-content:flex-end;color:#70503d;font-size:48px;line-height:1.2;font-weight:800;font-family:'UKIJ CJK',sans-serif;";
    footer.appendChild(leaf("", "flex:none;font-size:48px;line-height:1.2;font-weight:800;color:#70503d;white-space:nowrap;", "ltr", "page"));
    slide.appendChild(card);
    slide.appendChild(footer);
    return slide;
  }

  function prefixFor(block, built) {
    if (!block || block.kind === "cover" || block.kind === "title") return [];
    var prefix = built.titleBlocks.slice();
    if (block.kind === "desc" && built.heading) prefix.push(built.heading);
    return prefix;
  }

  function overflows(card) {
    return card.scrollHeight > card.clientHeight + 1;
  }

  function fitSlides(spec, built, stage) {
    var slides = [];
    function make() {
      var slide = renderSlide(spec);
      stage.appendChild(slide);
      slides.push(slide);
      return slide;
    }
    var slide = make();
    built.blocks.forEach(function (block) {
      var card = slide.querySelector(".poster-card");
      var node = blockNode(block);
      card.appendChild(node);
      if (!overflows(card)) return;
      node.remove();
      if (!card.children.length) throw fail("layout");
      slide = make();
      card = slide.querySelector(".poster-card");
      prefixFor(block, built).forEach(function (item) {
        card.appendChild(blockNode(item));
      });
      card.appendChild(node);
      if (overflows(card)) throw fail("layout");
    });
    if (!slides[0] || !slides[0].querySelector("img")) throw fail("cover");
    slides.forEach(function (el, index) {
      var page = el.querySelector('[data-poster-role="page"]');
      if (page) page.textContent = (index + 1) + " / " + slides.length;
      el.dataset.page = String(index + 1);
      if (overflows(el.querySelector(".poster-card"))) throw fail("layout");
    });
    return slides;
  }

  function assertReadable(slides) {
    slides.forEach(function (slide) {
      var footer = slide.querySelector('[data-poster-role="footer"]');
      var page = slide.querySelector('[data-poster-role="page"]');
      if (!footer || !page || !/^\d+ \/ \d+$/.test(page.textContent || "")) throw fail("layout");
      if (footer.scrollWidth > footer.clientWidth + 1) throw fail("layout");
      slide.querySelectorAll("[data-poster-text]").forEach(function (el) {
        var size = parseFloat(getComputedStyle(el).fontSize) || 0;
        if (size < BODY) throw fail("layout");
        if (el.scrollWidth > el.clientWidth + 1) throw fail("layout");
      });
    });
  }

  function relRect(slide, el) {
    var a = slide.getBoundingClientRect();
    var b = el.getBoundingClientRect();
    return { x: b.left - a.left, y: b.top - a.top, w: b.width, h: b.height };
  }

  function contain(box, imgW, imgH) {
    var scale = Math.min(box.w / imgW, box.h / imgH);
    var w = imgW * scale;
    var h = imgH * scale;
    return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w: w, h: h };
  }

  function paintElement(ctx, el, root) {
    var node = el.firstChild;
    if (!node || node.nodeType !== 3 || !node.textContent) return;
    var style = getComputedStyle(el);
    var size = parseFloat(style.fontSize) || BODY;
    var lines = visualLines(el);
    var start = 0;
    lines.forEach(function (text) {
      if ((node.textContent || "").slice(start, start + text.length) !== text) throw fail("layout");
      var range = global.document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + text.length);
      start += text.length;
      var rect = range.getBoundingClientRect();
      var boxX = rect.left - root.left;
      var boxY = rect.top - root.top;
      if (boxX < -1 || boxY < -1 || boxX + rect.width > root.width + 1 || boxY + rect.height > root.height + 1) throw fail("layout");
      ctx.save();
      ctx.font = style.fontWeight + " " + size + "px \"UKIJ CJK\"";
      ctx.direction = style.direction === "ltr" ? "ltr" : "rtl";
      ctx.textAlign = ctx.direction === "ltr" ? "left" : "right";
      ctx.fillStyle = style.color;
      ctx.textBaseline = "alphabetic";
      var metrics = ctx.measureText(text);
      var ascent = metrics.actualBoundingBoxAscent || size * 0.8;
      var descent = metrics.actualBoundingBoxDescent || size * 0.2;
      var y = boxY + (rect.height - (ascent + descent)) / 2 + ascent;
      var x = ctx.direction === "ltr" ? boxX : boxX + rect.width;
      var paintLeft = ctx.direction === "ltr" ? x : x - metrics.width;
      if (paintLeft < -1 || paintLeft + metrics.width > root.width + 1 || y - ascent < -1 || y + descent > root.height + 1) throw fail("layout");
      ctx.fillText(text, x, y);
      ctx.restore();
    });
  }

  function paintFillText(slide, bitmap) {
    var canvas = global.document.createElement("canvas");
    canvas.width = slide.offsetWidth;
    canvas.height = slide.offsetHeight;
    canvas.dir = "rtl";
    var ctx = canvas.getContext("2d");
    var root = slide.getBoundingClientRect();
    ctx.fillStyle = "#f6f0e5";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    var card = slide.querySelector(".poster-card");
    var cardRect = relRect(slide, card);
    ctx.fillStyle = "#fffdf9";
    ctx.fillRect(cardRect.x, cardRect.y, cardRect.w, cardRect.h);
    ctx.strokeStyle = "#e8dccb";
    ctx.strokeRect(cardRect.x + 0.5, cardRect.y + 0.5, cardRect.w - 1, cardRect.h - 1);
    var img = slide.querySelector("img");
    if (img) {
      if (!bitmap || !bitmap.width || !bitmap.height) throw fail("cover");
      var drawn = contain(relRect(slide, img.parentElement), bitmap.width, bitmap.height);
      ctx.drawImage(bitmap, drawn.x, drawn.y, drawn.w, drawn.h);
    }
    var walker = global.document.createTreeWalker(slide, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      var el = walker.currentNode;
      if (el.querySelector("img") || el.querySelector("div")) continue;
      paintElement(ctx, el, root);
    }
    return canvas;
  }

  function canvasBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) reject(fail("layout"));
        else resolve(blob);
      }, "image/png");
    });
  }

  function innerWidth(spec, stage) {
    var probe = renderSlide(spec);
    stage.appendChild(probe);
    var card = probe.querySelector(".poster-card");
    var style = getComputedStyle(card);
    var width = card.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    probe.remove();
    if (!width || width < 200) throw fail("layout");
    return width;
  }

  function joinedDescription(stage) {
    var paras = [];
    var current = "";
    stage.querySelectorAll('[data-poster-role="desc"]').forEach(function (node) {
      current += node.textContent || "";
      if (node.dataset.last === "1") {
        paras.push(current);
        current = "";
      }
    });
    if (current) paras.push(current);
    return paras.join("\n");
  }

  async function exportModel(model, formatName) {
    await ensureFont();
    var bitmap = await decodeCover(model.coverSrc || model.coverUrl);
    var spec = formatName === "feed" ? FEED : STORY;
    var stage = ensureStage();
    stage.replaceChildren();
    var built = buildBlocks(model, innerWidth(spec, stage));
    var slides = fitSlides(spec, built, stage);
    assertReadable(slides);
    var joined = built.description.trim() ? joinedDescription(stage) : "";
    var expected = built.description.trim() ? built.description : "";
    if (joined !== expected) throw fail("layout");
    slides.forEach(function (slide) {
      if (slide.querySelector(".poster-card").scrollHeight > slide.querySelector(".poster-card").clientHeight + 1) throw fail("layout");
    });
    var canvases = slides.map(function (slide) { return paintFillText(slide, bitmap); });
    if (canvases.some(function (canvas) { return canvas.width !== spec.w || canvas.height !== spec.h; })) throw fail("layout");
    var blobs = [];
    for (var index = 0; index < canvases.length; index += 1) blobs.push(await canvasBlob(canvases[index]));
    return { spec: spec, slides: slides, canvases: canvases, blobs: blobs, built: built, stage: stage, bitmap: bitmap };
  }

  function revokeUrls() {
    urls.splice(0).forEach(function (url) {
      try { URL.revokeObjectURL(url); } catch (error) {}
    });
  }

  function panelNodes() {
    return {
      panel: global.document.getElementById("kutadgu-book-poster-panel"),
      status: global.document.querySelector("[data-poster-status]"),
      retry: global.document.querySelector("[data-poster-retry]"),
      preview: global.document.querySelector("[data-poster-preview]")
    };
  }

  function setStatus(message, isError) {
    var nodes = panelNodes();
    if (!nodes.status) return;
    nodes.status.hidden = !message;
    nodes.status.textContent = message || "";
    nodes.status.dataset.state = isError ? "error" : "info";
  }

  function showRetry(show) {
    var nodes = panelNodes();
    if (nodes.retry) nodes.retry.hidden = !show;
  }

  function clearPreview() {
    revokeUrls();
    var nodes = panelNodes();
    if (nodes.preview) nodes.preview.replaceChildren();
  }

  function messageFor(error) {
    var code = error && error.code;
    if (code === "cover") return COVER_ERROR;
    if (code === "font") return FONT_ERROR;
    if (code === "book") return BOOK_ERROR;
    return GENERIC_ERROR;
  }

  function fileName(bookId, format, index) {
    var id = String(bookId || "book").replace(/[^\dA-Za-z_-]/g, "") || "book";
    return "kutadgu-" + id + "-" + format + "-" + (index + 1) + ".png";
  }

  function showPreviews(result, bookId) {
    var nodes = panelNodes();
    if (!nodes.preview) return;
    clearPreview();
    var shareOk = false;
    try {
      shareOk = !!(navigator.canShare && result.blobs[0] && navigator.canShare({ files: [new File([result.blobs[0]], "a.png", { type: "image/png" })] }));
    } catch (error) { shareOk = false; }
    result.blobs.forEach(function (blob, index) {
      var url = URL.createObjectURL(blob);
      urls.push(url);
      var name = fileName(bookId, result.spec.name, index);
      var figure = global.document.createElement("figure");
      figure.style.cssText = "margin:0 0 16px;display:flex;flex-direction:column;gap:8px;";
      var image = global.document.createElement("img");
      image.src = url;
      image.alt = name;
      image.style.cssText = "width:min(100%,360px);height:auto;background:#fff;border:1px solid #e8dccb;";
      var row = global.document.createElement("div");
      row.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;";
      var save = global.document.createElement("a");
      save.href = url;
      save.download = name;
      save.textContent = "ساقلاش";
      var open = global.document.createElement("a");
      open.href = url;
      open.target = "_blank";
      open.rel = "noopener";
      open.textContent = "رەسىمنى ئېچىش";
      [save, open].forEach(function (link) {
        link.style.cssText = "min-height:44px;padding:8px 12px;display:inline-flex;align-items:center;border:1px solid #e8dccb;border-radius:8px;background:#fffdf9;color:#70503d;font-weight:800;text-decoration:none;";
      });
      row.appendChild(save);
      row.appendChild(open);
      if (shareOk) {
        var share = global.document.createElement("button");
        share.type = "button";
        share.textContent = "ھەمبەھىرلەش";
        share.style.cssText = "min-height:44px;padding:8px 12px;border:1px solid #e8dccb;border-radius:8px;background:#fffdf9;color:#70503d;font-weight:800;";
        share.addEventListener("click", function () {
          var file = new File([blob], name, { type: "image/png" });
          navigator.share({ files: [file] }).catch(function () {});
        });
        row.appendChild(share);
      }
      figure.appendChild(image);
      figure.appendChild(row);
      nodes.preview.appendChild(figure);
    });
    setStatus(result.blobs.length + " رەسىم تەييار.", false);
    showRetry(false);
  }

  async function runExport(formatName) {
    if (painting) return;
    painting = true;
    lastFormat = formatName === "feed" ? "feed" : "story";
    clearPreview();
    setStatus("رەسىم تەييارلىنىۋاتىدۇ…", false);
    showRetry(false);
    var buttons = global.document.querySelectorAll("[data-poster-format]");
    buttons.forEach(function (button) { button.disabled = true; });
    try {
      await waitForBook();
      var book = readVisibleBook();
      var result = await exportModel(book, lastFormat);
      showPreviews(result, book.bookId);
    } catch (error) {
      clearPreview();
      setStatus(messageFor(error), true);
      showRetry(true);
    } finally {
      painting = false;
      buttons.forEach(function (button) { button.disabled = false; });
    }
  }

  function injectChrome() {
    if (global.document.getElementById("kutadgu-book-poster-style")) return;
    var style = global.document.createElement("style");
    style.id = "kutadgu-book-poster-style";
    style.textContent = "#kutadguBookPosterOpen{min-height:40px;padding:8px 12px;border:1px solid var(--site-border,#e8dccb);border-radius:9px;background:var(--site-bg-soft,#fbf8f2);color:var(--site-brown,#70503d);font:inherit;font-weight:800;cursor:pointer}#kutadgu-book-poster-panel{margin:0 0 18px;padding:14px;border:1px solid var(--site-border,#e8dccb);border-radius:14px;background:var(--site-card,#fffdf9)}#kutadgu-book-poster-panel [data-poster-format],#kutadgu-book-poster-panel [data-poster-retry]{min-height:44px;margin:0 0 8px 8px;padding:8px 12px;border:1px solid var(--site-border,#e8dccb);border-radius:9px;background:var(--site-bg-soft,#fbf8f2);color:var(--site-text,#44352d);font:inherit;font-weight:800}#kutadgu-book-poster-panel [data-poster-status]{margin:8px 0;font-weight:700}#kutadgu-book-poster-panel [data-state=error]{color:#8a2b22}";
    global.document.head.appendChild(style);
    var bar = global.document.querySelector(".detail-topbar");
    var button = global.document.createElement("button");
    button.type = "button";
    button.id = "kutadguBookPosterOpen";
    button.textContent = "رەسىم سۈپىتىدە ساقلاش";
    if (bar) bar.appendChild(button);
    else global.document.body.insertBefore(button, global.document.body.firstChild);
    var panel = global.document.createElement("section");
    panel.id = "kutadgu-book-poster-panel";
    panel.hidden = true;
    panel.innerHTML = '<p style="margin:0 0 10px;font-weight:800">رەسىم سۈپىتىدە ساقلاش</p><button type="button" data-poster-format="story">ھېكايە (1080×1920)</button><button type="button" data-poster-format="feed">لېنتا (1080×1350)</button><p data-poster-status hidden></p><button type="button" data-poster-retry hidden>قايتا سىناش</button><div data-poster-preview></div>';
    var page = global.document.querySelector(".book-detail-page") || global.document.body;
    if (bar && bar.nextSibling) page.insertBefore(panel, bar.nextSibling);
    else page.insertBefore(panel, page.firstChild);
    button.addEventListener("click", function () { panel.hidden = !panel.hidden; });
    panel.addEventListener("click", function (event) {
      var format = event.target && event.target.getAttribute && event.target.getAttribute("data-poster-format");
      if (format) runExport(format);
      if (event.target && event.target.hasAttribute && event.target.hasAttribute("data-poster-retry")) runExport(lastFormat);
    });
  }

  function inkColumns(canvas, rect) {
    var x = Math.max(0, Math.floor(rect.x));
    var y = Math.max(0, Math.floor(rect.y));
    var w = Math.max(1, Math.min(Math.floor(rect.w), canvas.width - x));
    var h = Math.max(1, Math.min(Math.floor(rect.h), canvas.height - y));
    var data = canvas.getContext("2d").getImageData(x, y, w, h).data;
    var columns = 0;
    for (var col = 0; col < w; col += 1) {
      for (var row = 0; row < h; row += 1) {
        var i = (row * w + col) * 4;
        if (data[i] + data[i + 1] + data[i + 2] < 500) {
          columns += 1;
          break;
        }
      }
    }
    return columns;
  }

  function regionStats(canvas, rect) {
    var x = Math.max(0, Math.floor(rect.x));
    var y = Math.max(0, Math.floor(rect.y));
    var w = Math.max(1, Math.min(Math.floor(rect.w), canvas.width - x));
    var h = Math.max(1, Math.min(Math.floor(rect.h), canvas.height - y));
    var data = canvas.getContext("2d").getImageData(x, y, w, h).data;
    var red = 0;
    var blue = 0;
    var dark = 0;
    var warm = 0;
    var ink = 0;
    for (var i = 0; i < data.length; i += 4) {
      var r = data[i];
      var g = data[i + 1];
      var b = data[i + 2];
      var max = Math.max(r, g, b);
      var min = Math.min(r, g, b);
      if (r > 180 && g < 90 && b < 90) red += 1;
      if (b > r + 25 && b > 90) blue += 1;
      if (r + g + b < 420) dark += 1;
      if (r > 140 && r > b + 20) warm += 1;
      if (!(max > 236 && min > 210) && (max - min > 18 || max < 180)) ink += 1;
    }
    return { red: red, blue: blue, dark: dark, warm: warm, ink: ink, pixels: data.length / 4 };
  }

  function shapingProbe() {
    var canvas = global.document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 160;
    canvas.dir = "rtl";
    var ctx = canvas.getContext("2d");
    ctx.font = '48px "UKIJ CJK"';
    ctx.direction = "rtl";
    var word = "قۇتادغۇبىلىك";
    var whole = ctx.measureText(word).width;
    var isolated = 0;
    for (var i = 0; i < word.length; i += 1) isolated += ctx.measureText(word.charAt(i)).width;
    var sample = global.document.createElement("div");
    sample.textContent = word;
    sample.dir = "rtl";
    sample.style.cssText = "position:absolute;left:-20000px;top:0;font:48px 'UKIJ CJK',sans-serif;white-space:nowrap;";
    global.document.body.appendChild(sample);
    var domWidth = sample.getBoundingClientRect().width;
    sample.remove();
    return {
      canvasWidth: whole,
      isolatedSum: isolated,
      ratio: whole / isolated,
      domWidth: domWidth,
      fontCheck48: global.document.fonts.check('48px "UKIJ CJK"')
    };
  }

  async function exportForTest(model, formatName, options) {
    try {
      var result = await exportModel(model, formatName);
      var slide = result.slides[0];
      var cover = slide.querySelector("img");
      var title = slide.querySelector('[data-poster-role="title"]');
      var dirs = {};
      result.stage.querySelectorAll('[data-poster-role="meta-value"]').forEach(function (node) {
        dirs[node.dataset.metaValue] = getComputedStyle(node).direction;
      });
      var text = result.stage.textContent || "";
      var pngs = [];
      if (options && options.png) {
        for (var index = 0; index < result.canvases.length; index += 1) {
          if (index !== 0 && index !== result.canvases.length - 1) continue;
          pngs.push(result.canvases[index].toDataURL("image/png"));
        }
      }
      return {
        ok: true,
        files: result.blobs.length,
        slides: result.slides.length,
        width: result.canvases[0].width,
        height: result.canvases[0].height,
        description: result.built.description,
        joined: result.built.description.trim() ? joinedDescription(result.stage) : "",
        minFont: BODY,
        overflow: false,
        bounds: result.slides.map(function (item) {
          var footer = item.querySelector('[data-poster-role="footer"]');
          var page = item.querySelector('[data-poster-role="page"]');
          var overflowX = 0;
          item.querySelectorAll("[data-poster-text]").forEach(function (el) {
            overflowX = Math.max(overflowX, el.scrollWidth - el.clientWidth);
          });
          return {
            footerClient: footer ? footer.clientWidth : 0,
            footerScroll: footer ? footer.scrollWidth : 0,
            page: page ? page.textContent : "",
            pageFont: page ? parseFloat(getComputedStyle(page).fontSize) || 0 : 0,
            title: Array.from(item.querySelectorAll('[data-poster-role="title"]')).map(function (el) { return el.textContent || ""; }).join(""),
            overflowX: overflowX
          };
        }),
        footerInk: result.canvases.map(function (canvas, index) {
          var footer = result.slides[index].querySelector('[data-poster-role="footer"]');
          return footer ? inkColumns(canvas, relRect(result.slides[index], footer)) : 0;
        }),
        continuationTitle: result.slides.length < 2 || !!result.slides[1].querySelector('[data-poster-role="title"]'),
        continuationHeading: result.slides.length < 2 || !result.slides[1].querySelector('[data-poster-role="desc"]') || !!result.slides[1].querySelector('[data-poster-role="heading"]'),
        coverOnLaterSlide: result.slides.slice(1).some(function (item) { return !!item.querySelector("img"); }),
        minMeasured: Math.min.apply(null, Array.from(result.stage.querySelectorAll("[data-poster-text]")).map(function (el) { return parseFloat(getComputedStyle(el).fontSize) || 0; })),
        dirs: dirs,
        excluded: /₺|سېۋەت|ياقتۇر|باھاسى/.test(text),
        cover: cover ? regionStats(result.canvases[0], relRect(slide, cover.parentElement)) : null,
        titleDark: title ? regionStats(result.canvases[0], relRect(slide, title)).dark : 0,
        pngs: pngs,
        shareFiles: (function () {
          try { return !!(navigator.canShare && navigator.canShare({ files: [new File(["x"], "a.png", { type: "image/png" })] })); }
          catch (error) { return false; }
        })()
      };
    } catch (error) {
      return { ok: false, code: error && error.code || "error", files: 0, message: messageFor(error) };
    }
  }

  function attach() {
    if (attached || !isSingleBookDocument()) return;
    attached = true;
    injectChrome();
  }

  global.KutadguBookPoster = {
    attach: attach,
    readVisibleBook: readVisibleBook,
    exportForTest: exportForTest,
    shapingProbe: shapingProbe,
    textDirection: textDirection,
    COVER_ERROR: COVER_ERROR,
    FONT_ERROR: FONT_ERROR
  };
})(window);
