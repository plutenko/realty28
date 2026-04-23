-- Поэтажные планы с привязкой к подъезду.
-- У ЖК «Лазурный берег» литер 9 4 подъезда с разными планами этажа на один
-- этаж — одной записи на (building_id, floor_level) недостаточно. Вводим
-- опциональный `entrance`: null = план на весь дом (любой подъезд),
-- целое = план конкретного подъезда. В лукапе квартиры отдаём
-- entrance-specific с fallback на null.
ALTER TABLE images
  ADD COLUMN IF NOT EXISTS entrance int;

-- Индекс для быстрого подбора плана по (building, floor, entrance).
CREATE INDEX IF NOT EXISTS images_building_floor_entrance_idx
  ON images (entity_id, floor_level, entrance)
  WHERE entity_type = 'building_floor_level_plan';
