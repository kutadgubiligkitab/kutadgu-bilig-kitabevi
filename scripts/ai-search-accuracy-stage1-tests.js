#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Ai = require("../kutadgu-ai-search.js");

const DISTRACTOR = {
  id: 9001,
  title: "مۇناسىۋەتسىز رومان",
  author: "باشقا ئاپتور",
  category: "رومانلار",
  description: "",
  similarity: 0.86,
  is_active: true,
  submission_status: "approved"
};

const BOOKS = [
  { id: 1, title: "36 تەدبىر", author: "ھارروۋون سىنىگېر (شىۋىتسارىيە)", category: "ئۇنىۋېرسال", description: "ئۇتۇققا ئېرىشىش ھەققىدە قىسقا كىرىش سۆز." },
  { id: 2, title: "يەر ئانا", author: "چىڭغىز ئايتماتوۋ", category: "دۇنيا ئەدەبىياتى", description: "قىرغىز يېزىسى ۋە ئانا زېمىن ھەققىدە رومان." },
  { id: 3, title: "تاغلار غۇلىغاندا", author: "چىڭغىز ئايتماتوۋ (قىرغىزىستان)", category: "دۇنيا ئەدەبىياتى", description: "" },
  { id: 4, title: "ئىسكەندەرنامە 1.قىسىم", author: "سەيىد مەھدى ھەمدانى", category: "دۇنيا ئەدەبىياتى", description: "" },
  { id: 5, title: "ئىسكەندەرنامە 2.قىسىم", author: "سەيىد مەھدى ھەمدانى", category: "دۇنيا ئەدەبىياتى", description: "" },
  { id: 6, title: "ئىسكەندەرنامە 3.قىسىم", author: "سەيىد مەھدى ھەمدانى", category: "دۇنيا ئەدەبىياتى", description: "" },
  { id: 7, title: "ئويغانغان زېمىن", author: "ئابدۇرېھىم ئۆتكۈر", category: "تارىخىي رومانلار", description: "ئۇيغۇر تارىخىي رومانى.", kind: "group" },
  { id: 8, title: "ئاننا كارېنىنا", author: "لېۋ تولستوي", category: "دۇنيا ئەدەبىياتى", description: "روس ئەدەبىياتىدىكى رومان.", kind: "group" },
  { id: 9, title: "نۇزۇگۇم", author: "تۇرغان توختەم", category: "تارىخىي رومانلار", description: "تارىخىي قەھرىمان ھەققىدە." },
  { id: 10, title: "زەپەرنامە", author: "شەرەفىدىن ئەلى يەزدى", category: "تارىخىي ماتېرىيال", description: "" },
  { id: 11, title: "قاراخانىلارنىڭ قىسقىچە تارىخى", author: "ھاجى نۇرھاجى", category: "تارىخىي ماتېرىيال", description: "قاراخانىيلار دەۋرى." },
  { id: 12, title: "ئۆلۈۋېلىش سەنئىتى", author: "پەرھات تۇرسۇن", category: "رومان", description: "" },
  { id: 13, title: "ئادەتنىڭ سېھرى كۈچى", author: "شۆھرەت مۇھەممەت", category: "پىسخىكىلىق ساغلاملىق", description: "ئادەت يېتىلدۈرۈش ھەققىدە." },
  { id: 14, title: "ئابرال ئۇنتۇمايدۇ", author: "مىركايىل نۇرئالىم", category: "رومان", description: "" },
  { id: 15, title: "سەئىدخان", author: "ھاجى مىرزاھىد كېرىمى، ساۋۇت داۋۇت", category: "تارىخىي رومانلار", description: "" },
  { id: 16, title: "كىچىك قۇش", author: "", category: "بالىلار كىتابلىرى", description: "" },
  { id: 17, title: "رەڭلىك رەسىم", author: "", category: "بالىلار كىتابلىرى", description: "" },
  { id: 18, title: "باتۇخان", author: "", category: "تارىخىي رومانلار", description: "موڭغۇل خانى ھەققىدە يۈرۈشلەر.", kind: "group" },
  { id: 19, title: "لۇغەت", author: "نەشرىيات", category: "لۇغەت", description: "ئۇيغۇرچە سۆزلۈك." },
  { id: 20, title: "گرامماتىكا دەرسلىكى", author: "مەكتەپ", category: "گرامماتىكا", description: "" },
  { id: 21, title: "يوشۇرۇن كىتاب", author: "يوشۇرۇن", category: "رومان", description: "بۇ كىتاب كۆرۈنمەسلىكى كېرەك.", is_active: false, submission_status: "approved" },
  { id: 22, title: "تەستىقلانمىغان كىتاب", author: "تەستىق", category: "رومان", description: "", is_active: true, submission_status: "pending" }
].map((row) => Object.assign({ similarity: 0.2, is_active: true, submission_status: "approved", price: 10, image_url: "", stock: 1 }, row));

