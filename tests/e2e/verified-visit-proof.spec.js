const { test, expect } = require("./playwright-test");

// MOCKED TURNSTILE AND MOCKED RPC. These cases do not call Siteverify, do not
// load https://challenges.cloudflare.com, and do not submit a production
// proof or count. window.turnstile is a local stand-in marked
// data-mocked-turnstile="true".
//
// REALISTIC TURNSTILE FOOTPRINT. Cloudflare documents the default normal
// widget as 300 by 65, flexible as a minimum width of 300, and compact as
// 150 by 140. The labelled fixture below is the normal 300 by 65 stand-in
// this page requests. It is not a live challenge.

const NOTE = "زىيارەت سانىنى دەلىللەش ئۈچۈن بۇ تەكشۈرۈشنى تاماملاڭ.";

function exercisePage(disabled) {
  const config = disabled
    ? "<script>window.KUTADGU_APP_CONFIG={featureFlags:{analyticsHooks:false}};</script>"
    : "";
  const root = disabled ? "<html lang=\"ug\" dir=\"rtl\">" : "<html lang=\"ug\" dir=\"rtl\" data-kutadgu-visit-exercise>";
  return "<!DOCTYPE html>" + root + "<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\"><link rel=\"stylesheet\" href=\"/theme.css\"><link rel=\"stylesheet\" href=\"/mobile.css\">" + config + "</head><body>"
    + "<header><a id=\"home-link\" href=\"/\">قۇتادغۇبىلىك كىتابخانىسى</a></header>"
    + "<main id=\"browsing\" style=\"min-height:240px\">ok</main>"
    + "<nav class=\"mobile-bottom-nav\" aria-label=\"تېلېفون تېز يول باشلاش\">"
    + "<a href=\"/cart.html\"><span>سېۋەت</span></a>"
    + "<a href=\"/favorites.html\"><span>ياقتۇرغانلىرىم</span></a>"
    + "<a href=\"/account.html\"><span>كىرىش / ئەزا</span></a>"
    + "</nav><script src=\"/visit-proof.js?v=4\"></script></body></html>";
}

async function installTurnstile(page, holdInteraction, realistic) {
  await page.addInitScript(({ hold, realistic }) => {
    window.__holdInteraction = hold;
    window.turnstile = {
      render(slot, options) {
        slot.setAttribute("data-mocked-turnstile", "true");
        window.__turnstileOptions = {
          appearance: options.appearance,
          retry: options.retry,
          refreshExpired: options["refresh-expired"],
          action: options.action,
          size: options.size
        };
        window.__heldInteractive = options["before-interactive-callback"] || null;
        window.__mockedTurnstile = true;
        if (hold && typeof options["before-interactive-callback"] === "function") options["before-interactive-callback"]();
        if (realistic) {
          const box = document.createElement("div");
          box.setAttribute("data-mocked-turnstile", "true");
          box.setAttribute("data-turnstile-fixture", "realistic-normal");
          box.style.cssText = "display:block;width:300px;height:65px;min-width:300px;max-width:none;margin:0;box-sizing:content-box;transform:none;overflow:visible;";
          box.textContent = "REALISTIC TURNSTILE FIXTURE 300x65";
          slot.appendChild(box);
        }
        window.__mockedTurnstileComplete = (token) => options.callback(token || "mocked-token");
        window.__mockedTurnstileAgain = (token) => options.callback(token || "mocked-token-2");
        window.__mockedTurnstileError = () => options["error-callback"] && options["error-callback"]("network");
        window.__mockedTurnstileExpire = () => options["expired-callback"] && options["expired-callback"]();
        window.__mockedTurnstileTimeout = () => options["timeout-callback"] && options["timeout-callback"]();
        return "mocked-widget";
      },
      reset() {
        window.__widgetResets = (window.__widgetResets || 0) + 1;
      },
      remove() {
        window.__widgetRemoved = (window.__widgetRemoved || 0) + 1;
      }
    };
  }, { hold: holdInteraction, realistic: !!realistic });
}

async function serveExercise(page, disabled) {
  await page.route("**/visit-proof-exercise.html", (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: exercisePage(disabled)
  }));
}

function jsonResult(body, status) {
  return {
    status: status || 200,
    contentType: "application/json",
    body: JSON.stringify(body)
  };
}

