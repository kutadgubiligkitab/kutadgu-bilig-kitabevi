#!/usr/bin/env node
"use strict";

const path = require("path");
const { checkAssetPins } = require("./ci-asset-pins");

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, "..");
const result = checkAssetPins(root);
if (!result.ok) {
  for (const problem of result.problems) console.error(problem);
  process.exit(1);
}
console.log("asset pin preflight passed");
