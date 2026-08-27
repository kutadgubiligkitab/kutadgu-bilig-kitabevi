-- قۇتادغۇبىلىك — Stage 4.6 migrated catalog activation
-- Supabase > SQL Editor دا پەقەت ئىگىسى Run قىلىدۇ. ئاگېنت ئىجرا قىلمايدۇ.
--
-- شەرت: STAGE45_LEGACY_ID_MIGRATION.sql ئىجرا قىلىنغان.
-- شەرت: 84 قۇر legacy_id بىلەن ئىمپورت قىلىنغان ۋە Admin دا تەكشۈرۈلگەن.
--
-- پەقەت legacy_id تولدۇرۇلغان قۇرلار ئاكتىپلىنىدۇ.
-- سانى دەل 84 بولمىسا ترانزاكسىيە توختايدۇ؛ قىسمەن ئاكتىپلاش يوق.
-- books.id / image_url / created_at / sales_count / RLS ئۆزگەرمەيدۇ.
--
-- كۈتۈلگەن سانى: 84

begin;

select pg_advisory_xact_lock(450846);

do $$
declare
  v_expected integer := 84;
  v_found integer;
begin
  select count(*)::integer into v_found
  from public.books
  where legacy_id is not null
    and btrim(legacy_id) <> '';

  if v_found is distinct from v_expected then
    raise exception
      'activation refused: expected % migrated rows with non-empty legacy_id, found %',
      v_expected, v_found;
  end if;

  update public.books
  set is_active = true
  where legacy_id is not null
    and btrim(legacy_id) <> '';
end $$;

commit;
