const { test, expect } = require("./playwright-test");

// Local query-builder integration. This is not a live authenticated admin session.
// admin.js calls the same select/eq/or/order/range chain; the page supplies the rows.

const ADMIN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EMPTY_QUEUE = "تەستىق كۈتۈۋاتقان كىتاب يوق.";
const SEARCH_MISS = "بۇ ئىزدەشكە ماس كىتاب تېپىلمىدى.";
const COUNT_GAP = "تەستىق كۈتۈۋاتقان كىتابلارنىڭ ئېنىق سانى كەلمىدى.";

function book(i, extra) {
  return Object.assign({
    id: 5000 + i,
    title: "تەستىق كىتاب " + String(i).padStart(2, "0"),
    author: i === 4 ? "ئالاھىدە ئاپتور" : "ئاپتور " + i,
    translator: i === 2 ? "پەقەت تەرجىمان سۆز" : "",
    isbn: "97800000" + String(i).padStart(5, "0"),
    price: 10,
    stock: 1,
    category: "ئۇنىۋېرسال",
    source: "universal.html",
    image_url: "",
    gallery_images: [],
    description: "",
    publisher: "",
    publish_year: 2024,
    pages: 120,
    cover_type: "paperback",
    book_size: "A5",
    original_price: 20,
    dimensions: "",
    is_color_print: false,
    interior_print_type: "bw",
    submitted_by: "staff",
    submitted_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    submission_status: "pending",
    is_active: false,
    is_available: false
  }, extra || {});
}

function books(count, extras) {
  const rows = [];
  for (let i = 1; i <= count; i += 1) rows.push(book(i));
  return rows.concat(extras || []);
}

function pageLabel(page, pages, total) {
  return page + " / " + pages + " · جەمئىي " + total + " كىتاب · ھەر بەتتە 10";
}

