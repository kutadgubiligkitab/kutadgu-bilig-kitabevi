const { test } = require("./playwright-test");
const { registerRemovedDiscoveryTests } = require("./removed-discovery-absence");

test.describe("compact discovery carousel cards", () => {
  registerRemovedDiscoveryTests();
});