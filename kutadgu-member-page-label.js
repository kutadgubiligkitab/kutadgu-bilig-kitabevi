/*
  Admin display names for a stored member last_page.
  The stored value is unchanged. Unknown, hostile, and external values
  become نامەلۇم. Names are the existing storefront labels.
*/
(function (root) {
  "use strict";

  const UNKNOWN = "نامەلۇم";
  const BOOK = "كىتاب تەپسىلاتى";
  const PAGES = {
    "cart.html": "سېۋەت",
    "account.html": "ئەزالىق بېتى",
    "index.html": "باش بەت",
    "favorites.html": "ياقتۇرغانلىرىم",
    "books.html": "كىتابلار",
    "books": "كىتابلار",
    "my-books.html": "كىتابلىرىم",
    "order-info.html": "زاكاز چۈشەندۈرۈشى",
    "order-info": "زاكاز چۈشەندۈرۈشى",
    "privacy.html": "مەخپىيەتلىك",
    "privacy": "مەخپىيەتلىك",
    "returns.html": "قايتۇرۇش",
    "returns": "قايتۇرۇش",
    "delete-account.html": "ھېساب ئۆچۈرۈش",
    "delete-account": "ھېساب ئۆچۈرۈش",
    "feedback.html": "تەكلىپ",
    "feedback": "تەكلىپ",
    "reset-password.html": "پارول يېڭىلاش",
    "adabiyat": "ئەدەبىيات",
    "adabiyat.html": "ئەدەبىيات",
    "romanlar": "رومانلار",
    "romanlar.html": "رومانلار",
    "tarikhiy-romanlar": "تارىخىي رومانلار",
    "tarikhiy-romanlar.html": "تارىخىي رومانلار",
    "sheirlar": "شېئىرلار",
    "sheirlar.html": "شېئىرلار",
    "hekayiler": "ھېكايىلەر",
    "hekayiler.html": "ھېكايىلەر",
    "dastanlar": "داستانلار",
    "dastanlar.html": "داستانلار",
    "dunya-edebiyati": "دۇنيا ئەدەبىياتى",
    "dunya-edebiyati.html": "دۇنيا ئەدەبىياتى",
    "adabiyat-roman": "ئەدەبىيات رومانلىرى",
    "adabiyat-roman.html": "ئەدەبىيات رومانلىرى",
    "uyghur-adabiyati": "ئۇيغۇر ئەدەبىياتى",
    "uyghur-adabiyati.html": "ئۇيغۇر ئەدەبىياتى",
    "universal": "ئۇنىۋېرسال",
    "universal.html": "ئۇنىۋېرسال",
    "tibb": "تېبابەت ۋە ساغلاملىق",
    "tibb.html": "تېبابەت ۋە ساغلاملىق",
    "derslik": "دەرسلىك",
    "derslik.html": "دەرسلىك",
    "terbiye": "پەرزەنت تەربىيەسى",
    "terbiye.html": "پەرزەنت تەربىيەسى",
    "dini": "دىنىي كىتابلار",
    "dini.html": "دىنىي كىتابلار",
    "children": "بالىلار كىتابلىرى",
    "children.html": "بالىلار كىتابلىرى",
    "dictionary": "لۇغەت",
    "dictionary.html": "لۇغەت",
    "grammar": "گرامماتىكا",
    "grammar.html": "گرامماتىكا",
    "iqtisad": "ئىقتىساد",
    "iqtisad.html": "ئىقتىساد",
    "taamlar": "تائاملار",
    "taamlar.html": "تائاملار"
  };

  function memberPageLabel(value) {
    if (value == null) return UNKNOWN;
    let raw = String(value).replace(/^\uFEFF/, "").trim();
    if (!raw || raw === "—" || raw === "-" || raw === "–") return UNKNOWN;
    if (raw.length > 500) return UNKNOWN;
    if (/[\u0000-\u001f\u007f<>\\]/.test(raw)) return UNKNOWN;
    if (/^(javascript|data|vbscript):/i.test(raw)) return UNKNOWN;
    const hash = raw.indexOf("#");
    if (hash >= 0) raw = raw.slice(0, hash);
    const query = raw.indexOf("?");
    if (query >= 0) raw = raw.slice(0, query);
    raw = raw.trim();
    if (!raw) return UNKNOWN;
    let path = raw;
    if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
      if (!/^https?:\/\//i.test(path)) return UNKNOWN;
      try {
        const url = new URL(path);
        const host = String(url.hostname || "").toLowerCase().replace(/\.$/, "");
        if (host !== "www.kutadgubilik.com" && host !== "kutadgubilik.com") return UNKNOWN;
        path = url.pathname || "/";
      } catch (err) {
        return UNKNOWN;
      }
    } else if (path.charAt(0) === "/" && path.charAt(1) === "/") {
      return UNKNOWN;
    }
    if (path.indexOf("\\") >= 0 || path.indexOf("..") >= 0) return UNKNOWN;
    let decoded = path;
    try {
      decoded = decodeURIComponent(path);
    } catch (err) {
      return UNKNOWN;
    }
    if (/[\u0000-\u001f\u007f<>\\]/.test(decoded) || decoded.indexOf("..") >= 0) return UNKNOWN;
    const parts = decoded.split("/").filter(Boolean);
    if (!parts.length) return "باش بەت";
    if (parts.length === 2 && parts[0] === "book" && /^\d+$/.test(parts[1])) return BOOK;
    if (parts.length === 1 && parts[0] === "book.html") return BOOK;
    if (parts.length === 1 && /^\d+$/.test(parts[0])) return BOOK;
    if (parts.length === 2 && parts[0] === "author") return "ئاپتور";
    if (parts.length === 2 && parts[0] === "translator") return "تەرجىمان";
    if (parts.length === 2 && parts[0] === "publisher") return "نەشرىيات";
    if (parts.length !== 1) return UNKNOWN;
    const key = parts[0];
    if (PAGES[key]) return PAGES[key];
    const lower = key.toLowerCase();
    if (PAGES[lower]) return PAGES[lower];
    return UNKNOWN;
  }

  const api = { UNKNOWN, memberPageLabel };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.KutadguMemberPageLabel = api;
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
