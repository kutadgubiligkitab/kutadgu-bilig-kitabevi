const { test, expect } = require("./playwright-test");

// MOCKED TURNSTILE. This spec does not call Siteverify and does not load
// https://challenges.cloudflare.com. window.turnstile is a local stand-in
// marked data-mocked-turnstile="true".

function exercisePage(disabled) {
  const config = disabled
    ? "<script>window.KUTADGU_APP_CONFIG={featureFlags:{analyticsHooks:false}};</script>"
    : "";
  const root = disabled ? "<html>" : "<html data-kutadgu-visit-exercise>";
  return "<!DOCTYPE html>" + root + "<head>" + config + "</head><body><p id=\"browsing\">ok</p><script src=\"/visit-proof.js?v=2\"></script></body></html>";
}

async function serveExercise(page, disabled) {
  await page.route("**/visit-proof-exercise.html", (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: exercisePage(disabled)
  }));
}

test("mocked Turnstile widget is removed after successful verification and counting", async ({ page }) => {
  const calls = [];
  await page.addInitScript(() => {
    window.turnstile = {
      render(slot, options) {
        slot.setAttribute("data-mocked-turnstile", "true");
        window.__mockedTurnstile = true;
        if (typeof options["before-interactive-callback"] === "function") options["before-interactive-callback"]();
        window.__mockedTurnstileComplete = () => options.callback("mocked-token");
      },
      remove() {}
    };
  });
  await page.route("**/api/visit-count", (route) => {
    calls.push("count");
    const first = calls.filter((name) => name === "count").length === 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(first
        ? { ok: false, counted: false, reason: "cookie_missing" }
        : { ok: true, counted: true, reason: "accepted" })
    });
  });
  await page.route("**/api/visit-proof", (route) => {
    calls.push("proof");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, counted: false, reason: "proof_accepted" })
    });
  });
  await page.route("**/api/visit-config", (route) => {
    calls.push("config");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ configured: true, siteKey: "mocked-site-key", action: "visit" })
    });
  });
  await page.route("**/challenges.cloudflare.com/**", (route) => {
    calls.push("turnstile-script");
    return route.abort();
  });
  await serveExercise(page, false);
  await page.goto("/visit-proof-exercise.html");
  const panel = page.locator("#kutadgu-visit-check");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("زىيارەت سانىنى دەلىللەش ئۈچۈن بۇ تەكشۈرۈشنى تاماملاڭ.");
  await expect(panel.locator("[data-mocked-turnstile='true']")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.__mockedTurnstile === true)).toBe(true);
  expect(calls).not.toContain("turnstile-script");
  await page.evaluate(() => window.__mockedTurnstileComplete());
  await expect(panel).toHaveCount(0);
  await expect(page.locator("#browsing")).toBeVisible();
  await page.locator("#browsing").click();
  expect(calls.filter((name) => name === "count")).toHaveLength(2);
  expect(calls).toContain("proof");
  expect(calls).toContain("config");
});

test("analyticsHooks false skips counting, configuration, and Turnstile", async ({ page }) => {
  const calls = [];
  await page.route("**/api/visit-count", (route) => {
    calls.push(route.request().url());
    return route.abort();
  });
  await page.route("**/api/visit-proof", (route) => {
    calls.push(route.request().url());
    return route.abort();
  });
  await page.route("**/api/visit-config", (route) => {
    calls.push(route.request().url());
    return route.abort();
  });
  await page.route("**/challenges.cloudflare.com/**", (route) => {
    calls.push(route.request().url());
    return route.abort();
  });
  await page.route("**/visit-proof.js?v=2", (route) => route.continue());
  await serveExercise(page, true);
  await page.goto("/visit-proof-exercise.html");
  await expect(page.locator("#browsing")).toBeVisible();
  await expect.poll(() => calls.length).toBe(0);
  await expect(page.locator("#kutadgu-visit-check")).toHaveCount(0);
});

test("localhost without the exercise attribute does not count", async ({ page }) => {
  const calls = [];
  await page.route("**/api/visit-count", (route) => {
    calls.push("count");
    return route.abort();
  });
  await page.route("**/visit-proof-exercise.html", (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<!DOCTYPE html><html><head><script>window.KUTADGU_APP_CONFIG={featureFlags:{analyticsHooks:true}};</script></head><body><p id=\"browsing\">ok</p><script src=\"/visit-proof.js?v=2\"></script></body></html>"
  }));
  await page.goto("/visit-proof-exercise.html");
  await expect(page.locator("#browsing")).toBeVisible();
  await expect.poll(() => calls.length).toBe(0);
});
