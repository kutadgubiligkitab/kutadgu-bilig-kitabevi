/**
 * Stage 14 — last-import missing-cover queue (this run only, no catalog scan).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.KutadguAdminImportIntake = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function hasImageUrl(row) {
    return !!(row && String(row.image_url || "").trim());
  }

  function canonicalId(row) {
    if (!row) return "";
    if (row.insertedId != null && row.insertedId !== "") return String(row.insertedId);
    if (row.dbMatch && row.dbMatch.id != null && row.dbMatch.id !== "") return String(row.dbMatch.id);
    return "";
  }

  function isCanonicalNumericId(value) {
    return /^\d+$/.test(String(value || "").trim());
  }

  function repairLookupValue(id) {
    const s = String(id == null ? "" : id).trim();
    return isCanonicalNumericId(s) ? s : "";
  }

  function coverOkFor(id, coverOkByKey) {
    return !!(id && coverOkByKey && coverOkByKey[String(id)]);
  }

  /**
   * Build missing-cover items from THIS import's succeeded rows only.
   * Does not query the books table.
   */
  function buildMissingCoverQueue(succeededRows, coverOkByKey) {
    const items = [];
    (succeededRows || []).forEach(function (row) {
      if (!row) return;
      const id = canonicalId(row);
      if (!isCanonicalNumericId(id)) return;
      if (coverOkFor(id, coverOkByKey)) return;

      const matched = row.coverStatus === "matched";
      if (matched) {
        items.push({
          id: id,
          title: row.title || "",
          author: row.author || "",
          reason: "upload_failed",
          reasonLabel: "مۇقاۋا يۈكلەنمىدى"
        });
        return;
      }

      const isInsert = row.insertedId != null && row.insertedId !== "";
      if (isInsert && !hasImageUrl(row)) {
        items.push({
          id: id,
          title: row.title || "",
          author: row.author || "",
          reason: "none",
          reasonLabel: "مۇقاۋا تەلەپ قىلىنمىدى"
        });
      }
    });
    return items;
  }

  function replaceLastImportQueue(previous, nextItems) {
    return Array.isArray(nextItems) ? nextItems.slice() : [];
  }

  function appendQueueCount(resultText, queueLength) {
    return String(resultText || "") + "، مۇقاۋا نۆۋىتى " + Number(queueLength || 0);
  }

  return {
    hasImageUrl: hasImageUrl,
    canonicalId: canonicalId,
    isCanonicalNumericId: isCanonicalNumericId,
    repairLookupValue: repairLookupValue,
    buildMissingCoverQueue: buildMissingCoverQueue,
    replaceLastImportQueue: replaceLastImportQueue,
    appendQueueCount: appendQueueCount
  };
});
