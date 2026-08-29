/*
  Stage 7 — book detail SEO helpers (production origin only).
  Used by shop.js on the storefront and by Node tests.
*/
(function (root) {
  "use strict";

  const PRODUCTION_ORIGIN = "https://kutadgu-bilig-kitab.vercel.app";

  function productionOrigin() {
    return PRODUCTION_ORIGIN;
  }

  function isCanonicalBookId(value) {
    return /^\d+$/.test(String(value == null ? "" : value).trim());
  }

  function bookCanonicalUrl(id, origin) {
    const canonical = String(id == null ? "" : id).trim();
    const base = productionOrigin(origin);
    if (!isCanonicalBookId(canonical)) return `${base}/book.html`;
    return `${base}/book.html?id=${encodeURIComponent(canonical)}`;
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
      graph.push({
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "قۇتادغۇبىلىك كىتابخانىسى", item: origin + "/" },
          { "@type": "ListItem", position: 2, name: book.category, item: absoluteUrl(book.source || "index.html", origin) },
          { "@type": "ListItem", position: 3, name: book.title, item: canonical }
        ]
      });
    }
    return { "@context": "https://schema.org", "@graph": graph };
  }

  const api = {
    PRODUCTION_ORIGIN,
    productionOrigin,
    isCanonicalBookId,
    bookCanonicalUrl,
    isPlaceholderAuthor,
    storefrontAuthor,
    storefrontIsbn,
    isbnIfTrustworthy,
    datePublishedIfTrustworthy,
    metaDescription,
    absoluteUrl,
    buildBookJsonLd
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  root.KutadguBookSeo = api;
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
