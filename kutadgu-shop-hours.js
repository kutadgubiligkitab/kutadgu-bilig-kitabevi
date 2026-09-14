/**
 * Canonical shop opening hours: validate, format Contact copy, format JSON-LD.
 * Fallback matches the current public Contact / schema.org values.
 */
(function (root) {
  "use strict";

  var FIELDS = ["weekdayOpen", "weekdayClose", "sundayOpen", "sundayClose"];
  var FALLBACK = {
    weekdayOpen: "08:30",
    weekdayClose: "20:00",
    sundayOpen: "10:30",
    sundayClose: "18:00"
  };
  var WEEKDAY_LABEL = "دۈشەنبە–شەنبە";
  var SUNDAY_LABEL = "يەكشەنبە";
  var ERR_MISSING = "ۋاقىتنى كىرگۈزۈڭ.";
  var ERR_INVALID = "ۋاقىت توغرا ئەمەس.";
  var ERR_ORDER = "تاقىلىش ۋاقتى ئېچىلىشتىن كېيىن بولسۇن.";

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function parseTime(value) {
    var raw = String(value == null ? "" : value).trim();
    var m = raw.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
    if (!m) return null;
    return { hh: Number(m[1]), mm: Number(m[2]), text: pad2(m[1]) + ":" + pad2(m[2]) };
  }

  function toMinutes(parsed) {
    return parsed.hh * 60 + parsed.mm;
  }

  function normalizeHours(raw) {
    var src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    var out = {};
    FIELDS.forEach(function (name) {
      var parsed = parseTime(src[name]);
      out[name] = parsed ? parsed.text : "";
    });
    return out;
  }

  function withFallback(raw) {
    var data = normalizeHours(raw);
    var out = {};
    FIELDS.forEach(function (name) {
      out[name] = data[name] || FALLBACK[name];
    });
    return out;
  }

  function validateHours(raw) {
    var src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    var parsed = {};
    for (var i = 0; i < FIELDS.length; i++) {
      var name = FIELDS[i];
      var value = String(src[name] == null ? "" : src[name]).trim();
      if (!value) return { ok: false, error: ERR_MISSING };
      var time = parseTime(value);
      if (!time) return { ok: false, error: ERR_INVALID };
      parsed[name] = time;
    }
    if (toMinutes(parsed.weekdayClose) <= toMinutes(parsed.weekdayOpen)) {
      return { ok: false, error: ERR_ORDER };
    }
    if (toMinutes(parsed.sundayClose) <= toMinutes(parsed.sundayOpen)) {
      return { ok: false, error: ERR_ORDER };
    }
    return {
      ok: true,
      hours: {
        weekdayOpen: parsed.weekdayOpen.text,
        weekdayClose: parsed.weekdayClose.text,
        sundayOpen: parsed.sundayOpen.text,
        sundayClose: parsed.sundayClose.text
      }
    };
  }

  function rangeText(open, close) {
    return open + "–" + close;
  }

  function formatContactHours(raw) {
    var hours = withFallback(raw);
    var weekday = rangeText(hours.weekdayOpen, hours.weekdayClose);
    var sunday = rangeText(hours.sundayOpen, hours.sundayClose);
    return {
      hours: hours,
      hoursText: WEEKDAY_LABEL + "\n" + weekday + "\n" + SUNDAY_LABEL + "\n" + sunday,
      hoursHtml: WEEKDAY_LABEL + "\n<span dir=\"ltr\">" + weekday + "</span>\n" + SUNDAY_LABEL + "\n<span dir=\"ltr\">" + sunday + "</span>"
    };
  }

  function formatOpeningHours(raw) {
    var hours = withFallback(raw);
    return [
      "Mo-Sa " + hours.weekdayOpen + "-" + hours.weekdayClose,
      "Su " + hours.sundayOpen + "-" + hours.sundayClose
    ];
  }

  var api = {
    FIELDS: FIELDS,
    FALLBACK: FALLBACK,
    WEEKDAY_LABEL: WEEKDAY_LABEL,
    SUNDAY_LABEL: SUNDAY_LABEL,
    parseTime: parseTime,
    normalizeHours: normalizeHours,
    withFallback: withFallback,
    validateHours: validateHours,
    formatContactHours: formatContactHours,
    formatOpeningHours: formatOpeningHours
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.KutadguShopHours = api;
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
