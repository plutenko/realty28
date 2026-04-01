-- Добавляем медиа-поля для планировок/отделки в units.
-- Это поддерживает существующие UI-контролы (планировка/отделка) и прокси /api/admin/set-media.

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS layout_title text;

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS layout_image_url text;

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS finish_image_url text;

-- UI также использует эти поля в некоторых карточках/страницах.
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS orientation text;

-- Дополнительно (для совместимости с UnitCard.jsx)
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS area_m2 numeric;

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS price_rub numeric;

