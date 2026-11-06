"use strict";

const aiSearch = require("../kutadgu-ai-search.js");

module.exports = async function aiSearchApi(req, res) {
  // This path has no Cloudflare trust boundary. A caller-supplied forwarding
  // header is not a client identity, so paid semantic search stays closed here.
  await aiSearch.handleAiSearch(req, res, {
    env: process.env,
    fetchImpl: fetch
  });
};
