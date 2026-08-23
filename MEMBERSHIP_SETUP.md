# قۇتادغۇبىلىك — ئەزالىق سىستېمىسىنى ئېچىش

بۇ باسقۇچنى بىر قېتىملا قىلىسىز. تور بەت ھۆججەتلىرىنى GitHub قا يۈكلىگەندىن كېيىن تۆۋەندىكى تەرتىپ بويىچە قىلىڭ.

## 1. Database نى تەييارلاش

1. Supabase تۈرىڭىزنى ئېچىڭ.
2. سول تەرەپتىن **SQL Editor** نى ئېچىڭ.
3. بۇ ZIP ئىچىدىكى `SUPABASE_SETUP.sql` ھۆججىتىنى Notepad بىلەن ئېچىڭ.
4. ئىچىدىكى كودنىڭ ھەممىسىنى كۆچۈرۈپ SQL Editor غا چاپلاڭ.
5. **Run** نى بېسىڭ.

بۇ كود كونا كىتاب سانلىق مەلۇماتلىرىنى ئۆچۈرمەيدۇ؛ ئەزالىق، ئارخىپ، زىيارەت، سېۋەت، ياقتۇرغانلار ۋە زاكاز جەدۋەللىرىنى قوشىدۇ.

## 2. تور بەت ئادرېسىنى Auth قا قوشۇش

Supabase دا **Authentication → URL Configuration** نى ئېچىڭ.

- **Site URL**: GitHub Pages تور بېتىڭىزنىڭ باش ئادرېسى
- **Redirect URLs** قا تۆۋەندىكىلەرنى قوشۇڭ:

```text
https://YOUR-NAME.github.io/YOUR-REPOSITORY/account.html
https://YOUR-NAME.github.io/YOUR-REPOSITORY/reset-password.html**
```

`YOUR-NAME` ۋە `YOUR-REPOSITORY` نى ئۆز GitHub نامىڭىز ۋە repository نامىغا ئالماشتۇرۇڭ.

## 3. ئېلخەت ئارقىلىق ئەزالىقنى ئېچىش

Supabase دا **Authentication → Providers → Email** غا كىرىڭ.

- Email provider: ئېچىق بولسۇن.
- Allow new users to sign up: ئېچىق بولسۇن.
- Confirm email: ئېچىق بولسا، خېرىدار تىزىملاتقاندىن كېيىن ئېلخەتتىكى ئۇلانمىنى بېسىپ جەزملەشتۈرىدۇ. بۇ بىخەتەررەك.

## 4. ئۆزىڭىزنى Admin قىلىپ ساقلاش

Supabase دا **Authentication → Users** دىن ئۆز ھېسابىڭىزنىڭ UUID سىنى كۆچۈرۈڭ. SQL Editor دا تۆۋەندىكىنى ئايرىم Run قىلىڭ:

```sql
insert into public.admin_users (user_id)
values ('بۇ يەرگە ئۆز UUID نومۇرىڭىزنى قويۇڭ')
on conflict (user_id) do nothing;
```

Service role key ياكى پارولنى ھەرگىز GitHub ھۆججىتىگە يازماڭ. `supabase-config.js` ئىچىدە پەقەت public Project URL ۋە public anon/publishable key تۇرىدۇ.

## 5. ئاخىرقى سىناق

1. `account.html` نى ئېچىپ يېڭى خېرىدار ھېسابى قۇرۇڭ.
2. كىرىپ ئارخىپتىكى ئىسىم، تېلېفون ۋە ئادرېسنى ساقلاڭ.
3. بىر كىتابنى ياقتۇرۇپ، سېۋەتكە قوشۇڭ؛ چىقىپ قايتا كىرگەندە ساقلانغانلىقىنى تەكشۈرۈڭ.
4. سېۋەتتە زاكاز تەييارلاڭ؛ `account.html` دىكى زاكاز تارىخىدا كۆرۈنۈشى كېرەك.
5. `admin.html` غا ئۆز Admin ھېسابىڭىز بىلەن كىرىپ، خېرىدارنىڭ تىزىملاتقان ۋاقتى، ئاخىرقى زىيارىتى، زىيارەت سانى ۋە زاكاز سانىنى تەكشۈرۈڭ.

## قوشۇلغان ھۆججەتلەر

- `account.html` — كىرىش، تىزىملىتىش، ئارخىپ ۋە زاكاز تارىخى
- `account.css` — ئەزالىق بېتىنىڭ كۆرۈنمە يۈزى
- `account.js` — ئەزالىق بېتىنىڭ ئىقتىدارى
- `member.js` — بارلىق بەتلەردىكى ئەزالىق، زىيارەت، سېۋەت ۋە ياقتۇرغانلارنى ساقلاش
- `member.css` — «كىرىش / ئەزا بولۇش» كۇنۇپكىسى
