"use strict";

const assert = require("assert");
const labels = require("../kutadgu-member-page-label.js");

const cases = [
  ["cart.html", "سېۋەت"],
  ["/cart.html", "سېۋەت"],
  ["cart.html?utm_source=ad&fbclid=1#top", "سېۋەت"],
  ["https://www.kutadgubilik.com/cart.html?share=abc", "سېۋەت"],
  ["account.html", "ئەزالىق بېتى"],
  ["/account.html?next=1", "ئەزالىق بېتى"],
  ["index.html", "باش بەت"],
  ["/", "باش بەت"],
  ["https://kutadgubilik.com/", "باش بەت"],
  ["favorites.html", "ياقتۇرغانلىرىم"],
  ["books", "كىتابلار"],
  ["books.html", "كىتابلار"],
  ["/book/122", "كىتاب تەپسىلاتى"],
  ["book.html?id=122", "كىتاب تەپسىلاتى"],
  ["122", "كىتاب تەپسىلاتى"],
  ["romanlar", "رومانلار"],
  ["/adabiyat", "ئەدەبىيات"],
  ["iqtisad.html", "ئىقتىساد"],
  ["taamlar", "تائاملار"],
  ["/author/someone", "ئاپتور"],
  ["/translator/someone", "تەرجىمان"],
  ["/publisher/someone", "نەشرىيات"],
  ["", "نامەلۇم"],
  [null, "نامەلۇم"],
  ["—", "نامەلۇم"],
  ["not-a-page", "نامەلۇم"],
  ["https://evil.example/cart.html", "نامەلۇم"],
  ["javascript:alert(1)", "نامەلۇم"],
  ["<script>alert(1)</script>", "نامەلۇم"],
  ["cart.html\"><img src=x>", "نامەلۇم"],
  ["../../etc/passwd", "نامەلۇم"],
  ["//evil.example/cart.html", "نامەلۇم"],
  ["Ab3K7xQ2", "نامەلۇم"]
];

cases.forEach((pair) => {
  const actual = labels.memberPageLabel(pair[0]);
  assert.strictEqual(actual, pair[1], JSON.stringify(pair[0]) + " -> " + actual);
  assert.strictEqual(actual.includes("<"), false);
  assert.strictEqual(actual.includes("http"), false);
  assert.strictEqual(actual.includes(".html"), false);
});

console.log("member-page-label-tests ok");
