-- Поэтажный план, индивидуальный для квартиры.
-- Нужен для FSK: API отдаёт SVG этажа с подсветкой конкретной квартиры
-- (у соседних квартир на том же этаже файлы разные). Для парсеров, отдающих
-- один план на этаж, используется images.building_floor_level_plan — эту
-- логику в /api/units оставили fallback'ом.

ALTER TABLE units
  ADD COLUMN IF NOT EXISTS floor_plan_url text;