async function install(page, rows, mode) {
  await page.addInitScript(({ rows, mode, adminA, adminB }) => {
    function token(aal, userId) {
      const payload = btoa(JSON.stringify({ aal: aal, sub: userId })).replace(/=+$/g, "");
      return "e30." + payload + ".sig";
    }
    function sessionNow() {
      if (window.__pendingSessionOff) return null;
      const admin = window.__pendingAdmin;
      if (!admin || !admin.id) return null;
      return {
        access_token: token(admin.aal || "", admin.id),
        refresh_token: "refresh-" + admin.id,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: admin.id, email: admin.id + "@example.com" }
      };
    }
    function termsOf(orFilter) {
      const terms = [];
      const re = /\.ilike\."%([\s\S]*?)%"/g;
      let match;
      while ((match = re.exec(String(orFilter || "")))) terms.push(match[1].toLocaleLowerCase("en"));
      return terms;
    }
    function pendingMatch(row, orFilter) {
      if (String(row && row.submission_status || "") !== "pending") return false;
      const terms = termsOf(orFilter);
      if (!terms.length) return true;
      const title = String(row.title || "").toLocaleLowerCase("en");
      const author = String(row.author || "").toLocaleLowerCase("en");
      const isbn = String(row.isbn || "").toLocaleLowerCase("en");
      const digits = String(row.isbn || "").replace(/[^0-9Xx]/g, "").toLocaleLowerCase("en");
      return terms.some((term) => title.includes(term) || author.includes(term) || isbn.includes(term) || digits.includes(term));
    }
    function pendingSort(rows) {
      return rows.slice().sort((a, b) => {
        const ta = a && a.submitted_at ? Date.parse(a.submitted_at) : NaN;
        const tb = b && b.submitted_at ? Date.parse(b.submitted_at) : NaN;
        const aMissing = a == null || a.submitted_at == null || a.submitted_at === "" || Number.isNaN(ta);
        const bMissing = b == null || b.submitted_at == null || b.submitted_at === "" || Number.isNaN(tb);
        if (aMissing && bMissing) return (Number(b && b.id) || 0) - (Number(a && a.id) || 0);
        if (aMissing) return 1;
        if (bMissing) return -1;
        if (tb !== ta) return tb - ta;
        return (Number(b && b.id) || 0) - (Number(a && a.id) || 0);
      });
    }
    function isPendingQuery(q) {
      return q._table === "books"
        && typeof q._select === "string"
        && q._select.indexOf("submitted_at") >= 0
        && q._eq.some((pair) => pair[0] === "submission_status" && pair[1] === "pending")
        && !q._head;
    }
    function snapshot(q) {
      const entry = {
        table: q._table,
        select: q._select,
        count: q._count,
        eq: q._eq.map((pair) => pair.slice()),
        or: q._or,
        orders: q._orders.map((order) => ({ column: order.column, ascending: order.ascending, nullsFirst: order.nullsFirst })),
        range: q._range ? q._range.slice() : null
      };
      if (isPendingQuery(q)) window.__pendingCalls.push(entry);
      if (q._single && q._table === "books" && q._id != null) {
        const found = (window.__pendingRows || []).find((row) => String(row.id) === String(q._id));
        return { data: found ? JSON.parse(JSON.stringify(found)) : null, error: null, count: found ? 1 : 0 };
      }
      if (!isPendingQuery(q)) {
        if (q._table === "admin_users") {
          const admin = window.__pendingAdmin;
          return window.__pendingAllowAdmin && admin && !window.__pendingSessionOff
            ? { data: { user_id: admin.id }, error: null, count: 1 }
            : { data: null, error: null, count: 0 };
        }
        return { data: [], error: null, count: 0 };
      }
      const matched = pendingSort((window.__pendingRows || []).filter((row) => pendingMatch(row, q._or)));
      const from = entry.range ? entry.range[0] : 0;
      const to = entry.range ? entry.range[1] : matched.length - 1;
      const data = JSON.parse(JSON.stringify(matched.slice(from, to + 1)));
      let count = matched.length;
      const mode = window.__pendingMode;
      if (mode === "count-missing") count = null;
      else if (mode === "count-invalid") count = "nope";
      else if (mode === "count-mismatch") count = 5;
      else if (mode === "count-string") count = String(matched.length);
      if (mode === "error") return { data: null, error: { message: "pending read failed", code: "500" }, count: null };
      return { data: data, error: null, count: count };
    }
    function settle(q) {
      let result;
      let failed = null;
      try {
        if (isPendingQuery(q) && window.__pendingMode === "reject") throw new Error("pending rejected");
        result = snapshot(q);
      } catch (err) {
        failed = err;
      }
      if (isPendingQuery(q) && window.__pendingHold) {
        return new Promise((resolve, reject) => {
          window.__pendingQueue.push(() => {
            const mode = window.__pendingMode;
            if (mode === "reject") {
              reject(new Error("pending rejected"));
              return;
            }
            if (mode === "error") {
              resolve({ data: null, error: { message: "pending read failed", code: "500" }, count: null });
              return;
            }
            if (failed) {
              reject(failed);
              return;
            }
            if (mode === "count-missing") resolve({ data: result.data, error: null, count: null });
            else if (mode === "count-invalid") resolve({ data: result.data, error: null, count: "nope" });
            else if (mode === "count-mismatch") resolve({ data: result.data, error: null, count: 5 });
            else resolve(result);
          });
        });
      }
      if (failed) return Promise.reject(failed);
      return Promise.resolve(result);
    }
    function builder(table) {
      const q = {
        _table: table,
        _select: "",
        _count: null,
        _head: false,
        _eq: [],
        _or: "",
        _orders: [],
        _range: null,
        _id: null,
        _single: false
      };
      const self = {
        select(cols, opts) {
          q._select = cols;
          q._count = opts && opts.count || null;
          q._head = !!(opts && opts.head);
          return self;
        },
        eq(col, val) {
          q._eq.push([col, val]);
          if (col === "id") q._id = val;
          return self;
        },
        or(filter) { q._or = String(filter || ""); return self; },
        order(column, opts) {
          const options = opts || {};
          q._orders.push({
            column: column,
            ascending: options.ascending !== false,
            nullsFirst: Object.prototype.hasOwnProperty.call(options, "nullsFirst") ? options.nullsFirst : null
          });
          return self;
        },
        range(from, to) { q._range = [from, to]; return self; },
        limit() { return self; },
        in() { return self; },
        is() { return self; },
        gte() { return self; },
        lte() { return self; },
        neq() { return self; },
        not() { return self; },
        filter() { return self; },
        contains() { return self; },
        abortSignal() { return self; },
        update() { return self; },
        insert() { return self; },
        upsert() { return self; },
        delete() { return self; },
        maybeSingle() { q._single = true; return self; },
        single() { q._single = true; return self; },
        then(resolve, reject) { return settle(q).then(resolve, reject); }
      };
      return self;
    }
    window.__pendingRows = rows;
    window.__pendingMode = mode || "ok";
    window.__pendingHold = false;
    window.__pendingQueue = [];
    window.__pendingCalls = [];
    window.__pendingRpc = [];
    window.__pendingWrites = [];
    window.__pendingAllowAdmin = true;
    window.__pendingSessionOff = false;
    window.__pendingAdmin = { id: adminA, aal: "aal2" };
    window.__pendingSignOuts = 0;
    window.__pendingSignOutImpl = null;
    window.__kutadguAdminReviewStaff = async (id, approve) => {
      window.__pendingWrites.push({ type: approve ? "approve" : "reject", id: Number(id) });
      const row = (window.__pendingRows || []).find((item) => String(item.id) === String(id));
      if (row) {
        row.submission_status = approve ? "approved" : "rejected";
        row.is_active = !!approve;
      }
      return { error: null };
    };
    window.__kutadguAdminPersistPending = async (id, payload) => {
      window.__pendingWrites.push({ type: "edit", id: Number(id), title: payload && payload.title });
      const row = (window.__pendingRows || []).find((item) => String(item.id) === String(id));
      if (row) Object.assign(row, payload);
      return { error: null };
    };
    window.__kutadguMfaApi = {
      async listFactors() {
        return { data: { all: [], totp: [], phone: [] }, error: null };
      },
      async getAuthenticatorAssuranceLevel() {
        const admin = window.__pendingAdmin;
        const level = admin && admin.aal || null;
        return { data: { currentLevel: level, nextLevel: "aal2" }, error: null };
      }
    };
    function wrapClient() {
      return {
        auth: {
          initialize: async () => {},
          getSession: async () => ({ data: { session: sessionNow() }, error: null }),
          getUser: async () => ({
            data: { user: sessionNow() && sessionNow().user },
            error: window.__pendingSessionOff ? { name: "AuthSessionMissingError", message: "Auth session missing" } : null
          }),
          refreshSession: async () => ({ data: { session: sessionNow(), user: sessionNow() && sessionNow().user }, error: null }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signOut: async () => {
            window.__pendingSignOuts += 1;
            if (window.__pendingSignOutImpl) return window.__pendingSignOutImpl();
            window.__pendingSessionOff = true;
            return { error: null };
          },
          signInWithPassword: async () => ({ error: null }),
          mfa: window.__kutadguMfaApi
        },
        from: (table) => builder(table),
        rpc(name) {
          window.__pendingRpc.push(name);
          return Promise.resolve({ data: null, error: { message: "missing", code: "PGRST202" } });
        },
        storage: { from() { return { upload: async () => ({ error: null }), getPublicUrl() { return { data: { publicUrl: "" } }; } }; } }
      };
    }
    let supabaseValue;
    Object.defineProperty(window, "supabase", {
      configurable: true,
      enumerable: true,
      get() { return supabaseValue; },
      set(value) {
        if (value && typeof value.createClient === "function") value.createClient = function () { return wrapClient(); };
        supabaseValue = value;
      }
    });
    window.__pendingAdminB = adminB;
  }, { rows, mode: mode || "ok", adminA: ADMIN_A, adminB: ADMIN_B });
}

