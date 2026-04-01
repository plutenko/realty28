-- Планы этажей: несколько изображений на один корпус (по номеру этажа).

ALTER TABLE public.images
  ADD COLUMN IF NOT EXISTS floor_level integer NULL;

COMMENT ON COLUMN public.images.floor_level IS
  'Для entity_type = building_floor_level_plan: номер этажа; NULL — как раньше (одна картинка на сущность).';

CREATE INDEX IF NOT EXISTS idx_images_building_floor_level
  ON public.images (entity_type, entity_id, floor_level);
