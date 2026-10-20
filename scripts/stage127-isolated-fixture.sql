-- Throwaway PostgreSQL fixture for Stage 127. Never production.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
INSERT INTO auth.users (id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333');

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb LANGUAGE sql STABLE
AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(auth.jwt()->>'sub', '')::uuid $$;

CREATE TABLE public.admin_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id)
);
INSERT INTO public.admin_users (user_id)
VALUES ('22222222-2222-4222-8222-222222222222');

CREATE OR REPLACE FUNCTION public.is_kutadgu_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()) $$;
REVOKE ALL ON FUNCTION public.is_kutadgu_admin() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_kutadgu_admin() TO authenticated;

CREATE TABLE public.books (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  author text NOT NULL DEFAULT '',
  price numeric(12,2),
  image_url text NOT NULL DEFAULT '',
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  stock_status text,
  is_active boolean NOT NULL DEFAULT true,
  submission_status text NOT NULL DEFAULT 'approved'
);

INSERT INTO public.books (title, author, price, image_url, stock)
SELECT 'Book ' || n, 'Author ' || n, n * 10, '/cover-' || n || '.webp', 20
FROM generate_series(1, 50) AS n;

GRANT SELECT ON public.books TO anon, authenticated;
