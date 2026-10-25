"use strict";

const fs = require("fs");
const path = require("path");
const variants = require("../kutadgu-cover-variants.js");

function readSources(file){
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.sources)) return parsed.sources;
  throw new Error("The source file must be a list of cover records.");
}

function buildManifest(sources){
  const plans = sources.map(variants.planDelivery);
  return {
    dryRun: true,
    version: variants.VERSION,
    widths: variants.WIDTHS,
    quality: variants.WEBP_QUALITY,
    generatedAt: new Date().toISOString(),
    count: plans.length,
    uploadCount: plans.reduce(function(sum, plan){ return sum + plan.variants.length; }, 0),
    plans: plans
  };
}

function main(argv){
  const args = argv.slice(2);
  if (args.indexOf("--upload") >= 0) {
    throw new Error("This command is a dry run. It does not upload to R2.");
  }
  const input = args.find(function(arg){ return !arg.startsWith("--"); });
  if (!input) throw new Error("Pass a JSON file of cover records.");
  const manifest = buildManifest(readSources(path.resolve(input)));
  const outFlag = args.indexOf("--out");
  const out = outFlag >= 0 ? args[outFlag + 1] : "";
  const text = JSON.stringify(manifest, null, 2);
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(path.resolve(out), text);
  } else {
    process.stdout.write(text + "\n");
  }
  return manifest;
}

if (require.main === module) {
  try { main(process.argv); }
  catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}

module.exports = { buildManifest, main };
