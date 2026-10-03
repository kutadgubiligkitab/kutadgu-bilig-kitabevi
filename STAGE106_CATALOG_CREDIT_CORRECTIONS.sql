-- Kutadgu Bilig — Stage 106 reviewed credit corrections
-- MANUAL / REVIEWED APPLY ONLY. Do not run from CI, an agent, or the browser.
-- Does not apply itself to production.
--
-- Apply STAGE106_CATALOG_CREDITS.sql first.
-- Reading public.catalog_credit_review does not separate any name.
-- This file loads an explicit map. It does not split on Arabic comma, comma,
-- spaces, or ۋە. A row changes only when the role and the book's current
-- text, under catalog_identity_key, still equal one reviewed whole string.
-- The book row is locked before that comparison. A mapped review whose
-- current text no longer matches is returned as skipped-stale and is not
-- written. The names array is the reviewed order.
--
-- After this file:
--   select * from public.apply_catalog_credit_corrections();
--   select * from public.catalog_credit_unresolved();
-- Unmapped review rows, including the two publisher strings below, stay one
-- identity. A spacing difference also stays unresolved.
--
-- Intentionally unresolved publishers from the 2026-10-03 active catalog:
--   شىنجاڭ خەلق باش نەشرىياتى، قەشقەر ئۇيغۇر نەشرىياتى
--   شىنجاڭ خەلق نەشرىياتى، قەشقەر ئۇيغۇر نەشرىياتى

begin;

create table if not exists public.catalog_credit_correction_map (
  role text not null,
  legacy_value text not null,
  names jsonb not null,
  constraint catalog_credit_correction_map_pk primary key (role, legacy_value),
  constraint catalog_credit_correction_map_role_chk check (role in ('author', 'translator', 'publisher')),
  constraint catalog_credit_correction_map_names_chk check (
    jsonb_typeof(names) = 'array'
    and jsonb_array_length(names) >= 2
    and jsonb_array_length(names) <= 8
  )
);

comment on table public.catalog_credit_correction_map is
  'Reviewed whole-string corrections. Matching is exact. This is not a splitter.';

insert into public.catalog_credit_correction_map (role, legacy_value, names)
values
  ('author', $m$ھاجى مىرزاھىد كېرىمى، ساۋۇت داۋۇت$m$, $n$["ھاجى مىرزاھىد كېرىمى","ساۋۇت داۋۇت"]$n$::jsonb),
  ('author', $m$مۇھەممەد ئابدۇللا ئابدۇقادىر، بۈۋىنۇر بەكرى$m$, $n$["مۇھەممەد ئابدۇللا ئابدۇقادىر","بۈۋىنۇر بەكرى"]$n$::jsonb),
  ('author', $m$ئەنۋەر جاپپار، پەرھات جىلانوۋ، قادىر قاۋۇز$m$, $n$["ئەنۋەر جاپپار","پەرھات جىلانوۋ","قادىر قاۋۇز"]$n$::jsonb),
  ('author', $m$ئىمام جالالۇددىين سۇيۇتى، ئىمام نەسرۇددىين ئەلبانى$m$, $n$["ئىمام جالالۇددىين سۇيۇتى","ئىمام نەسرۇددىين ئەلبانى"]$n$::jsonb),
  ('author', $m$مۇختار مامۇت، مۇھەممەت تۇرسۇن يۈسۈپ$m$, $n$["مۇختار مامۇت","مۇھەممەت تۇرسۇن يۈسۈپ"]$n$::jsonb),
  ('author', $m$ئەنۋەر بايتۇر، خەيرنىسا سىدىق$m$, $n$["ئەنۋەر بايتۇر","خەيرنىسا سىدىق"]$n$::jsonb),
  ('author', $m$شى شۇەن، جىن چۈنمىڭ$m$, $n$["شى شۇەن","جىن چۈنمىڭ"]$n$::jsonb),
  ('translator', $m$تۇرسۇنگۈل ياسىن، نۇسرەت مەمتىمىن$m$, $n$["تۇرسۇنگۈل ياسىن","نۇسرەت مەمتىمىن"]$n$::jsonb),
  ('translator', $m$ئابدۇرېھىم دۆلەت، ئادىل ئابدۇقادىر$m$, $n$["ئابدۇرېھىم دۆلەت","ئادىل ئابدۇقادىر"]$n$::jsonb),
  ('translator', $m$قېيۇم تۇردى تۇرپانى، ئابدۇرېشىت ئىبراھىم، ئابدۇللا رېشىت$m$, $n$["قېيۇم تۇردى تۇرپانى","ئابدۇرېشىت ئىبراھىم","ئابدۇللا رېشىت"]$n$::jsonb),
  ('translator', $m$نۇرمۇھەممەد دۆلەتى، ھەلىمە مۇھەممەت$m$, $n$["نۇرمۇھەممەد دۆلەتى","ھەلىمە مۇھەممەت"]$n$::jsonb),
  ('translator', $m$ئابدۇلغەنى ئابدۇلئەزىز، سابىرجان$m$, $n$["ئابدۇلغەنى ئابدۇلئەزىز","سابىرجان"]$n$::jsonb),
  ('translator', $m$قۇربان تۇران، ھۆرمەتجان فىكرەت$m$, $n$["قۇربان تۇران","ھۆرمەتجان فىكرەت"]$n$::jsonb),
  ('translator', $m$ئۆمەرجان نۇرى، ئابلىز ئورخۇن$m$, $n$["ئۆمەرجان نۇرى","ئابلىز ئورخۇن"]$n$::jsonb),
  ('translator', $m$ئەركىن ئىبراھىم پەيدا، ئابدۇقادىر جالالىددىن$m$, $n$["ئەركىن ئىبراھىم پەيدا","ئابدۇقادىر جالالىددىن"]$n$::jsonb),
  ('translator', $m$نۇرمۇھەممەد ئۆمەر ئۇچقۇن، روزىتوختى نايىپ$m$, $n$["نۇرمۇھەممەد ئۆمەر ئۇچقۇن","روزىتوختى نايىپ"]$n$::jsonb),
  ('translator', $m$تايىر ئابدۇۋەلى، شەمشىقەمەر يۈسۈپھاجى$m$, $n$["تايىر ئابدۇۋەلى","شەمشىقەمەر يۈسۈپھاجى"]$n$::jsonb),
  ('translator', $m$تايىر ئابدۇۋەلى، ئېلى ئىلى$m$, $n$["تايىر ئابدۇۋەلى","ئېلى ئىلى"]$n$::jsonb),
  ('translator', $m$شەھىدە، خەدىچە$m$, $n$["شەھىدە","خەدىچە"]$n$::jsonb),
  ('translator', $m$داۋۇت غازى، تاھىر تالىپ$m$, $n$["داۋۇت غازى","تاھىر تالىپ"]$n$::jsonb),
  ('translator', $m$مىجىت باۋدۇن، مۇرات پەرسا$m$, $n$["مىجىت باۋدۇن","مۇرات پەرسا"]$n$::jsonb)
