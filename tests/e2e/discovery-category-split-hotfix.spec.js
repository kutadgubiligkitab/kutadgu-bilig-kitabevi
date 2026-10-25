const { test } = require("./playwright-test");
const { registerRemovedDiscoveryTests } = require("./removed-discovery-absence");

test.describe("discovery category split", () => {
  registerRemovedDiscoveryTests();
});
