const { test, expect } = require("./playwright-test");

const SUGGEST_ROWS = [
  {
    id: 1,
    title: "ئىسلام تارىخى",
    author: "ئابدۇللا ھاجى روزى",
    translator: "ئەلى تەرجىمان",
    publisher: "شىنجاڭ خەلق نەشرىياتى",
    isbn: "9781111111111"
  },
  {
    id: 2,
    title: "بالىلار ھېكايىسى",
    author: "ئابدۇللا ھاجى روزى",
    translator: "",
    publisher: "شىنجاڭ خەلق نەشرىياتى",
    isbn: "9782222222222"
  },
  {
    id: 3,
    title: "ھاجىلار يولى",
    author: "باشقا ئاپتور",
    translator: "ئەلى تەرجىمان",
    publisher: "مىللەتلەر نەشرىياتى",
    isbn: "9783333333333"
  }
];

const PENDING_BOOK = {
  id: 9401,
  title: "تەستىق كۈتۈۋاتقان كىتاب",
  author: "ئەسلى ئاپتور",
  translator: "تەرجىمان",
  publisher: "نەشرىيات",
  isbn: "9781111111111",
  price: 45,
  stock: 3,
  category: "ئۇنىۋېرسال",
  source: "universal.html",
  publish_year: 2024,
  pages: 120,
  cover_type: "paperback",
  book_size: "A5",
  original_price: 60,
  dimensions: "14x21",
  is_color_print: true,
  interior_print_type: "bw",
  description: "قىسقىچە چۈشەندۈرۈش",
  image_url: "https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/staff/demo/cover.jpg",
  gallery_images: [
    "https://fxlojnqwyojqjskfggmh.supabase.co/storage/v1/object/public/book-covers/staff/demo/g1.jpg"
  ],
  submitted_by: "staff-user",
  submitted_at: "2026-09-01T10:00:00.000Z",
  submission_status: "pending",
  is_active: false,
  is_available: false
};

async function openAdminEditor(page, extraInit) {
  await page.addInitScript((rows) => {
    window.__kutadguSkipAdminAuth = true;
    window.__kutadguSkipSuggestFetch = true;
    window.__kutadguSuggestionRows = rows;
    window.__kutadguAdminPreviewBooks = [];
  }, SUGGEST_ROWS);
  if (extraInit) await page.addInitScript(extraInit);
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dashboardPanel")).toBeVisible();
  await page.locator("#newBookBtn").click();
  await expect(page.locator("#bookModal")).toBeVisible();
}

async function openStaffForm(page) {
  await page.addInitScript((rows) => {
    window.__kutadguSkipStaffRoute = true;
    window.__kutadguSkipSuggestFetch = true;
    window.__kutadguSuggestionRows = rows;
  }, SUGGEST_ROWS);
  await page.goto("/book-staff.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    const workspace = document.getElementById("staffWorkspace");
    const loading = document.getElementById("staffLoading");
    const signedOut = document.getElementById("staffSignedOut");
    const form = document.getElementById("staffBookForm");
    if (loading) loading.hidden = true;
    if (signedOut) signedOut.hidden = true;
    if (workspace) workspace.hidden = false;
    if (form) form.hidden = false;
  });
  await expect(page.locator("#staffBookForm")).toBeVisible();
}

async function noOverflow(page) {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth
  }));
  expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.client + 1);
}

