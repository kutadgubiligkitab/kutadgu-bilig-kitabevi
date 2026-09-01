/*
  قۇتادغۇبىلىك كىتابخانىسى — مەركىزىي UX/config
  دۇكان ئۇچۇرى supabase-config.js تا، UX ۋە feature قىممەتلىرى بۇ يەردە باشقۇرۇلىدۇ.
*/
(function(){
  "use strict";

  const current=window.KUTADGU_APP_CONFIG||{};
  window.KUTADGU_APP_CONFIG={
    ...current,
    shopName:current.shopName||"قۇتادغۇبىلىك كىتابخانىسى",
    shippingText:current.shippingText||"دۇنيانىڭ ھەرقايسى جايلىرىغا كىتاب ئەۋەتىمىز",
    shippingNote:current.shippingNote||"توشۇش ھەققى دۆلەت، ئېغىرلىق ۋە توشۇش ئۇسۇلىغا قاراپ ئۆزگىرىدۇ.",
    storageKeys:{
      cart:"kutadgu-cart-v1",
      favorites:"kutadgu-favorites-v1",
      recentlyViewed:"kutadgu-recent-v1",
      customer:"kutadgu-customer-v1",
      ...(current.storageKeys||{})
    },
    featureFlags:{
      discovery:true,
      smartWizard:true,
      smartSearchSuggestions:true,
      smartEmptyState:true,
      recentlyViewed:true,
      recommendations:true,
      newArrivals:true,
      bestSellers:true,
      dailyRecommendation:false,
      autoCarousel:true,
      analyticsHooks:true,
      ...(current.featureFlags||{})
    },
    carousel:{
      desktopCardsPerRow:4,
    desktopRows:1,
    tabletVisibleCards:4,
    mobileVisibleCards:1.35,
    autoplayDelay:5000,
      animationDuration:600,
      staggerDelay:90,
      autoPlayEnabled:true,
      mobileAutoPlayEnabled:false,
      ...(current.carousel||{})
    },
    /* Admin تۈرىگە بىر قۇر قوشۇش ئارقىلىق مەركەزدىن باشقۇرۇشقا بولىدۇ. */
    catalogCategories:current.catalogCategories||[
      {source:"romanlar.html",label:"رومانلار"},{source:"tarikhiy-romanlar.html",label:"تارىخىي رومانلار"},
      {source:"sheirlar.html",label:"شېئىرلار"},{source:"hekayiler.html",label:"ھېكايىلەر"},
      {source:"dastanlar.html",label:"داستانلار"},{source:"dunya-edebiyati.html",label:"دۇنيا ئەدەبىياتى"},
      {source:"adabiyat-roman.html",label:"ئەدەبىيات رومانلىرى"},{source:"uyghur-adabiyati.html",label:"ئۇيغۇر ئەدەبىياتى"},
      {source:"universal.html",label:"ئۇنىۋېرسال"},{source:"tibb.html",label:"تېبابەت ۋە ساغلاملىق"},
      {source:"derslik.html",label:"دەرسلىك"},{source:"terbiye.html",label:"پەرزەنت تەربىيەسى"},
      {source:"dini.html",label:"دىنىي كىتابلار"},{source:"children.html",label:"بالىلار كىتابلىرى"}
    ],
    discoveryGroups:current.discoveryGroups||[
      {
        id:"literature",
        label:"ئەدەبىيات",
        icon:"📖",
        categories:["رومانلار","تارىخىي رومانلار","شېئىرلار","ھېكايىلەر","داستانلار","دۇنيا ئەدەبىياتى","ئەدەبىيات رومانلىرى","ئۇيغۇر ئەدەبىياتى"]
      },
      {
        id:"history",
        label:"تارىخ",
        icon:"🏛️",
        categories:["تارىخىي رومانلار","ئۇيغۇر ئەدەبىياتى"]
      },
      {
        id:"religion",
        label:"دىنىي",
        icon:"🕌",
        categories:["دىنىي كىتابلار"]
      },
      {
        id:"children",
        label:"بالىلار",
        icon:"🧒",
        categories:["بالىلار كىتابلىرى","پەرزەنت تەربىيەسى","دەرسلىك"]
      }
    ]
  };
})();
