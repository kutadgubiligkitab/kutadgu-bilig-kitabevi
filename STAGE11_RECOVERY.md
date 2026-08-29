# Stage 11 — Backup, rollback, and recovery

This is the recovery playbook for **قۇتادغۇبىلىك كىتابخانىسى**
(`kutadgubiligkitab/kutadgu-bilig-kitabevi`).

Production site: `https://kutadgu-bilig-kitab.vercel.app`  
Supabase project ref (public): `fxlojnqwyojqjskfggmh`

**Vercel rollback does not roll back Supabase.** A bad SQL import or migration stays broken until the database (or Storage) is restored separately.

Do not put database passwords, `service_role`, or Vercel tokens in git.

---

## 1. Current recovery capabilities (audit)

### GitHub

- Default branch: `main`.
- Cloud-agent / feature work uses `cursor/<name>-fd87` branches, **Draft PRs**, QA, then merge. No auto-merge.
- Stage 10 Playwright: `.github/workflows/stage10-regression.yml` (PR + `workflow_dispatch`).
- Migration SQL lives in the repo as **manual** files. Agents are not supposed to execute production SQL.

### Vercel

- Static site + `api/sitemap-*.js`. `vercel.json` rewrites `/sitemap.xml` and `/sitemap-books.xml`.
- Production tracks GitHub `main`. A new merge creates a Production deployment.
- Previous Production deployments remain in the Vercel dashboard and can be **promoted** (code-only rollback).

### Supabase / SQL in repo

| File | Role |
|---|---|
| `SUPABASE_SETUP.sql` | Core schema: `admin_users`, `books`, `profiles`, `member_favorites`, `member_cart_items`, `orders`, `analytics_events`, RLS, `book-covers` bucket |
| `DATABASE_UPGRADE_V9.sql` / `V10.sql` | Column / analytics table upgrades |
| `CATALOG_*.sql` | Catalog scale, indexes, collection rules |
| `STAGE4_*.sql` | Admin indexes, analytics RPC |
| `STAGE45_*.sql` / `STAGE46_*.sql` | `legacy_id`, migrated-catalog activation, analytics legacy |
| `STAGE61_BIBLIOGRAPHIC_METADATA.sql` | Bibliographic columns |
| `GALLERY_IMAGES_MIGRATION.sql` | `books.gallery_images` (URLs only) |
| `STAGE8_STORE_ANALYTICS.sql` | Analytics RPC |
| `STAGE91_ADMIN_IMPORT_SCALE.sql` | Admin stock-sum RPC |
| `ADMIN_DUPLICATE_EDIT_CLEANUP.sql` | **Human-only DELETE** of specific duplicate book ids — not repeat-safe, not auto-run |

There were **no backup scripts or recovery docs** before this Stage 11 file.

### Important tables (from repo SQL only — not invented)

- `public.books`
- `public.admin_users`
- `public.profiles`
- `public.member_favorites`
- `public.member_cart_items`
- `public.orders`
- `public.analytics_events`
- Plus Supabase-managed `auth.users` (referenced by member tables; not created in our SQL files)
- Storage metadata: `storage.buckets` / `storage.objects` (files themselves are **not** in a SQL dump of `public`)

### Storage

- Bucket **`book-covers`** (public read; admin write). Config: `supabase-config.js` `bucket`.
- Gallery extras are **URL/path strings** in `books.gallery_images`, typically the same bucket — not a second bucket in SQL.

### Environment / config (no secret values listed)

| What | Where | Notes |
|---|---|---|
| Public Supabase URL + publishable/anon key | `supabase-config.js`, `kutadgu-sitemap.js` | **Public by design** (RLS-gated). Not `service_role`. |
| Site origin | `supabase-config.js` `KUTADGU_SITE_ORIGIN` | Public |
| WhatsApp / phone / address | `supabase-config.js` | Public store contact |
| Playwright optional logins | GitHub Actions `secrets.*` names only | Values not in git |
| Optional dump URL | local env `SUPABASE_DB_URL` | Must never be committed |

