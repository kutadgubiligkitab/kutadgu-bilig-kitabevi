# ChatGPT ئاخىرقى static audit — 2026-08-24

## نەتىجە

ئالدىنقى Mobile/UX پرومپتلىرىدىكى تەلەپلەر كود سەۋىيەسىدە قايتا تەكشۈرۈلدى. ئاساسلىق تەلەپلەرنىڭ كۆپ قىسمى ئەمەلگە ئاشۇرۇلغان.

## بۇ قېتىم تۈزىتىلگەن كەمچىلىك

- ئىگىسى بەرگەن ئادرېستا `KAPI NO: K` بار ئىدى، ئەمما config دا بۇ پارچە چۈشۈپ قالغان. `supabase-config.js` دىكى كۆرۈنمە ئادرېس ۋە Google Maps query تولۇق ئادرېسقا يېڭىلاندى.

## تەكشۈرۈلگەن مۇھىم نۇقتىلار

- WhatsApp نومۇرى: `+90 536 899 98 88` / `905368999888`
- Instagram: `@kutadgu_bilig_kitabhanisi`
- WhatsApp زاكاز ئۇچۇرىدا كىتاب نامى، سانى، بىرلىك باھاسى، قۇر جەمئىي ۋە ئومۇمىي جەمئىي بار.
- Mobile header، hamburger menu، bottom navigation ۋە safe-area قائىدىلىرى بار.
- Mobile filter collapsible ۋە active-filter badge بار.
- 360px ۋە ئۇنىڭدىن كەڭ ئېكراندا 2-column، 359px ۋە ئۇنىڭدىن تاردا 1-column قوغدىشى بار.
- مۇقاۋىلارغا `object-fit: contain` قوغدىشى بار.
- Carousel touch swipe ۋە 7 indicator چەكلىمىسى بار.
- Contact card لار Mobile دا 2-column، ئادرېس full-width؛ 359px دىن تاردا 1-column.
- Mobile CSS نىڭ ئاساسلىق كۆرۈنۈش ئۆزگەرتىشلىرى `@media (max-width: 768px)` ئىچىدە بولۇپ، Desktop regression خەۋپىنى ئازايتىدۇ.
- `admin.html` ۋە `reset-password.html` دۇكان Mobile UI دىن مەقسەتلىك چىقىرىۋېتىلگەن.

## قولدا كۆرۈش كېرەك بولغان ئىش

Static audit كود ۋە ھۆججەت قۇرۇلمىسىنى تەكشۈرىدۇ؛ ھەقىقىي Safari/Chrome كۆرۈنۈشىنى 100% ئالماشتۇرالمايدۇ. Deploy دىن كېيىن 320/360/375/390/414/430/768px ۋە 1366/1440/1920px دا بىر قېتىم visual regression كۆرۈش كېرەك.
