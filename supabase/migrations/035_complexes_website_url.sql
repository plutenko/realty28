-- Adds website URL to complexes (ЖК) — shown in apartment modal on /apartments.
ALTER TABLE public.complexes
  ADD COLUMN IF NOT EXISTS website_url text;
