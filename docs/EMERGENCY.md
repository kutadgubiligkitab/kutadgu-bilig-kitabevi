# If production is broken right now

1. **Stop** merges, SQL, and CSV imports.
2. **Identify:** code (blank/500/JS) vs database (wrong/missing books, Admin, login) vs Storage (covers).
3. **Code:** Vercel → Deployments → last good **Production** → Promote. Does **not** undo SQL.
4. **Do not** run random SQL or a second import to “fix” the first.
5. **Database:** restore only from a Dashboard backup or a dump with a timestamp **before** the incident. Prefer one table over the whole project.
6. **Smoke:** home, search, `book.html?id=102`, guest cart, Admin login page. Playwright if you can.
7. **Write** time, backup id, what you restored, what is still wrong.

Full playbook: `STAGE11_RECOVERY.md`
