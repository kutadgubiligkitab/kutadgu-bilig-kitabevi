"use strict";

const { test: base, expect, devices } = require("@playwright/test");
const {
  installBookCoverEgressGuard,
  logMockedBookCoverSummary
} = require("./helpers");

const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await installBookCoverEgressGuard(page);
    await use(page);
    logMockedBookCoverSummary(testInfo, page);
  }
});

module.exports = { test, expect, devices };
