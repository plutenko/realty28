-- Координаты ЖК для отображения на карте /apartments?view=map.
-- Numeric, чтобы хранить с точностью до ~5-6 знаков (этого хватает для здания).
-- Заполняется вручную через админку (карта-пикер) — у части ЖК нет точного
-- адреса, и автогеокодинг по адресу не подходит.

ALTER TABLE complexes
  ADD COLUMN IF NOT EXISTS lat numeric,
  ADD COLUMN IF NOT EXISTS lng numeric;

COMMENT ON COLUMN complexes.lat IS 'Широта ЖК для карты (нет = не показываем пин)';
COMMENT ON COLUMN complexes.lng IS 'Долгота ЖК для карты (нет = не показываем пин)';
