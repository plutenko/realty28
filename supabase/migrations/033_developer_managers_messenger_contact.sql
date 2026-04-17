-- Add separate field for messenger contact (telegram username, max link, etc)
-- so users don't have to put it in the phone field
ALTER TABLE developer_managers ADD COLUMN IF NOT EXISTS messenger_contact text;
