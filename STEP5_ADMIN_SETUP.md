# STEP5 — بىخەتەر Admin Panel نى ئۇلاش

بۇ نۇسخىدا ساختا HTML پارول ئىشلىتىلمىدى.
Admin بىخەتەرلىكى Supabase Auth + Row Level Security (RLS) بىلەن قۇرۇلدى.

## ZIP نى GitHub غا قويغاندا نېمە بولىدۇ؟
- بۇرۇنقى STEP1–STEP4 ئىقتىدارلىرى نورمال ئىشلەيدۇ.
- Supabase تېخى ئۇلانمىغان بولسا، public تور بەت static catalog نى ئىشلىتىدۇ.
- `admin.html` نى ئاچسىڭىز «Supabase نى ئۇلاش كېرەك» دەپ كۆرسىتىدۇ.
- Supabase ئۇلانغاندىن كېيىن Admin دىن قوشۇلغان كىتابلار GitHub نى قايتا ئۆزگەرتمەيلا تور بەتتە كۆرۈنىدۇ.

## بىر قېتىم قىلىدىغان ئىشلار
1. Supabase دا يېڭى Project قۇرۇڭ.
2. SQL Editor نى ئېچىپ `SUPABASE_SETUP.sql` نىڭ ھەممىسىنى Paste قىلىپ Run قىلىڭ.
3. Authentication > Users بۆلىمىدە ئۆزىڭىزگە Email/Password user قۇرۇڭ.
4. شۇ user نىڭ UUID سىنى كۆچۈرۈڭ.
5. SQL Editor دا تۆۋەندىكى بىر قۇرنى Run قىلىڭ:
   insert into public.admin_users (user_id) values ('سىزنىڭ-UUID')
   on conflict (user_id) do nothing;
6. Project URL ۋە PUBLIC anon/publishable key نى `supabase-config.js` غا قويۇڭ.
   - Service-role key نى ھەرگىز تور بەتكە قويماڭ.
7. GitHub غا `supabase-config.js` نى يېڭىلاپ Upload قىلىڭ.
8. `/admin.html` نى ئېچىپ Email/Password بىلەن كىرىڭ.
9. تۇنجى قېتىم «ھازىرقى كىتابلارنى Database قا كىرگۈزۈش» نى بىر قېتىم بېسىڭ.

## Admin دىن قىلالايدىغانلىرىڭىز
- يېڭى كىتاب قوشۇش
- كىتاب نامى / ئاپتور / باھا / ئامبار / تۈرنى ئۆزگەرتىش
- بەت سانى / تەرجىمان / تىل / نەشر ۋاقتى / نەشرىيات / چۈشەندۈرۈش
- مۇقاۋا رەسىمى Upload قىلىش
- يېڭى كىتاب ياكى تەۋسىيە قىلىنغان دەپ بەلگە سېلىش
- كىتابنى تور بەتتىن يوشۇرۇش / قايتا كۆرسىتىش
- ھازىرقى 84 دانە static كىتابنى بىر كۇنۇپكا بىلەن Database قا Import قىلىش

## Public تور بەتتە قانداق ئىشلەيدۇ؟
`shop.js` ئالدى بىلەن Supabase دىن catalog نى ئوقۇيدۇ.
ئۇلانمىسا static `catalog.js` نى fallback قىلىپ ئىشلىتىدۇ.
Remote كىتابلار:
- باش بەت ئىزدەشتە
- «مېنىڭ كىتابلىرىم» دا
- مۇناسىۋەتلىك كىتابلاردا
- تاللانغان category بېتىدە
- generic `book.html?id=...` تەپسىلات بېتىدە
ئاپتوماتىك كۆرۈنىدۇ.

## بىخەتەرلىك
- Admin پارولى HTML/JS دا ساقلانمايدۇ.
- پەقەت `admin_users` تىزىملىكىدىكى Auth user كىتاب يازالايدۇ.
- Database write ۋە Storage upload RLS بىلەن قوغدىلىدۇ.
# يېڭى ئەزالىق نۇسخىسى ھەققىدە مۇھىم ئەسكەرتىش

ھازىرقى ئەڭ يېڭى نۇسخىدا Admin بىلەن بىللە خېرىدار ئەزالىقىمۇ بار. شۇڭا ئاۋۋال `MEMBERSHIP_SETUP.md` نى ئېچىپ، شۇ يەردىكى يېڭى تەرتىپ بويىچە `SUPABASE_SETUP.sql` نى ئىجرا قىلىڭ. تۆۋەندىكى مەزمۇن پەقەت كونا Admin باسقۇچىنىڭ ئارخىپى سۈپىتىدە ساقلانغان.
