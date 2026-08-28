-- READ-ONLY PROPOSAL. Do NOT run until a human reviews production rows.
-- Confirmed accidental Admin-edit duplicates for
-- «ئۆزىمىزنى ئېتىراپ قىلايلى» / author ئەختەم ئۆمەر
-- (read 2026-08-28, not deleted by the agent):
--
-- Canonical original:
--   id=1  legacy_id=ozumuzni-etirap-qilayli  price=265  created_at=2026-08-27
-- Accidental duplicates (no legacy_id, created after each price edit):
--   id=96 price=555
--   id=97 price=666
--   id=98 price=777
--   id=99 price=888   ← latest typed price
--
-- This script copies the latest intended price onto id=1, keeps legacy_id and
-- created_at on id=1, then deletes only those four duplicate ids.
-- Favorites/cart/analytics keyed to id=1 are preserved.
-- Rows 96–99 may have been favorited after the bad edits; inspect member tables
-- before running if that matters.

begin;

update public.books b
set
  price = d.price,
  title = d.title,
  author = d.author,
  image_url = d.image_url,
  source = d.source,
  is_active = d.is_active,
  updated_at = now()
from public.books d
where b.id = 1
  and d.id = 99
  and b.legacy_id = 'ozumuzni-etirap-qilayli';

-- Safety: canonical row must still exist with the original legacy_id.
do $$
begin
  if not exists (
    select 1 from public.books
    where id = 1 and legacy_id = 'ozumuzni-etirap-qilayli'
  ) then
    raise exception 'Canonical book id=1 was not found; aborting cleanup';
  end if;
end $$;

delete from public.books
where id in (96, 97, 98, 99)
  and legacy_id is null
  and title = 'ئۆزىمىزنى ئېتىراپ قىلايلى';

commit;
