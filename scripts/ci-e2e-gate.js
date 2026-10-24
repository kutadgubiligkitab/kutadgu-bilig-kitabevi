#!/usr/bin/env node
"use strict";
/**
 * Stage 10 shard gate.
 * The required check is the e2e job. It is green only when every required shard
 * uploaded a success result. A missing, failed, cancelled, or skipped shard fails.
 */
const fs = require("fs");
const path = require("path");

const REQUIRED_SHARDS = [1, 2];
const RESULT_NAME = "e2e-shard-result.json";

function evaluateGate(input) {
  const needs = String(input && input.needsResult || "").trim();
  const records = Array.isArray(input && input.records) ? input.records : [];
  const problems = [];
  if (needs !== "success") problems.push(`shard job result is ${needs || "missing"}`);

  const byShard = new Map();
  records.forEach((record) => {
    const shard = Number(record && record.shard);
    if (byShard.has(shard)) problems.push(`duplicate shard ${shard}`);
    byShard.set(shard, record || {});
  });

  REQUIRED_SHARDS.forEach((shard) => {
    const record = byShard.get(shard);
    if (!record) {
      problems.push(`missing shard ${shard}`);
      return;
    }
    const outcome = String(record.outcome || "").trim();
    if (outcome !== "success") problems.push(`shard ${shard} outcome is ${outcome || "missing"}`);
    if (Number(record.total) !== REQUIRED_SHARDS.length) {
      problems.push(`shard ${shard} total is ${record.total}`);
    }
  });

  byShard.forEach((record, shard) => {
    if (!REQUIRED_SHARDS.includes(shard)) problems.push(`unexpected shard ${shard}`);
  });

  return { ok: problems.length === 0, problems };
}

function readShardRecords(dir) {
  const records = [];
  if (!dir || !fs.existsSync(dir)) return records;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    fs.readdirSync(current, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name === RESULT_NAME) {
        records.push(JSON.parse(fs.readFileSync(full, "utf8")));
      }
    });
  }
  return records;
}

function recordShard(options) {
  const body = {
    shard: Number(options.shard),
    total: Number(options.total),
    outcome: String(options.outcome || "").trim()
  };
  if (!REQUIRED_SHARDS.includes(body.shard)) {
    throw new Error(`shard must be one of ${REQUIRED_SHARDS.join(", ")}`);
  }
  if (body.total !== REQUIRED_SHARDS.length) throw new Error(`total must be ${REQUIRED_SHARDS.length}`);
  const file = options.file || RESULT_NAME;
  fs.writeFileSync(file, JSON.stringify(body) + "\n");
  return body;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function checkGate(options) {
  const records = readShardRecords(options.dir);
  const result = evaluateGate({ needsResult: options.needs, records });
  if (result.ok) {
    console.log(`[e2e-gate] success shards=${REQUIRED_SHARDS.join(",")}`);
    return 0;
  }
  result.problems.forEach((problem) => console.error(`[e2e-gate] ${problem}`));
  console.error("[e2e-gate] refusing a green result");
  return 1;
}

function main(argv) {
  const args = parseArgs(argv);
  const command = args._[0];
  if (command === "record") {
    recordShard({
      shard: args.shard,
      total: args.total,
      outcome: args.outcome,
      file: args.file
    });
    return 0;
  }
  if (command === "check") return checkGate({ dir: args.dir, needs: args.needs });
  console.error("[e2e-gate] use record or check");
  return 1;
}

module.exports = {
  REQUIRED_SHARDS,
  RESULT_NAME,
  evaluateGate,
  readShardRecords,
  recordShard,
  checkGate
};

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error("[e2e-gate] failed:", err && err.message ? err.message : err);
    process.exit(1);
  }
}