async function reloadPending(page) {
  await page.evaluate(() => { window.__kutadguAdminTest.loadPendingSubmissions(); });
}

async function resetPending(page, rows) {
  await page.evaluate((next) => {
    window.__pendingRows = next;
    window.__kutadguAdminTest.clearPendingSubmissionPrivate();
    window.__kutadguAdminTest.loadPendingSubmissions();
  }, rows);
}

async function openPending(page, rows, mode) {
  await install(page, rows, mode);
  await page.goto("/admin.html#submissions", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  await expect(page.locator("#submissionsCard")).toBeVisible();
}

async function lastCall(page) {
  return page.evaluate(() => {
    const calls = window.__pendingCalls || [];
    return calls[calls.length - 1] || null;
  });
}

async function releaseNext(page) {
  await page.evaluate(() => {
    const release = window.__pendingQueue.shift();
    if (typeof release !== "function") throw new Error("no held pending read");
    release();
  });
}

async function expectQueue(page, rowCount, total, label) {
  await expect(page.locator(".admin-submission-row")).toHaveCount(rowCount);
  await expect(page.locator("#pendingSubmissionCount")).toHaveText("تەستىق ساقلاۋاتقان: " + total);
  if (!total) {
    await expect(page.locator("#pendingSubmissionPager")).toBeHidden();
    const term = (await page.locator("#pendingSubmissionSearch").inputValue()).trim();
    const copy = term ? SEARCH_MISS : EMPTY_QUEUE;
    await expect(page.locator("#pendingSubmissionStatus")).toHaveText(copy);
    await expect(page.locator("#pendingSubmissionList")).toContainText(copy);
    await expect(page.locator("#pendingSubmissionRetry")).toHaveCount(0);
    return;
  }
  await expect(page.locator("#pendingSubmissionPager span")).toHaveText(label);
  await expect(page.locator("#pendingSubmissionStatus")).toHaveText("تەستىق كۈتۈۋاتقان " + total + " كىتاب.");
}

async function expectNoOverflow(page) {
  const box = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    dir: document.documentElement.getAttribute("dir")
  }));
  expect(box.dir).toBe("rtl");
  expect(box.scroll, JSON.stringify(box)).toBeLessThanOrEqual(box.client + 1);
}