async function layoutFacts(page) {
  return page.evaluate(() => {
    const panel = document.getElementById("kutadgu-visit-check");
    const nav = document.querySelector(".mobile-bottom-nav");
    const home = document.querySelector("#home-link");
    const slot = panel && panel.querySelector("[data-turnstile]");
    const panelStyle = panel ? getComputedStyle(panel) : null;
    const slotStyle = slot ? getComputedStyle(slot) : null;
    const box = (el) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height };
    };
    const panelBox = box(panel);
    const navBox = box(nav);
    const navShown = !!(nav && getComputedStyle(nav).display !== "none" && navBox && navBox.height > 0);
    const overlap = !!(panelBox && navShown && panelBox.height > 0 && panelBox.bottom > navBox.top && panelBox.top < navBox.bottom && panelBox.right > navBox.left && panelBox.left < navBox.right);
    const homeBox = box(home);
    const homeHit = homeBox ? document.elementFromPoint(homeBox.left + homeBox.width / 2, homeBox.top + Math.min(homeBox.height / 2, 8)) : null;
    const navLink = nav && nav.querySelector("a");
    const linkBox = box(navLink);
    const navHit = navShown && linkBox ? document.elementFromPoint(linkBox.left + linkBox.width / 2, linkBox.top + linkBox.height / 2) : null;
    return {
      open: panel ? panel.getAttribute("data-open") : null,
      position: panelStyle && panelStyle.position,
      slotOverflow: slotStyle && slotStyle.overflow,
      slotTransform: slotStyle && slotStyle.transform,
      overlap,
      navShown,
      homeIsLink: !!(homeHit && homeHit.closest && homeHit.closest("#home-link")),
      navIsLink: !navShown || !!(navHit && navHit.closest && navHit.closest(".mobile-bottom-nav")),
      scrollGap: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      activeId: document.activeElement && document.activeElement.id,
      retryFocused: document.activeElement === (panel && panel.querySelector("[data-visit-retry]")),
      background: panelStyle && panelStyle.backgroundColor,
      dir: document.documentElement.dir
    };
  });
}

test("mocked Turnstile widget is removed after successful verification and counting", async ({ page }) => {
  const calls = [];
  const ids = [];
  await installTurnstile(page, true);
  await page.route("**/api/visit-count", (route) => {
    const body = route.request().postDataJSON();
    ids.push(body.event_id);
    calls.push("count");
    const first = calls.filter((name) => name === "count").length === 1;
    return route.fulfill(jsonResult(first
      ? { ok: false, counted: false, reason: "cookie_missing" }
      : { ok: true, counted: true, reason: "accepted" }));
  });
  await page.route("**/api/visit-proof", (route) => {
    calls.push("proof");
    return route.fulfill(jsonResult({ ok: true, counted: false, reason: "proof_accepted" }));
  });
  await page.route("**/api/visit-config", (route) => {
    calls.push("config");
    return route.fulfill(jsonResult({ configured: true, siteKey: "mocked-site-key", action: "visit" }));
  });
  await page.route("**/challenges.cloudflare.com/**", (route) => {
    calls.push("turnstile-script");
    return route.abort();
  });
  await serveExercise(page, false);
  await page.goto("/visit-proof-exercise.html");
  const panel = page.locator("#kutadgu-visit-check");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(NOTE);
  await expect(panel.locator("[data-mocked-turnstile='true']")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.__turnstileOptions)).toEqual({
    appearance: "interaction-only",
    retry: "never",
    refreshExpired: "never",
    action: "visit",
    size: "normal"
  });
  const placed = await layoutFacts(page);
  expect(placed.position).toBe("static");
  expect(placed.slotOverflow).not.toBe("hidden");
  expect(placed.slotTransform === "none" || placed.slotTransform === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
  expect(calls).not.toContain("turnstile-script");
  await page.evaluate(() => window.__mockedTurnstileComplete("mocked-token"));
  await expect(panel).toHaveCount(0);
  await expect(page.locator("#browsing")).toBeVisible();
  await page.locator("#browsing").click();
  expect(calls.filter((name) => name === "count")).toHaveLength(2);
  expect(calls).toContain("proof");
  expect(calls).toContain("config");
  expect(new Set(ids).size).toBe(1);
});