test.describe("book entry suggestions", () => {
  test("Admin author/translator/publisher contains match, keyboard, click, escape, and free text", async ({ page }) => {
    await openAdminEditor(page);
    const author = page.locator("#bookAuthor");
    await expect(author).toHaveAttribute("role", "combobox");
    await author.fill("ھاجى");
    const authorList = page.locator("#bookAuthor").locator("xpath=following-sibling::ul[@role='listbox']");
    await expect(authorList).toBeVisible();
    await expect(authorList.locator("[role='option']")).toHaveCount(1);
    await expect(authorList.locator("[role='option']")).toHaveText("ئابدۇللا ھاجى روزى");
    await author.press("ArrowDown");
    await author.press("Enter");
    await expect(author).toHaveValue("ئابدۇللا ھاجى روزى");
    await expect(authorList).toBeHidden();

    const translator = page.locator("#bookTranslator");
    await translator.fill("ئەلى");
    const translatorList = page.locator("#bookTranslator").locator("xpath=following-sibling::ul[@role='listbox']");
    await expect(translatorList.locator("[role='option']")).toHaveText("ئەلى تەرجىمان");
    await translatorList.locator("[role='option']").click();
    await expect(translator).toHaveValue("ئەلى تەرجىمان");

    const publisher = page.locator("#bookPublisher");
    await publisher.fill("خەلق");
    const publisherList = page.locator("#bookPublisher").locator("xpath=following-sibling::ul[@role='listbox']");
    await expect(publisherList.locator("[role='option']")).toHaveText("شىنجاڭ خەلق نەشرىياتى");
    await publisher.press("Escape");
    await expect(publisherList).toBeHidden();
    await expect(publisher).toHaveValue("خەلق");

    await publisher.fill("يېڭى نەشرىيات");
    await expect(publisherList).toBeHidden();
    await expect(publisher).toHaveValue("يېڭى نەشرىيات");

    await expect(page.locator("#bookTitle")).not.toHaveAttribute("role", "combobox");
  });

  test("Admin title shows similar warning and is not filled from suggestions", async ({ page }) => {
    await openAdminEditor(page);
    const title = page.locator("#bookTitle");
    const warn = page.locator("#bookTitleSimilarWarning");
    await title.fill("ئىسلام تارىخى");
    await expect(warn).toBeVisible({ timeout: 5000 });
    await expect(warn).toContainText("بۇ نامغا ئوخشايدىغان كىتاب بار، قايتا تەكشۈرۈپ بېقىڭ.");
    await expect(warn).toContainText("ئىسلام تارىخى");
    await expect(warn).toContainText("ئابدۇللا ھاجى روزى");
    await expect(warn).toContainText("9781111111111");
    await title.fill("پۈتۈنلەي يېڭى نام");
    await expect(warn).toBeHidden({ timeout: 5000 });
    await expect(page.locator("#bookTitle")).toHaveValue("پۈتۈنلەي يېڭى نام");
  });

  test("existing Admin create duplicate warning UI remains separate from title similarity", async ({ page }) => {
    await openAdminEditor(page);
    await expect(page.locator("#createDuplicateWarning")).toHaveCount(1);
    await expect(page.locator("#createDuplicateConfirm")).toHaveCount(1);
    await expect(page.locator("#bookTitleSimilarWarning")).toHaveCount(1);
    await expect(page.locator("#createDuplicateWarning")).toBeHidden();
    await page.locator("#bookTitle").fill("ئىسلام تارىخى");
    await expect(page.locator("#bookTitleSimilarWarning")).toBeVisible();
    await expect(page.locator("#createDuplicateWarning")).toBeHidden();
  });

  test("Book Staff suggestions, advisory title warning, and submit stays enabled", async ({ page }) => {
    await openStaffForm(page);
    const author = page.locator("#staffAuthor");
    await author.fill("ھاجى");
    const authorList = page.locator("#staffAuthor").locator("xpath=following-sibling::ul[@role='listbox']");
    await expect(authorList.locator("[role='option']")).toHaveText("ئابدۇللا ھاجى روزى");
    await authorList.locator("[role='option']").click();
    await expect(author).toHaveValue("ئابدۇللا ھاجى روزى");

    await page.locator("#staffTranslator").fill("ئەلى");
    const translatorList = page.locator("#staffTranslator").locator("xpath=following-sibling::ul[@role='listbox']");
    await expect(translatorList.locator("[role='option']")).toHaveText("ئەلى تەرجىمان");

    await page.locator("#staffPublisher").fill("مىللەت");
    const publisherList = page.locator("#staffPublisher").locator("xpath=following-sibling::ul[@role='listbox']");
    await expect(publisherList.locator("[role='option']")).toHaveText("مىللەتلەر نەشرىياتى");

    await page.locator("#staffTitle").fill("ئىسلام تارىخى");
    await expect(page.locator("#staffTitleSimilarWarning")).toBeVisible();
    await expect(page.locator("#staffTitleSimilarWarning")).toContainText("بۇ نامغا ئوخشايدىغان كىتاب بار، قايتا تەكشۈرۈپ بېقىڭ.");
    await expect(page.locator("#staffSubmitBtn")).toBeEnabled();
    await expect(page.locator("#staffTitle")).not.toHaveAttribute("role", "combobox");
    await expect(page.locator("#staffSource")).toHaveJSProperty("tagName", "SELECT");
  });

  test("forms still work when suggestion fetch is empty/failed", async ({ page }) => {
    await page.addInitScript(() => {
      window.__kutadguSkipAdminAuth = true;
      window.__kutadguSkipSuggestFetch = true;
      window.__kutadguSuggestionRows = [];
      window.__kutadguAdminPreviewBooks = [];
    });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await page.locator("#newBookBtn").click();
    await page.locator("#bookAuthor").fill("يېڭى ئاپتور");
    await expect(page.locator("#bookAuthor").locator("xpath=following-sibling::ul[@role='listbox']")).toBeHidden();
    await expect(page.locator("#bookAuthor")).toHaveValue("يېڭى ئاپتور");
    await page.locator("#bookTitle").fill("يېڭى كىتاب");
    await expect(page.locator("#bookTitleSimilarWarning")).toBeHidden();
    await expect(page.locator("#bookForm button[type='submit']")).toBeEnabled();
  });

  test("Pending edit still prefills and Save stays pending with typeahead optional", async ({ page }) => {
    page.on("dialog", (dialog) => dialog.accept());
    await page.addInitScript((book) => {
      window.__kutadguSkipAdminAuth = true;
      window.__kutadguSkipSuggestFetch = true;
      window.__kutadguSuggestionRows = [
        { id: 8, title: "باشقا", author: "ئابدۇللا ھاجى روزى", translator: "", publisher: "", isbn: "" }
      ];
      window.__kutadguPendingSaves = [];
      window.__kutadguBookSaves = [];
      window.__kutadguPendingSubmissionFixtures = [JSON.parse(JSON.stringify(book))];
      window.__kutadguAdminPersistPending = async (id, payload) => {
        window.__kutadguPendingSaves.push({ id: Number(id), payload: { ...payload } });
        const row = window.__kutadguPendingSubmissionFixtures.find((b) => String(b.id) === String(id));
        if (row) Object.assign(row, payload, { submission_status: "pending", is_active: false, is_available: false });
        return { error: null };
      };
      window.__kutadguAdminPersistBook = async (payload, operation, id) => {
        window.__kutadguBookSaves.push({ payload: { ...payload }, operation, id: String(id || "") });
        return { error: new Error("pending save must not use persistBookRow") };
      };
    }, PENDING_BOOK);
    await page.goto("/admin.html#submissions", { waitUntil: "domcontentloaded" });
    await page.locator('[data-admin-section="submissions"]').click();
    await page.locator("[data-edit-submission]").click();
    await expect(page.locator("#bookTitle")).toHaveValue(PENDING_BOOK.title);
    await expect(page.locator("#bookAuthor")).toHaveValue(PENDING_BOOK.author);
    await page.locator("#bookAuthor").fill("ھاجى");
    const pendingAuthorList = page.locator("#bookAuthor").locator("xpath=following-sibling::ul[@role='listbox']");
    await expect(pendingAuthorList.locator("[role='option']")).toHaveCount(1);
    await page.locator("#bookAuthor").fill(PENDING_BOOK.author);
    await page.locator("#bookSaveBtn").click();
    await expect(page.locator("#bookModal")).toBeHidden();
    const result = await page.evaluate(() => ({
      pending: window.__kutadguPendingSaves.slice(),
      books: window.__kutadguBookSaves.slice()
    }));
    expect(result.pending.length).toBe(1);
    expect(result.books.length).toBe(0);
    expect(result.pending[0].payload.is_active).toBeUndefined();
  });

  for (const width of [390, 768, 1366]) {
    test(`no horizontal overflow at ${width}px with dropdown open`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await openAdminEditor(page);
      await page.locator("#bookAuthor").fill("ھاجى");
      await expect(page.locator("#bookAuthor").locator("xpath=following-sibling::ul[@role='listbox']")).toBeVisible();
      await noOverflow(page);
    });
  }

  for (const width of [390, 768, 1366]) {
    test(`Book Staff has no horizontal overflow at ${width}px with dropdown open`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await openStaffForm(page);
      await page.locator("#staffAuthor").fill("ھاجى");
      await expect(page.locator("#staffAuthor").locator("xpath=following-sibling::ul[@role='listbox']")).toBeVisible();
      await noOverflow(page);
    });
  }

  test("signed-out Admin does not fetch suggestion rows; login loads Admin-visible rows; logout clears; re-login refetches", async ({ page }) => {
    const ADMIN_KEY = "kutadgu-admin-auth-v1";
    const MEMBER_KEY = "kutadgu-member-auth-v1";
    const hiddenAuthor = "يوشۇرۇلغان ئاپتور";
    await page.addInitScript(({ ADMIN_KEY, MEMBER_KEY, hiddenAuthor }) => {
      window.__kutadguSuggestBookSelects = 0;
      window.__kutadguSuggestSelectFields = [];
      const now = Math.floor(Date.now() / 1000);
      function blob(user, token) {
        if (!user) return null;
        return { access_token: token, refresh_token: token + "-refresh", expires_at: now + 3600, user };
      }
      function readAdmin() {
        try { return JSON.parse(localStorage.getItem(ADMIN_KEY) || "null"); } catch (e) { return null; }
      }
      function writeAdmin(session) {
        if (!session) localStorage.removeItem(ADMIN_KEY);
        else localStorage.setItem(ADMIN_KEY, JSON.stringify(session));
      }
      function chain(result) {
        const q = {};
        ["select", "eq", "in", "or", "order", "range", "is", "limit", "gte", "lte", "neq"].forEach((m) => {
          q[m] = () => q;
        });
        q.update = async () => result;
        q.insert = async () => result;
        q.delete = async () => result;
        q.maybeSingle = async () => result;
        q.single = async () => result;
        q.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
        return q;
      }
      const suggestRows = [
        { id: 1, title: "ئوچۇق كىتاب", author: "ئوچۇق ئاپتور", translator: "", publisher: "ئوچۇق نەشرىيات", isbn: "9781111111111" },
        { id: 2, title: "يوشۇرۇلغان كىتاب", author: hiddenAuthor, translator: "تەرجىمان", publisher: "يوشۇرۇلغان نەشرىيات", isbn: "9782222222222" }
      ];
      function makeAdminClient() {
        return {
          auth: {
            getSession: async () => ({ data: { session: readAdmin() }, error: null }),
            getUser: async () => {
              const s = readAdmin();
              return { data: { user: s && s.user || null }, error: s && s.user ? null : { name: "AuthSessionMissingError" } };
            },
            onAuthStateChange: (cb) => {
              setTimeout(() => cb("INITIAL_SESSION", readAdmin()), 0);
              return { data: { subscription: { unsubscribe() {} } } };
            },
            signOut: async (opts) => {
              if (!opts || opts.scope !== "local") throw new Error("expected local signOut");
              writeAdmin(null);
              return { error: null };
            },
            signInWithPassword: async ({ email }) => {
              writeAdmin(blob({ id: "admin-1", email: email || "admin-owner@example.com" }, "admin-access"));
              return { error: null };
            },
            mfa: {
              async listFactors() { return { data: { all: [], totp: [], phone: [] }, error: null }; },
              async getAuthenticatorAssuranceLevel() {
                return { data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null };
              }
            }
          },
          from(table) {
            if (table === "admin_users") {
              const u = readAdmin() && readAdmin().user;
              const ok = u && u.id === "admin-1";
              return chain(ok ? { data: { user_id: "admin-1" }, error: null, count: 1 } : { data: null, error: null, count: 0 });
            }
            if (table === "books") {
              const q = chain({ data: [], error: null, count: 0 });
              q.select = (fields) => {
                if (String(fields) === "id,title,author,translator,publisher,isbn") {
                  window.__kutadguSuggestBookSelects += 1;
                  window.__kutadguSuggestSelectFields.push(String(fields));
                  const suggest = chain({ data: suggestRows, error: null, count: suggestRows.length });
                  suggest.range = () => suggest;
                  return suggest;
                }
                return q;
              };
              return q;
            }
            return chain({ data: [], error: null, count: 0 });
          },
          rpc: async () => ({ data: false, error: null })
        };
      }
      let supabaseValue;
      Object.defineProperty(window, "supabase", {
        configurable: true,
        enumerable: true,
        get() { return supabaseValue; },
        set(v) {
          if (v && typeof v.createClient === "function") {
            v.createClient = function (url, key, options) {
              const storageKey = options && options.auth && options.auth.storageKey;
              if (storageKey === ADMIN_KEY) return makeAdminClient();
              throw new Error("Admin page must not create Member suggestion client");
            };
          }
          supabaseValue = v;
        }
      });
    }, { ADMIN_KEY, MEMBER_KEY, hiddenAuthor });

    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#loginPanel")).toBeVisible({ timeout: 30_000 });
    const signedOut = await page.evaluate(() => ({
      selects: window.__kutadguSuggestBookSelects || 0,
      rows: window.__kutadguSuggestionRows || []
    }));
    expect(signedOut.selects).toBe(0);
    expect(signedOut.rows).toEqual([]);

    await page.locator("#adminEmail").fill("admin-owner@example.com");
    await page.locator("#adminPassword").fill("password");
    await page.locator("#loginForm button[type='submit']").click();
    await expect(page.locator("#dashboardPanel")).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => page.evaluate(() => window.__kutadguSuggestBookSelects || 0)).toBeGreaterThan(0);
    const authed = await page.evaluate((hiddenAuthor) => {
      const S = window.KutadguBookEntrySuggest;
      const rows = window.__kutadguSuggestionRows || [];
      return {
        selects: window.__kutadguSuggestBookSelects,
        authors: S.uniqueValuesFromRows(rows, "author"),
        hasHidden: S.uniqueValuesFromRows(rows, "author").includes(hiddenAuthor),
        fields: (window.__kutadguSuggestSelectFields || []).slice()
      };
    }, hiddenAuthor);
    expect(authed.hasHidden).toBe(true);
    expect(authed.fields.every((f) => f === "id,title,author,translator,publisher,isbn")).toBe(true);

    const afterFirst = authed.selects;
    await page.locator("#adminLogout").click();
    await expect(page.locator("#loginPanel")).toBeVisible();
    const afterLogout = await page.evaluate(() => ({
      rows: window.__kutadguSuggestionRows || [],
      selects: window.__kutadguSuggestBookSelects || 0
    }));
    expect(afterLogout.rows).toEqual([]);

    await page.locator("#adminEmail").fill("admin-owner@example.com");
    await page.locator("#adminPassword").fill("password");
    await page.locator("#loginForm button[type='submit']").click();
    await expect(page.locator("#dashboardPanel")).toBeVisible();
    await expect.poll(async () => page.evaluate(() => window.__kutadguSuggestBookSelects || 0)).toBeGreaterThan(afterFirst);
    const relog = await page.evaluate((hiddenAuthor) => {
      const S = window.KutadguBookEntrySuggest;
      return S.uniqueValuesFromRows(window.__kutadguSuggestionRows || [], "author").includes(hiddenAuthor);
    }, hiddenAuthor);
    expect(relog).toBe(true);
  });

  test("Member session on Admin page does not populate Admin suggestion cache", async ({ page }) => {
    const ADMIN_KEY = "kutadgu-admin-auth-v1";
    const MEMBER_KEY = "kutadgu-member-auth-v1";
    await page.addInitScript(({ ADMIN_KEY, MEMBER_KEY }) => {
      window.__kutadguSuggestBookSelects = 0;
      const now = Math.floor(Date.now() / 1000);
      const member = {
        access_token: "member-access",
        refresh_token: "member-access-refresh",
        expires_at: now + 3600,
        user: { id: "member-1", email: "customer@example.com" }
      };
      localStorage.setItem(MEMBER_KEY, JSON.stringify(member));
      localStorage.removeItem(ADMIN_KEY);
      function chain(result) {
        const q = {};
        ["select", "eq", "in", "or", "order", "range", "is", "limit", "gte", "lte", "neq"].forEach((m) => {
          q[m] = () => q;
        });
        q.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
        return q;
      }
      let supabaseValue;
      Object.defineProperty(window, "supabase", {
        configurable: true,
        enumerable: true,
        get() { return supabaseValue; },
        set(v) {
          if (v && typeof v.createClient === "function") {
            v.createClient = function (url, key, options) {
              const storageKey = options && options.auth && options.auth.storageKey;
              if (storageKey !== ADMIN_KEY) throw new Error("Admin page must use Admin auth storage");
              return {
                auth: {
                  getSession: async () => ({ data: { session: null }, error: null }),
                  getUser: async () => ({ data: { user: null }, error: { name: "AuthSessionMissingError" } }),
                  onAuthStateChange: (cb) => {
                    setTimeout(() => cb("INITIAL_SESSION", null), 0);
                    return { data: { subscription: { unsubscribe() {} } } };
                  },
                  signOut: async () => ({ error: null }),
                  mfa: { async getAuthenticatorAssuranceLevel() { return { data: { currentLevel: "aal1" }, error: null }; } }
                },
                from(table) {
                  if (table === "books") {
                    return {
                      select(fields) {
                        if (String(fields) === "id,title,author,translator,publisher,isbn") {
                          window.__kutadguSuggestBookSelects += 1;
                        }
                        return chain({ data: [], error: null });
                      }
                    };
                  }
                  return chain({ data: null, error: null, count: 0 });
                }
              };
            };
          }
          supabaseValue = v;
        }
      });
    }, { ADMIN_KEY, MEMBER_KEY });
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#loginPanel")).toBeVisible({ timeout: 30_000 });
    const state = await page.evaluate(() => ({
      selects: window.__kutadguSuggestBookSelects || 0,
      rows: window.__kutadguSuggestionRows || [],
      member: !!localStorage.getItem("kutadgu-member-auth-v1"),
      admin: localStorage.getItem("kutadgu-admin-auth-v1")
    }));
    expect(state.member).toBe(true);
    expect(state.admin).toBeFalsy();
    expect(state.selects).toBe(0);
    expect(state.rows).toEqual([]);
  });
});