test.describe("pending submission query builder", () => {
  test("pages 0, 1, 10, 11, 20, 21, and 60 use the pending filter, exact count, order, and range", async ({ page }) => {
    page.on("dialog", (dialog) => dialog.accept());
    await page.setViewportSize({ width: 1280, height: 900 });
    await openPending(page, books(0));
    await expectQueue(page, 0, 0);
    await expect(page.locator("#pendingSubmissionList")).not.toContainText(SEARCH_MISS);
    let call = await lastCall(page);
    expect(call.count).toBe("exact");
    expect(call.eq).toContainEqual(["submission_status", "pending"]);
    expect(call.or).toBe("");
    expect(call.orders).toEqual([
      { column: "submitted_at", ascending: false, nullsFirst: false },
      { column: "id", ascending: false, nullsFirst: null }
    ]);
    expect(call.range).toEqual([0, 9]);
    expect(String(call.select)).toContain("submitted_at");

    await page.evaluate((rows) => { window.__pendingRows = rows; }, books(1));
    await reloadPending(page);
    await expectQueue(page, 1, 1, pageLabel(1, 1, 1));
    await expect(page.locator("[data-pending-page='prev']")).toBeDisabled();
    await expect(page.locator("[data-pending-page='next']")).toBeDisabled();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    await page.evaluate((rows) => { window.__pendingRows = rows; }, books(10));
    await reloadPending(page);
    await expectQueue(page, 10, 10, pageLabel(1, 1, 10));
    await expect(page.locator(".admin-submission-title").first()).toHaveText("تەستىق كىتاب 10");
    await expect(page.locator(".admin-submission-title").last()).toHaveText("تەستىق كىتاب 01");
    await expect(page.locator("[data-pending-page='next']")).toBeDisabled();
    call = await lastCall(page);
    expect(call.range).toEqual([0, 9]);

    const eleven = books(11, [book(99, { id: 5999, title: "تەستىقلانغان كىتاب", submission_status: "approved", submitted_at: "2026-12-01T00:00:00.000Z" })]);
    await page.evaluate((rows) => { window.__pendingRows = rows; }, eleven);
    await reloadPending(page);
    await expectQueue(page, 10, 11, pageLabel(1, 2, 11));
    await expect(page.locator(".admin-submission-title").first()).toHaveText("تەستىق كىتاب 11");
    const titles = await page.locator(".admin-submission-title").allTextContents();
    expect(titles).not.toContain("تەستىقلانغان كىتاب");
    await expect(page.locator("[data-pending-page='prev']")).toBeDisabled();
    await page.locator("[data-pending-page='next']").focus();
    await page.keyboard.press("Enter");
    await expectQueue(page, 1, 11, pageLabel(2, 2, 11));
    await expect(page.locator(".admin-submission-title")).toHaveText("تەستىق كىتاب 01");
    await expect(page.locator("[data-pending-page='next']")).toBeDisabled();
    await expect(page.locator("[data-pending-page='prev']")).toBeEnabled();
    call = await lastCall(page);
    expect(call.range).toEqual([10, 19]);
    expect(call.eq).toContainEqual(["submission_status", "pending"]);
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 768, height: 900 },
      { width: 390, height: 800 }
    ]) {
      await page.setViewportSize(viewport);
      await expectNoOverflow(page);
    }

    await page.setViewportSize({ width: 768, height: 900 });
    await resetPending(page, books(20));
    await expectQueue(page, 10, 20, pageLabel(1, 2, 20));
    await page.locator("[data-pending-page='next']").click();
    await expectQueue(page, 10, 20, pageLabel(2, 2, 20));
    await expect(page.locator(".admin-submission-title").first()).toHaveText("تەستىق كىتاب 10");
    call = await lastCall(page);
    expect(call.range).toEqual([10, 19]);

    await resetPending(page, books(21));
    await expectQueue(page, 10, 21, pageLabel(1, 3, 21));
    await page.locator("[data-pending-page='next']").click();
    await expectQueue(page, 10, 21, pageLabel(2, 3, 21));
    await page.locator("[data-pending-page='next']").click();
    await expectQueue(page, 1, 21, pageLabel(3, 3, 21));
    await expect(page.locator(".admin-submission-title")).toHaveText("تەستىق كىتاب 01");
    call = await lastCall(page);
    expect(call.range).toEqual([20, 29]);

    await page.setViewportSize({ width: 390, height: 800 });
    await resetPending(page, books(60));
    await expectQueue(page, 10, 60, pageLabel(1, 6, 60));
    for (let pageNo = 2; pageNo <= 6; pageNo += 1) {
      await page.locator("[data-pending-page='next']").click();
      await expectQueue(page, 10, 60, pageLabel(pageNo, 6, 60));
    }
    await expect(page.locator(".admin-submission-title").first()).toHaveText("تەستىق كىتاب 10");
    await expect(page.locator(".admin-submission-title").last()).toHaveText("تەستىق كىتاب 01");
    await expect(page.locator("[data-pending-page='next']")).toBeDisabled();
    call = await lastCall(page);
    expect(call.range).toEqual([50, 59]);
    await expectNoOverflow(page);
  });

  test("equal timestamps, null timestamps, later pages, and escaped ISBN search stay on the query", async ({ page }) => {
    const rows = [
      book(1, { id: 1, title: "تەڭ 1", submitted_at: "2026-01-01T00:00:00.000Z" }),
      book(5, { id: 5, title: "تەڭ 5", submitted_at: "2026-01-01T00:00:00.000Z" }),
      book(3, { id: 3, title: "تەڭ 3", submitted_at: "2026-01-01T00:00:00.000Z" }),
      book(9, { id: 9, title: "بوش 9", submitted_at: null }),
      book(8, { id: 8, title: "بوش 8", submitted_at: "" }),
      book(7, { id: 7, title: "يېڭى", submitted_at: "2026-02-01T00:00:00.000Z" })
    ];
    await openPending(page, rows);
    await expect(page.locator(".admin-submission-title")).toHaveText(["يېڭى", "تەڭ 5", "تەڭ 3", "تەڭ 1", "بوش 9", "بوش 8"]);
    const ordered = await lastCall(page);
    expect(ordered.orders[0]).toEqual({ column: "submitted_at", ascending: false, nullsFirst: false });
    expect(ordered.orders[1]).toEqual({ column: "id", ascending: false, nullsFirst: null });

    await page.evaluate((next) => { window.__pendingRows = next; }, books(21));
    await reloadPending(page);
    await page.locator("[data-pending-page='next']").click();
    await expectQueue(page, 10, 21, pageLabel(2, 3, 21));
    await page.locator("#pendingSubmissionSearch").fill("تەستىق كىتاب 15");
    await expectQueue(page, 1, 1, pageLabel(1, 1, 1));
    await expect(page.locator(".admin-submission-title")).toHaveText("تەستىق كىتاب 15");
    let call = await lastCall(page);
    expect(call.range).toEqual([0, 9]);
    expect(call.or).toContain('title.ilike."%تەستىق كىتاب 15%"');
    expect(call.or).toContain('author.ilike."%تەستىق كىتاب 15%"');
    expect(call.or).toContain('isbn.ilike."%تەستىق كىتاب 15%"');
    expect(call.or).not.toContain("translator");

    await page.locator("#pendingSubmissionSearch").fill("978-0000000004");
    await expectQueue(page, 1, 1, pageLabel(1, 1, 1));
    await expect(page.locator(".admin-submission-title")).toHaveText("تەستىق كىتاب 04");
    call = await lastCall(page);
    expect(call.or).toContain('isbn.ilike."%978-0000000004%"');
    expect(call.or).toContain('isbn.ilike."%9780000000004%"');

    await page.locator("#pendingSubmissionSearch").fill("100%_test");
    await expectQueue(page, 0, 0);
    call = await lastCall(page);
    expect(call.or).toContain('title.ilike."%100 test%"');
    expect(call.or).toContain('isbn.ilike."%100%"');
    expect(call.or).not.toContain("100%_test");
    expect(call.or).not.toContain("_");
    await expect(page.locator("#pendingSubmissionList")).toContainText(SEARCH_MISS);
    await expect(page.locator("#pendingSubmissionList")).not.toContainText(EMPTY_QUEUE);

    await page.locator("#pendingSubmissionSearch").fill("پەقەت تەرجىمان سۆز");
    await expectQueue(page, 0, 0);
    await page.locator("#pendingSubmissionSearch").fill("");
    await expectQueue(page, 10, 21, pageLabel(1, 3, 21));
  });

  test("returned errors, rejected reads, and bad counts keep the last page and retry the read", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await openPending(page, [], "error");
    await expect(page.locator("#pendingSubmissionCount")).toHaveText("تەستىق ساقلاۋاتقان: —");
    await expect(page.locator(".admin-submission-row")).toHaveCount(0);
    await expect(page.locator("#pendingSubmissionList")).not.toContainText(EMPTY_QUEUE);
    await expect(page.locator("#pendingSubmissionList")).not.toContainText(SEARCH_MISS);
    await expect(page.locator("#pendingSubmissionStatus")).toContainText("pending read failed");
    await expect(page.locator("#pendingSubmissionRetry")).toHaveText("قايتا سىناش");
    await expectNoOverflow(page);
    await page.evaluate((rows) => { window.__pendingRows = rows; window.__pendingMode = "ok"; }, books(10));
    await page.locator("#pendingSubmissionRetry").click();
    await expectQueue(page, 10, 10, pageLabel(1, 1, 10));

    await page.evaluate(() => { window.__pendingMode = "reject"; });
    await reloadPending(page);
    await expect(page.locator(".admin-submission-row")).toHaveCount(10);
    await expect(page.locator("#pendingSubmissionCount")).toHaveText("تەستىق ساقلاۋاتقان: 10");
    await expect(page.locator("#pendingSubmissionPager span")).toHaveText(pageLabel(1, 1, 10));
    await expect(page.locator("#pendingSubmissionStatus")).toContainText("pending rejected");
    await expect(page.locator("#pendingSubmissionList")).not.toContainText(EMPTY_QUEUE);
    await page.evaluate(() => { window.__pendingMode = "ok"; });
    await page.locator("#pendingSubmissionRetry").click();
    await expectQueue(page, 10, 10, pageLabel(1, 1, 10));

    for (const mode of ["count-missing", "count-invalid", "count-mismatch"]) {
      await page.evaluate((next) => { window.__pendingMode = next; }, mode);
      await reloadPending(page);
      await expect(page.locator(".admin-submission-row")).toHaveCount(10);
      await expect(page.locator("#pendingSubmissionCount")).toHaveText("تەستىق ساقلاۋاتقان: 10");
      await expect(page.locator("#pendingSubmissionStatus")).toContainText(COUNT_GAP);
      await expect(page.locator("#pendingSubmissionRetry")).toBeVisible();
    }
    await page.evaluate(() => { window.__pendingMode = "count-string"; });
    await page.locator("#pendingSubmissionRetry").click();
    await expectQueue(page, 10, 10, pageLabel(1, 1, 10));
    const call = await lastCall(page);
    expect(call.count).toBe("exact");
  });

  test("a delayed page-two response cannot paint over a search typed before debounce", async ({ page }) => {
    await openPending(page, books(21));
    await expect(page.locator(".admin-submission-title").first()).toHaveText("تەستىق كىتاب 21");
    await page.evaluate(() => { window.__pendingHold = true; });
    await page.locator("[data-pending-page='next']").click();
    await expect.poll(() => page.evaluate(() => window.__pendingQueue.length)).toBe(1);
    const held = await page.evaluate(() => window.__pendingCalls[window.__pendingCalls.length - 1].range.slice());
    expect(held).toEqual([10, 19]);
    await page.locator("#pendingSubmissionSearch").fill("تەستىق كىتاب 15");
    await releaseNext(page);
    await expect(page.locator(".admin-submission-title").first()).toHaveText("تەستىق كىتاب 21");
    await expect(page.locator("#pendingSubmissionPager span")).toHaveText(pageLabel(1, 3, 21));
    await expect.poll(() => page.evaluate(() => window.__pendingQueue.length)).toBe(1);
    await releaseNext(page);
    await expect(page.locator(".admin-submission-title")).toHaveText("تەستىق كىتاب 15");
    await expect(page.locator("#pendingSubmissionPager span")).toHaveText(pageLabel(1, 1, 1));
  });

  test("rapid searches and page changes keep only the latest request", async ({ page }) => {
    await openPending(page, books(21));
    await page.evaluate(() => { window.__pendingHold = true; });
    await page.locator("#pendingSubmissionSearch").fill("missing-term-aaa");
    await expect.poll(() => page.evaluate(() => window.__pendingQueue.length)).toBe(1);
    await page.locator("#pendingSubmissionSearch").fill("تەستىق كىتاب 04");
    await releaseNext(page);
    await expect(page.locator(".admin-submission-title").first()).toHaveText("تەستىق كىتاب 21");
    await expect.poll(() => page.evaluate(() => window.__pendingQueue.length)).toBe(1);
    await releaseNext(page);
    await expect(page.locator(".admin-submission-title")).toHaveText("تەستىق كىتاب 04");
    await page.evaluate(() => { window.__pendingHold = false; });

    await page.locator("#pendingSubmissionSearch").fill("");
    await expectQueue(page, 10, 21, pageLabel(1, 3, 21));
    await page.locator("[data-pending-page='next']").click();
    await expectQueue(page, 10, 21, pageLabel(2, 3, 21));
    await page.evaluate(() => { window.__pendingHold = true; window.__pendingQueue = []; });
    await page.locator("[data-pending-page='next']").click();
    await expect.poll(() => page.evaluate(() => window.__pendingQueue.length)).toBe(1);
    await page.locator("[data-pending-page='prev']").click();
    await releaseNext(page);
    await expect(page.locator(".admin-submission-title").first()).toHaveText("تەستىق كىتاب 11");
    await expect(page.locator("#pendingSubmissionPager span")).toHaveText(pageLabel(2, 3, 21));
    await expect.poll(() => page.evaluate(() => window.__pendingQueue.length)).toBe(1);
    await releaseNext(page);
    await expect(page.locator(".admin-submission-title").first()).toHaveText("تەستىق كىتاب 21");
    await expect(page.locator("#pendingSubmissionPager span")).toHaveText(pageLabel(1, 3, 21));
  });

  test("logout, account switch, idle lock, and AAL2 loss drop a delayed read", async ({ page }) => {
    page.on("dialog", (dialog) => dialog.accept());
    await page.setViewportSize({ width: 390, height: 800 });
    await openPending(page, books(21));
    await page.locator("[data-pending-page='next']").click();
    await expectQueue(page, 10, 21, pageLabel(2, 3, 21));
    await page.evaluate(() => {
      window.__pendingHold = true;
      window.__pendingSignOutImpl = () => new Promise((resolve) => {
        window.__pendingFinishSignOut = () => {
          window.__pendingSessionOff = true;
          resolve({ error: null });
        };
      });
    });
    await page.locator("[data-pending-page='next']").click();
    await expect.poll(() => page.evaluate(() => window.__pendingQueue.length)).toBe(1);
    const loggingOut = page.locator("#adminLogout").click();
    await expect(page.locator(".admin-submission-row")).toHaveCount(0);
    await expect(page.locator("#pendingSubmissionCount")).toHaveText("تەستىق ساقلاۋاتقان: —");
    await expect(page.locator("#pendingSubmissionSearch")).toHaveValue("");
    expect(await page.evaluate(() => window.__pendingSignOuts)).toBe(1);
    await releaseNext(page);
    await expect(page.locator(".admin-submission-row")).toHaveCount(0);
    await expect(page.locator("#pendingSubmissionList")).not.toContainText("تەستىق كىتاب 01");
    await page.evaluate(() => window.__pendingFinishSignOut());
    await loggingOut;
    await expect(page.locator("#loginPanel")).toBeVisible();

    await page.evaluate(() => {
      window.__pendingSessionOff = false;
      window.__pendingAdmin = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", aal: "aal2" };
      window.__pendingAllowAdmin = true;
      window.__pendingSignOutImpl = null;
      window.__pendingHold = false;
    });
    await page.evaluate(() => window.__kutadguAdminTest.routeSession());
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await reloadPending(page);
    await expectQueue(page, 10, 21, pageLabel(1, 3, 21));
    await page.locator("[data-pending-page='next']").click();
    await expectQueue(page, 10, 21, pageLabel(2, 3, 21));
    await page.evaluate(() => { window.__pendingHold = true; window.__pendingQueue = []; });
    await page.locator("[data-pending-page='next']").click();
    await expect.poll(() => page.evaluate(() => window.__pendingQueue.length)).toBe(1);
    await page.evaluate(() => { window.__pendingAdmin = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", aal: "aal2" }; });
    await page.evaluate(() => window.__kutadguAdminTest.routeSession());
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await releaseNext(page);
    await expect(page.locator("#pendingSubmissionList")).not.toContainText("تەستىق كىتاب 01");
    await expect.poll(() => page.evaluate(() => window.__pendingQueue.length)).toBe(1);
    await releaseNext(page);
    await reloadPending(page);
    await expect(page.locator(".admin-submission-title").first()).toHaveText("تەستىق كىتاب 21");

    await page.evaluate(() => { window.__pendingHold = true; window.__pendingQueue = []; });
    await reloadPending(page);
    await expect.poll(() => page.evaluate(() => window.__pendingQueue.length)).toBe(1);
    await page.evaluate(() => { window.__pendingSessionOff = true; });
    await page.evaluate(() => window.__kutadguAdminTest.routeSession());
    await expect(page.locator("#loginPanel")).toBeVisible();
    await expect(page.locator(".admin-submission-row")).toHaveCount(0);
    await releaseNext(page);
    await expect(page.locator(".admin-submission-row")).toHaveCount(0);
    await expect(page.locator("#pendingSubmissionList")).not.toContainText("تەستىق كىتاب");

    await page.evaluate(() => {
      window.__pendingSessionOff = false;
      window.__pendingAdmin = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", aal: "aal2" };
      window.__pendingHold = false;
    });
    await page.evaluate(() => window.__kutadguAdminTest.routeSession());
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await reloadPending(page);
    await expect(page.locator(".admin-submission-row")).toHaveCount(10);
    await page.evaluate(() => { window.__pendingHold = true; window.__pendingQueue = []; });
    await reloadPending(page);
    await expect.poll(() => page.evaluate(() => window.__pendingQueue.length)).toBe(1);
    await page.evaluate(() => { document.querySelector("#idleLockPanel").hidden = false; });
    await expect(page.locator(".admin-submission-row")).toHaveCount(0);
    await expect(page.locator("#pendingSubmissionCount")).toHaveText("تەستىق ساقلاۋاتقان: —");
    await releaseNext(page);
    await expect(page.locator(".admin-submission-row")).toHaveCount(0);
    await page.evaluate(() => { document.querySelector("#idleLockPanel").hidden = true; });

    await page.evaluate(() => { window.__pendingHold = false; });
    await reloadPending(page);
    await expect(page.locator(".admin-submission-row")).toHaveCount(10);
    await page.evaluate(() => { window.__pendingHold = true; window.__pendingQueue = []; });
    await reloadPending(page);
    await expect.poll(() => page.evaluate(() => window.__pendingQueue.length)).toBe(1);
    await page.evaluate(() => { window.__pendingAdmin.aal = "aal1"; });
    await releaseNext(page);
    await expect(page.locator(".admin-submission-row")).toHaveCount(0);
    await expect(page.locator("#pendingSubmissionStatus")).toContainText("AAL2");
    await expect(page.locator("#pendingSubmissionCount")).toHaveText("تەستىق ساقلاۋاتقان: —");
    await expect(page.locator("#pendingSubmissionList")).not.toContainText(EMPTY_QUEUE);
    await expectNoOverflow(page);
  });

  test("approve, reject, and edit keep a failed refresh separate from the write", async ({ page }) => {
    page.on("dialog", (dialog) => dialog.accept());
    await page.setViewportSize({ width: 1280, height: 900 });
    await openPending(page, books(2));
    await expect(page.locator(".admin-submission-row")).toHaveCount(2);
    await page.evaluate(() => { window.__pendingHold = true; window.__pendingQueue = []; window.__pendingWrites = []; window.__pendingRpc = []; });
    await reloadPending(page);
    await expect.poll(() => page.evaluate(() => window.__pendingQueue.length)).toBe(1);
    await page.locator("[data-approve-submission]").first().click();
    await expect.poll(() => page.evaluate(() => window.__pendingWrites.length)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__pendingQueue.length)).toBe(2);
    await releaseNext(page);
    await expect(page.locator(".admin-submission-row")).toHaveCount(1);
    await expect(page.locator(".admin-submission-title")).not.toHaveText("تەستىق كىتاب 02");
    await page.evaluate(() => { window.__pendingMode = "error"; });
    await releaseNext(page);
    await expect(page.locator("#pendingSubmissionStatus")).toContainText("كىتاب تەستىقلاندى ۋە ئاممىۋى بولدى.");
    await expect(page.locator("#pendingSubmissionStatus")).toContainText("تىزىملىك يېڭىلانمىدى.");
    await expect(page.locator(".admin-submission-row")).toHaveCount(1);
    const writesAfterApprove = await page.evaluate(() => window.__pendingWrites.length);
    expect(writesAfterApprove).toBe(1);
    expect(await page.evaluate(() => window.__pendingRpc.includes("approve_staff_book_submission"))).toBe(false);
    await page.evaluate(() => { window.__pendingMode = "ok"; window.__pendingHold = false; });
    await page.locator("#pendingSubmissionRetry").click();
    await expect(page.locator(".admin-submission-row")).toHaveCount(1);
    await expect(page.locator(".admin-submission-title")).toHaveText("تەستىق كىتاب 01");
    expect(await page.evaluate(() => window.__pendingWrites.length)).toBe(1);

    await page.evaluate(() => { window.__pendingHold = true; window.__pendingQueue = []; });
    await reloadPending(page);
    await expect.poll(() => page.evaluate(() => window.__pendingQueue.length)).toBe(1);
    await page.locator("[data-reject-submission]").click();
    await expect.poll(() => page.evaluate(() => window.__pendingQueue.length)).toBe(2);
    await releaseNext(page);
    await expect(page.locator(".admin-submission-row")).toHaveCount(0);
    await page.evaluate(() => { window.__pendingMode = "reject"; });
    await releaseNext(page);
    await expect(page.locator("#pendingSubmissionStatus")).toContainText("تەكلىپ رەت قىلىندى");
    await expect(page.locator("#pendingSubmissionStatus")).toContainText("تىزىملىك يېڭىلانمىدى.");
    await expect(page.locator("#pendingSubmissionList")).not.toContainText(EMPTY_QUEUE);
    expect(await page.evaluate(() => window.__pendingWrites.length)).toBe(2);
    await page.evaluate(() => { window.__pendingMode = "ok"; window.__pendingHold = false; });
    await page.locator("#pendingSubmissionRetry").click();
    await expectQueue(page, 0, 0);
    expect(await page.evaluate(() => window.__pendingWrites.length)).toBe(2);
    expect(await page.evaluate(() => window.__pendingRpc.includes("reject_staff_book_submission"))).toBe(false);

    const editable = book(4, {
      id: 9401,
      title: "ئىزدەلگەن نام",
      image_url: "https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/staff/demo/cover.jpg"
    });
    await page.evaluate((rows) => { window.__pendingRows = rows; window.__pendingWrites = []; }, [editable]);
    await page.locator("#pendingSubmissionSearch").fill("ئىزدەلگەن نام");
    await expect(page.locator(".admin-submission-title")).toHaveText("ئىزدەلگەن نام");
    await page.locator("[data-edit-submission]").click();
    await expect(page.locator("#bookModal")).toBeVisible();
    await page.locator("#bookTitle").fill("باشقا نام");
    await page.evaluate(() => { window.__pendingHold = true; window.__pendingQueue = []; });
    await page.evaluate(() => { window.__kutadguAdminTest.loadPendingSubmissions(); });
    await expect.poll(() => page.evaluate(() => window.__pendingQueue.length)).toBe(1);
    await page.evaluate(() => { window.__pendingMode = "error"; });
    await page.locator("#bookSaveBtn").click();
    await expect(page.locator("#bookModal")).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__pendingWrites.length)).toBe(1);
    await releaseNext(page);
    await expect(page.locator(".admin-submission-row")).toHaveCount(0);
    await expect(page.locator("#pendingSubmissionList")).not.toContainText("ئىزدەلگەن نام");
    await expect.poll(() => page.evaluate(() => window.__pendingQueue.length)).toBe(1);
    await releaseNext(page);
    await expect(page.locator("#pendingSubmissionStatus")).toContainText("ئۆزگەرتىشلەر ساقلاندى، لېكىن تىزىملىك يېڭىلانمىدى.");
    await expect(page.locator(".admin-submission-row")).toHaveCount(0);
    expect(await page.evaluate(() => window.__pendingWrites.length)).toBe(1);
    await page.evaluate(() => { window.__pendingMode = "ok"; window.__pendingHold = false; });
    await page.locator("#pendingSubmissionRetry").click();
    await expect(page.locator(".admin-submission-row")).toHaveCount(0);
    await expect(page.locator("#pendingSubmissionStatus")).toHaveText(SEARCH_MISS);
    expect(await page.evaluate(() => window.__pendingWrites.length)).toBe(1);
    expect(await page.evaluate(() => window.__pendingWrites[0].type)).toBe("edit");
    await expectNoOverflow(page);
  });
});
