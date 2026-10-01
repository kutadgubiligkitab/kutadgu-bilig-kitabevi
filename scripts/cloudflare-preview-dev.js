#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");

function previewDevConfig(options) {
  const opts = options || {};
  const source = JSON.parse(fs.readFileSync(path.join(repoRoot, "wrangler.jsonc"), "utf8"));
  const configDir = opts.configDir || fs.mkdtempSync(path.join(os.tmpdir(), "kutadgu-cf-preview-"));
  const config = Object.assign({}, source, {
    main: path.join(repoRoot, "cloudflare", "worker.js"),
    assets: Object.assign({}, source.assets, { directory: repoRoot })
  });
  return {
    repoRoot: repoRoot,
    configDir: configDir,
    configPath: path.join(configDir, "wrangler.jsonc"),
    config: config
  };
}

function writePreviewDevConfig(options) {
  const built = previewDevConfig(options);
  fs.mkdirSync(built.configDir, { recursive: true });
  fs.writeFileSync(built.configPath, JSON.stringify(built.config, null, 2));
  return built;
}

function main() {
  const built = writePreviewDevConfig();
  const wrangler = path.join(repoRoot, "node_modules", "wrangler", "bin", "wrangler.js");
  const port = process.env.PORT || "8787";
  const child = spawn(process.execPath, [
    wrangler,
    "dev",
    "--config", built.configPath,
    "--ip", "127.0.0.1",
    "--port", port,
    "--persist-to", path.join(built.configDir, "state"),
    "--local",
    "--show-interactive-dev-session=false"
  ], {
    cwd: built.configDir,
    stdio: "inherit",
    env: process.env
  });
  const stop = () => {
    child.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code) => {
    process.exit(code == null ? 1 : code);
  });
}

if (require.main === module) {
  main();
} else {
  module.exports = {
    repoRoot: repoRoot,
    previewDevConfig: previewDevConfig,
    writePreviewDevConfig: writePreviewDevConfig
  };
}
