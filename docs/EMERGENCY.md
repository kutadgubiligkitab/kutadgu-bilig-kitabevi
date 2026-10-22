# If production is broken right now

Production application traffic is Cloudflare Worker `kutadgu-cloudflare-production` (`wrangler.jsonc` → `env.production.name`) on `https://www.kutadgubilik.com`. `https://kutadgubilik.com/` returns 308 to that host. Rollback uses Wrangler 4.145.0. A Worker rollback restores an already published Worker version. It does not restore Supabase, SQL, Storage, or R2 cover bytes. Database and cover recovery stay in `STAGE11_RECOVERY.md`. `STAGE11_RECOVERY.md` §5 still says to promote a Vercel deployment; use this page for the application rollback instead.

1. **Stop** merges, SQL, CSV imports, and further `wrangler deploy` commands.
2. **Identify** the failed layer before changing anything:
   - blank page, HTTP 500, or bad JS/CSS → application (this Worker)
   - wrong or missing books, Admin data, or login data → database
   - page loads but covers are missing → Storage / R2
3. **Application:** identify and verify the previous known-good Worker version, then roll back to that version id. A version id written in an older `PROJECT-RECOVERY.md` paragraph is history for that release, not the permanent target.
4. **Do not** run ad-hoc SQL or a second import to repair the first one.
5. **Database:** restore only from a Dashboard backup or a dump whose timestamp is before the incident. Prefer one table over the whole project. Do this separately from the Worker rollback.
6. **Smoke** on `https://www.kutadgubilik.com` after the application is serving the verified version. These routes were checked with unauthenticated GET and redirects disabled on 2026-10-23:
   - `/` returned 200. Search is `#searchInput` on that page. `/search` returned 404.
   - `/book/658`, `/book/657`, and `/book/656` returned 200. `book.html?id=102` returned 308 to `/book/102`, and `/book/102` returned 404.
   - `/volume-group/series-156` returned 200.
   - `/cart.html` returned 200 (guest cart).
   - `/admin.html` returned 200 (Admin login is `#loginPanel`).
   - If one of those book or series URLs later returns 404, open another live `/book/{id}` or `/volume-group/{slug}` of the same shape. Playwright is appropriate when it stays read-only.
7. **Write down** the time, the Worker version id now at 100%, the backup id if the database was restored, what changed, and what is still wrong.

## Identify the Worker version before rollback

Run these from the repository root so Wrangler reads `wrangler.jsonc`. Always pass `--env production`. Without it, Wrangler selects the top-level Worker, `kutadgu-cloudflare-preview`. These commands only read deployment metadata:

```sh
npx wrangler deployments status --env production --json
npx wrangler deployments list --env production --json
npx wrangler versions list --env production --json
npx wrangler versions view <version-id> --env production --json
```

`deployments status` is the version currently receiving traffic. Record its version id, created time, author, source, and traffic percentage. `deployments list` and `versions list` each show the 10 most recent records (`wrangler deployments list --help` and `wrangler versions list --help`, Wrangler 4.145.0). `versions view` reads one candidate and does not create a deployment.

Choose the latest version that was serving production before the incident and is not the version that is failing. Confirm that candidate's version id, created time, author, and source with `versions view` before rolling back. Wrangler can roll back to one of the 100 most recently published versions ([Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)). If the known-good version is older than the 10 rows those list commands print, use the Cloudflare dashboard: Workers & Pages → `kutadgu-cloudflare-production` → Deployments → the verified version → Rollback. A binding to an R2 bucket, KV namespace, or queue that no longer exists blocks the rollback. Connected resources and their data stay as they are.

## Roll back only the verified version

`wrangler rollback --help` shows `version-id` as optional. [Current Wrangler documentation](https://developers.cloudflare.com/workers/wrangler/commands/workers/#rollback) says an omitted id selects the version uploaded before the latest upload. That upload can be a secret change or another intermediate version. Pass the version id you just verified:

```sh
npx wrangler rollback <version-id> --env production
```

Do not add `-y` until that id has been checked. Rollback immediately creates a new deployment of the selected existing version and sends 100% of traffic to it on the attached domains. It does not change GitHub `main`. A later `wrangler deploy --env production` replaces it. This repository has no workflow that deploys the Worker on merge.

After the command, run `npx wrangler deployments status --env production --json` again and confirm the verified version is at 100% before the smoke checks above.

Full database and Storage playbook: `STAGE11_RECOVERY.md`
