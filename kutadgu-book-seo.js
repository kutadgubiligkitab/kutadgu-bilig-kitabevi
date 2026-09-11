/*
  Stage 7 — book detail SEO helpers (production origin only).
  Used by shop.js on the storefront and by Node tests.
*/
(function (root) {
  "use strict";

  const PRODUCTION_ORIGIN = "https://www.kutadgubilik.com";

  function productionOrigin() {
    return PRODUCTION_ORIGIN;
  }

  function isCanonicalBookId(value) {
    return /^\d+$/.test(String(value == null ? "" : value).trim());
  }

  function bookPath(id) {
    const canonical = String(id == null ? "" : id).trim();
    if (!isCanonicalBookId(canonical)) return "";
    return `/book/${canonical}`;
  }

  function bookCanonicalUrl(id, origin) {
    const path = bookPath(id);
    const base = productionOrigin(origin);
    if (!path) return `${base}/book.html`;
    return `${base}${path}`;
  }

  function parseBookIdFromLocation(loc) {
    const locationRef = loc || (typeof location !== "undefined" ? location : null);
    if (!locationRef) return "";
    const path = String(locationRef.pathname || "");
    const pathMatch = path.match(/^\/book\/([^/]+)\/?$/);
    if (pathMatch) {
      try {
        return decodeURIComponent(pathMatch[1] || "").trim();
      } catch (err) {
        return String(pathMatch[1] || "").trim();
      }
    }
    try {
      return String(new URLSearchParams(locationRef.search || "").get("id") || "").trim();
    } catch (err) {
      return "";
    }
  }

  /* Path-only /book/<digits>. Query ?id= and non-numeric slugs are not server-gated clean URLs. */
  function numericCleanBookIdFromLocation(loc) {
    const locationRef = loc || (typeof location !== "undefined" ? location : null);
    if (!locationRef) return "";
    const path = String(locationRef.pathname || "");
    const pathMatch = path.match(/^\/book\/([^/]+)\/?$/);
    if (!pathMatch) return "";
    let id = "";
    try {
      id = decodeURIComponent(pathMatch[1] || "").trim();
    } catch (err) {
      id = String(pathMatch[1] || "").trim();
    }
    return isCanonicalBookId(id) ? id : "";
  }

  function shouldDeferNumericCleanDetailSeo(loc, options) {
    const opts = options || {};
    if (!numericCleanBookIdFromLocation(loc)) return false;
    return opts.pageBookHydrationDone !== true;
  }

  /* Unresolved noindex + /book.html is for bare/legacy/non-numeric shells, never numeric clean URLs. */
  function shouldApplyUnresolvedDetailSeo(loc) {
    return !numericCleanBookIdFromLocation(loc);
  }

  function isBookDetailPath(pathname) {
    const path = String(pathname || "");
    return /(?:^|\/)book\.html$/i.test(path)
      || /^\/book\/?$/i.test(path)
      || /^\/book\/[^/]+\/?$/.test(path);
  }

  function isLegacyBookQueryPath(pathname) {
    const path = String(pathname || "");
    return /(?:^|\/)book\.html$/i.test(path) || /^\/book\/?$/i.test(path);
  }

  function legacyNumericIdRedirectPath(search) {
    let params;
    try {
      params = new URLSearchParams(search || "");
    } catch (err) {
      return "";
    }
    const id = String(params.get("id") || "").trim();
    if (!isCanonicalBookId(id)) return "";
    params.delete("id");
    const rest = params.toString();
    return `/book/${id}${rest ? `?${rest}` : ""}`;
  }

  function legacyBookRedirectPath(loc) {
    const locationRef = loc || (typeof location !== "undefined" ? location : null);
    if (!locationRef) return "";
    if (!isLegacyBookQueryPath(locationRef.pathname)) return "";
    return legacyNumericIdRedirectPath(locationRef.search || "");
  }

  function isPlaceholderAuthor(value) {
    const author = String(value || "").replace(/\s+/g, " ").trim();
    return !author || author === "—" || author === "ئاپتور ئىسمى";
  }

  function storefrontAuthor(book) {
    const author = book && book.author;
    return isPlaceholderAuthor(author) ? "" : String(author).trim();
  }

  function storefrontIsbn(book) {
    return String(book && book.isbn || "").replace(/[\s-]+/g, "").trim();
  }

  function isbnIfTrustworthy(book) {
    const isbn = storefrontIsbn(book);
    if (/^[0-9]{13}$/.test(isbn)) return isbn;
    if (/^[0-9]{9}[0-9X]$/i.test(isbn)) return isbn.toUpperCase();
    return "";
  }

  function datePublishedIfTrustworthy(book) {
    const year = String(book && book.publishYear || "").trim();
    if (/^\d{4}$/.test(year)) {
      const n = Number(year);
      if (n >= 1800 && n <= 2100) return year;
    }
    const raw = String(book && book.publishDate || "").trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return "";
    const y = Number(match[1]);
    if (y < 1800 || y > 2100) return "";
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  function metaDescription(book) {
    const real = String(book && book.description || "").trim();
    if (real) return real;
    const title = String(book && book.title || "").trim();
    return title ? `${title} — قۇتادغۇبىلىك كىتابخانىسى` : "";
  }

  function absoluteUrl(value, origin) {
    const base = productionOrigin(origin) + "/";
    try {
      return new URL(String(value || ""), base).href;
    } catch (err) {
      return "";
    }
  }

  /* Trusted public category hubs. Same slugs as kutadgu-sitemap CATEGORY_HUB_SLUGS. */
  const CATEGORY_HUB_SLUGS = [
    "adabiyat",
    "romanlar",
    "tarikhiy-romanlar",
    "sheirlar",
    "hekayiler",
    "dastanlar",
    "dunya-edebiyati",
    "adabiyat-roman",
    "uyghur-adabiyati",
    "universal",
    "tibb",
    "derslik",
    "terbiye",
    "dini",
    "children"
  ];

  function isTrustedCategorySlug(value) {
    const slug = String(value || "").trim();
    return CATEGORY_HUB_SLUGS.indexOf(slug) >= 0;
  }

  function categorySourceFile(value) {
    const raw = String(value == null ? "" : value).trim();
    if (!raw) return "";
    if (/^(?:javascript|data|vbscript|file|blob)\s*:/i.test(raw) || raw.startsWith("//") || /[<>"'`]/.test(raw)) {
      return "";
    }
    let path = raw.split("#")[0].split("?")[0].replace(/^\.\//, "");
    if (/^https?:\/\//i.test(path)) {
      try {
        const url = new URL(path);
        if (url.origin !== PRODUCTION_ORIGIN) return "";
        path = url.pathname || "";
      } catch (err) {
        return "";
      }
    }
    return String(path.split("/").pop() || "").toLowerCase();
  }

  function categoryCanonicalPath(source) {
    const file = categorySourceFile(source);
    if (!file) return "";
    if (isTrustedCategorySlug(file)) return "/" + file;
    const htmlMatch = file.match(/^([a-z0-9-]+)\.html$/);
    if (!htmlMatch) return "";
    const name = htmlMatch[1];
    if (isTrustedCategorySlug(name)) return "/" + name;
    const numbered = name.match(/^([a-z0-9-]+)-\d+$/);
    if (numbered && isTrustedCategorySlug(numbered[1])) return "/" + numbered[1];
    return "";
  }

  function categoryCanonicalUrl(source, origin) {
    const path = categoryCanonicalPath(source);
    if (!path) return "";
    return productionOrigin(origin) + path;
  }

  function buildBookJsonLd(book, options) {
    const opts = options || {};
    const origin = productionOrigin(opts.origin);
    const canonical = opts.canonical || bookCanonicalUrl(book && book.id, origin);
    const authorName = Object.prototype.hasOwnProperty.call(opts, "authorName")
      ? opts.authorName
      : storefrontAuthor(book);
    const visible = opts.visible !== false;
    const data = { "@type": "Book", name: String(book && book.title || "").trim(), url: canonical };
    if (authorName) data.author = { "@type": "Person", name: authorName };
    const image = opts.image || "";
    if (image) data.image = image;
    const description = String(book && book.description || "").trim();
    if (description) data.description = description;
    if (book && book.publisher) data.publisher = { "@type": "Organization", name: String(book.publisher).trim() };
    if (book && book.language) data.inLanguage = String(book.language).trim();
    const isbn = isbnIfTrustworthy(book);
    if (isbn) data.isbn = isbn;
    const published = datePublishedIfTrustworthy(book);
    if (published) data.datePublished = published;
    const price = book && book.price;
    if (visible && price !== null && price !== undefined && price !== "") {
      const n = Number(price);
      if (Number.isFinite(n)) {
        const offer = { "@type": "Offer", price: n, priceCurrency: "TRY", url: canonical };
        const stockKey = opts.stockKey || "";
        if (stockKey === "out") offer.availability = "https://schema.org/OutOfStock";
        else if (stockKey === "in" || stockKey === "low") offer.availability = "https://schema.org/InStock";
        data.offers = offer;
      }
    }
    const graph = [data];
    if (book && book.category) {
      const categoryItem = { "@type": "ListItem", position: 2, name: book.category };
      const categoryUrl = categoryCanonicalUrl(book.source, origin);
      if (categoryUrl) categoryItem.item = categoryUrl;
      graph.push({
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "قۇتادغۇبىلىك كىتابخانىسى", item: origin + "/" },
          categoryItem,
          { "@type": "ListItem", position: 3, name: book.title, item: canonical }
        ]
      });
    }
    return { "@context": "https://schema.org", "@graph": graph };
  }

  function applyUnresolvedDetailDocument(doc) {
    const documentRef = doc || (typeof document !== "undefined" ? document : null);
    if (!documentRef || !documentRef.head) return;
    const origin = productionOrigin();
    const canonical = origin + "/book.html";
    function upsert(selector, tagName, attrs) {
      let node = documentRef.head.querySelector(selector);
      if (!node) {
        const create = typeof documentRef.createElement === "function"
          ? documentRef.createElement.bind(documentRef)
          : documentRef.head.createElement.bind(documentRef.head);
        node = create(tagName);
        documentRef.head.appendChild(node);
      }
      Object.keys(attrs).forEach(function (key) {
        node.setAttribute(key, attrs[key]);
      });
      return node;
    }
    upsert('meta[name="robots"]', "meta", { name: "robots", content: "noindex, follow" });
    upsert('link[rel="canonical"]', "link", { rel: "canonical", href: canonical });
    const schema = documentRef.head.querySelector("#kutadguBookSchema");
    if (schema && schema.parentNode) schema.parentNode.removeChild(schema);
  }

  const api = {
    PRODUCTION_ORIGIN,
    productionOrigin,
    isCanonicalBookId,
    bookPath,
    bookCanonicalUrl,
    parseBookIdFromLocation,
    numericCleanBookIdFromLocation,
    shouldDeferNumericCleanDetailSeo,
    shouldApplyUnresolvedDetailSeo,
    isBookDetailPath,
    isLegacyBookQueryPath,
    legacyNumericIdRedirectPath,
    legacyBookRedirectPath,
    isPlaceholderAuthor,
    storefrontAuthor,
    storefrontIsbn,
    isbnIfTrustworthy,
    datePublishedIfTrustworthy,
    metaDescription,
    absoluteUrl,
    CATEGORY_HUB_SLUGS,
    categoryCanonicalPath,
    categoryCanonicalUrl,
    buildBookJsonLd,
    applyUnresolvedDetailDocument
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  root.KutadguBookSeo = api;
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
