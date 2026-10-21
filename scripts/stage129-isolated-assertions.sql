DO $assert$
BEGIN
  IF NOT public.shared_cart_items_valid('[{"id":"12","qty":2}]'::jsonb) THEN
    RAISE EXCEPTION 'legacy v1 line rejected';
  END IF;
  IF NOT public.shared_cart_items_valid('[{"kind":"book","id":"12","qty":2},{"kind":"set","group_id":"7","qty":1}]'::jsonb) THEN
    RAISE EXCEPTION 'typed v2 lines rejected';
  END IF;
  IF public.shared_cart_items_valid('[{"kind":"set","group_id":"7","qty":1,"price":1}]'::jsonb)
     OR public.shared_cart_items_valid('[{"kind":"future","group_id":"7","qty":1}]'::jsonb)
     OR public.shared_cart_items_valid('[{"kind":"set","group_id":"0","qty":1}]'::jsonb)
     OR public.shared_cart_items_valid('[{"kind":"book","id":"12","qty":100}]'::jsonb) THEN
    RAISE EXCEPTION 'invalid or authority-bearing typed line accepted';
  END IF;
END;
$assert$;

INSERT INTO public.shared_cart_links(code,items,expires_at)
VALUES (
  'ABCDEFGH',
  '[{"kind":"book","id":"12","qty":2},{"kind":"set","group_id":"7","qty":1}]'::jsonb,
  now() + interval '30 days'
);
