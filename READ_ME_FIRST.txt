Kutadgu mobile root-cause fix

Upload/replace these 4 files at the repository ROOT:
- index.html
- shop.js
- mobile.js
- mobile.css

No Supabase SQL is required.

What this fixes:
1) shop.js binds UI immediately instead of waiting for Supabase/network.
2) Supabase availability check times out after 3s; catalog page queries time out after 5s and fall back safely.
3) Home carousel/category data refresh after remote catalog becomes ready.
4) Hidden mobile backdrop cannot intercept taps.
5) Mobile MutationObserver no longer rescans the entire document on every dynamic update.
6) index.html cache-bust versions are bumped to shop.js?v=43, mobile.js?v=5, mobile.css?v=5.

After deployment, confirm the deployed page source contains shop.js?v=43 and mobile.js?v=5.