test("mocked interaction stays in flow at phone and desktop widths in both themes", async ({ page }) => {
  await installTurnstile(page, true);
  await page.route("**/api/visit-count", (route) => route.fulfill(jsonResult({ ok: false, counted: false, reason: "cookie_missing" })));
  await page.route("**/api/visit-proof", (route) => route.abort());
  await page.route("**/api/visit-config", (route) => route.fulfill(jsonResult({ configured: true, siteKey: "mocked-site-key", action: "visit" })));
  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());
  await serveExercise(page, false);
  const sizes = [
    { width: 390, height: 844, theme: "light" },
    { width: 390, height: 844, theme: "dark" },
    { width: 1280, height: 900, theme: "light" },
    { width: 1280, height: 900, theme: "dark" }
  ];
  const backgrounds = [];
  for (const size of sizes) {
    await page.setViewportSize({ width: size.width, height: size.height });
    if (size === sizes[0]) await page.goto("/visit-proof-exercise.html");
    await page.evaluate((theme) => {
      document.body.classList.toggle("dark-mode", theme === "dark");
    }, size.theme);
    await page.locator("#home-link").focus();
    const facts = await layoutFacts(page);
    expect(facts.dir).toBe("rtl");
    expect(facts.open).toBe("true");
    expect(facts.position).toBe("static");
    expect(facts.overlap).toBe(false);
    expect(facts.homeIsLink).toBe(true);
    expect(facts.navIsLink).toBe(true);
    expect(facts.scrollGap).toBeLessThanOrEqual(1);
    expect(facts.retryFocused).toBe(false);
    expect(facts.activeId).toBe("home-link");
    expect(facts.navShown).toBe(size.width <= 768);
    backgrounds.push(facts.background);
    await page.locator("#browsing").click();
    await page.mouse.wheel(0, 200);
    const scrolled = await layoutFacts(page);
    expect(scrolled.position).toBe("static");
    expect(scrolled.overlap).toBe(false);
  }
  expect(backgrounds[0]).not.toBe(backgrounds[1]);
  expect(backgrounds[2]).not.toBe(backgrounds[3]);
});

async function footprint(page) {
  return page.evaluate(() => {
    const widget = document.querySelector("[data-turnstile-fixture='realistic-normal']");
    const slot = document.querySelector("[data-turnstile]");
    const panel = document.getElementById("kutadgu-visit-check");
    const widgetRect = widget.getBoundingClientRect();
    const slotRect = slot.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const view = document.documentElement.clientWidth;
    const style = getComputedStyle(widget);
    const slotStyle = getComputedStyle(slot);
    const contains = (inner, outer) => inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5 && inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;
    return {
      label: widget.textContent,
      width: widgetRect.width,
      height: widgetRect.height,
      left: widgetRect.left,
      right: widgetRect.right,
      view,
      insideSlot: contains(widgetRect, slotRect),
      insidePanel: contains(widgetRect, panelRect),
      insideViewport: widgetRect.left >= -0.5 && widgetRect.right <= view + 0.5 && widgetRect.top >= -0.5 && widgetRect.bottom <= window.innerHeight + 0.5,
      overflow: style.overflow,
      transform: style.transform,
      slotOverflow: slotStyle.overflow,
      open: panel.getAttribute("data-open"),
      scrollGap: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
}

test("realistic normal widget stays inside its slot and the viewport", async ({ page }) => {
  await installTurnstile(page, true, true);
  await page.route("**/api/visit-count", (route) => route.fulfill(jsonResult({ ok: false, counted: false, reason: "cookie_missing" })));
  await page.route("**/api/visit-proof", (route) => route.abort());
  await page.route("**/api/visit-config", (route) => route.fulfill(jsonResult({ configured: true, siteKey: "mocked-site-key", action: "visit" })));
  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());
  await serveExercise(page, false);
  const widths = [320, 390, 1280];
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
    if (width === widths[0]) await page.goto("/visit-proof-exercise.html");
    await expect(page.locator("[data-turnstile-fixture='realistic-normal']")).toBeVisible();
    const facts = await footprint(page);
    expect(facts.label).toBe("REALISTIC TURNSTILE FIXTURE 300x65");
    expect(facts.open).toBe("true");
    expect(facts.width).toBeGreaterThanOrEqual(299);
    expect(facts.width).toBeLessThanOrEqual(301);
    expect(facts.height).toBeGreaterThanOrEqual(64);
    expect(facts.height).toBeLessThanOrEqual(66);
    expect(facts.insideSlot).toBe(true);
    expect(facts.insidePanel).toBe(true);
    expect(facts.insideViewport).toBe(true);
    expect(facts.scrollGap).toBeLessThanOrEqual(1);
    expect(facts.overflow).not.toBe("hidden");
    expect(facts.slotOverflow).not.toBe("hidden");
    expect(facts.transform === "none" || facts.transform === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
    expect(facts.left).toBeGreaterThanOrEqual(0);
    expect(facts.right).toBeLessThanOrEqual(facts.view + 0.5);
  }
});

test("a late interaction callback does not rebuild a completed check", async ({ page }) => {
  await installTurnstile(page, true);
  await page.route("**/api/visit-count", (route) => {
    const calls = (page.__countCalls || 0) + 1;
    page.__countCalls = calls;
    return route.fulfill(jsonResult(calls === 1
      ? { ok: false, counted: false, reason: "cookie_missing" }
      : { ok: true, counted: true, reason: "accepted" }));
  });
  await page.route("**/api/visit-proof", (route) => route.fulfill(jsonResult({ ok: true, counted: false, reason: "proof_accepted" })));
  await page.route("**/api/visit-config", (route) => route.fulfill(jsonResult({ configured: true, siteKey: "mocked-site-key", action: "visit" })));
  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());
  await serveExercise(page, false);
  await page.goto("/visit-proof-exercise.html");
  await expect(page.locator("#kutadgu-visit-check")).toBeVisible();
  await page.evaluate(() => window.__mockedTurnstileComplete("mocked-token"));
  await expect(page.locator("#kutadgu-visit-check")).toHaveCount(0);
  await page.evaluate(() => window.__heldInteractive && window.__heldInteractive());
  await page.evaluate(() => window.__mockedTurnstileError());
  await expect(page.locator("#kutadgu-visit-check")).toHaveCount(0);
});

test("a late interaction callback does not rebuild a check after retry exhaustion", async ({ page }) => {
  const STOP = "ساناش بۇ قېتىم تاماملانمىدى. بەت ئىشلىتىشكە ئوچۇق.";
  await installTurnstile(page, true);
  await page.route("**/api/visit-count", (route) => route.fulfill(jsonResult({ ok: false, counted: false, reason: "cookie_missing" })));
  await page.route("**/api/visit-proof", (route) => route.abort());
  await page.route("**/api/visit-config", (route) => route.fulfill(jsonResult({ configured: true, siteKey: "mocked-site-key", action: "visit" })));
  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());
  await serveExercise(page, false);
  await page.goto("/visit-proof-exercise.html");
  const panel = page.locator("#kutadgu-visit-check");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(NOTE);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.evaluate(() => window.__mockedTurnstileError());
    await expect(page.locator("[data-visit-retry]")).toBeVisible();
    const resetsBefore = await page.evaluate(() => window.__widgetResets || 0);
    await page.locator("[data-visit-retry]").click();
    if (attempt < 3) {
      await expect.poll(() => page.evaluate(() => window.__widgetResets || 0)).toBe(resetsBefore + 1);
    }
  }
  await expect(panel).toHaveCount(1);
  await expect(panel).toContainText(STOP);
  await expect(page.locator("[data-visit-retry]")).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.querySelector("[data-turnstile]").childElementCount)).toBe(0);
  await page.evaluate(() => window.__heldInteractive && window.__heldInteractive());
  await page.evaluate(() => window.__mockedTurnstileError());
  await expect(panel).toHaveCount(1);
  await expect(panel).toContainText(STOP);
  await expect.poll(() => page.evaluate(() => document.querySelector("[data-turnstile]").childElementCount)).toBe(0);
  await page.evaluate(() => document.getElementById("kutadgu-visit-check").remove());
  await page.evaluate(() => window.__heldInteractive && window.__heldInteractive());
  await expect(page.locator("#kutadgu-visit-check")).toHaveCount(0);
});

