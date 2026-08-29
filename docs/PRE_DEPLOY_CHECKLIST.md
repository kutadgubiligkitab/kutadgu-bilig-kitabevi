# Pre-deploy checklist

Print or tick in the PR.

## Before SQL (production SQL Editor)

- [ ] Backup exists: Dashboard daily/PITR **or** `scripts/backup-supabase.sh` from today
- [ ] Read the file for `DELETE` / `DROP` / `TRUNCATE` / wide `UPDATE`
- [ ] Tables named in the PR (`books`, `profiles`, …)
- [ ] Repeat-safe **or** one-shot with a restore note
- [ ] Agent/CI will **not** Run this SQL

## Before merge

- [ ] Branch off `main`; Draft PR; one topic
- [ ] Preview URL or production-safe Playwright (`npx playwright test`)
- [ ] Cart/favorites/member untouched unless that is the change
- [ ] No secrets, dumps, or `.env` in the diff

## After merge

- [ ] Vercel Production **Ready**
- [ ] Ctrl+F5: home, search, one book, cart
- [ ] If SQL ran: Admin count + known `book.html?id=`
- [ ] If sitemap/API changed: `/sitemap.xml` 200

Remember: **Vercel rollback ≠ database rollback.**
