-- Очищаем поэтажные планы Profitbase, записанные с thumbnail floor_2000_2000
-- (~2000px, кашица на крупных ЖК типа Левашовской Рощи). Парсер теперь кладёт
-- images.source (оригинал PNG), при следующем синке планы перезапишутся.
-- MacroCRM / Amurstroy / FSK / ручные планы не трогаем — фильтр по паттерну URL.

DELETE FROM images
 WHERE entity_type = 'building_floor_level_plan'
   AND url LIKE '%/thumbnails/floor_2000_2000/%';
