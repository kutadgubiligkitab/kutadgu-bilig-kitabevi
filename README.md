# قۇتادغۇبىلىك كىتابخانىسى

قۇتادغۇبىلىك كىتابخانىسىنىڭ Vercel دا ئىشلەيدىغان static frontend ۋە Supabase-backed catalog project ى.

## Production entry points

- `index.html` — باش بەت
- `index.css` — باش بەتنىڭ ئۆزىگە خاس style لىرى
- `theme.css` / `theme.js` — ئورتاق theme ۋە كۈندۈز/كېچە ھالىتى
- `shop.css` / `shop.js` — catalog، search، cart، favorites، WhatsApp ۋە book UI
- `mobile.css` / `mobile.js` — 768px ۋە ئۇنىڭدىن كىچىك كۆرۈنۈشلەر
- `catalog.js` — Supabase ئىشلىمىگەندە static fallback catalog
- `supabase-config.js` — public Supabase config ۋە دۇكان ئالاقە ئۇچۇرلىرى
- `analytics.js` — شەخسىي ئۇچۇر ساقلىمايدىغان event analytics
- `admin.html` / `admin.css` / `admin.js` — Admin panel
- `account.html` / `account.css` / `account.js` — خېرىدار ھېسابى
- `book.html` — database كىتابلىرىنىڭ dynamic detail بېتى

## Assets

Logo، font ۋە كىتاب مۇقاۋا filename/path لىرى database ۋە static catalog بىلەن بىۋاسىتە باغلانغان. ئۇلارنى reference audit قىلماي rename، move ياكى delete قىلماڭ.

## Database

`*.sql` ھۆججەتلىرى setup ۋە migration تارىخى. ئۇلارنى project cleanup جەريانىدا ئۆچۈرمەڭ ياكى قايتا قۇرماڭ. يېڭى migration لازىم بولغاندا يېڭى، idempotent SQL قوشۇڭ.

## Deploy

Project root نى GitHub قا يۈكلەڭ؛ Vercel `index.html` نى production entry قىلىدۇ. `vercel.json` static asset cache header لىرىنى باشقۇرىدۇ.

## Maintenance safety

- Search/category/filter/pagination query لىرى `shop.js` تا server-side Supabase REST ئارقىلىق ئىجرا بولىدۇ.
- Supabase ۋاقىتلىق جاۋاب بەرمىسە static catalog fallback ئىشلىتىلىدۇ.
- `is_recommended` ۋە `is_new` Admin تاللىشى؛ bestseller نىڭ مەنبەسى `sales_count`.
- WhatsApp كۇنۇپكىسىنى بېسىش `sales_count` نى ئۆزلۈكىدىن كۆپەيتمەيدۇ.
- ئۆزگەرتىشتىن كېيىن Desktop، Tablet ۋە Mobile regression QA قىلىڭ.
