"use strict";

/**
 * Follow-up comparisons use server-validated book ids and catalog prices.
 * The model does not estimate a price.
 */

function normalizeText(value) {
  return String(value == null ? "" : value).normalize("NFC").replace(/\s+/g, " ").trim();
}

function refersToPrevious(text) {
  return /شۇلار|ئۇلار|بۇلار|ئىچىدە|قايسى|ئالدىنقى/.test(text);
}

function followUpIntent(text) {
  const question = normalizeText(text);
  if (!refersToPrevious(question)) return "";
  if (/ئەرزان|ئەرزىن/.test(question)) return "cheapest";
  if (/قىممەت|يۇقىرىراق/.test(question)) return "dearest";
  if (/ئاسان|تەس|قىيىن/.test(question)) return "difficulty";
  return "";
}

function priceText(value) {
  const rounded = Math.round(Number(value) * 100) / 100;
  return String(rounded);
}

function catalogBooks(ids, catalog) {
  const found = [];
  const seen = new Set();
  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = Number(raw);
    if (!Number.isInteger(id) || seen.has(id)) continue;
    const book = catalog && catalog.byId && catalog.byId.get(id);
    if (!book) continue;
    seen.add(id);
    found.push(book);
  }
  return found;
}

function comparePrices(intent, ids, catalog, present) {
  const books = catalogBooks(ids, catalog);
  if (!books.length) {
    return {
      handled: true,
      verified: true,
      evidence: "catalog_price",
      status: "no_prior",
      message: "سېلىشتۇرۇش ئۈچۈن ئالدىنقى تەۋسىيە يوق.",
      books: []
    };
  }
  const priced = books.filter((book) => Number.isFinite(book.price));
  if (!priced.length) {
    return {
      handled: true,
      verified: true,
      evidence: "catalog_price",
      status: "unavailable",
      message: "بۇ كىتابلارنىڭ باھاسى ھازىر يوق. باھا تەخمىن قىلىنمىدى.",
      books: present(books.map((book) => book.id))
    };
  }
  const target = intent === "dearest"
    ? Math.max.apply(null, priced.map((book) => book.price))
    : Math.min.apply(null, priced.map((book) => book.price));
  const winners = priced.filter((book) => book.price === target);
  const cards = present(winners.map((book) => book.id));
  const names = winners.map((book) => "«" + book.title + "»").join(" ۋە ");
  const message = winners.length > 1
    ? "بۇلارنىڭ باھاسى ئوخشاش، " + priceText(target) + ": " + names + "."
    : (intent === "dearest"
      ? "ئالدىنقى تەۋسىيەلەرنىڭ قىممىتى «" + winners[0].title + "». باھاسى " + priceText(target) + "."
      : "ئالدىنقى تەۋسىيەلەرنىڭ ئەرزىنى «" + winners[0].title + "». باھاسى " + priceText(target) + ".");
  return {
    handled: true,
    verified: true,
    evidence: "catalog_price",
    status: winners.length > 1 ? "tie" : "one",
    message,
    books: cards
  };
}

module.exports = {
  followUpIntent,
  comparePrices,
  catalogBooks
};
