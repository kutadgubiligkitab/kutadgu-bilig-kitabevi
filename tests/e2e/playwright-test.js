"use strict";

const { test: base, expect, devices } = require("@playwright/test");
const {
  installReadSafeNetwork,
  logMockedBookCoverSummary,
  logSupabaseReadCacheSummary
} = require("./helpers");

const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await installReadSafeNetwork(page);
    await use(page);
    logMockedBookCoverSummary(testInfo, page);
    logSupabaseReadCacheSummary(testInfo, page);
  }
});

module.exports = { test, expect, devices };