### Accidental secrets in git (this audit)

See section 10. **No `service_role`, DB password, or private token values found** in current files or a scan of `main` for common leak patterns.

---

## 2. Data classification

| Data | Class | Why |
|---|---|---|
| `books` (titles, prices, `image_url`, `legacy_id`, flags, `sales_count`) | **Critical** | Live catalog. Static `catalog.js` is only a small fallback seed, not the 5k–20k catalog. |
| `admin_users` | **Critical** | Losing this locks Admin. Recreating needs a known Auth UUID. |
| `auth.users` (Supabase Auth) | **Critical** | Member/Admin login. Restored with a full DB backup, not with `anon` API. |
| `profiles` | **Critical** | Member PII (name, phone, address). |
| `orders` | **Critical** | Prepared WhatsApp order history for members. |
| `member_cart_items` / `member_favorites` | **Critical for logged-in members** | Guest cart/favs live in **browser localStorage** (`kutadgu-cart-v1`, `kutadgu-favorites-v1`) — not in Postgres. |
| Storage objects in `book-covers` | **Critical** | Cover/gallery bytes. **Daily Postgres backups do not include file bytes.** |
| `books.gallery_images` JSON | **Critical** (paths) | Rebuildable only if files still exist. |
| `analytics_events` | **Recoverable / low business impact** | Funnel stats; can start empty. Prefer keep. |
| `catalog.js` static rows | **Recoverable / rebuildable** | Git history + fallback if Supabase is down. Not a substitute for live `books`. |
| Git-tracked HTML/JS/CSS | **Recoverable** | GitHub + Vercel deployments. |
| Guest localStorage cart | **Temporary / device-local** | Cannot be restored from Supabase. |

---

## 3. Supabase backup plan

Prefer **Dashboard backups** (official). Add **off-site dumps** so you are not dependent on plan retention.

### A. Dashboard (Pro / Team / Enterprise)

