"use strict";

const aiSearch = require("../kutadgu-ai-search.js");

module.exports = async function aiSearchApi(req, res) {
  await aiSearch.handleAiSearch(req, res, {
    env: process.env,
    fetchImpl: fetch
  });
};
