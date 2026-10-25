const { test } = require("./playwright-test");
const { registerRemovedDiscoveryTests } = require("./removed-discovery-absence");

test.describe("premium discovery cover retry", () => {
  registerRemovedDiscoveryTests();
});
