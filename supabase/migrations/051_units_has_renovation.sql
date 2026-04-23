-- Флаг «квартира с готовым ремонтом». Ставится вручную в админке
-- (admin/units → модалка редактирования квартиры). Показывается на
-- карточке и модалке /apartments, а также в сводке /buildings.
ALTER TABLE units
  ADD COLUMN IF NOT EXISTS has_renovation boolean NOT NULL DEFAULT false;