1. Open [Database → Backups](https://supabase.com/docs/guides/platform/backups).
2. Confirm **daily backups** exist (Pro: last **7** days; Team 14; Enterprise up to 30).
3. Optional: enable **Point-in-Time Recovery (PITR)** if a day’s data loss is unacceptable (paid add-on). PITR replaces daily logical download behavior — still restore from the Dashboard.

**Free plan:** Dashboard daily backups are **not** available. Export regularly with CLI/`pg_dump` (below) and keep copies off-site.

### B. Logical dump (schema + data) — local, secrets in env only

Official pattern: [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

1. Dashboard → **Connect** → copy the URI into a **local** env var `SUPABASE_DB_URL` (never git).
2. Run `scripts/backup-supabase.sh` (export only).
3. Store `backups/local/` on a disk/cloud folder **outside** this repo.

Cadence:

| When | What |
|---|---|
| Weekly (minimum) | Full logical dump (schema + data) |
| Before **any** SQL Editor Run on production | Fresh dump **or** confirm a Dashboard backup newer than last write |
| Before a **large CSV import** | Dump `books` at least |
| After a successful import | Another dump (known-good snapshot) |
| Monthly | Storage (`book-covers`) copy via Dashboard S3 / rclone |

### C. Storage

Postgres backups **do not restore JPEG/WebP bytes**.

1. Dashboard → Storage → `book-covers` (spot-check).
2. For bulk: Storage → Configuration → **S3** credentials (save once locally) + rclone/AWS CLI. See [Download objects](https://supabase.com/docs/guides/storage/management/download-objects).
3. Keep `books.image_url` / `gallery_images` dumps so paths still match files.

### D. What this repo will not do

- No script runs against production without **your** env var.
- No script restores unless you type an explicit confirmation string.
- Agents must not execute production SQL.

---

## 4. Restore plan by incident

### A. Bad catalog import

**First:** Stop importing. Do not “fix” with a second full CSV overwrite.

**Do not:** DELETE FROM books; re-run activation SQL; mass `is_active=true`.

**Then:**

1. In Admin, identify bad rows (created_at window, missing ISBN, duplicate titles).
2. If the import only **inserted** new rows: hide them (`is_active=false`) or delete **only those ids** after listing them.
3. If the import **updated** existing rows: restore `books` from the dump taken **before** the import (table-only restore — see `scripts/restore-from-dump.sh` comments) **or** Dashboard backup from before the import.
4. Do not restore `member_*` / `orders` unless they were also damaged.

**Verify:** Admin counts, storefront search for a known title, `book.html?id=<bigint>`, Playwright Stage 10 search/detail tests.

### B. Accidental book deletion

**First:** Note the id / `legacy_id` / title. Do not re-import the whole catalog.

**Do not:** Recycle ids casually if members still have that id in cart/favorites.

**Then:** Restore that row from a dump (`COPY`/`INSERT` of one row) or Dashboard PITR/daily backup if many rows vanished. Prefer **insert the missing row** over a full-database restore when the rest of the DB is healthy.

**Verify:** Detail URL, cart add, cover URL 200.

### C. Bad SQL migration

**First:** Stop running more SQL. Screenshot the error.

**Do not:** Re-run a half-applied file; DROP TABLE; restore from a dump **older than** unrelated good member orders unless necessary.

**Then:**

1. If the file is repeat-safe (`IF NOT EXISTS` / `CREATE OR REPLACE`) and only **added** objects: leave it or add a follow-up additive migration.
2. If it **deleted/updated** rows (`ADMIN_DUPLICATE_EDIT_CLEANUP.sql` style): restore those rows from dump or reverse with a reviewed SQL (human-written).
3. If schema is broken: restore schema+data from the pre-migration dump / Dashboard backup.

**Verify:** Admin login, storefront listing, one member login if possible.

### D. Broken member cart / favorites

**First:** Decide: **guest** (localStorage) vs **logged-in** (Postgres).

**Do not:** Truncate `member_cart_items` globally; merge SQL “to be safe”; run identity migrations on production without a dump.

**Then:**

- Guest: affected browser only — clear `kutadgu-cart-v1` / `kutadgu-favorites-v1` if polluted; cannot restore from server.
- Member: restore **only** `member_cart_items` and/or `member_favorites` from dump taken before the incident. Keep `books` as-is if catalog is fine.
- If book ids changed: repair is identity mapping (Stage P0 rules) — not a full DB wipe.

**Verify:** Login, cart qty 1 stays 1 after refresh, no auto `children-3`/`children-4`.

### E. Broken Vercel deployment

**First:** Is it HTML/JS (blank page, 404, sitemap 500) or data (wrong books)? If data, skip to A–D.

**Do not:** Push random commits to `main`; run SQL “to match the new code”; delete the Vercel project.

**Then:** Follow **§5 Vercel rollback**. Then Stage 10 smoke (homepage, search, cart, sitemap).

**Verify:** Production URL, `Ctrl+F5`, Playwright against production (read-safe).

### F. Corrupted cover / gallery Storage

**First:** Check whether `image_url` still points at a good path (DB) vs file missing/overwritten (Storage).

**Do not:** Rewrite all `image_url` values; restore an old **database** that would roll back catalog edits just to get files back.

**Then:** Re-upload files to `book-covers` with the **same object paths**, or rclone from the last Storage backup. Only update `books.image_url` if the path actually changed.

**Verify:** Detail page cover, listing cards, gallery if `gallery_images` is enabled.

---

## 5. Vercel rollback (code only)

1. Vercel → project → **Deployments**.
2. Filter **Production**. Open the last deployment that was known-good (time + git SHA from GitHub `main`).
3. **⋯ → Promote to Production** (wording may be “Redeploy” / “Promote”). That restores **frontend + serverless sitemap API** to that build.
4. **GitHub `main` does not move** when you promote an old deployment. The next `main` merge will deploy **new** code again. If `main` itself is bad, **revert the merge on GitHub** (new PR) so git and Vercel match.
5. **Supabase is untouched.** Catalog, members, Storage stay as they are.

CLI (optional, local login): `vercel rollback` — still code-only.

---

## 6. GitHub safety

- Never commit to `main` directly.
- One concern per PR (import scale ≠ visual polish ≠ recovery docs).
- Draft PR → preview or production-safe Playwright → human review → merge. **No auto-merge.**
- Before important merges: `npx playwright test` (Stage 10). Set `KUTADGU_PREVIEW_URL` when a preview exists.
- PRs that include `*.sql` must say **“SQL Editor, human Run only”** and list affected tables. Prefer `IF NOT EXISTS` / `CREATE OR REPLACE`. Files that `DELETE`/`UPDATE` rows need a dump first and a row list in the PR.
- Do not commit `.env`, dump files, or `service_role`.

---

## 7. Pre-deploy checklist

**Before SQL**

- [ ] Dump or Dashboard backup confirmed (timestamp)
- [ ] File is reviewed; search for `DELETE` / `DROP` / `TRUNCATE` / unconstrained `UPDATE`
- [ ] Affected tables listed
- [ ] Repeat-safe, or explicitly one-shot with a rollback note

**Before merge**

- [ ] Draft PR; preview if available
- [ ] Stage 10 Playwright green (or documented skips)
- [ ] No storefront redesign / cart identity surprises unless that is the PR
- [ ] SQL **not** executed by CI

**After merge**

- [ ] Vercel Production Ready
- [ ] `Ctrl+F5` homepage, search, one `book.html?id=`, cart add
- [ ] If SQL was run: Admin book count / one known id
- [ ] Sitemap 200 if SEO/API changed

---

## 8. Emergency — production is broken right now

1. **Stop.** No more merges, SQL, or imports.
2. **Classify:** browser error / bad JS → **code** (Vercel). Wrong books / login / Admin → **database**. Missing images → **Storage**. Mix is possible.
3. **Code:** promote last good Production deployment (§5).
4. **Do not** paste ChatGPT SQL into production.
5. **DB:** restore only from a **verified** Dashboard backup or a dump you took, to a **known timestamp** from before the incident. Prefer table-scoped restore over full wipe.
6. **Smoke:** homepage, search, detail, guest cart, Admin login page. Playwright if possible.
7. **Write down:** time, what you rolled back, dump/backup id, remaining risk.

---

## 9. Helper scripts (low risk)

| Script | Does | Does not |
|---|---|---|
| `scripts/backup-supabase.sh` | Logical dump to `backups/local/` | Restore, DELETE, push |
| `scripts/backup-verify.sh` | Checks dump files are non-empty | Connect to DB |
| `scripts/restore-from-dump.sh` | `psql` restore **only if** confirm env vars are set | Run from CI; run without confirmation |

---

## 10. Secret / security audit

| Finding | Severity |
|---|---|
| No `service_role` **values** in current tree or `main` scan for `sb_secret_`, JWT `eyJhbGci`, `postgres://`, `DATABASE_URL=` | OK |
| Public publishable key in `supabase-config.js` and `kutadgu-sitemap.js` | Expected (anon). Rotate only if it was also a **legacy JWT secret** leaked with elevated grants — current key is `sb_publishable_…` |
| GitHub Actions references `secrets.KUTADGU_*` by **name** | OK |
| `ADMIN_DUPLICATE_EDIT_CLEANUP.sql` contains production **ids** and a DELETE | Not a credential leak; treat as dangerous SQL |
| Store phone/address in `supabase-config.js` | Public business info, not a secret |

**CRITICAL rotation:** none required from this audit. If a `service_role` or DB password is ever pasted into a gist/chat/PR, rotate it in Supabase **immediately** (API settings / database password) and treat all past dumps as compromised.

---

## Related files

- `docs/PRE_DEPLOY_CHECKLIST.md`
- `docs/EMERGENCY.md`
- `.env.example` (variable **names** only)
