#!/usr/bin/env node
"use strict";
/**
 * Compare unsharded Playwright identities with shard 1/2 and shard 2/2.
 * The lists must be the same set: no omissions and no duplicates.
 */
const path = require("path");
const { spawnSync } = require("child_process");

function parseList(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, "/"))
    .filter((line) => line.includes("›"));
}

function compareShardIdentities(full, shardLists) {
  const problems = [];
  const fullIds = Array.isArray(full) ? full : [];
  const fullSet = new Set(fullIds);
  if (fullSet.size !== fullIds.length) problems.push("unsharded list has duplicate identities");

  const seen = new Map();
  shardLists.forEach((list, index) => {
    const shard = index + 1;
    const local = new Set();
    list.forEach((id) => {
      if (local.has(id)) problems.push(`duplicate inside shard ${shard}: ${id}`);
      local.add(id);
      if (seen.has(id)) problems.push(`duplicate across shards ${seen.get(id)} and ${shard}: ${id}`);
      else seen.set(id, shard);
      if (!fullSet.has(id)) problems.push(`unexpected shard identity: ${id}`);
    });
  });
  fullIds.forEach((id) => {
    if (!seen.has(id)) problems.push(`omitted identity: ${id}`);
  });
  if (shardLists.length !== 2) problems.push(`expected 2 shards, found ${shardLists.length}`);
  return {
    ok: problems.length === 0,
    problems,
    fullCount: fullIds.length,
    shardCounts: shardLists.map((list) => list.length)
  };
}

function listIdentities(shard) {
  const cli = require.resolve("@playwright/test/cli");
  const args = [cli, "test", "--list", "--reporter=line"];
  if (shard) args.push(`--shard=${shard}`);
  const result = spawnSync(process.execPath, args, {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "",
      GITHUB_EVENT_NAME: "",
      KUTADGU_USE_LOCAL_STATIC: "",
      KUTADGU_PREVIEW_URL: "",
      KUTADGU_BASE_URL: "http://127.0.0.1:4173",
      KUTADGU_E2E_PREVIEW: ""
    }
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (result.status !== 0) {
    throw new Error(`playwright --list ${shard || "all"} failed\n${output}`);
  }
  return parseList(output);
}

function main() {
  const full = listIdentities("");
  const shard1 = listIdentities("1/2");
  const shard2 = listIdentities("2/2");
  const result = compareShardIdentities(full, [shard1, shard2]);
  console.log(`[e2e-shards] full=${result.fullCount} shard1=${result.shardCounts[0]} shard2=${result.shardCounts[1]}`);
  if (!result.ok) {
    result.problems.slice(0, 20).forEach((problem) => console.error(`[e2e-shards] ${problem}`));
    process.exit(1);
  }
  console.log("[e2e-shards] coverage matches");
}

module.exports = { parseList, compareShardIdentities, listIdentities };

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("[e2e-shards] failed:", err && err.message ? err.message : err);
    process.exit(1);
  }
}
