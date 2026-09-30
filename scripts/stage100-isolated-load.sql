-- Representative rows for the isolated Stage 100 check.
-- Inserted as the table owner so historical created_at values are possible.
-- The timing trigger still runs.

DO $$
DECLARE
  today date := (timezone('Europe/Istanbul', now()))::date;
  mid timestamptz := today::timestamp AT TIME ZONE 'Europe/Istanbul';
  t2 timestamptz := (today - 2)::timestamp AT TIME ZONE 'Europe/Istanbul' + interval '12 hours';
  t3 timestamptz := (today - 3)::timestamp AT TIME ZONE 'Europe/Istanbul' + interval '1 hour';
  equal_at timestamptz := t2 + interval '2 minutes';
  tie_occurred timestamptz := now() - interval '12 seconds';
  visitor_a text := '11111111-1111-4111-8111-111111111111';
  visitor_b text := '22222222-2222-4222-8222-222222222222';
  visitor_d text := '33333333-3333-4333-8333-333333333333';
  visitor_c text := '44444444-4444-4444-8444-444444444444';
  visitor_e text := '55555555-5555-4555-8555-555555555555';
  visitor_f text := '66666666-6666-4666-8666-666666666666';
BEGIN
  INSERT INTO public.analytics_events (event_name, visitor_id, path, host, created_at) VALUES
    ('page_view', visitor_d, '/index.html', 'www.kutadgubilik.com', mid),
    ('page_view', visitor_a, '/index.html', 'www.kutadgubilik.com', mid + interval '1 hour'),
    ('page_view', visitor_a, '/index.html', 'www.kutadgubilik.com', mid + interval '2 hours'),
    ('page_view', visitor_b, '/index.html', 'www.kutadgubilik.com', mid + interval '3 hours'),
    ('page_view', NULL, '/index.html', 'www.kutadgubilik.com', mid + interval '4 hours'),
    ('page_view', visitor_a, '/index.html', 'www.kutadgubilik.com', mid - interval '1 second'),
    ('page_view', NULL, '/index.html', 'www.kutadgubilik.com', t3),
    ('page_view', visitor_c, '/index.html', 'www.kutadgubilik.com', mid + interval '1 day'),
    ('page_view', visitor_e, '/index.html', 'preview.vercel.app', mid + interval '30 minutes'),
    ('page_view', visitor_f, '/admin.html', 'www.kutadgubilik.com', mid + interval '30 minutes');

  INSERT INTO public.analytics_events (event_name, book_id, legacy_id, path, created_at) VALUES
    ('book_view', 'shared-slug', NULL, '/book/slug', t2 + interval '8 minutes'),
    ('book_view', '15', 'shared-slug', '/book/15', t2 + interval '9 minutes');

  INSERT INTO public.analytics_events (event_name, meta, path, created_at) VALUES
    ('whatsapp_order_click', '{"book_ids":["15","15","2"]}'::jsonb, '/cart.html', t2 + interval '10 minutes');

  INSERT INTO public.analytics_events (event_name, session_id, action_seq, occurred_at, path, created_at) VALUES
    ('book_view', 'delay', 1, now() - interval '20 seconds', '/book/1', t2 + interval '30 seconds'),
    ('add_to_cart', 'delay', 2, now() - interval '10 seconds', '/book/1', t2),
    ('book_view', 'equal', 5, now() - interval '15 seconds', '/book/1', equal_at),
    ('add_to_cart', 'equal', 5, now() - interval '15 seconds', '/book/1', equal_at),
    ('book_view', 'tie', 7, tie_occurred, '/book/1', t2 + interval '5 minutes'),
    ('add_to_cart', 'tie', 8, tie_occurred, '/book/1', t2 + interval '1 minute');

  INSERT INTO public.analytics_events (event_name, session_id, path, created_at) VALUES
    ('book_view', 'historical', '/book/1', t2 + interval '6 minutes'),
    ('add_to_cart', 'historical', '/book/1', t2 + interval '7 minutes');

  INSERT INTO public.analytics_events (event_name, path, action_seq, occurred_at, created_at) VALUES
    ('page_view', '/probe-old', 3, now() - interval '30 minutes', now() - interval '10 days'),
    ('page_view', '/probe-future', 3, now() + interval '10 minutes', now() - interval '10 days'),
    ('page_view', '/probe-valid', 4, now() - interval '20 seconds', now() - interval '10 days');
END $$;
