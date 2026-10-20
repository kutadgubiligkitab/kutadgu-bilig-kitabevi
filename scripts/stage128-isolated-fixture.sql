-- Throwaway commerce fixture layered on Stage 127. Never production.
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'active'
);
INSERT INTO public.profiles (id, status) VALUES
  ('11111111-1111-4111-8111-111111111111', 'active'),
  ('22222222-2222-4222-8222-222222222222', 'active'),
  ('33333333-3333-4333-8333-333333333333', 'suspended');

CREATE OR REPLACE FUNCTION public.is_member_active()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status = 'active') $$;
REVOKE ALL ON FUNCTION public.is_member_active() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_member_active() TO authenticated;

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no text NOT NULL UNIQUE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared','confirmed','processing','shipped','completed','cancelled')),
  items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array'),
  total numeric(12,2) NOT NULL DEFAULT 0,
  total_qty integer NOT NULL DEFAULT 0,
  customer_name text NOT NULL DEFAULT '',
  customer_phone text NOT NULL DEFAULT '',
  customer_city text NOT NULL DEFAULT '',
  customer_address text NOT NULL DEFAULT '',
  delivery_method text NOT NULL DEFAULT '',
  customer_note text NOT NULL DEFAULT '',
  stock_committed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.kutadgu_orders_stock_transition()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  old_committed boolean;
  new_committed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('confirmed','processing','shipped','completed') THEN
      RAISE EXCEPTION 'committed_insert_forbidden';
    END IF;
    NEW.stock_committed := false;
    RETURN NEW;
  END IF;
  old_committed := coalesce(OLD.stock_committed, false);
  new_committed := NEW.status IN ('confirmed','processing','shipped','completed');
  IF NEW.items IS DISTINCT FROM OLD.items AND (old_committed OR new_committed) THEN
    RAISE EXCEPTION 'order_items_immutable';
  END IF;
  IF old_committed = new_committed THEN
    NEW.stock_committed := old_committed;
    RETURN NEW;
  END IF;
  IF NOT old_committed AND new_committed THEN
    PERFORM public.kutadgu_apply_order_stock_delta(OLD.items, -1);
    NEW.stock_committed := true;
    RETURN NEW;
  END IF;
  PERFORM public.kutadgu_apply_order_stock_delta(OLD.items, 1);
  NEW.stock_committed := false;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_stock_transition
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.kutadgu_orders_stock_transition();
