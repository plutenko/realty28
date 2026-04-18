-- Soft-delete для профилей. При "увольнении" риелтора ставим is_active=false и fired_at,
-- физически запись остаётся — чтобы исторические daily_reports не ломались.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS fired_at timestamptz;

-- Существующие профили — активные.
UPDATE profiles SET is_active = true WHERE is_active IS NULL;