function search(query) {
  return Ai.selectRelevantResults(query, BOOKS.concat(DISTRACTOR));
}

function ids(query) {
  return search(query).map((row) => row.id);
}

const CASES = [
  ["exact-36", "36 تەدبىر", [1], [9001]],
  ["exact-yer", "يەر ئانا", [2], [9001]],
  ["exact-nuzugum", "نۇزۇگۇم", [9], [9001]],
  ["exact-zefer", "زەپەرنامە", [10], [9001]],
  ["exact-karakhan", "قاراخانىلارنىڭ قىسقىچە تارىخى", [11], [9001]],
  ["exact-oluw", "ئۆلۈۋېلىش سەنئىتى", [12], [9001]],
  ["exact-adet", "ئادەتنىڭ سېھرى كۈچى", [13], [9001]],
  ["exact-abral", "ئابرال ئۇنتۇمايدۇ", [14], [9001]],
  ["exact-seid", "سەئىدخان", [15], [9001]],
  ["exact-child", "كىچىك قۇش", [16], [9001]],
  ["exact-picture", "رەڭلىك رەسىم", [17], [9001]],
  ["exact-series", "ئويغانغان زېمىن", [7], [9001]],
  ["exact-anna", "ئاننا كارېنىنا", [8], [9001]],
  ["exact-batu", "باتۇخان", [18], [9001]],
  ["partial-iskender", "ئىسكەندەر", [4, 5, 6], [9001, 2]],
  ["partial-iskendername", "ئىسكەندەرنامە", [4, 5, 6], [9001]],
  ["partial-karakhan", "قاراخانى", [11], [9001]],
  ["partial-zefer", "زەپەر", [10], [9001]],
  ["partial-adet", "سېھرى كۈچى", [13], [9001]],
  ["partial-child", "رەڭلىك", [17], [9001]],
  ["author-aitmatov", "چىڭغىز ئايتماتوۋ", [2, 3], [9001]],
  ["author-aitmatov-books", "چىڭغىز ئايتماتوۋنىڭ كىتابلىرى", [2, 3], [9001]],
  ["spell-aitmatov", "چىڭگىز ئايتماتوۋ", [2, 3], [9001]],
  ["spell-iskender", "ئىسكەندەر نامە", [4, 5, 6], [9001]],
  ["spell-anna", "ئانا كارېنىنا", [8], [9001]],
  ["spell-series", "ئويغانغان زىمىن", [7], [9001]],
  ["author-turgan", "تۇرغان توختەم", [9], [9001]],
  ["author-perhat", "پەرھات تۇرسۇن", [12], [9001]],
  ["author-shohret", "شۆھرەت مۇھەممەت", [13], [9001]],
  ["author-nurhaji", "ھاجى نۇرھاجى", [11], [9001]],
  ["author-hamdani", "سەيىد مەھدى ھەمدانى", [4, 5, 6], [9001]],
  ["series-oyghan", "ئويغانغان زېمىن", [7], [2]],
  ["series-anna", "ئاننا كارېنىنا", [8], [2]],
  ["series-batu", "باتۇخان", [18], [9]],
  ["topic-history", "تارىخىي رومان", [7, 9, 15, 18], [2, 9001]],
  ["topic-dictionary", "لۇغەت", [19], [9001]],
  ["topic-grammar", "گرامماتىكا", [20], [9001]],
  ["topic-children-category", "بالىلار كىتابلىرى", [16, 17], [9001]],
  ["desc-habit", "ئادەت يېتىلدۈرۈش", [13], [9001]],
  ["desc-qarakhan", "قاراخانىيلار دەۋرى", [11], [9001]],
  ["desc-batu", "موڭغۇل خانى", [18], [9001]],
  ["desc-yer", "قىرغىز يېزىسى", [2], [3, 9001]],
  ["child-no-desc-1", "كىچىك قۇش", [16], [9001]],
  ["child-no-desc-2", "رەڭلىك رەسىم", [17], [9001]],
  ["child-category", "بالىلار", [16, 17], [9001]],
  ["none-car", "ماشىنا رېمونت قوللانمىسى", [], [9001]],
  ["none-piano", "پىيانىنو ئۆگىتىش", [], [9001]],
  ["none-japan", "ياپون تامىقى", [], [9001]],
  ["none-photo", "فوتوشوپ دەرسلىكى", [], [9001]],
  ["none-code", "كومپيۇتېر پروگرامما", [], [9001]],
  ["none-ielts", "ئىنگلىزچە IELTS", [], [9001]],
  ["none-physics", "فىزىكا مەسىلىلىرى", [], [9001]],
  ["none-dive", "سۇ ئاستى سۈرەتلىرى", [], [9001]],
  ["none-game", "موباسەرە تور ئويۇنى", [], [9001]],
  ["none-football", "پۇتبول قائىدىسى", [], [9001]],
  ["hidden-inactive", "يوشۇرۇن كىتاب", [], [21, 9001]],
  ["hidden-pending", "تەستىقلانمىغان كىتاب", [], [22, 9001]],
  ["exact-beats-semantic", "يەر ئانا", [2], [9001, 3]],
  ["partial-volume", "1.قىسىم", [4], [5, 6, 9001]],
  ["author-not-other", "پەرھات تۇرسۇن", [12], [2, 9, 9001]],
  ["series-not-volume-neighbor", "ئويغانغان زېمىن", [7], [4, 9001]],
  ["description-not-title", "ئۇيغۇرچە سۆزلۈك", [19], [20, 9001]],
  ["grammar-book", "گرامماتىكا دەرسلىكى", [20], [19, 9001]]
];

let correct = 0;
let partial = 0;
let incorrect = 0;
const failures = [];

CASES.forEach((row) => {
  const [name, query, expected, rejected] = row;
  const found = ids(query);
  const missing = expected.filter((id) => found.indexOf(id) === -1);
  const bad = rejected.filter((id) => found.indexOf(id) !== -1);
  const firstOk = !expected.length || found[0] === expected[0] || expected.indexOf(found[0]) !== -1;
  if (!missing.length && !bad.length && firstOk) {
    correct += 1;
    console.log("PASS", name);
    return;
  }
  if (!bad.length && !missing.length) {
    partial += 1;
    console.log("PARTIAL", name, found.join(","));
    return;
  }
  incorrect += 1;
  failures.push(name + " found=" + found.join(",") + " missing=" + missing.join(",") + " bad=" + bad.join(","));
  console.error("FAIL", name, failures[failures.length - 1]);
});

assert.ok(CASES.length >= 60, "need at least 60 queries");
assert.strictEqual(incorrect, 0, failures.join("\n"));
console.log("queries", CASES.length, "correct", correct, "partial", partial, "incorrect", incorrect);
console.log("ai-search-accuracy-stage1-tests ok");