test("mocked silent success never opens the check and removes its space", async ({ page }) => {
  await installTurnstile(page, false);
  await page.route("**/api/visit-count", (route) => {
    const first = !page.__counted;
    page.__counted = true;
    return route.fulfill(jsonResult(first
      ? { ok: false, counted: false, reason: "cookie_missing" }
      : { ok: true, counted: true, reason: "accepted" }));
  });
  await page.route("**/api/visit-proof", (route) => route.fulfill(jsonResult({ ok: true, counted: false, reason: "proof_accepted" })));
  await page.route("**/api/visit-config", (route) => route.fulfill(jsonResult({ configured: true, siteKey: "mocked-site-key", action: "visit" })));
  await serveExercise(page, false);
  await page.goto("/visit-proof-exercise.html");
  await expect.poll(() => page.evaluate(() => window.__mockedTurnstile === true)).toBe(true);
  const before = await page.evaluate(() => {
    const panel = document.getElementById("kutadgu-visit-check");
    return { open: panel.getAttribute("data-open"), height: panel.offsetHeight };
  });
  expect(before.open).toBe(null);
  expect(before.height).toBe(0);
  await page.evaluate(() => window.__mockedTurnstileComplete("silent-token"));
  await expect(page.locator("#kutadgu-visit-check")).toHaveCount(0);
});

