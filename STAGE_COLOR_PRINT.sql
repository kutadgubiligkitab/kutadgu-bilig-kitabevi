-- قۇتادغۇبىلىك كىتابخانىسى — optional color-print flag
-- Supabase > SQL Editor دا Run قىلىڭ. بۇ ھۆججەتنى ئاگېنت ئىجرا قىلمايدۇ.
-- Repeat-safe: ADD COLUMN IF NOT EXISTS.
-- كىتاب قۇرلىرى قايتا يېزىلمايدۇ. باھا / ئامبار / زاكاز / RLS ئۆزگەرتىلمەيدۇ.
-- مەۋجۇت قۇرلار DEFAULT false بىلەن بەلگىلەنمىگەن ھالەتتە قالىدۇ.
-- service_role ئاچىلمايدۇ. ئاممىۋى يېزىش ھوقۇقى كېڭەيمەيدۇ.

begin;

alter table public.books
  add column if not exists is_color_print boolean not null default false;

comment on column public.books.is_color_print is
  'Optional: true when interior pages are color printed. false = unmarked; public site shows nothing.';

commit;

-- RLS: يېڭىسى يوق. SELECT يەنىلا ئاممىۋى ئاكتىپ كىتاب؛ يېزىش يەنىلا
-- authenticated + public.is_kutadgu_admin() ۋە AAL2 restrictive policies.