on conflict (role, legacy_value) do update
set names = excluded.names;

create or replace function public.apply_catalog_credit_corrections()
returns table(book_id bigint, role text, status text)
language plpgsql
security definer
set search_path = public
as $apply$
declare
  rec record;
  v_current text;
begin
  if to_regclass('public.catalog_credit_review') is null
     or to_regclass('public.catalog_credit_correction_map') is null then
    raise exception 'catalog credit corrections require STAGE106' using errcode = '42704';
  end if;
  for rec in
    select r.book_id, r.role, r.legacy_value, m.names
    from public.catalog_credit_review r
    join public.catalog_credit_correction_map m
      on m.role = r.role
     and m.legacy_value = r.legacy_value
    order by r.book_id, r.role, r.legacy_value
  loop
    -- Lock first, then read. A concurrent edit waits, so the comparison
    -- uses the text that is still current when the correction can write.
    select case rec.role
      when 'author' then b.author
      when 'translator' then b.translator
      else b.publisher
    end
    into v_current
    from public.books b
    where b.id = rec.book_id
    for update;

    if not found or public.catalog_identity_key(v_current) is distinct from rec.legacy_value then
      book_id := rec.book_id;
      role := rec.role;
      status := 'skipped-stale';
      return next;
      continue;
    end if;

    perform public.catalog_write_role_credits(rec.book_id, rec.role, rec.names);
    book_id := rec.book_id;
    role := rec.role;
    status := 'corrected';
    return next;
  end loop;
end;
$apply$;

create or replace function public.catalog_credit_unresolved()
returns table(book_id bigint, role text, legacy_value text)
language sql
stable
security definer
set search_path = public
as $unresolved$
  select r.book_id, r.role, r.legacy_value
  from public.catalog_credit_review r
  where not exists (
    select 1
    from public.catalog_credit_correction_map m
    where m.role = r.role
      and m.legacy_value = r.legacy_value
  )
  order by r.role, r.book_id, r.legacy_value;
$unresolved$;

comment on function public.apply_catalog_credit_corrections() is
  'Writes reviewed names only when the locked book text still matches. A stale review returns skipped-stale and is not written.';
comment on function public.catalog_credit_unresolved() is
  'Review rows this map does not correct. Selecting them does not separate names.';

revoke all on table public.catalog_credit_correction_map from public, anon, authenticated;
revoke all on function public.apply_catalog_credit_corrections() from public, anon, authenticated;
revoke all on function public.catalog_credit_unresolved() from public, anon, authenticated;

commit;
