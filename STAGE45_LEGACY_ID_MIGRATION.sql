-- قۇتادغۇبىلىك — Stage 4.6 / 4.5 legacy_id
-- Supabase > SQL Editor دا Run قىلىڭ. بۇ ھۆججەتنى ئاگېنت ئىجرا قىلمايدۇ.
-- Repeat-safe: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
-- books.id ئۆزگەرمەيدۇ. image_url / created_at / sales_count / RLS تېگىلمەيدۇ.
-- UPDATE/DELETE/INSERT يوق. مەۋجۇت قۇر قىممەتلىرى قايتا يېزىلمايدۇ.
-- service_role ئاچىلمايدۇ.
--
-- بۇ ستوننى CSV ئىمپورتىدىن بۇرۇن قوشۇڭ. ئاندىن CURRENT_CATALOG_TO_SUPABASE.csv
-- نى Admin دا كىرگۈزۈڭ (is_active=false). ئاكتىپلاش STAGE45_ACTIVATE_MIGRATED_CATALOG.sql.

begin;

alter table public.books
  add column if not exists legacy_id text;

comment on column public.books.legacy_id is
  'Optional static-catalog slug. Canonical identity remains books.id (bigint).';

-- بوش/NULL legacy_id تەكرار كىرەلەيدۇ؛ پەقەت تولدۇرۇلغان slug بىردىن-بىر.
create unique index if not exists books_legacy_id_unique_idx
  on public.books (legacy_id)
  where legacy_id is not null and legacy_id <> '';

commit;
