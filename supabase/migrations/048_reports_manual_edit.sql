-- Ручные правки отчётов руководителем + блокировка правок риелтора после сдачи сводки.

ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS edited_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

-- Разблокировка конкретного дня — руководитель ставит флаг, бот пропускает приём
-- отчётов / правок за эту дату, даже если окно (09:30) уже закрыто.
CREATE TABLE IF NOT EXISTS report_day_overrides (
  date date PRIMARY KEY,
  unlocked_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE report_day_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all" ON report_day_overrides;
CREATE POLICY "service_role_all" ON report_day_overrides
  FOR ALL TO service_role USING (true) WITH CHECK (true);
