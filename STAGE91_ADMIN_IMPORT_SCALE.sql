-- قۇتادغۇبىلىك — Stage 9.1 Admin import / stock scale
-- Supabase > SQL Editor دا Run قىلىڭ. ئاگېنت / كود ئىجرا قىلمايدۇ.
-- Repeat-safe: CREATE OR REPLACE. INSERT/UPDATE/DELETE يوق. كىتاب قۇرلىرى ئۆزگەرمەيدۇ.
-- service_role ئاچىلمايدۇ. anon EXECUTE يوق.
--
-- نېمە ئۈچۈن: Admin ئامبار جەمئىيسى .select("stock").range(0,9999) بىلەن
-- PostgREST max-rows (~1000) تەرىپىدىن كېسىلىدۇ. بۇ RPC سېرۋېردە SUM قىلىدۇ.
-- stock ستونى يوق بولسا NULL قايتىدۇ (Admin «—» كۆرسىتىدۇ).

create or replace function public.get_kutadgu_book_stock_sum()
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  total bigint;
begin
  if not public.is_kutadgu_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  if to_regclass('public.books') is null then
    return 0;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'books'
      and column_name = 'stock'
  ) then
    return null;
  end if;

  execute 'select coalesce(sum(stock), 0)::bigint from public.books' into total;
  return coalesce(total, 0);
end;
$$;

revoke all on function public.get_kutadgu_book_stock_sum() from public;
revoke all on function public.get_kutadgu_book_stock_sum() from anon;
grant execute on function public.get_kutadgu_book_stock_sum() to authenticated;
