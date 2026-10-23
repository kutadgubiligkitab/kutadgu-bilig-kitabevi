-- Stage 132 rollback. Drops the category directory and its functions.
-- It does not restore book or volume-group source and label values
-- changed by a rename or a bulk move. Do not run this on production
-- after those operations unless that data loss is intentional.

BEGIN;

DROP TRIGGER IF EXISTS zzz_book_categories_books_source_guard ON public.books;
DROP TRIGGER IF EXISTS zzz_book_categories_groups_source_guard ON public.book_volume_groups;
DROP TRIGGER IF EXISTS book_categories_books_source_commit ON public.books;
DROP TRIGGER IF EXISTS book_categories_groups_source_commit ON public.book_volume_groups;

DROP FUNCTION IF EXISTS public.admin_move_books_to_category(uuid, bigint[], bigint, bigint[]);
DROP FUNCTION IF EXISTS public.admin_preview_book_category_move(bigint[], bigint);
DROP FUNCTION IF EXISTS public.admin_retire_book_category(uuid, bigint, bigint, bigint);
DROP FUNCTION IF EXISTS public.admin_set_book_category_hidden(uuid, bigint, bigint, boolean);
DROP FUNCTION IF EXISTS public.admin_move_book_category_order(uuid, bigint, bigint, text);
DROP FUNCTION IF EXISTS public.admin_rename_book_category(uuid, bigint, bigint, text);
DROP FUNCTION IF EXISTS public.admin_create_book_category(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.admin_list_book_categories();
DROP FUNCTION IF EXISTS public.list_public_book_categories();

DROP TABLE IF EXISTS public.book_category_operations;
DROP TABLE IF EXISTS public.book_categories;

DROP FUNCTION IF EXISTS public.book_categories_guard_source();
DROP FUNCTION IF EXISTS public.book_categories_assert_open_source();

COMMIT;
