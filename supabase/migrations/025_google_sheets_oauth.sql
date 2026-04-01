-- OAuth-токены личного Google (Drive/Sheets read) для шахматки. Одна строка id = 1.

CREATE TABLE IF NOT EXISTS public.google_sheets_oauth (
  id integer PRIMARY KEY DEFAULT 1,
  access_token text,
  refresh_token text,
  token_expiry timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_sheets_oauth_single_row CHECK (id = 1)
);

INSERT INTO public.google_sheets_oauth (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.google_sheets_oauth IS 'Personal Google OAuth for Sheets sync (row id must be 1).';
