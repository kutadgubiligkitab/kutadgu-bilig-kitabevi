TEMP DIAGNOSTIC BUILD
Upload ONLY these 4 files to the GitHub project root:
- index.html
- mobile.css
- mobile.js
- shop.js

Do NOT run any Supabase SQL.

On iPhone, open the homepage and look for the small black DIAG badge near the bottom.
It updates every second:
- If “heartbeat” keeps increasing, JavaScript main thread is alive.
- Touch anywhere and “touch:” should show the element receiving the touch.
- If “blocked→disabled:” shows an element/class, a full-screen element was covering the page and this build disabled it.

This is a temporary diagnostic safe-mode build, not the final production cleanup.
