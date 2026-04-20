-- Daily re-approve: approve действителен до 03:00 Asia/Yakutsk следующего рабочего дня.
-- last_approved_at — момент последнего подтверждения руководителем.
-- При входе check-device сравнивает workingDay(last_approved_at) с workingDay(now()) (cutoff 03:00 Yakutsk).

ALTER TABLE user_devices ADD COLUMN IF NOT EXISTS last_approved_at timestamptz;

-- Бэкфилл: считаем, что существующие одобренные устройства нужно пере-одобрить.
-- Оставляем NULL — endpoint воспримет как «approve не был сегодня», создаст pending_login.
