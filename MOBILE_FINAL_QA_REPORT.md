# Mobile كەسپىي ياخشىلاش — ئاخىرقى QA دوكلاتى

## تاماملانغان ئۆزگەرتىشلەر

- Mobile غا خاس `mobile.css` ۋە `mobile.js` قوشۇلدى؛ Desktop نىڭ ئەسلى قىممەتلىرى بىۋاسىتە ئۆزگەرتىلمىدى.
- باش بەت header ئىخچاملاشتۇرۇلۇپ، hamburger menu، لوگو ۋە سېۋەت كۇنۇپكىسى رەتلەندى.
- باشقا كىتاب/تۈر/تەپسىلات بەتلىرىگە Mobile دا بىر تۇتاش كىچىك header قوشۇلدى.
- Mobile ئاستىغا safe-area غا ماس سېۋەت، ياقتۇرغانلار ۋە ھېسابىم يولباشلاش بالدىقى قوشۇلدى.
- Hero بۆلىكىنىڭ Mobile ئېگىزلىكى ۋە بوشلۇقى ئازايتىلدى؛ كىتابخانا بېزەك كۆرۈنۈشى ساقلاپ قېلىندى.
- ئىزدەش ۋە سۈزگۈچ Mobile دا يىغىلىدىغان panel قىلىندى؛ active filter سانى badge دا كۆرۈنىدۇ.
- كىتاب كارتىلىرى 360px ۋە ئۇنىڭدىن كەڭ Mobile دا 2-column، 359px ۋە ئۇنىڭدىن تاردا 1-column قىلىندى.
- بارلىق مۇقاۋا رايونلىرىغا نىسبەتنى ساقلايدىغان `object-fit: contain` ۋە مۇقىم container قائىدىسى بېرىلدى.
- Slider غا touch swipe قوشۇلدى؛ Mobile دا بىرلا ۋاقىتتا ئەڭ كۆپ 7 indicator كۆرۈنىدۇ.
- «تەۋسىيەلىك»، «كۆپ سېتىلغان» ۋە «يېڭى كەلگەن» slider tab لىرى تولۇقلاندى.
- RTL، touch target، typography، button، card، spacing، cart، favorites، detail، contact ۋە footer Mobile دا بىر تۇتاش قىلىندى.
- تېكىست كىرگۈزۈش رامكىلىرى ئۇيغۇرچە/ئەرەبچە بولسا RTL، لاتىنچە بولسا LTR غا ئاپتوماتىك ماسلىشىدىغان `dir="auto"` بىلەن كۈچەيتىلدى.
- ھەقىقىي WhatsApp، تېلېفون، Instagram ۋە Google Maps ئادرېس ئۇلانمىلىرى تەڭشەلدى.
- WhatsApp زاكاز نومۇرى `+90 536 899 98 88` قىلىندى.
- سېۋەت بوش ھالەتتىكى «كىتابلارنى كۆرۈش» كۇنۇپكىسى رەتلەندى.
- Cache دا كونا JavaScript/ئالاقە تەڭشىكى قېلىپ قالماسلىقى ئۈچۈن version query يېڭىلاندى.

## قوغداش تەكشۈرۈشى

- 6 دانە ئەسلى رەسىم/مۇقاۋا ھۆججىتى filename ۋە path بويىچە ساقلاپ قېلىندى.
- 6 رەسىمنىڭ ھەممىسى ئەسلى ZIP بىلەن byte-for-byte ئوخشاش چىقتى.
- لوگو، banner، sample cover ۋە مەۋجۇت كىتاب سانلىق مەلۇماتلىرى ئۆچۈرۈلمىدى.
- `localStorage` key لىرى ئۆزگەرتىلمىدى:
  - `kutadgu-cart-v1`
  - `kutadgu-favorites-v1`
  - `kutadgu-recent-v1`
  - `kutadgu-customer-v1`

## ئاپتوماتىك سىناق نەتىجىسى

- HTML: 108 بەت parse بولدى.
- Local link/asset reference: 1385 دانە تەكشۈرۈلدى.
- Missing local file/link: 0.
- Duplicate HTML ID: 0.
- JavaScript syntax: PASS.
- CSS brace/quote balance: PASS.
- Local HTTP smoke test: index، cart، favorites، detail، listing، CSS، JS ۋە رەسىملەر 200 قايتۇردى.
- WhatsApp، Instagram ۋە Maps config قىممەتلىرى كودتا تەكشۈرۈلدى.

## كۆرسىتىش سىنىقى توغرىسىدا

بۇ خىزمەت مۇھىتىدا Chromium executable يوق، browser download بولسا 0-byte ھۆججەت قايتۇرغانلىقى ئۈچۈن Playwright screenshot سىنىقى ئىجرا بولمىدى. شۇڭا deploy دىن كېيىن ھەقىقىي Chrome/Safari دا 320، 360، 375، 390، 414، 430، 768، 1366، 1440 ۋە 1920px كەڭلىكلەرنى بىر قېتىم كۆرۈپ چىقىش كېرەك. Static regression، syntax، link، asset ۋە رەسىم قوغداش سىناقلىرىنىڭ ھەممىسى ئۆتتى.

## Deploy دىن كېيىنكى قىسقا تەكشۈرۈش

1. Mobile menu نى ئېچىپ-يېپىش ۋە dark mode نى سىناڭ.
2. بىر كىتابنى ياقتۇرغانلارغا ۋە سېۋەتكە قوشۇڭ؛ بەتنى refresh قىلىپ ساقلانغانلىقىنى كۆرۈڭ.
3. ساننى `+ / −` بىلەن ئۆزگەرتىپ، جەمئىي باھانى تەكشۈرۈڭ.
4. WhatsApp زاكاز كۇنۇپكىسىنى بېسىپ نومۇر ۋە ئالدىن تەييار ئۇچۇرنى كۆرۈڭ.
5. Instagram، تېلېفون ۋە ئادرېس card لىرىنى بېسىپ توغرا ئېچىلغانلىقىنى تەكشۈرۈڭ.
6. 1366px ياكى ئۇنىڭدىن كەڭ Desktop دا header، Hero، slider، card ۋە footer نىڭ بۇرۇنقىدەك ئىكەنلىكىنى كۆرۈڭ.
