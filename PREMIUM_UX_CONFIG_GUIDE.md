# Premium UX ۋە باشقۇرۇش قىسقا يېتەكچىسى

## كىتاب باشقۇرۇش

- يېڭى كىتاب، باھا، مۇقاۋا، تۈر، ئامبار، يېڭى/تەۋسىيە/كۆپ سېتىلغان بەلگىسى: `admin.html`
- تور سانلىق مەلۇمات ئامبىرى ئىشلىمىگەن چاغدىكى static كىتابلار: `catalog.js`
- بىر كىتابنىڭ static ئۇچۇرى بىرلا قېتىم `catalog.js` تا ساقلىنىدۇ.

## دۇكان ۋە ئالاقە

- WhatsApp، تېلېفون، Instagram ۋە ئادرېس: `supabase-config.js`
- زاكاز WhatsApp نومۇرى: `window.KUTADGU_WHATSAPP_NUMBER`

## UX ۋە feature toggle

- Discovery تۈرلىرى، carousel سۈرئىتى ۋە feature toggle: `app-config.js`
- Feature نى ۋاقىتلىق تاقاش ئۈچۈن مۇناسىۋەتلىك `featureFlags` قىممىتىنى `false` قىلىڭ.
- Carousel قىممەتلىرى `carousel` بۆلىكىدىن باشقۇرۇلىدۇ؛ JS ئىچىدىن سان ئىزدەش ھاجەتسىز.

## يېڭى مودۇللار

- `premium-ux.js`: discovery، wizard، search suggestion، 0-result، filter chip، detail recommendation ۋە analytics hook.
- `premium-ux.css`: پەقەت يۇقىرىدىكى يېڭى UX بۆلەكلىرىنىڭ لايىھەسى.
- ئەسلى مۇقاۋا، لوگو ۋە media ھۆججەتلىرى بۇ مودۇللار تەرىپىدىن ئۆزگەرتىلمەيدۇ.

## Rollback

- بۇ خىزمەتتىن بۇرۇنقى مۇقىم نۇسخا: ئىشلەتكۈچى تەمىنلىگەن `kutadgu-bilig-kitabevi-main(10).zip`.
- يېڭى UX نى تېز توختىتىش: `app-config.js` ئىچىدىكى مۇناسىۋەتلىك feature flag نى `false` قىلىش.
