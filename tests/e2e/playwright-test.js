"use strict";

const { test: base, expect, devices } = require("@playwright/test");
const {
  installBookCoverEgressGuard,
  installCatalogRpcBridge,
  logMockedBookCoverSummary
} = require("./helpers");

const test = base.extend({
  page: async ({ page, context }, use, testInfo) => {
    await installBookCoverEgressGuard(page);
    await installCatalogRpcBridge(context);
    await use(page);
    logMockedBookCoverSummary(testInfo, page);
  }
});

module.exports = { test, expect, devices };