test("mocked rejected proof, network loss, timeout, and a lost count keep one event id", async ({ page }) => {
  const ids = [];
  const proofs = [];
  let countMode = "missing";
  await installTurnstile(page, true);
  await page.route("**/api/visit-count", (route) => {
    ids.push(route.request().postDataJSON().event_id);
    if (countMode === "abort") return route.abort();
    if (countMode === "accept") {
      return route.fulfill(jsonResult({ ok: true, counted: false, reason: "suppressed" }));
    }
    return route.fulfill(jsonResult({ ok: false, counted: false, reason: "cookie_missing" }));
  });
  await page.route("**/api/visit-proof", (route) => {
    const token = route.request().postDataJSON().token;
    proofs.push(token);
    if (token === "reject-me") {
      return route.fulfill(jsonResult({ ok: false, counted: false, reason: "verification_rejected" }, 403));
    }
    if (token === "lose-me") return route.abort();
    return route.fulfill(jsonResult({ ok: true, counted: false, reason: "proof_accepted" }));
  });
  await page.route("**/api/visit-config", (route) => route.fulfill(jsonResult({ configured: true, siteKey: "mocked-site-key", action: "visit" })));
  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());
  await serveExercise(page, false);
  await page.goto("/visit-proof-exercise.html");
  await expect(page.locator("#kutadgu-visit-check")).toBeVisible();

  await page.evaluate(() => window.__mockedTurnstileError());
  await page.evaluate(() => window.__mockedTurnstileExpire());
  await page.evaluate(() => window.__mockedTurnstileTimeout());
  await expect(page.locator("[data-visit-retry]")).toBeVisible();
  expect(await page.evaluate(() => window.__widgetResets || 0)).toBe(0);
  await expect(page.locator("#browsing")).toBeVisible();
  expect(ids).toHaveLength(1);

  await page.evaluate(() => window.__mockedTurnstileComplete("reject-me"));
  await expect.poll(() => proofs.length).toBe(1);
  expect(ids).toHaveLength(1);
  await page.locator("[data-visit-retry]").click();
  await expect.poll(() => ids.length).toBe(2);
  await expect.poll(() => page.evaluate(() => window.__widgetResets || 0)).toBe(1);

  countMode = "abort";
  await page.evaluate(() => window.__mockedTurnstileAgain("fresh-token"));
  await expect.poll(() => proofs.slice()).toEqual(["reject-me", "fresh-token"]);
  await expect.poll(() => ids.length).toBe(3);
  await expect(page.locator("[data-visit-retry]")).toBeVisible();

  countMode = "accept";
  await page.locator("[data-visit-retry]").click();
  await expect(page.locator("#kutadgu-visit-check")).toHaveCount(0);
  expect(proofs).toEqual(["reject-me", "fresh-token"]);
  expect(new Set(ids).size).toBe(1);
  expect(ids).toHaveLength(4);
});

test("mocked duplicate callbacks submit one proof and do not count a rejection", async ({ page }) => {
  const proofs = [];
  let releaseProof;
  const gate = new Promise((resolve) => {
    releaseProof = resolve;
  });
  await installTurnstile(page, true);
  await page.route("**/api/visit-count", (route) => {
    const calls = (page.__countCalls || 0) + 1;
    page.__countCalls = calls;
    return route.fulfill(jsonResult(calls === 1
      ? { ok: false, counted: false, reason: "cookie_missing" }
      : { ok: true, counted: true, reason: "accepted" }));
  });
  await page.route("**/api/visit-proof", async (route) => {
    proofs.push(route.request().postDataJSON().token);
    await gate;
    return route.fulfill(jsonResult({ ok: true, counted: false, reason: "proof_accepted" }));
  });
  await page.route("**/api/visit-config", (route) => route.fulfill(jsonResult({ configured: true, siteKey: "mocked-site-key", action: "visit" })));
  await serveExercise(page, false);
  await page.goto("/visit-proof-exercise.html");
  await expect(page.locator("#kutadgu-visit-check")).toBeVisible();
  await page.evaluate(() => {
    window.__mockedTurnstileComplete("once-token");
    window.__mockedTurnstileAgain("other-token");
  });
  await expect.poll(() => proofs.length).toBe(1);
  expect(proofs[0]).toBe("once-token");
  releaseProof();
  await expect(page.locator("#kutadgu-visit-check")).toHaveCount(0);
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
  await page.route("**/visit-proof.js?v=4", (route) => route.continue());
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
    body: "<!DOCTYPE html><html><head><script>window.KUTADGU_APP_CONFIG={featureFlags:{analyticsHooks:true}};</script></head><body><p id=\"browsing\">ok</p><script src=\"/visit-proof.js?v=4\"></script></body></html>"
  }));
  await page.goto("/visit-proof-exercise.html");
  await expect(page.locator("#browsing")).toBeVisible();
  await expect.poll(() => calls.length).toBe(0);
});
